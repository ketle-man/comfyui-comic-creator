// ============================================================
// マンガツール: ハーフトーン変換/生成 + マンガ効果（ヴィネット / スクリーントーンノイズ / 集中線）
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: initMangaHalftoneButton, mangaHalftoneOpen, initMangaEffectsButton, mangaEffectsOpen
// ============================================================

// ── 共通: 対象領域（コマ/オーバーレイ）の決定とサイズ取得 ──
// マンガ効果・ハーフトーンの「パターンを作成」モードは、選択中の画像ではなく
// 選択中のコマ（またはオーバーレイ）サイズにジャストフィットする新規オブジェクトとして生成する。

function _mangaRegionFromPanelId(panelId) {
    const panel = state.activePage?.panels?.find(p => p.id === panelId);
    if (!panel) return null;
    let x, y, width, height;
    if (panel.points) {
        const bbox = getBoundingBoxFromPoints(panel.points);
        if (bbox) { x = bbox.x; y = bbox.y; width = bbox.width; height = bbox.height; }
    }
    if (width === undefined && panel.width) {
        x = panel.x; y = panel.y; width = panel.width; height = panel.height;
    }
    if (!width || !height) return null;
    return { x, y, width, height, isOverlay: false, panelId: panel.id };
}

function _mangaRegionFromOverlay() {
    if (!state.activePage?.svgContent) return null;
    const parser = new DOMParser();
    const imgSvg = parser.parseFromString(state.activePage.svgContent, 'image/svg+xml').querySelector('svg');
    const vb = imgSvg ? imgSvg.getAttribute('viewBox') : '0 0 21000 29700';
    const [x, y, width, height] = vb.split(' ').map(Number);
    if (!width || !height) return null;
    return { x, y, width, height, isOverlay: true, panelId: '__overlay__' };
}

// 選択中の画像→そのコマ/オーバーレイ、画像未選択なら選択中のコマ/オーバーレイ、の優先順位で対象領域を決める
function _mangaGetTargetRegion() {
    if (!state.activePage) return null;
    const imgEl = state.selectedImageEl;
    if (imgEl) {
        const clipG = imgEl.closest('g[data-clip-panel]');
        if (clipG) {
            const region = _mangaRegionFromPanelId(clipG.getAttribute('data-clip-panel'));
            if (region) return region;
        }
        if (imgEl.closest('g[data-overlay-layer]')) {
            const region = _mangaRegionFromOverlay();
            if (region) return region;
        }
    }
    if (state.selectedOverlay) {
        const region = _mangaRegionFromOverlay();
        if (region) return region;
    }
    if (state.selectedPanelId) {
        const region = _mangaRegionFromPanelId(state.selectedPanelId);
        if (region) return region;
    }
    return null;
}

function _mangaTargetRegionLabel(region) {
    if (!region) return t('layout.notSelected');
    if (region.isOverlay) return t('common.overlayFull');
    const panels = state.activePage?.panels || [];
    const p = panels.find(pp => pp.id === region.panelId);
    const num = p ? ((p.number !== undefined) ? p.number : panels.indexOf(p) + 1) : '?';
    return t('common.panelName', num);
}

// 対象領域のアスペクト比を保ちつつ、長辺が maxDim 以内・minDim 以上になるようcanvas解像度を決める
// （対象領域はSVG座標系＝mm/pt相当の生の数値のため、そのままpxとして使わない）
function _mangaCanvasSizeForRegion(region, maxDim, minDim) {
    minDim = minDim || 400;
    const longSide = Math.max(region.width, region.height);
    let s = 1;
    if (longSide > maxDim) s = maxDim / longSide;
    else if (longSide < minDim) s = minDim / longSide;
    return {
        width: Math.max(1, Math.round(region.width * s)),
        height: Math.max(1, Math.round(region.height * s)),
    };
}

// 生成したcanvasを対象領域にジャストフィットする新規画像オブジェクトとして挿入する。
// insertImage()（08-panels-images.js）は state.selectedOverlay / state.selectedPanelId を見て
// 挿入先を分岐するため、region の対象と一致させてから呼び、呼び出し後は選択状態を元に戻す。
async function _mangaInsertGeneratedToRegion(canvas, region, extraAttrs) {
    const dataUrl = canvas.toDataURL('image/png');
    const placement = { x: region.x, y: region.y, width: region.width, height: region.height };
    const prevOverlay = state.selectedOverlay;
    const prevPanelId = state.selectedPanelId;
    state.selectedOverlay = !!region.isOverlay;
    if (!region.isOverlay) state.selectedPanelId = region.panelId;
    try {
        await insertImage(dataUrl, canvas.width, canvas.height, extraAttrs || {}, placement);
    } finally {
        state.selectedOverlay = prevOverlay;
        state.selectedPanelId = prevPanelId;
    }
}

function _mangaDrawCheckerboard(ctx, width, height, cell) {
    cell = cell || 10;
    for (let y = 0; y < height; y += cell) {
        for (let x = 0; x < width; x += cell) {
            const even = ((Math.floor(x / cell) + Math.floor(y / cell)) % 2) === 0;
            ctx.fillStyle = even ? '#3a3a3a' : '#2a2a2a';
            ctx.fillRect(x, y, cell, cell);
        }
    }
}

function _mangaHexToRgb(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    if (!m) return { r: 0, g: 0, b: 0 };
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

// ── 共通: 選択画像の読み込み・書き戻しパイプライン（ハーフトーンの「画像を変換」モード専用） ──
// 15-pixifx-bridge.js の pixiFxOpenForLayout と同じ判定ロジックを再利用する。

function _mangaGetSelectedImageHref() {
    const imgEl = state.selectedImageEl;
    if (!imgEl) return null;
    const href = imgEl.getAttribute('href') || imgEl.getAttribute('xlink:href') || '';
    if (!href.startsWith('data:image/')) return null;
    return href;
}

function _mangaLoadImage(href) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = href;
    });
}

// ハーフトーン「パターンを作成」モードのプレビュー背景ガイド用に、選択中の画像→
// 対象領域（コマ/オーバーレイ）内の既存画像、の優先順位で背景に敷く画像を探す。
// 見つかった画像はプレビュー表示にのみ使い、実際に生成・挿入されるcanvasには含めない。
async function _mangaGetRegionBackdropImage(region) {
    const selectedHref = _mangaGetSelectedImageHref();
    if (selectedHref) {
        try { return await _mangaLoadImage(selectedHref); } catch { /* fall through */ }
    }
    if (!region) return null;
    const svgEl = document.querySelector('#layout-preview svg');
    if (!svgEl) return null;
    const containerSelector = region.isOverlay
        ? 'g[data-overlay-layer] image'
        : `g[data-clip-panel="${region.panelId}"] image`;
    const imgEl = svgEl.querySelector(containerSelector);
    const href = imgEl?.getAttribute('href') || imgEl?.getAttribute('xlink:href') || '';
    if (!href.startsWith('data:image/')) return null;
    try { return await _mangaLoadImage(href); } catch { return null; }
}

async function _mangaCommitCanvasToSelectedImage(canvas) {
    const imgEl = state.selectedImageEl;
    if (!imgEl) return false;
    const dataUrl = canvas.toDataURL('image/png');
    pushHistory();
    imgEl.setAttribute('href', dataUrl);
    if (imgEl.hasAttribute('xlink:href')) imgEl.setAttribute('xlink:href', dataUrl);
    const svgEl = imgEl.closest('svg');
    if (!svgEl) return false;
    const panelId = imgEl.getAttribute('data-panel-id') ||
                    imgEl.closest('[data-clip-panel]')?.getAttribute('data-clip-panel');
    const isOverlay = svgEl.querySelector('g[data-overlay-layer]')?.contains(imgEl) ?? false;
    if (isOverlay) {
        await saveOverlaySvg(svgEl);
    } else if (panelId) {
        await savePanelSvg(panelId, svgEl);
    }
    return true;
}

// ── コア描画: ハーフトーン（manga-halftone-processor の HalftoneCanvas.tsx を参考に移植） ──
// 角度を付けたグリッド（間隔=dotSize）を対角線範囲でスキャンし、各格子点に対応するソース画像
// 1pxの濃度に比例したサイズの図形を描く古典的なAMスクリーニングの簡易実装。
// 「画像を変換」モードでは元画像のImageDataを、「パターンを作成」モードでは
// _mangaCreateSyntheticImageData() が生成した一様/グラデーションのグレー画像を渡す。

// ドットサイズ・粒サイズ・線の太さなど「絶対ピクセル値」のパラメータは、プレビュー用の
// 小さいcanvas（数百px）と適用時の大きいcanvas（最大2400px）とで解像度が大きく異なるため、
// そのまま使うと見た目の密度がプレビューと適用結果で全く変わってしまう。
// このリファレンス解像度を基準に実際のcanvasサイズへ比例スケールすることで一致させる。
const _MANGA_SIZE_REFERENCE_DIM = 400;

function _mangaRenderHalftone(ctx, imgData, width, height, options) {
    const data = imgData.data;
    const sizeScale = Math.max(width, height) / _MANGA_SIZE_REFERENCE_DIM;
    const S = Math.max(1, options.dotSize * sizeScale);
    const angleRad = (options.angle * Math.PI) / 180;
    const diag = Math.sqrt(width * width + height * height);
    const halfDiag = diag / 2;
    const cx = width / 2, cy = height / 2;
    const cosA = Math.cos(angleRad), sinA = Math.sin(angleRad);
    const inkColor = options.colorMode === 'duotone' ? (options.inkColor || '#000000') : '#000000';
    const paperColor = options.colorMode === 'duotone' ? (options.paperColor || '#ffffff') : '#ffffff';

    if (!options.transparentBackground) {
        ctx.fillStyle = paperColor;
        ctx.fillRect(0, 0, width, height);
    }
    ctx.fillStyle = inkColor;
    ctx.strokeStyle = inkColor;

    // 標準コントラスト補正式（-255〜255レンジ、UIは-100〜100を渡す）
    const contrast = (options.contrast || 0) * 2.55;
    const cFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));

    for (let gx = -halfDiag; gx < halfDiag; gx += S) {
        for (let gy = -halfDiag; gy < halfDiag; gy += S) {
            const imgX = Math.round(cx + gx * cosA - gy * sinA);
            const imgY = Math.round(cy + gx * sinA + gy * cosA);
            if (imgX < 0 || imgX >= width || imgY < 0 || imgY >= height) continue;
            const idx = (imgY * width + imgX) * 4;
            let gray = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
            gray += ((options.brightness || 0) / 100) * 255;
            gray = cFactor * (gray - 128) + 128;
            gray = Math.max(0, Math.min(255, gray));
            if (options.enableBinarize) gray = gray < options.threshold ? 0 : 255;
            let darkIntensity = 1 - gray / 255;
            if (options.invert) darkIntensity = 1 - darkIntensity;
            if (darkIntensity < (options.minDarkness || 0)) continue;
            const maxShapeSize = S * options.dotCoverage;
            const size = maxShapeSize * darkIntensity;
            if (size <= 0.3) continue;

            ctx.save();
            ctx.translate(imgX, imgY);
            ctx.rotate(angleRad);
            switch (options.shape) {
                case 'line':
                    ctx.lineWidth = size;
                    ctx.beginPath();
                    ctx.moveTo(-S / 2, 0);
                    ctx.lineTo(S / 2, 0);
                    ctx.stroke();
                    break;
                case 'square':
                    ctx.fillRect(-size / 2, -size / 2, size, size);
                    break;
                case 'cross':
                    ctx.lineWidth = Math.max(1, size * 0.3);
                    ctx.beginPath();
                    ctx.moveTo(-size / 2, 0); ctx.lineTo(size / 2, 0);
                    ctx.moveTo(0, -size / 2); ctx.lineTo(0, size / 2);
                    ctx.stroke();
                    break;
                case 'dot':
                default:
                    ctx.beginPath();
                    ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
                    ctx.fill();
                    break;
            }
            ctx.restore();
        }
    }
}

// 元画像を使わず、一様濃度またはグラデーション濃度のグレースケールImageDataを合成する
// （ハーフトーンの「パターンを作成」モード用のソース）
function _mangaCreateSyntheticImageData(width, height, options) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const toGray = darkness => Math.round(255 * (1 - darkness));

    if (!options.gradientEnabled) {
        const g = toGray(options.uniformDarkness);
        ctx.fillStyle = `rgb(${g},${g},${g})`;
        ctx.fillRect(0, 0, width, height);
    } else {
        const gStart = toGray(options.gradientStart);
        const gEnd = toGray(options.gradientEnd);
        const cx = width / 2, cy = height / 2;
        let grad;
        if (options.gradientType === 'radial') {
            const r = Math.sqrt(cx * cx + cy * cy);
            grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        } else {
            const rad = ((options.gradientAngle || 0) * Math.PI) / 180;
            const dx = Math.cos(rad), dy = Math.sin(rad);
            const len = Math.abs(dx) * width + Math.abs(dy) * height;
            grad = ctx.createLinearGradient(cx - dx * len / 2, cy - dy * len / 2, cx + dx * len / 2, cy + dy * len / 2);
        }
        grad.addColorStop(0, `rgb(${gStart},${gStart},${gStart})`);
        grad.addColorStop(1, `rgb(${gEnd},${gEnd},${gEnd})`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
    }
    return ctx.getImageData(0, 0, width, height);
}

// 「画像を変換」モード: 元画像をtargetサイズに描画→ハーフトーン化したcanvasを返す
function _mangaProcessImageToCanvas(img, targetWidth, targetHeight, options) {
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = targetWidth;
    srcCanvas.height = targetHeight;
    const srcCtx = srcCanvas.getContext('2d');
    srcCtx.drawImage(img, 0, 0, targetWidth, targetHeight);
    const imgData = srcCtx.getImageData(0, 0, targetWidth, targetHeight);

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    _mangaRenderHalftone(ctx, imgData, targetWidth, targetHeight, options);
    return canvas;
}

// 「パターンを作成」モード: 元画像を使わず targetサイズのハーフトーンパターンだけのcanvasを返す
function _mangaGenerateHalftonePatternCanvas(targetWidth, targetHeight, options) {
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    const synthData = _mangaCreateSyntheticImageData(targetWidth, targetHeight, options);
    _mangaRenderHalftone(ctx, synthData, targetWidth, targetHeight, options);
    return canvas;
}

// ── コア描画: マンガ効果（ヴィネット / スクリーントーンノイズ / 集中線） ──
// いずれも透過canvas上に直接描画するため、対象領域サイズの透過PNGオブジェクトとして
// そのままinsertImage()経由で挿入できる。

function _mangaDrawVignette(ctx, width, height, amount, color) {
    if (!amount) return;
    const rgb = _mangaHexToRgb(color);
    const cx = width / 2, cy = height / 2;
    const outerR = Math.sqrt(cx * cx + cy * cy);
    const grad = ctx.createRadialGradient(cx, cy, outerR * (1 - Math.min(1, amount)), cx, cy, outerR);
    grad.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
    grad.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},${Math.min(1, amount)})`);
    ctx.save();
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
}

// grainSize（ブロック単位、px）で粒の粗さを制御。透明ピクセルにはグレー粒をランダム不透明度で新規に置き、
// 既に不透明なピクセルにはRGBへノイズを加算する（変換モードの下地画像上でも機能する）。
function _mangaDrawScreentoneTexture(ctx, width, height, opacity, grainSize) {
    if (!opacity) return;
    const sizeScale = Math.max(width, height) / _MANGA_SIZE_REFERENCE_DIM;
    const block = Math.max(1, Math.round((grainSize || 1) * sizeScale));
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    const grain = opacity * 80;
    for (let by = 0; by < height; by += block) {
        for (let bx = 0; bx < width; bx += block) {
            const idx0 = (by * width + bx) * 4;
            const hasContent = data[idx0 + 3] > 0;
            const n = (Math.random() - 0.5) * grain;
            const placeGrain = Math.random() < opacity;
            for (let dy = 0; dy < block && by + dy < height; dy++) {
                for (let dx = 0; dx < block && bx + dx < width; dx++) {
                    const idx = ((by + dy) * width + (bx + dx)) * 4;
                    if (hasContent) {
                        data[idx]     = Math.max(0, Math.min(255, data[idx] + n));
                        data[idx + 1] = Math.max(0, Math.min(255, data[idx + 1] + n));
                        data[idx + 2] = Math.max(0, Math.min(255, data[idx + 2] + n));
                    } else if (placeGrain) {
                        const gray = Math.max(0, Math.min(255, 128 + n));
                        data[idx] = gray; data[idx + 1] = gray; data[idx + 2] = gray;
                        data[idx + 3] = Math.round((120 + Math.random() * 100) * opacity);
                    }
                }
            }
        }
    }
    ctx.putImageData(imgData, 0, 0);
}

function _mangaDrawRadialSpeedLines(ctx, width, height, density, intensity, color, centerXPercent, centerYPercent) {
    if (!density) return;
    const count = Math.round(density);
    const cx = width * ((centerXPercent ?? 50) / 100);
    const cy = height * ((centerYPercent ?? 50) / 100);
    const maxR = Math.sqrt(width * width + height * height);
    const sizeScale = Math.max(width, height) / _MANGA_SIZE_REFERENCE_DIM;
    ctx.save();
    ctx.fillStyle = color || '#000000';
    ctx.globalAlpha = Math.min(1, intensity);
    // 強度が高いほど中心の空白（集中線が始まる位置）が大きくなる。参考アプリのintensityは
    // 不透明度だけでなく中心サイズにも影響していたため、ここでもベースサイズに連動させる。
    const baseInnerR = maxR * (0.02 + Math.min(1, intensity) * 0.12);
    for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * (Math.PI * 2 / count) * 0.3;
        const innerR = baseInnerR * (0.8 + Math.random() * 0.4);
        const outerR = maxR * (0.5 + Math.random() * 0.5);
        const hwInner = (0.5 + Math.random() * 1.5) * sizeScale;
        const hwOuter = hwInner + (4 + Math.random() * 10) * sizeScale;
        const nx = Math.cos(angle), ny = Math.sin(angle);
        const px = -ny, py = nx;
        ctx.beginPath();
        ctx.moveTo(cx + nx * innerR + px * hwInner, cy + ny * innerR + py * hwInner);
        ctx.lineTo(cx + nx * innerR - px * hwInner, cy + ny * innerR - py * hwInner);
        ctx.lineTo(cx + nx * outerR - px * hwOuter, cy + ny * outerR - py * hwOuter);
        ctx.lineTo(cx + nx * outerR + px * hwOuter, cy + ny * outerR + py * hwOuter);
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();
}

function _mangaDrawLinearSpeedLines(ctx, width, height, density, intensity, color, angleDeg) {
    if (!density) return;
    const count = Math.round(density);
    const rad = ((angleDeg || 0) * Math.PI) / 180;
    const dx = Math.cos(rad), dy = Math.sin(rad);
    const px = -dy, py = dx;
    const diag = Math.sqrt(width * width + height * height);
    const cx = width / 2, cy = height / 2;
    const sizeScale = Math.max(width, height) / _MANGA_SIZE_REFERENCE_DIM;
    ctx.save();
    ctx.strokeStyle = color || '#000000';
    ctx.globalAlpha = Math.min(1, intensity);
    for (let i = 0; i < count; i++) {
        const offset = (Math.random() - 0.5) * diag;
        const len = diag * (0.3 + Math.random() * 0.7);
        const startOffset = diag / 2 - Math.random() * Math.max(0, diag - len);
        const baseX = cx + px * offset;
        const baseY = cy + py * offset;
        ctx.lineWidth = (0.5 + Math.random() * 2.5) * sizeScale;
        ctx.beginPath();
        ctx.moveTo(baseX + dx * startOffset, baseY + dy * startOffset);
        ctx.lineTo(baseX + dx * (startOffset - len), baseY + dy * (startOffset - len));
        ctx.stroke();
    }
    ctx.restore();
}

// ============================================================
// ハーフトーンモーダル（「画像」サブタブ「🎨 ハーフトーン」ボタンから起動）
// 「画像を変換」: 選択中の画像を網点画像に置換する（従来方式）
// 「パターンを作成」: 元画像を使わず、選択中のコマ/オーバーレイのサイズに
//                      ジャストフィットする網点パターンだけを新規オブジェクトとして挿入する
// ============================================================

const _MANGA_HALFTONE_MAX_DIM = 2400;
const _MANGA_PREVIEW_MAX_DIM = 400;

function _mangaHalftoneDefaultOptions() {
    return {
        mode: 'convert', // 'convert' | 'generate'
        colorMode: 'mono',
        inkColor: '#000000',
        paperColor: '#ffffff',
        shape: 'dot',
        dotSize: 8,
        angle: 45,
        dotCoverage: 1.0,
        invert: false,
        // 「画像を変換」モード専用
        brightness: 0,
        contrast: 0,
        enableBinarize: false,
        threshold: 128,
        minDarkness: 0.03,
        // 「パターンを作成」モード専用
        transparentBackground: true,
        uniformDarkness: 0.5,
        gradientEnabled: false,
        gradientType: 'linear',
        gradientAngle: 0,
        gradientStart: 0.1,
        gradientEnd: 0.9,
    };
}

function initMangaHalftoneButton() {
    document.getElementById('manga-halftone-open-btn')?.addEventListener('click', mangaHalftoneOpen);
}

async function mangaHalftoneOpen() {
    const href = _mangaGetSelectedImageHref();
    const region = _mangaGetTargetRegion();
    if (!href && !region) {
        alert(t('layout.msgSelectImageOrPanelFirst'));
        return;
    }
    let img = null;
    if (href) {
        try {
            img = await _mangaLoadImage(href);
        } catch {
            alert(t('layout.msgImageLoadFailed'));
            return;
        }
    }

    const options = _mangaHalftoneDefaultOptions();
    options.mode = img ? 'convert' : 'generate';
    // 「パターンを作成」モードのプレビュー背景ガイド（スケール確認用、生成結果には含めない）
    const backdropImg = await _mangaGetRegionBackdropImage(region);

    const overlay = document.createElement('div');
    overlay.className = 'tsm-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'tsm-dialog';
    dialog.style.width = '900px';
    dialog.style.height = '640px';
    dialog.innerHTML = `
        <div class="tsm-header">
            <h3>${t('layout.mangaHalftoneBtn')}</h3>
            <button type="button" id="mh-close-btn" class="tsm-close-btn" title="${t('common.close')}">×</button>
        </div>
        <div class="tsm-body" style="display:flex; gap:12px; padding:12px; min-height:0;">
            <div style="flex:1; min-width:0; min-height:0; display:flex; flex-direction:column; gap:6px;">
                <div class="seg-group" id="mh-preview-bg-group" style="align-self:flex-start; flex-shrink:0;">
                    <button type="button" class="seg-btn" id="mh-preview-bg-image-btn" style="display:none;">${t('layout.mangaPreviewBgImage')}</button>
                    <button type="button" class="seg-btn" id="mh-preview-bg-default-btn">${t('layout.mangaPreviewBgDefault')}</button>
                    <button type="button" class="seg-btn" id="mh-preview-bg-white-btn">${t('common.white')}</button>
                </div>
                <div id="mh-preview-wrap" style="flex:1; min-height:0; display:flex; align-items:center; justify-content:center; background:#1a1a1a; border-radius:4px; overflow:hidden;">
                    <canvas id="mh-preview-canvas"></canvas>
                </div>
            </div>
            <div style="width:280px; flex-shrink:0; min-height:0; display:flex; flex-direction:column; gap:8px; font-size:12px;">
                <div class="seg-group" id="mh-mode-group" style="flex-shrink:0;">
                    <button type="button" class="seg-btn" id="mh-mode-convert-btn">${t('layout.mangaModeConvert')}</button>
                    <button type="button" class="seg-btn" id="mh-mode-generate-btn">${t('layout.mangaModeGenerate')}</button>
                </div>
                <div id="mh-params-scroll" style="flex:1; min-height:0; overflow-y:auto; overflow-x:hidden; display:flex; flex-direction:column; gap:8px; padding-right:4px; box-sizing:border-box;">
                    <label style="display:block;">${t('layout.mangaColorMode')}
                        <select id="mh-color-mode" style="width:100%;">
                            <option value="mono">${t('layout.mangaColorModeMono')}</option>
                            <option value="duotone">${t('layout.mangaColorModeDuotone')}</option>
                        </select>
                    </label>
                    <div id="mh-duotone-colors" style="display:none; gap:10px; align-items:center;">
                        <label style="display:flex; align-items:center; gap:4px;">${t('layout.mangaInkColor')} <input type="color" id="mh-ink-color" value="#000000" /></label>
                        <label style="display:flex; align-items:center; gap:4px;">${t('layout.mangaPaperColor')} <input type="color" id="mh-paper-color" value="#ffffff" /></label>
                    </div>
                    <label style="display:block;">${t('layout.mangaShape')}
                        <select id="mh-shape" style="width:100%;">
                            <option value="dot">${t('layout.mangaShapeDot')}</option>
                            <option value="line">${t('layout.mangaShapeLine')}</option>
                            <option value="square">${t('layout.mangaShapeSquare')}</option>
                            <option value="cross">${t('layout.mangaShapeCross')}</option>
                        </select>
                    </label>
                    <label style="display:block;">${t('layout.mangaDotSize')} <span id="mh-dotsize-val">8</span>
                        <input type="range" id="mh-dotsize" min="2" max="30" value="8" style="width:100%; box-sizing:border-box;" />
                    </label>
                    <label style="display:block;">${t('layout.mangaAngle')} <span id="mh-angle-val">45°</span>
                        <input type="range" id="mh-angle" min="0" max="90" value="45" style="width:100%; box-sizing:border-box;" />
                    </label>
                    <label style="display:block;">${t('layout.mangaCoverage')} <span id="mh-coverage-val">1.00</span>
                        <input type="range" id="mh-coverage" min="0.2" max="1.5" step="0.05" value="1.0" style="width:100%; box-sizing:border-box;" />
                    </label>
                    <label style="display:block;"><input type="checkbox" id="mh-invert" /> ${t('layout.mangaInvert')}</label>

                    <div id="mh-convert-params" style="display:flex; flex-direction:column; gap:8px;">
                        <hr class="fontmgr-divider" />
                        <label style="display:block;">${t('layout.mangaBrightness')} <span id="mh-brightness-val">0</span>
                            <input type="range" id="mh-brightness" min="-100" max="100" value="0" style="width:100%; box-sizing:border-box;" />
                        </label>
                        <label style="display:block;">${t('layout.mangaContrast')} <span id="mh-contrast-val">0</span>
                            <input type="range" id="mh-contrast" min="-100" max="100" value="0" style="width:100%; box-sizing:border-box;" />
                        </label>
                        <label style="display:block;"><input type="checkbox" id="mh-binarize" /> ${t('layout.mangaBinarize')}</label>
                        <label id="mh-threshold-row" style="display:none;">${t('layout.mangaThreshold')} <span id="mh-threshold-val">128</span>
                            <input type="range" id="mh-threshold" min="0" max="255" value="128" style="width:100%; box-sizing:border-box;" />
                        </label>
                        <label style="display:block;">${t('layout.mangaMinDarkness')} <span id="mh-mindark-val">0.03</span>
                            <input type="range" id="mh-mindark" min="0" max="0.5" step="0.01" value="0.03" style="width:100%; box-sizing:border-box;" />
                        </label>
                    </div>

                    <div id="mh-generate-params" style="display:none; flex-direction:column; gap:8px;">
                        <hr class="fontmgr-divider" />
                        <label style="display:block;"><input type="checkbox" id="mh-transparent-bg" checked /> ${t('layout.mangaTransparentBg')}</label>
                        <label style="display:block;">${t('layout.mangaUniformDarkness')} <span id="mh-uniform-darkness-val">50%</span>
                            <input type="range" id="mh-uniform-darkness" min="0" max="1" step="0.01" value="0.5" style="width:100%; box-sizing:border-box;" />
                        </label>
                        <label style="display:block;"><input type="checkbox" id="mh-gradient-enable" /> ${t('layout.mangaGradientEnable')}</label>
                        <div id="mh-gradient-params" style="display:none; flex-direction:column; gap:8px;">
                            <label style="display:block;">${t('layout.mangaGradientType')}
                                <select id="mh-gradient-type" style="width:100%;">
                                    <option value="linear">${t('layout.mangaGradientTypeLinear')}</option>
                                    <option value="radial">${t('layout.mangaGradientTypeRadial')}</option>
                                </select>
                            </label>
                            <label id="mh-gradient-angle-row" style="display:block;">${t('layout.mangaGradientAngle')} <span id="mh-gradient-angle-val">0°</span>
                                <input type="range" id="mh-gradient-angle" min="0" max="360" value="0" style="width:100%; box-sizing:border-box;" />
                            </label>
                            <label style="display:block;">${t('layout.mangaGradientStart')} <span id="mh-gradient-start-val">10%</span>
                                <input type="range" id="mh-gradient-start" min="0" max="1" step="0.01" value="0.1" style="width:100%; box-sizing:border-box;" />
                            </label>
                            <label style="display:block;">${t('layout.mangaGradientEnd')} <span id="mh-gradient-end-val">90%</span>
                                <input type="range" id="mh-gradient-end" min="0" max="1" step="0.01" value="0.9" style="width:100%; box-sizing:border-box;" />
                            </label>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <div class="tsm-footer">
            <span id="mh-status" style="flex:1; font-size:11px; color:var(--text-secondary);"></span>
            <button type="button" id="mh-cancel-btn" class="btn secondary">${t('common.cancel')}</button>
            <button type="button" id="mh-apply-btn" class="btn primary">${t('common.apply')}</button>
        </div>
    `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const $ = id => dialog.querySelector('#' + id);
    const previewCanvas = $('mh-preview-canvas');
    const previewWrap = $('mh-preview-wrap');
    // 'image'（選択画像/コマ内の既存画像を背景に）| 'default'（設定中の用紙色 or チェッカーボード）| 'white'（強制白）
    // 「パターンを作成」で選択画像がある場合は、ドットサイズ等の調整に画像が必須なため既定で'image'にする。
    let previewBgMode = (options.mode === 'generate' && backdropImg) ? 'image' : 'default';

    $('mh-mode-convert-btn').disabled = !img;
    $('mh-mode-generate-btn').disabled = !region;

    let rafId = null;
    function scheduleRender() {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(renderPreview);
    }
    function readOptionsFromUI() {
        options.colorMode = $('mh-color-mode').value;
        options.inkColor = $('mh-ink-color').value;
        options.paperColor = $('mh-paper-color').value;
        options.shape = $('mh-shape').value;
        options.dotSize = parseFloat($('mh-dotsize').value);
        options.angle = parseFloat($('mh-angle').value);
        options.dotCoverage = parseFloat($('mh-coverage').value);
        options.invert = $('mh-invert').checked;
        options.brightness = parseFloat($('mh-brightness').value);
        options.contrast = parseFloat($('mh-contrast').value);
        options.enableBinarize = $('mh-binarize').checked;
        options.threshold = parseFloat($('mh-threshold').value);
        options.minDarkness = parseFloat($('mh-mindark').value);
        options.transparentBackground = $('mh-transparent-bg').checked;
        options.uniformDarkness = parseFloat($('mh-uniform-darkness').value);
        options.gradientEnabled = $('mh-gradient-enable').checked;
        options.gradientType = $('mh-gradient-type').value;
        options.gradientAngle = parseFloat($('mh-gradient-angle').value);
        options.gradientStart = parseFloat($('mh-gradient-start').value);
        options.gradientEnd = parseFloat($('mh-gradient-end').value);
    }
    function updateModeVisibility() {
        const isGenerate = options.mode === 'generate';
        $('mh-convert-params').style.display = isGenerate ? 'none' : 'flex';
        $('mh-generate-params').style.display = isGenerate ? 'flex' : 'none';
        $('mh-mode-convert-btn').classList.toggle('active', !isGenerate);
        $('mh-mode-generate-btn').classList.toggle('active', isGenerate);
        updatePreviewBgButtons();
    }
    // 「選択画像」ボタンは「パターンを作成」モードかつ背景ガイド画像がある場合のみ表示する
    // （「画像を変換」では変換対象そのものが背景になるため意味を持たない）
    function updatePreviewBgButtons() {
        const showImageBtn = options.mode === 'generate' && !!backdropImg;
        $('mh-preview-bg-image-btn').style.display = showImageBtn ? '' : 'none';
        if (!showImageBtn && previewBgMode === 'image') previewBgMode = 'default';
        $('mh-preview-bg-image-btn').classList.toggle('active', previewBgMode === 'image');
        $('mh-preview-bg-default-btn').classList.toggle('active', previewBgMode === 'default');
        $('mh-preview-bg-white-btn').classList.toggle('active', previewBgMode === 'white');
    }
    // プレビューは常にプレビュー枠いっぱいにアスペクト比を保って拡大/縮小する
    // （小さい元画像でも枠に合わせて拡大表示し、Generate patternのプレビューと大きさを揃える）
    function previewTargetSize() {
        const maxW = Math.min(1200, Math.max(50, (previewWrap.clientWidth || _MANGA_PREVIEW_MAX_DIM) - 4));
        const maxH = Math.min(1200, Math.max(50, (previewWrap.clientHeight || _MANGA_PREVIEW_MAX_DIM) - 4));
        let srcW, srcH;
        if (options.mode === 'convert' && img) {
            srcW = img.naturalWidth; srcH = img.naturalHeight;
        } else if (region) {
            srcW = region.width; srcH = region.height;
        } else {
            return { w: 200, h: 200 };
        }
        const scale = Math.min(maxW / srcW, maxH / srcH);
        return { w: Math.max(1, Math.round(srcW * scale)), h: Math.max(1, Math.round(srcH * scale)) };
    }
    function renderPreview() {
        readOptionsFromUI();
        const { w, h } = previewTargetSize();
        previewCanvas.width = w;
        previewCanvas.height = h;
        const ctx = previewCanvas.getContext('2d');
        ctx.clearRect(0, 0, w, h);
        if (options.mode === 'convert' && img) {
            // 「画像を変換」は常に不透明（用紙背景を必ず描画）。デフォルト/White切替は
            // プレビュー確認用に用紙色を一時的に上書きするだけで、適用結果には影響しない。
            const renderOptions = { ...options, transparentBackground: false, paperColor: previewBgMode === 'white' ? '#ffffff' : options.paperColor };
            const canvas = _mangaProcessImageToCanvas(img, w, h, renderOptions);
            ctx.drawImage(canvas, 0, 0);
        } else if (region) {
            if (options.transparentBackground) {
                if (previewBgMode === 'image' && backdropImg) ctx.drawImage(backdropImg, 0, 0, w, h);
                else if (previewBgMode === 'white') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
                else _mangaDrawCheckerboard(ctx, w, h);
                const canvas = _mangaGenerateHalftonePatternCanvas(w, h, options);
                ctx.drawImage(canvas, 0, 0);
            } else {
                const renderOptions = { ...options, paperColor: previewBgMode === 'white' ? '#ffffff' : options.paperColor };
                const canvas = _mangaGenerateHalftonePatternCanvas(w, h, renderOptions);
                ctx.drawImage(canvas, 0, 0);
            }
        }
    }

    const bindRange = (id, valId, fmt) => {
        const el = $(id), valEl = $(valId);
        el.addEventListener('input', () => {
            if (valEl) valEl.textContent = fmt ? fmt(el.value) : el.value;
            scheduleRender();
        });
    };
    bindRange('mh-dotsize', 'mh-dotsize-val');
    bindRange('mh-angle', 'mh-angle-val', v => v + '°');
    bindRange('mh-coverage', 'mh-coverage-val', v => parseFloat(v).toFixed(2));
    bindRange('mh-brightness', 'mh-brightness-val');
    bindRange('mh-contrast', 'mh-contrast-val');
    bindRange('mh-threshold', 'mh-threshold-val');
    bindRange('mh-mindark', 'mh-mindark-val', v => parseFloat(v).toFixed(2));
    bindRange('mh-uniform-darkness', 'mh-uniform-darkness-val', v => Math.round(v * 100) + '%');
    bindRange('mh-gradient-angle', 'mh-gradient-angle-val', v => v + '°');
    bindRange('mh-gradient-start', 'mh-gradient-start-val', v => Math.round(v * 100) + '%');
    bindRange('mh-gradient-end', 'mh-gradient-end-val', v => Math.round(v * 100) + '%');

    $('mh-mode-convert-btn').addEventListener('click', () => {
        if (!img) return;
        options.mode = 'convert';
        updateModeVisibility();
        scheduleRender();
    });
    $('mh-mode-generate-btn').addEventListener('click', () => {
        if (!region) return;
        options.mode = 'generate';
        updateModeVisibility();
        scheduleRender();
    });
    $('mh-preview-bg-image-btn').addEventListener('click', () => {
        previewBgMode = 'image';
        updatePreviewBgButtons();
        scheduleRender();
    });
    $('mh-preview-bg-default-btn').addEventListener('click', () => {
        previewBgMode = 'default';
        updatePreviewBgButtons();
        scheduleRender();
    });
    $('mh-preview-bg-white-btn').addEventListener('click', () => {
        previewBgMode = 'white';
        updatePreviewBgButtons();
        scheduleRender();
    });
    $('mh-color-mode').addEventListener('change', () => {
        $('mh-duotone-colors').style.display = $('mh-color-mode').value === 'duotone' ? 'flex' : 'none';
        scheduleRender();
    });
    $('mh-ink-color').addEventListener('input', scheduleRender);
    $('mh-paper-color').addEventListener('input', scheduleRender);
    $('mh-shape').addEventListener('change', scheduleRender);
    $('mh-invert').addEventListener('change', scheduleRender);
    $('mh-binarize').addEventListener('change', () => {
        $('mh-threshold-row').style.display = $('mh-binarize').checked ? 'block' : 'none';
        scheduleRender();
    });
    $('mh-transparent-bg').addEventListener('change', scheduleRender);
    $('mh-gradient-enable').addEventListener('change', () => {
        $('mh-gradient-params').style.display = $('mh-gradient-enable').checked ? 'flex' : 'none';
        scheduleRender();
    });
    $('mh-gradient-type').addEventListener('change', () => {
        $('mh-gradient-angle-row').style.display = $('mh-gradient-type').value === 'radial' ? 'none' : 'block';
        scheduleRender();
    });

    function close() {
        if (rafId) cancelAnimationFrame(rafId);
        overlay.remove();
    }
    $('mh-close-btn').addEventListener('click', close);
    $('mh-cancel-btn').addEventListener('click', close);
    $('mh-apply-btn').addEventListener('click', async () => {
        readOptionsFromUI();
        const statusEl = $('mh-status');
        statusEl.textContent = t('layout.processing');
        $('mh-apply-btn').disabled = true;
        await new Promise(r => setTimeout(r, 0));
        try {
            if (options.mode === 'convert') {
                if (!img) throw new Error(t('layout.msgSelectImageFirst'));
                const s = Math.min(1, _MANGA_HALFTONE_MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
                const fw = Math.max(1, Math.round(img.naturalWidth * s));
                const fh = Math.max(1, Math.round(img.naturalHeight * s));
                // 「画像を変換」は常に不透明で適用する（デフォルト/Whiteのプレビュー上書きは適用結果に影響しない）
                const applyOptions = { ...options, transparentBackground: false };
                const finalCanvas = _mangaProcessImageToCanvas(img, fw, fh, applyOptions);
                await _mangaCommitCanvasToSelectedImage(finalCanvas);
            } else {
                if (!region) throw new Error(t('layout.msgSelectPanelForImage'));
                const sz = _mangaCanvasSizeForRegion(region, _MANGA_HALFTONE_MAX_DIM);
                const finalCanvas = _mangaGenerateHalftonePatternCanvas(sz.width, sz.height, options);
                await _mangaInsertGeneratedToRegion(finalCanvas, region, {});
            }
            close();
        } catch (e) {
            statusEl.textContent = '';
            alert(t('layout.mangaApplyError', e.message));
            $('mh-apply-btn').disabled = false;
        }
    });

    updateModeVisibility();
    renderPreview();
}

// ============================================================
// マンガ効果モーダル（「マンガ」サブタブメニュー「✨ マンガ効果」ボタンから起動）
// 選択中のコマ/オーバーレイのサイズにジャストフィットする透過オブジェクトとして
// ヴィネット / スクリーントーンノイズ / 集中線 を新規生成し挿入する。
// 「マンガ」サブタブは今後複数ツールが追加される入り口のため、ハーフトーンモーダルと
// 同じ「ボタン→モーダル」形式に統一している。
// ============================================================

function _mangaEffectsDrawToCanvas(ctx, width, height, options) {
    if (options.vignetteEnabled) _mangaDrawVignette(ctx, width, height, options.vignetteAmount, options.vignetteColor);
    if (options.screentoneEnabled) _mangaDrawScreentoneTexture(ctx, width, height, options.screentoneOpacity, options.screentoneGrainSize);
    if (options.speedLineType === 'radial') {
        _mangaDrawRadialSpeedLines(ctx, width, height, options.speedLineDensity, options.speedLineIntensity, options.speedLineColor, options.speedLineCenterXPercent, options.speedLineCenterYPercent);
    } else if (options.speedLineType === 'linear') {
        _mangaDrawLinearSpeedLines(ctx, width, height, options.speedLineDensity, options.speedLineIntensity, options.speedLineColor, options.speedLineAngle);
    }
}

function initMangaEffectsButton() {
    document.getElementById('manga-effects-open-btn')?.addEventListener('click', mangaEffectsOpen);
}

async function mangaEffectsOpen() {
    const region = _mangaGetTargetRegion();
    if (!region) {
        alert(t('layout.msgSelectPanelForImage'));
        return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'tsm-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'tsm-dialog';
    dialog.style.width = '780px';
    dialog.style.height = '620px';
    dialog.innerHTML = `
        <div class="tsm-header">
            <h3>${t('layout.mangaEffectsMenuBtn')}</h3>
            <button type="button" id="me-close-btn" class="tsm-close-btn" title="${t('common.close')}">×</button>
        </div>
        <div class="tsm-body" style="display:flex; flex-direction:column; gap:10px; padding:12px; overflow:auto;">
            <span style="font-size:12px; white-space:nowrap;"><span>${t('layout.maskTargetLabel')}</span> <span id="me-target-label" style="color:var(--text-secondary);">${_mangaTargetRegionLabel(region)}</span></span>

            <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:flex-start;">
                <div style="display:flex; align-items:center; gap:4px;">
                    <label style="font-size:12px; white-space:nowrap;">${t('layout.mangaOpacity')}</label>
                    <input type="range" id="me-opacity" min="0.05" max="1" step="0.05" value="1" style="width:70px;" />
                    <span id="me-opacity-val" style="font-size:11px; min-width:32px;">100%</span>
                </div>

                <div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center; border-left:1px solid var(--border-color); padding-left:10px;">
                    <label style="font-size:12px; display:flex; align-items:center; gap:3px; white-space:nowrap;">
                        <input type="checkbox" id="me-vignette-enable" /><span>${t('layout.mangaVignette')}</span>
                    </label>
                    <label style="font-size:11px; white-space:nowrap;">${t('layout.mangaSpeedLineIntensity')}</label>
                    <input type="range" id="me-vignette-amount" min="0" max="1" step="0.05" value="0.4" style="width:60px;" />
                    <input type="color" id="me-vignette-color" value="#000000" />
                </div>

                <div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center; border-left:1px solid var(--border-color); padding-left:10px;">
                    <label style="font-size:12px; display:flex; align-items:center; gap:3px; white-space:nowrap;">
                        <input type="checkbox" id="me-screentone-enable" /><span>${t('layout.mangaScreentone')}</span>
                    </label>
                    <label style="font-size:11px; white-space:nowrap;">${t('layout.mangaSpeedLineIntensity')}</label>
                    <input type="range" id="me-screentone-opacity" min="0" max="1" step="0.05" value="0.3" style="width:60px;" />
                    <label style="font-size:11px; white-space:nowrap;">${t('layout.mangaGrainSize')}</label>
                    <input type="range" id="me-screentone-grain" min="1" max="8" step="1" value="1" style="width:50px;" />
                </div>

                <div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center; border-left:1px solid var(--border-color); padding-left:10px;">
                    <label style="font-size:12px; white-space:nowrap;">${t('layout.mangaSpeedLine')}</label>
                    <select id="me-speedline-type" style="font-size:12px;">
                        <option value="none">${t('layout.mangaSpeedLineNone')}</option>
                        <option value="radial">${t('layout.mangaSpeedLineRadial')}</option>
                        <option value="linear">${t('layout.mangaSpeedLineLinear')}</option>
                    </select>
                    <label style="font-size:11px; white-space:nowrap;">${t('layout.mangaSpeedLineDensity')}</label>
                    <input type="range" id="me-speedline-density" min="4" max="120" step="1" value="40" style="width:55px;" />
                    <label style="font-size:11px; white-space:nowrap;">${t('layout.mangaSpeedLineIntensity')}</label>
                    <input type="range" id="me-speedline-intensity" min="0.1" max="1" step="0.05" value="0.7" style="width:55px;" />
                    <input type="color" id="me-speedline-color" value="#000000" />
                    <span id="me-speedline-center-row" style="display:flex; align-items:center; gap:4px;">
                        <label style="font-size:11px; white-space:nowrap;">${t('layout.mangaSpeedLineCenterX')}</label>
                        <input type="range" id="me-speedline-centerx" min="0" max="100" step="1" value="50" style="width:45px;" />
                        <label style="font-size:11px; white-space:nowrap;">${t('layout.mangaSpeedLineCenterY')}</label>
                        <input type="range" id="me-speedline-centery" min="0" max="100" step="1" value="50" style="width:45px;" />
                    </span>
                    <span id="me-speedline-angle-row" style="display:none; align-items:center; gap:4px;">
                        <label style="font-size:11px; white-space:nowrap;">${t('layout.mangaSpeedLineAngle')}</label>
                        <input type="range" id="me-speedline-angle" min="0" max="360" step="1" value="0" style="width:55px;" />
                    </span>
                </div>
            </div>

            <div style="flex:1; min-height:0; display:flex; align-items:center; justify-content:center; background:#1a1a1a; border-radius:4px;">
                <canvas id="me-preview-canvas" style="max-width:100%; max-height:100%;"></canvas>
            </div>
        </div>
        <div class="tsm-footer">
            <span id="me-status" style="flex:1; font-size:11px; color:var(--text-secondary);"></span>
            <button type="button" id="me-cancel-btn" class="btn secondary">${t('common.cancel')}</button>
            <button type="button" id="me-apply-btn" class="btn primary">${t('layout.mangaEffectsApplyBtn')}</button>
        </div>
    `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const $ = id => dialog.querySelector('#' + id);
    const previewCanvas = $('me-preview-canvas');

    let rafId = null;
    function scheduleRender() {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(renderPreview);
    }
    function readOptions() {
        return {
            opacity: parseFloat($('me-opacity').value),
            vignetteEnabled: $('me-vignette-enable').checked,
            vignetteAmount: parseFloat($('me-vignette-amount').value),
            vignetteColor: $('me-vignette-color').value,
            screentoneEnabled: $('me-screentone-enable').checked,
            screentoneOpacity: parseFloat($('me-screentone-opacity').value),
            screentoneGrainSize: parseFloat($('me-screentone-grain').value),
            speedLineType: $('me-speedline-type').value,
            speedLineDensity: parseFloat($('me-speedline-density').value),
            speedLineIntensity: parseFloat($('me-speedline-intensity').value),
            speedLineColor: $('me-speedline-color').value,
            speedLineCenterXPercent: parseFloat($('me-speedline-centerx').value),
            speedLineCenterYPercent: parseFloat($('me-speedline-centery').value),
            speedLineAngle: parseFloat($('me-speedline-angle').value),
        };
    }
    function updateSpeedLineParamVisibility() {
        const type = $('me-speedline-type').value;
        $('me-speedline-center-row').style.display = type === 'radial' ? 'flex' : 'none';
        $('me-speedline-angle-row').style.display = type === 'linear' ? 'flex' : 'none';
    }
    function renderPreview() {
        const sz = _mangaCanvasSizeForRegion(region, _MANGA_PREVIEW_MAX_DIM, 150);
        previewCanvas.width = sz.width;
        previewCanvas.height = sz.height;
        const ctx = previewCanvas.getContext('2d');
        ctx.clearRect(0, 0, sz.width, sz.height);
        _mangaDrawCheckerboard(ctx, sz.width, sz.height);
        _mangaEffectsDrawToCanvas(ctx, sz.width, sz.height, readOptions());
    }

    const inputIds = [
        'me-opacity',
        'me-vignette-enable', 'me-vignette-amount', 'me-vignette-color',
        'me-screentone-enable', 'me-screentone-opacity', 'me-screentone-grain',
        'me-speedline-type', 'me-speedline-density', 'me-speedline-intensity', 'me-speedline-color',
        'me-speedline-centerx', 'me-speedline-centery', 'me-speedline-angle',
    ];
    inputIds.forEach(id => {
        const el = $(id);
        const evt = (el.type === 'checkbox' || el.tagName === 'SELECT' || el.type === 'color') ? 'change' : 'input';
        el.addEventListener(evt, () => {
            const valEl = $(id + '-val');
            if (valEl) valEl.textContent = el.value;
            if (id === 'me-opacity') valEl && (valEl.textContent = Math.round(el.value * 100) + '%');
            if (id === 'me-speedline-type') updateSpeedLineParamVisibility();
            scheduleRender();
        });
    });

    function close() {
        if (rafId) cancelAnimationFrame(rafId);
        overlay.remove();
    }
    $('me-close-btn').addEventListener('click', close);
    $('me-cancel-btn').addEventListener('click', close);
    $('me-apply-btn').addEventListener('click', async () => {
        const statusEl = $('me-status');
        statusEl.textContent = t('layout.processing');
        $('me-apply-btn').disabled = true;
        await new Promise(r => setTimeout(r, 0));
        try {
            const sz = _mangaCanvasSizeForRegion(region, _MANGA_HALFTONE_MAX_DIM);
            const canvas = document.createElement('canvas');
            canvas.width = sz.width;
            canvas.height = sz.height;
            const ctx = canvas.getContext('2d');
            const options = readOptions();
            _mangaEffectsDrawToCanvas(ctx, sz.width, sz.height, options);
            await _mangaInsertGeneratedToRegion(canvas, region, { opacity: options.opacity });
            close();
        } catch (e) {
            statusEl.textContent = '';
            alert(t('layout.mangaApplyError', e.message));
            $('me-apply-btn').disabled = false;
        }
    });

    updateSpeedLineParamVisibility();
    renderPreview();
}
