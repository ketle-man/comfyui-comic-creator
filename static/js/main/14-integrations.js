// ============================================================
// main.js 分割ファイル (15/24): Eagle連携+WorkflowStudioギャラリー+GMIC連携
// 元 main.js の行 12796-13097 に相当
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: _eagleApiUrl,_eagleSettings,_eagleSettingsInited,_gmicSettingsInited,_saveEagleSettings,_wfmGalleryLoaded,gmicAbort,gmicInsertResult,gmicOpenGui,gmicState,gmicWaitForJob,initEagleSettings,initGmicSettings,initGmicTab,initWfmGalleryTab,loadWfmGalleryTab,saveToEagle
// ============================================================

// ==============================
// Eagle 連携
// ==============================

const _eagleSettings = (() => {
    try { return JSON.parse(localStorage.getItem('eagle_settings') || '{}'); } catch { return {}; }
})();

function _saveEagleSettings() {
    localStorage.setItem('eagle_settings', JSON.stringify(_eagleSettings));
}

function _eagleApiUrl() {
    return (_eagleSettings.url || 'http://localhost:41595').replace(/\/$/, '');
}

/**
 * Eagle に画像を保存する共通関数
 * @param {string} url      - 画像URL（http/https/相対パス）またはbase64 dataURL
 * @param {string} name     - ファイル名（拡張子付き）
 * @param {string[]} tags   - タグ配列
 * @returns {Promise<{ok: boolean, message: string|null}>} ok=成功可否、messageは失敗時の多言語化済み理由（成功時null）
 */
async function saveToEagle(url, name, tags = []) {
    // start.py プロキシ経由で Eagle API へ転送（CORS回避 + localhost URL変換）
    try {
        const res = await fetch('/api/ccc/eagle/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ eagleUrl: _eagleApiUrl(), url, name, tags }),
        });
        const data = await res.json();
        const ok = data.status === 'success';
        return { ok, message: ok ? null : (resolveBackendError(data.error_code, data.error_params) || data.message || null) };
    } catch (e) {
        console.error('[Eagle] saveToEagle error:', e);
        return { ok: false, message: e.message || null };
    }
}

let _eagleSettingsInited = false;
function initEagleSettings() {
    if (_eagleSettingsInited) return;
    _eagleSettingsInited = true;
    const urlInput   = document.getElementById('settings-eagle-url');
    const testBtn    = document.getElementById('settings-eagle-test-btn');
    const statusEl   = document.getElementById('settings-eagle-status');
    const saveBtn    = document.getElementById('settings-eagle-save-btn');
    const cbComfyUI  = document.getElementById('eagle-auto-save-comfyui');
    const cbNano     = document.getElementById('eagle-auto-save-nanobanana');
    const cbGmic     = document.getElementById('eagle-auto-save-gmic');

    if (!urlInput) return;

    // 保存済み設定を反映
    urlInput.value        = _eagleSettings.url        || 'http://localhost:41595';
    if (cbComfyUI)  cbComfyUI.checked  = !!_eagleSettings.autoSaveComfyUI;
    if (cbNano)     cbNano.checked     = !!_eagleSettings.autoSaveNanobanana;
    if (cbGmic)     cbGmic.checked     = !!_eagleSettings.autoSaveGmic;

    // 接続確認
    if (testBtn) {
        testBtn.addEventListener('click', async () => {
            if (statusEl) statusEl.textContent = t('settings.eagleTesting');
            try {
                const res = await fetch(`${(urlInput.value || '').replace(/\/$/, '')}/api/application/info`, { signal: AbortSignal.timeout(3000) });
                const data = await res.json();
                if (statusEl) statusEl.textContent = data.status === 'success' ? t('settings.eagleConnectOk', data.data?.version || '') : t('settings.eagleConnectFailed');
            } catch {
                if (statusEl) statusEl.textContent = t('settings.eagleConnectFailedHint');
            }
        });
    }

    // 保存
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            _eagleSettings.url                = urlInput.value.trim() || 'http://localhost:41595';
            _eagleSettings.autoSaveComfyUI    = cbComfyUI  ? cbComfyUI.checked  : false;
            _eagleSettings.autoSaveNanobanana = cbNano     ? cbNano.checked     : false;
            _eagleSettings.autoSaveGmic       = cbGmic     ? cbGmic.checked     : false;
            _saveEagleSettings();
            if (statusEl) statusEl.textContent = t('settings.gmicSaved');
            setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);
        });
    }
}

// G'MIC 設定（gmicQtPath はサーバー側 settings.json に保存される）
let _gmicSettingsInited = false;
function initGmicSettings() {
    if (_gmicSettingsInited) return;
    _gmicSettingsInited = true;
    const pathInput = document.getElementById('settings-gmic-path');
    const saveBtn   = document.getElementById('settings-gmic-save-btn');
    const statusEl  = document.getElementById('settings-gmic-status');
    if (!pathInput) return;

    const showStatus = (msg, isError) => {
        if (!statusEl) return;
        statusEl.textContent = msg;
        statusEl.style.color = isError ? '#e57373' : '#888';
    };

    // 保存済み設定を反映
    (async () => {
        try {
            const res = await fetch('/api/ccc/local-gmic/settings');
            const data = await res.json();
            pathInput.value = data.gmicQtPath || '';
            if (data.gmicQtPath && !data.exists) {
                showStatus(t('settings.gmicPathNotFound'), true);
            }
        } catch (e) {
            console.error('[gmic] settings load error:', e);
        }
    })();

    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            try {
                const res = await fetch('/api/ccc/local-gmic/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ gmicQtPath: pathInput.value.trim() }),
                });
                const data = await res.json();
                if (data.status !== 'ok') throw new Error(data.detail || 'save failed');
                if (pathInput.value.trim() && !data.exists) {
                    showStatus(t('settings.gmicPathNotFound'), true);
                } else {
                    showStatus(t('settings.gmicSaved'), false);
                    setTimeout(() => { if (statusEl && statusEl.textContent === t('settings.gmicSaved')) statusEl.textContent = ''; }, 2000);
                }
            } catch (e) {
                console.error('[gmic] settings save error:', e);
                showStatus(e.message || t('settings.gmicSaveFailed'), true);
            }
        });
    }
}

// I2I設定（デフォルトワークフロー。ブラウザのlocalStorageに保存、ファイル本体はComfyUIのuser/default/workflows配下）
const _i2iSettings = (() => {
    try { return JSON.parse(localStorage.getItem('ccc_i2i_settings') || '{}'); } catch { return {}; }
})();

function _saveI2ISettings() {
    localStorage.setItem('ccc_i2i_settings', JSON.stringify(_i2iSettings));
}

let _i2iSettingsInited = false;
function initI2ISettings() {
    if (_i2iSettingsInited) return;
    _i2iSettingsInited = true;
    const enabledCb = document.getElementById('settings-i2i-default-wf-enabled');
    const nameInput = document.getElementById('settings-i2i-default-wf-name');
    const saveBtn   = document.getElementById('settings-i2i-save-btn');
    const statusEl  = document.getElementById('settings-i2i-status');
    if (!enabledCb) return;

    enabledCb.checked = !!_i2iSettings.defaultWorkflowEnabled;
    if (nameInput) nameInput.value = _i2iSettings.defaultWorkflowFile || 'cc_i2i_default.json';

    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            _i2iSettings.defaultWorkflowEnabled = enabledCb.checked;
            _i2iSettings.defaultWorkflowFile    = (nameInput?.value || '').trim() || 'cc_i2i_default.json';
            _saveI2ISettings();
            if (statusEl) statusEl.textContent = t('settings.gmicSaved');
            setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);
        });
    }
}

// ==============================
// Workflow Studio ギャラリー (iframe埋め込み)
// ==============================

let _wfmGalleryLoaded = false;

function initWfmGalleryTab() {
    const reloadBtn = document.getElementById('ws-nav-reload-btn');
    if (reloadBtn) {
        reloadBtn.addEventListener('click', () => {
            const iframe = document.getElementById('wfmgallery-iframe');
            if (_wfmGalleryLoaded && iframe && iframe.style.display !== 'none') {
                try {
                    iframe.contentWindow.location.reload();
                    return;
                } catch (e) {
                    // 同一オリジンでない等の理由で失敗した場合は下のフルリロードにフォールバック
                }
            }
            _wfmGalleryLoaded = false;
            loadWfmGalleryTab();
        });
    }
}

// iframeのロード完了（onload）まで待てるよう Promise化。既存呼び出し元は戻り値を使わないため後方互換。
async function loadWfmGalleryTab() {
    if (_wfmGalleryLoaded) return true;
    _wfmGalleryLoaded = true;

    const iframe = document.getElementById('wfmgallery-iframe');
    const fallback = document.getElementById('wfmgallery-fallback');
    if (!iframe || !fallback) return false;

    fallback.style.display = 'none';
    iframe.style.display = 'none';

    try {
        const res = await fetch('/wfm', { method: 'GET' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
        fallback.textContent = t('settings.wfmNotFound');
        fallback.style.display = 'flex';
        _wfmGalleryLoaded = false;
        return false;
    }

    await new Promise(resolve => {
        iframe.onload = () => {
            // 同一オリジンのため、iframe内のGalleryタブを自動選択する
            try {
                const doc = iframe.contentWindow.document;
                const galleryTabBtn = doc.querySelector('.wfm-tab[data-tab="gallery"]');
                if (galleryTabBtn) galleryTabBtn.click();
            } catch (e) {
                console.warn('[WFM Gallery] Galleryタブの自動選択に失敗:', e);
            }
            resolve();
        };
        iframe.src = '/wfm';
        iframe.style.display = '';
    });
    return true;
}

// ==============================
// I2I連携（Workflow Studio）
// ==============================

/**
 * Comic Creater側の画像(Blob)をWorkflow Studio(iframe)のGenerate UI Image入力スロットへ送信する。
 * 送信元は Send CC ボタン押下時の戻り先分岐のため window._ccI2ITargetMode に記録しておく
 * （Workflow Studio側の gallery-tab.js がこのフラグを window.parent 経由で参照する）。
 * @param {Blob} blob
 * @param {string} name
 * @param {'layout'|'image'} sourceTab
 * @returns {Promise<boolean>}
 */
async function sendImageToWorkflowStudioI2I(blob, name, sourceTab) {
    window._ccI2ITargetMode = sourceTab;

    await switchTab('wfmgallery');

    const iframe = document.getElementById('wfmgallery-iframe');
    const fn = iframe?.contentWindow?._wfmReceiveImageForI2I;
    if (typeof fn !== 'function') {
        alert(t('layout.msgWfmI2INotReady'));
        return false;
    }
    // 同じ画像を続けて送信すると同名ファイルの上書きになり、Workflow Studio側の
    // プレビュー<img>がURL文字列不変のためブラウザキャッシュで更新されない（実際に
    // アップロードされる内容自体は最新のまま）。送信のたびにファイル名をユニーク化して回避する
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${pad(now.getMilliseconds()).padStart(3, '0')}`;
    const safeBase = (name || 'cc-image').replace(/\.[^.]+$/, '');
    const uniqueName = `${safeBase}-${ts}.png`;

    // 設定タブでデフォルトワークフローが有効な場合、送信前にそのワークフローJSONを取得して
    // Workflow Studio側に渡す（同一オリジンのWorkflow Studio独自API、user/default/workflows配下が対象）
    let workflowData = null;
    let workflowFilename = null;
    if (_i2iSettings.defaultWorkflowEnabled && _i2iSettings.defaultWorkflowFile) {
        workflowFilename = _i2iSettings.defaultWorkflowFile;
        try {
            const wfRes = await fetch(`/api/wfm/workflows/raw?filename=${encodeURIComponent(workflowFilename)}`);
            if (wfRes.ok) {
                workflowData = await wfRes.json();
            } else {
                console.warn('[I2I] default workflow fetch failed:', wfRes.status);
            }
        } catch (e) {
            console.warn('[I2I] default workflow fetch error:', e);
        }
    }

    try {
        return await fn(blob, uniqueName, workflowData, workflowFilename);
    } catch (e) {
        console.error('[I2I] sendImageToWorkflowStudioI2I error:', e);
        alert(t('layout.msgWfmI2ISendFailed', e.message));
        return false;
    }
}

// ==============================
// G'MIC連携
// ==============================

const gmicState = {
    lastResultJobId: null,
    processing: false,
    aborted: false,
};

function initGmicTab() {
    const openGuiBtn = document.getElementById('gmic-open-gui-btn');
    const insertBtn  = document.getElementById('gmic-insert-result-btn');
    const abortBtn   = document.getElementById('gmic-abort-btn');

    if (openGuiBtn) openGuiBtn.addEventListener('click', () => gmicOpenGui());
    if (insertBtn)  insertBtn.addEventListener('click',  () => gmicInsertResult());
    if (abortBtn)   abortBtn.addEventListener('click',   () => gmicAbort());
}

async function gmicOpenGui() {
    if (gmicState.processing) return;

    const imgEl = state.selectedImageEl;
    if (!imgEl) {
        alert(t('layout.msgSelectImageFirst'));
        return;
    }

    const href = imgEl.getAttribute('href') || imgEl.getAttribute('xlink:href') || '';
    if (!href.startsWith('data:image/')) {
        alert(t('layout.msgNotImageOrNotBase64'));
        return;
    }

    gmicState.processing = true;
    const openGuiBtn   = document.getElementById('gmic-open-gui-btn');
    const progressArea = document.getElementById('gmic-progress-area');
    const progressText = document.getElementById('gmic-progress-text');
    if (openGuiBtn)   openGuiBtn.disabled = true;
    if (progressArea) progressArea.style.display = 'flex';
    if (progressText) progressText.textContent = t('image.gmicSendingImage');

    try {
        const res = await fetch('/api/ccc/local-gmic/open_in_gui_b64', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_b64: href })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(resolveBackendError(err.error_code, err.error_params) || err.detail || `HTTP ${res.status}`);
        }
        const data = await res.json();
        gmicState.lastResultJobId = data.job_id;
        if (progressText) progressText.textContent = t('layout.gmicEditingAutoSaveHint');
        await gmicWaitForJob(data.job_id);
    } catch (e) {
        if (e.message !== '__aborted__') alert(t('layout.gmicProcessError', e.message));
    } finally {
        gmicState.processing = false;
        gmicState.aborted = false;
        if (openGuiBtn)   openGuiBtn.disabled = false;
        if (progressArea) progressArea.style.display = 'none';
    }
}

function gmicAbort(reason) {
    gmicState.aborted = true;
    gmicState.processing = false;
    const progressArea = document.getElementById('gmic-progress-area');
    const progressText = document.getElementById('gmic-progress-text');
    const openGuiBtn   = document.getElementById('gmic-open-gui-btn');
    if (openGuiBtn)   openGuiBtn.disabled = false;
    if (progressArea) progressArea.style.display = 'none';
    if (progressText) progressText.textContent = '';
    if (reason) console.log('[gmic] abort:', reason);
}

async function gmicWaitForJob(jobId) {
    const progressText = document.getElementById('gmic-progress-text');
    const insertBtn    = document.getElementById('gmic-insert-result-btn');
    const maxWait = 600;
    const interval = 2000;
    const start = Date.now();
    gmicState.aborted = false;

    while (true) {
        if (gmicState.aborted) throw new Error('__aborted__');
        if ((Date.now() - start) / 1000 > maxWait) throw new Error(t('layout.gmicTimeoutError'));
        await new Promise(r => setTimeout(r, interval));
        if (gmicState.aborted) throw new Error('__aborted__');
        try {
            const res = await fetch(`/api/ccc/local-gmic/status/${jobId}`, { signal: AbortSignal.timeout(5000) });
            if (res.status === 404) {
                if (progressText) progressText.textContent = t('layout.gmicServerRestarted');
                throw new Error('__aborted__');
            }
            if (!res.ok) continue;
            const status = await res.json();
            if (status.status === 'completed') {
                gmicState.lastResultJobId = jobId;
                if (insertBtn)    insertBtn.disabled = false;
                if (progressText) progressText.textContent = t('layout.gmicInsertHint');
                return;
            }
            if (status.status === 'failed') {
                if (progressText) progressText.textContent = resolveBackendError(status.error_code, status.error_params) || t('image.gmicCancelled');
                throw new Error('__aborted__');
            }
            if (progressText) progressText.textContent = resolveBackendError(status.message_code, null) || t('image.gmicEditing');
        } catch (e) {
            if (e.message === '__aborted__' || e.message === t('layout.gmicTimeoutError')) throw e;
        }
    }
}

async function gmicInsertResult() {
    if (!gmicState.lastResultJobId) {
        alert(t('layout.gmicNoResultToInsert'));
        return;
    }
    try {
        const statusRes = await fetch(`/api/ccc/local-gmic/status/${gmicState.lastResultJobId}`);
        if (!statusRes.ok) {
            const err = await statusRes.json().catch(() => ({}));
            throw new Error(resolveBackendError(err.error_code, err.error_params) || err.detail || `HTTP ${statusRes.status}`);
        }
        const statusData = await statusRes.json();
        if (!statusData.result_path) throw new Error(t('layout.gmicNoResultFile'));

        const b64res = await fetch('/api/ccc/local-gmic/result_b64', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ result_path: statusData.result_path })
        });
        if (!b64res.ok) {
            const err = await b64res.json().catch(() => ({}));
            throw new Error(resolveBackendError(err.error_code, err.error_params) || err.detail || `HTTP ${b64res.status}`);
        }
        const { image_b64: dataUrl } = await b64res.json();
        // Eagle 自動保存
        if (_eagleSettings.autoSaveGmic) {
            const gname = `gmic_${Date.now()}.png`;
            saveToEagle(dataUrl, gname, ['comfyui-comic-creater', 'gmic']);
        }
        const img = new Image();
        img.onload = async () => { await insertImage(dataUrl, img.width, img.height); };
        img.onerror = () => alert(t('layout.msgImageLoadFailed'));
        img.src = dataUrl;
    } catch (e) {
        alert(t('layout.gmicInsertError', e.message));
    }
}

