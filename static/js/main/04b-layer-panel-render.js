// ============================================================
// マスクレイヤー機能 分割ファイル (2/2): renderLayerPanel本体+不透明度/コンテナ取得ヘルパー
// 元 04-mask-layers.js（分割前）の行 830-1553 に相当
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: _layerOpacityGetSelected,_layerOpacitySync,getActiveContainer,getPanelLayerSvg,renderLayerPanel
// ============================================================

function renderLayerPanel() {
    const listEl = document.getElementById('layer-list');
    if (!listEl) return;

    const container = getActiveContainer();

    if (!container || !state.activePage) {
        listEl.innerHTML = `<p class="empty-message" style="font-size:12px;">${t('layer.noObjects')}</p>`;
        return;
    }

    // 統合 panel-layer SVG から全オブジェクトを取得
    const panelSvg = getPanelLayerSvg(container);

    listEl.innerHTML = '';

    // 現在処理中のコマが一括ロックされているか（コマループ内で更新、オーバーレイ処理時は false）
    let _rlpPanelLocked = false;

    // ── ヘルパー：チェックボックス生成 ──
    const makeCheckbox = (svgEl) => {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'layer-check';
        cb.checked = state.checkedLayerEls.has(svgEl);
        cb.addEventListener('change', (e) => {
            e.stopPropagation();
            if (cb.checked) {
                state.checkedLayerEls.add(svgEl);
            } else {
                state.checkedLayerEls.delete(svgEl);
            }
        });
        return cb;
    };

    // ── ヘルパー：フキダシアイテム生成 ──
    const makeShapeItem = (shape, objIdx, indent, inGroup = false) => {
        const isHidden = shape.style.display === 'none';
        const panelLocked = _rlpPanelLocked;
        const individualLocked = shape.dataset.locked === 'true';
        const isLocked = individualLocked || panelLocked;
        const isActive = shape.id === state.selectedShapeId;
        const typeLabel = shape.dataset.shapeType === 'rect' ? '▭' : '○';
        if (!shape.dataset.name) {
            shape.dataset.name = t('layer.balloonName', objIdx + 1);
        }
        const name = shape.dataset.name;

        const item = document.createElement('div');
        item.className = 'layer-item layer-item-shape' + (isActive ? ' active' : '') + (isHidden ? ' hidden-obj' : '') + (isLocked ? ' locked-obj' : '');
        item.style.paddingLeft = `${6 + indent * 14}px`;
        item.innerHTML = `
            <span class="layer-item-icon">${typeLabel}</span>
            <span class="layer-item-name">${_escHtml(name)}</span>
            <div class="layer-item-btns">
                <button class="layer-item-btn lock-btn" ${panelLocked ? 'disabled' : ''} title="${panelLocked ? t('layer.panelLockedTitle') : (individualLocked ? t('layer.unlockTitle') : t('layer.lockTitle'))}">${isLocked ? '🔒' : '🔓'}</button>
                <button class="layer-item-btn vis-btn" title="${isHidden ? t('layer.showTitle') : t('layer.hideTitle')}">${isHidden ? '🚫' : '👁'}</button>
                <button class="layer-item-btn delete-btn" title="${t('common.delete')}">✕</button>
            </div>
        `;
        if (!inGroup) item.prepend(makeCheckbox(shape));
        item.addEventListener('click', (e) => {
            if (e.target.closest('.layer-item-btn') || e.target.classList.contains('layer-check')) return;
            if (isLocked) return;
            state.selectedShapeId = shape.id;
            state.selectedImageEl = null;
            state.selectedImageId = null;
            state.selectedTextEl = null;
            state.selectedGroupId = null;
            state.selectedDrawId  = null;
            state.selectedDrawEl  = null;
            clearImageHandles();
            const _sv = getPanelLayerSvg();
            if (_sv) { clearTextHandles(_sv); clearDrawShapeHandles(_sv); }
            clearGroupHandles();
            state.balloon.isEditMode = true;
            updateBalloonUI();
            renderHandles(shape);
            syncPanelSelectionToObject(shape);
            renderLayerPanel();
        });
        item.querySelector('.lock-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            if (panelLocked) return;
            if (individualLocked) {
                delete shape.dataset.locked;
            } else {
                shape.dataset.locked = 'true';
                // ロック時は選択解除
                if (state.selectedShapeId === shape.id) { state.selectedShapeId = null; clearHandles(); }
            }
            const curSvg = getPanelLayerSvg();
            if (curSvg) await savePanelSvg(state.selectedPanelId || 'panel-0', curSvg);
            renderLayerPanel();
        });
        item.querySelector('.vis-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            shape.style.display = isHidden ? '' : 'none';
            const curSvg = getPanelLayerSvg();
            if (curSvg) await savePanelSvg(state.selectedPanelId || 'panel-0', curSvg);
            renderLayerPanel();
        });
        item.querySelector('.delete-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            if (isLocked) return;
            pushHistory();
            if (state.selectedShapeId === shape.id) { state.selectedShapeId = null; clearHandles(); }
            state.checkedLayerEls.delete(shape);
            shape.remove();
            const curSvg = getPanelLayerSvg();
            if (curSvg) await savePanelSvg(state.selectedPanelId || 'panel-0', curSvg);
            renderLayerPanel();
        });
        return item;
    };

    // ── ヘルパー：画像アイテム生成 ──
    const makeImageItem = (img, objIdx, indent, inGroup = false) => {
        const isHidden = img.style.display === 'none' || img.getAttribute('visibility') === 'hidden';
        const panelLocked = _rlpPanelLocked;
        const individualLocked = img.dataset.locked === 'true';
        const isLocked = individualLocked || panelLocked;
        const isActive = img.id === state.selectedImageId;
        const src = img.getAttribute('href') || img.getAttribute('xlink:href') || '';
        const isVector = src.startsWith('data:image/svg');
        const icon = isVector ? '⬡' : '🖼';
        if (!img.dataset.name) {
            img.dataset.name = isVector ? `SVG ${objIdx + 1}` : t('layer.imageName', objIdx + 1);
        }
        const name = img.dataset.name;

        const item = document.createElement('div');
        item.className = 'layer-item layer-item-shape' + (isActive ? ' active' : '') + (isHidden ? ' hidden-obj' : '') + (isLocked ? ' locked-obj' : '');
        item.style.paddingLeft = `${6 + indent * 14}px`;
        item.innerHTML = `
            <span class="layer-item-icon">${icon}</span>
            <span class="layer-item-name">${_escHtml(name)}</span>
            <div class="layer-item-btns">
                <button class="layer-item-btn addmask-btn" title="${t('layer.addMaskTitle')}">🎭</button>
                <button class="layer-item-btn lock-btn" ${panelLocked ? 'disabled' : ''} title="${panelLocked ? t('layer.panelLockedTitle') : (individualLocked ? t('layer.unlockTitle') : t('layer.lockTitle'))}">${isLocked ? '🔒' : '🔓'}</button>
                <button class="layer-item-btn vis-btn" title="${isHidden ? t('layer.showTitle') : t('layer.hideTitle')}">${isHidden ? '🚫' : '👁'}</button>
                <button class="layer-item-btn delete-btn" title="${t('common.delete')}">✕</button>
            </div>
        `;
        if (!inGroup) item.prepend(makeCheckbox(img));
        item.querySelector('.addmask-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            _maskEnsureElId(img);
            document.querySelector('.subtab-btn[data-subtab="mask"]')?.click();
            const type = document.getElementById('mask-new-type')?.value === 'show' ? 'show' : 'hide';
            await _maskAddLayerAndEdit(img.id, type);
        });
        item.addEventListener('click', (e) => {
            if (e.target.closest('.layer-item-btn') || e.target.classList.contains('layer-check')) return;
            if (isLocked) return;
            const activeContainer = getActiveContainer();
            state.selectedImageId = img.id;
            state.selectedImageEl = img;
            state.selectedShapeId = null;
            state.selectedTextEl = null;
            state.selectedGroupId = null;
            state.selectedDrawId  = null;
            state.selectedDrawEl  = null;
            state.balloon.isEditMode = false;
            updateBalloonUI();
            clearHandles();
            clearImageHandles();
            const _sv2 = getPanelLayerSvg();
            if (_sv2) { clearTextHandles(_sv2); clearDrawShapeHandles(_sv2); }
            clearGroupHandles();
            if (activeContainer) {
                activeContainer.querySelectorAll('.inserted-image').forEach(i => i.classList.remove('selected'));
                const panelSvgEl = getPanelLayerSvg(activeContainer);
                if (panelSvgEl) renderImageHandles(img, panelSvgEl);
            }
            img.classList.add('selected');
            syncPanelSelectionToObject(img);
            renderLayerPanel();
        });
        item.querySelector('.lock-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            if (panelLocked) return;
            const panelId = img.getAttribute('data-panel-id') || state.selectedPanelId || 'panel-0';
            if (individualLocked) {
                delete img.dataset.locked;
            } else {
                img.dataset.locked = 'true';
                // ロック時は選択解除
                if (state.selectedImageId === img.id) {
                    state.selectedImageId = null; state.selectedImageEl = null;
                    clearImageHandles();
                }
            }
            const curSvg = getPanelLayerSvg();
            if (curSvg) await savePanelSvg(panelId, curSvg);
            renderLayerPanel();
        });
        item.querySelector('.vis-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            img.style.display = isHidden ? '' : 'none';
            const curSvg = getPanelLayerSvg();
            if (curSvg) await savePanelSvg(img.getAttribute('data-panel-id') || state.selectedPanelId || 'panel-0', curSvg);
            renderLayerPanel();
        });
        item.querySelector('.delete-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            if (isLocked) return;
            pushHistory();
            const panelId = img.getAttribute('data-panel-id') || state.selectedPanelId || 'panel-0';
            if (state.selectedImageId === img.id) { state.selectedImageId = null; state.selectedImageEl = null; }
            state.checkedLayerEls.delete(img);
            img.remove();
            const curSvg = getPanelLayerSvg();
            if (curSvg) await savePanelSvg(panelId, curSvg);
            renderLayerPanel();
        });
        return item;
    };

    // ── ヘルパー：テキストアイテム生成 ──
    const makeTextItem = (textEl, objIdx, indent, inGroup = false) => {
        const isHidden = textEl.style.display === 'none';
        const panelLocked = _rlpPanelLocked;
        const individualLocked = textEl.dataset.locked === 'true';
        const isLocked = individualLocked || panelLocked;
        const isActive = state.selectedTextEl === textEl;
        const contentLabel = textEl.textContent.trim().slice(0, 10);
        if (!contentLabel && !textEl.dataset.name) {
            textEl.dataset.name = t('layer.textName', objIdx + 1);
        }
        const label = contentLabel || textEl.dataset.name;

        const item = document.createElement('div');
        item.className = 'layer-item layer-item-shape' + (isActive ? ' active' : '') + (isHidden ? ' hidden-obj' : '') + (isLocked ? ' locked-obj' : '');
        item.style.paddingLeft = `${6 + indent * 14}px`;
        item.innerHTML = `
            <span class="layer-item-icon">✍</span>
            <span class="layer-item-name">${_escHtml(label)}</span>
            <div class="layer-item-btns">
                <button class="layer-item-btn lock-btn" ${panelLocked ? 'disabled' : ''} title="${panelLocked ? t('layer.panelLockedTitle') : (individualLocked ? t('layer.unlockTitle') : t('layer.lockTitle'))}">${isLocked ? '🔒' : '🔓'}</button>
                <button class="layer-item-btn vis-btn" title="${isHidden ? t('layer.showTitle') : t('layer.hideTitle')}">${isHidden ? '🚫' : '👁'}</button>
                <button class="layer-item-btn delete-btn" title="${t('common.delete')}">✕</button>
            </div>
        `;
        if (!inGroup) item.prepend(makeCheckbox(textEl));
        item.addEventListener('click', (e) => {
            if (e.target.closest('.layer-item-btn') || e.target.classList.contains('layer-check')) return;
            if (isLocked) return;
            state.selectedTextEl = textEl;
            state.selectedShapeId = null;
            state.selectedImageEl = null;
            state.selectedImageId = null;
            state.selectedGroupId = null;
            state.selectedDrawId  = null;
            state.selectedDrawEl  = null;
            state.balloon.isEditMode = false;
            updateBalloonUI();
            clearHandles();
            clearImageHandles();
            if (panelSvg) clearDrawShapeHandles(panelSvg);
            clearGroupHandles();
            syncFontFamilyUI(textEl);
            if (panelSvg) renderTextHandles(textEl, panelSvg);
            syncPanelSelectionToObject(textEl);
            renderLayerPanel();
        });
        item.querySelector('.lock-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            if (panelLocked) return;
            if (individualLocked) {
                delete textEl.dataset.locked;
            } else {
                textEl.dataset.locked = 'true';
                // ロック時は選択解除
                if (state.selectedTextEl === textEl) {
                    state.selectedTextEl = null;
                    if (panelSvg) clearTextHandles(panelSvg);
                }
            }
            const curSvg = getPanelLayerSvg();
            if (curSvg) await savePanelSvg(state.selectedPanelId || 'panel-0', curSvg);
            renderLayerPanel();
        });
        item.querySelector('.vis-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            textEl.style.display = isHidden ? '' : 'none';
            const curSvg = getPanelLayerSvg();
            if (curSvg) await savePanelSvg(state.selectedPanelId || 'panel-0', curSvg);
            renderLayerPanel();
        });
        item.querySelector('.delete-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            if (isLocked) return;
            pushHistory();
            if (state.selectedTextEl === textEl) {
                state.selectedTextEl = null;
                if (panelSvg) clearTextHandles(panelSvg);
            }
            state.checkedLayerEls.delete(textEl);
            textEl.remove();
            const curSvg = getPanelLayerSvg();
            if (curSvg) await savePanelSvg(state.selectedPanelId || 'panel-0', curSvg);
            renderLayerPanel();
        });
        return item;
    };

    // ── ヘルパー：描画図形アイテム生成 ──
    const makeDrawShapeItem = (el, objIdx, indent, inGroup = false) => {
        const isHidden = el.style.display === 'none';
        const panelLocked = _rlpPanelLocked;
        const individualLocked = el.dataset.locked === 'true';
        const isLocked = individualLocked || panelLocked;
        const isActive = el.id === state.selectedDrawId;
        const kind = el.getAttribute('data-shape-kind') || el.tagName.toLowerCase();
        const iconMap = { rect: '▬', ellipse: '⬭', line: '╱', polygon: '⬠' };
        const icon = iconMap[kind] || '◼';
        if (!el.dataset.name) {
            el.dataset.name = t('layer.shapeName', objIdx + 1);
        }
        const name = el.dataset.name;

        const item = document.createElement('div');
        item.className = 'layer-item layer-item-shape' + (isActive ? ' active' : '') + (isHidden ? ' hidden-obj' : '') + (isLocked ? ' locked-obj' : '');
        item.style.paddingLeft = `${6 + indent * 14}px`;
        item.innerHTML = `
            <span class="layer-item-icon">${icon}</span>
            <span class="layer-item-name">${_escHtml(name)}</span>
            <div class="layer-item-btns">
                <button class="layer-item-btn addmask-btn" title="${t('layer.addMaskTitle')}">🎭</button>
                <button class="layer-item-btn lock-btn" ${panelLocked ? 'disabled' : ''} title="${panelLocked ? t('layer.panelLockedTitle') : (individualLocked ? t('layer.unlockTitle') : t('layer.lockTitle'))}">${isLocked ? '🔒' : '🔓'}</button>
                <button class="layer-item-btn vis-btn" title="${isHidden ? t('layer.showTitle') : t('layer.hideTitle')}">${isHidden ? '🚫' : '👁'}</button>
                <button class="layer-item-btn delete-btn" title="${t('common.delete')}">✕</button>
            </div>
        `;
        if (!inGroup) item.prepend(makeCheckbox(el));
        item.querySelector('.addmask-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            _maskEnsureElId(el);
            document.querySelector('.subtab-btn[data-subtab="mask"]')?.click();
            const type = document.getElementById('mask-new-type')?.value === 'show' ? 'show' : 'hide';
            await _maskAddLayerAndEdit(el.id, type);
        });

        item.addEventListener('click', (e) => {
            if (e.target.closest('.layer-item-btn') || e.target.classList.contains('layer-check')) return;
            if (isLocked) return;
            const svgEl = getPanelLayerSvg();
            if (svgEl) _layerDrawSelectShape(el, svgEl);
            renderLayerPanel();
        });
        item.querySelector('.lock-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            if (panelLocked) return;
            if (individualLocked) { delete el.dataset.locked; }
            else {
                el.dataset.locked = 'true';
                if (state.selectedDrawId === el.id) { state.selectedDrawId = null; state.selectedDrawEl = null; clearDrawShapeHandles(); _drawShapeSyncProps(null); }
            }
            const curSvg = getPanelLayerSvg();
            if (curSvg) {
                if (state.selectedOverlay) await saveOverlaySvg(curSvg);
                else await savePanelSvg(state.selectedPanelId || 'panel-0', curSvg);
            }
            renderLayerPanel();
        });
        item.querySelector('.vis-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            el.style.display = isHidden ? '' : 'none';
            const curSvg = getPanelLayerSvg();
            if (curSvg) {
                if (state.selectedOverlay) await saveOverlaySvg(curSvg);
                else await savePanelSvg(state.selectedPanelId || 'panel-0', curSvg);
            }
            renderLayerPanel();
        });
        item.querySelector('.delete-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            if (isLocked) return;
            if (state.selectedDrawId === el.id) { state.selectedDrawId = null; state.selectedDrawEl = null; clearDrawShapeHandles(); _drawShapeSyncProps(null); }
            state.checkedLayerEls.delete(el);
            el.remove();
            const curSvg = getPanelLayerSvg();
            if (curSvg) {
                if (state.selectedOverlay) await saveOverlaySvg(curSvg);
                else await savePanelSvg(state.selectedPanelId || 'panel-0', curSvg);
            }
            renderLayerPanel();
        });
        return item;
    };

    // ── ヘルパー：グループアイテム生成 ──
    const makeGroupItem = (groupEl, objIdx, indent) => {
        const panelLocked = _rlpPanelLocked;
        const isActive = groupEl.id === state.selectedGroupId;
        if (!groupEl.dataset.groupName) {
            groupEl.dataset.groupName = t('layer.groupNameDefault', objIdx + 1);
        }
        const name = groupEl.dataset.groupName;

        const item = document.createElement('div');
        item.className = 'layer-item layer-item-group' + (isActive ? ' active' : '') + (panelLocked ? ' locked-obj' : '');
        item.style.paddingLeft = `${6 + indent * 14}px`;
        item.innerHTML = `
            <span class="layer-item-icon">[G]</span>
            <span class="layer-item-name">${_escHtml(name)}</span>
            <div class="layer-item-btns">
                <button class="layer-item-btn save-asset-btn" title="${t('layer.saveAssetTitle')}">📦</button>
                <button class="layer-item-btn ungroup-btn" title="${t('layer.ungroupTitle')}">G-</button>
                <button class="layer-item-btn delete-btn" title="${t('layer.deleteGroupTitle')}">✕</button>
            </div>
        `;
        item.addEventListener('click', (e) => {
            if (e.target.closest('.layer-item-btn')) return;
            if (panelLocked) return;
            // グループ選択
            state.selectedGroupId = groupEl.id;
            state.selectedShapeId = null;
            state.selectedImageEl = null;
            state.selectedImageId = null;
            state.selectedTextEl  = null;
            state.selectedDrawId  = null;
            state.selectedDrawEl  = null;
            clearHandles();
            clearImageHandles();
            const curSvgEl = getPanelLayerSvg();
            if (curSvgEl) {
                clearTextHandles(curSvgEl);
                clearDrawShapeHandles(curSvgEl);
                renderGroupHandles(groupEl, curSvgEl);
            }
            syncPanelSelectionToObject(groupEl);
            renderLayerPanel();
        });
        item.querySelector('.save-asset-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            if (panelLocked) return;
            await saveGroupAsAsset(groupEl, name);
        });
        item.querySelector('.ungroup-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            if (panelLocked) return;
            await ungroupLayer(groupEl);
        });
        item.querySelector('.delete-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            if (panelLocked) return;
            pushHistory();
            if (state.selectedGroupId === groupEl.id) {
                state.selectedGroupId = null;
                clearGroupHandles();
            }
            groupEl.remove();
            const curSvg = getPanelLayerSvg();
            const panelId = groupEl.closest('g[data-clip-panel]')?.getAttribute('data-clip-panel') ||
                            (groupEl.closest('g[data-overlay-layer]') ? '__overlay__' : state.selectedPanelId || 'panel-0');
            if (curSvg) await savePanelSvg(panelId, curSvg);
            renderLayerPanel();
        });

        // グループ内子要素を表示（インデント+1）
        const childObjs = Array.from(groupEl.children).filter(el =>
            el.classList.contains('balloon-shape') ||
            el.classList.contains('inserted-image') ||
            el.tagName.toLowerCase() === 'text'
        );
        const fragment = document.createDocumentFragment();
        fragment.appendChild(item);
        [...childObjs].reverse().forEach((el) => {
            const idx = childObjs.indexOf(el);
            if (el.classList.contains('balloon-shape')) fragment.appendChild(makeShapeItem(el, idx, indent + 1, true));
            else if (el.classList.contains('inserted-image')) fragment.appendChild(makeImageItem(el, idx, indent + 1, true));
            else if (el.tagName.toLowerCase() === 'text') fragment.appendChild(makeTextItem(el, idx, indent + 1, true));
        });
        return fragment;
    };

    // ── ヘルパー：マスクレイヤーアイテム生成 ──
    const makeMaskLayerItem = (target, ml, indent) => {
        const isActive = _maskState.editing && _maskState.target === target && _maskState.layerId === ml.id;
        const isObj = _maskIsObjectTarget(target);
        const item = document.createElement('div');
        item.className = 'layer-item layer-item-shape' + (isActive ? ' active' : '') + (ml.visible ? '' : ' hidden-obj');
        item.style.paddingLeft = `${6 + indent * 14}px`;
        item.innerHTML = `
            <span class="layer-item-icon">🎭</span>
            <span class="layer-item-name">${_escHtml(ml.name)}（${_maskTypeLabel(ml.type)}）${isActive ? ' ✎' : ''}</span>
            <div class="layer-item-btns">
                ${isObj ? `
                <button class="layer-item-btn mask-up-btn" title="${t('layer.maskUpTitle')}">↑</button>
                <button class="layer-item-btn mask-down-btn" title="${t('layer.maskDownTitle')}">↓</button>` : ''}
                <button class="layer-item-btn vis-btn" title="${ml.visible ? t('layer.maskDisableTitle') : t('layer.maskEnableTitle')}">${ml.visible ? '👁' : '🚫'}</button>
                <button class="layer-item-btn delete-btn" title="${t('layer.maskDeleteTitle')}">✕</button>
            </div>
        `;
        item.addEventListener('click', async (e) => {
            if (e.target.closest('.layer-item-btn')) return;
            await _maskOpenEditorFor(target, ml.id);
        });
        item.querySelector('.mask-up-btn')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            await _maskReassignObject(target, +1);
        });
        item.querySelector('.mask-down-btn')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            await _maskReassignObject(target, -1);
        });
        item.querySelector('.vis-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            await _maskToggleLayerVisible(target, ml.id);
        });
        item.querySelector('.delete-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm(t('layer.confirmDeleteMask', ml.name, _maskTypeLabel(ml.type)))) return;
            await _maskDeleteLayer(target, ml.id);
        });
        return item;
    };

    const panels = state.activePage.panels || [];

    // ── 各コマノード ──
    panels.forEach((panel) => {
        const num = (panel.number !== undefined) ? panel.number : panels.indexOf(panel) + 1;

        const panelItem = document.createElement('div');
        const isPanelActive = !state.selectedOverlay && state.selectedPanelId === panel.id;
        const isBorderHidden = _isPanelBorderHidden(panel.id);
        const isPanelLocked = _isPanelLocked(panel.id);
        _rlpPanelLocked = isPanelLocked; // 以降このコマ配下のオブジェクト生成（makeShapeItem等）で参照される
        const panelMaskLayers = panelSvg ? _maskLayerList(panelSvg, panel.id) : [];
        const panelMaskOff = panelSvg ? !!_maskTargetGroup(panelSvg, panel.id)?.hasAttribute('data-ccc-mask-off') : false;
        panelItem.className = 'layer-item layer-item-panel' + (isPanelActive ? ' active' : '') + (isPanelLocked ? ' locked-obj' : '');
        panelItem.style.paddingLeft = '6px';
        panelItem.innerHTML = `
            <span class="layer-item-icon">🔲</span><span class="layer-item-name">${t('common.panelName', num)}</span>
            <div class="layer-item-btns">
                <button class="layer-item-btn panel-lock-btn" title="${isPanelLocked ? t('layer.panelUnlockAllTitle') : t('layer.panelLockAllTitle')}">${isPanelLocked ? '🔒' : '🔓'}</button>
                <button class="layer-item-btn mask-btn" title="${t('layer.panelMaskTitle')}"
                        style="${panelMaskLayers.length ? (panelMaskOff ? 'opacity:0.45;' : 'color:#7ab8ff;') : 'opacity:0.6;'}">🎭</button>
                <button class="layer-item-btn border-toggle-btn" title="${isBorderHidden ? t('layer.borderShowTitle') : t('layer.borderHideTitle')}">${isBorderHidden ? '−' : '□'}</button>
            </div>
        `;
        panelItem.addEventListener('click', (e) => {
            if (e.target.closest('.layer-item-btn')) return;
            selectPanel(panel.id);
        });
        panelItem.querySelector('.panel-lock-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            await togglePanelLock(panel.id);
        });
        panelItem.querySelector('.border-toggle-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            await togglePanelBorderVisibility(panel.id);
        });
        panelItem.querySelector('.mask-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            selectPanel(panel.id);
            document.querySelector('.subtab-btn[data-subtab="mask"]')?.click();
            const type = document.getElementById('mask-new-type')?.value === 'show' ? 'show' : 'hide';
            await _maskAddLayerAndEdit(panel.id, type);
        });
        listEl.appendChild(panelItem);

        // マスクレイヤー行（最前面が上）
        [...panelMaskLayers].reverse().forEach(ml => listEl.appendChild(makeMaskLayerItem(panel.id, ml, 2)));

        // panel-layer の g[data-clip-panel] からコンテンツを収集（DOM順でソートして表示）
        if (panelSvg) {
            const group = panelSvg.querySelector(`g[data-clip-panel="${panel.id}"]`);
            if (group) {
                const allObjs = Array.from(group.children).filter(el =>
                    el.classList.contains('balloon-shape') ||
                    el.classList.contains('inserted-image') ||
                    el.classList.contains('draw-shape') ||
                    el.tagName.toLowerCase() === 'text' ||
                    el.hasAttribute('data-group-id')
                );
                [...allObjs].reverse().forEach((el) => {
                    const idx = allObjs.indexOf(el);
                    // このオブジェクトに付いたレイヤーマスク行（対象の直上に表示）
                    if (el.id) {
                        [..._maskLayerList(panelSvg, el.id)].reverse().forEach(ml =>
                            listEl.appendChild(makeMaskLayerItem(el.id, ml, 3)));
                    }
                    if (el.hasAttribute('data-group-id')) listEl.appendChild(makeGroupItem(el, idx, 2));
                    else if (el.classList.contains('balloon-shape')) listEl.appendChild(makeShapeItem(el, idx, 2));
                    else if (el.classList.contains('inserted-image')) listEl.appendChild(makeImageItem(el, idx, 2));
                    else if (el.classList.contains('draw-shape')) listEl.appendChild(makeDrawShapeItem(el, idx, 2));
                    else if (el.tagName.toLowerCase() === 'text') listEl.appendChild(makeTextItem(el, idx, 2));
                });
            }
        }
    });

    // ── オーバーレイレイヤー（最下段・ページ全面） ── コマの一括ロックは対象外
    _rlpPanelLocked = false;
    const overlayItem = document.createElement('div');
    const isOverlayActive = state.selectedOverlay;
    const ovMaskLayers = panelSvg ? _maskLayerList(panelSvg, '__overlay__') : [];
    const ovMaskOff = panelSvg ? !!_maskTargetGroup(panelSvg, '__overlay__')?.hasAttribute('data-ccc-mask-off') : false;
    overlayItem.className = 'layer-item layer-item-panel' + (isOverlayActive ? ' active' : '');
    overlayItem.style.paddingLeft = '6px';
    overlayItem.innerHTML = `
        <span class="layer-item-icon">⬜</span><span class="layer-item-name">${t('common.overlayFull')}</span>
        <div class="layer-item-btns">
            <button class="layer-item-btn mask-btn" title="${t('layer.overlayMaskTitle')}"
                    style="${ovMaskLayers.length ? (ovMaskOff ? 'opacity:0.45;' : 'color:#7ab8ff;') : 'opacity:0.6;'}">🎭</button>
        </div>
    `;
    overlayItem.addEventListener('click', (e) => {
        if (e.target.closest('.layer-item-btn')) return;
        selectOverlay();
    });
    overlayItem.querySelector('.mask-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        selectOverlay();
        document.querySelector('.subtab-btn[data-subtab="mask"]')?.click();
        const type = document.getElementById('mask-new-type')?.value === 'show' ? 'show' : 'hide';
        await _maskAddLayerAndEdit('__overlay__', type);
    });
    listEl.appendChild(overlayItem);

    // オーバーレイのマスクレイヤー行（最前面が上）
    [...ovMaskLayers].reverse().forEach(ml => listEl.appendChild(makeMaskLayerItem('__overlay__', ml, 2)));

    // オーバーレイg要素内のオブジェクトを表示（DOM順でソートして表示）
    if (panelSvg) {
        const overlayG = panelSvg.querySelector('g[data-overlay-layer]');
        if (overlayG) {
            const allObjs = Array.from(overlayG.children).filter(el =>
                el.classList.contains('balloon-shape') ||
                el.classList.contains('inserted-image') ||
                el.classList.contains('draw-shape') ||
                el.tagName.toLowerCase() === 'text' ||
                el.hasAttribute('data-group-id')
            );
            [...allObjs].reverse().forEach((el) => {
                const idx = allObjs.indexOf(el);
                // このオブジェクトに付いたレイヤーマスク行（対象の直上に表示）
                if (el.id) {
                    [..._maskLayerList(panelSvg, el.id)].reverse().forEach(ml =>
                        listEl.appendChild(makeMaskLayerItem(el.id, ml, 3)));
                }
                if (el.hasAttribute('data-group-id')) listEl.appendChild(makeGroupItem(el, idx, 2));
                else if (el.classList.contains('balloon-shape')) listEl.appendChild(makeShapeItem(el, idx, 2));
                else if (el.classList.contains('inserted-image')) listEl.appendChild(makeImageItem(el, idx, 2));
                else if (el.classList.contains('draw-shape')) listEl.appendChild(makeDrawShapeItem(el, idx, 2));
                else if (el.tagName.toLowerCase() === 'text') listEl.appendChild(makeTextItem(el, idx, 2));
            });
        }
    }

    updateDuplicatePanelSelect();
    _layerOpacitySync();

    // 「画像タブで編集」ボタン: 画像選択中のみ有効
    const openImageTabBtn = document.getElementById('layer-draw-open-imgedit');
    if (openImageTabBtn) {
        const hasImage = !!state.selectedImageEl;
        openImageTabBtn.disabled = !hasImage;
        openImageTabBtn.title = hasImage
            ? t('layer.openInImageTab', state.selectedImageEl.dataset.name || state.selectedImageEl.id)
            : t('layer.noImageSelected');
    }

    // 「I2Iへ送る」ボタン: 画像選択中のみ有効
    const i2iSendBtn = document.getElementById('layout-i2i-send-btn');
    if (i2iSendBtn) i2iSendBtn.disabled = !state.selectedImageEl;

    // 「OC」ボタン（選択オブジェクトを中央へ移動）: 何らかのオブジェクト選択中のみ有効
    const ocBtn = document.getElementById('object-center-btn');
    if (ocBtn) ocBtn.disabled = !_layerOpacityGetSelected();

    // 「図形をPNG変換」ボタン: 図形レイヤー選択中のみ有効
    const shapeToPngBtn = document.getElementById('layer-draw-shape-to-png');
    if (shapeToPngBtn) shapeToPngBtn.disabled = !state.selectedDrawEl;
}

// ── 選択中オブジェクトの不透明度スライダー同期 ──
function _layerOpacitySync() {
    const row = document.getElementById('layer-opacity-row');
    if (!row) return;
    const el = _layerOpacityGetSelected();
    if (!el) {
        row.style.display = 'none';
        return;
    }
    const rawOp = el.getAttribute('opacity') || el.style.opacity || '1';
    const opVal = Math.round(Math.min(1, Math.max(0, parseFloat(rawOp) || 1)) * 100);
    row.style.display = 'flex';
    const slider = document.getElementById('layer-opacity-slider');
    const label  = document.getElementById('layer-opacity-value');
    slider.value  = opVal;
    label.textContent = opVal + '%';
}

// 選択中オブジェクトSVG要素を返す（画像/フキダシ/テキスト/draw-shape/グループ）
function _layerOpacityGetSelected() {
    if (state.selectedImageEl)  return state.selectedImageEl;
    if (state.selectedDrawEl)   return state.selectedDrawEl;
    if (state.selectedTextEl)   return state.selectedTextEl;
    if (state.selectedShapeId) {
        const svgEl = getPanelLayerSvg();
        return svgEl ? svgEl.querySelector(`#${CSS.escape(state.selectedShapeId)}`) : null;
    }
    if (state.selectedGroupId) {
        const svgEl = getPanelLayerSvg();
        return svgEl ? svgEl.querySelector(`[data-group-id="${state.selectedGroupId}"]`) : null;
    }
    return null;
}


function getActiveContainer() {
    return document.getElementById('layout-preview');
}

// アクティブなコンテナから統合SVGを取得するヘルパー
function getPanelLayerSvg(container) {
    if (!container) container = getActiveContainer();
    return container?.querySelector('#image-layer svg') || null;
}

