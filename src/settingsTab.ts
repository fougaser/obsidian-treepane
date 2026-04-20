import { AbstractInputSuggest, App, PluginSettingTab, Setting, TFolder, setIcon } from 'obsidian';
import type FileTreePlugin from './main';
import type { DefaultFolderIconEntry, Grouping, SortBy } from './main';
import { GROUPING_LABELS, SORT_BY_LABELS } from './main';
import { IconPickerModal } from './iconPickerModal';

interface DefaultIconRow {
    name: string;
    icon: string;
    color: string | null;
}

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
            .setName('Show first')
            .setDesc('Whether folders or files come first within each parent, or both interleave.')
            .addDropdown(dropdown => {
                for (const value of Object.keys(GROUPING_LABELS) as Grouping[]) {
                    dropdown.addOption(value, GROUPING_LABELS[value]);
                }
                dropdown.setValue(this.plugin.getGrouping()).onChange(async value => {
                    await this.plugin.setGrouping(value as Grouping);
                });
            });

        new Setting(containerEl)
            .setName('Sort by')
            .setDesc(
                'Ordering within each group. Dates come from each file\u2019s metadata; folders fall back to name order when sorting by date.'
            )
            .addDropdown(dropdown => {
                for (const value of Object.keys(SORT_BY_LABELS) as SortBy[]) {
                    dropdown.addOption(value, SORT_BY_LABELS[value]);
                }
                dropdown.setValue(this.plugin.getSortBy()).onChange(async value => {
                    await this.plugin.setSortBy(value as SortBy);
                });
            });

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

        // ---- Default folder icons by name ----
        new Setting(containerEl).setName('Default folder icons by name').setHeading();

        const defaultHint = containerEl.createEl('p', {
            text:
                'Folders matching any of these names (case-insensitive) get this icon and color by default. Icons you set manually via the icon picker always win over these defaults.'
        });
        defaultHint.style.marginTop = '0';
        defaultHint.style.color = 'var(--text-muted)';
        defaultHint.style.fontSize = 'var(--font-ui-smaller)';

        this.renderDefaultIconList(containerEl);

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

    /**
     * Editable list of (folder name → icon + color) defaults. Each entry has its own
     * name input, an icon swatch that opens the IconPickerModal, and a delete button.
     * "+" at the bottom appends a fresh row. Changes persist on blur / modal confirm.
     */
    private renderDefaultIconList(parent: HTMLElement): void {
        const section = parent.createDiv({ cls: 'ft-default-icons' });
        section.style.display = 'flex';
        section.style.flexDirection = 'column';
        section.style.gap = '6px';
        section.style.margin = '4px 0 12px';

        const listEl = section.createDiv();
        listEl.style.display = 'flex';
        listEl.style.flexDirection = 'column';
        listEl.style.gap = '6px';

        const stored = this.plugin.getDefaultFolderIcons();
        const rows: DefaultIconRow[] = Object.entries(stored).map(([name, entry]) => ({
            name,
            icon: entry.icon,
            color: entry.color ?? null
        }));

        const persist = async () => {
            const map: Record<string, DefaultFolderIconEntry> = {};
            for (const row of rows) {
                const name = row.name.trim().toLowerCase();
                if (!name || !row.icon) {
                    continue;
                }
                map[name] = { icon: row.icon, color: row.color };
            }
            await this.plugin.setDefaultFolderIcons(map);
        };

        const draw = () => {
            listEl.empty();
            rows.forEach((row, index) => this.renderDefaultIconRow(listEl, row, index, rows, draw, persist));
        };

        draw();

        const addBtn = section.createEl('button', { text: '+ Add folder name' });
        addBtn.style.alignSelf = 'flex-start';
        addBtn.addEventListener('click', () => {
            rows.push({ name: '', icon: 'folder', color: null });
            draw();
            void persist();
        });
    }

    private renderDefaultIconRow(
        parent: HTMLElement,
        row: DefaultIconRow,
        index: number,
        rows: DefaultIconRow[],
        draw: () => void,
        persist: () => Promise<void>
    ): void {
        const line = parent.createDiv();
        line.style.display = 'flex';
        line.style.alignItems = 'center';
        line.style.gap = '8px';

        const swatch = line.createSpan({ cls: 'ft-default-icon-swatch' });
        swatch.setAttr('role', 'button');
        swatch.title = 'Change icon and color';
        swatch.style.display = 'inline-flex';
        swatch.style.alignItems = 'center';
        swatch.style.justifyContent = 'center';
        swatch.style.width = '28px';
        swatch.style.height = '28px';
        swatch.style.borderRadius = '6px';
        swatch.style.border = '1px solid var(--background-modifier-border)';
        swatch.style.cursor = 'pointer';
        swatch.style.flex = '0 0 auto';
        setIcon(swatch, row.icon || 'folder');
        if (row.color) {
            swatch.style.color = row.color;
        }
        swatch.addEventListener('click', () => {
            new IconPickerModal(this.app, {
                currentIconId: row.icon || null,
                currentColor: row.color,
                onPick: (iconId, color) => {
                    row.icon = iconId ?? 'folder';
                    row.color = color;
                    draw();
                    void persist();
                }
            }).open();
        });

        const input = line.createEl('input', { type: 'text' });
        input.placeholder = 'Folder name (e.g. Projects)';
        input.value = row.name;
        input.style.flex = '1 1 auto';
        input.addEventListener('change', () => {
            row.name = input.value;
            void persist();
        });
        input.addEventListener('blur', () => {
            if (row.name !== input.value) {
                row.name = input.value;
                void persist();
            }
        });

        const removeBtn = line.createEl('button');
        removeBtn.setAttr('aria-label', 'Remove');
        removeBtn.title = 'Remove';
        removeBtn.style.flex = '0 0 auto';
        setIcon(removeBtn, 'trash');
        removeBtn.addEventListener('click', () => {
            rows.splice(index, 1);
            draw();
            void persist();
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
