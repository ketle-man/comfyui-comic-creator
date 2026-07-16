// ============================================================
// フキダシ管理 分割ファイル (4/5): フキダシツール初期化・テキストハンドル・フォント選択
// 元 09-balloons.js（分割前）の行 1872-2354 に相当
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: _loadFavoriteFontsToSelect,_loadGoogleFontsToSelect,_syncFontFavCatSelect,clearTextHandles,initBalloonTools,loadSystemFontsToSelect,renderTextHandles,syncFontFamilyUI
// ============================================================

// document登録リスナー参照（renderLayoutTab()経由の再初期化で積み上がらないよう保持）
let _balloonToolsDocMouseMove = null;
let _balloonToolsDocMouseUp = null;

function initBalloonTools(overlaySvgEl, _panelSvgEl) {
    if (!overlaySvgEl) return;
    if (_balloonToolsDocMouseMove) { document.removeEventListener('mousemove', _balloonToolsDocMouseMove); _balloonToolsDocMouseMove = null; }
    if (_balloonToolsDocMouseUp)   { document.removeEventListener('mouseup', _balloonToolsDocMouseUp); _balloonToolsDocMouseUp = null; }
    let isDragging = false;
    let dragTarget = null;
    let targetShape = null;
    let startX, startY;
    let startCx, startCy, startRx, startRy;
    let startAngle = 0, startAngleRad = 0;

    const getSvgPt = (clientX, clientY) => {
        const pt = overlaySvgEl.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        return pt.matrixTransform(overlaySvgEl.getScreenCTM().inverse());
    };

    overlaySvgEl.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        const pt = getSvgPt(e.clientX, e.clientY);

        // 編集モード
        if (state.balloon.isEditMode) {
            const handle = e.target.closest('.balloon-handle');
            if (handle) {
                e.preventDefault();
                e.stopPropagation();
                isDragging = true;
                dragTarget = handle.dataset.handleType;
                targetShape = document.getElementById(state.selectedShapeId);
                startCx = parseFloat(targetShape.dataset.cx);
                startCy = parseFloat(targetShape.dataset.cy);
                startRx = parseFloat(targetShape.dataset.rx);
                startRy = parseFloat(targetShape.dataset.ry);
                startAngle = parseFloat(targetShape.dataset.angle || 0);
                if (dragTarget === 'rotate') {
                    startAngleRad = Math.atan2(pt.y - startCy, pt.x - startCx);
                } else {
                    startX = pt.x;
                    startY = pt.y;
                }
                return;
            }

            // シェイプ自体をクリックして選択
            const shape = e.target.closest('.balloon-shape');
            if (shape) {
                if (shape.closest('[data-group-id]')) return; // グループ内はグループ操作に委ねる
                if (_isObjectLocked(shape)) return; // ロック中は操作不可
                e.preventDefault();
                e.stopPropagation();
                state.selectedShapeId = shape.id;
                state.selectedDrawId  = null;
                state.selectedDrawEl  = null;
                clearDrawShapeHandles(overlaySvgEl);
                renderHandles(shape);
                renderLayerPanel();
                return;
            }

            // 何もないところをクリックで解除
            state.selectedShapeId = null;
            clearHandles();
            renderLayerPanel();
            return;
        }

    });

    _balloonToolsDocMouseMove = (e) => {
        if (!isDragging || !targetShape) return;
        const pt = getSvgPt(e.clientX, e.clientY);

        if (dragTarget === 'create') {
            const rx = Math.abs(pt.x - startX);
            const ry = Math.abs(pt.y - startY);
            targetShape.dataset.rx = rx;
            targetShape.dataset.ry = ry;
            updateShapePath(targetShape);
        } else if (dragTarget === 'tail') {
            // h2タイプ: 尻尾先端位置から角度と長さを計算
            const tsCx = parseFloat(targetShape.dataset.cx);
            const tsCy = parseFloat(targetShape.dataset.cy);
            const tsRx = parseFloat(targetShape.dataset.rx);
            const tsRy = parseFloat(targetShape.dataset.ry);
            const tsType = targetShape.dataset.shapeType;
            // 回転を考慮: マウス位置(グローバル座標)をフキダシのローカル座標系(無回転)へ逆回転する
            // （tailAngleDegはフキダシ本体の無回転座標系での角度のため）
            const tsAngle = parseFloat(targetShape.dataset.angle || 0);
            const tsRad = tsAngle * Math.PI / 180;
            const cosR = Math.cos(tsRad), sinR = Math.sin(tsRad);
            const dxG = pt.x - tsCx, dyG = pt.y - tsCy;
            const dx = dxG * cosR + dyG * sinR;
            const dy = -dxG * sinR + dyG * cosR;
            const newAngleDeg = Math.atan2(dy, dx) * 180 / Math.PI;
            const tailAngleRad2 = newAngleDeg * Math.PI / 180;
            const tsBpType = tsType === 'rect' ? 'rect' : 'normal';
            const tsBpR = tsType === 'rect' ? Math.min(parseFloat(targetShape.dataset.rectRadius || 80), tsRx, tsRy) : undefined;
            const bp2 = _h2_getBoundaryPoint(tsBpType, tsRx, tsRy, tailAngleRad2, tsBpR);
            const distFromCenter = Math.hypot(dx, dy);
            const distFromBoundary = Math.hypot(bp2.x, bp2.y);
            const newLength = Math.max(0, distFromCenter - distFromBoundary);
            targetShape.dataset.tailAngleDeg = newAngleDeg;
            targetShape.dataset.tailLength   = newLength;
            _updateH2ShapePath(targetShape);
            _updateH2HandlePositions(targetShape);
        } else if (dragTarget === 'h2-curve') {
            // h2タイプカーブハンドル: ドラッグ位置からb1b2中点への法線投影でtailCurveを更新
            const cp = _h2CalcCurveHandlePos(targetShape);
            // ドラッグ点をnormalRad方向に投影
            const dx = pt.x - cp.bMidX, dy = pt.y - cp.bMidY;
            const newCurve = dx * Math.cos(cp.normalRad) + dy * Math.sin(cp.normalRad);
            targetShape.dataset.tailCurve = Math.round(newCurve);
            _updateH2ShapePath(targetShape);
            _updateH2HandlePositions(targetShape);
            // スライダー・テキストUI同期
            const curveSlider = document.getElementById('h2-tail-curve');
            if (curveSlider) { curveSlider.value = Math.round(newCurve); }
            const curveVal = document.getElementById('h2-tail-curve-val');
            if (curveVal) curveVal.textContent = Math.round(newCurve);
        } else if (dragTarget === 'rotate') {
            const currentRad = Math.atan2(pt.y - startCy, pt.x - startCx);
            const deltaDeg = (currentRad - startAngleRad) * 180 / Math.PI;
            const newAngle = startAngle + deltaDeg;
            targetShape.dataset.angle = newAngle;
            _updateH2ShapePath(targetShape);
            _updateH2HandlePositions(targetShape);
        } else {
            // 8方向リサイズ（反対側の辺/角を固定してリサイズ）
            let cx = startCx, cy = startCy, rx = startRx, ry = startRy;

            // 回転を考慮: マウス位置(グローバル座標)をフキダシのローカル座標系(無回転)へ逆回転する
            const rad  = startAngle * Math.PI / 180;
            const cosR = Math.cos(rad), sinR = Math.sin(rad);
            const dxG = pt.x - startCx, dyG = pt.y - startCy;
            const localPt = {
                x: startCx + (dxG * cosR + dyG * sinR),
                y: startCy + (-dxG * sinR + dyG * cosR),
            };

            const fixedSide = {
                se: [startCx - startRx, startCy - startRy],
                sw: [startCx + startRx, startCy - startRy],
                ne: [startCx - startRx, startCy + startRy],
                nw: [startCx + startRx, startCy + startRy],
                e:  [startCx - startRx, null],
                w:  [startCx + startRx, null],
                s:  [null, startCy - startRy],
                n:  [null, startCy + startRy],
            }[dragTarget];

            if (fixedSide) {
                rx = Math.max(10, startRx);
                ry = Math.max(10, startRy);
                if (dragTarget === 'se') {
                    rx = Math.max(10, (localPt.x - fixedSide[0]) / 2);
                    ry = Math.max(10, (localPt.y - fixedSide[1]) / 2);
                    cx = fixedSide[0] + rx;
                    cy = fixedSide[1] + ry;
                } else if (dragTarget === 'sw') {
                    rx = Math.max(10, (fixedSide[0] - localPt.x) / 2);
                    ry = Math.max(10, (localPt.y - fixedSide[1]) / 2);
                    cx = fixedSide[0] - rx;
                    cy = fixedSide[1] + ry;
                } else if (dragTarget === 'ne') {
                    rx = Math.max(10, (localPt.x - fixedSide[0]) / 2);
                    ry = Math.max(10, (fixedSide[1] - localPt.y) / 2);
                    cx = fixedSide[0] + rx;
                    cy = fixedSide[1] - ry;
                } else if (dragTarget === 'nw') {
                    rx = Math.max(10, (fixedSide[0] - localPt.x) / 2);
                    ry = Math.max(10, (fixedSide[1] - localPt.y) / 2);
                    cx = fixedSide[0] - rx;
                    cy = fixedSide[1] - ry;
                } else if (dragTarget === 'e') {
                    rx = Math.max(10, (localPt.x - fixedSide[0]) / 2);
                    cx = fixedSide[0] + rx;
                    cy = startCy;
                } else if (dragTarget === 'w') {
                    rx = Math.max(10, (fixedSide[0] - localPt.x) / 2);
                    cx = fixedSide[0] - rx;
                    cy = startCy;
                } else if (dragTarget === 's') {
                    ry = Math.max(10, (localPt.y - fixedSide[1]) / 2);
                    cy = fixedSide[1] + ry;
                    cx = startCx;
                } else if (dragTarget === 'n') {
                    ry = Math.max(10, (fixedSide[1] - localPt.y) / 2);
                    cy = fixedSide[1] - ry;
                    cx = startCx;
                }

                if (startAngle) {
                    // ローカル座標系での中心移動量を回転してグローバル座標系に変換し、
                    // 回転中心(=フキダシの中心)が正しい位置に来るよう補正する
                    const dcxLocal = cx - startCx, dcyLocal = cy - startCy;
                    const dcxGlobal = dcxLocal * cosR - dcyLocal * sinR;
                    const dcyGlobal = dcxLocal * sinR + dcyLocal * cosR;
                    cx = startCx + dcxGlobal;
                    cy = startCy + dcyGlobal;
                }

                targetShape.dataset.cx = cx;
                targetShape.dataset.cy = cy;
                targetShape.dataset.rx = rx;
                targetShape.dataset.ry = ry;
            }

            _updateH2ShapePath(targetShape);
            _updateH2HandlePositions(targetShape);
        }
    };
    document.addEventListener('mousemove', _balloonToolsDocMouseMove);

    const finishDrag = async () => {
        if (isDragging) {
            isDragging = false;
            const shape = targetShape;
            const dt = dragTarget;
            dragTarget = null;
            targetShape = null;
            if (state.balloon.isEditMode && state.selectedShapeId) {
                // リサイズ/tail完了後にハンドルを正確に再描画
                const s = document.getElementById(state.selectedShapeId);
                if (s) renderHandles(s);
            }
            const finishedShape = shape || document.getElementById(state.selectedShapeId);
            const panelId = finishedShape?.closest('g[data-clip-panel]')?.getAttribute('data-clip-panel') || state.selectedPanelId || 'panel-0';
            await savePanelSvg(panelId, overlaySvgEl);
        }
    };

    overlaySvgEl.addEventListener('mouseup', finishDrag);
    _balloonToolsDocMouseUp = finishDrag;
    document.addEventListener('mouseup', _balloonToolsDocMouseUp);
}

// ------------------------------------------------------------
// テキストハンドルユーティリティ
// ------------------------------------------------------------

function clearTextHandles(svgEl) {
    const root = svgEl || document;
    root.querySelectorAll('.text-handle, .text-bbox, .text-rotate-line').forEach(h => h.remove());
}

function renderTextHandles(el, svgEl) {
    clearTextHandles(svgEl);
    el.classList.add('selected');

    const bb = el.getBBox();
    const angle = parseFloat(el.dataset.angle || 0);
    const cx = bb.x + bb.width / 2;
    const cy = bb.y + bb.height / 2;
    // transform から cx/cy を実際の中心にするため、回転中心も getBBox 中心を使う
    el.setAttribute('transform', `rotate(${angle},${cx},${cy})`);
    el.dataset.bboxCx = cx;
    el.dataset.bboxCy = cy;

    const vb = svgEl.viewBox.baseVal;
    const rect = svgEl.getBoundingClientRect();
    const scale = rect.width ? vb.width / rect.width : 1;
    const r = Math.round(scale * 8);
    const strokeW = Math.round(scale * 1.5);

    // バウンディングボックス（回転を考慮して transform グループに入れる）
    const bboxEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bboxEl.setAttribute('x', bb.x);
    bboxEl.setAttribute('y', bb.y);
    bboxEl.setAttribute('width', bb.width);
    bboxEl.setAttribute('height', bb.height);
    bboxEl.setAttribute('class', 'text-bbox');
    bboxEl.setAttribute('stroke-width', strokeW);
    bboxEl.setAttribute('transform', `rotate(${angle},${cx},${cy})`);
    bboxEl.style.pointerEvents = 'none';
    svgEl.appendChild(bboxEl);

    // 8点リサイズハンドルの回転前座標
    const x1 = bb.x, y1 = bb.y, x2 = bb.x + bb.width, y2 = bb.y + bb.height;
    const rad = angle * Math.PI / 180;
    const rotPt = (px, py) => ({
        x: cx + (px - cx) * Math.cos(rad) - (py - cy) * Math.sin(rad),
        y: cy + (px - cx) * Math.sin(rad) + (py - cy) * Math.cos(rad)
    });

    const pts = [
        ['nw', x1, y1], ['n', cx, y1], ['ne', x2, y1],
        ['e', x2, cy], ['se', x2, y2], ['s', cx, y2],
        ['sw', x1, y2], ['w', x1, cy]
    ];
    pts.forEach(([type, hx, hy]) => {
        const rp = rotPt(hx, hy);
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', rp.x);
        circle.setAttribute('cy', rp.y);
        circle.setAttribute('r', r);
        circle.setAttribute('stroke-width', Math.round(r * 0.25));
        circle.setAttribute('class', `text-handle resize-handle resize-${type}`);
        circle.style.pointerEvents = 'auto';
        circle.dataset.handleType = type;
        svgEl.appendChild(circle);
    });

    // 回転ハンドル（上辺中央から offset 上）
    const offset = scale * 24;
    const topMid = rotPt(cx, y1);
    const rotHx = topMid.x + Math.sin(rad) * offset;
    const rotHy = topMid.y - Math.cos(rad) * offset;

    const rotateLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    rotateLine.setAttribute('x1', topMid.x); rotateLine.setAttribute('y1', topMid.y);
    rotateLine.setAttribute('x2', rotHx); rotateLine.setAttribute('y2', rotHy);
    rotateLine.setAttribute('class', 'text-rotate-line');
    rotateLine.setAttribute('stroke-width', strokeW);
    rotateLine.style.pointerEvents = 'none';
    svgEl.appendChild(rotateLine);

    const rotateCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    rotateCircle.setAttribute('cx', rotHx);
    rotateCircle.setAttribute('cy', rotHy);
    rotateCircle.setAttribute('r', r);
    rotateCircle.setAttribute('stroke-width', Math.round(r * 0.25));
    rotateCircle.setAttribute('class', 'text-handle rotate-handle');
    rotateCircle.style.pointerEvents = 'auto';
    rotateCircle.dataset.handleType = 'rotate';
    svgEl.appendChild(rotateCircle);
}

// ------------------------------------------------------------
// システムフォント読み込み（Local Font Access API）
// ------------------------------------------------------------

async function loadSystemFontsToSelect() {
    const sel = document.getElementById('font-family');
    if (!sel) return;

    // 既存のシステムグループを削除
    const existing = document.getElementById('font-group-system');
    if (existing) existing.remove();

    const grp = document.createElement('optgroup');
    grp.id = 'font-group-system';
    grp.label = t('fontsel.systemGroup');

    if (!window.queryLocalFonts) {
        const opt = document.createElement('option');
        opt.textContent = t('fontsel.noLocalFontApi');
        opt.disabled = true;
        grp.appendChild(opt);
        sel.appendChild(grp);
        return;
    }

    try {
        const fonts = await window.queryLocalFonts();
        const families = [...new Set(fonts.map(f => f.family))].sort((a, b) => a.localeCompare(b));
        families.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            grp.appendChild(opt);
        });
        sel.appendChild(grp);
    } catch (err) {
        const opt = document.createElement('option');
        opt.textContent = t('fontsel.fetchFailed', err.message);
        opt.disabled = true;
        grp.appendChild(opt);
        sel.appendChild(grp);
    }
}

// レイアウトタブ #font-family の「Google Fonts」optgroupを、フォント管理タブと共通の
// GOOGLE_FONT_FAMILIES（index.htmlのGoogle Fonts linkタグと同期済み）から動的生成する
function _loadGoogleFontsToSelect() {
    const grp = document.getElementById('font-group-google');
    if (!grp) return;
    grp.innerHTML = '';
    _fontMgrGoogleList().forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        grp.appendChild(opt);
    });
}

// レイアウトタブ #font-fav-cat-select を _fontMgr.favorites のカテゴリ一覧で同期する
// （フォント管理タブでの追加/削除・カテゴリ作成にも都度追従させるため呼び出し側で _fontMgrLoad() 済みが前提）
function _syncFontFavCatSelect() {
    const sel = document.getElementById('font-fav-cat-select');
    if (!sel) return;
    const cats = _fontMgrCatNames();
    const current = sel.value;
    sel.innerHTML = `<option value="">${t('layout.fontCatAll')}</option>`;
    cats.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = _fontMgrCatLabel(cat);
        sel.appendChild(opt);
    });
    if (cats.includes(current)) sel.value = current;
}

// レイアウトタブ #font-family の「お気に入り」optgroupを、指定カテゴリ（空文字なら全カテゴリ統合）で生成する
function _loadFavoriteFontsToSelect(category) {
    const sel = document.getElementById('font-family');
    if (!sel) return;
    const existing = document.getElementById('font-group-favorites');
    if (existing) existing.remove();

    const grp = document.createElement('optgroup');
    grp.id = 'font-group-favorites';
    grp.label = t('layout.fontTabCategory');

    const cats = category ? [category] : Object.keys(_fontMgr.favorites);
    const names = [...new Set(cats.flatMap(c => _fontMgr.favorites[c] || []))].sort((a, b) => a.localeCompare(b));

    if (names.length === 0) {
        const opt = document.createElement('option');
        opt.textContent = t('fontsel.noCategoryFonts');
        opt.disabled = true;
        grp.appendChild(opt);
    } else {
        names.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            grp.appendChild(opt);
        });
    }
    sel.appendChild(grp);
}

// 選択テキスト要素のfont-familyをUIのセレクトボックスに同期する
function syncFontFamilyUI(textEl) {
    // 縦書き状態もUIに同期（再編集や縦書きチェック切替が選択中テキストの実状態とズレないように）
    const isVertical = textEl.getAttribute('writing-mode') === 'tb';
    state.balloon.isVertical = isVertical;
    const vertCheck = document.getElementById('text-vertical');
    if (vertCheck) vertCheck.checked = isVertical;

    const ff = textEl.getAttribute('font-family');
    if (!ff) return;
    state.balloon.fontFamily = ff;
    const sel = document.getElementById('font-family');
    if (!sel) return;
    // セレクトに存在する値なら同期、なければそのまま（システムフォント未読込の場合など）
    sel.value = ff;

    // 色もUIに同期（プリセット＝黒/白/赤/青に一致する場合のみ。任意色はスタイルモーダル側で扱う）
    const fill = textEl.getAttribute('fill') || '#000000';
    state.balloon.textColor = fill;
    const colorPreset = document.getElementById('color-preset');
    if (colorPreset) {
        const presetValues = Array.from(colorPreset.options).map(o => o.value);
        if (presetValues.includes(fill)) colorPreset.value = fill;
    }
}

// ------------------------------------------------------------
// テキスト編集ツール
// ------------------------------------------------------------

