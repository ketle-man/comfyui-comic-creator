// ============================================================
// main.js 分割ファイル (19/24): SVG色変更機能+SVGtoPNG変換機能
// 元 main.js の行 15195-15502 に相当
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: _svgColorApply,_svgColorLoad,_svgColorState,_svgColorToHex6,_svgExtractColors,_svgGetSelectedSvgText,_svgReplaceColor,_svgTextToDataUrl,_svgToPngConvert
// ============================================================

// ─────────────────────────────────────────────
//  SVG色変更機能
// ─────────────────────────────────────────────

// SVG色変更の状態
const _svgColorState = {
    svgText: '',        // 現在編集中のSVGテキスト
    colorMap: new Map(), // key: 元の色文字列, value: 新しい色文字列
    origWidth: 0,
    origHeight: 0,
};

// 選択中の画像要素からSVGテキストを取得する
function _svgGetSelectedSvgText() {
    const el = state.selectedImageEl;
    if (!el) return null;
    const href = el.getAttribute('href') || el.getAttribute('xlink:href') || '';
    if (href.startsWith('data:image/svg')) {
        // data:image/svg+xml;base64,... または data:image/svg+xml,...
        const base64Match = href.match(/^data:image\/svg\+xml;base64,(.+)$/);
        if (base64Match) {
            return atob(base64Match[1]);
        }
        const plainMatch = href.match(/^data:image\/svg\+xml,(.+)$/);
        if (plainMatch) {
            return decodeURIComponent(plainMatch[1]);
        }
    }
    return null;
}

// SVGテキストをdata URLに変換
function _svgTextToDataUrl(svgText) {
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgText)));
}

// SVGから色（fill/stroke属性・style内）を抽出してユニーク一覧を返す
// 背景rect（width="100%"など）は除外する
function _svgExtractColors(svgText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');

    const colorSet = new Set();

    // fill/stroke属性を持つ全要素を走査
    doc.querySelectorAll('[fill],[stroke],[style]').forEach(el => {
        // background相当（width/height=100%のrect）は除外
        if (el.tagName.toLowerCase() === 'rect') {
            const w = el.getAttribute('width') || '';
            const h = el.getAttribute('height') || '';
            if (w === '100%' || h === '100%') return;
        }

        const fill   = el.getAttribute('fill');
        const stroke = el.getAttribute('stroke');
        const style  = el.getAttribute('style') || '';

        if (fill   && fill   !== 'none' && fill   !== 'transparent') colorSet.add(fill.toLowerCase());
        if (stroke && stroke !== 'none' && stroke !== 'transparent') colorSet.add(stroke.toLowerCase());

        // style属性内の fill/stroke
        const fillMatch   = style.match(/(?:^|;)\s*fill\s*:\s*([^;]+)/);
        const strokeMatch = style.match(/(?:^|;)\s*stroke\s*:\s*([^;]+)/);
        if (fillMatch)   { const c = fillMatch[1].trim();   if (c !== 'none' && c !== 'transparent') colorSet.add(c.toLowerCase()); }
        if (strokeMatch) { const c = strokeMatch[1].trim(); if (c !== 'none' && c !== 'transparent') colorSet.add(c.toLowerCase()); }
    });

    return [...colorSet];
}

// SVGテキスト内の特定の色を別の色に置換（fill=, stroke=, style内）
function _svgReplaceColor(svgText, fromColor, toColor) {
    // 属性値の直接置換（引用符の中の色）
    // fill="fromColor" → fill="toColor"（大小文字両方）
    const escaped = fromColor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 属性値の置換
    svgText = svgText.replace(
        new RegExp(`(fill|stroke)\\s*=\\s*["']${escaped}["']`, 'gi'),
        (m, attr) => `${attr}="${toColor}"`
    );
    // style属性内の置換
    svgText = svgText.replace(
        new RegExp(`(fill|stroke)\\s*:\\s*${escaped}`, 'gi'),
        (m, prop) => `${prop}:${toColor}`
    );
    return svgText;
}

// SVG色変更: 色を抽出してUIに表示
function _svgColorLoad() {
    const svgText = _svgGetSelectedSvgText();
    if (!svgText) {
        alert(t('layout.msgSelectSvgImage'));
        return;
    }
    _svgColorState.svgText  = svgText;
    _svgColorState.colorMap = new Map();

    // 元サイズを取得（PNG変換で使用）
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    if (svgEl) {
        _svgColorState.origWidth  = parseFloat(svgEl.getAttribute('width'))  || 0;
        _svgColorState.origHeight = parseFloat(svgEl.getAttribute('height')) || 0;
        // viewBoxからも取得を試みる
        if (!_svgColorState.origWidth || !_svgColorState.origHeight) {
            const vb = svgEl.getAttribute('viewBox');
            if (vb) {
                const parts = vb.trim().split(/[\s,]+/);
                if (parts.length >= 4) {
                    _svgColorState.origWidth  = parseFloat(parts[2]) || 0;
                    _svgColorState.origHeight = parseFloat(parts[3]) || 0;
                }
            }
        }
        // SVG→PNGのデフォルト値を設定
        document.getElementById('svg-png-width').value  = _svgColorState.origWidth  || '';
        document.getElementById('svg-png-height').value = _svgColorState.origHeight || '';
    }

    const colors = _svgExtractColors(svgText);
    const listEl = document.getElementById('svg-color-list');

    if (colors.length === 0) {
        listEl.innerHTML = `<span style="font-size:11px; color:var(--text-secondary); padding:4px;">${t('layout.svgColorNotFound')}</span>`;
        return;
    }

    listEl.innerHTML = '';
    colors.forEach(color => {
        _svgColorState.colorMap.set(color, color); // 初期値は同色

        const item = document.createElement('div');
        item.style.cssText = 'display:flex; align-items:center; gap:4px; padding:3px 6px; border:1px solid var(--border-color); border-radius:4px; background:var(--bg-secondary);';

        // 色見本
        const swatch = document.createElement('div');
        swatch.style.cssText = `width:20px; height:20px; background:${color}; border:1px solid #888; border-radius:2px; flex-shrink:0;`;

        // 元色テキスト
        const label = document.createElement('span');
        label.textContent = color;
        label.style.cssText = 'font-size:11px; min-width:80px; font-family:monospace;';

        // → 矢印
        const arrow = document.createElement('span');
        arrow.textContent = '→';
        arrow.style.fontSize = '11px';

        // 新色カラーピッカー
        const picker = document.createElement('input');
        picker.type = 'color';
        picker.title = t('layout.svgColorNewTitle');
        // hex6形式に変換してpickerにセット
        picker.value = _svgColorToHex6(color);
        picker.style.cssText = 'width:32px; height:24px; padding:0; border:none; cursor:pointer;';

        picker.addEventListener('input', () => {
            _svgColorState.colorMap.set(color, picker.value);
            swatch.style.background = picker.value; // swatch更新はしない（元色を維持）
        });

        item.appendChild(swatch);
        item.appendChild(label);
        item.appendChild(arrow);
        item.appendChild(picker);
        listEl.appendChild(item);
    });

    document.getElementById('svg-color-status').textContent = t('layout.svgColorDetected', colors.length);
}

// 色文字列をhex6形式に変換（カラーピッカー用）
function _svgColorToHex6(color) {
    // 既にhex6なら返す
    if (/^#[0-9a-f]{6}$/i.test(color)) return color;
    // hex3 → hex6
    if (/^#[0-9a-f]{3}$/i.test(color)) {
        return '#' + color[1]+color[1]+color[2]+color[2]+color[3]+color[3];
    }
    // Canvasで変換（名前付き色などに対応）
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('');
}

// SVG色変更: 変更を適用してSVGを画像要素に反映
function _svgColorApply() {
    if (!_svgColorState.svgText) {
        alert(t('layout.svgColorExtractFirst'));
        return;
    }
    const el = state.selectedImageEl;
    if (!el) {
        alert(t('layout.msgSelectSvgImage'));
        return;
    }

    let svgText = _svgColorState.svgText;
    let changed = 0;

    _svgColorState.colorMap.forEach((toColor, fromColor) => {
        const from6 = _svgColorToHex6(fromColor);
        const to6   = toColor.toLowerCase();
        if (from6.toLowerCase() !== to6) {
            // 元の色文字列で置換（名前付き色もhexも両方試みる）
            svgText = _svgReplaceColor(svgText, fromColor, to6);
            changed++;
        }
    });

    if (changed === 0) {
        document.getElementById('svg-color-status').textContent = t('layout.svgColorNoChange');
        return;
    }

    const newHref = _svgTextToDataUrl(svgText);
    el.setAttribute('href', newHref);
    el.setAttribute('xlink:href', newHref);

    // panelSvgContent / overlaySvgContent を更新
    const svgEl = getPanelLayerSvg(getActiveContainer());
    if (svgEl) {
        if (state.selectedOverlay) saveOverlaySvg(svgEl);
        else savePanelSvg(state.selectedPanelId, svgEl);
    }

    // 状態を更新（次の適用に備える）
    _svgColorState.svgText = svgText;
    document.getElementById('svg-color-status').textContent = t('layout.svgColorChanged', changed);
}

// ─────────────────────────────────────────────
//  SVG→PNG変換機能
// ─────────────────────────────────────────────

async function _svgToPngConvert() {
    const svgText = _svgGetSelectedSvgText();
    if (!svgText) {
        alert(t('layout.msgSelectSvgImage'));
        return;
    }

    const statusEl = document.getElementById('svg-png-status');
    statusEl.textContent = t('layout.textToPngConverting');

    const wInput = parseInt(document.getElementById('svg-png-width').value,  10);
    const hInput = parseInt(document.getElementById('svg-png-height').value, 10);

    // サイズ決定（空欄なら元サイズ）
    let w = wInput || _svgColorState.origWidth;
    let h = hInput || _svgColorState.origHeight;

    // origWidth/Heightがまだ未取得なら取得
    if (!w || !h) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgText, 'image/svg+xml');
        const svgEl = doc.querySelector('svg');
        if (svgEl) {
            w = w || parseFloat(svgEl.getAttribute('width'))  || 0;
            h = h || parseFloat(svgEl.getAttribute('height')) || 0;
            if (!w || !h) {
                const vb = svgEl.getAttribute('viewBox');
                if (vb) {
                    const parts = vb.trim().split(/[\s,]+/);
                    if (parts.length >= 4) {
                        w = w || parseFloat(parts[2]) || 0;
                        h = h || parseFloat(parts[3]) || 0;
                    }
                }
            }
        }
    }

    if (!w || !h) {
        statusEl.textContent = t('layout.svgToPngSizeRequired');
        return;
    }

    try {
        const dataUrl = _svgTextToDataUrl(svgText);
        const img = new Image();
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = dataUrl;
        });

        const canvas = document.createElement('canvas');
        canvas.width  = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        const pngDataUrl = canvas.toDataURL('image/png');
        // 元のSVG画像要素と同じ位置・表示サイズで複製挿入する（コマ幅フィットにはしない）
        const srcEl = state.selectedImageEl;
        const placement = srcEl ? {
            x:      parseFloat(srcEl.getAttribute('x'))      || 0,
            y:      parseFloat(srcEl.getAttribute('y'))      || 0,
            width:  parseFloat(srcEl.getAttribute('width'))  || w,
            height: parseFloat(srcEl.getAttribute('height')) || h,
        } : null;
        await insertImage(pngDataUrl, w, h, {}, placement);
        statusEl.textContent = t('layout.svgToPngDone', w, h);
    } catch (e) {
        console.error('SVG→PNG変換エラー:', e);
        statusEl.textContent = t('common.errorPrefix', e.message);
    }
}

