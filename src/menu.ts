import { App, FileSystemAdapter, Menu, Modal, Notice, Setting, TAbstractFile, TFile, TFolder } from 'obsidian';
import type FileTreePlugin from './main';

export function openContextMenu(
    app: App,
    plugin: FileTreePlugin,
    target: TAbstractFile | null,
    evt: MouseEvent
): void {
    const menu = new Menu();

    const folderForNew: TFolder | null = target instanceof TFolder
        ? target
        : target?.parent ?? app.vault.getRoot();

    if (folderForNew) {
        menu.addItem(item =>
            item
                .setTitle('New note')
                .setIcon('file-plus')
                .onClick(() => {
                    void createNewNote(app, folderForNew);
                })
        );
        menu.addItem(item =>
            item
                .setTitle('New folder')
                .setIcon('folder-plus')
                .onClick(() => {
                    openPromptModal(app, {
                        title: 'New folder',
                        placeholder: 'Folder name',
                        initial: '',
                        submitLabel: 'Create',
                        onSubmit: async value => {
                            const trimmed = value.trim();
                            if (!trimmed) {
                                return;
                            }
                            const newPath = folderForNew.path === '/' ? trimmed : `${folderForNew.path}/${trimmed}`;
                            if (app.vault.getAbstractFileByPath(newPath)) {
                                new Notice(`"${trimmed}" already exists.`);
                                return;
                            }
                            await app.vault.createFolder(newPath);
                        }
                    });
                })
        );
    }

    if (target instanceof TFolder && target !== app.vault.getRoot()) {
        menu.addSeparator();
        menu.addItem(item =>
            item
                .setTitle('Change icon')
                .setIcon('image')
                .onClick(() => {
                    const currentIcon = plugin.getFolderIcon(target.path) ?? '';
                    openPromptModal(app, {
                        title: 'Folder icon',
                        placeholder: 'Lucide icon name (e.g. briefcase, users, target)',
                        initial: currentIcon,
                        submitLabel: 'Set',
                        onSubmit: async value => {
                            const trimmed = value.trim();
                            await plugin.setFolderIcon(target.path, trimmed || null);
                        }
                    });
                })
        );
        if (plugin.getFolderIcon(target.path)) {
            menu.addItem(item =>
                item
                    .setTitle('Reset icon')
                    .setIcon('rotate-ccw')
                    .onClick(() => {
                        void plugin.setFolderIcon(target.path, null);
                    })
            );
        }
    }

    if (target && !(target === app.vault.getRoot())) {
        menu.addSeparator();
        menu.addItem(item =>
            item
                .setTitle('Rename')
                .setIcon('pencil')
                .onClick(() => {
                    const initial = target instanceof TFile ? target.basename : target.name;
                    openPromptModal(app, {
                        title: 'Rename',
                        placeholder: 'New name',
                        initial,
                        submitLabel: 'Rename',
                        onSubmit: async value => {
                            const trimmed = value.trim();
                            if (!trimmed || trimmed === initial) {
                                return;
                            }
                            const parentPath = target.parent?.path ?? '';
                            const extension = target instanceof TFile ? `.${target.extension}` : '';
                            const newName = `${trimmed}${extension}`;
                            const newPath = parentPath && parentPath !== '/' ? `${parentPath}/${newName}` : newName;
                            if (app.vault.getAbstractFileByPath(newPath)) {
                                new Notice(`"${newName}" already exists.`);
                                return;
                            }
                            await app.fileManager.renameFile(target, newPath);
                        }
                    });
                })
        );
        menu.addItem(item =>
            item
                .setTitle('Delete')
                .setIcon('trash')
                .onClick(() => {
                    void app.fileManager.trashFile(target);
                })
        );

        const adapter = app.vault.adapter;
        if (adapter instanceof FileSystemAdapter) {
            menu.addSeparator();
            menu.addItem(item =>
                item
                    .setTitle('Reveal in Finder')
                    .setIcon('arrow-up-right')
                    .onClick(() => {
                        // Obsidian exposes showInFolder on the app (desktop only).
                        type MaybeShowInFolder = { showInFolder?: (p: string) => void };
                        const maybe = app as unknown as MaybeShowInFolder;
                        if (typeof maybe.showInFolder === 'function') {
                            maybe.showInFolder(adapter.getFullPath(target.path));
                        }
                    })
            );
        }
    }

    menu.showAtMouseEvent(evt);
}

async function createNewNote(app: App, folder: TFolder): Promise<void> {
    // createNewMarkdownFile is a real runtime API but missing from the public types.
    type CreateApi = { createNewMarkdownFile?: (folder: TFolder, filename: string) => Promise<TFile> };
    const manager = app.fileManager as unknown as CreateApi;
    let file: TFile | null = null;
    if (typeof manager.createNewMarkdownFile === 'function') {
        file = await manager.createNewMarkdownFile(folder, 'Untitled');
    } else {
        const basePath = folder.path === '/' ? 'Untitled' : `${folder.path}/Untitled`;
        let candidate = `${basePath}.md`;
        let counter = 1;
        while (app.vault.getAbstractFileByPath(candidate)) {
            candidate = `${basePath} ${counter++}.md`;
        }
        file = await app.vault.create(candidate, '');
    }
    if (file) {
        await app.workspace.getLeaf().openFile(file);
    }
}

interface PromptOptions {
    title: string;
    placeholder: string;
    initial: string;
    submitLabel: string;
    onSubmit: (value: string) => void | Promise<void>;
}

function openPromptModal(app: App, options: PromptOptions): void {
    new PromptModal(app, options).open();
}

class PromptModal extends Modal {
    private readonly options: PromptOptions;
    private value: string;

    constructor(app: App, options: PromptOptions) {
        super(app);
        this.options = options;
        this.value = options.initial;
    }

    onOpen(): void {
        this.titleEl.setText(this.options.title);
        const form = this.contentEl.createEl('form');
        form.style.display = 'flex';
        form.style.flexDirection = 'column';
        form.style.gap = '12px';

        new Setting(form).addText(text => {
            text.setPlaceholder(this.options.placeholder)
                .setValue(this.options.initial)
                .onChange(v => {
                    this.value = v;
                });
            text.inputEl.style.width = '100%';
            window.setTimeout(() => {
                text.inputEl.focus();
                text.inputEl.select();
            }, 0);
        });

        const actions = form.createDiv({ cls: 'modal-button-container' });
        const cancel = actions.createEl('button', { text: 'Cancel' });
        cancel.type = 'button';
        cancel.addEventListener('click', () => this.close());
        const submit = actions.createEl('button', { text: this.options.submitLabel, cls: 'mod-cta' });
        submit.type = 'submit';

        form.addEventListener('submit', async e => {
            e.preventDefault();
            const value = this.value;
            this.close();
            await this.options.onSubmit(value);
        });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
