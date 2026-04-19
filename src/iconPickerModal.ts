import { App, Modal, getIconIds, setIcon } from 'obsidian';

export interface IconPickerOptions {
    currentIconId?: string | null;
    onPick: (iconId: string | null) => void;
}

const GRID_MIN_ITEM_WIDTH = '48px';

export class IconPickerModal extends Modal {
    private readonly opts: IconPickerOptions;
    private searchInput!: HTMLInputElement;
    private gridEl!: HTMLElement;
    private allIcons: string[] = [];

    constructor(app: App, opts: IconPickerOptions) {
        super(app);
        this.opts = opts;
    }

    onOpen(): void {
        this.titleEl.setText('Choose an icon');

        const search = this.contentEl.createDiv({ cls: 'ft-icon-picker-search' });
        search.style.display = 'flex';
        search.style.alignItems = 'center';
        search.style.gap = '8px';
        search.style.marginBottom = '12px';

        this.searchInput = search.createEl('input', { type: 'text' });
        this.searchInput.placeholder = 'Filter icons (e.g. briefcase, folder, target)';
        this.searchInput.style.flex = '1 1 auto';
        this.searchInput.addEventListener('input', () => this.renderGrid(this.searchInput.value));

        const resetBtn = search.createEl('button', { text: 'Reset' });
        resetBtn.addEventListener('click', () => {
            this.opts.onPick(null);
            this.close();
        });

        this.gridEl = this.contentEl.createDiv({ cls: 'ft-icon-picker-grid' });
        this.gridEl.style.display = 'grid';
        this.gridEl.style.gridTemplateColumns = `repeat(auto-fill, minmax(${GRID_MIN_ITEM_WIDTH}, 1fr))`;
        this.gridEl.style.gap = '6px';
        this.gridEl.style.maxHeight = '420px';
        this.gridEl.style.overflowY = 'auto';
        this.gridEl.style.padding = '4px';

        this.allIcons = getIconIds().sort((a, b) => a.localeCompare(b));
        this.renderGrid('');

        window.setTimeout(() => this.searchInput.focus(), 0);
    }

    onClose(): void {
        this.contentEl.empty();
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
            cell.style.color = 'var(--text-muted)';
            cell.setAttr('aria-label', iconId);
            cell.title = iconId;

            if (this.opts.currentIconId && this.opts.currentIconId === iconId) {
                cell.style.backgroundColor = 'var(--background-modifier-hover)';
                cell.style.color = 'var(--text-accent)';
            }

            const iconEl = cell.createSpan();
            iconEl.style.width = '20px';
            iconEl.style.height = '20px';
            iconEl.style.display = 'inline-flex';
            iconEl.style.alignItems = 'center';
            iconEl.style.justifyContent = 'center';
            setIcon(iconEl, iconId);

            const label = cell.createSpan({ text: iconId });
            label.style.fontSize = '9px';
            label.style.textAlign = 'center';
            label.style.overflow = 'hidden';
            label.style.textOverflow = 'ellipsis';
            label.style.whiteSpace = 'nowrap';
            label.style.maxWidth = '100%';

            cell.addEventListener('mouseenter', () => {
                cell.style.backgroundColor = 'var(--background-modifier-hover)';
            });
            cell.addEventListener('mouseleave', () => {
                if (!(this.opts.currentIconId && this.opts.currentIconId === iconId)) {
                    cell.style.backgroundColor = '';
                }
            });
            cell.addEventListener('click', () => {
                this.opts.onPick(iconId);
                this.close();
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
