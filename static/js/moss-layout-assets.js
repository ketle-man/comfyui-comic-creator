// moss-layout-assets.js — MOSS-Image タブのレイアウト保存・グループ管理と、その一覧 UI 2 か所
//   ① アセットペイン「L（レイアウト）」タブ（MOSS タブでのみ表示）: 保存・読み込み。グループごとに折りたたみ表示
//   ② ページタブ「レイアウト」サブタブ: テンプレートサブタブと同じ構成の一覧＋グループ管理（名前変更・削除・グループ割り当て）
//
// ・保存先は IndexedDB の settings ストア（id = 'moss_layout:<時刻>'）。設定タブの一括バックアップにそのまま含まれる。
//   中身は moss.js の getMossLayoutSnapshot()（枠・キャンバスサイズ・書字方向・全体プロンプト）＋名前・保存日時・group
// ・グループ一覧は同じ settings ストアの 'moss_layout_groups'（{ id, groups: [名前…] }）。所属はレイアウト側の group に持つ
//   （空グループも残せるよう一覧を別に持つ。表示するグループ名は「一覧 ∪ レイアウトが参照している名前」）
// ・アセットペイン（左サイドバー、全タブ共通）は MOSS タブでは「L」タブだけを表示し、折りたためるようにする。
//   開いている間は MOSS タブ右端の生成列（生成ボタン・シード・結果）を隠して、レイアウトエディタの幅を確保する（排他表示）。
//   開閉状態は localStorage（ccc_moss_asset_open、既定は閉）。他のタブではたたまない（従来どおり）

import { t } from './i18n.js';
import { dbGet, dbGetAll, dbPut, dbDelete } from './main/00-db.js';
import { getMossLayoutSnapshot, applyMossLayoutSnapshot, mossLayoutHasItems } from './moss.js';
import { switchTab } from './main/01-state.js';

const ID_PREFIX = 'moss_layout:';
const GROUPS_ID = 'moss_layout_groups';
const OPEN_KEY = 'ccc_moss_asset_open';
const TYPE_COLORS = { object: '#4caf50', panel: '#ffc107', character: '#ff69b4', text: '#4fd8ff' };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const byName = (a, b) => a.localeCompare(b);

let _selectedId = null;      // アセットペイン L で選択中
let _pmSelectedId = null;    // ページタブ「レイアウト」サブタブで選択中
const _expandedGroups = new Set();   // アセットペイン L で開いているグループ（既定は全部たたむ。アセット T と同じ）
let _inited = false;
let _pmInited = false;

// ─── 保存・読み込み ───
async function listLayouts() {
    const all = await dbGetAll('settings');
    return all.filter((r) => typeof r?.id === 'string' && r.id.startsWith(ID_PREFIX))
        .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

const groupOf = (rec) => (typeof rec?.group === 'string' && rec.group ? rec.group : null);

async function loadGroupList() {
    const rec = await dbGet('settings', GROUPS_ID);
    return Array.isArray(rec?.groups) ? rec.groups.filter((g) => typeof g === 'string' && g) : [];
}

async function saveGroupList(groups) {
    await dbPut('settings', { id: GROUPS_ID, groups: [...new Set(groups)].sort(byName) });
}

/** 表示するグループ名（保存済み一覧 ∪ レイアウトが参照している名前。バックアップ復元で片方だけ入っても見えるように） */
async function groupNames(layouts) {
    const set = new Set(await loadGroupList());
    (layouts || await listLayouts()).forEach((l) => { const g = groupOf(l); if (g) set.add(g); });
    return [...set].sort(byName);
}

function setStatus(text, color) {
    const el = $('moss-layout-asset-status');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = color || '';
}

async function onSave() {
    const input = $('moss-layout-asset-name');
    const layouts = await listLayouts();
    let name = (input?.value || '').trim();
    if (!name) name = t('mossLayout.defaultName', layouts.length + 1);
    const same = layouts.find((l) => l.name === name);
    if (same && !confirm(t('mossLayout.confirmOverwrite', name))) return;
    const snap = await getMossLayoutSnapshot();
    if (!snap.items.length) { setStatus(t('mossLayout.emptyEditor'), '#e0a040'); return; }
    const rec = { id: same ? same.id : `${ID_PREFIX}${Date.now()}`, name, savedAt: Date.now(), ...snap };
    if (groupOf(same)) rec.group = same.group;   // 上書き保存でもグループは引き継ぐ
    await dbPut('settings', rec);
    _selectedId = rec.id;
    if (rec.group) _expandedGroups.add(rec.group);   // 保存したカードが見えるようにグループを開く
    if (input) input.value = '';
    setStatus(t('mossLayout.saved', name), '#6c6');
    await refreshAll();
}

async function loadLayout(id) {
    const rec = (await listLayouts()).find((l) => l.id === id);
    if (!rec) return false;
    if (await mossLayoutHasItems() && !confirm(t('mossLayout.confirmLoad', rec.name))) return false;
    await applyMossLayoutSnapshot(rec);
    setStatus(t('mossLayout.loaded', rec.name), '#6c6');
    return true;
}

async function deleteLayout(id) {
    const rec = (await listLayouts()).find((l) => l.id === id);
    if (!rec || !confirm(t('mossLayout.confirmDelete', rec.name))) return;
    await dbDelete('settings', id);
    if (_selectedId === id) _selectedId = null;
    if (_pmSelectedId === id) _pmSelectedId = null;
    await refreshAll();
}

async function renameLayout(id) {
    const layouts = await listLayouts();
    const rec = layouts.find((l) => l.id === id);
    if (!rec) return;
    const name = prompt(t('mossLayout.renamePrompt'), rec.name)?.trim();
    if (!name || name === rec.name) return;
    if (layouts.some((l) => l.id !== id && l.name === name)) { alert(t('tmpl.alreadyExists', name)); return; }
    await dbPut('settings', { ...rec, name });
    await refreshAll();
}

async function setLayoutGroup(id, group) {
    const rec = (await listLayouts()).find((l) => l.id === id);
    if (!rec) return;
    const next = { ...rec };
    if (group) next.group = group; else delete next.group;
    await dbPut('settings', next);
    if (group) _expandedGroups.add(group);
    await refreshAll();
}

// ─── グループ管理 ───
async function createGroup(name) {
    const names = await groupNames();
    if (!name || names.includes(name)) return false;
    await saveGroupList([...names, name]);
    return true;
}

async function renameGroup(oldName, newName) {
    const layouts = await listLayouts();
    const names = await groupNames(layouts);
    if (!newName || !names.includes(oldName) || names.includes(newName)) return false;
    await saveGroupList(names.map((g) => (g === oldName ? newName : g)));
    for (const l of layouts) if (groupOf(l) === oldName) await dbPut('settings', { ...l, group: newName });
    if (_expandedGroups.delete(oldName)) _expandedGroups.add(newName);
    return true;
}

/** グループだけ消す（所属していたレイアウトは「グループなし」に戻す。レイアウト自体は消さない） */
async function deleteGroup(name) {
    const layouts = await listLayouts();
    const names = await groupNames(layouts);
    await saveGroupList(names.filter((g) => g !== name));
    for (const l of layouts) {
        if (groupOf(l) !== name) continue;
        const next = { ...l };
        delete next.group;
        await dbPut('settings', next);
    }
    _expandedGroups.delete(name);
}

// ─── サムネイル ───
// 保存した枠から SVG で描く（画像は保存しない）。枠の色はエディタと同じ
// 値はバックアップの復元で外から入ることもあるので、属性へは数値にしてから埋め込む
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
function thumbSvg(rec) {
    const W = num(rec.W, 1024) || 1024, H = num(rec.H, 1024) || 1024;
    const boxes = (Array.isArray(rec.items) ? rec.items : []).map((it) => {
        const c = TYPE_COLORS[it?.type] || TYPE_COLORS.object;
        return `<rect x="${num(it?.x)}" y="${num(it?.y)}" width="${Math.max(0, num(it?.w))}" height="${Math.max(0, num(it?.h))}" fill="${c}" fill-opacity="0.18" stroke="${c}" stroke-width="${Math.max(W, H) / 160}"/>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%; height:100%; display:block;"><rect width="${W}" height="${H}" fill="#1a1a1a"/>${boxes}</svg>`;
}

const metaText = (l) => t('mossLayout.meta', (l.items || []).length, num(l.W), num(l.H));

// ─── ① アセットペイン L ───
function assetCardHtml(l) {
    return `
        <div class="page-thumb-card moss-layout-card${l.id === _selectedId ? ' active' : ''}" data-id="${esc(l.id)}" title="${esc(t('mossLayout.cardTitle'))}">
          <div class="moss-layout-card-thumb">${thumbSvg(l)}</div>
          <div class="moss-layout-card-info">
            <span class="moss-layout-card-name">${esc(l.name)}</span>
            <button type="button" class="moss-layout-card-del" data-del="${esc(l.id)}" title="${esc(t('common.delete'))}">×</button>
          </div>
          <div class="moss-layout-card-meta">${esc(metaText(l))}</div>
        </div>`;
}

// グループに入っているレイアウトは折りたためるグループ見出しの下に、グループなしはその後ろにそのまま並べる
// （アセット T と同じ。空グループは出さない。グループを使っていなければ従来と同じ見た目）
async function renderMossLayoutAssets() {
    const box = $('moss-layout-asset-list');
    if (!box) return;
    const layouts = await listLayouts();
    if (!layouts.some((l) => l.id === _selectedId)) _selectedId = null;
    const loadBtn = $('moss-layout-asset-load-btn');
    if (loadBtn) loadBtn.disabled = !_selectedId;
    if (!layouts.length) {
        box.innerHTML = `<p class="empty-message">${esc(t('mossLayout.empty'))}</p>`;
        return;
    }
    const groups = await groupNames(layouts);
    let html = '';
    for (const g of groups) {
        const members = layouts.filter((l) => groupOf(l) === g).sort((a, b) => byName(a.name, b.name));
        if (!members.length) continue;
        const open = _expandedGroups.has(g);
        html += `
        <div class="asset-folder moss-layout-group${open ? '' : ' collapsed'}" data-group="${esc(g)}">
          <span class="asset-folder-icon">${open ? '▼' : '▶'}</span>
          <span class="asset-folder-name">${esc(g)}</span>
          <span class="asset-tmpl-group-count">${members.length}</span>
        </div>
        <div class="asset-tmpl-group-list${open ? '' : ' collapsed'}">${members.map(assetCardHtml).join('')}</div>`;
    }
    html += layouts.filter((l) => !groupOf(l)).map(assetCardHtml).join('');
    box.innerHTML = html;
}

function onListClick(e) {
    const del = e.target.closest('[data-del]');
    if (del) { e.stopPropagation(); deleteLayout(del.dataset.del); return; }
    const head = e.target.closest('.moss-layout-group');
    if (head) {
        const g = head.dataset.group;
        const open = !_expandedGroups.has(g);
        if (open) _expandedGroups.add(g); else _expandedGroups.delete(g);
        head.classList.toggle('collapsed', !open);
        head.querySelector('.asset-folder-icon').textContent = open ? '▼' : '▶';
        head.nextElementSibling?.classList.toggle('collapsed', !open);
        return;
    }
    const card = e.target.closest('.moss-layout-card');
    if (!card) return;
    _selectedId = card.dataset.id;
    document.querySelectorAll('#moss-layout-asset-list .moss-layout-card').forEach((c) => c.classList.toggle('active', c === card));
    const loadBtn = $('moss-layout-asset-load-btn');
    if (loadBtn) loadBtn.disabled = false;
}

function onListDblClick(e) {
    const card = e.target.closest('.moss-layout-card');
    if (card && !e.target.closest('[data-del]')) loadLayout(card.dataset.id);
}

// ─── ② ページタブ「レイアウト」サブタブ ───
async function renderMossLayoutManager() {
    initMossLayoutManager();
    const grid = $('mosslayout-list');
    if (!grid) return;
    const layouts = await listLayouts();
    const groups = await groupNames(layouts);
    if (!layouts.some((l) => l.id === _pmSelectedId)) _pmSelectedId = null;

    // グループのセレクト（フィルタ／サイドパネル）を同期
    [['mosslayout-group-filter', 'layout.fontCatAll'], ['mosslayout-group-select', 'page.groupSelectOption']].forEach(([id, key]) => {
        const sel = $(id);
        if (!sel) return;
        const prev = sel.value;
        sel.innerHTML = `<option value="">${esc(t(key))}</option>` + groups.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
        if (groups.includes(prev)) sel.value = prev;
    });

    const filter = $('mosslayout-group-filter')?.value || '';
    const shown = (filter ? layouts.filter((l) => groupOf(l) === filter) : layouts.slice()).sort((a, b) => byName(a.name, b.name));
    grid.innerHTML = shown.length
        ? shown.map((l) => `
            <div class="template-card moss-layout-pm-card${l.id === _pmSelectedId ? ' selected' : ''}" data-id="${esc(l.id)}" title="${esc(t('mossLayout.pmCardTitle'))}">
              <div class="moss-layout-pm-thumb">${thumbSvg(l)}</div>
              <h3 title="${esc(l.name)}">${esc(l.name)}</h3>
              <div class="moss-layout-pm-sub">${esc(metaText(l))}</div>
              ${groupOf(l) ? `<div class="moss-layout-pm-sub">${esc(l.group)}</div>` : ''}
            </div>`).join('')
        : `<p class="empty-message">${esc(t(layouts.length ? 'mossLayout.emptyGroup' : 'mossLayout.pmEmpty'))}</p>`;

    updateManagerSide(layouts.find((l) => l.id === _pmSelectedId) || null);
}

function updateManagerSide(rec) {
    ['mosslayout-open-btn', 'mosslayout-rename-btn', 'mosslayout-delete-btn', 'mosslayout-assign-group-btn'].forEach((id) => {
        const b = $(id);
        if (b) b.disabled = !rec;
    });
    const removeBtn = $('mosslayout-remove-group-btn');
    if (removeBtn) removeBtn.disabled = !groupOf(rec);
    const nameEl = $('mosslayout-prop-name');
    if (nameEl) nameEl.textContent = rec ? rec.name : t('layout.notSelected');
    const metaEl = $('mosslayout-prop-meta');
    if (metaEl) metaEl.textContent = rec ? metaText(rec) : '';
    const groupEl = $('mosslayout-prop-group');
    if (groupEl) groupEl.textContent = rec ? (groupOf(rec) ? t('tmpl.groupLabel', rec.group) : t('tmpl.groupNone')) : '';
}

/** 選択中のレイアウトを MOSS-Image タブで開く（エディタへ読み込んでからタブを切り替える） */
async function openInMoss(id) {
    if (!id) return;
    if (!(await loadLayout(id))) return;
    _selectedId = id;
    await switchTab('moss');
}

function initMossLayoutManager() {
    if (_pmInited) return;
    _pmInited = true;
    const run = (fn) => () => fn().catch((e) => { console.error('[mossLayout]', e); alert(e.message || String(e)); });
    const sel = () => $('mosslayout-group-select')?.value || '';

    $('mosslayout-list')?.addEventListener('click', (e) => {
        const card = e.target.closest('.moss-layout-pm-card');
        if (!card) return;
        _pmSelectedId = card.dataset.id;
        document.querySelectorAll('#mosslayout-list .moss-layout-pm-card').forEach((c) => c.classList.toggle('selected', c === card));
        listLayouts().then((ls) => updateManagerSide(ls.find((l) => l.id === _pmSelectedId) || null));
    });
    $('mosslayout-list')?.addEventListener('dblclick', (e) => {
        const card = e.target.closest('.moss-layout-pm-card');
        if (card) openInMoss(card.dataset.id);
    });
    $('mosslayout-group-filter')?.addEventListener('change', () => renderMossLayoutManager());
    $('mosslayout-open-btn')?.addEventListener('click', run(() => openInMoss(_pmSelectedId)));
    $('mosslayout-rename-btn')?.addEventListener('click', run(() => renameLayout(_pmSelectedId)));
    $('mosslayout-delete-btn')?.addEventListener('click', run(() => deleteLayout(_pmSelectedId)));

    $('mosslayout-group-add-btn')?.addEventListener('click', run(async () => {
        const input = $('mosslayout-group-name-input');
        const name = input?.value.trim();
        if (!name) return;
        if (!(await createGroup(name))) { alert(t('tmpl.alreadyExists', name)); return; }
        input.value = '';
        await renderMossLayoutManager();
        const s = $('mosslayout-group-select');
        if (s) s.value = name;
    }));
    $('mosslayout-group-name-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('mosslayout-group-add-btn')?.click(); });
    $('mosslayout-group-rename-btn')?.addEventListener('click', run(async () => {
        const oldName = sel();
        if (!oldName) { alert(t('tmpl.selectGroup')); return; }
        const newName = prompt(t('tmpl.newGroupNamePrompt'), oldName)?.trim();
        if (!newName || newName === oldName) return;
        if (!(await renameGroup(oldName, newName))) { alert(t('tmpl.alreadyExists', newName)); return; }
        const f = $('mosslayout-group-filter');
        const wasFiltered = f?.value === oldName;   // 絞り込み中のグループを改名したら、新しい名前で絞り込みを続ける
        await refreshAll();
        if (wasFiltered) { f.value = newName; await renderMossLayoutManager(); }
        const s = $('mosslayout-group-select');
        if (s) s.value = newName;
    }));
    $('mosslayout-group-delete-btn')?.addEventListener('click', run(async () => {
        const name = sel();
        if (!name) { alert(t('tmpl.selectGroup')); return; }
        if (!confirm(t('mossLayout.confirmDeleteGroup', name))) return;
        await deleteGroup(name);
        await refreshAll();
    }));
    $('mosslayout-assign-group-btn')?.addEventListener('click', run(async () => {
        const g = sel();
        if (!g) { alert(t('tmpl.selectGroup')); return; }
        if (_pmSelectedId) await setLayoutGroup(_pmSelectedId, g);
    }));
    $('mosslayout-remove-group-btn')?.addEventListener('click', run(async () => {
        if (_pmSelectedId) await setLayoutGroup(_pmSelectedId, null);
    }));
}

/** 両方の一覧を描き直す（片方で変更したらもう片方にもすぐ反映する。表示していない側は DOM を書き換えるだけ） */
async function refreshAll() {
    await renderMossLayoutAssets();
    if (_pmInited) await renderMossLayoutManager();
}

// ─── 折りたたみ（MOSS タブのときだけ） ───
function isOpen() {
    try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; }
}

function setOpen(open) {
    try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch { /* 保存できなくても動作は継続 */ }
    applyMossAssetPanel(true);
}

/**
 * タブ切り替えのたびに呼ぶ（01-state.js の switchTab）。onMoss: 今のタブが MOSS-Image か。
 * MOSS では開閉ボタンを出し、開閉状態に合わせてアセットペインと右端の生成列を切り替える。他のタブでは元に戻す
 */
function applyMossAssetPanel(onMoss) {
    initMossLayoutAssets();
    const panel = $('asset-panel');
    const btn = $('asset-collapse-btn');
    const mossTab = $('moss-tab');
    const open = onMoss && isOpen();
    panel?.classList.toggle('collapsed', onMoss && !open);
    mossTab?.classList.toggle('moss-assets-open', open);
    if (btn) {
        btn.style.display = onMoss ? '' : 'none';
        btn.textContent = open ? '◀' : '▶';
        const key = open ? 'mossLayout.collapseTitle' : 'mossLayout.expandTitle';
        btn.dataset.i18nTitle = key;
        btn.title = t(key);
    }
    if (open) renderMossLayoutAssets();
    // 幅が変わるのでレイアウトエディタのキャンバスを合わせ直す（moss.js は resize イベントで再描画する）
    if (onMoss) requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}

function initMossLayoutAssets() {
    if (_inited) return;
    _inited = true;
    $('moss-layout-asset-save-btn')?.addEventListener('click', () => onSave().catch((e) => setStatus(t('mossLayout.failed', e.message || String(e)), '#e66')));
    $('moss-layout-asset-name')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('moss-layout-asset-save-btn')?.click(); });
    $('moss-layout-asset-load-btn')?.addEventListener('click', () => { if (_selectedId) loadLayout(_selectedId); });
    $('moss-layout-asset-list')?.addEventListener('click', onListClick);
    $('moss-layout-asset-list')?.addEventListener('dblclick', onListDblClick);
    $('asset-collapse-btn')?.addEventListener('click', () => setOpen(!isOpen()));
}

export { applyMossAssetPanel, renderMossLayoutAssets, renderMossLayoutManager };
