// ============================================================
// スクリプトタブ: 「漫画」「半自動マンガ」メディア共通編集ロジック
// 21-script-tab.js（共通層: 作品名/あらすじ/要素/保存読込/メディア種別切替）から、
// メディア種別「漫画」「半自動マンガ」共通のプロット編集（ページ＞コマ＞セリフ、
// 画像プロンプト、プレビュー表示）を切り出したもの。両メディアは同じ編集画面を
// 共有し、データのみ data.manga / data.semiAutoManga に別々に保持する
// （どちらのキーを読み書きするかは _scriptMangaData() が現在のmediaTypeから解決する）。
// 将来「小説」「脚本」等、画面構成自体が異なる他メディアを追加する場合は、
// 本ファイルとは別に `21b-script-novel.js` 等を追加する。
// _script（データ本体・作業状態）は 21-script-tab.js が所有する。
// type="module" として読み込まれる。21-script-tab.js とは相互import（循環）。
// 循環先シンボルの参照はすべて関数内部（呼び出し時点で評価）に閉じているため安全
// （08-panels-images.js ⇄ 07-pages.js と同じパターン）。
// ============================================================

import { t } from '../i18n.js';
import { _script, _escHtml, _scriptSaveCurrent, _scriptIsMangaLikeType } from './21-script-tab.js';
import { requestLLMPromptFromWorkflowStudio } from './14-integrations.js';
import { state } from './01-state.js';

// プロットサブタブ内での表示中ページ・選択中セリフ行（漫画/半自動マンガ共通の一時状態）
const _scriptManga = {
    pageIdx: 0,
    sel: null, // { panelIdx, dlgIdx, field } または null
};

// 現在のmediaTypeに応じて data.manga / data.semiAutoManga のどちらを読み書きするかを解決する
function _scriptMangaData() {
    if (!_script.data) return null;
    const key = _script.data.mediaType === 'semiAutoManga' ? 'semiAutoManga' : 'manga';
    return _script.data[key];
}

// shape: フキダシ形状の指定（'' = 未指定＝自動生成時は角丸矩形、それ以外は09c-balloon-handles.jsの
// h2-shape-typeと同じ値: normal/rect/thought/bomb/cloudpuffy/cloudwavy）
function _scriptMangaBlankDialogue() {
    return { character: '', text: '', shape: '' };
}

function _scriptMangaBlankPanel() {
    return { dialogues: [_scriptMangaBlankDialogue()], imagePrompt: '' };
}

function _scriptMangaBlankPage(panelCount = 4) {
    return { scene: '', panels: Array.from({ length: panelCount }, () => _scriptMangaBlankPanel()) };
}

// コマにセリフ・画像プロンプトが1つでも入力済みかどうか（コマ数取得での誤削除確認用）
function _scriptMangaPanelHasData(panel) {
    if (panel.imagePrompt && panel.imagePrompt.trim()) return true;
    return (panel.dialogues || []).some(d => (d.character && d.character.trim()) || (d.text && d.text.trim()));
}

function _scriptMangaBlankData() {
    return { pages: [_scriptMangaBlankPage()] };
}

// data.manga の正規化（欠損補完・旧 dialogue 単数形/文字列配列からの変換・画像プロンプト欄補完）
function _scriptMangaNormalize(mangaData) {
    if (!mangaData || typeof mangaData !== 'object') return _scriptMangaBlankData();
    if (!Array.isArray(mangaData.pages) || mangaData.pages.length === 0) {
        mangaData.pages = [_scriptMangaBlankPage()];
    }
    mangaData.pages.forEach(page => {
        if (typeof page.scene !== 'string') page.scene = '';
        if (!Array.isArray(page.panels) || page.panels.length === 0) {
            page.panels = _scriptMangaBlankPage().panels;
        }
        page.panels.forEach(panel => {
            if (typeof panel.imagePrompt !== 'string') panel.imagePrompt = '';
            if (!Array.isArray(panel.dialogues)) {
                panel.dialogues = [typeof panel.dialogue === 'string' ? panel.dialogue : ''];
            }
            if (panel.dialogues.length === 0) panel.dialogues = [_scriptMangaBlankDialogue()];
            // 旧形式（文字列のみ）を { character, text } 形式へ変換
            panel.dialogues = panel.dialogues.map(dlg => {
                if (typeof dlg === 'string') return { character: '', text: dlg, shape: '' };
                if (!dlg || typeof dlg !== 'object') return _scriptMangaBlankDialogue();
                if (typeof dlg.character !== 'string') dlg.character = '';
                if (typeof dlg.text !== 'string') dlg.text = '';
                if (typeof dlg.shape !== 'string') dlg.shape = '';
                return dlg;
            });
            delete panel.dialogue;
        });
    });
    return mangaData;
}

// プロットで選択中のセル文字列を返す（シーン／要素／セリフ・説明等。未選択・データなしは null）
function _scriptMangaGetSelectedDialogue() {
    if (!_script.data || !_scriptIsMangaLikeType(_script.data.mediaType) || !_scriptManga.sel) return null;
    const page = _scriptMangaData().pages[_scriptManga.pageIdx];
    if (!page) return null;
    if (_scriptManga.sel.field === 'scene') {
        return typeof page.scene === 'string' ? page.scene : null;
    }
    const dlg = page.panels?.[_scriptManga.sel.panelIdx]?.dialogues?.[_scriptManga.sel.dlgIdx];
    if (!dlg) return null;
    if (_scriptManga.sel.field === 'character') {
        return typeof dlg.character === 'string' ? dlg.character : null;
    }
    return typeof dlg.text === 'string' ? dlg.text : null;
}

// 表示状態のリセット（作品切替・新規作成時に21-script-tab.jsから呼ぶ）
function _scriptMangaResetView() {
    _scriptManga.pageIdx = 0;
    _scriptManga.sel = null;
}

// 表示中ページのコマワリテーブルを再描画
function _scriptMangaRenderPage() {
    const container = document.getElementById('script-pages-container');
    if (!container || !_script.data || !_scriptIsMangaLikeType(_script.data.mediaType)) return;

    const pages = _scriptMangaData().pages;
    if (_scriptManga.pageIdx > pages.length - 1) _scriptManga.pageIdx = pages.length - 1;
    if (_scriptManga.pageIdx < 0) _scriptManga.pageIdx = 0;
    const page = pages[_scriptManga.pageIdx];

    // ツールバー表示更新
    const indicator = document.getElementById('script-page-indicator');
    if (indicator) indicator.textContent = t('script.pageIndicator', _scriptManga.pageIdx + 1, pages.length);
    const countEl = document.getElementById('script-panel-count');
    if (countEl) countEl.value = page.panels.length;

    container.innerHTML = '';
    const block = document.createElement('div');
    block.className = 'script-page-block';

    // コマワリテーブル（シーン・コマ番・画像プロンプト・セリフ番・要素・セリフ/説明等）
    const table = document.createElement('table');
    table.className = 'project-panel-table';
    table.innerHTML = `
        <thead>
            <tr>
                <th class="project-panel-th-scene">${t('script.thScene')}</th>
                <th class="project-panel-th-num">${t('script.thPanelNum')}</th>
                <th class="project-panel-th-image-prompt">${t('script.thImagePrompt')}</th>
                <th class="project-panel-th-num">${t('script.thDialogueNum')}</th>
                <th class="project-panel-th-char">${t('script.subtabElements')}</th>
                <th>${t('script.thDialogueDetail')}</th>
                <th class="project-panel-th-balloon-shape">${t('script.thBalloonShape')}</th>
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
            // コマ番・画像プロンプトセルは各コマの先頭行のみ（rowspanでセリフ行数分結合）
            const numTd = dlgIdx === 0
                ? `<td class="project-panel-td-num" rowspan="${panel.dialogues.length}">${panelIdx + 1}</td>`
                : '';
            const imagePromptTd = dlgIdx === 0
                ? `<td class="project-panel-td-image-prompt" rowspan="${panel.dialogues.length}">
                       <textarea rows="3" class="project-cell-textarea script-image-prompt-textarea" placeholder="${t('script.imagePromptPlaceholder')}">${_escHtml(panel.imagePrompt || '')}</textarea>
                       <button type="button" class="btn small secondary script-image-prompt-llm-btn" title="${t('script.imagePromptLlmDraftTitle')}">L</button>
                   </td>`
                : '';
            tr.innerHTML = `
                ${sceneTd}
                ${numTd}
                ${imagePromptTd}
                <td class="project-panel-td-num">${dlgIdx + 1}</td>
                <td><input type="text" class="project-input script-character-input" list="script-elements-datalist" value="${_escHtml(dlg.character || '')}" /></td>
                <td><textarea rows="2" class="project-cell-textarea">${_escHtml(dlg.text || '')}</textarea></td>
                <td>
                    <select class="script-balloon-shape-select" title="${t('script.balloonShapeSelectTitle')}">
                        <option value="">${t('script.balloonShapeDefault')}</option>
                        <option value="normal">${t('layout.balloonNormal')}</option>
                        <option value="rect">${t('layout.balloonRect')}</option>
                        <option value="thought">${t('layout.balloonThought')}</option>
                        <option value="bomb">${t('layout.balloonBomb')}</option>
                        <option value="cloudpuffy">${t('layout.balloonCloudPuffy')}</option>
                        <option value="cloudwavy">${t('layout.balloonCloudWavy')}</option>
                    </select>
                </td>
            `;
            const sceneEl = tr.querySelector('.script-scene-textarea');
            if (sceneEl) {
                sceneEl.addEventListener('input', e => {
                    page.scene = e.target.value;
                    _scriptSaveCurrent();
                });
            }
            const imagePromptEl = tr.querySelector('.script-image-prompt-textarea');
            if (imagePromptEl) {
                imagePromptEl.addEventListener('input', e => {
                    panel.imagePrompt = e.target.value;
                    _scriptSaveCurrent();
                });
            }
            // LLMでの下書きボタン（Phase 3, Workflow Studio連携）: シーン・要素・セリフ・
            // 現在の画像プロンプトをコンテキストとして渡し、下書き結果で画像プロンプト欄を上書きする
            const llmBtnEl = tr.querySelector('.script-image-prompt-llm-btn');
            if (llmBtnEl) {
                llmBtnEl.addEventListener('click', async () => {
                    llmBtnEl.disabled = true;
                    const originalLabel = llmBtnEl.textContent;
                    llmBtnEl.textContent = '...';
                    try {
                        const context = {
                            scene: page.scene || '',
                            elements: (_script.data.elements || [])
                                .map(el => (el.name || el.detail) ? `${el.name}: ${el.detail}` : '').filter(Boolean).join('\n'),
                            dialogues: panel.dialogues
                                .map(dg => (dg.character || dg.text) ? `${dg.character || ''}: ${dg.text || ''}` : '').filter(Boolean).join('\n'),
                            existingPrompt: panel.imagePrompt || '',
                        };
                        const result = await requestLLMPromptFromWorkflowStudio(context);
                        if (!result?.ok) {
                            alert(t('script.imagePromptLlmFailed', result?.message || ''));
                            return;
                        }
                        panel.imagePrompt = result.text;
                        if (imagePromptEl) imagePromptEl.value = result.text;
                        _scriptSaveCurrent();
                    } catch (e) {
                        alert(t('script.imagePromptLlmFailed', e.message));
                    } finally {
                        llmBtnEl.disabled = false;
                        llmBtnEl.textContent = originalLabel;
                    }
                });
            }
            tr.querySelector('.script-character-input').addEventListener('input', e => {
                dlg.character = e.target.value;
                _scriptSaveCurrent();
            });
            const shapeSelectEl = tr.querySelector('.script-balloon-shape-select');
            shapeSelectEl.value = dlg.shape || '';
            shapeSelectEl.addEventListener('change', e => {
                dlg.shape = e.target.value;
                _scriptSaveCurrent();
            });
            tr.querySelector('textarea:not(.script-scene-textarea):not(.script-image-prompt-textarea)').addEventListener('input', e => {
                dlg.text = e.target.value;
                _scriptSaveCurrent();
            });
            tr.addEventListener('click', e => {
                tbody.querySelectorAll('tr').forEach(r => r.classList.remove('project-row-selected'));
                tr.classList.add('project-row-selected');
                let field = 'text';
                if (e.target.closest('.script-scene-textarea')) field = 'scene';
                else if (e.target.closest('.script-character-input')) field = 'character';
                _scriptManga.sel = { panelIdx, dlgIdx, field };
            });
            // 再レンダー後の選択復元
            if (_scriptManga.sel && _scriptManga.sel.panelIdx === panelIdx && _scriptManga.sel.dlgIdx === dlgIdx) {
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
function _scriptMangaRenderPreviewH() {
    const container = document.getElementById('script-preview-h-container');
    if (!container || !_script.data || !_scriptIsMangaLikeType(_script.data.mediaType)) return;

    container.innerHTML = '';
    _scriptMangaData().pages.forEach(page => {
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
function _scriptMangaRenderPreviewV() {
    const container = document.getElementById('script-preview-v-container');
    if (!container || !_script.data || !_scriptIsMangaLikeType(_script.data.mediaType)) return;

    container.innerHTML = '';
    _scriptMangaData().pages.forEach(page => {
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

// 漫画/半自動マンガ共通のツールバー操作（ページ送り・コマ数増減・セリフ行追加削除・ページ追加削除）を配線する。
// ボタン自体は常時DOMに存在するが、それ以外のメディア選択時は21-script-tab.js側でプレースホルダーに
// 差し替えられ操作不能になるため、ここでは初期化時に一度だけ配線すればよい。
let _scriptMangaInited = false;
function initScriptMangaEditor() {
    if (_scriptMangaInited) return;
    _scriptMangaInited = true;

    document.getElementById('script-page-prev')?.addEventListener('click', () => {
        if (_scriptManga.pageIdx <= 0) return;
        _scriptManga.pageIdx--;
        _scriptManga.sel = null;
        _scriptMangaRenderPage();
    });
    document.getElementById('script-page-next')?.addEventListener('click', () => {
        if (_scriptManga.pageIdx >= _scriptMangaData().pages.length - 1) return;
        _scriptManga.pageIdx++;
        _scriptManga.sel = null;
        _scriptMangaRenderPage();
    });

    // コマ数増減（表示中ページ）
    document.getElementById('script-panel-up')?.addEventListener('click', () => {
        _scriptMangaData().pages[_scriptManga.pageIdx].panels.push(_scriptMangaBlankPanel());
        _scriptSaveCurrent();
        _scriptMangaRenderPage();
    });
    document.getElementById('script-panel-down')?.addEventListener('click', () => {
        const panels = _scriptMangaData().pages[_scriptManga.pageIdx].panels;
        if (panels.length <= 1) return;
        panels.pop();
        if (_scriptManga.sel && _scriptManga.sel.panelIdx >= panels.length) _scriptManga.sel = null;
        _scriptSaveCurrent();
        _scriptMangaRenderPage();
    });

    // コマ数をレイアウトタブで選択中のページのコマ数に合わせる（半自動マンガ作成の
    // 「流し込み」でコマ数を事前に一致させておきたい用途を想定。漫画メディアでも使用可）
    document.getElementById('script-panel-count-sync-btn')?.addEventListener('click', () => {
        const targetCount = state.activePage?.panels?.length;
        if (!targetCount) { alert(t('script.panelCountSyncNoActivePage')); return; }
        const panels = _scriptMangaData().pages[_scriptManga.pageIdx].panels;
        // コマ数が減る場合、削除対象のコマにセリフ・画像プロンプトが入力済みなら誤削除防止の確認を挟む
        if (targetCount < panels.length) {
            const removed = panels.slice(targetCount);
            if (removed.some(_scriptMangaPanelHasData) &&
                !confirm(t('script.panelCountSyncConfirmDataLoss', panels.length, targetCount))) {
                return;
            }
        }
        while (panels.length < targetCount) panels.push(_scriptMangaBlankPanel());
        while (panels.length > targetCount) panels.pop();
        if (_scriptManga.sel && _scriptManga.sel.panelIdx >= panels.length) _scriptManga.sel = null;
        _scriptSaveCurrent();
        _scriptMangaRenderPage();
    });

    // セリフ行の追加（選択行と同一コマ番の直後に挿入）
    document.getElementById('script-dialogue-add')?.addEventListener('click', () => {
        if (!_scriptManga.sel) { alert(t('script.selectDialogueFirst')); return; }
        const panel = _scriptMangaData().pages[_scriptManga.pageIdx].panels[_scriptManga.sel.panelIdx];
        if (!panel) { _scriptManga.sel = null; return; }
        panel.dialogues.splice(_scriptManga.sel.dlgIdx + 1, 0, _scriptMangaBlankDialogue());
        _scriptManga.sel = { panelIdx: _scriptManga.sel.panelIdx, dlgIdx: _scriptManga.sel.dlgIdx + 1 };
        _scriptSaveCurrent();
        _scriptMangaRenderPage();
    });

    // セリフ行の削除（各コマ最低1行は残す）
    document.getElementById('script-dialogue-del')?.addEventListener('click', () => {
        if (!_scriptManga.sel) { alert(t('script.selectDialogueFirst')); return; }
        const panel = _scriptMangaData().pages[_scriptManga.pageIdx].panels[_scriptManga.sel.panelIdx];
        if (!panel) { _scriptManga.sel = null; return; }
        if (panel.dialogues.length <= 1) { alert(t('script.dialogueMinRequired')); return; }
        panel.dialogues.splice(_scriptManga.sel.dlgIdx, 1);
        if (_scriptManga.sel.dlgIdx >= panel.dialogues.length) _scriptManga.sel.dlgIdx = panel.dialogues.length - 1;
        _scriptSaveCurrent();
        _scriptMangaRenderPage();
    });

    // ページ追加（末尾に追加して表示）
    document.getElementById('script-page-add-btn')?.addEventListener('click', () => {
        _scriptMangaData().pages.push(_scriptMangaBlankPage());
        _scriptManga.pageIdx = _scriptMangaData().pages.length - 1;
        _scriptManga.sel = null;
        _scriptSaveCurrent();
        _scriptMangaRenderPage();
    });

    // ページ削除（表示中ページ・最後の1ページは不可）
    document.getElementById('script-page-delete-btn')?.addEventListener('click', () => {
        if (_scriptMangaData().pages.length <= 1) { alert(t('script.lastPageCannotDelete')); return; }
        if (!confirm(t('script.confirmDeletePage', _scriptManga.pageIdx + 1))) return;
        _scriptMangaData().pages.splice(_scriptManga.pageIdx, 1);
        _scriptManga.sel = null;
        _scriptSaveCurrent();
        _scriptMangaRenderPage();
    });
}

export {
    _scriptManga, _scriptMangaData,
    _scriptMangaBlankPage, _scriptMangaBlankData, _scriptMangaNormalize,
    _scriptMangaGetSelectedDialogue, _scriptMangaResetView,
    _scriptMangaRenderPage, _scriptMangaRenderPreviewH, _scriptMangaRenderPreviewV,
    initScriptMangaEditor,
};
