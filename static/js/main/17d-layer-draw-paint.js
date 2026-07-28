// ============================================================
// ペイントツール（ラスターブラシ）— レイアウトタブの独立サブタブ
// 「ドロー」（既存のSVGベクター図形描画, 17a〜17c）とは別系統。
// コマ/オーバーレイ/下書きレイヤーに透過画像（ペイントオブジェクト）を追加し、
// 専用の「描画ON」中にフリーハンドのブラシで直接ラスター編集できるようにする。
// 目的: Imageタブでの描画・編集の下書き、およびI2I用途。
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する（17a〜17cの後）。
// 主なトップレベル定義: _paintAddObject,_paintAttachOverlay,_paintDetachOverlay,
//   _paintLoadBitmap,_paintMouseDown,_paintMouseMove,_paintMouseUp,_paintMouseUpGlobal,
//   _paintReset,_paintSetStatus,_paintStrokeAt,_paintSvgPtToLocal,_paintToolState,
//   _paintUpdateToggle,initPaintTool
// ============================================================

const _paintToolState = {
    active:        false, // 描画ON/OFF（ペイント専用。ドローの_layerDrawState.activeとは独立）
    overlayCanvas: null,  // クリック捕捉用のオーバーレイcanvas
    dragging:      false,
    lastLocal:     null,  // 直前のローカルピクセル座標（線分を繋ぐため）
    imgEl:         null,  // 現在ブラシ編集対象になっている<image>要素（data-ccc-paint-object="1"）
    canvas:        null,  // imgEl.hrefのビットマップを保持するオフスクリーンcanvas（フルピクセル解像度）
};

function initPaintTool() {
    document.querySelectorAll('#paint-mode-group .seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const active = btn.dataset.paintMode === 'on';
            if (_paintToolState.active === active) return;
            _paintToolState.active = active;
            _paintUpdateToggle();
            if (_paintToolState.active) _paintAttachOverlay();
            else _paintDetachOverlay();
        });
    });

    document.getElementById('paint-add-object-btn').addEventListener('click', _paintAddObject);

    document.getElementById('paint-opacity').addEventListener('input', () => {
        document.getElementById('paint-opacity-value').textContent =
            document.getElementById('paint-opacity').value + '%';
    });

    document.getElementById('paint-brush-width').addEventListener('input', _paintSyncBrushWidthDisplay);

    // x5トグル（ON中はストローク描画時にブラシサイズを5倍で適用。スライダー自体の値は変更しない）
    document.getElementById('paint-brush-x5-btn').addEventListener('click', e => {
        e.currentTarget.classList.toggle('active');
    });

    // 消しゴムトグル（ON/OFFをボタンのactiveクラス＋背景色で明示）
    document.getElementById('paint-eraser-btn').addEventListener('click', e => {
        e.currentTarget.classList.toggle('active');
    });
}

function _paintSyncBrushWidthDisplay() {
    document.getElementById('paint-brush-width-value').textContent =
        document.getElementById('paint-brush-width').value;
}

// 消しゴムモードがONかどうか（トグルボタンのactiveクラスで管理）
function _paintIsEraserActive() {
    return document.getElementById('paint-eraser-btn')?.classList.contains('active') === true;
}

// ブラシサイズx5モードがONかどうか（トグルボタンのactiveクラスで管理）
function _paintIsX5Active() {
    return document.getElementById('paint-brush-x5-btn')?.classList.contains('active') === true;
}

function _paintUpdateToggle() {
    const group = document.getElementById('paint-mode-group');
    if (!group) return;
    group.querySelectorAll('.seg-btn').forEach(b =>
        b.classList.toggle('active', (b.dataset.paintMode === 'on') === _paintToolState.active));
}

function _paintSetStatus(msg) {
    const el = document.getElementById('paint-status');
    if (el) el.textContent = msg;
}

function _paintReset() {
    _paintToolState.dragging  = false;
    _paintToolState.lastLocal = null;
}

// 選択中のコマ/オーバーレイ/下書きレイヤーのサイズに合わせた透過画像を作成し、
// ペイントオブジェクトとして挿入・選択する
async function _paintAddObject() {
    if (!state.activePage) return;

    let target = null; // { x, y, width, height } SVGユーザー空間
    if (state.selectedDraft || state.selectedOverlay) {
        const parser = new DOMParser();
        const imgSvg = parser.parseFromString(state.activePage.svgContent, 'image/svg+xml').querySelector('svg');
        const vb = imgSvg ? imgSvg.getAttribute('viewBox') : '0 0 21000 29700';
        const [, , pageW, pageH] = vb.split(' ').map(Number);
        target = { x: 0, y: 0, width: pageW, height: pageH };
    } else if (state.selectedPanelId) {
        const panel = state.activePage.panels.find(p => p.id === state.selectedPanelId);
        target = panel && panel.points ? getBoundingBoxFromPoints(panel.points) : null;
    }
    if (!target || !target.width || !target.height) {
        _paintSetStatus(t('draw.selectTargetBeforeDraw'));
        return;
    }

    // ラスタライズ解像度: convertShapeToImage（図形→PNG変換）と同じくMAX_DIM=2000へスケールし、
    // 巨大なSVGユーザー座標（A4全面など）でCanvasサイズが過大にならないようにする
    const MAX_DIM = 2000;
    const scale = Math.min(1, MAX_DIM / Math.max(target.width, target.height));
    const pxW = Math.max(1, Math.round(target.width  * scale));
    const pxH = Math.max(1, Math.round(target.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = pxW; canvas.height = pxH;
    const dataUrl = canvas.toDataURL('image/png'); // 全ピクセル透過のPNG

    const paintId = 'img-paint-' + Date.now();
    const ok = await insertImage(dataUrl, pxW, pxH,
        { id: paintId, 'data-ccc-paint-object': '1' },
        { x: target.x, y: target.y, width: target.width, height: target.height });
    if (ok === false) return;

    const svgEl = getPanelLayerSvg();
    const newEl = svgEl?.querySelector(`#${CSS.escape(paintId)}`);
    if (newEl) _selectClone(newEl, svgEl);

    // 追加したペイントレイヤーをそのまま描画できるよう、自動的に描画ONにする
    // （renderLayoutTab()でDOMが作り直されているため、既にON中でもcanvas再アタッチが必要）
    _paintToolState.active = true;
    _paintUpdateToggle();
    _paintAttachOverlay();

    _paintSetStatus(t('draw.paintObjectAdded', pxW, pxH));
}

// ──────────────────────
// オーバーレイcanvas管理
// ──────────────────────
function _paintAttachOverlay() {
    _paintDetachOverlay(); // 二重登録防止

    const svgEl = getPanelLayerSvg();
    if (!svgEl) {
        _paintSetStatus(t('draw.selectTargetFirst'));
        _paintToolState.active = false;
        _paintUpdateToggle();
        return;
    }

    const canvas = document.createElement('canvas');
    canvas.id = '_paint-tool-overlay';
    canvas.style.cssText = 'position:absolute; top:0; left:0; cursor:crosshair; z-index:100; pointer-events:auto;';
    _paintToolState.overlayCanvas = canvas;

    const imageLayer = document.getElementById('image-layer');
    if (!imageLayer) return;
    imageLayer.style.position = 'relative';
    _layerDrawResizeCanvas(svgEl, canvas); // 17aの汎用リサイズ関数を再利用
    imageLayer.appendChild(canvas);

    canvas.addEventListener('mousedown', _paintMouseDown);
    canvas.addEventListener('mousemove', _paintMouseMove);
    canvas.addEventListener('mouseup',   _paintMouseUp);
    window.addEventListener('mouseup',   _paintMouseUpGlobal);

    _paintSetStatus(t('draw.paintDrawingOn', _layerDrawTargetLabel()));
}

function _paintDetachOverlay() {
    const c = document.getElementById('_paint-tool-overlay');
    if (c) c.remove();
    _paintToolState.overlayCanvas = null;
    _paintReset();
    window.removeEventListener('mouseup', _paintMouseUpGlobal);
    _paintSetStatus('');
}

// ──────────────────────
// ビットマップ読み込み・座標変換
// ──────────────────────

// 選択中<image>のhrefをデコードし、フルピクセル解像度のオフスクリーンcanvasへ読み込む
function _paintLoadBitmap(el) {
    return new Promise(resolve => {
        const href = el.getAttribute('href') || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
        if (!href) { resolve(false); return; }
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width  = img.naturalWidth  || 1;
            canvas.height = img.naturalHeight || 1;
            canvas.getContext('2d').drawImage(img, 0, 0);
            _paintToolState.imgEl  = el;
            _paintToolState.canvas = canvas;
            resolve(true);
        };
        img.onerror = () => {
            _paintSetStatus(t('draw.paintLoadError'));
            resolve(false);
        };
        img.src = href;
    });
}

// SVGユーザー空間座標 → 選択中ペイント画像のローカルピクセル座標
// 画像の位置(x,y)・表示サイズ(width,height)・回転(data-angle)を反映する
// （data-flipH/data-flipVは非対応。反転済み画像へのペイントは想定外の位置になり得る）
function _paintSvgPtToLocal(el, svgPt) {
    const x = parseFloat(el.getAttribute('x')) || 0;
    const y = parseFloat(el.getAttribute('y')) || 0;
    const w = parseFloat(el.getAttribute('width'))  || 1;
    const h = parseFloat(el.getAttribute('height')) || 1;
    const angle = parseFloat(el.dataset.angle || 0);
    let px = svgPt.x, py = svgPt.y;
    if (angle) {
        const cx = x + w / 2, cy = y + h / 2;
        const rad = -angle * Math.PI / 180; // 図形の回転と逆方向に回してローカル座標系へ戻す
        const cos = Math.cos(rad), sin = Math.sin(rad);
        const dx = px - cx, dy = py - cy;
        px = cx + dx * cos - dy * sin;
        py = cy + dx * sin + dy * cos;
    }
    const canvas = _paintToolState.canvas;
    return { x: (px - x) / w * canvas.width, y: (py - y) / h * canvas.height };
}

// ──────────────────────
// マウスイベント
// ──────────────────────
async function _paintMouseDown(e) {
    if (!_paintToolState.active) return;
    const el = state.selectedImageEl;
    if (!el || el.dataset.cccPaintObject !== '1') {
        _paintSetStatus(t('draw.paintSelectObjectFirst'));
        e.preventDefault();
        return;
    }
    if (_isObjectLocked(el)) { e.preventDefault(); return; }
    if (_paintToolState.imgEl !== el) {
        const ok = await _paintLoadBitmap(el);
        if (!ok) { e.preventDefault(); return; }
    }
    pushHistory();
    _paintToolState.dragging  = true;
    _paintToolState.lastLocal = null;
    _paintStrokeAt(e.clientX, e.clientY);
    e.preventDefault();
}

function _paintMouseMove(e) {
    if (!_paintToolState.active || !_paintToolState.dragging) return;
    _paintStrokeAt(e.clientX, e.clientY);
    e.preventDefault();
}

function _paintMouseUp() {
    if (!_paintToolState.dragging) return;
    _paintToolState.dragging  = false;
    _paintToolState.lastLocal = null;
    _layerDrawSaveSelected(); // 17aの保存ディスパッチ（コマ/オーバーレイ/下書き対応）を再利用
}

function _paintMouseUpGlobal() {
    // canvas外でmouseupされた場合（canvas自体のmouseupイベントが発火しない）の保険
    if (_paintToolState.dragging) _paintMouseUp();
}

// canvas座標（clientX/clientY）でブラシストロークを1区間分描画し、<image href>へ即時反映する
function _paintStrokeAt(clientX, clientY) {
    const el = _paintToolState.imgEl;
    const canvas = _paintToolState.canvas;
    if (!el || !canvas) return;

    const svgPt = _layerDrawClientToSvg(clientX, clientY); // 17aの汎用座標変換を再利用
    const local = _paintSvgPtToLocal(el, svgPt);

    const eraser  = _paintIsEraserActive();
    const strokeW = (parseFloat(document.getElementById('paint-brush-width').value) || 10) * (_paintIsX5Active() ? 5 : 1);
    const color   = document.getElementById('paint-brush-color').value;
    const opacity = parseInt(document.getElementById('paint-opacity').value, 10) / 100;
    // ブラシ幅はSVGユーザー空間基準のため、画像の表示幅→実ピクセル幅の比率で
    // ローカルピクセル座標系のlineWidthへ変換する
    const imgW = parseFloat(el.getAttribute('width')) || 1;
    const localStrokeW = Math.max(1, strokeW * (canvas.width / imgW));

    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over';
    ctx.globalAlpha  = opacity;
    ctx.strokeStyle  = color;
    ctx.lineCap      = 'round';
    ctx.lineJoin     = 'round';
    ctx.lineWidth    = localStrokeW;

    ctx.beginPath();
    const last = _paintToolState.lastLocal;
    if (last) {
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(local.x, local.y);
    } else {
        // 最初の点はごく短い線分として打ち、単純クリックだけでも点が残るようにする
        ctx.moveTo(local.x, local.y);
        ctx.lineTo(local.x + 0.01, local.y + 0.01);
    }
    ctx.stroke();
    ctx.restore();

    _paintToolState.lastLocal = local;
    el.setAttribute('href', canvas.toDataURL('image/png'));
}
