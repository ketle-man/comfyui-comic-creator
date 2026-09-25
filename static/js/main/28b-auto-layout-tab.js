// ============================================================
// main.js 分割ファイル (追加): Autoタブ「オートレイアウト」サブタブ
// type="module" として読み込まれる。主なトップレベル定義: initAutoLayoutSubtab
//
// 脚本（auto.work.script.pages[].panels[]）から、重要度按分の再帰二分割
// （../auto-layout-core.js、DOM非依存）でコマ割りを自動生成してプレビュー表示し、
// フキダシ・画像コマ単位で割り当ててから「詳細編集」で既存のレイアウトタブへ転送する。
// 転送先のページ生成・フキダシ流し込みは、半自動マンガ作成（26-auto-comic-bridge.js）と
// 同じ既存関数（createBalloonAtPosition/applyBubbleTextToShape/insertImage等）を再利用する。
// 作品データ（auto.work）自体は28-auto-tab.jsが所有し、このファイルは
// getAutoWork/saveAutoWork 経由で読み書きする（循環import、PLAN_auto_tab.md参照）。
// ============================================================

import { t } from '../i18n.js';
import { getAutoWork, saveAutoWork } from './28-auto-tab.js';
import { LAYOUT_STYLES, READING_ORDERS, bubbleTypeToBalloonShape, quadsToPageLayout, contentAreaFromMargins, layoutPanels, splitQuadManual, quadToPagePoints } from '../auto-layout-core.js';
import { blankDialogue, BUBBLE_TYPES } from '../auto-story-core.js';
import { generateAutoImage } from './28a-auto-image.js';
import { loadAiSettings, validateAiSettings } from '../auto-ai-client.js';
import { state, switchTab } from './01-state.js';
import { dbGet, dbPut } from './00-db.js';
import { loadPages, renderLayoutTab, renderPageSelector, updateLayoutPageNav, pushHistory } from './07-pages.js';
import { getPanelLayerSvg } from './04b-layer-panel-render.js';
import { createBalloonAtPosition } from './09c-balloon-handles.js';
import { applyBubbleTextToShape, BUBBLE_TEXT_PT_TO_SVG } from './09f-bubble-text.js';
import { getBoundingBoxFromPoints, insertImage } from './08-panels-images.js';
import { mapScriptPageToPanels } from '../auto-comic-core.js';
import { _tmplAutoStage, loadTemplates, savePageAsTemplate } from './06b-template-manager.js';
import { _pageMgrGroups } from './11b-page-manager-tab.js';
import { _workMeta, _workSetActive, renderWorkList, _workSizePresetList, _workSizePresets } from './11a-work-manager.js';

const $ = (id) => document.getElementById(id);

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function setStatus(id, kind, text) {
    const el = $(id);
    if (!el) return;
    el.className = 'auto-status' + (kind ? ' ' + kind : '');
    el.textContent = text || '';
}

// validateAiSettings()のエラーコード → 表示メッセージ（28-auto-tab.jsのsettingsProblemMessageと同じ変換）
function settingsProblemMessage(code) {
    return { noModel: t('auto.errNoModel'), invalidUrl: t('auto.errInvalidUrl'), noGeminiModel: t('auto.errNoGeminiModel') }[code] || code;
}

// 表示用の基準スケール（work.layout.pageWidth pxを、だいたいこの幅で表示する。zoomで倍率をかける）
const PREVIEW_BASE_WIDTH = 340;

const alo = {
    inited: false,
    leftTab: 'page',
    tool: 'select',
    zoom: 1,
    pageIndex: 0,
    selectedPanel: null,       // 現在ページ内のコマindex
    pages: [],                 // pages[i] = { quads: [[{x,y}x4]...] } | { template: templateRecord }
    busy: false,
    lastWorkId: null,          // 作品バーで別の作品に切り替えたら pages キャッシュを破棄するための追跡
    seedBase: null,            // asymmetric/diagonalスタイルの疑似乱数シード基点。「生成」ボタンを
                               // 押すたびに新しい値へ更新し、押すたび毎回違うレイアウトになるようにする
                               // （作品データ＝生成結果のquadsは保存・再利用するが、このシード自体は
                               // 保存しない。ページ送り等での再生成はこの値を使い回して一貫性を保つ）
};

function newSeedBase() {
    return Math.random().toString(36).slice(2);
}

function work() { return getAutoWork(); }
function scriptPages() { return work().script.pages; }
function currentScriptPage() { return scriptPages()[alo.pageIndex] || null; }
function currentPageState() { return alo.pages[alo.pageIndex] || null; }

// layoutPanels()へ渡す軸判定用の寸法は、外側余白を除いた「コマ配置領域」のもの
// （contentAreaFromMargins()、auto-layout-core.js）でなければならない
function layoutOptsFor(L) {
    const content = contentAreaFromMargins(L);
    return { style: L.style, readingOrder: L.readingOrder, pageWidth: content.width, pageHeight: content.height };
}

// ============================================================
// レイアウト生成（プレビュー用、DBへはまだ書き込まない）
// ============================================================

function generateAllPages() {
    const pages = scriptPages();
    const L = work().layout;
    const opts = layoutOptsFor(L);
    // 「生成」ボタンを押すたびに新しいシード基点を採番し、押すたび毎回違うレイアウトになるようにする
    alo.seedBase = newSeedBase();
    alo.pages = pages.map((scriptPage, i) => ({
        quads: layoutPanels(scriptPage.panels, opts, `${work().id}:${i}:${alo.seedBase}`),
    }));
    alo.pageIndex = Math.min(alo.pageIndex, Math.max(0, pages.length - 1));
    alo.selectedPanel = null;
}

// 脚本が他タブ（脚本エディタ）で編集されコマ数が変わっていたら、そのページだけ作り直す
function ensurePageLayoutFresh() {
    const scriptPage = currentScriptPage();
    if (!scriptPage) return;
    const st = alo.pages[alo.pageIndex];
    if (st?.template) return; // テンプレート指定ページはコマ数不一致を許容（警告表示のみ）
    if (st && st.quads.length === scriptPage.panels.length) return;
    const L = work().layout;
    if (!alo.seedBase) alo.seedBase = newSeedBase();
    alo.pages[alo.pageIndex] = { quads: layoutPanels(scriptPage.panels, layoutOptsFor(L), `${work().id}:${alo.pageIndex}:${alo.seedBase}`) };
}

// ============================================================
// 左ペイン: ページ設定・テンプレート・詳細設定
// ============================================================

// ── ページサイズプリセット（ページタブ「新規作成」ダイアログ、11a-work-manager.jsと同じ
// 標準プリセット・カスタムプリセット(localStorage 'work_size_presets')を共有して使う） ──

function _sizePresetFromValue(value) {
    if (value?.startsWith('std:')) return _workSizePresetList()[parseInt(value.slice(4), 10)] || null;
    if (value?.startsWith('custom:')) return _workSizePresets.load()[parseInt(value.slice(7), 10)] || null;
    return null;
}

function _findMatchingSizePresetValue(width, height) {
    const stdIdx = _workSizePresetList().findIndex((p) => p.width === width && p.height === height);
    if (stdIdx >= 0) return `std:${stdIdx}`;
    const customIdx = _workSizePresets.load().findIndex((p) => p.width === width && p.height === height);
    if (customIdx >= 0) return `custom:${customIdx}`;
    return 'custom';
}

function _updateSizePresetDeleteBtn() {
    const sel = $('alo-size-preset');
    const delBtn = $('alo-size-preset-delete');
    if (delBtn) delBtn.style.display = sel?.value.startsWith('custom:') ? '' : 'none';
}

function renderSizePresetSelect(selectedValue) {
    const sel = $('alo-size-preset');
    sel.innerHTML = '';
    _workSizePresetList().forEach((p, i) => {
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
    sel.value = (selectedValue && [...sel.options].some((o) => o.value === selectedValue)) ? selectedValue : 'std:0';
    _updateSizePresetDeleteBtn();
}

function onSizePresetChange() {
    const p = _sizePresetFromValue($('alo-size-preset').value);
    if (p) {
        $('alo-page-width').value = p.width;
        $('alo-page-height').value = p.height;
    }
    _updateSizePresetDeleteBtn();
}

// 幅・高さを直接編集したらプリセット選択をカスタムに切り替える（work-dlgと同じ挙動）
function onSizeFieldInput() {
    const sel = $('alo-size-preset');
    const p = _sizePresetFromValue(sel.value);
    if (!p) return;
    const w = parseInt($('alo-page-width').value, 10);
    const h = parseInt($('alo-page-height').value, 10);
    if (p.width !== w || p.height !== h) {
        sel.value = 'custom';
        _updateSizePresetDeleteBtn();
    }
}

function onSizePresetSave() {
    const width = parseInt($('alo-page-width').value, 10);
    const height = parseInt($('alo-page-height').value, 10);
    if (!(width > 0 && height > 0)) { alert(t('page.msgInvalidSize')); return; }
    const name = prompt(t('page.promptPresetName'), `${width}×${height}`)?.trim();
    if (!name) return;
    const list = _workSizePresets.load();
    list.push({ name, width, height });
    _workSizePresets.save(list);
    renderSizePresetSelect(`custom:${list.length - 1}`);
}

function onSizePresetDelete() {
    const sel = $('alo-size-preset');
    if (!sel?.value.startsWith('custom:')) return;
    const idx = parseInt(sel.value.slice(7), 10);
    const list = _workSizePresets.load();
    if (!list[idx]) return;
    if (!confirm(t('page.confirmDeletePreset', list[idx].name))) return;
    list.splice(idx, 1);
    _workSizePresets.save(list);
    renderSizePresetSelect();
}

// ── 外側余白「均等」チェック: ONの間は上下左右を連動させ、まとめて1つの値として編集できる ──

const MARGIN_IDS = ['alo-margin-top', 'alo-margin-bottom', 'alo-margin-left', 'alo-margin-right'];

function updateMarginUniformFieldsState() {
    const uniform = $('alo-margin-uniform').checked;
    // 「上」欄だけ常に編集可能にし、そこへの入力を他の3つへ伝える（他はONの間読み取り専用）
    ['alo-margin-bottom', 'alo-margin-left', 'alo-margin-right'].forEach((id) => { $(id).disabled = uniform; });
}

function onMarginUniformChange() {
    if ($('alo-margin-uniform').checked) {
        const v = $('alo-margin-top').value;
        MARGIN_IDS.slice(1).forEach((id) => { $(id).value = v; });
    }
    updateMarginUniformFieldsState();
}

function onMarginTopInput() {
    if (!$('alo-margin-uniform').checked) return;
    const v = $('alo-margin-top').value;
    MARGIN_IDS.slice(1).forEach((id) => { $(id).value = v; });
}

function renderLeftSettings() {
    const L = work().layout;
    $('alo-page-width').value = L.pageWidth;
    $('alo-page-height').value = L.pageHeight;
    renderSizePresetSelect(_findMatchingSizePresetValue(L.pageWidth, L.pageHeight));
    $('alo-style-select').value = L.style;
    document.querySelectorAll('input[name="alo-reading-order"]').forEach((r) => { r.checked = r.value === L.readingOrder; });
    $('alo-gap').value = L.gapPx;
    $('alo-margin-top').value = L.marginTop;
    $('alo-margin-bottom').value = L.marginBottom;
    $('alo-margin-left').value = L.marginLeft;
    $('alo-margin-right').value = L.marginRight;
    $('alo-margin-uniform').checked = L.marginTop === L.marginBottom && L.marginTop === L.marginLeft && L.marginTop === L.marginRight;
    updateMarginUniformFieldsState();
    $('alo-font-family').value = L.fontFamily;
    $('alo-font-size').value = L.fontSizePt;
    $('alo-stroke-width').value = L.strokeWidth;
}

function switchLeftTab(name) {
    alo.leftTab = name;
    document.querySelectorAll('[data-alo-left]').forEach((btn) => btn.classList.toggle('active', btn.dataset.aloLeft === name));
    ['page', 'template', 'detail'].forEach((key) => { $('alo-left-' + key).style.display = key === name ? '' : 'none'; });
    if (name === 'template') renderTemplateList();
}

// テンプレート数が増えるとここに一覧表示しきれなくなるため、一覧の閲覧・管理は
// ページタブのテンプレートに集約し、ここでは「送信」された1件のみを表示する
// （送信操作自体はページタブ側の各テンプレートカードの「オートレイアウトへ送信」ボタン）。
async function renderTemplateList(refresh) {
    if (refresh || !Array.isArray(state.templates)) {
        try { await loadTemplates(); } catch (e) { setStatus('alo-template-status', 'error', e.message); }
    }
    const box = $('alo-template-staged');
    const stagedName = _tmplAutoStage.get();
    const tpl = stagedName ? (state.templates || []).find((x) => x.name === stagedName) : null;
    if (!tpl) {
        box.innerHTML = `<div class="auto-empty">${esc(t('alo.templateStagedEmpty'))}</div>`;
        return;
    }
    const scriptPage = currentScriptPage();
    const panelCount = scriptPage ? scriptPage.panels.length : 0;
    const activeName = currentPageState()?.template?.name || '';
    const count = Array.isArray(tpl.panels) ? tpl.panels.length : 0;
    const mismatch = panelCount && count !== panelCount;
    box.innerHTML = `<div class="alo-template-item${tpl.name === activeName ? ' active' : ''}${mismatch ? ' mismatch' : ''}" data-name="${esc(tpl.name)}">
        <span>${esc(tpl.name)}</span><span>${esc(t('alo.templatePanelCount', count))}${mismatch ? ' ' + esc(t('alo.templateMismatchMark', panelCount)) : ''}</span>
    </div>`;
}

// オートレイアウトに現在表示中のページ（レイアウトタブへ転送する前の、このプレビュー画面の
// コマ割り）を、ページタブのテンプレートとして保存する。転送済みのレイアウトタブ側の
// ページ（state.activePage）とは無関係（フキダシ・画像はまだ実体化されていないため、
// 保存されるのはコマの枠のみになる＝テンプレートウィザードで作るものと同じ形）。
async function onSavePageAsTemplate() {
    const st = currentPageState();
    if (!st) { setStatus('alo-template-status', 'error', t('alo.templateSaveNoPage')); return; }

    let panels, svgContent;
    const { width, height } = pageDims();
    if (st.template) {
        panels = JSON.parse(JSON.stringify(st.template.panels || []));
        svgContent = st.template.svgContent;
    } else {
        const built = quadsToPageLayout(st.quads, work().layout);
        panels = built.panels;
        svgContent = built.svgContent;
    }

    const defaultName = `${work().name || t('auto.workUntitled')}_p${alo.pageIndex + 1}_tmpl`;
    const name = prompt(t('tmpl.namePrompt'), defaultName)?.trim();
    if (!name) return;
    if (await dbGet('templates', name) && !confirm(t('tmpl.confirmOverwrite', name))) return;
    try {
        await savePageAsTemplate({ width, height, panels, svgContent, basePanelPoints: '', overlaySvgContent: '' }, name);
        await loadTemplates();
        renderTemplateList();
        setStatus('alo-template-status', 'ok', t('tmpl.created', name));
    } catch (e) {
        console.error('[AutoLayout] save page as template error:', e);
        setStatus('alo-template-status', 'error', t('tmpl.createFailed', e.message || String(e)));
    }
}

function onTemplatePick(name) {
    const tpl = (state.templates || []).find((x) => x.name === name);
    if (!tpl) return;
    alo.pages[alo.pageIndex] = { template: tpl };
    alo.selectedPanel = null;
    renderTemplateList();
    renderCanvas();
    renderPageNav();
}

// このページのテンプレート指定を解除して自動生成へ戻す。あわせて「送信」状態自体も解除する
// （送信の解除専用ボタンは持たない方針のため、別のテンプレートを送信し直すか、ここで解除する）。
function onTemplateClear() {
    ensurePageLayoutFreshForce();
    _tmplAutoStage.clear();
    renderTemplateList();
    renderCanvas();
    renderPageNav();
}

function ensurePageLayoutFreshForce() {
    const scriptPage = currentScriptPage();
    if (!scriptPage) return;
    const L = work().layout;
    if (!alo.seedBase) alo.seedBase = newSeedBase();
    alo.pages[alo.pageIndex] = { quads: layoutPanels(scriptPage.panels, layoutOptsFor(L), `${work().id}:${alo.pageIndex}:${alo.seedBase}`) };
}

// ページ設定タブの内容（サイズ・スタイル・読み順・コマ間余白・外側余白）を保存する。
// 「生成（全ページ）」ボタンから呼ばれる（コマ割りの計算に使う値のため、生成に伴って保存する）。
function onSavePageSettings() {
    const w = work();
    w.layout.pageWidth = Math.max(200, parseInt($('alo-page-width').value, 10) || w.layout.pageWidth);
    w.layout.pageHeight = Math.max(200, parseInt($('alo-page-height').value, 10) || w.layout.pageHeight);
    w.layout.style = LAYOUT_STYLES.includes($('alo-style-select').value) ? $('alo-style-select').value : w.layout.style;
    const ro = document.querySelector('input[name="alo-reading-order"]:checked')?.value;
    w.layout.readingOrder = READING_ORDERS.includes(ro) ? ro : w.layout.readingOrder;
    w.layout.gapPx = Math.max(0, parseInt($('alo-gap').value, 10) || 0);
    // 余白の入力ミス（桁が飛んだ大きすぎる値等）でコマ配置領域がページ外に出ないよう、
    // ページ幅・高さ自体を上限としてクランプする（下限側の厳密なクランプは
    // auto-layout-core.jsのcontentAreaFromMargins()がさらに行う）
    const clampMargin = (v, max) => Math.max(0, Math.min(parseInt(v, 10) || 0, max));
    w.layout.marginTop = clampMargin($('alo-margin-top').value, w.layout.pageHeight);
    w.layout.marginBottom = clampMargin($('alo-margin-bottom').value, w.layout.pageHeight);
    w.layout.marginLeft = clampMargin($('alo-margin-left').value, w.layout.pageWidth);
    w.layout.marginRight = clampMargin($('alo-margin-right').value, w.layout.pageWidth);
    saveAutoWork();
    // クランプで実際の保存値が入力欄と変わった場合に画面上も揃える
    $('alo-margin-top').value = w.layout.marginTop;
    $('alo-margin-bottom').value = w.layout.marginBottom;
    $('alo-margin-left').value = w.layout.marginLeft;
    $('alo-margin-right').value = w.layout.marginRight;
}

// 詳細設定タブの内容（既定フォント・既定サイズ・既定コマ枠線幅）を保存する。
// これらはコマ割りの計算には使わず転送時にのみ使う値のため、「生成」とは独立した
// 専用の保存ボタンを持つ（ユーザーが混同しないよう、生成ボタンはページ設定タブのみに置く）。
function onSaveDetailSettings() {
    const w = work();
    w.layout.fontFamily = $('alo-font-family').value;
    w.layout.fontSizePt = Math.max(6, parseInt($('alo-font-size').value, 10) || w.layout.fontSizePt);
    w.layout.strokeWidth = Math.max(0, parseInt($('alo-stroke-width').value, 10) || w.layout.strokeWidth);
    saveAutoWork();
    setStatus('alo-detail-status', 'ok', t('auto.msgSettingsSaved'));
}

// ============================================================
// 中央ペイン: プレビュー（SVG）
// ============================================================

function pageDims() {
    const st = currentPageState();
    if (st?.template) return { width: st.template.width, height: st.template.height };
    return { width: work().layout.pageWidth, height: work().layout.pageHeight };
}

function renderPageNav() {
    const pages = scriptPages();
    $('alo-page-label').textContent = `${pages.length ? alo.pageIndex + 1 : 0}/${pages.length}`;
    const scriptPage = currentScriptPage();
    $('alo-panel-count-label').textContent = scriptPage ? t('alo.panelCountLabel', scriptPage.panels.length) : '';
    $('alo-page-prev-btn').disabled = alo.pageIndex <= 0;
    $('alo-page-next-btn').disabled = alo.pageIndex >= pages.length - 1;
}

function renderCanvas() {
    const svg = $('alo-canvas');
    const scriptPage = currentScriptPage();
    const st = currentPageState();
    if (!scriptPage || !st) {
        svg.innerHTML = '';
        svg.removeAttribute('viewBox');
        return;
    }
    const { width, height } = pageDims();
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const scale = (PREVIEW_BASE_WIDTH / width) * alo.zoom;
    svg.style.width = `${Math.round(width * scale)}px`;
    svg.style.height = `${Math.round(height * scale)}px`;

    let pointsList;
    if (st.template) {
        // テンプレートは既にpx絶対座標＋自前の余白を持つため、追加のgapは適用しない
        pointsList = st.template.panels.map((p) => p.points);
    } else {
        const L = work().layout;
        const content = contentAreaFromMargins(L);
        pointsList = st.quads.map((q) => quadToPagePoints(q, content.width, content.height, L.gapPx, content.offsetX, content.offsetY));
    }

    // ページの実寸（0.01mm単位、数万オーダーのことがある）に対して視認できる大きさにする
    // （CSSの固定font-sizeだとテンプレートによっては極端に小さく/大きくなってしまうため）
    const numFontSize = Math.max(1, width / 55);
    svg.innerHTML = pointsList.map((points, i) => {
        const nums = points.trim().split(/\s+/).map((s) => s.split(',').map(Number));
        const cx = nums.reduce((s, p) => s + p[0], 0) / nums.length;
        const cy = nums.reduce((s, p) => s + p[1], 0) / nums.length;
        const selected = alo.selectedPanel === i ? ' selected' : '';
        return `<polygon class="alo-panel-rect${selected}" data-idx="${i}" points="${esc(points)}"></polygon>` +
               `<text class="alo-panel-num" data-idx="${i}" x="${cx}" y="${cy}" font-size="${numFontSize.toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${i + 1}</text>`;
    }).join('');
}

function onCanvasClick(e) {
    const idxAttr = e.target.closest('[data-idx]')?.dataset.idx;
    if (idxAttr === undefined) return;
    const idx = Number(idxAttr);
    const scriptPage = currentScriptPage();
    if (!scriptPage) return;

    if (alo.tool === 'split-v' || alo.tool === 'split-h') {
        const st = currentPageState();
        if (st?.template) { setStatus('alo-generate-status', 'error', t('alo.msgNoSplitOnTemplate')); return; }
        const axis = alo.tool === 'split-v' ? 'vertical' : 'horizontal';
        const [qa, qb] = splitQuadManual(st.quads[idx], { axis });
        st.quads.splice(idx, 1, qa, qb);
        const clone = JSON.parse(JSON.stringify(scriptPage.panels[idx]));
        scriptPage.panels.splice(idx + 1, 0, clone);
        saveAutoWork();
        alo.selectedPanel = idx;
        renderCanvas();
        renderPageNav();
        renderProperties();
        return;
    }

    alo.selectedPanel = idx;
    renderCanvas();
    renderProperties();
}

// ============================================================
// 右ペイン: プロパティ（選択コマのフキダシ・画像）
// ============================================================

let editingDialogueIdx = null;

function fillBubbleTypeSelect(sel, cur) {
    sel.innerHTML = BUBBLE_TYPES.map((v) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(t('auto.bubble.' + v))}</option>`).join('');
}

function renderProperties() {
    const scriptPage = currentScriptPage();
    const panel = scriptPage && alo.selectedPanel !== null ? scriptPage.panels[alo.selectedPanel] : null;
    editingDialogueIdx = null;
    $('alo-prop-dialogue-edit').style.display = 'none';
    if (!panel) {
        $('alo-prop-title').textContent = t('alo.propNoSelection');
        $('alo-prop-body').style.display = 'none';
        return;
    }
    $('alo-prop-title').textContent = t('alo.propSelectedPanel', alo.selectedPanel + 1);
    $('alo-prop-body').style.display = '';

    const sel = $('alo-prop-dialogue-select');
    if (!panel.dialogues.length) {
        sel.innerHTML = `<option value="">${esc(t('alo.dialogueNone'))}</option>`;
    } else {
        sel.innerHTML = panel.dialogues.map((d, i) => `<option value="${i}">${esc((d.character ? d.character + ': ' : '') + (d.text || t('alo.dialogueEmptyText')))}</option>`).join('');
    }

    $('alo-prop-image-prompt').value = $('alo-prop-image-prompt').dataset.panelIdx === String(alo.selectedPanel) ? $('alo-prop-image-prompt').value : (panel.action || '');
    $('alo-prop-image-prompt').dataset.panelIdx = String(alo.selectedPanel);
    const preview = $('alo-prop-image-preview');
    if (panel.imageUrl) { preview.src = panel.imageUrl; preview.style.display = ''; } else { preview.style.display = 'none'; }
    renderImageGallery();
}

function onDialogueEdit() {
    const scriptPage = currentScriptPage();
    const panel = scriptPage?.panels[alo.selectedPanel];
    const sel = $('alo-prop-dialogue-select');
    const idx = Number(sel.value);
    if (!panel || !panel.dialogues[idx]) return;
    editingDialogueIdx = idx;
    const d = panel.dialogues[idx];
    $('alo-prop-dialogue-character').value = d.character;
    $('alo-prop-dialogue-text').value = d.text;
    fillBubbleTypeSelect($('alo-prop-dialogue-bubbletype'), d.bubbleType);
    $('alo-prop-dialogue-edit').style.display = '';
}

function onDialogueAdd() {
    const scriptPage = currentScriptPage();
    const panel = scriptPage?.panels[alo.selectedPanel];
    if (!panel) return;
    panel.dialogues.push(blankDialogue());
    saveAutoWork();
    editingDialogueIdx = panel.dialogues.length - 1;
    renderProperties();
    const sel = $('alo-prop-dialogue-select');
    sel.value = String(editingDialogueIdx);
    onDialogueEdit();
}

function onDialogueSave() {
    const scriptPage = currentScriptPage();
    const panel = scriptPage?.panels[alo.selectedPanel];
    if (!panel || editingDialogueIdx === null || !panel.dialogues[editingDialogueIdx]) return;
    panel.dialogues[editingDialogueIdx] = {
        character: $('alo-prop-dialogue-character').value.trim(),
        text: $('alo-prop-dialogue-text').value.trim(),
        bubbleType: $('alo-prop-dialogue-bubbletype').value,
    };
    saveAutoWork();
    renderProperties();
}

function onDialogueDelete() {
    const scriptPage = currentScriptPage();
    const panel = scriptPage?.panels[alo.selectedPanel];
    if (!panel || editingDialogueIdx === null) return;
    panel.dialogues.splice(editingDialogueIdx, 1);
    saveAutoWork();
    renderProperties();
}

function renderImageGallery() {
    const box = $('alo-prop-image-gallery');
    const images = work().images;
    box.innerHTML = images.map((im) =>
        `<img src="${esc(im.url)}" data-url="${esc(im.url)}" title="${esc(im.prompt || '')}" loading="lazy" />`
    ).join('');
}

function onImageGalleryClick(e) {
    const url = e.target.closest('img[data-url]')?.dataset.url;
    if (!url) return;
    const scriptPage = currentScriptPage();
    const panel = scriptPage?.panels[alo.selectedPanel];
    if (!panel) return;
    panel.imageUrl = url;
    saveAutoWork();
    renderProperties();
}

function onImageClear() {
    const scriptPage = currentScriptPage();
    const panel = scriptPage?.panels[alo.selectedPanel];
    if (!panel) return;
    panel.imageUrl = '';
    saveAutoWork();
    renderProperties();
}

async function onImageGenerate() {
    const scriptPage = currentScriptPage();
    const panel = scriptPage?.panels[alo.selectedPanel];
    if (!panel) return;
    const prompt = $('alo-prop-image-prompt').value.trim();
    if (!prompt) { setStatus('alo-prop-image-status', 'error', t('alo.propImagePromptEmpty')); return; }
    const settings = loadAiSettings();
    const problem = validateAiSettings(settings);
    if (problem) { setStatus('alo-prop-image-status', 'error', settingsProblemMessage(problem)); return; }
    if (alo.busy) return;
    alo.busy = true;
    setStatus('alo-prop-image-status', 'busy', t('auto.imgGenerating'));
    try {
        const image = await generateAutoImage(settings, prompt);
        panel.imageUrl = image.url;
        saveAutoWork();
        renderProperties();
        setStatus('alo-prop-image-status', 'ok', t('auto.imgDone', image.filename));
    } catch (e) {
        console.error('[AutoLayout] image generate error:', e);
        setStatus('alo-prop-image-status', 'error', e.message || String(e));
    } finally {
        alo.busy = false;
    }
}

// ============================================================
// 転送処理: レイアウトタブへ全ページ転送
// ============================================================

function urlToDataUrl(url) {
    return fetch(url).then((res) => {
        if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
        return res.blob();
    }).then((blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    }));
}

function loadImageEl(dataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = dataUrl;
    });
}

async function insertBalloonsAndImages(scriptPage) {
    const { mapped } = mapScriptPageToPanels(scriptPage, state.activePage.panels);
    const L = work().layout;

    // 画像を先に挿入する。insertImage()は常にg[data-clip-panel]内の最後（＝最前面）に
    // <image>を追加するため、フキダシより先に処理しないと画像がフキダシの上に重なって
    // 隠してしまう（フキダシ同士が重なるのは許容、画像に隠れるのを避けたい）。
    for (const item of mapped) {
        const scriptPanel = scriptPage.panels[item.scriptPanelIndex];
        if (!scriptPanel?.imageUrl) continue;
        const panel = state.activePage.panels.find((p) => p.id === item.panelId);
        const bbox = panel?.points ? getBoundingBoxFromPoints(panel.points) : null;
        if (!bbox) continue;
        try {
            const dataUrl = await urlToDataUrl(scriptPanel.imageUrl);
            const img = await loadImageEl(dataUrl);
            state.selectedPanelId = item.panelId;
            state.selectedOverlay = false;
            await insertImage(dataUrl, img.width, img.height, { preserveAspectRatio: 'none' }, { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height });
        } catch (e) {
            console.error('[AutoLayout] image insert error for panel', item.panelId, e);
        }
    }

    // insertImage()内のrenderLayoutTab()でDOMが再構築されているため、
    // フキダシ追加の直前に最新のパネルレイヤーSVGを取得する
    const overlaySvgEl = getPanelLayerSvg();
    if (overlaySvgEl) {
        for (const item of mapped) {
            const dialogues = (item.dialogues || []).filter((d) => d.text && d.text.trim());
            if (!dialogues.length) continue;
            const panel = state.activePage.panels.find((p) => p.id === item.panelId);
            if (!panel?.points) continue;
            const bbox = getBoundingBoxFromPoints(panel.points);
            if (!bbox) continue;
            state.selectedPanelId = item.panelId;
            state.selectedOverlay = false;
            const slotHeight = bbox.height / dialogues.length;
            const rx = bbox.width * 0.35;
            const ry = Math.min(slotHeight * 0.35, bbox.height * 0.2);
            const fontSizePt = Math.max(20, Math.min(L.fontSizePt || state.balloon.fontSize, Math.round((ry * 0.55) / BUBBLE_TEXT_PT_TO_SVG)));
            for (let i = 0; i < dialogues.length; i++) {
                const cx = bbox.x + bbox.width / 2;
                const cy = bbox.y + slotHeight * (i + 0.5);
                const shapeType = bubbleTypeToBalloonShape(dialogues[i].bubbleType);
                const shape = createBalloonAtPosition(overlaySvgEl, shapeType, cx, cy, rx, ry);
                await applyBubbleTextToShape(shape, {
                    text: dialogues[i].text,
                    fontSizePt,
                    textAlign: 'center',
                    textValign: 'center',
                    fontFamily: L.fontFamily || state.balloon.fontFamily,
                    vertical: state.balloon.isVertical,
                    textColor: state.balloon.textColor,
                });
            }
        }
    }
}

async function transferAllPages() {
    const w = work();
    const pages = scriptPages();
    if (!pages.length) { setStatus('alo-transfer-status', 'error', t('alo.msgNoScript')); return; }
    if (!confirm(t('alo.confirmTransfer', pages.length))) return;
    if (alo.busy) return;
    alo.busy = true;
    $('alo-transfer-btn').disabled = true;
    setStatus('alo-transfer-status', 'busy', t('alo.msgTransferring'));
    try {
        const timestamp = Date.now();
        // 転送先の各ページを「作品」（ページ管理タブの作品一覧、11a-work-manager.js）としても
        // 登録する。これをしないとページ自体は作成・編集できるが作品一覧に出てこず見失いやすい。
        const workGroupName = `${w.name || t('auto.workUntitled')}_${timestamp}`;
        const groupCreated = _pageMgrGroups.createGroup(workGroupName);
        if (!groupCreated) console.warn('[AutoLayout] page group already exists, pages will not be listed as a work:', workGroupName);

        let firstPageRecord = null;
        for (let i = 0; i < pages.length; i++) {
            const scriptPage = pages[i];
            const st = alo.pages[i] && alo.pages[i].quads?.length === scriptPage.panels.length ? alo.pages[i]
                : (alo.pages[i]?.template ? alo.pages[i] : { quads: layoutPanels(scriptPage.panels, layoutOptsFor(w.layout), `${w.id}:${i}:${alo.seedBase || (alo.seedBase = newSeedBase())}`) });

            let pagePanels, svgContent, pageWidth, pageHeight;
            if (st.template) {
                pageWidth = st.template.width;
                pageHeight = st.template.height;
                pagePanels = JSON.parse(JSON.stringify(st.template.panels)).map((p) => ({ ...p, panelSvgContent: p.panelSvgContent || '' }));
                svgContent = st.template.svgContent;
            } else {
                // プレビューで確定した（手動「分割」ツールでの編集を含む）quadsをそのまま使う。
                // ここでlayoutPanels()を再実行してしまうと、脚本のpanels[]から毎回コマ割りを
                // 計算し直すことになり、手動分割の結果（コマ数は合っていても配置が異なる）が
                // 失われてしまうため、必ずst.quadsを直接変換する。
                pageWidth = w.layout.pageWidth;
                pageHeight = w.layout.pageHeight;
                const built = quadsToPageLayout(st.quads, w.layout);
                pagePanels = built.panels;
                svgContent = built.svgContent;
            }

            const pageRecord = {
                name: `${w.name || t('auto.workUntitled')}_p${i + 1}_${timestamp}`,
                id: `page_auto_${timestamp}_${i}`,
                width: pageWidth, height: pageHeight,
                panels: pagePanels, svgContent,
                basePanelPoints: '', overlaySvgContent: '', draftSvgContent: '',
            };
            await dbPut('pages', pageRecord);
            if (groupCreated) _pageMgrGroups.assign(pageRecord.name, workGroupName);
            if (i === 0 && groupCreated) _workMeta.set(workGroupName, { width: pageWidth, height: pageHeight, createdAt: timestamp });

            state.activePage = pageRecord;
            state.selectedPanelId = null;
            state.selectedOverlay = true;
            state.selectedDraft = false;
            state.history = [];
            await renderLayoutTab();
            pushHistory();

            await insertBalloonsAndImages(scriptPage);

            if (!firstPageRecord) firstPageRecord = state.activePage;
        }

        await loadPages();
        if (groupCreated) {
            const meta = _workMeta.get(workGroupName);
            _workSetActive({ name: workGroupName, width: meta?.width, height: meta?.height });
            await renderWorkList();
        }
        state.activePage = firstPageRecord;
        await renderLayoutTab();
        renderPageSelector();
        updateLayoutPageNav();
        await switchTab('layout');
        setStatus('alo-transfer-status', 'ok', t('alo.msgTransferDone', pages.length));
    } catch (e) {
        console.error('[AutoLayout] transfer error:', e);
        setStatus('alo-transfer-status', 'error', t('alo.msgTransferFailed', e.message || String(e)));
    } finally {
        alo.busy = false;
        $('alo-transfer-btn').disabled = false;
    }
}

// ============================================================
// 初期化
// ============================================================

function onGenerateClick() {
    if (alo.pages.length && !confirm(t('alo.confirmRegenerate'))) return;
    onSavePageSettings();
    generateAllPages();
    renderCanvas();
    renderPageNav();
    renderProperties();
    setStatus('alo-generate-status', 'ok', t('alo.msgGenerated', scriptPages().length));
}

function bindEvents() {
    document.querySelectorAll('[data-alo-left]').forEach((btn) => btn.addEventListener('click', () => switchLeftTab(btn.dataset.aloLeft)));
    document.querySelectorAll('[data-alo-tool]').forEach((btn) => btn.addEventListener('click', () => {
        alo.tool = btn.dataset.aloTool;
        document.querySelectorAll('[data-alo-tool]').forEach((b) => b.classList.toggle('active', b === btn));
    }));

    $('alo-zoom').addEventListener('input', (e) => { alo.zoom = parseFloat(e.target.value) || 1; renderCanvas(); });
    $('alo-page-prev-btn').addEventListener('click', () => { if (alo.pageIndex > 0) { alo.pageIndex--; alo.selectedPanel = null; ensurePageLayoutFresh(); renderCanvas(); renderPageNav(); renderProperties(); } });
    $('alo-page-next-btn').addEventListener('click', () => { if (alo.pageIndex < scriptPages().length - 1) { alo.pageIndex++; alo.selectedPanel = null; ensurePageLayoutFresh(); renderCanvas(); renderPageNav(); renderProperties(); } });
    $('alo-canvas').addEventListener('click', onCanvasClick);

    $('alo-size-preset').addEventListener('change', onSizePresetChange);
    $('alo-page-width').addEventListener('input', onSizeFieldInput);
    $('alo-page-height').addEventListener('input', onSizeFieldInput);
    $('alo-size-preset-save').addEventListener('click', onSizePresetSave);
    $('alo-size-preset-delete').addEventListener('click', onSizePresetDelete);
    $('alo-margin-uniform').addEventListener('change', onMarginUniformChange);
    $('alo-margin-top').addEventListener('input', onMarginTopInput);

    $('alo-generate-btn').addEventListener('click', onGenerateClick);
    $('alo-detail-save-btn').addEventListener('click', onSaveDetailSettings);
    $('alo-template-save-page-btn').addEventListener('click', onSavePageAsTemplate);
    $('alo-template-refresh-btn').addEventListener('click', () => renderTemplateList(true));
    $('alo-template-staged').addEventListener('click', (e) => { const name = e.target.closest('[data-name]')?.dataset.name; if (name) onTemplatePick(name); });
    $('alo-template-clear-btn').addEventListener('click', onTemplateClear);

    $('alo-prop-dialogue-edit-btn').addEventListener('click', onDialogueEdit);
    $('alo-prop-dialogue-add-btn').addEventListener('click', onDialogueAdd);
    $('alo-prop-dialogue-save-btn').addEventListener('click', onDialogueSave);
    $('alo-prop-dialogue-del-btn').addEventListener('click', onDialogueDelete);
    $('alo-prop-dialogue-cancel-btn').addEventListener('click', () => { editingDialogueIdx = null; $('alo-prop-dialogue-edit').style.display = 'none'; });

    $('alo-prop-image-generate-btn').addEventListener('click', onImageGenerate);
    $('alo-prop-image-clear-btn').addEventListener('click', onImageClear);
    $('alo-prop-image-gallery').addEventListener('click', onImageGalleryClick);

    $('alo-transfer-btn').addEventListener('click', transferAllPages);
}

export function initAutoLayoutSubtab() {
    if (!alo.inited) {
        alo.inited = true;
        bindEvents();
    }
    // 作品バーで別の作品に切り替えていたら、前の作品のプレビューキャッシュ・選択状態を破棄する
    const workId = work().id;
    if (alo.lastWorkId !== workId) {
        alo.lastWorkId = workId;
        alo.pages = [];
        alo.pageIndex = 0;
        alo.selectedPanel = null;
    }
    renderLeftSettings();
    const pages = scriptPages();
    alo.pageIndex = Math.min(alo.pageIndex, Math.max(0, pages.length - 1));
    if (!alo.pages.length && pages.length) generateAllPages();
    else ensurePageLayoutFresh();
    renderCanvas();
    renderPageNav();
    renderProperties();
    setStatus('alo-generate-status', '', '');
    setStatus('alo-transfer-status', '', '');
    setStatus('alo-detail-status', '', '');
}
