// ============================================================
// コマ変形・コマ削除機能（レイアウトタブ「変形」サブタブ + レイヤーパネルの削除ボタン）
//
// 【変形】選択中のコマ1つのポリゴンを破壊的に変形する。コマ間の幅・外側の幅は一切考慮せず
// （隣のコマと重なっても、ページ外にはみ出しても止めない）、選択コマだけを動かす。
//   - 頂点ドラッグ: 頂点を自由に移動
//   - 辺ドラッグ  : 選択辺を、辺の向きを保ったまま法線方向へ平行移動する
//                    （両端の頂点は隣の辺の延長線上をスライドする。矩形ならそのまま拡縮になる）
//   - 頂点削除    : 選択頂点を削除（四角形→三角形など。三角形は不可）
//
// 【外周ロック】レイアウト全体（サブコマを除く全コマ）の外周に乗っている頂点は、ロックONの間
// 外周ラインから動かせない（左右の外周上ならX固定、上下の外周上ならY固定、角はXY固定。
// 頂点の削除も不可）。内側の辺を動かしたときに外周ライン上を滑る動きだけが許される。
// 既存の「コマ一括ロック」（_isPanelLocked）中のコマも変形・削除できない。
//
// 【削除】コマ（サブコマ含む子孫ごと）を削除する。
//
// 変形後の形は panels[].points、背景SVG（svgContent）の枠線polygon（id=コマID）、
// コマ個別SVG（panelSvgContent）内のclipPath polygonの3か所へ反映する
// （分割機能 24a-panel-split.js と同じ保存先）。
//
// type="module" として読み込まれる。
// ============================================================

import { t } from '../i18n.js';
import { _parsePointsStr, _pointsToStr } from './05-groups-move.js';
import { _polygonArea, calcGroupHandleR } from './06a-polygon-geometry.js';
import { _isPanelLocked } from './03-layers-panel.js';
import { pushHistory, renderLayoutTab } from './07-pages.js';
import { dbPut, _enqueueActivePageSave } from './00-db.js';
import { state } from './01-state.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const OUTER_LOCK_KEY = 'ccc_deform_outer_lock';

const _deformState = {
    armed: false,
    outerLock: true,
    selVertex: null, // 選択中の頂点index
    selEdge: null,   // 選択中の辺index（頂点i→頂点i+1）
};

let _deformSvg = null;        // 現在のプレビューSVG（renderLayoutTabのたびに差し替わる）
let _deformWinMove = null;    // window登録のリスナー参照（再初期化で積み上がらないよう保持）
let _deformWinUp = null;
let _deformDrag = null;       // ドラッグ中の状態

// ── 幾何ヘルパー ──

function _lineLine(p, u, q, v) {
    // 点p・方向u（単位ベクトル）の直線と、点q・方向vの直線の交点（平行ならnull）
    const cross = u.x * v.y - u.y * v.x;
    if (Math.abs(cross) < 1e-6 * Math.hypot(v.x, v.y)) return null;
    const tt = ((q.x - p.x) * v.y - (q.y - p.y) * v.x) / cross;
    return { x: p.x + u.x * tt, y: p.y + u.y * tt };
}

// 辺i（pts[i]→pts[i+1]）を法線方向にdだけ平行移動した多角形を返す。
// 両端の頂点は、前後の辺の延長線との交点へ移る（前後の辺と平行で交点が無い場合は法線方向へ平行移動）
function _deformOffsetEdge(pts, i, d) {
    const n = pts.length;
    const a = pts[i], b = pts[(i + 1) % n];
    const ex = b.x - a.x, ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    const out = pts.map((p) => ({ x: p.x, y: p.y }));
    if (len < 1e-9) return out;
    const u = { x: ex / len, y: ey / len };
    const nx = -u.y, ny = u.x;
    const a2 = { x: a.x + nx * d, y: a.y + ny * d };
    const b2 = { x: b.x + nx * d, y: b.y + ny * d };
    const prev = pts[(i - 1 + n) % n], next = pts[(i + 2) % n];
    out[i] = _lineLine(a2, u, prev, { x: a.x - prev.x, y: a.y - prev.y }) || a2;
    out[(i + 1) % n] = _lineLine(b2, u, b, { x: next.x - b.x, y: next.y - b.y }) || b2;
    return out;
}

function _edgeNormal(pts, i) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
}

function _segProperIntersect(p1, p2, p3, p4) {
    const o = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const d1 = o(p3, p4, p1), d2 = o(p3, p4, p2), d3 = o(p1, p2, p3), d4 = o(p1, p2, p4);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// 自己交差（蝶ネクタイ形）がない単純多角形か
function _polygonSimple(pts) {
    const n = pts.length;
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            if (j === i + 1 || (i === 0 && j === n - 1)) continue; // 隣接辺
            if (_segProperIntersect(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return false;
        }
    }
    return true;
}

function _deformMinArea() {
    const vb = _deformSvg?.viewBox?.baseVal;
    const w = vb?.width || 21000, h = vb?.height || 29700;
    return Math.max(1, w * h * 0.0002);
}

function _deformValid(pts) {
    return pts.length >= 3 && _polygonArea(pts) >= _deformMinArea() && _polygonSimple(pts);
}

// ── 外周ロック ──

// レイアウト全体（サブコマを除く全コマ）の外接矩形。外周ラインの判定基準
function _deformOuterBounds() {
    const panels = (state.activePage?.panels || []).filter((p) => !p.parentPanelId && p.points);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    panels.forEach((p) => _parsePointsStr(p.points).forEach((pt) => {
        minX = Math.min(minX, pt.x); maxX = Math.max(maxX, pt.x);
        minY = Math.min(minY, pt.y); maxY = Math.max(maxY, pt.y);
    }));
    if (!Number.isFinite(minX)) return null;
    return { minX, minY, maxX, maxY, tol: Math.max(2, (maxX - minX) * 0.002) };
}

// 頂点が乗っている外周ライン（なければnull）
function _deformLockedSides(pt, b) {
    if (!b) return null;
    const s = {
        l: Math.abs(pt.x - b.minX) <= b.tol, r: Math.abs(pt.x - b.maxX) <= b.tol,
        t: Math.abs(pt.y - b.minY) <= b.tol, b: Math.abs(pt.y - b.maxY) <= b.tol,
    };
    return (s.l || s.r || s.t || s.b) ? s : null;
}

function _deformIsVertexLocked(pt, bounds) {
    return _deformState.outerLock && !!_deformLockedSides(pt, bounds);
}

// 外周ロックONなら、外周上の頂点を元の外周ラインから動かさない（ラインに沿った成分だけ許す）
function _deformConstrain(orig, next, bounds) {
    if (!_deformState.outerLock || !bounds) return next;
    return next.map((p, i) => {
        const s = _deformLockedSides(orig[i], bounds);
        if (!s) return p;
        return { x: (s.l || s.r) ? orig[i].x : p.x, y: (s.t || s.b) ? orig[i].y : p.y };
    });
}

// ── 対象コマ・UI ──

function _deformTargetPanel() {
    if (state.selectedOverlay || state.selectedDraft || !state.selectedPanelId) return null;
    const p = (state.activePage?.panels || []).find((pp) => pp.id === state.selectedPanelId);
    if (!p || p.parentPanelId || !p.points) return null;
    return _parsePointsStr(p.points).length >= 3 ? p : null;
}

function _deformSetStatus(text) {
    const el = document.getElementById('deform-status');
    if (el) el.textContent = text || '';
}

function _deformUpdateToggleUI() {
    const group = document.getElementById('deform-mode-group');
    if (!group) return;
    group.querySelectorAll('.seg-btn').forEach((b) =>
        b.classList.toggle('active', (b.dataset.deformMode === 'on') === _deformState.armed));
}

function _deformClearUi() {
    (_deformSvg || document).querySelectorAll('.deform-ui').forEach((el) => el.remove());
}

const _mk = (tag, attrs) => {
    const el = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
    el.classList.add('deform-ui');
    return el;
};

// 変形UI（輪郭・辺ヒット領域・頂点ハンドル）を描き直す。previewPtsを渡すとドラッグ中のプレビュー形状を描く
function _deformRender(previewPts = null, previewValid = true) {
    _deformClearUi();
    const svg = _deformSvg;
    if (!svg || !svg.isConnected || !_deformState.armed) return;
    const panel = _deformTargetPanel();
    if (!panel) return;

    const basePts = _parsePointsStr(panel.points);
    const pts = previewPts || basePts;
    const n = pts.length;
    const r = calcGroupHandleR(svg);
    const bounds = _deformOuterBounds();
    const locked = _isPanelLocked(panel.id);

    const outline = _mk('polygon', {
        points: pts.map((p) => `${p.x},${p.y}`).join(' '),
        fill: 'none', stroke: previewValid ? '#ff9500' : '#ff3b30',
        'stroke-width': r * 0.35, 'stroke-dasharray': `${r * 1.6},${r}`,
    });
    outline.style.pointerEvents = 'none';
    svg.appendChild(outline);

    for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        const sel = _deformState.selEdge === i;
        // 選択辺のハイライト（クリック対象外）
        if (sel) {
            const hl = _mk('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: '#ffdd00', 'stroke-width': r * 0.8, 'stroke-linecap': 'round' });
            hl.style.pointerEvents = 'none';
            svg.appendChild(hl);
        }
        // 辺のヒット領域（透明な太線）
        const hit = _mk('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: 'transparent', 'stroke-width': r * 2.6, 'stroke-linecap': 'butt' });
        hit.classList.add('deform-edge');
        hit.dataset.idx = String(i);
        hit.style.pointerEvents = locked ? 'none' : 'stroke';
        hit.style.cursor = 'move';
        svg.appendChild(hit);
    }

    for (let i = 0; i < n; i++) {
        const p = pts[i];
        const vLocked = !previewPts && _deformIsVertexLocked(p, bounds);
        const sel = _deformState.selVertex === i;
        const c = _mk('circle', {
            cx: p.x, cy: p.y, r: sel ? r * 1.25 : r,
            fill: locked ? '#bbb' : (vLocked ? '#999' : (sel ? '#ffdd00' : '#ff9500')),
            stroke: '#333', 'stroke-width': r * 0.25,
        });
        c.classList.add('deform-vertex');
        c.dataset.idx = String(i);
        c.style.pointerEvents = locked ? 'none' : 'auto';
        c.style.cursor = vLocked ? 'not-allowed' : 'crosshair';
        svg.appendChild(c);
    }
}

// ── 保存 ──

// コマ個別SVG内の clipPath polygon を新しい形へ差し替える（clipPathが無ければそのまま）
function _deformPatchPanelSvgContent(content, panelId, pointsStr) {
    if (!content) return content;
    const doc = new DOMParser().parseFromString(content, 'image/svg+xml');
    const poly = Array.from(doc.querySelectorAll('clipPath')).find((c) => c.getAttribute('id') === `panel-clip-${panelId}`)
        ?.querySelector('polygon');
    if (!poly) return content;
    poly.setAttribute('points', pointsStr);
    return new XMLSerializer().serializeToString(doc.documentElement);
}

function _deformPatchBgPolygon(svgContent, panelId, pointsStr) {
    const doc = new DOMParser().parseFromString(svgContent, 'image/svg+xml');
    const poly = Array.from(doc.querySelectorAll('polygon')).find((p) => p.getAttribute('id') === panelId);
    if (!poly) return svgContent;
    poly.setAttribute('points', pointsStr);
    return new XMLSerializer().serializeToString(doc.querySelector('svg'));
}

async function _deformCommit(panelId, newPts) {
    if (!state.activePage) return;
    pushHistory();
    const pointsStr = _pointsToStr(newPts);
    await _enqueueActivePageSave(async () => {
        const page = state.activePage;
        const panels = page.panels.map((p) => p.id === panelId
            ? { ...p, points: pointsStr, panelSvgContent: _deformPatchPanelSvgContent(p.panelSvgContent, panelId, pointsStr) }
            : p);
        const updated = { ...page, panels, svgContent: _deformPatchBgPolygon(page.svgContent, panelId, pointsStr) };
        await dbPut('pages', updated, { deferThumb: true });
        state.activePage = updated;
    });
    await renderLayoutTab();
}

// ── 頂点削除 ──

async function _deformDeleteVertex() {
    const panel = _deformTargetPanel();
    if (!panel) { _deformSetStatus(t('deform.errNoPanel')); return; }
    if (_isPanelLocked(panel.id)) { _deformSetStatus(t('deform.errLocked')); return; }
    const idx = _deformState.selVertex;
    if (idx === null) { _deformSetStatus(t('deform.errNoVertex')); return; }
    const pts = _parsePointsStr(panel.points);
    if (pts.length <= 3) { _deformSetStatus(t('deform.errTriangle')); return; }
    if (_deformIsVertexLocked(pts[idx], _deformOuterBounds())) { _deformSetStatus(t('deform.errOuterLocked')); return; }
    const next = pts.filter((_, i) => i !== idx);
    if (!_deformValid(next)) { _deformSetStatus(t('deform.errInvalid')); return; }
    _deformState.selVertex = null;
    _deformState.selEdge = null;
    await _deformCommit(panel.id, next);
    _deformSetStatus(t('deform.vertexDeleted'));
}

// ── コマ削除（レイヤーパネルの削除ボタン／変形サブタブのボタンから） ──

async function deletePanel(panelId) {
    if (!state.activePage) return;
    const panels = state.activePage.panels || [];
    const target = panels.find((p) => p.id === panelId);
    if (!target || target.parentPanelId) return;
    if (_isPanelLocked(panelId)) { alert(t('deform.errLockedDelete')); return; }
    if (!confirm(t('deform.confirmDeletePanel'))) return;

    // サブコマ（親子を辿った子孫すべて）も一緒に削除する
    const removeIds = new Set([panelId]);
    let grew = true;
    while (grew) {
        grew = false;
        panels.forEach((p) => {
            if (p.parentPanelId && removeIds.has(p.parentPanelId) && !removeIds.has(p.id)) { removeIds.add(p.id); grew = true; }
        });
    }

    pushHistory();
    await _enqueueActivePageSave(async () => {
        const page = state.activePage;
        const doc = new DOMParser().parseFromString(page.svgContent, 'image/svg+xml');
        Array.from(doc.querySelectorAll('polygon')).forEach((p) => {
            if (removeIds.has(p.getAttribute('id'))) p.remove();
        });
        const updated = {
            ...page,
            panels: page.panels.filter((p) => !removeIds.has(p.id)),
            svgContent: new XMLSerializer().serializeToString(doc.querySelector('svg')),
        };
        await dbPut('pages', updated, { deferThumb: true });
        state.activePage = updated;
    });

    if (removeIds.has(state.selectedPanelId)) state.selectedPanelId = null;
    _deformState.selVertex = null;
    _deformState.selEdge = null;
    await renderLayoutTab();
}

// ── ツール初期化 ──

function initDeformPanelTool() {
    document.querySelectorAll('#deform-mode-group .seg-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const armed = btn.dataset.deformMode === 'on';
            if (_deformState.armed === armed) return;
            _deformState.armed = armed;
            _deformState.selVertex = null;
            _deformState.selEdge = null;
            _deformUpdateToggleUI();
            _deformSetStatus(armed ? (_deformTargetPanel() ? t('deform.editing') : t('deform.selectPanel')) : '');
            _deformRender();
        });
    });

    // 他のサブタブへ切り替えたら変形モードをOFFに戻す（プレビュー上のUI・ドラッグを他ツールと干渉させない）
    document.querySelectorAll('.subtab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            if (btn.dataset.subtab === 'deform' || !_deformState.armed) return;
            _deformState.armed = false;
            _deformUpdateToggleUI();
            _deformSetStatus('');
            _deformRender();
        });
    });

    const lockInput = document.getElementById('deform-outer-lock');
    if (lockInput) {
        try {
            const saved = localStorage.getItem(OUTER_LOCK_KEY);
            if (saved !== null) lockInput.checked = saved === '1';
        } catch { /* ignore */ }
        _deformState.outerLock = lockInput.checked;
        lockInput.addEventListener('change', () => {
            _deformState.outerLock = lockInput.checked;
            try { localStorage.setItem(OUTER_LOCK_KEY, lockInput.checked ? '1' : '0'); } catch { /* ignore */ }
            _deformRender();
        });
    }

    document.getElementById('deform-delete-vertex')?.addEventListener('click', () => { _deformDeleteVertex(); });
    document.getElementById('deform-delete-panel')?.addEventListener('click', async () => {
        const panel = _deformTargetPanel();
        if (!panel) { _deformSetStatus(t('deform.errNoPanel')); return; }
        await deletePanel(panel.id);
    });

    // 選択頂点のDelete/Backspace削除（通常のオブジェクト削除ショートカットより先に処理する）
    document.addEventListener('keydown', (e) => {
        if (!_deformState.armed || _deformState.selVertex === null) return;
        if (e.key !== 'Delete' && e.key !== 'Backspace') return;
        if (!document.getElementById('layout-tab')?.classList.contains('active')) return;
        const tg = e.target;
        if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT' || tg.isContentEditable)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        _deformDeleteVertex();
    }, true);
}

// コマ選択が変わったときなどに、プレビュー上の変形UIを描き直す（selectPanelから呼ばれる）
function refreshDeformOverlay() {
    if (!_deformState.armed) return;
    _deformState.selVertex = null;
    _deformState.selEdge = null;
    _deformRender();
    _deformSetStatus(_deformTargetPanel() ? t('deform.editing') : t('deform.selectPanel'));
}

function initDeformPanelManipulation(svgEl) {
    if (_deformWinMove) { window.removeEventListener('mousemove', _deformWinMove); _deformWinMove = null; }
    if (_deformWinUp) { window.removeEventListener('mouseup', _deformWinUp); _deformWinUp = null; }
    _deformSvg = svgEl || null;
    _deformDrag = null;
    if (!svgEl) return;

    const getSvgPt = (clientX, clientY) => {
        const pt = svgEl.createSVGPoint();
        pt.x = clientX; pt.y = clientY;
        return pt.matrixTransform(svgEl.getScreenCTM().inverse());
    };

    // キャプチャフェーズ: 画像/フキダシ等の各操作ハンドラより先に処理して二重反応を防ぐ
    svgEl.addEventListener('mousedown', (e) => {
        if (!_deformState.armed) return;
        const hit = e.target.closest?.('.deform-vertex, .deform-edge');
        if (!hit) return;
        const panel = _deformTargetPanel();
        if (!panel) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (_isPanelLocked(panel.id)) { _deformSetStatus(t('deform.errLocked')); return; }

        const kind = hit.classList.contains('deform-vertex') ? 'vertex' : 'edge';
        const idx = parseInt(hit.dataset.idx, 10);
        _deformState.selVertex = kind === 'vertex' ? idx : null;
        _deformState.selEdge = kind === 'edge' ? idx : null;
        const orig = _parsePointsStr(panel.points);
        const start = getSvgPt(e.clientX, e.clientY);
        _deformDrag = { kind, idx, panelId: panel.id, start, orig, bounds: _deformOuterBounds(), moved: false, preview: null, valid: true };
        _deformSetStatus('');
        _deformRender();
    }, true);

    _deformWinMove = (e) => {
        const d = _deformDrag;
        if (!d) return;
        const pt = getSvgPt(e.clientX, e.clientY);
        const dx = pt.x - d.start.x, dy = pt.y - d.start.y;
        if (!d.moved && Math.hypot(dx, dy) < calcGroupHandleR(svgEl) * 0.5) return; // クリック程度の揺れは無視
        d.moved = true;

        let next;
        if (d.kind === 'vertex') {
            next = d.orig.map((p, i) => i === d.idx ? { x: p.x + dx, y: p.y + dy } : { x: p.x, y: p.y });
        } else {
            const nrm = _edgeNormal(d.orig, d.idx);
            next = _deformOffsetEdge(d.orig, d.idx, dx * nrm.x + dy * nrm.y);
        }
        next = _deformConstrain(d.orig, next, d.bounds);
        d.preview = next;
        d.valid = _deformValid(next);
        _deformRender(next, d.valid);
    };

    _deformWinUp = async () => {
        const d = _deformDrag;
        if (!d) return;
        _deformDrag = null;
        if (d.moved && d.preview && d.valid) {
            await _deformCommit(d.panelId, d.preview);
            _deformSetStatus(t('deform.done'));
        } else {
            if (d.moved) _deformSetStatus(t('deform.errInvalid'));
            _deformRender();
        }
    };
    window.addEventListener('mousemove', _deformWinMove);
    window.addEventListener('mouseup', _deformWinUp);

    _deformRender();
}

export { initDeformPanelTool, initDeformPanelManipulation, refreshDeformOverlay, deletePanel };
