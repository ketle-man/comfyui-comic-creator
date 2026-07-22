// ============================================================
// main.js 分割ファイル (14b): 画像出力メタデータ埋め込み（PNG/JPEG/WebP）+ XMP生成
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: _APP_CREATOR_NAME,_buildXmpPacket,_embedImageMetadata,_xmlEscape
// ============================================================

// ==============================
// 画像出力メタデータ埋め込み
// ==============================

/** 出力メタデータのアプリ名（PDF Creator / XMP CreatorTool / PNG Software に使用） */
const _APP_CREATOR_NAME = 'ComfyUI Comic Creator';

function _xmlEscape(str) {
    return String(str)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}

/**
 * メタ情報からXMPパケット(UTF-8 XML文字列)を生成する。
 * JPEG(APP1)とWebP(XMPチャンク)で共用。dc:title/creator/description/subject へマップする。
 */
function _buildXmpPacket(meta) {
    const lines = [];
    lines.push(`   <xmp:CreatorTool>${_xmlEscape(_APP_CREATOR_NAME)}</xmp:CreatorTool>`);
    if (meta.title) {
        lines.push(`   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${_xmlEscape(meta.title)}</rdf:li></rdf:Alt></dc:title>`);
    }
    if (meta.author) {
        lines.push(`   <dc:creator><rdf:Seq><rdf:li>${_xmlEscape(meta.author)}</rdf:li></rdf:Seq></dc:creator>`);
    }
    if (meta.subject) {
        lines.push(`   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${_xmlEscape(meta.subject)}</rdf:li></rdf:Alt></dc:description>`);
    }
    const keywords = _splitMetaKeywords(meta.keywords);
    if (keywords.length > 0) {
        lines.push(`   <dc:subject><rdf:Bag>${keywords.map(k => `<rdf:li>${_xmlEscape(k)}</rdf:li>`).join('')}</rdf:Bag></dc:subject>`);
    }
    const bom = String.fromCharCode(0xFEFF);
    return `<?xpacket begin="${bom}" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
${lines.join('\n')}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/** キーワード欄をカンマ（半角・全角・読点）で分割する */
function _splitMetaKeywords(keywords) {
    return String(keywords || '').split(/[,，、]/).map(s => s.trim()).filter(Boolean);
}

// ------------------------------
// PNG: iTXtチャンク（UTF-8対応の標準テキストチャンク）
// ------------------------------

const _PNG_CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[n] = c >>> 0;
    }
    return table;
})();

function _pngCrc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
        crc = _PNG_CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

/** iTXtチャンク1個分のバイト列を生成する（keywordはASCII、textはUTF-8） */
function _pngBuildItxtChunk(keyword, text) {
    const encoder = new TextEncoder();
    const keywordBytes = encoder.encode(keyword);
    const textBytes = encoder.encode(text);
    // keyword \0 compressionFlag(0) compressionMethod(0) languageTag"" \0 translatedKeyword"" \0 text
    const data = new Uint8Array(keywordBytes.length + 5 + textBytes.length);
    data.set(keywordBytes, 0);
    // 区切りのNULとフラグ2バイトはUint8Arrayの初期値0のまま
    data.set(textBytes, keywordBytes.length + 5);

    const typeAndData = new Uint8Array(4 + data.length);
    typeAndData.set([0x69, 0x54, 0x58, 0x74], 0); // 'iTXt'
    typeAndData.set(data, 4);
    const crc = _pngCrc32(typeAndData);

    const chunk = new Uint8Array(8 + data.length + 4);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, data.length);
    chunk.set(typeAndData, 4);
    view.setUint32(8 + data.length, crc);
    return chunk;
}

/**
 * 解像度(dpi)からPNGの pHYs チャンク（画素密度）を生成する。
 * pHYsは「メートルあたりの画素数」を整数で持つため、dpi(インチあたり画素数)を
 * 1インチ=0.0254mから換算する。unit specifier=1（メートル単位）
 */
function _pngBuildPhysChunk(dpi) {
    const pxPerMeter = Math.round(dpi / 0.0254);
    const data = new Uint8Array(9);
    const view = new DataView(data.buffer);
    view.setUint32(0, pxPerMeter);
    view.setUint32(4, pxPerMeter);
    data[8] = 1; // unit specifier: 1 = meter

    const typeAndData = new Uint8Array(4 + data.length);
    typeAndData.set([0x70, 0x48, 0x59, 0x73], 0); // 'pHYs'
    typeAndData.set(data, 4);
    const crc = _pngCrc32(typeAndData);

    const chunk = new Uint8Array(8 + data.length + 4);
    const cview = new DataView(chunk.buffer);
    cview.setUint32(0, data.length);
    chunk.set(typeAndData, 4);
    cview.setUint32(8 + data.length, crc);
    return chunk;
}

/**
 * PNGバイト列のIHDR直後に pHYs（解像度）・iTXt（メタデータ）チャンクを挿入する。
 * @param {object|null} meta - タイトル等のテキストメタ情報。無ければiTXtは追加しない
 * @param {number|null} dpi - 解像度(dpi)。無ければpHYsは追加しない
 */
function _pngEmbedMeta(bytes, meta, dpi) {
    const PNG_SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    if (bytes.length < 33 || !PNG_SIG.every((b, i) => bytes[i] === b)) return null;

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const firstChunkLen = view.getUint32(8);
    const insertPos = 8 + 8 + firstChunkLen + 4; // 署名 + IHDRチャンク全体の直後

    const chunks = [];
    if (dpi) chunks.push(_pngBuildPhysChunk(dpi));
    if (meta) {
        const entries = [];
        if (meta.title) entries.push(['Title', meta.title]);
        if (meta.author) entries.push(['Author', meta.author]);
        if (meta.subject) entries.push(['Description', meta.subject]);
        if (meta.keywords) entries.push(['Keywords', meta.keywords]);
        entries.push(['Software', _APP_CREATOR_NAME]);
        entries.forEach(([keyword, text]) => chunks.push(_pngBuildItxtChunk(keyword, text)));
    }
    if (chunks.length === 0) return null;

    const totalChunkLen = chunks.reduce((sum, c) => sum + c.length, 0);
    const out = new Uint8Array(bytes.length + totalChunkLen);
    out.set(bytes.subarray(0, insertPos), 0);
    let pos = insertPos;
    for (const chunk of chunks) {
        out.set(chunk, pos);
        pos += chunk.length;
    }
    out.set(bytes.subarray(insertPos), pos);
    return out;
}

// ------------------------------
// JPEG: JFIF density（解像度）+ APP1セグメント（XMP）
// ------------------------------

/**
 * JPEGバイト列先頭のJFIF APP0セグメント内の density フィールドを dpi 値で上書きする（bytesを直接書き換える）。
 * canvas.toBlob('image/jpeg') は常に標準のJFIF APP0（density未設定=0,1x1）を出力するため、
 * 新規セグメント挿入ではなく既存フィールドの上書きで済む（セグメント長・オフセットは変化しない）。
 * @returns {boolean} 書き換えに成功したか
 */
function _jpegPatchJfifDensity(bytes, dpi) {
    // SOI(FFD8) + APP0(FFE0) + len(2) + "JFIF\0"(5) + version(2) + units(1) + Xdensity(2) + Ydensity(2)...
    if (bytes.length < 20 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return false;
    if (bytes[2] !== 0xFF || bytes[3] !== 0xE0) return false;
    const jfifId = String.fromCharCode(bytes[6], bytes[7], bytes[8], bytes[9]);
    if (jfifId !== 'JFIF' || bytes[10] !== 0x00) return false;
    const segLen = (bytes[4] << 8) | bytes[5];
    if (segLen < 14) return false; // density フィールドまで届かない

    bytes[13] = 1; // units: 1 = dots per inch
    bytes[14] = (dpi >> 8) & 0xFF; bytes[15] = dpi & 0xFF; // Xdensity
    bytes[16] = (dpi >> 8) & 0xFF; bytes[17] = dpi & 0xFF; // Ydensity
    return true;
}

/**
 * JPEGバイト列に解像度(JFIF density書き換え)とXMPメタデータ(APP1セグメント挿入)を埋め込む。
 * @param {object|null} meta - タイトル等のテキストメタ情報。無ければAPP1は追加しない
 * @param {number|null} dpi - 解像度(dpi)。無ければdensityは書き換えない
 */
function _jpegEmbedMeta(bytes, meta, dpi) {
    if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;

    const out0 = bytes.slice(); // 元のBlob由来配列は書き換えない
    const densityChanged = dpi ? _jpegPatchJfifDensity(out0, dpi) : false;

    if (!meta) return densityChanged ? out0 : null;

    // SOI直後から既存のAPPnセグメント(FFE0-FFEF)を読み飛ばし、挿入位置を決める
    let pos = 2;
    while (pos + 4 <= out0.length && out0[pos] === 0xFF && out0[pos + 1] >= 0xE0 && out0[pos + 1] <= 0xEF) {
        pos += 2 + ((out0[pos + 2] << 8) | out0[pos + 3]);
    }

    const encoder = new TextEncoder();
    const nsBytes = encoder.encode('http://ns.adobe.com/xap/1.0/');
    const xmpBytes = encoder.encode(_buildXmpPacket(meta));
    const payloadLen = nsBytes.length + 1 + xmpBytes.length;
    const segLen = payloadLen + 2;
    if (segLen > 0xFFFF) return densityChanged ? out0 : null; // APP1のサイズ上限超過（実運用では起こらない想定）

    const segment = new Uint8Array(2 + segLen);
    segment[0] = 0xFF;
    segment[1] = 0xE1;
    segment[2] = segLen >> 8;
    segment[3] = segLen & 0xFF;
    segment.set(nsBytes, 4);
    // NULターミネータは初期値0のまま
    segment.set(xmpBytes, 4 + nsBytes.length + 1);

    const out = new Uint8Array(out0.length + segment.length);
    out.set(out0.subarray(0, pos), 0);
    out.set(segment, pos);
    out.set(out0.subarray(pos), pos + segment.length);
    return out;
}

// ------------------------------
// WebP: VP8X + XMPチャンク
// ------------------------------

/** RIFFチャンク1個分のバイト列を生成する（奇数長はパディング） */
function _webpBuildChunk(fourcc, data) {
    const padded = data.length % 2 === 1;
    const chunk = new Uint8Array(8 + data.length + (padded ? 1 : 0));
    for (let i = 0; i < 4; i++) chunk[i] = fourcc.charCodeAt(i);
    new DataView(chunk.buffer).setUint32(4, data.length, true);
    chunk.set(data, 8);
    return chunk;
}

/**
 * 解像度(dpi)からWebPの EXIF チャンク用ミニマムTIFF blobを生成する
 * （XResolution/YResolution/ResolutionUnitの3タグのみを持つIFD0、リトルエンディアン）。
 * WebPのEXIFチャンクはJPEGのAPP1と異なり "Exif\0\0" プレフィックス無しでTIFF本体から始まる。
 */
function _webpBuildExifTiff(dpi) {
    const buf = new Uint8Array(66);
    const view = new DataView(buf.buffer);
    // TIFFヘッダ（リトルエンディアン、IFD0はオフセット8から）
    buf[0] = 0x49; buf[1] = 0x49; // 'II'
    view.setUint16(2, 42, true);
    view.setUint32(4, 8, true);

    // IFD0: エントリ3つ
    view.setUint16(8, 3, true);
    // XResolution (tag 0x011A, RATIONAL, count 1, 値はoffset 50)
    view.setUint16(10, 0x011A, true);
    view.setUint16(12, 5, true);
    view.setUint32(14, 1, true);
    view.setUint32(18, 50, true);
    // YResolution (tag 0x011B, RATIONAL, count 1, 値はoffset 58)
    view.setUint16(22, 0x011B, true);
    view.setUint16(24, 5, true);
    view.setUint32(26, 1, true);
    view.setUint32(30, 58, true);
    // ResolutionUnit (tag 0x0128, SHORT, count 1, 値=2=インチ)
    view.setUint16(34, 0x0128, true);
    view.setUint16(36, 3, true);
    view.setUint32(38, 1, true);
    view.setUint16(42, 2, true);
    // 次のIFDオフセット = 0（終端）
    view.setUint32(46, 0, true);

    // RATIONAL値本体（分子dpi・分母1）
    view.setUint32(50, dpi, true);
    view.setUint32(54, 1, true);
    view.setUint32(58, dpi, true);
    view.setUint32(62, 1, true);

    return buf;
}

const _WEBP_XMP_FLAG  = 0x04;
const _WEBP_EXIF_FLAG = 0x08;
const _WEBP_ALPHA_FLAG = 0x10;

/**
 * WebPバイト列に解像度(EXIFチャンク)とXMPメタデータチャンクを追加する。
 * canvas出力の単純な(VP8/VP8Lのみの)WebPにはVP8Xヘッダが無いため、
 * 対応フラグ付きVP8Xチャンクを先頭に新設してコンテナを再構築する。
 * @param {object|null} meta - タイトル等のテキストメタ情報。無ければXMPは追加しない
 * @param {number|null} dpi - 解像度(dpi)。無ければEXIFは追加しない
 */
function _webpEmbedMeta(bytes, meta, dpi, width, height) {
    const fourcc = (pos) => String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
    if (bytes.length < 20 || fourcc(0) !== 'RIFF' || fourcc(8) !== 'WEBP') return null;

    const extraChunks = [];
    let flags = 0;
    if (dpi) {
        extraChunks.push(_webpBuildChunk('EXIF', _webpBuildExifTiff(dpi)));
        flags |= _WEBP_EXIF_FLAG;
    }
    if (meta) {
        const xmpBytes = new TextEncoder().encode(_buildXmpPacket(meta));
        extraChunks.push(_webpBuildChunk('XMP ', xmpBytes));
        flags |= _WEBP_XMP_FLAG;
    }
    if (extraChunks.length === 0) return null;
    const extraLen = extraChunks.reduce((sum, c) => sum + c.length, 0);
    const appendChunks = (target, pos) => {
        for (const c of extraChunks) { target.set(c, pos); pos += c.length; }
    };

    let out;
    if (fourcc(12) === 'VP8X') {
        // 既存のVP8Xにフラグを立てて末尾にEXIF/XMPチャンクを追加
        out = new Uint8Array(bytes.length + extraLen);
        out.set(bytes, 0);
        out[20] |= flags;
        appendChunks(out, bytes.length);
    } else {
        // VP8Xヘッダを新設（可逆VP8Lのアルファビットを検出してフラグへ反映）
        if (fourcc(12) === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2F) {
            const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
            if ((bits >>> 28) & 1) flags |= _WEBP_ALPHA_FLAG;
        }
        const vp8xData = new Uint8Array(10);
        vp8xData[0] = flags;
        const w = Math.max(1, width) - 1;
        const h = Math.max(1, height) - 1;
        vp8xData[4] = w & 0xFF; vp8xData[5] = (w >> 8) & 0xFF; vp8xData[6] = (w >> 16) & 0xFF;
        vp8xData[7] = h & 0xFF; vp8xData[8] = (h >> 8) & 0xFF; vp8xData[9] = (h >> 16) & 0xFF;
        const vp8xChunk = _webpBuildChunk('VP8X', vp8xData);

        const body = bytes.subarray(12); // 既存チャンク列（VP8/VP8L...）
        out = new Uint8Array(12 + vp8xChunk.length + body.length + extraLen);
        out.set(bytes.subarray(0, 12), 0);
        out.set(vp8xChunk, 12);
        out.set(body, 12 + vp8xChunk.length);
        appendChunks(out, 12 + vp8xChunk.length + body.length);
    }

    new DataView(out.buffer).setUint32(4, out.length - 8, true); // RIFF全体サイズを更新
    return out;
}

// ------------------------------
// エントリポイント
// ------------------------------

/**
 * 画像Blobへ出力メタ情報・解像度(dpi)を埋め込んで新しいBlobを返す。
 * テキストメタ情報が全て空欄でも解像度は常に埋め込む（PNG/JPEG/WebPで表示dpiが食い違わないようにするため）。
 * 「手動」選択時はPDF出力の物理サイズ換算と同じ既定値96をそのまま使う。
 * 埋め込みに失敗した場合は元のBlobをそのまま返す。
 * @param {Blob} blob - canvas.toBlob() が生成した画像
 * @param {string} mimeType - image/png | image/jpeg | image/webp
 * @param {number} width  - 画像幅(px)（WebPのVP8Xヘッダ生成に使用）
 * @param {number} height - 画像高さ(px)
 */
async function _embedImageMetadata(blob, mimeType, width, height) {
    try {
        const meta = _getExportMetaValues();
        const hasTextMeta = !!(meta.title || meta.author || meta.subject || meta.keywords);
        const dpi = _getExportDpiValue() || 96;
        if (!hasTextMeta && !dpi) return blob;

        const bytes = new Uint8Array(await blob.arrayBuffer());
        const metaArg = hasTextMeta ? meta : null;
        let out = null;
        if (mimeType === 'image/png') out = _pngEmbedMeta(bytes, metaArg, dpi);
        else if (mimeType === 'image/jpeg') out = _jpegEmbedMeta(bytes, metaArg, dpi);
        else if (mimeType === 'image/webp') out = _webpEmbedMeta(bytes, metaArg, dpi, width, height);
        if (!out) return blob;
        return new Blob([out], { type: mimeType });
    } catch (e) {
        console.warn('[ExportMeta] メタデータ埋め込みに失敗したため元画像を出力します:', e);
        return blob;
    }
}
