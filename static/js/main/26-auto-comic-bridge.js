// ============================================================
// 半自動マンガ作成 Phase 1: スクリプト⇄コマ対応付けブリッジ
// スクリプトタブ「プロット」に設置した「このページをレイアウトに流し込む」ボタンから、
// レイアウトタブで選択中のページ（テンプレート適用済み）のパネルと、表示中の
// スクリプトページのコマ・セリフ・画像プロンプトを auto-comic-core.js の
// mapScriptPageToPanels() でパネル番号順に対応付け、結果を一覧表示する。
// この時点ではフキダシ・画像はまだ生成しない（Phase 2/3で本ブリッジを拡張する）。
// type="module" として読み込まれる。initProjectTab()と同様、'project'タブへの
// 切替時に01-state.jsから初期化される。
// ============================================================

import { t } from '../i18n.js';
import { state } from './01-state.js';
import { _script } from './21-script-tab.js';
import { _scriptManga } from './21a-script-manga.js';
import { mapScriptPageToPanels } from '../auto-comic-core.js';

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
    if (!_script.data || _script.data.mediaType !== 'manga') return;

    const panels = state.activePage?.panels;
    if (!panels || panels.length === 0) {
        alert(t('script.autoComicMapNoActivePage'));
        return;
    }

    const scriptPage = _script.data.manga.pages[_scriptManga.pageIdx];
    const { mapped, warning } = mapScriptPageToPanels(scriptPage, panels);
    _autoComicRenderResult(mapped, warning);
}

let _autoComicBridgeInited = false;
function initAutoComicBridge() {
    if (_autoComicBridgeInited) return;
    _autoComicBridgeInited = true;
    document.getElementById('script-autocomic-map-btn')?.addEventListener('click', _handleAutoComicMapClick);
}

export { initAutoComicBridge };
