import { Plugin, WorkspaceLeaf } from 'obsidian';
import { FILE_TREE_VIEW_TYPE, FileTreeView } from './view';
import { FileTreeSettingTab } from './settingsTab';

export interface FileTreeAppearance {
    showTitle: boolean;
    showDescription: boolean;
    showDate: boolean;
    previewRows: 1 | 2;
}

interface FileTreeData {
    expanded: string[];
    viewRoot: string;
    defaultRoot: string;
    defaultFiletreeView: boolean;
    appearance: FileTreeAppearance;
}

const DEFAULT_APPEARANCE: FileTreeAppearance = {
    showTitle: true,
    showDescription: true,
    showDate: true,
    previewRows: 2
};

const DEFAULT_DATA: FileTreeData = {
    expanded: [],
    viewRoot: '/',
    defaultRoot: '/',
    defaultFiletreeView: true,
    appearance: DEFAULT_APPEARANCE
};

export default class FileTreePlugin extends Plugin {
    private data: FileTreeData = DEFAULT_DATA;

    async onload(): Promise<void> {
        const stored = (await this.loadData()) as Partial<FileTreeData> | null;
        this.data = {
            expanded: Array.isArray(stored?.expanded) ? stored!.expanded!.filter(p => typeof p === 'string') : [],
            viewRoot: typeof stored?.viewRoot === 'string' ? stored!.viewRoot! : '/',
            defaultRoot: typeof stored?.defaultRoot === 'string' ? stored!.defaultRoot! : '/',
            defaultFiletreeView: typeof stored?.defaultFiletreeView === 'boolean' ? stored!.defaultFiletreeView! : true,
            appearance: { ...DEFAULT_APPEARANCE, ...(stored?.appearance ?? {}) }
        };

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
