// ============================================================
// サブコマ機能: レイアウトタブでコマの中に矩形/丸のコマをオブジェクトとして配置する
// 「コマ」は state.activePage.panels[] の1エントリ（id + points）という抽象で
// insertImage/getOrCreateClipGroup/savePanelSvg/buildMergedSvg/selectPanel/
// highlightOverlay/initPanelsOnSvgのクリック選択/パネルロック・マスク機能から
// 汎用的に扱われているため、サブコマも parentPanelId 付きの通常エントリとして
// 追加するだけでこれらを無改造のまま利用できる。
// type="module" として読み込まれる（ESモジュール化 G9）。
// 17c-layer-draw-handles.js のポリゴン用ジオメトリ関数・draw-shape用の回転対応
// リサイズ関数はimportして再利用する。
// 未ESM化の外部依存（非moduleのグローバル関数はwindowプロパティとして自動的に見えるため、
// 呼び出し箇所は書き換えていない）: state（01-state.js）
// ============================================================

import { t } from '../i18n.js';
import { _cloneWithNewIds } from './06a-polygon-geometry.js';
import { _polygonCenter, _round2 } from './05-groups-move.js';
import {
    _drawShapeApplyRotation, _drawShapeGetBounds, _drawShapeGetRotateHandlePos,
    _drawShapeGetRotatedHandlePositions, _drawShapeSetBounds, _polygonBakeRotation,
} from './17c-layer-draw-handles.js';
import { _getPanelGroupDom, _isObjectLocked, _isPanelLocked } from './03-layers-panel.js';
import { _updateH2ShapePath } from './09b-balloon-shapes.js';
import { applyImageTransform } from './09c-balloon-handles.js';
import { dbPut } from './00-db.js';
import { getPanelLayerSvg, renderLayerPanel } from './04b-layer-panel-render.js';
import { pushHistory, renderLayoutTab, savePanelSvg } from './07-pages.js';
import { selectPanel } from './08-panels-images.js';
import { state } from './01-state.js';

const _subPanelToolState = {
    armed: false,     // ドラッグで新規作成する準備ができているか
    shape: 'rect',    // 'rect' | 'ellipse'
};

// 「サブコマ操作」モード（サブコマ内クリックで中のオブジェクトより優先してサブコマ自体を
// 選択・移動する）はサブコマ単位のON/OFF。パネルロック（_isPanelLocked/togglePanelLock,
// 03-layers-panel.js）と同じく、g[data-clip-panel]自体のdata属性として持たせることで
// savePanelSvgでそのまま永続化される（別途state.activePage.panelsへの保存は不要）
function _isSubPanelFrameMode(panelId) {
    const g = _getPanelGroupDom(panelId);
    return !!g && g.getAttribute('data-subpanel-frame-mode') === '1';
}

async function toggleSubPanelFrameMode(panelId) {
    const g = _getPanelGroupDom(panelId);
    if (!g) return;
    if (g.getAttribute('data-subpanel-frame-mode') === '1') g.removeAttribute('data-subpanel-frame-mode');
    else g.setAttribute('data-subpanel-frame-mode', '1');
    const svgEl = getPanelLayerSvg();
    if (svgEl) await savePanelSvg(panelId, svgEl);
    renderLayerPanel();
}

const _SUBPANEL_ELLIPSE_SEGMENTS = 48;
const _SUBPANEL_MIN_SIZE = 20; // SVG座標系。これ未満のドラッグ/リサイズは無視

// ── 形状 → points 文字列 ──
function _subPanelRectPoints(x, y, w, h) {
    return `${x.toFixed(2)},${y.toFixed(2)} ${(x + w).toFixed(2)},${y.toFixed(2)} ` +
           `${(x + w).toFixed(2)},${(y + h).toFixed(2)} ${x.toFixed(2)},${(y + h).toFixed(2)}`;
}
function _subPanelEllipsePoints(x, y, w, h) {
    const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2;
    const pts = [];
    for (let i = 0; i < _SUBPANEL_ELLIPSE_SEGMENTS; i++) {
        const a = (i / _SUBPANEL_ELLIPSE_SEGMENTS) * Math.PI * 2;
        pts.push(`${(cx + rx * Math.cos(a)).toFixed(2)},${(cy + ry * Math.sin(a)).toFixed(2)}`);
    }
    return pts.join(' ');
}
function _subPanelPointsForShape(shape, x, y, w, h) {
    return shape === 'ellipse' ? _subPanelEllipsePoints(x, y, w, h) : _subPanelRectPoints(x, y, w, h);
}

// ── points文字列 <-> 座標配列、bboxクランプ用ヘルパー ──
function _subPanelParsePoints(str) {
    const nums = (str || '').trim().split(/[\s,]+/).map(parseFloat).filter(n => !isNaN(n));
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
    return pts;
}
function _subPanelPointsToStr(pts) {
    return pts.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
}
// 点がポリゴンの内側にあるか（レイキャスト法）
function _subPanelPointInPolygon(pt, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
        const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
            (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// pt（SVG座標）を含む最前面（配列で最後）のコマ/サブコマを返す。onlySub指定時はサブコマのみ対象
function _subPanelFindPanelAtPoint(pt, onlySub) {
    if (!state.activePage) return null;
    const panels = state.activePage.panels || [];
    for (let i = panels.length - 1; i >= 0; i--) {
        const p = panels[i];
        if (onlySub && !p.parentPanelId) continue;
        if (!p.points) continue;
        const pts = _subPanelParsePoints(p.points);
        if (pts.length >= 3 && _subPanelPointInPolygon(pt, pts)) return p;
    }
    return null;
}

function _subPanelPolygonSignedArea(pts) {
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
        const j = (i + 1) % pts.length;
        area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return area / 2;
}

function _subPanelLineIntersect(p1, p2, p3, p4) {
    const denom = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
    if (Math.abs(denom) < 1e-9) return p2;
    const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / denom;
    return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
}

// Sutherland-Hodgman法: subjectPtsをclipPts（凸多角形）で切り取った交差ポリゴンを返す
function _subPanelClipPolygon(subjectPts, clipPts) {
    if (subjectPts.length < 3 || clipPts.length < 3) return [];
    const clipCCW = _subPanelPolygonSignedArea(clipPts) >= 0;
    let output = subjectPts;
    for (let i = 0; i < clipPts.length && output.length; i++) {
        const a = clipPts[i], b = clipPts[(i + 1) % clipPts.length];
        const inside = (p) => {
            const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
            return clipCCW ? cross >= 0 : cross <= 0;
        };
        const input = output;
        output = [];
        for (let j = 0; j < input.length; j++) {
            const cur = input[j];
            const prev = input[(j - 1 + input.length) % input.length];
            const curIn = inside(cur), prevIn = inside(prev);
            if (curIn) {
                if (!prevIn) output.push(_subPanelLineIntersect(prev, cur, a, b));
                output.push(cur);
            } else if (prevIn) {
                output.push(_subPanelLineIntersect(prev, cur, a, b));
            }
        }
    }
    return output;
}

// サブコマの実際のクリップ形状（画像等を切り抜く範囲）を返す:
// サブコマ自身の形と親コマの形の「交差部分」。通常のオブジェクト同様、コマ内は自由に移動・
// リサイズでき、親コマの外にはみ出した部分だけ非表示（クロップ）になるようにするための計算。
// 交差が縮退した場合（完全に外側等）はフォールバックとして無変更のpointsを返す
function _subPanelEffectiveClipPoints(pointsStr, parentPanel) {
    if (!parentPanel || !parentPanel.points) return pointsStr;
    const subject = _subPanelParsePoints(pointsStr);
    const clip = _subPanelParsePoints(parentPanel.points);
    if (subject.length < 3 || clip.length < 3) return pointsStr;
    const result = _subPanelClipPolygon(subject, clip);
    if (result.length < 3) return pointsStr;
    return _subPanelPointsToStr(result);
}

// ── 新規サブコマの自己完結panelSvgContentを組み立てる ──
// clipPath(defs) + g[data-clip-panel] + 枠線polygon(最後の子＝最前面)。
// savePanelSvgはこのg[data-clip-panel]の中身をまるごと保存対象にするため、
// 枠線は「gの外」ではなく必ず「gの最後の子」として置く（外に置くと編集の度に消える）。
// clipPath自体は「サブコマの形」と「親コマの形」の交差ポリゴン（_subPanelEffectiveClipPoints）を
// 使うことで、通常のオブジェクトと同じく親コマの外にはみ出した部分は表示されない（クロップされる）
// ようにする。枠線・ハンドルは常にサブコマ自身の完全な形（points、はみ出し含む）で描く。
function _subPanelBuildContent(id, points, shape, viewBox, parentPanel) {
    const desiredW = (state.panelBorder && state.panelBorder.width > 0) ? state.panelBorder.width : 60;
    const strokeW = (desiredW * 2).toFixed(2); // 枠線ポリゴンはクリップ境界と同じ座標のため半分がクリップされる。狙った太さの2倍で描く
    const clipPoints = _subPanelEffectiveClipPoints(points, parentPanel);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">` +
        `<defs><clipPath id="panel-clip-${id}" clipPathUnits="userSpaceOnUse"><polygon points="${clipPoints}"/></clipPath></defs>` +
        `<g data-clip-panel="${id}" clip-path="url(#panel-clip-${id})">` +
        `<polygon class="subpanel-border" data-shape-kind="${shape}" data-angle="0" points="${points}" ` +
        // pointer-events:stroke にして線の上だけをドラッグ対象にする（fill全体だと、下に敷いた
        // 画像へのクリック/ドラッグを枠線が奪ってしまい画像が操作不能になるため）
        `fill="none" stroke="#000000" stroke-width="${strokeW}" style="pointer-events:stroke;"/>` +
        `</g></svg>`;
}

// ── 新規サブコマ作成 ──
async function createSubPanel(parentPanelId, shape, x, y, w, h) {
    if (!state.activePage || !parentPanelId) return null;
    const parentPanel = state.activePage.panels.find(p => p.id === parentPanelId);
    if (!parentPanel) return null;

    pushHistory();

    const id = 'subpanel_' + Date.now();
    const points = _subPanelPointsForShape(shape, x, y, w, h);
    const parser = new DOMParser();
    const baseDoc = parser.parseFromString(state.activePage.svgContent, 'image/svg+xml');
    const baseSvg = baseDoc.querySelector('svg');
    const viewBox = baseSvg ? (baseSvg.getAttribute('viewBox') || '0 0 21000 29700') : '0 0 21000 29700';

    const newPanel = {
        id,
        points,
        parentPanelId,
        shape,
        panelSvgContent: _subPanelBuildContent(id, points, shape, viewBox, parentPanel),
    };
    const updatedPanels = [...state.activePage.panels, newPanel];
    const updatedRecord = { ...state.activePage, panels: updatedPanels };
    await dbPut('pages', updatedRecord);
    state.activePage = updatedRecord;

    await renderLayoutTab();
    selectPanel(id);
    const svgEl = getPanelLayerSvg();
    if (svgEl) renderSubPanelHandles(newPanel, svgEl);
    return id;
}

// ── サブコマ削除 ──
async function deleteSubPanel(subId) {
    if (!state.activePage) return;
    const panel = state.activePage.panels.find(p => p.id === subId);
    if (!panel || !panel.parentPanelId) return;
    if (!confirm(t('subpanel.confirmDelete'))) return;

    pushHistory();
    const updatedPanels = state.activePage.panels.filter(p => p.id !== subId);
    const updatedRecord = { ...state.activePage, panels: updatedPanels };
    await dbPut('pages', updatedRecord);
    state.activePage = updatedRecord;

    if (state.selectedPanelId === subId) {
        state.selectedPanelId = null;
    }
    await renderLayoutTab();
    _subPanelSyncBorderWidthUI();
}

// ── サブコマ本体（枠線ポリゴン）要素の取得 ──
function _subPanelBorderEl(panelId, svgEl) {
    if (!svgEl || !panelId) return null;
    return svgEl.querySelector(`g[data-clip-panel="${CSS.escape(panelId)}"] > .subpanel-border`);
}

// ── ハンドル表示（17c-layer-draw-handles.js の draw-shape 用ロジックを流用） ──
function clearSubPanelHandles(svgEl) {
    const root = svgEl || document;
    root.querySelectorAll('.subpanel-handle, .subpanel-bbox, .subpanel-rotate-line').forEach(h => h.remove());
}

function renderSubPanelHandles(panel, svgEl) {
    clearSubPanelHandles(svgEl);
    if (!panel || !svgEl) return;
    const el = _subPanelBorderEl(panel.id, svgEl);
    if (!el) return;

    const b = _drawShapeGetBounds(el);
    const vb = svgEl.viewBox.baseVal;
    const rect = svgEl.getBoundingClientRect();
    const scale = rect.width ? vb.width / rect.width : 1;
    const r = Math.round(scale * 8);
    const sw = Math.round(scale * 1.5);
    const angle = parseFloat(el.dataset.angle || 0);

    // draw-bbox/draw-handle/draw-rotate-line のCSSをそのまま流用しつつ、
    // subpanel-* クラスで自分の要素だけを識別・削除できるようにする（二重クラス）
    const bbox = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bbox.setAttribute('x', b.x); bbox.setAttribute('y', b.y);
    bbox.setAttribute('width', b.w); bbox.setAttribute('height', b.h);
    bbox.setAttribute('class', 'draw-bbox subpanel-bbox');
    bbox.setAttribute('stroke-width', sw);
    bbox.style.pointerEvents = 'none';
    if (angle) bbox.setAttribute('transform', `rotate(${angle},${b.x + b.w / 2},${b.y + b.h / 2})`);
    svgEl.appendChild(bbox);

    const rotated = _drawShapeGetRotatedHandlePositions(b, angle);
    ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach(type => {
        const [hx, hy] = rotated[type];
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('cx', hx); c.setAttribute('cy', hy); c.setAttribute('r', r);
        c.setAttribute('stroke-width', Math.round(r * 0.25));
        c.setAttribute('class', `draw-handle subpanel-handle resize-handle resize-${type}`);
        c.setAttribute('data-handle-type', type);
        c.style.pointerEvents = 'auto';
        svgEl.appendChild(c);
    });

    const offset = scale * 24;
    const { rotTopX, rotTopY, rotHx, rotHy } = _drawShapeGetRotateHandlePos(b, angle, offset);
    const rLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    rLine.setAttribute('x1', rotTopX); rLine.setAttribute('y1', rotTopY);
    rLine.setAttribute('x2', rotHx);   rLine.setAttribute('y2', rotHy);
    rLine.setAttribute('class', 'draw-rotate-line subpanel-rotate-line');
    rLine.setAttribute('stroke-width', sw);
    rLine.style.pointerEvents = 'none';
    svgEl.appendChild(rLine);

    const rotC = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    rotC.setAttribute('cx', rotHx); rotC.setAttribute('cy', rotHy); rotC.setAttribute('r', r);
    rotC.setAttribute('stroke-width', Math.round(r * 0.25));
    rotC.setAttribute('class', 'draw-handle subpanel-handle rotate-handle');
    rotC.setAttribute('data-handle-type', 'rotate');
    rotC.style.pointerEvents = 'auto';
    svgEl.appendChild(rotC);
}

function updateSubPanelHandles(el, svgEl) {
    if (!el || !svgEl) return;
    const b = _drawShapeGetBounds(el);
    const angle = parseFloat(el.dataset.angle || 0);

    const bbox = svgEl.querySelector('.subpanel-bbox');
    if (bbox) {
        bbox.setAttribute('x', b.x); bbox.setAttribute('y', b.y);
        bbox.setAttribute('width', b.w); bbox.setAttribute('height', b.h);
        if (angle) bbox.setAttribute('transform', `rotate(${angle},${b.x + b.w / 2},${b.y + b.h / 2})`);
        else bbox.removeAttribute('transform');
    }
    const positions = _drawShapeGetRotatedHandlePositions(b, angle);
    const vb = svgEl.viewBox.baseVal;
    const sRect = svgEl.getBoundingClientRect();
    const sc = sRect.width ? vb.width / sRect.width : 1;
    const offset = sc * 24;
    const { rotTopX, rotTopY, rotHx, rotHy } = _drawShapeGetRotateHandlePos(b, angle, offset);
    positions['rotate'] = [rotHx, rotHy];

    svgEl.querySelectorAll('.subpanel-handle').forEach(h => {
        const pos = positions[h.dataset.handleType];
        if (pos) { h.setAttribute('cx', pos[0]); h.setAttribute('cy', pos[1]); }
    });
    const rLine = svgEl.querySelector('.subpanel-rotate-line');
    if (rLine) {
        rLine.setAttribute('x1', rotTopX); rLine.setAttribute('y1', rotTopY);
        rLine.setAttribute('x2', rotHx);   rLine.setAttribute('y2', rotHy);
    }
}

// 既存サブコマを選択（コマ選択＋自分のハンドル表示）
function _subPanelSelectExisting(panel, svgEl) {
    selectPanel(panel.id);
    renderSubPanelHandles(panel, svgEl);
}

// リサイズ/移動/回転の確定: 回転をpointsへ焼き込み、枠線・ハンドル・state.activePage.panelsは
// サブコマ自身の完全な形（親コマの外にはみ出していてもそのまま）で同期する。
// 画像等を切り抜くclipPathだけは親コマとの交差ポリゴンに更新し、はみ出した部分を非表示にする
// （通常のオブジェクトを親コマの外へ動かした時にクロップされるのと同じ見た目にするため）。
// 既存のsavePanelSvg（無改造）でg[data-clip-panel]の中身（枠線含む）を永続化する
async function _subPanelCommit(panel, borderEl, svgEl) {
    _polygonBakeRotation(borderEl);
    const points = borderEl.getAttribute('points');
    const parentPanel = _subPanelResolveParent(panel.parentPanelId);

    const clipPoly = svgEl.querySelector(`[id="panel-clip-${panel.id}"] polygon`);
    if (clipPoly) clipPoly.setAttribute('points', _subPanelEffectiveClipPoints(points, parentPanel));
    // 選択中コマの枠線ハイライト（highlightOverlayが参照する.panel-border）もここで同期しないと、
    // 次にこのサブコマを選択したとき、作成/前回編集時点の古い位置・形のまま表示され続けてしまう
    const highlightPoly = svgEl.querySelector(`.panel-border[data-panel-id="${panel.id}"]`);
    if (highlightPoly) highlightPoly.setAttribute('points', points);

    const updatedPanels = state.activePage.panels.map(p => p.id === panel.id ? { ...p, points } : p);
    state.activePage = { ...state.activePage, panels: updatedPanels };

    updateSubPanelHandles(borderEl, svgEl);
    await savePanelSvg(panel.id, svgEl);
}

// ── サブコマごとの枠線幅（他のサブコマ・実コマの枠線幅とは独立） ──
// 現在state.selectedPanelIdが指しているのがサブコマならそのpanelエントリを返す
function _subPanelCurrentSelected() {
    if (!state.activePage || !state.selectedPanelId) return null;
    const p = state.activePage.panels.find(x => x.id === state.selectedPanelId);
    return (p && p.parentPanelId) ? p : null;
}

// 選択状態が変わるたびに呼ぶ: サブコマ選択中は現在の枠線幅（stroke-widthの半分。
// 半分がクリップで消える前提で2倍描画しているため）を入力欄に反映、非選択時は無効化
function _subPanelSyncBorderWidthUI() {
    const input = document.getElementById('subpanel-border-width');
    if (!input) return;
    const panel = _subPanelCurrentSelected();
    if (!panel) {
        input.value = '';
        input.disabled = true;
        return;
    }
    const svgEl = getPanelLayerSvg();
    const el = svgEl ? _subPanelBorderEl(panel.id, svgEl) : null;
    const strokeW = el ? (parseFloat(el.getAttribute('stroke-width')) || 0) : 0;
    input.disabled = false;
    input.value = _round2(strokeW / 2);
}

// 枠線幅をライブ更新（DOMのみ、未保存）。戻り値はsave時に使うpanel/svgEl
function _subPanelSetBorderWidthLive(newWidth) {
    const panel = _subPanelCurrentSelected();
    if (!panel) return null;
    const svgEl = getPanelLayerSvg();
    if (!svgEl) return null;
    const el = _subPanelBorderEl(panel.id, svgEl);
    if (!el) return null;
    const w = Math.max(0, newWidth);
    el.setAttribute('stroke-width', (w * 2).toFixed(2));
    return { panel, svgEl };
}

// ── ツールペインUI（ON/OFF・形状選択） ──
function _subPanelUpdateToggleUI() {
    const group = document.getElementById('subpanel-mode-group');
    if (!group) return;
    group.querySelectorAll('.seg-btn').forEach(b =>
        b.classList.toggle('active', (b.dataset.subpanelMode === 'on') === _subPanelToolState.armed));
}

function initSubPanelTool() {
    document.querySelectorAll('#subpanel-mode-group .seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const armed = btn.dataset.subpanelMode === 'on';
            if (_subPanelToolState.armed === armed) return;
            _subPanelToolState.armed = armed;
            _subPanelUpdateToggleUI();
            const statusEl = document.getElementById('subpanel-status');
            if (statusEl) statusEl.textContent = armed ? t('subpanel.creating') : '';
        });
    });
    document.querySelectorAll('#subpanel-shape-group .seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            _subPanelToolState.shape = btn.dataset.subpanelShape === 'ellipse' ? 'ellipse' : 'rect';
            document.querySelectorAll('#subpanel-shape-group .seg-btn').forEach(b =>
                b.classList.toggle('active', b === btn));
        });
    });

    // 選択中サブコマの枠線幅（他のサブコマ・実コマとは独立して個別設定できる）
    const borderWidthInput = document.getElementById('subpanel-border-width');
    if (borderWidthInput) {
        borderWidthInput.addEventListener('input', (e) => {
            _subPanelSetBorderWidthLive(parseFloat(e.target.value) || 0);
        });
        const applyBorderWidth = async () => {
            const w = _round2(Math.max(0, parseFloat(borderWidthInput.value) || 0));
            borderWidthInput.value = w;
            const result = _subPanelSetBorderWidthLive(w);
            if (result) await savePanelSvg(result.panel.id, result.svgEl);
        };
        borderWidthInput.addEventListener('change', applyBorderWidth);
        borderWidthInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') applyBorderWidth();
        });
    }
}

// サブコマ移動時、枠だけでなく中のオブジェクト（画像・テキスト・フキダシ・ドロー図形・グループ）も
// 一緒に動かす。15-pixifx-bridge.js の moveSelectedObjectToCenter と同じ「種別ごとに本来の
// 位置属性（x/y、dataset.cx/cy、data-tx/ty等）へ直接焼き込む」方式を、絶対座標指定ではなく
// dx,dyの相対移動に置き換えて流用する。単純にtransformを重ねるだけだと、画像/テキスト等の
// ハンドル表示・移動処理がtransformを見ずx/y等の生属性だけを見て動いているため、
// 選択ハンドルが古い位置のまま出てしまう（実際に起きた不具合）。
// インタラクティブなドラッグ移動（initSubPanelManipulation）だけでなく、レイヤーパネル下部の
// 移動・複製ボタン（duplicateSubPanel/moveSubPanel）からも共通で使うため、トップレベル関数にしてある
function _subPanelSnapshotContent(panelId, svgElRef) {
    const g = svgElRef.querySelector(`g[data-clip-panel="${CSS.escape(panelId)}"]`);
    if (!g) return [];
    return Array.from(g.children)
        .filter(child => !child.classList.contains('subpanel-border'))
        .map(child => {
            if (child.hasAttribute('data-group-id')) {
                return {
                    el: child, kind: 'group',
                    tx0: parseFloat(child.getAttribute('data-tx') || 0),
                    ty0: parseFloat(child.getAttribute('data-ty') || 0),
                    angle: parseFloat(child.getAttribute('data-angle') || 0),
                    rawCx: parseFloat(child.dataset.rawCx || 0),
                    rawCy: parseFloat(child.dataset.rawCy || 0),
                };
            }
            if (child.classList.contains('draw-shape')) {
                return { el: child, kind: 'draw-shape', bounds0: _drawShapeGetBounds(child) };
            }
            if (child.tagName.toLowerCase() === 'image') {
                return {
                    el: child, kind: 'image',
                    x0: parseFloat(child.getAttribute('x') || 0),
                    y0: parseFloat(child.getAttribute('y') || 0),
                };
            }
            if (child.tagName.toLowerCase() === 'text') {
                return {
                    el: child, kind: 'text',
                    x0: parseFloat(child.getAttribute('x') || 0),
                    y0: parseFloat(child.getAttribute('y') || 0),
                    tspans0: Array.from(child.querySelectorAll('tspan')).map(ts => ({
                        el: ts,
                        x0: ts.hasAttribute('x') ? parseFloat(ts.getAttribute('x')) : null,
                        y0: ts.hasAttribute('y') ? parseFloat(ts.getAttribute('y')) : null,
                    })),
                    angle: parseFloat(child.dataset.angle || 0),
                };
            }
            if (child.classList.contains('balloon-shape')) {
                return {
                    el: child, kind: 'balloon-shape',
                    cx0: parseFloat(child.dataset.cx || 0),
                    cy0: parseFloat(child.dataset.cy || 0),
                };
            }
            return { el: child, kind: 'unknown' };
        });
}
function _subPanelApplyContentTranslate(snapshot, dx, dy) {
    if (!snapshot) return;
    snapshot.forEach((snap) => {
        const { el, kind } = snap;
        if (kind === 'group') {
            const tx = snap.tx0 + dx, ty = snap.ty0 + dy;
            el.setAttribute('data-tx', tx);
            el.setAttribute('data-ty', ty);
            el.setAttribute('transform', `translate(${tx},${ty}) rotate(${snap.angle},${snap.rawCx},${snap.rawCy})`);
        } else if (kind === 'draw-shape') {
            const b = snap.bounds0;
            _drawShapeSetBounds(el, b.x + dx, b.y + dy, b.w, b.h);
        } else if (kind === 'image') {
            el.setAttribute('x', snap.x0 + dx);
            el.setAttribute('y', snap.y0 + dy);
            applyImageTransform(el);
        } else if (kind === 'text') {
            el.setAttribute('x', snap.x0 + dx);
            el.setAttribute('y', snap.y0 + dy);
            snap.tspans0.forEach(ts => {
                if (ts.x0 !== null) ts.el.setAttribute('x', ts.x0 + dx);
                if (ts.y0 !== null) ts.el.setAttribute('y', ts.y0 + dy);
            });
            if (snap.angle) {
                const bb = el.getBBox();
                const bcx = bb.x + bb.width / 2, bcy = bb.y + bb.height / 2;
                el.dataset.bboxCx = bcx;
                el.dataset.bboxCy = bcy;
                el.setAttribute('transform', `rotate(${snap.angle},${bcx},${bcy})`);
            }
        } else if (kind === 'balloon-shape') {
            el.dataset.cx = snap.cx0 + dx;
            el.dataset.cy = snap.cy0 + dy;
            _updateH2ShapePath(el);
        }
        // kind === 'unknown' は種別不明のため位置を動かさない（何もしない）
    });
}

// points文字列全体をdx,dyだけ平行移動する
function _subPanelTranslatePointsStr(pointsStr, dx, dy) {
    const pts = _subPanelParsePoints(pointsStr).map(p => ({ x: p.x + dx, y: p.y + dy }));
    return _subPanelPointsToStr(pts);
}

// panelId（またはその祖先）を辿ってancestorIdに行き着くか（親コマ付け替え時の循環防止用）
function _subPanelIsDescendantOf(panelId, ancestorId) {
    if (!state.activePage) return false;
    let cur = state.activePage.panels.find(p => p.id === panelId);
    while (cur && cur.parentPanelId) {
        if (cur.parentPanelId === ancestorId) return true;
        cur = state.activePage.panels.find(p => p.id === cur.parentPanelId);
    }
    return false;
}

// 親コマID（実コマ/サブコマのpanels[]エントリに加え、'__overlay__'も対応）から、
// クリップ交差・中心計算に使う「points」を持つオブジェクトを解決する。
// オーバーレイはpanels[]の実エントリではないため、ページ全面を表すbasePanelPointsを
// 疑似的な親の形として扱う（通常のオブジェクトがオーバーレイへ移動する際に
// basePanelPointsの重心へ再配置されるのと同じ考え方）
function _subPanelResolveParent(parentPanelId) {
    if (!state.activePage || !parentPanelId) return null;
    if (parentPanelId === '__overlay__') {
        return state.activePage.basePanelPoints ? { points: state.activePage.basePanelPoints } : null;
    }
    return state.activePage.panels.find(p => p.id === parentPanelId) || null;
}

// ── サブコマの複製 ──
// targetParentId省略時（または現在の親と同じ場合）は同じ親コマ内にOFFSETずらして複製する。
// 別の親コマを指定した場合は、複製元の親コマ中心→複製先コマ中心への平行移動を適用し、
// クリップ（親コマとの交差ポリゴン）も複製先コマとの交差に更新する
async function duplicateSubPanel(subId, targetParentId) {
    if (!state.activePage) return;
    const subPanel = state.activePage.panels.find(p => p.id === subId);
    if (!subPanel || !subPanel.parentPanelId) return;

    const parentId = targetParentId || subPanel.parentPanelId;
    const targetParent = _subPanelResolveParent(parentId);
    if (!targetParent || parentId === subPanel.id || _subPanelIsDescendantOf(parentId, subPanel.id)) {
        alert(t('layer.duplicateTargetPanelNotFound'));
        return;
    }

    const panelSvg = getPanelLayerSvg();
    if (!panelSvg) return;
    const srcG = panelSvg.querySelector(`g[data-clip-panel="${CSS.escape(subId)}"]`);
    if (!srcG) return;

    pushHistory();

    const sameParent = parentId === subPanel.parentPanelId;
    let dx = 20, dy = 20; // 同じ親内複製は他オブジェクトの複製と同じOFFSET
    if (!sameParent) {
        const oldParent = _subPanelResolveParent(subPanel.parentPanelId);
        const oldCenter = _polygonCenter((oldParent && oldParent.points) || subPanel.points) || { x: 0, y: 0 };
        const newCenter = _polygonCenter(targetParent.points) || oldCenter;
        dx = newCenter.x - oldCenter.x;
        dy = newCenter.y - oldCenter.y;
    }

    const newId = 'subpanel_' + Date.now();
    const newPoints = _subPanelTranslatePointsStr(subPanel.points, dx, dy);

    // 枠線+中身をまるごとクローンしてIDを付け替え（グループ複製と同じ_cloneWithNewIdsを流用）
    const cloneG = _cloneWithNewIds(srcG);
    cloneG.setAttribute('data-clip-panel', newId);
    cloneG.setAttribute('clip-path', `url(#panel-clip-${newId})`);
    const cloneBorder = cloneG.querySelector('.subpanel-border');
    if (cloneBorder) cloneBorder.setAttribute('points', newPoints);

    const ns = 'http://www.w3.org/2000/svg';
    let defsEl = panelSvg.querySelector('defs');
    if (!defsEl) {
        defsEl = document.createElementNS(ns, 'defs');
        panelSvg.insertBefore(defsEl, panelSvg.firstChild);
    }
    const clipPath = document.createElementNS(ns, 'clipPath');
    clipPath.setAttribute('id', `panel-clip-${newId}`);
    clipPath.setAttribute('clipPathUnits', 'userSpaceOnUse');
    const clipPoly = document.createElementNS(ns, 'polygon');
    clipPoly.setAttribute('points', _subPanelEffectiveClipPoints(newPoints, targetParent));
    clipPath.appendChild(clipPoly);
    defsEl.appendChild(clipPath);

    panelSvg.appendChild(cloneG);
    const snapshot = _subPanelSnapshotContent(newId, panelSvg);
    _subPanelApplyContentTranslate(snapshot, dx, dy);

    const newPanel = { id: newId, points: newPoints, parentPanelId: parentId, shape: subPanel.shape, panelSvgContent: '' };
    state.activePage = { ...state.activePage, panels: [...state.activePage.panels, newPanel] };
    await savePanelSvg(newId, panelSvg); // panels[]へのdbPutも内部で行われる

    await renderLayoutTab();
    selectPanel(newId);
    const freshSvg = getPanelLayerSvg();
    const freshPanel = state.activePage.panels.find(p => p.id === newId);
    if (freshSvg && freshPanel) renderSubPanelHandles(freshPanel, freshSvg);
}

// ── サブコマの移動（親コマの付け替え） ──
// 同じidのまま、複製元の親コマ中心→複製先コマ中心へ再配置し、クリップ（親コマとの交差）を再計算する
async function moveSubPanel(subId, targetParentId) {
    if (!state.activePage) return;
    const subPanel = state.activePage.panels.find(p => p.id === subId);
    if (!subPanel || !subPanel.parentPanelId) return;

    if (!targetParentId || targetParentId === subPanel.parentPanelId) {
        alert(t('layer.selectMoveDestination'));
        return;
    }
    const targetParent = _subPanelResolveParent(targetParentId);
    if (!targetParent || targetParentId === subPanel.id || _subPanelIsDescendantOf(targetParentId, subPanel.id)) {
        alert(t('layer.moveTargetPanelNotFound'));
        return;
    }
    if (_isPanelLocked(subId)) return;

    const panelSvg = getPanelLayerSvg();
    if (!panelSvg) return;
    const g = panelSvg.querySelector(`g[data-clip-panel="${CSS.escape(subId)}"]`);
    const border = g ? g.querySelector('.subpanel-border') : null;
    if (!g || !border) return;

    pushHistory();

    const oldParent = _subPanelResolveParent(subPanel.parentPanelId);
    const oldCenter = _polygonCenter((oldParent && oldParent.points) || subPanel.points) || { x: 0, y: 0 };
    const newCenter = _polygonCenter(targetParent.points) || oldCenter;
    const dx = newCenter.x - oldCenter.x;
    const dy = newCenter.y - oldCenter.y;

    const newPoints = _subPanelTranslatePointsStr(subPanel.points, dx, dy);
    border.setAttribute('points', newPoints);

    const clipPoly = panelSvg.querySelector(`[id="panel-clip-${subId}"] polygon`);
    if (clipPoly) clipPoly.setAttribute('points', _subPanelEffectiveClipPoints(newPoints, targetParent));

    const highlightPoly = panelSvg.querySelector(`.panel-border[data-panel-id="${subId}"]`);
    if (highlightPoly) highlightPoly.setAttribute('points', newPoints);

    const snapshot = _subPanelSnapshotContent(subId, panelSvg);
    _subPanelApplyContentTranslate(snapshot, dx, dy);

    const updatedPanels = state.activePage.panels.map(p =>
        p.id === subId ? { ...p, points: newPoints, parentPanelId: targetParentId } : p);
    state.activePage = { ...state.activePage, panels: updatedPanels };
    await savePanelSvg(subId, panelSvg); // panels[]へのdbPutも内部で行われる

    await renderLayoutTab();
    selectPanel(subId);
    const freshSvg = getPanelLayerSvg();
    const freshPanel = state.activePage.panels.find(p => p.id === subId);
    if (freshSvg && freshPanel) renderSubPanelHandles(freshPanel, freshSvg);
}

// ── 作成ドラッグ・移動・リサイズ・回転の統合操作 ──
let _subPanelManipWinMouseUp = null;

function initSubPanelManipulation(svgEl) {
    if (_subPanelManipWinMouseUp) { window.removeEventListener('mouseup', _subPanelManipWinMouseUp); _subPanelManipWinMouseUp = null; }

    let mode = null; // 'create' | 'move' | 'resize' | 'rotate'
    let resizeDir = null;
    let startSvgX = 0, startSvgY = 0;
    let initBounds = null;
    let initAngle = 0, startAngleRad = 0;
    let creatingEl = null;
    let activePanel = null;
    let moveContentSnapshot = null; // 'move'中: 中身のオブジェクトも枠と一緒に平行移動するための元座標記録

    const getSvgPt = (clientX, clientY) => {
        const pt = svgEl.createSVGPoint();
        pt.x = clientX; pt.y = clientY;
        return pt.matrixTransform(svgEl.getScreenCTM().inverse());
    };

    // キャプチャフェーズで登録: 画像/テキスト/フキダシ/ドロー図形/グループの各操作ハンドラも
    // 同じsvgElにmousedownリスナーを持つが、それらはバブルフェーズ登録のため、キャプチャフェーズの
    // このリスナーが先に発火する。ここでstopPropagationした場合はそれらに到達しないため、
    // 「サブコマ作成ドラッグ中に下の画像も一緒にドラッグされてしまう」ような二重反応を防げる
    svgEl.addEventListener('mousedown', (e) => {
        // ── 選択中サブコマのハンドル操作（リサイズ・回転） ──
        const rotH = e.target.closest('.subpanel-handle.rotate-handle');
        const resizeH = e.target.closest('.subpanel-handle.resize-handle');
        if ((rotH || resizeH) && state.selectedPanelId) {
            const panel = state.activePage.panels.find(p => p.id === state.selectedPanelId);
            const el = _subPanelBorderEl(state.selectedPanelId, svgEl);
            if (!panel || !el || _isObjectLocked(el)) return;
            if (rotH) {
                const pt = getSvgPt(e.clientX, e.clientY);
                const b = _drawShapeGetBounds(el);
                initAngle = parseFloat(el.dataset.angle || 0);
                startAngleRad = Math.atan2(pt.y - (b.y + b.h / 2), pt.x - (b.x + b.w / 2));
                mode = 'rotate';
                activePanel = panel;
            } else {
                const pt = getSvgPt(e.clientX, e.clientY);
                resizeDir = resizeH.dataset.handleType;
                initBounds = { ..._drawShapeGetBounds(el) };
                initAngle = parseFloat(el.dataset.angle || 0);
                startSvgX = pt.x; startSvgY = pt.y;
                mode = 'resize';
                activePanel = panel;
            }
            e.preventDefault(); e.stopPropagation();
            return;
        }

        // ── 「サブコマ操作」チェック（レイヤーパネルでサブコマごとにON/OFF）がONのサブコマの
        // 内側をクリックした場合、そのサブコマ内のどこをクリックしても中のオブジェクトより
        // 優先してサブコマ自体を選択・移動する（グループの「全体を掴む」操作の切り替え版）。
        // OFF（既定）のサブコマでは通常通り中の画像・テキスト等を個別に操作できる ──
        let movePanel = null;
        {
            const pt0 = getSvgPt(e.clientX, e.clientY);
            const candidate = _subPanelFindPanelAtPoint(pt0, true);
            if (candidate && _isSubPanelFrameMode(candidate.id)) movePanel = candidate;
        }

        // ── サブコマ本体クリック: 枠線の上、または（画像等で覆われていない）背景のpanel-overlay
        // をクリックした場合に、未選択なら選択し、ドラッグで移動する ──
        if (!movePanel) {
            const border = e.target.closest('.subpanel-border');
            const overlay = e.target.closest('.panel-overlay');
            if (border) {
                const ownerG = border.closest('g[data-clip-panel]');
                const panelId = ownerG && ownerG.getAttribute('data-clip-panel');
                movePanel = panelId ? state.activePage.panels.find(p => p.id === panelId) : null;
            } else if (overlay) {
                const panelId = overlay.getAttribute('data-panel-id');
                const candidate = panelId ? state.activePage.panels.find(p => p.id === panelId) : null;
                if (candidate && candidate.parentPanelId) movePanel = candidate; // サブコマのoverlayのみ対象（通常コマは選択のみ）
            }
        }
        if (movePanel) {
            // .panel-overlay は g[data-clip-panel] の兄弟要素（中に無い）なので、
            // _isObjectLocked(el)のclosest('g[data-clip-panel]')判定では検出できない。
            // パネルIDから直接ロック状態を見る _isPanelLocked を使う
            if (_isPanelLocked(movePanel.id)) return;
            if (state.selectedPanelId !== movePanel.id) {
                _subPanelSelectExisting(movePanel, svgEl);
            }
            const el = _subPanelBorderEl(movePanel.id, svgEl);
            if (!el) return;
            const pt = getSvgPt(e.clientX, e.clientY);
            initBounds = { ..._drawShapeGetBounds(el) };
            startSvgX = pt.x; startSvgY = pt.y;
            mode = 'move';
            activePanel = movePanel;
            moveContentSnapshot = _subPanelSnapshotContent(movePanel.id, svgEl);
            e.preventDefault(); e.stopPropagation();
            return;
        }

        // ── 新規サブコマ作成ドラッグ ──
        // 親コマは「実際にドラッグを始めた座標」から自動判定する（あらかじめプルダウン等で
        // 選択していたコマとは無関係。選択中コマを使うと、選択が切り替わっていた場合に
        // 見た目と違うコマの子として作成されてしまうため）。
        // コマ内の画像等の上からドラッグを開始することも多いため、ここでイベントを掴んだら
        // 必ずstopPropagationする（このリスナーはキャプチャフェーズ登録＝画像/テキスト等の
        // 他の操作ハンドラより先に発火するため、それらに奪われず・奪わずに済む。
        // 06a-polygon-geometry.jsのinitGroupManipulationと同じ「キャプチャフェーズで先取り」方式）
        if (_subPanelToolState.armed) {
            if (state.selectedOverlay || state.selectedDraft) return;
            const pt = getSvgPt(e.clientX, e.clientY);
            const parentPanel = _subPanelFindPanelAtPoint(pt, false);
            if (!parentPanel) return;
            startSvgX = pt.x; startSvgY = pt.y;
            mode = 'create';
            activePanel = parentPanel; // mouseupで作成先コマIDとして使う
            const ns = 'http://www.w3.org/2000/svg';
            creatingEl = document.createElementNS(ns, _subPanelToolState.shape === 'ellipse' ? 'ellipse' : 'rect');
            creatingEl.setAttribute('class', 'subpanel-create-preview');
            creatingEl.setAttribute('fill', 'rgba(255,102,0,0.15)');
            creatingEl.setAttribute('stroke', '#ff6600');
            creatingEl.setAttribute('stroke-width', '20');
            creatingEl.style.pointerEvents = 'none';
            svgEl.appendChild(creatingEl);
            e.preventDefault(); e.stopPropagation();
        }
    }, true);

    svgEl.addEventListener('mousemove', (e) => {
        if (!mode) return;
        const pt = getSvgPt(e.clientX, e.clientY);

        if (mode === 'create') {
            const x1 = Math.min(startSvgX, pt.x), y1 = Math.min(startSvgY, pt.y);
            const x2 = Math.max(startSvgX, pt.x), y2 = Math.max(startSvgY, pt.y);
            if (_subPanelToolState.shape === 'ellipse') {
                creatingEl.setAttribute('cx', ((x1 + x2) / 2).toFixed(2));
                creatingEl.setAttribute('cy', ((y1 + y2) / 2).toFixed(2));
                creatingEl.setAttribute('rx', ((x2 - x1) / 2).toFixed(2));
                creatingEl.setAttribute('ry', ((y2 - y1) / 2).toFixed(2));
            } else {
                creatingEl.setAttribute('x', x1.toFixed(2));
                creatingEl.setAttribute('y', y1.toFixed(2));
                creatingEl.setAttribute('width', (x2 - x1).toFixed(2));
                creatingEl.setAttribute('height', (y2 - y1).toFixed(2));
            }
            return;
        }

        const el = activePanel ? _subPanelBorderEl(activePanel.id, svgEl) : null;
        if (!el) return;
        const dx = pt.x - startSvgX, dy = pt.y - startSvgY;

        if (mode === 'rotate') {
            const b = _drawShapeGetBounds(el);
            const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
            const curRad = Math.atan2(pt.y - cy, pt.x - cx);
            const deltaRad = curRad - startAngleRad;
            const newAngle = initAngle + deltaRad * 180 / Math.PI;
            _drawShapeApplyRotation(el, newAngle);
            updateSubPanelHandles(el, svgEl);
        } else if (mode === 'resize') {
            const b = initBounds;
            const dir = resizeDir;
            const rad = initAngle * Math.PI / 180;
            const cosR = Math.cos(rad), sinR = Math.sin(rad);
            const ldx = dx * cosR + dy * sinR;
            const ldy = -dx * sinR + dy * cosR;

            let nx = b.x, ny = b.y, nw = b.w, nh = b.h;
            if (dir.includes('e')) nw = Math.max(_SUBPANEL_MIN_SIZE, b.w + ldx);
            if (dir.includes('s')) nh = Math.max(_SUBPANEL_MIN_SIZE, b.h + ldy);
            if (dir.includes('w')) { nx = b.x + ldx; nw = Math.max(_SUBPANEL_MIN_SIZE, b.w - ldx); }
            if (dir.includes('n')) { ny = b.y + ldy; nh = Math.max(_SUBPANEL_MIN_SIZE, b.h - ldy); }

            if (initAngle) {
                const oldCx = b.x + b.w / 2, oldCy = b.y + b.h / 2;
                const newCxLocal = nx + nw / 2, newCyLocal = ny + nh / 2;
                const dcxLocal = newCxLocal - oldCx, dcyLocal = newCyLocal - oldCy;
                const dcxGlobal = dcxLocal * cosR - dcyLocal * sinR;
                const dcyGlobal = dcxLocal * sinR + dcyLocal * cosR;
                nx = oldCx + dcxGlobal - nw / 2;
                ny = oldCy + dcyGlobal - nh / 2;
            }
            _drawShapeSetBounds(el, nx, ny, nw, nh);
            updateSubPanelHandles(el, svgEl);
        } else if (mode === 'move') {
            const b = initBounds;
            _drawShapeSetBounds(el, b.x + dx, b.y + dy, b.w, b.h);
            _subPanelApplyContentTranslate(moveContentSnapshot, dx, dy);
            updateSubPanelHandles(el, svgEl);
        }
    });

    const onMouseUp = async () => {
        if (!mode) return;
        const finishedMode = mode;
        mode = null;

        if (finishedMode === 'create') {
            const el = creatingEl;
            creatingEl = null;
            if (el && el.parentNode) el.parentNode.removeChild(el);
            if (!el) return;
            let x, y, w, h;
            if (el.tagName.toLowerCase() === 'ellipse') {
                const cx = parseFloat(el.getAttribute('cx')) || 0, cy = parseFloat(el.getAttribute('cy')) || 0;
                const rx = parseFloat(el.getAttribute('rx')) || 0, ry = parseFloat(el.getAttribute('ry')) || 0;
                x = cx - rx; y = cy - ry; w = rx * 2; h = ry * 2;
            } else {
                x = parseFloat(el.getAttribute('x')) || 0; y = parseFloat(el.getAttribute('y')) || 0;
                w = parseFloat(el.getAttribute('width')) || 0; h = parseFloat(el.getAttribute('height')) || 0;
            }
            const parentPanelId = activePanel && activePanel.id;
            activePanel = null;
            if (!(w >= _SUBPANEL_MIN_SIZE && h >= _SUBPANEL_MIN_SIZE) || !parentPanelId) return;
            const shape = el.tagName.toLowerCase() === 'ellipse' ? 'ellipse' : 'rect';
            _subPanelToolState.armed = false;
            _subPanelUpdateToggleUI();
            const statusEl = document.getElementById('subpanel-status');
            if (statusEl) statusEl.textContent = '';
            await createSubPanel(parentPanelId, shape, x, y, w, h);
            return;
        }

        if (activePanel) {
            const el = _subPanelBorderEl(activePanel.id, svgEl);
            if (el) await _subPanelCommit(activePanel, el, svgEl);
        }
        activePanel = null;
        moveContentSnapshot = null;
    };
    svgEl.addEventListener('mouseup', onMouseUp);
    _subPanelManipWinMouseUp = onMouseUp;
    window.addEventListener('mouseup', _subPanelManipWinMouseUp);

    // 現在選択中のパネルがサブコマなら、再描画後もハンドルを表示し続ける
    if (state.selectedPanelId) {
        const selPanel = state.activePage?.panels.find(p => p.id === state.selectedPanelId);
        if (selPanel && selPanel.parentPanelId) renderSubPanelHandles(selPanel, svgEl);
    }
}

export {
    _isSubPanelFrameMode, toggleSubPanelFrameMode, deleteSubPanel, renderSubPanelHandles,
    _subPanelCurrentSelected, _subPanelSyncBorderWidthUI, initSubPanelTool,
    duplicateSubPanel, moveSubPanel, initSubPanelManipulation,
};

// まだESM化されていない main/以下の classic <script> や、既存ESMファイルの一部が
// window経由で呼んでいるためのブリッジ（ESモジュール化移行中の一時措置。
// 全分割ファイルのESM化が完了したら、各呼び出し元をimport文に置き換えてこのブロックごと削除する）。
window.initSubPanelTool = initSubPanelTool;
