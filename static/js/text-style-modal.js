// ============================================================
//  テキストスタイル モーダル
//  フォントタブ「スタイル」プレビュータブ（塗り・線・袋文字・影の設定）と
//  同じ内容を、レイアウトタブ／Imageタブのテキストツールから
//  モーダルダイアログとして呼び出せるようにする。
//
//  保存データは main.js 側フォントタブの「スタイル」と同じ
//  localStorage キー（fontmgr_text_styles）を共有する。
//
//  公開API: window.openTextStyleModal({ fontFamily, previewText, onApply })
//    fontFamily  : プレビューに使うフォント名（省略時 'Zen Antique'）
//    previewText : プレビュー初期文字列（省略時 'あ亜Aa1'）
//    onApply     : (styleObj) => void  適用ボタン押下時に呼ばれる
// ============================================================

(function () {
    'use strict';

    const LS_STYLES = 'fontmgr_text_styles';

    function loadStyles() {
        try {
            const list = JSON.parse(localStorage.getItem(LS_STYLES) || '[]');
            // v2以降のみ読み込む（v2からスタイル値はフォントサイズ100pxあたりのpxの相対値。
            // 単位系が異なる旧データは破棄する。19-font-manager.jsの_fontMgrLoadStylesと同じ方針）
            return Array.isArray(list) ? list.filter(s => s && s.v === 2) : [];
        } catch { return []; }
    }
    function saveStyles(list) {
        localStorage.setItem(LS_STYLES, JSON.stringify(list));
    }

    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    window.openTextStyleModal = function openTextStyleModal(opts = {}) {
        const fontFamily = opts.fontFamily || 'Zen Antique';
        const previewText = opts.previewText || 'あ亜Aa1';
        const initialStyle = opts.initialStyle || null;
        const previewSize = opts.previewSize;
        const onApply = typeof opts.onApply === 'function' ? opts.onApply : () => {};

        let styleList = loadStyles();
        let editingId = null;

        const overlay = document.createElement('div');
        overlay.className = 'tsm-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'tsm-dialog';
        dialog.innerHTML = `
            <div class="tsm-header">
                <h3>${t('image.textStyleModalTitle')}</h3>
                <button type="button" id="tsm-close-btn" class="tsm-close-btn" title="${t('common.close')}">×</button>
            </div>
            <div class="fontmgr-style-layout tsm-body">
                <div class="fontmgr-style-controls">
                    <div class="fontmgr-style-group">
                        <label>${t('font.stylePreviewText')} <input type="text" id="tsm-preview-input" value="${esc(previewText)}" style="width:100px;" /></label>
                    </div>
                    <div class="fontmgr-style-group">
                        <label>${t('layout.sizeLabel')} <input type="number" id="tsm-preview-size" min="16" max="2000" value="120" style="width:60px;" /></label>
                    </div>

                    <div class="fontmgr-style-group">
                        <label><input type="checkbox" id="tsm-fill-enable" checked /> ${t('font.fillLabel')}</label>
                        <select id="tsm-fill-mode">
                            <option value="solid">${t('font.fillModeSolid')}</option>
                            <option value="gradient">${t('font.fillModeGradient')}</option>
                            <option value="texture">${t('font.fillModeTexture')}</option>
                        </select>
                        <input type="color" id="tsm-fill-color" value="#000000" />
                        <label style="margin-left:8px;"><input type="checkbox" id="tsm-stroke-enable" /> ${t('font.strokeLabel')}</label>
                        <input type="color" id="tsm-stroke-color" value="#ffffff" />
                        <input type="number" id="tsm-stroke-width" min="0.5" max="50" step="0.5" value="4" style="width:50px;" />
                    </div>

                    <div class="fontmgr-style-group" id="tsm-fill-gradient-panel" style="display:none; flex-wrap:wrap; gap:6px;">
                        <select id="tsm-grad-shape">
                            <option value="linear">${t('font.gradShapeLinear')}</option>
                            <option value="radial">${t('font.gradShapeRadial')}</option>
                        </select>
                        <label>${t('font.gradAngle')}<input type="number" id="tsm-grad-angle" value="0" step="15" style="width:55px;" />°</label>
                        <canvas id="tsm-grad-ramp" width="150" height="26" style="display:block;width:150px;height:26px;border:1px solid #666;border-radius:3px;cursor:pointer;"></canvas>
                        <input type="color" id="tsm-grad-stop-color" value="#ffffff" style="width:28px;height:24px;padding:0;" />
                        <button type="button" id="tsm-grad-stop-add" class="btn small" title="${t('font.gradStopAdd')}">＋</button>
                        <button type="button" id="tsm-grad-stop-remove" class="btn small" title="${t('font.gradStopRemove')}">－</button>
                    </div>

                    <div class="fontmgr-style-group" id="tsm-fill-texture-panel" style="display:none;">
                        <button type="button" id="tsm-tex-select-btn" class="btn small">${t('font.texSelectImage')}</button>
                        <img id="tsm-tex-thumb" alt="" style="width:26px;height:26px;object-fit:cover;border:1px solid #666;border-radius:3px;display:none;" />
                        <label>${t('font.texScale')}<input type="number" id="tsm-tex-scale" min="1" max="1000" value="100" style="width:55px;" />%</label>
                        <label>${t('font.texOffsetX')}<input type="number" id="tsm-tex-offset-x" value="0" step="1" style="width:55px;" /></label>
                        <label>${t('font.texOffsetY')}<input type="number" id="tsm-tex-offset-y" value="0" step="1" style="width:55px;" /></label>
                        <input type="file" id="tsm-tex-file" accept="image/*" style="display:none;" />
                    </div>

                    <div class="fontmgr-style-group">
                        <label><input type="checkbox" id="tsm-bold-enable" /> ${t('font.boldLabel')}</label>
                        <label style="margin-left:8px;"><input type="checkbox" id="tsm-italic-enable" /> ${t('font.italicLabel')}</label>
                        <label style="margin-left:8px;"><input type="checkbox" id="tsm-underline-enable" /> ${t('font.underlineLabel')}</label>
                    </div>

                    <div class="fontmgr-style-group">
                        <label class="fontmgr-style-group-label">${t('font.alignLabel')}</label>
                        <select id="tsm-align-select">
                            <option value="left">${t('font.alignLeft')}</option>
                            <option value="center">${t('font.alignCenter')}</option>
                            <option value="right">${t('font.alignRight')}</option>
                        </select>
                    </div>

                    <div class="fontmgr-style-group">
                        <label><input type="checkbox" id="tsm-bukuro-enable" /> ${t('font.bukuroLabel')}</label>
                        <input type="color" id="tsm-bukuro-color" value="#000000" />
                        <input type="number" id="tsm-bukuro-width" min="0.5" max="50" step="0.5" value="8" style="width:50px;" />
                    </div>

                    <div class="fontmgr-style-group">
                        <label><input type="checkbox" id="tsm-shadow-enable" /> ${t('font.shadowLabel')}</label>
                        <input type="color" id="tsm-shadow-color" value="#000000" />
                        <label>${t('font.blurLabel')}<input type="number" id="tsm-shadow-blur" min="0" max="100" value="4" style="width:45px;" /></label>
                    </div>
                    <div class="fontmgr-style-group">
                        <label class="fontmgr-style-group-label">${t('font.shadowPosLabel')}</label>
                        <label>X<input type="number" id="tsm-shadow-dx" value="4" style="width:45px;" /></label>
                        <label>Y<input type="number" id="tsm-shadow-dy" value="4" style="width:45px;" /></label>
                    </div>

                    <hr class="fontmgr-divider" />

                    <div class="fontmgr-style-group">
                        <label class="fontmgr-style-group-label">${t('font.registeredLabel')}</label>
                        <select id="tsm-style-select" style="flex:1; min-width:0;">
                            <option value="">${t('font.newOption')}</option>
                        </select>
                        <button type="button" id="tsm-style-delete-btn" class="btn small danger" title="${t('font.styleDeleteTitle')}">${t('common.delete')}</button>
                    </div>

                    <div class="fontmgr-tag-input-row">
                        <input type="text" id="tsm-style-name-input" class="fontmgr-tag-input" placeholder="${t('font.styleNamePlaceholder')}" />
                        <button type="button" id="tsm-style-save-btn" class="btn small">${t('common.save')}</button>
                        <button type="button" id="tsm-style-new-btn" class="btn small secondary">${t('font.newBtn')}</button>
                    </div>
                </div>

                <div class="fontmgr-style-preview-area">
                    <div class="fontmgr-style-preview-toolbar">
                        <button type="button" id="tsm-bg-default" class="fontmgr-style-bg-btn active" data-bg="default">${t('asset.bgDefault')}</button>
                        <button type="button" id="tsm-bg-white" class="fontmgr-style-bg-btn" data-bg="white">${t('font.bgWhite')}</button>
                    </div>
                    <div id="tsm-preview-canvas" class="fontmgr-style-preview-canvas">
                        <!-- 実際の適用（_fontMgrApplyStyleAttrsToTextEl）と同じSVGレンダリングでプレビューする -->
                        <svg id="tsm-preview-svg" xmlns="http://www.w3.org/2000/svg" style="width:100%; height:100%;" preserveAspectRatio="xMidYMid meet">
                            <text id="tsm-preview-text" x="0" y="0"></text>
                        </svg>
                    </div>
                </div>
            </div>
            <div class="tsm-footer">
                <button type="button" id="tsm-cancel-btn" class="btn secondary">${t('common.cancel')}</button>
                <button type="button" id="tsm-apply-btn" class="btn primary">${t('common.apply')}</button>
            </div>
        `;
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const $ = id => dialog.querySelector('#' + id);

        // ── 塗り（塗りなし/単色/グラデーション/テクスチャ）状態 ──
        // ランプのストップ等はDOM入力では表現しきれないためモーダル内状態として保持する
        const fillState = {
            enabled: true,
            mode: 'solid',
            gradient: { shape: 'linear', angleDeg: 0, stops: [{ pos: 0, color: '#ffffff' }, { pos: 1, color: '#888888' }] },
            selectedStopIdx: 0,
            texture: null, // { dataUrl, w, h, scale }
        };

        function _hex2rgb(hex) {
            const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '#000000');
            return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 0, g: 0, b: 0 };
        }
        function _rgb2hex({ r, g, b }) {
            const h = v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
            return `#${h(r)}${h(g)}${h(b)}`;
        }
        // カラーランプ上の位置tの補間色（image-tab FillTool.evalGradient と同じ挙動）
        function _rampColorAt(stops, tPos) {
            const sorted = [...stops].sort((a, b) => a.pos - b.pos);
            if (!sorted.length) return '#000000';
            if (tPos <= sorted[0].pos) return sorted[0].color;
            const last = sorted[sorted.length - 1];
            if (tPos >= last.pos) return last.color;
            for (let i = 0; i < sorted.length - 1; i++) {
                const a = sorted[i], b = sorted[i + 1];
                if (tPos >= a.pos && tPos <= b.pos) {
                    const lt = (b.pos - a.pos) > 0 ? (tPos - a.pos) / (b.pos - a.pos) : 0;
                    const ca = _hex2rgb(a.color), cb = _hex2rgb(b.color);
                    return _rgb2hex({ r: ca.r + (cb.r - ca.r) * lt, g: ca.g + (cb.g - ca.g) * lt, b: ca.b + (cb.b - ca.b) * lt });
                }
            }
            return last.color;
        }

        // カラーランプの描画（image-tab の _drawFillGradientRamp を移植）
        function drawGradRamp() {
            const canvas = $('tsm-grad-ramp');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const w = canvas.width, h = canvas.height;
            ctx.clearRect(0, 0, w, h);
            const barH = h - 10;
            const grad = ctx.createLinearGradient(0, 0, w, 0);
            [...fillState.gradient.stops].sort((a, b) => a.pos - b.pos).forEach(s => grad.addColorStop(Math.max(0, Math.min(1, s.pos)), s.color));
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, w, barH);
            ctx.strokeStyle = '#666';
            ctx.strokeRect(0.5, 0.5, w - 1, barH - 1);
            fillState.gradient.stops.forEach((s, i) => {
                const x = Math.max(5, Math.min(w - 5, s.pos * w));
                ctx.beginPath();
                ctx.moveTo(x, h);
                ctx.lineTo(x - 5, barH);
                ctx.lineTo(x + 5, barH);
                ctx.closePath();
                ctx.fillStyle = i === fillState.selectedStopIdx ? '#0077ff' : '#999';
                ctx.fill();
            });
        }

        // モード・チェックに応じたコントロールの表示切替
        function syncFillUI() {
            $('tsm-fill-enable').checked = fillState.enabled;
            $('tsm-fill-mode').value = fillState.mode;
            $('tsm-fill-mode').disabled = !fillState.enabled;
            $('tsm-fill-color').style.display = (fillState.enabled && fillState.mode === 'solid') ? '' : 'none';
            $('tsm-fill-gradient-panel').style.display = (fillState.enabled && fillState.mode === 'gradient') ? 'flex' : 'none';
            $('tsm-fill-texture-panel').style.display = (fillState.enabled && fillState.mode === 'texture') ? 'flex' : 'none';
            const thumb = $('tsm-tex-thumb');
            if (fillState.texture?.dataUrl) {
                thumb.src = fillState.texture.dataUrl;
                thumb.style.display = '';
            } else {
                thumb.style.display = 'none';
            }
            if (fillState.enabled && fillState.mode === 'gradient') {
                $('tsm-grad-shape').value = fillState.gradient.shape;
                $('tsm-grad-angle').value = fillState.gradient.angleDeg;
                const sel = fillState.gradient.stops[fillState.selectedStopIdx];
                if (sel) $('tsm-grad-stop-color').value = sel.color;
                drawGradRamp();
            }
        }

        // style オブジェクトの塗り関連フィールドを fillState へ読み込む
        function loadFillState(style) {
            fillState.enabled = style?.fillEnabled !== false;
            fillState.mode = style?.fillMode || 'solid';
            if (style?.fillGradient?.stops?.length) {
                fillState.gradient = {
                    shape: style.fillGradient.shape === 'radial' ? 'radial' : 'linear',
                    angleDeg: style.fillGradient.angleDeg || 0,
                    stops: style.fillGradient.stops.map(s => ({ pos: s.pos, color: s.color })),
                };
            } else {
                fillState.gradient = { shape: 'linear', angleDeg: 0, stops: [{ pos: 0, color: '#ffffff' }, { pos: 1, color: '#888888' }] };
            }
            fillState.selectedStopIdx = 0;
            fillState.texture = style?.fillTexture?.dataUrl ? { ...style.fillTexture } : null;
            if (style?.fillTexture?.scale) $('tsm-tex-scale').value = style.fillTexture.scale;
            $('tsm-tex-offset-x').value = style?.fillTexture?.offsetX || 0;
            $('tsm-tex-offset-y').value = style?.fillTexture?.offsetY || 0;
            syncFillUI();
        }

        function renderPreview() {
            // レイアウトタブへの適用と同じ _fontMgrApplyStyleAttrsToTextEl を通してSVGで描画する
            // （CSSプレビューだと線の基準・袋文字の形状・影のぼけ量・サイズ比が実表示とズレるため）
            const svgEl = $('tsm-preview-svg');
            const textEl = $('tsm-preview-text');
            if (!svgEl || !textEl || typeof window._fontMgrApplyStyleAttrsToTextEl !== 'function') return;

            const size = parseInt($('tsm-preview-size').value, 10) || 120;
            const style = getStyleFromUI('');
            textEl.textContent = $('tsm-preview-input').value || 'あ亜Aa1';
            textEl.setAttribute('font-family', fontFamily);
            textEl.setAttribute('font-size', size);
            window._fontMgrApplyStyleAttrsToTextEl(textEl, svgEl, style);

            // viewBoxをテキスト＋スタイル分の余白にフィットさせる
            // （スタイル値はフォントサイズ100pxあたりの相対値なのでsizeでスケールして余白を取る）
            let bb;
            try { bb = textEl.getBBox(); } catch { return; }
            if (!bb || (!bb.width && !bb.height)) return;
            const k = size / 100;
            const pad = ((style.bukuroEnabled ? (style.bukuroWidth || 0) : 0)
                      + (style.strokeEnabled ? (style.strokeWidth || 0) / 2 : 0)
                      + (style.shadowEnabled ? (style.shadowBlur || 0) + Math.max(Math.abs(style.shadowDx || 0), Math.abs(style.shadowDy || 0)) : 0)) * k
                      + size * 0.1;
            svgEl.setAttribute('viewBox', `${bb.x - pad} ${bb.y - pad} ${bb.width + pad * 2} ${bb.height + pad * 2}`);
        }

        function getStyleFromUI(name) {
            return {
                id: editingId || `style_${Date.now()}`,
                name,
                v: 2, // v2: 数値はフォントサイズ100pxあたりのpx（相対値）
                fill: $('tsm-fill-color').value,
                fillEnabled: fillState.enabled,
                fillMode: fillState.mode,
                fillGradient: fillState.mode === 'gradient' ? {
                    shape: $('tsm-grad-shape').value === 'radial' ? 'radial' : 'linear',
                    angleDeg: parseFloat($('tsm-grad-angle').value) || 0,
                    stops: fillState.gradient.stops.map(s => ({ pos: s.pos, color: s.color })),
                } : (fillState.gradient ? {
                    shape: fillState.gradient.shape,
                    angleDeg: fillState.gradient.angleDeg,
                    stops: fillState.gradient.stops.map(s => ({ pos: s.pos, color: s.color })),
                } : null),
                fillTexture: fillState.texture ? {
                    ...fillState.texture,
                    scale: parseFloat($('tsm-tex-scale').value) || 100,
                    offsetX: parseFloat($('tsm-tex-offset-x').value) || 0,
                    offsetY: parseFloat($('tsm-tex-offset-y').value) || 0,
                } : null,
                strokeEnabled: $('tsm-stroke-enable').checked,
                strokeColor: $('tsm-stroke-color').value,
                strokeWidth: parseFloat($('tsm-stroke-width').value) || 0,
                boldEnabled: $('tsm-bold-enable').checked,
                italicEnabled: $('tsm-italic-enable').checked,
                underlineEnabled: $('tsm-underline-enable').checked,
                align: $('tsm-align-select').value || 'left',
                bukuroEnabled: $('tsm-bukuro-enable').checked,
                bukuroColor: $('tsm-bukuro-color').value,
                bukuroWidth: parseFloat($('tsm-bukuro-width').value) || 0,
                shadowEnabled: $('tsm-shadow-enable').checked,
                shadowColor: $('tsm-shadow-color').value,
                shadowBlur: parseFloat($('tsm-shadow-blur').value) || 0,
                shadowDx: parseFloat($('tsm-shadow-dx').value) || 0,
                shadowDy: parseFloat($('tsm-shadow-dy').value) || 0,
            };
        }

        function applyStyleToUI(style) {
            $('tsm-fill-color').value = style.fill;
            loadFillState(style);
            $('tsm-stroke-enable').checked = !!style.strokeEnabled;
            $('tsm-stroke-color').value = style.strokeColor;
            $('tsm-stroke-width').value = style.strokeWidth;
            $('tsm-bold-enable').checked = !!style.boldEnabled;
            $('tsm-italic-enable').checked = !!style.italicEnabled;
            $('tsm-underline-enable').checked = !!style.underlineEnabled;
            $('tsm-align-select').value = style.align || 'left';
            $('tsm-bukuro-enable').checked = !!style.bukuroEnabled;
            $('tsm-bukuro-color').value = style.bukuroColor;
            $('tsm-bukuro-width').value = style.bukuroWidth;
            $('tsm-shadow-enable').checked = !!style.shadowEnabled;
            $('tsm-shadow-color').value = style.shadowColor;
            $('tsm-shadow-blur').value = style.shadowBlur;
            $('tsm-shadow-dx').value = style.shadowDx;
            $('tsm-shadow-dy').value = style.shadowDy;
            $('tsm-style-name-input').value = style.name || '';
            editingId = style.id;
            renderStyleSelect();
            renderPreview();
        }

        function resetStyleUI() {
            editingId = null;
            $('tsm-style-name-input').value = '';
            $('tsm-fill-color').value = '#000000';
            loadFillState(null);
            $('tsm-stroke-enable').checked = false;
            $('tsm-stroke-color').value = '#ffffff';
            $('tsm-stroke-width').value = 4;
            $('tsm-bold-enable').checked = false;
            $('tsm-italic-enable').checked = false;
            $('tsm-underline-enable').checked = false;
            $('tsm-align-select').value = 'left';
            $('tsm-bukuro-enable').checked = false;
            $('tsm-bukuro-color').value = '#000000';
            $('tsm-bukuro-width').value = 8;
            $('tsm-shadow-enable').checked = false;
            $('tsm-shadow-color').value = '#000000';
            $('tsm-shadow-blur').value = 4;
            $('tsm-shadow-dx').value = 4;
            $('tsm-shadow-dy').value = 4;
            renderStyleSelect();
            renderPreview();
        }

        function renderStyleSelect() {
            const sel = $('tsm-style-select');
            sel.innerHTML = `<option value="">${t('font.newOption')}</option>` +
                styleList.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
            sel.value = editingId || '';
        }

        // 選択中テキストの現在の見た目をUIの初期値として反映する（保存済みスタイルの読込とは異なり、
        // 登録済みIDとしては扱わない＝「新規」のまま、既存スタイルへの上書き保存を誘発しないようにする）
        function applyInitialStyle(style) {
            $('tsm-fill-color').value = style.fill || '#000000';
            loadFillState(style);
            $('tsm-stroke-enable').checked = !!style.strokeEnabled;
            $('tsm-stroke-color').value = style.strokeColor || '#ffffff';
            $('tsm-stroke-width').value = style.strokeWidth || 4;
            $('tsm-bold-enable').checked = !!style.boldEnabled;
            $('tsm-italic-enable').checked = !!style.italicEnabled;
            $('tsm-underline-enable').checked = !!style.underlineEnabled;
            $('tsm-align-select').value = style.align || 'left';
            $('tsm-bukuro-enable').checked = !!style.bukuroEnabled;
            $('tsm-bukuro-color').value = style.bukuroColor || '#000000';
            $('tsm-bukuro-width').value = style.bukuroWidth || 8;
            $('tsm-shadow-enable').checked = !!style.shadowEnabled;
            $('tsm-shadow-color').value = style.shadowColor || '#000000';
            $('tsm-shadow-blur').value = style.shadowBlur ?? 4;
            $('tsm-shadow-dx').value = style.shadowDx ?? 4;
            $('tsm-shadow-dy').value = style.shadowDy ?? 4;
        }

        // ── イベント登録 ──
        const previewInputIds = [
            'tsm-preview-input', 'tsm-preview-size',
            'tsm-fill-color',
            'tsm-stroke-enable', 'tsm-stroke-color', 'tsm-stroke-width',
            'tsm-bold-enable', 'tsm-italic-enable', 'tsm-underline-enable', 'tsm-align-select',
            'tsm-bukuro-enable', 'tsm-bukuro-color', 'tsm-bukuro-width',
            'tsm-shadow-enable', 'tsm-shadow-color', 'tsm-shadow-blur', 'tsm-shadow-dx', 'tsm-shadow-dy',
        ];
        previewInputIds.forEach(id => {
            const el = $(id);
            const evt = (el.type === 'checkbox') ? 'change' : 'input';
            el.addEventListener(evt, renderPreview);
        });

        // ── 塗り（塗りなし/モード/グラデーション/テクスチャ）イベント ──
        $('tsm-fill-enable').addEventListener('change', e => { fillState.enabled = e.target.checked; syncFillUI(); renderPreview(); });
        $('tsm-fill-mode').addEventListener('change', e => { fillState.mode = e.target.value; syncFillUI(); renderPreview(); });
        $('tsm-grad-shape').addEventListener('change', e => { fillState.gradient.shape = e.target.value; renderPreview(); });
        $('tsm-grad-angle').addEventListener('input', e => { fillState.gradient.angleDeg = parseFloat(e.target.value) || 0; renderPreview(); });
        $('tsm-grad-stop-color').addEventListener('input', e => {
            const s = fillState.gradient.stops[fillState.selectedStopIdx];
            if (s) { s.color = e.target.value; drawGradRamp(); renderPreview(); }
        });
        $('tsm-grad-stop-add').addEventListener('click', () => {
            // 最も広い隙間の中央に追加（image-tab FillTool.addStop と同じ挙動）
            const sorted = [...fillState.gradient.stops].sort((a, b) => a.pos - b.pos);
            let gapStart = 0, gapSize = 0;
            for (let i = 0; i < sorted.length - 1; i++) {
                const gap = sorted[i + 1].pos - sorted[i].pos;
                if (gap > gapSize) { gapSize = gap; gapStart = sorted[i].pos; }
            }
            const pos = sorted.length < 2 ? 0.5 : gapStart + gapSize / 2;
            fillState.gradient.stops.push({ pos, color: _rampColorAt(fillState.gradient.stops, pos) });
            fillState.selectedStopIdx = fillState.gradient.stops.length - 1;
            syncFillUI();
            renderPreview();
        });
        $('tsm-grad-stop-remove').addEventListener('click', () => {
            if (fillState.gradient.stops.length <= 1) return;
            fillState.gradient.stops.splice(fillState.selectedStopIdx, 1);
            fillState.selectedStopIdx = Math.max(0, Math.min(fillState.selectedStopIdx, fillState.gradient.stops.length - 1));
            syncFillUI();
            renderPreview();
        });
        // ランプ: ストップの選択・ドラッグ移動
        $('tsm-grad-ramp').addEventListener('mousedown', e => {
            const canvas = $('tsm-grad-ramp');
            const rect = canvas.getBoundingClientRect();
            const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
            let best = -1, bestDist = 9;
            fillState.gradient.stops.forEach((s, i) => {
                const d = Math.abs(s.pos * canvas.width - mx);
                if (d < bestDist) { bestDist = d; best = i; }
            });
            if (best < 0) return;
            fillState.selectedStopIdx = best;
            $('tsm-grad-stop-color').value = fillState.gradient.stops[best].color;
            drawGradRamp();
            const onMove = ev => {
                const r = canvas.getBoundingClientRect();
                const x = (ev.clientX - r.left) * (canvas.width / r.width);
                fillState.gradient.stops[fillState.selectedStopIdx].pos = Math.max(0, Math.min(1, x / canvas.width));
                drawGradRamp();
                renderPreview();
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
        // テクスチャ画像選択（localStorage容量対策として最大512pxへ縮小して保持）
        $('tsm-tex-select-btn').addEventListener('click', () => $('tsm-tex-file').click());
        $('tsm-tex-file').addEventListener('change', e => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                const img = new Image();
                img.onload = () => {
                    const MAX = 512;
                    const sc = Math.min(1, MAX / Math.max(img.width, img.height));
                    const w = Math.max(1, Math.round(img.width * sc));
                    const h = Math.max(1, Math.round(img.height * sc));
                    const cv = document.createElement('canvas');
                    cv.width = w;
                    cv.height = h;
                    cv.getContext('2d').drawImage(img, 0, 0, w, h);
                    fillState.texture = { dataUrl: cv.toDataURL('image/png'), w, h, scale: parseFloat($('tsm-tex-scale').value) || 100 };
                    syncFillUI();
                    renderPreview();
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
            e.target.value = '';
        });
        $('tsm-tex-scale').addEventListener('input', renderPreview);
        $('tsm-tex-offset-x').addEventListener('input', renderPreview);
        $('tsm-tex-offset-y').addEventListener('input', renderPreview);

        $('tsm-style-save-btn').addEventListener('click', () => {
            const name = $('tsm-style-name-input').value.trim();
            if (!name) { alert(t('image.styleNameRequired')); return; }
            const loaded = styleList.find(s => s.id === editingId);
            if (loaded && loaded.name !== name) editingId = null;
            const style = getStyleFromUI(name);
            const idx = styleList.findIndex(s => s.id === style.id);
            if (idx >= 0) styleList[idx] = style;
            else styleList.push(style);
            saveStyles(styleList);
            editingId = style.id;
            renderStyleSelect();
        });

        $('tsm-style-new-btn').addEventListener('click', () => resetStyleUI());

        $('tsm-style-select').addEventListener('change', (e) => {
            const id = e.target.value;
            if (!id) { resetStyleUI(); return; }
            const style = styleList.find(s => s.id === id);
            if (style) applyStyleToUI(style);
        });

        $('tsm-style-delete-btn').addEventListener('click', () => {
            const id = $('tsm-style-select').value;
            const style = styleList.find(s => s.id === id);
            if (!style) { alert(t('image.styleSelectToDelete')); return; }
            if (!confirm(t('image.styleDeleteConfirm', style.name))) return;
            styleList = styleList.filter(s => s.id !== style.id);
            saveStyles(styleList);
            resetStyleUI();
        });

        $('tsm-bg-default').addEventListener('click', () => {
            $('tsm-preview-canvas').classList.remove('bg-white');
            $('tsm-bg-default').classList.add('active');
            $('tsm-bg-white').classList.remove('active');
        });
        $('tsm-bg-white').addEventListener('click', () => {
            $('tsm-preview-canvas').classList.add('bg-white');
            $('tsm-bg-white').classList.add('active');
            $('tsm-bg-default').classList.remove('active');
        });

        const close = () => document.body.removeChild(overlay);
        document.addEventListener('keydown', onKeydown);
        function onKeydown(e) { if (e.key === 'Escape') close(); }
        const closeAndCleanup = () => { document.removeEventListener('keydown', onKeydown); close(); };

        $('tsm-close-btn').addEventListener('click', closeAndCleanup);
        $('tsm-cancel-btn').addEventListener('click', closeAndCleanup);
        overlay.addEventListener('click', e => { if (e.target === overlay) closeAndCleanup(); });

        $('tsm-apply-btn').addEventListener('click', () => {
            const name = $('tsm-style-name-input').value.trim();
            const style = getStyleFromUI(name);
            onApply(style);
            closeAndCleanup();
        });

        renderStyleSelect();
        if (previewSize) $('tsm-preview-size').value = previewSize;
        if (initialStyle) applyInitialStyle(initialStyle);
        else syncFillUI();
        renderPreview();
        // Webフォントのロード完了後はBBoxが変わるためviewBoxを取り直す
        document.fonts?.ready.then(() => { if (document.body.contains(overlay)) renderPreview(); });
    };
})();
