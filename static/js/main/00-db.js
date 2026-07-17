// ============================================================
// main.js 分割ファイル (1/24): IndexedDB初期化・操作レイヤー+FileReaderユーティリティ
// 元 main.js の行 1-153 に相当
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: DB_NAME,DB_VERSION,db,dbDelete,dbGet,dbGetAll,dbGetAllPagesMeta,dbPut,openDB,readFileAsDataURL,readFileAsText,svgTextToDataUrl
// ============================================================

// ==============================
// IndexedDB 初期化・操作レイヤー
// ==============================

const DB_NAME = 'ComicCreatorDB';
const DB_VERSION = 4;
let db = null;

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            if (!database.objectStoreNames.contains('templates')) {
                database.createObjectStore('templates', { keyPath: 'name' });
            }
            // v2: pagesストアを再作成（旧フォーマットをクリーンアップ）
            if (event.oldVersion < 2) {
                if (database.objectStoreNames.contains('pages')) {
                    database.deleteObjectStore('pages');
                }
                database.createObjectStore('pages', { keyPath: 'name' });
            }
            // v3: ゴミ箱ストアを追加（削除済みページの一時保管）
            if (!database.objectStoreNames.contains('trash')) {
                database.createObjectStore('trash', { keyPath: 'name' });
            }
            // v4: settingsストアを追加（出力タブのページ並び順などの設定値）
            if (!database.objectStoreNames.contains('settings')) {
                database.createObjectStore('settings', { keyPath: 'id' });
            }
        };
        // 旧バージョンを開いたままの他タブがあると版上げが保留される
        request.onblocked = () => {
            console.warn('[DB] 他のタブが古いバージョンのDBを開いているため、アップグレードが保留されています。');
            alert(t('db.blockedAlert'));
        };
        request.onsuccess = (event) => {
            const database = event.target.result;
            // 他タブが版上げを要求したら接続を閉じて譲る（このタブは要リロード）
            database.onversionchange = () => {
                database.close();
                alert(t('db.versionChangedAlert'));
            };
            resolve(database);
        };
        request.onerror = (event) => reject(event.target.error);
    });
}

// サムネイル長辺の上限（px）。作品切替のたびにフルサイズ画像入りSVGを
// 再デコードしてメモリを食い潰すのを防ぐため、保存時に必ずこのサイズへ縮小する
const THUMB_MAX_DIM = 320;

// SVGテキスト（挿入画像のbase64を含む可能性がある）を、指定サイズ内に収まる
// 圧縮済みJPEGのdata URLへラスタ化する。失敗時はnullを返す（サムネイルなし表示にフォールバック）
function _rasterizeSvgThumb(svgText, srcWidth, srcHeight) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            try {
                const sw = srcWidth || img.naturalWidth || img.width || 1;
                const sh = srcHeight || img.naturalHeight || img.height || 1;
                const scale = Math.min(1, THUMB_MAX_DIM / Math.max(sw, sh));
                const w = Math.max(1, Math.round(sw * scale));
                const h = Math.max(1, Math.round(sh * scale));
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                // JPEGは透過を持てないため、白背景に描画してから圧縮する
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, w, h);
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', 0.75));
            } catch (e) { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = svgTextToDataUrl(svgText);
    });
}

function _dbPutRaw(storeName, data) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.put(data);
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e.target.error);
    });
}

// レイアウトタブでのコマ編集は1操作ごとにdbPutが走る（savePanelSvg/saveOverlaySvg経由）。
// サムネイル再計算(buildMergedSvg + 画像デコード + canvas描画)を都度同期実行すると
// 操作のたびに固まって見えるため、id単位でdebounceしてまとめて1回だけ実行する。
const _THUMB_DEBOUNCE_MS = 600;
const _thumbDebounceTimers = new Map();

function _scheduleThumbUpdate(storeName, data) {
    const key = storeName + ':' + data.name;
    const existing = _thumbDebounceTimers.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(async () => {
        _thumbDebounceTimers.delete(key);
        try {
            const merged = buildMergedSvg(data) || data.svgContent;
            data.thumb = await _rasterizeSvgThumb(merged, data.width, data.height);
            await _dbPutRaw(storeName, data);
        } catch (e) { /* サムネイル生成失敗は無視（次回保存時に再試行される） */ }
    }, _THUMB_DEBOUNCE_MS);
    _thumbDebounceTimers.set(key, timer);
}

// opts.deferThumb=true の場合、サムネイル計算をdebounceして保存を即座に返す。
// レイアウトタブ内の高頻度なコマ編集保存（savePanelSvg/saveOverlaySvg）から使う。
// 未指定時は従来通り、保存前にサムネイルを同期計算して埋め込む
// （作品一覧・ページ一覧側がdbPut直後のdata.thumbを読む箇所があるため）。
async function dbPut(storeName, data, opts) {
    const deferThumb = !!(opts && opts.deferThumb);
    if ((storeName === 'pages' || storeName === 'trash') && data && data.svgContent) {
        if (deferThumb) {
            _scheduleThumbUpdate(storeName, data);
        } else {
            try {
                const merged = buildMergedSvg(data) || data.svgContent;
                data.thumb = await _rasterizeSvgThumb(merged, data.width, data.height);
            } catch (e) { /* サムネイル生成失敗は保存自体をブロックしない */ }
        }
    }
    return _dbPutRaw(storeName, data);
}

function dbGet(storeName, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.get(key);
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

function dbGetAll(storeName) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

// pages ストア専用: SVGコンテンツを除いた軽量メタデータのみ取得
function dbGetAllPagesMeta() {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('pages', 'readonly');
        const store = tx.objectStore('pages');
        const results = [];
        const req = store.openCursor();
        req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                const v = cursor.value;
                results.push({
                    name: v.name,
                    id: v.id,
                    originalTemplate: v.originalTemplate,
                    width: v.width,
                    height: v.height,
                    thumb: v.thumb,
                });
                cursor.continue();
            } else {
                resolve(results);
            }
        };
        req.onerror = (e) => reject(e.target.error);
    });
}

function dbDelete(storeName, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.delete(key);
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e.target.error);
    });
}

// ==============================
// FileReader ユーティリティ
// ==============================

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => reject(new Error(t('db.fileReadError')));
        reader.readAsText(file, 'utf-8');
    });
}

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => reject(new Error(t('db.fileReadError')));
        reader.readAsDataURL(file);
    });
}

// SVGテキストをdata URIに変換（日本語対応）
function svgTextToDataUrl(svgText) {
    const encoded = encodeURIComponent(svgText);
    return `data:image/svg+xml;charset=utf-8,${encoded}`;
}

