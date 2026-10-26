// ============================================================
//  テキスト挿入 モーダル（レイアウトタブ／Imageタブのテキストツール共通）
//  「Insert」ボタンから開き、挿入元（スクリプトタブのセル / OCRタブの検出テキスト）を選ぶ。
//  OCRを選んだときは、フォントサイズを「領域サイズから自動換算」か「指定サイズ」から選べる。
//
//  公開API: openTextInsertModal({ ocrCount, sizeUnit, defaultSize, onScript, onOcr })
//    ocrCount    : OCRタブで取り込める本文の件数（0なら OCR は選べない）
//    sizeUnit    : 指定サイズの単位表示（'pt' | 'px'）
//    defaultSize : 指定サイズの初期値（保存済みの値が無いとき）
//    onScript    : () => void | Promise  スクリプト挿入
//    onOcr       : ({ sizeMode: 'auto'|'fixed', fixedSize: number, dir: 'auto'|'h'|'v' }) => void | Promise
//  選択内容は localStorage に保存して次回の初期値にする。
// ============================================================

import { t } from './i18n.js';

const STORE_KEY = 'ccc_text_insert_v1';

function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null') || {}; } catch (_) { return {}; }
}
function save(v) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch (_) { /* ignore */ }
}

export function openTextInsertModal(opts = {}) {
    const saved = load();
    const ocrCount = opts.ocrCount || 0;
    const unit = opts.sizeUnit || 'pt';
    const src0 = saved.src === 'ocr' && ocrCount ? 'ocr' : (saved.src === 'script' ? 'script' : (ocrCount ? 'ocr' : 'script'));

    const overlay = document.createElement('div');
    overlay.className = 'tsm-overlay';
    const dialog = document.createElement('div');
    dialog.className = 'tsm-dialog';
    dialog.style.cssText = 'width:440px; height:auto; max-height:90vh;';
    dialog.innerHTML = `
        <div class="tsm-header">
            <h3>${t('insert.title')}</h3>
            <button type="button" class="tsm-close-btn" data-act="close" title="${t('common.close')}">×</button>
        </div>
        <div style="padding:12px 16px; display:flex; flex-direction:column; gap:10px; font-size:13px;">
            <label><input type="radio" name="tim-src" value="script"> ${t('insert.srcScript')}</label>
            <label><input type="radio" name="tim-src" value="ocr" ${ocrCount ? '' : 'disabled'}> ${t('insert.srcOcr')}
                <span style="font-size:11px; opacity:.8;">${ocrCount ? t('insert.ocrCount', ocrCount) : t('insert.ocrNone')}</span></label>
            <div id="tim-ocr-opts" style="margin-left:22px; display:flex; flex-direction:column; gap:8px; padding:8px 10px; border:1px solid var(--border-color); border-radius:6px;">
                <label><input type="radio" name="tim-size" value="auto"> ${t('insert.sizeAuto')}</label>
                <label><input type="radio" name="tim-size" value="fixed"> ${t('insert.sizeFixed')}
                    <input type="number" id="tim-size" min="1" max="2000" step="1" style="width:70px;"> ${unit}</label>
                <label>${t('insert.dirLabel')}
                    <select id="tim-dir">
                        <option value="auto">${t('insert.dirAuto')}</option>
                        <option value="h">${t('insert.dirH')}</option>
                        <option value="v">${t('insert.dirV')}</option>
                    </select></label>
            </div>
        </div>
        <div class="tsm-footer" style="display:flex; justify-content:flex-end; gap:8px; padding:10px 16px; border-top:1px solid var(--border-color);">
            <button type="button" class="btn small secondary" data-act="close">${t('common.cancel')}</button>
            <button type="button" class="btn small" data-act="run">${t('insert.run')}</button>
        </div>`;
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const $q = (sel) => dialog.querySelector(sel);
    const radio = (name, v) => $q(`input[name="${name}"][value="${v}"]`);
    radio('tim-src', src0).checked = true;
    radio('tim-size', saved.sizeMode === 'fixed' ? 'fixed' : 'auto').checked = true;
    $q('#tim-size').value = saved.fixedSize || opts.defaultSize || 24;
    $q('#tim-dir').value = saved.dir || 'auto';

    const val = (name) => dialog.querySelector(`input[name="${name}"]:checked`)?.value;
    const sync = () => {
        const ocr = val('tim-src') === 'ocr';
        $q('#tim-ocr-opts').style.opacity = ocr ? '1' : '0.45';
        $q('#tim-ocr-opts').querySelectorAll('input,select').forEach(el => { el.disabled = !ocr || (el.id === 'tim-size' && val('tim-size') !== 'fixed'); });
    };
    dialog.addEventListener('change', sync);
    sync();

    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) close(); });

    dialog.addEventListener('click', async (e) => {
        const act = e.target.closest?.('[data-act]')?.dataset.act;
        if (act === 'close') { close(); return; }
        if (act !== 'run') return;
        const src = val('tim-src');
        const o = { sizeMode: val('tim-size') === 'fixed' ? 'fixed' : 'auto', fixedSize: Math.max(1, parseFloat($q('#tim-size').value) || 24), dir: $q('#tim-dir').value };
        save({ src, sizeMode: o.sizeMode, fixedSize: o.fixedSize, dir: o.dir });
        close();
        if (src === 'ocr') await opts.onOcr?.(o);
        else await opts.onScript?.();
    });
}
