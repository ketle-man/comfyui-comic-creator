// moss-layout-assets.js — MOSS-Image タブのレイアウト保存と、アセットペイン「L（レイアウト）」タブ
//
// ・保存先は IndexedDB の settings ストア（id = 'moss_layout:<時刻>'）。設定タブの一括バックアップにそのまま含まれる。
//   中身は moss.js の getMossLayoutSnapshot()（枠・キャンバスサイズ・書字方向・全体プロンプト）＋名前・保存日時
// ・アセットペイン（左サイドバー、全タブ共通）は MOSS タブでは「L」タブだけを表示し、折りたためるようにする。
//   開いている間は MOSS タブ右端の生成列（生成ボタン・シード・結果）を隠して、レイアウトエディタの幅を確保する（排他表示）。
//   開閉状態は localStorage（ccc_moss_asset_open、既定は閉）。他のタブではたたまない（従来どおり）

import { t } from './i18n.js';
import { dbGetAll, dbPut, dbDelete } from './main/00-db.js';
import { getMossLayoutSnapshot, applyMossLayoutSnapshot, mossLayoutHasItems } from './moss.js';

const ID_PREFIX = 'moss_layout:';
const OPEN_KEY = 'ccc_moss_asset_open';
const TYPE_COLORS = { object: '#4caf50', panel: '#ffc107', character: '#ff69b4', text: '#4fd8ff' };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let _selectedId = null;
let _inited = false;

// ─── 保存・読み込み ───
async function listLayouts() {
    const all = await dbGetAll('settings');
    return all.filter((r) => typeof r?.id === 'string' && r.id.startsWith(ID_PREFIX))
        .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
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
    await dbPut('settings', rec);
    _selectedId = rec.id;
    if (input) input.value = '';
    setStatus(t('mossLayout.saved', name), '#6c6');
    await renderMossLayoutAssets();
}

async function loadLayout(id) {
    const rec = (await listLayouts()).find((l) => l.id === id);
    if (!rec) return;
    if (await mossLayoutHasItems() && !confirm(t('mossLayout.confirmLoad', rec.name))) return;
    await applyMossLayoutSnapshot(rec);
    setStatus(t('mossLayout.loaded', rec.name), '#6c6');
}

async function deleteLayout(id) {
    const rec = (await listLayouts()).find((l) => l.id === id);
    if (!rec || !confirm(t('mossLayout.confirmDelete', rec.name))) return;
    await dbDelete('settings', id);
    if (_selectedId === id) _selectedId = null;
    await renderMossLayoutAssets();
}

// ─── 一覧 ───
// サムネイルは保存した枠から SVG で描く（画像は保存しない）。枠の色はエディタと同じ
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
    box.innerHTML = layouts.map((l) => `
        <div class="page-thumb-card moss-layout-card${l.id === _selectedId ? ' active' : ''}" data-id="${esc(l.id)}" title="${esc(t('mossLayout.cardTitle'))}">
          <div class="moss-layout-card-thumb">${thumbSvg(l)}</div>
          <div class="moss-layout-card-info">
            <span class="moss-layout-card-name">${esc(l.name)}</span>
            <button type="button" class="moss-layout-card-del" data-del="${esc(l.id)}" title="${esc(t('common.delete'))}">×</button>
          </div>
          <div class="moss-layout-card-meta">${esc(t('mossLayout.meta', (l.items || []).length, l.W, l.H))}</div>
        </div>`).join('');
}

function onListClick(e) {
    const del = e.target.closest('[data-del]');
    if (del) { e.stopPropagation(); deleteLayout(del.dataset.del); return; }
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

export { applyMossAssetPanel, renderMossLayoutAssets };
