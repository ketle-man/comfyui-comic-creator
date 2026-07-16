// ============================================================
// 作品/ページ管理 分割ファイル (1/2): 作品管理(ページグループ単位の作品)
// 元 11-works.js（分割前）の行 1-691 に相当
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: RESERVED_GROUP_NAMES,STOCK_GROUP,TRASH_GROUP,TRASH_GROUP_LABEL,WORK_SIZE_PRESETS,_adoptOrphanPagesToStock,_assetTmplSelected,_closeWorkCreateDialog,_getOrBuildPageThumb,_initWorkCreateDialog,_initWorkMgr,_openWorkCreateDialog,_renderGroupList,_scalePointsStr,_scaleSvgContentByWrap,_scaleSvgElementTree,_workCreate,_workDlgApplyPreset,_workDlgGetPreset,_workDlgRebuildPresetSelect,_workListTab,_workMeta,_workSelected,_workSetActive,_workSetListTab,_workSizePresets,_workTimestampStr,_workUpdateActiveLabel,_workUpdateOpenBtn,insertTemplatePageToWork,openWork,renderAssetTemplateGrid,renderWorkList
// ============================================================

// ==============================
// 作品管理（ページグループ単位の作品）
// ==============================

/**
 * 作品メタデータ管理（localStorage）
 * { workName: { width, height, createdAt } }
 * workName はページグループ名と1:1で対応する
 */
const _workMeta = {
    _data: null,

    load() {
        try { this._data = JSON.parse(localStorage.getItem('work_meta') || '{}'); }
        catch { this._data = {}; }
        return this._data;
    },
    save() { localStorage.setItem('work_meta', JSON.stringify(this._data)); },
    get data() { return this._data || this.load(); },

    get(name) { return this.data[name] || null; },
    set(name, meta) { this.data[name] = meta; this.save(); },
    remove(name) { delete this.data[name]; this.save(); },
};

/** 予約済みグループ: ゴミ箱（trashストアの内容を表示する仮想グループ。実グループとしては存在しない） */
const TRASH_GROUP = '__trash__';
const TRASH_GROUP_LABEL = t('page.trashLabel');
/** 予約済みグループ: stock（未整理ページの置き場。起動時に自動作成される実グループ。削除・リネーム不可） */
const STOCK_GROUP = 'stock';
/** グループ名として新規作成・リネームで使用禁止の予約名 */
const RESERVED_GROUP_NAMES = new Set([TRASH_GROUP, TRASH_GROUP_LABEL, 'ゴミ箱', 'Trash', '回收站', STOCK_GROUP]);

/** 作品一覧ペインで選択中の作品/グループ名（中央ペインのフィルタ） */
let _workSelected = null;
/** 作品一覧ペインのアクティブタブ（'works' | 'groups'） */
let _workListTab = 'works';
/** アセットパネルのテンプレートタブで選択中のテンプレート名 */
let _assetTmplSelected = null;

function _workTimestampStr(d = new Date()) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// ------------------------------
// 作品新規作成ダイアログ（サイズプリセット）
// ------------------------------

/** 標準サイズプリセット（SVG座標単位 = mm×100 相当） */
const WORK_SIZE_PRESETS = [
    { name: t('page.presetA4Portrait'), width: 21000, height: 29700 },
    { name: t('page.presetA4Landscape'), width: 29700, height: 21000 },
    { name: t('page.presetB5Portrait'), width: 18200, height: 25700 },
    { name: t('page.presetB4Portrait'), width: 25700, height: 36400 },
    { name: t('page.presetA5Portrait'), width: 14800, height: 21000 },
    { name: t('page.presetSquare'), width: 21000, height: 21000 },
];

/** カスタムサイズプリセット（localStorage永続化） */
const _workSizePresets = {
    load() {
        try { return JSON.parse(localStorage.getItem('work_size_presets') || '[]'); }
        catch { return []; }
    },
    save(list) { localStorage.setItem('work_size_presets', JSON.stringify(list)); },
};

/** プリセットselectのvalue（std:n / custom:n）からプリセットを取得 */
function _workDlgGetPreset(value) {
    if (value?.startsWith('std:')) return WORK_SIZE_PRESETS[parseInt(value.slice(4), 10)] || null;
    if (value?.startsWith('custom:')) return _workSizePresets.load()[parseInt(value.slice(7), 10)] || null;
    return null;
}

/** プリセットselectを再構築（標準＋カスタム＋直接入力） */
function _workDlgRebuildPresetSelect(selectedValue) {
    const sel = document.getElementById('work-dlg-preset');
    if (!sel) return;
    sel.innerHTML = '';
    WORK_SIZE_PRESETS.forEach((p, i) => {
        const opt = document.createElement('option');
        opt.value = `std:${i}`;
        opt.textContent = p.name;
        sel.appendChild(opt);
    });
    _workSizePresets.load().forEach((p, i) => {
        const opt = document.createElement('option');
        opt.value = `custom:${i}`;
        opt.textContent = `★ ${p.name} (${p.width}×${p.height})`;
        sel.appendChild(opt);
    });
    const customOpt = document.createElement('option');
    customOpt.value = 'custom';
    customOpt.textContent = t('page.presetCustomOption');
    sel.appendChild(customOpt);
    sel.value = (selectedValue && [...sel.options].some(o => o.value === selectedValue))
        ? selectedValue : 'std:0';
    _workDlgApplyPreset();
}

/** 選択中プリセットの値を幅・高さ欄に反映し、カスタム削除ボタンの表示を更新 */
function _workDlgApplyPreset() {
    const sel = document.getElementById('work-dlg-preset');
    const p = _workDlgGetPreset(sel?.value);
    if (p) {
        document.getElementById('work-dlg-width').value = p.width;
        document.getElementById('work-dlg-height').value = p.height;
    }
    const delBtn = document.getElementById('work-dlg-preset-delete');
    if (delBtn) delBtn.style.display = sel?.value.startsWith('custom:') ? '' : 'none';
}

function _openWorkCreateDialog() {
    const dlg = document.getElementById('work-create-dialog');
    if (!dlg) return;
    const nameInput = document.getElementById('work-dlg-name');
    if (nameInput) nameInput.value = '';
    _workDlgRebuildPresetSelect();
    dlg.style.display = 'flex';
    nameInput?.focus();
}

function _closeWorkCreateDialog() {
    const dlg = document.getElementById('work-create-dialog');
    if (dlg) dlg.style.display = 'none';
}

/** ダイアログのイベント登録（_initWorkMgr から1回だけ呼ぶ） */
function _initWorkCreateDialog() {
    document.getElementById('work-dlg-preset')?.addEventListener('change', _workDlgApplyPreset);

    // 幅・高さを直接編集したらプリセット選択をカスタムに切り替え
    ['work-dlg-width', 'work-dlg-height'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', () => {
            const sel = document.getElementById('work-dlg-preset');
            const p = _workDlgGetPreset(sel?.value);
            if (!p) return;
            const w = parseInt(document.getElementById('work-dlg-width')?.value, 10);
            const h = parseInt(document.getElementById('work-dlg-height')?.value, 10);
            if (p.width !== w || p.height !== h) {
                sel.value = 'custom';
                _workDlgApplyPreset();
            }
        });
    });

    // カスタムプリセット保存
    document.getElementById('work-dlg-preset-save')?.addEventListener('click', () => {
        const width = parseInt(document.getElementById('work-dlg-width')?.value, 10);
        const height = parseInt(document.getElementById('work-dlg-height')?.value, 10);
        if (!(width > 0 && height > 0)) { alert(t('page.msgInvalidSize')); return; }
        const name = prompt(t('page.promptPresetName'), `${width}×${height}`)?.trim();
        if (!name) return;
        const list = _workSizePresets.load();
        list.push({ name, width, height });
        _workSizePresets.save(list);
        _workDlgRebuildPresetSelect(`custom:${list.length - 1}`);
    });

    // カスタムプリセット削除
    document.getElementById('work-dlg-preset-delete')?.addEventListener('click', () => {
        const sel = document.getElementById('work-dlg-preset');
        if (!sel?.value.startsWith('custom:')) return;
        const idx = parseInt(sel.value.slice(7), 10);
        const list = _workSizePresets.load();
        if (!list[idx]) return;
        if (!confirm(t('page.confirmDeletePreset', list[idx].name))) return;
        list.splice(idx, 1);
        _workSizePresets.save(list);
        _workDlgRebuildPresetSelect();
    });

    // 作成・キャンセル・背景クリックで閉じる
    document.getElementById('work-dlg-create')?.addEventListener('click', async () => {
        const name = document.getElementById('work-dlg-name')?.value;
        const width = parseInt(document.getElementById('work-dlg-width')?.value, 10);
        const height = parseInt(document.getElementById('work-dlg-height')?.value, 10);
        if (!(width > 0 && height > 0)) { alert(t('page.msgInvalidSize')); return; }
        _closeWorkCreateDialog();
        await _workCreate(name, width, height);
    });
    document.getElementById('work-dlg-cancel')?.addEventListener('click', _closeWorkCreateDialog);
    document.getElementById('work-create-dialog')?.addEventListener('click', e => {
        if (e.target === e.currentTarget) _closeWorkCreateDialog();
    });
    // 作品名欄でEnter→作成
    document.getElementById('work-dlg-name')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('work-dlg-create')?.click();
    });
}

function _initWorkMgr() {
    _workMeta.load();

    // 予約済みグループ stock を常設（未整理ページの置き場）
    if (!_pageMgrGroups.data[STOCK_GROUP]) _pageMgrGroups.createGroup(STOCK_GROUP);
    // 無所属ページを stock へ収容（ページは必ず作品・stock・任意グループのいずれかに属する運用）
    _adoptOrphanPagesToStock();

    // 前回の作業対象作品を復元
    const lastWork = localStorage.getItem('active_work');
    if (lastWork && _workMeta.get(lastWork)) {
        const meta = _workMeta.get(lastWork);
        state.activeWork = { name: lastWork, width: meta.width, height: meta.height };
    }
    _workUpdateActiveLabel();

    document.getElementById('work-create-btn')?.addEventListener('click', _openWorkCreateDialog);
    _initWorkCreateDialog();
    document.getElementById('work-open-btn')?.addEventListener('click', () => {
        if (_workSelected) openWork(_workSelected);
    });
    document.getElementById('work-tab-works')?.addEventListener('click', () => _workSetListTab('works'));
    document.getElementById('work-tab-groups')?.addEventListener('click', () => _workSetListTab('groups'));

    // 出力: 選択中の作品/グループのページを出力サブタブで表示
    document.getElementById('work-export-btn')?.addEventListener('click', async () => {
        if (!_workSelected) return;
        _outputFilterGroup = _workSelected;
        await _activateOutputSubtab('export');
    });
    // 出力サブタブのフィルタ解除
    document.getElementById('output-filter-clear-btn')?.addEventListener('click', async () => {
        _outputFilterGroup = null;
        await renderOutputPageList();
    });
    document.getElementById('asset-template-insert-btn')?.addEventListener('click', () => insertTemplatePageToWork());

    // 作品管理サブタブは初期表示のため、作品一覧・ページ一覧とも起動時に描画する
    renderWorkList();
    renderPageMgrGrid();
}

/** どのグループにも属さないページを stock へ収容する（起動時マイグレーション） */
async function _adoptOrphanPagesToStock() {
    try {
        const metas = await dbGetAllPagesMeta();
        const orphans = metas.filter(p => !_pageMgrGroups.groupOf(p.name)).map(p => p.name);
        if (orphans.length === 0) return;
        orphans.forEach(n => _pageMgrGroups.assign(n, STOCK_GROUP));
        console.log(`[PageMgr] 無所属ページ ${orphans.length} 件を stock へ収容しました`);
        renderWorkList();
        renderPageMgrGrid();
    } catch (e) {
        console.error('[PageMgr] 無所属ページのstock収容に失敗:', e);
    }
}

function _workSetActive(work) {
    state.activeWork = work;
    if (work) localStorage.setItem('active_work', work.name);
    else localStorage.removeItem('active_work');
    _workUpdateActiveLabel();
    // レイアウトタブのアセットパネル「ページ」タブは作業中の作品のページに絞っているため、作品切替時に合わせて更新する
    renderPageThumbGrid();
}

function _workUpdateActiveLabel() {
    const label = document.getElementById('work-active-label');
    if (!label) return;
    label.textContent = state.activeWork
        ? t('page.activeWorkLabel', state.activeWork.name, state.activeWork.width, state.activeWork.height)
        : '';
}

/** 新規作成: 作品名_日時 のページグループを作成し、レイアウトで作業を開始する */
async function _workCreate(name, widthVal, heightVal) {
    const baseName = (name || '').trim() || 'name';
    const width = Math.max(1, parseInt(widthVal, 10) || 21000);
    const height = Math.max(1, parseInt(heightVal, 10) || 29700);
    const workName = `${baseName}_${_workTimestampStr()}`;

    if (!_pageMgrGroups.createGroup(workName)) {
        alert(t('page.msgWorkGroupCreateFailed', workName));
        return;
    }
    _workMeta.set(workName, { width, height, createdAt: Date.now() });
    _workSetActive({ name: workName, width, height });
    // グループタブ表示中でも新規作品が見えるよう作品一覧タブへ切り替える
    if (_workListTab !== 'works') {
        _workListTab = 'works';
        document.getElementById('work-tab-works')?.classList.remove('secondary');
        document.getElementById('work-tab-groups')?.classList.add('secondary');
    }
    _workSelected = workName;
    await renderWorkList();

    // 新しい作品にはまだページがないため、レイアウトを空にしてテンプレート挿入を促す
    state.activePage = null;
    state.selectedPanelId = null;
    state.history = [];
    const preview = document.getElementById('layout-preview');
    if (preview) preview.innerHTML = `<p class="empty-message">${t('page.msgInsertTemplatePrompt')}</p>`;
    updatePanelSelectDropdown();
    renderPageSelector();
    updateLayoutPageNav();
    await switchTab('layout');
}

/** 開く: 作品の1ページ目をレイアウトに展開する */
async function openWork(workName) {
    const meta = _workMeta.get(workName);
    if (!meta) { alert(t('page.msgWorkMetaNotFound')); return; }
    _workSetActive({ name: workName, width: meta.width, height: meta.height });
    _workSelected = workName;

    const pages = (_pageMgrGroups.data[workName] || []).slice();
    if (pages.length > 0) {
        await switchActivePage(pages[0]);
        renderPageSelector();
    } else {
        state.activePage = null;
        state.selectedPanelId = null;
        state.history = [];
        const preview = document.getElementById('layout-preview');
        if (preview) preview.innerHTML = `<p class="empty-message">${t('page.msgWorkNoPagesYet')}</p>`;
        updatePanelSelectDropdown();
        updateLayoutPageNav();
    }
    await switchTab('layout');
}

/** 作品一覧ペインのタブ切替（作品一覧/グループ） */
function _workSetListTab(tab) {
    if (_workListTab === tab) return;
    _workListTab = tab;
    _workSelected = null;
    document.getElementById('work-tab-works')?.classList.toggle('secondary', tab !== 'works');
    document.getElementById('work-tab-groups')?.classList.toggle('secondary', tab !== 'groups');
    _workUpdateOpenBtn();
    renderWorkList();
    renderPageMgrGrid();
}

/** グループタブ: 通常グループ（作品メタなし）の名前リストと予約済みグループ（ゴミ箱）を描画 */
async function _renderGroupList(grid) {
    const groups = _pageMgrGroups.groupNames().filter(g => !_workMeta.get(g));
    grid.innerHTML = '';

    const makeItem = (name, labelHtml) => {
        const item = document.createElement('div');
        item.className = 'work-group-item';
        item.dataset.groupName = name;
        if (_workSelected === name) item.classList.add('selected');
        item.innerHTML = labelHtml;
        item.addEventListener('click', () => {
            // 再クリックで選択解除（ページ一覧は全ページ表示に戻る）
            _workSelected = (_workSelected === name) ? null : name;
            grid.querySelectorAll('.work-group-item').forEach(el => {
                el.classList.toggle('selected', el.dataset.groupName === _workSelected);
            });
            _workUpdateOpenBtn();
            renderPageMgrGrid();
        });
        return item;
    };

    // 予約済みグループ stock を先頭に固定
    groups.sort((a, b) => (a === STOCK_GROUP ? -1 : b === STOCK_GROUP ? 1 : 0));
    groups.forEach(name => {
        const count = (_pageMgrGroups.data[name] || []).length;
        const prefix = name === STOCK_GROUP ? '📦 ' : '';
        grid.appendChild(makeItem(name,
            `${prefix}${_escHtml(name)} <span style="color:var(--text-secondary); font-size:11px;">${t('page.pageCountSuffix', count)}</span>`));
    });

    // 予約済みグループ: ゴミ箱（削除ページの一時保管。選択で中身を確認できる）
    let trashCount = 0;
    try { trashCount = (await dbGetAll('trash')).length; } catch (_) { /* 取得失敗時は0件表示 */ }
    grid.appendChild(makeItem(TRASH_GROUP,
        `🗑 ${TRASH_GROUP_LABEL} <span style="color:var(--text-secondary); font-size:11px;">${t('page.pageCountSuffix', trashCount)}</span>`));
}

/**
 * ページのサムネイル(data URL)を取得する。dbPut時に埋め込まれたキャッシュ(pageMeta.thumb)があればそれを返し、
 * 無ければ（保存済み旧データ等）その場でフルレコードを取得して生成し、dbPutで書き戻してキャッシュ化する。
 * 旧フォーマット（挿入画像込みのSVGをそのままdata URL化した重いサムネイル）が残っている場合も
 * 再生成対象として扱い、軽量なラスタ画像へ自動移行する。
 * @param {{name:string, thumb?:string}} pageMeta - dbGetAllPagesMeta() の1件、またはtrashのフルレコード
 * @param {'pages'|'trash'} storeName
 */
async function _getOrBuildPageThumb(pageMeta, storeName) {
    const isLegacySvgThumb = pageMeta.thumb && pageMeta.thumb.startsWith('data:image/svg+xml');
    if (pageMeta.thumb && !isLegacySvgThumb) return pageMeta.thumb;
    try {
        const full = storeName === 'pages' ? await dbGet('pages', pageMeta.name) : pageMeta;
        if (!full?.svgContent) return null;
        await dbPut(storeName, full); // dbPut側でfull.thumbを計算・埋め込み、次回以降のキャッシュとして永続化される
        return full.thumb || null;
    } catch (e) { return null; }
}

/** 作品一覧を描画（グループタブと同様、テキストのみの名前リストで表示）。グループタブ選択中は名前リストを描画 */
async function renderWorkList() {
    const grid = document.getElementById('work-list-grid');
    if (!grid) return;

    if (_workListTab === 'groups') {
        await _renderGroupList(grid);
        return;
    }

    const metas = _workMeta.data;
    const names = Object.keys(metas).sort((a, b) => (metas[b].createdAt || 0) - (metas[a].createdAt || 0));

    if (names.length === 0) {
        grid.innerHTML = `<p class="empty-message">${t('page.noWorks')}</p>`;
        _workUpdateOpenBtn();
        return;
    }

    grid.innerHTML = '';
    for (const name of names) {
        const meta = metas[name];
        const pages = (_pageMgrGroups.data[name] || []).slice();

        const activeBadge = state.activeWork?.name === name
            ? `<span style="font-size:10px; color:var(--accent-primary, #0077ff); font-weight:bold;">${t('page.activeBadge')}</span> `
            : '';

        const item = document.createElement('div');
        item.className = 'work-group-item';
        item.dataset.workName = name;
        if (_workSelected === name) item.classList.add('selected');
        item.title = name;
        item.innerHTML = `${activeBadge}${_escHtml(name)} <span style="color:var(--text-secondary); font-size:11px;">${t('page.workCardInfo', meta.width, meta.height, pages.length)}</span>`;
        item.addEventListener('click', () => {
            // 再クリックで選択解除（ページ一覧は全ページ表示に戻る）
            _workSelected = (_workSelected === name) ? null : name;
            grid.querySelectorAll('.work-group-item').forEach(el => {
                el.classList.toggle('selected', el.dataset.workName === _workSelected);
            });
            _workUpdateOpenBtn();
            renderPageMgrGrid();
        });
        item.addEventListener('dblclick', () => openWork(name));
        grid.appendChild(item);
    }
    _workUpdateOpenBtn();
}

function _workUpdateOpenBtn() {
    const isWork = !!_workSelected && !!_workMeta.get(_workSelected);
    const openBtn = document.getElementById('work-open-btn');
    if (openBtn) openBtn.disabled = !isWork;
    // 出力ボタンは作品・グループどちらの選択でも有効（ゴミ箱は出力対象外）
    const exportBtn = document.getElementById('work-export-btn');
    if (exportBtn) exportBtn.disabled = !_workSelected || _workSelected === TRASH_GROUP;
    // 作品削除ボタン（プロパティペイン）は作品選択時のみ有効
    const workDelBtn = document.getElementById('pagemgr-work-delete-btn');
    if (workDelBtn) workDelBtn.disabled = !isWork;
}

// ------------------------------
// アセットパネル: テンプレートタブ
// ------------------------------

function renderAssetTemplateGrid() {
    const grid = document.getElementById('asset-template-grid');
    if (!grid) return;

    if (!state.templates.length) {
        grid.innerHTML = `<p class="empty-message">${t('asset.noTemplates')}</p>`;
        return;
    }

    grid.innerHTML = '';
    state.templates.forEach(template => {
        const card = document.createElement('div');
        card.className = 'page-thumb-card';
        card.dataset.templateName = template.name;
        if (_assetTmplSelected === template.name) card.classList.add('active');

        let thumbHtml = '<div class="page-thumb-card-thumb page-thumb-card-thumb-empty">No Image</div>';
        if (template.svgContent) {
            try {
                thumbHtml = `<div class="page-thumb-card-thumb"><img src="${svgTextToDataUrl(template.svgContent)}" loading="lazy" /></div>`;
            } catch (e) { /* サムネイル生成失敗は無視 */ }
        }

        card.innerHTML = `${thumbHtml}<div class="page-thumb-card-name" title="${_escHtml(template.name)}">${_escHtml(template.name)}</div>`;
        card.addEventListener('click', () => {
            _assetTmplSelected = template.name;
            grid.querySelectorAll('.page-thumb-card').forEach(c => {
                c.classList.toggle('active', c.dataset.templateName === template.name);
            });
            const btn = document.getElementById('asset-template-insert-btn');
            if (btn) btn.disabled = false;
        });
        card.addEventListener('dblclick', () => insertTemplatePageToWork(template.name));
        grid.appendChild(card);
    });
}

/** テンプレートを作品サイズにリサイズして新規ページとして追加し、レイアウトに展開する */
async function insertTemplatePageToWork(templateName) {
    const tmplName = templateName || _assetTmplSelected;
    if (!tmplName) { alert(t('tmpl.selectTemplate')); return; }
    const templateRecord = await dbGet('templates', tmplName);
    if (!templateRecord) { alert(t('tmpl.notFound')); return; }

    try {
        const work = state.activeWork;
        const targetW = work?.width || templateRecord.width;
        const targetH = work?.height || templateRecord.height;
        const sx = targetW / templateRecord.width;
        const sy = targetH / templateRecord.height;
        const needScale = Math.abs(sx - 1) > 1e-9 || Math.abs(sy - 1) > 1e-9;

        const { svgDoc } = _prepareTemplateSvgDocForPage(templateRecord.svgContent);
        const svgEl = svgDoc.querySelector('svg');
        if (needScale && svgEl) {
            Array.from(svgEl.children).forEach(child => _scaleSvgElementTree(child, sx, sy));
            svgEl.setAttribute('viewBox', `0 0 ${targetW} ${targetH}`);
            svgEl.removeAttribute('width');
            svgEl.removeAttribute('height');
        }
        const cleanSvgContent = new XMLSerializer().serializeToString(svgDoc.documentElement);

        const timestamp = Date.now();
        const pageName = `${work ? work.name : templateRecord.name}_${timestamp}`;
        const panels = JSON.parse(JSON.stringify(templateRecord.panels || [])).map(p => {
            const panel = { ...p, panelSvgContent: p.panelSvgContent || '' };
            if (needScale) {
                panel.points = _scalePointsStr(panel.points, sx, sy);
                if (typeof panel.x === 'number') panel.x = _round2(panel.x * sx);
                if (typeof panel.y === 'number') panel.y = _round2(panel.y * sy);
                if (typeof panel.width === 'number') panel.width = _round2(panel.width * sx);
                if (typeof panel.height === 'number') panel.height = _round2(panel.height * sy);
                if (panel.panelSvgContent) {
                    panel.panelSvgContent = _scaleSvgContentByWrap(panel.panelSvgContent, sx, sy, targetW, targetH);
                }
            }
            return panel;
        });

        const pageRecord = {
            name: pageName,
            id: `page_${timestamp}`,
            originalTemplate: templateRecord.name,
            width: targetW,
            height: targetH,
            panels,
            svgContent: cleanSvgContent,
            basePanelPoints: needScale
                ? _scalePointsStr(templateRecord.basePanelPoints || '', sx, sy)
                : (templateRecord.basePanelPoints || ''),
            overlaySvgContent: needScale
                ? _scaleSvgContentByWrap(templateRecord.overlaySvgContent || '', sx, sy, targetW, targetH)
                : (templateRecord.overlaySvgContent || ''),
        };

        await dbPut('pages', pageRecord);
        if (work) _pageMgrGroups.assign(pageName, work.name);
        await loadPages();

        state.activePage = pageRecord;
        state.selectedPanelId = null;
        state.selectedOverlay = true;
        state.history = [];

        renderPageSelector();
        await renderLayoutTab();
        updatePanelSelectDropdown();
    } catch (e) {
        console.error('Template page insert error:', e);
        alert(t('page.msgAddPageFailed', e.message));
    }
}

// ------------------------------
// SVGスケーリングユーティリティ（テンプレート→作品サイズ変換）
// ------------------------------

/** "x1,y1 x2,y2 ..." 形式の座標列を sx/sy 倍する */
function _scalePointsStr(points, sx, sy) {
    const nums = String(points || '').trim().split(/[\s,]+/).map(Number).filter(n => Number.isFinite(n));
    const pairs = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
        pairs.push(`${_round2(nums[i] * sx)},${_round2(nums[i + 1] * sy)}`);
    }
    return pairs.join(' ');
}

/**
 * SVG要素ツリーの座標属性を数値スケールする。
 * transform を持つ要素と path は数値変換せず scale() を前置して座標系ごと変換する
 * （その場合、子孫は座標系ごとスケールされるため再帰しない）。
 */
function _scaleSvgElementTree(el, sx, sy) {
    if (el.nodeType !== 1) return;
    const avg = (sx + sy) / 2;
    const scaleAttr = (attr, s) => {
        const v = parseFloat(el.getAttribute(attr));
        if (Number.isFinite(v)) el.setAttribute(attr, String(_round2(v * s)));
    };

    const existingTransform = el.getAttribute('transform');
    if (existingTransform) {
        el.setAttribute('transform', `scale(${sx} ${sy}) ${existingTransform}`);
        return;
    }

    const tag = el.tagName.toLowerCase();
    switch (tag) {
        case 'polygon': case 'polyline':
            if (el.getAttribute('points')) {
                el.setAttribute('points', _scalePointsStr(el.getAttribute('points'), sx, sy));
            }
            break;
        case 'rect': case 'image': case 'foreignobject': case 'use':
            scaleAttr('x', sx); scaleAttr('y', sy);
            scaleAttr('width', sx); scaleAttr('height', sy);
            scaleAttr('rx', sx); scaleAttr('ry', sy);
            break;
        case 'line':
            scaleAttr('x1', sx); scaleAttr('y1', sy);
            scaleAttr('x2', sx); scaleAttr('y2', sy);
            break;
        case 'circle':
            scaleAttr('cx', sx); scaleAttr('cy', sy); scaleAttr('r', avg);
            break;
        case 'ellipse':
            scaleAttr('cx', sx); scaleAttr('cy', sy);
            scaleAttr('rx', sx); scaleAttr('ry', sy);
            break;
        case 'text': case 'tspan':
            scaleAttr('x', sx); scaleAttr('y', sy); scaleAttr('font-size', avg);
            break;
        case 'path':
            el.setAttribute('transform', `scale(${sx} ${sy})`);
            return;
    }

    // 線幅は縦横の平均倍率でスケール
    scaleAttr('stroke-width', avg);
    const style = el.getAttribute('style');
    if (style && style.includes('stroke-width')) {
        el.setAttribute('style', style.replace(/stroke-width\s*:\s*([\d.]+)/g,
            (_, v) => `stroke-width:${_round2(parseFloat(v) * avg)}`));
    }

    Array.from(el.children).forEach(child => _scaleSvgElementTree(child, sx, sy));
}

/**
 * コンテンツSVG（panelSvgContent / overlaySvgContent）を scale() でラップして作品サイズに変換する。
 * defs（clipPath等）はラップ対象要素のユーザー座標系（=旧座標系）で解決されるためそのまま残す。
 */
function _scaleSvgContentByWrap(svgText, sx, sy, targetW, targetH) {
    if (!svgText) return svgText || '';
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    if (!svgEl) return svgText;

    const g = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', `scale(${sx} ${sy})`);
    Array.from(svgEl.children).forEach(child => {
        if (child.tagName && child.tagName.toLowerCase() === 'defs') return;
        g.appendChild(child);
    });
    svgEl.appendChild(g);
    svgEl.setAttribute('viewBox', `0 0 ${targetW} ${targetH}`);
    svgEl.removeAttribute('width');
    svgEl.removeAttribute('height');
    return new XMLSerializer().serializeToString(svgEl);
}

