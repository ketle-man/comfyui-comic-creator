// ============================================================
// SVGレイヤーへの描画機能 分割ファイル (2/3): SVG要素の確定・追加+Undo+ユーティリティ
// 元 17-layer-draw.js（分割前）の行 716-1014 に相当
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: _createChainElementNS,_createOriginalElementNS,_createRopeElementNS,_layerDrawCommit,_layerDrawCommitInner,_layerDrawSetStatus,_layerDrawTargetLabel,_layerDrawUndo
// ============================================================

// ──────────────────────
// SVG要素の確定・追加
// ──────────────────────
async function _layerDrawCommit() {
    try {
        await _layerDrawCommitInner();
    } catch (err) {
        console.error('Draw commit error:', err);
    } finally {
        _layerDrawState.active = false;
        _layerDrawUpdateToggle();
        _layerDrawDetachOverlay();
    }
}

async function _layerDrawCommitInner() {
    const s = _layerDrawState.startSvgPt;
    const c = _layerDrawState.curSvgPt;
    const points = _layerDrawState.points;
    if (!s || !c) return;

    const shape   = document.getElementById('layer-draw-shape').value;
    const isFreehand = ['curve', 'chain', 'rope', 'original'].includes(shape);

    if (!isFreehand) {
        const dx = Math.abs(c.x - s.x), dy = Math.abs(c.y - s.y);
        if (dx < 2 && dy < 2) return;
    } else if (points.length < 2) {
        return;
    }

    const svgEl = getPanelLayerSvg();
    if (!svgEl) return;
    if (!state.selectedPanelId && !state.selectedOverlay) {
        _layerDrawSetStatus(t('draw.selectTargetBeforeDraw'));
        return;
    }
    const targetG = getOrCreateClipGroup(svgEl);

    const ns      = 'http://www.w3.org/2000/svg';
    const strokeNone  = document.getElementById('layer-draw-stroke-none').checked;
    const strokeColor = strokeNone ? 'none' : document.getElementById('layer-draw-stroke').value;
    const strokeW     = strokeNone ? 0      : (parseFloat(document.getElementById('layer-draw-stroke-width').value) || 0);
    const opacity     = parseInt(document.getElementById('layer-draw-opacity').value, 10) / 100;
    const rounded     = document.getElementById('layer-draw-rounded').checked;
    // 鎖・ロープ用: プレビュー(17a _layerDrawMouseMove)と同じ解釈で太さ・色を決める
    // （線なし/0でもプレビュー同様5にフォールバック。ここがズレると描画時と確定後の太さが変わる）
    const cellW     = parseFloat(document.getElementById('layer-draw-stroke-width').value) || 5;
    const cellColor = document.getElementById('layer-draw-stroke').value;

    let el;
    if (shape === 'curve') {
        el = document.createElementNS(ns, 'path');
        let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
        for (let i = 1; i < points.length; i++) {
            d += ` L ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)}`;
        }
        el.setAttribute('d', d);
    } else if (shape === 'original') {
        el = document.createElementNS(ns, 'g');
        const originalImg = _layerDrawState.originalImg;
        if (originalImg) {
            const svgEl = getPanelLayerSvg(getActiveContainer());
            const svgRect = svgEl ? svgEl.getBoundingClientRect() : { width: 1 };
            const vb = svgEl ? svgEl.viewBox.baseVal : { width: 1 };
            const displayScale = svgRect.width > 0 && vb.width > 0 ? vb.width / svgRect.width : 1;
            const scale = (strokeW / 5) * displayScale;
            const spacing = Math.max(1, 20 * scale);
            let lastP = points[0];
            for (let i = 1; i < points.length; i++) {
                const currP = points[i];
                const dx = currP.x - lastP.x, dy = currP.y - lastP.y;
                let dist = Math.sqrt(dx * dx + dy * dy);
                if (dist >= spacing) {
                    const angle = Math.atan2(dy, dx);
                    while (dist >= spacing) {
                        lastP = { x: lastP.x + Math.cos(angle) * spacing, y: lastP.y + Math.sin(angle) * spacing };
                        const cell = _createOriginalElementNS(ns, lastP.x, lastP.y, angle, scale, originalImg);
                        el.appendChild(cell);
                        dist -= spacing;
                    }
                }
            }
        }
    } else if (shape === 'chain' || shape === 'rope') {
        el = document.createElementNS(ns, 'g');
        const spacing = Math.max(1, (shape === 'chain' ? 20 : 10) * (cellW / 5));
        let lastP = points[0];
        let toggle = false;
        const scale = cellW / 5;

        for (let i = 1; i < points.length; i++) {
            const currP = points[i];
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
                        const cell = _createChainElementNS(ns, lastP.x, lastP.y, angle, scale, toggle, cellColor);
                        el.appendChild(cell);
                        toggle = !toggle;
                    } else {
                        const cell = _createRopeElementNS(ns, lastP.x, lastP.y, angle, scale);
                        el.appendChild(cell);
                    }
                    dist -= spacing;
                }
            }
        }
    } else if (shape === 'ellipse') {
        el = document.createElementNS(ns, 'ellipse');
        el.setAttribute('cx', ((s.x + c.x) / 2).toFixed(2));
        el.setAttribute('cy', ((s.y + c.y) / 2).toFixed(2));
        el.setAttribute('rx', (Math.abs(c.x - s.x) / 2).toFixed(2));
        el.setAttribute('ry', (Math.abs(c.y - s.y) / 2).toFixed(2));
    } else if (shape === 'line') {
        el = document.createElementNS(ns, 'line');
        el.setAttribute('x1', s.x.toFixed(2));
        el.setAttribute('y1', s.y.toFixed(2));
        el.setAttribute('x2', c.x.toFixed(2));
        el.setAttribute('y2', c.y.toFixed(2));
    } else {
        el = document.createElementNS(ns, 'rect');
        if (rounded) {
            const x1 = Math.min(s.x, c.x), y1 = Math.min(s.y, c.y);
            const x2 = Math.max(s.x, c.x), y2 = Math.max(s.y, c.y);
            const w  = x2 - x1, h = y2 - y1;
            const r = Math.min(w, h) * 0.15;
            el.setAttribute('rx', r.toFixed(2));
            el.setAttribute('ry', r.toFixed(2));
            el.setAttribute('x', x1.toFixed(2));
            el.setAttribute('y', y1.toFixed(2));
            el.setAttribute('width', w.toFixed(2));
            el.setAttribute('height', h.toFixed(2));
        } else {
            const x1 = Math.min(s.x, c.x), y1 = Math.min(s.y, c.y);
            const x2 = Math.max(s.x, c.x), y2 = Math.max(s.y, c.y);
            el.setAttribute('x',      x1.toFixed(2));
            el.setAttribute('y',      y1.toFixed(2));
            el.setAttribute('width',  (x2-x1).toFixed(2));
            el.setAttribute('height', (y2-y1).toFixed(2));
        }
    }

    if (shape !== 'chain' && shape !== 'rope') {
        _fontMgrApplyFillPaintToEl(el, svgEl, _layerDrawGetFillStyleObj(), 1);
        if (strokeColor !== 'none' && strokeW > 0) {
            el.setAttribute('stroke',       strokeColor);
            el.setAttribute('stroke-width', strokeW.toString());
        } else {
            el.setAttribute('stroke', 'none');
        }
    } else {
        // 鎖・ロープのgにも使用した太さ・色を属性として持たせる。
        // セルは個別のstroke-widthを持つため見た目には影響しないが、確定直後の
        // _drawShapeSyncPropsがg（stroke属性なし）から「線なし・線幅0」をUIへ書き戻し、
        // 次の描画でプレビュー（フォールバック5）と確定の太さがズレるのを防ぐ
        el.setAttribute('fill', 'none');
        el.setAttribute('stroke', cellColor);
        el.setAttribute('stroke-width', cellW.toString());
    }
    if (opacity < 1) el.setAttribute('opacity', opacity.toFixed(3));
    
    el.classList.add('draw-shape');
    el.id = 'draw-' + Date.now();
    el.setAttribute('data-angle', '0');
    el.setAttribute('data-shape-kind', shape);

    targetG.appendChild(el);
    
    // 描画確定直後にバウンディングボックスを取得し、論理座標として保持する（path/g用）
    if (shape === 'curve' || shape === 'chain' || shape === 'rope' || shape === 'original') {
        const bb = el.getBBox();
        el.setAttribute('data-x', bb.x.toFixed(2));
        el.setAttribute('data-y', bb.y.toFixed(2));
        el.setAttribute('data-w', bb.width.toFixed(2));
        el.setAttribute('data-h', bb.height.toFixed(2));
        // 初期状態の生座標も保持（これに対する相対変形で transform を管理するため）
        el.setAttribute('data-raw-x', bb.x.toFixed(2));
        el.setAttribute('data-raw-y', bb.y.toFixed(2));
        el.setAttribute('data-raw-w', bb.width.toFixed(2));
        el.setAttribute('data-raw-h', bb.height.toFixed(2));
    } else if (shape === 'rect' || shape === 'ellipse' || shape === 'line') {
        // rect/ellipse/lineは座標(x/y等)を直接書き換えて移動するため、テクスチャ塗りが
        // シェイプに追従できるよう作成時点の生座標を保持する（17c: _drawShapeSyncTexturePatternTransform が使用）
        const rawBB = _drawShapeGetBounds(el);
        el.setAttribute('data-raw-x', rawBB.x.toFixed(2));
        el.setAttribute('data-raw-y', rawBB.y.toFixed(2));
        el.setAttribute('data-raw-w', rawBB.w.toFixed(2));
        el.setAttribute('data-raw-h', rawBB.h.toFixed(2));
    }

    _layerDrawState.undoStack.push({ el, parentG: targetG });

    const panelIdForSave = state.selectedOverlay ? '__overlay__' : state.selectedPanelId;
    if (state.selectedOverlay) {
        await saveOverlaySvg(svgEl);
    } else if (state.selectedPanelId) {
        await savePanelSvg(state.selectedPanelId, svgEl);
    }
    _layerDrawSelectShape(el, svgEl);
    _layerDrawSetStatus(t('draw.done'));
}

// SVG要素生成用補助関数
function _createChainElementNS(ns, x, y, angle, scale, toggle, strokeColor) {
    const g = document.createElementNS(ns, 'g');
    const deg = angle * 180 / Math.PI;
    g.setAttribute('transform', `translate(${x.toFixed(2)},${y.toFixed(2)}) rotate(${deg.toFixed(2)}) scale(${scale.toFixed(3)})`);
    if (toggle) {
        const el = document.createElementNS(ns, 'ellipse');
        el.setAttribute('cx', '0'); el.setAttribute('cy', '0');
        el.setAttribute('rx', '12'); el.setAttribute('ry', '6');
        el.setAttribute('fill', 'none');
        el.setAttribute('stroke', strokeColor);
        el.setAttribute('stroke-width', '4');
        g.appendChild(el);
    } else {
        const el = document.createElementNS(ns, 'line');
        el.setAttribute('x1', '-5'); el.setAttribute('y1', '0');
        el.setAttribute('x2', '5');  el.setAttribute('y2', '0');
        el.setAttribute('stroke', strokeColor);
        el.setAttribute('stroke-width', '8');
        el.setAttribute('stroke-linecap', 'round');
        g.appendChild(el);
    }
    return g;
}

function _createRopeElementNS(ns, x, y, angle, scale) {
    const g = document.createElementNS(ns, 'g');
    const deg = angle * 180 / Math.PI;
    g.setAttribute('transform', `translate(${x.toFixed(2)},${y.toFixed(2)}) rotate(${deg.toFixed(2)}) scale(${scale.toFixed(3)})`);
    
    const rect1 = document.createElementNS(ns, 'rect');
    rect1.setAttribute('x', '-5'); rect1.setAttribute('y', '-6');
    rect1.setAttribute('width', '12'); rect1.setAttribute('height', '12');
    rect1.setAttribute('fill', '#D4A373');
    // 親gにUI同期用のstroke属性を持たせるため、継承されないよう明示的にstrokeなしにする
    rect1.setAttribute('stroke', 'none');
    g.appendChild(rect1);

    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', '-5'); line.setAttribute('y1', '-6');
    line.setAttribute('x2', '5');  line.setAttribute('y2', '6');
    line.setAttribute('stroke', '#A98467');
    line.setAttribute('stroke-width', '2');
    g.appendChild(line);

    const rect2 = document.createElementNS(ns, 'rect');
    rect2.setAttribute('x', '-5'); rect2.setAttribute('y', '-6');
    rect2.setAttribute('width', '12'); rect2.setAttribute('height', '12');
    rect2.setAttribute('fill', 'none');
    rect2.setAttribute('stroke', '#8B5A2B');
    rect2.setAttribute('stroke-width', '1');
    g.appendChild(rect2);
    
    return g;
}

function _createOriginalElementNS(ns, x, y, angle, scale, img) {
    const w = img.naturalWidth  * scale;
    const h = img.naturalHeight * scale;
    const deg = angle * 180 / Math.PI;
    // base64 dataURLに変換してSVG <image>として埋め込む
    const canvas = document.createElement('canvas');
    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    const href = canvas.toDataURL('image/png');
    const imgEl = document.createElementNS(ns, 'image');
    imgEl.setAttribute('href', href);
    imgEl.setAttribute('x', (-w / 2).toFixed(2));
    imgEl.setAttribute('y', (-h / 2).toFixed(2));
    imgEl.setAttribute('width',  w.toFixed(2));
    imgEl.setAttribute('height', h.toFixed(2));
    const g = document.createElementNS(ns, 'g');
    g.setAttribute('transform', `translate(${x.toFixed(2)},${y.toFixed(2)}) rotate(${deg.toFixed(2)})`);
    g.appendChild(imgEl);
    return g;
}

// ──────────────────────
// Undo
// ──────────────────────
function _layerDrawUndo() {
    if (_layerDrawState.undoStack.length === 0) return;
    const { el, parentG } = _layerDrawState.undoStack.pop();
    if (el.parentNode === parentG) parentG.removeChild(el);
    const svgEl = getPanelLayerSvg();
    if (!svgEl) return;
    if (state.selectedOverlay) {
        saveOverlaySvg(svgEl);
    } else if (state.selectedPanelId) {
        savePanelSvg(state.selectedPanelId, svgEl);
    }
    _layerDrawSetStatus(t('draw.undone'));
}

// ──────────────────────
// ユーティリティ
// ──────────────────────
function _layerDrawSetStatus(msg) {
    const el = document.getElementById('layer-draw-status');
    if (el) el.textContent = msg;
}

function _layerDrawTargetLabel() {
    if (state.selectedOverlay) return t('draw.targetOverlay');
    if (state.selectedPanelId) return t('draw.targetPanel', state.selectedPanelId);
    return t('draw.targetNone');
}

// ──────────────────────
// 図形レイヤー → PNG変換（元の図形は残したまま、複製をPNG画像として挿入する）
// ──────────────────────
async function _layerDrawShapeToPng() {
    const el = state.selectedDrawEl;
    if (!el) {
        _layerDrawSetStatus(t('draw.selectShapeBeforePng'));
        return;
    }
    const svgEl = getPanelLayerSvg();
    if (!svgEl) return;
    // 実処理は convertShapeToImage（09b-balloon-shapes.js）に共通化。フキダシの「画像に変換」
    // ボタンと同じロジックで、元の図形は残したまま同じ位置・サイズにPNGを複製挿入する。
    const result = await convertShapeToImage(el, svgEl);
    if (result) _layerDrawSetStatus(t('draw.shapeToPngDone', result.width, result.height));
}

