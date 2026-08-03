// text3d.js — comfyui-vrm-pose-editor への薄いブリッジ（pose3d.js と同一パターン）
//
// 3Dテキスト機能はThree.js本体を自前で持たず、ComfyUIカスタムノード
// 「comfyui-vrm-pose-editor」が WEB_DIRECTORY 経由で配信する three.module.js / OrbitControls.js /
// three-vrm.module.js を動的importして再利用する。three-vrm.module.js は3DポーズのVRM表示だけでなく
// MToonMaterial（VRMのトゥーンシェーダー）も標準クラスとしてexportしており、GLTFロード無しでも
// 単体でnewできるため、3Dテキストのトゥーン調マテリアルにもそのまま流用する。
// text3d-core.js はTHREE非依存に書かれているため、ここで取得したTHREE/OrbitControls/MToonMaterialを
// 注入するだけの役割を持つ。
//
// ノード未インストール時は window.initText3DEditor を一切公開しない。呼び出し側
// （25-text3d-bridge.js / Text3DTool.js）は既存の pose3d 呼び出し元と同じリトライ機構
// （typeof window.initText3DEditor !== 'function' なら300ms後に再試行）で扱う。

const NODE_BASE = '/extensions/comfyui-vrm-pose-editor/';
const THREE_URL = NODE_BASE + 'vendor/three.module.js';
const ORBIT_URL = NODE_BASE + 'vendor/OrbitControls.js';
const VRM_URL   = NODE_BASE + 'vendor/three-vrm.module.js';
const CORE_URL  = '/ccc_static/js/text3d-core.js';

async function _installBridge() {
    const [THREE, orbitMod, vrmMod, core] = await Promise.all([
        import(THREE_URL),
        import(ORBIT_URL),
        import(VRM_URL),
        import(CORE_URL),
    ]);

    window.initText3DEditor = function (canvas, options) {
        return core.initText3DEditor(THREE, orbitMod.OrbitControls, vrmMod.MToonMaterial, canvas, options);
    };
}

_installBridge().catch((err) => {
    console.error(
        '[text3d] comfyui-vrm-pose-editor が見つかりません。' +
        'ComfyUIのcustom_nodesにインストールされているか確認してください。',
        err
    );
});
