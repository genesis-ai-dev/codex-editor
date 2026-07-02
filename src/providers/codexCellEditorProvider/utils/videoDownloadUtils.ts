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
const inFlightVideoOps = new Map<string, AbortController>();

/** Stable key for an in-flight video operation, shared by card + editor. */
export function videoOperationKey(workspaceUri: vscode.Uri, videoUrl: string): string {
    return `${workspaceUri.fsPath}::${videoUrl}`;
}

/**
 * Mark a chapter-video fetch as in flight and return its AbortController. The
 * controller's signal is threaded into the LFS download so the op can be
 * cancelled when the video is deleted/replaced mid-download (issue #1038),
 * preventing a finishing download from resurrecting the deleted file. Any prior
 * controller for the same key is aborted first so it can't leak.
 */
export function beginVideoOperation(workspaceUri: vscode.Uri, videoUrl: string): AbortController {
    const key = videoOperationKey(workspaceUri, videoUrl);
    inFlightVideoOps.get(key)?.abort();
    const controller = new AbortController();
    inFlightVideoOps.set(key, controller);
    return controller;
}

export function endVideoOperation(workspaceUri: vscode.Uri, videoUrl: string): void {
    inFlightVideoOps.delete(videoOperationKey(workspaceUri, videoUrl));
}

export function isVideoOperationInFlight(workspaceUri: vscode.Uri, videoUrl: string): boolean {
    return inFlightVideoOps.has(videoOperationKey(workspaceUri, videoUrl));
}

/**
 * Abort an in-flight chapter-video download for this video, if any. Called when
 * the video is deleted or replaced so the in-progress fetch stops and its bytes
 * are never written back over the deletion (issue #1038). Returns true if an op
 * was aborted.
 */
export function abortVideoOperation(
    workspaceUri: vscode.Uri,
    videoUrl: string | undefined | null
): boolean {
    if (!videoUrl) {
        return false;
    }
    const controller = inFlightVideoOps.get(videoOperationKey(workspaceUri, videoUrl));
    if (controller && !controller.signal.aborted) {
        controller.abort();
        return true;
    }
    return false;
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
    pointer: LFSPointer,
    signal?: AbortSignal
): Promise<{ bytes: Uint8Array } | { error: string }> {
    if (signal?.aborted) {
        return { error: "Download cancelled." };
    }
    const authApi = getAuthApi();
    if (!authApi?.downloadLFSFile) {
        return { error: "Cannot download: the Frontier Authentication extension is unavailable." };
    }
    try {
        const buffer = await authApi.downloadLFSFile(workspaceUri.fsPath, pointer.oid, pointer.size, signal);
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
    extensionContext?: vscode.ExtensionContext,
    signal?: AbortSignal
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

    // Snapshot whatever files/ holds right now (a pointer stub, or nothing). An
    // abort can land while the downloaded bytes are being WRITTEN — after the
    // pre-write signal check below — and a large video's write takes real time.
    // The post-write check restores this exact pre-download state so a cancel
    // always wins and no downloaded bytes remain on disk.
    let preDownloadStub: Uint8Array | undefined;
    try {
        preDownloadStub = await vscode.workspace.fs.readFile(paths.filesUri);
    } catch {
        preDownloadStub = undefined; // absent — reverting means deleting
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
        const fetched = await fetchVerifiedBytes(workspaceUri, pointer, signal);
        if ("error" in fetched) {
            return { ok: false, error: fetched.error };
        }
        bytes = fetched.bytes;
    }

    // The video may have been deleted/replaced while the download was running.
    // Never write the bytes back in that case, or we'd resurrect the deleted
    // file (issue #1038).
    if (signal?.aborted) {
        return { ok: false, error: "Download cancelled." };
    }

    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(paths.filesUri, ".."));
    await vscode.workspace.fs.writeFile(paths.filesUri, bytes);

    // Confirm real bytes landed (not still a pointer) before reporting success.
    const writtenIsPointer = await isPointerFile(paths.filesUri.fsPath).catch(() => true);
    if (writtenIsPointer) {
        return { ok: false, error: "The video file is not available after download." };
    }

    // A cancel (or delete/replace) that raced the write above: honor it now by
    // reverting files/ to the pre-download snapshot, so the cancel wins and no
    // downloaded bytes remain saved (issue #1038 follow-up).
    if (signal?.aborted) {
        try {
            if (preDownloadStub) {
                await vscode.workspace.fs.writeFile(paths.filesUri, preDownloadStub);
            } else {
                await vscode.workspace.fs.delete(paths.filesUri);
            }
        } catch {
            // Best effort — worst case a complete (never partial) file remains.
        }
        return { ok: false, error: "Download cancelled." };
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
    extensionContext: vscode.ExtensionContext,
    signal?: AbortSignal
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

    const fetched = await fetchVerifiedBytes(workspaceUri, pointer, signal);
    if ("error" in fetched) {
        return { ok: false, error: fetched.error };
    }
    // Cancelled mid-download (video deleted/replaced) — don't populate the cache.
    if (signal?.aborted) {
        return { ok: false, error: "Download cancelled." };
    }
    await writeCachedVideo(extensionContext, pointer.oid, paths.ext, fetched.bytes);
    // A cancel that raced the cache write: drop the entry so nothing remains.
    if (signal?.aborted) {
        try {
            const { deleteCachedVideo } = await import("../../../utils/videoStreamCache");
            await deleteCachedVideo(extensionContext, pointer.oid, paths.ext);
        } catch {
            // Best effort — the cache is ephemeral (cleared on reload) anyway.
        }
        return { ok: false, error: "Download cancelled." };
    }
    return { ok: true };
}
