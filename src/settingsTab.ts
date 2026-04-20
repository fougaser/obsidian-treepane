import { AbstractInputSuggest, App, PluginSettingTab, Setting, TFolder } from 'obsidian';
import type FileTreePlugin from './main';
import type { SortMode } from './main';

export class FileTreeSettingTab extends PluginSettingTab {
    private readonly plugin: FileTreePlugin;

    constructor(app: App, plugin: FileTreePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Treepane' });

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

        // ---- Sort ----
        new Setting(containerEl).setName('Sort order').setHeading();

        new Setting(containerEl)
            .setName('Default sort')
            .setDesc('Mirrors the sort button in the Treepane header.')
            .addDropdown(dropdown =>
                dropdown
                    .addOption('folders-first', 'Folders first')
                    .addOption('files-first', 'Files first')
                    .addOption('alphabet', 'Alphabet (mixed)')
                    .setValue(this.plugin.getSortMode())
                    .onChange(async value => {
                        await this.plugin.setSortMode(value as SortMode);
                    })
            );

        // ---- Appearance ----
        new Setting(containerEl).setName('Appearance').setHeading();

        const appearance = this.plugin.getAppearance();

        new Setting(containerEl)
            .setName('Show title')
            .addToggle(toggle =>
                toggle.setValue(appearance.showTitle).onChange(async value => {
                    await this.plugin.persistAppearance({ ...this.plugin.getAppearance(), showTitle: value });
                })
            );

        new Setting(containerEl)
            .setName('Show description')
            .addToggle(toggle =>
                toggle.setValue(appearance.showDescription).onChange(async value => {
                    await this.plugin.persistAppearance({ ...this.plugin.getAppearance(), showDescription: value });
                })
            );

        new Setting(containerEl)
            .setName('Show date')
            .addToggle(toggle =>
                toggle.setValue(appearance.showDate).onChange(async value => {
                    await this.plugin.persistAppearance({ ...this.plugin.getAppearance(), showDate: value });
                })
            );

        new Setting(containerEl)
            .setName('Description rows')
            .setDesc('Max preview lines shown per note.')
            .addDropdown(dropdown =>
                dropdown
                    .addOption('1', '1 row')
                    .addOption('2', '2 rows')
                    .addOption('3', '3 rows')
                    .addOption('4', '4 rows')
                    .setValue(String(appearance.previewRows))
                    .onChange(async raw => {
                        const n = parseInt(raw, 10);
                        const rows: 1 | 2 | 3 | 4 = n === 1 || n === 3 || n === 4 ? n : 2;
                        await this.plugin.persistAppearance({ ...this.plugin.getAppearance(), previewRows: rows });
                    })
            );

        // ---- Always on top ----
        new Setting(containerEl).setName('Always on top').setHeading();

        const topHint = containerEl.createEl('p', {
            text:
                'Ordering between the Folders-on-top and Files-on-top groups follows the general Sort order above (e.g. in "Files first" mode, top files appear before top folders).'
        });
        topHint.style.marginTop = '0';
        topHint.style.color = 'var(--text-muted)';
        topHint.style.fontSize = 'var(--font-ui-smaller)';

        new Setting(containerEl)
            .setName('Folders on top')
            .setDesc('One folder name per line. Matching subfolders pin to the top of their parent folder. List order = display order.')
            .addTextArea(text => {
                text.setPlaceholder('_templates\nInbox')
                    .setValue(this.plugin.getTopFolderNames().join('\n'));
                text.inputEl.rows = 5;
                text.inputEl.style.width = '100%';
                text.inputEl.addEventListener('blur', async () => {
                    const names = text.getValue().split('\n');
                    await this.plugin.setTopFolderNames(names);
                });
            });

        new Setting(containerEl)
            .setName('Files on top')
            .setDesc('One filename per line (without .md). Matching files pin to the top of their parent folder. List order = display order.')
            .addTextArea(text => {
                text.setPlaceholder('index\n_overview')
                    .setValue(this.plugin.getTopFileNames().join('\n'));
                text.inputEl.rows = 5;
                text.inputEl.style.width = '100%';
                text.inputEl.addEventListener('blur', async () => {
                    const names = text.getValue().split('\n');
                    await this.plugin.setTopFileNames(names);
                });
            });

        // ---- Minimal files ----
        new Setting(containerEl).setName('Minimal files').setHeading();

        new Setting(containerEl)
            .setName('Always minimal (title only)')
            .setDesc(
                'One filename per line (without .md). Matches by name anywhere in the vault — all files sharing the listed name render as title only (no preview, no date), regardless of Appearance toggles. Pinned files follow the same rule automatically.'
            )
            .addTextArea(text => {
                text.setPlaceholder('index\nREADME')
                    .setValue(this.plugin.getMinimalNames().join('\n'));
                text.inputEl.rows = 6;
                text.inputEl.style.width = '100%';
                text.inputEl.addEventListener('blur', async () => {
                    const names = text.getValue().split('\n');
                    await this.plugin.setMinimalNames(names);
                });
            });

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
