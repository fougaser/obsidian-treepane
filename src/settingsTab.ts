import { AbstractInputSuggest, App, PluginSettingTab, Setting, TFolder } from 'obsidian';
import type FileTreePlugin from './main';

export class FileTreeSettingTab extends PluginSettingTab {
    private readonly plugin: FileTreePlugin;

    constructor(app: App, plugin: FileTreePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Obsidian Treepane' });

        // ---- Default filetree view ----
        new Setting(containerEl).setName('Default filetree view').setHeading();

        new Setting(containerEl)
            .setName('Use Treepane as the default filetree view')
            .setDesc(
                'When on: Treepane auto-activates on startup and reclaims the left sidebar whenever Obsidian\'s breadcrumb or "Reveal active file" command tries to open the core File Explorer.'
            )
            .addToggle(toggle =>
                toggle.setValue(this.plugin.getDefaultFiletreeView()).onChange(async value => {
                    await this.plugin.setDefaultFiletreeView(value);
                })
            );

        // ---- Root folder ----
        new Setting(containerEl).setName('Root folder').setHeading();

        new Setting(containerEl)
            .setName('Default root folder')
            .setDesc(
                'Folder to use as the tree\'s home. The back arrow in the header returns here. Leave empty for the vault root.'
            )
            .addSearch(search => {
                const current = this.plugin.getDefaultRoot();
                search.setPlaceholder('Vault root').setValue(current === '/' ? '' : current);
                new FolderPathSuggest(this.app, search.inputEl);
                search.onChange(async value => {
                    const trimmed = value.trim();
                    await this.plugin.setDefaultRoot(trimmed === '' ? '/' : trimmed);
                });
            });
    }
}

class FolderPathSuggest extends AbstractInputSuggest<TFolder> {
    constructor(app: App, inputEl: HTMLInputElement) {
        super(app, inputEl);
    }

    protected getSuggestions(query: string): TFolder[] {
        const lower = query.toLowerCase();
        const folders: TFolder[] = [];
        const walk = (folder: TFolder) => {
            folders.push(folder);
            folder.children.forEach(child => {
                if (child instanceof TFolder) {
                    walk(child);
                }
            });
        };
        walk(this.app.vault.getRoot());
        return folders
            .filter(f => f.path !== '/' && f.path.toLowerCase().includes(lower))
            .slice(0, 50);
    }

    renderSuggestion(folder: TFolder, el: HTMLElement): void {
        el.setText(folder.path);
    }

    selectSuggestion(folder: TFolder): void {
        this.setValue(folder.path);
        this.close();
    }
}
