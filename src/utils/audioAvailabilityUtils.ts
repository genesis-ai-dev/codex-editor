import * as vscode from "vscode";
import path from "path";
import { toPosixPath } from "./pathUtils";

export type AudioAvailabilityState =
    | "available-local"
    | "available-pointer"
    | "missing"
    | "deletedOnly"
    | "none";

interface AttachmentLike {
    url?: string;
    type?: string;
    isDeleted?: boolean;
    isMissing?: boolean;
}

/**
 * Check the on-disk availability of a single audio attachment.
 *
 * Resolution order:
 *  1. isDeleted flag -> "deletedOnly"
 *  2. isMissing flag (set when editor opens) -> "missing"
 *  3. stat the files/ path; if it exists, inspect whether it's an LFS pointer
 *  4. stat the pointers/ path as a fallback -> "available-pointer"
 *  5. Otherwise -> "missing"
 */
export async function checkAttachmentAvailability(
    attachment: AttachmentLike,
    workspaceFolder: vscode.WorkspaceFolder
): Promise<Exclude<AudioAvailabilityState, "none">> {
    if (attachment.isDeleted) {
        return "deletedOnly";
    }
    if (attachment.isMissing) {
        return "missing";
    }

    const url = String(attachment.url || "");
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
 * Priority: available-local > available-pointer > missing > deletedOnly > none
 * This means if *any* attachment is locally available the cell reports as such,
 * even if the user's explicit selection points to a missing file.
 */
export async function computeCellAudioState(
    attachments: Record<string, AttachmentLike> | undefined,
    selectedAudioId: string | undefined,
    workspaceFolder: vscode.WorkspaceFolder
): Promise<AudioAvailabilityState> {
    if (!attachments || Object.keys(attachments).length === 0) {
        return "none";
    }

    let hasAvailable = false;
    let hasAvailablePointer = false;
    let hasMissing = false;
    let hasDeleted = false;

    for (const att of Object.values(attachments)) {
        if (!att || att.type !== "audio") continue;

        const state = await checkAttachmentAvailability(att, workspaceFolder);
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
        selectedAtt?.type === "audio" && selectedAtt?.isMissing === true;

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
    workspaceFolder: vscode.WorkspaceFolder
): Promise<AudioAvailabilityState> {
    const state = await computeCellAudioState(attachments, selectedAudioId, workspaceFolder);
    return applyFrontierVersionGate(state);
}

/**
 * Check whether a cell's selected audio is missing from disk.
 * Lighter-weight helper for progress tracking where we only need a boolean
 * (e.g. the navigation sidebar).
 */
export async function isSelectedAudioMissing(
    attachments: Record<string, AttachmentLike> | undefined,
    selectedAudioId: string | undefined,
    workspaceFolder: vscode.WorkspaceFolder
): Promise<boolean> {
    if (!selectedAudioId || !attachments) return false;

    const att = attachments[selectedAudioId];
    if (!att || att.type !== "audio" || att.isDeleted) return false;

    const state = await checkAttachmentAvailability(att, workspaceFolder);
    return state === "missing";
}
