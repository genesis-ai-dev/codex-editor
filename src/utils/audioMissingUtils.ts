import * as vscode from "vscode";
import path from "path";
import { toPosixPath, normalizeAttachmentUrl } from "./pathUtils";
import type { CodexCellDocument } from "../providers/codexCellEditorProvider/codexDocument";

/**
 * Checks whether a pointer file exists for a given attachment URL.
 * Accepts URLs pointing to .project/attachments/files and converts them to pointers path.
 */
export async function attachmentPointerExists(
    workspaceFolder: vscode.WorkspaceFolder,
    attachmentUrl: string
): Promise<boolean> {
    try {
        const normalizedUrl = normalizeAttachmentUrl(attachmentUrl) || attachmentUrl;
        const posixUrl = toPosixPath(normalizedUrl);
        const pointerPosix = posixUrl.includes("/attachments/files/")
            ? posixUrl.replace("/attachments/files/", "/attachments/pointers/")
            : posixUrl;

        const segments = pointerPosix.split("/").filter(Boolean);
        const pointerUri = vscode.Uri.joinPath(workspaceFolder.uri, ...segments);
        await vscode.workspace.fs.stat(pointerUri);
        return true;
    } catch {
        return false;
    }
}

/** Ensure a pointer exists by mirroring bytes from files/ if present. */
async function ensurePointerFromFiles(
    workspaceFolder: vscode.WorkspaceFolder,
    attachmentUrl: string
): Promise<boolean> {
    const normalizedUrl = normalizeAttachmentUrl(attachmentUrl) || attachmentUrl;
    const posixUrl = toPosixPath(normalizedUrl);
    const filesPosix = posixUrl;
    const pointersPosix = posixUrl.includes("/attachments/files/")
        ? posixUrl.replace("/attachments/files/", "/attachments/pointers/")
        : posixUrl;

    const fileUri = vscode.Uri.joinPath(
        workspaceFolder.uri,
        ...filesPosix.split("/").filter(Boolean)
    );
    const pointerUri = vscode.Uri.joinPath(
        workspaceFolder.uri,
        ...pointersPosix.split("/").filter(Boolean)
    );

    // Check files exists
    let fileExists = false;
    try {
        await vscode.workspace.fs.stat(fileUri);
        fileExists = true;
    } catch {
        fileExists = false;
    }
    if (!fileExists) return false;

    // If pointer already exists, done
    try {
        await vscode.workspace.fs.stat(pointerUri);
        return true;
    } catch { /* create it below */ }

    try {
        const bytes = await vscode.workspace.fs.readFile(fileUri);
        // Ensure parent directory exists
        const pointerDir = vscode.Uri.file(path.posix.dirname(pointerUri.fsPath));
        try { await vscode.workspace.fs.createDirectory(pointerDir); } catch { /* ignore */ }
        await vscode.workspace.fs.writeFile(pointerUri, bytes);
        return true;
    } catch {
        return false;
    }
}

/**
 * Revalidates and updates isMissing flags for all audio attachments on a specific cell.
 * Returns true if any flag changed.
 */
export async function revalidateCellMissingFlags(
    document: CodexCellDocument,
    workspaceFolder: vscode.WorkspaceFolder,
    cellId: string
): Promise<boolean> {
    try {
        const cell = (document as any)._documentData?.cells?.find(
            (c: any) => c?.metadata?.id === cellId
        );
        if (!cell?.metadata?.attachments) return false;

        let changed = false;
        for (const [attId, attVal] of Object.entries(cell.metadata.attachments) as [string, any][]) {
            if (!attVal || typeof attVal !== "object") continue;
            if (attVal.type !== "audio") continue;
            const url: string | undefined = attVal.url;
            if (!url || typeof url !== "string") continue;

            // If the file exists but pointer is missing, try to restore the pointer now
            let existsInPointers = await attachmentPointerExists(workspaceFolder, url);
            if (!existsInPointers) {
                existsInPointers = await ensurePointerFromFiles(workspaceFolder, url);
            }
            const desiredMissing = !existsInPointers;
            // Use shared util to set flag and bump updatedAt only when changed
            const updated = { ...attVal };
            if (setMissingFlagOnAttachmentObject(updated, desiredMissing)) {
                document.updateCellAttachment(cellId, attId, updated);
                changed = true;
            }
        }
        return changed;
    } catch (err) {
        console.error("Failed to revalidate missing flags for cell", { cellId, err });
        return false;
    }
}

/**
 * Sets the isMissing flag on an attachment object and updates updatedAt when changed.
 * Returns true if the object was modified.
 */
export function setMissingFlagOnAttachmentObject(att: any, desiredMissing: boolean): boolean {
    try {
        const current = att?.isMissing ?? false;
        if (current !== desiredMissing) {
            att.isMissing = desiredMissing;
            att.updatedAt = Date.now();
            return true;
        }
        return false;
    } catch {
        return false;
    }
}

/**
 * Clears `isMissing` on a specific attachment after a successful resolution.
 * Used by the audio playback handler to repair stale flags whenever the
 * resolver successfully fetched bytes (either from a local file or from LFS).
 *
 * Asymmetric on purpose: we never *set* `isMissing=true` from runtime
 * resolution failures because they're often transient (network, auth). The
 * migration scan is the only thing that proactively marks attachments as
 * missing.
 */
export function clearMissingFlagAfterSuccess(
    document: CodexCellDocument,
    cellId: string,
    attachmentId: string
): void {
    try {
        const cell = (document as any)._documentData?.cells?.find(
            (c: any) => c?.metadata?.id === cellId
        );
        const attachment = cell?.metadata?.attachments?.[attachmentId];
        if (!attachment || attachment.isMissing !== true) {
            return;
        }
        const updated = { ...attachment };
        if (setMissingFlagOnAttachmentObject(updated, false)) {
            document.updateCellAttachment(cellId, attachmentId, updated);
        }
    } catch (err) {
        // Non-fatal: leave the stale flag in place rather than disrupt playback.
        console.warn("Failed to clear isMissing after successful resolution", { cellId, attachmentId, err });
    }
}


