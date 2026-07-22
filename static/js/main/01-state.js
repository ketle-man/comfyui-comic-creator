// ============================================================
// main.js 分割ファイル (2/24): 状態管理+初期化+タブ管理
// 元 main.js の行 154-446 に相当
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: _FONTMGR_LS_ASSET_THUMB_BG,initAssetFontBgPicker,initAssetPanelTabs,initSubtabs,initTabs,state,switchTab
// ============================================================

// ==============================
// 状態管理
// ==============================

const state = {
    templates: [],
    pages: [],
    selectedTemplateName: null,
    activePage: null,
    activeWork: null,        // 作業中の作品 { name, width, height }（ページグループ単位）
    selectedPanelId: null,
    history: [],
    aspectRatio: null,
    balloon: {
        isTextMode: false,
        isEditMode: false,
        shapeType: 'oval',
        color: '#FFFFFF',
        borderColor: '#000000',
        borderWidth: 80,
        fontFamily: 'BIZ UDPGothic',
        fontSize: 150, // pt単位
        isVertical: false,
        textColor: '#000000'
    },
    pendingTextPosition: null,
    pendingEditTextEl: null, // 再編集対象のtext要素
    selectedImageId: null,
    selectedImageEl: null,
    selectedAssetPath: null,
    selectedAssetProjectPath: null, // Imageタブ用プロジェクト(.json)アセットの場合のパス
    selectedShapeId: null,
    selectedTextEl: null,
    selectedDrawId: null,    // 選択中のdraw-shape ID
    selectedDrawEl: null,    // 選択中のdraw-shape要素参照
    panelBorder: {
        width: 2,               // コマ枠線の太さ（SVG座標系 = UI入力値と1:1）
        svgScale: 1,            // UI入力値 = SVG座標系のstroke-width（1:1）
        activeColor: '#0077ff'  // 選択中コマの枠線色（固定）
    },
    selectedOverlay: false,     // オーバーレイレイヤーが選択中かどうか
    selectedDraft: false,       // 下書きレイヤーが編集モード（選択中）かどうか。falseの間はプレビュー上でクリックを一切受け付けない
    selectedGroupId: null,      // 選択中グループID
    checkedLayerEls: new Set(), // レイヤーパネルのチェック中SVG要素
    pose3d: {
        editor: null,           // initPoseEditor3D() の戻り値
        activePanelId: null,    // 現在オーバーレイ表示中のpanelId（nullなら非表示）
        wrapper: null,          // DIVラッパー要素
        canvas: null,           // Three.js メインcanvas
        gizmoCanvas: null,      // ギズモcanvas
        modelBuffer: null,      // ユーザー読込モデルのArrayBuffer
        modelIsDefault: true,   // デフォルトモデルかどうか
        ccOn: false,            // カラー補正の現在値
        resizeObserver: null,   // SVGリサイズ監視
    }
};

// image-tab.js は type="module" で読み込まれ、classic scriptの `const state` を直接参照する
// 前例が無いため、window経由のブリッジ関数として作業中の作品（{ name, width, height }, 単位は1/100mm）を公開する
window._ccGetActiveWork = () => state.activeWork;

// ==============================
// 初期化
// ==============================

document.addEventListener('DOMContentLoaded', async () => {
    try {
        console.log('Plugin Initializing...');
        applyI18nToHtml();
        initI18nSettings();
        db = await openDB();
        console.log('DB connected');
        initTabs();
        await initTemplateManager();
        initPageManager();
        initBalloonManager();
        initAssetManager();
        initOutputManager();
        initLayerPanel();
        initLayoutDeleteShortcut();
        initWfmGalleryTab();
        initGmicTab();
        initPixiFxButtons();
        initMangaHalftoneButton();
        initMangaEffectsButton();
        initMaskTool();
        initProcessingTab();
        initEditTab();
        if (typeof initNanobananaTab === 'function') initNanobananaTab();
        _initEditTabTrigger();
        console.log('Plugin Initialized');
    } catch (e) {
        console.error('Initialization error:', e);
        alert(t('common.initErrorPrefix', e.message));
    }
});

// ==============================
// 多言語化（i18n）設定UI
// ==============================

// 設定タブの言語セレクタを現在の言語で初期化し、変更時に setLang() → リロードする
function initI18nSettings() {
    const sel = document.getElementById('settings-ui-lang');
    if (!sel) return;
    sel.value = getLang();
    sel.addEventListener('change', () => {
        setLang(sel.value);
        location.reload();
    });
}

// ==============================
// タブ管理
// ==============================

function initTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            switchTab(tab.dataset.tab);
        });
    });

    initSubtabs();
    initPose3DTab();
    initAssetPanelTabs();
    // ページタブ（旧・出力タブ）は初期表示タブのため、サブタブも起動時に初期化する
    _initOutputSubtabs();
    _initWorkMgr();
}

// アセットパネル左サイドバーの「アセット／ページ」タブ切替
function initAssetPanelTabs() {
    const tabBtns = document.querySelectorAll('.asset-panel-tab-btn');
    const refreshBtn = document.getElementById('asset-refresh-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.panelTab;
            tabBtns.forEach(b => b.classList.toggle('active', b === btn));
            document.querySelectorAll('.asset-panel-view').forEach(v => {
                v.classList.toggle('active', v.id === `asset-panel-view-${target}`);
            });
            if (refreshBtn) refreshBtn.style.display = target === 'assets' ? '' : 'none';
            if (target === 'pages') renderPageThumbGrid();
            if (target === 'templates') renderAssetTemplateGrid();
            if (target === 'fonts') renderAssetFontGrid();
            if (target === 'script') _scriptRenderAssetPanelLists();
        });
    });
    initAssetFontBgPicker();
    _scriptInitAssetPanelSectionToggle('script-asset-work-header', 'script-asset-work-list', 'workListCollapsed');
    _scriptInitAssetPanelSectionToggle('script-asset-page-work-header', 'script-asset-page-work-list', 'pageWorkListCollapsed');
}

const _FONTMGR_LS_ASSET_THUMB_BG = 'fontmgr_asset_thumb_bg';

// アセットパネル「フォント」タブ: サムネ背景色ピッカーの初期化（選択はlocalStorageへ永続化）
function initAssetFontBgPicker() {
    const presetSel = document.getElementById('asset-font-bg-preset');
    const customInput = document.getElementById('asset-font-bg-custom');
    const view = document.getElementById('asset-panel-view-fonts');
    if (!presetSel || !customInput || !view) return;

    const applyBg = (value) => {
        if (value) view.style.setProperty('--asset-font-thumb-bg', value);
        else view.style.removeProperty('--asset-font-thumb-bg');
    };

    presetSel.addEventListener('change', () => {
        const isCustom = presetSel.value === 'custom';
        customInput.style.display = isCustom ? '' : 'none';
        const value = isCustom ? customInput.value : presetSel.value;
        applyBg(value);
        localStorage.setItem(_FONTMGR_LS_ASSET_THUMB_BG, value);
    });

    customInput.addEventListener('input', () => {
        applyBg(customInput.value);
        localStorage.setItem(_FONTMGR_LS_ASSET_THUMB_BG, customInput.value);
    });

    const saved = localStorage.getItem(_FONTMGR_LS_ASSET_THUMB_BG);
    if (saved) {
        const presetValues = Array.from(presetSel.options).map(o => o.value).filter(v => v && v !== 'custom');
        if (presetValues.includes(saved)) {
            presetSel.value = saved;
        } else {
            presetSel.value = 'custom';
            customInput.value = saved;
            customInput.style.display = '';
        }
        applyBg(saved);
    }
}

function initSubtabs() {
    document.querySelectorAll('.subtab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const subtab = btn.dataset.subtab;
            document.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.subtab-content').forEach(c => c.style.display = 'none');
            const target = document.getElementById(`subtab-${subtab}`);
            if (target) target.style.display = '';

            // 3Dポーズ以外のサブタブに切り替えた場合はビューを隠す
            if (subtab !== 'pose3d' && state.pose3d.activePanelId !== null) {
                hidePose3DCanvas();
            }

            if (subtab !== 'text') {
                // フキダシサブタブに切り替え: テキストモードをOFF
                if (state.balloon.isTextMode) {
                    state.balloon.isTextMode = false;
                    const svgEl = getPanelLayerSvg();
                    if (svgEl) {
                        svgEl.style.pointerEvents = 'none';
                        svgEl.style.cursor = 'default';
                    }
                    const toggleBtn = document.getElementById('toggle-text-btn');
                    if (toggleBtn) toggleBtn.classList.remove('active');
                }
            }
        });
    });
}

async function switchTab(tabId) {
    // 旧「テンプレート」タブはページタブ（output）のサブタブに統合済み
    if (tabId === 'template') {
        await switchTab('output');
        await _activateOutputSubtab('template');
        return;
    }

    // レイアウトタブ以外へ移動する際、3Dポーズ表示中ならThree.jsのアニメーション
    // ループ(requestAnimationFrame)を止める。サブタブ切替時のhidePose3DCanvas呼び出し
    // (このファイル内、3Dポーズ以外のサブタブへの切替処理)はメインタブ切替をカバー
    // していないため、ここで明示的に止めないと他タブ作業中もGPU描画が回り続ける。
    if (tabId !== 'layout' && state.pose3d.activePanelId !== null) {
        hidePose3DCanvas();
    }

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.tab === tabId) btn.classList.add('active');
    });

    const targetId = tabId + '-tab';
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
        if (content.id === targetId) content.classList.add('active');
    });

    // レイアウトタブ以外ではサイドパネル（コマ番号確認）を非表示
    updateTemplateSidePanel(tabId === 'layout');

    // アセットパネル（左サイドバー）を非表示にするタブ
    const _hideAssetPanelTabs = ['output', 'wfmgallery', 'nanobanana', 'settings', 'fontmgr', 'help'];
    const assetPanel = document.getElementById('asset-panel');
    if (assetPanel) assetPanel.style.display = _hideAssetPanelTabs.includes(tabId) ? 'none' : '';

    // ツールペイン（ドロー/フキダシ/テキスト/画像/マスク/3Dポーズ切替）はレイアウトタブでのみ表示
    const toolPanel = document.getElementById('tool-panel');
    if (toolPanel) toolPanel.style.display = tabId === 'layout' ? '' : 'none';

    // Imageタブではアセットパネルの「P（ページ）」「T（テンプレート）」タブは対象外のため非表示（A/F/Iのみ使用）
    const pagesTabBtn    = document.querySelector('.asset-panel-tab-btn[data-panel-tab="pages"]');
    const templatesTabBtn = document.querySelector('.asset-panel-tab-btn[data-panel-tab="templates"]');
    [pagesTabBtn, templatesTabBtn].forEach(btn => { if (btn) btn.style.display = tabId === 'image' ? 'none' : ''; });
    if (tabId === 'image') {
        const activeBtn = document.querySelector('.asset-panel-tab-btn.active');
        if (activeBtn && (activeBtn.dataset.panelTab === 'pages' || activeBtn.dataset.panelTab === 'templates')) {
            document.querySelector('.asset-panel-tab-btn[data-panel-tab="assets"]')?.click();
        }
    }
    // 「I（画像プロジェクト）」タブはImageタブでのみ使用（他タブでは非表示、アクティブなら強制的にAタブへ戻す）
    const imagesTabBtn = document.getElementById('asset-panel-tab-images');
    if (imagesTabBtn) imagesTabBtn.style.display = tabId === 'image' ? '' : 'none';
    if (tabId !== 'image') {
        const activeBtn = document.querySelector('.asset-panel-tab-btn.active');
        if (activeBtn && activeBtn.dataset.panelTab === 'images') {
            document.querySelector('.asset-panel-tab-btn[data-panel-tab="assets"]')?.click();
        }
    }
    // スクリプトタブではアセットパネルは「S」タブのみ使用（A/P/T/F/Iは非表示）。他タブでは逆にSを隠す
    const scriptTabBtn = document.getElementById('asset-panel-tab-script');
    if (scriptTabBtn) scriptTabBtn.style.display = tabId === 'project' ? '' : 'none';
    if (tabId === 'project') {
        ['assets', 'pages', 'templates', 'fonts', 'images'].forEach(key => {
            const btn = document.querySelector(`.asset-panel-tab-btn[data-panel-tab="${key}"]`);
            if (btn) btn.style.display = 'none';
        });
        document.querySelector('.asset-panel-tab-btn[data-panel-tab="script"]')?.click();
    } else {
        const activeBtn = document.querySelector('.asset-panel-tab-btn.active');
        if (activeBtn && activeBtn.dataset.panelTab === 'script') {
            document.querySelector('.asset-panel-tab-btn[data-panel-tab="assets"]')?.click();
        }
    }
    // アセット挿入ボタンの文言をタブに応じて切替（レイアウト=コマへ挿入／Image=レイヤーとして挿入）
    const assetInsertBtn = document.getElementById('asset-insert-btn');
    if (assetInsertBtn) assetInsertBtn.textContent = tabId === 'image' ? t('asset.insertAsLayer') : t('asset.insertToPanel');

    if (tabId === 'layout') {
        await renderLayoutTab();
        renderAssetFontGrid();
    } else if (tabId === 'image') {
        if (typeof window.initImageTab === 'function') await window.initImageTab();
        renderAssetFontGrid();
    } else if (tabId === 'output') {
        await onSwitchToOutputTab();
    } else if (tabId === 'wfmgallery') {
        await loadWfmGalleryTab();
    } else if (tabId === 'settings') {
        initEagleSettings();
        initGmicSettings();
        initI2ISettings();
    } else if (tabId === 'fontmgr') {
        await initFontMgrTab();
    } else if (tabId === 'project') {
        initProjectTab();
    } else if (tabId === 'help') {
        initHelpTab();
    }
}

