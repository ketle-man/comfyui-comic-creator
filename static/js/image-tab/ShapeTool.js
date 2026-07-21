import { FillTool } from "./FillTool.js";

/**
 * ShapeTool — rect / ellipse / line / freeline drawing tool for Image Edit tab.
 * Preview is drawn on the overlay canvas; committed shapes become new draw layers.
 */
export class ShapeTool {
    constructor() {
        // shape settings
        this.shape       = "rect";
        this.rounded     = false;
        this.fillColor   = "#ff0000";
        this.fillNone    = false;
        // 塗り拡張（グラデーション/テクスチャ）。rect / ellipse のみ対応
        this.fillMode     = "solid"; // "solid" | "gradient" | "texture"
        this.fillGradient = { shape: "linear", angleDeg: 0, stops: [{ pos: 0, color: "#ffffff" }, { pos: 1, color: "#888888" }] };
        this.selectedFillStopIdx = 0;
        this.fillTexture  = null;    // { img, scale } — img は選択時にロード済みの Image
        this.strokeColor = "#000000";
        this.strokeNone  = true;
        this.strokeWidth = 5;
        this.opacity     = 1.0;
        this.spacing     = 20;   // chain / rope / original: 繰り返し配置の間隔(px)
        this.originalImg = null; // "original"(My曲線)で繰り返し配置するユニット画像
        this.originalImgName = null;

        // internal state
        this._active    = false;
        this._canvas    = null;  // overlay canvas (preview)
        this._ctx       = null;
        this._dragging  = false;
        this._dragStart = null;
        this._curPt     = null;
        this._points    = [];    // freeline / chain / rope / original points

        this._onChange = null;
    }

    static get PATH_KINDS() { return ["freeline", "chain", "rope", "original"]; }

    // overlay canvas used for live preview
    setCanvas(canvas) {
        this._canvas = canvas;
        this._ctx    = canvas ? canvas.getContext("2d") : null;
    }

    onChange(cb) { this._onChange = cb; }

    activate() {
        this._active = true;
    }

    deactivate() {
        this._active   = false;
        this._dragging = false;
        this._clearOverlay();
        if (this._canvas) this._canvas.style.cursor = "";
    }

    onMouseDown(x, y) {
        if (!this._active) return;
        this._dragging  = true;
        this._dragStart = { x, y };
        this._curPt     = { x, y };
        this._points    = ShapeTool.PATH_KINDS.includes(this.shape) ? [{ x, y }] : [];
    }

    onMouseMove(x, y) {
        if (!this._dragging) return;
        this._curPt = { x, y };
        if (ShapeTool.PATH_KINDS.includes(this.shape)) this._points.push({ x, y });
        this._drawPreview(x, y);
    }

    /** My曲線用のユニット画像を設定する */
    setOriginalImage(img, name) {
        this.originalImg     = img;
        this.originalImgName = name ?? null;
    }

    // ── 塗りグラデーション ストップ編集（FillTool.evalGradient を再利用） ──
    addFillStop() {
        const sorted = [...this.fillGradient.stops].sort((a, b) => a.pos - b.pos);
        let gapStart = 0, gapSize = 0;
        for (let i = 0; i < sorted.length - 1; i++) {
            const gap = sorted[i + 1].pos - sorted[i].pos;
            if (gap > gapSize) { gapSize = gap; gapStart = sorted[i].pos; }
        }
        const pos = sorted.length < 2 ? 0.5 : gapStart + gapSize / 2;
        const c = FillTool.evalGradient(this.fillGradient.stops, pos);
        const hex = "#" + [c.r, c.g, c.b].map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("");
        this.fillGradient.stops.push({ pos, color: hex });
        this.selectedFillStopIdx = this.fillGradient.stops.length - 1;
    }

    removeFillStop() {
        if (this.fillGradient.stops.length <= 1) return;
        this.fillGradient.stops.splice(this.selectedFillStopIdx, 1);
        this.selectedFillStopIdx = Math.max(0, Math.min(this.selectedFillStopIdx, this.fillGradient.stops.length - 1));
    }

    onMouseUp() {
        if (!this._dragging) return;
        this._dragging = false;
        this._clearOverlay();
        this._commit();
    }

    onMouseLeave() {
        if (!this._dragging) return;
        this._dragging = false;
        this._clearOverlay();
        this._commit();
    }

    // ── private ───────────────────────────────────────

    _clearOverlay() {
        if (this._ctx && this._canvas) {
            this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
        }
    }

    _drawPreview(curX, curY) {
        if (!this._ctx || !this._canvas) return;
        const ctx = this._ctx;
        ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);

        const s = this._dragStart;
        ctx.save();
        ctx.globalAlpha = this.opacity;

        if (ShapeTool.PATH_KINDS.includes(this.shape)) {
            // freeline / chain / rope / original: プレビューは経路をシンプルな線で表示
            if (this._points.length >= 2) {
                ctx.strokeStyle = this.shape === "original" ? "#ffd228" : this.strokeColor;
                ctx.lineWidth   = this.shape === "original" ? 2 : this.strokeWidth;
                ctx.lineCap     = "round";
                ctx.lineJoin    = "round";
                ctx.beginPath();
                ctx.moveTo(this._points[0].x, this._points[0].y);
                for (let i = 1; i < this._points.length; i++) ctx.lineTo(this._points[i].x, this._points[i].y);
                ctx.stroke();
            }
        } else {
            // dashed blue outline for rect / ellipse / line
            ctx.strokeStyle = "#0077ff";
            ctx.lineWidth   = Math.max(1, this.strokeWidth || 1);
            ctx.setLineDash([4, 2]);

            const x1 = Math.min(s.x, curX), y1 = Math.min(s.y, curY);
            const w  = Math.abs(curX - s.x),  h  = Math.abs(curY - s.y);

            if (this.shape === "ellipse") {
                ctx.beginPath();
                ctx.ellipse(x1 + w / 2, y1 + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
                ctx.stroke();
            } else if (this.shape === "line") {
                ctx.beginPath();
                ctx.moveTo(s.x, s.y);
                ctx.lineTo(curX, curY);
                ctx.stroke();
            } else {
                // rect
                if (this.rounded) {
                    const r = Math.min(w, h) * 0.15;
                    ctx.beginPath();
                    ctx.roundRect(x1, y1, w, h, r);
                    ctx.stroke();
                } else {
                    ctx.strokeRect(x1, y1, w, h);
                }
            }
            ctx.setLineDash([]);
        }
        ctx.restore();
    }

    _commit() {
        const s = this._dragStart, c = this._curPt;
        if (!s || !c) return;

        const isPath = ShapeTool.PATH_KINDS.includes(this.shape);
        const dx = Math.abs(c.x - s.x), dy = Math.abs(c.y - s.y);
        if (!isPath && dx < 2 && dy < 2) return;
        if (isPath && this._points.length < 2) return;
        if (this.shape === "original" && !this.originalImg) return;

        const isStrokeMandatory = ["line", "freeline", "chain", "rope"].includes(this.shape);
        const shapeObj = {
            kind:        this.shape,
            s:           { ...s },
            c:           { ...c },
            points:      isPath ? this._points.map(p => ({ ...p })) : [],
            fillColor:   this.fillNone   ? null : this.fillColor,
            fillMode:     this.fillMode,
            fillGradient: this.fillMode === "gradient" ? { shape: this.fillGradient.shape, angleDeg: this.fillGradient.angleDeg, stops: this.fillGradient.stops.map(s => ({ ...s })) } : null,
            fillTexture:  (this.fillMode === "texture" && this.fillTexture?.img) ? { img: this.fillTexture.img, scale: this.fillTexture.scale } : null,
            // line / freeline / chain / rope always use stroke; ignore strokeNone
            strokeColor: (isStrokeMandatory || !this.strokeNone) ? this.strokeColor : null,
            strokeWidth: (isStrokeMandatory || !this.strokeNone) ? this.strokeWidth : 0,
            opacity:     this.opacity,
            rounded:     this.rounded,
            spacing:     this.spacing,
            originalImg: this.shape === "original" ? this.originalImg : null,
        };

        this._onChange?.(shapeObj);
    }

    // ── static renderer (used by onChange callback to bake shape into layer) ──

    static drawShape(ctx, sh) {
        const { kind, s, c, points, fillColor, strokeColor, strokeWidth, opacity, rounded, spacing: savedSpacing, originalImg } = sh;
        ctx.save();
        ctx.globalAlpha = opacity ?? 1;

        if (kind === "freeline") {
            if (strokeColor && strokeWidth > 0 && points.length >= 2) {
                ctx.strokeStyle = strokeColor;
                ctx.lineWidth   = strokeWidth;
                ctx.lineCap     = "round";
                ctx.lineJoin    = "round";
                ctx.beginPath();
                ctx.moveTo(points[0].x, points[0].y);
                for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
                ctx.stroke();
            }
        } else if (kind === "chain") {
            if (strokeColor && strokeWidth > 0 && points.length >= 2) {
                const spacing = Math.max(1, savedSpacing ?? 20);
                let lastP = points[0];
                let toggle = false;
                for (let i = 1; i < points.length; i++) {
                    const cp = points[i];
                    const dx = cp.x - lastP.x, dy = cp.y - lastP.y;
                    let dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist >= spacing) {
                        const angle = Math.atan2(dy, dx);
                        while (dist >= spacing) {
                            lastP = { x: lastP.x + Math.cos(angle) * spacing, y: lastP.y + Math.sin(angle) * spacing };
                            ShapeTool._drawChainUnit(ctx, lastP.x, lastP.y, angle, strokeWidth / 5, toggle, strokeColor);
                            toggle = !toggle;
                            dist -= spacing;
                        }
                    }
                }
            }
        } else if (kind === "rope") {
            if (strokeColor && strokeWidth > 0 && points.length >= 2) {
                const spacing = Math.max(1, savedSpacing ?? 10);
                let lastP = points[0];
                for (let i = 1; i < points.length; i++) {
                    const cp = points[i];
                    const dx = cp.x - lastP.x, dy = cp.y - lastP.y;
                    let dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist >= spacing) {
                        const angle = Math.atan2(dy, dx);
                        while (dist >= spacing) {
                            lastP = { x: lastP.x + Math.cos(angle) * spacing, y: lastP.y + Math.sin(angle) * spacing };
                            ShapeTool._drawRopeUnit(ctx, lastP.x, lastP.y, angle, strokeWidth / 5);
                            dist -= spacing;
                        }
                    }
                }
            }
        } else if (kind === "original") {
            if (originalImg && points.length >= 2) {
                const spacing = Math.max(1, savedSpacing ?? 20);
                const scale = strokeWidth > 0 ? strokeWidth / 5 : 1;
                let lastP = points[0];
                for (let i = 1; i < points.length; i++) {
                    const cp = points[i];
                    const dx = cp.x - lastP.x, dy = cp.y - lastP.y;
                    let dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist >= spacing) {
                        const angle = Math.atan2(dy, dx);
                        while (dist >= spacing) {
                            lastP = { x: lastP.x + Math.cos(angle) * spacing, y: lastP.y + Math.sin(angle) * spacing };
                            ShapeTool._drawOriginalUnit(ctx, lastP.x, lastP.y, angle, scale, originalImg);
                            dist -= spacing;
                        }
                    }
                }
            }
        } else if (kind === "ellipse") {
            const x1 = Math.min(s.x, c.x), y1 = Math.min(s.y, c.y);
            const w  = Math.abs(c.x - s.x),  h  = Math.abs(c.y - s.y);
            ctx.beginPath();
            ctx.ellipse(x1 + w / 2, y1 + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
            if (fillColor)                       { ctx.fillStyle   = ShapeTool._fillStyleFor(ctx, sh, x1, y1, w, h); ctx.fill();   }
            if (strokeColor && strokeWidth > 0)  { ctx.strokeStyle = strokeColor; ctx.lineWidth = strokeWidth; ctx.stroke(); }
        } else if (kind === "line") {
            if (strokeColor && strokeWidth > 0) {
                ctx.strokeStyle = strokeColor;
                ctx.lineWidth   = strokeWidth;
                ctx.lineCap     = "round";
                ctx.beginPath();
                ctx.moveTo(s.x, s.y);
                ctx.lineTo(c.x, c.y);
                ctx.stroke();
            }
        } else {
            // rect
            const x1 = Math.min(s.x, c.x), y1 = Math.min(s.y, c.y);
            const w  = Math.abs(c.x - s.x),  h  = Math.abs(c.y - s.y);
            if (rounded) {
                const r = Math.min(w, h) * 0.15;
                ctx.beginPath();
                ctx.roundRect(x1, y1, w, h, r);
            } else {
                ctx.beginPath();
                ctx.rect(x1, y1, w, h);
            }
            if (fillColor)                       { ctx.fillStyle   = ShapeTool._fillStyleFor(ctx, sh, x1, y1, w, h); ctx.fill();   }
            if (strokeColor && strokeWidth > 0)  { ctx.strokeStyle = strokeColor; ctx.lineWidth = strokeWidth; ctx.stroke(); }
        }
        ctx.restore();
    }

    /**
     * 図形塗りのfillStyleを生成する（単色/グラデーション/テクスチャ）。
     * image-tab.js の _textFillStyle と同型だが、基準サイズはテキストのfontSizeではなく
     * 図形自身のバウンディングボックス(x1,y1,w,h)。テクスチャ画像は選択時にロード済みのImageを
     * そのまま使う（シェイプは確定時に一度だけラスタへ焼き込むため非同期キャッシュは不要）
     */
    static _fillStyleFor(ctx, sh, x1, y1, w, h) {
        const { fillMode, fillGradient, fillTexture, fillColor } = sh;
        if (fillMode === "gradient" && fillGradient?.stops?.length) {
            const cx = x1 + w / 2, cy = y1 + h / 2;
            let grad;
            if (fillGradient.shape === "radial") {
                grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, Math.hypot(w, h) / 2));
            } else {
                const rad = ((fillGradient.angleDeg || 0) * Math.PI) / 180;
                const dx = Math.cos(rad), dy = Math.sin(rad);
                const half = (Math.abs(dx) * w + Math.abs(dy) * h) / 2;
                grad = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
            }
            [...fillGradient.stops].sort((a, b) => a.pos - b.pos).forEach(st => {
                grad.addColorStop(Math.max(0, Math.min(1, st.pos)), st.color || "#000000");
            });
            return grad;
        }
        if (fillMode === "texture" && fillTexture?.img) {
            const pattern = ctx.createPattern(fillTexture.img, "repeat");
            const s = (fillTexture.scale || 100) / 100;
            if (pattern && typeof pattern.setTransform === "function" && typeof DOMMatrix !== "undefined") {
                pattern.setTransform(new DOMMatrix().scale(s, s));
            }
            if (pattern) return pattern;
        }
        return fillColor || "#000000";
    }

    // 鎖の一コマを描画（中心x,y / 角度 / スケール / toggle / 色）
    static _drawChainUnit(ctx, x, y, angle, scale, toggle, color) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.scale(scale, scale);
        ctx.lineWidth = 4;
        ctx.strokeStyle = color;
        ctx.beginPath();
        if (toggle) {
            ctx.ellipse(0, 0, 12, 6, 0, 0, Math.PI * 2);
        } else {
            ctx.moveTo(-5, 0);
            ctx.lineTo(5, 0);
            ctx.lineWidth = 8;
            ctx.lineCap = "round";
        }
        ctx.stroke();
        ctx.restore();
    }

    // ロープの一コマを描画
    static _drawRopeUnit(ctx, x, y, angle, scale) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.scale(scale, scale);
        ctx.fillStyle = "#D4A373";
        ctx.fillRect(-5, -6, 12, 12);
        ctx.strokeStyle = "#A98467";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-5, -6); ctx.lineTo(5, 6); ctx.stroke();
        ctx.strokeStyle = "#8B5A2B";
        ctx.lineWidth = 1;
        ctx.strokeRect(-5, -6, 12, 12);
        ctx.restore();
    }

    // My曲線: ユニット画像の一コマを描画
    static _drawOriginalUnit(ctx, x, y, angle, scale, img) {
        if (!img || !img.complete || img.naturalWidth === 0) return;
        const w = img.naturalWidth  * scale;
        const h = img.naturalHeight * scale;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
        ctx.restore();
    }

    // coordinate helper (same signature as DrawTool.getCanvasPos)
    static getCanvasPos(canvas, event) {
        const rect   = canvas.getBoundingClientRect();
        const scaleX = canvas.width  / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: (event.clientX - rect.left) * scaleX,
            y: (event.clientY - rect.top)  * scaleY,
        };
    }
}
