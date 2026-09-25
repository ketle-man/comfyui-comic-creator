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
    return { importance: 'Medium', action: '', dialogues: [blankDialogue()], imageUrl: '' };
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
        // オートレイアウトへ転送する際にこのコマへ挿入する画像（auto.work.images[]のurl、
        // または28a-auto-image.jsで新規生成したurl）。LLM出力には含まれないため通常は空。
        imageUrl: typeof raw.imageUrl === 'string' ? raw.imageUrl : '',
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

// LLM出力がMax tokens到達等で末尾を打ち切られた場合、閉じ括弧（}や]）が不足していることが
// 多い。文字列リテラルの中身は無視しつつ開き括弧をスタックで数え、不足分の閉じ括弧（と、
// 閉じられていない文字列があればその閉じクォート）を末尾に補う。値の途中（数値やキー名の
// 途中等）で切れているケースまでは救済できないが、オブジェクト・配列の要素の区切りで
// 切れているケース（実務上多い）はこれで再パースできるようになる。
function repairTruncatedJson(text) {
    const stack = [];
    let inString = false;
    let escape = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escape) { escape = false; continue; }
            if (ch === '\\') { escape = true; continue; }
            if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') { inString = true; continue; }
        if (ch === '{' || ch === '[') stack.push(ch);
        else if (ch === '}' || ch === ']') stack.pop();
    }
    if (!inString && !stack.length) return null; // 既に閉じている（＝修復不要、通常のparseに任せる）
    let repaired = text;
    if (inString) repaired += '"';
    while (stack.length) repaired += stack.pop() === '{' ? '}' : ']';
    return repaired;
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

// 戻り値: { script, method: 'json' | 'json-repaired' | 'lines' } | null
export function parseScriptResponse(raw) {
    const candidates = extractJsonText(raw);
    for (const text of candidates) {
        try {
            const script = normalizeScript(JSON.parse(text));
            if (script) return { script, method: 'json' };
        } catch { /* 次の候補へ */ }
    }
    // 末尾が欠けた不完全なJSON（Max tokens到達等）の救済。閉じ括弧を補ってから再挑戦する。
    for (const text of candidates) {
        const repaired = repairTruncatedJson(text);
        if (!repaired) continue;
        try {
            const script = normalizeScript(JSON.parse(repaired));
            if (script) return { script, method: 'json-repaired' };
        } catch { /* 次の候補へ */ }
    }
    const script = parseScriptLines(raw);
    return script ? { script, method: 'lines' } : null;
}

// ============================================
// プロンプト
// ============================================

// CCのUI設定言語（i18n.jsのgetLang()、'ja'|'en'|'zh'）に応じて、生成される本文の言語を
// システムプロンプトで指定する。実際にどの言語で書かれるかは指示どおりに従うかも含めモデル次第
// （日本語モデルが英語指示で英語を書けるとは限らない等）だが、指示自体は常に付与する。
const LANG_LABEL = { ja: '日本語', en: 'English', zh: '中文（简体中文）' };
function langLabel(lang) { return LANG_LABEL[lang] || LANG_LABEL.ja; }

// ストーリーの見出し自体も言語に応じて切り替える。見出しを日本語固定のまま本文だけ他言語で
// 書かせようとすると、モデルが見出しを中途半端に訳してしまい（例: 「# 【Title】」のような
// 言語混在）出力が崩れることがあったため、指示する言語に合わせて見出し記号も揃える
// （後続処理は見出しラベルの文字列をパースしていないため、変更しても実害はない）。
const STORY_HEADINGS = {
    ja: { title: '【タイトル】', characters: '【登場人物】', synopsis: '【あらすじ】', pages: '【ページ配分】' },
    en: { title: '[Title]', characters: '[Characters]', synopsis: '[Synopsis]', pages: '[Page Breakdown]' },
    zh: { title: '【标题】', characters: '【登场人物】', synopsis: '【剧情简介】', pages: '【页面分配】' },
};
function storyHeadings(lang) { return STORY_HEADINGS[lang] || STORY_HEADINGS.ja; }

function storySystemPrompt(lang) {
    const h = storyHeadings(lang);
    return [
        `あなたはプロのマンガ原作者です。ユーザーのお題から、指定ページ数のマンガのストーリーを${langLabel(lang)}で作ります。`,
        `出力は次の見出し（${langLabel(lang)}に翻訳したり書き換えたりせず、この記号のまま使う）だけで構成し、前置きや挨拶は書かないでください。`,
        h.title,
        `${h.characters}（名前・性格・見た目の特徴を1人1行）`,
        `${h.synopsis}（起承転結が分かる文章）`,
        `${h.pages}（各ページで何を描くかを1ページ1〜2行）`,
    ].join('\n');
}

export function buildStoryMessages({ theme, pageCount, lang }) {
    return [
        { role: 'system', content: storySystemPrompt(lang) },
        { role: 'user', content: `お題: ${theme}\n総ページ数: ${pageCount}ページ\nこのお題で、${pageCount}ページに収まるマンガのストーリーを作ってください。` },
    ];
}

function scriptSystemPrompt(lang) {
    return [
        'あなたはプロのマンガのネーム（コマ割りの脚本）作家です。与えられたストーリーを、ページとコマに分けた脚本にします。',
        '必ず次のJSON形式のみを返してください。挨拶や説明文、```json などの装飾は一切含めないでください。',
        '{"pages":[{"page":1,"panels":[{"importance":"High","action":"コマの背景描写やキャラクターの演技指示","dialogues":[{"character":"話者名","text":"セリフ","bubbleType":"speech"}]}]}]}',
        '- importance は "High"（見せ場の大きなコマ）, "Medium"（標準）, "Low"（小さなつなぎコマ）のいずれか。',
        '- bubbleType は "speech"（通常）, "thought"（心の声）, "shout"（叫び・効果音）, "narrator"（ナレーション）のいずれか。',
        '- セリフの無いコマは "dialogues" を空配列にする。1コマに複数のセリフを入れてよい。',
        '- 1ページあたり3〜5コマを目安にする。',
        `- JSONのキー名（page/panels/importance/action/dialogues/character/text/bubbleType）や importance・bubbleType の値（High/Medium/Low、speech/thought/shout/narrator）はそのまま維持し、"action"・"character"・"text" の中身は${langLabel(lang)}で書いてください。`,
    ].join('\n');
}

export function buildScriptMessages({ story, theme, pageCount, lang }) {
    const lines = [];
    if (theme) lines.push(`お題: ${theme}`);
    lines.push(`総ページ数: ${pageCount}ページ（"page" は 1 から ${pageCount} まで）`);
    lines.push('ストーリー:', story);
    lines.push('', `このストーリーを、全${pageCount}ページの脚本のJSONにしてください。`);
    return [
        { role: 'system', content: scriptSystemPrompt(lang) },
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

// サンプルの「お題」もUI設定言語（ja/en/zh）に応じて切り替える。内容はどの言語版も同じ
// ストーリー（柴犬の宇宙飛行士ポチが月面で宇宙骨を見つける話）の翻訳。
const SAMPLE_THEME_BY_LANG = {
    ja: '宇宙飛行士になった柴犬が、月面探査で謎の宇宙骨（ほね）を見つけるコミカルな日常系。',
    en: 'A comedic slice-of-life about a Shiba Inu who became an astronaut and finds a mysterious space bone during a moon survey.',
    zh: '一只成为宇航员的柴犬，在月面探测中发现神秘宇宙骨头的搞笑日常故事。',
};

const SAMPLE_STORY_BY_LANG = {
    ja: [
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
    ].join('\n'),
    en: [
        '[Title]',
        'The Bone on the Moon',
        '',
        '[Characters]',
        'Pochi: An astronaut Shiba Inu. Serious, but loses himself completely whenever bones are involved.',
        'Mission Control Mike: A cat at Mission Control on Earth. Calm and a bit sharp-tongued.',
        '',
        '[Synopsis]',
        "While surveying the moon, astronaut Shiba Inu Pochi finds a huge bone-shaped rock at the bottom of a crater. Ignoring Mission Control Mike's warnings, he rushes over and starts digging frantically, but it turns out to be just a plain white rock. Just as Pochi slumps in disappointment, a real space bone appears, glowing, from the hole he dug.",
        '',
        '[Page Breakdown]',
        'Page 1: Moon landing, discovery of the mysterious bone-shaped rock.',
        "Page 2: Digging reveals it's just a rock, disappointment, then the punchline of a real bone appearing.",
    ].join('\n'),
    zh: [
        '【标题】',
        '月面的骨头',
        '',
        '【登场人物】',
        '小八：宇航员柴犬。认真，但一遇到骨头的事就会失去理智。',
        '管制官阿三：地球管制室里的猫。冷静，说话有点毒舌。',
        '',
        '【剧情简介】',
        '在月面探测的宇航员柴犬小八，在陨石坑底部发现了一块巨大的骨状岩石。他不顾管制官阿三的制止，冲上前去拼命地挖起来，结果那只是一块普通的白色岩石。正当小八失落之时，挖开的洞里出现了一根真正闪闪发光的宇宙骨头。',
        '',
        '【页面分配】',
        '第1页：登陆月面，发现神秘的骨状岩石。',
        '第2页：挖掘后发现只是岩石，失落，随后真正的骨头出现作为结尾。',
    ].join('\n'),
};

const SAMPLE_SCRIPT_BY_LANG = {
    ja: {
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
    },
    en: {
        pages: [
            {
                panels: [
                    { importance: 'High', action: 'Shiba Inu astronaut Pochi lands on the desolate lunar surface. Earth glows blue in the distance.', dialogues: [{ character: 'Pochi', text: "So this is the moon... one small paw-step!", bubbleType: 'speech' }] },
                    { importance: 'Medium', action: "At the bottom of a crater, Pochi's eyes widen as he spots a bone-shaped white rock.", dialogues: [{ character: 'Pochi', text: 'Is that... a bone...?', bubbleType: 'thought' }] },
                    { importance: 'Low', action: 'In Mission Control, cat Mike watches the monitor with an exasperated look.', dialogues: [{ character: 'Mike', text: 'Pochi, remember your mission.', bubbleType: 'speech' }] },
                    { importance: 'Medium', action: 'Drooling behind his helmet visor, Pochi dashes toward the bone.', dialogues: [{ character: '', text: 'Woosh!', bubbleType: 'shout' }] },
                ],
            },
            {
                panels: [
                    { importance: 'Medium', action: 'Pochi digs frantically at the lunar sand, kicking up dust.', dialogues: [{ character: 'Pochi', text: 'Dig dig dig!', bubbleType: 'speech' }] },
                    { importance: 'High', action: "Pochi collapses in disappointment, realizing it's just a plain rock. Gloomy effect lines in the background.", dialogues: [{ character: 'Pochi', text: "It's just a rock...", bubbleType: 'thought' }] },
                    { importance: 'High', action: "From deep in the hole, a real, giant space bone emerges, glowing. Pochi's tail shoots up.", dialogues: [{ character: '', text: 'Rumble rumble...', bubbleType: 'shout' }, { character: 'Mike', text: '...so it really was there.', bubbleType: 'narrator' }] },
                ],
            },
        ],
    },
    zh: {
        pages: [
            {
                panels: [
                    { importance: 'High', action: '柴犬宇航员小八降落在荒凉的月面上。远处地球泛着蓝光。', dialogues: [{ character: '小八', text: '这里就是月球啊……这一小步真是汪！', bubbleType: 'speech' }] },
                    { importance: 'Medium', action: '小八在陨石坑底部发现一块骨头形状的白色岩石，瞪大了眼睛。', dialogues: [{ character: '小八', text: '那是……骨头……？', bubbleType: 'thought' }] },
                    { importance: 'Low', action: '管制室里，猫咪管制官阿三一脸无奈地盯着监视器。', dialogues: [{ character: '阿三', text: '小八，别忘了任务。', bubbleType: 'speech' }] },
                    { importance: 'Medium', action: '小八隔着头盔流着口水朝骨头冲去。', dialogues: [{ character: '', text: '嗖！', bubbleType: 'shout' }] },
                ],
            },
            {
                panels: [
                    { importance: 'Medium', action: '小八拼命地挖着月面的沙子，沙尘飞扬。', dialogues: [{ character: '小八', text: '挖呀挖呀汪汪！', bubbleType: 'speech' }] },
                    { importance: 'High', action: '发现只是普通白色岩石后，小八瘫倒在地，背景是失落的效果线。', dialogues: [{ character: '小八', text: '只是块石头而已啊……', bubbleType: 'thought' }] },
                    { importance: 'High', action: '挖开的洞穴深处，真正的巨大宇宙骨头闪闪发光地露出来。小八的尾巴猛地竖起。', dialogues: [{ character: '', text: '轰隆隆……', bubbleType: 'shout' }, { character: '阿三', text: '……真的找到了呢。', bubbleType: 'narrator' }] },
                ],
            },
        ],
    },
};

export function getSampleTheme(lang) { return SAMPLE_THEME_BY_LANG[lang] || SAMPLE_THEME_BY_LANG.ja; }
export function getSampleStory(lang) { return SAMPLE_STORY_BY_LANG[lang] || SAMPLE_STORY_BY_LANG.ja; }

export function cloneSampleScript(lang) {
    return JSON.parse(JSON.stringify(SAMPLE_SCRIPT_BY_LANG[lang] || SAMPLE_SCRIPT_BY_LANG.ja));
}

// ============================================
// Chat（ストーリー・脚本の相談・編集）
// ============================================

const SCRIPT_JSON_SCHEMA = '{"pages":[{"page":1,"panels":[{"importance":"High","action":"背景描写・演技指示","dialogues":[{"character":"話者名","text":"セリフ","bubbleType":"speech"}]}]}]}';

// includeContext が true のとき、現在のお題・ストーリー・脚本をシステムプロンプトへ含める。
// 脚本はJSONで渡す（Chatが返した修正版をそのまま「脚本に反映」できるよう、往復で同じ形式を保つため）。
// lang（'ja'|'en'|'zh'）はUI設定言語。相談・質問への回答言語を指示するのに使う
// （storySystemPrompt/scriptSystemPromptと同様、指示文自体は日本語のままでも、
// 応答言語だけはUI設定に合わせる）。
export function buildChatSystemMessage({ theme, pageCount, story, script, includeContext, lang }) {
    const lines = [
        'あなたはマンガ制作を手伝うアシスタントです。ユーザーと相談しながら、ストーリーや脚本（ネーム）を作り、直します。',
        '- ストーリーを直すときは、修正後のストーリー【全文】だけを返してください（【タイトル】【登場人物】【あらすじ】【ページ配分】の形式）。',
        `- 脚本を直すときは、修正後の脚本【全体】を次のJSON形式のコードブロック（\`\`\`json）で返してください。${SCRIPT_JSON_SCHEMA}`,
        `- 相談や質問には、簡潔な${langLabel(lang)}で答えてください。`,
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

// Auto向けツール（登録式）。id・ラベル用の言語キー。
// 新しいツールはここへ追加するだけでよい（UIは AUTO_TOOLS を並べる）。
export const AUTO_TOOLS = [
    { id: 'story-to-script', labelKey: 'auto.tool.storyToScript' },
    { id: 'dialogue-polish', labelKey: 'auto.tool.dialoguePolish' },
    { id: 'story-refine', labelKey: 'auto.tool.storyRefine' },
    { id: 'character-sheet', labelKey: 'auto.tool.characterSheet' },
];

// ツールがチャットへ送る依頼文。ユーザーのチャット欄にそのまま表示されるため、
// UI設定言語（ja/en/zh）に合わせて切り替える。
const TOOL_PROMPT_BY_LANG = {
    'story-to-script': {
        ja: '現在のストーリーを、ページとコマに分けた脚本にしてください。脚本全体をJSONのコードブロックで返してください。',
        en: 'Please turn the current story into a script broken down into pages and panels. Return the entire script as a JSON code block.',
        zh: '请将当前的故事改编为按页面和分镜划分的脚本。请以JSON代码块的形式返回整个脚本。',
    },
    'dialogue-polish': {
        ja: '現在の脚本のセリフを、キャラクターの口調を保ちつつ、自然で簡潔に推敲してください。セリフ以外は変えず、脚本全体をJSONのコードブロックで返してください。',
        en: "Please polish the dialogue in the current script so it sounds natural and concise, while keeping each character's tone of voice. Don't change anything besides the dialogue, and return the entire script as a JSON code block.",
        zh: '请在保持角色语气的同时，将当前脚本中的台词打磨得更自然、更简洁。除台词外不要更改其他内容，并以JSON代码块的形式返回整个脚本。',
    },
    'story-refine': {
        ja: '現在のストーリーを、起承転結が分かりやすくなるように整えてください。修正後のストーリー全文を返してください。',
        en: 'Please refine the current story so its narrative structure (setup, development, twist, conclusion) reads more clearly. Return the full revised story.',
        zh: '请调整当前的故事，使其起承转合更加清晰易懂。请返回修改后的完整故事。',
    },
    'character-sheet': {
        ja: '現在のストーリーの登場人物について、性格・口調・見た目の特徴（髪型・服装・体型・色など、作画の指示に使える具体的な内容）を、人物ごとに箇条書きでまとめてください。',
        en: "For each character in the current story, summarize their personality, tone of voice, and visual traits (hairstyle, clothing, build, color, etc. — concrete details usable as drawing instructions), one character at a time as bullet points.",
        zh: '请针对当前故事中的每个角色，以要点形式分别总结其性格、语气和外貌特征（发型、服装、体型、颜色等可用于作画指示的具体内容）。',
    },
};

export function getToolPrompt(toolId, lang) {
    const entry = TOOL_PROMPT_BY_LANG[toolId];
    if (!entry) return '';
    return entry[lang] || entry.ja;
}

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
