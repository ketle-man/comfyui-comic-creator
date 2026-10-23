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
    'moss-scheduler', 'moss-slg', 'moss-seed', 'moss-seed-mode', 'moss-preset', 'moss-json-manual', 'moss-import-texts', 'moss-import-panel-label', 'moss-enhance'];

// プリセット名 → サンプラー設定。loraはファイル名に含まれる正規表現（無ければLoRAなし）
const PRESETS = {
    official: { steps: 50, cfg: 3, sampler: 'euler', scheduler: 'simple', slg: true, lora: null },
    template: { steps: 25, cfg: 2.5, sampler: 'er_sde', scheduler: 'simple', slg: true, lora: null },
    dmd8:     { steps: 8, cfg: 1, sampler: 'euler', scheduler: 'sgm_uniform', slg: false, lora: /dmd/i },
    turbo4:   { steps: 4, cfg: 1, sampler: 'euler', scheduler: 'simple', slg: false, lora: /4step/i },
};
const PAGE_TARGET_PIXELS = 2_000_000;   // 1頁モードの総画素数（manga_baseの1216x1824≒2.2MP相当）
const PANEL_TARGET_PIXELS = 1_000_000;  // コマ単位モード（公式推奨1MP）
const EDGE_PX = 7;                       // 枠の縁として扱う幅(css px)。縁のドラッグは常に移動
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
        const data = { items: S.items, nextId: S.nextId, W: S.W, H: S.H, writingVertical: !!S.writingVertical };
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

async function getActivePageRecord() {
    if (!state.activePage) return null;
    return (await dbGet('pages', state.activePage.name)) || null;
}

function pageSvgSizeOf(rec) {
    let w = rec.width, h = rec.height;
    if (!(w > 0) || !(h > 0)) {
        const svg = new DOMParser().parseFromString(rec.svgContent || '', 'image/svg+xml').querySelector('svg');
        const vb = ((svg && svg.getAttribute('viewBox')) || '0 0 21000 29700').trim().split(/\s+/).map(Number);
        w = vb[2] || 21000; h = vb[3] || 29700;
    }
    return { w, h };
}

async function getActivePageSvgSize() {
    const rec = await getActivePageRecord();
    return rec ? pageSvgSizeOf(rec) : null;
}

// ─── レイアウトエディタ ───
const selItem = () => S.items.find(i => i.id === S.selId) || null;
const drawType = () => document.querySelector('#moss-draw-type .moss-type-btn.active')?.dataset.type || 'object';

// 「生成対象」の折りたたみ状態を保存する（既定は開く）
const COLLAPSE_KEY = 'ccc_moss_target_open';
function initTargetCollapse() {
    const d = $('moss-target-details');
    if (!d) return;
    try { if (localStorage.getItem(COLLAPSE_KEY) === '0') d.open = false; } catch (_) { /* ignore */ }
    d.addEventListener('toggle', () => { try { localStorage.setItem(COLLAPSE_KEY, d.open ? '1' : '0'); } catch (_) { /* ignore */ } });
}

// 横書き/縦書きトグル。文字枠を選択中ならその枠に適用し、新しく描く文字枠の既定にもなる
function setWritingToggle(vertical) {
    document.querySelectorAll('#moss-writing-mode .moss-type-btn').forEach(b => b.classList.toggle('active', (b.dataset.vertical === '1') === vertical));
}

function initWritingToggle() {
    const btns = [...document.querySelectorAll('#moss-writing-mode .moss-type-btn')];
    setWritingToggle(!!S.writingVertical);
    btns.forEach(b => b.addEventListener('click', () => {
        S.writingVertical = b.dataset.vertical === '1';   // 新しく描く文字枠の書字方向（描いた後の変更は「選択中の要素」で行う）
        setWritingToggle(S.writingVertical);
        scheduleSave();
    }));
}

// 選択中の文字枠の書字方向を切り替える。文字があれば枠を文字の大きさにし、空なら縦横を入れ替える
function setItemWriting(it, vertical) {
    if (!it || it.type !== 'text' || !!it.vertical === vertical) return;
    it.vertical = vertical;
    if (it.text) autoSizeText(it);
    else { const w = it.w; it.w = Math.min(S.W, it.h); it.h = Math.min(S.H, w); }
    it.x = clamp(it.x, 0, S.W - it.w); it.y = clamp(it.y, 0, S.H - it.h);
    renderCanvas(); schedulePreview(); scheduleSave();
}

function initDrawTypeButtons() {
    const btns = [...document.querySelectorAll('#moss-draw-type .moss-type-btn')];
    btns.forEach(b => b.addEventListener('click', () => btns.forEach(x => x.classList.toggle('active', x === b))));
}

// 要素の編集欄はプロンプトタブにあるため、キャンバスで要素を選んだらそのタブへ切り替える
function showPromptTab() {
    const btn = document.querySelector('[data-moss-subtab="prompt"]');
    if (btn && !btn.classList.contains('active')) btn.click();
}

function layoutPayload() {
    return { items: S.items.map(i => ({ type: i.type, caption: i.caption, text: i.text, vertical: !!i.vertical, x: i.x, y: i.y, w: i.w, h: i.h })) };
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
        // 文字が空（空白のみ）の文字枠は送信されない（JSONから除外される）ので、破線で薄く表示する
        el.className = 'moss-box' + (it.id === S.selId ? ' selected' : '');
        updateSkipped(el, it);
        el.dataset.id = it.id;
        el.dataset.type = it.type;
        const badge = document.createElement('span');
        badge.className = 'moss-badge'; badge.textContent = String(idx + 1);
        const label = document.createElement('span');
        label.className = 'moss-label';
        applyLabel(label, it);
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

// ── 文字枠: フォントサイズ(画像上のpx)と文字からbboxの大きさを決める（近似） ──
// 全角1文字≒1em・半角≒0.55em・行間1.2・上下左右にフォントサイズの0.3倍の余白、で見積もる。
// 文字を入力する/フォントサイズを変えると枠が文字の大きさになり、枠を手でリサイズするとその枠に収まる最大のフォントサイズに更新される
const TEXT_LINE_H = 1.2;
const TEXT_PAD = 0.3;
const FONT_MIN = 8, FONT_MAX = 400;
const defaultFontPx = () => Math.max(FONT_MIN, Math.round(S.H / 28));
const charEm = (ch) => (/[ -~｡-ﾟ]/.test(ch) ? 0.55 : 1);

// 縦書きは、改行ごとに1列（右→左）、1文字=1em（字を立てて上→下）として見積もる
function textExtent(text, fs, vertical = false) {
    const lines = String(text || '').split('\n');
    const pad = fs * TEXT_PAD * 2;
    if (vertical) {
        const rows = Math.max(1, ...lines.map(l => [...l].length));
        return { w: lines.length * fs * TEXT_LINE_H + pad, h: rows * fs + pad };
    }
    const em = Math.max(1, ...lines.map(l => [...l].reduce((n, ch) => n + charEm(ch), 0)));
    return { w: em * fs + pad, h: lines.length * fs * TEXT_LINE_H + pad };
}

// 文字が入っていれば、左上を保ったまま枠を文字の大きさにする（キャンバスからはみ出す分は位置を戻す）
function autoSizeText(it) {
    if (it.type !== 'text' || !it.text || it.fitBox === false) return;   // fitBox=false: 枠はそのまま（取り込んだフキダシの輪郭など）
    if (!(it.fontSize > 0)) it.fontSize = defaultFontPx();
    const ext = textExtent(it.text, it.fontSize, it.vertical);
    it.w = Math.min(S.W, ext.w); it.h = Math.min(S.H, ext.h);
    it.x = clamp(it.x, 0, S.W - it.w); it.y = clamp(it.y, 0, S.H - it.h);
}

// 枠に収まる最大のフォントサイズ（手動リサイズ後や、フォントサイズ未設定の既存データ用）
function fitFontToBox(it) {
    const text = it.text || 'あ';
    for (let fs = FONT_MAX; fs > FONT_MIN; fs--) {
        const ext = textExtent(text, fs, it.vertical);
        if (ext.w <= it.w && ext.h <= it.h) return fs;
    }
    return FONT_MIN;
}

// 文字が未入力のときはcaptionを薄く表示する
function applyLabel(label, it) {
    const resetLayout = () => {
        label.style.left = label.style.top = label.style.right = label.style.bottom = label.style.lineHeight = '';
        label.style.display = label.style.alignItems = label.style.justifyContent = label.style.textAlign = label.style.padding = '';
        label.style.whiteSpace = label.style.overflowWrap = '';
        label.style.writingMode = label.style.textOrientation = '';
    };
    resetLayout();
    if (it.type === 'text' && it.text) {
        const fs = it.fontSize > 0 ? it.fontSize : defaultFontPx();
        label.textContent = it.text;
        label.style.fontSize = `${fs * S.scale}px`;
        label.style.lineHeight = String(TEXT_LINE_H);
        label.style.writingMode = it.vertical ? 'vertical-rl' : '';
        label.style.textOrientation = it.vertical ? 'upright' : '';
        if (it.fitBox === false) {
            // 枠が文字より大きい（フキダシの輪郭など）: 枠の中央に文字を置く
            label.style.left = label.style.top = label.style.right = label.style.bottom = '0';
            label.style.display = 'flex';
            label.style.whiteSpace = 'pre-wrap';        // 枠の幅で折り返す（MOSS-Imageも枠の中で文字を折り返す）
            label.style.overflowWrap = 'anywhere';
            if (it.src === 'text') {
                // 取り込んだ単独テキスト: 枠は実測した文字の範囲（＋余白）なので、左上（縦書きは右上）から置く
                label.style.alignItems = label.style.justifyContent = 'flex-start';
                label.style.textAlign = 'start';
                label.style.padding = `${fs * 0.15 * S.scale}px`;
            } else {
                label.style.alignItems = label.style.justifyContent = 'center';
                label.style.textAlign = 'center';
            }
        } else {
            const pad = `${fs * TEXT_PAD * S.scale}px`;
            label.style.left = label.style.top = pad;
            // 縦書き: 右上から下へ、列は右→左。右側にも余白を取る
            label.style.right = it.vertical ? pad : '';
        }
        label.classList.add('moss-label-text');
        label.classList.remove('moss-label-dim');
    } else {
        label.textContent = it.type === 'text' ? (it.caption || t('moss.textEmptyLabel')) : it.caption;
        label.style.fontSize = '';
        label.classList.remove('moss-label-text');
        label.classList.toggle('moss-label-dim', it.type === 'text');
    }
}

// レイアウトタブのテキスト入力と同様に、キャンバス上の枠の中へ直接文字を入力する
function openInlineEdit(it) {
    const el = $('moss-layout-canvas').querySelector(`.moss-box[data-id="${it.id}"]`);
    if (!el || el.querySelector('.moss-inline-edit')) return;
    const ta = document.createElement('textarea');
    ta.className = 'moss-inline-edit';
    ta.value = it.text;
    ta.placeholder = t('moss.textPlaceholder');
    if (!(it.fontSize > 0)) it.fontSize = defaultFontPx();
    const styleTa = () => {
        const fs = it.fontSize * S.scale;
        ta.style.fontSize = `${Math.max(11, fs)}px`;
        ta.style.lineHeight = String(TEXT_LINE_H);
        ta.style.padding = `${Math.max(2, it.fontSize * TEXT_PAD * S.scale)}px`;
        ta.style.writingMode = it.vertical ? 'vertical-rl' : '';
        ta.style.textOrientation = it.vertical ? 'upright' : '';
    };
    styleTa();
    el.appendChild(ta);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.addEventListener('input', () => {
        it.text = ta.value;
        autoSizeText(it);          // 入力した文字の大きさに枠が追従する
        placeBox(el, it);
        updateSkipped(el, it);
        const side = $('moss-item-text');
        if (side) side.value = it.text;
        schedulePreview(); scheduleSave();
    });
    ta.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); ta.blur(); }
    });
    ta.addEventListener('blur', () => { renderCanvas(); scheduleSave(); });
}

// 文字が空（空白のみ）の文字枠は送信されないため、破線で薄く表示する（入力のたびに切り替える）
function updateSkipped(el, it) {
    if (el) el.classList.toggle('moss-skipped', it.type === 'text' && !(it.text || '').trim());
}

function placeBox(el, it) {
    el.style.left = `${it.x * S.scale}px`; el.style.top = `${it.y * S.scale}px`;
    el.style.width = `${it.w * S.scale}px`; el.style.height = `${it.h * S.scale}px`;
}

function addItem(partial) {
    const it = { id: S.nextId++, type: 'object', caption: '', text: '', x: 0, y: 0, w: 100, h: 100, ...partial };
    if (it.type === 'text' && !(it.fontSize > 0)) it.fontSize = S.lastFontPx || defaultFontPx();
    if (it.type === 'text' && it.vertical === undefined) it.vertical = !!S.writingVertical;
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
    for (const id of ['moss-item-up-btn', 'moss-item-down-btn', 'moss-item-del-btn']) $(id).disabled = !it;
    if (!it) return;
    $('moss-item-no').textContent = `#${S.items.indexOf(it) + 1}`;
    $('moss-item-type').value = it.type;
    $('moss-item-caption').value = it.caption;
    $('moss-item-text').value = it.text;
    $('moss-item-text-field').style.display = it.type === 'text' ? '' : 'none';
    $('moss-item-font-field').style.display = it.type === 'text' ? '' : 'none';
    $('moss-item-writing-field').style.display = it.type === 'text' ? '' : 'none';
    $('moss-item-fit-field').style.display = it.type === 'text' ? '' : 'none';
    if (it.type === 'text') {
        $('moss-item-fontsize').value = it.fontSize > 0 ? it.fontSize : defaultFontPx();
        $('moss-item-writing').value = it.vertical ? '1' : '0';
        $('moss-item-fit').checked = it.fitBox !== false;
    }
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
        if (e.target.classList.contains('moss-inline-edit')) return;   // 入力中のテキストエリアはドラッグ対象にしない
        const boxEl = e.target.closest('.moss-box');
        const p = canvasPoint(e);
        const hit = boxEl ? S.items.find(i => i.id === Number(boxEl.dataset.id)) : null;
        // 枠の縁・番号・ハンドル、または選択中の枠の中は、その枠の移動/拡縮。
        // 選択されていない枠の中のドラッグは「その上に新しい要素を描く」（クリックのみなら選択）。Shift+ドラッグは常に描画
        let grab = false;
        if (hit && !e.shiftKey) {
            const r = boxEl.getBoundingClientRect();
            const edge = Math.min(e.clientX - r.left, r.right - e.clientX, e.clientY - r.top, r.bottom - e.clientY) < EDGE_PX;
            grab = !!e.target.dataset.h || edge || e.target.classList.contains('moss-badge') || S.selId === hit.id;
        }
        if (hit && !e.shiftKey && !grab) {
            drag = { mode: 'pending', item: hit, start: p, orig: null, cx: e.clientX, cy: e.clientY };
        } else if (hit && grab) {
            const it = hit;
            const mode = e.target.dataset.h || 'move';
            // 文字枠の二度押し（350ms以内）で枠内入力。pointerdownでpreventDefaultするためブラウザのdblclickは当てにできない
            const now = performance.now();
            const dbl = mode === 'move' && it.type === 'text' && S.lastDown && S.lastDown.id === it.id && now - S.lastDown.t < 350;
            S.lastDown = { id: it.id, t: now };
            if (dbl) {
                S.lastDown = null;
                e.preventDefault();
                if (S.selId !== it.id) selectItem(it.id);
                openInlineEdit(it);
                return;
            }
            if (S.selId !== it.id) selectItem(it.id);
            showPromptTab();
            drag = { mode, item: it, start: p, orig: { x: it.x, y: it.y, w: it.w, h: it.h } };
        } else {
            const x = clamp(p.x, 0, S.W), y = clamp(p.y, 0, S.H);
            const it = addItem({ type: drawType(), x, y, w: 0, h: 0, caption: '', text: '' });
            S.selId = it.id;
            showPromptTab();
            drag = { mode: 'draw', item: it, start: { x, y }, orig: null };
            renderCanvas();
        }
        cv.setPointerCapture(e.pointerId);
        e.preventDefault();
    });

    cv.addEventListener('pointermove', (e) => {
        if (!drag) return;
        if (drag.mode === 'pending') {
            if (Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy) < 4) return;   // まだクリックの範囲
            const x = clamp(drag.start.x, 0, S.W), y = clamp(drag.start.y, 0, S.H);
            const created = addItem({ type: drawType(), x, y, w: 0, h: 0, caption: '', text: '' });
            S.selId = created.id;
            showPromptTab();
            drag = { mode: 'draw', item: created, start: { x, y }, orig: null };
            renderCanvas();
        }
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
        if (drag.mode === 'pending') {   // 動かさずに離した = 枠のクリック（選択）
            drag = null;
            try { cv.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
            S.lastDown = { id: it.id, t: performance.now() };
            selectItem(it.id);
            showPromptTab();
            return;
        }
        if (drag.mode === 'draw' && (it.w < MIN_BOX_PX || it.h < MIN_BOX_PX)) {
            S.items = S.items.filter(i => i.id !== it.id);
            S.selId = null;
        }
        const justDrew = drag.mode === 'draw' && S.items.includes(it);
        // 文字枠を手でリサイズしたら、その枠に収まる最大のフォントサイズに更新し、枠を文字の大きさに揃える
        if (it.type === 'text' && it.fitBox !== false && S.items.includes(it) && drag.mode !== 'move' && drag.mode !== 'draw') {
            it.fontSize = fitFontToBox(it);
            S.lastFontPx = it.fontSize;
            autoSizeText(it);
        }
        drag = null;
        try { cv.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        renderCanvas();
        schedulePreview();
        scheduleSave();
        if (justDrew && it.type === 'text') openInlineEdit(it);   // 文字枠は描いた直後にそのまま入力へ
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);

    // 文字枠をダブルクリックで再編集（枠はクリックのたびに再描画されるため、座標から対象を求める）
    cv.addEventListener('dblclick', (e) => {
        const p = canvasPoint(e);
        const hit = [...S.items].reverse().find(i => p.x >= i.x && p.x <= i.x + i.w && p.y >= i.y && p.y <= i.y + i.h);
        if (!hit || hit.type !== 'text') return;
        selectItem(hit.id);
        openInlineEdit(hit);
    });

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
        if (it.type === 'text' && !(it.fontSize > 0)) it.fontSize = fitFontToBox(it);
        autoSizeText(it);
        renderCanvas(); schedulePreview(); scheduleSave();
    });
    $('moss-item-caption').addEventListener('input', () => {
        const it = selItem(); if (!it) return;
        it.caption = $('moss-item-caption').value;
        const lb = $('moss-layout-canvas').querySelector(`.moss-box[data-id="${it.id}"] .moss-label`);
        if (lb) applyLabel(lb, it);
        schedulePreview(); scheduleSave();
    });
    $('moss-item-text').addEventListener('input', () => {
        const it = selItem(); if (!it) return;
        it.text = $('moss-item-text').value;
        autoSizeText(it);
        const el = $('moss-layout-canvas').querySelector(`.moss-box[data-id="${it.id}"]`);
        if (el) { placeBox(el, it); applyLabel(el.querySelector('.moss-label'), it); updateSkipped(el, it); }
        schedulePreview(); scheduleSave();
    });
    $('moss-item-fit').addEventListener('change', () => {
        const it = selItem(); if (!it || it.type !== 'text') return;
        it.fitBox = $('moss-item-fit').checked;
        if (it.fitBox) autoSizeText(it);
        renderCanvas(); schedulePreview(); scheduleSave();
    });
    $('moss-item-writing').addEventListener('change', () => setItemWriting(selItem(), $('moss-item-writing').value === '1'));
    // フォントサイズ（画像上のpx）。変更すると枠が文字の大きさに合わせて更新される
    $('moss-item-fontsize').addEventListener('input', () => {
        const it = selItem(); if (!it || it.type !== 'text') return;
        const v = Number($('moss-item-fontsize').value);
        if (!(v >= FONT_MIN)) return;
        it.fontSize = Math.min(FONT_MAX, Math.round(v));
        S.lastFontPx = it.fontSize;
        autoSizeText(it);
        const el = $('moss-layout-canvas').querySelector(`.moss-box[data-id="${it.id}"]`);
        if (el) { placeBox(el, it); applyLabel(el.querySelector('.moss-label'), it); }
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
            type: $('moss-import-panel-label').checked ? 'panel' : 'object', caption: `${positionPhrase(cx, cy)} panel.`,   // 既定は object（公開仕様）。panel ラベルは使い分け用
            x: b.x * sx, y: b.y * sy, w: b.width * sx, h: b.height * sy,
        });
    }
    renderCanvas(); schedulePreview(); scheduleSave();
}

// ─── フキダシ・セリフの取り込み ───
// ページのフキダシ（g.balloon-shape。オーバーレイと各コマのSVGの両方）から、セリフ入りのものを取り出す。
// 位置・大きさは data-cx/cy/rx/ry（ページのSVG座標）、セリフは data-bubble-text、フォントサイズは data-font-size-svg
const BALLOON_PHRASE = {
    normal: 'Speech bubble.', rect: 'Rectangular speech bubble.', thought: 'Thought bubble.',
    bomb: 'Shouting burst-shaped bubble.', caption: 'Caption box.',
    cloudpuffy: 'Puffy cloud-shaped bubble.', cloudwavy: 'Wavy cloud-shaped bubble.',
    'textbox-rect': 'Text box.', 'textbox-rounded': 'Rounded text box.', 'textbox-oval': 'Oval text box.',
};

function extractBalloons(rec) {
    const parser = new DOMParser();
    const sources = [rec.overlaySvgContent, ...(rec.panels || []).map(p => p.panelSvgContent)].filter(Boolean);
    const seen = new Set();
    const out = [];
    for (const src of sources) {
        const doc = parser.parseFromString(src, 'image/svg+xml');
        for (const g of doc.querySelectorAll('g.balloon-shape')) {
            const text = (g.getAttribute('data-bubble-text') || '').trim();
            const num = (name) => parseFloat(g.getAttribute(name));
            const cx = num('data-cx'), cy = num('data-cy'), rx = num('data-rx'), ry = num('data-ry');
            if (!text || ![cx, cy, rx, ry].every(Number.isFinite) || rx <= 0 || ry <= 0) continue;
            const id = g.getAttribute('id') || `${cx},${cy}`;
            if (seen.has(id)) continue;
            seen.add(id);
            out.push({
                id, text, cx, cy, rx, ry,
                shapeType: g.getAttribute('data-shape-type') || 'normal',
                vertical: g.getAttribute('data-bubble-text-vertical') === '1',
                fontSizeSvg: num('data-font-size-svg'),
            });
        }
    }
    return sortReadingOrder(out);
}

// 読み順（上から下、同じ段は右から左）。要素は cx, cy, ry（縦の半径）を持つこと
function sortReadingOrder(list) {
    const band = Math.max(1, ...list.map(b => b.ry)) * 1.2;
    return list.sort((a, b) => (Math.abs(a.cy - b.cy) < band ? b.cx - a.cx : a.cy - b.cy));
}

// ページの吹き出しなしの単独テキスト（テキストツールの <text>）を取り出す。
// 回転・拡縮・せん断・縦書きを含む実際の見た目の範囲が要るため、文字だけの新しいSVGを画面外へ描画して実測する。
// 保存済みSVGは描画せず（パースしただけのDOMは何も実行しない）、<text>/<tspan>と、許可リストの属性・祖先の transform だけを
// 新しいSVGへ写す。禁止リスト方式のサニタイザでは名前空間付きの要素やアニメーション要素等の抜け道を塞ぎきれないため。
// フキダシの中のテキスト（g.balloon-shape の子）と、defs 内のテキストは対象外
const SVG_NS = 'http://www.w3.org/2000/svg';
const SAFE_TEXT_ATTRS = ['x', 'y', 'dx', 'dy', 'rotate', 'font-size', 'font-family', 'font-weight', 'font-style',
    'letter-spacing', 'word-spacing', 'text-anchor', 'transform', 'data-scale-x', 'data-scale-y'];
const SAFE_STYLE_PROPS = new Set(['white-space', 'writing-mode', 'text-orientation', 'font-size', 'font-family', 'font-weight',
    'font-style', 'letter-spacing', 'word-spacing', 'text-anchor', 'line-height']);
const SAFE_VALUE = /^[\w\s.,%#'"+\-\u0080-\uFFFF]*$/;   // 括弧・セミコロン・コロン・スラッシュを通さない（url() や式を入れられない）
const SAFE_TRANSFORM = /^(?:\s*(?:matrix|translate|scale|rotate|skewX|skewY)\([\d\s.,eE+\-]*\)\s*,?)*$/;

function copySafeAttrs(from, to) {
    for (const name of SAFE_TEXT_ATTRS) {
        const v = from.getAttribute(name);
        if (v == null) continue;
        if (!(name === 'transform' ? SAFE_TRANSFORM : SAFE_VALUE).test(v)) continue;
        to.setAttribute(name, v);
    }
    const style = from.getAttribute('style');
    if (style) {
        const kept = [];
        for (const decl of style.split(';')) {
            const i = decl.indexOf(':');
            if (i < 0) continue;
            const prop = decl.slice(0, i).trim().toLowerCase(), val = decl.slice(i + 1).trim();
            if (SAFE_STYLE_PROPS.has(prop) && SAFE_VALUE.test(val)) kept.push(`${prop}: ${val}`);
        }
        if (kept.length) to.setAttribute('style', kept.join('; '));
    }
}

// parsed（パースしただけのSVGルート）から対象の <text> だけを写した新しいSVGを作る。対象が無ければ null
function buildTextOnlySvg(parsed, svg) {
    const fresh = document.createElementNS(SVG_NS, 'svg');
    const nums = (parsed.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    const vb = nums.length === 4 && nums.every(Number.isFinite) && nums[2] > 0 && nums[3] > 0
        ? { x: nums[0], y: nums[1], width: nums[2], height: nums[3] } : { x: 0, y: 0, width: svg.w, height: svg.h };
    fresh.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width} ${vb.height}`);
    fresh.setAttribute('width', '1000');
    fresh.setAttribute('height', String(1000 * vb.height / vb.width));
    let count = 0;
    for (const el of parsed.getElementsByTagNameNS(SVG_NS, 'text')) {
        if (!el.textContent.trim() || el.closest('g.balloon-shape, defs, clipPath, mask, pattern')) continue;
        const t = document.createElementNS(SVG_NS, 'text');
        copySafeAttrs(el, t);
        for (const node of el.childNodes) {
            if (node.nodeType === 3) {
                t.appendChild(document.createTextNode(node.nodeValue));
            } else if (node.nodeType === 1 && node.namespaceURI === SVG_NS && node.localName === 'tspan') {
                const ts = document.createElementNS(SVG_NS, 'tspan');
                copySafeAttrs(node, ts);
                ts.textContent = node.textContent;
                t.appendChild(ts);
            }
        }
        // 祖先の g の transform だけを、同じ入れ子で再現する（グループ移動・回転の位置を保つため）
        let node = t;
        for (let a = el.parentNode; a && a !== parsed; a = a.parentNode) {
            const tr = a.localName === 'g' && a.namespaceURI === SVG_NS ? a.getAttribute('transform') : null;
            if (tr && SAFE_TRANSFORM.test(tr)) {
                const g = document.createElementNS(SVG_NS, 'g');
                g.setAttribute('transform', tr);
                g.appendChild(node);
                node = g;
            }
        }
        fresh.appendChild(node);
        count++;
    }
    return count ? { svg: fresh, vb } : null;
}

async function extractFreeTexts(rec, svg) {
    const sources = [rec.overlaySvgContent, ...(rec.panels || []).map(p => p.panelSvgContent)].filter(Boolean);
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed; left:-100000px; top:0; width:1000px; pointer-events:none; opacity:0;';
    document.body.appendChild(holder);
    const out = [];
    try {
        for (const src of sources) {
            const parsedDoc = new DOMParser().parseFromString(src, 'image/svg+xml');
            const parsed = parsedDoc.documentElement;
            if (!parsed || parsed.localName !== 'svg' || parsedDoc.querySelector('parsererror')) continue;
            const built = buildTextOnlySvg(parsed, svg);
            if (!built) continue;
            const { svg: rootEl, vb } = built;
            holder.replaceChildren(rootEl);
            const texts = [...rootEl.querySelectorAll('text')];
            rootEl.getBoundingClientRect();        // レイアウトを走らせ、Webフォントの読み込みを始めさせる
            try { await document.fonts.ready; } catch (_) { /* ignore */ }
            const rr = rootEl.getBoundingClientRect();
            const k = vb.width / rr.width;
            for (const el of texts) {
                const r = el.getBoundingClientRect();
                if (!(r.width > 0) || !(r.height > 0)) continue;
                const tspans = [...el.querySelectorAll('tspan')].map(ts => ts.textContent);
                const text = (tspans.length ? tspans : [el.textContent]).join('\n').replace(/\s+$/, '');
                if (!text.trim()) continue;
                const num = (name, def) => { const v = parseFloat(el.getAttribute(name)); return Number.isFinite(v) && v > 0 ? v : def; };
                const fontSize = num('font-size', parseFloat(getComputedStyle(el).fontSize) || 0);
                const w = r.width * k, h = r.height * k;
                const x = vb.x + (r.left - rr.left) * k, y = vb.y + (r.top - rr.top) * k;
                out.push({
                    text, x, y, w, h, cx: x + w / 2, cy: y + h / 2, ry: h / 2,
                    vertical: /^vertical/.test(getComputedStyle(el).writingMode || ''),
                    fontSizeSvg: fontSize * Math.sqrt(num('data-scale-x', 1) * num('data-scale-y', 1)),   // 縦横の拡縮は幾何平均で
                });
            }
        }
    } finally {
        holder.remove();
    }
    return sortReadingOrder(out);
}

// 単独テキストの用途の推定: 短い（6文字以下）なら擬音、それ以外はナレーション文として caption に英文で入れる
const textCaptionOf = (text) => ([...text.replace(/\s/g, '')].length <= 6 ? 'Sound effect.' : 'Narration text.');

async function importBalloons() {
    const rec = await getActivePageRecord();
    if (!rec) { alert(t('layout.msgNoActivePage')); return; }
    const svg = pageSvgSizeOf(rec);
    const includeTexts = $('moss-import-texts').checked;
    const list = extractBalloons(rec);
    const texts = includeTexts ? await extractFreeTexts(rec, svg) : [];
    if (!list.length && !texts.length) { alert(t('moss.noBalloons')); return; }
    // キャンバスの縦横比がページと違えば、ページに合わせる（既存の枠も同じ比率で拡縮する）
    if (Math.abs((S.W / S.H) / (svg.w / svg.h) - 1) > 0.02) {
        if (S.items.length && !confirm(t('moss.confirmFitCanvas'))) return;
        const { w, h } = sizeForAspect(svg.w / svg.h, PAGE_TARGET_PIXELS);
        const kx = w / S.W, ky = h / S.H;
        for (const it of S.items) {
            it.x *= kx; it.w *= kx; it.y *= ky; it.h *= ky;
            if (it.fontSize > 0) it.fontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(it.fontSize * ky)));
        }
        setSize(w, h);
    }
    // 再取込: 前回取り込んだ枠だけ入れ替える（手で足した枠は残す）。単独テキストを含めないときは、前回の単独テキストの枠も残す
    S.items = S.items.filter(i => !(i.src === 'balloon' || (includeTexts && i.src === 'text')));
    if (S.selId && !S.items.some(i => i.id === S.selId)) S.selId = null;
    const sx = S.W / svg.w, sy = S.H / svg.h;
    const fontPx = (fs) => (fs > 0 ? Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(fs * sy))) : 0);
    const place = (x, y, w, h) => {
        const px = clamp(x * sx, 0, S.W - MIN_BOX_PX), py = clamp(y * sy, 0, S.H - MIN_BOX_PX);
        return { x: px, y: py, w: Math.min(w * sx, S.W - px), h: Math.min(h * sy, S.H - py) };
    };
    for (const b of list) {
        const it = addItem({
            type: 'text', src: 'balloon', text: b.text, vertical: b.vertical, fitBox: false,   // 枠はフキダシの輪郭（文字の大きさに合わせない）
            caption: BALLOON_PHRASE[b.shapeType] || 'Speech bubble.',
            ...place(b.cx - b.rx, b.cy - b.ry, b.rx * 2, b.ry * 2), fontSize: fontPx(b.fontSizeSvg),
        });
        if (!(it.fontSize > 0)) it.fontSize = fitFontToBox(it);
    }
    for (const b of texts) {
        // 単独テキストの枠は、実測した文字の範囲に少し余白を足したもの
        const pad = b.fontSizeSvg > 0 ? b.fontSizeSvg * 0.15 : 0;
        const it = addItem({
            type: 'text', src: 'text', text: b.text, vertical: b.vertical, fitBox: false,
            caption: textCaptionOf(b.text),
            ...place(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2), fontSize: fontPx(b.fontSizeSvg),
        });
        if (!(it.fontSize > 0)) it.fontSize = fitFontToBox(it);
    }
    renderCanvas(); schedulePreview(); scheduleSave();
    $('moss-progress-text').textContent = t('moss.balloonsImported', list.length + texts.length);
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
    const randomSeed = (v('moss-seed-mode') || 'random') === 'random';   // ランダムのときは入力欄の値に関係なく毎回-1（サーバー側で乱数）
    return {
        negative_prompt: v('moss-negative'),
        unet: v('moss-unet'), clip: v('moss-clip'), vae: v('moss-vae'),
        lora: v('moss-lora'), lora_strength: Number(v('moss-lora-strength')),
        steps: Number(v('moss-steps')), cfg: Number(v('moss-cfg')),
        sampler: v('moss-sampler'), scheduler: v('moss-scheduler'), slg: $('moss-slg').checked,
        seed: !randomSeed && seedRaw >= 0 ? Math.floor(seedRaw) : -1,
        enhance_prompt: $('moss-enhance').checked,
    };
}

// ─── シード ───
// ランダム: 毎回ランダム（入力欄は使わない）／固定: 入力欄の値／生成ごとに+1: 入力欄の値から始め、生成後に使った枚数ぶん進める
// （入力欄が負のときは初回だけランダム）。ランダムで使われたシードは「直前のシード」に表示し、「このシードを固定」で再現用に固定できる
function updateSeedUi() {
    const mode = $('moss-seed-mode').value;
    $('moss-seed').disabled = mode === 'random';
    $('moss-seed-keep').disabled = S.lastSeed == null;
    $('moss-seed-last').textContent = S.lastSeed == null ? '' : t('moss.seedLast', S.lastSeed);
}

function afterSeedUsed(usedSeed, nextSeed) {
    S.lastSeed = usedSeed;
    if ($('moss-seed-mode').value === 'increment') $('moss-seed').value = nextSeed;
    updateSeedUi();
    scheduleSave();
}

function initSeedControls() {
    $('moss-seed-mode').addEventListener('change', () => { updateSeedUi(); scheduleSave(); });
    $('moss-seed-keep').addEventListener('click', () => {
        if (S.lastSeed == null) return;
        $('moss-seed-mode').value = 'fixed';
        $('moss-seed').value = S.lastSeed;
        updateSeedUi();
        scheduleSave();
    });
    updateSeedUi();
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
            afterSeedUsed(d.seed, d.seed + body.num_images);
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
    let firstSeed = null;
    for (let i = 0; i < targets.length; i++) {
        const p = targets[i];
        progress.textContent = t('moss.generatingPanel', i + 1, targets.length);
        const { w, h } = sizeForAspect(p.bbox.width / p.bbox.height, PANEL_TARGET_PIXELS);
        const prompt = [mainPrompt, p.caption.trim()].filter(Boolean).join('\n');
        if (!prompt) { alert(t('moss.promptEmpty')); return; }
        const d = await postGenerate({ ...base, prompt, width: w, height: h, num_images: 1, seed: base.seed >= 0 ? base.seed + i : -1 });
        if (firstSeed == null) firstSeed = d.seed;
        const im = d.images[0];
        all.push({ url: viewUrl(im), im, w: d.width, h: d.height });
        await insertIntoPanel(viewUrl(im), p.id, p.bbox);
    }
    showResults(all);
    if (firstSeed != null) afterSeedUsed(firstSeed, (base.seed >= 0 ? base.seed : firstSeed) + targets.length);
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
            for (const k of ['prompt', 'json', 'model']) {
                const el = $(`moss-subtab-${k}`);
                if (el) el.style.display = k === key ? '' : 'none';
            }
            try { localStorage.setItem(SUBTAB_KEY, key); } catch (_) { /* ignore */ }
            if (key === 'json') refreshPreview();
        });
    });
}

async function initMossTabOnce() {
    const saved = loadSettings();
    initSubtabs();
    try {
        const last = localStorage.getItem(SUBTAB_KEY);
        if (['prompt', 'json', 'model'].includes(last)) document.querySelector(`[data-moss-subtab="${last}"]`)?.click();
    } catch (_) { /* ignore */ }
    initCanvasInteraction();
    initItemProps();
    initDrawTypeButtons();
    initWritingToggle();
    initSeedControls();
    initTargetCollapse();
    await loadModelLists(saved);

    if (saved) {
        for (const id of FIELD_IDS) {
            const el = $(id);
            if (!el || saved[id] === undefined) continue;
            if (['moss-unet', 'moss-clip', 'moss-vae', 'moss-lora', 'moss-sampler', 'moss-scheduler'].includes(id)) continue;  // 一覧に存在する値のみ loadModelLists が復元済み
            if (el.type === 'checkbox') el.checked = !!saved[id]; else el.value = saved[id];
        }
        S.items = Array.isArray(saved.items) ? saved.items : [];
        S.writingVertical = !!saved.writingVertical;
        S.W = Number(saved.W) || S.W; S.H = Number(saved.H) || S.H;   // fitFontToBoxが現在のキャンバスサイズを使うため先に復元
        for (const it of S.items) if (it.type === 'text' && !(it.fontSize > 0)) it.fontSize = fitFontToBox(it);   // フォントサイズ導入前の保存データ
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
    $('moss-layout-import-balloons-btn').addEventListener('click', importBalloons);
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

export { initMossTab, extractBalloons, extractFreeTexts };
