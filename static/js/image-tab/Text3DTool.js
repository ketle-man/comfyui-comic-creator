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

const DEFAULT_CSS_W = 480;
const DEFAULT_CSS_H = 320;

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
        this.depth = 0.15;
        this.bevelEnabled = false;
        this.color = '#ffffff';
        this.metalness = 0.1;
        this.roughness = 0.6;
        this.materialType = 'standard';
        this.shadeColor = '#999999';
        this.toony = 0.9;
        this.align = 'center';
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
            this.depth = initialProps.depth ?? this.depth;
            this.bevelEnabled = !!initialProps.bevelEnabled;
            this.color = initialProps.color ?? this.color;
            this.metalness = initialProps.metalness ?? this.metalness;
            this.roughness = initialProps.roughness ?? this.roughness;
            this.materialType = initialProps.materialType ?? this.materialType;
            this.shadeColor = initialProps.shadeColor ?? this.shadeColor;
            this.toony = initialProps.toony ?? this.toony;
            this.align = initialProps.align ?? this.align;
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
        this._editor.setBevel(this.bevelEnabled);
        this._editor.setColor(this.color);
        this._editor.setMaterialType(this.materialType);
        this._editor.setMetalness(this.metalness);
        this._editor.setRoughness(this.roughness);
        this._editor.setShadeColor(this.shadeColor);
        this._editor.setToony(this.toony);
        this._editor.setAlign(this.align);
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
    setBevel(v)      { this.bevelEnabled = v; this._editor?.setBevel(v); }
    setColor(v)      { this.color = v; this._editor?.setColor(v); }
    setMaterialType(v) { this.materialType = v; this._editor?.setMaterialType(v); }
    setMetalness(v)  { this.metalness = v; this._editor?.setMetalness(v); }
    setRoughness(v)  { this.roughness = v; this._editor?.setRoughness(v); }
    setShadeColor(v) { this.shadeColor = v; this._editor?.setShadeColor(v); }
    setToony(v)      { this.toony = v; this._editor?.setToony(v); }
    setAlign(v)      { this.align = v; this._editor?.setAlign(v); }
    // OrbitControls操作でカメラを見失った場合に、現在のテキストが見える位置へ復帰させる
    resetCamera()    { this._editor?.resetCamera(); }

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
            setColor: (v) => this.setColor(v),
            setMaterialType: (v) => this.setMaterialType(v),
            setMetalness: (v) => this.setMetalness(v),
            setRoughness: (v) => this.setRoughness(v),
            setShadeColor: (v) => this.setShadeColor(v),
            setToony: (v) => this.setToony(v),
        }, this._wrapper);
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
            depth: this.depth,
            bevelEnabled: this.bevelEnabled,
            color: this.color,
            metalness: this.metalness,
            roughness: this.roughness,
            materialType: this.materialType,
            shadeColor: this.shadeColor,
            toony: this.toony,
            align: this.align,
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
