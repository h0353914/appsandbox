/* App Sandbox - UI localisation
 *
 * English source strings double as the lookup keys: t('Some text') returns the
 * translation for the active language, or the key itself when no translation
 * exists, so a missing entry degrades to English instead of breaking the UI.
 * Placeholders use {name} and are filled from the params object.
 *
 * Static markup is translated through attributes (the English text in the HTML
 * is the key):
 *   data-i18n                 -> element text
 *   data-i18n-title           -> title attribute
 *   data-i18n-placeholder     -> placeholder attribute
 *   data-i18n-aria-label      -> aria-label attribute
 *
 * Each language lives in its own file, web/lang/<code>.js, which calls
 * registerLanguage({ code, name, strings, native }). To add a language, copy
 * lang/zh-TW.js, translate it, and add a <script> tag for it in index.html
 * (after i18n.js, before app.js).
 *
 * Messages from the native host (log lines, alerts, install status) arrive as
 * already-formatted English text. tn() translates them by matching them
 * against the language's `native` table, whose keys are the host's printf
 * format strings.
 */
'use strict';

var LANGUAGES = [];      /* [{ code, name }] in registration order */
var TRANSLATIONS = {};   /* code -> UI string table */
var NATIVE = {};         /* code -> { key: translation } */
var nativeCache = {};    /* code -> compiled matcher, built on first use */
var currentLang = 'en';

function registerLanguage(def) {
    LANGUAGES.push({ code: def.code, name: def.name });
    TRANSLATIONS[def.code] = def.strings || {};
    NATIVE[def.code] = def.native || {};
}

function normalizeLanguage(code) {
    if (!code) return null;
    for (var i = 0; i < LANGUAGES.length; i++)
        if (LANGUAGES[i].code === code) return code;
    return null;
}

/* Best match for the OS/browser language. Every Chinese variant except
 * Simplified (zh-CN / zh-Hans / zh-SG) maps to Traditional Chinese. */
function detectLanguage() {
    var prefs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || 'en'];
    for (var i = 0; i < prefs.length; i++) {
        var l = String(prefs[i]).toLowerCase();
        if (l.indexOf('zh') === 0 && !/hans|-cn|-sg/.test(l) && normalizeLanguage('zh-TW')) return 'zh-TW';
        if (l.indexOf('en') === 0) return 'en';
    }
    return 'en';
}

function t(key, params) {
    var dict = TRANSLATIONS[currentLang];
    var text = (dict && Object.prototype.hasOwnProperty.call(dict, key)) ? dict[key] : key;
    if (params) {
        text = text.replace(/\{(\w+)\}/g, function(m, name) {
            return Object.prototype.hasOwnProperty.call(params, name) ? params[name] : m;
        });
    }
    return text;
}

/* ---- Native host messages ---- */

/* One printf conversion: %s %S %ls %hs %d %lu %llu %08X %.256s %.*hs %@ ...
 * (or the literal "%%"). */
var PRINTF_SPEC = /%(?:%|[-+ #0]*(?:\d+|\*)?(?:\.(?:\d+|\*))?(?:hh|h|ll|l|I64|z|j|t|w)?[a-zA-Z@])/g;

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* Turn a printf format into { re, literal } where each conversion becomes a
 * capture group; `literal` is the number of fixed characters, used to try the
 * most specific formats first. */
function compileFormat(fmt) {
    var re = '', literal = 0, groups = 0, last = 0, m;
    PRINTF_SPEC.lastIndex = 0;
    while ((m = PRINTF_SPEC.exec(fmt))) {
        var fixed = fmt.slice(last, m.index);
        re += escapeRegExp(fixed);
        literal += fixed.length;
        if (m[0] === '%%') { re += '%'; literal++; }
        else { re += '([\\s\\S]*?)'; groups++; }
        last = m.index + m[0].length;
    }
    var tail = fmt.slice(last);
    re += escapeRegExp(tail);
    literal += tail.length;
    return { re: new RegExp('^' + re + '$'), literal: literal, groups: groups };
}

function compileNative(code) {
    var table = NATIVE[code] || {};
    var exact = Object.create(null), patterns = [];
    Object.keys(table).forEach(function(fmt) {
        var c = compileFormat(fmt);
        if (c.groups === 0) exact[fmt.replace(/%%/g, '%')] = table[fmt];
        else patterns.push({ re: c.re, literal: c.literal, text: table[fmt] });
    });
    patterns.sort(function(a, b) { return b.literal - a.literal; });
    return { exact: exact, patterns: patterns };
}

/* Translate a message produced by the native host. Unknown messages are
 * returned unchanged. */
function tn(msg) {
    if (typeof msg !== 'string' || !msg || currentLang === 'en') return msg;
    var m = nativeCache[currentLang] || (nativeCache[currentLang] = compileNative(currentLang));
    if (Object.prototype.hasOwnProperty.call(m.exact, msg)) return m.exact[msg];
    for (var i = 0; i < m.patterns.length; i++) {
        var hit = m.patterns[i].re.exec(msg);
        if (hit) return m.patterns[i].text.replace(/\{(\d+)\}/g, function(x, n) {
            return hit[n] !== undefined ? hit[n] : x;
        });
    }
    return msg;
}

/* ---- Static markup ---- */

/* Translate one attribute family. The first pass records the English source
 * text in a data-* attribute so the element can be translated back later. */
function applyAttr(selector, attr, store) {
    document.querySelectorAll(selector).forEach(function(el) {
        if (!(store in el.dataset)) el.dataset[store] = attr === 'text' ? el.textContent.trim() : el.getAttribute(attr);
        var text = t(el.dataset[store]);
        if (attr === 'text') el.textContent = text;
        else el.setAttribute(attr, text);
    });
}

function applyI18n() {
    document.documentElement.lang = currentLang;
    applyAttr('[data-i18n]', 'text', 'i18nSrc');
    applyAttr('[data-i18n-title]', 'title', 'i18nTitleSrc');
    applyAttr('[data-i18n-placeholder]', 'placeholder', 'i18nPlaceholderSrc');
    applyAttr('[data-i18n-aria-label]', 'aria-label', 'i18nAriaSrc');
}

function populateLanguageSelect() {
    var sel = document.getElementById('lang-select');
    if (!sel) return;
    sel.textContent = '';
    LANGUAGES.forEach(function(lang) {
        var opt = document.createElement('option');
        opt.value = lang.code;
        opt.textContent = lang.name;   /* endonym, never translated */
        sel.appendChild(opt);
    });
    sel.value = currentLang;
}

function setLanguage(code) {
    code = normalizeLanguage(code) || 'en';
    currentLang = code;
    try { localStorage.setItem('lang', code); } catch (e) { /* storage unavailable */ }
    applyI18n();
    var sel = document.getElementById('lang-select');
    if (sel) sel.value = code;
    if (typeof window.onLanguageChanged === 'function') window.onLanguageChanged();
}

/* Called once, by app.js, after every language file has registered itself. */
function initI18n() {
    var saved = null;
    try { saved = localStorage.getItem('lang'); } catch (e) { /* storage unavailable */ }
    currentLang = normalizeLanguage(saved) || detectLanguage();
    populateLanguageSelect();
    applyI18n();
}
