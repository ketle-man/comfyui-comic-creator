// ============================================================
// main.js 分割ファイル (9/24): パネル操作+画像操作+画像挿入
// 元 main.js の行 5898-6844 に相当
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: _clearObjectSelection,clearImageHandles,getBoundingBoxFromPoints,getStrokeWidthFromElement,handleInsertImageFromLocal,highlightOverlay,initDragAndDrop,initImageManipulation,initPanelsOnSvg,insertImage,insertImageFromUrl,insertImageToOverlay,renderImageHandles,selectPanel,updateImageHandlePositions,updatePanelSelectDropdown
// ============================================================

// ==============================
// パネル操作（変更なし）
// ==============================

// SVG要素からstroke-widthを取得（style属性 > 直接属性 > CSSクラス定義の順で検索）
function getStrokeWidthFromElement(el) {
    // inline style属性内の stroke-width を優先
    const style = el.getAttribute('style') || '';
    const styleMatch = style.match(/stroke-width\s*:\s*([\d.]+)/);
    if (styleMatch) return parseFloat(styleMatch[1]);
    // 直接属性
    const attr = el.getAttribute('stroke-width');
    if (attr) return parseFloat(attr);
    // CSSクラス経由: 同一SVGドキュメント内の<style>タグからクラス定義を探す
    const classAttr = el.getAttribute('class') || '';
    if (classAttr) {
        const svgEl = el.closest('svg');
        const styleTag = svgEl && svgEl.querySelector('style');
        if (styleTag) {
            const cssText = styleTag.textContent || '';
            for (const cls of classAttr.split(/\s+/)) {
                const re = new RegExp(`\\.${cls}\\s*\\{[^}]*stroke-width\\s*:\\s*([\\d.]+)`, 'i');
                const m = cssText.match(re);
                if (m) return parseFloat(m[1]);
            }
        }
    }
    return 0;
}

function initPanelsOnSvg(svgEl) {
    if (!state.activePage.panels) return;

    // 既存のoverlay/border要素を除去
    svgEl.querySelectorAll('.panel-overlay, .panel-border').forEach(el => el.remove());

    state.activePage.panels.forEach(panel => {
        if (!panel.points) return;

        // --- クリック検出用 overlay（最背面・視覚効果なし）---
        const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        overlay.setAttribute('points', panel.points);
        overlay.setAttribute('class', 'panel-overlay');
        overlay.setAttribute('data-panel-id', panel.id);
        overlay.setAttribute('fill', 'transparent');
        overlay.setAttribute('stroke', 'none');
        overlay.setAttribute('stroke-width', '0');
        overlay.style.cursor = 'pointer';

        overlay.addEventListener('click', (e) => {
            if (state.balloon.isTextMode) return;
            e.stopPropagation();
            selectPanel(panel.id);
        });

        // defsの直後（コンテンツg要素より背面）に挿入
        const defsEl = svgEl.querySelector('defs');
        if (defsEl && defsEl.nextSibling) {
            svgEl.insertBefore(overlay, defsEl.nextSibling);
        } else {
            svgEl.appendChild(overlay);
        }

        // --- 枠線・ハイライト用 border（最前面）---
        const border = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        border.setAttribute('points', panel.points);
        border.setAttribute('class', 'panel-border');
        border.setAttribute('data-panel-id', panel.id);
        border.setAttribute('fill', 'none');
        border.style.pointerEvents = 'none'; // クリックを透過

        const isSelected = state.selectedPanelId === panel.id;
        border.setAttribute('stroke', isSelected ? state.panelBorder.activeColor : 'none');
        border.setAttribute('stroke-width', String(state.panelBorder.width));

        svgEl.appendChild(border); // 最前面
    });

    // オーバーレイg要素（data-overlay-layer）が存在する場合、全 panel-border の後（最前面）に移動する
    // 描画順: ... コンテンツg ... → g[data-overlay-layer] → panel-border（選択ハイライト）
    // ※ panel-border は pointer-events=none なのでクリックを透過し、オーバーレイコンテンツの操作を妨げない
    const overlayG = svgEl.querySelector('g[data-overlay-layer]');
    if (overlayG) {
        svgEl.appendChild(overlayG); // 全 panel-border の後（最前面）に移動
        // さらに panel-border を再 appendChild して最前面を確保
        svgEl.querySelectorAll('.panel-border').forEach(b => svgEl.appendChild(b));
    }
}

function highlightOverlay(svgEl, panelId) {
    svgEl.querySelectorAll('.panel-border').forEach(poly => {
        const isSelected = poly.getAttribute('data-panel-id') === panelId;
        poly.setAttribute('stroke', isSelected ? state.panelBorder.activeColor : 'none');
        poly.setAttribute('stroke-width', String(state.panelBorder.width));
    });
}

// コマ/オーバーレイ選択時にオブジェクト選択をすべて解除する
function _clearObjectSelection() {
    const svgEl = getPanelLayerSvg();
    state.selectedImageEl  = null;
    state.selectedImageId  = null;
    state.selectedShapeId  = null;
    state.selectedTextEl   = null;
    state.selectedGroupId  = null;
    state.selectedDrawId   = null;
    state.selectedDrawEl   = null;
    state.balloon.isEditMode = false;
    updateBalloonUI();
    clearHandles();
    clearImageHandles();
    if (svgEl) {
        clearTextHandles(svgEl);
        clearDrawShapeHandles(svgEl);
    }
    clearGroupHandles();
}

function selectPanel(panelId) {
    // オーバーレイ選択
    if (panelId === '__overlay__') {
        selectOverlay();
        return;
    }
    _clearObjectSelection();
    state.selectedPanelId = panelId;
    state.selectedOverlay = false;
    updatePanelSelectDropdown();

    const previewContainer = document.getElementById('layout-preview');
    if (!previewContainer) return;

    const svgEl = previewContainer.querySelector('svg');
    if (svgEl) {
        highlightOverlay(svgEl, panelId);
        renderLayerPanel();
    } else {
        renderLayoutTab();
    }
}

function updatePanelSelectDropdown() {
    const selects = [
        document.getElementById('panel-select'),
        document.getElementById('text-panel-select')
    ];
    selects.forEach(select => {
        if (!select) return;
        select.innerHTML = '';
        if (state.activePage && state.activePage.panels) {
            state.activePage.panels.forEach(panel => {
                const option = document.createElement('option');
                option.value = panel.id;
                const num = (panel.number !== undefined) ? panel.number : state.activePage.panels.indexOf(panel) + 1;
                option.textContent = t('common.panelName', num);
                if (state.selectedPanelId === panel.id) option.selected = true;
                select.appendChild(option);
            });
            // オーバーレイオプション
            const overlayOpt = document.createElement('option');
            overlayOpt.value = '__overlay__';
            overlayOpt.textContent = t('common.overlayFull');
            if (state.selectedOverlay) overlayOpt.selected = true;
            select.appendChild(overlayOpt);
        }
    });
}

// ==============================
// 画像操作
// ==============================

function getBoundingBoxFromPoints(pointsStr) {
    if (!pointsStr) return null;

    const coords = pointsStr.split(/[\s,]+/).map(parseFloat).filter(n => !isNaN(n));
    if (coords.length < 2) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < coords.length; i += 2) {
        const x = coords[i], y = coords[i + 1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }

    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// オーバーレイレイヤーに画像を挿入（クリップなし）
// placement を渡すと、ページ幅40%の中央配置デフォルトの代わりに指定位置・サイズで挿入する
// （例: SVG図形をPNG化した際、元の図形と同じ位置・表示サイズで複製挿入するため）
async function insertImageToOverlay(base64Data, width, height, placement = null) {
    if (!state.activePage) return;

    pushHistory();

    const ns = 'http://www.w3.org/2000/svg';
    const parser = new DOMParser();

    // ページのviewBoxからサイズを取得
    const imgSvg = parser.parseFromString(state.activePage.svgContent, 'image/svg+xml').querySelector('svg');
    const vb = imgSvg ? imgSvg.getAttribute('viewBox') : '0 0 21000 29700';
    const [, , pageW, pageH] = vb.split(' ').map(Number);

    // 挿入サイズ（ページ幅の40%、placement指定時はそちらを優先）
    let insertW, insertH, insertX, insertY;
    if (placement) {
        ({ x: insertX, y: insertY, width: insertW, height: insertH } = placement);
    } else {
        insertW = pageW * 0.4;
        insertH = insertW * (height / width);
        insertX = (pageW - insertW) / 2;
        insertY = (pageH - insertH) / 2;
    }

    // overlaySvgContent をパースまたは新規作成
    const existingStr = state.activePage.overlaySvgContent || '';
    let overlayDoc, overlaySvg;
    if (existingStr) {
        overlayDoc = parser.parseFromString(existingStr, 'image/svg+xml');
        overlaySvg = overlayDoc.querySelector('svg');
    }
    if (!overlaySvg) {
        overlayDoc = document.implementation.createDocument(ns, 'svg', null);
        overlaySvg = overlayDoc.documentElement;
        overlaySvg.setAttribute('xmlns', ns);
        overlaySvg.setAttribute('viewBox', vb);
    }

    // basePanelPoints がある場合、clipPath定義をdefsに保存
    const basePts = state.activePage.basePanelPoints;
    const overlayClipId = 'overlay-page-clip';
    if (basePts) {
        let defs = overlayDoc.querySelector('defs');
        if (!defs) {
            defs = overlayDoc.createElementNS(ns, 'defs');
            overlaySvg.insertBefore(defs, overlaySvg.firstChild);
        }
        if (!defs.querySelector(`[id="${overlayClipId}"]`)) {
            const clipPath = overlayDoc.createElementNS(ns, 'clipPath');
            clipPath.setAttribute('id', overlayClipId);
            clipPath.setAttribute('clipPathUnits', 'userSpaceOnUse');
            const poly = overlayDoc.createElementNS(ns, 'polygon');
            poly.setAttribute('points', basePts);
            clipPath.appendChild(poly);
            defs.appendChild(clipPath);
        }
    }

    // g[data-overlay-layer] を取得または作成
    let overlayG = overlayDoc.querySelector('g[data-overlay-layer]');
    if (!overlayG) {
        overlayG = overlayDoc.createElementNS(ns, 'g');
        overlayG.setAttribute('data-overlay-layer', 'true');
        if (basePts) overlayG.setAttribute('clip-path', `url(#${overlayClipId})`);
        overlaySvg.appendChild(overlayG);
    }

    // image要素を作成
    const imgEl = overlayDoc.createElementNS(ns, 'image');
    imgEl.setAttribute('href', base64Data);
    imgEl.setAttribute('x', insertX);
    imgEl.setAttribute('y', insertY);
    imgEl.setAttribute('width', insertW);
    imgEl.setAttribute('height', insertH);
    imgEl.setAttribute('class', 'inserted-image');
    imgEl.setAttribute('id', 'img-' + Date.now());
    imgEl.setAttribute('data-panel-id', '__overlay__');
    overlayG.appendChild(imgEl);

    const serializer = new XMLSerializer();
    let str = serializer.serializeToString(overlaySvg);
    if (!str.includes('xmlns="http://www.w3.org/2000/svg"')) {
        str = str.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    const updatedRecord = { ...state.activePage, overlaySvgContent: str };
    await dbPut('pages', updatedRecord);
    state.activePage = updatedRecord;

    await renderLayoutTab();
}

// placement: { x, y, width, height } を渡すと、コマ幅いっぱいに拡大するデフォルトの代わりに
// 指定位置・サイズで挿入する（例: SVG図形をPNG化した際、元の図形と同じ位置・表示サイズで複製挿入するため）
async function insertImage(base64Data, width, height, extraAttrs = {}, placement = null) {
    // オーバーレイ選択中の場合はオーバーレイに挿入
    if (state.selectedOverlay) {
        await insertImageToOverlay(base64Data, width, height, placement);
        return true;
    }

    if (!state.selectedPanelId) {
        alert(t('layout.msgSelectPanelForImage'));
        return false;
    }

    const panel = state.activePage.panels.find(p => p.id === state.selectedPanelId);
    if (!panel) return false;

    pushHistory();

    const ns = 'http://www.w3.org/2000/svg';
    const parser = new DOMParser();

    // コマのbboxを計算
    let pWidth, pHeight, pX, pY;
    if (panel.points) {
        const bbox = getBoundingBoxFromPoints(panel.points);
        if (bbox) { pWidth = bbox.width; pHeight = bbox.height; pX = bbox.x; pY = bbox.y; }
    }
    if (!pWidth && panel.width) {
        pWidth = panel.width; pHeight = panel.height; pX = panel.x; pY = panel.y;
    }
    if (!pWidth || !pHeight) {
        alert(t('layout.msgPanelSizeUnavailable'));
        return false;
    }

    // panelSvgContent をパース（または新規作成）
    const existingSvgStr = panel.panelSvgContent || '';
    const imgSvg = parser.parseFromString(state.activePage.svgContent, 'image/svg+xml').querySelector('svg');
    const vb = imgSvg ? imgSvg.getAttribute('viewBox') : '0 0 21000 29700';

    let panelDoc, panelSvg;
    if (existingSvgStr) {
        panelDoc = parser.parseFromString(existingSvgStr, 'image/svg+xml');
        panelSvg = panelDoc.querySelector('svg');
    }
    if (!panelSvg) {
        panelDoc = document.implementation.createDocument(ns, 'svg', null);
        panelSvg = panelDoc.documentElement;
        panelSvg.setAttribute('xmlns', ns);
        panelSvg.setAttribute('viewBox', vb);
    }

    // defs に clipPath を追加（なければ）
    const clipId = `panel-clip-${panel.id}`;
    let defs = panelDoc.querySelector('defs');
    if (!defs) {
        defs = panelDoc.createElementNS(ns, 'defs');
        panelSvg.insertBefore(defs, panelSvg.firstChild);
    }
    if (!panelDoc.querySelector(`[id="${clipId}"]`) && panel.points) {
        const clipPath = panelDoc.createElementNS(ns, 'clipPath');
        clipPath.setAttribute('id', clipId);
        clipPath.setAttribute('clipPathUnits', 'userSpaceOnUse');
        const poly = panelDoc.createElementNS(ns, 'polygon');
        poly.setAttribute('points', panel.points);
        clipPath.appendChild(poly);
        defs.appendChild(clipPath);
    }

    // コマのコンテンツg要素（clip-path適用）を取得または作成
    let contentG = panelDoc.querySelector(`g[data-clip-panel="${panel.id}"]`);
    if (!contentG) {
        contentG = panelDoc.createElementNS(ns, 'g');
        contentG.setAttribute('clip-path', `url(#${clipId})`);
        contentG.setAttribute('data-clip-panel', panel.id);
        panelSvg.appendChild(contentG);
    }

    // image要素を作成してgに追加
    const imgEl = panelDoc.createElementNS(ns, 'image');
    imgEl.setAttribute('href', base64Data);
    let newX, newY, newWidth, newHeight;
    if (placement) {
        ({ x: newX, y: newY, width: newWidth, height: newHeight } = placement);
    } else {
        newX = pX; newY = pY;
        newWidth  = pWidth;
        newHeight = newWidth * (height / width);
    }
    imgEl.setAttribute('x', newX);
    imgEl.setAttribute('y', newY);
    imgEl.setAttribute('width', newWidth);
    imgEl.setAttribute('height', newHeight);
    imgEl.setAttribute('class', 'inserted-image');
    imgEl.setAttribute('id', 'img-' + Date.now());
    imgEl.setAttribute('data-panel-id', panel.id);
    // 追加属性（3Dポーズ再編集用 data-pose3d-* 等）
    for (const [k, v] of Object.entries(extraAttrs)) {
        imgEl.setAttribute(k, v);
    }
    contentG.appendChild(imgEl);

    const serializer = new XMLSerializer();
    let newPanelSvgStr = serializer.serializeToString(panelSvg);
    if (!newPanelSvgStr.includes('xmlns="http://www.w3.org/2000/svg"')) {
        newPanelSvgStr = newPanelSvgStr.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    // panels配列の該当コマを更新
    const updatedPanels = state.activePage.panels.map(p =>
        p.id === panel.id ? { ...p, panelSvgContent: newPanelSvgStr } : p
    );
    const updatedRecord = { ...state.activePage, panels: updatedPanels };
    await dbPut('pages', updatedRecord);
    state.activePage = updatedRecord;

    await renderLayoutTab();
    return true;
}

/**
 * URL（/ccc_comfyui_output/... 等）を fetch して base64 dataURL に変換し、
 * insertImage() でコマに挿入する共通ヘルパー
 */
async function insertImageFromUrl(url) {
    if (typeof insertImage !== 'function') return;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
        const blob = await res.blob();
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
        const img = new Image();
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = dataUrl;
        });
        let imgW = img.naturalWidth;
        let imgH = img.naturalHeight;
        // SVGはnaturalWidth/Heightが0になる場合があるのでviewBoxから取得
        if ((!imgW || !imgH) && dataUrl.startsWith('data:image/svg')) {
            try {
                const svgText = typeof _svgBase64ToText === 'function'
                    ? _svgBase64ToText(dataUrl)
                    : new TextDecoder().decode(Uint8Array.from(atob(dataUrl.split(',')[1] || ''), c => c.charCodeAt(0)));
                const parser = new DOMParser();
                const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
                const svgEl = svgDoc.querySelector('svg');
                if (svgEl) {
                    const vb = svgEl.getAttribute('viewBox');
                    if (vb) {
                        const parts = vb.trim().split(/[\s,]+/);
                        imgW = parseFloat(parts[2]) || 1000;
                        imgH = parseFloat(parts[3]) || 1000;
                    } else {
                        imgW = parseFloat(svgEl.getAttribute('width')) || 1000;
                        imgH = parseFloat(svgEl.getAttribute('height')) || 1000;
                    }
                }
            } catch (_) {
                imgW = 1000; imgH = 1000;
            }
        }
        await insertImage(dataUrl, imgW, imgH);
        if (typeof switchTab === 'function') switchTab('layout');
    } catch (e) {
        console.error('insertImageFromUrl error:', e);
        alert(t('layout.msgImageInsertFailed', e.message));
    }
}

// ---- 画像ハンドルユーティリティ ----
function clearImageHandles(svgEl) {
    const root = svgEl || document;
    root.querySelectorAll('.image-handle, .image-bbox, .image-rotate-line').forEach(h => h.remove());
}

// 無回転のバウンディングボックス(x,y,w,h)と回転角(度)から、回転後の8ハンドル位置(絶対座標)を計算する。
// SVGのtransform="rotate(angle,cx,cy)"と同じ回転行列(x'=cx+lx*cos-ly*sin, y'=cy+lx*sin+ly*cos)を使うことで、
// 画像本体の回転描画とハンドル表示位置を一致させる。
function _imageGetRotatedHandlePositions(x, y, w, h, angleDeg) {
    const hw = w / 2, hh = h / 2;
    const cx = x + hw, cy = y + hh;
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
function _imageGetRotateHandlePos(x, y, w, h, angleDeg, offset) {
    const hh = h / 2;
    const cx = x + w / 2, cy = y + hh;
    const rad  = angleDeg * Math.PI / 180;
    const cosR = Math.cos(rad), sinR = Math.sin(rad);
    const rotTopX = cx + hh * sinR;
    const rotTopY = cy - hh * cosR;
    const rotHx   = rotTopX + offset * sinR;
    const rotHy   = rotTopY - offset * cosR;
    return { rotTopX, rotTopY, rotHx, rotHy };
}

function renderImageHandles(el, svgEl) {
    clearImageHandles(svgEl);
    el.classList.add('selected');

    const x = parseFloat(el.getAttribute('x'));
    const y = parseFloat(el.getAttribute('y'));
    const w = parseFloat(el.getAttribute('width'));
    const h = parseFloat(el.getAttribute('height'));
    const angle = parseFloat(el.dataset.angle || 0);

    // バウンディングボックス線（回転する画像に追従させる）
    const bbox = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bbox.setAttribute('x', x);
    bbox.setAttribute('y', y);
    bbox.setAttribute('width', w);
    bbox.setAttribute('height', h);
    bbox.setAttribute('class', 'image-bbox');
    bbox.style.pointerEvents = 'none';
    if (angle) bbox.setAttribute('transform', `rotate(${angle},${x + w / 2},${y + h / 2})`);
    svgEl.appendChild(bbox);

    // viewBox座標系でのスケール計算
    const vb = svgEl.viewBox.baseVal;
    const rect = svgEl.getBoundingClientRect();
    const scale = rect.width ? vb.width / rect.width : 1;
    const r = Math.round(scale * 8);
    const strokeW = Math.round(scale * 1.5);

    // バウンディングボックスにstroke-widthを設定
    bbox.setAttribute('stroke-width', strokeW);

    // 8点ハンドル。回転を考慮した位置に配置する
    const rotated = _imageGetRotatedHandlePositions(x, y, w, h, angle);
    ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach(type => {
        const [hx, hy] = rotated[type];
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', hx);
        circle.setAttribute('cy', hy);
        circle.setAttribute('r', r);
        circle.setAttribute('stroke-width', Math.round(r * 0.25));
        circle.setAttribute('class', `image-handle resize-handle resize-${type}`);
        circle.style.pointerEvents = 'auto';
        circle.dataset.handleType = type;
        svgEl.appendChild(circle);
    });

    // 回転ハンドル（上辺中央から offset 上に配置）
    const offset = scale * 24;
    const { rotTopX, rotTopY, rotHx, rotHy } = _imageGetRotateHandlePos(x, y, w, h, angle, offset);

    const rotateLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    rotateLine.setAttribute('x1', rotTopX); rotateLine.setAttribute('y1', rotTopY);
    rotateLine.setAttribute('x2', rotHx); rotateLine.setAttribute('y2', rotHy);
    rotateLine.setAttribute('class', 'image-rotate-line');
    rotateLine.setAttribute('stroke-width', strokeW);
    rotateLine.style.pointerEvents = 'none';
    svgEl.appendChild(rotateLine);

    const rotateCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    rotateCircle.setAttribute('cx', rotHx);
    rotateCircle.setAttribute('cy', rotHy);
    rotateCircle.setAttribute('r', r);
    rotateCircle.setAttribute('stroke-width', Math.round(r * 0.25));
    rotateCircle.setAttribute('class', 'image-handle rotate-handle');
    rotateCircle.style.pointerEvents = 'auto';
    rotateCircle.dataset.handleType = 'rotate';
    svgEl.appendChild(rotateCircle);
}

function updateImageHandlePositions(el, svgEl) {
    const x = parseFloat(el.getAttribute('x'));
    const y = parseFloat(el.getAttribute('y'));
    const w = parseFloat(el.getAttribute('width'));
    const h = parseFloat(el.getAttribute('height'));
    const angle = parseFloat(el.dataset.angle || 0);

    const bbox = svgEl.querySelector('.image-bbox');
    if (bbox) {
        bbox.setAttribute('x', x);
        bbox.setAttribute('y', y);
        bbox.setAttribute('width', w);
        bbox.setAttribute('height', h);
        if (angle) bbox.setAttribute('transform', `rotate(${angle},${x + w / 2},${y + h / 2})`);
        else bbox.removeAttribute('transform');
    }

    const positions = _imageGetRotatedHandlePositions(x, y, w, h, angle);

    // 回転ハンドル位置を計算
    const vb = svgEl.viewBox.baseVal;
    const sRect = svgEl.getBoundingClientRect();
    const sc = sRect.width ? vb.width / sRect.width : 1;
    const offset = sc * 24;
    const { rotTopX, rotTopY, rotHx, rotHy } = _imageGetRotateHandlePos(x, y, w, h, angle, offset);
    positions['rotate'] = [rotHx, rotHy];

    svgEl.querySelectorAll('.image-handle').forEach(h => {
        const pos = positions[h.dataset.handleType];
        if (pos) {
            h.setAttribute('cx', pos[0]);
            h.setAttribute('cy', pos[1]);
        }
    });

    // 回転ライン更新
    const rotateLine = svgEl.querySelector('.image-rotate-line');
    if (rotateLine) {
        rotateLine.setAttribute('x1', rotTopX); rotateLine.setAttribute('y1', rotTopY);
        rotateLine.setAttribute('x2', rotHx); rotateLine.setAttribute('y2', rotHy);
    }
}
// ---- ここまで画像ハンドルユーティリティ ----

// document登録リスナーの現在の参照（renderLayoutTab()経由で再初期化されるたびに
// documentへの登録が積み上がってメモリリークするのを防ぐため、再登録前に解除する）
let _imgManipDocMouseMove = null;
let _imgManipDocMouseUp = null;
let _balloonManipDocMouseMove = null;
let _balloonManipDocMouseUp = null;

function initImageManipulation(svgEl, balloonSvgEl) {
    if (_imgManipDocMouseMove) { document.removeEventListener('mousemove', _imgManipDocMouseMove); _imgManipDocMouseMove = null; }
    if (_imgManipDocMouseUp)   { document.removeEventListener('mouseup', _imgManipDocMouseUp); _imgManipDocMouseUp = null; }
    if (_balloonManipDocMouseMove) { document.removeEventListener('mousemove', _balloonManipDocMouseMove); _balloonManipDocMouseMove = null; }
    if (_balloonManipDocMouseUp)   { document.removeEventListener('mouseup', _balloonManipDocMouseUp); _balloonManipDocMouseUp = null; }

    const images = svgEl.querySelectorAll('.inserted-image');

    // 画像ドラッグ/リサイズ/回転の状態
    let imgDragging = false;
    let imgResizing = false;
    let imgRotating = false;
    let imgResizeDir = null;
    let imgHistoryPushed = false; // 実際にドラッグで動かした場合のみhistoryへ積む（クリック選択だけでは積まない）
    let selectedImage = null;
    let startX, startY;
    let initX, initY, initW, initH;
    let initAngle = 0;
    let startAngleRad = 0;

    const getSvgPt = (clientX, clientY) => {
        const pt = svgEl.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        return pt.matrixTransform(svgEl.getScreenCTM().inverse());
    };

    const getBalloonSvgPt = (clientX, clientY) => {
        if (!balloonSvgEl) return getSvgPt(clientX, clientY);
        const pt = balloonSvgEl.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        return pt.matrixTransform(balloonSvgEl.getScreenCTM().inverse());
    };

    const selectImage = (el) => {
        // 動的に現在のinserted-imageを取得（後から追加された画像にも対応）
        svgEl.querySelectorAll('.inserted-image').forEach(i => i.classList.remove('selected'));
        if (balloonSvgEl) balloonSvgEl.querySelectorAll('.balloon-shape').forEach(b => b.classList.remove('selected'));
        // 排他選択: 他の種類（テキスト/グループ等）の選択も含めて完全にクリアしてから選択する
        _clearObjectSelection();
        el.classList.add('selected');
        state.selectedImageId = el.id || 'selected';
        state.selectedImageEl = el;
        // data-angle / data-flipH / data-flipV が未設定なら初期化
        if (!el.dataset.angle) el.dataset.angle = '0';
        if (!el.dataset.flipH) el.dataset.flipH = '0';
        if (!el.dataset.flipV) el.dataset.flipV = '0';
        renderImageHandles(el, svgEl);
        syncPanelSelectionToObject(el);
        renderLayerPanel();
    };

    svgEl.addEventListener('click', (e) => {
        if (e.target === svgEl) {
            svgEl.querySelectorAll('.inserted-image').forEach(img => img.classList.remove('selected'));
            if (balloonSvgEl) balloonSvgEl.querySelectorAll('.balloon-shape').forEach(b => b.classList.remove('selected'));
            clearImageHandles(svgEl);
            state.selectedImageId = null;
            state.selectedImageEl = null;
            state.selectedShapeId = null;
        }
    });

    // 画像ハンドルのmousedown（イベント委譲）
    svgEl.addEventListener('mousedown', (e) => {
        // 画像ハンドルのリサイズ/回転
        const handle = e.target.closest('.image-handle');
        if (handle && state.selectedImageEl) {
            selectedImage = state.selectedImageEl;
            e.preventDefault();
            e.stopPropagation();
            initX = parseFloat(selectedImage.getAttribute('x'));
            initY = parseFloat(selectedImage.getAttribute('y'));
            initW = parseFloat(selectedImage.getAttribute('width'));
            initH = parseFloat(selectedImage.getAttribute('height'));
            initAngle = parseFloat(selectedImage.dataset.angle || 0);

            if (handle.dataset.handleType === 'rotate') {
                imgRotating = true;
                const cx = initX + initW / 2;
                const cy = initY + initH / 2;
                const pt = getSvgPt(e.clientX, e.clientY);
                startAngleRad = Math.atan2(pt.y - cy, pt.x - cx);
            } else {
                imgResizing = true;
                imgResizeDir = handle.dataset.handleType;
                const pt = getSvgPt(e.clientX, e.clientY);
                startX = pt.x;
                startY = pt.y;
            }
            return;
        }

        // 画像本体のドラッグ移動
        const img = e.target.closest('.inserted-image');
        if (img) {
            if (img.closest('[data-group-id]')) return; // グループ内はグループ操作に委ねる
            if (_isObjectLocked(img)) return; // ロック中は操作不可
            e.stopPropagation();
            e.preventDefault();
            selectImage(img);
            selectedImage = img;
            imgDragging = true;
            imgHistoryPushed = false; // 実際に動かした最初のmousemoveで積む（クリックのみなら積まない）
            const pt = getSvgPt(e.clientX, e.clientY);
            startX = pt.x;
            startY = pt.y;
            initX = parseFloat(img.getAttribute('x'));
            initY = parseFloat(img.getAttribute('y'));
            initW = parseFloat(img.getAttribute('width'));
            initH = parseFloat(img.getAttribute('height'));
            state.selectedImageId = img.id || 'selected';

            const clipUrl = img.getAttribute('clip-path');
            if (clipUrl) {
                const match = clipUrl.match(/#clip-(.+)\)/);
                if (match && match[1] && state.selectedPanelId !== match[1]) {
                    state.selectedPanelId = match[1];
                    updatePanelSelectDropdown();
                    highlightOverlay(svgEl, match[1]);
                }
            }
        }
    });

    _imgManipDocMouseMove = (e) => {
        if (!selectedImage) selectedImage = state.selectedImageEl || null;
        if (!selectedImage) return;

        if (imgDragging) {
            if (!imgHistoryPushed) { pushHistory(); imgHistoryPushed = true; }
            e.preventDefault();
            const pt = getSvgPt(e.clientX, e.clientY);
            const dx = pt.x - startX;
            const dy = pt.y - startY;
            selectedImage.setAttribute('x', initX + dx);
            selectedImage.setAttribute('y', initY + dy);
            applyImageTransform(selectedImage);
            updateImageHandlePositions(selectedImage, svgEl);
            return;
        }

        if (imgResizing) {
            e.preventDefault();
            const pt = getSvgPt(e.clientX, e.clientY);
            const dx = pt.x - startX;
            const dy = pt.y - startY;
            const MIN = 10;

            // 回転を考慮: マウスの移動量(dx,dy)を画像のローカル座標系(無回転)へ逆回転する
            const rad  = initAngle * Math.PI / 180;
            const cosR = Math.cos(rad), sinR = Math.sin(rad);
            const ldx  = dx * cosR + dy * sinR;
            const ldy  = -dx * sinR + dy * cosR;

            let nx = initX, ny = initY, nw = initW, nh = initH;
            const fixedRight = initX + initW;
            const fixedBottom = initY + initH;

            if (imgResizeDir === 'se') {
                nw = Math.max(MIN, initW + ldx); nh = Math.max(MIN, initH + ldy);
            } else if (imgResizeDir === 'sw') {
                nw = Math.max(MIN, initW - ldx); nx = fixedRight - nw; nh = Math.max(MIN, initH + ldy);
            } else if (imgResizeDir === 'ne') {
                nw = Math.max(MIN, initW + ldx); nh = Math.max(MIN, initH - ldy); ny = fixedBottom - nh;
            } else if (imgResizeDir === 'nw') {
                nw = Math.max(MIN, initW - ldx); nx = fixedRight - nw;
                nh = Math.max(MIN, initH - ldy); ny = fixedBottom - nh;
            } else if (imgResizeDir === 'e') {
                nw = Math.max(MIN, initW + ldx);
            } else if (imgResizeDir === 'w') {
                nw = Math.max(MIN, initW - ldx); nx = fixedRight - nw;
            } else if (imgResizeDir === 's') {
                nh = Math.max(MIN, initH + ldy);
            } else if (imgResizeDir === 'n') {
                nh = Math.max(MIN, initH - ldy); ny = fixedBottom - nh;
            }

            if (initAngle) {
                // ローカル座標系での中心移動量を回転してグローバル座標系に変換し、
                // 回転中心(=画像の中心)が正しい位置に来るようx,yを補正する
                const oldCx = initX + initW / 2, oldCy = initY + initH / 2;
                const newCxLocal = nx + nw / 2, newCyLocal = ny + nh / 2;
                const dcxLocal = newCxLocal - oldCx, dcyLocal = newCyLocal - oldCy;
                const dcxGlobal = dcxLocal * cosR - dcyLocal * sinR;
                const dcyGlobal = dcxLocal * sinR + dcyLocal * cosR;
                nx = oldCx + dcxGlobal - nw / 2;
                ny = oldCy + dcyGlobal - nh / 2;
            }

            selectedImage.setAttribute('x', nx);
            selectedImage.setAttribute('y', ny);
            selectedImage.setAttribute('width', nw);
            selectedImage.setAttribute('height', nh);
            applyImageTransform(selectedImage);
            updateImageHandlePositions(selectedImage, svgEl);
        }

        if (imgRotating) {
            e.preventDefault();
            const cx = initX + initW / 2;
            const cy = initY + initH / 2;
            const pt = getSvgPt(e.clientX, e.clientY);
            const currentRad = Math.atan2(pt.y - cy, pt.x - cx);
            const deltaDeg = (currentRad - startAngleRad) * 180 / Math.PI;
            const newAngle = initAngle + deltaDeg;
            selectedImage.dataset.angle = newAngle;
            applyImageTransform(selectedImage);
            updateImageHandlePositions(selectedImage, svgEl);
        }
    };
    document.addEventListener('mousemove', _imgManipDocMouseMove);

    const onImgMouseUp = async () => {
        if (imgDragging || imgResizing || imgRotating) {
            imgDragging = false;
            imgResizing = false;
            imgRotating = false;
            imgResizeDir = null;
            if (selectedImage) {
                const panelId = selectedImage.closest('g[data-clip-panel]')?.getAttribute('data-clip-panel') || state.selectedPanelId || 'panel-0';
                await savePanelSvg(panelId, svgEl);
            }
        }
    };

    svgEl.addEventListener('mouseup', onImgMouseUp);
    _imgManipDocMouseUp = onImgMouseUp;
    document.addEventListener('mouseup', _imgManipDocMouseUp);

    images.forEach(img => { img.style.cursor = 'move'; });

    // フキダシ操作はイベント委譲でballoonSvgEl上に登録（後から追加されたシェイプにも対応）
    if (balloonSvgEl) {
        let balloonDragging = false;
        let balloonTarget = null;
        let balloonHistoryPushed = false; // 実際にドラッグで動かした場合のみhistoryへ積む（クリック選択だけでは積まない）
        let balloonStartX, balloonStartY, balloonInitialCx, balloonInitialCy;

        balloonSvgEl.addEventListener('mousedown', (e) => {
            // ハンドル操作はinitBalloonToolsに委ねる（balloon-handleはスキップ）
            if (e.target.closest('.balloon-handle')) return;

            const shape = e.target.closest('.balloon-shape');
            if (!shape) return;
            if (shape.closest('[data-group-id]')) return; // グループ内はグループ操作に委ねる

            e.stopPropagation();
            e.preventDefault();

            svgEl.querySelectorAll('.inserted-image').forEach(i => i.classList.remove('selected'));
            balloonSvgEl.querySelectorAll('.balloon-shape').forEach(b => b.classList.remove('selected'));
            // 排他選択: 他の種類（画像/テキスト/グループ等）の選択も含めて完全にクリアしてから選択する
            _clearObjectSelection();
            shape.classList.add('selected');
            selectedImage = null;

            balloonDragging = true;
            balloonTarget = shape;
            balloonHistoryPushed = false; // 実際に動かした最初のmousemoveで積む（クリックのみなら積まない）

            const pt = getBalloonSvgPt(e.clientX, e.clientY);
            balloonStartX = pt.x;
            balloonStartY = pt.y;
            balloonInitialCx = parseFloat(shape.dataset.cx);
            balloonInitialCy = parseFloat(shape.dataset.cy);
            state.selectedShapeId = shape.id;

            // 編集モードをONにしてハンドルを表示
            state.balloon.isEditMode = true;
            updateBalloonUI();
            renderHandles(shape);
            syncPanelSelectionToObject(shape);
            renderLayerPanel();
        });

        _balloonManipDocMouseMove = (e) => {
            if (!balloonDragging || !balloonTarget) return;
            if (!balloonHistoryPushed) { pushHistory(); balloonHistoryPushed = true; }

            const pt = getBalloonSvgPt(e.clientX, e.clientY);
            const dx = pt.x - balloonStartX;
            const dy = pt.y - balloonStartY;

            const newCx = balloonInitialCx + dx;
            const newCy = balloonInitialCy + dy;

            balloonTarget.dataset.cx = newCx;
            balloonTarget.dataset.cy = newCy;

            // h2タイプはtailAngleDeg+tailLengthで尻尾制御、cx/cyのみ更新
            _updateH2ShapePath(balloonTarget);
            if (state.balloon.isEditMode && state.selectedShapeId === balloonTarget.id) {
                _updateH2HandlePositions(balloonTarget);
            }
        };
        document.addEventListener('mousemove', _balloonManipDocMouseMove);

        const balloonMouseUp = async () => {
            if (balloonDragging && balloonTarget) {
                balloonDragging = false;
                const panelId = balloonTarget.closest('g[data-clip-panel]')?.getAttribute('data-clip-panel') || state.selectedPanelId || 'panel-0';
                await savePanelSvg(panelId, balloonSvgEl);
                balloonTarget = null;
            }
        };

        balloonSvgEl.addEventListener('mouseup', balloonMouseUp);
        _balloonManipDocMouseUp = balloonMouseUp;
        document.addEventListener('mouseup', _balloonManipDocMouseUp);
    }
}

// ==============================
// 画像挿入 (ローカル + D&D)
// ==============================

async function handleInsertImageFromLocal() {
    const input = document.getElementById('image-upload');
    input.click();

    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const base64 = await readFileAsDataURL(file);
            const img = new Image();
            img.onload = async () => {
                await insertImage(base64, img.width, img.height);
            };
            img.src = base64;
        } catch (err) {
            console.error('Image load error:', err);
            alert(t('layout.msgImageLoadFailed'));
        }
        input.value = '';
    };
}

function initDragAndDrop() {
    ['layout-preview'].forEach(id => {
        const previewContainer = document.getElementById(id);
        if (!previewContainer) return;

        previewContainer.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            previewContainer.classList.add('drag-over');
        });

        previewContainer.addEventListener('dragleave', (e) => {
            e.preventDefault();
            previewContainer.classList.remove('drag-over');
        });

        previewContainer.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            previewContainer.classList.remove('drag-over');

            if (!state.activePage) {
                alert(t('layout.msgCreatePageFirst'));
                return;
            }
            if (!state.selectedPanelId) {
                alert(t('layout.msgSelectPanelFirst'));
                return;
            }

            const files = e.dataTransfer.files;
            if (files.length === 0) return;

            const file = files[0];
            if (!file.type.startsWith('image/')) {
                alert(t('layout.msgDropImageFile'));
                return;
            }

            try {
                const base64 = await readFileAsDataURL(file);
                const img = new Image();
                img.onload = async () => {
                    await insertImage(base64, img.width, img.height);
                };
                img.src = base64;
            } catch (err) {
                console.error('Drop image error:', err);
                alert(t('layout.msgImageLoadFailed'));
            }
        });
    });
}

