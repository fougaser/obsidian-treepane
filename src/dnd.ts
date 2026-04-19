import { App, FileSystemAdapter, Notice, TAbstractFile, TFile, TFolder } from 'obsidian';

const INTERNAL_MIME = 'application/x-file-tree';

/**
 * Delegated drag-drop wiring for the file tree.
 * Rows carry data-drag-path and draggable="true"; this attaches the listeners to the scroll container.
 */
export function attachDnd(
    root: HTMLElement,
    app: App,
    getByPath: (path: string) => TAbstractFile | null
): void {
    const getAbsolutePath = (vaultPath: string): string | null => {
        const adapter = app.vault.adapter;
        return adapter instanceof FileSystemAdapter ? adapter.getFullPath(vaultPath) : null;
    };

    let currentDropTarget: HTMLElement | null = null;
    const clearDropTarget = () => {
        if (currentDropTarget) {
            currentDropTarget.classList.remove('is-drop-target');
            currentDropTarget = null;
        }
    };

    root.addEventListener('dragstart', (e: DragEvent) => {
        const row = findRow(e.target);
        if (!row || !e.dataTransfer) {
            return;
        }
        const path = row.dataset.dragPath;
        if (!path) {
            return;
        }
        const file = getByPath(path);
        if (!file) {
            return;
        }

        e.dataTransfer.effectAllowed = 'copyMove';
        e.dataTransfer.setData(INTERNAL_MIME, path);

        const absolutePath = getAbsolutePath(path);
        if (absolutePath) {
            e.dataTransfer.setData('text/plain', absolutePath);
            e.dataTransfer.setData('text/uri-list', `file://${encodeURI(absolutePath)}`);
        }

        row.classList.add('is-dragging');
    });

    root.addEventListener('dragend', () => {
        clearDropTarget();
        root.querySelectorAll('.is-dragging').forEach(el => el.classList.remove('is-dragging'));
    });

    root.addEventListener('dragover', (e: DragEvent) => {
        if (!e.dataTransfer) {
            return;
        }
        // Internal drag only — external file drops are ignored in this MVP.
        if (!e.dataTransfer.types.includes(INTERNAL_MIME)) {
            return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        const target = folderTargetFromEvent(e);
        if (target !== currentDropTarget) {
            clearDropTarget();
            if (target) {
                target.classList.add('is-drop-target');
                currentDropTarget = target;
            }
        }
    });

    root.addEventListener('dragleave', (e: DragEvent) => {
        // Only clear when leaving the scroll container entirely.
        if (!(e.target instanceof HTMLElement)) {
            return;
        }
        if (e.target === root || !root.contains(e.relatedTarget as Node | null)) {
            clearDropTarget();
        }
    });

    root.addEventListener('drop', (e: DragEvent) => {
        if (!e.dataTransfer) {
            return;
        }
        const srcPath = e.dataTransfer.getData(INTERNAL_MIME);
        if (!srcPath) {
            return;
        }
        e.preventDefault();
        const targetRow = currentDropTarget;
        clearDropTarget();
        if (!targetRow) {
            return;
        }
        const targetPath = targetRow.dataset.dragPath;
        if (!targetPath) {
            return;
        }

        const src = getByPath(srcPath);
        const target = getByPath(targetPath);
        if (!src || !(target instanceof TFolder)) {
            return;
        }

        performMove(app, src, target);
    });
}

function findRow(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) {
        return null;
    }
    return target.closest<HTMLElement>('.ft-row');
}

function folderTargetFromEvent(e: DragEvent): HTMLElement | null {
    const target = e.target;
    if (!(target instanceof Element)) {
        return null;
    }
    const row = target.closest<HTMLElement>('.ft-row');
    if (!row) {
        return null;
    }
    // Drops on file rows promote to the parent folder row.
    if (row.classList.contains('ft-row--folder')) {
        return row;
    }
    const parentPath = row.dataset.parentPath;
    if (!parentPath) {
        return null;
    }
    return row.parentElement?.querySelector<HTMLElement>(`.ft-row--folder[data-path="${cssEscape(parentPath)}"]`) ?? null;
}

function performMove(app: App, src: TAbstractFile, target: TFolder): void {
    // Already in the destination
    if (src.parent?.path === target.path) {
        return;
    }
    // Can't move a folder into its own descendant
    if (src instanceof TFolder && target.path === src.path) {
        return;
    }
    if (src instanceof TFolder && target.path.startsWith(`${src.path}/`)) {
        new Notice('Cannot move a folder into its own subfolder.');
        return;
    }

    const newPath = target.path === '/' ? src.name : `${target.path}/${src.name}`;
    const existing = app.vault.getAbstractFileByPath(newPath);
    if (existing) {
        new Notice(`"${src.name}" already exists in ${target.path || 'root'}.`);
        return;
    }

    // fileManager.renameFile preserves backlinks (vault.rename does not).
    void app.fileManager.renameFile(src, newPath);
}

function cssEscape(value: string): string {
    // Minimal CSS.escape polyfill for selector building (path characters only).
    return value.replace(/(["\\])/g, '\\$1');
}

export function isDraggableEvent(e: DragEvent): boolean {
    return Boolean(e.dataTransfer && e.dataTransfer.types.includes(INTERNAL_MIME));
}
