// text3d-settings-modal.js — 3Dテキストの「ライト・マテリアル設定」モーダル
//
// comfyui-vrm-pose-editor の light_editor.js (openLightEditor) を範にした軽量版。
// text3dのライトはAmbient/Key/Fillの3灯固定（3Dポーズ側のような自由な追加/削除・
// プリセットライブラリは持たない）。マテリアル設定（色/Standard-Toon切替/金属・粗さ/
// 陰色・階調）もここに集約し、常時表示のツールバーからは撤去する。
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
// setLightPosition/getZoomMode/setZoomMode/getParams/setColor/setMaterialType/
// setMetalness/setRoughness/setShadeColor/setToony を持つ）を渡す。
// cvsWrapper は実際に描画中のcanvasを内包するDOM要素（呼び出し元のwrapper div）を渡す。

import { t } from './i18n.js';

const LIGHT_LABEL_KEYS = { ambient: 'layout.text3dLightAmbient', key: 'layout.text3dLightKey', fill: 'layout.text3dLightFill' };

export function openText3DSettingsModal(editor, cvsWrapper) {
    if (!editor || document.getElementById('text3d-settings-modal')) return;

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
    }

    const dialog = el('div', {
        style: 'background:#1e1e2e;color:#ccc;border-radius:10px;' +
               'width:min(94vw,820px);height:min(90vh,600px);display:flex;flex-direction:column;' +
               'box-shadow:0 8px 40px rgba(0,0,0,0.85);font-family:sans-serif;overflow:hidden;',
    });

    const header = el('div', {
        style: 'display:flex;align-items:center;gap:8px;padding:10px 14px;' +
               'background:#16213e;border-bottom:1px solid #333;flex-shrink:0;',
    });
    header.append(
        el('span', { style: 'font-size:14px;font-weight:bold;color:#e0e0ff;flex:1;' }, t('layout.text3dSettingsModalTitle')),
        mkCloseBtn(cleanup),
    );

    const bodyRow = el('div', { style: 'flex:1;display:flex;overflow:hidden;min-height:0;' });

    // ---- 左: プレビュー（実描画中のcanvasを埋め込む） ----
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

    // ---- 右: 設定（スクロール可能） ----
    const settingsPanel = el('div', { style: 'width:280px;flex-shrink:0;overflow-y:auto;padding:12px 14px;' });

    // ---- マテリアル ----
    settingsPanel.appendChild(sectionTitle(t('layout.text3dMaterialSection')));
    const materialSection = el('div', {});
    settingsPanel.appendChild(materialSection);

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

        materialSection.appendChild(row(t('layout.text3dColorLabel'), mkColorInput(p.color, (v) => editor.setColor(v))));

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

    // ---- ライト（Ambient/Key/Fillの3灯固定） ----
    settingsPanel.appendChild(sectionTitle(t('layout.text3dLightSection')));
    editor.getLights().forEach((cfg) => {
        settingsPanel.appendChild(el('div', {
            style: 'font-size:11px;font-weight:bold;color:#7a9aaa;margin:8px 0 4px;',
        }, t(LIGHT_LABEL_KEYS[cfg.id] ?? cfg.id)));

        settingsPanel.appendChild(row(t('layout.text3dColorLabel'), mkColorInput(cfg.color, (v) => editor.setLightColor(cfg.id, v))));
        const [iSl, iVl] = mkSl(0, 3, 0.05, cfg.intensity, (v) => editor.setLightIntensity(cfg.id, v));
        settingsPanel.appendChild(rowWithValue(t('layout.text3dLightIntensityLabel'), iSl, iVl));

        if (cfg.position) {
            const pos = { ...cfg.position };
            const posLabelKeys = { x: 'layout.text3dLightPosXLabel', y: 'layout.text3dLightPosYLabel', z: 'layout.text3dLightPosZLabel' };
            ['x', 'y', 'z'].forEach((axis) => {
                const [sl, vl] = mkSl(-10, 10, 0.1, pos[axis], (v) => {
                    pos[axis] = v;
                    editor.setLightPosition(cfg.id, pos.x, pos.y, pos.z);
                });
                settingsPanel.appendChild(rowWithValue(t(posLabelKeys[axis]), sl, vl));
            });
        }
    });

    // ---- カメラ（カメラリセット・ズーム操作モード[3Dポーズ側の設定と共通]） ----
    settingsPanel.appendChild(sectionTitle(t('layout.text3dCameraSection')));

    if (typeof editor.resetCamera === 'function') {
        const rcBtn = mkToggleBtn('RC', false); // 3Dポーズの表記に合わせ、翻訳せず"RC"固定
        rcBtn.title = t('layout.text3dResetCameraTitle');
        rcBtn.style.width = '100%';
        rcBtn.style.marginBottom = '8px';
        rcBtn.onclick = () => editor.resetCamera();
        settingsPanel.appendChild(rcBtn);
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
    settingsPanel.appendChild(zoomBtn);

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
        settingsPanel.appendChild(aaBtn);
    }

    bodyRow.append(previewPanel, settingsPanel);
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
