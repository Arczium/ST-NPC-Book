import {
    chat,
    chat_metadata,
    saveMetadata,
} from '../../../../../script.js';

import {
    MODULE_NAME,
    settings,
    notify,
    t,
    runtimeState,
    triggerModalRefresh,
} from './settings_loader.js';
import { ensureChatLorebook } from './lorebook_missing_check.js';
import { getExistingNpcEntries, batchUpsertNpcEntries } from './lorebook_editor.js';
import { buildTranscriptSlice, runScannerStage } from './npc_scanner.js';
import { runSingleScribeWorker, runWithConcurrency } from './npc_scribe.js';

export function getChatTracker() {
    if (!chat_metadata) {
        return {
            last_scanned_index: 0,
            ignore_missing_lorebook: false,
            last_slice_snapshot: null,
        };
    }
    if (!chat_metadata.npc_book) {
        chat_metadata.npc_book = {
            last_scanned_index: 0,
            ignore_missing_lorebook: false,
            last_slice_snapshot: null,
        };
    }
    if (chat_metadata.npc_book.last_slice_snapshot === undefined) {
        chat_metadata.npc_book.last_slice_snapshot = null;
    }
    return chat_metadata.npc_book;
}

export function getScheduleStatus() {
    const totalMessages = Array.isArray(chat) ? chat.length : 0;
    const tracker = getChatTracker();
    const lastScanned = Number(tracker.last_scanned_index) || 0;
    const interval = Math.max(1, Number(settings.trigger_message_interval) || 30);
    const offset = Math.max(0, Number(settings.trigger_message_offset) || 10);
    const nextTriggerAt = lastScanned + interval + offset;
    const isDue = totalMessages >= nextTriggerAt;

    const eligibleCeiling = Math.max(0, totalMessages - offset);
    const eligibleUnscanned = Math.max(0, eligibleCeiling - lastScanned);
    const catchUpSlicesCount = Math.floor(eligibleUnscanned / interval);

    const sliceStart = lastScanned;
    const sliceEnd = lastScanned + interval;

    return {
        totalMessages,
        lastScanned,
        interval,
        offset,
        nextTriggerAt,
        sliceStart,
        sliceEnd,
        isDue,
        eligibleCeiling,
        catchUpSlicesCount,
        snapshot: tracker.last_slice_snapshot || null,
        summary: t('modal.status_summary', {
            total: totalMessages,
            last: lastScanned,
            next: nextTriggerAt,
            start: sliceStart,
            end: sliceEnd,
        }),
    };
}

/**
 * Executes a single slice scan atomically.
 * Returns `true` if the slice succeeded and advanced the cursor, or `false` if aborted/failed.
 *
 * @param {{ customStart?: number, customEnd?: number, manual?: boolean }} [options]
 * @returns {Promise<boolean>}
 */
export async function executeNpcScanSlice({ customStart, customEnd, manual = false } = {}) {
    if (runtimeState.isScanRunning) {
        notify('warning', 'toast.scan_in_progress');
        return false;
    }

    const lorebook = await ensureChatLorebook(manual);
    if (!lorebook) return false;

    const status = getScheduleStatus();
    const totalMessages = status.totalMessages;
    const startIdx = customStart !== undefined ? customStart : status.lastScanned;
    const endIdx = customEnd !== undefined
        ? customEnd
        : (manual ? Math.min(totalMessages, startIdx + status.interval) : status.sliceEnd);

    if (endIdx <= startIdx || startIdx >= totalMessages) {
        if (manual) {
            notify('info', 'toast.no_unscanned_range', { start: startIdx, end: endIdx });
        }
        return false;
    }

    const transcript = buildTranscriptSlice(startIdx, endIdx);
    if (!transcript) {
        notify('warning', 'toast.slice_empty', { start: startIdx, end: endIdx });
        return false;
    }

    runtimeState.isScanRunning = true;
    triggerModalRefresh();
    try {
        notify('info', 'toast.stage1_scanning', { start: startIdx, end: endIdx });

        const existingNpcs = await getExistingNpcEntries(lorebook);
        const scanResult = await runScannerStage(transcript, existingNpcs);

        const byUid = new Map(existingNpcs.map(e => [Number(e.uid), e]));
        const byName = new Map(existingNpcs.map(e => [e.name.toLowerCase(), e]));

        const scribeQueue = [];

        for (const upd of scanResult.update) {
            if (!upd?.name && upd?.uid === undefined) continue;
            const matched = (upd.uid !== undefined ? byUid.get(Number(upd.uid)) : null) ||
                (upd.name ? byName.get(String(upd.name).trim().toLowerCase()) : null);

            const canonicalName = matched ? matched.name : String(upd.name).trim();
            if (!canonicalName) continue;

            const alreadyQueued = scribeQueue.some(q => q.name.toLowerCase() === canonicalName.toLowerCase());
            if (alreadyQueued) continue;

            scribeQueue.push({
                mode: matched ? 'update' : 'create',
                uid: matched?.uid,
                name: canonicalName,
                new_keys: Array.isArray(upd.new_keys) ? upd.new_keys : [],
                existingContent: matched?.content || '',
            });
        }

        for (const crt of scanResult.create) {
            const rawName = String(crt?.name ?? '').trim();
            if (!rawName) continue;
            const alreadyQueued = scribeQueue.some(q => q.name.toLowerCase() === rawName.toLowerCase());
            if (alreadyQueued) continue;

            const matched = byName.get(rawName.toLowerCase());
            scribeQueue.push({
                mode: matched ? 'update' : 'create',
                uid: matched?.uid,
                name: matched ? matched.name : rawName,
                keys: Array.isArray(crt.keys) ? crt.keys : [],
                existingContent: matched?.content || '',
            });
        }

        const tracker = getChatTracker();
        const previousCursor = Number(tracker.last_scanned_index) || 0;
        const nextCursor = Math.max(previousCursor, endIdx);

        const createdUids = [];
        const updatedEntriesSnapshot = [];

        if (scribeQueue.length === 0) {
            notify('info', 'toast.no_npcs_detected', { start: startIdx, end: endIdx });
        } else {
            notify('info', 'toast.stage2_scribe', {
                count: scribeQueue.length,
                max: settings.max_concurrent_scribes,
            });

            const workerFns = scribeQueue.map(task => async () => {
                const markdown = await runSingleScribeWorker(task.mode, task, transcript);
                return {
                    uid: task.uid,
                    name: task.name,
                    keys: task.keys,
                    new_keys: task.new_keys,
                    content: markdown,
                };
            });

            const generatedPayloads = await runWithConcurrency(workerFns, settings.max_concurrent_scribes);
            const upsertedResults = await batchUpsertNpcEntries(lorebook, generatedPayloads);

            for (const res of upsertedResults) {
                if (res.isNew) {
                    createdUids.push(Number(res.uid));
                } else if (res.previousSnapshot) {
                    updatedEntriesSnapshot.push(res.previousSnapshot);
                }
            }

            notify('success', 'toast.slice_complete', {
                start: startIdx,
                end: endIdx,
                created: createdUids.length,
                updated: updatedEntriesSnapshot.length,
                lorebook,
            });
        }

        tracker.last_slice_snapshot = {
            previous_cursor: previousCursor,
            new_cursor: nextCursor,
            lorebook,
            created_uids: createdUids,
            updated_entries: updatedEntriesSnapshot,
        };
        tracker.last_scanned_index = nextCursor;
        await saveMetadata();
        return true;
    } catch (err) {
        console.error(`[${MODULE_NAME}] Pipeline execution aborted on slice #${startIdx}..#${endIdx}:`, err);
        notify('error', 'toast.slice_aborted', {
            start: startIdx,
            end: endIdx,
            error: err.message || String(err),
        });
        return false;
    } finally {
        runtimeState.isScanRunning = false;
        triggerModalRefresh();
    }
}

/**
 * Sequential Batch Catch-Up Loop (`[Catch Up All Slices]`).
 * Processes all eligible full slices up to `chat.length - trigger_message_offset`.
 * Can be gracefully stopped after the current slice by clicking the button again.
 */
export async function runCatchUpLoop() {
    if (runtimeState.isCatchUpRunning) {
        runtimeState.stopCatchUpRequested = true;
        notify('info', 'toast.catchup_stopping');
        triggerModalRefresh();
        return;
    }

    if (runtimeState.isScanRunning) {
        notify('warning', 'toast.scan_in_progress');
        return;
    }

    const lorebook = await ensureChatLorebook(true);
    if (!lorebook) return;

    const initialStatus = getScheduleStatus();
    if (initialStatus.catchUpSlicesCount <= 0) {
        notify('info', 'toast.no_catchup_due', {
            last: initialStatus.lastScanned,
            ceiling: initialStatus.eligibleCeiling,
        });
        return;
    }

    runtimeState.isCatchUpRunning = true;
    runtimeState.stopCatchUpRequested = false;
    triggerModalRefresh();

    let completedSlices = 0;
    const totalToRun = initialStatus.catchUpSlicesCount;

    try {
        while (!runtimeState.stopCatchUpRequested) {
            const currentStatus = getScheduleStatus();
            if (!currentStatus.isDue) break;

            const sliceNum = completedSlices + 1;
            notify('info', 'toast.catchup_step', {
                current: sliceNum,
                total: totalToRun,
                start: currentStatus.sliceStart,
                end: currentStatus.sliceEnd,
            });

            const ok = await executeNpcScanSlice({
                customStart: currentStatus.sliceStart,
                customEnd: currentStatus.sliceEnd,
                manual: false,
            });

            if (!ok) {
                notify('error', 'toast.catchup_halted', {
                    start: currentStatus.sliceStart,
                    end: currentStatus.sliceEnd,
                });
                break;
            }

            completedSlices++;
            triggerModalRefresh();
        }

        if (runtimeState.stopCatchUpRequested) {
            notify('info', 'toast.catchup_stopped_user', { count: completedSlices });
        } else if (completedSlices > 0) {
            notify('success', 'toast.catchup_finished', { count: completedSlices });
        }
    } finally {
        runtimeState.isCatchUpRunning = false;
        runtimeState.stopCatchUpRequested = false;
        triggerModalRefresh();
    }
}