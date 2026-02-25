import * as vscode from "vscode";
import { randomUUID } from "crypto";
import path from "path";

export type NotebookFs = Pick<
    typeof vscode.workspace.fs,
    "stat" | "readFile" | "writeFile" | "rename" | "delete"
>;

/**
 * Returns true if the URI exists in the workspace filesystem.
 */
export async function uriExists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

export async function uriExistsWithFs(fs: NotebookFs, uri: vscode.Uri): Promise<boolean> {
    try {
        await fs.stat(uri);
        return true;
    } catch (error) {
        if (error instanceof vscode.FileSystemError) {
            if (error.code === "FileNotFound" || error.code === "EntryNotFound") {
                return false;
            }
            throw error;
        }
        if (typeof error === "object" && error !== null && "message" in error) {
            const message = String((error as { message?: unknown; }).message ?? "");
            if (message.includes("FileNotFound") || message.includes("EntryNotFound")) {
                return false;
            }
        }
        throw error;
    }
}

/**
 * Read UTF-8 text from a URI.
 */
export async function readUriText(uri: vscode.Uri): Promise<string> {
    const fileData = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder("utf-8").decode(fileData);
}

export async function readUriTextWithFs(fs: NotebookFs, uri: vscode.Uri): Promise<string> {
    const fileData = await fs.readFile(uri);
    return new TextDecoder("utf-8").decode(fileData);
}

/**
 * Atomically write UTF-8 text to a URI using a temp file + rename-overwrite.
 * This reduces the risk of partial/empty writes if the process crashes mid-write.
 */
export async function atomicWriteUriText(uri: vscode.Uri, text: string): Promise<void> {
    await atomicWriteUriTextWithFs(vscode.workspace.fs, uri, text);
}

export async function atomicWriteUriTextWithFs(
    fs: NotebookFs,
    uri: vscode.Uri,
    text: string
): Promise<void> {
    const encoder = new TextEncoder();
    const targetExists = await uriExistsWithFs(fs, uri);

    if (targetExists) {
        await fs.writeFile(uri, encoder.encode(text));
        return;
    }

    const dirPath = uri.path.slice(0, Math.max(0, uri.path.lastIndexOf("/")));
    const dirUri = uri.with({ path: dirPath || "/" });
    const baseName = path.posix.basename(uri.path);
    const tmpName = `${baseName}.tmp-${Date.now()}-${randomUUID()}`;
    const tmpUri = vscode.Uri.joinPath(dirUri, tmpName);
    let tempFileCreated = false;


    try {
        // Write to temp file first
        await fs.writeFile(tmpUri, encoder.encode(text));
        tempFileCreated = true;

        // Atomically rename temp file over target
        await fs.rename(tmpUri, uri, { overwrite: true });
    } catch (error) {
        if (shouldRetryRenameWithoutOverwrite(error)) {
            try {
                await fs.rename(tmpUri, uri, { overwrite: false });
                return;
            } catch (retryError) {
                throw new Error(`Failed to rename temp file over target: ${retryError}`);
            }
        }

        if (tempFileCreated) {
            // If rename failed but temp file was created, clean it up.
            // Best-effort delete: ignore if temp file is already gone.
            try {
                await fs.delete(tmpUri);
            } catch (deleteErr) {
                console.log(
                    `Temp file ${tmpUri.fsPath} did not exist after write failure:`,
                    deleteErr
                );
            }
        }


        // Re-throw the original error so callers know the write failed
        // Note: If writeFile failed, tempFileCreated is false, so no cleanup needed
        // If rename failed, the original file is still intact (data preserved)
        throw error;
    }
}

function shouldRetryRenameWithoutOverwrite(error: unknown): boolean {
    if (error instanceof vscode.FileSystemError) {
        return error.code === "FileNotFound" || error.code === "EntryNotFound";
    }

    if (typeof error === "object" && error !== null && "message" in error) {
        const message = String((error as { message?: unknown; }).message ?? "");
        return message.includes("Unable to delete nonexistent file");
    }

    return false;
}

export type ReadExistingFileResult =
    | { kind: "missing"; }
    | { kind: "readable"; content: string; };

/** Max retries when file is not found (e.g. during atomic rename). */
const MAX_NOT_FOUND_RETRIES = 3;
const NOT_FOUND_RETRY_DELAY_MS = 25;

/** When read returns empty but file has size (race/locking), retry with backoff. */
const EMPTY_READ_MAX_RETRIES = 4;
const EMPTY_READ_INITIAL_DELAY_MS = 50;
const EMPTY_READ_BACKOFF_MULTIPLIER = 2;
/** Files larger than this get one extra retry and longer delays. */
const LARGE_FILE_SIZE_BYTES = 20 * 1024 * 1024;

/** Normalize Windows CRLF to LF so merge/migration see consistent line endings. */
function normalizeLineEndings(text: string): string {
    return text.replace(/\r\n/g, "\n");
}

/**
 * Reads current content if the file exists and is readable.
 * - If the file does not exist: returns { kind: "missing" }.
 * - If the file exists but cannot be read: throws (callers should avoid overwriting).
 * - Retries with backoff when read returns empty but file has size (reduces race/locking issues on large files).
 */
export async function readExistingFileOrThrow(uri: vscode.Uri): Promise<ReadExistingFileResult> {
    return readExistingFileOrThrowWithFs(vscode.workspace.fs, uri);
}

export async function readExistingFileOrThrowWithFs(
    fs: NotebookFs,
    uri: vscode.Uri
): Promise<ReadExistingFileResult> {
    // Defensive retry: in some environments the atomic rename used by our save path can momentarily
    // remove the target file, causing transient EntryNotFound errors. Retrying avoids flaky saves/tests.
    for (let attempt = 1; attempt <= MAX_NOT_FOUND_RETRIES; attempt++) {
        try {
            const content = await readUriTextWithFs(fs, uri);
            // Defensive: if we read an empty/whitespace-only string from a file that is non-empty on disk,
            // treat as a transient read error and retry with backoff before giving up.
            // (This can happen during races / partial writes / Windows locking and is a common cause of "saved empty" bugs.)
            if (content.trim().length === 0) {
                const stat = await fs.stat(uri);
                if (stat.size === 0) {
                    return { kind: "missing" };
                }
                // Retry with backoff; use more retries and longer delays for large files
                const isLarge = stat.size > LARGE_FILE_SIZE_BYTES;
                const retries = isLarge ? EMPTY_READ_MAX_RETRIES + 1 : EMPTY_READ_MAX_RETRIES;
                const initialDelay = isLarge ? EMPTY_READ_INITIAL_DELAY_MS * 2 : EMPTY_READ_INITIAL_DELAY_MS;

                for (let r = 0; r < retries; r++) {
                    const delayMs = initialDelay * Math.pow(EMPTY_READ_BACKOFF_MULTIPLIER, r);
                    await new Promise((resolve) => setTimeout(resolve, delayMs));
                    const retryContent = await readUriTextWithFs(fs, uri);
                    if (retryContent.trim().length > 0) {
                        return { kind: "readable", content: normalizeLineEndings(retryContent) };
                    }
                    const retryStat = await fs.stat(uri);
                    if (retryStat.size === 0) {
                        return { kind: "missing" };
                    }
                }
                throw new Error(`Read empty content from non-empty file: ${uri.fsPath}`);
            }
            return { kind: "readable", content: normalizeLineEndings(content) };
        } catch (error) {
            // If file doesn't exist, treat as missing.
            // If it exists, propagate the read error (except for a small set of transient-not-found races).
            let exists = false;
            try {
                await fs.stat(uri);
                exists = true;
            } catch {
                return { kind: "missing" };
            }

            const isTransientNotFound =
                error instanceof vscode.FileSystemError &&
                (error.code === "EntryNotFound" || error.code === "FileNotFound");

            if (exists && isTransientNotFound && attempt < MAX_NOT_FOUND_RETRIES) {
                await new Promise((resolve) => setTimeout(resolve, NOT_FOUND_RETRY_DELAY_MS));
                continue;
            }

            throw error;
        }
    }

    return { kind: "missing" };
}
