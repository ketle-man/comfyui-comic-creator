// ============================================================
// main.js 分割ファイル (4/24): レイヤー管理パネル
// 元 main.js の行 836-1079 に相当
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: _getPanelBorderPolyDom,_getPanelGroupDom,_isObjectLocked,_isPanelBorderHidden,_isPanelLocked,_setPolyBorderHidden,initLayerPanel,syncPanelSelectionToObject,togglePanelBorderVisibility,togglePanelLock,updateDuplicatePanelSelect
// ============================================================

// ==============================
// レイヤー管理パネル
// ==============================

function initLayerPanel() {
    initLayoutPreviewSizeSlider();

    const upBtn = document.getElementById('layer-up-btn');
    const downBtn = document.getElementById('layer-down-btn');
    if (upBtn) upBtn.addEventListener('click', () => layerMove('up'));
    if (downBtn) downBtn.addEventListener('click', () => layerMove('down'));

    const groupBtn = document.getElementById('layer-group-btn');
    if (groupBtn) groupBtn.addEventListener('click', groupSelectedLayers);

    const ungroupBtn = document.getElementById('layer-ungroup-btn');
    if (ungroupBtn) ungroupBtn.addEventListener('click', async () => {
        if (!state.selectedGroupId) return;
        const panelSvg = getPanelLayerSvg();
        if (!panelSvg) return;
        const groupEl = panelSvg.querySelector(`#${CSS.escape(state.selectedGroupId)}`);
        if (groupEl) await ungroupLayer(groupEl);
    });

    let _dupMoveBusy = false;
    const dupBtn = document.getElementById('layer-duplicate-btn');
    if (dupBtn) dupBtn.addEventListener('click', async () => {
        if (_dupMoveBusy) return;
        _dupMoveBusy = true;
        try {
            const sel = document.getElementById('layer-duplicate-panel-select');
            const targetPanelId = sel ? (sel.value || null) : null;
            await duplicateSelectedObject(targetPanelId);
        } finally {
            _dupMoveBusy = false;
        }
    });

    const moveBtn = document.getElementById('layer-move-btn');
    if (moveBtn) moveBtn.addEventListener('click', async () => {
        if (_dupMoveBusy) return;
        _dupMoveBusy = true;
        try {
            const sel = document.getElementById('layer-duplicate-panel-select');
            const targetPanelId = sel ? (sel.value || null) : null;
            await moveSelectedObject(targetPanelId);
        } finally {
            _dupMoveBusy = false;
        }
    });

    // 不透明度スライダー
    const opSlider = document.getElementById('layer-opacity-slider');
    const opLabel  = document.getElementById('layer-opacity-value');
    if (opSlider) {
        opSlider.addEventListener('input', () => {
            const val = parseInt(opSlider.value, 10);
            opLabel.textContent = val + '%';
            const el = _layerOpacityGetSelected();
            if (!el) return;
            if (val >= 100) {
                el.removeAttribute('opacity');
                el.style.opacity = '';
            } else {
                const frac = (val / 100).toFixed(3);
                // inserted-image / balloon-shape はstyle.opacity、それ以外はattribute
                if (el.classList.contains('inserted-image') || el.classList.contains('balloon-shape')) {
                    el.style.opacity = frac;
                    el.removeAttribute('opacity');
                } else {
                    el.setAttribute('opacity', frac);
                    el.style.opacity = '';
                }
            }
        });
        opSlider.addEventListener('change', async () => {
            const svgEl = getPanelLayerSvg();
            if (!svgEl) return;
            if (state.selectedOverlay) await saveOverlaySvg(svgEl);
            else if (state.selectedDraft) await saveDraftSvg(svgEl);
            else if (state.selectedPanelId) await savePanelSvg(state.selectedPanelId, svgEl);
        });
    }
}

// 複製先コマセレクトボックスを現在のページのコマ一覧で更新
function updateDuplicatePanelSelect() {
    const sel = document.getElementById('layer-duplicate-panel-select');
    if (!sel) return;
    sel.innerHTML = `<option value="">${t('layer.samePanelOption')}</option>`;
    if (!state.activePage) return;
    const panels = state.activePage.panels || [];
    panels.forEach(panel => {
        const opt = document.createElement('option');
        opt.value = panel.id;
        const num = panel.number !== undefined ? panel.number : panels.indexOf(panel) + 1;
        opt.textContent = t('layer.panelOptionTo', num);
        sel.appendChild(opt);
    });
    // オーバーレイも追加
    const overlayOpt = document.createElement('option');
    overlayOpt.value = '__overlay__';
    overlayOpt.textContent = t('layer.overlayOptionTo');
    sel.appendChild(overlayOpt);
    // 下書きも追加（画像のみ複製/移動可能。対象外の種類が選択されている場合は実行時にエラー表示）
    const draftOpt = document.createElement('option');
    draftOpt.value = '__draft__';
    draftOpt.textContent = t('layer.draftOptionTo');
    sel.appendChild(draftOpt);
}

// オブジェクト選択時に、そのオブジェクトが属するコマ（またはオーバーレイ）へコマ選択を同期する
// （selectPanel と異なり、オブジェクト選択・ハンドルは維持したままコマ選択のみ切り替える）
function syncPanelSelectionToObject(el) {
    if (!el) return;
    const clipG = el.closest('g[data-clip-panel]');
    const overlayG = el.closest('g[data-overlay-layer]');
    const draftG = el.closest('g[data-draft-layer]');
    if (draftG) {
        if (!state.selectedDraft) {
            state.selectedPanelId = null;
            state.selectedOverlay = false;
            state.selectedDraft = true;
            updatePanelSelectDropdown();
            updateBalloonPanelSelect();
            const svgEl = document.querySelector('#layout-preview svg');
            if (svgEl) { highlightOverlay(svgEl, null); _syncDraftInteractivity(svgEl); }
        }
        return;
    }
    // 通常コマ/オーバーレイのオブジェクトへ同期する場合は、下書き編集モードも解除する
    const wasDraft = state.selectedDraft;
    state.selectedDraft = false;
    if (clipG) {
        const panelId = clipG.getAttribute('data-clip-panel');
        if (wasDraft || state.selectedOverlay || state.selectedPanelId !== panelId) {
            state.selectedPanelId = panelId;
            state.selectedOverlay = false;
            updatePanelSelectDropdown();
            updateBalloonPanelSelect();
            const svgEl = document.querySelector('#layout-preview svg');
            if (svgEl) { highlightOverlay(svgEl, panelId); if (wasDraft) _syncDraftInteractivity(svgEl); }
        }
    } else if (overlayG) {
        if (wasDraft || !state.selectedOverlay) {
            state.selectedPanelId = null;
            state.selectedOverlay = true;
            updatePanelSelectDropdown();
            updateBalloonPanelSelect();
            const svgEl = document.querySelector('#layout-preview svg');
            if (svgEl) { highlightOverlay(svgEl, null); if (wasDraft) _syncDraftInteractivity(svgEl); }
        }
    }
}

// polygon の枠線（stroke）を inline style で非表示/復元する
// 元の stroke 指定が inline style にある場合は data-orig-stroke に退避して復元時に戻す
function _setPolyBorderHidden(poly, hide) {
    const decls = (poly.getAttribute('style') || '').split(';').map(s => s.trim()).filter(Boolean);
    const strokeIdx = decls.findIndex(d => /^stroke\s*:/.test(d));
    if (hide) {
        if (strokeIdx >= 0) {
            const orig = decls[strokeIdx].split(':').slice(1).join(':').trim();
            if (orig && orig !== 'none') poly.setAttribute('data-orig-stroke', orig);
            decls.splice(strokeIdx, 1);
        }
        decls.push('stroke:none');
        poly.setAttribute('data-border-hidden', '1');
    } else {
        if (strokeIdx >= 0) decls.splice(strokeIdx, 1);
        const orig = poly.getAttribute('data-orig-stroke');
        if (orig) {
            decls.push('stroke:' + orig);
            poly.removeAttribute('data-orig-stroke');
        }
        poly.removeAttribute('data-border-hidden');
    }
    if (decls.length) poly.setAttribute('style', decls.join(';'));
    else poly.removeAttribute('style');
}

// 指定コマの枠線polygonをプレビューSVGから取得（選択ハイライト/オーバーレイ用polygonは除外）
function _getPanelBorderPolyDom(panelId) {
    const svgEl = document.querySelector('#layout-preview svg');
    if (!svgEl) return null;
    return Array.from(svgEl.querySelectorAll('polygon:not(.panel-overlay):not(.panel-border)'))
        .find(p => p.getAttribute('id') === panelId) || null;
}

// 指定コマの枠線が非表示か（プレビューDOM基準）
function _isPanelBorderHidden(panelId) {
    const poly = _getPanelBorderPolyDom(panelId);
    return !!poly && poly.getAttribute('data-border-hidden') === '1';
}

// コマ枠線の表示/非表示を個別に切り替え、svgContent に反映して保存する
async function togglePanelBorderVisibility(panelId) {
    if (!state.activePage) return;
    const hide = !_isPanelBorderHidden(panelId);

    // プレビューDOM更新
    const previewPoly = _getPanelBorderPolyDom(panelId);
    if (previewPoly) _setPolyBorderHidden(previewPoly, hide);

    // svgContent 更新（コマ枠線幅と同じパターンで永続化）
    const parser = new DOMParser();
    const doc = parser.parseFromString(state.activePage.svgContent, 'image/svg+xml');
    const poly = Array.from(doc.querySelectorAll('polygon')).find(p => p.getAttribute('id') === panelId);
    if (poly) {
        _setPolyBorderHidden(poly, hide);
        state.activePage.svgContent = new XMLSerializer().serializeToString(doc.querySelector('svg'));
    }

    await dbPut('pages', state.activePage);
    renderLayerPanel();
}

// 指定コマのコンテンツ g 要素（panel-layer側、savePanelSvg でそのまま永続化される）を取得
function _getPanelGroupDom(panelId) {
    const panelSvg = getPanelLayerSvg();
    return panelSvg ? panelSvg.querySelector(`g[data-clip-panel="${panelId}"]`) : null;
}

// 指定コマ内オブジェクトが一括ロックされているか
function _isPanelLocked(panelId) {
    const g = _getPanelGroupDom(panelId);
    return !!g && g.getAttribute('data-panel-locked') === '1';
}

// オブジェクト個別の locked、または所属コマの一括ロックのどちらかにより操作不可か判定（キャンバス上の直接クリック等、レイヤーパネル外の操作ガード用）
function _isObjectLocked(el) {
    if (!el) return false;
    if (el.dataset && el.dataset.locked === 'true') return true;
    const panelGroup = el.closest && el.closest('g[data-clip-panel]');
    return !!panelGroup && panelGroup.getAttribute('data-panel-locked') === '1';
}

// コマ内オブジェクトの一括ロックを切り替える（個別の layer.dataset.locked はそのまま保持し、解除すれば元の状態に戻る）
async function togglePanelLock(panelId) {
    const g = _getPanelGroupDom(panelId);
    if (!g) return;
    const lock = g.getAttribute('data-panel-locked') !== '1';
    if (lock) g.setAttribute('data-panel-locked', '1');
    else g.removeAttribute('data-panel-locked');

    // ロック時、そのコマ内のオブジェクトが選択中なら選択解除
    if (lock && state.selectedPanelId === panelId) {
        state.selectedShapeId = null;
        state.selectedImageId = null;
        state.selectedImageEl = null;
        state.selectedTextEl = null;
        state.selectedGroupId = null;
        state.selectedDrawId = null;
        state.selectedDrawEl = null;
        clearHandles();
        clearImageHandles();
        clearGroupHandles();
        const sv = getPanelLayerSvg();
        if (sv) { clearTextHandles(sv); clearDrawShapeHandles(sv); }
    }

    const curSvg = getPanelLayerSvg();
    if (curSvg) await savePanelSvg(panelId, curSvg);
    renderLayerPanel();
}

