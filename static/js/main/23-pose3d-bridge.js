// ============================================================
// main.js 分割ファイル (24/24): 3Dポーズエディタ
// 元 main.js の行 17767-18313 に相当
// type="module" として読み込まれる（ESモジュール化 G9）。
// 主なトップレベル定義: _arrayBufferToBase64,_base64ToArrayBuffer,_pose3dCaptureFrameToPanel,_pose3dDefaultModelProvider,_pose3dInsertCaptureIntoPanel,_pose3dOnLightPoseEditorClosed,_pose3dRebuildMorphSliders,_pose3dSyncPosition,commitPose3D,hidePose3DCanvas,initPose3DTab,showPose3DCanvas
// 未ESM化の外部依存（非moduleのグローバル関数はwindowプロパティとして自動的に見えるため、
// 呼び出し箇所は書き換えていない）: state（01-state.js）
// ============================================================

import { t } from '../i18n.js';
import { getBoundingBoxFromPoints, insertImage } from './08-panels-images.js';
import { state } from './01-state.js';

// ============================================================
// 3D ポーズエディタ（方針B: canvasオーバーレイ + 確定時画像化）
// ============================================================

// Light & Pose Editor（openLightPoseEditor）のPoseタブ・シェイプキー一覧に渡すため、
// onMorphKeysReadyで受け取った最新のキー配列をここに保持しておく（node側pose_editor_3d.jsの
// currentMorphKeys と同じパターン）。
let currentMorphKeys = [];

// Light & Pose Editorを閉じた際、モーダル内でWind/LookAt/カメラ/Point Size等の状態が変更された
// 可能性があるため、レイアウトタブ側のツールバー表示を再同期する
// （node側pose_editor_3d.jsのonLightPoseEditorClosedと同じパターン）。
// Light & Pose Editor / Pose Library を開いている間、3Dビューのラッパーはモーダル内のプレビュー枠へ
// 一時的に貸し出されている(DOM移動 + transform: scale)。その間にコマ用の位置・サイズを書き込んだり
// #layout-preview へ戻したりすると、モーダルのプレビューが枠外へずれる・消えるため、貸し出し中かを判定する
function _pose3dIsBorrowed() {
    return !!state.pose3d.wrapper?.closest?.('#light-pose-editor-modal, #pose-library-modal');
}

function _pose3dOnLightPoseEditorClosed({ windBtn, windSourceBtn, ptSlider, ptVal, camModeBtn, lookAtBtn, fovSlider, fovVal, nearSlider, nearVal }) {
    const editor = state.pose3d.editor;
    if (!editor) return;

    if (windBtn) {
        const on = editor.getWindEnabled();
        windBtn.textContent = on ? '🌬 風: ON' : '🌬 風: OFF';
        windBtn.style.background = on ? 'var(--accent-primary, #0066cc)' : '';
    }
    if (windSourceBtn) {
        const on = editor.getWindSourceEnabled();
        windSourceBtn.textContent = on ? '🧭 発生源: ON' : '🧭 発生源: OFF';
        windSourceBtn.style.background = on ? 'var(--accent-primary, #0066cc)' : '';
    }
    if (ptSlider) {
        const v = editor.getPointSize();
        ptSlider.value = String(v);
        if (ptVal) ptVal.textContent = v.toFixed(1);
    }
    if (camModeBtn) {
        const toOrtho = editor.getIsOrtho();
        camModeBtn.dataset.mode     = toOrtho ? 'ortho' : 'persp';
        camModeBtn.textContent      = toOrtho ? 'PR' : 'OT';
        camModeBtn.style.background = toOrtho ? '#4a7aaa' : '';
        camModeBtn.title            = toOrtho
            ? t('layout.pose3dCamModeTitleOrtho')
            : t('layout.pose3dCamModeTitle');
    }
    if (lookAtBtn) {
        const on = editor.getLookAtEnabled();
        lookAtBtn.textContent = on ? '👁 視線: ON' : '👁 視線: OFF';
        lookAtBtn.style.background = on ? 'var(--accent-primary, #0066cc)' : '';
    }
    if (fovSlider) {
        const v = editor.getFov();
        fovSlider.value = String(v);
        if (fovVal) fovVal.textContent = String(v);
    }
    if (nearSlider) {
        const v = editor.getNear();
        nearSlider.value = String(v);
        if (nearVal) nearVal.textContent = v.toFixed(2);
    }

    // モーダルを開いている間はコマへの位置合わせを止めていた(_pose3dIsBorrowed)ため、
    // その間にウィンドウやプレビューのサイズが変わっていても追従するよう、戻ってきた時点で合わせ直す
    requestAnimationFrame(() => {
        const pid = state.pose3d.activePanelId;
        const p   = pid && state.activePage?.panels.find(pp => pp.id === pid);
        const sv  = document.querySelector('#layout-preview #image-layer svg');
        if (p && sv) _pose3dSyncPosition(p, sv);
    });
}

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
    const editorBtn   = document.getElementById('pose3d-editor-btn');
    const lookAtBtn   = document.getElementById('pose3d-lookat-btn');
    const springBoneBtn = document.getElementById('pose3d-springbone-btn');
    const windBtn = document.getElementById('pose3d-wind-btn');
    const windSourceBtn = document.getElementById('pose3d-windsource-btn');
    const mirrorBtn   = document.getElementById('pose3d-mirror-btn');
    const ccBtn       = document.getElementById('pose3d-cc-btn');
    const resetPBtn   = document.getElementById('pose3d-reset-pose-btn');
    const resetCBtn   = document.getElementById('pose3d-reset-camera-btn');
    const camModeBtn  = document.getElementById('pose3d-cam-mode-btn');
    const ptSlider    = document.getElementById('pose3d-point-size');
    const ptVal       = document.getElementById('pose3d-point-size-val');
    const fovSlider   = document.getElementById('pose3d-fov');
    const fovVal      = document.getElementById('pose3d-fov-val');
    const nearSlider  = document.getElementById('pose3d-near');
    const nearVal     = document.getElementById('pose3d-near-val');

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
        if (!pid || !state.pose3d.editor || _pose3dIsBorrowed()) return;
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

    // Light & Pose Editor（comfyui-vrm-pose-editor 連携）。旧「ライト」「ライブラリ」の
    // 2ボタンを1つに統合し、常にPoseタブで開く（ライト設定はモーダル内の💡Lightタブへ
    // 切り替えるだけでよく、VRMAのLoad/Load KEY・キーフレームタイムラインの再生バーで
    // 任意のフレームへシークし、📸 Captureボタン(nodeActions.doCapture経由で
    // _pose3dCaptureFrameToPanelを呼ぶ)でその場でコマへ確定できる）。
    if (editorBtn) editorBtn.addEventListener('click', (e) => {
        // 設定で VRM Pose Studio を選んでいる場合は、選択中のコマの枠を付けて VPS を開く
        if (_pose3dGetEditorEngine() === 'vps') {
            _pose3dOpenVps(e, statusEl);
            return;
        }
        if (typeof window.openLightPoseEditor !== 'function') {
            if (statusEl) statusEl.textContent = t('layout.pose3dEditorNotFound');
            return;
        }
        const editor = state.pose3d.editor;
        if (!editor) { alert(t('layout.pose3dModelNotLoaded')); return; }
        window.openLightPoseEditor(
            editor,
            state.pose3d.wrapper,
            state.pose3d.modelBuffer,
            () => currentMorphKeys,
            () => _pose3dOnLightPoseEditorClosed({
                windBtn, windSourceBtn, ptSlider, ptVal,
                camModeBtn, lookAtBtn, fovSlider, fovVal, nearSlider, nearVal,
            }),
            'pose',
            { doCapture: _pose3dCaptureFrameToPanel }
        );
    });

    // ミラー（左右反転）
    if (mirrorBtn) mirrorBtn.addEventListener('click', () => {
        if (state.pose3d.editor) state.pose3d.editor.mirrorPose();
    });

    // 視線ターゲット(LookAt)トグル
    if (lookAtBtn) lookAtBtn.addEventListener('click', () => {
        const editor = state.pose3d.editor;
        if (!editor) return;
        const on = editor.toggleLookAt();
        lookAtBtn.textContent = on ? '👁 視線: ON' : '👁 視線: OFF';
        lookAtBtn.style.background = on ? 'var(--accent-primary, #0066cc)' : '';
    });

    // 揺れ物理(SpringBone)トグル
    if (springBoneBtn) springBoneBtn.addEventListener('click', () => {
        const editor = state.pose3d.editor;
        if (!editor) return;
        const on = editor.toggleSpringBoneEnabled();
        springBoneBtn.textContent = on ? '🎐 揺れ: ON' : '🎐 揺れ: OFF';
        springBoneBtn.style.background = on ? '' : 'var(--accent-primary, #0066cc)';
    });

    // 風エフェクト(Wind)トグル。強さ・向き・そよぎはライトエディタ内で調整する
    if (windBtn) windBtn.addEventListener('click', () => {
        const editor = state.pose3d.editor;
        if (!editor) return;
        const on = editor.toggleWindEnabled();
        windBtn.textContent = on ? '🌬 風: ON' : '🌬 風: OFF';
        windBtn.style.background = on ? 'var(--accent-primary, #0066cc)' : '';
    });

    // 風の発生源マーカー(視線と同様にドラッグ可能な3Dオブジェクトで向きを指定)トグル
    if (windSourceBtn) windSourceBtn.addEventListener('click', () => {
        const editor = state.pose3d.editor;
        if (!editor) return;
        const on = editor.toggleWindSourceEnabled();
        windSourceBtn.textContent = on ? '🧭 発生源: ON' : '🧭 発生源: OFF';
        windSourceBtn.style.background = on ? 'var(--accent-primary, #0066cc)' : '';
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

    // カメラFOV(画角)スライダー
    if (fovSlider) {
        fovSlider.addEventListener('input', () => {
            const v = parseFloat(fovSlider.value);
            if (fovVal) fovVal.textContent = String(v);
            if (state.pose3d.editor) state.pose3d.editor.setFov(v);
        });
        fovSlider.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    }

    // カメラNear(ニアクリップ)スライダー
    if (nearSlider) {
        nearSlider.addEventListener('input', () => {
            const v = parseFloat(nearSlider.value);
            if (nearVal) nearVal.textContent = v.toFixed(2);
            if (state.pose3d.editor) state.pose3d.editor.setNear(v);
        });
        nearSlider.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    }
}

// 既定モデル: vrm-pose-editor の model/ フォルダ＋Default Model 設定（ノードと共有）から読み込む。
// vrm-pose-editor が v0.21.0 未満で default_model.js が無ければ undefined を返し、従来の動作のままにする。
// ユーザーが読み込んだモデルではないので modelIsDefault は true のまま（コマ確定時にモデルを埋め込まない）。
// VRM のバッファは Pose Library のサムネイル生成用に Light & Pose Editor へ渡すため保持する
function _pose3dDefaultModelProvider() {
    const resolve = window.pose3dResolveDefaultModel;
    if (typeof resolve !== 'function') return undefined;
    return async () => {
        const pick = await resolve();
        if (!pick) return null;
        const label = document.getElementById('pose3d-vrm-label');
        const showName = () => {
            if (label && state.pose3d.modelIsDefault) {
                label.textContent = pick.name.slice(0, 20) + (pick.name.length > 20 ? '…' : '');
            }
        };
        // .gltf は外部の .bin / テクスチャを相対パスで読むため、サーバーの URL のまま渡す
        if (/\.gltf$/i.test(pick.name)) { showName(); return pick.url; }
        const res = await fetch(pick.url);
        if (!res.ok) throw new Error(`default model: HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        // 取得中にユーザーがモデルを読み込んでいたら上書きしない
        if (!state.pose3d.modelIsDefault) return null;
        if (/\.vrm$/i.test(pick.name)) state.pose3d.modelBuffer = buf;
        showName();
        // WebGL コンテキスト復帰時の再読み込みでも使うため revoke しない
        return URL.createObjectURL(new Blob([buf]));
    };
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
            (keys) => {
                currentMorphKeys = keys;
                _pose3dRebuildMorphSliders(keys, morphPanel);
            },
            () => {
                // モデルロード完了後にrendererサイズを強制再同期（初回配置時の表示抜け対策）
                const cvs = state.pose3d.canvas;
                if (state.pose3d.editor && cvs.width > 0 && cvs.height > 0) {
                    state.pose3d.editor.resizeRenderer(cvs.width, cvs.height);
                }
            },
            _pose3dDefaultModelProvider()
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
    if (_pose3dIsBorrowed()) return;
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

// 現在のeditorのポーズをキャプチャし、指定コマへinsertImageでSVGに焼き込む共通処理
// （commitPose3D・_pose3dCaptureFrameToPanel の両方から使う）
async function _pose3dInsertCaptureIntoPanel(editor, panelId) {
    // ポーズデータ・モデル情報を収集（再編集用）
    const poseJson  = editor.exportPose() ?? '';

    // キャプチャ（ボーン点を非表示にしてレンダリング）
    const dataUrl = editor.capture();

    // canvas の実解像度をサイズとして渡す
    const cvs = state.pose3d.canvas;
    const w = cvs.width  || 600;
    const h = cvs.height || 600;

    // selectedPanelId を確保
    const prevPanelId = state.selectedPanelId;
    state.selectedPanelId = panelId;

    await insertImage(dataUrl, w, h, {
        'data-pose3d-pose':  poseJson,
    });

    state.selectedPanelId = prevPanelId;
}

// キャプチャ → insertImage でSVGに焼き込む
async function commitPose3D() {
    const editor   = state.pose3d.editor;
    const panelId  = state.pose3d.activePanelId;
    if (!editor || !panelId) return;

    // 3D ビューを隠してから選択コマに確定
    hidePose3DCanvas();

    await _pose3dInsertCaptureIntoPanel(editor, panelId);

    const statusEl = document.getElementById('pose3d-status');
    if (statusEl) statusEl.textContent = t('layout.pose3dCommitted');
}

// Light & Pose Editorのキーフレームパネル「📸 Capture」ボタン(nodeActions.doCapture)から
// 呼ばれる、SPA版の「今表示中のフレームのポーズをコマに確定」処理。commitPose3D()と違い
// 3Dビュー/モーダルは閉じない（タイムラインの再生バーで任意のフレームへシークしては
// このボタンでコマへ確定する、という操作を連続して行えるようにするため）。
async function _pose3dCaptureFrameToPanel() {
    const editor  = state.pose3d.editor;
    const panelId = state.pose3d.activePanelId;
    if (!editor || !panelId) {
        alert(t('layout.pose3dSelectPanelFirst'));
        return;
    }

    await _pose3dInsertCaptureIntoPanel(editor, panelId);

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
// ============================================================
// VRM Pose Studio 連携（設定タブ「3Dポーズ エディタ」で切替。🎛 Editor ボタンの動作だけが変わる）
// ------------------------------------------------------------
// VPS（ComfyUI-VRM-Pose-Studio, /vps）は同じ ComfyUI オリジンで配信される独立SPA。
// CC から window.open で開くと VPS の window.opener がこのページになるので、関数を直接呼び合う:
//   VPS → CC: window.ccGetPanelFrame()        起動時に送り先コマの枠を取得
//             window.ccReceiveVpsImage(payload) 「📤 CCのコマへ送る」で撮影画像を挿入
//   CC → VPS: vpsWin.vpsApplyCcFrame(frame)    開いたままのVPSへ枠を差し替え
// 枠 = { width, height, points: [[x,y],…] }（points はコマ外接矩形を基準に 0〜1 へ正規化した多角形）
// ============================================================

const POSE3D_EDITOR_ENGINE_KEY = 'ccc_pose3d_editor_engine'; // 'pose-editor' | 'vps'
const VPS_URL = '/vps?cc=1';
// ComfyUI のトップメニューは "vrm_pose_studio" で開く。同じ名前だと既存ウィンドウ（opener=ComfyUI）が
// 再利用されて CC と繋がらないため、CC 専用の名前を使う
const VPS_WINDOW_NAME = 'vrm_pose_studio_cc';
// 撮影解像度: コマ外接矩形の長辺をこの範囲に収める（SVG座標は 0.01mm 単位で大きいため）
const VPS_MIN_LONG_SIDE = 1024;
const VPS_MAX_LONG_SIDE = 2048;

let _vpsWin = null;        // 開いた VPS のウィンドウ
let _vpsTarget = null;     // { pageName, panelId, frame } 送り先のコマ（🎛 Editor を押した時点で固定）
let _vpsAvailable = null;  // /vps の有無（null=未確認）

function _pose3dGetEditorEngine() {
    try { return localStorage.getItem(POSE3D_EDITOR_ENGINE_KEY) === 'vps' ? 'vps' : 'pose-editor'; }
    catch { return 'pose-editor'; }
}

function _pose3dSetEditorEngine(v) {
    try { localStorage.setItem(POSE3D_EDITOR_ENGINE_KEY, v === 'vps' ? 'vps' : 'pose-editor'); } catch { /* ignore */ }
}

async function _vpsCheckAvailable() {
    try {
        const res = await fetch('/vps', { method: 'HEAD', cache: 'no-store' });
        _vpsAvailable = res.ok;
    } catch {
        _vpsAvailable = false;
    }
    return _vpsAvailable;
}

function _vpsParsePoints(pointsStr) {
    const nums = String(pointsStr || '').split(/[\s,]+/).map(parseFloat).filter(n => !isNaN(n));
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    return pts;
}

// コマの形を VPS に渡す枠へ変換する
function _vpsBuildFrame(panel) {
    if (!panel?.points) return null;
    const bbox = getBoundingBoxFromPoints(panel.points);
    if (!bbox || !bbox.width || !bbox.height) return null;
    const points = _vpsParsePoints(panel.points).map(([x, y]) => [
        (x - bbox.x) / bbox.width,
        (y - bbox.y) / bbox.height,
    ]);
    if (points.length < 3) return null;
    const longSide = Math.max(bbox.width, bbox.height);
    const scale = Math.min(VPS_MAX_LONG_SIDE, Math.max(VPS_MIN_LONG_SIDE, longSide)) / longSide;
    return {
        width:  Math.max(64, Math.round(bbox.width  * scale)),
        height: Math.max(64, Math.round(bbox.height * scale)),
        points,
        label: _vpsPanelLabel(panel),
    };
}

// コマの表示名（コマ選択ドロップダウン updatePanelSelectDropdown と同じ付け方）。VPS の枠に表示する
function _vpsPanelLabel(panel) {
    const panels = state.activePage?.panels ?? [];
    const numOf = (p) => (p.number !== undefined) ? p.number : panels.indexOf(p) + 1;
    if (panel.parentPanelId) {
        const parent = panels.find(p => p.id === panel.parentPanelId);
        // ドロップダウン用の字下げ記号「└」は外す
        return String(t('subpanel.optionLabel', parent ? numOf(parent) : '?')).replace(/^[\s└]+/, '');
    }
    return t('common.panelName', numOf(panel));
}

// 🎛 Editor（VPSモード）: 選択中のコマを送り先に固定し、VPSを開く（開いていれば枠だけ差し替える）
function _pose3dOpenVps(ev, statusEl) {
    const setStatus = (msg) => { if (statusEl) statusEl.textContent = msg; };
    if (_vpsAvailable === false) {
        // 起動後にインストールされた場合に備えて再確認しておく（次回クリックで反映）
        _vpsCheckAvailable();
        setStatus(t('layout.pose3dVpsNotFound'));
        return;
    }
    const panelId = state.pose3d.activePanelId || state.selectedPanelId;
    const panel = panelId ? state.activePage?.panels.find(p => p.id === panelId) : null;
    if (!panel) { setStatus(t('layout.pose3dSelectPanelFirst')); return; }
    const frame = _vpsBuildFrame(panel);
    if (!frame) { setStatus(t('layout.pose3dVpsPanelMissing')); return; }
    _vpsTarget = { pageName: state.activePage.name, panelId, frame };

    // ポップアップブロックを避けるため、ここ（クリックの同期処理内）で必ず window.open する。
    // URL を空で開くと、同名のウィンドウが既にあればそれを再読み込みせずに返す（CC を再読み込みした後も繋がる）
    let win = (_vpsWin && !_vpsWin.closed) ? _vpsWin : null;
    if (!win) {
        win = window.open('', VPS_WINDOW_NAME, ev?.shiftKey ? 'width=1600,height=960,resizable=yes' : '');
    }
    if (!win) { setStatus(t('layout.pose3dVpsPopupBlocked')); return; }
    _vpsWin = win;

    let applied = false;
    try {
        if (typeof win.vpsApplyCcFrame === 'function') {
            win.vpsApplyCcFrame(frame);
            applied = true;
        }
    } catch { /* 別オリジンのページなど */ }
    if (!applied) {
        let blank = false;
        try { blank = win.location.href === 'about:blank'; } catch { blank = false; }
        let isVpsLoading = false;
        try { isVpsLoading = win.location.pathname === '/vps'; } catch { /* ignore */ }
        // 読み込み中の VPS なら起動時に ccGetPanelFrame() で新しい枠を取りに来るので何もしない
        if (blank || !isVpsLoading) win.location.href = VPS_URL;
    }
    try { win.focus(); } catch { /* ignore */ }
    setStatus(t('layout.pose3dVpsOpened'));
}

// VPS から呼ばれる: 送り先コマの枠
window.ccGetPanelFrame = () => _vpsTarget?.frame ?? null;

// VPS から呼ばれる: 撮影画像（コマと同じ比率）を送り先のコマへ挿入する。失敗は例外で返す（VPS側でトースト表示）
window.ccReceiveVpsImage = async ({ dataUrl, width, height } = {}) => {
    const tgt = _vpsTarget;
    if (!tgt) throw new Error(t('layout.pose3dVpsNoTarget'));
    if (!dataUrl || !width || !height) throw new Error('invalid image');
    if (state.activePage?.name !== tgt.pageName) throw new Error(t('layout.pose3dVpsPageChanged'));
    const panel = state.activePage.panels.find(p => p.id === tgt.panelId);
    const bbox = panel?.points ? getBoundingBoxFromPoints(panel.points) : null;
    if (!bbox) throw new Error(t('layout.pose3dVpsPanelMissing'));

    // コマ外接矩形を覆うように配置（VPS側で枠を解除して比率が変わっていても歪ませない。はみ出しはコマのクリップで隠れる）
    const ia = width / height, ba = bbox.width / bbox.height;
    let pw, ph;
    if (ia > ba) { ph = bbox.height; pw = ph * ia; }
    else         { pw = bbox.width;  ph = pw / ia; }
    const placement = {
        x: bbox.x + (bbox.width - pw) / 2,
        y: bbox.y + (bbox.height - ph) / 2,
        width: pw, height: ph,
    };

    // insertImage は選択状態（下書き/オーバーレイ/コマ）で挿入先を決めるため、一時的に送り先コマを選択扱いにする
    const prev = { panel: state.selectedPanelId, overlay: state.selectedOverlay, draft: state.selectedDraft };
    state.selectedPanelId = tgt.panelId;
    state.selectedOverlay = false;
    state.selectedDraft = false;
    let ok = false;
    try {
        ok = await insertImage(String(dataUrl), width, height, { 'data-vps-capture': '1' }, placement);
    } finally {
        state.selectedPanelId = prev.panel;
        state.selectedOverlay = prev.overlay;
        state.selectedDraft = prev.draft;
    }
    if (ok === false) throw new Error(t('layout.pose3dVpsPanelMissing'));
    const statusEl = document.getElementById('pose3d-status');
    if (statusEl) statusEl.textContent = t('layout.pose3dVpsInserted');
    return true;
};

// 設定タブ「3Dポーズ エディタ」
function _initPose3dEditorSetting() {
    const sel = document.getElementById('settings-pose3d-editor');
    if (!sel) return;
    const statusEl = document.getElementById('settings-pose3d-editor-status');
    const refresh = async () => {
        sel.value = _pose3dGetEditorEngine();
        if (!statusEl) return;
        if (sel.value !== 'vps') { statusEl.textContent = ''; return; }
        const ok = await _vpsCheckAvailable();
        statusEl.textContent = t(ok ? 'settings.vpsFound' : 'settings.vpsNotFound');
        statusEl.style.color = ok ? '#4caf50' : '#e57373';
    };
    sel.addEventListener('change', () => { _pose3dSetEditorEngine(sel.value); refresh(); });
    refresh();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _initPose3dEditorSetting);
else _initPose3dEditorSetting();

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

export { initPose3DTab, hidePose3DCanvas, _pose3dSyncPosition, _pose3dIsBorrowed };

// まだESM化されていない main/以下の classic <script> や、既存ESMファイルの一部が
// window経由で呼んでいるためのブリッジ（ESモジュール化移行中の一時措置。
// 全分割ファイルのESM化が完了したら、各呼び出し元をimport文に置き換えてこのブロックごと削除する）。
window.initPose3DTab = initPose3DTab;
