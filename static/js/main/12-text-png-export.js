// ============================================================
// main.js 分割ファイル (13/24): テキスト透過PNG変換
// 元 main.js の行 12003-12574 に相当
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: buildGoogleFontFaceCSS,buildSystemFontFaceCSS,convertTextToPng,drawSvgOnCanvas,embedFontsInSvg,handleExport
// ============================================================

// ============================================================
// テキスト → 透過PNG変換
// ============================================================

async function convertTextToPng() {
    const statusEl = document.getElementById('text-to-png-status');
    const setStatus = (msg) => { if (statusEl) statusEl.textContent = msg; };

    const textEl = state.selectedTextEl;
    if (!textEl) {
        alert(t('layout.msgSelectTextFirst'));
        return;
    }

    const panelSvgEl = getPanelLayerSvg();
    if (!panelSvgEl) { alert(t('layout.msgSvgNotAvailable')); return; }

    setStatus(t('layout.textToPngConverting'));

    try {
        // 1. テキスト要素のバウンディングボックスをSVGルート座標で取得
        let bbox;
        try { bbox = textEl.getBBox(); } catch(e) { throw new Error(t('layout.errGetBBoxFailed', e.message)); }
        if (bbox.width === 0 || bbox.height === 0) {
            throw new Error(t('layout.errTextSizeUnavailable'));
        }

        // textEl.getBBox() はテキストローカル座標系のbbox
        // transform属性を通じてSVGルート座標系（panelSvgContentと同じ空間）に変換する
        // getBBoxInSVGCoords: textのtransformをSVGルートへ適用する
        // panelSvgEl.createSVGPoint + matrixTransform を使う場合:
        //   textEl.getTransformToElement(panelSvgEl) = テキスト→SVGルート変換行列
        // getTransformToElement は非推奨のため、CTMの差分で求める
        //   textCTM × svgCTM^-1 = テキスト→SVGルート変換行列
        const textCTM = textEl.getCTM();
        const svgCTM  = panelSvgEl.getCTM();
        if (!textCTM || !svgCTM) throw new Error(t('layout.errCtmFailed'));
        const toSvgMatrix = svgCTM.inverse().multiply(textCTM);

        const corners = [
            { x: bbox.x,              y: bbox.y },
            { x: bbox.x + bbox.width, y: bbox.y },
            { x: bbox.x,              y: bbox.y + bbox.height },
            { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
        ].map(({ x, y }) => {
            const pt = panelSvgEl.createSVGPoint();
            pt.x = x; pt.y = y;
            return pt.matrixTransform(toSvgMatrix);
        });

        const xs = corners.map(p => p.x);
        const ys = corners.map(p => p.y);
        const svgMinX = Math.min(...xs);
        const svgMinY = Math.min(...ys);
        const svgW    = Math.max(...xs) - svgMinX;
        const svgH    = Math.max(...ys) - svgMinY;
        console.log('[textToPng] bbox:', bbox, 'svgCoords:', {svgMinX, svgMinY, svgW, svgH});

        // 2. テキスト要素だけを含む最小SVGを生成
        // SVG全体をcloneしてtextEl以外を非表示にした形で描画する
        // （座標系を完全に一致させるため、panelSvgEl丸ごとを使用する）
        // 袋文字・影のスタイルフィルタと線はgetBBoxに含まれないため、その分を余白に加算する
        let stylePad = parseFloat(textEl.getAttribute('stroke-width')) || 0;
        const styleFilterId = textEl.dataset.styleFilterId;
        const styleFilterEl = styleFilterId ? panelSvgEl.querySelector(`filter[id="${styleFilterId}"]`) : null;
        if (styleFilterEl) {
            stylePad += parseFloat(styleFilterEl.querySelector('feMorphology')?.getAttribute('radius')) || 0;
            const drop = styleFilterEl.querySelector('feDropShadow');
            if (drop) {
                stylePad += (parseFloat(drop.getAttribute('stdDeviation')) || 0) * 3
                    + Math.max(Math.abs(parseFloat(drop.getAttribute('dx')) || 0), Math.abs(parseFloat(drop.getAttribute('dy')) || 0));
            }
        }
        const PADDING = 20 + stylePad; // SVG座標系での余白（A4スケール: 21000×29700）
        const vbX = svgMinX - PADDING;
        const vbY = svgMinY - PADDING;
        const vbW = svgW + PADDING * 2;
        const vbH = svgH + PADDING * 2;
        console.log('[textToPng] vb:', {vbX, vbY, vbW, vbH});

        const serializer = new XMLSerializer();
        // テキスト要素とdefsのみを含む最小SVGを構築する
        // （panelSvgElのcloneを使うとテンプレートpolygon/clipPathで描画が隠れるため、
        //  テキスト要素単体をSVGルート座標系のviewBoxに配置する）
        const textId2 = textEl.id;

        // テキスト要素のクローン（transformを含む）
        const textClone = textEl.cloneNode(true);
        // defsのうちフォント関連のみ（clipPathは不要）を取り込む
        const origDefs = panelSvgEl.querySelector('defs');
        let defsStr = '';
        if (origDefs) {
            const defsClone = origDefs.cloneNode(true);
            // clipPath要素は除去（テキスト単体描画では不要でclip誤適用を防ぐ）
            defsClone.querySelectorAll('clipPath').forEach(el => el.remove());
            if (defsClone.children.length > 0) {
                defsStr = serializer.serializeToString(defsClone);
            }
        }

        // textElのtransformはSVGルート座標系を基準にしているのでviewBoxと一致する
        const textStr = serializer.serializeToString(textClone);
        const minSvg = [
            `<svg xmlns="http://www.w3.org/2000/svg"`,
            ` viewBox="${vbX} ${vbY} ${vbW} ${vbH}"`,
            ` width="${vbW}" height="${vbH}">`,
            defsStr,
            textStr,
            `</svg>`,
        ].join('');

        // 3. フォント埋め込み → Canvas描画（透過）→ PNG
        //    Canvas解像度: SVG座標系の vbW/vbH はA4換算で数千単位になるため
        //    適切なピクセル解像度にスケールダウンして描画する（最大4096px）
        const embeddedSvg = await embedFontsInSvg(minSvg);
        const MAX_PX = 4096;
        const pxScale = Math.min(1, MAX_PX / Math.max(vbW, vbH));
        const canvasW = Math.max(1, Math.ceil(vbW * pxScale));
        const canvasH = Math.max(1, Math.ceil(vbH * pxScale));
        const canvas  = document.createElement('canvas');
        canvas.width  = canvasW;
        canvas.height = canvasH;
        await drawSvgOnCanvas(canvas.getContext('2d'), embeddedSvg, canvasW, canvasH);
        const dataUrl = canvas.toDataURL('image/png');

        // 4. テキストIDと所属パネルIDを記録してからDOM削除
        const panelId = textEl.closest('g[data-clip-panel]')?.getAttribute('data-clip-panel')
            || (state.selectedOverlay ? '__overlay__' : state.selectedPanelId)
            || 'panel-0';
        const textId = textEl.id;

        textEl.remove();
        state.selectedTextEl = null;
        clearTextHandles(panelSvgEl);

        // 5. 現在のpanelSvgContentをパースして画像要素を直接追加し保存
        const ns = 'http://www.w3.org/2000/svg';
        const isOverlay = state.selectedOverlay || panelId === '__overlay__';

        // 保存済みSVG文字列を取得（DOM再シリアライズはUI要素が混入するため避ける）
        const svgSrcStr = (() => {
            if (isOverlay) return state.activePage.overlaySvgContent || '';
            const panel = state.activePage.panels.find(p => p.id === panelId);
            return panel?.panelSvgContent || '';
        })();

        const parser = new DOMParser();
        let pDoc = svgSrcStr
            ? parser.parseFromString(svgSrcStr, 'image/svg+xml')
            : (() => {
                const d = document.implementation.createDocument(ns, 'svg', null);
                d.documentElement.setAttribute('xmlns', ns);
                return d;
            })();
        const pSvg = pDoc.querySelector('svg');
        if (!pSvg) throw new Error(t('layout.errPanelSvgParseFailed'));

        // テキスト要素を保存済みSVGからも削除
        if (textId) {
            const old = pSvg.querySelector(`[id="${CSS.escape(textId)}"]`);
            if (old) old.remove();
        }

        // image要素を追加するコンテナg（clipPathグループ）を取得/作成
        let contentG;
        if (isOverlay) {
            contentG = pSvg.querySelector('g[data-overlay-layer]');
            if (!contentG) {
                contentG = pDoc.createElementNS(ns, 'g');
                contentG.setAttribute('data-overlay-layer', 'true');
                pSvg.appendChild(contentG);
            }
        } else {
            contentG = pSvg.querySelector(`g[data-clip-panel="${panelId}"]`);
            if (!contentG) {
                contentG = pDoc.createElementNS(ns, 'g');
                contentG.setAttribute('data-clip-panel', panelId);
                contentG.setAttribute('clip-path', `url(#panel-clip-${panelId})`);
                pSvg.appendChild(contentG);
            }
        }

        // image要素を生成（元テキストと同じ位置・サイズ）
        // x/y/width/height はSVG座標系（vbX/vbY/vbW/vbH）で設定する
        // canvasW/canvasH はピクセル解像度なのでSVG配置には使わない
        const imgEl = pDoc.createElementNS(ns, 'image');
        imgEl.setAttribute('href', dataUrl);
        imgEl.setAttribute('x', vbX);
        imgEl.setAttribute('y', vbY);
        imgEl.setAttribute('width', vbW);
        imgEl.setAttribute('height', vbH);
        imgEl.setAttribute('class', 'inserted-image');
        imgEl.setAttribute('id', 'img-' + Date.now());
        imgEl.setAttribute('data-angle', '0');
        if (!isOverlay) imgEl.setAttribute('data-panel-id', panelId);
        contentG.appendChild(imgEl);

        // シリアライズして保存
        let newSvgStr = serializer.serializeToString(pSvg);
        if (!newSvgStr.includes('xmlns="http://www.w3.org/2000/svg"')) {
            newSvgStr = newSvgStr.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
        }

        let updatedRecord;
        if (isOverlay) {
            updatedRecord = { ...state.activePage, overlaySvgContent: newSvgStr };
        } else {
            const updatedPanels = state.activePage.panels.map(p =>
                p.id === panelId ? { ...p, panelSvgContent: newSvgStr } : p
            );
            updatedRecord = { ...state.activePage, panels: updatedPanels };
        }
        await dbPut('pages', updatedRecord);
        state.activePage = updatedRecord;

        await renderLayoutTab();

        setStatus(t('common.done'));
        setTimeout(() => setStatus(''), 2500);

    } catch (err) {
        console.error('[textToPng]', err);
        setStatus(t('common.errorPrefix', err.message));
        alert(t('layout.msgConvertFailed', err.message));
    }
}

// Google Fontsの@font-face CSS（base64埋め込み）を生成する
// CSSをfetchしてフォントURL取得 → フォントデータをbase64化
async function buildGoogleFontFaceCSS(familyNames) {
    if (familyNames.length === 0) return '';
    // Google Fonts APIのURLを構築
    const query = familyNames.map(f => `family=${encodeURIComponent(f)}`).join('&');
    const cssUrl = `https://fonts.googleapis.com/css2?${query}&display=swap`;

    let cssText;
    try {
        const res = await fetch(cssUrl);
        if (!res.ok) throw new Error(`Google Fonts CSS取得失敗: ${res.status}`);
        cssText = await res.text();
    } catch (e) {
        console.warn('Google Fonts CSSの取得に失敗しました:', e);
        return '';
    }

    // CSSからフォントURL(woff2/woffなど)を収集してbase64に置き換える
    const fontUrlRegex = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g;
    const fetchPromises = [];
    const urlMap = new Map();
    let match;
    while ((match = fontUrlRegex.exec(cssText)) !== null) {
        const url = match[1];
        if (!urlMap.has(url)) {
            urlMap.set(url, null);
            fetchPromises.push(
                fetch(url)
                    .then(r => r.arrayBuffer())
                    .then(buf => { urlMap.set(url, arrayBufferToBase64(buf)); })
                    .catch(() => { /* フォントファイル取得失敗は無視 */ })
            );
        }
    }
    await Promise.all(fetchPromises);

    // URLをbase64 data URIに置き換える
    let embeddedCss = cssText.replace(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g, (_, url) => {
        const b64 = urlMap.get(url);
        if (!b64) return `url(${url})`;
        return `url(data:font/woff2;base64,${b64})`;
    });

    return embeddedCss;
}

// システムフォント（Local Font Access API）の@font-face CSSを生成する
async function buildSystemFontFaceCSS(familyNames) {
    if (familyNames.length === 0) return '';
    if (!window.queryLocalFonts) return '';

    let allFonts;
    try {
        allFonts = await window.queryLocalFonts();
    } catch (e) {
        console.warn('システムフォントの取得に失敗:', e);
        return '';
    }

    const cssParts = [];
    for (const family of familyNames) {
        // 対象ファミリーのフォントデータを収集（Regular/Normalを優先）
        const matched = allFonts.filter(f => f.family === family);
        if (matched.length === 0) continue;

        for (const fontData of matched) {
            try {
                const blob = await fontData.blob();
                const buf = await blob.arrayBuffer();
                const b64 = arrayBufferToBase64(buf);
                const mime = blob.type || 'font/ttf';
                // style/weight をメタデータから取得（なければ normal/400）
                const style = fontData.style?.toLowerCase().includes('italic') ? 'italic' : 'normal';
                const weight = fontData.style?.match(/\d+/)
                    ? parseInt(fontData.style.match(/\d+/)[0])
                    : (fontData.style?.toLowerCase().includes('bold') ? 700 : 400);
                cssParts.push(
                    `@font-face { font-family: '${family}'; font-style: ${style}; font-weight: ${weight};` +
                    ` src: url(data:${mime};base64,${b64}); }`
                );
            } catch (e) {
                console.warn(`フォント "${family}" のデータ取得失敗:`, e);
            }
        }
    }
    return cssParts.join('\n');
}

// SVGテキストに必要なフォントの@font-faceを埋め込んで返す
async function embedFontsInSvg(svgText) {
    const families = collectFontFamiliesFromSvg(svgText);
    if (families.length === 0) return svgText;

    const googleFamilies = families.filter(f => GOOGLE_FONT_FAMILIES.has(f));
    const systemFamilies = families.filter(f => !GOOGLE_FONT_FAMILIES.has(f));

    const [googleCss, systemCss] = await Promise.all([
        buildGoogleFontFaceCSS(googleFamilies),
        buildSystemFontFaceCSS(systemFamilies),
    ]);

    const fontCss = [googleCss, systemCss].filter(Boolean).join('\n');
    if (!fontCss) return svgText;

    // SVGのdefs内にstyle要素として挿入
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    if (!svgEl) return svgText;

    let defs = svgEl.querySelector('defs');
    if (!defs) {
        defs = doc.createElementNS('http://www.w3.org/2000/svg', 'defs');
        svgEl.insertBefore(defs, svgEl.firstChild);
    }

    const style = doc.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = fontCss;
    defs.insertBefore(style, defs.firstChild);

    const serializer = new XMLSerializer();
    let result = serializer.serializeToString(svgEl);
    if (!result.includes('xmlns="http://www.w3.org/2000/svg"')) {
        result = result.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    return result;
}

// SVGテキストをCanvasに描画するヘルパー
function drawSvgOnCanvas(ctx, svgText, targetWidth, targetHeight) {
    return new Promise((resolve, reject) => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgText, 'image/svg+xml');
        const svgEl = doc.querySelector('svg');
        if (!svgEl) { resolve(); return; }

        if (!svgEl.getAttribute('xmlns')) {
            svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        }
        svgEl.setAttribute('width', targetWidth);
        svgEl.setAttribute('height', targetHeight);

        const serializer = new XMLSerializer();
        const cleanedSvg = serializer.serializeToString(doc);
        const svgBlob = new Blob([cleanedSvg], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);

        const img = new Image();
        img.onload = () => {
            ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
            URL.revokeObjectURL(url);
            resolve();
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error(t('layout.errSvgRenderFailed')));
        };
        img.src = url;
    });
}

async function handleExport() {
    const format = document.getElementById('export-format').value;
    let targetWidth = parseInt(document.getElementById('export-width').value, 10) || 800;
    let targetHeight = parseInt(document.getElementById('export-height').value, 10) || 600;
    if (targetWidth > _EXPORT_MAX_SIZE) targetWidth = _EXPORT_MAX_SIZE;
    if (targetHeight > _EXPORT_MAX_SIZE) targetHeight = _EXPORT_MAX_SIZE;

    // ページ範囲を取得してターゲットページ配列を構築
    // 作品/グループフィルタ中はそのページ順、通常時は _pageOrder（未設定時は DB 逆順ソート）
    const allPagesRaw = await dbGetAll('pages');
    const pageMap = new Map(allPagesRaw.map(p => [p.name, p]));
    const orderedNames = _outputFilterGroup && _pageMgrGroups.data[_outputFilterGroup]
        ? _pageMgrGroups.data[_outputFilterGroup].filter(n => pageMap.has(n))
        : (_pageOrder.length > 0)
            ? _pageOrder.filter(n => pageMap.has(n))
            : [...allPagesRaw].sort((a, b) => b.name.localeCompare(a.name)).map(p => p.name);
    const orderedPages = orderedNames.map(n => pageMap.get(n));
    const startPage = Math.max(1, parseInt(document.getElementById('export-page-start')?.value, 10) || 1);
    const endPage   = Math.min(orderedPages.length, parseInt(document.getElementById('export-page-end')?.value, 10) || orderedPages.length);
    const targetPages = orderedPages.slice(startPage - 1, endPage);

    if (targetPages.length === 0) {
        alert(t('page.msgNoExportPages'));
        return;
    }

    // PDF / EPUB は複数ページ対応の専用ハンドラへ委譲
    if (format === 'pdf') {
        await exportToPdf(targetPages, targetWidth, targetHeight);
        return;
    }
    if (format === 'epub') {
        await exportToEpub(targetPages, targetWidth, targetHeight);
        return;
    }

    // 画像形式: targetPages を順番に出力

    // zip保存（全ページを1つのzipにまとめる。画像形式のみ）
    const exportZip = document.getElementById('export-zip')?.checked ?? false;
    if (exportZip && typeof JSZip === 'undefined') {
        alert(t('page.msgJszipLoadFailed'));
        return;
    }
    const zip = exportZip ? new JSZip() : null;

    // レイヤー別出力の選択
    const exportBgOnly = document.getElementById('export-bg-only')?.checked ?? false;

    let mimeType = 'image/png';
    if (format === 'jpeg') mimeType = 'image/jpeg';
    if (format === 'webp') mimeType = 'image/webp';

    const suffix = exportBgOnly ? '_bg' : '';

    // ページSVGからコマ番号テキストを除去（既存データ互換のため出力時にも除去）
    const removeTextNodes = (svgText) => {
        const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
        doc.querySelectorAll('text').forEach(el => el.remove());
        return new XMLSerializer().serializeToString(doc.documentElement);
    };

    const canvas = document.getElementById('render-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const exportBtn = document.getElementById('export-btn');
    if (exportBtn) exportBtn.disabled = true;

    // ページ番号の桁数（連番ゼロ埋め用）
    const digits = String(targetPages.length).length;

    try {
        // 複数ページかつ showDirectoryPicker が使える場合はフォルダを1回だけ選択（zip保存時は不要）
        let dirHandle = null;
        if (!zip && targetPages.length > 1 && window.showDirectoryPicker) {
            try {
                dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
            } catch (err) {
                if (err.name === 'AbortError') return;
                throw err;
            }
        }

        for (let i = 0; i < targetPages.length; i++) {
            const page = targetPages[i];
            const pageRecord = await dbGet('pages', page.name);
            if (!pageRecord || !pageRecord.svgContent) {
                console.warn(`ページデータが見つかりません: ${page.name}`);
                continue;
            }

            ctx.clearRect(0, 0, targetWidth, targetHeight);
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, targetWidth, targetHeight);

            if (exportBgOnly) {
                await drawSvgOnCanvas(ctx, removeTextNodes(pageRecord.svgContent), targetWidth, targetHeight);
            } else {
                const mergedSvg = buildMergedSvg(pageRecord);
                const rawSvg = mergedSvg || pageRecord.svgContent;
                const embeddedSvg = await embedFontsInSvg(rawSvg);
                await drawSvgOnCanvas(ctx, embeddedSvg, targetWidth, targetHeight);
            }

            // 連番プレフィックス（複数ページ時のみ付与）
            const seqPrefix = targetPages.length > 1
                ? String(i + 1).padStart(digits, '0') + '_'
                : '';
            const customName = document.getElementById('export-filename')?.value.trim() || '';
            const baseName = customName || page.name;
            const fileName = `${seqPrefix}${baseName}.${format}`;

            let blob = await new Promise((resolve, reject) => {
                canvas.toBlob(b => b ? resolve(b) : reject(new Error(t('page.errBlobGenFailed'))), mimeType, 0.95);
            });
            // 出力サブタブのメタ情報入力を画像ファイルへ埋め込む（PNG=iTXt / JPEG=XMP / WebP=XMP）
            blob = await _embedImageMetadata(blob, mimeType, targetWidth, targetHeight);

            if (zip) {
                // zipに追加（保存はループ後にまとめて行う）
                zip.file(fileName, blob);
            } else if (dirHandle) {
                // フォルダに直接書き込み（ダイアログなし）
                const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(blob);
                await writable.close();
            } else if (window.showSaveFilePicker) {
                // 1ページのみ: 従来どおり保存ダイアログ
                try {
                    const fileHandle = await window.showSaveFilePicker({
                        suggestedName: fileName,
                        types: [{ description: t('page.exportImageFileDesc'), accept: { [mimeType]: [`.${format}`] } }]
                    });
                    const writable = await fileHandle.createWritable();
                    await writable.write(blob);
                    await writable.close();
                } catch (err) {
                    if (err.name === 'AbortError') return;
                    throw err;
                }
            } else {
                // フォールバック: <a> タグでダウンロード
                const dlUrl = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = dlUrl;
                a.download = fileName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(dlUrl);
            }
        }

        if (zip) {
            // zipを生成して保存
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            const customName = document.getElementById('export-filename')?.value.trim() || '';
            const zipName = `${customName || _outputFilterGroup || 'pages'}.zip`;
            if (window.showSaveFilePicker) {
                try {
                    const fileHandle = await window.showSaveFilePicker({
                        suggestedName: zipName,
                        types: [{ description: t('page.exportZipFileDesc'), accept: { 'application/zip': ['.zip'] } }]
                    });
                    const writable = await fileHandle.createWritable();
                    await writable.write(zipBlob);
                    await writable.close();
                } catch (err) {
                    if (err.name === 'AbortError') return;
                    throw err;
                }
            } else {
                const dlUrl = URL.createObjectURL(zipBlob);
                const a = document.createElement('a');
                a.href = dlUrl;
                a.download = zipName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(dlUrl);
            }
            alert(t('page.msgExportedZip', targetPages.length, zipName));
        } else if (targetPages.length > 1) {
            alert(t('page.msgExportedPages', targetPages.length));
        }
    } catch (e) {
        console.error('Export error:', e);
        alert(t('page.msgExportError', e.message));
    } finally {
        if (exportBtn) exportBtn.disabled = false;
    }
}

