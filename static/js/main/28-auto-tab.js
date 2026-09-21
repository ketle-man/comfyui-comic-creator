// ============================================================
// main.js 分割ファイル (追加): Autoタブ（AIマンガ自動作成）
// type="module" として読み込まれる。
// 主なトップレベル定義: initAutoTab
//
// 構成: サブタブ「ストーリー・脚本」（3ペイン: 左=お題/作成、中央=ストーリー・脚本・メモ、右=Chat・設定）と
//       サブタブ「レイアウト」（ストーリー・脚本の完成後に実装）。
// 作品データは既存のスクリプトタブとは独立（localStorage の別キー）。連携は行わない。
// LLM呼び出しは ../auto-ai-client.js、プロンプト/パースは ../auto-story-core.js（どちらもDOM非依存）。
// ============================================================

import { t } from '../i18n.js';
import {
    getBackendDefaultUrl, isValidBackendUrl, loadAiSettings, saveAiSettings, validateAiSettings, aiChat,
    fetchModels, testConnection, unloadModel, getGeminiKeyStatus, fetchGeminiTextModels, suggestHostMatchedUrl,
} from '../auto-ai-client.js';
import {
    IMPORTANCE_LEVELS, BUBBLE_TYPES, blankScript, blankPanel, blankDialogue, normalizeScript, parseScriptResponse,
    buildStoryMessages, buildScriptMessages, cloneSampleScript, SAMPLE_THEME, SAMPLE_STORY,
    AUTO_TOOLS, buildChatSystemMessage, buildImagePromptMessages,
} from '../auto-story-core.js';
import { generateAutoImage, listWorkflowFilenames } from './28a-auto-image.js';

const CURRENT_KEY = 'ccc_auto_current';   // 作業中の作品（オートセーブ）
const WORKS_KEY = 'ccc_auto_works';       // 保存済みの作品一覧（スクリプトタブの作品とは別キー）

const $ = (id) => document.getElementById(id);
const CHAT_MAX_MESSAGES = 60;             // 作品に保存するチャット履歴の上限（古いものから捨てる）
const UNDO_MAX = 10;                      // 「Chatの返答を反映」の取り消し履歴の上限
const IMAGES_MAX = 30;                    // 作品に記録する生成画像の上限（ファイル自体は output/cc_auto/ に残る）

const auto = { work: null, inited: false, busy: false, settingsOpened: false, undo: [] };

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ============================================================
// 作品データ（localStorage）
// ============================================================

function newId() {
    return 'auto-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function blankWork() {
    return { id: newId(), name: '', theme: '', pageCount: 2, story: '', script: blankScript(), memo: '', chat: [], images: [], updatedAt: Date.now() };
}

function clampPageCount(v) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(50, Math.max(1, n)) : 2;
}

function normalizeWork(data) {
    const base = blankWork();
    if (!data || typeof data !== 'object') return base;
    return {
        id: typeof data.id === 'string' && data.id ? data.id : base.id,
        name: typeof data.name === 'string' ? data.name : '',
        theme: typeof data.theme === 'string' ? data.theme : '',
        pageCount: clampPageCount(data.pageCount),
        story: typeof data.story === 'string' ? data.story : '',
        script: normalizeScript(data.script) || blankScript(),
        memo: typeof data.memo === 'string' ? data.memo : '',
        chat: Array.isArray(data.chat)
            ? data.chat.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-CHAT_MAX_MESSAGES)
            : [],
        images: Array.isArray(data.images)
            ? data.images.filter((im) => im && typeof im.url === 'string' && im.url.startsWith('/ccc_auto_output/')).slice(-IMAGES_MAX)
            : [],
        updatedAt: Number(data.updatedAt) || Date.now(),
    };
}

function readJson(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
}

function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 容量超過等でも画面操作は継続する */ }
}

function getWorks() {
    const list = readJson(WORKS_KEY, []);
    return Array.isArray(list) ? list.map(normalizeWork) : [];
}

function saveCurrent() {
    auto.work.updatedAt = Date.now();
    writeJson(CURRENT_KEY, auto.work);
}

// 保存済みの内容（更新時刻は除く）と現在の内容が異なるか。未保存の作品は、何か入力があれば「変更あり」。
function serializeForCompare(work) {
    return JSON.stringify({ ...work, updatedAt: 0 });
}

function isDirty() {
    const saved = getWorks().find((w) => w.id === auto.work.id);
    if (saved) return serializeForCompare(saved) !== serializeForCompare(auto.work);
    const w = auto.work;
    return !!(w.name || w.theme || w.story || w.memo || w.script.pages.length || w.chat.length || w.images.length);
}

// ============================================================
// 表示の共通処理
// ============================================================

function setStatus(id, kind, text) {
    const el = $(id);
    if (!el) return;
    el.className = 'auto-status' + (kind ? ' ' + kind : '');
    el.textContent = text || '';
}

// 接続失敗時、ページのホスト名（127.0.0.1/localhost）と接続先が食い違っていれば対処のヒントを付ける
function withHostHint(message, url) {
    const suggest = message === 'Failed to fetch' ? suggestHostMatchedUrl(url) : '';
    return suggest ? `${message}\n${t('auto.msgHostHint', location.hostname, suggest)}` : message;
}

function settingsProblemMessage(code) {
    return { noModel: t('auto.errNoModel'), invalidUrl: t('auto.errInvalidUrl'), noGeminiModel: t('auto.errNoGeminiModel') }[code] || code;
}

function updateButtons() {
    const hasStory = !!auto.work.story.trim();
    const create = $('auto-create-btn');
    const sample = $('auto-sample-btn');
    const script = $('auto-script-create-btn');
    if (create) create.disabled = auto.busy;
    if (sample) sample.disabled = auto.busy;
    if (script) script.disabled = auto.busy || !hasStory;   // ストーリーが空の間は脚本を作成できない（2段階の徹底）
    ['auto-chat-send-btn', 'auto-chat-tool-run-btn', 'auto-img-make-prompt-btn', 'auto-img-generate-btn'].forEach((id) => { const b = $(id); if (b) b.disabled = auto.busy; });
}

async function runBusy(statusId, busyText, fn) {
    if (auto.busy) return;
    auto.busy = true;
    updateButtons();
    setStatus(statusId, 'busy', busyText);
    try {
        await fn();
    } catch (e) {
        console.error('[Auto]', e);
        const s = loadAiSettings();
        const url = s.engine === 'local' ? (s.backendUrl || getBackendDefaultUrl(s.backend)) : '';
        setStatus(statusId, 'error', t('auto.statusError', withHostHint(e?.message || String(e), url)));
    } finally {
        auto.busy = false;
        updateButtons();
    }
}

// ============================================================
// 作品バー（作品名・保存・読込・削除）
// ============================================================

function renderWorkBar() {
    $('auto-work-name').value = auto.work.name;
    const select = $('auto-work-select');
    const works = getWorks().sort((a, b) => b.updatedAt - a.updatedAt);
    select.innerHTML = `<option value="">${esc(t('auto.workSelectPlaceholder'))}</option>` +
        works.map((w) => `<option value="${esc(w.id)}">${esc(w.name || t('auto.workUntitled'))}</option>`).join('');
    select.value = works.some((w) => w.id === auto.work.id) ? auto.work.id : '';
}

function loadWork(work) {
    auto.work = normalizeWork(work);
    auto.undo = [];
    saveCurrent();
    renderAll();
}

function onWorkNew() {
    if (isDirty() && !confirm(t('auto.confirmNewWork'))) return;
    loadWork(blankWork());
}

function onWorkSave() {
    if (!auto.work.name.trim()) auto.work.name = t('auto.workUntitled');
    saveCurrent();
    const works = getWorks().filter((w) => w.id !== auto.work.id);
    works.push(normalizeWork(auto.work));
    writeJson(WORKS_KEY, works);
    renderWorkBar();
    setStatus('auto-status', 'ok', t('auto.workSaved'));
}

function onWorkSelect() {
    const id = $('auto-work-select').value;
    if (!id) return;
    const target = getWorks().find((w) => w.id === id);
    if (!target || id === auto.work.id) return;
    if (isDirty() && !confirm(t('auto.confirmNewWork'))) {
        renderWorkBar();
        return;
    }
    loadWork(target);
}

function onWorkDelete() {
    const name = auto.work.name || t('auto.workUntitled');
    if (!confirm(t('auto.confirmDeleteWork', name))) return;
    writeJson(WORKS_KEY, getWorks().filter((w) => w.id !== auto.work.id));
    loadWork(blankWork());
}

// ============================================================
// 左ペイン・ストーリー・メモ
// ============================================================

function renderLeftAndStory() {
    $('auto-theme').value = auto.work.theme;
    $('auto-page-count').value = auto.work.pageCount;
    $('auto-story').value = auto.work.story;
    $('auto-memo').value = auto.work.memo;
}

function switchCenterTab(name) {
    document.querySelectorAll('[data-auto-center]').forEach((btn) => btn.classList.toggle('active', btn.dataset.autoCenter === name));
    ['story', 'script', 'memo'].forEach((key) => { $('auto-center-' + key).style.display = key === name ? '' : 'none'; });
}

// ストーリー生成（1段階目）
async function onCreateStory() {
    const theme = $('auto-theme').value.trim();
    if (!theme) { setStatus('auto-status', 'error', t('auto.errThemeEmpty')); return; }
    const settings = loadAiSettings();
    const problem = validateAiSettings(settings);
    if (problem) { setStatus('auto-status', 'error', settingsProblemMessage(problem)); return; }
    if (auto.work.story.trim() && !confirm(t('auto.confirmOverwriteStory'))) return;

    const pageCount = clampPageCount($('auto-page-count').value);
    await runBusy('auto-status', t('auto.statusGeneratingStory'), async () => {
        const { content } = await aiChat(settings, buildStoryMessages({ theme, pageCount }));
        const story = (content || '').trim();
        if (!story) throw new Error(t('auto.errEmptyResponse'));
        auto.work.theme = theme;
        auto.work.pageCount = pageCount;
        auto.work.story = story;
        saveCurrent();
        renderLeftAndStory();
        switchCenterTab('story');
        setStatus('auto-status', 'ok', t('auto.statusStoryDone'));
    });
}

function onSample() {
    const w = auto.work;
    if ((w.story.trim() || w.script.pages.length) && !confirm(t('auto.confirmOverwriteSample'))) return;
    w.theme = SAMPLE_THEME;
    w.pageCount = 2;
    w.story = SAMPLE_STORY;
    w.script = cloneSampleScript();
    saveCurrent();
    renderAll();
    setStatus('auto-status', 'ok', t('auto.statusSampleLoaded'));
}

// ============================================================
// 脚本（2段階目の生成と、構造化された編集）
// ============================================================

function showRawOutput(raw) {
    const box = $('auto-raw-output');
    $('auto-raw-output-text').textContent = raw || '';
    box.style.display = raw ? '' : 'none';
    box.open = false;
}

async function onCreateScript() {
    const story = auto.work.story.trim();
    if (!story) { setStatus('auto-script-status', 'error', t('auto.errStoryEmpty')); return; }
    const settings = loadAiSettings();
    const problem = validateAiSettings(settings);
    if (problem) { setStatus('auto-script-status', 'error', settingsProblemMessage(problem)); return; }
    if (auto.work.script.pages.length && !confirm(t('auto.confirmOverwriteScript'))) return;

    showRawOutput('');
    await runBusy('auto-script-status', t('auto.statusGeneratingScript'), async () => {
        const { content } = await aiChat(settings, buildScriptMessages({ story, theme: auto.work.theme, pageCount: auto.work.pageCount }), { json: true });
        const raw = (content || '').trim();
        if (!raw) throw new Error(t('auto.errEmptyResponse'));
        const parsed = parseScriptResponse(raw);
        if (!parsed) {
            showRawOutput(raw);
            setStatus('auto-script-status', 'error', t('auto.errParseFailed'));
            return;
        }
        auto.work.script = parsed.script;
        saveCurrent();
        renderScript();
        if (parsed.method === 'lines') {
            showRawOutput(raw);
            setStatus('auto-script-status', 'ok', t('auto.statusScriptRecovered', parsed.script.pages.length));
        } else {
            setStatus('auto-script-status', 'ok', t('auto.statusScriptDone', parsed.script.pages.length));
        }
    });
}

function renderScript() {
    const list = $('auto-script-list');
    const pages = auto.work.script.pages;
    if (!pages.length) {
        list.innerHTML = `<div class="auto-empty">${esc(t('auto.scriptEmpty'))}</div>`;
        return;
    }
    const importanceOpts = (cur) => IMPORTANCE_LEVELS.map((v) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(t('auto.importance.' + v))}</option>`).join('');
    const bubbleOpts = (cur) => BUBBLE_TYPES.map((v) => `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(t('auto.bubble.' + v))}</option>`).join('');

    list.innerHTML = pages.map((page, pi) => {
        const panelsHtml = page.panels.map((panel, ci) => {
            const dialoguesHtml = panel.dialogues.map((d, di) => `
                <div class="auto-dialogue-row" data-d="${di}">
                    <input type="text" data-field="character" value="${esc(d.character)}" placeholder="${esc(t('auto.characterPlaceholder'))}" />
                    <input type="text" data-field="text" value="${esc(d.text)}" placeholder="${esc(t('auto.dialoguePlaceholder'))}" />
                    <select data-field="bubbleType">${bubbleOpts(d.bubbleType)}</select>
                    <button class="auto-mini-btn danger" data-act="del-dialogue" title="${esc(t('auto.deleteDialogue'))}">✕</button>
                </div>`).join('');
            return `
                <div class="auto-panel" data-c="${ci}">
                    <div class="auto-panel-head">
                        <span class="auto-panel-title">${esc(t('auto.panelTitle', ci + 1))}</span>
                        <span>
                            <select data-field="importance">${importanceOpts(panel.importance)}</select>
                            <button class="auto-mini-btn danger" data-act="del-panel" title="${esc(t('auto.deletePanel'))}">✕</button>
                        </span>
                    </div>
                    <div class="auto-field-label">${esc(t('auto.actionLabel'))}</div>
                    <textarea data-field="action" rows="2">${esc(panel.action)}</textarea>
                    ${dialoguesHtml}
                    <div><button class="auto-mini-btn" data-act="add-dialogue">${esc(t('auto.addDialogue'))}</button></div>
                </div>`;
        }).join('');
        return `
            <div class="auto-page" data-p="${pi}">
                <div class="auto-page-head">
                    <span class="auto-page-title">${esc(t('auto.pageTitle', pi + 1))}</span>
                    <button class="auto-mini-btn danger" data-act="del-page" title="${esc(t('auto.deletePage'))}">✕</button>
                </div>
                ${panelsHtml}
                <div><button class="auto-mini-btn" data-act="add-panel">${esc(t('auto.addPanel'))}</button></div>
            </div>`;
    }).join('');
}

// 入力欄・セレクトの変更を脚本データへ反映する（再描画せず、フォーカスを保つ）
function onScriptFieldChange(e) {
    const el = e.target;
    const field = el.dataset?.field;
    if (!field) return;
    const pi = Number(el.closest('.auto-page')?.dataset.p);
    const ci = Number(el.closest('.auto-panel')?.dataset.c);
    const panel = auto.work.script.pages[pi]?.panels[ci];
    if (!panel) return;
    if (field === 'action') panel.action = el.value;
    else if (field === 'importance') panel.importance = el.value;
    else {
        const dlg = panel.dialogues[Number(el.closest('.auto-dialogue-row')?.dataset.d)];
        if (!dlg) return;
        dlg[field] = el.value;
    }
    saveCurrent();
}

// 追加・削除などの構造変更（再描画する）
function onScriptClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const pages = auto.work.script.pages;
    const pi = Number(btn.closest('.auto-page')?.dataset.p);
    const ci = Number(btn.closest('.auto-panel')?.dataset.c);
    const di = Number(btn.closest('.auto-dialogue-row')?.dataset.d);
    const act = btn.dataset.act;
    if (act === 'del-page') pages.splice(pi, 1);
    else if (act === 'add-panel') pages[pi]?.panels.push(blankPanel());
    else if (act === 'del-panel') pages[pi]?.panels.splice(ci, 1);
    else if (act === 'add-dialogue') pages[pi]?.panels[ci]?.dialogues.push(blankDialogue());
    else if (act === 'del-dialogue') pages[pi]?.panels[ci]?.dialogues.splice(di, 1);
    else return;
    saveCurrent();
    renderScript();
}

function onAddPage() {
    auto.work.script.pages.push({ panels: [blankPanel()] });
    saveCurrent();
    renderScript();
    const list = $('auto-script-list');
    list.scrollTop = list.scrollHeight;
}

// ============================================================
// 右ペイン: 設定（WFS AI TOOL の設定と同じ項目。CC側に保存）
// ============================================================

function checkedValue(name) {
    return document.querySelector(`input[name="${name}"]:checked`)?.value || '';
}

function setRadio(name, value) {
    document.querySelectorAll(`input[name="${name}"]`).forEach((r) => { r.checked = r.value === value; });
}

function fillSelect(id, names, selected) {
    const sel = $(id);
    const list = selected && !names.includes(selected) ? [selected, ...names] : names;
    sel.innerHTML = `<option value=""></option>` + list.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    sel.value = selected || '';
}

function updateEngineSections() {
    const engine = checkedValue('auto-engine');
    $('auto-set-local').style.display = engine === 'local' ? '' : 'none';
    $('auto-set-gemini').style.display = engine === 'gemini' ? '' : 'none';
}

function renderSettings() {
    const s = loadAiSettings();
    setRadio('auto-engine', s.engine);
    setRadio('auto-backend', s.backend);
    $('auto-backend-url').value = s.backendUrl || getBackendDefaultUrl(s.backend);
    fillSelect('auto-model-select', [], s.model);
    $('auto-thinking').checked = !!s.thinkingMode;
    $('auto-max-tokens').value = s.maxTokens || 0;
    fillSelect('auto-gemini-model-select', [], s.geminiModel);
    updateEngineSections();
    // 画像生成: エンジンの選択（Chat側）と、各エンジンの設定
    setRadio('auto-imggen-engine', s.imageEngine);
    $('auto-img-wf-enabled').checked = !!s.imgLocalWfEnabled;
    fillSelect('auto-img-wf-select', [], s.imgLocalWfFile);
    $('auto-img-width').value = s.imgLocalWidth;
    $('auto-img-height').value = s.imgLocalHeight;
    $('auto-img-negative').value = s.imgLocalNegative;
    $('auto-img-gemini-model').value = s.imgGeminiModel;
    $('auto-img-gemini-res').value = s.imgGeminiResolution;
    $('auto-img-gemini-2k').checked = !!s.imgGemini2k;
}

async function refreshWorkflowList(silent) {
    const names = await listWorkflowFilenames();
    fillSelect('auto-img-wf-select', names, $('auto-img-wf-select').value);
    if (silent) return;
    if (names.length) setStatus('auto-settings-status', 'ok', t('auto.msgWorkflowsLoaded', names.length));
    else setStatus('auto-settings-status', 'error', t('auto.msgWorkflowsFailed'));
}

function currentUrlAndBackend() {
    const backend = checkedValue('auto-backend') || 'ollama';
    const url = ($('auto-backend-url').value.trim() || getBackendDefaultUrl(backend)).replace(/\/+$/, '');
    return { backend, url };
}

async function refreshLocalModels(silent) {
    const { backend, url } = currentUrlAndBackend();
    if (!isValidBackendUrl(url)) { if (!silent) setStatus('auto-settings-status', 'error', t('auto.msgInvalidUrl')); return; }
    try {
        const models = await fetchModels(url, backend);
        fillSelect('auto-model-select', models, $('auto-model-select').value);
        if (!silent) setStatus('auto-settings-status', 'ok', t('auto.msgModelsLoaded', models.length));
    } catch (e) {
        if (!silent) setStatus('auto-settings-status', 'error', t('auto.msgModelsFailed', withHostHint(e.message, url)));
    }
}

async function refreshGeminiStatus() {
    const { hasKey, masked } = await getGeminiKeyStatus();
    const el = $('auto-gemini-key-status');
    el.textContent = hasKey ? t('auto.geminiKeyOk', '…' + masked.slice(-4)) : t('auto.geminiKeyMissing');
    el.style.color = hasKey ? '' : '#e57373';
    return hasKey;
}

async function refreshGeminiModels(silent) {
    if (!(await refreshGeminiStatus())) return;
    try {
        const models = await fetchGeminiTextModels();
        fillSelect('auto-gemini-model-select', models, $('auto-gemini-model-select').value);
        if (!silent) setStatus('auto-settings-status', 'ok', t('auto.msgModelsLoaded', models.length));
    } catch (e) {
        if (!silent) setStatus('auto-settings-status', 'error', t('auto.msgModelsFailed', e.message));
    }
}

async function onTestConnection() {
    const { backend, url } = currentUrlAndBackend();
    if (!isValidBackendUrl(url)) { setStatus('auto-settings-status', 'error', t('auto.msgInvalidUrl')); return; }
    setStatus('auto-settings-status', 'busy', '…');
    try {
        const n = await testConnection(url, backend);
        setStatus('auto-settings-status', 'ok', t('auto.msgConnected', n));
        refreshLocalModels(true);
    } catch (e) {
        setStatus('auto-settings-status', 'error', t('auto.msgConnectFailed', withHostHint(e.message, url)));
    }
}

async function onUnloadModel() {
    const { backend, url } = currentUrlAndBackend();
    try {
        await unloadModel(url, backend, $('auto-model-select').value);
        setStatus('auto-settings-status', 'ok', t('auto.msgUnloaded'));
    } catch (e) {
        setStatus('auto-settings-status', 'error', e.message === 'UNSUPPORTED' ? t('auto.msgUnloadUnsupported') : t('auto.msgUnloadFailed', e.message));
    }
}

function onSaveSettings() {
    const engine = checkedValue('auto-engine') || 'local';
    const { backend } = currentUrlAndBackend();
    const url = $('auto-backend-url').value.trim();
    if (url && !isValidBackendUrl(url)) { setStatus('auto-settings-status', 'error', t('auto.msgInvalidUrl')); return; }
    saveAiSettings({
        engine,
        backend,
        backendUrl: url,
        model: $('auto-model-select').value,
        thinkingMode: $('auto-thinking').checked,
        maxTokens: Math.max(0, parseInt($('auto-max-tokens').value, 10) || 0),
        geminiModel: $('auto-gemini-model-select').value,
        imgLocalWfEnabled: $('auto-img-wf-enabled').checked,
        imgLocalWfFile: $('auto-img-wf-select').value,
        imgLocalWidth: Math.max(64, parseInt($('auto-img-width').value, 10) || 1024),
        imgLocalHeight: Math.max(64, parseInt($('auto-img-height').value, 10) || 1024),
        imgLocalNegative: $('auto-img-negative').value,
        imgGeminiModel: $('auto-img-gemini-model').value,
        imgGeminiResolution: $('auto-img-gemini-res').value,
        imgGemini2k: $('auto-img-gemini-2k').checked,
    });
    setStatus('auto-settings-status', 'ok', t('auto.msgSettingsSaved'));
}

function switchRightTab(name) {
    document.querySelectorAll('[data-auto-right]').forEach((btn) => btn.classList.toggle('active', btn.dataset.autoRight === name));
    ['chat', 'settings'].forEach((key) => { $('auto-right-' + key).style.display = key === name ? '' : 'none'; });
    if (name === 'settings' && !auto.settingsOpened) {
        auto.settingsOpened = true;
        // 初回に開いたとき、保存済みの接続先からモデル一覧を静かに更新する
        if (checkedValue('auto-engine') === 'gemini') refreshGeminiModels(true);
        else refreshLocalModels(true);
        refreshWorkflowList(true);
    }
}

// ============================================================
// 右ペイン: Chat（ストーリー・脚本の相談と編集、Auto向けツール）
// 返答は自動では反映せず、返答の下の「ストーリーに反映」「脚本に反映」ボタンで中央ペインへ反映する
// （反映前に確認でき、直前の状態へ戻せる）。ツール呼び出し（LLMによる直接編集）には依存しない。
// ============================================================

// Chatの本文を表示用HTMLにする。``` で囲まれたコードブロック（脚本JSON等）は長くなりがちなので折りたたむ。
function chatBodyHtml(content) {
    const fence = /```[A-Za-z]*\s*([\s\S]*?)```/g;
    let html = '';
    let last = 0;
    let m;
    while ((m = fence.exec(content)) !== null) {
        html += esc(content.slice(last, m.index));
        html += `<details class="auto-chat-code"><summary>${esc(t('auto.chatCodeBlock'))}</summary><pre>${esc(m[1].trim())}</pre></details>`;
        last = fence.lastIndex;
    }
    return html + esc(content.slice(last));
}

function renderChat() {
    const box = $('auto-chat-messages');
    const msgs = auto.work.chat;
    if (!msgs.length) {
        box.innerHTML = `<div class="auto-empty">${esc(t('auto.chatEmpty'))}</div>`;
        return;
    }
    box.innerHTML = msgs.map((m, i) => {
        const isAi = m.role === 'assistant';
        const actions = isAi ? `
            <div class="auto-chat-actions">
                <button class="auto-mini-btn" data-act="apply-story">${esc(t('auto.chatApplyStory'))}</button>
                <button class="auto-mini-btn" data-act="apply-script">${esc(t('auto.chatApplyScript'))}</button>
                <button class="auto-mini-btn" data-act="to-image">${esc(t('auto.imgToPrompt'))}</button>
                <button class="auto-mini-btn" data-act="copy">${esc(t('auto.chatCopy'))}</button>
            </div>` : '';
        return `
            <div class="auto-chat-msg ${m.role}" data-i="${i}">
                <div class="auto-chat-role">${esc(t(isAi ? 'auto.chatRoleAssistant' : 'auto.chatRoleUser'))}</div>
                <div class="auto-chat-body">${chatBodyHtml(m.content)}</div>${actions}
            </div>`;
    }).join('');
    box.scrollTop = box.scrollHeight;
}

function updateUndoButton() {
    $('auto-chat-undo-btn').disabled = auto.undo.length === 0;
}

function pushUndo() {
    auto.undo.push({ story: auto.work.story, script: JSON.parse(JSON.stringify(auto.work.script)) });
    if (auto.undo.length > UNDO_MAX) auto.undo.shift();
    updateUndoButton();
}

function onChatUndo() {
    const snap = auto.undo.pop();
    if (!snap) return;
    auto.work.story = snap.story;
    auto.work.script = snap.script;
    saveCurrent();
    renderLeftAndStory();
    renderScript();
    updateButtons();
    updateUndoButton();
    setStatus('auto-chat-status', 'ok', t('auto.chatUndone'));
}

async function sendChat(text, { forceContext = false } = {}) {
    const content = (text || '').trim();
    if (!content || auto.busy) return;
    const settings = loadAiSettings();
    const problem = validateAiSettings(settings);
    if (problem) { setStatus('auto-chat-status', 'error', settingsProblemMessage(problem)); return; }

    const work = auto.work;
    work.chat = [...work.chat, { role: 'user', content }].slice(-CHAT_MAX_MESSAGES);
    saveCurrent();
    renderChat();
    $('auto-chat-input').value = '';

    const includeContext = forceContext || $('auto-chat-context').checked;
    const messages = [
        buildChatSystemMessage({ theme: work.theme, pageCount: work.pageCount, story: work.story, script: work.script, includeContext }),
        ...work.chat.map((m) => ({ role: m.role, content: m.content })),
    ];
    await runBusy('auto-chat-status', t('auto.chatThinking'), async () => {
        const { content: reply } = await aiChat(settings, messages);
        const answer = (reply || '').trim();
        if (!answer) throw new Error(t('auto.errEmptyResponse'));
        if (auto.work !== work) return;   // 応答待ちの間に別の作品へ切り替えた場合は、返答を捨てる
        work.chat = [...work.chat, { role: 'assistant', content: answer }].slice(-CHAT_MAX_MESSAGES);
        saveCurrent();
        renderChat();
        setStatus('auto-chat-status', '', '');
    });
}

function onChatToolRun() {
    const tool = AUTO_TOOLS.find((x) => x.id === $('auto-chat-tool').value);
    if (!tool) return;
    if (tool.id === 'dialogue-polish') {
        if (!auto.work.script.pages.length) { setStatus('auto-chat-status', 'error', t('auto.errScriptEmpty')); return; }
    } else if (!auto.work.story.trim()) {
        setStatus('auto-chat-status', 'error', t('auto.errStoryEmpty'));
        return;
    }
    sendChat(tool.prompt, { forceContext: true });   // ツールは現在のストーリー・脚本が前提のため、文脈は常に含める
}

function onChatClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const msg = auto.work.chat[Number(btn.closest('.auto-chat-msg')?.dataset.i)];
    if (!msg) return;
    const act = btn.dataset.act;
    if (act === 'copy') {
        navigator.clipboard?.writeText(msg.content).then(() => setStatus('auto-chat-status', 'ok', t('auto.chatCopied'))).catch(() => {});
    } else if (act === 'to-image') {
        // 返答（場面の説明など）を画像プロンプト欄へ移す。「プロンプトを作成」で画像向けに書き直せる
        $('auto-img-prompt').value = msg.content.replace(/```[A-Za-z]*\s*[\s\S]*?```/g, '').trim();
        $('auto-img-panel').open = true;
        $('auto-img-prompt').focus();
    } else if (act === 'apply-story') {
        if (auto.work.story.trim() && !confirm(t('auto.confirmOverwriteStory'))) return;
        pushUndo();
        auto.work.story = msg.content.trim();
        saveCurrent();
        renderLeftAndStory();
        updateButtons();
        switchCenterTab('story');
        setStatus('auto-chat-status', 'ok', t('auto.chatAppliedStory'));
    } else if (act === 'apply-script') {
        const parsed = parseScriptResponse(msg.content);
        if (!parsed) { setStatus('auto-chat-status', 'error', t('auto.chatApplyScriptFailed')); return; }
        if (auto.work.script.pages.length && !confirm(t('auto.confirmOverwriteScript'))) return;
        pushUndo();
        auto.work.script = parsed.script;
        saveCurrent();
        renderScript();
        switchCenterTab('script');
        setStatus('auto-chat-status', 'ok', t('auto.chatAppliedScript', parsed.script.pages.length));
    }
}

// ------------------------------------------------------------
// Chat内の画像生成（エンジン選択は Chat 側、各エンジンの設定は設定タブ）
// LLMの返答から画像プロンプトを作り、生成ボタンで output/cc_auto/ へ保存する。
// ------------------------------------------------------------

function renderImages() {
    const box = $('auto-img-gallery');
    box.innerHTML = auto.work.images.map((im) =>
        `<a href="${esc(im.url)}" target="_blank" rel="noopener" title="${esc(im.prompt || '')}"><img src="${esc(im.url)}" alt="${esc(t('auto.imgOpen'))}" loading="lazy" /></a>`
    ).join('');
}

// 画像プロンプトの元になる説明: 入力欄 → 直近のAIの返答 → ストーリー の順に採用する
function imagePromptSource() {
    const typed = $('auto-img-prompt').value.trim();
    if (typed) return typed;
    const lastAi = [...auto.work.chat].reverse().find((m) => m.role === 'assistant');
    return (lastAi?.content || auto.work.story || '').replace(/```[A-Za-z]*\s*[\s\S]*?```/g, '').trim();
}

async function onMakeImagePrompt() {
    const description = imagePromptSource();
    if (!description) { setStatus('auto-img-status', 'error', t('auto.errImageNoSource')); return; }
    const settings = loadAiSettings();
    const problem = validateAiSettings(settings);
    if (problem) { setStatus('auto-img-status', 'error', settingsProblemMessage(problem)); return; }
    await runBusy('auto-img-status', t('auto.imgPromptMaking'), async () => {
        const { content } = await aiChat(settings, buildImagePromptMessages({ description, engine: settings.imageEngine }));
        const prompt = (content || '').trim().replace(/^["'`]+|["'`]+$/g, '');
        if (!prompt) throw new Error(t('auto.errEmptyResponse'));
        $('auto-img-prompt').value = prompt;
        setStatus('auto-img-status', 'ok', t('auto.imgPromptDone'));
    });
}

async function onGenerateImage() {
    const prompt = $('auto-img-prompt').value.trim();
    if (!prompt) { setStatus('auto-img-status', 'error', t('auto.errImagePromptEmpty')); return; }
    const settings = loadAiSettings();
    const work = auto.work;
    await runBusy('auto-img-status', t('auto.imgGenerating'), async () => {
        const image = await generateAutoImage(settings, prompt);
        if (auto.work !== work) return;   // 生成待ちの間に別の作品へ切り替えた場合は記録しない（ファイルは保存済み）
        work.images = [...work.images, { url: image.url, filename: image.filename, prompt, engine: image.engine }].slice(-IMAGES_MAX);
        saveCurrent();
        renderImages();
        setStatus('auto-img-status', 'ok', t('auto.imgDone', image.filename));
    });
}

function fillToolSelect() {
    $('auto-chat-tool').innerHTML = AUTO_TOOLS.map((tool) => `<option value="${esc(tool.id)}">${esc(t(tool.labelKey))}</option>`).join('');
}

// ============================================================
// 初期化
// ============================================================

function renderAll() {
    renderWorkBar();
    renderLeftAndStory();
    renderScript();
    renderChat();
    renderImages();
    updateUndoButton();
    showRawOutput('');
    setStatus('auto-status', '', '');
    setStatus('auto-script-status', '', '');
    setStatus('auto-chat-status', '', '');
    setStatus('auto-img-status', '', '');
    updateButtons();
}

function bindEvents() {
    // サブタブ（ストーリー・脚本 / レイアウト）
    document.querySelectorAll('[data-auto-subtab]').forEach((btn) => btn.addEventListener('click', () => {
        document.querySelectorAll('[data-auto-subtab]').forEach((b) => b.classList.toggle('active', b === btn));
        ['story', 'layout'].forEach((key) => { $('auto-subtab-' + key).style.display = key === btn.dataset.autoSubtab ? '' : 'none'; });
    }));
    document.querySelectorAll('[data-auto-center]').forEach((btn) => btn.addEventListener('click', () => switchCenterTab(btn.dataset.autoCenter)));
    document.querySelectorAll('[data-auto-right]').forEach((btn) => btn.addEventListener('click', () => switchRightTab(btn.dataset.autoRight)));

    // 作品バー
    $('auto-work-name').addEventListener('input', (e) => { auto.work.name = e.target.value; saveCurrent(); });
    $('auto-work-new-btn').addEventListener('click', onWorkNew);
    $('auto-work-save-btn').addEventListener('click', onWorkSave);
    $('auto-work-delete-btn').addEventListener('click', onWorkDelete);
    $('auto-work-select').addEventListener('change', onWorkSelect);

    // 左ペイン
    $('auto-theme').addEventListener('input', (e) => { auto.work.theme = e.target.value; saveCurrent(); });
    $('auto-page-count').addEventListener('change', (e) => {
        auto.work.pageCount = clampPageCount(e.target.value);
        e.target.value = auto.work.pageCount;
        saveCurrent();
    });
    $('auto-create-btn').addEventListener('click', onCreateStory);
    $('auto-sample-btn').addEventListener('click', onSample);

    // 中央ペイン
    $('auto-story').addEventListener('input', (e) => { auto.work.story = e.target.value; saveCurrent(); updateButtons(); });
    $('auto-memo').addEventListener('input', (e) => { auto.work.memo = e.target.value; saveCurrent(); });
    $('auto-script-create-btn').addEventListener('click', onCreateScript);
    $('auto-script-add-page-btn').addEventListener('click', onAddPage);
    const list = $('auto-script-list');
    list.addEventListener('input', onScriptFieldChange);
    list.addEventListener('change', onScriptFieldChange);
    list.addEventListener('click', onScriptClick);

    // 右ペイン: Chat
    $('auto-chat-send-btn').addEventListener('click', () => sendChat($('auto-chat-input').value));
    $('auto-chat-input').addEventListener('keydown', (e) => {
        // 日本語IMEの変換確定のEnterでは送信しない
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
            e.preventDefault();
            sendChat(e.target.value);
        }
    });
    $('auto-chat-tool-run-btn').addEventListener('click', onChatToolRun);
    $('auto-chat-undo-btn').addEventListener('click', onChatUndo);
    $('auto-chat-clear-btn').addEventListener('click', () => {
        if (auto.work.chat.length && !confirm(t('auto.chatConfirmClear'))) return;
        auto.work.chat = [];
        saveCurrent();
        renderChat();
    });
    $('auto-chat-messages').addEventListener('click', onChatClick);

    // 右ペイン: 画像生成
    document.querySelectorAll('input[name="auto-imggen-engine"]').forEach((r) => r.addEventListener('change', () => {
        saveAiSettings({ imageEngine: checkedValue('auto-imggen-engine') });   // エンジンの選択だけは即時に保存する
    }));
    $('auto-img-make-prompt-btn').addEventListener('click', onMakeImagePrompt);
    $('auto-img-generate-btn').addEventListener('click', onGenerateImage);
    $('auto-img-wf-refresh-btn').addEventListener('click', () => refreshWorkflowList(false));

    // 右ペイン: 設定
    document.querySelectorAll('input[name="auto-engine"]').forEach((r) => r.addEventListener('change', () => {
        updateEngineSections();
        if (checkedValue('auto-engine') === 'gemini') refreshGeminiModels(true);
    }));
    document.querySelectorAll('input[name="auto-backend"]').forEach((r) => r.addEventListener('change', () => {
        // バックエンドを切り替えたら接続先を既定値へ戻し、モデル一覧を取り直す
        $('auto-backend-url').value = getBackendDefaultUrl(checkedValue('auto-backend'));
        fillSelect('auto-model-select', [], '');
        refreshLocalModels(true);
    }));
    $('auto-test-btn').addEventListener('click', onTestConnection);
    $('auto-unload-btn').addEventListener('click', onUnloadModel);
    $('auto-model-refresh-btn').addEventListener('click', () => refreshLocalModels(false));
    $('auto-gemini-refresh-btn').addEventListener('click', () => refreshGeminiModels(false));
    $('auto-settings-save-btn').addEventListener('click', onSaveSettings);
}

export function initAutoTab() {
    if (!auto.inited) {
        auto.inited = true;
        auto.work = normalizeWork(readJson(CURRENT_KEY, null));
        fillToolSelect();
        bindEvents();
        renderSettings();
    }
    renderAll();
}
