// ============================================================
// テンプレート作成ウィザード 分割ファイル (2/3): テンプレートグループ管理+テンプレート管理
// 元 06-template-wizard.js（分割前）の行 798-1011 に相当
// type="module" として読み込まれる（ESモジュール化 G2）。06c-template-wizard.js とは相互import（循環）。
// 循環先シンボルの参照はすべて関数内部（呼び出し時点で評価）に閉じているため安全（詳細はG1と同じ判断基準）。
// 主なトップレベル定義: _tmplGroups,initTemplateManager,loadTemplates,saveTemplate
// 未ESM化の外部依存（非moduleのグローバル関数はwindowプロパティとして自動的に見えるため、
// 呼び出し箇所は書き換えていない）: state（01-state.js）
// ============================================================

import { t } from '../i18n.js';
import { dbGet, dbGetAll, dbPut, readFileAsText } from './00-db.js';
import {
    parseSVGForTemplate, openTemplateWizard, closeTemplateWizard, _tmplWizCreateBase,
    _tmplWizSave, _tmplWizUndo, _tmplWizReset, _tmplWizSetOrientation, _tmplWizSetCutMode,
    _tmplWiz, _tmplWizSaveGridSettings, _tmplWizRender, renameTemplate, deleteTemplate,
    renderTemplateList, _tmplGroupsRefreshUI, _tmplSidePanelUpdate, _tmplApplyImportScale,
} from './06c-template-wizard.js';
import { state } from './01-state.js';

// ==============================
// テンプレート グループ管理
// ==============================

const _tmplGroups = {
    _data: null, // { groupName: [templateName, ...] }

    load() {
        try { this._data = JSON.parse(localStorage.getItem('template_groups') || '{}'); }
        catch { this._data = {}; }
        return this._data;
    },
    save() { localStorage.setItem('template_groups', JSON.stringify(this._data)); },
    get data() { return this._data || this.load(); },

    groupNames() { return Object.keys(this.data).sort((a, b) => a.localeCompare(b)); },

    groupOf(templateName) {
        return Object.keys(this.data).find(g => this.data[g].includes(templateName)) || null;
    },

    createGroup(name) {
        if (!name || this.data[name]) return false;
        this.data[name] = [];
        this.save();
        return true;
    },

    deleteGroup(name) {
        delete this.data[name];
        this.save();
    },

    renameGroup(oldName, newName) {
        if (!newName || this.data[newName] || !this.data[oldName]) return false;
        this.data[newName] = this.data[oldName];
        delete this.data[oldName];
        this.save();
        return true;
    },

    assign(templateName, groupName) {
        // 既存グループから除去してから追加
        Object.keys(this.data).forEach(g => {
            this.data[g] = this.data[g].filter(n => n !== templateName);
        });
        if (groupName && this.data[groupName]) {
            this.data[groupName].push(templateName);
        }
        this.save();
    },

    remove(templateName) {
        Object.keys(this.data).forEach(g => {
            this.data[g] = this.data[g].filter(n => n !== templateName);
        });
        this.save();
    },

    renameTemplate(oldName, newName) {
        Object.keys(this.data).forEach(g => {
            const idx = this.data[g].indexOf(oldName);
            if (idx !== -1) this.data[g][idx] = newName;
        });
        this.save();
    },
};

// ==============================
// テンプレート管理
// ==============================

async function initTemplateManager() {
    _tmplGroups.load();

    const fileInput = document.getElementById('svg-upload');
    if (!fileInput) return;

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const svgText = await readFileAsText(file);
            const templateName = file.name.replace(/\.svg$/i, '');
            let template = parseSVGForTemplate(svgText, templateName);
            let finalSvgText = svgText;

            // SVGのwidth属性（実寸mm）から算出したスケール補正値が1から十分離れている場合、
            // 適用してよいか確認する。テンプレートウィザードの内部座標系は「1ユーザー単位=0.01mm」
            // 固定だが、外部SVGはツールごとに実寸との対応関係が異なり、補正しないと
            // テンプレート間でコマ枠線幅の見た目の太さが揃わないため（2026-08-13発覚）。
            // Cancelはインポート自体の中止として扱う（数値入力してOKなら、その値で作成する。
            // 1を入力すれば補正なしで作成できる）。
            if (template.suggestedScale && Math.abs(template.suggestedScale - 1) > 0.02) {
                const defaultScale = Math.round(template.suggestedScale * 1000) / 1000;
                const input = prompt(t('tmpl.scaleConfirmPrompt', defaultScale), String(defaultScale));
                if (input === null) { fileInput.value = ''; return; }
                const scale = parseFloat(input);
                if (Number.isFinite(scale) && scale > 0 && Math.abs(scale - 1) > 0.001) {
                    const applied = _tmplApplyImportScale(template, svgText, scale);
                    template = applied.template;
                    finalSvgText = applied.svgText;
                }
            }

            // 同名テンプレートが既に存在する場合、確認なしで上書きしていたのを改め、
            // 別の名前を入力してもらう（2026-08-13発覚: 確認なしの上書きにより、
            // 補正ダイアログをCancelしたつもりでも既存の同名テンプレートが上書きされ、
            // 「作成した」表示は出るのに新規のテンプレートとしては現れないように見えた）。
            let finalName = template.name;
            while (await dbGet('templates', finalName)) {
                const newName = prompt(t('tmpl.namePromptDuplicate', finalName), finalName)?.trim();
                if (!newName) { fileInput.value = ''; return; }
                finalName = newName;
            }
            if (finalName !== template.name) {
                template = { ...template, id: finalName, name: finalName };
            }

            await saveTemplate(template, finalSvgText);
            await loadTemplates();
            renderTemplateList();

            alert(t('tmpl.created', template.name));
        } catch (error) {
            console.error('Template creation error:', error);
            alert(t('tmpl.createFailed', error.message));
        }
        fileInput.value = '';
    });

    // テンプレート作成ウィザード
    document.getElementById('template-wizard-btn')?.addEventListener('click', openTemplateWizard);
    document.getElementById('tmplwiz-cancel-btn')?.addEventListener('click', closeTemplateWizard);
    document.getElementById('tmplwiz-create-base-btn')?.addEventListener('click', _tmplWizCreateBase);
    document.getElementById('tmplwiz-save-btn')?.addEventListener('click', _tmplWizSave);
    document.getElementById('tmplwiz-undo-btn')?.addEventListener('click', _tmplWizUndo);
    document.getElementById('tmplwiz-reset-btn')?.addEventListener('click', _tmplWizReset);
    document.getElementById('tmplwiz-orientation-portrait')?.addEventListener('click', () => _tmplWizSetOrientation('portrait'));
    document.getElementById('tmplwiz-orientation-landscape')?.addEventListener('click', () => _tmplWizSetOrientation('landscape'));
    document.getElementById('tmplwiz-mode-all-btn')?.addEventListener('click', () => _tmplWizSetCutMode('all'));
    document.getElementById('tmplwiz-mode-single-btn')?.addEventListener('click', () => _tmplWizSetCutMode('single'));
    document.getElementById('tmplwiz-grid-toggle')?.addEventListener('change', e => {
        _tmplWiz.gridEnabled = e.target.checked;
        _tmplWizSaveGridSettings();
        _tmplWizRender();
    });
    document.getElementById('tmplwiz-grid-w')?.addEventListener('input', e => {
        _tmplWiz.gridW = Math.max(1, parseFloat(e.target.value) || 0);
        _tmplWizSaveGridSettings();
        _tmplWizRender();
    });
    document.getElementById('tmplwiz-grid-h')?.addEventListener('input', e => {
        _tmplWiz.gridH = Math.max(1, parseFloat(e.target.value) || 0);
        _tmplWizSaveGridSettings();
        _tmplWizRender();
    });
    document.getElementById('tmplwiz-grid-snap-toggle')?.addEventListener('change', e => {
        _tmplWiz.gridSnap = e.target.checked;
        _tmplWizSaveGridSettings();
    });

    const renameBtn = document.getElementById('template-rename-btn');
    if (renameBtn) {
        renameBtn.addEventListener('click', () => {
            if (state.selectedTemplateName) renameTemplate(state.selectedTemplateName);
        });
    }

    const delBtn = document.getElementById('template-delete-btn');
    if (delBtn) {
        delBtn.addEventListener('click', () => {
            if (state.selectedTemplateName) deleteTemplate(state.selectedTemplateName);
        });
    }

    // グループフィルタ
    const groupFilter = document.getElementById('template-group-filter');
    if (groupFilter) {
        groupFilter.addEventListener('change', () => renderTemplateList());
    }

    // サイドパネル: グループ追加
    document.getElementById('tmpl-group-add-btn')?.addEventListener('click', () => {
        const input = document.getElementById('tmpl-group-name-input');
        const name = input?.value.trim();
        if (!name) return;
        if (!_tmplGroups.createGroup(name)) { alert(t('tmpl.alreadyExists', name)); return; }
        input.value = '';
        _tmplGroupsRefreshUI();
    });

    // サイドパネル: グループ名変更
    document.getElementById('tmpl-group-rename-btn')?.addEventListener('click', () => {
        const sel = document.getElementById('tmpl-group-select');
        const oldName = sel?.value;
        if (!oldName) { alert(t('tmpl.selectGroup')); return; }
        const newName = prompt(t('tmpl.newGroupNamePrompt'), oldName)?.trim();
        if (!newName) return;
        if (!_tmplGroups.renameGroup(oldName, newName)) { alert(t('tmpl.alreadyExists', newName)); return; }
        _tmplGroupsRefreshUI();
    });

    // サイドパネル: グループ削除
    document.getElementById('tmpl-group-delete-btn')?.addEventListener('click', () => {
        const sel = document.getElementById('tmpl-group-select');
        const name = sel?.value;
        if (!name) { alert(t('tmpl.selectGroup')); return; }
        if (!confirm(t('tmpl.confirmDeleteGroup', name))) return;
        _tmplGroups.deleteGroup(name);
        _tmplGroupsRefreshUI();
    });

    // サイドパネル: グループに追加
    document.getElementById('tmpl-assign-group-btn')?.addEventListener('click', () => {
        const groupName = document.getElementById('tmpl-group-select')?.value;
        if (!groupName) { alert(t('tmpl.selectGroup')); return; }
        if (!state.selectedTemplateName) { alert(t('tmpl.selectTemplate')); return; }
        _tmplGroups.assign(state.selectedTemplateName, groupName);
        _tmplSidePanelUpdate(state.selectedTemplateName);
        renderTemplateList();
    });

    // サイドパネル: グループから削除
    document.getElementById('tmpl-remove-group-btn')?.addEventListener('click', () => {
        if (!state.selectedTemplateName) return;
        _tmplGroups.remove(state.selectedTemplateName);
        _tmplSidePanelUpdate(state.selectedTemplateName);
        renderTemplateList();
    });

    await loadTemplates();
    _tmplGroupsRefreshUI();
    renderTemplateList();
}

async function loadTemplates() {
    state.templates = await dbGetAll('templates');
    state.templates.sort((a, b) => a.name.localeCompare(b.name));
}

async function saveTemplate(template, svgContent) {
    const record = { ...template, svgContent };
    await dbPut('templates', record);
}

export { _tmplGroups, initTemplateManager, loadTemplates, saveTemplate };

// まだESM化されていない main/以下の classic <script> から呼べるようにするブリッジ
// （ESモジュール化移行中の一時措置。全分割ファイルのESM化が完了したら、
//  各呼び出し元をimport文に置き換えてこのブロックごと削除する）。
window.initTemplateManager = initTemplateManager;
window.loadTemplates = loadTemplates;

