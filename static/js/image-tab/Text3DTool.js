// Text3DTool.js — Imageタブ用 3Dテキストツール
//
// TextTool.js と異なり、textareaオーバーレイの代わりにThree.jsの3Dビューを
// ie-canvas-container 上にオーバーレイ表示する。コントロール（テキスト内容・
// フォント・押し出し量等）は image-tab.js 側の _renderToolOptions("text3d") が
// 用意し、このクラスのプロパティを直接読み書きする。
//
// 座標変換は TextTool._showOverlay と同じ考え方（hostCanvas.getBoundingClientRect()
// から実表示スケールを求める）で、ie-canvas-container の transform:scale(zoom) にも追従する。

import { loadFontForText3d } from '../text3d-font-loader.js';
import { openText3DSettingsModal } from '../text3d-settings-modal.js';
import { t } from '../i18n.js';
import { _fontMgrGoogleList } from '../main/19-font-manager.js';

const DEFAULT_CSS_W = 480;
const DEFAULT_CSS_H = 320;

let _systemFontFamiliesCache = null; // window.queryLocalFonts() の結果（family名の重複除去済み配列）をキャッシュ（25-text3d-bridge.jsと同一パターン）

async function _loadSystemFontFamilies() {
    if (typeof window.queryLocalFonts !== 'function') return [];
    try {
        const fonts = await window.queryLocalFonts();
        return Array.from(new Set(fonts.map(f => f.family))).sort();
    } catch (e) {
        console.warn('[text3d] システムフォント一覧の取得に失敗しました:', e);
        return [];
    }
}

// editor.getSvgWarnings() が返す警告キー → i18nキーの対応表（25-text3d-bridge.jsと同一マッピング）
const SVG_WARNING_I18N_KEYS = {
    svgTextNode: 'layout.text3dSvgTextNodeWarning',
    svgImageNode: 'layout.text3dSvgImageNodeWarning',
    svgNoPath: 'layout.text3dSvgNoPathWarning',
    svgParseFailed: 'layout.text3dSvgParseFailed',
    svgBevelTooLarge: 'layout.text3dSvgBevelTooLargeWarning',
};

function _formatSvgWarnings(keys) {
    return (keys || []).map(k => t(SVG_WARNING_I18N_KEYS[k] ?? k)).join(' / ');
}

export class Text3DTool {
    constructor(hostCanvas) {
        this.hostCanvas = hostCanvas; // ie-canvas-draw（座標変換の基準にのみ使う）
        this._wrapper = null;
        this._canvas = null;
        this._editor = null;
        this._onCommit = null;
        this._onCancel = null;
        this._commitX = 0;
        this._commitY = 0;
        this._displayW = DEFAULT_CSS_W;
        this._displayH = DEFAULT_CSS_H;

        this.text = '3D Text';
        this.fontFamily = 'BIZ UDPGothic';
        this.fontSource = 'google';
        this.renderMode = 'text'; // 'text' | 'svg'
        this.svgData = '';
        this.svgFileName = '';
        this.svgSize = 1.5;
        this.depth = 0.15;
        this.bevelEnabled = false;
        this.bevelThickness = 0.02;
        this.bevelSize = 0.01;
        this.bevelSegments = 2;
        this.frontColor = '#ffffff';
        this.sideColor = '#ffffff';
        this.separateSides = false;
        this.metalness = 0.1;
        this.roughness = 0.6;
        this.materialType = 'standard';
        this.shadeColor = '#999999';
        this.toony = 0.9;
        this.align = 'center';
        this.lineHeight = 1.4;
    }

    setCanvas(canvas) { this.hostCanvas = canvas; }
    onCommit(fn) { this._onCommit = fn; }
    onCancel(fn) { this._onCancel = fn; }

    // TextTool等と同じインターフェース（image-tab.jsの_setActiveTool/_activateCurrentToolから呼ばれる）
    activate() {}
    deactivate() { this.close(); }

    get isOpen() { return !!(this._wrapper && this._wrapper.style.opacity === '1'); }

    // クリック位置(canvasX, canvasY)を中心にオーバーレイを開く。
    // initialPropsを渡すと再編集モード（既存の3Dテキストの値を復元）になる。
    open(canvasX, canvasY, initialProps = null) {
        const cv = this.hostCanvas;
        if (!cv) return;
        const container = cv.parentElement;
        if (!container) return;

        const rect = cv.getBoundingClientRect();
        const scaleX = rect.width  / cv.width;
        const scaleY = rect.height / cv.height;
        const cssX = canvasX * scaleX;
        const cssY = canvasY * scaleY;

        if (!this._wrapper) {
            const wrapper = document.createElement('div');
            wrapper.className = 'ie-text3d-overlay';
            wrapper.style.cssText =
                'position:absolute; z-index:100; overflow:hidden; opacity:0; pointer-events:none; ' +
                'border:2px solid #40a0e0; box-sizing:border-box;';
            const canvas = document.createElement('canvas');
            canvas.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%;';
            wrapper.appendChild(canvas);
            this._wrapper = wrapper;
            this._canvas = canvas;
        }
        if (!container.contains(this._wrapper)) container.appendChild(this._wrapper);

        this._displayW = DEFAULT_CSS_W;
        this._displayH = DEFAULT_CSS_H;
        const left = Math.round(cssX - (DEFAULT_CSS_W * scaleX) / 2);
        const top  = Math.round(cssY - (DEFAULT_CSS_H * scaleY) / 2);
        this._wrapper.style.left   = `${left}px`;
        this._wrapper.style.top    = `${top}px`;
        this._wrapper.style.width  = `${DEFAULT_CSS_W * scaleX}px`;
        this._wrapper.style.height = `${DEFAULT_CSS_H * scaleY}px`;

        // レイヤー確定時の配置座標（canvas座標系＝非ズームのオリジナル解像度）は中心基準で左上に変換
        this._commitX = Math.round(canvasX - DEFAULT_CSS_W / 2);
        this._commitY = Math.round(canvasY - DEFAULT_CSS_H / 2);

        const dpr = window.devicePixelRatio || 1;
        const cw = Math.round(DEFAULT_CSS_W * dpr);
        const ch = Math.round(DEFAULT_CSS_H * dpr);
        if (this._canvas.width !== cw || this._canvas.height !== ch) {
            this._canvas.width = cw;
            this._canvas.height = ch;
        }

        if (initialProps) {
            this.text = initialProps.text ?? this.text;
            this.fontFamily = initialProps.fontFamily ?? this.fontFamily;
            this.fontSource = initialProps.fontSource ?? this.fontSource;
            // 旧データ（renderMode/svgData導入前）は常にテキストモードとして復元する
            this.renderMode = initialProps.renderMode === 'svg' ? 'svg' : 'text';
            this.svgData = initialProps.svgData ?? this.svgData;
            this.svgFileName = initialProps.svgFileName ?? this.svgFileName;
            this.svgSize = initialProps.svgSize ?? this.svgSize;
            this.depth = initialProps.depth ?? this.depth;
            this.bevelEnabled = !!initialProps.bevelEnabled;
            this.bevelThickness = initialProps.bevelThickness ?? this.bevelThickness;
            this.bevelSize = initialProps.bevelSize ?? this.bevelSize;
            this.bevelSegments = initialProps.bevelSegments ?? this.bevelSegments;
            // 旧データ（frontColor/sideColor導入前）は単色の`color`をfrontColor/sideColor両方へフォールバックする
            this.frontColor = initialProps.frontColor ?? initialProps.color ?? this.frontColor;
            this.sideColor = initialProps.sideColor ?? initialProps.frontColor ?? initialProps.color ?? this.sideColor;
            this.separateSides = !!initialProps.separateSides;
            this.metalness = initialProps.metalness ?? this.metalness;
            this.roughness = initialProps.roughness ?? this.roughness;
            this.materialType = initialProps.materialType ?? this.materialType;
            this.shadeColor = initialProps.shadeColor ?? this.shadeColor;
            this.toony = initialProps.toony ?? this.toony;
            this.align = initialProps.align ?? this.align;
            this.lineHeight = initialProps.lineHeight ?? this.lineHeight;
        }

        const initFn = window.initText3DEditor;
        if (typeof initFn !== 'function') {
            setTimeout(() => this.open(canvasX, canvasY, initialProps), 300);
            return;
        }

        if (!this._editor) {
            this._editor = initFn(this._canvas, {});
        }
        this._editor.resizeRenderer(cw, ch);
        this._applyAllPropsToEditor();

        loadFontForText3d(this.fontFamily, this.fontSource).then(font => {
            this._editor.setFont(font, this.fontFamily, this.fontSource);
            this._editor.setText(this.text);
        }).catch(err => {
            console.error('[text3d] フォント読込失敗:', err);
        });

        this._editor.startLoop();
        this._wrapper.style.opacity = '1';
        this._wrapper.style.pointerEvents = 'auto';
    }

    // 現在のプロパティ値をエディタへ一括反映する（フォント/テキスト以外）
    _applyAllPropsToEditor() {
        if (!this._editor) return;
        this._editor.setDepth(this.depth);
        this._editor.setBevel(this.bevelEnabled, {
            bevelThickness: this.bevelThickness,
            bevelSize: this.bevelSize,
            bevelSegments: this.bevelSegments,
        });
        this._editor.setFrontColor(this.frontColor);
        this._editor.setSideColor(this.sideColor);
        this._editor.setSeparateSides(this.separateSides);
        this._editor.setMaterialType(this.materialType);
        this._editor.setMetalness(this.metalness);
        this._editor.setRoughness(this.roughness);
        this._editor.setShadeColor(this.shadeColor);
        this._editor.setToony(this.toony);
        this._editor.setAlign(this.align);
        this._editor.setLineHeight(this.lineHeight);
        this._editor.setSvgSize(this.svgSize);
        this._editor.setSvgData(this.svgData);
        this._editor.setRenderMode(this.renderMode);
    }

    // フォント変更時（ソース/ファミリー変更）に呼ぶ
    async reloadFont() {
        if (!this._editor) return;
        try {
            const font = await loadFontForText3d(this.fontFamily, this.fontSource);
            this._editor.setFont(font, this.fontFamily, this.fontSource);
        } catch (err) {
            console.error('[text3d] フォント読込失敗:', err);
            throw err;
        }
    }

    // オプションバー（image-tab.js側のUI）からライブプレビューを更新するためのセッター群。
    // _editor（Three.jsエディタインスタンス）を外部から直接触らせないためのカプセル化。
    setText(v)       { this.text = v; this._editor?.setText(v); }
    setDepth(v)      { this.depth = v; this._editor?.setDepth(v); }
    setBevel(v)      { this.bevelEnabled = v; this._editor?.setBevel(v, { bevelThickness: this.bevelThickness, bevelSize: this.bevelSize, bevelSegments: this.bevelSegments }); }
    setBevelThickness(v) { this.bevelThickness = v; this._editor?.setBevel(this.bevelEnabled, { bevelThickness: v }); }
    setBevelSize(v)  { this.bevelSize = v; this._editor?.setBevel(this.bevelEnabled, { bevelSize: v }); }
    setBevelSegments(v) { this.bevelSegments = v; this._editor?.setBevel(this.bevelEnabled, { bevelSegments: v }); }
    setFrontColor(v) { this.frontColor = v; this._editor?.setFrontColor(v); }
    setSideColor(v)  { this.sideColor = v; this._editor?.setSideColor(v); }
    setSeparateSides(v) { this.separateSides = v; this._editor?.setSeparateSides(v); }
    setMaterialType(v) { this.materialType = v; this._editor?.setMaterialType(v); }
    setMetalness(v)  { this.metalness = v; this._editor?.setMetalness(v); }
    setRoughness(v)  { this.roughness = v; this._editor?.setRoughness(v); }
    setShadeColor(v) { this.shadeColor = v; this._editor?.setShadeColor(v); }
    setToony(v)      { this.toony = v; this._editor?.setToony(v); }
    setAlign(v)      { this.align = v; this._editor?.setAlign(v); }
    setLineHeight(v) { this.lineHeight = v; this._editor?.setLineHeight(v); }
    // OrbitControls操作でカメラを見失った場合に、現在のテキストが見える位置へ復帰させる
    resetCamera()    { this._editor?.resetCamera(); }

    // ---- SVG立体化モード ----
    setRenderMode(v) { this.renderMode = v; this._editor?.setRenderMode(v); }
    setSvgSize(v)    { this.svgSize = v; this._editor?.setSvgSize(v); }
    // SVGファイルを読み込んでエディタへ反映し、警告メッセージ（未パス化テキスト等）を返す
    async setSvgFile(file) {
        if (!file) return '';
        const svgString = await file.text();
        this.svgData = svgString;
        this.svgFileName = file.name;
        this._editor?.setSvgData(svgString);
        return _formatSvgWarnings(this._editor?.getSvgWarnings());
    }

    // ⚙設定モーダルを開く。マテリアル系セッターはthis.setXxx経由でthis.xxxにも反映させ、
    // commit()やopen()時の_applyAllPropsToEditor()が古い値で上書きしないようにする
    // （ライト・ズームモードは per-instance のプロパティを持たないためeditorへ直接委譲する）。
    openSettingsModal() {
        if (!this._editor) return;
        const editor = this._editor;
        openText3DSettingsModal({
            getLights: () => editor.getLights(),
            setLightColor: (id, hex) => editor.setLightColor(id, hex),
            setLightIntensity: (id, v) => editor.setLightIntensity(id, v),
            setLightPosition: (id, x, y, z) => editor.setLightPosition(id, x, y, z),
            getZoomMode: () => editor.getZoomMode(),
            setZoomMode: (m) => editor.setZoomMode(m),
            resetCamera: () => editor.resetCamera(),
            resizeRenderer: (w, h) => editor.resizeRenderer(w, h),
            getSuperSample: () => editor.getSuperSample(),
            setSuperSample: (v) => editor.setSuperSample(v),
            getParams: () => editor.getParams(),
            setFrontColor: (v) => this.setFrontColor(v),
            setSideColor: (v) => this.setSideColor(v),
            setSeparateSides: (v) => this.setSeparateSides(v),
            setMaterialType: (v) => this.setMaterialType(v),
            setMetalness: (v) => this.setMetalness(v),
            setRoughness: (v) => this.setRoughness(v),
            setShadeColor: (v) => this.setShadeColor(v),
            setToony: (v) => this.setToony(v),
            setBevelThickness: (v) => this.setBevelThickness(v),
            setBevelSize: (v) => this.setBevelSize(v),
            setBevelSegments: (v) => this.setBevelSegments(v),
            setText: (v) => this.setText(v),
            setAlign: (v) => this.setAlign(v),
            setLineHeight: (v) => this.setLineHeight(v),
        }, this._wrapper, {
            fontControls: {
                getFontSource: () => this.fontSource,
                setFontSource: (source) => { this.fontSource = source; },
                getFontFamily: () => this.fontFamily,
                setFontFamily: (family) => {
                    this.setFont(family, this.fontSource).catch(() => { /* エラーはreloadFont内でconsole出力済み */ });
                },
                getFontFamilyOptions: async (source) => {
                    if (source === 'system') {
                        if (_systemFontFamiliesCache) return _systemFontFamiliesCache;
                        _systemFontFamiliesCache = await _loadSystemFontFamilies();
                        return _systemFontFamiliesCache;
                    }
                    return _fontMgrGoogleList();
                },
            },
        });
    }

    async setFont(family, source) {
        this.fontFamily = family;
        this.fontSource = source;
        await this.reloadFont();
        this._editor?.setText(this.text);
    }

    commit() {
        if (!this._editor) return;
        const props = {
            text: this.text,
            fontFamily: this.fontFamily,
            fontSource: this.fontSource,
            renderMode: this.renderMode,
            svgData: this.svgData,
            svgFileName: this.svgFileName,
            svgSize: this.svgSize,
            depth: this.depth,
            bevelEnabled: this.bevelEnabled,
            bevelThickness: this.bevelThickness,
            bevelSize: this.bevelSize,
            bevelSegments: this.bevelSegments,
            frontColor: this.frontColor,
            sideColor: this.sideColor,
            separateSides: this.separateSides,
            metalness: this.metalness,
            roughness: this.roughness,
            materialType: this.materialType,
            shadeColor: this.shadeColor,
            toony: this.toony,
            align: this.align,
            lineHeight: this.lineHeight,
        };
        const dataUrl = this._editor.capture();
        const contentW = this._canvas.width;
        const contentH = this._canvas.height;
        const displayW = this._displayW;
        const displayH = this._displayH;
        const x = this._commitX;
        const y = this._commitY;

        this.close();
        if (this._onCommit) this._onCommit({ dataUrl, contentW, contentH, displayW, displayH, x, y, props });
    }

    cancel() {
        this.close();
        if (this._onCancel) this._onCancel();
    }

    close() {
        if (this._editor) this._editor.stopLoop();
        if (this._wrapper) {
            this._wrapper.style.opacity = '0';
            this._wrapper.style.pointerEvents = 'none';
        }
    }
}
