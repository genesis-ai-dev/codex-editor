import * as vscode from "vscode";
import path from "path";
import { toPosixPath } from "./pathUtils";
import type { AttachmentAvailability } from "../../types";

export type AudioAvailabilityState =
    | "available-local"
    | "available-pointer"
    | "missing"
    | "deletedOnly"
    | "none";

export interface AttachmentLike {
    url?: string;
    type?: string;
    isDeleted?: boolean;
    audioAvailability?: AttachmentAvailability;
    /** @deprecated Use audioAvailability instead */
    isMissing?: boolean;
}

/**
 * Read the persisted availability state of a single audio attachment.
 * Pure metadata read — no filesystem I/O.
 *
 * Resolution order:
 *  1. isDeleted flag -> "deletedOnly"
 *  2. audioAvailability field (set at write time) -> that value
 *  3. Legacy isMissing fallback -> "missing" if true, "available-local" if false
 *  4. No field set and no URL -> "missing"
 *  5. No field set but URL present -> "available-local" (optimistic default)
 */
export function checkAttachmentAvailability(
    attachment: AttachmentLike,
): Exclude<AudioAvailabilityState, "none"> {
    if (attachment.isDeleted) {
        return "deletedOnly";
    }

    if (attachment.audioAvailability) {
        return attachment.audioAvailability;
    }

    // Legacy fallback: isMissing boolean
    if (attachment.isMissing === true) {
        return "missing";
    }
    if (attachment.isMissing === false) {
        return "available-local";
    }

    // No availability metadata at all
    const url = String(attachment.url || "");
    if (!url) {
        return "missing";
    }

    return "available-local";
}

/**
 * Determine the on-disk availability of an attachment by performing filesystem
 * stat calls and LFS pointer detection. Intended for **write-time** use only —
 * call this when recording, importing, migrating, or revalidating, then persist
 * the result as `audioAvailability` on the attachment.
 */
export async function determineAttachmentAvailability(
    workspaceFolder: vscode.WorkspaceFolder,
    attachmentUrl: string
): Promise<Exclude<AttachmentAvailability, never>> {
    const url = String(attachmentUrl || "");
    if (!url) {
        return "missing";
    }

    const filesRel = url.startsWith(".project/") ? url : url.replace(/^\.?\/?/, "");
    const filesAbs = path.join(workspaceFolder.uri.fsPath, filesRel);

    try {
        await vscode.workspace.fs.stat(vscode.Uri.file(filesAbs));
        const { isPointerFile } = await import("./lfsHelpers");
        const isPtr = await isPointerFile(filesAbs).catch(() => false);
        return isPtr ? "available-pointer" : "available-local";
    } catch {
        // files/ path doesn't exist — try the pointers/ equivalent
    }

    try {
        const normalizedPosix = toPosixPath(filesAbs);
        const pointerAbs = normalizedPosix.includes("/attachments/files/")
            ? filesAbs.replace(
                  path.join(".project", "attachments", "files"),
                  path.join(".project", "attachments", "pointers")
              )
            : filesAbs;

        if (pointerAbs !== filesAbs) {
            await vscode.workspace.fs.stat(vscode.Uri.file(pointerAbs));
            return "available-pointer";
        }
    } catch {
        // pointer path doesn't exist either
    }

    return "missing";
}

/**
 * Compute the overall audio availability state for a cell by inspecting
 * all of its audio attachments and the selectedAudioId.
 *
 * Pure metadata read — no filesystem I/O.
 *
 * Priority: available-local > available-pointer > missing > deletedOnly > none
 */
export function computeCellAudioState(
    attachments: Record<string, AttachmentLike> | undefined,
    selectedAudioId: string | undefined,
): AudioAvailabilityState {
    if (!attachments || Object.keys(attachments).length === 0) {
        return "none";
    }

    let hasAvailable = false;
    let hasAvailablePointer = false;
    let hasMissing = false;
    let hasDeleted = false;

    for (const att of Object.values(attachments)) {
        if (!att || att.type !== "audio") continue;

        const state = checkAttachmentAvailability(att);
        switch (state) {
            case "available-local":
                hasAvailable = true;
                break;
            case "available-pointer":
                hasAvailablePointer = true;
                break;
            case "missing":
                hasMissing = true;
                break;
            case "deletedOnly":
                hasDeleted = true;
                break;
        }
    }

    const selectedAtt = selectedAudioId ? attachments[selectedAudioId] : undefined;
    const selectedIsMissing =
        selectedAtt?.type === "audio" &&
        (selectedAtt?.audioAvailability === "missing" || selectedAtt?.isMissing === true);

    if (hasAvailable) return "available-local";
    if (hasAvailablePointer) return "available-pointer";
    if (selectedIsMissing || hasMissing) return "missing";
    if (hasDeleted) return "deletedOnly";
    return "none";
}

/**
 * Apply the Frontier installed-version gate.
 * When Frontier is below the minimum version, non-local availability
 * is normalised to "available-pointer" so the Play UI is hidden.
 */
export async function applyFrontierVersionGate(
    state: AudioAvailabilityState
): Promise<AudioAvailabilityState> {
    if (state === "available-local") return state;

    try {
        const { getFrontierVersionStatus } = await import(
            "../projectManager/utils/versionChecks"
        );
        const status = await getFrontierVersionStatus();
        if (
            !status.ok &&
            state !== "missing" &&
            state !== "deletedOnly" &&
            state !== "none"
        ) {
            return "available-pointer";
        }
    } catch {
        // leave state unchanged on check failure
    }
    return state;
}

/**
 * Convenience: compute cell audio state with the Frontier version gate applied.
 */
export async function computeCellAudioStateWithVersionGate(
    attachments: Record<string, AttachmentLike> | undefined,
    selectedAudioId: string | undefined,
): Promise<AudioAvailabilityState> {
    const state = computeCellAudioState(attachments, selectedAudioId);
    return applyFrontierVersionGate(state);
}

/**
 * Check whether a cell's selected audio is missing.
 * Pure metadata read — no filesystem I/O.
 */
export function isSelectedAudioMissing(
    attachments: Record<string, AttachmentLike> | undefined,
    selectedAudioId: string | undefined,
): boolean {
    if (!selectedAudioId || !attachments) return false;

    const att = attachments[selectedAudioId];
    if (!att || att.type !== "audio" || att.isDeleted) return false;

    const state = checkAttachmentAvailability(att);
    return state === "missing";
}
