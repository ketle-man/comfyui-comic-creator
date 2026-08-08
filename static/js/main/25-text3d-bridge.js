// ============================================================
// main.js 分割ファイル (25/25): 3Dテキストエディタ（レイアウトタブ）
// 23-pose3d-bridge.js と同じ「canvasオーバーレイ + 確定時画像化」方式を踏襲する。
// type="module" として読み込まれる。
// ============================================================

import { t } from '../i18n.js';
import { getBoundingBoxFromPoints, insertImage } from './08-panels-images.js';
import { deleteSelectedObject } from './05-groups-move.js';
import { GOOGLE_FONT_FAMILIES } from './11b-page-manager-tab.js';
import { state } from './01-state.js';
import { loadFontForText3d } from '../text3d-font-loader.js';
import { openText3DSettingsModal } from '../text3d-settings-modal.js';

let _systemFontFamiliesCache = null; // window.queryLocalFonts() の結果（family名の重複除去済み配列）をキャッシュ

// editor.getSvgWarnings() が返す警告キー → i18nキーの対応表（text3d-core.js側は翻訳を持たないため呼び出し側で変換する）
const SVG_WARNING_I18N_KEYS = {
    svgTextNode: 'layout.text3dSvgTextNodeWarning',
    svgImageNode: 'layout.text3dSvgImageNodeWarning',
    svgNoPath: 'layout.text3dSvgNoPathWarning',
    svgParseFailed: 'layout.text3dSvgParseFailed',
    svgBevelTooLarge: 'layout.text3dSvgBevelTooLargeWarning',
};

function _text3dFormatSvgWarnings(keys) {
    return (keys || []).map(k => t(SVG_WARNING_I18N_KEYS[k] ?? k)).join(' / ');
}

// state.text3d.materialParams をエディタへ適用すべきタイミングかどうか。
// マテリアル設定は⚙モーダルからeditorへ直接適用され、editor内部に生きた状態として保持されるため、
// 毎回のshowText3DCanvas呼び出しで無条件に上書きすると、モーダルでの調整がリセットされてしまう。
// 新規エディタ作成時・再編集時（startReeditText3Dがtrueに戻す）にのみ適用する。
let _pendingMaterialApply = true;

function initText3DTab() {
    const placeBtn   = document.getElementById('text3d-place-btn');
    const commitBtn  = document.getElementById('text3d-commit-btn');
    const cancelBtn  = document.getElementById('text3d-cancel-btn');
    const refreshBtn = document.getElementById('text3d-refresh-btn');
    const resetCameraBtn = document.getElementById('text3d-reset-camera-btn');
    const settingsBtn = document.getElementById('text3d-settings-btn');
    const reeditBtn  = document.getElementById('text3d-reedit-btn');
    const statusEl   = document.getElementById('text3d-status');

    const depthInput   = document.getElementById('text3d-depth');
    const bevelInput   = document.getElementById('text3d-bevel');
    const modeTextBtn    = document.getElementById('text3d-mode-text');
    const modeSvgBtn     = document.getElementById('text3d-mode-svg');
    const svgControls    = document.getElementById('text3d-svg-controls');
    const svgFileInput   = document.getElementById('text3d-svg-file');
    const svgFileNameEl  = document.getElementById('text3d-svg-filename');
    const svgSizeInput   = document.getElementById('text3d-svg-size');

    if (!placeBtn) return; // HTMLが存在しない場合はスキップ

    // コマに配置
    placeBtn.addEventListener('click', () => {
        const panelId = state.selectedPanelId;
        if (!panelId && !state.selectedOverlay) {
            if (statusEl) statusEl.textContent = t('layout.text3dSelectPanelFirst');
            return;
        }
        if (state.selectedOverlay) {
            if (statusEl) statusEl.textContent = t('layout.text3dCannotPlaceOnOverlay');
            return;
        }
        state.text3d.reeditImageEl = null;
        showText3DCanvas(panelId);
    });

    commitBtn.addEventListener('click', () => commitText3D());

    if (refreshBtn) refreshBtn.addEventListener('click', () => {
        const pid = state.text3d.activePanelId;
        if (!pid || !state.text3d.editor) return;
        const previewContainer = document.getElementById('layout-preview');
        if (!previewContainer) return;
        if (!previewContainer.contains(state.text3d.wrapper)) {
            previewContainer.appendChild(state.text3d.wrapper);
        }
        const p  = state.activePage?.panels.find(pp => pp.id === pid);
        const sv = document.querySelector('#layout-preview #image-layer svg');
        if (p && sv) _text3dSyncPosition(p, sv);
    });

    cancelBtn.addEventListener('click', () => {
        hideText3DCanvas();
        state.text3d.reeditImageEl = null;
        if (statusEl) statusEl.textContent = '';
    });

    // カメラの位置をOrbitControls操作で見失った場合に復帰させる（テキストが視野外に出て
    // 「戻せなくなった」という報告があったため追加。editorのresetCamera()は現在のテキストの
    // bboxに合わせてカメラを再フィットする）
    if (resetCameraBtn) resetCameraBtn.addEventListener('click', () => {
        state.text3d.editor?.resetCamera();
    });

    if (settingsBtn) settingsBtn.addEventListener('click', () => {
        if (!state.text3d.editor) return;
        // モーダルがcvsWrapperを一時的に借りている間、コマ位置追従用ResizeObserverが
        // 元のコマ位置へ強制的に書き戻してしまいモーダル内プレビューが画面外へ飛ぶ不具合への対応
        // （実機検証で確認）。モーダルを開く前に止め、閉じたら再セットアップする。
        state.text3d.resizeObserver?.disconnect();
        openText3DSettingsModal(state.text3d.editor, state.text3d.wrapper, {
            onClose: () => {
                _text3dStartResizeObserver();
                // テキスト・整列・行間はモーダル内でeditorへ直接適用されるため、閉じた時点で
                // editor側の最新値をstateへ読み戻す（次回showText3DCanvas→_text3dApplyInitialState
                // が古いstate値で上書きしてしまわないようにするため）。
                const p = state.text3d.editor.getParams();
                state.text3d.text = p.text;
                state.text3d.align = p.align;
                state.text3d.lineHeight = p.lineHeight;
            },
            fontControls: {
                getFontSource: () => state.text3d.fontSource,
                setFontSource: (source) => { state.text3d.fontSource = source; },
                getFontFamily: () => state.text3d.fontFamily,
                setFontFamily: (family) => { state.text3d.fontFamily = family; _text3dReloadFont(); },
                getFontFamilyOptions: (source) => _text3dGetFontFamilyOptions(source),
            },
        });
    });

    if (reeditBtn) reeditBtn.addEventListener('click', () => {
        if (state.selectedImageEl) startReeditText3D(state.selectedImageEl);
    });

    if (depthInput) depthInput.addEventListener('input', () => {
        state.text3d.editor?.setDepth(parseFloat(depthInput.value));
    });
    if (bevelInput) bevelInput.addEventListener('change', () => {
        state.text3d.editor?.setBevel(bevelInput.checked);
    });

    // モード切替（テキスト/SVG立体化）
    const _setRenderMode = (mode) => {
        state.text3d.renderMode = mode;
        modeTextBtn?.classList.toggle('active', mode === 'text');
        modeSvgBtn?.classList.toggle('active', mode === 'svg');
        if (svgControls) svgControls.style.display = mode === 'svg' ? 'flex' : 'none';
        state.text3d.editor?.setRenderMode(mode);
        if (statusEl) statusEl.textContent = _text3dFormatSvgWarnings(state.text3d.editor?.getSvgWarnings());
    };
    if (modeTextBtn) modeTextBtn.addEventListener('click', () => _setRenderMode('text'));
    if (modeSvgBtn)  modeSvgBtn.addEventListener('click', () => _setRenderMode('svg'));

    // SVGファイル選択
    if (svgFileInput) svgFileInput.addEventListener('change', () => {
        const file = svgFileInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            state.text3d.svgData = String(reader.result || '');
            state.text3d.svgFileName = file.name;
            if (svgFileNameEl) svgFileNameEl.textContent = file.name;
            state.text3d.editor?.setSvgData(state.text3d.svgData);
            if (statusEl) statusEl.textContent = _text3dFormatSvgWarnings(state.text3d.editor?.getSvgWarnings());
        };
        reader.onerror = () => {
            if (statusEl) statusEl.textContent = t('layout.text3dSvgParseFailed');
        };
        reader.readAsText(file);
    });

    if (svgSizeInput) svgSizeInput.addEventListener('input', () => {
        state.text3d.svgSize = parseFloat(svgSizeInput.value);
        state.text3d.editor?.setSvgSize(state.text3d.svgSize);
    });
}

// コマ上に Three.js canvas をオーバーレイ表示する（showPose3DCanvasと同型）
// コマ位置追従用ResizeObserverを(再)セットアップする。showText3DCanvas()に加え、
// 3Dテキスト設定モーダルを閉じた直後（onCloseコールバック）からも呼ばれる
// （モーダルがcvsWrapperを借りている間はこのobserverを止めておく必要があるため）。
function _text3dStartResizeObserver() {
    const previewContainer = document.getElementById('layout-preview');
    const svgEl = document.querySelector('#layout-preview #image-layer svg');
    if (!previewContainer || !svgEl) return;

    if (state.text3d.resizeObserver) state.text3d.resizeObserver.disconnect();
    state.text3d.resizeObserver = new ResizeObserver(() => {
        if (state.text3d.activePanelId) {
            const p = state.activePage?.panels.find(pp => pp.id === state.text3d.activePanelId);
            const sv = document.querySelector('#layout-preview #image-layer svg');
            if (p && sv) _text3dSyncPosition(p, sv);
        }
    });
    state.text3d.resizeObserver.observe(svgEl);
    state.text3d.resizeObserver.observe(previewContainer);
}

function showText3DCanvas(panelId) {
    if (!panelId || !state.activePage) return;

    const panel = state.activePage.panels.find(p => p.id === panelId);
    if (!panel) return;

    const previewContainer = document.getElementById('layout-preview');
    const svgEl = document.querySelector('#layout-preview #image-layer svg');
    if (!previewContainer || !svgEl) {
        const statusEl = document.getElementById('text3d-status');
        if (statusEl) statusEl.textContent = t('layout.text3dSelectPanelInLayout');
        return;
    }

    previewContainer.style.position = 'relative';

    if (!state.text3d.wrapper) {
        const wrapper = document.createElement('div');
        wrapper.id = 'text3d-wrapper';
        wrapper.style.cssText =
            'position:absolute; z-index:150; overflow:hidden; opacity:0; pointer-events:none; ' +
            'border:2px solid #40a0e0; box-sizing:border-box; cursor:default;';

        const cvs = document.createElement('canvas');
        cvs.id = 'text3d-canvas';
        cvs.style.cssText = 'position:absolute; top:0; left:0;';

        wrapper.appendChild(cvs);

        state.text3d.wrapper = wrapper;
        state.text3d.canvas = cvs;
    }

    if (!previewContainer.contains(state.text3d.wrapper)) {
        previewContainer.appendChild(state.text3d.wrapper);
    }

    state.text3d.wrapper.style.opacity = '1';
    state.text3d.wrapper.style.pointerEvents = 'auto';
    void previewContainer.getBoundingClientRect();
    state.text3d.activePanelId = panelId;
    _text3dSyncPosition(panel, svgEl);
    requestAnimationFrame(() => requestAnimationFrame(() => {
        const p  = state.activePage?.panels.find(pp => pp.id === panelId);
        const sv = document.querySelector('#layout-preview #image-layer svg');
        if (p && sv) {
            _text3dSyncPosition(p, sv);
            const cvs = state.text3d.canvas;
            if (state.text3d.editor && cvs.clientWidth > 0) {
                state.text3d.editor.resizeRenderer(cvs.clientWidth, cvs.clientHeight);
            }
        }
    }));

    if (!state.text3d.editor) {
        const initFn = window.initText3DEditor;
        if (typeof initFn !== 'function') {
            const statusEl = document.getElementById('text3d-status');
            if (statusEl) statusEl.textContent = t('common.loading');
            setTimeout(() => showText3DCanvas(panelId), 300);
            return;
        }
        state.text3d.editor = initFn(state.text3d.canvas, {});
        const cvs = state.text3d.canvas;
        state.text3d.editor.resizeRenderer(cvs.width || 600, cvs.height || 600);
    }

    // エディタが既存（別のコマへの再配置・再表示）の場合でも、UIコントロールの現在値と
    // カメラ位置を毎回同期する。ここを初回限定にすると、2回目以降の配置でテキスト/フォントが
    // 反映されない・カメラが手動操作で見失った位置のまま戻らない、という不具合になる（実機で確認）。
    _text3dApplyInitialState();

    _text3dStartResizeObserver();

    if (state.text3d.editor) {
        const cvs = state.text3d.canvas;
        if (cvs.width > 0 && cvs.height > 0) {
            state.text3d.editor.resizeRenderer(cvs.width, cvs.height);
        }
        state.text3d.editor.startLoop();
    }

    const commitBtn = document.getElementById('text3d-commit-btn');
    const cancelBtn = document.getElementById('text3d-cancel-btn');
    if (commitBtn) commitBtn.disabled = false;
    if (cancelBtn) cancelBtn.style.display = '';
    const statusEl = document.getElementById('text3d-status');
    if (statusEl) statusEl.textContent = t('layout.text3dViewActiveHint');
}

// エディタ初期化直後、現在のUIコントロール値（再編集時はrestoreされた値）をエディタへ一括反映する
function _text3dApplyInitialState() {
    const editor = state.text3d.editor;
    if (!editor) return;

    const depthInput = document.getElementById('text3d-depth');
    const bevelInput = document.getElementById('text3d-bevel');
    const statusEl = document.getElementById('text3d-status');
    const modeTextBtn   = document.getElementById('text3d-mode-text');
    const modeSvgBtn    = document.getElementById('text3d-mode-svg');
    const svgControls   = document.getElementById('text3d-svg-controls');
    const svgFileNameEl = document.getElementById('text3d-svg-filename');
    const svgSizeInput  = document.getElementById('text3d-svg-size');

    editor.setDepth(parseFloat(depthInput?.value ?? 0.15));

    // マテリアルは⚙モーダルで直接editorへ適用され、editor内部に生きた状態として残る。
    // 新規作成直後・再編集復元直後（_pendingMaterialApply）以外は上書きしない。
    if (_pendingMaterialApply) {
        const mp = state.text3d.materialParams;
        editor.setBevel(!!bevelInput?.checked, {
            bevelThickness: mp.bevelThickness,
            bevelSize: mp.bevelSize,
            bevelSegments: mp.bevelSegments,
        });
        editor.setFrontColor(mp.frontColor);
        editor.setSideColor(mp.sideColor);
        editor.setSeparateSides(mp.separateSides);
        editor.setMaterialType(mp.materialType);
        editor.setMetalness(mp.metalness);
        editor.setRoughness(mp.roughness);
        editor.setShadeColor(mp.shadeColor);
        editor.setToony(mp.toony);
        _pendingMaterialApply = false;
    } else {
        editor.setBevel(!!bevelInput?.checked);
    }

    // SVG立体化モード（パネルに残っている現在値を毎回同期する）
    const mode = state.text3d.renderMode || 'text';
    modeTextBtn?.classList.toggle('active', mode === 'text');
    modeSvgBtn?.classList.toggle('active', mode === 'svg');
    if (svgControls) svgControls.style.display = mode === 'svg' ? 'flex' : 'none';
    if (svgFileNameEl) svgFileNameEl.textContent = state.text3d.svgFileName || t('layout.text3dSvgFileNoneLabel');
    if (svgSizeInput) svgSizeInput.value = state.text3d.svgSize ?? 1.5;
    editor.setSvgSize(state.text3d.svgSize ?? 1.5);
    editor.setSvgData(state.text3d.svgData || '');
    editor.setRenderMode(mode);
    if (mode === 'svg') statusEl && (statusEl.textContent = _text3dFormatSvgWarnings(editor.getSvgWarnings()));

    // テキスト内容・整列・行間・フォントは⚙設定モーダルへ移動しUI要素を持たないため、
    // state.text3dの値をここで一括適用する（モーダルを閉じた際にstateへ読み戻される）。
    editor.setAlign(state.text3d.align || 'center');
    editor.setLineHeight(state.text3d.lineHeight ?? 1.4);
    _text3dReloadFont().then(() => {
        editor.setText(state.text3d.text || '');
    });
}

// コマbboxに合わせてラッパー位置・canvasサイズを更新（_pose3dSyncPositionと同型）
function _text3dSyncPosition(panel, svgEl) {
    const bbox = getBoundingBoxFromPoints(panel.points);
    if (!bbox) return;

    const previewContainer = document.getElementById('layout-preview');
    if (!previewContainer) return;

    const ctm = svgEl.getScreenCTM();
    if (!ctm) {
        requestAnimationFrame(() => {
            const pid = state.text3d.activePanelId;
            const sv  = document.querySelector('#layout-preview #image-layer svg');
            if (pid && sv) {
                const p = state.activePage?.panels.find(pp => pp.id === pid);
                if (p) _text3dSyncPosition(p, sv);
            }
        });
        return;
    }

    function svgToClient(x, y) {
        const pt = svgEl.createSVGPoint();
        pt.x = x; pt.y = y;
        return pt.matrixTransform(ctm);
    }

    const topLeft     = svgToClient(bbox.x, bbox.y);
    const bottomRight = svgToClient(bbox.x + bbox.width, bbox.y + bbox.height);
    const parentRect  = previewContainer.getBoundingClientRect();

    const left   = topLeft.x - parentRect.left + previewContainer.scrollLeft;
    const top    = topLeft.y - parentRect.top  + previewContainer.scrollTop;
    const width  = bottomRight.x - topLeft.x;
    const height = bottomRight.y - topLeft.y;

    const wrapper = state.text3d.wrapper;
    wrapper.style.left   = `${left}px`;
    wrapper.style.top    = `${top}px`;
    wrapper.style.width  = `${width}px`;
    wrapper.style.height = `${height}px`;

    const dpr  = window.devicePixelRatio || 1;
    const newW = Math.round(width  * dpr);
    const newH = Math.round(height * dpr);
    const cvs  = state.text3d.canvas;
    cvs.style.width  = `${width}px`;
    cvs.style.height = `${height}px`;
    if (cvs.width !== newW || cvs.height !== newH) {
        cvs.width  = newW;
        cvs.height = newH;
        if (state.text3d.editor) {
            state.text3d.editor.resizeRenderer(newW, newH);
        }
    }
}

// 3D ビューを非表示にする
function hideText3DCanvas() {
    if (state.text3d.editor) state.text3d.editor.stopLoop();
    if (state.text3d.wrapper) {
        state.text3d.wrapper.style.opacity = '0';
        state.text3d.wrapper.style.pointerEvents = 'none';
    }
    if (state.text3d.resizeObserver) {
        state.text3d.resizeObserver.disconnect();
        state.text3d.resizeObserver = null;
    }
    state.text3d.activePanelId = null;

    const commitBtn = document.getElementById('text3d-commit-btn');
    const cancelBtn = document.getElementById('text3d-cancel-btn');
    if (commitBtn) commitBtn.disabled = true;
    if (cancelBtn) cancelBtn.style.display = 'none';
    const statusEl = document.getElementById('text3d-status');
    if (statusEl) statusEl.textContent = '';
}

// キャプチャ → insertImage でSVGに焼き込む（再編集時は旧imageを先に削除してから挿入する）
async function commitText3D() {
    const editor  = state.text3d.editor;
    const panelId = state.text3d.activePanelId;
    if (!editor || !panelId) return;

    const paramsJson = editor.exportParams();
    const dataUrl = editor.capture();

    const cvs = state.text3d.canvas;
    const w = cvs.width  || 600;
    const h = cvs.height || 600;

    const reeditEl = state.text3d.reeditImageEl;
    state.text3d.reeditImageEl = null;
    hideText3DCanvas();

    const prevPanelId = state.selectedPanelId;
    const prevImageEl = state.selectedImageEl;
    const prevImageId = state.selectedImageId;

    if (reeditEl && reeditEl.parentNode) {
        state.selectedImageEl = reeditEl;
        state.selectedImageId = reeditEl.id || null;
        await deleteSelectedObject();
    }

    state.selectedPanelId = panelId;
    await insertImage(dataUrl, w, h, { 'data-text3d-params': paramsJson });

    state.selectedPanelId = prevPanelId;
    if (!reeditEl) {
        state.selectedImageEl = prevImageEl;
        state.selectedImageId = prevImageId;
    }

    const statusEl = document.getElementById('text3d-status');
    if (statusEl) statusEl.textContent = t('layout.text3dCommitted');
}

// 指定ソース(Google/System)のフォントファミリー一覧を返す（⚙設定モーダルのfontControls用）。
// システムフォットは初回のみ非同期取得しキャッシュする。
function _text3dGetFontFamilyOptions(source) {
    if (source === 'system') {
        if (_systemFontFamiliesCache) return _systemFontFamiliesCache;
        return _text3dLoadSystemFontFamilies().then(list => {
            _systemFontFamiliesCache = list;
            return list;
        });
    }
    return Array.from(GOOGLE_FONT_FAMILIES);
}

async function _text3dLoadSystemFontFamilies() {
    if (typeof window.queryLocalFonts !== 'function') return [];
    try {
        const fonts = await window.queryLocalFonts();
        return Array.from(new Set(fonts.map(f => f.family))).sort();
    } catch (e) {
        console.warn('[text3d] システムフォント一覧の取得に失敗しました:', e);
        return [];
    }
}

// state.text3d.fontFamily/fontSource（現在選択中のフォント）をロードしてエディタに適用する。
// フォント選択UIは⚙設定モーダルへ移動しUI要素を常時持たないため、DOMではなくstateを直接読む。
async function _text3dReloadFont() {
    const family = state.text3d.fontFamily;
    const source = state.text3d.fontSource;
    const statusEl = document.getElementById('text3d-status');
    if (!family || !state.text3d.editor) return;

    if (statusEl) statusEl.textContent = t('layout.text3dFontLoading');
    try {
        const font = await loadFontForText3d(family, source);
        state.text3d.editor.setFont(font, family, source);
        if (statusEl) statusEl.textContent = '';
    } catch (err) {
        console.error('[text3d] フォント読込失敗:', err);
        if (statusEl) statusEl.textContent = t('layout.text3dFontLoadFailed', err.message);
    }
}

// data-text3d-params から復元して再編集を開始する
function startReeditText3D(imageEl) {
    const paramsJson = imageEl?.dataset.text3dParams;
    if (!paramsJson) return;

    let params;
    try {
        params = JSON.parse(paramsJson);
    } catch {
        return;
    }

    const panelId = imageEl.closest('g[data-clip-panel]')?.getAttribute('data-clip-panel') || state.selectedPanelId;
    if (!panelId) return;

    state.text3d.reeditImageEl = imageEl;
    state.text3d.fontSource = params.fontSource || 'google';
    state.text3d.fontFamily = params.fontFamily || state.text3d.fontFamily;
    // SVG立体化モード関連の復元（旧データにはrenderMode/svgDataが存在しないため'text'にフォールバック）
    state.text3d.renderMode = params.renderMode === 'svg' ? 'svg' : 'text';
    state.text3d.svgData = params.svgData || '';
    state.text3d.svgFileName = params.svgFileName || '';
    state.text3d.svgSize = params.svgSize ?? 1.5;
    // テキスト内容・整列・行間の復元（⚙設定モーダルへ移動しUI要素を持たないためstateへ直接格納する）
    state.text3d.text = params.text || '';
    state.text3d.align = params.align || 'center';
    state.text3d.lineHeight = params.lineHeight ?? 1.4;

    // UIコントロールに復元値を反映（showText3DCanvas → _text3dApplyInitialStateがこの値を読む）
    const depthInput = document.getElementById('text3d-depth');
    const bevelInput = document.getElementById('text3d-bevel');

    if (depthInput) depthInput.value = params.depth ?? 0.15;
    if (bevelInput) bevelInput.checked = !!params.bevelEnabled;

    // マテリアルはUI要素を持たないため state.text3d.materialParams に復元値を格納し、
    // 次の showText3DCanvas → _text3dApplyInitialState() での1回限りの適用を予約する。
    // 旧データ（frontColor/sideColor導入前）は単色の`color`をfrontColor/sideColor両方へフォールバックする。
    state.text3d.materialParams = {
        frontColor: params.frontColor || params.color || '#ffffff',
        sideColor: params.sideColor || params.frontColor || params.color || '#ffffff',
        separateSides: !!params.separateSides,
        materialType: params.materialType === 'toon' ? 'toon' : 'standard',
        metalness: params.metalness ?? 0.1,
        roughness: params.roughness ?? 0.6,
        shadeColor: params.shadeColor || '#999999',
        toony: params.toony ?? 0.9,
        bevelThickness: params.bevelThickness ?? 0.02,
        bevelSize: params.bevelSize ?? 0.01,
        bevelSegments: params.bevelSegments ?? 2,
    };
    _pendingMaterialApply = true;

    // subtabを3Dテキストに切り替えてから表示する
    document.querySelector('.subtab-btn[data-subtab="text3d"]')?.click();
    showText3DCanvas(panelId);
}

export { initText3DTab, hideText3DCanvas, _text3dSyncPosition, startReeditText3D };

// まだESM化されていない main/以下の classic <script> や、既存ESMファイルの一部が
// window経由で呼んでいるためのブリッジ（ESモジュール化移行中の一時措置）。
window.initText3DTab = initText3DTab;
window.startReeditText3D = startReeditText3D;
