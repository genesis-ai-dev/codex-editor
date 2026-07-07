import * as vscode from "vscode";
import { CodexCellDocument } from "./codexDocument";
import { safePostMessageToPanel } from "../../utils/webviewUtils";
// Use type-only import to break circular dependency
import type { CodexCellEditorProvider } from "./codexCellEditorProvider";
import { resolveSelectedAttachmentState, checkAttachmentAvailabilityStandalone } from "./codexCellEditorProvider";
import { GlobalMessage, EditorPostMessages, EditHistory } from "../../../types";
import { EditMapUtils } from "../../utils/editMapUtils";
import { EditType, CodexCellTypes } from "../../../types/enums";
import {
    QuillCellContent,
    ValidationEntry,
} from "../../../types";
import path from "path";
import { getWorkSpaceUri } from "../../utils";
import { SavedBacktranslation } from "../../smartEdits/smartBacktranslation";
import { getAuthApi } from "@/extension";
// Use VS Code FS API for all file operations (supports remote and virtual workspaces)
import { getCommentsFromFile } from "../../utils/fileUtils";
import { getUnresolvedCommentsCountForCell } from "../../utils/commentsUtils";
import { toPosixPath } from "../../utils/pathUtils";
import { revalidateCellMissingFlags, clearMissingFlagAfterSuccess } from "../../utils/audioMissingUtils";
import { mergeAudioFiles } from "../../utils/audioMerger";
import { getAttachmentDocumentSegmentFromUri } from "../../utils/attachmentFolderUtils";
import { deleteLocalVideoFiles, isHttpVideoUrl, processVideoUrl, getVideoWorkspaceRelativePath, resolveVideoAvailability, type VideoAvailability } from "./utils/videoUtils";
import { parsePointerFile, isPointerFile } from "../../utils/lfsHelpers";

// Enable debug logging if needed
const DEBUG_MODE = false;
function debug(...args: any[]): void {
    if (DEBUG_MODE) {
        console.log("[CodexCellEditorMessageHandling]", ...args);
    }
}

const AUDIO_MIME_MAP: Record<string, string> = {
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".webm": "audio/webm",
    ".flac": "audio/flac",
};

const audioExtensionToMime = (ext: string): string =>
    AUDIO_MIME_MAP[ext.toLowerCase()] ?? "application/octet-stream";

// Track pending attention checks - keyed by testId
interface PendingAttentionCheck {
    cellId: string;
    correctIndex: number;
    correctVariant: string;
    decoyCellId?: string;
}
const pendingAttentionChecks = new Map<string, PendingAttentionCheck>();

export function registerAttentionCheck(testId: string, data: PendingAttentionCheck): void {
    pendingAttentionChecks.set(testId, data);
}

export function getAttentionCheck(testId: string): PendingAttentionCheck | undefined {
    return pendingAttentionChecks.get(testId);
}

export function clearAttentionCheck(testId: string): void {
    pendingAttentionChecks.delete(testId);
}

// Debounce container for broadcasting auto-download flag updates
let autoDownloadBroadcastTimer: NodeJS.Timeout | undefined;
let pendingAutoDownloadValue: boolean | undefined;

// Debounce container for broadcasting auto-record flag updates
let autoRecordBroadcastTimer: NodeJS.Timeout | undefined;
let pendingAutoRecordValue: boolean | undefined;

// Debounce container for broadcasting recording-countdown duration updates
let recordingCountdownBroadcastTimer: NodeJS.Timeout | undefined;
let pendingRecordingCountdownValue: number | undefined;


// Helper to use VS Code FS API
async function pathExists(filePath: string): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
        return true;
    } catch {
        return false;
    }
}

/**
 * Sanitizes a name to be safe for use as a folder name.
 * Removes invalid characters and normalizes the name.
 */
function sanitizeFolderName(name: string): string {
    return (
        name
            .replace(/[<>:"/\\|?*]|^\.|\.$|\.lock$/g, "-") // Invalid/reserved chars
            .replace(/\s+/g, "-") // Replace spaces with hyphens
            .replace(/\.+/g, "-") // Replace periods with hyphens
            .replace(/-+/g, "-") // Replace multiple hyphens with single hyphen
            .replace(/^-|-$/g, "") // Remove leading/trailing hyphens
        || "UNKNOWN" // Fallback if name becomes empty
    );
}

/**
 * Determines the document segment for attachment storage.
 * Uses originalName from metadata (sanitized), falls back to first cell's cellId, 
 * then corpusMarker, then "UNKNOWN".
 */
function getDocumentSegment(document: CodexCellDocument): string {
    const metadata = document.getNotebookMetadata();

    // First priority: use originalName from metadata (sanitized for folder name)
    if (metadata?.originalName) {
        const sanitized = sanitizeFolderName(metadata.originalName);
        if (sanitized && sanitized !== "UNKNOWN") {
            return sanitized;
        }
    }

    // Fallback to first cell's cellId
    const firstCell = document.getCellByIndex(0);
    if (firstCell?.metadata?.id) {
        const cellId = firstCell.metadata.id;
        const segment = cellId.split(' ')[0];
        if (segment) {
            return segment;
        }
    }

    // Fallback to corpusMarker
    const corpusMarker = metadata?.corpusMarker;
    if (corpusMarker) {
        return corpusMarker;
    }

    // Final fallback
    return "UNKNOWN";
}

type VideoKind = "url" | "local" | "none";

/** Classify a stored video reference as a remote URL, a local file, or empty. */
function classifyVideo(videoUrl: string | undefined | null): VideoKind {
    if (!videoUrl) {
        return "none";
    }
    return isHttpVideoUrl(videoUrl) ? "url" : "local";
}

/**
 * Show the appropriate replace/delete confirmation when the current video is a
 * local file. Returns true to proceed. URL/empty sources need no confirmation
 * (there is no local file to delete), so they return true immediately.
 */
async function confirmVideoReplacement(
    oldKind: VideoKind,
    newKind: VideoKind
): Promise<boolean> {
    // Nothing to confirm when there was no video to begin with.
    if (oldKind === "none") {
        return true;
    }

    const removing = newKind === "none";
    const confirmLabel = removing ? "Remove" : "Replace";

    let detail: string;
    if (oldKind === "local") {
        // A local file will actually be deleted from disk — always warn.
        detail = removing
            ? "Remove the current video? The local video file will be deleted from this project."
            : "Replace the existing video? The current local video file will be deleted from this project.";
    } else {
        // URL source: nothing is deleted from disk, but confirm for consistency.
        detail = removing
            ? "Remove the current streamed video URL?"
            : "Replace the current streamed video URL?";
    }

    const choice = await vscode.window.showWarningMessage(detail, { modal: true }, confirmLabel);
    return choice === confirmLabel;
}

/**
 * Imports a video file the user picked from the OS dialog into the project's
 * attachments. This is deliberately run at *save* time (not at pick time) so
 * that picking a file and then cancelling the metadata modal leaves the project
 * untouched. It writes the bytes into files/ (and best-effort into pointers/),
 * deletes any previous local video, and — in stream-only mode — offers to keep
 * the file via the persisted allowlist.
 *
 * In stream-only mode the user is asked up front whether to keep the video.
 * Cancelling that prompt aborts the import before anything is written/deleted,
 * in which case this resolves to `null` and the existing video is left intact.
 *
 * @returns the workspace-relative path to store in `videoUrl`, or `null` if the
 * user cancelled the import.
 */
async function importPickedVideoIntoProject(
    document: CodexCellDocument,
    sourceFsPath: string
): Promise<string | null> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
        throw new Error("No workspace folder found");
    }

    // Read the picked file (still at its original location on the user's disk).
    const fileData = await vscode.workspace.fs.readFile(vscode.Uri.file(sourceFsPath));

    // Enforce a reasonable max size (1.5 GB) for video files.
    const MAX_BYTES = 1.5 * 1024 * 1024 * 1024;
    if (fileData.length > MAX_BYTES) {
        throw new Error("Video file exceeds the maximum allowed size (1.5 GB).");
    }

    // In stream-only, a newly added local video would be reverted to an LFS
    // pointer after the next sync (to free space), so ask up front whether to
    // keep it saved in the project ("Save to project" → persisted allowlist) or
    // treat it as a session-only stream ("Stream only"). Asking *before* any
    // write means Cancel can abort the whole import cleanly — nothing is written
    // and the previous video is left untouched. Other strategies never prompt.
    let persistInStreamOnly = false;
    try {
        const { getMediaFilesStrategy } = await import("../../utils/localProjectSettings");
        const strategy = (await getMediaFilesStrategy(workspaceFolder.uri)) ?? "auto-download";
        if (strategy === "stream-only") {
            const SAVE = "Save to project";
            const STREAM = "Stream only";
            const choice = await vscode.window.showInformationMessage(
                "Save this video to the project?",
                {
                    modal: true,
                    detail: "Save keeps it until you remove it. Stream only keeps it for this session.",
                },
                SAVE,
                STREAM
            );
            // Cancel / dismissed (Escape) → abort the import entirely.
            if (choice !== SAVE && choice !== STREAM) {
                return null;
            }
            persistInStreamOnly = choice === SAVE;
        }
    } catch (storageChoiceErr) {
        console.warn("Could not determine stream-only storage choice for video:", storageChoiceErr);
    }

    const documentSegment = getDocumentSegment(document);

    // Generate a safe filename from the original file.
    const originalFileName = path.basename(sourceFsPath);
    const ext = path.extname(originalFileName).toLowerCase().slice(1);
    const allowedExtensions = new Set(["mp4", "mkv", "avi", "mov", "webm", "m4v"]);
    const safeExt = allowedExtensions.has(ext) ? ext : "mp4";
    const baseName = path.basename(originalFileName, path.extname(originalFileName));
    const sanitizedBaseName = baseName.replace(/[^a-zA-Z0-9._-]/g, "-");
    const fileName = `${sanitizedBaseName}.${safeExt}`;

    const pointersDir = path.join(
        workspaceFolder.uri.fsPath,
        ".project",
        "attachments",
        "pointers",
        documentSegment
    );
    const filesDir = path.join(
        workspaceFolder.uri.fsPath,
        ".project",
        "attachments",
        "files",
        documentSegment
    );

    await vscode.workspace.fs.createDirectory(vscode.Uri.file(pointersDir));
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(filesDir));

    const pointersPath = path.join(pointersDir, fileName);
    const filesPath = path.join(filesDir, fileName);

    // Atomic write helper (write to temp then rename).
    const writeFileAtomically = async (finalFsPath: string, data: Uint8Array): Promise<void> => {
        const tmpPath = `${finalFsPath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const tmpUri = vscode.Uri.file(tmpPath);
        const finalUri = vscode.Uri.file(finalFsPath);
        await vscode.workspace.fs.writeFile(tmpUri, data);
        await vscode.workspace.fs.rename(tmpUri, finalUri, { overwrite: true });
        try {
            const stat = await vscode.workspace.fs.stat(finalUri);
            if (typeof stat.size === "number" && stat.size !== data.length) {
                console.warn("Size mismatch after write for", finalFsPath, {
                    expected: data.length,
                    actual: stat.size,
                });
            }
        } catch {
            // ignore stat issues
        }
    };

    // Write actual file (primary). Pointer write is best-effort.
    await writeFileAtomically(filesPath, fileData);
    try {
        await writeFileAtomically(pointersPath, fileData);
    } catch (pointerErr) {
        console.warn("Pointer write failed; proceeding with saved file only", pointerErr);
    }

    // Delete the previous local video (if any) now that the new file is written,
    // skipping the freshly-written paths in case the replacement reuses the same
    // filename.
    const existingVideoUrl = document.getNotebookMetadata()?.videoUrl;
    if (classifyVideo(existingVideoUrl) === "local") {
        await deleteLocalVideoFiles(
            existingVideoUrl,
            workspaceFolder.uri,
            new Set([filesPath, pointersPath])
        );
    }

    const relativePath = toPosixPath(path.relative(workspaceFolder.uri.fsPath, filesPath));

    // "Save to project" in stream-only → record the rel-path on the persisted
    // allowlist so post-sync / strategy-switch cleanup never reverts this saved
    // video to a pointer.
    if (persistInStreamOnly) {
        try {
            const { addPersistedMediaFile } = await import("../../utils/localProjectSettings");
            const FILES_SEG = "attachments/files/";
            const savedRel = relativePath.includes(FILES_SEG)
                ? relativePath.slice(relativePath.indexOf(FILES_SEG) + FILES_SEG.length)
                : null;
            if (savedRel) {
                await addPersistedMediaFile(savedRel, workspaceFolder.uri);
            }
        } catch (storageChoiceErr) {
            console.warn("Could not persist stream-only video to allowlist:", storageChoiceErr);
        }
    }

    return relativePath;
}

/**
 * Tracks stream-only "session cache" videos that were activated (downloaded)
 * during the current extension-host session, keyed by `${projectPath}::${rel}`.
 * Module-level so it is naturally empty after a reload, which is what makes a
 * previously cached video re-stream on the next session.
 */
/**
 * Resolve the best playable source for the chapter video and post it to the
 * webview. Remote URLs play as-is; local files with real bytes are served via a
 * webview URI; in stream-only, a video previously "Loaded" this session is
 * served from the external cache (outside the project). LFS pointers are NOT
 * streamed directly — instead we tell the webview the video needs downloading
 * and what the active media strategy implies, so it can present the right
 * action(s).
 */
/**
 * Resolves the LFS pointer OID for a document's local (non-remote) chapter
 * video, or `undefined` if there is no LFS-backed reference. Used to match a
 * session-cache change against the right open editor.
 */
export async function getVideoPointerOidForDocument(
    document: CodexCellDocument
): Promise<string | undefined> {
    const videoUrl = document.getNotebookMetadata()?.videoUrl;
    if (!videoUrl || isHttpVideoUrl(videoUrl)) {
        return undefined;
    }
    const workspaceUri = vscode.workspace.getWorkspaceFolder(document.uri)?.uri;
    if (!workspaceUri) {
        return undefined;
    }
    const rel = getVideoWorkspaceRelativePath(videoUrl, workspaceUri);
    if (!rel) {
        return undefined;
    }
    const filesAbs = vscode.Uri.joinPath(workspaceUri, rel).fsPath;
    const pointersRel = rel.includes("attachments/files/")
        ? rel.replace("attachments/files/", "attachments/pointers/")
        : rel;
    const pointersAbs = vscode.Uri.joinPath(workspaceUri, pointersRel).fsPath;
    const pointer =
        (await parsePointerFile(filesAbs)) ?? (await parsePointerFile(pointersAbs));
    return pointer?.oid;
}

export async function resolveAndPostVideoStreamUrl(
    document: CodexCellDocument,
    webviewPanel: vscode.WebviewPanel,
    provider: CodexCellEditorProvider
): Promise<void> {
    const videoUrl = document.getNotebookMetadata()?.videoUrl;
    if (!videoUrl) {
        return;
    }

    // Remote URLs already stream directly via the browser.
    if (isHttpVideoUrl(videoUrl)) {
        provider.postMessageToWebview(webviewPanel, {
            type: "updateVideoUrlInWebview",
            content: videoUrl,
        });
        return;
    }

    const workspaceUri = vscode.workspace.getWorkspaceFolder(document.uri)?.uri;
    if (!workspaceUri) {
        return;
    }

    // If a fetch for this video is already running (e.g. "Load video"/"Save to
    // project" started from a navigation card), show the loading state instead
    // of the "needs download" placeholder. The operation's completion path
    // re-resolves this editor with the playable URL.
    const { isVideoOperationInFlight } = await import("./utils/videoDownloadUtils");
    if (isVideoOperationInFlight(workspaceUri, videoUrl)) {
        provider.postMessageToWebview(webviewPanel, { type: "videoStreamResolving" });
        return;
    }

    const rel = getVideoWorkspaceRelativePath(videoUrl, workspaceUri);
    if (!rel) {
        // Path outside the workspace — let processVideoUrl decide (likely null).
        const direct = processVideoUrl(videoUrl, webviewPanel.webview);
        if (direct) {
            provider.postMessageToWebview(webviewPanel, {
                type: "updateVideoUrlInWebview",
                content: direct,
            });
        }
        return;
    }

    const filesAbs = vscode.Uri.joinPath(workspaceUri, rel).fsPath;
    const pointersRel = rel.includes("attachments/files/")
        ? rel.replace("attachments/files/", "attachments/pointers/")
        : rel;
    const pointersAbs = vscode.Uri.joinPath(workspaceUri, pointersRel).fsPath;

    let filesExists = false;
    let filesIsPointer = true;
    let filesSize = 0;
    try {
        const stat = await vscode.workspace.fs.stat(vscode.Uri.file(filesAbs));
        filesExists = true;
        filesSize = stat.size;
        filesIsPointer = await isPointerFile(filesAbs);
    } catch {
        filesExists = false;
    }

    // Real bytes saved locally → serve from disk via a webview URI. Append a
    // content-based cache-buster (file size) so that when a file changes from a
    // pointer to real bytes (e.g. after "Save to project"), the player fetches
    // the new content instead of a stale cached response for the same URL.
    if (filesExists && !filesIsPointer) {
        const localUri = processVideoUrl(videoUrl, webviewPanel.webview);
        if (localUri) {
            const busted = `${localUri}${localUri.includes("?") ? "&" : "?"}v=${filesSize}`;
            provider.postMessageToWebview(webviewPanel, {
                type: "updateVideoUrlInWebview",
                content: busted,
            });
            return;
        }
    }

    // Recovery: files/ is a pointer or missing, but the pointers/ sibling still
    // holds REAL bytes (e.g. an unsynced local video, or an interrupted strategy
    // switch). Serve those directly from disk instead of re-downloading from LFS.
    // The whole workspace is in the webview's localResourceRoots, so pointers/ is
    // loadable. (Skip when pointersAbs === filesAbs — already handled above.)
    if (pointersAbs !== filesAbs) {
        try {
            const pStat = await vscode.workspace.fs.stat(vscode.Uri.file(pointersAbs));
            if (pStat.size > 0 && !(await isPointerFile(pointersAbs))) {
                const pUri = webviewPanel.webview
                    .asWebviewUri(vscode.Uri.file(pointersAbs))
                    .toString();
                const bustedPointer = `${pUri}${pUri.includes("?") ? "&" : "?"}v=${pStat.size}`;
                provider.postMessageToWebview(webviewPanel, {
                    type: "updateVideoUrlInWebview",
                    content: bustedPointer,
                });
                return;
            }
        } catch {
            // pointers/ missing — fall through to normal LFS resolution.
        }
    }

    const { getMediaFilesStrategy } = await import("../../utils/localProjectSettings");
    const strategy = (await getMediaFilesStrategy(workspaceUri)) ?? "auto-download";

    // Otherwise this is an LFS pointer (or missing). Confirm a pointer exists so
    // the video is actually downloadable.
    let pointer = filesExists && filesIsPointer ? await parsePointerFile(filesAbs) : null;
    if (!pointer) {
        pointer = await parsePointerFile(pointersAbs);
    }

    if (!pointer) {
        provider.postMessageToWebview(webviewPanel, {
            type: "videoStreamUnavailable",
            reason: "not-found",
            message:
                "This video isn't available yet. It may still be syncing, or the file couldn't be found.",
        });
        return;
    }

    // In stream-only, a video "Loaded" earlier this session lives in the external
    // cache (outside the project). Serve it from there so it doesn't re-download.
    const { hasCachedVideo, getCachedVideoUri } = await import("../../utils/videoStreamCache");
    const ext = path.extname(rel);
    if (await hasCachedVideo(provider.extensionContext, pointer.oid, ext)) {
        const cacheUri = getCachedVideoUri(provider.extensionContext, pointer.oid, ext);
        if (cacheUri) {
            provider.postMessageToWebview(webviewPanel, {
                type: "updateVideoUrlInWebview",
                content: webviewPanel.webview.asWebviewUri(cacheUri).toString(),
            });
            return;
        }
    }

    provider.postMessageToWebview(webviewPanel, {
        type: "videoNeedsDownload",
        strategy,
    });
}

/**
 * Map the fine-grained {@link resolveVideoAvailability} result onto the coarse
 * status the webview consumes ("saved"/"streamable" both collapse to
 * "local-usable" — i.e. the "Show Video" toggle is offered for either).
 */
function toReferenceStatus(
    availability: VideoAvailability
): "none" | "url" | "local-usable" | "missing" {
    if (availability === "saved" || availability === "streamable") {
        return "local-usable";
    }
    return availability;
}

/**
 * Whether the chapter video has an on-disk copy in the project (`files/`) that
 * can be safely reverted to an LFS pointer to free disk space (and re-streamed
 * on demand). Offered in stream-and-save (downloaded copy) and stream-only
 * (a "Save to project" copy) — never auto-download (it would just re-download),
 * and never the stream-only session cache (that lives in global storage and is
 * already ephemeral). Requires a real local file AND a real LFS pointer backing
 * it (so it isn't a local-unsynced file we'd lose).
 */
async function computeCanFreeVideoDiskSpace(document: CodexCellDocument): Promise<boolean> {
    const videoUrl = document.getNotebookMetadata()?.videoUrl;
    if (!videoUrl || isHttpVideoUrl(videoUrl)) {
        return false;
    }
    const workspaceUri = vscode.workspace.getWorkspaceFolder(document.uri)?.uri;
    if (!workspaceUri) {
        return false;
    }
    const { getMediaFilesStrategy } = await import("../../utils/localProjectSettings");
    const strategy = (await getMediaFilesStrategy(workspaceUri)) ?? "auto-download";
    if (strategy !== "stream-and-save" && strategy !== "stream-only") {
        return false;
    }

    const rel = getVideoWorkspaceRelativePath(videoUrl, workspaceUri);
    if (!rel) {
        return false;
    }
    const filesAbs = vscode.Uri.joinPath(workspaceUri, rel).fsPath;
    const pointersRel = rel.includes("attachments/files/")
        ? rel.replace("attachments/files/", "attachments/pointers/")
        : rel;
    const pointersAbs = vscode.Uri.joinPath(workspaceUri, pointersRel).fsPath;

    // Real bytes present in files/ (taking space)?
    try {
        await vscode.workspace.fs.stat(vscode.Uri.file(filesAbs));
    } catch {
        return false;
    }
    const filesIsPointer = await isPointerFile(filesAbs).catch(() => false);
    if (filesIsPointer) {
        return false;
    }
    // A real LFS pointer must back it so it can be re-streamed without data loss.
    const pointer = await parsePointerFile(pointersAbs).catch(() => null);
    return !!pointer;
}

/** Compute and push the chapter video reference status to the webview. */
export async function postVideoReferenceStatus(
    document: CodexCellDocument,
    webviewPanel: vscode.WebviewPanel,
    provider: CodexCellEditorProvider
): Promise<void> {
    const videoUrl = document.getNotebookMetadata()?.videoUrl;
    const workspaceUri = vscode.workspace.getWorkspaceFolder(document.uri)?.uri;
    const { availability, sizeBytes } = await resolveVideoAvailability(videoUrl, workspaceUri);
    const status = toReferenceStatus(availability);
    const canFreeDiskSpace =
        status === "local-usable" ? await computeCanFreeVideoDiskSpace(document) : false;
    provider.postMessageToWebview(webviewPanel, {
        type: "videoReferenceStatus",
        status,
        canFreeDiskSpace,
        videoSizeBytes: status === "local-usable" ? sizeBytes : undefined,
    });
}

// Get a reference to the provider
function getProvider(): CodexCellEditorProvider | undefined {
    // Find the provider through the window object
    return (vscode.window as any).createWebviewPanel?.owner;
}

// Centralized error handler wrapper
async function withErrorHandling<T>(
    operation: () => Promise<T> | T,
    context: string,
    showUserError: boolean = true
): Promise<T | undefined> {
    try {
        return await operation();
    } catch (error) {
        console.error(`Error ${context}:`, error);
        if (showUserError) {
            vscode.window.showErrorMessage(`Failed to ${context}.`);
        }
        return undefined;
    }
}

async function safeExecuteCommand<T>(commandId: string, ...args: unknown[]): Promise<T | null> {
    const allCommands = await vscode.commands.getCommands(true);
    if (!allCommands.includes(commandId)) {
        return null;
    }
    return vscode.commands.executeCommand<T>(commandId, ...args);
}

// Message handler context type
interface MessageHandlerContext {
    event: EditorPostMessages;
    webviewPanel: vscode.WebviewPanel;
    document: CodexCellDocument;
    updateWebview: () => void;
    provider: CodexCellEditorProvider;
}

/**
 * Sends updated milestone index and current cells to the webview so milestone edits appear immediately.
 * Used after updateMilestoneValue, by refreshWebviewAfterMilestoneEdits, and by refreshWebviewsForFiles.
 */
export async function sendMilestoneRefreshToWebview(
    document: CodexCellDocument,
    webviewPanel: vscode.WebviewPanel,
    provider: CodexCellEditorProvider
): Promise<void> {
    const docUri = document.uri.toString();
    const currentPosition = provider.currentMilestoneSubsectionMap.get(docUri);

    if (currentPosition) {
        const config = vscode.workspace.getConfiguration("codex-editor-extension");
        const cellsPerPage = config.get("cellsPerPage", 50);
        const milestoneIndex = document.buildMilestoneIndex(cellsPerPage);

        const validationCount = vscode.workspace.getConfiguration("codex-project-manager").get("validationCount", 1);
        const validationCountAudio = vscode.workspace.getConfiguration("codex-project-manager").get("validationCountAudio", 1);
        const milestoneProgress = document.calculateMilestoneProgress(validationCount, validationCountAudio);
        milestoneIndex.milestoneProgress = milestoneProgress;

        const isSourceText = document.uri.toString().includes(".source");
        const cells = document.getCellsForMilestone(currentPosition.milestoneIndex, currentPosition.subsectionIndex, cellsPerPage);
        const processedCells = provider.mergeRangesAndProcess(cells, provider.isCorrectionEditorMode, isSourceText);

        const sourceCellMap: { [k: string]: { content: string; versions: string[]; }; } = {};
        for (const cell of cells) {
            const cellId = cell.cellMarkers?.[0];
            if (cellId && document._sourceCellMap[cellId]) {
                sourceCellMap[cellId] = document._sourceCellMap[cellId];
            }
        }

        const authApi = await provider.getAuthApi();
        const userInfo = await authApi?.getUserInfo();
        const username = userInfo?.username || "anonymous";

        const rev = provider.getDocumentRevision(docUri);
        safePostMessageToPanel(webviewPanel, {
            type: "providerSendsInitialContentPaginated",
            rev,
            milestoneIndex: milestoneIndex,
            cells: processedCells,
            currentMilestoneIndex: currentPosition.milestoneIndex,
            currentSubsectionIndex: currentPosition.subsectionIndex,
            isSourceText: isSourceText,
            sourceCellMap: sourceCellMap,
            username: username,
            validationCount: validationCount,
            validationCountAudio: validationCountAudio,
        });

        safePostMessageToPanel(webviewPanel, {
            type: "refreshCurrentPage",
            rev,
            milestoneIndex: currentPosition.milestoneIndex,
            subsectionIndex: currentPosition.subsectionIndex,
        });
        debug(`[sendMilestoneRefreshToWebview] Sent updated milestone index and refreshCurrentPage for milestone ${currentPosition.milestoneIndex}, subsection ${currentPosition.subsectionIndex}`);
    } else {
        provider.refreshWebview(webviewPanel, document);
    }
}

/**
 * Helper function to get the audio file path for a cell
 * Checks metadata attachments first, then falls back to filesystem lookup
 * @param cell The cell object
 * @param cellId The cell ID
 * @param workspaceFolder The workspace folder
 * @returns Full path to audio file if found, null otherwise
 */
async function getAudioFilePathForCell(
    cell: any,
    cellId: string,
    workspaceFolder: vscode.WorkspaceFolder,
    documentUri: vscode.Uri,
): Promise<string | null> {
    // First, check if cell has audio attachments in metadata
    if (cell?.metadata?.attachments) {
        const attachments = Object.entries(cell.metadata.attachments);
        for (const [attachmentId, attachment] of attachments) {
            const att = attachment as any;
            if (att && att.type === "audio" && !att.isDeleted && att.url) {
                const attachmentPath = toPosixPath(att.url);
                const fullPath = path.isAbsolute(attachmentPath)
                    ? attachmentPath
                    : path.join(workspaceFolder.uri.fsPath, attachmentPath);

                // Check if file exists
                if (await pathExists(fullPath)) {
                    return fullPath;
                }
            }
        }
    }

    // Fallback: check filesystem for legacy audio files
    // Extract book name from globalReferences if available, otherwise fall back to parsing cell ID
    let bookAbbr = "";
    let basename = "";

    // Try to get book name from globalReferences first
    const globalRefs = cell?.metadata?.data?.globalReferences;
    if (globalRefs && Array.isArray(globalRefs) && globalRefs.length > 0) {
        const firstRef = globalRefs[0];
        // Extract book name: "GEN 1:1" -> "GEN" or "TheChosen-201-en-SingleSpeaker 1:jkflds" -> "TheChosen-201-en-SingleSpeaker"
        const bookMatch = firstRef.match(/^([^\s]+)/);
        if (bookMatch) {
            bookAbbr = bookMatch[1];
        }
    }

    // Fallback to parsing cell ID if globalReferences not available (legacy support)
    if (!bookAbbr) {
        // Cell IDs may be UUIDs; avoid deriving book from them.
        bookAbbr = getAttachmentDocumentSegmentFromUri(documentUri);
    }

    const parseCellIdToBookChapterVerse = (refId: string): { book: string; chapter?: number; verse?: number; } => {
        try {
            const [book, rest] = refId.split(" ");
            const [chapterStr, verseStr] = (rest || "").split(":");
            let chapter: number | undefined = chapterStr ? Number(chapterStr) : undefined;
            let verse: number | undefined = verseStr ? Number(verseStr) : undefined;
            if (chapter !== undefined && !Number.isFinite(chapter)) chapter = undefined;
            if (verse !== undefined && !Number.isFinite(verse)) verse = undefined;
            return { book: (book || "").toUpperCase(), chapter, verse };
        } catch {
            return { book: "", chapter: undefined, verse: undefined };
        }
    };

    const toBookChapterVerseBasename = (refId: string): string => {
        const { book, chapter, verse } = parseCellIdToBookChapterVerse(refId);
        const safePad = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? String(n) : "0").padStart(3, "0");
        const chapStr = safePad(chapter);
        const verseStr = safePad(verse);
        const sanitizeFileComponent = (input: string): string => {
            return input
                .replace(/\s+/g, "_")
                .replace(/[^a-zA-Z0-9._-]/g, "-")
                .replace(/_+/g, "_");
        };
        return sanitizeFileComponent(`${book}_${chapStr}_${verseStr}`);
    };

    // Use globalReferences for basename if available
    if (globalRefs && Array.isArray(globalRefs) && globalRefs.length > 0) {
        basename = toBookChapterVerseBasename(globalRefs[0]);
    } else {
        // Fallback to parsing cell ID (legacy)
        basename = toBookChapterVerseBasename(cellId);
    }
    const audioExtensions = ['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.webm', '.flac'];

    const attachmentsFilesPath = path.join(
        workspaceFolder.uri.fsPath,
        ".project",
        "attachments",
        "files",
        bookAbbr
    );
    const legacyAttachmentsPath = path.join(
        workspaceFolder.uri.fsPath,
        ".project",
        "attachments",
        bookAbbr
    );

    const tryPaths = [attachmentsFilesPath, legacyAttachmentsPath];
    for (const attachmentsPath of tryPaths) {
        if (!(await pathExists(attachmentsPath))) continue;
        try {
            const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(attachmentsPath));
            for (const [entryName, entryType] of files) {
                if (entryType !== vscode.FileType.File) continue;
                if (audioExtensions.some(ext => entryName.toLowerCase().endsWith(ext))) {
                    // Check if filename matches the cell ID pattern
                    if (entryName.startsWith(basename) || entryName.includes(cellId.replace(/[:\s]/g, '_'))) {
                        const fullPath = path.join(attachmentsPath, entryName);
                        if (await pathExists(fullPath)) {
                            return fullPath;
                        }
                    }
                }
            }
        } catch (err) {
            debug("Error reading attachments directory:", err);
        }
    }

    return null;
}

// Individual message handlers
const messageHandlers: Record<string, (ctx: MessageHandlerContext) => Promise<void> | void> = {
    webviewReady: () => { /* no-op */ },
    setAutoDownloadAudioOnOpen: async ({ event, document, webviewPanel, provider }) => {
        try {
            const typed = event as any;
            const value = !!typed?.content?.value;
            const { setAutoDownloadAudioOnOpen } = await import("../../utils/globalUserSettings");
            await setAutoDownloadAudioOnOpen(value);
            // Debounce broadcast so rapid toggles coalesce
            pendingAutoDownloadValue = value;
            if (autoDownloadBroadcastTimer) {
                clearTimeout(autoDownloadBroadcastTimer);
            }
            autoDownloadBroadcastTimer = setTimeout(() => {
                try {
                    const panels = provider.getWebviewPanels();
                    panels.forEach((panel) => {
                        provider.postMessageToWebview(panel, {
                            type: "providerUpdatesNotebookMetadataForWebview",
                            content: { autoDownloadAudioOnOpen: pendingAutoDownloadValue },
                        } as any);
                    });
                } catch (broadcastErr) {
                    console.warn("Failed to broadcast autoDownloadAudioOnOpen", broadcastErr);
                } finally {
                    autoDownloadBroadcastTimer = undefined;
                }
            }, 150);
        } catch (e) {
            console.warn("Failed to set autoDownloadAudioOnOpen", e);
        }
    },
    setAutoRecordOnMicClick: async ({ event, document, webviewPanel, provider }) => {
        try {
            const typed = event as any;
            const value = !!typed?.content?.value;
            const { setAutoRecordOnMicClick } = await import("../../utils/globalUserSettings");
            await setAutoRecordOnMicClick(value);
            pendingAutoRecordValue = value;
            if (autoRecordBroadcastTimer) {
                clearTimeout(autoRecordBroadcastTimer);
            }
            autoRecordBroadcastTimer = setTimeout(() => {
                try {
                    const panels = provider.getWebviewPanels();
                    panels.forEach((panel) => {
                        provider.postMessageToWebview(panel, {
                            type: "providerUpdatesNotebookMetadataForWebview",
                            content: { autoRecordOnMicClick: pendingAutoRecordValue },
                        } as any);
                    });
                } catch (broadcastErr) {
                    console.warn("Failed to broadcast autoRecordOnMicClick", broadcastErr);
                } finally {
                    autoRecordBroadcastTimer = undefined;
                }
            }, 150);
        } catch (e) {
            console.warn("Failed to set autoRecordOnMicClick", e);
        }
    },
    setRecordingCountdownSeconds: async ({ event, document, provider }) => {
        try {
            const typed = event as any;
            const raw = typed?.content?.value;
            const numeric = typeof raw === "number" ? raw : Number(raw);
            const sanitized =
                Number.isFinite(numeric) && numeric >= 0
                    ? Math.min(Math.round(numeric), 3)
                    : 3;
            const { setRecordingCountdownSeconds } = await import(
                "../../utils/globalUserSettings"
            );
            await setRecordingCountdownSeconds(sanitized);
            pendingRecordingCountdownValue = sanitized;
            if (recordingCountdownBroadcastTimer) {
                clearTimeout(recordingCountdownBroadcastTimer);
            }
            recordingCountdownBroadcastTimer = setTimeout(() => {
                try {
                    const panels = provider.getWebviewPanels();
                    panels.forEach((panel) => {
                        provider.postMessageToWebview(panel, {
                            type: "providerUpdatesNotebookMetadataForWebview",
                            content: {
                                recordingCountdownSeconds: pendingRecordingCountdownValue,
                            },
                        } as any);
                    });
                } catch (broadcastErr) {
                    console.warn(
                        "Failed to broadcast recordingCountdownSeconds",
                        broadcastErr
                    );
                } finally {
                    recordingCountdownBroadcastTimer = undefined;
                }
            }, 150);
        } catch (e) {
            console.warn("Failed to set recordingCountdownSeconds", e);
        }
    },
    getAsrConfig: async ({ webviewPanel }) => {
        try {
            const config = vscode.workspace.getConfiguration("codex-editor-extension");
            let endpoint = config.get<string>("asrEndpoint", "http://localhost:8000/api/v1/asr/transcribe");

            // ASR language plumbing — see sharedUtils/asrLanguageUtils.ts for the resolver
            // contract. The webview drives "auto-detect" vs "use project language" via the
            // gear menu on the Transcribe button; that picker is persisted to the workspace
            // setting `asrLanguageMode`.
            const { resolveOmniAsrCode } = await import("../../../sharedUtils/asrLanguageUtils");
            const projectConfig = vscode.workspace.getConfiguration("codex-project-manager");
            const targetLanguage = projectConfig.get<any>("targetLanguage") as
                | { tag?: string; refName?: string; iso1?: string; iso2t?: string; iso2b?: string; }
                | undefined;
            const languageMode = (config.get<string>("asrLanguageMode", "project") === "auto"
                ? "auto"
                : "project") as "auto" | "project";
            const scriptPref = config.get<string>("asrScriptPref", "auto");
            const resolvedCode =
                languageMode === "auto"
                    ? undefined
                    : resolveOmniAsrCode(targetLanguage, scriptPref);
            const projectLanguageName = targetLanguage?.refName;

            let authToken: string | undefined;

            // Try to get authenticated endpoint from FrontierAPI
            try {
                const frontierApi = getAuthApi();
                if (frontierApi) {
                    const authStatus = frontierApi.getAuthStatus();
                    if (authStatus.isAuthenticated) {
                        const asrEndpoint = await frontierApi.getAsrEndpoint();
                        // Validate endpoint URL before using it
                        if (asrEndpoint && asrEndpoint.trim()) {
                            try {
                                new URL(asrEndpoint);
                                endpoint = asrEndpoint;
                            } catch (urlError) {
                                console.warn("Invalid ASR endpoint URL from auth API:", asrEndpoint, urlError);
                                // Fall back to default endpoint
                            }
                        }
                        // Get auth token for authenticated requests
                        try {
                            authToken = await frontierApi.authProvider.getToken();
                            debug(`[getAsrConfig] Token retrieved: ${authToken ? `present (length: ${authToken.length})` : 'empty/undefined'}`);
                            if (!authToken) {
                                console.error("[getAsrConfig] ERROR: ASR endpoint requires authentication but token retrieval returned empty value");
                            }
                        } catch (tokenError) {
                            console.error("[getAsrConfig] ERROR: Could not get auth token for ASR endpoint:", tokenError);
                        }
                    }
                }
            } catch (error) {
                console.debug("Could not get ASR endpoint from auth API:", error);
            }

            // Final validation: ensure endpoint is a valid URL
            try {
                new URL(endpoint);
            } catch (urlError) {
                console.error("Invalid ASR endpoint configuration:", endpoint, urlError);
                throw new Error(`Invalid ASR endpoint: ${endpoint}. Please check your ASR settings or login status.`);
            }

            // Warn if using authenticated endpoint without token
            const isAuthenticatedEndpoint = endpoint.includes('api.frontierrnd.com') || endpoint.includes('frontier');
            debug(`[getAsrConfig] Calculation: isAuthenticatedEndpoint=${isAuthenticatedEndpoint}, hasToken=${!!authToken}`);
            if (isAuthenticatedEndpoint && !authToken) {
                console.error(`[getAsrConfig] ERROR: ASR endpoint appears to require authentication but no token was retrieved!`);
                console.error(`[getAsrConfig] Endpoint: ${endpoint}`);
                console.error(`[getAsrConfig] This will cause transcription to fail. Please check authentication status.`);
            }

            debug(`[getAsrConfig] Sending config: endpoint=${endpoint}, hasToken=${!!authToken}, lang=${resolvedCode}, mode=${languageMode}, scriptPref=${scriptPref}`);
            safePostMessageToPanel(webviewPanel, {
                type: "asrConfig",
                content: {
                    endpoint,
                    authToken,
                    lang: resolvedCode,
                    languageMode,
                    scriptPref,
                    projectLanguageName,
                },
            });
        } catch (error) {
            console.error("Error sending ASR config:", error);
            // Always provide a valid fallback endpoint
            const fallbackEndpoint = "http://localhost:8000/api/v1/asr/transcribe";
            safePostMessageToPanel(webviewPanel, {
                type: "asrConfig",
                content: {
                    endpoint: fallbackEndpoint,
                    authToken: undefined,
                    languageMode: "project",
                }
            });
        }
    },

    setAsrLanguageMode: async ({ event, webviewPanel }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "setAsrLanguageMode"; }>;
        const mode = typedEvent.content?.mode === "auto" ? "auto" : "project";
        try {
            await vscode.workspace
                .getConfiguration("codex-editor-extension")
                .update("asrLanguageMode", mode, vscode.ConfigurationTarget.Workspace);
        } catch (err) {
            console.warn("Failed to update asrLanguageMode", err);
        }
        // Rebroadcast so the webview can refresh its local asrConfig snapshot.
        await messageHandlers.getAsrConfig({ webviewPanel } as any);
    },

    setAsrScriptPref: async ({ event, webviewPanel }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "setAsrScriptPref"; }>;
        const rawPref = typedEvent.content?.scriptPref;
        // Accept "auto", "latin", or any 4-letter ISO 15924 tag. Anything else falls back to "auto".
        const isFourLetter = typeof rawPref === "string" && /^[A-Za-z]{4}$/.test(rawPref);
        const normalized =
            rawPref === "auto" || rawPref === "latin"
                ? rawPref
                : isFourLetter
                    ? rawPref!.charAt(0).toUpperCase() + rawPref!.slice(1).toLowerCase()
                    : "auto";
        try {
            await vscode.workspace
                .getConfiguration("codex-editor-extension")
                .update("asrScriptPref", normalized, vscode.ConfigurationTarget.Workspace);
        } catch (err) {
            console.warn("Failed to update asrScriptPref", err);
        }
        await messageHandlers.getAsrConfig({ webviewPanel } as any);
    },

    updateCellAfterTranscription: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "updateCellAfterTranscription"; }>;
        const { cellId, transcribedText, language } = typedEvent.content;
        try {
            // Get current selected audio attachment for this cell
            const currentAttachment = document.getCurrentAttachment(cellId, "audio");
            if (!currentAttachment) {
                console.warn("No current audio attachment to save transcription for cell:", cellId);
                return;
            }
            const { attachmentId, attachment } = currentAttachment as any;
            const updated = {
                ...(attachment || {}),
                transcription: {
                    content: transcribedText,
                    // `language` is the OmniASR `{iso639_3}_{Script}` code the server reported
                    // (or null when the server ran in auto-detect mode and didn't echo one).
                    // The webview labels the badge with `labelForTranscriptionLanguage()` from
                    // sharedUtils/asrLanguageUtils.ts — never trust "language" to be a human
                    // string here.
                    language: language ?? null,
                    timestamp: Date.now(),
                },
                updatedAt: Date.now(),
            };
            await document.updateCellAttachment(cellId, attachmentId, updated);

            // Notify webview(s) of updated audio attachments status
            await scanForAudioAttachments(document, webviewPanel);
            // Recompute availability with pointer detection so UI shows correct icon
            try {
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
                const notebookData = JSON.parse(document.getText());
                const availability: { [cellId: string]: "available" | "available-local" | "available-pointer" | "missing" | "deletedOnly" | "none"; } = {};
                if (Array.isArray(notebookData?.cells) && workspaceFolder) {
                    for (const cell of notebookData.cells) {
                        const id = cell?.metadata?.id;
                        if (!id) continue;
                        let hasAvailable = false;
                        let hasAvailablePointer = false;
                        let hasMissing = false;
                        let hasDeleted = false;
                        const atts = cell?.metadata?.attachments || {};
                        for (const key of Object.keys(atts)) {
                            const att: any = (atts as any)[key];
                            if (att && att.type === "audio") {
                                if (att.isDeleted) {
                                    hasDeleted = true;
                                } else if (att.isMissing) {
                                    hasMissing = true;
                                } else {
                                    try {
                                        const url = String(att.url || "");
                                        if (url) {
                                            const filesRel = url.startsWith(".project/") ? url : url.replace(/^\.?\/?/, "");
                                            const abs = path.join(workspaceFolder.uri.fsPath, filesRel);
                                            const { isPointerFile } = await import("../../utils/lfsHelpers");
                                            const isPtr = await isPointerFile(abs).catch(() => false);
                                            if (isPtr) hasAvailablePointer = true; else hasAvailable = true;
                                        } else {
                                            hasAvailable = true;
                                        }
                                    } catch { hasAvailable = true; }
                                }
                            }
                        }

                        // If the user's selected audio is missing, show missing icon regardless of other attachments.
                        const selectedId = cell?.metadata?.selectedAudioId;
                        const selectedAtt = selectedId ? (atts as any)[selectedId] : undefined;
                        const selectedIsMissing = selectedAtt?.type === "audio" && selectedAtt?.isMissing === true;

                        let state: "available" | "available-local" | "available-pointer" | "missing" | "deletedOnly" | "none";
                        if (selectedIsMissing) state = "missing";
                        else if (hasAvailable) state = "available-local";
                        else if (hasAvailablePointer) state = "available-pointer";
                        else if (hasMissing) state = "missing";
                        else if (hasDeleted) state = "deletedOnly";
                        else state = "none";

                        // Apply installed-version gate (no modal) to avoid showing Play when blocked
                        if (state !== "available-local") {
                            try {
                                const { getFrontierVersionStatus } = await import("../../projectManager/utils/versionChecks");
                                const status = await getFrontierVersionStatus();
                                if (!status.ok) {
                                    if (state !== "missing" && state !== "deletedOnly" && state !== "none") {
                                        state = "available-pointer";
                                    }
                                }
                            } catch { /* ignore */ }
                        }

                        availability[id] = state as any;
                    }
                }
                provider.postMessageToWebview(webviewPanel, {
                    type: "providerSendsAudioAttachments",
                    attachments: availability,
                });
            } catch (err) {
                console.warn("Failed to compute audio availability after transcription", err);
            }
        } catch (error) {
            console.error("Failed to update transcription for cell:", cellId, error);
        }
    },

    // Return the user's preferred editor tab (workspace-scoped), default to "source"
    getPreferredEditorTab: async ({ webviewPanel, provider }) => {
        try {
            const tab = provider.getPreferredEditorTab();
            provider.postMessageToWebview(webviewPanel, {
                type: "preferredEditorTab",
                tab,
            });
        } catch (error) {
            console.error("Error getting preferred editor tab:", error);
        }
    },

    // Update the user's preferred editor tab
    setPreferredEditorTab: async ({ event, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "setPreferredEditorTab"; }>;
        try {
            provider.updatePreferredEditorTab(typedEvent.content.tab);
        } catch (error) {
            console.error("Error setting preferred editor tab:", error);
        }
    },

    getPasteAsPlainText: async ({ webviewPanel, provider }) => {
        try {
            const enabled = provider.getPasteAsPlainText();
            provider.postMessageToWebview(webviewPanel, {
                type: "pasteAsPlainTextPreference",
                enabled,
            });
        } catch (error) {
            console.error("Error getting paste-as-plain-text preference:", error);
        }
    },

    setPasteAsPlainText: async ({ event, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "setPasteAsPlainText"; }>;
        try {
            provider.updatePasteAsPlainText(typedEvent.content.enabled);
        } catch (error) {
            console.error("Error setting paste-as-plain-text preference:", error);
        }
    },


    getCommentsForCell: async ({ event, webviewPanel }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "getCommentsForCell"; }>;
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                safePostMessageToPanel(webviewPanel, {
                    type: "commentsForCell",
                    content: {
                        cellId: typedEvent.content.cellId,
                        unresolvedCount: 0
                    },
                });
                return;
            }

            const comments = await getCommentsFromFile(".project/comments.json");
            const unresolvedCount = getUnresolvedCommentsCountForCell(comments, typedEvent.content.cellId);

            safePostMessageToPanel(webviewPanel, {
                type: "commentsForCell",
                content: {
                    cellId: typedEvent.content.cellId,
                    unresolvedCount: unresolvedCount
                },
            });
        } catch (error) {
            // Silent fallback - getCommentsFromFile now handles file not found gracefully
            // Only log if it's an unexpected error (not file not found)
            if (!(error instanceof Error && error.message === "Failed to parse notebook comments from file")) {
                console.error("Unexpected error getting comments for cell:", error);
            }
            safePostMessageToPanel(webviewPanel, {
                type: "commentsForCell",
                content: {
                    cellId: typedEvent.content.cellId,
                    unresolvedCount: 0
                },
            });
        }
    },

    getCommentsForCells: async ({ event, webviewPanel }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "getCommentsForCells"; }>;
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                const result: { [cellId: string]: number; } = {};
                typedEvent.content.cellIds.forEach(cellId => {
                    result[cellId] = 0;
                });
                safePostMessageToPanel(webviewPanel, {
                    type: "commentsForCells",
                    content: result,
                });
                return;
            }

            const comments = await getCommentsFromFile(".project/comments.json");
            const result: { [cellId: string]: number; } = {};

            typedEvent.content.cellIds.forEach(cellId => {
                result[cellId] = getUnresolvedCommentsCountForCell(comments, cellId);
            });

            safePostMessageToPanel(webviewPanel, {
                type: "commentsForCells",
                content: result,
            });
        } catch (error) {
            // Silent fallback
            if (!(error instanceof Error && error.message === "Failed to parse notebook comments from file")) {
                console.error("Unexpected error getting comments for cells:", error);
            }
            const result: { [cellId: string]: number; } = {};
            typedEvent.content.cellIds.forEach(cellId => {
                result[cellId] = 0;
            });
            safePostMessageToPanel(webviewPanel, {
                type: "commentsForCells",
                content: result,
            });
        }
    },

    openCommentsForCell: async ({ event, document, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "openCommentsForCell"; }>;
        try {
            // First, update the global state to set the current cell ID
            const uri = document.uri.toString();
            provider.updateCellIdState(typedEvent.content.cellId, uri, document);

            // Open the comments view and navigate to the specific cell
            await vscode.commands.executeCommand("codex-editor-extension.focusCommentsView");

            // Send a message to the comments view with navigation/open behavior.
            vscode.commands.executeCommand("codex-editor-extension.comments-sidebar.reload", {
                cellId: typedEvent.content.cellId,
                openCurrentTab: typedEvent.content.openCurrentTab ?? true,
                openNewCommentIfNoComments: typedEvent.content.openNewCommentIfNoComments ?? false,
            });
        } catch (error) {
            console.error("Error opening comments for cell:", error);
        }
    },

    searchSimilarCellIds: async ({ event, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "searchSimilarCellIds"; }>;
        const response = await vscode.commands.executeCommand<
            Array<{ cellId: string; score: number; }>
        >(
            "codex-editor-extension.searchSimilarCellIds",
            typedEvent.content.cellId,
            5,
            0.2
        );
        provider.postMessageToWebview(webviewPanel, {
            type: "providerSendsSimilarCellIdsResponse",
            content: response || [],
        });
    },

    requestSimilarWordingInspection: async ({ event, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "requestSimilarWordingInspection"; }>;
        const { cellId, targetContent } = typedEvent.content;

        try {
            const { getSQLiteIndexManager } = await import(
                "../../activationHelpers/contextAware/contentIndexes/indexes/sqliteIndexManager"
            );
            const indexManager = getSQLiteIndexManager();
            if (!indexManager) {
                throw new Error("Search index is not ready.");
            }

            const { inspectSimilarWording } = await import(
                "../../activationHelpers/contextAware/contentIndexes/similarWordingInspection"
            );
            const result = await inspectSimilarWording(indexManager, {
                cellId,
                targetContent,
            });

            provider.postMessageToWebview(webviewPanel, {
                type: "similarWordingInspectionResult",
                content: result,
            });
        } catch (error) {
            console.error("Error inspecting similar wording:", error);
            provider.postMessageToWebview(webviewPanel, {
                type: "similarWordingInspectionError",
                content: {
                    cellId,
                    error: error instanceof Error ? error.message : String(error),
                },
            });
        }
    },

    saveHtml: async ({ event, document, provider, webviewPanel }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "saveHtml"; }>;
        const requestId = typedEvent.requestId;

        if (document.uri.toString() !== (typedEvent.content.uri || document.uri.toString())) {
            console.warn("Attempted to update content in a different file. This operation is not allowed.");
            // Always ack so the webview doesn't spin indefinitely
            safePostMessageToPanel(webviewPanel, {
                type: "saveHtmlSaved",
                content: {
                    requestId,
                    cellId: typedEvent.content.cellMarkers?.[0] || "",
                    success: false,
                    error: "Attempted to update content in a different file.",
                },
            });
            return;
        }

        const cellId = typedEvent.content.cellMarkers[0];
        const oldContent = document.getCellContent(cellId);

        // Block saveHtml operations on locked cells
        if (oldContent?.metadata?.isLocked) {
            console.warn(`Attempted to save locked cell ${cellId}. Operation blocked.`);
            safePostMessageToPanel(webviewPanel, {
                type: "saveHtmlSaved",
                content: {
                    requestId,
                    cellId,
                    success: false,
                    error: `Cell ${cellId} is locked`,
                },
            });
            return;
        }

        const oldText = oldContent?.cellContent || "";
        const newText = typedEvent.content.cellContent || "";
        const isSourceText = document.uri.toString().includes(".source");
        const isTranscription = newText.includes('data-transcription="true"');


        if (oldText !== newText) {
            provider.updateFileStatus("dirty");
        }


        const finalContent = typedEvent.content.cellContent === "<span></span>" ? "" : typedEvent.content.cellContent;

        // For source file transcriptions, wait for index update to complete
        // so that the source content is immediately available for translation
        try {
            if (isSourceText && isTranscription) {
                await document.updateCellContent(cellId, finalContent, EditType.USER_EDIT);
                // Wait for the index to be updated and verify it's available
                await document.ensureCellIndexed(cellId, 3000);
            } else {
                await document.updateCellContent(cellId, finalContent, EditType.USER_EDIT);
            }

            // Persist the change all the way to disk before acknowledging completion to the webview.
            // This ensures UI "Save complete" state truly reflects the full round-trip.
            await provider.saveCustomDocument(document, new vscode.CancellationTokenSource().token);

            safePostMessageToPanel(webviewPanel, {
                type: "saveHtmlSaved",
                content: { requestId, cellId, success: true },
            });
        } catch (error) {
            console.error("Error persisting saveHtml:", error);
            safePostMessageToPanel(webviewPanel, {
                type: "saveHtmlSaved",
                content: {
                    requestId,
                    cellId,
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                },
            });
        }
    },

    getContent: ({ updateWebview, document, provider }) => {
        // getContent is only sent when the webview mounts (useEffect on initial render).
        // Reset tracked state so updateWebview treats this as an initial load and sends
        // full content (milestoneIndex, cells, etc.) instead of a refreshCurrentPage.
        const docUri = document.uri.toString();
        provider.resetPositionForReload(docUri);
        updateWebview();
    },

    setCurrentIdToGlobalState: ({ event, document, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "setCurrentIdToGlobalState"; }>;
        const uri = document.uri.toString();
        provider.updateCellIdState(typedEvent.content.currentLineId, uri, document);
    },

    llmCompletion: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "llmCompletion"; }>;
        debug("llmCompletion message received", { event, document, provider, webviewPanel });

        const cellId = typedEvent.content.currentLineId;
        const addContentToValue = typedEvent.content.addContentToValue;

        // Always preflight: if source text is empty, try to transcribe first, then only attempt LLM
        // In test environments the command may be unregistered; skip gracefully in that case.
        let contentIsEmpty = false;
        try {
            const sourceCell = await vscode.commands.executeCommand(
                "codex-editor-extension.getSourceCellByCellIdFromAllSourceCells",
                cellId
            ) as { cellId: string; content: string; } | null;
            contentIsEmpty = !sourceCell || !sourceCell.content || (sourceCell.content.replace(/<[^>]*>/g, "").trim() === "");
        } catch (e) {
            console.warn("getSourceCellByCellIdFromAllSourceCells unavailable; skipping transcription preflight");
            contentIsEmpty = false;
        }

        if (contentIsEmpty) {
            try {
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
                // In VS Code test environments (and in some real usage), the active document can be
                // outside of any workspace folder. In that case we can't open the corresponding
                // source file for transcription, but we should still honor the user's request and
                // enqueue the LLM completion.
                if (!workspaceFolder) {
                    console.warn("No workspace folder found; skipping transcription preflight and queuing LLM completion.");
                    await provider.addCellToSingleCellQueue(cellId, document, webviewPanel, addContentToValue);
                    return;
                }

                const normalizedPath = document.uri.fsPath.replace(/\\/g, "/");
                const baseFileName = path.basename(normalizedPath);
                const sourceFileName = baseFileName.endsWith(".codex")
                    ? baseFileName.replace(".codex", ".source")
                    : baseFileName;
                const sourcePath = vscode.Uri.joinPath(
                    workspaceFolder.uri,
                    ".project",
                    "sourceTexts",
                    sourceFileName
                );

                await vscode.commands.executeCommand(
                    "vscode.openWith",
                    sourcePath,
                    "codex.cellEditor",
                    { viewColumn: vscode.ViewColumn.One }
                );

                // Wait for source webview to be ready
                await provider.waitForWebviewReady(sourcePath.toString(), 3000);

                // Wait briefly for the source panel to register
                let sourcePanel = provider.getWebviewPanels().get(sourcePath.toString());
                if (!sourcePanel) {
                    const waitStart = Date.now();
                    while (!sourcePanel && Date.now() - waitStart < 1500) {
                        await new Promise((r) => setTimeout(r, 100));
                        sourcePanel = provider.getWebviewPanels().get(sourcePath.toString());
                    }
                }

                if (!sourcePanel) {
                    vscode.window.showWarningMessage("Could not open source for transcription. Please try again.");
                    return;
                }

                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: "Transcribing source audio…",
                        cancellable: false,
                    },
                    async (progress) => {
                        // Start transcription for the specific cell only
                        safePostMessageToPanel(sourcePanel!, {
                            type: "startBatchTranscription",
                            content: { count: 1, cellId }
                        } as any);

                        // Mock progress while polling for source content availability
                        let progressValue = 0;
                        const timer = setInterval(() => {
                            progressValue = Math.min(progressValue + 3, 95);
                            progress.report({ increment: 3 });
                        }, 500);

                        try {
                            const timeoutMs = 40000;
                            const start = Date.now();
                            let foundText = false;
                            for (; ;) {
                                let src: { cellId: string; content: string; } | null = null;
                                try {
                                    src = await vscode.commands.executeCommand(
                                        "codex-editor-extension.getSourceCellByCellIdFromAllSourceCells",
                                        cellId
                                    ) as { cellId: string; content: string; } | null;
                                } catch {
                                    // Command not available; abort polling
                                    break;
                                }
                                const hasText = !!src && !!src.content && src.content.replace(/<[^>]*>/g, "").trim() !== "";
                                if (hasText) {
                                    foundText = true;
                                    // Wait a bit more to ensure index is fully updated and propagated
                                    await new Promise((r) => setTimeout(r, 500));
                                    // Verify one more time that source is still available
                                    try {
                                        const verifySrc = await vscode.commands.executeCommand(
                                            "codex-editor-extension.getSourceCellByCellIdFromAllSourceCells",
                                            cellId
                                        ) as { cellId: string; content: string; } | null;
                                        const stillHasText = !!verifySrc && !!verifySrc.content && verifySrc.content.replace(/<[^>]*>/g, "").trim() !== "";
                                        if (stillHasText) break;
                                    } catch {
                                        // If verification fails, proceed anyway since we found text once
                                        break;
                                    }
                                }
                                if (Date.now() - start > timeoutMs) break;
                                await new Promise((r) => setTimeout(r, 400));
                            }
                        } finally {
                            clearInterval(timer);
                            progress.report({ increment: 100 - progressValue });
                        }
                    }
                );

                // After transcription completes (or timeout), only then try LLM
                const ready = await provider.isLLMReady().catch(() => true);
                if (!ready) {
                    vscode.window.showWarningMessage(
                        "Transcription complete, but LLM is not configured. Set an API key or sign in to generate predictions."
                    );
                }
                await provider.addCellToSingleCellQueue(cellId, document, webviewPanel, addContentToValue);
                return;
            } catch (e) {
                // Transcription preflight is best-effort. If it fails, still queue the LLM request
                // so the user action isn't dropped (and tests can assert queueing deterministically).
                console.warn("Transcription preflight failed; continuing to queue LLM completion", e);
                await provider.addCellToSingleCellQueue(cellId, document, webviewPanel, addContentToValue);
                return;
            }
        }

        // If source already has text, proceed only if LLM is ready
        const ready = await provider.isLLMReady().catch(() => true);
        if (!ready) {
            vscode.window.showWarningMessage(
                "LLM is not configured. Set an API key or sign in to generate predictions."
            );
        }
        await provider.addCellToSingleCellQueue(cellId, document, webviewPanel, addContentToValue);
    },

    stopAutocompleteChapter: ({ provider }) => {
        debug("stopAutocompleteChapter message received");
        const cancelled = provider.cancelAutocompleteChapter();
        if (cancelled) {
            vscode.window.showInformationMessage("Autocomplete operation stopped.");
        } else {
            debug("No active autocomplete operation to stop");
        }
    },

    stopSingleCellTranslation: ({ provider }) => {
        debug("stopSingleCellTranslation message received");

        // Try the new robust single cell queue system first
        const cancelledQueue = provider.cancelSingleCellQueue();

        // Fallback to old system for backward compatibility
        if (!cancelledQueue && provider?.singleCellTranslationState.isProcessing) {
            provider.clearTranslationQueue();
            provider.updateSingleCellTranslation(1.0);
        }

        if (cancelledQueue || provider?.singleCellTranslationState.isProcessing) {
            vscode.window.showInformationMessage("Translation cancelled.");
        }
    },

    cellError: ({ event, provider }) => {
        debug("cellError message received", { event });
        const cellId = (event as any).content?.cellId;
        if (cellId && typeof cellId === "string") {
            provider.markCellComplete(cellId);
        }
    },

    requestAutocompleteChapter: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "requestAutocompleteChapter"; }>;
        await provider.performAutocompleteChapter(
            document,
            webviewPanel,
            typedEvent.content as QuillCellContent[]
        );
    },

    updateTextDirection: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "updateTextDirection"; }>;
        const updatedMetadata = {
            textDirection: typedEvent.direction,
        };
        await document.updateNotebookMetadata(updatedMetadata);
        await document.save(new vscode.CancellationTokenSource().token);
        debug("Text direction updated successfully.");
        provider.postMessageToWebview(webviewPanel, {
            type: "providerUpdatesNotebookMetadataForWebview",
            content: await document.getNotebookMetadata(),
        });
    },

    getSourceText: async ({ event, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "getSourceText"; }>;
        const sourceText = (await vscode.commands.executeCommand(
            "codex-editor-extension.getSourceCellByCellIdFromAllSourceCells",
            typedEvent.content.cellId
        )) as { cellId: string; content: string; };
        provider.postMessageToWebview(webviewPanel, {
            type: "providerSendsSourceText",
            content: sourceText.content,
        });
    },

    resolveHtmlStructure: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "resolveHtmlStructure"; }>;
        const cellId = typedEvent.content.cellId;

        try {
            const sourceHtml = await (
                await import("./utils/htmlStructureResolver")
            ).getSourceCellContent(cellId);

            if (!sourceHtml) {
                vscode.window.showWarningMessage("Could not find source cell content to resolve structure.");
                return;
            }

            const targetCell = document.getCellContent(cellId);
            if (!targetCell) {
                vscode.window.showWarningMessage("Could not find target cell.");
                return;
            }

            const { fetchCompletionConfig } = await import("../../utils/llmUtils");
            const { resolveHtmlStructureWithLLM } = await import("./utils/htmlStructureResolver");
            const config = await fetchCompletionConfig();
            const resolved = await resolveHtmlStructureWithLLM(
                sourceHtml,
                targetCell.cellContent,
                config,
            );

            // Persist the resolved content to the document so it survives reload
            await document.updateCellContent(cellId, resolved, EditType.LLM_GENERATION);
            await provider.saveCustomDocument(document, new vscode.CancellationTokenSource().token);

            provider.postMessageToWebview(webviewPanel, {
                type: "providerSendsResolvedHtmlStructure",
                content: { cellId, resolvedContent: resolved },
            });
        } catch (error) {
            console.error("[resolveHtmlStructure] Error:", error);
            vscode.window.showErrorMessage(
                `Failed to resolve HTML structure: ${error instanceof Error ? error.message : String(error)}`
            );
            // Signal failure so the webview can reset the loading state
            provider.postMessageToWebview(webviewPanel, {
                type: "providerSendsResolvedHtmlStructure",
                content: { cellId, resolvedContent: "" },
            });
        }
    },

    openSourceText: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "openSourceText"; }>;
        const workspaceFolderUri = getWorkSpaceUri();
        if (!workspaceFolderUri) {
            throw new Error("No workspace folder found");
        }
        const currentFileName = document.uri.fsPath;
        const baseFileName = path.basename(currentFileName);
        const sourceFileName = baseFileName.replace(".codex", ".source");
        const sourceUri = vscode.Uri.joinPath(
            workspaceFolderUri,
            ".project",
            "sourceTexts",
            sourceFileName
        );

        try {
            await vscode.commands.executeCommand(
                "vscode.openWith",
                sourceUri,
                "codex.cellEditor",
                { viewColumn: vscode.ViewColumn.Beside }
            );
        } catch (error) {
            console.error(`Failed to open source file: ${error}`);
            vscode.window.showErrorMessage(
                `Failed to open source file: ${sourceUri.toString()}`
            );
        }
        provider.postMessageToWebview(webviewPanel, {
            type: "jumpToSection",
            content: typedEvent.content.chapterNumber.toString(),
        });
    },

    makeChildOfCell: ({ event, document }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "makeChildOfCell"; }>;
        document.addCell(
            typedEvent.content.newCellId,
            typedEvent.content.referenceCellId,
            typedEvent.content.direction,
            typedEvent.content.cellType,
            typedEvent.content.data
        );
    },

    deleteCell: ({ event, document }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "deleteCell"; }>;
        debug("deleteCell (soft) message received", { event });
        // Soft-delete: mark the cell as deleted in metadata instead of removing it
        document.softDeleteCell(typedEvent.content.cellId);
    },

    updateCellTimestamps: ({ event, document }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "updateCellTimestamps"; }>;
        debug("updateCellTimestamps message received", { event });
        document.updateCellTimestamps(typedEvent.content.cellId, typedEvent.content.timestamps);
    },

    updateCellAudioTimestamps: ({ event, document }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "updateCellAudioTimestamps"; }>;
        console.log("updateCellAudioTimestamps message received", { event });
        document.updateCellAudioTimestamps(typedEvent.content.cellId, typedEvent.content.timestamps);
    },

    updateCellLabel: ({ event, document }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "updateCellLabel"; }>;
        debug("updateCellLabel message received", { event });
        document.updateCellLabel(typedEvent.content.cellId, typedEvent.content.cellLabel);
    },

    updateCellIsLocked: ({ event, document }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "updateCellIsLocked"; }>;
        debug("updateCellIsLocked message received", { event });
        document.updateCellIsLocked(typedEvent.content.cellId, typedEvent.content.isLocked);
    },

    updateMilestoneValue: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "updateMilestoneValue"; }>;
        debug("updateMilestoneValue message received", { event });

        // Build milestone index to find the milestone cell
        const milestoneIndex = document.buildMilestoneIndex();
        const milestoneInfo = milestoneIndex.milestones[typedEvent.content.milestoneIndex];

        if (!milestoneInfo) {
            console.error("Milestone not found at index", typedEvent.content.milestoneIndex);
            vscode.window.showErrorMessage(`Failed to update milestone: milestone not found at index ${typedEvent.content.milestoneIndex}`);
            return;
        }

        // Use the cellIndex directly from milestoneInfo for O(1) access
        const milestoneCell = document.getCellByIndex(milestoneInfo.cellIndex);

        if (!milestoneCell || !milestoneCell.metadata?.id) {
            console.error("Milestone cell not found at index", milestoneInfo.cellIndex);
            vscode.window.showErrorMessage(`Failed to update milestone: cell not found at index ${milestoneInfo.cellIndex}`);
            return;
        }

        // Verify it's actually a milestone cell (safety check)
        if (milestoneCell.metadata?.type !== CodexCellTypes.MILESTONE) {
            console.error("Cell at index is not a milestone cell", milestoneInfo.cellIndex);
            vscode.window.showErrorMessage(`Failed to update milestone: cell at index ${milestoneInfo.cellIndex} is not a milestone cell`);
            return;
        }

        // Skip deleted milestone cells
        if (milestoneCell.metadata?.data?.deleted === true) {
            console.error("Milestone cell is deleted", milestoneInfo.cellIndex);
            vscode.window.showErrorMessage("Failed to update milestone: milestone cell has been deleted");
            return;
        }

        const milestoneCellId = milestoneCell.metadata.id;
        const cancellationToken = new vscode.CancellationTokenSource().token;

        // Preserve current milestone index and subsection before refreshing webview
        // Get current subsection from map if available, otherwise use cached subsection
        const docUri = document.uri.toString();
        const currentPosition = provider.currentMilestoneSubsectionMap.get(docUri);
        const subsectionIndex = currentPosition?.subsectionIndex ?? provider.getCachedSubsection(docUri);

        // Save milestone index to preserve position after refresh
        provider.currentMilestoneSubsectionMap.set(docUri, {
            milestoneIndex: typedEvent.content.milestoneIndex,
            subsectionIndex: subsectionIndex,
        });

        try {
            // Ensure author is set correctly before creating edit
            await document.refreshAuthor();

            // Update the milestone cell value in the current document
            await document.updateCellContent(
                milestoneCellId,
                typedEvent.content.newValue,
                EditType.USER_EDIT,
                true, // shouldUpdateValue
                false, // retainValidations
                false // skipAutoValidation
            );

            // Note: The custom document change event is automatically fired by updateCellContent
            // through the document's _onDidChangeForVsCodeAndWebview event, which the provider
            // listens to and fires _onDidChangeCustomDocument. No need to fire it explicitly here.

            // Save the document using provider's saveCustomDocument for proper VS Code integration
            try {
                await provider.saveCustomDocument(document, cancellationToken);
                debug(`[updateMilestoneValue] Successfully updated and saved milestone in file: ${document.uri.fsPath}`);
                vscode.window.showInformationMessage(
                    `Milestone "${typedEvent.content.newValue}" updated successfully.`
                );
            } catch (saveError) {
                console.error(`[updateMilestoneValue] Failed to save file ${document.uri.fsPath}:`, saveError);
                vscode.window.showErrorMessage(
                    `Failed to save milestone update: ${saveError instanceof Error ? saveError.message : String(saveError)}`
                );
                return;
            }
        } catch (error) {
            // Critical error - milestone update failed
            console.error(`[updateMilestoneValue] Critical error updating milestone:`, error);
            vscode.window.showErrorMessage(
                `Failed to update milestone: ${error instanceof Error ? error.message : String(error)}`
            );
            return;
        }

        // Always push updated milestone index and cells to webview so the edit appears immediately
        await sendMilestoneRefreshToWebview(document, webviewPanel, provider);
    },

    refreshWebviewAfterMilestoneEdits: async ({ document, webviewPanel, provider }) => {
        await sendMilestoneRefreshToWebview(document, webviewPanel, provider);
    },

    updateNotebookMetadata: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "updateNotebookMetadata"; }>;
        debug("updateNotebookMetadata message received", { event });
        const newMetadata = typedEvent.content;

        // A staged video pick is imported here, at save time, so that picking a
        // file and then cancelling the modal leaves nothing behind. The import
        // both writes the new file and deletes any previous local video, so it
        // takes the place of the generic video-change guard below.
        const pendingVideoFilePath = typedEvent.pendingVideoFilePath;
        if (pendingVideoFilePath) {
            try {
                const imported = await importPickedVideoIntoProject(
                    document,
                    pendingVideoFilePath
                );
                // `null` means the user cancelled the import (nothing was written);
                // keep whatever video was already saved.
                newMetadata.videoUrl =
                    imported ?? document.getNotebookMetadata()?.videoUrl ?? "";
            } catch (error) {
                console.error("Error saving video file:", error);
                vscode.window.showErrorMessage(
                    `Failed to save video file: ${error instanceof Error ? error.message : "Unknown error"}`
                );
                // Keep the previously saved video so a failed import doesn't drop it.
                newMetadata.videoUrl = document.getNotebookMetadata()?.videoUrl ?? "";
            }
        }

        // Guard the video field: if the user is replacing an existing local
        // video (file -> URL, file -> file, or removal), confirm first and
        // delete the old local file from files/ and pointers/. Skipped for a
        // staged pick, which already handled the previous file during import.
        const oldVideoUrl = document.getNotebookMetadata()?.videoUrl;
        const newVideoUrl = newMetadata.videoUrl;
        const videoChanged = (oldVideoUrl ?? "") !== (newVideoUrl ?? "");
        if (!pendingVideoFilePath && videoChanged) {
            const oldKind = classifyVideo(oldVideoUrl);
            const newKind = classifyVideo(newVideoUrl);
            if (oldKind === "local") {
                // The metadata modal already runs a robust type-to-confirm step
                // before any video removal/replace, so it sets skipVideoConfirm to
                // avoid a redundant second prompt. Other callers still confirm.
                const proceed = typedEvent.skipVideoConfirm
                    ? true
                    : await confirmVideoReplacement(oldKind, newKind);
                if (!proceed) {
                    // Revert the webview's optimistic edit by re-sending current
                    // metadata, and restore the player's URL to the unchanged video.
                    provider.postMessageToWebview(webviewPanel, {
                        type: "providerUpdatesNotebookMetadataForWebview",
                        content: document.getNotebookMetadata(),
                    });
                    await resolveAndPostVideoStreamUrl(document, webviewPanel, provider);
                    return;
                }

                const workspaceUri = vscode.workspace.getWorkspaceFolder(document.uri)?.uri;
                if (workspaceUri) {
                    // Cancel any in-flight download of the video being replaced so
                    // it can't write back over the new selection (#1038).
                    const { abortVideoOperation } = await import("./utils/videoDownloadUtils");
                    abortVideoOperation(workspaceUri, oldVideoUrl);
                    await deleteLocalVideoFiles(oldVideoUrl, workspaceUri);
                }
            }
        }

        await document.updateNotebookMetadata(newMetadata);
        await document.save(new vscode.CancellationTokenSource().token);

        vscode.window.showInformationMessage("Notebook details updated.");
        provider.postMessageToWebview(webviewPanel, {
            type: "providerUpdatesNotebookMetadataForWebview",
            content: await document.getNotebookMetadata(),
        });
        await postVideoReferenceStatus(document, webviewPanel, provider);
    },

    deleteVideoFile: async ({ document, webviewPanel, provider }) => {
        debug("deleteVideoFile message received");
        const currentVideoUrl = document.getNotebookMetadata()?.videoUrl;
        const kind = classifyVideo(currentVideoUrl);
        if (kind === "none") {
            return;
        }

        const proceed = await confirmVideoReplacement(kind, "none");
        if (!proceed) {
            return;
        }

        if (kind === "local") {
            const workspaceUri = vscode.workspace.getWorkspaceFolder(document.uri)?.uri;
            if (workspaceUri) {
                // Cancel any in-flight download of this video first, so a finishing
                // download can't write its bytes back over the file we delete (#1038).
                const { abortVideoOperation } = await import("./utils/videoDownloadUtils");
                abortVideoOperation(workspaceUri, currentVideoUrl);
                await deleteLocalVideoFiles(currentVideoUrl, workspaceUri);
            }
        }

        await document.updateNotebookMetadata({ videoUrl: "" });
        await document.save(new vscode.CancellationTokenSource().token);

        // Lightweight update instead of a full refresh: push the cleared metadata
        // and a "none" reference status so the webview hides the toggle and closes
        // the player if it's open.
        provider.postMessageToWebview(webviewPanel, {
            type: "providerUpdatesNotebookMetadataForWebview",
            content: document.getNotebookMetadata(),
        });
        await postVideoReferenceStatus(document, webviewPanel, provider);
    },

    freeVideoDiskSpace: async ({ document, webviewPanel, provider }) => {
        debug("freeVideoDiskSpace message received");
        // Revert a downloaded stream-and-save video back to an LFS pointer to free
        // disk space. The reference (videoUrl) is kept, so it re-streams on demand.
        const videoUrl = document.getNotebookMetadata()?.videoUrl;
        const workspaceUri = vscode.workspace.getWorkspaceFolder(document.uri)?.uri;
        if (!videoUrl || !workspaceUri || !(await computeCanFreeVideoDiskSpace(document))) {
            return;
        }

        const proceed = await vscode.window.showInformationMessage(
            "Free up space for this video?",
            {
                modal: true,
                detail: "The downloaded file is removed and the video streams again on demand.",
            },
            "Free up space"
        );
        if (proceed !== "Free up space") {
            return;
        }

        const { freeVideoFileToPointer } = await import("./utils/videoDownloadUtils");
        await freeVideoFileToPointer(workspaceUri, videoUrl);

        // Re-resolve playback (local bytes are gone → the player shows the
        // download/stream action) and refresh the modal's reference status.
        await resolveAndPostVideoStreamUrl(document, webviewPanel, provider);
        await postVideoReferenceStatus(document, webviewPanel, provider);
    },

    requestVideoReferenceStatus: async ({ document, webviewPanel, provider }) => {
        await postVideoReferenceStatus(document, webviewPanel, provider);
    },

    requestVideoStreamUrl: async ({ document, webviewPanel, provider }) => {
        debug("requestVideoStreamUrl message received");
        await resolveAndPostVideoStreamUrl(document, webviewPanel, provider);
    },

    downloadVideoFile: async ({ event, document, webviewPanel, provider }) => {
        debug("downloadVideoFile message received");
        // `persist` defaults to true so any non-stream-only mode keeps the file.
        const persist = event.command === "downloadVideoFile" ? event.persist !== false : true;
        const videoUrl = document.getNotebookMetadata()?.videoUrl;
        if (!videoUrl || isHttpVideoUrl(videoUrl)) {
            return;
        }

        const workspaceUri = vscode.workspace.getWorkspaceFolder(document.uri)?.uri;
        if (!workspaceUri) {
            return;
        }

        const rel = getVideoWorkspaceRelativePath(videoUrl, workspaceUri);
        if (!rel) {
            return;
        }

        const filesUri = vscode.Uri.joinPath(workspaceUri, rel);
        const pointersRel = rel.includes("attachments/files/")
            ? rel.replace("attachments/files/", "attachments/pointers/")
            : rel;
        const pointersUri = vscode.Uri.joinPath(workspaceUri, pointersRel);
        const ext = path.extname(rel);

        const { getMediaFilesStrategy } = await import("../../utils/localProjectSettings");
        const strategy = (await getMediaFilesStrategy(workspaceUri)) ?? "auto-download";
        // In stream-only, a plain "Load" is a temporary session cache stored
        // outside the project; an explicit "Save to project" (persist) writes to
        // files/. Every other strategy always keeps the file in files/.
        const keepFile = persist || strategy !== "stream-only";

        const { writeCachedVideo, hasCachedVideo, deleteCachedVideo } = await import(
            "../../utils/videoStreamCache"
        );

        // If a saved copy already exists in files/, just play it.
        if (!(await isPointerFile(filesUri.fsPath))) {
            try {
                await vscode.workspace.fs.stat(filesUri);
                await resolveAndPostVideoStreamUrl(document, webviewPanel, provider);
                return;
            } catch {
                // Not present; fall through to download.
            }
        }

        const pointer =
            (await parsePointerFile(filesUri.fsPath)) ?? (await parsePointerFile(pointersUri.fsPath));
        if (!pointer) {
            provider.postMessageToWebview(webviewPanel, {
                type: "videoStreamUnavailable",
                reason: "not-found",
                message:
                    "This video isn't available yet. It may still be syncing, or the file couldn't be found.",
            });
            return;
        }

        // A session cache from this session already exists → play it, no re-download.
        if (!keepFile && (await hasCachedVideo(provider.extensionContext, pointer.oid, ext))) {
            await resolveAndPostVideoStreamUrl(document, webviewPanel, provider);
            return;
        }

        const authApi = getAuthApi();
        if (!authApi?.downloadLFSFile) {
            provider.postMessageToWebview(webviewPanel, {
                type: "videoStreamUnavailable",
                reason: "error",
                message: "Cannot download: the Frontier Authentication extension is unavailable.",
            });
            return;
        }

        // Snapshot whatever files/ holds right now (a pointer stub, or nothing).
        // A cancel can land while the downloaded bytes are being WRITTEN — after
        // the pre-write abort check — and a large video's write takes real time.
        // The post-write check below restores this exact pre-download state so a
        // cancel always wins and no downloaded bytes remain saved.
        let preDownloadStub: Uint8Array | undefined;
        try {
            preDownloadStub = await vscode.workspace.fs.readFile(filesUri);
        } catch {
            preDownloadStub = undefined; // absent — reverting means deleting
        }

        // Register the fetch so the user can cancel it from the progress
        // notification, and so deleting/replacing the video mid-download aborts
        // it and its bytes are never written back (issue #1038). Mirrors the
        // navigation sidebar's "Get video" flow.
        const { beginVideoOperation, endVideoOperation } = await import(
            "./utils/videoDownloadUtils"
        );
        const controller = beginVideoOperation(workspaceUri, videoUrl);
        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: keepFile ? "Downloading and saving video…" : "Loading video…",
                    cancellable: true,
                },
                async (_progress, token) => {
                    token.onCancellationRequested(() => controller.abort());
                    const buffer = await authApi.downloadLFSFile(
                        workspaceUri.fsPath,
                        pointer.oid,
                        pointer.size,
                        controller.signal
                    );
                    // Never write/play an incomplete file: require non-empty bytes
                    // that match the pointer's expected size. A mismatch means the
                    // download didn't fully succeed.
                    const byteLength = buffer?.byteLength ?? 0;
                    if (byteLength === 0) {
                        throw new Error("Download returned no data.");
                    }
                    if (pointer.size > 0 && byteLength !== pointer.size) {
                        throw new Error(
                            `Downloaded ${byteLength} of ${pointer.size} bytes; the file is incomplete.`
                        );
                    }
                    // The video may have been deleted/replaced (or the download
                    // cancelled) while the fetch was in flight. Never write the
                    // bytes back in that case (issue #1038).
                    if (controller.signal.aborted) {
                        throw new Error("Download cancelled.");
                    }
                    const bytes = new Uint8Array(buffer);
                    if (keepFile) {
                        // Permanent: write into the project (files/ is gitignored,
                        // so this is local-only and survives reloads).
                        await vscode.workspace.fs.createDirectory(
                            vscode.Uri.joinPath(filesUri, "..")
                        );
                        await vscode.workspace.fs.writeFile(filesUri, bytes);
                    } else {
                        // Temporary session cache: write outside the project so
                        // files/ stays a pointer. Cleared on reload.
                        await writeCachedVideo(provider.extensionContext, pointer.oid, ext, bytes);
                    }
                    // A cancel (or delete/replace) that raced the write above:
                    // honor it now by reverting to the pre-download state, so
                    // the cancel wins and no downloaded bytes remain saved.
                    if (controller.signal.aborted) {
                        try {
                            if (keepFile) {
                                if (preDownloadStub) {
                                    await vscode.workspace.fs.writeFile(filesUri, preDownloadStub);
                                } else {
                                    await vscode.workspace.fs.delete(filesUri);
                                }
                            } else {
                                await deleteCachedVideo(provider.extensionContext, pointer.oid, ext);
                            }
                        } catch {
                            // Best effort — worst case a complete (never partial) file remains.
                        }
                        throw new Error("Download cancelled.");
                    }
                }
            );

            if (keepFile) {
                // Confirm the bytes actually landed on disk (not still a pointer)
                // before we ever ask the webview to open it.
                const writtenIsPointer = await isPointerFile(filesUri.fsPath).catch(() => true);
                if (writtenIsPointer) {
                    throw new Error("The video file is not available after download.");
                }

                // Only an explicit "Save to project" in stream-only needs the
                // allowlist: other strategies keep files/ by design, and adding
                // them would wrongly block a later switch to stream-only from
                // freeing space. Record the rel-path so post-sync / strategy-switch
                // cleanup never reverts this saved video to a pointer.
                if (persist && strategy === "stream-only") {
                    const FILES_SEG = "attachments/files/";
                    const savedRel = rel.includes(FILES_SEG)
                        ? rel.slice(rel.indexOf(FILES_SEG) + FILES_SEG.length)
                        : null;
                    if (savedRel) {
                        const { addPersistedMediaFile } = await import("../../utils/localProjectSettings");
                        await addPersistedMediaFile(savedRel, workspaceUri);
                    }
                }
            }

            // Verified bytes present (in files/ or the external cache) → resolves
            // to a playable webview URI.
            await resolveAndPostVideoStreamUrl(document, webviewPanel, provider);
            // A "Save to project"/"download & save" now has a real local copy, so
            // refresh the reference status to surface the "Free up space" action.
            await postVideoReferenceStatus(document, webviewPanel, provider);
        } catch (error) {
            // An intentional cancel (progress button, or the video was deleted/
            // replaced mid-download) is not an error — quietly reset the player.
            if (controller.signal.aborted) {
                provider.postMessageToWebview(webviewPanel, {
                    type: "videoStreamUnavailable",
                    reason: "error",
                    message: "Download cancelled.",
                });
                return;
            }
            const msg = error instanceof Error ? error.message : String(error);
            const reason: "not-authenticated" | "error" = /not authenticated|log in/i.test(msg)
                ? "not-authenticated"
                : "error";
            provider.postMessageToWebview(webviewPanel, {
                type: "videoStreamUnavailable",
                reason,
                message: `Download failed: ${msg}`,
            });
        } finally {
            endVideoOperation(workspaceUri, videoUrl);
        }
    },

    pickVideoFile: async ({ webviewPanel, provider }) => {
        debug("pickVideoFile message received");

        // Stage the selection only — the file is NOT written into the project
        // here. The metadata modal shows it as a pending video and the host
        // imports it (writing files/pointers + deleting any previous local
        // video) when the user clicks "Save Changes" (see
        // updateNotebookMetadata's pendingVideoFilePath). Cancelling the modal
        // therefore leaves the project untouched.
        const result = await vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel: "Select Video File",
            filters: {
                Videos: ["mp4", "mkv", "avi", "mov", "webm"],
            },
        });
        const fileUri = result?.[0];
        if (!fileUri) {
            return;
        }

        provider.postMessageToWebview(webviewPanel, {
            type: "videoFilePicked",
            fsPath: fileUri.fsPath,
            fileName: path.basename(fileUri.fsPath),
        });
    },

    replaceDuplicateCells: ({ event, document }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "replaceDuplicateCells"; }>;
        debug("replaceDuplicateCells message received", { event });
        document.replaceDuplicateCells(typedEvent.content);
    },

    saveTimeBlocks: ({ event, document }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "saveTimeBlocks"; }>;
        debug("saveTimeBlocks message received", { event });
        typedEvent.content.forEach((cell) => {
            document.updateCellTimestamps(cell.id, {
                startTime: cell.begin,
                endTime: cell.end,
            });
        });
    },

    exportFile: async ({ event, document }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "exportFile"; }>;
        const notebookName = path.parse(document.uri.fsPath).name;
        const fileExtension = typedEvent.content.format;
        const fileName = `${notebookName}.${fileExtension}`;

        const saveUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(fileName),
            filters: {
                "Subtitle files": ["vtt", "srt"],
            },
        });

        if (saveUri) {
            await vscode.workspace.fs.writeFile(
                saveUri,
                Buffer.from(typedEvent.content.subtitleData, "utf-8")
            );
            vscode.window.showInformationMessage(
                `File exported successfully as ${fileExtension.toUpperCase()}`
            );
        }
    },

    executeCommand: async ({ event }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "executeCommand"; }>;
        await vscode.commands.executeCommand(typedEvent.content.command, ...typedEvent.content.args);
    },

    openLoginFlow: async () => {
        await vscode.commands.executeCommand("codex-project-manager.openStartupFlow", {
            forceLogin: true,
        });
    },

    generateBacktranslation: async ({ event, webviewPanel, provider, document }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "generateBacktranslation"; }>;
        const backtranslation = await safeExecuteCommand<SavedBacktranslation | null>(
            "codex-smart-edits.generateBacktranslation",
            typedEvent.content.text,
            typedEvent.content.cellId,
            document.uri.fsPath
        );
        provider.postMessageToWebview(webviewPanel, {
            type: "providerSendsBacktranslation",
            content: backtranslation,
        });
    },

    editBacktranslation: async ({ event, webviewPanel, provider, document }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "editBacktranslation"; }>;
        const updatedBacktranslation = await safeExecuteCommand<SavedBacktranslation | null>(
            "codex-smart-edits.editBacktranslation",
            typedEvent.content.cellId,
            typedEvent.content.newText,
            typedEvent.content.existingBacktranslation,
            document.uri.fsPath
        );
        provider.postMessageToWebview(webviewPanel, {
            type: "providerSendsUpdatedBacktranslation",
            content: updatedBacktranslation,
        });
    },

    getBacktranslation: async ({ event, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "getBacktranslation"; }>;
        const backtranslation = await safeExecuteCommand<SavedBacktranslation | null>(
            "codex-smart-edits.getBacktranslation",
            typedEvent.content.cellId
        );
        provider.postMessageToWebview(webviewPanel, {
            type: "providerSendsExistingBacktranslation",
            content: backtranslation,
        });
    },

    getBatchBacktranslations: async ({ event, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "getBatchBacktranslations"; }>;
        const cellIds = typedEvent.content.cellIds;

        const backtranslations: { [cellId: string]: SavedBacktranslation | null; } = {};
        for (const cellId of cellIds) {
            const backtranslation = await safeExecuteCommand<SavedBacktranslation | null>(
                "codex-smart-edits.getBacktranslation",
                cellId
            );
            backtranslations[cellId] = backtranslation;
        }

        provider.postMessageToWebview(webviewPanel, {
            type: "providerSendsBatchBacktranslations",
            content: backtranslations,
        });
    },

    setBacktranslation: async ({ event, webviewPanel, provider, document }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "setBacktranslation"; }>;
        const backtranslation = await safeExecuteCommand<SavedBacktranslation | null>(
            "codex-smart-edits.setBacktranslation",
            typedEvent.content.cellId,
            typedEvent.content.originalText,
            typedEvent.content.userBacktranslation,
            document.uri.fsPath
        );
        provider.postMessageToWebview(webviewPanel, {
            type: "providerConfirmsBacktranslationSet",
            content: backtranslation,
        });
    },

    webviewFocused: ({ event, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "webviewFocused"; }>;
        if (provider.currentDocument && typedEvent.content?.uri) {
            const newUri = vscode.Uri.parse(typedEvent.content.uri);
            if (newUri.scheme === "file") {
                provider.currentDocument.updateUri(newUri);
            }
        }
    },

    updateCachedChapter: async ({ event, document, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "updateCachedChapter"; }>;
        await provider.updateCachedChapter(document.uri.toString(), typedEvent.content);
    },

    updateCachedSubsection: async ({ event, document, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "updateCachedSubsection"; }>;
        await provider.updateCachedSubsection(document.uri.toString(), typedEvent.content);
    },

    selectABTestVariant: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "selectABTestVariant"; }>;
        const { cellId, selectedIndex, testId, selectionTimeMs, totalVariants } = typedEvent.content || {};
        // These fields may come from extended payloads but aren't in the strict type
        const selectedContent = (typedEvent.content as any)?.selectedContent as string | undefined;
        const testName = (typedEvent.content as any)?.testName as string | undefined;
        const variants = (typedEvent.content as any)?.variants as string[] | undefined;
        const variantNames: string[] | undefined = variants;
        const isRecovery = testName === "Recovery" || (typeof testId === "string" && testId.includes("-recovery-"));

        // Check if this was a pending attention check
        const attentionCheck = getAttentionCheck(testId);

        if (attentionCheck) {
            const pickedWrong = selectedIndex !== attentionCheck.correctIndex;

            if (!isRecovery) {
                // Record the result
                const { recordAttentionCheckResult } = await import("../../utils/abTestingUtils");
                await recordAttentionCheckResult({
                    testId,
                    cellId,
                    passed: !pickedWrong,
                    selectionTimeMs,
                    correctIndex: attentionCheck.correctIndex,
                    decoyCellId: attentionCheck.decoyCellId
                });
            }

            if (pickedWrong) {
                // User picked the decoy - send new A/B test with both correct
                console.log(`[Attention Check] User picked decoy for cell ${cellId}, showing recovery options`);
                clearAttentionCheck(testId);

                if (webviewPanel) {
                    const recoveryTestId = `${cellId}-recovery-${Date.now()}`;
                    provider.postMessageToWebview(webviewPanel, {
                        type: "providerSendsABTestVariants",
                        content: {
                            variants: [attentionCheck.correctVariant, attentionCheck.correctVariant],
                            cellId: attentionCheck.cellId,
                            testId: recoveryTestId,
                            testName: "Recovery",
                        },
                    });
                }
                return;
            }

            // User picked correctly - apply and clear
            clearAttentionCheck(testId);
        } else {
            // Regular A/B test
            if (!isRecovery) {
                const { recordVariantSelection } = await import("../../utils/abTestingUtils");
                await recordVariantSelection(testId, cellId, selectedIndex, selectionTimeMs, variantNames, testName);
            }
        }

        // Persist the selected variant to the .codex document
        // For attention checks, use the authoritative correctVariant from extension side
        const contentToSave = attentionCheck ? attentionCheck.correctVariant : selectedContent;
        if (contentToSave && cellId) {
            try {
                await document.updateCellContent(cellId, contentToSave, EditType.LLM_GENERATION);
                await provider.saveCustomDocument(document, new vscode.CancellationTokenSource().token);
            } catch (err) {
                console.error(`[selectABTestVariant] Failed to persist variant for cell ${cellId}:`, err);
            }
        }

        debug(`A/B test feedback recorded: Cell ${cellId}, variant ${selectedIndex}, test ${testId}, took ${selectionTimeMs}ms`);
    },

    validateCell: async ({ event, document, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "validateCell"; }>;
        if (typedEvent.content?.cellId) {
            await provider.enqueueValidation(
                typedEvent.content.cellId,
                document,
                typedEvent.content.validate
            );
        }
    },

    validateAudioCell: async ({ event, document, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "validateAudioCell"; }>;
        if (typedEvent.content?.cellId) {
            await provider.enqueueAudioValidation(
                typedEvent.content.cellId,
                document,
                typedEvent.content.validate,
                typedEvent.content.attachmentId
            );
        }
    },

    getValidationCount: async ({ webviewPanel, provider }) => {
        // Validation count is now bundled with initial content; only send on explicit request
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        const validationCount = config.get("validationCount", 1);
        provider.postMessageToWebview(webviewPanel, {
            type: "validationCount",
            content: validationCount,
        });
    },

    getValidationCountAudio: async ({ webviewPanel, provider }) => {
        // Audio validation count is now bundled with initial content; only send on explicit request
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        const validationCountAudio = config.get("validationCountAudio", 1);
        provider.postMessageToWebview(webviewPanel, {
            type: "validationCountAudio",
            content: validationCountAudio,
        });
    },

    getCurrentUsername: async ({ webviewPanel, provider }) => {
        // Username is now bundled with initial content; only send on explicit request
        const authApi = await provider.getAuthApi();
        const userInfo = await authApi?.getUserInfo();
        const username = userInfo?.username || "anonymous";

        provider.postMessageToWebview(webviewPanel, {
            type: "currentUsername",
            content: { username },
        });
    },

    togglePrimarySidebar: async () => {
        // No user notification needed - just toggle the sidebar
        await vscode.commands.executeCommand("workbench.action.toggleSidebarVisibility");
        await vscode.commands.executeCommand("codex-editor.navigation.focus");
    },

    toggleSecondarySidebar: async () => {
        await vscode.commands.executeCommand("workbench.action.toggleAuxiliaryBar");
    },

    getEditorPosition: async ({ webviewPanel }) => {
        const activeEditor = vscode.window.activeTextEditor;
        let position = "unknown";

        if (activeEditor) {
            const visibleEditors = vscode.window.visibleTextEditors;

            if (visibleEditors.length <= 1) {
                position = "single";
            } else {
                const sortedEditors = [...visibleEditors].sort(
                    (a, b) => (a.viewColumn || 0) - (b.viewColumn || 0)
                );

                const activeEditorIndex = sortedEditors.findIndex(
                    (editor) => editor.document.uri.toString() === activeEditor.document.uri.toString()
                );

                if (activeEditorIndex === 0) {
                    position = "leftmost";
                } else if (activeEditorIndex === sortedEditors.length - 1) {
                    position = "rightmost";
                } else {
                    position = "center";
                }
            }
        }

        safePostMessageToPanel(webviewPanel, {
            type: "editorPosition",
            position,
        });
    },

    queueValidation: ({ event, document, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "queueValidation"; }>;
        if (typedEvent.content?.cellId) {
            provider.queueValidation(
                typedEvent.content.cellId,
                document,
                typedEvent.content.validate,
                typedEvent.content.pending
            );
        }
    },

    applyPendingValidations: async ({ provider }) => {
        await provider.applyPendingValidations();
    },

    clearPendingValidations: ({ provider }) => {
        provider.clearPendingValidations();
    },

    jumpToChapter: ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "jumpToChapter"; }>;
        provider.updateCachedChapter(document.uri.toString(), typedEvent.chapterNumber);
        provider.postMessageToWebview(webviewPanel, {
            type: "setChapterNumber",
            content: typedEvent.chapterNumber,
        });
    },

    closeCurrentDocument: async ({ event }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "closeCurrentDocument"; }>;
        debug("Close document request received:", typedEvent.content);
        const fileUri = typedEvent.content?.uri;
        const isSourceDocument = typedEvent.content?.isSource === true;

        if (fileUri) {
            const urisToCheck = [
                vscode.Uri.file(fileUri),
                !fileUri.startsWith("file://") ? vscode.Uri.file(fileUri) : undefined,
            ].filter((uri): uri is vscode.Uri => uri !== undefined);

            const visibleEditors = vscode.window.visibleTextEditors;
            let found = false;

            for (const uri of urisToCheck) {
                if (found) break;
                for (const editor of visibleEditors) {
                    if (editor.document.uri.fsPath === uri.fsPath) {
                        await vscode.window.showTextDocument(editor.document, editor.viewColumn);
                        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
                        found = true;
                        break;
                    }
                }
            }

            if (!found) {
                debug("Could not find the specific editor to close, closing active editor");
                await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            }
        } else if (isSourceDocument) {
            const visibleEditors = vscode.window.visibleTextEditors;
            let found = false;

            for (const editor of visibleEditors) {
                if (editor.document.uri.fsPath.endsWith(".source")) {
                    await vscode.window.showTextDocument(editor.document, editor.viewColumn);
                    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
                    found = true;
                    break;
                }
            }

            if (!found) {
                await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            }
        } else {
            await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
        }
    },

    toggleSidebar: async ({ event }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "toggleSidebar"; }>;
        debug("toggleSidebar message received");
        await vscode.commands.executeCommand("workbench.action.toggleSidebarVisibility");
        if (typedEvent.content?.isOpening) {
            await vscode.commands.executeCommand("codex-editor.navigateToMainMenu");
        }
    },

    triggerSync: ({ provider }) => {
        debug("triggerSync message received");
        provider.triggerSync();
    },

    toggleCorrectionEditorMode: ({ provider }) => {
        debug("toggleCorrectionEditorMode message received");
        provider.toggleCorrectionEditorMode();
    },

    cancelMerge: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "cancelMerge"; }>;
        const cellId = typedEvent.content.cellId;

        debug("cancelMerge message received for cell:", cellId);

        try {
            // Get the current cell data and remove the merged flag
            const currentCellData = document.getCellData(cellId) || {};

            // Remove the merged flag by setting it to false in the current document
            document.updateCellData(cellId, {
                ...currentCellData,
                merged: false
            });

            // Record an edit on the (now unmerged) current cell to reflect the merged flag change to false
            try {
                const currentCellForEdits = document.getCell(cellId);
                if (currentCellForEdits) {
                    if (!currentCellForEdits.metadata.edits) {
                        currentCellForEdits.metadata.edits = [] as any;
                    }
                    const ts = Date.now();
                    // Best-effort user lookup (anonymous fallback)
                    let user = "anonymous";
                    try {
                        const authApi = await provider.getAuthApi();
                        const userInfo = await authApi?.getUserInfo();
                        user = userInfo?.username || "anonymous";
                    } catch { /* ignore */ }
                    (currentCellForEdits.metadata.edits as any[]).push({
                        editMap: EditMapUtils.metadataNested("data", "merged"),
                        value: false,
                        timestamp: ts,
                        type: EditType.USER_EDIT,
                        author: user,
                        validatedBy: []
                    });
                    // updateCellData() above already fired the change event, which can
                    // synchronously trigger updateWebview() → getText() and repopulate
                    // the per-cell cache with the mid-mutation state. Re-invalidate now
                    // so the upcoming save() re-serializes the cell with the unmerge edit.
                    document.markCellMutated(cellId);
                }
            } catch (e) {
                console.warn("Failed to record unmerge edit entry on source cell", e);
            }

            // Save the current document
            await document.save(new vscode.CancellationTokenSource().token);

            debug(`Successfully unmerged cell in source: ${cellId}`);

            // Also unmerge the corresponding cell in the target file (like merge function does)
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
            if (workspaceFolder) {
                await provider.unmergeMatchingCellsInTargetFile(cellId, document.uri.toString(), workspaceFolder);
            } else {
                console.warn("No workspace folder found, skipping target file unmerge");
                vscode.window.showWarningMessage("Could not fully undo the merge — no project folder found.");
            }

            // Refresh the webview to show the updated state
            provider.refreshWebview(webviewPanel, document);

        } catch (error) {
            console.error("Error canceling merge for cell:", cellId, error);
            vscode.window.showErrorMessage(
                `Failed to unmerge cell: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    },

    triggerReindexing: async () => {
        debug("Triggering reindexing after all translations completed");
        await vscode.commands.executeCommand("codex-editor-extension.forceReindex");
    },

    // requestAudioAttachments removed: provider proactively sends status; no webview-initiated fallback

    requestAudioForCell: async ({ event, document, webviewPanel }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "requestAudioForCell"; }>;
        const cellId = typedEvent.content.cellId;
        const audioId = (typedEvent.content as any).audioId; // Optional specific audio ID
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (!workspaceFolder) {
            debug("No workspace folder found");
            return;
        }

        try {
            let targetAttachment;
            let targetAttachmentId;

            if (audioId) {
                // Specific audio ID requested - get that exact attachment
                const documentText = document.getText();
                const notebookData = JSON.parse(documentText);
                const cell = notebookData.cells.find((c: any) => c.metadata?.id === cellId);

                if (cell?.metadata?.attachments?.[audioId]) {
                    targetAttachment = cell.metadata.attachments[audioId];
                    targetAttachmentId = audioId;
                }
            } else {
                // No specific ID - use the currently selected audio (respects selectedAudioId)
                const currentAttachment = document.getCurrentAttachment(cellId, "audio");
                if (currentAttachment) {
                    targetAttachment = currentAttachment.attachment;
                    targetAttachmentId = currentAttachment.attachmentId;
                }
            }

            if (targetAttachment && targetAttachmentId) {
                const attachmentPath = toPosixPath(targetAttachment.url);
                const fullPath = path.isAbsolute(attachmentPath)
                    ? attachmentPath
                    : path.join(workspaceFolder.uri.fsPath, attachmentPath);

                // Check if the file exists and get its stats to ensure we're serving the latest version
                let fileExists = false;
                let fileStats: vscode.FileStat | undefined;

                try {
                    fileStats = await vscode.workspace.fs.stat(vscode.Uri.file(fullPath));
                    fileExists = true;
                } catch {
                    fileExists = false;
                }

                if (fileExists && fileStats) {
                    const ext = path.extname(fullPath).toLowerCase();
                    const mimeType = audioExtensionToMime(ext);

                    let fileData: Uint8Array;

                    try {
                        // ========== LFS STREAMING LOGIC ==========
                        // Import LFS helpers
                        const { isPointerFile, parsePointerFile, replaceFileWithPointer } = await import("../../utils/lfsHelpers");
                        const { getCachedLfsBytes, setCachedLfsBytes } = await import("../../utils/mediaCache");
                        const { getMediaFilesStrategy: getStrategy } = await import("../../utils/localProjectSettings");

                        // Check if file is an LFS pointer
                        const isPointer = await isPointerFile(fullPath);

                        if (isPointer) {
                            // File is an LFS pointer - need to stream from LFS
                            debug("File is LFS pointer, streaming from server:", fullPath);

                            // Get media strategy
                            const mediaStrategy = await getStrategy(workspaceFolder.uri);

                            if (mediaStrategy === "auto-download") {
                                // This shouldn't happen in auto-download mode
                                throw new Error("File should have been downloaded in auto-download mode");
                            }

                            // Enforce version gates (Frontier required version + project metadata versions)
                            const { ensureAllVersionGatesForMedia } = await import("../../utils/versionGate");
                            const allowed = await ensureAllVersionGatesForMedia(true);
                            if (!allowed) {
                                throw new Error("Media operation blocked due to version requirements.");
                            }

                            // Parse pointer to get OID and size
                            const pointer = await parsePointerFile(fullPath);
                            if (!pointer) {
                                throw new Error("Invalid LFS pointer file format");
                            }

                            // Get frontier API
                            const { getAuthApi } = await import("../../extension");
                            const frontierApi = getAuthApi();
                            if (!frontierApi) {
                                throw new Error("Frontier authentication extension not available. Please ensure it's installed and active.");
                            }

                            // Download from LFS (with in-memory cache for stream-only)
                            let cachedData: Uint8Array | undefined;
                            if (mediaStrategy === "stream-only") {
                                cachedData = getCachedLfsBytes(pointer.oid);
                                if (cachedData) {
                                    debug("Using cached LFS bytes for stream-only audio");
                                }
                            }

                            if (cachedData) {
                                fileData = cachedData;
                            } else {
                                debug(`Downloading LFS file: OID=${pointer.oid.substring(0, 8)}..., size=${pointer.size}`);
                                const lfsData = await frontierApi.downloadLFSFile(
                                    workspaceFolder.uri.fsPath,
                                    pointer.oid,
                                    pointer.size
                                );
                                fileData = lfsData;
                                if (mediaStrategy === "stream-only") {
                                    setCachedLfsBytes(pointer.oid, lfsData);
                                }
                                debug("Successfully streamed file from LFS");
                            }

                            // Inform webview the audio is now available — but only if the
                            // attachment isn't deleted (deleted audio is played from history
                            // and shouldn't change cell-level availability).
                            if (!targetAttachment.isDeleted && mediaStrategy === "stream-only") {
                                try {
                                    safePostMessageToPanel(webviewPanel, {
                                        type: "providerSendsAudioAttachments",
                                        attachments: { [cellId]: "available-cached" as const }
                                    });
                                } catch { /* non-fatal */ }
                            }
                            if (mediaStrategy === "stream-and-save") {
                                try {
                                    await vscode.workspace.fs.writeFile(vscode.Uri.file(fullPath), fileData);
                                    debug("Saved streamed file to disk (stream-and-save mode)");
                                    if (!targetAttachment.isDeleted) {
                                        try {
                                            safePostMessageToPanel(webviewPanel, {
                                                type: "providerSendsAudioAttachments",
                                                attachments: { [cellId]: "available-local" as const }
                                            });
                                        } catch { /* non-fatal */ }
                                    }
                                } catch (saveError) {
                                    console.warn("Failed to save streamed file:", saveError);
                                }
                            }
                        } else {
                            // File is actual audio data - read normally
                            fileData = await vscode.workspace.fs.readFile(vscode.Uri.file(fullPath));
                            debug("Read audio file from disk:", fullPath);
                        }
                    } catch (lfsError) {
                        // LFS streaming failed - send error to webview
                        console.error("Error streaming audio file:", lfsError);
                        const errorMessage = lfsError instanceof Error ? lfsError.message : "Failed to load audio file";

                        safePostMessageToPanel(webviewPanel, {
                            type: "providerSendsAudioData",
                            content: {
                                cellId: cellId,
                                audioId: targetAttachmentId,
                                requestedAudioId: audioId || undefined,
                                audioData: null,
                                error: errorMessage,
                                transcription: targetAttachment.transcription || null
                            }
                        });

                        return;
                    }

                    // Resolution succeeded — repair a stale `isMissing=true`
                    // flag if one was lingering from a previous migration scan,
                    // so the next read of `getCurrentAttachment` reflects reality.
                    clearMissingFlagAfterSuccess(document, cellId, targetAttachmentId);

                    // Convert to base64 and send to webview
                    const base64Data = `data:${mimeType};base64,${Buffer.from(fileData).toString('base64')}`;

                    safePostMessageToPanel(webviewPanel, {
                        type: "providerSendsAudioData",
                        content: {
                            cellId: cellId,
                            audioId: targetAttachmentId,
                            requestedAudioId: audioId || undefined,
                            audioData: base64Data,
                            transcription: targetAttachment.transcription || null,
                            fileModified: fileStats.mtime,
                            createdBy: targetAttachment.createdBy || undefined,
                        }
                    });

                    debug("Sent audio data for cell:", cellId, "audioId:", targetAttachmentId, "modified:", fileStats.mtime);
                    return;
                } else {
                    debug("Audio file not found in files/ path:", fullPath);

                    // Attempt fallback: look for pointer under attachments/pointers and stream from LFS
                    try {
                        const filesPosix = toPosixPath(fullPath);
                        const pointerFullPath = filesPosix.includes("/.project/attachments/files/")
                            ? filesPosix.replace("/.project/attachments/files/", "/.project/attachments/pointers/")
                            : filesPosix.replace(".project/attachments/files/", ".project/attachments/pointers/");

                        // Check if pointer exists
                        let pointerStats: vscode.FileStat | undefined;
                        try {
                            pointerStats = await vscode.workspace.fs.stat(vscode.Uri.file(pointerFullPath));
                        } catch { /* no-op */ }

                        if (pointerStats) {
                            // Enforce version gates prior to fallback streaming
                            const { ensureAllVersionGatesForMedia } = await import("../../utils/versionGate");
                            const allowed = await ensureAllVersionGatesForMedia(true);
                            if (!allowed) {
                                throw new Error("Media operation blocked due to version requirements.");
                            }

                            // Parse pointer
                            const { parsePointerFile, replaceFileWithPointer } = await import("../../utils/lfsHelpers");
                            const { getCachedLfsBytes, setCachedLfsBytes } = await import("../../utils/mediaCache");
                            const pointer = await parsePointerFile(pointerFullPath);
                            if (!pointer) {
                                throw new Error("Invalid LFS pointer file format (fallback)");
                            }

                            // Get media strategy
                            const { getMediaFilesStrategy: getStrategy } = await import("../../utils/localProjectSettings");
                            const mediaStrategy = await getStrategy(workspaceFolder.uri);

                            // Download from LFS via Frontier API
                            const { getAuthApi } = await import("../../extension");
                            const frontierApi = getAuthApi();
                            if (!frontierApi) {
                                throw new Error("Frontier authentication extension not available");
                            }

                            let lfsData: Uint8Array;
                            if (mediaStrategy === "stream-only") {
                                const cachedData = getCachedLfsBytes(pointer.oid);
                                if (cachedData) {
                                    lfsData = cachedData;
                                    debug("Using cached LFS bytes for stream-only audio (fallback)");
                                } else {
                                    lfsData = await frontierApi.downloadLFSFile(
                                        workspaceFolder.uri.fsPath,
                                        pointer.oid,
                                        pointer.size
                                    );
                                    setCachedLfsBytes(pointer.oid, lfsData);
                                }
                            } else {
                                lfsData = await frontierApi.downloadLFSFile(
                                    workspaceFolder.uri.fsPath,
                                    pointer.oid,
                                    pointer.size
                                );
                            }

                            if (mediaStrategy === "stream-and-save" || mediaStrategy === "auto-download") {
                                // Persist the just-downloaded bytes to `files/<X>` so the
                                // next play of this cell reads from disk instead of
                                // hitting LFS again. For auto-download this also lets
                                // `reconcilePointersFilesystem` skip this OID when its
                                // worker reaches it (it checks `files/<X>` existence
                                // before issuing the HTTP request — see
                                // GitService.ts Phase 3 worker), so the background
                                // bulk-download doesn't redundantly re-fetch the same
                                // bytes we just fetched here.
                                try {
                                    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(fullPath)));
                                    await vscode.workspace.fs.writeFile(vscode.Uri.file(fullPath), lfsData);
                                    if (!targetAttachment.isDeleted) {
                                        try {
                                            safePostMessageToPanel(webviewPanel, {
                                                type: "providerSendsAudioAttachments",
                                                attachments: { [cellId]: "available-local" as const }
                                            });
                                        } catch { /* non-fatal */ }
                                    }
                                } catch (e) {
                                    console.warn("Failed to save streamed file in fallback:", e);
                                }
                            } else if (mediaStrategy === "stream-only") {
                                try {
                                    const relFromPointers = pointerFullPath.split("/.project/attachments/pointers/").pop() ||
                                        pointerFullPath.split(".project/attachments/pointers/").pop();
                                    if (relFromPointers) {
                                        await replaceFileWithPointer(workspaceFolder.uri.fsPath, relFromPointers);
                                    }
                                } catch (e) {
                                    // Non-fatal
                                }
                                if (!targetAttachment.isDeleted) {
                                    try {
                                        safePostMessageToPanel(webviewPanel, {
                                            type: "providerSendsAudioAttachments",
                                            attachments: { [cellId]: "available-cached" as const }
                                        });
                                    } catch { /* non-fatal */ }
                                }
                            }

                            // Resolution succeeded via the pointer fallback —
                            // repair any stale `isMissing=true` so the next
                            // pre-flight scan / audio history modal reflects
                            // reality without waiting for another migration.
                            clearMissingFlagAfterSuccess(document, cellId, targetAttachmentId);

                            // Send to webview
                            const ext = path.extname(fullPath).toLowerCase();
                            const mimeType = audioExtensionToMime(ext);
                            const base64Data = `data:${mimeType};base64,${Buffer.from(lfsData).toString('base64')}`;

                            safePostMessageToPanel(webviewPanel, {
                                type: "providerSendsAudioData",
                                content: {
                                    cellId: cellId,
                                    audioId: targetAttachmentId,
                                    requestedAudioId: audioId || undefined,
                                    audioData: base64Data,
                                    transcription: targetAttachment.transcription || null,
                                    fileModified: pointerStats.mtime,
                                    createdBy: targetAttachment.createdBy || undefined,
                                }
                            });

                            return;
                        }
                    } catch (fallbackErr) {
                        console.error("Fallback pointer streaming failed:", fallbackErr);
                    }
                }
            }

            // If no audio found and no specific audioId requested, send empty response
            if (!audioId) {
                safePostMessageToPanel(webviewPanel, {
                    type: "providerSendsAudioData",
                    content: {
                        cellId: cellId,
                        audioId: null,
                        requestedAudioId: audioId || undefined,
                        audioData: null
                    }
                });
                debug("No current audio attachment found for cell:", cellId);
                return;
            }
        } catch (error) {
            console.error("Error in requestAudioForCell:", error);
        }

        // If no attachment in metadata, check filesystem for legacy files
        const bookAbbr = getAttachmentDocumentSegmentFromUri(document.uri);
        const attachmentsFilesPath = path.join(
            workspaceFolder.uri.fsPath,
            ".project",
            "attachments",
            "files",
            bookAbbr
        );
        const legacyAttachmentsPath = path.join(
            workspaceFolder.uri.fsPath,
            ".project",
            "attachments",
            bookAbbr
        );

        const tryPaths = [attachmentsFilesPath, legacyAttachmentsPath];
        for (const attachmentsPath of tryPaths) {
            if (!(await pathExists(attachmentsPath))) continue;
            const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(attachmentsPath));
            const audioExtensions = ['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.webm', '.flac'];

            for (const [entryName, entryType] of files) {
                if (entryType !== vscode.FileType.File) continue;
                const audioFile = entryName;
                if (audioExtensions.some(ext => audioFile.toLowerCase().endsWith(ext))) {
                    const cellIdPattern = cellId.replace(/[:\s]/g, '_');
                    if (audioFile.includes(cellIdPattern) || audioFile.includes(cellId)) {
                        const fullPath = path.join(attachmentsPath, audioFile);

                        const fileData = await vscode.workspace.fs.readFile(vscode.Uri.file(fullPath));
                        const mimeType = audioExtensionToMime(path.extname(audioFile));
                        const base64Data = `data:${mimeType};base64,${Buffer.from(fileData).toString('base64')}`;

                        safePostMessageToPanel(webviewPanel, {
                            type: "providerSendsAudioData",
                            content: {
                                cellId: cellId,
                                audioId: audioFile.replace(/\.[^/.]+$/, ""),
                                requestedAudioId: audioId || undefined,
                                audioData: base64Data
                            }
                        });

                        debug("Sent legacy audio data for cell:", cellId);
                        return;
                    }
                }
            }
        }

        debug("No audio attachment found for cell:", cellId);

        // Always send a response, even if no audio is found
        safePostMessageToPanel(webviewPanel, {
            type: "providerSendsAudioData",
            content: {
                cellId: cellId,
                audioId: audioId || null,
                requestedAudioId: audioId || undefined,
                audioData: null
            }
        });
    },

    requestCellAudioTimestamps: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "requestCellAudioTimestamps"; }>;
        const cellId = typedEvent.content.cellId;

        try {
            const cell = document.getCellContent(cellId);
            if (!cell) {
                provider.postMessageToWebview(webviewPanel, {
                    type: "providerSendsCellAudioTimestamps",
                    content: {
                        cellId,
                        audioTimestamps: undefined,
                    },
                });
                return;
            }

            // Get audio timestamps from the cell
            const audioTimestamps = cell.audioTimestamps ??
                (cell.data?.audioStartTime !== undefined || cell.data?.audioEndTime !== undefined
                    ? {
                        startTime: cell.data.audioStartTime,
                        endTime: cell.data.audioEndTime,
                    }
                    : undefined);

            provider.postMessageToWebview(webviewPanel, {
                type: "providerSendsCellAudioTimestamps",
                content: {
                    cellId,
                    audioTimestamps,
                },
            });
        } catch (error) {
            console.error("Error fetching cell audio timestamps:", error);
            provider.postMessageToWebview(webviewPanel, {
                type: "providerSendsCellAudioTimestamps",
                content: {
                    cellId,
                    audioTimestamps: undefined,
                },
            });
        }
    },

    saveAudioAttachment: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "saveAudioAttachment"; }>;
        const requestId = typedEvent.requestId;
        debug("saveAudioAttachment message received", {
            cellId: typedEvent.content.cellId,
            audioId: typedEvent.content.audioId,
            fileExtension: typedEvent.content.fileExtension
        });

        // Prevent saving audio if cell is locked
        const cellId = typedEvent.content.cellId;
        const cell = document.getCell(cellId);
        if (cell?.metadata?.isLocked) {
            console.warn(`Attempted to save audio to locked cell ${cellId}. Operation blocked.`);
            provider.postMessageToWebview(webviewPanel, {
                type: "audioAttachmentSaved",
                content: {
                    cellId,
                    audioId: typedEvent.content.audioId,
                    requestId,
                    success: false,
                    savedToCodexFile: false,
                    error: `Cannot save audio: cell ${cellId} is locked`,
                },
            });
            return;
        }

        try {
            const documentSegment = getAttachmentDocumentSegmentFromUri(document.uri);
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
            if (!workspaceFolder) {
                throw new Error("No workspace folder found");
            }

            // Basic input validation and normalization
            const allowedExtensions = new Set(["webm", "wav", "mp3", "m4a", "ogg"]);
            const sanitizedAudioId = String(typedEvent.content.audioId).replace(/[^a-zA-Z0-9._-]/g, "-");
            const ext = (typedEvent.content.fileExtension || "webm").toLowerCase();
            const safeExt = allowedExtensions.has(ext) ? ext : "webm";

            const base64Data = typedEvent.content.audioData.split(',')[1] || typedEvent.content.audioData;
            const buffer = Buffer.from(base64Data, 'base64');

            if (!buffer || buffer.length === 0) {
                throw new Error("Decoded audio is empty");
            }
            // Enforce a reasonable max size (e.g., 50 MB) to avoid runaway writes
            const MAX_BYTES = 50 * 1024 * 1024;
            if (buffer.length > MAX_BYTES) {
                throw new Error("Audio exceeds maximum allowed size (50 MB)");
            }

            const pointersDir = path.join(
                workspaceFolder.uri.fsPath,
                ".project",
                "attachments",
                "pointers",
                documentSegment
            );
            const filesDir = path.join(
                workspaceFolder.uri.fsPath,
                ".project",
                "attachments",
                "files",
                documentSegment
            );

            await vscode.workspace.fs.createDirectory(vscode.Uri.file(pointersDir));
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(filesDir));

            const fileName = `${sanitizedAudioId}.${safeExt}`;
            const pointersPath = path.join(pointersDir, fileName);
            const filesPath = path.join(filesDir, fileName);

            // Atomic write helper (write to temp then rename)
            const writeFileAtomically = async (finalFsPath: string, data: Uint8Array): Promise<void> => {
                const tmpPath = `${finalFsPath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                const tmpUri = vscode.Uri.file(tmpPath);
                const finalUri = vscode.Uri.file(finalFsPath);
                await vscode.workspace.fs.writeFile(tmpUri, data);
                await vscode.workspace.fs.rename(tmpUri, finalUri, { overwrite: true });
                // Optional sanity check to ensure size matches
                try {
                    const stat = await vscode.workspace.fs.stat(finalUri);
                    if (typeof stat.size === 'number' && stat.size !== data.length) {
                        console.warn("Size mismatch after write for", finalFsPath, { expected: data.length, actual: stat.size });
                    }
                } catch {
                    // ignore stat issues
                }
            };

            // Write actual file (primary). Pointer write is best-effort.
            await writeFileAtomically(filesPath, buffer);
            try {
                await writeFileAtomically(pointersPath, buffer);
            } catch (pointerErr) {
                console.warn("Pointer write failed; proceeding with saved file only", pointerErr);
            }

            // Store the files path in metadata (not the pointer path) so we can directly read the actual file
            const relativePath = toPosixPath(path.relative(workspaceFolder.uri.fsPath, filesPath));

            // Get current username for createdBy field
            let createdBy: string = "anonymous";
            try {
                const authApi = await provider.getAuthApi();
                const userInfo = await authApi?.getUserInfo();
                if (userInfo?.username) {
                    createdBy = userInfo.username;
                }
            } catch (error) {
                console.warn("Failed to get username for audio attachment:", error);
            }

            await document.updateCellAttachment(typedEvent.content.cellId, sanitizedAudioId, {
                url: relativePath,
                type: "audio",
                createdAt: Date.now(),
                updatedAt: Date.now(),
                isDeleted: false,
                createdBy: createdBy,
                // Persist optional metadata if provided by client
                ...(typedEvent.content.metadata ? { metadata: typedEvent.content.metadata } : {}),
            } as any);

            // Persist metadata update to the .codex/.source file before we show "saved" in the webview.
            await provider.saveCustomDocument(document, new vscode.CancellationTokenSource().token);

            provider.postMessageToWebview(webviewPanel, {
                type: "audioAttachmentSaved",
                content: {
                    cellId: typedEvent.content.cellId,
                    audioId: sanitizedAudioId,
                    requestId,
                    success: true,
                    savedToCodexFile: true,
                },
            });

            // Send targeted audio attachment update instead of full refresh to preserve tab state
            const documentText = document.getText();
            let notebookData: any = {};
            if (documentText.trim().length > 0) {
                try {
                    notebookData = JSON.parse(documentText);
                } catch {
                    debug("Could not parse document as JSON for audio attachment update");
                    notebookData = {};
                }
            }
            const cells = Array.isArray(notebookData?.cells) ? notebookData.cells : [];
            const availability: { [cellId: string]: "available" | "available-local" | "available-pointer" | "missing" | "deletedOnly" | "none"; } = {} as any;

            for (const cell of cells) {
                const cellId = cell?.metadata?.id;
                if (!cellId) continue;
                let hasAvailable = false;
                let hasAvailablePointer = false;
                let hasMissing = false;
                let hasDeleted = false;
                const atts = cell?.metadata?.attachments || {};
                for (const key of Object.keys(atts)) {
                    const att: any = (atts as any)[key];
                    if (att && att.type === "audio") {
                        if (att.isDeleted) {
                            hasDeleted = true;
                        } else if (att.isMissing) {
                            hasMissing = true;
                        } else {
                            try {
                                const url = String(att.url || "");
                                if (url) {
                                    const filesRel = url.startsWith(".project/") ? url : url.replace(/^\.?\/?/, "");
                                    const filesAbs = path.join(workspaceFolder.uri.fsPath, filesRel);
                                    try {
                                        // files/ is authoritative when present: a pointer stub →
                                        // not downloaded, real bytes → downloaded.
                                        await vscode.workspace.fs.stat(vscode.Uri.file(filesAbs));
                                        const { isPointerFile } = await import("../../utils/lfsHelpers");
                                        const isPtr = await isPointerFile(filesAbs).catch(() => false);
                                        if (isPtr) hasAvailablePointer = true; else hasAvailable = true;
                                    } catch {
                                        // files/ absent — fall back to pointers/ (undownloaded media).
                                        // Swap files/→pointers/ on a POSIX-normalized path so this
                                        // works on Windows too (path.join yields backslashes, which
                                        // never match a hardcoded forward-slash needle).
                                        const filesPosix = toPosixPath(filesAbs);
                                        const pointerAbs = filesPosix.includes("/.project/attachments/files/")
                                            ? filesPosix.replace("/.project/attachments/files/", "/.project/attachments/pointers/")
                                            : filesPosix.replace(".project/attachments/files/", ".project/attachments/pointers/");
                                        try {
                                            await vscode.workspace.fs.stat(vscode.Uri.file(pointerAbs));
                                            hasAvailablePointer = true;
                                        } catch {
                                            hasMissing = true;
                                        }
                                    }
                                } else {
                                    hasMissing = true;
                                }
                            } catch { hasMissing = true; }
                        }
                    }
                }
                const selectedId = cell?.metadata?.selectedAudioId;
                const selectedAtt = selectedId ? (atts as any)[selectedId] : undefined;
                const selectedIsMissing = selectedAtt?.type === "audio" && selectedAtt?.isMissing === true;

                // Provisional state — prefer showing available when a valid file exists,
                // even if the user's explicit selection points to a missing file.
                let state: "available" | "available-local" | "available-pointer" | "missing" | "deletedOnly" | "none";
                if (hasAvailable) state = "available-local";
                else if (hasAvailablePointer) state = "available-pointer";
                else if (selectedIsMissing || hasMissing) state = "missing";
                else if (hasDeleted) state = "deletedOnly";
                else state = "none";

                if (state !== "available-local") {
                    try {
                        const { getFrontierVersionStatus } = await import("../../projectManager/utils/versionChecks");
                        const status = await getFrontierVersionStatus();
                        if (!status.ok) {
                            if (state !== "missing" && state !== "deletedOnly" && state !== "none") {
                                state = "available-pointer";
                            }
                        }
                    } catch { /* ignore */ }
                }

                availability[cellId] = state as any;
            }

            provider.postMessageToWebview(webviewPanel, {
                type: "providerSendsAudioAttachments",
                attachments: availability as any,
            });

            debug("Audio attachment saved successfully:", { pointersPath, filesPath });

            // Proactively send the audio data so the editor waveform loads immediately after save
            // If immediate disk read fails (e.g., Windows rename latency), fall back to in-memory buffer
            {
                const absPath = path.isAbsolute(filesPath) ? filesPath : path.join(workspaceFolder.uri.fsPath, filesPath);
                const extNow = path.extname(absPath).toLowerCase();
                const mimeNow = audioExtensionToMime(extNow);

                let base64Now: string | null = null;
                try {
                    const bytesNow = await vscode.workspace.fs.readFile(vscode.Uri.file(absPath));
                    base64Now = `data:${mimeNow};base64,${Buffer.from(bytesNow).toString('base64')}`;
                } catch (e) {
                    console.warn("Failed to read freshly saved audio from disk; falling back to buffer", e);
                    try {
                        base64Now = `data:${mimeNow};base64,${Buffer.from(buffer).toString('base64')}`;
                    } catch (fallbackErr) {
                        console.warn("Fallback to in-memory buffer failed", fallbackErr);
                    }
                }

                if (typeof base64Now === 'string') {
                    safePostMessageToPanel(webviewPanel, {
                        type: "providerSendsAudioData",
                        content: {
                            cellId: typedEvent.content.cellId,
                            audioId: sanitizedAudioId,
                            audioData: base64Now,
                            fileModified: Date.now(),
                            createdBy,
                        }
                    } as any);
                }
            }
        } catch (error) {
            console.error("Error saving audio attachment:", error);
            provider.postMessageToWebview(webviewPanel, {
                type: "audioAttachmentSaved",
                content: {
                    cellId: typedEvent.content.cellId,
                    audioId: typedEvent.content.audioId,
                    requestId,
                    success: false,
                    savedToCodexFile: false,
                    error: error instanceof Error ? error.message : String(error)
                }
            });
        }
    },

    deleteAudioAttachment: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "deleteAudioAttachment"; }>;


        // Soft delete the attachment (set isDeleted: true) instead of hard deleting files
        await document.softDeleteCellAttachment(typedEvent.content.cellId, typedEvent.content.audioId);

        const cellId = typedEvent.content.cellId;

        // Compute availability once and include in both messages
        const explicitSelection = document.getExplicitAudioSelection(cellId);
        let updatedState: string;
        if (explicitSelection) {
            updatedState = "available-local";
        } else {
            const history = document.getAttachmentHistory(cellId, "audio");
            const hasNonDeleted = history.some((h: any) => !h.attachment?.isDeleted);
            updatedState = hasNonDeleted ? "unselected" : (history.length > 0 ? "deletedOnly" : "none");
        }

        provider.postMessageToWebview(webviewPanel, {
            type: "audioAttachmentDeleted",
            content: {
                cellId,
                audioId: typedEvent.content.audioId,
                success: true,
                updatedAvailability: updatedState
            }
        });

        safePostMessageToPanel(webviewPanel, {
            type: "providerSendsAudioAttachments",
            attachments: { [cellId]: updatedState }
        });

        debug("Audio attachment soft deleted successfully");
    },

    getAudioHistory: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "getAudioHistory"; }>;

        const audioHistory = document.getAttachmentHistory(typedEvent.content.cellId, "audio") || [];
        const explicitSelection = document.getExplicitAudioSelection(typedEvent.content.cellId);

        // A dangling explicit selection (id not present in attachments, or pointing to a
        // deleted/non-audio attachment) is treated as "nothing selected" for the viewer.
        // `selectedAudioId` is never auto-mutated on disk — this is a read-side UI decision
        // that matches `deriveAudioAvailability` and `resolveSelectedAttachmentState`.
        const resolves = !!explicitSelection && audioHistory.some(
            (e) => e.attachmentId === explicitSelection && !e.attachment?.isDeleted
        );
        const currentAttachmentId = resolves ? explicitSelection : null;
        const hasExplicitSelection = resolves;

        // Compute per-entry availability so the history viewer shows correct Play/Download.
        // Each probe is an independent fs.stat — run them in parallel so total latency
        // is ~one stat instead of N.  Order doesn't matter; the result is keyed by id.
        const entryAvailability: Record<string, string> = {};
        try {
            const ws = vscode.workspace.getWorkspaceFolder(document.uri);
            if (ws) {
                const wsPath = ws.uri.fsPath;
                const pairs = await Promise.all(
                    audioHistory.map(async (entry) =>
                        [
                            entry.attachmentId,
                            await checkAttachmentAvailabilityStandalone(
                                entry.attachment as any, wsPath, true
                            ),
                        ] as const
                    )
                );
                for (const [id, state] of pairs) entryAvailability[id] = state;
            }
        } catch { /* best-effort */ }

        provider.postMessageToWebview(webviewPanel, {
            type: "audioHistoryReceived",
            content: {
                cellId: typedEvent.content.cellId,
                audioHistory: audioHistory,
                currentAttachmentId,
                hasExplicitSelection,
                entryAvailability,
            }
        });

        debug("Audio history sent successfully:", { cellId: typedEvent.content.cellId, count: audioHistory.length, currentId: currentAttachmentId });
    },

    restoreAudioAttachment: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "restoreAudioAttachment"; }>;
        debug("restoreAudioAttachment message received", {
            cellId: typedEvent.content.cellId,
            audioId: typedEvent.content.audioId
        });

        await document.restoreCellAttachment(typedEvent.content.cellId, typedEvent.content.audioId);

        const cellId = typedEvent.content.cellId;

        let updatedState: string = "unselected";
        try {
            const documentText = document.getText();
            const notebookData = documentText.trim().length > 0 ? JSON.parse(documentText) : {};
            const cells = Array.isArray(notebookData?.cells) ? notebookData.cells : [];
            const targetCell = cells.find((c: any) => c?.metadata?.id === cellId);
            if (targetCell) {
                const ws = vscode.workspace.getWorkspaceFolder(document.uri);
                if (ws) {
                    updatedState = await resolveSelectedAttachmentState(
                        targetCell, "available-local", ws.uri.fsPath
                    );
                }
            }
        } catch { /* best-effort — falls back to "unselected" */ }

        provider.postMessageToWebview(webviewPanel, {
            type: "audioAttachmentRestored",
            content: {
                cellId,
                audioId: typedEvent.content.audioId,
                success: true,
                updatedAvailability: updatedState
            }
        });

        safePostMessageToPanel(webviewPanel, {
            type: "providerSendsAudioAttachments",
            attachments: { [cellId]: updatedState }
        });

        debug("Audio attachment restored successfully");
    },

    selectAudioAttachment: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "selectAudioAttachment"; }>;
        debug("selectAudioAttachment message received", {
            cellId: typedEvent.content.cellId,
            audioId: typedEvent.content.audioId
        });

        try {
            await document.selectAudioAttachment(typedEvent.content.cellId, typedEvent.content.audioId);

            const documentText = document.getText();
            let notebookData: any = {};
            if (documentText.trim().length > 0) {
                try {
                    notebookData = JSON.parse(documentText);
                } catch {
                    debug("Could not parse document as JSON for audio attachment update");
                    notebookData = {};
                }
            }
            const cells = Array.isArray(notebookData?.cells) ? notebookData.cells : [];

            // Compute targeted availability for the affected cell. Derive a base
            // state from in-memory metadata first (no FS access required) so the
            // broadcast is always meaningful even when no workspace folder is
            // resolvable (e.g. test environments). Then refine with FS probes
            // (LFS pointer / cache) when a workspace is available.
            const targetCell = cells.find((c: any) => c?.metadata?.id === typedEvent.content.cellId);
            const selectedAtt: any = targetCell?.metadata?.attachments?.[typedEvent.content.audioId];

            let quickState: string;
            if (selectedAtt?.type === "audio" && selectedAtt?.isMissing) {
                quickState = "missing";
            } else if (selectedAtt?.type === "audio" && !selectedAtt?.isDeleted) {
                quickState = "available-local";
            } else {
                const atts = (targetCell?.metadata?.attachments || {}) as Record<string, any>;
                const hasUsable = Object.values(atts).some(
                    (a: any) => a?.type === "audio" && !a.isDeleted && !a.isMissing
                );
                quickState = hasUsable ? "unselected" : "none";
            }

            try {
                if (targetCell) {
                    const ws = vscode.workspace.getWorkspaceFolder(document.uri);
                    if (ws) {
                        quickState = await resolveSelectedAttachmentState(
                            targetCell, quickState, ws.uri.fsPath
                        );
                    }
                }
            } catch { /* keep in-memory base state */ }

            // Per-cell monotonic version stamp set by `document.selectAudioAttachment`.
            // The webview uses it to discard out-of-order updates so a slow/stale
            // broadcast cannot overwrite a fresher selection.
            const selectionTimestamp = document.getSelectionTimestamp(typedEvent.content.cellId);

            provider.postMessageToWebview(webviewPanel, {
                type: "audioAttachmentSelected",
                content: {
                    cellId: typedEvent.content.cellId,
                    audioId: typedEvent.content.audioId,
                    success: true,
                    updatedAvailability: quickState,
                    selectionTimestamp,
                }
            });

            provider.postMessageToWebview(webviewPanel, {
                type: "providerSendsAudioAttachments",
                attachments: { [typedEvent.content.cellId]: quickState } as any,
            });

            // Read validators directly off the targeted attachment. The previous
            // implementation iterated every cell in the chapter with `await isPointerFile`
            // probes, which suspended this handler long enough for a deselect to interleave
            // and made the broadcast below leak a stale `selectedAudioId` captured from the
            // closure. A single-cell read keeps the broadcast burst contiguous and removes
            // N file-system probes per select.
            const validatedByArray: ValidationEntry[] = Array.isArray(selectedAtt?.validatedBy)
                ? [...selectedAtt.validatedBy]
                : [];

            provider.postMessageToWebview(webviewPanel, {
                type: "providerUpdatesAudioValidationState",
                content: {
                    cellId: typedEvent.content.cellId,
                    selectedAudioId: typedEvent.content.audioId,
                    validatedBy: validatedByArray,
                    selectionTimestamp,
                },
            });

            await document.save(new vscode.CancellationTokenSource().token);

            debug("Audio attachment selected successfully");
        } catch (error) {
            console.error("Error selecting audio attachment:", error);
            provider.postMessageToWebview(webviewPanel, {
                type: "audioAttachmentSelected",
                content: {
                    cellId: typedEvent.content.cellId,
                    audioId: typedEvent.content.audioId,
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                }
            });
        }
    },

    deselectAudioAttachment: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "deselectAudioAttachment"; }>;
        const cellId = typedEvent.content.cellId;
        debug("deselectAudioAttachment message received", { cellId });

        try {
            document.clearAudioSelection(cellId);

            // Per-cell monotonic version stamp set by `document.clearAudioSelection`.
            // See `selectAudioAttachment` for usage rationale.
            const selectionTimestamp = document.getSelectionTimestamp(cellId);

            const history = document.getAttachmentHistory(cellId, "audio");
            const hasUsable = history.some((h: any) => !h.attachment?.isDeleted && !h.attachment?.isMissing);
            const hasMissing = history.some((h: any) => h.attachment?.isMissing && !h.attachment?.isDeleted);
            const hasDeleted = history.some((h: any) => h.attachment?.isDeleted);
            const updatedState = hasUsable
                ? "unselected"
                : hasMissing
                    ? "missing"
                    : hasDeleted
                        ? "unselected"
                        : "none";

            provider.postMessageToWebview(webviewPanel, {
                type: "audioAttachmentSelected",
                content: { cellId, audioId: null, success: true, updatedAvailability: updatedState, selectionTimestamp }
            });

            safePostMessageToPanel(webviewPanel, {
                type: "providerSendsAudioAttachments",
                attachments: { [cellId]: updatedState }
            });

            // Per-attachment-selected rule: with no selection, the cell has no
            // current validators. Broadcast the cleared state so the cell-list
            // AudioValidationButton refreshes immediately rather than waiting
            // for the document re-broadcast to arrive.
            provider.postMessageToWebview(webviewPanel, {
                type: "providerUpdatesAudioValidationState",
                content: {
                    cellId,
                    selectedAudioId: "",
                    validatedBy: [],
                    selectionTimestamp,
                },
            });

            await document.save(new vscode.CancellationTokenSource().token);
            debug("Audio attachment deselected successfully");
        } catch (error) {
            console.error("Error deselecting audio attachment:", error);
        }
    },

    confirmCellMerge: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "confirmCellMerge"; }>;
        const { currentCellId, previousCellId, currentContent, previousContent } = typedEvent.content;

        debug("confirmCellMerge message received for cells:", { currentCellId, previousCellId });

        try {
            // Check if we're working with a source file and need to check for child cells
            const isSourceFile = document.uri.toString().includes(".source");

            if (isSourceFile) {
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
                if (!workspaceFolder) {
                    throw new Error("No workspace folder found");
                }

                // Check for child cells in the target that correspond to the cells being merged
                const cellsToCheck = [currentCellId, previousCellId];
                const childCells = await provider.checkForChildCellsInTarget(cellsToCheck, workspaceFolder);

                if (childCells.length > 0) {
                    // Child cells exist - prevent the merge
                    const childCellsList = childCells.map(id => `• ${id}`).join('\n');
                    const errorMessage = `Cannot merge source cells because the following child cells exist in the target file:\n\n${childCellsList}\n\nPlease remove or delete these child cells first before merging the source cells.`;

                    vscode.window.showErrorMessage(errorMessage, { modal: true });
                    return; // Exit early, don't proceed with merge
                }
            }

            // No child cells found. Confirmation already happened in the webview modal, so
            // proceed directly with the merge.
            const mergeEvent: EditorPostMessages = {
                command: "mergeCellWithPrevious" as const,
                content: {
                    currentCellId,
                    previousCellId,
                    currentContent,
                    previousContent
                }
            };

            // Call the existing merge handler
            await messageHandlers.mergeCellWithPrevious({
                event: mergeEvent,
                document,
                webviewPanel,
                provider,
                updateWebview: () => {
                    provider.refreshWebview(webviewPanel, document);
                }
            });

            // Only merge in target if we're working with a source file
            if (isSourceFile) {
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
                if (!workspaceFolder) {
                    throw new Error("No workspace folder found");
                }
                await provider.mergeMatchingCellsInTargetFile(currentCellId, previousCellId, document.uri.toString(), workspaceFolder);
            }
        } catch (error) {
            console.error("Error in confirmCellMerge:", error);
            vscode.window.showErrorMessage(
                `Failed to confirm cell merge: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    },

    mergeCellWithPrevious: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "mergeCellWithPrevious"; }>;
        const { currentCellId, previousCellId, currentContent, previousContent } = typedEvent.content;

        try {
            // Get all cell IDs to find the indices
            const allCellIds = document.getAllCellIds();
            const previousCellIndex = allCellIds.findIndex(id => id === previousCellId);
            const currentCellIndex = allCellIds.findIndex(id => id === currentCellId);

            if (previousCellIndex === -1 || currentCellIndex === -1) {
                console.error("Could not find cells for merge operation");
                vscode.window.showErrorMessage("Could not find cells for merge operation");
                return;
            }

            // Get the actual cell objects
            const previousCell = document.getCell(previousCellId);
            const currentCell = document.getCell(currentCellId);

            if (!previousCell || !currentCell) {
                console.error("Could not retrieve cell objects for merge operation");
                vscode.window.showErrorMessage("Could not retrieve cell objects for merge operation");
                return;
            }

            // Get workspace folder for audio file operations
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);

            // Get current user using the provider's auth API
            let currentUser = "anonymous";
            try {
                const authApi = await provider.getAuthApi();
                const userInfo = await authApi?.getUserInfo();
                currentUser = userInfo?.username || "anonymous";
            } catch (error) {
                console.warn("Could not get user info for merge operation, using 'anonymous':", error);
            }

            const timestamp = Date.now();

            // Get existing edit history or create new one
            const existingEdits = previousCell.metadata?.edits || [];

            // Ensure an INITIAL_IMPORT exists for previous cell value if missing
            if (existingEdits.length === 0 && previousCell.value) {
                existingEdits.push({
                    editMap: EditMapUtils.value(),
                    value: previousCell.value,
                    timestamp: timestamp,
                    type: EditType.INITIAL_IMPORT,
                    author: currentUser,
                    validatedBy: []
                } as any);
            }

            // 1. Concatenate content and create merged edit
            const mergedContent = previousContent + "<span>&nbsp;</span>" + currentContent;
            const mergeEdit: EditHistory = {
                editMap: EditMapUtils.value(),
                value: mergedContent,
                timestamp: timestamp + 1,
                type: EditType.USER_EDIT,
                author: currentUser,
                validatedBy: []
            };

            // 3. Merge cell labels with a hyphen
            const previousLabel = previousCell.metadata?.cellLabel || "";
            const currentLabel = currentCell.metadata?.cellLabel || "";
            let mergedLabel = "";

            if (previousLabel && currentLabel) {
                mergedLabel = `${previousLabel}-${currentLabel}`;
            } else if (previousLabel) {
                mergedLabel = previousLabel;
            } else if (currentLabel) {
                mergedLabel = currentLabel;
            }

            // Update the previous cell content and edit history directly
            // Since this is a merge operation in source files, we need to bypass normal restrictions
            const updatedEdits = [...existingEdits, mergeEdit];

            // Update the previous cell content and metadata directly
            previousCell.value = mergedContent;
            if (!previousCell.metadata.edits) {
                previousCell.metadata.edits = [];
            }
            previousCell.metadata.edits = updatedEdits;

            // Update the merged cell label
            if (mergedLabel) {
                previousCell.metadata.cellLabel = mergedLabel;
            }

            // 4. Merge time ranges if both cells have timing data
            const previousData = previousCell.metadata?.data;
            const currentData = currentCell.metadata?.data;

            if (previousData?.startTime !== undefined && currentData?.endTime !== undefined) {
                // Take startTime from previous cell and endTime from current cell
                const mergedStartTime = previousData.startTime;
                const mergedEndTime = currentData.endTime;

                // Update the previous cell's time range
                if (!previousCell.metadata.data) {
                    previousCell.metadata.data = {};
                }

                previousCell.metadata.data = {
                    ...previousCell.metadata.data,
                    startTime: mergedStartTime,
                    endTime: mergedEndTime
                };
            }

            // 5. Merge audio files if both cells have audio attachments
            if (workspaceFolder) {
                try {
                    // Get current attachments - read directly from previousCell to ensure we have the latest state
                    // This is important because previousCell may have been modified in a previous merge operation
                    let previousAttachment: { attachmentId: string; attachment: any; } | null = null;

                    // Check if previousCell has a selectedAudioId, otherwise get the latest attachment
                    if (previousCell.metadata?.selectedAudioId && previousCell.metadata?.attachments) {
                        const selectedId = previousCell.metadata.selectedAudioId;
                        const selectedAtt = previousCell.metadata.attachments[selectedId];
                        if (selectedAtt && selectedAtt.type === "audio" && !selectedAtt.isDeleted) {
                            previousAttachment = { attachmentId: selectedId, attachment: selectedAtt };
                            debug(`[mergeCellWithPrevious] Using selected audio attachment: ${selectedId} for cell ${previousCellId}`);
                        }
                    }

                    // Fallback to latest non-deleted attachment if no explicit selection
                    if (!previousAttachment && previousCell.metadata?.attachments) {
                        const attachments = Object.entries(previousCell.metadata.attachments)
                            .filter(([_, att]: [string, any]) =>
                                att && att.type === "audio" && !att.isDeleted
                            )
                            .sort(([_, a]: [string, any], [__, b]: [string, any]) =>
                                (b.updatedAt || 0) - (a.updatedAt || 0)
                            );
                        if (attachments.length > 0) {
                            const [attachmentId, attachment] = attachments[0];
                            previousAttachment = { attachmentId, attachment };
                            debug(`[mergeCellWithPrevious] Using latest audio attachment: ${attachmentId} (updatedAt: ${attachment.updatedAt}) for cell ${previousCellId}`);
                        }
                    }

                    // Get current cell's attachment using getCurrentAttachment (this should be fine for current cell)
                    const currentAttachment = document.getCurrentAttachment(currentCellId, "audio");

                    // Resolve file paths from attachment URLs
                    let previousAudioPath: string | null = null;
                    let currentAudioPath: string | null = null;

                    if (previousAttachment?.attachment?.url) {
                        const attachmentPath = toPosixPath(previousAttachment.attachment.url);
                        previousAudioPath = path.isAbsolute(attachmentPath)
                            ? attachmentPath
                            : path.join(workspaceFolder.uri.fsPath, attachmentPath);
                        // Verify file exists
                        if (!(await pathExists(previousAudioPath))) {
                            previousAudioPath = null;
                        }
                    }

                    if (currentAttachment?.attachment?.url) {
                        const attachmentPath = toPosixPath(currentAttachment.attachment.url);
                        currentAudioPath = path.isAbsolute(attachmentPath)
                            ? attachmentPath
                            : path.join(workspaceFolder.uri.fsPath, attachmentPath);
                        // Verify file exists
                        if (!(await pathExists(currentAudioPath))) {
                            currentAudioPath = null;
                        }
                    }

                    if (previousAudioPath && currentAudioPath) {
                        // Both cells have audio - merge them
                        debug(`[mergeCellWithPrevious] Merging audio files: ${previousAudioPath} + ${currentAudioPath}`);

                        // Determine output filename using previous cell's globalReferences or ID
                        // Try to get cell from document to access globalReferences
                        let bookAbbr = "";
                        let basename = "";

                        try {
                            const previousCell = (document as any)._documentData?.cells?.find((c: any) => c.metadata?.id === previousCellId);
                            const globalRefs = previousCell?.metadata?.data?.globalReferences;

                            if (globalRefs && Array.isArray(globalRefs) && globalRefs.length > 0) {
                                const firstRef = globalRefs[0];
                                const bookMatch = firstRef.match(/^([^\s]+)/);
                                if (bookMatch) {
                                    bookAbbr = bookMatch[1];
                                }

                                // Parse for basename
                                const parseCellIdToBookChapterVerse = (refId: string): { book: string; chapter?: number; verse?: number; } => {
                                    try {
                                        const [book, rest] = refId.split(" ");
                                        const [chapterStr, verseStr] = (rest || "").split(":");
                                        let chapter: number | undefined = chapterStr ? Number(chapterStr) : undefined;
                                        let verse: number | undefined = verseStr ? Number(verseStr) : undefined;
                                        if (chapter !== undefined && !Number.isFinite(chapter)) chapter = undefined;
                                        if (verse !== undefined && !Number.isFinite(verse)) verse = undefined;
                                        return { book: (book || "").toUpperCase(), chapter, verse };
                                    } catch {
                                        return { book: "", chapter: undefined, verse: undefined };
                                    }
                                };

                                const toBookChapterVerseBasename = (refId: string): string => {
                                    const { book, chapter, verse } = parseCellIdToBookChapterVerse(refId);
                                    const safePad = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? String(n) : "0").padStart(3, "0");
                                    const chapStr = safePad(chapter);
                                    const verseStr = safePad(verse);
                                    const sanitizeFileComponent = (input: string): string => {
                                        return input
                                            .replace(/\s+/g, "_")
                                            .replace(/[^a-zA-Z0-9._-]/g, "-")
                                            .replace(/_+/g, "_");
                                    };
                                    return sanitizeFileComponent(`${book}_${chapStr}_${verseStr}`);
                                };

                                basename = toBookChapterVerseBasename(firstRef);
                            }
                        } catch (e) {
                            // Fall through to legacy parsing
                        }

                        // Fallback to legacy parsing if globalReferences not available
                        if (!bookAbbr) {
                            bookAbbr = getAttachmentDocumentSegmentFromUri(document.uri);
                        }
                        if (!basename) {
                            const parseCellIdToBookChapterVerse = (cellId: string): { book: string; chapter?: number; verse?: number; } => {
                                try {
                                    const [book, rest] = cellId.split(" ");
                                    const [chapterStr, verseStr] = (rest || "").split(":");
                                    let chapter: number | undefined = chapterStr ? Number(chapterStr) : undefined;
                                    let verse: number | undefined = verseStr ? Number(verseStr) : undefined;
                                    if (chapter !== undefined && !Number.isFinite(chapter)) chapter = undefined;
                                    if (verse !== undefined && !Number.isFinite(verse)) verse = undefined;
                                    return { book: (book || "").toUpperCase(), chapter, verse };
                                } catch {
                                    return { book: "", chapter: undefined, verse: undefined };
                                }
                            };

                            const toBookChapterVerseBasename = (cellId: string): string => {
                                const { book, chapter, verse } = parseCellIdToBookChapterVerse(cellId);
                                const safePad = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? String(n) : "0").padStart(3, "0");
                                const chapStr = safePad(chapter);
                                const verseStr = safePad(verse);
                                const sanitizeFileComponent = (input: string): string => {
                                    return input
                                        .replace(/\s+/g, "_")
                                        .replace(/[^a-zA-Z0-9._-]/g, "-")
                                        .replace(/_+/g, "_");
                                };
                                return sanitizeFileComponent(`${book}_${chapStr}_${verseStr}`);
                            };

                            basename = toBookChapterVerseBasename(previousCellId);
                        }
                        const ext = path.extname(previousAudioPath) || path.extname(currentAudioPath) || '.wav';
                        const outputFilename = `${basename}${ext}`;

                        // Try attachments/files first, then legacy attachments
                        const attachmentsFilesPath = path.join(
                            workspaceFolder.uri.fsPath,
                            ".project",
                            "attachments",
                            "files",
                            bookAbbr
                        );
                        const legacyAttachmentsPath = path.join(
                            workspaceFolder.uri.fsPath,
                            ".project",
                            "attachments",
                            bookAbbr
                        );

                        let outputDir = attachmentsFilesPath;
                        if (!(await pathExists(attachmentsFilesPath))) {
                            outputDir = legacyAttachmentsPath;
                        }

                        let outputPath = path.join(outputDir, outputFilename);

                        // Normalize paths for comparison (resolve to absolute and normalize separators)
                        const normalizedOutputPath = path.resolve(outputPath);
                        const normalizedPreviousPath = path.resolve(previousAudioPath);

                        // CRITICAL: If outputPath is the same as previousAudioPath, use a temporary path first
                        // to avoid overwriting the input file during merge (which can cause corruption)
                        let tempOutputPath: string | null = null;
                        const finalOutputPath = outputPath;
                        if (normalizedOutputPath === normalizedPreviousPath) {
                            // Use a temp filename that preserves the extension but adds timestamp before it
                            const ext = path.extname(outputFilename);
                            const basenameWithoutExt = path.basename(outputFilename, ext);
                            tempOutputPath = path.join(outputDir, `${basenameWithoutExt}_tmp_${timestamp}${ext}`);
                            outputPath = tempOutputPath;
                            debug(`[mergeCellWithPrevious] WARNING: Output path matches input path, using temporary path: ${tempOutputPath}`);
                        }

                        // Merge audio files using FFmpeg
                        const mergedAudioPath = await mergeAudioFiles(previousAudioPath, currentAudioPath, outputPath);

                        // If we used a temp path and merge succeeded, move it to the final location
                        if (tempOutputPath && mergedAudioPath && mergedAudioPath === tempOutputPath) {
                            try {
                                // Verify temp file exists before moving
                                if (!(await pathExists(tempOutputPath))) {
                                    console.error(`[mergeCellWithPrevious] ERROR: Temp file does not exist: ${tempOutputPath}`);
                                    // Don't throw - just log and continue with temp path
                                } else {
                                    // Remove old file if it exists
                                    if (await pathExists(finalOutputPath)) {
                                        await vscode.workspace.fs.delete(vscode.Uri.file(finalOutputPath));
                                    }

                                    // Move temp file to final location
                                    await vscode.workspace.fs.rename(
                                        vscode.Uri.file(tempOutputPath),
                                        vscode.Uri.file(finalOutputPath),
                                        { overwrite: true }
                                    );
                                    debug(`[mergeCellWithPrevious] Successfully moved temporary file to final location: ${finalOutputPath}`);

                                    // Verify final file exists
                                    if (!(await pathExists(finalOutputPath))) {
                                        console.error(`[mergeCellWithPrevious] ERROR: Final file does not exist after move: ${finalOutputPath}`);
                                        // Don't throw - file might still be at temp path
                                    }
                                }
                            } catch (moveError) {
                                console.error(`[mergeCellWithPrevious] Failed to move temp file to final location:`, moveError);
                                // If move fails, log error but don't throw - the merge succeeded, just in wrong location
                                // The file is still usable at tempOutputPath
                            }
                        }

                        if (mergedAudioPath) {
                            // Create/update attachment metadata in previous cell
                            if (!previousCell.metadata.attachments) {
                                previousCell.metadata.attachments = {};
                            }

                            // Generate new unique attachment ID
                            const newAttachmentId = `merged_${timestamp}`;

                            // Calculate relative path from workspace root
                            // Use finalOutputPath if we used a temp path and it exists, otherwise use mergedAudioPath
                            let pathForAttachment = mergedAudioPath;
                            if (tempOutputPath) {
                                // Check if final file exists (move succeeded), otherwise use temp path
                                if (await pathExists(finalOutputPath)) {
                                    pathForAttachment = finalOutputPath;
                                } else {
                                    // Move failed or not attempted, use temp path
                                    pathForAttachment = tempOutputPath;
                                    console.warn(`[mergeCellWithPrevious] Using temp path for attachment since final move failed or not attempted: ${tempOutputPath}`);
                                }
                            }

                            let relativePath = path.relative(workspaceFolder.uri.fsPath, pathForAttachment);
                            // Ensure path starts with .project or similar for relative paths
                            if (!relativePath.startsWith('.') && !path.isAbsolute(relativePath)) {
                                relativePath = `.${path.sep}${relativePath}`;
                            }
                            const relativePathPosix = toPosixPath(relativePath);

                            // Merge attachment properties
                            const mergedAttachment: any = {
                                type: "audio",
                                url: relativePathPosix,
                                updatedAt: timestamp,
                                isDeleted: false
                            };

                            // Calculate duration: startTime from previous cell, endTime from current cell
                            // This ensures the total duration reflects all merged audio segments
                            if (previousAttachment?.attachment?.startTime !== undefined) {
                                mergedAttachment.startTime = previousAttachment.attachment.startTime;
                            }
                            if (currentAttachment?.attachment?.endTime !== undefined) {
                                mergedAttachment.endTime = currentAttachment.attachment.endTime;
                            } else if (previousAttachment?.attachment?.endTime !== undefined && currentAttachment?.attachment?.startTime !== undefined) {
                                // Fallback: if current doesn't have endTime, use previous endTime
                                // This handles cases where the current cell's audio doesn't have timing metadata
                                mergedAttachment.endTime = previousAttachment.attachment.endTime;
                            }

                            // Preserve transcription if available (prefer previous, fallback to current)
                            if (previousAttachment?.attachment?.transcription) {
                                mergedAttachment.transcription = previousAttachment.attachment.transcription;
                            } else if (currentAttachment?.attachment?.transcription) {
                                mergedAttachment.transcription = currentAttachment.attachment.transcription;
                            }

                            // Add merged attachment
                            previousCell.metadata.attachments[newAttachmentId] = mergedAttachment;

                            // Set as selected audio
                            previousCell.metadata.selectedAudioId = newAttachmentId;

                            debug(`[mergeCellWithPrevious] Successfully merged audio files and updated attachment metadata`);
                        } else {
                            console.warn(`[mergeCellWithPrevious] Audio merge failed, continuing with text merge only`);
                            vscode.window.showWarningMessage("Audio files could not be merged, but text merge completed successfully.");
                        }
                    } else if (previousAudioPath || currentAudioPath) {
                        // Only one cell has audio - preserve it in the previous cell
                        const sourceAttachment = previousAudioPath ? previousAttachment : currentAttachment;
                        const sourceCellId = previousAudioPath ? previousCellId : currentCellId;

                        if (sourceAttachment && !previousCell.metadata.attachments) {
                            previousCell.metadata.attachments = {};
                        }
                        if (sourceAttachment) {
                            // Copy the attachment to previous cell
                            const copyAttachmentId = `copied_${timestamp}`;
                            previousCell.metadata.attachments![copyAttachmentId] = {
                                ...sourceAttachment.attachment,
                                updatedAt: timestamp
                            };
                            previousCell.metadata.selectedAudioId = copyAttachmentId;
                            debug(`[mergeCellWithPrevious] Preserved audio attachment from ${sourceCellId}`);
                        }
                    }
                } catch (audioError) {
                    console.error(`[mergeCellWithPrevious] Error merging audio files:`, audioError);
                    // Don't fail the entire merge if audio merge fails
                }
            }

            // Mark the document as dirty manually since we bypassed the normal update methods.
            // Use markCellMutated so the per-cell serialization cache is invalidated too;
            // direct `_dirtyCellIds.add` would leave the previous-cell cache pointing at
            // its pre-merge state and the next save() would write stale bytes for it.
            (document as any)._isDirty = true;
            document.markCellMutated(previousCellId);

            // 6. Mark current cell as merged by updating its data
            const currentCellData = document.getCellData(currentCellId) || {};
            document.updateCellData(currentCellId, {
                ...currentCellData,
                merged: true
            });

            // Record an edit on the merged (current) cell to reflect the merged flag change
            const currentCellForEdits = document.getCell(currentCellId);
            if (currentCellForEdits) {
                if (!currentCellForEdits.metadata.edits) {
                    currentCellForEdits.metadata.edits = [] as any;
                }
                (currentCellForEdits.metadata.edits as any[]).push({
                    editMap: EditMapUtils.metadataNested("data", "merged"),
                    value: true,
                    timestamp: timestamp + 2,
                    type: EditType.USER_EDIT,
                    author: currentUser,
                    validatedBy: []
                });
                // updateCellData() above already fired the change event, which can
                // synchronously trigger updateWebview() → getText() and repopulate
                // the per-cell cache with the mid-mutation state (merged flag set,
                // but the merge edit not yet pushed). Re-invalidate now so the
                // upcoming save() re-serializes the cell with the merge edit.
                document.markCellMutated(currentCellId);
            }

            // Save the document
            await document.save(new vscode.CancellationTokenSource().token);

            debug(`Successfully merged cell ${currentCellId} with ${previousCellId}`);

            // Refresh the webview content
            provider.refreshWebview(webviewPanel, document);

        } catch (error) {
            console.error("Error merging cells:", error);
            vscode.window.showErrorMessage(`Failed to merge cells: ${error}`);
        }
    },

    showErrorMessage: async ({ event }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "showErrorMessage"; }>;
        vscode.window.showErrorMessage(typedEvent.text);
    },

    revalidateMissingForCell: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as any;
        const cellId = typedEvent?.content?.cellId as string;
        if (!cellId) return;
        try {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
            if (!workspaceFolder) return;
            const changed = await revalidateCellMissingFlags(document, workspaceFolder, cellId);

            // If anything changed, persist and send updated history and availability
            if (changed) {
                await document.save(new vscode.CancellationTokenSource().token);

                // Send updated history
                const audioHistory = document.getAttachmentHistory(cellId, "audio") || [];
                const currentAttachment = document.getCurrentAttachment(cellId, "audio");
                const explicitSelection = document.getExplicitAudioSelection(cellId);
                provider.postMessageToWebview(webviewPanel, {
                    type: "audioHistoryReceived",
                    content: {
                        cellId,
                        audioHistory,
                        currentAttachmentId: currentAttachment?.attachmentId ?? null,
                        hasExplicitSelection: explicitSelection !== null
                    }
                });

                // Send updated availability for this cell
                try {
                    const documentText = document.getText();
                    const notebookData = JSON.parse(documentText);
                    const cells = Array.isArray(notebookData?.cells) ? notebookData.cells : [];
                    const availability: { [k: string]: "available" | "missing" | "deletedOnly" | "none"; } = {} as any;
                    const cell = cells.find((c: any) => c?.metadata?.id === cellId);
                    if (cell) {
                        let hasAvailable = false; let hasAvailablePointer = false; let hasMissing = false; let hasDeleted = false;
                        const atts = cell?.metadata?.attachments || {};
                        for (const key of Object.keys(atts)) {
                            const att: any = atts[key];
                            if (att && att.type === "audio") {
                                if (att.isDeleted) hasDeleted = true;
                                else if (att.isMissing) hasMissing = true;
                                else {
                                    try {
                                        const url = String(att.url || "");
                                        if (url) {
                                            const filesRel = url.startsWith(".project/") ? url : url.replace(/^\.?\/?/, "");
                                            const abs = path.join(workspaceFolder.uri.fsPath, filesRel);
                                            const { isPointerFile } = await import("../../utils/lfsHelpers");
                                            const isPtr = await isPointerFile(abs).catch(() => false);
                                            if (isPtr) hasAvailablePointer = true; else hasAvailable = true;
                                        } else {
                                            hasAvailable = true;
                                        }
                                    } catch { hasAvailable = true; }
                                }
                            }
                        }
                        // If the user's selected audio is missing, show missing icon regardless of other attachments.
                        const selectedId = cell?.metadata?.selectedAudioId;
                        const selectedAtt = selectedId ? (atts as any)[selectedId] : undefined;
                        const selectedIsMissing = selectedAtt?.type === "audio" && selectedAtt?.isMissing === true;

                        // Provisional state
                        let state: "available" | "available-local" | "available-pointer" | "missing" | "deletedOnly" | "none";
                        if (selectedIsMissing) state = "missing";
                        else if (hasAvailable) state = "available-local";
                        else if (hasAvailablePointer) state = "available-pointer";
                        else if (hasMissing) state = "missing";
                        else if (hasDeleted) state = "deletedOnly";
                        else state = "none";

                        // Apply installed-version gate to avoid Play icon when blocked
                        if (state !== "available-local") {
                            try {
                                const { getFrontierVersionStatus } = await import("../../projectManager/utils/versionChecks");
                                const status = await getFrontierVersionStatus();
                                if (!status.ok) {
                                    if (state !== "missing" && state !== "deletedOnly" && state !== "none") {
                                        state = "available-pointer";
                                    }
                                }
                            } catch { /* ignore */ }
                        }

                        availability[cellId] = state as any;
                        safePostMessageToPanel(webviewPanel, { type: "providerSendsAudioAttachments", attachments: availability });
                    }
                } catch { /* ignore */ }
            }
        } catch (err) {
            console.error("Failed to revalidate missing for cell", { cellId, err });
        }
    },

    // Handler for requesting cells for a specific milestone/subsection (lazy loading)
    requestCellsForMilestone: async ({ event, document, webviewPanel, provider }) => {
        const typed = event as any;
        const milestoneIndex = typed?.content?.milestoneIndex ?? 0;
        const subsectionIndex = typed?.content?.subsectionIndex ?? 0;

        try {
            const config = vscode.workspace.getConfiguration("codex-editor-extension");
            const cellsPerPage = config.get("cellsPerPage", 50);

            // Get cells for the requested milestone/subsection
            const cells = document.getCellsForMilestone(milestoneIndex, subsectionIndex, cellsPerPage);

            // Get all cells in the milestone for footnote offset calculation
            const allCellsInMilestone = document.getAllCellsForMilestone(milestoneIndex);

            // Process cells (merge ranges, etc.)
            const isSourceText = document.uri.toString().includes(".source");
            const processedCells = provider.mergeRangesAndProcess(
                cells,
                provider.isCorrectionEditorMode,
                isSourceText
            );

            // Process all cells in milestone for footnote counting
            const processedAllCellsInMilestone = provider.mergeRangesAndProcess(
                allCellsInMilestone,
                provider.isCorrectionEditorMode,
                isSourceText
            );

            // Build source cell map for these cells
            const sourceCellMap: { [k: string]: { content: string; versions: string[]; }; } = {};
            for (const cell of cells) {
                const cellId = cell.cellMarkers?.[0];
                if (cellId && document._sourceCellMap[cellId]) {
                    sourceCellMap[cellId] = document._sourceCellMap[cellId];
                }
            }

            // Store the current milestone/subsection for this document to preserve position during updates
            provider.currentMilestoneSubsectionMap.set(document.uri.toString(), {
                milestoneIndex,
                subsectionIndex,
            });

            // Send the cell page to the webview, including all cells in milestone for footnote counting
            safePostMessageToPanel(webviewPanel, {
                type: "providerSendsCellPage",
                rev: provider.getDocumentRevision(document.uri.toString()),
                milestoneIndex,
                subsectionIndex,
                cells: processedCells,
                allCellsInMilestone: processedAllCellsInMilestone,
                sourceCellMap,
            });

            debug(`Sent cells for milestone ${milestoneIndex}, subsection ${subsectionIndex}: ${processedCells.length} cells`);
        } catch (error) {
            console.error("Error fetching cells for milestone:", error);
        }
    },

    // Handler for requesting subsection progress for a milestone
    requestSubsectionProgress: async ({ event, document, webviewPanel, provider }) => {
        const typed = event as any;
        const milestoneIndex = typed?.content?.milestoneIndex ?? 0;

        try {
            const config = vscode.workspace.getConfiguration("codex-project-manager");
            const validationCount = config.get("validationCount", 1);
            const validationCountAudio = config.get("validationCountAudio", 1);
            const cellsPerPage = vscode.workspace.getConfiguration("codex-editor-extension").get("cellsPerPage", 50);

            // Calculate progress for all subsections in this milestone
            const subsectionProgress = document.calculateSubsectionProgress(
                milestoneIndex,
                cellsPerPage,
                validationCount,
                validationCountAudio
            );

            // Send the progress data to the webview
            safePostMessageToPanel(webviewPanel, {
                type: "providerSendsSubsectionProgress",
                milestoneIndex,
                subsectionProgress,
            });

            debug(`Sent subsection progress for milestone ${milestoneIndex}:`, subsectionProgress);
        } catch (error) {
            console.error("Error fetching subsection progress:", error);
        }
    },

    // Handler for counting search matches across all milestones (for in-tab search bar)
    countMatchesInDocument: async ({ event, document, webviewPanel, provider }) => {
        const typed = event as any;
        const query = typed?.content?.query ?? "";
        const matchCase = typed?.content?.matchCase ?? false;

        if (!query.trim()) {
            // Empty query - send back empty results
            safePostMessageToPanel(webviewPanel, {
                type: "searchMatchCounts",
                query: "",
                milestoneMatchCounts: {},
                totalMatches: 0,
            });
            return;
        }

        try {
            const config = vscode.workspace.getConfiguration("codex-editor-extension");
            const cellsPerPage = config.get("cellsPerPage", 50);

            // Build milestone index to know how many milestones exist
            const milestoneIndex = document.buildMilestoneIndex(cellsPerPage);
            const milestoneMatchCounts: { [milestoneIdx: number]: number; } = {};
            let totalMatches = 0;

            // Helper to strip HTML tags for plain text search
            const stripHtml = (html: string): string => {
                return html.replace(/<[^>]*>/g, "");
            };

            // Search through all milestones
            for (let mIdx = 0; mIdx < milestoneIndex.milestones.length; mIdx++) {
                const milestone = milestoneIndex.milestones[mIdx];
                let milestoneMatches = 0;

                // Get all cells for this milestone
                const allCells = document.getAllCellsForMilestone(mIdx);

                // Count matches in each cell
                for (const cell of allCells) {
                    if (!cell.cellContent) continue;

                    const plainText = stripHtml(cell.cellContent);
                    const searchText = matchCase ? plainText : plainText.toLowerCase();
                    const searchQuery = matchCase ? query : query.toLowerCase();

                    let startIndex = 0;
                    while ((startIndex = searchText.indexOf(searchQuery, startIndex)) !== -1) {
                        milestoneMatches++;
                        startIndex += searchQuery.length;
                    }
                }

                if (milestoneMatches > 0) {
                    milestoneMatchCounts[mIdx] = milestoneMatches;
                    totalMatches += milestoneMatches;
                }
            }

            // Send the match counts back to the webview
            safePostMessageToPanel(webviewPanel, {
                type: "searchMatchCounts",
                query,
                milestoneMatchCounts,
                totalMatches,
            });

            debug(`Search match counts for "${query}": ${totalMatches} total matches across ${Object.keys(milestoneMatchCounts).length} milestones`);
        } catch (error) {
            console.error("Error counting search matches:", error);
            safePostMessageToPanel(webviewPanel, {
                type: "searchMatchCounts",
                query,
                milestoneMatchCounts: {},
                totalMatches: 0,
                error: String(error),
            });
        }
    },

    searchNavigateToCell: async ({ event, webviewPanel, provider }) => {
        const cellId = (event as any).content;
        if (cellId) {
            provider.scrollOtherPanelsToCell(cellId, webviewPanel);
        }
    },

    // Handler for expanding in-tab search to Parallel Passages (all files)
    expandSearchToAllFiles: async ({ event }) => {
        const typed = event as any;
        const query = typed?.content?.query ?? "";
        const replaceText = typed?.content?.replaceText;

        try {
            // Use dynamic import to avoid circular dependency
            const { GlobalProvider } = await import("../../globalProvider");

            // Focus the Parallel Passages sidebar FIRST (this will trigger webview load if not already open)
            await vscode.commands.executeCommand("search-passages-sidebar.focus");

            // Then set pending search data - the webview will receive it via webviewReady message
            // or immediately if already loaded
            const provider = GlobalProvider.getInstance().getProvider("search-passages-sidebar");
            if (provider && "setPendingSearch" in provider) {
                (provider as any).setPendingSearch(query, replaceText);
            }
        } catch (error) {
            console.error("Error expanding search to all files:", error);
        }
    },
};

export async function performLLMCompletion(
    currentCellId: string,
    currentDocument: CodexCellDocument,
    shouldUpdateValue = false
) {
    // Prevent LLM completion on source files
    if (currentDocument?.uri.fsPath.endsWith(".source")) {
        console.warn(
            "Attempted to perform LLM completion on a source file. This operation is not allowed."
        );
        return;
    }
    if (!currentDocument) {
        console.warn("No current document found when trying to perform LLM completion");
        return;
    }

    // Get the provider to access the unified queue
    const provider = getProvider();
    if (!provider) {
        console.warn("Could not find provider when trying to perform LLM completion");
        return;
    }

    // Use the provider's enqueueTranslation method to add to the unified queue
    try {
        return await provider.enqueueTranslation(currentCellId, currentDocument, shouldUpdateValue);
    } catch (error) {
        console.error("Error in performLLMCompletion:", error);
        vscode.window.showErrorMessage(
            `LLM completion failed: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
    }
}

export const handleGlobalMessage = async (
    provider: CodexCellEditorProvider,
    event: GlobalMessage
) => {
    debug("handleGlobalMessage", { event });
    switch (event.command) {
        case "applyTranslation": {
            debug("applyTranslation message received", { event });
            if (provider.currentDocument && event.content.type === "cellAndText") {
                provider.currentDocument.updateCellContent(
                    event.content.cellId,
                    event.content.text,
                    EditType.LLM_GENERATION
                );
            }
            break;
        }
        case "refreshAllEditors": {
            debug("refreshAllEditors message received", { event });
            // Send refreshMetadata message to all open editor webviews
            provider.getWebviewPanels().forEach((panel) => {
                provider.postMessageToWebview(panel, {
                    type: "refreshMetadata"
                });
            });
            break;
        }
        case "commentsUpdated": {
            if (event.content.type === "commentsFileChanged") {
                // Send a direct message to all active webview panels to refresh comment counts
                // Access webviewPanels through a public method
                provider.postMessageToWebviews({
                    type: "refreshCommentCounts",
                    timestamp: event.content.timestamp
                });
            }
            break;
        }
        // Add more cases here for other global message commands
    }
};

export const handleMessages = async (
    event: any, // Changed from EditorPostMessages to allow validation
    webviewPanel: vscode.WebviewPanel,
    document: CodexCellDocument,
    updateWebview: () => void,
    provider: CodexCellEditorProvider
) => {
    // Validate message structure before processing
    if (!event || typeof event !== 'object') {
        console.error("[Message Handler] Invalid message structure - not an object:", {
            event,
            eventType: typeof event
        });
        return;
    }

    // Check if this is a backend-to-frontend message (uses 'type' property)
    // These should not be processed by this handler
    if (event.type && !event.command) {
        console.warn("[Message Handler] Received backend-to-frontend message in frontend-to-backend handler - ignoring:", {
            messageType: event.type,
            eventKeys: Object.keys(event || {}),
            webviewPanelActive: webviewPanel?.active,
            documentUri: document?.uri?.toString()
        });
        return;
    }

    // Check for frontend-to-backend messages (should have 'command' property)
    if (!event.command) {
        console.error("[Message Handler] Frontend-to-backend message missing command property:", {
            event,
            eventKeys: Object.keys(event || {}),
            webviewPanelActive: webviewPanel?.active,
            documentUri: document?.uri?.toString()
        });
        return;
    }

    if (typeof event.command !== 'string') {
        console.error("[Message Handler] Message command is not a string:", {
            command: event.command,
            commandType: typeof event.command,
            event,
            webviewPanelActive: webviewPanel?.active
        });
        return;
    }

    // Cast to proper type after validation
    const validatedEvent = event as EditorPostMessages;

    const context: MessageHandlerContext = {
        event: validatedEvent,
        webviewPanel,
        document,
        updateWebview,
        provider,
    };

    const handler = messageHandlers[validatedEvent.command];
    if (handler) {
        await withErrorHandling(
            () => handler(context),
            `handle ${validatedEvent.command}`,
            true // Show user error for most operations
        );
    } else {
        console.error("[Message Handler] Unknown message command:", {
            command: validatedEvent.command,
            availableCommands: Object.keys(messageHandlers).slice(0, 10), // First 10 for debugging
            totalHandlers: Object.keys(messageHandlers).length,
            event: validatedEvent,
            webviewPanelActive: webviewPanel?.active
        });
    }
};

/**
 * Scans for audio attachments that match cells in the current document
 * @param document The current CodexCellDocument
 * @returns A mapping of cellId to audio file path
 */
export async function scanForAudioAttachments(
    document: CodexCellDocument,
    webviewPanel: vscode.WebviewPanel
): Promise<{ [cellId: string]: string; }> {
    debug("Scanning for audio attachments for document:", document.uri.toString());

    const audioAttachments: { [cellId: string]: string; } = {};

    try {
        // Get the workspace folder
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (!workspaceFolder) {
            debug("No workspace folder found");
            return audioAttachments;
        }

        // Get the document data to find all cell IDs
        const documentText = document.getText();
        const notebookData = JSON.parse(documentText);

        const docSegment = getAttachmentDocumentSegmentFromUri(document.uri);

        // Process each cell in the document
        if (notebookData.cells && Array.isArray(notebookData.cells)) {
            for (const cell of notebookData.cells) {
                if (cell.metadata && cell.metadata.id) {
                    const cellId = cell.metadata.id;

                    // Check if cell has attachments in metadata
                    if (cell.metadata.attachments) {
                        for (const [attachmentId, attachment] of Object.entries(cell.metadata.attachments)) {
                            if (attachment && (attachment as any).type === "audio") {
                                const attachmentPath = toPosixPath((attachment as any).url);

                                // Build full path
                                const fullPath = path.isAbsolute(attachmentPath)
                                    ? attachmentPath
                                    : path.join(workspaceFolder.uri.fsPath, attachmentPath);

                                try {
                                    // Check if file exists and read it
                                    if (await pathExists(fullPath)) {
                                        // Record availability only; avoid sending base64 audio during scans
                                        audioAttachments[cellId] = fullPath;
                                        debug("Found audio attachment in metadata (availability only):", {
                                            cellId,
                                            attachmentId,
                                            path: fullPath
                                        });
                                    }
                                } catch (err) {
                                    console.error(`Error reading audio file ${fullPath}:`, err);
                                }
                            }
                        }
                    }

                    // Also check the filesystem for legacy audio files
                    const bookAbbr = docSegment;
                    const attachmentsFilesPath = path.join(
                        workspaceFolder.uri.fsPath,
                        ".project",
                        "attachments",
                        "files",
                        bookAbbr
                    );
                    const legacyAttachmentsPath = path.join(
                        workspaceFolder.uri.fsPath,
                        ".project",
                        "attachments",
                        bookAbbr
                    );

                    for (const attachmentsPath of [attachmentsFilesPath, legacyAttachmentsPath]) {
                        if (!(await pathExists(attachmentsPath))) continue;
                        try {
                            const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(attachmentsPath));

                            // Look for any audio files that might match this cell
                            const audioExtensions = ['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.webm', '.flac'];
                            const audioFiles = files
                                .filter(([name, type]) => type === vscode.FileType.File)
                                .map(([name]) => name)
                                .filter(name => audioExtensions.some(ext => name.toLowerCase().endsWith(ext)));

                            for (const audioFile of audioFiles) {
                                // Check if the file name contains the cell ID pattern
                                const cellIdPattern = cellId.replace(/[:\s]/g, '_');
                                if (audioFile.includes(cellIdPattern) || audioFile.includes(cellId)) {
                                    const fullAudioPath = path.join(attachmentsPath, audioFile);

                                    // Only process if not already found in metadata
                                    if (!audioAttachments[cellId]) {
                                        try {
                                            // Record availability only; avoid sending base64 during scans
                                            audioAttachments[cellId] = fullAudioPath;
                                            debug("Found legacy audio file (availability only):", {
                                                cellId,
                                                audioFile,
                                                path: fullAudioPath
                                            });
                                        } catch (err) {
                                            console.error(`Error reading legacy audio file ${fullAudioPath}:`, err);
                                        }
                                    }
                                }
                            }
                        } catch (err) {
                            debug("Error reading attachments directory:", err);
                        }
                    }
                }
            }
        }

        debug("Total audio attachments found:", Object.keys(audioAttachments).length);
    } catch (error) {
        console.error("Error scanning for audio attachments:", error);
    }

    return audioAttachments;
}
