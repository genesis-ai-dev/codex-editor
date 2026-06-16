import * as vscode from "vscode";
import * as path from "path";
import { getAuthApi } from "../../../extension";
import {
    parsePointerFile,
    isPointerFile,
    replaceFileWithPointer,
    type LFSPointer,
} from "../../../utils/lfsHelpers";
import { getVideoWorkspaceRelativePath, isHttpVideoUrl } from "./videoUtils";

const FILES_SEG = "attachments/files/";

/**
 * Tracks chapter-video fetches that are currently in flight (e.g. a "Load
 * video"/"Save to project" started from a navigation card). Lets an editor that
 * opens its player mid-operation reflect the loading state instead of briefly
 * showing the "needs download" placeholder. Keyed per workspace + video ref.
 */
const inFlightVideoOps = new Set<string>();

/** Stable key for an in-flight video operation, shared by card + editor. */
export function videoOperationKey(workspaceUri: vscode.Uri, videoUrl: string): string {
    return `${workspaceUri.fsPath}::${videoUrl}`;
}

export function beginVideoOperation(workspaceUri: vscode.Uri, videoUrl: string): void {
    inFlightVideoOps.add(videoOperationKey(workspaceUri, videoUrl));
}

export function endVideoOperation(workspaceUri: vscode.Uri, videoUrl: string): void {
    inFlightVideoOps.delete(videoOperationKey(workspaceUri, videoUrl));
}

export function isVideoOperationInFlight(workspaceUri: vscode.Uri, videoUrl: string): boolean {
    return inFlightVideoOps.has(videoOperationKey(workspaceUri, videoUrl));
}

/** Tail of a local video reference relative to `attachments/files/`. */
function relativeToFilesSegment(rel: string | null): string | null {
    if (!rel || !rel.includes(FILES_SEG)) {
        return null;
    }
    return rel.slice(rel.indexOf(FILES_SEG) + FILES_SEG.length);
}

interface VideoPaths {
    rel: string;
    filesUri: vscode.Uri;
    pointersUri: vscode.Uri;
    ext: string;
}

/** Resolve the files/ + pointers/ locations for a local video reference. */
function getVideoPaths(workspaceUri: vscode.Uri, rel: string): VideoPaths {
    const filesUri = vscode.Uri.joinPath(workspaceUri, rel);
    const pointersRel = rel.includes(FILES_SEG)
        ? rel.replace(FILES_SEG, "attachments/pointers/")
        : rel;
    const pointersUri = vscode.Uri.joinPath(workspaceUri, pointersRel);
    return { rel, filesUri, pointersUri, ext: path.extname(rel) };
}

/**
 * Revert a downloaded video in `files/` back to its LFS pointer to free disk
 * space. The reference (videoUrl) is preserved so it can be re-downloaded /
 * streamed later. In stream-only mode the saved copy is also dropped from the
 * persisted-media allowlist (it is no longer "saved to project").
 *
 * @returns true if a local file was reverted to a pointer.
 */
export async function freeVideoFileToPointer(
    workspaceUri: vscode.Uri,
    videoUrl: string | undefined | null
): Promise<boolean> {
    if (!videoUrl || isHttpVideoUrl(videoUrl)) {
        return false;
    }
    const rel = getVideoWorkspaceRelativePath(videoUrl, workspaceUri);
    const relFromFiles = relativeToFilesSegment(rel);
    if (!relFromFiles) {
        return false;
    }

    const freed = await replaceFileWithPointer(workspaceUri.fsPath, relFromFiles);
    if (!freed) {
        return false;
    }

    const { getMediaFilesStrategy, removePersistedMediaFile } = await import(
        "../../../utils/localProjectSettings"
    );
    const strategy = (await getMediaFilesStrategy(workspaceUri)) ?? "auto-download";
    if (strategy === "stream-only") {
        await removePersistedMediaFile(relFromFiles, workspaceUri);
    }
    return true;
}

/**
 * Whether this video already has a temporary copy in the session cache (i.e. it
 * was streamed this session). Used to tailor the "save to project" confirmation
 * so the user knows the bytes will be moved from temporary storage rather than
 * downloaded fresh.
 */
export async function isVideoSessionCached(
    workspaceUri: vscode.Uri,
    videoUrl: string | undefined | null,
    extensionContext: vscode.ExtensionContext
): Promise<boolean> {
    if (!videoUrl || isHttpVideoUrl(videoUrl)) {
        return false;
    }
    const rel = getVideoWorkspaceRelativePath(videoUrl, workspaceUri);
    if (!rel) {
        return false;
    }
    const paths = getVideoPaths(workspaceUri, rel);
    const pointer = await resolvePointer(paths);
    if (!pointer) {
        return false;
    }
    try {
        const { hasCachedVideo } = await import("../../../utils/videoStreamCache");
        return await hasCachedVideo(extensionContext, pointer.oid, paths.ext);
    } catch {
        return false;
    }
}

export interface DownloadVideoResult {
    ok: boolean;
    /** True when the bytes were already available locally (no download needed). */
    alreadyPresent?: boolean;
    error?: string;
}

/** Resolve the LFS pointer backing a local video (from files/ or pointers/). */
async function resolvePointer(paths: VideoPaths): Promise<LFSPointer | null> {
    return (
        (await parsePointerFile(paths.filesUri.fsPath).catch(() => null)) ??
        (await parsePointerFile(paths.pointersUri.fsPath).catch(() => null))
    );
}

/** Download + verify the LFS object bytes against the pointer's expected size. */
async function fetchVerifiedBytes(
    workspaceUri: vscode.Uri,
    pointer: LFSPointer
): Promise<{ bytes: Uint8Array } | { error: string }> {
    const authApi = getAuthApi();
    if (!authApi?.downloadLFSFile) {
        return { error: "Cannot download: the Frontier Authentication extension is unavailable." };
    }
    try {
        const buffer = await authApi.downloadLFSFile(workspaceUri.fsPath, pointer.oid, pointer.size);
        const byteLength = buffer?.byteLength ?? 0;
        if (byteLength === 0) {
            return { error: "Download returned no data." };
        }
        if (pointer.size > 0 && byteLength !== pointer.size) {
            return {
                error: `Downloaded ${byteLength} of ${pointer.size} bytes; the file is incomplete.`,
            };
        }
        return { bytes: new Uint8Array(buffer) };
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { error: `Download failed: ${msg}` };
    }
}

/**
 * Download an LFS-backed video into the project (`files/`), with "save to
 * project" semantics: the bytes persist locally (files/ is gitignored), and in
 * stream-only mode the rel-path is added to the persisted-media allowlist so
 * later cleanup/sync won't revert it. Does not touch any webview.
 */
export async function downloadVideoToProject(
    workspaceUri: vscode.Uri,
    videoUrl: string | undefined | null,
    extensionContext?: vscode.ExtensionContext
): Promise<DownloadVideoResult> {
    if (!videoUrl || isHttpVideoUrl(videoUrl)) {
        return { ok: false, error: "This is not a downloadable local video reference." };
    }
    const rel = getVideoWorkspaceRelativePath(videoUrl, workspaceUri);
    if (!rel) {
        return { ok: false, error: "Could not resolve the video file path." };
    }
    const paths = getVideoPaths(workspaceUri, rel);

    // Already a real local file (not a pointer stub)? Nothing to download.
    if (!(await isPointerFile(paths.filesUri.fsPath).catch(() => false))) {
        try {
            await vscode.workspace.fs.stat(paths.filesUri);
            return { ok: true, alreadyPresent: true };
        } catch {
            // Not present; continue to download.
        }
    }

    const pointer = await resolvePointer(paths);
    if (!pointer) {
        return { ok: false, error: "No LFS reference found for this video." };
    }

    // Prefer MOVING an already-streamed copy out of the session cache instead of
    // re-downloading. The cached bytes are dropped after a successful write so
    // the video ends up in exactly one place (the project files/).
    let bytes: Uint8Array | undefined;
    let movedFromCache = false;
    if (extensionContext) {
        try {
            const { readCachedVideo } = await import("../../../utils/videoStreamCache");
            const cached = await readCachedVideo(extensionContext, pointer.oid, paths.ext);
            if (
                cached &&
                cached.byteLength > 0 &&
                (pointer.size <= 0 || cached.byteLength === pointer.size)
            ) {
                bytes = cached;
                movedFromCache = true;
            }
        } catch {
            // Cache unavailable — fall back to a fresh download.
        }
    }

    if (!bytes) {
        const fetched = await fetchVerifiedBytes(workspaceUri, pointer);
        if ("error" in fetched) {
            return { ok: false, error: fetched.error };
        }
        bytes = fetched.bytes;
    }

    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(paths.filesUri, ".."));
    await vscode.workspace.fs.writeFile(paths.filesUri, bytes);

    // Confirm real bytes landed (not still a pointer) before reporting success.
    const writtenIsPointer = await isPointerFile(paths.filesUri.fsPath).catch(() => true);
    if (writtenIsPointer) {
        return { ok: false, error: "The video file is not available after download." };
    }

    // Move semantics: now that the bytes live in the project, remove the
    // temporary session copy so the video isn't duplicated.
    if (movedFromCache && extensionContext) {
        try {
            const { deleteCachedVideo } = await import("../../../utils/videoStreamCache");
            await deleteCachedVideo(extensionContext, pointer.oid, paths.ext);
        } catch {
            // Best-effort cleanup; the project copy is already in place.
        }
    }

    // In stream-only, an explicit save must be protected from automatic
    // pointer-replacement cleanup (other strategies keep files/ by design).
    const { getMediaFilesStrategy, addPersistedMediaFile } = await import(
        "../../../utils/localProjectSettings"
    );
    const strategy = (await getMediaFilesStrategy(workspaceUri)) ?? "auto-download";
    if (strategy === "stream-only") {
        const savedRel = relativeToFilesSegment(rel);
        if (savedRel) {
            await addPersistedMediaFile(savedRel, workspaceUri);
        }
    }

    return { ok: true };
}

/**
 * Download an LFS-backed video into the ephemeral session cache (global
 * storage, outside the project) without persisting it. files/ stays a pointer,
 * so the card still shows "not downloaded", but the editor can play it instantly
 * this session. Cleared on reload. Used by the stream-only "Stream this session"
 * choice.
 */
export async function downloadVideoToSessionCache(
    workspaceUri: vscode.Uri,
    videoUrl: string | undefined | null,
    extensionContext: vscode.ExtensionContext
): Promise<DownloadVideoResult> {
    if (!videoUrl || isHttpVideoUrl(videoUrl)) {
        return { ok: false, error: "This is not a downloadable local video reference." };
    }
    const rel = getVideoWorkspaceRelativePath(videoUrl, workspaceUri);
    if (!rel) {
        return { ok: false, error: "Could not resolve the video file path." };
    }
    const paths = getVideoPaths(workspaceUri, rel);

    const pointer = await resolvePointer(paths);
    if (!pointer) {
        return { ok: false, error: "No LFS reference found for this video." };
    }

    const { writeCachedVideo, hasCachedVideo } = await import("../../../utils/videoStreamCache");
    if (await hasCachedVideo(extensionContext, pointer.oid, paths.ext)) {
        return { ok: true, alreadyPresent: true };
    }

    const fetched = await fetchVerifiedBytes(workspaceUri, pointer);
    if ("error" in fetched) {
        return { ok: false, error: fetched.error };
    }
    await writeCachedVideo(extensionContext, pointer.oid, paths.ext, fetched.bytes);
    return { ok: true };
}
