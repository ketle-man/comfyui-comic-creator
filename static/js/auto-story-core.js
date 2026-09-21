// ============================================================
// Autoタブ（ストーリー・脚本）の純ロジック（DOM非依存）
//
// - LLMへ渡すプロンプト（ストーリー生成／ストーリーから脚本生成）の組み立て
// - LLM出力の頑健なパース（JSON抽出 → 行ベース復元の二段構え）と正規化
// - 脚本データ構造、サンプル、テキスト化（Chatの文脈用）
//
// 参考: now_work/manga_panel の脚本生成（parseOllamaScript / tryParseLineByLine）を、
// CCの脚本データ構造（ページ→コマ→複数セリフ）に合わせて作り直したもの。
//
// 脚本データ: { pages: [ { panels: [ { importance, action, dialogues: [ { character, text, bubbleType } ] } ] } ] }
//   ページ番号・コマ番号は配列の順序（1始まり）で表す（LLMが返す番号は順序の決定にだけ使う）。
// ============================================================

export const IMPORTANCE_LEVELS = ['High', 'Medium', 'Low'];
export const BUBBLE_TYPES = ['speech', 'thought', 'shout', 'narrator'];

// ============================================
// 脚本データの生成・正規化
// ============================================

export function blankDialogue() {
    return { character: '', text: '', bubbleType: 'speech' };
}

export function blankPanel() {
    return { importance: 'Medium', action: '', dialogues: [blankDialogue()] };
}

export function blankScript() {
    return { pages: [] };
}

function normalizeImportance(v) {
    const s = String(v ?? '').trim().toLowerCase();
    if (s === 'high' || s === 'h' || s.includes('高') || s.includes('大')) return 'High';
    if (s === 'low' || s === 'l' || s.includes('低') || s.includes('小')) return 'Low';
    return 'Medium';
}

function normalizeBubbleType(v) {
    const s = String(v ?? '').trim().toLowerCase();
    if (BUBBLE_TYPES.includes(s)) return s;
    if (s.includes('thought') || s.includes('心') || s.includes('思')) return 'thought';
    if (s.includes('shout') || s.includes('叫') || s.includes('効果音') || s.includes('sfx')) return 'shout';
    if (s.includes('narrat') || s.includes('ナレ') || s.includes('地の文')) return 'narrator';
    return 'speech';
}

function normalizeDialogues(raw, fallbackBubbleType) {
    let list = [];
    if (Array.isArray(raw.dialogues)) {
        list = raw.dialogues;
    } else if (typeof raw.dialogue === 'string' && raw.dialogue.trim()) {
        list = [{ text: raw.dialogue, bubbleType: fallbackBubbleType }];
    }
    const result = list
        .map((d) => {
            if (typeof d === 'string') return { character: '', text: d, bubbleType: normalizeBubbleType(fallbackBubbleType) };
            if (!d || typeof d !== 'object') return null;
            return {
                character: String(d.character ?? d.speaker ?? d.name ?? '').trim(),
                text: String(d.text ?? d.dialogue ?? d.line ?? '').trim(),
                bubbleType: normalizeBubbleType(d.bubbleType ?? d.type ?? d.style),
            };
        })
        .filter(Boolean);
    return result.length ? result : [blankDialogue()];
}

function normalizePanel(raw) {
    if (!raw || typeof raw !== 'object') return blankPanel();
    return {
        importance: normalizeImportance(raw.importance),
        action: String(raw.action ?? raw.description ?? raw.scene ?? '').trim(),
        dialogues: normalizeDialogues(raw, raw.bubbleType),
    };
}

// LLMが返し得る3形（ページ配列を持つオブジェクト／ページ配列／pageNum付きのフラットなコマ配列）を
// 統一形式へ変換する。解釈できなければ null。
export function normalizeScript(data) {
    if (!data || typeof data !== 'object') return null;
    let pagesRaw = null;
    if (Array.isArray(data.pages)) pagesRaw = data.pages;
    else if (Array.isArray(data)) pagesRaw = data;
    else if (Array.isArray(data.script)) pagesRaw = data.script;
    if (!pagesRaw || pagesRaw.length === 0) return null;

    const isNested = pagesRaw.some((p) => p && Array.isArray(p.panels ?? p.scenes));
    let pages;
    if (isNested) {
        pages = pagesRaw.map((p) => ({
            panels: (Array.isArray(p?.panels) ? p.panels : Array.isArray(p?.scenes) ? p.scenes : []).map(normalizePanel),
        }));
    } else {
        // フラット形式: pageNum（無ければ 1）ごとに束ねる。pageNum の昇順、同一ページ内は出現順。
        const byPage = new Map();
        pagesRaw.forEach((s) => {
            const n = Number(s?.pageNum ?? s?.page) || 1;
            if (!byPage.has(n)) byPage.set(n, []);
            byPage.get(n).push(normalizePanel(s));
        });
        pages = [...byPage.keys()].sort((a, b) => a - b).map((n) => ({ panels: byPage.get(n) }));
    }
    pages = pages.filter((p) => p.panels.length > 0);
    return pages.length ? { pages } : null;
}

// ============================================
// LLM出力のパース（二段構え）
// ============================================

function extractJsonText(raw) {
    const text = String(raw ?? '').trim();
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = fence ? fence[1].trim() : text;
    const candidates = [];
    const o1 = body.indexOf('{'), o2 = body.lastIndexOf('}');
    const a1 = body.indexOf('['), a2 = body.lastIndexOf(']');
    if (o1 !== -1 && o2 > o1) candidates.push(body.slice(o1, o2 + 1));
    if (a1 !== -1 && a2 > a1) candidates.push(body.slice(a1, a2 + 1));
    candidates.push(body);
    return candidates;
}

// JSONが崩れているときの緩い復元。「コマ」「action」「セリフ」等の行から組み立てる。
function parseScriptLines(raw) {
    const pages = [];
    let page = null;
    let panel = null;
    const startPage = () => { page = { panels: [] }; pages.push(page); panel = null; };
    const startPanel = () => { if (!page) startPage(); panel = blankPanel(); panel.dialogues = []; page.panels.push(panel); };

    String(raw ?? '').split(/\r?\n/).forEach((line) => {
        const s = line.replace(/^[\s\-*#>"',{[]+|[\s",}\]]+$/g, '').trim();
        if (!s) return;
        if (/^(第?\s*\d+\s*ページ|page\s*\d+)/i.test(s)) { startPage(); return; }
        if (/^(第?\s*\d+\s*コマ|コマ\s*\d+|scene\s*\d+|panel\s*\d+)/i.test(s)) { startPanel(); return; }
        const kv = s.match(/^["']?([A-Za-z_぀-ヿ一-鿿]+)["']?\s*[:：]\s*(.*)$/);
        if (!kv) return;
        const key = kv[1].toLowerCase();
        const val = kv[2].replace(/^["']|["']$/g, '').trim();
        if (!panel && /^(action|描写|演技|アクション|dialogue|セリフ|台詞|importance|重要度)/.test(key)) startPanel();
        if (!panel) return;
        if (/^(importance|重要度)/.test(key)) panel.importance = normalizeImportance(val);
        else if (/^(action|描写|演技|アクション)/.test(key)) panel.action = val;
        else if (/^(dialogue|セリフ|台詞)/.test(key)) panel.dialogues.push({ character: '', text: val, bubbleType: 'speech' });
        else if (/^(bubbletype|タイプ|種別)/.test(key) && panel.dialogues.length) panel.dialogues[panel.dialogues.length - 1].bubbleType = normalizeBubbleType(val);
        else if (/^(character|話者|キャラ)/.test(key) && panel.dialogues.length) panel.dialogues[panel.dialogues.length - 1].character = val;
    });
    for (const p of pages) {
        for (const pn of p.panels) if (pn.dialogues.length === 0) pn.dialogues.push(blankDialogue());
    }
    return normalizeScript({ pages: pages.filter((p) => p.panels.some((pn) => pn.action || pn.dialogues.some((d) => d.text))) });
}

// 戻り値: { script, method: 'json' | 'lines' } | null
export function parseScriptResponse(raw) {
    for (const text of extractJsonText(raw)) {
        try {
            const script = normalizeScript(JSON.parse(text));
            if (script) return { script, method: 'json' };
        } catch { /* 次の候補へ */ }
    }
    const script = parseScriptLines(raw);
    return script ? { script, method: 'lines' } : null;
}

// ============================================
// プロンプト
// ============================================

const STORY_SYSTEM = [
    'あなたはプロのマンガ原作者です。ユーザーのお題から、指定ページ数のマンガのストーリーを日本語で作ります。',
    '出力は次の見出しだけで構成し、前置きや挨拶は書かないでください。',
    '【タイトル】',
    '【登場人物】（名前・性格・見た目の特徴を1人1行）',
    '【あらすじ】（起承転結が分かる文章）',
    '【ページ配分】（各ページで何を描くかを1ページ1〜2行）',
].join('\n');

export function buildStoryMessages({ theme, pageCount }) {
    return [
        { role: 'system', content: STORY_SYSTEM },
        { role: 'user', content: `お題: ${theme}\n総ページ数: ${pageCount}ページ\nこのお題で、${pageCount}ページに収まるマンガのストーリーを作ってください。` },
    ];
}

const SCRIPT_SYSTEM = [
    'あなたはプロのマンガのネーム（コマ割りの脚本）作家です。与えられたストーリーを、ページとコマに分けた脚本にします。',
    '必ず次のJSON形式のみを返してください。挨拶や説明文、```json などの装飾は一切含めないでください。',
    '{"pages":[{"page":1,"panels":[{"importance":"High","action":"コマの背景描写やキャラクターの演技指示（日本語で簡潔に）","dialogues":[{"character":"話者名","text":"セリフ","bubbleType":"speech"}]}]}]}',
    '- importance は "High"（見せ場の大きなコマ）, "Medium"（標準）, "Low"（小さなつなぎコマ）のいずれか。',
    '- bubbleType は "speech"（通常）, "thought"（心の声）, "shout"（叫び・効果音）, "narrator"（ナレーション）のいずれか。',
    '- セリフの無いコマは "dialogues" を空配列にする。1コマに複数のセリフを入れてよい。',
    '- 1ページあたり3〜5コマを目安にする。',
].join('\n');

export function buildScriptMessages({ story, theme, pageCount }) {
    const lines = [];
    if (theme) lines.push(`お題: ${theme}`);
    lines.push(`総ページ数: ${pageCount}ページ（"page" は 1 から ${pageCount} まで）`);
    lines.push('ストーリー:', story);
    lines.push('', `このストーリーを、全${pageCount}ページの脚本のJSONにしてください。`);
    return [
        { role: 'system', content: SCRIPT_SYSTEM },
        { role: 'user', content: lines.join('\n') },
    ];
}

// ============================================
// テキスト化（Chatの文脈・コピー用）
// ============================================

export function scriptToText(script) {
    if (!script?.pages?.length) return '';
    return script.pages.map((page, pi) => {
        const head = `【${pi + 1}ページ】`;
        const body = page.panels.map((panel, ci) => {
            const lines = [`  コマ${ci + 1}（重要度: ${panel.importance}）`];
            if (panel.action) lines.push(`    描写: ${panel.action}`);
            panel.dialogues.filter((d) => d.text).forEach((d) => {
                lines.push(`    ${d.character ? d.character + ': ' : ''}「${d.text}」(${d.bubbleType})`);
            });
            return lines.join('\n');
        }).join('\n');
        return `${head}\n${body}`;
    }).join('\n');
}

// ============================================
// サンプル（LLM未接続でもフローを試せる）
// ============================================

export const SAMPLE_THEME = '宇宙飛行士になった柴犬が、月面探査で謎の宇宙骨（ほね）を見つけるコミカルな日常系。';

export const SAMPLE_STORY = [
    '【タイトル】',
    '月面のほね',
    '',
    '【登場人物】',
    'ポチ：宇宙飛行士の柴犬。真面目だが骨のこととなると我を忘れる。',
    '管制官ミケ：地球の管制室にいる猫。冷静でちょっと辛辣。',
    '',
    '【あらすじ】',
    '月面探査に来た柴犬宇宙飛行士ポチは、クレーターの底で巨大な骨のような岩を見つける。管制官ミケの制止も聞かず駆け寄り、夢中で掘り始めるが、それは骨ではなくただの白い岩だった。落ち込むポチだったが、掘った穴から本物の宇宙骨が顔を出す。',
    '',
    '【ページ配分】',
    '1ページ目：月面着陸、謎の骨型の岩の発見。',
    '2ページ目：掘り進めて岩と判明、落ち込み、そして本物の骨が出てくるオチ。',
].join('\n');

export const SAMPLE_SCRIPT = {
    pages: [
        {
            panels: [
                { importance: 'High', action: '荒涼とした月面に降り立つ柴犬の宇宙飛行士ポチ。遠景で地球が青く光っている。', dialogues: [{ character: 'ポチ', text: 'ここが月面か…小さな一歩だワン！', bubbleType: 'speech' }] },
                { importance: 'Medium', action: 'クレーターの底に、骨の形をした白い岩を見つけて目を見開くポチ。', dialogues: [{ character: 'ポチ', text: 'あれは…骨…？', bubbleType: 'thought' }] },
                { importance: 'Low', action: '管制室でモニターを見ながら呆れ顔の猫の管制官ミケ。', dialogues: [{ character: 'ミケ', text: 'ポチ、任務を思い出しなさい。', bubbleType: 'speech' }] },
                { importance: 'Medium', action: 'ヘルメット越しによだれを垂らして骨へ駆け出すポチ。', dialogues: [{ character: '', text: 'ダッ', bubbleType: 'shout' }] },
            ],
        },
        {
            panels: [
                { importance: 'Medium', action: '必死に月の砂を掘るポチ。砂が舞い上がる。', dialogues: [{ character: 'ポチ', text: '掘れワンワン！', bubbleType: 'speech' }] },
                { importance: 'High', action: 'ただの白い岩だと分かって崩れ落ちるポチ。背景に落ち込みの効果線。', dialogues: [{ character: 'ポチ', text: 'ただの岩じゃないか…', bubbleType: 'thought' }] },
                { importance: 'High', action: '掘った穴の奥から、本物の巨大な宇宙骨が輝きながら顔を出す。ポチのしっぽが跳ね上がる。', dialogues: [{ character: '', text: 'ゴゴゴゴ…', bubbleType: 'shout' }, { character: 'ミケ', text: '…あったのね。', bubbleType: 'narrator' }] },
            ],
        },
    ],
};

export function cloneSampleScript() {
    return JSON.parse(JSON.stringify(SAMPLE_SCRIPT));
}

// ============================================
// Chat（ストーリー・脚本の相談・編集）
// ============================================

const SCRIPT_JSON_SCHEMA = '{"pages":[{"page":1,"panels":[{"importance":"High","action":"背景描写・演技指示","dialogues":[{"character":"話者名","text":"セリフ","bubbleType":"speech"}]}]}]}';

// includeContext が true のとき、現在のお題・ストーリー・脚本をシステムプロンプトへ含める。
// 脚本はJSONで渡す（Chatが返した修正版をそのまま「脚本に反映」できるよう、往復で同じ形式を保つため）。
export function buildChatSystemMessage({ theme, pageCount, story, script, includeContext }) {
    const lines = [
        'あなたはマンガ制作を手伝うアシスタントです。ユーザーと相談しながら、ストーリーや脚本（ネーム）を作り、直します。',
        '- ストーリーを直すときは、修正後のストーリー【全文】だけを返してください（【タイトル】【登場人物】【あらすじ】【ページ配分】の形式）。',
        `- 脚本を直すときは、修正後の脚本【全体】を次のJSON形式のコードブロック（\`\`\`json）で返してください。${SCRIPT_JSON_SCHEMA}`,
        '- 相談や質問には、簡潔な日本語で答えてください。',
    ];
    if (includeContext) {
        lines.push('', '【現在の内容】');
        if (theme) lines.push(`お題: ${theme}`);
        lines.push(`ページ数: ${pageCount}`);
        lines.push('ストーリー:', story?.trim() ? story.trim() : '（まだありません）');
        lines.push('脚本(JSON):', script?.pages?.length ? JSON.stringify({ pages: script.pages }) : '（まだありません）');
    }
    return { role: 'system', content: lines.join('\n') };
}

// Auto向けツール（登録式）。id・ラベル用の言語キー・チャットへ送る依頼文。
// 新しいツールはここへ追加するだけでよい（UIは AUTO_TOOLS を並べる）。
export const AUTO_TOOLS = [
    {
        id: 'story-to-script',
        labelKey: 'auto.tool.storyToScript',
        prompt: '現在のストーリーを、ページとコマに分けた脚本にしてください。脚本全体をJSONのコードブロックで返してください。',
    },
    {
        id: 'dialogue-polish',
        labelKey: 'auto.tool.dialoguePolish',
        prompt: '現在の脚本のセリフを、キャラクターの口調を保ちつつ、自然で簡潔に推敲してください。セリフ以外は変えず、脚本全体をJSONのコードブロックで返してください。',
    },
    {
        id: 'story-refine',
        labelKey: 'auto.tool.storyRefine',
        prompt: '現在のストーリーを、起承転結が分かりやすくなるように整えてください。修正後のストーリー全文を返してください。',
    },
    {
        id: 'character-sheet',
        labelKey: 'auto.tool.characterSheet',
        prompt: '現在のストーリーの登場人物について、性格・口調・見た目の特徴（髪型・服装・体型・色など、作画の指示に使える具体的な内容）を、人物ごとに箇条書きでまとめてください。',
    },
];

// ============================================
// 画像プロンプトの作成（Chatの画像生成用）
// ============================================

const IMAGE_PROMPT_SYSTEM_LOCAL = [
    'あなたは画像生成AI（Stable Diffusion系）向けのプロンプト作成者です。',
    'ユーザーが示すマンガの場面の説明から、英語のカンマ区切りのタグ・短いフレーズで、構図・キャラクターの外見・動作・背景・雰囲気を具体的に表すプロンプトを作ってください。',
    '出力はプロンプト本文のみとし、説明や前置きは書かないでください。',
].join(' ');

const IMAGE_PROMPT_SYSTEM_GEMINI = [
    'あなたは画像生成AI（Gemini）向けのプロンプト作成者です。',
    'ユーザーが示すマンガの場面の説明から、構図・キャラクターの外見・動作・背景・雰囲気を具体的に描写した、英語の短い文章（2〜4文）を作ってください。',
    '出力はプロンプト本文のみとし、説明や前置きは書かないでください。',
].join(' ');

export function buildImagePromptMessages({ description, engine }) {
    return [
        { role: 'system', content: engine === 'gemini' ? IMAGE_PROMPT_SYSTEM_GEMINI : IMAGE_PROMPT_SYSTEM_LOCAL },
        { role: 'user', content: description },
    ];
}
