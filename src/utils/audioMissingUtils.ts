import * as vscode from "vscode";
import path from "path";
import { toPosixPath, normalizeAttachmentUrl } from "./pathUtils";
import type { CodexCellDocument } from "../providers/codexCellEditorProvider/codexDocument";
import type { AttachmentAvailability } from "../../types";
import { determineAttachmentAvailability } from "./audioAvailabilityUtils";

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

    let fileExists = false;
    try {
        await vscode.workspace.fs.stat(fileUri);
        fileExists = true;
    } catch {
        fileExists = false;
    }
    if (!fileExists) return false;

    try {
        await vscode.workspace.fs.stat(pointerUri);
        return true;
    } catch { /* create it below */ }

    try {
        const bytes = await vscode.workspace.fs.readFile(fileUri);
        const pointerDir = vscode.Uri.file(path.posix.dirname(pointerUri.fsPath));
        try { await vscode.workspace.fs.createDirectory(pointerDir); } catch { /* ignore */ }
        await vscode.workspace.fs.writeFile(pointerUri, bytes);
        return true;
    } catch {
        return false;
    }
}

/**
 * Revalidates and updates audioAvailability for all audio attachments on a specific cell.
 * Performs filesystem checks at revalidation time and persists the result.
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

            const availability = existsInPointers
                ? await determineAttachmentAvailability(workspaceFolder, url)
                : "missing" as AttachmentAvailability;

            const updated = { ...attVal };
            if (setAttachmentAvailability(updated, availability)) {
                document.updateCellAttachment(cellId, attId, updated);
                changed = true;
            }
        }
        return changed;
    } catch (err) {
        console.error("Failed to revalidate availability for cell", { cellId, err });
        return false;
    }
}

/**
 * Sets the audioAvailability field on an attachment object and updates updatedAt when changed.
 * Also sets the deprecated isMissing field for backward compatibility.
 * Returns true if the object was modified.
 */
export function setAttachmentAvailability(att: any, availability: AttachmentAvailability): boolean {
    try {
        const current = att?.audioAvailability;
        if (current !== availability) {
            att.audioAvailability = availability;
            att.isMissing = availability === "missing";
            att.updatedAt = Date.now();
            return true;
        }
        return false;
    } catch {
        return false;
    }
}

/**
 * Revalidates audioAvailability for ALL audio attachments across every cell in a document.
 * Performs filesystem checks and persists updated metadata.
 * Returns true if any flag changed.
 */
export async function revalidateDocumentAudioFlags(
    document: CodexCellDocument,
    workspaceFolder: vscode.WorkspaceFolder
): Promise<boolean> {
    try {
        const cells = (document as any)._documentData?.cells || [];
        let anyChanged = false;

        for (const cell of cells) {
            const cellId = cell?.metadata?.id;
            if (!cellId || !cell?.metadata?.attachments) continue;

            const hasAudio = Object.values(cell.metadata.attachments).some(
                (att: any) => att?.type === "audio"
            );
            if (!hasAudio) continue;

            const changed = await revalidateCellMissingFlags(document, workspaceFolder, cellId);
            if (changed) anyChanged = true;
        }

        if (anyChanged) {
            await document.save(new vscode.CancellationTokenSource().token);
        }

        return anyChanged;
    } catch (err) {
        console.error("Failed to revalidate document audio flags", err);
        return false;
    }
}

/**
 * @deprecated Use setAttachmentAvailability instead.
 * Kept for backward compatibility during migration window.
 */
export function setMissingFlagOnAttachmentObject(att: any, desiredMissing: boolean): boolean {
    const availability: AttachmentAvailability = desiredMissing ? "missing" : "available-local";
    return setAttachmentAvailability(att, availability);
}
