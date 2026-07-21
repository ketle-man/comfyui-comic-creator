// ============================================================
// フキダシ管理 追加ファイル: フキダシ内包テキスト（シンプル版）
// 既存の09-balloons系（尻尾付きフキダシ）とは別に、参考ノード
// comfyUI-TextOverlayAndBubbles を参考にした「シンプルな形状(四角/角丸四角/楕円)
// ＋内包テキスト」をモーダルから1操作で作成・再編集する機能。
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する
// （09a〜09eの後、balloon-shape系の共通ヘルパーに依存するため）。
// 主なトップレベル定義: _isBubbleTextType,_bubbleTextUpdateShape,insertBubbleTextShape,updateBubbleTextShape,openBubbleTextModal,initBubbleTextTools
// ============================================================

const BUBBLE_TEXT_PT_TO_SVG = 3.528; // 09a-balloon-init.js のフォントサイズ変換係数を踏襲
const BUBBLE_TEXT_MM_TO_SVG = 100;   // A4プリセット(21000×29700 = 210×297mm)から逆算した実測比率

let _bubbleTextMeasureCanvas = null;

// shapeType文字列 → 形状種別('rect'|'rounded'|'oval')。対象外はnull
function _bubbleTextShapeKind(shapeType) {
    if (shapeType === 'textbox-rect') return 'rect';
    if (shapeType === 'textbox-rounded') return 'rounded';
    if (shapeType === 'textbox-oval') return 'oval';
    return null;
}

function _isBubbleTextType(shapeType) {
    return _bubbleTextShapeKind(shapeType) !== null;
}

// テキストを1文字ずつ詰めて折り返す（日本語には単語区切りが無いため文字単位で判定する）
// 戻り値: { lines: string[], maxLineWidth: number }
function _bubbleTextWrapLines(text, fontFamily, fontSizeSvg, maxWidthSvg) {
    if (!_bubbleTextMeasureCanvas) _bubbleTextMeasureCanvas = document.createElement('canvas');
    const ctx = _bubbleTextMeasureCanvas.getContext('2d');
    ctx.font = `${fontSizeSvg}px ${fontFamily}`;

    const paragraphs = String(text ?? '').split('\n');
    const lines = [];
    paragraphs.forEach(para => {
        if (para === '') { lines.push(''); return; }
        let line = '';
        for (const ch of para) {
            const test = line + ch;
            if (line && ctx.measureText(test).width > maxWidthSvg) {
                lines.push(line);
                line = ch;
            } else {
                line = test;
            }
        }
        lines.push(line);
    });

    const maxLineWidth = lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
    return { lines, maxLineWidth };
}

// テキストを内包する箱のサイズ(rx,ry)を、折返し後のテキストブロックに合わせて計算する。
// 楕円は内接矩形の公式(w/a)^2+(h/b)^2=1 において w/h と a/b の比を一致させると、
// a=w*√2, b=h*√2 のとき常に等号が成り立つため、矩形サイズに√2を掛けるだけで
// テキストブロックが楕円にちょうど内接するサイズを得られる。
function _bubbleTextComputeLayout(kind, text, fontFamily, fontSizeSvg, maxWidthSvg, padding) {
    const { lines, maxLineWidth } = _bubbleTextWrapLines(text, fontFamily, fontSizeSvg, maxWidthSvg);
    const lineHeight = fontSizeSvg * 1.4;
    const textW = maxLineWidth;
    const textH = lines.length * lineHeight;

    const k = kind === 'oval' ? Math.SQRT2 : 1;
    const rx = Math.max((textW / 2) * k + padding, fontSizeSvg);
    const ry = Math.max((textH / 2) * k + padding, fontSizeSvg * 0.8);
    return { lines, lineHeight, rx, ry };
}

// balloon-shape(g要素)の中に、背景シェイプ(rect/rounded-rect/ellipse)と
// 折返し済みテキストを再構築する。dataset.rxを現在の表示幅とみなし、そこから
// 逆算した幅で再折返しするため、リサイズハンドルで幅を変えると自動で追従する。
function _bubbleTextUpdateShape(el) {
    const kind = _bubbleTextShapeKind(el.dataset.shapeType);
    if (!kind) return;

    const cx = parseFloat(el.dataset.cx) || 0;
    const cy = parseFloat(el.dataset.cy) || 0;
    const rx = parseFloat(el.dataset.rx) || 1;
    const ry = parseFloat(el.dataset.ry) || 1;
    const fontFamily = el.dataset.fontFamily || 'BIZ UDPGothic';
    const fontSizeSvg = parseFloat(el.dataset.fontSizeSvg) || 40;
    const padding = fontSizeSvg * 0.5;
    const text = el.dataset.bubbleText || '';

    const k = kind === 'oval' ? Math.SQRT2 : 1;
    const availWidth = Math.max(fontSizeSvg, ((rx - padding) / k) * 2);
    const { lines } = _bubbleTextWrapLines(text, fontFamily, fontSizeSvg, availWidth);
    const lineHeight = fontSizeSvg * 1.4;

    const ns = 'http://www.w3.org/2000/svg';

    // 背景シェイプ
    let bg = el.querySelector('.bubbletext-bg');
    if (!bg || bg.tagName.toLowerCase() !== (kind === 'oval' ? 'ellipse' : 'rect')) {
        if (bg) bg.remove();
        bg = document.createElementNS(ns, kind === 'oval' ? 'ellipse' : 'rect');
        bg.setAttribute('class', 'bubbletext-bg');
        el.insertBefore(bg, el.firstChild);
    }
    if (kind === 'oval') {
        bg.setAttribute('cx', cx);
        bg.setAttribute('cy', cy);
        bg.setAttribute('rx', rx);
        bg.setAttribute('ry', ry);
    } else {
        bg.setAttribute('x', cx - rx);
        bg.setAttribute('y', cy - ry);
        bg.setAttribute('width', rx * 2);
        bg.setAttribute('height', ry * 2);
        if (kind === 'rounded') {
            const r = Math.min(parseFloat(el.dataset.rectRadius) || fontSizeSvg * 0.6, rx, ry);
            bg.setAttribute('rx', r);
            bg.setAttribute('ry', r);
        } else {
            bg.removeAttribute('rx');
            bg.removeAttribute('ry');
        }
    }

    // テキスト（背景色ピッカーの継承を受けないよう塗り・線をここで明示する）
    let textEl = el.querySelector('.bubbletext-text');
    if (!textEl) {
        textEl = document.createElementNS(ns, 'text');
        textEl.setAttribute('class', 'bubbletext-text');
        textEl.style.pointerEvents = 'none';
        el.appendChild(textEl);
    }
    textEl.setAttribute('fill', '#000000');
    textEl.setAttribute('stroke', 'none');
    textEl.setAttribute('font-family', fontFamily);
    textEl.setAttribute('font-size', fontSizeSvg);
    textEl.style.pointerEvents = 'none';
    // 09e-text-tool.js 側の単独テキスト選択・回転処理が誤って付与しうる状態を毎回リセットする
    // （回転・選択は外側の<g>=balloon-shapeが一元管理するため、内部の<text>は独自状態を持たない）
    textEl.classList.remove('selected');
    textEl.removeAttribute('transform');
    delete textEl.dataset.angle;
    delete textEl.dataset.bboxCx;
    delete textEl.dataset.bboxCy;
    textEl.innerHTML = '';

    // 文字揃え（左/中央/右）。text-anchorと基準x座標をテキストエリア（padding分内側）の
    // 左端/中央/右端に合わせる。中央以外はSVGのtext-anchor(start/end)にそのまま対応する
    const align = el.dataset.textAlign || 'center';
    const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
    const textX = align === 'left' ? (cx - rx + padding) : align === 'right' ? (cx + rx - padding) : cx;
    textEl.setAttribute('text-anchor', anchor);

    const totalH = lines.length * lineHeight;
    const startY = cy - totalH / 2 + lineHeight * 0.8;
    lines.forEach((line, i) => {
        const tspan = document.createElementNS(ns, 'tspan');
        tspan.setAttribute('x', textX);
        tspan.setAttribute('y', startY + i * lineHeight);
        tspan.textContent = line || ' '; // 空行も高さを保つためnbsp
        textEl.appendChild(tspan);
    });

    const angle = parseFloat(el.dataset.angle || 0);
    if (angle) el.setAttribute('transform', `rotate(${angle},${cx},${cy})`);
    else el.removeAttribute('transform');
}

// 図形が実際に属しているコマ（またはオーバーレイ）へ保存する。
// 現在UIで選択中のコマ(state.selectedPanelId)ではなく、要素自身のDOM上の所属先を見て判定する。
// 編集は任意のコマの図形をダブルクリックして開始できるため、UI選択状態と一致するとは限らない。
async function _bubbleTextSaveFor(el, overlaySvgEl) {
    const clipPanelG = el.closest('g[data-clip-panel]');
    if (clipPanelG) {
        await savePanelSvg(clipPanelG.getAttribute('data-clip-panel'), overlaySvgEl);
    } else {
        await saveOverlaySvg(overlaySvgEl);
    }
}

// モーダルで指定した内容から、現在選択中のコマ（またはオーバーレイ）にフキダシ+テキストを新規挿入する
async function insertBubbleTextShape({ shapeKind, text, fontSizePt, maxWidthMm, fillColor, borderEnabled, textAlign, fontFamily }) {
    if (!state.activePage) { console.error('[bubbleText] activePage is null'); return null; }
    const container = getActiveContainer();
    if (!container) { console.error('[bubbleText] container not found'); return null; }
    const overlaySvgEl = getPanelLayerSvg(container);
    if (!overlaySvgEl) { console.error('[bubbleText] panel-layer SVG not found'); return null; }

    pushHistory();

    const viewBox = overlaySvgEl.viewBox.baseVal;
    let cx = viewBox.width / 2, cy = viewBox.height / 2;
    if (state.selectedPanelId) {
        const panel = state.activePage.panels.find(p => p.id === state.selectedPanelId);
        if (panel) {
            const bbox = getBoundingBoxFromPoints(panel.points);
            cx = bbox.x + bbox.width / 2;
            cy = bbox.y + bbox.height / 2;
        }
    }

    const kind = (shapeKind === 'rounded' || shapeKind === 'oval') ? shapeKind : 'rect';
    const fontSizeSvg = Math.round((fontSizePt || 150) * BUBBLE_TEXT_PT_TO_SVG);
    const maxWidthSvg = Math.max(fontSizeSvg * 2, (maxWidthMm || 60) * BUBBLE_TEXT_MM_TO_SVG);
    const padding = fontSizeSvg * 0.5;
    const ff = fontFamily || state.balloon.fontFamily || 'BIZ UDPGothic';
    const layout = _bubbleTextComputeLayout(kind, text, ff, fontSizeSvg, maxWidthSvg, padding);

    const parent = getOrCreateClipGroup(overlaySvgEl);
    const id = 'shape-' + Date.now();
    const ns = 'http://www.w3.org/2000/svg';
    const shape = document.createElementNS(ns, 'g');
    shape.id = id;
    shape.setAttribute('class', 'balloon-shape');
    shape.dataset.shapeType = `textbox-${kind}`;
    shape.dataset.cx = cx;
    shape.dataset.cy = cy;
    shape.dataset.rx = layout.rx;
    shape.dataset.ry = layout.ry;
    shape.dataset.angle = 0;
    shape.dataset.bubbleText = text;
    shape.dataset.fontFamily = ff;
    shape.dataset.fontSizeSvg = fontSizeSvg;
    shape.dataset.maxWidthMm = maxWidthMm || 60;
    shape.dataset.textAlign = textAlign || 'center';
    if (kind === 'rounded') shape.dataset.rectRadius = Math.round(fontSizeSvg * 0.6);
    shape.setAttribute('fill', fillColor || '#FFFFFF');
    if (borderEnabled === false) {
        shape.setAttribute('stroke', 'none');
        shape.setAttribute('stroke-width', 0);
    } else {
        shape.setAttribute('stroke', '#000000');
        shape.setAttribute('stroke-width', state.balloon.borderWidth || 40);
    }
    shape.style.pointerEvents = 'auto';

    parent.appendChild(shape);
    _bubbleTextUpdateShape(shape);

    state.selectedShapeId = id;
    document.querySelectorAll('.balloon-shape').forEach(s => s.classList.remove('selected'));
    shape.classList.add('selected');

    state.balloon.isEditMode = true;
    updateBalloonUI();
    renderHandles(shape);

    await _bubbleTextSaveFor(shape, overlaySvgEl);

    return shape;
}

// 既存のフキダシ+内包テキストを、モーダルで指定し直した内容で更新する（再編集）。
// 位置(cx,cy)は保持したまま、内容に合わせて箱のサイズだけを再計算する。
async function updateBubbleTextShape(el, { shapeKind, text, fontSizePt, maxWidthMm, fillColor, borderEnabled, textAlign, fontFamily }) {
    const overlaySvgEl = el.ownerSVGElement || el.closest('svg');
    if (!overlaySvgEl) return null;

    pushHistory();

    const kind = (shapeKind === 'rounded' || shapeKind === 'oval') ? shapeKind : 'rect';
    const fontSizeSvg = Math.round((fontSizePt || 150) * BUBBLE_TEXT_PT_TO_SVG);
    const maxWidthSvg = Math.max(fontSizeSvg * 2, (maxWidthMm || 60) * BUBBLE_TEXT_MM_TO_SVG);
    const padding = fontSizeSvg * 0.5;
    const ff = fontFamily || el.dataset.fontFamily || state.balloon.fontFamily || 'BIZ UDPGothic';
    const layout = _bubbleTextComputeLayout(kind, text, ff, fontSizeSvg, maxWidthSvg, padding);

    el.dataset.shapeType = `textbox-${kind}`;
    el.dataset.rx = layout.rx;
    el.dataset.ry = layout.ry;
    el.dataset.bubbleText = text;
    el.dataset.fontFamily = ff;
    el.dataset.fontSizeSvg = fontSizeSvg;
    el.dataset.maxWidthMm = maxWidthMm || 60;
    el.dataset.textAlign = textAlign || 'center';
    if (kind === 'rounded' && !el.dataset.rectRadius) el.dataset.rectRadius = Math.round(fontSizeSvg * 0.6);
    el.setAttribute('fill', fillColor || '#FFFFFF');
    if (borderEnabled === false) {
        el.setAttribute('stroke', 'none');
        el.setAttribute('stroke-width', 0);
    } else {
        const curWidth = parseFloat(el.getAttribute('stroke-width'));
        el.setAttribute('stroke', '#000000');
        el.setAttribute('stroke-width', curWidth || state.balloon.borderWidth || 40);
    }

    _bubbleTextUpdateShape(el);

    if (state.selectedShapeId === el.id) renderHandles(el);

    await _bubbleTextSaveFor(el, overlaySvgEl);

    return el;
}

// ============================================================
// モーダルUI（text-style-modal.js と同じ「動的<div>生成」パターン）
// existingEl を渡すと、その要素を編集するモードで開く（未指定なら新規作成）
// ============================================================

function openBubbleTextModal(existingEl) {
    const isEdit = !!(existingEl && _isBubbleTextType(existingEl.dataset.shapeType));
    let shapeKind = isEdit ? _bubbleTextShapeKind(existingEl.dataset.shapeType) : 'rect';
    let textAlign = isEdit ? (existingEl.dataset.textAlign || 'center') : 'center';

    const overlay = document.createElement('div');
    overlay.className = 'tsm-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'tsm-dialog btm-dialog';
    dialog.innerHTML = `
        <div class="tsm-header">
            <h3>${t(isEdit ? 'bubbleText.modalTitleEdit' : 'bubbleText.modalTitle')}</h3>
            <button type="button" id="btm-close-btn" class="tsm-close-btn" title="${t('common.close')}">×</button>
        </div>
        <div class="tsm-body btm-body">
            <div class="btm-controls">
                <div class="fontmgr-style-group">
                    <label class="fontmgr-style-group-label">${t('bubbleText.shapeLabel')}</label>
                    <div class="btm-shape-btns">
                        <button type="button" class="btn small secondary btm-shape-btn" data-shape="rect">${t('bubbleText.shapeRect')}</button>
                        <button type="button" class="btn small secondary btm-shape-btn" data-shape="rounded">${t('bubbleText.shapeRounded')}</button>
                        <button type="button" class="btn small secondary btm-shape-btn" data-shape="oval">${t('bubbleText.shapeOval')}</button>
                    </div>
                </div>
                <div class="fontmgr-style-group" style="flex-direction:column; align-items:stretch;">
                    <label class="fontmgr-style-group-label">${t('bubbleText.textLabel')}</label>
                    <textarea id="btm-text-input" placeholder="${t('bubbleText.textPlaceholder')}" rows="5"></textarea>
                </div>
                <div class="fontmgr-style-group">
                    <label>${t('bubbleText.fontSizeLabel')}</label>
                    <input type="number" id="btm-font-size" min="10" max="999" value="150" style="width:60px;" />
                    <label style="margin-left:10px;">${t('bubbleText.maxWidthLabel')}</label>
                    <input type="number" id="btm-max-width" min="10" max="200" value="60" style="width:60px;" />
                </div>
                <div class="fontmgr-style-group">
                    <label>${t('bubbleText.fillColorLabel')}</label>
                    <input type="color" id="btm-fill-color" value="#FFFFFF" />
                    <label style="margin-left:10px; display:flex; align-items:center; gap:4px;">
                        <input type="checkbox" id="btm-border-enable" checked /> ${t('bubbleText.borderLabel')}
                    </label>
                </div>
                <div class="fontmgr-style-group">
                    <label class="fontmgr-style-group-label">${t('font.alignLabel')}</label>
                    <div class="btm-shape-btns">
                        <button type="button" class="btn small secondary btm-align-btn" data-align="left">${t('font.alignLeft')}</button>
                        <button type="button" class="btn small secondary btm-align-btn" data-align="center">${t('font.alignCenter')}</button>
                        <button type="button" class="btn small secondary btm-align-btn" data-align="right">${t('font.alignRight')}</button>
                    </div>
                </div>
                <div class="fontmgr-style-group">
                    <label class="fontmgr-style-group-label">${t('bubbleText.fontLabel')}</label>
                    <select id="btm-font-family" style="flex:1; min-width:0;"></select>
                </div>
            </div>
        </div>
        <div class="tsm-footer">
            <button type="button" id="btm-cancel-btn" class="btn secondary">${t('common.cancel')}</button>
            <button type="button" id="btm-create-btn" class="btn primary">${t(isEdit ? 'bubbleText.updateBtn' : 'bubbleText.createBtn')}</button>
        </div>
    `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const $ = id => dialog.querySelector('#' + id);

    const syncShapeButtons = () => {
        dialog.querySelectorAll('.btm-shape-btn').forEach(b => {
            const active = b.dataset.shape === shapeKind;
            b.classList.toggle('active', active);
            b.classList.toggle('secondary', !active);
        });
    };
    syncShapeButtons();

    dialog.querySelectorAll('.btm-shape-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            shapeKind = btn.dataset.shape;
            syncShapeButtons();
        });
    });

    const syncAlignButtons = () => {
        dialog.querySelectorAll('.btm-align-btn').forEach(b => {
            const active = b.dataset.align === textAlign;
            b.classList.toggle('active', active);
            b.classList.toggle('secondary', !active);
        });
    };
    syncAlignButtons();

    dialog.querySelectorAll('.btm-align-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            textAlign = btn.dataset.align;
            syncAlignButtons();
        });
    });

    // フォント選択肢（レイアウトタブのテキストツールと同じGoogle Fontsリストを使う）。
    // 現在値がリストに無い場合（システムフォント等）は先頭に追加して選択できるようにする
    const fontSel = $('btm-font-family');
    const googleFonts = typeof _fontMgrGoogleList === 'function' ? _fontMgrGoogleList() : [];
    googleFonts.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        fontSel.appendChild(opt);
    });
    const preferredFont = isEdit ? existingEl.dataset.fontFamily : state.balloon.fontFamily;
    if (preferredFont && !googleFonts.includes(preferredFont)) {
        const opt = document.createElement('option');
        opt.value = preferredFont;
        opt.textContent = preferredFont;
        fontSel.insertBefore(opt, fontSel.firstChild);
    }
    if (preferredFont) fontSel.value = preferredFont;

    if (isEdit) {
        $('btm-text-input').value = existingEl.dataset.bubbleText || '';
        $('btm-font-size').value = Math.round((parseFloat(existingEl.dataset.fontSizeSvg) || 0) / BUBBLE_TEXT_PT_TO_SVG) || 150;
        $('btm-max-width').value = parseFloat(existingEl.dataset.maxWidthMm) || 60;
        $('btm-fill-color').value = /^#[0-9a-f]{6}$/i.test(existingEl.getAttribute('fill')) ? existingEl.getAttribute('fill') : '#FFFFFF';
        const strokeW = parseFloat(existingEl.getAttribute('stroke-width'));
        $('btm-border-enable').checked = existingEl.getAttribute('stroke') !== 'none' && strokeW > 0;
    }

    const close = () => document.body.removeChild(overlay);
    const onKeydown = (e) => { if (e.key === 'Escape') closeAndCleanup(); };
    document.addEventListener('keydown', onKeydown);
    const closeAndCleanup = () => { document.removeEventListener('keydown', onKeydown); close(); };

    $('btm-close-btn').addEventListener('click', closeAndCleanup);
    $('btm-cancel-btn').addEventListener('click', closeAndCleanup);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeAndCleanup(); });

    $('btm-create-btn').addEventListener('click', async () => {
        const text = $('btm-text-input').value;
        if (!text || !text.trim()) { alert(t('bubbleText.textRequired')); return; }
        const params = {
            shapeKind,
            text,
            fontSizePt: parseInt($('btm-font-size').value, 10) || 150,
            maxWidthMm: parseFloat($('btm-max-width').value) || 60,
            fillColor: $('btm-fill-color').value,
            borderEnabled: $('btm-border-enable').checked,
            textAlign,
            fontFamily: $('btm-font-family').value || undefined,
        };
        if (isEdit) await updateBubbleTextShape(existingEl, params);
        else await insertBubbleTextShape(params);
        closeAndCleanup();
    });

    setTimeout(() => $('btm-text-input').focus(), 50);
}

// フキダシ+内包テキストをダブルクリックすると再編集モーダルを開けるようにする。
// 09e-text-tool.js の dblclick(テキスト単体の再編集ダイアログ)と同じsvgEl・同じイベントを奪い合うため、
// キャプチャフェーズで先取りしてstopImmediatePropagationし、テキストダイアログが二重に開かないようにする
let _bubbleTextDblClickHandler = null;
function initBubbleTextTools(svgEl) {
    if (!svgEl) return;
    if (_bubbleTextDblClickHandler) svgEl.removeEventListener('dblclick', _bubbleTextDblClickHandler, true);
    _bubbleTextDblClickHandler = (e) => {
        const shape = e.target.closest('.balloon-shape');
        if (!shape || !_isBubbleTextType(shape.dataset.shapeType)) return;
        if (typeof _isObjectLocked === 'function' && _isObjectLocked(shape)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        openBubbleTextModal(shape);
    };
    svgEl.addEventListener('dblclick', _bubbleTextDblClickHandler, true);
}

window.openBubbleTextModal = openBubbleTextModal;
