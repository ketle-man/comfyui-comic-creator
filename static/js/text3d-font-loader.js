// text3d-font-loader.js — 3Dテキスト機能用のフォント取得
//
// フォントファミリー名から opentype.Font を取得する。
// - Google Fonts: ブラウザの fetch() は User-Agent を偽装できずCSS2 APIから
//   常に woff2 が返る（opentype.jsは非対応）ため、py/ccc.py の
//   /api/ccc/google-font-ttf エンドポイント（非ブラウザ的UAでリクエストしTTFを得る）
//   経由で取得する。
// - システムフォント: Local Font Access API（window.queryLocalFonts）経由でttf/otfを取得する。
//   main/12-text-png-export.js の buildSystemFontFaceCSS と同じ調達手段。
//
// opentype.js 本体（static/js/vendor/opentype.module.js）は3Dテキスト未使用時の
// 初期ロードコストを避けるため、初回使用時に動的importする。

const OPENTYPE_URL = '/ccc_static/js/vendor/opentype.module.js';

let _opentypeModulePromise = null;
function _loadOpentypeModule() {
    if (!_opentypeModulePromise) {
        _opentypeModulePromise = import(OPENTYPE_URL);
    }
    return _opentypeModulePromise;
}

// フォントファミリー名 → ArrayBuffer（ttf）。py/ccc.py 側でwoff2→ttf変換の代わりに
// 非ブラウザ的User-AgentでGoogle Fonts CSS2 APIをリクエストし、直接ttfを取得している。
async function fetchGoogleFontBinary(familyName, { weight = 400, italic = false } = {}) {
    const params = new URLSearchParams({
        family: familyName,
        weight: String(weight),
        italic: italic ? '1' : '0',
    });
    const res = await fetch(`/api/ccc/google-font-ttf?${params.toString()}`);
    if (!res.ok) {
        let msg = `Google Fontsの取得に失敗しました (HTTP ${res.status})`;
        try {
            const data = await res.json();
            if (data && data.message) msg = data.message;
        } catch { /* JSON以外のエラーレスポンスは無視してデフォルトメッセージを使う */ }
        throw new Error(msg);
    }
    const buffer = await res.arrayBuffer();
    const magic = new Uint8Array(buffer.slice(0, 4));
    // 'wOF2' — サーバー側のUser-Agent切替が効かずwoff2が返ってきたケース。
    // opentype.jsはwoff2を直接パースできないため、ここで明示的にエラーにする。
    if (magic[0] === 0x77 && magic[1] === 0x4F && magic[2] === 0x46 && magic[3] === 0x32) {
        throw new Error(`Google Fonts "${familyName}" がwoff2形式で返されたため3D化できません`);
    }
    return buffer;
}

// フォントファミリー名 → ArrayBuffer（ttf/otf）。Local Font Access API未対応環境ではnullを返す。
async function fetchSystemFontBinary(familyName, { preferBold = false, preferItalic = false } = {}) {
    if (typeof window.queryLocalFonts !== 'function') return null;

    let allFonts;
    try {
        allFonts = await window.queryLocalFonts();
    } catch (e) {
        console.warn('[text3d] システムフォントの取得に失敗しました:', e);
        return null;
    }

    const matched = allFonts.filter(f => f.family === familyName);
    if (matched.length === 0) return null;

    // 複数バリエーション（Regular/Bold/Italic等）から、太さ・斜体の希望に最も近いものを選ぶ
    const scored = matched.map(f => {
        const style = (f.style || '').toLowerCase();
        const isBold = style.includes('bold');
        const isItalic = style.includes('italic') || style.includes('oblique');
        let score = 0;
        if (isBold === !!preferBold) score += 1;
        if (isItalic === !!preferItalic) score += 1;
        return { f, score };
    });
    scored.sort((a, b) => b.score - a.score);

    const blob = await scored[0].f.blob();
    return await blob.arrayBuffer();
}

// TrueType Collection (.ttc/.ttcファイルの署名'ttcf') から1書体だけを抜き出し、
// opentype.js がパース可能な単体sfntバイナリへ再構成する。
//
// 背景: Windowsの多くのCJKシステムフォント（游ゴシック/游明朝/メイリオ/MS ゴシック 等）は
// 複数書体を1ファイルにまとめた .ttc 形式で配布されており、opentype.js は
// 'true'/0x00010000/'OTTO'/'wOFF' の4シグネチャしか受け付けず ttcf を検出すると
// "Unsupported OpenType signature ttcf" で例外を投げる（実機で頻発を確認）。
// TTCヘッダ自体は各書体のテーブルディレクトリへのオフセットを持つだけで、各テーブルの
// 実データはファイル内の絶対オフセットで指されているため、該当書体のディレクトリと
// テーブル実体をコピーして「オフセット0起点」に詰め直せば、単体フォントとして正しく
// パースできる（TTC仕様 ISO/IEC 14496-22 準拠）。
//
// 制限: 複数書体（Regular/Bold等）が入っている場合、先頭(faceIndex=0)の書体を常に採用する。
// 太字/イタリック指定に応じて最適な書体を選ぶには各書体のname/OS2テーブルを走査する必要があり、
// 3Dテキストという用途（1書体あれば足りる）に対しては過剰と判断し実装していない。
function _extractFaceFromTTC(buffer, faceIndex = 0) {
    const src = new DataView(buffer);
    if (src.getUint32(0) !== 0x74746366 /* 'ttcf' */) return buffer;

    const numFonts = src.getUint32(8);
    if (numFonts === 0) return buffer;
    if (faceIndex >= numFonts) faceIndex = 0;
    const dirOffset = src.getUint32(12 + faceIndex * 4);

    const sfntVersion = src.getUint32(dirOffset);
    const numTables = src.getUint16(dirOffset + 4);
    const searchRange = src.getUint16(dirOffset + 6);
    const entrySelector = src.getUint16(dirOffset + 8);
    const rangeShift = src.getUint16(dirOffset + 10);

    const entries = [];
    let p = dirOffset + 12;
    for (let i = 0; i < numTables; i++) {
        entries.push({
            tag: new Uint8Array(buffer, p, 4),
            checksum: src.getUint32(p + 4),
            offset: src.getUint32(p + 8),
            length: src.getUint32(p + 12),
        });
        p += 16;
    }

    // 新バッファ内でのテーブル配置先オフセットを計算する（4バイト境界にパディング）
    let cursor = 12 + numTables * 16;
    const newOffsets = entries.map((e) => {
        const off = cursor;
        cursor += Math.ceil(e.length / 4) * 4;
        return off;
    });

    const out = new ArrayBuffer(cursor);
    const outView = new DataView(out);
    const outBytes = new Uint8Array(out);

    outView.setUint32(0, sfntVersion);
    outView.setUint16(4, numTables);
    outView.setUint16(6, searchRange);
    outView.setUint16(8, entrySelector);
    outView.setUint16(10, rangeShift);

    entries.forEach((e, i) => {
        const dirPos = 12 + i * 16;
        outBytes.set(e.tag, dirPos);
        outView.setUint32(dirPos + 4, e.checksum);
        outView.setUint32(dirPos + 8, newOffsets[i]);
        outView.setUint32(dirPos + 12, e.length);
        outBytes.set(new Uint8Array(buffer, e.offset, e.length), newOffsets[i]);
    });

    return out;
}

async function _decodeToOpentypeFont(buffer) {
    const opentype = await _loadOpentypeModule();
    return opentype.parse(_extractFaceFromTTC(buffer));
}

// フォントファミリー名 + ソース('google'|'system') → opentype.Font（キャッシュ付き）
const _fontCache = new Map();

async function loadFontForText3d(familyName, source, opts = {}) {
    const weight = opts.weight ?? 400;
    const italic = !!opts.italic;
    const key = `${source}:${familyName}:${weight}:${italic}`;

    if (_fontCache.has(key)) return _fontCache.get(key);

    const promise = (async () => {
        let buffer;
        if (source === 'system') {
            buffer = await fetchSystemFontBinary(familyName, { preferBold: weight >= 700, preferItalic: italic });
            if (!buffer) throw new Error(`システムフォント "${familyName}" が見つかりません`);
        } else {
            buffer = await fetchGoogleFontBinary(familyName, { weight, italic });
        }
        return _decodeToOpentypeFont(buffer);
    })();

    _fontCache.set(key, promise);
    // 失敗時はキャッシュに残さず、次回呼び出しで再試行できるようにする
    promise.catch(() => { _fontCache.delete(key); });
    return promise;
}

function clearFontCache() {
    _fontCache.clear();
}

export { fetchGoogleFontBinary, fetchSystemFontBinary, loadFontForText3d, clearFontCache };
