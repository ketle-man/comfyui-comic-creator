// ============================================================
// main.js 分割ファイル (追加): コマへのフキダシ一括配置
// type="module" として読み込まれる。主なトップレベル定義: placePanelBalloons
//
// 半自動マンガ作成（26-auto-comic-bridge.js「フキダシを自動生成」）とAutoタブの
// オートレイアウト転送（28b-auto-layout-tab.js）が共通で使う。寸法計算は
// ../balloon-fit-core.js（DOM非依存）、ここはフキダシ要素の生成と文字の流し込みだけを担う。
// autoFit=true でセリフの量に合わせてフキダシと文字の大きさを決め、false で従来方式
// （コマを上から均等分割）にする。切り替えはAutoタブ設定の「フキダシと文字の大きさを
// セリフの量に合わせる」（auto-ai-client.js の balloonAutoFit）。
// ============================================================

import { createBalloonAtPosition } from './09c-balloon-handles.js';
import { applyBubbleTextToShape, _bubbleTextWrapLines } from './09f-bubble-text.js';
import { planPanelBalloons, legacyPanelBalloons } from '../balloon-fit-core.js';
// 09f-bubble-text.js の値はモジュール評価時に参照しないこと（main/*は循環importしており、
// トップレベルで触るとTDZのReferenceErrorでモジュール群の読み込みが止まる）。
// balloon-fit-core.js の PT_TO_SVG は 09f の BUBBLE_TEXT_PT_TO_SVG と同じ値を手で揃えている。

/**
 * 1コマ分のセリフをフキダシとして配置する（state.selectedPanelId は呼び出し側で対象コマにしておく）。
 * @param {SVGSVGElement} overlaySvgEl  getPanelLayerSvg() の結果
 * @param {{x,y,width,height}} bbox      コマの外接矩形
 * @param {Array<{text:string, shapeType:string}>} items  空のセリフは呼び出し側で除外しておく
 * @param {object} opts  { autoFit, maxFontPt, fontFamily, vertical, textColor, readingOrder }
 * @returns {Promise<{created:number, overflow:number}>} overflow = 最小の文字サイズでも収まらなかった数
 */
export async function placePanelBalloons(overlaySvgEl, bbox, items, opts) {
    if (!items.length) return { created: 0, overflow: 0 };
    const fontFamily = opts.fontFamily || 'BIZ UDPGothic';
    const plan = opts.autoFit
        ? planPanelBalloons(bbox, items, {
            maxFontPt: opts.maxFontPt,
            vertical: opts.vertical,
            readingOrder: opts.readingOrder,
            // 折り返しを入れない1行の幅＝09f側と同じcanvas実測
            measure: (s, fs) => _bubbleTextWrapLines(s, fontFamily, fs, Infinity, false).maxLineExtent,
        })
        : legacyPanelBalloons(bbox, items.length, opts.maxFontPt);

    let overflow = 0;
    for (let i = 0; i < items.length; i++) {
        const p = plan[i];
        const shape = createBalloonAtPosition(overlaySvgEl, items[i].shapeType, p.cx, p.cy, p.rx, p.ry);
        await applyBubbleTextToShape(shape, {
            text: items[i].text,
            fontSizePt: p.fontSizePt,
            textAlign: 'center',
            textValign: 'center',
            fontFamily,
            vertical: opts.vertical,
            textColor: opts.textColor,
        });
        if (p.overflow) overflow++;
    }
    return { created: items.length, overflow };
}
