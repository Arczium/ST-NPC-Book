import { name1 } from '../../../../../script.js';
import {
    loadWorldInfo,
    saveWorldInfo,
    createWorldInfoEntry,
} from '../../../../world-info.js';

import { settings } from './settings_loader.js';
import { syncWorldInfoUi } from './lorebook_create.js';

export function getEntryTitleAffixes() {
    const tpl = String(settings.entry_title_template || '[NPC] {{name}}');
    const parts = tpl.split(/\{\{name\}\}/i);
    return {
        prefix: parts[0] ?? '[NPC] ',
        suffix: parts[1] ?? '',
    };
}

export function formatEntryTitle(canonicalName) {
    const tpl = String(settings.entry_title_template || '[NPC] {{name}}');
    if (/\{\{name\}\}/i.test(tpl)) {
        return tpl.replace(/\{\{name\}\}/gi, canonicalName.trim());
    }
    return `${tpl.trim()} ${canonicalName.trim()}`;
}

export function extractNpcNameFromTitle(comment) {
    if (typeof comment !== 'string' || !comment.trim()) return null;
    const { prefix, suffix } = getEntryTitleAffixes();

    if (prefix && !comment.startsWith(prefix)) return null;
    if (suffix && !comment.endsWith(suffix)) return null;

    const startIdx = prefix.length;
    const endIdx = suffix ? comment.length - suffix.length : comment.length;
    const extracted = comment.slice(startIdx, endIdx).trim();
    return extracted || null;
}

export async function getExistingNpcEntries(lorebookName) {
    if (!lorebookName) return [];

    const worldData = await loadWorldInfo(lorebookName);
    if (!worldData || typeof worldData.entries !== 'object') {
        return [];
    }

    const npcEntries = [];
    for (const rawEntry of Object.values(worldData.entries)) {
        if (!rawEntry) continue;
        const canonicalName = extractNpcNameFromTitle(rawEntry.comment);
        if (!canonicalName) continue;

        npcEntries.push({
            uid: Number(rawEntry.uid),
            name: canonicalName,
            comment: String(rawEntry.comment ?? ''),
            keys: Array.isArray(rawEntry.key) ? [...rawEntry.key] : [],
            content: String(rawEntry.content ?? ''),
        });
    }

    return npcEntries;
}

export function sanitizeAndMergeKeys(canonicalName, existingKeys = [], newKeys = []) {
    const cleanName = String(canonicalName || '').trim();
    const userName = String(name1 || '').trim().toLowerCase();

    const combined = [
        ...(Array.isArray(existingKeys) ? existingKeys : []),
        ...(Array.isArray(newKeys) ? newKeys : []),
    ];

    if (cleanName) {
        combined.unshift(cleanName);
    }

    const seenLower = new Set();
    const result = [];

    for (const rawKey of combined) {
        const trimmed = String(rawKey ?? '').trim();
        if (trimmed.length < 2) continue;

        const lower = trimmed.toLowerCase();
        if (lower === '{{user}}' || (userName && lower === userName)) continue;
        if (seenLower.has(lower)) continue;

        seenLower.add(lower);
        result.push(trimmed);
    }

    if (result.length === 0 && cleanName) {
        result.push(cleanName);
    }

    return result;
}

function applyNativeWorldInfoFields(entry, canonicalName, mergedKeys, markdownContent) {
    entry.comment = formatEntryTitle(canonicalName);
    entry.key = mergedKeys;
    entry.content = markdownContent;
    entry.disable = false;

    const mode = settings.entry_mode || 'normal';
    entry.constant = (mode === 'constant');
    entry.vectorized = (mode === 'vectorized');

    entry.position = Number(settings.entry_position ?? 1);
    entry.depth = Number(settings.entry_inchat_depth ?? 10);
    entry.role = Number(settings.entry_inchat_role ?? 0);

    entry.order = Number(settings.entry_order ?? 100);
    entry.scanDepth = Number(settings.entry_scan_depth ?? 2);
    entry.sticky = Number(settings.entry_sticky ?? 4);
    entry.ignoreBudget = Boolean(settings.entry_ignore_budget);
}

/**
 * Finds a raw World Info entry in `worldData.entries` by UID or case-insensitive canonical NPC name.
 */
export function findRawNpcEntry(worldData, uid, canonicalName) {
    if (!worldData || typeof worldData.entries !== 'object') return null;

    if (uid !== undefined && uid !== null) {
        const direct = worldData.entries[uid] ||
            Object.values(worldData.entries).find(e => Number(e?.uid) === Number(uid));
        if (direct) return direct;
    }

    if (canonicalName) {
        const lowerTarget = String(canonicalName).trim().toLowerCase();
        return Object.values(worldData.entries).find(e => {
            const extracted = extractNpcNameFromTitle(e?.comment);
            return extracted && extracted.toLowerCase() === lowerTarget;
        }) || null;
    }

    return null;
}

/**
 * Deletes an entry from `worldData.entries` by its UID regardless of the object key used.
 */
export function deleteRawEntryByUid(worldData, targetUid) {
    if (!worldData || typeof worldData.entries !== 'object') return false;
    let deleted = false;
    for (const [dictKey, entry] of Object.entries(worldData.entries)) {
        if (Number(entry?.uid) === Number(targetUid) || Number(dictKey) === Number(targetUid)) {
            delete worldData.entries[dictKey];
            deleted = true;
        }
    }
    return deleted;
}

/**
 * Atomically upserts a batch of validated NPC payloads in a single `loadWorldInfo` + `saveWorldInfo` transaction.
 * Prevents concurrent disk-write race conditions when multiple Scribe workers finish simultaneously.
 *
 * @param {string} lorebookName
 * @param {Array<{ uid?: number, name: string, keys?: string[], new_keys?: string[], content: string }>} npcPayloads
 */
export async function batchUpsertNpcEntries(lorebookName, npcPayloads) {
    if (!lorebookName || !Array.isArray(npcPayloads) || npcPayloads.length === 0) {
        return [];
    }

    const worldData = await loadWorldInfo(lorebookName);
    if (!worldData || typeof worldData.entries !== 'object') {
        throw new Error(`Could not load World Info "${lorebookName}" for batch upsert.`);
    }

    const results = [];

    for (const npcPayload of npcPayloads) {
        if (!npcPayload?.name) continue;
        const canonicalName = String(npcPayload.name).trim();
        let targetEntry = findRawNpcEntry(worldData, npcPayload.uid, canonicalName);
        let isNew = false;

        const previousSnapshot = targetEntry
            ? {
                uid: Number(targetEntry.uid),
                comment: String(targetEntry.comment ?? ''),
                key: Array.isArray(targetEntry.key) ? [...targetEntry.key] : [],
                content: String(targetEntry.content ?? ''),
            }
            : null;

        if (!targetEntry) {
            targetEntry = createWorldInfoEntry(lorebookName, worldData);
            isNew = true;
        }

        const existingKeys = Array.isArray(targetEntry.key) ? targetEntry.key : [];
        const incomingKeys = isNew
            ? (npcPayload.keys || npcPayload.new_keys || [])
            : (npcPayload.new_keys || npcPayload.keys || []);

        const mergedKeys = sanitizeAndMergeKeys(canonicalName, existingKeys, incomingKeys);

        applyNativeWorldInfoFields(
            targetEntry,
            canonicalName,
            mergedKeys,
            String(npcPayload.content ?? '').trim()
        );

        results.push({
            uid: Number(targetEntry.uid),
            name: canonicalName,
            keys: mergedKeys,
            isNew,
            previousSnapshot,
        });
    }

    await saveWorldInfo(lorebookName, worldData, true);
    await syncWorldInfoUi(lorebookName);
    return results;
}

export async function upsertNpcEntry(lorebookName, npcPayload) {
    const res = await batchUpsertNpcEntries(lorebookName, [npcPayload]);
    return res[0] || null;
}