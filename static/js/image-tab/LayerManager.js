/**
 * Image Edit Tab - Layer & LayerManager
 * Inspired by comfyui-mask-editor-one LayerManager.js
 */

export class Layer {
    constructor(name, type, contentW, contentH) {
        this.id = crypto.randomUUID();
        this.name = name;
        this.type = type; // 'draw' | 'image' | 'text'
        // layer.canvas のサイズ = コンテンツのネイティブ解像度
        this.canvas = document.createElement("canvas");
        this.canvas.width  = contentW;
        this.canvas.height = contentH;
        this.ctx = this.canvas.getContext("2d");
        // 表示プロパティ
        this.visible   = true;
        this.opacity   = 1.0;
        this.blendMode = "source-over";
        // 変換プロパティ（キャンバス座標系での配置）
        this.x        = 0;            // 左上X
        this.y        = 0;            // 左上Y
        this.displayW = contentW;     // 表示幅
        this.displayH = contentH;     // 表示高さ
        this.rotation  = 0;            // 度
        this.flipX     = false;
        this.flipY     = false;
        this.textProps  = null;        // テキストレイヤー用プロパティ（再編集・再描画に使用）
        this.locked     = false;       // ロック中は SelectTool の変形を禁止
        this.maskApply  = false;       // マスクレイヤー: true=クリッピングマスクとして機能
        this.operation  = "add";       // マスクレイヤー合成モード: "add" | "subtract"
        this.adjType    = null;        // 調整レイヤー種別（'brightness'等）type==='adjustment'時のみ使用
        this.adjValue   = 0;           // 調整レイヤーの効果量
    }

    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    getThumbnailDataURL(size = 32) {
        const thumb = document.createElement("canvas");
        thumb.width  = size;
        thumb.height = size;
        const ctx = thumb.getContext("2d");

        if (this.type === "adjustment") {
            // 調整レイヤー: アイコン付きの単色サムネイル（実体コンテンツを持たないため）
            ctx.fillStyle = "#3a3a5a";
            ctx.fillRect(0, 0, size, size);
            ctx.fillStyle = "#cfd3ff";
            ctx.font = `${Math.round(size * 0.55)}px sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("⚙", size / 2, size / 2 + 1);
        } else if (this.type === "mask") {
            // マスクレイヤー: 黒背景に白マスクのグレースケール表示
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, size, size);
            ctx.drawImage(this.canvas, 0, 0, size, size);
        } else {
            // 通常レイヤー: チェッカーボード背景（透過表示用）
            ctx.fillStyle = "#aaa";
            ctx.fillRect(0, 0, size, size);
            ctx.fillStyle = "#fff";
            for (let x = 0; x < size; x += 8)
                for (let y = 0; y < size; y += 8)
                    if ((x / 8 + y / 8) % 2 === 0) ctx.fillRect(x, y, 8, 8);
            ctx.drawImage(this.canvas, 0, 0, size, size);
        }

        return thumb.toDataURL("image/png");
    }

    toJSON() {
        return {
            id: this.id, name: this.name, type: this.type,
            imageData: this.canvas.toDataURL("image/png"),
            visible: this.visible, opacity: this.opacity, blendMode: this.blendMode,
            x: this.x, y: this.y, displayW: this.displayW, displayH: this.displayH,
            rotation: this.rotation, flipX: this.flipX, flipY: this.flipY,
            textProps:  this.textProps  ?? null,
            locked:     this.locked     ?? false,
            maskApply:  this.maskApply  ?? false,
            operation:  this.operation  ?? "add",
            adjType:    this.adjType    ?? null,
            adjValue:   this.adjValue   ?? 0,
        };
    }

    static fromJSON(json) {
        const cw = json.contentW ?? json.displayW ?? 512;
        const ch = json.contentH ?? json.displayH ?? 512;
        const layer = new Layer(json.name, json.type, cw, ch);
        layer.id        = json.id;
        layer.visible   = json.visible   ?? true;
        layer.opacity   = json.opacity   ?? 1.0;
        layer.blendMode = json.blendMode ?? "source-over";
        layer.x        = json.x        ?? 0;
        layer.y        = json.y        ?? 0;
        layer.displayW = json.displayW ?? cw;
        layer.displayH = json.displayH ?? ch;
        layer.rotation  = json.rotation  ?? 0;
        layer.flipX     = json.flipX     ?? false;
        layer.flipY     = json.flipY     ?? false;
        layer.textProps  = json.textProps  ?? null;
        layer.locked     = json.locked     ?? false;
        layer.maskApply  = json.maskApply  ?? false;
        layer.operation  = json.operation  ?? "add";
        layer.adjType    = json.adjType    ?? null;
        layer.adjValue   = json.adjValue   ?? 0;

        if (json.imageData) {
            return new Promise(resolve => {
                const img = new Image();
                img.onload  = () => { layer.ctx.drawImage(img, 0, 0, cw, ch); resolve(layer); };
                img.onerror = () => resolve(layer);
                img.src = json.imageData;
            });
        }
        return Promise.resolve(layer);
    }

    /** 変換行列を ctx に適用してから drawImage できる状態にする */
    static applyTransform(ctx, layer) {
        const cx = layer.x + layer.displayW / 2;
        const cy = layer.y + layer.displayH / 2;
        ctx.translate(cx, cy);
        if (layer.rotation) ctx.rotate(layer.rotation * Math.PI / 180);
        ctx.scale(
            (layer.flipX ? -1 : 1) * (layer.displayW  / layer.canvas.width),
            (layer.flipY ? -1 : 1) * (layer.displayH / layer.canvas.height),
        );
    }
}

export class LayerManager {
    constructor(width, height) {
        this.width  = width;
        this.height = height;
        this.layers = [];  // 先頭 = 最前面
        this.activeIndex = 0;
        this._listeners  = [];
    }

    get activeLayer() { return this.layers[this.activeIndex] ?? null; }

    /**
     * @param {string} type  "draw" | "image" | "text"
     * @param {string} name
     * @param {object} opts  { contentW, contentH, displayW, displayH, x, y }
     */
    addLayer(type = "draw", name = null, opts = {}) {
        const n  = name ?? `Layer ${this.layers.length + 1}`;
        const cw = opts.contentW ?? this.width;
        const ch = opts.contentH ?? this.height;
        const layer = new Layer(n, type, cw, ch);
        layer.displayW = opts.displayW ?? cw;
        layer.displayH = opts.displayH ?? ch;
        layer.x        = opts.x ?? 0;
        layer.y        = opts.y ?? 0;
        if (opts.adjType)  layer.adjType  = opts.adjType;
        if (opts.adjValue !== undefined) layer.adjValue = opts.adjValue;
        this.layers.splice(this.activeIndex, 0, layer);
        this._emit("change");
        return layer;
    }

    /** 全レイヤーを削除し、指定のレイヤー1枚だけを残す（Flatten用） */
    replaceAllWith(layer) {
        this.layers = [layer];
        this.activeIndex = 0;
        this._emit("change");
    }

    /**
     * 指定したレイヤー群のみを1枚に統合し、元のレイヤー順序内で最前面だった位置に配置する
     * （選択されていない他のレイヤーの重なり順・内容には影響しない）
     * @param {string[]} ids
     * @returns {Layer|null} 統合結果のレイヤー（対象が2枚未満なら何もせずnull）
     */
    mergeLayers(ids) {
        const idSet = new Set(ids);
        const targets = this.layers.filter(l => idSet.has(l.id));
        if (targets.length < 2) return null;

        const insertIdx = Math.min(...targets.map(l => this.layers.indexOf(l)));

        const merged = new Layer("Merged", "image", this.width, this.height);
        const ctx = merged.ctx;
        // targets は layers 配列内の出現順（前面→背面）なので、背面→前面の順に描画する
        for (let i = targets.length - 1; i >= 0; i--) {
            const layer = targets[i];
            if (!layer.visible) continue;
            ctx.save();
            ctx.globalAlpha = layer.opacity;
            ctx.globalCompositeOperation = layer.blendMode;
            Layer.applyTransform(ctx, layer);
            ctx.drawImage(layer.canvas, -layer.canvas.width / 2, -layer.canvas.height / 2);
            ctx.restore();
        }

        this.layers = this.layers.filter(l => !idSet.has(l.id));
        this.layers.splice(insertIdx, 0, merged);
        this.activeIndex = insertIdx;
        this._emit("change");
        return merged;
    }

    deleteLayer(id) {
        if (this.layers.length <= 1) return;
        const idx = this.layers.findIndex(l => l.id === id);
        if (idx < 0) return;
        this.layers.splice(idx, 1);
        this.activeIndex = Math.max(0, Math.min(this.activeIndex, this.layers.length - 1));
        this._emit("change");
    }

    setActive(id) {
        const idx = this.layers.findIndex(l => l.id === id);
        if (idx >= 0) { this.activeIndex = idx; this._emit("activeChange", this.layers[idx]); }
    }

    moveUp(id) {
        const idx = this.layers.findIndex(l => l.id === id);
        if (idx <= 0) return;
        [this.layers[idx - 1], this.layers[idx]] = [this.layers[idx], this.layers[idx - 1]];
        if      (this.activeIndex === idx)     this.activeIndex = idx - 1;
        else if (this.activeIndex === idx - 1) this.activeIndex = idx;
        this._emit("change");
    }

    moveDown(id) {
        const idx = this.layers.findIndex(l => l.id === id);
        if (idx < 0 || idx >= this.layers.length - 1) return;
        [this.layers[idx], this.layers[idx + 1]] = [this.layers[idx + 1], this.layers[idx]];
        if      (this.activeIndex === idx)     this.activeIndex = idx + 1;
        else if (this.activeIndex === idx + 1) this.activeIndex = idx;
        this._emit("change");
    }

    toggleVisible(id) {
        const layer = this.layers.find(l => l.id === id);
        if (layer) { layer.visible = !layer.visible; this._emit("change"); }
    }

    toggleLocked(id) {
        const layer = this.layers.find(l => l.id === id);
        if (layer) { layer.locked = !layer.locked; this._emit("change"); }
    }

    toggleMaskApply(id) {
        const layer = this.layers.find(l => l.id === id);
        if (layer && layer.type === "mask") { layer.maskApply = !layer.maskApply; this._emit("change"); }
    }

    toggleOperation(id) {
        const layer = this.layers.find(l => l.id === id);
        if (layer && layer.type === "mask") {
            layer.operation = layer.operation === "add" ? "subtract" : "add";
            this._emit("change");
        }
    }

    /** レイヤーを複製して元の直上に挿入し、複製をアクティブにする（canvas内容・全プロパティをコピー、idは新規） */
    duplicateLayer(id) {
        const idx = this.layers.findIndex(l => l.id === id);
        if (idx < 0) return null;
        const src  = this.layers[idx];
        const copy = new Layer(`${src.name} copy`, src.type, src.canvas.width, src.canvas.height);
        copy.ctx.drawImage(src.canvas, 0, 0);
        copy.visible   = src.visible;
        copy.opacity   = src.opacity;
        copy.blendMode = src.blendMode;
        copy.x         = src.x;
        copy.y         = src.y;
        copy.displayW  = src.displayW;
        copy.displayH  = src.displayH;
        copy.rotation  = src.rotation;
        copy.flipX     = src.flipX;
        copy.flipY     = src.flipY;
        copy.textProps = src.textProps ? JSON.parse(JSON.stringify(src.textProps)) : null;
        copy.locked    = src.locked;
        copy.maskApply = src.maskApply;
        copy.operation = src.operation;
        copy.adjType   = src.adjType;
        copy.adjValue  = src.adjValue;
        this.layers.splice(idx, 0, copy); // 先頭=最前面のため、元のindexに挿入すると元の直上に来る
        this.activeIndex = idx;
        this._emit("change");
        return copy;
    }

    setOpacity(id, opacity) {
        const layer = this.layers.find(l => l.id === id);
        if (layer) { layer.opacity = Math.max(0, Math.min(1, opacity)); this._emit("change"); }
    }

    /** 全レイヤーを下→上の順で target canvas に変換付きで合成 */
    composite(target) {
        const ctx = target.getContext("2d");
        ctx.clearRect(0, 0, target.width, target.height);
        for (let i = this.layers.length - 1; i >= 0; i--) {
            const layer = this.layers[i];
            if (!layer.visible) continue;
            ctx.save();
            ctx.globalAlpha = layer.opacity;
            ctx.globalCompositeOperation = layer.blendMode;
            Layer.applyTransform(ctx, layer);
            ctx.drawImage(layer.canvas, -layer.canvas.width / 2, -layer.canvas.height / 2);
            ctx.restore();
        }
    }

    on(event, fn) { this._listeners.push({ event, fn }); }

    _emit(event, data) {
        for (const l of this._listeners) if (l.event === event) l.fn(data);
    }

    toJSON() {
        return { layers: this.layers.map(l => l.toJSON()), width: this.width, height: this.height };
    }

    async fromJSON(json) {
        this.layers = await Promise.all((json.layers || []).map(lj => Layer.fromJSON(lj)));
        this.activeIndex = 0;
        this._emit("change");
    }
}
