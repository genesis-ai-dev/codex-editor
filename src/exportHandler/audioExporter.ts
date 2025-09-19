import * as vscode from "vscode";
import { basename, extname } from "path";

type ExportAudioOptions = {
    includeTimestamps?: boolean;
};

type CodexNotebookAsJSONData = {
    cells: Array<{
        kind: number;
        value: string;
        metadata: any;
    }>;
    metadata?: any;
};

function sanitizeFileComponent(input: string): string {
    return input
        .replace(/\s+/g, "_")
        .replace(/[^a-zA-Z0-9._-]/g, "-")
        .replace(/_+/g, "_");
}

function formatDateForFolder(d: Date): string {
    const pad = (n: number, w = 2) => String(n).padStart(w, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function parseCellIdToBookChapterVerse(cellId: string): { book: string; chapter?: number; verse?: number; } {
    try {
        const [book, rest] = cellId.split(" ");
        const [chapterStr, verseStr] = (rest || "").split(":");
        let chapter: number | undefined = chapterStr ? Number(chapterStr) : undefined;
        let verse: number | undefined = verseStr ? Number(verseStr) : undefined;
        if (chapter !== undefined && !Number.isFinite(chapter)) chapter = undefined;
        if (verse !== undefined && !Number.isFinite(verse)) verse = undefined;
        return { book: (book || "").toUpperCase(), chapter, verse };
    } catch {
        return { book: "", chapter: undefined, verse: undefined };
    }
}

function toBookChapterVerseBasename(cellId: string): string {
    const { book, chapter, verse } = parseCellIdToBookChapterVerse(cellId);
    const safePad = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? String(n) : "0").padStart(3, "0");
    const chapStr = safePad(chapter);
    const verseStr = safePad(verse);
    return sanitizeFileComponent(`${book}_${chapStr}_${verseStr}`);
}

function formatTimeRangeSuffix(start?: number, end?: number): string {
    if (start === undefined && end === undefined) return "";
    const coerce = (v: any): number | undefined => {
        if (v === undefined || v === null) return undefined;
        const num = typeof v === "number" ? v : Number(v);
        if (!Number.isFinite(num)) return undefined;
        return num;
    };
    const fmt = (v: number | undefined) => {
        if (v === undefined) return "";
        // Use seconds with milliseconds, replace dot to avoid extra dots in filename
        return v.toFixed(3).replace(".", "-");
    };
    const s = fmt(coerce(start));
    const e = fmt(coerce(end));
    if (!s && !e) return "";
    return `_${s || ""}-${e || ""}`;
}

async function readNotebook(uri: vscode.Uri): Promise<CodexNotebookAsJSONData> {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return JSON.parse(Buffer.from(bytes).toString());
}

function isActiveCell(cell: any): boolean {
    const data = cell?.metadata?.data;
    const isMerged = !!(data && data.merged);
    const isDeleted = !!(data && data.deleted);
    return !isMerged && !isDeleted;
}

function pickAudioAttachmentForCell(cell: any): { id: string; url: string; start?: number; end?: number; } | null {
    const attachments = cell?.metadata?.attachments || {};
    if (!attachments || typeof attachments !== "object") return null;
    const selectedId: string | undefined = cell?.metadata?.selectedAudioId;

    const candidates: Array<{ id: string; url: string; updatedAt?: number; start?: number; end?: number; isDeleted?: boolean; isMissing?: boolean; }>
        = [];
    for (const [attId, attVal] of Object.entries<any>(attachments)) {
        if (!attVal || typeof attVal !== "object") continue;
        if (attVal.type !== "audio") continue;
        if (attVal.isDeleted) continue;
        if (attVal.isMissing) continue;
        if (!attVal.url || typeof attVal.url !== "string") continue;
        candidates.push({ id: attId, url: attVal.url, updatedAt: attVal.updatedAt, start: attVal.startTime, end: attVal.endTime });
    }
    if (candidates.length === 0) return null;
    if (selectedId) {
        const selected = candidates.find(c => c.id === selectedId);
        if (selected) return selected;
    }
    // fallback to most recently updated
    candidates.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return candidates[0];
}

async function pathExists(uri: vscode.Uri): Promise<boolean> {
    try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}

export async function exportAudioAttachments(
    userSelectedPath: string,
    filesToExport: string[],
    options?: ExportAudioOptions
): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage("No workspace folder found.");
        return;
    }
    const workspaceFolder = workspaceFolders[0];

    // Resolve project name
    const projectConfig = vscode.workspace.getConfiguration("codex-project-manager");
    let projectName = projectConfig.get<string>("projectName", "");
    if (!projectName) {
        projectName = basename(workspaceFolder.uri.fsPath);
    }

    const dateStamp = formatDateForFolder(new Date());
    const exportRoot = vscode.Uri.file(userSelectedPath);
    const finalExportDir = vscode.Uri.joinPath(exportRoot, "export", `${sanitizeFileComponent(projectName)}-${dateStamp}`);
    await vscode.workspace.fs.createDirectory(finalExportDir);

    const includeTimestamps = !!options?.includeTimestamps;
    const selectedFiles = filesToExport.map((p) => vscode.Uri.file(p));
    if (selectedFiles.length === 0) {
        vscode.window.showInformationMessage("No files selected for export.");
        return;
    }

    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Exporting Audio Attachments",
            cancellable: false,
        },
        async (progress) => {
            const increment = 100 / selectedFiles.length;
            let copiedCount = 0;
            let missingCount = 0;

            for (const [index, file] of selectedFiles.entries()) {
                progress.report({ message: `Processing ${basename(file.fsPath)} (${index + 1}/${selectedFiles.length})`, increment });

                const bookCode = basename(file.fsPath).split(".")[0] || "BOOK";
                const bookFolder = vscode.Uri.joinPath(finalExportDir, sanitizeFileComponent(bookCode));
                await vscode.workspace.fs.createDirectory(bookFolder);

                let notebook: CodexNotebookAsJSONData;
                try {
                    notebook = await readNotebook(file);
                } catch (e) {
                    missingCount++;
                    continue;
                }

                for (const cell of notebook.cells) {
                    if (cell.kind !== 2) continue; // NotebookCellKind.Code
                    if (!isActiveCell(cell)) continue;
                    const cellId: string | undefined = cell?.metadata?.id;
                    if (!cellId) continue;

                    const pick = pickAudioAttachmentForCell(cell);
                    if (!pick) {
                        continue;
                    }

                    // Resolve absolute source path (attachment urls are workspace-relative POSIX in this project)
                    const srcPath = pick.url;
                    const absoluteSrc = srcPath.startsWith("/") || srcPath.match(/^[A-Za-z]:\\/)
                        ? vscode.Uri.file(srcPath)
                        : vscode.Uri.joinPath(workspaceFolder.uri, srcPath);

                    if (!(await pathExists(absoluteSrc))) {
                        missingCount++;
                        continue;
                    }

                    // Build destination filename
                    const baseFromId = toBookChapterVerseBasename(cellId);
                    const timeFromCell = cell?.metadata?.data || {};
                    const start = includeTimestamps ? (timeFromCell.startTime ?? timeFromCell.begin ?? pick.start) : undefined;
                    const end = includeTimestamps ? (timeFromCell.endTime ?? timeFromCell.stop ?? timeFromCell.duration ?? pick.end) : undefined;
                    const suffix = includeTimestamps ? formatTimeRangeSuffix(start, end) : "";
                    const ext = extname(absoluteSrc.fsPath) || ".wav";
                    let destName = `${baseFromId}${suffix}${ext}`;
                    let destUri = vscode.Uri.joinPath(bookFolder, destName);

                    // Avoid collisions by appending incremental suffix
                    let attempt = 1;
                    while (await pathExists(destUri)) {
                        const withoutExt = destName.slice(0, -ext.length);
                        destName = `${withoutExt}_${attempt}${ext}`;
                        destUri = vscode.Uri.joinPath(bookFolder, destName);
                        attempt++;
                    }

                    try {
                        const bytes = await vscode.workspace.fs.readFile(absoluteSrc);
                        await vscode.workspace.fs.writeFile(destUri, bytes);
                        copiedCount++;
                    } catch {
                        missingCount++;
                    }
                }
            }

            vscode.window.showInformationMessage(`Audio export completed: ${copiedCount} files copied${missingCount ? `, ${missingCount} skipped` : ""}. Output: ${finalExportDir.fsPath}`);
        }
    );
}


