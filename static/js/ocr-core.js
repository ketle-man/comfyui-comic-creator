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

const sfxLike = (text) => [...String(text || '').replace(/\s/g, '')].length <= 6;

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
                caption: sfxLike(b.text) ? 'Sound effect.' : 'Narration text.',
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
