/**
 * Image Edit Tab - Fill Tool (bucket fill)
 * Flood-fills a contiguous same-color region on the active layer canvas,
 * either with a solid color or a linear/radial gradient.
 * Gradient ramp math (evalGradient / hex<->rgb) is ported from
 * comfyUI-particle-pixijs's particle_engine.js.
 */

function _hexToRgb01(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "#000000");
    if (!m) return { r: 0, g: 0, b: 0 };
    return { r: parseInt(m[1], 16) / 255, g: parseInt(m[2], 16) / 255, b: parseInt(m[3], 16) / 255 };
}

function _rgb01ToHex({ r, g, b }) {
    const h = v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
    return `#${h(r)}${h(g)}${h(b)}`;
}

function _lerp(a, b, t) { return a + (b - a) * t; }

export class FillTool {
    constructor() {
        // fill settings
        this.tolerance    = 32;        // 0-255
        this.fillMode     = "solid";   // "solid" | "gradient"
        this.color        = "#ff0000"; // solid fill color
        this.opacity      = 1.0;

        // gradient settings
        this.gradientShape    = "linear"; // "linear" | "radial"
        this.gradientAngleDeg = 0;        // linear direction
        this.gradientStrength = 1.0;      // 0.2-3.0, length/radius multiplier
        this.gradientStops    = [
            { pos: 0.0, color: "#ffffff" },
            { pos: 1.0, color: "#888888" },
        ];
        this.selectedStopIdx  = 0;

        // internal state
        this._active = false;
        this._canvas = null;
        this._ctx    = null;

        this._onChange = null;
    }

    setCanvas(canvas) {
        this._canvas = canvas;
        this._ctx    = canvas ? canvas.getContext("2d") : null;
    }

    onChange(cb) { this._onChange = cb; }

    activate()   { this._active = true; }
    deactivate() { this._active = false; }

    // ── color ramp evaluation (ported from particle_engine.js evalGradient) ──

    static evalGradient(stops, t) {
        if (!stops || stops.length === 0) return { r: 0, g: 0, b: 0 };
        const sorted = [...stops].sort((a, b) => a.pos - b.pos);
        if (t <= sorted[0].pos) return _hexToRgb01(sorted[0].color);
        const last = sorted[sorted.length - 1];
        if (t >= last.pos) return _hexToRgb01(last.color);
        for (let i = 0; i < sorted.length - 1; i++) {
            const a = sorted[i], b = sorted[i + 1];
            if (t >= a.pos && t <= b.pos) {
                const span = b.pos - a.pos;
                const localT = span > 0 ? (t - a.pos) / span : 0;
                const ca = _hexToRgb01(a.color), cb = _hexToRgb01(b.color);
                return {
                    r: _lerp(ca.r, cb.r, localT),
                    g: _lerp(ca.g, cb.g, localT),
                    b: _lerp(ca.b, cb.b, localT),
                };
            }
        }
        return _hexToRgb01(last.color);
    }

    /** Preview swatch color (hex) of the ramp at position t. */
    evalGradientHex(t) {
        return _rgb01ToHex(FillTool.evalGradient(this.gradientStops, t));
    }

    // ── stop editing helpers (ported from particle_widget.js addStop/removeStop/selectStop) ──

    addStop() {
        const sorted = [...this.gradientStops].sort((a, b) => a.pos - b.pos);
        let bestGapStart = 0, bestGapSize = 0;
        for (let i = 0; i < sorted.length - 1; i++) {
            const gap = sorted[i + 1].pos - sorted[i].pos;
            if (gap > bestGapSize) { bestGapSize = gap; bestGapStart = sorted[i].pos; }
        }
        const pos = sorted.length < 2 ? 0.5 : bestGapStart + bestGapSize / 2;
        const color = _rgb01ToHex(FillTool.evalGradient(this.gradientStops, pos));
        this.gradientStops.push({ pos, color });
        this.selectedStopIdx = this.gradientStops.length - 1;
    }

    removeStop(idx = this.selectedStopIdx) {
        if (this.gradientStops.length <= 1) return;
        this.gradientStops.splice(idx, 1);
        this.selectedStopIdx = Math.max(0, Math.min(this.selectedStopIdx, this.gradientStops.length - 1));
    }

    selectStop(idx) {
        this.selectedStopIdx = idx;
    }

    // ── flood fill ────────────────────────────────────────

    /**
     * Flood-fills the contiguous region matching the pixel at (x, y).
     * (x, y) are canvas-pixel coordinates (already converted via DrawTool.getCanvasPos).
     */
    onMouseDown(x, y) {
        if (!this._active || !this._ctx) return;
        const w = this._canvas.width, h = this._canvas.height;
        const px = Math.floor(x), py = Math.floor(y);
        if (px < 0 || py < 0 || px >= w || py >= h) return;

        const imgData = this._ctx.getImageData(0, 0, w, h);
        const data = imgData.data;

        const mask = this._buildFloodMask(data, w, h, px, py, this.tolerance);
        if (!mask) return;

        if (this.fillMode === "gradient") {
            this._fillMaskWithGradient(data, w, h, mask.pixels, mask.bbox);
        } else {
            this._fillMaskWithSolid(data, mask.pixels, this.color, this.opacity);
        }

        this._ctx.putImageData(imgData, 0, 0);
    }

    /** Scanline stack-based flood fill. Returns { pixels: Uint8Array(w*h), bbox } or null. */
    _buildFloodMask(data, w, h, startX, startY, tolerance) {
        const idx0 = (startY * w + startX) * 4;
        const tr = data[idx0], tg = data[idx0 + 1], tb = data[idx0 + 2], ta = data[idx0 + 3];
        const tol2 = tolerance * tolerance;

        const matches = (i) => {
            const dr = data[i] - tr, dg = data[i + 1] - tg, db = data[i + 2] - tb, da = data[i + 3] - ta;
            return (dr * dr + dg * dg + db * db + da * da) <= tol2 * 4;
        };

        const pixels = new Uint8Array(w * h);
        const stack = [[startX, startY]];
        let minX = startX, maxX = startX, minY = startY, maxY = startY;

        while (stack.length) {
            let [x, y] = stack.pop();
            while (x >= 0 && matches((y * w + x) * 4)) x--;
            x++;
            let spanUp = false, spanDown = false;
            while (x < w && matches((y * w + x) * 4) && !pixels[y * w + x]) {
                pixels[y * w + x] = 1;
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;

                if (y > 0) {
                    const above = matches((( y - 1) * w + x) * 4) && !pixels[(y - 1) * w + x];
                    if (above && !spanUp) { stack.push([x, y - 1]); spanUp = true; }
                    else if (!above) spanUp = false;
                }
                if (y < h - 1) {
                    const below = matches(((y + 1) * w + x) * 4) && !pixels[(y + 1) * w + x];
                    if (below && !spanDown) { stack.push([x, y + 1]); spanDown = true; }
                    else if (!below) spanDown = false;
                }
                x++;
            }
        }
        return { pixels, bbox: { minX, minY, maxX, maxY } };
    }

    _fillMaskWithSolid(data, pixels, colorHex, opacity) {
        const { r, g, b } = _hexToRgb01(colorHex);
        const cr = r * 255, cg = g * 255, cb = b * 255;
        const alpha = Math.max(0, Math.min(1, opacity));
        for (let i = 0; i < pixels.length; i++) {
            if (!pixels[i]) continue;
            const di = i * 4;
            data[di]     = _lerp(data[di],     cr, alpha);
            data[di + 1] = _lerp(data[di + 1], cg, alpha);
            data[di + 2] = _lerp(data[di + 2], cb, alpha);
            data[di + 3] = Math.max(data[di + 3], alpha * 255);
        }
    }

    /** Reusable with any {pixels, bbox} mask (flood fill today; rect/ellipse selections in the future). */
    _fillMaskWithGradient(data, w, h, pixels, bbox) {
        const cx = (bbox.minX + bbox.maxX) / 2, cy = (bbox.minY + bbox.maxY) / 2;
        const diagW = bbox.maxX - bbox.minX, diagH = bbox.maxY - bbox.minY;
        const diag = Math.max(1, Math.hypot(diagW, diagH));
        const strength = Math.max(0.2, Math.min(3.0, this.gradientStrength));
        const alpha = Math.max(0, Math.min(1, this.opacity));

        const angleRad = this.gradientAngleDeg * Math.PI / 180;
        const dirX = Math.cos(angleRad), dirY = Math.sin(angleRad);
        const halfLen = (diag / 2) * strength;
        const radius = (diag / 2) * strength;

        for (let y = bbox.minY; y <= bbox.maxY; y++) {
            for (let x = bbox.minX; x <= bbox.maxX; x++) {
                const i = y * w + x;
                if (!pixels[i]) continue;
                const dx = x - cx, dy = y - cy;
                let t;
                if (this.gradientShape === "radial") {
                    t = Math.hypot(dx, dy) / radius;
                } else {
                    t = (dx * dirX + dy * dirY) / (halfLen * 2) + 0.5;
                }
                t = Math.max(0, Math.min(1, t));
                const c = FillTool.evalGradient(this.gradientStops, t);
                const di = i * 4;
                data[di]     = _lerp(data[di],     c.r * 255, alpha);
                data[di + 1] = _lerp(data[di + 1], c.g * 255, alpha);
                data[di + 2] = _lerp(data[di + 2], c.b * 255, alpha);
                data[di + 3] = Math.max(data[di + 3], alpha * 255);
            }
        }
    }
}
