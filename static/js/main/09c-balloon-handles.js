// ============================================================
// フキダシ管理 分割ファイル (3/5): フキダシ変形・ハンドル操作
// 元 09-balloons.js（分割前）の行 1295-1871 に相当
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: _h2CalcCurveHandlePos,_syncH2UI,_updateH2HandlePositions,applyImageTransform,calcHandleR,clearHandles,convertShapeToImage,createHandle,flipSelected,flipSelectedImage,flipSelectedShape,insertSmartBalloonTemplate,renderHandles
// ============================================================

// フキダシ or 図形要素をPNG画像に変換し、元の位置・表示サイズで複製挿入する（元要素は残す）
async function convertShapeToImage(el, svgEl) {
    if (!el || !svgEl) return;

    try {
        // ローカル座標系のbboxを、要素自身のtransform属性（回転など）だけを反映してSVGルート
        // 座標系に変換する。getCTMは祖先svgのviewBoxによるスケーリングまで含んでしまい、
        // クローン先の単独SVG（親のviewBoxを持たない）には存在しない変換のため使えない。
        const bb = el.getBBox();
        let corners = [
            { x: bb.x,             y: bb.y },
            { x: bb.x + bb.width,  y: bb.y },
            { x: bb.x + bb.width,  y: bb.y + bb.height },
            { x: bb.x,             y: bb.y + bb.height },
        ];
        if (el.transform && el.transform.baseVal.numberOfItems > 0) {
            const m = el.transform.baseVal.consolidate().matrix;
            const svgPt = svgEl.createSVGPoint();
            corners = corners.map(({ x, y }) => {
                svgPt.x = x; svgPt.y = y;
                const p = svgPt.matrixTransform(m);
                return { x: p.x, y: p.y };
            });
        }
        const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
        let minX = Math.min(...xs), maxX = Math.max(...xs);
        let minY = Math.min(...ys), maxY = Math.max(...ys);

        // stroke幅の半分を余白として確保。フキダシはstroke-widthが子要素側にあることが多いため、
        // 要素自身に見つからない場合は小さな固定パディングにフォールバックする
        const strokeW = parseFloat(el.getAttribute('stroke-width') || 0);
        const margin  = strokeW > 0 ? strokeW / 2 : 4;
        minX -= margin; minY -= margin; maxX += margin; maxY += margin;

        const w = Math.max(1, maxX - minX);
        const h = Math.max(1, maxY - minY);

        // 選択要素だけを含む単独SVGを構築してラスタライズする
        const ns = 'http://www.w3.org/2000/svg';
        const clone = el.cloneNode(true);
        clone.classList.remove('selected');
        clone.querySelectorAll('.balloon-handle, .draw-handle, .group-handle, .group-bbox, .group-rotate-line').forEach(h => h.remove());
        clone.removeAttribute('clip-path');

        const outSvg = document.createElementNS(ns, 'svg');
        outSvg.setAttribute('xmlns', ns);
        outSvg.setAttribute('width',  w.toFixed(2));
        outSvg.setAttribute('height', h.toFixed(2));
        outSvg.setAttribute('viewBox', `${minX.toFixed(2)} ${minY.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}`);
        outSvg.appendChild(clone);

        const svgText = new XMLSerializer().serializeToString(outSvg);
        const dataUrl = _svgTextToDataUrl(svgText);

        const img = new Image();
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = dataUrl;
        });

        // レイアウトのSVG座標系はA4全体で21000×29700のような大きな数値系のため、
        // 図形のサイズがそのままだとCanvasの上限サイズを超えて描画が空になることがある。
        const MAX_DIM = 2000;
        const scale = Math.min(1, MAX_DIM / Math.max(w, h));
        const canvas = document.createElement('canvas');
        canvas.width  = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

        const pngDataUrl = canvas.toDataURL('image/png');
        // 元の要素と同じ位置・表示サイズ（SVG user space上、スケールダウン前のw/h）で複製挿入する
        const placement = { x: minX, y: minY, width: w, height: h };
        await insertImage(pngDataUrl, canvas.width, canvas.height, {}, placement);
        return { width: canvas.width, height: canvas.height };
    } catch (err) {
        console.error('画像変換エラー:', err);
        alert(t('common.errorPrefix', err.message));
        return null;
    }
}

// 選択対象（画像 or フキダシ）に応じて反転をディスパッチ
function flipSelected(axis) {
    if (state.selectedImageId) {
        flipSelectedImage(axis);
    } else if (state.selectedShapeId) {
        flipSelectedShape(axis);
    }
}

// 画像（<image>要素）の反転：data-flipH / data-flipV をトグルして transform を再計算
function applyImageTransform(el) {
    const x = parseFloat(el.getAttribute('x') || 0);
    const y = parseFloat(el.getAttribute('y') || 0);
    const w = parseFloat(el.getAttribute('width') || 0);
    const h = parseFloat(el.getAttribute('height') || 0);
    const angle = parseFloat(el.dataset.angle || 0);
    const flipH = el.dataset.flipH === '1';
    const flipV = el.dataset.flipV === '1';

    // 中心座標
    const cx = x + w / 2;
    const cy = y + h / 2;

    // transform の合成: 中心を原点に移動 → 反転 → 回転 → 戻す
    // translate(cx,cy) scale(sh,sv) rotate(angle) translate(-cx,-cy)
    const sh = flipH ? -1 : 1;
    const sv = flipV ? -1 : 1;

    let transforms = [];
    transforms.push(`translate(${cx},${cy})`);
    if (flipH || flipV) transforms.push(`scale(${sh},${sv})`);
    if (angle !== 0) transforms.push(`rotate(${angle})`);
    transforms.push(`translate(${-cx},${-cy})`);

    el.setAttribute('transform', transforms.join(' '));
}

async function flipSelectedImage(axis) {
    const container = getActiveContainer();
    if (!container) return;
    const svgEl = getPanelLayerSvg(container);
    if (!svgEl) return;

    const el = svgEl.querySelector('.inserted-image.selected');
    if (!el) return;

    pushHistory();

    if (axis === 'h') {
        el.dataset.flipH = el.dataset.flipH === '1' ? '0' : '1';
    } else {
        el.dataset.flipV = el.dataset.flipV === '1' ? '0' : '1';
    }

    applyImageTransform(el);
    renderImageHandles(el, svgEl);
    const panelId = el.closest('g[data-clip-panel]')?.getAttribute('data-clip-panel') || state.selectedPanelId || 'panel-0';
    await savePanelSvg(panelId, svgEl);
}

function flipSelectedShape(axis) {
    if (!state.selectedShapeId) return;
    const el = document.getElementById(state.selectedShapeId);
    if (!el) return;

    pushHistory();

    const type = el.dataset.shapeType;
    const isH2 = (type === 'bomb' || type === 'thought' || type === 'normal');

    if (isH2) {
        // h2タイプは tailAngleDeg を反転
        const deg = parseFloat(el.dataset.tailAngleDeg || 45);
        if (axis === 'h') {
            el.dataset.tailAngleDeg = (180 - deg + 360) % 360;
        } else {
            el.dataset.tailAngleDeg = (360 - deg) % 360;
        }
        _updateH2ShapePath(el);
        _updateH2HandlePositions(el);
        const svgEl = el.ownerSVGElement || el.closest('svg');
        if (svgEl) saveShapeSvg(svgEl);
        return;
    }

    const cx = parseFloat(el.dataset.cx);
    const cy = parseFloat(el.dataset.cy);
    const tx = parseFloat(el.dataset.tx);
    const ty = parseFloat(el.dataset.ty);

    if (axis === 'h') {
        // cxを軸にしてtxを反転
        const dx = tx - cx;
        el.dataset.tx = cx - dx;
    } else if (axis === 'v') {
        // cyを軸にしてtyを反転
        const dy = ty - cy;
        el.dataset.ty = cy - dy;
    }

    updateShapePath(el);
    renderHandles(el);
    saveShapeSvg(el.ownerSVGElement);
}

async function insertSmartBalloonTemplate(type) {
    if (!state.activePage) { console.error('[balloon] activePage is null'); return; }

    const container = getActiveContainer();
    if (!container) { console.error('[balloon] container not found'); return; }

    const overlaySvgEl = getPanelLayerSvg(container);
    if (!overlaySvgEl) {
        console.error('[balloon] panel-layer SVG not found');
        return;
    }

    const isTextTab = document.querySelector('.tab-btn.active')?.dataset.tab === 'text';

    pushHistory();

    const viewBox = overlaySvgEl.viewBox.baseVal;
    const cx = viewBox.width / 2;
    const cy = viewBox.height / 2;
    
    let startX = cx, startY = cy;
    let initRx = viewBox.width * 0.15;
    let initRy = viewBox.height * 0.12;
    let tailDist = Math.max(initRx, initRy) * 1.5;

    if (state.selectedPanelId) {
        const panel = state.activePage.panels.find(p => p.id === state.selectedPanelId);
        if (panel) {
            const bbox = getBoundingBoxFromPoints(panel.points);
            startX = bbox.x + bbox.width / 2;
            startY = bbox.y + bbox.height / 2;
            initRx = bbox.width * 0.40;
            initRy = bbox.height * 0.35;
            tailDist = Math.max(initRx, initRy) * 1.5;
        }
    }

    const parent = getOrCreateClipGroup(overlaySvgEl);
    const id = 'shape-' + Date.now();

    const ns = 'http://www.w3.org/2000/svg';
    const shape = document.createElementNS(ns, 'g');
    shape.id = id;
    shape.setAttribute('class', 'balloon-shape');
    shape.dataset.shapeType = type;
    shape.dataset.cx = startX;
    shape.dataset.cy = startY;
    shape.dataset.rx = initRx;
    shape.dataset.ry = initRy;
    shape.dataset.tailAngleDeg     = 45;
    shape.dataset.tailLength       = Math.max(initRx, initRy) * 0.8;
    shape.dataset.tailWidth        = 30;
    shape.dataset.tailCurve        = 0;
    shape.dataset.fillColor        = state.balloon.color;
    shape.dataset.strokeColor      = state.balloon.borderColor;
    shape.dataset.borderWidth      = state.balloon.borderWidth;
    if (type === 'bomb') {
        shape.dataset.seed          = Math.floor(Math.random() * 100) + 1;
        shape.dataset.spikeCount    = 24;
        shape.dataset.spikeLevel    = 30;
        shape.dataset.spikeVariance = 30;
    } else if (type === 'thought') {
        shape.dataset.thoughtBubbleSize   = 800;
        shape.dataset.thoughtBubbleCount  = 5;
        shape.dataset.thoughtBubbleOffset = 100;
    } else if (type === 'rect') {
        shape.dataset.rectRadius = 80;
    }
    shape.style.pointerEvents = 'auto';

    parent.appendChild(shape);
    updateShapePath(shape);

    state.selectedShapeId = id;

    document.querySelectorAll('.balloon-shape').forEach(s => s.classList.remove('selected'));
    shape.classList.add('selected');

    if (!isTextTab) {
        // 挿入後は自動で編集モードをONにしてハンドルを表示
        state.balloon.isEditMode = true;
        updateBalloonUI();
        renderHandles(shape);
    }

    const panelId = shape.closest('g[data-clip-panel]')?.getAttribute('data-clip-panel') || state.selectedPanelId || 'panel-0';
    await savePanelSvg(panelId, overlaySvgEl);
}

function clearHandles() {
    document.querySelectorAll('.balloon-handle, .balloon-bbox, .balloon-rotate-line, .tail-cp-line').forEach(h => h.remove());
    const toImageBtn = document.getElementById('h2-to-image-btn');
    if (toImageBtn) toImageBtn.disabled = true;
}

// 無回転のフキダシ形状(cx,cy,rx,ry)と回転角(度)から、回転後の8ハンドル位置(絶対座標)を計算する。
// SVGのtransform="rotate(angle,cx,cy)"と同じ回転行列(x'=cx+lx*cos-ly*sin, y'=cy+lx*sin+ly*cos)を使うことで、
// フキダシ本体の回転描画とハンドル表示位置を一致させる。
function _balloonGetRotatedHandlePositions(cx, cy, rx, ry, angleDeg) {
    const rad  = angleDeg * Math.PI / 180;
    const cosR = Math.cos(rad), sinR = Math.sin(rad);
    const rot = (lx, ly) => [cx + lx * cosR - ly * sinR, cy + lx * sinR + ly * cosR];
    return {
        nw: rot(-rx, -ry), n: rot(0, -ry), ne: rot(rx, -ry),
        e:  rot(rx, 0),    se: rot(rx, ry), s: rot(0, ry),
        sw: rot(-rx, ry),  w: rot(-rx, 0),
    };
}

// 回転を考慮した回転ハンドル(上辺中央からoffset上)の位置を返す
function _balloonGetRotateHandlePos(cx, cy, ry, angleDeg, offset) {
    const rad  = angleDeg * Math.PI / 180;
    const cosR = Math.cos(rad), sinR = Math.sin(rad);
    const rotTopX = cx + ry * sinR;
    const rotTopY = cy - ry * cosR;
    const rotHx   = rotTopX + offset * sinR;
    const rotHy   = rotTopY - offset * cosR;
    return { rotTopX, rotTopY, rotHx, rotHy };
}

// viewBox座標系でのハンドルサイズを計算（画面上で約8px相当になるよう）
function calcHandleR(svg) {
    const vb = svg.viewBox.baseVal;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !vb.width) return 200;
    const scale = vb.width / rect.width;
    return Math.round(scale * 8);
}

// h2タイプ選択時に専用UIスライダーを同期
function _syncH2UI(el) {
    const setVal = (id, val) => { const e = document.getElementById(id); if (e) e.value = val; };
    const setText = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    const type = el.dataset.shapeType;
    setVal('h2-shape-type', type);
    setVal('h2-tail-angle',  Math.round(parseFloat(el.dataset.tailAngleDeg || 45)));
    setVal('h2-tail-length', Math.round(parseFloat(el.dataset.tailLength   || 60)));
    setVal('h2-tail-width',  Math.round(parseFloat(el.dataset.tailWidth    || 30)));
    const curveVal = Math.round(parseFloat(el.dataset.tailCurve || 0));
    const curveOn = el.dataset.tailCurveOn === '1';
    setVal('h2-tail-curve',  curveVal);
    const cbCurve = document.getElementById('h2-tail-curve-on');
    if (cbCurve) { cbCurve.checked = curveOn; }
    const sliderCurve = document.getElementById('h2-tail-curve');
    if (sliderCurve) sliderCurve.disabled = !curveOn;
    setText('h2-tail-angle-val',  Math.round(parseFloat(el.dataset.tailAngleDeg || 45)) + '°');
    setText('h2-tail-length-val', Math.round(parseFloat(el.dataset.tailLength   || 60)));
    setText('h2-tail-width-val',  Math.round(parseFloat(el.dataset.tailWidth    || 30)) + '°');
    setText('h2-tail-curve-val',  curveVal);
    if (type === 'bomb') {
        setVal('h2-seed',           el.dataset.seed           || 1);
        setVal('h2-spike-count',    el.dataset.spikeCount     || 24);
        setVal('h2-spike-level',    el.dataset.spikeLevel     || 30);
        setVal('h2-spike-variance', el.dataset.spikeVariance  || 30);
        setText('h2-seed-val',           el.dataset.seed           || 1);
        setText('h2-spike-count-val',    el.dataset.spikeCount     || 24);
        setText('h2-spike-level-val',    el.dataset.spikeLevel     || 30);
        setText('h2-spike-variance-val', el.dataset.spikeVariance  || 30);
    } else if (type === 'thought') {
        setVal('h2-thought-bubble',    el.dataset.thoughtBubbleSize || 800);
        setText('h2-thought-bubble-val', el.dataset.thoughtBubbleSize || 800);
        setVal('h2-thought-count',    el.dataset.thoughtBubbleCount ?? 5);
        setText('h2-thought-count-val', el.dataset.thoughtBubbleCount ?? 5);
        setVal('h2-thought-offset',    el.dataset.thoughtBubbleOffset ?? 100);
        setText('h2-thought-offset-val', el.dataset.thoughtBubbleOffset ?? 100);
    } else if (type === 'rect') {
        const rx = parseFloat(el.dataset.rx || 100);
        const ry = parseFloat(el.dataset.ry || 100);
        const maxR = Math.round(Math.min(rx, ry));
        const sliderR = document.getElementById('h2-rect-radius');
        if (sliderR) sliderR.max = maxR;
        setVal('h2-rect-radius',    el.dataset.rectRadius || 80);
        setText('h2-rect-radius-val', Math.round(parseFloat(el.dataset.rectRadius || 80)));
    }
    // 色はrenderHandlesの共通部分で同期済み
}

// h2タイプの尻尾カーブハンドル位置を計算（b1b2中点 + 法線オフセット）。
// ローカル座標系(フキダシ本体の無回転座標系)で計算した後、dataset.angleの回転を適用して
// 表示用の絶対座標に変換する（ハンドルはSVG上でフキダシのtransformの影響を受けない別要素のため）。
function _h2CalcCurveHandlePos(el) {
    const cx = parseFloat(el.dataset.cx), cy = parseFloat(el.dataset.cy);
    const rx = parseFloat(el.dataset.rx), ry = parseFloat(el.dataset.ry);
    const tailAngleDeg = parseFloat(el.dataset.tailAngleDeg || 45);
    const tailWidth    = parseFloat(el.dataset.tailWidth    || 30);
    const tailCurve    = parseFloat(el.dataset.tailCurve    || 0);
    const borderWidth  = parseFloat(el.dataset.borderWidth  || 3);
    const tailAngleRad = tailAngleDeg * Math.PI / 180;
    const normalRad    = tailAngleRad + Math.PI / 2;
    const type = el.dataset.shapeType;
    const bpType = type === 'rect' ? 'rect' : 'normal';
    const bpR = type === 'rect' ? Math.min(parseFloat(el.dataset.rectRadius || 80), rx, ry) : undefined;
    const halfAngleRad = (tailWidth / 2) * Math.PI / 180;
    const b1Rad = tailAngleRad - halfAngleRad;
    const b2Rad = tailAngleRad + halfAngleRad;
    // 尻尾の付け根を本体の内側にどれだけ食い込ませるか。本体と尻尾は別々のpath要素として
    // 縁取りを描画しているため、この食い込みが枠線の太さ(borderWidth)より浅いと、
    // 尻尾が細いほど接合部の縁取りが噛み合わず隙間（細い線）が見えてしまう
    const overlap = Math.max(2, borderWidth + 2);
    const bp1 = _h2_getBoundaryPoint(bpType, rx, ry, b1Rad, bpR);
    const bp2 = _h2_getBoundaryPoint(bpType, rx, ry, b2Rad, bpR);
    const b1x = cx + Math.max(0, bp1.r - overlap) * Math.cos(b1Rad);
    const b1y = cy + Math.max(0, bp1.r - overlap) * Math.sin(b1Rad);
    const b2x = cx + Math.max(0, bp2.r - overlap) * Math.cos(b2Rad);
    const b2y = cy + Math.max(0, bp2.r - overlap) * Math.sin(b2Rad);
    const bMidXLocal = (b1x + b2x) / 2, bMidYLocal = (b1y + b2y) / 2;
    const hxLocal = bMidXLocal + Math.cos(normalRad) * tailCurve;
    const hyLocal = bMidYLocal + Math.sin(normalRad) * tailCurve;

    const angleDeg = parseFloat(el.dataset.angle || 0);
    const rad  = angleDeg * Math.PI / 180;
    const cosR = Math.cos(rad), sinR = Math.sin(rad);
    const rot = (px, py) => [cx + (px - cx) * cosR - (py - cy) * sinR, cy + (px - cx) * sinR + (py - cy) * cosR];
    const [bMidX, bMidY] = rot(bMidXLocal, bMidYLocal);
    const [hx, hy] = rot(hxLocal, hyLocal);

    return { hx, hy, bMidX, bMidY, normalRad: normalRad + rad };
}

// h2タイプのハンドル位置のみ更新（再生成なし）
function _updateH2HandlePositions(el) {
    const svg = el.ownerSVGElement || el.closest('svg');
    if (!svg) return;
    const cx = parseFloat(el.dataset.cx), cy = parseFloat(el.dataset.cy);
    const rx = parseFloat(el.dataset.rx), ry = parseFloat(el.dataset.ry);
    const tailAngleDeg = parseFloat(el.dataset.tailAngleDeg || 45);
    const tailLength   = parseFloat(el.dataset.tailLength   || 60);
    const tailAngleRad = tailAngleDeg * Math.PI / 180;
    const type = el.dataset.shapeType;
    const bpType = type === 'rect' ? 'rect' : 'normal';
    const bpR = type === 'rect' ? Math.min(parseFloat(el.dataset.rectRadius || 80), rx, ry) : undefined;
    const bp = _h2_getBoundaryPoint(bpType, rx, ry, tailAngleRad, bpR);
    const tailDxLocal = bp.x + tailLength * Math.cos(tailAngleRad);
    const tailDyLocal = bp.y + tailLength * Math.sin(tailAngleRad);
    const angle = parseFloat(el.dataset.angle || 0);
    // 尻尾ハンドルもフキダシ本体の回転(dataset.angle)を考慮した絶対座標に変換する
    const angleRad0 = angle * Math.PI / 180;
    const tailTipX = cx + tailDxLocal * Math.cos(angleRad0) - tailDyLocal * Math.sin(angleRad0);
    const tailTipY = cy + tailDxLocal * Math.sin(angleRad0) + tailDyLocal * Math.cos(angleRad0);

    const bboxEl = svg.querySelector('.balloon-bbox');
    if (bboxEl) {
        bboxEl.setAttribute('x', cx - rx); bboxEl.setAttribute('y', cy - ry);
        bboxEl.setAttribute('width', rx * 2); bboxEl.setAttribute('height', ry * 2);
        if (angle) bboxEl.setAttribute('transform', `rotate(${angle},${cx},${cy})`);
        else bboxEl.removeAttribute('transform');
    }
    const positions = _balloonGetRotatedHandlePositions(cx, cy, rx, ry, angle);
    positions.tail = [tailTipX, tailTipY];

    const vb = svg.viewBox.baseVal;
    const rect = svg.getBoundingClientRect();
    const scale = rect.width ? vb.width / rect.width : 1;
    const strokeW = Math.round(scale * 1.5);
    const offset = strokeW * 16;
    const { rotTopX, rotTopY, rotHx, rotHy } = _balloonGetRotateHandlePos(cx, cy, ry, angle, offset);
    positions.rotate = [rotHx, rotHy];

    for (const [t, [hx, hy]] of Object.entries(positions)) {
        const h = svg.querySelector(`.balloon-handle[data-handle-type="${t}"]`);
        if (h) { h.setAttribute('cx', hx); h.setAttribute('cy', hy); }
    }
    const rotLine = svg.querySelector('.balloon-rotate-line');
    if (rotLine) {
        rotLine.setAttribute('x1', rotTopX); rotLine.setAttribute('y1', rotTopY);
        rotLine.setAttribute('x2', rotHx);   rotLine.setAttribute('y2', rotHy);
    }

    // カーブハンドル更新
    if (type !== 'thought' && type !== 'bomb') {
        const cp = _h2CalcCurveHandlePos(el);
        const cpH = svg.querySelector('.balloon-handle[data-handle-type="h2-curve"]');
        if (cpH) { cpH.setAttribute('cx', cp.hx); cpH.setAttribute('cy', cp.hy); }
        const cpLine = svg.querySelector('.h2-curve-line');
        if (cpLine) {
            cpLine.setAttribute('x1', cp.bMidX); cpLine.setAttribute('y1', cp.bMidY);
            cpLine.setAttribute('x2', cp.hx);   cpLine.setAttribute('y2', cp.hy);
        }
    }
}

function renderHandles(el) {
    clearHandles();
    const svg = el.ownerSVGElement || el.closest('svg');
    if (!svg) return;

    svg.style.pointerEvents = 'all';

    document.querySelectorAll('.balloon-shape').forEach(s => s.classList.remove('selected'));
    el.classList.add('selected');

    const toImageBtn = document.getElementById('h2-to-image-btn');
    if (toImageBtn) toImageBtn.disabled = false;

    const type = el.dataset.shapeType;
    const isH2 = (type === 'bomb' || type === 'thought' || type === 'normal' || type === 'rect');

    // 選択シェイプの色・太さを UI に同期
    let strokeVal, fillVal, strokeWVal;
    if (isH2) {
        strokeVal  = el.dataset.strokeColor  || '#000000';
        fillVal    = el.dataset.fillColor    || '#ffffff';
        strokeWVal = parseFloat(el.dataset.borderWidth || state.balloon.borderWidth);
        // h2専用UIも同期
        _syncH2UI(el);
        _showH2TypeParams(type);
    } else {
        _showH2TypeParams(null); // h2パラメータパネルを非表示
        strokeVal  = el.getAttribute('stroke');
        fillVal    = el.getAttribute('fill');
        strokeWVal = parseFloat(el.getAttribute('stroke-width') || state.balloon.borderWidth);
    }
    if (strokeVal) {
        state.balloon.borderColor = strokeVal;
        const bc = document.getElementById('border-color');
        if (bc) bc.value = strokeVal;
        const bcS = document.getElementById('border-color-serif');
        if (bcS) bcS.value = strokeVal;
    }
    if (fillVal) {
        state.balloon.color = fillVal;
        const fc = document.getElementById('box-color');
        if (fc) fc.value = fillVal;
        const fcS = document.getElementById('box-color-serif');
        if (fcS) fcS.value = fillVal;
    }
    state.balloon.borderWidth = strokeWVal;
    const bw = document.getElementById('border-width');
    if (bw) bw.value = strokeWVal;
    const bwS = document.getElementById('border-width-serif');
    if (bwS) bwS.value = strokeWVal;

    const cx = parseFloat(el.dataset.cx);
    const cy = parseFloat(el.dataset.cy);
    const rx = parseFloat(el.dataset.rx);
    const ry = parseFloat(el.dataset.ry);
    const x1 = cx - rx, y1 = cy - ry, x2 = cx + rx, y2 = cy + ry;

    // 尻尾先端XY（tailAngleDeg+tailLength から計算）。フキダシ本体の回転(dataset.angle)を
    // 考慮した絶対座標に変換する（ハンドルはフキダシのtransformの影響を受けない別要素のため）
    const tailAngleDeg = parseFloat(el.dataset.tailAngleDeg || 45);
    const tailLength   = parseFloat(el.dataset.tailLength   || 60);
    const tailAngleRad = tailAngleDeg * Math.PI / 180;
    const bpType = type === 'rect' ? 'rect' : 'normal';
    const bpR = type === 'rect' ? Math.min(parseFloat(el.dataset.rectRadius || 80), rx, ry) : undefined;
    const bp = _h2_getBoundaryPoint(bpType, rx, ry, tailAngleRad, bpR);
    const balloonAngle0 = parseFloat(el.dataset.angle || 0);
    const balloonRad0 = balloonAngle0 * Math.PI / 180;
    const tailDxLocal = bp.x + tailLength * Math.cos(tailAngleRad);
    const tailDyLocal = bp.y + tailLength * Math.sin(tailAngleRad);
    const tx = cx + tailDxLocal * Math.cos(balloonRad0) - tailDyLocal * Math.sin(balloonRad0);
    const ty = cy + tailDxLocal * Math.sin(balloonRad0) + tailDyLocal * Math.cos(balloonRad0);

    const vb = svg.viewBox.baseVal;
    const rect = svg.getBoundingClientRect();
    const scale = rect.width ? vb.width / rect.width : 1;
    const strokeW = Math.round(scale * 1.5);

    // バウンディングボックス線（回転するフキダシに追従させる）
    const bboxEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bboxEl.setAttribute('x', x1);
    bboxEl.setAttribute('y', y1);
    bboxEl.setAttribute('width', rx * 2);
    bboxEl.setAttribute('height', ry * 2);
    bboxEl.setAttribute('class', 'balloon-bbox');
    bboxEl.setAttribute('stroke-width', strokeW);
    bboxEl.style.pointerEvents = 'none';
    if (balloonAngle0) bboxEl.setAttribute('transform', `rotate(${balloonAngle0},${cx},${cy})`);
    svg.appendChild(bboxEl);

    // 8点リサイズハンドル。回転を考慮した位置に配置する
    const rotatedPts = _balloonGetRotatedHandlePositions(cx, cy, rx, ry, balloonAngle0);
    ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach(hType => {
        const [hx, hy] = rotatedPts[hType];
        createHandle(svg, hType, hx, hy, `resize-handle resize-${hType}`);
    });

    // しっぽハンドル
    createHandle(svg, 'tail', tx, ty, 'tail-handle');

    if (isH2) {
        // h2タイプ: normal/rect はカーブON時のみカーブハンドルを表示
        if (type !== 'thought' && type !== 'bomb' && el.dataset.tailCurveOn === '1') {
            const cp = _h2CalcCurveHandlePos(el);
            // 接続線: b1b2中点 → カーブハンドル
            const cpLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            cpLine.setAttribute('x1', cp.bMidX); cpLine.setAttribute('y1', cp.bMidY);
            cpLine.setAttribute('x2', cp.hx);   cpLine.setAttribute('y2', cp.hy);
            cpLine.setAttribute('class', 'h2-curve-line tail-cp-line');
            cpLine.setAttribute('stroke-width', strokeW);
            cpLine.style.pointerEvents = 'none';
            svg.appendChild(cpLine);
            createHandle(svg, 'h2-curve', cp.hx, cp.hy, 'tail-cp-handle h2-curve-handle');
        }
    }

    // 回転ハンドル（上辺中央から offset 上に配置、フキダシの回転角を考慮）
    const balloonOffset = strokeW * 16; // strokeWはscale*1.5なのでstrokeW*16≈scale*24
    const { rotTopX, rotTopY, rotHx, rotHy } = _balloonGetRotateHandlePos(cx, cy, ry, balloonAngle0, balloonOffset);

    const rotateLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    rotateLine.setAttribute('x1', rotTopX); rotateLine.setAttribute('y1', rotTopY);
    rotateLine.setAttribute('x2', rotHx); rotateLine.setAttribute('y2', rotHy);
    rotateLine.setAttribute('class', 'balloon-rotate-line');
    rotateLine.setAttribute('stroke-width', strokeW);
    rotateLine.style.pointerEvents = 'none';
    svg.appendChild(rotateLine);
    createHandle(svg, 'rotate', rotHx, rotHy, 'rotate-handle');

    renderLayerPanel();
}

function createHandle(svg, type, x, y, className) {
    const r = calcHandleR(svg);
    const strokeW = Math.round(r * 0.25);
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', x);
    circle.setAttribute('cy', y);
    circle.setAttribute('r', r);
    circle.setAttribute('stroke-width', strokeW);
    circle.setAttribute('class', `balloon-handle ${className}`);
    circle.style.pointerEvents = 'auto';
    circle.dataset.handleType = type;
    svg.appendChild(circle);
}

