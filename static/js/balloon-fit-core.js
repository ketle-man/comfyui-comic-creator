// ============================================================
// フキダシ自動配置の寸法計算（DOM非依存）
//
// 1コマ分のセリフ群について、フキダシの中心・半径・文字サイズを決める。
// 半自動マンガ作成（main/26-auto-comic-bridge.js）とAutoタブのオートレイアウト転送
// （main/28b-auto-layout-tab.js）が、main/09g-balloon-autofit.js 経由で使う。
//
// planPanelBalloons(): セリフの文字量から必要なフキダシの大きさを逆算し、コマに収まる最大の
//   文字サイズ（フキダシ種別ごとの倍率×既定サイズが上限）を探す。配置は「横並び（読み順）」と
//   「縦積み（ジグザグ）」の両方を試し、文字を大きく保てる方を採用する。
// legacyPanelBalloons(): 従来方式（コマを上から均等分割、幅はコマの35%固定、文字サイズは
//   フキダシの高さだけで決める）。設定で自動調整をOFFにしたときに使う。
//
// 文字の折り返し・内接エリアの計算は main/09f-bubble-text.js の _bubbleTextWrapLines /
// _bubbleTextAreaFor / _bubbleTextRenderText と同じ規則に合わせてある（ここで逆算した大きさの
// フキダシに流し込んだとき、同じ折り返しで収まるようにするため）。あちらの規則を変えたら
// こちらも合わせること。
// ============================================================

export const PT_TO_SVG = 3.528; // 09f-bubble-text.js の BUBBLE_TEXT_PT_TO_SVG と同じ

// フキダシ形状ごとの文字サイズ倍率（叫び=大きく、ナレーション=小さく）
const SHAPE_FONT_SCALE = { bomb: 1.25, thought: 0.95, caption: 0.9 };

// 09f-bubble-text.js _bubbleTextAreaFor と同じ分類
const OVAL_SHAPES = new Set(['normal', 'thought', 'bomb', 'cloudpuffy', 'cloudwavy', 'textbox-oval']);
const ROUGH_SHAPES = new Set(['bomb', 'cloudpuffy', 'cloudwavy']);

// 1行（縦書きは1列）あたりの文字数の候補。短い行ほど細長いフキダシになる
const CHARS_PER_LINE = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 20, 24];

export function shapeFontScale(shapeType) {
    return SHAPE_FONT_SCALE[shapeType] || 1;
}

function textFactors(shapeType) {
    return { k: OVAL_SHAPES.has(shapeType) ? Math.SQRT2 : 1, safety: ROUGH_SHAPES.has(shapeType) ? 0.75 : 1 };
}

// 09f-bubble-text.js _bubbleTextWrapLines と同じ貪欲な1文字単位の折り返し（measureは横書き時の実測幅）
export function wrapLines(text, fontSvg, maxExtent, vertical, measure) {
    const lines = [];
    String(text ?? '').split('\n').forEach((para) => {
        if (para === '') { lines.push(''); return; }
        let line = '';
        for (const ch of para) {
            const test = line + ch;
            const extent = vertical ? test.length * fontSvg : measure(test, fontSvg);
            if (line && extent > maxExtent) {
                lines.push(line);
                line = ch;
            } else {
                line = test;
            }
        }
        lines.push(line);
    });
    const maxLineExtent = lines.reduce((m, l) => Math.max(m, vertical ? l.length * fontSvg : measure(l, fontSvg)), 0);
    return { lines, maxLineExtent };
}

// 文字サイズpt・1行の上限charsで折り返したとき、テキストが収まるフキダシの半径(rx, ry)。
// 09f側は hRange = rx*safety/k、折返し幅 = (hRange - padding)*2 なので、その逆算。
function balloonForText(text, pt, chars, shapeType, vertical, measure, lineHeightMult) {
    const fs = Math.round(pt * PT_TO_SVG);
    const pad = fs * 0.5;
    const lh = fs * lineHeightMult;
    const { k, safety } = textFactors(shapeType);
    const { lines, maxLineExtent } = wrapLines(text, fs, Math.max(fs, chars * fs), vertical, measure);
    const along = Math.max(maxLineExtent, fs);   // 1行（1列）の長さ
    const across = lines.length * lh;            // 行（列）を重ねた厚み
    const w = vertical ? across : along;
    const h = vertical ? along : across;
    // 1.02: 丸め誤差で09f側の折り返しが1行増えないための余裕
    return {
        rx: (k * (w / 2 + pad) / safety) * 1.02,
        ry: (k * (h / 2 + pad) / safety) * 1.02,
        lines: lines.length,
    };
}

// 枠(slotW×slotH)に収まる候補のうち、好みの縦横比に最も近いものを返す。無ければnull。
function bestFitting(text, pt, shapeType, vertical, measure, lhMult, slotW, slotH) {
    const prefAspect = vertical ? 0.8 : 1.6;     // 縦書き=やや縦長、横書き=横長のフキダシが自然
    let best = null;
    let bestScore = Infinity;
    let prevLines = -1;
    for (const chars of CHARS_PER_LINE) {
        const b = balloonForText(text, pt, chars, shapeType, vertical, measure, lhMult);
        if (b.lines === prevLines && best) continue; // 行数が変わらなければ同じ形
        prevLines = b.lines;
        if (b.rx * 2 > slotW || b.ry * 2 > slotH) continue;
        const score = Math.abs(Math.log((b.rx / b.ry) / prefAspect));
        if (score < bestScore) { best = b; bestScore = score; }
    }
    return best;
}

// 収まらないときの最善（枠からのはみ出し率が最小の候補）
function leastOverflow(text, pt, shapeType, vertical, measure, lhMult, slotW, slotH) {
    let best = null;
    let bestRatio = Infinity;
    for (const chars of CHARS_PER_LINE) {
        const b = balloonForText(text, pt, chars, shapeType, vertical, measure, lhMult);
        const ratio = Math.max((b.rx * 2) / slotW, (b.ry * 2) / slotH);
        if (ratio < bestRatio) { best = b; bestRatio = ratio; }
    }
    return best;
}

// 1つのフキダシを枠に収める。上限ptから少しずつ縮め、最小ptでも収まらなければ overflow。
function fitOne(item, slotW, slotH, o) {
    const desiredPt = o.maxFontPt * shapeFontScale(item.shapeType);
    const minPt = Math.min(desiredPt, o.minFontPt);
    // 上限から8%ずつ縮め、最後に最小ptちょうども試す
    const pts = [];
    for (let pt = desiredPt; pt > minPt; pt *= 0.92) pts.push(pt);
    pts.push(minPt);
    for (const pt of pts) {
        const b = bestFitting(item.text, pt, item.shapeType, o.vertical, o.measure, o.lineHeightMult, slotW, slotH);
        if (b) return { rx: b.rx, ry: b.ry, fontSizePt: Math.round(pt), ratio: pt / desiredPt, overflow: false };
    }
    const b = leastOverflow(item.text, minPt, item.shapeType, o.vertical, o.measure, o.lineHeightMult, slotW, slotH);
    return { rx: b.rx, ry: b.ry, fontSizePt: Math.round(minPt), ratio: minPt / desiredPt, overflow: true };
}

// 並べる方向の長さ(avail)を、各フキダシの自然な大きさ(needs)に比例して配分する。
// 全体が収まるなら各自の必要量を与え、余りは均等に足す。
function allocate(needs, avail) {
    const total = needs.reduce((s, v) => s + v, 0) || 1;
    if (total <= avail) {
        const extra = (avail - total) / needs.length;
        return needs.map((v) => v + extra);
    }
    return needs.map((v) => (avail * v) / total);
}

function planArrangement(items, inset, mode, o) {
    const n = items.length;
    const gap = inset.margin;
    // フキダシが絵を覆い尽くさないよう、並べない方向の大きさに上限を設ける
    const crossLimit = mode === 'row' ? inset.h * 0.6 : inset.w * 0.75;
    const axisLen = (mode === 'row' ? inset.w : inset.h) - gap * (n - 1);
    // 自然な大きさ: 上限ptで、並べない方向の上限だけを制約にしたときのフキダシ
    const needs = items.map((it) => {
        const pt = o.maxFontPt * shapeFontScale(it.shapeType);
        const b = mode === 'row'
            ? (bestFitting(it.text, pt, it.shapeType, o.vertical, o.measure, o.lineHeightMult, Infinity, crossLimit)
                || leastOverflow(it.text, pt, it.shapeType, o.vertical, o.measure, o.lineHeightMult, Infinity, crossLimit))
            : (bestFitting(it.text, pt, it.shapeType, o.vertical, o.measure, o.lineHeightMult, crossLimit, Infinity)
                || leastOverflow(it.text, pt, it.shapeType, o.vertical, o.measure, o.lineHeightMult, crossLimit, Infinity));
        return mode === 'row' ? b.rx * 2 : b.ry * 2;
    });
    const slots = allocate(needs, Math.max(1, axisLen));
    const fits = items.map((it, i) => (mode === 'row' ? fitOne(it, slots[i], crossLimit, o) : fitOne(it, crossLimit, slots[i], o)));

    // 配置: 読み始め側（rtl=右、ltr=左）から詰める。rowは上端揃え、colは上から積んで左右ジグザグ
    const startRight = o.readingOrder !== 'ltr';
    const placed = [];
    let cursor = 0;
    fits.forEach((f, i) => {
        let cx, cy;
        if (mode === 'row') {
            const len = f.rx * 2;
            cx = startRight ? inset.x + inset.w - cursor - len / 2 : inset.x + cursor + len / 2;
            cy = inset.y + f.ry;
            cursor += len + gap;
        } else {
            const len = f.ry * 2;
            cy = inset.y + cursor + len / 2;
            const right = (i % 2 === 0) === startRight;
            cx = right ? inset.x + inset.w - f.rx : inset.x + f.rx;
            cursor += len + gap;
        }
        placed.push({ cx, cy, rx: f.rx, ry: f.ry, fontSizePt: f.fontSizePt, overflow: f.overflow || cursor - gap > (mode === 'row' ? inset.w : inset.h) + 1 });
    });
    const minRatio = Math.min(...fits.map((f) => f.ratio));
    const overflowCount = placed.filter((p) => p.overflow).length;
    return { placed, minRatio, overflowCount };
}

/**
 * 1コマ分のフキダシ配置を計算する。
 * @param {{x:number,y:number,width:number,height:number}} bbox  コマの外接矩形
 * @param {Array<{text:string, shapeType:string}>} items         セリフ（空文字は呼び出し側で除外）
 * @param {object} opts
 *   maxFontPt       既定の文字サイズ（pt）。形状ごとの倍率を掛けた値が各フキダシの上限
 *   minFontPt       これ以上は縮めない（省略時は maxFontPt の45%、最低12pt）
 *   vertical        縦書きか
 *   readingOrder    'rtl'（既定）| 'ltr'
 *   measure(text, fontSizeSvg) 横書き時の文字列幅（canvas measureText 相当）
 *   lineHeightMult  行送り倍率（既定1.4、09f-bubble-text.jsの既定と同じ）
 * @returns {Array<{cx,cy,rx,ry,fontSizePt,overflow}>} items と同じ順
 */
export function planPanelBalloons(bbox, items, opts) {
    if (!items.length) return [];
    const o = {
        maxFontPt: opts.maxFontPt,
        minFontPt: opts.minFontPt || Math.max(12, Math.round(opts.maxFontPt * 0.45)),
        vertical: !!opts.vertical,
        readingOrder: opts.readingOrder || 'rtl',
        measure: opts.measure || ((s, fs) => s.length * fs),
        lineHeightMult: opts.lineHeightMult || 1.4,
    };
    const margin = Math.min(bbox.width, bbox.height) * 0.04;
    const inset = { x: bbox.x + margin, y: bbox.y + margin, w: bbox.width - margin * 2, h: bbox.height - margin * 2, margin };
    const row = planArrangement(items, inset, 'row', o);
    const col = planArrangement(items, inset, 'col', o);
    // はみ出しが少ない方 → 文字を大きく保てる方 → 同点なら書字方向に合う並び（縦書き=横並び）
    if (row.overflowCount !== col.overflowCount) return (row.overflowCount < col.overflowCount ? row : col).placed;
    if (Math.abs(row.minRatio - col.minRatio) > 0.01) return (row.minRatio > col.minRatio ? row : col).placed;
    return (o.vertical ? row : col).placed;
}

/** 従来方式（自動調整OFF）: コマを上から均等分割し、幅35%固定・文字サイズはフキダシの高さから決める */
export function legacyPanelBalloons(bbox, count, maxFontPt) {
    const slotHeight = bbox.height / count;
    const rx = bbox.width * 0.35;
    const ry = Math.min(slotHeight * 0.35, bbox.height * 0.2);
    const fontSizePt = Math.max(20, Math.min(maxFontPt, Math.round((ry * 0.55) / PT_TO_SVG)));
    return Array.from({ length: count }, (_, i) => ({
        cx: bbox.x + bbox.width / 2,
        cy: bbox.y + slotHeight * (i + 0.5),
        rx, ry, fontSizePt, overflow: false,
    }));
}
