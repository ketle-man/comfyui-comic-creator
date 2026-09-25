// ============================================================
// Autoタブ「オートレイアウト」サブタブの純ロジック（DOM非依存）
//
// 脚本（auto-story-core.js の script.pages[].panels[]、読み順どおりの配列）から、
// コマの矩形（正確には4頂点の四角形。'diagonal'スタイルでは非長方形になる）を
// 重要度按分＋順序保存の再帰二分割で生成する。
//
// 参考アプリ now_work/manga_panel の2機能（App.tsxの重要度按分＝縦1列のみ、
// presets.tsの再帰分割＝順序非保存の貪欲二分割）はどちらも単独では脚本の読み順を
// 保持できないため、「読み順を保ったまま重要度で面積按分する再帰二分割」に統合した
// （詳細はPLAN_auto_tab.md「オートレイアウト」節を参照）。
//
// 座標系: 生成過程は 0-100 のページ相対パーセント（vertices = [TL,TR,BR,BL]の4点）。
// px座標のpanel.points文字列への変換はこのモジュールの外（呼び出し側）で行う
// （既存 panel.points 形式 "x,y x,y x,y x,y" は auto-layout-core.js は関知しない）。
// ============================================================

export const IMPORTANCE_WEIGHT = { High: 3, Medium: 2, Low: 1 };
export const LAYOUT_STYLES = ['balanced', 'asymmetric', 'diagonal', 'vertical-strip', 'horizontal-strip'];
export const READING_ORDERS = ['rtl', 'ltr']; // rtl = 右から左（既定、伝統的な日本漫画の読み順）

// フキダシ種別（auto-story-core.js の BUBBLE_TYPES） → 既存フキダシ形状（21a-script-manga.js の
// 「フキダシ形状」列と同じ値。09c-balloon-handles.js createBalloonAtPosition() の type 引数）
const BUBBLE_SHAPE_MAP = { speech: 'normal', thought: 'thought', shout: 'bomb', narrator: 'caption' };
export function bubbleTypeToBalloonShape(bubbleType) {
    return BUBBLE_SHAPE_MAP[bubbleType] || 'normal';
}

function weightOf(panel) {
    return IMPORTANCE_WEIGHT[panel?.importance] || IMPORTANCE_WEIGHT.Medium;
}

// ============================================
// 幾何ヘルパー（vertices = [{x,y} TL, TR, BR, BL] の4頂点、0-100パーセント空間）
// ============================================

function lerpPt(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function fullQuad() {
    return [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
}

function quadBounds(quad) {
    const xs = quad.map(p => p.x), ys = quad.map(p => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

// 決定的な疑似乱数（同じseed文字列なら常に同じ値、-1..1）。再生成してもスクリプトが
// 同じなら同じレイアウトになるようにするため（Math.random()は使わない）。
function seededSignedRandom(seed) {
    let h = 0;
    const s = String(seed);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    const frac = ((h >>> 0) % 100000) / 100000;
    return frac * 2 - 1;
}

// quadを axis 方向に沿って ratio(0-1) の位置で2分割する。
// axis 'vertical'   = 縦線で分割（左右に分かれる） → 戻り値 [leftQuad, rightQuad]
// axis 'horizontal' = 横線で分割（上下に分かれる） → 戻り値 [topQuad, bottomQuad]
// skew（-1..1、'diagonal'スタイル用）を指定すると、分割線の始点/終点を辺に沿って
// 逆方向にずらし斜めの継ぎ目にする（manga_panel presets.tsの手法と同じ考え方）。
function splitQuad(quad, axis, ratio, skew = 0) {
    const [TL, TR, BR, BL] = quad;
    const r = Math.min(0.9, Math.max(0.1, ratio));
    const skewAmt = Math.max(-0.12, Math.min(0.12, skew));
    if (axis === 'vertical') {
        const rTop = Math.min(0.95, Math.max(0.05, r + skewAmt));
        const rBottom = Math.min(0.95, Math.max(0.05, r - skewAmt));
        const top = lerpPt(TL, TR, rTop);
        const bottom = lerpPt(BL, BR, rBottom);
        return [[TL, top, bottom, BL], [top, TR, BR, bottom]];
    }
    const rLeft = Math.min(0.95, Math.max(0.05, r + skewAmt));
    const rRight = Math.min(0.95, Math.max(0.05, r - skewAmt));
    const left = lerpPt(TL, BL, rLeft);
    const right = lerpPt(TR, BR, rRight);
    return [[TL, TR, right, left], [left, right, BR, BL]];
}

// ============================================
// 再帰分割本体
// ============================================

// group（脚本panels[]の連続する一部、読み順どおり）を1つのquadへ割り当てる。
// 戻り値: groupと同じ順序・同じ長さの vertices（quad）配列。
function splitGroup(group, quad, opts, depth, seedPrefix) {
    if (group.length <= 1) return [quad];

    const { style, readingOrder, pageAspect } = opts;
    let axis;
    if (style === 'vertical-strip') axis = 'horizontal';
    else if (style === 'horizontal-strip') axis = 'vertical';
    else {
        // quadは0-100%の正方形空間で扱っているため、実際のページのアスペクト比（pageAspect =
        // 実際の幅px/高さpx）を掛けて実寸換算した幅で比較しないと、縦長ページでも常に
        // 「幅>=高さ」寄りに判定されてしまう（%空間だけで見ると常に正方形に近いため）。
        const b = quadBounds(quad);
        axis = (b.width * pageAspect) >= b.height ? 'vertical' : 'horizontal';
    }

    const totalWeight = group.reduce((s, p) => s + weightOf(p), 0);
    let target = 0.5;
    if (style === 'asymmetric') target += seededSignedRandom(`${seedPrefix}:${depth}`) * 0.16;
    target = Math.min(0.85, Math.max(0.15, target));

    // group[0..k) の重み比が target に最も近くなる分割点 k を選ぶ（1..group.length-1）
    let k = 1, bestDiff = Infinity, cum = 0;
    for (let i = 0; i < group.length - 1; i++) {
        cum += weightOf(group[i]);
        const diff = Math.abs(cum / totalWeight - target);
        if (diff < bestDiff) { bestDiff = diff; k = i + 1; }
    }
    const ratio = group.slice(0, k).reduce((s, p) => s + weightOf(p), 0) / totalWeight;
    const skew = style === 'diagonal' ? seededSignedRandom(`${seedPrefix}:${depth}:skew`) * 0.1 : 0;

    const [quadA, quadB] = splitQuad(quad, axis, ratio, skew);
    // 読み順: 横方向の分割（axis='vertical'=左右に分かれる）のときだけ影響する。
    // rtl（右から左、既定）では読み順が先のグループ（group[0..k)）を右側のquadに割り当てる。
    // 縦方向の分割（axis='horizontal'=上下）は常に上から下（読み順は常に上→下）。
    const firstQuad = (axis === 'vertical' && readingOrder === 'rtl') ? quadB : quadA;
    const secondQuad = (axis === 'vertical' && readingOrder === 'rtl') ? quadA : quadB;

    return [
        ...splitGroup(group.slice(0, k), firstQuad, opts, depth + 1, seedPrefix),
        ...splitGroup(group.slice(k), secondQuad, opts, depth + 1, seedPrefix),
    ];
}

/**
 * 脚本の1ページ分のpanels[]（読み順どおり）から、重要度按分・順序保存の再帰二分割で
 * 各コマのquad（4頂点、0-100%空間）を生成する。
 * @param {Array<{importance?: string}>} panels
 * @param {{style?: string, readingOrder?: string, pageWidth?: number, pageHeight?: number}} [opts]
 *   pageWidth/pageHeightは軸（縦線/横線どちらで割るか）の判定にページの実アスペクト比を
 *   反映するためのもの（省略時は正方形=1:1として扱う）。
 * @param {string|number} [seed] 疑似乱数のseed（asymmetric/diagonalスタイル用。既定はページ内容から自動生成）
 * @returns {Array<Array<{x:number,y:number}>>} panelsと同じ順序・同じ長さのquad配列
 */
export function layoutPanels(panels, opts = {}, seed = 'auto-layout') {
    const list = Array.isArray(panels) ? panels : [];
    if (list.length === 0) return [];
    const style = LAYOUT_STYLES.includes(opts.style) ? opts.style : 'balanced';
    const readingOrder = READING_ORDERS.includes(opts.readingOrder) ? opts.readingOrder : 'rtl';
    const pageAspect = (opts.pageWidth > 0 && opts.pageHeight > 0) ? opts.pageWidth / opts.pageHeight : 1;
    return splitGroup(list, fullQuad(), { style, readingOrder, pageAspect }, 0, seed);
}

/**
 * 選択中の1コマ（quad）を、そのコマだけを対象に1回だけ二分割する（手動「分割」ツール用）。
 * @param {Array<{x:number,y:number}>} quad 対象コマの現在のquad
 * @param {{axis?: 'vertical'|'horizontal', ratio?: number}} [opts]
 * @returns {[Array<{x:number,y:number}>, Array<{x:number,y:number}>]}
 */
export function splitQuadManual(quad, opts = {}) {
    const b = quadBounds(quad);
    const axis = opts.axis === 'vertical' || opts.axis === 'horizontal' ? opts.axis : (b.width >= b.height ? 'vertical' : 'horizontal');
    const ratio = typeof opts.ratio === 'number' ? opts.ratio : 0.5;
    return splitQuad(quad, axis, ratio, 0);
}

// ============================================
// パーセント空間(0-100) → px座標のpanel.points文字列（"x,y x,y x,y x,y"、既存panel.points形式）
// ============================================

// 辺(pA→pB)の正規化方向ベクトル
function edgeDir(pA, pB) {
    const dx = pB.x - pA.x, dy = pB.y - pA.y;
    const len = Math.hypot(dx, dy) || 1;
    return { dx: dx / len, dy: dy / len };
}

// 時計回り（TL,TR,BR,BLの順、screen座標系）の四角形における、辺(pA→pB)の内向き法線（正規化済み）
function innerNormal(dir) {
    return { nx: -dir.dy, ny: dir.dx };
}

// 「通る点pN・方向ベクトルdN」で表した2本の直線の交点。ほぼ平行な場合はp1にフォールバックする
function lineIntersect(p1, d1, p2, d2) {
    const denom = d1.dx * d2.dy - d1.dy * d2.dx;
    if (Math.abs(denom) < 1e-9) return { x: p1.x, y: p1.y };
    const ex = p2.x - p1.x, ey = p2.y - p1.y;
    const t = (ex * d2.dy - ey * d2.dx) / denom;
    return { x: p1.x + d1.dx * t, y: p1.y + d1.dy * t };
}

/**
 * quad（0-100%空間）を「余白を除いたコマ配置領域」のpx座標へ変換し、panel.points互換の
 * 文字列にする。offsetX/offsetYを指定すると、その領域自体をページ上でその分だけ
 * 右・下へずらす（外側余白=ページ左上からコマ配置領域左上までのオフセットとして使う）。
 * gapPx指定時は、多角形オフセット（各辺をその内向き法線方向へ gapPx/2 だけ平行移動し、
 * 隣り合う辺同士の交点を新しい頂点とする）でコマ間の余白を作る。頂点ごとに重心方向へ
 * 動かす単純な方式（旧実装）だと、非対称・斜めスタイル等で共有辺の両端が異なる方向へ
 * 動いてしまい、本来まっすぐなはずの区切り線が斜めに歪んで見えることがあったため、
 * 辺単位のオフセットに変更した（区切り線は常に元の辺と平行になる）。
 * 辺の両端がコマ配置領域の外周（quadの0/100%、＝外側余白の境界）に乗っている場合は
 * その辺をオフセットしない（0のまま）。これによりgapPx（コマ間余白）はコマ同士が接する
 * 内部の共有辺にのみ効き、外側余白の値と独立に設定できる（外側余白と合わせたい場合の要件）。
 * @param {Array<{x:number,y:number}>} quad
 * @param {number} contentWidthPx コマ配置領域の幅（ページ幅から左右余白を引いたもの）
 * @param {number} contentHeightPx コマ配置領域の高さ（ページ高さから上下余白を引いたもの）
 * @param {number} [gapPx]
 * @param {number} [offsetX] コマ配置領域の左上のx座標（＝左余白）
 * @param {number} [offsetY] コマ配置領域の左上のy座標（＝上余白）
 * @returns {string}
 */
export function quadToPagePoints(quad, contentWidthPx, contentHeightPx, gapPx = 0, offsetX = 0, offsetY = 0) {
    const pxQuad = quad.map(p => ({ x: offsetX + (p.x / 100) * contentWidthPx, y: offsetY + (p.y / 100) * contentHeightPx }));
    if (!gapPx) return pxQuad.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');

    const inset = gapPx / 2;
    const n = pxQuad.length;
    const minX = offsetX, maxX = offsetX + contentWidthPx;
    const minY = offsetY, maxY = offsetY + contentHeightPx;
    const EPS = 1e-6;
    const onBoundary = (a, b) =>
        (a.x <= minX + EPS && b.x <= minX + EPS) ||
        (a.x >= maxX - EPS && b.x >= maxX - EPS) ||
        (a.y <= minY + EPS && b.y <= minY + EPS) ||
        (a.y >= maxY - EPS && b.y >= maxY - EPS);

    // 各辺を、外周に接していなければ内向き法線方向へinsetだけオフセットした「直線」として持つ
    const offsetLines = pxQuad.map((pA, i) => {
        const pB = pxQuad[(i + 1) % n];
        const dir = edgeDir(pA, pB);
        const d = onBoundary(pA, pB) ? 0 : inset;
        const { nx, ny } = innerNormal(dir);
        return { point: { x: pA.x + nx * d, y: pA.y + ny * d }, dir };
    });

    // 各頂点は、その頂点を挟む2辺（1つ前の辺と自身の辺）のオフセット直線同士の交点になる
    return pxQuad.map((_, i) => {
        const prev = offsetLines[(i - 1 + n) % n];
        const cur = offsetLines[i];
        const p = lineIntersect(prev.point, prev.dir, cur.point, cur.dir);
        return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
    }).join(' ');
}

/**
 * ページ全体のサイズと外側余白（上下左右）から、実際にコマを配置できる領域の
 * 幅・高さ・オフセット（左上座標）を求める。異常に大きい余白値（入力ミス等）が渡されても、
 * コマ配置領域が必ずページの内側（最低でも幅・高さの10%）に収まるよう、余白同士の比を
 * 保ったまま比例的に縮めてクランプする（offsetがページ外に出るとコマが画面外へ押し出され、
 * 何も表示されなくなる事故を防ぐ）。
 * @param {{pageWidth:number, pageHeight:number, marginTop?:number, marginBottom?:number, marginLeft?:number, marginRight?:number}} opts
 * @returns {{ width:number, height:number, offsetX:number, offsetY:number }}
 */
export function contentAreaFromMargins(opts) {
    const { pageWidth, pageHeight } = opts;
    let marginTop = Math.max(0, opts.marginTop || 0);
    let marginBottom = Math.max(0, opts.marginBottom || 0);
    let marginLeft = Math.max(0, opts.marginLeft || 0);
    let marginRight = Math.max(0, opts.marginRight || 0);

    const minContentW = Math.max(1, pageWidth * 0.1);
    const minContentH = Math.max(1, pageHeight * 0.1);
    const hSum = marginLeft + marginRight;
    if (hSum > pageWidth - minContentW) {
        const scale = Math.max(0, (pageWidth - minContentW) / hSum);
        marginLeft *= scale;
        marginRight *= scale;
    }
    const vSum = marginTop + marginBottom;
    if (vSum > pageHeight - minContentH) {
        const scale = Math.max(0, (pageHeight - minContentH) / vSum);
        marginTop *= scale;
        marginBottom *= scale;
    }

    return {
        width: Math.max(1, pageWidth - marginLeft - marginRight),
        height: Math.max(1, pageHeight - marginTop - marginBottom),
        offsetX: marginLeft,
        offsetY: marginTop,
    };
}

/**
 * 既に確定した quad配列（プレビューで表示・手動分割済みのものを含む）から、レイアウトタブの
 * ページレコードに直接使える panels[]（id・points）とそれに対応する svgContent
 * （06c-template-wizard.jsのテンプレートSVGと同じ骨格: 背景の白矩形、panel_0=外枠、
 * panel_1..N=各コマ）を組み立てる。ここではコマ割りの計算は一切行わない（layoutPanels()は
 * 呼ばない）。手動「分割」ツールでの編集結果をそのまま転送するために、生成のやり直しと
 * 分離してある。
 * @param {Array<Array<{x:number,y:number}>>} quads 0-100%空間の4頂点配列（読み順どおり）
 * @param {{pageWidth:number, pageHeight:number, marginTop?:number, marginBottom?:number, marginLeft?:number, marginRight?:number, gapPx?:number, strokeWidth?:number}} opts
 * @returns {{ panels: Array<{id:string, points:string, panelSvgContent:string}>, svgContent: string }}
 */
export function quadsToPageLayout(quads, opts) {
    const { pageWidth, pageHeight, gapPx = 24, strokeWidth = 60 } = opts;
    const content = contentAreaFromMargins(opts);

    const panels = (quads || []).map((quad, i) => ({
        id: `panel_${i + 1}`,
        points: quadToPagePoints(quad, content.width, content.height, gapPx, content.offsetX, content.offsetY),
        panelSvgContent: '',
    }));

    const parts = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pageWidth} ${pageHeight}">`);
    // 実際のテンプレート（06c-template-wizard.js経由で作成されたもの）と同じく、ページ全面を
    // 白で塗る背景矩形を先頭に置く。これが無いとコマ内が未描画（透明）のまま背景色が
    // キャンバスの色（黒）で透けて見えてしまう。
    parts.push(`  <rect x="0" y="0" width="${pageWidth}" height="${pageHeight}" fill="#ffffff"/>`);
    parts.push(`  <polygon id="panel_0" points="0,0 ${pageWidth},0 ${pageWidth},${pageHeight} 0,${pageHeight}" fill="none" stroke="#000" stroke-width="${strokeWidth}"/>`);
    panels.forEach(p => {
        parts.push(`  <polygon id="${p.id}" points="${p.points}" fill="none" stroke="#000" stroke-width="${strokeWidth}"/>`);
    });
    parts.push('</svg>');

    return { panels, svgContent: parts.join('\n') };
}

/**
 * 脚本の1ページ分のpanels[]から、重要度按分・順序保存の再帰二分割でコマ割りを新規生成し、
 * quadsToPageLayout()でページレコード用panels[]・svgContentに変換する。
 * @param {{panels: Array<{importance?:string}>}} scriptPage
 * @param {{pageWidth:number, pageHeight:number, marginTop?:number, marginBottom?:number, marginLeft?:number, marginRight?:number, style?:string, readingOrder?:string, gapPx?:number, strokeWidth?:number}} opts
 * @param {string|number} [seed]
 * @returns {{ panels: Array<{id:string, points:string, panelSvgContent:string}>, svgContent: string, quads: Array<Array<{x:number,y:number}>> }}
 */
export function buildPageLayout(scriptPage, opts, seed) {
    const { style, readingOrder } = opts;
    const content = contentAreaFromMargins(opts);
    const scriptPanels = Array.isArray(scriptPage?.panels) ? scriptPage.panels : [];
    const quads = layoutPanels(scriptPanels, { style, readingOrder, pageWidth: content.width, pageHeight: content.height }, seed);
    const { panels, svgContent } = quadsToPageLayout(quads, opts);
    return { panels, svgContent, quads };
}
