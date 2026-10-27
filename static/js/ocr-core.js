// ocr-core.js — OCRタブの純粋ロジック（DOM非依存）
// ・LightOnOCR-3 (Ollama) の出力 `![label](x1,y1,x2,y2) 本文`（0〜1000正規化）のパース
// ・汎用VLM（Ollama）のJSONレイアウト検出（panel/character/…）のパース
// ・検出結果（クラス付きbbox）をMOSS-Imageのレイアウト要素（object/panel/character/text）へ変換
// 座標はすべて 0〜1 の正規化値（左上原点）で持つ。

export const OCR_MODEL_DEFAULT = 'maternion/LightOnOCR-3:4b';
export const LAYOUT_MODEL_DEFAULT = 'gemma4:e4b';

// 検出クラス。mossType は MOSS-Image のレイアウト要素種別（object/panel/character/text）。
// container=true は「中に文字が入る枠」で、OCRの文字bboxを取り込んで1つの文字枠にする。
export const OCR_CLASSES = {
    text:      { mossType: 'text',      color: '#4fd8ff', source: 'ocr' },
    balloon:   { mossType: 'text',      color: '#8be9fd', source: 'vlm', container: true, phrase: 'Speech bubble.' },
    sfx:       { mossType: 'text',      color: '#ff9f43', source: 'vlm', container: true, phrase: 'Sound effect lettering.' },
    caption:   { mossType: 'text',      color: '#a29bfe', source: 'vlm', container: true, phrase: 'Caption box.' },
    panel:     { mossType: 'panel',     color: '#ffc107', source: 'vlm' },
    character: { mossType: 'character', color: '#ff69b4', source: 'vlm' },
    face:      { mossType: 'character', color: '#ff8fc8', source: 'vlm', phrase: 'Face close-up.' },
    object:    { mossType: 'object',    color: '#4caf50', source: 'vlm' },
};
export const OCR_CLASS_KEYS = Object.keys(OCR_CLASSES);
export const VLM_CLASS_KEYS = OCR_CLASS_KEYS.filter(k => OCR_CLASSES[k].source === 'vlm');

// モデルが返すラベルの表記ゆれ → クラス
const LABEL_ALIASES = {
    text: 'text', title: 'text', paragraph: 'text', dialogue: 'text', dialog: 'text', line: 'text',
    balloon: 'balloon', bubble: 'balloon', speech_bubble: 'balloon', 'speech bubble': 'balloon', speech: 'balloon', thought_bubble: 'balloon',
    sfx: 'sfx', sound_effect: 'sfx', 'sound effect': 'sfx', onomatopoeia: 'sfx', effect_text: 'sfx',
    caption: 'caption', narration: 'caption', 'caption box': 'caption',
    panel: 'panel', frame: 'panel', koma: 'panel',
    character: 'character', person: 'character', figure: 'character', people: 'character', body: 'character',
    face: 'face', head: 'face',
    object: 'object', item: 'object', prop: 'object', image: 'object', picture: 'object', figure_image: 'object',
};
export function normalizeLabel(label) {
    const k = String(label || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
    return LABEL_ALIASES[k] || LABEL_ALIASES[k.replace(/_/g, ' ')] || null;
}

// ── プロンプト ──
// OCRモデルは「テキスト領域をbbox付きで出す」指示だけが安定して通る（ラベル指定は無視される）
export const OCR_PROMPT = 'Detect all text regions and output each as text with bounding box [x1,y1,x2,y2] normalized to 0-1000.';

const CLASS_HINT = {
    balloon: 'balloon (speech/thought bubble)',
    sfx: 'sfx (hand-lettered sound effect / onomatopoeia)',
    caption: 'caption (narration box)',
    panel: 'panel (comic frame)',
    character: 'character (whole person)',
    face: 'face',
    object: 'object (notable prop or item)',
};
export function buildLayoutPrompt(classes) {
    const list = classes.filter(c => CLASS_HINT[c]).map(c => CLASS_HINT[c]).join(', ');
    return `Detect every region of the following kinds in this image: ${list}. `
        + 'Reply with a JSON array only, no explanation. Each element: '
        + '{"label": <one of ' + classes.map(c => `"${c}"`).join('|') + '>, "box_2d": [ymin, xmin, ymax, xmax] normalized to 0-1000, '
        + '"caption": <very short English description, e.g. "A girl in a pink dress">}.';
}

// ── 座標 ──
const clamp01 = (v) => Math.min(1, Math.max(0, v));
function makeBox(cls, x1, y1, x2, y2, extra = {}) {
    const a = clamp01(Math.min(x1, x2)), b = clamp01(Math.min(y1, y2));
    const c = clamp01(Math.max(x1, x2)), d = clamp01(Math.max(y1, y2));
    if (c - a < 0.004 || d - b < 0.004) return null;
    return { cls, x1: a, y1: b, x2: c, y2: d, text: '', caption: '', ...extra };
}

/** LightOnOCR の出力 → ボックス配列。`![label](x1,y1,x2,y2) 本文` の繰り返し */
export function parseOcrOutput(raw) {
    const out = [];
    const chunks = String(raw || '').split(/(?=!\[[^\]]*\]\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\))/);
    for (const chunk of chunks) {
        const m = chunk.match(/^!\[([^\]]*)\]\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)([\s\S]*)$/);
        if (!m) continue;
        const label = (normalizeLabel(m[1]) || 'text');
        const body = m[6].replace(/^\s*#+\s*/, '').trim();
        const box = makeBox(label === 'object' ? 'object' : 'text', +m[2] / 1000, +m[3] / 1000, +m[4] / 1000, +m[5] / 1000,
            label === 'object' ? { caption: body, fromOcrImage: true } : { text: body });
        if (box) out.push(box);
    }
    return out;
}

/** 汎用VLMの出力（JSON配列、コードフェンス可）→ ボックス配列。box_2d は [y1,x1,y2,x2]、bbox_2d/bbox は [x1,y1,x2,y2] */
export function parseLayoutOutput(raw, imgW = 0, imgH = 0) {
    let text = String(raw || '').replace(/```(?:json)?/gi, '');
    const s = text.indexOf('['), e = text.lastIndexOf(']');
    let arr = null;
    if (s >= 0 && e > s) { try { arr = JSON.parse(text.slice(s, e + 1)); } catch (_) { arr = null; } }
    if (!Array.isArray(arr)) {
        // 途中で切れたJSON: 完結しているオブジェクトだけ拾う
        arr = [];
        for (const m of text.matchAll(/\{[^{}]*\}/g)) { try { arr.push(JSON.parse(m[0])); } catch (_) { /* skip */ } }
    }
    const out = [];
    for (const o of arr) {
        if (!o || typeof o !== 'object') continue;
        const cls = normalizeLabel(o.label || o.class || o.type);
        if (!cls || !OCR_CLASSES[cls]) continue;
        const yx = Array.isArray(o.box_2d);
        const v = o.box_2d || o.bbox_2d || o.bbox || o.box;
        if (!Array.isArray(v) || v.length !== 4 || v.some(n => !Number.isFinite(+n))) continue;
        let [a, b, c, d] = v.map(Number);
        // 1000超はピクセル座標とみなす
        const big = Math.max(a, b, c, d) > 1000;
        const dw = big && imgW > 0 ? imgW : 1000, dh = big && imgH > 0 ? imgH : 1000;
        const box = yx ? makeBox(cls, b / dw, a / dh, d / dw, c / dh) : makeBox(cls, a / dw, b / dh, c / dw, d / dh);
        if (!box) continue;
        box.caption = typeof o.caption === 'string' ? o.caption.trim() : '';
        if (typeof o.text === 'string') box.text = o.text.trim();
        out.push(box);
    }
    return out;
}

// ── 後処理 ──
const area = (b) => (b.x2 - b.x1) * (b.y2 - b.y1);
const center = (b) => ({ x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 });
const contains = (outer, p) => p.x >= outer.x1 && p.x <= outer.x2 && p.y >= outer.y1 && p.y <= outer.y2;
export function iou(a, b) {
    const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1), h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
    if (w <= 0 || h <= 0) return 0;
    const i = w * h;
    return i / (area(a) + area(b) - i);
}

/** OCR結果とVLM結果を1つのリストにまとめる。ページ全体を覆う画像枠・同クラスの重複枠を除く。読み順（上→下、同段は右→左）に並べる */
export function mergeDetections(ocrBoxes, vlmBoxes) {
    const all = [];
    for (const b of ocrBoxes) { if (b.fromOcrImage && area(b) > 0.85) continue; all.push({ ...b, src: 'ocr' }); }
    for (const b of vlmBoxes) all.push({ ...b, src: 'vlm' });
    const kept = [];
    for (const b of all.sort((p, q) => area(q) - area(p))) {
        // OCRのimage枠と、VLMのobject/panel/character枠が重なるときはVLM側を優先
        if (b.fromOcrImage && kept.some(k => k.src === 'vlm' && iou(k, b) > 0.5)) continue;
        if (kept.some(k => k.cls === b.cls && iou(k, b) > 0.8)) continue;
        kept.push(b);
    }
    return sortReading(kept).map((b, i) => ({ ...b, id: i + 1 }));
}

export function sortReading(list) {
    const band = 0.05;
    return [...list].sort((a, b) => (Math.abs(a.y1 - b.y1) < band ? b.x1 - a.x1 : a.y1 - b.y1));
}

const isCjk = (s) => /[぀-ヿ㐀-鿿ｦ-ﾟ]/.test(s);
// ── レイアウト／Imageタブのテキストへの取り込み ──
const TEXT_INSERT_CLASSES = new Set(['text', 'balloon', 'sfx', 'caption']);

/** 検出結果のうち本文を持つ枠を、読み順のテキスト取り込み用アイテムにする。座標は 0〜1 のまま。vertical は枠の形と文字から推定 */
export function toTextInsertItems(boxes, aspect = 1) {
    return sortReading(boxes.filter(b => TEXT_INSERT_CLASSES.has(b.cls) && String(b.text || '').trim()))
        .map(b => {
            const text = String(b.text).trim();
            return { text, x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2, vertical: guessVertical(b, text, aspect) };
        });
}

/** 文字の並び方向の長さ（em）。全角=1、半角=0.55 */
function lineEm(line) {
    let em = 0;
    for (const ch of line) em += /[ -~｡-ﾟ]/.test(ch) ? 0.55 : 1;
    return em;
}

/** 領域（w×h）に文章が収まるフォントサイズを返す（行間 1.2em。縦書きは行=列）。w,h と戻り値は同じ単位 */
export function fitFontSize(text, w, h, vertical) {
    const lines = String(text).split('\n');
    const n = lines.length, len = Math.max(0.5, ...lines.map(lineEm));
    const fs = vertical ? Math.min(w / (n * 1.2), h / len) : Math.min(w / len, h / (n * 1.2));
    return Math.max(1, fs);
}

/** 縦長で日本語ならば縦書きとみなす */
export function guessVertical(box, text, aspect) {
    const t = String(text || '').replace(/\s/g, '');
    if (!t || !isCjk(t) || [...t].length < 2) return false;
    return ((box.y2 - box.y1) / (box.x2 - box.x1)) * (1 / (aspect || 1)) > 1.4;
}

function positionPhrase(cx, cy) {
    const v = cy < 1 / 3 ? 'Top' : cy < 2 / 3 ? 'Middle' : 'Bottom';
    const h = cx < 1 / 3 ? 'left' : cx < 2 / 3 ? 'center' : 'right';
    return v === 'Middle' && h === 'center' ? 'Center' : `${v}-${h}`;
}

/**
 * 検出結果 → MOSS-Imageのレイアウト要素。座標は 0〜1 のまま返す（取り込み側がキャンバスサイズを掛ける）。
 * 要素: { type, caption, text, vertical, x1,y1,x2,y2 }
 * ・balloon/sfx/caption（container）に中心が入るOCR文字は、その枠の文字として1つにまとめる（枠は容器の輪郭）
 * ・文字を含まない container は破棄（MOSSは文字のない文字枠を送らないため）
 */
export function toMossItems(boxes, { aspect = 1, useContainers = true } = {}) {
    const containers = useContainers ? boxes.filter(b => OCR_CLASSES[b.cls]?.container) : [];
    const used = new Set();
    const out = [];
    const holderOf = (b) => {
        const c = center(b);
        return containers.filter(k => contains(k, c)).sort((p, q) => area(p) - area(q))[0] || null;
    };
    // 文字 → 容器ごとに集約（読み順）
    const bucket = new Map();
    for (const b of boxes.filter(b => b.cls === 'text')) {
        const h = holderOf(b);
        if (!h) continue;
        used.add(b.id);
        if (!bucket.has(h.id)) bucket.set(h.id, []);
        bucket.get(h.id).push(b);
    }
    for (const b of boxes) {
        const def = OCR_CLASSES[b.cls];
        if (!def) continue;
        if (def.container && useContainers) {
            const inside = sortReading(bucket.get(b.id) || []);
            const text = inside.map(i => i.text).filter(Boolean).join('\n') || b.text;
            if (!text) continue;
            out.push({
                type: 'text', text, vertical: guessVertical(b, text, aspect), x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2,
                caption: b.cls === 'sfx' && b.caption ? `${def.phrase} ${b.caption}` : def.phrase,
            });
            continue;
        }
        if (b.cls === 'text') {
            if (used.has(b.id) || !b.text) continue;
            out.push({
                type: 'text', text: b.text, vertical: guessVertical(b, b.text, aspect), x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2,
                caption: 'Narration text.',   // 短い文字（名前など）を擬音と誤るので文字数では判定しない。擬音は sfx クラスで扱う
            });
            continue;
        }
        if (def.container) {   // useContainers=false の容器は文字枠として単独で出す（文字があれば）
            if (b.text) out.push({ type: 'text', text: b.text, vertical: false, x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2, caption: def.phrase });
            continue;
        }
        const c = center(b);
        let caption = b.caption || def.phrase || '';
        if (b.cls === 'panel') caption = `${positionPhrase(c.x, c.y)} panel.${b.caption ? ` ${b.caption}` : ''}`;
        else if (b.cls === 'character' && !caption) caption = 'Character.';
        else if (b.cls === 'object' && !caption) caption = 'Object.';
        out.push({ type: def.mossType, text: '', vertical: false, caption, x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 });
    }
    return out;
}

/** 抽出した全文（読み順）。クリップボード・テキスト出力用 */
export function collectText(boxes) {
    return sortReading(boxes.filter(b => b.cls === 'text' || (OCR_CLASSES[b.cls]?.container && b.text)))
        .map(b => b.text).filter(Boolean).join('\n');
}

// ── 切り抜き再OCR ──
// OCRモデルで取った文字枠を元画像から切り抜き、別モデルで読み直す（日本語の縦書き・装飾文字の精度を上げる）。
// 実測（DEVLOG 2026-10-24）: マンガ特化のPaddleOCR-VLは縦書きの装飾文字に強く等倍が最良、LightOnOCRは極小の切り抜きだけ2倍で改善する。

/** 再OCRに向くモデルを一覧から選ぶ（マンガ特化 → PaddleOCR-VL → GLM-OCR の順）。無ければ '' */
export function pickRereadModel(names) {
    for (const re of [/paddleocr.*manga/i, /paddleocr/i, /glm-ocr/i]) {
        const hit = names.find(n => re.test(n));
        if (hit) return hit;
    }
    return '';
}

/** モデルごとのOCR指示文（PaddleOCR-VLは "OCR:"、GLM-OCRは "Text Recognition:"） */
export function rereadPrompt(model) {
    const m = String(model || '');
    if (/paddle/i.test(m)) return 'OCR:';
    if (/glm-ocr/i.test(m)) return 'Text Recognition:';
    return 'Extract all text from this image.';
}

export const UPSCALE_SHORT_SIDE = 96;   // LightOnOCRに渡す切り抜きの短辺がこれ未満なら2倍に拡大
/** 切り抜き(px)の拡大率。LightOnOCR系だけ極小のとき2倍、それ以外は等倍（マンガ特化版は拡大で悪化した） */
export function rereadScale(model, w, h) {
    return /lighton/i.test(String(model || '')) && Math.min(w, h) < UPSCALE_SHORT_SIDE ? 2 : 1;
}

/** 正規化bbox → 元画像の切り抜き矩形(px)。短辺の6%+4pxの余白を足す */
export function cropRect(box, imgW, imgH) {
    const bw = (box.x2 - box.x1) * imgW, bh = (box.y2 - box.y1) * imgH;
    const pad = Math.round(Math.min(bw, bh) * 0.06) + 4;
    const sx = Math.max(0, Math.floor(box.x1 * imgW - pad)), sy = Math.max(0, Math.floor(box.y1 * imgH - pad));
    const ex = Math.min(imgW, Math.ceil(box.x2 * imgW + pad)), ey = Math.min(imgH, Math.ceil(box.y2 * imgH + pad));
    return { sx, sy, sw: Math.max(1, ex - sx), sh: Math.max(1, ey - sy) };
}

// ── モード（用途別プリセット） ──
// ラジオ/ドロップダウンで選ぶと、個別設定（OCR・レイアウト検出・読み直し・判定・全体プロンプト・前処理）を一括で切り替える。
// null は「変更しない」。tile は縦長画像を分割して読む（モード専用の動作で個別設定は無い）。
export const OCR_MODES = ['auto', 'manga', 'cover', 'text', 'illustration', 'tall', 'custom'];
export const OCR_MODE_PRESETS = {
    manga:        { ocr: true,  layout: true,  classes: ['balloon', 'sfx', 'caption', 'panel', 'character', 'face'], merge: true, reread: true,  decide: true,  overall: true,  preprocess: 'none', tile: false },
    cover:        { ocr: true,  layout: false, classes: null, merge: null, reread: false, decide: false, overall: true,  chatte: true,  preprocess: 'none', tile: false },
    text:         { ocr: true,  layout: false, classes: null, merge: null, reread: false, decide: false, overall: false, chatte: true,  preprocess: 'none', tile: false },
    illustration: { ocr: false, layout: true,  classes: ['panel', 'character', 'face', 'object'], merge: null, reread: false, decide: false, overall: true,  chatte: false, preprocess: 'none', tile: false },
    tall:         { ocr: true,  layout: false, classes: null, merge: null, reread: false, decide: false, overall: false, preprocess: 'none', tile: true },
};

// 自動モード: 縦横比が極端なら縦長、それ以外は意思決定モデル（画像対応）に縮小画像を見せて種類を選ばせる
export const TALL_ASPECT = 2.5;       // 高さ/幅 がこれ以上なら縦長ページ
export const MODE_MIN_PROB = 0.4;     // 判定の確率がこれ未満なら manga にする
export const MODE_QUESTIONS = {
    page_type: { type: 'choice', instructions: 'What kind of image is this?',
        criteria: {
            manga: 'A manga or comic page with panels and speech balloons.',
            cover: 'A magazine cover, poster or flyer with large decorative titles and many text blocks over a photo or illustration.',
            text: 'A document, book page, sign or screenshot where text is the main content.',
            illustration: 'An illustration or photo with little or no text.',
        } },
};

/** 画像サイズからモードを決められるなら返す（縦長）。決められなければ null */
export function modeByAspect(w, h) {
    return w > 0 && h / w >= TALL_ASPECT ? 'tall' : null;
}

/** /v1/systemone の answers → { mode, p }。無効なら null */
export function parseModeAnswer(answers) {
    const c = answers?.page_type;
    if (!c?.choice || !OCR_MODE_PRESETS[c.choice]) return null;
    return { mode: c.choice, p: c.probabilities?.[c.choice] ?? 0 };
}

// ── 縦長画像の分割読み ──
export const TILE_RATIO = 1.4;       // タイルの高さ/幅（ページに近い縦横比）
export const TILE_OVERLAP = 0.12;    // タイル同士の重なり（文字が境界で切れるのを避ける）

/** 縦長画像を縦に分割する矩形（全幅、y0〜y1 px）。短ければ1枚 */
export function tileRects(w, h, ratio = TILE_RATIO, overlap = TILE_OVERLAP) {
    const tileH = Math.round(w * ratio);
    if (h <= tileH * 1.15) return [{ y0: 0, y1: h }];
    const step = Math.max(1, Math.round(tileH * (1 - overlap)));
    const out = [];
    for (let y0 = 0; ; y0 += step) {
        if (y0 + tileH >= h) { out.push({ y0: Math.max(0, h - tileH), y1: h }); break; }   // 最後は下端に合わせる
        out.push({ y0, y1: y0 + tileH });
    }
    return out;
}

/** タイル内の正規化座標 → 元画像全体の正規化座標（y のみ変わる） */
export function mapTileBoxes(boxes, y0, y1, H) {
    return boxes.map(b => ({ ...b, y1: (y0 + b.y1 * (y1 - y0)) / H, y2: (y0 + b.y2 * (y1 - y0)) / H }));
}

const sameText = (a, b) => !a || !b || a === b || a.includes(b) || b.includes(a);
/** 重なり部分で二重に読まれた枠を除く（面積の大きい＝境界で切れていないほうを残す） */
export function dedupeTileBoxes(boxes) {
    const kept = [];
    for (const b of [...boxes].sort((p, q) => area(q) - area(p))) {
        if (kept.some(k => k.cls === b.cls && ((iou(k, b) > 0.4 && sameText(k.text, b.text)) || iou(k, b) > 0.7))) continue;
        kept.push(b);
    }
    return kept;
}

// ── OCRの失敗検出（グレースケールでの再試行用） ──
// LightOnOCR は密な画像（雑誌の表紙など）でときどき何も返さない・同じ語を延々と繰り返す。実測（DEVLOG 2026-10-25）では、
// 失敗したカラー画像でもグレースケールにすると返ってくることがあった。コントラスト補正・repeat_penaltyは逆効果だったので使わない。
export const OCR_LOOP_MIN_BOXES = 30;    // 枠がこれ以上あり、かつ重複が多ければ繰り返しとみなす
export const OCR_LOOP_MAX_UNIQUE = 0.5;  // 文字の種類数 / 枠数 がこれ未満なら繰り返し

/** OCR結果（parseOcrOutput の戻り値）が失敗（空・繰り返し）に見えるか */
export function ocrLooksFailed(boxes) {
    const texts = (boxes || []).filter(b => b.cls === 'text').map(b => b.text);
    if (!texts.length) return true;
    return texts.length >= OCR_LOOP_MIN_BOXES && new Set(texts).size / texts.length < OCR_LOOP_MAX_UNIQUE;
}

// ── 全体プロンプト（VLM） ──
// 画像全体の説明を英語で作らせ、MOSS-Imageのプロンプト（レイアウト使用時はsummary）として送る
export const OVERALL_PROMPT = 'Describe this entire image in 2-3 English sentences as a summary for an image-generation prompt: '
    + 'the overall scene, art style (e.g. manga page, black-and-white or color), composition and mood. '
    + 'Do not transcribe any text or quote dialogue. Reply with the description only, no preface.';

/** VLMの返答を整える（コードフェンス・前置き・外側の引用符を除く） */
export function cleanOverall(raw) {
    let s = String(raw || '').replace(/```[a-z]*/gi, '').trim();
    s = s.replace(/^(?:here(?:'s| is)[^:\n]*:|summary:|description:)\s*/i, '').trim();
    s = s.replace(/^["'“「]+|["'”」]+$/g, '').trim();
    return s.replace(/\s*\n+\s*/g, ' ').slice(0, 1200);
}

// ── 意思決定モデルによる切り抜き判定（任意機能） ──
// 切り抜き画像に /v1/systemone で「文字があるか」「どの種類の文字枠か」を聞く（確率つき）。
// 実測（合成ページ、DEVLOG参照）: 文字の有無・クラス分類は d3:4b / clef-flash とも高精度。枠のずれ・切れの検出は弱いので使わない。
export const DECIDE_MIN_HAS = 0.3;   // VLMの容器枠で「文字がある」確率がこれ未満なら的外れな枠として除く
export const DECIDE_MIN_CLS = 0.6;   // クラスを書き換える最低確率（未満は元のクラスのまま）
export const DECIDE_QUESTIONS = {
    has_text: { type: 'noul', instructions: 'Does this image contain Japanese text characters?',
        criteria: { true: 'Japanese characters are visible.', false: 'No text, only background or artwork.' } },
    cls: { type: 'choice', instructions: 'What kind of text element is this?',
        criteria: {
            balloon: 'Text inside a speech bubble (white ellipse).',
            caption: 'Text inside a rectangular narration box.',
            sfx: 'Large stylized sound-effect lettering.',
            text: 'Plain text directly on the artwork with no frame.',
        } },
};

/** 意思決定モデルを一覧から選ぶ（clef-flash → d3 → 先頭）。無ければ '' */
export function pickDecisionModel(names) {
    for (const re of [/clef-flash/i, /^d3/i]) {
        const hit = names.find(n => re.test(n));
        if (hit) return hit;
    }
    return names[0] || '';
}

/** /v1/systemone の answers → { pHas, cls, pCls }。欠けていれば null */
export function parseDecision(answers) {
    const h = answers?.has_text, c = answers?.cls;
    if (!h || !c || typeof h.noul !== 'number' || !c.choice) return null;
    return { pHas: h.noul, cls: c.choice, pCls: c.probabilities?.[c.choice] ?? c.confidence ?? 0 };
}

/** 判定結果を枠へ反映する。戻り値: 'drop'（除く）| 'changed' | 'keep' */
export function applyDecision(box, d) {
    if (!d) return 'keep';
    const isContainer = !!OCR_CLASSES[box.cls]?.container;
    if (box.src === 'vlm' && isContainer && d.pHas < DECIDE_MIN_HAS) return 'drop';
    if (box.src === 'ocr' && box.cls === 'text' && d.cls !== box.cls && d.pCls >= DECIDE_MIN_CLS && OCR_CLASSES[d.cls]) {
        box.cls = d.cls;
        return 'changed';
    }
    return 'keep';
}

/** PaddleOCR-VL系は「…」「！」「？」を半角（...・!・?）で返すので、日本語を含む文字列だけ全角に戻す */
export function normalizeJaPunct(text) {
    const s = String(text || '').trim();
    if (!isCjk(s)) return s;
    return s.replace(/\.{2,}/g, '…').replace(/!/g, '！').replace(/\?/g, '？');
}

// ── Chat TE（Qwen3-VL）による全体読み ──
// 画像全体を1回で読む。位置は出せない（bboxは実測でずれ・繰り返しが出た）ので、OCRの枠に文字だけ突き合わせて置き換える。
// 実測（雑誌表紙4枚・正解52語、DEVLOG 2026-10-27）: Qwen3-VL-8B 44語 > Qwen3-VL-4B 38 > glm-ocr/Qwen2.5-VL-7B 約35 > LightOnOCR 0。
export const CHATTE_PROMPT = 'この画像に写っている日本語の文字をすべて書き起こしてください。縦書きの文字も忘れずに、見出し・小さな文字も含めて、'
    + '読み取れたテキストのみを1行ずつ出力してください。説明は不要です。';
export const CHATTE_MATCH_MIN = 0.4;     // 枠の文字と全体読みの1行の類似度（バイグラムDice）がこれ未満なら置き換えない
export const CHATTE_MAX_LEN_RATIO = 1.8; // 枠の文字より極端に長い行（複数枠をまとめて返した行）には置き換えない

/** Chat TE のテキストエンコーダー一覧からOCR向きを選ぶ（Qwen3-VL-8B → 4B → Qwen3.5 → 先頭）。無ければ '' */
export function pickChatTeModel(names) {
    for (const re of [/qwen3[-_]?vl.*8b/i, /qwen3[-_]?vl.*4b/i, /qwen3[-_.]?5/i]) {
        const hit = names.find(n => re.test(n));
        if (hit) return hit;
    }
    return names[0] || '';
}

/** Qwen3-VL-4B（tied embeddings）は thinking を切ると出力が崩れる。8B 等は切るほうが速く正確だった */
export function chatTeThinking(model) {
    return /4b/i.test(String(model || ''));
}

/** 返答 → 行の配列。思考ブロック・コードフェンスを除き、連続する同一行（繰り返し暴走）は1つにまとめる */
export function parseChatTeLines(raw) {
    const s = String(raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```[a-z]*/gi, '');
    const lines = [];
    for (const l of s.split(/\r?\n/)) {
        const t = l.trim();
        if (!t) continue;
        if (lines[lines.length - 1] === t) continue;
        lines.push(t);
    }
    return lines.slice(0, 400);
}

const ctNorm = (s) => String(s || '').replace(/[\s\u3000「」『』（）()\[\]【】、。,.・･!！?？…~〜\-ー―]/g, '').toLowerCase();
function bigrams(s) {
    const m = new Map();
    if (s.length === 1) { m.set(s, 1); return m; }
    for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); }
    return m;
}
/** 文字列の類似度 0〜1（バイグラムDice）。縦書きは枠の文字と行で改行位置が違っても比べられるよう、空白・記号を無視する */
export function textSimilarity(a, b) {
    const x = ctNorm(a), y = ctNorm(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    const gx = bigrams(x), gy = bigrams(y);
    let inter = 0, nx = 0, ny = 0;
    for (const v of gx.values()) nx += v;
    for (const v of gy.values()) ny += v;
    for (const [g, v] of gx) inter += Math.min(v, gy.get(g) || 0);
    return (2 * inter) / (nx + ny);
}

/**
 * 全体読みの行を、OCRで取った文字枠（cls==='text'）へ突き合わせて文字だけ置き換える（枠の位置・種類は変えない）。
 * 戻り値: { replaced: 置き換えた枠の数, unmatched: どの枠にも対応しなかった行 }
 */
export function applyChatTeLines(boxes, lines) {
    const used = new Set();
    let replaced = 0;
    for (const b of boxes) {
        if (b.cls !== 'text' || !b.text) continue;
        let best = -1, bestScore = 0;
        const bl = ctNorm(b.text).length;
        lines.forEach((l, i) => {
            const len = ctNorm(l).length;
            if (!len || len > Math.max(bl, 2) * CHATTE_MAX_LEN_RATIO) return;
            const sc = textSimilarity(b.text, l);
            if (sc > bestScore) { bestScore = sc; best = i; }
        });
        if (best < 0 || bestScore < CHATTE_MATCH_MIN) continue;
        used.add(best);
        if (lines[best] !== b.text) { b.textOrig = b.textOrig ?? b.text; b.text = lines[best]; replaced++; }
    }
    return { replaced, unmatched: lines.filter((_, i) => !used.has(i)) };
}
