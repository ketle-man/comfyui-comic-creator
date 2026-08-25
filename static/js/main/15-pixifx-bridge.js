// ============================================================
// main.js 分割ファイル (16/24): PixiJS_FX
// 元 main.js の行 13098-13257 に相当
// type="module" として読み込まれる（ESモジュール化 G6）。
// 主なトップレベル定義: initPixiFxButtons,moveSelectedObjectToCenter,openImageTabWithSelected,openLayoutI2IModal（レイアウトタブGenerateモーダル）,pixiFxOpenForLayout,_getSelectedImageBlob,_getPageBlob,_getPanelImageBlob,_getActivePagePixelSize,_composeOverallPrompt,_pi2iResolvePagePixelSize,_PI2I_DPI,_layoutI2ITarget,_layoutI2IActiveTab,_layoutI2IBatch,_layoutI2IT2I,_layoutI2IDenoise,_layoutI2IPrompts
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
import { insertImage, insertImageFromUrl, updateImageHandlePositions, getBoundingBoxFromPoints } from './08-panels-images.js';
import { applyImageTransform, _updateH2HandlePositions } from './09c-balloon-handles.js';
import { _layerOpacityGetSelected, getPanelLayerSvg } from './04b-layer-panel-render.js';
import { renderTextHandles } from './09d-balloon-tools.js';
import { updateGroupHandlePositions } from './06a-polygon-geometry.js';
import {
    getI2ISettingsState, saveI2ISettingsState, sendI2IRunToWorkflowStudio,
    getT2ISettingsState, saveT2ISettingsState, requestPanelImageFromWorkflowStudio,
} from './14-integrations.js';
import { pickSdxlResolution } from '../auto-comic-core.js';
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

// I2I/T2Iバッチ生成用: 対象コマの現在の画像（panel.panelSvgContent、insertImage()等で既に挿入済みの
// コンテンツ）を、コマのbbox範囲だけラスタライズしてBlob化する。_getPageBlob（ページ全体を対象）と
// 同じ手法（embedFontsInSvg→drawSvgOnCanvas→canvas.toBlob）を、対象をページ全体ではなく単一コマの
// bboxに絞って適用したもの。panelSvgContentのルートsvgはページと同じ座標系（viewBox）で描かれて
// いるため、viewBoxをbboxへ差し替えるだけでそのコマの領域だけがクロップして描画される
// （08-panels-images.jsのinsertImage()が使う座標系と同じ）。26-auto-comic-bridge.jsの
// 半自動マンガ作成バッチ生成とも共有する。
async function _getPanelImageBlob(panel, bbox, pxW, pxH) {
    if (!panel.panelSvgContent) return null;
    const parser = new DOMParser();
    const panelDoc = parser.parseFromString(panel.panelSvgContent, 'image/svg+xml');
    const panelSvgEl = panelDoc.querySelector('svg');
    if (!panelSvgEl) return null;
    panelSvgEl.setAttribute('viewBox', `${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`);
    // デフォルトのpreserveAspectRatio="xMidYMid meet"だと、bboxとpxW/pxHのアスペクト比が
    // 一致しない場合にラスタライズ時点で余白（レターボックス）ができてしまう。コマの内容を
    // キャンバス全面に引き伸ばして描画するため"none"を明示する（insertImage側の挿入時も
    // 同じくコマ全面へストレッチするため、送信画像との整合を取る）。
    panelSvgEl.setAttribute('preserveAspectRatio', 'none');

    const serializer = new XMLSerializer();
    let svgStr = serializer.serializeToString(panelSvgEl);
    if (!svgStr.includes('xmlns="http://www.w3.org/2000/svg"')) {
        svgStr = svgStr.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    const embeddedSvg = await embedFontsInSvg(svgStr);

    const canvas = document.getElementById('render-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = pxW;
    canvas.height = pxH;
    ctx.clearRect(0, 0, pxW, pxH);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, pxW, pxH);
    await drawSvgOnCanvas(ctx, embeddedSvg, pxW, pxH);

    return await new Promise((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error(t('page.errBlobGenFailed'))), 'image/png');
    });
}

// バッチ/コマ単位生成用: 全体プロンプトとコマ個別プロンプトを結合する（どちらか一方が空でも成立する）。
// T2I/I2I/Nanobananaの全モーダル（半自動マンガ作成・レイアウトタブGenerateモーダル）で共有する。
function _composeOverallPrompt(overallPositive, panelPrompt) {
    return [overallPositive, panelPrompt].map(s => (s || '').trim()).filter(Boolean).join(', ');
}

// レイアウトタブ「I2I」モーダル用: ページのSVGサイズ（mm×100単位）だけを取得する軽量ヘルパー
// （_getPageBlobと異なり実際のラスタライズは行わない）。T2I（入力画像不要）でのページ全体対象、
// ページ全面サイズでのオーバーレイ挿入位置(placement)計算に使う。
async function _getActivePagePixelSize() {
    if (!state.activePage) {
        alert(t('layout.msgNoActivePage'));
        return null;
    }
    const pageRecord = await dbGet('pages', state.activePage.name);
    if (!pageRecord || !pageRecord.svgContent) {
        alert(t('page.msgPageDataNotFound', state.activePage.name));
        return null;
    }
    return _pi2iResolvePagePixelSize(pageRecord);
}

// ============================================================
// レイアウトタブ「Generate」モーダル（旧名: I2Iモーダル）
// 選択画像・ページ全体・コマ単位（プロンプトタブで選択）を対象に、Workflow Studio経由の
// I2I/T2I生成をその場で実行する。対象=ページ全体のときのみ「batch」チェックボックスが現れ、
// ONにすると現在ページの全コマを対象に、全体タブ＋各コマタブのプロンプトを合成して順次
// 一括生成・差し替えする（半自動マンガ作成のバッチ生成と同じ設計、スクリプト連携が無い分
// 対象は常に現在ページの全コマ）。状態はモジュールスコープに保持し、モーダルを開き直しても
// 入力値を引き継ぐ（bubble-text-modal等と異なり編集対象=既存要素という概念が無いため）。
// ============================================================

let _layoutI2ITarget    = 'page';    // 'selected' | 'page' | 'tab'
let _layoutI2IActiveTab = 'overall'; // 'overall' | panelId（プロンプトタブの選択状態）
let _layoutI2IBatch     = false;     // 対象=page のときのみ意味を持つ一括生成トグル
let _layoutI2IT2I       = false;     // ON=T2I（入力画像なしでの新規生成）、OFF=I2I
let _layoutI2IDenoise   = 1.0;
// プロンプトはタブ（全体/コマN）ごとに独立して保持する
const _layoutI2IPrompts = {
    overall: { positive: '', negative: '' },
    byPanel: {}, // panelId -> {positive, negative}
};

function _li2iPromptSlot(tabKey) {
    if (tabKey === 'overall') return _layoutI2IPrompts.overall;
    if (!_layoutI2IPrompts.byPanel[tabKey]) _layoutI2IPrompts.byPanel[tabKey] = { positive: '', negative: '' };
    return _layoutI2IPrompts.byPanel[tabKey];
}

// 生成結果URLを、コマのbboxへストレッチする明示的なplacementで、そのコマの画像として挿入する
// （26-auto-comic-bridge.jsのバッチ生成と同じ方式。preserveAspectRatio:'none'でコマ全面へ伸縮するため、
// extraAttrsを渡せないinsertImageFromUrl()ではなくinsertImage()を直接使う）
async function _li2iInsertIntoPanel(url, panelId, bbox) {
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
    state.selectedPanelId = panelId;
    state.selectedOverlay = false;
    state.selectedDraft = false;
    await insertImage(
        dataUrl, img.width, img.height,
        { preserveAspectRatio: 'none' },
        { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height },
    );
}

// 対象=選択画像: 従来通り、選択中の画像1枚（I2I）またはそのアスペクト比に合わせた新規生成（T2I）を
// 実行し、既存の挿入ロジック（既定位置・サイズ）で結果を挿入する。プロンプトは常に「全体」タブを使う。
async function _li2iRunSelected(isT2I, wf, denoise, setStatus) {
    const prompt = _li2iPromptSlot('overall');
    let result;
    if (!isT2I) {
        const blob = await _getSelectedImageBlob();
        if (!blob) return null;
        setStatus(t('layout.i2iStatusGenerating'));
        result = await sendI2IRunToWorkflowStudio(blob, { positive: prompt.positive, negative: prompt.negative, denoise }, wf);
    } else {
        const imgEl = state.selectedImageEl;
        if (!imgEl) { alert(t('layout.msgSelectImageFirst')); return null; }
        const w = parseFloat(imgEl.getAttribute('width')) || 1;
        const h = parseFloat(imgEl.getAttribute('height')) || 1;
        const { width, height } = pickSdxlResolution(w / h);
        setStatus(t('layout.i2iStatusGenerating'));
        result = await requestPanelImageFromWorkflowStudio(prompt.positive, width, height, prompt.negative, wf);
    }
    if (result?.ok) await insertImageFromUrl(result.url);
    return result;
}

// 対象=ページ全体（batch OFF）: ページ全体を1枚に合成した画像（I2I）またはページのアスペクト比に
// 合わせた新規生成（T2I）を実行し、結果は選択中のコマに関わらず常にオーバーレイへページ全面
// サイズで追加する（ラフ用途の従来動作）。プロンプトは常に「全体」タブを使う。
async function _li2iRunWholePage(isT2I, wf, denoise, setStatus) {
    const prompt = _li2iPromptSlot('overall');
    let result, pageW, pageH;
    if (!isT2I) {
        const pageResult = await _getPageBlob();
        if (!pageResult) return null;
        pageW = pageResult.pageW; pageH = pageResult.pageH;
        setStatus(t('layout.i2iStatusGenerating'));
        result = await sendI2IRunToWorkflowStudio(pageResult.blob, { positive: prompt.positive, negative: prompt.negative, denoise }, wf);
    } else {
        const size = await _getActivePagePixelSize();
        if (!size) return null;
        pageW = size.svgW; pageH = size.svgH;
        const { width, height } = pickSdxlResolution(pageW / pageH);
        setStatus(t('layout.i2iStatusGenerating'));
        result = await requestPanelImageFromWorkflowStudio(prompt.positive, width, height, prompt.negative, wf);
    }
    if (result?.ok) {
        state.selectedOverlay = true;
        state.selectedDraft = false;
        await insertImageFromUrl(result.url, { x: 0, y: 0, width: pageW, height: pageH });
    }
    return result;
}

// 対象=選択タブ・コマ: アクティブなプロンプトタブが示す単一コマだけを対象に、そのタブ自身の
// プロンプトのみ（「全体」タブとは合成しない）でI2I/T2Iを実行し、結果でそのコマの画像を置き換える
async function _li2iRunPanelTab(panelId, isT2I, wf, denoise, setStatus) {
    const panel = state.activePage?.panels?.find(p => p.id === panelId);
    const bbox = panel?.points ? getBoundingBoxFromPoints(panel.points) : null;
    if (!bbox || !bbox.width || !bbox.height) { alert(t('layout.i2iMsgPanelNotFound')); return null; }

    const prompt = _li2iPromptSlot(panelId);
    const { width, height } = pickSdxlResolution(bbox.width / bbox.height);

    let result;
    if (!isT2I) {
        const blob = await _getPanelImageBlob(panel, bbox, width, height);
        if (!blob) { alert(t('layout.i2iMsgPanelNotFound')); return null; }
        setStatus(t('layout.i2iStatusGenerating'));
        result = await sendI2IRunToWorkflowStudio(blob, { positive: prompt.positive, negative: prompt.negative, denoise }, wf);
    } else {
        setStatus(t('layout.i2iStatusGenerating'));
        result = await requestPanelImageFromWorkflowStudio(prompt.positive, width, height, prompt.negative, wf);
    }

    if (result?.ok) await _li2iInsertIntoPanel(result.url, panelId, bbox);
    return result;
}

// 対象=ページ全体＋batch ON: 現在ページの全コマそれぞれについて、「全体」タブのプロンプト＋
// そのコマのタブのプロンプトを合成してI2I/T2Iを順次実行し、結果でそのコマの画像を置き換える
async function _li2iRunBatch(isT2I, wf, denoise, setStatus) {
    const panels = state.activePage?.panels || [];
    if (panels.length === 0) { alert(t('layout.msgNoActivePage')); return null; }

    pushHistory();

    const overall = _li2iPromptSlot('overall');
    let successCount = 0, failCount = 0;
    for (let i = 0; i < panels.length; i++) {
        const panel = panels[i];
        setStatus(t('layout.i2iBatchProgress', i + 1, panels.length));

        const bbox = panel.points ? getBoundingBoxFromPoints(panel.points) : null;
        if (!bbox || !bbox.width || !bbox.height) { failCount++; continue; }

        const panelPrompt = _li2iPromptSlot(panel.id);
        const positive = _composeOverallPrompt(overall.positive, panelPrompt.positive);
        const negative = _composeOverallPrompt(overall.negative, panelPrompt.negative);
        const { width, height } = pickSdxlResolution(bbox.width / bbox.height);

        try {
            let result;
            if (!isT2I) {
                const blob = await _getPanelImageBlob(panel, bbox, width, height);
                if (!blob) { failCount++; continue; }
                result = await sendI2IRunToWorkflowStudio(blob, { positive, negative, denoise }, wf);
            } else {
                result = await requestPanelImageFromWorkflowStudio(positive, width, height, negative, wf);
            }
            if (!result?.ok || !result.url) { failCount++; continue; }
            await _li2iInsertIntoPanel(result.url, panel.id, bbox);
            successCount++;
        } catch (e) {
            console.error('[Layout Generate] batch panel error:', panel.id, e);
            failCount++;
        }
    }

    setStatus('');
    return { successCount, failCount };
}

function openLayoutI2IModal() {
    _layoutI2ITarget = state.selectedImageEl ? 'selected' : 'page';
    // アクティブタブのコマがページ切替等で存在しなくなっていれば「全体」タブへフォールバックする
    const panels = state.activePage?.panels || [];
    if (_layoutI2IActiveTab !== 'overall' && !panels.some(p => p.id === _layoutI2IActiveTab)) {
        _layoutI2IActiveTab = 'overall';
    }

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
                    <button type="button" class="btn small secondary li2i-target-btn" data-target="tab" title="${t('layout.i2iTargetTabTitle')}">${t('layout.i2iTargetTab')}</button>
                </div>
                <label id="li2i-batch-row" style="display:none; cursor:pointer; align-items:center; gap:4px; margin-left:8px;" title="${t('layout.i2iBatchTitle')}">
                    <input type="checkbox" id="li2i-batch-enabled"> ${t('layout.i2iBatchLabel')}
                </label>
                <span style="flex:1;"></span>
                <span id="li2i-status" style="font-size:12px; color:var(--text-secondary);"></span>
                <label style="cursor:pointer; display:flex; align-items:center; gap:4px;" title="${t('layout.i2iT2ITitle')}">
                    <input type="checkbox" id="li2i-t2i-enabled"> ${t('layout.i2iT2ILabel')}
                </label>
                <button type="button" id="li2i-run-btn" class="btn primary">${t('layout.i2iRunBtn')}</button>
            </div>
            <div class="li2i-tabs" id="li2i-tabs"></div>
            <div class="fontmgr-style-group" style="flex-direction:column; align-items:stretch;">
                <label class="fontmgr-style-group-label">${t('layout.i2iPositiveLabel')}</label>
                <textarea id="li2i-positive" rows="4"></textarea>
            </div>
            <div class="fontmgr-style-group" style="flex-direction:column; align-items:stretch;">
                <label class="fontmgr-style-group-label">${t('layout.i2iNegativeLabel')}</label>
                <textarea id="li2i-negative" rows="4"></textarea>
            </div>
            <div class="fontmgr-style-group" id="li2i-denoise-row">
                <label>${t('layout.i2iDenoiseLabel')}</label>
                <input type="number" id="li2i-denoise" min="0" max="1" step="0.01" style="width:70px;">
            </div>
            <details class="li2i-settings-details">
                <summary style="cursor:pointer; color:var(--text-secondary); font-size:11px; letter-spacing:0.05em; user-select:none; padding:4px 0;">${t('layout.i2iSettingsHeading')}</summary>
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
                    <label style="cursor:pointer; display:flex; align-items:center; gap:4px;">
                        <input type="checkbox" id="li2i-t2i-default-wf-enabled"> ${t('layout.t2iUseDefaultWf')}
                    </label>
                </div>
                <div class="fontmgr-style-group" style="flex-direction:column; align-items:stretch;">
                    <label class="fontmgr-style-group-label">${t('layout.t2iWfFileLabel')}</label>
                    <input type="text" id="li2i-t2i-default-wf-name" placeholder="cc_t2i_default.json">
                </div>
                <div class="fontmgr-style-group">
                    <button type="button" id="li2i-settings-save-btn" class="btn small secondary">${t('common.save')}</button>
                    <span id="li2i-settings-status" style="font-size:11px; color:var(--text-secondary); margin-left:8px;"></span>
                </div>
            </details>
        </div>
    `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const $ = id => dialog.querySelector('#' + id);

    // プロンプトタブ（全体 + コマ1, コマ2, ... + サブコマ1, サブコマ2, ...）。
    // サブコマもparentPanelId付きの通常エントリとしてstate.activePage.panelsに含まれるため、
    // 同じ「コマN」ラベルを共有すると通常のコマと区別が付かなくなる（2026-08-25発覚）。
    // 通常コマとサブコマで別々の連番・ラベル形式にして判別できるようにする。
    const tabsEl = $('li2i-tabs');
    const makeTabBtn = (key, label) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn small secondary li2i-tab-btn';
        btn.textContent = label;
        btn.dataset.tabKey = key;
        tabsEl.appendChild(btn);
    };
    let panelNo = 0, subPanelNo = 0;
    panels.forEach(p => {
        if (p.parentPanelId) {
            makeTabBtn(p.id, t('layout.i2iTabSubPanel', ++subPanelNo));
        } else {
            makeTabBtn(p.id, t('layout.i2iTabPanel', ++panelNo));
        }
    });
    // 「全体」タブは常に先頭に挿入（コマ一覧より前に描画したいため後からunshift相当で先頭挿入）
    const overallBtn = document.createElement('button');
    overallBtn.type = 'button';
    overallBtn.className = 'btn small secondary li2i-tab-btn';
    overallBtn.textContent = t('layout.i2iTabOverall');
    overallBtn.dataset.tabKey = 'overall';
    tabsEl.insertBefore(overallBtn, tabsEl.firstChild);

    const syncPromptFields = () => {
        const slot = _li2iPromptSlot(_layoutI2IActiveTab);
        $('li2i-positive').value = slot.positive;
        $('li2i-negative').value = slot.negative;
    };
    const syncTabButtons = () => {
        dialog.querySelectorAll('.li2i-tab-btn').forEach(b => {
            const active = b.dataset.tabKey === _layoutI2IActiveTab;
            b.classList.toggle('active', active);
            b.classList.toggle('secondary', !active);
        });
    };
    syncTabButtons();
    syncPromptFields();
    tabsEl.addEventListener('click', e => {
        const btn = e.target.closest('.li2i-tab-btn');
        if (!btn) return;
        _layoutI2IActiveTab = btn.dataset.tabKey;
        syncTabButtons();
        syncPromptFields();
    });

    $('li2i-positive').addEventListener('input', e => { _li2iPromptSlot(_layoutI2IActiveTab).positive = e.target.value; });
    $('li2i-negative').addEventListener('input', e => { _li2iPromptSlot(_layoutI2IActiveTab).negative = e.target.value; });

    $('li2i-denoise').value = _layoutI2IDenoise;
    $('li2i-denoise').addEventListener('input', e => {
        _layoutI2IDenoise = Math.max(0, Math.min(1, parseFloat(e.target.value)));
        if (Number.isNaN(_layoutI2IDenoise)) _layoutI2IDenoise = 1.0;
    });

    const syncTargetButtons = () => {
        dialog.querySelectorAll('.li2i-target-btn').forEach(b => {
            const active = b.dataset.target === _layoutI2ITarget;
            b.classList.toggle('active', active);
            b.classList.toggle('secondary', !active);
        });
        $('li2i-batch-row').style.display = _layoutI2ITarget === 'page' ? 'flex' : 'none';
    };
    syncTargetButtons();
    dialog.querySelectorAll('.li2i-target-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            _layoutI2ITarget = btn.dataset.target;
            syncTargetButtons();
        });
    });

    $('li2i-batch-enabled').checked = _layoutI2IBatch;
    $('li2i-batch-enabled').addEventListener('change', e => { _layoutI2IBatch = e.target.checked; });

    const syncT2IUI = () => { $('li2i-denoise-row').style.display = _layoutI2IT2I ? 'none' : 'flex'; };
    $('li2i-t2i-enabled').checked = _layoutI2IT2I;
    syncT2IUI();
    $('li2i-t2i-enabled').addEventListener('change', e => {
        _layoutI2IT2I = e.target.checked;
        syncT2IUI();
    });

    // I2I/T2I設定（Imageタブの Select I2I パネルと共有データ、14-integrations.js）
    const curI2I = getI2ISettingsState();
    $('li2i-default-wf-enabled').checked = curI2I.enabled;
    $('li2i-default-wf-name').value = curI2I.file;
    const curT2I = getT2ISettingsState();
    $('li2i-t2i-default-wf-enabled').checked = curT2I.enabled;
    $('li2i-t2i-default-wf-name').value = curT2I.file;
    $('li2i-settings-save-btn').addEventListener('click', () => {
        saveI2ISettingsState($('li2i-default-wf-enabled').checked, $('li2i-default-wf-name').value);
        saveT2ISettingsState($('li2i-t2i-default-wf-enabled').checked, $('li2i-t2i-default-wf-name').value);
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

        const isT2I = $('li2i-t2i-enabled').checked;
        // Runは常にモーダルに今表示されているチェックボックス/ファイル名の値を使う
        // （「保存」ボタンは次回モーダルを開いたときの初期値を保存するだけで、Run自体には影響しない）
        const wf = isT2I
            ? { enabled: $('li2i-t2i-default-wf-enabled').checked, file: $('li2i-t2i-default-wf-name').value }
            : { enabled: $('li2i-default-wf-enabled').checked, file: $('li2i-default-wf-name').value };
        const denoise = _layoutI2IDenoise;

        runBtn.disabled = true;
        runBtn.textContent = t('layout.i2iRunningBtn');

        try {
            if (_layoutI2ITarget === 'page' && $('li2i-batch-enabled').checked) {
                setStatus('');
                const result = await _li2iRunBatch(isT2I, wf, denoise, setStatus);
                if (!result) return;
                if (result.successCount === 0) { alert(t('layout.i2iBatchAllFailed')); return; }
                closeAndCleanup();
                alert(result.failCount > 0
                    ? t('layout.i2iBatchFailedSome', result.successCount, result.failCount)
                    : t('layout.i2iBatchSuccess', result.successCount));
                return;
            }

            if (_layoutI2ITarget === 'tab' && _layoutI2IActiveTab === 'overall') {
                alert(t('layout.i2iMsgSelectPanelTab'));
                return;
            }

            setStatus(t('layout.i2iStatusUploading'));
            let result;
            if (_layoutI2ITarget === 'selected') {
                result = await _li2iRunSelected(isT2I, wf, denoise, setStatus);
            } else if (_layoutI2ITarget === 'tab') {
                result = await _li2iRunPanelTab(_layoutI2IActiveTab, isT2I, wf, denoise, setStatus);
            } else {
                result = await _li2iRunWholePage(isT2I, wf, denoise, setStatus);
            }
            if (result === null) { setStatus(''); return; } // 事前チェック（未選択・bbox取得失敗等）でアラート済み

            if (!result?.ok) throw new Error(result?.message || 'Generate failed');
            setStatus(t('layout.i2iStatusDone'));
            closeAndCleanup();
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

export {
    initPixiFxButtons, openImageTabWithSelected, openLayoutI2IModal, moveSelectedObjectToCenter,
    _getPanelImageBlob, _composeOverallPrompt,
};

// まだESM化されていない main/以下の classic <script> から呼べるようにするブリッジ
// （ESモジュール化移行中の一時措置。全分割ファイルのESM化が完了したら、
//  各呼び出し元をimport文に置き換えてこのブロックごと削除する）。
window.initPixiFxButtons = initPixiFxButtons;
window.openImageTabWithSelected = openImageTabWithSelected;
window.openLayoutI2IModal = openLayoutI2IModal;
window.moveSelectedObjectToCenter = moveSelectedObjectToCenter;

