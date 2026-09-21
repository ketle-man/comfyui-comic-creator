// ============================================================
// main.js 分割ファイル (追加): Autoタブの画像生成（28-auto-tab.js から利用）
// type="module" として読み込まれる。
// 主なトップレベル定義: generateAutoImage, listWorkflowFilenames
//
// 生成エンジンは2つ（Chatの画像生成でラジオボタン選択、各設定は設定タブの「画像生成」欄）:
//   local  … Workflow Studio経由（既存の requestPanelImageFromWorkflowStudio。専用ワークフロー指定に対応）
//   gemini … Nanobanana（既存の requestNanobananaGenerate。APIキーはNanobananaタブと共通）
// 生成した画像はどちらも ComfyUI の output/cc_auto/ に保存する（/api/ccc/save-auto-image）。
// ============================================================

import { t } from '../i18n.js';
import { requestPanelImageFromWorkflowStudio } from './14-integrations.js';
import { requestNanobananaGenerate } from '../nanobanana.js';

// WFS経由の生成結果は発行元ページ限りのblob URLで返ることがあるため、保存前にdata URLへ変換する
async function urlToDataUrl(url) {
    if (url.startsWith('data:')) return url;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

// Gemini APIの返す画像は素のbase64のことがあり、PNGとは限らない。マジックバイトで形式を判定する。
function normalizeImage(raw) {
    if (raw.startsWith('data:')) return raw;
    let mime = 'image/png';
    if (raw.startsWith('/9j/')) mime = 'image/jpeg';
    else if (raw.startsWith('UklGR')) mime = 'image/webp';
    else if (raw.startsWith('R0lGOD')) mime = 'image/gif';
    return `data:${mime};base64,${raw}`;
}

function extensionOf(dataUrl) {
    const m = dataUrl.match(/^data:image\/(\w+)/);
    if (!m) return 'png';
    return m[1] === 'jpeg' ? 'jpg' : m[1];
}

async function saveToCcAuto(dataUrl, engine) {
    const filename = `auto_${engine}_${Date.now()}.${extensionOf(dataUrl)}`;
    const res = await fetch('/api/ccc/save-auto-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl, filename }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.status !== 'ok') throw new Error(data.message || `HTTP ${res.status}`);
    return { url: data.url, filename: data.filename || filename };
}

// Workflow Studioの保存済みワークフロー名一覧（WFS未導入・未接続なら空配列）
export async function listWorkflowFilenames() {
    try {
        const res = await fetch('/api/wfm/workflows');
        if (!res.ok) return [];
        const list = await res.json();
        return (list || []).map((w) => w.filename).filter((name) => name && !name.startsWith('.'));   // .index.json 等の内部ファイルは除く
    } catch {
        return [];
    }
}

async function generateLocal(settings, prompt) {
    const width = Math.max(64, parseInt(settings.imgLocalWidth, 10) || 1024);
    const height = Math.max(64, parseInt(settings.imgLocalHeight, 10) || 1024);
    const wf = { enabled: !!settings.imgLocalWfEnabled && !!settings.imgLocalWfFile, file: settings.imgLocalWfFile || '' };
    const result = await requestPanelImageFromWorkflowStudio(prompt, width, height, settings.imgLocalNegative || '', wf);
    if (!result?.ok || !result.url) throw new Error(result?.message || t('auto.errImageGenFailed'));
    return urlToDataUrl(result.url);
}

async function generateGemini(settings, prompt) {
    const [width, height] = String(settings.imgGeminiResolution || '1024x1024').split('x').map(Number);
    const payload = {
        model: settings.imgGeminiModel,
        prompt,
        width: width || 1024,
        height: height || 1024,
        num_images: 1,
    };
    if (settings.imgGemini2k) payload.image_size = '2K';
    const images = await requestNanobananaGenerate(payload);
    return normalizeImage(images[0]);
}

// 画像を1枚生成し、output/cc_auto/ へ保存する。戻り値: { url, filename, engine }
export async function generateAutoImage(settings, prompt) {
    const engine = settings.imageEngine === 'gemini' ? 'gemini' : 'local';
    const dataUrl = engine === 'gemini' ? await generateGemini(settings, prompt) : await generateLocal(settings, prompt);
    const saved = await saveToCcAuto(dataUrl, engine);
    return { ...saved, engine };
}
