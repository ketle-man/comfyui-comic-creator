// ============================================================
// main.js 分割ファイル (22/24): スクリプトタブ
// 元 main.js の行 16747-17305 に相当
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: _SCRIPT_CURRENT_KEY,_SCRIPT_WORKS_KEY,_escHtml,_script,_scriptApplyData,_scriptBlankData,_scriptBlankDialogue,_scriptBlankElement,_scriptBlankPage,_scriptGetSelectedDialogue,_scriptGetWorks,_scriptInitAssetPanelSectionToggle,_scriptLoadCurrent,_scriptNormalizeData,_scriptRenderAssetPanelLists,_scriptRenderElements,_scriptRenderElementsDatalist,_scriptRenderPage,_scriptRenderPageWorkList,_scriptRenderPreviewH,_scriptRenderPreviewV,_scriptRenderWorkList,_scriptSaveCurrent,_scriptSetWorks,initProjectTab
// ============================================================

// ==============================
// スクリプトタブ（作品名 > あらすじ > プロット[ページ > コマワリ]）
// ==============================

const _SCRIPT_CURRENT_KEY = 'cccScriptCurrent';   // 作業中データ（オートセーブ）
const _SCRIPT_WORKS_KEY = 'cccScriptWorks';       // 作品名別の保存リスト

const _script = {
    initialized: false,
    // 作業中データ（source of truth）。ページ/コマの編集はすべてこれを更新して保存する
    data: null,
    // プロットサブタブの表示中ページindex
    pageIdx: 0,
    // 選択中のセリフ行 { panelIdx, dlgIdx } または null
    sel: null,
    // アセットパネル「S」タブでの選択状態（読込/削除/新規作成ボタンが参照する）
    selectedWorkName: null,      // 保存済みスクリプト作品名
    selectedPageWorkName: null,  // ページタブの作品名（新規作成時の名前初期値に使用）
    // アセットパネル「S」タブの折りたたみ状態（セッション中のみ保持）
    workListCollapsed: false,
    pageWorkListCollapsed: false,
};

function _scriptBlankDialogue() {
    return { character: '', text: '' };
}

function _scriptBlankPage(panelCount = 4) {
    return { scene: '', panels: Array.from({ length: panelCount }, () => ({ dialogues: [_scriptBlankDialogue()] })) };
}

function _scriptBlankElement() {
    return { name: '', detail: '' };
}

function _scriptBlankData() {
    return { name: '', synopsis: '', pages: [_scriptBlankPage()], elements: [] };
}

// データ構造の正規化（欠損補完・旧 dialogue 単数形/文字列配列からの変換）
function _scriptNormalizeData(data) {
    if (!data || typeof data !== 'object') return _scriptBlankData();
    if (typeof data.name !== 'string') data.name = '';
    if (typeof data.synopsis !== 'string') data.synopsis = '';
    if (!Array.isArray(data.pages) || data.pages.length === 0) data.pages = [_scriptBlankPage()];
    if (!Array.isArray(data.elements)) data.elements = [];
    data.elements.forEach(el => {
        if (typeof el.name !== 'string') el.name = '';
        if (typeof el.detail !== 'string') el.detail = '';
    });
    data.pages.forEach(page => {
        if (typeof page.scene !== 'string') page.scene = '';
        if (!Array.isArray(page.panels) || page.panels.length === 0) {
            page.panels = _scriptBlankPage().panels;
        }
        page.panels.forEach(panel => {
            if (!Array.isArray(panel.dialogues)) {
                panel.dialogues = [typeof panel.dialogue === 'string' ? panel.dialogue : ''];
            }
            if (panel.dialogues.length === 0) panel.dialogues = [_scriptBlankDialogue()];
            // 旧形式（文字列のみ）を { character, text } 形式へ変換
            panel.dialogues = panel.dialogues.map(dlg => {
                if (typeof dlg === 'string') return { character: '', text: dlg };
                if (!dlg || typeof dlg !== 'object') return _scriptBlankDialogue();
                if (typeof dlg.character !== 'string') dlg.character = '';
                if (typeof dlg.text !== 'string') dlg.text = '';
                return dlg;
            });
            delete panel.dialogue;
        });
    });
    return data;
}

// プロットで選択中のセル文字列を返す（シーン／要素／セリフ・説明等。未選択・データなしは null）
function _scriptGetSelectedDialogue() {
    if (!_script.data || !_script.sel) return null;
    const page = _script.data.pages[_script.pageIdx];
    if (!page) return null;
    if (_script.sel.field === 'scene') {
        return typeof page.scene === 'string' ? page.scene : null;
    }
    const dlg = page.panels?.[_script.sel.panelIdx]?.dialogues?.[_script.sel.dlgIdx];
    if (!dlg) return null;
    if (_script.sel.field === 'character') {
        return typeof dlg.character === 'string' ? dlg.character : null;
    }
    return typeof dlg.text === 'string' ? dlg.text : null;
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

// 作業中データを画面全体に反映
function _scriptApplyData(data) {
    _script.data = data;
    _script.pageIdx = 0;
    _script.sel = null;
    const nameEl = document.getElementById('script-work-name');
    if (nameEl) nameEl.value = data.name || '';
    const synEl = document.getElementById('script-synopsis');
    if (synEl) synEl.value = data.synopsis || '';
    _scriptRenderPage();
    _scriptRenderElements();
    _scriptRenderElementsDatalist();
}

// 表示中ページのコマワリテーブルを再描画
function _scriptRenderPage() {
    const container = document.getElementById('script-pages-container');
    if (!container) return;

    const pages = _script.data.pages;
    if (_script.pageIdx > pages.length - 1) _script.pageIdx = pages.length - 1;
    if (_script.pageIdx < 0) _script.pageIdx = 0;
    const page = pages[_script.pageIdx];

    // ツールバー表示更新
    const indicator = document.getElementById('script-page-indicator');
    if (indicator) indicator.textContent = t('script.pageIndicator', _script.pageIdx + 1, pages.length);
    const countEl = document.getElementById('script-panel-count');
    if (countEl) countEl.value = page.panels.length;

    container.innerHTML = '';
    const block = document.createElement('div');
    block.className = 'script-page-block';

    // コマワリテーブル（シーン・コマ番・セリフ番・要素・セリフ/説明等）
    const table = document.createElement('table');
    table.className = 'project-panel-table';
    table.innerHTML = `
        <thead>
            <tr>
                <th class="project-panel-th-scene">${t('script.thScene')}</th>
                <th class="project-panel-th-num">${t('script.thPanelNum')}</th>
                <th class="project-panel-th-num">${t('script.thDialogueNum')}</th>
                <th class="project-panel-th-char">${t('script.subtabElements')}</th>
                <th>${t('script.thDialogueDetail')}</th>
            </tr>
        </thead>
    `;
    const totalRows = page.panels.reduce((sum, panel) => sum + panel.dialogues.length, 0);
    const tbody = document.createElement('tbody');
    let firstRow = true;
    page.panels.forEach((panel, panelIdx) => {
        panel.dialogues.forEach((dlg, dlgIdx) => {
            const tr = document.createElement('tr');
            // シーンセルはページ内の先頭行のみ（rowspanで全行結合）
            const sceneTd = firstRow
                ? `<td class="project-panel-td-scene" rowspan="${totalRows}"><textarea rows="2" class="project-cell-textarea script-scene-textarea">${_escHtml(page.scene || '')}</textarea></td>`
                : '';
            firstRow = false;
            // コマ番セルは各コマの先頭行のみ（rowspanでセリフ行数分結合）
            const numTd = dlgIdx === 0
                ? `<td class="project-panel-td-num" rowspan="${panel.dialogues.length}">${panelIdx + 1}</td>`
                : '';
            tr.innerHTML = `
                ${sceneTd}
                ${numTd}
                <td class="project-panel-td-num">${dlgIdx + 1}</td>
                <td><input type="text" class="project-input script-character-input" list="script-elements-datalist" value="${_escHtml(dlg.character || '')}" /></td>
                <td><textarea rows="2" class="project-cell-textarea">${_escHtml(dlg.text || '')}</textarea></td>
            `;
            const sceneEl = tr.querySelector('.script-scene-textarea');
            if (sceneEl) {
                sceneEl.addEventListener('input', e => {
                    page.scene = e.target.value;
                    _scriptSaveCurrent();
                });
            }
            tr.querySelector('.script-character-input').addEventListener('input', e => {
                dlg.character = e.target.value;
                _scriptSaveCurrent();
            });
            tr.querySelector('textarea:not(.script-scene-textarea)').addEventListener('input', e => {
                dlg.text = e.target.value;
                _scriptSaveCurrent();
            });
            tr.addEventListener('click', e => {
                tbody.querySelectorAll('tr').forEach(r => r.classList.remove('project-row-selected'));
                tr.classList.add('project-row-selected');
                let field = 'text';
                if (e.target.closest('.script-scene-textarea')) field = 'scene';
                else if (e.target.closest('.script-character-input')) field = 'character';
                _script.sel = { panelIdx, dlgIdx, field };
            });
            // 再レンダー後の選択復元
            if (_script.sel && _script.sel.panelIdx === panelIdx && _script.sel.dlgIdx === dlgIdx) {
                tr.classList.add('project-row-selected');
            }
            tbody.appendChild(tr);
        });
    });
    table.appendChild(tbody);
    block.appendChild(table);
    container.appendChild(block);
}

// プロット全ページを横書きテキストでページ横断表示（ページ番号・コマ番・セリフ番は表示しない）
function _scriptRenderPreviewH() {
    const container = document.getElementById('script-preview-h-container');
    if (!container || !_script.data) return;

    container.innerHTML = '';
    _script.data.pages.forEach(page => {
        const sceneLine = document.createElement('div');
        sceneLine.className = 'script-preview-h-line script-preview-h-scene';
        sceneLine.textContent = t('script.sceneLinePrefix', page.scene || '');
        container.appendChild(sceneLine);

        page.panels.forEach(panel => {
            panel.dialogues.forEach(dlg => {
                const line = document.createElement('div');
                line.className = 'script-preview-h-line script-preview-h-dialogue';
                line.textContent = `${dlg.character || ''}：${dlg.text || ''}`;
                container.appendChild(line);
            });
        });
    });
}

// プロット全ページを縦書きテキスト（右から左）でページ横断表示（ページ番号・コマ番・セリフ番は表示しない）
function _scriptRenderPreviewV() {
    const container = document.getElementById('script-preview-v-container');
    if (!container || !_script.data) return;

    container.innerHTML = '';
    _script.data.pages.forEach(page => {
        const sceneLine = document.createElement('div');
        sceneLine.className = 'script-preview-v-line script-preview-v-scene';
        sceneLine.textContent = t('script.sceneLinePrefix', page.scene || '');
        container.appendChild(sceneLine);

        page.panels.forEach(panel => {
            panel.dialogues.forEach(dlg => {
                const line = document.createElement('div');
                line.className = 'script-preview-v-line script-preview-v-dialogue';
                line.textContent = `${dlg.character || ''}：${dlg.text || ''}`;
                container.appendChild(line);
            });
        });
    });
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

    // サブタブ切り替え
    document.querySelectorAll('[data-project-subtab]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('[data-project-subtab]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const subtab = btn.dataset.projectSubtab;
            document.querySelectorAll('#project-tab .comfyui-subtab-content').forEach(el => el.style.display = 'none');
            const target = document.getElementById('project-subtab-' + subtab);
            if (target) target.style.display = 'block';
            if (subtab === 'preview-h') _scriptRenderPreviewH();
            if (subtab === 'preview-v') _scriptRenderPreviewV();
            if (subtab === 'elements') _scriptRenderElements();
        });
    });

    // ページ送り
    document.getElementById('script-page-prev')?.addEventListener('click', () => {
        if (_script.pageIdx <= 0) return;
        _script.pageIdx--;
        _script.sel = null;
        _scriptRenderPage();
    });
    document.getElementById('script-page-next')?.addEventListener('click', () => {
        if (_script.pageIdx >= _script.data.pages.length - 1) return;
        _script.pageIdx++;
        _script.sel = null;
        _scriptRenderPage();
    });

    // コマ数増減（表示中ページ）
    document.getElementById('script-panel-up')?.addEventListener('click', () => {
        _script.data.pages[_script.pageIdx].panels.push({ dialogues: [_scriptBlankDialogue()] });
        _scriptSaveCurrent();
        _scriptRenderPage();
    });
    document.getElementById('script-panel-down')?.addEventListener('click', () => {
        const panels = _script.data.pages[_script.pageIdx].panels;
        if (panels.length <= 1) return;
        panels.pop();
        if (_script.sel && _script.sel.panelIdx >= panels.length) _script.sel = null;
        _scriptSaveCurrent();
        _scriptRenderPage();
    });

    // セリフ行の追加（選択行と同一コマ番の直後に挿入）
    document.getElementById('script-dialogue-add')?.addEventListener('click', () => {
        if (!_script.sel) { alert(t('script.selectDialogueFirst')); return; }
        const panel = _script.data.pages[_script.pageIdx].panels[_script.sel.panelIdx];
        if (!panel) { _script.sel = null; return; }
        panel.dialogues.splice(_script.sel.dlgIdx + 1, 0, _scriptBlankDialogue());
        _script.sel = { panelIdx: _script.sel.panelIdx, dlgIdx: _script.sel.dlgIdx + 1 };
        _scriptSaveCurrent();
        _scriptRenderPage();
    });

    // セリフ行の削除（各コマ最低1行は残す）
    document.getElementById('script-dialogue-del')?.addEventListener('click', () => {
        if (!_script.sel) { alert(t('script.selectDialogueFirst')); return; }
        const panel = _script.data.pages[_script.pageIdx].panels[_script.sel.panelIdx];
        if (!panel) { _script.sel = null; return; }
        if (panel.dialogues.length <= 1) { alert(t('script.dialogueMinRequired')); return; }
        panel.dialogues.splice(_script.sel.dlgIdx, 1);
        if (_script.sel.dlgIdx >= panel.dialogues.length) _script.sel.dlgIdx = panel.dialogues.length - 1;
        _scriptSaveCurrent();
        _scriptRenderPage();
    });

    // ページ追加（末尾に追加して表示）
    document.getElementById('script-page-add-btn')?.addEventListener('click', () => {
        _script.data.pages.push(_scriptBlankPage());
        _script.pageIdx = _script.data.pages.length - 1;
        _script.sel = null;
        _scriptSaveCurrent();
        _scriptRenderPage();
    });

    // ページ削除（表示中ページ・最後の1ページは不可）
    document.getElementById('script-page-delete-btn')?.addEventListener('click', () => {
        if (_script.data.pages.length <= 1) { alert(t('script.lastPageCannotDelete')); return; }
        if (!confirm(t('script.confirmDeletePage', _script.pageIdx + 1))) return;
        _script.data.pages.splice(_script.pageIdx, 1);
        _script.sel = null;
        _scriptSaveCurrent();
        _scriptRenderPage();
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

