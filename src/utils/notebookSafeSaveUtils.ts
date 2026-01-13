import * as vscode from "vscode";
import { randomUUID } from "crypto";
import path from "path";

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

/**
 * Atomically write UTF-8 text to a URI using a temp file + rename-overwrite.
 * This reduces the risk of partial/empty writes if the process crashes mid-write.
 */
export async function atomicWriteUriText(uri: vscode.Uri, text: string): Promise<void> {
    const encoder = new TextEncoder();
    const dirPath = uri.path.slice(0, Math.max(0, uri.path.lastIndexOf("/")));
    const dirUri = uri.with({ path: dirPath || "/" });
    const baseName = path.posix.basename(uri.path);
    const tmpName = `${baseName}.tmp-${Date.now()}-${randomUUID()}`;
    const tmpUri = vscode.Uri.joinPath(dirUri, tmpName);

    await vscode.workspace.fs.writeFile(tmpUri, encoder.encode(text));
    await vscode.workspace.fs.rename(tmpUri, uri, { overwrite: true });
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
    try {
        const content = await readUriText(uri);
        // Defensive: if we read an empty/whitespace-only string from a file that is non-empty on disk,
        // treat it as a transient read error and DO NOT allow overwrite.
        // (This can happen during races / partial writes and is a common cause of "saved empty" bugs.)
        if (content.trim().length === 0) {
            const stat = await vscode.workspace.fs.stat(uri);
            if (stat.size === 0) {
                // Empty file on disk: allow caller to treat this as "missing" and do an initial write.
                return { kind: "missing" };
            }
            throw new Error(`Read empty content from non-empty file: ${uri.fsPath}`);
        }
        return { kind: "readable", content };
    } catch (error) {
        const exists = await uriExists(uri);
        if (!exists) return { kind: "missing" };
        throw error;
    }
}

