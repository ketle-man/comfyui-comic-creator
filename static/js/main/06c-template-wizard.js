// ============================================================
// テンプレート作成ウィザード 分割ファイル (3/3): テンプレート作成ウィザード(ライン分割方式)
// 元 06-template-wizard.js（分割前）の行 1012-1713 に相当
// type="module" として読み込まれる（ESモジュール化 G2）。06b-template-manager.js とは相互import（循環）。
// 循環先シンボルの参照はすべて関数内部（呼び出し時点で評価）に閉じているため安全。
// 主なトップレベル定義: TMPLWIZ_DEFAULT,_TMPLWIZ_LS_GRID,_prepareTemplateSvgDocForPage,_tmplGetFrameWidth,_tmplGroupsRefreshUI,_tmplSidePanelUpdate,_tmplWiz,_tmplWizAttachCanvasEvents,_tmplWizBuildSvgString,_tmplWizCanvasMouseDown,_tmplWizCanvasMouseMove,_tmplWizCanvasMouseUp,_tmplWizClientToSvg,_tmplWizCommitCut,_tmplWizComputeInitialPanels,_tmplWizCreateBase,_tmplWizDetachCanvasEvents,_tmplWizFindPanelIndexForCut,_tmplWizLoadGridSettings,_tmplWizOrderPanels,_tmplWizRender,_tmplWizRenderGrid,_tmplWizReset,_tmplWizSave,_tmplWizSaveGridSettings,_tmplWizSetCutMode,_tmplWizSetOrientation,_tmplWizSetOrientationButtons,_tmplWizShowStep,_tmplWizSnapPoint,_tmplWizSyncGridControls,_tmplWizUndo,closeTemplateWizard,deleteTemplate,openTemplateWizard,parseSVGForTemplate,renameTemplate,renderTemplateList,selectTemplate
// （_tmplGetFrameWidthは機械抽出で追加確認したシンボル。ヘッダコメントは元main.js分割時のもので非網羅）
// 未ESM化の外部依存（非moduleのグローバル関数はwindowプロパティとして自動的に見えるため、
// 呼び出し箇所は書き換えていない）:
//   state（01-state.js）, buildMergedSvg（07-pages.js）, _escHtml（21-script-tab.js）
// ============================================================

import { t } from '../i18n.js';
import { dbGet, dbPut, dbDelete, svgTextToDataUrl } from './00-db.js';
import { _pointsToStr } from './05-groups-move.js';
import { _polygonCentroid, _pointInPolygon, _splitPolygonByLine } from './06a-polygon-geometry.js';
import { saveTemplate, loadTemplates, _tmplGroups } from './06b-template-manager.js';
import { state } from './01-state.js';
import { buildMergedSvg } from './07-pages.js';

// ==============================
// テンプレート作成ウィザード（ライン分割方式）
// ==============================

const TMPLWIZ_DEFAULT = { portraitW: 21000, portraitH: 29700, frameWidth: 600 };

const _tmplWiz = {
    width: 0,
    height: 0,
    frameWidth: 0,
    orientation: 'portrait',
    cutMode: 'all',      // 'all'=線が交差する全コマを分割 / 'single'=線の開始点を含むコマだけを分割
    panels: [],        // {x,y}[][] 現在の作業ポリゴン群
    undoStack: [],      // panelsのスナップショット（JSON文字列）配列
    dragStart: null,    // ドラッグ開始点（SVG座標系）
    previewLine: null,  // ドラッグ中のプレビュー<line>要素
    gridEnabled: false, // ガイドグリッド表示ON/OFF
    gridW: 1000,        // ガイドグリッドのセル幅
    gridH: 1000,        // ガイドグリッドのセル高さ
    gridSnap: false,    // 分割線の始点/終点をグリッドにスナップするか
};

// ガイドグリッドの表示ON/OFF・サイズはウィザードを開き直しても引き継がれるようlocalStorageへ永続化する
const _TMPLWIZ_LS_GRID = 'tmplwiz_grid_settings';

function _tmplWizLoadGridSettings() {
    try {
        const obj = JSON.parse(localStorage.getItem(_TMPLWIZ_LS_GRID) || 'null');
        if (!obj) return;
        if (typeof obj.enabled === 'boolean') _tmplWiz.gridEnabled = obj.enabled;
        if (obj.w > 0) _tmplWiz.gridW = obj.w;
        if (obj.h > 0) _tmplWiz.gridH = obj.h;
        if (typeof obj.snap === 'boolean') _tmplWiz.gridSnap = obj.snap;
    } catch { /* 破損値は無視してデフォルトのまま */ }
}

function _tmplWizSaveGridSettings() {
    localStorage.setItem(_TMPLWIZ_LS_GRID, JSON.stringify({
        enabled: _tmplWiz.gridEnabled, w: _tmplWiz.gridW, h: _tmplWiz.gridH, snap: _tmplWiz.gridSnap,
    }));
}

function _tmplWizSyncGridControls() {
    const toggle = document.getElementById('tmplwiz-grid-toggle');
    const wInput = document.getElementById('tmplwiz-grid-w');
    const hInput = document.getElementById('tmplwiz-grid-h');
    const snapToggle = document.getElementById('tmplwiz-grid-snap-toggle');
    if (toggle) toggle.checked = _tmplWiz.gridEnabled;
    if (wInput) wInput.value = _tmplWiz.gridW;
    if (hInput) hInput.value = _tmplWiz.gridH;
    if (snapToggle) snapToggle.checked = _tmplWiz.gridSnap;
}

// スナップON時、分割線の始点/終点をグリッド交点に丸める（ガイドグリッドの表示ON/OFFとは独立して機能する）
function _tmplWizSnapPoint(p) {
    if (!_tmplWiz.gridSnap) return p;
    const gw = _tmplWiz.gridW, gh = _tmplWiz.gridH;
    if (!(gw > 0) || !(gh > 0)) return p;
    return { x: Math.round(p.x / gw) * gw, y: Math.round(p.y / gh) * gh };
}

function openTemplateWizard() {
    const overlay = document.getElementById('tmplwiz-overlay');
    if (!overlay) return;
    _tmplWiz.orientation = 'portrait';
    _tmplWizSetOrientationButtons();
    _tmplWizSetCutMode('all');
    document.getElementById('tmplwiz-width').value = TMPLWIZ_DEFAULT.portraitW;
    document.getElementById('tmplwiz-height').value = TMPLWIZ_DEFAULT.portraitH;
    document.getElementById('tmplwiz-frame-width').value = TMPLWIZ_DEFAULT.frameWidth;
    _tmplWizLoadGridSettings();
    _tmplWizSyncGridControls();
    _tmplWizShowStep('setup');
    overlay.style.display = 'flex';
}

function closeTemplateWizard() {
    const overlay = document.getElementById('tmplwiz-overlay');
    if (overlay) overlay.style.display = 'none';
    _tmplWizDetachCanvasEvents();
    _tmplWiz.panels = [];
    _tmplWiz.undoStack = [];
    _tmplWiz.dragStart = null;
    _tmplWiz.previewLine = null;
}

function _tmplWizShowStep(step) {
    const setupEl = document.getElementById('tmplwiz-step-setup');
    const cutEl = document.getElementById('tmplwiz-step-cut');
    const createBaseBtn = document.getElementById('tmplwiz-create-base-btn');
    const saveBtn = document.getElementById('tmplwiz-save-btn');
    const isSetup = step === 'setup';
    setupEl.style.display = isSetup ? '' : 'none';
    cutEl.style.display = isSetup ? 'none' : '';
    createBaseBtn.style.display = isSetup ? '' : 'none';
    saveBtn.style.display = isSetup ? 'none' : '';
}

function _tmplWizSetOrientation(orientation) {
    _tmplWiz.orientation = orientation;
    _tmplWizSetOrientationButtons();
    const widthInput = document.getElementById('tmplwiz-width');
    const heightInput = document.getElementById('tmplwiz-height');
    const w = TMPLWIZ_DEFAULT.portraitW, h = TMPLWIZ_DEFAULT.portraitH;
    if (orientation === 'portrait') {
        widthInput.value = w;
        heightInput.value = h;
    } else {
        widthInput.value = h;
        heightInput.value = w;
    }
}

function _tmplWizSetOrientationButtons() {
    const portraitBtn = document.getElementById('tmplwiz-orientation-portrait');
    const landscapeBtn = document.getElementById('tmplwiz-orientation-landscape');
    if (portraitBtn) portraitBtn.classList.toggle('active', _tmplWiz.orientation === 'portrait');
    if (landscapeBtn) landscapeBtn.classList.toggle('active', _tmplWiz.orientation === 'landscape');
}

// 分割モード切り替え（'all'=線が交差する全コマを分割 / 'single'=ドラッグ開始点を含むコマだけを分割）
function _tmplWizSetCutMode(mode) {
    _tmplWiz.cutMode = mode;
    const allBtn = document.getElementById('tmplwiz-mode-all-btn');
    const singleBtn = document.getElementById('tmplwiz-mode-single-btn');
    if (allBtn) allBtn.classList.toggle('active', mode === 'all');
    if (singleBtn) singleBtn.classList.toggle('active', mode === 'single');
    const hint = document.getElementById('tmplwiz-cut-hint');
    if (hint) {
        hint.textContent = mode === 'single'
            ? t('wiz.hintSingle')
            : t('wiz.hintAll');
    }
}

// 入力欄の値から作業用の初期矩形（ページをフレーム幅だけ内側に縮小したもの）を1枚だけセットする
function _tmplWizComputeInitialPanels() {
    const width = Math.max(1, parseFloat(document.getElementById('tmplwiz-width').value) || 0);
    const height = Math.max(1, parseFloat(document.getElementById('tmplwiz-height').value) || 0);
    const frameWidth = Math.max(0, parseFloat(document.getElementById('tmplwiz-frame-width').value) || 0);
    const maxInset = Math.min(width, height) / 2 - 1;
    const inset = Math.min(frameWidth, Math.max(0, maxInset));

    _tmplWiz.width = width;
    _tmplWiz.height = height;
    _tmplWiz.frameWidth = frameWidth;
    _tmplWiz.panels = [[
        { x: inset, y: inset },
        { x: width - inset, y: inset },
        { x: width - inset, y: height - inset },
        { x: inset, y: height - inset },
    ]];
    _tmplWiz.undoStack = [];
}

function _tmplWizCreateBase() {
    _tmplWizComputeInitialPanels();
    _tmplWizShowStep('cut');
    _tmplWizAttachCanvasEvents();
    _tmplWizRender();
}

function _tmplWizRender() {
    const svg = document.getElementById('tmplwiz-canvas');
    if (!svg) return;
    const NS = 'http://www.w3.org/2000/svg';
    svg.setAttribute('viewBox', `0 0 ${_tmplWiz.width} ${_tmplWiz.height}`);
    svg.innerHTML = '';

    // ページ全体（panel_0相当）の目安枠
    const base = document.createElementNS(NS, 'rect');
    base.setAttribute('x', '0');
    base.setAttribute('y', '0');
    base.setAttribute('width', String(_tmplWiz.width));
    base.setAttribute('height', String(_tmplWiz.height));
    base.setAttribute('fill', 'none');
    base.setAttribute('stroke', '#555');
    base.setAttribute('stroke-width', String(Math.max(2, _tmplWiz.width * 0.001)));
    svg.appendChild(base);

    const strokeWidth = Math.max(4, _tmplWiz.width * 0.003);
    const fontSize = Math.max(80, _tmplWiz.width * 0.03);

    _tmplWiz.panels.forEach((pts, idx) => {
        const poly = document.createElementNS(NS, 'polygon');
        poly.setAttribute('points', _pointsToStr(pts));
        poly.setAttribute('fill', 'rgba(0, 120, 212, 0.15)');
        poly.setAttribute('stroke', '#000');
        poly.setAttribute('stroke-width', String(strokeWidth));
        svg.appendChild(poly);

        const c = _polygonCentroid(pts);
        const label = document.createElementNS(NS, 'text');
        label.setAttribute('x', String(c.x));
        label.setAttribute('y', String(c.y));
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('dominant-baseline', 'middle');
        label.setAttribute('font-size', String(fontSize));
        label.setAttribute('fill', '#000');
        label.textContent = String(idx + 1);
        svg.appendChild(label);
    });

    _tmplWizRenderGrid(svg, NS);
}

// コマ分割時の目安線として、指定サイズの格子をオーバーレイ表示する（分割データには一切影響しないガイド専用）
function _tmplWizRenderGrid(svg, NS) {
    if (!_tmplWiz.gridEnabled) return;
    const gw = _tmplWiz.gridW, gh = _tmplWiz.gridH;
    if (!(gw > 0) || !(gh > 0)) return;
    // 極端に小さいセル指定で線が密集しすぎる場合は描画を諦める（誤入力からの防御）
    if (_tmplWiz.width / gw > 300 || _tmplWiz.height / gh > 300) return;

    const g = document.createElementNS(NS, 'g');
    g.setAttribute('pointer-events', 'none');
    const strokeWidth = Math.max(2, _tmplWiz.width * 0.0016);
    const dash = `${_tmplWiz.width * 0.004},${_tmplWiz.width * 0.004}`;

    for (let x = gw; x < _tmplWiz.width; x += gw) {
        const line = document.createElementNS(NS, 'line');
        line.setAttribute('x1', String(x));
        line.setAttribute('y1', '0');
        line.setAttribute('x2', String(x));
        line.setAttribute('y2', String(_tmplWiz.height));
        line.setAttribute('stroke', 'rgba(255,140,0,0.75)');
        line.setAttribute('stroke-width', String(strokeWidth));
        line.setAttribute('stroke-dasharray', dash);
        g.appendChild(line);
    }
    for (let y = gh; y < _tmplWiz.height; y += gh) {
        const line = document.createElementNS(NS, 'line');
        line.setAttribute('x1', '0');
        line.setAttribute('y1', String(y));
        line.setAttribute('x2', String(_tmplWiz.width));
        line.setAttribute('y2', String(y));
        line.setAttribute('stroke', 'rgba(255,140,0,0.75)');
        line.setAttribute('stroke-width', String(strokeWidth));
        line.setAttribute('stroke-dasharray', dash);
        g.appendChild(line);
    }
    svg.appendChild(g);
}

function _tmplWizClientToSvg(svg, clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return _tmplWizSnapPoint({ x: p.x, y: p.y });
}

function _tmplWizCanvasMouseDown(e) {
    const svg = document.getElementById('tmplwiz-canvas');
    if (!svg) return;
    const p = _tmplWizClientToSvg(svg, e.clientX, e.clientY);
    _tmplWiz.dragStart = { x: p.x, y: p.y };

    const NS = 'http://www.w3.org/2000/svg';
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', String(p.x));
    line.setAttribute('y1', String(p.y));
    line.setAttribute('x2', String(p.x));
    line.setAttribute('y2', String(p.y));
    line.setAttribute('stroke', '#ff3b30');
    line.setAttribute('stroke-width', String(Math.max(4, _tmplWiz.width * 0.003)));
    line.setAttribute('stroke-dasharray', `${_tmplWiz.width * 0.01},${_tmplWiz.width * 0.006}`);
    svg.appendChild(line);
    _tmplWiz.previewLine = line;
}

function _tmplWizCanvasMouseMove(e) {
    if (!_tmplWiz.dragStart || !_tmplWiz.previewLine) return;
    const svg = document.getElementById('tmplwiz-canvas');
    if (!svg) return;
    const p = _tmplWizClientToSvg(svg, e.clientX, e.clientY);
    _tmplWiz.previewLine.setAttribute('x2', String(p.x));
    _tmplWiz.previewLine.setAttribute('y2', String(p.y));
}

function _tmplWizCanvasMouseUp(e) {
    if (!_tmplWiz.dragStart) return;
    const svg = document.getElementById('tmplwiz-canvas');
    const start = _tmplWiz.dragStart;
    _tmplWiz.dragStart = null;
    if (_tmplWiz.previewLine) {
        _tmplWiz.previewLine.remove();
        _tmplWiz.previewLine = null;
    }
    if (!svg) return;
    const end = _tmplWizClientToSvg(svg, e.clientX, e.clientY);

    const dist = Math.hypot(end.x - start.x, end.y - start.y);
    if (dist < Math.max(4, _tmplWiz.width * 0.005)) return; // クリック程度の移動は無視

    _tmplWizCommitCut(start, { x: end.x, y: end.y });
}

function _tmplWizCommitCut(a, b) {
    const snapshot = JSON.stringify(_tmplWiz.panels);
    const minArea = Math.max(1, _tmplWiz.width * _tmplWiz.height * 0.0002);

    if (_tmplWiz.cutMode === 'single') {
        // 線を引き始めたコマだけを分割する（他のコマは、その直線の延長線上にあっても一切変更しない）
        const targetIdx = _tmplWizFindPanelIndexForCut(a, b);
        if (targetIdx === -1) return;

        const result = _splitPolygonByLine(_tmplWiz.panels[targetIdx], a, b, _tmplWiz.frameWidth, minArea);
        if (!result) return;

        _tmplWiz.undoStack.push(snapshot);
        const nextPanels = _tmplWiz.panels.slice();
        nextPanels.splice(targetIdx, 1, result[0], result[1]);
        _tmplWiz.panels = nextPanels;
        _tmplWizRender();
        return;
    }

    const nextPanels = [];
    let changed = false;

    _tmplWiz.panels.forEach(pts => {
        const result = _splitPolygonByLine(pts, a, b, _tmplWiz.frameWidth, minArea);
        if (result) {
            changed = true;
            nextPanels.push(result[0], result[1]);
        } else {
            nextPanels.push(pts);
        }
    });

    if (!changed) return;

    _tmplWiz.undoStack.push(snapshot);
    _tmplWiz.panels = nextPanels;
    _tmplWizRender();
}

// 単一コマ分割モード用: ドラッグ線a-bを含むコマのインデックスを特定する
// （線分の中点→開始点→終了点の順で内包判定し、境界線上からのドラッグにも対応する）
function _tmplWizFindPanelIndexForCut(a, b) {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    let idx = _tmplWiz.panels.findIndex(pts => _pointInPolygon(mid, pts));
    if (idx === -1) idx = _tmplWiz.panels.findIndex(pts => _pointInPolygon(a, pts));
    if (idx === -1) idx = _tmplWiz.panels.findIndex(pts => _pointInPolygon(b, pts));
    return idx;
}

function _tmplWizUndo() {
    const snapshot = _tmplWiz.undoStack.pop();
    if (!snapshot) return;
    _tmplWiz.panels = JSON.parse(snapshot);
    _tmplWizRender();
}

function _tmplWizReset() {
    if (_tmplWiz.undoStack.length === 0 && _tmplWiz.panels.length <= 1) return;
    if (!confirm(t('tmpl.confirmResetCut'))) return;
    _tmplWizComputeInitialPanels();
    _tmplWizRender();
}

function _tmplWizAttachCanvasEvents() {
    const svg = document.getElementById('tmplwiz-canvas');
    if (!svg) return;
    svg.addEventListener('mousedown', _tmplWizCanvasMouseDown);
    svg.addEventListener('mousemove', _tmplWizCanvasMouseMove);
    window.addEventListener('mouseup', _tmplWizCanvasMouseUp);
}

function _tmplWizDetachCanvasEvents() {
    const svg = document.getElementById('tmplwiz-canvas');
    if (svg) {
        svg.removeEventListener('mousedown', _tmplWizCanvasMouseDown);
        svg.removeEventListener('mousemove', _tmplWizCanvasMouseMove);
    }
    window.removeEventListener('mouseup', _tmplWizCanvasMouseUp);
}

// 保存直前に読み順（上→下、同じ行内は左→右）でpanel番号を割り当てる
function _tmplWizOrderPanels() {
    const withCentroid = _tmplWiz.panels.map(pts => ({ pts, c: _polygonCentroid(pts) }));
    withCentroid.sort((p1, p2) => p1.c.y - p2.c.y);

    const rowThreshold = _tmplWiz.height * 0.05;
    const rows = [];
    withCentroid.forEach(item => {
        const row = rows.find(r => Math.abs(r.y - item.c.y) <= rowThreshold);
        if (row) {
            row.items.push(item);
            row.y = (row.y * (row.items.length - 1) + item.c.y) / row.items.length;
        } else {
            rows.push({ y: item.c.y, items: [item] });
        }
    });
    rows.sort((r1, r2) => r1.y - r2.y);

    const ordered = [];
    rows.forEach(row => {
        row.items.sort((p1, p2) => p1.c.x - p2.c.x);
        row.items.forEach(item => ordered.push(item.pts));
    });
    return ordered;
}

function _tmplWizBuildSvgString(orderedPanels) {
    const strokeWidth = Math.max(4, _tmplWiz.width * 0.003);
    const parts = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${_tmplWiz.width} ${_tmplWiz.height}">`);
    // ページ全体を覆う白背景（一覧サムネイル・レイアウトタブでの見やすさのため）
    parts.push(`  <rect x="0" y="0" width="${_tmplWiz.width}" height="${_tmplWiz.height}" fill="#ffffff"/>`);
    parts.push(`  <polygon id="panel_0" points="0,0 ${_tmplWiz.width},0 ${_tmplWiz.width},${_tmplWiz.height} 0,${_tmplWiz.height}" fill="none" stroke="#000" stroke-width="${strokeWidth}"/>`);
    orderedPanels.forEach((pts, idx) => {
        parts.push(`  <polygon id="panel_${idx + 1}" points="${_pointsToStr(pts)}" fill="none" stroke="#000" stroke-width="${strokeWidth}"/>`);
    });
    parts.push('</svg>');
    return parts.join('\n');
}

async function _tmplWizSave() {
    if (_tmplWiz.panels.length === 0) { alert(t('tmpl.noPanels')); return; }

    const defaultName = `${t('tmpl.defaultNamePrefix')}_${Date.now()}`;
    const name = prompt(t('tmpl.namePrompt'), defaultName)?.trim();
    if (!name) return;

    const existing = await dbGet('templates', name);
    if (existing && !confirm(t('tmpl.confirmOverwrite', name))) return;

    try {
        const orderedPanels = _tmplWizOrderPanels();
        const svgText = _tmplWizBuildSvgString(orderedPanels);
        const template = parseSVGForTemplate(svgText, name);
        await saveTemplate(template, svgText);
        await loadTemplates();
        renderTemplateList();
        closeTemplateWizard();
        alert(t('tmpl.created', name));
    } catch (e) {
        console.error('Template wizard save error:', e);
        alert(t('tmpl.createFailed', e.message));
    }
}

async function deleteTemplate(templateName) {
    if (!confirm(t('tmpl.confirmDelete', templateName))) return;

    try {
        await dbDelete('templates', templateName);
        _tmplGroups.remove(templateName);
        if (state.selectedTemplateName === templateName) {
            state.selectedTemplateName = null;
            _tmplSidePanelUpdate(null);
        }
        const delBtn = document.getElementById('template-delete-btn');
        if (delBtn) delBtn.disabled = true;
        const renameBtn = document.getElementById('template-rename-btn');
        if (renameBtn) renameBtn.disabled = true;
        await loadTemplates();
        renderTemplateList();
    } catch (e) {
        console.error('Delete error:', e);
        alert(t('tmpl.deleteFailed', e.message));
    }
}

function _tmplGroupsRefreshUI() {
    // グループフィルタ・サイドパネルのセレクトを同期
    const filterSel = document.getElementById('template-group-filter');
    const sideSel = document.getElementById('tmpl-group-select');
    const groups = _tmplGroups.groupNames();

    [filterSel, sideSel].forEach((sel, i) => {
        if (!sel) return;
        const prevVal = sel.value;
        sel.innerHTML = i === 0
            ? `<option value="">${t('layout.fontCatAll')}</option>`
            : `<option value="">${t('page.groupSelectOption')}</option>`;
        groups.forEach(g => {
            const opt = document.createElement('option');
            opt.value = g;
            opt.textContent = g;
            sel.appendChild(opt);
        });
        if (groups.includes(prevVal)) sel.value = prevVal;
    });

    renderTemplateList();
}

function _tmplSidePanelUpdate(name) {
    const nameEl = document.getElementById('tmpl-prop-name');
    const groupEl = document.getElementById('tmpl-prop-group');
    const assignBtn = document.getElementById('tmpl-assign-group-btn');
    const removeBtn = document.getElementById('tmpl-remove-group-btn');

    if (!name) {
        if (nameEl) nameEl.textContent = t('layout.notSelected');
        if (groupEl) groupEl.textContent = '';
        if (assignBtn) assignBtn.disabled = true;
        if (removeBtn) removeBtn.disabled = true;
        return;
    }

    const group = _tmplGroups.groupOf(name);
    if (nameEl) nameEl.textContent = name;
    if (groupEl) groupEl.textContent = group ? t('tmpl.groupLabel', group) : t('tmpl.groupNone');
    if (assignBtn) assignBtn.disabled = false;
    if (removeBtn) removeBtn.disabled = !group;
}

function _tmplReadStrokeWidthAttr(el) {
    let sw = el.getAttribute('stroke-width');
    if (!sw) {
        const m = (el.getAttribute('style') || '').match(/stroke-width\s*:\s*([\d.]+)/);
        if (m) sw = m[1];
    }
    const v = parseFloat(sw);
    return Number.isNaN(v) ? null : v;
}

/**
 * テンプレートのコマ枠線幅をsvgContentから抽出する（panel_0はページベースなので2番目以降を優先）。
 * stroke-widthが明示されている図形のみを候補とすることで、装飾用の背景矩形
 * （ストローク指定なし）を自然に除外する。
 */
function _tmplGetFrameWidth(template) {
    if (!template.svgContent) return null;
    try {
        const doc = new DOMParser().parseFromString(template.svgContent, 'image/svg+xml');
        const candidates = Array.from(doc.querySelectorAll(_TMPL_SHAPE_SELECTOR))
            .map(_tmplReadStrokeWidthAttr)
            .filter(v => v !== null);
        const v = candidates.length > 1 ? candidates[1] : candidates[0];
        return v === undefined ? null : Math.round(v * 10) / 10;
    } catch { return null; }
}

function renderTemplateList() {
    const container = document.getElementById('template-list');
    if (!container) return;

    container.innerHTML = '';

    const filterGroup = document.getElementById('template-group-filter')?.value || '';

    let templates = state.templates;
    if (filterGroup) {
        const members = _tmplGroups.data[filterGroup] || [];
        templates = templates.filter(t => members.includes(t.name));
    }

    if (templates.length === 0) {
        container.innerHTML = `<p class="empty-message">${t('page.noTemplates')}</p>`;
        return;
    }

    templates.forEach(template => {
        const card = document.createElement('div');
        card.className = 'template-card';
        if (state.selectedTemplateName === template.name) {
            card.classList.add('selected');
        }

        let imgHtml = '<div style="height: 150px; display: flex; align-items: center; justify-content: center;">No Image</div>';
        if (template.svgContent) {
            // コンテンツ込みのSVGを合成してプレビュー（buildMergedSvgはpageRecord互換構造を受け取る）
            const hasPanelContent = (template.panels || []).some(p => p.panelSvgContent);
            const previewSvg = (hasPanelContent || template.overlaySvgContent)
                ? buildMergedSvg(template)
                : template.svgContent;
            const dataUrl = svgTextToDataUrl(previewSvg);
            imgHtml = `<img src="${dataUrl}" style="width: 100%; height: auto; max-height: 150px;">`;
        }

        const group = _tmplGroups.groupOf(template.name);
        const groupBadge = group
            ? `<div style="font-size:10px; color:var(--text-secondary); margin-top:2px;">${_escHtml(group)}</div>`
            : '';

        // サイズ＋コマ枠線幅（枠幅はsvgContentから抽出、取得できなければサイズのみ。表示は整数に丸める）
        const infoBadge = (template.width && template.height)
            ? `<div style="font-size:10px; color:var(--text-secondary); margin-top:2px;">${_escHtml(t('tmpl.cardInfo', Math.round(template.width), Math.round(template.height), _tmplGetFrameWidth(template)))}</div>`
            : '';

        card.innerHTML = `${imgHtml}<h3>${_escHtml(template.name)}</h3>${infoBadge}${groupBadge}`;
        card.addEventListener('click', () => selectTemplate(template.name));
        container.appendChild(card);
    });
}

function selectTemplate(name) {
    state.selectedTemplateName = name;
    renderTemplateList();
    const delBtn = document.getElementById('template-delete-btn');
    if (delBtn) delBtn.disabled = !name;
    const renameBtn = document.getElementById('template-rename-btn');
    if (renameBtn) renameBtn.disabled = !name;
    _tmplSidePanelUpdate(name);
}

async function renameTemplate(oldName) {
    // モーダルダイアログ
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:8px;padding:24px;min-width:320px;max-width:480px;width:90%;';
    dialog.innerHTML = `
        <h3 style="margin:0 0 16px;font-size:15px;">${t('tmpl.renameHeader')}</h3>
        <input type="text" id="template-rename-input" value="${oldName}"
            style="width:100%;box-sizing:border-box;padding:6px 8px;font-size:14px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-primary);color:var(--text-primary);" />
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
            <button id="template-rename-cancel" class="btn secondary">${t('common.cancel')}</button>
            <button id="template-rename-ok" class="btn primary">${t('tmpl.renameOk')}</button>
        </div>
    `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const input = dialog.querySelector('#template-rename-input');
    input.select();

    const close = () => document.body.removeChild(overlay);

    dialog.querySelector('#template-rename-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    const doRename = async () => {
        const newName = input.value.trim();
        if (!newName) { alert(t('tmpl.enterName')); return; }
        if (newName === oldName) { close(); return; }
        if (state.templates.some(t => t.name === newName)) {
            alert(t('tmpl.alreadyExists', newName));
            return;
        }
        try {
            const record = await dbGet('templates', oldName);
            if (!record) throw new Error(t('tmpl.notFound'));
            await dbPut('templates', { ...record, name: newName });
            await dbDelete('templates', oldName);
            _tmplGroups.renameTemplate(oldName, newName);
            state.selectedTemplateName = newName;
            await loadTemplates();
            renderTemplateList();
            _tmplSidePanelUpdate(newName);
            const delBtn = document.getElementById('template-delete-btn');
            if (delBtn) delBtn.disabled = false;
            const renameBtn = document.getElementById('template-rename-btn');
            if (renameBtn) renameBtn.disabled = false;
            close();
        } catch (e) {
            alert(t('tmpl.renameFailed', e.message));
        }
    };

    dialog.querySelector('#template-rename-ok').addEventListener('click', doRename);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doRename(); });
}

// SVG解析ロジック
// Inkscape/Illustrator/Affinity Designer/CorelDraw等、ツールによって図形の出力形式が
// <rect>/<path>/<polygon>/<circle>/<ellipse>とバラバラでも読み込めるよう、
// ブラウザ本体のSVGエンジン（getCTM/getPointAtLength）にtransform解決と曲線近似を委ねる。
// 手計算でmatrix合成やベジェ曲線・円弧のフラット化を行うより、UAの実装に任せた方が
// 各ツール固有の癖（入れ子group、matrix/skew、sodipodi:type=star等）に対して確実。
const _TMPL_SHAPE_SELECTOR = 'rect, polygon, polyline, path, circle, ellipse';
const _TMPL_HIDDEN_ANCESTOR_SELECTOR = 'defs, clipPath, mask, symbol, pattern';
const _TMPL_INKSCAPE_NS = 'http://www.inkscape.org/namespaces/inkscape';

function parseSVGForTemplate(svgText, filename) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');

    if (!svgEl) throw new Error(t('tmpl.errNoSvg'));

    const viewBoxAttr = svgEl.getAttribute('viewBox');
    if (!viewBoxAttr) throw new Error(t('tmpl.errNoViewBox'));

    const viewBox = viewBoxAttr.trim().split(/[\s,]+/).map(Number);

    const { rootSvg, cleanup } = _tmplAttachHiddenSvg(svgEl);
    let panels, basePanelPoints;

    try {
        const shapeEls = _tmplCollectShapeElements(rootSvg);

        // 明示的に panel_0 と名付けられた図形があればそれを基準とし、
        // なければ（従来どおり）最初に描画された図形をベースとして扱う。
        const explicitBaseIndex = shapeEls.findIndex(el => _tmplMatchesPanelZero(el));
        const baseIndex = explicitBaseIndex !== -1 ? explicitBaseIndex : 0;

        // ストロークが不可視でid/labelも無い図形（装飾用の背景矩形など）を除外して抽出する。
        ({ panels, basePanelPoints } = _tmplExtractPanels(shapeEls, baseIndex, true));
        // 除外しすぎて1コマも残らなかった場合は、装飾判定なしで再抽出する（安全弁）。
        if (panels.length === 0) {
            ({ panels, basePanelPoints } = _tmplExtractPanels(shapeEls, baseIndex, false));
        }
    } finally {
        cleanup();
    }

    if (panels.length === 0) throw new Error(t('tmpl.errNoPanels'));

    panels.sort((a, b) => a.number - b.number);

    // ページサイズはviewBoxの数値ではなく、panel_0（ページ外枠）の実座標の外接矩形から求める。
    // getCTM()は「最も近い祖先ビューポート要素の“親”座標系」への変換を返す仕様のため、
    // ルートsvgの直接の子孫にとってその変換先はviewBox内部座標系ではなく、
    // ルートsvg自身のCSSピクセルサイズ（width/height属性を96dpiで解決した値）になる。
    // Inkscape等はviewBoxの数値をこのCSSピクセル値と一致させて出力するため気づきにくいが、
    // CorelDrawのように独自スケール（例: 1mm=100ユーザー単位）のviewBoxを使うツールでは、
    // viewBoxの数値とpanels[].points/basePanelPointsの実際のスケールが食い違ってしまう
    // （ページは21000x29700なのにコマは793x1122付近に収まる、といった不整合）。
    // panel_0はgetCTM()を経由した同じ解決結果のため、そこから外接矩形を取ることで
    // width/heightとコマ座標のスケールを常に一致させられる。
    const baseBBox = _tmplBoundingBoxOfPointsStr(basePanelPoints);
    const width = baseBBox ? baseBBox.width : viewBox[2];
    const height = baseBBox ? baseBBox.height : viewBox[3];

    return { id: filename, name: filename, width, height, panels, basePanelPoints };
}

function _tmplBoundingBoxOfPointsStr(pointsStr) {
    if (!pointsStr) return null;
    const nums = pointsStr.trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
    if (nums.length < 4) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i + 1 < nums.length; i += 2) {
        const x = nums[i], y = nums[i + 1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;
    return { width: maxX - minX, height: maxY - minY };
}

function _tmplExtractPanels(shapeEls, baseIndex, filterDecorativeBackground) {
    const panels = [];
    let basePanelPoints = '';

    shapeEls.forEach((el, index) => {
        if (index === baseIndex) {
            basePanelPoints = _tmplShapeToPointsStr(el);
            return;
        }

        // id/labelでpanel_Nと明示されていない図形は、ストロークが不可視なら
        // コマではなく装飾用の背景（テンプレートウィザードが出力する白背景矩形や、
        // Illustrator/Affinity等が付与するアートボード背景など）とみなして除外する。
        // panel_0（ベース）はクリップ範囲としてのみ使うため、この判定の対象外。
        const explicitNumber = _tmplPanelNumberExplicit(el);
        if (filterDecorativeBackground && explicitNumber === null && !_tmplHasVisibleStroke(el)) return;

        const points = _tmplShapeToPointsStr(el);
        if (!points) return; // 幅0の矩形など、面積を持たない図形は無視

        const id = el.getAttribute('id') || _tmplEffectiveId(el) || `panel_${index}`;
        const number = explicitNumber !== null ? explicitNumber : panels.length + 1;
        panels.push({ id, number, points });
    });

    return { panels, basePanelPoints };
}

// getCTM()/getPointAtLength()はレイアウトを持つ（=実DOMにアタッチされた）要素でないと
// 正確に計算できないため、画面外の非表示コンテナに一時的に取り込んでから解析する。
function _tmplAttachHiddenSvg(svgEl) {
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-99999px';
    container.style.top = '-99999px';
    const imported = document.importNode(svgEl, true);

    // width/height が % 指定（Affinity Designer等が既定で出力する width="100%" height="100%" 等）の場合、
    // 非表示コンテナ側に具体的なサイズが無いため、CSSの「置換要素のデフォルトサイズ」
    // （300×150にアスペクト比を保って収める）にフォールバックしてしまい、getCTM()がviewBoxの
    // 数値と無関係などく小さいサイズを基準に解決してしまう（width/height属性が丸ごと無い場合は
    // viewBoxがそのまま実寸として使われるため問題ない。%指定の場合のみ発生する）。
    // viewBoxの数値をそのままpxとして明示指定し直すことで、意図した実寸で解決されるようにする。
    const widthAttr = (imported.getAttribute('width') || '').trim();
    const heightAttr = (imported.getAttribute('height') || '').trim();
    if (widthAttr.endsWith('%') || heightAttr.endsWith('%')) {
        const vb = (imported.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
        if (vb.length === 4 && Number.isFinite(vb[2]) && Number.isFinite(vb[3])) {
            imported.setAttribute('width', String(vb[2]));
            imported.setAttribute('height', String(vb[3]));
        }
    }

    container.appendChild(imported);
    document.body.appendChild(container);
    return { rootSvg: imported, cleanup: () => container.remove() };
}

function _tmplCollectShapeElements(root) {
    return Array.from(root.querySelectorAll(_TMPL_SHAPE_SELECTOR)).filter(el => {
        if (el.closest(_TMPL_HIDDEN_ANCESTOR_SELECTOR)) return false; // clipPath/defs内の定義図形は除外
        if (_tmplIsHiddenAncestry(el)) return false; // 非表示レイヤー（Illustratorの隠しレイヤー等）を除外
        return true;
    });
}

function _tmplIsHiddenAncestry(el) {
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
        const style = node.getAttribute('style') || '';
        if (/display\s*:\s*none/i.test(style) || node.getAttribute('display') === 'none') return true;
        if (/visibility\s*:\s*hidden/i.test(style) || node.getAttribute('visibility') === 'hidden') return true;
    }
    return false;
}

// Affinity Designer等、transform付きのレイヤーをid付き<g>でラップし、中の図形自体には
// idを付けないツールがあるため、図形自身にidが無い場合は祖先方向に最も近いid付き要素を採用する
// （defs/clipPath等は_tmplCollectShapeElementsで除外済みなので、ここでは考慮不要）。
function _tmplEffectiveId(el) {
    const node = el.closest('[id]');
    return node ? node.getAttribute('id') : '';
}

// inkscape:labelも同様に、図形自身に無ければ祖先方向へ探す。
function _tmplGetLabel(el) {
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
        const label = node.getAttributeNS(_TMPL_INKSCAPE_NS, 'label') || node.getAttribute('inkscape:label');
        if (label) return label;
    }
    return '';
}

function _tmplMatchesPanelZero(el) {
    const id = _tmplEffectiveId(el);
    const label = _tmplGetLabel(el);
    return /^panel[_-]?0$/i.test(id) || /^panel[_-]?0$/i.test(label);
}

// id/labelが panel_N 形式に一致する場合のみ数値を返す（一致しなければnull＝番号は未指定）。
function _tmplPanelNumberExplicit(el) {
    const id = _tmplEffectiveId(el);
    const label = _tmplGetLabel(el);
    const match = id.match(/panel[_-]?(\d+)/i) || label.match(/panel[_-]?(\d+)/i);
    return match ? parseInt(match[1], 10) : null;
}

// 実際に線として見える（不透明度・太さが0でない）strokeを持つかどうか。
// getComputedStyle()を使うことで、style属性/プレゼンテーション属性/内蔵<style>クラス
// いずれで指定されていてもツールを問わず正しく解決できる。
function _tmplHasVisibleStroke(el) {
    const cs = getComputedStyle(el);
    const stroke = cs.stroke;
    if (!stroke || stroke === 'none') return false;
    const opacity = parseFloat(cs.strokeOpacity);
    if (!Number.isNaN(opacity) && opacity <= 0) return false;
    const width = parseFloat(cs.strokeWidth);
    if (!Number.isNaN(width) && width <= 0) return false;
    return true;
}

// 図形要素をルートSVGのユーザー座標系（viewBox基準）における "x,y x,y ..." 文字列へ変換する。
// getCTM()はその要素自身のtransform属性＋祖先<g>のtransformを全て解決した、
// 最も近い祖先ビューポート（＝ルートsvg）の座標系への変換行列を返す。
function _tmplShapeToPointsStr(el) {
    const localPts = _tmplLocalShapePoints(el);
    if (!localPts || localPts.length < 2) return '';

    const svgRoot = el.ownerSVGElement;
    const ctm = el.getCTM ? el.getCTM() : null;
    if (!ctm || !svgRoot || !svgRoot.createSVGPoint) {
        return localPts.map(p => `${_tmplRound(p.x)},${_tmplRound(p.y)}`).join(' ');
    }

    const svgPt = svgRoot.createSVGPoint();
    return localPts.map(p => {
        svgPt.x = p.x;
        svgPt.y = p.y;
        const transformed = svgPt.matrixTransform(ctm);
        return `${_tmplRound(transformed.x)},${_tmplRound(transformed.y)}`;
    }).join(' ');
}

function _tmplRound(n) {
    return Math.round(n * 1000) / 1000;
}

// 各図形タグごとに、その要素自身のローカル座標系（transform適用前）での頂点列を返す。
// path曲線（ベジェ/円弧）はgetPointAtLength()でサンプリングして多角形近似する。
function _tmplLocalShapePoints(el) {
    const tag = el.tagName.toLowerCase();
    switch (tag) {
        case 'polygon':
        case 'polyline':
            return _tmplParsePointsAttr(el.getAttribute('points') || '');
        case 'rect': {
            const x = parseFloat(el.getAttribute('x') || '0');
            const y = parseFloat(el.getAttribute('y') || '0');
            const w = parseFloat(el.getAttribute('width') || '0');
            const h = parseFloat(el.getAttribute('height') || '0');
            if (!(w > 0) || !(h > 0)) return null;
            return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
        }
        case 'circle':
        case 'ellipse': {
            const cx = parseFloat(el.getAttribute('cx') || '0');
            const cy = parseFloat(el.getAttribute('cy') || '0');
            const rx = parseFloat(el.getAttribute(tag === 'circle' ? 'r' : 'rx') || '0');
            const ry = parseFloat(el.getAttribute(tag === 'circle' ? 'r' : 'ry') || '0');
            if (!(rx > 0) || !(ry > 0)) return null;
            const segments = 48;
            const pts = [];
            for (let i = 0; i < segments; i++) {
                const a = (i / segments) * Math.PI * 2;
                pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
            }
            return pts;
        }
        case 'path':
            return _tmplFlattenPath(el);
        default:
            return null;
    }
}

function _tmplParsePointsAttr(str) {
    const nums = str.trim().split(/[\s,]+/).map(Number).filter(n => Number.isFinite(n));
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
    return pts;
}

// M/L/H/V/Zのコマンド境界（=直線区間の頂点）を数値として直接算出することで、
// 等間隔サンプリングでは避けられない「角が斜めに削れる」現象を防ぐ。
// C/S/Q/T/A（曲線）は、そのコマンド1個分だけを含む一時的な<path>をブラウザに解釈させ、
// getTotalLength/getPointAtLengthでフラット化する（曲線の数式を自前実装しない）。
// 直線区間の頂点は常に厳密な座標になり、曲線⇔直線の境界も一時pathの始点・終点として
// 厳密に一致するため、角の崩れが起きない。
const _TMPL_PATH_CMD_RE = /[MmLlHhVvCcSsQqTtAaZz][^MmLlHhVvCcSsQqTtAaZz]*/g;
const _TMPL_PATH_NUM_RE = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

function _tmplFlattenPath(pathEl) {
    const d = pathEl.getAttribute('d') || '';
    try {
        const pts = _tmplParsePathD(d);
        if (pts && pts.length >= 2) return pts;
    } catch { /* フォールバックへ */ }

    // 万一パースできない特殊なd属性の場合は、従来の等間隔サンプリングにフォールバックする。
    let total;
    try { total = pathEl.getTotalLength(); } catch { return null; }
    if (!(total > 0) || !Number.isFinite(total)) return null;
    const steps = Math.min(128, Math.max(4, Math.ceil(total / 15)));
    const pts = [];
    for (let i = 0; i <= steps; i++) {
        const p = pathEl.getPointAtLength((total * i) / steps);
        pts.push({ x: p.x, y: p.y });
    }
    return pts;
}

function _tmplParsePathD(d) {
    const chunks = d.trim().match(_TMPL_PATH_CMD_RE) || [];
    const pts = [];
    let cx = 0, cy = 0, startX = 0, startY = 0;
    const pushPt = (x, y) => { pts.push({ x, y }); cx = x; cy = y; };

    for (const chunk of chunks) {
        const cmd = chunk[0];
        const type = cmd.toUpperCase();
        const abs = cmd === type;
        const rest = chunk.slice(1);

        if (type === 'Z') { cx = startX; cy = startY; continue; }

        if (type === 'M' || type === 'L') {
            const nums = rest.match(_TMPL_PATH_NUM_RE) || [];
            for (let i = 0; i + 1 < nums.length; i += 2) {
                let x = parseFloat(nums[i]), y = parseFloat(nums[i + 1]);
                if (!abs) { x += cx; y += cy; }
                pushPt(x, y);
                if (type === 'M' && i === 0) { startX = x; startY = y; }
            }
            continue;
        }

        if (type === 'H') {
            for (const n of (rest.match(_TMPL_PATH_NUM_RE) || [])) {
                let x = parseFloat(n);
                if (!abs) x += cx;
                pushPt(x, cy);
            }
            continue;
        }

        if (type === 'V') {
            for (const n of (rest.match(_TMPL_PATH_NUM_RE) || [])) {
                let y = parseFloat(n);
                if (!abs) y += cy;
                pushPt(cx, y);
            }
            continue;
        }

        // C/S/Q/T/A: このコマンド分だけの一時pathを作り、ブラウザにフラット化させる。
        // 暗黙の繰り返し（例: "C x1,y1 x2,y2 x,y x1,y1 x2,y2 x,y"）は境界が滑らかに
        // 繋がる前提のため、まとめて1本のセグメントとして扱って問題ない。
        const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        tmp.setAttribute('d', `M ${cx},${cy} ${cmd}${rest}`);
        const total = tmp.getTotalLength();
        if (total > 0) {
            const steps = Math.min(64, Math.max(4, Math.ceil(total / 8)));
            for (let i = 1; i <= steps; i++) {
                const p = tmp.getPointAtLength((total * i) / steps);
                pts.push({ x: p.x, y: p.y });
            }
            const endPt = tmp.getPointAtLength(total);
            cx = endPt.x; cy = endPt.y;
        }
    }

    return pts;
}

// svgTextが<polygon>要素を1つでも含むかどうか（安価な事前チェック用）。
// _prepareTemplateSvgDocForPage・線幅変更処理は<polygon>要素しか見ないため、
// 元のsvgContentを安全にそのまま使えるのは「全コマがpolygonである」場合のみ。
// 一部のコマだけrect/pathで残りがpolygon、という混在テンプレート（例: 直線のコマはrect、
// 曲線を含むコマだけpolygonでエクスポートするツール）で「polygonが1つでもあれば元のまま使う」
// という判定にしていると、rect/path側のコマがpolygon限定の処理から漏れて
// 枠線非表示・線幅変更が一部のコマにしか効かなくなる（2026-08-13発覚）。
function _tmplSvgHasEnoughPolygons(svgText, minCount) {
    if (!svgText) return false;
    try {
        return new DOMParser().parseFromString(svgText, 'image/svg+xml').querySelectorAll('polygon').length >= minCount;
    } catch { return false; }
}

// テンプレートのコマ形状（panels[].points / basePanelPoints）から、
// _tmplWizBuildSvgString と同じ構造（白背景rect + panel_0 + panel_N のpolygon）のSVG文字列を合成する。
// rect/path等、<polygon>を含まない形式で読み込まれたテンプレートをページ化する際、
// _prepareTemplateSvgDocForPage や _scaleSvgElementTree（いずれもpolygon前提の処理を含む）に
// 安全に渡せる正規化済みSVGを用意するためのフォールバック。
// ※<polygon>を既に含むテンプレート（従来のCorelDraw出力・ウィザード生成など）はこの合成を経由せず、
//   元のsvgContent（独自の色・装飾等を含む）をそのまま使うため、既存の見た目に影響しない。
function _tmplTemplateToPageSvgString(templateRecord) {
    const w = templateRecord.width;
    const h = templateRecord.height;
    const strokeWidth = Math.max(4, w * 0.003);
    const base = templateRecord.basePanelPoints || `0,0 ${w},0 ${w},${h} 0,${h}`;
    const parts = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">`);
    parts.push(`  <rect x="0" y="0" width="${w}" height="${h}" fill="#ffffff"/>`);
    parts.push(`  <polygon id="panel_0" points="${base}" fill="none" stroke="#000" stroke-width="${strokeWidth}"/>`);
    [...(templateRecord.panels || [])].sort((a, b) => a.number - b.number).forEach(p => {
        parts.push(`  <polygon id="panel_${p.number}" points="${p.points}" fill="none" stroke="#000" stroke-width="${strokeWidth}"/>`);
    });
    parts.push('</svg>');
    return parts.join('\n');
}

// ページ生成時、テンプレートの元svgContentをそのまま使うか判定する。
// 全コマ（panel_0＋panels全て）がpolygonでない（rect/path等が1つでも混ざる、
// または全く含まない）テンプレートは合成SVGにフォールバックする。
function _tmplResolveTemplateSvgForPage(templateRecord) {
    const requiredPolygonCount = (templateRecord.panels || []).length + 1; // +1 = panel_0分
    return _tmplSvgHasEnoughPolygons(templateRecord.svgContent, requiredPolygonCount)
        ? templateRecord.svgContent
        : _tmplTemplateToPageSvgString(templateRecord);
}

/**
 * テンプレートSVGをページ用に整形する。
 * コマ番号テキスト（<text>要素）を除去し、panel_0（最初のpolygon）の枠線を非表示にする。
 * @returns {{ svgDoc: Document, polygons: NodeListOf<SVGPolygonElement> }}
 */
// class等のCSSより確実に優先させるため、プレゼンテーション属性だけでなく
// インラインstyle（CSS優先順位が最も高い）にも同じ値を設定する。
// CorelDraw等、<defs><style>内のクラス指定（例: .str0{stroke:black;stroke-width:35.27}）で
// ストロークを定義するツールの出力では、プレゼンテーション属性だけでは
// 上書きできない（CSS優先度: クラスセレクタ > プレゼンテーション属性）。
function _tmplForceInlineStyle(el, props) {
    Object.entries(props).forEach(([k, v]) => el.setAttribute(k, v));
    let newStyle = el.getAttribute('style') || '';
    Object.keys(props).forEach(k => {
        newStyle = newStyle.replace(new RegExp(`${k}\\s*:[^;]+;?`, 'gi'), '');
    });
    newStyle = newStyle.trim();
    const forced = Object.entries(props).map(([k, v]) => `${k}: ${v}`).join('; ');
    el.setAttribute('style', newStyle ? `${newStyle}; ${forced};` : `${forced};`);
}

function _prepareTemplateSvgDocForPage(svgContent) {
    const svgDoc = new DOMParser().parseFromString(svgContent, 'image/svg+xml');
    svgDoc.querySelectorAll('text').forEach(el => el.remove());
    const polygons = svgDoc.querySelectorAll('polygon');
    if (polygons.length > 0) {
        _tmplForceInlineStyle(polygons[0], { stroke: 'none', 'stroke-width': '0' });
    }
    return { svgDoc, polygons };
}

export {
    TMPLWIZ_DEFAULT, _TMPLWIZ_LS_GRID, _prepareTemplateSvgDocForPage, _tmplGetFrameWidth,
    _tmplResolveTemplateSvgForPage, _tmplForceInlineStyle,
    _tmplGroupsRefreshUI, _tmplSidePanelUpdate, _tmplWiz, _tmplWizAttachCanvasEvents,
    _tmplWizBuildSvgString, _tmplWizCanvasMouseDown, _tmplWizCanvasMouseMove, _tmplWizCanvasMouseUp,
    _tmplWizClientToSvg, _tmplWizCommitCut, _tmplWizComputeInitialPanels, _tmplWizCreateBase,
    _tmplWizDetachCanvasEvents, _tmplWizFindPanelIndexForCut, _tmplWizLoadGridSettings,
    _tmplWizOrderPanels, _tmplWizRender, _tmplWizRenderGrid, _tmplWizReset, _tmplWizSave,
    _tmplWizSaveGridSettings, _tmplWizSetCutMode, _tmplWizSetOrientation, _tmplWizSetOrientationButtons,
    _tmplWizShowStep, _tmplWizSnapPoint, _tmplWizSyncGridControls, _tmplWizUndo,
    closeTemplateWizard, deleteTemplate, openTemplateWizard, parseSVGForTemplate,
    renameTemplate, renderTemplateList, selectTemplate,
};

// まだESM化されていない main/以下の classic <script> から呼べるようにするブリッジ
// （ESモジュール化移行中の一時措置。全分割ファイルのESM化が完了したら、
//  各呼び出し元をimport文に置き換えてこのブロックごと削除する）。
window.renderTemplateList = renderTemplateList;
window.openTemplateWizard = openTemplateWizard;
window.closeTemplateWizard = closeTemplateWizard;
window.renameTemplate = renameTemplate;
window.deleteTemplate = deleteTemplate;
window.parseSVGForTemplate = parseSVGForTemplate;

