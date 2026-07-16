// ============================================================
// main.js 分割ファイル (16/24): PixiJS_FX
// 元 main.js の行 13098-13257 に相当
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: initPixiFxButtons,moveSelectedObjectToCenter,openImageTabWithSelected,pixiFxOpenForLayout
// ============================================================

// ============================================================
// PixiJS FX（comfyUI-particle-pixijs カスタムノード連携）
// パーティクル・フィルタ効果モーダル。実装は pixifx.js（window.pixiFxOpen）
// ============================================================

function initPixiFxButtons() {
    document.getElementById('pixifx-open-btn')?.addEventListener('click', () => pixiFxOpenForLayout());
}

// レイアウトタブ「画像」サブタブ: 選択中の画像を加工して現在のコマに挿入
function pixiFxOpenForLayout() {
    if (typeof window.pixiFxOpen !== 'function') {
        alert(t('image.pixifxNotLoaded'));
        return;
    }
    const imgEl = state.selectedImageEl;
    if (!imgEl) {
        alert(t('layout.msgSelectImageFirst'));
        return;
    }
    const href = imgEl.getAttribute('href') || imgEl.getAttribute('xlink:href') || '';
    if (!href.startsWith('data:image/')) {
        alert(t('layout.msgNotImageOrNotBase64'));
        return;
    }
    window.pixiFxOpen({
        imageDataUrl: href,
        onApply: async (dataUrl, meta) => {
            // 背景画像を非表示（透過出力）にした場合はパーティクルのみのオーバーレイ素材
            // として新規挿入。それ以外は選択画像をそのまま置き換える（サイズ・位置を維持）
            if (meta?.bgVisible === false || !imgEl.isConnected) {
                const img = new Image();
                img.onload = async () => { await insertImage(dataUrl, img.width, img.height); };
                img.onerror = () => alert(t('layout.msgImageLoadFailed'));
                img.src = dataUrl;
                return;
            }
            try {
                pushHistory();
                imgEl.setAttribute('href', dataUrl);
                if (imgEl.hasAttribute('xlink:href')) imgEl.setAttribute('xlink:href', dataUrl);
                const svgEl = imgEl.closest('svg');
                if (svgEl) {
                    const panelId = imgEl.getAttribute('data-panel-id') ||
                                    imgEl.closest('[data-clip-panel]')?.getAttribute('data-clip-panel');
                    const isOverlay = svgEl.querySelector('g[data-overlay-layer]')?.contains(imgEl) ?? false;
                    if (isOverlay) {
                        await saveOverlaySvg(svgEl);
                    } else if (panelId) {
                        await savePanelSvg(panelId, svgEl);
                    }
                }
            } catch (e) {
                alert(t('image.pixifxApplyError', e.message));
            }
        },
    });
}

// レイアウトタブ「画像タブで編集」ボタン: 選択中の画像をImageタブで開く
async function openImageTabWithSelected() {
    const imgEl = state.selectedImageEl;
    if (!imgEl) {
        alert(t('layout.msgSelectImageFirst'));
        return;
    }
    await switchTab('image');
    if (window._ccImageTab && typeof window._ccImageTab.loadFromSvgElement === 'function') {
        await window._ccImageTab.loadFromSvgElement(imgEl);
    }
}

// レイアウトタブ「I2Iへ送る」ボタン: 選択中の画像をWorkflow StudioのGenerate UI Image入力スロットへ送信する
async function sendSelectedImageToI2I() {
    const imgEl = state.selectedImageEl;
    if (!imgEl) {
        alert(t('layout.msgSelectImageFirst'));
        return;
    }
    const href = imgEl.getAttribute('href') || imgEl.getAttribute('xlink:href') || '';
    if (!href.startsWith('data:image/')) {
        alert(t('layout.msgNotImageOrNotBase64'));
        return;
    }
    try {
        const res = await fetch(href);
        const blob = await res.blob();
        await sendImageToWorkflowStudioI2I(blob, imgEl.dataset.name || 'cc-image', 'layout');
    } catch (e) {
        alert(t('layout.msgWfmI2ISendFailed', e.message));
    }
}

// 「OC」ボタン: 選択中オブジェクト（画像/テキスト/フキダシ/グループ/draw-shape）を中央へ移動する。
// コマ内のオブジェクトはそのコマの中心、オーバーレイ配下のオブジェクトはページ全体の中心へ移動する。
// コマ外にドラッグして操作不能になったオブジェクトを、レイヤーパネルから選択して復帰させる用途を想定。
async function moveSelectedObjectToCenter() {
    const el = _layerOpacityGetSelected();
    if (!el) {
        alert(t('layout.msgSelectObjectForCenter'));
        return;
    }
    const svgEl = getPanelLayerSvg();
    if (!svgEl) return;

    const clipG = el.closest('g[data-clip-panel]');

    // 移動先の中心座標: 所属コマがあればコマの中心、なければ（オーバーレイ配下）ページ全体の中心
    let target = null;
    if (clipG) {
        const panelId = clipG.getAttribute('data-clip-panel');
        const panel = state.activePage?.panels?.find(p => p.id === panelId);
        if (panel && panel.points) {
            const pts = panel.points.trim().split(/\s+/).map(s => s.split(',').map(Number));
            const xs = pts.map(p => p[0]);
            const ys = pts.map(p => p[1]);
            target = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
        }
    }
    if (!target) {
        const vb = svgEl.viewBox?.baseVal;
        target = { x: vb ? vb.x + vb.width / 2 : 0, y: vb ? vb.y + vb.height / 2 : 0 };
    }

    pushHistory();

    if (state.selectedImageEl) {
        const w = parseFloat(el.getAttribute('width')) || 0;
        const h = parseFloat(el.getAttribute('height')) || 0;
        el.setAttribute('x', target.x - w / 2);
        el.setAttribute('y', target.y - h / 2);
        applyImageTransform(el);
        updateImageHandlePositions(el, svgEl);
    } else if (state.selectedDrawEl) {
        const b = _drawShapeGetBounds(el);
        const dx = target.x - (b.x + b.w / 2);
        const dy = target.y - (b.y + b.h / 2);
        _drawShapeSetBounds(el, b.x + dx, b.y + dy, b.w, b.h);
        updateDrawShapeHandles(el, svgEl);
    } else if (state.selectedTextEl) {
        const bb = el.getBBox();
        const dx = target.x - (bb.x + bb.width / 2);
        const dy = target.y - (bb.y + bb.height / 2);
        el.setAttribute('x', parseFloat(el.getAttribute('x')) + dx);
        el.setAttribute('y', parseFloat(el.getAttribute('y')) + dy);
        el.querySelectorAll('tspan[x]').forEach(ts => ts.setAttribute('x', parseFloat(ts.getAttribute('x')) + dx));
        el.querySelectorAll('tspan[y]').forEach(ts => ts.setAttribute('y', parseFloat(ts.getAttribute('y')) + dy));
        const angle = parseFloat(el.dataset.angle || 0);
        if (angle) {
            const bb2 = el.getBBox();
            const bcx = bb2.x + bb2.width / 2;
            const bcy = bb2.y + bb2.height / 2;
            el.dataset.bboxCx = bcx;
            el.dataset.bboxCy = bcy;
            el.setAttribute('transform', `rotate(${angle},${bcx},${bcy})`);
        }
        renderTextHandles(el, svgEl);
    } else if (state.selectedShapeId) {
        el.dataset.cx = target.x;
        el.dataset.cy = target.y;
        _updateH2ShapePath(el);
        if (state.balloon.isEditMode) _updateH2HandlePositions(el);
    } else if (state.selectedGroupId) {
        const angle = parseFloat(el.getAttribute('data-angle') || '0');
        const rawCx = parseFloat(el.dataset.rawCx || '0');
        const rawCy = parseFloat(el.dataset.rawCy || '0');
        const newTx = target.x - rawCx;
        const newTy = target.y - rawCy;
        el.setAttribute('data-tx', newTx);
        el.setAttribute('data-ty', newTy);
        el.setAttribute('transform', `translate(${newTx},${newTy}) rotate(${angle},${rawCx},${rawCy})`);
        updateGroupHandlePositions(el, svgEl);
    } else {
        return;
    }

    const overlayG = el.closest('g[data-overlay-layer]');
    const panelId = clipG ? clipG.getAttribute('data-clip-panel') : (overlayG ? '__overlay__' : (state.selectedPanelId || 'panel-0'));
    await savePanelSvg(panelId, svgEl);
}

