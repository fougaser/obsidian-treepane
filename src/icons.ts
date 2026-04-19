import { TFile } from 'obsidian';

const EXTENSION_ICON: Record<string, string> = {
    md: 'file-text',
    canvas: 'layout-grid',
    base: 'database',
    pdf: 'file-text',

    // images
    png: 'image',
    jpg: 'image',
    jpeg: 'image',
    gif: 'image',
    webp: 'image',
    svg: 'image',
    heic: 'image',
    heif: 'image',
    bmp: 'image',
    avif: 'image',

    // audio
    mp3: 'file-audio',
    wav: 'file-audio',
    m4a: 'file-audio',
    ogg: 'file-audio',
    flac: 'file-audio',
    aac: 'file-audio',
    opus: 'file-audio',

    // video
    mp4: 'file-video',
    webm: 'file-video',
    mov: 'file-video',
    avi: 'file-video',
    mkv: 'file-video',
    flv: 'file-video',
    m4v: 'file-video',

    // docs
    doc: 'file-text',
    docx: 'file-text',
    odt: 'file-text',
    rtf: 'file-text',
    pages: 'file-text',
    txt: 'file-text',

    // spreadsheets
    xlsx: 'file-spreadsheet',
    xls: 'file-spreadsheet',
    csv: 'file-spreadsheet',
    ods: 'file-spreadsheet',
    numbers: 'file-spreadsheet',
    tsv: 'file-spreadsheet',

    // slides
    ppt: 'presentation',
    pptx: 'presentation',
    odp: 'presentation',
    key: 'presentation',

    // archives
    zip: 'file-archive',
    rar: 'file-archive',
    '7z': 'file-archive',
    tar: 'file-archive',
    gz: 'file-archive',
    bz2: 'file-archive',
    xz: 'file-archive',

    // code
    js: 'file-code',
    ts: 'file-code',
    jsx: 'file-code',
    tsx: 'file-code',
    py: 'file-code',
    go: 'file-code',
    rs: 'file-code',
    rb: 'file-code',
    java: 'file-code',
    c: 'file-code',
    cpp: 'file-code',
    h: 'file-code',
    hpp: 'file-code',
    cs: 'file-code',
    swift: 'file-code',
    kt: 'file-code',
    sh: 'file-code',
    bash: 'file-code',
    zsh: 'file-code',

    // web
    html: 'file-code',
    htm: 'file-code',
    css: 'file-code',
    scss: 'file-code',
    sass: 'file-code',
    less: 'file-code',
    xml: 'file-code',
    vue: 'file-code',

    // data
    json: 'file-json',
    yaml: 'file-code',
    yml: 'file-code',
    toml: 'file-code',
    ini: 'file-code',
    env: 'file-code',

    // ebooks
    epub: 'book',
    mobi: 'book'
};

/**
 * Returns a Lucide icon id for known extensions, or null for unknown ones.
 * Unknown-extension files intentionally render without an icon so the extension
 * stays visible as the type hint in the filename.
 */
export function iconForFile(file: TFile): string | null {
    return EXTENSION_ICON[file.extension.toLowerCase()] ?? null;
}
