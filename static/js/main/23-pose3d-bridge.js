// ============================================================
// main.js 分割ファイル (24/24): 3Dポーズエディタ
// 元 main.js の行 17767-18313 に相当
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: _arrayBufferToBase64,_base64ToArrayBuffer,_pose3dRebuildMorphSliders,_pose3dSyncPosition,commitPose3D,hidePose3DCanvas,initPose3DTab,showPose3DCanvas
// ============================================================

// ============================================================
// 3D ポーズエディタ（方針B: canvasオーバーレイ + 確定時画像化）
// ============================================================

function initPose3DTab() {
    const placeBtn      = document.getElementById('pose3d-place-btn');
    const commitBtn     = document.getElementById('pose3d-commit-btn');
    const cancelBtn     = document.getElementById('pose3d-cancel-btn');
    const refreshBtn    = document.getElementById('pose3d-refresh-btn');
    const statusEl    = document.getElementById('pose3d-status');
    const vrmInput    = document.getElementById('pose3d-vrm-input');
    const vrmLabel    = document.getElementById('pose3d-vrm-label');
    const poseInput   = document.getElementById('pose3d-pose-input');
    const savePoseBtn = document.getElementById('pose3d-save-pose-btn');
    const saveToPosesBtn = document.getElementById('pose3d-save-to-poses-btn');
    const libraryBtn  = document.getElementById('pose3d-library-btn');
    const lightBtn    = document.getElementById('pose3d-light-btn');
    const mirrorBtn   = document.getElementById('pose3d-mirror-btn');
    const ccBtn       = document.getElementById('pose3d-cc-btn');
    const resetPBtn   = document.getElementById('pose3d-reset-pose-btn');
    const resetCBtn   = document.getElementById('pose3d-reset-camera-btn');
    const camModeBtn  = document.getElementById('pose3d-cam-mode-btn');
    const ptSlider    = document.getElementById('pose3d-point-size');
    const ptVal       = document.getElementById('pose3d-point-size-val');

    if (!placeBtn) return; // HTMLが存在しない場合はスキップ

    // コマに配置
    placeBtn.addEventListener('click', () => {
        const panelId = state.selectedPanelId;
        if (!panelId && !state.selectedOverlay) {
            if (statusEl) statusEl.textContent = t('layout.pose3dSelectPanelFirst');
            return;
        }
        if (state.selectedOverlay) {
            if (statusEl) statusEl.textContent = t('layout.pose3dCannotPlaceOnOverlay');
            return;
        }
        showPose3DCanvas(panelId);
    });

    // コマに確定
    commitBtn.addEventListener('click', () => commitPose3D());

    // 再描画（DOMから切り離された場合の再追加 + レイアウト再同期）
    if (refreshBtn) refreshBtn.addEventListener('click', () => {
        const pid = state.pose3d.activePanelId;
        if (!pid || !state.pose3d.editor) return;
        const previewContainer = document.getElementById('layout-preview');
        if (!previewContainer) return;
        if (!previewContainer.contains(state.pose3d.wrapper)) {
            previewContainer.appendChild(state.pose3d.wrapper);
        }
        const p  = state.activePage?.panels.find(pp => pp.id === pid);
        const sv = document.querySelector('#layout-preview #image-layer svg');
        if (p && sv) _pose3dSyncPosition(p, sv);
    });

    // キャンセル
    cancelBtn.addEventListener('click', () => {
        hidePose3DCanvas();
        if (statusEl) statusEl.textContent = '';
    });

    // モデル読込
    vrmInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 50 * 1024 * 1024) {
            alert(t('layout.pose3dFileTooLarge', (file.size / 1024 / 1024).toFixed(1)));
            vrmInput.value = '';
            return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
            const buffer = ev.target.result;
            state.pose3d.modelBuffer = buffer;
            state.pose3d.modelIsDefault = false;
            if (vrmLabel) vrmLabel.textContent = file.name.slice(0, 20) + (file.name.length > 20 ? '…' : '');
            const editor = state.pose3d.editor;
            if (!editor) return;
            const url = URL.createObjectURL(new Blob([buffer]));
            editor.loadVRMFromBuffer(buffer, url, () => {
                URL.revokeObjectURL(url);
                // ロード完了後にrendererサイズを強制再同期（初回表示でモデルが見えない問題対策）
                const cvs = state.pose3d.canvas;
                if (cvs.width > 0 && cvs.height > 0) {
                    editor.resizeRenderer(cvs.width, cvs.height);
                }
            });
        };
        reader.readAsArrayBuffer(file);
        vrmInput.value = '';
    });

    // ポーズ読込
    poseInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const editor = state.pose3d.editor;
                if (editor) editor.importPose(ev.target.result);
            } catch (err) {
                alert(t('layout.pose3dPoseLoadFailed', err.message));
            }
        };
        reader.readAsText(file);
        poseInput.value = '';
    });

    // ポーズ保存
    savePoseBtn.addEventListener('click', () => {
        const editor = state.pose3d.editor;
        if (!editor) return;
        const json = editor.exportPose();
        if (!json) { alert(t('layout.pose3dModelNotLoaded')); return; }
        const blob = new Blob([json], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'pose.json';
        a.click();
        URL.revokeObjectURL(a.href);
    });

    // poses/ へ保存（comfyui-vrm-pose-editor のポーズライブラリと共有フォルダ）
    if (saveToPosesBtn) saveToPosesBtn.addEventListener('click', async () => {
        const editor = state.pose3d.editor;
        if (!editor) { alert(t('layout.pose3dModelNotLoaded')); return; }
        const json = editor.exportPose();
        if (!json) { alert(t('layout.pose3dModelNotLoaded')); return; }
        try {
            const res = await fetch('/pose_library/save_pose', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ json }),
            });
            const data = await res.json();
            if (statusEl) statusEl.textContent = data.ok ? t('layout.pose3dSavedToPoses', data.name) : (data.error || t('layout.pose3dSaveFailed'));
        } catch (err) {
            if (statusEl) statusEl.textContent = t('layout.pose3dSaveFailedWithMsg', err.message);
        }
    });

    // ポーズライブラリ（comfyui-vrm-pose-editor 連携）
    if (libraryBtn) libraryBtn.addEventListener('click', () => {
        if (typeof window.openPoseLibrary !== 'function') {
            if (statusEl) statusEl.textContent = t('layout.pose3dEditorNotFound');
            return;
        }
        const editor = state.pose3d.editor;
        if (!editor) { alert(t('layout.pose3dModelNotLoaded')); return; }
        window.openPoseLibrary(editor, state.pose3d.modelBuffer);
    });

    // ライトエディタ（comfyui-vrm-pose-editor 連携）
    if (lightBtn) lightBtn.addEventListener('click', () => {
        if (typeof window.openLightEditor !== 'function') {
            if (statusEl) statusEl.textContent = t('layout.pose3dEditorNotFound');
            return;
        }
        const editor = state.pose3d.editor;
        if (!editor) { alert(t('layout.pose3dModelNotLoaded')); return; }
        window.openLightEditor(editor, state.pose3d.wrapper);
    });

    // ミラー（左右反転）
    if (mirrorBtn) mirrorBtn.addEventListener('click', () => {
        if (state.pose3d.editor) state.pose3d.editor.mirrorPose();
    });

    // カラー補正トグル
    ccBtn.addEventListener('click', () => {
        state.pose3d.ccOn = !state.pose3d.ccOn;
        ccBtn.textContent = `CC: ${state.pose3d.ccOn ? 'ON' : 'OFF'}`;
        ccBtn.style.background = state.pose3d.ccOn ? 'var(--accent-primary, #0066cc)' : '';
        const editor = state.pose3d.editor;
        if (editor) editor.setColorCorrect(state.pose3d.ccOn);
    });

    // ポーズリセット
    resetPBtn.addEventListener('click', () => {
        if (state.pose3d.editor) state.pose3d.editor.resetPose();
    });

    // カメラリセット
    resetCBtn.addEventListener('click', () => {
        if (state.pose3d.editor) state.pose3d.editor.resetCamera();
    });

    // カメラモード切替（透視投影 ↔ 平行投影）
    if (camModeBtn) {
        camModeBtn.addEventListener('click', () => {
            const toOrtho = camModeBtn.dataset.mode !== 'ortho';
            if (state.pose3d.editor) state.pose3d.editor.switchCamera(toOrtho);
            camModeBtn.dataset.mode     = toOrtho ? 'ortho' : 'persp';
            camModeBtn.textContent      = toOrtho ? 'PR' : 'OT';
            camModeBtn.style.background = toOrtho ? '#4a7aaa' : '';
            camModeBtn.title            = toOrtho
                ? t('layout.pose3dCamModeTitleOrtho')
                : t('layout.pose3dCamModeTitle');
        });
    }

    // 点サイズスライダー
    if (ptSlider) {
        ptSlider.addEventListener('input', () => {
            const v = parseFloat(ptSlider.value);
            if (ptVal) ptVal.textContent = v.toFixed(1);
            if (state.pose3d.editor) state.pose3d.editor.setPointSize(v);
        });
    }
}

// コマ上に Three.js canvas をオーバーレイ表示する
function showPose3DCanvas(panelId) {
    if (!panelId || !state.activePage) return;

    const panel = state.activePage.panels.find(p => p.id === panelId);
    if (!panel) return;

    const previewContainer = document.getElementById('layout-preview');
    const svgEl = document.querySelector('#layout-preview #image-layer svg');
    if (!previewContainer || !svgEl) {
        const statusEl = document.getElementById('pose3d-status');
        if (statusEl) statusEl.textContent = t('layout.pose3dSelectPanelInLayout');
        return;
    }

    // layout-preview を基準に絶対配置（スクロール・max-height制約を超えて正確に配置）
    previewContainer.style.position = 'relative';

    // ---- ラッパーとcanvasを作成（初回のみ） ----
    if (!state.pose3d.wrapper) {
        const wrapper = document.createElement('div');
        wrapper.id = 'pose3d-wrapper';
        wrapper.style.cssText =
            'position:absolute; z-index:150; overflow:hidden; opacity:0; pointer-events:none; ' +
            'border:2px solid #e04040; box-sizing:border-box; cursor:default;';

        const cvs = document.createElement('canvas');
        cvs.id = 'pose3d-canvas';
        cvs.style.cssText = 'position:absolute; top:0; left:0;';

        const gizmoCvs = document.createElement('canvas');
        gizmoCvs.id = 'pose3d-gizmo';
        const GIZMO = 80;
        gizmoCvs.width = GIZMO; gizmoCvs.height = GIZMO;
        gizmoCvs.style.cssText =
            `position:absolute; top:6px; right:6px; width:${GIZMO}px; height:${GIZMO}px; ` +
            'border-radius:50%; background:rgba(40,40,40,0.5); pointer-events:auto;';

        wrapper.appendChild(cvs);
        wrapper.appendChild(gizmoCvs);

        state.pose3d.wrapper = wrapper;
        state.pose3d.canvas = cvs;
        state.pose3d.gizmoCanvas = gizmoCvs;
    }

    // レイアウト再描画でDOMから切り離される場合があるため毎回再追加
    if (!previewContainer.contains(state.pose3d.wrapper)) {
        previewContainer.appendChild(state.pose3d.wrapper);
    }

    // ---- 表示位置をコマのbboxに合わせる（opacity方式: clientWidth/Heightが0にならない） ----
    state.pose3d.wrapper.style.opacity = '1';
    state.pose3d.wrapper.style.pointerEvents = 'auto';
    void previewContainer.getBoundingClientRect(); // レイアウト強制再計算
    state.pose3d.activePanelId = panelId;
    _pose3dSyncPosition(panel, svgEl);
    // opacity切替後にブラウザがcanvasのレイアウトを確定するまで2フレーム待って再同期
    requestAnimationFrame(() => requestAnimationFrame(() => {
        const p  = state.activePage?.panels.find(pp => pp.id === panelId);
        const sv = document.querySelector('#layout-preview #image-layer svg');
        if (p && sv) {
            _pose3dSyncPosition(p, sv);
            // clientWidthが確定した後にrendererサイズを強制同期
            const cvs = state.pose3d.canvas;
            if (state.pose3d.editor && cvs.clientWidth > 0) {
                state.pose3d.editor.resizeRenderer(cvs.clientWidth, cvs.clientHeight);
            }
        }
    }));

    // ---- エディタ初期化（初回のみ） ----
    if (!state.pose3d.editor) {
        const initFn = window.initPoseEditor3D;
        if (typeof initFn !== 'function') {
            // ESモジュールのロードが間に合っていない場合は少し待ってリトライ
            const statusEl = document.getElementById('pose3d-status');
            if (statusEl) statusEl.textContent = t('common.loading');
            setTimeout(() => showPose3DCanvas(panelId), 300);
            return;
        }
        const morphPanel = document.getElementById('pose3d-morph-panel');
        state.pose3d.editor = initFn(
            state.pose3d.canvas,
            state.pose3d.gizmoCanvas,
            './',
            (keys) => _pose3dRebuildMorphSliders(keys, morphPanel),
            () => {
                // モデルロード完了後にrendererサイズを強制再同期（初回配置時の表示抜け対策）
                const cvs = state.pose3d.canvas;
                if (state.pose3d.editor && cvs.width > 0 && cvs.height > 0) {
                    state.pose3d.editor.resizeRenderer(cvs.width, cvs.height);
                }
            }
        );
        // 初期化直後にカメラアスペクト比をcanvasサイズに合わせる（条件なしで強制適用）
        const cvs = state.pose3d.canvas;
        state.pose3d.editor.resizeRenderer(
            cvs.width  || 600,
            cvs.height || 600
        );
        // コマ配置前にモデル読込済みだった場合は即ロード（editor初期化前に読込ボタンを押した場合の対策）
        if (!state.pose3d.modelIsDefault && state.pose3d.modelBuffer) {
            const buf = state.pose3d.modelBuffer;
            const url = URL.createObjectURL(new Blob([buf]));
            state.pose3d.editor.loadVRMFromBuffer(buf, url, () => {
                URL.revokeObjectURL(url);
                const c = state.pose3d.canvas;
                if (c.width > 0 && c.height > 0) state.pose3d.editor.resizeRenderer(c.width, c.height);
            });
        }
    }

    // ResizeObserver でSVGリサイズに追従
    if (state.pose3d.resizeObserver) state.pose3d.resizeObserver.disconnect();
    state.pose3d.resizeObserver = new ResizeObserver(() => {
        if (state.pose3d.activePanelId) {
            const p = state.activePage?.panels.find(pp => pp.id === state.pose3d.activePanelId);
            const sv = document.querySelector('#layout-preview #image-layer svg');
            if (p && sv) _pose3dSyncPosition(p, sv);
        }
    });
    state.pose3d.resizeObserver.observe(svgEl);
    state.pose3d.resizeObserver.observe(previewContainer);

    // アニメーションループを再起動（hidePose3DCanvas で停止済みの場合）
    // 再表示時は必ずrendererサイズを強制同期してから起動
    if (state.pose3d.editor) {
        const cvs = state.pose3d.canvas;
        if (cvs.width > 0 && cvs.height > 0) {
            state.pose3d.editor.resizeRenderer(cvs.width, cvs.height);
        }
        state.pose3d.editor.startLoop();
    }

    // UIボタン状態更新
    const commitBtn = document.getElementById('pose3d-commit-btn');
    const cancelBtn = document.getElementById('pose3d-cancel-btn');
    if (commitBtn) commitBtn.disabled = false;
    if (cancelBtn) cancelBtn.style.display = '';
    const statusEl = document.getElementById('pose3d-status');
    if (statusEl) statusEl.textContent = t('layout.pose3dViewActiveHint');
}

// コマbboxに合わせてラッパー位置・canvasサイズを更新
function _pose3dSyncPosition(panel, svgEl) {
    const bbox = getBoundingBoxFromPoints(panel.points);
    if (!bbox) return;

    // 基準は #layout-preview（スクロール量を含めた offsetTop/offsetLeft で計算）
    const previewContainer = document.getElementById('layout-preview');
    if (!previewContainer) return;

    // SVG座標 → クライアント座標変換
    const ctm = svgEl.getScreenCTM();
    if (!ctm) {
        // レイアウト未確定の場合は次フレームでリトライ
        requestAnimationFrame(() => {
            const pid = state.pose3d.activePanelId;
            const sv  = document.querySelector('#layout-preview #image-layer svg');
            if (pid && sv) {
                const p = state.activePage?.panels.find(pp => pp.id === pid);
                if (p) _pose3dSyncPosition(p, sv);
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

    // スクロールオフセットを加算して layout-preview 内の相対座標を得る
    const left   = topLeft.x - parentRect.left + previewContainer.scrollLeft;
    const top    = topLeft.y - parentRect.top  + previewContainer.scrollTop;
    const width  = bottomRight.x - topLeft.x;
    const height = bottomRight.y - topLeft.y;

    const wrapper = state.pose3d.wrapper;
    wrapper.style.left   = `${left}px`;
    wrapper.style.top    = `${top}px`;
    wrapper.style.width  = `${width}px`;
    wrapper.style.height = `${height}px`;

    // Three.js renderer のサイズを実ピクセルに合わせる
    const dpr  = window.devicePixelRatio || 1;
    const newW = Math.round(width  * dpr);
    const newH = Math.round(height * dpr);
    const cvs  = state.pose3d.canvas;
    // canvas の CSS 表示サイズを wrapper と同じに明示設定（width:100%は属性変更で壊れるため）
    cvs.style.width  = `${width}px`;
    cvs.style.height = `${height}px`;
    if (cvs.width !== newW || cvs.height !== newH) {
        cvs.width  = newW;
        cvs.height = newH;
        if (state.pose3d.editor) {
            state.pose3d.editor.resizeRenderer(newW, newH);
        }
    }
}

// 3D ビューを非表示にする
function hidePose3DCanvas() {
    if (state.pose3d.editor) state.pose3d.editor.stopLoop();
    if (state.pose3d.wrapper) {
        // opacity:0 で隠す（display:none/visibility:hidden はclientWidth=0になりWebGLが壊れる）
        state.pose3d.wrapper.style.opacity = '0';
        state.pose3d.wrapper.style.pointerEvents = 'none';
    }
    if (state.pose3d.resizeObserver) {
        state.pose3d.resizeObserver.disconnect();
        state.pose3d.resizeObserver = null;
    }
    state.pose3d.activePanelId = null;

    const commitBtn = document.getElementById('pose3d-commit-btn');
    const cancelBtn = document.getElementById('pose3d-cancel-btn');
    if (commitBtn) commitBtn.disabled = true;
    if (cancelBtn) cancelBtn.style.display = 'none';
    const statusEl = document.getElementById('pose3d-status');
    if (statusEl) statusEl.textContent = '';
}

// キャプチャ → insertImage でSVGに焼き込む
async function commitPose3D() {
    const editor   = state.pose3d.editor;
    const panelId  = state.pose3d.activePanelId;
    if (!editor || !panelId) return;

    // ポーズデータ・モデル情報を収集（再編集用）
    const poseJson  = editor.exportPose() ?? '';
    const modelB64  = (!state.pose3d.modelIsDefault && state.pose3d.modelBuffer)
        ? _arrayBufferToBase64(state.pose3d.modelBuffer)
        : '';

    // キャプチャ（ボーン点を非表示にしてレンダリング）
    const dataUrl = editor.capture();

    // canvas の実解像度をサイズとして渡す
    const cvs = state.pose3d.canvas;
    const w = cvs.width  || 600;
    const h = cvs.height || 600;

    // 3D ビューを隠してから選択コマに確定
    hidePose3DCanvas();

    // selectedPanelId を確保
    const prevPanelId = state.selectedPanelId;
    state.selectedPanelId = panelId;

    await insertImage(dataUrl, w, h, {
        'data-pose3d-pose':  poseJson,
        'data-pose3d-model': modelB64,
    });

    state.selectedPanelId = prevPanelId;

    const statusEl = document.getElementById('pose3d-status');
    if (statusEl) statusEl.textContent = t('layout.pose3dCommitted');
}

// シェイプキースライダーを再構築する
function _pose3dRebuildMorphSliders(keys, panelEl) {
    if (!panelEl) return;
    panelEl.innerHTML = '';
    if (keys.length === 0) return;

    const header = document.createElement('details');
    header.style.cssText = 'font-size:11px; margin-top:2px;';
    const summary = document.createElement('summary');
    summary.textContent = t('layout.pose3dShapeKeys', keys.length);
    summary.style.cssText = 'cursor:pointer; color:var(--text-secondary); user-select:none;';
    header.appendChild(summary);

    const body = document.createElement('div');
    body.style.cssText = 'display:flex; flex-direction:column; gap:3px; padding:4px 2px; max-height:140px; overflow-y:auto;';

    for (const { name, getValue, setValue } of keys) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; align-items:center; gap:4px;';

        const label = document.createElement('span');
        label.textContent = name;
        label.title = name;
        label.style.cssText = 'font-size:10px; color:var(--text-secondary); width:90px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex-shrink:0;';

        const slider = document.createElement('input');
        slider.type = 'range'; slider.min = '0'; slider.max = '1'; slider.step = '0.01';
        slider.value = String(getValue());
        slider.style.cssText = 'flex:0 0 25%; height:14px;';

        const val = document.createElement('span');
        val.textContent = Number(getValue()).toFixed(2);
        val.style.cssText = 'font-size:10px; color:var(--text-secondary); width:28px; text-align:right; flex-shrink:0;';

        slider.addEventListener('input', () => {
            const v = parseFloat(slider.value);
            setValue(v);
            val.textContent = v.toFixed(2);
        });
        slider.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });

        row.appendChild(label);
        row.appendChild(slider);
        row.appendChild(val);
        body.appendChild(row);
    }
    header.appendChild(body);
    panelEl.appendChild(header);
}

// ArrayBuffer → Base64 文字列
function _arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

// Base64 文字列 → ArrayBuffer
function _base64ToArrayBuffer(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}
