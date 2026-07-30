import * as vscode from "vscode";
import path from "path";
import { toPosixPath, normalizeAttachmentUrl } from "./pathUtils";
import { isLfsPointerContent } from "./lfsHelpers";
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

/**
 * Ensure a pointer exists by mirroring or stubbing `pointers/<X>` from the
 * parallel `files/<X>` file. Returns `true` if the pointer ended up present
 * after the call.
 *
 * Background — what `files/<X>` actually contains per strategy:
 *   • auto-download: raw media bytes (populated at clone by
 *     `reconcilePointersFilesystem`; never demoted).
 *   • stream-and-save: LFS pointer text until the first playback; raw bytes
 *     afterwards (written by `requestAudioForCell` on first play; never
 *     demoted back to pointer text).
 *   • stream-only: LFS pointer text always (populated at clone by
 *     `populateFilesWithPointers`; kept that way by `replaceFileWithPointer`
 *     after every stream and by `postSyncCleanup` after every sync). Streamed
 *     bytes live in the in-memory `lfsCache`, never on disk.
 *   • fresh recording (pre-sync, any strategy): raw bytes — `saveAudioAttachment`
 *     writes raw bytes to BOTH `files/<X>` and `pointers/<X>` so the unsynced
 *     state is symmetric.
 *
 * LFS smudge/clean filters are disabled in this project, so copying raw bytes
 * into the LFS-tracked `pointers/` directory would commit binary content into
 * git history if anything subsequently stages and commits it.
 *
 * Strategy:
 *   1. If `files/<X>` contains LFS pointer text → copy it verbatim. Safe; this
 *      restores the canonical state for stream-only and never-played
 *      stream-and-save entries.
 *   2. If `files/<X>` contains raw media bytes → write a ZERO-BYTE placeholder
 *      to `pointers/<X>`. The next sync push (`addAllWithLFS` in
 *      frontier-authentication) detects empty pointers, recovers bytes from
 *      `files/<X>`, uploads to LFS, and rewrites `pointers/<X>` with canonical
 *      pointer text — see the `buf.length === 0 && isPointerPath(filepath)`
 *      branch in `addAllWithLFS`. This handles:
 *        • Auto-download or played stream-and-save attachments whose pointer
 *          was lost (project copied between machines without the pointers
 *          tree, partial fetch, etc.). The empty placeholder lets sync
 *          re-upload (idempotent on matching OID) and restore the canonical
 *          pointer. Without this fallback, the next sync's `removeMany` would
 *          stage the missing pointer for DELETION and orphan the LFS object
 *          for every teammate.
 *        • Local-unsynced recordings whose pointer got lost between record
 *          and first sync (rare but real). Without the placeholder, git can't
 *          enumerate something it doesn't track + doesn't have, so sync would
 *          silently drop the recording.
 */
export async function ensurePointerFromFiles(
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

        // Ensure parent directory exists for either write path below
        const pointerDir = vscode.Uri.file(path.posix.dirname(pointerUri.fsPath));
        try { await vscode.workspace.fs.createDirectory(pointerDir); } catch { /* ignore */ }

        if (isLfsPointerContent(bytes)) {
            // Stream-mode path: mirror the pointer stub verbatim.
            await vscode.workspace.fs.writeFile(pointerUri, bytes);
        } else {
            // Raw-media path: write a ZERO-BYTE placeholder so sync recovers
            // from files/<X> and writes the canonical pointer itself.
            await vscode.workspace.fs.writeFile(pointerUri, new Uint8Array(0));
        }
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

        // Probe every audio attachment in parallel — pointer-existence checks are
        // independent fs.stat calls and there's no ordering requirement.  The
        // document mutation itself is applied serially after probes complete so
        // the in-memory write path stays single-threaded.
        const entries = Object.entries(cell.metadata.attachments) as [string, any][];
        const probes = await Promise.all(
            entries.map(async ([attId, attVal]) => {
                if (!attVal || typeof attVal !== "object") return null;
                if (attVal.type !== "audio") return null;
                const url: string | undefined = attVal.url;
                if (!url || typeof url !== "string") return null;

                let existsInPointers = await attachmentPointerExists(workspaceFolder, url);
                if (!existsInPointers) {
                    existsInPointers = await ensurePointerFromFiles(workspaceFolder, url);
                }
                const desiredMissing = !existsInPointers;
                const updated = { ...attVal };
                if (setMissingFlagOnAttachmentObject(updated, desiredMissing)) {
                    return { attId, updated };
                }
                return null;
            })
        );

        let changed = false;
        for (const probe of probes) {
            if (!probe) continue;
            document.updateCellAttachment(cellId, probe.attId, probe.updated);
            changed = true;
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


