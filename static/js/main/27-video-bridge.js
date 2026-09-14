// ============================================================
// main.js 分割ファイル (追加): 動画ツール（レイアウトタブ MP4操作・フレームキャプチャ）
// type="module" として読み込まれる。
// 主なトップレベル定義: showVideoOverlay,hideVideoOverlay,initVideoTab,captureCurrentFrame,
//   insertVideoFromUrl,handleInsertVideoFromLocal
// 未ESM化の外部依存（08-panels-images.js/04b-layer-panel-render.js からの選択連動フックは
// 相互importの複雑化を避けるためwindow._ccVideoOnObjectSelected経由で呼ぶ）
// ============================================================

import { t } from '../i18n.js';
import { insertImage } from './08-panels-images.js';
import { state, switchTab } from './01-state.js';

// ============================================================
// 動画ツール（レイアウトタブ: MP4配置・再生操作・フレームキャプチャ）
// SVG上は代表フレームのサムネイル画像（<image data-video-src="...">）として存在し、
// 動画本体は常にサーバーURL参照（IndexedDBへは複製保存しない）。
// 選択中に「動画」サブタブを開くと、その位置に<video>要素をオーバーレイ表示して操作する
// （3Dポーズ/3Dテキストと同じ「オーバーレイ表示+確定」パターンだが、動画は確定
//  （フレームキャプチャ）後も元オブジェクトが残り続ける点が異なる＝再選択すれば
//  何度でも操作・キャプチャできる。他のコマでの使い回しを想定しているため）。
// ============================================================

function _videoResolvePanelId(imgEl) {
    return imgEl.closest('g[data-clip-panel]')?.getAttribute('data-clip-panel')
        || imgEl.getAttribute('data-panel-id')
        || state.selectedPanelId
        || 'panel-0';
}

function _videoFormatTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

// ---- 音量・ミュート設定（ブラウザに保存し、次回開いたときも引き継ぐ） ----
const _VIDEO_VOLUME_LS_KEY = 'cccVideoVolume';
const _VIDEO_MUTED_LS_KEY  = 'cccVideoMuted';

function _videoLoadVolumeSettings() {
    let volume = 1;
    try {
        const raw = localStorage.getItem(_VIDEO_VOLUME_LS_KEY);
        if (raw !== null) volume = Math.min(1, Math.max(0, parseFloat(raw)));
        if (!isFinite(volume)) volume = 1;
    } catch (_) { /* localStorage不可時は既定値のまま */ }
    let muted = false;
    try { muted = localStorage.getItem(_VIDEO_MUTED_LS_KEY) === '1'; } catch (_) {}
    return { volume, muted };
}

function _videoSaveVolumeSettings(video) {
    try {
        localStorage.setItem(_VIDEO_VOLUME_LS_KEY, String(video.volume));
        localStorage.setItem(_VIDEO_MUTED_LS_KEY, video.muted ? '1' : '0');
    } catch (_) { /* 保存できなくても動作に支障はない */ }
}

// コマのSVG座標を手動変換する3Dポーズ方式と異なり、動画オブジェクトは実DOM要素
// （<image data-video-src>）が既に存在するため、その表示矩形をそのまま使う
// （回転済みオブジェクトはgetBoundingClientRectが軸並行の外接矩形になるため、
//  その場合はオーバーレイがやや大きめに表示される簡略化事項として許容する）。
function _videoSyncPosition(imgEl) {
    const previewContainer = document.getElementById('layout-preview');
    const wrapper = state.video.wrapper;
    if (!previewContainer || !wrapper || !imgEl || !imgEl.isConnected) return;

    const rect = imgEl.getBoundingClientRect();
    const parentRect = previewContainer.getBoundingClientRect();
    wrapper.style.left   = `${rect.left - parentRect.left + previewContainer.scrollLeft}px`;
    wrapper.style.top    = `${rect.top  - parentRect.top  + previewContainer.scrollTop}px`;
    wrapper.style.width  = `${rect.width}px`;
    wrapper.style.height = `${rect.height}px`;
}

function _videoUpdateControlsUI() {
    const video = state.video.wrapper?.querySelector('video');
    if (!video) return;
    const playBtn = document.getElementById('video-play-btn');
    const seek = document.getElementById('video-seek');
    const timeLabel = document.getElementById('video-time-label');
    const muteBtn = document.getElementById('video-mute-btn');
    const volumeSlider = document.getElementById('video-volume');
    if (playBtn) playBtn.textContent = video.paused ? '▶' : '⏸';
    if (seek && isFinite(video.duration) && video.duration > 0) {
        seek.value = String(Math.round((video.currentTime / video.duration) * 1000));
    }
    if (timeLabel) {
        const dur = isFinite(video.duration) ? video.duration : 0;
        timeLabel.textContent = `${_videoFormatTime(video.currentTime)} / ${_videoFormatTime(dur)}`;
    }
    if (muteBtn) muteBtn.textContent = video.muted ? '🔇' : '🔊';
    if (volumeSlider) volumeSlider.value = String(Math.round(video.volume * 100));
}

// ---- オーバーレイ表示/非表示 ----

function showVideoOverlay(panelId, imgEl) {
    const previewContainer = document.getElementById('layout-preview');
    if (!previewContainer || !imgEl) return;
    previewContainer.style.position = 'relative';

    // ---- ラッパーとvideo要素を作成（初回のみ） ----
    if (!state.video.wrapper) {
        const wrapper = document.createElement('div');
        wrapper.id = 'video-overlay-wrapper';
        wrapper.style.cssText =
            'position:absolute; z-index:150; overflow:hidden; opacity:0; pointer-events:none; ' +
            'border:2px solid #4090e0; box-sizing:border-box; background:#000;';

        const video = document.createElement('video');
        video.id = 'video-overlay-el';
        video.playsInline = true;
        video.style.cssText = 'width:100%; height:100%; object-fit:contain; display:block;';
        const { volume, muted } = _videoLoadVolumeSettings();
        video.volume = volume;
        video.muted = muted;
        video.addEventListener('timeupdate', _videoUpdateControlsUI);
        video.addEventListener('loadedmetadata', _videoUpdateControlsUI);
        video.addEventListener('play', _videoUpdateControlsUI);
        video.addEventListener('pause', _videoUpdateControlsUI);
        video.addEventListener('volumechange', () => {
            _videoUpdateControlsUI();
            _videoSaveVolumeSettings(video);
        });

        wrapper.appendChild(video);
        state.video.wrapper = wrapper;
    }

    // レイアウト再描画でDOMから切り離される場合があるため毎回再追加
    if (!previewContainer.contains(state.video.wrapper)) {
        previewContainer.appendChild(state.video.wrapper);
    }

    // 動画srcの切替（同じ動画を選び直した場合は再ロードしない＝再生位置を保つ）
    const video = state.video.wrapper.querySelector('video');
    const src = imgEl.dataset.videoSrc || '';
    if (video.getAttribute('data-loaded-src') !== src) {
        video.pause();
        video.src = src;
        video.setAttribute('data-loaded-src', src);
        video.currentTime = 0;
    }

    state.video.activePanelId = panelId;
    state.video.activeImgEl = imgEl;
    state.video.wrapper.style.opacity = '1';
    state.video.wrapper.style.pointerEvents = 'auto';
    void previewContainer.getBoundingClientRect(); // レイアウト強制再計算
    _videoSyncPosition(imgEl);

    // ResizeObserver でSVG/コンテナのリサイズに追従
    if (state.video.resizeObserver) state.video.resizeObserver.disconnect();
    state.video.resizeObserver = new ResizeObserver(() => {
        if (state.video.activeImgEl) _videoSyncPosition(state.video.activeImgEl);
    });
    const svgEl = document.querySelector('#layout-preview #image-layer svg');
    if (svgEl) state.video.resizeObserver.observe(svgEl);
    state.video.resizeObserver.observe(previewContainer);

    // サブタブUI更新
    const emptyHint = document.getElementById('video-empty-hint');
    const controls  = document.getElementById('video-controls');
    if (emptyHint) emptyHint.style.display = 'none';
    if (controls) controls.style.display = 'flex';
    const nameEl = document.getElementById('video-filename');
    if (nameEl) { nameEl.textContent = imgEl.dataset.videoName || ''; nameEl.title = imgEl.dataset.videoName || ''; }
    const statusEl = document.getElementById('video-status');
    if (statusEl) statusEl.textContent = '';
    _videoUpdateControlsUI();
}

function hideVideoOverlay() {
    if (state.video.wrapper) {
        const video = state.video.wrapper.querySelector('video');
        if (video) video.pause();
        state.video.wrapper.style.opacity = '0';
        state.video.wrapper.style.pointerEvents = 'none';
    }
    if (state.video.resizeObserver) {
        state.video.resizeObserver.disconnect();
        state.video.resizeObserver = null;
    }
    state.video.activePanelId = null;
    state.video.activeImgEl = null;

    const emptyHint = document.getElementById('video-empty-hint');
    const controls  = document.getElementById('video-controls');
    if (emptyHint) emptyHint.style.display = '';
    if (controls) controls.style.display = 'none';
}

// 動画サブタブがアクティブな間だけ、選択オブジェクトの変化に連動してオーバーレイを出し入れする
// （08-panels-images.js の selectImage/背景クリックでの選択解除、04b-layer-panel-render.js の
//  レイヤー行クリックから window._ccVideoOnObjectSelected 経由で呼ばれる）
function _ccVideoOnObjectSelected(el) {
    const videoTabActive = document.querySelector('.subtab-btn[data-subtab="video"]')?.classList.contains('active');
    if (!videoTabActive) return; // 動画サブタブを見ていない間はDOM操作しない（軽量ガード）
    if (el && el.dataset && el.dataset.videoSrc) {
        showVideoOverlay(_videoResolvePanelId(el), el);
    } else {
        hideVideoOverlay();
    }
}

// ---- サブタブUIの操作バインド ----

function initVideoTab() {
    const playBtn = document.getElementById('video-play-btn');
    const stopBtn = document.getElementById('video-stop-btn');
    const seek = document.getElementById('video-seek');
    const captureBtn = document.getElementById('video-capture-btn');
    const localInput = document.getElementById('video-local-input');
    const muteBtn = document.getElementById('video-mute-btn');
    const volumeSlider = document.getElementById('video-volume');

    playBtn?.addEventListener('click', () => {
        const video = state.video.wrapper?.querySelector('video');
        if (!video) return;
        if (video.paused) video.play(); else video.pause();
    });
    stopBtn?.addEventListener('click', () => {
        const video = state.video.wrapper?.querySelector('video');
        if (!video) return;
        video.pause();
        video.currentTime = 0;
    });
    seek?.addEventListener('input', () => {
        const video = state.video.wrapper?.querySelector('video');
        if (!video || !isFinite(video.duration) || video.duration <= 0) return;
        video.currentTime = (parseFloat(seek.value) / 1000) * video.duration;
    });
    muteBtn?.addEventListener('click', () => {
        const video = state.video.wrapper?.querySelector('video');
        if (!video) return;
        video.muted = !video.muted;
    });
    volumeSlider?.addEventListener('input', () => {
        const video = state.video.wrapper?.querySelector('video');
        if (!video) return;
        video.volume = Math.min(1, Math.max(0, parseFloat(volumeSlider.value) / 100));
        // スライダーを動かして音量を上げたら自動的にミュート解除する（一般的なプレーヤーのUX）
        if (video.volume > 0 && video.muted) video.muted = false;
    });
    captureBtn?.addEventListener('click', () => captureCurrentFrame());
    localInput?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (file) await handleInsertVideoFromLocal(file);
    });
}

// ---- フレームキャプチャ（動画オブジェクト自体は変更しない。他コマでの再利用を想定） ----

async function captureCurrentFrame() {
    const video = state.video.wrapper?.querySelector('video');
    const panelId = state.video.activePanelId;
    if (!video || !panelId || !video.videoWidth) {
        alert(t('layout.videoSelectFirst'));
        return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');

    // insertImage は state.selectedPanelId を見て挿入先を決めるため、動画オブジェクトが
    // 属するコマへ一時的に切り替える（_pose3dInsertCaptureIntoPanelと同じ手法）
    const prevPanelId = state.selectedPanelId;
    state.selectedPanelId = panelId;
    const activeImgId = state.video.activeImgEl?.id || null;
    await insertImage(dataUrl, canvas.width, canvas.height);
    state.selectedPanelId = prevPanelId;

    // insertImage は成功時に renderLayoutTab() でDOMを再構築するため、選択中の
    // <image data-video-src> は古い参照のままになる。同じidの新しいDOM要素を再取得する
    if (activeImgId) {
        const refreshed = document.getElementById(activeImgId);
        if (refreshed) state.video.activeImgEl = refreshed;
    }

    const statusEl = document.getElementById('video-status');
    if (statusEl) {
        statusEl.textContent = t('layout.videoFrameCaptured');
        setTimeout(() => { if (statusEl.textContent === t('layout.videoFrameCaptured')) statusEl.textContent = ''; }, 2000);
    }
}

// ---- 動画URLからの挿入（Send CC / ローカルアップロード共通の着地点） ----

async function insertVideoFromUrl(url, filename) {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    let thumbDataUrl, vw, vh;
    try {
        await new Promise((resolve, reject) => {
            video.addEventListener('loadeddata', () => {
                try {
                    vw = video.videoWidth || 1280;
                    vh = video.videoHeight || 720;
                    const canvas = document.createElement('canvas');
                    canvas.width = vw;
                    canvas.height = vh;
                    canvas.getContext('2d').drawImage(video, 0, 0);
                    thumbDataUrl = canvas.toDataURL('image/jpeg', 0.85);
                    resolve();
                } catch (e) { reject(e); }
            }, { once: true });
            video.addEventListener('error', () => reject(new Error('video load failed')), { once: true });
            video.src = url;
        });
    } catch (e) {
        alert(t('layout.msgVideoUploadFailed', e.message));
        return false;
    }

    const ok = await insertImage(thumbDataUrl, vw, vh, {
        'data-video-src':  url,
        'data-video-name': filename || '',
    });
    if (ok) {
        await switchTab('layout');
        document.querySelector('.subtab-btn[data-subtab="video"]')?.click();
    }
    return ok;
}

// ---- ローカルファイルのアップロード（D&D / ファイル選択ボタン共通） ----

async function handleInsertVideoFromLocal(file) {
    const isMp4 = file.type === 'video/mp4' || file.name.toLowerCase().endsWith('.mp4');
    if (!isMp4) {
        alert(t('layout.msgDropVideoFileOnly'));
        return false;
    }
    const statusEl = document.getElementById('video-status');
    if (statusEl) statusEl.textContent = t('common.uploading');
    try {
        const fd = new FormData();
        fd.append('file', file, file.name);
        const res = await fetch('/api/ccc/video/upload', { method: 'POST', body: fd });
        const json = await res.json();
        if (!res.ok || json.status !== 'ok') throw new Error(json.message || `HTTP ${res.status}`);
        return await insertVideoFromUrl(json.url, file.name);
    } catch (e) {
        alert(t('layout.msgVideoUploadFailed', e.message));
        return false;
    } finally {
        if (statusEl) statusEl.textContent = '';
    }
}

export {
    showVideoOverlay, hideVideoOverlay, initVideoTab,
    captureCurrentFrame, insertVideoFromUrl, handleInsertVideoFromLocal,
};

// 08-panels-images.js / 04b-layer-panel-render.js からの選択連動フックと、
// Workflow Studio（別リポジトリ、iframe埋め込み）の「Send CC」からの呼び出し用
window._ccVideoOnObjectSelected = _ccVideoOnObjectSelected;
window.insertVideoFromUrl = insertVideoFromUrl;
window.handleInsertVideoFromLocal = handleInsertVideoFromLocal;
