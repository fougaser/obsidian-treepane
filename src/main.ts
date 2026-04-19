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
    seededFolderIcons: boolean;
    sortMode: SortMode;
    appearance: FileTreeAppearance;
}

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

const DEFAULT_DATA: FileTreeData = {
    expanded: [],
    viewRoot: '/',
    defaultRoot: '/',
    defaultFiletreeView: true,
    folderIcons: {},
    seededFolderIcons: false,
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
            seededFolderIcons: stored?.seededFolderIcons === true,
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
