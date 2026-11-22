import { extension_settings } from '../../../../extensions.js';

export const MODULE_NAME = 'ST-NPC-Book';
export const SRC_FOLDER = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
export const EXTENSION_FOLDER = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
export const LOCALES_FOLDER = `${EXTENSION_FOLDER}/locales`;

/** @type {Record<string, any>} Raw defaults with `default_` prefix */
let settings_default = {};

/** @type {Record<string, any>} Clean active settings object without `default_` prefix */
export const settings = {};

/** @type {Document | null} Parsed templates.html document */
let templatesDoc = null;

/** @type {Array<{ code: string, name: string }>} Available languages from locales/languages.json */
export let availableLanguages = [
    { code: 'auto', name: 'Auto (SillyTavern UI)' },
    { code: 'en', name: 'English' },
];

/** @type {Record<string, any>} English fallback dictionary */
let fallbackLocale = {};

/** @type {Record<string, any>} Active language dictionary */
let activeLocale = {};

/**
 * Shared runtime state across executor, rollback, and settings UI modules.
 */
export const runtimeState = {
    /** @type {boolean} Prevents overlapping scan or rollback executions */
    isScanRunning: false,
    /** @type {boolean} Tracks active sequential catch-up loop */
    isCatchUpRunning: false,
    /** @type {boolean} Signals the sequential catch-up loop to stop after the active slice */
    stopCatchUpRequested: false,
    /** @type {(() => Promise<void>) | null} Optional UI callback when modal is open */
    activeModalRefreshFn: null,
};

/**
 * Resolves a dot-notation key (e.g. `modal.tab_schedule`) from a nested object.
 * @param {Record<string, any>} obj
 * @param {string} path
 * @returns {string | undefined}
 */
function getNestedString(obj, path) {
    if (!obj || !path) return undefined;
    const val = path.split('.').reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), obj);
    return typeof val === 'string' ? val : undefined;
}

/**
 * Detects SillyTavern's active language code or browser fallback (2-letter ISO code, e.g. 'de', 'en').
 * @returns {string}
 */
export function resolveTargetLanguageCode() {
    const preferred = String(settings.extension_language || 'auto').trim().toLowerCase();
    if (preferred && preferred !== 'auto') {
        return preferred.split(/[-_]/)[0];
    }

    const stLang =
        localStorage.getItem('language') ||
        document.documentElement.lang ||
        navigator.language ||
        'en';

    return String(stLang).trim().toLowerCase().split(/[-_]/)[0] || 'en';
}

/**
 * Translates a key using the active locale (falling back to `locales/en.json`),
 * interpolating `{{placeholder}}` variables.
 *
 * @param {string} key
 * @param {Record<string, string | number>} [vars]
 * @returns {string}
 */
export function t(key, vars = {}) {
    const raw = getNestedString(activeLocale, key) ?? getNestedString(fallbackLocale, key) ?? key;
    return String(raw).replace(/\{\{(\w+)\}\}/g, (match, varName) => {
        return vars[varName] !== undefined ? String(vars[varName]) : match;
    });
}

/**
 * Translates all elements with `data-i18n`, `data-i18n-html`, `data-i18n-title`,
 * or `data-i18n-placeholder` inside a DOM root.
 *
 * @param { HTMLElement | DocumentFragment } root
 */
export function applyI18n(root) {
    if (!root) return;

    root.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (key) el.textContent = t(key);
    });

    root.querySelectorAll('[data-i18n-html]').forEach(el => {
        const key = el.getAttribute('data-i18n-html');
        if (key) el.innerHTML = t(key);
    });

    root.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        if (key) el.setAttribute('title', t(key));
    });

    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (key) el.setAttribute('placeholder', t(key));
    });
}

/**
 * Loads `locales/languages.json`, `locales/en.json` (fallback), and the active `<lang>.json`.
 */
export async function loadLocales() {
    try {
        const langListRes = await fetch(`${LOCALES_FOLDER}/languages.json`);
        if (langListRes.ok) {
            const list = await langListRes.json();
            if (Array.isArray(list) && list.length > 0) {
                availableLanguages = list;
            }
        }
    } catch (err) {
        console.warn(`[${MODULE_NAME}] Could not load locales/languages.json:`, err);
    }

    try {
        const enRes = await fetch(`${LOCALES_FOLDER}/en.json`);
        if (enRes.ok) {
            fallbackLocale = await enRes.json();
        }
    } catch (err) {
        console.error(`[${MODULE_NAME}] Failed to load fallback locales/en.json:`, err);
        fallbackLocale = {};
    }

    await reloadActiveLocale();
}

/**
 * Loads or switches the active language dictionary based on `settings.extension_language`.
 */
export async function reloadActiveLocale() {
    const langCode = resolveTargetLanguageCode();
    if (langCode === 'en') {
        activeLocale = fallbackLocale;
        return;
    }

    try {
        const res = await fetch(`${LOCALES_FOLDER}/${langCode}.json`);
        if (res.ok) {
            activeLocale = await res.json();
        } else {
            activeLocale = fallbackLocale;
        }
    } catch {
        activeLocale = fallbackLocale;
    }
}

/**
 * Displays a toastr notification. Automatically translates `keyOrMessage` via `t()`.
 * Non-critical notifications ('info', 'success', 'warning') are suppressed when
 * `settings.extension_notification` is false. Critical errors ('error') are always displayed.
 *
 * @param {'info'|'success'|'warning'|'error'} level
 * @param {string} keyOrMessage
 * @param {Record<string, string | number>} [vars]
 */
export function notify(level, keyOrMessage, vars = {}) {
    if (level !== 'error' && !settings.extension_notification) {
        return;
    }
    const message = t(keyOrMessage, vars);
    if (typeof toastr?.[level] === 'function') {
        toastr[level](message, 'NPC-Book');
    }
}

export function setModalRefreshCallback(fn) {
    runtimeState.activeModalRefreshFn = fn;
}

export function triggerModalRefresh() {
    if (typeof runtimeState.activeModalRefreshFn === 'function') {
        runtimeState.activeModalRefreshFn().catch(err => {
            console.warn(`[${MODULE_NAME}] Modal refresh error:`, err);
        });
    }
}

export function ensureStylesheetLoaded() {
    const cssId = 'npc_book_stylesheet';
    if (document.getElementById(cssId)) return;
    const link = document.createElement('link');
    link.id = cssId;
    link.rel = 'stylesheet';
    link.type = 'text/css';
    link.href = `${EXTENSION_FOLDER}/style.css`;
    document.head.appendChild(link);
}

export async function loadSettings() {
    try {
        const response = await fetch(`${SRC_FOLDER}/settings_default.json`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} fetching src/settings_default.json`);
        }
        settings_default = await response.json();
    } catch (err) {
        console.error(`[${MODULE_NAME}] Failed to load src/settings_default.json:`, err);
        settings_default = {};
    }

    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = {};
    }
    const stored = extension_settings[MODULE_NAME];

    for (const [rawKey, defaultValue] of Object.entries(settings_default)) {
        const cleanKey = rawKey.replace(/^default_/, '');
        if (stored[cleanKey] === undefined) {
            stored[cleanKey] = structuredClone(defaultValue);
        }
    }

    for (const key of Object.keys(settings)) {
        delete settings[key];
    }
    for (const key of Object.keys(stored)) {
        Object.defineProperty(settings, key, {
            get() {
                return stored[key];
            },
            set(val) {
                stored[key] = val;
            },
            enumerable: true,
            configurable: true,
        });
    }
}

export async function loadTemplates() {
    try {
        const response = await fetch(`${SRC_FOLDER}/templates.html`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} fetching src/templates.html`);
        }
        const htmlText = await response.text();
        templatesDoc = new DOMParser().parseFromString(htmlText, 'text/html');
    } catch (err) {
        console.error(`[${MODULE_NAME}] Failed to load src/templates.html:`, err);
    }
}

export function cloneTemplate(templateId) {
    const tpl = /** @type {HTMLTemplateElement | null} */ (templatesDoc?.getElementById(templateId));
    if (!tpl) {
        throw new Error(`[${MODULE_NAME}] Template "#${templateId}" not found in src/templates.html`);
    }
    const cloned = /** @type {HTMLElement} */ (tpl.content.firstElementChild.cloneNode(true));
    applyI18n(cloned);
    return cloned;
}

export function getDefault(cleanKey) {
    return structuredClone(settings_default[`default_${cleanKey}`]);
}