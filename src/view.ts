import { ItemView, setIcon, TAbstractFile, TFile, TFolder, WorkspaceLeaf } from 'obsidian';
import type FileTreePlugin from './main';
import { iconForFile } from './icons';
import { attachDnd } from './dnd';
import { openContextMenu } from './menu';
import { openAppearanceModal } from './appearanceModal';

export const FILE_TREE_VIEW_TYPE = 'obsidian-treepane-view';

const INDEX_FILE_NAME = 'index.md';

// Preview: strip frontmatter + basic markdown noise, cap by character count.
const PREVIEW_MAX_CHARS = 240;

function stripMarkdown(raw: string): string {
    let body = raw;
    if (body.startsWith('---')) {
        const end = body.indexOf('\n---', 3);
        if (end !== -1) {
            body = body.slice(end + 4);
        }
    }
    return body
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, p, alt) => alt ?? p)
        .replace(/`([^`]+)`/g, '$1')
        .replace(/(\*\*|__)(.*?)\1/g, '$2')
        .replace(/(\*|_)(.*?)\1/g, '$2')
        .replace(/^\s*[-*+]\s+/gm, '')
        .replace(/^\s*>\s?/gm, '')
        .replace(/\n{2,}/g, '\n')
        .trim();
}

function extractPreview(raw: string): string {
    const clean = stripMarkdown(raw);
    if (clean.length <= PREVIEW_MAX_CHARS) {
        return clean;
    }
    return `${clean.slice(0, PREVIEW_MAX_CHARS - 1).trimEnd()}…`;
}

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
function formatDate(ms: number): string {
    return DATE_FORMATTER.format(new Date(ms));
}

export class FileTreeView extends ItemView {
    private readonly plugin: FileTreePlugin;
    private scroller!: HTMLElement;
    private headerTitleEl!: HTMLElement;
    private headerBackEl!: HTMLElement;
    private expanded: Set<string> = new Set();
    private rowByPath: Map<string, HTMLElement> = new Map();
    private activePath: string | null = null;
    private pendingReveal: string | null = null;
    private renderFrame = 0;
    private saveHandle = 0;
    private previewCache: Map<string, string> = new Map();
    private previewInflight: Set<string> = new Set();
    private viewRootPath: string = '/';

    constructor(leaf: WorkspaceLeaf, plugin: FileTreePlugin) {
        super(leaf);
        this.plugin = plugin;
        this.expanded = new Set(plugin.getPersistedExpanded());
        this.viewRootPath = plugin.getPersistedViewRoot();
    }

    getViewType(): string {
        return FILE_TREE_VIEW_TYPE;
    }

    getDisplayText(): string {
        return 'Treepane';
    }

    getIcon(): string {
        return 'folder-tree';
    }

    async onOpen(): Promise<void> {
        this.containerEl.empty();
        const root = this.containerEl.createDiv({ cls: 'ft-root' });
        this.buildHeader(root);
        this.scroller = root.createDiv({ cls: 'ft-scroll' });

        attachDnd(this.scroller, this.app, path => this.app.vault.getAbstractFileByPath(path));
        this.scroller.addEventListener('contextmenu', evt => this.handleContextMenu(evt));
        this.scroller.addEventListener('click', evt => this.handleClick(evt));

        const vault = this.app.vault;
        this.registerEvent(vault.on('create', () => this.scheduleRender()));
        this.registerEvent(
            vault.on('delete', file => {
                this.previewCache.delete(file.path);
                this.scheduleRender();
            })
        );
        this.registerEvent(
            vault.on('rename', (file, oldPath) => {
                const prev = this.previewCache.get(oldPath);
                this.previewCache.delete(oldPath);
                if (prev !== undefined) {
                    this.previewCache.set(file.path, prev);
                }
                this.scheduleRender();
            })
        );
        this.registerEvent(
            vault.on('modify', file => {
                this.previewCache.delete(file.path);
                this.scheduleRender();
            })
        );

        const workspace = this.app.workspace;
        this.registerEvent(workspace.on('file-open', file => this.revealFile(file)));
        this.registerEvent(
            workspace.on('active-leaf-change', () => {
                const file = workspace.getActiveFile();
                if (file) {
                    this.revealFile(file);
                }
            })
        );

        this.cleanExpandedSet();
        this.ensureViewRootExists();
        this.activePath = workspace.getActiveFile()?.path ?? null;
        this.render();
    }

    async onClose(): Promise<void> {
        if (this.renderFrame) {
            cancelAnimationFrame(this.renderFrame);
            this.renderFrame = 0;
        }
        if (this.saveHandle) {
            window.clearTimeout(this.saveHandle);
            this.saveHandle = 0;
            await this.plugin.persistExpanded([...this.expanded]);
        }
    }

    onAppearanceChanged(): void {
        this.scheduleRender();
    }

    private buildHeader(parent: HTMLElement): void {
        const header = parent.createDiv({ cls: 'ft-header' });

        this.headerBackEl = header.createSpan({ cls: 'ft-header-btn ft-header-back' });
        this.headerBackEl.setAttr('role', 'button');
        this.headerBackEl.setAttr('aria-label', 'Return to vault root');
        setIcon(this.headerBackEl, 'chevron-left');
        this.headerBackEl.addEventListener('click', () => {
            this.setViewRoot(this.getDefaultRootFolder());
        });

        this.headerTitleEl = header.createSpan({ cls: 'ft-header-title' });

        const actions = header.createDiv({ cls: 'ft-header-actions' });

        const toggleAllBtn = actions.createSpan({ cls: 'ft-header-btn' });
        toggleAllBtn.setAttr('role', 'button');
        toggleAllBtn.setAttr('aria-label', 'Expand or collapse all');
        setIcon(toggleAllBtn, 'chevrons-down');
        toggleAllBtn.addEventListener('click', () => this.handleToggleAll(toggleAllBtn));

        const appearanceBtn = actions.createSpan({ cls: 'ft-header-btn' });
        appearanceBtn.setAttr('role', 'button');
        appearanceBtn.setAttr('aria-label', 'Appearance');
        setIcon(appearanceBtn, 'sliders-horizontal');
        appearanceBtn.addEventListener('click', () => {
            openAppearanceModal(this.app, this.plugin.getAppearance(), next => {
                void this.plugin.persistAppearance(next);
            });
        });

        const newNoteBtn = actions.createSpan({ cls: 'ft-header-btn' });
        newNoteBtn.setAttr('role', 'button');
        newNoteBtn.setAttr('aria-label', 'New note in current folder');
        setIcon(newNoteBtn, 'file-plus');
        newNoteBtn.addEventListener('click', () => void this.createNoteInViewRoot());
    }

    private handleToggleAll(btn: HTMLElement): void {
        const viewRoot = this.getViewRoot();
        const descendantPaths: string[] = [];
        const walk = (folder: TFolder) => {
            folder.children.forEach(child => {
                if (child instanceof TFolder) {
                    descendantPaths.push(child.path);
                    walk(child);
                }
            });
        };
        walk(viewRoot);
        if (descendantPaths.length === 0) {
            return;
        }
        const anyExpanded = descendantPaths.some(p => this.expanded.has(p));
        if (anyExpanded) {
            descendantPaths.forEach(p => this.expanded.delete(p));
            setIcon(btn, 'chevrons-down');
        } else {
            descendantPaths.forEach(p => this.expanded.add(p));
            setIcon(btn, 'chevrons-up');
        }
        this.queuePersist();
        this.scheduleRender();
    }

    private async createNoteInViewRoot(): Promise<void> {
        const folder = this.getViewRoot();
        type CreateApi = { createNewMarkdownFile?: (folder: TFolder, filename: string) => Promise<TFile> };
        const manager = this.app.fileManager as unknown as CreateApi;
        let file: TFile | null = null;
        if (typeof manager.createNewMarkdownFile === 'function') {
            file = await manager.createNewMarkdownFile(folder, 'Untitled');
        } else {
            const base = folder.path === '/' ? 'Untitled' : `${folder.path}/Untitled`;
            let candidate = `${base}.md`;
            let counter = 1;
            while (this.app.vault.getAbstractFileByPath(candidate)) {
                candidate = `${base} ${counter++}.md`;
            }
            file = await this.app.vault.create(candidate, '');
        }
        if (file) {
            await this.app.workspace.getLeaf().openFile(file);
        }
    }

    private getViewRoot(): TFolder {
        if (this.viewRootPath === '/' || !this.viewRootPath) {
            return this.app.vault.getRoot();
        }
        const target = this.app.vault.getAbstractFileByPath(this.viewRootPath);
        if (target instanceof TFolder) {
            return target;
        }
        return this.app.vault.getRoot();
    }

    private getDefaultRootFolder(): TFolder {
        const path = this.plugin.getDefaultRoot();
        if (!path || path === '/') {
            return this.app.vault.getRoot();
        }
        const target = this.app.vault.getAbstractFileByPath(path);
        if (target instanceof TFolder) {
            return target;
        }
        return this.app.vault.getRoot();
    }

    private ensureViewRootExists(): void {
        if (this.viewRootPath === '/' || !this.viewRootPath) {
            return;
        }
        const target = this.app.vault.getAbstractFileByPath(this.viewRootPath);
        if (!(target instanceof TFolder)) {
            this.viewRootPath = '/';
            void this.plugin.persistViewRoot('/');
        }
    }

    private setViewRoot(folder: TFolder): void {
        const path = folder.path === '/' || folder.path === '' ? '/' : folder.path;
        if (this.viewRootPath === path) {
            return;
        }
        this.viewRootPath = path;
        void this.plugin.persistViewRoot(path);
        // Reset scroll to top on drill in / drill out.
        this.scroller.scrollTop = 0;
        this.scheduleRender();
    }

    private scheduleRender(): void {
        if (this.renderFrame) {
            return;
        }
        this.renderFrame = requestAnimationFrame(() => {
            this.renderFrame = 0;
            this.render();
        });
    }

    private render(): void {
        const previousScroll = this.scroller.scrollTop;
        this.scroller.empty();
        this.rowByPath.clear();

        const appearance = this.plugin.getAppearance();
        this.containerEl.toggleClass('ft-hide-title', !appearance.showTitle);
        this.containerEl.toggleClass('ft-hide-description', !appearance.showDescription);
        this.containerEl.toggleClass('ft-hide-date', !appearance.showDate);
        this.containerEl.style.setProperty('--ft-preview-rows', String(appearance.previewRows));

        const viewRoot = this.getViewRoot();
        this.updateHeader(viewRoot);
        this.renderFolderChildren(viewRoot, 0);

        this.scroller.scrollTop = previousScroll;

        if (this.pendingReveal) {
            const row = this.rowByPath.get(this.pendingReveal);
            this.pendingReveal = null;
            if (row) {
                row.scrollIntoView({ block: 'nearest' });
            }
        }
    }

    private updateHeader(viewRoot: TFolder): void {
        const isVaultRoot = viewRoot.path === '/' || viewRoot.path === '';
        this.headerTitleEl.setText(isVaultRoot ? this.app.vault.getName() : viewRoot.name);
        const defaultRoot = this.plugin.getDefaultRoot();
        const normalizedDefault = defaultRoot === '' ? '/' : defaultRoot;
        const viewPath = viewRoot.path === '' ? '/' : viewRoot.path;
        this.headerBackEl.toggleClass('is-hidden', viewPath === normalizedDefault);
    }

    private renderFolderChildren(folder: TFolder, depth: number): void {
        const subfolders: TFolder[] = [];
        const files: TFile[] = [];
        folder.children.forEach(child => {
            if (child instanceof TFolder) {
                subfolders.push(child);
            } else if (child instanceof TFile) {
                files.push(child);
            }
        });
        subfolders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        files.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

        // At the view root, files render first (before the folder list). Nested levels keep the
        // folders-first order.
        const isAtViewRoot = depth === 0;
        const emitFolders = () => {
            subfolders.forEach(sub => {
                this.renderFolderRow(sub, depth);
                if (this.expanded.has(sub.path)) {
                    this.renderFolderChildren(sub, depth + 1);
                    if (depth === 0) {
                        this.scroller.createDiv({ cls: 'ft-group-spacer' });
                    }
                }
            });
        };
        const emitFiles = () => {
            files.forEach(file => this.renderFileRow(file, depth));
        };

        if (isAtViewRoot) {
            emitFiles();
            emitFolders();
        } else {
            emitFolders();
            emitFiles();
        }
    }

    private renderFolderRow(folder: TFolder, depth: number): void {
        const row = this.scroller.createDiv({ cls: 'ft-row ft-row--folder' });
        const isExpanded = this.expanded.has(folder.path);
        if (isExpanded) {
            row.addClass('is-expanded');
        }
        row.dataset.path = folder.path;
        row.dataset.dragPath = folder.path;
        if (folder.parent) {
            row.dataset.parentPath = folder.parent.path;
        }
        row.style.setProperty('--ft-depth', String(depth));
        row.setAttr('draggable', 'true');

        const chevron = row.createSpan({ cls: 'ft-chevron' });
        chevron.dataset.role = 'chevron';
        setIcon(chevron, 'chevron-right');

        const icon = row.createSpan({ cls: 'ft-icon' });
        const customIcon = this.plugin.getFolderIcon(folder.path);
        if (customIcon) {
            setIcon(icon, customIcon);
            row.addClass('ft-row--custom-icon');
        } else {
            setIcon(icon, isExpanded ? 'folder-open' : 'folder');
        }

        row.createSpan({ cls: 'ft-name', text: folder.name || this.app.vault.getName() });

        const fileChildrenCount = folder.children.filter(c => c instanceof TFile).length;
        if (fileChildrenCount > 0) {
            row.createSpan({ cls: 'ft-count', text: String(fileChildrenCount) });
        }

        this.rowByPath.set(folder.path, row);
    }

    private renderFileRow(file: TFile, depth: number): void {
        const isMarkdown = file.extension.toLowerCase() === 'md';
        const row = this.scroller.createDiv({ cls: `ft-row ft-row--file ${isMarkdown ? 'ft-row--md' : ''}` });
        if (file.path === this.activePath) {
            row.addClass('is-active');
        }
        row.dataset.path = file.path;
        row.dataset.dragPath = file.path;
        if (file.parent) {
            row.dataset.parentPath = file.parent.path;
        }
        row.style.setProperty('--ft-depth', String(depth));
        row.setAttr('draggable', 'true');

        // Markdown rows: no file-type icon, show basename (no `.md`).
        if (!isMarkdown) {
            const icon = row.createSpan({ cls: 'ft-icon' });
            setIcon(icon, iconForFile(file));
        }

        const body = row.createDiv({ cls: 'ft-file-body' });
        body.createSpan({ cls: 'ft-name', text: isMarkdown ? file.basename : file.name });

        if (isMarkdown) {
            const preview = body.createSpan({ cls: 'ft-preview' });
            const cached = this.previewCache.get(file.path);
            if (cached !== undefined) {
                if (cached) {
                    preview.setText(cached);
                } else {
                    preview.remove();
                }
            } else {
                preview.addClass('is-pending');
                this.queuePreviewLoad(file);
            }
        }

        body.createSpan({ cls: 'ft-date', text: formatDate(file.stat.mtime) });

        this.rowByPath.set(file.path, row);
    }

    private queuePreviewLoad(file: TFile): void {
        if (this.previewInflight.has(file.path)) {
            return;
        }
        this.previewInflight.add(file.path);
        void this.app.vault
            .cachedRead(file)
            .then(content => {
                const preview = extractPreview(content);
                this.previewCache.set(file.path, preview);
                this.previewInflight.delete(file.path);
                this.applyPreviewToRow(file.path, preview);
            })
            .catch(() => {
                this.previewCache.set(file.path, '');
                this.previewInflight.delete(file.path);
                this.applyPreviewToRow(file.path, '');
            });
    }

    private applyPreviewToRow(path: string, preview: string): void {
        const row = this.rowByPath.get(path);
        if (!row) {
            return;
        }
        const previewEl = row.querySelector<HTMLElement>('.ft-preview');
        if (!previewEl) {
            return;
        }
        previewEl.removeClass('is-pending');
        if (preview) {
            previewEl.setText(preview);
        } else {
            previewEl.remove();
        }
    }

    private handleClick(evt: MouseEvent): void {
        if (!(evt.target instanceof Element)) {
            return;
        }
        const row = evt.target.closest<HTMLElement>('.ft-row');
        if (!row) {
            return;
        }
        const path = row.dataset.path;
        if (!path) {
            return;
        }
        const target = this.app.vault.getAbstractFileByPath(path);
        if (!target) {
            return;
        }

        const chevronClick = (evt.target as Element).closest('[data-role="chevron"]') !== null;

        if (target instanceof TFolder) {
            if (chevronClick) {
                this.toggleFolder(target.path);
                return;
            }
            const isExpanded = this.expanded.has(target.path);
            if (!isExpanded) {
                // First click on a collapsed folder name just expands.
                this.expanded.add(target.path);
                this.queuePersist();
                this.scheduleRender();
                return;
            }
            // Already expanded — promote to view root (drill in), open its index.md if present.
            this.setViewRoot(target);
            const indexPath = target.path === '/' ? INDEX_FILE_NAME : `${target.path}/${INDEX_FILE_NAME}`;
            const indexFile = this.app.vault.getFileByPath(indexPath);
            if (indexFile && this.app.workspace.getActiveFile()?.path !== indexFile.path) {
                void this.app.workspace.getLeaf('tab').openFile(indexFile);
            }
            return;
        }

        if (target instanceof TFile) {
            // getLeaf(false) returns the *currently active* leaf — which is us when the user
            // just clicked inside the sidebar, so opening would replace the tree with the file.
            // Prefer the most recent main-area leaf; fall back to a fresh tab if none exists.
            const recent = this.app.workspace.getMostRecentLeaf();
            const leaf = recent ?? this.app.workspace.getLeaf('tab');
            void leaf.openFile(target, { active: true });
        }
    }

    private handleContextMenu(evt: MouseEvent): void {
        evt.preventDefault();
        let target: TAbstractFile | null = null;
        if (evt.target instanceof Element) {
            const row = evt.target.closest<HTMLElement>('.ft-row');
            const path = row?.dataset.path;
            if (path) {
                target = this.app.vault.getAbstractFileByPath(path);
            }
        }
        openContextMenu(this.app, this.plugin, target, evt);
    }

    private toggleFolder(path: string): void {
        if (this.expanded.has(path)) {
            this.expanded.delete(path);
        } else {
            this.expanded.add(path);
        }
        this.queuePersist();
        this.scheduleRender();
    }

    private queuePersist(): void {
        if (this.saveHandle) {
            window.clearTimeout(this.saveHandle);
        }
        this.saveHandle = window.setTimeout(() => {
            this.saveHandle = 0;
            void this.plugin.persistExpanded([...this.expanded]);
        }, 500);
    }

    private cleanExpandedSet(): void {
        const before = this.expanded.size;
        for (const path of [...this.expanded]) {
            const match = this.app.vault.getAbstractFileByPath(path);
            if (!(match instanceof TFolder)) {
                this.expanded.delete(path);
            }
        }
        if (this.expanded.size !== before) {
            this.queuePersist();
        }
    }

    revealFile(file: TFile | null): void {
        if (!file) {
            return;
        }
        if (!(this.app.vault.getAbstractFileByPath(file.path) instanceof TFile)) {
            return;
        }
        this.activePath = file.path;

        let changed = false;
        let parent: TFolder | null = file.parent;
        while (parent && parent.path !== '/' && parent.path !== this.viewRootPath) {
            if (!this.expanded.has(parent.path)) {
                this.expanded.add(parent.path);
                changed = true;
            }
            parent = parent.parent;
        }

        if (changed) {
            this.queuePersist();
        }
        this.pendingReveal = file.path;
        this.scheduleRender();
    }
}
