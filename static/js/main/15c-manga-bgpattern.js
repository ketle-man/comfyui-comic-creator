// ============================================================
// マンガツール: 背景パターン（ストライプ / ドット / チェック / 和柄 / カスタムSVG）
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 対象領域の決定・キャンバスサイズ計算・プレビュー背景ガイド・挿入処理は
// 15b-manga-tone.js の共通ヘルパー（_mangaGetTargetRegion 等）をそのまま再利用する。
// 主なトップレベル定義: initMangaBgPatternButton, mangaBgPatternOpen
// ============================================================

// ── パターン定義 ──
// 参考: ComfyUI-Workflow-Studio の設定タブ「テーマのカスタマイズ」の背景パターン
// （ストライプ×3・ドット・チェック・カスタムSVG）をベースに、漫画でよく使われる
// 和柄（麻の葉・市松・七宝・鱗）を追加したもの。
const BG_PATTERN_TYPES = [
    { id: 'stripe-h',  key: 'layout.bgPatternStripeH' },
    { id: 'stripe-v',  key: 'layout.bgPatternStripeV' },
    { id: 'stripe-d',  key: 'layout.bgPatternStripeD' },
    { id: 'dot',       key: 'layout.bgPatternDot' },
    { id: 'check',     key: 'layout.bgPatternCheck' },
    { id: 'asanoha',   key: 'layout.bgPatternAsanoha' },
    { id: 'ichimatsu', key: 'layout.bgPatternIchimatsu' },
    { id: 'shippou',   key: 'layout.bgPatternShippou' },
    { id: 'uroko',     key: 'layout.bgPatternUroko' },
    { id: 'svg',       key: 'layout.bgPatternSvg' },
];

function _mangaBgPatternDefaultOptions() {
    return {
        patternId: 'stripe-d',
        color: '#000000',
        bgColor: '#ffffff', // ichimatsu（2色市松）専用
        opacity: 0.6,
        scale: 30,           // タイルサイズ（400pxリファレンス基準、_MANGA_SIZE_REFERENCE_DIMで比例スケール）
        svgWidth: 60,         // svg専用: タイル幅（横長ロゴ等に対応するため高さと独立指定できる）
        svgHeight: 60,        // svg専用: タイル高さ
        gap: 0,               // svg専用: タイル間の余白
        rotation: 0,          // パターン全体の回転角度（度）
        transparentBackground: true,
        svgData: null,
        svgName: '',
    };
}

function _mangaBgRgba(hex, opacity) {
    const { r, g, b } = _mangaHexToRgb(hex);
    return `rgba(${r},${g},${b},${opacity})`;
}

// ── タイル描画: 幾何学パターン（すべて正方形タイル s×s、境界をまたいでも継ぎ目なく繰り返せる） ──

function _mangaBgDrawStripeH(ctx, s, color, opacity) {
    const lineW = Math.max(1, s * 0.28);
    ctx.fillStyle = _mangaBgRgba(color, opacity);
    ctx.fillRect(0, 0, s, lineW);
}
function _mangaBgDrawStripeV(ctx, s, color, opacity) {
    const lineW = Math.max(1, s * 0.28);
    ctx.fillStyle = _mangaBgRgba(color, opacity);
    ctx.fillRect(0, 0, lineW, s);
}
// x - y = k の45度直線群をkをsずつずらして複数描く。隣接タイルでも同じ直線群が
// 延長される形になるため、境界で途切れず連続した斜め縞になる。
function _mangaBgDrawStripeD(ctx, s, color, opacity) {
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, s, s); ctx.clip();
    ctx.strokeStyle = _mangaBgRgba(color, opacity);
    ctx.lineWidth = Math.max(1, s * 0.28) * Math.SQRT2;
    ctx.lineCap = 'square';
    for (let k = -s; k <= 2 * s; k += s) {
        ctx.beginPath();
        ctx.moveTo(k, 0);
        ctx.lineTo(k + s, s);
        ctx.stroke();
    }
    ctx.restore();
}
function _mangaBgDrawDot(ctx, s, color, opacity) {
    const r = Math.max(1, s * 0.16);
    ctx.fillStyle = _mangaBgRgba(color, opacity);
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, r, 0, Math.PI * 2);
    ctx.fill();
}
// 2×2の対角セルを塗る単色チェック（背景は透明のまま）
function _mangaBgDrawCheck(ctx, s, color, opacity) {
    const half = s / 2;
    ctx.fillStyle = _mangaBgRgba(color, opacity);
    ctx.fillRect(0, 0, half, half);
    ctx.fillRect(half, half, half, half);
}
// 市松（伝統的な2色ベタ塗りの交互配置）。checkとは違い背景も塗りつぶす
function _mangaBgDrawIchimatsu(ctx, s, color, bgColor, opacity) {
    const half = s / 2;
    ctx.fillStyle = _mangaBgRgba(bgColor, opacity);
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = _mangaBgRgba(color, opacity);
    ctx.fillRect(0, 0, half, half);
    ctx.fillRect(half, half, half, half);
}
// 七宝つなぎ: 円弧をタイルの四隅・辺の中点・中心に規則正しく配置し、隣接タイルの円と
// 連続して輪違い文様になるようにする
function _mangaBgDrawShippou(ctx, s, color, opacity) {
    ctx.strokeStyle = _mangaBgRgba(color, opacity);
    ctx.lineWidth = Math.max(1, s * 0.06);
    const r = s / 2;
    const pts = [[0, 0], [s, 0], [0, s], [s, s], [s / 2, s / 2], [s / 2, 0], [s / 2, s], [0, s / 2], [s, s / 2]];
    pts.forEach(([cx, cy]) => {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
    });
}
// 鱗文様: 2×2グリッドに上向き/下向きの二等辺三角形を市松状に配置する近似
function _mangaBgTriUp(ctx, x, y, size) {
    ctx.beginPath();
    ctx.moveTo(x, y + size);
    ctx.lineTo(x + size / 2, y);
    ctx.lineTo(x + size, y + size);
    ctx.closePath();
    ctx.fill();
}
function _mangaBgTriDown(ctx, x, y, size) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x + size / 2, y + size);
    ctx.closePath();
    ctx.fill();
}
function _mangaBgDrawUroko(ctx, s, color, opacity) {
    ctx.fillStyle = _mangaBgRgba(color, opacity);
    const half = s / 2;
    _mangaBgTriUp(ctx, 0, 0, half);
    _mangaBgTriDown(ctx, half, 0, half);
    _mangaBgTriDown(ctx, 0, half, half);
    _mangaBgTriUp(ctx, half, half, half);
}
// 麻の葉: 六角形グリッド（pointy-top）の各中心から6頂点への放射線を、行ごとに半分ずらして
// 配置する。タイル幅=六角形の水平間隔・高さ=垂直間隔の2段分にすることで境界をまたいでも
// 六角格子が連続する。
function _mangaBgHexStar(ctx, cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const ang = (Math.PI / 180) * (60 * i - 90);
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + r * Math.cos(ang), cy + r * Math.sin(ang));
    }
    ctx.stroke();
}
function _mangaBgDrawAsanoha(ctx, tileW, tileH, r, color, opacity) {
    ctx.strokeStyle = _mangaBgRgba(color, opacity);
    ctx.lineWidth = Math.max(1, r * 0.12);
    ctx.lineJoin = 'round';
    const horiz = r * Math.sqrt(3);
    const vert = r * 1.5;
    for (let row = -1; row <= 2; row++) {
        const cy = row * vert;
        const xOffset = (((row % 2) + 2) % 2 !== 0) ? horiz / 2 : 0;
        for (let col = -1; col <= Math.ceil(tileW / horiz) + 1; col++) {
            _mangaBgHexStar(ctx, col * horiz + xOffset, cy, r);
        }
    }
}

// パターンID→タイルcanvas。asanohaのみ非正方形（六角格子の自然な繰り返し単位）
function _mangaBgBuildTileCanvas(patternId, options) {
    const scalePx = Math.max(4, options.scale || 30);
    const color = options.color || '#000000';
    const opacity = options.opacity ?? 0.6;
    const canvas = document.createElement('canvas');

    if (patternId === 'asanoha') {
        const r = scalePx * 0.6;
        canvas.width = Math.max(2, Math.round(r * Math.sqrt(3)));
        canvas.height = Math.max(2, Math.round(r * 3));
        const ctx = canvas.getContext('2d');
        _mangaBgDrawAsanoha(ctx, canvas.width, canvas.height, r, color, opacity);
        return canvas;
    }

    const s = Math.max(2, Math.round(scalePx));
    canvas.width = s;
    canvas.height = s;
    const ctx = canvas.getContext('2d');
    switch (patternId) {
        case 'stripe-h':  _mangaBgDrawStripeH(ctx, s, color, opacity); break;
        case 'stripe-v':  _mangaBgDrawStripeV(ctx, s, color, opacity); break;
        case 'stripe-d':  _mangaBgDrawStripeD(ctx, s, color, opacity); break;
        case 'dot':       _mangaBgDrawDot(ctx, s, color, opacity); break;
        case 'check':     _mangaBgDrawCheck(ctx, s, color, opacity); break;
        case 'ichimatsu': _mangaBgDrawIchimatsu(ctx, s, color, options.bgColor || '#ffffff', opacity); break;
        case 'shippou':   _mangaBgDrawShippou(ctx, s, color, opacity); break;
        case 'uroko':     _mangaBgDrawUroko(ctx, s, color, opacity); break;
    }
    return canvas;
}

// ── カスタムSVGタイル（ComfyUI-Workflow-Studio settings-tab.js の色置換ロジックを移植） ──

function _mangaBgRecolorSvgString(svgStr, color) {
    if (!color) return svgStr;
    let out = svgStr
        .replace(/fill="(?!none)[^"]*"/gi, `fill="${color}"`)
        .replace(/stroke="(?!none)[^"]*"/gi, `stroke="${color}"`)
        .replace(/fill:\s*(?!none)[^;"]+/gi, `fill:${color}`)
        .replace(/stroke:\s*(?!none)[^;"]+/gi, `stroke:${color}`);
    const styleBlock = `<style>*:not([fill="none"]){fill:${color}!important}*:not([stroke="none"])[stroke]{stroke:${color}!important}</style>`;
    return out.replace(/<svg([^>]*)>/i, `<svg$1>${styleBlock}`);
}

function _mangaBgLoadSvgImage(svgStr) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = `data:image/svg+xml,${encodeURIComponent(svgStr)}`;
    });
}

// 幅・高さを個別指定できるため、横長ロゴなど正方形でない画像もアスペクト比を保たず
// 意図通りのサイズでタイリングできる
async function _mangaBgBuildSvgTileCanvas(options) {
    const w = Math.max(4, Math.round(options.svgWidth || options.scale || 60));
    const h = Math.max(4, Math.round(options.svgHeight || options.scale || 60));
    const gap = Math.max(0, Math.round(options.gap || 0));
    const tileW = w + gap;
    const tileH = h + gap;
    const svgStr = _mangaBgRecolorSvgString(options.svgData, options.color);
    const img = await _mangaBgLoadSvgImage(svgStr);
    const canvas = document.createElement('canvas');
    canvas.width = tileW;
    canvas.height = tileH;
    const ctx = canvas.getContext('2d');
    ctx.globalAlpha = options.opacity ?? 1;
    ctx.drawImage(img, gap / 2, gap / 2, w, h);
    ctx.globalAlpha = 1;
    return canvas;
}

// タイルをcreatePatternでregion全体（width×height）に敷き詰める。
// パターンは無限に繰り返される平面なので、境界の継ぎ目を気にせずpattern.setTransformで
// そのまま回転できる（タイル自体の描画ロジックを変える必要がない）
async function _mangaBgRenderPatternToCanvas(ctx, width, height, options) {
    if (options.patternId === 'none') return;
    const tileCanvas = (options.patternId === 'svg' && options.svgData)
        ? await _mangaBgBuildSvgTileCanvas(options)
        : _mangaBgBuildTileCanvas(options.patternId, options);
    const pattern = ctx.createPattern(tileCanvas, 'repeat');
    if (!pattern) return;
    const rotation = options.rotation || 0;
    if (rotation && typeof pattern.setTransform === 'function' && typeof DOMMatrix !== 'undefined') {
        pattern.setTransform(new DOMMatrix().rotate(rotation));
    }
    ctx.save();
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
}

// パターン選択グリッドのサムネイル（60x60固定、見本色で生成）
function _mangaBgPatternPreviewDataUrl(patternId) {
    const s = 60;
    const canvas = document.createElement('canvas');
    canvas.width = s;
    canvas.height = s;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, s, s);
    if (patternId === 'svg') {
        ctx.strokeStyle = '#8cb4ff';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        ctx.strokeRect(10, 10, 40, 40);
        ctx.setLineDash([]);
        ctx.fillStyle = '#8cb4ff';
        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('+', 30, 32);
        return canvas.toDataURL('image/png');
    }
    const tile = _mangaBgBuildTileCanvas(patternId, { color: '#8cb4ff', bgColor: '#2a2a44', opacity: 0.9, scale: 18 });
    const pattern = ctx.createPattern(tile, 'repeat');
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, s, s);
    return canvas.toDataURL('image/png');
}

// ============================================================
// 背景パターンモーダル（「マンガ」サブタブメニュー「🎴 背景パターン」ボタンから起動）
// 選択中のコマ/オーバーレイのサイズにジャストフィットする透過オブジェクトとして
// パターンを新規生成し挿入する。対象領域決定・プレビュー背景ガイド・挿入処理は
// マンガ効果モーダル（15b-manga-tone.js）と共通のヘルパーを再利用している。
// ============================================================

function initMangaBgPatternButton() {
    document.getElementById('manga-bgpattern-open-btn')?.addEventListener('click', mangaBgPatternOpen);
}

async function mangaBgPatternOpen() {
    const region = _mangaGetTargetRegion();
    if (!region) {
        alert(t('layout.msgSelectPanelForImage'));
        return;
    }
    const backdropImg = await _mangaGetRegionBackdropImage(region);
    const options = _mangaBgPatternDefaultOptions();

    const overlay = document.createElement('div');
    overlay.className = 'tsm-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'tsm-dialog';
    dialog.style.width = '980px';
    dialog.style.height = '780px';
    dialog.innerHTML = `
        <div class="tsm-header">
            <h3>${t('layout.mangaBgPatternMenuBtn')}</h3>
            <button type="button" id="bp-close-btn" class="tsm-close-btn" title="${t('common.close')}">×</button>
        </div>
        <div class="tsm-body" style="display:flex; gap:12px; padding:12px; min-height:0;">
            <div style="flex:1; min-width:0; min-height:0; display:flex; flex-direction:column; gap:6px;">
                <span style="font-size:12px; white-space:nowrap;"><span>${t('layout.maskTargetLabel')}</span> <span style="color:var(--text-secondary);">${_mangaTargetRegionLabel(region)}</span></span>
                <div class="seg-group" id="bp-preview-bg-group" style="align-self:flex-start; flex-shrink:0;">
                    <button type="button" class="seg-btn" id="bp-preview-bg-image-btn" style="display:none;">${t('layout.mangaPreviewBgImage')}</button>
                    <button type="button" class="seg-btn" id="bp-preview-bg-default-btn">${t('layout.mangaPreviewBgDefault')}</button>
                    <button type="button" class="seg-btn" id="bp-preview-bg-white-btn">${t('common.white')}</button>
                </div>
                <div id="bp-preview-wrap" style="flex:1; min-height:0; display:flex; align-items:center; justify-content:center; background:#1a1a1a; border-radius:4px; overflow:hidden;">
                    <canvas id="bp-preview-canvas"></canvas>
                </div>
            </div>
            <div style="width:280px; flex-shrink:0; min-height:0; display:flex; flex-direction:column;">
                <div id="bp-params-scroll" style="flex:1; min-height:0; overflow-y:auto; overflow-x:hidden; display:flex; flex-direction:column; gap:8px; padding-right:4px; box-sizing:border-box; font-size:12px;">
                    <div id="bp-pattern-grid" style="display:grid; grid-template-columns: repeat(3, 1fr); gap:6px;">
                        ${BG_PATTERN_TYPES.map(p => `
                            <div class="bp-pattern-item" data-pattern-id="${p.id}" style="aspect-ratio:1; border-radius:4px; cursor:pointer; border:2px solid transparent; overflow:hidden; position:relative; background:url('${_mangaBgPatternPreviewDataUrl(p.id)}') center/cover;" title="${t(p.key)}">
                                <span style="position:absolute; bottom:0; left:0; right:0; font-size:10px; text-align:center; background:rgba(0,0,0,0.6); color:#fff; padding:1px 0;">${t(p.key)}</span>
                            </div>
                        `).join('')}
                    </div>
                    <input type="file" id="bp-svg-upload" accept=".svg" style="display:none;">
                    <div id="bp-svg-name" style="font-size:11px; color:var(--text-secondary); display:none;"></div>

                    <hr class="fontmgr-divider" />
                    <label style="display:block;"><input type="checkbox" id="bp-transparent-bg" checked /> ${t('layout.bgPatternTransparentBg')}</label>
                    <label style="display:flex; align-items:center; gap:6px;">${t('layout.bgPatternColorLabel')} <input type="color" id="bp-color" value="${options.color}" /></label>
                    <label id="bp-bgcolor-row" style="display:none; align-items:center; gap:6px;">${t('layout.bgPatternBgColorLabel')} <input type="color" id="bp-bgcolor" value="${options.bgColor}" /></label>
                    <label style="display:block;">${t('layout.bgPatternOpacityLabel')} <span id="bp-opacity-val">${Math.round(options.opacity * 100)}%</span>
                        <input type="range" id="bp-opacity" min="0.05" max="1" step="0.05" value="${options.opacity}" style="width:100%; box-sizing:border-box;" />
                    </label>
                    <label id="bp-scale-row" style="display:block;">${t('layout.bgPatternScaleLabel')} <span id="bp-scale-val">${options.scale}px</span>
                        <input type="range" id="bp-scale" min="8" max="120" step="2" value="${options.scale}" style="width:100%; box-sizing:border-box;" />
                    </label>
                    <div id="bp-svg-size-row" style="display:none; flex-direction:column; gap:8px;">
                        <label style="display:block;">${t('layout.bgPatternWidthLabel')} <span id="bp-svg-w-val">${options.svgWidth}px</span>
                            <input type="range" id="bp-svg-w" min="8" max="300" step="2" value="${options.svgWidth}" style="width:100%; box-sizing:border-box;" />
                        </label>
                        <label style="display:block;">${t('layout.bgPatternHeightLabel')} <span id="bp-svg-h-val">${options.svgHeight}px</span>
                            <input type="range" id="bp-svg-h" min="8" max="300" step="2" value="${options.svgHeight}" style="width:100%; box-sizing:border-box;" />
                        </label>
                    </div>
                    <label id="bp-gap-row" style="display:none;">${t('layout.bgPatternGapLabel')} <span id="bp-gap-val">0px</span>
                        <input type="range" id="bp-gap" min="0" max="60" step="2" value="0" style="width:100%; box-sizing:border-box;" />
                    </label>
                    <label style="display:block;">${t('layout.bgPatternRotationLabel')} <span id="bp-rotation-val">${options.rotation}°</span>
                        <input type="range" id="bp-rotation" min="0" max="360" step="5" value="${options.rotation}" style="width:100%; box-sizing:border-box;" />
                    </label>
                </div>
            </div>
        </div>
        <div class="tsm-footer">
            <span id="bp-status" style="flex:1; font-size:11px; color:var(--text-secondary);"></span>
            <button type="button" id="bp-cancel-btn" class="btn secondary">${t('common.cancel')}</button>
            <button type="button" id="bp-apply-btn" class="btn primary">${t('common.apply')}</button>
        </div>
    `;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const $ = id => dialog.querySelector('#' + id);
    const previewCanvas = $('bp-preview-canvas');
    const previewWrap = $('bp-preview-wrap');
    // 'image'（選択画像/コマ内の既存画像を背景に）| 'default'（チェッカーボード）| 'white'（強制白）
    let previewBgMode = backdropImg ? 'image' : 'default';

    let rafId = null;
    function scheduleRender() {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(renderPreview);
    }
    function readOptionsFromUI() {
        options.color = $('bp-color').value;
        options.bgColor = $('bp-bgcolor').value;
        options.opacity = parseFloat($('bp-opacity').value);
        options.scale = parseFloat($('bp-scale').value);
        options.svgWidth = parseFloat($('bp-svg-w').value);
        options.svgHeight = parseFloat($('bp-svg-h').value);
        options.gap = parseFloat($('bp-gap').value);
        options.rotation = parseFloat($('bp-rotation').value) || 0;
        options.transparentBackground = $('bp-transparent-bg').checked;
    }
    function updatePatternUI() {
        const isSvg = options.patternId === 'svg';
        $('bp-bgcolor-row').style.display = options.patternId === 'ichimatsu' ? 'flex' : 'none';
        $('bp-gap-row').style.display = isSvg ? 'block' : 'none';
        $('bp-scale-row').style.display = isSvg ? 'none' : 'block';
        $('bp-svg-size-row').style.display = isSvg ? 'flex' : 'none';
        dialog.querySelectorAll('.bp-pattern-item').forEach(i => {
            i.style.borderColor = (i.dataset.patternId === options.patternId) ? '#0077ff' : 'transparent';
        });
    }
    function updatePreviewBgButtons() {
        $('bp-preview-bg-image-btn').style.display = backdropImg ? '' : 'none';
        $('bp-preview-bg-image-btn').classList.toggle('active', previewBgMode === 'image');
        $('bp-preview-bg-default-btn').classList.toggle('active', previewBgMode === 'default');
        $('bp-preview-bg-white-btn').classList.toggle('active', previewBgMode === 'white');
    }
    // プレビューは常にプレビュー枠いっぱいにアスペクト比を保って拡大/縮小する（ハーフトーン/マンガ効果と同様）
    function previewTargetSize() {
        const maxW = Math.min(1200, Math.max(50, (previewWrap.clientWidth || _MANGA_PREVIEW_MAX_DIM) - 4));
        const maxH = Math.min(1200, Math.max(50, (previewWrap.clientHeight || _MANGA_PREVIEW_MAX_DIM) - 4));
        const scale = Math.min(maxW / region.width, maxH / region.height);
        return { w: Math.max(1, Math.round(region.width * scale)), h: Math.max(1, Math.round(region.height * scale)) };
    }
    async function renderPreview() {
        readOptionsFromUI();
        const { w, h } = previewTargetSize();
        previewCanvas.width = w;
        previewCanvas.height = h;
        const ctx = previewCanvas.getContext('2d');
        ctx.clearRect(0, 0, w, h);
        if (options.transparentBackground) {
            if (previewBgMode === 'image' && backdropImg) _mangaDrawBackdropCover(ctx, backdropImg, w, h);
            else if (previewBgMode === 'white') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
            else _mangaDrawCheckerboard(ctx, w, h);
        } else {
            ctx.fillStyle = previewBgMode === 'white' ? '#ffffff' : '#e8e8e8';
            ctx.fillRect(0, 0, w, h);
        }
        // scale/svgWidth/svgHeight/gapは400pxリファレンス基準の相対値。プレビュー（小さいcanvas）と
        // 適用（大きいcanvas）で見た目の密度を一致させるため、実際のcanvasサイズに比例させる（ハーフトーンと同じ手法）
        const sizeScale = Math.max(w, h) / _MANGA_SIZE_REFERENCE_DIM;
        await _mangaBgRenderPatternToCanvas(ctx, w, h, {
            ...options,
            scale: options.scale * sizeScale,
            svgWidth: options.svgWidth * sizeScale,
            svgHeight: options.svgHeight * sizeScale,
            gap: options.gap * sizeScale,
        });
    }

    dialog.querySelector('#bp-pattern-grid').addEventListener('click', e => {
        const item = e.target.closest('.bp-pattern-item');
        if (!item) return;
        const patternId = item.dataset.patternId;
        if (patternId === 'svg') {
            $('bp-svg-upload').click();
            return;
        }
        options.patternId = patternId;
        updatePatternUI();
        scheduleRender();
    });
    $('bp-svg-upload').addEventListener('change', e => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            options.svgData = ev.target.result;
            options.svgName = file.name;
            options.patternId = 'svg';
            $('bp-svg-name').textContent = `SVG: ${file.name}`;
            $('bp-svg-name').style.display = '';
            updatePatternUI();
            scheduleRender();
        };
        reader.readAsText(file);
        e.target.value = '';
    });

    $('bp-color').addEventListener('input', scheduleRender);
    $('bp-bgcolor').addEventListener('input', scheduleRender);
    $('bp-opacity').addEventListener('input', () => {
        $('bp-opacity-val').textContent = Math.round(parseFloat($('bp-opacity').value) * 100) + '%';
        scheduleRender();
    });
    $('bp-scale').addEventListener('input', () => {
        $('bp-scale-val').textContent = $('bp-scale').value + 'px';
        scheduleRender();
    });
    $('bp-svg-w').addEventListener('input', () => {
        $('bp-svg-w-val').textContent = $('bp-svg-w').value + 'px';
        scheduleRender();
    });
    $('bp-svg-h').addEventListener('input', () => {
        $('bp-svg-h-val').textContent = $('bp-svg-h').value + 'px';
        scheduleRender();
    });
    $('bp-gap').addEventListener('input', () => {
        $('bp-gap-val').textContent = $('bp-gap').value + 'px';
        scheduleRender();
    });
    $('bp-rotation').addEventListener('input', () => {
        $('bp-rotation-val').textContent = $('bp-rotation').value + '°';
        scheduleRender();
    });
    $('bp-transparent-bg').addEventListener('change', scheduleRender);

    $('bp-preview-bg-image-btn').addEventListener('click', () => { previewBgMode = 'image'; updatePreviewBgButtons(); scheduleRender(); });
    $('bp-preview-bg-default-btn').addEventListener('click', () => { previewBgMode = 'default'; updatePreviewBgButtons(); scheduleRender(); });
    $('bp-preview-bg-white-btn').addEventListener('click', () => { previewBgMode = 'white'; updatePreviewBgButtons(); scheduleRender(); });

    function close() {
        if (rafId) cancelAnimationFrame(rafId);
        overlay.remove();
    }
    $('bp-close-btn').addEventListener('click', close);
    $('bp-cancel-btn').addEventListener('click', close);
    $('bp-apply-btn').addEventListener('click', async () => {
        readOptionsFromUI();
        if (options.patternId === 'svg' && !options.svgData) {
            alert(t('layout.bgPatternSelectSvgBtn'));
            return;
        }
        const statusEl = $('bp-status');
        statusEl.textContent = t('layout.processing');
        $('bp-apply-btn').disabled = true;
        await new Promise(r => setTimeout(r, 0));
        try {
            const sz = _mangaCanvasSizeForRegion(region, _MANGA_HALFTONE_MAX_DIM);
            const canvas = document.createElement('canvas');
            canvas.width = sz.width;
            canvas.height = sz.height;
            const ctx = canvas.getContext('2d');
            if (!options.transparentBackground) {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, sz.width, sz.height);
            }
            const sizeScale = Math.max(sz.width, sz.height) / _MANGA_SIZE_REFERENCE_DIM;
            await _mangaBgRenderPatternToCanvas(ctx, sz.width, sz.height, {
                ...options,
                scale: options.scale * sizeScale,
                svgWidth: options.svgWidth * sizeScale,
                svgHeight: options.svgHeight * sizeScale,
                gap: options.gap * sizeScale,
            });
            await _mangaInsertGeneratedToRegion(canvas, region, {});
            close();
        } catch (e) {
            statusEl.textContent = '';
            alert(t('layout.mangaApplyError', e.message));
            $('bp-apply-btn').disabled = false;
        }
    });

    updatePatternUI();
    updatePreviewBgButtons();
    renderPreview();
}
