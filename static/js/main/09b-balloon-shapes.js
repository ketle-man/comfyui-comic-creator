// ============================================================
// フキダシ管理 分割ファイル (2/5): フキダシ図形・パス生成(H2タイプ/爆発/思考雲/変形/PNG変換)
// 元 09-balloons.js（分割前）の行 600-1294 に相当
// type="module" として読み込まれる（ESモジュール化 G4）。09a〜09fは相互に密結合しており
// 循環importが多数発生するが、循環先シンボルの参照はすべて関数内部に閉じているため安全。
// 主なトップレベル定義: _h2ChainAllDescendants,_h2CleanupBalloonChainBeforeDelete,_h2RefreshChainAfterDelete,_h2_getBoundaryPoint,_h2_mulberry32,_showH2TypeParams,_updateH2ShapePath,circleToPath,generateBombPath,generateThoughtPath,getOrCreateClipGroup,getOrCreateOverlayGroup,renderPanelOverlays,saveOverlaySvg,selectOverlay,updateBalloonUI,updateShapePath
// （_h2ChainAllDescendants/_h2CleanupBalloonChainBeforeDelete/_h2RefreshChainAfterDeleteは機械抽出で
//  追加確認したシンボル。ヘッダコメントは元main.js分割時のもので非網羅）
// 未ESM化の外部依存（非moduleのグローバル関数はwindowプロパティとして自動的に見えるため、
// 呼び出し箇所は書き換えていない）: state（01-state.js）
// ============================================================

import { t } from '../i18n.js';
import { dbPut, _enqueueActivePageSave } from './00-db.js';
import { _collectReferencedFilters } from './07-pages.js';
import { updatePanelSelectDropdown, highlightOverlay, _syncDraftInteractivity } from './08-panels-images.js';
import { clearHandles } from './09c-balloon-handles.js';
import { updateBalloonPanelSelect } from './09e-text-tool.js';
import { _isBubbleTextType, _bubbleTextUpdateShape, _bubbleTextSyncH2Text } from './09f-bubble-text.js';
import { state } from './01-state.js';
import { renderLayerPanel } from './04b-layer-panel-render.js';
import { _clearObjectSelection } from './08-panels-images.js';
import { _subPanelSyncBorderWidthUI } from './24-sub-panels.js';

function _showH2TypeParams(type) {
    const panel = document.getElementById('h2-params-panel');
    const bombP    = document.getElementById('h2-bomb-params');
    const thoughtP = document.getElementById('h2-thought-params');
    const rectP    = document.getElementById('h2-rect-params');
    const cloudP   = document.getElementById('h2-cloud-params');
    const widthG   = document.getElementById('h2-tail-width-group');
    if (!panel) return;
    const isCloud = (type === 'cloudpuffy' || type === 'cloudwavy');
    const isH2 = (type === 'bomb' || type === 'thought' || type === 'normal' || type === 'rect' || isCloud);
    panel.style.display = isH2 ? 'flex' : 'none';
    if (bombP)   bombP.style.display   = (type === 'bomb')    ? 'flex' : 'none';
    if (thoughtP) thoughtP.style.display = (type === 'thought') ? 'flex' : 'none';
    if (rectP)   rectP.style.display   = (type === 'rect')    ? 'flex' : 'none';
    if (cloudP)  cloudP.style.display  = isCloud ? 'flex' : 'none';
    // thought タイプは幅スライダーが無意味なので非表示
    if (widthG) widthG.style.display = (type === 'thought') ? 'none' : 'contents';
}

function updateBalloonUI() {
    const textBtn = document.getElementById('toggle-text-btn');
    const editBtn = document.getElementById('toggle-edit-btn');
    const editText = document.getElementById('edit-mode-text');

    if (state.balloon.isTextMode) {
        if (textBtn) textBtn.classList.add('active');
    } else {
        if (textBtn) textBtn.classList.remove('active');
    }

    if (state.balloon.isEditMode) {
        if (editBtn) editBtn.classList.add('active');
        if (editText) editText.textContent = t('layout.editModeOn');
    } else {
        if (editBtn) editBtn.classList.remove('active');
        if (editText) editText.textContent = t('layout.editModeOff');
        // 編集モードOFF時はハンドルを消去し、選択を解除
        clearHandles();
        state.selectedShapeId = null;
    }

    // hitPolyのインタラクション設定
    const previewContainer = document.getElementById('layout-preview');
    if (!previewContainer) return;

    const hitPolys = previewContainer.querySelectorAll('.panel-hit-area');
    hitPolys.forEach(hp => {
        if (state.balloon.isTextMode) {
            hp.style.pointerEvents = 'all';
        } else {
            hp.style.pointerEvents = 'none';
        }
    });
    // テキストモード時はコマ選択polygonのクリックを無効化
    const panelOverlays = previewContainer.querySelectorAll('.panel-overlay');
    panelOverlays.forEach(po => {
        po.style.pointerEvents = state.balloon.isTextMode ? 'none' : 'auto';
    });

    // 統合SVG（#image-layer svg）の pointer-events / cursor をモードに応じて変更
    const panelSvg = previewContainer.querySelector('#image-layer svg');

    if (panelSvg) {
        if (state.balloon.isEditMode) {
            panelSvg.style.cursor = 'default';
            panelSvg.style.pointerEvents = 'none';
            panelSvg.querySelectorAll('.balloon-shape').forEach(s => s.style.pointerEvents = 'auto');
            panelSvg.querySelectorAll('.balloon-handle').forEach(h => h.style.pointerEvents = 'auto');
            panelSvg.querySelectorAll('.draw-shape').forEach(s => s.style.pointerEvents = 'auto');
            panelSvg.querySelectorAll('.draw-handle').forEach(h => h.style.pointerEvents = 'auto');
            panelSvg.querySelectorAll('.group-handle').forEach(h => h.style.pointerEvents = 'auto');
            panelSvg.querySelectorAll('.group-bbox').forEach(b => b.style.pointerEvents = 'all');
        } else if (state.balloon.isTextMode) {
            panelSvg.style.cursor = 'text';
            panelSvg.style.pointerEvents = 'all';
            panelSvg.querySelectorAll('text').forEach(t => t.style.pointerEvents = 'auto');
        } else {
            panelSvg.style.cursor = 'default';
            panelSvg.style.pointerEvents = 'none';
            panelSvg.querySelectorAll('.draw-shape').forEach(s => s.style.pointerEvents = 'auto');
            panelSvg.querySelectorAll('.draw-handle').forEach(h => h.style.pointerEvents = 'auto');
            panelSvg.querySelectorAll('.group-handle').forEach(h => h.style.pointerEvents = 'auto');
            panelSvg.querySelectorAll('.group-bbox').forEach(b => b.style.pointerEvents = 'all');
        }
    }
}

function renderPanelOverlays(panelSvgEl, overlaySvgEl) {
    if (!state.activePage || !state.activePage.panels) return;

    // panelSvgEl は視覚的な選択ハイライト表示のみ（pointer-events:none）
    panelSvgEl.querySelectorAll('.panel-indication').forEach(el => el.remove());

    // overlaySvgEl のクリックヒット領域（透明polygon）を再構築
    if (overlaySvgEl) {
        overlaySvgEl.querySelectorAll('.panel-hit-area').forEach(el => el.remove());
    }

    state.activePage.panels.forEach(panel => {
        // 視覚的ハイライト（panelSvgElに配置）
        const highlightPoly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        highlightPoly.setAttribute('points', panel.points);
        highlightPoly.setAttribute('class', 'panel-indication');
        highlightPoly.style.pointerEvents = 'none';

        if (state.selectedPanelId === panel.id) {
            highlightPoly.setAttribute('fill', 'rgba(0, 123, 255, 0.1)');
            highlightPoly.setAttribute('stroke', 'rgba(0, 123, 255, 0.8)');
            highlightPoly.setAttribute('stroke-width', '3');
            highlightPoly.setAttribute('stroke-dasharray', '5,5');
        } else {
            highlightPoly.setAttribute('fill', 'transparent');
            highlightPoly.setAttribute('stroke', 'none');
        }

        panelSvgEl.appendChild(highlightPoly);

        // クリックヒット領域（overlaySvgElに透明polygonを配置）
        // 描画モード: pointerEventsなし（overlaySvgElのmousedownが通る）
        // テキストモード: clickで座標を取得してダイアログを開く
        if (overlaySvgEl) {
            const hitPoly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            hitPoly.setAttribute('points', panel.points);
            hitPoly.setAttribute('class', 'panel-hit-area');
            hitPoly.setAttribute('fill', 'transparent');
            hitPoly.setAttribute('stroke', 'none');
            // 描画モードON: pointerEvents=noneでmousedownをoverlaySvgElが受け取れるようにする
            // テキストモードON: pointerEvents=allでクリックを受け取る
            // それ以外: none
            hitPoly.style.pointerEvents = state.balloon.isTextMode ? 'all' : 'none';
            hitPoly.style.cursor = 'crosshair';
            hitPoly.dataset.panelId = panel.id;

            overlaySvgEl.appendChild(hitPoly);
        }
    });
}

// オーバーレイg要素を取得または作成（最前面に配置）
// basePanelPoints があればclipPathを付与してページからはみ出さないようにする
function getOrCreateOverlayGroup(svgEl) {
    const overlayClipId = 'overlay-page-clip';
    const basePts = state.activePage && state.activePage.basePanelPoints;

    // defsにclipPathを追加（basePanelPointsがある場合のみ）
    if (basePts) {
        let defs = svgEl.querySelector('defs');
        if (!defs) {
            defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            svgEl.insertBefore(defs, svgEl.firstChild);
        }
        if (!defs.querySelector(`[id="${overlayClipId}"]`)) {
            const clipPath = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
            clipPath.setAttribute('id', overlayClipId);
            clipPath.setAttribute('clipPathUnits', 'userSpaceOnUse');
            const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            poly.setAttribute('points', basePts);
            clipPath.appendChild(poly);
            defs.appendChild(clipPath);
        }
    }

    let g = svgEl.querySelector('g[data-overlay-layer]');
    if (!g) {
        g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('data-overlay-layer', 'true');
        if (basePts) g.setAttribute('clip-path', `url(#${overlayClipId})`);
        svgEl.appendChild(g);
    }
    return g;
}

// オーバーレイSVGを保存
async function saveOverlaySvg(panelLayerSvgEl) {
    if (!state.activePage || !panelLayerSvgEl) return;

    // UIハンドル等を除去したクローンを作成
    const clone = panelLayerSvgEl.cloneNode(true);
    clone.querySelectorAll(
        '.panel-overlay, .panel-border, .panel-indication, .panel-hit-area, ' +
        '#balloon-hit-bg, .balloon-handle, .balloon-bbox, .balloon-rotate-line, ' +
        '.text-handle, .text-bbox, .text-rotate-line, ' +
        '.image-handle, .image-bbox, .image-rotate-line, ' +
        '.group-handle, .group-bbox, .group-rotate-line, ' +
        '.draw-handle, .draw-bbox, .draw-rotate-line'
    ).forEach(el => el.remove());
    clone.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));

    const ns = 'http://www.w3.org/2000/svg';
    const overlayDoc = document.implementation.createDocument(ns, 'svg', null);
    const overlaySvg = overlayDoc.documentElement;
    overlaySvg.setAttribute('xmlns', ns);
    const vb = panelLayerSvgEl.getAttribute('viewBox') || '0 0 21000 29700';
    overlaySvg.setAttribute('viewBox', vb);

    // basePanelPoints がある場合、clipPath定義をdefsに保存
    const basePts = state.activePage.basePanelPoints;
    const overlayClipId = 'overlay-page-clip';
    // オーバーレイのマスク定義（全面マスク＋オーバーレイ内オブジェクトのレイヤーマスク）も持ち回る
    const overlayMasks = [];
    clone.querySelectorAll('defs mask[data-ccc-mask]').forEach(m => {
        const t = m.getAttribute('data-ccc-mask');
        if (t === '__overlay__' || clone.querySelector(`g[data-overlay-layer] [id="${t}"]`)) {
            overlayMasks.push(m);
        }
    });
    if (basePts || overlayMasks.length) {
        const defs = overlayDoc.createElementNS(ns, 'defs');
        if (basePts) {
            const clipPath = overlayDoc.createElementNS(ns, 'clipPath');
            clipPath.setAttribute('id', overlayClipId);
            clipPath.setAttribute('clipPathUnits', 'userSpaceOnUse');
            const poly = overlayDoc.createElementNS(ns, 'polygon');
            poly.setAttribute('points', basePts);
            clipPath.appendChild(poly);
            defs.appendChild(clipPath);
        }
        overlayMasks.forEach(m => defs.appendChild(overlayDoc.importNode(m, true)));
        overlaySvg.appendChild(defs);
    }

    // オーバーレイg要素を収集
    const overlayG = clone.querySelector('g[data-overlay-layer]');
    if (overlayG && overlayG.children.length > 0) {
        const importedG = document.importNode(overlayG, true);
        // clip-path 属性を確実に設定
        if (basePts) importedG.setAttribute('clip-path', `url(#${overlayClipId})`);
        overlaySvg.appendChild(importedG);
    }

    // コンテンツが参照するフィルタ定義（袋文字・影のテキストスタイル等）も持ち回る
    _collectReferencedFilters(overlaySvg, clone.querySelector('defs'));

    const serializer = new XMLSerializer();
    let str = serializer.serializeToString(overlaySvg);
    if (!str.includes('xmlns="http://www.w3.org/2000/svg"')) {
        str = str.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    // state.activePageの読み取り〜反映は直列化キューを通す（他の並行保存との競合でこの変更が
    // 上書き消失するのを防ぐ。詳細は_enqueueActivePageSaveのコメント参照）
    await _enqueueActivePageSave(async () => {
        const updatedRecord = { ...state.activePage, overlaySvgContent: str };
        try {
            await dbPut('pages', updatedRecord, { deferThumb: true });
            state.activePage = updatedRecord;
            renderLayerPanel();
        } catch (e) {
            console.error('Overlay save error:', e);
        }
    });
}

// オーバーレイレイヤーを選択
function selectOverlay() {
    _clearObjectSelection();
    state.selectedPanelId = null;
    state.selectedOverlay = true;
    state.selectedDraft = false;
    updatePanelSelectDropdown();
    updateBalloonPanelSelect();
    renderLayerPanel();
    const svgEl = document.querySelector('#layout-preview svg, #text-preview svg');
    if (svgEl) {
        highlightOverlay(svgEl, null);
        _syncDraftInteractivity(svgEl);
    }
    _subPanelSyncBorderWidthUI();
}

function getOrCreateClipGroup(overlaySvgEl) {
    // オーバーレイ選択中はオーバーレイグループを返す
    if (state.selectedOverlay) {
        return getOrCreateOverlayGroup(overlaySvgEl);
    }
    if (state.selectedPanelId && state.selectedPanelId !== 'panel-0') {
        const clipId = `panel-clip-${state.selectedPanelId}`;
        let defs = overlaySvgEl.querySelector('defs');
        if (!defs) {
            defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            overlaySvgEl.insertBefore(defs, overlaySvgEl.firstChild);
        }

        let clipPath = overlaySvgEl.querySelector(`[id="${clipId}"]`);
        if (!clipPath) {
            const panel = state.activePage.panels.find(p => p.id === state.selectedPanelId);
            if (panel && panel.points) {
                clipPath = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
                clipPath.setAttribute('id', clipId);
                clipPath.setAttribute('clipPathUnits', 'userSpaceOnUse');
                const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                poly.setAttribute('points', panel.points);
                clipPath.appendChild(poly);
                defs.appendChild(clipPath);
            }
        }

        if (clipPath) {
            let g = overlaySvgEl.querySelector(`g[data-clip-panel="${state.selectedPanelId}"]`);
            if (!g) {
                g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                g.setAttribute('clip-path', `url(#${clipId})`);
                g.setAttribute('class', 'balloon-group');
                g.setAttribute('data-clip-panel', state.selectedPanelId);
                overlaySvgEl.appendChild(g);
            }
            return g;
        }
    }
    return overlaySvgEl;
}

// ------------------------------------------------------------
// 高機能フキダシ関連のユーティリティ
// ------------------------------------------------------------

// 円を近似する SVG path（4つの三次ベジェ）
function circleToPath(x, y, r) {
    const k = r * 0.5522847498; // (4/3)*tan(pi/8) の近似
    return `M ${x + r},${y}` +
           ` C ${x + r},${y - k} ${x + k},${y - r} ${x},${y - r}` +
           ` C ${x - k},${y - r} ${x - r},${y - k} ${x - r},${y}` +
           ` C ${x - r},${y + k} ${x - k},${y + r} ${x},${y + r}` +
           ` C ${x + k},${y + r} ${x + r},${y + k} ${x + r},${y}` +
           ` Z`;
}

// 楕円座標系（rx,ry）で角度を計算するヘルパー
// 楕円を円に正規化して角度を求め、楕円のパラメータ角（θ）に変換する
// tailAngleElliptic: 楕円の中心から見た「実際の方向角」→ 楕円パラメータ角θに変換
// hukidasi2 互換: シード付き疑似乱数
function _h2_mulberry32(a) {
    return function() {
        var t = a += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// hukidasi2 互換: 楕円/角丸矩形の境界点を取得（bomb/thoughtで使用）
function _h2_getBoundaryPoint(type, rx, ry, angleRad, rectRadius) {
    let erx = rx, ery = ry, useType = type;
    if (useType === 'normal' || useType === 'thought') {
        const r = (erx * ery) / Math.sqrt(Math.pow(ery * Math.cos(angleRad), 2) + Math.pow(erx * Math.sin(angleRad), 2));
        return { x: r * Math.cos(angleRad), y: r * Math.sin(angleRad), r };
    } else if (useType === 'rect') {
        let normTheta = ((angleRad % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        let qTheta = normTheta;
        if (qTheta > Math.PI / 2 && qTheta <= Math.PI) qTheta = Math.PI - qTheta;
        else if (qTheta > Math.PI && qTheta <= Math.PI * 3 / 2) qTheta = qTheta - Math.PI;
        else if (qTheta > Math.PI * 3 / 2) qTheta = Math.PI * 2 - qTheta;
        const cos = Math.cos(qTheta), sin = Math.sin(qTheta);
        const radius = Math.min(rectRadius || 20, erx, ery);
        let t = 0;
        if (cos < 0.0001) t = ery;
        else if (sin < 0.0001) t = erx;
        else {
            const t1 = ery / sin;
            if (t1 * cos <= erx - radius) t = t1;
            else {
                const t2 = erx / cos;
                if (t2 * sin <= ery - radius) t = t2;
                else {
                    const ccx = erx - radius, ccy = ery - radius;
                    const b2 = -2 * (ccx * cos + ccy * sin);
                    const cc = ccx * ccx + ccy * ccy - radius * radius;
                    const dd = b2 * b2 - 4 * cc;
                    t = dd >= 0 ? (-b2 + Math.sqrt(dd)) / 2 : Math.min(t1, t2);
                }
            }
        }
        return { x: t * Math.cos(normTheta), y: t * Math.sin(normTheta), r: t };
    }
    const r = (erx * ery) / Math.sqrt(Math.pow(ery * Math.cos(angleRad), 2) + Math.pow(erx * Math.sin(angleRad), 2));
    return { x: r * Math.cos(angleRad), y: r * Math.sin(angleRad), r };
}

// hukidasi2 互換: bomb (バクダン/ギザギザ) パス生成
// params: { cx, cy, rx, ry, tailAngleDeg, tailLength, tailWidth(半角度deg), tailCurve, seed, spikeCount, spikeLevel, spikeVariance, borderWidth }
function generateBombPath(params) {
    const { cx, cy, rx, ry, tailAngleDeg, tailLength, tailWidth, tailCurve, seed, spikeCount, spikeLevel, spikeVariance, borderWidth } = params;
    const rng = _h2_mulberry32(seed || 1);
    const numSpikes = spikeCount || 24;
    const levelScale = (spikeLevel !== undefined ? spikeLevel : 30) / 100;
    const varScale = (spikeVariance !== undefined ? spikeVariance : 30) / 100;

    // 本体ポリゴン点生成
    const points = [];
    for (let i = 0; i < numSpikes; i++) {
        const angle1 = (i / numSpikes) * Math.PI * 2;
        const r1 = 1.0 - (levelScale * 0.3 * (1.0 - rng() * varScale));
        points.push({ x: cx + rx * r1 * Math.cos(angle1), y: cy + ry * r1 * Math.sin(angle1) });
        const angle2 = ((i + 0.5) / numSpikes) * Math.PI * 2;
        const r2 = 1.0 + (levelScale * 0.5 * (1.0 - rng() * varScale));
        points.push({ x: cx + rx * r2 * Math.cos(angle2), y: cy + ry * r2 * Math.sin(angle2) });
    }

    // 尻尾パス
    const tailAngleRad = (tailAngleDeg || 0) * Math.PI / 180;
    const baseScale = 1.0 - (levelScale * 0.3);
    const bpTip = _h2_getBoundaryPoint('bomb_base', rx * baseScale, ry * baseScale, tailAngleRad);
    const tipX = cx + bpTip.x + (tailLength || 60) * Math.cos(tailAngleRad);
    const tipY = cy + bpTip.y + (tailLength || 60) * Math.sin(tailAngleRad);

    const normalRad = tailAngleRad + Math.PI / 2;
    const curveOX = Math.cos(normalRad) * (tailCurve || 0);
    const curveOY = Math.sin(normalRad) * (tailCurve || 0);
    const sx = cx + bpTip.x, sy = cy + bpTip.y;
    const _cx = (sx + tipX) / 2 + curveOX;
    const _cy = (sy + tipY) / 2 + curveOY;

    const tailHalfAngle = ((tailWidth || 13) / 2) * Math.PI / 180;
    const b1Rad = tailAngleRad - tailHalfAngle;
    const b2Rad = tailAngleRad + tailHalfAngle;
    // 尻尾の付け根を本体の内側にどれだけ食い込ませるか。本体と尻尾は別々のpath要素として
    // 縁取りを描画しているため、この食い込みが枠線の太さ(borderWidth)より浅いと、
    // 尻尾が細いほど接合部の縁取りが噛み合わず隙間（細い線）が見えてしまう
    const overlap = Math.max(2, (borderWidth || 0) + 2);
    const bp1 = _h2_getBoundaryPoint('bomb_base', rx * baseScale, ry * baseScale, b1Rad);
    const bp2 = _h2_getBoundaryPoint('bomb_base', rx * baseScale, ry * baseScale, b2Rad);
    const b1 = { x: cx + Math.max(0, bp1.r - overlap) * Math.cos(b1Rad), y: cy + Math.max(0, bp1.r - overlap) * Math.sin(b1Rad) };
    const b2 = { x: cx + Math.max(0, bp2.r - overlap) * Math.cos(b2Rad), y: cy + Math.max(0, bp2.r - overlap) * Math.sin(b2Rad) };
    // 制御点 = b1b2中点 + 法線オフセット（サイズ変更でb1/b2と一緒に追従）
    // 本体パス
    let bodyPath = `M ${points[0].x},${points[0].y}`;
    for (let i = 1; i < points.length; i++) bodyPath += ` L ${points[i].x},${points[i].y}`;
    bodyPath += ' Z';

    // 尻尾パス（tailCurve=0なら直線）
    let tailPath;
    if ((tailCurve || 0) === 0) {
        tailPath = `M ${b1.x},${b1.y} L ${tipX},${tipY} L ${b2.x},${b2.y} Z`;
    } else {
        const bMidX = (b1.x + b2.x) / 2, bMidY = (b1.y + b2.y) / 2;
        const cx1 = bMidX + curveOX, cy1 = bMidY + curveOY;
        tailPath = `M ${b1.x},${b1.y} Q ${cx1},${cy1} ${tipX},${tipY} Q ${cx1},${cy1} ${b2.x},${b2.y} Z`;
    }

    return { bodyPath, tailPath };
}

// hukidasi2 互換: thought (思考/泡) パス生成
// params: { cx, cy, rx, ry, tailAngleDeg, tailLength, tailCurve, thoughtBubbleSize, thoughtBubbleCount, thoughtBubbleOffset }
function generateThoughtPath(params) {
    const { cx, cy, rx, ry, tailAngleDeg, tailLength, tailCurve, thoughtBubbleSize, thoughtBubbleCount, thoughtBubbleOffset } = params;
    // 泡の数（直接指定）。1個なら本体すぐそばに最大サイズの泡のみ
    const count = Math.max(1, Math.round(thoughtBubbleCount ?? 5));
    // 本体から泡を離す度合い（%、100=標準、0=本体境界に埋もれる、200=標準の2倍離す）
    const offsetRatio = (thoughtBubbleOffset ?? 100) / 100;
    const tailAngleRad = (tailAngleDeg || 0) * Math.PI / 180;

    // 本体楕円パス
    const kx = rx * 0.5522847498, ky = ry * 0.5522847498;
    const bodyPath = `M ${cx + rx},${cy}` +
        ` C ${cx + rx},${cy - ky} ${cx + kx},${cy - ry} ${cx},${cy - ry}` +
        ` C ${cx - kx},${cy - ry} ${cx - rx},${cy - ky} ${cx - rx},${cy}` +
        ` C ${cx - rx},${cy + ky} ${cx - kx},${cy + ry} ${cx},${cy + ry}` +
        ` C ${cx + kx},${cy + ry} ${cx + rx},${cy + ky} ${cx + rx},${cy} Z`;

    // 尻尾: 泡列
    const len = tailLength || 60;
    // thoughtBubbleSize = 最大泡半径（本体側の泡）
    const minR = 5;
    const maxR = thoughtBubbleSize || 800;

    // 境界点（本体側起点）
    const bpTip = _h2_getBoundaryPoint('normal', rx, ry, tailAngleRad);
    const sx = cx + bpTip.x, sy = cy + bpTip.y;
    const tipX = sx + len * Math.cos(tailAngleRad);
    const tipY = sy + len * Math.sin(tailAngleRad);

    // カーブ制御点
    const normalRad = tailAngleRad + Math.PI / 2;
    const curveOX = Math.cos(normalRad) * (tailCurve || 0);
    const curveOY = Math.sin(normalRad) * (tailCurve || 0);
    // 制御点 = 本体境界点と先端の中点 + 法線オフセット（thoughtは幅ポイントがないため中点ベース）
    const qcx = (sx + tipX) / 2 + curveOX;
    const qcy = (sy + tipY) / 2 + curveOY;

    // ベジェ曲線上の点（t=0: 先端, t=1: 本体側）
    const bezPt = (t) => {
        const omt = 1 - t;
        return {
            x: omt * omt * tipX + 2 * omt * t * qcx + t * t * sx,
            y: omt * omt * tipY + 2 * omt * t * qcy + t * t * sy,
        };
    };

    // 曲線上の弧長を積分して、弧長に対する均等割りでcount個の泡を配置する
    // （ベジェのtパラメータをそのまま均等割りすると曲率の強い部分で偏るため、弧長ベースにする）
    const STEPS = 200; // 弧長積分の分割数
    const arcTable = [{ t: 0, len: 0 }];
    let totalArc = 0;
    let prevPt = bezPt(0);
    for (let i = 1; i <= STEPS; i++) {
        const t = i / STEPS;
        const pt = bezPt(t);
        totalArc += Math.hypot(pt.x - prevPt.x, pt.y - prevPt.y);
        arcTable.push({ t, len: totalArc });
        prevPt = pt;
    }
    // 弧長 → t 変換
    const arcToT = (arcLen) => {
        if (arcLen <= 0) return 0;
        if (arcLen >= totalArc) return 1;
        let lo = 0, hi = arcTable.length - 1;
        while (lo < hi - 1) {
            const mid = (lo + hi) >> 1;
            if (arcTable[mid].len < arcLen) lo = mid; else hi = mid;
        }
        const a = arcTable[lo], b = arcTable[hi];
        const frac = (arcLen - a.len) / (b.len - a.len);
        return a.t + frac * (b.t - a.t);
    };

    // 先端(i=0, 最小サイズ)から本体側(i=count-1, 最大サイズ)へ、弧長上に均等配置
    // t=1は本体の輪郭線ちょうど上の点のため、そのまま円を置くと本体に埋もれる。
    // 本体に近い（tが大きい）泡ほど尻尾方向へ半径分押し出し、本体の外側に完全に出す
    let circlePaths = '';
    for (let i = 0; i < count; i++) {
        const arcFrac = count === 1 ? 1 : i / (count - 1);
        const t = arcToT(arcFrac * totalArc);
        const bp = bezPt(t);
        const r = minR + (maxR - minR) * t;
        const px = bp.x + r * t * offsetRatio * Math.cos(tailAngleRad);
        const py = bp.y + r * t * offsetRatio * Math.sin(tailAngleRad);
        const kr = r * 0.5522847498;
        circlePaths += ` M ${px + r},${py}` +
            ` C ${px + r},${py - kr} ${px + kr},${py - r} ${px},${py - r}` +
            ` C ${px - kr},${py - r} ${px - r},${py - kr} ${px - r},${py}` +
            ` C ${px - r},${py + kr} ${px - kr},${py + r} ${px},${py + r}` +
            ` C ${px + kr},${py + r} ${px + r},${py + kr} ${px + r},${py} Z`;
    }

    return { bodyPath: bodyPath + circlePaths, tailPath: '' };
}


// 雲(なみなみ)の輪郭上の1点を、本体パス生成(generateCloudWavyPath)と全く同じ式で計算する。
// 尻尾の付け根をこの関数で求めることで、近似の楕円ではなく実際に描画される輪郭線上に
// 正確に乗せられる（本体と尻尾が分離して見える隙間を防ぐ）。戻り値はcx,cy基準のローカル座標
function _cloudWavyPointAt(rx, ry, shapeCount, shapeAmplitude, shapeVariation, seed, theta) {
    const rng = _h2_mulberry32(seed || 1);
    const bumps  = Math.max(6, Math.min(60, Math.round(shapeCount || 18)));
    const amp01  = Math.max(0, Math.min(1, (shapeAmplitude ?? 55) / 100));
    const irr    = Math.max(0, Math.min(1, (shapeVariation ?? 0) / 100));
    const bumps2 = Math.max(3, Math.round(bumps * 0.6));
    const phase  = 0.7;
    const amp    = 0.22 * amp01;

    let wgt = 1.0;
    if (irr > 0) {
        const weights = [];
        for (let i = 0; i < bumps; i++) weights.push(1.0 + irr * 0.35 * (rng() * 2 - 1));
        const u = (theta / (Math.PI * 2)) * bumps;
        const norm = ((u % bumps) + bumps) % bumps;
        const i0 = Math.floor(norm) % bumps;
        const frac = norm - Math.floor(norm);
        const i1 = (i0 + 1) % bumps;
        wgt = weights[i0] * (1 - frac) + weights[i1] * frac;
    }

    const base = 0.65 * Math.sin(bumps * theta) + 0.35 * Math.sin(bumps2 * theta + phase);
    let rmod = 1 + amp * wgt * base;
    rmod = Math.max(0.35, rmod);

    // バンプによるはみ出しを吸収するため楕円半径を86%に縮小（参照ノードと同じ比率）
    const erx = rx * 0.86, ery = ry * 0.86;
    const x = erx * rmod * Math.cos(theta);
    const y = ery * rmod * Math.sin(theta);
    return { x, y, r: Math.hypot(x, y) };
}

// hukidasi2 互換: 雲(なみなみ) パス生成。参考ノード comfyUI-TextOverlayAndBubbles の
// _cloud_mask_wavy を移植。楕円を2つの正弦波(θ*bumps と θ*bumps2+phase)で半径変調し、
// 輪郭全体が滑らかに波打つ雲アウトラインにする。
// params: { cx, cy, rx, ry, shapeCount, shapeAmplitude(0-100), shapeVariation(0-100), seed }
function generateCloudWavyPath(params) {
    const { cx, cy, rx, ry, shapeCount, shapeAmplitude, shapeVariation, seed } = params;
    const n = 180;
    let bodyPath = '';
    for (let i = 0; i < n; i++) {
        const theta = (i / n) * Math.PI * 2;
        const p = _cloudWavyPointAt(rx, ry, shapeCount, shapeAmplitude, shapeVariation, seed, theta);
        const x = cx + p.x, y = cy + p.y;
        bodyPath += (i === 0 ? `M ${x},${y}` : ` L ${x},${y}`);
    }
    bodyPath += ' Z';
    return { bodyPath };
}

// 雲(もこもこ)の輪郭上の1点を、本体パス生成(generateCloudPuffyPath)と全く同じ式で計算する。
// _cloudWavyPointAt と同じ理由で、尻尾の付け根を実際の輪郭線上に正確に乗せるために使う。
// 戻り値はcx,cy基準のローカル座標
function _cloudPuffyPointAt(rx, ry, shapeCount, shapeAmplitude, shapeVariation, seed, theta) {
    const rng = _h2_mulberry32(seed || 1);
    const bumps = Math.max(6, Math.min(60, Math.round(shapeCount || 18)));
    const amp01 = Math.max(0, Math.min(1, (shapeAmplitude ?? 55) / 100));
    const irr   = Math.max(0, Math.min(1, (shapeVariation ?? 0) / 100));

    const rBase = Math.max(2, Math.min(rx, ry) * 0.35 * amp01);
    const rList = [];
    for (let i = 0; i < bumps; i++) rList.push(rBase * (1 + irr * 0.35 * (rng() * 2 - 1)));
    const rMax = rList.reduce((m, r) => Math.max(m, r), 0);
    const offBase = rMax * 0.38;

    // バンプ分の余白を差し引いた内側の楕円（もこもこの土台）。極端な値でも潰れないよう下限を設ける
    let a = rx - (rMax + offBase) - rx * 0.02;
    let b = ry - (rMax + offBase) - ry * 0.02;
    if (a < rx * 0.25 || b < ry * 0.25) { a = rx * 0.25; b = ry * 0.25; }

    // 楕円周を等弧長でbumps分割し、各分割点の外向き法線方向にバンプ中心をオフセット配置する
    const dense = 360;
    const pts = [];
    const cum = [0];
    let prevX = a, prevY = 0;
    for (let i = 0; i <= dense; i++) {
        const th = (i / dense) * Math.PI * 2;
        const x = a * Math.cos(th), y = b * Math.sin(th);
        pts.push({ x, y });
        if (i > 0) cum.push(cum[cum.length - 1] + Math.hypot(x - prevX, y - prevY));
        prevX = x; prevY = y;
    }
    const total = cum[cum.length - 1];

    const bumpCenters = [];
    let j = 0;
    for (let k = 0; k < bumps; k++) {
        const target = (k * total) / bumps;
        while (j < cum.length - 2 && cum[j + 1] < target) j++;
        const d0 = cum[j], d1 = cum[j + 1];
        const frac = d1 === d0 ? 0 : (target - d0) / (d1 - d0);
        const p0 = pts[j], p1 = pts[j + 1];
        const x = p0.x + (p1.x - p0.x) * frac;
        const y = p0.y + (p1.y - p0.y) * frac;
        let nx = x / (a * a), ny = y / (b * b);
        const nlen = Math.hypot(nx, ny) || 1;
        nx /= nlen; ny /= nlen;
        const off = offBase * (1 + irr * 0.2 * (rng() * 2 - 1));
        bumpCenters.push({ x: x + nx * off, y: y + ny * off, r: rList[k] });
    }

    // 中心(0,0基準)からの光線が各図形と交わる遠い方の交点距離の最大値を輪郭半径とする
    const dx = Math.cos(theta), dy = Math.sin(theta);
    let r = (a * b) / Math.sqrt((b * dx) * (b * dx) + (a * dy) * (a * dy));
    for (const bc of bumpCenters) {
        const ox = -bc.x, oy = -bc.y;
        const b1 = ox * dx + oy * dy;
        const c1 = ox * ox + oy * oy - bc.r * bc.r;
        const disc = b1 * b1 - c1;
        if (disc < 0) continue;
        const t = -b1 + Math.sqrt(disc);
        if (t > r) r = t;
    }
    return { x: r * dx, y: r * dy, r };
}

// 境界点計算の共通ヘルパー。cloudpuffy/cloudwavyは実際の輪郭関数(_cloudXxxPointAt)に委譲し、
// それ以外は従来通り _h2_getBoundaryPoint に委譲する。尻尾の付け根・尻尾ハンドル・カーブハンドルの
// いずれもこの関数を経由することで、フキダシ本体の見た目の輪郭と常に一致する
function _h2BoundaryPointFor(el, angleRad) {
    const type = el.dataset.shapeType;
    const rx = parseFloat(el.dataset.rx), ry = parseFloat(el.dataset.ry);
    if (type === 'cloudpuffy' || type === 'cloudwavy') {
        const pointAt = type === 'cloudpuffy' ? _cloudPuffyPointAt : _cloudWavyPointAt;
        return pointAt(
            rx, ry,
            parseFloat(el.dataset.shapeCount || 18),
            parseFloat(el.dataset.shapeAmplitude ?? 55),
            parseFloat(el.dataset.shapeVariation ?? 0),
            parseInt(el.dataset.seed || 1),
            angleRad
        );
    }
    const bpType = type === 'rect' ? 'rect' : 'normal';
    const bpR = type === 'rect' ? Math.min(parseFloat(el.dataset.rectRadius || 80), rx, ry) : undefined;
    return _h2_getBoundaryPoint(bpType, rx, ry, angleRad, bpR);
}

// 原点(originX,originY)から単位方向ベクトル(dirX,dirY)へ伸びるレイが、シェイプelの輪郭を
// 抜ける距離(tMinより遠い側の交点)を、輪郭上のサンプリング＋二分探索で近似的に求める。
// elの形状は任意（楕円/角丸矩形/雲）でよく、_h2BoundaryPointFor経由で境界半径を判定するため
// 個別の交差式を持たない形状にも汎用的に対応できる。一度も交差しなければnullを返す。
function _h2RayExitDistance(el, originX, originY, dirX, dirY, tMin) {
    const ecx = parseFloat(el.dataset.cx), ecy = parseFloat(el.dataset.cy);
    const eAngle = parseFloat(el.dataset.angle || 0) * Math.PI / 180;
    const erx = parseFloat(el.dataset.rx), ery = parseFloat(el.dataset.ry);
    const maxReach = tMin + Math.hypot(ecx - originX, ecy - originY) + Math.max(erx, ery) * 2;

    const isInside = (t) => {
        const px = originX + dirX * t, py = originY + dirY * t;
        // シェイプのローカル座標系（無回転）へ変換してから境界半径と比較する
        const lx0 = px - ecx, ly0 = py - ecy;
        const cosA = Math.cos(-eAngle), sinA = Math.sin(-eAngle);
        const lx = lx0 * cosA - ly0 * sinA;
        const ly = lx0 * sinA + ly0 * cosA;
        const r = Math.hypot(lx, ly);
        if (r === 0) return true;
        const boundary = _h2BoundaryPointFor(el, Math.atan2(ly, lx)).r;
        return r <= boundary;
    };

    const STEPS = 60;
    let lastInsideIdx = -1;
    for (let i = 0; i <= STEPS; i++) {
        const t = tMin + (maxReach - tMin) * (i / STEPS);
        if (isInside(t)) lastInsideIdx = i;
    }
    if (lastInsideIdx === -1) return null; // レイが一度もこのシェイプの内側に入らない＝交差しない

    // 内側だった最後のサンプルと、その次(外側)のサンプルの間を二分探索で精緻化する
    let loT = tMin + (maxReach - tMin) * (lastInsideIdx / STEPS);
    let hiT = lastInsideIdx < STEPS ? tMin + (maxReach - tMin) * ((lastInsideIdx + 1) / STEPS) : maxReach;
    for (let i = 0; i < 20; i++) {
        const midT = (loT + hiT) / 2;
        if (isInside(midT)) loT = midT; else hiT = midT;
    }
    return loT;
}

// フキダシelの尻尾（ローカル角度angleRad方向）の実効境界点を求める。elが延長フキダシを
// 持つ場合、その方向にある延長フキダシまでレイをマーチングし、より外側（延長側）の輪郭上に
// 境界点を再配置することで、フキダシ同士が連結・重なっていても尻尾を延長側の外周まで
// 動かせるようにする（Comic Lifeの「尻尾が延長を含めた外周で動く」挙動に合わせるため）。
// 延長を持たない場合や、その方向に延長が無い場合は通常どおり自身の境界点をそのまま返す。
function _h2TailBoundaryPoint(el, angleRad) {
    const bp = _h2BoundaryPointFor(el, angleRad);
    const exts = document.querySelectorAll(`.balloon-shape[data-linked-to-id="${CSS.escape(el.id)}"]`);
    if (exts.length === 0) return bp;

    const cx = parseFloat(el.dataset.cx), cy = parseFloat(el.dataset.cy);
    const elAngleRad = parseFloat(el.dataset.angle || 0) * Math.PI / 180;
    // ローカル角度angleRadを、自身の回転を反映した絶対方向ベクトルに変換する
    const dirX = Math.cos(angleRad) * Math.cos(elAngleRad) - Math.sin(angleRad) * Math.sin(elAngleRad);
    const dirY = Math.cos(angleRad) * Math.sin(elAngleRad) + Math.sin(angleRad) * Math.cos(elAngleRad);

    let maxR = bp.r;
    exts.forEach(ext => {
        const t = _h2RayExitDistance(ext, cx, cy, dirX, dirY, maxR);
        if (t !== null && t > maxR) maxR = t;
    });
    if (maxR === bp.r) return bp;
    return { x: Math.cos(angleRad) * maxR, y: Math.sin(angleRad) * maxR, r: maxR };
}

// hukidasi2 互換: 雲(もこもこ) パス生成。参考ノードの _cloud_mask_scalloped を移植。
// 内側の楕円 + その周囲に等弧長で配置した円(バンプ)群の和集合を、中心からの光線と
// (楕円 or 各バンプ円)の遠い方の交点距離の最大値として輪郭を近似する
// （SVGにはブーリアン和がないため、放射状サンプリングで輪郭を再構成する）。
function generateCloudPuffyPath(params) {
    const { cx, cy, rx, ry, shapeCount, shapeAmplitude, shapeVariation, seed } = params;
    const n = 240;
    let bodyPath = '';
    for (let i = 0; i < n; i++) {
        const theta = (i / n) * Math.PI * 2;
        const p = _cloudPuffyPointAt(rx, ry, shapeCount, shapeAmplitude, shapeVariation, seed, theta);
        const x = cx + p.x, y = cy + p.y;
        bodyPath += (i === 0 ? `M ${x},${y}` : ` L ${x},${y}`);
    }
    bodyPath += ' Z';
    return { bodyPath };
}

function updateShapePath(el) {
    _updateH2ShapePath(el);
}

// parentの子要素の中から、targetNodes（ベース・延長のシェイプ要素群）のうちDOM順で最初に
// 現れるものを返す。ネックのコネクタや連結の共有リングは、この要素の直前（＝すぐ奥）に
// 配置することで、画像挿入やレイヤーパネルでの重ね順変更によって別のオブジェクトが
// ベース・延長の間に割り込んでも、常に両シェイプのすぐ下に留まり続ける（間に挟まった
// オブジェクトに隠されて見えなくなることを防ぐ）。見つからなければnullを返す。
function _h2ChainAnchorNode(parent, targetNodes) {
    const targetSet = new Set(targetNodes);
    for (const child of parent.children) {
        if (targetSet.has(child)) return child;
    }
    return null;
}

// elから data-linked-to-id を辿り、連結チェーンの最上位（リンク元を持たない）ベース要素を
// 返す。親→子→孫のように何段連結されていても最上位まで遡る（1段しか見ないと、孫フキダシの
// 場合に「子」を誤ってベース扱いしてしまい、共有リングが親+子・子+孫の2つに分裂して継ぎ目が
// 出る不具合があった）。途中でベースが見つからない（削除済み等）場合や循環参照はnullを返す
function _h2ChainRootEl(el) {
    let cur = el;
    const visited = new Set([el.id]);
    while (cur.dataset.linkedToId) {
        const parent = document.getElementById(cur.dataset.linkedToId);
        if (!parent || visited.has(parent.id)) return null;
        visited.add(parent.id);
        cur = parent;
    }
    return cur;
}

// rootElを起点に、data-linked-to-id で直接・間接に連なる延長フキダシ（子・孫・ひ孫...）を
// 再帰的にすべて収集して返す（rootEl自身は含まない）。共有リング・ネック追従・連結削除など
// 「見た目上ひとつながりのチェーン全体」を扱う箇所は、直接の子だけを見る実装だと孫以降が
// 漏れるため、このヘルパーに一本化する
function _h2ChainAllDescendants(rootEl) {
    const result = [];
    const queue = [rootEl];
    const visited = new Set([rootEl.id]);
    while (queue.length) {
        const cur = queue.shift();
        document.querySelectorAll(`.balloon-shape[data-linked-to-id="${CSS.escape(cur.id)}"]`).forEach(ext => {
            if (visited.has(ext.id)) return;
            visited.add(ext.id);
            result.push(ext);
            queue.push(ext);
        });
    }
    return result;
}

// 延長フキダシ（dataset.linkedToId でベースを参照する balloon-shape）とベースを結ぶ
// ネック（コネクタ）を描画・更新する。ベース/延長どちらの子要素でもない独立したpath要素として
// 両シェイプより手前（DOM順で前）に配置し、両者の現在位置から毎回パスを再構築することで、
// どちらを動かしても常に境界点同士が正しくつながった見た目になる。
function _updateBalloonConnector(extEl) {
    const svgEl = extEl.ownerSVGElement || extEl.closest('svg');
    if (!svgEl) return;
    const baseId = extEl.dataset.linkedToId;
    const baseEl = baseId ? document.getElementById(baseId) : null;

    if (!baseEl) {
        // ベースが見つからない（削除済み等）: 孤立したコネクタを除去
        svgEl.querySelector(`.balloon-connector-fill[data-connector-for="${CSS.escape(extEl.id)}"]`)?.remove();
        svgEl.querySelector(`.balloon-connector-border[data-connector-for="${CSS.escape(extEl.id)}"]`)?.remove();
        return;
    }

    const cx1 = parseFloat(baseEl.dataset.cx), cy1 = parseFloat(baseEl.dataset.cy);
    const cx2 = parseFloat(extEl.dataset.cx),  cy2 = parseFloat(extEl.dataset.cy);
    const angle1 = parseFloat(baseEl.dataset.angle || 0) * Math.PI / 180;
    const angle2 = parseFloat(extEl.dataset.angle  || 0) * Math.PI / 180;

    // 絶対座標系での中心間方向角
    const globalAngle = Math.atan2(cy2 - cy1, cx2 - cx1);

    // 各シェイプのローカル座標系（無回転）での境界点を求め、自身の回転角で絶対座標に変換する
    const boundaryAbs = (el, cx, cy, angleRad, dirAngleGlobal) => {
        const localAngle = dirAngleGlobal - angleRad;
        const bp = _h2BoundaryPointFor(el, localAngle);
        return {
            x: cx + bp.x * Math.cos(angleRad) - bp.y * Math.sin(angleRad),
            y: cy + bp.x * Math.sin(angleRad) + bp.y * Math.cos(angleRad),
            localAngle,
        };
    };
    // 開口幅（半角、既存の尻尾のtailWidthに相当）とその方向での境界点を、指定した中心角から
    // +-halfAngle 分ずらして計算するヘルパー
    const sideBoundaryAbs = (el, cx, cy, angleRad, dirAngleGlobal, halfAngle, overlap) => {
        const p1 = boundaryAbs(el, cx, cy, angleRad, dirAngleGlobal - halfAngle);
        const p2 = boundaryAbs(el, cx, cy, angleRad, dirAngleGlobal + halfAngle);
        const shrink = (bpLocalAngle, px, py) => {
            const bp = _h2BoundaryPointFor(el, bpLocalAngle);
            const r = bp.r > 0 ? Math.max(0, bp.r - overlap) / bp.r : 0;
            const lx = bp.x * r, ly = bp.y * r;
            return {
                x: cx + lx * Math.cos(angleRad) - ly * Math.sin(angleRad),
                y: cy + lx * Math.sin(angleRad) + ly * Math.cos(angleRad),
            };
        };
        return {
            b1: shrink(p1.localAngle, p1.x, p1.y),
            b2: shrink(p2.localAngle, p2.x, p2.y),
        };
    };

    const baseHalfAngle = (parseFloat(baseEl.dataset.tailWidth || 13) / 2) * Math.PI / 180;
    const extHalfAngle  = (parseFloat(extEl.dataset.tailWidth  || 13) / 2) * Math.PI / 180;
    // コネクタは本体・尻尾のような二層(境界線+塗り)構造を持たず単独のstroke+fillのため、
    // ベース/延長の不透明な本体（後から描画されて手前に来る）に確実に隠れるよう、通常の
    // 尻尾の食い込み量（borderWidth+2）よりも深く食い込ませて、鋭角の頂点でstrokeのmiter結合が
    // 外側にはみ出しても本体の内側に収まるようにする
    const overlap = Math.max(2, parseFloat(baseEl.dataset.borderWidth || 3) * 2 + 4);

    const baseSide = sideBoundaryAbs(baseEl, cx1, cy1, angle1, globalAngle, baseHalfAngle, overlap);
    const extSide  = sideBoundaryAbs(extEl,  cx2, cy2, angle2, globalAngle + Math.PI, extHalfAngle, overlap);

    // ネックの太さがゼロ（同一地点）になるのを避ける最小の緩やかな膨らみを、中点法線方向に付与する
    const midX = (cx1 + cx2) / 2, midY = (cy1 + cy2) / 2;
    const normalAngle = globalAngle + Math.PI / 2;
    const dist = Math.hypot(cx2 - cx1, cy2 - cy1);
    const bulge = Math.min(dist * 0.12, 40);
    const c1x = midX + Math.cos(normalAngle) * bulge, c1y = midY + Math.sin(normalAngle) * bulge;
    const c2x = midX - Math.cos(normalAngle) * bulge, c2y = midY - Math.sin(normalAngle) * bulge;

    // 塗り(閉じた蝶ネクタイ形)と縁取り(自由端の2曲線のみ)を別要素に分ける。
    // 縁取りをフキダシ本体との接合部(b1_base〜b2_base間、b1_ext〜b2_ext間)まで含めて
    // 閉じたstrokeにすると、その部分がフキダシの内側に食い込んでいても輪郭線として
    // 見えてしまう（重なり部分に余計な線が出る原因）。接合部は塗りのみで覆い、実際に
    // 露出する自由端の2曲線だけをオープンパスとしてstrokeすることで、フキダシと重なる
    // 部分には一切線を描かず、外周として見える部分にだけ線を引く。
    const fillPath =
        `M ${baseSide.b1.x},${baseSide.b1.y}` +
        ` Q ${c1x},${c1y} ${extSide.b2.x},${extSide.b2.y}` +
        ` L ${extSide.b1.x},${extSide.b1.y}` +
        ` Q ${c2x},${c2y} ${baseSide.b2.x},${baseSide.b2.y}` +
        ` Z`;
    const borderPath =
        `M ${baseSide.b1.x},${baseSide.b1.y} Q ${c1x},${c1y} ${extSide.b2.x},${extSide.b2.y}` +
        ` M ${extSide.b1.x},${extSide.b1.y} Q ${c2x},${c2y} ${baseSide.b2.x},${baseSide.b2.y}`;

    let connectorFill = svgEl.querySelector(`.balloon-connector-fill[data-connector-for="${CSS.escape(extEl.id)}"]`);
    let connectorBorder = svgEl.querySelector(`.balloon-connector-border[data-connector-for="${CSS.escape(extEl.id)}"]`);
    if (!connectorFill) {
        connectorFill = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        connectorFill.setAttribute('class', 'balloon-connector-fill');
        connectorFill.dataset.connectorFor = extEl.id;
        connectorFill.style.pointerEvents = 'none';
        connectorBorder = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        connectorBorder.setAttribute('class', 'balloon-connector-border');
        connectorBorder.dataset.connectorFor = extEl.id;
        connectorBorder.setAttribute('fill', 'none');
        connectorBorder.style.pointerEvents = 'none';
    }
    {
        // ベース・延長どちらより奥（DOM順で先）にあるかは、画像挿入やレイヤーの重ね順変更で
        // 変わり得るため、固定位置（parent先頭）ではなく毎回「ベース/延長のうちDOM順で
        // 先に来る方の直前」を計算し直して配置する。他のオブジェクトがベース/延長の間に
        // 割り込んで挿入されても、ネックが必ず両シェイプの直下（すぐ奥）に留まり、
        // 間に挟まった別オブジェクトに隠されて見えなくなることを防ぐ
        const parent = baseEl.parentNode;
        if (parent) {
            const anchor = _h2ChainAnchorNode(parent, [baseEl, extEl]);
            parent.insertBefore(connectorFill, anchor || parent.firstChild);
            parent.insertBefore(connectorBorder, connectorFill.nextSibling);
        }
    }
    connectorFill.setAttribute('d', fillPath);
    connectorFill.setAttribute('fill', baseEl.dataset.fillColor || '#ffffff');

    const bw = parseFloat(baseEl.dataset.borderWidth || 3);
    connectorBorder.setAttribute('d', borderPath);
    connectorBorder.setAttribute('stroke', bw === 0 ? 'none' : (baseEl.dataset.strokeColor || '#000000'));
    connectorBorder.setAttribute('stroke-width', bw);
    connectorBorder.setAttribute('stroke-linejoin', 'round');
    connectorBorder.setAttribute('stroke-linecap', 'round');
}

// hukidasi2 互換タイプ（bomb/thought/normal）の描画更新
// el: balloon-shape クラスを持つ <g> 要素
function _updateH2ShapePath(el) {
    const type = el.dataset.shapeType;

    // シンプル版フキダシ+内包テキスト（09f-bubble-text.js）は尻尾のない別構造のため、
    // 専用の更新関数に委譲してここでは何もしない
    if (typeof _isBubbleTextType === 'function' && _isBubbleTextType(type)) {
        _bubbleTextUpdateShape(el);
        return;
    }

    const cx = parseFloat(el.dataset.cx);
    const cy = parseFloat(el.dataset.cy);
    const rx = parseFloat(el.dataset.rx);
    const ry = parseFloat(el.dataset.ry);
    const tailAngleDeg = parseFloat(el.dataset.tailAngleDeg || 45);
    const tailLength   = parseFloat(el.dataset.tailLength   || 60);
    const tailWidth    = parseFloat(el.dataset.tailWidth    || 13);
    const tailCurve    = el.dataset.tailCurveOn === '1' ? parseFloat(el.dataset.tailCurve || 0) : 0;
    const angle        = parseFloat(el.dataset.angle        || 0);
    const borderWidth  = parseFloat(el.dataset.borderWidth  || 3);
    const fillColor    = el.dataset.fillColor  || '#ffffff';
    const strokeColor  = el.dataset.strokeColor || '#000000';

    // 本体サイズをビューボックス比で調整
    const svgEl = el.ownerSVGElement;

    let bodyPath, tailPath;
    if (type === 'bomb') {
        const result = generateBombPath({
            cx, cy, rx, ry, tailAngleDeg, tailLength, tailWidth, tailCurve, borderWidth,
            seed:          parseInt(el.dataset.seed || 1),
            spikeCount:    parseInt(el.dataset.spikeCount || 24),
            spikeLevel:    parseFloat(el.dataset.spikeLevel || 30),
            spikeVariance: parseFloat(el.dataset.spikeVariance || 30),
        });
        bodyPath = result.bodyPath;
        tailPath = result.tailPath;
    } else if (type === 'thought') {
        const result = generateThoughtPath({
            cx, cy, rx, ry, tailAngleDeg, tailLength, tailCurve,
            thoughtBubbleSize:   parseFloat(el.dataset.thoughtBubbleSize || 800),
            thoughtBubbleCount:  parseFloat(el.dataset.thoughtBubbleCount ?? 5),
            thoughtBubbleOffset: parseFloat(el.dataset.thoughtBubbleOffset ?? 100),
        });
        bodyPath = result.bodyPath;
        tailPath = '';
    } else if (type === 'rect') {
        // 角丸矩形 + 尻尾（hukidasi2.html rect方式）
        const rectRadius = parseFloat(el.dataset.rectRadius || 80);
        const r = Math.min(rectRadius, rx, ry);
        // 角丸矩形の本体pathを生成
        const x0 = cx - rx, y0 = cy - ry, w = rx * 2, h = ry * 2;
        bodyPath = `M ${x0 + r},${y0}` +
            ` L ${x0 + w - r},${y0} Q ${x0 + w},${y0} ${x0 + w},${y0 + r}` +
            ` L ${x0 + w},${y0 + h - r} Q ${x0 + w},${y0 + h} ${x0 + w - r},${y0 + h}` +
            ` L ${x0 + r},${y0 + h} Q ${x0},${y0 + h} ${x0},${y0 + h - r}` +
            ` L ${x0},${y0 + r} Q ${x0},${y0} ${x0 + r},${y0} Z`;
        // 尻尾
        const tailAngleRad = tailAngleDeg * Math.PI / 180;
        const normalRad    = tailAngleRad + Math.PI / 2;
        const bpTip = _h2TailBoundaryPoint(el, tailAngleRad);
        const tipX  = cx + bpTip.x + tailLength * Math.cos(tailAngleRad);
        const tipY  = cy + bpTip.y + tailLength * Math.sin(tailAngleRad);
        const halfAngleRad = (tailWidth / 2) * Math.PI / 180;
        const b1Rad = tailAngleRad - halfAngleRad;
        const b2Rad = tailAngleRad + halfAngleRad;
        // 尻尾の付け根を本体の内側にどれだけ食い込ませるか。本体と尻尾は別々のpath要素として
    // 縁取りを描画しているため、この食い込みが枠線の太さ(borderWidth)より浅いと、
    // 尻尾が細いほど接合部の縁取りが噛み合わず隙間（細い線）が見えてしまう
    const overlap = Math.max(2, borderWidth + 2);
        // 延長フキダシがその方向にある場合、_h2TailBoundaryPointが延長側の外周まで
        // 境界点を延長するため、尻尾（付け根・先端とも）が連結先の外周まで動かせるようになる
        const bp1 = _h2TailBoundaryPoint(el, b1Rad);
        const bp2 = _h2TailBoundaryPoint(el, b2Rad);
        const b1 = { x: cx + Math.max(0, bp1.r - overlap) * Math.cos(b1Rad), y: cy + Math.max(0, bp1.r - overlap) * Math.sin(b1Rad) };
        const b2 = { x: cx + Math.max(0, bp2.r - overlap) * Math.cos(b2Rad), y: cy + Math.max(0, bp2.r - overlap) * Math.sin(b2Rad) };
        // 制御点 = b1b2中点 + 法線オフセット（tailCurve=0なら直線）
        if (tailCurve === 0) {
            tailPath = `M ${b1.x},${b1.y} L ${tipX},${tipY} L ${b2.x},${b2.y} Z`;
        } else {
            const bMidX = (b1.x + b2.x) / 2, bMidY = (b1.y + b2.y) / 2;
            const curveOX = Math.cos(normalRad) * tailCurve;
            const curveOY = Math.sin(normalRad) * tailCurve;
            const cx1 = bMidX + curveOX, cy1 = bMidY + curveOY;
            tailPath = `M ${b1.x},${b1.y} Q ${cx1},${cy1} ${tipX},${tipY} Q ${cx1},${cy1} ${b2.x},${b2.y} Z`;
        }
    } else if (type === 'cloudpuffy' || type === 'cloudwavy') {
        // 雲フキダシ: 本体は専用の輪郭生成関数、尻尾はnormalタイプと同じ滑らかな三角形。
        // 尻尾の付け根は本体パス生成と同じ関数(_cloudWavyPointAt/_cloudPuffyPointAt)で
        // 実際の輪郭線上の点を直接求める（近似の楕円ではなく実輪郭に正確に合わせることで、
        // 本体と尻尾が分離して見える隙間を防ぐ）
        const tailAngleRad = tailAngleDeg * Math.PI / 180;
        const normalRad    = tailAngleRad + Math.PI / 2;
        const halfAngleRad = (tailWidth / 2) * Math.PI / 180;
        const b1Rad = tailAngleRad - halfAngleRad;
        const b2Rad = tailAngleRad + halfAngleRad;
        const overlap = Math.max(2, borderWidth + 2);

        // 延長フキダシがその方向にある場合、_h2TailBoundaryPointが延長側の外周まで
        // 境界点を延長するため、尻尾（付け根・先端とも）が連結先の外周まで動かせるようになる
        const bpTip = _h2TailBoundaryPoint(el, tailAngleRad);
        const tipX  = cx + bpTip.x + tailLength * Math.cos(tailAngleRad);
        const tipY  = cy + bpTip.y + tailLength * Math.sin(tailAngleRad);

        // 尻尾の付け根を本体の内側に食い込ませる（自身の中心方向に沿って縮める。
        // 実輪郭上の点は真の極角とパラメトリック角がずれることがあるため、
        // b1Rad方向へ再投影せず、その点自身の方向ベクトルをそのまま縮小する）
        const bp1 = _h2TailBoundaryPoint(el, b1Rad);
        const bp2 = _h2TailBoundaryPoint(el, b2Rad);
        const scale1 = bp1.r > 0 ? Math.max(0, bp1.r - overlap) / bp1.r : 0;
        const scale2 = bp2.r > 0 ? Math.max(0, bp2.r - overlap) / bp2.r : 0;
        const b1 = { x: cx + bp1.x * scale1, y: cy + bp1.y * scale1 };
        const b2 = { x: cx + bp2.x * scale2, y: cy + bp2.y * scale2 };

        const cloudParams = {
            cx, cy, rx, ry,
            shapeCount:     parseFloat(el.dataset.shapeCount || 18),
            shapeAmplitude: parseFloat(el.dataset.shapeAmplitude ?? 55),
            shapeVariation: parseFloat(el.dataset.shapeVariation ?? 0),
            seed:           parseInt(el.dataset.seed || 1),
        };
        const cloudResult = type === 'cloudpuffy' ? generateCloudPuffyPath(cloudParams) : generateCloudWavyPath(cloudParams);
        bodyPath = cloudResult.bodyPath;

        if (tailCurve === 0) {
            tailPath = `M ${b1.x},${b1.y} L ${tipX},${tipY} L ${b2.x},${b2.y} Z`;
        } else {
            const bMidX = (b1.x + b2.x) / 2, bMidY = (b1.y + b2.y) / 2;
            const curveOX = Math.cos(normalRad) * tailCurve;
            const curveOY = Math.sin(normalRad) * tailCurve;
            const cx1 = bMidX + curveOX, cy1 = bMidY + curveOY;
            tailPath = `M ${b1.x},${b1.y} Q ${cx1},${cy1} ${tipX},${tipY} Q ${cx1},${cy1} ${b2.x},${b2.y} Z`;
        }
    } else {
        // normal: 楕円 + 尻尾（hukidasi2方式）
        const tailAngleRad = tailAngleDeg * Math.PI / 180;
        const normalRad    = tailAngleRad + Math.PI / 2;
        // 延長フキダシがその方向にある場合、_h2TailBoundaryPointが延長側の外周まで
        // 境界点を延長するため、尻尾（付け根・先端とも）が連結先の外周まで動かせるようになる
        const bpTip = _h2TailBoundaryPoint(el, tailAngleRad);
        const tipX  = cx + bpTip.x + tailLength * Math.cos(tailAngleRad);
        const tipY  = cy + bpTip.y + tailLength * Math.sin(tailAngleRad);
        const halfAngleRad = (tailWidth / 2) * Math.PI / 180;
        const b1Rad = tailAngleRad - halfAngleRad;
        const b2Rad = tailAngleRad + halfAngleRad;
        // 尻尾の付け根を本体の内側にどれだけ食い込ませるか。本体と尻尾は別々のpath要素として
    // 縁取りを描画しているため、この食い込みが枠線の太さ(borderWidth)より浅いと、
    // 尻尾が細いほど接合部の縁取りが噛み合わず隙間（細い線）が見えてしまう
        const overlap = Math.max(2, borderWidth + 2);
        const bp1 = _h2TailBoundaryPoint(el, b1Rad);
        const bp2 = _h2TailBoundaryPoint(el, b2Rad);
        const b1 = { x: cx + Math.max(0, bp1.r - overlap) * Math.cos(b1Rad), y: cy + Math.max(0, bp1.r - overlap) * Math.sin(b1Rad) };
        const b2 = { x: cx + Math.max(0, bp2.r - overlap) * Math.cos(b2Rad), y: cy + Math.max(0, bp2.r - overlap) * Math.sin(b2Rad) };
        // 本体楕円
        const kx = rx * 0.5522847498, ky = ry * 0.5522847498;
        bodyPath = `M ${cx + rx},${cy}` +
            ` C ${cx + rx},${cy - ky} ${cx + kx},${cy - ry} ${cx},${cy - ry}` +
            ` C ${cx - kx},${cy - ry} ${cx - rx},${cy - ky} ${cx - rx},${cy}` +
            ` C ${cx - rx},${cy + ky} ${cx - kx},${cy + ry} ${cx},${cy + ry}` +
            ` C ${cx + kx},${cy + ry} ${cx + rx},${cy + ky} ${cx + rx},${cy} Z`;
        // 制御点 = b1b2中点 + 法線オフセット（tailCurve=0なら直線）
        if (tailCurve === 0) {
            tailPath = `M ${b1.x},${b1.y} L ${tipX},${tipY} L ${b2.x},${b2.y} Z`;
        } else {
            const bMidX = (b1.x + b2.x) / 2, bMidY = (b1.y + b2.y) / 2;
            const curveOX = Math.cos(normalRad) * tailCurve;
            const curveOY = Math.sin(normalRad) * tailCurve;
            const cx1 = bMidX + curveOX, cy1 = bMidY + curveOY;
            tailPath = `M ${b1.x},${b1.y} Q ${cx1},${cy1} ${tipX},${tipY} Q ${cx1},${cy1} ${b2.x},${b2.y} Z`;
        }
    }

    // 既存の子要素を更新（bg-border/fg-fillが既にあれば更新、なければ作成）
    const ns = 'http://www.w3.org/2000/svg';
    let bgBody = el.querySelector('.h2-bg-body');
    let bgTail = el.querySelector('.h2-bg-tail');
    let fgBody = el.querySelector('.h2-fg-body');
    let fgTail = el.querySelector('.h2-fg-tail');

    if (!bgBody) {
        // 初回作成
        const layerBorder = document.createElementNS(ns, 'g');
        layerBorder.setAttribute('class', 'h2-layer-border');
        layerBorder.setAttribute('stroke-linejoin', 'round');
        bgBody = document.createElementNS(ns, 'path');
        bgBody.setAttribute('class', 'h2-bg-body');
        bgTail = document.createElementNS(ns, 'path');
        bgTail.setAttribute('class', 'h2-bg-tail');
        layerBorder.append(bgBody, bgTail);

        const layerFill = document.createElementNS(ns, 'g');
        layerFill.setAttribute('class', 'h2-layer-fill');
        layerFill.setAttribute('stroke', 'none');
        fgBody = document.createElementNS(ns, 'path');
        fgBody.setAttribute('class', 'h2-fg-body');
        fgTail = document.createElementNS(ns, 'path');
        fgTail.setAttribute('class', 'h2-fg-tail');
        layerFill.append(fgBody, fgTail);

        el.append(layerBorder, layerFill);
    }

    // パスを更新
    bgBody.setAttribute('d', bodyPath);
    bgTail.setAttribute('d', tailPath || '');
    fgBody.setAttribute('d', bodyPath);
    fgTail.setAttribute('d', tailPath || '');

    // 色・枠線
    const sw = borderWidth * 2; // border/fillで相殺して実質borderWidthになる
    // 延長フキダシで連結されているシェイプ（自身がベースで延長を持つ、または自身が延長）は、
    // 個別の枠線をそのまま出すと共有リング（_updateChainUnionRing）と二重に見えたり、
    // フキダシ同士が重なった箇所で内部に余計な線が出たりするため、自身の枠線は非表示にし、
    // 連結全体の外周だけをリングとして描画する（fill-layerは通常どおり内側を白く塗る）
    const hasChainPartners = !!el.dataset.linkedToId ||
        !!document.querySelector(`.balloon-shape[data-linked-to-id="${CSS.escape(el.id)}"]`);
    const borderLayerEl = el.querySelector('.h2-layer-border');
    if (hasChainPartners) {
        borderLayerEl.setAttribute('stroke', 'none');
        borderLayerEl.setAttribute('fill', 'none');
    } else {
        borderLayerEl.setAttribute('stroke-width', sw);
        borderLayerEl.setAttribute('stroke', borderWidth === 0 ? 'none' : strokeColor);
        borderLayerEl.setAttribute('fill', strokeColor);
    }
    el.querySelector('.h2-layer-fill').setAttribute('fill', fillColor);

    // 回転
    if (angle !== 0) {
        el.setAttribute('transform', `rotate(${angle},${cx},${cy})`);
    } else {
        el.removeAttribute('transform');
    }

    // 内包テキスト（09f-bubble-text.js）: データがあれば同期、無ければ何もしない
    if (typeof _bubbleTextSyncH2Text === 'function') _bubbleTextSyncH2Text(el);

    // 延長フキダシ連結: 自身が延長なら自分のコネクタを、自分がベースの延長を持っていれば
    // それらのコネクタ・チェーン共有リングも合わせて再計算する（リサイズ・回転・本体移動・
    // 尻尾ドラッグ等、このシェイプの見た目が変わるすべての経路がここを通るため、
    // この一箇所で追従を担保できる）。共有リングは_h2ChainAnchorNodeで求めた位置の直前に
    // 挿入されるため、必ずリング→ネックの順で呼び出す（ネックを先に呼ぶと、後から挿入される
    // リングがネックより手前＝ネックを隠す位置に来てしまう）
    const chainRootEl = el.dataset.linkedToId ? _h2ChainRootEl(el) : el;
    if (chainRootEl) {
        _updateChainUnionRing(chainRootEl);
        if (el.dataset.linkedToId) _updateBalloonConnector(el);
        // 孫・ひ孫まで含めたチェーン全体ぶんのネックを再計算する（直接の子だけでは
        // 親→子→孫のような多段連結で孫側のネックが取り残される）
        _h2ChainAllDescendants(chainRootEl).forEach(ext => {
            if (ext !== el) _updateBalloonConnector(ext);
        });
    } else if (el.dataset.linkedToId) {
        // chainRootElが見つからない（ベース削除済み等）場合でも、孤立コネクタの
        // クリーンアップ自体は_updateBalloonConnector内で行われるため呼び出しておく
        _updateBalloonConnector(el);
    }
}

// フキダシelを削除する直前に呼ぶ後始末。elがベースなら道連れの延長・そのネック・
// 共有リング/マスクを、elが延長ならel自身の分のネックを削除する。呼び出し元（レイヤーパネルの
// ✕ボタン、Delete/Backspaceキーの2箇所）で削除方法が違っても同じ後始末になるよう共通化した
// （2026-07-30発覚: レイヤーパネルの✕ボタンがこの処理を経由しない独自の削除コードを持っていた
// ため、ネック・共有リングが消し忘れられ、削除後もフキダシ形状の黒塗り・矩形などの
// ゴミが残ったまま保存されてしまう不具合があった）。
// 戻り値: elがdata-linked-to-idを持てばそのベースのid（呼び出し元はel.remove()の後に
// _h2RefreshChainAfterDeleteへ渡すこと）、無ければnull
function _h2CleanupBalloonChainBeforeDelete(el) {
    const linkedToId = el.dataset.linkedToId || null;
    // 直接の延長だけでなく孫・ひ孫まで道連れ削除する（途中のフキダシを削除した際に
    // その先の延長が孤立して残ってしまうのを防ぐ）
    _h2ChainAllDescendants(el).forEach(ext => {
        document.querySelector(`.balloon-connector-fill[data-connector-for="${CSS.escape(ext.id)}"]`)?.remove();
        document.querySelector(`.balloon-connector-border[data-connector-for="${CSS.escape(ext.id)}"]`)?.remove();
        document.getElementById(`chain-ring-${ext.id}`)?.remove();
        document.getElementById(`chain-mask-${ext.id}`)?.remove();
        if (state.selectedShapeId === ext.id) { state.selectedShapeId = null; clearHandles(); }
        state.checkedLayerEls.delete(ext);
        ext.remove();
    });
    document.querySelector(`.balloon-connector-fill[data-connector-for="${CSS.escape(el.id)}"]`)?.remove();
    document.querySelector(`.balloon-connector-border[data-connector-for="${CSS.escape(el.id)}"]`)?.remove();
    document.getElementById(`chain-ring-${el.id}`)?.remove();
    document.getElementById(`chain-mask-${el.id}`)?.remove();
    return linkedToId;
}

// _h2CleanupBalloonChainBeforeDelete と対になる後始末。削除された延長のベースを再描画し、
// 枠線表示・共有リングを現在の延長数に合わせて更新する（延長が0になれば通常の個別枠線に
// 戻り、まだ延長が残っていれば共有リングを残り数分で作り直す）。呼び出し元はel.remove()の
// 「後」にこれを呼ぶこと（削除前だとクエリに削除対象自身が残ってしまう）
function _h2RefreshChainAfterDelete(linkedToId) {
    if (!linkedToId) return;
    const baseEl = document.getElementById(linkedToId);
    if (baseEl) _updateH2ShapePath(baseEl);
}

// 延長フキダシで連結されたベース+延長群（チェーン）の外周のみを1本のリングとして描画する。
// 各メンバー自身の個別の枠線は_updateH2ShapePath側で非表示にし、代わりにこの共有リングだけを
// 表示することで、フキダシ同士が重なっていても内部に余計な境界線が出ないようにする。
// SVGにはパスの論理和(union)が無いため、<mask mask-type="alpha">に各メンバーの本体・尻尾パスを
// 複製して集め（枠線太さ分だけ外側に膨らませる）、その合成シルエットでstrokeColorの矩形を
// 型抜きする。各メンバー自身のfill-layer（内側の白塗り、通常どおり描画される）がその上に
// 重なることで、結果的に連結全体の外周だけが細いリングとして見える。
function _updateChainUnionRing(baseEl) {
    const svgEl = baseEl.ownerSVGElement || baseEl.closest('svg');
    if (!svgEl) return;
    const ringId = `chain-ring-${baseEl.id}`;
    const maskId = `chain-mask-${baseEl.id}`;
    const exts = _h2ChainAllDescendants(baseEl);

    if (exts.length === 0) {
        // 延長が無くなった場合、共有リングは不要（ベースは通常の個別枠線に戻る）
        svgEl.querySelector(`#${CSS.escape(ringId)}`)?.remove();
        svgEl.querySelector(`#${CSS.escape(maskId)}`)?.remove();
        return;
    }

    const members = [baseEl, ...exts];

    let defs = svgEl.querySelector('defs');
    if (!defs) {
        defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        svgEl.insertBefore(defs, svgEl.firstChild);
    }

    let mask = defs.querySelector(`#${CSS.escape(maskId)}`);
    if (!mask) {
        mask = document.createElementNS('http://www.w3.org/2000/svg', 'mask');
        mask.id = maskId;
        mask.setAttribute('mask-type', 'alpha');
        // savePanelSvg/saveOverlaySvg は data-ccc-mask 属性が付いた<mask>だけをdefsに持ち回る
        // （それ以外は保存対象の抽出SVGに含まれず消えてしまう）。既存のレイヤーマスク機構
        // （04a-mask-core.js）と同じ規約に合わせ、値にはベースのidを指定する（保存側は
        // 「その値と同じidの要素がコマ/オーバーレイ内に存在するか」で判定するため、
        // ベース自身のidを指定すれば必ず一致する）
        mask.setAttribute('data-ccc-mask', baseEl.id);
        defs.appendChild(mask);
    }
    mask.innerHTML = '';
    members.forEach(m => {
        const bw = parseFloat(m.dataset.borderWidth || 3);
        const angle = parseFloat(m.dataset.angle || 0);
        const mcx = parseFloat(m.dataset.cx), mcy = parseFloat(m.dataset.cy);
        ['h2-bg-body', 'h2-bg-tail'].forEach(cls => {
            const src = m.querySelector(`.${cls}`);
            const d = src && src.getAttribute('d');
            if (!d) return;
            const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            p.setAttribute('d', d);
            p.setAttribute('fill', '#fff');
            if (bw > 0) {
                p.setAttribute('stroke', '#fff');
                p.setAttribute('stroke-width', bw * 2);
                p.setAttribute('stroke-linejoin', 'round');
            }
            if (angle) p.setAttribute('transform', `rotate(${angle},${mcx},${mcy})`);
            mask.appendChild(p);
        });
    });

    let ring = svgEl.querySelector(`#${CSS.escape(ringId)}`);
    if (!ring) {
        ring = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        ring.id = ringId;
        ring.style.pointerEvents = 'none';
    }
    // ページ全面ではなく、チェーン各メンバーの外接矩形＋余白に限定する（保存時にmask定義が
    // 何らかの理由で失われた場合でも、maskなしで描画される事故の被害をこの範囲に留めるため）
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    members.forEach(m => {
        const mcx = parseFloat(m.dataset.cx), mcy = parseFloat(m.dataset.cy);
        const mrx = parseFloat(m.dataset.rx), mry = parseFloat(m.dataset.ry);
        const pad = Math.max(mrx, mry) * 0.5 + parseFloat(m.dataset.borderWidth || 3) * 2;
        const reach = Math.max(mrx, mry) + pad;
        minX = Math.min(minX, mcx - reach); maxX = Math.max(maxX, mcx + reach);
        minY = Math.min(minY, mcy - reach); maxY = Math.max(maxY, mcy + reach);
    });
    ring.setAttribute('x', minX);
    ring.setAttribute('y', minY);
    ring.setAttribute('width', Math.max(1, maxX - minX));
    ring.setAttribute('height', Math.max(1, maxY - minY));
    ring.setAttribute('fill', baseEl.dataset.strokeColor || '#000000');
    ring.setAttribute('mask', `url(#${maskId})`);
    // 各メンバー本体より必ず奥に描画されるようにする。ただし固定で最背面（parent先頭）に
    // 置くと、画像挿入やレイヤーパネルでの重ね順変更で他のオブジェクトがリングとメンバーの
    // 間に割り込み、リングがそのオブジェクトに隠されて見えなくなる（2026-07-30発覚の不具合）。
    // 呼び出しのたびに「メンバーのうちDOM順で最初に現れるものの直前」を計算し直して
    // 配置することで、間に他オブジェクトが挟まっても常にメンバーのすぐ奥に留まるようにする
    const parent = baseEl.parentNode;
    if (parent) {
        const anchor = _h2ChainAnchorNode(parent, members);
        parent.insertBefore(ring, anchor || parent.firstChild);
    }
}

// フキダシ or 図形要素をPNG画像に変換して同位置に複製挿入する
// 実装は convertShapeToImage（09c-balloon-handles.js、読み込み順が後のため実際に有効になる定義）を参照

export {
    _cloudPuffyPointAt, _cloudWavyPointAt, _h2BoundaryPointFor, _h2ChainAllDescendants,
    _h2ChainAnchorNode, _h2ChainRootEl, _h2CleanupBalloonChainBeforeDelete, _h2RayExitDistance,
    _h2RefreshChainAfterDelete, _h2TailBoundaryPoint, _h2_getBoundaryPoint, _h2_mulberry32,
    _showH2TypeParams, _updateBalloonConnector, _updateChainUnionRing, _updateH2ShapePath,
    circleToPath, generateBombPath, generateCloudPuffyPath, generateCloudWavyPath, generateThoughtPath,
    getOrCreateClipGroup, getOrCreateOverlayGroup, renderPanelOverlays, saveOverlaySvg, selectOverlay,
    updateBalloonUI, updateShapePath,
};

// まだESM化されていない main/以下の classic <script> から呼べるようにするブリッジ
// （ESモジュール化移行中の一時措置。全分割ファイルのESM化が完了したら、
//  各呼び出し元をimport文に置き換えてこのブロックごと削除する）。
