// OCRタブ / MOSS-Imageタブのステージ用ズーム。
// 外枠(wrap)は高さ固定のスクロール領域。倍率 = フィット倍率(wrapに全体が収まる) × ズーム(1=全体表示)。
// 拡大中は wrap 内でスクロールする。座標変換は各タブ側が getBoundingClientRect と倍率で行うため、
// ここではステージの大きさ(倍率)とスクロール位置だけを扱う。
//   操作: −/＋/全体ボタン、Ctrl+ホイール（カーソル位置を基準に拡縮）、中ボタンドラッグでスクロール、キー + / - / 0
import { t } from './i18n.js';

const MIN_Z = 1, MAX_Z = 8, STEP = 1.25, PAD = 16;

export function createStageZoom({ wrap, stage, controls, render, isActive }) {
    let z = 1;
    let lastScale = 1;
    let label = null;

    // 表示倍率（実画素に対する倍率）を返す。描画側はこの値で大きさを決める
    function scaleFor(w, h, fallbackW = 560, fallbackH = 680) {
        const vw = (wrap.clientWidth || fallbackW) - PAD, vh = (wrap.clientHeight || fallbackH) - PAD;
        const fit = Math.max(0.01, Math.min(vw / w, vh / h));
        lastScale = fit * z;
        updateLabel();
        return lastScale;
    }

    // 表示は「全体表示 = 100%」基準（実画素に対する倍率ではない）
    function updateLabel() {
        if (label) label.textContent = `${Math.round(z * 100)}%`;
    }

    // anchor: 拡縮の基準にする画面座標（省略時は表示中の中央）
    function setZoom(nz, anchor, force = false) {
        nz = Math.min(MAX_Z, Math.max(MIN_Z, nz));
        if (!force && Math.abs(nz - z) < 1e-4) return;
        const wr = wrap.getBoundingClientRect();
        const ax = anchor ? anchor.x : wr.left + wr.width / 2, ay = anchor ? anchor.y : wr.top + wr.height / 2;
        const r0 = stage.getBoundingClientRect();
        const fx = r0.width ? (ax - r0.left) / r0.width : 0.5, fy = r0.height ? (ay - r0.top) / r0.height : 0.5;
        z = nz;
        render();
        const r1 = stage.getBoundingClientRect();
        wrap.scrollLeft += r1.left + fx * r1.width - ax;
        wrap.scrollTop += r1.top + fy * r1.height - ay;
    }

    function reset() { z = 1; wrap.scrollLeft = 0; wrap.scrollTop = 0; }

    // ─── ツールバー（− 倍率 ＋ 全体） ───
    if (controls) {
        const mk = (text, key, fn) => {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'btn small secondary stage-zoom-btn'; b.textContent = text;
            b.title = t(key); b.dataset.i18nTitle = key;
            b.addEventListener('click', fn);
            return b;
        };
        label = document.createElement('span');
        label.className = 'stage-zoom-label';
        label.title = t('zoom.hint'); label.dataset.i18nTitle = 'zoom.hint';
        const fitBtn = mk('', 'zoom.fitTitle', () => setZoom(1, null, true));
        fitBtn.textContent = t('zoom.fit'); fitBtn.dataset.i18n = 'zoom.fit';
        controls.classList.add('stage-zoom-ctl');
        controls.append(mk('−', 'zoom.out', () => setZoom(z / STEP)), label, mk('+', 'zoom.in', () => setZoom(z * STEP)), fitBtn);
        updateLabel();
    }

    // Ctrl+ホイール（トラックパッドのピンチも ctrlKey 付きの wheel になる）
    wrap.addEventListener('wheel', (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        setZoom(z * Math.exp(-e.deltaY * 0.002), { x: e.clientX, y: e.clientY });
    }, { passive: false });

    // 中ボタンドラッグでスクロール（ブラウザの自動スクロールは止める）
    let pan = null;
    wrap.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
    wrap.addEventListener('pointerdown', (e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        pan = { x: e.clientX, y: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop, id: e.pointerId };
        wrap.setPointerCapture(e.pointerId);
        wrap.classList.add('panning');
    });
    wrap.addEventListener('pointermove', (e) => {
        if (!pan || e.pointerId !== pan.id) return;
        wrap.scrollLeft = pan.sl - (e.clientX - pan.x);
        wrap.scrollTop = pan.st - (e.clientY - pan.y);
    });
    const endPan = (e) => { if (pan && e.pointerId === pan.id) { pan = null; wrap.classList.remove('panning'); } };
    wrap.addEventListener('pointerup', endPan);
    wrap.addEventListener('pointercancel', endPan);

    // キー: + / - / 0（入力欄にフォーカスがあるときは無効）
    document.addEventListener('keydown', (e) => {
        if (!isActive?.() || e.ctrlKey || e.metaKey || e.altKey) return;
        const ae = document.activeElement;
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(ae?.tagName || '') || ae?.isContentEditable) return;
        if (e.key === '+' || e.key === '=') setZoom(z * STEP);
        else if (e.key === '-') setZoom(z / STEP);
        else if (e.key === '0') setZoom(1, null, true);
        else return;
        e.preventDefault();
    });

    return { scaleFor, setZoom, reset, get zoom() { return z; } };
}
