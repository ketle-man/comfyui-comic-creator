// ============================================================
// main.js 分割ファイル (21/24): プリセット
// 元 main.js の行 16241-16746 に相当
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: _fontMgrApplyPresetToUI,_fontMgrEditingPresetId,_fontMgrGetPresetFromUI,_fontMgrInitPresetTab,_fontMgrInited,_fontMgrLoadPresets,_fontMgrLoadSystemFonts,_fontMgrPresetList,_fontMgrRenderFavCatTabs,_fontMgrRenderPresetSelect,_fontMgrRenderPresetStyleSelect,_fontMgrResetPresetUI,_fontMgrSavePresets,_fontMgrSearch,_fontMgrSwitchPreviewTab,_fontMgrSwitchSource,_fontMgrSyncCatSelects,_fontMgrSyncCustomFontSelects,_fontMgrUpdatePresetPreview,initFontMgrTab
// ============================================================

// ==============================
// プリセット（フォント＋サイズ＋スタイル参照）
// ==============================

let _fontMgrPresetList = [];
let _fontMgrEditingPresetId = null;

function _fontMgrLoadPresets() {
    try {
        const list = JSON.parse(localStorage.getItem(_FONTMGR_LS_PRESETS) || '[]');
        return Array.isArray(list) ? list : [];
    } catch { return []; }
}
function _fontMgrSavePresets() {
    localStorage.setItem(_FONTMGR_LS_PRESETS, JSON.stringify(_fontMgrPresetList));
}

// プリセットの「スタイル選択」セレクトを、保存済みスタイル一覧で更新（値は現在選択中のIDを維持）
function _fontMgrRenderPresetStyleSelect() {
    const sel = document.getElementById('preset-style-select');
    if (!sel) return;
    const cur = sel.value;
    const styles = _fontMgrLoadStyles();
    sel.innerHTML = `<option value="">${t('font.noStyleOption')}</option>` +
        styles.map(s => `<option value="${_esc(s.id)}">${_esc(s.name)}</option>`).join('');
    if (styles.some(s => s.id === cur)) sel.value = cur;
}

// プリセットの「スタイル選択」を反映したプレビュー。スタイルタブと同じSVGプレビューキャンバスを共用する
function _fontMgrUpdatePresetPreview() {
    const styleId = document.getElementById('preset-style-select')?.value || '';
    const style = _fontMgrLoadStyles().find(s => s.id === styleId);

    _fontMgrRenderStylePreviewSvg({
        fill: style?.fill || '#000000',
        strokeEnabled: !!style?.strokeEnabled,
        strokeColor: style?.strokeColor || '#ffffff',
        strokeWidth: style?.strokeWidth || 0,
        boldEnabled: !!style?.boldEnabled,
        italicEnabled: !!style?.italicEnabled,
        underlineEnabled: !!style?.underlineEnabled,
        align: style?.align || 'left',
        bukuroEnabled: !!style?.bukuroEnabled,
        bukuroColor: style?.bukuroColor || '#000000',
        bukuroWidth: style?.bukuroWidth || 0,
        shadowEnabled: !!style?.shadowEnabled,
        shadowColor: style?.shadowColor || '#000000',
        shadowBlur: style?.shadowBlur || 0,
        shadowDx: style?.shadowDx || 0,
        shadowDy: style?.shadowDy || 0,
    });
}

function _fontMgrGetPresetFromUI(name) {
    return {
        id: _fontMgrEditingPresetId || `preset_${Date.now()}`,
        name,
        fontFamily: _fontMgr.selectedFamily || 'sans-serif',
        fontSize: parseInt(document.getElementById('preset-size-input')?.value, 10) || 150,
        isVertical: !!document.getElementById('preset-vertical-checkbox')?.checked,
        styleId: document.getElementById('preset-style-select')?.value || '',
    };
}

function _fontMgrApplyPresetToUI(preset) {
    document.getElementById('preset-size-input').value = preset.fontSize;
    document.getElementById('preset-vertical-checkbox').checked = preset.isVertical;
    _fontMgrRenderPresetStyleSelect();
    document.getElementById('preset-style-select').value = preset.styleId || '';
    document.getElementById('preset-name-input').value = preset.name;
    _fontMgrEditingPresetId = preset.id;
    _fontMgrRenderPresetSelect();
    _fontMgrUpdatePresetPreview();
}

function _fontMgrResetPresetUI() {
    _fontMgrEditingPresetId = null;
    document.getElementById('preset-name-input').value = '';
    document.getElementById('preset-size-input').value = 150;
    document.getElementById('preset-vertical-checkbox').checked = false;
    _fontMgrRenderPresetStyleSelect();
    document.getElementById('preset-style-select').value = '';
    _fontMgrRenderPresetSelect();
    _fontMgrUpdatePresetPreview();
}

// 登録済みプリセットのドロップダウンを更新（値は現在編集中のIDを維持）
function _fontMgrRenderPresetSelect() {
    const sel = document.getElementById('preset-select');
    if (!sel) return;
    sel.innerHTML = `<option value="">${t('font.newOption')}</option>` +
        _fontMgrPresetList.map(p => `<option value="${_esc(p.id)}">${_esc(p.name)}</option>`).join('');
    sel.value = _fontMgrEditingPresetId || '';
}

function _fontMgrInitPresetTab() {
    const previewInputIds = ['preset-size-input', 'preset-vertical-checkbox', 'preset-style-select'];
    previewInputIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const evt = (el.type === 'checkbox' || el.tagName === 'SELECT') ? 'change' : 'input';
        el.addEventListener(evt, _fontMgrUpdatePresetPreview);
    });

    document.getElementById('preset-save-btn')?.addEventListener('click', () => {
        const name = document.getElementById('preset-name-input')?.value.trim();
        if (!name) { alert(t('font.enterPresetName')); return; }
        // 読込中のプリセットから名前を変更した場合は上書きせず別名で新規保存する
        const loaded = _fontMgrPresetList.find(p => p.id === _fontMgrEditingPresetId);
        if (loaded && loaded.name !== name) _fontMgrEditingPresetId = null;
        const preset = _fontMgrGetPresetFromUI(name);
        const idx = _fontMgrPresetList.findIndex(p => p.id === preset.id);
        if (idx >= 0) _fontMgrPresetList[idx] = preset;
        else _fontMgrPresetList.push(preset);
        _fontMgrSavePresets();
        _fontMgrEditingPresetId = preset.id;
        _fontMgrRenderPresetSelect();
    });

    document.getElementById('preset-new-btn')?.addEventListener('click', () => {
        _fontMgrResetPresetUI();
    });

    document.getElementById('preset-select')?.addEventListener('change', (e) => {
        const id = e.target.value;
        if (!id) { _fontMgrResetPresetUI(); return; }
        const preset = _fontMgrPresetList.find(p => p.id === id);
        if (preset) _fontMgrApplyPresetToUI(preset);
    });

    document.getElementById('preset-delete-btn')?.addEventListener('click', () => {
        const id = document.getElementById('preset-select')?.value;
        const preset = _fontMgrPresetList.find(p => p.id === id);
        if (!preset) { alert(t('font.selectPresetToDelete')); return; }
        if (!confirm(t('font.confirmDeletePreset', preset.name))) return;
        _fontMgrPresetList = _fontMgrPresetList.filter(p => p.id !== preset.id);
        _fontMgrSavePresets();
        _fontMgrResetPresetUI();
    });

    _fontMgrPresetList = _fontMgrLoadPresets();
    _fontMgrRenderPresetStyleSelect();
    _fontMgrRenderPresetSelect();
}

// お気に入りカテゴリタブ（左パネル）描画。お気に入りソース選択時のみ表示し、選択中カテゴリでフォントリストを絞り込む
function _fontMgrRenderFavCatTabs() {
    const wrap = document.getElementById('fontmgr-fav-cat-tabs');
    if (!wrap) return;
    wrap.style.display = _fontMgr.source === 'favorites' ? '' : 'none';
    if (_fontMgr.source !== 'favorites') return;

    const cats = _fontMgrCatNames();
    if (_fontMgr.selectedFavCat && !cats.includes(_fontMgr.selectedFavCat)) {
        _fontMgr.selectedFavCat = null;
    }

    wrap.innerHTML = '';
    const allBtn = document.createElement('button');
    allBtn.className = 'fontmgr-fav-cat-tab-btn' + (!_fontMgr.selectedFavCat ? ' active' : '');
    allBtn.textContent = t('layout.fontCatAll');
    allBtn.addEventListener('click', () => {
        _fontMgr.selectedFavCat = null;
        _fontMgrRenderFavCatTabs();
        _fontMgrRenderList(_fontMgrCurrentList());
    });
    wrap.appendChild(allBtn);

    cats.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = 'fontmgr-fav-cat-tab-btn' + (_fontMgr.selectedFavCat === cat ? ' active' : '');
        btn.textContent = `${_fontMgrCatLabel(cat)} (${_fontMgr.favorites[cat].length})`;
        btn.addEventListener('click', () => {
            _fontMgr.selectedFavCat = cat;
            _fontMgrRenderFavCatTabs();
            _fontMgrRenderList(_fontMgrCurrentList());
        });
        wrap.appendChild(btn);
    });
}

// カテゴリセレクト同期（右パネルのfav-cat-select, favlist-cat-select）
function _fontMgrSyncCatSelects() {
    const cats = _fontMgrCatNames();
    ['fontmgr-fav-cat-select', 'fontmgr-favlist-cat-select'].forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const cur = sel.value;
        sel.innerHTML = cats.map(c => `<option value="${_esc(c)}">${_esc(_fontMgrCatLabel(c))}</option>`).join('');
        if (cats.includes(cur)) sel.value = cur;
    });
}

// カスタムプレビューのフォントセレクト同期
function _fontMgrSyncCustomFontSelects() {
    const allFamilies = [
        ..._fontMgrGoogleList(),
        ..._fontMgr.systemFonts.map(f => f.family),
    ];
    const unique = [...new Set(allFamilies)].sort((a, b) => a.localeCompare(b));
    ['fontmgr-jp-font', 'fontmgr-en-font'].forEach((id, i) => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const cur = sel.value;
        sel.innerHTML = unique.map(f => `<option value="${_esc(f)}">${_esc(f)}</option>`).join('');
        // デフォルト値
        const defaults = ['BIZ UDPGothic', 'Arial'];
        sel.value = cur && unique.includes(cur) ? cur : (unique.includes(defaults[i]) ? defaults[i] : unique[0] || '');
    });
}

// プレビューサブタブ切り替え
function _fontMgrSwitchPreviewTab(name) {
    _fontMgr.activePreview = name;
    document.querySelectorAll('.fontmgr-preview-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.fontmgrPreview === name);
    });
    document.querySelectorAll('.fontmgr-preview-content').forEach(el => {
        el.classList.toggle('active', el.id === `fontmgr-preview-${name}`);
    });
    if (name === 'favlist') _fontMgrRenderFavList();
    if (name === 'style') { _fontMgrRenderPresetStyleSelect(); _fontMgrUpdateStylePreview(); }
    _fontMgrSavePrefs();
}

// ソースタブ切り替え
async function _fontMgrSwitchSource(source) {
    _fontMgr.source = source;
    document.querySelectorAll('.fontmgr-source-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.fontmgrSource === source);
    });

    const loadWrap = document.getElementById('fontmgr-load-system-wrap');
    if (loadWrap) loadWrap.style.display = source === 'system' ? '' : 'none';

    _fontMgrRenderFavCatTabs();

    if (source === 'system' && !_fontMgr.systemLoaded) {
        await _fontMgrLoadSystemFonts();
    } else {
        _fontMgrRenderList(_fontMgrCurrentList());
    }
    _fontMgrSavePrefs();
}

// システムフォント読み込み
async function _fontMgrLoadSystemFonts() {
    const statusEl = document.getElementById('fontmgr-system-status');
    const listEl = document.getElementById('fontmgr-font-list');
    if (listEl) listEl.innerHTML = `<p class="empty-message">${t('common.loading')}</p>`;
    if (statusEl) statusEl.textContent = t('common.loading');

    if (!window.queryLocalFonts) {
        if (statusEl) statusEl.textContent = t('font.localFontApiUnsupported');
        if (listEl) listEl.innerHTML = `<p class="empty-message">${t('font.systemFontsUnsupported')}</p>`;
        return;
    }
    try {
        const fonts = await window.queryLocalFonts();
        const familyMap = {};
        fonts.forEach(f => {
            if (!familyMap[f.family]) familyMap[f.family] = f.fullName || f.family;
        });
        _fontMgr.systemFonts = Object.keys(familyMap)
            .sort((a, b) => a.localeCompare(b))
            .map(family => ({ family, path: familyMap[family] }));
        _fontMgr.systemLoaded = true;
        if (statusEl) statusEl.textContent = t('font.countSuffix', _fontMgr.systemFonts.length);
        _fontMgrRenderList(_fontMgr.systemFonts);
        _fontMgrSyncCustomFontSelects();
    } catch (err) {
        if (statusEl) statusEl.textContent = t('fontsel.fetchFailed', err.message);
        if (listEl) listEl.innerHTML = `<p class="empty-message">${t('fontsel.fetchFailed', err.message)}</p>`;
    }
}

// 検索実行（検索結果を現在のリストに反映）
function _fontMgrSearch() {
    _fontMgrRenderList(_fontMgrCurrentList());
}

// フォントタブ初期化（初回1回のみ）
let _fontMgrInited = false;
async function initFontMgrTab() {
    if (_fontMgrInited) return;
    _fontMgrInited = true;

    _fontMgrLoad();

    // --- ソースタブ ---
    document.querySelectorAll('.fontmgr-source-btn').forEach(btn => {
        btn.addEventListener('click', () => _fontMgrSwitchSource(btn.dataset.fontmgrSource));
    });

    // --- プレビューサブタブ ---
    document.querySelectorAll('.fontmgr-preview-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => _fontMgrSwitchPreviewTab(btn.dataset.fontmgrPreview));
    });

    // --- スタイルタブ ---
    _fontMgrInitStyleTab();

    // --- プリセットタブ ---
    _fontMgrInitPresetTab();

    // --- サイズスライダー ---
    const slider = document.getElementById('fontmgr-size-slider');
    const sizeNum = document.getElementById('fontmgr-size-num');
    if (slider) {
        slider.value = _fontMgr.previewSize;
        slider.addEventListener('input', () => {
            _fontMgr.previewSize = parseInt(slider.value, 10);
            if (sizeNum) sizeNum.value = slider.value;
            _fontMgrUpdatePreview();
            _fontMgrSavePrefs();
        });
    }
    if (sizeNum) {
        sizeNum.value = _fontMgr.previewSize;
        sizeNum.addEventListener('change', () => {
            _fontMgr.previewSize = parseInt(sizeNum.value, 10);
            if (slider) slider.value = sizeNum.value;
            _fontMgrUpdatePreview();
            _fontMgrSavePrefs();
        });
    }

    // --- 文字種チェックボックス ---
    document.querySelectorAll('.fontmgr-char-cb').forEach(cb => {
        cb.checked = !!_fontMgr.charChecks[cb.dataset.char];
        cb.addEventListener('change', () => {
            _fontMgr.charChecks[cb.dataset.char] = cb.checked;
            // 1つもチェックされていない場合は戻す
            if (!Object.values(_fontMgr.charChecks).some(Boolean)) {
                cb.checked = true;
                _fontMgr.charChecks[cb.dataset.char] = true;
            }
            _fontMgrUpdatePreview();
            _fontMgrSavePrefs();
        });
    });

    // --- 文章プレビュー 方向ラジオ ---
    document.querySelectorAll('input[name="fontmgr-sent-dir"]').forEach(rb => {
        if (rb.value === _fontMgr.sentDir) rb.checked = true;
        rb.addEventListener('change', () => {
            _fontMgr.sentDir = rb.value;
            _fontMgrApplySentDir();
            _fontMgrSavePrefs();
        });
    });

    // --- カスタムプレビュー 方向ラジオ ---
    document.querySelectorAll('input[name="fontmgr-custom-dir"]').forEach(rb => {
        if (rb.value === _fontMgr.customDir) rb.checked = true;
        rb.addEventListener('change', () => {
            _fontMgr.customDir = rb.value;
            _fontMgrUpdateCustomPreview();
        });
    });

    // --- カスタムプレビュー コントロール ---
    ['fontmgr-jp-font', 'fontmgr-en-font', 'fontmgr-custom-size',
     'fontmgr-text-color', 'fontmgr-bg-color'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', _fontMgrUpdateCustomPreview);
        document.getElementById(id)?.addEventListener('change', _fontMgrUpdateCustomPreview);
    });
    document.getElementById('fontmgr-custom-input')?.addEventListener('input', _fontMgrUpdateCustomPreview);

    // --- お気に入り一覧カテゴリセレクト ---
    document.getElementById('fontmgr-favlist-cat-select')?.addEventListener('change', _fontMgrRenderFavList);

    // --- 検索 ---
    document.getElementById('fontmgr-search-btn')?.addEventListener('click', _fontMgrSearch);
    document.getElementById('fontmgr-search-name')?.addEventListener('keydown', e => { if (e.key === 'Enter') _fontMgrSearch(); });
    document.getElementById('fontmgr-search-tag')?.addEventListener('keydown', e => { if (e.key === 'Enter') _fontMgrSearch(); });

    // --- システムフォント読込ボタン ---
    document.getElementById('fontmgr-load-system-btn')?.addEventListener('click', async () => {
        _fontMgr.systemLoaded = false;
        await _fontMgrLoadSystemFonts();
        _fontMgrSyncCustomFontSelects();
    });

    // --- タグ追加 ---
    document.getElementById('fontmgr-tag-add-btn')?.addEventListener('click', () => {
        const input = document.getElementById('fontmgr-tag-input');
        const tag = input?.value.trim();
        if (!tag || !_fontMgr.selectedFamily) return;
        const list = _fontMgr.tags[_fontMgr.selectedFamily] = _fontMgr.tags[_fontMgr.selectedFamily] || [];
        if (!list.includes(tag)) { list.push(tag); list.sort(); }
        if (input) input.value = '';
        _fontMgrSaveTags();
        _fontMgrRenderTagChips();
        _fontMgrRenderAllTagsChips();
        _fontMgrRenderList(_fontMgrCurrentList());
    });
    document.getElementById('fontmgr-tag-input')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('fontmgr-tag-add-btn')?.click();
    });

    // --- お気に入り追加 ---
    document.getElementById('fontmgr-fav-add-btn')?.addEventListener('click', () => {
        if (!_fontMgr.selectedFamily) return;
        const catSel = document.getElementById('fontmgr-fav-cat-select');
        const cat = catSel?.value;
        if (!cat || !_fontMgr.favorites[cat]) return;
        if (!_fontMgr.favorites[cat].includes(_fontMgr.selectedFamily)) {
            _fontMgr.favorites[cat].push(_fontMgr.selectedFamily);
            _fontMgr.favorites[cat].sort();
        }
        _fontMgrSaveFavs();
        _fontMgrRenderFavCatTabs();
        _fontMgrSyncCatSelects();
    });

    // --- お気に入り解除 ---
    document.getElementById('fontmgr-fav-remove-btn')?.addEventListener('click', () => {
        if (!_fontMgr.selectedFamily) return;
        let removed = false;
        for (const cat of Object.keys(_fontMgr.favorites)) {
            const idx = _fontMgr.favorites[cat].indexOf(_fontMgr.selectedFamily);
            if (idx >= 0) { _fontMgr.favorites[cat].splice(idx, 1); removed = true; }
        }
        if (!removed) return;
        _fontMgrSaveFavs();
        _fontMgrRenderFavCatTabs();
        _fontMgrSyncCatSelects();
        if (_fontMgr.source === 'favorites') _fontMgrRenderList(_fontMgrCurrentList());
    });

    // --- カテゴリ追加 ---
    document.getElementById('fontmgr-cat-add-btn')?.addEventListener('click', () => {
        const name = prompt(t('font.promptCategoryName'));
        if (!name || !name.trim()) return;
        const trimmed = name.trim();
        if (FONTMGR_RESERVED_CAT_NAMES.has(trimmed)) { alert(t('font.reservedCategoryName', trimmed)); return; }
        if (_fontMgr.favorites[trimmed]) { alert(t('font.categoryExists')); return; }
        _fontMgr.favorites[trimmed] = [];
        _fontMgrSaveFavs();
        _fontMgrRenderFavCatTabs();
        _fontMgrSyncCatSelects();
    });

    // --- カテゴリ削除 ---
    document.getElementById('fontmgr-cat-del-btn')?.addEventListener('click', () => {
        const catSel = document.getElementById('fontmgr-fav-cat-select');
        const cat = catSel?.value;
        if (!cat) return;
        if (cat === FONTMGR_FAV_CAT) { alert(t('font.reservedCategoryDelete', _fontMgrCatLabel(cat))); return; }
        if (!confirm(t('font.confirmDeleteCategory', _fontMgrCatLabel(cat)))) return;
        delete _fontMgr.favorites[cat];
        _fontMgrSaveFavs();
        _fontMgrRenderFavCatTabs();
        _fontMgrSyncCatSelects();
    });

    // --- 適用ボタン（レイアウトタブ連携） ---
    document.getElementById('fontmgr-apply-btn')?.addEventListener('click', async () => {
        const family = _fontMgr.selectedFamily;
        if (!family || !state.selectedTextEl) {
            alert(t('textTool.selectTextFirst'));
            return;
        }
        state.selectedTextEl.setAttribute('font-family', family);
        state.balloon.fontFamily = family;
        // font-familyセレクトにも反映
        const fontSel = document.getElementById('font-family');
        if (fontSel) fontSel.value = family;
        const panelSvgEl = getPanelLayerSvg();
        if (panelSvgEl) {
            const panelId = state.selectedTextEl.closest('g[data-clip-panel]')
                ?.getAttribute('data-clip-panel') || state.selectedPanelId || 'panel-0';
            await savePanelSvg(panelId, panelSvgEl);
        }
        // Google Fontsなら動的ロード
        _fontMgrEnsureFontLoaded(family);
    });

    // 初期状態でソースを適用
    _fontMgrSyncCatSelects();
    _fontMgrSyncCustomFontSelects();
    _fontMgrRenderFavCatTabs();
    _fontMgrRenderAllTagsChips();
    _fontMgrSwitchPreviewTab(_fontMgr.activePreview);

    // 保存済みソースで初期表示
    document.querySelectorAll('.fontmgr-source-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.fontmgrSource === _fontMgr.source);
    });
    const loadWrap = document.getElementById('fontmgr-load-system-wrap');
    if (loadWrap) loadWrap.style.display = _fontMgr.source === 'system' ? '' : 'none';

    if (_fontMgr.source === 'google') {
        _fontMgrRenderList(_fontMgrGoogleList().map(f => ({ family: f, path: '' })));
    } else if (_fontMgr.source === 'favorites') {
        _fontMgrRenderList(_fontMgrCurrentList());
    } else {
        // systemは読み込みが必要
        await _fontMgrLoadSystemFonts();
    }
}

