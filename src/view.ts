import { ItemView, setIcon, TAbstractFile, TFile, TFolder, WorkspaceLeaf } from 'obsidian';
import type FileTreePlugin from './main';
import { iconForFile } from './icons';
import { attachDnd } from './dnd';
import { openContextMenu } from './menu';
import { openAppearanceModal } from './appearanceModal';
import { IconPickerModal } from './iconPickerModal';

const CLICK_DELAY_MS = 220;

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
    private expandedInPinned: Set<string> = new Set();
    private rowByPath: Map<string, HTMLElement> = new Map();
    private activePath: string | null = null;
    private pendingReveal: string | null = null;
    private renderFrame = 0;
    private saveHandle = 0;
    private previewCache: Map<string, string> = new Map();
    private previewInflight: Set<string> = new Set();
    private viewRootPath: string = '/';
    // Single-click on a folder name is deferred by CLICK_DELAY_MS so a dblclick can cancel it.
    private pendingFolderClick: { path: string; timer: number } | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: FileTreePlugin) {
        super(leaf);
        this.plugin = plugin;
        this.expanded = new Set(plugin.getPersistedExpanded());
        this.expandedInPinned = new Set(plugin.getPersistedExpandedInPinned());
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
        this.scroller.addEventListener('dblclick', evt => this.handleDoubleClick(evt));

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
            await this.plugin.persistExpandedInPinned([...this.expandedInPinned]);
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

        // Pinned section — always above the main tree when there are pins.
        const pinnedPaths = this.plugin.getPinnedPaths();
        const resolvedPins = pinnedPaths
            .map(p => this.app.vault.getAbstractFileByPath(p))
            .filter((f): f is TAbstractFile => f !== null);
        // Pins show only when viewing the vault root — treat the pinned section as
        // "favorites" belonging to the top-level view. When drilled into a subfolder, the
        // section is hidden. Pinned folders render as single links (no expand, no chevron)
        // and one-click drills into them; pinned files one-click open.
        const isVaultRootView = viewRoot.path === '/' || viewRoot.path === '';
        if (isVaultRootView && resolvedPins.length > 0) {
            const section = this.scroller.createDiv({ cls: 'ft-pinned-section' });
            section.createDiv({ cls: 'ft-pinned-label', text: 'Pinned' });
            resolvedPins.forEach(target => {
                if (target instanceof TFolder) {
                    this.renderFolderRow(target, 0, { pinned: true, parent: section });
                } else if (target instanceof TFile) {
                    this.renderFileRow(target, 0, { pinned: true, parent: section });
                }
            });
        }

        this.renderFolderChildren(viewRoot, 0);

        // Mark the first top-level file row in the main tree so CSS can give it a bit of
        // breathing room — separating the initial file run from the header/pinned section.
        const firstFile = this.scroller.querySelector<HTMLElement>(
            ':scope > .ft-row--file'
        );
        if (firstFile) {
            firstFile.addClass('ft-row--first-file');
        }

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

    private renderFolderChildren(folder: TFolder, depth: number, ctx: 'main' | 'pinned' = 'main', host?: HTMLElement): void {
        const subfolders: TFolder[] = [];
        const files: TFile[] = [];
        folder.children.forEach(child => {
            if (child instanceof TFolder) {
                subfolders.push(child);
            } else if (child instanceof TFile) {
                files.push(child);
            }
        });
        const byName = (a: TFolder | TFile, b: TFolder | TFile) =>
            a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        subfolders.sort(byName);
        files.sort(byName);

        // Split top-pinned items from the rest. Two independent lists — one for folder
        // names, one for file basenames. Within each list, order follows the list order.
        const fileKey = (f: TFile) => (f.extension.toLowerCase() === 'md' ? f.basename : f.name);
        const topFolders: TFolder[] = [];
        const restFolders: TFolder[] = [];
        const topFiles: TFile[] = [];
        const restFiles: TFile[] = [];
        for (const sub of subfolders) {
            if (this.plugin.topFolderPriority(sub.name) >= 0) {
                topFolders.push(sub);
            } else {
                restFolders.push(sub);
            }
        }
        for (const file of files) {
            if (this.plugin.topFilePriority(fileKey(file)) >= 0) {
                topFiles.push(file);
            } else {
                restFiles.push(file);
            }
        }
        topFolders.sort((a, b) => this.plugin.topFolderPriority(a.name) - this.plugin.topFolderPriority(b.name));
        topFiles.sort((a, b) => this.plugin.topFilePriority(fileKey(a)) - this.plugin.topFilePriority(fileKey(b)));

        const expandedSet = ctx === 'pinned' ? this.expandedInPinned : this.expanded;
        const emitFolder = (sub: TFolder) => {
            this.renderFolderRow(sub, depth, { pinned: ctx === 'pinned', parent: host });
            if (expandedSet.has(sub.path)) {
                this.renderFolderChildren(sub, depth + 1, ctx, host);
            }
        };
        const emitFile = (file: TFile) => this.renderFileRow(file, depth, { pinned: ctx === 'pinned', parent: host });

        // The ordering between top-folders and top-files mirrors the general sort mode.
        // alphabet: merge and sort by name (list-order preference is dropped in this mode).
        const sortMode = this.plugin.getSortMode();
        if (sortMode === 'alphabet') {
            const mergedTop: Array<TFolder | TFile> = [...topFolders, ...topFiles].sort(byName);
            mergedTop.forEach(item => {
                if (item instanceof TFolder) {
                    emitFolder(item);
                } else {
                    emitFile(item);
                }
            });
            const mergedRest: Array<TFolder | TFile> = [...restFolders, ...restFiles].sort(byName);
            mergedRest.forEach(item => {
                if (item instanceof TFolder) {
                    emitFolder(item);
                } else {
                    emitFile(item);
                }
            });
            return;
        }
        if (sortMode === 'files-first') {
            topFiles.forEach(emitFile);
            topFolders.forEach(emitFolder);
            restFiles.forEach(emitFile);
            restFolders.forEach(emitFolder);
            return;
        }
        // folders-first (default)
        topFolders.forEach(emitFolder);
        topFiles.forEach(emitFile);
        restFolders.forEach(emitFolder);
        restFiles.forEach(emitFile);
    }

    private renderFolderRow(folder: TFolder, depth: number, options: { pinned?: boolean; parent?: HTMLElement } = {}): void {
        const host = options.parent ?? this.scroller;
        const row = host.createDiv({ cls: 'ft-row ft-row--folder' });
        const expandedSet = options.pinned ? this.expandedInPinned : this.expanded;
        const isExpanded = expandedSet.has(folder.path);
        if (isExpanded) {
            row.addClass('is-expanded');
        }
        if (depth > 0) {
            row.addClass('ft-row--nested');
        }
        if (options.pinned) {
            row.addClass('ft-row--pinned');
            row.dataset.context = 'pinned';
        } else {
            row.dataset.context = 'main';
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
        const folderColor = this.plugin.getFolderColor(folder.path);
        if (folderColor) {
            icon.style.color = folderColor;
        }

        row.createSpan({ cls: 'ft-name', text: folder.name || this.app.vault.getName() });

        const totalChildren = folder.children.length;
        if (totalChildren > 0) {
            row.createSpan({ cls: 'ft-count', text: String(totalChildren) });
        }

        // Persistent star indicator for starred folders (right side).
        if (this.plugin.isStarred(folder.path)) {
            const star = row.createSpan({ cls: 'ft-star is-on' });
            setIcon(star, 'star');
        }

        this.appendHoverActions(row, folder.path, { starable: true, inPinnedSection: Boolean(options.pinned) });

        this.rowByPath.set(folder.path, row);
    }

    private renderFileRow(file: TFile, depth: number, options: { pinned?: boolean; parent?: HTMLElement } = {}): void {
        const host = options.parent ?? this.scroller;
        const ext = file.extension.toLowerCase();
        const isMarkdown = ext === 'md';
        const row = host.createDiv({ cls: `ft-row ft-row--file ${isMarkdown ? 'ft-row--md' : ''}` });
        if (file.path === this.activePath) {
            row.addClass('is-active');
        }
        if (depth > 0) {
            row.addClass('ft-row--nested');
        }
        if (options.pinned) {
            row.addClass('ft-row--pinned');
        }
        row.dataset.path = file.path;
        row.dataset.dragPath = file.path;
        if (file.parent) {
            row.dataset.parentPath = file.parent.path;
        }
        row.style.setProperty('--ft-depth', String(depth));
        row.setAttr('draggable', 'true');

        // Non-md files: show icon only if the extension is known. Unknown extensions render no
        // icon — the extension shown inside the filename is the type hint.
        if (!isMarkdown) {
            const iconId = iconForFile(file);
            if (iconId) {
                const icon = row.createSpan({ cls: 'ft-icon' });
                setIcon(icon, iconId);
            }
        }

        const minimal = Boolean(options.pinned) || this.plugin.isMinimal(isMarkdown ? file.basename : file.name);
        const body = row.createDiv({ cls: 'ft-file-body' });
        if (minimal) {
            row.addClass('ft-row--minimal');
        }
        body.createSpan({ cls: 'ft-name', text: isMarkdown ? file.basename : file.name });

        if (isMarkdown && !minimal) {
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

        if (!minimal) {
            body.createSpan({ cls: 'ft-date', text: formatDate(file.stat.mtime) });
        }

        // Persistent star indicator (right side) — yellow when starred.
        if (this.plugin.isStarred(file.path)) {
            const star = row.createSpan({ cls: 'ft-star is-on' });
            setIcon(star, 'star');
        }

        this.appendHoverActions(row, file.path, { starable: true, inPinnedSection: Boolean(options.pinned) });

        this.rowByPath.set(file.path, row);
    }

    /** Pin/star icons that appear on hover (or reorder arrows if the row lives in the pinned section). */
    private appendHoverActions(row: HTMLElement, path: string, opts: { starable: boolean; inPinnedSection: boolean }): void {
        const actions = row.createDiv({ cls: 'ft-row-actions' });
        if (opts.inPinnedSection) {
            const up = actions.createSpan({ cls: 'ft-row-action' });
            up.setAttr('aria-label', 'Move up');
            up.title = 'Move up';
            setIcon(up, 'chevron-up');
            up.addEventListener('click', evt => {
                evt.stopPropagation();
                void this.plugin.movePinnedPath(path, 'up');
            });
            const down = actions.createSpan({ cls: 'ft-row-action' });
            down.setAttr('aria-label', 'Move down');
            down.title = 'Move down';
            setIcon(down, 'chevron-down');
            down.addEventListener('click', evt => {
                evt.stopPropagation();
                void this.plugin.movePinnedPath(path, 'down');
            });
            const unpin = actions.createSpan({ cls: 'ft-row-action' });
            unpin.setAttr('aria-label', 'Unpin');
            unpin.title = 'Unpin';
            setIcon(unpin, 'pin-off');
            unpin.addEventListener('click', evt => {
                evt.stopPropagation();
                void this.plugin.togglePin(path);
            });
            return;
        }

        const pin = actions.createSpan({ cls: 'ft-row-action ft-row-action--pin' });
        const pinned = this.plugin.isPinned(path);
        pin.setAttr('aria-label', pinned ? 'Unpin' : 'Pin');
        pin.title = pinned ? 'Unpin' : 'Pin';
        setIcon(pin, pinned ? 'pin-off' : 'pin');
        if (pinned) {
            pin.addClass('is-on');
        }
        pin.addEventListener('click', evt => {
            evt.stopPropagation();
            void this.plugin.togglePin(path);
        });

        if (opts.starable) {
            const star = actions.createSpan({ cls: 'ft-row-action ft-row-action--star' });
            const starred = this.plugin.isStarred(path);
            star.setAttr('aria-label', starred ? 'Unstar' : 'Star');
            star.title = starred ? 'Unstar' : 'Star';
            setIcon(star, starred ? 'star' : 'star');
            if (starred) {
                star.addClass('is-on');
            }
            star.addEventListener('click', evt => {
                evt.stopPropagation();
                void this.plugin.toggleStar(path);
            });
        }
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
        const ctx: 'main' | 'pinned' = row.dataset.context === 'pinned' ? 'pinned' : 'main';

        if (target instanceof TFolder) {
            // Pinned folders are single-click drill-in shortcuts — no expand mechanics.
            if (ctx === 'pinned') {
                this.setViewRoot(target);
                const indexPath = target.path === '/' ? INDEX_FILE_NAME : `${target.path}/${INDEX_FILE_NAME}`;
                const indexFile = this.app.vault.getFileByPath(indexPath);
                if (indexFile && this.app.workspace.getActiveFile()?.path !== indexFile.path) {
                    void this.app.workspace.getLeaf('tab').openFile(indexFile);
                }
                return;
            }
            if (chevronClick) {
                this.toggleFolder(target.path, ctx);
                return;
            }
            // Single click on folder name in the main tree: toggle (deferred so a dblclick can cancel).
            this.schedulePendingFolderToggle(target.path, ctx);
            return;
        }

        if (target instanceof TFile) {
            // getLeaf(false) / getMostRecentLeaf() without a root argument may return the
            // sidebar leaf we're rendering in (because the user just clicked *us*). Scope to
            // the main-area root split so we always hit an editor tab, never the sidebar.
            const rootSplit = this.app.workspace.rootSplit;
            const recent = rootSplit
                ? this.app.workspace.getMostRecentLeaf(rootSplit)
                : this.app.workspace.getMostRecentLeaf();
            const leaf = recent ?? this.app.workspace.getLeaf('tab');
            void leaf.openFile(target, { active: true });
        }
    }

    private schedulePendingFolderToggle(path: string, ctx: 'main' | 'pinned' = 'main'): void {
        this.cancelPendingFolderClick();
        const timer = window.setTimeout(() => {
            this.pendingFolderClick = null;
            this.toggleFolder(path, ctx);
        }, CLICK_DELAY_MS);
        this.pendingFolderClick = { path, timer };
    }

    private cancelPendingFolderClick(): void {
        if (this.pendingFolderClick) {
            window.clearTimeout(this.pendingFolderClick.timer);
            this.pendingFolderClick = null;
        }
    }

    private handleDoubleClick(evt: MouseEvent): void {
        if (!(evt.target instanceof Element)) {
            return;
        }
        const row = evt.target.closest<HTMLElement>('.ft-row--folder');
        if (!row) {
            return;
        }
        const path = row.dataset.path;
        if (!path) {
            return;
        }
        const target = this.app.vault.getAbstractFileByPath(path);
        if (!(target instanceof TFolder)) {
            return;
        }

        // A dblclick is preceded by two `click` events; we cancel any queued single-click
        // work here so the folder doesn't flap open/closed before the dblclick action lands.
        this.cancelPendingFolderClick();

        const onIcon = (evt.target as Element).closest('.ft-icon, .ft-chevron') !== null;
        if (onIcon) {
            new IconPickerModal(this.app, {
                currentIconId: this.plugin.getFolderIcon(target.path),
                currentColor: this.plugin.getFolderColor(target.path),
                onPick: (iconId, color) => {
                    void this.plugin.setFolderIcon(target.path, iconId);
                    void this.plugin.setFolderColor(target.path, color);
                }
            }).open();
            return;
        }

        // Any other part of the folder row → drill in.
        this.setViewRoot(target);
        const indexPath = target.path === '/' ? INDEX_FILE_NAME : `${target.path}/${INDEX_FILE_NAME}`;
        const indexFile = this.app.vault.getFileByPath(indexPath);
        if (indexFile && this.app.workspace.getActiveFile()?.path !== indexFile.path) {
            void this.app.workspace.getLeaf('tab').openFile(indexFile);
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

    private toggleFolder(path: string, ctx: 'main' | 'pinned' = 'main'): void {
        const set = ctx === 'pinned' ? this.expandedInPinned : this.expanded;
        if (set.has(path)) {
            set.delete(path);
        } else {
            set.add(path);
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
            void this.plugin.persistExpandedInPinned([...this.expandedInPinned]);
        }, 500);
    }

    private cleanExpandedSet(): void {
        let changed = false;
        const sanitize = (set: Set<string>) => {
            for (const path of [...set]) {
                const match = this.app.vault.getAbstractFileByPath(path);
                if (!(match instanceof TFolder)) {
                    set.delete(path);
                    changed = true;
                }
            }
        };
        sanitize(this.expanded);
        sanitize(this.expandedInPinned);
        if (changed) {
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
