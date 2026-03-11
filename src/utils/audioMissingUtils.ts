import * as vscode from "vscode";
import path from "path";
import { toPosixPath, normalizeAttachmentUrl } from "./pathUtils";
import type { CodexCellDocument } from "../providers/codexCellEditorProvider/codexDocument";
import type { AttachmentAvailability } from "../../types";
import {
    determineAttachmentAvailability,
    applyFrontierVersionGate,
    type AudioAvailabilityState,
} from "./audioAvailabilityUtils";

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
 * Compute the on-disk audio availability for a single attachment URL.
 * Performs filesystem stat + LFS pointer checks but does NOT mutate the document.
 */
async function computeAttachmentAvailabilityFromDisk(
    workspaceFolder: vscode.WorkspaceFolder,
    url: string,
): Promise<AttachmentAvailability> {
    let existsInPointers = await attachmentPointerExists(workspaceFolder, url);
    if (!existsInPointers) {
        existsInPointers = await ensurePointerFromFiles(workspaceFolder, url);
    }

    return existsInPointers
        ? await determineAttachmentAvailability(workspaceFolder, url)
        : "missing" as AttachmentAvailability;
}

/**
 * Compute the overall audio availability state for a single cell by checking the
 * filesystem. Returns an AudioAvailabilityState without mutating the document.
 *
 * Priority: available-local > available-pointer > missing > deletedOnly > none
 */
export async function computeCellAudioAvailabilityFromDisk(
    document: CodexCellDocument,
    workspaceFolder: vscode.WorkspaceFolder,
    cellId: string,
): Promise<AudioAvailabilityState> {
    try {
        const cell = (document as any)._documentData?.cells?.find(
            (c: any) => c?.metadata?.id === cellId
        );
        if (!cell?.metadata?.attachments) return "none";

        let hasAvailableLocal = false;
        let hasAvailablePointer = false;
        let hasMissing = false;
        let hasDeleted = false;

        for (const attVal of Object.values(cell.metadata.attachments) as any[]) {
            if (!attVal || typeof attVal !== "object") continue;
            if (attVal.type !== "audio") continue;
            if (attVal.isDeleted) {
                hasDeleted = true;
                continue;
            }

            const url: string | undefined = attVal.url;
            if (!url || typeof url !== "string") {
                hasMissing = true;
                continue;
            }

            const availability = await computeAttachmentAvailabilityFromDisk(workspaceFolder, url);
            switch (availability) {
                case "available-local":
                    hasAvailableLocal = true;
                    break;
                case "available-pointer":
                    hasAvailablePointer = true;
                    break;
                case "missing":
                    hasMissing = true;
                    break;
            }
        }

        if (hasAvailableLocal) return "available-local";
        if (hasAvailablePointer) return "available-pointer";
        if (hasMissing) return "missing";
        if (hasDeleted) return "deletedOnly";
        return "none";
    } catch (err) {
        console.error("Failed to compute audio availability for cell", { cellId, err });
        return "none";
    }
}

/**
 * Resolve the Frontier version gate once and return a function that applies it.
 * Avoids repeated dynamic imports and async calls when processing many cells.
 */
async function resolveVersionGate(): Promise<(state: AudioAvailabilityState) => AudioAvailabilityState> {
    try {
        const { getFrontierVersionStatus } = await import(
            "../projectManager/utils/versionChecks"
        );
        const status = await getFrontierVersionStatus();
        if (!status.ok) {
            return (state) => {
                if (
                    state === "available-local" ||
                    state === "missing" ||
                    state === "deletedOnly" ||
                    state === "none"
                ) {
                    return state;
                }
                return "available-pointer";
            };
        }
    } catch {
        // Version check unavailable — pass through unchanged
    }
    return (state) => state;
}

/**
 * Compute audio availability for a specific set of cell IDs by checking the filesystem.
 * Applies the Frontier version gate once for all cells.
 * Returns a map of cellId → AudioAvailabilityState.
 * Does NOT mutate or save the document.
 */
export async function computeCellIdsAudioAvailability(
    document: CodexCellDocument,
    workspaceFolder: vscode.WorkspaceFolder,
    cellIds: string[],
): Promise<Record<string, AudioAvailabilityState>> {
    const result: Record<string, AudioAvailabilityState> = {};
    if (cellIds.length === 0) return result;

    try {
        const gate = await resolveVersionGate();

        for (const cellId of cellIds) {
            const state = await computeCellAudioAvailabilityFromDisk(
                document,
                workspaceFolder,
                cellId,
            );
            result[cellId] = gate(state);
        }
    } catch (err) {
        console.error("Failed to compute audio availability for cells", err);
    }

    return result;
}

/**
 * Compute audio availability for ALL cells with audio in a document.
 * Applies the Frontier version gate once for all cells.
 * Returns a map of cellId → AudioAvailabilityState.
 * Does NOT mutate or save the document.
 */
export async function computeDocumentAudioAvailability(
    document: CodexCellDocument,
    workspaceFolder: vscode.WorkspaceFolder
): Promise<Record<string, AudioAvailabilityState>> {
    try {
        const cells = (document as any)._documentData?.cells || [];
        const audioCellIds: string[] = [];

        for (const cell of cells) {
            const cellId = cell?.metadata?.id;
            if (!cellId || !cell?.metadata?.attachments) continue;

            const hasAudio = Object.values(cell.metadata.attachments).some(
                (att: any) => att?.type === "audio"
            );
            if (hasAudio) {
                audioCellIds.push(cellId);
            }
        }

        return computeCellIdsAudioAvailability(document, workspaceFolder, audioCellIds);
    } catch (err) {
        console.error("Failed to compute document audio availability", err);
        return {};
    }
}

/**
 * Sets the audioAvailability field on an attachment object and updates updatedAt when changed.
 * Also sets the deprecated isMissing field for backward compatibility.
 * Intended for genuine write events only (recording, importing, deleting).
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
 * @deprecated Use setAttachmentAvailability instead.
 * Kept for backward compatibility during migration window.
 */
export function setMissingFlagOnAttachmentObject(att: any, desiredMissing: boolean): boolean {
    const availability: AttachmentAvailability = desiredMissing ? "missing" : "available-local";
    return setAttachmentAvailability(att, availability);
}
