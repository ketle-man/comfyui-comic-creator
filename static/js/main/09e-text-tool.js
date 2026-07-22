// ============================================================
// フキダシ管理 分割ファイル (5/5): テキスト編集ツール本体
// 元 09-balloons.js（分割前）の行 2355-3119 に相当
// <script>(非module)として読み込まれ、他の分割ファイルとグローバルスコープを共有する。
// 読み込み順は templates/index.html の <script> タグ順に依存する。
// 主なトップレベル定義: _fontAssetBuildCard,_fontAssetBuildGroup,_fontMgrApplyFillPaintToEl,_fontMgrApplyStyleAttrsToTextEl,_fontMgrExtractStyleFromTextEl,_fontMgrRenderMiniPreview,_getSelectedPanelCenter,_setTextElVertical,applyPresetToSelectedText,applyStyleToSelectedText,applyTextInput,initTextTools,insertPresetPlaceholderText,insertScriptDialogueText,insertStylePlaceholderText,openTextInputDialog,renderAssetFontGrid,updateBalloonPanelSelect
// ============================================================

// document登録リスナー参照（renderLayoutTab()経由の再初期化で積み上がらないよう保持）
let _textToolsDocMouseMove = null;
let _textToolsDocMouseUp = null;

function initTextTools(textSvgEl, _imageSvgEl) {
    if (!textSvgEl) return;
    if (_textToolsDocMouseMove) { document.removeEventListener('mousemove', _textToolsDocMouseMove); _textToolsDocMouseMove = null; }
    if (_textToolsDocMouseUp)   { document.removeEventListener('mouseup', _textToolsDocMouseUp); _textToolsDocMouseUp = null; }

    let selectedText = null;
    let textRotating = false;
    let textDragging = false;
    let textResizing = false;
    let startAngle = 0, startAngleRad = 0;
    let startX = 0, startY = 0, initTx = 0, initTy = 0;
    let resizeInitFontSize = 0, resizeInitBboxDiag = 0, resizeCx = 0, resizeCy = 0;

    const getSvgPt = (clientX, clientY) => {
        const pt = textSvgEl.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        return pt.matrixTransform(textSvgEl.getScreenCTM().inverse());
    };

    textSvgEl.addEventListener('mousedown', (e) => {
        // リサイズ・回転ハンドル
        const handle = e.target.closest('.text-handle');
        if (handle && selectedText) {
            e.preventDefault();
            e.stopPropagation();
            const cx = parseFloat(selectedText.dataset.bboxCx);
            const cy = parseFloat(selectedText.dataset.bboxCy);
            const pt = getSvgPt(e.clientX, e.clientY);
            if (handle.dataset.handleType === 'rotate') {
                textRotating = true;
                startAngle = parseFloat(selectedText.dataset.angle || 0);
                startAngleRad = Math.atan2(pt.y - cy, pt.x - cx);
            } else {
                // リサイズハンドル: 現在のBBox対角線長とフォントサイズを記録
                textResizing = true;
                resizeCx = cx;
                resizeCy = cy;
                resizeInitFontSize = parseFloat(selectedText.getAttribute('font-size')) || 10;
                const bb = selectedText.getBBox();
                resizeInitBboxDiag = Math.sqrt(bb.width * bb.width + bb.height * bb.height) || 1;
                startX = pt.x;
                startY = pt.y;
            }
            return;
        }

        // テキスト要素のドラッグ移動（フキダシ+内包テキスト(09f-bubble-text.js)の子テキストは
        // balloon-shape側の単一オブジェクトとして扱うため、単独テキストとしての選択・移動対象から除外する）
        const textEl = e.target.closest('text');
        if (textEl && textEl.closest('svg') === textSvgEl && !textEl.closest('.balloon-shape')) {
            if (textEl.closest('[data-group-id]')) return; // グループ内はグループ操作に委ねる
            if (_isObjectLocked(textEl)) return; // ロック中は操作不可
            e.preventDefault();
            e.stopPropagation();
            // 既に選択済みでなければ選択
            if (selectedText !== textEl) {
                if (selectedText) selectedText.classList.remove('selected');
                selectedText = textEl;
                // 排他選択: 他の種類（画像/フキダシ/グループ等）の選択も含めて完全にクリアしてから選択する
                _clearObjectSelection();
                state.selectedTextEl = textEl;
                syncFontFamilyUI(textEl);
                if (!textEl.dataset.angle) textEl.dataset.angle = '0';
                renderTextHandles(textEl, textSvgEl);
                syncPanelSelectionToObject(textEl);
                renderLayerPanel();
            }
            textDragging = true;
            const pt = getSvgPt(e.clientX, e.clientY);
            startX = pt.x;
            startY = pt.y;
            initTx = parseFloat(textEl.getAttribute('x'));
            initTy = parseFloat(textEl.getAttribute('y'));
            return;
        }

        // 背景クリックで選択解除
        if (e.target === textSvgEl || e.target.closest('g') === textSvgEl.querySelector('g')) {
            if (!e.target.closest('text') && !e.target.closest('.text-handle')) {
                if (selectedText) selectedText.classList.remove('selected');
                selectedText = null;
                state.selectedTextEl = null;
                clearTextHandles(textSvgEl);
                renderLayerPanel();
            }
        }
    });

    textSvgEl.addEventListener('click', (e) => {
        if (!state.balloon.isTextMode) return;
        if (e.target.closest('text') || e.target.closest('.text-handle')) return;

        // 何もないところをクリックで新規追加
        const pt = getSvgPt(e.clientX, e.clientY);
        openTextInputDialog(pt.x, pt.y);
    });

    // ダブルクリックで既存テキストを再編集（フキダシ+内包テキストの子テキストは09f-bubble-text.js側で処理する）
    textSvgEl.addEventListener('dblclick', (e) => {
        const textEl = e.target.closest('text');
        if (!textEl || textEl.closest('svg') !== textSvgEl || textEl.closest('.balloon-shape')) return;
        if (_isObjectLocked(textEl)) return; // ロック中は編集モーダルを開かない
        e.preventDefault();
        e.stopPropagation();
        const x = parseFloat(textEl.getAttribute('x'));
        const y = parseFloat(textEl.getAttribute('y'));
        openTextInputDialog(x, y, textEl);
    });

    _textToolsDocMouseMove = (e) => {
        if (!selectedText) return;

        if (textResizing) {
            e.preventDefault();
            const pt = getSvgPt(e.clientX, e.clientY);
            // ハンドルのドラッグ量から、中心までの距離の変化比でフォントサイズを拡縮
            const dx = pt.x - resizeCx;
            const dy = pt.y - resizeCy;
            const currentDist = Math.sqrt(dx * dx + dy * dy);
            const ratio = currentDist / (resizeInitBboxDiag / 2);
            const newSize = Math.max(6, Math.round(resizeInitFontSize * ratio));
            selectedText.setAttribute('font-size', newSize);
            // tspan の x/y オフセットはフォントサイズに依存しないので再配置不要
            renderTextHandles(selectedText, textSvgEl);
            // UIのサイズ表示も更新
            const fontSizeInput = document.getElementById('font-size');
            const PT_TO_SVG = 3.528;
            if (fontSizeInput) fontSizeInput.value = Math.round(newSize / PT_TO_SVG);
            return;
        }

        if (textRotating) {
            e.preventDefault();
            const cx = parseFloat(selectedText.dataset.bboxCx);
            const cy = parseFloat(selectedText.dataset.bboxCy);
            const pt = getSvgPt(e.clientX, e.clientY);
            const currentRad = Math.atan2(pt.y - cy, pt.x - cx);
            const deltaDeg = (currentRad - startAngleRad) * 180 / Math.PI;
            const newAngle = startAngle + deltaDeg;
            selectedText.dataset.angle = newAngle;
            selectedText.setAttribute('transform', `rotate(${newAngle},${cx},${cy})`);
            renderTextHandles(selectedText, textSvgEl);
        }

        if (textDragging) {
            e.preventDefault();
            const pt = getSvgPt(e.clientX, e.clientY);
            const dx = pt.x - startX;
            const dy = pt.y - startY;
            const nx = initTx + dx;
            const ny = initTy + dy;
            selectedText.setAttribute('x', nx);
            selectedText.setAttribute('y', ny);
            // tspan のx/y属性も同期（縦書きではtspanにy属性もあるため両方更新）
            selectedText.querySelectorAll('tspan[x]').forEach(ts => {
                const ox = parseFloat(ts.dataset.origX ?? ts.getAttribute('x'));
                if (!ts.dataset.origX) ts.dataset.origX = ts.getAttribute('x');
                ts.setAttribute('x', ox + dx);
            });
            selectedText.querySelectorAll('tspan[y]').forEach(ts => {
                const oy = parseFloat(ts.dataset.origY ?? ts.getAttribute('y'));
                if (!ts.dataset.origY) ts.dataset.origY = ts.getAttribute('y');
                ts.setAttribute('y', oy + dy);
            });
            // 回転中心をBBox中心に更新（回転後の移動ズレを防ぐ）
            const angle = parseFloat(selectedText.dataset.angle || 0);
            if (angle !== 0) {
                const bb = selectedText.getBBox();
                const bcx = bb.x + bb.width / 2;
                const bcy = bb.y + bb.height / 2;
                selectedText.dataset.bboxCx = bcx;
                selectedText.dataset.bboxCy = bcy;
                selectedText.setAttribute('transform', `rotate(${angle},${bcx},${bcy})`);
            }
            renderTextHandles(selectedText, textSvgEl);
        }
    };
    document.addEventListener('mousemove', _textToolsDocMouseMove);

    const onTextMouseUp = async () => {
        if (textResizing) {
            textResizing = false;
            if (selectedText) {
                const PT_TO_SVG = 3.528;
                const svgSize = parseFloat(selectedText.getAttribute('font-size'));
                state.balloon.fontSize = Math.round(svgSize / PT_TO_SVG);
                // selectedTextが属するコマIDを取得して保存
                const panelId = selectedText.closest('g[data-clip-panel]')?.getAttribute('data-clip-panel') || state.selectedPanelId || 'panel-0';
                await savePanelSvg(panelId, textSvgEl);
            }
            return;
        }
        if (textRotating || textDragging) {
            textRotating = false;
            textDragging = false;
            if (selectedText) {
                selectedText.querySelectorAll('tspan').forEach(ts => {
                    delete ts.dataset.origX;
                    delete ts.dataset.origY;
                });
                const panelId = selectedText.closest('g[data-clip-panel]')?.getAttribute('data-clip-panel') || state.selectedPanelId || 'panel-0';
                await savePanelSvg(panelId, textSvgEl);
            }
        }
    };
    _textToolsDocMouseUp = onTextMouseUp;
    document.addEventListener('mouseup', _textToolsDocMouseUp);
}

function openTextInputDialog(x, y, editTextEl = null) {
    state.pendingTextPosition = { x, y };
    state.pendingEditTextEl = editTextEl;
    const input = document.getElementById('text-input-field');
    const dialog = document.getElementById('text-input-dialog');
    if (input && dialog) {
        if (editTextEl) {
            // 既存テキストの内容を復元（tspanを改行で結合）
            const lines = Array.from(editTextEl.querySelectorAll('tspan')).map(ts => ts.textContent);
            input.value = lines.length > 0 ? lines.join('\n') : editTextEl.textContent;
            // フォントファミリーをUIに同期
            syncFontFamilyUI(editTextEl);
        } else {
            input.value = '';
        }
        dialog.style.display = 'flex';

        const focusInput = () => {
            input.focus();
            if (document.activeElement !== input) {
                input.click();
                input.focus();
            }
            input.select();
        };

        setTimeout(focusInput, 50);
        setTimeout(focusInput, 150);
    }
}

// テキスト要素の縦書き/横書きを切り替え、tspanの配置を再構築する
// （applyTextInput の新規/再編集と、縦書きチェックボックスの選択中テキストへの即時反映から共用）
// keepCenter=true でブロックの中心位置を保ったまま切り替える（チェックボックス切替用。
// 縦書きは親x,yから左へ列が伸びるため、そのままだと行数が多いテキストがコマ外へ飛び出す）
function _setTextElVertical(textEl, isVertical, keepCenter = false) {
    let beforeCx = null, beforeCy = null;
    if (keepCenter) {
        try {
            const bb = textEl.getBBox();
            beforeCx = bb.x + bb.width / 2;
            beforeCy = bb.y + bb.height / 2;
        } catch { /* DOM未接続時などは中心保存なしで続行 */ }
    }

    const x = parseFloat(textEl.getAttribute('x'));
    const y = parseFloat(textEl.getAttribute('y'));
    const fontSizeSvg = parseFloat(textEl.getAttribute('font-size')) || 40;

    // SVG1.1の writing-mode="tb" 属性はSVG2/CSS Writing Modesを実装する現行ブラウザでは
    // 無効な値として無視される（有効なのは horizontal-tb|vertical-rl|vertical-lr）ため、
    // 属性ではなくCSSプロパティとして設定する。text-orientation:uprightで
    // 日本語の字形を回転させず正立のまま縦に並べる
    if (isVertical) {
        textEl.style.writingMode = 'vertical-rl';
        textEl.style.textOrientation = 'upright';
    } else {
        textEl.style.writingMode = '';
        textEl.style.textOrientation = '';
    }

    textEl.querySelectorAll('tspan').forEach((ts, i) => {
        ts.removeAttribute('x');
        ts.removeAttribute('y');
        ts.removeAttribute('dy');
        delete ts.dataset.origX;
        delete ts.dataset.origY;
        if (isVertical) {
            ts.setAttribute('x', x - (fontSizeSvg * 1.2 * i));
            ts.setAttribute('y', y);
        } else if (i > 0) {
            ts.setAttribute('x', x);
            ts.setAttribute('dy', '1.2em');
        }
    });

    // 切替後のBBox中心が切替前と一致するよう全体をシフト
    if (beforeCx !== null) {
        try {
            const bb = textEl.getBBox();
            const dx = beforeCx - (bb.x + bb.width / 2);
            const dy = beforeCy - (bb.y + bb.height / 2);
            if (dx || dy) {
                textEl.setAttribute('x', x + dx);
                textEl.setAttribute('y', y + dy);
                textEl.querySelectorAll('tspan[x]').forEach(ts => ts.setAttribute('x', parseFloat(ts.getAttribute('x')) + dx));
                textEl.querySelectorAll('tspan[y]').forEach(ts => ts.setAttribute('y', parseFloat(ts.getAttribute('y')) + dy));
            }
            // 回転がある場合は回転中心もBBox中心に合わせ直す
            const angle = parseFloat(textEl.dataset.angle || 0);
            if (angle !== 0) {
                textEl.dataset.bboxCx = beforeCx;
                textEl.dataset.bboxCy = beforeCy;
                textEl.setAttribute('transform', `rotate(${angle},${beforeCx},${beforeCy})`);
            }
        } catch { /* 念のため */ }
    }
}

async function applyTextInput() {
    if (!state.pendingTextPosition) return;

    const text = document.getElementById('text-input-field').value;
    if (!text) return;

    // 統合SVGを取得
    const overlaySvgEl = document.querySelector('#layout-preview #image-layer svg');
    if (!overlaySvgEl) return;

    pushHistory();

    // pt → SVG座標系変換
    const PT_TO_SVG = 3.528;
    const fontSizeSvg = Math.round(state.balloon.fontSize * PT_TO_SVG);

    const editEl = state.pendingEditTextEl; // 再編集対象（null=新規）
    let resultTextEl = editEl;

    if (editEl) {
        // 既存テキスト要素の内容を更新（位置・transform・data-*は保持）
        editEl.innerHTML = ''; // 既存tspanをクリア
        text.split('\n').forEach(line => {
            const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            tspan.textContent = line;
            editEl.appendChild(tspan);
        });
        // writing-mode属性とtspan配置を現在の縦書き設定に合わせて再構築
        _setTextElVertical(editEl, state.balloon.isVertical);
    } else {
        // 新規テキスト要素を作成
        const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        textEl.setAttribute('x', state.pendingTextPosition.x);
        textEl.setAttribute('y', state.pendingTextPosition.y);
        textEl.setAttribute('fill', state.balloon.textColor);
        textEl.setAttribute('font-family', state.balloon.fontFamily);
        textEl.setAttribute('font-size', fontSizeSvg);
        textEl.style.whiteSpace = 'pre';
        textEl.style.pointerEvents = 'auto';

        text.split('\n').forEach(line => {
            const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            tspan.textContent = line;
            textEl.appendChild(tspan);
        });
        _setTextElVertical(textEl, state.balloon.isVertical);

        // コマが選択されている場合はそのコマのgグループに追加、オーバーレイ選択中はオーバーレイgに追加
        const panelId = state.selectedPanelId;
        let targetParent = overlaySvgEl;
        if (state.selectedOverlay) {
            targetParent = getOrCreateOverlayGroup(overlaySvgEl);
        } else if (panelId && panelId !== 'panel-0') {
            const clipId = `panel-clip-${panelId}`;
            let defs = overlaySvgEl.querySelector('defs');
            if (!defs) {
                defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
                overlaySvgEl.insertBefore(defs, overlaySvgEl.firstChild);
            }
            if (!defs.querySelector(`[id="${clipId}"]`)) {
                const panel = state.activePage.panels.find(p => p.id === panelId);
                if (panel && panel.points) {
                    const clipPath = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
                    clipPath.setAttribute('id', clipId);
                    clipPath.setAttribute('clipPathUnits', 'userSpaceOnUse');
                    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                    poly.setAttribute('points', panel.points);
                    clipPath.appendChild(poly);
                    defs.appendChild(clipPath);
                }
            }
            let contentG = overlaySvgEl.querySelector(`g[data-clip-panel="${panelId}"]`);
            if (!contentG) {
                contentG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                contentG.setAttribute('clip-path', `url(#${clipId})`);
                contentG.setAttribute('data-clip-panel', panelId);
                overlaySvgEl.appendChild(contentG);
            }
            targetParent = contentG;
        }
        targetParent.appendChild(textEl);
        resultTextEl = textEl;
    }

    if (state.selectedOverlay) {
        await saveOverlaySvg(overlaySvgEl);
    } else {
        await savePanelSvg(state.selectedPanelId || 'panel-0', overlaySvgEl);
    }

    document.getElementById('text-input-dialog').style.display = 'none';
    state.pendingTextPosition = null;
    state.pendingEditTextEl = null;
    return resultTextEl;
}

// 選択中のコマのバウンディングボックス中心（オーバーレイ/未選択時はページ中心）を返す
function _getSelectedPanelCenter(overlaySvgEl) {
    const panel = (!state.selectedOverlay && state.selectedPanelId)
        ? state.activePage?.panels?.find(p => p.id === state.selectedPanelId)
        : null;
    if (panel && panel.points) {
        const pts = panel.points.trim().split(/\s+/).map(s => s.split(',').map(Number));
        const xs = pts.map(p => p[0]);
        const ys = pts.map(p => p[1]);
        return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    }
    const vb = overlaySvgEl.viewBox?.baseVal;
    return { x: vb ? vb.x + vb.width / 2 : 0, y: vb ? vb.y + vb.height / 2 : 0 };
}

// スクリプトタブのプロットで選択中のセル（シーン／要素／セリフ・説明等）の内容を、選択中のコマ中心にテキストとして挿入する
// （applyTextInput を再利用するため、現在のフォント・縦書き・色設定がそのまま適用される）
async function insertScriptDialogueText() {
    const text = _scriptGetSelectedDialogue();
    if (text == null) { alert(t('textTool.selectScriptCell')); return; }
    if (!text.trim()) { alert(t('textTool.emptyCell')); return; }

    const overlaySvgEl = document.querySelector('#layout-preview #image-layer svg');
    if (!overlaySvgEl) { alert(t('textTool.showPageFirst')); return; }

    const { x, y } = _getSelectedPanelCenter(overlaySvgEl);
    state.pendingTextPosition = { x, y };
    state.pendingEditTextEl = null;
    const input = document.getElementById('text-input-field');
    if (input) input.value = text;
    await applyTextInput();
}

// 塗りペイント定義（グラデーション/テクスチャパターン）をdefsに生成してfill=url(#id)を設定する。
// fillEnabled=false は fill="none"（塗りなし）、fillMode 未指定/solid は従来どおり単色。
// 前回適用分の定義は dataset.styleFillId で管理して再適用時に除去する
function _fontMgrApplyFillPaintToEl(el, svgEl, styleObj, k) {
    const ns = 'http://www.w3.org/2000/svg';

    // 前回のペイント定義を除去
    const oldFillId = el.dataset.styleFillId;
    if (oldFillId) {
        svgEl.querySelector(`[id="${oldFillId}"]`)?.remove();
        delete el.dataset.styleFillId;
    }

    if (styleObj && styleObj.fillEnabled === false) {
        el.setAttribute('fill', 'none');
        return;
    }

    const mode = styleObj?.fillMode || 'solid';
    if (mode === 'gradient' && styleObj?.fillGradient?.stops?.length) {
        const g = styleObj.fillGradient;
        let defs = svgEl.querySelector('defs');
        if (!defs) {
            defs = document.createElementNS(ns, 'defs');
            svgEl.insertBefore(defs, svgEl.firstChild);
        }
        const fillId = `text-fill-${Date.now()}-${Math.floor(Math.random() * 1e5)}`;
        let grad;
        if (g.shape === 'radial') {
            grad = document.createElementNS(ns, 'radialGradient');
            grad.setAttribute('cx', '0.5');
            grad.setAttribute('cy', '0.5');
            grad.setAttribute('r', '0.5');
        } else {
            grad = document.createElementNS(ns, 'linearGradient');
            // angleDeg: 0=左→右、90=上→下。単位ボックス中心から方向ベクトルで両端を決める
            const rad = ((g.angleDeg || 0) * Math.PI) / 180;
            const dx = Math.cos(rad) / 2, dy = Math.sin(rad) / 2;
            grad.setAttribute('x1', String(0.5 - dx));
            grad.setAttribute('y1', String(0.5 - dy));
            grad.setAttribute('x2', String(0.5 + dx));
            grad.setAttribute('y2', String(0.5 + dy));
        }
        grad.setAttribute('id', fillId);
        grad.setAttribute('gradientUnits', 'objectBoundingBox');
        grad.setAttribute('data-ccc-style-fill', '1');
        [...g.stops].sort((a, b) => a.pos - b.pos).forEach(s => {
            const stop = document.createElementNS(ns, 'stop');
            stop.setAttribute('offset', String(Math.max(0, Math.min(1, s.pos))));
            stop.setAttribute('stop-color', s.color || '#000000');
            grad.appendChild(stop);
        });
        defs.appendChild(grad);
        el.setAttribute('fill', `url(#${fillId})`);
        el.dataset.styleFillId = fillId;
        return;
    }
    if (mode === 'texture' && styleObj?.fillTexture?.dataUrl) {
        const tx = styleObj.fillTexture;
        let defs = svgEl.querySelector('defs');
        if (!defs) {
            defs = document.createElementNS(ns, 'defs');
            svgEl.insertBefore(defs, svgEl.firstChild);
        }
        const fillId = `text-fill-${Date.now()}-${Math.floor(Math.random() * 1e5)}`;
        // タイルサイズ = 画像実寸 × (scale/100) × k（v2相対値: フォントサイズ100pxあたり）
        const scale = (tx.scale || 100) / 100;
        const tw = Math.max(1, (tx.w || 100) * scale * k);
        const th = Math.max(1, (tx.h || 100) * scale * k);
        const pattern = document.createElementNS(ns, 'pattern');
        pattern.setAttribute('id', fillId);
        pattern.setAttribute('patternUnits', 'userSpaceOnUse');
        pattern.setAttribute('width', String(tw));
        pattern.setAttribute('height', String(th));
        pattern.setAttribute('data-ccc-style-fill', '1');
        // 抽出（_fontMgrExtractStyleFromTextEl）でのラウンドトリップ用に元データを持たせる
        pattern.setAttribute('data-ccc-tex-w', String(tx.w || 100));
        pattern.setAttribute('data-ccc-tex-h', String(tx.h || 100));
        pattern.setAttribute('data-ccc-tex-scale', String(tx.scale || 100));
        const img = document.createElementNS(ns, 'image');
        img.setAttribute('href', tx.dataUrl);
        img.setAttribute('x', '0');
        img.setAttribute('y', '0');
        img.setAttribute('width', String(tw));
        img.setAttribute('height', String(th));
        img.setAttribute('preserveAspectRatio', 'none');
        pattern.appendChild(img);
        defs.appendChild(pattern);
        el.setAttribute('fill', `url(#${fillId})`);
        el.dataset.styleFillId = fillId;
        return;
    }
    el.setAttribute('fill', styleObj?.fill || '#000000');
}

// SVGテキスト要素へ塗り・線をネイティブ属性で、袋文字・影をSVGフィルタで適用する
// （フィルタはfeMorphologyで既存の塗り+線の形状を膨張させてから合成するため、要素は1つのまま扱える）
// スタイル値（線幅・袋文字幅・影）は「フォントサイズ100pxあたりのpx」の相対値(v2)。
// 要素のfont-sizeに比例スケールして適用するため、レイアウト（SVG単位）・Imageタブ（px）・
// プレビューのどれでも文字サイズに対する見た目の比率が一致する
function _fontMgrApplyStyleAttrsToTextEl(textEl, svgEl, styleObj) {
    const _fs = parseFloat(textEl.getAttribute('font-size'));
    const k = (isNaN(_fs) || _fs <= 0 ? 100 : _fs) / 100;
    _fontMgrApplyFillPaintToEl(textEl, svgEl, styleObj, k);

    if (styleObj?.strokeEnabled) {
        textEl.setAttribute('stroke', styleObj.strokeColor);
        textEl.setAttribute('stroke-width', (styleObj.strokeWidth || 0) * k);
        textEl.setAttribute('paint-order', 'stroke fill');
    } else {
        textEl.removeAttribute('stroke');
        textEl.removeAttribute('stroke-width');
        textEl.removeAttribute('paint-order');
    }

    textEl.setAttribute('font-weight', styleObj?.boldEnabled ? 'bold' : 'normal');
    textEl.setAttribute('font-style', styleObj?.italicEnabled ? 'italic' : 'normal');
    if (styleObj?.underlineEnabled) {
        textEl.setAttribute('text-decoration', 'underline');
    } else {
        textEl.removeAttribute('text-decoration');
    }
    // align はレイアウトタブのSVGテキスト（tspan配置が左端基準）には適用しない（Imageタブ専用）

    // 前回適用時のフィルタを除去
    const oldFilterId = textEl.dataset.styleFilterId;
    if (oldFilterId) {
        svgEl.querySelector(`filter[id="${oldFilterId}"]`)?.remove();
        delete textEl.dataset.styleFilterId;
    }
    textEl.removeAttribute('filter');

    const needsBukuro = !!styleObj?.bukuroEnabled;
    const needsShadow = !!styleObj?.shadowEnabled;
    if (!needsBukuro && !needsShadow) return;

    const ns = 'http://www.w3.org/2000/svg';
    let defs = svgEl.querySelector('defs');
    if (!defs) {
        defs = document.createElementNS(ns, 'defs');
        svgEl.insertBefore(defs, svgEl.firstChild);
    }
    const filterId = `text-style-filter-${Date.now()}-${Math.floor(Math.random() * 1e5)}`;
    const filter = document.createElementNS(ns, 'filter');
    filter.setAttribute('id', filterId);
    filter.setAttribute('x', '-50%');
    filter.setAttribute('y', '-50%');
    filter.setAttribute('width', '200%');
    filter.setAttribute('height', '200%');

    let source = 'SourceGraphic';
    if (needsBukuro) {
        const morph = document.createElementNS(ns, 'feMorphology');
        morph.setAttribute('in', source);
        morph.setAttribute('operator', 'dilate');
        morph.setAttribute('radius', (styleObj.bukuroWidth || 0) * k);
        morph.setAttribute('result', 'dilated');
        filter.appendChild(morph);

        const flood = document.createElementNS(ns, 'feFlood');
        flood.setAttribute('flood-color', styleObj.bukuroColor);
        flood.setAttribute('result', 'bukuroColor');
        filter.appendChild(flood);

        const comp = document.createElementNS(ns, 'feComposite');
        comp.setAttribute('in', 'bukuroColor');
        comp.setAttribute('in2', 'dilated');
        comp.setAttribute('operator', 'in');
        comp.setAttribute('result', 'bukuroShape');
        filter.appendChild(comp);

        const merge = document.createElementNS(ns, 'feMerge');
        merge.setAttribute('result', 'withBukuro');
        const mn1 = document.createElementNS(ns, 'feMergeNode');
        mn1.setAttribute('in', 'bukuroShape');
        const mn2 = document.createElementNS(ns, 'feMergeNode');
        mn2.setAttribute('in', source);
        merge.appendChild(mn1);
        merge.appendChild(mn2);
        filter.appendChild(merge);
        source = 'withBukuro';
    }
    if (needsShadow) {
        const drop = document.createElementNS(ns, 'feDropShadow');
        drop.setAttribute('in', source);
        drop.setAttribute('dx', (styleObj.shadowDx || 0) * k);
        drop.setAttribute('dy', (styleObj.shadowDy || 0) * k);
        // stdDeviationはガウスσ直指定。CSS/Canvasのblur値はσ≈blur/2相当のため半分にして揃える
        drop.setAttribute('stdDeviation', ((styleObj.shadowBlur || 0) / 2) * k);
        drop.setAttribute('flood-color', styleObj.shadowColor);
        filter.appendChild(drop);
    }
    defs.appendChild(filter);
    textEl.setAttribute('filter', `url(#${filterId})`);
    textEl.dataset.styleFilterId = filterId;
}

// _fontMgrApplyStyleAttrsToTextEl の逆変換: SVGテキスト要素の現在の見た目からスタイルオブジェクトを復元する
// （テキストスタイルモーダルを開く際、既存の線・袋文字・影の設定をUIの初期値として反映するために使う）
// 属性値はfont-sizeでスケール済みの実寸なので、相対値(フォントサイズ100pxあたり)に割り戻す。
// 旧仕様（絶対値）で作られた既存テキストも「現在の見た目」を相対値として正しく取り出せる
function _fontMgrExtractStyleFromTextEl(textEl, svgEl) {
    const _fs = parseFloat(textEl.getAttribute('font-size'));
    const k = (isNaN(_fs) || _fs <= 0 ? 100 : _fs) / 100;
    const rel = (v) => Math.round((v / k) * 10) / 10;

    // 塗り: none / url(#グラデ・パターン) / 単色 を判別して復元する
    const fillAttr = textEl.getAttribute('fill') || '#000000';
    let fillEnabled = true, fillMode = 'solid', fillSolid = '#000000';
    let fillGradient = null, fillTexture = null;
    if (fillAttr === 'none') {
        fillEnabled = false;
    } else {
        const um = /url\(["']?#([^"')]+)["']?\)/.exec(fillAttr);
        const def = um && svgEl ? svgEl.querySelector(`[id="${um[1]}"]`) : null;
        if (def && (def.tagName === 'linearGradient' || def.tagName === 'radialGradient')) {
            fillMode = 'gradient';
            const stops = [...def.querySelectorAll('stop')].map(s => ({
                pos: parseFloat(s.getAttribute('offset')) || 0,
                color: s.getAttribute('stop-color') || '#000000',
            }));
            let shape = 'linear', angleDeg = 0;
            if (def.tagName === 'radialGradient') {
                shape = 'radial';
            } else {
                const x1 = parseFloat(def.getAttribute('x1') ?? 0), y1 = parseFloat(def.getAttribute('y1') ?? 0);
                const x2 = parseFloat(def.getAttribute('x2') ?? 1), y2 = parseFloat(def.getAttribute('y2') ?? 0);
                angleDeg = Math.round(Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI);
                if (angleDeg < 0) angleDeg += 360;
            }
            fillGradient = { shape, angleDeg, stops: stops.length ? stops : [{ pos: 0, color: '#ffffff' }, { pos: 1, color: '#888888' }] };
            fillSolid = stops[0]?.color || '#000000';
        } else if (def && def.tagName === 'pattern') {
            fillMode = 'texture';
            const img = def.querySelector('image');
            fillTexture = {
                dataUrl: img?.getAttribute('href') || img?.getAttribute('xlink:href') || '',
                w: parseFloat(def.getAttribute('data-ccc-tex-w')) || 100,
                h: parseFloat(def.getAttribute('data-ccc-tex-h')) || 100,
                scale: parseFloat(def.getAttribute('data-ccc-tex-scale')) || 100,
            };
        } else if (!um) {
            fillSolid = fillAttr;
        }
    }

    const style = {
        fill: fillSolid,
        fillEnabled,
        fillMode,
        fillGradient,
        fillTexture,
        strokeEnabled: !!textEl.getAttribute('stroke'),
        strokeColor: textEl.getAttribute('stroke') || '#ffffff',
        strokeWidth: rel(parseFloat(textEl.getAttribute('stroke-width'))) || 4,
        boldEnabled: textEl.getAttribute('font-weight') === 'bold',
        italicEnabled: textEl.getAttribute('font-style') === 'italic',
        underlineEnabled: textEl.getAttribute('text-decoration') === 'underline',
        align: 'left',
        bukuroEnabled: false,
        bukuroColor: '#000000',
        bukuroWidth: 8,
        shadowEnabled: false,
        shadowColor: '#000000',
        shadowBlur: 4,
        shadowDx: 4,
        shadowDy: 4,
    };

    const filterId = textEl.dataset.styleFilterId;
    const filterEl = filterId && svgEl ? svgEl.querySelector(`filter[id="${filterId}"]`) : null;
    if (filterEl) {
        const morph = filterEl.querySelector('feMorphology');
        const flood = filterEl.querySelector('feFlood');
        if (morph && flood) {
            style.bukuroEnabled = true;
            style.bukuroWidth = rel(parseFloat(morph.getAttribute('radius'))) || 8;
            style.bukuroColor = flood.getAttribute('flood-color') || '#000000';
        }
        const drop = filterEl.querySelector('feDropShadow');
        if (drop) {
            style.shadowEnabled = true;
            style.shadowDx = rel(parseFloat(drop.getAttribute('dx'))) || 0;
            style.shadowDy = rel(parseFloat(drop.getAttribute('dy'))) || 0;
            // 適用時にstdDeviation=(blur/2)*kで書き込んでいるため2倍で割り戻す
            style.shadowBlur = rel(parseFloat(drop.getAttribute('stdDeviation')) * 2) || 0;
            style.shadowColor = drop.getAttribute('flood-color') || '#000000';
        }
    }
    return style;
}

// フォントタブの「プリセット」を選択中のコマ中心にプレースホルダテキストとして新規挿入する
async function insertPresetPlaceholderText(preset) {
    const overlaySvgEl = document.querySelector('#layout-preview #image-layer svg');
    if (!overlaySvgEl) { alert(t('textTool.showPageFirst')); return; }

    const style = _fontMgrLoadStyles().find(s => s.id === preset.styleId);

    state.balloon.fontFamily = preset.fontFamily;
    state.balloon.fontSize = preset.fontSize;
    state.balloon.isVertical = preset.isVertical;
    state.balloon.textColor = style?.fill || '#000000';

    const fontSel = document.getElementById('font-family');
    if (fontSel) fontSel.value = preset.fontFamily;
    const vertCheck = document.getElementById('text-vertical');
    if (vertCheck) vertCheck.checked = preset.isVertical;
    const sizeInput = document.getElementById('font-size');
    if (sizeInput) sizeInput.value = preset.fontSize;

    const { x, y } = _getSelectedPanelCenter(overlaySvgEl);
    state.pendingTextPosition = { x, y };
    state.pendingEditTextEl = null;
    const input = document.getElementById('text-input-field');
    if (input) input.value = t('textTool.defaultText');

    const createdEl = await applyTextInput();
    if (createdEl) {
        _fontMgrApplyStyleAttrsToTextEl(createdEl, overlaySvgEl, style);
        await saveTextSvg(overlaySvgEl);
    }
}

// フォントタブの「プリセット」を選択中のテキスト要素に適用する
// 縦書きの有無は既存の複数行tspan配置を崩す恐れがあるため対象外（フォント・サイズ・塗り・線・袋文字・影のみ反映）
async function applyPresetToSelectedText(preset) {
    if (!state.selectedTextEl) { alert(t('textTool.selectTextFirst')); return; }
    const svgEl = getPanelLayerSvg();
    if (!svgEl) return;

    const textEl = state.selectedTextEl;
    const style = _fontMgrLoadStyles().find(s => s.id === preset.styleId);

    textEl.setAttribute('font-family', preset.fontFamily);
    state.balloon.fontFamily = preset.fontFamily;
    const fontSel = document.getElementById('font-family');
    if (fontSel) fontSel.value = preset.fontFamily;

    const PT_TO_SVG = 3.528;
    textEl.setAttribute('font-size', Math.round(preset.fontSize * PT_TO_SVG));
    state.balloon.fontSize = preset.fontSize;
    const sizeInput = document.getElementById('font-size');
    if (sizeInput) sizeInput.value = preset.fontSize;

    _fontMgrApplyStyleAttrsToTextEl(textEl, svgEl, style);
    if (style) state.balloon.textColor = style.fill;

    renderTextHandles(textEl, svgEl);
    await saveTextSvg(svgEl);
}

// フォントタブの「スタイル」を選択中のコマ中心にプレースホルダテキストとして新規挿入する（フォント・サイズ・縦書きは現在のデフォルトのまま）
async function insertStylePlaceholderText(style) {
    const overlaySvgEl = document.querySelector('#layout-preview #image-layer svg');
    if (!overlaySvgEl) { alert(t('textTool.showPageFirst')); return; }

    const { x, y } = _getSelectedPanelCenter(overlaySvgEl);
    state.pendingTextPosition = { x, y };
    state.pendingEditTextEl = null;
    const input = document.getElementById('text-input-field');
    if (input) input.value = t('textTool.defaultText');

    const createdEl = await applyTextInput();
    if (createdEl) {
        _fontMgrApplyStyleAttrsToTextEl(createdEl, overlaySvgEl, style);
        await saveTextSvg(overlaySvgEl);
    }
}

// フォントタブの「スタイル」を選択中のテキスト要素に適用する（フォント・サイズ・縦書きは変更しない）
async function applyStyleToSelectedText(style) {
    if (!state.selectedTextEl) { alert(t('textTool.selectTextFirst')); return; }
    const svgEl = getPanelLayerSvg();
    if (!svgEl) return;
    _fontMgrApplyStyleAttrsToTextEl(state.selectedTextEl, svgEl, style);
    await saveTextSvg(svgEl);
}

// CSSベースのミニプレビュー（アセットパネル「フォント」タブのサムネ用）を1個のコンテナに描画
function _fontMgrRenderMiniPreview(container, params) {
    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'fontmgr-style-preview-wrap';
    const back = document.createElement('div');
    back.className = 'fontmgr-style-preview-layer back';
    const front = document.createElement('div');
    front.className = 'fontmgr-style-preview-layer front';
    wrap.appendChild(back);
    wrap.appendChild(front);
    container.appendChild(wrap);
    _fontMgrRenderTextStylePreview(back, front, params);
}

function _fontAssetBuildCard(kind, item) {
    const card = document.createElement('div');
    card.className = 'asset-font-card';
    card.title = t('textTool.fontCardTitle');

    const thumb = document.createElement('div');
    thumb.className = 'asset-font-card-thumb';
    card.appendChild(thumb);

    const nameEl = document.createElement('div');
    nameEl.className = 'asset-font-card-name';
    nameEl.textContent = item.name;
    card.appendChild(nameEl);

    const baseParams = { text: 'Aa', size: 22 };
    if (kind === 'style') {
        // スタイルの見た目の違いを比較しやすいよう、サムネイルのフォントは統一する（プリセットは個別のフォントのまま）
        _fontMgrRenderMiniPreview(thumb, {
            ...baseParams,
            fontFamily: 'Zen Antique',
            fill: item.fill,
            strokeEnabled: item.strokeEnabled, strokeColor: item.strokeColor, strokeWidth: item.strokeWidth,
            italicEnabled: item.italicEnabled, underlineEnabled: item.underlineEnabled,
            bukuroEnabled: item.bukuroEnabled, bukuroColor: item.bukuroColor, bukuroWidth: item.bukuroWidth,
            shadowEnabled: item.shadowEnabled, shadowColor: item.shadowColor, shadowBlur: item.shadowBlur, shadowDx: item.shadowDx, shadowDy: item.shadowDy,
        });
    } else {
        const style = _fontMgrLoadStyles().find(s => s.id === item.styleId);
        _fontMgrRenderMiniPreview(thumb, {
            ...baseParams,
            fontFamily: item.fontFamily || 'sans-serif',
            fill: style?.fill || '#000000',
            strokeEnabled: !!style?.strokeEnabled, strokeColor: style?.strokeColor || '#ffffff', strokeWidth: style?.strokeWidth || 0,
            italicEnabled: !!style?.italicEnabled, underlineEnabled: !!style?.underlineEnabled,
            bukuroEnabled: !!style?.bukuroEnabled, bukuroColor: style?.bukuroColor || '#000000', bukuroWidth: style?.bukuroWidth || 0,
            shadowEnabled: !!style?.shadowEnabled, shadowColor: style?.shadowColor || '#000000', shadowBlur: style?.shadowBlur || 0, shadowDx: style?.shadowDx || 0, shadowDy: style?.shadowDy || 0,
        });
    }

    card.addEventListener('click', async () => {
        // Imageタブ: レイアウトのSVGテキストではなく、Imageタブのテキストレイヤーに適用/挿入する
        if (document.querySelector('.tab-btn.active')?.dataset.tab === 'image') {
            if (!window._ccImageTab) return;
            const styles = _fontMgrLoadStyles();
            if (window._ccImageTab.hasSelectedTextLayer()) {
                if (kind === 'style') window._ccImageTab.applyFontStyleToSelection(item);
                else window._ccImageTab.applyFontPresetToSelection(item, styles);
            } else {
                if (kind === 'style') window._ccImageTab.insertFontStylePlaceholder(item);
                else window._ccImageTab.insertFontPresetPlaceholder(item, styles);
            }
            return;
        }

        if (state.selectedTextEl) {
            if (kind === 'style') await applyStyleToSelectedText(item);
            else await applyPresetToSelectedText(item);
        } else {
            if (kind === 'style') await insertStylePlaceholderText(item);
            else await insertPresetPlaceholderText(item);
        }
    });
    return card;
}

// アセットパネル「フォント」タブ: 保存済みスタイル/プリセットをサムネ一覧表示
// 折りたたみ可能なグループ（スタイル/プリセット共通）。開閉状態はフォントタブの左パネルと同じ _fontMgrGroupOpen を共用する
function _fontAssetBuildGroup(key, label, items, kind) {
    if (!(key in _fontMgrGroupOpen)) _fontMgrGroupOpen[key] = true;
    const open = _fontMgrGroupOpen[key];

    const wrap = document.createElement('div');

    const header = document.createElement('div');
    header.className = 'fontmgr-cat-header';
    header.innerHTML = `<span class="fontmgr-group-arrow">${open ? '▾' : '▸'}</span><span class="fontmgr-group-label">${_esc(label)}</span><span class="fontmgr-group-count">${items.length}</span>`;
    wrap.appendChild(header);

    const itemsWrap = document.createElement('div');
    itemsWrap.className = 'asset-font-group-items';
    itemsWrap.style.display = open ? '' : 'none';
    items.forEach(item => itemsWrap.appendChild(_fontAssetBuildCard(kind, item)));
    wrap.appendChild(itemsWrap);

    header.addEventListener('click', () => _fontMgrToggleGroup(key, header.querySelector('.fontmgr-group-arrow'), itemsWrap));

    return wrap;
}

function renderAssetFontGrid() {
    const grid = document.getElementById('asset-font-grid');
    if (!grid) return;

    const styles = _fontMgrLoadStyles();
    const presets = _fontMgrLoadPresets();
    if (!styles.length && !presets.length) {
        grid.innerHTML = `<p class="empty-message">${t('asset.noFontStyles')}</p>`;
        return;
    }

    grid.innerHTML = '';
    if (styles.length) grid.appendChild(_fontAssetBuildGroup('assetfont:styles', t('font.styleLabel'), styles, 'style'));
    if (presets.length) grid.appendChild(_fontAssetBuildGroup('assetfont:presets', t('font.presetsLabel'), presets, 'preset'));
}

function updateBalloonPanelSelect() {
    const select = document.getElementById('balloon-panel-select');
    if (!select || !state.activePage || !state.activePage.panels) return;

    const currentId = state.selectedPanelId;
    select.innerHTML = `<option value="">${t('textTool.selectPanelOption')}</option>`;

    state.activePage.panels.forEach(panel => {
        const option = document.createElement('option');
        option.value = panel.id;
        option.textContent = t('common.panelName', panel.number);
        if (panel.id === currentId) option.selected = true;
        select.appendChild(option);
    });

    // オーバーレイオプション
    const overlayOpt = document.createElement('option');
    overlayOpt.value = '__overlay__';
    overlayOpt.textContent = t('common.overlayFull');
    if (state.selectedOverlay) overlayOpt.selected = true;
    select.appendChild(overlayOpt);
}

