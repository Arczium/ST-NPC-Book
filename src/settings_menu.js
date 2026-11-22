import {
    chat_metadata,
    saveSettingsDebounced,
    saveMetadata,
} from '../../../../../script.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../popup.js';
import { world_names, METADATA_KEY } from '../../../../world-info.js';

import {
    settings,
    getDefault,
    cloneTemplate,
    notify,
    t,
    applyI18n,
    availableLanguages,
    reloadActiveLocale,
    runtimeState,
    setModalRefreshCallback,
} from './settings_loader.js';
import { getConnectionProfiles } from './connection_manager.js';
import { createAndBindChatLorebook, syncWorldInfoUi } from './lorebook_create.js';
import { getExistingNpcEntries } from './lorebook_editor.js';
import {
    getScheduleStatus,
    executeNpcScanSlice,
    runCatchUpLoop,
} from './scan_executor.js';
import {
    undoLastSlice,
    rerollLastSlice,
    wipeNpcsAndReset,
} from './scan_rollback.js';

function formatSnapshotSummary(snap) {
    if (!snap) return t('modal.snapshot_none');
    const createdLen = Array.isArray(snap.created_uids) ? snap.created_uids.length : 0;
    const updatedLen = Array.isArray(snap.updated_entries) ? snap.updated_entries.length : 0;
    return t('modal.snapshot_summary', {
        prev: snap.previous_cursor,
        next: snap.new_cursor,
        created: createdLen,
        updated: updatedLen,
    });
}

export async function openNpcBookModal() {
    const modalRoot = cloneTemplate('npc-book-modal-template');
    const profiles = getConnectionProfiles();
    const currentLorebook = chat_metadata ? (chat_metadata[METADATA_KEY] || '') : '';

    // Populate Language Selector from locales/languages.json
    const langSelect = /** @type {HTMLSelectElement | null} */ (modalRoot.querySelector('#npc_book_language_select'));
    if (langSelect) {
        for (const lang of availableLanguages) {
            const opt = document.createElement('option');
            opt.value = lang.code;
            opt.textContent = lang.name;
            langSelect.appendChild(opt);
        }
    }

    const boundSelect = /** @type {HTMLSelectElement | null} */ (modalRoot.querySelector('#npc_book_bound_lorebook'));
    if (boundSelect) {
        const noneOpt = document.createElement('option');
        noneOpt.value = '';
        noneOpt.setAttribute('data-i18n', 'modal.none_bound');
        noneOpt.textContent = t('modal.none_bound');
        boundSelect.appendChild(noneOpt);

        for (const w of (world_names || [])) {
            const opt = document.createElement('option');
            opt.value = w;
            opt.textContent = w;
            if (w === currentLorebook) opt.selected = true;
            boundSelect.appendChild(opt);
        }
    }

    for (const profileKey of ['agent_scanner_profile', 'agent_scribe_profile']) {
        const selectEl = /** @type {HTMLSelectElement | null} */ (modalRoot.querySelector(`select[data-setting="${profileKey}"]`));
        if (!selectEl) continue;

        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.setAttribute('data-i18n', 'modal.default_api_profile');
        defaultOpt.textContent = t('modal.default_api_profile');
        selectEl.appendChild(defaultOpt);

        for (const p of profiles) {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            selectEl.appendChild(opt);
        }
    }

    modalRoot.querySelectorAll('[data-setting]').forEach(el => {
        const key = el.getAttribute('data-setting');
        const val = settings[key];
        if (el instanceof HTMLInputElement && el.type === 'checkbox') {
            el.checked = Boolean(val);
        } else if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
            el.value = String(val ?? '');
        }
    });

    const inchatRow = modalRoot.querySelector('#npc_book_inchat_row');
    if (inchatRow instanceof HTMLElement) {
        inchatRow.style.display = Number(settings.entry_position) === 4 ? 'grid' : 'none';
    }

    await bindModalEvents(modalRoot);

    try {
        await callGenericPopup(modalRoot, POPUP_TYPE.TEXT, '', {
            wide: true,
            large: true,
            okButton: t('modal.close'),
        });
    } finally {
        setModalRefreshCallback(null);
    }
}

async function bindModalEvents(root) {
    const boundSelect = /** @type {HTMLSelectElement | null} */ (root.querySelector('#npc_book_bound_lorebook'));

    const syncBoundDropdown = () => {
        const activeLorebook = chat_metadata ? (chat_metadata[METADATA_KEY] || '') : '';
        if (boundSelect && activeLorebook) {
            if (![...boundSelect.options].some(o => o.value === activeLorebook)) {
                const opt = document.createElement('option');
                opt.value = activeLorebook;
                opt.textContent = activeLorebook;
                boundSelect.appendChild(opt);
            }
            boundSelect.value = activeLorebook;
        }
    };

    const refreshStatusBanner = async () => {
        syncBoundDropdown();
        const status = getScheduleStatus();
        const activeLorebook = chat_metadata ? (chat_metadata[METADATA_KEY] || '') : '';
        const tracked = activeLorebook ? await getExistingNpcEntries(activeLorebook) : [];

        const pill = root.querySelector('#npc_book_status_pill');
        if (pill) {
            pill.textContent = t('modal.status_pill', {
                summary: status.summary,
                tracked: tracked.length,
            });
        }

        const cursorDisplay = root.querySelector('#npc_book_cursor_display');
        if (cursorDisplay) {
            cursorDisplay.textContent = t('modal.cursor_display', {
                last: status.lastScanned,
                total: status.totalMessages,
                ceiling: status.eligibleCeiling,
            });
        }

        const snapshotDisplay = root.querySelector('#npc_book_snapshot_display');
        if (snapshotDisplay) {
            snapshotDisplay.textContent = formatSnapshotSummary(status.snapshot);
        }

        const busy = runtimeState.isScanRunning || runtimeState.isCatchUpRunning;
        const hasSnapshot = Boolean(status.snapshot);

        const scanNowBtn = /** @type {HTMLButtonElement | null} */ (root.querySelector('#npc_book_scan_now_btn'));
        const catchUpBtn = /** @type {HTMLButtonElement | null} */ (root.querySelector('#npc_book_catchup_btn'));
        const undoBtn = /** @type {HTMLButtonElement | null} */ (root.querySelector('#npc_book_undo_btn'));
        const rerollBtn = /** @type {HTMLButtonElement | null} */ (root.querySelector('#npc_book_reroll_btn'));
        const wipeBtn = /** @type {HTMLButtonElement | null} */ (root.querySelector('#npc_book_wipe_btn'));

        if (scanNowBtn) scanNowBtn.disabled = busy;
        if (undoBtn) undoBtn.disabled = !hasSnapshot || busy;
        if (rerollBtn) rerollBtn.disabled = !hasSnapshot || busy;
        if (wipeBtn) wipeBtn.disabled = busy;

        if (catchUpBtn) {
            if (runtimeState.isCatchUpRunning) {
                catchUpBtn.disabled = runtimeState.stopCatchUpRequested;
                catchUpBtn.classList.add('npc-book-stop-btn');
                catchUpBtn.innerHTML = runtimeState.stopCatchUpRequested
                    ? `<i class="fa-solid fa-hourglass-half"></i> <span>${t('modal.btn_catchup_stopping')}</span>`
                    : `<i class="fa-solid fa-hand"></i> <span>${t('modal.btn_catchup_stop', { count: status.catchUpSlicesCount })}</span>`;
            } else {
                catchUpBtn.classList.remove('npc-book-stop-btn');
                catchUpBtn.disabled = runtimeState.isScanRunning || status.catchUpSlicesCount <= 0;
                catchUpBtn.innerHTML = status.catchUpSlicesCount > 0
                    ? `<i class="fa-solid fa-forward-fast"></i> <span>${t('modal.btn_catchup_all', { count: status.catchUpSlicesCount })}</span>`
                    : `<i class="fa-solid fa-check"></i> <span>${t('modal.btn_catchup_done')}</span>`;
            }
        }
    };

    setModalRefreshCallback(refreshStatusBanner);

    const tabBtns = root.querySelectorAll('.npc-book-tab-btn');
    const tabPanels = root.querySelectorAll('.npc-book-tab-panel');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-tab');
            tabBtns.forEach(b => b.classList.toggle('active', b === btn));
            tabPanels.forEach(panel => panel.classList.toggle('active', panel.id === targetId));
        });
    });

    root.querySelectorAll('[data-setting]').forEach(el => {
        const key = el.getAttribute('data-setting');
        const forceType = el.getAttribute('data-type');

        el.addEventListener('change', async () => {
            if (el instanceof HTMLInputElement && el.type === 'checkbox') {
                settings[key] = el.checked;
            } else if ((el instanceof HTMLInputElement && el.type === 'number') || forceType === 'number') {
                settings[key] = Number(el.value);
            } else if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
                settings[key] = el.value;
            }

            if (key === 'extension_language') {
                await reloadActiveLocale();
                applyI18n(root);
                const wandBtn = document.getElementById('npc_book_wand_button');
                if (wandBtn) applyI18n(wandBtn);
                await refreshStatusBanner();
            }

            if (key === 'entry_position') {
                const inchatRow = root.querySelector('#npc_book_inchat_row');
                if (inchatRow instanceof HTMLElement) {
                    inchatRow.style.display = Number(settings.entry_position) === 4 ? 'grid' : 'none';
                }
            }

            if (key === 'trigger_message_interval' || key === 'trigger_message_offset' || key === 'entry_title_template') {
                refreshStatusBanner();
            }

            saveSettingsDebounced();
        });
    });

    root.querySelectorAll('.npc-book-reset-prompt').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.getAttribute('data-reset-key');
            const defaultVal = getDefault(key);
            if (defaultVal !== undefined) {
                settings[key] = defaultVal;
                const textarea = root.querySelector(`textarea[data-setting="${key}"]`);
                if (textarea instanceof HTMLTextAreaElement) {
                    textarea.value = defaultVal;
                }
                saveSettingsDebounced();
                notify('info', 'toast.prompt_reset', { key });
            }
        });
    });

    boundSelect?.addEventListener('change', async () => {
        if (!chat_metadata) return;
        const val = boundSelect.value;
        if (val) {
            chat_metadata[METADATA_KEY] = val;
            notify('success', 'toast.lorebook_bound', { name: val });
        } else {
            delete chat_metadata[METADATA_KEY];
            notify('info', 'toast.lorebook_unbound');
        }
        await saveMetadata();
        await syncWorldInfoUi(val);
        await refreshStatusBanner();
    });

    root.querySelector('#npc_book_create_lorebook_btn')?.addEventListener('click', async () => {
        const createdName = await createAndBindChatLorebook();
        if (createdName && boundSelect) {
            const opt = document.createElement('option');
            opt.value = createdName;
            opt.textContent = createdName;
            opt.selected = true;
            boundSelect.appendChild(opt);
            await refreshStatusBanner();
        }
    });

    root.querySelector('#npc_book_scan_now_btn')?.addEventListener('click', async () => {
        await executeNpcScanSlice({ manual: true });
    });

    root.querySelector('#npc_book_catchup_btn')?.addEventListener('click', async () => {
        await runCatchUpLoop();
    });

    root.querySelector('#npc_book_undo_btn')?.addEventListener('click', async () => {
        await undoLastSlice();
    });

    root.querySelector('#npc_book_reroll_btn')?.addEventListener('click', async () => {
        await rerollLastSlice();
    });

    root.querySelector('#npc_book_wipe_btn')?.addEventListener('click', async () => {
        await wipeNpcsAndReset();
    });

    await refreshStatusBanner();
}