import {
    chat,
    chat_metadata,
    this_chid,
    saveMetadata,
} from '../../../../../script.js';
import { Popup, POPUP_TYPE } from '../../../../popup.js';
import { world_names, METADATA_KEY } from '../../../../world-info.js';

import { settings, cloneTemplate, notify, t } from './settings_loader.js';
import {
    formatNewLorebookName,
    createAndBindChatLorebook,
    syncWorldInfoUi,
} from './lorebook_create.js';
import { getChatTracker } from './scan_executor.js';

let isMissingPopupOpen = false;

export async function ensureChatLorebook(forcePopup = false) {
    if (!chat_metadata || this_chid === undefined || !Array.isArray(chat) || chat.length === 0) {
        return null;
    }

    const currentLorebook = chat_metadata[METADATA_KEY];
    if (currentLorebook) return currentLorebook;

    const tracker = getChatTracker();
    if (!forcePopup && (!settings.lorebook_missing || tracker.ignore_missing_lorebook)) {
        return null;
    }

    if (isMissingPopupOpen) return null;
    isMissingPopupOpen = true;

    const previewName = formatNewLorebookName();
    const wrapper = cloneTemplate('npc-book-missing-popup-template');

    const previewCode = wrapper.querySelector('#npc_book_popup_preview_code');
    if (previewCode) previewCode.textContent = previewName;

    const selectEl = /** @type {HTMLSelectElement | null} */ (wrapper.querySelector('#npc_book_popup_select'));
    if (selectEl && Array.isArray(world_names)) {
        for (const w of world_names) {
            const opt = document.createElement('option');
            opt.value = w;
            opt.textContent = w;
            selectEl.appendChild(opt);
        }
    }

    let resolvedValue = null;
    const popupInstance = new Popup(wrapper, POPUP_TYPE.TEXT, '', {
        wide: false,
        large: false,
        okButton: t('popup.cancel'),
    });

    wrapper.querySelector('#npc_book_popup_create')?.addEventListener('click', async () => {
        resolvedValue = await createAndBindChatLorebook();
        popupInstance.completeAffirmative();
    });

    wrapper.querySelector('#npc_book_popup_bind')?.addEventListener('click', async () => {
        const selected = selectEl?.value;
        if (!selected) {
            notify('warning', 'toast.select_lorebook_first');
            return;
        }
        chat_metadata[METADATA_KEY] = selected;
        await saveMetadata();
        await syncWorldInfoUi(selected);
        notify('success', 'toast.lorebook_bound', { name: selected });
        resolvedValue = selected;
        popupInstance.completeAffirmative();
    });

    wrapper.querySelector('#npc_book_popup_ignore')?.addEventListener('click', async () => {
        tracker.ignore_missing_lorebook = true;
        await saveMetadata();
        notify('info', 'toast.ignore_missing_chat');
        resolvedValue = null;
        popupInstance.completeAffirmative();
    });

    try {
        await popupInstance.show();
    } finally {
        isMissingPopupOpen = false;
    }

    return resolvedValue;
}