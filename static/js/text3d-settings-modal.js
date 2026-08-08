// text3d-settings-modal.js — 3Dテキストの「ライト・マテリアル・テキスト設定」モーダル
//
// comfyui-vrm-pose-editor の light_editor.js (openLightEditor) を範にした軽量版。
// text3dのライトはAmbient/Key/Fillの3灯固定（3Dポーズ側のような自由な追加/削除・
// プリセットライブラリは持たない）。
//
// レイアウト: 左＝ライト/マテリアル/カメラのタブ切替パネル、中央＝プレビュー、
// 右＝テキスト設定（テキスト内容・フォント・整列・行間、常時表示・タブ化しない）。
// 常時表示のツールバーからはテキスト入力・フォント・整列を撤去し、ここに集約する。
//
// ズーム操作モード設定（ホイール/Ctrl+右ドラッグ）は localStorage キー
// 'vrmPoseEditor_zoomMode' を3Dポーズ側のLight Editorと共有する。どちらで変更しても
// 次に開いた側に反映される。
//
// プレビュー: light_editor.jsのbuildModal()と同じ手法で、実際に描画中のcanvasを
// 内包するcvsWrapper(DOM要素)をモーダル内のプレビュー枠へ一時的に移動し、CSS transform:scale()で
// 枠に収まるよう縮小表示する。閉じる際に元の位置・スタイルへ復元する。背景を暗くする通常のモーダルだと
// 実際に描画中のcanvasが隠れてしまい、色・質感の見比べができないための対応（ユーザー指摘）。
//
// editor は initText3DEditor() の戻り値（getLights/setLightColor/setLightIntensity/
// setLightPosition/getZoomMode/setZoomMode/getParams/setFrontColor/setSideColor/
// setSeparateSides/setMaterialType/setMetalness/setRoughness/setShadeColor/setToony/
// setBevelThickness/setBevelSize/setBevelSegments/setText/setAlign/setLineHeight/
// resetCamera/resizeRenderer/getSuperSample/setSuperSample を持つ）を渡す。
// cvsWrapper は実際に描画中のcanvasを内包するDOM要素（呼び出し元のwrapper div）を渡す。
//
// options.onClose（省略可）: モーダルが閉じた（cleanup()が呼ばれた）タイミングで呼ばれる
// コールバック。レイアウトタブ側は cvsWrapper の位置をコマの画面上位置に追従させる
// ResizeObserverを持っており、これがモーダル表示中も動き続けると、モーダルが一時的に
// 借りているcvsWrapperのleft/top/transformを「コマの本来の位置」へ強制的に書き戻してしまい、
// モーダル内プレビューが（実際には正しく描画されているのに）画面外へ飛ばされて真っ黒に見える
// 不具合が実機検証で判明した。呼び出し側はopen前にそのResizeObserverをdisconnectし、
// onCloseで再接続する（テキスト/整列/行間はモーダル内で直接editorへ適用されるため、
// 呼び出し側が独自の状態変数を持つ場合はonClose内でeditor.getParams()から読み戻して同期する）。
//
// options.fontControls（省略可。渡さない場合はフォント選択UIを表示しない）:
// フォントの読み込み・一覧取得は非同期かつ呼び出し側（レイアウトタブ/Imageタブ）ごとに
// 実装が異なる（Google Fonts一覧の取得元・システムフォントキャッシュの持ち方が別々）ため、
// モーダル自身はロジックを持たず、以下のコールバック一式を呼び出し側から受け取って委譲する。
//   getFontSource(): 'google' | 'system'
//   setFontSource(source): void — 呼び出し側の状態を更新する（一覧の再取得はモーダル側が行う）
//   getFontFamily(): string — 現在選択中のフォントファミリー名
//   setFontFamily(family): void — フォントを読み込んでeditorへ適用する（非同期で構わない）
//   getFontFamilyOptions(source): string[] | Promise<string[]> — 指定ソースのフォント一覧

import { t } from './i18n.js';

const LIGHT_LABEL_KEYS = { ambient: 'layout.text3dLightAmbient', key: 'layout.text3dLightKey', fill: 'layout.text3dLightFill' };

export function openText3DSettingsModal(editor, cvsWrapper, options = {}) {
    if (!editor || document.getElementById('text3d-settings-modal')) return;
    const { onClose, fontControls } = options;

    // モーダル背後のテキスト入力/フォント選択にフォーカスが残ったままだと、オーバーレイの
    // クリック遮断をすり抜けてキー操作（矢印キーでのフォント切替など）が背後へ届いてしまう。
    // モーダルへフォーカスを移す前に明示的にblurしておく。
    document.activeElement?.blur();

    // ---- cvsWrapperの元のDOM位置・スタイルを保存（cleanupで復元する） ----
    const hasWrapper = !!cvsWrapper;
    const origParent      = hasWrapper ? cvsWrapper.parentNode : null;
    const origNextSibling  = hasWrapper ? cvsWrapper.nextSibling : null;
    const origTransform    = hasWrapper ? cvsWrapper.style.transform : '';
    const origTransformOrigin = hasWrapper ? cvsWrapper.style.transformOrigin : '';
    const origPosition     = hasWrapper ? cvsWrapper.style.position : '';
    const origTop          = hasWrapper ? cvsWrapper.style.top : '';
    const origLeft         = hasWrapper ? cvsWrapper.style.left : '';
    const origOpacity      = hasWrapper ? cvsWrapper.style.opacity : '';
    const origPointerEvents = hasWrapper ? cvsWrapper.style.pointerEvents : '';

    const overlay = el('div', {
        id: 'text3d-settings-modal',
        style: 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:99999;' +
               'display:flex;align-items:center;justify-content:center;',
    });
    overlay.tabIndex = -1;
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') cleanup(); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });

    let resizeObserver = null;

    // モーダルを開いている間に呼び出し元の状態が変化し、cvsWrapperの元の親要素が
    // 既にDOMから失われている（origParentがnull、または文書に属さなくなっている）ケースが
    // あり得る。この場合でも必ずモーダルを閉じられるよう、復元処理の失敗では絶対に例外を
    //投げない（閉じるボタンが機能しなくなる不具合の再発防止）。
    function cleanup() {
        if (hasWrapper) {
            try {
                cvsWrapper.style.transform       = origTransform;
                cvsWrapper.style.transformOrigin = origTransformOrigin;
                cvsWrapper.style.position        = origPosition;
                cvsWrapper.style.top             = origTop;
                cvsWrapper.style.left            = origLeft;
                cvsWrapper.style.opacity         = origOpacity;
                cvsWrapper.style.pointerEvents   = origPointerEvents;
                if (origParent && origParent.isConnected) {
                    if (origNextSibling && origNextSibling.parentNode === origParent) {
                        origParent.insertBefore(cvsWrapper, origNextSibling);
                    } else {
                        origParent.appendChild(cvsWrapper);
                    }
                } else if (!cvsWrapper.isConnected) {
                    // 元の親が失われている場合、最低限どこかに繋ぎ戻して迷子にしない
                    document.body.appendChild(cvsWrapper);
                }
                // applyScale()でプレビュー拡大用に引き上げた解像度を、元の表示サイズに合わせて戻す。
                // DOM復帰直後はレイアウト未確定のためrAFで1フレーム待ってから実寸を測る。
                if (typeof editor.resizeRenderer === 'function') {
                    requestAnimationFrame(() => {
                        const w = cvsWrapper.clientWidth;
                        const h = cvsWrapper.clientHeight;
                        if (w > 0 && h > 0) {
                            const dpr = window.devicePixelRatio || 1;
                            editor.resizeRenderer(Math.round(w * dpr), Math.round(h * dpr));
                        }
                    });
                }
            } catch (err) {
                console.warn('[text3d-settings-modal] プレビューの復元に失敗しました:', err);
            }
        }
        resizeObserver?.disconnect();
        overlay.remove();
        onClose?.();
    }

    const dialog = el('div', {
        style: 'background:#1e1e2e;color:#ccc;border-radius:10px;' +
               'width:min(94vw,1000px);height:min(90vh,600px);display:flex;flex-direction:column;' +
               'box-shadow:0 8px 40px rgba(0,0,0,0.85);font-family:sans-serif;overflow:hidden;',
    });

    const header = el('div', {
        style: 'display:flex;align-items:center;gap:8px;padding:10px 14px;' +
               'background:#16213e;border-bottom:1px solid #333;flex-shrink:0;',
    });
    header.append(
        // ユーザー指定によりロゴ的な固定名称とし、多言語化しない（3Dポーズの"RC"表記と同じ扱い）
        el('span', { style: 'font-size:14px;font-weight:bold;color:#e0e0ff;flex:1;' }, '3D Text Editor'),
        mkCloseBtn(cleanup),
    );

    const bodyRow = el('div', { style: 'flex:1;display:flex;overflow:hidden;min-height:0;' });

    // ================================================================
    // 左: ライト/マテリアル/カメラ タブ切替パネル
    // ================================================================
    const leftPanel = el('div', {
        style: 'width:260px;flex-shrink:0;display:flex;flex-direction:column;min-height:0;' +
               'border-right:1px solid #2a2a4a;',
    });
    const tabBar = el('div', { style: 'display:flex;flex-shrink:0;border-bottom:1px solid #2a2a4a;' });
    const tabScroll = el('div', { style: 'flex:1;overflow-y:auto;padding:12px 14px;min-height:0;' });
    leftPanel.append(tabBar, tabScroll);

    const lightContent = el('div', {});
    const materialContent = el('div', {});
    const cameraContent = el('div', {});
    tabScroll.append(lightContent, materialContent, cameraContent);

    const TABS = [
        { id: 'light', label: t('layout.text3dLightSection'), content: lightContent },
        { id: 'material', label: t('layout.text3dMaterialSection'), content: materialContent },
        { id: 'camera', label: t('layout.text3dCameraSection'), content: cameraContent },
    ];
    const tabButtons = {};
    let activeTabId = 'light';

    function showTab(tabId) {
        activeTabId = tabId;
        TABS.forEach((tab) => {
            const isActive = tab.id === tabId;
            tab.content.style.display = isActive ? 'block' : 'none';
            const btn = tabButtons[tab.id];
            btn.style.background = isActive ? '#26314f' : 'transparent';
            btn.style.color = isActive ? '#e0e0ff' : '#8892a6';
            btn.style.borderBottomColor = isActive ? '#4a90d9' : 'transparent';
        });
    }

    TABS.forEach((tab) => {
        const btn = el('button', {
            style: 'flex:1;padding:9px 4px;background:transparent;color:#8892a6;border:none;' +
                   'border-bottom:2px solid transparent;cursor:pointer;font-size:11px;font-weight:bold;',
        }, tab.label);
        btn.onclick = () => showTab(tab.id);
        tabButtons[tab.id] = btn;
        tabBar.appendChild(btn);
    });

    // ---- ライト（Ambient/Key/Fillの3灯固定） ----
    editor.getLights().forEach((cfg) => {
        lightContent.appendChild(el('div', {
            style: 'font-size:11px;font-weight:bold;color:#7a9aaa;margin:0 0 4px;',
        }, t(LIGHT_LABEL_KEYS[cfg.id] ?? cfg.id)));

        lightContent.appendChild(row(t('layout.text3dColorLabel'), mkColorInput(cfg.color, (v) => editor.setLightColor(cfg.id, v))));
        const [iSl, iVl] = mkSl(0, 3, 0.05, cfg.intensity, (v) => editor.setLightIntensity(cfg.id, v));
        lightContent.appendChild(rowWithValue(t('layout.text3dLightIntensityLabel'), iSl, iVl));

        if (cfg.position) {
            const pos = { ...cfg.position };
            const posLabelKeys = { x: 'layout.text3dLightPosXLabel', y: 'layout.text3dLightPosYLabel', z: 'layout.text3dLightPosZLabel' };
            ['x', 'y', 'z'].forEach((axis) => {
                const [sl, vl] = mkSl(-10, 10, 0.1, pos[axis], (v) => {
                    pos[axis] = v;
                    editor.setLightPosition(cfg.id, pos.x, pos.y, pos.z);
                });
                lightContent.appendChild(rowWithValue(t(posLabelKeys[axis]), sl, vl));
            });
        }
        lightContent.appendChild(el('div', { style: 'height:8px;' }));
    });

    // ---- マテリアル + 面取り詳細 ----
    const materialSection = el('div', {});
    materialContent.appendChild(materialSection);

    function renderMaterial() {
        materialSection.innerHTML = '';
        const p = editor.getParams();

        const matRow = el('div', { style: 'display:flex;gap:6px;margin-bottom:8px;' });
        const stdBtn = mkToggleBtn(t('layout.text3dMaterialStandard'), p.materialType !== 'toon');
        const toonBtn = mkToggleBtn(t('layout.text3dMaterialToon'), p.materialType === 'toon');
        stdBtn.style.flex = '1';
        toonBtn.style.flex = '1';
        stdBtn.onclick = () => { editor.setMaterialType('standard'); renderMaterial(); };
        toonBtn.onclick = () => { editor.setMaterialType('toon'); renderMaterial(); };
        matRow.append(stdBtn, toonBtn);
        materialSection.appendChild(matRow);

        // 表面/側面カラー（ExtrudeGeometryの自動マテリアルグループ[0]=表裏キャップ, [1]=側面に対応）
        materialSection.appendChild(row(t('layout.text3dFrontColorLabel'), mkColorInput(p.frontColor, (v) => editor.setFrontColor(v))));

        const sepRow = el('div', { style: 'display:flex;align-items:center;gap:6px;margin-bottom:6px;' });
        const sepCheckbox = el('input', { type: 'checkbox', style: 'cursor:pointer;' });
        sepCheckbox.checked = !!p.separateSides;
        sepCheckbox.addEventListener('change', () => { editor.setSeparateSides(sepCheckbox.checked); renderMaterial(); });
        sepRow.append(sepCheckbox, el('label', { style: 'font-size:11px;color:#888;cursor:pointer;' }, t('layout.text3dSeparateSidesLabel')));
        materialSection.appendChild(sepRow);

        const sideColorInput = mkColorInput(p.sideColor, (v) => editor.setSideColor(v));
        if (!p.separateSides) { sideColorInput.disabled = true; sideColorInput.style.opacity = '0.4'; }
        materialSection.appendChild(row(t('layout.text3dSideColorLabel'), sideColorInput));

        if (p.materialType === 'toon') {
            materialSection.appendChild(row(t('layout.text3dShadeColorLabel'), mkColorInput(p.shadeColor, (v) => editor.setShadeColor(v))));
            const [tSl, tVl] = mkSl(0, 1, 0.05, p.toony, (v) => editor.setToony(v));
            materialSection.appendChild(rowWithValue(t('layout.text3dToonyLabel'), tSl, tVl));
        } else {
            const [mSl, mVl] = mkSl(0, 1, 0.05, p.metalness, (v) => editor.setMetalness(v));
            materialSection.appendChild(rowWithValue(t('layout.text3dMetalnessLabel'), mSl, mVl));
            const [rSl, rVl] = mkSl(0, 1, 0.05, p.roughness, (v) => editor.setRoughness(v));
            materialSection.appendChild(rowWithValue(t('layout.text3dRoughnessLabel'), rSl, rVl));
        }
    }
    renderMaterial();

    materialContent.appendChild(sectionTitle(t('layout.text3dBevelSection')));
    const bevelSection = el('div', {});
    materialContent.appendChild(bevelSection);

    function renderBevel() {
        bevelSection.innerHTML = '';
        const p = editor.getParams();
        const [thSl, thVl] = mkSl(0, 0.1, 0.005, p.bevelThickness, (v) => editor.setBevelThickness(v));
        bevelSection.appendChild(rowWithValue(t('layout.text3dBevelThicknessLabel'), thSl, thVl));
        const [szSl, szVl] = mkSl(0, 0.1, 0.005, p.bevelSize, (v) => editor.setBevelSize(v));
        bevelSection.appendChild(rowWithValue(t('layout.text3dBevelSizeLabel'), szSl, szVl));
        const [sgSl, sgVl] = mkSl(1, 8, 1, p.bevelSegments, (v) => editor.setBevelSegments(v));
        bevelSection.appendChild(rowWithValue(t('layout.text3dBevelSegmentsLabel'), sgSl, sgVl));
    }
    renderBevel();

    // ---- カメラ（カメラリセット・ズーム操作モード[3Dポーズ側の設定と共通]） ----
    if (typeof editor.resetCamera === 'function') {
        const rcBtn = mkToggleBtn('RC', false); // 3Dポーズの表記に合わせ、翻訳せず"RC"固定
        rcBtn.title = t('layout.text3dResetCameraTitle');
        rcBtn.style.width = '100%';
        rcBtn.style.marginBottom = '8px';
        rcBtn.onclick = () => editor.resetCamera();
        cameraContent.appendChild(rcBtn);
    }

    const zoomLabel = t('layout.text3dZoomModeBtn');
    const zoomBtn = mkToggleBtn(zoomLabel, editor.getZoomMode() === 'ctrlDrag');
    zoomBtn.title = t('layout.text3dZoomModeBtnTitle');
    zoomBtn.style.width = '100%';
    zoomBtn.style.marginBottom = '8px';
    zoomBtn.onclick = () => {
        const next = editor.getZoomMode() === 'wheel' ? 'ctrlDrag' : 'wheel';
        editor.setZoomMode(next);
        applyToggle(zoomBtn, zoomLabel, next === 'ctrlDrag');
    };
    cameraContent.appendChild(zoomBtn);

    if (typeof editor.getSuperSample === 'function') {
        const aaLabel = t('layout.text3dAntialiasBtn');
        const aaBtn = mkToggleBtn(aaLabel, editor.getSuperSample());
        aaBtn.title = t('layout.text3dAntialiasBtnTitle');
        aaBtn.style.width = '100%';
        aaBtn.onclick = () => {
            const next = !editor.getSuperSample();
            editor.setSuperSample(next);
            applyToggle(aaBtn, aaLabel, next);
        };
        cameraContent.appendChild(aaBtn);
    }

    showTab('light');

    // ================================================================
    // 中央: プレビュー（実描画中のcanvasを埋め込む）
    // ================================================================
    const previewPanel = el('div', {
        style: 'flex:1;display:flex;flex-direction:column;background:#111118;' +
               'border-right:1px solid #2a2a4a;min-width:0;',
    });
    const previewHeader = el('div', {
        style: 'font-size:10px;color:#556;padding:5px 10px;flex-shrink:0;' +
               'border-bottom:1px solid #1a1a2a;background:#13131e;',
    }, t('layout.text3dPreviewHint'));
    const previewWrap = el('div', {
        style: 'flex:1;display:flex;align-items:center;justify-content:center;' +
               'overflow:hidden;min-height:0;padding:4px;',
    });
    previewPanel.append(previewHeader, previewWrap);

    // ================================================================
    // 右: テキスト設定（テキスト内容・フォント・整列・行間。タブ化せず常時表示）
    // ================================================================
    const textPanel = el('div', { style: 'width:280px;flex-shrink:0;overflow-y:auto;padding:12px 14px;' });
    textPanel.appendChild(sectionTitle(t('layout.text3dTextSection')));

    const initialParams = editor.getParams();

    // ---- テキスト内容（5行表示+スクロール） ----
    const textarea = el('textarea', {
        rows: '5',
        style: 'width:100%;box-sizing:border-box;resize:vertical;font-size:12px;font-family:sans-serif;' +
               'background:#13131e;color:#ddd;border:1px solid #2a2a4a;border-radius:4px;' +
               'padding:6px;margin-bottom:10px;min-height:80px;',
    });
    textarea.placeholder = t('layout.text3dTextPlaceholder');
    textarea.value = initialParams.text || '';
    textarea.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    let textDebounceTimer = null;
    textarea.addEventListener('input', () => {
        clearTimeout(textDebounceTimer);
        textDebounceTimer = setTimeout(() => editor.setText(textarea.value), 200);
    });
    textPanel.appendChild(textarea);

    // ---- フォント（呼び出し側からfontControlsが渡された場合のみ表示） ----
    if (fontControls) {
        textPanel.appendChild(sectionTitle(t('layout.text3dFontSection')));

        const srcRow = el('div', { style: 'display:flex;gap:6px;margin-bottom:8px;' });
        const googleLabel = t('layout.text3dFontSourceGoogle');
        const systemLabel = t('layout.text3dFontSourceSystem');
        const googleBtn = mkToggleBtn(googleLabel, fontControls.getFontSource() !== 'system');
        const systemBtn = mkToggleBtn(systemLabel, fontControls.getFontSource() === 'system');
        googleBtn.style.flex = '1';
        systemBtn.style.flex = '1';
        srcRow.append(googleBtn, systemBtn);
        textPanel.appendChild(srcRow);

        const familySelect = el('select', {
            style: 'width:100%;box-sizing:border-box;font-size:12px;margin-bottom:10px;' +
                   'background:#13131e;color:#ddd;border:1px solid #2a2a4a;border-radius:4px;padding:5px;',
        });
        textPanel.appendChild(familySelect);

        async function refreshFamilyOptions(source) {
            const opts = (await fontControls.getFontFamilyOptions(source)) || [];
            const current = fontControls.getFontFamily();
            const list = opts.length ? opts : [current].filter(Boolean);
            familySelect.innerHTML = '';
            list.forEach((f) => familySelect.appendChild(el('option', { value: f }, f)));
            if (list.includes(current)) {
                familySelect.value = current;
            } else if (list.length) {
                familySelect.value = list[0];
                fontControls.setFontFamily(list[0]);
            }
        }

        const setSourceActive = (source) => {
            applyToggle(googleBtn, googleLabel, source !== 'system');
            applyToggle(systemBtn, systemLabel, source === 'system');
        };
        googleBtn.onclick = () => { fontControls.setFontSource('google'); setSourceActive('google'); refreshFamilyOptions('google'); };
        systemBtn.onclick = () => { fontControls.setFontSource('system'); setSourceActive('system'); refreshFamilyOptions('system'); };
        familySelect.addEventListener('change', () => fontControls.setFontFamily(familySelect.value));

        refreshFamilyOptions(fontControls.getFontSource());
    }

    // ---- 整列 ----
    textPanel.appendChild(sectionTitle(t('layout.text3dAlignSection')));
    const alignRow = el('div', { style: 'display:flex;gap:6px;margin-bottom:10px;' });
    const alignBtns = {
        left: mkToggleBtn(t('layout.text3dAlignLeft'), initialParams.align === 'left'),
        center: mkToggleBtn(t('layout.text3dAlignCenter'), !initialParams.align || initialParams.align === 'center'),
        right: mkToggleBtn(t('layout.text3dAlignRight'), initialParams.align === 'right'),
    };
    Object.entries(alignBtns).forEach(([id, btn]) => {
        btn.style.flex = '1';
        btn.onclick = () => {
            editor.setAlign(id);
            Object.entries(alignBtns).forEach(([bid, b]) => { b.style.background = bid === id ? '#3a6a1a' : '#333344'; });
        };
        alignRow.appendChild(btn);
    });
    textPanel.appendChild(alignRow);

    // ---- 行間 ----
    const [lhSl, lhVl] = mkSl(1.0, 3.0, 0.05, initialParams.lineHeight ?? 1.4, (v) => editor.setLineHeight(v));
    textPanel.appendChild(rowWithValue(t('layout.text3dLineHeightLabel'), lhSl, lhVl));

    bodyRow.append(leftPanel, previewPanel, textPanel);
    dialog.append(header, bodyRow);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    overlay.focus();

    // ---- cvsWrapperをプレビュー枠へ埋め込む ----
    if (hasWrapper) {
        previewWrap.appendChild(cvsWrapper);
        cvsWrapper.style.position = 'relative'; // 呼び出し元のposition:absoluteを解除
        cvsWrapper.style.top  = '0';
        cvsWrapper.style.left = '0';
        // キャンセル後など非表示(opacity:0)状態のwrapperでも、モーダル内では強制的に見えるようにする
        cvsWrapper.style.opacity = '1';
        cvsWrapper.style.pointerEvents = 'auto';

        function applyScale() {
            const pw = previewWrap.clientWidth  - 8;
            const ph = previewWrap.clientHeight - 8;
            if (pw <= 0 || ph <= 0) return;
            const cw = cvsWrapper.offsetWidth;
            const ch = cvsWrapper.offsetHeight;
            if (cw <= 0 || ch <= 0) return;
            const scale = Math.min(pw / cw, ph / ch);
            cvsWrapper.style.transform       = `scale(${scale.toFixed(4)})`;
            cvsWrapper.style.transformOrigin = 'center center';

            // CSS transform:scale()で元サイズより拡大表示すると、レンダラーの実解像度が
            // 足りずラスターが荒く見える（ユーザー指摘）。拡大後の実表示サイズに合わせて
            // レンダラー側の解像度も引き上げる（縮小表示時は元解像度のままで十分なため何もしない）。
            if (scale > 1 && typeof editor.resizeRenderer === 'function') {
                const dpr = window.devicePixelRatio || 1;
                editor.resizeRenderer(Math.round(cw * scale * dpr), Math.round(ch * scale * dpr));
            }
        }
        requestAnimationFrame(() => {
            applyScale();
            resizeObserver = new ResizeObserver(applyScale);
            resizeObserver.observe(previewWrap);
        });
    } else {
        previewWrap.appendChild(el('div', { style: 'color:#555;font-size:12px;' }, t('layout.text3dPreviewUnavailable')));
    }
}

// ----------------------------------------------------------------
// UI helpers（light_editor.jsの同名ヘルパーを踏襲した最小実装）
// ----------------------------------------------------------------
function el(tag, attrs = {}, text) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'style') e.style.cssText = v;
        else e.setAttribute(k, v);
    }
    if (text !== undefined) e.textContent = text;
    return e;
}

function mkCloseBtn(fn) {
    const b = el('button', { style: 'background:none;border:none;color:#aaa;font-size:16px;cursor:pointer;padding:4px 8px;' }, '✕');
    b.onclick = fn;
    return b;
}

function mkToggleBtn(label, isOn) {
    return el('button', {
        style: 'padding:5px 11px;background:' + (isOn ? '#3a6a1a' : '#333344') + ';color:#fff;border:none;' +
               'border-radius:4px;cursor:pointer;font-size:11px;font-weight:bold;white-space:nowrap;',
    }, label);
}

function applyToggle(btn, label, v) {
    btn.style.background = v ? '#3a6a1a' : '#333344';
    btn.textContent = label;
}

function sectionTitle(label) {
    return el('div', {
        style: 'font-size:11px;font-weight:bold;color:#6a8a9a;margin:12px 0 6px;' +
               'border-bottom:1px solid #2a2a4a;padding-bottom:3px;letter-spacing:.4px;',
    }, label.toUpperCase());
}

function row(label, ctrl) {
    const r = el('div', { style: 'display:flex;align-items:center;gap:6px;margin-bottom:6px;' });
    r.append(el('label', { style: 'font-size:11px;color:#888;width:64px;flex-shrink:0;text-align:right;' }, label), ctrl);
    return r;
}

function rowWithValue(label, sl, vl) {
    const r = row(label, sl);
    r.appendChild(vl);
    return r;
}

function mkColorInput(value, onChange) {
    const inp = el('input', {
        type: 'color', value,
        style: 'width:32px;height:24px;border:none;cursor:pointer;background:none;padding:0;flex-shrink:0;',
    });
    inp.addEventListener('input', () => onChange(inp.value));
    return inp;
}

function mkSl(min, max, step, value, onChange) {
    const dec = step < 0.1 ? 2 : 1;
    const sl = document.createElement('input');
    sl.type = 'range'; sl.min = min; sl.max = max; sl.step = step; sl.value = value;
    sl.style.cssText = 'flex:1;height:14px;accent-color:#4a90d9;cursor:pointer;min-width:60px;';
    sl.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });

    const vl = el('span', { style: 'font-size:11px;color:#aaa;width:38px;text-align:right;flex-shrink:0;' }, parseFloat(value).toFixed(dec));
    sl.addEventListener('input', () => {
        const v = parseFloat(sl.value);
        vl.textContent = v.toFixed(dec);
        onChange(v);
    });
    return [sl, vl];
}
