// ============================================================
// 半自動マンガ作成 Phase 1/2: スクリプト⇄コマ対応付け・フキダシ自動生成ブリッジ
// スクリプトタブ「プロット」に設置した2つのボタンから、レイアウトタブで選択中の
// ページ（テンプレート適用済み）のパネルと、表示中のスクリプトページのコマ・セリフ・
// 画像プロンプトを auto-comic-core.js の mapScriptPageToPanels() でパネル番号順に
// 対応付ける。
// - 「このページをレイアウトに流し込む」(Phase 1): 対応付け結果を一覧表示するのみ。
// - 「フキダシを自動生成」(Phase 2): 対応付け結果をもとに、各コマへセリフ件数分の
//   フキダシ（角丸矩形固定・コマ内で上から均等配置）を自動生成しテキストを流し込む。
// 画像のバッチ生成（Workflow Studio連携）はPhase 3で追加する。
// type="module" として読み込まれる。initProjectTab()と同様、'project'タブへの
// 切替時に01-state.jsから初期化される。
// ============================================================

import { t } from '../i18n.js';
import { state, switchTab } from './01-state.js';
import { _script, _scriptIsMangaLikeType } from './21-script-tab.js';
import { _scriptManga, _scriptMangaData } from './21a-script-manga.js';
import { mapScriptPageToPanels } from '../auto-comic-core.js';
import { getBoundingBoxFromPoints } from './08-panels-images.js';
import { getPanelLayerSvg } from './04b-layer-panel-render.js';
import { pushHistory } from './07-pages.js';
import { createBalloonAtPosition } from './09c-balloon-handles.js';
import { applyBubbleTextToShape, BUBBLE_TEXT_PT_TO_SVG } from './09f-bubble-text.js';

// Phase 2 v1のフキダシ形状は角丸矩形に固定する（スクリプト側での形状指定は将来検討事項として保留）
const AUTO_BALLOON_TYPE = 'rect';

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

let _autoComicBridgeInited = false;
function initAutoComicBridge() {
    if (_autoComicBridgeInited) return;
    _autoComicBridgeInited = true;
    document.getElementById('script-autocomic-map-btn')?.addEventListener('click', _handleAutoComicMapClick);
    document.getElementById('script-autocomic-balloon-btn')?.addEventListener('click', _handleAutoBalloonGenerateClick);
}

export { initAutoComicBridge };
