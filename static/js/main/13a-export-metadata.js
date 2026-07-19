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

/** PNGバイト列のIHDR直後にiTXtメタデータチャンクを挿入する */
function _pngEmbedMeta(bytes, meta) {
    const PNG_SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    if (bytes.length < 33 || !PNG_SIG.every((b, i) => bytes[i] === b)) return null;

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const firstChunkLen = view.getUint32(8);
    const insertPos = 8 + 8 + firstChunkLen + 4; // 署名 + IHDRチャンク全体の直後

    const entries = [];
    if (meta.title) entries.push(['Title', meta.title]);
    if (meta.author) entries.push(['Author', meta.author]);
    if (meta.subject) entries.push(['Description', meta.subject]);
    if (meta.keywords) entries.push(['Keywords', meta.keywords]);
    entries.push(['Software', _APP_CREATOR_NAME]);

    const chunks = entries.map(([keyword, text]) => _pngBuildItxtChunk(keyword, text));
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
// JPEG: APP1セグメント（XMP）
// ------------------------------

/** JPEGバイト列の先頭APPnセグメント群の直後にXMP APP1セグメントを挿入する */
function _jpegEmbedMeta(bytes, meta) {
    if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;

    // SOI直後から既存のAPPnセグメント(FFE0-FFEF)を読み飛ばし、挿入位置を決める
    let pos = 2;
    while (pos + 4 <= bytes.length && bytes[pos] === 0xFF && bytes[pos + 1] >= 0xE0 && bytes[pos + 1] <= 0xEF) {
        pos += 2 + ((bytes[pos + 2] << 8) | bytes[pos + 3]);
    }

    const encoder = new TextEncoder();
    const nsBytes = encoder.encode('http://ns.adobe.com/xap/1.0/');
    const xmpBytes = encoder.encode(_buildXmpPacket(meta));
    const payloadLen = nsBytes.length + 1 + xmpBytes.length;
    const segLen = payloadLen + 2;
    if (segLen > 0xFFFF) return null; // APP1のサイズ上限超過（実運用では起こらない想定）

    const segment = new Uint8Array(2 + segLen);
    segment[0] = 0xFF;
    segment[1] = 0xE1;
    segment[2] = segLen >> 8;
    segment[3] = segLen & 0xFF;
    segment.set(nsBytes, 4);
    // NULターミネータは初期値0のまま
    segment.set(xmpBytes, 4 + nsBytes.length + 1);

    const out = new Uint8Array(bytes.length + segment.length);
    out.set(bytes.subarray(0, pos), 0);
    out.set(segment, pos);
    out.set(bytes.subarray(pos), pos + segment.length);
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
 * WebPバイト列にXMPチャンクを追加する。
 * canvas出力の単純な(VP8/VP8Lのみの)WebPにはVP8Xヘッダが無いため、
 * XMPフラグ付きVP8Xチャンクを先頭に新設してコンテナを再構築する。
 */
function _webpEmbedMeta(bytes, meta, width, height) {
    const fourcc = (pos) => String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
    if (bytes.length < 20 || fourcc(0) !== 'RIFF' || fourcc(8) !== 'WEBP') return null;

    const xmpBytes = new TextEncoder().encode(_buildXmpPacket(meta));
    const xmpChunk = _webpBuildChunk('XMP ', xmpBytes);
    const XMP_FLAG = 0x04;
    const ALPHA_FLAG = 0x10;
    let out;

    if (fourcc(12) === 'VP8X') {
        // 既存のVP8XにXMPフラグを立てて末尾にXMPチャンクを追加
        out = new Uint8Array(bytes.length + xmpChunk.length);
        out.set(bytes, 0);
        out[20] |= XMP_FLAG;
        out.set(xmpChunk, bytes.length);
    } else {
        // VP8Xヘッダを新設（可逆VP8Lのアルファビットを検出してフラグへ反映）
        let flags = XMP_FLAG;
        if (fourcc(12) === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2F) {
            const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
            if ((bits >>> 28) & 1) flags |= ALPHA_FLAG;
        }
        const vp8xData = new Uint8Array(10);
        vp8xData[0] = flags;
        const w = Math.max(1, width) - 1;
        const h = Math.max(1, height) - 1;
        vp8xData[4] = w & 0xFF; vp8xData[5] = (w >> 8) & 0xFF; vp8xData[6] = (w >> 16) & 0xFF;
        vp8xData[7] = h & 0xFF; vp8xData[8] = (h >> 8) & 0xFF; vp8xData[9] = (h >> 16) & 0xFF;
        const vp8xChunk = _webpBuildChunk('VP8X', vp8xData);

        const body = bytes.subarray(12); // 既存チャンク列（VP8/VP8L...）
        out = new Uint8Array(12 + vp8xChunk.length + body.length + xmpChunk.length);
        out.set(bytes.subarray(0, 12), 0);
        out.set(vp8xChunk, 12);
        out.set(body, 12 + vp8xChunk.length);
        out.set(xmpChunk, 12 + vp8xChunk.length + body.length);
    }

    new DataView(out.buffer).setUint32(4, out.length - 8, true); // RIFF全体サイズを更新
    return out;
}

// ------------------------------
// エントリポイント
// ------------------------------

/**
 * 画像Blobへ出力メタ情報を埋め込んで新しいBlobを返す。
 * メタ情報が全て空欄の場合や埋め込みに失敗した場合は元のBlobをそのまま返す。
 * @param {Blob} blob - canvas.toBlob() が生成した画像
 * @param {string} mimeType - image/png | image/jpeg | image/webp
 * @param {number} width  - 画像幅(px)（WebPのVP8Xヘッダ生成に使用）
 * @param {number} height - 画像高さ(px)
 */
async function _embedImageMetadata(blob, mimeType, width, height) {
    try {
        const meta = _getExportMetaValues();
        if (!meta.title && !meta.author && !meta.subject && !meta.keywords) return blob;

        const bytes = new Uint8Array(await blob.arrayBuffer());
        let out = null;
        if (mimeType === 'image/png') out = _pngEmbedMeta(bytes, meta);
        else if (mimeType === 'image/jpeg') out = _jpegEmbedMeta(bytes, meta);
        else if (mimeType === 'image/webp') out = _webpEmbedMeta(bytes, meta, width, height);
        if (!out) return blob;
        return new Blob([out], { type: mimeType });
    } catch (e) {
        console.warn('[ExportMeta] メタデータ埋め込みに失敗したため元画像を出力します:', e);
        return blob;
    }
}
