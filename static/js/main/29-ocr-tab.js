// ============================================================
// main.js 分割ファイル (追加): OCRタブ（画像 → bbox・文字の検出、MOSS-Imageへのレイアウト連携）
// type="module" として読み込まれる。
// 主なトップレベル定義: initOcrTab
//
// 文字の検出は Ollama の OCR モデル（LightOnOCR-3 等）、コマ・キャラ・フキダシ等の検出は画像対応の汎用VLM。
// 純粋ロジック（プロンプト・パース・MOSS変換）は ../ocr-core.js。MOSS-Imageへは ../moss.js の importOcrItems で渡す。
// ============================================================

import { t } from '../i18n.js';
import { getBackendDefaultUrl } from '../auto-ai-client.js';
import { importOcrItems } from '../moss.js';
import { switchTab } from './01-state.js';
import {
    OCR_MODEL_DEFAULT, LAYOUT_MODEL_DEFAULT, OCR_CLASSES, OCR_CLASS_KEYS, VLM_CLASS_KEYS, OCR_PROMPT,
    buildLayoutPrompt, parseOcrOutput, parseLayoutOutput, mergeDetections, toMossItems, collectText, sortReading,
} from '../ocr-core.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'ccc_ocr_v1';
const SEND_MAX_SIDE = 1600;     // モデルへ送る画像の長辺（座標は正規化なので元解像度に影響しない）
const MIN_BOX = 0.01;           // 正規化座標でこれ未満のドラッグは追加しない
const TEXTY = new Set(['text', 'balloon', 'sfx', 'caption']);   // 本文を持つクラス（他は説明文 caption）

const O = {
    inited: false, busy: false,
    img: null,              // { url, w, h, b64 }
    boxes: [], selId: null, nextId: 1, scale: 1,
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const classLabel = (c) => t(`ocr.cls.${c}`);

// ─── 設定の保存・復元 ───
function loadSettings() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null') || {}; } catch (_) { return {}; }
}
function saveSettings() {
    try {
        const classes = [...document.querySelectorAll('[data-ocr-class]')].filter(el => el.checked).map(el => el.dataset.ocrClass);
        localStorage.setItem(STORE_KEY, JSON.stringify({
            url: $('ocr-url').value, ocrModel: $('ocr-model').value, layoutModel: $('ocr-layout-model').value,
            useLayout: $('ocr-use-layout').checked, classes, merge: $('ocr-merge-containers').checked,
        }));
    } catch (_) { /* ignore */ }
}

// ─── Ollama ───
const baseUrl = () => ($('ocr-url').value.trim() || getBackendDefaultUrl('ollama')).replace(/\/+$/, '');

async function ollamaChat(model, prompt, b64, numPredict) {
    const res = await fetch(`${baseUrl()}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model, stream: false, think: false,
            messages: [{ role: 'user', content: prompt, images: [b64] }],
            options: { temperature: 0, num_predict: numPredict },
        }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
    return (await res.json()).message?.content || '';
}

function fillModelSelect(el, names, preferred, patterns) {
    el.innerHTML = '';
    for (const n of names) { const o = document.createElement('option'); o.value = n; o.textContent = n; el.appendChild(o); }
    let pick = names.includes(preferred) ? preferred : null;
    for (const re of patterns) { if (!pick) pick = names.find(n => re.test(n)) || null; }
    if (pick) el.value = pick; else if (names.length) el.value = names[0];
}

async function loadModels(saved) {
    const label = $('ocr-status-label');
    try {
        const res = await fetch(`${baseUrl()}/api/tags`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const names = ((await res.json()).models || []).map(m => m.name);
        fillModelSelect($('ocr-model'), names, saved?.ocrModel || OCR_MODEL_DEFAULT, [/lighton/i, /ocr/i]);
        fillModelSelect($('ocr-layout-model'), names, saved?.layoutModel || LAYOUT_MODEL_DEFAULT,[/gemma|qwen.*vl|vl/i]);   // 既定は LAYOUT_MODEL_DEFAULT（gemma4:e4b）。保存値が無ければ名前から推定
        const ok = names.includes(OCR_MODEL_DEFAULT) || names.some(n => /ocr/i.test(n));
        label.textContent = ok ? t('ocr.statusReady') : t('ocr.statusNoModel');
        label.className = 'comfyui-status ' + (ok ? 'connected' : 'disconnected');
    } catch (e) {
        label.textContent = t('ocr.statusError');
        label.className = 'comfyui-status disconnected';
        console.warn('[ocr] model list failed', e);
    }
}

// ─── 画像 ───
function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
    });
}

async function loadImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const url = await fileToDataUrl(file);
    const im = new Image();
    await new Promise((resolve, reject) => { im.onload = resolve; im.onerror = () => reject(new Error('image load failed')); im.src = url; });
    // モデルへ送る用に長辺を縮小（透明部分は白で埋める）
    const k = Math.min(1, SEND_MAX_SIDE / Math.max(im.naturalWidth, im.naturalHeight));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(im.naturalWidth * k)); cv.height = Math.max(1, Math.round(im.naturalHeight * k));
    const cx = cv.getContext('2d');
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
    cx.drawImage(im, 0, 0, cv.width, cv.height);
    const b64 = cv.toDataURL('image/jpeg', 0.92).split(',')[1];
    O.img = { url, w: im.naturalWidth, h: im.naturalHeight, b64 };
    O.boxes = []; O.selId = null; O.nextId = 1;
    $('ocr-run-btn').disabled = false;
    $('ocr-progress').textContent = '';
    renderAll();
}

// ─── 描画 ───
function renderAll() { renderStage(); renderList(); updateButtons(); }

function updateButtons() {
    $('ocr-box-del-btn').disabled = !selBox();
    $('ocr-send-moss-btn').disabled = !O.boxes.length || !O.img;
    $('ocr-count').textContent = O.boxes.length ? `(${O.boxes.length})` : '';
}

const selBox = () => O.boxes.find(b => b.id === O.selId) || null;

function renderStage() {
    const stage = $('ocr-stage'), wrap = $('ocr-stage-wrap');
    stage.innerHTML = '';
    if (!O.img) {
        stage.style.width = ''; stage.style.height = '';
        const e = document.createElement('div'); e.className = 'ocr-empty'; e.textContent = t('ocr.empty'); stage.appendChild(e);
        return;
    }
    const maxW = Math.min(wrap.clientWidth || 560, 640), maxH = 680;
    O.scale = Math.min(maxW / O.img.w, maxH / O.img.h);
    const W = Math.round(O.img.w * O.scale), H = Math.round(O.img.h * O.scale);
    stage.style.width = `${W}px`; stage.style.height = `${H}px`;
    const img = document.createElement('img'); img.src = O.img.url; img.draggable = false; stage.appendChild(img);
    O.boxes.forEach((b, i) => {
        const el = document.createElement('div');
        el.className = 'ocr-box' + (b.id === O.selId ? ' selected' : '');
        el.dataset.id = b.id;
        el.style.setProperty('--ocr-c', OCR_CLASSES[b.cls]?.color || '#4caf50');
        el.title = `${classLabel(b.cls)}${b.text ? `: ${b.text}` : b.caption ? `: ${b.caption}` : ''}`;
        const badge = document.createElement('span'); badge.className = 'ocr-badge'; badge.textContent = String(i + 1);
        el.appendChild(badge);
        for (const h of ['nw', 'ne', 'sw', 'se']) { const hd = document.createElement('div'); hd.className = 'ocr-handle'; hd.dataset.h = h; el.appendChild(hd); }
        placeBox(el, b);
        stage.appendChild(el);
    });
}

function placeBox(el, b) {
    el.style.left = `${b.x1 * 100}%`; el.style.top = `${b.y1 * 100}%`;
    el.style.width = `${(b.x2 - b.x1) * 100}%`; el.style.height = `${(b.y2 - b.y1) * 100}%`;
}

function renderList() {
    const list = $('ocr-list');
    list.innerHTML = '';
    O.boxes.forEach((b, i) => {
        const row = document.createElement('div');
        row.className = 'ocr-row' + (b.id === O.selId ? ' selected' : '');
        row.style.setProperty('--ocr-c', OCR_CLASSES[b.cls]?.color || '#4caf50');
        row.dataset.id = b.id;
        const no = document.createElement('span'); no.className = 'ocr-no'; no.textContent = String(i + 1);
        const sel = document.createElement('select');
        for (const c of OCR_CLASS_KEYS) { const o = document.createElement('option'); o.value = c; o.textContent = classLabel(c); sel.appendChild(o); }
        sel.value = b.cls;
        sel.addEventListener('change', () => { b.cls = sel.value; O.selId = b.id; renderAll(); });
        const ta = document.createElement('textarea');
        ta.rows = 2;
        const field = () => (TEXTY.has(b.cls) ? 'text' : 'caption');
        ta.value = b[field()] || '';
        ta.placeholder = TEXTY.has(b.cls) ? t('ocr.textPlaceholder') : t('ocr.captionPlaceholder');
        ta.addEventListener('input', () => { b[field()] = ta.value; saveSettings(); });
        ta.addEventListener('focus', () => { if (O.selId !== b.id) { O.selId = b.id; markSelected(); } });
        row.append(no, sel, ta);
        row.addEventListener('pointerdown', (e) => { if (e.target === row || e.target === no) { O.selId = b.id; markSelected(); } });
        list.appendChild(row);
    });
}

// 全体を作り直さずに選択表示だけ更新する（入力中のテキスト欄のフォーカスを保つ）
function markSelected() {
    document.querySelectorAll('#ocr-stage .ocr-box').forEach(el => el.classList.toggle('selected', Number(el.dataset.id) === O.selId));
    document.querySelectorAll('#ocr-list .ocr-row').forEach(el => el.classList.toggle('selected', Number(el.dataset.id) === O.selId));
    updateButtons();
}

// ─── ステージ操作（描画・移動・拡縮） ───
function stagePoint(e) {
    const r = $('ocr-stage').getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
}

function initStageInteraction() {
    const stage = $('ocr-stage');
    let drag = null;
    stage.addEventListener('pointerdown', (e) => {
        if (!O.img || e.button !== 0) return;
        const p = stagePoint(e);
        const handle = e.target.closest?.('.ocr-handle');
        const boxEl = e.target.closest?.('.ocr-box');
        const b = boxEl ? O.boxes.find(x => x.id === Number(boxEl.dataset.id)) : null;
        stage.setPointerCapture(e.pointerId);
        if (b && handle) {
            drag = { mode: 'resize', h: handle.dataset.h, b, el: boxEl };
        } else if (b) {
            O.selId = b.id; markSelected();
            drag = { mode: 'move', b, el: boxEl, dx: p.x - b.x1, dy: p.y - b.y1 };
        } else {
            drag = { mode: 'draw', x0: p.x, y0: p.y, cls: $('ocr-draw-class').value, ghost: null };
        }
        e.preventDefault();
    });
    stage.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const p = stagePoint(e);
        if (drag.mode === 'move') {
            const b = drag.b, w = b.x2 - b.x1, h = b.y2 - b.y1;
            b.x1 = Math.min(1 - w, Math.max(0, p.x - drag.dx)); b.y1 = Math.min(1 - h, Math.max(0, p.y - drag.dy));
            b.x2 = b.x1 + w; b.y2 = b.y1 + h;
            placeBox(drag.el, b);
        } else if (drag.mode === 'resize') {
            const b = drag.b;
            if (drag.h.includes('w')) b.x1 = Math.min(p.x, b.x2 - MIN_BOX); else b.x2 = Math.max(p.x, b.x1 + MIN_BOX);
            if (drag.h.includes('n')) b.y1 = Math.min(p.y, b.y2 - MIN_BOX); else b.y2 = Math.max(p.y, b.y1 + MIN_BOX);
            placeBox(drag.el, b);
        } else {
            if (!drag.ghost) { drag.ghost = document.createElement('div'); drag.ghost.className = 'ocr-box'; drag.ghost.style.setProperty('--ocr-c', OCR_CLASSES[drag.cls]?.color); drag.ghost.style.pointerEvents = 'none'; stage.appendChild(drag.ghost); }
            placeBox(drag.ghost, { x1: Math.min(drag.x0, p.x), y1: Math.min(drag.y0, p.y), x2: Math.max(drag.x0, p.x), y2: Math.max(drag.y0, p.y) });
        }
    });
    const end = (e) => {
        if (!drag) return;
        const d = drag; drag = null;
        if (d.mode === 'draw') {
            d.ghost?.remove();
            const p = stagePoint(e);
            const x1 = Math.min(d.x0, p.x), x2 = Math.max(d.x0, p.x), y1 = Math.min(d.y0, p.y), y2 = Math.max(d.y0, p.y);
            if (x2 - x1 >= MIN_BOX && y2 - y1 >= MIN_BOX) {
                const b = { id: O.nextId++, cls: d.cls, x1, y1, x2, y2, text: '', caption: '', src: 'manual' };
                O.boxes.push(b); O.selId = b.id;
                renderAll();
            } else if (O.selId) { O.selId = null; markSelected(); }
        } else if (d.mode === 'resize') {
            renderAll();
        }
        saveSettings();
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);

    // 画像の読み込み: ドロップ・貼り付け
    stage.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('dragover'); });
    stage.addEventListener('dragleave', () => stage.classList.remove('dragover'));
    stage.addEventListener('drop', (e) => {
        e.preventDefault(); stage.classList.remove('dragover');
        const f = [...(e.dataTransfer?.files || [])].find(x => x.type.startsWith('image/'));
        if (f) loadImageFile(f).catch(err => alert(err.message));
    });
    document.addEventListener('paste', (e) => {
        if (!$('ocr-tab')?.classList.contains('active')) return;
        const f = [...(e.clipboardData?.files || [])].find(x => x.type.startsWith('image/'));
        if (f) { e.preventDefault(); loadImageFile(f).catch(err => alert(err.message)); }
    });
    document.addEventListener('keydown', (e) => {
        if (!$('ocr-tab')?.classList.contains('active') || e.key !== 'Delete') return;
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return;
        deleteSelected();
    });
}

function deleteSelected() {
    if (!selBox()) return;
    O.boxes = O.boxes.filter(b => b.id !== O.selId);
    O.selId = null;
    renderAll();
}

// ─── 検出の実行 ───
function selectedLayoutClasses() {
    return VLM_CLASS_KEYS.filter(c => document.querySelector(`[data-ocr-class="${c}"]`)?.checked);
}

async function onRun() {
    if (O.busy || !O.img) return;
    if (O.boxes.length && !confirm(t('ocr.confirmReplace'))) return;
    const prog = $('ocr-progress');
    O.busy = true; $('ocr-run-btn').disabled = true;
    const started = Date.now();
    try {
        prog.textContent = t('ocr.progressOcr');
        const ocrRaw = await ollamaChat($('ocr-model').value, OCR_PROMPT, O.img.b64, 4096);
        const ocrBoxes = parseOcrOutput(ocrRaw);
        let vlmBoxes = [];
        const classes = selectedLayoutClasses();
        if ($('ocr-use-layout').checked && classes.length) {
            prog.textContent = t('ocr.progressLayout');
            const raw = await ollamaChat($('ocr-layout-model').value, buildLayoutPrompt(classes), O.img.b64, 4096);
            vlmBoxes = parseLayoutOutput(raw, O.img.w, O.img.h).filter(b => classes.includes(b.cls));
        }
        O.boxes = mergeDetections(ocrBoxes, vlmBoxes).map(b => ({ ...b, id: O.nextId++ }));
        O.selId = null;
        renderAll();
        prog.textContent = t('ocr.done', O.boxes.length, ((Date.now() - started) / 1000).toFixed(1));
    } catch (e) {
        console.warn('[ocr] run failed', e);
        prog.textContent = t('ocr.errRun', e.message || String(e));
    } finally {
        O.busy = false; $('ocr-run-btn').disabled = !O.img;
    }
}

// ─── 出力 ───
async function copyText(text, okKey) {
    try { await navigator.clipboard.writeText(text); $('ocr-progress').textContent = t(okKey); }
    catch (_) { $('ocr-progress').textContent = t('ocr.copyFailed'); }
}

function boxesAsJson() {
    const { w, h } = O.img || { w: 0, h: 0 };
    return JSON.stringify({
        image: { width: w, height: h },
        boxes: sortReading(O.boxes).map(b => ({
            class: b.cls, text: b.text || undefined, caption: b.caption || undefined,
            bbox: [Math.round(b.x1 * w), Math.round(b.y1 * h), Math.round(b.x2 * w), Math.round(b.y2 * h)],
            bbox_norm: [b.x1, b.y1, b.x2, b.y2].map(v => Math.round(v * 1000) / 1000),
        })),
    }, null, 2);
}

async function onSendMoss() {
    if (!O.img || !O.boxes.length) return;
    const aspect = O.img.w / O.img.h;
    const items = toMossItems(O.boxes, { aspect, useContainers: $('ocr-merge-containers').checked });
    if (!items.length) { alert(t('ocr.noItems')); return; }
    await switchTab('moss');                       // MOSS側の初期化（保存済みレイアウトの復元）を先に済ませる
    const n = await importOcrItems(items, { aspect });
    const msg = document.getElementById('moss-progress-text');
    if (msg) msg.textContent = t('ocr.sent', n);
}

// ─── 初期化 ───
async function initOcrTabOnce() {
    const saved = loadSettings();
    $('ocr-url').value = saved.url || getBackendDefaultUrl('ollama');
    const drawSel = $('ocr-draw-class');
    for (const c of OCR_CLASS_KEYS) { const o = document.createElement('option'); o.value = c; o.textContent = classLabel(c); drawSel.appendChild(o); }
    if (Array.isArray(saved.classes)) {
        document.querySelectorAll('[data-ocr-class]').forEach(el => { el.checked = saved.classes.includes(el.dataset.ocrClass); });
    }
    if (saved.useLayout === false) $('ocr-use-layout').checked = false;
    if (saved.merge === false) $('ocr-merge-containers').checked = false;

    initStageInteraction();
    $('ocr-open-btn').addEventListener('click', () => $('ocr-file').click());
    $('ocr-file').addEventListener('change', () => {
        const f = $('ocr-file').files?.[0]; $('ocr-file').value = '';
        if (f) loadImageFile(f).catch(err => alert(err.message));
    });
    $('ocr-box-del-btn').addEventListener('click', deleteSelected);
    $('ocr-box-clear-btn').addEventListener('click', () => {
        if (!O.boxes.length || !confirm(t('ocr.confirmClear'))) return;
        O.boxes = []; O.selId = null; renderAll();
    });
    $('ocr-run-btn').addEventListener('click', onRun);
    $('ocr-reload-models-btn').addEventListener('click', () => loadModels(loadSettings()));
    $('ocr-copy-text-btn').addEventListener('click', () => copyText(collectText(O.boxes), 'ocr.copied'));
    $('ocr-copy-json-btn').addEventListener('click', () => copyText(boxesAsJson(), 'ocr.copied'));
    $('ocr-send-moss-btn').addEventListener('click', onSendMoss);
    for (const id of ['ocr-url', 'ocr-model', 'ocr-layout-model', 'ocr-use-layout', 'ocr-merge-containers']) $(id).addEventListener('change', saveSettings);
    document.querySelectorAll('[data-ocr-class]').forEach(el => el.addEventListener('change', saveSettings));
    $('ocr-url').addEventListener('change', () => loadModels(loadSettings()));
    window.addEventListener('resize', () => { if ($('ocr-tab')?.classList.contains('active')) renderStage(); });

    renderAll();
    await loadModels(saved);
}

export function initOcrTab() {
    if (O.inited) { renderStage(); return; }
    O.inited = true;
    initOcrTabOnce();
}
