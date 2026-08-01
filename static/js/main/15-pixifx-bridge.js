// ============================================================
// main.js 分割ファイル (16/24): PixiJS_FX
// 元 main.js の行 13098-13257 に相当
// type="module" として読み込まれる（ESモジュール化 G6）。
// 主なトップレベル定義: initPixiFxButtons,moveSelectedObjectToCenter,openImageTabWithSelected,openLayoutI2IModal,pixiFxOpenForLayout,_getSelectedImageBlob,_getPageBlob,_pi2iResolvePagePixelSize,_PI2I_DPI,_layoutI2ITarget,_layoutI2IPositive,_layoutI2INegative,_layoutI2IDenoise
// 未ESM化の外部依存（非moduleのグローバル関数はwindowプロパティとして自動的に見えるため、
// 呼び出し箇所は書き換えていない）: state/switchTab（01-state.js）,
//   _drawShapeGetBounds/_drawShapeSetBounds/updateDrawShapeHandles（17c-layer-draw-handles.js）
// ============================================================

import { t } from '../i18n.js';
import { pushHistory, buildMergedSvg, savePanelSvg } from './07-pages.js';
import { dbGet } from './00-db.js';
import { embedFontsInSvg, drawSvgOnCanvas } from './12-text-png-export.js';
import { _EXPORT_MAX_SIZE } from './10-output-pages.js';
import { saveOverlaySvg, _updateH2ShapePath } from './09b-balloon-shapes.js';
import { insertImage, insertImageFromUrl, updateImageHandlePositions } from './08-panels-images.js';
import { applyImageTransform, _updateH2HandlePositions } from './09c-balloon-handles.js';
import { _layerOpacityGetSelected, getPanelLayerSvg } from './04b-layer-panel-render.js';
import { renderTextHandles } from './09d-balloon-tools.js';
import { updateGroupHandlePositions } from './06a-polygon-geometry.js';
import { getI2ISettingsState, saveI2ISettingsState, sendI2IRunToWorkflowStudio } from './14-integrations.js';
import { pixiFxOpen } from '../pixifx.js';
import { state, switchTab } from './01-state.js';
import { _drawShapeGetBounds, _drawShapeSetBounds, updateDrawShapeHandles } from './17c-layer-draw-handles.js';

// ============================================================
// PixiJS FX（comfyUI-particle-pixijs カスタムノード連携）
// パーティクル・フィルタ効果モーダル。実装は pixifx.js（window.pixiFxOpen）
// ============================================================

function initPixiFxButtons() {
    document.getElementById('pixifx-open-btn')?.addEventListener('click', () => pixiFxOpenForLayout());
}

// レイアウトタブ「画像」サブタブ: 選択中の画像を加工して現在のコマに挿入
function pixiFxOpenForLayout() {
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
    pixiFxOpen({
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

// レイアウトタブ「I2I」モーダル用: 選択中の画像要素からBlobを取得する
// （sendSelectedImageToI2Iのblob取得部分を切り出したもの。openLayoutI2IModal()から使う）
async function _getSelectedImageBlob() {
    const imgEl = state.selectedImageEl;
    if (!imgEl) {
        alert(t('layout.msgSelectImageFirst'));
        return null;
    }
    const href = imgEl.getAttribute('href') || imgEl.getAttribute('xlink:href') || '';
    if (!href.startsWith('data:image/')) {
        alert(t('layout.msgNotImageOrNotBase64'));
        return null;
    }
    const res = await fetch(href);
    return await res.blob();
}

// ページのSVG座標単位（mm×100相当。10-output-pages.jsの_getExportBaseWorkSize等と同じ規約）の
// 幅・高さを、I2I入力として十分な解像度のピクセルサイズへ変換する。
// pageRecord.width/heightをそのままcanvasのピクセル数として使うと（A4=21000×29700など）
// 数億ピクセル規模のcanvasになりtoBlobが失敗する（実際に発生した不具合の原因）ため、
// 出力タブの解像度自動計算（_applyExportDpi）と同じ mm→px 換算 + _EXPORT_MAX_SIZE クランプを行う
const _PI2I_DPI = 150;
function _pi2iResolvePagePixelSize(pageRecord) {
    let svgW = pageRecord.width, svgH = pageRecord.height;
    if (!(svgW > 0) || !(svgH > 0)) {
        // width/heightが無い（または不正な）ページ用のフォールバック: svgContentのviewBoxから求める
        const doc = new DOMParser().parseFromString(pageRecord.svgContent, 'image/svg+xml');
        const svgEl = doc.querySelector('svg');
        const vb = ((svgEl && svgEl.getAttribute('viewBox')) || '0 0 21000 29700').trim().split(/\s+/).map(Number);
        svgW = vb[2] || 21000;
        svgH = vb[3] || 29700;
    }
    const widthMm  = svgW / 100;
    const heightMm = svgH / 100;
    let w = Math.round(widthMm  * _PI2I_DPI / 25.4);
    let h = Math.round(heightMm * _PI2I_DPI / 25.4);
    if (w > _EXPORT_MAX_SIZE || h > _EXPORT_MAX_SIZE) {
        const scale = Math.min(_EXPORT_MAX_SIZE / w, _EXPORT_MAX_SIZE / h);
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));
    }
    // svgW/svgHはSVG座標系（mm×100）でのページサイズ。オーバーレイへページ全面サイズで
    // 挿入する際のplacement計算に使う（insertImageFromUrlのplacement引数、openLayoutI2IModal参照）
    return { w, h, svgW, svgH };
}

// レイアウトタブ「I2I」モーダル用: 現在のページ全体をPNG化してBlobを取得する
// （sendCurrentPageToI2Iのblob取得部分を切り出したもの。openLayoutI2IModal()から使う）。
// PNG化は既存のPDF/EPUB/PNG出力（12-text-png-export.js）と同じ経路
// （buildMergedSvg→embedFontsInSvg→drawSvgOnCanvas→canvas.toBlob）を流用し、
// 下書きレイヤーは既存の出力処理と同様に含めない（buildMergedSvgにopts.includeDraftを渡さない）。
// 戻り値のpageW/pageHはSVG座標系（mm×100）でのページサイズで、結果画像をオーバーレイへ
// ページ全面サイズのまま挿入するためのplacement計算に使う（openLayoutI2IModal参照）
async function _getPageBlob() {
    if (!state.activePage) {
        alert(t('layout.msgNoActivePage'));
        return null;
    }
    const pageRecord = await dbGet('pages', state.activePage.name);
    if (!pageRecord || !pageRecord.svgContent) {
        alert(t('page.msgPageDataNotFound', state.activePage.name));
        return null;
    }

    const mergedSvg = buildMergedSvg(pageRecord);
    const rawSvg = mergedSvg || pageRecord.svgContent;
    const embeddedSvg = await embedFontsInSvg(rawSvg);

    const { w: pxW, h: pxH, svgW: pageW, svgH: pageH } = _pi2iResolvePagePixelSize(pageRecord);
    const canvas = document.getElementById('render-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width  = pxW;
    canvas.height = pxH;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await drawSvgOnCanvas(ctx, embeddedSvg, pxW, pxH);

    const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error(t('page.errBlobGenFailed'))), 'image/png');
    });
    return { blob, pageW, pageH };
}

// ============================================================
// レイアウトタブ「I2I」モーダル
// 選択画像またはページ全体をWorkflow Studioへ送信し、その場でI2I生成を実行する
// （Imageタブの Select I2I パネル `_renderSelectI2IProps`/`_runSelectI2I` と同内容）。
// 状態はモジュールスコープに保持し、モーダルを開き直しても入力値を引き継ぐ
// （bubble-text-modal等と異なり編集対象=既存要素という概念が無いため）。
// ============================================================

let _layoutI2ITarget   = 'page'; // 'selected' | 'page'
let _layoutI2IPositive = '';
let _layoutI2INegative = '';
let _layoutI2IDenoise  = 1.0;

function openLayoutI2IModal() {
    _layoutI2ITarget = state.selectedImageEl ? 'selected' : 'page';

    const overlay = document.createElement('div');
    overlay.className = 'tsm-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'tsm-dialog li2i-dialog';
    dialog.innerHTML = `
        <div class="tsm-header">
            <h3>${t('layout.i2iModalHeading')}</h3>
            <button type="button" id="li2i-close-btn" class="tsm-close-btn" title="${t('common.close')}">×</button>
        </div>
        <div class="tsm-body li2i-body">
            <div class="fontmgr-style-group">
                <label class="fontmgr-style-group-label">${t('layout.i2iTargetLabel')}</label>
                <div style="display:flex; gap:4px;">
                    <button type="button" class="btn small secondary li2i-target-btn" data-target="selected">${t('layout.i2iTargetSelected')}</button>
                    <button type="button" class="btn small secondary li2i-target-btn" data-target="page">${t('layout.i2iTargetPage')}</button>
                </div>
            </div>
            <div class="fontmgr-style-group" style="flex-direction:column; align-items:stretch;">
                <label class="fontmgr-style-group-label">${t('layout.i2iPositiveLabel')}</label>
                <textarea id="li2i-positive" rows="5"></textarea>
            </div>
            <div class="fontmgr-style-group" style="flex-direction:column; align-items:stretch;">
                <label class="fontmgr-style-group-label">${t('layout.i2iNegativeLabel')}</label>
                <textarea id="li2i-negative" rows="5"></textarea>
            </div>
            <div class="fontmgr-style-group">
                <label>${t('layout.i2iDenoiseLabel')}</label>
                <input type="number" id="li2i-denoise" min="0" max="1" step="0.01" style="width:70px;">
            </div>
            <div class="fontmgr-style-group">
                <span id="li2i-status" style="font-size:12px; color:var(--text-secondary);"></span>
                <button type="button" id="li2i-run-btn" class="btn primary" style="margin-left:auto;">${t('layout.i2iRunBtn')}</button>
            </div>
            <div style="margin:8px 0 4px; border-top:1px solid var(--border-color); padding-top:8px; font-size:11px; color:var(--text-secondary); letter-spacing:0.05em;">
                ${t('layout.i2iSettingsHeading')}
            </div>
            <div class="fontmgr-style-group">
                <label style="cursor:pointer; display:flex; align-items:center; gap:4px;">
                    <input type="checkbox" id="li2i-default-wf-enabled"> ${t('layout.i2iUseDefaultWf')}
                </label>
            </div>
            <div class="fontmgr-style-group" style="flex-direction:column; align-items:stretch;">
                <label class="fontmgr-style-group-label">${t('layout.i2iWfFileLabel')}</label>
                <input type="text" id="li2i-default-wf-name" placeholder="cc_i2i_default.json">
            </div>
            <div class="fontmgr-style-group">
                <button type="button" id="li2i-settings-save-btn" class="btn small secondary">${t('common.save')}</button>
                <span id="li2i-settings-status" style="font-size:11px; color:var(--text-secondary); margin-left:8px;"></span>
            </div>
        </div>
    `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const $ = id => dialog.querySelector('#' + id);

    $('li2i-positive').value = _layoutI2IPositive;
    $('li2i-negative').value = _layoutI2INegative;
    $('li2i-denoise').value  = _layoutI2IDenoise;

    const syncTargetButtons = () => {
        dialog.querySelectorAll('.li2i-target-btn').forEach(b => {
            const active = b.dataset.target === _layoutI2ITarget;
            b.classList.toggle('active', active);
            b.classList.toggle('secondary', !active);
        });
    };
    syncTargetButtons();
    dialog.querySelectorAll('.li2i-target-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            _layoutI2ITarget = btn.dataset.target;
            syncTargetButtons();
        });
    });

    $('li2i-positive').addEventListener('input', e => { _layoutI2IPositive = e.target.value; });
    $('li2i-negative').addEventListener('input', e => { _layoutI2INegative = e.target.value; });
    $('li2i-denoise').addEventListener('input', e => {
        _layoutI2IDenoise = Math.max(0, Math.min(1, parseFloat(e.target.value)));
        if (Number.isNaN(_layoutI2IDenoise)) _layoutI2IDenoise = 1.0;
    });

    // I2I設定（Imageタブの Select I2I パネルと共有データ、14-integrations.js）
    const cur = getI2ISettingsState();
    $('li2i-default-wf-enabled').checked = cur.enabled;
    $('li2i-default-wf-name').value = cur.file;
    $('li2i-settings-save-btn').addEventListener('click', () => {
        saveI2ISettingsState($('li2i-default-wf-enabled').checked, $('li2i-default-wf-name').value);
        const statusEl = $('li2i-settings-status');
        statusEl.textContent = t('layout.i2iSettingsSaved');
        setTimeout(() => { statusEl.textContent = ''; }, 2000);
    });

    const close = () => document.body.removeChild(overlay);
    const onKeydown = (e) => { if (e.key === 'Escape') closeAndCleanup(); };
    document.addEventListener('keydown', onKeydown);
    const closeAndCleanup = () => { document.removeEventListener('keydown', onKeydown); close(); };

    $('li2i-close-btn').addEventListener('click', closeAndCleanup);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeAndCleanup(); });

    $('li2i-run-btn').addEventListener('click', async () => {
        const runBtn   = $('li2i-run-btn');
        const statusEl = $('li2i-status');
        const setStatus = (msg) => { statusEl.textContent = msg; };

        runBtn.disabled = true;
        runBtn.textContent = t('layout.i2iRunningBtn');
        setStatus(t('layout.i2iStatusUploading'));

        try {
            let blob, pageW = null, pageH = null;
            if (_layoutI2ITarget === 'selected') {
                blob = await _getSelectedImageBlob();
            } else {
                const pageResult = await _getPageBlob();
                if (pageResult) { blob = pageResult.blob; pageW = pageResult.pageW; pageH = pageResult.pageH; }
            }
            if (!blob) { setStatus(''); return; }

            setStatus(t('layout.i2iStatusGenerating'));
            const result = await sendI2IRunToWorkflowStudio(blob, {
                positive: _layoutI2IPositive,
                negative: _layoutI2INegative,
                denoise:  _layoutI2IDenoise,
            });
            if (!result?.ok) throw new Error(result?.message || 'I2I failed');

            setStatus(t('layout.i2iStatusDone'));
            closeAndCleanup();
            // ページ全体対象の結果は、選択中のコマに関わらず常にオーバーレイへ、
            // ページ全面サイズ（insertImageの既定=40%縮小を避けるためplacement指定）で追加する
            if (_layoutI2ITarget === 'page') {
                state.selectedOverlay = true;
                state.selectedDraft = false;
                await insertImageFromUrl(result.url, { x: 0, y: 0, width: pageW, height: pageH });
            } else {
                await insertImageFromUrl(result.url);
            }
        } catch (e) {
            setStatus(t('layout.i2iStatusError'));
            alert(t('layout.msgWfmI2ISendFailed', e.message));
        } finally {
            runBtn.disabled = false;
            runBtn.textContent = t('layout.i2iRunBtn');
        }
    });
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

export { initPixiFxButtons, openImageTabWithSelected, openLayoutI2IModal, moveSelectedObjectToCenter };

// まだESM化されていない main/以下の classic <script> から呼べるようにするブリッジ
// （ESモジュール化移行中の一時措置。全分割ファイルのESM化が完了したら、
//  各呼び出し元をimport文に置き換えてこのブロックごと削除する）。
window.initPixiFxButtons = initPixiFxButtons;
window.openImageTabWithSelected = openImageTabWithSelected;
window.openLayoutI2IModal = openLayoutI2IModal;
window.moveSelectedObjectToCenter = moveSelectedObjectToCenter;

