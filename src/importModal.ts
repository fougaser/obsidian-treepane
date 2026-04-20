import { App, Modal, Notice, Setting, TFolder } from 'obsidian';

interface ImportOptions {
    file: File;
    target: TFolder;
}

export function openImportModal(app: App, options: ImportOptions): void {
    new ImportFileModal(app, options).open();
}

class ImportFileModal extends Modal {
    private readonly file: File;
    private readonly target: TFolder;
    private readonly originalBase: string;
    private readonly extension: string;
    private name: string;

    constructor(app: App, options: ImportOptions) {
        super(app);
        this.file = options.file;
        this.target = options.target;
        const { base, ext } = splitName(options.file.name);
        this.originalBase = base;
        this.extension = ext;
        this.name = base;
    }

    onOpen(): void {
        this.titleEl.setText('Import file');

        const targetPath = this.target.path === '/' || this.target.path === '' ? this.app.vault.getName() : this.target.path;
        const info = this.contentEl.createEl('p');
        info.setText(`Import "${this.file.name}" into ${targetPath}?`);
        info.style.color = 'var(--text-muted)';

        new Setting(this.contentEl)
            .setName('Filename')
            .setDesc(this.extension ? `Extension .${this.extension} is appended automatically.` : 'No extension.')
            .addText(text => {
                text.setPlaceholder(this.originalBase)
                    .setValue(this.name)
                    .onChange(value => {
                        this.name = value;
                    });
                text.inputEl.style.width = '100%';
                window.setTimeout(() => {
                    text.inputEl.focus();
                    text.inputEl.select();
                }, 0);
                text.inputEl.addEventListener('keydown', e => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        void this.save();
                    }
                });
            });

        const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
        const cancel = actions.createEl('button', { text: 'Cancel' });
        cancel.addEventListener('click', () => this.close());
        const save = actions.createEl('button', { text: 'Save', cls: 'mod-cta' });
        save.addEventListener('click', () => void this.save());
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private async save(): Promise<void> {
        const base = this.name.trim();
        if (!base) {
            new Notice('Filename cannot be empty.');
            return;
        }
        const filename = this.extension ? `${base}.${this.extension}` : base;
        const targetPath = this.target.path === '/' || this.target.path === '' ? filename : `${this.target.path}/${filename}`;
        if (this.app.vault.getAbstractFileByPath(targetPath)) {
            new Notice(`"${filename}" already exists in ${this.target.path || 'root'}.`);
            return;
        }
        try {
            const buffer = await this.file.arrayBuffer();
            await this.app.vault.createBinary(targetPath, buffer);
            new Notice(`Imported "${filename}".`);
            this.close();
        } catch (err) {
            console.error(err);
            new Notice(`Failed to import: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}

function splitName(raw: string): { base: string; ext: string } {
    const dot = raw.lastIndexOf('.');
    if (dot <= 0 || dot === raw.length - 1) {
        return { base: raw, ext: '' };
    }
    return { base: raw.slice(0, dot), ext: raw.slice(dot + 1) };
}
