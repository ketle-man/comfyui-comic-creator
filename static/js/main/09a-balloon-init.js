// ============================================================
// フキダシ管理 分割ファイル (1/5): フキダシ管理初期化(initBalloonManager)
// 元 09-balloons.js（分割前）の行 1-599 に相当
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: initBalloonManager
// ============================================================

// ==============================
// フキダシ管理
// ==============================

function initBalloonManager() {
    const textBtn = document.getElementById('toggle-text-btn');

    if (textBtn) {
        textBtn.addEventListener('click', () => {
            state.balloon.isTextMode = !state.balloon.isTextMode;
            if (state.balloon.isTextMode) {
                state.balloon.isDrawMode = false;
                state.balloon.isEditMode = false;
            }
            updateBalloonUI();
        });
    }

    const editBtn = document.getElementById('toggle-edit-btn');
    if (editBtn) {
        editBtn.addEventListener('click', () => {
            state.balloon.isEditMode = !state.balloon.isEditMode;
            if (state.balloon.isEditMode) {
                state.balloon.isTextMode = false;
            }
            updateBalloonUI();
        });
    }

    const shapeType = document.getElementById('shape-type');
    if (shapeType) {
        shapeType.addEventListener('change', (e) => state.balloon.shapeType = e.target.value);
    }

    const boxColor = document.getElementById('box-color');
    if (boxColor) {
        boxColor.addEventListener('input', (e) => {
            state.balloon.color = e.target.value;
            const boxColorSerif2 = document.getElementById('box-color-serif');
            if (boxColorSerif2) boxColorSerif2.value = e.target.value;
            if (state.selectedShapeId) {
                const el = document.getElementById(state.selectedShapeId);
                if (el) el.setAttribute('fill', e.target.value);
            }
        });
        boxColor.addEventListener('change', () => {
            if (state.selectedShapeId) {
                const el = document.getElementById(state.selectedShapeId);
                if (el && el.ownerSVGElement) saveShapeSvg(el.ownerSVGElement);
            }
        });
    }

    const borderColor = document.getElementById('border-color');
    if (borderColor) {
        borderColor.addEventListener('input', (e) => {
            state.balloon.borderColor = e.target.value;
            const borderColorSerif2 = document.getElementById('border-color-serif');
            if (borderColorSerif2) borderColorSerif2.value = e.target.value;
            if (state.selectedShapeId) {
                const el = document.getElementById(state.selectedShapeId);
                if (el) el.setAttribute('stroke', e.target.value);
            }
        });
        borderColor.addEventListener('change', () => {
            if (state.selectedShapeId) {
                const el = document.getElementById(state.selectedShapeId);
                if (el && el.ownerSVGElement) saveShapeSvg(el.ownerSVGElement);
            }
        });
    }

    const borderWidthInput = document.getElementById('border-width');
    if (borderWidthInput) {
        borderWidthInput.addEventListener('input', (e) => {
            const val = Math.max(0, parseFloat(e.target.value) || 0);
            state.balloon.borderWidth = val;
            const borderWidthSerif2 = document.getElementById('border-width-serif');
            if (borderWidthSerif2) borderWidthSerif2.value = val;
            if (state.selectedShapeId) {
                const el = document.getElementById(state.selectedShapeId);
                if (el) el.setAttribute('stroke-width', val);
            }
        });
        borderWidthInput.addEventListener('change', () => {
            if (state.selectedShapeId) {
                const el = document.getElementById(state.selectedShapeId);
                if (el && el.ownerSVGElement) saveShapeSvg(el.ownerSVGElement);
            }
        });
    }

    const flipHBtn = document.getElementById('flip-h-btn');
    if (flipHBtn) {
        flipHBtn.addEventListener('click', () => flipSelected('h'));
    }

    const flipVBtn = document.getElementById('flip-v-btn');
    if (flipVBtn) {
        flipVBtn.addEventListener('click', () => flipSelected('v'));
    }

    const fontFamily = document.getElementById('font-family');
    if (fontFamily) {
        fontFamily.addEventListener('change', async (e) => {
            state.balloon.fontFamily = e.target.value;
            // 選択中のテキスト要素に即時反映
            if (state.selectedTextEl) {
                state.selectedTextEl.setAttribute('font-family', e.target.value);
                const panelSvgEl = getPanelLayerSvg();
                if (panelSvgEl) {
                    const panelId = state.selectedTextEl.closest('g[data-clip-panel]')?.getAttribute('data-clip-panel') || state.selectedPanelId || 'panel-0';
                    await savePanelSvg(panelId, panelSvgEl);
                }
            }
        });
    }

    // フォントソースタブ切り替え（Google / システム / カテゴリ）
    const fontTabGoogle = document.getElementById('font-tab-google');
    const fontTabSystem = document.getElementById('font-tab-system');
    const fontTabFavorites = document.getElementById('font-tab-favorites');
    const loadSystemFontsBtn = document.getElementById('load-system-fonts-btn');
    const fontGroupGoogle = document.getElementById('font-group-google');
    const fontFavCatSelect = document.getElementById('font-fav-cat-select');

    // Google Fontsのoptgroupをフォント管理タブと共通のGOOGLE_FONT_FAMILIESから生成
    _loadGoogleFontsToSelect();
    // お気に入りデータをロードし、絞り込み用のカテゴリセレクトを同期
    _fontMgrLoad();
    _syncFontFavCatSelect();

    function activateFontTab(tab) {
        // 背景色はCSS（.font-source-tab / .active-font-tab のダークグレー）に任せ、
        // インラインstyleでは上書きしない
        document.querySelectorAll('.font-source-tab').forEach(t => {
            t.style.background = '';
            t.classList.remove('active-font-tab');
        });
        tab.style.background = '';
        tab.classList.add('active-font-tab');
    }

    if (fontTabGoogle) {
        fontTabGoogle.addEventListener('click', () => {
            activateFontTab(fontTabGoogle);
            const sysGroup = document.getElementById('font-group-system');
            if (sysGroup) sysGroup.remove();
            const favGroup = document.getElementById('font-group-favorites');
            if (favGroup) favGroup.remove();
            if (fontGroupGoogle) fontGroupGoogle.style.display = '';
            if (loadSystemFontsBtn) loadSystemFontsBtn.style.display = 'none';
            if (fontFavCatSelect) fontFavCatSelect.style.display = 'none';
        });
    }

    if (fontTabSystem) {
        fontTabSystem.addEventListener('click', async () => {
            activateFontTab(fontTabSystem);
            if (fontGroupGoogle) fontGroupGoogle.style.display = 'none';
            const favGroup = document.getElementById('font-group-favorites');
            if (favGroup) favGroup.remove();
            if (fontFavCatSelect) fontFavCatSelect.style.display = 'none';
            if (loadSystemFontsBtn) loadSystemFontsBtn.style.display = '';
            await loadSystemFontsToSelect();
        });
    }

    if (fontTabFavorites) {
        fontTabFavorites.addEventListener('click', () => {
            activateFontTab(fontTabFavorites);
            if (fontGroupGoogle) fontGroupGoogle.style.display = 'none';
            const sysGroup = document.getElementById('font-group-system');
            if (sysGroup) sysGroup.remove();
            if (loadSystemFontsBtn) loadSystemFontsBtn.style.display = 'none';
            if (fontFavCatSelect) fontFavCatSelect.style.display = '';
            // フォント管理タブ側での追加/削除を反映
            _fontMgrLoad();
            _syncFontFavCatSelect();
            _loadFavoriteFontsToSelect(fontFavCatSelect ? fontFavCatSelect.value : '');
        });
    }

    if (fontFavCatSelect) {
        fontFavCatSelect.addEventListener('change', () => {
            if (document.getElementById('font-group-favorites')) {
                _loadFavoriteFontsToSelect(fontFavCatSelect.value);
            }
        });
    }

    if (loadSystemFontsBtn) {
        loadSystemFontsBtn.addEventListener('click', async () => {
            await loadSystemFontsToSelect();
        });
    }

    const textVertical = document.getElementById('text-vertical');
    if (textVertical) {
        textVertical.addEventListener('change', async (e) => {
            state.balloon.isVertical = e.target.checked;
            // 選択中のテキスト要素に即時反映（font-size と同じパターン、中心位置を保って切り替え）
            if (state.selectedTextEl) {
                _setTextElVertical(state.selectedTextEl, e.target.checked, true);
                const panelSvgEl = getPanelLayerSvg();
                if (panelSvgEl) {
                    renderTextHandles(state.selectedTextEl, panelSvgEl);
                    const panelId = state.selectedTextEl.closest('g[data-clip-panel]')?.getAttribute('data-clip-panel') || state.selectedPanelId || 'panel-0';
                    await savePanelSvg(panelId, panelSvgEl);
                }
            }
        });
    }

    const fontSize = document.getElementById('font-size');
    if (fontSize) {
        fontSize.addEventListener('change', async (e) => {
            const pt = parseInt(e.target.value, 10);
            if (isNaN(pt)) return;
            state.balloon.fontSize = pt;
            // 選択中のテキスト要素に即時反映
            if (state.selectedTextEl) {
                const PT_TO_SVG = 3.528;
                const svgSize = Math.round(pt * PT_TO_SVG);
                const panelSvgEl = getPanelLayerSvg();
                // スタイル（線・袋文字・影）はフォントサイズ相対値(v2)なので、サイズ変更前に
                // 現在の見た目を相対値として取り出し、変更後に掛け直して太さ・影を追従させる
                let styleObj = null;
                if (panelSvgEl && (state.selectedTextEl.getAttribute('stroke') || state.selectedTextEl.dataset.styleFilterId)) {
                    styleObj = _fontMgrExtractStyleFromTextEl(state.selectedTextEl, panelSvgEl);
                }
                state.selectedTextEl.setAttribute('font-size', svgSize);
                if (styleObj) _fontMgrApplyStyleAttrsToTextEl(state.selectedTextEl, panelSvgEl, styleObj);
                if (panelSvgEl) renderTextHandles(state.selectedTextEl, panelSvgEl);
                if (panelSvgEl) {
                    const panelId = state.selectedTextEl.closest('g[data-clip-panel]')?.getAttribute('data-clip-panel') || state.selectedPanelId || 'panel-0';
                    await savePanelSvg(panelId, panelSvgEl);
                }
            }
        });
    }

    // 色はプリセット（黒/白/赤/青）のみ。任意色はスタイルモーダルの「塗り」で設定する
    const colorPreset = document.getElementById('color-preset');

    function applyTextColorToSelected(color) {
        if (!state.selectedTextEl) return;
        state.selectedTextEl.setAttribute('fill', color);
        const svgEl = getPanelLayerSvg();
        if (svgEl) saveTextSvg(svgEl);
    }

    if (colorPreset) {
        colorPreset.addEventListener('change', (e) => {
            state.balloon.textColor = e.target.value;
            applyTextColorToSelected(e.target.value);
        });
    }

    // 「スタイル」ボタン: フォントタブと同じ線・袋文字・影の設定モーダルを開く
    // Imageタブがアクティブな場合はImageタブのテキストレイヤーへ、それ以外はレイアウトタブのSVGテキストへ適用する
    document.getElementById('text-style-modal-btn')?.addEventListener('click', () => {
        if (typeof window.openTextStyleModal !== 'function') return;

        if (document.querySelector('.tab-btn.active')?.dataset.tab === 'image') {
            if (!window._ccImageTab) return;
            const info = window._ccImageTab.getSelectedTextStyleInfo();
            window.openTextStyleModal({
                fontFamily: info.fontFamily,
                previewSize: info.fontSize,
                initialStyle: info.style,
                onApply: (style) => {
                    if (window._ccImageTab.hasSelectedTextLayer()) {
                        window._ccImageTab.applyFontStyleToSelection(style);
                    } else {
                        window._ccImageTab.insertFontStylePlaceholder(style);
                    }
                },
            });
            return;
        }

        const fontFamily = state.selectedTextEl?.getAttribute('font-family') || state.balloon.fontFamily || 'Zen Antique';
        // previewSize はSVG単位のまま渡す（スタイルの線幅・袋文字幅・影はSVG単位で適用されるため、
        // pt換算で渡すとプレビューと実表示で線の相対的な太さがズレる）
        const PT_TO_SVG = 3.528;
        let initialStyle = null;
        let previewSize = Math.round((state.balloon.fontSize || 150) * PT_TO_SVG);
        if (state.selectedTextEl) {
            const svgEl = getPanelLayerSvg();
            initialStyle = _fontMgrExtractStyleFromTextEl(state.selectedTextEl, svgEl);
            const svgFontSize = parseFloat(state.selectedTextEl.getAttribute('font-size'));
            if (!isNaN(svgFontSize)) previewSize = Math.round(svgFontSize);
        }
        window.openTextStyleModal({
            fontFamily,
            previewSize,
            initialStyle,
            onApply: async (style) => {
                if (state.selectedTextEl) await applyStyleToSelectedText(style);
                else await insertStylePlaceholderText(style);
            },
        });
    });

    const panelSelect = document.getElementById('balloon-panel-select');
    if (panelSelect) {
        panelSelect.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val === '__overlay__') {
                selectOverlay();
            } else if (val) {
                state.selectedPanelId = val;
                state.selectedOverlay = false;
            } else {
                state.selectedPanelId = null;
                state.selectedOverlay = false;
            }
            renderLayoutTab();
        });
    }

    // テキストタブ専用のUIイベント
    const undoBtn = document.getElementById('text-undo-btn');
    if (undoBtn) undoBtn.addEventListener('click', undo);

    const saveBtn = document.getElementById('text-save-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            const panelSvgEl = getPanelLayerSvg();
            if (panelSvgEl) {
                await savePanelSvg(state.selectedPanelId || 'panel-0', panelSvgEl);
                alert(t('textTool.textSaved'));
            }
        });
    }

    // テキスト→PNG変換ボタン
    const textToPngBtn = document.getElementById('text-to-png-btn');
    if (textToPngBtn) {
        textToPngBtn.addEventListener('click', () => convertTextToPng());
    }

    // スクリプトセリフ挿入ボタン
    const scriptInsertBtn = document.getElementById('script-dialogue-insert-btn');
    if (scriptInsertBtn) {
        scriptInsertBtn.addEventListener('click', () => insertScriptDialogueText());
    }


    // セリフタブ用フキダシ枠線コントロール
    const boxColorSerif = document.getElementById('box-color-serif');
    if (boxColorSerif) {
        boxColorSerif.addEventListener('input', (e) => {
            state.balloon.color = e.target.value;
            const boxColorLayout = document.getElementById('box-color');
            if (boxColorLayout) boxColorLayout.value = e.target.value;
            if (state.selectedShapeId) {
                const el = document.getElementById(state.selectedShapeId);
                if (el) el.setAttribute('fill', e.target.value);
            }
        });
        boxColorSerif.addEventListener('change', () => {
            if (state.selectedShapeId) {
                const el = document.getElementById(state.selectedShapeId);
                if (el && el.ownerSVGElement) saveShapeSvg(el.ownerSVGElement);
            }
        });
    }

    const borderColorSerif = document.getElementById('border-color-serif');
    if (borderColorSerif) {
        borderColorSerif.addEventListener('input', (e) => {
            state.balloon.borderColor = e.target.value;
            const borderColorLayout = document.getElementById('border-color');
            if (borderColorLayout) borderColorLayout.value = e.target.value;
            if (state.selectedShapeId) {
                const el = document.getElementById(state.selectedShapeId);
                if (el) el.setAttribute('stroke', e.target.value);
            }
        });
        borderColorSerif.addEventListener('change', () => {
            if (state.selectedShapeId) {
                const el = document.getElementById(state.selectedShapeId);
                if (el && el.ownerSVGElement) saveShapeSvg(el.ownerSVGElement);
            }
        });
    }

    const borderWidthSerif = document.getElementById('border-width-serif');
    if (borderWidthSerif) {
        borderWidthSerif.addEventListener('input', (e) => {
            const val = Math.max(0, parseFloat(e.target.value) || 0);
            state.balloon.borderWidth = val;
            const borderWidthLayout = document.getElementById('border-width');
            if (borderWidthLayout) borderWidthLayout.value = val;
            if (state.selectedShapeId) {
                const el = document.getElementById(state.selectedShapeId);
                if (el) el.setAttribute('stroke-width', val);
            }
        });
        borderWidthSerif.addEventListener('change', () => {
            if (state.selectedShapeId) {
                const el = document.getElementById(state.selectedShapeId);
                if (el && el.ownerSVGElement) saveShapeSvg(el.ownerSVGElement);
            }
        });
    }

    // テキスト入力ダイアログ
    const dialogOk = document.getElementById('text-input-ok');
    const dialogCancel = document.getElementById('text-input-cancel');
    const textInputField = document.getElementById('text-input-field');

    if (textInputField) {
        const stop = (e) => { e.stopImmediatePropagation(); };
        textInputField.addEventListener('keydown', stop, true);
        textInputField.addEventListener('keyup', stop, true);
        textInputField.addEventListener('keypress', stop, true);

        textInputField.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                document.getElementById('text-input-dialog').style.display = 'none';
                state.pendingTextPosition = null;
            }
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                applyTextInput();
            }
        });

        textInputField.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });
    }

    if (dialogCancel) {
        dialogCancel.addEventListener('click', () => {
            document.getElementById('text-input-dialog').style.display = 'none';
            state.pendingTextPosition = null;
        });
    }

    if (dialogOk) {
        dialogOk.addEventListener('click', applyTextInput);
    }

    // ── h2フキダシ挿入ボタン ──
    const h2InsertBtn = document.getElementById('h2-insert-btn');
    if (h2InsertBtn) {
        h2InsertBtn.addEventListener('click', async () => {
            const h2TypeSel = document.getElementById('h2-shape-type');
            const sel = h2TypeSel ? h2TypeSel.value : 'normal';
            // rect-legacy は旧来のrect（角丸矩形）として挿入
            const insertType = sel === 'rect-legacy' ? 'rect' : sel;
            await insertSmartBalloonTemplate(insertType);
        });
    }

    // ── 選択中フキダシをPNG画像に変換するボタン ──
    const h2ToImageBtn = document.getElementById('h2-to-image-btn');
    if (h2ToImageBtn) {
        h2ToImageBtn.addEventListener('click', async () => {
            if (!state.selectedShapeId) return;
            const el = document.getElementById(state.selectedShapeId);
            const svgEl = el ? (el.ownerSVGElement || el.closest('svg')) : null;
            if (!el || !svgEl) return;
            await convertShapeToImage(el, svgEl);
        });
    }

    // ── h2専用パラメータスライダー ──
    // h2タイプのデータを更新して再描画する共通ヘルパー
    function _h2Update(dataKey, value, textId, suffix) {
        const el = state.selectedShapeId ? document.getElementById(state.selectedShapeId) : null;
        if (!el) return;
        const type = el.dataset.shapeType;
        if (type !== 'bomb' && type !== 'thought' && type !== 'normal' && type !== 'rect') return;
        el.dataset[dataKey] = value;
        const textEl = document.getElementById(textId);
        if (textEl) textEl.textContent = Math.round(value) + (suffix || '');
        _updateH2ShapePath(el);
        _updateH2HandlePositions(el);
    }
    function _h2Save() {
        const el = state.selectedShapeId ? document.getElementById(state.selectedShapeId) : null;
        if (!el) return;
        const svgEl = el.ownerSVGElement || el.closest('svg');
        if (svgEl) saveShapeSvg(svgEl);
    }

    const h2Params = [
        ['h2-tail-angle',  'tailAngleDeg',       'h2-tail-angle-val',       '°'],
        ['h2-tail-length', 'tailLength',          'h2-tail-length-val',      '' ],
        ['h2-tail-width',  'tailWidth',           'h2-tail-width-val',       '°'],
        ['h2-tail-curve',  'tailCurve',           'h2-tail-curve-val',       '' ],
        ['h2-seed',           'seed',             'h2-seed-val',             '' ],
        ['h2-spike-count',    'spikeCount',       'h2-spike-count-val',      '' ],
        ['h2-spike-level',    'spikeLevel',       'h2-spike-level-val',      '' ],
        ['h2-spike-variance', 'spikeVariance',    'h2-spike-variance-val',   '' ],
        ['h2-thought-bubble', 'thoughtBubbleSize','h2-thought-bubble-val',   '' ],
        ['h2-thought-count',  'thoughtBubbleCount','h2-thought-count-val',  '' ],
        ['h2-thought-offset', 'thoughtBubbleOffset','h2-thought-offset-val', '' ],
        ['h2-rect-radius',    'rectRadius',       'h2-rect-radius-val',      '' ],
    ];
    h2Params.forEach(([inputId, dataKey, textId, suffix]) => {
        const inp = document.getElementById(inputId);
        if (!inp) return;
        inp.addEventListener('input', (e) => _h2Update(dataKey, parseFloat(e.target.value), textId, suffix));
        inp.addEventListener('change', _h2Save);
    });

    // カーブON/OFFチェックボックス
    const cbCurve = document.getElementById('h2-tail-curve-on');
    if (cbCurve) {
        cbCurve.addEventListener('change', (e) => {
            const el = state.selectedShapeId ? document.getElementById(state.selectedShapeId) : null;
            if (!el) return;
            const on = e.target.checked;
            el.dataset.tailCurveOn = on ? '1' : '0';
            const slider = document.getElementById('h2-tail-curve');
            if (slider) slider.disabled = !on;
            _updateH2ShapePath(el);
            if (state.balloon.isEditMode) _updateH2HandlePositions(el);
            const svgEl = el.ownerSVGElement;
            if (svgEl) saveShapeSvg(svgEl);
        });
    }

    // h2の種類セレクト変更: 選択中フキダシの種類を変更
    const h2TypeSel = document.getElementById('h2-shape-type');
    if (h2TypeSel) {
        h2TypeSel.addEventListener('change', (e) => {
            const el = state.selectedShapeId ? document.getElementById(state.selectedShapeId) : null;
            if (!el) return;
            const cur = el.dataset.shapeType;
            if (cur !== 'bomb' && cur !== 'thought' && cur !== 'normal' && cur !== 'rect') return;
            const newType = e.target.value;
            if (newType === 'oval' || newType === 'bubble' || newType === 'spiky') return; // 旧来タイプへの変換は不可
            el.dataset.shapeType = newType;
            // 各タイプ用データの初期設定
            if (newType === 'bomb' && !el.dataset.seed) {
                el.dataset.seed = Math.floor(Math.random() * 100) + 1;
                el.dataset.spikeCount = 24;
                el.dataset.spikeLevel = 30;
                el.dataset.spikeVariance = 30;
            } else if (newType === 'thought' && !el.dataset.thoughtBubbleSize) {
                el.dataset.thoughtBubbleSize = 800;
            } else if (newType === 'rect' && !el.dataset.rectRadius) {
                el.dataset.rectRadius = 80;
            }
            _updateH2ShapePath(el);
            _updateH2HandlePositions(el);
            _syncH2UI(el);
            _showH2TypeParams(newType);
            _h2Save();
        });
    }

    // h2の色変更：box-color/border-color/border-widthも共通利用するが
    // h2タイプは dataset.fillColor/strokeColor/borderWidth で管理
    const boxColorEl = document.getElementById('box-color');
    const borderColorEl = document.getElementById('border-color');
    const borderWidthEl = document.getElementById('border-width');
    // 既存のhandlerでは el.setAttribute('fill',...) するが h2はg要素なので上書き
    // renderHandlesで色同期済み。ここでは h2 データ属性への反映を追加
    const _isH2Type = (t) => t === 'bomb' || t === 'thought' || t === 'normal' || t === 'rect';
    if (boxColorEl) {
        boxColorEl.addEventListener('input', (e) => {
            const el = state.selectedShapeId ? document.getElementById(state.selectedShapeId) : null;
            if (el && _isH2Type(el.dataset.shapeType)) {
                el.dataset.fillColor = e.target.value;
                _updateH2ShapePath(el);
            }
        });
    }
    if (borderColorEl) {
        borderColorEl.addEventListener('input', (e) => {
            const el = state.selectedShapeId ? document.getElementById(state.selectedShapeId) : null;
            if (el && _isH2Type(el.dataset.shapeType)) {
                el.dataset.strokeColor = e.target.value;
                _updateH2ShapePath(el);
            }
        });
    }
    if (borderWidthEl) {
        borderWidthEl.addEventListener('input', (e) => {
            const val = Math.max(0, parseFloat(e.target.value) || 0);
            const el = state.selectedShapeId ? document.getElementById(state.selectedShapeId) : null;
            if (el && _isH2Type(el.dataset.shapeType)) {
                el.dataset.borderWidth = val;
                _updateH2ShapePath(el);
            }
        });
    }

    // ── カスタムSVG画像（アセット由来のフキダシSVG等）の配置後 fill/stroke 変更 ──
    // フキダシ非選択時にSVG由来の inserted-image が選択されていれば、
    // 塗り色/枠色ピッカーをそのSVGの色一括変更として適用する
    const _svgImageColorTarget = () => {
        if (state.selectedShapeId) return null; // フキダシ選択中は従来動作を優先
        const el = state.selectedImageEl;
        return (typeof _isSvgImageEl === 'function' && _isSvgImageEl(el)) ? el : null;
    };
    [['box-color', 'fill'], ['box-color-serif', 'fill'],
     ['border-color', 'stroke'], ['border-color-serif', 'stroke']].forEach(([id, kind]) => {
        const inp = document.getElementById(id);
        if (!inp) return;
        inp.addEventListener('input', (e) => {
            const el = _svgImageColorTarget();
            if (el) applySvgImageColors(el, { [kind]: e.target.value });
        });
        inp.addEventListener('change', async () => {
            const el = _svgImageColorTarget();
            if (!el) return;
            const svgEl = el.closest('svg');
            if (!svgEl) return;
            const panelId = el.closest('g[data-overlay-layer]') ? '__overlay__'
                : (el.closest('g[data-clip-panel]')?.getAttribute('data-clip-panel') || state.selectedPanelId || 'panel-0');
            await savePanelSvg(panelId, svgEl);
        });
    });
}

// h2タイプ専用パラメータパネルの表示切替
