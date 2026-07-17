// ============================================================
// 作品/ページ管理 分割ファイル (2/2): ページ管理タブ
// 元 11-works.js（分割前）の行 692-1462 に相当
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: GOOGLE_FONT_FAMILIES,_applyPageRename,_initPageMgrTab,_movePageToTrashSilent,_pageMgrGroups,_pageMgrGroupsRefreshUI,_pageMgrInited,_pageMgrMoveSelected,_pageMgrSelected,_pageMgrSidePanelUpdate,_pageMgrUpdateGridSelection,arrayBufferToBase64,collectFontFamiliesFromSvg,duplicatePagesInMgr,renamePageInMgr,renameSequentialPagesInMgr,renderPageMgrGrid
// ============================================================

// ==============================
// ページ管理タブ
// ==============================

/**
 * ページグループデータ管理（localStorage）
 * { groupName: [pageName, ...] }
 */
const _pageMgrGroups = {
    _data: null,

    load() {
        try { this._data = JSON.parse(localStorage.getItem('page_groups') || '{}'); }
        catch { this._data = {}; }
        return this._data;
    },
    save() { localStorage.setItem('page_groups', JSON.stringify(this._data)); },
    get data() { return this._data || this.load(); },

    groupNames() { return Object.keys(this.data).sort((a, b) => a.localeCompare(b)); },

    groupOf(pageName) {
        return Object.keys(this.data).find(g => this.data[g].includes(pageName)) || null;
    },

    createGroup(name) {
        if (!name || this.data[name]) return false;
        this.data[name] = [];
        this.save();
        return true;
    },

    deleteGroup(name) {
        delete this.data[name];
        this.save();
    },

    renameGroup(oldName, newName) {
        if (!newName || this.data[newName] || !this.data[oldName]) return false;
        this.data[newName] = this.data[oldName];
        delete this.data[oldName];
        this.save();
        return true;
    },

    assign(pageName, groupName) {
        // 既存グループから除去してから追加
        Object.keys(this.data).forEach(g => {
            this.data[g] = this.data[g].filter(n => n !== pageName);
        });
        if (groupName && this.data[groupName]) {
            this.data[groupName].push(pageName);
        }
        this.save();
    },

    assignMulti(pageNames, groupName) {
        pageNames.forEach(n => this.assign(n, groupName));
    },

    remove(pageName) {
        Object.keys(this.data).forEach(g => {
            this.data[g] = this.data[g].filter(n => n !== pageName);
        });
        this.save();
    },

    removeMulti(pageNames) {
        pageNames.forEach(n => this.remove(n));
    },

    renamePage(oldName, newName) {
        Object.keys(this.data).forEach(g => {
            const idx = this.data[g].indexOf(oldName);
            if (idx !== -1) this.data[g][idx] = newName;
        });
        this.save();
    },
};

/** 選択中ページ名 Set */
let _pageMgrSelected = new Set();
/** ページ管理初期化済みフラグ */
let _pageMgrInited = false;

/** ページ管理タブの初期化（イベント登録は1回のみ） */
function _initPageMgrTab() {
    if (_pageMgrInited) return;
    _pageMgrInited = true;

    _pageMgrGroups.load();

    // グループ追加
    document.getElementById('pagemgr-group-add-btn')?.addEventListener('click', () => {
        const input = document.getElementById('pagemgr-group-name-input');
        const name = input?.value.trim();
        if (!name) return;
        if (RESERVED_GROUP_NAMES.has(name)) { alert(t('page.msgReservedGroupName', name)); return; }
        if (!_pageMgrGroups.createGroup(name)) { alert(t('tmpl.alreadyExists', name)); return; }
        input.value = '';
        _pageMgrGroupsRefreshUI();
        renderWorkList();
    });

    // グループ名変更（作品グループの場合は作品メタ・作業中状態も追従）
    document.getElementById('pagemgr-group-rename-btn')?.addEventListener('click', () => {
        const sel = document.getElementById('pagemgr-group-select');
        const oldName = sel?.value;
        if (!oldName) { alert(t('tmpl.selectGroup')); return; }
        if (RESERVED_GROUP_NAMES.has(oldName)) { alert(t('page.msgReservedGroupRename', oldName)); return; }
        const newName = prompt(t('tmpl.newGroupNamePrompt'), oldName)?.trim();
        if (!newName) return;
        if (RESERVED_GROUP_NAMES.has(newName)) { alert(t('page.msgReservedGroupName', newName)); return; }
        if (!_pageMgrGroups.renameGroup(oldName, newName)) { alert(t('tmpl.alreadyExists', newName)); return; }
        if (_workSelected === oldName) _workSelected = newName;
        const meta = _workMeta.get(oldName);
        if (meta) {
            _workMeta.set(newName, meta);
            _workMeta.remove(oldName);
            if (state.activeWork?.name === oldName) {
                _workSetActive({ ...state.activeWork, name: newName });
            }
        }
        _pageMgrGroupsRefreshUI();
        renderWorkList();
        renderPageMgrGrid();
    });

    // グループ削除（所属ページはゴミ箱へ移動。作品グループの場合は作品メタ・作業中状態も追従）
    document.getElementById('pagemgr-group-delete-btn')?.addEventListener('click', async () => {
        const sel = document.getElementById('pagemgr-group-select');
        const name = sel?.value;
        if (!name) { alert(t('tmpl.selectGroup')); return; }
        if (RESERVED_GROUP_NAMES.has(name)) { alert(t('page.msgReservedGroupDelete', name)); return; }
        const pages = (_pageMgrGroups.data[name] || []).slice();
        if (!confirm(t('page.confirmDeleteGroup', name, pages.length))) return;
        for (const p of pages) await _movePageToTrashSilent(p);
        _pageMgrGroups.deleteGroup(name);
        if (_workMeta.get(name)) _workMeta.remove(name);
        if (_workSelected === name) _workSelected = null;
        if (state.activeWork?.name === name) _workSetActive(null);
        _pageMgrGroupsRefreshUI();
        await renderOutputPageList();
        renderWorkList();
        renderPageMgrGrid();
        updateLayoutPageNav();
    });

    // 作品削除（プロパティペイン: 作品一覧で選択中の作品を削除。所属ページはゴミ箱へ移動）
    document.getElementById('pagemgr-work-delete-btn')?.addEventListener('click', async () => {
        const name = _workSelected;
        if (!name || !_workMeta.get(name)) { alert(t('page.msgSelectWorkFirst')); return; }
        const pages = (_pageMgrGroups.data[name] || []).slice();
        if (!confirm(t('page.confirmDeleteWork', name, pages.length))) return;
        for (const p of pages) await _movePageToTrashSilent(p);
        _pageMgrGroups.deleteGroup(name);
        _workMeta.remove(name);
        _workSelected = null;
        if (state.activeWork?.name === name) _workSetActive(null);
        _pageMgrGroupsRefreshUI();
        await renderOutputPageList();
        renderWorkList();
        renderPageMgrGrid();
        updateLayoutPageNav();
    });

    // 名前変更（単一選択時のみ）
    document.getElementById('pagemgr-rename-btn')?.addEventListener('click', () => {
        if (_pageMgrSelected.size !== 1) return;
        const pageName = [..._pageMgrSelected][0];
        renamePageInMgr(pageName);
    });

    // 連番名前変更（1件以上選択時、出力タブの並び順で ベース名_000, _001... にリネーム）
    document.getElementById('pagemgr-seq-rename-btn')?.addEventListener('click', () => {
        const targets = [..._pageMgrSelected];
        if (targets.length === 0) return;
        renameSequentialPagesInMgr(targets);
    });

    // 指定グループへ移動（選択中ページを移動先グループに付け替え。ゴミ箱表示中は復元として動作）
    document.getElementById('pagemgr-move-group-btn')?.addEventListener('click', async () => {
        const groupName = document.getElementById('pagemgr-move-group-select')?.value;
        if (!groupName) { alert(t('page.msgSelectMoveGroup')); return; }
        const targets = [..._pageMgrSelected];
        if (targets.length === 0) { alert(t('page.msgSelectPages')); return; }

        if (_workSelected === TRASH_GROUP) {
            // ゴミ箱からの復元: trash→pages に戻して指定グループへ所属させる
            try {
                const existing = new Set((await dbGetAllPagesMeta()).map(p => p.name));
                for (const name of targets) {
                    const rec = await dbGet('trash', name);
                    if (!rec) continue;
                    // 同名ページが既に存在する場合はリネームして復元
                    let newName = name;
                    for (let i = 1; existing.has(newName); i++) newName = `${name}_restored${i > 1 ? i : ''}`;
                    existing.add(newName);
                    rec.name = newName;
                    delete rec._trashedAt;
                    await dbPut('pages', rec);
                    await dbDelete('trash', name);
                    _pageMgrGroups.assign(newName, groupName);
                }
                _pageMgrSelected.clear();
                await loadPages();
                renderPageSelector();
                await renderOutputPageList();
                await renderWorkList();
                await renderPageMgrGrid();
                updateLayoutPageNav();
            } catch (e) {
                console.error('[PageMgr Restore]', e);
                alert(t('page.msgRestoreFailed', e.message));
            }
            return;
        }

        _pageMgrGroups.assignMulti(targets, groupName);
        _pageMgrSidePanelUpdate();
        renderWorkList();
        renderPageMgrGrid();
        // レイアウトタブで表示中のページが移動対象に含まれていた場合、
        // 元のactiveWorkのページ一覧から外れて「- / N」のまま古い表示が残るため更新する
        updateLayoutPageNav();
    });

    // ページ複製
    document.getElementById('pagemgr-duplicate-btn')?.addEventListener('click', () => {
        const targets = [..._pageMgrSelected];
        if (targets.length === 0) return;
        duplicatePagesInMgr(targets);
    });

    // 作品内ページ順移動（↑↓）
    document.getElementById('pagemgr-move-up-btn')?.addEventListener('click', () => _pageMgrMoveSelected(-1));
    document.getElementById('pagemgr-move-down-btn')?.addEventListener('click', () => _pageMgrMoveSelected(1));

    // stockへ移動（旧: グループから削除。無所属ページを作らない運用のため stock へ退避する）
    document.getElementById('pagemgr-remove-group-btn')?.addEventListener('click', () => {
        const targets = [..._pageMgrSelected];
        if (targets.length === 0) return;
        _pageMgrGroups.assignMulti(targets, STOCK_GROUP);
        _pageMgrSidePanelUpdate();
        renderWorkList();
        renderPageMgrGrid();
        // レイアウトタブで表示中のページが移動対象に含まれていた場合、
        // 元のactiveWorkのページ一覧から外れて「- / N」のまま古い表示が残るため更新する
        updateLayoutPageNav();
    });

    // 一括削除（ゴミ箱表示中は完全削除）
    document.getElementById('pagemgr-bulk-delete-btn')?.addEventListener('click', async () => {
        const targets = [..._pageMgrSelected];
        if (targets.length === 0) return;
        if (_workSelected === TRASH_GROUP) {
            if (!confirm(t('page.confirmPermanentDelete', t('page.selectedPagesLabel', targets.length)))) return;
            for (const name of targets) {
                await dbDelete('trash', name);
            }
        } else {
            if (!confirm(t('page.confirmTrash', t('page.selectedPagesLabel', targets.length)))) return;
            for (const name of targets) {
                await _movePageToTrashSilent(name);
            }
        }
        _pageMgrSelected.clear();
        _pageMgrSidePanelUpdate();
        await renderOutputPageList();
        await renderWorkList();
        await renderPageMgrGrid();
    });

    // 単一削除（サイドパネルボタン。ゴミ箱表示中は完全削除）
    document.getElementById('pagemgr-delete-btn')?.addEventListener('click', async () => {
        const targets = [..._pageMgrSelected];
        if (targets.length === 0) return;
        const label = targets.length === 1 ? t('page.quotedName', targets[0]) : t('page.selectedPagesLabel', targets.length);
        if (_workSelected === TRASH_GROUP) {
            if (!confirm(t('page.confirmPermanentDelete', label))) return;
            for (const name of targets) {
                await dbDelete('trash', name);
            }
        } else {
            if (!confirm(t('page.confirmTrash', label))) return;
            for (const name of targets) {
                await _movePageToTrashSilent(name);
            }
        }
        _pageMgrSelected.clear();
        _pageMgrSidePanelUpdate();
        await renderOutputPageList();
        await renderWorkList();
        await renderPageMgrGrid();
    });

    // 全選択（選択中の作品/グループのページのみ。ゴミ箱表示中はゴミ箱の全ページ）
    document.getElementById('pagemgr-select-all-btn')?.addEventListener('click', async () => {
        if (_workSelected === TRASH_GROUP) {
            (await dbGetAll('trash')).forEach(p => _pageMgrSelected.add(p.name));
            _pageMgrSidePanelUpdate();
            _pageMgrUpdateGridSelection();
            return;
        }
        if (!_workSelected) return; // 未選択時は一覧非表示のため対象なし
        const allPages = await dbGetAll('pages');
        const members = new Set(_pageMgrGroups.data[_workSelected] || []);
        allPages.filter(p => members.has(p.name)).forEach(p => _pageMgrSelected.add(p.name));
        _pageMgrSidePanelUpdate();
        _pageMgrUpdateGridSelection();
    });

    // 選択解除
    document.getElementById('pagemgr-deselect-btn')?.addEventListener('click', () => {
        _pageMgrSelected.clear();
        _pageMgrSidePanelUpdate();
        _pageMgrUpdateGridSelection();
    });
}

/** 選択ページを作品（グループ）内で前後に移動する（グループ配列の順序＝作品内ページ順） */
function _pageMgrMoveSelected(delta) {
    if (!_workSelected || _pageMgrSelected.size !== 1) return;
    const arr = _pageMgrGroups.data[_workSelected];
    if (!arr) return;
    const name = [..._pageMgrSelected][0];
    const idx = arr.indexOf(name);
    const to = idx + delta;
    if (idx < 0 || to < 0 || to >= arr.length) return;
    [arr[idx], arr[to]] = [arr[to], arr[idx]];
    _pageMgrGroups.save();
    renderPageMgrGrid();
    updateLayoutPageNav();
    // 先頭ページが変わった場合は作品一覧のサムネイルも更新
    if (idx === 0 || to === 0) renderWorkList();
}

/** 選択ページを複製する（同じグループ内の複製元直後に挿入） */
async function duplicatePagesInMgr(targetNames) {
    try {
        const existing = new Set((await dbGetAllPagesMeta()).map(p => p.name));
        for (const name of targetNames) {
            const rec = await dbGet('pages', name);
            if (!rec) continue;

            let newName = `${name}_copy`;
            let i = 2;
            while (existing.has(newName)) newName = `${name}_copy${i++}`;
            existing.add(newName);

            const copy = { ...rec, name: newName, id: `page_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` };
            delete copy._trashedAt;
            await dbPut('pages', copy);

            // 複製元と同じグループの直後に挿入
            const group = _pageMgrGroups.groupOf(name);
            if (group) {
                const arr = _pageMgrGroups.data[group];
                arr.splice(arr.indexOf(name) + 1, 0, newName);
                _pageMgrGroups.save();
            }
        }
        await loadPages();
        renderPageSelector();
        await renderOutputPageList();
        await renderWorkList();
        await renderPageMgrGrid();
        updateLayoutPageNav();
    } catch (e) {
        console.error('[PageMgr Duplicate]', e);
        alert(t('page.msgDuplicateFailed', e.message));
    }
}

/** ページ名変更モーダル */
async function renamePageInMgr(oldName) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:8px;padding:24px;min-width:320px;max-width:480px;width:90%;';
    dialog.innerHTML = `
        <h3 style="margin:0 0 16px;font-size:15px;">${t('page.renameHeader')}</h3>
        <input type="text" id="pagemgr-rename-input" value="${oldName}"
            style="width:100%;box-sizing:border-box;padding:6px 8px;font-size:14px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-primary);color:var(--text-primary);" />
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
            <button id="pagemgr-rename-cancel" class="btn secondary">${t('common.cancel')}</button>
            <button id="pagemgr-rename-ok" class="btn primary">${t('tmpl.renameOk')}</button>
        </div>
    `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const input = dialog.querySelector('#pagemgr-rename-input');
    input.select();

    const close = () => document.body.removeChild(overlay);

    dialog.querySelector('#pagemgr-rename-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    const doRename = async () => {
        const newName = input.value.trim();
        if (!newName) { alert(t('tmpl.enterName')); return; }
        if (newName === oldName) { close(); return; }

        const allPages = await dbGetAll('pages');
        if (allPages.some(p => p.name === newName)) {
            alert(t('tmpl.alreadyExists', newName));
            return;
        }
        try {
            const renamed = await _applyPageRename(oldName, newName);
            if (!renamed) throw new Error(t('page.msgPageNotFound'));

            renderPageSelector();
            await renderOutputPageList();
            await renderWorkList();
            await renderPageMgrGrid();
            close();
        } catch (e) {
            alert(t('tmpl.renameFailed', e.message));
        }
    };

    dialog.querySelector('#pagemgr-rename-ok').addEventListener('click', doRename);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doRename(); });
}

/** ページ名変更の実データ操作（DB更新＋関連stateの追従）を1件分行う。renamePageInMgr / renameSequentialPagesInMgr で共用 */
async function _applyPageRename(oldName, newName) {
    const record = await dbGet('pages', oldName);
    if (!record) return false;
    await dbPut('pages', { ...record, name: newName });
    await dbDelete('pages', oldName);

    // state・_pageOrder・グループを更新
    _pageMgrGroups.renamePage(oldName, newName);
    state.pages = state.pages.map(p => p.name === oldName ? { ...p, name: newName } : p);
    if (state.activePage?.name === oldName) state.activePage = { ...state.activePage, name: newName };
    if (_outputSelectedPage === oldName) _outputSelectedPage = newName;
    const orderIdx = _pageOrder.indexOf(oldName);
    if (orderIdx !== -1) _pageOrder[orderIdx] = newName;
    if (_pageOrderInput[oldName] != null) {
        _pageOrderInput[newName] = _pageOrderInput[oldName];
        delete _pageOrderInput[oldName];
    }

    // 選択を新しい名前に付け替え
    if (_pageMgrSelected.has(oldName)) {
        _pageMgrSelected.delete(oldName);
        _pageMgrSelected.add(newName);
    }
    return true;
}

/** 選択中の複数ページを、出力タブでの並び順（_pageOrder）に従って「ベース名_000」のように連番でリネーム */
async function renameSequentialPagesInMgr(targetNames) {
    const baseName = prompt(t('page.promptSeqRenameBase'), '')?.trim();
    if (!baseName) return;

    // 出力タブでの並び順に従ってソート（_pageOrderに無いものは末尾扱い）
    const orderIndex = new Map(_pageOrder.map((name, idx) => [name, idx]));
    const sortedTargets = [...targetNames].sort((a, b) => {
        const ia = orderIndex.has(a) ? orderIndex.get(a) : Infinity;
        const ib = orderIndex.has(b) ? orderIndex.get(b) : Infinity;
        return ia - ib;
    });

    const targetSet = new Set(sortedTargets);
    const finalNames = sortedTargets.map((_, i) => `${baseName}_${String(i).padStart(3, '0')}`);

    // 対象以外の既存ページ名との重複チェック
    const allPages = await dbGetAll('pages');
    const otherNames = new Set(allPages.filter(p => !targetSet.has(p.name)).map(p => p.name));
    const dupes = finalNames.filter(n => otherNames.has(n));
    if (dupes.length > 0) {
        alert(t('page.msgDuplicateNames', dupes.join(', ')));
        return;
    }

    const lastIndex = String(sortedTargets.length - 1).padStart(3, '0');
    if (!confirm(t('page.confirmSeqRename', sortedTargets.length, baseName, lastIndex))) return;

    try {
        // 一時名を挟んだ2段階リネーム: 対象内に既に「ベース名_NNN」と同名のページが
        // 含まれる場合でも、IndexedDBのkeyPath('name')衝突による上書き事故を防ぐ
        const tmpPrefix = `__seqrename_tmp_${Date.now()}_`;
        for (let i = 0; i < sortedTargets.length; i++) {
            await _applyPageRename(sortedTargets[i], `${tmpPrefix}${i}`);
        }
        for (let i = 0; i < finalNames.length; i++) {
            await _applyPageRename(`${tmpPrefix}${i}`, finalNames[i]);
        }

        renderPageSelector();
        await renderOutputPageList();
        await renderWorkList();
        await renderPageMgrGrid();
    } catch (e) {
        alert(t('page.msgSeqRenameFailed', e.message));
    }
}

/** ゴミ箱移動（確認なし・サイレント） */
async function _movePageToTrashSilent(pageName) {
    try {
        const pageRecord = await dbGet('pages', pageName);
        if (!pageRecord) return;
        pageRecord._trashedAt = new Date().toISOString();
        await dbPut('trash', pageRecord);
        await dbDelete('pages', pageName);
        state.pages = state.pages.filter(p => p.name !== pageName);
        if (_outputSelectedPage === pageName) {
            _outputSelectedPage = null;
            const previewContainer = document.getElementById('export-preview');
            if (previewContainer) previewContainer.innerHTML = `<p class="empty-message">${t('page.exportEmptyMessage')}</p>`;
        }
        if (state.activePage?.name === pageName) state.activePage = null;
        _pageMgrGroups.remove(pageName);
        renderPageSelector();
    } catch (e) {
        console.error('[PageMgr Trash]', pageName, e);
    }
}

/** グループUIを再構築 */
function _pageMgrGroupsRefreshUI() {
    const groups = _pageMgrGroups.groupNames();
    const targets = [
        { sel: document.getElementById('pagemgr-group-select'), placeholder: t('page.groupSelectOption') },
        { sel: document.getElementById('pagemgr-move-group-select'), placeholder: t('page.moveGroupOption') },
    ];
    targets.forEach(({ sel, placeholder }) => {
        if (!sel) return;
        const prevVal = sel.value;
        sel.innerHTML = `<option value="">${placeholder}</option>`;
        groups.forEach(g => {
            const opt = document.createElement('option');
            opt.value = g;
            opt.textContent = g;
            sel.appendChild(opt);
        });
        if (groups.includes(prevVal)) sel.value = prevVal;
    });
}

/** 選択状態に応じてサイドパネルのボタン・テキストを更新 */
function _pageMgrSidePanelUpdate() {
    const count = _pageMgrSelected.size;
    const isTrash = _workSelected === TRASH_GROUP;
    const countEl = document.getElementById('pagemgr-selected-count');
    if (countEl) countEl.textContent = count > 0 ? t('page.selectedCount', count) : '';

    const bulkBtn = document.getElementById('pagemgr-bulk-delete-btn');
    if (bulkBtn) bulkBtn.disabled = count === 0;

    // ゴミ箱表示中はページ編集系の操作を無効化し、削除ボタンを完全削除として扱う
    const renameBtn = document.getElementById('pagemgr-rename-btn');
    const seqRenameBtn = document.getElementById('pagemgr-seq-rename-btn');
    const moveGroupBtn = document.getElementById('pagemgr-move-group-btn');
    const dupBtn = document.getElementById('pagemgr-duplicate-btn');
    const removeBtn = document.getElementById('pagemgr-remove-group-btn');
    const deleteBtn = document.getElementById('pagemgr-delete-btn');
    if (renameBtn) renameBtn.disabled = isTrash || count !== 1;
    if (seqRenameBtn) seqRenameBtn.disabled = isTrash || count === 0;
    // 移動ボタンはゴミ箱表示中も有効（復元として動作）
    if (moveGroupBtn) {
        moveGroupBtn.disabled = count === 0;
        moveGroupBtn.textContent = isTrash ? t('page.restoreBtn') : t('page.moveBtn');
        moveGroupBtn.title = isTrash
            ? t('page.restoreBtnTitle')
            : t('page.moveBtnTitle');
    }
    if (dupBtn) dupBtn.disabled = isTrash || count === 0;
    // stockへ移動: ゴミ箱表示中（復元は移動ボタンで行う）と stock 表示中は無効
    if (removeBtn) removeBtn.disabled = isTrash || count === 0 || _workSelected === STOCK_GROUP;
    if (deleteBtn) {
        deleteBtn.disabled = count === 0;
        deleteBtn.textContent = isTrash ? t('page.permanentDelete') : t('page.deleteTrash');
        deleteBtn.title = isTrash ? t('page.permanentDeleteTitle') : '';
    }

    // 順移動（↑↓）は作品選択中かつ単一選択時のみ
    const canReorder = !isTrash && !!_workSelected && count === 1;
    const upBtn = document.getElementById('pagemgr-move-up-btn');
    const downBtn = document.getElementById('pagemgr-move-down-btn');
    if (upBtn) upBtn.disabled = !canReorder;
    if (downBtn) downBtn.disabled = !canReorder;

    if (count === 0) {
        const nameEl = document.getElementById('pagemgr-prop-name');
        const sizeEl = document.getElementById('pagemgr-prop-size');
        const groupEl = document.getElementById('pagemgr-prop-group');
        if (nameEl) nameEl.textContent = t('layout.notSelected');
        if (sizeEl) sizeEl.textContent = '';
        if (groupEl) groupEl.textContent = '';
    } else if (count === 1) {
        const pageName = [..._pageMgrSelected][0];
        const page = state.pages.find(p => p.name === pageName);
        const nameEl = document.getElementById('pagemgr-prop-name');
        const sizeEl = document.getElementById('pagemgr-prop-size');
        const groupEl = document.getElementById('pagemgr-prop-group');
        if (nameEl) nameEl.textContent = pageName;
        if (sizeEl) sizeEl.textContent = page ? `${page.width || '?'} × ${page.height || '?'}` : '';
        const group = _pageMgrGroups.groupOf(pageName);
        if (groupEl) {
            groupEl.textContent = isTrash ? t('tmpl.groupLabel', TRASH_GROUP_LABEL)
                : group ? t('tmpl.groupLabel', group) : t('tmpl.groupNone');
        }
    } else {
        const nameEl = document.getElementById('pagemgr-prop-name');
        const sizeEl = document.getElementById('pagemgr-prop-size');
        const groupEl = document.getElementById('pagemgr-prop-group');
        if (nameEl) nameEl.textContent = t('page.selectedPagesCount', count);
        if (sizeEl) sizeEl.textContent = '';
        if (groupEl) groupEl.textContent = '';
    }
}

/** グリッドの各カードの選択状態CSSのみ更新 */
function _pageMgrUpdateGridSelection() {
    const grid = document.getElementById('pagemgr-grid');
    if (!grid) return;
    grid.querySelectorAll('.pagemgr-card').forEach(card => {
        card.classList.toggle('selected', _pageMgrSelected.has(card.dataset.pageName));
    });
    _pageMgrSidePanelUpdate();
}

/** ページ一覧グリッドを描画（作品一覧で選択中の作品でフィルタ。未選択時は全ページ） */
async function renderPageMgrGrid() {
    _initPageMgrTab();
    _pageMgrGroupsRefreshUI();

    const grid = document.getElementById('pagemgr-grid');
    if (!grid) return;

    const allPagesMeta = await dbGetAllPagesMeta();
    state.pages = allPagesMeta;
    state.pages.sort((a, b) => b.name.localeCompare(a.name));

    const filterGroup = _workSelected || '';
    const isTrash = filterGroup === TRASH_GROUP;
    const label = document.getElementById('pagemgr-work-label');
    if (label) {
        label.textContent = isTrash
            ? t('tmpl.groupLabel', TRASH_GROUP_LABEL)
            : filterGroup
                ? (_workMeta.get(filterGroup) ? t('page.workLabel', filterGroup) : t('tmpl.groupLabel', filterGroup))
                : t('layout.notSelected');
    }

    // ページは必ず作品・stock・任意グループのいずれかに属する運用のため、未選択時は一覧を表示しない
    if (!filterGroup) {
        grid.innerHTML = `<p class="empty-message">${t('page.msgSelectWorkOrGroup')}</p>`;
        _pageMgrSelected.clear();
        _pageMgrSidePanelUpdate();
        return;
    }

    let pages;
    if (isTrash) {
        // ゴミ箱: trashストアの内容を削除日時の新しい順で表示
        let trashRecs = [];
        try { trashRecs = await dbGetAll('trash'); } catch (_) { /* 取得失敗時は空表示 */ }
        trashRecs.sort((a, b) => (b._trashedAt || '').localeCompare(a._trashedAt || ''));
        pages = trashRecs;
    } else {
        pages = [...allPagesMeta].sort((a, b) => b.name.localeCompare(a.name));
        if (filterGroup) {
            // 作品選択時はグループ配列の順序＝作品内ページ順で表示
            const order = _pageMgrGroups.data[filterGroup] || [];
            const orderIdx = new Map(order.map((n, i) => [n, i]));
            pages = pages
                .filter(p => orderIdx.has(p.name))
                .sort((a, b) => orderIdx.get(a.name) - orderIdx.get(b.name));
        }
    }

    if (pages.length === 0) {
        grid.innerHTML = `<p class="empty-message">${isTrash ? t('page.msgTrashEmpty') : t('asset.noPages')}</p>`;
        _pageMgrSelected.clear();
        _pageMgrSidePanelUpdate();
        return;
    }

    // 存在しないページを選択から除去
    const pageNames = new Set(pages.map(p => p.name));
    _pageMgrSelected.forEach(n => { if (!pageNames.has(n)) _pageMgrSelected.delete(n); });

    grid.innerHTML = '';
    for (const pageMeta of pages) {
        const card = document.createElement('div');
        card.className = 'pagemgr-card';
        card.dataset.pageName = pageMeta.name;
        if (_pageMgrSelected.has(pageMeta.name)) card.classList.add('selected');

        // サムネイル生成: dbPut時に埋め込まれたキャッシュ(pageMeta.thumb)を使う。無ければその場で生成しキャッシュに書き戻す
        let thumbHtml = '<div class="pagemgr-card-thumb pagemgr-card-thumb-empty">No Image</div>';
        try {
            const dataUrl = await _getOrBuildPageThumb(pageMeta, isTrash ? 'trash' : 'pages');
            if (dataUrl) thumbHtml = `<div class="pagemgr-card-thumb"><img src="${dataUrl}" loading="lazy" /></div>`;
        } catch (e) { /* サムネイル生成失敗は無視 */ }
        const page = pageMeta;

        // バッジ: 通常は所属グループ、ゴミ箱表示では削除日時
        let groupBadge = '';
        if (isTrash) {
            if (page._trashedAt) {
                groupBadge = `<div class="pagemgr-card-group">${t('page.trashedAtLabel', new Date(page._trashedAt).toLocaleString())}</div>`;
            }
        } else {
            const group = _pageMgrGroups.groupOf(page.name);
            if (group) groupBadge = `<div class="pagemgr-card-group">${group}</div>`;
        }

        card.innerHTML = `
            ${thumbHtml}
            <div class="pagemgr-card-name" title="${page.name}">${page.name}</div>
            ${groupBadge}
        `;

        card.addEventListener('click', (e) => {
            const isCtrl = e.ctrlKey || e.metaKey;
            if (isCtrl) {
                // Ctrl+クリック: トグル
                if (_pageMgrSelected.has(page.name)) {
                    _pageMgrSelected.delete(page.name);
                } else {
                    _pageMgrSelected.add(page.name);
                }
            } else {
                // 通常クリック: 単一選択
                _pageMgrSelected.clear();
                _pageMgrSelected.add(page.name);
            }
            _pageMgrUpdateGridSelection();
        });

        grid.appendChild(card);
    }

    _pageMgrSidePanelUpdate();
}

// ------------------------------------------------------------
// フォント埋め込みヘルパー（Canvas出力用）
// ------------------------------------------------------------

// SVGテキスト内で使用されているfont-family属性値を収集する
function collectFontFamiliesFromSvg(svgText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const families = new Set();
    doc.querySelectorAll('[font-family]').forEach(el => {
        const ff = el.getAttribute('font-family');
        if (ff) ff.split(',').forEach(f => families.add(f.trim().replace(/['"]/g, '')));
    });
    return [...families];
}

// Google Fontsのリスト（index.htmlのlinkタグと同期）
const GOOGLE_FONT_FAMILIES = new Set([
    'BIZ UDPGothic', 'BIZ UDPMincho', 'Zen Antique', 'Zen Antique Soft',
    'Shippori Antique B1', 'Shippori Mincho B1', 'Hachi Maru Pop',
    'Oswald', 'Archivo Black', 'Dancing Script', 'Anton'
]);

// ArrayBufferをbase64文字列に変換
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

