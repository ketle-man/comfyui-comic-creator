// ============================================================
// main.js 分割ファイル (3/24): アセット管理+テンプレートサイドパネル+レイアウトプレビュー表示サイズ
// 元 main.js の行 447-835 に相当
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: _applyLayoutPreviewSize,_layoutPreviewSizePct,_renderAssetFolders,deleteAssetItem,handleInsertAsset,initAssetManager,initLayoutPreviewSizeSlider,insertGroupAsset,loadAssets,renderAssetTree,sanitizeSvgTree,selectAsset,updateTemplateSidePanel
// ============================================================

// ==============================
// アセット管理
// ==============================

// Imageタブ専用の "image" フォルダは、Aタブ（全体アセット一覧）には出さず
// 専用の「I」タブ（image-asset-tree）にのみ表示する
function _renderAssetFolders(folders) {
    const imageFolder = (folders || []).find(f => f.name === 'image');
    const otherFolders = (folders || []).filter(f => f.name !== 'image');
    renderAssetTree(otherFolders, 'asset-tree');
    renderAssetTree(imageFolder ? [imageFolder] : [], 'image-asset-tree');
}

async function loadAssets(useRefreshApi = false) {
    const container = document.getElementById('asset-tree');
    if (container) container.innerHTML = `<p class="empty-message">${t('common.loading')}</p>`;

    try {
        // start.py 経由なら /api/ccc/refresh-assets でサーバー側の assets.json を再生成してから取得
        // 通常の静的サーバーなら assets/assets.json を直接 fetch
        const url = useRefreshApi ? '/api/ccc/refresh-assets' : '/ccc_assets/assets.json';
        const response = await fetch(url);
        if (!response.ok) throw new Error('Asset manifest not found');
        const data = await response.json();
        _renderAssetFolders(data.folders);
    } catch (e) {
        // /api/ccc/refresh-assets が使えない（静的サーバー）場合は assets.json を直接取得
        if (useRefreshApi) {
            try {
                const response = await fetch('/ccc_assets/assets.json');
                if (!response.ok) throw new Error('Asset manifest not found');
                const data = await response.json();
                _renderAssetFolders(data.folders);
                return;
            } catch (_) { /* fall through */ }
        }
        console.error('Failed to load assets:', e);
        if (container) {
            container.innerHTML = `<p class="empty-message">${t('asset.loadFailed')}</p>`;
        }
    }
}

async function initAssetManager() {
    const insertBtn = document.getElementById('asset-insert-btn');
    if (insertBtn) {
        insertBtn.addEventListener('click', handleInsertAsset);
    }

    const imageInsertBtn = document.getElementById('image-asset-insert-btn');
    if (imageInsertBtn) {
        imageInsertBtn.addEventListener('click', handleInsertAsset);
    }

    const refreshBtn = document.getElementById('asset-refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            refreshBtn.classList.add('spinning');
            refreshBtn.disabled = true;
            await loadAssets(true);
            refreshBtn.classList.remove('spinning');
            refreshBtn.disabled = false;
        });
    }

    await loadAssets(false);
}

function renderAssetTree(folders, containerId = 'asset-tree') {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    folders.forEach(folder => {
        const folderItem = document.createElement('div');
        folderItem.className = 'asset-tree-item';

        const folderTitle = document.createElement('div');
        folderTitle.className = 'asset-folder';
        folderTitle.innerHTML = `
            <span class="asset-folder-icon">▼</span>
            <span class="asset-folder-name">${folder.displayName || folder.name}</span>
        `;

        const assetList = document.createElement('div');
        assetList.className = 'asset-list';

        folderTitle.addEventListener('click', () => {
            folderTitle.classList.toggle('collapsed');
            assetList.classList.toggle('collapsed');
            folderTitle.querySelector('.asset-folder-icon').textContent =
                folderTitle.classList.contains('collapsed') ? '▶' : '▼';
        });

        if (folder.assets && folder.assets.length > 0) {
            folder.assets.forEach(asset => {
                const assetItem = document.createElement('div');
                assetItem.className = 'asset-item';
                assetItem.dataset.path = asset.path;
                assetItem.title = t('asset.deleteTitleHint', asset.name);

                assetItem.innerHTML = `
                    <img src="${_escHtml(asset.path)}" class="asset-thumbnail" alt="${_escHtml(asset.name)}">
                    <span class="asset-name">${_escHtml(asset.name)}</span>
                `;

                assetItem.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (e.altKey) {
                        await deleteAssetItem(folder.name, asset);
                        return;
                    }
                    selectAsset(asset.path, asset.projectPath || null);
                });

                assetList.appendChild(assetItem);
            });
        } else {
            assetList.innerHTML = `<div class="asset-item" style="font-style:italic; opacity:0.5;">${t('asset.emptyFolder')}</div>`;
        }

        folderItem.appendChild(folderTitle);
        folderItem.appendChild(assetList);
        container.appendChild(folderItem);
    });
}

// アセット（画像/SVGファイル単体）をサーバーから削除する。Alt+クリックで呼び出される
async function deleteAssetItem(folderName, asset) {
    if (!confirm(t('asset.confirmDeleteAsset', asset.name))) return;
    try {
        const res = await fetch('/api/ccc/delete-asset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder: folderName, name: asset.name }),
        });
        const rawText = await res.text();
        let result;
        try { result = JSON.parse(rawText); }
        catch { throw new Error(t('asset.serverBadResponse', res.status)); }
        if (!res.ok || result.status !== 'ok') throw new Error(result.message || `HTTP ${res.status}`);
        if (state.selectedAssetPath === asset.path) {
            state.selectedAssetPath = null;
            state.selectedAssetProjectPath = null;
        }
        await loadAssets(true);
    } catch (e) {
        alert(t('asset.deleteFailed', e.message));
    }
}

function selectAsset(path, projectPath = null) {
    state.selectedAssetPath = path;
    state.selectedAssetProjectPath = projectPath;

    // UI更新
    document.querySelectorAll('.asset-item').forEach(item => {
        item.classList.remove('selected');
        if (item.dataset.path === path) {
            item.classList.add('selected');
        }
    });

    console.log('Selected asset:', path);
}

// 外部由来（アセット/テンプレート/プロジェクトファイル）のSVGをDOMに挿入する前に、
// <script>・<foreignObject>・on*イベントハンドラ属性・javascript: URLを除去する。
// テンプレートやグループアセットは他ユーザーと共有され得るため、埋め込みJSの実行を防ぐ。
function sanitizeSvgTree(rootEl) {
    if (!rootEl) return rootEl;
    const all = [rootEl, ...rootEl.querySelectorAll('*')];
    all.forEach(el => {
        if (el.tagName && /^(script|foreignObject)$/i.test(el.tagName)) {
            el.remove();
            return;
        }
        Array.from(el.attributes || []).forEach(attr => {
            const name = attr.name.toLowerCase();
            if (name.startsWith('on')) {
                el.removeAttribute(attr.name);
            } else if ((name === 'href' || name === 'xlink:href') && /^\s*javascript:/i.test(attr.value)) {
                el.removeAttribute(attr.name);
            }
        });
    });
    return rootEl;
}

async function handleInsertAsset() {
    if (!state.selectedAssetPath) {
        alert(t('asset.selectAssetFirst'));
        return;
    }

    // Imageタブ: プロジェクトアセット（.json付き）なら編集状態を復元、それ以外は
    // SVGグループアセットも含め常に1枚のラスター画像としてレイヤー挿入する
    if (document.querySelector('.tab-btn.active')?.dataset.tab === 'image') {
        if (!window._ccImageTab) { alert(t('asset.imageTabNotInitialized')); return; }
        const name = state.selectedAssetPath.split('/').pop().replace(/\.[^.]+$/, '') || 'asset';
        if (state.selectedAssetProjectPath) {
            await window._ccImageTab.loadProjectFromUrl(state.selectedAssetProjectPath, name);
        } else {
            await window._ccImageTab.loadFromUrl(state.selectedAssetPath, name);
        }
        return;
    }

    if (!state.selectedPanelId && !state.selectedOverlay) {
        alert(t('asset.selectPanelOrOverlay'));
        return;
    }

    try {
        const response = await fetch(state.selectedAssetPath);
        const text = await response.text();

        // SVGかどうか判定
        if (state.selectedAssetPath.toLowerCase().endsWith('.svg')) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'image/svg+xml');
            const svgEl = doc.querySelector('svg');
            sanitizeSvgTree(svgEl);
            // グループアセットかどうか判定
            if (svgEl && svgEl.getAttribute('data-group-asset') === 'true') {
                await insertGroupAsset(svgEl);
                return;
            }
            // 通常SVGは画像として挿入（dataURL経由）
        }

        // 画像ファイル（PNG/JPG等）またはSVG画像として挿入
        const blob = await (await fetch(state.selectedAssetPath)).blob();
        const reader = new FileReader();
        reader.onload = async (e) => {
            const dataUrl = e.target.result;
            const img = new Image();
            img.onload = async () => {
                await insertImage(dataUrl, img.width, img.height);
            };
            img.src = dataUrl;
        };
        reader.readAsDataURL(blob);

    } catch (e) {
        console.error('Failed to insert asset:', e);
        alert(t('asset.insertFailed'));
    }
}

async function insertGroupAsset(svgEl) {
    const curSvgEl = getPanelLayerSvg();
    if (!curSvgEl) return;

    pushHistory();

    // グループ <g> を取得してクローン
    const srcGroup = svgEl.querySelector('g[data-group-id]');
    if (!srcGroup) return;

    const groupClone = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    // 新しいIDを発行
    const newGroupId = 'group-' + Date.now();
    groupClone.setAttribute('data-group-id', newGroupId);
    groupClone.id = newGroupId;
    // 挿入先の中心座標 (px, py) を計算
    let px = 0, py = 0;
    if (state.selectedOverlay) {
        const vb = (curSvgEl.getAttribute('viewBox') || '0 0 21000 29700').split(/\s+/).map(Number);
        px = vb[0] + vb[2] / 2;
        py = vb[1] + vb[3] / 2;
    } else {
        const panel = state.activePage.panels.find(p => p.id === state.selectedPanelId);
        if (panel && panel.points) {
            const bb = getBoundingBoxFromPoints(panel.points);
            px = bb.x + bb.width / 2;
            py = bb.y + bb.height / 2;
        } else if (panel && panel.width) {
            px = panel.x + panel.width / 2;
            py = panel.y + panel.height / 2;
        } else {
            const vb = (curSvgEl.getAttribute('viewBox') || '0 0 21000 29700').split(/\s+/).map(Number);
            px = vb[0] + vb[2] / 2;
            py = vb[1] + vb[3] / 2;
        }
    }

    // アセット側の中心座標 (cx, cy) を viewBox から取得
    const assetVB = (svgEl.getAttribute('viewBox') || '0 0 0 0').split(/\s+/).map(Number);
    const cx = assetVB[0] + assetVB[2] / 2;
    const cy = assetVB[1] + assetVB[3] / 2;

    // 名前等の属性を引き継ぎつつ、座標は中央に来るように設定
    const groupName = srcGroup.getAttribute('data-group-name') || 'Asset Group';
    groupClone.setAttribute('data-group-name', groupName);
    groupClone.setAttribute('data-tx', px - cx);
    groupClone.setAttribute('data-ty', py - cy);
    groupClone.setAttribute('data-angle', '0');
    groupClone.setAttribute('transform', `translate(${px - cx},${py - cy})`);

    // 子要素をコピー（テキスト・フキダシ・画像をそのまま）
    Array.from(srcGroup.childNodes).forEach((child, idx) => {
        const imported = document.importNode(child, true);

        // IDの衝突を避けるため、子要素のIDを再帰的に振り直す
        const reassignId = (el, suffix) => {
            if (el.nodeType !== 1) return; // ELEMENT_NODEのみ
            if (el.id) {
                const prefix = el.id.split('-')[0] || 'item';
                const newId = `${prefix}-${suffix}-${Math.floor(Math.random() * 1000)}`;
                el.id = newId;
                if (el.hasAttribute('data-group-id')) {
                    el.setAttribute('data-group-id', newId);
                }
            }
            Array.from(el.children).forEach((c, i) => reassignId(c, `${suffix}-${i}`));
        };

        const timestamp = Date.now();
        reassignId(imported, `${timestamp}-${idx}`);

        groupClone.appendChild(imported);
    });

    // 挿入先グループに追加
    const targetGroup = getOrCreateClipGroup(curSvgEl);
    if (!targetGroup) return;
    targetGroup.appendChild(groupClone);

    const panelId = state.selectedOverlay ? '__overlay__'
        : (state.selectedPanelId || 'panel-0');
    await savePanelSvg(panelId, curSvgEl);

    state.selectedGroupId = newGroupId;
    renderGroupHandles(groupClone, curSvgEl);
    renderLayerPanel();
}

// ==============================
// テンプレートサイドパネル
// ==============================

function updateTemplateSidePanel(visible) {
    // レイヤーパネル（右サイドパネル）の表示/非表示のみを制御する
    // レイアウトタブでは常時表示（アクティブページなしでも表示する）
    const panel = document.getElementById('template-side-panel');
    if (!panel) return;
    panel.classList.toggle('hidden', !visible);
}

// ==============================
// レイアウトプレビュー表示サイズ
// ==============================

/** 保存済みのプレビュー表示サイズ（%）を取得（初期値はページ全体が収まる30%） */
function _layoutPreviewSizePct() {
    const v = parseInt(localStorage.getItem('layout_preview_size'), 10);
    return (Number.isFinite(v) && v >= 25 && v <= 300) ? v : 30;
}

/** プレビューSVGに表示サイズ（%）を適用 */
function _applyLayoutPreviewSize(pct) {
    const svgEl = document.querySelector('#layout-preview #image-layer svg');
    if (!svgEl) return;
    svgEl.style.width = `${pct}%`;
    // 100%以下では従来どおり縦を80vhに制限、拡大時は制限を外して横スクロールで閲覧
    svgEl.style.maxHeight = pct <= 100 ? '80vh' : 'none';
    // 縮小表示時に左に寄らないよう中央寄せ（display:block のため margin auto が有効）
    svgEl.style.marginLeft = 'auto';
    svgEl.style.marginRight = 'auto';
}

function initLayoutPreviewSizeSlider() {
    const slider = document.getElementById('layout-preview-size-slider');
    const valueEl = document.getElementById('layout-preview-size-value');
    if (!slider) return;

    slider.value = _layoutPreviewSizePct();
    if (valueEl) valueEl.textContent = `${slider.value}%`;

    slider.addEventListener('input', () => {
        const pct = parseInt(slider.value, 10) || 100;
        if (valueEl) valueEl.textContent = `${pct}%`;
        localStorage.setItem('layout_preview_size', String(pct));
        _applyLayoutPreviewSize(pct);
    });
}

