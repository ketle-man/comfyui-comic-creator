/**
 * Nanobanana API 連携ロジック
 * type="module" として読み込まれる（ESモジュール化 G6）。
 */

import { t, resolveBackendError } from './i18n.js';
import { insertImage } from './main/08-panels-images.js';
import { saveToEagle, _eagleSettings } from './main/14-integrations.js';
import { state } from './main/01-state.js';

const HISTORY_AUTO_KEY = 'ccc_nanobanana_history_auto';
const ENGINE_KEY = 'ccc_nanobanana_engine';   // 'gemini'（Gemini API直叩き） | 'comfyui'（ComfyUIネイティブノード）
const ENGINE_EVENT = 'ccc-nanobanana-engine-changed';

// 生成方式の設定。設定タブ・Nanobananaタブ・半自動マンガ・Autoタブ（画像生成エンジン=Gemini）で共通に使う。
function getNanobananaEngine() {
    try { return localStorage.getItem(ENGINE_KEY) === 'comfyui' ? 'comfyui' : 'gemini'; } catch { return 'gemini'; }
}
function setNanobananaEngine(engine) {
    const v = engine === 'comfyui' ? 'comfyui' : 'gemini';
    try { localStorage.setItem(ENGINE_KEY, v); } catch { /* 無視 */ }
    window.dispatchEvent(new CustomEvent(ENGINE_EVENT, { detail: v }));
}

class NanobananaManager {
    constructor() {
        this.engine = 'gemini';
        this.status = 'disconnected';
        this.i2iImages = [];   // { b64: 'data:...', mime: 'image/png' }[]  最大14枚
        this.MAX_I2I = 14;
        this.generatedImages = [];
        this.selectedResultIndex = 0; // 結果表示・「コマに挿入」の対象（サムネイルで選択）
        this.apiUrl = '/api/ccc/nanobanana/generate';
        this.lastGenerationMeta = null;   // 直近の生成パラメータ（履歴の手動記録用）

        this.init();
    }

    async init() {
        console.log('NanobananaManager Initializing...');
        this.restoreEngineSetting();
        await this.refreshApiKey();
        this.bindEvents();
        this.renderI2IGrid();
        this.restoreHistoryAutoSetting();
    }

    // 生成方式（Gemini API / ComfyUIネイティブノード）の選択を復元し、表示を切り替える
    restoreEngineSetting() {
        const sel = document.getElementById('nanobanana-engine');
        this.engine = getNanobananaEngine();
        if (sel) {
            sel.value = this.engine;
            sel.addEventListener('change', () => setNanobananaEngine(sel.value));
        }
        this.applyEngineUi();
        // 設定タブなど他の場所で切り替えられたときも、この画面の表示と接続状態を追従させる
        window.addEventListener(ENGINE_EVENT, () => {
            this.engine = getNanobananaEngine();
            if (sel) sel.value = this.engine;
            this.applyEngineUi();
            this.refreshApiKey();
        });
    }

    // ネイティブ方式では出力PNGに設定が埋め込まれるため、履歴記録のUIは不要
    applyEngineUi() {
        const native = this.engine === 'comfyui';
        const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
        show('nanobanana-model', !native);
        show('nanobanana-model-native', native);
        show('nanobanana-history-auto-field', !native);
        show('nanobanana-history-record-btn', !native);
    }

    restoreHistoryAutoSetting() {
        const checkbox = document.getElementById('nanobanana-history-auto');
        if (!checkbox) return;
        try { checkbox.checked = localStorage.getItem(HISTORY_AUTO_KEY) === '1'; } catch { /* 無視 */ }
        checkbox.addEventListener('change', () => {
            try { localStorage.setItem(HISTORY_AUTO_KEY, checkbox.checked ? '1' : '0'); } catch { /* 無視 */ }
        });
    }

    async refreshApiKey() {
        const { connected, text } = await checkNanobananaKeyStatus();
        this.updateStatus(connected ? 'connected' : 'disconnected', text);
    }

    updateStatus(status, text) {
        this.status = status;
        const label = document.getElementById('nanobanana-status-label');
        if (label) {
            label.textContent = text;
            label.className = `comfyui-status ${status}`;
        }
    }

    bindEvents() {
        // タブ切り替え
        document.querySelectorAll('[data-nanobanana-subtab]').forEach(btn => {
            btn.addEventListener('click', () => {
                const subtab = btn.dataset.nanobananaSubtab;
                document.querySelectorAll('[data-nanobanana-subtab]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                document.querySelectorAll('#nanobanana-tab .comfyui-subtab-content').forEach(c => c.style.display = 'none');
                document.getElementById(`nanobanana-subtab-${subtab}`).style.display = 'block';
                if (subtab === 'history') this.loadHistory();
            });
        });

        // 履歴
        document.getElementById('nanobanana-history-refresh-btn')?.addEventListener('click', () => this.loadHistory());
        document.getElementById('nanobanana-history-record-btn')?.addEventListener('click', () => this.recordHistory());

        // APIキー再読込
        document.getElementById('nanobanana-refresh-key-btn')?.addEventListener('click', () => this.refreshApiKey());

        // I2I ファイル選択（複数対応）
        document.getElementById('nanobanana-i2i-file')?.addEventListener('change', (e) => this.handleI2IFiles(e));
        document.getElementById('nanobanana-i2i-clear-all-btn')?.addEventListener('click', () => this.clearAllI2I());

        // I2I グリッドへのドラッグ&ドロップ
        const grid = document.getElementById('nanobanana-i2i-grid');
        if (grid) {
            grid.addEventListener('dragover', (e) => {
                if (e.dataTransfer.types.includes('Files')) {
                    e.preventDefault();
                    grid.style.outline = '2px solid var(--accent-primary, #0077ff)';
                    grid.style.outlineOffset = '-2px';
                }
            });
            grid.addEventListener('dragleave', (e) => {
                if (!grid.contains(e.relatedTarget)) {
                    grid.style.outline = '';
                    grid.style.outlineOffset = '';
                }
            });
            grid.addEventListener('drop', (e) => {
                e.preventDefault();
                grid.style.outline = '';
                grid.style.outlineOffset = '';
                const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
                if (files.length) this.addI2IFiles(files);
            });
        }

        // 生成ボタン
        document.getElementById('nanobanana-generate-btn')?.addEventListener('click', () => this.generate());

        // コマに挿入ボタン
        document.getElementById('nanobanana-insert-btn')?.addEventListener('click', () => this.insertToPanel());
    }

    // 複数ファイル読み込み（ファイル選択input用）
    handleI2IFiles(e) {
        const files = Array.from(e.target.files);
        e.target.value = '';
        this.addI2IFiles(files);
    }

    // 複数ファイルをi2iImagesに追加（ファイル選択・ドロップ共通）
    addI2IFiles(files) {
        if (!files.length) return;

        const remaining = this.MAX_I2I - this.i2iImages.length;
        if (remaining <= 0) {
            alert(t('nb.maxImagesReached', this.MAX_I2I));
            return;
        }
        const toLoad = files.slice(0, remaining);
        if (files.length > remaining) {
            alert(t('nb.maxImagesTruncated', this.MAX_I2I, remaining));
        }

        let loaded = 0;
        toLoad.forEach(file => {
            const reader = new FileReader();
            reader.onload = (ev) => {
                const b64 = ev.target.result;
                const mime = file.type || 'image/png';
                this.i2iImages.push({ b64, mime });
                loaded++;
                if (loaded === toLoad.length) {
                    this.renderI2IGrid();
                }
            };
            reader.readAsDataURL(file);
        });
    }

    // 特定インデックスの画像を削除
    removeI2IImage(idx) {
        this.i2iImages.splice(idx, 1);
        this.renderI2IGrid();
    }

    // 全クリア
    clearAllI2I() {
        this.i2iImages = [];
        this.renderI2IGrid();
    }

    // グリッドを再描画
    renderI2IGrid() {
        const grid = document.getElementById('nanobanana-i2i-grid');
        const countEl = document.getElementById('nb-i2i-count');
        if (!grid) return;

        grid.innerHTML = '';
        const count = this.i2iImages.length;
        if (countEl) countEl.textContent = `(${count}/${this.MAX_I2I})`;

        this.i2iImages.forEach((img, idx) => {
            const cell = document.createElement('div');
            cell.style.cssText = 'position:relative; width:100%; height:100%; background:#222; border:1px solid #444; border-radius:3px; overflow:hidden; cursor:default;';

            const thumb = document.createElement('img');
            thumb.src = img.b64;
            thumb.style.cssText = 'width:100%; height:100%; object-fit:contain; display:block; background:#111; transition:transform 0.15s ease;';
            // ホバーで拡大（セル内でfitして全体確認）
            thumb.addEventListener('mouseenter', () => { thumb.style.objectFit = 'contain'; });
            cell.appendChild(thumb);

            const delBtn = document.createElement('button');
            delBtn.textContent = '✕';
            delBtn.title = t('common.delete');
            delBtn.style.cssText = 'position:absolute; top:2px; right:2px; width:18px; height:18px; padding:0; font-size:10px; line-height:18px; text-align:center; background:rgba(0,0,0,0.7); color:#fff; border:none; border-radius:2px; cursor:pointer;';
            delBtn.addEventListener('click', () => this.removeI2IImage(idx));
            cell.appendChild(delBtn);

            // スロット番号バッジ
            const badge = document.createElement('span');
            badge.textContent = idx + 1;
            badge.style.cssText = 'position:absolute; bottom:2px; left:3px; font-size:9px; color:#ccc; background:rgba(0,0,0,0.5); padding:0 2px; border-radius:2px; pointer-events:none;';
            cell.appendChild(badge);

            grid.appendChild(cell);
        });

        // 空スロットを12個まで表示
        for (let i = count; i < this.MAX_I2I; i++) {
            const empty = document.createElement('div');
            empty.style.cssText = 'width:100%; height:100%; background:#1a1a1a; border:1px dashed #333; border-radius:3px;';
            grid.appendChild(empty);
        }
    }

    async generate() {
        if (this.status !== 'connected') {
            alert(t('nb.apiKeyMissing'));
            return;
        }

        const prompt = document.getElementById('nanobanana-prompt').value;
        if (!prompt) {
            alert(t('nb.promptRequired'));
            return;
        }
        if (this.engine === 'comfyui') return this.generateNative(prompt);

        const model = document.getElementById('nanobanana-model').value;
        const negative = document.getElementById('nanobanana-negative').value;
        const resolution = document.getElementById('nanobanana-resolution').value;
        const [width, height] = resolution.split('x').map(Number);
        const imageSize = document.getElementById('nanobanana-image-size')?.value;
        const batchSize = parseInt(document.getElementById('nanobanana-batch-size').value) || 1;
        const seed = parseInt(document.getElementById('nanobanana-seed').value);

        const btn = document.getElementById('nanobanana-generate-btn');
        const progress = document.getElementById('nanobanana-progress-text');
        
        btn.disabled = true;
        progress.textContent = t('nb.generating');

        try {
            const payload = {
                model: model,
                prompt: prompt,
                negative_prompt: negative,
                width: width,
                height: height,
                num_images: batchSize,
                seed: seed === -1 ? Math.floor(Math.random() * 1000000) : seed
            };
            if (imageSize) payload.image_size = imageSize;

            // I2I: 複数画像を配列で送る
            if (this.i2iImages.length > 0) {
                payload.images = this.i2iImages.map(img => ({
                    data: img.b64,
                    mime: img.mime
                }));
            }

            const images = await requestNanobananaGenerate(payload);

            progress.textContent = t('nb.saving');
            this.generatedImages = [];

            for (let i = 0; i < images.length; i++) {
                const { url, dataUrl } = await saveNanobananaImageAndMaybeEagle(images[i], `nanobanana_${i}`);
                this.generatedImages.push({ url, b64: dataUrl });
            }

            this.lastGenerationMeta = {
                engine: 'gemini', model, width, height, image_size: imageSize || '', seed: payload.seed,
                prompt, negative_prompt: negative,
                filenames: this.generatedImages.map(img => img.url.split('/').pop()),
            };
            const recordBtn = document.getElementById('nanobanana-history-record-btn');
            if (recordBtn) recordBtn.disabled = false;
            if (document.getElementById('nanobanana-history-auto')?.checked) {
                this.recordHistory({ silent: true });
            }

            this.showResult(0);
            progress.textContent = t('common.done');

            // ギャラリーを更新
            if (typeof loadGalleryImages === 'function') loadGalleryImages();

        } catch (e) {
            console.error('Generation error:', e);
            alert(t('common.errorPrefix', e.message));
            progress.textContent = t('nb.generationErrorStatus');
        } finally {
            btn.disabled = false;
        }
    }

    // ComfyUIネイティブノード（Nano Banana 2.1）経由の生成。結果はComfyUIのoutput/cc_nanobanana_native/へ
    // プロンプト・設定入りのPNGとして保存される（SaveImageの埋め込み）ため、history.jsonlへの記録は行わない。
    async generateNative(prompt) {
        const model = document.getElementById('nanobanana-model-native').value;
        const negative = document.getElementById('nanobanana-negative').value;
        const [width, height] = document.getElementById('nanobanana-resolution').value.split('x').map(Number);
        const imageSize = document.getElementById('nanobanana-image-size')?.value || '1K';
        const batchSize = parseInt(document.getElementById('nanobanana-batch-size').value) || 1;
        const seed = parseInt(document.getElementById('nanobanana-seed').value);

        const btn = document.getElementById('nanobanana-generate-btn');
        const progress = document.getElementById('nanobanana-progress-text');
        btn.disabled = true;
        progress.textContent = t('nb.generating');

        try {
            const payload = {
                model, prompt, negative_prompt: negative, width, height,
                num_images: batchSize, image_size: imageSize,
                seed: seed === -1 ? Math.floor(Math.random() * 1000000) : seed,
            };
            if (this.i2iImages.length > 0) {
                payload.images = this.i2iImages.map(img => ({ data: img.b64, mime: img.mime }));
            }
            const outputs = await requestNanobananaNativeGenerate(payload);

            this.generatedImages = [];
            for (const im of outputs) {
                const q = `filename=${encodeURIComponent(im.filename)}&subfolder=${encodeURIComponent(im.subfolder || '')}&type=${encodeURIComponent(im.type || 'output')}`;
                const url = `/view?${q}`;
                this.generatedImages.push({ url, b64: await this.urlToBase64(url) });
                if (_eagleSettings.autoSaveNanobanana) {
                    // Eagleは相対パスをプラグイン内ファイルとして扱うため、ComfyUIの/viewは絶対URLで渡す
                    saveToEagle(`${location.origin}${url}`, im.filename, ['comfyui-comic-creator', 'nanobanana', 'comfyui-native']);
                }
            }

            this.lastGenerationMeta = null;
            const recordBtn = document.getElementById('nanobanana-history-record-btn');
            if (recordBtn) recordBtn.disabled = true;

            this.showResult(0);
            progress.textContent = t('common.done');
        } catch (e) {
            console.error('Native generation error:', e);
            alert(t('common.errorPrefix', e.message));
            progress.textContent = t('nb.generationErrorStatus');
        } finally {
            btn.disabled = false;
        }
    }

    // 直近の生成パラメータを履歴ファイルへ記録する（基本設定の自動記録チェック・手動「履歴に記録」ボタン共通）
    async recordHistory({ silent = false } = {}) {
        if (!this.lastGenerationMeta) return;
        try {
            await appendNanobananaHistoryEntry(this.lastGenerationMeta);
            if (!silent) {
                const progress = document.getElementById('nanobanana-progress-text');
                if (progress) progress.textContent = t('nb.historyRecorded');
            }
        } catch (e) {
            console.error('History record error:', e);
            if (!silent) alert(t('nb.historyRecordFailed', e.message));
        }
    }

    // 履歴サブタブを開いた・更新ボタンを押したときに history.jsonl を読み込み、見やすいブロック形式に整形して表示する
    // （保存形式は1行1件のJSONだが、表示は従来どおり日時・設定・プロンプトをまとめたテキストにする）
    async loadHistory() {
        const content = document.getElementById('nanobanana-history-content');
        const pathEl = document.getElementById('nanobanana-history-path');
        if (!content) return;
        try {
            const { entries, path } = await fetchNanobananaHistory();
            content.value = entries.map(formatHistoryEntry).join('\n');
            content.scrollTop = content.scrollHeight;
            if (pathEl) pathEl.textContent = path;
        } catch (e) {
            console.error('History load error:', e);
            content.value = '';
            if (pathEl) pathEl.textContent = t('nb.historyLoadFailed', e.message);
        }
    }

    async urlToBase64(url) {
        const response = await fetch(url);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    // index番目の生成結果をプレビュー表示する。2枚以上ある場合はサムネイル一覧を出し、選んだ画像が挿入対象になる
    showResult(index = 0) {
        if (!this.generatedImages.length) return;
        this.selectedResultIndex = Math.min(Math.max(0, index), this.generatedImages.length - 1);
        const img = document.getElementById('nanobanana-result-img');
        if (img) {
            img.src = this.generatedImages[this.selectedResultIndex].url;
            document.getElementById('nanobanana-insert-btn').disabled = false;
        }

        const thumbs = document.getElementById('nanobanana-result-thumbs');
        if (!thumbs) return;
        if (this.generatedImages.length < 2) {
            thumbs.style.display = 'none';
            thumbs.innerHTML = '';
            return;
        }
        thumbs.innerHTML = '';
        this.generatedImages.forEach((g, i) => {
            const th = document.createElement('img');
            th.src = g.url;
            th.className = 'comfyui-result-thumb' + (i === this.selectedResultIndex ? ' selected' : '');
            th.title = `${i + 1} / ${this.generatedImages.length}`;
            th.addEventListener('click', () => this.showResult(i));
            thumbs.appendChild(th);
        });
        thumbs.style.display = 'flex';
    }

    async insertToPanel() {
        if (!this.generatedImages.length) return;
        const currentImg = this.generatedImages[this.selectedResultIndex] || this.generatedImages[0]; // サムネイルで選択中の画像
        
        if (!state.selectedPanelId) {
            alert(t('nb.selectTargetPanel'));
            return;
        }

        // main.js の insertImage を活用
        const img = new Image();
        img.onload = async () => {
            await insertImage(currentImg.b64, img.width, img.height);
            console.log('Nanobanana image inserted');
        };
        img.src = currentImg.b64;
    }
}

// Nanobanana APIキーの設定状況を確認する（NanobananaManager.refreshApiKey()・
// 半自動マンガのNanobananaモーダル双方から利用する共通ロジック）。
async function checkNanobananaKeyStatus() {
    if (getNanobananaEngine() === 'comfyui') return checkNanobananaNativeStatus();   // 生成方式の設定に従う
    try {
        const response = await fetch('/api/ccc/nanobanana/key');
        const data = await response.json();
        if (data.status === 'ok') return { connected: true, text: t('nb.connected') };
        return { connected: false, text: t('nb.noApiKey') };
    } catch (e) {
        console.error('Failed to fetch Nanobanana key:', e);
        return { connected: false, text: t('nb.serverError') };
    }
}

// ComfyUIネイティブノード経路のCOMFY_API_KEY設定状況を確認する（キー本体は返らない）
async function checkNanobananaNativeStatus() {
    try {
        const response = await fetch('/api/ccc/nanobanana/native/status');
        const data = await response.json();
        if (data.status === 'ok') return { connected: true, text: t('nb.nativeConnected') };
        return { connected: false, text: t('nb.nativeNoKey') };
    } catch (e) {
        console.error('Failed to fetch native Nanobanana status:', e);
        return { connected: false, text: t('nb.serverError') };
    }
}

// ComfyUIネイティブノード経由で生成し、出力画像の情報（filename/subfolder/type）の配列を返す。
// エラー時はresolveBackendErrorで多言語化済みメッセージのErrorをthrowする。
async function requestNanobananaNativeGenerate(payload) {
    const response = await fetch('/api/ccc/nanobanana/native/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (data.status !== 'ok') {
        throw new Error(resolveBackendError(data.error_code, data.error_params) || data.message || t('nb.generateFailed'));
    }
    const images = data.images || [];
    if (images.length === 0) {
        throw new Error(t('nb.noImagesGenerated'));
    }
    return images;
}

// Nanobanana画像生成APIを呼び出し、base64画像文字列の配列を返す（NanobananaManager.generate()・
// 半自動マンガのNanobananaバッチ生成・Autoタブ 共通の入口）。生成方式の設定（getNanobananaEngine）に従い、
// ネイティブ方式ではComfyUIネイティブノードで生成して同じ「base64画像の配列」で返す（return_b64。
// 呼び出し側が自前の保存先へ保存する前提で、ComfyUIのoutputには残さない）。
// エラー時はresolveBackendErrorで多言語化済みメッセージのErrorをthrowする。
async function requestNanobananaGenerate(payload) {
    const native = getNanobananaEngine() === 'comfyui';
    const response = await fetch(native ? '/api/ccc/nanobanana/native/generate' : '/api/ccc/nanobanana/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(native ? { ...payload, return_b64: true } : payload)
    });
    const data = await response.json();
    if (data.status !== 'ok') {
        throw new Error(resolveBackendError(data.error_code, data.error_params) || data.message || t('nb.generateFailed'));
    }
    const images = data.images || [];
    if (images.length === 0) {
        throw new Error(t('nb.noImagesGenerated'));
    }
    return images;
}

// 生成履歴（history.jsonl、1行1件のJSON）をパース済みentriesとして取得する（Nanobananaタブの履歴サブタブ用）
async function fetchNanobananaHistory() {
    const response = await fetch('/api/ccc/nanobanana/history');
    const data = await response.json();
    if (data.status !== 'ok') throw new Error(data.message || 'failed');
    return { entries: data.entries || [], text: data.text || '', path: data.path || '' };
}

// 履歴1件を表示用のブロックテキストに整形する（手編集等で壊れた行はparse_error付きでそのまま表示）
function formatHistoryEntry(e) {
    if (e.parse_error) {
        return `==== (${e.line}行目: 解析エラー) ====\n${e.raw}\n`;
    }
    const lines = [`==== ${e.timestamp || ''} ====`];
    if (e.engine && e.engine !== 'gemini') lines.push(`エンジン: ${e.engine}`);
    if (e.model) lines.push(`モデル: ${e.model}`);
    let res = (e.width && e.height) ? `${e.width}x${e.height}` : '';
    if (e.image_size) res = res ? `${res} / 出力解像度: ${e.image_size}` : `出力解像度: ${e.image_size}`;
    if (res) lines.push(`解像度: ${res}`);
    if (e.seed !== undefined && e.seed !== null && e.seed !== '') lines.push(`シード: ${e.seed}`);
    lines.push('ファイル:');
    (e.filenames || []).forEach(fn => lines.push(`  ${fn}`));
    lines.push(`Positive: ${e.prompt || ''}`);
    if (e.negative_prompt) lines.push(`Negative: ${e.negative_prompt}`);
    return lines.join('\n') + '\n';
}

// 生成1回分の記録をhistory.jsonlへ1行追記する
async function appendNanobananaHistoryEntry(entry) {
    const response = await fetch('/api/ccc/nanobanana/history/append', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
    });
    const data = await response.json();
    if (data.status !== 'ok') {
        throw new Error(resolveBackendError(data.error_code, data.error_params) || data.message || 'failed');
    }
}

// base64/data-URI文字列をdata URLへ正規化し、ファイル拡張子を判定する
// （マジックバイト方式。APIはPNGとは限らずJPEG等を返すため）。
function _normalizeNanobananaImage(b64) {
    let ext = '.png';
    if (!b64.startsWith('data:')) {
        let mime = 'image/png';
        if (b64.startsWith('/9j/'))        { mime = 'image/jpeg'; ext = '.jpg'; }
        else if (b64.startsWith('UklGR'))  { mime = 'image/webp'; ext = '.webp'; }
        else if (b64.startsWith('R0lGOD')) { mime = 'image/gif';  ext = '.gif'; }
        b64 = `data:${mime};base64,` + b64;
    } else {
        const m = b64.match(/^data:image\/(\w+)/);
        if (m) ext = m[1] === 'jpeg' ? '.jpg' : `.${m[1]}`;
    }
    return { dataUrl: b64, ext };
}

async function _saveNanobananaImageToServer(base64, filename) {
    const response = await fetch('/api/ccc/save-nanobanana-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, filename: filename })
    });
    return await response.json();
}

/**
 * Nanobanana生成結果1枚を正規化・サーバー保存し、_eagleSettings.autoSaveNanobananaが
 * 有効な場合はEagleへも自動登録する（NanobananaManager.generate()・半自動マンガの
 * Nanobananaバッチ生成 双方から利用する共通処理）。
 * @param {string} rawB64 APIレスポンスの画像文字列（data URIまたは素のbase64）
 * @param {string} filenamePrefix ファイル名の先頭部分（例: 'nanobanana_0' / 'nanobanana_autocomic'）
 * @param {string[]} [tags]
 * @returns {Promise<{url: string, dataUrl: string}>}
 */
async function saveNanobananaImageAndMaybeEagle(rawB64, filenamePrefix, tags = ['comfyui-comic-creator', 'nanobanana']) {
    const { dataUrl, ext } = _normalizeNanobananaImage(rawB64);
    const filename = `${filenamePrefix}_${Date.now()}${ext}`;
    await _saveNanobananaImageToServer(dataUrl, filename);
    const url = `/ccc_nanobanana_output/${filename}`;
    if (_eagleSettings.autoSaveNanobanana) {
        saveToEagle(url, filename, tags);
    }
    return { url, dataUrl };
}

// 設定タブの「生成方式」。Nanobananaタブ側の選択欄と同じ設定（localStorage）を共有し、互いに連動する
function initNanobananaSettingsUi() {
    const sel = document.getElementById('settings-nanobanana-engine');
    if (!sel) return;
    const statusEl = document.getElementById('settings-nanobanana-engine-status');
    const refresh = async () => {
        sel.value = getNanobananaEngine();
        const { connected, text } = await checkNanobananaKeyStatus();
        if (statusEl) {
            statusEl.textContent = text;
            statusEl.style.color = connected ? '#4caf50' : '#e57373';
        }
    };
    sel.addEventListener('change', () => setNanobananaEngine(sel.value));
    window.addEventListener(ENGINE_EVENT, refresh);
    refresh();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initNanobananaSettingsUi);
else initNanobananaSettingsUi();

// 初期化
let nanobananaManager = null;
function initNanobananaTab() {
    if (!nanobananaManager) {
        nanobananaManager = new NanobananaManager();
    }
}

export { initNanobananaTab, requestNanobananaGenerate, saveNanobananaImageAndMaybeEagle, checkNanobananaKeyStatus, getNanobananaEngine, setNanobananaEngine };

// まだESM化されていない main/以下の classic <script> から呼べるようにするブリッジ
// （ESモジュール化移行中の一時措置。全分割ファイルのESM化が完了したら、
//  各呼び出し元をimport文に置き換えてこのブロックごと削除する）。
window.initNanobananaTab = initNanobananaTab;
