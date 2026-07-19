// ============================================================
// main.js 分割ファイル (11/24): 出力管理+出力タブページ一覧管理+外部ファイル取込+サブタブ切替
// 元 main.js の行 9956-10548 に相当
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: _EXPORT_MAX_SIZE,_activateOutputSubtab,_applyExportDpi,_getExportBaseWorkSize,_getExportDpiValue,_getExportMetaValues,_initExportDpiControls,_initExportMetaControls,_initOutputSubtabs,_outputActiveSubtab,_outputFilterGroup,_outputSelectedPage,_outputSortCriterion,_outputSubtabsInited,_pageOrder,_pageOrderInput,_showOutputPreview,_sortPageOrder,_updateExportPageRange,_updateOutputFilterBar,importImageAsPage,initOutputManager,onSwitchToOutputTab,renderOutputPageList
// ============================================================

// ==============================
// 出力管理
// ==============================

/**
 * 出力px値の上限。300dpiのA4(3508px)やB4(5008px)を許容するため8000。
 * これを超える指定は縦横比を維持して縮小される。
 */
const _EXPORT_MAX_SIZE = 8000;

function initOutputManager() {
    const exportBtn = document.getElementById('export-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', handleExport);
    }

    // レイヤー別出力の排他制御
    const bgOnly = document.getElementById('export-bg-only');
    const balloonOnly = document.getElementById('export-balloon-only');
    if (bgOnly && balloonOnly) {
        bgOnly.addEventListener('change', () => { if (bgOnly.checked) balloonOnly.checked = false; });
        balloonOnly.addEventListener('change', () => { if (balloonOnly.checked) bgOnly.checked = false; });
    }

    const widthInput = document.getElementById('export-width');
    const heightInput = document.getElementById('export-height');
    const aspectCheckbox = document.getElementById('maintain-aspect');

    if (widthInput && heightInput) {
        const MAX_SIZE = _EXPORT_MAX_SIZE;

        const handleInput = (targetInput, syncInput, isWidth) => {
            let valStr = targetInput.value.replace(/[０-９]/g, (s) => {
                return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
            });
            valStr = valStr.replace(/[^0-9]/g, '');
            if (targetInput.value !== valStr) targetInput.value = valStr;

            let val = parseInt(valStr, 10);
            if (isNaN(val)) return;

            if (val > MAX_SIZE) { val = MAX_SIZE; targetInput.value = val; }

            if (aspectCheckbox.checked && state.aspectRatio) {
                let syncedVal = isWidth
                    ? Math.round(val / state.aspectRatio)
                    : Math.round(val * state.aspectRatio);

                if (syncedVal > MAX_SIZE) {
                    syncedVal = MAX_SIZE;
                    syncInput.value = syncedVal;
                    targetInput.value = isWidth
                        ? Math.round(syncedVal * state.aspectRatio)
                        : Math.round(syncedVal / state.aspectRatio);
                } else {
                    syncInput.value = syncedVal;
                }
            }
        };

        const stopProp = (e) => e.stopPropagation();
        [widthInput, heightInput].forEach(input => {
            input.addEventListener('keydown', stopProp);
            input.addEventListener('keyup', stopProp);
            input.addEventListener('keypress', stopProp);
        });

        widthInput.addEventListener('input', (e) => {
            if (e.isComposing) return;
            handleInput(widthInput, heightInput, true);
        });
        widthInput.addEventListener('compositionend', () => handleInput(widthInput, heightInput, true));

        heightInput.addEventListener('input', (e) => {
            if (e.isComposing) return;
            handleInput(heightInput, widthInput, false);
        });
        heightInput.addEventListener('compositionend', () => handleInput(heightInput, widthInput, false));
    }

    // ページ一覧の更新ボタン（DB順にリセット）
    const refreshBtn = document.getElementById('output-page-list-refresh');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            // ソート基準は維持したまま、DBから最新状態を読み込んで順序を再計算する
            renderOutputPageList(true);
        });
    }

    // ソート基準変更
    const sortCriterionSel = document.getElementById('output-page-sort-criterion');
    if (sortCriterionSel) {
        // 初期値を同期
        sortCriterionSel.value = _outputSortCriterion;

        sortCriterionSel.addEventListener('change', () => {
            _outputSortCriterion = sortCriterionSel.value;
            localStorage.setItem('output_sort_criterion', _outputSortCriterion);
            // 基準が変わったので、強制的に再計算（resetOrder=true）をかける
            renderOutputPageList(true);
        });
    }

    // 並び替えボタン
    const sortBtn = document.getElementById('output-page-sort-btn');
    if (sortBtn) {
        sortBtn.addEventListener('click', () => _sortPageOrder());
    }

    // 画像取り込みボタン
    const importFile = document.getElementById('output-import-file');
    if (importFile) {
        importFile.addEventListener('change', async () => {
            const files = Array.from(importFile.files);
            if (files.length === 0) return;
            for (const file of files) {
                await importImageAsPage(file);
            }
            importFile.value = '';
        });
    }

    // 出力メタデータ入力（全形式共通）
    _initExportMetaControls();

    // 解像度(dpi)から出力px値を自動計算
    _initExportDpiControls();
}

// ==============================
// 解像度(dpi)指定による出力サイズ自動計算
// ==============================

const _EXPORT_DPI_LS_KEY = 'ccc_export_dpi';

/** 解像度セレクトの現在値(dpi)を返す。「手動」選択時は null */
function _getExportDpiValue() {
    const sel = document.getElementById('export-dpi');
    const dpi = parseInt(sel?.value, 10);
    return Number.isFinite(dpi) && dpi > 0 ? dpi : null;
}

/**
 * 出力サイズ計算の基準となる作品サイズ(mm)を解決する。
 * 作品サイズはSVG座標単位（mm×100相当）で保持されているため100で割ってmmへ換算する。
 * 優先順: ①選択中ページの所属作品 ②出力フィルタ中の作品 ③アクティブ作品
 */
function _getExportBaseWorkSize() {
    const candidates = [];
    if (_outputSelectedPage) candidates.push(_pageMgrGroups.groupOf(_outputSelectedPage));
    if (_outputFilterGroup) candidates.push(_outputFilterGroup);
    if (state.activeWork) candidates.push(state.activeWork.name);
    for (const name of candidates) {
        const meta = name ? _workMeta.get(name) : null;
        if (meta && meta.width > 0 && meta.height > 0) {
            return { name, widthMm: meta.width / 100, heightMm: meta.height / 100 };
        }
    }
    return null;
}

/**
 * 選択中の解像度から幅・高さ(px)を自動設定する。
 * @param {boolean} silent - true時は基準作品なし・上限縮小のアラートを出さない（起動時・ページ選択時用）
 */
function _applyExportDpi(silent = false) {
    const dpi = _getExportDpiValue();
    if (!dpi) return;
    const base = _getExportBaseWorkSize();
    if (!base) {
        if (!silent) {
            alert(t('page.msgDpiNoWorkSize'));
            const sel = document.getElementById('export-dpi');
            if (sel) sel.value = '';
            localStorage.setItem(_EXPORT_DPI_LS_KEY, '');
        }
        return;
    }
    let w = Math.round(base.widthMm * dpi / 25.4);
    let h = Math.round(base.heightMm * dpi / 25.4);
    if (w > _EXPORT_MAX_SIZE || h > _EXPORT_MAX_SIZE) {
        const scale = Math.min(_EXPORT_MAX_SIZE / w, _EXPORT_MAX_SIZE / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
        if (!silent) alert(t('page.msgDpiClamped', _EXPORT_MAX_SIZE, w, h));
    }
    state.aspectRatio = w / h;
    const wInput = document.getElementById('export-width');
    const hInput = document.getElementById('export-height');
    if (wInput) wInput.value = w;
    if (hInput) hInput.value = h;
}

/** 解像度セレクトの初期化: 前回値の復元・変更時の自動計算・手動編集時の解除 */
function _initExportDpiControls() {
    const sel = document.getElementById('export-dpi');
    if (!sel) return;

    const saved = localStorage.getItem(_EXPORT_DPI_LS_KEY);
    if (saved && [...sel.options].some(o => o.value === saved)) sel.value = saved;

    sel.addEventListener('change', () => {
        localStorage.setItem(_EXPORT_DPI_LS_KEY, sel.value);
        _applyExportDpi();
    });

    // 幅・高さを手動編集したら解像度選択を「手動」へ戻す
    // （_applyExportDpiによるプログラム的代入ではinputイベントは発火しない）
    ['export-width', 'export-height'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', () => {
            if (sel.value !== '') {
                sel.value = '';
                localStorage.setItem(_EXPORT_DPI_LS_KEY, '');
            }
        });
    });

    // 前回の解像度指定を起動時に適用（作品が特定できない場合は静かにスキップ）
    _applyExportDpi(true);
}

// ==============================
// 出力メタデータ入力（出力サブタブ）
// ==============================

const _EXPORT_META_LS_KEY = 'ccc_export_meta';
const _EXPORT_META_FIELDS = ['title', 'author', 'subject', 'keywords'];

/** 出力メタデータ入力欄の現在値を取得する（各値はtrim済み。PDF/EPUB/画像の各出力処理から参照される） */
function _getExportMetaValues() {
    const values = {};
    _EXPORT_META_FIELDS.forEach(field => {
        const input = document.getElementById(`export-meta-${field}`);
        values[field] = (input?.value || '').trim();
    });
    return values;
}

/** 出力メタデータ入力行の初期化: 前回値の復元と入力の永続化 */
function _initExportMetaControls() {
    let saved = {};
    // 旧キー(ccc_pdf_meta: PDF専用だった頃の保存値)からも引き継ぐ
    try { saved = JSON.parse(localStorage.getItem(_EXPORT_META_LS_KEY) || localStorage.getItem('ccc_pdf_meta') || '{}'); }
    catch { /* 破損時は空で開始 */ }

    _EXPORT_META_FIELDS.forEach(field => {
        const input = document.getElementById(`export-meta-${field}`);
        if (!input) return;
        if (typeof saved[field] === 'string') input.value = saved[field];
        input.addEventListener('input', () => {
            localStorage.setItem(_EXPORT_META_LS_KEY, JSON.stringify(_getExportMetaValues()));
        });
    });
}

// ==============================
// 出力タブ ページ一覧管理
// ==============================

/** 出力タブで選択中のページ名 */
let _outputSelectedPage = null;

/** 出力タブの現在のソート基準 */
let _outputSortCriterion = localStorage.getItem('output_sort_criterion') || 'name';

/**
 * ページの表示順序（ページ名の配列）。
 * renderOutputPageList が初回実行時に DB の並び順で初期化される。
 * 並び替えボタン実行後はこの配列が更新され、出力時もこの順序が使われる。
 */
let _pageOrder = [];

/**
 * 各行の番号入力欄に入力されたユーザー指定値を保持する。
 * キー: ページ名、値: 指定番号(number) or null（未指定）
 */
let _pageOrderInput = {};

/**
 * ページ一覧を描画する。
 * 並び順は _pageOrder に従い、各行に番号入力欄・削除ボタンを設置する。
 * @param {boolean} [resetOrder=false] - true のとき DB 順で _pageOrder を再初期化する
 */
/** 出力サブタブの作品/グループフィルタ（null なら全ページ表示） */
let _outputFilterGroup = null;

/** フィルタ表示バーの更新 */
function _updateOutputFilterBar() {
    const bar = document.getElementById('output-filter-bar');
    const label = document.getElementById('output-filter-label');
    if (!bar) return;
    if (_outputFilterGroup) {
        bar.style.display = 'flex';
        if (label) {
            label.textContent = _workMeta.get(_outputFilterGroup) ? t('page.workLabel', _outputFilterGroup) : t('tmpl.groupLabel', _outputFilterGroup);
        }
    } else {
        bar.style.display = 'none';
    }
}

async function renderOutputPageList(resetOrder = false) {
    const list = document.getElementById('output-page-list');
    if (!list) return;

    // DBから全ページを取得
    const allPages = await dbGetAll('pages');

    if (allPages.length === 0) {
        list.innerHTML = `<li class="output-page-empty">${t('asset.noPages')}</li>`;
        _pageOrder = [];
        _pageOrderInput = {};
        _updateExportPageRange(0);
        return;
    }

    // _pageOrder の初期化（初回 or リセット時）
    if (resetOrder || _pageOrder.length === 0) {
        // 保存された順序を試行（リセット時はスキップ）
        let savedOrder = null;
        if (!resetOrder) {
            try {
                const config = await dbGet('settings', 'output_page_order');
                if (config && Array.isArray(config.value)) savedOrder = config.value;
            } catch (e) {}
        }

        if (savedOrder) {
            const dbNames = new Set(allPages.map(p => p.name));
            _pageOrder = savedOrder.filter(n => dbNames.has(n));
            allPages.forEach(p => {
                if (!_pageOrder.includes(p.name)) _pageOrder.push(p.name);
            });
        } else {
            // ソート基準に基づいて初期化
            const sorted = [...allPages];
            if (_outputSortCriterion === 'name') {
                sorted.sort((a, b) => b.name.localeCompare(a.name)); // 既存仕様: 逆名前順
            } else if (_outputSortCriterion === 'date_asc') {
                sorted.sort((a, b) => {
                    const ta = parseInt((a.name.match(/_(\d+)$/) || [])[1] || 0, 10);
                    const tb = parseInt((b.name.match(/_(\d+)$/) || [])[1] || 0, 10);
                    return ta - tb;
                });
            } else if (_outputSortCriterion === 'date_desc') {
                sorted.sort((a, b) => {
                    const ta = parseInt((a.name.match(/_(\d+)$/) || [])[1] || 0, 10);
                    const tb = parseInt((b.name.match(/_(\d+)$/) || [])[1] || 0, 10);
                    return tb - ta;
                });
            }
            _pageOrder = sorted.map(p => p.name);
        }
        _pageOrderInput = {};

        // 順序を永続化（自動ソート直後の状態を保存）
        try {
            dbPut('settings', { id: 'output_page_order', value: _pageOrder });
        } catch (e) {}
    } else {
        // ゴミ箱移動等で消えたページを _pageOrder から除去、新規ページを末尾に追加
        const dbNames = new Set(allPages.map(p => p.name));
        const oldOrderStr = JSON.stringify(_pageOrder);
        _pageOrder = _pageOrder.filter(n => dbNames.has(n));
        allPages.forEach(p => {
            if (!_pageOrder.includes(p.name)) _pageOrder.push(p.name);
        });
        // 消えたページの入力値も除去
        Object.keys(_pageOrderInput).forEach(n => {
            if (!dbNames.has(n)) delete _pageOrderInput[n];
        });
        
        // 変更があった場合は保存しておきたいが、DB更新は _sortPageOrder で明示的に行う運用とするか。
        // ここではレンダリングのみ。
    }

    // ページ名 → ページオブジェクトの Map
    const pageMap = new Map(allPages.map(p => [p.name, p]));

    // 作品/グループフィルタ（削除等で無効になったフィルタは解除）
    if (_outputFilterGroup && !_pageMgrGroups.data[_outputFilterGroup]) _outputFilterGroup = null;
    const filtered = !!_outputFilterGroup;
    // フィルタ中はグループ配列の順序（作品内ページ順）で表示、通常時は _pageOrder
    const visibleOrder = filtered
        ? (_pageMgrGroups.data[_outputFilterGroup] || []).filter(n => pageMap.has(n))
        : _pageOrder;
    _updateOutputFilterBar();

    list.innerHTML = '';

    if (visibleOrder.length === 0) {
        list.innerHTML = `<li class="output-page-empty">${t('asset.noPages')}</li>`;
        _updateExportPageRange(0);
        return;
    }

    visibleOrder.forEach((pageName, index) => {
        const page = pageMap.get(pageName);
        if (!page) return;
        const displayNum = index + 1;

        const li = document.createElement('li');
        li.className = 'output-page-item';
        li.dataset.pageName = pageName;
        if (pageName === _outputSelectedPage) li.classList.add('selected');

        // 番号入力欄の既存値（番号入力は全ページ並び替え用のためフィルタ中は非表示）
        const inputVal = _pageOrderInput[pageName] != null ? _pageOrderInput[pageName] : '';
        const orderInputHtml = filtered ? '' : `
            <input type="number" class="output-page-order-input${inputVal !== '' ? ' has-value' : ''}"
                   min="1" max="${_pageOrder.length}" value="${inputVal}"
                   title="${t('page.orderInputTitle')}" />`;

        li.innerHTML = `
            <span class="output-page-num">${displayNum}</span>
            ${orderInputHtml}
            <span class="output-page-name" title="${pageName}">${pageName}</span>
        `;

        // 番号入力欄のイベント
        const numInput = li.querySelector('.output-page-order-input');
        if (numInput) {
            numInput.addEventListener('input', () => {
                const v = numInput.value.trim();
                if (v === '') {
                    delete _pageOrderInput[pageName];
                    numInput.classList.remove('has-value');
                } else {
                    _pageOrderInput[pageName] = parseInt(v, 10);
                    numInput.classList.add('has-value');
                }
            });
            // クリックで行選択が発火しないよう伝播を止める
            numInput.addEventListener('click', e => e.stopPropagation());
        }

        // 行クリック → プレビュー表示
        li.addEventListener('click', (e) => {
            if (numInput && e.target === numInput) return;
            _outputSelectedPage = pageName;
            list.querySelectorAll('.output-page-item').forEach(el => el.classList.remove('selected'));
            li.classList.add('selected');
            _showOutputPreview(page);
        });

        list.appendChild(li);
    });

    _updateExportPageRange(visibleOrder.length);
}

/**
 * 番号指定に基づいてページ順序を昇順に並び替える。
 *
 * アルゴリズム:
 *   1. 番号指定ありのページを「指定位置」に仮配置。
 *      同じ番号が重複した場合は小さい方を優先し、残りは自動扱いに降格。
 *   2. 番号なしのページを残った空き位置に現在の相対順序を保ちながら埋める。
 *   3. 結果を 1-indexed で確定し _pageOrder を更新。
 */
async function _sortPageOrder() {
    const total = _pageOrder.length;
    if (total === 0) return;

    // 指定番号 → ページ名 の Map（重複時は先勝ち = 現在の並び順で先のページ優先）
    const assignedSlot = new Map(); // slot(1-indexed) → pageName
    const autoPages    = [];        // 自動割り当て対象のページ名

    _pageOrder.forEach(pageName => {
        const requested = _pageOrderInput[pageName];
        if (requested != null && Number.isFinite(requested)) {
            const slot = Math.max(1, Math.min(total, requested));
            if (!assignedSlot.has(slot)) {
                assignedSlot.set(slot, pageName);
            } else {
                // 重複: 後から来たページは自動扱いに降格
                autoPages.push(pageName);
            }
        } else {
            autoPages.push(pageName);
        }
    });

    // 空き位置に auto ページを昇順で埋める
    const result = new Array(total).fill(null);
    assignedSlot.forEach((pageName, slot) => { result[slot - 1] = pageName; });

    let autoIdx = 0;
    for (let i = 0; i < total; i++) {
        if (result[i] === null) {
            result[i] = autoPages[autoIdx++];
        }
    }

    _pageOrder = result;
    // 入力値をリセット
    _pageOrderInput = {};

    // 順序を永続化（settings ストアに保存）
    try {
        await dbPut('settings', { id: 'output_page_order', value: _pageOrder });
        console.log('[Output] Page order saved to DB');
    } catch (e) {
        console.error('[Output] Failed to save page order:', e);
    }

    await renderOutputPageList();

    // 出力範囲を全ページにリセット
    _updateExportPageRange(total);
}

/**
 * 出力ページ範囲入力の max を更新。初期値は1〜1、ユーザーが任意に変更可能
 */
function _updateExportPageRange(total) {
    const startEl = document.getElementById('export-page-start');
    const endEl   = document.getElementById('export-page-end');
    if (!startEl || !endEl) return;
    const n = total || 1;
    startEl.max = n;
    endEl.max   = n;
    // 範囲外の場合のみ1にリセット（ユーザーの入力値を保持）
    const currentStart = parseInt(startEl.value, 10);
    const currentEnd   = parseInt(endEl.value, 10);
    if (!currentStart || currentStart < 1 || currentStart > n) startEl.value = 1;
    if (!currentEnd   || currentEnd   < 1 || currentEnd   > n) endEl.value   = 1;
}

/**
 * 指定ページのプレビューを出力タブのメインエリアに表示する
 */
async function _showOutputPreview(page) {
    const previewContainer = document.getElementById('export-preview');
    if (!previewContainer) return;

    // アスペクト比をセット
    if (page.width && page.height) {
        state.aspectRatio = page.width / page.height;
        if (_getExportDpiValue()) {
            // 解像度指定中は選択ページの所属作品サイズから再計算
            _applyExportDpi(true);
        } else {
            const MAX_SIZE = _EXPORT_MAX_SIZE;
            let w = page.width, h = page.height;
            if (w > MAX_SIZE || h > MAX_SIZE) {
                if (w > h) { w = MAX_SIZE; h = Math.round(w / state.aspectRatio); }
                else       { h = MAX_SIZE; w = Math.round(h * state.aspectRatio); }
            }
            const wInput = document.getElementById('export-width');
            const hInput = document.getElementById('export-height');
            if (wInput) wInput.value = w;
            if (hInput) hInput.value = h;
        }
    }

    // プレビュー画像を生成
    try {
        const pageRecord = await dbGet('pages', page.name);
        if (pageRecord && pageRecord.svgContent) {
            const mergedSvg = buildMergedSvg(pageRecord);
            const mergedUrl = svgTextToDataUrl(mergedSvg || pageRecord.svgContent);
            previewContainer.innerHTML = `<div style="position:relative; display:inline-block; width:100%;">
                <img src="${mergedUrl}" style="width:100%; height:auto; max-height:80vh; display:block;">
            </div>`;
        }
    } catch (e) {
        console.error('[Output preview] error:', e);
    }

    // activePage を更新
    state.activePage = page;
}

// ==============================
// 外部ファイルをページとして取り込む
// ==============================

/**
 * 画像ファイルを読み込み、1ページ分のレコードとして pages ストアに保存する。
 * 取り込んだページは _pageOrder の先頭（一覧の一番上）に追加される。
 *
 * ページ構造:
 *   - svgContent: 画像を <image> 要素で埋め込んだ SVG（画像の実寸を使用）
 *   - panels: 全体を覆う単一コマ (panel_1)
 *   - width / height: 画像の実寸
 *
 * @param {File} file - 取り込む画像ファイル
 */
async function importImageAsPage(file) {
    if (!file.type.startsWith('image/')) {
        alert(t('page.msgNotImageFile', file.name));
        return;
    }

    try {
        const dataUrl = await readFileAsDataURL(file);

        // 画像の実寸を取得
        const { width, height } = await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
            img.onerror = () => reject(new Error(t('layout.msgImageLoadFailed')));
            img.src = dataUrl;
        });

        const timestamp = Date.now();
        // ファイル名（拡張子なし）をページ名のベースに使用
        const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9\-_\u3000-\u9FFF\uF900-\uFAFF]/g, '_');
        const pageName = `${baseName}_${timestamp}`;
        const pageId   = `page_${timestamp}`;

        // 画像を <image> で埋め込んだ SVG を生成
        const svgContent = [
            `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`,
            ` width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
            `<image x="0" y="0" width="${width}" height="${height}"`,
            ` href="${dataUrl}" preserveAspectRatio="xMidYMid meet"/>`,
            `</svg>`,
        ].join('');

        // 全体を覆う単一コマ（出力・編集で参照される最低限の panel 構造）
        const fullPoints = `0,0 ${width},0 ${width},${height} 0,${height}`;
        const pageRecord = {
            name:              pageName,
            id:                pageId,
            originalTemplate:  file.name,   // 元のファイル名を記録
            width,
            height,
            panels: [
                {
                    id:              'panel_0',
                    number:          0,
                    points:          fullPoints,
                    panelSvgContent: '',
                },
                {
                    id:              'panel_1',
                    number:          1,
                    points:          fullPoints,
                    panelSvgContent: '',
                },
            ],
            svgContent,
            basePanelPoints:   fullPoints,
            overlaySvgContent: '',
            _importedFrom:     file.name,   // 取り込み元ファイル名（参照用）
        };

        await dbPut('pages', pageRecord);

        // state.pages を更新
        state.pages = await dbGetAllPagesMeta();
        state.pages.sort((a, b) => b.name.localeCompare(a.name));
        renderPageSelector();

        // _pageOrder の先頭に追加（一覧最上位に表示）
        _pageOrder = _pageOrder.filter(n => n !== pageName);
        _pageOrder.unshift(pageName);

        // 一覧を再描画
        await renderOutputPageList();

        console.log(`[Import] "${file.name}" → page "${pageName}" (${width}×${height})`);
    } catch (e) {
        console.error('[Import] error:', e);
        alert(t('page.msgImportFailed', file.name, e.message));
    }
}

async function onSwitchToOutputTab() {
    // サブタブ切り替えイベントを初回のみ登録
    _initOutputSubtabs();

    // ページ一覧を描画
    await renderOutputPageList();

    // activePage があれば選択状態にしてプレビュー表示
    if (state.activePage) {
        _outputSelectedPage = state.activePage.name;
        // 一覧の選択状態を反映
        const list = document.getElementById('output-page-list');
        if (list) {
            list.querySelectorAll('.output-page-item').forEach(el => {
                el.classList.toggle('selected', el.dataset.pageName === state.activePage.name);
            });
        }
        await _showOutputPreview(state.activePage);
    }

    // アクティブなサブタブが work なら作品一覧・ページ一覧を更新
    if (_outputActiveSubtab === 'work') {
        await renderWorkList();
        await renderPageMgrGrid();
    }
}

// ==============================
// 出力タブ サブタブ切り替え
// ==============================

let _outputActiveSubtab = 'work';
let _outputSubtabsInited = false;

function _initOutputSubtabs() {
    if (_outputSubtabsInited) return;
    _outputSubtabsInited = true;

    document.querySelectorAll('.output-subtab-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            await _activateOutputSubtab(btn.dataset.outputSubtab);
        });
    });
}

async function _activateOutputSubtab(target) {
    _outputActiveSubtab = target;

    document.querySelectorAll('.output-subtab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.outputSubtab === target);
    });

    document.querySelectorAll('.output-subtab-content').forEach(c => c.style.display = 'none');
    const panel = document.getElementById(`output-subtab-${target}`);
    if (panel) panel.style.display = '';

    if (target === 'export') {
        await renderOutputPageList();
    } else if (target === 'template') {
        renderTemplateList();
    } else if (target === 'work') {
        await renderWorkList();
        await renderPageMgrGrid();
    }
}

