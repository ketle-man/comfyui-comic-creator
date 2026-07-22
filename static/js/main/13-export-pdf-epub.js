// ============================================================
// main.js 分割ファイル (14/24): PDF出力+EPUB出力+ファイル保存共通ヘルパー
// 元 main.js の行 12575-12795 に相当
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: _encodePdfInfoText,_saveBlob,exportToEpub,exportToPdf
// ============================================================

// ==============================
// PDF出力
// ==============================

/**
 * PDFの文書情報（Info辞書）用に文字列をエンコードする。
 * jsPDF 2.5.1 の putInfo は値をリテラル文字列としてそのまま書き出すため、
 * 非Latin-1文字（日本語等）はBOM付きUTF-16BEのバイト列（1文字=1バイトのJS文字列）へ
 * 変換して渡さないとビューアで文字化けする。
 */
function _encodePdfInfoText(str) {
    if (![...str].some(c => c.codePointAt(0) > 255)) return str;
    let bytes = '\xFE\xFF';
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        bytes += String.fromCharCode(code >> 8) + String.fromCharCode(code & 0xFF);
    }
    return bytes;
}

/**
 * 指定ページ群を1枚ずつ描画してPDFに書き出す
 * @param {Array} pages - ページオブジェクトの配列（name を持つ）
 * @param {number} targetWidth  - 出力幅(px)
 * @param {number} targetHeight - 出力高さ(px)
 */
async function exportToPdf(pages, targetWidth, targetHeight) {
    if (typeof window.jspdf === 'undefined') {
        alert(t('page.msgJspdfLoadFailed'));
        return;
    }
    const { jsPDF } = window.jspdf;

    const fileName = pages.length === 1
        ? `${pages[0].name}.pdf`
        : `export_${pages.length}pages.pdf`;

    // 保存先ダイアログはクリック直後（このあとの複数ページ描画・フォント埋め込み等の
    // 重い非同期処理より前）に開いてハンドルを確保しておく。生成後に呼ぶとユーザー操作の
    // 有効期限が切れ「Must be handling a user gesture」で失敗することがあるため
    let saveTarget;
    try {
        saveTarget = await _pickSaveTarget(fileName, 'application/pdf', '.pdf', t('page.pdfFileDesc'));
    } catch (err) {
        console.error('[exportToPdf] save target error:', err);
        alert(t('page.msgSaveFailed', err.message));
        return;
    }
    if (saveTarget === null) return; // キャンセル

    // px → mm 変換。解像度指定中はそのdpiで換算し、PDFの物理サイズが
    // 作品サイズ(mm)と一致するようにする。手動入力時は従来どおり96dpi基準
    const dpi = _getExportDpiValue() || 96;
    const PX_TO_MM = 25.4 / dpi;
    const pageWidthMm  = targetWidth  * PX_TO_MM;
    const pageHeightMm = targetHeight * PX_TO_MM;

    const pdf = new jsPDF({
        orientation: pageWidthMm >= pageHeightMm ? 'landscape' : 'portrait',
        unit: 'mm',
        format: [pageWidthMm, pageHeightMm],
    });

    // 出力サブタブのメタ情報入力を文書プロパティへ反映（空欄の項目は設定しない）
    const meta = _getExportMetaValues();
    const props = { creator: _APP_CREATOR_NAME };
    ['title', 'author', 'subject', 'keywords'].forEach(key => {
        if (meta[key]) props[key] = _encodePdfInfoText(meta[key]);
    });
    pdf.setProperties(props);

    const canvas = document.getElementById('render-canvas');
    const ctx = canvas.getContext('2d');

    for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const pageRecord = await dbGet('pages', page.name);
        if (!pageRecord || !pageRecord.svgContent) {
            console.warn(`[PDF] ページデータなし: ${page.name}`);
            continue;
        }

        canvas.width  = targetWidth;
        canvas.height = targetHeight;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const mergedSvg = buildMergedSvg(pageRecord);
        const rawSvg    = mergedSvg || pageRecord.svgContent;
        const embedded  = await embedFontsInSvg(rawSvg);
        await drawSvgOnCanvas(ctx, embedded, targetWidth, targetHeight);

        const imgData = canvas.toDataURL('image/png');
        if (i > 0) pdf.addPage([pageWidthMm, pageHeightMm]);
        pdf.addImage(imgData, 'PNG', 0, 0, pageWidthMm, pageHeightMm);
    }

    await _saveBlob(new Blob([pdf.output('arraybuffer')], { type: 'application/pdf' }), fileName, 'application/pdf', '.pdf', t('page.pdfFileDesc'), saveTarget);
}

// ==============================
// EPUB出力
// ==============================

/**
 * 指定ページ群をPNG画像化してEPUB (Fixed Layout) に書き出す
 * @param {Array} pages
 * @param {number} targetWidth
 * @param {number} targetHeight
 */
async function exportToEpub(pages, targetWidth, targetHeight) {
    if (typeof JSZip === 'undefined') {
        alert(t('page.msgJszipLoadFailed'));
        return;
    }

    const fileName = pages.length === 1
        ? `${pages[0].name}.epub`
        : `export_${pages.length}pages.epub`;

    // 保存先ダイアログはクリック直後（このあとの複数ページ描画等の重い非同期処理より前）に
    // 開いてハンドルを確保しておく（exportToPdfと同じ理由。詳細はそちらのコメント参照）
    let saveTarget;
    try {
        saveTarget = await _pickSaveTarget(fileName, 'application/epub+zip', '.epub', t('page.epubFileDesc'));
    } catch (err) {
        console.error('[exportToEpub] save target error:', err);
        alert(t('page.msgSaveFailed', err.message));
        return;
    }
    if (saveTarget === null) return; // キャンセル

    const zip = new JSZip();
    const bookId = `comfyui-comic-${Date.now()}`;

    // 出力サブタブのメタ情報入力をEPUBメタデータへ反映（タイトル未入力時はページ名等で補完）
    const meta = _getExportMetaValues();
    const title = meta.title || (pages.length === 1 ? pages[0].name : 'ComfyUI Comic');

    // mimetype（先頭ファイル・非圧縮必須）
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

    // META-INF/container.xml
    zip.folder('META-INF').file('container.xml',
`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:schemas:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

    const oebps = zip.folder('OEBPS');
    const images = oebps.folder('images');

    const canvas = document.getElementById('render-canvas');
    const ctx = canvas.getContext('2d');
    const spineItems = [];
    const manifestImageItems = [];

    for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const pageRecord = await dbGet('pages', page.name);
        if (!pageRecord || !pageRecord.svgContent) {
            console.warn(`[EPUB] ページデータなし: ${page.name}`);
            continue;
        }

        canvas.width  = targetWidth;
        canvas.height = targetHeight;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const mergedSvg = buildMergedSvg(pageRecord);
        const rawSvg    = mergedSvg || pageRecord.svgContent;
        const embedded  = await embedFontsInSvg(rawSvg);
        await drawSvgOnCanvas(ctx, embedded, targetWidth, targetHeight);

        // PNG Blob → ArrayBuffer
        const pngBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const pngBuf  = await pngBlob.arrayBuffer();
        const imgId   = `img${String(i + 1).padStart(3, '0')}`;
        const imgFile = `images/${imgId}.png`;
        images.file(`${imgId}.png`, pngBuf);

        // XHTML ページ（Fixed Layout）
        const xhtmlId = `page${String(i + 1).padStart(3, '0')}`;
        oebps.file(`${xhtmlId}.xhtml`,
`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"
      xmlns:epub="http://www.idpf.org/2007/ops">
  <head>
    <meta charset="UTF-8"/>
    <meta name="viewport" content="width=${targetWidth}, height=${targetHeight}"/>
    <style>
      html, body { margin:0; padding:0; width:${targetWidth}px; height:${targetHeight}px; overflow:hidden; }
      img { width:100%; height:100%; }
    </style>
  </head>
  <body>
    <img src="${imgFile}" alt="${page.name}"/>
  </body>
</html>`);

        manifestImageItems.push(`    <item id="${imgId}" href="${imgFile}" media-type="image/png"/>`);
        spineItems.push({ xhtmlId, imgId });
    }

    // content.opf
    const manifestXhtmlItems = spineItems.map(({ xhtmlId }) =>
        `    <item id="${xhtmlId}" href="${xhtmlId}.xhtml" media-type="application/xhtml+xml" properties="svg"/>`
    ).join('\n');
    const spineRefs = spineItems.map(({ xhtmlId }) =>
        `    <itemref idref="${xhtmlId}"/>`
    ).join('\n');

    // メタ情報の任意項目（著者→dc:creator、件名→dc:description、キーワード→dc:subject）
    const optionalMetaLines = [];
    if (meta.author) optionalMetaLines.push(`    <dc:creator>${_xmlEscape(meta.author)}</dc:creator>`);
    if (meta.subject) optionalMetaLines.push(`    <dc:description>${_xmlEscape(meta.subject)}</dc:description>`);
    _splitMetaKeywords(meta.keywords).forEach(keyword => {
        optionalMetaLines.push(`    <dc:subject>${_xmlEscape(keyword)}</dc:subject>`);
    });

    oebps.file('content.opf',
`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${bookId}</dc:identifier>
    <dc:title>${_xmlEscape(title)}</dc:title>
${optionalMetaLines.length > 0 ? optionalMetaLines.join('\n') + '\n' : ''}    <dc:language>ja</dc:language>
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:spread">landscape</meta>
  </metadata>
  <manifest>
${manifestXhtmlItems}
${manifestImageItems.join('\n')}
  </manifest>
  <spine>
${spineRefs}
  </spine>
</package>`);

    const epubBlob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
    await _saveBlob(epubBlob, fileName, 'application/epub+zip', '.epub', t('page.epubFileDesc'), saveTarget);
}

// ==============================
// ファイル保存共通ヘルパー
// ==============================

// showSaveFilePicker() はクリック等のユーザー操作から間を置かず呼ばないと
// 「Must be handling a user gesture to show a file picker」で失敗する。PDF/EPUB出力は
// 保存前にページ描画・フォント埋め込み等の重い非同期処理を挟むため、そのまま生成後に
// 呼ぶとユーザー操作の有効期限が切れて失敗しうる。そこで、クリック直後（重い処理の前）に
// _pickSaveTarget() でダイアログを開いてハンドルだけ確保しておき、実際の書き込みは
// 生成が終わった後に _saveBlob() へそのハンドルを渡して行う。
// 戻り値: { handle } = 保存先ハンドル確保済み / { fallback: true } = File System Access API 非対応
//         / null = ユーザーがキャンセル
async function _pickSaveTarget(fileName, mimeType, ext, description) {
    if (!window.showSaveFilePicker) return { fallback: true };
    try {
        const handle = await window.showSaveFilePicker({
            suggestedName: fileName,
            types: [{ description, accept: { [mimeType]: [ext] } }],
        });
        return { handle };
    } catch (err) {
        if (err.name === 'AbortError') return null;
        throw err;
    }
}

/**
 * Blobをファイルとして保存する（File System Access API / <a>フォールバック）。
 * target に _pickSaveTarget() の戻り値を渡すと、確保済みのハンドルへ書き込むだけで済む
 * （生成に時間がかかっていてもユーザー操作の有効期限切れの影響を受けない）。
 * target省略時は従来どおりこの場でダイアログを開く（軽量な保存処理向け）。
 */
async function _saveBlob(blob, fileName, mimeType, ext, description, target) {
    try {
        if (target === undefined) target = await _pickSaveTarget(fileName, mimeType, ext, description);
        if (target === null) return; // キャンセル
        if (target.handle) {
            const writable = await target.handle.createWritable();
            await writable.write(blob);
            await writable.close();
            alert(t('page.msgSaved', fileName));
        } else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    } catch (err) {
        console.error('[_saveBlob] error:', err);
        alert(t('page.msgSaveFailed', err.message));
    }
}

