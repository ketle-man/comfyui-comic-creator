// ============================================================
// main.js 分割ファイル (17/24): Processingタブ+Editタブ
// 元 main.js の行 13258-13628 に相当
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: _getSvgSize,_layerDrawOriginalUnit,_procApplyDenoise,_procApplySharpen,_procRemoveBackground,_procRemoveBackgroundBiRefNet,_procRemoveBackgroundImgly,_procRemoveBackgroundSvg,_procRun,_procState,_procUpscale,_svgBase64ToText,initEditTab,initProcessingTab
// ============================================================

// ============================================================
// Processing タブ（アップスケール・背景除去）
// ============================================================

const _procState = {
    scale: 2.0,
};

function initProcessingTab() {
    const scaleUp   = document.getElementById('proc-scale-up');
    const scaleDown = document.getElementById('proc-scale-down');
    const scaleVal  = document.getElementById('proc-scale-value');
    const sharpen   = document.getElementById('proc-sharpen');
    const sharpenV  = document.getElementById('proc-sharpen-value');
    const runBtn    = document.getElementById('proc-run-btn');

    scaleUp.addEventListener('click', () => {
        _procState.scale = Math.min(4.0, parseFloat((_procState.scale + 0.5).toFixed(1)));
        scaleVal.textContent = _procState.scale.toFixed(1) + '×';
    });
    scaleDown.addEventListener('click', () => {
        _procState.scale = Math.max(1.0, parseFloat((_procState.scale - 0.5).toFixed(1)));
        scaleVal.textContent = _procState.scale.toFixed(1) + '×';
    });
    sharpen.addEventListener('input', () => {
        sharpenV.textContent = sharpen.value + '%';
    });
    const bgRemoveChk   = document.getElementById('proc-bg-remove');
    const bgModelSelect = document.getElementById('proc-bg-model');
    bgRemoveChk.addEventListener('change', () => {
        bgModelSelect.style.display = bgRemoveChk.checked ? 'inline-block' : 'none';
    });
    runBtn.addEventListener('click', _procRun);
}

async function _procRun() {
    const statusEl  = document.getElementById('proc-status');
    const bgRemove  = document.getElementById('proc-bg-remove').checked;
    const bgModel   = document.getElementById('proc-bg-model').value;
    const denoise   = document.getElementById('proc-denoise').checked;
    const sharpenPc = parseInt(document.getElementById('proc-sharpen').value, 10) / 100;

    // 選択画像の base64 取得
    if (!state.selectedImageEl) {
        alert(t('layout.msgSelectImage'));
        return;
    }
    const origHref = state.selectedImageEl.getAttribute('href') || state.selectedImageEl.getAttribute('xlink:href') || '';
    if (!origHref.startsWith('data:')) {
        alert(t('layout.msgImageBase64Unavailable'));
        return;
    }

    statusEl.textContent = t('layout.processing');
    document.getElementById('proc-run-btn').disabled = true;

    try {
        let dataUrl = origHref;
        const isSvg = dataUrl.startsWith('data:image/svg');

        // SVGの場合: 背景除去のみ実行してアップスケール等をスキップ
        if (isSvg) {
            if (bgRemove) {
                statusEl.textContent = t('layout.procSvgBgRemoving');
                dataUrl = _procRemoveBackgroundSvg(dataUrl);
            }
            statusEl.textContent = t('layout.procInserting');
            const { w, h } = _getSvgSize(dataUrl);
            await insertImage(dataUrl, w, h);
            statusEl.textContent = t('common.done');
            setTimeout(() => { statusEl.textContent = ''; }, 3000);
            return;
        }

        // 背景除去
        if (bgRemove) {
            statusEl.textContent = t('layout.procBgRemoving', bgModel === 'birefnet' ? 'BiRefNet' : t('layout.procLightModel'));
            dataUrl = await _procRemoveBackground(dataUrl, bgModel);
        }

        // アップスケール
        statusEl.textContent = t('image.upscaleRunning');
        dataUrl = await _procUpscale(dataUrl, _procState.scale, denoise, sharpenPc);

        // 新規保存（insertImage でコマに挿入）
        statusEl.textContent = t('layout.procInserting');
        const img = new Image();
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = dataUrl;
        });
        await insertImage(dataUrl, img.width, img.height);
        statusEl.textContent = t('common.done');
        setTimeout(() => { statusEl.textContent = ''; }, 3000);

    } catch (e) {
        console.error('Processing error:', e);
        statusEl.textContent = t('common.errorPrefix', e.message);
    } finally {
        document.getElementById('proc-run-btn').disabled = false;
    }
}

// base64 SVG dataUrl を UTF-8 テキストにデコードするヘルパー
function _svgBase64ToText(dataUrl) {
    const raw = dataUrl.split(',')[1] || '';
    const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}

// SVGのbase64 dataUrlからviewBox/width/heightを取得して { w, h } を返す
function _getSvgSize(dataUrl) {
    try {
        const svgText = _svgBase64ToText(dataUrl);
        const parser = new DOMParser();
        const svgEl = parser.parseFromString(svgText, 'image/svg+xml').querySelector('svg');
        if (svgEl) {
            const vb = svgEl.getAttribute('viewBox');
            if (vb) {
                const p = vb.trim().split(/[\s,]+/);
                return { w: parseFloat(p[2]) || 1000, h: parseFloat(p[3]) || 1000 };
            }
            return {
                w: parseFloat(svgEl.getAttribute('width')) || 1000,
                h: parseFloat(svgEl.getAttribute('height')) || 1000,
            };
        }
    } catch (_) {}
    return { w: 1000, h: 1000 };
}

// SVG背景除去: 単色背景のrect/矩形pathを削除し、透過SVGとして返す
function _procRemoveBackgroundSvg(dataUrl) {
    try {
        const svgText = _svgBase64ToText(dataUrl);
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgText, 'image/svg+xml');
        const svgEl = doc.querySelector('svg');
        if (!svgEl) return dataUrl;

        // 全面を覆うrect（原点付近から全幅・全高、任意色）を削除
        const vb = svgEl.getAttribute('viewBox');
        const vbParts = vb ? vb.trim().split(/[\s,]+/) : null;
        const vbW = vbParts ? parseFloat(vbParts[2]) : null;
        const vbH = vbParts ? parseFloat(vbParts[3]) : null;
        svgEl.querySelectorAll('rect').forEach(el => {
            const x = parseFloat(el.getAttribute('x') || '0');
            const y = parseFloat(el.getAttribute('y') || '0');
            const w = el.getAttribute('width') || '';
            const h = el.getAttribute('height') || '';
            const isOrigin = x <= 0 && y <= 0;
            const isFullW = w === '100%' || (vbW && parseFloat(w) >= vbW * 0.99);
            const isFullH = h === '100%' || (vbH && parseFloat(h) >= vbH * 0.99);
            if (isOrigin && isFullW && isFullH) el.remove();
        });

        const serializer = new XMLSerializer();
        const newSvg = serializer.serializeToString(svgEl);
        return 'data:image/svg+xml;base64,' + btoa(new TextEncoder().encode(newSvg).reduce((s, b) => s + String.fromCharCode(b), ''));
    } catch (e) {
        console.error('[SVG BgRemove]', e);
        return dataUrl;
    }
}

async function _procRemoveBackground(dataUrl, model = 'imgly') {
    if (model === 'birefnet') {
        return await _procRemoveBackgroundBiRefNet(dataUrl);
    }
    return await _procRemoveBackgroundImgly(dataUrl);
}

async function _procRemoveBackgroundImgly(dataUrl) {
    if (!window._imglyRemoveBackground) {
        const mod = await import('https://esm.sh/@imgly/background-removal@1.5.7?bundle&target=es2022');
        window._imglyRemoveBackground = mod.removeBackground;
    }
    const fn = window._imglyRemoveBackground;
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const resultBlob = await fn(blob, {
        publicPath: 'https://staticimgly.com/@imgly/background-removal-data/1.5.7/dist/'
    });
    return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(resultBlob);
    });
}

// BiRefNet 背景除去（将来実装）
// eslint-disable-next-line no-unused-vars
async function _procRemoveBackgroundBiRefNet(dataUrl) {
    // TODO: Transformers.js (WebGPU) または Python バックエンドで実装予定
    throw new Error('BiRefNet は未実装です');
}

async function _procUpscale(dataUrl, scale, denoise, sharpenRatio) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const w = img.width;
            const h = img.height;

            // ソースキャンバス
            const srcCanvas = document.createElement('canvas');
            srcCanvas.width = w;
            srcCanvas.height = h;
            const srcCtx = srcCanvas.getContext('2d');
            srcCtx.drawImage(img, 0, 0);

            let srcData = srcCtx.getImageData(0, 0, w, h);

            // ノイズ除去
            if (denoise) {
                srcData = _procApplyDenoise(srcData, w, h);
                srcCtx.putImageData(srcData, 0, 0);
            }

            // アップスケール（バイキュービック相当）
            const dstW = Math.round(w * scale);
            const dstH = Math.round(h * scale);
            const dstCanvas = document.createElement('canvas');
            dstCanvas.width  = dstW;
            dstCanvas.height = dstH;
            const dstCtx = dstCanvas.getContext('2d');
            dstCtx.imageSmoothingEnabled = true;
            dstCtx.imageSmoothingQuality = 'high';
            dstCtx.drawImage(srcCanvas, 0, 0, dstW, dstH);

            // シャープ化
            if (sharpenRatio > 0) {
                const sharpData = _procApplySharpen(dstCtx.getImageData(0, 0, dstW, dstH), dstW, dstH, sharpenRatio);
                dstCtx.putImageData(sharpData, 0, 0);
            }

            resolve(dstCanvas.toDataURL('image/png'));
        };
        img.onerror = reject;
        img.src = dataUrl;
    });
}

function _procApplyDenoise(imageData, w, h) {
    const src = imageData.data;
    const out = new Uint8ClampedArray(src.length);
    const radius = 2;
    const sigma  = 30;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let rSum = 0, gSum = 0, bSum = 0, wSum = 0;
            const ci = (y * w + x) * 4;
            const cr = src[ci], cg = src[ci+1], cb = src[ci+2];
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    const nx = x + dx, ny = y + dy;
                    if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
                    const ni = (ny * w + nx) * 4;
                    const nr = src[ni], ng = src[ni+1], nb = src[ni+2];
                    const spatialW = Math.exp(-(dx*dx + dy*dy) / (2 * radius * radius));
                    const colorD   = (nr-cr)**2 + (ng-cg)**2 + (nb-cb)**2;
                    const colorW   = Math.exp(-colorD / (2 * sigma * sigma));
                    const w2 = spatialW * colorW;
                    rSum += nr * w2; gSum += ng * w2; bSum += nb * w2; wSum += w2;
                }
            }
            const oi = (y * w + x) * 4;
            out[oi]   = rSum / wSum;
            out[oi+1] = gSum / wSum;
            out[oi+2] = bSum / wSum;
            out[oi+3] = src[oi+3];
        }
    }
    return new ImageData(out, w, h);
}

function _procApplySharpen(imageData, w, h, amount) {
    const src = imageData.data;
    const out = new Uint8ClampedArray(src.length);
    const kernel = [-1,-1,-1,-1,9,-1,-1,-1,-1];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let r = 0, g = 0, b = 0;
            for (let ky = -1; ky <= 1; ky++) {
                for (let kx = -1; kx <= 1; kx++) {
                    const nx = Math.max(0, Math.min(w-1, x+kx));
                    const ny = Math.max(0, Math.min(h-1, y+ky));
                    const ni = (ny * w + nx) * 4;
                    const k  = kernel[(ky+1)*3 + (kx+1)];
                    r += src[ni]   * k;
                    g += src[ni+1] * k;
                    b += src[ni+2] * k;
                }
            }
            const oi = (y * w + x) * 4;
            const sr = src[oi], sg = src[oi+1], sb = src[oi+2];
            out[oi]   = Math.max(0, Math.min(255, sr + (r - sr) * amount));
            out[oi+1] = Math.max(0, Math.min(255, sg + (g - sg) * amount));
            out[oi+2] = Math.max(0, Math.min(255, sb + (b - sb) * amount));
            out[oi+3] = src[oi+3];
        }
    }
    return new ImageData(out, w, h);
}

// ============================================================
// Edit タブ（ボックス描画・テキスト・モザイク・ぼかし）
// ============================================================

function initEditTab() {
    // Editモード切り替えタブ
    document.querySelectorAll('.edit-mode-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.edit-mode-tab-btn').forEach(b => {
                b.classList.remove('active');
                b.style.background = 'var(--bg-secondary)';
            });
            btn.classList.add('active');
            btn.style.background = 'var(--bg-primary)';
            const mode = btn.dataset.editMode;
            document.getElementById('edit-panel-box').style.display      = mode === 'box'       ? '' : 'none';
            document.getElementById('edit-panel-svg-color').style.display = mode === 'svg-color' ? '' : 'none';
            document.getElementById('edit-panel-svg-png').style.display   = mode === 'svg-png'   ? '' : 'none';
        });
    });

    // SVG色変更
    document.getElementById('svg-color-load-btn').addEventListener('click', _svgColorLoad);
    document.getElementById('svg-color-apply-btn').addEventListener('click', _svgColorApply);

    // SVG→PNG変換
    document.getElementById('svg-png-convert-btn').addEventListener('click', _svgToPngConvert);

    // 縦横比固定: 幅変更で高さを自動更新
    const pngW = document.getElementById('svg-png-width');
    const pngH = document.getElementById('svg-png-height');
    pngW.addEventListener('input', () => {
        if (!document.getElementById('svg-png-keep-aspect').checked) return;
        const ratio = _svgColorState.origHeight / (_svgColorState.origWidth || 1);
        if (pngW.value) pngH.value = Math.round(Number(pngW.value) * ratio) || '';
    });
    pngH.addEventListener('input', () => {
        if (!document.getElementById('svg-png-keep-aspect').checked) return;
        const ratio = _svgColorState.origWidth / (_svgColorState.origHeight || 1);
        if (pngH.value) pngW.value = Math.round(Number(pngH.value) * ratio) || '';
    });

    // 図形をPNG変換ボタン
    document.getElementById('layer-draw-shape-to-png')?.addEventListener('click', _layerDrawShapeToPng);

    // レイヤー描画初期化
    initLayerDraw();

    // 画像タブで編集ボタン: Imageタブで開く
    document.getElementById('layer-draw-open-imgedit').addEventListener('click', openImageTabWithSelected);

    // I2Iへ送るボタン: 選択中の画像をWorkflow Studioへ送信
    document.getElementById('layout-i2i-send-btn')?.addEventListener('click', sendSelectedImageToI2I);

    // OCボタン: 選択中オブジェクトをコマ/ページ中央へ移動
    document.getElementById('object-center-btn')?.addEventListener('click', moveSelectedObjectToCenter);
}

// オリジナル画像の一コマをCanvasに描画（レイヤー描画のMy曲線用）
function _layerDrawOriginalUnit(ctx, x, y, angle, scale, img) {
    if (!img || !img.complete || img.naturalWidth === 0) return;
    const w = img.naturalWidth  * scale;
    const h = img.naturalHeight * scale;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
}

