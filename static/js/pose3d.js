// pose3d.js — comfyui-vrm-pose-editor への薄いブリッジ
//
// レイアウトタブ「3Dポーズ」サブタブの実体は、ComfyUIカスタムノード
// 「comfyui-vrm-pose-editor」がインストールされていることを前提に、そのノードが
// 提供するコアロジック(pose_editor_core.js)・ライトエディタ(light_editor.js)・
// ポーズライブラリ(pose_library.js)を動的importして再利用する。
//
// ノードは WEB_DIRECTORY="./js" のため、ComfyUI標準機構により
// /extensions/comfyui-vrm-pose-editor/<file> という固定URLで配信される。
// これにより、ノード側の将来の機能追加・修正はSPA側の変更なしに自動的に反映される。
//
// ノード未インストール時は window.initPoseEditor3D 等を一切公開しない。
// main.js側は既存のリトライ機構（typeof window.initPoseEditor3D !== 'function' なら
// 300ms後に再試行）でこの状態を扱えるため、ここでは何もフォールバック処理をせず
// コンソールにエラーを出すのみにとどめる。

const NODE_BASE    = '/extensions/comfyui-vrm-pose-editor/';
const CORE_URL     = NODE_BASE + 'pose_editor_core.js';
const LIGHT_URL    = NODE_BASE + 'light_editor.js';
const LIBRARY_URL  = NODE_BASE + 'pose_library.js';

async function _installBridge() {
    const [core, light, library] = await Promise.all([
        import(CORE_URL),
        import(LIGHT_URL),
        import(LIBRARY_URL),
    ]);

    // main.js は initPoseEditor3D(canvas, gizmoCanvas, baseUrl, onMorphKeysReady, onModelReady) の
    // シグネチャで呼び出す（isModern はノードのVueNodes判定用でSPAには無関係なため固定でfalseを渡す）
    window.initPoseEditor3D = function (canvas, gizmoCanvas, baseUrl, onMorphKeysReady, onModelReady) {
        return core.initPoseEditor3D(canvas, gizmoCanvas, baseUrl, onMorphKeysReady, false, onModelReady);
    };
    window.openPoseLibrary = library.openPoseLibrary;
    window.openLightEditor = light.openLightEditor;
}

_installBridge().catch((err) => {
    console.error(
        '[pose3d] comfyui-vrm-pose-editor が見つかりません。' +
        'ComfyUIのcustom_nodesにインストールされているか確認してください。',
        err
    );
});
