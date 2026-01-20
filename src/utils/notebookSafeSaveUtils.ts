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
        // If rename failed but temp file was created, clean it up
        if (tempFileCreated) {
            try {
                await fs.delete(tmpUri);
            } catch (deleteError) {
                // Log but don't throw - the original error is more important
                console.warn(
                    `Failed to clean up temp file ${tmpUri.fsPath} after write failure:`,
                    deleteError
                );
            }
        }

        // Re-throw the original error so callers know the write failed
        // Note: If writeFile failed, tempFileCreated is false, so no cleanup needed
        // If rename failed, the original file is still intact (data preserved)
        throw error;
    }
}

export type ReadExistingFileResult =
    | { kind: "missing"; }
    | { kind: "readable"; content: string; };

/**
 * Reads current content if the file exists and is readable.
 * - If the file does not exist: returns { kind: "missing" }.
 * - If the file exists but cannot be read: throws (callers should avoid overwriting).
 */
export async function readExistingFileOrThrow(uri: vscode.Uri): Promise<ReadExistingFileResult> {
    return readExistingFileOrThrowWithFs(vscode.workspace.fs, uri);
}

export async function readExistingFileOrThrowWithFs(
    fs: NotebookFs,
    uri: vscode.Uri
): Promise<ReadExistingFileResult> {
    try {
        const content = await readUriTextWithFs(fs, uri);
        // Defensive: if we read an empty/whitespace-only string from a file that is non-empty on disk,
        // treat it as a transient read error and DO NOT allow overwrite.
        // (This can happen during races / partial writes and is a common cause of "saved empty" bugs.)
        if (content.trim().length === 0) {
            const stat = await fs.stat(uri);
            if (stat.size === 0) {
                // Empty file on disk: allow caller to treat this as "missing" and do an initial write.
                return { kind: "missing" };
            }
            throw new Error(`Read empty content from non-empty file: ${uri.fsPath}`);
        }
        return { kind: "readable", content };
    } catch (error) {
        // If file doesn't exist, treat as missing. If it exists, propagate the read error.
        try {
            await fs.stat(uri);
        } catch {
            return { kind: "missing" };
        }
        throw error;
    }
}

