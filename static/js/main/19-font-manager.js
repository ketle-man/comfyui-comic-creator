// ============================================================
// main.js 分割ファイル (20/24): フォントマネージャータブ+文字スタイル
// 元 main.js の行 15503-16240 に相当
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: FONTMGR_FAV_CAT,FONTMGR_RESERVED_CAT_NAMES,_FONTMGR_LS_FAVS,_FONTMGR_LS_PREFS,_FONTMGR_LS_PRESETS,_FONTMGR_LS_STYLES,_FONTMGR_LS_STYLE_BG,_FONTMGR_LS_TAGS,_FONTMGR_PREVIEW_TEXTS,_FONTMGR_SENT_H,_FONTMGR_SENT_V,_esc,_fontMgrCatLabel,_fontMgrCatNames,_fontMgr,_fontMgrApplySentDir,_fontMgrApplyStyleToUI,_fontMgrBuildMixedHtml,_fontMgrCurrentList,_fontMgrDrawGradRamp,_fontMgrEditingStyleId,_fontMgrEnsureFontLoaded,_fontMgrGetStyleFromUI,_fontMgrGoogleList,_fontMgrGroupOpen,_fontMgrInitStyleTab,_fontMgrIsCjk,_fontMgrLoad,_fontMgrLoadFillState,_fontMgrLoadStyles,_fontMgrRampColorAt,_fontMgrRenderAllTagsChips,_fontMgrRenderFavList,_fontMgrRenderList,_fontMgrRenderRightPanel,_fontMgrRenderStyleSelect,_fontMgrRenderTagChips,_fontMgrRenderTextStylePreview,_fontMgrResetStyleUI,_fontMgrSaveFavs,_fontMgrSavePrefs,_fontMgrSaveStyles,_fontMgrSaveTags,_fontMgrSelectFont,_fontMgrStyleList,_fontMgrSyncFillUI,_fontMgrToggleGroup,_fontMgrUpdateCustomPreview,_fontMgrUpdatePreview,_fontMgrUpdateStylePreview
// ============================================================

// ============================================================
// フォントマネージャータブ
// ============================================================

const _fontMgr = {
    // 状態
    source: 'system',           // 'system' | 'google' | 'favorites'
    activePreview: 'basic',     // 'basic' | 'sentence' | 'custom' | 'favlist'
    selectedFamily: null,
    systemFonts: [],            // [{family, path}]
    systemLoaded: false,
    previewSize: 32,
    sentDir: 'both',
    customDir: 'h',
    charChecks: { english: true, hiragana: false, katakana: false, kanji: false, numbers: false, symbols: false },
    // 永続化データ（localStorage）
    tags: {},                   // { family: [tag, ...] }
    favorites: {},              // { category: [family, ...] }
    selectedFavCat: null,       // 左パネルのお気に入りカテゴリタブで選択中カテゴリ（nullなら全カテゴリ）
};

const _FONTMGR_LS_TAGS = 'fontmgr_tags';
const _FONTMGR_LS_FAVS = 'fontmgr_favorites';
const _FONTMGR_LS_PREFS = 'fontmgr_prefs';
const _FONTMGR_LS_STYLES = 'fontmgr_text_styles';
const _FONTMGR_LS_STYLE_BG = 'fontmgr_style_preview_bg';
const _FONTMGR_LS_PRESETS = 'fontmgr_text_presets';

// 予約済みカテゴリ: お気に入り（起動時に自動作成される実カテゴリ。削除・同名での新規作成不可）
// データ上のキーはUI言語によらず 'お気に入り' 固定で、表示のみ _fontMgrCatLabel() で現在の言語に翻訳する
const FONTMGR_FAV_CAT = 'お気に入り';
// カテゴリ名として新規作成で使用禁止の予約名（予約済みカテゴリの3言語表示ラベル）
const FONTMGR_RESERVED_CAT_NAMES = new Set([FONTMGR_FAV_CAT, 'Favorites', '收藏']);

// カテゴリの表示名（予約済みカテゴリのみ翻訳、他はユーザー入力名のまま）
function _fontMgrCatLabel(cat) {
    return cat === FONTMGR_FAV_CAT ? t('fontsel.defaultCategory') : cat;
}

// カテゴリ名一覧（予約済みカテゴリを先頭に固定、他は登録順）
function _fontMgrCatNames() {
    return Object.keys(_fontMgr.favorites).sort((a, b) => (a === FONTMGR_FAV_CAT ? -1 : b === FONTMGR_FAV_CAT ? 1 : 0));
}

const _FONTMGR_PREVIEW_TEXTS = {
    english:  'The quick brown fox jumps over the lazy dog.',
    hiragana: 'いろはにほへと ちりぬるを わかよたれそ つねならむ',
    katakana: 'アイウエオ カキクケコ サシスセソ タチツテト ナニヌネノ',
    kanji:    '天地玄黄 宇宙洪荒 日月盈昃 辰宿列張 寒来暑往 秋収冬蔵',
    numbers:  '0123456789 123,456.789',
    symbols:  '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~',
};

const _FONTMGR_SENT_H = 'あのイーハトーヴォのすきとおった風、夏でも底に冷たさをもつ青いそら、\nThe quick brown fox jumps over the lazy dog. 0123456789 !@#$%';
const _FONTMGR_SENT_V = 'あのイーハトーヴォの\nすきとおった風\n夏でも底に冷たさをもつ\n青いそら\n「こんにちは！」と言った……。\nThe quick brown fox\njumps over the lazy dog.\n0123456789\n０１２３４５６７８９\n!"#$%&\'()*+,-./:;<=>?@\n！？「」（）～・…ー';

function _fontMgrLoad() {
    try { _fontMgr.tags = JSON.parse(localStorage.getItem(_FONTMGR_LS_TAGS) || '{}'); } catch { _fontMgr.tags = {}; }
    try {
        const favs = JSON.parse(localStorage.getItem(_FONTMGR_LS_FAVS) || '{}');
        _fontMgr.favorites = (typeof favs === 'object' && favs !== null && !Array.isArray(favs)) ? favs : {};
    } catch { _fontMgr.favorites = {}; }
    // 予約済みカテゴリ「お気に入り」を常設（削除されていても起動時に復元）
    if (!_fontMgr.favorites[FONTMGR_FAV_CAT]) {
        _fontMgr.favorites[FONTMGR_FAV_CAT] = [];
        _fontMgrSaveFavs();
    }
    try {
        const prefs = JSON.parse(localStorage.getItem(_FONTMGR_LS_PREFS) || '{}');
        if (prefs.previewSize) _fontMgr.previewSize = prefs.previewSize;
        if (prefs.charChecks) _fontMgr.charChecks = { ..._fontMgr.charChecks, ...prefs.charChecks };
        if (prefs.sentDir) _fontMgr.sentDir = prefs.sentDir;
        if (prefs.activePreview) _fontMgr.activePreview = prefs.activePreview;
        if (prefs.source) _fontMgr.source = prefs.source;
    } catch { /* ignore */ }
}

function _fontMgrSaveTags() {
    localStorage.setItem(_FONTMGR_LS_TAGS, JSON.stringify(_fontMgr.tags));
}
function _fontMgrSaveFavs() {
    localStorage.setItem(_FONTMGR_LS_FAVS, JSON.stringify(_fontMgr.favorites));
}
function _fontMgrSavePrefs() {
    localStorage.setItem(_FONTMGR_LS_PREFS, JSON.stringify({
        previewSize: _fontMgr.previewSize,
        charChecks: _fontMgr.charChecks,
        sentDir: _fontMgr.sentDir,
        activePreview: _fontMgr.activePreview,
        source: _fontMgr.source,
    }));
}

// Google Fontsリストを既存のGOOGLE_FONT_FAMILIES Setから取得
function _fontMgrGoogleList() {
    if (typeof GOOGLE_FONT_FAMILIES !== 'undefined') {
        return [...GOOGLE_FONT_FAMILIES].sort((a, b) => a.localeCompare(b));
    }
    // フォールバック: index.htmlの#font-group-googleのoption要素から収集
    const grp = document.getElementById('font-group-google');
    if (grp) return [...grp.querySelectorAll('option')].map(o => o.value).sort((a, b) => a.localeCompare(b));
    return [];
}

// 現在のソースに対応するフォントリストを返す
function _fontMgrCurrentList() {
    if (_fontMgr.source === 'google') {
        return _fontMgrGoogleList().map(f => ({ family: f, path: '' }));
    }
    if (_fontMgr.source === 'favorites') {
        const cats = (_fontMgr.selectedFavCat && _fontMgr.favorites[_fontMgr.selectedFavCat])
            ? [_fontMgr.selectedFavCat]
            : Object.keys(_fontMgr.favorites);
        const all = [];
        for (const cat of cats) {
            for (const f of (_fontMgr.favorites[cat] || [])) {
                if (!all.find(x => x.family === f)) all.push({ family: f, path: '', cat });
            }
        }
        return all.sort((a, b) => a.family.localeCompare(b.family));
    }
    // system
    return _fontMgr.systemFonts;
}

// フォント一覧グループの折りたたみ状態
// （フォントタブ左パネルは2026-07-11にフラット表示化。現在はアセットパネル「F」タブの
//   スタイル/プリセットグループ（09e-text-tool.js の _fontAssetBuildGroup）が使用する）
const _fontMgrGroupOpen = {};

// 折りたたみトグル共通処理（09e-text-tool.js のFタブアセットグリッドと共用）
function _fontMgrToggleGroup(key, arrow, wrap) {
    _fontMgrGroupOpen[key] = !_fontMgrGroupOpen[key];
    arrow.textContent = _fontMgrGroupOpen[key] ? '▾' : '▸';
    wrap.style.display = _fontMgrGroupOpen[key] ? '' : 'none';
}

// フォントリスト描画（フラット一覧。旧・2段階折りたたみ表示は2026-07-11に廃止、検索で絞り込む運用）
function _fontMgrRenderList(families) {
    const container = document.getElementById('fontmgr-font-list');
    if (!container) return;

    const nameQ = (document.getElementById('fontmgr-search-name')?.value || '').toLowerCase();
    const tagQ  = (document.getElementById('fontmgr-search-tag')?.value || '').toLowerCase();

    const filtered = families.filter(f => {
        if (nameQ && !f.family.toLowerCase().includes(nameQ)) return false;
        if (tagQ) {
            const tags = _fontMgr.tags[f.family] || [];
            if (!tags.some(t => t.toLowerCase().includes(tagQ))) return false;
        }
        return true;
    });

    container.innerHTML = '';

    if (filtered.length === 0) {
        container.innerHTML = `<p class="empty-message">${t('font.noFontsFound')}</p>`;
        return;
    }

    // 件数表示
    const countEl = document.createElement('div');
    countEl.style.cssText = 'font-size:11px;color:var(--text-secondary,#999);padding:4px 10px;border-bottom:1px solid var(--border-color);';
    countEl.textContent = t('font.countSuffix', filtered.length);
    container.appendChild(countEl);

    // フラット一覧（グループ化なし。絞り込みは上部の名前/タグ検索で行う）
    filtered.forEach(f => {
        const item = document.createElement('div');
        item.className = 'fontmgr-font-item' + (f.family === _fontMgr.selectedFamily ? ' selected' : '');
        item.dataset.family = f.family;
        const tags = (_fontMgr.tags[f.family] || []).map(t => `#${t}`).join(' ');
        item.innerHTML = `<div>${_esc(f.family)}</div>${tags ? `<div class="fontmgr-item-tags">${_esc(tags)}</div>` : ''}`;
        item.addEventListener('click', () => _fontMgrSelectFont(f.family));
        container.appendChild(item);
    });
}

// フォント選択
function _fontMgrSelectFont(family) {
    _fontMgr.selectedFamily = family;

    // リスト内のselectedクラスを更新
    document.querySelectorAll('.fontmgr-font-item').forEach(el => {
        el.classList.toggle('selected', el.dataset.family === family);
    });
    // ツリー内のselectedクラスを更新
    document.querySelectorAll('.fontmgr-fav-tree-item').forEach(el => {
        el.classList.toggle('selected', el.dataset.family === family);
    });

    // 右パネル更新
    _fontMgrRenderRightPanel();
    // プレビュー更新
    _fontMgrUpdatePreview();
    // フォントURLの事前読み込み（Google Fonts）
    _fontMgrEnsureFontLoaded(family);
}

// Google Fontsをdynamicにロード
function _fontMgrEnsureFontLoaded(family) {
    if (typeof GOOGLE_FONT_FAMILIES === 'undefined') return;
    if (!GOOGLE_FONT_FAMILIES.has(family)) return;
    // 既にlinkタグがあれば不要
    const encoded = encodeURIComponent(family).replace(/%20/g, '+');
    if (document.querySelector(`link[data-fontmgr-family="${CSS.escape(family)}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encoded}&display=swap`;
    link.dataset.fontmgrFamily = family;
    document.head.appendChild(link);
}

// プレビュー全体を現在の状態で更新
function _fontMgrUpdatePreview() {
    const family = _fontMgr.selectedFamily;
    const size = _fontMgr.previewSize;

    // 基本プレビュー
    const basicArea = document.getElementById('fontmgr-basic-preview-area');
    if (basicArea) {
        if (!family) {
            basicArea.innerHTML = `<p class="empty-message">${t('font.selectFontPrompt')}</p>`;
        } else {
            const activeKeys = Object.entries(_fontMgr.charChecks).filter(([, v]) => v).map(([k]) => k);
            basicArea.innerHTML = activeKeys.map(k =>
                `<div class="fontmgr-basic-row" style="font-family:'${_esc(family)}';font-size:${size}px;">${_esc(_FONTMGR_PREVIEW_TEXTS[k])}</div>`
            ).join('');
        }
    }

    // 文章プレビュー
    const sentH = document.getElementById('fontmgr-sent-h');
    const sentV = document.getElementById('fontmgr-sent-v');
    if (sentH && sentV) {
        const ff = family ? `'${_esc(family)}'` : 'inherit';
        const style = `font-family:${ff};font-size:${size}px;`;
        sentH.style.cssText = style;
        sentH.textContent = _FONTMGR_SENT_H;
        sentV.style.cssText = style;
        sentV.textContent = _FONTMGR_SENT_V;
        _fontMgrApplySentDir();
    }

    // カスタムプレビュー
    _fontMgrUpdateCustomPreview();

    // お気に入り一覧
    _fontMgrRenderFavList();

    // スタイルプレビュー
    _fontMgrUpdateStylePreview();
}

function _fontMgrApplySentDir() {
    const sentH = document.getElementById('fontmgr-sent-h');
    const sentV = document.getElementById('fontmgr-sent-v');
    if (!sentH || !sentV) return;
    const dir = _fontMgr.sentDir;
    sentH.style.display = (dir === 'v') ? 'none' : '';
    sentV.style.display = (dir === 'h') ? 'none' : '';
}

function _fontMgrUpdateCustomPreview() {
    const jpFamily = document.getElementById('fontmgr-jp-font')?.value || '';
    const enFamily = document.getElementById('fontmgr-en-font')?.value || '';
    const size = parseInt(document.getElementById('fontmgr-custom-size')?.value || '24', 10);
    const textColor = document.getElementById('fontmgr-text-color')?.value || '#e0e0e0';
    const bgColor   = document.getElementById('fontmgr-bg-color')?.value || '#1e1e1e';
    const text = document.getElementById('fontmgr-custom-input')?.value || '';
    const isV = _fontMgr.customDir === 'v';

    const wrapH = document.getElementById('fontmgr-custom-preview-h');
    const wrapV = document.getElementById('fontmgr-custom-preview-v');
    if (!wrapH || !wrapV) return;

    if (isV) {
        wrapH.style.display = 'none';
        wrapV.style.display = '';
        wrapV.style.color = textColor;
        wrapV.style.backgroundColor = bgColor;
        wrapV.style.fontFamily = jpFamily ? `'${jpFamily}'` : 'inherit';
        wrapV.style.fontSize = size + 'px';
        wrapV.textContent = text;
    } else {
        wrapV.style.display = 'none';
        wrapH.style.display = '';
        wrapH.style.color = textColor;
        wrapH.style.backgroundColor = bgColor;
        // 混植HTML生成
        wrapH.innerHTML = _fontMgrBuildMixedHtml(text, jpFamily, enFamily, size, textColor);
    }
}

// CJK判定
function _fontMgrIsCjk(ch) {
    const cp = ch.codePointAt(0);
    return (cp >= 0x3000 && cp <= 0x9FFF) || (cp >= 0xF900 && cp <= 0xFAFF) || (cp >= 0x20000 && cp <= 0x2FA1F);
}

// 混植HTML（横書き）
function _fontMgrBuildMixedHtml(text, jpFamily, enFamily, size, textColor) {
    if (!text) return '';
    const parts = [];
    for (const line of text.split('\n')) {
        if (parts.length) parts.push('<br>');
        let buf = '', bufCjk = null;
        for (const ch of line) {
            const cjk = _fontMgrIsCjk(ch);
            if (bufCjk === null) bufCjk = cjk;
            if (cjk === bufCjk) { buf += ch; continue; }
            if (buf) {
                const ff = bufCjk ? jpFamily : enFamily;
                parts.push(`<span style="font-family:'${_esc(ff)}';font-size:${size}px;color:${textColor};">${_esc(buf)}</span>`);
            }
            buf = ch; bufCjk = cjk;
        }
        if (buf) {
            const ff = bufCjk ? jpFamily : enFamily;
            parts.push(`<span style="font-family:'${_esc(ff)}';font-size:${size}px;color:${textColor};">${_esc(buf)}</span>`);
        }
    }
    return parts.join('');
}

function _esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// お気に入り一覧プレビュー描画
function _fontMgrRenderFavList() {
    const area = document.getElementById('fontmgr-favlist-area');
    if (!area) return;
    const catSel = document.getElementById('fontmgr-favlist-cat-select');
    const cat = catSel?.value;
    if (!cat || !_fontMgr.favorites[cat]) {
        area.innerHTML = `<p class="empty-message">${t('font.selectCategoryPrompt')}</p>`;
        return;
    }
    const fonts = _fontMgr.favorites[cat];
    if (fonts.length === 0) {
        area.innerHTML = `<p class="empty-message">${t('fontsel.noCategoryFonts')}</p>`;
        return;
    }
    const activeKeys = Object.entries(_fontMgr.charChecks).filter(([, v]) => v).map(([k]) => k);
    const size = _fontMgr.previewSize;
    area.innerHTML = fonts.map(family =>
        `<div class="fontmgr-favlist-font-block">
          <div class="fontmgr-favlist-font-name">${_esc(family)}</div>
          ${activeKeys.map(k =>
            `<div class="fontmgr-favlist-sample" style="font-family:'${_esc(family)}';font-size:${size}px;">${_esc(_FONTMGR_PREVIEW_TEXTS[k])}</div>`
          ).join('')}
        </div>`
    ).join('');
}

// 右パネル描画
function _fontMgrRenderRightPanel() {
    const family = _fontMgr.selectedFamily;
    document.getElementById('fontmgr-family-name').textContent = family || t('font.noFontSelected');

    // ファイルパス（システムフォントの場合）
    const sysFont = _fontMgr.systemFonts.find(f => f.family === family);
    document.getElementById('fontmgr-file-path').textContent = sysFont?.path || '';

    // 適用ボタンのenable/disable
    const applyBtn = document.getElementById('fontmgr-apply-btn');
    if (applyBtn) applyBtn.disabled = !family;

    // タグチップ描画
    _fontMgrRenderTagChips();
    _fontMgrRenderAllTagsChips();
}

// プロパティ表示エリア: 選択中フォントに付いているタグ（クリックで削除）
function _fontMgrRenderTagChips() {
    const container = document.getElementById('fontmgr-tag-chips');
    if (!container) return;
    container.innerHTML = '';
    const tags = _fontMgr.tags[_fontMgr.selectedFamily] || [];
    tags.forEach(tag => {
        const chip = document.createElement('span');
        chip.className = 'fontmgr-tag-chip';
        chip.title = t('font.clickToRemove');
        chip.textContent = `#${tag} ×`;
        chip.addEventListener('click', () => {
            const list = _fontMgr.tags[_fontMgr.selectedFamily] || [];
            const idx = list.indexOf(tag);
            if (idx >= 0) list.splice(idx, 1);
            _fontMgrSaveTags();
            _fontMgrRenderTagChips();
            _fontMgrRenderAllTagsChips();
            _fontMgrRenderList(_fontMgrCurrentList());
        });
        container.appendChild(chip);
    });
}

// タグ追加エリア: これまでに作成された全タグの一覧（クリックで選択中フォントに追加）
function _fontMgrRenderAllTagsChips() {
    const container = document.getElementById('fontmgr-all-tags-chips');
    if (!container) return;
    container.innerHTML = '';
    const allTags = [...new Set(Object.values(_fontMgr.tags).flat())].sort();
    const current = _fontMgr.tags[_fontMgr.selectedFamily] || [];
    allTags.forEach(tag => {
        const chip = document.createElement('span');
        const already = current.includes(tag);
        chip.className = 'fontmgr-tag-chip fontmgr-alltag-chip' + (already ? ' selected' : '');
        chip.title = already ? t('font.tagAlreadyAdded') : t('font.clickToAddTag');
        chip.textContent = `#${tag}`;
        chip.addEventListener('click', () => {
            if (!_fontMgr.selectedFamily || already) return;
            const list = _fontMgr.tags[_fontMgr.selectedFamily] = _fontMgr.tags[_fontMgr.selectedFamily] || [];
            if (!list.includes(tag)) {
                list.push(tag);
                list.sort();
            }
            _fontMgrSaveTags();
            _fontMgrRenderTagChips();
            _fontMgrRenderAllTagsChips();
            _fontMgrRenderList(_fontMgrCurrentList());
        });
        container.appendChild(chip);
    });
}

// ─────────────────────────────────────────────
//  文字スタイル（塗り・線・袋文字・影）: 中央パネル「スタイル」プレビュータブ
// ─────────────────────────────────────────────

let _fontMgrStyleList = [];
let _fontMgrEditingStyleId = null;

function _fontMgrLoadStyles() {
    try {
        const list = JSON.parse(localStorage.getItem(_FONTMGR_LS_STYLES) || '[]');
        // v2以降のみ読み込む。v2からスタイル値は「フォントサイズ100pxあたりのpx」の相対値になり、
        // 旧データ（タブごとに解釈が異なる絶対値）とは単位系が違うため破棄する（ユーザー合意済み）
        return Array.isArray(list) ? list.filter(s => s && s.v === 2) : [];
    } catch { return []; }
}
function _fontMgrSaveStyles() {
    localStorage.setItem(_FONTMGR_LS_STYLES, JSON.stringify(_fontMgrStyleList));
}

// CSSベースの簡易スタイルプレビュー描画（アセットパネル「F」タブのミニサムネ用の近似表示。
// スタイルタブ・プリセットタブの本プレビューはSVG版 _fontMgrRenderStylePreviewSvg を使う）
// スタイル値は「フォントサイズ100pxあたりのpx」の相対値(v2)なので表示サイズでスケールし、
// 描画基準もSVG側（線=中央基準S/2、袋文字帯=B、影は最背面シルエット）に近づける
function _fontMgrRenderTextStylePreview(back, front, p) {
    if (!back || !front) return;
    const k = (p.size || 100) / 100;
    [back, front].forEach(el => {
        el.textContent = p.text;
        el.style.fontFamily = `'${p.fontFamily}'`;
        el.style.fontSize = p.size + 'px';
        el.style.fontWeight = p.boldEnabled ? 'bold' : 'normal';
        el.style.fontStyle = p.italicEnabled ? 'italic' : 'normal';
        el.style.textDecorationLine = p.underlineEnabled ? 'underline' : 'none';
        el.style.textAlign = p.align || 'left';
    });

    // 袋文字: 背面に「線幅+袋文字幅×2」の太い縁取りを敷き、前面の線と重ねて二重取りに見せる
    if (p.bukuroEnabled) {
        back.style.display = '';
        back.style.color = p.bukuroColor;
        const w = ((p.strokeEnabled ? p.strokeWidth || 0 : 0) + (p.bukuroWidth || 0) * 2) * k;
        back.style.webkitTextStroke = `${w}px ${p.bukuroColor}`;
    } else {
        back.style.display = 'none';
    }

    // CSSミニプレビューはグラデ・テクスチャを表現できないため代表色（先頭ストップ）で近似し、塗りなしは透明にする
    front.style.color = (p.fillEnabled === false) ? 'transparent'
        : (p.fillMode === 'gradient' ? (p.fillGradient?.stops?.[0]?.color || p.fill) : p.fill);
    front.style.webkitTextStroke = p.strokeEnabled ? `${(p.strokeWidth || 0) * k}px ${p.strokeColor}` : '0px transparent';
    const shadowCss = p.shadowEnabled
        ? `${(p.shadowDx || 0) * k}px ${(p.shadowDy || 0) * k}px ${(p.shadowBlur || 0) * k}px ${p.shadowColor}`
        : 'none';
    back.style.textShadow  = p.bukuroEnabled ? shadowCss : 'none';
    front.style.textShadow = p.bukuroEnabled ? 'none' : shadowCss;
}

// スタイルタブ／プリセットタブ共用のSVGプレビュー描画。
// 実適用と同じ _fontMgrApplyStyleAttrsToTextEl を通すため、レイアウト/Imageタブの実表示と一致する
function _fontMgrRenderStylePreviewSvg(styleObj) {
    const svgEl  = document.getElementById('style-preview-svg');
    const textEl = document.getElementById('style-preview-text');
    if (!svgEl || !textEl) return;

    const size = parseInt(document.getElementById('style-preview-size')?.value, 10) || 150;
    textEl.textContent = document.getElementById('style-preview-input')?.value || 'あ亜Aa1';
    textEl.setAttribute('font-family', _fontMgr.selectedFamily || 'sans-serif');
    textEl.setAttribute('font-size', size);
    _fontMgrApplyStyleAttrsToTextEl(textEl, svgEl, styleObj);

    // viewBoxをテキスト＋スタイル分の余白にフィットさせる（スタイル値は相対値なのでsizeでスケール）
    let bb;
    try { bb = textEl.getBBox(); } catch { return; }
    if (!bb || (!bb.width && !bb.height)) return;
    const k = size / 100;
    const pad = ((styleObj.bukuroEnabled ? (styleObj.bukuroWidth || 0) : 0)
              + (styleObj.strokeEnabled ? (styleObj.strokeWidth || 0) / 2 : 0)
              + (styleObj.shadowEnabled ? (styleObj.shadowBlur || 0) + Math.max(Math.abs(styleObj.shadowDx || 0), Math.abs(styleObj.shadowDy || 0)) : 0)) * k
              + size * 0.1;
    svgEl.setAttribute('viewBox', `${bb.x - pad} ${bb.y - pad} ${bb.width + pad * 2} ${bb.height + pad * 2}`);
}

// ── 塗り（塗りなし/単色/グラデーション/テクスチャ）状態 ──
// カラーランプのストップ等はDOM入力だけでは表現できないため、モジュールスコープの状態として保持する
// （text-style-modal.js の fillState と同じ設計。フォントタブとモーダルは別々のDOM/状態を持つ）
let _fontMgrFillState = {
    enabled: true,
    mode: 'solid',
    gradient: { shape: 'linear', angleDeg: 0, stops: [{ pos: 0, color: '#ffffff' }, { pos: 1, color: '#888888' }] },
    selectedStopIdx: 0,
    texture: null, // { dataUrl, w, h, scale }
};

function _fontMgrHex2Rgb(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '#000000');
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 0, g: 0, b: 0 };
}
function _fontMgrRgb2Hex({ r, g, b }) {
    const h = v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
}
// カラーランプ上の位置tの補間色（image-tab FillTool.evalGradient / text-style-modal.js と同じ挙動）
function _fontMgrRampColorAt(stops, tPos) {
    const sorted = [...stops].sort((a, b) => a.pos - b.pos);
    if (!sorted.length) return '#000000';
    if (tPos <= sorted[0].pos) return sorted[0].color;
    const last = sorted[sorted.length - 1];
    if (tPos >= last.pos) return last.color;
    for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i], b = sorted[i + 1];
        if (tPos >= a.pos && tPos <= b.pos) {
            const lt = (b.pos - a.pos) > 0 ? (tPos - a.pos) / (b.pos - a.pos) : 0;
            const ca = _fontMgrHex2Rgb(a.color), cb = _fontMgrHex2Rgb(b.color);
            return _fontMgrRgb2Hex({ r: ca.r + (cb.r - ca.r) * lt, g: ca.g + (cb.g - ca.g) * lt, b: ca.b + (cb.b - ca.b) * lt });
        }
    }
    return last.color;
}

// カラーランプの描画（text-style-modal.js の drawGradRamp と同じ）
function _fontMgrDrawGradRamp() {
    const canvas = document.getElementById('style-grad-ramp');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const barH = h - 10;
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    [..._fontMgrFillState.gradient.stops].sort((a, b) => a.pos - b.pos).forEach(s => grad.addColorStop(Math.max(0, Math.min(1, s.pos)), s.color));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, barH);
    ctx.strokeStyle = '#666';
    ctx.strokeRect(0.5, 0.5, w - 1, barH - 1);
    _fontMgrFillState.gradient.stops.forEach((s, i) => {
        const x = Math.max(5, Math.min(w - 5, s.pos * w));
        ctx.beginPath();
        ctx.moveTo(x, h);
        ctx.lineTo(x - 5, barH);
        ctx.lineTo(x + 5, barH);
        ctx.closePath();
        ctx.fillStyle = i === _fontMgrFillState.selectedStopIdx ? '#0077ff' : '#999';
        ctx.fill();
    });
}

// モード・チェックに応じたコントロールの表示切替
function _fontMgrSyncFillUI() {
    const enableEl = document.getElementById('style-fill-enable');
    const modeEl = document.getElementById('style-fill-mode');
    if (!enableEl || !modeEl) return;
    enableEl.checked = _fontMgrFillState.enabled;
    modeEl.value = _fontMgrFillState.mode;
    modeEl.disabled = !_fontMgrFillState.enabled;
    document.getElementById('style-fill-color').style.display = (_fontMgrFillState.enabled && _fontMgrFillState.mode === 'solid') ? '' : 'none';
    document.getElementById('style-fill-gradient-panel').style.display = (_fontMgrFillState.enabled && _fontMgrFillState.mode === 'gradient') ? 'flex' : 'none';
    document.getElementById('style-fill-texture-panel').style.display = (_fontMgrFillState.enabled && _fontMgrFillState.mode === 'texture') ? 'flex' : 'none';
    const thumb = document.getElementById('style-tex-thumb');
    if (_fontMgrFillState.texture?.dataUrl) {
        thumb.src = _fontMgrFillState.texture.dataUrl;
        thumb.style.display = '';
    } else {
        thumb.style.display = 'none';
    }
    if (_fontMgrFillState.enabled && _fontMgrFillState.mode === 'gradient') {
        document.getElementById('style-grad-shape').value = _fontMgrFillState.gradient.shape;
        document.getElementById('style-grad-angle').value = _fontMgrFillState.gradient.angleDeg;
        const sel = _fontMgrFillState.gradient.stops[_fontMgrFillState.selectedStopIdx];
        if (sel) document.getElementById('style-grad-stop-color').value = sel.color;
        _fontMgrDrawGradRamp();
    }
}

// style オブジェクトの塗り関連フィールドを _fontMgrFillState へ読み込む
function _fontMgrLoadFillState(style) {
    _fontMgrFillState.enabled = style?.fillEnabled !== false;
    _fontMgrFillState.mode = style?.fillMode || 'solid';
    if (style?.fillGradient?.stops?.length) {
        _fontMgrFillState.gradient = {
            shape: style.fillGradient.shape === 'radial' ? 'radial' : 'linear',
            angleDeg: style.fillGradient.angleDeg || 0,
            stops: style.fillGradient.stops.map(s => ({ pos: s.pos, color: s.color })),
        };
    } else {
        _fontMgrFillState.gradient = { shape: 'linear', angleDeg: 0, stops: [{ pos: 0, color: '#ffffff' }, { pos: 1, color: '#888888' }] };
    }
    _fontMgrFillState.selectedStopIdx = 0;
    _fontMgrFillState.texture = style?.fillTexture?.dataUrl ? { ...style.fillTexture } : null;
    const scaleEl = document.getElementById('style-tex-scale');
    if (scaleEl) scaleEl.value = style?.fillTexture?.scale || 100;
    _fontMgrSyncFillUI();
}

// UI入力値からスタイル更新
function _fontMgrUpdateStylePreview() {
    _fontMgrRenderStylePreviewSvg({
        fill: document.getElementById('style-fill-color')?.value || '#000000',
        fillEnabled: _fontMgrFillState.enabled,
        fillMode: _fontMgrFillState.mode,
        fillGradient: _fontMgrFillState.mode === 'gradient' ? {
            shape: document.getElementById('style-grad-shape')?.value === 'radial' ? 'radial' : 'linear',
            angleDeg: parseFloat(document.getElementById('style-grad-angle')?.value) || 0,
            stops: _fontMgrFillState.gradient.stops.map(s => ({ pos: s.pos, color: s.color })),
        } : (_fontMgrFillState.gradient ? {
            shape: _fontMgrFillState.gradient.shape,
            angleDeg: _fontMgrFillState.gradient.angleDeg,
            stops: _fontMgrFillState.gradient.stops.map(s => ({ pos: s.pos, color: s.color })),
        } : null),
        fillTexture: _fontMgrFillState.texture ? {
            ..._fontMgrFillState.texture,
            scale: parseFloat(document.getElementById('style-tex-scale')?.value) || 100,
        } : null,
        strokeEnabled: !!document.getElementById('style-stroke-enable')?.checked,
        strokeColor: document.getElementById('style-stroke-color')?.value || '#ffffff',
        strokeWidth: parseFloat(document.getElementById('style-stroke-width')?.value) || 0,
        boldEnabled: !!document.getElementById('style-bold-enable')?.checked,
        italicEnabled: !!document.getElementById('style-italic-enable')?.checked,
        underlineEnabled: !!document.getElementById('style-underline-enable')?.checked,
        align: document.getElementById('style-align-select')?.value || 'left',
        bukuroEnabled: !!document.getElementById('style-bukuro-enable')?.checked,
        bukuroColor: document.getElementById('style-bukuro-color')?.value || '#000000',
        bukuroWidth: parseFloat(document.getElementById('style-bukuro-width')?.value) || 0,
        shadowEnabled: !!document.getElementById('style-shadow-enable')?.checked,
        shadowColor: document.getElementById('style-shadow-color')?.value || '#000000',
        shadowBlur: parseFloat(document.getElementById('style-shadow-blur')?.value) || 0,
        shadowDx: parseFloat(document.getElementById('style-shadow-dx')?.value) || 0,
        shadowDy: parseFloat(document.getElementById('style-shadow-dy')?.value) || 0,
    });
}

function _fontMgrGetStyleFromUI(name) {
    return {
        id: _fontMgrEditingStyleId || `style_${Date.now()}`,
        name,
        v: 2, // v2: 数値はフォントサイズ100pxあたりのpx（相対値）
        fill: document.getElementById('style-fill-color')?.value || '#000000',
        fillEnabled: _fontMgrFillState.enabled,
        fillMode: _fontMgrFillState.mode,
        fillGradient: _fontMgrFillState.mode === 'gradient' ? {
            shape: document.getElementById('style-grad-shape')?.value === 'radial' ? 'radial' : 'linear',
            angleDeg: parseFloat(document.getElementById('style-grad-angle')?.value) || 0,
            stops: _fontMgrFillState.gradient.stops.map(s => ({ pos: s.pos, color: s.color })),
        } : (_fontMgrFillState.gradient ? {
            shape: _fontMgrFillState.gradient.shape,
            angleDeg: _fontMgrFillState.gradient.angleDeg,
            stops: _fontMgrFillState.gradient.stops.map(s => ({ pos: s.pos, color: s.color })),
        } : null),
        fillTexture: _fontMgrFillState.texture ? {
            ..._fontMgrFillState.texture,
            scale: parseFloat(document.getElementById('style-tex-scale')?.value) || 100,
        } : null,
        strokeEnabled: !!document.getElementById('style-stroke-enable')?.checked,
        strokeColor: document.getElementById('style-stroke-color')?.value || '#ffffff',
        strokeWidth: parseFloat(document.getElementById('style-stroke-width')?.value) || 0,
        boldEnabled: !!document.getElementById('style-bold-enable')?.checked,
        italicEnabled: !!document.getElementById('style-italic-enable')?.checked,
        underlineEnabled: !!document.getElementById('style-underline-enable')?.checked,
        align: document.getElementById('style-align-select')?.value || 'left',
        bukuroEnabled: !!document.getElementById('style-bukuro-enable')?.checked,
        bukuroColor: document.getElementById('style-bukuro-color')?.value || '#000000',
        bukuroWidth: parseFloat(document.getElementById('style-bukuro-width')?.value) || 0,
        shadowEnabled: !!document.getElementById('style-shadow-enable')?.checked,
        shadowColor: document.getElementById('style-shadow-color')?.value || '#000000',
        shadowBlur: parseFloat(document.getElementById('style-shadow-blur')?.value) || 0,
        shadowDx: parseFloat(document.getElementById('style-shadow-dx')?.value) || 0,
        shadowDy: parseFloat(document.getElementById('style-shadow-dy')?.value) || 0,
    };
}

function _fontMgrApplyStyleToUI(style) {
    document.getElementById('style-fill-color').value = style.fill;
    _fontMgrLoadFillState(style);
    document.getElementById('style-stroke-enable').checked = style.strokeEnabled;
    document.getElementById('style-stroke-color').value = style.strokeColor;
    document.getElementById('style-stroke-width').value = style.strokeWidth;
    document.getElementById('style-bold-enable').checked = !!style.boldEnabled;
    document.getElementById('style-italic-enable').checked = !!style.italicEnabled;
    document.getElementById('style-underline-enable').checked = !!style.underlineEnabled;
    document.getElementById('style-align-select').value = style.align || 'left';
    document.getElementById('style-bukuro-enable').checked = style.bukuroEnabled;
    document.getElementById('style-bukuro-color').value = style.bukuroColor;
    document.getElementById('style-bukuro-width').value = style.bukuroWidth;
    document.getElementById('style-shadow-enable').checked = style.shadowEnabled;
    document.getElementById('style-shadow-color').value = style.shadowColor;
    document.getElementById('style-shadow-blur').value = style.shadowBlur;
    document.getElementById('style-shadow-dx').value = style.shadowDx;
    document.getElementById('style-shadow-dy').value = style.shadowDy;
    document.getElementById('style-name-input').value = style.name;
    _fontMgrEditingStyleId = style.id;
    _fontMgrRenderStyleSelect();
    _fontMgrUpdateStylePreview();
}

function _fontMgrResetStyleUI() {
    _fontMgrEditingStyleId = null;
    document.getElementById('style-name-input').value = '';
    document.getElementById('style-fill-color').value = '#000000';
    _fontMgrLoadFillState(null);
    document.getElementById('style-stroke-enable').checked = false;
    document.getElementById('style-stroke-color').value = '#ffffff';
    document.getElementById('style-stroke-width').value = 4;
    document.getElementById('style-bold-enable').checked = false;
    document.getElementById('style-italic-enable').checked = false;
    document.getElementById('style-underline-enable').checked = false;
    document.getElementById('style-align-select').value = 'left';
    document.getElementById('style-bukuro-enable').checked = false;
    document.getElementById('style-bukuro-color').value = '#000000';
    document.getElementById('style-bukuro-width').value = 8;
    document.getElementById('style-shadow-enable').checked = false;
    document.getElementById('style-shadow-color').value = '#000000';
    document.getElementById('style-shadow-blur').value = 4;
    document.getElementById('style-shadow-dx').value = 4;
    document.getElementById('style-shadow-dy').value = 4;
    _fontMgrRenderStyleSelect();
    _fontMgrUpdateStylePreview();
}

// 登録済みスタイルのドロップダウンを更新（値は現在編集中のIDを維持）
function _fontMgrRenderStyleSelect() {
    const sel = document.getElementById('style-select');
    if (!sel) return;
    sel.innerHTML = `<option value="">${t('font.newOption')}</option>` +
        _fontMgrStyleList.map(s => `<option value="${_esc(s.id)}">${_esc(s.name)}</option>`).join('');
    sel.value = _fontMgrEditingStyleId || '';
}

function _fontMgrInitStyleTab() {
    const previewInputIds = [
        'style-preview-input', 'style-preview-size',
        'style-fill-color',
        'style-stroke-enable', 'style-stroke-color', 'style-stroke-width',
        'style-bold-enable', 'style-italic-enable', 'style-underline-enable', 'style-align-select',
        'style-bukuro-enable', 'style-bukuro-color', 'style-bukuro-width',
        'style-shadow-enable', 'style-shadow-color', 'style-shadow-blur', 'style-shadow-dx', 'style-shadow-dy',
    ];
    previewInputIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const evt = (el.type === 'checkbox' || el.tagName === 'SELECT') ? 'change' : 'input';
        el.addEventListener(evt, _fontMgrUpdateStylePreview);
    });

    // ── 塗り（塗りなし/モード/グラデーション/テクスチャ）イベント ──
    document.getElementById('style-fill-enable')?.addEventListener('change', e => {
        _fontMgrFillState.enabled = e.target.checked;
        _fontMgrSyncFillUI();
        _fontMgrUpdateStylePreview();
    });
    document.getElementById('style-fill-mode')?.addEventListener('change', e => {
        _fontMgrFillState.mode = e.target.value;
        _fontMgrSyncFillUI();
        _fontMgrUpdateStylePreview();
    });
    document.getElementById('style-grad-shape')?.addEventListener('change', e => {
        _fontMgrFillState.gradient.shape = e.target.value;
        _fontMgrUpdateStylePreview();
    });
    document.getElementById('style-grad-angle')?.addEventListener('input', () => _fontMgrUpdateStylePreview());
    document.getElementById('style-grad-stop-color')?.addEventListener('input', e => {
        const s = _fontMgrFillState.gradient.stops[_fontMgrFillState.selectedStopIdx];
        if (s) { s.color = e.target.value; _fontMgrDrawGradRamp(); _fontMgrUpdateStylePreview(); }
    });
    document.getElementById('style-grad-stop-add')?.addEventListener('click', () => {
        // 最も広い隙間の中央に追加（image-tab FillTool.addStop / text-style-modal.js と同じ挙動）
        const sorted = [..._fontMgrFillState.gradient.stops].sort((a, b) => a.pos - b.pos);
        let gapStart = 0, gapSize = 0;
        for (let i = 0; i < sorted.length - 1; i++) {
            const gap = sorted[i + 1].pos - sorted[i].pos;
            if (gap > gapSize) { gapSize = gap; gapStart = sorted[i].pos; }
        }
        const pos = sorted.length < 2 ? 0.5 : gapStart + gapSize / 2;
        _fontMgrFillState.gradient.stops.push({ pos, color: _fontMgrRampColorAt(_fontMgrFillState.gradient.stops, pos) });
        _fontMgrFillState.selectedStopIdx = _fontMgrFillState.gradient.stops.length - 1;
        _fontMgrSyncFillUI();
        _fontMgrUpdateStylePreview();
    });
    document.getElementById('style-grad-stop-remove')?.addEventListener('click', () => {
        if (_fontMgrFillState.gradient.stops.length <= 1) return;
        _fontMgrFillState.gradient.stops.splice(_fontMgrFillState.selectedStopIdx, 1);
        _fontMgrFillState.selectedStopIdx = Math.max(0, Math.min(_fontMgrFillState.selectedStopIdx, _fontMgrFillState.gradient.stops.length - 1));
        _fontMgrSyncFillUI();
        _fontMgrUpdateStylePreview();
    });
    // ランプ: ストップの選択・ドラッグ移動
    document.getElementById('style-grad-ramp')?.addEventListener('mousedown', e => {
        const canvas = document.getElementById('style-grad-ramp');
        const rect = canvas.getBoundingClientRect();
        const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
        let best = -1, bestDist = 9;
        _fontMgrFillState.gradient.stops.forEach((s, i) => {
            const d = Math.abs(s.pos * canvas.width - mx);
            if (d < bestDist) { bestDist = d; best = i; }
        });
        if (best < 0) return;
        _fontMgrFillState.selectedStopIdx = best;
        document.getElementById('style-grad-stop-color').value = _fontMgrFillState.gradient.stops[best].color;
        _fontMgrDrawGradRamp();
        const onMove = ev => {
            const r = canvas.getBoundingClientRect();
            const x = (ev.clientX - r.left) * (canvas.width / r.width);
            _fontMgrFillState.gradient.stops[_fontMgrFillState.selectedStopIdx].pos = Math.max(0, Math.min(1, x / canvas.width));
            _fontMgrDrawGradRamp();
            _fontMgrUpdateStylePreview();
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
    // テクスチャ画像選択（localStorage容量対策として最大512pxへ縮小して保持）
    document.getElementById('style-tex-select-btn')?.addEventListener('click', () => document.getElementById('style-tex-file')?.click());
    document.getElementById('style-tex-file')?.addEventListener('change', e => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                const MAX = 512;
                const sc = Math.min(1, MAX / Math.max(img.width, img.height));
                const w = Math.max(1, Math.round(img.width * sc));
                const h = Math.max(1, Math.round(img.height * sc));
                const cv = document.createElement('canvas');
                cv.width = w;
                cv.height = h;
                cv.getContext('2d').drawImage(img, 0, 0, w, h);
                _fontMgrFillState.texture = { dataUrl: cv.toDataURL('image/png'), w, h, scale: parseFloat(document.getElementById('style-tex-scale')?.value) || 100 };
                _fontMgrSyncFillUI();
                _fontMgrUpdateStylePreview();
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    });
    document.getElementById('style-tex-scale')?.addEventListener('input', () => _fontMgrUpdateStylePreview());
    _fontMgrSyncFillUI();

    document.getElementById('style-save-btn')?.addEventListener('click', () => {
        const name = document.getElementById('style-name-input')?.value.trim();
        if (!name) { alert(t('font.enterStyleName')); return; }
        // 読込中のスタイルから名前を変更した場合は上書きせず別名で新規保存する
        const loaded = _fontMgrStyleList.find(s => s.id === _fontMgrEditingStyleId);
        if (loaded && loaded.name !== name) _fontMgrEditingStyleId = null;
        const style = _fontMgrGetStyleFromUI(name);
        const idx = _fontMgrStyleList.findIndex(s => s.id === style.id);
        if (idx >= 0) _fontMgrStyleList[idx] = style;
        else _fontMgrStyleList.push(style);
        _fontMgrSaveStyles();
        _fontMgrEditingStyleId = style.id;
        _fontMgrRenderStyleSelect();
        _fontMgrRenderPresetStyleSelect();
    });

    document.getElementById('style-new-btn')?.addEventListener('click', () => {
        _fontMgrResetStyleUI();
    });

    document.getElementById('style-select')?.addEventListener('change', (e) => {
        const id = e.target.value;
        if (!id) { _fontMgrResetStyleUI(); return; }
        const style = _fontMgrStyleList.find(s => s.id === id);
        if (style) _fontMgrApplyStyleToUI(style);
    });

    document.getElementById('style-delete-btn')?.addEventListener('click', () => {
        const id = document.getElementById('style-select')?.value;
        const style = _fontMgrStyleList.find(s => s.id === id);
        if (!style) { alert(t('font.selectStyleToDelete')); return; }
        if (!confirm(t('font.confirmDeleteStyle', style.name))) return;
        _fontMgrStyleList = _fontMgrStyleList.filter(s => s.id !== style.id);
        _fontMgrSaveStyles();
        _fontMgrResetStyleUI();
        _fontMgrRenderPresetStyleSelect();
    });

    const bgDefaultBtn = document.getElementById('style-preview-bg-default');
    const bgWhiteBtn = document.getElementById('style-preview-bg-white');
    const applyBg = (bg) => {
        document.getElementById('style-preview-canvas')?.classList.toggle('bg-white', bg === 'white');
        bgDefaultBtn?.classList.toggle('active', bg !== 'white');
        bgWhiteBtn?.classList.toggle('active', bg === 'white');
        localStorage.setItem(_FONTMGR_LS_STYLE_BG, bg);
    };
    bgDefaultBtn?.addEventListener('click', () => applyBg('default'));
    bgWhiteBtn?.addEventListener('click', () => applyBg('white'));
    applyBg(localStorage.getItem(_FONTMGR_LS_STYLE_BG) === 'white' ? 'white' : 'default');

    _fontMgrStyleList = _fontMgrLoadStyles();
    _fontMgrRenderStyleSelect();
    _fontMgrUpdateStylePreview();
}

