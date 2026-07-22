// ============================================================
// フキダシ管理 分割ファイル (2/5): フキダシ図形・パス生成(H2タイプ/爆発/思考雲/変形/PNG変換)
// 元 09-balloons.js（分割前）の行 600-1294 に相当
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: _h2_getBoundaryPoint,_h2_mulberry32,_showH2TypeParams,_updateH2ShapePath,circleToPath,generateBombPath,generateThoughtPath,getOrCreateClipGroup,getOrCreateOverlayGroup,renderPanelOverlays,saveOverlaySvg,selectOverlay,updateBalloonUI,updateShapePath
// ============================================================

function _showH2TypeParams(type) {
    const panel = document.getElementById('h2-params-panel');
    const bombP    = document.getElementById('h2-bomb-params');
    const thoughtP = document.getElementById('h2-thought-params');
    const rectP    = document.getElementById('h2-rect-params');
    const cloudP   = document.getElementById('h2-cloud-params');
    const widthG   = document.getElementById('h2-tail-width-group');
    if (!panel) return;
    const isCloud = (type === 'cloudpuffy' || type === 'cloudwavy');
    const isH2 = (type === 'bomb' || type === 'thought' || type === 'normal' || type === 'rect' || isCloud);
    panel.style.display = isH2 ? 'flex' : 'none';
    if (bombP)   bombP.style.display   = (type === 'bomb')    ? 'flex' : 'none';
    if (thoughtP) thoughtP.style.display = (type === 'thought') ? 'flex' : 'none';
    if (rectP)   rectP.style.display   = (type === 'rect')    ? 'flex' : 'none';
    if (cloudP)  cloudP.style.display  = isCloud ? 'flex' : 'none';
    // thought タイプは幅スライダーが無意味なので非表示
    if (widthG) widthG.style.display = (type === 'thought') ? 'none' : 'contents';
}

function updateBalloonUI() {
    const textBtn = document.getElementById('toggle-text-btn');
    const editBtn = document.getElementById('toggle-edit-btn');
    const editText = document.getElementById('edit-mode-text');

    if (state.balloon.isTextMode) {
        if (textBtn) textBtn.classList.add('active');
    } else {
        if (textBtn) textBtn.classList.remove('active');
    }

    if (state.balloon.isEditMode) {
        if (editBtn) editBtn.classList.add('active');
        if (editText) editText.textContent = t('layout.editModeOn');
    } else {
        if (editBtn) editBtn.classList.remove('active');
        if (editText) editText.textContent = t('layout.editModeOff');
        // 編集モードOFF時はハンドルを消去し、選択を解除
        clearHandles();
        state.selectedShapeId = null;
    }

    // hitPolyのインタラクション設定
    const previewContainer = document.getElementById('layout-preview');
    if (!previewContainer) return;

    const hitPolys = previewContainer.querySelectorAll('.panel-hit-area');
    hitPolys.forEach(hp => {
        if (state.balloon.isTextMode) {
            hp.style.pointerEvents = 'all';
        } else {
            hp.style.pointerEvents = 'none';
        }
    });
    // テキストモード時はコマ選択polygonのクリックを無効化
    const panelOverlays = previewContainer.querySelectorAll('.panel-overlay');
    panelOverlays.forEach(po => {
        po.style.pointerEvents = state.balloon.isTextMode ? 'none' : 'auto';
    });

    // 統合SVG（#image-layer svg）の pointer-events / cursor をモードに応じて変更
    const panelSvg = previewContainer.querySelector('#image-layer svg');

    if (panelSvg) {
        if (state.balloon.isEditMode) {
            panelSvg.style.cursor = 'default';
            panelSvg.style.pointerEvents = 'none';
            panelSvg.querySelectorAll('.balloon-shape').forEach(s => s.style.pointerEvents = 'auto');
            panelSvg.querySelectorAll('.balloon-handle').forEach(h => h.style.pointerEvents = 'auto');
            panelSvg.querySelectorAll('.draw-shape').forEach(s => s.style.pointerEvents = 'auto');
            panelSvg.querySelectorAll('.draw-handle').forEach(h => h.style.pointerEvents = 'auto');
            panelSvg.querySelectorAll('.group-handle').forEach(h => h.style.pointerEvents = 'auto');
            panelSvg.querySelectorAll('.group-bbox').forEach(b => b.style.pointerEvents = 'all');
        } else if (state.balloon.isTextMode) {
            panelSvg.style.cursor = 'text';
            panelSvg.style.pointerEvents = 'all';
            panelSvg.querySelectorAll('text').forEach(t => t.style.pointerEvents = 'auto');
        } else {
            panelSvg.style.cursor = 'default';
            panelSvg.style.pointerEvents = 'none';
            panelSvg.querySelectorAll('.draw-shape').forEach(s => s.style.pointerEvents = 'auto');
            panelSvg.querySelectorAll('.draw-handle').forEach(h => h.style.pointerEvents = 'auto');
            panelSvg.querySelectorAll('.group-handle').forEach(h => h.style.pointerEvents = 'auto');
            panelSvg.querySelectorAll('.group-bbox').forEach(b => b.style.pointerEvents = 'all');
        }
    }
}

function renderPanelOverlays(panelSvgEl, overlaySvgEl) {
    if (!state.activePage || !state.activePage.panels) return;

    // panelSvgEl は視覚的な選択ハイライト表示のみ（pointer-events:none）
    panelSvgEl.querySelectorAll('.panel-indication').forEach(el => el.remove());

    // overlaySvgEl のクリックヒット領域（透明polygon）を再構築
    if (overlaySvgEl) {
        overlaySvgEl.querySelectorAll('.panel-hit-area').forEach(el => el.remove());
    }

    state.activePage.panels.forEach(panel => {
        // 視覚的ハイライト（panelSvgElに配置）
        const highlightPoly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        highlightPoly.setAttribute('points', panel.points);
        highlightPoly.setAttribute('class', 'panel-indication');
        highlightPoly.style.pointerEvents = 'none';

        if (state.selectedPanelId === panel.id) {
            highlightPoly.setAttribute('fill', 'rgba(0, 123, 255, 0.1)');
            highlightPoly.setAttribute('stroke', 'rgba(0, 123, 255, 0.8)');
            highlightPoly.setAttribute('stroke-width', '3');
            highlightPoly.setAttribute('stroke-dasharray', '5,5');
        } else {
            highlightPoly.setAttribute('fill', 'transparent');
            highlightPoly.setAttribute('stroke', 'none');
        }

        panelSvgEl.appendChild(highlightPoly);

        // クリックヒット領域（overlaySvgElに透明polygonを配置）
        // 描画モード: pointerEventsなし（overlaySvgElのmousedownが通る）
        // テキストモード: clickで座標を取得してダイアログを開く
        if (overlaySvgEl) {
            const hitPoly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            hitPoly.setAttribute('points', panel.points);
            hitPoly.setAttribute('class', 'panel-hit-area');
            hitPoly.setAttribute('fill', 'transparent');
            hitPoly.setAttribute('stroke', 'none');
            // 描画モードON: pointerEvents=noneでmousedownをoverlaySvgElが受け取れるようにする
            // テキストモードON: pointerEvents=allでクリックを受け取る
            // それ以外: none
            hitPoly.style.pointerEvents = state.balloon.isTextMode ? 'all' : 'none';
            hitPoly.style.cursor = 'crosshair';
            hitPoly.dataset.panelId = panel.id;

            overlaySvgEl.appendChild(hitPoly);
        }
    });
}

// オーバーレイg要素を取得または作成（最前面に配置）
// basePanelPoints があればclipPathを付与してページからはみ出さないようにする
function getOrCreateOverlayGroup(svgEl) {
    const overlayClipId = 'overlay-page-clip';
    const basePts = state.activePage && state.activePage.basePanelPoints;

    // defsにclipPathを追加（basePanelPointsがある場合のみ）
    if (basePts) {
        let defs = svgEl.querySelector('defs');
        if (!defs) {
            defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            svgEl.insertBefore(defs, svgEl.firstChild);
        }
        if (!defs.querySelector(`[id="${overlayClipId}"]`)) {
            const clipPath = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
            clipPath.setAttribute('id', overlayClipId);
            clipPath.setAttribute('clipPathUnits', 'userSpaceOnUse');
            const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            poly.setAttribute('points', basePts);
            clipPath.appendChild(poly);
            defs.appendChild(clipPath);
        }
    }

    let g = svgEl.querySelector('g[data-overlay-layer]');
    if (!g) {
        g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('data-overlay-layer', 'true');
        if (basePts) g.setAttribute('clip-path', `url(#${overlayClipId})`);
        svgEl.appendChild(g);
    }
    return g;
}

// オーバーレイSVGを保存
async function saveOverlaySvg(panelLayerSvgEl) {
    if (!state.activePage || !panelLayerSvgEl) return;

    // UIハンドル等を除去したクローンを作成
    const clone = panelLayerSvgEl.cloneNode(true);
    clone.querySelectorAll(
        '.panel-overlay, .panel-border, .panel-indication, .panel-hit-area, ' +
        '#balloon-hit-bg, .balloon-handle, .balloon-bbox, .balloon-rotate-line, ' +
        '.text-handle, .text-bbox, .text-rotate-line, ' +
        '.image-handle, .image-bbox, .image-rotate-line, ' +
        '.group-handle, .group-bbox, .group-rotate-line, ' +
        '.draw-handle, .draw-bbox, .draw-rotate-line'
    ).forEach(el => el.remove());
    clone.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));

    const ns = 'http://www.w3.org/2000/svg';
    const overlayDoc = document.implementation.createDocument(ns, 'svg', null);
    const overlaySvg = overlayDoc.documentElement;
    overlaySvg.setAttribute('xmlns', ns);
    const vb = panelLayerSvgEl.getAttribute('viewBox') || '0 0 21000 29700';
    overlaySvg.setAttribute('viewBox', vb);

    // basePanelPoints がある場合、clipPath定義をdefsに保存
    const basePts = state.activePage.basePanelPoints;
    const overlayClipId = 'overlay-page-clip';
    // オーバーレイのマスク定義（全面マスク＋オーバーレイ内オブジェクトのレイヤーマスク）も持ち回る
    const overlayMasks = [];
    clone.querySelectorAll('defs mask[data-ccc-mask]').forEach(m => {
        const t = m.getAttribute('data-ccc-mask');
        if (t === '__overlay__' || clone.querySelector(`g[data-overlay-layer] [id="${t}"]`)) {
            overlayMasks.push(m);
        }
    });
    if (basePts || overlayMasks.length) {
        const defs = overlayDoc.createElementNS(ns, 'defs');
        if (basePts) {
            const clipPath = overlayDoc.createElementNS(ns, 'clipPath');
            clipPath.setAttribute('id', overlayClipId);
            clipPath.setAttribute('clipPathUnits', 'userSpaceOnUse');
            const poly = overlayDoc.createElementNS(ns, 'polygon');
            poly.setAttribute('points', basePts);
            clipPath.appendChild(poly);
            defs.appendChild(clipPath);
        }
        overlayMasks.forEach(m => defs.appendChild(overlayDoc.importNode(m, true)));
        overlaySvg.appendChild(defs);
    }

    // オーバーレイg要素を収集
    const overlayG = clone.querySelector('g[data-overlay-layer]');
    if (overlayG && overlayG.children.length > 0) {
        const importedG = document.importNode(overlayG, true);
        // clip-path 属性を確実に設定
        if (basePts) importedG.setAttribute('clip-path', `url(#${overlayClipId})`);
        overlaySvg.appendChild(importedG);
    }

    // コンテンツが参照するフィルタ定義（袋文字・影のテキストスタイル等）も持ち回る
    _collectReferencedFilters(overlaySvg, clone.querySelector('defs'));

    const serializer = new XMLSerializer();
    let str = serializer.serializeToString(overlaySvg);
    if (!str.includes('xmlns="http://www.w3.org/2000/svg"')) {
        str = str.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    const updatedRecord = { ...state.activePage, overlaySvgContent: str };
    try {
        await dbPut('pages', updatedRecord, { deferThumb: true });
        state.activePage = updatedRecord;
        renderLayerPanel();
    } catch (e) {
        console.error('Overlay save error:', e);
    }
}

// オーバーレイレイヤーを選択
function selectOverlay() {
    _clearObjectSelection();
    state.selectedPanelId = null;
    state.selectedOverlay = true;
    state.selectedDraft = false;
    updatePanelSelectDropdown();
    updateBalloonPanelSelect();
    renderLayerPanel();
    const svgEl = document.querySelector('#layout-preview svg, #text-preview svg');
    if (svgEl) {
        highlightOverlay(svgEl, null);
        _syncDraftInteractivity(svgEl);
    }
}

function getOrCreateClipGroup(overlaySvgEl) {
    // オーバーレイ選択中はオーバーレイグループを返す
    if (state.selectedOverlay) {
        return getOrCreateOverlayGroup(overlaySvgEl);
    }
    if (state.selectedPanelId && state.selectedPanelId !== 'panel-0') {
        const clipId = `panel-clip-${state.selectedPanelId}`;
        let defs = overlaySvgEl.querySelector('defs');
        if (!defs) {
            defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            overlaySvgEl.insertBefore(defs, overlaySvgEl.firstChild);
        }

        let clipPath = overlaySvgEl.querySelector(`[id="${clipId}"]`);
        if (!clipPath) {
            const panel = state.activePage.panels.find(p => p.id === state.selectedPanelId);
            if (panel && panel.points) {
                clipPath = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
                clipPath.setAttribute('id', clipId);
                clipPath.setAttribute('clipPathUnits', 'userSpaceOnUse');
                const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                poly.setAttribute('points', panel.points);
                clipPath.appendChild(poly);
                defs.appendChild(clipPath);
            }
        }

        if (clipPath) {
            let g = overlaySvgEl.querySelector(`g[data-clip-panel="${state.selectedPanelId}"]`);
            if (!g) {
                g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                g.setAttribute('clip-path', `url(#${clipId})`);
                g.setAttribute('class', 'balloon-group');
                g.setAttribute('data-clip-panel', state.selectedPanelId);
                overlaySvgEl.appendChild(g);
            }
            return g;
        }
    }
    return overlaySvgEl;
}

// ------------------------------------------------------------
// 高機能フキダシ関連のユーティリティ
// ------------------------------------------------------------

// 円を近似する SVG path（4つの三次ベジェ）
function circleToPath(x, y, r) {
    const k = r * 0.5522847498; // (4/3)*tan(pi/8) の近似
    return `M ${x + r},${y}` +
           ` C ${x + r},${y - k} ${x + k},${y - r} ${x},${y - r}` +
           ` C ${x - k},${y - r} ${x - r},${y - k} ${x - r},${y}` +
           ` C ${x - r},${y + k} ${x - k},${y + r} ${x},${y + r}` +
           ` C ${x + k},${y + r} ${x + r},${y + k} ${x + r},${y}` +
           ` Z`;
}

// 楕円座標系（rx,ry）で角度を計算するヘルパー
// 楕円を円に正規化して角度を求め、楕円のパラメータ角（θ）に変換する
// tailAngleElliptic: 楕円の中心から見た「実際の方向角」→ 楕円パラメータ角θに変換
// hukidasi2 互換: シード付き疑似乱数
function _h2_mulberry32(a) {
    return function() {
        var t = a += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// hukidasi2 互換: 楕円/角丸矩形の境界点を取得（bomb/thoughtで使用）
function _h2_getBoundaryPoint(type, rx, ry, angleRad, rectRadius) {
    let erx = rx, ery = ry, useType = type;
    if (useType === 'normal' || useType === 'thought') {
        const r = (erx * ery) / Math.sqrt(Math.pow(ery * Math.cos(angleRad), 2) + Math.pow(erx * Math.sin(angleRad), 2));
        return { x: r * Math.cos(angleRad), y: r * Math.sin(angleRad), r };
    } else if (useType === 'rect') {
        let normTheta = ((angleRad % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        let qTheta = normTheta;
        if (qTheta > Math.PI / 2 && qTheta <= Math.PI) qTheta = Math.PI - qTheta;
        else if (qTheta > Math.PI && qTheta <= Math.PI * 3 / 2) qTheta = qTheta - Math.PI;
        else if (qTheta > Math.PI * 3 / 2) qTheta = Math.PI * 2 - qTheta;
        const cos = Math.cos(qTheta), sin = Math.sin(qTheta);
        const radius = Math.min(rectRadius || 20, erx, ery);
        let t = 0;
        if (cos < 0.0001) t = ery;
        else if (sin < 0.0001) t = erx;
        else {
            const t1 = ery / sin;
            if (t1 * cos <= erx - radius) t = t1;
            else {
                const t2 = erx / cos;
                if (t2 * sin <= ery - radius) t = t2;
                else {
                    const ccx = erx - radius, ccy = ery - radius;
                    const b2 = -2 * (ccx * cos + ccy * sin);
                    const cc = ccx * ccx + ccy * ccy - radius * radius;
                    const dd = b2 * b2 - 4 * cc;
                    t = dd >= 0 ? (-b2 + Math.sqrt(dd)) / 2 : Math.min(t1, t2);
                }
            }
        }
        return { x: t * Math.cos(normTheta), y: t * Math.sin(normTheta), r: t };
    }
    const r = (erx * ery) / Math.sqrt(Math.pow(ery * Math.cos(angleRad), 2) + Math.pow(erx * Math.sin(angleRad), 2));
    return { x: r * Math.cos(angleRad), y: r * Math.sin(angleRad), r };
}

// hukidasi2 互換: bomb (バクダン/ギザギザ) パス生成
// params: { cx, cy, rx, ry, tailAngleDeg, tailLength, tailWidth(半角度deg), tailCurve, seed, spikeCount, spikeLevel, spikeVariance, borderWidth }
function generateBombPath(params) {
    const { cx, cy, rx, ry, tailAngleDeg, tailLength, tailWidth, tailCurve, seed, spikeCount, spikeLevel, spikeVariance, borderWidth } = params;
    const rng = _h2_mulberry32(seed || 1);
    const numSpikes = spikeCount || 24;
    const levelScale = (spikeLevel !== undefined ? spikeLevel : 30) / 100;
    const varScale = (spikeVariance !== undefined ? spikeVariance : 30) / 100;

    // 本体ポリゴン点生成
    const points = [];
    for (let i = 0; i < numSpikes; i++) {
        const angle1 = (i / numSpikes) * Math.PI * 2;
        const r1 = 1.0 - (levelScale * 0.3 * (1.0 - rng() * varScale));
        points.push({ x: cx + rx * r1 * Math.cos(angle1), y: cy + ry * r1 * Math.sin(angle1) });
        const angle2 = ((i + 0.5) / numSpikes) * Math.PI * 2;
        const r2 = 1.0 + (levelScale * 0.5 * (1.0 - rng() * varScale));
        points.push({ x: cx + rx * r2 * Math.cos(angle2), y: cy + ry * r2 * Math.sin(angle2) });
    }

    // 尻尾パス
    const tailAngleRad = (tailAngleDeg || 0) * Math.PI / 180;
    const baseScale = 1.0 - (levelScale * 0.3);
    const bpTip = _h2_getBoundaryPoint('bomb_base', rx * baseScale, ry * baseScale, tailAngleRad);
    const tipX = cx + bpTip.x + (tailLength || 60) * Math.cos(tailAngleRad);
    const tipY = cy + bpTip.y + (tailLength || 60) * Math.sin(tailAngleRad);

    const normalRad = tailAngleRad + Math.PI / 2;
    const curveOX = Math.cos(normalRad) * (tailCurve || 0);
    const curveOY = Math.sin(normalRad) * (tailCurve || 0);
    const sx = cx + bpTip.x, sy = cy + bpTip.y;
    const _cx = (sx + tipX) / 2 + curveOX;
    const _cy = (sy + tipY) / 2 + curveOY;

    const tailHalfAngle = ((tailWidth || 13) / 2) * Math.PI / 180;
    const b1Rad = tailAngleRad - tailHalfAngle;
    const b2Rad = tailAngleRad + tailHalfAngle;
    // 尻尾の付け根を本体の内側にどれだけ食い込ませるか。本体と尻尾は別々のpath要素として
    // 縁取りを描画しているため、この食い込みが枠線の太さ(borderWidth)より浅いと、
    // 尻尾が細いほど接合部の縁取りが噛み合わず隙間（細い線）が見えてしまう
    const overlap = Math.max(2, (borderWidth || 0) + 2);
    const bp1 = _h2_getBoundaryPoint('bomb_base', rx * baseScale, ry * baseScale, b1Rad);
    const bp2 = _h2_getBoundaryPoint('bomb_base', rx * baseScale, ry * baseScale, b2Rad);
    const b1 = { x: cx + Math.max(0, bp1.r - overlap) * Math.cos(b1Rad), y: cy + Math.max(0, bp1.r - overlap) * Math.sin(b1Rad) };
    const b2 = { x: cx + Math.max(0, bp2.r - overlap) * Math.cos(b2Rad), y: cy + Math.max(0, bp2.r - overlap) * Math.sin(b2Rad) };
    // 制御点 = b1b2中点 + 法線オフセット（サイズ変更でb1/b2と一緒に追従）
    // 本体パス
    let bodyPath = `M ${points[0].x},${points[0].y}`;
    for (let i = 1; i < points.length; i++) bodyPath += ` L ${points[i].x},${points[i].y}`;
    bodyPath += ' Z';

    // 尻尾パス（tailCurve=0なら直線）
    let tailPath;
    if ((tailCurve || 0) === 0) {
        tailPath = `M ${b1.x},${b1.y} L ${tipX},${tipY} L ${b2.x},${b2.y} Z`;
    } else {
        const bMidX = (b1.x + b2.x) / 2, bMidY = (b1.y + b2.y) / 2;
        const cx1 = bMidX + curveOX, cy1 = bMidY + curveOY;
        tailPath = `M ${b1.x},${b1.y} Q ${cx1},${cy1} ${tipX},${tipY} Q ${cx1},${cy1} ${b2.x},${b2.y} Z`;
    }

    return { bodyPath, tailPath };
}

// hukidasi2 互換: thought (思考/泡) パス生成
// params: { cx, cy, rx, ry, tailAngleDeg, tailLength, tailCurve, thoughtBubbleSize, thoughtBubbleCount, thoughtBubbleOffset }
function generateThoughtPath(params) {
    const { cx, cy, rx, ry, tailAngleDeg, tailLength, tailCurve, thoughtBubbleSize, thoughtBubbleCount, thoughtBubbleOffset } = params;
    // 泡の数（直接指定）。1個なら本体すぐそばに最大サイズの泡のみ
    const count = Math.max(1, Math.round(thoughtBubbleCount ?? 5));
    // 本体から泡を離す度合い（%、100=標準、0=本体境界に埋もれる、200=標準の2倍離す）
    const offsetRatio = (thoughtBubbleOffset ?? 100) / 100;
    const tailAngleRad = (tailAngleDeg || 0) * Math.PI / 180;

    // 本体楕円パス
    const kx = rx * 0.5522847498, ky = ry * 0.5522847498;
    const bodyPath = `M ${cx + rx},${cy}` +
        ` C ${cx + rx},${cy - ky} ${cx + kx},${cy - ry} ${cx},${cy - ry}` +
        ` C ${cx - kx},${cy - ry} ${cx - rx},${cy - ky} ${cx - rx},${cy}` +
        ` C ${cx - rx},${cy + ky} ${cx - kx},${cy + ry} ${cx},${cy + ry}` +
        ` C ${cx + kx},${cy + ry} ${cx + rx},${cy + ky} ${cx + rx},${cy} Z`;

    // 尻尾: 泡列
    const len = tailLength || 60;
    // thoughtBubbleSize = 最大泡半径（本体側の泡）
    const minR = 5;
    const maxR = thoughtBubbleSize || 800;

    // 境界点（本体側起点）
    const bpTip = _h2_getBoundaryPoint('normal', rx, ry, tailAngleRad);
    const sx = cx + bpTip.x, sy = cy + bpTip.y;
    const tipX = sx + len * Math.cos(tailAngleRad);
    const tipY = sy + len * Math.sin(tailAngleRad);

    // カーブ制御点
    const normalRad = tailAngleRad + Math.PI / 2;
    const curveOX = Math.cos(normalRad) * (tailCurve || 0);
    const curveOY = Math.sin(normalRad) * (tailCurve || 0);
    // 制御点 = 本体境界点と先端の中点 + 法線オフセット（thoughtは幅ポイントがないため中点ベース）
    const qcx = (sx + tipX) / 2 + curveOX;
    const qcy = (sy + tipY) / 2 + curveOY;

    // ベジェ曲線上の点（t=0: 先端, t=1: 本体側）
    const bezPt = (t) => {
        const omt = 1 - t;
        return {
            x: omt * omt * tipX + 2 * omt * t * qcx + t * t * sx,
            y: omt * omt * tipY + 2 * omt * t * qcy + t * t * sy,
        };
    };

    // 曲線上の弧長を積分して、弧長に対する均等割りでcount個の泡を配置する
    // （ベジェのtパラメータをそのまま均等割りすると曲率の強い部分で偏るため、弧長ベースにする）
    const STEPS = 200; // 弧長積分の分割数
    const arcTable = [{ t: 0, len: 0 }];
    let totalArc = 0;
    let prevPt = bezPt(0);
    for (let i = 1; i <= STEPS; i++) {
        const t = i / STEPS;
        const pt = bezPt(t);
        totalArc += Math.hypot(pt.x - prevPt.x, pt.y - prevPt.y);
        arcTable.push({ t, len: totalArc });
        prevPt = pt;
    }
    // 弧長 → t 変換
    const arcToT = (arcLen) => {
        if (arcLen <= 0) return 0;
        if (arcLen >= totalArc) return 1;
        let lo = 0, hi = arcTable.length - 1;
        while (lo < hi - 1) {
            const mid = (lo + hi) >> 1;
            if (arcTable[mid].len < arcLen) lo = mid; else hi = mid;
        }
        const a = arcTable[lo], b = arcTable[hi];
        const frac = (arcLen - a.len) / (b.len - a.len);
        return a.t + frac * (b.t - a.t);
    };

    // 先端(i=0, 最小サイズ)から本体側(i=count-1, 最大サイズ)へ、弧長上に均等配置
    // t=1は本体の輪郭線ちょうど上の点のため、そのまま円を置くと本体に埋もれる。
    // 本体に近い（tが大きい）泡ほど尻尾方向へ半径分押し出し、本体の外側に完全に出す
    let circlePaths = '';
    for (let i = 0; i < count; i++) {
        const arcFrac = count === 1 ? 1 : i / (count - 1);
        const t = arcToT(arcFrac * totalArc);
        const bp = bezPt(t);
        const r = minR + (maxR - minR) * t;
        const px = bp.x + r * t * offsetRatio * Math.cos(tailAngleRad);
        const py = bp.y + r * t * offsetRatio * Math.sin(tailAngleRad);
        const kr = r * 0.5522847498;
        circlePaths += ` M ${px + r},${py}` +
            ` C ${px + r},${py - kr} ${px + kr},${py - r} ${px},${py - r}` +
            ` C ${px - kr},${py - r} ${px - r},${py - kr} ${px - r},${py}` +
            ` C ${px - r},${py + kr} ${px - kr},${py + r} ${px},${py + r}` +
            ` C ${px + kr},${py + r} ${px + r},${py + kr} ${px + r},${py} Z`;
    }

    return { bodyPath: bodyPath + circlePaths, tailPath: '' };
}


// 雲(なみなみ)の輪郭上の1点を、本体パス生成(generateCloudWavyPath)と全く同じ式で計算する。
// 尻尾の付け根をこの関数で求めることで、近似の楕円ではなく実際に描画される輪郭線上に
// 正確に乗せられる（本体と尻尾が分離して見える隙間を防ぐ）。戻り値はcx,cy基準のローカル座標
function _cloudWavyPointAt(rx, ry, shapeCount, shapeAmplitude, shapeVariation, seed, theta) {
    const rng = _h2_mulberry32(seed || 1);
    const bumps  = Math.max(6, Math.min(60, Math.round(shapeCount || 18)));
    const amp01  = Math.max(0, Math.min(1, (shapeAmplitude ?? 55) / 100));
    const irr    = Math.max(0, Math.min(1, (shapeVariation ?? 0) / 100));
    const bumps2 = Math.max(3, Math.round(bumps * 0.6));
    const phase  = 0.7;
    const amp    = 0.22 * amp01;

    let wgt = 1.0;
    if (irr > 0) {
        const weights = [];
        for (let i = 0; i < bumps; i++) weights.push(1.0 + irr * 0.35 * (rng() * 2 - 1));
        const u = (theta / (Math.PI * 2)) * bumps;
        const norm = ((u % bumps) + bumps) % bumps;
        const i0 = Math.floor(norm) % bumps;
        const frac = norm - Math.floor(norm);
        const i1 = (i0 + 1) % bumps;
        wgt = weights[i0] * (1 - frac) + weights[i1] * frac;
    }

    const base = 0.65 * Math.sin(bumps * theta) + 0.35 * Math.sin(bumps2 * theta + phase);
    let rmod = 1 + amp * wgt * base;
    rmod = Math.max(0.35, rmod);

    // バンプによるはみ出しを吸収するため楕円半径を86%に縮小（参照ノードと同じ比率）
    const erx = rx * 0.86, ery = ry * 0.86;
    const x = erx * rmod * Math.cos(theta);
    const y = ery * rmod * Math.sin(theta);
    return { x, y, r: Math.hypot(x, y) };
}

// hukidasi2 互換: 雲(なみなみ) パス生成。参考ノード comfyUI-TextOverlayAndBubbles の
// _cloud_mask_wavy を移植。楕円を2つの正弦波(θ*bumps と θ*bumps2+phase)で半径変調し、
// 輪郭全体が滑らかに波打つ雲アウトラインにする。
// params: { cx, cy, rx, ry, shapeCount, shapeAmplitude(0-100), shapeVariation(0-100), seed }
function generateCloudWavyPath(params) {
    const { cx, cy, rx, ry, shapeCount, shapeAmplitude, shapeVariation, seed } = params;
    const n = 180;
    let bodyPath = '';
    for (let i = 0; i < n; i++) {
        const theta = (i / n) * Math.PI * 2;
        const p = _cloudWavyPointAt(rx, ry, shapeCount, shapeAmplitude, shapeVariation, seed, theta);
        const x = cx + p.x, y = cy + p.y;
        bodyPath += (i === 0 ? `M ${x},${y}` : ` L ${x},${y}`);
    }
    bodyPath += ' Z';
    return { bodyPath };
}

// 雲(もこもこ)の輪郭上の1点を、本体パス生成(generateCloudPuffyPath)と全く同じ式で計算する。
// _cloudWavyPointAt と同じ理由で、尻尾の付け根を実際の輪郭線上に正確に乗せるために使う。
// 戻り値はcx,cy基準のローカル座標
function _cloudPuffyPointAt(rx, ry, shapeCount, shapeAmplitude, shapeVariation, seed, theta) {
    const rng = _h2_mulberry32(seed || 1);
    const bumps = Math.max(6, Math.min(60, Math.round(shapeCount || 18)));
    const amp01 = Math.max(0, Math.min(1, (shapeAmplitude ?? 55) / 100));
    const irr   = Math.max(0, Math.min(1, (shapeVariation ?? 0) / 100));

    const rBase = Math.max(2, Math.min(rx, ry) * 0.35 * amp01);
    const rList = [];
    for (let i = 0; i < bumps; i++) rList.push(rBase * (1 + irr * 0.35 * (rng() * 2 - 1)));
    const rMax = rList.reduce((m, r) => Math.max(m, r), 0);
    const offBase = rMax * 0.38;

    // バンプ分の余白を差し引いた内側の楕円（もこもこの土台）。極端な値でも潰れないよう下限を設ける
    let a = rx - (rMax + offBase) - rx * 0.02;
    let b = ry - (rMax + offBase) - ry * 0.02;
    if (a < rx * 0.25 || b < ry * 0.25) { a = rx * 0.25; b = ry * 0.25; }

    // 楕円周を等弧長でbumps分割し、各分割点の外向き法線方向にバンプ中心をオフセット配置する
    const dense = 360;
    const pts = [];
    const cum = [0];
    let prevX = a, prevY = 0;
    for (let i = 0; i <= dense; i++) {
        const th = (i / dense) * Math.PI * 2;
        const x = a * Math.cos(th), y = b * Math.sin(th);
        pts.push({ x, y });
        if (i > 0) cum.push(cum[cum.length - 1] + Math.hypot(x - prevX, y - prevY));
        prevX = x; prevY = y;
    }
    const total = cum[cum.length - 1];

    const bumpCenters = [];
    let j = 0;
    for (let k = 0; k < bumps; k++) {
        const target = (k * total) / bumps;
        while (j < cum.length - 2 && cum[j + 1] < target) j++;
        const d0 = cum[j], d1 = cum[j + 1];
        const frac = d1 === d0 ? 0 : (target - d0) / (d1 - d0);
        const p0 = pts[j], p1 = pts[j + 1];
        const x = p0.x + (p1.x - p0.x) * frac;
        const y = p0.y + (p1.y - p0.y) * frac;
        let nx = x / (a * a), ny = y / (b * b);
        const nlen = Math.hypot(nx, ny) || 1;
        nx /= nlen; ny /= nlen;
        const off = offBase * (1 + irr * 0.2 * (rng() * 2 - 1));
        bumpCenters.push({ x: x + nx * off, y: y + ny * off, r: rList[k] });
    }

    // 中心(0,0基準)からの光線が各図形と交わる遠い方の交点距離の最大値を輪郭半径とする
    const dx = Math.cos(theta), dy = Math.sin(theta);
    let r = (a * b) / Math.sqrt((b * dx) * (b * dx) + (a * dy) * (a * dy));
    for (const bc of bumpCenters) {
        const ox = -bc.x, oy = -bc.y;
        const b1 = ox * dx + oy * dy;
        const c1 = ox * ox + oy * oy - bc.r * bc.r;
        const disc = b1 * b1 - c1;
        if (disc < 0) continue;
        const t = -b1 + Math.sqrt(disc);
        if (t > r) r = t;
    }
    return { x: r * dx, y: r * dy, r };
}

// 境界点計算の共通ヘルパー。cloudpuffy/cloudwavyは実際の輪郭関数(_cloudXxxPointAt)に委譲し、
// それ以外は従来通り _h2_getBoundaryPoint に委譲する。尻尾の付け根・尻尾ハンドル・カーブハンドルの
// いずれもこの関数を経由することで、フキダシ本体の見た目の輪郭と常に一致する
function _h2BoundaryPointFor(el, angleRad) {
    const type = el.dataset.shapeType;
    const rx = parseFloat(el.dataset.rx), ry = parseFloat(el.dataset.ry);
    if (type === 'cloudpuffy' || type === 'cloudwavy') {
        const pointAt = type === 'cloudpuffy' ? _cloudPuffyPointAt : _cloudWavyPointAt;
        return pointAt(
            rx, ry,
            parseFloat(el.dataset.shapeCount || 18),
            parseFloat(el.dataset.shapeAmplitude ?? 55),
            parseFloat(el.dataset.shapeVariation ?? 0),
            parseInt(el.dataset.seed || 1),
            angleRad
        );
    }
    const bpType = type === 'rect' ? 'rect' : 'normal';
    const bpR = type === 'rect' ? Math.min(parseFloat(el.dataset.rectRadius || 80), rx, ry) : undefined;
    return _h2_getBoundaryPoint(bpType, rx, ry, angleRad, bpR);
}

// hukidasi2 互換: 雲(もこもこ) パス生成。参考ノードの _cloud_mask_scalloped を移植。
// 内側の楕円 + その周囲に等弧長で配置した円(バンプ)群の和集合を、中心からの光線と
// (楕円 or 各バンプ円)の遠い方の交点距離の最大値として輪郭を近似する
// （SVGにはブーリアン和がないため、放射状サンプリングで輪郭を再構成する）。
function generateCloudPuffyPath(params) {
    const { cx, cy, rx, ry, shapeCount, shapeAmplitude, shapeVariation, seed } = params;
    const n = 240;
    let bodyPath = '';
    for (let i = 0; i < n; i++) {
        const theta = (i / n) * Math.PI * 2;
        const p = _cloudPuffyPointAt(rx, ry, shapeCount, shapeAmplitude, shapeVariation, seed, theta);
        const x = cx + p.x, y = cy + p.y;
        bodyPath += (i === 0 ? `M ${x},${y}` : ` L ${x},${y}`);
    }
    bodyPath += ' Z';
    return { bodyPath };
}

function updateShapePath(el) {
    _updateH2ShapePath(el);
}

// hukidasi2 互換タイプ（bomb/thought/normal）の描画更新
// el: balloon-shape クラスを持つ <g> 要素
function _updateH2ShapePath(el) {
    const type = el.dataset.shapeType;

    // シンプル版フキダシ+内包テキスト（09f-bubble-text.js）は尻尾のない別構造のため、
    // 専用の更新関数に委譲してここでは何もしない
    if (typeof _isBubbleTextType === 'function' && _isBubbleTextType(type)) {
        _bubbleTextUpdateShape(el);
        return;
    }

    const cx = parseFloat(el.dataset.cx);
    const cy = parseFloat(el.dataset.cy);
    const rx = parseFloat(el.dataset.rx);
    const ry = parseFloat(el.dataset.ry);
    const tailAngleDeg = parseFloat(el.dataset.tailAngleDeg || 45);
    const tailLength   = parseFloat(el.dataset.tailLength   || 60);
    const tailWidth    = parseFloat(el.dataset.tailWidth    || 13);
    const tailCurve    = el.dataset.tailCurveOn === '1' ? parseFloat(el.dataset.tailCurve || 0) : 0;
    const angle        = parseFloat(el.dataset.angle        || 0);
    const borderWidth  = parseFloat(el.dataset.borderWidth  || 3);
    const fillColor    = el.dataset.fillColor  || '#ffffff';
    const strokeColor  = el.dataset.strokeColor || '#000000';

    // 本体サイズをビューボックス比で調整
    const svgEl = el.ownerSVGElement;

    let bodyPath, tailPath;
    if (type === 'bomb') {
        const result = generateBombPath({
            cx, cy, rx, ry, tailAngleDeg, tailLength, tailWidth, tailCurve, borderWidth,
            seed:          parseInt(el.dataset.seed || 1),
            spikeCount:    parseInt(el.dataset.spikeCount || 24),
            spikeLevel:    parseFloat(el.dataset.spikeLevel || 30),
            spikeVariance: parseFloat(el.dataset.spikeVariance || 30),
        });
        bodyPath = result.bodyPath;
        tailPath = result.tailPath;
    } else if (type === 'thought') {
        const result = generateThoughtPath({
            cx, cy, rx, ry, tailAngleDeg, tailLength, tailCurve,
            thoughtBubbleSize:   parseFloat(el.dataset.thoughtBubbleSize || 800),
            thoughtBubbleCount:  parseFloat(el.dataset.thoughtBubbleCount ?? 5),
            thoughtBubbleOffset: parseFloat(el.dataset.thoughtBubbleOffset ?? 100),
        });
        bodyPath = result.bodyPath;
        tailPath = '';
    } else if (type === 'rect') {
        // 角丸矩形 + 尻尾（hukidasi2.html rect方式）
        const rectRadius = parseFloat(el.dataset.rectRadius || 80);
        const r = Math.min(rectRadius, rx, ry);
        // 角丸矩形の本体pathを生成
        const x0 = cx - rx, y0 = cy - ry, w = rx * 2, h = ry * 2;
        bodyPath = `M ${x0 + r},${y0}` +
            ` L ${x0 + w - r},${y0} Q ${x0 + w},${y0} ${x0 + w},${y0 + r}` +
            ` L ${x0 + w},${y0 + h - r} Q ${x0 + w},${y0 + h} ${x0 + w - r},${y0 + h}` +
            ` L ${x0 + r},${y0 + h} Q ${x0},${y0 + h} ${x0},${y0 + h - r}` +
            ` L ${x0},${y0 + r} Q ${x0},${y0} ${x0 + r},${y0} Z`;
        // 尻尾
        const tailAngleRad = tailAngleDeg * Math.PI / 180;
        const normalRad    = tailAngleRad + Math.PI / 2;
        const bpTip = _h2_getBoundaryPoint('rect', rx, ry, tailAngleRad, r);
        const tipX  = cx + bpTip.x + tailLength * Math.cos(tailAngleRad);
        const tipY  = cy + bpTip.y + tailLength * Math.sin(tailAngleRad);
        const halfAngleRad = (tailWidth / 2) * Math.PI / 180;
        const b1Rad = tailAngleRad - halfAngleRad;
        const b2Rad = tailAngleRad + halfAngleRad;
        // 尻尾の付け根を本体の内側にどれだけ食い込ませるか。本体と尻尾は別々のpath要素として
    // 縁取りを描画しているため、この食い込みが枠線の太さ(borderWidth)より浅いと、
    // 尻尾が細いほど接合部の縁取りが噛み合わず隙間（細い線）が見えてしまう
    const overlap = Math.max(2, borderWidth + 2);
        const bp1 = _h2_getBoundaryPoint('rect', rx, ry, b1Rad, r);
        const bp2 = _h2_getBoundaryPoint('rect', rx, ry, b2Rad, r);
        const b1 = { x: cx + Math.max(0, bp1.r - overlap) * Math.cos(b1Rad), y: cy + Math.max(0, bp1.r - overlap) * Math.sin(b1Rad) };
        const b2 = { x: cx + Math.max(0, bp2.r - overlap) * Math.cos(b2Rad), y: cy + Math.max(0, bp2.r - overlap) * Math.sin(b2Rad) };
        // 制御点 = b1b2中点 + 法線オフセット（tailCurve=0なら直線）
        if (tailCurve === 0) {
            tailPath = `M ${b1.x},${b1.y} L ${tipX},${tipY} L ${b2.x},${b2.y} Z`;
        } else {
            const bMidX = (b1.x + b2.x) / 2, bMidY = (b1.y + b2.y) / 2;
            const curveOX = Math.cos(normalRad) * tailCurve;
            const curveOY = Math.sin(normalRad) * tailCurve;
            const cx1 = bMidX + curveOX, cy1 = bMidY + curveOY;
            tailPath = `M ${b1.x},${b1.y} Q ${cx1},${cy1} ${tipX},${tipY} Q ${cx1},${cy1} ${b2.x},${b2.y} Z`;
        }
    } else if (type === 'cloudpuffy' || type === 'cloudwavy') {
        // 雲フキダシ: 本体は専用の輪郭生成関数、尻尾はnormalタイプと同じ滑らかな三角形。
        // 尻尾の付け根は本体パス生成と同じ関数(_cloudWavyPointAt/_cloudPuffyPointAt)で
        // 実際の輪郭線上の点を直接求める（近似の楕円ではなく実輪郭に正確に合わせることで、
        // 本体と尻尾が分離して見える隙間を防ぐ）
        const tailAngleRad = tailAngleDeg * Math.PI / 180;
        const normalRad    = tailAngleRad + Math.PI / 2;
        const halfAngleRad = (tailWidth / 2) * Math.PI / 180;
        const b1Rad = tailAngleRad - halfAngleRad;
        const b2Rad = tailAngleRad + halfAngleRad;
        const overlap = Math.max(2, borderWidth + 2);

        const bpTip = _h2BoundaryPointFor(el, tailAngleRad);
        const tipX  = cx + bpTip.x + tailLength * Math.cos(tailAngleRad);
        const tipY  = cy + bpTip.y + tailLength * Math.sin(tailAngleRad);

        // 尻尾の付け根を本体の内側に食い込ませる（自身の中心方向に沿って縮める。
        // 実輪郭上の点は真の極角とパラメトリック角がずれることがあるため、
        // b1Rad方向へ再投影せず、その点自身の方向ベクトルをそのまま縮小する）
        const bp1 = _h2BoundaryPointFor(el, b1Rad);
        const bp2 = _h2BoundaryPointFor(el, b2Rad);
        const scale1 = bp1.r > 0 ? Math.max(0, bp1.r - overlap) / bp1.r : 0;
        const scale2 = bp2.r > 0 ? Math.max(0, bp2.r - overlap) / bp2.r : 0;
        const b1 = { x: cx + bp1.x * scale1, y: cy + bp1.y * scale1 };
        const b2 = { x: cx + bp2.x * scale2, y: cy + bp2.y * scale2 };

        const cloudParams = {
            cx, cy, rx, ry,
            shapeCount:     parseFloat(el.dataset.shapeCount || 18),
            shapeAmplitude: parseFloat(el.dataset.shapeAmplitude ?? 55),
            shapeVariation: parseFloat(el.dataset.shapeVariation ?? 0),
            seed:           parseInt(el.dataset.seed || 1),
        };
        const cloudResult = type === 'cloudpuffy' ? generateCloudPuffyPath(cloudParams) : generateCloudWavyPath(cloudParams);
        bodyPath = cloudResult.bodyPath;

        if (tailCurve === 0) {
            tailPath = `M ${b1.x},${b1.y} L ${tipX},${tipY} L ${b2.x},${b2.y} Z`;
        } else {
            const bMidX = (b1.x + b2.x) / 2, bMidY = (b1.y + b2.y) / 2;
            const curveOX = Math.cos(normalRad) * tailCurve;
            const curveOY = Math.sin(normalRad) * tailCurve;
            const cx1 = bMidX + curveOX, cy1 = bMidY + curveOY;
            tailPath = `M ${b1.x},${b1.y} Q ${cx1},${cy1} ${tipX},${tipY} Q ${cx1},${cy1} ${b2.x},${b2.y} Z`;
        }
    } else {
        // normal: 楕円 + 尻尾（hukidasi2方式）
        const tailAngleRad = tailAngleDeg * Math.PI / 180;
        const normalRad    = tailAngleRad + Math.PI / 2;
        const bpTip = _h2_getBoundaryPoint('normal', rx, ry, tailAngleRad);
        const tipX  = cx + bpTip.x + tailLength * Math.cos(tailAngleRad);
        const tipY  = cy + bpTip.y + tailLength * Math.sin(tailAngleRad);
        const halfAngleRad = (tailWidth / 2) * Math.PI / 180;
        const b1Rad = tailAngleRad - halfAngleRad;
        const b2Rad = tailAngleRad + halfAngleRad;
        // 尻尾の付け根を本体の内側にどれだけ食い込ませるか。本体と尻尾は別々のpath要素として
    // 縁取りを描画しているため、この食い込みが枠線の太さ(borderWidth)より浅いと、
    // 尻尾が細いほど接合部の縁取りが噛み合わず隙間（細い線）が見えてしまう
        const overlap = Math.max(2, borderWidth + 2);
        const bp1 = _h2_getBoundaryPoint('normal', rx, ry, b1Rad);
        const bp2 = _h2_getBoundaryPoint('normal', rx, ry, b2Rad);
        const b1 = { x: cx + Math.max(0, bp1.r - overlap) * Math.cos(b1Rad), y: cy + Math.max(0, bp1.r - overlap) * Math.sin(b1Rad) };
        const b2 = { x: cx + Math.max(0, bp2.r - overlap) * Math.cos(b2Rad), y: cy + Math.max(0, bp2.r - overlap) * Math.sin(b2Rad) };
        // 本体楕円
        const kx = rx * 0.5522847498, ky = ry * 0.5522847498;
        bodyPath = `M ${cx + rx},${cy}` +
            ` C ${cx + rx},${cy - ky} ${cx + kx},${cy - ry} ${cx},${cy - ry}` +
            ` C ${cx - kx},${cy - ry} ${cx - rx},${cy - ky} ${cx - rx},${cy}` +
            ` C ${cx - rx},${cy + ky} ${cx - kx},${cy + ry} ${cx},${cy + ry}` +
            ` C ${cx + kx},${cy + ry} ${cx + rx},${cy + ky} ${cx + rx},${cy} Z`;
        // 制御点 = b1b2中点 + 法線オフセット（tailCurve=0なら直線）
        if (tailCurve === 0) {
            tailPath = `M ${b1.x},${b1.y} L ${tipX},${tipY} L ${b2.x},${b2.y} Z`;
        } else {
            const bMidX = (b1.x + b2.x) / 2, bMidY = (b1.y + b2.y) / 2;
            const curveOX = Math.cos(normalRad) * tailCurve;
            const curveOY = Math.sin(normalRad) * tailCurve;
            const cx1 = bMidX + curveOX, cy1 = bMidY + curveOY;
            tailPath = `M ${b1.x},${b1.y} Q ${cx1},${cy1} ${tipX},${tipY} Q ${cx1},${cy1} ${b2.x},${b2.y} Z`;
        }
    }

    // 既存の子要素を更新（bg-border/fg-fillが既にあれば更新、なければ作成）
    const ns = 'http://www.w3.org/2000/svg';
    let bgBody = el.querySelector('.h2-bg-body');
    let bgTail = el.querySelector('.h2-bg-tail');
    let fgBody = el.querySelector('.h2-fg-body');
    let fgTail = el.querySelector('.h2-fg-tail');

    if (!bgBody) {
        // 初回作成
        const layerBorder = document.createElementNS(ns, 'g');
        layerBorder.setAttribute('class', 'h2-layer-border');
        layerBorder.setAttribute('stroke-linejoin', 'round');
        bgBody = document.createElementNS(ns, 'path');
        bgBody.setAttribute('class', 'h2-bg-body');
        bgTail = document.createElementNS(ns, 'path');
        bgTail.setAttribute('class', 'h2-bg-tail');
        layerBorder.append(bgBody, bgTail);

        const layerFill = document.createElementNS(ns, 'g');
        layerFill.setAttribute('class', 'h2-layer-fill');
        layerFill.setAttribute('stroke', 'none');
        fgBody = document.createElementNS(ns, 'path');
        fgBody.setAttribute('class', 'h2-fg-body');
        fgTail = document.createElementNS(ns, 'path');
        fgTail.setAttribute('class', 'h2-fg-tail');
        layerFill.append(fgBody, fgTail);

        el.append(layerBorder, layerFill);
    }

    // パスを更新
    bgBody.setAttribute('d', bodyPath);
    bgTail.setAttribute('d', tailPath || '');
    fgBody.setAttribute('d', bodyPath);
    fgTail.setAttribute('d', tailPath || '');

    // 色・枠線
    const sw = borderWidth * 2; // border/fillで相殺して実質borderWidthになる
    el.querySelector('.h2-layer-border').setAttribute('stroke-width', sw);
    el.querySelector('.h2-layer-border').setAttribute('stroke', borderWidth === 0 ? 'none' : strokeColor);
    el.querySelector('.h2-layer-border').setAttribute('fill', strokeColor);
    el.querySelector('.h2-layer-fill').setAttribute('fill', fillColor);

    // 回転
    if (angle !== 0) {
        el.setAttribute('transform', `rotate(${angle},${cx},${cy})`);
    } else {
        el.removeAttribute('transform');
    }

    // 内包テキスト（09f-bubble-text.js）: データがあれば同期、無ければ何もしない
    if (typeof _bubbleTextSyncH2Text === 'function') _bubbleTextSyncH2Text(el);
}

// フキダシ or 図形要素をPNG画像に変換して同位置に複製挿入する
// 実装は convertShapeToImage（09c-balloon-handles.js、読み込み順が後のため実際に有効になる定義）を参照
