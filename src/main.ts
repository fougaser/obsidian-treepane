import { Plugin, WorkspaceLeaf } from 'obsidian';
import { FILE_TREE_VIEW_TYPE, FileTreeView } from './view';
import { FileTreeSettingTab } from './settingsTab';

export interface FileTreeAppearance {
    showTitle: boolean;
    showDescription: boolean;
    showDate: boolean;
    previewRows: 1 | 2;
}

export type SortMode = 'alphabet' | 'folders-first' | 'files-first';

interface FileTreeData {
    expanded: string[];
    viewRoot: string;
    defaultRoot: string;
    defaultFiletreeView: boolean;
    folderIcons: Record<string, string>;
    folderColors: Record<string, string>;
    seededFolderIcons: boolean;
    seededSecondLevel: boolean;
    /** One-time migration flag — true after non-root folder colors were wiped. */
    clearedNonRootColors: boolean;
    pinnedPaths: string[];
    starredFiles: string[];
    sortMode: SortMode;
    appearance: FileTreeAppearance;
}

/**
 * Fixed pastel palette offered in the icon picker. Users can also type any custom color.
 */
export const PASTEL_PALETTE: readonly string[] = Object.freeze([
    '#F8C8DC', // pink
    '#FFC6FF', // rose
    '#FFADAD', // coral
    '#FFD6A5', // peach
    '#FDFFB6', // lemon
    '#CAFFBF', // mint
    '#9BF6FF', // sky
    '#A0C4FF', // blue
    '#BDB2FF', // lavender
    '#C1B2FF', // periwinkle
    '#B5EAD7', // sage
    '#FFB7B2'  // apricot
]);

const DEFAULT_APPEARANCE: FileTreeAppearance = {
    showTitle: true,
    showDescription: true,
    showDate: true,
    previewRows: 2
};

// First-run seed — if these top-level folders exist in the vault they get meaningful icons.
// Users can override any of them through the "Change icon" action on a folder row.
const SEEDED_FOLDER_ICONS: Record<string, string> = {
    'Проекты': 'briefcase',
    'Сеть': 'users',
    'Звонки': 'phone',
    'Цели': 'target',
    'Финансы': 'wallet',
    'Знания': 'book-open',
    'Личное': 'heart'
};

// Second-level seed — user-specific (Scriptorium vault). Icons only; colors are intentionally
// reserved for root-level folders per user preference. Harmless on vaults that don't have
// these exact paths — seeds skip missing folders.
const SEEDED_SECOND_LEVEL: Record<string, string> = {
    // Сеть
    'Сеть/Команда': 'users-round',
    'Сеть/Партнёры': 'handshake',
    'Сеть/Клиенты': 'user-check',
    'Сеть/Наставники': 'graduation-cap',
    'Сеть/Лиды': 'zap',
    'Сеть/Сообщество': 'globe',
    'Сеть/Организации': 'building-2',

    // Знания
    'Знания/Дизайн': 'palette',
    'Знания/Разработка': 'code',
    'Знания/Продуктивность': 'timer',
    'Знания/Промпты': 'message-square',

    // Личное
    'Личное/Гитара': 'music',
    'Личное/Психология': 'brain',
    'Личное/Покупки': 'shopping-cart',

    // Звонки
    'Звонки/Транскрипты': 'mic',
    'Звонки/Обработанные': 'sparkles',

    // Финансы
    'Финансы/Платежи': 'receipt',
    'Финансы/Расходы': 'minus-circle'
};

const DEFAULT_DATA: FileTreeData = {
    expanded: [],
    viewRoot: '/',
    defaultRoot: '/',
    defaultFiletreeView: true,
    folderIcons: {},
    folderColors: {},
    seededFolderIcons: false,
    seededSecondLevel: false,
    clearedNonRootColors: false,
    pinnedPaths: [],
    starredFiles: [],
    sortMode: 'folders-first',
    appearance: DEFAULT_APPEARANCE
};

function normalizeSortMode(value: unknown): SortMode {
    if (value === 'alphabet' || value === 'folders-first' || value === 'files-first') {
        return value;
    }
    return 'folders-first';
}

export default class FileTreePlugin extends Plugin {
    private data: FileTreeData = DEFAULT_DATA;

    async onload(): Promise<void> {
        const stored = (await this.loadData()) as Partial<FileTreeData> | null;
        this.data = {
            expanded: Array.isArray(stored?.expanded) ? stored!.expanded!.filter(p => typeof p === 'string') : [],
            viewRoot: typeof stored?.viewRoot === 'string' ? stored!.viewRoot! : '/',
            defaultRoot: typeof stored?.defaultRoot === 'string' ? stored!.defaultRoot! : '/',
            defaultFiletreeView: typeof stored?.defaultFiletreeView === 'boolean' ? stored!.defaultFiletreeView! : true,
            folderIcons: this.sanitizeFolderIcons(stored?.folderIcons),
            folderColors: this.sanitizeFolderIcons(stored?.folderColors),
            seededFolderIcons: stored?.seededFolderIcons === true,
            seededSecondLevel: stored?.seededSecondLevel === true,
            clearedNonRootColors: stored?.clearedNonRootColors === true,
            pinnedPaths: Array.isArray(stored?.pinnedPaths) ? stored!.pinnedPaths!.filter(p => typeof p === 'string') : [],
            starredFiles: Array.isArray(stored?.starredFiles) ? stored!.starredFiles!.filter(p => typeof p === 'string') : [],
            sortMode: normalizeSortMode(stored?.sortMode),
            appearance: { ...DEFAULT_APPEARANCE, ...(stored?.appearance ?? {}) }
        };

        // Seed folder icons for known top-level folders on first install only. Keyed by a
        // separate flag so user-cleared icons are not re-added on every load.
        if (!this.data.seededFolderIcons) {
            const merged = { ...this.data.folderIcons };
            for (const [path, icon] of Object.entries(SEEDED_FOLDER_ICONS)) {
                if (merged[path] === undefined) {
                    merged[path] = icon;
                }
            }
            this.data = { ...this.data, folderIcons: merged, seededFolderIcons: true };
            await this.saveData(this.data);
        }

        // Seed second-level folder icons for user's vault. Only paths that actually exist
        // get the icon; stray seeds are harmless. Colors are intentionally not seeded here —
        // see the migration below.
        if (!this.data.seededSecondLevel) {
            const icons = { ...this.data.folderIcons };
            for (const [path, icon] of Object.entries(SEEDED_SECOND_LEVEL)) {
                if (icons[path] === undefined) {
                    icons[path] = icon;
                }
            }
            this.data = { ...this.data, folderIcons: icons, seededSecondLevel: true };
            await this.saveData(this.data);
        }

        // One-time migration: drop any folderColors on non-root folders (paths containing '/').
        // Personal preference — earlier builds seeded colors for second-level folders; this
        // clears them. Guarded by a flag so future manual non-root colors survive reloads.
        if (!this.data.clearedNonRootColors) {
            const colors = { ...this.data.folderColors };
            Object.keys(colors)
                .filter(p => p.includes('/'))
                .forEach(p => delete colors[p]);
            this.data = { ...this.data, folderColors: colors, clearedNonRootColors: true };
            await this.saveData(this.data);
        }

        this.registerView(FILE_TREE_VIEW_TYPE, leaf => new FileTreeView(leaf, this));
        this.addSettingTab(new FileTreeSettingTab(this.app, this));

        this.registerEvent(
            this.app.workspace.on('active-leaf-change', leaf => {
                if (!this.data.defaultFiletreeView) {
                    return;
                }
                if (!leaf) {
                    return;
                }
                const type = leaf.view?.getViewType?.();
                if (type !== 'file-explorer') {
                    return;
                }
                const ownLeaves = this.app.workspace.getLeavesOfType(FILE_TREE_VIEW_TYPE);
                if (ownLeaves.length === 0) {
                    return;
                }
                this.app.workspace.revealLeaf(ownLeaves[0]);
            })
        );

        this.app.workspace.onLayoutReady(() => {
            if (this.data.defaultFiletreeView) {
                void this.activateView();
            }
        });
    }

    async onunload(): Promise<void> {
        // Leaves stay registered; Obsidian detaches them.
    }

    getPersistedExpanded(): string[] {
        return this.data.expanded;
    }

    getPersistedViewRoot(): string {
        return this.data.viewRoot;
    }

    getAppearance(): FileTreeAppearance {
        return this.data.appearance;
    }

    getDefaultRoot(): string {
        return this.data.defaultRoot;
    }

    async setDefaultRoot(path: string): Promise<void> {
        const normalized = path === '' ? '/' : path;
        if (this.data.defaultRoot === normalized) {
            return;
        }
        this.data = { ...this.data, defaultRoot: normalized };
        await this.saveData(this.data);
    }

    getDefaultFiletreeView(): boolean {
        return this.data.defaultFiletreeView;
    }

    async setDefaultFiletreeView(value: boolean): Promise<void> {
        if (this.data.defaultFiletreeView === value) {
            return;
        }
        this.data = { ...this.data, defaultFiletreeView: value };
        await this.saveData(this.data);
        if (value) {
            void this.activateView();
        }
    }

    async persistExpanded(paths: string[]): Promise<void> {
        this.data = { ...this.data, expanded: paths };
        await this.saveData(this.data);
    }

    async persistViewRoot(path: string): Promise<void> {
        this.data = { ...this.data, viewRoot: path };
        await this.saveData(this.data);
    }

    getSortMode(): SortMode {
        return this.data.sortMode;
    }

    async setSortMode(mode: SortMode): Promise<void> {
        if (this.data.sortMode === mode) {
            return;
        }
        this.data = { ...this.data, sortMode: mode };
        await this.saveData(this.data);
        this.app.workspace.getLeavesOfType(FILE_TREE_VIEW_TYPE).forEach(leaf => {
            const view = leaf.view;
            if (view instanceof FileTreeView) {
                view.onAppearanceChanged();
            }
        });
    }

    getFolderIcon(path: string): string | null {
        const icon = this.data.folderIcons[path];
        return typeof icon === 'string' && icon.length > 0 ? icon : null;
    }

    async setFolderIcon(path: string, icon: string | null): Promise<void> {
        const next = { ...this.data.folderIcons };
        if (icon && icon.length > 0) {
            next[path] = icon;
        } else {
            delete next[path];
        }
        this.data = { ...this.data, folderIcons: next };
        await this.saveData(this.data);
        this.notifyViews();
    }

    getFolderColor(path: string): string | null {
        const color = this.data.folderColors[path];
        return typeof color === 'string' && color.length > 0 ? color : null;
    }

    async setFolderColor(path: string, color: string | null): Promise<void> {
        const next = { ...this.data.folderColors };
        if (color && color.length > 0) {
            next[path] = color;
        } else {
            delete next[path];
        }
        this.data = { ...this.data, folderColors: next };
        await this.saveData(this.data);
        this.notifyViews();
    }

    getPinnedPaths(): string[] {
        return this.data.pinnedPaths;
    }

    isPinned(path: string): boolean {
        return this.data.pinnedPaths.includes(path);
    }

    async togglePin(path: string): Promise<void> {
        const list = this.data.pinnedPaths.filter(p => p !== path);
        if (list.length === this.data.pinnedPaths.length) {
            list.push(path); // wasn't pinned — append
        }
        this.data = { ...this.data, pinnedPaths: list };
        await this.saveData(this.data);
        this.notifyViews();
    }

    async movePinnedPath(path: string, direction: 'up' | 'down'): Promise<void> {
        const list = [...this.data.pinnedPaths];
        const idx = list.indexOf(path);
        if (idx < 0) {
            return;
        }
        const swap = direction === 'up' ? idx - 1 : idx + 1;
        if (swap < 0 || swap >= list.length) {
            return;
        }
        const tmp = list[idx];
        list[idx] = list[swap];
        list[swap] = tmp;
        this.data = { ...this.data, pinnedPaths: list };
        await this.saveData(this.data);
        this.notifyViews();
    }

    async reorderPinnedPaths(next: string[]): Promise<void> {
        this.data = { ...this.data, pinnedPaths: next };
        await this.saveData(this.data);
        this.notifyViews();
    }

    isStarred(path: string): boolean {
        return this.data.starredFiles.includes(path);
    }

    async toggleStar(path: string): Promise<void> {
        const list = this.data.starredFiles.filter(p => p !== path);
        if (list.length === this.data.starredFiles.length) {
            list.push(path);
        }
        this.data = { ...this.data, starredFiles: list };
        await this.saveData(this.data);
        this.notifyViews();
    }

    private notifyViews(): void {
        this.app.workspace.getLeavesOfType(FILE_TREE_VIEW_TYPE).forEach(leaf => {
            const view = leaf.view;
            if (view instanceof FileTreeView) {
                view.onAppearanceChanged();
            }
        });
    }

    private sanitizeFolderIcons(raw: unknown): Record<string, string> {
        if (!raw || typeof raw !== 'object') {
            return {};
        }
        const out: Record<string, string> = {};
        for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
            if (typeof key === 'string' && typeof value === 'string' && value.length > 0) {
                out[key] = value;
            }
        }
        return out;
    }

    async persistAppearance(next: FileTreeAppearance): Promise<void> {
        this.data = { ...this.data, appearance: next };
        await this.saveData(this.data);
        this.app.workspace.getLeavesOfType(FILE_TREE_VIEW_TYPE).forEach(leaf => {
            const view = leaf.view;
            if (view instanceof FileTreeView) {
                view.onAppearanceChanged();
            }
        });
    }

    private async activateView(): Promise<void> {
        const existing = this.app.workspace.getLeavesOfType(FILE_TREE_VIEW_TYPE);
        let leaf: WorkspaceLeaf | null;
        if (existing.length > 0) {
            leaf = existing[0];
        } else {
            leaf = this.app.workspace.getLeftLeaf(false);
            if (leaf) {
                await leaf.setViewState({ type: FILE_TREE_VIEW_TYPE, active: true });
            }
        }
        if (leaf) {
            this.app.workspace.revealLeaf(leaf);
        }
    }
}
