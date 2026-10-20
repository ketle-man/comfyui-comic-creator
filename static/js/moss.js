// MOSS-Image タブ（ローカル生成）。
// ComfyUI本体がネイティブ対応しているMOSS-Image(5B DiT)を /api/ccc/moss/generate 経由で実行する。
// 目玉はレイアウトエディタ: 物体/キャラ/文字をbboxで指定してレイアウトJSONを組み立てる
// （ComfyUIの「Create Bounding Boxes」ノード相当をCCのコマ割りと連携させたもの）。
// 生成モードは「1頁まるごと」「コマ単位」「自由サイズ」の3つ。
import { t } from './i18n.js';
import { state } from './main/01-state.js';
import { dbGet } from './main/00-db.js';
import { insertImage, insertImageFromUrl, getBoundingBoxFromPoints } from './main/08-panels-images.js';
import { prepareVramForGeneration } from './vram-prepare.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'ccc_moss_v1';
const SUBTAB_KEY = 'ccc_moss_subtab';
const FIELD_IDS = ['moss-prompt', 'moss-negative', 'moss-mode', 'moss-size-preset', 'moss-width', 'moss-height', 'moss-batch',
    'moss-unet', 'moss-clip', 'moss-vae', 'moss-lora', 'moss-lora-strength', 'moss-steps', 'moss-cfg', 'moss-sampler',
    'moss-scheduler', 'moss-slg', 'moss-seed', 'moss-preset', 'moss-json-manual'];

// プリセット名 → サンプラー設定。loraはファイル名に含まれる正規表現（無ければLoRAなし）
const PRESETS = {
    official: { steps: 50, cfg: 3, sampler: 'euler', scheduler: 'simple', slg: true, lora: null },
    template: { steps: 25, cfg: 2.5, sampler: 'er_sde', scheduler: 'simple', slg: true, lora: null },
    dmd8:     { steps: 8, cfg: 1, sampler: 'euler', scheduler: 'sgm_uniform', slg: false, lora: /dmd/i },
    turbo4:   { steps: 4, cfg: 1, sampler: 'euler', scheduler: 'simple', slg: false, lora: /4step/i },
};
const PAGE_TARGET_PIXELS = 2_000_000;   // 1頁モードの総画素数（manga_baseの1216x1824≒2.2MP相当）
const PANEL_TARGET_PIXELS = 1_000_000;  // コマ単位モード（公式推奨1MP）
const MIN_BOX_PX = 24;                   // これ未満のドラッグは追加しない

const S = {
    inited: false, busy: false,
    items: [], selId: null, nextId: 1,
    W: 1024, H: 1024, scale: 1,
    panels: [],          // コマ単位モード: [{ id, caption, use, bbox }]
    results: [], resultIdx: 0,
    previewTimer: null, saveTimer: null,
    comboLists: null,
};

const round16 = (v) => Math.max(256, Math.min(4096, Math.round(v / 16) * 16));
function sizeForAspect(aspect, pixels) {
    const a = aspect > 0 ? aspect : 1;
    const w = round16(Math.sqrt(pixels * a));
    return { w, h: round16(w / a) };
}

// ─── 設定の保存・復元（localStorage。使えない環境ではスキップ） ───
function saveSettings() {
    try {
        const data = { items: S.items, nextId: S.nextId, W: S.W, H: S.H };
        for (const id of FIELD_IDS) {
            const el = $(id);
            if (el) data[id] = el.type === 'checkbox' ? el.checked : el.value;
        }
        data['moss-json-text'] = $('moss-json-preview')?.value || '';
        localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch (_) { /* ignore */ }
}
function scheduleSave() { clearTimeout(S.saveTimer); S.saveTimer = setTimeout(saveSettings, 400); }
function loadSettings() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (_) { return null; }
}

// ─── モデル一覧（ComfyUI自身の /object_info から取得） ───
async function fetchCombo(node, input) {
    const r = await fetch(`/object_info/${node}`);
    if (!r.ok) throw new Error(`object_info ${node}: HTTP ${r.status}`);
    const j = await r.json();
    const spec = j?.[node]?.input?.required?.[input]?.[0];
    return Array.isArray(spec) ? spec : [];
}

function fillSelect(el, list, selected) {
    if (!el) return;
    el.innerHTML = '';
    for (const v of list) {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = v === '' ? t('moss.none') : v.replace(/^.*[\\/]/, '');
        el.appendChild(o);
    }
    if (selected !== undefined && list.includes(selected)) el.value = selected;
}

async function loadModelLists(saved) {
    const label = $('moss-status-label');
    try {
        const [unets, clips, vaes, loras, samplers, scheds, clipTypes] = await Promise.all([
            fetchCombo('UNETLoader', 'unet_name'), fetchCombo('CLIPLoader', 'clip_name'), fetchCombo('VAELoader', 'vae_name'),
            fetchCombo('LoraLoaderModelOnly', 'lora_name'), fetchCombo('KSampler', 'sampler_name'),
            fetchCombo('KSampler', 'scheduler'), fetchCombo('CLIPLoader', 'type'),
        ]);
        const mossUnets = unets.filter(n => /moss/i.test(n));
        const qwenClips = clips.filter(n => /qwen3\.5/i.test(n));
        const mossLoras = loras.filter(n => /moss/i.test(n));
        const pick = (list, re, fallback) => list.find(n => re.test(n)) ?? fallback;
        const unetList = mossUnets.length ? mossUnets : unets;
        const clipList = qwenClips.length ? qwenClips : clips;
        fillSelect($('moss-unet'), unetList, saved?.['moss-unet'] ?? pick(unetList, /moss_image_sft/i, unetList[0]));
        fillSelect($('moss-clip'), clipList, saved?.['moss-clip'] ?? pick(clipList, /w4a8_gptq|moss/i, pick(clipList, /^(?!.*(flux3|qwen_image)).*$/i, clipList[0])));
        fillSelect($('moss-vae'), vaes.filter(n => /flux2/i.test(n)).length ? vaes.filter(n => /flux2/i.test(n)) : vaes,
            saved?.['moss-vae'] ?? pick(vaes, /^flux2-vae\.safetensors$/i, vaes.find(n => /flux2/i.test(n))));
        fillSelect($('moss-lora'), ['', ...mossLoras], saved?.['moss-lora'] ?? '');
        fillSelect($('moss-sampler'), samplers, saved?.['moss-sampler'] ?? 'euler');
        fillSelect($('moss-scheduler'), scheds, saved?.['moss-scheduler'] ?? 'simple');
        S.comboLists = { loras: mossLoras };
        const ok = mossUnets.length > 0 && clipTypes.includes('moss_image');
        label.textContent = ok ? t('moss.statusReady') : (clipTypes.includes('moss_image') ? t('moss.statusNoModel') : t('moss.statusUnsupported'));
        label.className = 'comfyui-status ' + (ok ? 'connected' : 'disconnected');
    } catch (e) {
        label.textContent = t('moss.statusError');
        label.className = 'comfyui-status disconnected';
        console.warn('[moss] model list failed', e);
    }
}

function applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    $('moss-steps').value = p.steps;
    $('moss-cfg').value = p.cfg;
    if ([...$('moss-sampler').options].some(o => o.value === p.sampler)) $('moss-sampler').value = p.sampler;
    if ([...$('moss-scheduler').options].some(o => o.value === p.scheduler)) $('moss-scheduler').value = p.scheduler;
    $('moss-slg').checked = p.slg;
    const lora = p.lora ? (S.comboLists?.loras || []).find(n => p.lora.test(n)) : '';
    $('moss-lora').value = lora || '';
}

// ─── サイズ ───
function setSize(w, h, { fromPreset = false } = {}) {
    S.W = round16(w); S.H = round16(h);
    $('moss-width').value = S.W; $('moss-height').value = S.H;
    if (!fromPreset) {
        const key = `${S.W}x${S.H}`;
        const sel = $('moss-size-preset');
        sel.value = [...sel.options].some(o => o.value === key) ? key : 'custom';
    }
    renderCanvas();
    schedulePreview();
}

function onSizePresetChange() {
    const v = $('moss-size-preset').value;
    if (v === 'custom') return;
    const [w, h] = v.split('x').map(Number);
    setSize(w, h, { fromPreset: true });
    scheduleSave();
}

async function getActivePageSvgSize() {
    if (!state.activePage) return null;
    const rec = await dbGet('pages', state.activePage.name);
    if (!rec) return null;
    let w = rec.width, h = rec.height;
    if (!(w > 0) || !(h > 0)) {
        const svg = new DOMParser().parseFromString(rec.svgContent || '', 'image/svg+xml').querySelector('svg');
        const vb = ((svg && svg.getAttribute('viewBox')) || '0 0 21000 29700').trim().split(/\s+/).map(Number);
        w = vb[2] || 21000; h = vb[3] || 29700;
    }
    return { w, h };
}

// ─── レイアウトエディタ ───
const selItem = () => S.items.find(i => i.id === S.selId) || null;
const drawType = () => document.querySelector('input[name="moss-draw-type"]:checked')?.value || 'object';

function layoutPayload() {
    return { items: S.items.map(i => ({ type: i.type, caption: i.caption, text: i.text, x: i.x, y: i.y, w: i.w, h: i.h })) };
}

function renderCanvas() {
    const cv = $('moss-layout-canvas'), wrap = $('moss-layout-wrap');
    if (!cv || !wrap) return;
    const maxW = Math.min(wrap.clientWidth || 480, 560), maxH = 620;
    S.scale = Math.min(maxW / S.W, maxH / S.H);
    cv.style.width = `${Math.round(S.W * S.scale)}px`;
    cv.style.height = `${Math.round(S.H * S.scale)}px`;
    cv.innerHTML = '';
    S.items.forEach((it, idx) => {
        const el = document.createElement('div');
        el.className = 'moss-box' + (it.id === S.selId ? ' selected' : '');
        el.dataset.id = it.id;
        el.dataset.type = it.type;
        const badge = document.createElement('span');
        badge.className = 'moss-badge'; badge.textContent = String(idx + 1);
        const label = document.createElement('span');
        label.className = 'moss-label'; label.textContent = it.type === 'text' ? (it.text || it.caption) : it.caption;
        el.append(badge, label);
        for (const h of ['nw', 'ne', 'sw', 'se']) {
            const hd = document.createElement('div');
            hd.className = 'moss-handle'; hd.dataset.h = h;
            el.appendChild(hd);
        }
        placeBox(el, it);
        cv.appendChild(el);
    });
    syncProps();
}

function placeBox(el, it) {
    el.style.left = `${it.x * S.scale}px`; el.style.top = `${it.y * S.scale}px`;
    el.style.width = `${it.w * S.scale}px`; el.style.height = `${it.h * S.scale}px`;
}

function addItem(partial) {
    const it = { id: S.nextId++, type: 'object', caption: '', text: '', x: 0, y: 0, w: 100, h: 100, ...partial };
    S.items.push(it);
    return it;
}

function selectItem(id) {
    S.selId = id;
    renderCanvas();
}

function syncProps() {
    const it = selItem();
    $('moss-item-props').style.display = it ? '' : 'none';
    if (!it) return;
    $('moss-item-no').textContent = `#${S.items.indexOf(it) + 1}`;
    $('moss-item-type').value = it.type;
    $('moss-item-caption').value = it.caption;
    $('moss-item-text').value = it.text;
    $('moss-item-text-field').style.display = it.type === 'text' ? '' : 'none';
}

function canvasPoint(e) {
    const r = $('moss-layout-canvas').getBoundingClientRect();
    return { x: (e.clientX - r.left) / S.scale, y: (e.clientY - r.top) / S.scale };
}
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

function initCanvasInteraction() {
    const cv = $('moss-layout-canvas');
    let drag = null;   // { mode: 'draw'|'move'|'nw'..., item, start, orig }

    cv.addEventListener('pointerdown', (e) => {
        const boxEl = e.target.closest('.moss-box');
        const p = canvasPoint(e);
        if (boxEl) {
            const it = S.items.find(i => i.id === Number(boxEl.dataset.id));
            const mode = e.target.dataset.h || 'move';
            if (S.selId !== it.id) selectItem(it.id);
            drag = { mode, item: it, start: p, orig: { x: it.x, y: it.y, w: it.w, h: it.h } };
        } else {
            const x = clamp(p.x, 0, S.W), y = clamp(p.y, 0, S.H);
            const it = addItem({ type: drawType(), x, y, w: 0, h: 0, caption: '', text: '' });
            S.selId = it.id;
            drag = { mode: 'draw', item: it, start: { x, y }, orig: null };
            renderCanvas();
        }
        cv.setPointerCapture(e.pointerId);
        e.preventDefault();
    });

    cv.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const p = canvasPoint(e), it = drag.item, o = drag.orig;
        if (drag.mode === 'draw') {
            const x = clamp(p.x, 0, S.W), y = clamp(p.y, 0, S.H);
            it.x = Math.min(drag.start.x, x); it.y = Math.min(drag.start.y, y);
            it.w = Math.abs(x - drag.start.x); it.h = Math.abs(y - drag.start.y);
        } else if (drag.mode === 'move') {
            it.x = clamp(o.x + (p.x - drag.start.x), 0, S.W - o.w);
            it.y = clamp(o.y + (p.y - drag.start.y), 0, S.H - o.h);
        } else {
            let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
            if (drag.mode.includes('w')) x0 = clamp(p.x, 0, x1 - MIN_BOX_PX);
            if (drag.mode.includes('e')) x1 = clamp(p.x, x0 + MIN_BOX_PX, S.W);
            if (drag.mode.includes('n')) y0 = clamp(p.y, 0, y1 - MIN_BOX_PX);
            if (drag.mode.includes('s')) y1 = clamp(p.y, y0 + MIN_BOX_PX, S.H);
            it.x = x0; it.y = y0; it.w = x1 - x0; it.h = y1 - y0;
        }
        const el = cv.querySelector(`.moss-box[data-id="${it.id}"]`);
        if (el) placeBox(el, it);
    });

    const end = (e) => {
        if (!drag) return;
        const it = drag.item;
        if (drag.mode === 'draw' && (it.w < MIN_BOX_PX || it.h < MIN_BOX_PX)) {
            S.items = S.items.filter(i => i.id !== it.id);
            S.selId = null;
        }
        drag = null;
        try { cv.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        renderCanvas();
        schedulePreview();
        scheduleSave();
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);

    // Deleteキーで選択中の要素を削除（入力欄にフォーカスがあるときは無視）
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Delete' || !$('moss-tab')?.classList.contains('active')) return;
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return;
        deleteSelected();
    });
}

function deleteSelected() {
    if (!S.selId) return;
    S.items = S.items.filter(i => i.id !== S.selId);
    S.selId = null;
    renderCanvas(); schedulePreview(); scheduleSave();
}

function moveSelected(delta) {
    const i = S.items.findIndex(x => x.id === S.selId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= S.items.length) return;
    [S.items[i], S.items[j]] = [S.items[j], S.items[i]];
    renderCanvas(); schedulePreview(); scheduleSave();
}

function initItemProps() {
    $('moss-item-type').addEventListener('change', () => {
        const it = selItem(); if (!it) return;
        it.type = $('moss-item-type').value;
        renderCanvas(); schedulePreview(); scheduleSave();
    });
    $('moss-item-caption').addEventListener('input', () => {
        const it = selItem(); if (!it) return;
        it.caption = $('moss-item-caption').value;
        const lb = $('moss-layout-canvas').querySelector(`.moss-box[data-id="${it.id}"] .moss-label`);
        if (lb) lb.textContent = it.type === 'text' ? (it.text || it.caption) : it.caption;
        schedulePreview(); scheduleSave();
    });
    $('moss-item-text').addEventListener('input', () => {
        const it = selItem(); if (!it) return;
        it.text = $('moss-item-text').value;
        const lb = $('moss-layout-canvas').querySelector(`.moss-box[data-id="${it.id}"] .moss-label`);
        if (lb) lb.textContent = it.text || it.caption;
        schedulePreview(); scheduleSave();
    });
    $('moss-item-del-btn').addEventListener('click', deleteSelected);
    $('moss-item-up-btn').addEventListener('click', () => moveSelected(1));
    $('moss-item-down-btn').addEventListener('click', () => moveSelected(-1));
    $('moss-layout-clear-btn').addEventListener('click', () => {
        if (S.items.length && !confirm(t('moss.confirmClear'))) return;
        S.items = []; S.selId = null;
        renderCanvas(); schedulePreview(); scheduleSave();
    });
}

// コマ中心の位置を英語の方位表現にする（MOSS-Imageのcaptionは英語が最も安定するため）
function positionPhrase(cx, cy) {
    const v = cy < 1 / 3 ? 'Top' : cy < 2 / 3 ? 'Middle' : 'Bottom';
    const h = cx < 1 / 3 ? 'left' : cx < 2 / 3 ? 'center' : 'right';
    return v === 'Middle' && h === 'center' ? 'Center' : `${v}-${h}`;
}

function collectPagePanels(svg) {
    const panels = state.activePage?.panels || [];
    return panels.map((p, i) => {
        const bbox = p.points ? getBoundingBoxFromPoints(p.points) : null;
        return bbox && bbox.width > 0 && bbox.height > 0 ? { id: p.id, index: i, bbox, svg } : null;
    }).filter(Boolean);
}

async function importPagePanels() {
    const svg = await getActivePageSvgSize();
    if (!svg) { alert(t('layout.msgNoActivePage')); return; }
    const list = collectPagePanels(svg);
    if (!list.length) { alert(t('moss.noPanels')); return; }
    if (S.items.length && !confirm(t('moss.confirmReplace'))) return;
    const { w, h } = sizeForAspect(svg.w / svg.h, PAGE_TARGET_PIXELS);
    S.items = []; S.selId = null;
    setSize(w, h);
    const sx = S.W / svg.w, sy = S.H / svg.h;
    for (const p of list) {
        const b = p.bbox;
        const cx = (b.x + b.width / 2) / svg.w, cy = (b.y + b.height / 2) / svg.h;
        addItem({
            type: 'object', caption: `${positionPhrase(cx, cy)} panel.`,
            x: b.x * sx, y: b.y * sy, w: b.width * sx, h: b.height * sy,
        });
    }
    renderCanvas(); schedulePreview(); scheduleSave();
}

// ─── JSONプレビュー ───
function schedulePreview() {
    clearTimeout(S.previewTimer);
    S.previewTimer = setTimeout(refreshPreview, 250);
}

async function refreshPreview() {
    if ($('moss-json-manual').checked) return;   // 手動編集中は上書きしない
    const box = $('moss-json-preview');
    try {
        const r = await fetch('/api/ccc/moss/layout-prompt', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: $('moss-prompt').value, width: S.W, height: S.H, layout: layoutPayload() }),
        });
        const d = await r.json();
        let text = d.prompt || '';
        try { text = JSON.stringify(JSON.parse(text), null, 1); } catch (_) { /* 通常プロンプトのまま表示 */ }
        box.value = text;
    } catch (_) { /* ignore */ }
}

function onJsonManualToggle() {
    const manual = $('moss-json-manual').checked;
    $('moss-json-preview').readOnly = !manual;
    if (!manual) refreshPreview();
    scheduleSave();
}

// ─── コマ単位モードのコマ一覧 ───
async function reloadPanelList() {
    const svg = await getActivePageSvgSize();
    const list = svg ? collectPagePanels(svg) : [];
    const prev = new Map(S.panels.map(p => [p.id, p]));
    S.panels = list.map(p => {
        const old = prev.get(p.id);
        return { id: p.id, index: p.index, bbox: p.bbox, caption: old?.caption ?? '', use: old?.use ?? true };
    });
    renderPanelList();
}

function renderPanelList() {
    const box = $('moss-panel-list');
    box.innerHTML = '';
    if (!S.panels.length) {
        box.textContent = t('moss.noPanels');
        return;
    }
    S.panels.forEach((p, n) => {
        const row = document.createElement('div');
        row.className = 'moss-panel-row';
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = p.use;
        cb.addEventListener('change', () => { p.use = cb.checked; });
        const label = document.createElement('span');
        label.style.cssText = 'font-size:12px; min-width:80px;';
        label.textContent = `${t('moss.panelN', n + 1)} (${Math.round(p.bbox.width)}×${Math.round(p.bbox.height)})`;
        const ta = document.createElement('textarea');
        ta.rows = 2; ta.value = p.caption; ta.placeholder = t('moss.panelPlaceholder');
        ta.addEventListener('input', () => { p.caption = ta.value; });
        row.append(cb, label, ta);
        box.appendChild(row);
    });
}

function updateModeUi() {
    const mode = $('moss-mode').value;
    $('moss-panel-list-group').style.display = mode === 'panel' ? '' : 'none';
    $('moss-size-note').textContent = mode === 'panel' ? t('moss.sizeNotePanel') : (mode === 'page' ? t('moss.sizeNotePage') : '');
    $('moss-insert-btn').textContent = mode === 'page' ? t('moss.insertPage') : t('moss.insertBtn');
    if (mode === 'panel') reloadPanelList();
}

// ─── 生成 ───
function currentParams() {
    const v = (id) => $(id).value;
    const seedRaw = Number(v('moss-seed'));
    return {
        negative_prompt: v('moss-negative'),
        unet: v('moss-unet'), clip: v('moss-clip'), vae: v('moss-vae'),
        lora: v('moss-lora'), lora_strength: Number(v('moss-lora-strength')),
        steps: Number(v('moss-steps')), cfg: Number(v('moss-cfg')),
        sampler: v('moss-sampler'), scheduler: v('moss-scheduler'), slg: $('moss-slg').checked,
        seed: seedRaw >= 0 ? seedRaw : -1,
    };
}

async function postGenerate(body) {
    const r = await fetch('/api/ccc/moss/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.status !== 'ok') {
        throw new Error(d.message || t('nb.generateFailed'));
    }
    return d;
}

const viewUrl = (im) => `/view?filename=${encodeURIComponent(im.filename)}&subfolder=${encodeURIComponent(im.subfolder || '')}&type=${encodeURIComponent(im.type || 'output')}`;

async function onGenerate() {
    if (S.busy) return;
    const mode = $('moss-mode').value;
    const progress = $('moss-progress-text'), btn = $('moss-generate-btn');
    const base = currentParams();
    const mainPrompt = $('moss-prompt').value.trim();
    const manual = $('moss-json-manual').checked;
    if (!mainPrompt && !manual && !(mode === 'panel')) { alert(t('moss.promptEmpty')); return; }
    S.busy = true; btn.disabled = true;
    try {
        await prepareVramForGeneration();
        if (mode === 'panel') {
            await generatePanels(base, mainPrompt, progress);
        } else {
            progress.textContent = t('moss.generating');
            const body = { ...base, width: S.W, height: S.H, num_images: Number($('moss-batch').value) || 1 };
            if (manual) body.prompt = $('moss-json-preview').value;
            else { body.prompt = mainPrompt; body.layout = layoutPayload(); }
            const d = await postGenerate(body);
            showResults(d.images.map(im => ({ url: viewUrl(im), im, w: d.width, h: d.height })));
            if (base.seed < 0) $('moss-seed').value = d.seed;
            progress.textContent = t('moss.done');
        }
    } catch (e) {
        console.error('[moss] generate failed', e);
        progress.textContent = `${t('nb.generateFailed')}: ${e.message}`;
    } finally {
        S.busy = false; btn.disabled = false;
    }
}

// コマ単位: 選択したコマを順に生成し、そのコマへストレッチ配置する
async function generatePanels(base, mainPrompt, progress) {
    if (!S.panels.length) await reloadPanelList();
    const targets = S.panels.filter(p => p.use);
    if (!targets.length) { alert(t('moss.noPanels')); return; }
    const all = [];
    for (let i = 0; i < targets.length; i++) {
        const p = targets[i];
        progress.textContent = t('moss.generatingPanel', i + 1, targets.length);
        const { w, h } = sizeForAspect(p.bbox.width / p.bbox.height, PANEL_TARGET_PIXELS);
        const prompt = [mainPrompt, p.caption.trim()].filter(Boolean).join('\n');
        if (!prompt) { alert(t('moss.promptEmpty')); return; }
        const d = await postGenerate({ ...base, prompt, width: w, height: h, num_images: 1, seed: base.seed >= 0 ? base.seed + i : -1 });
        const im = d.images[0];
        all.push({ url: viewUrl(im), im, w: d.width, h: d.height });
        await insertIntoPanel(viewUrl(im), p.id, p.bbox);
    }
    showResults(all);
    progress.textContent = t('moss.donePanels', targets.length);
}

async function urlToDataUrl(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result); fr.onerror = reject; fr.readAsDataURL(blob);
    });
}

async function insertIntoPanel(url, panelId, bbox) {
    const dataUrl = await urlToDataUrl(url);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
    state.selectedPanelId = panelId;
    state.selectedOverlay = false;
    state.selectedDraft = false;
    await insertImage(dataUrl, img.width, img.height, { preserveAspectRatio: 'none' },
        { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height });
}

// ─── 結果表示・配置 ───
function showResults(list) {
    S.results = list; S.resultIdx = 0;
    renderResult();
}

function renderResult() {
    const cur = S.results[S.resultIdx];
    $('moss-result-img').src = cur ? cur.url : '';
    $('moss-insert-btn').disabled = !cur;
    const thumbs = $('moss-result-thumbs');
    thumbs.innerHTML = '';
    if (S.results.length < 2) { thumbs.style.display = 'none'; return; }
    S.results.forEach((r, i) => {
        const th = document.createElement('img');
        th.src = r.url;
        th.className = 'comfyui-result-thumb' + (i === S.resultIdx ? ' selected' : '');
        th.addEventListener('click', () => { S.resultIdx = i; renderResult(); });
        thumbs.appendChild(th);
    });
    thumbs.style.display = 'flex';
}

async function onInsert() {
    const cur = S.results[S.resultIdx];
    if (!cur) return;
    if (!state.activePage) { alert(t('layout.msgNoActivePage')); return; }
    try {
        if ($('moss-mode').value === 'page') {
            const svg = await getActivePageSvgSize();
            if (!svg) { alert(t('layout.msgNoActivePage')); return; }
            state.selectedOverlay = true; state.selectedDraft = false;
            await insertImageFromUrl(cur.url, { x: 0, y: 0, width: svg.w, height: svg.h });
        } else {
            if (!state.selectedPanelId) { alert(t('nb.selectTargetPanel')); return; }
            const dataUrl = await urlToDataUrl(cur.url);
            await insertImage(dataUrl, cur.w, cur.h);
        }
    } catch (e) {
        console.error('[moss] insert failed', e);
        alert(e.message);
    }
}

// ─── 初期化 ───
function initSubtabs() {
    document.querySelectorAll('[data-moss-subtab]').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.dataset.mossSubtab;
            document.querySelectorAll('[data-moss-subtab]').forEach(b => b.classList.toggle('active', b === btn));
            for (const k of ['prompt', 'target', 'model']) {
                const el = $(`moss-subtab-${k}`);
                if (el) el.style.display = k === key ? '' : 'none';
            }
            try { localStorage.setItem(SUBTAB_KEY, key); } catch (_) { /* ignore */ }
        });
    });
}

async function initMossTabOnce() {
    const saved = loadSettings();
    initSubtabs();
    try {
        const last = localStorage.getItem(SUBTAB_KEY);
        if (['prompt', 'target', 'model'].includes(last)) document.querySelector(`[data-moss-subtab="${last}"]`)?.click();
    } catch (_) { /* ignore */ }
    initCanvasInteraction();
    initItemProps();
    await loadModelLists(saved);

    if (saved) {
        for (const id of FIELD_IDS) {
            const el = $(id);
            if (!el || saved[id] === undefined) continue;
            if (['moss-unet', 'moss-clip', 'moss-vae', 'moss-lora', 'moss-sampler', 'moss-scheduler'].includes(id)) continue;  // 一覧に存在する値のみ loadModelLists が復元済み
            if (el.type === 'checkbox') el.checked = !!saved[id]; else el.value = saved[id];
        }
        S.items = Array.isArray(saved.items) ? saved.items : [];
        S.nextId = saved.nextId || (S.items.reduce((m, i) => Math.max(m, i.id), 0) + 1);
        $('moss-json-preview').value = saved['moss-json-text'] || '';
    }
    S.W = Number($('moss-width').value) || 1024;
    S.H = Number($('moss-height').value) || 1024;
    $('moss-json-preview').readOnly = !$('moss-json-manual').checked;

    $('moss-size-preset').addEventListener('change', onSizePresetChange);
    for (const id of ['moss-width', 'moss-height']) {
        $(id).addEventListener('change', () => setSize(Number($('moss-width').value), Number($('moss-height').value)));
    }
    $('moss-preset').addEventListener('change', () => { applyPreset($('moss-preset').value); scheduleSave(); });
    $('moss-mode').addEventListener('change', () => { updateModeUi(); scheduleSave(); });
    $('moss-prompt').addEventListener('input', schedulePreview);
    $('moss-json-manual').addEventListener('change', onJsonManualToggle);
    $('moss-json-preview').addEventListener('input', scheduleSave);
    $('moss-layout-import-btn').addEventListener('click', importPagePanels);
    $('moss-panel-reload-btn').addEventListener('click', reloadPanelList);
    $('moss-reload-models-btn').addEventListener('click', () => loadModelLists(loadSettings()));
    $('moss-generate-btn').addEventListener('click', onGenerate);
    $('moss-insert-btn').addEventListener('click', onInsert);
    for (const id of FIELD_IDS) $(id)?.addEventListener('change', scheduleSave);
    for (const id of ['moss-prompt', 'moss-negative']) $(id)?.addEventListener('input', scheduleSave);
    window.addEventListener('resize', () => { if ($('moss-tab')?.classList.contains('active')) renderCanvas(); });

    renderCanvas();
    updateModeUi();
    refreshPreview();
}

function initMossTab() {
    if (S.inited) return;
    S.inited = true;
    initMossTabOnce();
}

export { initMossTab };
