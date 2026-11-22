import {
    chat_metadata,
    saveMetadata,
} from '../../../../../script.js';
import { Popup } from '../../../../popup.js';
import {
    METADATA_KEY,
    loadWorldInfo,
    saveWorldInfo,
    createWorldInfoEntry,
} from '../../../../world-info.js';

import {
    MODULE_NAME,
    notify,
    t,
    runtimeState,
    triggerModalRefresh,
} from './settings_loader.js';
import { syncWorldInfoUi } from './lorebook_create.js';
import {
    extractNpcNameFromTitle,
    findRawNpcEntry,
    deleteRawEntryByUid,
} from './lorebook_editor.js';
import { getChatTracker, executeNpcScanSlice } from './scan_executor.js';

/**
 * Restores the bound Lorebook and chat cursor using `chat_metadata.npc_book.last_slice_snapshot`.
 * @returns {Promise<{ previous_cursor: number, new_cursor: number, lorebook: string } | null>}
 */
export async function undoLastSlice() {
    if (runtimeState.isScanRunning || runtimeState.isCatchUpRunning) {
        notify('warning', 'toast.undo_busy');
        return null;
    }

    const tracker = getChatTracker();
    const snap = tracker.last_slice_snapshot;
    if (!snap) {
        notify('info', 'toast.undo_no_snapshot');
        return null;
    }

    const activeLorebook = chat_metadata ? chat_metadata[METADATA_KEY] : '';
    const targetLorebook = snap.lorebook || activeLorebook;
    if (!targetLorebook) {
        notify('error', 'toast.undo_no_lorebook');
        return null;
    }

    if (activeLorebook && snap.lorebook && activeLorebook !== snap.lorebook) {
        notify('error', 'toast.undo_lorebook_mismatch', {
            snapLorebook: snap.lorebook,
            activeLorebook,
        });
        return null;
    }

    runtimeState.isScanRunning = true;
    triggerModalRefresh();
    try {
        const worldData = await loadWorldInfo(targetLorebook);
        if (!worldData || typeof worldData.entries !== 'object') {
            throw new Error(`Could not load Lorebook "${targetLorebook}".`);
        }

        const createdUids = Array.isArray(snap.created_uids) ? snap.created_uids : [];
        let deletedCount = 0;
        for (const uid of createdUids) {
            if (deleteRawEntryByUid(worldData, uid)) {
                deletedCount++;
            }
        }

        const updatedEntries = Array.isArray(snap.updated_entries) ? snap.updated_entries : [];
        let restoredCount = 0;
        for (const prev of updatedEntries) {
            let entry = findRawNpcEntry(worldData, prev.uid, null);
            if (!entry) {
                entry = createWorldInfoEntry(targetLorebook, worldData);
            }
            entry.comment = String(prev.comment ?? '');
            entry.key = Array.isArray(prev.key) ? [...prev.key] : [];
            entry.content = String(prev.content ?? '');
            restoredCount++;
        }

        if (createdUids.length > 0 || updatedEntries.length > 0) {
            await saveWorldInfo(targetLorebook, worldData, true);
            await syncWorldInfoUi(targetLorebook);
        }

        const prevCursor = Math.max(0, Number(snap.previous_cursor) || 0);
        const newCursor = Math.max(prevCursor, Number(snap.new_cursor) || prevCursor);

        tracker.last_scanned_index = prevCursor;
        tracker.last_slice_snapshot = null;
        await saveMetadata();

        notify('success', 'toast.undo_success', {
            prev: prevCursor,
            next: newCursor,
            deleted: deletedCount,
            restored: restoredCount,
        });

        return {
            previous_cursor: prevCursor,
            new_cursor: newCursor,
            lorebook: targetLorebook,
        };
    } catch (err) {
        console.error(`[${MODULE_NAME}] undoLastSlice failed:`, err);
        notify('error', 'toast.undo_failed', { error: err.message || String(err) });
        return null;
    } finally {
        runtimeState.isScanRunning = false;
        triggerModalRefresh();
    }
}

/**
 * Rolls back the last slice snapshot and immediately re-scans the exact same message range.
 */
export async function rerollLastSlice() {
    if (runtimeState.isScanRunning || runtimeState.isCatchUpRunning) {
        notify('warning', 'toast.scan_in_progress');
        return;
    }

    const rolledBack = await undoLastSlice();
    if (!rolledBack) return;

    await executeNpcScanSlice({
        customStart: rolledBack.previous_cursor,
        customEnd: rolledBack.new_cursor,
        manual: true,
    });
}

/**
 * Deletes all managed [NPC] entries from the bound Chat Lorebook, resets `last_scanned_index = 0`,
 * and clears `last_slice_snapshot`. Non-NPC entries in the Lorebook are preserved.
 */
export async function wipeNpcsAndReset() {
    if (runtimeState.isScanRunning || runtimeState.isCatchUpRunning) {
        notify('warning', 'toast.wipe_busy');
        return false;
    }

    const activeLorebook = chat_metadata ? chat_metadata[METADATA_KEY] : '';
    const confirmMsg = activeLorebook
        ? t('popup.wipe_confirm_with_lb', { lorebook: activeLorebook })
        : t('popup.wipe_confirm_no_lb');

    const confirmed = await Popup.show.confirm(t('popup.wipe_confirm_title'), confirmMsg);
    if (!confirmed) return false;

    runtimeState.isScanRunning = true;
    triggerModalRefresh();
    try {
        let removedCount = 0;

        if (activeLorebook) {
            const worldData = await loadWorldInfo(activeLorebook);
            if (worldData && typeof worldData.entries === 'object') {
                for (const [dictKey, entry] of Object.entries(worldData.entries)) {
                    if (entry && extractNpcNameFromTitle(entry.comment)) {
                        delete worldData.entries[dictKey];
                        removedCount++;
                    }
                }
                if (removedCount > 0) {
                    await saveWorldInfo(activeLorebook, worldData, true);
                    await syncWorldInfoUi(activeLorebook);
                }
            }
        }

        const tracker = getChatTracker();
        tracker.last_scanned_index = 0;
        tracker.last_slice_snapshot = null;
        await saveMetadata();

        if (activeLorebook) {
            notify('success', 'toast.wipe_success_lb', {
                count: removedCount,
                lorebook: activeLorebook,
            });
        } else {
            notify('success', 'toast.wipe_success_no_lb');
        }
        return true;
    } catch (err) {
        console.error(`[${MODULE_NAME}] wipeNpcsAndReset failed:`, err);
        notify('error', 'toast.wipe_failed', { error: err.message || String(err) });
        return false;
    } finally {
        runtimeState.isScanRunning = false;
        triggerModalRefresh();
    }
}