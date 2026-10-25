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
import { prepareVramForGeneration, getVramSettings } from '../vram-prepare.js';
import {
    OCR_MODEL_DEFAULT, LAYOUT_MODEL_DEFAULT, OCR_CLASSES, OCR_CLASS_KEYS, VLM_CLASS_KEYS, OCR_PROMPT,
    buildLayoutPrompt, parseOcrOutput, parseLayoutOutput, mergeDetections, toMossItems, collectText, sortReading,
    pickRereadModel, rereadPrompt, rereadScale, cropRect, normalizeJaPunct,
    DECIDE_QUESTIONS, pickDecisionModel, parseDecision, applyDecision, OVERALL_PROMPT, cleanOverall, ocrLooksFailed,
    OCR_MODE_PRESETS, MODE_QUESTIONS, MODE_MIN_PROB, modeByAspect, parseModeAnswer, tileRects, mapTileBoxes, dedupeTileBoxes,
} from '../ocr-core.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'ccc_ocr_v1';
const COLLAPSE_KEY = 'ccc_ocr_models_open';
const MODE_COLLAPSE_KEY = 'ccc_ocr_mode_open';
const SEND_MAX_SIDE = 1600;     // モデルへ送る画像の長辺（座標は正規化なので元解像度に影響しない）
const MIN_BOX = 0.01;           // 正規化座標でこれ未満のドラッグは追加しない
const TEXTY = new Set(['text', 'balloon', 'sfx', 'caption']);   // 本文を持つクラス（他は説明文 caption）

const O = {
    inited: false, busy: false, applyingPreset: false,
    img: null,              // { url, w, h, b64 }
    boxes: [], selId: null, nextId: 1, scale: 1,
    multi: new Set(),       // Shift+クリックで追加した選択（selId以外）。移動・削除はselId+multi全体が対象
};
const isSel = (id) => id === O.selId || O.multi.has(id);
const selIds = () => O.boxes.map(b => b.id).filter(isSel);

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
            useReread: $('ocr-use-reread').checked, rereadModel: $('ocr-reread-model').value,
            mode: $('ocr-mode').value, useOcr: $('ocr-use-ocr').checked, preprocess: $('ocr-preprocess').value, useOverall: $('ocr-use-overall').checked, useDecide: $('ocr-use-decide').checked, decideModel: $('ocr-decide-model').value,
        }));
    } catch (_) { /* ignore */ }
}

// ─── Ollama ───
const baseUrl = () => ($('ocr-url').value.trim() || getBackendDefaultUrl('ollama')).replace(/\/+$/, '');

async function ollamaChat(model, prompt, b64, numPredict, retry = true) {
    const res = await fetch(`${baseUrl()}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model, stream: false, think: false,
            messages: [{ role: 'user', content: prompt, images: [b64] }],
            options: { temperature: 0, num_predict: numPredict },
        }),
    });
    if (res.status === 500 && retry) {   // モデルの入れ替え直後などでランナーが一時的に落ちることがある。1回だけやり直す
        await new Promise(r => setTimeout(r, 800));
        return ollamaChat(model, prompt, b64, numPredict, false);
    }
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
        const tagsJson = res.json();
        const names = ((await tagsJson).models || []).map(m => m.name);
        fillModelSelect($('ocr-model'), names, saved?.ocrModel || OCR_MODEL_DEFAULT, [/lighton/i, /ocr/i]);
        fillModelSelect($('ocr-layout-model'), names, saved?.layoutModel || LAYOUT_MODEL_DEFAULT,[/gemma|qwen.*vl|vl/i]);   // 既定は LAYOUT_MODEL_DEFAULT（gemma4:e4b）。保存値が無ければ名前から推定
        const rereadDefault = pickRereadModel(names);
        fillModelSelect($('ocr-reread-model'), names, saved?.rereadModel || rereadDefault, []);
        if (!rereadDefault && saved?.useReread === undefined) $('ocr-use-reread').checked = false;   // 向いたモデルが無いときは既定オフ
        const decNames = ((await tagsJson).models || []).filter(m => (m.capabilities || []).includes('decision') && (m.capabilities || []).includes('vision')).map(m => m.name);
        fillModelSelect($('ocr-decide-model'), decNames, saved?.decideModel || pickDecisionModel(decNames), []);
        if (!decNames.length) $('ocr-use-decide').checked = false;
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
/** モデルへ送る画像のグレースケール版（base64 JPEG）。必要になったときだけ作って O.img に保存する */
function grayB64() {
    if (O.img.b64Gray) return O.img.b64Gray;
    const src = new Image();
    return new Promise((resolve, reject) => {
        src.onload = () => {
            const cv = document.createElement('canvas');
            cv.width = src.naturalWidth; cv.height = src.naturalHeight;
            const cx = cv.getContext('2d');
            cx.drawImage(src, 0, 0);
            const d = cx.getImageData(0, 0, cv.width, cv.height), p = d.data;
            for (let i = 0; i < p.length; i += 4) { const y = (p[i] * 299 + p[i + 1] * 587 + p[i + 2] * 114) / 1000; p[i] = p[i + 1] = p[i + 2] = y; }
            cx.putImageData(d, 0, 0);
            O.img.b64Gray = cv.toDataURL('image/jpeg', 0.92).split(',')[1];
            resolve(O.img.b64Gray);
        };
        src.onerror = () => reject(new Error('gray image failed'));
        src.src = `data:image/jpeg;base64,${O.img.b64}`;
    });
}

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
    O.img = { url, w: im.naturalWidth, h: im.naturalHeight, b64, el: im };
    O.boxes = []; O.selId = null; O.multi.clear(); O.nextId = 1;
    $('ocr-overall').value = '';
    $('ocr-run-btn').disabled = false;
    $('ocr-progress').textContent = '';
    renderAll();
}

// ─── 描画 ───
function renderAll() { renderStage(); renderList(); updateButtons(); }

function updateButtons() {
    $('ocr-box-del-btn').disabled = !selBox();
    $('ocr-box-reread-btn').disabled = !selBox() || !TEXTY.has(selBox().cls) || O.busy;
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
        el.className = 'ocr-box' + (isSel(b.id) ? ' selected' : '');
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
        row.className = 'ocr-row' + (isSel(b.id) ? ' selected' : '');
        row.style.setProperty('--ocr-c', OCR_CLASSES[b.cls]?.color || '#4caf50');
        row.dataset.id = b.id;
        const no = document.createElement('span'); no.className = 'ocr-no'; no.textContent = String(i + 1);
        const sel = document.createElement('select');
        for (const c of OCR_CLASS_KEYS) { const o = document.createElement('option'); o.value = c; o.textContent = classLabel(c); sel.appendChild(o); }
        sel.value = b.cls;
        sel.addEventListener('change', () => { b.cls = sel.value; O.selId = b.id; O.multi.clear(); renderAll(); });
        const ta = document.createElement('textarea');
        ta.rows = 2;
        const field = () => (TEXTY.has(b.cls) ? 'text' : 'caption');
        ta.value = b[field()] || '';
        ta.placeholder = TEXTY.has(b.cls) ? t('ocr.textPlaceholder') : t('ocr.captionPlaceholder');
        ta.addEventListener('input', () => { b[field()] = ta.value; saveSettings(); });
        ta.addEventListener('focus', () => { if (O.selId !== b.id || O.multi.size) { O.selId = b.id; O.multi.clear(); markSelected(); } });
        row.append(no, sel, ta);
        row.addEventListener('pointerdown', (e) => {
            if (e.target !== row && e.target !== no) return;
            if (e.shiftKey) toggleMulti(b.id); else { O.selId = b.id; O.multi.clear(); }
            markSelected();
        });
        list.appendChild(row);
    });
}

// 全体を作り直さずに選択表示だけ更新する（入力中のテキスト欄のフォーカスを保つ）
function markSelected() {
    document.querySelectorAll('#ocr-stage .ocr-box').forEach(el => el.classList.toggle('selected', isSel(Number(el.dataset.id))));
    document.querySelectorAll('#ocr-list .ocr-row').forEach(el => el.classList.toggle('selected', isSel(Number(el.dataset.id))));
    updateButtons();
}

// Shift+クリック: 選択集合への追加／除外
function toggleMulti(id) {
    if (isSel(id)) {
        if (id === O.selId) O.selId = O.multi.size ? O.multi.values().next().value : null;
        if (O.selId !== null) O.multi.delete(O.selId);
        O.multi.delete(id);
    } else {
        if (O.selId === null) O.selId = id; else O.multi.add(id);
    }
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
        } else if (b && e.shiftKey) {
            toggleMulti(b.id); markSelected();
            drag = null;
        } else if (b) {
            if (!isSel(b.id) || !O.multi.size) { O.selId = b.id; O.multi.clear(); }
            markSelected();
            const items = selIds().map(id => {
                const sb = O.boxes.find(x => x.id === id);
                return { b: sb, el: stage.querySelector(`.ocr-box[data-id="${id}"]`), x1: sb.x1, y1: sb.y1, x2: sb.x2, y2: sb.y2 };
            });
            drag = { mode: 'move', items, x0: p.x, y0: p.y };
        } else {
            drag = { mode: 'draw', x0: p.x, y0: p.y, cls: $('ocr-draw-class').value, ghost: null };
        }
        e.preventDefault();
    });
    stage.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const p = stagePoint(e);
        if (drag.mode === 'move') {
            // グループ全体の外接矩形が画像内に収まるよう移動量を制限
            const it = drag.items;
            const minX = Math.min(...it.map(i => i.x1)), maxX = Math.max(...it.map(i => i.x2));
            const minY = Math.min(...it.map(i => i.y1)), maxY = Math.max(...it.map(i => i.y2));
            const dx = Math.min(1 - maxX, Math.max(-minX, p.x - drag.x0)), dy = Math.min(1 - maxY, Math.max(-minY, p.y - drag.y0));
            for (const i of it) {
                i.b.x1 = i.x1 + dx; i.b.x2 = i.x2 + dx; i.b.y1 = i.y1 + dy; i.b.y2 = i.y2 + dy;
                if (i.el) placeBox(i.el, i.b);
            }
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
                O.boxes.push(b); O.selId = b.id; O.multi.clear();
                renderAll();
            } else if (O.selId !== null && !e.shiftKey) { O.selId = null; O.multi.clear(); markSelected(); }
        } else if (d.mode === 'resize') {
            renderAll();
        }
        saveSettings();
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);

    // 画像の読み込み: ドロップ・貼り付け
    // ドロップはタブ全体で受ける（枠の外に落とすとブラウザが画像を別タブで開いてしまうため）
    const tab = $('ocr-tab');
    tab.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('dragover'); });
    tab.addEventListener('dragleave', (e) => { if (!tab.contains(e.relatedTarget)) stage.classList.remove('dragover'); });
    tab.addEventListener('drop', async (e) => {
        e.preventDefault(); stage.classList.remove('dragover');
        try {
            const dt = e.dataTransfer;
            let f = [...(dt?.files || [])].find(x => x.type.startsWith('image/'));
            if (!f) {   // 別タブの画像などはファイルではなくURLで渡ってくる
                const url = (dt?.getData('text/uri-list') || dt?.getData('text/plain') || '').split('\n')[0].trim();
                if (/^(https?:|data:image\/|blob:)/.test(url)) {
                    const blob = await (await fetch(url)).blob();
                    if (blob.type.startsWith('image/')) f = new File([blob], 'dropped', { type: blob.type });
                }
            }
            if (f) await loadImageFile(f);
        } catch (err) { $('ocr-progress').textContent = t('ocr.errDrop', err.message || String(err)); }
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
    O.boxes = O.boxes.filter(b => !isSel(b.id));
    O.selId = null; O.multi.clear();
    renderAll();
}

// ─── 検出の実行 ───
function selectedLayoutClasses() {
    return VLM_CLASS_KEYS.filter(c => document.querySelector(`[data-ocr-class="${c}"]`)?.checked);
}

// ─── 切り抜き再OCR ───
// 文字枠を元画像から切り抜き、別モデルで読み直す。LightOnOCR系だけ、極小の切り抜きを2倍にする（ocr-core.js の rereadScale）
function cropForModel(box, model) {
    const r = cropRect(box, O.img.w, O.img.h);
    const k = rereadScale(model, r.sw, r.sh);
    const cv = document.createElement('canvas');
    cv.width = Math.round(r.sw * k); cv.height = Math.round(r.sh * k);
    const cx = cv.getContext('2d');
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(O.img.el, r.sx, r.sy, r.sw, r.sh, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/png').split(',')[1];
}

/** 1枠を読み直す。空の結果は null（元の文字を残す） */
async function rereadBox(box, model) {
    const out = normalizeJaPunct(await ollamaChat(model, rereadPrompt(model), cropForModel(box, model), 512));
    return out || null;
}

async function rereadAll(prog) {
    const model = $('ocr-reread-model').value;
    const targets = O.boxes.filter(b => b.cls === 'text');
    let done = 0, failed = 0;
    for (const b of targets) {
        prog.textContent = t('ocr.progressReread', ++done, targets.length);
        try {
            const text = await rereadBox(b, model);
            if (text) { b.textOrig = b.text; b.text = text; }
        } catch (e) {
            console.warn('[ocr] reread failed', e);
            if (++failed >= 2) throw new Error(t('ocr.errReread', e.message || String(e)));   // モデル未導入などで全滅するときは打ち切る
        }
    }
}

// ─── 意思決定モデルによる判定（任意） ───
async function systemOne(b64, model, questions, retry = true) {
    const res = await fetch(`${baseUrl()}/v1/systemone`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, state: 'The image to judge.', questions, images: [b64] }),
    });
    if (!res.ok && retry && res.status >= 500) {   // VRAMの入れ替え直後などで落ちることがある。少し待って1回だけやり直す
        await new Promise(r => setTimeout(r, 4000));
        return systemOne(b64, model, questions, false);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
    return (await res.json()).answers;
}

const decideCrop = async (b64, model) => parseDecision(await systemOne(b64, model, DECIDE_QUESTIONS));

/** OCRの文字枠のクラス判定と、VLM容器枠のうち文字が無いものの除去。戻り値: { changed, dropped } */
async function decideAll(prog) {
    const model = $('ocr-decide-model').value;
    const targets = O.boxes.filter(b => (b.src === 'ocr' && b.cls === 'text') || (b.src === 'vlm' && OCR_CLASSES[b.cls]?.container));
    const drop = new Set();
    let done = 0, failed = 0, changed = 0;
    for (const b of targets) {
        prog.textContent = t('ocr.progressDecide', ++done, targets.length);
        try {
            const r = applyDecision(b, await decideCrop(cropForModel(b, model), model));
            if (r === 'drop') drop.add(b.id); else if (r === 'changed') changed++;
        } catch (e) {
            console.warn('[ocr] decide failed', e);
            if (++failed >= 2) throw new Error(t('ocr.errDecide', e.message || String(e)));   // モデル未導入などで全滅するときは打ち切る
        }
    }
    if (drop.size) O.boxes = O.boxes.filter(b => !drop.has(b.id));
    return { changed, dropped: drop.size };
}

// ─── 全体プロンプト（VLM） ───
async function makeOverall(prog) {
    prog.textContent = t('ocr.progressOverall');
    const text = cleanOverall(await ollamaChat($('ocr-layout-model').value, OVERALL_PROMPT, O.img.b64, 512));
    if (!text) throw new Error(t('ocr.errOverallEmpty'));
    $('ocr-overall').value = text;
}

async function onOverallBtn() {
    if (O.busy || !O.img) return;
    O.busy = true; updateButtons();
    const prog = $('ocr-progress');
    try { await makeOverall(prog); prog.textContent = t('ocr.overallDone'); }
    catch (e) { prog.textContent = t('ocr.errOverall', e.message || String(e)); }
    finally { O.busy = false; updateButtons(); }
}

async function onRereadSelected() {
    const b = selBox();
    if (!b || O.busy || !O.img) return;
    O.busy = true; updateButtons();
    const prog = $('ocr-progress');
    try {
        prog.textContent = t('ocr.progressReread', 1, 1);
        const text = await rereadBox(b, $('ocr-reread-model').value);
        if (text) { b.textOrig = b.text; b.text = text; renderList(); }
        prog.textContent = t('ocr.rereadDone');
    } catch (e) {
        prog.textContent = t('ocr.errRun', e.message || String(e));
    } finally {
        O.busy = false; updateButtons();
    }
}

/** 設定タブ「VRAM調整」を実行する（off なら何もしない）。OCRタブで使うOllama（画面上のURL）も対象に含める。失敗しても検出は続ける */
async function prepareVram(prog) {
    if (getVramSettings().mode === 'off') return;
    prog.textContent = t('ocr.progressVram');
    await prepareVramForGeneration([baseUrl()]);
}

// ─── モード（用途別プリセット） ───
const MODE_CHECKS = { ocr: 'ocr-use-ocr', layout: 'ocr-use-layout', merge: 'ocr-merge-containers', reread: 'ocr-use-reread', decide: 'ocr-use-decide', overall: 'ocr-use-overall' };

function updateModeHint() { $('ocr-mode-hint').textContent = t(`ocr.modeHint.${$('ocr-mode').value}`); }

/** プリセットを個別設定へ反映する。読み直し・判定は、使えるモデルが無ければオンにしない。change イベントは出さない（手動変更と区別するため） */
function applyPreset(mode) {
    const p = OCR_MODE_PRESETS[mode];
    if (!p) return;
    O.applyingPreset = true;
    try {
        for (const [k, id] of Object.entries(MODE_CHECKS)) {
            if (p[k] === null || p[k] === undefined) continue;
            let v = !!p[k];
            if (k === 'reread' && !$('ocr-reread-model').value) v = false;
            if (k === 'decide' && !$('ocr-decide-model').value) v = false;
            $(id).checked = v;
        }
        if (p.classes) document.querySelectorAll('[data-ocr-class]').forEach(el => { el.checked = p.classes.includes(el.dataset.ocrClass); });
        if (p.preprocess) $('ocr-preprocess').value = p.preprocess;
    } finally { O.applyingPreset = false; }
    saveSettings();
}

/** 縮小画像（長辺512）のbase64 JPEG。モード判定用 */
function thumbB64() {
    const k = Math.min(1, 512 / Math.max(O.img.w, O.img.h));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(O.img.w * k)); cv.height = Math.max(1, Math.round(O.img.h * k));
    const cx = cv.getContext('2d');
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
    cx.drawImage(O.img.el, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', 0.85).split(',')[1];
}

/** 実行するモードを決める。自動なら縦横比→意思決定モデルの順で選び、プリセットを反映する。戻り値は有効なモード（custom含む） */
async function resolveMode(prog) {
    const sel = $('ocr-mode').value;
    if (sel !== 'auto') return sel;
    prog.textContent = t('ocr.progressAuto');
    let mode = modeByAspect(O.img.w, O.img.h);
    if (!mode) {
        mode = 'manga';   // 判定できないときの既定
        const model = $('ocr-decide-model').value;
        if (model) {
            try {
                const r = parseModeAnswer(await systemOne(thumbB64(), model, MODE_QUESTIONS));
                if (r && r.p >= MODE_MIN_PROB) mode = r.mode;
            } catch (e) { console.warn('[ocr] auto mode failed', e); }
        }
    }
    applyPreset(mode);
    prog.textContent = t('ocr.autoPicked', t(`ocr.mode.${mode}`));
    return mode;
}

// ─── OCR（全体 / 縦長の分割） ───
/** 1枚を読む。空・繰り返しのときだけグレースケールで1回やり直す */
async function ocrOne(getB64, getGray, prog) {
    const model = $('ocr-model').value, gray = $('ocr-preprocess').value === 'gray';
    let boxes = parseOcrOutput(await ollamaChat(model, OCR_PROMPT, gray ? await getGray() : await getB64(), 4096));
    let retried = false;
    if (!gray && ocrLooksFailed(boxes)) {
        prog.textContent = t('ocr.progressOcrGray');
        const retry = parseOcrOutput(await ollamaChat(model, OCR_PROMPT, await getGray(), 4096));
        if (!ocrLooksFailed(retry) || retry.length > boxes.length) { boxes = retry; retried = true; }
    }
    return { boxes, retried };
}

function grayifyCanvas(cv) {
    const cx = cv.getContext('2d'), d = cx.getImageData(0, 0, cv.width, cv.height), p = d.data;
    for (let i = 0; i < p.length; i += 4) { const y = (p[i] * 299 + p[i + 1] * 587 + p[i + 2] * 114) / 1000; p[i] = p[i + 1] = p[i + 2] = y; }
    cx.putImageData(d, 0, 0);
}

/** 縦長画像を縦に分割して読み、座標を全体へ戻して重複を除く */
async function ocrTiles(prog) {
    const rects = tileRects(O.img.w, O.img.h);
    const all = []; let retried = false;
    for (let i = 0; i < rects.length; i++) {
        prog.textContent = t('ocr.progressTile', i + 1, rects.length);
        const { y0, y1 } = rects[i];
        const k = Math.min(1, SEND_MAX_SIDE / Math.max(O.img.w, y1 - y0));
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(O.img.w * k)); cv.height = Math.max(1, Math.round((y1 - y0) * k));
        const cx = cv.getContext('2d');
        cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
        cx.drawImage(O.img.el, 0, y0, O.img.w, y1 - y0, 0, 0, cv.width, cv.height);
        const color = cv.toDataURL('image/jpeg', 0.92).split(',')[1];
        const r = await ocrOne(() => color, () => { grayifyCanvas(cv); return cv.toDataURL('image/jpeg', 0.92).split(',')[1]; }, prog);
        retried = retried || r.retried;
        all.push(...mapTileBoxes(r.boxes, y0, y1, O.img.h));
    }
    return { boxes: dedupeTileBoxes(all), retried };
}

async function onRun() {
    if (O.busy || !O.img) return;
    if (O.boxes.length && !confirm(t('ocr.confirmReplace'))) return;
    const prog = $('ocr-progress');
    O.busy = true; $('ocr-run-btn').disabled = true;
    const started = Date.now();
    try {
        await prepareVram(prog);   // 他のOllamaモデルがVRAMを占有していると、OCR・VLMのロードが遅い／失敗する
        const mode = await resolveMode(prog);   // 自動モードなら画像から選んで設定へ反映する
        const autoMsg = $('ocr-mode').value === 'auto' ? t('ocr.autoPicked', t(`ocr.mode.${mode}`)) : '';
        let ocrBoxes = [], grayRetry = '';
        if ($('ocr-use-ocr').checked) {
            prog.textContent = t('ocr.progressOcr');
            const r = OCR_MODE_PRESETS[mode]?.tile ? await ocrTiles(prog) : await ocrOne(() => O.img.b64, grayB64, prog);
            ocrBoxes = r.boxes; grayRetry = r.retried ? t('ocr.grayRetried') : '';
        }
        let vlmBoxes = [];
        const classes = selectedLayoutClasses();
        if ($('ocr-use-layout').checked && classes.length) {
            prog.textContent = t('ocr.progressLayout');
            const raw = await ollamaChat($('ocr-layout-model').value, buildLayoutPrompt(classes), O.img.b64, 4096);
            vlmBoxes = parseLayoutOutput(raw, O.img.w, O.img.h).filter(b => classes.includes(b.cls));
        }
        O.boxes = mergeDetections(ocrBoxes, vlmBoxes).map(b => ({ ...b, id: O.nextId++ }));
        O.selId = null; O.multi.clear();
        renderAll();
        let rereadError = '';
        if ($('ocr-use-reread').checked && $('ocr-reread-model').value) {
            try { await rereadAll(prog); } catch (e) { rereadError = e.message || String(e); }   // 検出結果は残し、元のOCR文字のまま
            renderAll();
        }
        if ($('ocr-use-overall').checked && $('ocr-layout-model').value) {
            try { await makeOverall(prog); } catch (e) { rereadError = rereadError || t('ocr.errOverall', e.message || String(e)); }   // 検出結果は残す
        }
        let decideMsg = '';
        if ($('ocr-use-decide').checked && $('ocr-decide-model').value) {
            await prepareVram(prog);   // 判定モデルは大きい（clef-flash 約10GB）。直前までのOCR・VLMを退避させて空きを作る
            try { const r = await decideAll(prog); decideMsg = t('ocr.decideDone', r.changed, r.dropped); } catch (e) { rereadError = rereadError || e.message || String(e); }
            renderAll();
        }
        prog.textContent = rereadError || (t('ocr.done', O.boxes.length, ((Date.now() - started) / 1000).toFixed(1)) + (decideMsg ? ` ${decideMsg}` : '') + (grayRetry ? ` ${grayRetry}` : '') + (autoMsg ? ` ${autoMsg}` : ''));
    } catch (e) {
        console.warn('[ocr] run failed', e);
        prog.textContent = t('ocr.errRun', e.message || String(e));
    } finally {
        O.busy = false; $('ocr-run-btn').disabled = !O.img; updateButtons();
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
    const overall = $('ocr-use-overall').checked ? $('ocr-overall').value.trim() : '';   // ONで文章があるときだけMOSSのプロンプトを置き換える
    const n = await importOcrItems(items, { aspect, prompt: overall });
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
    if (saved.useReread !== undefined) $('ocr-use-reread').checked = !!saved.useReread;
    if (saved.preprocess) $('ocr-preprocess').value = saved.preprocess;
    if (saved.useOverall !== undefined) $('ocr-use-overall').checked = !!saved.useOverall;
    if (saved.useDecide !== undefined) $('ocr-use-decide').checked = !!saved.useDecide;
    if (saved.merge === false) $('ocr-merge-containers').checked = false;
    if (saved.useOcr === false) $('ocr-use-ocr').checked = false;
    const firstUse = !Object.keys(saved).length;   // 保存が無い初回だけ manga。既存の保存設定がある人は custom（今の設定を維持）
    $('ocr-mode').value = saved.mode || (firstUse ? 'manga' : 'custom');
    updateModeHint();
    const mdet = $('ocr-mode-details');   // モード欄の開閉状態を保存
    try { if (localStorage.getItem(MODE_COLLAPSE_KEY) === '0') mdet.open = false; } catch (_) { /* ignore */ }
    mdet.addEventListener('toggle', () => { try { localStorage.setItem(MODE_COLLAPSE_KEY, mdet.open ? '1' : '0'); } catch (_) { /* ignore */ } });

    const md = $('ocr-models-details');   // モデル欄の開閉状態を保存
    try { if (localStorage.getItem(COLLAPSE_KEY) === '0') md.open = false; } catch (_) { /* ignore */ }
    md.addEventListener('toggle', () => { try { localStorage.setItem(COLLAPSE_KEY, md.open ? '1' : '0'); } catch (_) { /* ignore */ } });

    initStageInteraction();
    $('ocr-open-btn').addEventListener('click', () => $('ocr-file').click());
    $('ocr-file').addEventListener('change', () => {
        const f = $('ocr-file').files?.[0]; $('ocr-file').value = '';
        if (f) loadImageFile(f).catch(err => alert(err.message));
    });
    $('ocr-box-del-btn').addEventListener('click', deleteSelected);
    $('ocr-box-reread-btn').addEventListener('click', onRereadSelected);
    $('ocr-box-clear-btn').addEventListener('click', () => {
        if (!O.boxes.length || !confirm(t('ocr.confirmClear'))) return;
        O.boxes = []; O.selId = null; O.multi.clear(); renderAll();
    });
    $('ocr-run-btn').addEventListener('click', onRun);
    $('ocr-overall-btn').addEventListener('click', onOverallBtn);
    $('ocr-reload-models-btn').addEventListener('click', () => loadModels(loadSettings()));
    $('ocr-copy-text-btn').addEventListener('click', () => copyText(collectText(O.boxes), 'ocr.copied'));
    $('ocr-copy-json-btn').addEventListener('click', () => copyText(boxesAsJson(), 'ocr.copied'));
    $('ocr-send-moss-btn').addEventListener('click', onSendMoss);
    for (const id of ['ocr-url', 'ocr-model', 'ocr-layout-model', 'ocr-use-layout', 'ocr-merge-containers', 'ocr-use-reread', 'ocr-reread-model', 'ocr-use-decide', 'ocr-decide-model', 'ocr-use-overall', 'ocr-preprocess', 'ocr-use-ocr', 'ocr-mode']) $(id).addEventListener('change', saveSettings);
    // 個別設定を手で変えたらモードは「カスタム」へ（プリセット適用中は除く）
    const toCustom = () => { if (!O.applyingPreset && $('ocr-mode').value !== 'custom') { $('ocr-mode').value = 'custom'; updateModeHint(); saveSettings(); } };
    for (const id of Object.values(MODE_CHECKS).concat(['ocr-preprocess'])) $(id).addEventListener('change', toCustom);
    document.querySelectorAll('[data-ocr-class]').forEach(el => el.addEventListener('change', toCustom));
    $('ocr-mode').addEventListener('change', () => { updateModeHint(); const m = $('ocr-mode').value; if (OCR_MODE_PRESETS[m]) applyPreset(m); });
    document.querySelectorAll('[data-ocr-class]').forEach(el => el.addEventListener('change', saveSettings));
    $('ocr-url').addEventListener('change', () => loadModels(loadSettings()));
    window.addEventListener('resize', () => { if ($('ocr-tab')?.classList.contains('active')) renderStage(); });

    renderAll();
    await loadModels(saved);
    if (firstUse && OCR_MODE_PRESETS[$('ocr-mode').value]) applyPreset($('ocr-mode').value);   // モデル一覧が揃ってから（読み直し・判定の可否が決まる）
}

export function initOcrTab() {
    if (O.inited) { renderStage(); return; }
    O.inited = true;
    initOcrTabOnce();
}
