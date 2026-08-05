/**
 * Nanobanana API 連携ロジック
 * type="module" として読み込まれる（ESモジュール化 G6）。
 */

import { t, resolveBackendError } from './i18n.js';
import { insertImage } from './main/08-panels-images.js';
import { saveToEagle, _eagleSettings } from './main/14-integrations.js';
import { state } from './main/01-state.js';

class NanobananaManager {
    constructor() {
        this.status = 'disconnected';
        this.i2iImages = [];   // { b64: 'data:...', mime: 'image/png' }[]  最大12枚
        this.MAX_I2I = 12;
        this.generatedImages = [];
        this.apiUrl = '/api/ccc/nanobanana/generate';

        this.init();
    }

    async init() {
        console.log('NanobananaManager Initializing...');
        await this.refreshApiKey();
        this.bindEvents();
        this.renderI2IGrid();
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
            });
        });

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
        if (countEl) countEl.textContent = `(${count}/12)`;

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

        const model = document.getElementById('nanobanana-model').value;
        const negative = document.getElementById('nanobanana-negative').value;
        const resolution = document.getElementById('nanobanana-resolution').value;
        const [width, height] = resolution.split('x').map(Number);
        const is2k = document.getElementById('nanobanana-2k')?.checked;
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
            if (is2k) payload.image_size = '2K';

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

            this.showResult(this.generatedImages[0].url);
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

    showResult(url) {
        const img = document.getElementById('nanobanana-result-img');
        if (img) {
            img.src = url;
            document.getElementById('nanobanana-insert-btn').disabled = false;
        }
        
        // 複数枚ある場合のサムネイル表示 (TBD)
    }

    async insertToPanel() {
        if (!this.generatedImages.length) return;
        const currentImg = this.generatedImages[0]; // ひとまず最初の1枚
        
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

// Nanobanana画像生成APIを呼び出し、base64画像文字列の配列を返す（NanobananaManager.generate()・
// 半自動マンガのNanobananaバッチ生成 双方から利用）。エラー時はresolveBackendErrorで
// 多言語化済みメッセージのErrorをthrowする。
async function requestNanobananaGenerate(payload) {
    const response = await fetch('/api/ccc/nanobanana/generate', {
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

// 初期化
let nanobananaManager = null;
function initNanobananaTab() {
    if (!nanobananaManager) {
        nanobananaManager = new NanobananaManager();
    }
}

export { initNanobananaTab, requestNanobananaGenerate, saveNanobananaImageAndMaybeEagle, checkNanobananaKeyStatus };

// まだESM化されていない main/以下の classic <script> から呼べるようにするブリッジ
// （ESモジュール化移行中の一時措置。全分割ファイルのESM化が完了したら、
//  各呼び出し元をimport文に置き換えてこのブロックごと削除する）。
window.initNanobananaTab = initNanobananaTab;
