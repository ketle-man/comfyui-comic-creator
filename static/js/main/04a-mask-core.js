// ============================================================
// マスクレイヤー機能 分割ファイル (1/2): マスク機能ロジック(_mask*ヘルパー群・初期化)
// 元 04-mask-layers.js（分割前）の行 1-829 に相当
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: MASK_MAX_DIM,_maskAddLayerAndEdit,_maskAddLayerImg,_maskAttachOverlay,_maskBakeAndSave,_maskBrushCanvasPx,_maskBuildComposite,_maskClientToCanvas,_maskCreateLayerCanvas,_maskCurrentTarget,_maskDeleteLayer,_maskDetachOverlay,_maskEnsureDefShell,_maskEnsureElId,_maskFillAll,_maskGetDef,_maskIdFor,_maskIsObjectTarget,_maskLayerImgs,_maskLayerInfo,_maskLayerList,_maskLoadLayerCanvas,_maskOpenEditorFor,_maskPointerDown,_maskPointerLeave,_maskPointerMove,_maskPointerUp,_maskReassignObject,_maskRegionFor,_maskRenderOverlay,_maskSaveFor,_maskSelectedObjectEl,_maskSetEditing,_maskSetEnabled,_maskStamp,_maskStampLine,_maskStartEdit,_maskState,_maskSvgToOverlay,_maskSyncBase,_maskTargetGroup,_maskTargetLabel,_maskToggleLayerVisible,_maskTypeLabel,_maskUpdateCursor,_maskUpdateUI,initMaskTool
// ============================================================

// ============================================================
// マスクレイヤー機能（レイアウトタブ: コマ / オーバーレイ、複数レイヤー対応）
//
// 対象（コマ/オーバーレイ）ごとに1つの SVG <mask> を適用し、その中に
// マスクレイヤー = <image data-ccc-mask-layer> を複数持つ。
//   - 隠すマスク (type=hide): 黒塗り（透明地）。黒=輝度0で塗った所を隠す
//   - 表示マスク (type=show): 白塗り（透明地）。塗った所だけ表示（複数は合算）
//   - ベース: 可視の表示マスクが1つも無い場合のみ白rect（全表示から減算する動作）
// SVGマスクは輝度×アルファで評価されるため、レイヤーを文書順に重ね描き
// するだけで add/subtract 合成になる（後のレイヤーが優先）。
// 参考: ComfyUI-Workflow-Studio Image Edit タブの MaskTool / LayerManager
// ============================================================

const MASK_MAX_DIM = 1400;   // マスクレイヤーcanvasの最大辺（px）

const _maskState = {
    editing: false,
    target: null,          // 'panel_x' | '__overlay__'
    layerId: null,         // 編集中レイヤーID
    layerType: 'hide',     // 編集中レイヤーの種別 'hide' | 'show'
    maskCanvas: null,      // 編集中レイヤーのオフスクリーンcanvas（透明地＋黒or白塗り）
    compLayers: [],        // 合成用: [{id, type, visible, canvas}] 文書順（activeはmaskCanvas参照）
    region: null,          // {x, y, w, h} SVG userSpace
    overlayCanvas: null,   // 編集用オーバーレイ（赤プレビュー＋カーソル）
    drawing: false,
    lastPt: null,
    cursorPt: null,
    brushMode: 'paint',    // 'paint' | 'erase'
    brushSize: 60,         // 画面px
    hardness: 0.8,
    showRed: true,
    historyPushed: false,  // 編集セッション中に一度だけ pushHistory
    pageName: null,        // 編集ON時のページ名（ページ切替時の持ち越し防止）
};

function _maskIdFor(target) { return `ccc-mask-${target}`; }

// 対象がオブジェクト（画像/フキダシ/テキスト/図形/グループ）か判定
// （コマID・オーバーレイ以外はオブジェクトIDとみなす）
function _maskIsObjectTarget(target) {
    if (!target || target === '__overlay__') return false;
    return !(state.activePage?.panels || []).some(p => p.id === target);
}

// 選択中のオブジェクト要素（マスク対象候補）
function _maskSelectedObjectEl() {
    const svgEl = getPanelLayerSvg();
    return state.selectedImageEl
        || (state.selectedShapeId ? svgEl?.querySelector(`[id="${state.selectedShapeId}"]`) : null)
        || state.selectedTextEl
        || state.selectedDrawEl
        || (state.selectedGroupId ? svgEl?.querySelector(`[id="${state.selectedGroupId}"]`) : null)
        || null;
}

// 要素にマスク参照用のIDを保証する
function _maskEnsureElId(el) {
    if (!el.id) el.id = 'ccc-el-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    return el.id;
}

// 現在の選択からマスク対象を求める
// オブジェクト選択中はそのオブジェクト（レイヤーマスク）、
// それ以外はコマ / オーバーレイ全体（panel-0 はオーバーレイ扱い）
function _maskCurrentTarget() {
    const obj = _maskSelectedObjectEl();
    if (obj) return _maskEnsureElId(obj);
    if (state.selectedOverlay) return '__overlay__';
    if (!state.selectedPanelId) return null;
    if (state.selectedPanelId === 'panel-0' || state.selectedPanelId === '__overlay__') return '__overlay__';
    return state.selectedPanelId;
}

function _maskTargetLabel(target) {
    if (!target) return t('layout.notSelected');
    if (target === '__overlay__') return t('common.overlayFull');
    if (_maskIsObjectTarget(target)) {
        const el = getPanelLayerSvg()?.querySelector(`[id="${target}"]`);
        return el?.dataset?.name || t('mask.layerLabel', target);
    }
    const panels = state.activePage?.panels || [];
    const p = panels.find(pp => pp.id === target);
    const num = p ? ((p.number !== undefined) ? p.number : panels.indexOf(p) + 1) : '?';
    return t('common.panelName', num);
}

function _maskTypeLabel(type) { return type === 'show' ? t('mask.typeShow') : t('mask.typeHide'); }

// マスクを適用する対象要素（コマg / オーバーレイg / 個別オブジェクト）
function _maskTargetGroup(svgEl, target) {
    if (target === '__overlay__') return svgEl.querySelector('g[data-overlay-layer]');
    if (_maskIsObjectTarget(target)) return svgEl.querySelector(`[id="${target}"]`);
    return svgEl.querySelector(`g[data-clip-panel="${target}"]`);
}

// 対象の保存先（オブジェクトは所属コマ/オーバーレイに合わせて保存）
async function _maskSaveFor(svgEl, target) {
    let ownerPanel = null;
    let isOverlay = (target === '__overlay__');
    if (!isOverlay && _maskIsObjectTarget(target)) {
        const el = svgEl.querySelector(`[id="${target}"]`);
        const pg = el?.closest('g[data-clip-panel]');
        if (pg) ownerPanel = pg.getAttribute('data-clip-panel');
        else isOverlay = true;   // オーバーレイ配下 or 不明はオーバーレイ側へ
    } else if (!isOverlay) {
        ownerPanel = target;
    }
    if (isOverlay) await saveOverlaySvg(svgEl);
    else await savePanelSvg(ownerPanel, svgEl);
}

function _maskGetDef(svgEl, target) {
    return svgEl.querySelector(`mask[data-ccc-mask="${target}"]`);
}

// mask def 内のレイヤー<image>一覧（文書順）。旧単一マスク形式は表示マスクへ移行
function _maskLayerImgs(def) {
    if (!def) return [];
    const imgs = Array.from(def.querySelectorAll('image'));
    imgs.forEach((img, i) => {
        if (!img.getAttribute('data-ccc-mask-layer')) {
            // 旧形式（白地に穴 = 表示マスク相当）を移行
            img.setAttribute('data-ccc-mask-layer', `ml_${Date.now().toString(36)}_${i}`);
            img.setAttribute('data-ccc-mask-type', 'show');
            if (!img.getAttribute('data-ccc-mask-name')) img.setAttribute('data-ccc-mask-name', t('mask.defaultName', i + 1));
            img.removeAttribute('data-ccc-mask-img');
        }
    });
    return imgs;
}

function _maskLayerInfo(img) {
    return {
        id:      img.getAttribute('data-ccc-mask-layer'),
        name:    img.getAttribute('data-ccc-mask-name') || t('mask.nameFallback'),
        type:    img.getAttribute('data-ccc-mask-type') === 'show' ? 'show' : 'hide',
        visible: img.getAttribute('display') !== 'none',
        imgEl:   img,
    };
}

// 対象のマスクレイヤー一覧（文書順）
function _maskLayerList(svgEl, target) {
    return _maskLayerImgs(_maskGetDef(svgEl, target)).map(_maskLayerInfo);
}

// 対象のマスク領域（SVG userSpace）
// オブジェクト対象の場合は所属コマのbbox（オーバーレイ配下ならページ全面）
function _maskRegionFor(target) {
    const svgEl = getPanelLayerSvg();
    if (!svgEl || !state.activePage) return null;
    const vb = (svgEl.getAttribute('viewBox') || '0 0 21000 29700').split(/\s+/).map(Number);
    const pageRegion = { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
    if (target === '__overlay__') return pageRegion;

    let panelId = target;
    if (_maskIsObjectTarget(target)) {
        const el = svgEl.querySelector(`[id="${target}"]`);
        const pg = el?.closest('g[data-clip-panel]');
        if (!pg) return pageRegion;   // オーバーレイ配下のオブジェクト
        panelId = pg.getAttribute('data-clip-panel');
    }
    const panel = (state.activePage.panels || []).find(p => p.id === panelId);
    if (!panel) return pageRegion;
    if (panel.points) {
        const bbox = getBoundingBoxFromPoints(panel.points);
        if (bbox) return { x: bbox.x, y: bbox.y, w: bbox.width, h: bbox.height };
    }
    if (panel.width) return { x: panel.x, y: panel.y, w: panel.width, h: panel.height };
    return pageRegion;
}

// レイヤー用の透明canvasを生成
function _maskCreateLayerCanvas(region) {
    const scale = Math.min(1, MASK_MAX_DIM / Math.max(region.w, region.h));
    const c = document.createElement('canvas');
    c.width  = Math.max(8, Math.round(region.w * scale));
    c.height = Math.max(8, Math.round(region.h * scale));
    return c;
}

// <image> の href をcanvasに読み込む
async function _maskLoadLayerCanvas(imgEl, region) {
    const canvas = _maskCreateLayerCanvas(region);
    const href = imgEl?.getAttribute('href');
    if (href && href.startsWith('data:image/')) {
        try {
            const img = new Image();
            await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = href; });
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        } catch (_) {}
    }
    return canvas;
}

// mask def の外枠を確保し、対象グループへ適用する（レイヤーは追加しない）
function _maskEnsureDefShell(svgEl, target, region) {
    const ns = 'http://www.w3.org/2000/svg';
    let defs = svgEl.querySelector('defs');
    if (!defs) {
        defs = document.createElementNS(ns, 'defs');
        svgEl.insertBefore(defs, svgEl.firstChild);
    }
    let def = _maskGetDef(svgEl, target);
    if (!def) {
        def = document.createElementNS(ns, 'mask');
        def.setAttribute('id', _maskIdFor(target));
        def.setAttribute('data-ccc-mask', target);
        def.setAttribute('maskUnits', 'userSpaceOnUse');
        defs.appendChild(def);
    }
    def.setAttribute('x', region.x);
    def.setAttribute('y', region.y);
    def.setAttribute('width',  region.w);
    def.setAttribute('height', region.h);

    const g = _maskTargetGroup(svgEl, target);
    if (g && !g.hasAttribute('data-ccc-mask-off')) {
        g.setAttribute('mask', `url(#${_maskIdFor(target)})`);
    }
    return def;
}

// ベース白rectの同期: 可視の表示マスクが無ければ白ベース（全表示から減算する動作）
function _maskSyncBase(def, region) {
    const ns = 'http://www.w3.org/2000/svg';
    const hasVisibleShow = _maskLayerImgs(def).some(img => {
        const info = _maskLayerInfo(img);
        return info.visible && info.type === 'show';
    });
    let base = def.querySelector('rect[data-ccc-mask-base]');
    if (hasVisibleShow) {
        base?.remove();
    } else {
        if (!base) {
            base = document.createElementNS(ns, 'rect');
            base.setAttribute('data-ccc-mask-base', '1');
            base.setAttribute('fill', '#ffffff');
        }
        base.setAttribute('x', region.x);
        base.setAttribute('y', region.y);
        base.setAttribute('width',  region.w);
        base.setAttribute('height', region.h);
        def.insertBefore(base, def.firstChild);   // 常に最背面
    }
}

// 新規マスクレイヤーを追加（空 = 効果なしの状態）して <image> を返す
function _maskAddLayerImg(svgEl, target, region, type) {
    const ns = 'http://www.w3.org/2000/svg';
    const def = _maskEnsureDefShell(svgEl, target, region);
    const count = _maskLayerImgs(def).length;
    const img = document.createElementNS(ns, 'image');
    img.setAttribute('data-ccc-mask-layer', `ml_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`);
    img.setAttribute('data-ccc-mask-type', type === 'show' ? 'show' : 'hide');
    img.setAttribute('data-ccc-mask-name', t('mask.defaultName', count + 1));
    img.setAttribute('preserveAspectRatio', 'none');
    img.setAttribute('x', region.x);
    img.setAttribute('y', region.y);
    img.setAttribute('width',  region.w);
    img.setAttribute('height', region.h);
    img.setAttribute('href', _maskCreateLayerCanvas(region).toDataURL('image/png'));
    def.appendChild(img);   // 末尾 = 最前面（後勝ち）
    _maskSyncBase(def, region);
    return img;
}

// ── 合成・ベイク ─────────────────────────────────────────

// 全レイヤーをSVGマスクと同じ意味で合成したcanvasを返す（不透明=表示・透明=非表示）
function _maskBuildComposite() {
    const { compLayers, maskCanvas, layerId } = _maskState;
    const ref = maskCanvas || compLayers.find(l => l.canvas)?.canvas;
    if (!ref) return null;
    const c = document.createElement('canvas');
    c.width = ref.width; c.height = ref.height;
    const ctx = c.getContext('2d');
    const hasVisibleShow = compLayers.some(l => l.visible && l.type === 'show');
    if (!hasVisibleShow) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);
    }
    for (const l of compLayers) {
        if (!l.visible) continue;
        const src = (l.id === layerId) ? maskCanvas : l.canvas;
        if (!src) continue;
        ctx.globalCompositeOperation = l.type === 'show' ? 'source-over' : 'destination-out';
        ctx.drawImage(src, 0, 0, c.width, c.height);
    }
    ctx.globalCompositeOperation = 'source-over';
    return c;
}

// 編集中レイヤーを live DOM の <image> に反映して永続化
async function _maskBakeAndSave() {
    const svgEl = getPanelLayerSvg();
    const { target, layerId, maskCanvas, region } = _maskState;
    if (!svgEl || !target || !layerId || !maskCanvas || !region) return;
    const def = _maskGetDef(svgEl, target);
    const img = def?.querySelector(`image[data-ccc-mask-layer="${layerId}"]`);
    if (!img) return;
    img.setAttribute('href', maskCanvas.toDataURL('image/png'));
    _maskSyncBase(def, region);
    await _maskSaveFor(svgEl, target);
    renderLayerPanel();
}

// ── ブラシ ──────────────────────────────────────────────

function _maskBrushCanvasPx() {
    const svgEl = getPanelLayerSvg();
    const { region, maskCanvas } = _maskState;
    if (!svgEl || !region || !maskCanvas) return 20;
    const ctm = svgEl.getScreenCTM();
    const svgPerScreen = ctm ? 1 / Math.abs(ctm.a || 1) : 1;
    const canvasPerSvg = maskCanvas.width / region.w;
    return Math.max(2, _maskState.brushSize * svgPerScreen * canvasPerSvg);
}

function _maskStamp(cx, cy, sizePx) {
    const ctx = _maskState.maskCanvas.getContext('2d');
    const r = sizePx / 2;
    const hardness = Math.min(_maskState.hardness, 0.99);
    // 塗り色: 隠すマスク=黒 / 表示マスク=白（消すはどちらも destination-out）
    const rgb = _maskState.layerType === 'show' ? '255,255,255' : '0,0,0';
    const grd = ctx.createRadialGradient(cx, cy, r * hardness * 0.95, cx, cy, r);
    grd.addColorStop(0, `rgba(${rgb},1)`);
    grd.addColorStop(1, `rgba(${rgb},0)`);
    ctx.globalCompositeOperation = _maskState.brushMode === 'erase' ? 'destination-out' : 'source-over';
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
}

function _maskStampLine(p0, p1, sizePx) {
    const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const step = Math.max(1, sizePx * 0.2);
    const steps = Math.max(1, Math.ceil(dist / step));
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        _maskStamp(p0.x + (p1.x - p0.x) * t, p0.y + (p1.y - p0.y) * t, sizePx);
    }
}

// ── 座標変換 ────────────────────────────────────────────

function _maskClientToCanvas(clientX, clientY) {
    const { region, maskCanvas } = _maskState;
    if (!region || !maskCanvas) return null;
    const svgPt = _layerDrawClientToSvg(clientX, clientY);
    return {
        x: (svgPt.x - region.x) / region.w * maskCanvas.width,
        y: (svgPt.y - region.y) / region.h * maskCanvas.height,
    };
}

function _maskSvgToOverlay(svgX, svgY) {
    const svgEl = getPanelLayerSvg();
    const canvas = _maskState.overlayCanvas;
    if (!svgEl || !canvas) return { x: 0, y: 0 };
    const pt = svgEl.createSVGPoint();
    pt.x = svgX; pt.y = svgY;
    const clientPt = pt.matrixTransform(svgEl.getScreenCTM());
    const rect = canvas.getBoundingClientRect();
    return { x: clientPt.x - rect.left, y: clientPt.y - rect.top };
}

// ── 編集オーバーレイ ─────────────────────────────────────

function _maskAttachOverlay() {
    _maskDetachOverlay();
    const svgEl = getPanelLayerSvg();
    const imageLayer = document.getElementById('image-layer');
    if (!svgEl || !imageLayer) return false;

    const canvas = document.createElement('canvas');
    canvas.id = '_mask-edit-overlay';
    canvas.style.cssText = 'position:absolute; top:0; left:0; cursor:crosshair; z-index:100; pointer-events:auto;';
    imageLayer.style.position = 'relative';
    const rect = svgEl.getBoundingClientRect();
    const parentRect = imageLayer.getBoundingClientRect();
    canvas.width  = Math.round(rect.width);
    canvas.height = Math.round(rect.height);
    canvas.style.left = (rect.left - parentRect.left) + 'px';
    canvas.style.top  = (rect.top  - parentRect.top)  + 'px';
    imageLayer.appendChild(canvas);
    _maskState.overlayCanvas = canvas;

    canvas.addEventListener('pointerdown', _maskPointerDown);
    canvas.addEventListener('pointermove', _maskPointerMove);
    canvas.addEventListener('pointerup',   _maskPointerUp);
    canvas.addEventListener('pointerleave', _maskPointerLeave);
    _maskRenderOverlay();
    return true;
}

function _maskDetachOverlay() {
    const c = document.getElementById('_mask-edit-overlay');
    if (c) c.remove();
    _maskState.overlayCanvas = null;
    _maskState.drawing = false;
    _maskState.cursorPt = null;
}

// 赤プレビュー（合成結果の非表示部分）＋領域枠＋ブラシカーソルを描画
function _maskRenderOverlay() {
    const { overlayCanvas, region } = _maskState;
    if (!overlayCanvas) return;
    const ctx = overlayCanvas.getContext('2d');
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    if (!region) return;

    const tl = _maskSvgToOverlay(region.x, region.y);
    const br = _maskSvgToOverlay(region.x + region.w, region.y + region.h);
    const rw = br.x - tl.x, rh = br.y - tl.y;

    if (_maskState.showRed) {
        const comp = _maskBuildComposite();
        if (comp) {
            const tmp = document.createElement('canvas');
            tmp.width = comp.width; tmp.height = comp.height;
            const tctx = tmp.getContext('2d');
            tctx.fillStyle = 'rgba(255,0,0,0.45)';
            tctx.fillRect(0, 0, tmp.width, tmp.height);
            tctx.globalCompositeOperation = 'destination-out';
            tctx.drawImage(comp, 0, 0);
            ctx.drawImage(tmp, tl.x, tl.y, rw, rh);
        }
    }

    // 対象領域の枠
    ctx.strokeStyle = 'rgba(80,160,255,0.8)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(tl.x, tl.y, rw, rh);
    ctx.setLineDash([]);

    // ブラシカーソル
    if (_maskState.cursorPt) {
        ctx.strokeStyle = _maskState.brushMode === 'erase' ? 'rgba(120,255,120,0.9)' : 'rgba(255,80,80,0.9)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(_maskState.cursorPt.x, _maskState.cursorPt.y, _maskState.brushSize / 2, 0, Math.PI * 2);
        ctx.stroke();
    }
}

// ── ポインタ操作 ─────────────────────────────────────────

function _maskPointerDown(ev) {
    if (ev.button !== 0) return;
    ev.preventDefault();
    _maskState.overlayCanvas?.setPointerCapture(ev.pointerId);
    const pt = _maskClientToCanvas(ev.clientX, ev.clientY);
    if (!pt) return;
    if (!_maskState.historyPushed) {
        pushHistory();
        _maskState.historyPushed = true;
    }
    _maskState.drawing = true;
    _maskState.lastPt = pt;
    _maskStamp(pt.x, pt.y, _maskBrushCanvasPx());
    _maskUpdateCursor(ev);
    _maskRenderOverlay();
}

function _maskPointerMove(ev) {
    _maskUpdateCursor(ev);
    if (_maskState.drawing) {
        const pt = _maskClientToCanvas(ev.clientX, ev.clientY);
        if (pt && _maskState.lastPt) {
            _maskStampLine(_maskState.lastPt, pt, _maskBrushCanvasPx());
            _maskState.lastPt = pt;
        }
    }
    _maskRenderOverlay();
}

async function _maskPointerUp() {
    if (!_maskState.drawing) return;
    _maskState.drawing = false;
    _maskState.lastPt = null;
    await _maskBakeAndSave();
    _maskRenderOverlay();
}

function _maskPointerLeave() {
    _maskState.cursorPt = null;
    if (_maskState.drawing) { _maskPointerUp(); return; }
    _maskRenderOverlay();
}

function _maskUpdateCursor(ev) {
    const canvas = _maskState.overlayCanvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    _maskState.cursorPt = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
}

// ── 編集モード制御 ───────────────────────────────────────

// 指定レイヤーの編集を開始する（layerId 省略時は最前面レイヤー。レイヤーが無ければ新規追加）
async function _maskStartEdit(target, layerId = null) {
    const svgEl = getPanelLayerSvg();
    if (!svgEl || !target) { _maskUpdateUI(); return; }
    const region = _maskRegionFor(target);
    if (!region) { alert(t('mask.errNoRegion')); _maskUpdateUI(); return; }

    let layers = _maskLayerList(svgEl, target);
    let created = false;
    if (layerId && !layers.some(l => l.id === layerId)) layerId = null;
    if (layers.length === 0) {
        // レイヤーが無ければ新規追加（種類はサブタブのセレクトに従う）
        pushHistory();
        const type = document.getElementById('mask-new-type')?.value === 'show' ? 'show' : 'hide';
        _maskAddLayerImg(svgEl, target, region, type);
        created = true;
        layers = _maskLayerList(svgEl, target);
    }
    const active = layerId ? layers.find(l => l.id === layerId) : layers[layers.length - 1];

    _maskState.target = target;
    _maskState.layerId = active.id;
    _maskState.layerType = active.type;
    _maskState.region = region;
    _maskState.historyPushed = created;   // 新規作成なら push 済み
    _maskState.pageName = state.activePage?.name ?? null;

    // 全レイヤーを合成用にロード（編集対象は maskCanvas として保持）
    _maskState.compLayers = [];
    for (const l of layers) {
        const canvas = await _maskLoadLayerCanvas(l.imgEl, region);
        if (l.id === active.id) _maskState.maskCanvas = canvas;
        _maskState.compLayers.push({ id: l.id, type: l.type, visible: l.visible, canvas: (l.id === active.id) ? null : canvas });
    }

    if (created) await _maskBakeAndSave();

    _maskState.editing = _maskAttachOverlay();
    _maskUpdateUI();
}

async function _maskSetEditing(on) {
    if (on) {
        const target = _maskState.target || _maskCurrentTarget();
        if (!target) {
            alert(t('mask.selectTarget'));
            _maskUpdateUI();
            return;
        }
        await _maskStartEdit(target, _maskState.layerId);
    } else {
        _maskState.editing = false;
        _maskDetachOverlay();
        _maskUpdateUI();
    }
}

// レイヤー追加（追加後そのレイヤーの編集を開始）
async function _maskAddLayerAndEdit(target, type) {
    const svgEl = getPanelLayerSvg();
    if (!svgEl || !target) return;
    const region = _maskRegionFor(target);
    if (!region) { alert(t('mask.errNoRegion')); return; }
    pushHistory();
    const img = _maskAddLayerImg(svgEl, target, region, type);
    await _maskSaveFor(svgEl, target);
    renderLayerPanel();
    await _maskStartEdit(target, img.getAttribute('data-ccc-mask-layer'));
    _maskState.historyPushed = true;
}

// レイヤーの表示/非表示
async function _maskToggleLayerVisible(target, layerId) {
    const svgEl = getPanelLayerSvg();
    const def = svgEl ? _maskGetDef(svgEl, target) : null;
    const img = def?.querySelector(`image[data-ccc-mask-layer="${layerId}"]`);
    if (!img) return;
    pushHistory();
    if (img.getAttribute('display') === 'none') img.removeAttribute('display');
    else img.setAttribute('display', 'none');
    const region = _maskRegionFor(target);
    if (region) _maskSyncBase(def, region);
    await _maskSaveFor(svgEl, target);
    // 編集中なら合成キャッシュへ反映
    if (_maskState.editing && _maskState.target === target) {
        const entry = _maskState.compLayers.find(l => l.id === layerId);
        if (entry) entry.visible = img.getAttribute('display') !== 'none';
        _maskRenderOverlay();
    }
    renderLayerPanel();
}

// レイヤー削除（最後の1枚を消すとマスク自体を除去）
async function _maskDeleteLayer(target, layerId) {
    const svgEl = getPanelLayerSvg();
    const def = svgEl ? _maskGetDef(svgEl, target) : null;
    const img = def?.querySelector(`image[data-ccc-mask-layer="${layerId}"]`);
    if (!img) return;
    pushHistory();
    img.remove();
    const remaining = _maskLayerImgs(def);
    if (remaining.length === 0) {
        def.remove();
        const g = _maskTargetGroup(svgEl, target);
        if (g) {
            g.removeAttribute('mask');
            g.removeAttribute('data-ccc-mask-off');
        }
    } else {
        const region = _maskRegionFor(target);
        if (region) _maskSyncBase(def, region);
    }
    await _maskSaveFor(svgEl, target);

    if (_maskState.editing && _maskState.target === target) {
        _maskState.compLayers = _maskState.compLayers.filter(l => l.id !== layerId);
        if (_maskState.layerId === layerId) {
            _maskState.layerId = null;
            _maskState.maskCanvas = null;
            if (remaining.length > 0) await _maskStartEdit(target);
            else await _maskSetEditing(false);
        } else {
            _maskRenderOverlay();
        }
    }
    renderLayerPanel();
    _maskUpdateUI();
}

// オブジェクトマスクの付け替え（dir=+1: 1つ上のレイヤーへ / -1: 1つ下のレイヤーへ）
// レイヤーパネルの表示順は文書順の逆（最前面が上）なので、上=文書順で後
async function _maskReassignObject(target, dir) {
    const svgEl = getPanelLayerSvg();
    const el = svgEl?.querySelector(`[id="${target}"]`);
    if (!el) return;
    const parent = el.closest('g[data-clip-panel]') || el.closest('g[data-overlay-layer]');
    if (!parent) return;
    const objs = Array.from(parent.children).filter(c =>
        c.classList?.contains('balloon-shape') ||
        c.classList?.contains('inserted-image') ||
        c.classList?.contains('draw-shape') ||
        c.tagName.toLowerCase() === 'text' ||
        c.hasAttribute?.('data-group-id')
    );
    const idx = objs.indexOf(el);
    const next = objs[idx + dir];
    if (!next) return;   // これ以上先が無い
    _maskEnsureElId(next);
    if (_maskGetDef(svgEl, next.id)) {
        alert(t('mask.alreadyHasMask'));
        return;
    }
    pushHistory();
    const def = _maskGetDef(svgEl, target);
    if (!def) return;
    const off = el.hasAttribute('data-ccc-mask-off');
    def.setAttribute('data-ccc-mask', next.id);
    def.setAttribute('id', _maskIdFor(next.id));
    el.removeAttribute('mask');
    el.removeAttribute('data-ccc-mask-off');
    if (off) next.setAttribute('data-ccc-mask-off', '1');
    else next.setAttribute('mask', `url(#${_maskIdFor(next.id)})`);
    await _maskSaveFor(svgEl, next.id);
    if (_maskState.editing && _maskState.target === target) _maskState.target = next.id;
    renderLayerPanel();
    _maskUpdateUI();
}

// マスク全体の一時有効/無効（mask属性の付け外し。defは保持）
async function _maskSetEnabled(target, enabled) {
    const svgEl = getPanelLayerSvg();
    if (!svgEl || !target) return;
    const g = _maskTargetGroup(svgEl, target);
    if (!g) return;
    pushHistory();
    if (enabled) {
        g.removeAttribute('data-ccc-mask-off');
        if (_maskGetDef(svgEl, target)) g.setAttribute('mask', `url(#${_maskIdFor(target)})`);
    } else {
        g.removeAttribute('mask');
        g.setAttribute('data-ccc-mask-off', '1');
    }
    await _maskSaveFor(svgEl, target);
    renderLayerPanel();
}

// 編集中レイヤーへの一括操作: 全面塗り / クリア / 反転
async function _maskFillAll(mode) {
    const c = _maskState.maskCanvas;
    if (!_maskState.editing || !c) return;
    if (!_maskState.historyPushed) { pushHistory(); _maskState.historyPushed = true; }
    const ctx = c.getContext('2d');
    const color = _maskState.layerType === 'show' ? '#ffffff' : '#000000';
    if (mode === 'fill') {
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, c.width, c.height);
    } else if (mode === 'clear') {
        ctx.clearRect(0, 0, c.width, c.height);
    } else if (mode === 'invert') {
        const tmp = document.createElement('canvas');
        tmp.width = c.width; tmp.height = c.height;
        const tctx = tmp.getContext('2d');
        tctx.fillStyle = color;
        tctx.fillRect(0, 0, c.width, c.height);
        tctx.globalCompositeOperation = 'destination-out';
        tctx.drawImage(c, 0, 0);
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.drawImage(tmp, 0, 0);
    }
    await _maskBakeAndSave();
    _maskRenderOverlay();
}

// ── UI ──────────────────────────────────────────────────

function _maskUpdateUI() {
    const label = document.getElementById('mask-target-label');
    if (!label) return;
    const target = _maskState.editing ? _maskState.target : _maskCurrentTarget();
    let text = _maskTargetLabel(target);
    if (_maskState.editing && _maskState.layerId) {
        const svgEl = getPanelLayerSvg();
        const info = svgEl ? _maskLayerList(svgEl, target).find(l => l.id === _maskState.layerId) : null;
        text += t('mask.editingSuffix', info?.name ?? t('mask.nameFallback'), _maskTypeLabel(_maskState.layerType));
    }
    label.textContent = text;

    document.querySelectorAll('#mask-edit-mode-group .seg-btn').forEach(b => {
        b.classList.toggle('active', (b.dataset.maskEdit === 'on') === _maskState.editing);
    });
    document.querySelectorAll('#mask-brush-mode-group .seg-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.maskBrush === _maskState.brushMode);
    });

    const svgEl = getPanelLayerSvg();
    const layers = (svgEl && target) ? _maskLayerList(svgEl, target) : [];
    const g = svgEl && target ? _maskTargetGroup(svgEl, target) : null;
    const enabledCb = document.getElementById('mask-enabled');
    if (enabledCb) {
        enabledCb.checked = !!(g && !g.hasAttribute('data-ccc-mask-off'));
        enabledCb.disabled = layers.length === 0;
    }
    const status = document.getElementById('mask-status');
    if (status) {
        status.textContent = _maskState.editing
            ? (_maskState.layerType === 'show'
                ? t('mask.hintShow')
                : t('mask.hintHide'))
            : (layers.length > 0 ? t('mask.layerCount', layers.length) : '');
    }
}

// レイヤーパネルから: 対象を選択してマスク編集を開始（layerId 省略時は最前面/新規）
async function _maskOpenEditorFor(target, layerId = null) {
    if (target === '__overlay__') selectOverlay();
    else if (!_maskIsObjectTarget(target)) selectPanel(target);
    _maskState.target = target;
    _maskState.layerId = layerId;
    document.querySelector('.subtab-btn[data-subtab="mask"]')?.click();
    await _maskStartEdit(target, layerId);
}

function initMaskTool() {
    document.querySelectorAll('#mask-edit-mode-group .seg-btn').forEach(btn => {
        btn.addEventListener('click', () => _maskSetEditing(btn.dataset.maskEdit === 'on'));
    });
    document.querySelectorAll('#mask-brush-mode-group .seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            _maskState.brushMode = btn.dataset.maskBrush;
            _maskUpdateUI();
            _maskRenderOverlay();
        });
    });
    document.getElementById('mask-add-layer-btn')?.addEventListener('click', async () => {
        const target = _maskState.editing ? _maskState.target : _maskCurrentTarget();
        if (!target) { alert(t('mask.selectTarget')); return; }
        const type = document.getElementById('mask-new-type')?.value === 'show' ? 'show' : 'hide';
        await _maskAddLayerAndEdit(target, type);
    });
    const sizeRange = document.getElementById('mask-brush-size');
    sizeRange?.addEventListener('input', () => {
        _maskState.brushSize = parseInt(sizeRange.value, 10);
        document.getElementById('mask-brush-size-val').textContent = sizeRange.value;
        _maskRenderOverlay();
    });
    const hardRange = document.getElementById('mask-brush-hardness');
    hardRange?.addEventListener('input', () => {
        _maskState.hardness = parseInt(hardRange.value, 10) / 100;
        document.getElementById('mask-brush-hardness-val').textContent = hardRange.value + '%';
    });
    document.getElementById('mask-show-red')?.addEventListener('change', (e) => {
        _maskState.showRed = e.target.checked;
        _maskRenderOverlay();
    });
    document.getElementById('mask-enabled')?.addEventListener('change', async (e) => {
        const target = _maskState.editing ? _maskState.target : _maskCurrentTarget();
        if (target) await _maskSetEnabled(target, e.target.checked);
    });
    document.getElementById('mask-invert-btn')?.addEventListener('click', () => _maskFillAll('invert'));
    document.getElementById('mask-clear-btn')?.addEventListener('click', () => _maskFillAll('clear'));
    document.getElementById('mask-fill-btn')?.addEventListener('click', () => _maskFillAll('fill'));
    document.getElementById('mask-delete-btn')?.addEventListener('click', async () => {
        if (!_maskState.editing || !_maskState.layerId) { alert(t('mask.selectLayerToDelete')); return; }
        const svgEl = getPanelLayerSvg();
        const info = svgEl ? _maskLayerList(svgEl, _maskState.target).find(l => l.id === _maskState.layerId) : null;
        if (!confirm(t('mask.confirmDelete', _maskTargetLabel(_maskState.target), info?.name ?? t('mask.nameFallback')))) return;
        await _maskDeleteLayer(_maskState.target, _maskState.layerId);
    });
    // 他のサブタブへ切り替えたら編集OFF
    document.querySelectorAll('.subtab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.subtab !== 'mask' && _maskState.editing) _maskSetEditing(false);
            if (btn.dataset.subtab === 'mask') _maskUpdateUI();
        });
    });
}

