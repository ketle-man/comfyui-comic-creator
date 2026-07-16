// ============================================================
// main.js 分割ファイル (8/24): ページ管理+ページナビゲーション+ページプレビューSVG操作+コマ単位SVG統合保存
// 元 main.js の行 5053-5897 に相当
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: _collectReferencedFilters,_layoutPageDelete,_layoutPageList,_layoutPageNav,_updatePageThumbGridActive,buildMergedSvg,createPageFromTemplate,deleteSelectedImage,initPageManager,loadPages,pushHistory,renderLayoutTab,renderPageSelector,renderPageThumbGrid,saveCurrentSvg,savePanelSvg,saveShapeSvg,saveTextSvg,switchActivePage,undo,updateLayoutPageNav
// ============================================================

// ==============================
// ページ管理
// ==============================

async function initPageManager() {
    const createPageBtn = document.getElementById('create-page-btn');
    if (createPageBtn) {
        createPageBtn.addEventListener('click', createPageFromTemplate);
    }

    // 保存: 現在のページをDBへ保存し、作業中の作品（ページグループ）に登録する
    const layoutSaveBtn = document.getElementById('layout-save-btn');
    if (layoutSaveBtn) {
        layoutSaveBtn.addEventListener('click', async () => {
            if (!state.activePage) { alert(t('page.msgNoPageToSave')); return; }
            try {
                await dbPut('pages', state.activePage);
                if (state.activeWork && _pageMgrGroups.groupOf(state.activePage.name) !== state.activeWork.name) {
                    _pageMgrGroups.assign(state.activePage.name, state.activeWork.name);
                }
                await loadPages();
                renderPageSelector();
                updateLayoutPageNav();
                alert(state.activeWork
                    ? t('page.msgSavedWithWork', state.activeWork.name)
                    : t('page.msgSaved'));
            } catch (e) {
                console.error('Page save error:', e);
                alert(t('page.msgSaveFailed', e.message));
            }
        });
    }

    // ページ送り・ページ削除
    document.getElementById('layout-page-prev')?.addEventListener('click', () => _layoutPageNav(-1));
    document.getElementById('layout-page-next')?.addEventListener('click', () => _layoutPageNav(1));
    document.getElementById('layout-page-delete')?.addEventListener('click', _layoutPageDelete);

    const panelSelect = document.getElementById('panel-select');
    if (panelSelect) {
        panelSelect.addEventListener('change', (e) => {
            if (e.target.value) selectPanel(e.target.value);
        });
    }

    const insertImgBtn = document.getElementById('insert-image-btn');
    if (insertImgBtn) {
        insertImgBtn.addEventListener('click', handleInsertImageFromLocal);
    }

    const deleteImgBtn = document.getElementById('delete-image-btn');
    if (deleteImgBtn) {
        deleteImgBtn.addEventListener('click', deleteSelectedImage);
    }

    const undoBtn = document.getElementById('undo-btn');
    if (undoBtn) {
        undoBtn.addEventListener('click', undo);
    }

    initDragAndDrop();

    // コマ枠線幅UI
    const panelBorderWidthInput = document.getElementById('panel-border-width');
    if (panelBorderWidthInput) {
        // コマ枠線polygon（コマIDに対応するもの）に stroke-width をインラインstyleで設定
        // CSSクラスより inline style が優先されるため、クラス定義のstroke-widthを上書きできる
        const setPanelPolygonStrokeWidth = (svgEl, svgWidth) => {
            if (!state.activePage || !state.activePage.panels) return;
            // コマIDのセット（panel_0はコマに含まれない）
            const panelIds = new Set(state.activePage.panels.map(p => p.id));
            svgEl.querySelectorAll('polygon:not(.panel-overlay):not(.panel-border)').forEach(poly => {
                const polyId = poly.getAttribute('id') || '';
                if (!panelIds.has(polyId)) return; // コマに対応しないpolygonはスキップ
                // inline style の stroke-width を上書き（CSSクラス定義より優先）
                const style = poly.getAttribute('style') || '';
                const newStyle = style.replace(/stroke-width\s*:\s*[^;]+;?/g, '').replace(/;$/, '').trim();
                poly.setAttribute('style', newStyle ? `${newStyle};stroke-width:${svgWidth}` : `stroke-width:${svgWidth}`);
            });
        };

        panelBorderWidthInput.addEventListener('input', (e) => {
            state.panelBorder.width = _round2(Math.max(0, parseFloat(e.target.value) || 0));
            const svgWidth = state.panelBorder.width; // svgScale=1: 値がそのままSVG座標系
            const inset = svgWidth / 2;
            const svgEl = document.querySelector('#layout-preview svg');
            if (svgEl) {
                // 選択ハイライト用 panel-border も更新
                svgEl.querySelectorAll('.panel-border').forEach(poly => {
                    poly.setAttribute('stroke-width', String(svgWidth));
                });
                // 実際の枠線 polygon をリアルタイム更新（inline styleで上書き）
                setPanelPolygonStrokeWidth(svgEl, svgWidth);
                // clipPath polygon を内側縮小（枠線の内側でクリップ）
                if (state.activePage && state.activePage.panels) {
                    state.activePage.panels.forEach(panel => {
                        if (!panel.points) return;
                        const clipId = `panel-clip-${panel.id}`;
                        const clipPoly = svgEl.querySelector(`#${clipId} polygon`);
                        if (clipPoly) {
                            clipPoly.setAttribute('points', _insetPolygonPoints(panel.points, inset));
                        }
                    });
                }
            }
        });
        // change/Enter 時: svgContent・panelSvgContent の polygon/clipPath を更新して保存
        const applyPanelBorderWidth = async () => {
            state.panelBorder.width = _round2(Math.max(0, parseFloat(panelBorderWidthInput.value) || 0));
            panelBorderWidthInput.value = state.panelBorder.width;
            if (!state.activePage) return;
            const svgWidth = state.panelBorder.width; // svgScale=1
            const inset = svgWidth / 2;

            // DOM プレビュー更新（枠線 + clipPath）
            const svgEl = document.querySelector('#layout-preview svg');
            if (svgEl) {
                svgEl.querySelectorAll('.panel-border').forEach(poly => {
                    poly.setAttribute('stroke-width', String(svgWidth));
                });
                setPanelPolygonStrokeWidth(svgEl, svgWidth);
                state.activePage.panels.forEach(panel => {
                    if (!panel.points) return;
                    const clipId = `panel-clip-${panel.id}`;
                    const clipPoly = svgEl.querySelector(`#${clipId} polygon`);
                    if (clipPoly) {
                        clipPoly.setAttribute('points', _insetPolygonPoints(panel.points, inset));
                    }
                });
            }

            // svgContent 更新: コマpolygon の inline style に stroke-width を書き込む（CSS定義より優先）
            const panelIds = new Set(state.activePage.panels.map(p => p.id));
            const parser = new DOMParser();
            const doc = parser.parseFromString(state.activePage.svgContent, 'image/svg+xml');
            doc.querySelectorAll('polygon').forEach(poly => {
                const polyId = poly.getAttribute('id') || '';
                if (!panelIds.has(polyId)) return;
                const style = poly.getAttribute('style') || '';
                const newStyle = style.replace(/stroke-width\s*:\s*[^;]+;?/g, '').replace(/;$/, '').trim();
                poly.setAttribute('style', newStyle ? `${newStyle};stroke-width:${svgWidth}` : `stroke-width:${svgWidth}`);
            });
            const serializer = new XMLSerializer();
            state.activePage.svgContent = serializer.serializeToString(doc.querySelector('svg'));

            // 各コマの panelSvgContent 内 clipPath polygon を内側縮小して保存
            for (const panel of state.activePage.panels) {
                if (!panel.points || !panel.panelSvgContent) continue;
                const clipId = `panel-clip-${panel.id}`;
                const pdoc = parser.parseFromString(panel.panelSvgContent, 'image/svg+xml');
                const clipPoly = pdoc.querySelector(`#${clipId} polygon`);
                if (clipPoly) {
                    clipPoly.setAttribute('points', _insetPolygonPoints(panel.points, inset));
                    panel.panelSvgContent = serializer.serializeToString(pdoc.querySelector('svg'));
                }
            }

            await dbPut('pages', state.activePage);
        };
        panelBorderWidthInput.addEventListener('change', applyPanelBorderWidth);
        panelBorderWidthInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') applyPanelBorderWidth();
        });
    }

    // テキストタブ用ページ/コマ選択
    const textPageSelect = document.getElementById('text-page-select');
    if (textPageSelect) {
        textPageSelect.addEventListener('change', async (e) => {
            if (e.target.value) {
                await switchActivePage(e.target.value);
            }
        });
    }

    const textPanelSelect = document.getElementById('text-panel-select');
    if (textPanelSelect) {
        textPanelSelect.addEventListener('change', (e) => {
            selectPanel(e.target.value);
        });
    }

    // テキストタブ用反転ボタン
    const textFlipHBtn = document.getElementById('text-flip-h-btn');
    if (textFlipHBtn) {
        textFlipHBtn.addEventListener('click', () => flipSelected('h'));
    }
    const textFlipVBtn = document.getElementById('text-flip-v-btn');
    if (textFlipVBtn) {
        textFlipVBtn.addEventListener('click', () => flipSelected('v'));
    }

    // 画像タブ用反転ボタン
    const imgFlipHBtn = document.getElementById('img-flip-h-btn');
    if (imgFlipHBtn) {
        imgFlipHBtn.addEventListener('click', () => flipSelected('h'));
    }
    const imgFlipVBtn = document.getElementById('img-flip-v-btn');
    if (imgFlipVBtn) {
        imgFlipVBtn.addEventListener('click', () => flipSelected('v'));
    }

    await loadPages();
    renderPageSelector();
}

async function loadPages() {
    state.pages = await dbGetAllPagesMeta();
    state.pages.sort((a, b) => b.name.localeCompare(a.name));
}

function renderPageSelector() {
    const select = document.getElementById('text-page-select');
    if (select) {
        select.innerHTML = `<option value="">${t('page.selectPageOption')}</option>`;
        state.pages.forEach(page => {
            const option = document.createElement('option');
            option.value = page.name;
            option.textContent = page.name;
            if (state.activePage && state.activePage.name === page.name) {
                option.selected = true;
            }
            select.appendChild(option);
        });
    }
    renderPageThumbGrid();
}

// アセットパネルの「ページ」タブ: サムネイル一覧を描画（クリックでそのページに切り替え）
// 作業中の作品のページのみに絞る（作品へのページ追加/所属変更はページタブで行う想定のため、ここでは一覧専用）
async function renderPageThumbGrid() {
    const grid = document.getElementById('page-thumb-grid');
    if (!grid) return;

    if (!state.activeWork) {
        grid.innerHTML = `<p class="empty-message">${t('page.msgNoActiveWork')}</p>`;
        return;
    }

    const pageMap = new Map(state.pages.map(p => [p.name, p]));
    const workPages = (_pageMgrGroups.data[state.activeWork.name] || [])
        .map(name => pageMap.get(name))
        .filter(Boolean);

    if (workPages.length === 0) {
        grid.innerHTML = `<p class="empty-message">${t('page.msgWorkNoPages')}</p>`;
        return;
    }

    grid.innerHTML = '';
    for (const pageMeta of workPages) {
        const card = document.createElement('div');
        card.className = 'page-thumb-card';
        card.dataset.pageName = pageMeta.name;
        if (state.activePage && state.activePage.name === pageMeta.name) card.classList.add('active');

        let thumbHtml = '<div class="page-thumb-card-thumb page-thumb-card-thumb-empty">No Image</div>';
        try {
            const dataUrl = await _getOrBuildPageThumb(pageMeta, 'pages');
            if (dataUrl) thumbHtml = `<div class="page-thumb-card-thumb"><img src="${dataUrl}" loading="lazy" /></div>`;
        } catch (e) { /* サムネイル生成失敗は無視 */ }

        card.innerHTML = `
            ${thumbHtml}
            <div class="page-thumb-card-name" title="${pageMeta.name}">${pageMeta.name}</div>
        `;
        card.addEventListener('click', () => switchActivePage(pageMeta.name));
        grid.appendChild(card);
    }
}

// ページ切替時、サムネイル一覧の再取得なしでハイライトのみ更新
function _updatePageThumbGridActive() {
    const grid = document.getElementById('page-thumb-grid');
    if (!grid) return;
    grid.querySelectorAll('.page-thumb-card').forEach(card => {
        card.classList.toggle('active', !!state.activePage && card.dataset.pageName === state.activePage.name);
    });
}

async function switchActivePage(pageName) {
    const pageRecord = await dbGet('pages', pageName);
    if (pageRecord) {
        state.activePage = pageRecord;
        state.selectedPanelId = null;
        state.selectedOverlay = true;
        state.history = [];
        await renderLayoutTab();
        updatePanelSelectDropdown();
        updateTemplateSidePanel(true);
        _updatePageThumbGridActive();
    }
}

// ==============================
// レイアウトのページナビゲーション（ページ送り・番号表示・削除）
// ==============================

/** ページ送りの対象リスト（作業中の作品があればそのページ順、なければ全ページの名前昇順） */
function _layoutPageList() {
    if (state.activeWork && _pageMgrGroups.data[state.activeWork.name]?.length) {
        // グループ配列の順序＝作品内ページ順
        return _pageMgrGroups.data[state.activeWork.name].slice();
    }
    return state.pages.map(p => p.name).sort((a, b) => a.localeCompare(b));
}

/** ページ番号表示とボタンの活性状態を更新する */
function updateLayoutPageNav() {
    const indicator = document.getElementById('layout-page-indicator');
    if (!indicator) return;

    const list = _layoutPageList();
    const idx = state.activePage ? list.indexOf(state.activePage.name) : -1;
    indicator.textContent = list.length === 0
        ? '- / -'
        : `${idx >= 0 ? idx + 1 : '-'} / ${list.length}`;

    const prevBtn = document.getElementById('layout-page-prev');
    const nextBtn = document.getElementById('layout-page-next');
    const delBtn = document.getElementById('layout-page-delete');
    if (prevBtn) prevBtn.disabled = list.length === 0 || idx === 0;
    if (nextBtn) nextBtn.disabled = list.length === 0 || idx === list.length - 1;
    if (delBtn) delBtn.disabled = !state.activePage;
}

/** ページ送り（delta: -1=前 / +1=次）。表示中ページがリスト外の場合は端のページへ移動する */
async function _layoutPageNav(delta) {
    const list = _layoutPageList();
    if (!list.length) return;
    const idx = state.activePage ? list.indexOf(state.activePage.name) : -1;
    const nextIdx = idx < 0 ? (delta > 0 ? 0 : list.length - 1) : idx + delta;
    if (nextIdx < 0 || nextIdx >= list.length) return;
    if (list[nextIdx] === state.activePage?.name) return;
    await switchActivePage(list[nextIdx]);
}

/** 表示中ページをゴミ箱へ移動し、次のページ（なければ前のページ）を表示する */
async function _layoutPageDelete() {
    if (!state.activePage) { alert(t('page.msgNoPageToDelete')); return; }
    const pageName = state.activePage.name;
    if (!confirm(t('page.confirmMoveToTrash', pageName))) return;

    // 削除後に表示するページを決めておく（次のページ、なければ前のページ）
    const list = _layoutPageList();
    const idx = list.indexOf(pageName);
    const remaining = list.filter(n => n !== pageName);
    const nextName = remaining.length
        ? remaining[Math.min(Math.max(idx, 0), remaining.length - 1)]
        : null;

    await _movePageToTrashSilent(pageName);
    await loadPages();

    if (nextName) {
        await switchActivePage(nextName);
    } else {
        state.activePage = null;
        state.selectedPanelId = null;
        state.history = [];
        const preview = document.getElementById('layout-preview');
        if (preview) preview.innerHTML = `<p class="empty-message">${t('page.msgNoPagesInsertTemplate')}</p>`;
        updatePanelSelectDropdown();
        renderPageSelector();
        updateLayoutPageNav();
    }
}

async function createPageFromTemplate() {
    if (!state.selectedTemplateName) {
        alert(t('tmpl.selectTemplate'));
        return;
    }

    const templateRecord = await dbGet('templates', state.selectedTemplateName);
    if (!templateRecord) {
        alert(t('tmpl.notFound'));
        return;
    }

    try {
        const timestamp = Date.now();
        const pageId = `page_${timestamp}`;
        const pageName = `${templateRecord.name}_${timestamp}`;

        // テンプレートSVGからコマ番号テキストを除去し、panel_0の枠線を非表示にする
        const { svgDoc, polygons } = _prepareTemplateSvgDocForPage(templateRecord.svgContent);

        // コマの線幅を指定（既定値はテンプレートに保存されている線幅、小数点第2位まで）
        const comaPolygons = Array.from(polygons).slice(1);
        const defaultLineWidth = _round2(comaPolygons.length > 0
            ? (getStrokeWidthFromElement(comaPolygons[0]) || 60)
            : 60);
        const lineWidthInput = prompt(t('page.promptPanelLineWidth'), String(defaultLineWidth));
        if (lineWidthInput === null) return; // キャンセル時はページを作成しない
        const parsedLineWidth = parseFloat(lineWidthInput);
        const lineWidth = _round2(Math.max(0, isNaN(parsedLineWidth) ? defaultLineWidth : parsedLineWidth));
        comaPolygons.forEach(poly => {
            poly.setAttribute('stroke-width', String(lineWidth));
            const polyStyle = poly.getAttribute('style') || '';
            if (polyStyle) {
                const newPolyStyle = polyStyle.replace(/stroke-width\s*:[^;]+;?/g, '').trim();
                poly.setAttribute('style', newPolyStyle ? `${newPolyStyle}; stroke-width: ${lineWidth};` : `stroke-width: ${lineWidth};`);
            }
        });

        const cleanSvgContent = new XMLSerializer().serializeToString(svgDoc.documentElement);

        const pageRecord = {
            name: pageName,
            id: pageId,
            originalTemplate: templateRecord.name,
            width: templateRecord.width,
            height: templateRecord.height,
            // panelSvgContent・overlaySvgContent はテンプレートにコンテンツが含まれていればそのまま複製
            panels: JSON.parse(JSON.stringify(templateRecord.panels)).map(p => ({ ...p, panelSvgContent: p.panelSvgContent || '' })),
            svgContent: cleanSvgContent,
            basePanelPoints: templateRecord.basePanelPoints || '',
            overlaySvgContent: templateRecord.overlaySvgContent || ''
        };

        await dbPut('pages', pageRecord);
        await loadPages();

        state.activePage = pageRecord;
        state.selectedPanelId = null;
        state.selectedOverlay = true;
        state.history = [];

        renderPageSelector();
        await renderLayoutTab();
        updatePanelSelectDropdown();
        switchTab('layout');

        alert(t('page.msgPageCreated'));
    } catch (e) {
        console.error('Page creation error:', e);
        alert(t('page.msgPageCreateError', e.message));
    }
}

// ==============================
// ページプレビュー・SVG操作（レイアウト）
// ==============================

async function renderLayoutTab() {
    updateLayoutPageNav();
    if (!state.activePage) return;

    const previewContainer = document.getElementById('layout-preview');

    try {
        const pageRecord = await dbGet('pages', state.activePage.name);
        if (!pageRecord || !pageRecord.svgContent) {
            previewContainer.innerHTML = `<p>${t('page.msgPageDataNotFound', state.activePage.name)}</p>`;
            return;
        }

        state.activePage = pageRecord;

        // 背景SVG + 全コマコンテンツを1つのSVGに統合（clipPathが同一SVG内で解決される）
        const mergedSvgStr = buildMergedSvg(pageRecord);

        previewContainer.innerHTML = `<div id="image-layer">${mergedSvgStr}</div>`;

        const svgEl = previewContainer.querySelector('#image-layer svg');

        if (svgEl) {
            svgEl.style.height = 'auto';
            svgEl.style.display = 'block';
            _applyLayoutPreviewSize(_layoutPreviewSizePct());

            // テンプレートのpolygon枠線からstroke-widthを取得してpanel-borderの初期値にする
            // svgScale=1: UI入力値 = SVG座標系のstroke-width（1:1対応）
            state.panelBorder.svgScale = 1;
            // コマ用polygon（panel_1以降）から stroke-width を読み取る
            const firstPanelId = (pageRecord.panels && pageRecord.panels[0]) ? pageRecord.panels[0].id : null;
            const templatePoly = firstPanelId
                ? svgEl.querySelector(`polygon[id="${firstPanelId}"]`)
                : svgEl.querySelector('polygon:not(.panel-overlay):not(.panel-border)');
            if (templatePoly) {
                const sw = getStrokeWidthFromElement(templatePoly);
                state.panelBorder.width = sw > 0 ? _round2(sw) : 0;
                const widthInput = document.getElementById('panel-border-width');
                if (widthInput) widthInput.value = state.panelBorder.width;
                // ページロード時にclipPathを現在の枠線幅に合わせて内側縮小（プレビューDOMのみ）
                const inset = state.panelBorder.width / 2;
                if (inset > 0 && pageRecord.panels) {
                    pageRecord.panels.forEach(panel => {
                        if (!panel.points) return;
                        const clipId = `panel-clip-${panel.id}`;
                        const clipPoly = svgEl.querySelector(`#${clipId} polygon`);
                        if (clipPoly) {
                            clipPoly.setAttribute('points', _insetPolygonPoints(panel.points, inset));
                        }
                    });
                }
            }

            // 各要素にpointer-eventsを設定
            svgEl.querySelectorAll('.balloon-shape').forEach(s => s.style.pointerEvents = 'auto');
            svgEl.querySelectorAll('text').forEach(t => t.style.pointerEvents = 'auto');
            svgEl.querySelectorAll('.inserted-image').forEach(img => img.style.pointerEvents = 'auto');
            svgEl.querySelectorAll('.draw-shape').forEach(s => s.style.pointerEvents = 'auto');

            initPanelsOnSvg(svgEl);
            initImageManipulation(svgEl, svgEl);
            initBalloonTools(svgEl, svgEl);
            initTextTools(svgEl, svgEl);
            initGroupManipulation(svgEl);
            initDrawShapeManipulation(svgEl);
        }
    } catch (e) {
        console.error('Preview load error:', e);
        previewContainer.innerHTML = `<p>${t('page.msgPreviewLoadError')}</p>`;
    }

    updatePanelSelectDropdown();
    updateBalloonPanelSelect();
    renderLayerPanel();

    // レイヤー描画がON中なら再レンダリング後にオーバーレイcanvasを再アタッチ
    if (_layerDrawState.active) {
        _layerDrawDetachOverlay();
        _layerDrawAttachOverlay();
    }

    // マスク編集がON中なら再レンダリング後にオーバーレイcanvasを再アタッチ
    // （別ページに切り替わった場合は旧ページのマスクを持ち越さないよう編集OFF）
    if (_maskState.editing) {
        if (state.activePage?.name !== _maskState.pageName) {
            _maskSetEditing(false);
        } else {
            _maskAttachOverlay();
            _maskUpdateUI();
        }
    }

    // 3Dポーズビュー表示中なら wrapper を layout-preview に再アタッチしてサイズ同期
    if (state.pose3d.activePanelId && state.pose3d.wrapper) {
        const svgEl = document.querySelector('#layout-preview #image-layer svg');
        if (previewContainer && svgEl) {
            previewContainer.style.position = 'relative';
            if (!previewContainer.contains(state.pose3d.wrapper)) {
                previewContainer.appendChild(state.pose3d.wrapper);
            }
            const panel = state.activePage?.panels.find(p => p.id === state.pose3d.activePanelId);
            if (panel) _pose3dSyncPosition(panel, svgEl);
        }
    }
}

async function saveCurrentSvg(svgEl) {
    if (!state.activePage) return;

    const serializer = new XMLSerializer();
    let source = serializer.serializeToString(svgEl);

    // オーバーレイ要素を除外
    const cloneWrapper = document.createElement('div');
    cloneWrapper.innerHTML = source;
    const cloneSvg = cloneWrapper.querySelector('svg');
    if (cloneSvg) {
        cloneSvg.querySelectorAll('.panel-overlay, .panel-border, .panel-indication, .image-handle, .image-bbox, .image-rotate-line, .group-handle, .group-bbox, .group-rotate-line, .draw-handle, .draw-bbox, .draw-rotate-line').forEach(el => el.remove());
    }
    let cleanSource = cloneWrapper.innerHTML;

    // xmlns ガード
    if (!cleanSource.includes('xmlns="http://www.w3.org/2000/svg"')) {
        cleanSource = cleanSource.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    const updatedRecord = { ...state.activePage, svgContent: cleanSource };

    try {
        await dbPut('pages', updatedRecord);
        state.activePage = updatedRecord;
    } catch (e) {
        console.error('Save error:', e);
        alert(t('page.msgSaveFailed', e.message));
    }
}

// ==============================
// コマ単位SVG統合・保存
// ==============================

// 背景SVG（svgContent）に全コマのコンテンツ（defs + g要素）をマージした1つのSVG文字列を生成
// clipPathが同一SVG内で解決されるため、コマ外表示バグが起きない
function buildMergedSvg(pageRecord) {
    if (!pageRecord || !pageRecord.svgContent) return '';

    const parser = new DOMParser();
    const doc = parser.parseFromString(pageRecord.svgContent, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    if (!svgEl) return '';

    // defs を確保
    let defs = svgEl.querySelector('defs');
    if (!defs) {
        defs = doc.createElementNS('http://www.w3.org/2000/svg', 'defs');
        svgEl.insertBefore(defs, svgEl.firstChild);
    }

    (pageRecord.panels || []).forEach(panel => {
        if (!panel.panelSvgContent) return;
        const panelDoc = parser.parseFromString(panel.panelSvgContent, 'image/svg+xml');
        const panelSvg = panelDoc.querySelector('svg');
        if (!panelSvg) return;

        // パネルのdefsをマージ（重複IDはスキップ）
        const panelDefs = panelDoc.querySelector('defs');
        if (panelDefs) {
            Array.from(panelDefs.children).forEach(child => {
                if (child.id && defs.querySelector(`[id="${child.id}"]`)) return;
                defs.appendChild(doc.importNode(child, true));
            });
        }

        // コンテンツg要素を追加
        Array.from(panelSvg.children).forEach(child => {
            if (child.tagName === 'defs') return;
            svgEl.appendChild(doc.importNode(child, true));
        });
    });

    // オーバーレイSVGコンテンツを最後（最前面）に合成
    // basePanelPoints があればそのpolygonでクリップし、ページからはみ出さないようにする
    if (pageRecord.overlaySvgContent) {
        const overlayDoc = parser.parseFromString(pageRecord.overlaySvgContent, 'image/svg+xml');
        const overlaySvg = overlayDoc.querySelector('svg');
        if (overlaySvg) {
            const overlayDefs = overlayDoc.querySelector('defs');
            if (overlayDefs) {
                Array.from(overlayDefs.children).forEach(child => {
                    if (child.id && defs.querySelector(`[id="${child.id}"]`)) return;
                    defs.appendChild(doc.importNode(child, true));
                });
            }
            // basePanelPoints によるclipPathをdefsに追加（未追加の場合のみ）
            const overlayClipId = 'overlay-page-clip';
            if (pageRecord.basePanelPoints && !defs.querySelector(`[id="${overlayClipId}"]`)) {
                const clipPath = doc.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
                clipPath.setAttribute('id', overlayClipId);
                clipPath.setAttribute('clipPathUnits', 'userSpaceOnUse');
                const poly = doc.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                poly.setAttribute('points', pageRecord.basePanelPoints);
                clipPath.appendChild(poly);
                defs.appendChild(clipPath);
            }
            Array.from(overlaySvg.children).forEach(child => {
                if (child.tagName === 'defs') return;
                const imported = doc.importNode(child, true);
                // data-overlay-layer の g 要素にclipPathを付与
                if (imported.getAttribute && imported.getAttribute('data-overlay-layer') && pageRecord.basePanelPoints) {
                    imported.setAttribute('clip-path', `url(#${overlayClipId})`);
                }
                svgEl.appendChild(imported);
            });
        }
    }

    sanitizeSvgTree(svgEl);
    const serializer = new XMLSerializer();
    let result = serializer.serializeToString(svgEl);
    if (!result.includes('xmlns="http://www.w3.org/2000/svg"')) {
        result = result.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    return result;
}

// コンテンツ内の filter="url(#...)" が参照するフィルタ定義（テキストスタイルの袋文字・影等）を
// sourceDefs から探して targetSvg の defs に取り込む（savePanelSvg / saveOverlaySvg の持ち回り用。
// これが無いとタブ切り替え等での再構築時にフィルタ定義が失われ、袋文字・影が消える）
function _collectReferencedFilters(targetSvg, sourceDefs) {
    if (!targetSvg || !sourceDefs) return;
    const ns = 'http://www.w3.org/2000/svg';
    let defsEl = targetSvg.querySelector('defs');
    targetSvg.querySelectorAll('[filter]').forEach(el => {
        const m = /url\(["']?#([^"')]+)["']?\)/.exec(el.getAttribute('filter') || '');
        if (!m) return;
        if (defsEl && defsEl.querySelector(`[id="${m[1]}"]`)) return;
        const filterDef = sourceDefs.querySelector(`filter[id="${m[1]}"]`);
        if (!filterDef) return;
        if (!defsEl) {
            defsEl = document.createElementNS(ns, 'defs');
            targetSvg.insertBefore(defsEl, targetSvg.firstChild);
        }
        defsEl.appendChild(document.importNode(filterDef, true));
    });
}

// コマ単位でSVGを保存する関数
// panelSvgEl: そのコマの内容を持つSVG要素（panel-layerのSVG内の対応g要素を含む）
// panelId: 保存対象のコマID
async function savePanelSvg(panelId, panelLayerSvgEl) {
    if (!state.activePage || !panelLayerSvgEl) return;

    // panel-0 または __overlay__ はオーバーレイレイヤーとして扱う
    if (panelId === 'panel-0' || panelId === '__overlay__') {
        await saveOverlaySvg(panelLayerSvgEl);
        return;
    }

    // UIハンドル等を除去したクローンを作成
    const clone = panelLayerSvgEl.cloneNode(true);
    clone.querySelectorAll(
        '.panel-overlay, .panel-border, .panel-indication, .panel-hit-area, ' +
        '#balloon-hit-bg, .balloon-handle, .balloon-bbox, .balloon-rotate-line, ' +
        '.text-handle, .text-bbox, .text-rotate-line, ' +
        '.image-handle, .image-bbox, .image-rotate-line, ' +
        '.group-handle, .group-bbox, .group-rotate-line, ' +
        '.draw-handle, .draw-bbox, .draw-rotate-line'
    ).forEach(el => el.remove());
    clone.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));

    // 対象コマの g 要素と defs の clipPath を抽出して個別 SVG を作成
    const ns = 'http://www.w3.org/2000/svg';
    const panelDoc = document.implementation.createDocument(ns, 'svg', null);
    const panelSvg = panelDoc.documentElement;
    panelSvg.setAttribute('xmlns', ns);
    const vb = panelLayerSvgEl.getAttribute('viewBox') || '0 0 21000 29700';
    panelSvg.setAttribute('viewBox', vb);

    // defs から対象コマのclipPath を取り込む
    const clipId = `panel-clip-${panelId}`;
    const clonedDefs = clone.querySelector('defs');
    const targetClip = clonedDefs ? clonedDefs.querySelector(`[id="${clipId}"]`) : null;
    // 対象コマのマスク定義（コマ全体マスク＋コマ内オブジェクトのレイヤーマスク）も持ち回る
    const targetMasks = [];
    if (clonedDefs) {
        clonedDefs.querySelectorAll('mask[data-ccc-mask]').forEach(m => {
            const t = m.getAttribute('data-ccc-mask');
            if (t === panelId || clone.querySelector(`g[data-clip-panel="${panelId}"] [id="${t}"]`)) {
                targetMasks.push(m);
            }
        });
    }
    if (targetClip || targetMasks.length || clonedDefs) {
        const defs = document.createElementNS(ns, 'defs');
        if (targetClip) {
            defs.appendChild(document.importNode(targetClip, true));
        }
        targetMasks.forEach(m => defs.appendChild(document.importNode(m, true)));
        panelSvg.appendChild(defs);
    }

    // 対象コマのコンテンツg要素を取り込む
    const groupSelector = panelId === 'panel-0'
        ? `g[data-clip-panel="panel-0"]`
        : `g[data-clip-panel="${panelId}"]`;
    const contentG = clone.querySelector(groupSelector);

    // panel-0（コマ外）の場合はgroupSelectorにマッチしない可能性があるため、直接のballoon-shape/text/imageも収集
    if (panelId === 'panel-0') {
        // コマ外要素: g[data-clip-panel]に属さないballoon-shape, text, inserted-image
        const outerG = document.createElementNS(ns, 'g');
        outerG.setAttribute('data-clip-panel', 'panel-0');
        clone.querySelectorAll('.balloon-shape, text, .inserted-image').forEach(el => {
            if (!el.closest('g[data-clip-panel]')) {
                outerG.appendChild(document.importNode(el, true));
            }
        });
        if (outerG.children.length > 0) {
            panelSvg.appendChild(outerG);
        }
    } else if (contentG) {
        panelSvg.appendChild(document.importNode(contentG, true));
    }

    // コンテンツが参照するフィルタ定義（袋文字・影のテキストスタイル等）も持ち回る
    _collectReferencedFilters(panelSvg, clonedDefs);

    const serializer = new XMLSerializer();
    let panelSvgStr = serializer.serializeToString(panelSvg);
    if (!panelSvgStr.includes('xmlns="http://www.w3.org/2000/svg"')) {
        panelSvgStr = panelSvgStr.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    // state.activePage.panels の該当パネルを更新
    const updatedPanels = state.activePage.panels.map(p =>
        p.id === panelId ? { ...p, panelSvgContent: panelSvgStr } : p
    );
    const updatedRecord = { ...state.activePage, panels: updatedPanels };

    try {
        await dbPut('pages', updatedRecord);
        state.activePage = updatedRecord;
        renderLayerPanel();
    } catch (e) {
        console.error('Panel save error:', e);
    }
}

// 後方互換のためのエイリアス（呼び出し箇所が残っている場合の安全弁）
async function saveShapeSvg(overlaySvgEl) {
    if (state.selectedOverlay) { await saveOverlaySvg(overlaySvgEl); return; }
    const panelId = state.selectedPanelId || 'panel-0';
    await savePanelSvg(panelId, overlaySvgEl);
}

async function saveTextSvg(overlaySvgEl) {
    if (state.selectedOverlay) { await saveOverlaySvg(overlaySvgEl); return; }
    const panelId = state.selectedPanelId || 'panel-0';
    await savePanelSvg(panelId, overlaySvgEl);
}

function pushHistory() {
    if (!state.activePage) return;

    state.history.push({
        svgContent: state.activePage.svgContent || '',
        panels: JSON.parse(JSON.stringify(state.activePage.panels || [])),
        overlaySvgContent: state.activePage.overlaySvgContent || ''
    });
    if (state.history.length > 20) {
        state.history.shift();
    }
}

async function undo() {
    if (state.history.length === 0) {
        alert(t('page.msgNoHistory'));
        return;
    }

    const prev = state.history.pop();
    if (prev) {
        const updatedRecord = {
            ...state.activePage,
            svgContent: prev.svgContent || '',
            panels: prev.panels || state.activePage.panels,
            overlaySvgContent: prev.overlaySvgContent !== undefined ? prev.overlaySvgContent : (state.activePage.overlaySvgContent || '')
        };
        try {
            await dbPut('pages', updatedRecord);
            state.activePage = updatedRecord;

            state.selectedImageId = null;
            state.selectedImageEl = null;
            state.selectedShapeId = null;

            await renderLayoutTab();
        } catch (e) {
            console.error('Undo error:', e);
        }
    }
}

async function deleteSelectedImage() {
    const container = getActiveContainer();
    if (!container) return;

    const panelSvg = getPanelLayerSvg(container);
    if (!panelSvg) return;

    const selectedImg = panelSvg.querySelector('.inserted-image.selected');
    if (selectedImg) {
        pushHistory();
        const panelId = selectedImg.closest('g[data-clip-panel]')?.getAttribute('data-clip-panel') || state.selectedPanelId || 'panel-0';
        selectedImg.remove();
        await savePanelSvg(panelId, panelSvg);
        state.selectedImageId = null;
        state.selectedImageEl = null;
    } else {
        alert(t('layout.msgNoImageSelected'));
    }
}

