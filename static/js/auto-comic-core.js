// ============================================================
// 半自動マンガ作成: スクリプト⇄コマ対応付けロジック（DOM非依存）
// スクリプトタブのコマ割りデータ（セリフ・画像プロンプト）と、レイアウトタブの
// テンプレート適用済みページの実パネルを「パネル番号順」で対応付ける。
// コマ割りの自動生成（グリッド計算等）は行わない。ユーザーが事前にレイアウトタブで
// 選択・適用した既存テンプレートのパネル番号（06c-template-wizard.jsがテンプレートSVGの
// polygon id="panel_N" から採番したもの）をそのまま処理順として使う。
// type="module" として読み込まれる。DOM/state に依存しないため単体テスト可能。
// ============================================================

/**
 * スクリプトの1ページ分のコマ割りデータを、実パネル配列（state.activePage.panels相当）と
 * パネル番号順に対応付ける。
 * @param {{scene?: string, panels: Array<{dialogues: Array<{character:string,text:string}>, imagePrompt?: string}>}} scriptPage
 * @param {Array<{id: string, number?: number, points?: string}>} panels
 * @returns {{
 *   mapped: Array<{panelId: string, panelNumber: number, scriptPanelIndex: number, dialogues: Array, imagePrompt: string}>,
 *   warning: {templateCount: number, scriptCount: number} | null
 * }}
 */
function mapScriptPageToPanels(scriptPage, panels) {
    const scriptPanels = (scriptPage && Array.isArray(scriptPage.panels)) ? scriptPage.panels : [];
    const sortedPanels = Array.isArray(panels)
        ? [...panels].sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
        : [];

    const count = Math.min(sortedPanels.length, scriptPanels.length);
    const mapped = [];
    for (let i = 0; i < count; i++) {
        const panel = sortedPanels[i];
        const scriptPanel = scriptPanels[i];
        mapped.push({
            panelId: panel.id,
            panelNumber: panel.number ?? (i + 1),
            scriptPanelIndex: i,
            dialogues: Array.isArray(scriptPanel.dialogues) ? scriptPanel.dialogues : [],
            imagePrompt: typeof scriptPanel.imagePrompt === 'string' ? scriptPanel.imagePrompt : '',
        });
    }

    const warning = (sortedPanels.length !== scriptPanels.length)
        ? { templateCount: sortedPanels.length, scriptCount: scriptPanels.length }
        : null;

    return { mapped, warning };
}

export { mapScriptPageToPanels };
