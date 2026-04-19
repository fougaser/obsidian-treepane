import { App, Modal, getIconIds, setIcon } from 'obsidian';
import { PASTEL_PALETTE } from './main';

export interface IconPickerOptions {
    currentIconId?: string | null;
    currentColor?: string | null;
    onPick: (iconId: string | null, color: string | null) => void;
}

const GRID_MIN_ITEM_WIDTH = '48px';

export class IconPickerModal extends Modal {
    private readonly opts: IconPickerOptions;
    private searchInput!: HTMLInputElement;
    private gridEl!: HTMLElement;
    private allIcons: string[] = [];
    private selectedIconId: string | null;
    private selectedColor: string | null;

    constructor(app: App, opts: IconPickerOptions) {
        super(app);
        this.opts = opts;
        this.selectedIconId = opts.currentIconId ?? null;
        this.selectedColor = opts.currentColor ?? null;
    }

    onOpen(): void {
        this.titleEl.setText('Folder icon');

        // --- Color palette ---
        const colorSection = this.contentEl.createDiv({ cls: 'ft-icon-picker-section' });
        colorSection.createEl('div', { text: 'Color', cls: 'ft-icon-picker-label' });
        const swatches = colorSection.createDiv({ cls: 'ft-icon-picker-swatches' });
        swatches.style.display = 'flex';
        swatches.style.flexWrap = 'wrap';
        swatches.style.gap = '6px';
        swatches.style.marginBottom = '8px';

        const renderSwatch = (color: string | null, label: string) => {
            const el = swatches.createDiv({ cls: 'ft-icon-picker-swatch' });
            el.setAttr('aria-label', label);
            el.title = label;
            el.style.width = '22px';
            el.style.height = '22px';
            el.style.borderRadius = '50%';
            el.style.cursor = 'pointer';
            el.style.border = '2px solid transparent';
            if (color === null) {
                el.style.background =
                    'linear-gradient(45deg, var(--background-modifier-border) 45%, transparent 45%, transparent 55%, var(--background-modifier-border) 55%)';
            } else {
                el.style.backgroundColor = color;
            }
            const isSelected = (color === null && this.selectedColor === null) || color === this.selectedColor;
            if (isSelected) {
                el.style.borderColor = 'var(--text-accent)';
            }
            el.addEventListener('click', () => {
                this.selectedColor = color;
                this.renderColorSwatches(swatches, customInput);
                this.renderGrid(this.searchInput.value);
            });
            return el;
        };
        renderSwatch(null, 'Default (inherit)');
        PASTEL_PALETTE.forEach(c => renderSwatch(c, c));

        const customRow = colorSection.createDiv();
        customRow.style.display = 'flex';
        customRow.style.alignItems = 'center';
        customRow.style.gap = '8px';
        customRow.style.marginBottom = '12px';

        customRow.createEl('label', { text: 'Custom:' });
        const customInput = customRow.createEl('input', { type: 'color' });
        customInput.value = this.selectedColor && this.selectedColor.startsWith('#') ? this.selectedColor : '#CAFFBF';
        customInput.addEventListener('input', () => {
            this.selectedColor = customInput.value;
            this.renderColorSwatches(swatches, customInput);
            this.renderGrid(this.searchInput.value);
        });
        const hexLabel = customRow.createEl('span');
        hexLabel.style.fontFamily = 'var(--font-monospace, monospace)';
        hexLabel.style.fontSize = '11px';
        hexLabel.style.color = 'var(--text-muted)';
        hexLabel.setText(this.selectedColor ?? '—');
        customInput.addEventListener('input', () => {
            hexLabel.setText(customInput.value);
        });

        // --- Search + icon grid ---
        const search = this.contentEl.createDiv({ cls: 'ft-icon-picker-search' });
        search.style.display = 'flex';
        search.style.alignItems = 'center';
        search.style.gap = '8px';
        search.style.marginBottom = '8px';

        this.searchInput = search.createEl('input', { type: 'text' });
        this.searchInput.placeholder = 'Filter icons (e.g. briefcase, folder, target)';
        this.searchInput.style.flex = '1 1 auto';
        this.searchInput.addEventListener('input', () => this.renderGrid(this.searchInput.value));

        const applyBtn = search.createEl('button', { text: 'Apply', cls: 'mod-cta' });
        applyBtn.addEventListener('click', () => {
            this.opts.onPick(this.selectedIconId, this.selectedColor);
            this.close();
        });

        const resetBtn = search.createEl('button', { text: 'Reset' });
        resetBtn.addEventListener('click', () => {
            this.opts.onPick(null, null);
            this.close();
        });

        this.gridEl = this.contentEl.createDiv({ cls: 'ft-icon-picker-grid' });
        this.gridEl.style.display = 'grid';
        this.gridEl.style.gridTemplateColumns = `repeat(auto-fill, minmax(${GRID_MIN_ITEM_WIDTH}, 1fr))`;
        this.gridEl.style.gap = '6px';
        this.gridEl.style.maxHeight = '360px';
        this.gridEl.style.overflowY = 'auto';
        this.gridEl.style.padding = '4px';

        this.allIcons = getIconIds().sort((a, b) => a.localeCompare(b));
        this.renderGrid('');

        window.setTimeout(() => this.searchInput.focus(), 0);
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private renderColorSwatches(swatches: HTMLElement, customInput: HTMLInputElement): void {
        swatches.empty();
        const renderSwatch = (color: string | null, label: string) => {
            const el = swatches.createDiv({ cls: 'ft-icon-picker-swatch' });
            el.setAttr('aria-label', label);
            el.title = label;
            el.style.width = '22px';
            el.style.height = '22px';
            el.style.borderRadius = '50%';
            el.style.cursor = 'pointer';
            el.style.border = '2px solid transparent';
            if (color === null) {
                el.style.background =
                    'linear-gradient(45deg, var(--background-modifier-border) 45%, transparent 45%, transparent 55%, var(--background-modifier-border) 55%)';
            } else {
                el.style.backgroundColor = color;
            }
            const isSelected = (color === null && this.selectedColor === null) || color === this.selectedColor;
            if (isSelected) {
                el.style.borderColor = 'var(--text-accent)';
            }
            el.addEventListener('click', () => {
                this.selectedColor = color;
                if (color) {
                    customInput.value = color;
                }
                this.renderColorSwatches(swatches, customInput);
                this.renderGrid(this.searchInput.value);
            });
        };
        renderSwatch(null, 'Default');
        PASTEL_PALETTE.forEach(c => renderSwatch(c, c));
    }

    private renderGrid(query: string): void {
        this.gridEl.empty();
        const filter = query.trim().toLowerCase();
        const matches = filter.length === 0
            ? this.allIcons
            : this.allIcons.filter(id => id.toLowerCase().includes(filter));
        const capped = matches.slice(0, 400);

        capped.forEach(iconId => {
            const cell = this.gridEl.createDiv({ cls: 'ft-icon-picker-cell' });
            cell.style.display = 'flex';
            cell.style.flexDirection = 'column';
            cell.style.alignItems = 'center';
            cell.style.justifyContent = 'center';
            cell.style.padding = '8px 4px';
            cell.style.borderRadius = '6px';
            cell.style.cursor = 'pointer';
            cell.style.gap = '4px';
            cell.style.color = this.selectedColor ?? 'var(--text-muted)';
            cell.setAttr('aria-label', iconId);
            cell.title = iconId;

            if (this.selectedIconId === iconId) {
                cell.style.backgroundColor = 'var(--background-modifier-hover)';
            }

            const iconEl = cell.createSpan();
            iconEl.style.width = '20px';
            iconEl.style.height = '20px';
            iconEl.style.display = 'inline-flex';
            iconEl.style.alignItems = 'center';
            iconEl.style.justifyContent = 'center';
            if (this.selectedColor) {
                iconEl.style.color = this.selectedColor;
            }
            setIcon(iconEl, iconId);

            const label = cell.createSpan({ text: iconId });
            label.style.fontSize = '9px';
            label.style.textAlign = 'center';
            label.style.overflow = 'hidden';
            label.style.textOverflow = 'ellipsis';
            label.style.whiteSpace = 'nowrap';
            label.style.maxWidth = '100%';
            label.style.color = 'var(--text-muted)';

            cell.addEventListener('click', () => {
                this.selectedIconId = iconId;
                this.renderGrid(this.searchInput.value);
            });
        });

        if (capped.length === 0) {
            const empty = this.gridEl.createDiv({ text: 'No icons match.' });
            empty.style.gridColumn = '1 / -1';
            empty.style.textAlign = 'center';
            empty.style.color = 'var(--text-muted)';
            empty.style.padding = '24px 0';
        }

        if (matches.length > capped.length) {
            const note = this.gridEl.createDiv({ text: `+${matches.length - capped.length} more — refine your search` });
            note.style.gridColumn = '1 / -1';
            note.style.textAlign = 'center';
            note.style.color = 'var(--text-muted)';
            note.style.fontSize = '11px';
            note.style.padding = '8px 0';
        }
    }
}
