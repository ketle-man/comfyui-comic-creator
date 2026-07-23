// ============================================================
// SVGレイヤーへの描画機能 分割ファイル (3/3): draw-shapeハンドル・操作
// 元 17-layer-draw.js（分割前）の行 1015-1574 に相当
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: _drawShapeApplyRotation,_drawShapeExtractFillState,_drawShapeGetBounds,_drawShapeSetBounds,_drawShapeSyncProps,_drawShapeSyncTexturePatternTransform,_drawUpdateTransformForPathG,_initEditTabTrigger,_layerDrawSelectShape,_polygonBakeRotation,_polygonDisplayPoints,_polygonGetPoints,_polygonPointsBounds,_polygonSetPoints,_renderPolygonVertexHandles,clearDrawShapeHandles,initDrawShapeManipulation,renderDrawShapeHandles,updateDrawShapeHandles
// ============================================================

// ─────────────────────────────────────────────
//  draw-shape ハンドル・操作
// ─────────────────────────────────────────────

function clearDrawShapeHandles(svgEl) {
    const root = svgEl || document;
    root.querySelectorAll('.draw-handle, .draw-bbox, .draw-rotate-line').forEach(h => h.remove());
}

// draw-shape 選択（ハンドル表示・state更新）
function _layerDrawSelectShape(el, svgEl) {
    // 他の選択をクリア
    clearDrawShapeHandles(svgEl);
    clearImageHandles(svgEl);
    clearHandles();
    if (svgEl) clearTextHandles(svgEl);
    clearGroupHandles();
    svgEl.querySelectorAll('.draw-shape').forEach(s => s.classList.remove('selected'));
    el.classList.add('selected');
    state.selectedDrawId = el.id;
    state.selectedDrawEl = el;
    state.selectedImageId = null;
    state.selectedImageEl = null;
    state.selectedShapeId = null;
    state.selectedTextEl  = null;
    state.selectedGroupId = null;
    state.balloon.isEditMode = false;
    renderDrawShapeHandles(el, svgEl);
    _drawShapeSyncProps(el);
    syncPanelSelectionToObject(el);
    renderLayerPanel();
}

// 選択中のdraw-shape要素のfill属性（単色/none/url(#グラデ・パターン)）を解析し、
// _layerDrawFillState / UIへ復元できる形（_fontMgrExtractStyleFromTextEl の塗り抽出部と同じロジック）で返す。
// テキスト用の抽出関数を流用しない（font-weight等テキスト専用属性を読みに行くため）ミニマム版
function _drawShapeExtractFillState(el, svgEl) {
    const fillAttr = el.getAttribute('fill') || 'none';
    let fillEnabled = true, fillMode = 'solid', fillSolid = '#000000';
    let fillGradient = null, fillTexture = null;
    if (fillAttr === 'none') {
        fillEnabled = false;
    } else {
        const um = /url\(["']?#([^"')]+)["']?\)/.exec(fillAttr);
        const def = um && svgEl ? svgEl.querySelector(`[id="${um[1]}"]`) : null;
        if (def && (def.tagName === 'linearGradient' || def.tagName === 'radialGradient')) {
            fillMode = 'gradient';
            const stops = [...def.querySelectorAll('stop')].map(s => ({
                pos: parseFloat(s.getAttribute('offset')) || 0,
                color: s.getAttribute('stop-color') || '#000000',
            }));
            let shape = 'linear', angleDeg = 0;
            if (def.tagName === 'radialGradient') {
                shape = 'radial';
            } else {
                const x1 = parseFloat(def.getAttribute('x1') ?? 0), y1 = parseFloat(def.getAttribute('y1') ?? 0);
                const x2 = parseFloat(def.getAttribute('x2') ?? 1), y2 = parseFloat(def.getAttribute('y2') ?? 0);
                angleDeg = Math.round(Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI);
                if (angleDeg < 0) angleDeg += 360;
            }
            fillGradient = { shape, angleDeg, stops: stops.length ? stops : [{ pos: 0, color: '#ffffff' }, { pos: 1, color: '#888888' }] };
            fillSolid = stops[0]?.color || '#000000';
        } else if (def && def.tagName === 'pattern') {
            fillMode = 'texture';
            const img = def.querySelector('image');
            fillTexture = {
                dataUrl: img?.getAttribute('href') || img?.getAttribute('xlink:href') || '',
                w: parseFloat(def.getAttribute('data-ccc-tex-w')) || 100,
                h: parseFloat(def.getAttribute('data-ccc-tex-h')) || 100,
                scale: parseFloat(def.getAttribute('data-ccc-tex-scale')) || 100,
                offsetX: parseFloat(def.getAttribute('data-ccc-tex-offset-x')) || 0,
                offsetY: parseFloat(def.getAttribute('data-ccc-tex-offset-y')) || 0,
            };
        } else if (!um) {
            fillSolid = fillAttr;
        }
    }
    return { fillEnabled, fillMode, fill: fillSolid, fillGradient, fillTexture };
}

// draw-shape の現在プロパティを描画UIに同期（図形編集モードON時に選択図形から同期）
function _drawShapeSyncProps(el) {
    if (!el) return;
    if (!_layerDrawState.editMode) return;

    const svgEl = el.ownerSVGElement;
    const fillState = _drawShapeExtractFillState(el, svgEl);
    const stroke  = el.getAttribute('stroke') || 'none';
    const sw      = parseFloat(el.getAttribute('stroke-width') || 0);
    const opacity = Math.round((parseFloat(el.getAttribute('opacity') || 1)) * 100);

    const strokeNone = stroke === 'none';

    const drawFill   = document.getElementById('layer-draw-fill');
    const drawStroke = document.getElementById('layer-draw-stroke');

    document.getElementById('layer-draw-fill-none').checked = !fillState.fillEnabled;
    drawFill.disabled = !fillState.fillEnabled;
    drawFill.value    = fillState.fillEnabled ? _svgColorToHex6(fillState.fill) : '#000000';
    document.getElementById('layer-draw-fill-mode').disabled = !fillState.fillEnabled;
    _layerDrawLoadFillStateFromShape(fillState);

    document.getElementById('layer-draw-stroke-none').checked   = strokeNone;
    drawStroke.disabled = strokeNone;
    drawStroke.value    = strokeNone ? '#000000' : _svgColorToHex6(stroke);
    document.getElementById('layer-draw-stroke-width').disabled = strokeNone;
    document.getElementById('layer-draw-stroke-width').value    = sw;

    document.getElementById('layer-draw-opacity').value             = opacity;
    document.getElementById('layer-draw-opacity-value').textContent = opacity + '%';
}

// ── polygon（多角形）用ジオメトリヘルパー ──

// points属性 → [{x, y}] 配列
function _polygonGetPoints(el) {
    const raw = (el.getAttribute('points') || '').trim();
    if (!raw) return [];
    const nums = raw.split(/[\s,]+/).map(parseFloat).filter(n => !isNaN(n));
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
    return pts;
}

// [{x, y}] 配列 → points属性
function _polygonSetPoints(el, pts) {
    el.setAttribute('points', pts.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' '));
}

// 頂点配列のバウンディングボックス
function _polygonPointsBounds(pts) {
    if (pts.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach(p => {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    });
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// data-angle の回転を適用した表示座標を返す（頂点ハンドルの描画位置用）
function _polygonDisplayPoints(el, pts) {
    const angle = parseFloat(el.dataset.angle || 0);
    if (!angle) return pts;
    const b = _polygonPointsBounds(pts);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const rad = angle * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    return pts.map(p => ({
        x: cx + (p.x - cx) * cos - (p.y - cy) * sin,
        y: cy + (p.x - cx) * sin + (p.y - cy) * cos,
    }));
}

// 回転をpoints座標に焼き込み、transformを除去する（頂点編集は無回転座標系で行うため）
function _polygonBakeRotation(el) {
    const angle = parseFloat(el.dataset.angle || 0);
    if (!angle) return;
    _polygonSetPoints(el, _polygonDisplayPoints(el, _polygonGetPoints(el)));
    el.removeAttribute('transform');
    el.dataset.angle = '0';
}

// draw-shape の getBBox をSVG座標系で取得（line はx/y/width/heightから算出）
function _drawShapeGetBounds(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'rect') {
        return {
            x: parseFloat(el.getAttribute('x') || 0),
            y: parseFloat(el.getAttribute('y') || 0),
            w: parseFloat(el.getAttribute('width')  || 0),
            h: parseFloat(el.getAttribute('height') || 0),
        };
    } else if (tag === 'ellipse') {
        const cx = parseFloat(el.getAttribute('cx') || 0);
        const cy = parseFloat(el.getAttribute('cy') || 0);
        const rx = parseFloat(el.getAttribute('rx') || 0);
        const ry = parseFloat(el.getAttribute('ry') || 0);
        return { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 };
    } else if (tag === 'line') {
        const x1 = parseFloat(el.getAttribute('x1') || 0);
        const y1 = parseFloat(el.getAttribute('y1') || 0);
        const x2 = parseFloat(el.getAttribute('x2') || 0);
        const y2 = parseFloat(el.getAttribute('y2') || 0);
        return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2-x1), h: Math.abs(y2-y1), x1, y1, x2, y2 };
    } else if (tag === 'polygon') {
        return _polygonPointsBounds(_polygonGetPoints(el));
    } else if (tag === 'path' || tag === 'g') {
        return {
            x: parseFloat(el.getAttribute('data-x') || 0),
            y: parseFloat(el.getAttribute('data-y') || 0),
            w: parseFloat(el.getAttribute('data-w') || 0),
            h: parseFloat(el.getAttribute('data-h') || 0),
        };
    }
    const bb = el.getBBox();
    return { x: bb.x, y: bb.y, w: bb.width, h: bb.height };
}

// 無回転のバウンディングボックス(x,y,w,h)と回転角(度)から、回転後の8ハンドル位置(絶対座標)を計算する。
// SVGのtransform="rotate(angle,cx,cy)"と同じ回転行列(x'=cx+lx*cos-ly*sin, y'=cy+lx*sin+ly*cos)を使うことで、
// 図形本体の回転描画とハンドル表示位置を一致させる。
function _drawShapeGetRotatedHandlePositions(b, angleDeg) {
    const hw = b.w / 2, hh = b.h / 2;
    const cx = b.x + hw, cy = b.y + hh;
    const rad  = angleDeg * Math.PI / 180;
    const cosR = Math.cos(rad), sinR = Math.sin(rad);
    const rot = (lx, ly) => [cx + lx * cosR - ly * sinR, cy + lx * sinR + ly * cosR];
    return {
        nw: rot(-hw, -hh), n: rot(0, -hh), ne: rot(hw, -hh),
        e:  rot(hw, 0),    se: rot(hw, hh), s: rot(0, hh),
        sw: rot(-hw, hh),  w: rot(-hw, 0),
    };
}

// 回転を考慮した回転ハンドル(上辺中央からoffset上)の位置を返す
function _drawShapeGetRotateHandlePos(b, angleDeg, offset) {
    const hh  = b.h / 2;
    const rad = angleDeg * Math.PI / 180;
    const cosR = Math.cos(rad), sinR = Math.sin(rad);
    const cx = b.x + b.w / 2, cy = b.y + hh;
    // ローカル座標 (0, -(hh+offset)) を回転
    const rotTopX = cx + hh * sinR;
    const rotTopY = cy - hh * cosR;
    const rotHx   = rotTopX + offset * sinR;
    const rotHy   = rotTopY - offset * cosR;
    return { rotTopX, rotTopY, rotHx, rotHy };
}

// draw-shape にハンドルを描画
function renderDrawShapeHandles(el, svgEl) {
    clearDrawShapeHandles(svgEl);

    const b = _drawShapeGetBounds(el);
    const x = b.x, y = b.y, w = b.w, h = b.h;

    const vb   = svgEl.viewBox.baseVal;
    const rect = svgEl.getBoundingClientRect();
    const scale = rect.width ? vb.width / rect.width : 1;
    const r = Math.round(scale * 8);
    const sw = Math.round(scale * 1.5);
    const angle = parseFloat(el.dataset.angle || 0);

    // バウンディングボックス線（回転する図形に追従させる）
    const bbox = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bbox.setAttribute('x', x); bbox.setAttribute('y', y);
    bbox.setAttribute('width', w); bbox.setAttribute('height', h);
    bbox.setAttribute('class', 'draw-bbox');
    bbox.setAttribute('stroke-width', sw);
    bbox.style.pointerEvents = 'none';
    if (angle) bbox.setAttribute('transform', `rotate(${angle},${x + w / 2},${y + h / 2})`);
    svgEl.appendChild(bbox);

    // 8点ハンドル（lineは4点のみ）。回転を考慮した位置に配置する
    const tag = el.tagName.toLowerCase();
    const rotated = _drawShapeGetRotatedHandlePositions(b, angle);
    const types = tag === 'line' ? ['nw', 'ne', 'se', 'sw'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    types.forEach(type => {
        const [hx, hy] = rotated[type];
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('cx', hx); c.setAttribute('cy', hy); c.setAttribute('r', r);
        c.setAttribute('stroke-width', Math.round(r * 0.25));
        c.setAttribute('class', `draw-handle resize-handle resize-${type}`);
        c.setAttribute('data-handle-type', type);
        c.style.pointerEvents = 'auto';
        svgEl.appendChild(c);
    });

    // 回転ハンドル
    const offset = scale * 24;
    const { rotTopX, rotTopY, rotHx, rotHy } = _drawShapeGetRotateHandlePos(b, angle, offset);

    const rLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    rLine.setAttribute('x1', rotTopX); rLine.setAttribute('y1', rotTopY);
    rLine.setAttribute('x2', rotHx);   rLine.setAttribute('y2', rotHy);
    rLine.setAttribute('class', 'draw-rotate-line');
    rLine.setAttribute('stroke-width', sw);
    rLine.style.pointerEvents = 'none';
    svgEl.appendChild(rLine);

    const rotC = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    rotC.setAttribute('cx', rotHx); rotC.setAttribute('cy', rotHy); rotC.setAttribute('r', r);
    rotC.setAttribute('stroke-width', Math.round(r * 0.25));
    rotC.setAttribute('class', 'draw-handle rotate-handle');
    rotC.setAttribute('data-handle-type', 'rotate');
    rotC.style.pointerEvents = 'auto';
    svgEl.appendChild(rotC);

    // 多角形は頂点ハンドル（四角）も表示
    if (tag === 'polygon') _renderPolygonVertexHandles(el, svgEl, r);
}

// polygon の頂点ハンドル（四角）を描画
function _renderPolygonVertexHandles(el, svgEl, r) {
    const dispPts = _polygonDisplayPoints(el, _polygonGetPoints(el));
    const side = r * 1.4;
    dispPts.forEach((p, i) => {
        const h = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        h.setAttribute('x', p.x - side / 2);
        h.setAttribute('y', p.y - side / 2);
        h.setAttribute('width', side);
        h.setAttribute('height', side);
        h.setAttribute('stroke-width', Math.round(r * 0.25));
        h.setAttribute('class', 'draw-handle vertex-handle');
        h.setAttribute('data-handle-type', 'vertex');
        h.setAttribute('data-vertex-index', i);
        h.style.pointerEvents = 'auto';
        h.style.cursor = 'move';
        svgEl.appendChild(h);
    });
}

// draw-shape のハンドル位置を更新
function updateDrawShapeHandles(el, svgEl) {
    const b = _drawShapeGetBounds(el);
    const x = b.x, y = b.y, w = b.w, h = b.h;
    const angle = parseFloat(el.dataset.angle || 0);

    const bbox = svgEl.querySelector('.draw-bbox');
    if (bbox) {
        bbox.setAttribute('x', x); bbox.setAttribute('y', y);
        bbox.setAttribute('width', w); bbox.setAttribute('height', h);
        if (angle) bbox.setAttribute('transform', `rotate(${angle},${x + w / 2},${y + h / 2})`);
        else bbox.removeAttribute('transform');
    }
    const positions = _drawShapeGetRotatedHandlePositions(b, angle);

    const vb     = svgEl.viewBox.baseVal;
    const sRect  = svgEl.getBoundingClientRect();
    const sc     = sRect.width ? vb.width / sRect.width : 1;
    const offset = sc * 24;
    const { rotTopX, rotTopY, rotHx, rotHy } = _drawShapeGetRotateHandlePos(b, angle, offset);
    positions['rotate'] = [rotHx, rotHy];

    svgEl.querySelectorAll('.draw-handle').forEach(h => {
        const pos = positions[h.dataset.handleType];
        if (pos) { h.setAttribute('cx', pos[0]); h.setAttribute('cy', pos[1]); }
    });
    const rLine = svgEl.querySelector('.draw-rotate-line');
    if (rLine) {
        rLine.setAttribute('x1', rotTopX); rLine.setAttribute('y1', rotTopY);
        rLine.setAttribute('x2', rotHx);   rLine.setAttribute('y2', rotHy);
    }

    // polygon の頂点ハンドル位置を更新
    if (el.tagName.toLowerCase() === 'polygon') {
        const dispPts = _polygonDisplayPoints(el, _polygonGetPoints(el));
        svgEl.querySelectorAll('.draw-handle.vertex-handle').forEach(h => {
            const p = dispPts[parseInt(h.dataset.vertexIndex, 10)];
            if (!p) return;
            const side = parseFloat(h.getAttribute('width')) || 0;
            h.setAttribute('x', p.x - side / 2);
            h.setAttribute('y', p.y - side / 2);
        });
    }
}

// path/g 要素の transform を dataset の論理座標・回転角から一括生成する
function _drawUpdateTransformForPathG(el) {
    const x = parseFloat(el.getAttribute('data-x') || 0);
    const y = parseFloat(el.getAttribute('data-y') || 0);
    const w = parseFloat(el.getAttribute('data-w') || 0);
    const h = parseFloat(el.getAttribute('data-h') || 0);
    const rx = parseFloat(el.getAttribute('data-raw-x') || 0);
    const ry = parseFloat(el.getAttribute('data-raw-y') || 0);
    const rw = parseFloat(el.getAttribute('data-raw-w') || 0);
    const rh = parseFloat(el.getAttribute('data-raw-h') || 0);
    const angle = parseFloat(el.dataset.angle || 0);

    if (rw === 0 || rh === 0) return;

    const sw = w / rw;
    const sh = h / rh;
    const cx = x + w / 2;
    const cy = y + h / 2;

    const svg = el.ownerSVGElement;
    if (!svg) return;

    // 1. Mapping: Raw (intrinsic) -> Logical (axis-aligned)
    // T(x, y) * S(sw, sh) * T(-rx, -ry)
    let mMapping = svg.createSVGMatrix()
        .translate(x, y)
        .scaleNonUniform(sw, sh)
        .translate(-rx, -ry);
        
    // 2. Rotation around Logical Center
    // T(cx, cy) * R(angle) * T(-cx, -cy)
    let mRotation = svg.createSVGMatrix()
        .translate(cx, cy)
        .rotate(angle)
        .translate(-cx, -cy);
        
    // 3. Final Matrix = Rotation * Mapping
    let m = mRotation.multiply(mMapping);

    // 高精度で適用 (a,b,c,dは8桁, e,fは4桁)
    const mStr = `matrix(${m.a.toFixed(8)},${m.b.toFixed(8)},${m.c.toFixed(8)},${m.d.toFixed(8)},${m.e.toFixed(4)},${m.f.toFixed(4)})`;
    el.setAttribute('transform', mStr);
}

// draw-shape に rotate transform を適用（回転はtransform属性で管理）
function _drawShapeApplyRotation(el, angle) {
    el.dataset.angle = angle.toFixed(3);
    const tag = el.tagName.toLowerCase();
    
    if (tag === 'path' || tag === 'g') {
        _drawUpdateTransformForPathG(el);
    } else {
        const b = _drawShapeGetBounds(el);
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        if (angle === 0) {
            el.removeAttribute('transform');
        } else {
            el.setAttribute('transform', `rotate(${angle.toFixed(3)},${cx.toFixed(2)},${cy.toFixed(2)})`);
        }
    }
}

// draw-shape の操作（移動・リサイズ・回転）
// window登録のmouseupリスナー参照（renderLayoutTab()経由の再初期化で積み上がらないよう保持）
let _drawShapeManipWinMouseUp = null;

function initDrawShapeManipulation(svgEl) {
    if (_drawShapeManipWinMouseUp) { window.removeEventListener('mouseup', _drawShapeManipWinMouseUp); _drawShapeManipWinMouseUp = null; }

    let dragging = false, resizing = false, rotating = false;
    let resizeDir = null;
    let startSvgX, startSvgY;
    let initBounds = null;
    let initAngle = 0, startAngleRad = 0;
    let vertexDragging = false, vertexIdx = -1;

    const getSvgPt = (clientX, clientY) => {
        const pt = svgEl.createSVGPoint();
        pt.x = clientX; pt.y = clientY;
        return pt.matrixTransform(svgEl.getScreenCTM().inverse());
    };

    // draw-shape クリック→選択
    svgEl.addEventListener('click', (e) => {
        if (e.target.closest('.draw-handle')) return;
        const ds = e.target.closest('.draw-shape');
        if (ds) {
            if (_isObjectLocked(ds)) return;
            _layerDrawSelectShape(ds, svgEl);
            renderLayerPanel();
            return;
        }
        // SVG背景クリックで選択解除
        if (e.target === svgEl && state.selectedDrawEl) {
            clearDrawShapeHandles(svgEl);
            state.selectedDrawId = null;
            state.selectedDrawEl = null;
            _drawShapeSyncProps(null);
        }
    });

    svgEl.addEventListener('mousedown', (e) => {
        const el = state.selectedDrawEl;

        // 頂点ハンドル（polygon）
        const vh = e.target.closest('.draw-handle.vertex-handle');
        if (vh && el && el.tagName.toLowerCase() === 'polygon') {
            // 回転が掛かっていれば頂点座標に焼き込んでから編集する
            _polygonBakeRotation(el);
            vertexIdx = parseInt(vh.dataset.vertexIndex, 10);
            vertexDragging = true;
            e.preventDefault(); e.stopPropagation();
            return;
        }
        // 回転ハンドル
        if (e.target.closest('.draw-handle.rotate-handle') && el) {
            const pt = getSvgPt(e.clientX, e.clientY);
            const b  = _drawShapeGetBounds(el);
            const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
            initAngle     = parseFloat(el.dataset.angle || 0);
            startAngleRad = Math.atan2(pt.y - cy, pt.x - cx);
            rotating      = true;
            e.preventDefault(); e.stopPropagation();
            return;
        }
        // リサイズハンドル
        const rh = e.target.closest('.draw-handle.resize-handle');
        if (rh && el) {
            const pt = getSvgPt(e.clientX, e.clientY);
            resizeDir  = rh.dataset.handleType;
            initBounds = { ..._drawShapeGetBounds(el) };
            initAngle  = parseFloat(el.dataset.angle || 0);
            startSvgX  = pt.x; startSvgY = pt.y;
            resizing   = true;
            e.preventDefault(); e.stopPropagation();
            return;
        }
        // draw-shape 本体ドラッグ（移動）
        const ds = e.target.closest('.draw-shape');
        if (ds && !_isObjectLocked(ds)) {
            const dsId = ds.id;
            // 選択状態を必ず dsId に更新（古い参照・別図形の誤作動を防止）
            if (dsId !== state.selectedDrawId) {
                _layerDrawSelectShape(ds, svgEl);
                renderLayerPanel();
            }
            state.selectedDrawId = dsId;
            // DOM再取得で最新参照を確保
            const currentEl = svgEl.querySelector(`#${CSS.escape(dsId)}`);
            if (!currentEl) return;
            state.selectedDrawEl = currentEl;
            const pt = getSvgPt(e.clientX, e.clientY);
            initBounds = { ..._drawShapeGetBounds(currentEl) };
            startSvgX  = pt.x; startSvgY = pt.y;
            dragging   = true;
            e.preventDefault(); e.stopPropagation();
        }
    });

    svgEl.addEventListener('mousemove', (e) => {
        if (!dragging && !resizing && !rotating && !vertexDragging) return;
        // DOM再構築後もIDでDOM要素を再取得
        const el = state.selectedDrawId
            ? (svgEl.querySelector(`#${CSS.escape(state.selectedDrawId)}`) || state.selectedDrawEl)
            : state.selectedDrawEl;
        if (el && el !== state.selectedDrawEl) state.selectedDrawEl = el;
        if (!el) return;
        const pt = getSvgPt(e.clientX, e.clientY);
        const dx = pt.x - startSvgX, dy = pt.y - startSvgY;
        const tag = el.tagName.toLowerCase();

        if (vertexDragging) {
            if (tag !== 'polygon') return;
            const pts = _polygonGetPoints(el);
            if (!pts[vertexIdx]) return;
            pts[vertexIdx] = { x: pt.x, y: pt.y };
            _polygonSetPoints(el, pts);
            _drawShapeSyncTexturePatternTransform(el);
            updateDrawShapeHandles(el, svgEl);
        } else if (rotating) {
            const b  = _drawShapeGetBounds(el);
            const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
            const curRad = Math.atan2(pt.y - cy, pt.x - cx);
            const deltaRad = curRad - startAngleRad;
            const newAngle = initAngle + deltaRad * 180 / Math.PI;
            _drawShapeApplyRotation(el, newAngle);
            updateDrawShapeHandles(el, svgEl);
        } else if (resizing) {
            const b = initBounds;
            const dir = resizeDir;
            // 回転を考慮: マウスの移動量(dx,dy)を図形のローカル座標系(無回転)へ逆回転する
            const rad  = initAngle * Math.PI / 180;
            const cosR = Math.cos(rad), sinR = Math.sin(rad);
            const ldx  = dx * cosR + dy * sinR;
            const ldy  = -dx * sinR + dy * cosR;

            let nx = b.x, ny = b.y, nw = b.w, nh = b.h;
            if (dir.includes('e')) nw = Math.max(1, b.w + ldx);
            if (dir.includes('s')) nh = Math.max(1, b.h + ldy);
            if (dir.includes('w')) { nx = b.x + ldx; nw = Math.max(1, b.w - ldx); }
            if (dir.includes('n')) { ny = b.y + ldy; nh = Math.max(1, b.h - ldy); }

            if (initAngle) {
                // ローカル座標系での中心移動量を回転してグローバル座標系に変換し、
                // 回転中心(=図形の中心)が正しい位置に来るようx,yを補正する
                const oldCx = b.x + b.w / 2, oldCy = b.y + b.h / 2;
                const newCxLocal = nx + nw / 2, newCyLocal = ny + nh / 2;
                const dcxLocal = newCxLocal - oldCx, dcyLocal = newCyLocal - oldCy;
                const dcxGlobal = dcxLocal * cosR - dcyLocal * sinR;
                const dcyGlobal = dcxLocal * sinR + dcyLocal * cosR;
                nx = oldCx + dcxGlobal - nw / 2;
                ny = oldCy + dcyGlobal - nh / 2;
            }

            _drawShapeSetBounds(el, nx, ny, nw, nh);
            updateDrawShapeHandles(el, svgEl);
        } else if (dragging) {
            const b = initBounds;
            _drawShapeSetBounds(el, b.x + dx, b.y + dy, b.w, b.h);
            updateDrawShapeHandles(el, svgEl);
        }
    });

    const onMouseUp = async () => {
        if ((!dragging && !resizing && !rotating && !vertexDragging) || !state.selectedDrawEl) return;
        dragging = resizing = rotating = vertexDragging = false;
        vertexIdx = -1;
        const svgRoot = getPanelLayerSvg();
        if (!svgRoot) return;
        if (state.selectedOverlay) await saveOverlaySvg(svgRoot);
        else if (state.selectedPanelId) await savePanelSvg(state.selectedPanelId, svgRoot);
    };
    svgEl.addEventListener('mouseup', onMouseUp);
    _drawShapeManipWinMouseUp = onMouseUp;
    window.addEventListener('mouseup', _drawShapeManipWinMouseUp);
}

// draw-shape の座標属性を更新（tag別）
function _drawShapeSetBounds(el, x, y, w, h) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'rect') {
        el.setAttribute('x', x.toFixed(2));
        el.setAttribute('y', y.toFixed(2));
        el.setAttribute('width',  Math.max(1, w).toFixed(2));
        el.setAttribute('height', Math.max(1, h).toFixed(2));
    } else if (tag === 'ellipse') {
        el.setAttribute('cx', (x + w / 2).toFixed(2));
        el.setAttribute('cy', (y + h / 2).toFixed(2));
        el.setAttribute('rx', Math.max(1, w / 2).toFixed(2));
        el.setAttribute('ry', Math.max(1, h / 2).toFixed(2));
    } else if (tag === 'line') {
        // lineはnw→seの対角でリサイズ
        el.setAttribute('x1', x.toFixed(2)); el.setAttribute('y1', y.toFixed(2));
        el.setAttribute('x2', (x + w).toFixed(2)); el.setAttribute('y2', (y + h).toFixed(2));
    } else if (tag === 'polygon') {
        // 現在のバウンディングボックス→新しい境界へ全頂点をアフィン変換
        const pts = _polygonGetPoints(el);
        const b = _polygonPointsBounds(pts);
        const sx = b.w > 0 ? Math.max(1, w) / b.w : 1;
        const sy = b.h > 0 ? Math.max(1, h) / b.h : 1;
        _polygonSetPoints(el, pts.map(p => ({ x: x + (p.x - b.x) * sx, y: y + (p.y - b.y) * sy })));
    } else if (tag === 'path' || tag === 'g') {
        el.setAttribute('data-x', x.toFixed(2));
        el.setAttribute('data-y', y.toFixed(2));
        el.setAttribute('data-w', Math.max(1, w).toFixed(2));
        el.setAttribute('data-h', Math.max(1, h).toFixed(2));
        _drawUpdateTransformForPathG(el);
        return; // transform は内部で処理済み（テクスチャもtransformで一緒に動くため追従処理は不要）
    }
    // rect/ellipse/line/polygon は座標を直接書き換えて移動するため、テクスチャ塗りが
    // シェイプに追従するようパターンにもpatternTransformを再適用する
    _drawShapeSyncTexturePatternTransform(el);
    // 回転があれば再適用
    const angle = parseFloat(el.dataset.angle || 0);
    if (angle !== 0) _drawShapeApplyRotation(el, angle);
}

// rect/ellipse/line/polygon のテクスチャ塗り（<pattern> patternUnits="userSpaceOnUse"）は
// 絶対座標に固定されるため、シェイプの座標を直接書き換えて移動・リサイズすると、テクスチャが
// 「シェイプに対してスライドする」ように見えてしまう。
// （curve/vectorcurve等のpath/g要素はtransformで移動するため、パターンも一緒に動きこの問題が起きない）
// 作成時点の生座標（data-raw-x/y/w/h）→現在のbboxへのアフィン変換をpatternTransformとして
// パターンにも適用し、path/g系と同じ「テクスチャがシェイプに対して動かない」見た目に揃える。
// 回転はrect/ellipse/line/polygonでも要素自身のtransform="rotate(...)"で行われており、
// それはパターンにもそのまま継承されるためここでは扱わない（平行移動・リサイズ分のみ補正すればよい）。
function _drawShapeSyncTexturePatternTransform(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'path' || tag === 'g') return; // これらは要素自身のtransformでテクスチャも追従するため対象外
    const fillId = el.dataset.styleFillId;
    if (!fillId) return;
    const svgEl = el.ownerSVGElement;
    const pattern = svgEl?.querySelector(`[id="${fillId}"]`);
    if (!pattern || pattern.tagName.toLowerCase() !== 'pattern') return;

    const rawX = parseFloat(el.getAttribute('data-raw-x'));
    const rawY = parseFloat(el.getAttribute('data-raw-y'));
    const rawW = parseFloat(el.getAttribute('data-raw-w'));
    const rawH = parseFloat(el.getAttribute('data-raw-h'));
    // data-raw-*を持たない旧データ（本機能追加以前に作成された図形）は補正しようがないため何もしない
    if (!rawW || !rawH || isNaN(rawX) || isNaN(rawY)) return;

    const b = _drawShapeGetBounds(el);
    const sx = b.w / rawW, sy = b.h / rawH;
    const tx = b.x - rawX * sx, ty = b.y - rawY * sy;
    if (Math.abs(sx - 1) < 1e-6 && Math.abs(sy - 1) < 1e-6 && Math.abs(tx) < 0.005 && Math.abs(ty) < 0.005) {
        pattern.removeAttribute('patternTransform');
    } else {
        pattern.setAttribute('patternTransform', `matrix(${sx.toFixed(6)},0,0,${sy.toFixed(6)},${tx.toFixed(4)},${ty.toFixed(4)})`);
    }
}

// ─────────────────────────────────────────────

// サブタブ切り替え時に Edit タブが選択されたら画像ロード
// （initSubtabs の拡張として DOMContentLoaded 後に追加）
function _initEditTabTrigger() {
    document.querySelectorAll('.subtab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.subtab !== 'edit') {
                // Editタブから離れたらレイヤー描画をOFF
                if (_layerDrawState.active) {
                    _layerDrawState.active = false;
                    _layerDrawUpdateToggle();
                    _layerDrawDetachOverlay();
                }
            }
        });
    });
}

