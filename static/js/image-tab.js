/**
 * Image Tab
 * Canvas-based image editor with object-based layer support.
 * Ported from ComfyUI-Workflow-Studio's Image Edit tab, including the
 * Mask Editor One compatible extensions (Color/Alpha/Text/Vector/Shape
 * mask subtools, SAM3 segmentation, ABR brush picker). SAM3 and ABR
 * brush features require backend routes (/mask_editor/*) that do not
 * exist on comic-creator, so their UI is present but stays disabled.
 */

import { LayerManager, Layer } from "./image-tab/LayerManager.js";
import { DrawTool }            from "./image-tab/DrawTool.js";
import { TextTool, layoutVerticalText, drawVerticalCells } from "./image-tab/TextTool.js";
import { SelectTool }          from "./image-tab/SelectTool.js";
import { ShapeTool }           from "./image-tab/ShapeTool.js";
import { FillTool }            from "./image-tab/FillTool.js";
import { MaskTool }            from "./image-tab/MaskTool.js";
import { MaskColorTool, MaskAlphaTool, MaskTextTool, MaskVectorTool, MaskShapeTool, MASK_TEXT_FONTS }
                                from "./image-tab/MaskEditorOneTools.js";

const TOOL_DEFS = [
    { id: "select",   icon: "▲",  label: "Select",    ready: true },
    { id: "draw",     icon: "✏",  label: "Draw",      ready: true },
    { id: "text",     icon: "T",   label: "Text",      ready: true },
    { id: "shape",    icon: "□",   label: "Shape",     ready: true },
    { id: "fill",     icon: "🪣",  label: "Fill",      ready: true },
    { id: "mask",     icon: "🎭",  label: "Mask",      ready: true },
    { id: "blur",     icon: "≈",   label: "Blur",      ready: true },
    { id: "filter",   icon: "★",   label: "Filter",    ready: true },
    { id: "bgremove", icon: "⬚",   label: "BG Remove", ready: true },
    { id: "upscale",  icon: "⤢",   label: "Upscale",   ready: true },
];

// Draw Tool: スポイト（Eyedropper）アイコン。ボタンとカスタムカーソルの両方で使い回す。
const EYEDROPPER_ICON_PATH = "M20.71 5.63l-2.34-2.34a1 1 0 0 0-1.41 0L14.7 5.55 12 8.24 3 17.24V21h3.76l9-9 2.69-2.69 2.26-2.26a1 1 0 0 0 0-1.41zM6.34 19H5v-1.34l8.06-8.06 1.41 1.41L6.34 19z";
const EYEDROPPER_ICON_SVG =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="${EYEDROPPER_ICON_PATH}"/></svg>`;

function _eyedropperCursorCss() {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>`
        + `<path d='${EYEDROPPER_ICON_PATH}' fill='%23ffffff' stroke='%23000000' stroke-width='1'/></svg>`;
    return `url("data:image/svg+xml,${svg}") 2 22, crosshair`;
}

function _applyMosaicToRegion(ctx, x, y, w, h, size) {
    if (w <= 0 || h <= 0 || size < 1) return;
    const imgData = ctx.getImageData(x, y, w, h);
    const d = imgData.data;
    for (let py = 0; py < h; py += size) {
        for (let px = 0; px < w; px += size) {
            const i = (py * w + px) * 4;
            const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
            for (let by = py; by < Math.min(py + size, h); by++) {
                for (let bx = px; bx < Math.min(px + size, w); bx++) {
                    const j = (by * w + bx) * 4;
                    d[j] = r; d[j + 1] = g; d[j + 2] = b; d[j + 3] = a;
                }
            }
        }
    }
    ctx.putImageData(imgData, x, y);
}

const UNDO_LIMIT = 20;

// 調整レイヤーの定義（type → { label, defaultValue, min, max, step }）
// 画像編集タブ(imgedit)の調整レイヤーシステムを移植したもの。
const ADJ_DEFS = {
    brightness:  { label: t("image.adjBrightness"),  defaultValue: 0, min: -100, max: 100, step: 1   },
    contrast:    { label: t("image.adjContrast"),    defaultValue: 0, min: -100, max: 100, step: 1   },
    saturation:  { label: t("image.adjSaturation"),  defaultValue: 0, min: -100, max: 100, step: 1   },
    hue:         { label: t("image.adjHue"),         defaultValue: 0, min: -180, max: 180, step: 1   },
    blur:        { label: t("image.adjBlur"),        defaultValue: 0, min: 0,    max: 30,  step: 0.5 },
    sharpen:     { label: t("image.adjSharpen"),     defaultValue: 0, min: 0,    max: 100, step: 1   },
    noise:       { label: t("image.adjNoise"),       defaultValue: 0, min: 0,    max: 100, step: 1   },
    sepia:       { label: t("image.adjSepia"),       defaultValue: 0, min: 0,    max: 100, step: 1   },
    grayscale:   { label: t("image.adjGrayscale"),   defaultValue: 0, min: 0,    max: 100, step: 1   },
    invert:      { label: t("image.adjInvert"),      defaultValue: 0, min: 0,    max: 100, step: 1   },
    temperature: { label: t("image.adjTemperature"), defaultValue: 0, min: -100, max: 100, step: 1   },
    vignette:    { label: t("image.adjVignette"),    defaultValue: 0, min: 0,    max: 100, step: 1   },
};

function fitToCanvas(imgW, imgH, canvasW, canvasH) {
    const scale = Math.min(1, canvasW / imgW, canvasH / imgH);
    return { w: Math.round(imgW * scale), h: Math.round(imgH * scale) };
}

// ── HSL変換ヘルパー（hue調整用） ──────────────

function _rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return [h, s, l];
}

function _hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1; if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// ── 調整レイヤー フィルタ実装（imgeditタブから移植） ──

function _applyPixelAdj(ctx, w, h, type, value) {
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    const n = d.length;

    for (let i = 0; i < n; i += 4) {
        let r = d[i], g = d[i + 1], b = d[i + 2];

        if (type === "brightness") {
            const v = value * 2.55;
            r = Math.min(255, Math.max(0, r + v));
            g = Math.min(255, Math.max(0, g + v));
            b = Math.min(255, Math.max(0, b + v));
        } else if (type === "contrast") {
            const f = (259 * (value + 255)) / (255 * (259 - value));
            r = Math.min(255, Math.max(0, f * (r - 128) + 128));
            g = Math.min(255, Math.max(0, f * (g - 128) + 128));
            b = Math.min(255, Math.max(0, f * (b - 128) + 128));
        } else if (type === "saturation") {
            const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            const s = 1 + value / 100;
            r = Math.min(255, Math.max(0, gray + (r - gray) * s));
            g = Math.min(255, Math.max(0, gray + (g - gray) * s));
            b = Math.min(255, Math.max(0, gray + (b - gray) * s));
        } else if (type === "hue") {
            const [h2, s2, l2] = _rgbToHsl(r, g, b);
            const [nr, ng, nb] = _hslToRgb((h2 + value / 360 + 1) % 1, s2, l2);
            r = nr; g = ng; b = nb;
        } else if (type === "sepia") {
            const t = value / 100;
            const nr = Math.min(255, r * (1 - 0.607 * t) + g * 0.769 * t + b * 0.189 * t);
            const ng = Math.min(255, r * 0.349 * t       + g * (1 - 0.314 * t) + b * 0.168 * t);
            const nb = Math.min(255, r * 0.272 * t       + g * 0.534 * t       + b * (1 - 0.869 * t));
            r = nr; g = ng; b = nb;
        } else if (type === "grayscale") {
            const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            const t = value / 100;
            r = r + (gray - r) * t;
            g = g + (gray - g) * t;
            b = b + (gray - b) * t;
        } else if (type === "invert") {
            const t = value / 100;
            r = r + (255 - r - r) * t;
            g = g + (255 - g - g) * t;
            b = b + (255 - b - b) * t;
        } else if (type === "temperature") {
            const v = value * 1.5;
            r = Math.min(255, Math.max(0, r + v));
            b = Math.min(255, Math.max(0, b - v));
        }

        d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
    ctx.putImageData(imgData, 0, 0);
}

function _applyBlurFilter(ctx, w, h, radius) {
    if (radius <= 0) return;
    const tmp = document.createElement("canvas");
    tmp.width = w; tmp.height = h;
    const tc = tmp.getContext("2d");
    tc.filter = `blur(${radius}px)`;
    tc.drawImage(ctx.canvas, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(tmp, 0, 0);
}

function _applySharpenFilter(ctx, w, h, amount) {
    if (amount <= 0) return;
    const blurCanvas = document.createElement("canvas");
    blurCanvas.width = w; blurCanvas.height = h;
    const bc = blurCanvas.getContext("2d");
    bc.filter = "blur(1px)";
    bc.drawImage(ctx.canvas, 0, 0);

    const orig = ctx.getImageData(0, 0, w, h);
    const blurred = bc.getImageData(0, 0, w, h);
    const d = orig.data, bd = blurred.data;
    const str = amount / 100 * 2;
    for (let i = 0; i < d.length; i += 4) {
        d[i]     = Math.min(255, Math.max(0, d[i]     + (d[i]     - bd[i])     * str));
        d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + (d[i + 1] - bd[i + 1]) * str));
        d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + (d[i + 2] - bd[i + 2]) * str));
    }
    ctx.putImageData(orig, 0, 0);
}

function _applyNoiseFilter(ctx, w, h, amount) {
    if (amount <= 0) return;
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    const str = amount * 1.5;
    for (let i = 0; i < d.length; i += 4) {
        const n = (Math.random() - 0.5) * str;
        d[i]     = Math.min(255, Math.max(0, d[i]     + n));
        d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + n));
        d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + n));
    }
    ctx.putImageData(imgData, 0, 0);
}

function _applyVignette(ctx, w, h, amount) {
    if (amount <= 0) return;
    const gradient = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.8);
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(1, `rgba(0,0,0,${amount / 100 * 0.85})`);
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
}

// ── アップスケール（imgeditタブの実行パイプラインを移植） ──

function _procApplyDenoise(imageData, w, h) {
    const src = imageData.data;
    const out = new Uint8ClampedArray(src.length);
    const radius = 2;
    const sigma  = 30;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let rSum = 0, gSum = 0, bSum = 0, wSum = 0;
            const ci = (y * w + x) * 4;
            const cr = src[ci], cg = src[ci + 1], cb = src[ci + 2];
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    const nx = x + dx, ny = y + dy;
                    if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
                    const ni = (ny * w + nx) * 4;
                    const nr = src[ni], ng = src[ni + 1], nb = src[ni + 2];
                    const spatialW = Math.exp(-(dx * dx + dy * dy) / (2 * radius * radius));
                    const colorD   = (nr - cr) ** 2 + (ng - cg) ** 2 + (nb - cb) ** 2;
                    const colorW   = Math.exp(-colorD / (2 * sigma * sigma));
                    const w2 = spatialW * colorW;
                    rSum += nr * w2; gSum += ng * w2; bSum += nb * w2; wSum += w2;
                }
            }
            const oi = (y * w + x) * 4;
            out[oi]     = rSum / wSum;
            out[oi + 1] = gSum / wSum;
            out[oi + 2] = bSum / wSum;
            out[oi + 3] = src[oi + 3];
        }
    }
    return new ImageData(out, w, h);
}

function _procApplySharpen(imageData, w, h, amount) {
    const src = imageData.data;
    const out = new Uint8ClampedArray(src.length);
    const kernel = [-1, -1, -1, -1, 9, -1, -1, -1, -1];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let r = 0, g = 0, b = 0;
            for (let ky = -1; ky <= 1; ky++) {
                for (let kx = -1; kx <= 1; kx++) {
                    const nx = Math.max(0, Math.min(w - 1, x + kx));
                    const ny = Math.max(0, Math.min(h - 1, y + ky));
                    const ni = (ny * w + nx) * 4;
                    const k  = kernel[(ky + 1) * 3 + (kx + 1)];
                    r += src[ni] * k;
                    g += src[ni + 1] * k;
                    b += src[ni + 2] * k;
                }
            }
            const oi = (y * w + x) * 4;
            const sr = src[oi], sg = src[oi + 1], sb = src[oi + 2];
            out[oi]     = Math.max(0, Math.min(255, sr + (r - sr) * amount));
            out[oi + 1] = Math.max(0, Math.min(255, sg + (g - sg) * amount));
            out[oi + 2] = Math.max(0, Math.min(255, sb + (b - sb) * amount));
            out[oi + 3] = src[oi + 3];
        }
    }
    return new ImageData(out, w, h);
}

function _procUpscale(dataUrl, scale, denoise, sharpenRatio) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const w = img.width;
            const h = img.height;

            const srcCanvas = document.createElement("canvas");
            srcCanvas.width = w;
            srcCanvas.height = h;
            const srcCtx = srcCanvas.getContext("2d");
            srcCtx.drawImage(img, 0, 0);

            let srcData = srcCtx.getImageData(0, 0, w, h);

            if (denoise) {
                srcData = _procApplyDenoise(srcData, w, h);
                srcCtx.putImageData(srcData, 0, 0);
            }

            const dstW = Math.round(w * scale);
            const dstH = Math.round(h * scale);
            const dstCanvas = document.createElement("canvas");
            dstCanvas.width  = dstW;
            dstCanvas.height = dstH;
            const dstCtx = dstCanvas.getContext("2d");
            dstCtx.imageSmoothingEnabled = true;
            dstCtx.imageSmoothingQuality = "high";
            dstCtx.drawImage(srcCanvas, 0, 0, dstW, dstH);

            if (sharpenRatio > 0) {
                const sharpData = _procApplySharpen(dstCtx.getImageData(0, 0, dstW, dstH), dstW, dstH, sharpenRatio);
                dstCtx.putImageData(sharpData, 0, 0);
            }

            resolve(dstCanvas.toDataURL("image/png"));
        };
        img.onerror = reject;
        img.src = dataUrl;
    });
}

class ImageTab {
    constructor() {
        this._layerMgr      = null;
        this._activeTool    = "select";
        this._drawTool      = new DrawTool(null);
        this._eyedropperActive = false; // Drawツールのスポイト（色抽出）モード
        this._textTool      = new TextTool(null);
        // Textツールのフォント選択（レイアウトタブと同様のGoogle/システム/カテゴリ切替）
        this._textFontSource  = "google";  // 'google' | 'system' | 'favorites'
        this._textFontFavCat  = "";        // カテゴリ絞り込み（空=すべて）
        this._systemFontsCache = null;     // queryLocalFonts() の結果キャッシュ
        this._selectTool    = new SelectTool();
        this._selectedLayerIds = new Set(); // レイヤーパネルでShift+クリックにより複数選択されたレイヤーID群
        this._zoom          = 1.0;
        this._panOffset     = { x: 0, y: 0 };
        this._canvasW       = 512;
        this._canvasH       = 512;
        this._baseName      = "image";
        this._undoStack     = [];
        this._redoStack     = [];
        this._panning       = false;
        this._panStart      = null;
        this._spaceDown     = false;
        this._compositeMode    = false;
        this._editingTextLayer = null;
        this._initialized      = false;
        this._shapeTool        = new ShapeTool();
        this._shapeSameLayer   = true; // true: 描画済みのシェイプレイヤーに追記し続ける（デフォルト） / false: 描画のたびに新規レイヤー
        this._shapeLayerId     = null; // Same Layerモードで使い続けるレイヤーのID
        this._mychainAssets    = [];   // My Curve用: assets/mychain フォルダの画像一覧
        // Mask ツール
        this._maskTool         = null;
        this._maskSubtool      = "paint";
        this._maskInverted     = false;
        this._maskOverlayColor = "#ff0000";
        this._maskBlur         = 0;
        this._toastTimer       = null;
        // Mask Editor One 追加ツール
        this._maskColorTool  = null;
        this._maskAlphaTool  = null;
        this._maskTextTool   = null;
        this._maskVectorTool = null;
        this._maskShapeTool  = null;
        // Blur ツール
        this._blurRectMode  = null;   // null | 'blur' | 'mosaic'
        this._blurDragging  = false;
        this._blurDragStart = null;
        this._blurDragCur   = null;
        // G'MIC ツール状態
        this._gmicState = {
            lastResultJobId: null,
            processing: false,
            aborted: false,
        };
        // BiRefNet 利用可否（comic-creator側に対応ルートが無い場合は常にfalse）
        this._birefnetAvailable = false;
        // Mask Editor One SAM3 状態（comic-creator側に対応ルートが無い場合は常にfalse）
        this._sam3Available = false;
        this._sam3Results   = [];   // [{mask_b64, score, area}, ...]
        this._sam3Prompt    = "";
        this._sam3MaxMasks  = 9;
        this._sam3Loading   = false;
        this._sam3Mode      = "add";        // "add" | "erase"
        this._sam3Selected  = new Set();    // 選択中の結果インデックス
        // ABR brush（comic-creator側に対応ルートが無い場合は常にfalse）
        this._abrAvailable = false;
        this._abrBrushTree = [];
        // 全レイヤーに掛かる全体不透明度（imgeditタブの調整レイヤーパネルから移植）
        this._globalOpacity = 1.0;
        // レイアウトタブから開いた場合の書き戻し先SVG <image> 要素（Upload/Newで開始した場合はnull）
        this._sourceImageEl = null;
    }

    // ── 初期化 ────────────────────────────────────

    init() {
        if (this._initialized) return;
        this._initialized = true;
        this._setupToolButtons();
        this._setupActionBar();
        this._setupCanvasEvents();
        this._setupLayerPanel();
        this._setupKeyboard();
        this._initBrushCursor();
        this._checkBiRefNetAvailability();
        this._checkSam3Availability();
        this._checkAbrAvailability();
        this._loadMychainAssets();
    }

    /** My Curve用: assets/mychain フォルダの画像一覧を取得 */
    async _loadMychainAssets() {
        try {
            const resp = await fetch("/ccc_assets/assets.json");
            if (!resp.ok) return;
            const data = await resp.json();
            const folder = (data.folders || []).find(f => f.name === "mychain");
            this._mychainAssets = folder?.assets ?? [];
        } catch {
            this._mychainAssets = [];
        }
        if (this._activeTool === "shape") this._renderToolOptions("shape");
    }

    // ── Textツール: フォントソース（Google/システム/カテゴリ） ──────────

    /** フォント管理タブのカテゴリ一覧（localStorageを直接参照、main.js側の状態には依存しない） */
    _getFavoriteCategories() {
        let favs = {};
        try { favs = JSON.parse(localStorage.getItem("fontmgr_favorites") || "{}"); } catch { favs = {}; }
        return Object.keys(favs);
    }

    /** カテゴリ名の表示ラベル（予約カテゴリ「お気に入り」はmain.js側のi18nラベルへ変換、それ以外はそのまま） */
    _fontCatLabel(cat) {
        return typeof window._fontMgrCatLabel === "function" ? window._fontMgrCatLabel(cat) : cat;
    }

    /** カテゴリ（空文字なら全カテゴリ）に属するフォント一覧 */
    _getFavoriteFontFamilies(cat) {
        let favs = {};
        try { favs = JSON.parse(localStorage.getItem("fontmgr_favorites") || "{}"); } catch { favs = {}; }
        if (!cat) {
            const all = new Set();
            Object.values(favs).forEach(arr => (arr || []).forEach(f => all.add(f)));
            return [...all].sort((a, b) => a.localeCompare(b));
        }
        return [...(favs[cat] || [])].sort((a, b) => a.localeCompare(b));
    }

    /** システムフォント一覧（Local Font Access API、結果はキャッシュ） */
    async _getSystemFontFamiliesCached() {
        if (this._systemFontsCache) return this._systemFontsCache;
        if (!window.queryLocalFonts) { this._systemFontsCache = []; return []; }
        try {
            const fonts = await window.queryLocalFonts();
            this._systemFontsCache = [...new Set(fonts.map(f => f.family))].sort((a, b) => a.localeCompare(b));
        } catch {
            this._systemFontsCache = [];
        }
        return this._systemFontsCache;
    }

    /** 現在の _textFontSource に応じたフォント一覧を返す */
    async _getTextFontFamilies() {
        if (this._textFontSource === "google") {
            // main.js（レイアウトタブ）の _fontMgrGoogleList() を再利用（function宣言なので window 経由で呼べる）
            return typeof window._fontMgrGoogleList === "function" ? window._fontMgrGoogleList() : [];
        }
        if (this._textFontSource === "favorites") {
            return this._getFavoriteFontFamilies(this._textFontFavCat);
        }
        return await this._getSystemFontFamiliesCached();
    }

    /** #ie-text-font の options を現在のソース/カテゴリで再構築する */
    async _populateTextFontSelect() {
        const families = await this._getTextFontFamilies();
        const sel = document.getElementById("ie-text-font");
        if (!sel) return; // 取得中にツールが切り替わっていた場合
        const selLayer = this.hasSelectedTextLayer() ? this._selectTool.getSelectedLayer() : null;
        const current = selLayer ? selLayer.textProps.fontFamily : this._textTool.fontFamily;
        if (families.length === 0) {
            sel.innerHTML = `<option value="${current}">${t("image.fontListEmpty", current)}</option>`;
            return;
        }
        const list = families.includes(current) ? families : [current, ...families];
        sel.innerHTML = list.map(f => `<option value="${f}" ${f === current ? "selected" : ""}>${f}</option>`).join("");
    }

    async _checkBiRefNetAvailability() {
        try {
            const resp = await fetch("/mask_editor/birefnet/status");
            if (!resp.ok) return;
            const json = await resp.json();
            this._birefnetAvailable = json.loaded === true || json.model_found === true;
        } catch {
            this._birefnetAvailable = false;
        }
    }

    async _checkSam3Availability() {
        try {
            const resp = await fetch("/mask_editor/sam3/status");
            if (!resp.ok) return;
            const json = await resp.json();
            this._sam3Available = json.loaded === true || json.ckpt_found === true;
        } catch {
            this._sam3Available = false;
        }
    }

    async _checkAbrAvailability() {
        try {
            const resp = await fetch("/mask_editor/brushes/list");
            if (!resp.ok) return;
            const json = await resp.json();
            this._abrBrushTree = json.tree || [];
            this._abrAvailable = this._abrBrushTree.length > 0;
        } catch {
            this._abrAvailable = false;
        }
    }

    // ── トースト通知 ──────────────────────────────

    _toast(message, type = "info", duration = 2500) {
        const el = document.getElementById("ie-toast");
        if (!el) return;
        clearTimeout(this._toastTimer);
        el.textContent = message;
        el.className = "ie-toast" + (type === "success" || type === "error" ? ` ${type}` : "");
        el.style.display = "block";
        el.style.opacity = "1";
        this._toastTimer = setTimeout(() => {
            el.style.opacity = "0";
            setTimeout(() => { el.style.display = "none"; }, 300);
        }, duration);
    }

    // ── ブラシカーソル ────────────────────────────

    _initBrushCursor() {
        const el = document.createElement("div");
        el.id = "ie-brush-cursor";
        Object.assign(el.style, {
            position:      "fixed",
            pointerEvents: "none",
            border:        "1.5px solid rgba(255,255,255,0.85)",
            boxShadow:     "0 0 0 1px rgba(0,0,0,0.6)",
            borderRadius:  "50%",
            display:       "none",
            transform:     "translate(-50%,-50%)",
            zIndex:        "99999",
        });
        document.body.appendChild(el);
        this._brushCursorEl = el;
    }

    _updateBrushCursor(e) {
        const el = this._brushCursorEl;
        if (!el) return;
        const tool = this._activeTool;
        const size = tool === "draw" ? this._drawTool?.brushSize
            : (tool === "mask" && this._maskSubtool === "paint") ? this._maskTool?.brushSize : null;
        if (size == null) { el.style.display = "none"; return; }

        const refCanvas = document.getElementById("ie-canvas-draw");
        if (!refCanvas) { el.style.display = "none"; return; }
        const rect = refCanvas.getBoundingClientRect();
        // Image タブ非表示時（width=0）はカーソルを消す
        if (rect.width === 0 || rect.height === 0) { el.style.display = "none"; return; }
        // キャンバス外は通常カーソルを表示
        if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
            el.style.display = "none";
            return;
        }
        const scale = rect.width / refCanvas.width;
        const px    = Math.max(2, size * scale);

        el.style.width   = px + "px";
        el.style.height  = px + "px";
        el.style.left    = e.clientX + "px";
        el.style.top     = e.clientY + "px";
        el.style.display = "block";
    }

    _hideBrushCursor() {
        if (this._brushCursorEl) this._brushCursorEl.style.display = "none";
    }

    // ── Draw: スポイト（Eyedropper） ─────────────────

    _setEyedropperActive(active) {
        this._eyedropperActive = active;
        const drawCanvas = document.getElementById("ie-canvas-draw");
        const overlay    = document.getElementById("ie-canvas-overlay");
        const cursor = active ? _eyedropperCursorCss() : "";
        if (drawCanvas) drawCanvas.style.cursor = cursor;
        if (overlay)    overlay.style.cursor    = cursor;
        if (active) this._hideBrushCursor();
        document.getElementById("ie-draw-eyedropper")?.classList.toggle("ie-opt-active", active);
    }

    _pickColorAt(x, y) {
        const canvas = document.getElementById("ie-canvas-draw");
        const px = Math.floor(x), py = Math.floor(y);
        if (!canvas || px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) {
            this._setEyedropperActive(false);
            return;
        }
        try {
            const [r, g, b] = canvas.getContext("2d").getImageData(px, py, 1, 1).data;
            const hex = "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
            this._drawTool.color     = hex;
            this._drawTool._stamp    = null;
            this._drawTool._imgStamp = null;
        } catch {
            this._toast("Could not read pixel color", "error");
        }
        this._setEyedropperActive(false);
        if (this._activeTool === "draw") this._renderDrawProps();
    }

    // ── ツールボタン ──────────────────────────────

    _setupToolButtons() {
        document.querySelectorAll(".ie-tool-btn[data-tool]").forEach(btn => {
            btn.addEventListener("click", () => {
                const def = TOOL_DEFS.find(d => d.id === btn.dataset.tool);
                if (!def?.ready) { this._toast(`${def?.label ?? btn.dataset.tool}: coming soon`, "info"); return; }
                this._setActiveTool(btn.dataset.tool);
            });
        });
    }

    _setActiveTool(toolId) {
        this._hideBrushCursor();
        if (this._eyedropperActive) this._setEyedropperActive(false);
        if (this._activeTool === "draw")   this._drawTool?.deactivate();
        if (this._activeTool === "text")   this._textTool?.deactivate();
        if (this._activeTool === "select") this._selectTool?.deactivate();
        if (this._activeTool === "shape")  this._shapeTool?.deactivate();
        if (this._activeTool === "fill") {
            this._fillTool?.deactivate();
            const overlay = document.getElementById("ie-canvas-overlay");
            if (overlay) overlay.style.cursor = "";
        }
        if (this._activeTool === "mask")   this._deactivateMaskSubtool();
        if (this._activeTool === "filter") this._gmicAbort();
        if (this._activeTool === "blur") {
            this._blurRectMode = null;
            this._blurDragging = false;
            const overlay = document.getElementById("ie-canvas-overlay");
            if (overlay) {
                overlay.style.cursor = "";
                overlay.getContext("2d").clearRect(0, 0, overlay.width, overlay.height);
            }
        }
        // Draw/Mask/Fill以外に切り替えたらプロパティペインを非表示
        if (toolId !== "mask" && toolId !== "draw" && toolId !== "fill") {
            const pane = document.getElementById("ie-props-pane");
            if (pane) pane.style.display = "none";
        }

        this._activeTool = toolId;

        document.querySelectorAll(".ie-tool-btn").forEach(btn =>
            btn.classList.toggle("active", btn.dataset.tool === toolId));

        this._renderToolOptions(toolId);
        this._activateCurrentTool();
    }

    _activateCurrentTool() {
        const drawCanvas    = document.getElementById("ie-canvas-draw");
        const overlayCanvas = document.getElementById("ie-canvas-overlay");
        if (!drawCanvas || !this._layerMgr) return;

        if (this._activeTool === "draw" && this._drawTool) {
            const activeLayer = this._layerMgr?.activeLayer;
            if (activeLayer) this._drawTool.setCanvas(activeLayer.canvas);
            this._drawTool.activate();
        } else if (this._activeTool === "text" && this._textTool) {
            this._textTool.setCanvas(drawCanvas);
            this._textTool.activate();
            // アクティブレイヤーがテキストならツール切替時点でも選択枠を出しておく
            // （どのレイヤーがスタイルモーダル等の対象になるか一目で分かるように）
            const activeLayer = this._layerMgr?.activeLayer;
            if (activeLayer && activeLayer.type === "text") {
                this._selectTool?.setLayer(activeLayer);
            } else {
                this._selectTool?.clearSelection();
            }
        } else if (this._activeTool === "select" && this._selectTool) {
            this._selectTool.setCanvas(overlayCanvas);
            this._selectTool.activate();
        } else if (this._activeTool === "shape" && this._shapeTool) {
            this._shapeTool.setCanvas(overlayCanvas);
            this._shapeTool.activate();
            if (overlayCanvas) overlayCanvas.style.cursor = "crosshair";
        } else if (this._activeTool === "fill" && this._fillTool) {
            const activeLayer = this._layerMgr?.activeLayer;
            if (activeLayer) this._fillTool.setCanvas(activeLayer.canvas);
            this._fillTool.activate();
            if (overlayCanvas) overlayCanvas.style.cursor = "crosshair";
        } else if (this._activeTool === "mask") {
            this._initMaskEditorOneTools();
            this._activateMaskSubtool();
        } else if (this._activeTool === "blur") {
            if (overlayCanvas) overlayCanvas.style.cursor = this._blurRectMode ? "crosshair" : "default";
        }
    }

    _renderToolOptions(toolId) {
        const el = document.getElementById("ie-tool-options");
        if (!el) return;
        el.innerHTML = "";

        if (toolId === "select" && this._selectTool) {
            el.innerHTML = `
                <div class="ie-opt-group">
                    <button class="it-btn it-btn-sm" id="ie-flip-h-btn" title="Flip Horizontal">↔ Flip H</button>
                    <button class="it-btn it-btn-sm" id="ie-flip-v-btn" title="Flip Vertical">↕ Flip V</button>
                </div>
                <div class="ie-opt-group" style="margin-left:8px;">
                    <label style="font-size:11px;color:var(--it-text-secondary);">Rotate</label>
                    <input type="number" id="ie-rotate-input" value="0" step="1" min="-360" max="360"
                        style="width:56px;" class="ie-opt-input" title="Rotation angle (degrees)">°
                    <button class="it-btn it-btn-sm" id="ie-rotate-apply-btn">Apply</button>
                    <button class="it-btn it-btn-sm" id="ie-rotate-reset-btn">Reset</button>
                </div>
                <div class="ie-opt-group" style="margin-left:8px;">
                    <button class="it-btn it-btn-sm" id="ie-select-style-btn" title="${t("image.selectStyleBtnTitle")}">${t("layout.styleBtn")}</button>
                </div>
            `;
            document.getElementById("ie-select-style-btn")?.addEventListener("click", () => {
                if (!this.hasSelectedTextLayer()) {
                    this._toast(t("image.noTextLayerSelected"), "info");
                    return;
                }
                if (typeof window.openTextStyleModal !== "function") return;
                const info = this.getSelectedTextStyleInfo();
                window.openTextStyleModal({
                    fontFamily: info.fontFamily,
                    previewSize: info.fontSize,
                    initialStyle: info.style,
                    onApply: (style) => { this.applyFontStyleToSelection(style); },
                });
            });
            document.getElementById("ie-flip-h-btn")?.addEventListener("click", () => {
                this._selectTool.flipH();
                this._updateCompositeView();
                this._refreshLayerList();
            });
            document.getElementById("ie-flip-v-btn")?.addEventListener("click", () => {
                this._selectTool.flipV();
                this._updateCompositeView();
                this._refreshLayerList();
            });
            document.getElementById("ie-rotate-apply-btn")?.addEventListener("click", () => {
                const layer = this._selectTool.getSelectedLayer();
                if (!layer) return;
                const deg = parseFloat(document.getElementById("ie-rotate-input").value) || 0;
                layer.rotation = deg;
                this._selectTool.setLayer(layer);
                this._updateCompositeView();
                this._refreshLayerList();
            });
            document.getElementById("ie-rotate-reset-btn")?.addEventListener("click", () => {
                const layer = this._selectTool.getSelectedLayer();
                if (!layer) return;
                layer.rotation = 0;
                layer.flipX    = false;
                layer.flipY    = false;
                document.getElementById("ie-rotate-input").value = 0;
                this._selectTool.setLayer(layer);
                this._updateCompositeView();
                this._refreshLayerList();
            });

        } else if (toolId === "draw" && this._drawTool) {
            el.innerHTML = "";
            this._renderDrawProps();

        } else if (toolId === "text" && this._textTool) {
            // 選択中のテキストレイヤーがあれば、オプションバーはそのレイヤーの現在値を表示する
            // （無ければ従来通りツールのデフォルト値＝次に新規作成するテキストの初期値）
            const selLayerForOpts = this.hasSelectedTextLayer() ? this._selectTool.getSelectedLayer() : null;
            const p = selLayerForOpts ? selLayerForOpts.textProps : this._textTool;
            el.innerHTML = `
                <div class="ie-opt-group">
                    <label>Color</label>
                    <input type="color" id="ie-text-color" value="${p.color}"
                        style="width:30px;height:24px;padding:0;border:1px solid var(--it-border);cursor:pointer;border-radius:3px;">
                </div>
                <div class="ie-opt-group">
                    <label>Size</label>
                    <input type="number" id="ie-text-size" value="${p.fontSize}"
                        min="6" max="500" style="width:56px;" class="ie-opt-input">
                </div>
                <div class="ie-opt-group" style="gap:2px;">
                    <label>Font</label>
                    <button class="it-btn it-btn-sm ${this._textFontSource==="google"    ?"ie-opt-active":""}" id="ie-text-fsrc-google">Google</button>
                    <button class="it-btn it-btn-sm ${this._textFontSource==="system"    ?"ie-opt-active":""}" id="ie-text-fsrc-system">System</button>
                    <button class="it-btn it-btn-sm ${this._textFontSource==="favorites" ?"ie-opt-active":""}" id="ie-text-fsrc-favorites">Cat</button>
                    <select id="ie-text-font-cat" class="ie-opt-select" style="width:80px;display:${this._textFontSource==="favorites"?"":"none"};">
                        <option value="">${t("layout.fontCatAll")}</option>
                        ${this._getFavoriteCategories().map(c => `<option value="${c}" ${this._textFontFavCat===c?"selected":""}>${this._fontCatLabel(c)}</option>`).join("")}
                    </select>
                    <select id="ie-text-font" class="ie-opt-select" style="min-width:120px;">
                        <option value="${p.fontFamily}">${p.fontFamily}</option>
                    </select>
                </div>
                <div class="ie-opt-group" style="gap:4px;">
                    <input type="checkbox" id="ie-text-vertical" ${p.vertical ? "checked" : ""} style="cursor:pointer;">
                    <label for="ie-text-vertical" style="cursor:pointer;" title="${t("font.dirVertical")}">${t("layout.verticalLabel")}</label>
                </div>
                <div class="ie-opt-group">
                    <button class="it-btn it-btn-sm" id="ie-text-style-btn" title="${t("image.textStyleBtnTitle")}">${t("layout.styleBtn")}</button>
                </div>
            `;
            document.getElementById("ie-text-color")?.addEventListener("input", e => {
                this._textTool.color = e.target.value;
                this._applyTextToolChangeToSelection({ color: e.target.value });
            });
            document.getElementById("ie-text-size")?.addEventListener("change", e => {
                this._textTool.fontSize = parseInt(e.target.value) || 64;
                this._applyTextToolChangeToSelection({ fontSize: this._textTool.fontSize });
            });
            ["google", "system", "favorites"].forEach(src => {
                document.getElementById(`ie-text-fsrc-${src}`)?.addEventListener("click", () => {
                    if (this._textFontSource === src) return;
                    this._textFontSource = src;
                    this._renderToolOptions("text");
                });
            });
            document.getElementById("ie-text-font-cat")?.addEventListener("change", e => {
                this._textFontFavCat = e.target.value;
                this._populateTextFontSelect();
            });
            document.getElementById("ie-text-font")?.addEventListener("change", e => {
                this._textTool.fontFamily = e.target.value;
                this._applyTextToolChangeToSelection({ fontFamily: e.target.value });
            });
            this._populateTextFontSelect();
            // 太字/斜体/文字寄せはオプションバーから廃止し、スタイルモーダル（boldEnabled/italicEnabled/align）で設定する
            document.getElementById("ie-text-vertical")?.addEventListener("change", e => {
                this._textTool.vertical = e.target.checked;
                this._applyTextToolChangeToSelection({ vertical: e.target.checked });
            });
            document.getElementById("ie-text-style-btn")?.addEventListener("click", () => {
                if (typeof window.openTextStyleModal !== "function") return;
                const info = this.getSelectedTextStyleInfo();
                window.openTextStyleModal({
                    fontFamily: info.fontFamily,
                    previewSize: info.fontSize,
                    initialStyle: info.style,
                    onApply: (style) => {
                        if (this.hasSelectedTextLayer()) this.applyFontStyleToSelection(style);
                        else this.insertFontStylePlaceholder(style);
                    },
                });
            });
        } else if (toolId === "shape" && this._shapeTool) {
            const t = this._shapeTool;
            const noFillKinds   = ["line", "freeline", "chain", "rope", "original"];
            const noStrokeUI    = ["original"];              // stroke色設定自体が不要（画像そのまま描画のため）
            const strokeAlways  = ["line", "freeline", "chain", "rope"]; // strokeNoneの概念がない
            const spacingKinds  = ["chain", "rope", "original"];
            const isLineKind    = noFillKinds.includes(t.shape);
            const showRounded   = ["rect", "ellipse"].includes(t.shape);
            const showSpacing   = spacingKinds.includes(t.shape);
            const showStrokeUI  = !noStrokeUI.includes(t.shape);
            const showImagePick = t.shape === "original";
            el.innerHTML = `
                <div class="ie-opt-group" id="ie-shape-samelayer-wrap" title="ON: draw into the current shape layer / OFF: create a new layer for each shape">
                    <label><input type="checkbox" id="ie-shape-samelayer" ${this._shapeSameLayer?"checked":""}> Same Layer</label>
                </div>
                <div class="ie-opt-group">
                    <label>Shape</label>
                    <select id="ie-shape-kind" class="ie-opt-select">
                        <option value="rect"     ${t.shape==="rect"     ?"selected":""}>Rect</option>
                        <option value="ellipse"  ${t.shape==="ellipse"  ?"selected":""}>Ellipse</option>
                        <option value="line"     ${t.shape==="line"     ?"selected":""}>Line</option>
                        <option value="freeline" ${t.shape==="freeline" ?"selected":""}>FreeLine</option>
                        <option value="chain"    ${t.shape==="chain"    ?"selected":""}>Chain</option>
                        <option value="rope"     ${t.shape==="rope"     ?"selected":""}>Rope</option>
                        <option value="original" ${t.shape==="original" ?"selected":""}>My Curve</option>
                    </select>
                </div>
                <div class="ie-opt-group" id="ie-shape-rounded-wrap" style="display:${showRounded?"":"none"};">
                    <label><input type="checkbox" id="ie-shape-rounded" ${t.rounded?"checked":""}> Rounded</label>
                </div>
                <div class="ie-opt-group" id="ie-shape-fill-wrap" style="display:${isLineKind?"none":""};">
                    <label>Fill</label>
                    <input type="checkbox" id="ie-shape-fill-none" ${t.fillNone?"checked":""}> <span style="font-size:11px;color:var(--it-text-secondary);">None</span>
                    <input type="color" id="ie-shape-fill" value="${t.fillColor}" ${t.fillNone?"disabled":""}
                        style="width:28px;height:24px;padding:0;border:1px solid var(--it-border);cursor:pointer;border-radius:3px;margin-left:2px;">
                </div>
                <div class="ie-opt-group" id="ie-shape-stroke-wrap" style="display:${showStrokeUI?"":"none"};">
                    <label>Stroke</label>
                    <div id="ie-shape-stroke-none-wrap" style="display:${strokeAlways.includes(t.shape)?"none":""};">
                        <input type="checkbox" id="ie-shape-stroke-none" ${t.strokeNone?"checked":""}> <span style="font-size:11px;color:var(--it-text-secondary);">None</span>
                    </div>
                    <input type="color" id="ie-shape-stroke" value="${t.strokeColor}" ${(!strokeAlways.includes(t.shape) && t.strokeNone)?"disabled":""}
                        style="width:28px;height:24px;padding:0;border:1px solid var(--it-border);cursor:pointer;border-radius:3px;margin-left:2px;">
                    <input type="number" id="ie-shape-stroke-width" value="${t.strokeWidth}" min="1" max="200" ${(!strokeAlways.includes(t.shape) && t.strokeNone)?"disabled":""}
                        style="width:44px;margin-left:2px;" class="ie-opt-input">
                </div>
                <div class="ie-opt-group" id="ie-shape-spacing-wrap" style="display:${showSpacing?"":"none"};">
                    <label>${window.t("image.spacingLabel")}</label>
                    <input type="range" id="ie-shape-spacing" min="1" max="100" value="${t.spacing}" style="width:70px;">
                    <span id="ie-shape-spacing-lbl">${t.spacing}</span>
                </div>
                <div class="ie-opt-group" id="ie-shape-image-wrap" style="display:${showImagePick?"":"none"};">
                    <select id="ie-shape-mychain-select" class="ie-opt-select">
                        <option value="">${window.t("image.mychainSelectOption")}</option>
                        ${this._mychainAssets.map(a => `<option value="${a.path}">${a.name}</option>`).join("")}
                    </select>
                    <label class="it-btn it-btn-sm" style="cursor:pointer;">
                        ${window.t("image.selectImageBtn")}
                        <input type="file" id="ie-shape-image-file" accept="image/*" style="display:none;">
                    </label>
                    <span id="ie-shape-image-name" style="font-size:11px;color:var(--it-text-secondary);max-width:90px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${t.originalImgName ?? window.t("layout.notSelected")}</span>
                </div>
                <div class="ie-opt-group">
                    <label>Opacity</label>
                    <input type="range" id="ie-shape-opacity" min="1" max="100" value="${Math.round(t.opacity*100)}" style="width:70px;">
                    <span id="ie-shape-opacity-lbl">${Math.round(t.opacity*100)}%</span>
                </div>
                <div class="ie-opt-group" style="margin-left:8px;">
                    <button class="it-btn it-btn-sm" id="ie-shape-undo-btn">↩ Undo</button>
                </div>
            `;

            document.getElementById("ie-shape-samelayer")?.addEventListener("change", e => {
                this._shapeSameLayer = e.target.checked;
            });
            document.getElementById("ie-shape-kind")?.addEventListener("change", e => {
                t.shape = e.target.value;
                this._renderToolOptions("shape");
            });
            document.getElementById("ie-shape-rounded")?.addEventListener("change", e => {
                t.rounded = e.target.checked;
            });
            document.getElementById("ie-shape-fill-none")?.addEventListener("change", e => {
                t.fillNone = e.target.checked;
                document.getElementById("ie-shape-fill").disabled = e.target.checked;
            });
            document.getElementById("ie-shape-fill")?.addEventListener("input", e => {
                t.fillColor = e.target.value;
            });
            document.getElementById("ie-shape-stroke-none")?.addEventListener("change", e => {
                t.strokeNone = e.target.checked;
                document.getElementById("ie-shape-stroke").disabled       = e.target.checked;
                document.getElementById("ie-shape-stroke-width").disabled = e.target.checked;
            });
            document.getElementById("ie-shape-stroke")?.addEventListener("input", e => {
                t.strokeColor = e.target.value;
            });
            document.getElementById("ie-shape-stroke-width")?.addEventListener("input", e => {
                t.strokeWidth = parseFloat(e.target.value) || 1;
            });
            document.getElementById("ie-shape-spacing")?.addEventListener("input", e => {
                t.spacing = parseInt(e.target.value) || 1;
                document.getElementById("ie-shape-spacing-lbl").textContent = e.target.value;
            });
            document.getElementById("ie-shape-mychain-select")?.addEventListener("change", e => {
                const path = e.target.value;
                if (!path) return;
                const name = e.target.options[e.target.selectedIndex].textContent;
                const img = new Image();
                img.onload = () => {
                    t.setOriginalImage(img, name);
                    const nameEl = document.getElementById("ie-shape-image-name");
                    if (nameEl) nameEl.textContent = name;
                };
                img.onerror = () => this._toast(window.t("image.mychainLoadFailed"), "error");
                img.src = path;
            });
            document.getElementById("ie-shape-image-file")?.addEventListener("change", e => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = ev => {
                    const img = new Image();
                    img.onload = () => {
                        t.setOriginalImage(img, file.name);
                        const nameEl = document.getElementById("ie-shape-image-name");
                        if (nameEl) nameEl.textContent = file.name;
                    };
                    img.src = ev.target.result;
                };
                reader.readAsDataURL(file);
                e.target.value = "";
            });
            document.getElementById("ie-shape-opacity")?.addEventListener("input", e => {
                t.opacity = parseInt(e.target.value) / 100;
                document.getElementById("ie-shape-opacity-lbl").textContent = e.target.value + "%";
            });
            document.getElementById("ie-shape-undo-btn")?.addEventListener("click", () => this._undo());

        } else if (toolId === "fill" && this._fillTool) {
            el.innerHTML = "";
            this._renderFillProps();

        } else if (toolId === "mask") {
            const sub = this._maskSubtool ?? "paint";
            const sam3Disabled = this._sam3Available ? "" : "disabled";
            const sam3Title    = this._sam3Available ? "SAM3 Segment" : "SAM3 (Mask Editor One required)";
            const sam3Ui = this._sam3Available && sub === "sam3" ? `
                <div class="ie-opt-group">
                    <input type="text" id="ie-sam3-prompt" class="ie-opt-input"
                        placeholder="e.g. cat, person..."
                        value="${this._sam3Prompt}"
                        style="width:160px;font-size:11px;padding:2px 6px;border:1px solid var(--it-border);border-radius:3px;background:var(--it-surface);color:var(--it-text);">
                </div>
                <div class="ie-opt-group">
                    <label style="font-size:11px;color:var(--it-text-secondary);">Max</label>
                    <select id="ie-sam3-max" class="ie-opt-select" style="width:44px;">
                        ${[3,6,9,12].map(n => `<option value="${n}"${n === this._sam3MaxMasks ? " selected" : ""}>${n}</option>`).join("")}
                    </select>
                </div>
                <div class="ie-opt-group">
                    <button class="it-btn it-btn-sm it-btn-primary" id="ie-sam3-run-btn" ${this._sam3Loading ? "disabled" : ""}>
                        ${this._sam3Loading ? "Running..." : "Segment"}
                    </button>
                </div>
                <span id="ie-sam3-status" style="font-size:11px;color:var(--it-text-secondary);margin-left:4px;">
                    ${this._sam3Results.length > 0 ? `${this._sam3Results.length} masks found` : ""}
                </span>
            ` : "";
            el.innerHTML = `
                <div class="ie-opt-group" style="flex-wrap:nowrap;gap:2px;">
                    <button class="it-btn it-btn-sm${sub === "paint"  ? " ie-opt-active" : ""}" id="ie-mask-paint-btn">Paint</button>
                    <button class="it-btn it-btn-sm${sub === "color"  ? " ie-opt-active" : ""}" id="ie-mask-color-btn">Color</button>
                    <button class="it-btn it-btn-sm${sub === "alpha"  ? " ie-opt-active" : ""}" id="ie-mask-alpha-btn">Alpha</button>
                    <button class="it-btn it-btn-sm${sub === "text"   ? " ie-opt-active" : ""}" id="ie-mask-text-btn">Text</button>
                    <button class="it-btn it-btn-sm${sub === "vector" ? " ie-opt-active" : ""}" id="ie-mask-vector-btn">Vector</button>
                    <button class="it-btn it-btn-sm${sub === "shape"  ? " ie-opt-active" : ""}" id="ie-mask-shape-btn">Shape</button>
                    <button class="it-btn it-btn-sm${sub === "sam3"   ? " ie-opt-active" : ""}" id="ie-mask-sam3-btn"
                        ${sam3Disabled} title="${sam3Title}">SAM3</button>
                </div>
                <div style="width:1px;height:22px;background:var(--it-border);margin:0 4px;flex-shrink:0;"></div>
                ${sam3Ui}
                ${sub !== "sam3" ? `
                <div class="ie-opt-group">
                    <label style="font-size:11px;cursor:pointer;color:var(--it-text-secondary);">
                        <input type="checkbox" id="ie-mask-invert" ${this._maskInverted ? "checked" : ""}> Invert
                    </label>
                </div>
                <div class="ie-opt-group">
                    <label style="font-size:11px;color:var(--it-text-secondary);">Overlay</label>
                    <input type="color" id="ie-mask-overlay-color" value="${this._maskOverlayColor}"
                        style="width:28px;height:22px;padding:0;border:1px solid var(--it-border);cursor:pointer;border-radius:3px;">
                </div>
                <div class="ie-opt-group">
                    <label style="font-size:11px;color:var(--it-text-secondary);">Blur</label>
                    <input type="range" id="ie-mask-blur" min="0" max="50" value="${this._maskBlur}" style="width:70px;">
                    <span id="ie-mask-blur-val" style="font-size:11px;min-width:22px;">${this._maskBlur}</span>px
                </div>` : ""}
            `;
            document.getElementById("ie-mask-paint-btn")?.addEventListener("click", () => {
                this._switchMaskSubtool("paint");
            });
            document.getElementById("ie-mask-color-btn")?.addEventListener("click", () => {
                this._switchMaskSubtool("color");
            });
            document.getElementById("ie-mask-alpha-btn")?.addEventListener("click", () => {
                this._switchMaskSubtool("alpha");
            });
            document.getElementById("ie-mask-text-btn")?.addEventListener("click", () => {
                this._switchMaskSubtool("text");
            });
            document.getElementById("ie-mask-vector-btn")?.addEventListener("click", () => {
                this._switchMaskSubtool("vector");
            });
            document.getElementById("ie-mask-shape-btn")?.addEventListener("click", () => {
                this._switchMaskSubtool("shape");
            });
            document.getElementById("ie-mask-sam3-btn")?.addEventListener("click", () => {
                if (this._sam3Available) this._switchMaskSubtool("sam3");
            });
            document.getElementById("ie-sam3-prompt")?.addEventListener("input", e => {
                this._sam3Prompt = e.target.value;
            });
            document.getElementById("ie-sam3-max")?.addEventListener("change", e => {
                this._sam3MaxMasks = parseInt(e.target.value);
            });
            document.getElementById("ie-sam3-run-btn")?.addEventListener("click", () => this._runSam3Segment());
            document.getElementById("ie-mask-invert")?.addEventListener("change", e => {
                this._maskInverted = e.target.checked;
                this._updateCompositeView();
            });
            document.getElementById("ie-mask-overlay-color")?.addEventListener("input", e => {
                this._maskOverlayColor = e.target.value;
                this._updateCompositeView();
            });
            document.getElementById("ie-mask-blur")?.addEventListener("input", e => {
                this._maskBlur = parseInt(e.target.value);
                document.getElementById("ie-mask-blur-val").textContent = e.target.value;
                this._updateCompositeView();
            });
            this._renderMaskProps(sub);

        } else if (toolId === "blur") {
            const blurOn   = this._blurRectMode === "blur";
            const mosaicOn = this._blurRectMode === "mosaic";
            el.innerHTML = `
                <div class="ie-opt-group">
                    <span style="font-size:11px;color:var(--it-text-secondary);">Whole:</span>
                </div>
                <div class="ie-opt-group">
                    <label style="font-size:11px;">Blur</label>
                    <input type="range" id="ie-whole-blur" min="1" max="50" value="10" style="width:70px;">
                    <span id="ie-whole-blur-val" style="font-size:11px;min-width:22px;">10</span>px
                    <button class="it-btn it-btn-sm" id="ie-whole-blur-apply">Apply</button>
                </div>
                <div class="ie-opt-group">
                    <label style="font-size:11px;">Mosaic</label>
                    <input type="range" id="ie-whole-mosaic" min="5" max="100" value="20" style="width:70px;">
                    <span id="ie-whole-mosaic-val" style="font-size:11px;min-width:22px;">20</span>px
                    <button class="it-btn it-btn-sm" id="ie-whole-mosaic-apply">Apply</button>
                </div>
                <div style="width:1px;height:22px;background:var(--it-border);margin:0 6px;flex-shrink:0;"></div>
                <div class="ie-opt-group">
                    <span style="font-size:11px;color:var(--it-text-secondary);">Rect:</span>
                </div>
                <div class="ie-opt-group">
                    <button class="it-btn it-btn-sm${blurOn ? " ie-opt-active" : ""}" id="ie-rect-blur-toggle">
                        Rect Blur: ${blurOn ? "ON" : "OFF"}
                    </button>
                    <input type="range" id="ie-rect-blur" min="1" max="50" value="10" style="width:70px;">
                    <span id="ie-rect-blur-val" style="font-size:11px;min-width:22px;">10</span>px
                </div>
                <div class="ie-opt-group">
                    <button class="it-btn it-btn-sm${mosaicOn ? " ie-opt-active" : ""}" id="ie-rect-mosaic-toggle">
                        Rect Mosaic: ${mosaicOn ? "ON" : "OFF"}
                    </button>
                    <input type="range" id="ie-rect-mosaic" min="5" max="50" value="15" style="width:70px;">
                    <span id="ie-rect-mosaic-val" style="font-size:11px;min-width:22px;">15</span>px
                </div>
            `;
            document.getElementById("ie-whole-blur")?.addEventListener("input", e => {
                document.getElementById("ie-whole-blur-val").textContent = e.target.value;
            });
            document.getElementById("ie-whole-mosaic")?.addEventListener("input", e => {
                document.getElementById("ie-whole-mosaic-val").textContent = e.target.value;
            });
            document.getElementById("ie-whole-blur-apply")?.addEventListener("click", () => {
                this._applyWholeBlur(parseInt(document.getElementById("ie-whole-blur").value));
            });
            document.getElementById("ie-whole-mosaic-apply")?.addEventListener("click", () => {
                this._applyWholeMosaic(parseInt(document.getElementById("ie-whole-mosaic").value));
            });
            document.getElementById("ie-rect-blur-toggle")?.addEventListener("click", () => {
                this._blurRectMode = this._blurRectMode === "blur" ? null : "blur";
                this._renderToolOptions("blur");
                const ov = document.getElementById("ie-canvas-overlay");
                if (ov) ov.style.cursor = this._blurRectMode ? "crosshair" : "default";
            });
            document.getElementById("ie-rect-mosaic-toggle")?.addEventListener("click", () => {
                this._blurRectMode = this._blurRectMode === "mosaic" ? null : "mosaic";
                this._renderToolOptions("blur");
                const ov = document.getElementById("ie-canvas-overlay");
                if (ov) ov.style.cursor = this._blurRectMode ? "crosshair" : "default";
            });
            document.getElementById("ie-rect-blur")?.addEventListener("input", e => {
                document.getElementById("ie-rect-blur-val").textContent = e.target.value;
            });
            document.getElementById("ie-rect-mosaic")?.addEventListener("input", e => {
                document.getElementById("ie-rect-mosaic-val").textContent = e.target.value;
            });

        } else if (toolId === "bgremove") {
            const birefnetDisabled = this._birefnetAvailable ? "" : "disabled";
            const birefnetLabel    = this._birefnetAvailable
                ? "BiRefNet (Mask Editor One)"
                : "BiRefNet (Mask Editor One required)";
            el.innerHTML = `
                <div class="ie-opt-group">
                    <label>Model</label>
                    <select id="ie-bgremove-model" class="ie-opt-select">
                        <option value="imgly">Lightweight (@imgly)</option>
                        <option value="birefnet" ${birefnetDisabled}>${birefnetLabel}</option>
                    </select>
                </div>
                <div class="ie-opt-group">
                    <label style="font-size:11px;cursor:pointer;">
                        <input type="checkbox" id="ie-bgremove-new-layer" checked> New Layer
                    </label>
                </div>
                <div class="ie-opt-group">
                    <button class="it-btn it-btn-sm" id="ie-bgremove-btn">Remove BG</button>
                </div>
                <span id="ie-bgremove-status" style="font-size:11px;color:var(--it-text-secondary);margin-left:4px;"></span>
            `;
            document.getElementById("ie-bgremove-btn")?.addEventListener("click", () => this._applyBgRemove());

        } else if (toolId === "filter") {
            const openBtnDisabled  = this._gmicState.processing ? "disabled" : "";
            const applyBtnDisabled = (!this._gmicState.lastResultJobId || this._gmicState.processing) ? "disabled" : "";
            const progressStyle    = this._gmicState.processing ? "display:flex" : "display:none";

            el.innerHTML = `
                <div class="ie-opt-group">
                    <button class="it-btn it-btn-sm it-btn-primary" id="ie-gmic-open-btn" ${openBtnDisabled}>${t("layout.gmicOpenGui")}</button>
                    <button class="it-btn it-btn-sm" id="ie-gmic-apply-btn" ${applyBtnDisabled}>${t("image.gmicApplyResult")}</button>
                </div>
                <div class="ie-opt-group" id="ie-gmic-progress-area" style="${progressStyle}; align-items:center; gap:6px;">
                    <span id="ie-gmic-progress-lbl" style="font-size:11px; color:var(--it-text-secondary);">${t("image.gmicLaunching")}</span>
                    <button class="it-btn it-btn-sm" id="ie-gmic-abort-btn" style="background:#ea4335;color:#fff;">${t("layout.abortBtn")}</button>
                </div>
            `;
            document.getElementById("ie-gmic-open-btn")?.addEventListener("click", () => this._gmicOpenGui());
            document.getElementById("ie-gmic-apply-btn")?.addEventListener("click", () => this._gmicApplyResult());
            document.getElementById("ie-gmic-abort-btn")?.addEventListener("click", () => this._gmicAbort());

        } else if (toolId === "upscale") {
            el.innerHTML = `
                <div class="ie-opt-group">
                    <label style="font-size:11px;">${t("image.upscaleScaleLabel")}</label>
                    <input type="range" id="ie-upscale-scale" min="1" max="4" step="0.5" value="2" style="width:80px;">
                    <span id="ie-upscale-scale-val" style="font-size:11px;min-width:32px;">2.0×</span>
                </div>
                <div class="ie-opt-group">
                    <label style="font-size:11px;">${t("image.upscaleSharpenLabel")}</label>
                    <input type="range" id="ie-upscale-sharpen" min="0" max="100" value="30" style="width:70px;">
                    <span id="ie-upscale-sharpen-val" style="font-size:11px;min-width:28px;">30%</span>
                </div>
                <div class="ie-opt-group">
                    <label style="font-size:11px;cursor:pointer;">
                        <input type="checkbox" id="ie-upscale-denoise"> ${t("image.upscaleDenoiseLabel")}
                    </label>
                </div>
                <div class="ie-opt-group">
                    <button class="it-btn it-btn-sm it-btn-primary" id="ie-upscale-run-btn">${t("layout.runBtn")}</button>
                </div>
                <span id="ie-upscale-status" style="font-size:11px;color:var(--it-text-secondary);margin-left:4px;"></span>
            `;
            document.getElementById("ie-upscale-scale")?.addEventListener("input", e => {
                document.getElementById("ie-upscale-scale-val").textContent = parseFloat(e.target.value).toFixed(1) + "×";
            });
            document.getElementById("ie-upscale-sharpen")?.addEventListener("input", e => {
                document.getElementById("ie-upscale-sharpen-val").textContent = e.target.value + "%";
            });
            document.getElementById("ie-upscale-run-btn")?.addEventListener("click", () => this._applyUpscale());

        } else {
            const def = TOOL_DEFS.find(d => d.id === toolId);
            el.innerHTML = `<span style="font-size:12px;color:var(--it-text-secondary);">${def?.label ?? toolId}: coming soon</span>`;
        }
    }

    _renderMaskProps(sub) {
        const pane  = document.getElementById("ie-props-pane");
        const body  = document.getElementById("ie-props-body");
        const title = document.getElementById("ie-props-title");
        if (!pane || !body) return;
        pane.style.display = "flex";
        if (title) title.textContent = sub.charAt(0).toUpperCase() + sub.slice(1);

        if (sub === "paint" && this._maskTool) {
            const t = this._maskTool;
            body.innerHTML = `
                <div class="ie-props-row">
                    <label>Mode</label>
                    <div style="display:flex;gap:4px;">
                        <button class="it-btn it-btn-sm${t.mode === "paint" ? " ie-opt-active" : ""}" id="ie-mask-mode-add" style="flex:1;">Add</button>
                        <button class="it-btn it-btn-sm${t.mode === "erase" ? " ie-opt-active" : ""}" id="ie-mask-mode-erase" style="flex:1;">Erase</button>
                    </div>
                </div>
                <div class="ie-props-row">
                    <label>Size</label>
                    <input type="range" id="ie-mask-size" min="1" max="200" value="${t.brushSize}">
                    <span id="ie-mask-size-lbl">${t.brushSize}px</span>
                </div>
                <div class="ie-props-row">
                    <label>Hardness</label>
                    <input type="range" id="ie-mask-hard" min="0" max="100" value="${Math.round(t.hardness * 100)}"
                        ${t.brushImage ? "disabled title='Hardness applies to circle brush only'" : ""}>
                    <span id="ie-mask-hard-lbl">${Math.round(t.hardness * 100)}%</span>
                </div>
                <div style="margin:6px 0 4px;border-top:1px solid var(--it-border);padding-top:6px;font-size:10px;color:${this._abrAvailable ? "var(--it-success)" : "var(--it-text-secondary)"};letter-spacing:0.05em;"
                    title="${this._abrAvailable ? "Mask Editor One: brushes available" : "Mask Editor One: no brushes imported yet"}">
                    MASK EDITOR ONE
                </div>
                <div class="ie-props-row">
                    <label>Brush</label>
                    <span style="font-size:11px;color:var(--it-text-secondary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                        title="${t.brushName ?? "Circle"}">${t.brushName ?? "Circle"}</span>
                    <button class="it-btn it-btn-sm" id="ie-mask-select-brush" style="font-size:10px;padding:1px 6px;flex-shrink:0;" ${this._abrAvailable ? "" : "disabled"}>Select</button>
                    ${t.brushImage ? `<button class="it-btn it-btn-sm" id="ie-mask-clear-brush" style="font-size:10px;padding:1px 5px;flex-shrink:0;">✕</button>` : ""}
                </div>
                ${t.brushImage ? `
                <div class="ie-props-row">
                    <label>Spacing</label>
                    <input type="range" id="ie-mask-spacing" min="5" max="100" value="${Math.round((t.spacing ?? 0.25) * 100)}">
                    <span id="ie-mask-spacing-lbl">${Math.round((t.spacing ?? 0.25) * 100)}%</span>
                </div>
                <div class="ie-props-row">
                    <label>Angle</label>
                    <input type="range" id="ie-mask-angle" min="0" max="359" value="${t.angle ?? 0}">
                    <span id="ie-mask-angle-lbl">${t.angle ?? 0}°</span>
                </div>
                <div class="ie-props-row">
                    <label>Sz Jitter</label>
                    <input type="range" id="ie-mask-szjitter" min="0" max="100" value="${Math.round((t.sizeJitterAmount ?? 0.5) * 100)}">
                    <span id="ie-mask-szjitter-lbl">${Math.round((t.sizeJitterAmount ?? 0.5) * 100)}%</span>
                </div>
                <div class="ie-props-row">
                    <label>Rot. Jitter</label>
                    <label style="cursor:pointer;font-size:11px;">
                        <input type="checkbox" id="ie-mask-rotjitter" ${t.rotationJitter ? "checked" : ""}> On
                    </label>
                </div>` : ""}
            `;
            document.getElementById("ie-mask-mode-add")?.addEventListener("click", () => {
                this._maskTool.mode = "paint";
                this._maskTool._stamp = null;
                this._renderMaskProps("paint");
            });
            document.getElementById("ie-mask-mode-erase")?.addEventListener("click", () => {
                this._maskTool.mode = "erase";
                this._maskTool._stamp = null;
                this._renderMaskProps("paint");
            });
            document.getElementById("ie-mask-size")?.addEventListener("input", e => {
                this._maskTool.brushSize = parseInt(e.target.value);
                document.getElementById("ie-mask-size-lbl").textContent = e.target.value + "px";
                this._maskTool._stamp = null;
            });
            document.getElementById("ie-mask-hard")?.addEventListener("input", e => {
                this._maskTool.hardness = parseInt(e.target.value) / 100;
                document.getElementById("ie-mask-hard-lbl").textContent = e.target.value + "%";
                this._maskTool._stamp = null;
            });
            document.getElementById("ie-mask-select-brush")?.addEventListener("click", () => this._openAbrBrushPicker());
            document.getElementById("ie-mask-clear-brush")?.addEventListener("click", () => {
                this._maskTool?.clearImageBrush();
                this._renderMaskProps("paint");
            });
            document.getElementById("ie-mask-spacing")?.addEventListener("input", e => {
                this._maskTool.spacing = parseInt(e.target.value) / 100;
                document.getElementById("ie-mask-spacing-lbl").textContent = e.target.value + "%";
            });
            document.getElementById("ie-mask-angle")?.addEventListener("input", e => {
                this._maskTool.angle = parseInt(e.target.value);
                document.getElementById("ie-mask-angle-lbl").textContent = e.target.value + "°";
            });
            document.getElementById("ie-mask-szjitter")?.addEventListener("input", e => {
                this._maskTool.sizeJitterAmount = parseInt(e.target.value) / 100;
                this._maskTool.sizeJitter = this._maskTool.sizeJitterAmount > 0;
                document.getElementById("ie-mask-szjitter-lbl").textContent = e.target.value + "%";
            });
            document.getElementById("ie-mask-rotjitter")?.addEventListener("change", e => {
                this._maskTool.rotationJitter = e.target.checked;
            });
        } else if (sub === "sam3") {
            const modeAdd   = this._sam3Mode === "add";
            const selCount  = this._sam3Selected.size;
            const hasResult = this._sam3Results.length > 0;
            body.innerHTML = `
                <div class="ie-props-row">
                    <label>Mode</label>
                    <div style="display:flex;gap:4px;">
                        <button class="it-btn it-btn-sm${modeAdd   ? " ie-opt-active" : ""}" id="ie-sam3-mode-add"   style="flex:1;">Add</button>
                        <button class="it-btn it-btn-sm${!modeAdd  ? " ie-opt-active" : ""}" id="ie-sam3-mode-erase" style="flex:1;">Erase</button>
                    </div>
                </div>
                ${hasResult ? `
                <div class="ie-props-row" style="flex-direction:column;align-items:stretch;gap:4px;">
                    <div style="font-size:11px;color:var(--it-text-secondary);">Click to select / deselect:</div>
                    <div id="ie-sam3-results" style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;">
                        ${this._sam3Results.map((r, i) => {
                            const sel = this._sam3Selected.has(i);
                            const borderColor = sel ? "var(--it-primary)" : "var(--it-border)";
                            const bg          = sel ? "color-mix(in srgb,var(--it-primary) 15%,transparent)" : "transparent";
                            return `<div class="ie-sam3-thumb" data-idx="${i}"
                                style="cursor:pointer;border:2px solid ${borderColor};border-radius:4px;overflow:hidden;text-align:center;background:${bg};position:relative;">
                                <img src="${r.mask_b64}" style="width:100%;display:block;background:#000;">
                                <div style="font-size:10px;padding:2px 0;color:var(--it-text-secondary);">
                                    ${Math.round((r.score ?? 0) * 100)}%
                                </div>
                                ${sel ? '<div style="position:absolute;top:2px;right:3px;font-size:12px;line-height:1;color:var(--it-primary);">✓</div>' : ""}
                            </div>`;
                        }).join("")}
                    </div>
                    <button class="it-btn it-btn-sm it-btn-primary" id="ie-sam3-apply-btn"
                        ${selCount === 0 ? "disabled" : ""} style="margin-top:4px;">
                        Apply Selected${selCount > 0 ? ` (${selCount})` : ""}
                    </button>
                </div>` : `
                <div style="font-size:11px;color:var(--it-text-secondary);padding:4px 0;">
                    ${this._sam3Loading ? "Segmenting..." : "Enter a prompt and press Segment"}
                </div>`}
            `;
            document.getElementById("ie-sam3-mode-add")?.addEventListener("click", () => {
                this._sam3Mode = "add";
                this._renderMaskProps("sam3");
            });
            document.getElementById("ie-sam3-mode-erase")?.addEventListener("click", () => {
                this._sam3Mode = "erase";
                this._renderMaskProps("sam3");
            });
            body.querySelectorAll(".ie-sam3-thumb").forEach(el => {
                el.addEventListener("click", () => {
                    const idx = parseInt(el.dataset.idx);
                    if (this._sam3Selected.has(idx)) this._sam3Selected.delete(idx);
                    else                              this._sam3Selected.add(idx);
                    this._renderMaskProps("sam3");
                });
            });
            document.getElementById("ie-sam3-apply-btn")?.addEventListener("click", () => {
                this._applySelectedSam3Masks();
            });
        } else if (sub === "color" && this._maskColorTool) {
            const t = this._maskColorTool;
            body.innerHTML = `
                <div class="ie-props-row">
                    <label>Mode</label>
                    <div style="display:flex;gap:4px;">
                        <button class="it-btn it-btn-sm${t.mode === "add"      ? " ie-opt-active" : ""}" id="ie-mc-add"  style="flex:1;">Add</button>
                        <button class="it-btn it-btn-sm${t.mode === "subtract" ? " ie-opt-active" : ""}" id="ie-mc-sub"  style="flex:1;">Sub</button>
                    </div>
                </div>
                <div class="ie-props-row">
                    <label>Tolerance</label>
                    <input type="range" id="ie-mc-tol" min="0" max="255" value="${t.tolerance}">
                    <span id="ie-mc-tol-lbl">${t.tolerance}</span>
                </div>
                <div class="ie-props-row">
                    <label>Feather %</label>
                    <input type="range" id="ie-mc-fea" min="0" max="100" value="${t.feather}">
                    <span id="ie-mc-fea-lbl">${t.feather}%</span>
                </div>
                <div style="font-size:10px;color:var(--it-text-secondary);margin-top:2px;">Click on canvas to select color</div>
            `;
            document.getElementById("ie-mc-add")?.addEventListener("click", () => { t.mode = "add"; this._renderMaskProps("color"); });
            document.getElementById("ie-mc-sub")?.addEventListener("click", () => { t.mode = "subtract"; this._renderMaskProps("color"); });
            document.getElementById("ie-mc-tol")?.addEventListener("input", e => {
                t.tolerance = parseInt(e.target.value);
                document.getElementById("ie-mc-tol-lbl").textContent = e.target.value;
            });
            document.getElementById("ie-mc-fea")?.addEventListener("input", e => {
                t.feather = parseInt(e.target.value);
                document.getElementById("ie-mc-fea-lbl").textContent = e.target.value + "%";
            });

        } else if (sub === "alpha" && this._maskAlphaTool) {
            const t = this._maskAlphaTool;
            body.innerHTML = `
                <div class="ie-props-row">
                    <label>Threshold</label>
                    <input type="range" id="ie-ma-thr" min="0" max="255" value="${t.threshold}">
                    <span id="ie-ma-thr-lbl">${t.threshold}</span>
                </div>
                <div class="ie-props-row">
                    <label style="cursor:pointer;">
                        <input type="checkbox" id="ie-ma-inv" ${t.invert ? "checked" : ""}> Invert
                    </label>
                </div>
                <button class="it-btn it-btn-sm it-btn-primary" id="ie-ma-extract" style="margin-top:4px;">Extract Alpha</button>
                <div style="font-size:10px;color:var(--it-text-secondary);margin-top:2px;">Extracts alpha from image layers</div>
            `;
            document.getElementById("ie-ma-thr")?.addEventListener("input", e => {
                t.threshold = parseInt(e.target.value);
                document.getElementById("ie-ma-thr-lbl").textContent = e.target.value;
            });
            document.getElementById("ie-ma-inv")?.addEventListener("change", e => { t.invert = e.target.checked; });
            document.getElementById("ie-ma-extract")?.addEventListener("click", () => {
                const activeLayer = this._layerMgr?.activeLayer;
                if (!activeLayer || activeLayer.type !== "mask") { this._toast("Select a mask layer first", "info"); return; }
                const bgCv = this._buildBgCanvas();
                this._maskAlphaTool.setCanvas(activeLayer.canvas);
                this._maskAlphaTool.setSourceImage(bgCv);
                this._saveUndo();
                this._maskAlphaTool.extract();
                this._updateCompositeView();
                this._refreshLayerList();
            });

        } else if (sub === "text" && this._maskTextTool) {
            const t = this._maskTextTool;
            body.innerHTML = `
                <div class="ie-props-row">
                    <label>Mode</label>
                    <div style="display:flex;gap:4px;">
                        <button class="it-btn it-btn-sm${t.mode === "add"   ? " ie-opt-active" : ""}" id="ie-mt-add"   style="flex:1;">Add</button>
                        <button class="it-btn it-btn-sm${t.mode === "erase" ? " ie-opt-active" : ""}" id="ie-mt-erase" style="flex:1;">Erase</button>
                    </div>
                </div>
                <div class="ie-props-row">
                    <label>Font</label>
                    <select id="ie-mt-font" class="ie-opt-select" style="width:100%;font-size:11px;">
                        ${MASK_TEXT_FONTS.map(f => `<option value="${f}"${t.fontFamily === f ? " selected" : ""}>${f}</option>`).join("")}
                    </select>
                </div>
                <div class="ie-props-row">
                    <label>Size</label>
                    <input type="number" id="ie-mt-size" value="${t.fontSize}" min="6" max="500" class="ie-opt-input" style="width:60px;">
                </div>
                <div class="ie-props-row" style="flex-direction:row;align-items:center;gap:6px;">
                    <button class="it-btn it-btn-sm${t.bold   ? " ie-opt-active" : ""}" id="ie-mt-bold"   style="min-width:30px;"><b>B</b></button>
                    <button class="it-btn it-btn-sm${t.italic ? " ie-opt-active" : ""}" id="ie-mt-italic" style="min-width:30px;"><i>I</i></button>
                    <select id="ie-mt-align" class="ie-opt-select" style="flex:1;font-size:11px;">
                        ${["left","center","right"].map(a => `<option value="${a}"${t.align === a ? " selected" : ""}>${a.charAt(0).toUpperCase()+a.slice(1)}</option>`).join("")}
                    </select>
                </div>
                <div style="font-size:10px;color:var(--it-text-secondary);margin-top:2px;">Click on canvas to stamp text</div>
            `;
            document.getElementById("ie-mt-add")?.addEventListener("click", () => { t.mode = "add"; this._renderMaskProps("text"); });
            document.getElementById("ie-mt-erase")?.addEventListener("click", () => { t.mode = "erase"; this._renderMaskProps("text"); });
            document.getElementById("ie-mt-font")?.addEventListener("change", e => { t.fontFamily = e.target.value; });
            document.getElementById("ie-mt-size")?.addEventListener("input", e => { t.fontSize = parseInt(e.target.value) || 64; });
            document.getElementById("ie-mt-bold")?.addEventListener("click", () => { t.bold = !t.bold; this._renderMaskProps("text"); });
            document.getElementById("ie-mt-italic")?.addEventListener("click", () => { t.italic = !t.italic; this._renderMaskProps("text"); });
            document.getElementById("ie-mt-align")?.addEventListener("change", e => { t.align = e.target.value; });

        } else if (sub === "vector" && this._maskVectorTool) {
            const t = this._maskVectorTool;
            const pts = t._points ?? [];
            body.innerHTML = `
                <div class="ie-props-row">
                    <label>Mode</label>
                    <div style="display:flex;gap:4px;">
                        <button class="it-btn it-btn-sm${t.mode === "add"   ? " ie-opt-active" : ""}" id="ie-mv-add"   style="flex:1;">Add</button>
                        <button class="it-btn it-btn-sm${t.mode === "erase" ? " ie-opt-active" : ""}" id="ie-mv-erase" style="flex:1;">Erase</button>
                    </div>
                </div>
                <div class="ie-props-row" style="flex-direction:row;align-items:center;justify-content:space-between;">
                    <span style="color:var(--it-text-secondary);">Points: ${pts.length}</span>
                    <button class="it-btn it-btn-sm" id="ie-mv-reset">Reset</button>
                </div>
                <div style="font-size:10px;color:var(--it-text-secondary);margin-top:2px;line-height:1.5;">
                    Click: add point<br>
                    Click 1st point: close<br>
                    Enter: close open path<br>
                    Backspace: remove last<br>
                    Esc: reset
                </div>
            `;
            document.getElementById("ie-mv-add")?.addEventListener("click", () => { t.mode = "add"; this._renderMaskProps("vector"); });
            document.getElementById("ie-mv-erase")?.addEventListener("click", () => { t.mode = "erase"; this._renderMaskProps("vector"); });
            document.getElementById("ie-mv-reset")?.addEventListener("click", () => { t.reset(); this._renderMaskProps("vector"); });

        } else if (sub === "shape" && this._maskShapeTool) {
            const t = this._maskShapeTool;
            body.innerHTML = `
                <div class="ie-props-row">
                    <label>Mode</label>
                    <div style="display:flex;gap:4px;">
                        <button class="it-btn it-btn-sm${t.mode === "add"   ? " ie-opt-active" : ""}" id="ie-ms-add"   style="flex:1;">Add</button>
                        <button class="it-btn it-btn-sm${t.mode === "erase" ? " ie-opt-active" : ""}" id="ie-ms-erase" style="flex:1;">Erase</button>
                    </div>
                </div>
                <div class="ie-props-row">
                    <label>Shape</label>
                    <div style="display:flex;gap:4px;">
                        <button class="it-btn it-btn-sm${t.shape === "rect"    ? " ie-opt-active" : ""}" id="ie-ms-rect"    style="flex:1;">Rect</button>
                        <button class="it-btn it-btn-sm${t.shape === "ellipse" ? " ie-opt-active" : ""}" id="ie-ms-ellipse" style="flex:1;">Ellipse</button>
                    </div>
                </div>
                <div style="font-size:10px;color:var(--it-text-secondary);margin-top:2px;">Shift: square / circle</div>
            `;
            document.getElementById("ie-ms-add")?.addEventListener("click", () => { t.mode = "add"; this._renderMaskProps("shape"); });
            document.getElementById("ie-ms-erase")?.addEventListener("click", () => { t.mode = "erase"; this._renderMaskProps("shape"); });
            document.getElementById("ie-ms-rect")?.addEventListener("click", () => { t.shape = "rect"; this._renderMaskProps("shape"); });
            document.getElementById("ie-ms-ellipse")?.addEventListener("click", () => { t.shape = "ellipse"; this._renderMaskProps("shape"); });

        } else {
            body.innerHTML = `<span style="font-size:11px;color:var(--it-text-secondary);">No options</span>`;
        }
    }

    // 調整レイヤーのプロパティ（選択中に呼ばれる。ツールバーとは独立）
    _renderAdjustProps(layer) {
        const pane  = document.getElementById("ie-props-pane");
        const body  = document.getElementById("ie-props-body");
        const title = document.getElementById("ie-props-title");
        const def   = ADJ_DEFS[layer.adjType];
        if (!pane || !body || !def) return;
        pane.style.display = "flex";
        if (title) title.textContent = def.label;

        body.innerHTML = `
            <div class="ie-props-row">
                <label>${def.label}</label>
                <input type="range" id="ie-adj-value" min="${def.min}" max="${def.max}" step="${def.step}" value="${layer.adjValue}">
                <span id="ie-adj-value-lbl">${layer.adjValue}</span>
            </div>
        `;
        document.getElementById("ie-adj-value")?.addEventListener("input", e => {
            layer.adjValue = parseFloat(e.target.value);
            document.getElementById("ie-adj-value-lbl").textContent = e.target.value;
            this._updateCompositeView();
        });
    }

    _renderDrawProps() {
        const pane  = document.getElementById("ie-props-pane");
        const body  = document.getElementById("ie-props-body");
        const title = document.getElementById("ie-props-title");
        if (!pane || !body) return;
        pane.style.display = "flex";
        if (title) title.textContent = "Draw";

        const t = this._drawTool;
        body.innerHTML = `
            <div class="ie-props-row">
                <label>Mode</label>
                <div style="display:flex;gap:4px;">
                    <button class="it-btn it-btn-sm${t.mode === "draw"  ? " ie-opt-active" : ""}" id="ie-draw-mode-draw"  style="flex:1;">Draw</button>
                    <button class="it-btn it-btn-sm${t.mode === "erase" ? " ie-opt-active" : ""}" id="ie-draw-mode-erase" style="flex:1;">Erase</button>
                </div>
            </div>
            <div class="ie-props-row">
                <label>Color</label>
                <input type="color" id="ie-draw-color" value="${t.color}"
                    style="width:36px;height:24px;padding:0;border:1px solid var(--it-border);cursor:pointer;border-radius:3px;flex-shrink:0;">
                <button class="it-btn it-btn-sm${this._eyedropperActive ? " ie-opt-active" : ""}" id="ie-draw-eyedropper"
                    title="Eyedropper" style="flex-shrink:0;padding:2px 6px;display:flex;align-items:center;justify-content:center;">${EYEDROPPER_ICON_SVG}</button>
            </div>
            <div class="ie-props-row">
                <label>Size</label>
                <input type="range" id="ie-draw-size" min="1" max="200" value="${t.brushSize}">
                <span id="ie-draw-size-lbl">${t.brushSize}px</span>
            </div>
            <div class="ie-props-row">
                <label>Hardness</label>
                <input type="range" id="ie-draw-hard" min="0" max="100" value="${Math.round(t.hardness * 100)}">
                <span id="ie-draw-hard-lbl">${Math.round(t.hardness * 100)}%</span>
            </div>
            <div class="ie-props-row">
                <label>Opacity</label>
                <input type="range" id="ie-draw-opacity" min="1" max="100" value="${Math.round(t.opacity * 100)}">
                <span id="ie-draw-opacity-lbl">${Math.round(t.opacity * 100)}%</span>
            </div>
            <div style="margin:6px 0 4px;border-top:1px solid var(--it-border);padding-top:6px;font-size:10px;color:${this._abrAvailable ? "var(--it-success)" : "var(--it-text-secondary)"};letter-spacing:0.05em;"
                title="${this._abrAvailable ? "Mask Editor One: brushes available" : "Mask Editor One: no brushes imported yet"}">
                MASK EDITOR ONE (COLOR)
            </div>
            <div class="ie-props-row">
                <label>Brush</label>
                <span style="font-size:11px;color:var(--it-text-secondary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                    title="${t.brushName ?? "Circle"}">${t.brushName ?? "Circle"}</span>
                <button class="it-btn it-btn-sm" id="ie-draw-select-brush" style="font-size:10px;padding:1px 6px;flex-shrink:0;" ${this._abrAvailable ? "" : "disabled"}>Select</button>
                ${t.brushImage ? `<button class="it-btn it-btn-sm" id="ie-draw-clear-brush" style="font-size:10px;padding:1px 5px;flex-shrink:0;">✕</button>` : ""}
            </div>
            ${t.brushImage ? `
            <div class="ie-props-row">
                <label>Spacing</label>
                <input type="range" id="ie-draw-spacing" min="5" max="100" value="${Math.round((t.spacing ?? 0.25) * 100)}">
                <span id="ie-draw-spacing-lbl">${Math.round((t.spacing ?? 0.25) * 100)}%</span>
            </div>
            <div class="ie-props-row">
                <label>Angle</label>
                <input type="range" id="ie-draw-angle" min="0" max="359" value="${t.angle ?? 0}">
                <span id="ie-draw-angle-lbl">${t.angle ?? 0}°</span>
            </div>
            <div class="ie-props-row">
                <label>Sz Jitter</label>
                <input type="range" id="ie-draw-szjitter" min="0" max="100" value="${Math.round((t.sizeJitterAmount ?? 0.5) * 100)}">
                <span id="ie-draw-szjitter-lbl">${Math.round((t.sizeJitterAmount ?? 0.5) * 100)}%</span>
            </div>
            <div class="ie-props-row">
                <label>Rot. Jitter</label>
                <label style="cursor:pointer;font-size:11px;">
                    <input type="checkbox" id="ie-draw-rotjitter" ${t.rotationJitter ? "checked" : ""}> On
                </label>
            </div>` : ""}
        `;

        document.getElementById("ie-draw-mode-draw")?.addEventListener("click", () => {
            this._drawTool.mode = "draw";
            this._drawTool._stamp = null;
            this._renderDrawProps();
        });
        document.getElementById("ie-draw-mode-erase")?.addEventListener("click", () => {
            this._drawTool.mode = "erase";
            this._drawTool._stamp = null;
            this._renderDrawProps();
        });
        document.getElementById("ie-draw-color")?.addEventListener("input", e => {
            this._drawTool.color = e.target.value;
            this._drawTool._stamp = null;
            this._drawTool._imgStamp = null;
        });
        document.getElementById("ie-draw-eyedropper")?.addEventListener("click", () => {
            this._setEyedropperActive(!this._eyedropperActive);
        });
        document.getElementById("ie-draw-size")?.addEventListener("input", e => {
            this._drawTool.brushSize = parseInt(e.target.value);
            document.getElementById("ie-draw-size-lbl").textContent = e.target.value + "px";
            this._drawTool._stamp = null;
        });
        document.getElementById("ie-draw-hard")?.addEventListener("input", e => {
            this._drawTool.hardness = parseInt(e.target.value) / 100;
            document.getElementById("ie-draw-hard-lbl").textContent = e.target.value + "%";
            this._drawTool._stamp = null;
        });
        document.getElementById("ie-draw-opacity")?.addEventListener("input", e => {
            this._drawTool.opacity = parseInt(e.target.value) / 100;
            document.getElementById("ie-draw-opacity-lbl").textContent = e.target.value + "%";
        });
        document.getElementById("ie-draw-select-brush")?.addEventListener("click", () => this._openAbrBrushPickerForDraw());
        document.getElementById("ie-draw-clear-brush")?.addEventListener("click", () => {
            this._drawTool?.clearImageBrush();
            this._renderDrawProps();
        });
        document.getElementById("ie-draw-spacing")?.addEventListener("input", e => {
            this._drawTool.spacing = parseInt(e.target.value) / 100;
            document.getElementById("ie-draw-spacing-lbl").textContent = e.target.value + "%";
        });
        document.getElementById("ie-draw-angle")?.addEventListener("input", e => {
            this._drawTool.angle = parseInt(e.target.value);
            document.getElementById("ie-draw-angle-lbl").textContent = e.target.value + "°";
        });
        document.getElementById("ie-draw-szjitter")?.addEventListener("input", e => {
            this._drawTool.sizeJitterAmount = parseInt(e.target.value) / 100;
            this._drawTool.sizeJitter = this._drawTool.sizeJitterAmount > 0;
            document.getElementById("ie-draw-szjitter-lbl").textContent = e.target.value + "%";
        });
        document.getElementById("ie-draw-rotjitter")?.addEventListener("change", e => {
            this._drawTool.rotationJitter = e.target.checked;
        });
    }

    // ── Fill Tool (bucket fill) props ─────────────────────────────────────

    _renderFillProps() {
        const pane  = document.getElementById("ie-props-pane");
        const body  = document.getElementById("ie-props-body");
        const title = document.getElementById("ie-props-title");
        if (!pane || !body) return;
        pane.style.display = "flex";
        if (title) title.textContent = "Fill";

        const t = this._fillTool;
        const isGradient = t.fillMode === "gradient";
        body.innerHTML = `
            <div class="ie-props-row">
                <label>Mode</label>
                <div style="display:flex;gap:4px;">
                    <button class="it-btn it-btn-sm${!isGradient ? " ie-opt-active" : ""}" id="ie-fill-mode-solid"    style="flex:1;">Solid</button>
                    <button class="it-btn it-btn-sm${isGradient  ? " ie-opt-active" : ""}" id="ie-fill-mode-gradient" style="flex:1;">Gradient</button>
                </div>
            </div>
            ${!isGradient ? `
            <div class="ie-props-row">
                <label>Color</label>
                <input type="color" id="ie-fill-color" value="${t.color}"
                    style="width:36px;height:24px;padding:0;border:1px solid var(--it-border);cursor:pointer;border-radius:3px;flex-shrink:0;">
            </div>` : `
            <div class="ie-props-row">
                <label>Shape</label>
                <div style="display:flex;gap:4px;">
                    <button class="it-btn it-btn-sm${t.gradientShape === "linear" ? " ie-opt-active" : ""}" id="ie-fill-shape-linear" style="flex:1;">Linear</button>
                    <button class="it-btn it-btn-sm${t.gradientShape === "radial" ? " ie-opt-active" : ""}" id="ie-fill-shape-radial" style="flex:1;">Radial</button>
                </div>
            </div>
            <div class="ie-props-row" style="align-items:flex-start;">
                <label>Ramp</label>
                <div style="display:flex;flex-direction:column;gap:10px;flex:1;min-width:0;">
                    <canvas id="ie-fill-ramp" width="130" height="24" style="display:block;width:130px;height:24px;border:1px solid var(--it-border);border-radius:3px;cursor:pointer;"></canvas>
                    <div style="display:flex;align-items:center;gap:4px;">
                        <input type="color" id="ie-fill-stop-color" value="${t.gradientStops[t.selectedStopIdx]?.color ?? "#ffffff"}"
                            style="width:28px;height:22px;padding:0;border:1px solid var(--it-border);cursor:pointer;border-radius:3px;">
                        <button class="it-btn it-btn-sm" id="ie-fill-stop-add" title="Add stop">＋</button>
                        <button class="it-btn it-btn-sm" id="ie-fill-stop-remove" title="Remove stop">－</button>
                    </div>
                </div>
            </div>
            <div class="ie-props-row" style="align-items:flex-start;">
                <label>Direction</label>
                <div style="display:flex;align-items:center;gap:6px;">
                    <canvas id="ie-fill-dir" width="70" height="70" style="width:70px;height:70px;border:1px solid var(--it-border);border-radius:3px;cursor:crosshair;"></canvas>
                    <span id="ie-fill-strength-lbl" style="font-size:11px;color:var(--it-text-secondary);">${t.gradientStrength.toFixed(1)}</span>
                </div>
            </div>`}
            <div class="ie-props-row">
                <label>Tolerance</label>
                <input type="range" id="ie-fill-tolerance" min="0" max="255" value="${t.tolerance}">
                <span id="ie-fill-tolerance-lbl">${t.tolerance}</span>
            </div>
            <div class="ie-props-row">
                <label>Opacity</label>
                <input type="range" id="ie-fill-opacity" min="1" max="100" value="${Math.round(t.opacity * 100)}">
                <span id="ie-fill-opacity-lbl">${Math.round(t.opacity * 100)}%</span>
            </div>
        `;

        document.getElementById("ie-fill-mode-solid")?.addEventListener("click", () => {
            t.fillMode = "solid";
            this._renderFillProps();
        });
        document.getElementById("ie-fill-mode-gradient")?.addEventListener("click", () => {
            t.fillMode = "gradient";
            this._renderFillProps();
        });
        document.getElementById("ie-fill-color")?.addEventListener("input", e => { t.color = e.target.value; });
        document.getElementById("ie-fill-tolerance")?.addEventListener("input", e => {
            t.tolerance = parseInt(e.target.value);
            document.getElementById("ie-fill-tolerance-lbl").textContent = e.target.value;
        });
        document.getElementById("ie-fill-opacity")?.addEventListener("input", e => {
            t.opacity = parseInt(e.target.value) / 100;
            document.getElementById("ie-fill-opacity-lbl").textContent = e.target.value + "%";
        });

        if (isGradient) {
            document.getElementById("ie-fill-shape-linear")?.addEventListener("click", () => {
                t.gradientShape = "linear";
                this._renderFillProps();
            });
            document.getElementById("ie-fill-shape-radial")?.addEventListener("click", () => {
                t.gradientShape = "radial";
                this._renderFillProps();
            });
            document.getElementById("ie-fill-stop-color")?.addEventListener("input", e => {
                t.gradientStops[t.selectedStopIdx].color = e.target.value;
                this._drawFillGradientRamp();
            });
            document.getElementById("ie-fill-stop-add")?.addEventListener("click", () => {
                t.addStop();
                this._renderFillProps();
            });
            document.getElementById("ie-fill-stop-remove")?.addEventListener("click", () => {
                t.removeStop();
                this._renderFillProps();
            });
            this._setupFillGradientRamp();
            this._setupFillGradientDir();
        }
    }

    /** カラーランプ(複数ストップの線形プレビュー)の描画とドラッグ操作。particle_widget.jsのカラーランプUIを移植。 */
    _drawFillGradientRamp() {
        const canvas = document.getElementById("ie-fill-ramp");
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        const w = canvas.width, h = canvas.height;
        const t = this._fillTool;
        ctx.clearRect(0, 0, w, h);

        const barH = h - 10; // 下部にハンドル用の余白を確保
        const grad = ctx.createLinearGradient(0, 0, w, 0);
        [...t.gradientStops].sort((a, b) => a.pos - b.pos).forEach(s => grad.addColorStop(s.pos, s.color));
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, barH);
        ctx.strokeStyle = "#666";
        ctx.strokeRect(0.5, 0.5, w - 1, barH - 1);

        t.gradientStops.forEach((s, i) => {
            // ハンドル(三角形)がcanvas端で切れて見えなくならないようクランプする
            const x = Math.max(5, Math.min(w - 5, s.pos * w));
            ctx.beginPath();
            ctx.moveTo(x, h);
            ctx.lineTo(x - 5, barH);
            ctx.lineTo(x + 5, barH);
            ctx.closePath();
            ctx.fillStyle = i === t.selectedStopIdx ? "#0077ff" : "#999";
            ctx.fill();
        });
    }

    _setupFillGradientRamp() {
        const canvas = document.getElementById("ie-fill-ramp");
        if (!canvas) return;
        this._drawFillGradientRamp();

        const t = this._fillTool;
        const hitTestStop = mx => {
            let best = -1, bestDist = 9;
            t.gradientStops.forEach((s, i) => {
                const d = Math.abs(s.pos * canvas.width - mx);
                if (d < bestDist) { bestDist = d; best = i; }
            });
            return best;
        };

        canvas.addEventListener("mousedown", e => {
            const rect = canvas.getBoundingClientRect();
            const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
            const idx = hitTestStop(mx);
            if (idx < 0) return;
            t.selectStop(idx);
            // ドラッグ中onMove/onUpが参照し続けるcanvas要素が入れ替わらないよう、
            // DOM全体を再構築する_renderFillProps()は使わず、選択状態の見た目だけを部分更新する
            this._drawFillGradientRamp();
            const colorInput = document.getElementById("ie-fill-stop-color");
            if (colorInput) colorInput.value = t.gradientStops[idx].color;

            const onMove = ev => {
                const r = canvas.getBoundingClientRect();
                const x = (ev.clientX - r.left) * (canvas.width / r.width);
                t.gradientStops[t.selectedStopIdx].pos = Math.max(0, Math.min(1, x / canvas.width));
                this._drawFillGradientRamp();
            };
            const onUp = () => {
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        });
    }

    /** グラデーション方向(linear)／半径(radial)を指定するミニコンパスUI。particle_widget.jsの矢印方向ハンドルを移植。 */
    _drawFillGradientDir() {
        const canvas = document.getElementById("ie-fill-dir");
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        const w = canvas.width, h = canvas.height, cx = w / 2, cy = h / 2;
        const maxR = Math.min(w, h) / 2 - 6;
        const t = this._fillTool;
        const distFrac = (Math.max(0.2, Math.min(3.0, t.gradientStrength)) - 0.2) / 2.8;
        const dist = 6 + distFrac * (maxR - 6);
        ctx.clearRect(0, 0, w, h);

        ctx.strokeStyle = "#888";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx - 4, cy); ctx.lineTo(cx + 4, cy);
        ctx.moveTo(cx, cy - 4); ctx.lineTo(cx, cy + 4);
        ctx.stroke();

        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = "#0077ff";
        if (t.gradientShape === "radial") {
            ctx.beginPath();
            ctx.arc(cx, cy, dist, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            this._fillDirHandlePos = { x: cx + dist, y: cy };
        } else {
            const rad = t.gradientAngleDeg * Math.PI / 180;
            const ex = cx + Math.cos(rad) * dist, ey = cy + Math.sin(rad) * dist;
            ctx.beginPath();
            ctx.moveTo(cx, cy); ctx.lineTo(ex, ey);
            ctx.stroke();
            ctx.setLineDash([]);
            this._fillDirHandlePos = { x: ex, y: ey };
        }
        ctx.beginPath();
        ctx.arc(this._fillDirHandlePos.x, this._fillDirHandlePos.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#ffcc00";
        ctx.fill();
    }

    _setupFillGradientDir() {
        const canvas = document.getElementById("ie-fill-dir");
        if (!canvas) return;
        this._drawFillGradientDir();

        const t = this._fillTool;
        const w = canvas.width, h = canvas.height, cx = w / 2, cy = h / 2;
        const maxR = Math.min(w, h) / 2 - 6;

        const applyDrag = (mx, my) => {
            const dx = mx - cx, dy = my - cy;
            const dist = Math.max(6, Math.min(maxR, Math.hypot(dx, dy)));
            t.gradientStrength = 0.2 + ((dist - 6) / (maxR - 6)) * 2.8;
            if (t.gradientShape === "linear") t.gradientAngleDeg = Math.atan2(dy, dx) * 180 / Math.PI;
            this._drawFillGradientDir();
            const lbl = document.getElementById("ie-fill-strength-lbl");
            if (lbl) lbl.textContent = t.gradientStrength.toFixed(1);
        };

        canvas.addEventListener("mousedown", e => {
            const rect = canvas.getBoundingClientRect();
            applyDrag((e.clientX - rect.left) * (w / rect.width), (e.clientY - rect.top) * (h / rect.height));
            const onMove = ev => {
                const r = canvas.getBoundingClientRect();
                applyDrag((ev.clientX - r.left) * (w / r.width), (ev.clientY - r.top) * (h / r.height));
            };
            const onUp = () => {
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        });
    }

    // ── Mask Editor One 追加ツール: 初期化・切り替え ──────────────────────────

    _initMaskEditorOneTools() {
        if (this._maskColorTool) return; // 初期化済み
        const overlayCanvas = document.getElementById("ie-canvas-overlay");
        const onChange = () => { this._updateCompositeView(); this._refreshLayerList(); };

        this._maskColorTool  = new MaskColorTool();
        this._maskColorTool.onChange(onChange);

        this._maskAlphaTool  = new MaskAlphaTool();
        this._maskAlphaTool.onChange(onChange);

        this._maskTextTool   = new MaskTextTool();
        this._maskTextTool.onChange(onChange);

        this._maskVectorTool = new MaskVectorTool();
        this._maskVectorTool.setPreviewCanvas(overlayCanvas);
        this._maskVectorTool.onBeforeCommit = () => this._saveUndo();
        this._maskVectorTool.onChange(() => { onChange(); this._renderMaskProps("vector"); });

        this._maskShapeTool  = new MaskShapeTool();
        this._maskShapeTool.setPreviewCanvas(overlayCanvas);
        this._maskShapeTool.onChange(onChange);
    }

    _deactivateMaskSubtool() {
        const sub = this._maskSubtool;
        if (sub === "paint")  this._maskTool?.deactivate();
        if (sub === "color")  this._maskColorTool?.deactivate();
        if (sub === "alpha")  this._maskAlphaTool?.deactivate();
        if (sub === "text")   this._maskTextTool?.deactivate();
        if (sub === "vector") this._maskVectorTool?.deactivate();
        if (sub === "shape")  this._maskShapeTool?.deactivate();
    }

    _activateMaskSubtool() {
        const sub         = this._maskSubtool;
        const activeLayer = this._layerMgr?.activeLayer;
        const canvas      = activeLayer?.type === "mask" ? activeLayer.canvas : null;
        if (sub === "paint" && this._maskTool) {
            if (canvas) this._maskTool.setCanvas(canvas);
            this._maskTool.activate();
        } else if (sub === "color" && this._maskColorTool) {
            if (canvas) this._maskColorTool.setCanvas(canvas);
            this._maskColorTool.activate();
        } else if (sub === "alpha" && this._maskAlphaTool) {
            if (canvas) this._maskAlphaTool.setCanvas(canvas);
            this._maskAlphaTool.activate();
        } else if (sub === "text" && this._maskTextTool) {
            if (canvas) this._maskTextTool.setCanvas(canvas);
            this._maskTextTool.activate();
        } else if (sub === "vector" && this._maskVectorTool) {
            if (canvas) this._maskVectorTool.setCanvas(canvas);
            this._maskVectorTool.activate();
        } else if (sub === "shape" && this._maskShapeTool) {
            if (canvas) this._maskShapeTool.setCanvas(canvas);
            this._maskShapeTool.activate();
        }
    }

    _switchMaskSubtool(sub) {
        this._deactivateMaskSubtool();
        this._maskSubtool = sub;
        this._renderToolOptions("mask");
        this._activateMaskSubtool();
    }

    // マスクを除いた全表示レイヤーを合成した背景キャンバスを生成（ColorTool/AlphaTool 用）
    _buildBgCanvas() {
        const canvas = document.createElement("canvas");
        canvas.width  = this._canvasW;
        canvas.height = this._canvasH;
        if (!this._layerMgr) return canvas;
        const ctx    = canvas.getContext("2d");
        const layers = this._layerMgr.layers;
        for (let i = layers.length - 1; i >= 0; i--) {
            const layer = layers[i];
            if (!layer.visible || layer.type === "mask") continue;
            ctx.save();
            ctx.globalAlpha = layer.opacity;
            ctx.globalCompositeOperation = layer.blendMode;
            Layer.applyTransform(ctx, layer);
            ctx.drawImage(layer.canvas, -layer.canvas.width / 2, -layer.canvas.height / 2);
            ctx.restore();
        }
        return canvas;
    }

    _renderMaskLayerOverlay(ctx, maskLayer) {
        const overlayColor = this._maskOverlayColor;
        const blurPx       = this._maskBlur;
        const inverted     = this._maskInverted;

        const mw = maskLayer.canvas.width;
        const mh = maskLayer.canvas.height;

        const tmp = document.createElement("canvas");
        tmp.width  = mw;
        tmp.height = mh;
        const tc = tmp.getContext("2d");

        tc.fillStyle = overlayColor;
        tc.fillRect(0, 0, mw, mh);
        tc.globalCompositeOperation = inverted ? "destination-out" : "destination-in";
        tc.drawImage(maskLayer.canvas, 0, 0);
        tc.globalCompositeOperation = "source-over";

        ctx.save();
        ctx.globalAlpha = 0.55 * maskLayer.opacity;
        if (blurPx > 0) ctx.filter = `blur(${blurPx}px)`;
        Layer.applyTransform(ctx, maskLayer);
        ctx.drawImage(tmp, -mw / 2, -mh / 2);
        ctx.restore();
        if (blurPx > 0) ctx.filter = "none";
    }

    // ── アクションバー ─────────────────────────────

    _setupActionBar() {
        document.getElementById("ie-upload-input")?.addEventListener("change", e => {
            const file = e.target.files?.[0];
            if (file) this._loadFile(file);
            e.target.value = "";
        });

        document.getElementById("ie-new-btn")?.addEventListener("click", () => this._newCanvas());
        document.getElementById("ie-close-btn")?.addEventListener("click", () => this._closeDocument());
        document.getElementById("ie-undo-btn")?.addEventListener("click", () => this._undo());
        document.getElementById("ie-redo-btn")?.addEventListener("click", () => this._redo());
        document.getElementById("ie-pixifx-btn")?.addEventListener("click", () => this._openPixiFx());
        document.getElementById("ie-save-btn")?.addEventListener("click", () => this._savePng());
        document.getElementById("ie-save-project-btn")?.addEventListener("click", () => this._saveProject());
        document.getElementById("ie-save-gallery-btn")?.addEventListener("click", () => this._saveToGallery());
        document.getElementById("ie-save-eagle-btn")?.addEventListener("click", () => this._saveToEagle());
        document.getElementById("ie-upload-comfy-btn")?.addEventListener("click", () => this._uploadToComfyUI());
        document.getElementById("ie-send-i2i-btn")?.addEventListener("click", () => this._sendToI2I());
        document.getElementById("ie-save-layout-btn")?.addEventListener("click", () => this._saveToLayout());
        document.getElementById("ie-zoom-fit")?.addEventListener("click", () => this._fitToView());
        document.getElementById("ie-zoom-100")?.addEventListener("click", () => {
            this._panOffset = { x: 0, y: 0 }; this._setZoom(1.0);
        });

        const tab = document.getElementById("image-tab");
        if (tab) {
            tab.addEventListener("dragover", e => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
            tab.addEventListener("drop", e => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file && file.type.startsWith("image/")) this._loadFile(file);
            });
        }
    }

    // ── Canvas イベント ───────────────────────────

    _setupCanvasEvents() {
        const wrap = document.getElementById("ie-canvas-wrap");
        if (!wrap) return;

        wrap.addEventListener("wheel", e => {
            e.preventDefault();
            this._setZoom(this._zoom * (e.deltaY > 0 ? 0.9 : 1.1));
        }, { passive: false });

        wrap.addEventListener("mousedown", e => {
            if (e.button === 1 || (e.button === 0 && this._spaceDown)) {
                e.preventDefault();
                this._panning  = true;
                this._panStart = { x: e.clientX - this._panOffset.x, y: e.clientY - this._panOffset.y };
                wrap.style.cursor = "grabbing";
                return;
            }
            // Draw/Mask: allow starting a stroke from the canvas margin area
            if (e.button !== 0) return;
            const tool = this._activeTool;
            if (tool !== "draw" && tool !== "mask") return;
            const drawCanvas    = document.getElementById("ie-canvas-draw");
            const overlayCanvas = document.getElementById("ie-canvas-overlay");
            if (e.target === drawCanvas || e.target === overlayCanvas) return;
            if (!this._layerMgr || !drawCanvas) return;
            this._onToolMouseDown(e, drawCanvas);
        });
        window.addEventListener("mousemove", e => {
            if (this._panning) {
                this._panOffset.x = e.clientX - this._panStart.x;
                this._panOffset.y = e.clientY - this._panStart.y;
                this._applyTransform();
            }
            const tool = this._activeTool;
            if (this._eyedropperActive) {
                this._hideBrushCursor();
            } else if (tool === "draw" || tool === "mask") {
                this._updateBrushCursor(e);
                const isDrawing = tool === "draw"
                    ? this._drawTool?._drawing
                    : this._maskTool?._drawing;
                if (isDrawing) {
                    const refCanvas = document.getElementById("ie-canvas-draw");
                    if (refCanvas) this._onToolMouseMove(e, refCanvas);
                }
            }
        });
        window.addEventListener("mouseup", e => {
            if (this._panning && (e.button === 1 || e.button === 0)) {
                this._panning = false;
                wrap.style.cursor = this._spaceDown ? "grab" : "";
            }
            if (e.button === 0) {
                const tool = this._activeTool;
                if (tool === "draw" && this._drawTool?._drawing) this._drawTool.onMouseUp();
                if (tool === "mask" && this._maskTool?._drawing) this._maskTool.onMouseUp();
            }
        });

        const drawCanvas = document.getElementById("ie-canvas-draw");
        if (drawCanvas) {
            drawCanvas.addEventListener("mousedown",  e => this._onToolMouseDown(e, drawCanvas));
            drawCanvas.addEventListener("mousemove",  e => this._onToolMouseMove(e, drawCanvas));
            drawCanvas.addEventListener("mouseup",    e => this._onToolMouseUp(e));
            drawCanvas.addEventListener("mouseleave", () => this._onToolMouseLeave());
            // Textツール時はoverlayがpointer-events:noneでdblclickがここに落ちるため、
            // drawCanvas側にもテキスト再編集のダブルクリックを張る（Selectツール時はoverlay側が受ける）
            drawCanvas.addEventListener("dblclick",   e => this._onOverlayDblClick(e, drawCanvas));
        }

        const overlay = document.getElementById("ie-canvas-overlay");
        if (overlay) {
            overlay.addEventListener("mousedown",  e => this._onToolMouseDown(e, overlay));
            overlay.addEventListener("mousemove",  e => this._onToolMouseMove(e, overlay));
            overlay.addEventListener("mouseup",    e => this._onToolMouseUp(e));
            overlay.addEventListener("mouseleave", () => this._onToolMouseLeave());
            overlay.addEventListener("dblclick", e => this._onOverlayDblClick(e, overlay));
        }
    }

    _onToolMouseDown(e, refCanvas) {
        if (!this._layerMgr || e.button !== 0 || this._spaceDown) return;
        const pos = DrawTool.getCanvasPos(refCanvas, e);

        if (this._eyedropperActive) {
            this._pickColorAt(pos.x, pos.y);
            return;
        }

        if (this._activeTool === "draw" && this._drawTool) {
            const activeLayer = this._layerMgr.activeLayer;
            if (!activeLayer) return;
            this._saveUndo();
            this._drawTool.setCanvas(activeLayer.canvas);
            this._drawTool.onMouseDown(pos.x, pos.y);
            this._updateCompositeView();

        } else if (this._activeTool === "fill" && this._fillTool) {
            const activeLayer = this._layerMgr.activeLayer;
            if (!activeLayer) return;
            this._saveUndo();
            this._fillTool.setCanvas(activeLayer.canvas);
            this._fillTool.onMouseDown(pos.x, pos.y);
            this._updateCompositeView();

        } else if (this._activeTool === "mask") {
            const activeLayer = this._layerMgr.activeLayer;
            if (!activeLayer || activeLayer.type !== "mask") {
                this._toast("Select a mask layer first", "info");
                return;
            }
            const sub = this._maskSubtool;
            if (sub === "paint" && this._maskTool) {
                this._saveUndo();
                this._maskTool.setCanvas(activeLayer.canvas);
                this._maskTool.onMouseDown(pos.x, pos.y);
                this._updateCompositeView();
            } else if (sub === "color" && this._maskColorTool) {
                this._saveUndo();
                this._maskColorTool.setCanvas(activeLayer.canvas);
                this._maskColorTool.setBgCanvas(this._buildBgCanvas());
                this._maskColorTool.onMouseDown(pos.x, pos.y);
                this._updateCompositeView();
                this._refreshLayerList();
            } else if (sub === "text" && this._maskTextTool) {
                this._maskTextTool.setCanvas(activeLayer.canvas);
                this._maskTextTool.onMouseDown(pos.x, pos.y);
            } else if (sub === "vector" && this._maskVectorTool) {
                this._maskVectorTool.setCanvas(activeLayer.canvas);
                this._maskVectorTool.onMouseDown(pos.x, pos.y);
                this._renderMaskProps("vector");
            } else if (sub === "shape" && this._maskShapeTool) {
                this._saveUndo();
                this._maskShapeTool.setCanvas(activeLayer.canvas);
                this._maskShapeTool.onMouseDown(pos.x, pos.y);
            }

        } else if (this._activeTool === "shape" && this._shapeTool) {
            this._shapeTool.onMouseDown(pos.x, pos.y);

        } else if (this._activeTool === "text" && this._textTool) {
            // 既存テキストレイヤーの上ではシングルクリックで新規入力を開かない
            // （Selectツールと同じくダブルクリックで再編集を開く。_onOverlayDblClick参照）
            // 入力オーバーレイ表示中は従来通りキャンバスクリックで閉じる（onMouseDown内で処理）
            if (!this._textTool._overlay && this._findTextLayerAt(pos.x, pos.y)) return;
            this._textTool.onMouseDown(pos.x, pos.y);

        } else if (this._activeTool === "select" && this._selectTool) {
            const result = this._selectTool.onMouseDown(pos.x, pos.y, this._layerMgr);
            if (result === "select") {
                const sel = this._selectTool.getSelectedLayer();
                if (sel) { this._layerMgr.setActive(sel.id); this._refreshLayerList(); }
            } else if (result && result !== null) {
                this._saveUndo();
            }
        } else if (this._activeTool === "blur" && this._blurRectMode) {
            this._blurDragging  = true;
            this._blurDragStart = { x: pos.x, y: pos.y };
            this._blurDragCur   = { x: pos.x, y: pos.y };
        }
    }

    _onToolMouseMove(e, refCanvas) {
        if (!this._layerMgr) return;
        const pos = DrawTool.getCanvasPos(refCanvas, e);
        if (this._activeTool === "draw") {
            this._drawTool?.onMouseMove(pos.x, pos.y);
            if (this._drawTool?._drawing) this._updateCompositeView();
        }
        if (this._activeTool === "mask") {
            const sub = this._maskSubtool;
            if (sub === "paint") {
                this._maskTool?.onMouseMove(pos.x, pos.y);
                if (this._maskTool?._drawing) this._updateCompositeView();
            } else if (sub === "vector") {
                this._maskVectorTool?.onMouseMove(pos.x, pos.y);
            } else if (sub === "shape") {
                this._maskShapeTool?.onMouseMove(pos.x, pos.y, e);
            }
        }
        if (this._activeTool === "shape")  this._shapeTool?.onMouseMove(pos.x, pos.y);
        if (this._activeTool === "select") this._selectTool?.onMouseMove(pos.x, pos.y);
        if (this._activeTool === "blur" && this._blurDragging) {
            this._blurDragCur = pos;
            this._drawBlurPreview();
        }
    }

    _onToolMouseUp(e) {
        if (!this._layerMgr || e.button !== 0) return;
        if (this._activeTool === "draw")   this._drawTool?.onMouseUp();
        if (this._activeTool === "mask") {
            const sub = this._maskSubtool;
            if (sub === "paint") this._maskTool?.onMouseUp();
            else if (sub === "shape") {
                const activeLayer = this._layerMgr?.activeLayer;
                if (activeLayer?.type === "mask") {
                    this._maskShapeTool?.onMouseUp();
                    this._updateCompositeView();
                    this._refreshLayerList();
                }
            }
        }
        if (this._activeTool === "shape")  this._shapeTool?.onMouseUp();
        if (this._activeTool === "select") this._selectTool?.onMouseUp();
        if (this._activeTool === "blur" && this._blurDragging) {
            this._blurDragging = false;
            this._applyRectEffect();
            const overlay = document.getElementById("ie-canvas-overlay");
            if (overlay) overlay.getContext("2d").clearRect(0, 0, overlay.width, overlay.height);
        }
    }

    _onToolMouseLeave() {
        // Draw/Mask: do NOT stop the stroke — window mousemove/mouseup continue tracking
        this._hideBrushCursor();
        if (this._activeTool === "shape")  this._shapeTool?.onMouseLeave();
        if (this._activeTool === "select") this._selectTool?.onMouseLeave();
        if (this._activeTool === "mask" && this._maskSubtool === "vector") this._maskVectorTool?.onMouseLeave();
        if (this._activeTool === "blur" && this._blurDragging) {
            this._blurDragging = false;
            const overlay = document.getElementById("ie-canvas-overlay");
            if (overlay) overlay.getContext("2d").clearRect(0, 0, overlay.width, overlay.height);
        }
    }

    // ── 画像ロード ────────────────────────────────

    async _loadFile(file) {
        const dataUrl = await new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.readAsDataURL(file);
        });
        await this._loadFromDataUrl(dataUrl, file.name.replace(/\.[^.]+$/, ""));
    }

    async _loadFromDataUrl(dataUrl, baseName = "image") {
        const img = await new Promise(resolve => {
            const i = new Image();
            i.onload  = () => resolve(i);
            i.onerror = () => resolve(null);
            i.src = dataUrl;
        });
        if (!img) { this._toast("Failed to load image", "error"); return; }

        const hasLayers = this._layerMgr && this._layerMgr.layers.length > 0;

        if (hasLayers) {
            this._syncActiveLayerFromCanvas();
            this._saveUndo();
            const fit = fitToCanvas(img.width, img.height, this._canvasW, this._canvasH);
            const newLayer = this._layerMgr.addLayer("image", baseName, {
                contentW: img.width, contentH: img.height,
                displayW: fit.w,     displayH: fit.h,
                x: Math.round((this._canvasW - fit.w) / 2),
                y: Math.round((this._canvasH - fit.h) / 2),
            });
            newLayer.ctx.drawImage(img, 0, 0);
            this._layerMgr.setActive(newLayer.id);
            if (this._activeTool !== "select") this._setActiveTool("select");
            this._selectTool?.setLayer(newLayer);
            this._updateCompositeView();
            this._refreshLayerList();
            document.getElementById("ie-placeholder").style.display = "none";
            this._toast(`Image added: ${img.width}×${img.height}`, "success");
            return;
        }

        // 新規キャンバス（Layer 1に画像配置）
        this._canvasW  = img.width;
        this._canvasH  = img.height;
        this._baseName = baseName;
        this._initCanvases();

        const layer1 = this._layerMgr.addLayer("image", "Layer 1", {
            contentW: img.width, contentH: img.height,
            displayW: img.width, displayH: img.height,
            x: 0, y: 0,
        });
        layer1.ctx.drawImage(img, 0, 0);
        layer1.locked = true; // 初期画像は誤操作防止のため自動ロック

        this._undoStack = [];
        this._redoStack = [];

        this._setActiveTool("select");
        this._selectTool?.setLayer(layer1);
        this._refreshLayerList();
        this._updateCompositeView();
        this._fitToView();

        document.getElementById("ie-placeholder").style.display = "none";
        this._toast(`Loaded: ${img.width}×${img.height}`, "success");
    }

    /** 現在のドキュメントを閉じる（未保存確認あり）。空の状態なら何もしない */
    _closeDocument() {
        if (!this._layerMgr) return;
        this._showCloseConfirmDialog();
    }

    _showCloseConfirmDialog() {
        const overlay = document.createElement("div");
        overlay.className = "ie-confirm-overlay";
        overlay.innerHTML = `
            <div class="ie-confirm-box">
                <div class="ie-confirm-title">${t("image.closeConfirmTitle")}</div>
                <div class="ie-confirm-body">${t("image.closeConfirmBody")}</div>
                <div class="ie-confirm-btns">
                    <button class="it-btn it-btn-sm it-btn-primary" id="ie-close-save-btn">${t("image.closeSaveBtn")}</button>
                    <button class="it-btn it-btn-sm" id="ie-close-discard-btn">${t("image.closeDiscardBtn")}</button>
                    <button class="it-btn it-btn-sm" id="ie-close-cancel-btn">${t("common.cancel")}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        const close = () => overlay.remove();
        overlay.querySelector("#ie-close-save-btn").addEventListener("click", async () => {
            const saved = await this._saveProject();
            close();
            if (saved) this._resetToEmpty();
        });
        overlay.querySelector("#ie-close-discard-btn").addEventListener("click", () => {
            close();
            this._resetToEmpty();
        });
        overlay.querySelector("#ie-close-cancel-btn").addEventListener("click", close);
    }

    /** レイヤー・キャンバスを破棄し、プレースホルダー表示（未編集状態）に戻す */
    _resetToEmpty() {
        this._layerMgr  = null;
        this._undoStack = [];
        this._redoStack = [];
        this._sourceImageEl = null;
        this._baseName  = "image";

        ["ie-canvas-bg", "ie-canvas-draw", "ie-canvas-overlay"].forEach(id => {
            const c = document.getElementById(id);
            if (c) c.getContext("2d").clearRect(0, 0, c.width, c.height);
        });
        const layerListEl = document.getElementById("ie-layer-list");
        if (layerListEl) layerListEl.innerHTML = "";
        const placeholder = document.getElementById("ie-placeholder");
        if (placeholder) placeholder.style.display = "";

        this._toast("Document closed", "info");
    }

    _newCanvas() {
        const current = `${this._canvasW || 512}x${this._canvasH || 512}`;
        const input   = prompt("Canvas size (WxH):", current);
        if (!input) return;
        const m = input.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
        if (!m) { this._toast("Invalid format. Use WxH (e.g. 512x512)", "error"); return; }
        const w = parseInt(m[1]), h = parseInt(m[2]);
        if (w < 1 || h < 1 || w > 8192 || h > 8192) { this._toast("Size must be between 1 and 8192", "error"); return; }

        this._canvasW  = w;
        this._canvasH  = h;
        this._baseName = "new-canvas";
        this._initCanvases();

        // 空のキャンバスのままだと描画先レイヤーが無いため、作成直後に描画用レイヤーを1枚追加しておく
        const layer = this._layerMgr.addLayer("draw", "Layer 1");
        layer.displayW = w; layer.displayH = h;
        layer.x = 0; layer.y = 0;

        this._undoStack = [];
        this._redoStack = [];
        this._setActiveTool("select");
        this._refreshLayerList();
        this._updateCompositeView();
        this._fitToView();

        document.getElementById("ie-placeholder").style.display = "none";
        this._toast(`New canvas: ${w}×${h}`, "success");
    }

    _initCanvases() {
        const drawCanvas    = document.getElementById("ie-canvas-draw");
        const overlayCanvas = document.getElementById("ie-canvas-overlay");
        if (drawCanvas) { drawCanvas.width = this._canvasW; drawCanvas.height = this._canvasH; }
        if (overlayCanvas) { overlayCanvas.width = this._canvasW; overlayCanvas.height = this._canvasH; }

        const container = document.getElementById("ie-canvas-container");
        if (container) {
            container.style.width  = this._canvasW + "px";
            container.style.height = this._canvasH + "px";
        }

        this._layerMgr = new LayerManager(this._canvasW, this._canvasH);
        this._layerMgr.on("change", () => this._refreshLayerList());
        this._selectedLayerIds = new Set();

        this._drawTool = new DrawTool(null);
        this._drawTool.onChange(() => {
            this._updateCompositeView();
            this._refreshLayerList();
        });

        this._textTool = new TextTool(drawCanvas);
        this._textTool.onChange((clickX, clickY) => {
            const data  = this._textTool.createLayerData(clickX, clickY);
            const props = {
                text:       this._textTool.text,
                fontFamily: this._textTool.fontFamily,
                fontSize:   this._textTool.fontSize,
                bold:       this._textTool.bold,
                italic:     this._textTool.italic,
                align:      this._textTool.align,
                vertical:   this._textTool.vertical,
                color:      this._textTool.color,
                nativeW:    data.width,
                nativeH:    data.height,
            };
            const label = (props.text.slice(0, 20).replace(/\n/g, " ").trim()) || "Text";

            if (this._editingTextLayer) {
                const layer = this._editingTextLayer;
                this._editingTextLayer = null;
                this._saveUndo();
                layer.name = label;
                // 既存のスタイル系プロパティ（線・袋文字・影・下線等）を保持したまま基本値を更新し、
                // スタイル込みで再計測・再描画する（propsの完全置換＋無スタイル描画だとスタイルが消える）
                this._applyTextPropsToLayer(layer, { ...layer.textProps, ...props });
                this._selectTool?.setLayer(layer);
                this._updateCompositeView();
                this._refreshLayerList();
                return;
            }

            this._saveUndo();
            const textLayer = this._layerMgr.addLayer("text", label, {
                contentW: data.width,  contentH: data.height,
                displayW: data.width,  displayH: data.height,
                x: Math.round(data.x), y: Math.round(data.y),
            });
            textLayer.ctx.drawImage(data.canvas, 0, 0);
            textLayer.textProps = props;
            this._layerMgr.setActive(textLayer.id);
            this._setActiveTool("select");
            this._selectTool?.setLayer(textLayer);
            this._updateCompositeView();
            this._refreshLayerList();
        });

        this._shapeTool = new ShapeTool();
        this._shapeTool.onChange(shapeObj => {
            this._saveUndo();
            // Same Layerモード: 直前にシェイプツールが使ったレイヤーがまだアクティブならそこに追記する
            const activeLayer = this._layerMgr.activeLayer;
            let layer = (this._shapeSameLayer && this._shapeLayerId && activeLayer?.id === this._shapeLayerId)
                ? activeLayer : null;
            if (!layer) {
                const layerName = `Shape ${this._layerMgr.layers.length + 1}`;
                layer = this._layerMgr.addLayer("draw", layerName, {
                    contentW: this._canvasW, contentH: this._canvasH,
                    displayW: this._canvasW, displayH: this._canvasH,
                    x: 0, y: 0,
                });
                this._layerMgr.setActive(layer.id);
            }
            this._shapeLayerId = layer.id;
            ShapeTool.drawShape(layer.ctx, shapeObj);
            this._updateCompositeView();
            this._refreshLayerList();
        });

        this._fillTool = new FillTool();

        this._selectTool = new SelectTool();
        this._selectTool.setCanvas(overlayCanvas);
        this._selectTool.onChange(eventType => {
            if (eventType === "transformEnd") {
                const sel = this._selectTool.getSelectedLayer();
                if (sel?.type === "text" && sel.textProps) {
                    this._rerenderTextLayer(sel);
                }
                this._refreshLayerList();
            }
            this._updateCompositeView();
        });

        this._maskTool = new MaskTool(null);
        this._maskTool.onChange(() => {
            this._updateCompositeView();
            this._refreshLayerList();
        });

        this._compositeMode = false;
    }

    // drawCanvas ← activeLayerのみ（描画前リセット、compositeMode = false）
    _loadActiveLayerToCanvas() {
        const layer      = this._layerMgr?.activeLayer;
        const drawCanvas = document.getElementById("ie-canvas-draw");
        if (!layer || !drawCanvas) return;
        const ctx = drawCanvas.getContext("2d");
        ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
        ctx.drawImage(layer.canvas, 0, 0,
            layer.displayW, layer.displayH,
            layer.x, layer.y,
            layer.displayW, layer.displayH);
        this._compositeMode = false;
    }

    // drawCanvas → activeLayer に保存（compositeMode=true時はスキップ）
    _syncActiveLayerFromCanvas() {
        if (this._compositeMode) return;
        const layer      = this._layerMgr?.activeLayer;
        const drawCanvas = document.getElementById("ie-canvas-draw");
        if (!layer || !drawCanvas) return;
        layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
        const scaleX = layer.canvas.width  / layer.displayW;
        const scaleY = layer.canvas.height / layer.displayH;
        layer.ctx.save();
        layer.ctx.scale(scaleX, scaleY);
        layer.ctx.drawImage(drawCanvas, -layer.x * scaleX, -layer.y * scaleY);
        layer.ctx.restore();
    }

    // maskApply=true のマスクレイヤー群を、直後の1レイヤー（ターゲット）にグルーピングする
    // layers[0]=front … layers[n-1]=back が前提
    _computeMaskGroups(layers) {
        const maskGroupMap = new Map();
        const skipIndices  = new Set();
        let i = 0;
        while (i < layers.length) {
            if (layers[i].type === "mask" && layers[i].maskApply) {
                const frontIdx = i;
                const masks = [];
                while (i < layers.length && layers[i].type === "mask" && layers[i].maskApply) {
                    masks.push(layers[i]);
                    skipIndices.add(i);
                    i++;
                }
                if (i < layers.length) {
                    maskGroupMap.set(frontIdx, { masks, target: layers[i], targetIdx: i });
                    skipIndices.add(i);
                } else {
                    maskGroupMap.set(frontIdx, { masks, target: null, targetIdx: -1 });
                }
            } else {
                i++;
            }
        }
        return { maskGroupMap, skipIndices };
    }

    // 全可視レイヤーを変換付きで合成する共通ロジック（プレビュー／保存の両方から使用）
    // showOverlay=true のときも、実際にオーバーレイを描くのは「アクティブなマスクレイヤー」のみ
    // （マスク以外のレイヤーを選択中は非表示 = 編集対象でないマスクの赤色ガイドは出さない）
    _renderLayersComposite(ctx, canvas, showOverlay) {
        const layers = this._layerMgr.layers;
        const { maskGroupMap, skipIndices } = this._computeMaskGroups(layers);
        const activeLayer = this._layerMgr.activeLayer;

        for (let j = layers.length - 1; j >= 0; j--) {
            if (skipIndices.has(j)) {
                if (maskGroupMap.has(j)) {
                    const group = maskGroupMap.get(j);
                    const groupShowOverlay = showOverlay && group.masks.includes(activeLayer);
                    this._renderMaskGroup(ctx, canvas, group.masks, group.target, groupShowOverlay);
                }
                continue;
            }
            const layer = layers[j];
            if (!layer.visible) continue;

            if (layer.type === "mask") {
                if (showOverlay && layer === activeLayer) this._renderMaskLayerOverlay(ctx, layer);
            } else if (layer.type === "adjustment") {
                this._applyAdjustmentLayer(ctx, layer);
            } else {
                ctx.save();
                ctx.globalAlpha = layer.opacity;
                ctx.globalCompositeOperation = layer.blendMode;
                Layer.applyTransform(ctx, layer);
                ctx.drawImage(layer.canvas, -layer.canvas.width / 2, -layer.canvas.height / 2);
                ctx.restore();
            }
        }
        this._applyGlobalOpacity(ctx, canvas);
    }

    // 全可視レイヤーを変換付きで合成 → drawCanvas（compositeMode = true）
    _updateCompositeView() {
        const drawCanvas = document.getElementById("ie-canvas-draw");
        if (!drawCanvas || !this._layerMgr) return;
        const ctx = drawCanvas.getContext("2d");
        ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
        this._renderLayersComposite(ctx, drawCanvas, true);
        this._compositeMode = true;
    }

    // 全体不透明度（imgeditタブの調整レイヤーパネルから移植）: 合成結果全体に一括で適用する
    _applyGlobalOpacity(ctx, canvas) {
        if (this._globalOpacity >= 1.0) return;
        const tmp = document.createElement("canvas");
        tmp.width = canvas.width; tmp.height = canvas.height;
        tmp.getContext("2d").drawImage(canvas, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.globalAlpha = this._globalOpacity;
        ctx.drawImage(tmp, 0, 0);
        ctx.restore();
    }

    // 調整レイヤー: 自分より下（すでにctxに描画済みの部分）全体にフィルタを適用する
    _applyAdjustmentLayer(ctx, layer) {
        const def = ADJ_DEFS[layer.adjType];
        if (!def || !layer.adjValue) return;
        const w = this._canvasW, h = this._canvasH;
        const alpha = layer.opacity ?? 1.0;
        const applyAdj = () => {
            switch (layer.adjType) {
                case "brightness":
                case "contrast":
                case "saturation":
                case "hue":
                case "sepia":
                case "grayscale":
                case "invert":
                case "temperature":
                    _applyPixelAdj(ctx, w, h, layer.adjType, layer.adjValue);
                    break;
                case "blur":     _applyBlurFilter(ctx, w, h, layer.adjValue);    break;
                case "sharpen":  _applySharpenFilter(ctx, w, h, layer.adjValue); break;
                case "noise":    _applyNoiseFilter(ctx, w, h, layer.adjValue);   break;
                case "vignette": _applyVignette(ctx, w, h, layer.adjValue);     break;
            }
        };
        if (alpha >= 1.0) {
            applyAdj();
        } else {
            const before = ctx.getImageData(0, 0, w, h);
            applyAdj();
            const after = ctx.getImageData(0, 0, w, h);
            const bd = before.data, ad = after.data;
            for (let i = 0; i < bd.length; i++) {
                ad[i] = Math.round(bd[i] * (1 - alpha) + ad[i] * alpha);
            }
            ctx.putImageData(after, 0, 0);
        }
    }

    // マスクレイヤー群（複数可、文書順=重ね順・後勝ち）から1枚の合成マスクcanvasを作る
    _buildMaskCanvas(maskLayers, W, H) {
        const maskCanvas = document.createElement("canvas");
        maskCanvas.width  = W;
        maskCanvas.height = H;
        const mc = maskCanvas.getContext("2d");
        for (let k = maskLayers.length - 1; k >= 0; k--) {
            const ml = maskLayers[k];
            if (!ml.visible) continue;
            mc.save();
            mc.globalAlpha = ml.opacity;
            mc.globalCompositeOperation = ml.operation === "subtract" ? "destination-out" : "lighten";
            Layer.applyTransform(mc, ml);
            mc.drawImage(ml.canvas, -ml.canvas.width / 2, -ml.canvas.height / 2);
            mc.restore();
        }
        return maskCanvas;
    }

    _renderMaskGroup(ctx, drawCanvas, maskLayers, targetLayer, showOverlay = true) {
        const W = drawCanvas.width;
        const H = drawCanvas.height;

        if (!targetLayer) {
            if (showOverlay) {
                for (const ml of maskLayers) {
                    if (ml.visible) this._renderMaskLayerOverlay(ctx, ml);
                }
            }
            return;
        }

        const maskCanvas = this._buildMaskCanvas(maskLayers, W, H);

        // 調整レイヤー: マスクの範囲だけに効果を適用する（非マスク部分は元の絵に戻す）
        if (targetLayer.type === "adjustment") {
            if (targetLayer.visible) {
                const before = document.createElement("canvas");
                before.width  = W;
                before.height = H;
                before.getContext("2d").drawImage(ctx.canvas, 0, 0);

                this._applyAdjustmentLayer(ctx, targetLayer);

                ctx.save();
                ctx.globalCompositeOperation = this._maskInverted ? "destination-out" : "destination-in";
                ctx.drawImage(maskCanvas, 0, 0);
                ctx.restore();

                ctx.save();
                ctx.globalCompositeOperation = "destination-over";
                ctx.drawImage(before, 0, 0);
                ctx.restore();
            }
            if (showOverlay) {
                for (const ml of maskLayers) {
                    if (ml.visible) this._renderMaskLayerOverlay(ctx, ml);
                }
            }
            return;
        }

        const tmp = document.createElement("canvas");
        tmp.width  = W;
        tmp.height = H;
        const tc = tmp.getContext("2d");
        if (targetLayer.visible) {
            tc.save();
            tc.globalAlpha = targetLayer.opacity;
            tc.globalCompositeOperation = targetLayer.blendMode;
            Layer.applyTransform(tc, targetLayer);
            tc.drawImage(targetLayer.canvas, -targetLayer.canvas.width / 2, -targetLayer.canvas.height / 2);
            tc.restore();
        }
        tc.globalCompositeOperation = this._maskInverted ? "destination-out" : "destination-in";
        tc.drawImage(maskCanvas, 0, 0);

        ctx.drawImage(tmp, 0, 0);

        if (showOverlay) {
            for (const ml of maskLayers) {
                if (ml.visible) this._renderMaskLayerOverlay(ctx, ml);
            }
        }
    }

    // ── ズーム・パン ──────────────────────────────

    _fitToView() {
        const wrap = document.getElementById("ie-canvas-wrap");
        if (!wrap || !this._canvasW) return;
        this._zoom      = Math.min((wrap.clientWidth - 40) / this._canvasW, (wrap.clientHeight - 40) / this._canvasH, 2.0);
        this._panOffset = { x: 0, y: 0 };
        this._applyTransform();
    }

    _setZoom(z) {
        this._zoom = Math.max(0.05, Math.min(10, z));
        this._applyTransform();
    }

    _applyTransform() {
        const container = document.getElementById("ie-canvas-container");
        const wrap      = document.getElementById("ie-canvas-wrap");
        if (!container || !wrap) return;
        const tx = this._panOffset.x + (wrap.clientWidth  - this._canvasW * this._zoom) / 2;
        const ty = this._panOffset.y + (wrap.clientHeight - this._canvasH * this._zoom) / 2;
        container.style.transform = `translate(${tx}px,${ty}px) scale(${this._zoom})`;
        const zl = document.getElementById("ie-zoom-label");
        if (zl) zl.textContent = Math.round(this._zoom * 100) + "%";
    }

    // ── レイヤーパネル ────────────────────────────

    _setupLayerPanel() {
        document.getElementById("ie-add-layer-btn")?.addEventListener("click", () => {
            if (!this._layerMgr) return;
            this._syncActiveLayerFromCanvas();
            this._saveUndo();
            const layer = this._layerMgr.addLayer("draw", `Layer ${this._layerMgr.layers.length + 1}`);
            layer.displayW = this._canvasW; layer.displayH = this._canvasH;
            layer.x = 0; layer.y = 0;
            this._loadActiveLayerToCanvas();
            this._updateCompositeView();
            this._activateCurrentTool();
        });

        document.getElementById("ie-add-mask-btn")?.addEventListener("click", () => {
            if (!this._layerMgr) { this._toast("Open an image first", "info"); return; }
            this._syncActiveLayerFromCanvas();
            this._saveUndo();
            const maskCount = this._layerMgr.layers.filter(l => l.type === "mask").length + 1;
            const layer = this._layerMgr.addLayer("mask", `Mask ${maskCount}`);
            layer.displayW = this._canvasW;
            layer.displayH = this._canvasH;
            layer.x = 0;
            layer.y = 0;
            this._layerMgr.setActive(layer.id);
            this._setActiveTool("mask");
            this._loadActiveLayerToCanvas();
            this._updateCompositeView();
            this._refreshLayerList();
            document.getElementById("ie-placeholder").style.display = "none";
            this._toast("Mask layer added", "success");
        });

        document.getElementById("ie-adj-add-btn")?.addEventListener("click", () => {
            if (!this._layerMgr) { this._toast("Open an image first", "info"); return; }
            const select = document.getElementById("ie-adj-type-select");
            const adjType = select?.value || "brightness";
            const def = ADJ_DEFS[adjType];
            if (!def) return;
            this._syncActiveLayerFromCanvas();
            this._saveUndo();
            const layer = this._layerMgr.addLayer("adjustment", def.label, {
                adjType, adjValue: def.defaultValue,
                displayW: this._canvasW, displayH: this._canvasH, x: 0, y: 0,
            });
            this._layerMgr.setActive(layer.id);
            this._selectTool?.clearSelection();
            this._renderAdjustProps(layer);
            this._updateCompositeView();
            this._refreshLayerList();
            document.getElementById("ie-placeholder").style.display = "none";
            this._toast(`${def.label} layer added`, "success");
        });

        document.getElementById("ie-del-layer-btn")?.addEventListener("click", () => {
            if (!this._layerMgr || this._layerMgr.layers.length <= 1) return;
            this._saveUndo();
            const active = this._layerMgr.activeLayer;
            if (active) this._layerMgr.deleteLayer(active.id);
            if (this._selectTool?.getSelectedLayer()?.id === active?.id) {
                this._selectTool.clearSelection();
            }
            this._updateCompositeView();
            this._activateCurrentTool();
        });

        document.getElementById("ie-layer-up-btn")?.addEventListener("click", () => {
            if (!this._layerMgr) return;
            const active = this._layerMgr.activeLayer;
            if (active) { this._layerMgr.moveUp(active.id); this._updateCompositeView(); }
        });

        document.getElementById("ie-layer-down-btn")?.addEventListener("click", () => {
            if (!this._layerMgr) return;
            const active = this._layerMgr.activeLayer;
            if (active) { this._layerMgr.moveDown(active.id); this._updateCompositeView(); }
        });

        document.getElementById("ie-layer-opacity")?.addEventListener("input", e => {
            if (!this._layerMgr) return;
            const v = parseInt(e.target.value) / 100;
            const active = this._layerMgr.activeLayer;
            if (active) { this._layerMgr.setOpacity(active.id, v); this._updateCompositeView(); }
            const lbl = document.getElementById("ie-layer-opacity-label");
            if (lbl) lbl.textContent = e.target.value + "%";
        });

        document.getElementById("ie-global-opacity")?.addEventListener("input", e => {
            this._globalOpacity = parseInt(e.target.value) / 100;
            const lbl = document.getElementById("ie-global-opacity-label");
            if (lbl) lbl.textContent = e.target.value + "%";
            this._updateCompositeView();
        });

        document.getElementById("ie-flatten-btn")?.addEventListener("click", () => this._flattenLayers());

        document.getElementById("ie-layer-duplicate-btn")?.addEventListener("click", () => {
            if (!this._layerMgr) { this._toast("Open an image first", "info"); return; }
            const active = this._layerMgr.activeLayer;
            if (!active) { this._toast(t("image.duplicateSelectFirst"), "info"); return; }
            this._syncActiveLayerFromCanvas();
            this._saveUndo();
            const copy = this._layerMgr.duplicateLayer(active.id);
            if (copy) {
                this._updateCompositeView();
                this._refreshLayerList();
                this._toast(t("image.duplicateDone"), "success");
            }
        });
    }

    // 統合ボタン: レイヤーパネルで2枚以上選択中なら選択レイヤーのみ統合、それ以外は全レイヤーを1枚のimageレイヤーに統合する
    // （imgeditタブの「統合」機能を移植。全統合は既存挙動のまま、選択統合を追加）
    _flattenLayers() {
        if (!this._layerMgr || this._layerMgr.layers.length === 0) return;

        const selectedIds = [...this._selectedLayerIds];
        if (selectedIds.length >= 2) {
            this._mergeSelectedLayers(selectedIds);
            return;
        }

        if (this._layerMgr.layers.length === 1 && this._layerMgr.layers[0].type === "image") {
            this._toast("Nothing to flatten", "info");
            return;
        }
        if (!confirm(t("image.flattenConfirm"))) return;

        this._syncActiveLayerFromCanvas();
        this._saveUndo();

        const canvas = this._buildCompositeCanvas();
        const w = this._canvasW, h = this._canvasH;
        const flat = new Layer("Flattened", "image", w, h);
        flat.displayW = w; flat.displayH = h;
        flat.ctx.drawImage(canvas, 0, 0);
        this._layerMgr.replaceAllWith(flat);

        this._selectedLayerIds = new Set();
        this._selectTool?.clearSelection();
        this._activateCurrentTool();
        this._updateCompositeView();
        this._refreshLayerList();
        this._toast("Layers flattened", "success");
    }

    // 選択中の2枚以上のレイヤーのみを1枚に統合する（他のレイヤーはそのまま残す）
    _mergeSelectedLayers(selectedIds) {
        if (!confirm(t("image.mergeSelectedConfirm", selectedIds.length))) return;

        this._syncActiveLayerFromCanvas();
        this._saveUndo();

        const merged = this._layerMgr.mergeLayers(selectedIds);
        if (!merged) return;

        this._selectedLayerIds = new Set([merged.id]);
        this._selectTool?.clearSelection();
        this._activateCurrentTool();
        this._updateCompositeView();
        this._refreshLayerList();
        this._toast(t("image.mergeSelectedDone"), "success");
    }

    // アクティブレイヤーにPixiJSパーティクル/フィルタ効果を適用する（imgeditタブのPixiJS FX連携を移植）
    _openPixiFx() {
        if (typeof window.pixiFxOpen !== "function") {
            this._toast(t("image.pixifxNotLoaded"), "error");
            return;
        }
        if (!this._layerMgr) { this._toast(t("image.noImageLoaded"), "error"); return; }
        const layer = this._layerMgr.activeLayer;
        if (!layer) { this._toast(t("image.noActiveLayer"), "error"); return; }
        this._syncActiveLayerFromCanvas();
        const dataUrl = layer.canvas.toDataURL("image/png");

        window.pixiFxOpen({
            imageDataUrl: dataUrl,
            onApply: async (resultDataUrl) => {
                try {
                    const img = await new Promise((resolve, reject) => {
                        const i = new Image();
                        i.onload  = () => resolve(i);
                        i.onerror = () => reject(new Error("Failed to load result image"));
                        i.src = resultDataUrl;
                    });
                    this._saveUndo();
                    const active = this._layerMgr.activeLayer;
                    if (!active) return;
                    active.canvas.width  = img.width;
                    active.canvas.height = img.height;
                    active.ctx = active.canvas.getContext("2d");
                    active.ctx.drawImage(img, 0, 0);
                    this._updateCompositeView();
                    this._refreshLayerList();
                    this._toast(t("image.pixifxApplied"), "success");
                } catch (err) {
                    this._toast(t("image.pixifxApplyError", err.message), "error");
                }
            },
        });
    }

    _refreshLayerList() {
        const el = document.getElementById("ie-layer-list");
        if (!el || !this._layerMgr) return;

        // レイヤー削除等で選択済みIDが失効している場合に備えてクリーンアップ
        const liveIds = new Set(this._layerMgr.layers.map(l => l.id));
        for (const id of this._selectedLayerIds) if (!liveIds.has(id)) this._selectedLayerIds.delete(id);

        el.innerHTML = this._layerMgr.layers.map((layer, i) => {
            const isActive = i === this._layerMgr.activeIndex;
            const isMultiSelected = this._selectedLayerIds.has(layer.id);
            const typeIcon = layer.type === "image" ? "🖼"
                : layer.type === "text" ? "T"
                : layer.type === "mask" ? "⬚"
                : layer.type === "adjustment" ? ""
                : "✏";
            const maskApplyBtn = layer.type === "mask"
                ? `<button class="ie-layer-vis-btn" data-id="${layer.id}" data-action="mask-apply"
                        title="${layer.maskApply ? "Disable clipping mask" : "Enable as clipping mask"}"
                        style="color:${layer.maskApply ? "var(--it-primary)" : "inherit"};font-size:11px;">✂</button>
                   <button class="ie-layer-vis-btn" data-id="${layer.id}" data-action="mask-op"
                        title="${layer.operation === "subtract" ? "Mode: Subtract (click to switch to Add)" : "Mode: Add (click to switch to Subtract)"}"
                        style="font-size:10px;font-weight:bold;min-width:16px;color:${layer.operation === "subtract" ? "#e2534a" : "#4db84d"};">${layer.operation === "subtract" ? "S" : "A"}</button>`
                : "";
            return `
                <div class="ie-layer-item ${isActive ? "active" : ""} ${isMultiSelected ? "multi-selected" : ""}" data-id="${layer.id}" data-action="select" data-type="${layer.type}">
                    <button class="ie-layer-vis-btn" data-id="${layer.id}" data-action="vis"
                        title="${layer.visible ? "Hide" : "Show"}">${layer.visible ? "👁" : "🚫"}</button>
                    <button class="ie-layer-vis-btn" data-id="${layer.id}" data-action="lock"
                        title="${layer.locked ? "Unlock" : "Lock"}"
                        style="color:${layer.locked ? "#e2a04a" : "inherit"}">${layer.locked ? "🔒" : "🔓"}</button>
                    ${maskApplyBtn}
                    <img class="ie-layer-thumb" src="${layer.getThumbnailDataURL()}" draggable="false">
                    <span class="ie-layer-type-icon" style="font-size:10px;opacity:0.7;flex-shrink:0;">${typeIcon}</span>
                    <span class="ie-layer-name">${layer.name}</span>
                </div>
            `;
        }).join("");

        const flattenBtn = document.getElementById("ie-flatten-btn");
        if (flattenBtn) {
            const n = this._selectedLayerIds.size;
            flattenBtn.title = n >= 2 ? t("image.flattenSelectedTitle", n) : t("image.flattenTitle");
        }

        el.querySelectorAll("[data-action]").forEach(node => {
            node.addEventListener("click", e => {
                e.stopPropagation();
                const id     = node.dataset.id;
                const action = node.dataset.action;
                if (action === "vis") {
                    this._layerMgr.toggleVisible(id);
                    this._updateCompositeView();
                } else if (action === "mask-apply") {
                    this._layerMgr.toggleMaskApply(id);
                    this._updateCompositeView();
                    this._refreshLayerList();
                } else if (action === "mask-op") {
                    this._layerMgr.toggleOperation(id);
                    this._updateCompositeView();
                    this._refreshLayerList();
                } else if (action === "lock") {
                    this._layerMgr.toggleLocked(id);
                    const sel = this._selectTool?.getSelectedLayer();
                    if (sel?.id === id) this._selectTool?.setLayer(sel);
                    this._refreshLayerList();
                } else if (action === "select") {
                    if (e.shiftKey) {
                        // Shift+クリック: 複数選択のトグル。まだ何も複数選択されていなければ、
                        // 現在のアクティブレイヤーを起点として含めてからトグルする
                        if (this._selectedLayerIds.size === 0 && this._layerMgr.activeLayer) {
                            this._selectedLayerIds.add(this._layerMgr.activeLayer.id);
                        }
                        if (this._selectedLayerIds.has(id)) this._selectedLayerIds.delete(id);
                        else this._selectedLayerIds.add(id);
                    } else {
                        this._selectedLayerIds = new Set([id]);
                    }
                    this._syncActiveLayerFromCanvas();
                    this._layerMgr.setActive(id);
                    const layer = this._layerMgr.activeLayer;
                    if (layer?.type === "adjustment") {
                        this._selectTool?.clearSelection();
                        this._renderAdjustProps(layer);
                        this._updateCompositeView();
                    } else {
                        // 調整レイヤー以外を選んだ場合、プロパティ表示は現在選択中のツールのものに
                        // 切り替える（該当ツールにプロパティ表示が無ければ非表示のまま）
                        const pane = document.getElementById("ie-props-pane");
                        if (pane) pane.style.display = "none";
                        this._renderToolOptions(this._activeTool);
                    }
                    if (layer?.type === "mask") {
                        if (this._activeTool !== "mask") {
                            this._setActiveTool("mask");
                        } else {
                            this._maskTool?.setCanvas(layer.canvas);
                            this._maskTool?.activate();
                        }
                        if (this._maskTool) {
                            this._maskTool.mode = layer.operation === "subtract" ? "erase" : "paint";
                            this._renderToolOptions("mask");
                        }
                        this._updateCompositeView();
                    } else if (layer?.type === "adjustment") {
                        // 上でpropsペイン表示・再描画済み
                    } else if (this._activeTool === "draw" && layer) {
                        this._drawTool?.setCanvas(layer.canvas);
                        this._updateCompositeView();
                    } else if (layer) {
                        // select以外のツール（テキスト等）がアクティブな間も、レイヤーパネルでの選択操作を
                        // SelectTool内部の選択状態に同期しておく。これによりオーバーレイの枠表示で
                        // 現在の対象が分かるようになり、スタイルモーダル等が正しいレイヤーを参照できる
                        this._selectTool?.setLayer(layer);
                        this._updateCompositeView();
                    } else {
                        this._updateCompositeView();
                    }
                    this._refreshLayerList();
                    if (layer) {
                        const sl = document.getElementById("ie-layer-opacity");
                        const lb = document.getElementById("ie-layer-opacity-label");
                        if (sl) sl.value = Math.round(layer.opacity * 100);
                        if (lb) lb.textContent = Math.round(layer.opacity * 100) + "%";
                    }
                }
            });
        });
    }

    // ── Undo / Redo ──────────────────────────────

    _saveUndo() {
        if (!this._layerMgr) return;
        this._syncActiveLayerFromCanvas();
        const state = JSON.stringify(this._layerMgr.toJSON());
        this._undoStack.push(state);
        if (this._undoStack.length > UNDO_LIMIT) this._undoStack.shift();
        this._redoStack = [];
    }

    async _undo() {
        if (!this._layerMgr || this._undoStack.length === 0) return;
        this._syncActiveLayerFromCanvas();
        this._redoStack.push(JSON.stringify(this._layerMgr.toJSON()));
        await this._restoreState(this._undoStack.pop());
    }

    async _redo() {
        if (!this._layerMgr || this._redoStack.length === 0) return;
        this._syncActiveLayerFromCanvas();
        this._undoStack.push(JSON.stringify(this._layerMgr.toJSON()));
        await this._restoreState(this._redoStack.pop());
    }

    async _restoreState(jsonStr) {
        const json = JSON.parse(jsonStr);
        await this._layerMgr.fromJSON(json);
        this._selectTool?.clearSelection();
        this._updateCompositeView();
        this._activateCurrentTool();
        this._refreshLayerList();
    }

    // ── 合成・保存 ─────────────────────────────────

    _buildCompositeCanvas() {
        const canvas = document.createElement("canvas");
        canvas.width  = this._canvasW;
        canvas.height = this._canvasH;
        if (!this._layerMgr) return canvas;
        this._compositeForExport(canvas);
        return canvas;
    }

    // 保存用合成: maskApply=true のクリッピングを適用、マスクオーバーレイは除外
    _compositeForExport(target) {
        const ctx = target.getContext("2d");
        ctx.clearRect(0, 0, target.width, target.height);
        this._renderLayersComposite(ctx, target, false);
    }

    _savePng() {
        if (!this._layerMgr) { this._toast("No image loaded", "error"); return; }
        const canvas = this._buildCompositeCanvas();
        const a = document.createElement("a");
        a.href     = canvas.toDataURL("image/png");
        a.download = (this._baseName || "image") + "-output.png";
        a.click();
        this._toast("PNG saved", "success");
    }

    // レイヤー編集状態（LayerManager.toJSON、canvas内容込み）をサムネイルPNGとペアで
    // アセットパネルの Image フォルダへ保存する。アセットパネルから再度読み込めば
    // loadProjectFromUrl() でレイヤー構成ごと編集を再開できる。
    /** @returns {Promise<boolean>} 保存できた（キャンセル・失敗ではない）か。Closeダイアログの「保存して閉じる」から呼び出す際の可否判定に使う */
    async _saveProject() {
        if (!this._layerMgr) { this._toast("No image loaded", "error"); return false; }
        const defaultName = this._baseName || "image";
        const filename = window.prompt("Save Project — file name (without extension):", defaultName);
        if (filename === null) return false; // キャンセル
        const safeName = filename.trim() || defaultName;

        const canvas   = this._buildCompositeCanvas();
        const thumbnail = canvas.toDataURL("image/png");
        const project   = JSON.stringify(this._layerMgr.toJSON());

        try {
            const r = await fetch("/api/ccc/save-image-project", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ filename: safeName, thumbnail, project }),
            });
            const data = await r.json();
            if (data.status !== "ok") throw new Error(data.message || "unknown error");
            this._toast(`Project saved: ${safeName}`, "success");
            if (typeof window.loadAssets === "function") window.loadAssets(true);
            return true;
        } catch (err) {
            this._toast("Save Project failed: " + err.message, "error");
            return false;
        }
    }

    // comic-creator既存のEagle連携（main.js の window.saveToEagle）を使って保存する。
    // workflow studio側の「Save to Gallery」に相当（wfmギャラリーが無いためEagleに差し替え）。
    async _saveToEagle() {
        if (!this._layerMgr) { this._toast("No image loaded", "error"); return; }
        if (typeof window.saveToEagle !== "function") {
            this._toast("Eagle integration not available", "error");
            return;
        }

        const now = new Date();
        const pad = n => String(n).padStart(2, "0");
        const ts  = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        const defaultName = `cc-image-${ts}`;

        const filename = window.prompt("Save to Eagle — file name (without extension):", defaultName);
        if (filename === null) return; // キャンセル
        const safeName = filename.trim() || defaultName;

        const canvas  = this._buildCompositeCanvas();
        const dataUrl = canvas.toDataURL("image/png");

        try {
            const { ok, message } = await window.saveToEagle(dataUrl, safeName, ["comfyui-comic-creator", "image-tab"]);
            if (ok) this._toast(`Saved to Eagle: ${safeName}.png`, "success");
            else this._toast(message ? `Eagle save failed: ${message}` : "Eagle save failed", "error");
        } catch (err) {
            this._toast("Eagle save failed: " + err.message, "error");
        }
    }

    // ComfyUIの標準アップロードAPI（/upload/image）に type=output, subfolder=cc を指定して保存する。
    // フォルダが存在しなくてもComfyUI側(server.py image_upload)が自動作成する。
    async _saveToGallery() {
        if (!this._layerMgr) { this._toast("No image loaded", "error"); return; }
        const canvas = this._buildCompositeCanvas();
        const blob   = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
        const now = new Date();
        const pad = n => String(n).padStart(2, "0");
        const ts  = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        const file = new File([blob], `cc-image-${ts}.png`, { type: "image/png" });
        const form = new FormData();
        form.append("image", file);
        form.append("type", "output");
        form.append("subfolder", "cc");
        form.append("overwrite", "true");
        try {
            const r    = await fetch("/upload/image", { method: "POST", body: form });
            const data = await r.json();
            this._toast(`Saved to Gallery: ${data.subfolder}/${data.name}`, "success");
        } catch (err) {
            this._toast("Save to Gallery failed: " + err.message, "error");
        }
    }

    async _uploadToComfyUI() {
        if (!this._layerMgr) { this._toast("No image loaded", "error"); return; }
        const canvas = this._buildCompositeCanvas();
        const blob   = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
        const file   = new File([blob], (this._baseName || "cc-image") + "-output.png", { type: "image/png" });
        const form   = new FormData();
        form.append("image", file);
        form.append("overwrite", "true");
        try {
            const r    = await fetch("/upload/image", { method: "POST", body: form });
            const data = await r.json();
            this._toast(`Uploaded: ${data.name}`, "success");
        } catch {
            this._toast("Upload failed", "error");
        }
    }

    // 合成結果をWorkflow StudioのGenerate UI Image入力スロットへ送信する（I2I連携）
    async _sendToI2I() {
        if (!this._layerMgr) { this._toast("No image loaded", "error"); return; }
        if (typeof window.sendImageToWorkflowStudioI2I !== "function") {
            this._toast("Workflow Studio integration not available", "error");
            return;
        }
        const canvas = this._buildCompositeCanvas();
        const blob   = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
        await window.sendImageToWorkflowStudioI2I(blob, this._baseName || "cc-image", "image");
    }

    /** 外部（アセットパネル等）から画像URLをロードするための公開API */
    async loadFromUrl(url, name) {
        try {
            const r       = await fetch(url);
            const blob    = await r.blob();
            const dataUrl = await new Promise(resolve => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target.result);
                reader.readAsDataURL(blob);
            });
            await this._loadFromDataUrl(dataUrl, name || url.split("/").pop().replace(/\.[^.]+$/, "") || "external-image");
        } catch {
            this._toast("Failed to load image from URL", "error");
        }
    }

    /** アセットパネルの Image プロジェクトアセット(.json、_saveProject()で保存)から
     *  レイヤー編集状態を復元して開く。常に新規キャンバスとして開始する（既存レイヤーとは混在させない）。 */
    async loadProjectFromUrl(url, name) {
        try {
            const r = await fetch(url);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const data = await r.json();

            this._canvasW  = data.width  || 512;
            this._canvasH  = data.height || 512;
            this._baseName = name || "image";
            this._sourceImageEl = null; // プロジェクト読み込みはレイアウトへの書き戻し対象外
            this._initCanvases();
            await this._layerMgr.fromJSON(data);

            this._undoStack = [];
            this._redoStack = [];
            this._setActiveTool("select");
            this._refreshLayerList();
            this._updateCompositeView();
            this._fitToView();

            document.getElementById("ie-placeholder").style.display = "none";
            this._toast(`Project loaded: ${this._baseName}`, "success");
        } catch (err) {
            this._toast("Failed to load project: " + err.message, "error");
        }
    }

    // ── レイアウトタブ連携（imgeditタブの開く/保存フローを移植） ──

    /** レイアウトタブの「画像タブで編集」ボタンから、選択中のSVG <image> 要素を開く */
    async loadFromSvgElement(imgEl) {
        const href = imgEl.getAttribute("href") || imgEl.getAttribute("xlink:href") || "";
        if (!href.startsWith("data:")) {
            this._toast(t("image.notBase64Error"), "error");
            return;
        }
        // レイアウトから開く場合は常に単一画像の新規キャンバスとして開く（既存の作業中レイヤーとは混在させない）
        this._layerMgr  = null;
        this._undoStack = [];
        this._redoStack = [];
        this._sourceImageEl = imgEl;
        const name = imgEl.dataset?.name || imgEl.id || "layout-image";
        await this._loadFromDataUrl(href, name);
    }

    /**
     * レイアウトタブへ編集結果を送る（imgeditタブの「保存してレイアウトに戻る」に相当）。
     * レイアウトタブの「画像タブで編集」から開いた画像の場合は元のSVG <image> 要素へ書き戻し、
     * New/Uploadで作成した新規ドキュメントの場合はレイアウトの選択中コマ/オーバーレイに新規画像として挿入する。
     */
    async _saveToLayout() {
        if (!this._layerMgr) { this._toast("No image loaded", "error"); return; }
        if (typeof window.switchTab !== "function") {
            this._toast("Layout integration functions not available", "error");
            return;
        }

        this._syncActiveLayerFromCanvas();
        const canvas  = this._buildCompositeCanvas();
        const dataUrl = canvas.toDataURL("image/png");

        if (this._sourceImageEl) {
            if (typeof window.pushHistory !== "function") {
                this._toast("Layout integration functions not available", "error");
                return;
            }
            try {
                window.pushHistory();
                this._sourceImageEl.setAttribute("href", dataUrl);
                if (this._sourceImageEl.hasAttribute("xlink:href")) this._sourceImageEl.setAttribute("xlink:href", dataUrl);

                const svgEl = this._sourceImageEl.closest("svg");
                if (svgEl) {
                    const panelId = this._sourceImageEl.getAttribute("data-panel-id") ||
                                    this._sourceImageEl.closest("[data-clip-panel]")?.getAttribute("data-clip-panel");
                    const isOverlay = svgEl.querySelector("g[data-overlay-layer]")?.contains(this._sourceImageEl) ?? false;
                    if (isOverlay && typeof window.saveOverlaySvg === "function") {
                        await window.saveOverlaySvg(svgEl);
                    } else if (panelId && typeof window.savePanelSvg === "function") {
                        await window.savePanelSvg(panelId, svgEl);
                    }
                }
                this._toast("Saved to layout", "success");
                await window.switchTab("layout");
            } catch (err) {
                this._toast("Failed to save to layout: " + err.message, "error");
            }
            return;
        }

        // 新規ドキュメント: レイアウトの選択中コマ/オーバーレイへ新規画像として挿入
        if (typeof window.insertImage !== "function") {
            this._toast("Layout integration functions not available", "error");
            return;
        }
        try {
            const inserted = await window.insertImage(dataUrl, canvas.width, canvas.height);
            if (!inserted) return; // insertImage側でコマ未選択等のalertを表示済み
            this._toast("Sent to layout", "success");
            await window.switchTab("layout");
        } catch (err) {
            this._toast("Failed to send to layout: " + err.message, "error");
        }
    }

    // ── キーボードショートカット ──────────────────

    _setupKeyboard() {
        document.addEventListener("keydown", e => {
            if (!document.getElementById("image-tab")?.classList.contains("active")) return;
            if (e.key === " " && !e.target.closest("input, textarea, select")) {
                e.preventDefault();
                this._spaceDown = true;
                const wrap = document.getElementById("ie-canvas-wrap");
                if (wrap && !this._panning) wrap.style.cursor = "grab";
            }
            if (e.key === "Escape" && this._eyedropperActive) this._setEyedropperActive(false);
            if (e.ctrlKey && e.key === "z") { e.preventDefault(); this._undo(); }
            if (e.ctrlKey && e.key === "y") { e.preventDefault(); this._redo(); }
            if (this._activeTool === "mask" && this._maskSubtool === "vector") {
                this._maskVectorTool?.onKeyDown(e);
            }
            if (!e.ctrlKey && !e.target.closest("input, textarea, select")) {
                if (e.key === "v") this._setActiveTool("select");
                if (e.key === "b") this._setActiveTool("draw");
                if (e.key === "t") this._setActiveTool("text");
                if (e.key === "s") this._setActiveTool("shape");
                if (e.key === "g") this._setActiveTool("fill");
                // Delete/Backspaceで選択オブジェクト削除
                if ((e.key === "Delete" || e.key === "Backspace") && this._activeTool === "select") {
                    const layer = this._selectTool?.getSelectedLayer();
                    if (layer && this._layerMgr && this._layerMgr.layers.length > 1) {
                        this._saveUndo();
                        this._selectTool.clearSelection();
                        this._layerMgr.deleteLayer(layer.id);
                        this._updateCompositeView();
                    }
                }
            }
        });

        document.addEventListener("keyup", e => {
            if (e.key === " ") {
                this._spaceDown = false;
                if (!this._panning) {
                    const wrap = document.getElementById("ie-canvas-wrap");
                    if (wrap) wrap.style.cursor = "";
                }
            }
        });
    }

    // ── テキストオブジェクト再編集 ────────────────────

    /** 座標上にある最前面の可視テキストレイヤーを返す（layers[0]が最前面） */
    _findTextLayerAt(x, y) {
        if (!this._layerMgr || !this._selectTool) return null;
        for (const layer of this._layerMgr.layers) {
            if (!layer.visible || layer.type !== "text" || !layer.textProps) continue;
            if (this._selectTool._isPointInLayer(x, y, layer)) return layer;
        }
        return null;
    }

    /** canvasのダブルクリック: テキストレイヤー上なら再編集
     *  Selectツール=選択中レイヤーのみ対象（overlayCanvas経由）、
     *  Textツール=座標上のテキストレイヤーを対象（drawCanvas経由、Selectツールと同じ操作感） */
    _onOverlayDblClick(e, refCanvas) {
        if (!this._layerMgr) return;
        const pos = DrawTool.getCanvasPos(refCanvas, e);

        if (this._activeTool === "select") {
            const layer = this._selectTool?.getSelectedLayer();
            if (!layer || !this._selectTool._isPointInLayer(pos.x, pos.y, layer)) return;
            if (layer.type === "text" && layer.textProps) {
                this._openTextEditForLayer(layer, pos.x, pos.y);
            }
        } else if (this._activeTool === "text") {
            const layer = this._findTextLayerAt(pos.x, pos.y);
            if (layer) {
                this._layerMgr.setActive(layer.id);
                this._refreshLayerList();
                this._openTextEditForLayer(layer, pos.x, pos.y);
            }
        }
    }

    /** textProps を TextTool にセットしてオーバーレイを開く */
    _openTextEditForLayer(layer, canvasX, canvasY) {
        const p = layer.textProps;
        this._textTool.text       = p.text;
        this._textTool.fontFamily = p.fontFamily;
        this._textTool.fontSize   = p.fontSize;
        this._textTool.bold       = p.bold;
        this._textTool.italic     = p.italic;
        this._textTool.align      = p.align;
        this._textTool.vertical   = !!p.vertical;
        this._textTool.color      = p.color;
        this._editingTextLayer    = layer;
        this._textTool.openAt(canvasX, canvasY);
    }

    /** 線/袋文字/影を考慮した追加余白(px)。フォントタブのスタイル/プリセット適用テキストのみ非ゼロになる。
     *  スタイル値は「フォントサイズ100pxあたりのpx」の相対値(v2)なのでfontSizeでスケールする */
    _textExtraPad(p) {
        const k = (p.fontSize || 100) / 100;
        let outline = 0;
        if (p.bukuroEnabled) outline = (p.strokeEnabled ? (p.strokeWidth || 0) / 2 : 0) + (p.bukuroWidth || 0);
        else if (p.strokeEnabled) outline = (p.strokeWidth || 0) / 2;
        let pad = outline;
        if (p.shadowEnabled) {
            pad = outline + (p.shadowBlur || 0) + Math.max(Math.abs(p.shadowDx || 0), Math.abs(p.shadowDy || 0));
        }
        return Math.ceil(pad * k);
    }

    /** textProps からバウンディングボックスサイズを計測する（TextTool.createLayerDataの計測部分＋スタイル余白を考慮） */
    _measureTextBox(p) {
        const lines = p.text.split("\n");
        const lineH = p.fontSize * 1.2;
        const font = [
            p.italic ? "italic" : "",
            p.bold   ? "bold"   : "",
            `${p.fontSize}px`,
            `"${p.fontFamily}", sans-serif`,
        ].filter(Boolean).join(" ");

        const tmp    = document.createElement("canvas");
        const tmpCtx = tmp.getContext("2d");
        tmpCtx.font  = font;

        const pad = 4 + this._textExtraPad(p);

        if (p.vertical) {
            const v = layoutVerticalText(tmpCtx, p.text, p.fontSize);
            return {
                tw: Math.max(1, Math.ceil(v.w + pad * 2)),
                th: Math.max(1, Math.ceil(v.h + pad * 2)),
            };
        }

        let maxW = 0;
        for (const line of lines) {
            const w = line.length > 0 ? tmpCtx.measureText(line).width : p.fontSize * 0.3;
            if (w > maxW) maxW = w;
        }

        const tw = Math.max(1, Math.ceil(maxW + pad * 2));
        const th = Math.max(1, Math.ceil(lines.length * lineH + pad * 2));
        return { tw, th };
    }

    /**
     * テキストレイヤーを displayW/H サイズで再描画する（拡大縮小後のぼやけ防止）。
     * canvas.width = displayW にするため applyTransform のスケールは常に 1:1 になる。
     * フォントタブのスタイル/プリセット由来の線・袋文字・影(textProps内)があればあわせて描画する。
     */
    _rerenderTextLayer(layer) {
        const p = layer.textProps;
        if (!p) return;

        const newW = Math.max(1, Math.round(layer.displayW));
        const newH = Math.max(1, Math.round(layer.displayH));
        const sx   = newW / p.nativeW;
        const sy   = newH / p.nativeH;

        layer.canvas.width  = newW;
        layer.canvas.height = newH;
        layer.ctx = layer.canvas.getContext("2d");

        const font = [
            p.italic ? "italic" : "",
            p.bold   ? "bold"   : "",
            `${p.fontSize}px`,
            `"${p.fontFamily}", sans-serif`,
        ].filter(Boolean).join(" ");

        const lines = p.text.split("\n");
        const lineH = p.fontSize * 1.2;
        const pad   = 4 + this._textExtraPad(p);

        const ctx = layer.ctx;
        ctx.save();
        ctx.scale(sx, sy);
        ctx.font         = font;
        ctx.textBaseline = "top";
        ctx.textAlign    = p.align;
        ctx.lineJoin     = "round";

        let drawX = pad;
        if (p.align === "center") drawX = p.nativeW / 2;
        else if (p.align === "right") drawX = p.nativeW - pad;

        // 縦書き時は文字単位のセルレイアウトで各パスを描画する
        const vLayout = p.vertical ? layoutVerticalText(ctx, p.text, p.fontSize) : null;

        // 下線（スタイルのunderlineEnabled由来）の矩形を事前計算する。
        // Canvas2Dにはtext-decorationが無いため自前描画で、SVG側（text-decoration＋フィルタ）と
        // 見た目を揃えるよう文字と同じパスに含めて描く＝袋文字・線・影も下線に付く。
        // 横書きは各行の下、縦書きは列（＝行）の右側の傍線
        const underlineRects = [];
        if (p.underline) {
            const thickness = Math.max(1, p.fontSize * 0.06);
            if (vLayout) {
                vLayout.cols.forEach(col => {
                    if (col.h > 0) underlineRects.push([pad + col.cx + p.fontSize * 0.5, pad, thickness, col.h]);
                });
            } else {
                lines.forEach((line, i) => {
                    if (!line) return;
                    const w = ctx.measureText(line).width;
                    let x0 = drawX;
                    if (p.align === "center") x0 = drawX - w / 2;
                    else if (p.align === "right") x0 = drawX - w;
                    underlineRects.push([x0, pad + i * lineH + p.fontSize * 0.95, w, thickness]);
                });
            }
        }

        const drawPass = (method) => {
            if (vLayout) drawVerticalCells(ctx, vLayout.cells, pad, pad, method);
            else lines.forEach((line, i) => ctx[method](line, drawX, pad + i * lineH));
            const rectMethod = method === "fillText" ? "fillRect" : "strokeRect";
            underlineRects.forEach(r => ctx[rectMethod](...r));
        };

        // スタイル値は「フォントサイズ100pxあたりのpx」の相対値(v2)。
        // 描画基準はレイアウトタブ（SVG）に合わせる:
        //   線幅S → 中央基準ストローク（塗りが内側半分を覆うため外側に見えるのは S/2）
        //   袋文字幅B → 線の外側にBの帯（feMorphology dilate radius=B 相当）
        //   影 → 最背面のシルエット（袋文字含む）に1回だけ掛ける（feDropShadow相当）
        const k = (p.fontSize || 100) / 100;
        const setShadow = (on) => {
            if (on && p.shadowEnabled) {
                ctx.shadowColor   = p.shadowColor;
                ctx.shadowBlur    = (p.shadowBlur || 0) * k;
                ctx.shadowOffsetX = (p.shadowDx || 0) * k;
                ctx.shadowOffsetY = (p.shadowDy || 0) * k;
            } else {
                ctx.shadowColor = "transparent";
                ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
            }
        };
        let shadowDone = false;

        // 袋文字（背面の太い縁取り）
        if (p.bukuroEnabled) {
            setShadow(true);
            shadowDone = true;
            ctx.strokeStyle = p.bukuroColor;
            ctx.lineWidth   = ((p.strokeEnabled ? p.strokeWidth || 0 : 0) + (p.bukuroWidth || 0) * 2) * k;
            drawPass("strokeText");
        }

        // 線
        if (p.strokeEnabled) {
            setShadow(!shadowDone);
            shadowDone = true;
            ctx.strokeStyle = p.strokeColor;
            ctx.lineWidth   = (p.strokeWidth || 0) * k;
            drawPass("strokeText");
        }

        // 塗り（fillEnabled=false は塗りなし。線・袋文字のみ描画される）
        if (p.fillEnabled !== false) {
            setShadow(!shadowDone);
            ctx.fillStyle = this._textFillStyle(ctx, p, layer);
            drawPass("fillText");
        }
        ctx.restore();

        this._ensureLayerFontLoaded(layer);
    }

    /**
     * テキストレイヤーの塗りfillStyleを生成する（単色/グラデーション/テクスチャ）。
     * 座標系はctx.scale適用後のネイティブテキスト空間（0..nativeW/H）。
     * テクスチャ画像が未ロードの場合は単色でフォールバックし、ロード完了後に再描画する
     */
    _textFillStyle(ctx, p, layer) {
        if (p.fillMode === "gradient" && p.fillGradient?.stops?.length) {
            const g = p.fillGradient;
            const W = p.nativeW, H = p.nativeH;
            const cx = W / 2, cy = H / 2;
            let grad;
            if (g.shape === "radial") {
                grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, Math.hypot(W, H) / 2));
            } else {
                // 角度方向へのバウンディングボックス投影幅でグラデーション区間を決める
                const rad = ((g.angleDeg || 0) * Math.PI) / 180;
                const dx = Math.cos(rad), dy = Math.sin(rad);
                const half = (Math.abs(dx) * W + Math.abs(dy) * H) / 2;
                grad = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
            }
            [...g.stops].sort((a, b) => a.pos - b.pos).forEach(s => {
                grad.addColorStop(Math.max(0, Math.min(1, s.pos)), s.color || "#000000");
            });
            return grad;
        }
        if (p.fillMode === "texture" && p.fillTexture?.dataUrl) {
            const img = this._getTextureImage(p.fillTexture.dataUrl, layer);
            if (img) {
                const pattern = ctx.createPattern(img, "repeat");
                // タイルサイズ = 画像実寸 × (scale/100) × (fontSize/100)（SVG側と同じv2相対値基準）
                const s = ((p.fillTexture.scale || 100) / 100) * ((p.fontSize || 100) / 100);
                if (pattern && typeof pattern.setTransform === "function" && typeof DOMMatrix !== "undefined") {
                    pattern.setTransform(new DOMMatrix().scale(s, s));
                }
                if (pattern) return pattern;
            }
            return p.color || "#000000";
        }
        return p.color || "#000000";
    }

    /** テクスチャ画像のキャッシュ取得。未ロードならロード開始し、完了時に対象レイヤーを再描画する */
    _getTextureImage(dataUrl, layer) {
        if (!this._texImageCache) this._texImageCache = new Map();
        const entry = this._texImageCache.get(dataUrl);
        if (entry) return entry.loaded ? entry.img : null;
        const img = new Image();
        const newEntry = { img, loaded: false };
        this._texImageCache.set(dataUrl, newEntry);
        img.onload = () => {
            newEntry.loaded = true;
            if (layer && layer.textProps) {
                this._rerenderTextLayer(layer);
                this._updateCompositeView();
            }
        };
        img.src = dataUrl;
        return null;
    }

    /** Google Fontsが未ダウンロードでフォールバック描画になっている場合、ロード完了を待って再描画する */
    _ensureLayerFontLoaded(layer) {
        if (!document.fonts) return;
        const p = layer.textProps;
        if (!p) return;
        const family = p.fontFamily;
        if (typeof window._fontMgrEnsureFontLoaded === "function") {
            window._fontMgrEnsureFontLoaded(family);
        }
        const fontSpec = `${p.italic ? "italic " : ""}${p.bold ? "bold " : ""}16px "${family}"`;
        if (document.fonts.check(fontSpec)) return;
        document.fonts.load(fontSpec).then(() => {
            if (layer.textProps === p) {
                this._rerenderTextLayer(layer);
                this._updateCompositeView();
            }
        }).catch(() => {});
    }

    // ── フォントタブ「スタイル/プリセット」連携 ───────────

    /** フォントタブのスタイルオブジェクト(main.js側 _fontMgrLoadStyles() の要素)をtextProps用の断片に変換 */
    _fontStyleAttrsFromStyle(style) {
        return {
            color: style?.fill || "#000000",
            fillEnabled: style?.fillEnabled !== false,
            fillMode: style?.fillMode || "solid",
            fillGradient: style?.fillGradient || null,
            fillTexture: style?.fillTexture || null,
            bold: !!style?.boldEnabled, italic: !!style?.italicEnabled, underline: !!style?.underlineEnabled, align: style?.align || "left",
            strokeEnabled: !!style?.strokeEnabled, strokeColor: style?.strokeColor || "#ffffff", strokeWidth: style?.strokeWidth || 0,
            bukuroEnabled: !!style?.bukuroEnabled, bukuroColor: style?.bukuroColor || "#000000", bukuroWidth: style?.bukuroWidth || 0,
            shadowEnabled: !!style?.shadowEnabled, shadowColor: style?.shadowColor || "#000000", shadowBlur: style?.shadowBlur || 0,
            shadowDx: style?.shadowDx || 0, shadowDy: style?.shadowDy || 0,
        };
    }

    /** 選択中レイヤーが（textPropsを持つ）テキストレイヤーかどうか */
    hasSelectedTextLayer() {
        const layer = this._selectTool?.getSelectedLayer();
        return !!(layer && layer.type === "text" && layer.textProps);
    }

    /** テキストツールのオプションバー（Color/Size/Font/Bold/Italic/Align/縦書き）の変更を、選択中のテキストレイヤーがあればそこにも反映する */
    _applyTextToolChangeToSelection(partialProps) {
        const layer = this._selectTool?.getSelectedLayer();
        if (!layer || layer.type !== "text" || !layer.textProps) return;
        this._saveUndo();
        const newProps = { ...layer.textProps, ...partialProps };
        this._applyTextPropsToLayer(layer, newProps);
        this._updateCompositeView();
        this._refreshLayerList();
    }

    /** テキストスタイルモーダルの初期値用: 選択中テキストレイヤーの現在のフォント・サイズ・スタイルを返す（未選択ならツールのデフォルト値、styleはnull） */
    getSelectedTextStyleInfo() {
        const layer = this._selectTool?.getSelectedLayer();
        if (layer && layer.type === "text" && layer.textProps) {
            const p = layer.textProps;
            return {
                fontFamily: p.fontFamily,
                fontSize: p.fontSize,
                style: {
                    fill: p.color,
                    fillEnabled: p.fillEnabled !== false,
                    fillMode: p.fillMode || "solid",
                    fillGradient: p.fillGradient || null,
                    fillTexture: p.fillTexture || null,
                    boldEnabled: !!p.bold, italicEnabled: !!p.italic, underlineEnabled: !!p.underline, align: p.align || "left",
                    strokeEnabled: !!p.strokeEnabled, strokeColor: p.strokeColor, strokeWidth: p.strokeWidth,
                    bukuroEnabled: !!p.bukuroEnabled, bukuroColor: p.bukuroColor, bukuroWidth: p.bukuroWidth,
                    shadowEnabled: !!p.shadowEnabled, shadowColor: p.shadowColor, shadowBlur: p.shadowBlur,
                    shadowDx: p.shadowDx, shadowDy: p.shadowDy,
                },
            };
        }
        return { fontFamily: this._textTool.fontFamily, fontSize: this._textTool.fontSize, style: null };
    }

    /** textProps を差し替えて、中心位置を保ったままレイヤーを再構築・再描画する */
    _applyTextPropsToLayer(layer, newProps) {
        const oldProps = layer.textProps;
        const scale = layer.displayW / oldProps.nativeW;
        const { tw, th } = this._measureTextBox(newProps);
        newProps.nativeW = tw;
        newProps.nativeH = th;

        const centerX = layer.x + layer.displayW / 2;
        const centerY = layer.y + layer.displayH / 2;
        layer.textProps = newProps;
        layer.displayW  = Math.max(1, Math.round(tw * scale));
        layer.displayH  = Math.max(1, Math.round(th * scale));
        layer.x = Math.round(centerX - layer.displayW / 2);
        layer.y = Math.round(centerY - layer.displayH / 2);
        this._rerenderTextLayer(layer);
    }

    /** フォントタブの「スタイル」を選択中のテキストレイヤーに適用する（フォント・サイズ・縦書きは変更しない） */
    applyFontStyleToSelection(style) {
        const layer = this._selectTool?.getSelectedLayer();
        if (!layer || layer.type !== "text" || !layer.textProps) return false;
        this._saveUndo();
        const newProps = { ...layer.textProps, ...this._fontStyleAttrsFromStyle(style) };
        this._applyTextPropsToLayer(layer, newProps);
        this._updateCompositeView();
        this._refreshLayerList();
        this._toast(t("image.styleApplied"), "success");
        return true;
    }

    /** フォントタブの「プリセット」を選択中のテキストレイヤーに適用する（フォント・サイズ・縦書きも変更） */
    applyFontPresetToSelection(preset, styles) {
        const layer = this._selectTool?.getSelectedLayer();
        if (!layer || layer.type !== "text" || !layer.textProps) return false;
        this._saveUndo();
        const style = (styles || []).find(s => s.id === preset.styleId);
        const newProps = {
            ...layer.textProps,
            ...this._fontStyleAttrsFromStyle(style),
            fontFamily: preset.fontFamily,
            fontSize:   preset.fontSize,
            vertical:   !!preset.isVertical,
        };
        this._applyTextPropsToLayer(layer, newProps);
        this._updateCompositeView();
        this._refreshLayerList();
        this._toast(t("image.presetApplied"), "success");
        return true;
    }

    /** フォントタブの「スタイル/プリセット」をキャンバス中央にプレースホルダテキストとして新規レイヤー挿入する */
    _insertStyledPlaceholderText(attrs, fontFamily, fontSize) {
        if (!this._layerMgr) { this._toast(t("image.newOrLoadFirst"), "error"); return false; }

        const props = {
            text: t("textTool.defaultText"), fontFamily, fontSize,
            bold: false, italic: false, align: "left", vertical: false,
            ...attrs,
        };
        const { tw, th } = this._measureTextBox(props);
        props.nativeW = tw;
        props.nativeH = th;

        this._saveUndo();
        const cx = this._canvasW / 2, cy = this._canvasH / 2;
        const layer = this._layerMgr.addLayer("text", props.text, {
            contentW: tw, contentH: th,
            displayW: tw, displayH: th,
            x: Math.round(cx - tw / 2), y: Math.round(cy - th / 2),
        });
        layer.textProps = props;
        this._rerenderTextLayer(layer);
        this._layerMgr.setActive(layer.id);
        this._setActiveTool("select");
        this._selectTool?.setLayer(layer);
        this._updateCompositeView();
        this._refreshLayerList();
        this._toast(t("image.textInserted"), "success");
        return true;
    }

    /** フォントタブの「スタイル」を新規プレースホルダテキストとして挿入する（フォント・サイズは現在のデフォルトのまま） */
    insertFontStylePlaceholder(style) {
        return this._insertStyledPlaceholderText(this._fontStyleAttrsFromStyle(style), this._textTool.fontFamily, this._textTool.fontSize);
    }

    /** フォントタブの「プリセット」を新規プレースホルダテキストとして挿入する（フォント・サイズ・縦書きもプリセットの値を使う） */
    insertFontPresetPlaceholder(preset, styles) {
        const style = (styles || []).find(s => s.id === preset.styleId);
        const attrs = { ...this._fontStyleAttrsFromStyle(style), vertical: !!preset.isVertical };
        return this._insertStyledPlaceholderText(attrs, preset.fontFamily, preset.fontSize);
    }

    // ── ぼかし / モザイク ─────────────────────────

    _applyWholeBlur(amount) {
        if (!this._layerMgr) return;
        const layer = this._layerMgr.activeLayer;
        if (!layer) { this._toast("No active layer", "error"); return; }
        this._saveUndo();
        const w = layer.canvas.width, h = layer.canvas.height;
        const tmp = document.createElement("canvas");
        tmp.width = w; tmp.height = h;
        const tc = tmp.getContext("2d");
        tc.filter = `blur(${amount}px)`;
        tc.drawImage(layer.canvas, 0, 0);
        layer.ctx.clearRect(0, 0, w, h);
        layer.ctx.drawImage(tmp, 0, 0);
        this._updateCompositeView();
        this._refreshLayerList();
    }

    _applyWholeMosaic(size) {
        if (!this._layerMgr) return;
        const layer = this._layerMgr.activeLayer;
        if (!layer) { this._toast("No active layer", "error"); return; }
        this._saveUndo();
        _applyMosaicToRegion(layer.ctx, 0, 0, layer.canvas.width, layer.canvas.height, size);
        this._updateCompositeView();
        this._refreshLayerList();
    }

    // canvas座標 (cx,cy) → layer.canvas 座標への逆変換
    _canvasToLayerCoords(layer, cx, cy) {
        const centerX = layer.x + layer.displayW / 2;
        const centerY = layer.y + layer.displayH / 2;
        const dx = cx - centerX, dy = cy - centerY;
        const angle = -(layer.rotation || 0) * Math.PI / 180;
        const rdx = dx * Math.cos(angle) - dy * Math.sin(angle);
        const rdy = dx * Math.sin(angle) + dy * Math.cos(angle);
        const scaleX = layer.displayW / layer.canvas.width;
        const scaleY = layer.displayH / layer.canvas.height;
        let lx = rdx / scaleX + layer.canvas.width  / 2;
        let ly = rdy / scaleY + layer.canvas.height / 2;
        if (layer.flipX) lx = layer.canvas.width  - lx;
        if (layer.flipY) ly = layer.canvas.height - ly;
        return { x: lx, y: ly };
    }

    _drawBlurPreview() {
        const overlay = document.getElementById("ie-canvas-overlay");
        if (!overlay) return;
        const ctx = overlay.getContext("2d");
        ctx.clearRect(0, 0, overlay.width, overlay.height);
        const s = this._blurDragStart, c = this._blurDragCur;
        if (!s || !c) return;
        const x = Math.min(s.x, c.x), y = Math.min(s.y, c.y);
        const w = Math.abs(c.x - s.x), h = Math.abs(c.y - s.y);
        ctx.strokeStyle = this._blurRectMode === "blur" ? "#4af" : "#fa4";
        ctx.lineWidth   = 1 / this._zoom;
        ctx.setLineDash([4 / this._zoom, 2 / this._zoom]);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
    }

    _applyRectEffect() {
        const layer = this._layerMgr?.activeLayer;
        if (!layer || !this._blurDragStart || !this._blurDragCur) return;
        const s = this._blurDragStart, c = this._blurDragCur;
        if (Math.abs(c.x - s.x) < 3 || Math.abs(c.y - s.y) < 3) return;

        const minX = Math.min(s.x, c.x), minY = Math.min(s.y, c.y);
        const maxX = Math.max(s.x, c.x), maxY = Math.max(s.y, c.y);
        const p1 = this._canvasToLayerCoords(layer, minX, minY);
        const p2 = this._canvasToLayerCoords(layer, maxX, maxY);

        const lx = Math.round(Math.max(0, Math.min(p1.x, p2.x)));
        const ly = Math.round(Math.max(0, Math.min(p1.y, p2.y)));
        const lw = Math.round(Math.min(layer.canvas.width  - lx, Math.abs(p2.x - p1.x)));
        const lh = Math.round(Math.min(layer.canvas.height - ly, Math.abs(p2.y - p1.y)));
        if (lw <= 0 || lh <= 0) return;

        this._saveUndo();

        if (this._blurRectMode === "blur") {
            const amount = parseInt(document.getElementById("ie-rect-blur")?.value ?? "10");
            const tmp = document.createElement("canvas");
            tmp.width = layer.canvas.width; tmp.height = layer.canvas.height;
            const tc = tmp.getContext("2d");
            tc.filter = `blur(${amount}px)`;
            tc.drawImage(layer.canvas, 0, 0);
            layer.ctx.drawImage(tmp, lx, ly, lw, lh, lx, ly, lw, lh);
        } else {
            const size = parseInt(document.getElementById("ie-rect-mosaic")?.value ?? "15");
            _applyMosaicToRegion(layer.ctx, lx, ly, lw, lh, size);
        }

        this._updateCompositeView();
        this._refreshLayerList();
    }

    // ── 背景除去 ─────────────────────────────────

    async _bgRemoveImgly(dataUrl, onStatus) {
        if (!window._ccImageTabImglyRemoveBg) {
            onStatus("Loading model...");
            const mod = await import("https://esm.sh/@imgly/background-removal@1.5.7?bundle&target=es2022");
            window._ccImageTabImglyRemoveBg = mod.removeBackground;
        }
        onStatus("Processing...");
        const res  = await fetch(dataUrl);
        const blob = await res.blob();
        const resultBlob = await window._ccImageTabImglyRemoveBg(blob, {
            publicPath: "https://staticimgly.com/@imgly/background-removal-data/1.5.7/dist/",
        });
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload  = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(resultBlob);
        });
    }

    // BiRefNet背景除去（Mask Editor One互換ルート。comic-creator側にバックエンドが無い場合は
    // _birefnetAvailable=false のためUI選択肢自体が無効化され、この経路には来ない）
    async _bgRemoveBiRefNet(dataUrl, onStatus) {
        const NODE_ID = "cc_image_tab_bgremove";

        onStatus("Sending image...");
        const storeResp = await fetch("/mask_editor/store_image", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ node_id: NODE_ID, image_b64: dataUrl }),
        });
        if (!storeResp.ok) throw new Error("Failed to cache image for BiRefNet");

        onStatus("Running BiRefNet...");
        const resp = await fetch("/mask_editor/birefnet/remove_bg", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ node_id: NODE_ID }),
        });
        const json = await resp.json();
        if (json.error) throw new Error(json.error);

        onStatus("Compositing...");
        return await this._applyMaskToImage(dataUrl, json.mask_b64);
    }

    // グレースケールマスク（白=前景）を元画像に destination-in で適用してRGBA PNGを返す
    async _applyMaskToImage(imageB64, maskB64) {
        const loadImage = src => new Promise((resolve, reject) => {
            const img = new Image();
            img.onload  = () => resolve(img);
            img.onerror = () => reject(new Error("Image load failed: " + src.slice(0, 40)));
            img.src = src;
        });
        const [origImg, maskImg] = await Promise.all([loadImage(imageB64), loadImage(maskB64)]);

        const w = origImg.naturalWidth;
        const h = origImg.naturalHeight;

        const maskCanvas = document.createElement("canvas");
        maskCanvas.width  = w;
        maskCanvas.height = h;
        const mc = maskCanvas.getContext("2d");
        mc.drawImage(maskImg, 0, 0, w, h);
        const maskData = mc.getImageData(0, 0, w, h);
        const md = maskData.data;
        for (let i = 0; i < md.length; i += 4) {
            md[i + 3] = md[i]; // 輝度 → アルファ
            md[i] = md[i + 1] = md[i + 2] = 255;
        }
        mc.putImageData(maskData, 0, 0);

        const out = document.createElement("canvas");
        out.width  = w;
        out.height = h;
        const ctx = out.getContext("2d");
        ctx.drawImage(origImg, 0, 0, w, h);
        ctx.globalCompositeOperation = "destination-in";
        ctx.drawImage(maskCanvas, 0, 0, w, h);

        return out.toDataURL("image/png");
    }

    async _applyBgRemove() {
        if (!this._layerMgr) { this._toast("No image loaded", "error"); return; }
        const layer = this._layerMgr.activeLayer;
        if (!layer)  { this._toast("No active layer", "error"); return; }

        const model    = document.getElementById("ie-bgremove-model")?.value ?? "imgly";
        const asNew    = document.getElementById("ie-bgremove-new-layer")?.checked ?? true;
        const statusEl = document.getElementById("ie-bgremove-status");
        const btn      = document.getElementById("ie-bgremove-btn");
        const setStatus = msg => { if (statusEl) statusEl.textContent = msg; };

        if (btn) btn.disabled = true;
        setStatus("Starting...");

        try {
            const dataUrl = layer.canvas.toDataURL("image/png");

            let resultDataUrl;
            if (model === "imgly") {
                resultDataUrl = await this._bgRemoveImgly(dataUrl, setStatus);
            } else {
                resultDataUrl = await this._bgRemoveBiRefNet(dataUrl, setStatus);
            }

            const img = await new Promise((resolve, reject) => {
                const i = new Image();
                i.onload  = () => resolve(i);
                i.onerror = () => reject(new Error("Result image load failed"));
                i.src = resultDataUrl;
            });

            this._saveUndo();

            if (asNew) {
                const newL = this._layerMgr.addLayer("image", layer.name + " (no bg)", {
                    contentW: img.width,    contentH: img.height,
                    displayW: layer.displayW, displayH: layer.displayH,
                    x: layer.x,            y: layer.y,
                });
                newL.ctx.drawImage(img, 0, 0);
                this._layerMgr.setActive(newL.id);
                if (this._activeTool === "select") this._selectTool?.setLayer(newL);
            } else {
                layer.canvas.width  = img.width;
                layer.canvas.height = img.height;
                layer.ctx = layer.canvas.getContext("2d");
                layer.ctx.drawImage(img, 0, 0);
            }

            this._updateCompositeView();
            this._refreshLayerList();
            setStatus("Done!");
            setTimeout(() => setStatus(""), 3000);
            this._toast("Background removed", "success");

        } catch (err) {
            setStatus("Error: " + err.message);
            this._toast("BG remove failed: " + err.message, "error");
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // ── アップスケール（imgeditタブの実行パイプラインを移植） ──

    async _applyUpscale() {
        if (!this._layerMgr) { this._toast("No image loaded", "error"); return; }
        const layer = this._layerMgr.activeLayer;
        if (!layer)  { this._toast("No active layer", "error"); return; }

        const scale   = parseFloat(document.getElementById("ie-upscale-scale")?.value ?? "2");
        const sharpen = parseInt(document.getElementById("ie-upscale-sharpen")?.value ?? "30", 10) / 100;
        const denoise = document.getElementById("ie-upscale-denoise")?.checked ?? false;
        const statusEl = document.getElementById("ie-upscale-status");
        const btn      = document.getElementById("ie-upscale-run-btn");
        const setStatus = msg => { if (statusEl) statusEl.textContent = msg; };

        if (btn) btn.disabled = true;
        setStatus(t("layout.processing"));

        try {
            this._syncActiveLayerFromCanvas();
            const dataUrl = layer.canvas.toDataURL("image/png");
            if (denoise) setStatus(t("image.upscaleDenoising"));
            setStatus(t("image.upscaleRunning"));
            const resultDataUrl = await _procUpscale(dataUrl, scale, denoise, sharpen);

            const img = await new Promise((resolve, reject) => {
                const i = new Image();
                i.onload  = () => resolve(i);
                i.onerror = () => reject(new Error("Result image load failed"));
                i.src = resultDataUrl;
            });

            this._saveUndo();
            // ネイティブ解像度だけ上げる（displayW/Hは維持し、見た目のサイズは変えず画質のみ向上させる）
            layer.canvas.width  = img.width;
            layer.canvas.height = img.height;
            layer.ctx = layer.canvas.getContext("2d");
            layer.ctx.drawImage(img, 0, 0);

            this._updateCompositeView();
            this._refreshLayerList();
            setStatus(t("common.done"));
            setTimeout(() => setStatus(""), 3000);
            this._toast(`Upscaled to ${img.width}×${img.height}`, "success");
        } catch (err) {
            setStatus(t("common.errorPrefix", err.message));
            this._toast("Upscale failed: " + err.message, "error");
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // ── G'MIC連携（comic-creator既存ルート /api/ccc/local-gmic/* を使用） ──

    async _gmicOpenGui() {
        if (!this._layerMgr) { this._toast("No image loaded", "error"); return; }
        const layer = this._layerMgr.activeLayer;
        if (!layer)  { this._toast("No active layer", "error"); return; }
        this._syncActiveLayerFromCanvas();

        if (this._gmicState.processing) return;

        const dataUrl = layer.canvas.toDataURL("image/png");

        this._gmicState.processing = true;
        const openBtn      = document.getElementById("ie-gmic-open-btn");
        const progressArea = document.getElementById("ie-gmic-progress-area");
        const progressLbl  = document.getElementById("ie-gmic-progress-lbl");
        const applyBtn     = document.getElementById("ie-gmic-apply-btn");

        if (openBtn) openBtn.disabled = true;
        if (applyBtn) applyBtn.disabled = true;
        if (progressArea) progressArea.style.display = "flex";
        if (progressLbl) progressLbl.textContent = t("image.gmicSendingImage");

        try {
            const res = await fetch("/api/ccc/local-gmic/open_in_gui_b64", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ image_b64: dataUrl })
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(resolveBackendError(err.error_code, err.error_params) || err.detail || `HTTP ${res.status}`);
            }
            const data = await res.json();
            this._gmicState.lastResultJobId = data.job_id;
            if (progressLbl) progressLbl.textContent = t("image.gmicEditingHint");
            await this._gmicWaitForJob(data.job_id);
        } catch (e) {
            if (e.message !== "__aborted__") {
                this._toast("G'MIC Error: " + e.message, "error");
            }
            this._gmicState.processing = false;
            this._gmicState.aborted = false;
            if (openBtn) openBtn.disabled = false;
            if (progressArea) progressArea.style.display = "none";
        }
    }

    _gmicAbort() {
        this._gmicState.aborted = true;
        this._gmicState.processing = false;
        const openBtn      = document.getElementById("ie-gmic-open-btn");
        const progressArea = document.getElementById("ie-gmic-progress-area");
        if (progressArea) progressArea.style.display = "none";
        if (openBtn) openBtn.disabled = false;
    }

    async _gmicWaitForJob(jobId) {
        const progressLbl = document.getElementById("ie-gmic-progress-lbl");
        const applyBtn    = document.getElementById("ie-gmic-apply-btn");
        const maxWait = 600, interval = 2000;
        const start = Date.now();
        this._gmicState.aborted = false;

        while (true) {
            if (this._gmicState.aborted) throw new Error("__aborted__");
            if ((Date.now() - start) / 1000 > maxWait) throw new Error("Timeout");
            await new Promise(r => setTimeout(r, interval));
            if (this._gmicState.aborted) throw new Error("__aborted__");
            try {
                const res = await fetch(`/api/ccc/local-gmic/status/${jobId}`, { signal: AbortSignal.timeout(5000) });
                if (res.status === 404) throw new Error("__aborted__");
                if (!res.ok) continue;
                const status = await res.json();
                if (status.status === "completed") {
                    this._gmicState.lastResultJobId = jobId;
                    if (applyBtn) applyBtn.disabled = false;
                    if (progressLbl) progressLbl.textContent = t("image.gmicApplyHint");
                    this._gmicState.processing = false;
                    this._toast("G'MIC filtering complete. Click Apply to insert result.", "success");
                    return;
                }
                if (status.status === "failed") {
                    if (progressLbl) progressLbl.textContent = resolveBackendError(status.error_code, status.error_params) || t("image.gmicCancelled");
                    throw new Error("__aborted__");
                }
                if (progressLbl) progressLbl.textContent = resolveBackendError(status.message_code, null) || t("image.gmicEditing");
            } catch (e) {
                if (e.message === "__aborted__" || e.message.includes("Timeout")) throw e;
            }
        }
    }

    async _gmicApplyResult() {
        if (!this._gmicState.lastResultJobId) {
            this._toast("No G'MIC result to apply", "error");
            return;
        }
        const applyBtn = document.getElementById("ie-gmic-apply-btn");
        const openBtn  = document.getElementById("ie-gmic-open-btn");
        const progressArea = document.getElementById("ie-gmic-progress-area");
        if (applyBtn) applyBtn.disabled = true;

        try {
            const statusRes = await fetch(`/api/ccc/local-gmic/status/${this._gmicState.lastResultJobId}`);
            if (!statusRes.ok) throw new Error(`HTTP ${statusRes.status}`);
            const statusData = await statusRes.json();
            if (!statusData.result_path) throw new Error("No result path found");

            const b64res = await fetch("/api/ccc/local-gmic/result_b64", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ result_path: statusData.result_path })
            });
            if (!b64res.ok) throw new Error(`HTTP ${b64res.status}`);
            const { image_b64: dataUrl } = await b64res.json();

            const img = await new Promise((resolve, reject) => {
                const i = new Image();
                i.onload  = () => resolve(i);
                i.onerror = () => reject(new Error("Failed to load result image"));
                i.src = dataUrl;
            });

            this._saveUndo();

            const layer = this._layerMgr.activeLayer;
            if (!layer) throw new Error("No active layer");

            layer.canvas.width  = img.width;
            layer.canvas.height = img.height;
            layer.ctx = layer.canvas.getContext("2d");
            layer.ctx.drawImage(img, 0, 0);

            this._updateCompositeView();
            this._refreshLayerList();
            this._toast("G'MIC filter applied successfully", "success");

            // 設定タブの「G'MIC結果を自動保存」がONならEagleへも自動保存する（imgeditタブの挙動を移植）
            if (this._isEagleAutoSaveGmicEnabled() && typeof window.saveToEagle === "function") {
                const gname = `gmic_image_tab_${Date.now()}.png`;
                window.saveToEagle(layer.canvas.toDataURL("image/png"), gname, ["comfyui-comic-creator", "gmic"]);
            }

            this._gmicState.lastResultJobId = null;
            this._gmicState.processing = false;
            if (openBtn) openBtn.disabled = false;
            if (progressArea) progressArea.style.display = "none";
            this._renderToolOptions("filter");
        } catch (err) {
            this._toast("Failed to apply G'MIC result: " + err.message, "error");
            if (applyBtn) applyBtn.disabled = false;
        }
    }

    // main.js側の設定（localStorage "eagle_settings"）を直接読む。
    // _eagleSettingsはconst宣言のためwindow経由でアクセスできないので、同じキーを直接参照する。
    _isEagleAutoSaveGmicEnabled() {
        try {
            const settings = JSON.parse(localStorage.getItem("eagle_settings") || "{}");
            return !!settings.autoSaveGmic;
        } catch {
            return false;
        }
    }

    // ── SAM3 セグメンテーション（Mask Editor One）──────

    async _runSam3Segment() {
        if (!this._layerMgr || this._sam3Loading) return;
        const prompt = this._sam3Prompt.trim();
        if (!prompt) { this._toast("Please enter a prompt", "info"); return; }

        let imageLayer = this._layerMgr.activeLayer;
        if (!imageLayer || imageLayer.type === "mask") {
            imageLayer = this._layerMgr.layers.find(l => l.type !== "mask" && l.visible);
        }
        if (!imageLayer) { this._toast("No image layer found", "error"); return; }

        const NODE_ID = "cc_image_tab_sam3";
        this._sam3Loading  = true;
        this._sam3Results  = [];
        this._sam3Selected = new Set();
        this._renderToolOptions("mask");
        this._renderMaskProps("sam3");

        try {
            const dataUrl = imageLayer.canvas.toDataURL("image/png");
            await fetch("/mask_editor/store_image", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ node_id: NODE_ID, image_b64: dataUrl }),
            });

            const resp = await fetch("/mask_editor/sam3/segment", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ node_id: NODE_ID, prompt, max_masks: this._sam3MaxMasks }),
            });
            const json = await resp.json();
            if (json.error) throw new Error(json.error);
            this._sam3Results = json.masks || [];
            if (this._sam3Results.length === 0) this._toast("No masks found", "info");
            else this._toast(`${this._sam3Results.length} mask(s) found`, "success");
        } catch (err) {
            this._toast("SAM3 error: " + err.message, "error");
        } finally {
            this._sam3Loading = false;
            this._renderToolOptions("mask");
            this._renderMaskProps("sam3");
        }
    }

    async _applySelectedSam3Masks() {
        if (!this._layerMgr || this._sam3Selected.size === 0) return;
        const indices = [...this._sam3Selected].sort((a, b) => a - b);
        const masks   = indices.map(i => this._sam3Results[i]).filter(Boolean);
        if (masks.length === 0) return;

        let maskLayer = this._layerMgr.activeLayer;
        if (!maskLayer || maskLayer.type !== "mask") {
            const ref = this._layerMgr.activeLayer;
            maskLayer = this._layerMgr.addLayer("mask", "SAM3 Mask", {
                contentW: ref?.canvas.width  ?? this._layerMgr.width,
                contentH: ref?.canvas.height ?? this._layerMgr.height,
                displayW: ref?.displayW      ?? this._layerMgr.width,
                displayH: ref?.displayH      ?? this._layerMgr.height,
                x: ref?.x ?? 0, y: ref?.y ?? 0,
            });
            this._layerMgr.setActive(maskLayer.id);
        }

        this._saveUndo();
        for (const r of masks) {
            await this._applySam3Mask(maskLayer, r.mask_b64, this._sam3Mode);
        }

        this._updateCompositeView();
        this._refreshLayerList();
        this._toast(`SAM3: ${masks.length} mask(s) applied (${this._sam3Mode})`, "success");
    }

    _applySam3Mask(maskLayer, maskB64, mode = "add") {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                const W = maskLayer.canvas.width;
                const H = maskLayer.canvas.height;
                // グレースケール輝度 → アルファ白マスクに変換
                const off = document.createElement("canvas");
                off.width = W; off.height = H;
                const mc = off.getContext("2d");
                mc.drawImage(img, 0, 0, W, H);
                const imgData = mc.getImageData(0, 0, W, H);
                const d = imgData.data;
                for (let i = 0; i < d.length; i += 4) {
                    const lum = d[i];
                    d[i] = d[i+1] = d[i+2] = 255;
                    d[i+3] = lum;
                }
                mc.putImageData(imgData, 0, 0);
                maskLayer.ctx.save();
                maskLayer.ctx.globalCompositeOperation = mode === "erase" ? "destination-out" : "source-over";
                maskLayer.ctx.drawImage(off, 0, 0);
                maskLayer.ctx.restore();
                resolve();
            };
            img.onerror = () => resolve();
            img.src = maskB64;
        });
    }

    // ── ABR ブラシピッカー（Mask Editor One）──────────
    // targetTool: MaskTool または DrawTool インスタンス。onApply: ブラシ選択後の再描画コールバック。

    _openAbrBrushPickerFor(targetTool, onApply, titleSuffix, tintColor) {
        const existing = document.getElementById("cc-abr-picker-overlay");
        if (existing) { existing.remove(); return; }

        const overlay = document.createElement("div");
        overlay.id = "cc-abr-picker-overlay";
        Object.assign(overlay.style, {
            position: "fixed", inset: "0",
            background: "rgba(0,0,0,0.55)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: "99999",
        });

        const modal = document.createElement("div");
        Object.assign(modal.style, {
            background: "var(--it-surface, #2a2a2a)",
            border: "1px solid var(--it-border, #444)",
            borderRadius: "8px",
            width: "640px", height: "460px",
            display: "flex", flexDirection: "column",
            overflow: "hidden",
            boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
            color: "var(--it-text, #ddd)",
            fontFamily: "sans-serif",
        });

        const header = document.createElement("div");
        Object.assign(header.style, {
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "8px 12px",
            borderBottom: "1px solid var(--it-border, #444)",
            fontWeight: "bold", fontSize: "13px", flexShrink: "0",
        });
        const headerTitle = document.createElement("span");
        headerTitle.textContent = `ABR Brush Library${titleSuffix ? " — " + titleSuffix : ""}`;
        const closeBtn = document.createElement("button");
        closeBtn.textContent = "×";
        closeBtn.className = "it-btn it-btn-sm";
        closeBtn.style.cssText = "font-size:16px;padding:0 6px;";
        closeBtn.onclick = () => overlay.remove();
        header.appendChild(headerTitle);
        header.appendChild(closeBtn);
        modal.appendChild(header);

        const body = document.createElement("div");
        Object.assign(body.style, { display: "flex", flex: "1", overflow: "hidden" });

        const treeEl = document.createElement("div");
        Object.assign(treeEl.style, {
            width: "150px", flexShrink: "0",
            borderRight: "1px solid var(--it-border, #444)",
            overflowY: "auto", padding: "4px 0", fontSize: "12px",
        });

        const gridEl = document.createElement("div");
        Object.assign(gridEl.style, {
            flex: "1", overflowY: "auto",
            display: "flex", flexWrap: "wrap",
            alignContent: "flex-start", padding: "6px", gap: "4px",
        });

        body.appendChild(treeEl);
        body.appendChild(gridEl);
        modal.appendChild(body);

        const footer = document.createElement("div");
        Object.assign(footer.style, {
            display: "flex", gap: "8px", padding: "8px 12px", flexShrink: "0",
            borderTop: "1px solid var(--it-border, #444)",
        });
        const resetBtn = document.createElement("button");
        resetBtn.className = "it-btn it-btn-sm";
        resetBtn.textContent = "⬤ Round Brush (default)";
        resetBtn.onclick = () => {
            targetTool?.clearImageBrush();
            onApply();
            overlay.remove();
        };
        footer.appendChild(resetBtn);
        modal.appendChild(footer);

        overlay.appendChild(modal);
        overlay.addEventListener("mousedown", e => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);

        const tree = this._abrBrushTree;
        let selectedFolder = null;
        const expanded = new Set();

        const collectFiles = (nodes) => {
            const result = [];
            for (const n of nodes) {
                if (n.type === "file") result.push(n);
                else if (n.type === "folder" && n.children) result.push(...collectFiles(n.children));
            }
            return result;
        };

        const findFolder = (nodes, path) => {
            for (const n of nodes) {
                if (n.type !== "folder") continue;
                if (n.path === path) return n;
                const found = findFolder(n.children || [], path);
                if (found) return found;
            }
            return null;
        };

        let cr = 255, cg = 255, cb = 255;
        if (tintColor) {
            const hex = tintColor.replace("#", "");
            cr = parseInt(hex.slice(0, 2), 16);
            cg = parseInt(hex.slice(2, 4), 16);
            cb = parseInt(hex.slice(4, 6), 16);
        }

        const makeBrushThumb = (node) => {
            const item = document.createElement("div");
            Object.assign(item.style, {
                width: "72px", cursor: "pointer", textAlign: "center",
                padding: "4px", borderRadius: "4px",
                border: "1px solid var(--it-border, #444)",
                background: "var(--it-bg, #1a1a1a)",
                boxSizing: "border-box",
            });
            item.title = node.name;

            const THUMB = 64;
            const canvas = document.createElement("canvas");
            canvas.width = THUMB; canvas.height = THUMB;
            canvas.style.cssText = "display:block;border-radius:3px;";
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = "#1a1a2a";
            ctx.fillRect(0, 0, THUMB, THUMB);

            const img = new Image();
            img.onload = () => {
                const srcW = img.naturalWidth || img.width;
                const srcH = img.naturalHeight || img.height;
                const aspect = srcW / srcH || 1;
                const WORK = 128;
                const wW = aspect >= 1 ? WORK : Math.max(1, Math.round(WORK * aspect));
                const wH = aspect >= 1 ? Math.max(1, Math.round(WORK / aspect)) : WORK;
                const tmp = document.createElement("canvas");
                tmp.width = wW; tmp.height = wH;
                const stx = tmp.getContext("2d");
                stx.drawImage(img, 0, 0, wW, wH);
                const id = stx.getImageData(0, 0, wW, wH);
                const d = id.data;
                let hasAlpha = false;
                for (let i = 3; i < d.length; i += 4) if (d[i] < 250) { hasAlpha = true; break; }
                let invertLum = false;
                if (!hasAlpha) {
                    const corners = [0, wW - 1, wW * (wH - 1), wW * wH - 1];
                    let bg = 0;
                    for (const ci of corners) { const ii = ci * 4; bg += (d[ii] * 0.299 + d[ii+1] * 0.587 + d[ii+2] * 0.114) / 255; }
                    invertLum = (bg / corners.length) > 0.5;
                }
                for (let i = 0; i < d.length; i += 4) {
                    const a = hasAlpha ? d[i+3] / 255 : (() => { const l = (d[i]*0.299 + d[i+1]*0.587 + d[i+2]*0.114)/255; return invertLum ? 1-l : l; })();
                    d[i] = cr; d[i+1] = cg; d[i+2] = cb; d[i+3] = Math.round(a * 255);
                }
                stx.putImageData(id, 0, 0);
                const THRESHOLD = 15;
                let x0 = wW, x1 = -1, y0 = wH, y1 = -1;
                for (let y = 0; y < wH; y++) for (let x = 0; x < wW; x++) if (d[(y*wW+x)*4+3] > THRESHOLD) { if (x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; }
                if (x1 >= x0 && y1 >= y0) {
                    const cW = x1-x0+1, cH = y1-y0+1;
                    const s = Math.min((THUMB-4)/cW, (THUMB-4)/cH);
                    ctx.drawImage(tmp, x0, y0, cW, cH, Math.round((THUMB-Math.round(cW*s))/2), Math.round((THUMB-Math.round(cH*s))/2), Math.round(cW*s), Math.round(cH*s));
                }
            };
            img.src = `/mask_editor/brushes/raw?path=${encodeURIComponent(node.path)}`;
            item.appendChild(canvas);

            const label = document.createElement("div");
            label.textContent = node.name;
            Object.assign(label.style, { fontSize: "10px", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--it-text-secondary, #999)" });
            item.appendChild(label);

            item.addEventListener("mouseenter", () => { item.style.background = "color-mix(in srgb, var(--it-primary, #4682e6) 20%, transparent)"; item.style.borderColor = "var(--it-primary, #4682e6)"; });
            item.addEventListener("mouseleave", () => { item.style.background = "var(--it-bg, #1a1a1a)"; item.style.borderColor = "var(--it-border, #444)"; });
            item.onclick = () => {
                const loadImg = new Image();
                loadImg.onload = () => {
                    targetTool?.setImageBrush(loadImg, node.name);
                    onApply();
                    overlay.remove();
                };
                loadImg.src = `/mask_editor/brushes/raw?path=${encodeURIComponent(node.path)}`;
            };
            return item;
        };

        const showFolder = (path) => {
            const files = path === null ? collectFiles(tree) : collectFiles(findFolder(tree, path)?.children || []);
            gridEl.innerHTML = "";
            if (files.length === 0) {
                const msg = document.createElement("span");
                msg.style.cssText = "font-size:12px;color:var(--it-text-secondary,#999);padding:12px;";
                msg.textContent = tree.length === 0 ? "No brushes installed" : "No brushes in this folder";
                gridEl.appendChild(msg);
                return;
            }
            for (const file of files) gridEl.appendChild(makeBrushThumb(file));
        };

        const renderTree = () => {
            treeEl.innerHTML = "";
            const allItem = document.createElement("div");
            Object.assign(allItem.style, {
                padding: "5px 10px", cursor: "pointer", fontSize: "12px",
                background: selectedFolder === null ? "color-mix(in srgb, var(--it-primary, #4682e6) 25%, transparent)" : "",
            });
            allItem.textContent = "All Brushes";
            allItem.onclick = () => { selectedFolder = null; renderTree(); showFolder(null); };
            treeEl.appendChild(allItem);

            const renderNodes = (nodes, depth) => {
                for (const n of nodes) {
                    if (n.type !== "folder") continue;
                    const isExpanded = expanded.has(n.path);
                    const item = document.createElement("div");
                    Object.assign(item.style, {
                        padding: `5px 10px 5px ${10 + depth * 12}px`,
                        cursor: "pointer", fontSize: "12px", display: "flex", alignItems: "center", gap: "4px",
                        background: selectedFolder === n.path ? "color-mix(in srgb, var(--it-primary, #4682e6) 25%, transparent)" : "",
                    });
                    const arrow = document.createElement("span");
                    arrow.style.cssText = "font-size:9px;color:var(--it-text-secondary,#999);flex-shrink:0;";
                    arrow.textContent = isExpanded ? "▼" : "▶";
                    const nameSpan = document.createElement("span");
                    nameSpan.textContent = n.name;
                    nameSpan.style.overflow = "hidden";
                    nameSpan.style.textOverflow = "ellipsis";
                    nameSpan.style.whiteSpace = "nowrap";
                    item.appendChild(arrow);
                    item.appendChild(nameSpan);
                    item.onclick = () => {
                        if (isExpanded) expanded.delete(n.path); else expanded.add(n.path);
                        selectedFolder = n.path;
                        renderTree(); showFolder(n.path);
                    };
                    treeEl.appendChild(item);
                    if (isExpanded) renderNodes(n.children || [], depth + 1);
                }
            };
            renderNodes(tree, 0);
        };

        renderTree();
        showFolder(null);
    }

    _openAbrBrushPicker() {
        this._openAbrBrushPickerFor(
            this._maskTool,
            () => { this._renderMaskProps("paint"); this._renderToolOptions("mask"); },
            "MASK EDITOR ONE",
            null,
        );
    }

    _openAbrBrushPickerForDraw() {
        this._openAbrBrushPickerFor(
            this._drawTool,
            () => this._renderDrawProps(),
            "MASK EDITOR ONE (COLOR)",
            this._drawTool?.color ?? "#ff0000",
        );
    }
}

export const imageTab = new ImageTab();
window._ccImageTab = imageTab;
window.initImageTab = () => imageTab.init();
