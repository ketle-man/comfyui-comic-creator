// ============================================================
// テンプレート作成ウィザード 分割ファイル (1/3): 多角形分割ジオメトリ+グループ操作(移動含む)
// 元 06-template-wizard.js（分割前）の行 1-797 に相当
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: _applyCenterTranslate,_applyOffset,_clipPolygonByLine,_cloneWithNewIds,_dupCounter,_lineIntersect,_offsetLinePerpendicular,_pointInPolygon,_polygonArea,_polygonCentroid,_selectClone,_sideOfLine,_splitPolygonByLine,calcGroupHandleR,clearGroupHandles,initGroupManipulation,layerMove,renderGroupHandles,updateGroupHandlePositions
// ============================================================

// ==============================
// 多角形分割ジオメトリ（テンプレート作成ウィザード用）
// ==============================

// 点pが直線ab のどちら側にあるかを外積の符号で返す（正=左側, 負=右側）
function _sideOfLine(p, a, b) {
    return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

// 線分p1-p2 と 直線a-b の交点
function _lineIntersect(p1, p2, a, b) {
    const d1 = { x: p2.x - p1.x, y: p2.y - p1.y };
    const d2 = { x: b.x - a.x, y: b.y - a.y };
    const denom = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(denom) < 1e-9) return { x: p2.x, y: p2.y };
    const t = ((a.x - p1.x) * d2.y - (a.y - p1.y) * d2.x) / denom;
    return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
}

// Sutherland-Hodgman型の半平面クリップ: 直線a-bの片側（keepPositive指定側）だけを残す
function _clipPolygonByLine(pts, a, b, keepPositive) {
    const out = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
        const curr = pts[i];
        const prev = pts[(i - 1 + n) % n];
        const sCurr = _sideOfLine(curr, a, b) * (keepPositive ? 1 : -1);
        const sPrev = _sideOfLine(prev, a, b) * (keepPositive ? 1 : -1);
        if (sCurr >= 0) {
            if (sPrev < 0) out.push(_lineIntersect(prev, curr, a, b));
            out.push(curr);
        } else if (sPrev >= 0) {
            out.push(_lineIntersect(prev, curr, a, b));
        }
    }
    return out;
}

function _polygonArea(pts) {
    let area = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return Math.abs(area) / 2;
}

function _polygonCentroid(pts) {
    let cx = 0, cy = 0;
    pts.forEach(p => { cx += p.x; cy += p.y; });
    return { x: cx / pts.length, y: cy / pts.length };
}

// 点ptがポリゴンpts内部にあるかをレイキャスティング法で判定する（単一コマ分割モードの対象コマ特定に使用）
function _pointInPolygon(pt, pts) {
    let inside = false;
    const n = pts.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = pts[i].x, yi = pts[i].y;
        const xj = pts[j].x, yj = pts[j].y;
        const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
            (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// 直線a-bをその垂線方向にdistanceだけ平行移動した直線を返す
function _offsetLinePerpendicular(a, b, distance) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return { a, b };
    const nx = -dy / len, ny = dx / len;
    return {
        a: { x: a.x + nx * distance, y: a.y + ny * distance },
        b: { x: b.x + nx * distance, y: b.y + ny * distance },
    };
}

// 多角形ptsを直線a-bで2分割する。gapを指定すると、切断線の両側にgap幅の隙間（ガター）を空けて分割する
// （フレーム幅と同じ隙間をコマ間に作るため）。分割できなければnullを返す
function _splitPolygonByLine(pts, a, b, gap = 0, minArea = 1) {
    const half = gap / 2;
    const linePos = half > 0 ? _offsetLinePerpendicular(a, b, half) : { a, b };
    const lineNeg = half > 0 ? _offsetLinePerpendicular(a, b, -half) : { a, b };
    const polyA = _clipPolygonByLine(pts, linePos.a, linePos.b, true);
    const polyB = _clipPolygonByLine(pts, lineNeg.a, lineNeg.b, false);
    if (polyA.length < 3 || polyB.length < 3) return null;
    if (_polygonArea(polyA) < minArea || _polygonArea(polyB) < minArea) return null;
    return [polyA, polyB];
}

// 要素の現在中心(srcCx,srcCy)を目標中心(dstCx,dstCy)に移動するオフセットを適用
// グループ: data-tx/data-ty を更新し transform を再構築（renderGroupHandles と整合）
// 画像/テキスト/rect: x/y 属性を直接移動、tspan も同期
// その他（フキダシpath等）: transform="translate(dx,dy)" を付与
function _applyCenterTranslate(el, srcCx, srcCy, dstCx, dstCy) {
    const dx = dstCx - srcCx;
    const dy = dstCy - srcCy;
    if (dx === 0 && dy === 0) return;

    if (el.hasAttribute('data-group-id')) {
        // グループ異コマ複製:
        // 最終的な translate = (既存 data-tx/ty) + (dx,dy) を子要素に焼き込み、
        // グループ自体の data-tx/ty を 0 にリセットして「複製元情報を持たない」状態にする。
        const finalTx = parseFloat(el.getAttribute('data-tx') || '0') + dx;
        const finalTy = parseFloat(el.getAttribute('data-ty') || '0') + dy;

        // 子要素に finalTx/finalTy を転写（ungroupLayer と同じロジック）
        Array.from(el.children).forEach(child => {
            if (finalTx === 0 && finalTy === 0) return;
            const tag = child.tagName.toLowerCase();
            if (tag === 'image' || tag === 'text' || tag === 'rect') {
                child.setAttribute('x', parseFloat(child.getAttribute('x') || 0) + finalTx);
                child.setAttribute('y', parseFloat(child.getAttribute('y') || 0) + finalTy);
                if (tag === 'text') {
                    child.querySelectorAll('tspan').forEach(ts => {
                        if (ts.hasAttribute('x')) ts.setAttribute('x', parseFloat(ts.getAttribute('x')) + finalTx);
                        if (ts.hasAttribute('y')) ts.setAttribute('y', parseFloat(ts.getAttribute('y')) + finalTy);
                    });
                }
            } else if (child.hasAttribute('data-group-id')) {
                const childTx = parseFloat(child.getAttribute('data-tx') || '0') + finalTx;
                const childTy = parseFloat(child.getAttribute('data-ty') || '0') + finalTy;
                child.setAttribute('data-tx', childTx);
                child.setAttribute('data-ty', childTy);
                child.dataset.rotateCx = '0';
                child.dataset.rotateCy = '0';
                child.dataset.bboxX = '0'; child.dataset.bboxY = '0';
                child.dataset.bboxW = '0'; child.dataset.bboxH = '0';
                child.setAttribute('transform', `translate(${childTx},${childTy})`);
            } else {
                const existing = child.getAttribute('transform') || '';
                child.setAttribute('transform', existing
                    ? `translate(${finalTx},${finalTy}) ${existing}`
                    : `translate(${finalTx},${finalTy})`);
            }
        });

        // グループ自体は data-tx/ty=0 のフラット状態にリセット
        el.setAttribute('data-tx', '0');
        el.setAttribute('data-ty', '0');
        el.setAttribute('data-angle', '0');
        el.dataset.rotateCx = '0';
        el.dataset.rotateCy = '0';
        el.dataset.bboxX = '0';
        el.dataset.bboxY = '0';
        el.dataset.bboxW = '0';
        el.dataset.bboxH = '0';
        el.setAttribute('transform', 'translate(0,0)');
        return;
    }

    const tag = el.tagName.toLowerCase();
    if (tag === 'image' || tag === 'text' || tag === 'rect') {
        el.setAttribute('x', parseFloat(el.getAttribute('x') || 0) + dx);
        el.setAttribute('y', parseFloat(el.getAttribute('y') || 0) + dy);
        if (tag === 'text') {
            el.querySelectorAll('tspan').forEach(ts => {
                if (ts.hasAttribute('x')) ts.setAttribute('x', parseFloat(ts.getAttribute('x')) + dx);
                if (ts.hasAttribute('y')) ts.setAttribute('y', parseFloat(ts.getAttribute('y')) + dy);
            });
        }
    } else if (el.classList.contains('balloon-shape')) {
        // フキダシ: d属性はdataset.cx/cyから都度再構築されるため、
        // transformではなくdataset.cx/cyそのものを移動してパスを再生成する
        // （transformで見た目だけ動かすと、後続の_updateH2ShapePath呼び出しで
        //   古いcx/cyから再構築され位置が戻ってしまう）
        el.dataset.cx = parseFloat(el.dataset.cx || '0') + dx;
        el.dataset.cy = parseFloat(el.dataset.cy || '0') + dy;
        _updateH2ShapePath(el);
    } else {
        // その他（未分類の図形）: 既存transformの前にtranslateを追加
        const existing = el.getAttribute('transform') || '';
        if (existing) {
            el.setAttribute('transform', `translate(${dx},${dy}) ${existing}`);
        } else {
            el.setAttribute('transform', `translate(${dx},${dy})`);
        }
    }
}

// 複製ID用カウンター（同ミリ秒衝突防止）
let _dupCounter = 0;

// IDを新しいサフィックスで付け替えたクローンを返す
function _cloneWithNewIds(srcEl) {
    const clone = srcEl.cloneNode(true);
    const suffix = `-dup-${Date.now()}-${++_dupCounter}`;
    // 変更前後のIDマッピングを作成（url(#id)参照を更新するため）
    const idMap = {};
    if (clone.id) {
        idMap[clone.id] = clone.id + suffix;
        clone.id = clone.id + suffix;
    }
    clone.querySelectorAll('[id]').forEach(el => {
        idMap[el.id] = el.id + suffix;
        el.id = el.id + suffix;
    });
    if (clone.hasAttribute('data-group-id')) {
        clone.setAttribute('data-group-id', clone.id);
    }
    // url(#oldId) 参照を url(#newId) に更新
    if (Object.keys(idMap).length > 0) {
        clone.querySelectorAll('[clip-path],[fill],[stroke],[filter],[mask]').forEach(el => {
            ['clip-path', 'fill', 'stroke', 'filter', 'mask'].forEach(attr => {
                const val = el.getAttribute(attr);
                if (val && val.startsWith('url(#')) {
                    const oldId = val.slice(5, -1);
                    if (idMap[oldId]) el.setAttribute(attr, `url(#${idMap[oldId]})`);
                }
            });
        });
    }
    return clone;
}

// 同コマ複製時のオフセット適用
function _applyOffset(clone, OFFSET) {
    if (clone.hasAttribute('transform')) {
        const existing = clone.getAttribute('transform');
        clone.setAttribute('transform', `translate(${OFFSET},${OFFSET}) ${existing}`);
    } else {
        const tag = clone.tagName.toLowerCase();
        if (tag === 'image' || tag === 'text' || tag === 'rect') {
            clone.setAttribute('x', parseFloat(clone.getAttribute('x') || 0) + OFFSET);
            clone.setAttribute('y', parseFloat(clone.getAttribute('y') || 0) + OFFSET);
        } else {
            clone.setAttribute('transform', `translate(${OFFSET},${OFFSET})`);
        }
    }
}

// 複製後の選択状態を設定してハンドルを表示
function _selectClone(clone, panelSvg) {
    state.selectedGroupId = null;
    state.selectedShapeId = null;
    state.selectedImageEl = null;
    state.selectedImageId = null;
    state.selectedTextEl  = null;
    state.selectedDrawId  = null;
    state.selectedDrawEl  = null;
    clearHandles();
    clearImageHandles();
    if (panelSvg) clearDrawShapeHandles(panelSvg);
    clearGroupHandles();

    if (clone.hasAttribute('data-group-id')) {
        state.selectedGroupId = clone.id;
        renderGroupHandles(clone, panelSvg);
    } else if (clone.classList.contains('balloon-shape')) {
        state.selectedShapeId = clone.id;
        renderHandles(clone);
    } else if (clone.classList.contains('inserted-image')) {
        state.selectedImageEl = clone;
        state.selectedImageId = clone.id;
        renderImageHandles(clone, panelSvg);
    } else if (clone.tagName.toLowerCase() === 'text') {
        state.selectedTextEl = clone;
        if (panelSvg) renderTextHandles(clone, panelSvg);
    } else if (clone.classList.contains('draw-shape')) {
        state.selectedDrawId = clone.id;
        state.selectedDrawEl = clone;
        if (panelSvg) renderDrawShapeHandles(clone, panelSvg);
    }
}

// ── グループハンドル ──

function clearGroupHandles() {
    document.querySelectorAll('.group-handle, .group-bbox, .group-rotate-line').forEach(h => h.remove());
}

function calcGroupHandleR(svgEl) {
    const vb = svgEl.viewBox?.baseVal;
    if (!vb || vb.width === 0) return 8;
    const rect = svgEl.getBoundingClientRect();
    const scale = rect.width / vb.width;
    return Math.max(4, 8 / scale);
}

function renderGroupHandles(groupEl, svgEl) {
    clearGroupHandles();
    clearHandles();
    clearImageHandles();
    clearTextHandles(svgEl);

    const angle = parseFloat(groupEl.getAttribute('data-angle') || '0');
    const tx    = parseFloat(groupEl.getAttribute('data-tx')    || '0');
    const ty    = parseFloat(groupEl.getAttribute('data-ty')    || '0');
    const sx    = parseFloat(groupEl.getAttribute('data-sx')    || '1');
    const sy    = parseFloat(groupEl.getAttribute('data-sy')    || '1');

    // getBBox() はChrome/SVG仕様でグループ自身のtransformを無視したローカル座標を返す
    let rawBbox;
    try { rawBbox = groupEl.getBBox(); } catch(e) { return; }
    if (!rawBbox || (rawBbox.width === 0 && rawBbox.height === 0)) return;

    // BBox中心（transform除去後のローカル座標）
    const rawCx = rawBbox.x + rawBbox.width  / 2;
    const rawCy = rawBbox.y + rawBbox.height / 2;

    // グループのtransformを確定（translate(tx,ty) scale(sx,sy) rotate(angle,rawCx,rawCy) の順）
    groupEl.setAttribute('transform', `translate(${tx},${ty}) scale(${sx},${sy}) rotate(${angle},${rawCx},${rawCy})`);

    // ハンドル座標計算：ローカル座標 → rotate → scale → translate の順でSVGルート座標へ
    const rad  = angle * Math.PI / 180;
    const cosA = Math.cos(rad), sinA = Math.sin(rad);
    const toSvg = (lx, ly) => {
        // rotate(angle, rawCx, rawCy) を適用
        const dx = lx - rawCx, dy = ly - rawCy;
        const rx = rawCx + dx * cosA - dy * sinA;
        const ry = rawCy + dx * sinA + dy * cosA;
        // scale(sx, sy) → translate(tx, ty) を適用
        return { x: rx * sx + tx, y: ry * sy + ty };
    };

    const { x: bx, y: by, width: bw, height: bh } = rawBbox;
    const corners = {
        nw: toSvg(bx,      by),
        n:  toSvg(bx+bw/2, by),
        ne: toSvg(bx+bw,   by),
        e:  toSvg(bx+bw,   by+bh/2),
        se: toSvg(bx+bw,   by+bh),
        s:  toSvg(bx+bw/2, by+bh),
        sw: toSvg(bx,      by+bh),
        w:  toSvg(bx,      by+bh/2),
        c:  toSvg(rawCx,   rawCy),
    };
    const topMid    = corners.n;
    const r         = calcGroupHandleR(svgEl);
    // 回転ハンドルは上辺中点からさらに上
    const dx = topMid.x - corners.c.x;
    const dy = topMid.y - corners.c.y;
    const len = Math.sqrt(dx*dx + dy*dy) || 1;
    const rotLineTip = { x: topMid.x + dx/len*r*3, y: topMid.y + dy/len*r*3 };

    // 点線枠（SVGルート座標に transform 適用済みのポリゴンとして描画）
    const pts = [corners.nw, corners.ne, corners.se, corners.sw];
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', pts.map(p => `${p.x},${p.y}`).join(' '));
    poly.setAttribute('fill', 'transparent');
    poly.setAttribute('stroke', '#ff9900');
    poly.setAttribute('stroke-width', r * 0.3);
    poly.setAttribute('stroke-dasharray', `${r * 1.5},${r}`);
    poly.setAttribute('pointer-events', 'all');
    poly.setAttribute('class', 'group-bbox');
    poly.style.cursor = 'move';
    svgEl.appendChild(poly);

    // 回転ライン
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', topMid.x);    line.setAttribute('y1', topMid.y);
    line.setAttribute('x2', rotLineTip.x); line.setAttribute('y2', rotLineTip.y);
    line.setAttribute('stroke', '#ffdd00');
    line.setAttribute('stroke-width', r * 0.3);
    line.setAttribute('pointer-events', 'none');
    line.setAttribute('class', 'group-rotate-line');
    svgEl.appendChild(line);

    // 8点リサイズ + 回転ハンドル
    const handleDefs = [
        { type: 'nw', pt: corners.nw },
        { type: 'n',  pt: corners.n  },
        { type: 'ne', pt: corners.ne },
        { type: 'e',  pt: corners.e  },
        { type: 'se', pt: corners.se },
        { type: 's',  pt: corners.s  },
        { type: 'sw', pt: corners.sw },
        { type: 'w',  pt: corners.w  },
        { type: 'rotate', pt: rotLineTip }
    ];
    const groupId = groupEl.getAttribute('data-group-id') || groupEl.id;
    const cursorMap = {
        nw: 'nw-resize', n: 'n-resize', ne: 'ne-resize',
        e: 'e-resize', se: 'se-resize', s: 's-resize',
        sw: 'sw-resize', w: 'w-resize', rotate: 'grab'
    };
    handleDefs.forEach(({ type, pt }) => {
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('cx', pt.x);
        c.setAttribute('cy', pt.y);
        c.setAttribute('r', r);
        c.setAttribute('stroke', '#333');
        c.setAttribute('stroke-width', r * 0.25);
        c.setAttribute('class', `group-handle group-handle-${type}`);
        c.dataset.handleType = type;
        c.dataset.groupId = groupId;
        c.setAttribute('fill', type === 'rotate' ? '#ffdd00' : '#ff9900');
        c.style.cursor = cursorMap[type] || 'pointer';
        svgEl.appendChild(c);
    });
    poly.dataset.groupId = groupId;

    // 操作で必要な値をdatasetに保存（生BBox・現在transform）
    groupEl.dataset.rawBboxX  = rawBbox.x;
    groupEl.dataset.rawBboxY  = rawBbox.y;
    groupEl.dataset.rawBboxW  = rawBbox.width;
    groupEl.dataset.rawBboxH  = rawBbox.height;
    groupEl.dataset.rawCx     = rawCx;
    groupEl.dataset.rawCy     = rawCy;

    // SVG全体がpointer-events:noneでもハンドルを操作可能にする
    svgEl.querySelectorAll('.group-handle').forEach(h => h.style.pointerEvents = 'auto');
    svgEl.querySelectorAll('.group-bbox').forEach(b => b.style.pointerEvents = 'all');
}

function updateGroupHandlePositions(groupEl, svgEl) {
    // ハンドルはrenderGroupHandlesで再描画（CTMベースなので常に正確）
    renderGroupHandles(groupEl, svgEl);
}

// ── グループ操作（移動・回転・リサイズ） ──

// window登録のmouseupリスナー参照（renderLayoutTab()経由の再初期化で積み上がらないよう保持）
let _groupManipWinMouseUp = null;

function initGroupManipulation(svgEl) {
    if (_groupManipWinMouseUp) { window.removeEventListener('mouseup', _groupManipWinMouseUp); _groupManipWinMouseUp = null; }

    let groupDragging = false;
    let groupRotating = false;
    let groupResizing = false;
    let groupResizeDir = null;
    let targetGroup = null;

    let startX = 0, startY = 0;
    let initTx = 0, initTy = 0;
    let initSx = 1, initSy = 1;
    let initAngle = 0, startAngleRad = 0;
    let initBx = 0, initBy = 0, initBw = 0, initBh = 0;
    let initCx = 0, initCy = 0;
    let fixedSvgPt = { x: 0, y: 0 }; // 固定点のSVGルート座標

    const getSvgPt = (clientX, clientY) => {
        const pt = svgEl.createSVGPoint();
        pt.x = clientX; pt.y = clientY;
        return pt.matrixTransform(svgEl.getScreenCTM().inverse());
    };

    // ハンドル/bboxからグループgを逆引きするヘルパー
    const resolveGroupEl = (el) => {
        const gid = el.dataset.groupId || state.selectedGroupId;
        if (!gid) return null;
        return svgEl.querySelector(`g[data-group-id="${gid}"]`);
    };

    // グループを選択状態にするヘルパー（他の選択をクリアして選択）
    const selectGroup = (groupEl) => {
        const groupId = groupEl.getAttribute('data-group-id') || groupEl.id;
        state.selectedImageEl  = null; state.selectedImageId  = null;
        state.selectedShapeId  = null; state.selectedTextEl   = null;
        state.selectedDrawId   = null; state.selectedDrawEl   = null;
        clearHandles(); clearImageHandles(); clearTextHandles(svgEl); clearDrawShapeHandles(svgEl);
        state.selectedGroupId = groupId;
        renderGroupHandles(groupEl, svgEl);
        syncPanelSelectionToObject(groupEl);
        renderLayerPanel();
    };

    // キャプチャフェーズで登録：他のハンドラより先にグループ判定を行う
    svgEl.addEventListener('mousedown', (e) => {
        // ── ハンドルクリック（回転・リサイズ） ──
        const handle = e.target.closest('.group-handle');
        if (handle) {
            e.stopPropagation();
            e.preventDefault();
            targetGroup = resolveGroupEl(handle);
            if (!targetGroup) return;
            // 未選択の場合は選択
            if (state.selectedGroupId !== (targetGroup.getAttribute('data-group-id') || targetGroup.id)) {
                selectGroup(targetGroup);
            }

            const pt = getSvgPt(e.clientX, e.clientY);
            initTx    = parseFloat(targetGroup.getAttribute('data-tx')    || '0');
            initTy    = parseFloat(targetGroup.getAttribute('data-ty')    || '0');
            initSx    = parseFloat(targetGroup.getAttribute('data-sx')    || '1');
            initSy    = parseFloat(targetGroup.getAttribute('data-sy')    || '1');
            initAngle = parseFloat(targetGroup.getAttribute('data-angle') || '0');
            initBx = parseFloat(targetGroup.dataset.rawBboxX || '0');
            initBy = parseFloat(targetGroup.dataset.rawBboxY || '0');
            initBw = parseFloat(targetGroup.dataset.rawBboxW || '0');
            initBh = parseFloat(targetGroup.dataset.rawBboxH || '0');
            // 回転中心（SVGルート座標）
            const rawCx0 = parseFloat(targetGroup.dataset.rawCx || '0');
            const rawCy0 = parseFloat(targetGroup.dataset.rawCy || '0');
            initCx = rawCx0 * initSx + initTx;
            initCy = rawCy0 * initSy + initTy;

            const hType = handle.dataset.handleType;
            if (hType === 'rotate') {
                groupRotating = true;
                startAngleRad = Math.atan2(pt.y - initCy, pt.x - initCx);
            } else {
                groupResizing = true;
                groupResizeDir = hType;
                // 固定点（ドラッグ方向の反対側コーナー）をローカル座標で取得し SVGルート座標に変換
                const localFixMap = {
                    nw: { x: initBx + initBw, y: initBy + initBh },
                    ne: { x: initBx,          y: initBy + initBh },
                    sw: { x: initBx + initBw, y: initBy           },
                    se: { x: initBx,          y: initBy           },
                    n:  { x: initBx + initBw/2, y: initBy + initBh },
                    s:  { x: initBx + initBw/2, y: initBy           },
                    e:  { x: initBx,          y: initBy + initBh/2 },
                    w:  { x: initBx + initBw, y: initBy + initBh/2 }
                };
                const lp = localFixMap[hType] || { x: initBx + initBw/2, y: initBy + initBh/2 };
                // translate(tx,ty) scale(sx,sy) rotate(angle,rawCx,rawCy) での SVGルート座標変換
                // ローカル点 → rotate → scale → translate
                const rad0  = initAngle * Math.PI / 180;
                const cos0  = Math.cos(rad0), sin0 = Math.sin(rad0);
                const dx0   = lp.x - rawCx0, dy0 = lp.y - rawCy0;
                const rx0   = rawCx0 + dx0 * cos0 - dy0 * sin0;
                const ry0   = rawCy0 + dx0 * sin0 + dy0 * cos0;
                fixedSvgPt  = { x: rx0 * initSx + initTx, y: ry0 * initSy + initTy };
            }
            startX = pt.x; startY = pt.y;
            return;
        }

        // ── group-bbox（枠線ヒット領域）クリック → グループ選択+移動 ──
        const bboxEl = e.target.closest('.group-bbox');
        if (bboxEl) {
            e.stopPropagation();
            e.preventDefault();
            targetGroup = resolveGroupEl(bboxEl);
            if (!targetGroup) return;
            if (state.selectedGroupId !== (targetGroup.getAttribute('data-group-id') || targetGroup.id)) {
                selectGroup(targetGroup);
            }
            groupDragging = true;
            const pt = getSvgPt(e.clientX, e.clientY);
            startX = pt.x; startY = pt.y;
            initTx = parseFloat(targetGroup.getAttribute('data-tx') || '0');
            initTy = parseFloat(targetGroup.getAttribute('data-ty') || '0');
            return;
        }

        // ── グループ内オブジェクトクリック → グループ選択または移動 ──
        // ── グループ内オブジェクトクリック → グループ選択+ドラッグ ──
        // g[data-group-id] 自体 または その子孫へのクリックを検出
        // ただし .group-handle/.group-bbox は上で処理済みなのでここには来ない
        const hitGroupEl = e.target.closest('g[data-group-id]');
        if (hitGroupEl) {
            e.stopPropagation();
            e.preventDefault();
            selectGroup(hitGroupEl);
            // そのままドラッグ開始
            targetGroup = hitGroupEl;
            groupDragging = true;
            const pt = getSvgPt(e.clientX, e.clientY);
            startX = pt.x; startY = pt.y;
            initTx = parseFloat(hitGroupEl.getAttribute('data-tx') || '0');
            initTy = parseFloat(hitGroupEl.getAttribute('data-ty') || '0');
            return;
        }

        // ── グループ外クリックで選択解除 ──
        if (state.selectedGroupId && !e.target.closest('.group-handle, .group-bbox, .group-rotate-line')) {
            state.selectedGroupId = null;
            clearGroupHandles();
            renderLayerPanel();
        }
    }, true); // キャプチャフェーズ

    svgEl.addEventListener('mousemove', (e) => {
        if (!targetGroup) return;
        const pt = getSvgPt(e.clientX, e.clientY);

        if (groupDragging) {
            const dx = pt.x - startX;
            const dy = pt.y - startY;
            const newTx = initTx + dx;
            const newTy = initTy + dy;
            targetGroup.setAttribute('data-tx', newTx);
            targetGroup.setAttribute('data-ty', newTy);
            const angle  = parseFloat(targetGroup.getAttribute('data-angle') || '0');
            const rawCx  = parseFloat(targetGroup.dataset.rawCx || '0');
            const rawCy  = parseFloat(targetGroup.dataset.rawCy || '0');
            targetGroup.setAttribute('transform', `translate(${newTx},${newTy}) rotate(${angle},${rawCx},${rawCy})`);
            updateGroupHandlePositions(targetGroup, svgEl);
        } else if (groupRotating) {
            const currentRad = Math.atan2(pt.y - initCy, pt.x - initCx);
            const deltaDeg   = (currentRad - startAngleRad) * 180 / Math.PI;
            const newAngle   = initAngle + deltaDeg;
            targetGroup.setAttribute('data-angle', newAngle);
            const rawCx = parseFloat(targetGroup.dataset.rawCx || '0');
            const rawCy = parseFloat(targetGroup.dataset.rawCy || '0');
            const tx    = parseFloat(targetGroup.getAttribute('data-tx') || '0');
            const ty    = parseFloat(targetGroup.getAttribute('data-ty') || '0');
            targetGroup.setAttribute('transform', `translate(${tx},${ty}) rotate(${newAngle},${rawCx},${rawCy})`);
            updateGroupHandlePositions(targetGroup, svgEl);
        } else if (groupResizing) {
            // ドラッグ差分でスケール倍率を計算（初期サイズ基準）
            const dx  = pt.x - startX;
            const dy  = pt.y - startY;
            const dir = groupResizeDir;
            // initBw/initBh はローカルBBoxサイズ（スケール前）
            // initSx/initSy を掛けたSVGサイズを基準にドラッグ量を比率化
            const svgW = initBw * initSx;
            const svgH = initBh * initSy;
            let sx = initSx, sy = initSy;
            if (dir === 'e' || dir === 'ne' || dir === 'se') sx = initBw > 0 ? Math.max(0.05, (svgW + dx) / initBw) : initSx;
            if (dir === 'w' || dir === 'nw' || dir === 'sw') sx = initBw > 0 ? Math.max(0.05, (svgW - dx) / initBw) : initSx;
            if (dir === 's' || dir === 'se' || dir === 'sw') sy = initBh > 0 ? Math.max(0.05, (svgH + dy) / initBh) : initSy;
            if (dir === 'n' || dir === 'ne' || dir === 'nw') sy = initBh > 0 ? Math.max(0.05, (svgH - dy) / initBh) : initSy;
            // Shiftキー押下時は縦横比維持（ドラッグ方向に応じて基準軸を決定）
            if (e.shiftKey) {
                // 現在のSVGサイズ（scale後）の縦横比を維持
                const aspectRatio = (initBw * initSx) / (initBh * initSy); // SVGサイズ比率
                if (dir === 'n' || dir === 's') {
                    // 縦方向ドラッグ → syを基準にsxを合わせる
                    sx = sy * aspectRatio;
                } else if (dir === 'e' || dir === 'w') {
                    // 横方向ドラッグ → sxを基準にsyを合わせる
                    sy = sx / aspectRatio;
                } else {
                    // 斜めドラッグ → 対角線方向の移動量を使って均一スケール（基準切替なし）
                    const diagDist = Math.sqrt(dx * dx + dy * dy);
                    const baseDiag = Math.sqrt(svgW * svgW + svgH * svgH);
                    // ハンドル方向ベクトルへのドラッグ射影で拡大/縮小の符号を決定
                    // se:(+x,+y)方向が拡大, nw:(-x,-y)方向が拡大, ne:(+x,-y)方向が拡大, sw:(-x,+y)方向が拡大
                    const dirX = (dir === 'se' || dir === 'ne') ?  1 : -1;
                    const dirY = (dir === 'se' || dir === 'sw') ?  1 : -1;
                    const sign = (dx * dirX + dy * dirY) >= 0 ? 1 : -1;
                    const newScale = Math.max(0.05, (baseDiag + sign * diagDist) / baseDiag);
                    sx = initSx * newScale;
                    sy = initSy * newScale;
                }
                sx = Math.max(0.05, sx);
                sy = Math.max(0.05, sy);
            }
            // 固定点のSVGルート座標を維持するようにtx/tyを計算
            // SVGルート座標 = localPt * scale + translate（rotate込みの変換後）
            // 簡略化：固定点のローカル→SVGルート変換を再計算して txを補正
            const rawCx = parseFloat(targetGroup.dataset.rawCx || '0');
            const rawCy = parseFloat(targetGroup.dataset.rawCy || '0');
            const angle = parseFloat(targetGroup.getAttribute('data-angle') || '0');
            const rad   = angle * Math.PI / 180;
            const cosA  = Math.cos(rad), sinA = Math.sin(rad);
            const lp    = dir === 'nw' ? { x: initBx + initBw, y: initBy + initBh }
                        : dir === 'ne' ? { x: initBx,          y: initBy + initBh }
                        : dir === 'sw' ? { x: initBx + initBw, y: initBy           }
                        : dir === 'se' ? { x: initBx,          y: initBy           }
                        : dir === 'n'  ? { x: initBx + initBw/2, y: initBy + initBh }
                        : dir === 's'  ? { x: initBx + initBw/2, y: initBy           }
                        : dir === 'e'  ? { x: initBx,          y: initBy + initBh/2 }
                        :                { x: initBx + initBw, y: initBy + initBh/2 };
            // ローカル点 → rotate → scale(sx,sy) → translate(tx,ty) でSVGルート座標を求める
            const dxL = lp.x - rawCx, dyL = lp.y - rawCy;
            const rxL = rawCx + dxL * cosA - dyL * sinA;
            const ryL = rawCy + dxL * sinA + dyL * cosA;
            // fixedSvgPt = { rxL*sx + newTx, ryL*sy + newTy } が一定
            const newTx = fixedSvgPt.x - rxL * sx;
            const newTy = fixedSvgPt.y - ryL * sy;
            targetGroup.setAttribute('data-sx', sx);
            targetGroup.setAttribute('data-sy', sy);
            targetGroup.setAttribute('data-tx', newTx);
            targetGroup.setAttribute('data-ty', newTy);
            targetGroup.setAttribute('transform',
                `translate(${newTx},${newTy}) scale(${sx},${sy}) rotate(${angle},${rawCx},${rawCy})`
            );
            updateGroupHandlePositions(targetGroup, svgEl);
        }
    });

    const onMouseUp = async () => {
        if (!targetGroup) { groupDragging = groupRotating = groupResizing = false; return; }
        const wasActive = groupDragging || groupRotating || groupResizing;
        const savedGroup = targetGroup;
        groupDragging = false; groupRotating = false; groupResizing = false;
        groupResizeDir = null; targetGroup = null;
        if (wasActive) {
            const panelId = savedGroup.closest('g[data-clip-panel]')?.getAttribute('data-clip-panel') ||
                            (savedGroup.closest('g[data-overlay-layer]') ? '__overlay__' : state.selectedPanelId || 'panel-0');
            await savePanelSvg(panelId, svgEl);
            if (state.selectedGroupId && savedGroup) {
                renderGroupHandles(savedGroup, svgEl);
            }
        }
    };

    svgEl.addEventListener('mouseup', onMouseUp);
    _groupManipWinMouseUp = onMouseUp;
    window.addEventListener('mouseup', _groupManipWinMouseUp);
}

async function layerMove(direction) {
    const container = getActiveContainer();
    if (!container) return;

    // 同じ親の中で matcher に合う兄弟間だけを移動するヘルパー
    const swapInSiblings = (el, dir, matcher) => {
        const parent = el.parentNode;
        const siblings = Array.from(parent.children).filter(matcher);
        const idx = siblings.indexOf(el);
        if (dir === 'up') {
            const target = siblings[idx + 1];
            if (target) parent.insertBefore(target, el);
        } else {
            const target = siblings[idx - 1];
            if (target) parent.insertBefore(el, target);
        }
    };

    const panelSvg = getPanelLayerSvg(container);

    // 全オブジェクト（balloon-shape / inserted-image / text / draw-shape / group）を対象にするmatcher
    const allObjMatcher = el =>
        el.classList.contains('balloon-shape') ||
        el.classList.contains('inserted-image') ||
        el.classList.contains('draw-shape') ||
        el.tagName.toLowerCase() === 'text' ||
        el.hasAttribute('data-group-id');

    // ── グループのレイヤー移動 ──
    if (state.selectedGroupId) {
        if (!panelSvg) return;
        const groupEl = panelSvg.querySelector(`#${CSS.escape(state.selectedGroupId)}`);
        if (!groupEl) return;

        pushHistory();
        swapInSiblings(groupEl, direction, allObjMatcher);
        const panelId = groupEl.closest('g[data-clip-panel]')?.getAttribute('data-clip-panel') ||
                        (groupEl.closest('g[data-overlay-layer]') ? '__overlay__' : state.selectedPanelId || 'panel-0');
        await savePanelSvg(panelId, panelSvg);
        renderLayerPanel();
        return;
    }

    // ── フキダシのレイヤー移動 ──
    if (state.selectedShapeId) {
        if (!panelSvg) return;
        const shape = panelSvg.querySelector(`#${CSS.escape(state.selectedShapeId)}`);
        if (!shape) return;

        pushHistory();
        swapInSiblings(shape, direction, allObjMatcher);
        const panelId = shape.closest('g[data-clip-panel]')?.getAttribute('data-clip-panel') ||
                        (shape.closest('g[data-overlay-layer]') ? '__overlay__' : state.selectedPanelId || 'panel-0');
        await savePanelSvg(panelId, panelSvg);
        renderLayerPanel();
        return;
    }

    // ── 画像のレイヤー移動 ──
    if (state.selectedImageEl) {
        if (!panelSvg) return;
        const img = state.selectedImageEl;
        if (!img.parentNode) return;

        pushHistory();
        swapInSiblings(img, direction, allObjMatcher);
        const panelId = img.closest('g[data-clip-panel]')?.getAttribute('data-clip-panel') ||
                        (img.closest('g[data-overlay-layer]') ? '__overlay__' : state.selectedPanelId || 'panel-0');
        await savePanelSvg(panelId, panelSvg);
        renderLayerPanel();
        return;
    }

    // ── テキストのレイヤー移動 ──
    if (state.selectedTextEl) {
        if (!panelSvg) return;
        const textEl = state.selectedTextEl;
        if (!textEl.parentNode) return;

        pushHistory();
        swapInSiblings(textEl, direction, allObjMatcher);
        const panelId = textEl.closest('g[data-clip-panel]')?.getAttribute('data-clip-panel') ||
                        (textEl.closest('g[data-overlay-layer]') ? '__overlay__' : state.selectedPanelId || 'panel-0');
        await savePanelSvg(panelId, panelSvg);
        renderLayerPanel();
        return;
    }

    // ── 描画図形のレイヤー移動 ──
    if (state.selectedDrawId) {
        if (!panelSvg) return;
        const drawEl = panelSvg.querySelector(`#${CSS.escape(state.selectedDrawId)}`);
        if (!drawEl || !drawEl.parentNode) return;

        pushHistory();
        swapInSiblings(drawEl, direction, allObjMatcher);
        const panelId = drawEl.closest('g[data-clip-panel]')?.getAttribute('data-clip-panel') ||
                        (drawEl.closest('g[data-overlay-layer]') ? '__overlay__' : state.selectedPanelId || 'panel-0');
        await savePanelSvg(panelId, panelSvg);
        state.selectedDrawEl = panelSvg.querySelector(`#${CSS.escape(state.selectedDrawId)}`);
        renderLayerPanel();
        return;
    }
}

