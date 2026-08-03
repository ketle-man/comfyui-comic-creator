// ============================================================
// main.js 分割ファイル (22/24): スクリプトタブ（共通層）
// 元 main.js の行 16747-17305 に相当
// type="module" として読み込まれる（ESモジュール化 G9）。
// 作品名・あらすじ・要素・保存/読込/新規作成・メディア種別（漫画/小説/脚本…）の
// 切替のみを担当する共通層。メディア種別ごとの編集画面（コマ割り等）は
// 21a-script-manga.js（漫画）のような分離ファイルへ切り出す。21a-script-manga.js
// とは相互import（循環）。循環先シンボルの参照はすべて関数内部（呼び出し時点で
// 評価）に閉じているため安全（08-panels-images.js ⇄ 07-pages.js と同じパターン）。
// 主なトップレベル定義: _SCRIPT_CURRENT_KEY,_SCRIPT_WORKS_KEY,_escHtml,_script,_scriptApplyData,_scriptBlankData,_scriptBlankElement,_scriptGetWorks,_scriptInitAssetPanelSectionToggle,_scriptIsMangaLikeType,_scriptLoadCurrent,_scriptNormalizeData,_scriptRenderAssetPanelLists,_scriptRenderElements,_scriptRenderElementsDatalist,_scriptRenderPageWorkList,_scriptRenderWorkList,_scriptSaveCurrent,_scriptSetWorks,_scriptUpdateMediaTypeSelectUI,initProjectTab
// ============================================================

import { t } from '../i18n.js';
import { _workMeta } from './11a-work-manager.js';
import {
    _scriptMangaBlankData, _scriptMangaNormalize, _scriptMangaResetView,
    _scriptMangaRenderPage, _scriptMangaRenderPreviewH, _scriptMangaRenderPreviewV,
    initScriptMangaEditor,
} from './21a-script-manga.js';

// ==============================
// スクリプトタブ（作品名 > あらすじ > メディア種別 > プロット[ページ > コマワリ]）
// ==============================

const _SCRIPT_CURRENT_KEY = 'cccScriptCurrent';   // 作業中データ（オートセーブ）
const _SCRIPT_WORKS_KEY = 'cccScriptWorks';       // 作品名別の保存リスト
const _SCRIPT_MEDIA_TYPES = ['manga', 'semiAutoManga', 'novel', 'screenplay'];

// 「漫画」「半自動マンガ」は編集画面（コマ割り表）を共有する（21a-script-manga.js）。
// データは data.manga / data.semiAutoManga に別々に保持し、画面構成のみ共通化する。
function _scriptIsMangaLikeType(mediaType) {
    return mediaType === 'manga' || mediaType === 'semiAutoManga';
}

const _script = {
    initialized: false,
    // 作業中データ（source of truth）。編集はすべてこれを更新して保存する
    data: null,
    // アセットパネル「S」タブでの選択状態（読込/削除/新規作成ボタンが参照する）
    selectedWorkName: null,      // 保存済みスクリプト作品名
    selectedPageWorkName: null,  // ページタブの作品名（新規作成時の名前初期値に使用）
    // アセットパネル「S」タブの折りたたみ状態（セッション中のみ保持）
    workListCollapsed: false,
    pageWorkListCollapsed: false,
};

function _scriptBlankElement() {
    return { name: '', detail: '' };
}

// メディア種別は作品ごとに固定（新規作成時に選択、以後は読込済み作品では変更不可）。
// 現時点で編集画面を実装しているのは「漫画」「半自動マンガ」のみ（両者は同じコマ割り表画面を
// 共有する）。「小説」「脚本」は将来実装のための予約。
function _scriptBlankData(mediaType = 'manga') {
    const mt = _SCRIPT_MEDIA_TYPES.includes(mediaType) ? mediaType : 'manga';
    return {
        name: '',
        synopsis: '',
        mediaType: mt,
        elements: [],
        manga: mt === 'manga' ? _scriptMangaBlankData() : null,
        semiAutoManga: mt === 'semiAutoManga' ? _scriptMangaBlankData() : null,
        novel: null,
        screenplay: null,
    };
}

// データ構造の正規化（欠損補完・メディア種別付き新形式への移行）
function _scriptNormalizeData(data) {
    if (!data || typeof data !== 'object') return _scriptBlankData();
    if (typeof data.name !== 'string') data.name = '';
    if (typeof data.synopsis !== 'string') data.synopsis = '';
    if (!Array.isArray(data.elements)) data.elements = [];
    data.elements.forEach(el => {
        if (typeof el.name !== 'string') el.name = '';
        if (typeof el.detail !== 'string') el.detail = '';
    });

    // 旧形式（mediaTypeが無く、pages が直下にある）を検出したら漫画データとして移行する
    if (!_SCRIPT_MEDIA_TYPES.includes(data.mediaType)) {
        const legacyPages = Array.isArray(data.pages) ? data.pages : null;
        data.mediaType = 'manga';
        data.manga = legacyPages ? { pages: legacyPages } : (data.manga || null);
        delete data.pages;
    }
    if (typeof data.semiAutoManga === 'undefined') data.semiAutoManga = null;
    if (typeof data.novel === 'undefined') data.novel = null;
    if (typeof data.screenplay === 'undefined') data.screenplay = null;

    if (_scriptIsMangaLikeType(data.mediaType)) {
        data[data.mediaType] = _scriptMangaNormalize(data[data.mediaType]);
    }

    return data;
}

// 作業中データを localStorage にオートセーブ
function _scriptSaveCurrent() {
    localStorage.setItem(_SCRIPT_CURRENT_KEY, JSON.stringify(_script.data));
}

function _scriptLoadCurrent() {
    try {
        const raw = localStorage.getItem(_SCRIPT_CURRENT_KEY);
        if (!raw) return null;
        return _scriptNormalizeData(JSON.parse(raw));
    } catch { return null; }
}

// 作品保存リストを取得（[{ name, data }]）
function _scriptGetWorks() {
    try { return JSON.parse(localStorage.getItem(_SCRIPT_WORKS_KEY) || '[]'); }
    catch { return []; }
}

function _scriptSetWorks(list) {
    localStorage.setItem(_SCRIPT_WORKS_KEY, JSON.stringify(list));
}

// アセットパネル「S」タブ: 保存済み作品一覧・ページ作品一覧の両方を再描画
function _scriptRenderAssetPanelLists() {
    _scriptRenderWorkList();
    _scriptRenderPageWorkList();
}

// セクション見出しクリックで対象リストの折りたたみを切り替える（初回のみ呼び出し、要素自体は再描画対象外のため）
function _scriptInitAssetPanelSectionToggle(headerId, listId, stateKey) {
    const header = document.getElementById(headerId);
    const list = document.getElementById(listId);
    if (!header || !list) return;
    header.addEventListener('click', () => {
        _script[stateKey] = !_script[stateKey];
        header.classList.toggle('collapsed', _script[stateKey]);
        list.classList.toggle('collapsed', _script[stateKey]);
    });
}

// 保存済み作品一覧（クリックで選択のみ。読込/削除は本体側ボタンで確定）
function _scriptRenderWorkList() {
    const grid = document.getElementById('script-asset-work-list');
    if (!grid) return;
    grid.classList.toggle('collapsed', _script.workListCollapsed);
    const works = _scriptGetWorks();
    if (_script.selectedWorkName && !works.find(w => w.name === _script.selectedWorkName)) {
        _script.selectedWorkName = null;
    }
    if (works.length === 0) {
        grid.innerHTML = `<p class="empty-message">${t('asset.noSavedWorks')}</p>`;
        return;
    }
    grid.innerHTML = '';
    works.forEach(w => {
        const item = document.createElement('div');
        item.className = 'script-asset-item';
        item.dataset.workName = w.name;
        if (_script.selectedWorkName === w.name) item.classList.add('selected');
        item.textContent = w.name;
        item.addEventListener('click', () => {
            _script.selectedWorkName = (_script.selectedWorkName === w.name) ? null : w.name;
            grid.querySelectorAll('.script-asset-item').forEach(el => {
                el.classList.toggle('selected', el.dataset.workName === _script.selectedWorkName);
            });
        });
        grid.appendChild(item);
    });
}

// ページタブの作品一覧（クリックで選択のみ。新規作成ボタン押下時の名前初期値として使用）
function _scriptRenderPageWorkList() {
    const grid = document.getElementById('script-asset-page-work-list');
    if (!grid) return;
    grid.classList.toggle('collapsed', _script.pageWorkListCollapsed);
    const names = Object.keys(_workMeta.data);
    if (_script.selectedPageWorkName && !_workMeta.get(_script.selectedPageWorkName)) {
        _script.selectedPageWorkName = null;
    }
    if (names.length === 0) {
        grid.innerHTML = `<p class="empty-message">${t('asset.noPageWorks')}</p>`;
        return;
    }
    grid.innerHTML = '';
    names.forEach(name => {
        const item = document.createElement('div');
        item.className = 'script-asset-item';
        item.dataset.pageWorkName = name;
        if (_script.selectedPageWorkName === name) item.classList.add('selected');
        item.textContent = name;
        item.addEventListener('click', () => {
            _script.selectedPageWorkName = (_script.selectedPageWorkName === name) ? null : name;
            grid.querySelectorAll('.script-asset-item').forEach(el => {
                el.classList.toggle('selected', el.dataset.pageWorkName === _script.selectedPageWorkName);
            });
        });
        grid.appendChild(item);
    });
}

// メディア種別セレクトの表示を同期する。作品ごとに固定のため、保存済み作品名と
// 一致する（＝既存作品を読込・保存済み）場合は変更不可にする。
function _scriptUpdateMediaTypeSelectUI() {
    const sel = document.getElementById('script-media-type-select');
    if (!sel || !_script.data) return;
    sel.value = _script.data.mediaType || 'manga';
    const isExistingWork = !!_script.data.name && _scriptGetWorks().some(w => w.name === _script.data.name);
    sel.disabled = isExistingWork;
}

// 現在アクティブなプロット系サブタブ（プロット/プレビュー横/プレビュー縦）を、
// メディア種別に応じて実編集画面またはプレースホルダーに出し分けて描画する。
// 「要素」サブタブはメディア種別に依存しない共通機能のため対象外（呼び出し元で個別処理）。
function _scriptRenderActiveMediaTab() {
    if (!_script.data) return;
    const isMangaLike = _scriptIsMangaLikeType(_script.data.mediaType);

    const pairs = [
        ['script-manga-plot-editor', 'script-plot-placeholder'],
        ['script-preview-h-container', 'script-preview-h-placeholder'],
        ['script-preview-v-container', 'script-preview-v-placeholder'],
    ];
    pairs.forEach(([editorId, placeholderId]) => {
        const editorEl = document.getElementById(editorId);
        const placeholderEl = document.getElementById(placeholderId);
        if (editorEl) editorEl.style.display = isMangaLike ? '' : 'none';
        if (placeholderEl) placeholderEl.style.display = isMangaLike ? 'none' : '';
    });

    if (!isMangaLike) return;

    const activeBtn = document.querySelector('[data-project-subtab].active');
    const subtab = activeBtn ? activeBtn.dataset.projectSubtab : 'plot';
    if (subtab === 'plot') _scriptMangaRenderPage();
    else if (subtab === 'preview-h') _scriptMangaRenderPreviewH();
    else if (subtab === 'preview-v') _scriptMangaRenderPreviewV();
}

// 作業中データを画面全体に反映
function _scriptApplyData(data) {
    _script.data = data;
    _scriptMangaResetView();
    const nameEl = document.getElementById('script-work-name');
    if (nameEl) nameEl.value = data.name || '';
    const synEl = document.getElementById('script-synopsis');
    if (synEl) synEl.value = data.synopsis || '';
    _scriptUpdateMediaTypeSelectUI();
    _scriptRenderActiveMediaTab();
    _scriptRenderElements();
    _scriptRenderElementsDatalist();
}

// 要素タブ: 登場人物・固有名詞などの一覧テーブルを再描画
function _scriptRenderElements() {
    const tbody = document.getElementById('script-elements-tbody');
    if (!tbody || !_script.data) return;

    tbody.innerHTML = '';
    _script.data.elements.forEach((el, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><input type="text" class="project-input script-element-name-input" value="${_escHtml(el.name || '')}" /></td>
            <td><textarea rows="2" class="project-cell-textarea script-element-detail-textarea">${_escHtml(el.detail || '')}</textarea></td>
            <td class="project-panel-td-num"><button type="button" class="btn small danger script-element-del-btn" title="${t('script.elementDeleteTitle')}">×</button></td>
        `;
        tr.querySelector('.script-element-name-input').addEventListener('input', e => {
            el.name = e.target.value;
            _scriptSaveCurrent();
            _scriptRenderElementsDatalist();
        });
        tr.querySelector('.script-element-detail-textarea').addEventListener('input', e => {
            el.detail = e.target.value;
            _scriptSaveCurrent();
        });
        tr.querySelector('.script-element-del-btn').addEventListener('click', () => {
            _script.data.elements.splice(idx, 1);
            _scriptSaveCurrent();
            _scriptRenderElements();
            _scriptRenderElementsDatalist();
        });
        tbody.appendChild(tr);
    });
}

// プロット「要素」列（input+datalist）の候補一覧を要素タブの登録名から再構築
function _scriptRenderElementsDatalist() {
    const datalist = document.getElementById('script-elements-datalist');
    if (!datalist || !_script.data) return;
    const names = [...new Set(_script.data.elements.map(el => el.name).filter(Boolean))];
    datalist.innerHTML = names.map(name => `<option value="${_escHtml(name)}"></option>`).join('');
}

function initProjectTab() {
    if (_script.initialized) return;
    _script.initialized = true;

    // 旧プロジェクトタブのデータは廃止（互換不要）
    localStorage.removeItem('eagleComicProjectPlot');
    localStorage.removeItem('eagleComicProjectSaves');

    // 漫画メディアのツールバー操作（ページ送り・コマ数増減・セリフ行追加削除等）を配線
    initScriptMangaEditor();

    // 作業中データのロード（なければ空データ）
    _scriptApplyData(_scriptLoadCurrent() || _scriptBlankData());

    // アセットパネル「S」タブのリスト初期化（保存済み作品・ページ作品。スクリプトタブを開くたびにSタブが
    // 強制アクティブ化され_scriptRenderAssetPanelLists()が再実行されるため、他タブでの作品追加にも追従する）
    _scriptRenderAssetPanelLists();

    // 作品名・あらすじ オートセーブ
    document.getElementById('script-work-name')?.addEventListener('input', e => {
        _script.data.name = e.target.value;
        _scriptSaveCurrent();
    });
    document.getElementById('script-synopsis')?.addEventListener('input', e => {
        _script.data.synopsis = e.target.value;
        _scriptSaveCurrent();
    });

    // メディア種別セレクト（作品ごとに固定。既存作品読込時は_scriptUpdateMediaTypeSelectUIでdisabledになる）
    document.getElementById('script-media-type-select')?.addEventListener('change', e => {
        if (!_script.data) return;
        const mediaType = _SCRIPT_MEDIA_TYPES.includes(e.target.value) ? e.target.value : 'manga';
        _script.data.mediaType = mediaType;
        if (_scriptIsMangaLikeType(mediaType) && !_script.data[mediaType]) {
            _script.data[mediaType] = _scriptMangaBlankData();
        }
        _scriptSaveCurrent();
        _scriptRenderActiveMediaTab();
    });

    // サブタブ切り替え
    document.querySelectorAll('[data-project-subtab]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('[data-project-subtab]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const subtab = btn.dataset.projectSubtab;
            document.querySelectorAll('#project-tab .comfyui-subtab-content').forEach(el => el.style.display = 'none');
            const target = document.getElementById('project-subtab-' + subtab);
            if (target) target.style.display = 'block';
            if (subtab === 'elements') _scriptRenderElements();
            else _scriptRenderActiveMediaTab();
        });
    });

    // 作品の新規作成（現在の内容を破棄して空データに）
    // アセットパネル「S」タブの「ページ作品」で選択中の名前があれば、それを作品名として使用
    document.getElementById('script-work-new-btn')?.addEventListener('click', () => {
        if (!confirm(t('script.confirmNewWork'))) return;
        const data = _scriptBlankData();
        data.name = _script.selectedPageWorkName || '';
        _scriptApplyData(data);
        _scriptSaveCurrent();
        _script.selectedWorkName = null;
        _scriptRenderWorkList();
    });

    // 作品の保存（作品名で保存）
    document.getElementById('script-work-save-btn')?.addEventListener('click', () => {
        const name = document.getElementById('script-work-name')?.value.trim();
        if (!name) { alert(t('script.workNameRequired')); return; }
        _script.data.name = name;
        const works = _scriptGetWorks();
        const idx = works.findIndex(w => w.name === name);
        const data = JSON.parse(JSON.stringify(_script.data));
        if (idx >= 0) {
            if (!confirm(t('script.confirmOverwriteWork', name))) return;
            works[idx].data = data;
        } else {
            works.push({ name, data });
        }
        _scriptSetWorks(works);
        _scriptSaveCurrent();
        _script.selectedWorkName = name;
        _scriptRenderWorkList();
        _scriptUpdateMediaTypeSelectUI();
    });

    // 作品の読み込み
    document.getElementById('script-work-load-btn')?.addEventListener('click', () => {
        const name = _script.selectedWorkName;
        if (!name) { alert(t('script.selectWorkToLoad')); return; }
        const entry = _scriptGetWorks().find(w => w.name === name);
        if (!entry) return;
        _scriptApplyData(_scriptNormalizeData(JSON.parse(JSON.stringify(entry.data))));
        _scriptSaveCurrent();
    });

    // 作品の削除
    document.getElementById('script-work-delete-btn')?.addEventListener('click', () => {
        const name = _script.selectedWorkName;
        if (!name) { alert(t('script.selectWorkToDelete')); return; }
        if (!confirm(t('script.confirmDeleteWork', name))) return;
        _scriptSetWorks(_scriptGetWorks().filter(w => w.name !== name));
        _script.selectedWorkName = null;
        _scriptRenderWorkList();
    });

    // 要素の追加（末尾に空行を追加）
    document.getElementById('script-element-add-btn')?.addEventListener('click', () => {
        _script.data.elements.push(_scriptBlankElement());
        _scriptSaveCurrent();
        _scriptRenderElements();
        const inputs = document.querySelectorAll('#script-elements-tbody .script-element-name-input');
        inputs[inputs.length - 1]?.focus();
    });
}

function _escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export {
    _script, _scriptSaveCurrent, _scriptGetWorks, _scriptIsMangaLikeType,
    _scriptRenderAssetPanelLists, _scriptInitAssetPanelSectionToggle, initProjectTab, _escHtml,
};

// まだESM化されていない main/以下の classic <script> や、既存ESMファイルの一部が
// window経由で呼んでいるためのブリッジ（ESモジュール化移行中の一時措置。
// 全分割ファイルのESM化が完了したら、各呼び出し元をimport文に置き換えてこのブロックごと削除する）。
window._scriptRenderAssetPanelLists = _scriptRenderAssetPanelLists;
window._scriptInitAssetPanelSectionToggle = _scriptInitAssetPanelSectionToggle;
window.initProjectTab = initProjectTab;
window._escHtml = _escHtml;
