// vram-prepare.js — 画像生成の前に Ollama のモデルをアンロードして空き VRAM を作る
//
// ComfyUI-LiveChatStream の vram_prepare を移植したもの。実処理はサーバー（py/ccc.py の
// /api/ccc/vram/prepare）が行う。空き VRAM は ComfyUI の値ではなく nvidia-smi の実測で判定する
// （ComfyUI の空きは Ollama のロード/アンロードに反応しないことがあるため）。
//
// ・設定（設定タブ「VRAM調整」）: mode = 'off' | 'auto' | 'all'、targetGb（auto の目標空き GB）
// ・対象の Ollama: 既定の 127.0.0.1:11434（サーバー側で常に追加）＋ Auto タブのローカル LLM（Ollama のとき）
//   ＋意思決定モデル（Workflow Studio と共有の設定が Ollama のとき）。ローカルホストのみ
// ・Workflow Studio 経由の生成（T2I / I2I / Inpaint / Outpaint）の直前に prepareVramForGeneration() を呼ぶ。
//   失敗しても生成は止めない

import { t } from './i18n.js';
import { loadAiSettings, getBackendDefaultUrl } from './auto-ai-client.js';
import { getDecisionSettings } from './decision-client.js';

const SETTINGS_KEY = 'ccc_vram_settings';
const DEFAULT_SETTINGS = Object.freeze({ mode: 'off', targetGb: 8 });

export function getVramSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
        const merged = { ...DEFAULT_SETTINGS, ...(saved && typeof saved === 'object' ? saved : {}) };
        if (!['off', 'auto', 'all'].includes(merged.mode)) merged.mode = DEFAULT_SETTINGS.mode;
        const gb = Number(merged.targetGb);
        merged.targetGb = gb >= 0 && gb <= 64 ? gb : DEFAULT_SETTINGS.targetGb;
        return merged;
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

export function saveVramSettings(patch) {
    const next = { ...getVramSettings(), ...patch };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* 保存できなくても動作は継続 */ }
    return next;
}

/** サーバーが接続できるローカルホスト宛ての URL か（LAN 上の Ollama 等はサーバー側で拒否されるため除く） */
export function isLoopbackUrl(url) {
    try {
        return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(url).hostname);
    } catch {
        return false;
    }
}

// 設定済みの Ollama の URL（重複・既定 URL はサーバー側でまとめる）
function collectOllamaUrls() {
    const urls = [];
    const ai = loadAiSettings();
    if (ai.backend === 'ollama') urls.push(ai.backendUrl || getBackendDefaultUrl('ollama'));
    const dec = getDecisionSettings();
    if (dec.backend === 'ollama' && dec.baseUrl) urls.push(dec.baseUrl);
    return urls;
}

/** サーバーへ VRAM 調整を依頼する。mode: 'auto' | 'all'。extraUrls は未保存の画面上の URL など。戻り値はサーバーの結果（失敗時は throw） */
export async function requestVramPrepare(mode, targetGb = getVramSettings().targetGb, extraUrls = []) {
    const res = await fetch('/api/ccc/vram/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, target_gb: targetGb, urls: [...collectOllamaUrls(), ...extraUrls].filter(isLoopbackUrl) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.status !== 'ok') throw new Error(data.message || `HTTP ${res.status}`);
    return data;
}

const gb = (mb) => (mb / 1024).toFixed(1);

/** 結果を1行の文に（設定タブの状態表示・生成前の通知で共通） */
export function describeVramResult(d) {
    if (d.unloaded.length) {
        let msg = t('vram.unloaded', d.unloaded.map((u) => u.name).join(', '), gb(d.free_before_mb), gb(d.free_after_mb));
        if (d.failed.length) msg += ' / ' + t('vram.failedModels', d.failed.join(', '));
        return msg;
    }
    if (d.failed.length) return t('vram.failedModels', d.failed.join(', '));
    if (d.unreachable?.length) return t('vram.unreachable', d.unreachable.map((u) => u.url).join(', '));
    if (d.mode === 'auto') return d.reached ? t('vram.enough', gb(d.free_after_mb), d.target_gb) : t('vram.short', gb(d.free_after_mb), d.target_gb);
    return t('vram.nothingLoaded', gb(d.free_after_mb));
}

// 生成の前に出す短い通知（各生成元のUIはまちまちなので、ここで画面右下に出す）
let _noticeTimer = 0;
function showNotice(text, isWarn) {
    let el = document.getElementById('ccc-vram-notice');
    if (!el) {
        el = document.createElement('div');
        el.id = 'ccc-vram-notice';
        el.style.cssText = 'position:fixed; right:16px; bottom:16px; z-index:100000; max-width:min(480px,calc(100vw - 32px));' +
            'padding:8px 12px; border-radius:6px; font-size:12px; color:#fff; box-shadow:0 2px 10px rgba(0,0,0,.5); pointer-events:none;';
        document.body.appendChild(el);
    }
    el.style.background = isWarn ? '#7a4a12' : '#2a4a2a';
    el.textContent = text;
    el.style.display = '';
    clearTimeout(_noticeTimer);
    _noticeTimer = setTimeout(() => { el.style.display = 'none'; }, 6000);
}

// ---- 設定タブ「VRAM調整」カード ----
let _settingsInited = false;

export function initVramSettings() {
    const modeSel = document.getElementById('settings-vram-mode');
    const targetInput = document.getElementById('settings-vram-target');
    const unloadBtn = document.getElementById('settings-vram-unload-btn');
    const statusEl = document.getElementById('settings-vram-status');
    if (!modeSel || !targetInput) return;
    const s = getVramSettings();
    modeSel.value = s.mode;
    targetInput.value = s.targetGb;
    targetInput.disabled = s.mode !== 'auto';
    if (_settingsInited) return;
    _settingsInited = true;

    const setStatus = (text, color) => { if (statusEl) { statusEl.textContent = text; statusEl.style.color = color || '#888'; } };
    modeSel.addEventListener('change', () => {
        saveVramSettings({ mode: modeSel.value });
        targetInput.disabled = modeSel.value !== 'auto';
        _lastShortNote = '';
    });
    targetInput.addEventListener('change', () => {
        const v = Math.min(Math.max(parseFloat(targetInput.value) || 0, 0), 64);
        targetInput.value = v;
        saveVramSettings({ targetGb: v });
        _lastShortNote = '';
    });
    unloadBtn?.addEventListener('click', async () => {
        unloadBtn.disabled = true;
        setStatus(t('vram.unloading'));
        try {
            const d = await requestVramPrepare('all');
            setStatus(describeVramResult(d), d.failed.length ? '#e0a040' : '#6c6');
        } catch (e) {
            setStatus(t('vram.prepareFailed', e.message || String(e)), '#e66');
        } finally {
            unloadBtn.disabled = false;
        }
    });
}

let _lastShortNote = '';

/**
 * 画像生成の直前に呼ぶ。設定が off なら何もしない。失敗しても throw しない（生成は続ける）。
 * 何かアンロードしたとき・目標に届かないとき・失敗したときだけ通知する（連続生成で同じ警告は繰り返さない）。
 */
export async function prepareVramForGeneration() {
    const settings = getVramSettings();
    if (settings.mode === 'off') return null;
    try {
        const d = await requestVramPrepare(settings.mode, settings.targetGb);
        const short = d.mode === 'auto' && !d.reached;
        if (d.unloaded.length || d.failed.length) {
            showNotice('🧹 ' + describeVramResult(d), d.failed.length > 0 || short);
            _lastShortNote = '';
        } else if (short) {
            const note = describeVramResult(d);
            if (note !== _lastShortNote) { _lastShortNote = note; showNotice('⚠ ' + note, true); }
        }
        return d;
    } catch (e) {
        console.warn('[vram] prepare failed:', e);
        showNotice('⚠ ' + t('vram.prepareFailed', e.message || String(e)), true);
        return null;
    }
}
