import { App, Modal, Setting } from 'obsidian';
import type { FileTreeAppearance, PreviewRows } from './main';

function clampPreviewRows(raw: string): PreviewRows {
    const n = parseInt(raw, 10);
    if (n === 1 || n === 2 || n === 3 || n === 4) {
        return n;
    }
    return 2;
}

export function openAppearanceModal(
    app: App,
    current: FileTreeAppearance,
    onApply: (next: FileTreeAppearance) => void
): void {
    new AppearanceModal(app, current, onApply).open();
}

class AppearanceModal extends Modal {
    private readonly onApply: (next: FileTreeAppearance) => void;
    private value: FileTreeAppearance;

    constructor(app: App, initial: FileTreeAppearance, onApply: (next: FileTreeAppearance) => void) {
        super(app);
        this.value = { ...initial };
        this.onApply = onApply;
    }

    onOpen(): void {
        this.titleEl.setText('Appearance');

        new Setting(this.contentEl).setName('Show title').addToggle(toggle =>
            toggle.setValue(this.value.showTitle).onChange(v => {
                this.value = { ...this.value, showTitle: v };
                this.onApply(this.value);
            })
        );

        new Setting(this.contentEl).setName('Show description').addToggle(toggle =>
            toggle.setValue(this.value.showDescription).onChange(v => {
                this.value = { ...this.value, showDescription: v };
                this.onApply(this.value);
            })
        );

        new Setting(this.contentEl).setName('Show date').addToggle(toggle =>
            toggle.setValue(this.value.showDate).onChange(v => {
                this.value = { ...this.value, showDate: v };
                this.onApply(this.value);
            })
        );

        new Setting(this.contentEl)
            .setName('Description rows')
            .setDesc('Maximum number of preview lines per note.')
            .addDropdown(dropdown =>
                dropdown
                    .addOption('1', '1 row')
                    .addOption('2', '2 rows')
                    .addOption('3', '3 rows')
                    .addOption('4', '4 rows')
                    .setValue(String(this.value.previewRows))
                    .onChange(raw => {
                        const parsed = clampPreviewRows(raw);
                        this.value = { ...this.value, previewRows: parsed };
                        this.onApply(this.value);
                    })
            );
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
