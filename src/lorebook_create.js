import {
    chat,
    chat_metadata,
    characters,
    this_chid,
    saveMetadata,
} from '../../../../../script.js';
import {
    world_names,
    METADATA_KEY,
    saveWorldInfo,
    updateWorldInfoList,
} from '../../../../world-info.js';

import { MODULE_NAME, settings, notify } from './settings_loader.js';

/**
 * Synchronizes SillyTavern's World Info UI dropdowns, Chat Lorebook indicator,
 * and open World Info editor if it is currently displaying `lorebookName`.
 *
 * @param {string} [lorebookName]
 */
export async function syncWorldInfoUi(lorebookName) {
    try {
        await updateWorldInfoList();

        if (lorebookName) {
            const editorSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById('world_editor_select'));
            if (editorSelect && editorSelect.selectedOptions?.[0]?.textContent === lorebookName) {
                editorSelect.dispatchEvent(new Event('change'));
            }
        }
    } catch (err) {
        console.warn(`[${MODULE_NAME}] Could not sync World Info UI:`, err);
    }
}

export function formatNewLorebookName() {
    const rawCharName = (this_chid !== undefined && characters[this_chid]?.name)
        ? characters[this_chid].name
        : 'Character';
    const safeChar = rawCharName.replace(/[^a-zA-Z0-9_-]/g, '_');

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    const template = settings.lorebook_name || '~{{char}}_{{date}}';
    return template
        .replace(/\{\{char\}\}/gi, safeChar)
        .replace(/\{\{date\}\}/gi, dateStr);
}

/**
 * Safely creates a new Lorebook file on disk via `saveWorldInfo` without triggering
 * UI state resets or colliding with active chat loading.
 * @returns {Promise<string|null>}
 */
export async function createAndBindChatLorebook() {
    if (!chat_metadata || !Array.isArray(chat) || chat.length === 0) {
        notify('error', 'toast.no_active_chat');
        return null;
    }

    let targetName = formatNewLorebookName();
    if (Array.isArray(world_names) && world_names.includes(targetName)) {
        let suffix = 2;
        while (world_names.includes(`${targetName}_${suffix}`)) {
            suffix++;
        }
        targetName = `${targetName}_${suffix}`;
    }

    try {
        await saveWorldInfo(targetName, { entries: {} }, true);
    } catch (err) {
        console.error(`[${MODULE_NAME}] Error creating Lorebook "${targetName}":`, err);
        notify('error', 'toast.lorebook_create_failed', { name: targetName });
        return null;
    }

    chat_metadata[METADATA_KEY] = targetName;
    await saveMetadata();
    await syncWorldInfoUi(targetName);
    notify('success', 'toast.lorebook_created', { name: targetName });
    return targetName;
}