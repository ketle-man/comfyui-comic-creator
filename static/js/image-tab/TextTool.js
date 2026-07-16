/**
 * Image Edit Tab - Text Tool
 * Measures text bounding box, renders to an off-screen canvas,
 * and calls onChange(clickX, clickY) so the caller can create
 * a proper text layer with the exact content size.
 */

export const TEXT_FONTS = [
    "Arial", "Arial Black", "Georgia", "Times New Roman",
    "Courier New", "Verdana", "Trebuchet MS", "Impact",
    "Comic Sans MS", "Tahoma",
];

const TEXT_PADDING = 4; // テキスト描画時の余白(px)

// 縦書きで90°回転させる約物（長音・ダッシュ・三点リーダ・括弧類）
const VERTICAL_ROTATE_CHARS = new Set([..."ーｰ－―‐-〜～…‥（）()「」『』［］[]｛｝{}〈〉《》【】＜＞<>＝="]);
// 縦書きで右上に寄せる句読点
const VERTICAL_PUNCT_CHARS = new Set([..."、。，．"]);
// 縦書きで少し右上に寄せる小書き仮名
const VERTICAL_SMALL_KANA = new Set([..."ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ"]);

function _isHalfwidthChar(ch) {
    const code = ch.charCodeAt(0);
    return code <= 0x00FF || (code >= 0xFF61 && code <= 0xFF9F);
}

/**
 * 縦書きテキストの文字単位レイアウトを計算する（余白は含まない）。
 * 行＝列として右から左に配置し、長音・括弧類・半角文字は90°回転で描画する。
 * measureCtx には呼び出し前に font をセットしておくこと。
 * @returns {{ cells: {ch:string, cx:number, cy:number, rotate:boolean}[], cols: {cx:number, h:number}[], w:number, h:number }}
 *          cx/cy はセル中心座標（textAlign=center / textBaseline=middle で描画する前提）。
 *          cols は列ごとの中心xと高さ（下線＝右側傍線の描画などに使う）
 */
export function layoutVerticalText(measureCtx, text, fontSize) {
    const lines = text.split("\n");
    const colW  = fontSize * 1.2;
    const w     = Math.max(1, lines.length * colW);
    const cells = [];
    const cols  = [];
    let maxColH = fontSize * 0.3;

    lines.forEach((line, li) => {
        const cx = w - colW * (li + 0.5); // 右の列から配置
        let y = 0;
        for (const ch of line) {
            const rotate  = VERTICAL_ROTATE_CHARS.has(ch) || _isHalfwidthChar(ch);
            const advance = rotate ? Math.max(measureCtx.measureText(ch).width, fontSize * 0.3) : fontSize;
            let dx = 0, dy = 0;
            if (VERTICAL_PUNCT_CHARS.has(ch))      { dx = fontSize * 0.3;  dy = -fontSize * 0.3; }
            else if (VERTICAL_SMALL_KANA.has(ch))  { dx = fontSize * 0.1;  dy = -fontSize * 0.1; }
            cells.push({ ch, cx: cx + dx, cy: y + advance / 2 + dy, rotate });
            y += advance;
        }
        cols.push({ cx, h: y });
        if (y > maxColH) maxColH = y;
    });

    return { cells, cols, w, h: Math.max(1, maxColH) };
}

/**
 * layoutVerticalText の結果を描画する共通ヘルパー。
 * ctx には font / fillStyle / strokeStyle / shadow などをセット済みであること。
 * 呼び出し中に textAlign=center / textBaseline=middle に変更する（呼び出し側でsave/restore推奨）。
 * @param {string} method - "fillText" | "strokeText"
 */
export function drawVerticalCells(ctx, cells, offsetX, offsetY, method) {
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    for (const cell of cells) {
        const x = offsetX + cell.cx;
        const y = offsetY + cell.cy;
        if (cell.rotate) {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(Math.PI / 2);
            ctx[method](cell.ch, 0, 0);
            ctx.restore();
        } else {
            ctx[method](cell.ch, x, y);
        }
    }
}

export class TextTool {
    constructor(canvas) {
        this.canvas     = canvas;
        this.text       = "Hello";
        this.fontFamily = "Arial";
        this.fontSize   = 64;
        this.bold       = false;
        this.italic     = false;
        this.align      = "left";
        this.vertical   = false;
        this.color      = "#ffffff";
        this._overlay   = null;
        this._onChange  = null;
    }

    setCanvas(canvas) {
        this._closeOverlay();
        this.canvas = canvas;
    }

    onChange(fn) { this._onChange = fn; }

    activate() {
        if (this.canvas) this.canvas.style.cursor = "text";
    }

    deactivate() {
        this._closeOverlay();
        if (this.canvas) this.canvas.style.cursor = "";
    }

    onMouseDown(x, y) {
        if (this._overlay) { this._closeOverlay(); return; }
        this._showOverlay(x, y);
    }

    /** 既存テキスト再編集用: プロパティを外部でセット後に呼ぶ */
    openAt(canvasX, canvasY) {
        this._closeOverlay();
        this._showOverlay(canvasX, canvasY);
    }

    onMouseMove() {}
    onMouseLeave() {}
    onMouseUp() {}

    /** テキストのバウンディングボックスサイズのcanvasを返す */
    createLayerData(clickX, clickY) {
        const lines = this.text.split("\n");
        const lineH = this.fontSize * 1.2;
        const font  = this._getCSSFont();

        // measureText 用の仮canvas
        const tmp    = document.createElement("canvas");
        const tmpCtx = tmp.getContext("2d");
        tmpCtx.font  = font;

        let tw, th, vLayout = null;
        if (this.vertical) {
            vLayout = layoutVerticalText(tmpCtx, this.text, this.fontSize);
            tw = Math.max(1, Math.ceil(vLayout.w + TEXT_PADDING * 2));
            th = Math.max(1, Math.ceil(vLayout.h + TEXT_PADDING * 2));
        } else {
            let maxW = 0;
            for (const line of lines) {
                const w = line.length > 0 ? tmpCtx.measureText(line).width : this.fontSize * 0.3;
                if (w > maxW) maxW = w;
            }
            tw = Math.max(1, Math.ceil(maxW + TEXT_PADDING * 2));
            th = Math.max(1, Math.ceil(lines.length * lineH + TEXT_PADDING * 2));
        }

        const canvas = document.createElement("canvas");
        canvas.width  = tw;
        canvas.height = th;
        const ctx = canvas.getContext("2d");
        ctx.font      = font;
        ctx.fillStyle = this.color;

        if (this.vertical) {
            drawVerticalCells(ctx, vLayout.cells, TEXT_PADDING, TEXT_PADDING, "fillText");
        } else {
            ctx.textBaseline = "top";
            ctx.textAlign    = this.align;

            let drawX = TEXT_PADDING;
            if (this.align === "center") drawX = tw / 2;
            else if (this.align === "right") drawX = tw - TEXT_PADDING;

            lines.forEach((line, i) => {
                ctx.fillText(line, drawX, TEXT_PADDING + i * lineH);
            });
        }

        return {
            canvas,
            width:  tw,
            height: th,
            x: clickX,
            y: clickY,
        };
    }

    // ── 内部 ──────────────────────────────────────

    _getCSSFont() {
        const parts = [];
        if (this.italic) parts.push("italic");
        if (this.bold)   parts.push("bold");
        parts.push(`${this.fontSize}px`);
        parts.push(`"${this.fontFamily}", sans-serif`);
        return parts.join(" ");
    }

    _showOverlay(canvasX, canvasY) {
        const cv     = this.canvas;
        const rect   = cv.getBoundingClientRect();
        const scaleX = rect.width  / cv.width;
        const scaleY = rect.height / cv.height;
        const cssX   = Math.round(canvasX * scaleX);
        const cssY   = Math.round(canvasY * scaleY);

        const container = cv.parentElement;
        const overlay   = document.createElement("div");
        overlay.className  = "ie-text-overlay";
        overlay.style.left = cssX + "px";
        overlay.style.top  = cssY + "px";

        const textarea = document.createElement("textarea");
        textarea.className   = "ie-text-textarea";
        textarea.value       = this.text;
        textarea.rows        = 3;
        textarea.placeholder = "Enter text…";
        overlay.appendChild(textarea);

        const btnRow    = document.createElement("div");
        btnRow.className = "ie-text-btn-row";

        const okBtn = document.createElement("button");
        okBtn.className   = "wfm-btn wfm-btn-sm wfm-btn-primary";
        okBtn.textContent = "OK";
        okBtn.onclick = () => {
            this.text = textarea.value;
            this._closeOverlay();
            // drawCanvasには描画せず、呼び出し側でレイヤーとして処理する
            if (this._onChange) this._onChange(canvasX, canvasY);
        };
        btnRow.appendChild(okBtn);

        const cancelBtn = document.createElement("button");
        cancelBtn.className   = "wfm-btn wfm-btn-sm";
        cancelBtn.textContent = "Cancel";
        cancelBtn.onclick     = () => this._closeOverlay();
        btnRow.appendChild(cancelBtn);

        overlay.appendChild(btnRow);
        container.appendChild(overlay);
        this._overlay = overlay;
        textarea.focus();

        textarea.addEventListener("keydown", e => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); okBtn.click(); }
            else if (e.key === "Escape") this._closeOverlay();
        });
    }

    _closeOverlay() {
        if (this._overlay) { this._overlay.remove(); this._overlay = null; }
    }
}
