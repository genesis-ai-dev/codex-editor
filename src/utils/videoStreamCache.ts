import * as vscode from "vscode";

/**
 * On-disk cache for stream-only "Load video" playback.
 *
 * Large videos can't live in the in-memory media cache (they blow the cap and
 * are expensive to ship over the webview boundary), and they must NOT pollute
 * the project tree — in stream-only mode `.project/attachments/files/` is meant
 * to stay as LFS pointers. So temporary videos are written here, completely
 * outside the project, keyed by their LFS oid. The folder is cleared on every
 * activation so a "loaded" video re-streams after a reload, mirroring how the
 * in-memory audio cache behaves.
 *
 * All helpers degrade gracefully when the extension has no global storage
 * (e.g. some test harnesses), treating the cache as simply unavailable.
 */

const CACHE_DIR_NAME = "videoStreamCache";

/**
 * Returns the root folder for the video stream cache (under the extension's
 * global storage, i.e. outside any project), or `undefined` if global storage
 * isn't available.
 */
export function getVideoStreamCacheRoot(
    context: vscode.ExtensionContext
): vscode.Uri | undefined {
    const base = context?.globalStorageUri;
    if (!base) {
        return undefined;
    }
    return vscode.Uri.joinPath(base, CACHE_DIR_NAME);
}

/**
 * Builds the cache URI for a given LFS object, or `undefined` if the cache is
 * unavailable. The original extension is kept so the player can infer the media
 * type from the path.
 */
export function getCachedVideoUri(
    context: vscode.ExtensionContext,
    oid: string,
    ext?: string
): vscode.Uri | undefined {
    const root = getVideoStreamCacheRoot(context);
    if (!root) {
        return undefined;
    }
    const safeExt = ext ? (ext.startsWith(".") ? ext : `.${ext}`) : "";
    return vscode.Uri.joinPath(root, `${oid}${safeExt}`);
}

/**
 * Whether a cached copy already exists for this session.
 */
export async function hasCachedVideo(
    context: vscode.ExtensionContext,
    oid: string,
    ext?: string
): Promise<boolean> {
    const uri = getCachedVideoUri(context, oid, ext);
    if (!uri) {
        return false;
    }
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

/**
 * Writes bytes to the cache and returns the cache file URI. Throws if the cache
 * is unavailable so callers can fall back to an error state.
 */
export async function writeCachedVideo(
    context: vscode.ExtensionContext,
    oid: string,
    ext: string | undefined,
    bytes: Uint8Array
): Promise<vscode.Uri> {
    const root = getVideoStreamCacheRoot(context);
    const uri = getCachedVideoUri(context, oid, ext);
    if (!root || !uri) {
        throw new Error("Video cache is unavailable (no extension global storage).");
    }
    await vscode.workspace.fs.createDirectory(root);
    await vscode.workspace.fs.writeFile(uri, bytes);
    return uri;
}

/**
 * Deletes the entire cache folder. Called on activation so temporary videos do
 * not survive a reload (matches the in-memory audio cache lifetime).
 */
export async function clearVideoStreamCache(context: vscode.ExtensionContext): Promise<void> {
    const root = getVideoStreamCacheRoot(context);
    if (!root) {
        return;
    }
    try {
        await vscode.workspace.fs.delete(root, {
            recursive: true,
            useTrash: false,
        });
    } catch {
        // Folder doesn't exist yet — nothing to clear.
    }
}
