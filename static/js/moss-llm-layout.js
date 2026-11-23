// moss-llm-layout.js — MOSS-Image タブ「AIでレイアウト作成」
//
// 指示文（「雑誌の表紙」のような大まかなものから、「上部にタイトル、3段に顔とサブタイトルを交互、両脇に縦書き」の
// ような具体的なものまで）から、LLM にレイアウトエディタの枠（物体・キャラ・文字）と全体プロンプトを作らせ、エディタへ読み込む。
// ・AI エンジンは Auto タブと同じ（auto-ai-client.js）。Gemini は Nanobanana の API キーをサーバー経由で使う。
//   ローカルの接続先（バックエンド・URL）は Auto タブの設定を使い、エンジン・モデル・思考モードはこの欄で選ぶ（ccc_moss_ai_layout）
// ・サイズは「生成対象」のサイズ（エディタのキャンバス）をそのまま使う
// ・LLM の出力はそのまま使わず、必ず検証・補正する（normalizeLayout）。2026-11-23 の実測で効いた補正:
//   縦書きの枠を縦いっぱいに取ると MOSS が文字を繰り返し描き、ゴミ文字も混ざる → 長い方向だけ文字の量に合わせて詰める
//   （両方向を詰めるとタイトルが小さくなりすぎるので、短い方向＝字の大きさはそのまま）

import { t } from './i18n.js';
import {
    aiChat, loadAiSettings, validateAiSettings, fetchModels, fetchGeminiTextModels,
    getBackendDefaultUrl, getGeminiKeyStatus, stripThinkingTags, unloadModel,
} from './auto-ai-client.js';
import { getMossLayoutSnapshot, applyMossLayoutSnapshot, mossLayoutHasItems } from './moss.js';

const LS_KEY = 'ccc_moss_ai_layout';
const DEFAULT_GEMINI = 'gemini-3.5-flash';
const MAX_ITEMS = 30;
const TYPES = ['object', 'character', 'text'];

const $ = (id) => document.getElementById(id);

// ─── プロンプト ───
const SYSTEM_PROMPT = `You are a professional graphic layout designer. You design layouts for an image generator (MOSS-Image) that draws each element inside an axis-aligned bounding box.

Return ONLY a JSON object of this form:
{
  "prompt": "<English, 1-3 sentences: overall description of the whole image - medium, style, subject, mood, colors, background>",
  "items": [
    {"type": "object" | "character" | "text",
     "caption": "<English description of this element>",
     "text": "<exact characters to draw; only for type text, otherwise empty string>",
     "vertical": <true only for vertical (top-to-bottom) Japanese text, else false>,
     "x": <int>, "y": <int>, "w": <int>, "h": <int>}
  ]
}

Rules:
- Canvas is W x H pixels, origin at top-left. x,y is the top-left corner of the box. Every box must lie fully inside the canvas (0 <= x, x+w <= W, 0 <= y, y+h <= H) and have w,h > 0. Keep a margin of about 3% from the edges unless the element is a full-bleed background.
- type "character": a person, face, animal character. Caption describes appearance, pose, expression, framing (e.g. "Close-up of a smiling young woman's face, short black hair.").
- type "object": anything else that is drawn - products, props, scenery areas, decorative frames, panels/frames of a comic page. Do NOT add a full-canvas background box; describe the background in "prompt" instead.
- type "text": any written text. "text" must be the exact string to render. Keep the user's own wording exactly (do not translate). If the user did not give the wording, write short, natural, meaningful text in the same language as the user's request that fits the design. Never use placeholders such as "Subtitle 1", "Title", "Lorem ipsum" or "Text here". Never use real brand, magazine, company or product names or logos; invent original names. Use "\\n" for line breaks (for vertical text each line is one column, right to left). Caption describes typography and role (e.g. "Large bold magazine title logo, white letters with red outline.").
- Size text boxes to fit the text: horizontal text box ~ (characters x font size) wide and ~1.3 x font size tall; vertical text box ~1.3 x font size wide and ~(characters x font size) tall. Never stretch a text box far beyond its text. Titles big, small print small.
- Text boxes must not overlap each other. Text may overlap a picture area only when it is meant to be printed on top of it (like a magazine cover title over the photo).
- Follow every explicit instruction about position, count, order, alternation and writing direction literally. Left/right/top/bottom are as seen by the viewer.
- Use between 3 and 20 items. Order items in reading order (top to bottom).`;

// Ollama の構造化出力に渡すスキーマ（他のバックエンド・Gemini では JSON モードと検証で担保する）
const SCHEMA = {
    type: 'object',
    properties: {
        prompt: { type: 'string' },
        items: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    type: { type: 'string', enum: TYPES },
                    caption: { type: 'string' }, text: { type: 'string' }, vertical: { type: 'boolean' },
                    x: { type: 'integer' }, y: { type: 'integer' }, w: { type: 'integer' }, h: { type: 'integer' },
                },
                required: ['type', 'caption', 'text', 'vertical', 'x', 'y', 'w', 'h'],
            },
        },
    },
    required: ['prompt', 'items'],
};

// ─── 出力の検証・補正 ───
function parseJsonObject(text) {
    const s = stripThinkingTags(String(text || '')).replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    const start = s.indexOf('{'), end = s.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error(t('mossAi.badJson'));
    try { return JSON.parse(s.slice(start, end + 1)); } catch { throw new Error(t('mossAi.badJson')); }
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : NaN);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const charEm = (ch) => (/[ -~｡-ﾟ]/.test(ch) ? 0.55 : 1);   // moss.js の見積もりと同じ（半角≒0.55em）

/**
 * 文字枠の補正: 短い方向（縦書きは幅・横書きは高さ）から字の大きさを決め、長い方向が文字の必要量より
 * 大幅に長いとき（1.3 倍超）だけ 1.15 倍まで詰める（中心は保つ）。fontSize はエディタの見積もり（行間 1.2・余白 0.3em×2）に合わせる
 */
function fitTextBox(it) {
    const lines = it.text.split('\n');
    const rows = lines.length;
    if (it.vertical) {
        const fs = it.w / (rows * 1.3);
        const need = Math.max(...lines.map((l) => [...l].length)) * fs * 1.1;
        if (it.h > need * 1.3) {
            const cy = it.y + it.h / 2;
            it.h = Math.round(need * 1.15);
            it.y = Math.round(cy - it.h / 2);
        }
        it.fontSize = Math.round(clamp(it.w / (rows * 1.2 + 0.6), 8, 400));
    } else {
        const fs = it.h / (rows * 1.3);
        const need = Math.max(...lines.map((l) => [...l].reduce((n, ch) => n + charEm(ch), 0))) * fs * 1.1;
        if (it.w > need * 1.3) {
            const cx = it.x + it.w / 2;
            it.w = Math.round(need * 1.15);
            it.x = Math.round(cx - it.w / 2);
        }
        it.fontSize = Math.round(clamp(it.h / (rows * 1.2 + 0.6), 8, 400));
    }
}

/** LLM の出力 → エディタに読み込める { prompt, items }。不正な枠は捨て、はみ出しはキャンバス内へ戻す */
function normalizeLayout(data, W, H) {
    const src = Array.isArray(data?.items) ? data.items : [];
    const items = [];
    for (const raw of src) {
        if (items.length >= MAX_ITEMS) break;
        if (!raw || typeof raw !== 'object') continue;
        const type = TYPES.includes(raw.type) ? raw.type : 'object';
        let x = num(raw.x), y = num(raw.y), w = num(raw.w), h = num(raw.h);
        if (![x, y, w, h].every(Number.isFinite)) continue;
        if (w < 0) { x += w; w = -w; }
        if (h < 0) { y += h; h = -h; }
        w = Math.min(w, W); h = Math.min(h, H);
        if (w < 8 || h < 8) continue;
        const text = type === 'text' ? String(raw.text ?? '').replace(/\\n/g, '\n').trim() : '';
        if (type === 'text' && !text) continue;   // 空の文字枠は MOSS に送られず、紙のようなものが描かれる原因になる
        const it = {
            type, caption: String(raw.caption ?? '').trim().slice(0, 600), text,
            vertical: type === 'text' && raw.vertical === true,
            x, y, w, h,
        };
        if (type === 'text') fitTextBox(it);
        it.w = Math.round(Math.min(it.w, W)); it.h = Math.round(Math.min(it.h, H));
        it.x = Math.round(clamp(it.x, 0, W - it.w)); it.y = Math.round(clamp(it.y, 0, H - it.h));
        items.push(it);
    }
    return { prompt: String(data?.prompt ?? '').trim(), items };
}

// ─── 設定（エンジン・モデル） ───
function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch { return {}; }
}
function savePrefs(patch) {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ ...loadPrefs(), ...patch })); } catch { /* 保存できなくても動作は継続 */ }
}

/** aiChat に渡す設定（ローカルの接続先は Auto タブの設定、エンジン・モデル・思考はこの欄） */
function chatSettings() {
    const auto = loadAiSettings();
    const engine = $('moss-ai-engine')?.value || 'gemini';
    const model = $('moss-ai-model')?.value || '';
    return {
        ...auto,
        engine,
        geminiModel: engine === 'gemini' ? model : auto.geminiModel,
        model: engine === 'local' ? model : auto.model,
        thinkingMode: engine === 'local' && !!$('moss-ai-think')?.checked,
        maxTokens: 0,
        format: SCHEMA,
        numCtx: 16384,   // 思考オンだと既定の長さでは足りないことがある
    };
}

function setStatus(text, color) {
    const el = $('moss-ai-status');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = color || '';
}

async function loadModelList() {
    const sel = $('moss-ai-model');
    if (!sel) return;
    const engine = $('moss-ai-engine').value;
    const prefs = loadPrefs();
    $('moss-ai-think-field').style.display = engine === 'local' ? '' : 'none';
    $('moss-ai-local-note').style.display = engine === 'local' ? '' : 'none';
    sel.innerHTML = `<option value="">${t('mossAi.loadingModels')}</option>`;
    try {
        let list, want;
        if (engine === 'gemini') {
            if (!(await getGeminiKeyStatus()).hasKey) throw new Error(t('mossAi.noGeminiKey'));
            list = await fetchGeminiTextModels();
            want = prefs.geminiModel || (list.includes(DEFAULT_GEMINI) ? DEFAULT_GEMINI : list.find((m) => /flash/.test(m)) || list[0]);
        } else {
            const auto = loadAiSettings();
            const url = (auto.backendUrl || getBackendDefaultUrl(auto.backend)).replace(/\/+$/, '');
            list = await fetchModels(url, auto.backend);
            want = prefs.localModel || auto.model || list[0];
        }
        sel.replaceChildren(...list.map((m) => new Option(m, m)));
        if (list.includes(want)) sel.value = want;
        setStatus('');
    } catch (e) {
        sel.innerHTML = '';
        setStatus(t('mossAi.modelsFailed', e.message || String(e)), '#e66');
    }
}

// ─── 作成 ───
let _busy = false;

async function onCreate() {
    if (_busy) return;
    const instr = ($('moss-ai-instruction')?.value || '').trim();
    if (!instr) { setStatus(t('mossAi.noInstruction'), '#e0a040'); return; }
    const settings = chatSettings();
    const invalid = validateAiSettings(settings);
    if (invalid) { setStatus(t('mossAi.noModel'), '#e0a040'); return; }
    const cur = await getMossLayoutSnapshot();
    if (await mossLayoutHasItems() && !confirm(t('mossAi.confirmReplace'))) return;

    _busy = true;
    const btn = $('moss-ai-create-btn');
    if (btn) btn.disabled = true;
    const t0 = performance.now();
    const timer = setInterval(() => setStatus(t('mossAi.running', Math.round((performance.now() - t0) / 1000)), '#8cf'), 1000);
    setStatus(t('mossAi.running', 0), '#8cf');
    try {
        const messages = [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: `Canvas: ${cur.W} x ${cur.H} px.\nRequest: ${instr}` },
        ];
        const { content } = await aiChat(settings, messages, { json: true });
        const layout = normalizeLayout(parseJsonObject(content), cur.W, cur.H);
        if (!layout.items.length) throw new Error(t('mossAi.noItems'));
        await applyMossLayoutSnapshot({
            W: cur.W, H: cur.H, writingVertical: cur.writingVertical,
            items: layout.items, prompt: layout.prompt || cur.prompt,
        });
        setStatus(t('mossAi.done', layout.items.length, Math.round((performance.now() - t0) / 1000)), '#6c6');
        // ローカル LLM は VRAM を空けておく（続けて MOSS で生成すると VRAM が重なるため。失敗しても無視）
        if (settings.engine === 'local') {
            const url = (settings.backendUrl || getBackendDefaultUrl(settings.backend)).replace(/\/+$/, '');
            unloadModel(url, settings.backend, settings.model).catch(() => {});
        }
    } catch (e) {
        console.error('[mossAi]', e);
        setStatus(t('mossAi.failed', e.message || String(e)), '#e66');
    } finally {
        clearInterval(timer);
        _busy = false;
        if (btn) btn.disabled = false;
    }
}

function initMossLlmLayout() {
    const details = $('moss-ai-details');
    if (!details) return;
    const prefs = loadPrefs();
    const engineSel = $('moss-ai-engine');
    engineSel.value = prefs.engine === 'local' ? 'local' : 'gemini';   // 既定は Gemini（2026-11-23 の比較で品質・速さとも最良）
    $('moss-ai-think').checked = !!prefs.think;
    if (typeof prefs.instruction === 'string') $('moss-ai-instruction').value = prefs.instruction;

    let loaded = false;
    const ensureModels = () => { if (!loaded) { loaded = true; loadModelList(); } };
    details.addEventListener('toggle', () => { if (details.open) ensureModels(); });
    if (details.open) ensureModels();

    engineSel.addEventListener('change', () => { savePrefs({ engine: engineSel.value }); loadModelList(); });
    $('moss-ai-model').addEventListener('change', (e) => {
        savePrefs(engineSel.value === 'gemini' ? { geminiModel: e.target.value } : { localModel: e.target.value });
    });
    $('moss-ai-refresh-btn').addEventListener('click', () => loadModelList());
    $('moss-ai-think').addEventListener('change', (e) => savePrefs({ think: e.target.checked }));
    $('moss-ai-instruction').addEventListener('input', (e) => savePrefs({ instruction: e.target.value }));
    $('moss-ai-create-btn').addEventListener('click', () => onCreate());
}

// module スクリプトは DOM 構築後に実行される
initMossLlmLayout();

export { normalizeLayout, SYSTEM_PROMPT };
