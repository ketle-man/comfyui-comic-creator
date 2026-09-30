// ============================================================
// Autoタブ: 意思決定モデルによる脚本の推定（DOM非依存）
//
// 脚本（auto-story-core.js の { pages:[{ panels:[{ importance, action, dialogues:[{ character, text, bubbleType }] }] }] }）
// の各コマについて、意思決定モデル（decision-client.js）に次を聞き、確率がしきい値
// （Workflow Studioの設定）以上のものだけ脚本へ書き込む。しきい値未満は元の値（LLMが付けた値や
// 手で直した値）のまま残す。
//   - セリフごとのフキダシの種類（speech / thought / shout / narrator）
//   - コマの重要度（Low / Medium / High）→ オートレイアウトのコマの大きさ（auto-layout-core.js の
//     IMPORTANCE_WEIGHT）に効く
// フキダシは1コマのセリフをまとめて1リクエスト、重要度は1コマ1リクエスト（同じ状態に複数の質問を
// 載せられるAPIのため）。
// ============================================================

import { decide, choice, score, pickChoice, pickScore, getDecisionSettings } from './decision-client.js';
import { BUBBLE_TYPES, IMPORTANCE_LEVELS } from './auto-story-core.js';

// 選択肢の説明は精度に効く（decision-client.js の choice() のコメント参照）。モデルは英語の指示の方が
// 安定するため英語で書く（セリフ自体は日本語・中国語のままでよい）。
const BUBBLE_CRITERIA = {
    speech: 'An ordinary line a character says out loud in a normal voice.',
    thought: "A character's inner thought or monologue that is not spoken aloud.",
    shout: 'Shouting, screaming, a strong exclamation, or a loud sound effect (onomatopoeia).',
    narrator: 'Narration or a caption from the narrator, not spoken by any character (time, place, explanation).',
};

// score の段階は低い方から。IMPORTANCE_LEVELS（'High','Medium','Low'）とは並びが逆なので明示的に対応付ける
const IMPORTANCE_SCALE = ['Low', 'Medium', 'High'];
const IMPORTANCE_LABELS = [
    'Low: a small transition or reaction panel',
    'Medium: a standard storytelling panel',
    'High: a key dramatic moment, climax or reveal that deserves a large panel',
];

if (Object.keys(BUBBLE_CRITERIA).some((k) => !BUBBLE_TYPES.includes(k)) || IMPORTANCE_SCALE.some((k) => !IMPORTANCE_LEVELS.includes(k))) {
    console.warn('[auto-decision] BUBBLE_TYPES / IMPORTANCE_LEVELS changed; update auto-decision.js');
}

const clip = (s, n) => { const v = String(s || '').trim(); return v.length > n ? v.slice(0, n) + '…' : v; };

// フキダシの種類と重要度は別リクエストにする。フキダシの判定に場面の描写まで渡すと、描写に
// 引きずられて確率が下がったり誤答したりした（例: 効果音「ゴゴゴゴ…」がnarratorになる。
// 2026-09-30 nimble:9b / tev1 で実測）ため、フキダシはセリフと話者だけで判定する。
function buildBubbleRequest(panel) {
    const lines = panel.dialogues.map((d, i) => ({ i, d })).filter(({ d }) => d.text && d.text.trim());
    if (!lines.length) return null;
    const state = { dialogues: lines.map(({ d }) => ({ speaker: d.character || '(none)', line: clip(d.text, 200) })) };
    const questions = {};
    const bubbleKeys = [];
    lines.forEach(({ i, d }, n) => {
        const key = `bubble_${n}`;
        questions[key] = choice(`Which kind of speech balloon fits manga dialogue line ${n + 1} ("${clip(d.text, 80)}")?`, BUBBLE_CRITERIA);
        bubbleKeys.push({ key, dialogueIndex: i });
    });
    return { kind: 'bubble', state, questions, bubbleKeys };
}

function buildImportanceRequest(page, panelIndex) {
    const panel = page.panels[panelIndex];
    const state = {
        panel_number: panelIndex + 1,
        panels_on_page: page.panels.length,
        scene: clip(panel.action, 300),
        dialogues: panel.dialogues.filter((d) => d.text && d.text.trim()).map((d) => clip(d.text, 120)),
        // 重要度はページ内での相対的なものなので、同じページの他のコマの描写も文脈として渡す
        other_panels_on_page: page.panels.map((p, i) => (i === panelIndex ? null : `${i + 1}: ${clip(p.action, 80)}`)).filter(Boolean),
    };
    const questions = { importance: score('How important is this panel within the page? Important panels get more space in the layout.', IMPORTANCE_LABELS) };
    return { kind: 'importance', state, questions };
}

/**
 * 脚本の全コマを推定し、確信度がしきい値以上の値だけ書き込む（script を直接変更する）。
 * @param {object} script
 * @param {{bubble:boolean, importance:boolean, onProgress?:(done:number,total:number)=>void}} opts
 * @returns {Promise<{bubble:{changed,kept,unsure}, importance:{changed,kept,unsure}, failed:number, error:string|null, total:number}>}
 *   changed=値を変えた / kept=推定が元の値と同じ / unsure=しきい値未満で据え置き
 */
export async function estimateScript(script, opts) {
    const settings = getDecisionSettings();
    const stats = { bubble: { changed: 0, kept: 0, unsure: 0 }, importance: { changed: 0, kept: 0, unsure: 0 }, failed: 0, error: null, total: 0 };
    const jobs = [];
    script.pages.forEach((page) => page.panels.forEach((panel, ci) => {
        const reqs = [opts.bubble && buildBubbleRequest(panel), opts.importance && buildImportanceRequest(page, ci)].filter(Boolean);
        if (reqs.length) jobs.push({ page, ci, reqs });
    }));
    stats.total = jobs.length;

    let next = 0;
    let done = 0;
    const worker = async () => {
        while (next < jobs.length) {
            const { page, ci, reqs } = jobs[next++];
            const panel = page.panels[ci];
            let panelFailed = false;
            for (const req of reqs) {
                let answers;
                try {
                    answers = await decide(req.state, req.questions, settings);
                } catch (e) {
                    panelFailed = true;
                    if (!stats.error) stats.error = e?.message || String(e);
                    continue;
                }
                if (req.kind === 'bubble') {
                    for (const { key, dialogueIndex } of req.bubbleKeys) {
                        const pick = pickChoice(answers[key], settings.threshold);
                        const d = panel.dialogues[dialogueIndex];
                        if (!pick.confident || !BUBBLE_TYPES.includes(pick.value)) stats.bubble.unsure++;
                        else if (d.bubbleType === pick.value) stats.bubble.kept++;
                        else { d.bubbleType = pick.value; stats.bubble.changed++; }
                    }
                } else {
                    const pick = pickScore(answers.importance, settings.threshold);
                    const value = IMPORTANCE_SCALE[pick.level];
                    if (!pick.confident || !value) stats.importance.unsure++;
                    else if (panel.importance === value) stats.importance.kept++;
                    else { panel.importance = value; stats.importance.changed++; }
                }
            }
            if (panelFailed) stats.failed++;
            opts.onProgress?.(++done, jobs.length);
        }
    };
    // ローカルで動くモデルなので同時に投げても待ち行列になるだけ。1件ずつ順に投げる。
    // なおOllamaはモデルの切り替え直後に 'Post ".../tokenize": ... wsarecv' のエラーを返すことがある
    // （2026-09-30、並列・逐次どちらでも発生）。そのコマだけ失敗として数え、残りは続行する
    await worker();
    return stats;
}
