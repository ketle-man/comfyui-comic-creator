// ============================================================
// テンプレート作成ウィザード 分割ファイル (3/3): テンプレート作成ウィザード(ライン分割方式)
// 元 06-template-wizard.js（分割前）の行 1012-1713 に相当
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: TMPLWIZ_DEFAULT,_TMPLWIZ_LS_GRID,_prepareTemplateSvgDocForPage,_tmplGroupsRefreshUI,_tmplSidePanelUpdate,_tmplWiz,_tmplWizAttachCanvasEvents,_tmplWizBuildSvgString,_tmplWizCanvasMouseDown,_tmplWizCanvasMouseMove,_tmplWizCanvasMouseUp,_tmplWizClientToSvg,_tmplWizCommitCut,_tmplWizComputeInitialPanels,_tmplWizCreateBase,_tmplWizDetachCanvasEvents,_tmplWizFindPanelIndexForCut,_tmplWizLoadGridSettings,_tmplWizOrderPanels,_tmplWizRender,_tmplWizRenderGrid,_tmplWizReset,_tmplWizSave,_tmplWizSaveGridSettings,_tmplWizSetCutMode,_tmplWizSetOrientation,_tmplWizSetOrientationButtons,_tmplWizShowStep,_tmplWizSnapPoint,_tmplWizSyncGridControls,_tmplWizUndo,closeTemplateWizard,deleteTemplate,openTemplateWizard,parseSVGForTemplate,renameTemplate,renderTemplateList,selectTemplate
// ============================================================

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

/** テンプレートのコマ枠線幅をsvgContentから抽出する（panel_0はページベースなので2番目以降を優先） */
function _tmplGetFrameWidth(template) {
    if (!template.svgContent) return null;
    try {
        const doc = new DOMParser().parseFromString(template.svgContent, 'image/svg+xml');
        const polys = doc.querySelectorAll('polygon');
        const target = polys[1] || polys[0];
        if (!target) return null;
        let sw = target.getAttribute('stroke-width');
        if (!sw) {
            const m = (target.getAttribute('style') || '').match(/stroke-width\s*:\s*([\d.]+)/);
            if (m) sw = m[1];
        }
        const v = parseFloat(sw);
        return isNaN(v) ? null : Math.round(v * 10) / 10;
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

// SVG解析ロジック（変更なし）
function parseSVGForTemplate(svgText, filename) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');

    if (!svgEl) throw new Error(t('tmpl.errNoSvg'));

    const viewBoxAttr = svgEl.getAttribute('viewBox');
    if (!viewBoxAttr) throw new Error(t('tmpl.errNoViewBox'));

    const viewBox = viewBoxAttr.split(' ').map(Number);
    const width = viewBox[2];
    const height = viewBox[3];

    const panels = [];
    const polygons = doc.querySelectorAll('polygon');
    let basePanelPoints = '';   // panel_0のpolygon座標（オーバーレイのクリップ範囲）

    polygons.forEach((poly, index) => {
        let id = poly.id;
        if (!id) id = `panel_${index}`;

        // panel_0はページベースとして扱い、コマに含めない（オーバーレイのクリップ範囲として保存）
        if (index === 0 || id === 'panel_0') {
            basePanelPoints = poly.getAttribute('points').trim();
            return;
        }

        const points = poly.getAttribute('points').trim();
        let number = index;
        const match = id.match(/panel_(\d+)/);
        if (match) number = parseInt(match[1]);

        panels.push({ id, number, points });
    });

    if (panels.length === 0) throw new Error(t('tmpl.errNoPanels'));

    panels.sort((a, b) => a.number - b.number);

    return { id: filename, name: filename, width, height, panels, basePanelPoints };
}

/**
 * テンプレートSVGをページ用に整形する。
 * コマ番号テキスト（<text>要素）を除去し、panel_0（最初のpolygon）の枠線を非表示にする。
 * @returns {{ svgDoc: Document, polygons: NodeListOf<SVGPolygonElement> }}
 */
function _prepareTemplateSvgDocForPage(svgContent) {
    const svgDoc = new DOMParser().parseFromString(svgContent, 'image/svg+xml');
    svgDoc.querySelectorAll('text').forEach(el => el.remove());
    const polygons = svgDoc.querySelectorAll('polygon');
    if (polygons.length > 0) {
        const panel0 = polygons[0];
        panel0.setAttribute('stroke', 'none');
        panel0.setAttribute('stroke-width', '0');
        // style属性内のstrokeも除去
        const styleAttr = panel0.getAttribute('style') || '';
        if (styleAttr) {
            const newStyle = styleAttr
                .replace(/stroke\s*:[^;]+;?/g, '')
                .replace(/stroke-width\s*:[^;]+;?/g, '')
                .trim();
            if (newStyle) {
                panel0.setAttribute('style', newStyle + '; stroke: none; stroke-width: 0;');
            } else {
                panel0.setAttribute('style', 'stroke: none; stroke-width: 0;');
            }
        }
    }
    return { svgDoc, polygons };
}

