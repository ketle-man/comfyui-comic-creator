// ============================================================
// 意思決定モデルクライアント（DOM非依存）
//
// ComfyUI-Workflow-Studio の static/js/decision-client.js から、必要部分を 2026-09-30 時点で
// 移植したもの。WFS側の仕様変更を取り込みたいときは、あちらの getDecisionSettings / decide /
// pickChoice / pickScore / testDecisionConnection を見比べて同期すること。
// （画像入力 images / supportsDecisionVision / imageToBase64 はCC独自の追加。LiveChatStream の judgeImage 相当）
//
// 意思決定モデルは文章を生成せず、状態（テキストやJSON）と型付きの質問（yes/no・選択・段階評価）に
// 確率つきで答える。Unsloth Decision API（Laya）と Ollama 0.35+（tev1 / nimble）が同じ
// POST /v1/systemone を話す。画像はvision対応の意思決定モデルのみ扱える（decide の images 引数。
// 非対応モデルに渡すとエラーになるため、事前に supportsDecisionVision で確認する）。
//
// 設定（backend / baseUrl / model / threshold）は Workflow Studio の Settings タブ「意思決定モデル」の
// localStorage 'wfm_decision_settings' を読むだけで、CC側では書き換えない（CCとWFSは同じComfyUIの
// オリジンで動くためlocalStorageを共有できる）。変更はWFS側で行う。
// Unsloth はローカルでもAPIキーが要ることがあるため、CCのサーバー中継（/api/ccc/auto/unsloth-proxy、
// .env の UNSLOTH_API_KEY を付与）を通す。Ollama はキー不要・CORS許可のためブラウザから直接呼ぶ。
// ============================================================

import { getPageLoopbackHost } from './auto-ai-client.js';

export const DECISION_SETTINGS_KEY = 'wfm_decision_settings';

const BACKENDS = {
    unsloth: { label: 'Unsloth', defaultUrl: 'http://localhost:8888', defaultModel: 'laya' },
    ollama: { label: 'Ollama', defaultUrl: 'http://localhost:11434', defaultModel: 'tev1' },
};
const DEFAULT_SETTINGS = { backend: 'unsloth', baseUrl: BACKENDS.unsloth.defaultUrl, model: 'laya', threshold: 0.8 };

/** WFSで保存された意思決定モデル設定（WFS側と同じ補正を行う）。WFSで未保存なら既定値＋configured:false。 */
export function getDecisionSettings() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(DECISION_SETTINGS_KEY) || 'null'); } catch { /* 壊れていれば既定値 */ }
    const merged = { ...DEFAULT_SETTINGS, ...(saved && typeof saved === 'object' ? saved : {}) };
    const th = Number(merged.threshold);
    merged.threshold = th > 0 && th <= 1 ? th : DEFAULT_SETTINGS.threshold;
    if (!BACKENDS[merged.backend]) merged.backend = DEFAULT_SETTINGS.backend;
    const backend = BACKENDS[merged.backend];
    if (!merged.baseUrl) merged.baseUrl = backend.defaultUrl;
    const isLaya = /^laya/.test(merged.model || '');
    if (!merged.model || (merged.backend === 'ollama' && isLaya) || (merged.backend === 'unsloth' && !isLaya)) {
        merged.model = backend.defaultModel;
    }
    merged.backendLabel = backend.label;
    merged.configured = !!saved;
    return merged;
}

// ブラウザはページのホスト名（127.0.0.1 / localhost）と接続先が異なるとfetchを拒むことがあるため、
// ループバック宛てならページ側のホスト名に揃える（auto-ai-client.js の既定URLと同じ考え方）
function hostMatched(url) {
    try {
        const u = new URL(url);
        if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') u.hostname = getPageLoopbackHost();
        return u.origin + u.pathname.replace(/\/+$/, '');
    } catch {
        return url.replace(/\/+$/, '');
    }
}

// ---- 質問ビルダー ----

/** yes/no — 回答の noul が「はい」の確率（0..1） */
export function noul(instructions) {
    return { type: 'noul', instructions };
}

/** 選択 — criteria は選択肢名の配列、または { 選択肢: 説明 }（説明があると精度が上がる） */
export function choice(instructions, criteria) {
    return { type: 'choice', instructions, criteria };
}

/** 段階評価 — levels は低い方(0)から順のラベル（2〜10段階） */
export function score(instructions, levels) {
    return { type: 'score', instructions, criteria: levels };
}

// ---- リクエスト ----

async function unslothProxy(baseUrl, payload) {
    const res = await fetch('/api/ccc/auto/unsloth-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl, path: '/v1/systemone', method: 'POST', payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
    return data;
}

/**
 * 1つの状態に型付きの質問をまとめて聞く。戻り値は questions と同じキーの answers。
 * Unsloth は起動後の初回にモデル読み込みで10〜20秒かかる。
 */
export async function decide(state, questions, settings = getDecisionSettings(), images = []) {
    const payload = { model: settings.model, state, questions };
    // images は base64文字列（data: プレフィックス無し）の配列。vision対応モデルのみ
    if (images?.length) payload.images = images;
    let data;
    if (settings.backend === 'ollama') {
        const res = await fetch(`${hostMatched(settings.baseUrl)}/v1/systemone`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        data = await res.json().catch(() => ({}));
        // Ollama のエラーは { error }（例: 'model "tev1" not found, try pulling it first'）
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    } else {
        data = await unslothProxy(settings.baseUrl.replace(/\/+$/, ''), payload);
    }
    if (!data || typeof data.answers !== 'object') throw new Error(data?.error || 'Decision API returned no answers');
    return data.answers;
}

/** Blob / data URL / 画像URL を base64（data:プレフィックス無し）にする。decide の images 用。 */
export async function imageToBase64(src) {
    const blob = src instanceof Blob ? src : await (await fetch(src)).blob();
    return await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] || '');
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
    });
}

/**
 * 設定中の意思決定モデルが画像入力に対応しているか。
 * Ollama は /api/show で判定する。decisionモデルは capabilities が ['decision'] のみで 'vision' が付かない
 * （Ollama 0.35.1 + clef で確認）ため、capabilities の 'vision' か、画像エンコーダ(projector_info)の有無を見る。Unsloth は一覧APIで判別できないため
 * null（不明）を返す（呼び出し側は試して失敗したらテキストのみへ戻す）。
 */
export async function supportsDecisionVision(settings = getDecisionSettings()) {
    if (settings.backend !== 'ollama') return null;
    try {
        const res = await fetch(`${hostMatched(settings.baseUrl)}/api/show`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: settings.model }),
        });
        if (!res.ok) return false;
        const data = await res.json();
        return (Array.isArray(data.capabilities) && data.capabilities.includes('vision'))
            || !!(data.projector_info && Object.keys(data.projector_info).length);
    } catch {
        return false;
    }
}

/** 設定タブの接続テスト: yes/no 1問の所要時間と「はい」の確率 */
export async function testDecisionConnection(settings = getDecisionSettings()) {
    const started = performance.now();
    const answers = await decide('A cat is sitting on a sofa.', { test: noul('Is there an animal in the text?') }, settings);
    return { ms: Math.round(performance.now() - started), yes: answers.test?.noul };
}

// ---- 回答の読み取り ----
// しきい値判定は confidence ではなく probabilities（noul はその値）で行う
// （confidence は分布の尖り具合で、計算式がサーバー/モデルごとに異なるため）。

/** 選択の最有力候補。probability がしきい値未満なら confident:false（呼び出し側は適用しない） */
export function pickChoice(answer, threshold) {
    const value = answer?.choice ?? null;
    const probability = value != null ? (answer.probabilities?.[value] ?? 0) : 0;
    return { value, probability, confident: value != null && probability >= threshold };
}

/** 段階評価の最有力段階: { level（0始まり）, probability, confident } */
export function pickScore(answer, threshold) {
    let level = null;
    let probability = 0;
    for (const [k, p] of Object.entries(answer?.probabilities || {})) {
        if (p > probability) { level = Number(k); probability = p; }
    }
    return { level, probability, confident: level != null && probability >= threshold };
}
