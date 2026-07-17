// ============================================================
// SVGレイヤーへの描画機能 分割ファイル (1/3): 初期化+オーバーレイ管理+座標変換+マウスイベント+多角形ペンツール
// 元 17-layer-draw.js（分割前）の行 1-715 に相当
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: _POLY_CLOSE_THRESHOLD,_drawChainPreview,_drawRopePreview,_layerDrawApplyPropsToSelected,_layerDrawAttachOverlay,_layerDrawClientToSvg,_layerDrawDetachOverlay,_layerDrawKeyDown,_layerDrawMouseDown,_layerDrawMouseMove,_layerDrawMouseUp,_layerDrawMouseUpGlobal,_layerDrawPolyClick,_layerDrawPolyCommit,_layerDrawPolyCommitInner,_layerDrawPolyIsNearStart,_layerDrawPolyPreview,_layerDrawPolyReset,_layerDrawResizeCanvas,_layerDrawState,_layerDrawSvgToCanvas,_layerDrawUpdateStatusForShape,_layerDrawUpdateToggle,_loadDefaultOriginalImg,initLayerDraw
// ============================================================

// ─────────────────────────────────────────────
//  SVGレイヤーへの描画機能
// ─────────────────────────────────────────────

const _layerDrawState = {
    active:       false,   // 描画モードON/OFF
    editMode:     true,    // 図形編集モード（描画OFFのとき自動でtrue）
    isDragging:   false,
    startSvgPt:   null,    // ドラッグ開始のSVG座標
    curSvgPt:     null,    // 現在のSVG座標
    previewEl:    null,    // ドラッグ中のプレビューSVG要素
    overlayCanvas: null,   // SVG上に重ねる透明canvas
    undoStack:    [],      // 追加した要素のリスト（Undo用）
    points:       [],      // 曲線・鎖・ロープ用の点配列
    chainToggle:  false,   // 鎖の交互描画用
    originalImg:  null,    // My曲線用画像
    polyPoints:   [],      // 多角形ペン: 確定済み頂点（SVG座標）
    polyHoverPt:  null,    // 多角形ペン: カーソル位置（SVG座標）
};

// ──────────────────────
// 初期化
// ──────────────────────
function initLayerDraw() {
    // 描画ON/OFF選択ボタン
    document.querySelectorAll('#layer-draw-mode-group .seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const active = btn.dataset.drawMode === 'on';
            if (_layerDrawState.active === active) return;
            _layerDrawState.active = active;
            _layerDrawUpdateToggle();
            // ON時: SVG上にオーバーレイcanvasを設置
            if (_layerDrawState.active) {
                _layerDrawAttachOverlay();
            } else {
                _layerDrawDetachOverlay();
            }
        });
    });

    // 形状選択ボタン（非表示selectと同期し、既存のchange処理を発火）
    document.querySelectorAll('#layer-draw-shape-group .seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const sel = document.getElementById('layer-draw-shape');
            if (sel.value === btn.dataset.shape) return;
            sel.value = btn.dataset.shape;
            sel.dispatchEvent(new Event('change'));
            document.querySelectorAll('#layer-draw-shape-group .seg-btn').forEach(b =>
                b.classList.toggle('active', b === btn));
        });
    });

    document.getElementById('layer-draw-undo').addEventListener('click', _layerDrawUndo);
    document.getElementById('layer-draw-opacity').addEventListener('input', () => {
        document.getElementById('layer-draw-opacity-value').textContent =
            document.getElementById('layer-draw-opacity').value + '%';
        _layerDrawApplyPropsToSelected(true);
    });
    // 塗りなしチェックボックス
    document.getElementById('layer-draw-fill-none').addEventListener('change', e => {
        document.getElementById('layer-draw-fill').disabled = e.target.checked;
        _layerDrawApplyPropsToSelected();
    });
    // 線なしチェックボックス
    document.getElementById('layer-draw-stroke-none').addEventListener('change', e => {
        document.getElementById('layer-draw-stroke').disabled       = e.target.checked;
        document.getElementById('layer-draw-stroke-width').disabled = e.target.checked;
        _layerDrawApplyPropsToSelected();
    });
    // 塗り・線・線幅の変更時も適用（ドラッグ中の連続inputでは保存をdebounce）
    document.getElementById('layer-draw-fill').addEventListener('input', () => _layerDrawApplyPropsToSelected(true));
    document.getElementById('layer-draw-stroke').addEventListener('input', () => _layerDrawApplyPropsToSelected(true));
    document.getElementById('layer-draw-stroke-width').addEventListener('input', () => _layerDrawApplyPropsToSelected(true));
    // 初期状態: 線なし→無効（線幅デフォルト5はHTML側で設定済み）
    document.getElementById('layer-draw-stroke').disabled       = true;
    document.getElementById('layer-draw-stroke-width').disabled = true;

    // 形状選択変更時の初期値自動設定
    document.getElementById('layer-draw-shape').addEventListener('change', e => {
        const shape = e.target.value;
        // 多角形の描きかけがあれば破棄
        _layerDrawPolyReset();
        // 描画モード中はステータス文言を形状に合わせて更新
        if (_layerDrawState.active && _layerDrawState.overlayCanvas) _layerDrawUpdateStatusForShape();
        // My曲線用画像選択UI表示切替
        document.getElementById('layer-draw-original-wrap').style.display =
            shape === 'original' ? 'flex' : 'none';

        if (['line', 'curve', 'chain', 'rope', 'original'].includes(shape)) {
            // 塗り: なし
            document.getElementById('layer-draw-fill-none').checked = true;
            document.getElementById('layer-draw-fill').disabled = true;
            // 線: あり
            document.getElementById('layer-draw-stroke-none').checked = false;
            document.getElementById('layer-draw-stroke').disabled = false;
            document.getElementById('layer-draw-stroke-width').disabled = false;
            // 鎖・ロープは線幅80、My曲線は5、直線・曲線は50を初期値に
            if (['chain', 'rope'].includes(shape)) {
                document.getElementById('layer-draw-stroke-width').value = 80;
            } else if (shape === 'original') {
                document.getElementById('layer-draw-stroke-width').value = 5;
            } else {
                // line / curve
                document.getElementById('layer-draw-stroke-width').value = 50;
            }
            // 不透明度: 100%
            document.getElementById('layer-draw-opacity').value = 100;
            document.getElementById('layer-draw-opacity-value').textContent = '100%';

            _layerDrawApplyPropsToSelected();
        } else if (shape === 'polygon') {
            // 多角形は線幅の初期値のみ50に（塗り・線の有無の設定は維持）
            document.getElementById('layer-draw-stroke-width').value = 50;
            _layerDrawApplyPropsToSelected();
        }
    });

    // My曲線用画像ファイル選択
    document.getElementById('layer-draw-original-file').addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            const img = new Image();
            img.onload = () => {
                _layerDrawState.originalImg = img;
                const preview = document.getElementById('layer-draw-original-preview');
                preview.src = ev.target.result;
                preview.style.display = 'inline';
                document.getElementById('layer-draw-original-name').textContent = file.name;
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    });

    // デフォルト画像を設定
    _loadDefaultOriginalImg();
}

// My曲線デフォルト画像（assets/mychain/t1.png）を読み込んでレイヤードロータブに設定
function _loadDefaultOriginalImg() {
    const DEFAULT_URL = '/ccc_assets/mychain/t1.png';
    const img = new Image();
    img.onload = () => {
        if (!_layerDrawState.originalImg) {
            _layerDrawState.originalImg = img;
            const nameEl = document.getElementById('layer-draw-original-name');
            if (nameEl) nameEl.textContent = 't1.png';
            const previewEl = document.getElementById('layer-draw-original-preview');
            if (previewEl) { previewEl.src = DEFAULT_URL; previewEl.style.display = 'inline'; }
        }
    };
    img.src = DEFAULT_URL;
}

// トグルボタンのUI更新
// 描画OFF時は自動的に編集モードON（図形を選択して編集可能）
// 描画ON時は自動的に編集モードOFF（描画操作のみ）
function _layerDrawUpdateToggle() {
    const group = document.getElementById('layer-draw-mode-group');
    if (!group) return;
    group.querySelectorAll('.seg-btn').forEach(b =>
        b.classList.toggle('active', (b.dataset.drawMode === 'on') === _layerDrawState.active));
    // 編集モードは描画の逆
    _layerDrawState.editMode = !_layerDrawState.active;
    if (_layerDrawState.editMode && state.selectedDrawEl) {
        _drawShapeSyncProps(state.selectedDrawEl);
    }
}

// 図形編集モードON中、描画UIの現在値を選択中draw-shapeに適用して保存
// deferSave=true の場合、DOM属性への反映は即時に行うが実際の保存(savePanelSvg等)は
// 300ms debounceする。color/rangeのinputイベントはドラッグ中に高頻度発火し、
// 都度フル保存(SVGクローン+シリアライズ+サムネイル再生成+レイヤーパネル再構築)が
// 走ると操作が固まって見えるため、連続入力中は保存をまとめる。
let _layerDrawSaveDebounceTimer = null;
function _layerDrawApplyPropsToSelected(deferSave) {
    if (!_layerDrawState.editMode) return;
    const el = state.selectedDrawEl;
    if (!el) return;
    const fillNone   = document.getElementById('layer-draw-fill-none').checked;
    const strokeNone = document.getElementById('layer-draw-stroke-none').checked;
    el.setAttribute('fill', fillNone ? 'none' : document.getElementById('layer-draw-fill').value);
    const sw = parseFloat(document.getElementById('layer-draw-stroke-width').value) || 0;
    if (strokeNone || sw === 0) {
        el.setAttribute('stroke', 'none');
        el.removeAttribute('stroke-width');
    } else {
        el.setAttribute('stroke',       document.getElementById('layer-draw-stroke').value);
        el.setAttribute('stroke-width', sw.toString());
    }
    const opacity = parseInt(document.getElementById('layer-draw-opacity').value, 10) / 100;
    if (opacity >= 1) el.removeAttribute('opacity');
    else              el.setAttribute('opacity', opacity.toFixed(3));

    if (_layerDrawSaveDebounceTimer) {
        clearTimeout(_layerDrawSaveDebounceTimer);
        _layerDrawSaveDebounceTimer = null;
    }
    if (deferSave === true) {
        _layerDrawSaveDebounceTimer = setTimeout(() => {
            _layerDrawSaveDebounceTimer = null;
            _layerDrawSaveSelected();
        }, 300);
        return;
    }
    _layerDrawSaveSelected();
}

async function _layerDrawSaveSelected() {
    const svgEl = getPanelLayerSvg();
    if (!svgEl) return;
    if (state.selectedOverlay) await saveOverlaySvg(svgEl);
    else if (state.selectedPanelId) await savePanelSvg(state.selectedPanelId, svgEl);
}

// ──────────────────────
// オーバーレイcanvas管理
// ──────────────────────

// SVG要素の上に透明なcanvasを重ねてマウスイベントを受け取る
function _layerDrawAttachOverlay() {
    _layerDrawDetachOverlay(); // 二重登録防止

    const svgEl = getPanelLayerSvg();
    if (!svgEl) {
        _layerDrawSetStatus(t('draw.selectTargetFirst'));
        _layerDrawState.active = false;
        _layerDrawUpdateToggle();
        return;
    }

    const canvas = document.createElement('canvas');
    canvas.id = '_layer-draw-overlay';
    canvas.style.cssText = 'position:absolute; top:0; left:0; cursor:crosshair; z-index:100; pointer-events:auto;';
    _layerDrawState.overlayCanvas = canvas;

    // SVGを包むコンテナ（#image-layer）に対して相対配置
    const imageLayer = document.getElementById('image-layer');
    if (!imageLayer) return;
    imageLayer.style.position = 'relative';

    // canvasをSVGの表示サイズに合わせる（ResizeObserver対応）
    _layerDrawResizeCanvas(svgEl, canvas);

    imageLayer.appendChild(canvas);

    canvas.addEventListener('mousedown', _layerDrawMouseDown);
    canvas.addEventListener('mousemove', _layerDrawMouseMove);
    canvas.addEventListener('mouseup',   _layerDrawMouseUp);
    window.addEventListener('mouseup',   _layerDrawMouseUpGlobal);
    window.addEventListener('keydown',   _layerDrawKeyDown);

    _layerDrawUpdateStatusForShape();
}

// 現在の形状に応じた描画中ステータス文言を表示
function _layerDrawUpdateStatusForShape() {
    const shape = document.getElementById('layer-draw-shape').value;
    if (shape === 'polygon') {
        _layerDrawSetStatus(t('draw.polygonDrawing', _layerDrawTargetLabel()));
    } else {
        _layerDrawSetStatus(t('draw.drawingOn', _layerDrawTargetLabel()));
    }
}

function _layerDrawDetachOverlay() {
    const c = document.getElementById('_layer-draw-overlay');
    if (c) c.remove();
    _layerDrawState.overlayCanvas = null;
    _layerDrawState.polyPoints = [];
    _layerDrawState.polyHoverPt = null;
    window.removeEventListener('mouseup', _layerDrawMouseUpGlobal);
    window.removeEventListener('keydown', _layerDrawKeyDown);
    // プレビュー要素のクリーンアップ
    if (_layerDrawState.previewEl) {
        _layerDrawState.previewEl.remove();
        _layerDrawState.previewEl = null;
    }
    _layerDrawSetStatus('');
}

// canvasをSVGの表示サイズ・位置に合わせる
function _layerDrawResizeCanvas(svgEl, canvas) {
    const rect = svgEl.getBoundingClientRect();
    const parentRect = document.getElementById('image-layer').getBoundingClientRect();
    canvas.width  = Math.round(rect.width);
    canvas.height = Math.round(rect.height);
    canvas.style.left   = (rect.left - parentRect.left) + 'px';
    canvas.style.top    = (rect.top  - parentRect.top)  + 'px';
    canvas.style.width  = rect.width  + 'px';
    canvas.style.height = rect.height + 'px';
}

// ──────────────────────
// 座標変換（clientXY → SVG userSpace座標）
// SVGのgetScreenCTM().inverse()を使って正確に変換する
// ──────────────────────
function _layerDrawClientToSvg(clientX, clientY) {
    const svgEl = getPanelLayerSvg();
    if (!svgEl) return { x: 0, y: 0 };
    const pt = svgEl.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const svgPt = pt.matrixTransform(svgEl.getScreenCTM().inverse());
    return { x: svgPt.x, y: svgPt.y };
}

// canvas上のプレビュー描画用: SVG座標 → canvas上のpx座標
// getScreenCTMでSVG→クライアント座標に変換し、canvasのBoundingRectを引く
function _layerDrawSvgToCanvas(svgX, svgY) {
    const svgEl = getPanelLayerSvg();
    const canvas = _layerDrawState.overlayCanvas;
    if (!svgEl || !canvas) return { x: 0, y: 0 };
    const pt = svgEl.createSVGPoint();
    pt.x = svgX;
    pt.y = svgY;
    const clientPt = pt.matrixTransform(svgEl.getScreenCTM());
    const canvasRect = canvas.getBoundingClientRect();
    return {
        x: (clientPt.x - canvasRect.left) * (canvas.width  / canvasRect.width),
        y: (clientPt.y - canvasRect.top)  * (canvas.height / canvasRect.height),
    };
}

// ──────────────────────
// マウスイベント
// ──────────────────────
function _layerDrawMouseDown(e) {
    if (!_layerDrawState.active) return;
    if (document.getElementById('layer-draw-shape').value === 'polygon') {
        _layerDrawPolyClick(e);
        e.preventDefault();
        return;
    }
    _layerDrawState.isDragging = true;
    _layerDrawState.startSvgPt = _layerDrawClientToSvg(e.clientX, e.clientY);
    _layerDrawState.curSvgPt   = { ..._layerDrawState.startSvgPt };
    _layerDrawState.points     = [{ ..._layerDrawState.startSvgPt }];
    _layerDrawState.chainToggle = false;
    // canvas サイズを最新のSVG表示に合わせる
    _layerDrawResizeCanvas(getPanelLayerSvg(), _layerDrawState.overlayCanvas);
    e.preventDefault();
}

function _layerDrawMouseMove(e) {
    if (!_layerDrawState.active) return;
    if (document.getElementById('layer-draw-shape').value === 'polygon') {
        if (_layerDrawState.polyPoints.length > 0) {
            _layerDrawState.polyHoverPt = _layerDrawClientToSvg(e.clientX, e.clientY);
            _layerDrawPolyPreview();
        }
        return;
    }
    if (!_layerDrawState.isDragging) return;
    _layerDrawState.curSvgPt = _layerDrawClientToSvg(e.clientX, e.clientY);
    const shape = document.getElementById('layer-draw-shape').value;
    
    // 自由描画系の座標追跡
    if (['curve', 'chain', 'rope', 'original'].includes(shape)) {
        _layerDrawState.points.push({ ..._layerDrawState.curSvgPt });
    }

    // canvasにドラッグプレビューを描画（SVG座標→canvas座標に逆変換して描く）
    const canvas = _layerDrawState.overlayCanvas;
    const ctx    = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const s  = _layerDrawState.startSvgPt;
    const c  = _layerDrawState.curSvgPt;
    const p1 = _layerDrawSvgToCanvas(s.x, s.y);
    const p2 = _layerDrawSvgToCanvas(c.x, c.y);

    ctx.save();
    
    if (['curve', 'chain', 'rope', 'original'].includes(shape)) {
        // --- 自由描画プレビュー ---
        const pts = _layerDrawState.points.map(p => _layerDrawSvgToCanvas(p.x, p.y));
        const strokeW = parseFloat(document.getElementById('layer-draw-stroke-width').value) || 5;
        const color = document.getElementById('layer-draw-stroke').value;
        const opacity = parseInt(document.getElementById('layer-draw-opacity').value, 10) / 100;

        const svgEl = getPanelLayerSvg();
        const rect = svgEl.getBoundingClientRect();
        const vb = svgEl.viewBox.baseVal;
        const scale = rect.width / vb.width;

        ctx.globalAlpha = opacity;

        if (shape === 'curve') {
            ctx.strokeStyle = color;
            ctx.lineWidth = strokeW * scale;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) {
                ctx.lineTo(pts[i].x, pts[i].y);
            }
            ctx.stroke();
        } else if (shape === 'chain' || shape === 'rope') {
            const spacing = Math.max(1, (shape === 'chain' ? 20 : 10) * scale * (strokeW / 5));
            let lastP = pts[0];
            let toggle = false;

            for (let i = 1; i < pts.length; i++) {
                const currP = pts[i];
                const dx = currP.x - lastP.x;
                const dy = currP.y - lastP.y;
                let dist = Math.sqrt(dx * dx + dy * dy);

                if (dist >= spacing) {
                    const angle = Math.atan2(dy, dx);
                    while (dist >= spacing) {
                        lastP = {
                            x: lastP.x + Math.cos(angle) * spacing,
                            y: lastP.y + Math.sin(angle) * spacing
                        };
                        if (shape === 'chain') {
                            _drawChainPreview(ctx, lastP.x, lastP.y, angle, scale * (strokeW / 5), toggle);
                            toggle = !toggle;
                        } else {
                            _drawRopePreview(ctx, lastP.x, lastP.y, angle, scale * (strokeW / 5));
                        }
                        dist -= spacing;
                    }
                }
            }
        } else if (shape === 'original') {
            const originalImg = _layerDrawState.originalImg;
            const unitScale = scale * (strokeW / 5);
            const spacing = Math.max(1, 20 * scale * (strokeW / 5));
            let lastP = pts[0];
            for (let i = 1; i < pts.length; i++) {
                const currP = pts[i];
                const dx = currP.x - lastP.x, dy = currP.y - lastP.y;
                let dist = Math.sqrt(dx * dx + dy * dy);
                if (dist >= spacing) {
                    const angle = Math.atan2(dy, dx);
                    while (dist >= spacing) {
                        lastP = { x: lastP.x + Math.cos(angle) * spacing, y: lastP.y + Math.sin(angle) * spacing };
                        _layerDrawOriginalUnit(ctx, lastP.x, lastP.y, angle, unitScale, originalImg);
                        dist -= spacing;
                    }
                }
            }
        }
    } else {
        // --- 基本図形プレビュー ---
        ctx.strokeStyle = '#0077ff';
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([5, 3]);
        if (shape === 'ellipse') {
            const cx = (p1.x + p2.x) / 2, cy = (p1.y + p2.y) / 2;
            const rx = Math.abs(p2.x - p1.x) / 2, ry = Math.abs(p2.y - p1.y) / 2;
            ctx.beginPath();
            ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
            ctx.stroke();
        } else if (shape === 'line') {
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
        } else {
            const rectX = Math.min(p1.x, p2.x), rectY = Math.min(p1.y, p2.y);
            const rectW = Math.abs(p2.x - p1.x), rectH = Math.abs(p2.y - p1.y);
            if (document.getElementById('layer-draw-rounded').checked) {
                const r = Math.min(rectW, rectH) * 0.15;
                ctx.beginPath();
                ctx.roundRect(rectX, rectY, rectW, rectH, r);
                ctx.stroke();
            } else {
                ctx.strokeRect(rectX, rectY, rectW, rectH);
            }
        }
    }
    ctx.restore();

    e.preventDefault();
}

// プレビュー用補助関数（chaintool.txtを参考）
function _drawChainPreview(ctx, x, y, angle, scale, toggle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(scale, scale);
    ctx.lineWidth = 4;
    ctx.strokeStyle = document.getElementById('layer-draw-stroke').value;
    ctx.beginPath();
    if (toggle) {
        ctx.ellipse(0, 0, 12, 6, 0, 0, Math.PI * 2);
    } else {
        ctx.moveTo(-5, 0);
        ctx.lineTo(5, 0);
        ctx.lineWidth = 8;
        ctx.lineCap = 'round';
    }
    ctx.stroke();
    ctx.restore();
}

function _drawRopePreview(ctx, x, y, angle, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(scale, scale);
    ctx.fillStyle = '#D4A373';
    ctx.fillRect(-5, -6, 12, 12);
    ctx.strokeStyle = '#A98467';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-5, -6); ctx.lineTo(5, 6); ctx.stroke();
    ctx.strokeStyle = '#8B5A2B';
    ctx.lineWidth = 1;
    ctx.strokeRect(-5, -6, 12, 12);
    ctx.restore();
}

function _layerDrawMouseUp(e) {
    if (!_layerDrawState.isDragging || !_layerDrawState.active) return;
    _layerDrawState.isDragging = false;
    _layerDrawState.curSvgPt   = _layerDrawClientToSvg(e.clientX, e.clientY);

    // canvasプレビューをクリア
    const canvas = _layerDrawState.overlayCanvas;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);

    _layerDrawCommit(); // async だが待機不要
    e.preventDefault();
}

function _layerDrawMouseUpGlobal() {
    if (_layerDrawState.isDragging) {
        _layerDrawState.isDragging = false;
        if (_layerDrawState.overlayCanvas) {
            const c = _layerDrawState.overlayCanvas;
            c.getContext('2d').clearRect(0, 0, c.width, c.height);
        }
    }
}

// ──────────────────────
// 多角形ペンツール
// ──────────────────────

// 始点クリック判定の許容距離（canvas px）
const _POLY_CLOSE_THRESHOLD = 12;

function _layerDrawPolyReset() {
    _layerDrawState.polyPoints = [];
    _layerDrawState.polyHoverPt = null;
    const canvas = _layerDrawState.overlayCanvas;
    if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

// Esc: 直前の頂点を取り消し（描画モード中のみ）
function _layerDrawKeyDown(e) {
    if (e.key !== 'Escape') return;
    if (!_layerDrawState.active) return;
    if (document.getElementById('layer-draw-shape').value !== 'polygon') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (_layerDrawState.polyPoints.length === 0) return;
    _layerDrawState.polyPoints.pop();
    _layerDrawPolyPreview();
    e.preventDefault();
    e.stopPropagation();
}

// マウス位置が始点の近く（canvas px基準）かどうか
function _layerDrawPolyIsNearStart(clientX, clientY) {
    const pts = _layerDrawState.polyPoints;
    const canvas = _layerDrawState.overlayCanvas;
    if (pts.length === 0 || !canvas) return false;
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const mx = (clientX - r.left) * (canvas.width / r.width);
    const my = (clientY - r.top) * (canvas.height / r.height);
    const s0 = _layerDrawSvgToCanvas(pts[0].x, pts[0].y);
    return Math.hypot(mx - s0.x, my - s0.y) <= _POLY_CLOSE_THRESHOLD;
}

// クリック: 頂点追加。始点付近クリック（3点以上）でパスを閉じて確定
function _layerDrawPolyClick(e) {
    const pts = _layerDrawState.polyPoints;
    if (pts.length === 0) {
        // 最初のクリック時にcanvasサイズを最新表示に合わせる
        _layerDrawResizeCanvas(getPanelLayerSvg(), _layerDrawState.overlayCanvas);
    }
    if (pts.length >= 3 && _layerDrawPolyIsNearStart(e.clientX, e.clientY)) {
        _layerDrawPolyCommit();
        return;
    }
    const pt = _layerDrawClientToSvg(e.clientX, e.clientY);
    const last = pts[pts.length - 1];
    if (last && Math.abs(last.x - pt.x) < 0.01 && Math.abs(last.y - pt.y) < 0.01) return; // 同一点の連打を無視
    pts.push(pt);
    _layerDrawState.polyHoverPt = { ...pt };
    _layerDrawPolyPreview();
}

// 確定済み頂点＋ラバーバンドをオーバーレイcanvasに描画
function _layerDrawPolyPreview() {
    const canvas = _layerDrawState.overlayCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const pts = _layerDrawState.polyPoints;
    if (pts.length === 0) return;
    const cpts = pts.map(p => _layerDrawSvgToCanvas(p.x, p.y));
    const hover = _layerDrawState.polyHoverPt
        ? _layerDrawSvgToCanvas(_layerDrawState.polyHoverPt.x, _layerDrawState.polyHoverPt.y)
        : null;
    // 始点付近ホバー中（閉じられる状態）はラバーバンドを始点にスナップ
    const closable = pts.length >= 3 && hover &&
        Math.hypot(hover.x - cpts[0].x, hover.y - cpts[0].y) <= _POLY_CLOSE_THRESHOLD;

    ctx.save();

    // 塗りのヒント（閉じたと仮定した領域を薄く塗る）
    if (cpts.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(cpts[0].x, cpts[0].y);
        for (let i = 1; i < cpts.length; i++) ctx.lineTo(cpts[i].x, cpts[i].y);
        if (hover && !closable) ctx.lineTo(hover.x, hover.y);
        ctx.closePath();
        ctx.fillStyle = 'rgba(0,119,255,0.08)';
        ctx.fill();
    }

    // 確定済みセグメント（実線）
    ctx.strokeStyle = '#0077ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cpts[0].x, cpts[0].y);
    for (let i = 1; i < cpts.length; i++) ctx.lineTo(cpts[i].x, cpts[i].y);
    ctx.stroke();

    // ラバーバンド（破線: 最終頂点→カーソル or 始点スナップ）
    if (hover) {
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(cpts[cpts.length - 1].x, cpts[cpts.length - 1].y);
        if (closable) ctx.lineTo(cpts[0].x, cpts[0].y);
        else ctx.lineTo(hover.x, hover.y);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // 頂点マーカー
    cpts.forEach((p, i) => {
        ctx.beginPath();
        if (i === 0) {
            // 始点: 閉じられる状態なら強調表示
            ctx.arc(p.x, p.y, closable ? 7 : 5, 0, Math.PI * 2);
            ctx.fillStyle = closable ? '#00bb55' : '#ffffff';
            ctx.fill();
            ctx.strokeStyle = closable ? '#008833' : '#0077ff';
            ctx.stroke();
        } else {
            ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
            ctx.fillStyle = '#0077ff';
            ctx.fill();
        }
    });

    ctx.restore();
}

// 多角形の確定（<polygon class="draw-shape"> として追加・保存）
async function _layerDrawPolyCommit() {
    let committed = false;
    try {
        committed = await _layerDrawPolyCommitInner();
    } catch (err) {
        console.error('Polygon commit error:', err);
    } finally {
        _layerDrawPolyReset();
        _layerDrawState.active = false;
        _layerDrawUpdateToggle();
        _layerDrawDetachOverlay();
        if (committed) _layerDrawSetStatus(t('draw.polygonCommitted'));
    }
}

async function _layerDrawPolyCommitInner() {
    const pts = _layerDrawState.polyPoints;
    if (pts.length < 3) return;

    const svgEl = getPanelLayerSvg();
    if (!svgEl) return;
    if (!state.selectedPanelId && !state.selectedOverlay) {
        _layerDrawSetStatus(t('draw.selectTargetBeforeDraw'));
        return;
    }
    const targetG = getOrCreateClipGroup(svgEl);

    const ns          = 'http://www.w3.org/2000/svg';
    const fillNone    = document.getElementById('layer-draw-fill-none').checked;
    const strokeNone  = document.getElementById('layer-draw-stroke-none').checked;
    const fillColor   = fillNone   ? 'none' : document.getElementById('layer-draw-fill').value;
    const strokeColor = strokeNone ? 'none' : document.getElementById('layer-draw-stroke').value;
    const strokeW     = strokeNone ? 0      : (parseFloat(document.getElementById('layer-draw-stroke-width').value) || 0);
    const opacity     = parseInt(document.getElementById('layer-draw-opacity').value, 10) / 100;

    const el = document.createElementNS(ns, 'polygon');
    el.setAttribute('points', pts.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' '));
    el.setAttribute('fill', fillColor);
    if (strokeColor !== 'none' && strokeW > 0) {
        el.setAttribute('stroke',       strokeColor);
        el.setAttribute('stroke-width', strokeW.toString());
    } else {
        el.setAttribute('stroke', 'none');
    }
    if (opacity < 1) el.setAttribute('opacity', opacity.toFixed(3));

    el.classList.add('draw-shape');
    el.id = 'draw-' + Date.now();
    el.setAttribute('data-angle', '0');
    el.setAttribute('data-shape-kind', 'polygon');

    targetG.appendChild(el);
    _layerDrawState.undoStack.push({ el, parentG: targetG });

    if (state.selectedOverlay) {
        await saveOverlaySvg(svgEl);
    } else if (state.selectedPanelId) {
        await savePanelSvg(state.selectedPanelId, svgEl);
    }
    _layerDrawSelectShape(el, svgEl);
    return true;
}

