// ============================================================
// main.js 分割ファイル (6/24): グループ機能+移動
// 元 main.js の行 2625-3347 に相当
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: _insetPolygonPoints,_parsePointsStr,_pointsToStr,_polygonCenter,_round2,duplicateSelectedObject,groupSelectedLayers,moveSelectedObject,saveGroupAsAsset,ungroupLayer
// ============================================================

// ==============================
// グループ機能
// ==============================

async function groupSelectedLayers() {
    if (state.checkedLayerEls.size < 2) {
        alert(t('layer.confirmGroupMin2'));
        return;
    }
    const els = Array.from(state.checkedLayerEls);
    // 全要素が同一の直接親かチェック
    const parentEl = els[0].parentNode;
    if (!els.every(el => el.parentNode === parentEl)) {
        alert(t('layer.groupSamePanelOnly'));
        return;
    }
    const panelSvg = getPanelLayerSvg();
    if (!panelSvg) return;

    pushHistory();

    // g[data-group-id] を作成し、DOM順を維持して要素を移動
    const groupEl = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const groupId = 'group-' + Date.now();
    groupEl.setAttribute('data-group-id', groupId);
    groupEl.id = groupId;
    groupEl.setAttribute('data-tx', '0');
    groupEl.setAttribute('data-ty', '0');
    groupEl.setAttribute('data-angle', '0');

    // 最初の要素の前にグループgを挿入（DOM順を保つ）
    const sortedEls = Array.from(parentEl.children).filter(c => els.includes(c));
    parentEl.insertBefore(groupEl, sortedEls[0]);
    sortedEls.forEach(el => groupEl.appendChild(el));

    const panelId = parentEl.getAttribute('data-clip-panel') ||
                    (parentEl.hasAttribute('data-overlay-layer') ? '__overlay__' : state.selectedPanelId || 'panel-0');

    // 保存前に全ハンドルをクリア（savePanelSvg内のrenderLayerPanelで古いハンドルが残らないよう）
    clearHandles();
    clearImageHandles();
    clearTextHandles(panelSvg);
    clearGroupHandles();
    clearDrawShapeHandles(panelSvg);

    await savePanelSvg(panelId, panelSvg);
    state.checkedLayerEls.clear();
    state.selectedGroupId = groupId;
    renderGroupHandles(groupEl, panelSvg);
    renderLayerPanel();
}

async function saveGroupAsAsset(groupEl, groupName) {
    // ─ グループ名・登録先の入力 ─
    // 既存アセットフォルダ一覧を取得してドロップダウンに使う
    let existingGroups = [];
    try {
        const res = await fetch('/ccc_assets/assets.json');
        if (res.ok) {
            const data = await res.json();
            existingGroups = (data.folders || []).map(f => f.name);
        }
    } catch (_) {}

    // ダイアログ用HTML
    const dlgId = 'save-asset-dialog';
    let dlg = document.getElementById(dlgId);
    if (dlg) dlg.remove();

    dlg = document.createElement('div');
    dlg.id = dlgId;
    dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999;';

    const optionsHtml = existingGroups.map(g =>
        `<option value="${g}">${g}</option>`
    ).join('');

    dlg.innerHTML = `
        <div style="background:var(--bg-primary);border:1px solid var(--border-color);border-radius:8px;padding:20px;min-width:320px;display:flex;flex-direction:column;gap:12px;">
            <div style="font-weight:bold;font-size:14px;">${t('layer.saveAssetModalTitle')}</div>
            <div style="display:flex;flex-direction:column;gap:6px;">
                <label style="font-size:12px;">${t('layer.saveAssetGroupLabel')}</label>
                <select id="sga-group-select" style="padding:4px;font-size:13px;">
                    ${optionsHtml}
                    <option value="__new__">${t('layer.saveAssetNewGroupOption')}</option>
                </select>
                <input id="sga-new-group" placeholder="${t('layer.saveAssetNewGroupPlaceholder')}" style="display:none;padding:4px;font-size:13px;" />
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;">
                <label style="font-size:12px;">${t('layer.saveAssetFilenameLabel')}</label>
                <input id="sga-filename" placeholder="${groupName || 'group'}" style="padding:4px;font-size:13px;" />
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button id="sga-cancel" class="btn small">${t('common.cancel')}</button>
                <button id="sga-ok" class="btn small secondary">${t('layer.saveAssetOkBtn')}</button>
            </div>
            <div id="sga-status" style="font-size:11px;min-height:14px;"></div>
        </div>
    `;
    document.body.appendChild(dlg);

    const sel = dlg.querySelector('#sga-group-select');
    const newInput = dlg.querySelector('#sga-new-group');
    sel.addEventListener('change', () => {
        newInput.style.display = sel.value === '__new__' ? '' : 'none';
    });

    dlg.querySelector('#sga-cancel').addEventListener('click', () => dlg.remove());

    dlg.querySelector('#sga-ok').addEventListener('click', async () => {
        const statusEl = dlg.querySelector('#sga-status');
        let targetGroup = sel.value === '__new__' ? newInput.value.trim() : sel.value;
        if (!targetGroup) { statusEl.textContent = t('layer.saveAssetGroupNameRequired'); return; }

        const rawFilename = dlg.querySelector('#sga-filename').value.trim() || (groupName || 'group');

        // グループ要素のSVGを取り出す（ハンドル等UI要素を除外してクローン）
        const clone = groupEl.cloneNode(true);
        clone.querySelectorAll('.group-handle, .group-bbox, .group-rotate-line, .resize-handle, .rotate-handle').forEach(el => el.remove());
        // IDと座標情報を削除してアセット挿入時に再計算できるようにする
        clone.removeAttribute('id');
        clone.removeAttribute('transform');
        clone.removeAttribute('data-tx');
        clone.removeAttribute('data-ty');
        clone.removeAttribute('data-angle');

        // getBBox でサイズを取得し、スタンドアロンSVGとして包む
        let bboxAttr = '';
        try {
            const bb = groupEl.getBBox();
            bboxAttr = `viewBox="${bb.x} ${bb.y} ${bb.width} ${bb.height}" width="${bb.width}" height="${bb.height}"`;
        } catch (_) {}

        // data-group-asset="true" でグループアセットとして識別
        const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" data-group-asset="true" ${bboxAttr}>${clone.outerHTML}</svg>`;

        statusEl.textContent = t('nb.saving');
        try {
            const res = await fetch('/api/ccc/save-group-asset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ group: targetGroup, svg: svgContent, filename: rawFilename }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
            statusEl.textContent = t('layer.saveAssetDone', data.path);
            // アセットパネルを更新（サーバー側で再生成済みのassets.jsonを確実に反映するためtrueで再取得）
            if (typeof loadAssets === 'function') await loadAssets(true);
            setTimeout(() => dlg.remove(), 1200);
        } catch (err) {
            statusEl.textContent = t('common.errorPrefix', err.message);
        }
    });
}

async function ungroupLayer(groupEl) {
    const panelSvg = getPanelLayerSvg();
    if (!panelSvg) return;

    pushHistory();

    const parentEl = groupEl.parentNode;

    // グループの translate 量を取得（子要素の座標に転写するため）
    const tx = parseFloat(groupEl.getAttribute('data-tx') || '0');
    const ty = parseFloat(groupEl.getAttribute('data-ty') || '0');

    // 子要素をグループの直前に移動し、translate を転写
    Array.from(groupEl.children).forEach(child => {
        if (tx !== 0 || ty !== 0) {
            const tag = child.tagName.toLowerCase();
            if (tag === 'image' || tag === 'text' || tag === 'rect') {
                child.setAttribute('x', parseFloat(child.getAttribute('x') || 0) + tx);
                child.setAttribute('y', parseFloat(child.getAttribute('y') || 0) + ty);
                if (tag === 'text') {
                    child.querySelectorAll('tspan').forEach(ts => {
                        if (ts.hasAttribute('x')) ts.setAttribute('x', parseFloat(ts.getAttribute('x')) + tx);
                        if (ts.hasAttribute('y')) ts.setAttribute('y', parseFloat(ts.getAttribute('y')) + ty);
                    });
                }
            } else if (child.hasAttribute('data-group-id')) {
                // ネストグループ: data-tx/ty に加算して transform を再構築
                const childTx = parseFloat(child.getAttribute('data-tx') || '0') + tx;
                const childTy = parseFloat(child.getAttribute('data-ty') || '0') + ty;
                const childAngle = parseFloat(child.getAttribute('data-angle') || '0');
                child.setAttribute('data-tx', childTx);
                child.setAttribute('data-ty', childTy);
                child.dataset.rotateCx = '0';
                child.dataset.rotateCy = '0';
                child.dataset.bboxX = '0';
                child.dataset.bboxY = '0';
                child.dataset.bboxW = '0';
                child.dataset.bboxH = '0';
                child.setAttribute('transform', `translate(${childTx},${childTy}) rotate(${childAngle},0,0)`);
            } else {
                // フキダシ(path)等: 既存 transform の前に translate を付与
                const existing = child.getAttribute('transform') || '';
                if (existing) {
                    child.setAttribute('transform', `translate(${tx},${ty}) ${existing}`);
                } else {
                    child.setAttribute('transform', `translate(${tx},${ty})`);
                }
            }

            // フキダシ(balloon-shape)等の座標管理属性を更新
            ['data-cx', 'data-cy', 'data-rotate-cx', 'data-rotate-cy'].forEach(attr => {
                if (child.hasAttribute(attr)) {
                    const baseVal = parseFloat(child.getAttribute(attr) || '0');
                    const offset = attr.endsWith('x') ? tx : ty;
                    child.setAttribute(attr, baseVal + offset);
                }
            });
        }
        parentEl.insertBefore(child, groupEl);
    });
    groupEl.remove();

    if (state.selectedGroupId === groupEl.id) {
        state.selectedGroupId = null;
        clearGroupHandles();
    }

    const panelId = parentEl.getAttribute('data-clip-panel') ||
                    (parentEl.hasAttribute('data-overlay-layer') ? '__overlay__' : state.selectedPanelId || 'panel-0');
    await savePanelSvg(panelId, panelSvg);
    renderLayerPanel();
}

// ── 複製機能 ──

// 選択中のオブジェクト（画像/フキダシ/テキスト/グループ）を複製する
// targetPanelId: 複製先コマID（省略時は同コマ）
async function duplicateSelectedObject(targetPanelId) {
    const panelSvg = getPanelLayerSvg();
    if (!panelSvg) return;

    // 複製対象の SVG 要素を特定（常にIDでDOM再取得し古い参照を使わない）
    let srcEl = null;

    if (state.selectedGroupId) {
        srcEl = panelSvg.querySelector(`#${CSS.escape(state.selectedGroupId)}`);
    } else if (state.selectedShapeId) {
        srcEl = panelSvg.querySelector(`#${CSS.escape(state.selectedShapeId)}`);
    } else if (state.selectedImageEl?.id) {
        srcEl = panelSvg.querySelector(`#${CSS.escape(state.selectedImageEl.id)}`);
    } else if (state.selectedImageEl) {
        srcEl = state.selectedImageEl;
    } else if (state.selectedTextEl?.id) {
        srcEl = panelSvg.querySelector(`#${CSS.escape(state.selectedTextEl.id)}`);
    } else if (state.selectedTextEl) {
        srcEl = state.selectedTextEl;
    } else if (state.selectedDrawId) {
        srcEl = panelSvg.querySelector(`#${CSS.escape(state.selectedDrawId)}`);
    }

    if (!srcEl || !srcEl.parentNode) {
        alert(t('layer.confirmSelectDuplicateTarget'));
        return;
    }

    // 複製元の親コマgからコマIDを取得
    const srcParentG = srcEl.parentNode;
    const srcPanelId = srcParentG.getAttribute('data-clip-panel') ||
                       (srcParentG.hasAttribute('data-overlay-layer') ? '__overlay__' : state.selectedPanelId || 'panel-0');

    pushHistory();

    // ── 同コマへの複製：DOMに直接appendしてsavePanelSvg ──
    const isSamePanel = !targetPanelId || targetPanelId === srcPanelId;

    if (isSamePanel) {
        const clone = _cloneWithNewIds(srcEl);
        const OFFSET = 20;
        _applyOffset(clone, OFFSET);
        srcParentG.appendChild(clone);
        await savePanelSvg(srcPanelId, panelSvg);
        _selectClone(clone, panelSvg);
        renderLayerPanel();
        return;
    }

    // 複製元の表示上の中心をライブDOMから取得
    // getBBox() はローカル座標（transform除外）を返すため、
    // グループは data-tx/ty を加えた値が表示中心になる
    let srcCx = 0, srcCy = 0;
    try {
        const bb = srcEl.getBBox();
        const extraTx = parseFloat(srcEl.getAttribute('data-tx') || '0');
        const extraTy = parseFloat(srcEl.getAttribute('data-ty') || '0');
        srcCx = bb.x + extraTx + bb.width / 2;
        srcCy = bb.y + extraTy + bb.height / 2;
    } catch(e) { /* getBBox失敗時は0,0のまま */ }

    // ── 異コマへの複製：panelSvgContent を直接パースして追加・保存 ──
    if (targetPanelId === '__overlay__') {
        // オーバーレイ中心 = basePanelPoints のポリゴン重心
        const basePts = state.activePage.basePanelPoints || '';
        const destCenter = _polygonCenter(basePts) || { x: srcCx, y: srcCy };
        const destParentG = panelSvg.querySelector('g[data-overlay-layer]') || getOrCreateOverlayGroup(panelSvg);
        const clone = _cloneWithNewIds(srcEl);
        _applyCenterTranslate(clone, srcCx, srcCy, destCenter.x, destCenter.y);
        destParentG.appendChild(clone);
        await saveOverlaySvg(panelSvg);
        _selectClone(clone, panelSvg);
        renderLayerPanel();
        return;
    }

    // 複製先コマのpanelSvgContentを直接パースして要素を追加
    const destPanel = state.activePage.panels.find(p => p.id === targetPanelId);
    if (!destPanel) {
        alert(t('layer.duplicateTargetPanelNotFound'));
        return;
    }

    // 複製先コマ中心を panel.points から計算
    const destCenter = _polygonCenter(destPanel.points || '') || { x: srcCx, y: srcCy };

    const ns = 'http://www.w3.org/2000/svg';
    const parser = new DOMParser();
    const serializer = new XMLSerializer();

    // 複製先パネルのSVGをパース（空でも新規作成）
    const vb = panelSvg.getAttribute('viewBox') || '0 0 21000 29700';
    let destDoc, destSvg;
    if (destPanel.panelSvgContent) {
        destDoc = parser.parseFromString(destPanel.panelSvgContent, 'image/svg+xml');
        destSvg = destDoc.querySelector('svg');
    }
    if (!destSvg) {
        destDoc = document.implementation.createDocument(ns, 'svg', null);
        destSvg = destDoc.documentElement;
        destSvg.setAttribute('xmlns', ns);
        destSvg.setAttribute('viewBox', vb);
    }

    // clipPath が defs にあることを確認（なければ作成）
    const clipId = `panel-clip-${targetPanelId}`;
    let destDefs = destSvg.querySelector('defs');
    if (!destDefs) {
        destDefs = destDoc.createElementNS(ns, 'defs');
        destSvg.insertBefore(destDefs, destSvg.firstChild);
    }
    if (!destDefs.querySelector(`[id="${clipId}"]`)) {
        if (destPanel.points) {
            const cp = destDoc.createElementNS(ns, 'clipPath');
            cp.setAttribute('id', clipId);
            cp.setAttribute('clipPathUnits', 'userSpaceOnUse');
            const poly = destDoc.createElementNS(ns, 'polygon');
            poly.setAttribute('points', destPanel.points);
            cp.appendChild(poly);
            destDefs.appendChild(cp);
        }
    }

    // g[data-clip-panel] がなければ作成
    let destG = destSvg.querySelector(`g[data-clip-panel="${targetPanelId}"]`);
    if (!destG) {
        destG = destDoc.createElementNS(ns, 'g');
        destG.setAttribute('clip-path', `url(#${clipId})`);
        destG.setAttribute('data-clip-panel', targetPanelId);
        destSvg.appendChild(destG);
    }

    // 複製元をクローンし、複製先コマ中心に座標を移動してからシリアライズ→保存
    const cloneForSave = _cloneWithNewIds(srcEl);
    _applyCenterTranslate(cloneForSave, srcCx, srcCy, destCenter.x, destCenter.y);
    const cloneStr = serializer.serializeToString(cloneForSave);
    const cloneDoc = parser.parseFromString(`<svg xmlns="${ns}">${cloneStr}</svg>`, 'image/svg+xml');
    const clonedEl = cloneDoc.querySelector('svg').firstElementChild;
    const clonedElId = clonedEl?.id || null;
    if (clonedEl) {
        destG.appendChild(destDoc.importNode(clonedEl, true));
    }

    // 複製要素が参照するフィルタ定義（袋文字・影のテキストスタイル等）を表示SVGのdefsから持ち回る
    _collectReferencedFilters(destSvg, panelSvg.querySelector('defs'));

    // 新しいpanelSvgContentを生成して保存
    let newPanelSvgStr = serializer.serializeToString(destSvg);
    if (!newPanelSvgStr.includes('xmlns="http://www.w3.org/2000/svg"')) {
        newPanelSvgStr = newPanelSvgStr.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    const updatedPanels = state.activePage.panels.map(p =>
        p.id === targetPanelId ? { ...p, panelSvgContent: newPanelSvgStr } : p
    );
    const updatedRecord = { ...state.activePage, panels: updatedPanels };
    await dbPut('pages', updatedRecord);
    state.activePage = updatedRecord;

    // 再描画（DOM再構築）。この時点では複製元の選択状態を一旦クリアしておく
    state.selectedGroupId = null;
    state.selectedShapeId = null;
    state.selectedImageEl = null;
    state.selectedImageId = null;
    state.selectedTextEl  = null;
    state.selectedDrawId  = null;
    state.selectedDrawEl  = null;
    await renderLayoutTab();

    // 再描画後、複製先コマをアクティブにして新しく複製したオブジェクトを選択状態にする
    // （これをしないと選択フレームが複製元コマに取り残されたままになり操作できない）
    state.selectedPanelId = targetPanelId;
    state.selectedOverlay = false;
    const newPanelSvg = getPanelLayerSvg();
    if (newPanelSvg) {
        updatePanelSelectDropdown();
        updateBalloonPanelSelect();
        highlightOverlay(newPanelSvg, targetPanelId);
        const liveClone = clonedElId ? newPanelSvg.querySelector(`#${CSS.escape(clonedElId)}`) : null;
        if (liveClone) _selectClone(liveClone, newPanelSvg);
    }
    renderLayerPanel();
}

// ── 削除機能 ──

// 選択中のオブジェクト（画像/フキダシ/テキスト/グループ/描画図形）を削除する
// レイヤーパネル各行の削除ボタンと同じ処理を、キャンバス上の選択状態（state.selected*）から呼び出せるようにしたもの
// 戻り値: 削除を実行したら true、対象なし／ロック中で何もしなければ false
async function deleteSelectedObject() {
    const panelSvg = getPanelLayerSvg();
    if (!panelSvg) return false;

    // 削除対象の SVG 要素を特定（常にIDでDOM再取得し古い参照を使わない）
    let el = null, kind = null;
    if (state.selectedGroupId) {
        el = panelSvg.querySelector(`#${CSS.escape(state.selectedGroupId)}`);
        kind = 'group';
    } else if (state.selectedShapeId) {
        el = panelSvg.querySelector(`#${CSS.escape(state.selectedShapeId)}`);
        kind = 'shape';
    } else if (state.selectedImageEl?.id) {
        el = panelSvg.querySelector(`#${CSS.escape(state.selectedImageEl.id)}`);
        kind = 'image';
    } else if (state.selectedImageEl) {
        el = state.selectedImageEl;
        kind = 'image';
    } else if (state.selectedTextEl?.id) {
        el = panelSvg.querySelector(`#${CSS.escape(state.selectedTextEl.id)}`);
        kind = 'text';
    } else if (state.selectedTextEl) {
        el = state.selectedTextEl;
        kind = 'text';
    } else if (state.selectedDrawId) {
        el = panelSvg.querySelector(`#${CSS.escape(state.selectedDrawId)}`);
        kind = 'draw';
    }

    if (!el || !el.parentNode) return false;
    if (_isObjectLocked(el)) return false; // 個別ロック中／コマ一括ロック中は削除不可（レイヤーパネルと同じ挙動）

    pushHistory();
    state.checkedLayerEls.delete(el);

    switch (kind) {
        case 'group':
            if (state.selectedGroupId === el.id) { state.selectedGroupId = null; clearGroupHandles(); }
            break;
        case 'shape':
            if (state.selectedShapeId === el.id) { state.selectedShapeId = null; clearHandles(); }
            break;
        case 'image':
            if (state.selectedImageId === el.id || state.selectedImageEl === el) {
                state.selectedImageId = null; state.selectedImageEl = null; clearImageHandles();
            }
            break;
        case 'text':
            if (state.selectedTextEl === el) { state.selectedTextEl = null; clearTextHandles(panelSvg); }
            break;
        case 'draw':
            if (state.selectedDrawId === el.id) {
                state.selectedDrawId = null; state.selectedDrawEl = null;
                clearDrawShapeHandles(); _drawShapeSyncProps(null);
            }
            break;
    }

    let panelId;
    if (kind === 'group') {
        panelId = el.closest('g[data-clip-panel]')?.getAttribute('data-clip-panel') ||
                  (el.closest('g[data-overlay-layer]') ? '__overlay__' : state.selectedPanelId || 'panel-0');
    } else if (kind === 'image') {
        panelId = el.getAttribute('data-panel-id') || state.selectedPanelId || 'panel-0';
    } else {
        panelId = state.selectedPanelId || 'panel-0';
    }

    el.remove();

    const curSvg = getPanelLayerSvg();
    if (curSvg) {
        if (kind === 'draw' && state.selectedOverlay) await saveOverlaySvg(curSvg);
        else await savePanelSvg(panelId, curSvg);
    }
    renderLayerPanel();
    return true;
}

// レイアウトタブがアクティブな間、Delete/Backspaceキーで選択中オブジェクトを削除できるようにする
function initLayoutDeleteShortcut() {
    document.addEventListener('keydown', async (e) => {
        if (e.key !== 'Delete' && e.key !== 'Backspace') return;
        if (!document.getElementById('layout-tab')?.classList.contains('active')) return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
        const deleted = await deleteSelectedObject();
        if (deleted) e.preventDefault();
    });
}

// ==============================
// 移動
// ==============================

async function moveSelectedObject(targetPanelId) {
    const panelSvg = getPanelLayerSvg();
    if (!panelSvg) return;

    // 移動対象のSVG要素を特定（常にIDでDOM再取得し古い参照を使わない）
    let srcEl = null;
    if (state.selectedGroupId) {
        srcEl = panelSvg.querySelector(`#${CSS.escape(state.selectedGroupId)}`);
    } else if (state.selectedShapeId) {
        srcEl = panelSvg.querySelector(`#${CSS.escape(state.selectedShapeId)}`);
    } else if (state.selectedImageEl?.id) {
        srcEl = panelSvg.querySelector(`#${CSS.escape(state.selectedImageEl.id)}`);
    } else if (state.selectedImageEl) {
        srcEl = state.selectedImageEl;
    } else if (state.selectedTextEl?.id) {
        srcEl = panelSvg.querySelector(`#${CSS.escape(state.selectedTextEl.id)}`);
    } else if (state.selectedTextEl) {
        srcEl = state.selectedTextEl;
    } else if (state.selectedDrawId) {
        srcEl = panelSvg.querySelector(`#${CSS.escape(state.selectedDrawId)}`);
    }

    if (!srcEl || !srcEl.parentNode) {
        alert(t('layer.confirmSelectMoveTarget'));
        return;
    }

    // 移動元の親コマgからコマIDを取得
    const srcParentG = srcEl.parentNode;
    const srcPanelId = srcParentG.getAttribute('data-clip-panel') ||
                       (srcParentG.hasAttribute('data-overlay-layer') ? '__overlay__' : state.selectedPanelId || 'panel-0');

    // 同コマへの移動は意味がないので通知
    const isSamePanel = !targetPanelId || targetPanelId === srcPanelId;
    if (isSamePanel) {
        alert(t('layer.selectMoveDestination'));
        return;
    }

    pushHistory();

    // 移動元の表示上の中心をライブDOMから取得
    let srcCx = 0, srcCy = 0;
    try {
        const bb = srcEl.getBBox();
        const extraTx = parseFloat(srcEl.getAttribute('data-tx') || '0');
        const extraTy = parseFloat(srcEl.getAttribute('data-ty') || '0');
        srcCx = bb.x + extraTx + bb.width / 2;
        srcCy = bb.y + extraTy + bb.height / 2;
    } catch (e) { /* getBBox失敗時は0,0のまま */ }

    // ── オーバーレイへの移動 ──
    if (targetPanelId === '__overlay__') {
        const basePts = state.activePage.basePanelPoints || '';
        const destCenter = _polygonCenter(basePts) || { x: srcCx, y: srcCy };
        const destParentG = panelSvg.querySelector('g[data-overlay-layer]') || getOrCreateOverlayGroup(panelSvg);
        const clone = _cloneWithNewIds(srcEl);
        _applyCenterTranslate(clone, srcCx, srcCy, destCenter.x, destCenter.y);
        destParentG.appendChild(clone);
        const clonedElId = clone.id || null;

        // 移動元を削除してコマ保存
        state.checkedLayerEls.delete(srcEl);
        srcEl.remove();
        if (srcPanelId === '__overlay__') {
            await saveOverlaySvg(panelSvg);
        } else {
            await savePanelSvg(srcPanelId, panelSvg);
        }
        await saveOverlaySvg(panelSvg);

        // 選択状態リセット → 再描画
        state.selectedGroupId = null;
        state.selectedShapeId = null;
        state.selectedImageEl = null;
        state.selectedImageId = null;
        state.selectedTextEl  = null;
        state.selectedDrawId  = null;
        state.selectedDrawEl  = null;
        await renderLayoutTab();

        // 再描画後、移動先（オーバーレイ）をアクティブにして移動したオブジェクトを選択状態にする
        // （これをしないと選択フレームが移動元コマに取り残されたままになり操作できない）
        state.selectedPanelId = null;
        state.selectedOverlay = true;
        const newPanelSvgOv = getPanelLayerSvg();
        if (newPanelSvgOv) {
            updatePanelSelectDropdown();
            updateBalloonPanelSelect();
            highlightOverlay(newPanelSvgOv, null);
            const liveClone = clonedElId ? newPanelSvgOv.querySelector(`#${CSS.escape(clonedElId)}`) : null;
            if (liveClone) _selectClone(liveClone, newPanelSvgOv);
        }
        renderLayerPanel();
        return;
    }

    // ── 異コマへの移動：panelSvgContent直接編集 ──
    const destPanel = state.activePage.panels.find(p => p.id === targetPanelId);
    if (!destPanel) {
        alert(t('layer.moveTargetPanelNotFound'));
        return;
    }

    const destCenter = _polygonCenter(destPanel.points || '') || { x: srcCx, y: srcCy };

    const ns = 'http://www.w3.org/2000/svg';
    const parser = new DOMParser();
    const serializer = new XMLSerializer();

    // 複製先パネルのSVGをパース（空でも新規作成）
    const vb = panelSvg.getAttribute('viewBox') || '0 0 21000 29700';
    let destDoc, destSvg;
    if (destPanel.panelSvgContent) {
        destDoc = parser.parseFromString(destPanel.panelSvgContent, 'image/svg+xml');
        destSvg = destDoc.querySelector('svg');
    }
    if (!destSvg) {
        destDoc = document.implementation.createDocument(ns, 'svg', null);
        destSvg = destDoc.documentElement;
        destSvg.setAttribute('xmlns', ns);
        destSvg.setAttribute('viewBox', vb);
    }

    // clipPath が defs にあることを確認（なければ作成）
    const clipId = `panel-clip-${targetPanelId}`;
    let destDefs = destSvg.querySelector('defs');
    if (!destDefs) {
        destDefs = destDoc.createElementNS(ns, 'defs');
        destSvg.insertBefore(destDefs, destSvg.firstChild);
    }
    if (!destDefs.querySelector(`[id="${clipId}"]`)) {
        if (destPanel.points) {
            const cp = destDoc.createElementNS(ns, 'clipPath');
            cp.setAttribute('id', clipId);
            cp.setAttribute('clipPathUnits', 'userSpaceOnUse');
            const poly = destDoc.createElementNS(ns, 'polygon');
            poly.setAttribute('points', destPanel.points);
            cp.appendChild(poly);
            destDefs.appendChild(cp);
        }
    }

    // g[data-clip-panel] がなければ作成
    let destG = destSvg.querySelector(`g[data-clip-panel="${targetPanelId}"]`);
    if (!destG) {
        destG = destDoc.createElementNS(ns, 'g');
        destG.setAttribute('clip-path', `url(#${clipId})`);
        destG.setAttribute('data-clip-panel', targetPanelId);
        destSvg.appendChild(destG);
    }

    // 移動元をクローンし、移動先コマ中心に座標を移動してからシリアライズ→保存
    const cloneForSave = _cloneWithNewIds(srcEl);
    _applyCenterTranslate(cloneForSave, srcCx, srcCy, destCenter.x, destCenter.y);
    const cloneStr = serializer.serializeToString(cloneForSave);
    const cloneDoc = parser.parseFromString(`<svg xmlns="${ns}">${cloneStr}</svg>`, 'image/svg+xml');
    const clonedEl = cloneDoc.querySelector('svg').firstElementChild;
    const clonedElId = clonedEl?.id || null;
    if (clonedEl) {
        destG.appendChild(destDoc.importNode(clonedEl, true));
    }

    // 移動要素が参照するフィルタ定義（袋文字・影のテキストスタイル等）を表示SVGのdefsから持ち回る
    _collectReferencedFilters(destSvg, panelSvg.querySelector('defs'));

    // 移動先panelSvgContentを保存（パース済みdestSvgをシリアライズ）
    let newPanelSvgStr = serializer.serializeToString(destSvg);
    if (!newPanelSvgStr.includes('xmlns="http://www.w3.org/2000/svg"')) {
        newPanelSvgStr = newPanelSvgStr.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    // 移動先パネルをDBに先行保存（state.activePage を最新化）
    const preSavePanels = state.activePage.panels.map(p =>
        p.id === targetPanelId ? { ...p, panelSvgContent: newPanelSvgStr } : p
    );
    await dbPut('pages', { ...state.activePage, panels: preSavePanels });
    state.activePage = { ...state.activePage, panels: preSavePanels };

    // 移動元からライブDOMで要素を削除し、savePanelSvg でライブDOM全体を保存
    // → 保存済み文字列のパース編集ではなくライブDOMを使うことで他オブジェクトの位置が保たれる
    state.checkedLayerEls.delete(srcEl);
    if (srcPanelId === '__overlay__') {
        srcEl.remove();
        await saveOverlaySvg(panelSvg);
    } else {
        srcEl.remove();
        await savePanelSvg(srcPanelId, panelSvg);
    }

    // 選択状態リセット → 再描画
    state.selectedGroupId = null;
    state.selectedShapeId = null;
    state.selectedImageEl = null;
    state.selectedImageId = null;
    state.selectedTextEl  = null;
    state.selectedDrawId  = null;
    state.selectedDrawEl  = null;
    await renderLayoutTab();

    // 再描画後、移動先コマをアクティブにして移動したオブジェクトを選択状態にする
    // （これをしないと選択フレームが移動元コマに取り残されたままになり操作できない）
    state.selectedPanelId = targetPanelId;
    state.selectedOverlay = false;
    const newPanelSvg = getPanelLayerSvg();
    if (newPanelSvg) {
        updatePanelSelectDropdown();
        updateBalloonPanelSelect();
        highlightOverlay(newPanelSvg, targetPanelId);
        const liveClone = clonedElId ? newPanelSvg.querySelector(`#${CSS.escape(clonedElId)}`) : null;
        if (liveClone) _selectClone(liveClone, newPanelSvg);
    }
    renderLayerPanel();
}

// ── 複製ヘルパー ──

// polygon points文字列から重心(中心)を返す
function _polygonCenter(pointsStr) {
    if (!pointsStr) return null;
    const pairs = pointsStr.trim().split(/[\s,]+/);
    const coords = [];
    for (let i = 0; i + 1 < pairs.length; i += 2) {
        const x = parseFloat(pairs[i]);
        const y = parseFloat(pairs[i + 1]);
        if (!isNaN(x) && !isNaN(y)) coords.push({ x, y });
    }
    if (coords.length === 0) return null;
    const cx = coords.reduce((s, p) => s + p.x, 0) / coords.length;
    const cy = coords.reduce((s, p) => s + p.y, 0) / coords.length;
    return { x: cx, y: cy };
}

// polygon points を d だけ内側にインセットした新しい points 文字列を返す
// 各辺の内向き法線方向にオフセットした直線の交点を新頂点とする（凸・凹多角形対応）
// points文字列 "x1,y1 x2,y2 ..." ⇔ {x,y}[] の相互変換（テンプレート作成ウィザードの分割処理とも共用）
function _parsePointsStr(pointsStr) {
    if (!pointsStr) return [];
    const pairs = pointsStr.trim().split(/[\s,]+/);
    const pts = [];
    for (let i = 0; i + 1 < pairs.length; i += 2) {
        const x = parseFloat(pairs[i]), y = parseFloat(pairs[i + 1]);
        if (!isNaN(x) && !isNaN(y)) pts.push({ x, y });
    }
    return pts;
}

function _pointsToStr(pts) {
    return pts.map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ');
}

// 数値を小数点第2位までに丸める（コマ枠線幅の入力・保存で共通利用）
function _round2(n) {
    return Math.round(n * 100) / 100;
}

function _insetPolygonPoints(pointsStr, d) {
    if (!pointsStr || d === 0) return pointsStr;
    const pts = _parsePointsStr(pointsStr);
    const n = pts.length;
    if (n < 3) return pointsStr;

    // 各辺の内向き法線方向にdだけオフセットした直線を求め、隣接直線の交点を新頂点にする
    // 符号: 外積の符号でポリゴンの巻き方向を判定し、内側を正しく向ける
    // 面積の符号（正=反時計回り、負=時計回り）
    let area = 0;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    const sign = area > 0 ? 1 : -1; // 反時計回りなら1

    // 各辺のオフセット直線（ax + by = c）を計算
    const lines = [];
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const dx = pts[j].x - pts[i].x;
        const dy = pts[j].y - pts[i].y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-9) { lines.push(null); continue; }
        // 内向き法線: 時計回りポリゴンなら右方向, 反時計回りなら左方向
        const nx = -dy / len * sign;
        const ny = dx / len * sign;
        // 辺上の1点をoffset
        const ox = pts[i].x + nx * d;
        const oy = pts[i].y + ny * d;
        // 直線方程式: nx*(x-ox) + ny*(y-oy) = 0 → nx*x + ny*y = nx*ox + ny*oy
        lines.push({ a: nx, b: ny, c: nx * ox + ny * oy, dx, dy });
    }

    // 隣接直線の交点を新頂点とする
    const newPts = [];
    for (let i = 0; i < n; i++) {
        const prev = (i + n - 1) % n;
        const l1 = lines[prev], l2 = lines[i];
        if (!l1 || !l2) { newPts.push(pts[i]); continue; }
        const det = l1.a * l2.b - l2.a * l1.b;
        if (Math.abs(det) < 1e-9) {
            // 平行（同方向辺）: 単純にオフセット点を使う
            newPts.push({ x: pts[i].x + l2.a * d * sign, y: pts[i].y + l2.b * d * sign });
        } else {
            newPts.push({
                x: (l1.c * l2.b - l2.c * l1.b) / det,
                y: (l1.a * l2.c - l2.a * l1.c) / det
            });
        }
    }
    return _pointsToStr(newPts);
}

