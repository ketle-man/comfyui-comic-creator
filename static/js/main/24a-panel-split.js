// ============================================================
// コマ分割機能: レイアウトタブで、プレビュー上をドラッグした直線に沿って
// その線を含むコマ1つだけを2つに分割する。
//
// 分割の幾何計算はテンプレート作成ウィザード（06c-template-wizard.js）の
// 「単一コマ分割」と同じ _splitPolygonByLine（06a-polygon-geometry.js）を流用する。
// ただしテンプレートウィザード側は中身を持たない座標だけのデータを扱うのに対し、
// こちらは既に画像・フキダシ・テキスト等のコンテンツを持つ実コマを分割するため、
// 分割後のコンテンツの振り分け（新旧どちらのコマに残すか）を追加で行う。
//
// 振り分け方針: 各要素のbounding box 4隅が「新コマ側のポリゴンに完全に収まる」
// 場合のみ新コマへ移動する。分割線をまたぐ要素・旧コマ側に収まる要素は、
// 番号が変わらない旧コマ側にそのまま残す。
//
// 旧コマは配列中の位置・idを変えず points だけ縮小し、新コマは旧コマの直後に
// 挿入する（＝新コマの番号は常に「旧コマ番号+1」になり、以降の番号が1つずつ
// 繰り下がる）。
//
// 「コマ間の幅」入力（#split-gap-width）で指定した幅だけ分割線の両側を空けて
// 分割できる（_splitPolygonByLineのgap引数、テンプレート作成ウィザードのフレーム幅と
// 同じ仕組み）。0を指定すれば隙間なく分割する。分割ツールをONにした時点／「分割」
// サブタブを開いた時点で、既存コマ同士の隙間から自動検出した値を初期値として補完する
// （検出できない場合は最後に使った値をlocalStorageから引き継ぐ）。
//
// コマの見た目の枠線は、コンテンツ層ではなく背景SVG（svgContent）に静的に描かれた
// polygon（id=コマID）が担っているため、分割時にこのpolygonも同じ形へ複製・分割する
// （これをしないと分割した2コマの間に枠線が引かれないまま残る）。
//
// type="module" として読み込まれる。
// ============================================================

import { t } from '../i18n.js';
import { _parsePointsStr, _pointsToStr } from './05-groups-move.js';
import { _pointInPolygon, _splitPolygonByLine } from './06a-polygon-geometry.js';
import { _isPanelLocked } from './03-layers-panel.js';
import { getPanelLayerSvg } from './04b-layer-panel-render.js';
import { pushHistory, renderLayoutTab, savePanelSvg } from './07-pages.js';
import { selectPanel } from './08-panels-images.js';
import { dbPut } from './00-db.js';
import { state } from './01-state.js';

const _splitToolState = { armed: false };

// window.mouseupリスナーはrenderLayoutTabのたびにinitSplitPanelManipulationが
// 再呼び出しされるため、前回分を確実に外してから登録し直す（多重登録防止）
let _splitManipWinMouseUp = null;

// コマ間の幅（分割後の2コマの間に空ける幅）は、ページ・作品を跨いで最後に使った値を
// 覚えておくと毎回入力し直さずに済むため、localStorageに保存する
const SPLIT_GAP_WIDTH_KEY = 'ccc_split_gap_width';

function _splitGetGapWidth() {
    const input = document.getElementById('split-gap-width');
    const w = input ? parseFloat(input.value) : 0;
    return Number.isFinite(w) && w >= 0 ? w : 0;
}

// 現在のページの既存コマ同士から「コマ間の幅」を自動検出する。
// 矩形コマ（多くのテンプレート・分割で作られるコマはすべて矩形）を対象に、
// 上下または左右に隣接する2コマの軸方向の隙間を集め、その中央値を返す
// （外れ値になりやすい単発のはみ出しコマ等の影響を受けにくくするため）。
// 隣接ペアが見つからない場合（コマが1つしかない等）はnullを返す
function _splitAutoDetectGap() {
    const panels = (state.activePage?.panels || []).filter(p => !p.parentPanelId && p.points);
    const rects = panels.map((p) => {
        const pts = _parsePointsStr(p.points);
        if (pts.length < 3) return null;
        const xs = pts.map((pt) => pt.x), ys = pts.map((pt) => pt.y);
        return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    }).filter(Boolean);

    const gaps = [];
    for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
            const r1 = rects[i], r2 = rects[j];
            // 左右に隣接（y範囲が重なり、x方向に隙間がある）
            const yOverlap = Math.min(r1.maxY, r2.maxY) - Math.max(r1.minY, r2.minY);
            if (yOverlap > 0) {
                if (r2.minX >= r1.maxX) gaps.push(r2.minX - r1.maxX);
                else if (r1.minX >= r2.maxX) gaps.push(r1.minX - r2.maxX);
            }
            // 上下に隣接（x範囲が重なり、y方向に隙間がある）
            const xOverlap = Math.min(r1.maxX, r2.maxX) - Math.max(r1.minX, r2.minX);
            if (xOverlap > 0) {
                if (r2.minY >= r1.maxY) gaps.push(r2.minY - r1.maxY);
                else if (r1.minY >= r2.maxY) gaps.push(r1.minY - r2.maxY);
            }
        }
    }
    const positive = gaps.filter((g) => g > 0.5).sort((x, y) => x - y); // ほぼ0（誤差程度）は隙間なしとして除外
    if (!positive.length) return null;
    const mid = Math.floor(positive.length / 2);
    return positive.length % 2 ? positive[mid] : (positive[mid - 1] + positive[mid]) / 2;
}

// 「コマ間の幅」欄へ自動検出した値を反映する（見つからない場合は現在の値のまま据え置く）。
// 入力欄は見た目の幅を表すため、検出した実座標上の隙間にコマ枠線幅を足して表示値に変換する
function _splitRefreshGapDefault() {
    const input = document.getElementById('split-gap-width');
    if (!input || !state.activePage) return;
    const detected = _splitAutoDetectGap();
    if (detected === null) return;
    const borderWidth = state.panelBorder?.width || 0;
    input.value = Math.round((detected + borderWidth) * 100) / 100;
}

function _splitSetStatus(text) {
    const el = document.getElementById('split-status');
    if (el) el.textContent = text || '';
}

function _splitUpdateToggleUI() {
    const group = document.getElementById('split-mode-group');
    if (!group) return;
    group.querySelectorAll('.seg-btn').forEach(b =>
        b.classList.toggle('active', (b.dataset.splitMode === 'on') === _splitToolState.armed));
}

function initSplitPanelTool() {
    document.querySelectorAll('#split-mode-group .seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const armed = btn.dataset.splitMode === 'on';
            if (_splitToolState.armed === armed) return;
            _splitToolState.armed = armed;
            _splitUpdateToggleUI();
            _splitSetStatus(armed ? t('split.creating') : '');
            // ONにした時点の既存コマ間隔を自動検出し、コマ間の幅欄へ反映する
            if (armed) _splitRefreshGapDefault();
        });
    });

    const gapInput = document.getElementById('split-gap-width');
    if (gapInput) {
        try {
            const saved = parseFloat(localStorage.getItem(SPLIT_GAP_WIDTH_KEY));
            if (Number.isFinite(saved) && saved >= 0) gapInput.value = saved;
        } catch { /* ignore */ }
        gapInput.addEventListener('change', () => {
            const w = _splitGetGapWidth();
            gapInput.value = w;
            try { localStorage.setItem(SPLIT_GAP_WIDTH_KEY, String(w)); } catch { /* ignore */ }
        });
    }

    // 「分割」サブタブを開いた時点でも自動検出し直す（別ページ・別作品に切り替えていた場合に追従させる）
    document.querySelector('button[data-subtab="split"]')?.addEventListener('click', () => {
        _splitRefreshGapDefault();
    });
}

// ドラッグ線a-bの中点→開始点→終了点の順で内包判定し、その線を引いたコマ1つだけを特定する
// （サブコマ・points未設定のエントリは対象外。配列の後ろ＝最前面のコマを優先）
function _splitFindTargetPanel(a, b) {
    const panels = state.activePage?.panels || [];
    const findAt = (pt) => {
        for (let i = panels.length - 1; i >= 0; i--) {
            const p = panels[i];
            if (p.parentPanelId || !p.points) continue;
            const pts = _parsePointsStr(p.points);
            if (pts.length >= 3 && _pointInPolygon(pt, pts)) return p;
        }
        return null;
    };
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return findAt(mid) || findAt(a) || findAt(b);
}

// 要素のbounding box 4隅がすべてpolyPts内にあるか（完全に内包される場合のみtrue。
// 分割線をまたぐ・一部だけはみ出す要素はfalseになり、旧コマ側に残される）
function _splitBBoxFullyInside(el, polyPts) {
    let bbox;
    try { bbox = el.getBBox(); } catch { return false; }
    if (!bbox || bbox.width <= 0 || bbox.height <= 0) return false;
    const corners = [
        { x: bbox.x, y: bbox.y },
        { x: bbox.x + bbox.width, y: bbox.y },
        { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
        { x: bbox.x, y: bbox.y + bbox.height },
    ];
    return corners.every(c => _pointInPolygon(c, polyPts));
}

async function _splitCommitCut(a, b) {
    if (!state.activePage) return;
    const svgEl = getPanelLayerSvg();
    if (!svgEl) return;

    const target = _splitFindTargetPanel(a, b);
    if (!target) return;
    if (_isPanelLocked(target.id)) { _splitSetStatus(t('split.errLocked')); return; }

    const oldPts = _parsePointsStr(target.points);
    if (oldPts.length < 3) return;

    const oldContentG = svgEl.querySelector(`g[data-clip-panel="${CSS.escape(target.id)}"]`);
    const clipPoly = svgEl.querySelector(`#panel-clip-${CSS.escape(target.id)} polygon`);
    const defs = svgEl.querySelector('defs');
    if (!oldContentG || !clipPoly || !defs) return;

    const vb = (svgEl.getAttribute('viewBox') || '0 0 21000 29700').trim().split(/\s+/).map(Number);
    const pageW = vb[2] || 21000, pageH = vb[3] || 29700;
    const minArea = Math.max(1, pageW * pageH * 0.0002);

    // 「コマ間の幅」入力は、見た目の隙間（他のコマ同士の間隔と同じもの）として扱う。
    // レイアウトタブは常にコマ枠線幅の半分ずつを内側へ自動で食い込ませて表示するため
    // （renderLayoutTabのクリップ縮小）、_splitPolygonByLineへ渡す実際のポリゴン間隔は
    // 「見た目の幅 − 現在のコマ枠線幅」にしないと、その分だけ余計に広く見えてしまう
    const borderWidth = state.panelBorder?.width || 0;
    const pointsGap = Math.max(0, _splitGetGapWidth() - borderWidth);

    const result = _splitPolygonByLine(oldPts, a, b, pointsGap, minArea);
    if (!result) return; // 分割線がコマを横切っていない、または分割後の面積が小さすぎる
    const [polyA, polyB] = result;

    pushHistory();

    const newId = 'panel-split-' + Date.now();
    const ns = 'http://www.w3.org/2000/svg';

    // 旧コマのクリップ形状を分割後の形（polyA）に更新
    clipPoly.setAttribute('points', _pointsToStr(polyA));

    // 新コマ用のclipPath + コンテンツgを生成してDOMに追加
    const newClipId = `panel-clip-${newId}`;
    const newClipPath = document.createElementNS(ns, 'clipPath');
    newClipPath.setAttribute('id', newClipId);
    newClipPath.setAttribute('clipPathUnits', 'userSpaceOnUse');
    const newClipPoly = document.createElementNS(ns, 'polygon');
    newClipPoly.setAttribute('points', _pointsToStr(polyB));
    newClipPath.appendChild(newClipPoly);
    defs.appendChild(newClipPath);

    const newContentG = document.createElementNS(ns, 'g');
    newContentG.setAttribute('data-clip-panel', newId);
    newContentG.setAttribute('clip-path', `url(#${newClipId})`);
    oldContentG.parentNode.insertBefore(newContentG, oldContentG.nextSibling);

    // 新コマ側に完全に収まる要素だけを新コマへ移動する（またぐ/旧コマ側の要素は据え置き）
    Array.from(oldContentG.children).forEach((child) => {
        if (_splitBBoxFullyInside(child, polyB)) {
            if (child.tagName && child.tagName.toLowerCase() === 'image') {
                child.setAttribute('data-panel-id', newId);
            }
            newContentG.appendChild(child);
        }
    });

    // 背景SVG（svgContent）側のコマ枠線ポリゴン（id=旧コマID）も同じ形に分割する。
    // 枠線はコンテンツ層ではなく背景SVGに静的に描かれたpolygonのため、これをしないと
    // 分割した2コマの間（新しくできた境界）に見た目の枠線が引かれないまま残る
    let updatedSvgContent = state.activePage.svgContent;
    const bgDoc = new DOMParser().parseFromString(updatedSvgContent, 'image/svg+xml');
    const bgPoly = bgDoc.querySelector(`polygon[id="${target.id}"]`);
    if (bgPoly) {
        const newBgPoly = bgPoly.cloneNode(true);
        bgPoly.setAttribute('points', _pointsToStr(polyA));
        newBgPoly.setAttribute('id', newId);
        newBgPoly.setAttribute('points', _pointsToStr(polyB));
        bgPoly.parentNode.insertBefore(newBgPoly, bgPoly.nextSibling);
        updatedSvgContent = new XMLSerializer().serializeToString(bgDoc.querySelector('svg'));
    }

    // panels配列を更新: 旧コマはpointsだけ縮小（id・配列位置は不変）、新コマは旧コマの直後に挿入
    const updatedPanels = state.activePage.panels.map(p =>
        p.id === target.id ? { ...p, points: _pointsToStr(polyA) } : p);
    const oldIdx = updatedPanels.findIndex(p => p.id === target.id);
    updatedPanels.splice(oldIdx + 1, 0, { id: newId, points: _pointsToStr(polyB), panelSvgContent: '' });
    state.activePage = { ...state.activePage, panels: updatedPanels, svgContent: updatedSvgContent };
    await dbPut('pages', state.activePage, { deferThumb: true });

    await savePanelSvg(target.id, svgEl);
    await savePanelSvg(newId, svgEl);

    _splitToolState.armed = false;
    _splitUpdateToggleUI();
    _splitSetStatus(t('split.done'));

    await renderLayoutTab();
    selectPanel(newId);
}

function initSplitPanelManipulation(svgEl) {
    if (_splitManipWinMouseUp) { window.removeEventListener('mouseup', _splitManipWinMouseUp); _splitManipWinMouseUp = null; }
    if (!svgEl) return;

    let dragStart = null;
    let previewLine = null;

    const getSvgPt = (clientX, clientY) => {
        const pt = svgEl.createSVGPoint();
        pt.x = clientX; pt.y = clientY;
        return pt.matrixTransform(svgEl.getScreenCTM().inverse());
    };

    // キャプチャフェーズで登録: 画像/テキスト/フキダシ等の各操作ハンドラより先に発火させ、
    // 分割ドラッグ中に下のオブジェクトが一緒に動いてしまう二重反応を防ぐ
    svgEl.addEventListener('mousedown', (e) => {
        if (!_splitToolState.armed) return;
        if (state.selectedOverlay || state.selectedDraft) return;
        const p = getSvgPt(e.clientX, e.clientY);
        dragStart = { x: p.x, y: p.y };
        const ns = 'http://www.w3.org/2000/svg';
        const line = document.createElementNS(ns, 'line');
        line.setAttribute('x1', String(p.x));
        line.setAttribute('y1', String(p.y));
        line.setAttribute('x2', String(p.x));
        line.setAttribute('y2', String(p.y));
        line.setAttribute('stroke', '#ff3b30');
        line.setAttribute('stroke-width', '20');
        line.setAttribute('stroke-dasharray', '80,50');
        line.style.pointerEvents = 'none';
        svgEl.appendChild(line);
        previewLine = line;
        e.preventDefault();
        e.stopPropagation();
    }, true);

    svgEl.addEventListener('mousemove', (e) => {
        if (!dragStart || !previewLine) return;
        const p = getSvgPt(e.clientX, e.clientY);
        previewLine.setAttribute('x2', String(p.x));
        previewLine.setAttribute('y2', String(p.y));
    });

    const onMouseUp = async (e) => {
        if (!dragStart) return;
        const start = dragStart;
        dragStart = null;
        if (previewLine) { previewLine.remove(); previewLine = null; }
        const end = getSvgPt(e.clientX, e.clientY);
        const dist = Math.hypot(end.x - start.x, end.y - start.y);
        if (dist < 20) return; // クリック程度の移動は無視
        await _splitCommitCut(start, end);
    };
    window.addEventListener('mouseup', onMouseUp);
    _splitManipWinMouseUp = onMouseUp;
}

export { initSplitPanelTool, initSplitPanelManipulation };
