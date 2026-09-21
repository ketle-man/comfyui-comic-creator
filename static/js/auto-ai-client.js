// ============================================================
// Autoタブ用 LLMクライアント（DOM非依存）
//
// ComfyUI-Workflow-Studio の static/js/ai-tab.js / util.js（AI TOOLタブ）から、必要部分を
// 2026-09-21 時点で移植したもの。CC単体で動かすため（WFS未導入でも動く）、WFS側とは実装が二重になる。
// WFS側の仕様変更を取り込みたいときは、上記2ファイルの callLLM/callChat/fetchModels/
// unloadAiModel/_applyGenOptions/stripThinkingTags を見比べて同期すること。
//
// バックエンド:
//   ローカル … Ollama / LM Studio / Lemonade / Unsloth（Unslothはキーを持つサーバー経由）
//   Gemini   … NanobananaタブのAPIキー（NANOBANANA_API_KEY）をサーバー側で使うテキスト生成
// 翻訳・VLM（画像入力）用の関数は移植していない（導入時に追加する）。
// ============================================================

import { resolveBackendError } from './i18n.js';

export const LOCAL_BACKENDS = ['ollama', 'lmstudio', 'lemonade', 'unsloth'];

const BACKEND_DEFAULT_PORTS = {
    ollama: 11434,
    lmstudio: 1234,
    lemonade: 13305,
    unsloth: 8888,
};

// ブラウザは、ページのホスト名（127.0.0.1 と localhost）と接続先のホスト名が異なると、
// ローカルLLMへのfetchをブロックすることがある（CORSヘッダーが正しくても "Failed to fetch" になる）。
// そのため既定の接続先は、ページを開いているホスト名に合わせる。
export function getPageLoopbackHost() {
    const h = globalThis.location?.hostname;
    return h === '127.0.0.1' || h === 'localhost' ? h : 'localhost';
}

export function getBackendDefaultUrl(backend) {
    return `http://${getPageLoopbackHost()}:${BACKEND_DEFAULT_PORTS[backend] || BACKEND_DEFAULT_PORTS.ollama}`;
}

// 接続先がループバックで、ページのホスト名と異なる場合、ホスト名を合わせたURLを返す。該当しなければ ''。
export function suggestHostMatchedUrl(url) {
    try {
        const u = new URL(url);
        const pageHost = getPageLoopbackHost();
        const loopback = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
        if (!loopback || u.hostname === pageHost || globalThis.location?.hostname !== pageHost) return '';
        u.hostname = pageHost;
        return u.origin;
    } catch {
        return '';
    }
}

// ============================================
// 設定の保存（CC側localStorage。WFSの wfm_ai_settings とは共有しない）
// ============================================

const SETTINGS_KEY = 'ccc_auto_ai_settings';

export const DEFAULT_AI_SETTINGS = Object.freeze({
    engine: 'local',        // 'local' | 'gemini'
    backend: 'ollama',      // LOCAL_BACKENDS のいずれか
    backendUrl: '',         // 空ならバックエンド既定URL
    model: '',
    thinkingMode: false,
    maxTokens: 0,           // 0=バックエンド任せ
    geminiModel: '',
});

export function loadAiSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        return { ...DEFAULT_AI_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
    } catch {
        return { ...DEFAULT_AI_SETTINGS };
    }
}

export function saveAiSettings(patch) {
    const data = { ...loadAiSettings(), ...patch };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(data)); } catch { /* 保存できなくても動作は継続 */ }
    return data;
}

// ============================================
// 共通ヘルパー
// ============================================

export function isValidBackendUrl(url) {
    try {
        const u = new URL(url);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}

// Ollamaは `think`(bool) と `options.num_predict` で制御できるが、LM Studio/Lemonade/Unslothは
// OpenAI互換APIのため max_tokens のみ標準対応。thinking mode切替に対応しないバックエンド/モデル向けに、
// 出力からの <think> タグ除去（stripThinkingTags）でも担保する。
function applyGenOptions(body, backend, settings) {
    const maxTokens = parseInt(settings?.maxTokens, 10);
    if (backend === 'ollama') {
        body.think = !!settings?.thinkingMode;
        if (maxTokens > 0) body.options = { ...(body.options || {}), num_predict: maxTokens };
    } else if (maxTokens > 0) {
        body.max_tokens = maxTokens;
    }
    return body;
}

export function stripThinkingTags(text) {
    return (text || '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
        .trim();
}

function finishText(text, settings) {
    return settings?.thinkingMode ? text : stripThinkingTags(text);
}

async function httpJson(url, init) {
    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

function postJson(url, body) {
    return httpJson(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

// Unslothの推論内容は content とは別の reasoning_content に返る。既存の thinking mode の
// 表示/除去ロジック（applyGenOptions / stripThinkingTags）を共通に使うため <think> ブロックへ戻す。
function unslothContent(message) {
    const reasoning = message?.reasoning_content;
    const content = message?.content || '';
    return reasoning ? `<think>${reasoning}</think>${content}` : content;
}

// Unslothはローカルでも常にAPIキーが必要なため、サーバー(/api/ccc/auto/unsloth-proxy)が
// キー(.envのUNSLOTH_API_KEY)を付けて中継する
async function unslothProxy(baseUrl, path, method, payload) {
    const res = await fetch('/api/ccc/auto/unsloth-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl, path, method, payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
    return data;
}

// ============================================
// ローカルLLM
// ============================================

export async function fetchModels(url, backend) {
    if (backend === 'ollama') {
        const data = await httpJson(`${url}/api/tags`);
        return (data.models || []).map((m) => m.name);
    }
    if (backend === 'unsloth') {
        const data = await unslothProxy(url, '/v1/models', 'GET');
        return (data.data || []).map((m) => m.id);
    }
    // LM Studio / Lemonade（OpenAI互換）
    const data = await httpJson(`${url}/v1/models`);
    return (data.data || []).map((m) => m.id);
}

export async function testConnection(url, backend) {
    const models = await fetchModels(url, backend);
    return models.length;
}

// モデルをVRAM/メモリからアンロードする。公式APIが無い場合(Unsloth)は "UNSUPPORTED" を投げる。
export async function unloadModel(url, backend, model) {
    if (!model) throw new Error('No model selected');
    if (backend === 'ollama') {
        // keep_alive:0 + 空プロンプトが公式に文書化されたアンロード方法（専用エンドポイントは無い）
        await postJson(`${url}/api/generate`, { model, prompt: '', keep_alive: 0 });
    } else if (backend === 'lmstudio') {
        await postJson(`${url}/api/v1/models/unload`, { instance_id: model });
    } else if (backend === 'lemonade') {
        await postJson(`${url}/api/v1/unload`, { model_name: model });
    } else {
        throw new Error('UNSUPPORTED');
    }
}

// messages: [{role:'system'|'user'|'assistant', content}]
// 戻り値: { content, toolCalls }（toolCalls は tools を渡したときのみ入り得る）
export async function callChat(url, backend, model, messages, tools, settings = {}) {
    const body = applyGenOptions({ model, messages, stream: false }, backend, settings);
    if (backend === 'ollama') {
        if (tools) body.tools = tools;
        const message = (await postJson(`${url}/api/chat`, body)).message || {};
        return { content: finishText(message.content || '', settings), toolCalls: message.tool_calls || null };
    }
    if (tools) { body.tools = tools; body.tool_choice = 'auto'; }
    if (backend === 'unsloth') {
        const data = await unslothProxy(url, '/v1/chat/completions', 'POST', body);
        const message = data.choices?.[0]?.message || {};
        return { content: finishText(unslothContent(message), settings), toolCalls: message.tool_calls || null };
    }
    const data = await postJson(`${url}/v1/chat/completions`, body);
    const message = data.choices?.[0]?.message || {};
    return { content: finishText(message.content || '', settings), toolCalls: message.tool_calls || null };
}

// 単発プロンプト
export async function callLLM(url, backend, model, prompt, settings = {}) {
    const { content } = await callChat(url, backend, model, [{ role: 'user', content: prompt }], undefined, settings);
    return content;
}

// ============================================
// Gemini（サーバー経由。キーはブラウザに出さない）
// ============================================

async function geminiRequest(url, init) {
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.status === 'error') {
        throw new Error(resolveBackendError(data.error_code, data.error_params) || data.message || data.detail || `HTTP ${res.status}`);
    }
    return data;
}

// APIキーの設定有無。戻り値: { hasKey, masked }
export async function getGeminiKeyStatus() {
    try {
        const data = await (await fetch('/api/ccc/nanobanana/key')).json();
        return { hasKey: data.status === 'ok', masked: data.masked || '' };
    } catch {
        return { hasKey: false, masked: '' };
    }
}

// テキスト生成に使えるGeminiモデル名の一覧（画像・音声・埋め込み系は除外）
export async function fetchGeminiTextModels() {
    const data = await geminiRequest('/api/ccc/nanobanana/models');
    return (data.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => String(m.name || '').replace(/^models\//, ''))
        .filter((name) => /^gemini-/.test(name) && !/image|imagen|tts|audio|live|embedding|robotics|computer-use|aqa/i.test(name));
}

export async function geminiChat(model, messages, opts = {}) {
    const data = await geminiRequest('/api/ccc/auto/gemini-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model,
            messages,
            json: !!opts.json,
            temperature: opts.temperature,
            max_tokens: opts.maxTokens,
        }),
    });
    return data.text || '';
}

// ============================================
// 統合入口（設定に従ってローカル/Geminiへ振り分ける）
// ============================================

// 設定の妥当性を確認し、問題があれば理由（言語キー用のコード）を返す。OKなら null。
export function validateAiSettings(settings) {
    if (settings.engine === 'gemini') {
        return settings.geminiModel ? null : 'noGeminiModel';
    }
    const url = settings.backendUrl || getBackendDefaultUrl(settings.backend);
    if (!isValidBackendUrl(url)) return 'invalidUrl';
    if (!settings.model) return 'noModel';
    return null;
}

// messages: [{role, content}]。opts: { json?: boolean, tools?: array（ローカルのみ） }
// 戻り値: { content, toolCalls }
export async function aiChat(settings, messages, opts = {}) {
    if (settings.engine === 'gemini') {
        const content = await geminiChat(settings.geminiModel, messages, { json: opts.json });
        return { content, toolCalls: null };
    }
    const url = (settings.backendUrl || getBackendDefaultUrl(settings.backend)).replace(/\/+$/, '');
    return callChat(url, settings.backend, settings.model, messages, opts.tools, settings);
}
