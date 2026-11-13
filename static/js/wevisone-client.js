/**
 * WeVisOne-VL（tencent/WeVisOne-VL-4B）を ComfyUI 経由で呼ぶクライアント。DOM 非依存。
 *
 * 前提: ComfyUI に paralaif/ComfyUI-WeVisOne-VL（WeVisOneVLLoader / WeVisOneVLPerceive）が入っていて、
 * 重み（wevisone_vl_*.safetensors）が text_encoders にあること。
 * CC は ComfyUI から配信されるので、既定の接続先は同一オリジン。
 *
 * 出力は `<ref>ラベル</ref><box><x1><y1><x2><y2>,...</box>`（0-1000 正規化、x が先）。
 */

const LOADER = 'WeVisOneVLLoader';
const PERCEIVE = 'WeVisOneVLPerceive';
const POLL_MS = 400;
const TIMEOUT_MS = 10 * 60 * 1000;

const base = (b) => (b || location.origin).replace(/\/+$/, '');

/** 使えるか・重みの候補。{ available, models: string[] }。ノードが無ければ available=false */
export async function wevisoneStatus(b) {
    try {
        const res = await fetch(`${base(b)}/object_info/${LOADER}`);
        if (!res.ok) return { available: false, models: [] };
        const info = (await res.json())[LOADER];
        if (!info) return { available: false, models: [] };
        const spec = info.input?.required?.clip_name;
        // 新形式 ["COMBO", {options}] と旧形式 [[...]] の両方
        const opts = Array.isArray(spec?.[0]) ? spec[0] : (spec?.[1]?.options || []);
        const models = opts.filter(n => /wevis/i.test(n));
        return { available: models.length > 0, models };
    } catch (_) {
        return { available: false, models: [] };
    }
}

/** 4B・int8 を優先して既定の重みを選ぶ */
export function pickWevisoneModel(models) {
    return models.find(n => /4b/i.test(n) && /int8/i.test(n)) || models.find(n => /4b/i.test(n)) || models[0] || '';
}

/** Blob（画像）を ComfyUI の input/cc_wevisone/ へ上げ、LoadImage に渡す名前を返す */
async function uploadImage(b, blob, name) {
    const form = new FormData();
    form.append('image', new File([blob], name, { type: blob.type || 'image/png' }));
    form.append('subfolder', 'cc_wevisone');
    form.append('overwrite', 'true');
    const res = await fetch(`${base(b)}/upload/image`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`upload HTTP ${res.status}`);
    const d = await res.json();
    return d.subfolder ? `${d.subfolder}/${d.name}` : d.name;
}

async function waitHistory(b, promptId, onWait) {
    const t0 = Date.now();
    for (;;) {
        const res = await fetch(`${base(b)}/history/${promptId}`);
        if (res.ok) {
            const h = (await res.json())[promptId];
            if (h?.status?.completed !== undefined && (h.status.completed || h.status.status_str === 'error')) return h;
        }
        if (Date.now() - t0 > TIMEOUT_MS) throw new Error('WeVisOne: timeout');
        onWait?.(Date.now() - t0);
        await new Promise(r => setTimeout(r, POLL_MS));
    }
}

function historyError(h) {
    const m = (h.status?.messages || []).find(x => x[0] === 'execution_error');
    return m ? `${m[1]?.node_type || ''}: ${m[1]?.exception_message || 'error'}`.trim() : 'execution failed';
}

/**
 * 1枚の画像に複数のジョブ（task+query）をまとめて実行する。モデルの読み込みは1回。
 * jobs: [{ task, query, masks?: boolean }]  masks=true のジョブはインスタンスごとのマスク画像も返す。
 * 戻り値: [{ raw, maskUrls: string[] }]（jobs と同じ順）
 */
export async function runWevisone({ base: b, image, model, jobs, maxLength = 2048, onWait }) {
    if (!jobs?.length) return [];
    const name = await uploadImage(b, image, `cc_wevisone_${Date.now()}.png`);
    const g = {
        img: { class_type: 'LoadImage', inputs: { image: name } },
        ld: { class_type: LOADER, inputs: { clip_name: model } },
    };
    jobs.forEach((j, i) => {
        g[`p${i}`] = { class_type: PERCEIVE, inputs: { clip: ['ld', 0], image: ['img', 0], task: j.task, query: j.query || '', max_length: maxLength, individual_masks: !!j.masks } };
        g[`t${i}`] = { class_type: 'PreviewAny', inputs: { source: [`p${i}`, 0] } };
        if (j.masks) {
            g[`m${i}`] = { class_type: 'MaskToImage', inputs: { mask: [`p${i}`, 3] } };
            g[`v${i}`] = { class_type: 'PreviewImage', inputs: { images: [`m${i}`, 0] } };
        }
    });
    const res = await fetch(`${base(b)}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: g }) });
    if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(`WeVisOne: HTTP ${res.status} ${e?.error?.message || ''} ${Object.values(e?.node_errors || {}).map(n => n.errors?.[0]?.details).join(' ')}`.trim());
    }
    const { prompt_id: pid } = await res.json();
    const h = await waitHistory(b, pid, onWait);
    if (h.status?.status_str === 'error') {
        const msg = historyError(h);
        // 何も見つからないとマスクが0枚になり、MaskToImage / PreviewImage が空のバッチで失敗する → 該当なしとして返す
        if (jobs.some(j => j.masks) && /with size 0/.test(msg)) return jobs.map(() => ({ raw: '', maskUrls: [] }));
        throw new Error(`WeVisOne: ${msg}`);
    }
    const out = h.outputs || {};
    return jobs.map((j, i) => {
        const tx = out[`t${i}`]?.text;
        const raw = Array.isArray(tx) ? tx.join('\n') : (tx || '');
        const maskUrls = (out[`v${i}`]?.images || []).map(im =>
            `${base(b)}/view?filename=${encodeURIComponent(im.filename)}&subfolder=${encodeURIComponent(im.subfolder || '')}&type=${im.type || 'temp'}`);
        return { raw, maskUrls };
    });
}

const SHAPE_RE = /<ref>([\s\S]*?)<\/ref>\s*<box>([\s\S]*?)(?:<\/box>|(?=<ref>)|$)/g;

/** 出力 → [{ label, x1, y1, x2, y2 }]（0〜1）。<OBJ> などの付加トークンは無視 */
export function parseWevisone(raw) {
    const out = [];
    for (const m of String(raw || '').matchAll(SHAPE_RE)) {
        const label = m[1].trim();
        for (const seg of m[2].split(',')) {
            const v = [...seg.matchAll(/<(\d{1,4})>/g)].map(x => +x[1] / 1000);
            if (v.length < 4) continue;
            const [x1, y1, x2, y2] = v;
            if (x2 > x1 && y2 > y1) out.push({ label, x1, y1, x2, y2 });
        }
    }
    return out;
}
