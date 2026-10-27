// ============================================================
// Nanobanana+（ローカル）: ワークフローの画像入力数を、ドロップした画像の枚数に合わせる（DOM非依存）
//
// Qwen Image 2.1 の Image Edit サブグラフ（TextEncodeQwenImage21）は `images.image_1`〜`images.image_10` の最大10入力を持つが、
// 未接続の入力は使われない。ワークフロー側のLoadImageは固定数（1〜2個など）なので、そのままだと3枚目以降が切り捨てられる。
// そこで、実行前にワークフローJSON（litegraph形式）のLoadImageを「枚数ぶん」作り直して images.image_1.. へ順に接続する。
// WFS側は LoadImage をノードID順に i 枚目→i 番目のスロットへ割り当てるので、新しいノードIDは昇順に振る。
// ============================================================

export const IMAGE_SLOT_CAP = 10;   // Qwen Image 2.1 の画像入力の上限
const IMG_INPUT = /^images\.image_(\d+)/;

/** 画像入力（images.image_N）を2つ以上持つノードを探す。無ければ null。slots は番号順の { idx: 入力の位置, no } */
export function findImageSlots(wf) {
    if (!Array.isArray(wf?.nodes)) return null;
    for (const node of wf.nodes) {
        const found = (node.inputs || [])
            .map((inp, idx) => ({ idx, no: Number(IMG_INPUT.exec(inp?.name || '')?.[1]), type: inp?.type }))
            .filter(x => Number.isFinite(x.no) && x.type === 'IMAGE')
            .sort((a, b) => a.no - b.no);
        if (found.length >= 2) return { node, slots: found.slice(0, IMAGE_SLOT_CAP) };
    }
    return null;
}

/** ワークフローの画像入力の上限（対応しない構成は null） */
export function maxImageSlots(wf) {
    return findImageSlots(wf)?.slots.length ?? null;
}

const DEFAULT_LOAD_IMAGE = () => ({
    type: 'LoadImage', size: [282, 314], flags: {}, order: 0, mode: 0,
    inputs: [{ name: 'image', type: 'COMBO', widget: { name: 'image' }, link: null }],
    outputs: [{ name: 'IMAGE', type: 'IMAGE', links: null, slot_index: 0 }, { name: 'MASK', type: 'MASK', links: null, slot_index: 1 }],
    properties: { 'Node name for S&R': 'LoadImage' },
    widgets_values: ['example.png', 'image'],
});

/**
 * 画像 n 枚ぶんの LoadImage を作り直して images.image_1..n へ接続したワークフローを返す（元のオブジェクトは変えない）。
 * 戻り値: { workflow, applied, max, used }。
 * 安全のため、次の場合は何も変えない（applied:false）: 画像入力を持つノードが無い／n<1／画像入力の元が LoadImage 以外／
 * その LoadImage が他にもつながっている／画像入力と無関係な LoadImage が別にある（スロット順がずれるため）。
 */
export function fitImageSlots(wf, n) {
    const found = findImageSlots(wf);
    const max = found ? found.slots.length : null;
    const same = { workflow: wf, applied: false, max, used: 0 };
    if (!found || !(n >= 1) || !Array.isArray(wf.links) || wf.links.some(l => !Array.isArray(l))) return same;

    const out = JSON.parse(JSON.stringify(wf));
    const target = out.nodes.find(x => x.id === found.node.id);
    const nodeById = new Map(out.nodes.map(x => [x.id, x]));
    const linkById = new Map(out.links.map(l => [l[0], l]));

    // 現在つながっている元のノード
    const sources = new Set();
    for (const s of found.slots) {
        const lid = target.inputs[s.idx].link;
        const l = lid == null ? null : linkById.get(lid);
        if (l) sources.add(l[1]);
    }
    const old = [...sources].map(id => nodeById.get(id));
    if (old.some(x => !x || x.type !== 'LoadImage')) return same;
    const loadImages = out.nodes.filter(x => x.type === 'LoadImage');
    if (loadImages.length !== old.length) return same;   // 無関係なLoadImageがある
    const feedsOnlyTarget = (x) => (x.outputs || []).every(o => (o.links || []).every(lid => linkById.get(lid)?.[3] === target.id));
    if (!old.every(feedsOnlyTarget)) return same;

    // 古いLoadImageとその接続を取り除く
    const oldIds = new Set(old.map(x => x.id));
    const template = old[0] ? JSON.parse(JSON.stringify(old[0])) : DEFAULT_LOAD_IMAGE();
    const x0 = (old[0]?.pos?.[0]) ?? ((target.pos?.[0] ?? 0) - 320);
    const y0 = Math.min(...old.map(x => x.pos?.[1]).filter(Number.isFinite), target.pos?.[1] ?? 0);
    out.nodes = out.nodes.filter(x => !oldIds.has(x.id));
    out.links = out.links.filter(l => !oldIds.has(l[1]));
    for (const s of found.slots) target.inputs[s.idx].link = null;

    // 新しいLoadImageを枚数ぶん作って接続する
    const used = Math.min(Math.floor(n), max);
    let nodeId = Math.max(out.last_node_id || 0, ...out.nodes.map(x => x.id));
    let linkId = Math.max(out.last_link_id || 0, ...out.links.map(l => l[0]));
    for (let i = 0; i < used; i++) {
        const node = JSON.parse(JSON.stringify(template));
        node.id = ++nodeId;
        node.pos = [x0, y0 + i * ((node.size?.[1] ?? 314) + 30)];
        node.inputs.forEach(inp => { inp.link = null; });
        node.outputs.forEach(o => { o.links = null; });
        const lid = ++linkId;
        node.outputs[0].links = [lid];
        out.nodes.push(node);
        out.links.push([lid, node.id, 0, target.id, found.slots[i].idx, 'IMAGE']);
        target.inputs[found.slots[i].idx].link = lid;
    }
    out.last_node_id = nodeId; out.last_link_id = linkId;
    return { workflow: out, applied: true, max, used };
}
