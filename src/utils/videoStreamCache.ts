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
 * Fires whenever the session video cache gains or loses a copy (load / save /
 * free). The cache lives in extension global storage, which no workspace
 * FileSystemWatcher can observe, so this event lets interested views (e.g. the
 * navigation cards) refresh their "loaded (temporary)" state immediately.
 */
const cacheChangeEmitter = new vscode.EventEmitter<string | undefined>();
/**
 * Fires with the affected LFS oid on a single write/delete, or `undefined` when
 * the whole cache is cleared (so listeners should refresh everything).
 */
export const onDidChangeVideoStreamCache: vscode.Event<string | undefined> =
    cacheChangeEmitter.event;

/**
 * Remembered global-storage location. Captured whenever a helper is called with
 * a real ExtensionContext (e.g. on activation), so later operations that don't
 * have a context on hand — such as post-sync cleanup — can still find the cache.
 */
let cachedStorageBase: vscode.Uri | undefined;

/**
 * Returns the root folder for the video stream cache (under the extension's
 * global storage, i.e. outside any project), or `undefined` if global storage
 * isn't available. A context is optional: when omitted, the last-seen global
 * storage location is used.
 */
export function getVideoStreamCacheRoot(
    context?: vscode.ExtensionContext
): vscode.Uri | undefined {
    if (context?.globalStorageUri) {
        cachedStorageBase = context.globalStorageUri;
    }
    const base = context?.globalStorageUri ?? cachedStorageBase;
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
    context: vscode.ExtensionContext | undefined,
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
    context: vscode.ExtensionContext | undefined,
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
    context: vscode.ExtensionContext | undefined,
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
    cacheChangeEmitter.fire(oid);
    return uri;
}

/**
 * Reads the cached bytes for an LFS object, or `undefined` if there is no
 * session copy (or the cache is unavailable). Used to "save to project" an
 * already-streamed video by moving it out of the cache without re-downloading.
 */
export async function readCachedVideo(
    context: vscode.ExtensionContext | undefined,
    oid: string,
    ext?: string
): Promise<Uint8Array | undefined> {
    const uri = getCachedVideoUri(context, oid, ext);
    if (!uri) {
        return undefined;
    }
    try {
        return await vscode.workspace.fs.readFile(uri);
    } catch {
        return undefined;
    }
}

/**
 * Removes a single cached video. Used after moving a streamed copy into the
 * project so the bytes live in exactly one place.
 */
export async function deleteCachedVideo(
    context: vscode.ExtensionContext | undefined,
    oid: string,
    ext?: string
): Promise<void> {
    const uri = getCachedVideoUri(context, oid, ext);
    if (!uri) {
        return;
    }
    try {
        await vscode.workspace.fs.delete(uri, { useTrash: false });
    } catch {
        // Nothing cached — nothing to remove.
    }
    cacheChangeEmitter.fire(oid);
}

/**
 * Deletes the entire cache folder. Called on activation so temporary videos do
 * not survive a reload (matches the in-memory audio cache lifetime).
 */
export async function clearVideoStreamCache(
    context?: vscode.ExtensionContext
): Promise<void> {
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
    // undefined oid → "everything changed", listeners refresh all open videos.
    cacheChangeEmitter.fire(undefined);
}
