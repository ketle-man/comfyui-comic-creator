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
                        <label class="fontmgr-style-group-label">${t('font.fillLabel')}</label>
                        <input type="color" id="tsm-fill-color" value="#000000" />
                        <label style="margin-left:8px;"><input type="checkbox" id="tsm-stroke-enable" /> ${t('font.strokeLabel')}</label>
                        <input type="color" id="tsm-stroke-color" value="#ffffff" />
                        <input type="number" id="tsm-stroke-width" min="0.5" max="50" step="0.5" value="4" style="width:50px;" />
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
        renderPreview();
        // Webフォントのロード完了後はBBoxが変わるためviewBoxを取り直す
        document.fonts?.ready.then(() => { if (document.body.contains(overlay)) renderPreview(); });
    };
})();
