// ============================================================
// main.js 分割ファイル (20/24): フォントマネージャータブ+文字スタイル
// 元 main.js の行 15503-16240 に相当
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: FONTMGR_FAV_CAT,FONTMGR_RESERVED_CAT_NAMES,_FONTMGR_LS_FAVS,_FONTMGR_LS_PREFS,_FONTMGR_LS_PRESETS,_FONTMGR_LS_STYLES,_FONTMGR_LS_STYLE_BG,_FONTMGR_LS_TAGS,_FONTMGR_PREVIEW_TEXTS,_FONTMGR_SENT_H,_FONTMGR_SENT_V,_esc,_fontMgrCatLabel,_fontMgrCatNames,_fontMgr,_fontMgrApplySentDir,_fontMgrApplyStyleToUI,_fontMgrBuildMixedHtml,_fontMgrCurrentList,_fontMgrEditingStyleId,_fontMgrEnsureFontLoaded,_fontMgrGetStyleFromUI,_fontMgrGoogleList,_fontMgrGroupOpen,_fontMgrInitStyleTab,_fontMgrIsCjk,_fontMgrLoad,_fontMgrLoadStyles,_fontMgrRenderAllTagsChips,_fontMgrRenderFavList,_fontMgrRenderList,_fontMgrRenderRightPanel,_fontMgrRenderStyleSelect,_fontMgrRenderTagChips,_fontMgrRenderTextStylePreview,_fontMgrResetStyleUI,_fontMgrSaveFavs,_fontMgrSavePrefs,_fontMgrSaveStyles,_fontMgrSaveTags,_fontMgrSelectFont,_fontMgrStyleList,_fontMgrToggleGroup,_fontMgrUpdateCustomPreview,_fontMgrUpdatePreview,_fontMgrUpdateStylePreview
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

    front.style.color = p.fill;
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

// UI入力値からスタイル更新
function _fontMgrUpdateStylePreview() {
    _fontMgrRenderStylePreviewSvg({
        fill: document.getElementById('style-fill-color')?.value || '#000000',
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

