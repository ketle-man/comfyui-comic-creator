// ============================================================
//  PixiJS FX モーダル
//  comfyUI-particle-pixijs カスタムノードのエンジン
//  (particle_engine.js / filter_library.js) を再利用して、
//  画像にパーティクル・フィルタ効果を適用するモーダルを提供する。
//
//  UI はフィルタライブラリモーダル（filter_library.js）に統合されており、
//  3ペイン上部の topBar（3段）にパーティクル操作、中央ペインに
//  ライブプレビュー（PixiJSキャンバス＋発生点オーバーレイ）を表示する。
//
//  公開API: window.pixiFxOpen({ imageDataUrl, onApply })
//    imageDataUrl : 対象画像の data URL
//    onApply      : (resultDataUrl, meta) => void  適用時に呼ばれる
//                   meta = { bgVisible, width, height }
//
//  前提: ComfyUI に comfyUI-particle-pixijs がインストールされており、
//        /extensions/comfyUI-particle-pixijs/ 以下から JS が配信されること。
// ============================================================

(function () {
    'use strict';

    const EXT_BASE = '/extensions/comfyUI-particle-pixijs';
    const LS_KEY   = 'cccPixiFxSettings';

    // レンダラー最大辺: 原寸出力を優先し、GPU のテクスチャ上限までは縮小しない
    let _maxDimCache = null;
    function getMaxDim() {
        if (_maxDimCache) return _maxDimCache;
        let maxTex = 4096;
        try {
            const c = document.createElement('canvas');
            const gl = c.getContext('webgl2') || c.getContext('webgl');
            if (gl) {
                maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || maxTex;
                gl.getExtension('WEBGL_lose_context')?.loseContext();
            }
        } catch (_) {}
        _maxDimCache = Math.max(2048, maxTex);
        return _maxDimCache;
    }

    let _mods = null;   // { engine, filterLib } モジュールキャッシュ

    async function loadModules() {
        if (_mods) return _mods;
        let engine, filterLib;
        try {
            engine    = await import(`${EXT_BASE}/particle_engine.js`);
            filterLib = await import(`${EXT_BASE}/filter_library.js`);
        } catch (e) {
            console.error('[pixifx] module load failed:', e);
            throw new Error(
                'カスタムノード comfyUI-particle-pixijs の読み込みに失敗しました。\n' +
                'ComfyUI にインストールされているか、最新版か確認してください。');
        }
        await engine.loadPixiJS();
        await engine.loadPixiFilters();
        _mods = { engine, filterLib };
        return _mods;
    }

    // ---- 設定の保存/復元（テクスチャ画像は容量が大きいので保存しない） ----
    function loadSavedSettings() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (_) { return null; }
    }
    function saveSettings(obj) {
        try { localStorage.setItem(LS_KEY, JSON.stringify(obj)); } catch (_) {}
    }

    // ---- 小物UIヘルパー ----
    function el(tag, style, text) {
        const d = document.createElement(tag);
        if (style) d.style.cssText = style;
        if (text != null) d.textContent = text;
        return d;
    }
    function makeBtn(label, bg, title) {
        const b = document.createElement('button');
        b.textContent = label;
        if (title) b.title = title;
        b.style.cssText =
            `padding:4px 10px;background:${bg};color:#fff;border:none;` +
            'border-radius:4px;cursor:pointer;font-size:11px;font-weight:bold;' +
            'transition:opacity .15s;white-space:nowrap;';
        b.addEventListener('mouseover', () => { b.style.opacity = '0.8'; });
        b.addEventListener('mouseout',  () => { b.style.opacity = '1'; });
        return b;
    }
    function makeToggle(labelOn, labelOff, initial, onBg, offBg, onChange, title) {
        let state = initial;
        const b = makeBtn(state ? labelOn : labelOff, state ? onBg : offBg, title);
        b.addEventListener('click', () => {
            state = !state;
            b.textContent = state ? labelOn : labelOff;
            b.style.background = state ? onBg : offBg;
            onChange(state);
        });
        return b;
    }
    function ctlLabel(text) {
        return el('span', 'font-size:11px;color:#aaa;white-space:nowrap;', text);
    }

    // ============================================================
    //  モーダル本体（フィルタライブラリモーダルに統合）
    // ============================================================
    window.pixiFxOpen = async function ({ imageDataUrl, onApply }) {
        if (document.getElementById('filter-lib-modal')) return;
        if (!imageDataUrl || !imageDataUrl.startsWith('data:image/')) {
            alert('対象画像がありません。');
            return;
        }

        let engine, filterLib;
        try {
            ({ engine, filterLib } = await loadModules());
        } catch (e) {
            alert(e.message);
            return;
        }
        const PIXI = window.PIXI;

        // ---- 元画像を読み込んで出力サイズを決める ----
        const srcImg = new Image();
        try {
            await new Promise((res, rej) => { srcImg.onload = res; srcImg.onerror = rej; srcImg.src = imageDataUrl; });
        } catch (_) {
            alert('画像の読み込みに失敗しました。');
            return;
        }
        const natW = srcImg.naturalWidth, natH = srcImg.naturalHeight;
        // 原寸でレンダリングする（GPU のテクスチャ上限を超える場合のみ縮小）
        const dscale = Math.min(1, getMaxDim() / Math.max(natW, natH));
        const W = Math.max(8, Math.round(natW * dscale));
        const H = Math.max(8, Math.round(natH * dscale));

        // ============================================================
        //  状態（カスタムノードの properties 相当）
        // ============================================================
        const saved = loadSavedSettings() || {};
        const _defMotion = { turbulence: 0, turbFreq: 1, windX: 0, windY: 0, swirl: 0 };

        let particleType   = saved.particleType ?? 'spark';
        let particleCount  = saved.particleCount ?? 200;
        let currentSize    = saved.size ?? 5.0;
        let particleSpread = saved.spread ?? 1.0;
        let particleRotation       = saved.rotation ?? 0;
        let randomParticleRotation = saved.randomRotation ?? false;
        let randomParticleScale    = saved.randomScale ?? false;
        let particleShapePreset    = saved.shapePreset ?? 'default';
        let randomParticleShape    = saved.randomShape ?? false;
        let particleMotionParams   = { ..._defMotion, ...(saved.motionParams ?? {}) };
        let globalStrength         = saved.globalStrength ?? 1.0;
        let starStretch            = saved.starStretch ?? 2.0;
        let particleCharSet        = saved.charSet ?? [];
        let currentBlendMode       = saved.blendMode ?? 'default';
        let scatterMode            = saved.scatterMode ?? false;
        let filterEnabled          = saved.filterEnabled ?? true;
        let filterOnBg             = saved.filterOnBg ?? true;   // SPAでは画像加工が主目的なのでデフォルトON
        let bgVisible              = true;                        // 背景画像の表示（OFFでパーティクルのみ出力）
        let filterSettings         = saved.filterSettings
            ? JSON.parse(JSON.stringify(saved.filterSettings))
            : { type: 'none', params: {} };
        let colorStops = Array.isArray(saved.colorStops) && saved.colorStops.length
            ? JSON.parse(JSON.stringify(saved.colorStops))
            : [{ pos: 0.0, color: '#ffffff' }, { pos: 1.0, color: '#ffcc66' }];
        let selectedStopIdx = 0;
        let customParticleTextures = [];   // [{url, name, tex}] セッション内のみ（保存しない）

        // 発生点（scene座標: 中心原点・Y上向き）。保存値は画像サイズで正規化されている
        let emitters = Array.isArray(saved.emittersNorm) && saved.emittersNorm.length
            ? saved.emittersNorm.map(e => ({
                origin: { x: e.nx * W, y: e.ny * H },
                direction: e.direction,
                arrowLenPx: e.arrowLenPx,
              }))
            : [{ origin: { x: 0, y: 0 }, direction: Math.PI / 2, arrowLenPx: 80 }];
        let selectedEmitterIdx = 0;

        const ARROW_MIN = 20, ARROW_MAX = 200;
        const getStrength = em => 0.2 + (em.arrowLenPx - ARROW_MIN) / (ARROW_MAX - ARROW_MIN) * 2.8;
        const getSelEm = () => emitters[Math.min(selectedEmitterIdx, emitters.length - 1)];
        const gradientFn = t => engine.evalGradient(colorStops, t);

        // ============================================================
        //  PIXI 初期化
        // ============================================================
        const pixiCanvas = document.createElement('canvas');
        pixiCanvas.width = W; pixiCanvas.height = H;
        let pixiApp;
        try {
            pixiApp = new PIXI.Application({
                view: pixiCanvas, width: W, height: H,
                backgroundAlpha: 0, resolution: 1, autoStart: false, antialias: true,
            });
        } catch (e) {
            console.error('[pixifx] PIXI init failed:', e);
            alert('WebGL の初期化に失敗しました。');
            return;
        }

        // filterWrapper: Y反転なし → フィルターを適用しても座標系が崩れない
        const filterWrapper = new PIXI.Container();
        pixiApp.stage.addChild(filterWrapper);
        const scene = new PIXI.Container();
        scene.position.set(W / 2, H / 2);
        scene.scale.y = -1;                    // シーン座標系（上方向が正）
        filterWrapper.addChild(scene);
        const particleLayer = new PIXI.Container();
        scene.addChild(particleLayer);

        // 背景 = 対象画像
        let bgSprite = null;
        try {
            const tex = await PIXI.Texture.fromURL(imageDataUrl);
            bgSprite = new PIXI.Sprite(tex);
            bgSprite.width = W; bgSprite.height = H;
            bgSprite.anchor.set(0.5);
            bgSprite.position.set(W / 2, H / 2);
            filterWrapper.addChildAt(bgSprite, 0);
        } catch (e) {
            console.warn('[pixifx] bg texture load failed:', e);
        }

        let particleSystems = [];
        let animating = false, animFrameId = null, lastTime = 0;

        function applyFilter() {
            filterWrapper.filters = [];
            filterWrapper.filterArea = null;
            particleLayer.filters = [];
            if (bgSprite) bgSprite.filters = [];
            pixiApp.stage.filters = [];
            pixiApp.stage.filterArea = null;
            const f = filterSettings.type;
            if (!filterEnabled || f === 'none' || !PIXI.filters) return;

            const makeFilter = () => engine.makeFilterInstance(PIXI, f, filterSettings.params, { width: W, height: H });
            const SCENE_WIDE = engine.SCENE_WIDE_FILTERS.has(f);
            try {
                if (particleType === 'none' || SCENE_WIDE) {
                    const fil = makeFilter();
                    if (!fil) return;
                    pixiApp.stage.filters = [fil];
                    const pad = fil.padding ?? 0;
                    pixiApp.stage.filterArea = new PIXI.Rectangle(-pad, -pad, W + pad * 2, H + pad * 2);
                } else {
                    const fil = makeFilter();
                    if (!fil) return;
                    particleLayer.filters = [fil];
                    if (filterOnBg && bgSprite && bgVisible) {
                        const filBg = makeFilter();
                        if (filBg) bgSprite.filters = [filBg];
                    }
                }
            } catch (e) {
                console.warn('[pixifx] applyFilter failed:', e);
            }
        }

        function applyBlendMode() {
            if (currentBlendMode === 'default' || particleSystems.length === 0) return;
            const bm = PIXI.BLEND_MODES[currentBlendMode] ?? PIXI.BLEND_MODES.NORMAL;
            for (const ps of particleSystems) {
                for (const sprite of ps.particles) sprite.blendMode = bm;
            }
        }

        function getLoadedTextures() {
            return customParticleTextures.map(t => t.tex).filter(t => t && !t.destroyed);
        }
        async function loadCustomTextures() {
            for (const item of customParticleTextures) {
                if (item.tex && !item.tex.destroyed) continue;
                if (!item.url || !item.url.startsWith('data:image/')) { item.tex = null; continue; }
                try { item.tex = await PIXI.Texture.fromURL(item.url); }
                catch (_) { item.tex = null; }
            }
        }

        function rebuildParticles(overrides = null) {
            for (const ps of particleSystems) ps.dispose();
            particleSystems = [];
            const countPerEm = particleType === 'none'
                ? 0 : Math.max(10, Math.floor(particleCount / emitters.length));

            let _texsArr;
            if (overrides && overrides.textures !== undefined) {
                const matched = (overrides.textures ?? [])
                    .map(ot => ot.tex ?? customParticleTextures.find(ct => ct.url === ot.url)?.tex)
                    .filter(t => t && !t.destroyed);
                _texsArr = matched.length > 0 ? matched : null;
            } else {
                const loaded = getLoadedTextures();
                _texsArr = loaded.length > 0 ? loaded : null;
            }
            const _size    = overrides?.size           ?? currentSize;
            const _rot     = overrides?.rotation       ?? particleRotation;
            const _randRot = overrides?.randomRotation ?? randomParticleRotation;
            const _randSc  = overrides?.randomScale    ?? randomParticleScale;
            const _shape   = overrides?.shapePreset    ?? particleShapePreset;
            const _randSh  = overrides?.randomShape    ?? randomParticleShape;
            const _motion  = overrides?.motionParams
                ? { ..._defMotion, ...overrides.motionParams } : particleMotionParams;
            const _spread  = overrides?.spread         ?? particleSpread;
            const _gs      = overrides?.globalStrength ?? globalStrength;
            const _stretch = overrides?.starStretch    ?? starStretch;

            for (const em of emitters) {
                particleSystems.push(engine.createParticleSystem(
                    particleType, particleLayer, PIXI, pixiApp.renderer, countPerEm, gradientFn,
                    em.origin, em.direction, _size, getStrength(em) * _gs,
                    _texsArr, _rot, _randRot, _randSc, _shape, _randSh, _motion,
                    _spread, scatterMode, particleCharSet, _stretch
                ));
            }
            applyFilter();
            applyBlendMode();
        }

        function renderOnce() { pixiApp.render(); }

        function animate(time) {
            if (!animating) return;
            animFrameId = requestAnimationFrame(animate);
            if (!time) time = performance.now();
            const delta = lastTime === 0 ? 0.016 : (time - lastTime) / 1000.0;
            lastTime = time;
            const dt = Math.min(delta, 0.1);
            for (const ps of particleSystems) ps.update(dt);
            pixiApp.render();
        }
        function startAnim() {
            if (animating) return;
            animating = true; lastTime = 0;
            requestAnimationFrame(animate);
        }
        function stopAnim() {
            animating = false;
            if (animFrameId) cancelAnimationFrame(animFrameId);
        }

        // ============================================================
        //  中央ペイン: ライブプレビュー（pixiキャンバス＋発生点オーバーレイ）
        // ============================================================
        const canvasWrap = el('div', 'position:relative;line-height:0;');
        pixiCanvas.style.cssText =
            'display:block;max-width:100%;max-height:100%;' +
            'border-radius:6px;box-shadow:0 2px 16px rgba(0,0,0,0.7);' +
            'background:' +
            'repeating-conic-gradient(#2e2e2e 0% 25%, #232323 0% 50%) 0 0/16px 16px;';
        const uiCanvas = document.createElement('canvas');
        uiCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;cursor:crosshair;';
        canvasWrap.appendChild(pixiCanvas);
        canvasWrap.appendChild(uiCanvas);

        // プレビュー表示サイズを中央ペインに収める（縦横比維持）
        function fitCanvas() {
            const parent = canvasWrap.parentElement;
            if (!parent) return;
            const availW = parent.clientWidth  - 36;
            const availH = parent.clientHeight - 36;
            if (availW <= 0 || availH <= 0) return;
            const s = Math.min(availW / W, availH / H, 1.5);
            pixiCanvas.style.width  = Math.max(64, Math.round(W * s)) + 'px';
            pixiCanvas.style.height = Math.max(64, Math.round(H * s)) + 'px';
            syncUiCanvas();
            drawUiOverlay();
        }

        // ============================================================
        //  topBar: パーティクル操作（3段）
        // ============================================================
        const topBar = el('div',
            'display:flex;flex-direction:column;gap:6px;padding:8px 14px;' +
            'background:#1a1a28;border-bottom:1px solid #2a2a4a;flex-shrink:0;');
        const mkRow = () => {
            const r = el('div', 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;');
            topBar.appendChild(r);
            return r;
        };

        // ---- 1段目: タイプ / 数 / サイズ / 再生 / 散布 / ブレンド ----
        const row1 = mkRow();

        row1.appendChild(ctlLabel('パーティクル:'));
        const typeSelect = document.createElement('select');
        typeSelect.style.cssText = 'background:#2a2a3a;color:#ccc;border:1px solid #555;border-radius:4px;font-size:12px;padding:3px;';
        for (const [val, label] of [
            ['none', 'なし（フィルタのみ）'], ['smoke', '煙'], ['spark', '火花'],
            ['ray', '光線'], ['star_warp', 'スターワープ'],
        ]) {
            const o = document.createElement('option');
            o.value = val; o.textContent = label;
            if (val === particleType) o.selected = true;
            typeSelect.appendChild(o);
        }
        typeSelect.addEventListener('change', () => {
            particleType = typeSelect.value;
            rebuildParticles();
            if (!animating) renderOnce();
            drawUiOverlay();
        });
        row1.appendChild(typeSelect);

        const countLabel = ctlLabel(`数: ${particleCount}`);
        countLabel.style.minWidth = '64px';
        const countRange = document.createElement('input');
        countRange.id = 'pixifx-count-range';
        countRange.type = 'range'; countRange.min = '10'; countRange.max = '2000'; countRange.step = '10';
        countRange.value = String(particleCount);
        countRange.style.cssText = 'width:130px;';
        countRange.addEventListener('input', () => {
            particleCount = parseInt(countRange.value, 10);
            countLabel.textContent = `数: ${particleCount}`;
            rebuildParticles();
            if (!animating) renderOnce();
        });
        row1.appendChild(countLabel);
        row1.appendChild(countRange);

        const sizeLabel = ctlLabel(`サイズ: ${currentSize.toFixed(1)}`);
        sizeLabel.style.minWidth = '76px';
        const sizeRange = document.createElement('input');
        sizeRange.id = 'pixifx-size-range';
        sizeRange.type = 'range'; sizeRange.min = '1'; sizeRange.max = '20'; sizeRange.step = '0.1';
        sizeRange.value = String(currentSize);
        sizeRange.style.cssText = 'width:130px;';
        sizeRange.addEventListener('input', () => {
            currentSize = parseFloat(sizeRange.value);
            sizeLabel.textContent = `サイズ: ${currentSize.toFixed(1)}`;
            rebuildParticles();
            if (!animating) renderOnce();
        });
        row1.appendChild(sizeLabel);
        row1.appendChild(sizeRange);

        const playBtn = makeToggle('⏸ 一時停止', '▶ 再生', false, '#7a5a2a', '#3a7a3a', (on) => {
            if (on) startAnim(); else { stopAnim(); for (const ps of particleSystems) ps.update(0); renderOnce(); }
        }, 'パーティクルアニメーションの再生/一時停止');
        const scatterBtn = makeToggle('✦ 全面散布: ON', '✦ 全面散布: OFF', scatterMode, '#8a4a8a', '#333344', (on) => {
            scatterMode = on;
            rebuildParticles();
            if (!animating) renderOnce();
        }, 'キャンバス全体にランダムにパーティクルを発生させます');
        row1.appendChild(playBtn);
        row1.appendChild(scatterBtn);

        row1.appendChild(ctlLabel('ブレンド:'));
        const blendSelect = document.createElement('select');
        blendSelect.style.cssText = 'background:#2a2a3a;color:#ccc;border:1px solid #555;border-radius:4px;font-size:12px;padding:3px;';
        for (const [val, label] of [
            ['default', 'Default'], ['NORMAL', 'Normal'], ['ADD', 'Add'],
            ['MULTIPLY', 'Multiply'], ['SCREEN', 'Screen'],
        ]) {
            const o = document.createElement('option');
            o.value = val; o.textContent = label;
            if (val === currentBlendMode) o.selected = true;
            blendSelect.appendChild(o);
        }
        blendSelect.addEventListener('change', () => {
            currentBlendMode = blendSelect.value;
            if (currentBlendMode === 'default') rebuildParticles();
            else applyBlendMode();
            if (!animating) renderOnce();
        });
        row1.appendChild(blendSelect);

        // ---- 2段目: カラーランプ / 発生点 ----
        const row2 = mkRow();

        row2.appendChild(ctlLabel('カラーランプ:'));
        const rampWrap = el('div', 'display:flex;flex-direction:column;gap:2px;width:300px;flex-shrink:0;');
        const gradBar = el('div',
            'width:100%;height:16px;border:1px solid #555;border-radius:3px;cursor:pointer;');
        const handleRow = el('div', 'position:relative;height:14px;');
        rampWrap.appendChild(gradBar);
        rampWrap.appendChild(handleRow);
        row2.appendChild(rampWrap);

        const stopColorInput = document.createElement('input');
        stopColorInput.type = 'color';
        stopColorInput.title = '選択中ストップの色';
        stopColorInput.style.cssText = 'width:30px;height:24px;border:none;background:none;padding:0;cursor:pointer;flex-shrink:0;';
        const addStopBtn = makeBtn('＋', '#2a4a2a', 'ストップを追加');
        const delStopBtn = makeBtn('−', '#4a2a2a', '選択中のストップを削除');
        row2.appendChild(stopColorInput);
        row2.appendChild(addStopBtn);
        row2.appendChild(delStopBtn);

        const emSep = el('span', 'width:1px;height:20px;background:#2a2a4a;flex-shrink:0;');
        row2.appendChild(emSep);
        row2.appendChild(ctlLabel('発生点（プレビューをクリックで追加・ドラッグで移動）:'));
        const emDelBtn   = makeBtn('削除', '#4a2a2a', '選択中の発生点を削除（1個のみの場合は中央にリセット）');
        const emResetBtn = makeBtn('リセット', '#2a3a4a', 'すべての発生点を削除し、発生点1を中央に配置');
        const emStatus   = el('span', 'font-size:11px;color:#888;', '');
        row2.appendChild(emDelBtn);
        row2.appendChild(emResetBtn);
        row2.appendChild(emStatus);

        function refreshGradientUI() {
            const sorted = [...colorStops].sort((a, b) => a.pos - b.pos);
            const stopsCss = sorted.map(s => `${s.color} ${Math.round(s.pos * 100)}%`).join(',');
            gradBar.style.background = sorted.length === 1
                ? sorted[0].color
                : `linear-gradient(to right, ${stopsCss})`;
            // ハンドル再構築
            handleRow.innerHTML = '';
            colorStops.forEach((s, i) => {
                const h = el('div',
                    'position:absolute;top:0;width:12px;height:12px;margin-left:-6px;' +
                    `background:${s.color};border:2px solid ${i === selectedStopIdx ? '#ffdd00' : '#888'};` +
                    'border-radius:2px;cursor:ew-resize;box-sizing:border-box;');
                h.style.left = `${s.pos * 100}%`;
                h.addEventListener('pointerdown', (ev) => {
                    ev.preventDefault();
                    selectedStopIdx = i;
                    stopColorInput.value = s.color;
                    refreshGradientUI();
                    const rect = handleRow.getBoundingClientRect();
                    const move = (mv) => {
                        s.pos = Math.max(0, Math.min(1, (mv.clientX - rect.left) / rect.width));
                        refreshGradientUI();
                        if (animating) rebuildParticles();
                    };
                    const up = () => {
                        window.removeEventListener('pointermove', move);
                        window.removeEventListener('pointerup', up);
                        if (!animating) { rebuildParticles(); renderOnce(); }
                    };
                    window.addEventListener('pointermove', move);
                    window.addEventListener('pointerup', up);
                });
                handleRow.appendChild(h);
            });
            const cur = colorStops[selectedStopIdx];
            if (cur) stopColorInput.value = cur.color;
        }
        stopColorInput.addEventListener('input', () => {
            if (colorStops[selectedStopIdx]) {
                colorStops[selectedStopIdx].color = stopColorInput.value;
                refreshGradientUI();
                rebuildParticles();
                if (!animating) renderOnce();
            }
        });
        addStopBtn.addEventListener('click', () => {
            const s = [...colorStops].sort((a, b) => a.pos - b.pos);
            let newPos = 0.5;
            if (s.length >= 2) {
                let maxGap = -1, gi = 0;
                for (let i = 0; i < s.length - 1; i++) {
                    const gap = s[i + 1].pos - s[i].pos;
                    if (gap > maxGap) { maxGap = gap; gi = i; }
                }
                newPos = (s[gi].pos + s[gi + 1].pos) / 2;
            }
            const c = engine.evalGradient(colorStops, newPos);
            colorStops.push({ pos: newPos, color: engine.rgb01ToHex(c) });
            selectedStopIdx = colorStops.length - 1;
            refreshGradientUI();
            rebuildParticles();
            if (!animating) renderOnce();
        });
        delStopBtn.addEventListener('click', () => {
            if (colorStops.length <= 1) return;
            colorStops.splice(selectedStopIdx, 1);
            selectedStopIdx = Math.max(0, Math.min(selectedStopIdx, colorStops.length - 1));
            refreshGradientUI();
            rebuildParticles();
            if (!animating) renderOnce();
        });

        function refreshEmitterStatus() {
            emStatus.textContent = `${emitters.length}個（選択: ${selectedEmitterIdx + 1}）`;
        }
        emDelBtn.addEventListener('click', () => {
            if (emitters.length > 1) {
                emitters.splice(selectedEmitterIdx, 1);
                selectedEmitterIdx = Math.max(0, Math.min(selectedEmitterIdx, emitters.length - 1));
            } else {
                emitters[0].origin = { x: 0, y: 0 };
                selectedEmitterIdx = 0;
            }
            rebuildParticles();
            if (!animating) renderOnce();
            refreshEmitterStatus();
            drawUiOverlay();
        });
        emResetBtn.addEventListener('click', () => {
            emitters = [{ origin: { x: 0, y: 0 }, direction: Math.PI / 2, arrowLenPx: 80 }];
            selectedEmitterIdx = 0;
            rebuildParticles();
            if (!animating) renderOnce();
            refreshEmitterStatus();
            drawUiOverlay();
        });

        // ---- 3段目: フィルタ適用トグル / 背景画像 / 出力サイズ ----
        const row3 = mkRow();

        const filterToggleBtn = makeToggle('フィルタ: ON', 'フィルタ: OFF', filterEnabled, '#4a6a8a', '#333344', (on) => {
            filterEnabled = on;
            applyFilter();
            if (!animating) renderOnce();
        }, '選択中フィルタの適用ON/OFF');
        const filterOnBgBtn = makeToggle('🖼 画像にも適用: ON', '🖼 画像にも適用: OFF', filterOnBg, '#4a4a8a', '#333344', (on) => {
            filterOnBg = on;
            applyFilter();
            if (!animating) renderOnce();
        }, 'ONで背景画像にもフィルタを適用します（OFFはパーティクルのみ）');
        const bgToggleBtn = makeToggle('背景画像: 表示', '背景画像: 非表示（透過出力）', bgVisible, '#4a6a3a', '#333344', (on) => {
            bgVisible = on;
            if (bgSprite) bgSprite.visible = on;
            applyFilter();
            if (!animating) renderOnce();
        }, 'OFFにするとパーティクルのみを透過PNGとして出力できます（レイアウトでは挿入になります）');
        row3.appendChild(filterToggleBtn);
        row3.appendChild(filterOnBgBtn);
        row3.appendChild(bgToggleBtn);

        const sizeInfo = el('span', 'font-size:11px;color:#888;margin-left:auto;',
            dscale < 1 ? `出力: ${W}×${H}px（元 ${natW}×${natH} を縮小）` : `出力: ${W}×${H}px`);
        row3.appendChild(sizeInfo);

        // ============================================================
        //  発生点オーバーレイ描画 & マウス操作
        // ============================================================
        function syncUiCanvas() {
            const r = pixiCanvas.getBoundingClientRect();
            const w = Math.max(1, Math.round(r.width));
            const h = Math.max(1, Math.round(r.height));
            if (uiCanvas.width !== w)  uiCanvas.width  = w;
            if (uiCanvas.height !== h) uiCanvas.height = h;
        }
        const sceneToDisp = (sx, sy) => ({
            x: (sx / W + 0.5) * uiCanvas.width,
            y: (0.5 - sy / H) * uiCanvas.height,
        });
        const dispToScene = (px, py) => ({
            x: (px / uiCanvas.width - 0.5) * W,
            y: (0.5 - py / uiCanvas.height) * H,
        });

        function drawUiOverlay() {
            const ctx = uiCanvas.getContext('2d');
            ctx.clearRect(0, 0, uiCanvas.width, uiCanvas.height);
            if (particleType === 'none') return;

            for (let i = 0; i < emitters.length; i++) {
                const em = emitters[i];
                const p = sceneToDisp(em.origin.x, em.origin.y);
                const sel = i === selectedEmitterIdx;
                const cr = 10;
                ctx.strokeStyle = sel ? 'rgba(100,200,255,1)' : 'rgba(100,200,255,0.4)';
                ctx.lineWidth = sel ? 2 : 1;
                ctx.beginPath();
                ctx.moveTo(p.x - cr, p.y); ctx.lineTo(p.x + cr, p.y);
                ctx.moveTo(p.x, p.y - cr); ctx.lineTo(p.x, p.y + cr);
                ctx.stroke();
                ctx.strokeStyle = sel ? 'rgba(100,200,255,0.7)' : 'rgba(100,200,255,0.3)';
                ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.stroke();
                ctx.fillStyle = sel ? 'rgba(100,200,255,1)' : 'rgba(100,200,255,0.5)';
                ctx.font = sel ? 'bold 10px sans-serif' : '10px sans-serif';
                ctx.textBaseline = 'bottom';
                ctx.fillText(String(i + 1), p.x + 8, p.y);
            }

            // 選択中エミッターの方向矢印
            const em = getSelEm();
            const origin = sceneToDisp(em.origin.x, em.origin.y);
            const dir = {
                x: origin.x + Math.cos(em.direction) * em.arrowLenPx,
                y: origin.y - Math.sin(em.direction) * em.arrowLenPx,
            };
            ctx.strokeStyle = 'rgba(255,220,50,0.85)';
            ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
            ctx.beginPath(); ctx.moveTo(origin.x, origin.y); ctx.lineTo(dir.x, dir.y); ctx.stroke();
            ctx.setLineDash([]);
            const ang = Math.atan2(dir.y - origin.y, dir.x - origin.x);
            ctx.beginPath();
            ctx.moveTo(dir.x, dir.y);
            ctx.lineTo(dir.x - 10 * Math.cos(ang - .45), dir.y - 10 * Math.sin(ang - .45));
            ctx.moveTo(dir.x, dir.y);
            ctx.lineTo(dir.x - 10 * Math.cos(ang + .45), dir.y - 10 * Math.sin(ang + .45));
            ctx.stroke();
            ctx.fillStyle = 'rgba(255,220,50,0.9)';
            ctx.beginPath(); ctx.arc(dir.x, dir.y, 6, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = 'rgba(255,220,50,0.85)';
            ctx.font = '10px sans-serif'; ctx.textBaseline = 'bottom';
            ctx.fillText(`強さ: ${getStrength(em).toFixed(1)}`, dir.x + 9, dir.y);
        }

        let dragMode = null;
        function uiPos(ev) {
            const r = uiCanvas.getBoundingClientRect();
            return { x: ev.clientX - r.left, y: ev.clientY - r.top };
        }
        uiCanvas.addEventListener('pointerdown', (ev) => {
            if (ev.button !== 0 || particleType === 'none') return;
            ev.preventDefault();
            uiCanvas.setPointerCapture(ev.pointerId);
            const { x: mx, y: my } = uiPos(ev);

            // 方向ハンドル
            const em = getSelEm();
            const origin = sceneToDisp(em.origin.x, em.origin.y);
            const dir = {
                x: origin.x + Math.cos(em.direction) * em.arrowLenPx,
                y: origin.y - Math.sin(em.direction) * em.arrowLenPx,
            };
            if (Math.hypot(mx - dir.x, my - dir.y) < 14) { dragMode = 'direction'; return; }

            // 既存エミッター
            for (let i = 0; i < emitters.length; i++) {
                const p = sceneToDisp(emitters[i].origin.x, emitters[i].origin.y);
                if (Math.hypot(mx - p.x, my - p.y) < 14) {
                    selectedEmitterIdx = i;
                    dragMode = 'emitter_origin';
                    refreshEmitterStatus();
                    drawUiOverlay();
                    return;
                }
            }

            // 空きクリック → 追加
            emitters.push({
                origin: dispToScene(mx, my),
                direction: getSelEm().direction,
                arrowLenPx: getSelEm().arrowLenPx,
            });
            selectedEmitterIdx = emitters.length - 1;
            dragMode = 'emitter_origin';
            rebuildParticles();
            if (!animating) renderOnce();
            refreshEmitterStatus();
            drawUiOverlay();
        });
        uiCanvas.addEventListener('pointermove', (ev) => {
            if (!dragMode) return;
            const { x: mx, y: my } = uiPos(ev);
            const cx = Math.max(0, Math.min(uiCanvas.width, mx));
            const cy = Math.max(0, Math.min(uiCanvas.height, my));
            if (dragMode === 'emitter_origin') {
                emitters[selectedEmitterIdx].origin = dispToScene(cx, cy);
                if (animating) rebuildParticles();
            } else if (dragMode === 'direction') {
                const em2 = getSelEm();
                const o = sceneToDisp(em2.origin.x, em2.origin.y);
                const dx = mx - o.x, dy = o.y - my, dist = Math.hypot(dx, dy);
                if (dist > 2) {
                    em2.direction = Math.atan2(dy, dx);
                    em2.arrowLenPx = Math.max(ARROW_MIN, Math.min(ARROW_MAX, dist));
                    if (animating) rebuildParticles();
                }
            }
            drawUiOverlay();
        });
        const endDrag = () => {
            if (!dragMode) return;
            dragMode = null;
            if (!animating) { rebuildParticles(); renderOnce(); }
        };
        uiCanvas.addEventListener('pointerup', endDrag);
        uiCanvas.addEventListener('pointercancel', endDrag);

        // ============================================================
        //  設定の収集・終了処理
        // ============================================================
        function collectSettings() {
            return {
                particleType, particleCount,
                size: currentSize, spread: particleSpread,
                rotation: particleRotation,
                randomRotation: randomParticleRotation,
                randomScale: randomParticleScale,
                shapePreset: particleShapePreset,
                randomShape: randomParticleShape,
                motionParams: { ...particleMotionParams },
                globalStrength, starStretch,
                charSet: [...particleCharSet],
                colorStops: JSON.parse(JSON.stringify(colorStops)),
                blendMode: currentBlendMode,
                scatterMode, filterEnabled, filterOnBg,
                filterSettings: JSON.parse(JSON.stringify(filterSettings)),
                emittersNorm: emitters.map(e => ({
                    nx: e.origin.x / W, ny: e.origin.y / H,
                    direction: e.direction, arrowLenPx: e.arrowLenPx,
                })),
            };
        }

        let resizeObs = null;
        let torndown = false;
        function teardown() {
            if (torndown) return;
            torndown = true;
            stopAnim();
            resizeObs?.disconnect();
            for (const ps of particleSystems) ps.dispose();
            particleSystems = [];
            try { pixiApp.destroy(true, { children: true }); } catch (_) {}
        }

        let pendingDataUrl = null;

        // ============================================================
        //  統合モーダル起動（filter_library.js のモーダルに topBar / ライブプレビューを載せる）
        // ============================================================
        filterLib.openFilterLibrary({
            mainCanvas: pixiCanvas,
            filterSettings,
            particleSettings: {
                textures:       customParticleTextures.map(t => ({ url: t.url, name: t.name })),
                size:           currentSize,
                spread:         particleSpread,
                rotation:       particleRotation,
                randomRotation: randomParticleRotation,
                randomScale:    randomParticleScale,
                shapePreset:    particleShapePreset,
                randomShape:    randomParticleShape,
                motionParams:   { ...particleMotionParams },
                globalStrength: globalStrength,
                starStretch:    starStretch,
                charSet:        [...particleCharSet],
            },
            topBar,
            previewElement: canvasWrap,
            saveLabel: '✓ 適用して反映',
            onPreview: settings => {
                filterSettings.type   = settings.type;
                filterSettings.params = settings.params;
                applyFilter();
                if (!animating) renderOnce();
            },
            onParticlePreview: async (snap) => {
                // null はキャンセル時の復元通知（統合モーダルではモーダルごと閉じるため不要）
                if (!snap) return;
                if (snap.textures?.length) {
                    await Promise.all(snap.textures.map(async item => {
                        const found = customParticleTextures.find(ct => ct.url === item.url);
                        if (found?.tex && !found.tex.destroyed) { item.tex = found.tex; return; }
                        if (item.url?.startsWith('data:image/')) {
                            try { item.tex = await PIXI.Texture.fromURL(item.url); } catch (_) {}
                        }
                    }));
                }
                if (torndown) return;
                // 統合モーダルでは topBar のスライダー操作等も rebuildParticles() を呼ぶため、
                // プレビュー値をその場で正本に反映しておく（さもないと topBar 操作で
                // シェイプ等の未確定変更が巻き戻る）
                if (snap.textures !== undefined) {
                    customParticleTextures = (snap.textures ?? []).map(t => ({
                        url: t.url, name: t.name,
                        tex: t.tex ?? customParticleTextures.find(ct => ct.url === t.url)?.tex ?? null,
                    }));
                }
                currentSize            = snap.size           ?? currentSize;
                particleSpread         = snap.spread         ?? particleSpread;
                particleRotation       = snap.rotation       ?? particleRotation;
                randomParticleRotation = snap.randomRotation ?? randomParticleRotation;
                randomParticleScale    = snap.randomScale    ?? randomParticleScale;
                particleShapePreset    = snap.shapePreset    ?? particleShapePreset;
                randomParticleShape    = snap.randomShape    ?? randomParticleShape;
                particleMotionParams   = snap.motionParams
                    ? { ..._defMotion, ...snap.motionParams } : particleMotionParams;
                globalStrength         = snap.globalStrength ?? globalStrength;
                starStretch            = snap.starStretch    ?? starStretch;
                particleCharSet        = snap.charSet        ?? particleCharSet;
                // topBar のサイズスライダーへ同期（詳細設定側の Size 変更を反映）
                sizeRange.value = String(currentSize);
                sizeLabel.textContent = `サイズ: ${currentSize.toFixed(1)}`;
                rebuildParticles();
                if (!animating) renderOnce();
            },
            onSave: (filterSets, particleSets) => {
                // 設定を確定（プレビューは既にライブ反映済み）
                filterSettings.type   = filterSets.type;
                filterSettings.params = filterSets.params;
                customParticleTextures = (particleSets.textures ?? []).map(t => {
                    const existing = customParticleTextures.find(ct => ct.url === t.url);
                    return { url: t.url, name: t.name, tex: existing?.tex ?? null };
                });
                currentSize            = particleSets.size           ?? currentSize;
                particleSpread         = particleSets.spread         ?? 1.0;
                particleRotation       = particleSets.rotation       ?? 0;
                randomParticleRotation = particleSets.randomRotation ?? false;
                randomParticleScale    = particleSets.randomScale    ?? false;
                particleShapePreset    = particleSets.shapePreset    ?? 'default';
                randomParticleShape    = particleSets.randomShape    ?? false;
                particleMotionParams   = { ..._defMotion, ...(particleSets.motionParams ?? {}) };
                globalStrength         = particleSets.globalStrength ?? 1.0;
                starStretch            = particleSets.starStretch    ?? 2.0;
                particleCharSet        = particleSets.charSet        ?? [];

                // 現在の表示フレームをキャプチャ（onClose(true) で onApply に渡す）
                stopAnim();
                for (const ps of particleSystems) ps.update(0);
                try {
                    pixiApp.render();
                    pendingDataUrl = pixiCanvas.toDataURL('image/png');
                } catch (e) {
                    pendingDataUrl = null;
                    alert('キャプチャに失敗しました: ' + e.message);
                }
                saveSettings(collectSettings());
            },
            onClose: (saved) => {
                teardown();
                if (saved && pendingDataUrl) {
                    try { onApply?.(pendingDataUrl, { bgVisible, width: W, height: H }); }
                    catch (e) {
                        console.error('[pixifx] onApply failed:', e);
                        alert('結果の反映に失敗しました: ' + e.message);
                    }
                }
            },
        });

        // ============================================================
        //  起動（モーダルDOM挿入後にプレビューをフィット＆自動再生）
        // ============================================================
        refreshGradientUI();
        refreshEmitterStatus();
        rebuildParticles();
        renderOnce();
        const centerPanel = canvasWrap.parentElement;
        if (centerPanel) {
            resizeObs = new ResizeObserver(() => { fitCanvas(); });
            resizeObs.observe(centerPanel);
        }
        requestAnimationFrame(() => { fitCanvas(); });
        // 自動再生でプレビュー開始
        playBtn.click();
    };
})();
