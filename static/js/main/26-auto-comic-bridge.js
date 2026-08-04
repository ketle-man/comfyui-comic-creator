// ============================================================
// 半自動マンガ作成 Phase 1/2/3: スクリプト⇄コマ対応付け・フキダシ自動生成・
// Workflow Studio連携バッチ画像生成（T2I/I2I）ブリッジ
// スクリプトタブ「プロット」に設置したボタンから、レイアウトタブで選択中の
// ページ（テンプレート適用済み）のパネルと、表示中のスクリプトページのコマ・セリフ・
// 画像プロンプトを auto-comic-core.js の mapScriptPageToPanels() でパネル番号順に
// 対応付ける。
// - 「このページをレイアウトに流し込む」(Phase 1): 対応付け結果を一覧表示するのみ。
// - 「フキダシを自動生成」(Phase 2): 対応付け結果をもとに、各コマへセリフ件数分の
//   フキダシ（角丸矩形固定・コマ内で上から均等配置）を自動生成しテキストを流し込む。
// - 「画像を一括生成」(Phase 3, T2I): 対応付け結果のうち画像プロンプトが入力されている
//   各コマについて、コマのbboxアスペクト比に応じたSDXL標準解像度でWorkflow Studio
//   経由の画像生成を順次リクエストし、結果を該当コマへ挿入する（sloppy-comicの
//   逐次forループと同じ設計）。
// - 「画像を一括生成（I2I）」(Phase 3追加分): 対応付け済みの各コマの現在の画像を入力に、
//   モーダルの全体指示（Positive/Negative）＋コマごとの画像プロンプトを組み合わせて
//   Workflow StudioのI2I（15-pixifx-bridge.jsのレイアウトタブI2Iモーダルと同じ
//   sendI2IRunToWorkflowStudio()経路）を順次リクエストし、結果で該当コマの画像を置き換える。
// type="module" として読み込まれる。initProjectTab()と同様、'project'タブへの
// 切替時に01-state.jsから初期化される。
// ============================================================

import { t } from '../i18n.js';
import { state, switchTab } from './01-state.js';
import { _script, _scriptIsMangaLikeType } from './21-script-tab.js';
import { _scriptManga, _scriptMangaData } from './21a-script-manga.js';
import { mapScriptPageToPanels, pickSdxlResolution } from '../auto-comic-core.js';
import { getBoundingBoxFromPoints, insertImage } from './08-panels-images.js';
import { getPanelLayerSvg } from './04b-layer-panel-render.js';
import { pushHistory } from './07-pages.js';
import { createBalloonAtPosition } from './09c-balloon-handles.js';
import { applyBubbleTextToShape, BUBBLE_TEXT_PT_TO_SVG } from './09f-bubble-text.js';
import { requestPanelImageFromWorkflowStudio, sendI2IRunToWorkflowStudio, getI2ISettingsState, saveI2ISettingsState } from './14-integrations.js';
import { embedFontsInSvg, drawSvgOnCanvas } from './12-text-png-export.js';

// Phase 2 v1のフキダシ形状は角丸矩形に固定する（スクリプト側での形状指定は将来検討事項として保留）
const AUTO_BALLOON_TYPE = 'rect';

// Workflow Studioの生成結果URL（blob: URL等、ページリロード後は無効になる一時参照のことがある）を
// fetchしてbase64データURLへ変換する。insertImage()はhrefへ渡された文字列をそのままSVGに永続化する
// ため、blob: URLを直接渡すと保存→再読込後に画像が壊れる（insertImageFromUrl()と同じ変換パターン）。
async function _urlToDataUrl(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// I2I一括生成用: 対象コマの現在の画像（panel.panelSvgContent、insertImage()等で既に挿入済みの
// コンテンツ）を、コマのbbox範囲だけラスタライズしてBlob化する。15-pixifx-bridge.jsの
// _getPageBlob（ページ全体を対象）と同じ手法（embedFontsInSvg→drawSvgOnCanvas→canvas.toBlob）を、
// 対象をページ全体ではなく単一コマのbboxに絞って適用したもの。panelSvgContentのルートsvgは
// ページと同じ座標系（viewBox）で描かれているため、viewBoxをbboxへ差し替えるだけでそのコマの
// 領域だけがクロップして描画される（08-panels-images.jsのinsertImage()が使う座標系と同じ）。
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

// スクリプトの表示中ページと、レイアウトタブで選択中のページの実パネルを対応付ける。
// 戻り値: null（メディア種別が対象外）| { error: 'noActivePage' } | { mapped, warning }
function _computeMapping() {
    if (!_script.data || !_scriptIsMangaLikeType(_script.data.mediaType)) return null;
    const panels = state.activePage?.panels;
    if (!panels || panels.length === 0) return { error: 'noActivePage' };
    const scriptPage = _scriptMangaData()?.pages?.[_scriptManga.pageIdx];
    const { mapped, warning } = mapScriptPageToPanels(scriptPage, panels);
    return { mapped, warning, error: null };
}

function _autoComicRenderResult(mapped, warning) {
    const container = document.getElementById('script-autocomic-map-result');
    const statusEl = document.getElementById('script-autocomic-map-status');
    if (!container) return;

    container.innerHTML = '';

    if (warning) {
        const warnEl = document.createElement('p');
        warnEl.className = 'script-autocomic-warning';
        warnEl.textContent = t('script.autoComicMapCountMismatch', warning.templateCount, warning.scriptCount);
        container.appendChild(warnEl);
    }

    if (mapped.length === 0) {
        if (statusEl) statusEl.textContent = '';
        return;
    }

    const header = document.createElement('div');
    header.className = 'project-section-label';
    header.textContent = t('script.autoComicMapResultHeader');
    container.appendChild(header);

    const list = document.createElement('ul');
    list.className = 'script-autocomic-result-list';
    mapped.forEach(item => {
        const li = document.createElement('li');
        li.textContent = t('script.autoComicMapResultRow', item.panelNumber, item.dialogues.length);
        list.appendChild(li);
    });
    container.appendChild(list);

    if (statusEl) statusEl.textContent = t('script.autoComicMapSuccess', mapped.length);
}

function _handleAutoComicMapClick() {
    const result = _computeMapping();
    if (!result) return;
    if (result.error === 'noActivePage') { alert(t('script.autoComicMapNoActivePage')); return; }
    _autoComicRenderResult(result.mapped, result.warning);
}

// 対応付け済みの各コマについて、セリフ（空文字は除く）の件数分フキダシを生成する。
// 配置はコマのbbox内で上から均等配置する単純な方式（v1）。フォントサイズはコマの
// 分割サイズに収まる範囲で、レイアウトタブの現在のフキダシ既定値を上限に自動調整する。
async function _handleAutoBalloonGenerateClick() {
    const result = _computeMapping();
    if (!result) return;
    if (result.error === 'noActivePage') { alert(t('script.autoComicMapNoActivePage')); return; }

    const { mapped, warning } = result;
    _autoComicRenderResult(mapped, warning);
    if (mapped.length === 0) { alert(t('script.autoComicBalloonNoDialogue')); return; }

    const overlaySvgEl = getPanelLayerSvg();
    if (!overlaySvgEl) { alert(t('script.autoComicMapNoActivePage')); return; }

    pushHistory();

    let createdCount = 0;
    for (const item of mapped) {
        const dialogues = (item.dialogues || []).filter(d => d.text && d.text.trim());
        if (dialogues.length === 0) continue;

        const panel = state.activePage.panels.find(p => p.id === item.panelId);
        if (!panel || !panel.points) continue;
        const bbox = getBoundingBoxFromPoints(panel.points);
        if (!bbox) continue;

        state.selectedPanelId = item.panelId;
        state.selectedOverlay = false;

        const slotHeight = bbox.height / dialogues.length;
        const rx = bbox.width * 0.35;
        const ry = Math.min(slotHeight * 0.35, bbox.height * 0.2);
        // フキダシに収まる範囲でフォントサイズを決める（レイアウトタブの現在のフキダシ既定値を上限とする）
        const fontSizePt = Math.max(20, Math.min(state.balloon.fontSize, Math.round((ry * 0.55) / BUBBLE_TEXT_PT_TO_SVG)));

        for (let i = 0; i < dialogues.length; i++) {
            const cx = bbox.x + bbox.width / 2;
            const cy = bbox.y + slotHeight * (i + 0.5);
            const shape = createBalloonAtPosition(overlaySvgEl, AUTO_BALLOON_TYPE, cx, cy, rx, ry);
            await applyBubbleTextToShape(shape, {
                text: dialogues[i].text,
                fontSizePt,
                textAlign: 'center',
                textValign: 'center',
                fontFamily: state.balloon.fontFamily,
                vertical: state.balloon.isVertical,
                textColor: state.balloon.textColor,
            });
            createdCount++;
        }
    }

    if (createdCount === 0) { alert(t('script.autoComicBalloonNoDialogue')); return; }

    await switchTab('layout');
    alert(t('script.autoComicBalloonSuccess', createdCount));
}

// 対応付け済みのコマのうち、画像プロンプトが入力されている各コマについて、コマのbboxアスペクト比に
// 応じたSDXL標準解像度でWorkflow Studio経由の画像生成を順次リクエストし、結果を該当コマへ挿入する。
async function _handleAutoImageGenerateClick() {
    const mapping = _computeMapping();
    if (!mapping) return;
    if (mapping.error === 'noActivePage') { alert(t('script.autoComicMapNoActivePage')); return; }

    const { mapped, warning } = mapping;
    _autoComicRenderResult(mapped, warning);

    const targets = mapped.filter(item => item.imagePrompt && item.imagePrompt.trim());
    if (targets.length === 0) { alert(t('script.autoComicGenerateNoPrompt')); return; }

    const statusEl = document.getElementById('script-autocomic-map-status');

    pushHistory();

    let successCount = 0;
    let failCount = 0;
    for (let i = 0; i < targets.length; i++) {
        const item = targets[i];
        if (statusEl) statusEl.textContent = t('script.autoComicGenerateProgress', i + 1, targets.length);

        const panel = state.activePage.panels.find(p => p.id === item.panelId);
        const bbox = panel?.points ? getBoundingBoxFromPoints(panel.points) : null;
        if (!bbox || !bbox.width || !bbox.height) { failCount++; continue; }

        const { width, height } = pickSdxlResolution(bbox.width / bbox.height);
        const genResult = await requestPanelImageFromWorkflowStudio(item.imagePrompt, width, height);
        if (!genResult?.ok || !genResult.url) {
            console.warn('[AutoComic] generate failed for panel', item.panelId, genResult?.message);
            failCount++;
            continue;
        }

        try {
            const dataUrl = await _urlToDataUrl(genResult.url);
            const img = new Image();
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
                img.src = dataUrl;
            });
            state.selectedPanelId = item.panelId;
            state.selectedOverlay = false;
            // アスペクト比を保ったまま幅だけ揃える既定挙動だと、SDXL標準解像度とコマの
            // アスペクト比がズレた場合にコマ内に余白ができてしまうため、bboxへストレッチする
            // 明示的なplacementを渡す（15-pixifx-bridge.jsのページ全体I2Iと同じ方式）。
            // <image>要素自体もpreserveAspectRatio未指定だとplacementの箱の中でさらに
            // アスペクト比維持フィットされてしまうため、'none'を明示してbbox全面に伸縮させる。
            await insertImage(
                dataUrl, img.width, img.height,
                { preserveAspectRatio: 'none' },
                { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height },
            );
            successCount++;
        } catch (e) {
            console.error('[AutoComic] image insert error:', e);
            failCount++;
        }
    }

    if (statusEl) statusEl.textContent = '';

    if (successCount === 0) {
        alert(t('script.autoComicGenerateAllFailed'));
        return;
    }

    await switchTab('layout');
    alert(failCount > 0
        ? t('script.autoComicGenerateFailedSome', successCount, failCount)
        : t('script.autoComicGenerateSuccess', successCount));
}

// ============================================================
// 「画像を一括生成（I2I）」モーダル
// レイアウトタブのI2Iモーダル（15-pixifx-bridge.js openLayoutI2IModal）をベースにした
// スクリプトタブ版。既存I2Iモーダルと異なり対象選択（選択画像/ページ全体）は無く、
// 常に対応付け済みの全コマが対象。Positiveはモーダルの全体指示＋コマごとの画像プロンプトを
// 結合、Negativeはモーダルの全体指示のみを使う。状態はモジュールスコープに保持し、
// モーダルを開き直しても入力値を引き継ぐ（openLayoutI2IModalと同じ設計）。
// ============================================================

let _autoI2IPositive = '';
let _autoI2INegative = '';
let _autoI2IDenoise = 1.0;
let _autoI2ISkipEmptyPrompt = false;

// モーダルの全体Positiveとコマごとの画像プロンプトを結合する（どちらか一方が空でも成立する）
function _composeI2IPositive(overallPositive, panelPrompt) {
    return [overallPositive, panelPrompt].map(s => (s || '').trim()).filter(Boolean).join(', ');
}

// 対応付け済みの各コマについて、コマの現在の画像を入力にI2Iを順次リクエストし、結果で置き換える。
// skipEmptyPromptがtrueの場合、コマの画像プロンプトが空のコマはスルーする（T2Iと同じ絞り込み）。
// falseの場合は全対応付け済みコマが対象（モーダルの全体Positive/Negativeのみでも処理される）。
async function _runAutoImageGenerateI2I({ positive, negative, denoise, skipEmptyPrompt }, statusEl) {
    const mapping = _computeMapping();
    if (!mapping) return { ok: false };
    if (mapping.error === 'noActivePage') { alert(t('script.autoComicMapNoActivePage')); return { ok: false }; }

    const { mapped, warning } = mapping;
    _autoComicRenderResult(mapped, warning);

    const targets = skipEmptyPrompt
        ? mapped.filter(item => item.imagePrompt && item.imagePrompt.trim())
        : mapped;
    if (targets.length === 0) { alert(t('script.autoComicGenerateNoPrompt')); return { ok: false }; }

    pushHistory();

    let successCount = 0;
    let failCount = 0;
    for (let i = 0; i < targets.length; i++) {
        const item = targets[i];
        if (statusEl) statusEl.textContent = t('script.autoComicGenerateProgress', i + 1, targets.length);

        const panel = state.activePage.panels.find(p => p.id === item.panelId);
        const bbox = panel?.points ? getBoundingBoxFromPoints(panel.points) : null;
        if (!bbox || !bbox.width || !bbox.height) { failCount++; continue; }

        try {
            const { width, height } = pickSdxlResolution(bbox.width / bbox.height);
            const blob = await _getPanelImageBlob(panel, bbox, width, height);
            if (!blob) { failCount++; continue; }

            const genResult = await sendI2IRunToWorkflowStudio(blob, {
                positive: _composeI2IPositive(positive, item.imagePrompt),
                negative,
                denoise,
            });
            if (!genResult?.ok || !genResult.url) {
                console.warn('[AutoComic I2I] generate failed for panel', item.panelId, genResult?.message);
                failCount++;
                continue;
            }

            const dataUrl = await _urlToDataUrl(genResult.url);
            const img = new Image();
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
                img.src = dataUrl;
            });
            state.selectedPanelId = item.panelId;
            state.selectedOverlay = false;
            // T2Iバッチと同じ理由で、bboxへストレッチする明示的なplacement＋preserveAspectRatio="none"を渡す
            await insertImage(
                dataUrl, img.width, img.height,
                { preserveAspectRatio: 'none' },
                { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height },
            );
            successCount++;
        } catch (e) {
            console.error('[AutoComic I2I] image insert error:', e);
            failCount++;
        }
    }

    if (statusEl) statusEl.textContent = '';
    return { ok: true, successCount, failCount };
}

function _openAutoComicI2IModal() {
    const overlay = document.createElement('div');
    overlay.className = 'tsm-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'tsm-dialog li2i-dialog';
    dialog.innerHTML = `
        <div class="tsm-header">
            <h3>${t('script.autoI2IModalHeading')}</h3>
            <button type="button" id="ai2i-close-btn" class="tsm-close-btn" title="${t('common.close')}">×</button>
        </div>
        <div class="tsm-body li2i-body">
            <div class="fontmgr-style-group" style="flex-direction:column; align-items:stretch;">
                <label class="fontmgr-style-group-label">${t('script.autoI2IPositiveLabel')}</label>
                <textarea id="ai2i-positive" rows="5"></textarea>
                <span style="font-size:11px; color:var(--text-secondary);">${t('script.autoI2IPositiveHint')}</span>
            </div>
            <div class="fontmgr-style-group" style="flex-direction:column; align-items:stretch;">
                <label class="fontmgr-style-group-label">${t('script.autoI2INegativeLabel')}</label>
                <textarea id="ai2i-negative" rows="5"></textarea>
            </div>
            <div class="fontmgr-style-group">
                <label>${t('layout.i2iDenoiseLabel')}</label>
                <input type="number" id="ai2i-denoise" min="0" max="1" step="0.01" style="width:70px;">
            </div>
            <div class="fontmgr-style-group">
                <label style="cursor:pointer; display:flex; align-items:center; gap:4px;">
                    <input type="checkbox" id="ai2i-skip-empty-prompt"> ${t('script.autoI2ISkipEmptyPromptLabel')}
                </label>
            </div>
            <div class="fontmgr-style-group">
                <span id="ai2i-status" style="font-size:12px; color:var(--text-secondary);"></span>
                <button type="button" id="ai2i-run-btn" class="btn primary" style="margin-left:auto;">${t('layout.i2iRunBtn')}</button>
            </div>
            <div style="margin:8px 0 4px; border-top:1px solid var(--border-color); padding-top:8px; font-size:11px; color:var(--text-secondary); letter-spacing:0.05em;">
                ${t('layout.i2iSettingsHeading')}
            </div>
            <div class="fontmgr-style-group">
                <label style="cursor:pointer; display:flex; align-items:center; gap:4px;">
                    <input type="checkbox" id="ai2i-default-wf-enabled"> ${t('layout.i2iUseDefaultWf')}
                </label>
            </div>
            <div class="fontmgr-style-group" style="flex-direction:column; align-items:stretch;">
                <label class="fontmgr-style-group-label">${t('layout.i2iWfFileLabel')}</label>
                <input type="text" id="ai2i-default-wf-name" placeholder="cc_i2i_default.json">
            </div>
            <div class="fontmgr-style-group">
                <button type="button" id="ai2i-settings-save-btn" class="btn small secondary">${t('common.save')}</button>
                <span id="ai2i-settings-status" style="font-size:11px; color:var(--text-secondary); margin-left:8px;"></span>
            </div>
        </div>
    `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const $ = id => dialog.querySelector('#' + id);

    $('ai2i-positive').value = _autoI2IPositive;
    $('ai2i-negative').value = _autoI2INegative;
    $('ai2i-denoise').value  = _autoI2IDenoise;
    $('ai2i-skip-empty-prompt').checked = _autoI2ISkipEmptyPrompt;

    $('ai2i-positive').addEventListener('input', e => { _autoI2IPositive = e.target.value; });
    $('ai2i-negative').addEventListener('input', e => { _autoI2INegative = e.target.value; });
    $('ai2i-denoise').addEventListener('input', e => {
        _autoI2IDenoise = Math.max(0, Math.min(1, parseFloat(e.target.value)));
        if (Number.isNaN(_autoI2IDenoise)) _autoI2IDenoise = 1.0;
    });
    $('ai2i-skip-empty-prompt').addEventListener('change', e => { _autoI2ISkipEmptyPrompt = e.target.checked; });

    // I2I設定（レイアウトタブのI2Iモーダル・ImageタブのSelect I2Iパネルと共有データ、14-integrations.js）
    const curWf = getI2ISettingsState();
    $('ai2i-default-wf-enabled').checked = curWf.enabled;
    $('ai2i-default-wf-name').value = curWf.file;
    $('ai2i-settings-save-btn').addEventListener('click', () => {
        saveI2ISettingsState($('ai2i-default-wf-enabled').checked, $('ai2i-default-wf-name').value);
        const wfStatusEl = $('ai2i-settings-status');
        wfStatusEl.textContent = t('layout.i2iSettingsSaved');
        setTimeout(() => { wfStatusEl.textContent = ''; }, 2000);
    });

    const close = () => document.body.removeChild(overlay);
    const onKeydown = (e) => { if (e.key === 'Escape') closeAndCleanup(); };
    document.addEventListener('keydown', onKeydown);
    const closeAndCleanup = () => { document.removeEventListener('keydown', onKeydown); close(); };

    $('ai2i-close-btn').addEventListener('click', closeAndCleanup);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeAndCleanup(); });

    $('ai2i-run-btn').addEventListener('click', async () => {
        const runBtn = $('ai2i-run-btn');
        const statusEl = $('ai2i-status');

        runBtn.disabled = true;
        runBtn.textContent = t('layout.i2iRunningBtn');

        const result = await _runAutoImageGenerateI2I({
            positive: _autoI2IPositive,
            negative: _autoI2INegative,
            denoise: _autoI2IDenoise,
            skipEmptyPrompt: _autoI2ISkipEmptyPrompt,
        }, statusEl);

        runBtn.disabled = false;
        runBtn.textContent = t('layout.i2iRunBtn');

        if (!result.ok) return;
        if (result.successCount === 0) {
            alert(t('script.autoComicGenerateAllFailed'));
            return;
        }

        closeAndCleanup();
        await switchTab('layout');
        alert(result.failCount > 0
            ? t('script.autoComicGenerateFailedSome', result.successCount, result.failCount)
            : t('script.autoComicGenerateSuccess', result.successCount));
    });
}

let _autoComicBridgeInited = false;
function initAutoComicBridge() {
    if (_autoComicBridgeInited) return;
    _autoComicBridgeInited = true;
    document.getElementById('script-autocomic-map-btn')?.addEventListener('click', _handleAutoComicMapClick);
    document.getElementById('script-autocomic-balloon-btn')?.addEventListener('click', _handleAutoBalloonGenerateClick);
    document.getElementById('script-autocomic-generate-btn')?.addEventListener('click', _handleAutoImageGenerateClick);
    document.getElementById('script-autocomic-generate-i2i-btn')?.addEventListener('click', _openAutoComicI2IModal);
}

export { initAutoComicBridge };
