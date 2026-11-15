// prompt-translate.js — 日本語などで書いたプロンプトを Workflow Studio の翻訳API（PLaMo 3 Translate）で訳す
//
// 翻訳そのものは Workflow Studio（WFS v0.9.10 以降）が同じ ComfyUI サーバーに出している API を相対URLで呼ぶ:
//   GET  /api/wfm/translate/config  … 使えるか（WFS が無い／古いと 404、または api が無い）・WFS の翻訳設定
//   POST /api/wfm/translate/prompt  … 記法（カンマ・(word:1.2)・<lora:...> 等）を残し、母語の部分だけを訳す
//   POST /api/wfm/translate/warmup  … CPU常駐モードのときモデルを先に読み込む
// モデル・Ollama の URL・GPU／CPU常駐は WFS の設定を共有し、CC では変えない。
// CC 側が持つのは「使う」「生成時に自動で訳す」「MOSS-Image の翻訳先の言語」だけ（設定タブ「プロンプト翻訳」）。
// WFS の static/js/prompt-translate.js は app.js を巻き込む（WFS の初期化が走る）ので import しない。
//
// 対象: Auto タブの画像プロンプト・オートレイアウトのコマの画像プロンプト（エンジンがローカルのときだけ。
// Gemini は日本語をそのまま理解する）、MOSS-Image のプロンプトと caption（レイアウトの text＝画像に描く文字は訳さない）。
// 「」『』“”"" の中は訳さない（protect_quotes。看板の文字などを残す）。

import { t } from './i18n.js';

const SETTINGS_KEY = 'ccc_prompt_translate';
// enabled: null = 未設定（WFS の「プロンプト翻訳」のオン／オフに合わせる）
const DEFAULT_SETTINGS = Object.freeze({ enabled: null, auto: true, mossLang: 'en' });
export const MOSS_LANGS = ['en', 'zh-hans'];

// ─── 設定 ───
export function getTranslateSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
        const s = { ...DEFAULT_SETTINGS, ...(saved && typeof saved === 'object' ? saved : {}) };
        if (s.enabled !== null) s.enabled = !!s.enabled;
        s.auto = !!s.auto;
        if (!MOSS_LANGS.includes(s.mossLang)) s.mossLang = DEFAULT_SETTINGS.mossLang;
        return s;
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

export function saveTranslateSettings(patch) {
    const next = { ...getTranslateSettings(), ...patch };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* 保存できなくても動作は継続 */ }
    refreshTranslateButtons();
    return next;
}

// ─── WFS の翻訳APIが使えるか ───
let _info = null;          // { available, api, config, languages }
let _infoPromise = null;

export function loadTranslateInfo(force = false) {
    if (_info && !force) return Promise.resolve(_info);
    if (!_infoPromise || force) {
        _infoPromise = fetch('/api/wfm/translate/config')
            .then(async (r) => {
                const d = r.ok ? await r.json().catch(() => ({})) : {};
                // api が無い = v0.9.9（記法を保護する API・target_lang が無い）。使わない
                const api = Number(d.api) || 0;
                return { available: api >= 1, api, config: d.config || {}, languages: d.languages || {} };
            })
            .catch(() => ({ available: false, api: 0, config: {}, languages: {} }))
            .then((info) => { _info = info; refreshTranslateButtons(); return info; })
            .finally(() => { _infoPromise = null; });
    }
    return _infoPromise;
}

export function getTranslateInfo() {
    return _info;
}

/** 「使う」の実効値（未設定なら WFS のオン／オフ） */
export function isTranslateEnabledSetting() {
    const s = getTranslateSettings();
    return s.enabled === null ? !!_info?.config?.prompt_translate_enabled : s.enabled;
}

/** 翻訳を使える状態か（WFS の API があり、CC の設定でオン） */
export function isTranslateOn() {
    return !!_info?.available && isTranslateEnabledSetting();
}

export function mossTargetLang() {
    return getTranslateSettings().mossLang;
}

// ─── 翻訳 ───
// 呼ぶ前の軽い判定: ASCII 以外の文字が1つでもあるか。実際にどこを訳すかはサーバーが決める
const NON_ASCII_LETTER_RE = /(?![\x00-\x7F])\p{L}/u;
export function needsTranslation(text) {
    return NON_ASCII_LETTER_RE.test(text || '');
}

/**
 * 複数の文をまとめて訳す（同じ順で返す）。訳す部分が無い文はそのまま返す。失敗したら throw。
 * targetLang: 'en' | 'zh-hans' など PLaMo の言語コード
 */
export async function translateTexts(texts, { targetLang = 'en', protectQuotes = true } = {}) {
    const idx = [];
    texts.forEach((x, i) => { if (needsTranslation(x)) idx.push(i); });
    if (!idx.length) return texts.slice();
    warmup();
    const res = await fetch('/api/wfm/translate/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: idx.map((i) => texts[i]), target_lang: targetLang, protect_quotes: protectQuotes }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.status !== 'success') throw new Error(data.message || `HTTP ${res.status}`);
    const out = texts.slice();
    idx.forEach((i, k) => { out[i] = data.translations?.[k] ?? texts[i]; });
    return out;
}

/**
 * 生成の直前に呼ぶ。翻訳がオンで「生成時に自動で翻訳する」もオンのときだけ訳し、そうでなければそのまま返す。
 * 送る文だけを訳す（入力欄の文は書き換えない）。失敗したら throw する（訳さずに生成しない。WFS と同じ方針）。
 * onStart: 実際に訳すときに一度だけ呼ばれる（進行表示用）
 */
export async function autoTranslateTexts(texts, { targetLang = 'en', onStart } = {}) {
    if (!texts.some(needsTranslation)) return texts.slice();
    await loadTranslateInfo();
    if (!isTranslateOn() || !getTranslateSettings().auto) return texts.slice();
    onStart?.();
    try {
        return await translateTexts(texts, { targetLang });
    } catch (e) {
        throw new Error(t('pt.failed', e.message || String(e)));
    }
}

// CPU常駐モード: 最初に翻訳ボタンのある欄を触ったときに一度だけ読み込みを始める（初回の約4秒の待ちを減らす）。
// サーバーは CPU常駐モード以外では何もしない
let _warmedUp = false;
function warmup() {
    if (_warmedUp || !isTranslateOn() || _info.config.prompt_translate_device !== 'cpu') return;
    _warmedUp = true;
    fetch('/api/wfm/translate/warmup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ignore_enabled: true }),
    }).catch(() => {});
}

// ─── 入力欄の🌐ボタン ───
const _buttons = [];               // { ta, wrap, restore, opts }
const _history = new WeakMap();    // textarea -> { original, translated }（「原文」ボタン用）

// 入力欄の文を置き換える。できればブラウザの Ctrl+Z の履歴に残す。input イベントで各タブの保存処理を動かす
function setTextareaValue(ta, value) {
    ta.focus();
    ta.select();
    let ok = false;
    try { ok = document.execCommand('insertText', false, value); } catch { ok = false; }
    if (!ok || ta.value !== value) ta.value = value;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
}

function updateRestore(entry) {
    const h = _history.get(entry.ta);
    entry.restore.style.display = h && entry.ta.value === h.translated ? '' : 'none';
}

/**
 * textarea の直後に🌐（翻訳）と「原文」のボタンを置く。
 * opts.targetLang(): 翻訳先、opts.visible(): 表示する条件（エンジンがローカルのときだけ等）
 */
export function attachTranslateButton(ta, opts = {}) {
    if (!ta || ta.dataset.ptAttached) return;
    ta.dataset.ptAttached = '1';
    const wrap = document.createElement('div');
    wrap.className = 'ccc-pt-row';
    wrap.style.cssText = 'display:none; align-items:center; gap:6px; margin-top:3px; flex-wrap:wrap;';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn small secondary';
    btn.textContent = '🌐';
    btn.dataset.i18nTitle = 'pt.btnTitle';
    btn.title = t('pt.btnTitle');
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'btn small secondary';
    restore.dataset.i18n = 'pt.restore';
    restore.dataset.i18nTitle = 'pt.restoreTitle';
    restore.textContent = t('pt.restore');
    restore.title = t('pt.restoreTitle');
    restore.style.display = 'none';
    const status = document.createElement('span');
    status.style.cssText = 'font-size:11px; color:#888;';
    wrap.append(btn, restore, status);
    ta.insertAdjacentElement('afterend', wrap);
    const entry = { ta, wrap, restore, opts };
    _buttons.push(entry);

    let statusTimer = 0;
    const showStatus = (text, color) => {
        status.textContent = text;
        status.style.color = color || '#888';
        clearTimeout(statusTimer);
        if (text) statusTimer = setTimeout(() => { status.textContent = ''; }, 6000);
    };
    btn.addEventListener('click', async () => {
        const original = ta.value;
        if (!needsTranslation(original)) { showStatus(t('pt.nothing')); return; }
        btn.disabled = true;
        btn.textContent = '…';
        showStatus('');
        try {
            const [translated] = await translateTexts([original], { targetLang: opts.targetLang?.() || 'en' });
            if (translated === original) { showStatus(t('pt.nothing')); return; }
            setTextareaValue(ta, translated);
            _history.set(ta, { original, translated });
            updateRestore(entry);
        } catch (e) {
            showStatus(t('pt.errorBtn', e.message || String(e)), '#e66');
        } finally {
            btn.disabled = false;
            btn.textContent = '🌐';
        }
    });
    restore.addEventListener('click', () => {
        const h = _history.get(ta);
        if (h && ta.value === h.translated) setTextareaValue(ta, h.original);
        _history.delete(ta);
        updateRestore(entry);
    });
    ta.addEventListener('input', () => updateRestore(entry));
    ta.addEventListener('focus', warmup);
    refreshEntry(entry);
}

function refreshEntry(entry) {
    const show = isTranslateOn() && (entry.opts.visible ? entry.opts.visible() : true);
    entry.wrap.style.display = show ? 'flex' : 'none';
    updateRestore(entry);
}

/** 表示条件が変わったとき（設定の変更・画像生成エンジンの切り替え・入力欄の中身の差し替え）に呼ぶ */
export function refreshTranslateButtons() {
    for (let i = _buttons.length - 1; i >= 0; i--) {
        if (!_buttons[i].ta.isConnected) { _buttons.splice(i, 1); continue; }   // 作り直された一覧（MOSSのコマ一覧）の欄
        refreshEntry(_buttons[i]);
    }
}

// ─── 設定タブ「プロンプト翻訳」 ───
let _settingsInited = false;

function renderSettingsStatus() {
    const el = document.getElementById('settings-pt-status');
    if (!el) return;
    if (!_info) { el.textContent = t('pt.checking'); el.style.color = '#888'; return; }
    if (!_info.available) { el.textContent = t('pt.statusMissing'); el.style.color = '#e0a040'; return; }
    const c = _info.config;
    const device = c.prompt_translate_device === 'cpu' ? t('pt.deviceCpu') : t('pt.deviceGpu');
    el.textContent = t('pt.statusOk', c.prompt_translate_model || '?', device);
    el.style.color = '#6c6';
}

export function initPromptTranslateSettings() {
    const enabledCb = document.getElementById('settings-pt-enabled');
    const autoCb = document.getElementById('settings-pt-auto');
    const langSel = document.getElementById('settings-pt-moss-lang');
    if (!enabledCb || !autoCb || !langSel) return;
    const sync = () => {
        const s = getTranslateSettings();
        enabledCb.checked = isTranslateEnabledSetting();
        autoCb.checked = s.auto;
        langSel.value = s.mossLang;
        const usable = !!_info?.available;
        for (const el of [enabledCb, autoCb, langSel]) el.disabled = !usable;
        autoCb.disabled = langSel.disabled = !usable || !enabledCb.checked;
        renderSettingsStatus();
    };
    sync();
    loadTranslateInfo(true).then(sync);   // 開くたびに確認し直す（WFS の設定・導入状況が変わっていることがある）
    if (_settingsInited) return;
    _settingsInited = true;
    enabledCb.addEventListener('change', () => { saveTranslateSettings({ enabled: enabledCb.checked }); sync(); });
    autoCb.addEventListener('change', () => saveTranslateSettings({ auto: autoCb.checked }));
    langSel.addEventListener('change', () => saveTranslateSettings({ mossLang: langSel.value }));
}

// 起動時に一度だけ確認する（ボタンの表示判定に使う）
loadTranslateInfo();
