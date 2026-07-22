// ============================================================
// フキダシ管理 追加ファイル: フキダシ内包テキスト
// 「四角/角丸四角/楕円」専用のシンプル形状（textbox-*、後方互換のため残置）に加え、
// 既存の09b-balloon-shapes系（尻尾付き・雲もこもこ/なみなみ等、以下h2タイプ）にも
// 同じテキスト内包の仕組みを統合する。
// フキダシの形状作成は09a/09b/09c/09d側（h2挿入ボタン・ハンドル操作）に任せ、
// 本ファイルは「選択中のフキダシにテキストを内包・編集する」モーダルUIとレンダリングのみを担う
// （導線は「フキダシ形状の作成・調整」と「テキストの詳細設定」の2つに分離する方針）。
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する
// （09a〜09eの後、balloon-shape系の共通ヘルパーに依存するため）。
// 主なトップレベル定義: _isBubbleTextType,_bubbleTextUpdateShape,_bubbleTextSyncH2Text,applyBubbleTextToShape,openBubbleTextModal,initBubbleTextTools
// ============================================================

const BUBBLE_TEXT_PT_TO_SVG = 3.528; // 09a-balloon-init.js のフォントサイズ変換係数を踏襲

let _bubbleTextMeasureCanvas = null;

// shapeType文字列 → 形状種別('rect'|'rounded'|'oval')。対象外はnull
// （新規作成の導線は無いが、過去に作成済みのtextbox-*要素の編集のため判定は維持する）
function _bubbleTextShapeKind(shapeType) {
    if (shapeType === 'textbox-rect') return 'rect';
    if (shapeType === 'textbox-rounded') return 'rounded';
    if (shapeType === 'textbox-oval') return 'oval';
    return null;
}

function _isBubbleTextType(shapeType) {
    return _bubbleTextShapeKind(shapeType) !== null;
}

// 09b-balloon-shapes.js の h2 タイプ判定と同じ集合（尻尾付き・雲を含む既存フキダシ全形状）
function _isH2BalloonType(shapeType) {
    return shapeType === 'bomb' || shapeType === 'thought' || shapeType === 'normal'
        || shapeType === 'rect' || shapeType === 'cloudpuffy' || shapeType === 'cloudwavy';
}

// テキストを内包できる対象（textbox-* または h2タイプ）かどうか
function _bubbleTextCanHoldText(shapeType) {
    return _isBubbleTextType(shapeType) || _isH2BalloonType(shapeType);
}

// テキストを1文字ずつ詰めて折り返す（日本語には単語区切りが無いため文字単位で判定する）。
// vertical=true の場合、幅ではなく「文字数×フォントサイズ」を高さの近似値として折返し判定する
// （プロポーショナルフォントの字形実測ではなく近似だが、縦書きの用途では十分実用的なため）。
// 戻り値: { lines: string[], maxLineExtent: number }
function _bubbleTextWrapLines(text, fontFamily, fontSizeSvg, maxExtentSvg, vertical) {
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
            const extent = vertical ? (test.length * fontSizeSvg) : ctx.measureText(test).width;
            if (line && extent > maxExtentSvg) {
                lines.push(line);
                line = ch;
            } else {
                line = test;
            }
        }
        lines.push(line);
    });

    const maxLineExtent = vertical
        ? lines.reduce((m, l) => Math.max(m, l.length * fontSizeSvg), 0)
        : lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0);
    return { lines, maxLineExtent };
}

// 対象フキダシのテキスト内包エリア(cx,cy,rx,ry,kind)を返す。
// rx/ryは常に「現在の形状サイズ」をそのまま使う（テキスト量に応じて箱を自動拡大することはしない。
// 箱のサイズはハンドルでの調整、またはtextbox-*の場合のみ従来のrx/ryを踏襲する）。
// kind='oval'は内接矩形計算に√2係数を使う形状（textbox-oval、および楕円ベースのh2形状）。
// バクダン/雲は輪郭が凹凸のためテキストがはみ出しやすく、内接矩形をさらに絞る(safety)。
function _bubbleTextAreaFor(el) {
    const cx = parseFloat(el.dataset.cx) || 0;
    const cy = parseFloat(el.dataset.cy) || 0;
    const rx = parseFloat(el.dataset.rx) || 1;
    const ry = parseFloat(el.dataset.ry) || 1;
    const type = el.dataset.shapeType;
    const isOvalKind = type === 'textbox-oval' || type === 'normal' || type === 'thought'
        || type === 'bomb' || type === 'cloudpuffy' || type === 'cloudwavy';
    const safety = (type === 'bomb' || type === 'cloudpuffy' || type === 'cloudwavy') ? 0.75 : 1.0;
    return { cx, cy, rx: rx * safety, ry: ry * safety, kind: isOvalKind ? 'oval' : 'rect' };
}

// フキダシ(g要素)内の内包テキスト(<text>)を、現在のdataset(bubbleText/fontFamily/fontSizeSvg/
// textAlign/bubbleTextVertical)とareaに合わせて再構築する。textbox-*・h2タイプ共通で使う。
function _bubbleTextRenderText(el, area) {
    const fontFamily = el.dataset.fontFamily || 'BIZ UDPGothic';
    const fontSizeSvg = parseFloat(el.dataset.fontSizeSvg) || 40;
    const padding = fontSizeSvg * 0.5;
    const text = el.dataset.bubbleText || '';
    const vertical = el.dataset.bubbleTextVertical === '1';
    const align = el.dataset.textAlign || 'center';
    const lineHeight = fontSizeSvg * 1.4;
    const k = area.kind === 'oval' ? Math.SQRT2 : 1;

    const ns = 'http://www.w3.org/2000/svg';
    let textEl = el.querySelector('.bubbletext-text');
    if (!textEl) {
        textEl = document.createElementNS(ns, 'text');
        textEl.setAttribute('class', 'bubbletext-text');
        textEl.style.pointerEvents = 'none';
    }
    el.appendChild(textEl); // 常に最前面へ（h2タイプは背景pathを毎回作り直すため）

    // 背景色ピッカーの継承を受けないよう塗り・線をここで明示する
    textEl.setAttribute('fill', el.dataset.textColor || '#000000');
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

    const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';

    if (vertical) {
        // SVG1.1の writing-mode="tb" 属性はSVG2/CSS Writing Modesを実装する現行ブラウザでは
        // 無効な値として無視される（有効なのは horizontal-tb|vertical-rl|vertical-lr）ため、
        // 属性ではなくCSSプロパティとして設定する。text-orientation:uprightで
        // 日本語の字形を回転させず正立のまま縦に並べる
        textEl.style.writingMode = 'vertical-rl';
        textEl.style.textOrientation = 'upright';
        const availHeight = Math.max(fontSizeSvg, ((area.ry - padding) / k) * 2);
        const { lines } = _bubbleTextWrapLines(text, fontFamily, fontSizeSvg, availHeight, true);
        textEl.setAttribute('text-anchor', anchor);
        // 列は右→左に配置。textAlignは各列内での縦位置(上/中央/下)として流用する。
        // vertical-rlのtext-anchorはy座標を基準にインライン方向(縦)の整列を決めるため、
        // 横書きのtextX計算と対称に、上寄せ/下寄せではエリアの上端/下端を基準点にする
        // （中心cy固定のままanchorだけ切り替えると、テキストが中心からずれた側に伸びるだけで
        // 上下が逆に見えてしまう）
        const totalW = lines.length * lineHeight;
        const startX = area.cx + totalW / 2 - lineHeight * 0.5;
        const textY = align === 'left' ? (area.cy - area.ry + padding) : align === 'right' ? (area.cy + area.ry - padding) : area.cy;
        lines.forEach((line, i) => {
            const tspan = document.createElementNS(ns, 'tspan');
            tspan.setAttribute('x', startX - i * lineHeight);
            tspan.setAttribute('y', textY);
            tspan.textContent = line || ' ';
            textEl.appendChild(tspan);
        });
    } else {
        textEl.style.writingMode = '';
        textEl.style.textOrientation = '';
        const availWidth = Math.max(fontSizeSvg, ((area.rx - padding) / k) * 2);
        const { lines } = _bubbleTextWrapLines(text, fontFamily, fontSizeSvg, availWidth, false);
        const textX = align === 'left' ? (area.cx - area.rx + padding) : align === 'right' ? (area.cx + area.rx - padding) : area.cx;
        textEl.setAttribute('text-anchor', anchor);
        const totalH = lines.length * lineHeight;
        const startY = area.cy - totalH / 2 + lineHeight * 0.8;
        lines.forEach((line, i) => {
            const tspan = document.createElementNS(ns, 'tspan');
            tspan.setAttribute('x', textX);
            tspan.setAttribute('y', startY + i * lineHeight);
            tspan.textContent = line || ' '; // 空行も高さを保つためnbsp
            textEl.appendChild(tspan);
        });
    }
}

// textbox-*(四角/角丸四角/楕円)専用: 背景シェイプ(rect/ellipse)を再構築してからテキストを描画する。
// h2タイプは本体path生成を09b-balloon-shapes.jsの_updateH2ShapePathが担当するため、
// この関数ではなく_bubbleTextSyncH2Textを使う。
function _bubbleTextUpdateShape(el) {
    const kind = _bubbleTextShapeKind(el.dataset.shapeType);
    if (!kind) return;

    const cx = parseFloat(el.dataset.cx) || 0;
    const cy = parseFloat(el.dataset.cy) || 0;
    const rx = parseFloat(el.dataset.rx) || 1;
    const ry = parseFloat(el.dataset.ry) || 1;
    const fontSizeSvg = parseFloat(el.dataset.fontSizeSvg) || 40;

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

    _bubbleTextRenderText(el, _bubbleTextAreaFor(el));

    const angle = parseFloat(el.dataset.angle || 0);
    if (angle) el.setAttribute('transform', `rotate(${angle},${cx},${cy})`);
    else el.removeAttribute('transform');
}

// h2タイプ(尻尾付き・雲等)専用: 本体pathは_updateH2ShapePathが既に生成済みの前提で、
// テキストデータがあればオーバーレイとして<text>を追加/更新し、無ければ既存のテキストを削除する。
// 09b-balloon-shapes.jsの_updateH2ShapePath末尾から呼ばれる。
function _bubbleTextSyncH2Text(el) {
    const text = el.dataset.bubbleText;
    if (!text || !text.trim()) {
        const existing = el.querySelector('.bubbletext-text');
        if (existing) existing.remove();
        return;
    }
    _bubbleTextRenderText(el, _bubbleTextAreaFor(el));
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

// モーダルで指定した内容を、選択中のフキダシ(el)へ適用する（textbox-*・h2タイプ共通の入口）。
// rx/ryは変更しない（箱のサイズはハンドル操作、またはtextbox-*の既存サイズをそのまま使う）。
async function applyBubbleTextToShape(el, { text, fontSizePt, textAlign, fontFamily, vertical, textColor, fillColor, borderEnabled }) {
    const overlaySvgEl = el.ownerSVGElement || el.closest('svg');
    if (!overlaySvgEl) return null;

    pushHistory();

    const fontSizeSvg = Math.round((fontSizePt || 150) * BUBBLE_TEXT_PT_TO_SVG);
    const ff = fontFamily || el.dataset.fontFamily || state.balloon.fontFamily || 'BIZ UDPGothic';

    el.dataset.bubbleText = text;
    el.dataset.fontFamily = ff;
    el.dataset.fontSizeSvg = fontSizeSvg;
    el.dataset.textAlign = textAlign || 'center';
    el.dataset.bubbleTextVertical = vertical ? '1' : '0';
    el.dataset.textColor = textColor || '#000000';

    const kind = _bubbleTextShapeKind(el.dataset.shapeType);
    if (kind) {
        // textbox-*: 塗り・線もこのモーダルで管理する（h2タイプはbox-color/border-color UIに任せる）
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
    } else {
        updateShapePath(el); // h2タイプ: _updateH2ShapePath経由でテキストが同期される
    }

    if (state.selectedShapeId === el.id) renderHandles(el);

    await _bubbleTextSaveFor(el, overlaySvgEl);

    return el;
}

// モーダル内のフォント選択(Google/システム/カテゴリのタブ切替)を初期化する。
// レイアウトタブの#font-family周り（09a-balloon-init.js/09d-balloon-tools.js）と同じ
// データソース（_fontMgrGoogleList/queryLocalFonts/_fontMgr.favorites）を使うが、
// グローバルな#font-family固定ではなくモーダル内の要素を対象にした独立実装
// （モーダルは開閉のたびにDOMを作り直すため、対象要素を都度この関数へ渡す）。
function _bubbleTextInitFontTabs(dialog, preferredFont) {
    const tabs = dialog.querySelectorAll('.btm-font-tab');
    const favCatSel = dialog.querySelector('#btm-font-fav-cat');
    const reloadBtn = dialog.querySelector('#btm-font-reload');
    const fontSel = dialog.querySelector('#btm-font-family');

    const setOptions = (names, emptyKey) => {
        fontSel.innerHTML = '';
        if (names.length === 0) {
            const opt = document.createElement('option');
            opt.textContent = t(emptyKey);
            opt.disabled = true;
            fontSel.appendChild(opt);
            return;
        }
        names.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            fontSel.appendChild(opt);
        });
    };

    const loadGoogle = () => {
        setOptions(typeof _fontMgrGoogleList === 'function' ? _fontMgrGoogleList() : [], 'fontsel.noCategoryFonts');
    };

    const loadSystem = async () => {
        if (!window.queryLocalFonts) { setOptions([], 'fontsel.noLocalFontApi'); return; }
        try {
            const fonts = await window.queryLocalFonts();
            const families = [...new Set(fonts.map(f => f.family))].sort((a, b) => a.localeCompare(b));
            setOptions(families, 'fontsel.noCategoryFonts');
        } catch (err) {
            fontSel.innerHTML = '';
            const opt = document.createElement('option');
            opt.textContent = t('fontsel.fetchFailed', err.message);
            opt.disabled = true;
            fontSel.appendChild(opt);
        }
    };

    const loadFavorites = (category) => {
        const cats = category ? [category] : Object.keys(_fontMgr.favorites);
        const names = [...new Set(cats.flatMap(c => _fontMgr.favorites[c] || []))].sort((a, b) => a.localeCompare(b));
        setOptions(names, 'fontsel.noCategoryFonts');
    };

    const syncFavCatSelect = () => {
        const cats = typeof _fontMgrCatNames === 'function' ? _fontMgrCatNames() : [];
        favCatSel.innerHTML = `<option value="">${t('layout.fontCatAll')}</option>`;
        cats.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = typeof _fontMgrCatLabel === 'function' ? _fontMgrCatLabel(cat) : cat;
            favCatSel.appendChild(opt);
        });
    };

    const activateTab = (tab) => {
        tabs.forEach(t2 => t2.classList.remove('active-font-tab'));
        tab.classList.add('active-font-tab');
    };

    tabs.forEach(tab => {
        tab.addEventListener('click', async () => {
            activateTab(tab);
            const src = tab.dataset.src;
            favCatSel.style.display = src === 'favorites' ? '' : 'none';
            reloadBtn.style.display = src === 'system' ? '' : 'none';
            if (src === 'google') loadGoogle();
            else if (src === 'system') await loadSystem();
            else {
                if (typeof _fontMgrLoad === 'function') _fontMgrLoad();
                syncFavCatSelect();
                loadFavorites(favCatSel.value);
            }
        });
    });
    favCatSel.addEventListener('change', () => loadFavorites(favCatSel.value));
    reloadBtn.addEventListener('click', () => loadSystem());

    // 初期表示はGoogleタブ。現在値がリストに無い場合（システムフォント等）は
    // 先頭に追加して選択できるようにする
    loadGoogle();
    if (preferredFont) {
        const exists = Array.from(fontSel.options).some(o => o.value === preferredFont);
        if (!exists) {
            const opt = document.createElement('option');
            opt.value = preferredFont;
            opt.textContent = preferredFont;
            fontSel.insertBefore(opt, fontSel.firstChild);
        }
        fontSel.value = preferredFont;
    }
}

// ============================================================
// モーダルUI（text-style-modal.js と同じ「動的<div>生成」パターン）
// existingEl（選択中のフキダシ）は必須。呼び出し元(09a-balloon-init.js)で
// フキダシ未選択時はアラートを出してこの関数を呼ばない。
// ============================================================

function openBubbleTextModal(existingEl) {
    if (!existingEl) return;

    const isTextboxKind = !!_bubbleTextShapeKind(existingEl.dataset.shapeType);
    const hasText = !!(existingEl.dataset.bubbleText && existingEl.dataset.bubbleText.trim());
    let textAlign = existingEl.dataset.textAlign || 'center';
    let isVertical = existingEl.dataset.bubbleTextVertical === '1';

    const overlay = document.createElement('div');
    overlay.className = 'tsm-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'tsm-dialog btm-dialog';
    dialog.innerHTML = `
        <div class="tsm-header">
            <h3>${t(hasText ? 'bubbleText.modalTitleEdit' : 'bubbleText.modalTitle')}</h3>
            <button type="button" id="btm-close-btn" class="tsm-close-btn" title="${t('common.close')}">×</button>
        </div>
        <div class="tsm-body btm-body">
            <div class="btm-controls">
                <div class="fontmgr-style-group" style="flex-direction:column; align-items:stretch;">
                    <label class="fontmgr-style-group-label">${t('bubbleText.textLabel')}</label>
                    <textarea id="btm-text-input" placeholder="${t('bubbleText.textPlaceholder')}" rows="5"></textarea>
                </div>
                <div class="fontmgr-style-group">
                    <label>${t('bubbleText.fontSizeLabel')}</label>
                    <input type="number" id="btm-font-size" min="10" max="999" value="150" style="width:60px;" />
                    <label style="margin-left:10px; display:flex; align-items:center; gap:4px;">
                        <input type="checkbox" id="btm-vertical" /> ${t('bubbleText.verticalLabel')}
                    </label>
                    <label style="margin-left:10px;">${t('bubbleText.textColorLabel')}</label>
                    <select id="btm-text-color">
                        <option value="#000000">${t('common.black')}</option>
                        <option value="#FFFFFF">${t('common.white')}</option>
                        <option value="#FF0000">${t('common.red')}</option>
                        <option value="#0000FF">${t('common.blue')}</option>
                    </select>
                </div>
                ${isTextboxKind ? `
                <div class="fontmgr-style-group">
                    <label>${t('bubbleText.fillColorLabel')}</label>
                    <input type="color" id="btm-fill-color" value="#FFFFFF" />
                    <label style="margin-left:10px; display:flex; align-items:center; gap:4px;">
                        <input type="checkbox" id="btm-border-enable" checked /> ${t('bubbleText.borderLabel')}
                    </label>
                </div>` : ''}
                <div class="fontmgr-style-group">
                    <label class="fontmgr-style-group-label" id="btm-align-label">${t('font.alignLabel')}</label>
                    <div class="btm-shape-btns">
                        <button type="button" class="btn small secondary btm-align-btn" data-align="left"></button>
                        <button type="button" class="btn small secondary btm-align-btn" data-align="center">${t('font.alignCenter')}</button>
                        <button type="button" class="btn small secondary btm-align-btn" data-align="right"></button>
                    </div>
                </div>
                <div class="fontmgr-style-group" style="flex-direction:column; align-items:stretch;">
                    <label class="fontmgr-style-group-label">${t('bubbleText.fontLabel')}</label>
                    <div class="btm-font-tabs">
                        <span class="font-source-tab btm-font-tab active-font-tab" data-src="google" style="color:#66bb6a;">Google</span>
                        <span class="font-source-tab btm-font-tab" data-src="system" style="color:#4fc3f7;" data-i18n="layout.fontTabSystem">${t('layout.fontTabSystem')}</span>
                        <span class="font-source-tab btm-font-tab" data-src="favorites" style="color:#ff6e40;">${t('layout.fontTabCategory')}</span>
                        <select id="btm-font-fav-cat" style="display:none; font-size:11px; max-width:90px;">
                            <option value="">${t('layout.fontCatAll')}</option>
                        </select>
                        <span id="btm-font-reload" style="display:none; font-size:11px; cursor:pointer; color:#0066cc; text-decoration:underline; white-space:nowrap;">${t('layout.reloadFonts')}</span>
                    </div>
                    <select id="btm-font-family"></select>
                </div>
            </div>
        </div>
        <div class="tsm-footer">
            <button type="button" id="btm-cancel-btn" class="btn secondary">${t('common.cancel')}</button>
            <button type="button" id="btm-create-btn" class="btn primary">${t(hasText ? 'bubbleText.updateBtn' : 'bubbleText.createBtn')}</button>
        </div>
    `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const $ = id => dialog.querySelector('#' + id);

    // 整列ボタンのラベルは横書き=左/中央/右、縦書き=上/中央/下（各列内での位置の意味になるため）
    const syncAlignLabels = () => {
        const leftBtn = dialog.querySelector('.btm-align-btn[data-align="left"]');
        const rightBtn = dialog.querySelector('.btm-align-btn[data-align="right"]');
        leftBtn.textContent = isVertical ? t('bubbleText.alignTop') : t('font.alignLeft');
        rightBtn.textContent = isVertical ? t('bubbleText.alignBottom') : t('font.alignRight');
    };
    syncAlignLabels();

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

    const vertCheck = $('btm-vertical');
    vertCheck.checked = isVertical;
    vertCheck.addEventListener('change', () => {
        isVertical = vertCheck.checked;
        syncAlignLabels();
    });

    // フォント選択（Google/システム/カテゴリのタブ切替。レイアウトタブのテキストツールと同じ構成）
    const preferredFont = existingEl.dataset.fontFamily || state.balloon.fontFamily;
    _bubbleTextInitFontTabs(dialog, preferredFont);

    $('btm-text-input').value = existingEl.dataset.bubbleText || '';
    $('btm-font-size').value = Math.round((parseFloat(existingEl.dataset.fontSizeSvg) || 0) / BUBBLE_TEXT_PT_TO_SVG) || 150;
    const presetColors = ['#000000', '#FFFFFF', '#FF0000', '#0000FF'];
    const curTextColor = existingEl.dataset.textColor || '#000000';
    $('btm-text-color').value = presetColors.includes(curTextColor.toUpperCase()) ? curTextColor.toUpperCase() : '#000000';

    if (isTextboxKind) {
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
            text,
            fontSizePt: parseInt($('btm-font-size').value, 10) || 150,
            textAlign,
            fontFamily: $('btm-font-family').value || undefined,
            vertical: isVertical,
            textColor: $('btm-text-color').value,
        };
        if (isTextboxKind) {
            params.fillColor = $('btm-fill-color').value;
            params.borderEnabled = $('btm-border-enable').checked;
        }
        await applyBubbleTextToShape(existingEl, params);
        closeAndCleanup();
    });

    setTimeout(() => $('btm-text-input').focus(), 50);
}

// フキダシ（textbox-* または h2タイプ）をダブルクリックするとテキスト内包/編集モーダルを開けるようにする。
// 09e-text-tool.js の dblclick(テキスト単体の再編集ダイアログ)と同じsvgEl・同じイベントを奪い合うため、
// キャプチャフェーズで先取りしてstopImmediatePropagationし、テキストダイアログが二重に開かないようにする
let _bubbleTextDblClickHandler = null;
function initBubbleTextTools(svgEl) {
    if (!svgEl) return;
    if (_bubbleTextDblClickHandler) svgEl.removeEventListener('dblclick', _bubbleTextDblClickHandler, true);
    _bubbleTextDblClickHandler = (e) => {
        const shape = e.target.closest('.balloon-shape');
        if (!shape || !_bubbleTextCanHoldText(shape.dataset.shapeType)) return;
        if (typeof _isObjectLocked === 'function' && _isObjectLocked(shape)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        openBubbleTextModal(shape);
    };
    svgEl.addEventListener('dblclick', _bubbleTextDblClickHandler, true);
}

window.openBubbleTextModal = openBubbleTextModal;
