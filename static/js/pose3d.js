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
const DEFAULT_MODEL_URL = NODE_BASE + 'default_model.js';

async function _installBridge() {
    const [core, light, library, defaultModel] = await Promise.all([
        import(CORE_URL),
        import(LIGHT_URL),
        import(LIBRARY_URL),
        // default_model.js は vrm-pose-editor v0.21.0 以降のみ。無ければ既定モデルの自動読み込みを無効にする
        import(DEFAULT_MODEL_URL).catch((err) => {
            console.warn('[pose3d] default_model.js が読み込めないため、既定モデルの自動読み込みは無効です（vrm-pose-editor v0.21.0 以降が必要）', err);
            return null;
        }),
    ]);

    // main.js は initPoseEditor3D(canvas, gizmoCanvas, baseUrl, onMorphKeysReady, onModelReady) の
    // シグネチャで呼び出す（isModern はノードのVueNodes判定用でSPAには無関係なため固定でfalseを渡す）
    // defaultModelProvider(省略可) を渡すと、ノードと同じ既定モデル（model/ フォルダ＋Default Model 設定）を読み込む
    window.initPoseEditor3D = function (canvas, gizmoCanvas, baseUrl, onMorphKeysReady, onModelReady, defaultModelProvider) {
        return core.initPoseEditor3D(canvas, gizmoCanvas, baseUrl, onMorphKeysReady, false, onModelReady, defaultModelProvider);
    };
    window.openPoseLibrary = library.openPoseLibrary;
    window.openLightPoseEditor = light.openLightPoseEditor;
    // ノードの model/ フォルダ＋Default Model 設定から既定モデルを決める（{ name, url } / null）
    window.pose3dResolveDefaultModel = defaultModel?.resolveDefaultModel ?? null;
}

_installBridge().catch((err) => {
    console.error(
        '[pose3d] comfyui-vrm-pose-editor が見つかりません。' +
        'ComfyUIのcustom_nodesにインストールされているか確認してください。',
        err
    );
});
