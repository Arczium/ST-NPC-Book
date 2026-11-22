import {
    eventSource,
    event_types,
    this_chid,
} from '../../../../script.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';

import {
    MODULE_NAME,
    settings,
    ensureStylesheetLoaded,
    loadSettings,
    loadLocales,
    loadTemplates,
    t,
    runtimeState,
} from './src/settings_loader.js';
import { getScheduleStatus, executeNpcScanSlice } from './src/scan_executor.js';
import { openNpcBookModal } from './src/settings_menu.js';

async function checkAndRunAutoScan() {
    if (
        !settings.extension_active ||
        this_chid === undefined ||
        runtimeState.isScanRunning ||
        runtimeState.isCatchUpRunning
    ) {
        return;
    }

    const status = getScheduleStatus();
    if (!status.isDue) return;

    await executeNpcScanSlice({
        customStart: status.sliceStart,
        customEnd: status.sliceEnd,
        manual: false,
    });
}

function registerSlashCommands() {
    if (!SlashCommandParser || !SlashCommand) return;
    try {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'npc-scan',
            callback: async (_args, value) => {
                const parts = String(value ?? '').trim().split(/\s+/).filter(Boolean);
                if (parts.length === 2 && !isNaN(Number(parts[0])) && !isNaN(Number(parts[1]))) {
                    await executeNpcScanSlice({
                        customStart: Number(parts[0]),
                        customEnd: Number(parts[1]),
                        manual: true,
                    });
                } else {
                    await executeNpcScanSlice({ manual: true });
                }
                return '';
            },
            helpString: 'Scans the next eligible message slice (or `/npc-scan <start> <end>`) and upserts [NPC] Lorebook entries.',
        }));
    } catch (err) {
        console.warn(`[${MODULE_NAME}] Could not register /npc-scan slash command:`, err);
    }
}

function registerExtensionsMenuButton() {
    if (document.getElementById('npc_book_wand_button')) return;

    const extensionsMenu = document.getElementById('extensionsMenu');
    if (!extensionsMenu) {
        console.warn(`[${MODULE_NAME}] #extensionsMenu not found in DOM.`);
        return;
    }

    const menuItem = document.createElement('div');
    menuItem.id = 'npc_book_wand_button';
    menuItem.className = 'list-group-item flex-container flexGap5 interactable';
    menuItem.tabIndex = 0;
    menuItem.setAttribute('data-i18n-title', 'wand.title');
    menuItem.title = t('wand.title');
    menuItem.innerHTML = `
        <div class="fa-solid fa-address-book extensionsMenuExtensionButton"></div>
        <span data-i18n="wand.label">${t('wand.label')}</span>
    `;

    menuItem.addEventListener('click', () => {
        openNpcBookModal();
    });

    extensionsMenu.appendChild(menuItem);
}

// Initialize Extension
jQuery(async () => {
    ensureStylesheetLoaded();
    await loadSettings();
    await Promise.all([loadLocales(), loadTemplates()]);
    registerExtensionsMenuButton();
    registerSlashCommands();

    // Only auto-trigger after a new AI message finishes rendering (never during CHAT_CHANGED loading!)
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => {
        setTimeout(checkAndRunAutoScan, 500);
    });

    console.log(`[${MODULE_NAME}] Initialized safely.`);
});