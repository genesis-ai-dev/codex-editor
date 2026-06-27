import { CodexExportFormat, exportCodexContent, checkSubtitleOverlapsAndConfirm } from "../exportHandler/exportHandler";
import { createWebviewReporter, type ExportProgressReporter } from "../exportHandler/exportProgress";
import * as fs from "fs";
import * as vscode from "vscode";
import { safePostMessageToPanel } from "../utils/webviewUtils";
import { EXPORT_OPTIONS_BY_FILE_TYPE } from "../../sharedUtils/exportOptionsEligibility";
import { groupCodexFilesByImporterType, analyzeCodexFileAudio, type FileGroup } from "./utils/exportViewUtils";
import { readCodexNotebookFromUri } from "../exportHandler/exportHandlerUtils";
import { compareHtmlStructure } from "../../sharedUtils/htmlStructureUtils";
import { getMediaFilesStrategy } from "../utils/localProjectSettings";
import { AudioAttachmentsMigrator } from "../utils/audioAttachmentsMigrationUtils";
import { openCodexDocumentWithSourcePair } from "../utils/openCodexDocumentWithSourcePair";
import { jumpToCellInNotebook } from "../utils";

const LAST_EXPORT_FOLDER_KEY = "projectExport.lastFolder";

function getLastExportFolderUri(context: vscode.ExtensionContext): vscode.Uri | undefined {
    const lastPath = context.workspaceState.get<string>(LAST_EXPORT_FOLDER_KEY);
    if (!lastPath) {
        return undefined;
    }
    try {
        if (!fs.existsSync(lastPath)) {
            return undefined;
        }
        if (!fs.statSync(lastPath).isDirectory()) {
            return undefined;
        }
        return vscode.Uri.file(lastPath);
    } catch {
        return undefined;
    }
}

/**
 * Check selected codex files for HTML structure mismatches against their source cells.
 * Returns total count of mismatched cells for display in the export warning.
 */
async function checkHtmlStructureMismatches(
    filesToExport: string[]
): Promise<{ totalMismatches: number; fileDetails: { file: string; count: number; }[]; }> {
    const fileDetails: { file: string; count: number; }[] = [];
    let totalMismatches = 0;

    for (const filePath of filesToExport) {
        try {
            const fileUri = vscode.Uri.file(filePath);
            const codexNotebook = await readCodexNotebookFromUri(fileUri);
            const { metadata } = codexNotebook;

            if (!metadata?.enforceHtmlStructure) continue;

            // Use sourceFsPath from metadata (source and codex live in different directories)
            const sourcePath = metadata.sourceFsPath;
            if (!sourcePath) continue;
            const sourceUri = vscode.Uri.file(sourcePath);

            let sourceNotebook;
            try {
                sourceNotebook = await readCodexNotebookFromUri(sourceUri);
            } catch {
                continue;
            }

            const sourceMap = new Map<string, string>();
            for (const cell of sourceNotebook.cells) {
                if (cell.metadata?.id && cell.value) {
                    sourceMap.set(cell.metadata.id, cell.value);
                }
            }

            let mismatchCount = 0;
            for (const cell of codexNotebook.cells) {
                const cellId = cell.metadata?.id;
                if (!cellId || !cell.value) continue;
                const sourceContent = sourceMap.get(cellId);
                if (!sourceContent) continue;
                const diff = compareHtmlStructure(sourceContent, cell.value);
                if (!diff.isMatch) mismatchCount++;
            }

            if (mismatchCount > 0) {
                const fileName = filePath.split(/[\\/]/).pop() || filePath;
                fileDetails.push({ file: fileName, count: mismatchCount });
                totalMismatches += mismatchCount;
            }
        } catch (err) {
            console.warn(`[checkHtmlStructureMismatches] Error checking ${filePath}:`, err);
        }
    }

    return { totalMismatches, fileDetails };
}

/**
 * Single live panel. If the user runs the export command again while a
 * wizard is already open (even in a background tab), we surface that one
 * instead of creating a duplicate. Cleared on dispose so a fresh invocation
 * gets a fresh panel.
 */
let activeExportPanel: vscode.WebviewPanel | undefined;

/**
 * Cancellation source for the export currently running in the active panel.
 * Created when an export starts and disposed when it settles. Used to abort the
 * run when the user clicks Cancel or closes the export tab mid-export.
 */
let activeExportCts: vscode.CancellationTokenSource | undefined;

/**
 * True while an export is actively running in the active panel. Guards against
 * starting a second export (e.g. the run still draining its in-flight LFS
 * downloads after a cancel) before the first has settled.
 */
let isExporting = false;

export async function openProjectExportView(context: vscode.ExtensionContext) {
    if (activeExportPanel) {
        // Bring the existing wizard forward instead of stacking another one.
        // preserveFocus=false because the user explicitly asked to open the
        // wizard — give them the cursor.
        try {
            activeExportPanel.reveal(vscode.ViewColumn.One, false);
            return;
        } catch {
            // Panel was disposed but our reference is stale — fall through
            // and create a fresh one.
            activeExportPanel = undefined;
        }
    }

    const panel = vscode.window.createWebviewPanel(
        "projectExportView",
        "Export Project",
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
        }
    );
    activeExportPanel = panel;

    // Live Step 1 counts: watch `.codex` files and push a per-file audio-stat
    // refresh whenever one is saved while the wizard is open (e.g. the user
    // picks a different take, records, or deletes a take in the cell editor).
    // We recompute only the changed file and patch that row, so this stays
    // cheap even on large projects.
    const codexWatcher = vscode.workspace.createFileSystemWatcher("**/*.codex");
    const audioStatsRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const scheduleAudioStatsRefresh = (uri: vscode.Uri) => {
        const key = uri.fsPath;
        const existing = audioStatsRefreshTimers.get(key);
        if (existing) {
            clearTimeout(existing);
        }
        // Debounce: the document save path does a tmp-write + atomic rename
        // (often surfacing as a create+change pair) and autosave can burst —
        // coalesce into a single recompute per file.
        audioStatsRefreshTimers.set(
            key,
            setTimeout(async () => {
                audioStatsRefreshTimers.delete(key);
                const result = await analyzeCodexFileAudio(uri);
                // null = transient read/parse race or broken file; leave the
                // existing count in place until the next save.
                if (!result) {
                    return;
                }
                safePostMessageToPanel(
                    panel,
                    {
                        command: "fileAudioStatsUpdated",
                        path: uri.fsPath,
                        hasAudio: result.hasAudio,
                        hasTranslations: result.hasTranslations,
                        audioStats: result.audioStats,
                    },
                    "ProjectExport"
                );
            }, 400)
        );
    };
    codexWatcher.onDidChange(scheduleAudioStatsRefresh);
    codexWatcher.onDidCreate(scheduleAudioStatsRefresh);

    panel.onDidDispose(() => {
        // Closing the tab while an export is running aborts it (and triggers the
        // engine's partial-output cleanup). This also prevents a stale run from
        // continuing in the background after the panel is gone.
        if (isExporting) {
            activeExportCts?.cancel();
        }
        codexWatcher.dispose();
        for (const timer of audioStatsRefreshTimers.values()) {
            clearTimeout(timer);
        }
        audioStatsRefreshTimers.clear();
        if (activeExportPanel === panel) {
            activeExportPanel = undefined;
        }
    });

    const projectConfig = vscode.workspace.getConfiguration("codex-project-manager");
    const sourceLanguage = projectConfig.get("sourceLanguage");
    const targetLanguage = projectConfig.get("targetLanguage");

    const codiconsUri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(
            context.extensionUri,
            "out",
            "node_modules",
            "@vscode/codicons",
            "dist",
            "codicon.css"
        )
    );

    const codexFiles = await vscode.workspace.findFiles("**/*.codex");

    // Pre-warm `isMissing` flags on attachments before we build Step 1's file
    // groups. The startup migration already runs this scan, but pointer files
    // can appear (sync) or disappear (manual delete) during a session — so we
    // re-scan on demand so the audio-history "MISSING" badge and any other
    // downstream consumer see ground truth as of right now.
    //
    // After PR 2 this no longer affects Step 1's audio stats (those ignore
    // `isMissing` entirely and rely on the resolver). But other UI surfaces
    // still read the flag, so a fresh scan keeps everything coherent.
    //
    // We deliberately AWAIT this before reading the notebooks so Step 1 sees
    // the up-to-date `.codex` JSON on disk; the scan only writes when a flag
    // actually changes, so it's cheap on a healthy project.
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const migrator = new AudioAttachmentsMigrator(workspaceFolders[0]);
            await migrator.updateMissingFlagsForCodexDocuments();
        }
    } catch (err) {
        // Non-fatal: stale flags only affect the audio-history badge, not the
        // export itself. Don't block the wizard.
        console.warn("[ExportView] Pre-warm isMissing scan failed; continuing with possibly stale flags", err);
    }

    const fileGroups = await groupCodexFilesByImporterType(codexFiles);

    const mediaStrategy = await getMediaFilesStrategy();
    const isStreamOnly = mediaStrategy === "stream-only";

    const initialExportFolder = getLastExportFolderUri(context)?.fsPath ?? null;
    panel.webview.html = getWebviewContent(
        sourceLanguage,
        targetLanguage,
        codiconsUri,
        fileGroups,
        initialExportFolder,
        isStreamOnly
    );

    panel.webview.onDidReceiveMessage(async (message) => {
        let result: vscode.Uri[] | undefined;

        switch (message.command) {
            case "selectExportPath": {
                const defaultUri = getLastExportFolderUri(context);
                result = await vscode.window.showOpenDialog({
                    canSelectFiles: false,
                    canSelectFolders: true,
                    canSelectMany: false,
                    title: "Select Export Location",
                    openLabel: "Select Folder",
                    ...(defaultUri ? { defaultUri } : {}),
                });

                if (result && result[0]) {
                    await context.workspaceState.update(LAST_EXPORT_FOLDER_KEY, result[0].fsPath);
                    safePostMessageToPanel(
                        panel,
                        {
                            command: "updateExportPath",
                            path: result[0].fsPath,
                        },
                        "ProjectExport"
                    );
                }
                break;
            }
            case "openProjectSettings":
                await vscode.commands.executeCommand(
                    "codex-project-manager.openProjectSettings"
                );
                break;
            case "export":
                // Guard against a second export starting while one is still
                // running (or draining in-flight downloads after a cancel).
                if (isExporting) {
                    break;
                }
                try {
                    // For round-trip exports, check for HTML structure mismatches and prompt
                    if (message.format === "rebuild-export" && message.filesToExport?.length) {
                        const { totalMismatches, fileDetails } =
                            await checkHtmlStructureMismatches(message.filesToExport as string[]);
                        if (totalMismatches > 0) {
                            const details = fileDetails
                                .map((f) => `  ${f.file}: ${f.count} cell(s)`)
                                .join("\n");
                            const choice = await vscode.window.showWarningMessage(
                                `${totalMismatches} cell(s) have mismatched HTML structure that may break the round-trip export:\n\n${details}\n\nDo you still want to continue?`,
                                { modal: true },
                                "Export Anyway"
                            );
                            if (choice !== "Export Anyway") {
                                break;
                            }
                        }
                    }

                    // Switch the webview to its in-panel "exporting" screen before kicking off work.
                    safePostMessageToPanel(
                        panel,
                        { command: "exportStarted" },
                        "ProjectExport"
                    );

                    const reporter = createWebviewReporter(panel, "ProjectExport");

                    // Fresh cancellation source for this run. The token is
                    // threaded through the export engine so Cancel / tab-close
                    // can stop downloads and trigger partial-output cleanup.
                    activeExportCts = new vscode.CancellationTokenSource();
                    isExporting = true;
                    try {
                        await exportCodexContent(
                            message.format as CodexExportFormat,
                            message.userSelectedPath,
                            message.filesToExport,
                            message.options,
                            reporter,
                            activeExportCts.token
                        );
                    } catch (error) {
                        // A cancellation surfaces here as an AbortError from an
                        // in-flight download; the engine has already emitted the
                        // `cancelled` event and cleaned up, so don't also report
                        // it as a failure.
                        if (!activeExportCts.token.isCancellationRequested) {
                            reporter.error(
                                error instanceof Error
                                    ? error.message
                                    : "Failed to export project. Please check your configuration."
                            );
                        }
                    } finally {
                        isExporting = false;
                        activeExportCts.dispose();
                        activeExportCts = undefined;
                    }
                    // Intentionally do NOT dispose the panel. The webview owns
                    // the success/error/cancelled UI and the user clicks Close when ready.
                } catch (error) {
                    safePostMessageToPanel(
                        panel,
                        {
                            command: "exportError",
                            message:
                                error instanceof Error
                                    ? error.message
                                    : "Failed to export project. Please check your configuration.",
                        },
                        "ProjectExport"
                    );
                }
                break;
            case "retryExport": {
                // Targeted retry: re-attempt only the cells that failed (with a
                // transient/recoverable reason) and merge any recovered audio
                // back into the original export folder. Audio-only path —
                // download/transcode/write failures only happen there.
                if (isExporting) {
                    break;
                }
                const audioOutputPath = message.audioOutputPath as string | undefined;
                const targets = message.targets as
                    | { cellId: string; codexPath: string; }[]
                    | undefined;
                if (!audioOutputPath || !targets || targets.length === 0) {
                    break;
                }

                // Group target cellIds by their codex file.
                const retryCellFilter = new Map<string, Set<string>>();
                for (const t of targets) {
                    if (!t?.cellId || !t?.codexPath) continue;
                    let set = retryCellFilter.get(t.codexPath);
                    if (!set) {
                        set = new Set<string>();
                        retryCellFilter.set(t.codexPath, set);
                    }
                    set.add(t.cellId);
                }
                const codexPaths = Array.from(retryCellFilter.keys());
                if (codexPaths.length === 0) {
                    break;
                }

                // Custom reporter: still-failing cells stream back as
                // `exportFileMissing` (so the issues list refreshes), but the
                // terminal state is a `retryCompleted` — distinct from a full
                // export's complete/error so the completion screen and its
                // existing issue list aren't torn down.
                const retryReporter: ExportProgressReporter = {
                    report: () => undefined,
                    fileMissing: (file, reason, detail, location) => {
                        safePostMessageToPanel(
                            panel,
                            {
                                command: "exportFileMissing",
                                file,
                                reason,
                                detail,
                                cellId: location?.cellId,
                                codexPath: location?.codexPath,
                            },
                            "ProjectExport"
                        );
                    },
                    complete: (summary) => {
                        safePostMessageToPanel(
                            panel,
                            { command: "retryCompleted", summary },
                            "ProjectExport"
                        );
                    },
                    error: (errMessage) => {
                        safePostMessageToPanel(
                            panel,
                            { command: "retryCompleted", error: errMessage },
                            "ProjectExport"
                        );
                    },
                    cancelled: () => {
                        safePostMessageToPanel(
                            panel,
                            { command: "retryCompleted", cancelled: true },
                            "ProjectExport"
                        );
                    },
                };

                activeExportCts = new vscode.CancellationTokenSource();
                isExporting = true;
                try {
                    const { exportAudioAttachments } = await import(
                        "../exportHandler/audioExporter"
                    );
                    await exportAudioAttachments(
                        audioOutputPath,
                        codexPaths,
                        retryReporter,
                        {
                            // Reproduce timestamp behaviour so retried files
                            // match the original. Milestones are intentionally
                            // omitted — the cell filter is authoritative.
                            includeTimestamps: message.options?.includeTimestamps === true,
                            retryCellFilter,
                        },
                        activeExportCts.token
                    );
                } catch (error) {
                    if (!activeExportCts.token.isCancellationRequested) {
                        safePostMessageToPanel(
                            panel,
                            {
                                command: "retryCompleted",
                                error:
                                    error instanceof Error
                                        ? error.message
                                        : "Retry failed.",
                            },
                            "ProjectExport"
                        );
                    }
                } finally {
                    isExporting = false;
                    activeExportCts.dispose();
                    activeExportCts = undefined;
                }
                break;
            }
            case "openExportFolder": {
                const target = message.path as string | undefined;
                if (target && fs.existsSync(target)) {
                    await vscode.commands.executeCommand(
                        "revealFileInOS",
                        vscode.Uri.file(target)
                    );
                }
                break;
            }
            case "closeExportView":
                panel.dispose();
                break;
            case "openCellInEditor": {
                // Deep-link from the Step 1 audio-stats popover into the
                // affected cell. Same UX as the navigation sidebar: open
                // the .source + .codex pair, then publish the cellId via
                // workspace state so the codex editor's cellToJumpTo
                // listener scrolls to it. We do NOT dispose the export
                // panel — the user may want to come back to it after
                // fixing the cell.
                const cellId = message.cellId as string | undefined;
                const filePath = message.filePath as string | undefined;
                if (!cellId || !filePath) break;
                try {
                    const codexUri = vscode.Uri.file(filePath);
                    const wsFolderUri = vscode.workspace.getWorkspaceFolder(codexUri)?.uri;
                    await openCodexDocumentWithSourcePair(codexUri, wsFolderUri);
                    await jumpToCellInNotebook(context, codexUri.fsPath, cellId);
                } catch (error) {
                    console.error("Failed to open cell from export popover:", error);
                }
                break;
            }
            case "checkHtmlStructure": {
                const mismatchResults = await checkHtmlStructureMismatches(
                    message.filesToExport as string[]
                );
                safePostMessageToPanel(
                    panel,
                    { command: "htmlStructureCheckResult", mismatches: mismatchResults },
                    "ProjectExport"
                );
                break;
            }
            case "previewCharacterAudio": {
                try {
                    const { getCharacterAudioPreview } = await import(
                        "../exportHandler/characterAudioExporter"
                    );
                    const preview = await getCharacterAudioPreview(
                        (message.filesToExport as string[]) || []
                    );
                    safePostMessageToPanel(
                        panel,
                        { command: "characterAudioPreviewResult", preview },
                        "ProjectExport"
                    );
                } catch (err) {
                    safePostMessageToPanel(
                        panel,
                        {
                            command: "characterAudioPreviewResult",
                            preview: { files: [] },
                            error: err instanceof Error ? err.message : String(err),
                        },
                        "ProjectExport"
                    );
                }
                break;
            }
            case "checkSubtitleOverlaps": {
                const proceed = await checkSubtitleOverlapsAndConfirm(
                    message.filesToExport as string[]
                );
                safePostMessageToPanel(
                    panel,
                    { command: "subtitleOverlapResult", proceed },
                    "ProjectExport"
                );
                break;
            }
            case "cancel":
                panel.dispose();
                break;
            case "cancelExport":
                // Stop the in-progress export. Keep the panel open: the engine
                // cleans up partial output and emits `exportCancelled`, which
                // the webview renders as a terminal cancelled state.
                activeExportCts?.cancel();
                break;
        }
    });
}

function middleTruncateLongerFileNames(fileName: string): string {
    if (fileName.length > 20) {
        return fileName.slice(0, 10) + "..." + fileName.slice(-10);
    }
    return fileName;
}

function getWebviewContent(
    sourceLanguage: unknown,
    targetLanguage: unknown,
    codiconsUri: vscode.Uri,
    fileGroups: FileGroup[],
    initialExportFolder: string | null,
    isStreamOnly: boolean
) {
    const hasLanguages = sourceLanguage && targetLanguage;

    const groupsJson = JSON.stringify(fileGroups);
    const exportOptionsConfigJson = JSON.stringify(EXPORT_OPTIONS_BY_FILE_TYPE);
    const initialExportFolderJson = JSON.stringify(initialExportFolder);
    return `<!DOCTYPE html>
    <html>
        <head>
            <link href="${codiconsUri}" rel="stylesheet" />
            <style>
                body {
                    padding: 0 16px;
                    display: flex;
                    flex-direction: column;
                    height: 100vh;
                    box-sizing: border-box;
                    overflow: hidden;
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                }
                .container {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    min-height: 0;
                }
                .step-panel { display: none; }
                .step-panel.active { display: flex; flex-direction: column; flex: 1; gap: 16px; }
                .progress-bar {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex: 1;
                    min-width: 0;
                    overflow: hidden;
                }
                .progress-compact {
                    display: none;
                    font-size: 0.85em;
                    font-weight: 600;
                    color: var(--vscode-descriptionForeground);
                    white-space: nowrap;
                }
                .progress-circle {
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 0.8em;
                    font-weight: 600;
                    border: 2px solid var(--vscode-input-border);
                    color: var(--vscode-descriptionForeground);
                    background: transparent;
                    flex-shrink: 0;
                    transition: all 0.2s ease;
                }
                .progress-circle .codicon { font-size: 14px; }
                .progress-circle.active {
                    border-color: var(--vscode-focusBorder);
                    background: transparent;
                    color: var(--vscode-focusBorder);
                }
                .progress-circle.completed {
                    border-color: var(--vscode-focusBorder);
                    background: var(--vscode-focusBorder);
                    color: var(--vscode-button-foreground);
                }
                .progress-line {
                    width: 60px;
                    max-width: 120px;
                    flex-shrink: 1;
                    height: 2px;
                    background: var(--vscode-input-border);
                    transition: background 0.2s ease;
                }
                .progress-line.completed {
                    background: var(--vscode-focusBorder);
                }
                @media (max-width: 340px) {
                    .progress-circle, .progress-line { display: none; }
                    .progress-compact { display: block; }
                }
                .file-group {
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    overflow: hidden;
                    margin-bottom: 12px;
                }
                .file-group.disabled { opacity: 0.5; pointer-events: none; }
                .file-group-header {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 12px;
                    background-color: var(--vscode-editor-inactiveSelectionBackground);
                    user-select: none;
                }
                .file-group-header h4 { margin: 0; flex: 1; font-size: 0.95em; }
                .group-filter-cb {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    font-size: 0.85em;
                    white-space: nowrap;
                    cursor: pointer;
                    color: var(--vscode-descriptionForeground);
                    padding: 2px 6px;
                    border-radius: 3px;
                }
                .group-filter-cb:hover { color: var(--vscode-editor-foreground); background: var(--vscode-list-hoverBackground); }
                .group-filter-cb input[type="checkbox"] { margin: 0; }
                .group-filter-cb.filter-disabled { opacity: 0.4; pointer-events: none; }
                .file-group-content {
                    padding: 12px;
                    background-color: var(--vscode-editor-background);
                    border-top: 1px solid var(--vscode-input-border);
                }
                .milestone-file-group {
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    margin-bottom: 12px;
                    overflow: hidden;
                }
                .milestone-file-header {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 12px;
                    background-color: var(--vscode-editor-inactiveSelectionBackground);
                }
                .milestone-file-header h4 {
                    margin: 0;
                    flex: 1;
                    font-size: 0.95em;
                }
                .milestone-list {
                    padding: 8px 12px 12px 32px;
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    background-color: var(--vscode-editor-background);
                    border-top: 1px solid var(--vscode-input-border);
                }
                .milestone-item {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .milestone-item label {
                    cursor: pointer;
                    user-select: none;
                }
                .milestone-select-all {
                    font-size: 0.85em;
                    color: var(--vscode-descriptionForeground);
                }
                .file-item {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 4px 8px;
                    border-radius: 3px;
                    word-break: break-word;
                }
                .file-item:hover { background-color: var(--vscode-list-hoverBackground); }
                .file-item-main {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    gap: 1px;
                    min-width: 0;
                }
                .file-audio-stats {
                    font-size: 0.78em;
                    color: var(--vscode-descriptionForeground);
                    opacity: 0.85;
                }
                .file-item.file-item-disabled { opacity: 0.45; cursor: not-allowed; }
                .file-item.file-item-disabled:hover { background-color: transparent; }
                .file-item.file-item-disabled input[type="checkbox"] { pointer-events: none; }
                .file-item .file-status-tag {
                    font-size: 0.75em;
                    padding: 1px 5px;
                    border-radius: 3px;
                    white-space: nowrap;
                    flex-shrink: 0;
                }
                .file-status-tag.audio-only-tag {
                    color: var(--vscode-charts-blue, #2563eb);
                    background-color: rgba(37, 99, 235, 0.12);
                    border: 1px solid rgba(37, 99, 235, 0.3);
                }
                .file-status-tag.text-only-tag {
                    color: var(--vscode-charts-green, #16a34a);
                    background-color: rgba(34, 197, 94, 0.1);
                    border: 1px solid rgba(34, 197, 94, 0.3);
                }
                .file-status-tag.text-audio-tag {
                    color: var(--vscode-charts-purple, #9333ea);
                    background-color: rgba(147, 51, 234, 0.1);
                    border: 1px solid rgba(147, 51, 234, 0.3);
                }
                .file-status-tag.no-content-tag {
                    color: var(--vscode-descriptionForeground);
                    background-color: rgba(128, 128, 128, 0.1);
                    border: 1px solid rgba(128, 128, 128, 0.25);
                }
                .file-item.file-item-incompatible { opacity: 0.45; }
                .file-item.file-item-incompatible input[type="checkbox"] { pointer-events: none; }
                .format-option {
                    padding: 16px;
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    cursor: pointer;
                    display: flex;
                    align-items: flex-start;
                    gap: 12px;
                }
                .format-option:hover { background-color: var(--vscode-list-hoverBackground); }
                .format-option.selected {
                    border-color: var(--vscode-focusBorder);
                    background-color: var(--vscode-list-activeSelectionBackground);
                }
                .step-content-area {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    overflow-y: auto;
                    min-height: 0;
                    padding-top: 16px;
                }
                .bottom-bar {
                    flex-shrink: 0;
                    margin: 0 -16px;
                    padding: 12px 16px;
                    border-top: 1px solid var(--vscode-input-border);
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .bottom-bar-left, .bottom-bar-right {
                    display: flex;
                    gap: 8px;
                    flex-shrink: 0;
                }
                .bottom-bar-right { justify-content: flex-end; }
                .step-btn { display: none; }
                .step-btn.visible { display: flex; }
                button {
                    padding: 8px 16px;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: 1px solid transparent;
                    border-radius: 4px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                }
                .step-btn {
                    min-width: 0;
                    padding: 8px 12px;
                    white-space: nowrap;
                }
                .step-btn .btn-text {
                    flex: 1;
                    text-align: center;
                }
                button:hover { background-color: var(--vscode-button-hoverBackground); }
                button:disabled { opacity: 0.5; cursor: not-allowed; }
                button.secondary { background-color: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
                .message {
                    text-align: center;
                    margin: 20px;
                    padding: 20px;
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    color: var(--vscode-descriptionForeground);
                }
                .export-path {
                    margin-top: 16px;
                    padding: 8px;
                    background-color: var(--vscode-input-background);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .path-display {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    flex: 1;
                    margin-right: 8px;
                }
                .format-section {
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    overflow: hidden;
                }
                .format-section-header {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 12px;
                    background-color: var(--vscode-editor-background);
                    user-select: none;
                }
                .format-section-header.collapsible {
                    cursor: pointer;
                }
                .format-section-header.collapsible:hover { background-color: var(--vscode-list-hoverBackground); }
                .format-section-header h4 { margin: 0; flex: 1; }
                .format-section-content {
                    padding: 12px;
                    background-color: var(--vscode-editor-background);
                    border-top: 1px solid var(--vscode-input-border);
                }
                .format-section-content {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
                    gap: 8px;
                }
                .format-section-content .format-option { padding: 12px; }
                .bible-formats-row { border-top: 1px solid var(--vscode-input-border); }
                .format-option-row { display: flex; gap: 1rem; }
                .hidden { display: none !important; }
                .format-option[data-option].hidden { display: none !important; }
                .format-section[data-option].hidden { display: none !important; }
                .format-option-row[data-option].hidden { display: none !important; }
                .format-option p, .format-option-content p { line-height: 1.45; margin: 4px 0 0 0; }
                .format-option-content { display: flex; flex-direction: column; gap: 4px; }
                .format-option-toggle {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 0.9em;
                    color: var(--vscode-descriptionForeground);
                    cursor: pointer;
                    user-select: none;
                }
                .format-option-toggle input[type="checkbox"] { margin: 0; cursor: pointer; }
                .format-section-suboption {
                    padding: 10px 12px;
                    background-color: var(--vscode-editor-background);
                    border-top: 1px solid var(--vscode-input-border);
                }
                .format-tag {
                    display: inline-block;
                    padding: 1px 4px;
                    font-size: 0.85em;
                    color: var(--vscode-badge-foreground);
                    opacity: 0.8;
                    align-self: flex-start;
                }
                .format-tag.format-tag-roundtrip {
                    background-color: rgba(34, 197, 94, 0.15) !important;
                    color: var(--vscode-charts-green, #16a34a) !important;
                    border: 1px solid rgba(34, 197, 94, 0.3) !important;
                    border-radius: 4px;
                    opacity: 1;
                }
                .format-warning {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    margin-top: 8px;
                    padding: 4px 8px;
                    font-size: 0.85em;
                    color: var(--vscode-charts-yellow, #ca8a04);
                    background-color: rgba(202, 138, 4, 0.12);
                    border: 1px solid rgba(202, 138, 4, 0.35);
                    border-radius: 4px;
                }
                .format-option-row.disabled-stream-only {
                    opacity: 0.45;
                    cursor: not-allowed;
                    pointer-events: none;
                }
                .audio-section-disabled {
                    opacity: 0.45;
                    pointer-events: none;
                }
                .roundtrip-wrapper[data-option].hidden { display: none !important; }
                .step-content { flex: 1; overflow-y: auto; }
                .popup-overlay {
                    display: none;
                    position: fixed;
                    inset: 0;
                    background: rgba(0, 0, 0, 0.4);
                    z-index: 100;
                    align-items: center;
                    justify-content: center;
                }
                .popup-overlay.visible { display: flex; }
                .popup-card {
                    background: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 6px;
                    padding: 20px 24px;
                    max-width: 480px;
                    width: 90%;
                    max-height: 90vh;
                    display: flex;
                    flex-direction: column;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
                }
                .popup-card .popup-header { flex: 0 0 auto; }
                .popup-card .popup-body {
                    flex: 1 1 auto;
                    min-height: 0;
                    overflow-y: auto;
                }
                .popup-card.wide { max-width: 900px; }
                .char-preview-file { margin-bottom: 18px; }
                .char-preview-file h5 {
                    margin: 0 0 6px 0;
                    color: var(--vscode-foreground);
                    font-size: 0.95em;
                }
                .char-preview-meta {
                    color: var(--vscode-descriptionForeground);
                    font-size: 0.8em;
                    margin-bottom: 8px;
                }
                .char-row {
                    display: grid;
                    grid-template-columns: 160px 1fr 80px;
                    gap: 10px;
                    align-items: center;
                    padding: 3px 0;
                    font-size: 0.85em;
                }
                .char-row .char-label {
                    color: var(--vscode-foreground);
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .char-row .char-timeline {
                    position: relative;
                    height: 14px;
                    background: var(--vscode-input-background);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 2px;
                    overflow: hidden;
                }
                .char-row .speech-segment {
                    position: absolute;
                    top: 0;
                    bottom: 0;
                    min-width: 1px;
                    opacity: 0.85;
                }
                .char-row .speech-segment.has-audio {
                    background: var(--vscode-charts-blue, #3b82f6);
                }
                .char-row .speech-segment.no-audio {
                    background: var(--vscode-descriptionForeground, #6b7280);
                    opacity: 0.45;
                }
                .char-row.no-audio .char-label {
                    color: var(--vscode-descriptionForeground);
                    font-style: italic;
                }
                .char-row .char-stats {
                    color: var(--vscode-descriptionForeground);
                    font-size: 0.8em;
                    text-align: right;
                    font-variant-numeric: tabular-nums;
                }
                .char-legend {
                    display: flex;
                    gap: 14px;
                    margin: 4px 0 12px 0;
                    font-size: 0.78em;
                    color: var(--vscode-descriptionForeground);
                    align-items: center;
                }
                .char-legend .swatch {
                    display: inline-block;
                    width: 12px;
                    height: 10px;
                    border-radius: 2px;
                    margin-right: 4px;
                    vertical-align: middle;
                }
                .char-legend .swatch.has-audio { background: var(--vscode-charts-blue, #3b82f6); }
                .char-legend .swatch.no-audio { background: var(--vscode-descriptionForeground, #6b7280); opacity: 0.45; }
                .popup-header {
                    flex-shrink: 0;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 12px;
                    color: var(--vscode-charts-yellow, #ca8a04);
                }
                .popup-header h4 { margin: 0; flex: 1; }
                .popup-close {
                    background: none;
                    border: none;
                    color: var(--vscode-editor-foreground);
                    cursor: pointer;
                    padding: 4px;
                    font-size: 16px;
                    opacity: 0.7;
                }
                .popup-close:hover { opacity: 1; background: none; }
                .popup-body {
                    font-size: 0.9em;
                    color: var(--vscode-editor-foreground);
                    line-height: 1.5;
                    display: flex;
                    flex-direction: column;
                    min-height: 0;
                }
                .popup-body > p { flex-shrink: 0; }
                .popup-file-list {
                    margin: 8px 0;
                    padding: 8px 12px;
                    background: rgba(202, 138, 4, 0.08);
                    border: 1px solid rgba(202, 138, 4, 0.25);
                    border-radius: 4px;
                    font-size: 0.9em;
                    flex: 0 1 auto;
                    min-height: 0;
                    max-height: 26vh;
                    overflow-y: auto;
                }
                .popup-file-list div { padding: 2px 0; display: flex; align-items: center; }
                .popup-footer { display: flex; justify-content: flex-end; margin-top: 16px; flex-shrink: 0; }

                /* Step 4: Exporting screen */
                .export-progress-card {
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 6px;
                    padding: 24px;
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                    background: var(--vscode-editor-background);
                }
                .export-progress-header {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                .export-progress-icon {
                    width: 36px;
                    height: 36px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--vscode-input-background);
                    border: 1px solid var(--vscode-input-border);
                    flex-shrink: 0;
                    color: var(--vscode-focusBorder);
                }
                .export-progress-icon .codicon { font-size: 18px; }
                .export-progress-icon.success {
                    background: rgba(34, 197, 94, 0.12);
                    border-color: rgba(34, 197, 94, 0.4);
                    color: var(--vscode-charts-green, #16a34a);
                }
                .export-progress-icon.warn {
                    background: rgba(202, 138, 4, 0.12);
                    border-color: rgba(202, 138, 4, 0.4);
                    color: var(--vscode-charts-yellow, #ca8a04);
                }
                .export-progress-icon.error {
                    background: rgba(220, 38, 38, 0.12);
                    border-color: rgba(220, 38, 38, 0.4);
                    color: var(--vscode-errorForeground, #dc2626);
                }
                .export-progress-title { margin: 0; font-size: 1.05em; }
                .export-progress-subtitle {
                    font-size: 0.85em;
                    color: var(--vscode-descriptionForeground);
                    margin-top: 2px;
                }
                .stage-list {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    padding: 12px;
                    background: var(--vscode-input-background);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                }
                .stage-row {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    font-size: 0.9em;
                    color: var(--vscode-descriptionForeground);
                    transition: color 0.15s ease;
                }
                .stage-row .stage-icon {
                    width: 18px;
                    height: 18px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                }
                .stage-row .stage-icon .codicon { font-size: 14px; }
                .stage-row.active { color: var(--vscode-focusBorder); font-weight: 600; }
                .stage-row.done { color: var(--vscode-charts-green, #16a34a); }
                .stage-row.pending .stage-icon { opacity: 0.45; }
                .export-current-file {
                    font-size: 0.85em;
                    color: var(--vscode-descriptionForeground);
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .export-output-path {
                    font-size: 0.85em;
                    color: var(--vscode-descriptionForeground);
                    background: var(--vscode-input-background);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    padding: 8px 12px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    word-break: break-all;
                }
                .export-action-row {
                    display: flex;
                    gap: 8px;
                    justify-content: flex-end;
                }
                .export-spinner .codicon-sync {
                    animation: codicon-spin 1.5s steps(30, end) infinite;
                }
                @keyframes codicon-spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                .exporting .bottom-bar { display: none !important; }
                .export-extra-messages {
                    font-size: 0.85em;
                    color: var(--vscode-descriptionForeground);
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }
                .export-extra-messages div { padding: 2px 0; }

                /*
                 * Post-export "issues" list. Each problem category (one per
                 * ExportMissingReason) renders as a collapsible group whose
                 * header shows a severity-coloured icon, a human label, a
                 * one-line explanation, and a count badge. Collapsed by
                 * default — the user expands to see the affected cells/files.
                 * Severity colours mirror the Step 1 stat pills above.
                 */
                .export-issues {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                }
                .export-issues-toolbar {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                    /* Extra bottom space so the toggle's hover/active fill never
                     * crowds the first group's header/description below it. */
                    padding: 2px 2px 10px;
                }
                .export-issues-summary {
                    font-size: 0.82em;
                    color: var(--vscode-descriptionForeground);
                }
                /*
                 * Rendered as a compact secondary button rather than a bare text
                 * link. A link-coloured label became unreadable once selected
                 * (blue text on the blue selection highlight); a solid button
                 * background + matching foreground stays legible in every state,
                 * and user-select:none stops it being text-selected at all.
                 */
                .export-issues-toggle-all {
                    display: inline-flex;
                    align-items: center;
                    gap: 5px;
                    font: inherit;
                    font-size: 0.82em;
                    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
                    background: var(--vscode-button-secondaryBackground, transparent);
                    border: 1px solid var(--vscode-input-border, transparent);
                    border-radius: 4px;
                    cursor: pointer;
                    padding: 3px 8px;
                    user-select: none;
                    -webkit-appearance: none;
                    appearance: none;
                }
                .export-issues-toggle-all:hover {
                    background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground, rgba(0,0,0,0.06)));
                    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
                }
                .export-issues-toggle-all:focus-visible {
                    outline: 1px solid var(--vscode-focusBorder, transparent);
                    outline-offset: 1px;
                }
                .export-issues-toggle-all .codicon { font-size: 0.95em; }
                .export-issue-group {
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 6px;
                    overflow: hidden;
                    background: var(--vscode-input-background);
                }
                .export-issue-header {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px 10px;
                    cursor: pointer;
                    user-select: none;
                    font-size: 0.88em;
                }
                .export-issue-header:hover { background: var(--vscode-list-hoverBackground); }
                .export-issue-header .export-issue-chevron {
                    flex-shrink: 0;
                    opacity: 0.7;
                    transition: transform 120ms ease;
                }
                .export-issue-group.open .export-issue-header .export-issue-chevron { transform: rotate(90deg); }
                .export-issue-header .export-issue-icon { flex-shrink: 0; }
                .export-issue-title { font-weight: 600; }
                .export-issue-count {
                    margin-left: auto;
                    flex-shrink: 0;
                    font-size: 0.85em;
                    padding: 0 7px;
                    border-radius: 10px;
                    border: 1px solid transparent;
                }
                .export-issue-desc {
                    font-size: 0.82em;
                    color: var(--vscode-descriptionForeground);
                    padding: 0 10px 8px 34px;
                    margin-top: -2px;
                }
                .export-issue-list {
                    display: none;
                    flex-direction: column;
                    gap: 2px;
                    padding: 0 10px 8px 34px;
                    max-height: 220px;
                    overflow-y: auto;
                }
                .export-issue-group.open .export-issue-list { display: flex; }
                .export-issue-item {
                    font-size: 0.82em;
                    color: var(--vscode-foreground);
                    padding: 2px 0;
                }
                .export-issue-item .export-issue-item-detail {
                    display: block;
                    color: var(--vscode-descriptionForeground);
                    font-size: 0.95em;
                }
                /*
                 * Clickable variant — rendered as a <button> (keyboard focus +
                 * Enter/Space for free) that deep-links into the cell, mirroring
                 * the Step 1 audio-stats popover rows. UA chrome stripped so it
                 * sits flush with the static rows around it.
                 */
                button.export-issue-item {
                    width: 100%;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    text-align: left;
                    font-family: inherit;
                    background: transparent;
                    border: none;
                    border-radius: 3px;
                    cursor: pointer;
                    -webkit-appearance: none;
                    appearance: none;
                }
                button.export-issue-item .export-issue-item-label {
                    flex: 1;
                    min-width: 0;
                    word-break: break-word;
                }
                button.export-issue-item .export-issue-item-icon {
                    flex-shrink: 0;
                    font-size: 0.85em;
                    opacity: 0.55;
                    transition: transform 80ms ease, opacity 80ms ease;
                }
                button.export-issue-item:hover,
                button.export-issue-item:focus-visible {
                    background-color: var(--vscode-list-hoverBackground, rgba(0,0,0,0.04));
                    color: var(--vscode-list-hoverForeground, var(--vscode-foreground));
                    outline: none;
                }
                button.export-issue-item:hover .export-issue-item-icon,
                button.export-issue-item:focus-visible .export-issue-item-icon {
                    opacity: 1;
                    transform: translateX(2px);
                }
                button.export-issue-item:focus-visible {
                    box-shadow: inset 0 0 0 1px var(--vscode-focusBorder, transparent);
                }
                /*
                 * All issue groups share one accent (amber) regardless of
                 * severity — the icon glyph already conveys the distinction,
                 * and a uniform colour reads as a single calm "things to
                 * review" list rather than a red/yellow/grey alarm board.
                 */
                .export-issue-group .export-issue-icon { color: var(--vscode-charts-yellow, #ca8a04); }
                .export-issue-group .export-issue-count {
                    color: var(--vscode-charts-yellow, #ca8a04);
                    background-color: rgba(202, 138, 4, 0.10);
                    border-color: rgba(202, 138, 4, 0.32);
                }

                /*
                 * Clickable Step 1 audio-stat counters. Styled as actual
                 * tags (matching the existing .file-status-tag pattern in
                 * this view) so the affordance reads immediately. The
                 * surrounding "30 with audio" text stays plain, making the
                 * contrast the cue: tags are clickable, prose isn't.
                 */
                .file-audio-stats .stat-pill {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    cursor: pointer;
                    padding: 1px 7px;
                    border-radius: 10px;
                    font: inherit;
                    font-size: 1em;
                    line-height: 1.3;
                    background: transparent;
                    border: 1px solid transparent;
                    transition:
                        background-color 120ms ease,
                        border-color 120ms ease,
                        color 120ms ease;
                }
                .file-audio-stats .stat-pill .codicon {
                    font-size: 0.85em;
                    opacity: 0.7;
                    margin-left: 1px;
                }
                .file-audio-stats .stat-pill:hover .codicon,
                .file-audio-stats .stat-pill:focus-visible .codicon {
                    opacity: 1;
                }
                .file-audio-stats .stat-pill:focus-visible {
                    outline: 1px solid var(--vscode-focusBorder, #2563eb);
                    outline-offset: 1px;
                }
                /* Tier 3 — error: red tint */
                .file-audio-stats .stat-pill.stat-error {
                    color: var(--vscode-errorForeground, #dc2626);
                    background-color: rgba(220, 38, 38, 0.10);
                    border-color: rgba(220, 38, 38, 0.32);
                }
                .file-audio-stats .stat-pill.stat-error:hover {
                    background-color: rgba(220, 38, 38, 0.18);
                    border-color: rgba(220, 38, 38, 0.50);
                }
                /* Tier 2 — warn: yellow tint */
                .file-audio-stats .stat-pill.stat-warn {
                    color: var(--vscode-charts-yellow, #ca8a04);
                    background-color: rgba(202, 138, 4, 0.10);
                    border-color: rgba(202, 138, 4, 0.32);
                }
                .file-audio-stats .stat-pill.stat-warn:hover {
                    background-color: rgba(202, 138, 4, 0.18);
                    border-color: rgba(202, 138, 4, 0.50);
                }
                /* Tier 1 — info: neutral, uses VS Code chrome colours */
                .file-audio-stats .stat-pill.stat-info {
                    color: var(--vscode-descriptionForeground);
                    background-color: var(--vscode-input-background);
                    border-color: var(--vscode-input-border);
                }
                .file-audio-stats .stat-pill.stat-info:hover {
                    background-color: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
                    border-color: var(--vscode-focusBorder, var(--vscode-input-border));
                    color: var(--vscode-foreground);
                }

                /*
                 * Cell list popover. Hand-crafted in plain HTML/CSS so it can
                 * live inside this non-React webview, but the visual
                 * vocabulary is borrowed wholesale from ShadCN's
                 * <PopoverContent>: 1px border, 6px radius, soft shadow,
                 * 16px padding, dropdown-coloured surface, fade+scale entry
                 * animation. When/if this wizard is migrated to React the
                 * styling will port directly to <PopoverContent>.
                 */
                .cell-list-popover-backdrop {
                    position: fixed;
                    inset: 0;
                    z-index: 999;
                    /* Catches outside clicks; the popover itself sits above
                     * it via a higher z-index. */
                    background: transparent;
                    display: none;
                }
                .cell-list-popover-backdrop.open { display: block; }
                .cell-list-popover {
                    position: fixed;
                    z-index: 1000;
                    min-width: 220px;
                    max-width: min(420px, calc(100vw - 32px));
                    max-height: min(360px, calc(100vh - 96px));
                    background-color: var(--vscode-dropdown-background, var(--vscode-editor-background));
                    color: var(--vscode-dropdown-foreground, var(--vscode-editor-foreground));
                    border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, rgba(0,0,0,0.15)));
                    border-radius: 6px;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18), 0 1px 2px rgba(0, 0, 0, 0.08);
                    display: none;
                    flex-direction: column;
                    overflow: hidden;
                    transform-origin: top left;
                    opacity: 0;
                    transform: scale(0.97);
                    transition: opacity 120ms ease, transform 120ms ease;
                }
                .cell-list-popover.open {
                    display: flex;
                    opacity: 1;
                    transform: scale(1);
                }
                .cell-list-popover-header {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 12px 16px 8px 16px;
                    border-bottom: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, rgba(0,0,0,0.08)));
                    flex-shrink: 0;
                }
                .cell-list-popover-title {
                    font-size: 0.85em;
                    font-weight: 600;
                    flex: 1;
                    line-height: 1.3;
                }
                .cell-list-popover-title.title-error { color: var(--vscode-errorForeground, #dc2626); }
                .cell-list-popover-title.title-warn { color: var(--vscode-charts-yellow, #ca8a04); }
                .cell-list-popover-title.title-info { color: var(--vscode-descriptionForeground); }
                .cell-list-popover-count {
                    font-size: 0.72em;
                    font-weight: 500;
                    color: var(--vscode-descriptionForeground);
                    background-color: var(--vscode-badge-background, rgba(0,0,0,0.06));
                    padding: 2px 8px;
                    border-radius: 10px;
                    line-height: 1.3;
                    white-space: nowrap;
                }
                .cell-list-popover-close {
                    width: 22px;
                    height: 22px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    border: none;
                    background: transparent;
                    color: inherit;
                    border-radius: 3px;
                    cursor: pointer;
                    opacity: 0.7;
                    font-size: 0.9em;
                    padding: 0;
                    flex-shrink: 0;
                }
                .cell-list-popover-close:hover { opacity: 1; background-color: var(--vscode-toolbar-hoverBackground, rgba(0,0,0,0.06)); }
                .cell-list-popover-body {
                    flex: 1;
                    overflow-y: auto;
                    padding: 4px 0;
                    min-height: 0;
                }
                .cell-list-popover-item {
                    padding: 6px 16px;
                    font-size: 0.8em;
                    line-height: 1.4;
                    color: var(--vscode-foreground);
                    border-radius: 3px;
                    word-break: break-word;
                }
                .cell-list-popover-item + .cell-list-popover-item {
                    border-top: 1px solid var(--vscode-panel-border, rgba(0,0,0,0.04));
                }
                /*
                 * Clickable variant — rendered as a <button> so it picks up
                 * keyboard focus + Enter/Space activation for free. We
                 * strip the UA chrome so it visually matches the static
                 * <div> rows alongside it.
                 */
                button.cell-list-popover-item {
                    width: 100%;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    text-align: left;
                    font-family: inherit;
                    background: transparent;
                    border: none;
                    cursor: pointer;
                    -webkit-appearance: none;
                    appearance: none;
                }
                button.cell-list-popover-item .cell-list-popover-item-label {
                    flex: 1;
                    min-width: 0;
                }
                button.cell-list-popover-item .cell-list-popover-item-icon {
                    flex-shrink: 0;
                    font-size: 0.85em;
                    opacity: 0.55;
                    transition: transform 80ms ease, opacity 80ms ease;
                }
                button.cell-list-popover-item:hover,
                button.cell-list-popover-item:focus-visible {
                    background-color: var(--vscode-list-hoverBackground, rgba(0,0,0,0.04));
                    color: var(--vscode-list-hoverForeground, var(--vscode-foreground));
                    outline: none;
                }
                button.cell-list-popover-item:hover .cell-list-popover-item-icon,
                button.cell-list-popover-item:focus-visible .cell-list-popover-item-icon {
                    opacity: 1;
                    transform: translateX(2px);
                }
                button.cell-list-popover-item:focus-visible {
                    box-shadow: inset 0 0 0 1px var(--vscode-focusBorder, transparent);
                }
                .cell-list-popover-empty {
                    padding: 12px 16px;
                    font-size: 0.8em;
                    color: var(--vscode-descriptionForeground);
                    font-style: italic;
                }
                .cell-list-popover-footer {
                    padding: 8px 16px;
                    font-size: 0.72em;
                    color: var(--vscode-descriptionForeground);
                    border-top: 1px solid var(--vscode-panel-border, var(--vscode-widget-border, rgba(0,0,0,0.08)));
                    flex-shrink: 0;
                }
            </style>
        </head>
        <body>
            <div class="container">
                ${hasLanguages
            ? `
                <div class="step-content-area">
                <!-- STEP 1: File Selection -->
                <div id="step1" class="step-panel active">
                    <div class="step-content">
                        <h3>Select Files to Export</h3>
                        <p style="color: var(--vscode-descriptionForeground); margin-bottom: 16px;">
                            Select files from one import type only. Files must share the same format (e.g., all USFM or all DOCX).
                        </p>
                        <div id="fileGroupsContainer"></div>
                    </div>
                </div>

                <!-- STEP 2: Export Format -->
                <div id="step2" class="step-panel">
                    <div class="step-content">
                    <h3 id="formatHeading">Select Export Format</h3>
                        <div id="formatOptionsContainer" style="display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1rem;">
                            <!-- Text and markup export: plaintext, XLIFF, USFM, HTML -->
                            <div class="format-section" id="text-export-section">
                                <div class="format-section-header">
                                    <i class="codicon codicon-file-code"></i>
                                    <h4>Text and Markup Export Options</h4>
                                </div>
                                <div id="text-export-formats" class="format-section-content">
                                    <div class="format-option" data-format="plaintext" data-option="plaintext">
                                        <div class="format-option-content">
                                            <strong>Generate Plaintext</strong>
                                            <p>Export as plain text files with minimal formatting</p>
                                        </div>
                                    </div>
                                    <div class="format-option" data-format="xliff" data-option="xliff">
                                        <div class="format-option-content">
                                            <strong>Generate XLIFF</strong>
                                            <p>Export in XML Localization Interchange File Format (XLIFF) for translation workflows</p>
                                            <span class="format-tag">Translation Ready</span>
                                        </div>
                                    </div>
                                </div>
                                <div id="bible-export-formats" class="format-section-content bible-formats-row" data-option="usfm">
                                    <div class="format-option" data-format="usfm" data-option="usfm">
                                        <div class="format-option-content">
                                            <strong>Generate USFM</strong>
                                            <p>Export in Universal Standard Format Markers</p>
                                        </div>
                                    </div>
                                    <div class="format-option" data-format="usfm-no-validate" data-option="usfm">
                                        <div class="format-option-content">
                                            <strong>Generate USFM Without Validation</strong>
                                            <p>Skip USFM validation for a faster export</p>
                                            <span class="format-tag">May produce invalid USFM</span>
                                        </div>
                                    </div>
                                    <div class="format-option" data-format="html" data-option="html">
                                        <div class="format-option-content">
                                            <strong>Generate HTML</strong>
                                            <p>Export as web pages with chapter navigation</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <!-- Subtitle options -->
                            <div class="format-section" id="subtitle-section" data-option="subtitles">
                                <div class="format-section-header">
                                    <i class="codicon codicon-symbol-event"></i>
                                    <h4>Subtitle Export Options</h4>
                                </div>
                                <div id="subtitle-formats" class="format-section-content">
                                    <div class="format-option" data-format="subtitles-srt">
                                        <div class="format-option-content">
                                            <strong>SubRip (SRT)</strong>
                                            <p>Standard subtitle format compatible with most video players</p>
                                            <span class="format-tag">Plain Text Only</span>
                                        </div>
                                    </div>
                                    <div class="format-option" data-format="subtitles-vtt-with-styles">
                                        <div class="format-option-content">
                                            <strong>WebVTT with Styling</strong>
                                            <p>Web-native subtitles with text formatting preserved</p>
                                            <span class="format-tag">Includes Formatting</span>
                                        </div>
                                    </div>
                                    <div class="format-option" data-format="subtitles-vtt-without-styles">
                                        <div class="format-option-content">
                                            <strong>WebVTT Plain</strong>
                                            <p>Web-native subtitles without text formatting</p>
                                            <span class="format-tag">Plain Text Only</span>
                                        </div>
                                    </div>
                                    <div class="format-option" data-format="subtitles-vtt-with-cue-splitting">
                                        <div class="format-option-content">
                                            <strong>WebVTT with Cue Splitting</strong>
                                            <p>Only use this option if you have overlapping subtitles representing independent speakers that need to appear and disappear at different times.</p>
                                            <span class="format-tag">Plain Text Only</span>
                                        </div>
                                    </div>
                                </div>
                                <div class="format-section-suboption">
                                    <label class="format-option-toggle" id="vttExcludeLabelsToggle">
                                        <input type="checkbox" id="vttExcludeLabelsCb">
                                        Exclude speaker labels from WebVTT cues
                                    </label>
                                </div>
                            </div>
                            <!-- Round-trip: only for supported file types -->
                            <div class="roundtrip-wrapper" data-option="roundTrip">
                                <div class="format-option-row${isStreamOnly ? " disabled-stream-only" : ""}">
                                    <div class="format-option" data-format="rebuild-export" style="flex: 1;">
                                        <i class="codicon codicon-refresh"></i>
                                        <div>
                                            <strong>Round-trip Export</strong>
                                            <p>Intelligently detects file type and exports back the original file you imported with applied translations</p>
                                            <div style="display: flex; gap: 0.5rem; margin-top: 0.25rem; flex-wrap: wrap;">
                                                <span class="format-tag format-tag-roundtrip">USFM</span>
                                                <span class="format-tag format-tag-roundtrip">DOCX</span>
                                                <span class="format-tag format-tag-roundtrip">OBS</span>
                                                <span class="format-tag format-tag-roundtrip">TMS</span>
                                                <span class="format-tag format-tag-roundtrip">Markdown</span>
                                                <span class="format-tag format-tag-roundtrip">CSV/TSV</span>
                                                <span class="format-tag format-tag-roundtrip">IDML</span>
                                                <span class="format-tag format-tag-roundtrip">Biblica Study Notes</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                ${isStreamOnly ? `<div class="format-warning" style="margin-top: 6px;">
                                    <i class="codicon codicon-warning"></i>
                                    <span>Round-trip export is unavailable in "Stream Only" mode. Source files are not stored locally, so the original format cannot be reconstructed. Switch to "Auto Download" or "Stream and Save" to enable this option.</span>
                                </div>` : ""}
                            </div>
                            <!-- Data Export: all, always open -->
                            <div class="format-section" data-option="dataExport">
                                <div class="format-section-header">
                                    <i class="codicon codicon-graph"></i>
                                    <h4>Data Export Options</h4>
                                </div>
                                <div id="data-formats" class="format-section-content">
                                    <div class="format-option" data-format="csv">
                                        <div class="format-option-content">
                                            <strong>CSV (Comma-Separated Values)</strong>
                                            <p>Export with ID, source, target, and metadata columns for spreadsheet analysis</p>
                                            <span class="format-tag">Includes Metadata</span>
                                        </div>
                                    </div>
                                    <div class="format-option" data-format="tsv">
                                        <div class="format-option-content">
                                            <strong>TSV (Tab-Separated Values)</strong>
                                            <p>Export with ID, source, target, and metadata columns using tab delimiters</p>
                                            <span class="format-tag">Includes Metadata</span>
                                        </div>
                                    </div>
                                    <div class="format-option" data-format="backtranslations" data-option="backtranslations">
                                        <div class="format-option-content">
                                            <strong>Backtranslations (CSV)</strong>
                                            <p>Export backtranslations as CSV with ID, source text, translation, and backtranslation columns</p>
                                            <span class="format-tag">Quality Assurance</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <h3 id="audioHeading" style="margin-top: 1.5rem;">Select Audio Export Format</h3>
                        <div id="audioOptionsContainer" style="display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1rem;">
                            <div class="format-section" id="audio-export-section" data-option="audio">
                                <div class="format-section-header">
                                    <i class="codicon codicon-mic"></i>
                                    <h4>Audio Export Options</h4>
                                </div>
                                <div id="audio-formats" class="format-section-content">
                                    <div class="format-option audio-option" data-audio-mode="audio">
                                        <div class="format-option-content">
                                            <strong>Include Audio</strong>
                                            <p>Export per-cell audio attachments alongside the selected export format</p>
                                        </div>
                                    </div>
                                    <div class="format-option audio-option" data-audio-mode="audio-timestamps">
                                        <div class="format-option-content">
                                            <strong>Include Audio with Timestamps</strong>
                                            <p>Export per-cell audio attachments alongside the selected export format, and embed timestamps in audio metadata (WAV, WebM, M4A)</p>
                                        </div>
                                    </div>
                                    <div class="format-option audio-option" data-audio-mode="audio-by-character">
                                        <div class="format-option-content">
                                            <strong>Consolidate by Character</strong>
                                            <p>One file per character label. All files start at 0:00 so they drop into a DAW aligned; each is trimmed to that character's last spoken line. Named &lt;file&gt;_&lt;lang&gt;_&lt;character&gt;.&lt;ext&gt;.</p>
                                            <div id="characterAudioControls" style="display:none; margin-top:8px; flex-direction:column; gap:6px;">
                                                <label style="display:flex; align-items:center; gap:8px; font-size:0.9em;">
                                                    <span>Format:</span>
                                                    <select id="characterAudioFormat" onclick="event.stopPropagation()" onchange="event.stopPropagation()" style="background:var(--vscode-input-background); color:var(--vscode-input-foreground); border:1px solid var(--vscode-input-border); border-radius:3px; padding:2px 6px;">
                                                        <option value="flac" selected>FLAC (lossless, small)</option>
                                                        <option value="wav">WAV (PCM, largest)</option>
                                                        <option value="opus">Opus (lossy, smallest)</option>
                                                    </select>
                                                </label>
                                                <button type="button" class="secondary" onclick="event.stopPropagation(); openCharacterPreview();" style="align-self:flex-start;">
                                                    <i class="codicon codicon-preview"></i>
                                                    Preview characters
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- STEP 3: Milestone Selection (bible audio export) -->
                <div id="step3" class="step-panel">
                    <div class="step-content">
                        <h3>Select Milestones</h3>
                        <p style="color: var(--vscode-descriptionForeground); margin-bottom: 16px;">
                            Choose which chapters (milestones) to include in the audio export.
                        </p>
                        <div id="milestoneGroupsContainer"></div>
                    </div>
                </div>

                <!-- STEP 4: Export Location -->
                <div id="step4" class="step-panel">
                    <div class="step-content">
                        <h3>Select Export Location</h3>
                        <p style="color: var(--vscode-descriptionForeground); margin-bottom: 16px;">
                            Choose where to save your exported files.
                        </p>
                        <div class="export-path">
                            <div class="path-display" id="exportPath">No export location selected</div>
                            <button class="secondary" onclick="selectExportPath()">
                                <i class="codicon codicon-folder"></i>
                                Select Location
                            </button>
                        </div>
                        
                    </div>
                </div>

                <!-- Export progress (shown when export starts; not a numbered wizard step) -->
                <div id="stepExporting" class="step-panel">
                    <div class="step-content">
                        <div class="export-progress-card">
                            <div class="export-progress-header">
                                <div class="export-progress-icon export-spinner" id="exportProgressIcon">
                                    <i class="codicon codicon-sync"></i>
                                </div>
                                <div>
                                    <h3 class="export-progress-title" id="exportProgressTitle">Preparing export...</h3>
                                    <div class="export-progress-subtitle" id="exportProgressSubtitle">
                                        This may take a moment. Please keep this view open.
                                    </div>
                                </div>
                            </div>

                            <div class="stage-list" id="exportStageList">
                                <div class="stage-row pending" data-stage="preparing">
                                    <span class="stage-icon"><i class="codicon codicon-circle-large"></i></span>
                                    <span>Preparing files</span>
                                </div>
                                <div class="stage-row pending" data-stage="processing">
                                    <span class="stage-icon"><i class="codicon codicon-circle-large"></i></span>
                                    <span>Processing content</span>
                                </div>
                                <div class="stage-row pending" data-stage="downloading">
                                    <span class="stage-icon"><i class="codicon codicon-circle-large"></i></span>
                                    <span>Downloading media</span>
                                </div>
                                <div class="stage-row pending" data-stage="writing">
                                    <span class="stage-icon"><i class="codicon codicon-circle-large"></i></span>
                                    <span>Writing output</span>
                                </div>
                                <div class="stage-row pending" data-stage="finalizing">
                                    <span class="stage-icon"><i class="codicon codicon-circle-large"></i></span>
                                    <span>Finalizing</span>
                                </div>
                            </div>

                            <div class="export-current-file" id="exportCurrentFile" style="display:none;"></div>

                            <div class="export-extra-messages" id="exportExtraMessages" style="display:none;"></div>

                            <div class="export-issues" id="exportIssues" style="display:none;"></div>

                            <div class="export-output-path" id="exportOutputPath" style="display:none;"></div>

                            <div class="export-action-row" id="exportCancelRow">
                                <button class="secondary" id="exportCancelBtn" onclick="cancelExportRun()">
                                    <i class="codicon codicon-close"></i>
                                    Cancel
                                </button>
                            </div>

                            <div class="export-action-row" id="exportActionRow" style="display:none;">
                                <button class="secondary" id="exportRetryBtn" onclick="retryFailedExport()" style="display:none;">
                                    <i class="codicon codicon-refresh"></i>
                                    <span id="exportRetryBtnText">Retry failed</span>
                                </button>
                                <button class="secondary" id="exportOpenFolderBtn" onclick="openExportFolder()">
                                    <i class="codicon codicon-folder-opened"></i>
                                    Open Export Folder
                                </button>
                                <button id="exportCloseBtn" onclick="closeExportView()">
                                    <i class="codicon codicon-check"></i>
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                </div>

                <div class="bottom-bar">
                    <div class="bottom-bar-left">
                        <button class="secondary step-btn visible" id="btnCancel" onclick="cancel()"><i class="codicon codicon-close"></i><span class="btn-text">Cancel</span></button>
                        <button class="secondary step-btn" id="btnBack" onclick="goBack()"><i class="codicon codicon-arrow-left"></i><span class="btn-text">Back</span></button>
                    </div>
                    <div class="progress-bar">
                        <span class="progress-compact" id="progressCompact">Step 1 of 3</span>
                        <div class="progress-circle active" id="progressCircle1">1</div>
                        <div class="progress-line" id="progressLine1"></div>
                        <div class="progress-circle" id="progressCircle2">2</div>
                        <div class="progress-line" id="progressLine2"></div>
                        <div class="progress-circle" id="progressCircle3">3</div>
                        <div class="progress-line" id="progressLine3"></div>
                        <div class="progress-circle" id="progressCircle4">4</div>
                    </div>
                    <div class="bottom-bar-right">
                        <button class="step-btn visible" id="nextStep1" disabled onclick="goToStep2()"><span class="btn-text">Next Step</span><i class="codicon codicon-arrow-right"></i></button>
                        <button class="step-btn" id="nextStep2" disabled onclick="advanceFromStep2()"><span class="btn-text">Next Step</span><i class="codicon codicon-arrow-right"></i></button>
                        <button class="step-btn" id="nextStep3" disabled onclick="goToStep4()"><span class="btn-text">Next Step</span><i class="codicon codicon-arrow-right"></i></button>
                        <button class="step-btn" id="exportButton" disabled onclick="exportProject()"><span class="btn-text">Export</span><i class="codicon codicon-arrow-down"></i></button>
                    </div>
                </div>
                `
            : `
                <div class="message">
                    Please set source and target languages first
                    <div class="button-container" style="justify-content: center">
                        <button onclick="openProjectSettings()">Open Project Settings</button>
                    </div>
                </div>
                `
        }
            </div>

            <div class="popup-overlay" id="contentMismatchPopup">
                <div class="popup-card">
                    <div class="popup-header">
                        <i class="codicon codicon-warning"></i>
                        <h4 id="contentMismatchTitle">Missing Content</h4>
                    </div>
                    <div class="popup-body">
                        <p id="contentMismatchSummary"></p>
                        <div class="popup-file-list" id="contentMismatchFileList"></div>
                    </div>
                    <div class="popup-footer">
                        <button onclick="closeContentMismatchPopup()">OK</button>
                    </div>
                </div>
            </div>

            <div class="popup-overlay" id="characterPreviewPopup" onclick="if(event.target===this)closeCharacterPreviewPopup()">
                <div class="popup-card wide">
                    <div class="popup-header" style="color: var(--vscode-foreground);">
                        <i class="codicon codicon-preview"></i>
                        <h4>Character Audio Preview</h4>
                        <button class="popup-close" onclick="closeCharacterPreviewPopup()" title="Close">
                            <i class="codicon codicon-close"></i>
                        </button>
                    </div>
                    <div class="popup-body">
                        <p style="color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-top: 0;">
                            One row per character per file. Blue bars are speaking turns with audio attached. Grey bars are lines that have timing but no audio yet — these characters won't be exported until recordings are added. Files start at 0:00 and are trimmed to that character's last <em>recorded</em> line.
                        </p>
                        <div class="char-legend">
                            <span><span class="swatch has-audio"></span>has audio (exports)</span>
                            <span><span class="swatch no-audio"></span>timed line, no audio (skipped)</span>
                        </div>
                        <div id="characterPreviewBody"></div>
                    </div>
                </div>
            </div>

            <div class="popup-overlay" id="htmlMismatchPopup" onclick="if(event.target===this)closeHtmlMismatchPopup()">
                <div class="popup-card">
                    <div class="popup-header">
                        <i class="codicon codicon-warning"></i>
                        <h4>HTML Structure Mismatch</h4>
                        <button class="popup-close" onclick="closeHtmlMismatchPopup()" title="Close">
                            <i class="codicon codicon-close"></i>
                        </button>
                    </div>
                    <div class="popup-body">
                        <p id="htmlMismatchSummary"></p>
                        <div class="popup-file-list" id="htmlMismatchFileList"></div>
                        <p style="margin-top: 8px; color: var(--vscode-descriptionForeground); font-size: 0.85em;">
                            Review and resolve these in the editor before exporting, or proceed with the export anyway.
                        </p>
                    </div>
                </div>
            </div>

            <!-- Cell list popover (Step 1 audio-stat drill-down) -->
            <div id="cellListPopoverBackdrop" class="cell-list-popover-backdrop" aria-hidden="true"></div>
            <div
                id="cellListPopover"
                class="cell-list-popover"
                role="dialog"
                aria-modal="false"
                aria-labelledby="cellListPopoverTitle"
            >
                <div class="cell-list-popover-header">
                    <span id="cellListPopoverTitle" class="cell-list-popover-title">Affected cells</span>
                    <span id="cellListPopoverCount" class="cell-list-popover-count">0</span>
                    <button
                        type="button"
                        id="cellListPopoverClose"
                        class="cell-list-popover-close"
                        aria-label="Close"
                    >
                        <i class="codicon codicon-close"></i>
                    </button>
                </div>
                <div id="cellListPopoverBody" class="cell-list-popover-body"></div>
                <div id="cellListPopoverFooter" class="cell-list-popover-footer"></div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                const fileGroups = ${groupsJson};
                const exportOptionsConfig = ${exportOptionsConfigJson};
                const isStreamOnly = ${JSON.stringify(isStreamOnly)};
                let currentStep = 1;
                let selectedFormat = null;
                let selectedAudioMode = null; // null | 'audio' | 'audio-timestamps' | 'audio-by-character'
                let exportPath = ${initialExportFolderJson};
                let selectedFiles = new Set();
                let selectedGroupKey = null;
                /** @type {Record<string, Set<number>>} */
                let selectedMilestonesByFile = {};

                function shouldShowMilestoneStep() {
                    if (!selectedAudioMode) return false;
                    for (const path of selectedFiles) {
                        const f = fileLookup[path];
                        if (f && f.hasSelectableMilestones && f.milestones && f.milestones.length > 0) {
                            return true;
                        }
                    }
                    return false;
                }

                function getTotalStepCount() {
                    return shouldShowMilestoneStep() ? 4 : 3;
                }

                function getProgressDisplayStep(step) {
                    if (!shouldShowMilestoneStep() && step === 4) return 3;
                    return step;
                }

                /** @type {string[]} Maps milestone UI file index to codex path */
                let milestoneFilePaths = [];

                function initMilestoneSelection() {
                    selectedMilestonesByFile = {};
                    milestoneFilePaths = [];
                    for (const path of selectedFiles) {
                        const f = fileLookup[path];
                        if (f && f.hasSelectableMilestones && f.milestones && f.milestones.length > 0) {
                            selectedMilestonesByFile[path] = new Set(f.milestones.map(m => m.index));
                            milestoneFilePaths.push(path);
                        }
                    }
                    renderMilestoneSelection();
                    updateStep3Button();
                }

                function renderMilestoneSelection() {
                    const container = document.getElementById('milestoneGroupsContainer');
                    if (!container) return;
                    if (milestoneFilePaths.length === 0) {
                        container.innerHTML = '<p style="color: var(--vscode-descriptionForeground);">No milestones found in the selected files.</p>';
                        return;
                    }
                    container.innerHTML = milestoneFilePaths.map((filePath, fileIdx) => {
                        const f = fileLookup[filePath];
                        const selectedSet = selectedMilestonesByFile[filePath] || new Set();
                        const allSelected = f.milestones.every(m => selectedSet.has(m.index));
                        const selectAllId = 'milestone-select-all-' + fileIdx;
                        const milestonesHtml = f.milestones.map((m, mIdx) => {
                            const cbId = 'milestone-' + fileIdx + '-' + mIdx;
                            const checked = selectedSet.has(m.index) ? 'checked' : '';
                            const label = ((m.value || String(m.index + 1)).replace(/<[^>]*>/g, '').trim()) || String(m.index + 1);
                            return \`
                                <div class="milestone-item">
                                    <input type="checkbox" id="\${cbId}" data-file-idx="\${fileIdx}" data-milestone-index="\${m.index}" \${checked}
                                        onchange="onMilestoneCheckboxChange(\${fileIdx}, \${m.index})">
                                    <label for="\${cbId}">\${label}</label>
                                </div>
                            \`;
                        }).join('');
                        return \`
                            <div class="milestone-file-group" data-file-idx="\${fileIdx}">
                                <div class="milestone-file-header">
                                    <h4><i class="codicon codicon-file"></i> \${f.displayName}</h4>
                                    <label class="milestone-select-all" onclick="event.stopPropagation()">
                                        <input type="checkbox" id="\${selectAllId}" data-file-idx="\${fileIdx}" \${allSelected ? 'checked' : ''}
                                            onchange="onMilestoneSelectAllChange(\${fileIdx})"> Select all
                                    </label>
                                </div>
                                <div class="milestone-list">\${milestonesHtml}</div>
                            </div>
                        \`;
                    }).join('');
                }

                function onMilestoneCheckboxChange(fileIdx, milestoneIndex) {
                    const filePath = milestoneFilePaths[fileIdx];
                    if (!filePath) return;
                    if (!selectedMilestonesByFile[filePath]) {
                        selectedMilestonesByFile[filePath] = new Set();
                    }
                    const cb = document.querySelector('input[data-file-idx="' + fileIdx + '"][data-milestone-index="' + milestoneIndex + '"]');
                    if (cb && cb.checked) {
                        selectedMilestonesByFile[filePath].add(milestoneIndex);
                    } else {
                        selectedMilestonesByFile[filePath].delete(milestoneIndex);
                    }
                    syncMilestoneSelectAllCheckbox(fileIdx);
                    updateStep3Button();
                }

                function onMilestoneSelectAllChange(fileIdx) {
                    const filePath = milestoneFilePaths[fileIdx];
                    const f = filePath ? fileLookup[filePath] : null;
                    if (!f || !f.milestones) return;
                    const selectAllCb = document.querySelector('.milestone-file-group[data-file-idx="' + fileIdx + '"] input[data-file-idx]:not([data-milestone-index])');
                    const shouldSelectAll = selectAllCb && selectAllCb.checked;
                    if (!selectedMilestonesByFile[filePath]) {
                        selectedMilestonesByFile[filePath] = new Set();
                    }
                    if (shouldSelectAll) {
                        f.milestones.forEach(m => selectedMilestonesByFile[filePath].add(m.index));
                    } else {
                        selectedMilestonesByFile[filePath].clear();
                    }
                    renderMilestoneSelection();
                    updateStep3Button();
                }

                function syncMilestoneSelectAllCheckbox(fileIdx) {
                    const filePath = milestoneFilePaths[fileIdx];
                    const f = filePath ? fileLookup[filePath] : null;
                    if (!f || !f.milestones) return;
                    const selectedSet = selectedMilestonesByFile[filePath] || new Set();
                    const allSelected = f.milestones.every(m => selectedSet.has(m.index));
                    const selectAllCb = document.querySelector('.milestone-file-group[data-file-idx="' + fileIdx + '"] input[data-file-idx]:not([data-milestone-index])');
                    if (selectAllCb) selectAllCb.checked = allSelected;
                }

                function updateStep3Button() {
                    const btn = document.getElementById('nextStep3');
                    if (!btn) return;
                    let anySelected = false;
                    for (const path of selectedFiles) {
                        const set = selectedMilestonesByFile[path];
                        if (set && set.size > 0) {
                            anySelected = true;
                            break;
                        }
                    }
                    btn.disabled = !anySelected;
                }

                function buildSelectedMilestonesPayload() {
                    if (!shouldShowMilestoneStep()) return undefined;
                    const payload = {};
                    for (const path of milestoneFilePaths) {
                        const set = selectedMilestonesByFile[path];
                        payload[path] = set ? Array.from(set).sort((a, b) => a - b) : [];
                    }
                    return Object.keys(payload).length > 0 ? payload : undefined;
                }

                // Build a path→file lookup so Step 2 can check audio-only status
                const fileLookup = {};
                fileGroups.forEach(g => g.files.forEach(f => { fileLookup[f.path] = f; }));

                function isSelectionAudioOnly() {
                    if (selectedFiles.size === 0) return false;
                    for (const path of selectedFiles) {
                        const f = fileLookup[path];
                        if (!f) return false;
                        if (f.hasTranslations) return false;
                    }
                    return true;
                }

                function selectionHasAudio() {
                    for (const path of selectedFiles) {
                        const f = fileLookup[path];
                        if (f && f.hasAudio) return true;
                    }
                    return false;
                }

                /*
                 * Step 1 audio-stat counter → clickable pill. Cell label
                 * arrays already live on fileGroups[g].files[f].audioStats —
                 * we just point the pill at them via data attributes and the
                 * delegated click handler in setupCellListPopover() looks
                 * them up at click time. No HTML-embedded JSON, no separate
                 * payload store.
                 */
                function renderStatPill(gIdx, fIdx, bucket, severity, count, label, title) {
                    return [
                        '<button type="button"',
                        ' class="stat-pill stat-' + severity + '"',
                        ' data-popover-trigger="cellList"',
                        ' data-group-idx="' + gIdx + '"',
                        ' data-file-idx="' + fIdx + '"',
                        ' data-bucket="' + bucket + '"',
                        ' data-severity="' + severity + '"',
                        ' data-title="' + escapeHtml(title) + '"',
                        ' aria-label="' + escapeHtml(title + ' (' + count + ')') + '"',
                        ' aria-haspopup="dialog"',
                        '>',
                        '<span>' + count + ' ' + escapeHtml(label) + '</span>',
                        '<i class="codicon codicon-chevron-down" aria-hidden="true"></i>',
                        '</button>'
                    ].join('');
                }

                /*
                 * Cell list popover — opens on click of a stat-pill, shows
                 * the full list of affected cells with a scrollable body,
                 * closes on outside click or Escape. Visually matches the
                 * ShadCN <PopoverContent> used in the React webviews.
                 */
                const cellListPopoverState = {
                    open: false,
                    lastFocused: null,
                    // Identifies which (filePath, bucket) is currently in
                    // view so the body's scroll listener knows where to
                    // write. Null when no popover is open.
                    currentKey: null,
                    // Per-(filePath, bucket) scroll position, preserved for
                    // the lifetime of this webview. Lets the user pop a
                    // long cell list open, scroll down, peek at another
                    // count, and come back to where they were. Keyed by
                    // path (stable across renders) rather than indices.
                    scrollMemory: new Map(),
                    bucketKeys: {
                        selectionMissing: 'selectionMissingCells',
                        selectedPossiblyMissing: 'selectedPossiblyMissingCells',
                        noneSelected: 'noneSelectedCells',
                        noAudioRecorded: 'noAudioRecordedCells'
                    }
                };

                /*
                 * Builds the popover body markup for a list of affected cells.
                 * Shared by the initial open and the in-place refresh so both
                 * render identical rows. Entries are { label, cellId } (see
                 * analyzeNotebookAudioStats); when cellId + filePath are both
                 * present we render a clickable button that deep-links into the
                 * editor, otherwise a static row (defensive for older shapes).
                 */
                function renderCellListPopoverBody(cells, filePath) {
                    if (!cells || cells.length === 0) {
                        return '<div class="cell-list-popover-empty">No cells in this bucket.</div>';
                    }
                    return cells.map(entry => {
                        const label = (entry && typeof entry === 'object') ? entry.label : entry;
                        const cellId = (entry && typeof entry === 'object') ? entry.cellId : '';
                        const clickable = !!(cellId && filePath);
                        if (clickable) {
                            return [
                                '<button type="button" class="cell-list-popover-item is-clickable"',
                                ' data-cell-id="' + escapeHtml(String(cellId)) + '"',
                                ' data-file-path="' + escapeHtml(String(filePath)) + '"',
                                ' title="Open this cell in the editor">',
                                '<span class="cell-list-popover-item-label">' + escapeHtml(String(label || '')) + '</span>',
                                '<i class="codicon codicon-arrow-right cell-list-popover-item-icon" aria-hidden="true"></i>',
                                '</button>'
                            ].join('');
                        }
                        return '<div class="cell-list-popover-item">' + escapeHtml(String(label || '')) + '</div>';
                    }).join('');
                }

                /*
                 * Refreshes the OPEN popover's contents in place when the file
                 * it's showing gets a live stats update (e.g. the user fixed a
                 * take, so it drops out of the list). Does NOT reposition — the
                 * panel may be hidden in the background (layout rects read 0
                 * there), and the popover should stay anchored where the user
                 * left it. Closes the popover only if its bucket is now empty.
                 */
                function refreshOpenCellListPopover(path, audioStats) {
                    if (!cellListPopoverState.open || typeof cellListPopoverState.currentKey !== 'string') return;
                    // currentKey is 'filePath|bucket'; paths never contain '|',
                    // so split on the last separator.
                    const sep = cellListPopoverState.currentKey.lastIndexOf('|');
                    if (sep < 0) return;
                    const openPath = cellListPopoverState.currentKey.slice(0, sep);
                    const openBucket = cellListPopoverState.currentKey.slice(sep + 1);
                    if (openPath !== path) return;
                    const statsKey = cellListPopoverState.bucketKeys[openBucket];
                    const cells = (audioStats && statsKey && Array.isArray(audioStats[statsKey])) ? audioStats[statsKey] : [];
                    if (cells.length === 0) {
                        closeCellListPopover();
                        return;
                    }
                    const countEl = document.getElementById('cellListPopoverCount');
                    const bodyEl = document.getElementById('cellListPopoverBody');
                    const footerEl = document.getElementById('cellListPopoverFooter');
                    if (!countEl || !bodyEl || !footerEl) return;
                    countEl.textContent = String(cells.length);
                    bodyEl.innerHTML = renderCellListPopoverBody(cells, path);
                    footerEl.textContent = cells.length === 1 ? '1 cell' : cells.length + ' cells';
                }

                function openCellListPopover(anchorEl, title, severity, cells, memoryKey, filePath) {
                    const root = document.getElementById('cellListPopover');
                    const backdrop = document.getElementById('cellListPopoverBackdrop');
                    const titleEl = document.getElementById('cellListPopoverTitle');
                    const countEl = document.getElementById('cellListPopoverCount');
                    const bodyEl = document.getElementById('cellListPopoverBody');
                    const footerEl = document.getElementById('cellListPopoverFooter');
                    if (!root || !backdrop || !titleEl || !countEl || !bodyEl || !footerEl) return;

                    titleEl.className = 'cell-list-popover-title title-' + severity;
                    titleEl.textContent = title;
                    countEl.textContent = String(cells.length);
                    bodyEl.innerHTML = renderCellListPopoverBody(cells, filePath);
                    footerEl.textContent = cells.length === 1
                        ? '1 cell'
                        : cells.length + ' cells';

                    // currentKey must be assigned BEFORE we restore scroll —
                    // otherwise the synthetic scroll event our restore
                    // triggers would write into the previous key's slot.
                    cellListPopoverState.currentKey = memoryKey || null;

                    // Look up the saved scroll for this (file, bucket). We
                    // can't APPLY it yet — see the rAF block below — but
                    // grab it now while we still have local context.
                    const savedScroll = memoryKey && cellListPopoverState.scrollMemory.has(memoryKey)
                        ? cellListPopoverState.scrollMemory.get(memoryKey)
                        : 0;

                    // Show before positioning so getBoundingClientRect is
                    // accurate. CSS keeps it invisible until the .open class
                    // toggles opacity.
                    root.style.display = 'flex';
                    backdrop.classList.add('open');

                    positionCellListPopover(anchorEl, root);

                    // Apply scrollTop AFTER display:flex and AFTER layout has
                    // run (rAF guarantees that). If we set scrollTop while
                    // the popover root was still display:none (which happens
                    // when the previous close's 140ms hide timeout had time
                    // to fire), the browser silently clamps the value to 0
                    // because the element has no scroll range yet — and on
                    // re-show the body keeps whatever residual scrollTop
                    // the DOM element carried from the previous popover's
                    // content. Doing it in rAF fixes both:
                    //   - first-time opens always land at 0
                    //   - re-opens restore the user's saved position
                    requestAnimationFrame(() => {
                        bodyEl.scrollTop = savedScroll;
                        root.classList.add('open');
                    });

                    cellListPopoverState.open = true;
                    cellListPopoverState.lastFocused = anchorEl || null;
                    // Send keyboard focus into the popover so Escape works
                    // without needing to click first.
                    const closeBtn = document.getElementById('cellListPopoverClose');
                    if (closeBtn && typeof closeBtn.focus === 'function') closeBtn.focus();
                }

                function closeCellListPopover() {
                    if (!cellListPopoverState.open) return;
                    const root = document.getElementById('cellListPopover');
                    const backdrop = document.getElementById('cellListPopoverBackdrop');
                    const bodyEl = document.getElementById('cellListPopoverBody');
                    if (!root || !backdrop) return;

                    // Snapshot the scroll position before we hide so the
                    // next open of the same (file, bucket) lands where the
                    // user left off. We also save on every scroll event,
                    // but capturing here covers the case where the popover
                    // is closed via Escape/outside-click without a final
                    // scroll firing first.
                    if (bodyEl && cellListPopoverState.currentKey) {
                        cellListPopoverState.scrollMemory.set(
                            cellListPopoverState.currentKey,
                            bodyEl.scrollTop
                        );
                    }

                    root.classList.remove('open');
                    backdrop.classList.remove('open');
                    // Hide after the transition to keep tab order clean.
                    setTimeout(() => {
                        if (!cellListPopoverState.open) root.style.display = 'none';
                    }, 140);
                    cellListPopoverState.open = false;
                    cellListPopoverState.currentKey = null;
                    if (cellListPopoverState.lastFocused && typeof cellListPopoverState.lastFocused.focus === 'function') {
                        try { cellListPopoverState.lastFocused.focus(); } catch { /* noop */ }
                    }
                }

                /*
                 * Position the popover below the anchor by default, flipping
                 * above when there isn't enough room. Stays inside the
                 * viewport horizontally. Same heuristics as ValidatorPopover
                 * in the React webview, simplified for our use case.
                 */
                function positionCellListPopover(anchorEl, popoverEl) {
                    if (!anchorEl || !popoverEl) return;
                    const anchor = anchorEl.getBoundingClientRect();
                    const pop = popoverEl.getBoundingClientRect();
                    const vw = window.innerWidth;
                    const vh = window.innerHeight;
                    const margin = 8;

                    let top;
                    const spaceBelow = vh - anchor.bottom;
                    const spaceAbove = anchor.top;
                    if (spaceBelow >= pop.height + margin || spaceBelow >= spaceAbove) {
                        top = Math.min(anchor.bottom + 6, vh - pop.height - margin);
                    } else {
                        top = Math.max(margin, anchor.top - pop.height - 6);
                    }

                    let left = anchor.left;
                    if (left + pop.width > vw - margin) {
                        left = Math.max(margin, vw - pop.width - margin);
                    }
                    left = Math.max(margin, left);

                    popoverEl.style.top = top + 'px';
                    popoverEl.style.left = left + 'px';
                }

                function setupCellListPopover() {
                    // Delegated click handler — pills are recreated whenever
                    // renderFileGroups runs, so attaching to each one would
                    // leak listeners.
                    document.addEventListener('click', (event) => {
                        const target = event.target;
                        if (!target || !target.closest) return;

                        // Clickable cell row in the completion screen's grouped
                        // issues list — deep-link into the codex editor, same as
                        // the Step 1 popover rows below.
                        const issueRow = target.closest('button.export-issue-item.is-clickable');
                        if (issueRow) {
                            const cellId = issueRow.getAttribute('data-cell-id');
                            const filePath = issueRow.getAttribute('data-file-path');
                            if (cellId && filePath) {
                                vscode.postMessage({
                                    command: 'openCellInEditor',
                                    cellId: cellId,
                                    filePath: filePath,
                                });
                                event.stopPropagation();
                                return;
                            }
                        }

                        // Clickable cell row inside the popover — deep-link
                        // into the codex editor. We intentionally KEEP the
                        // popover open: opening the cell sends the export tab
                        // to the background, and the user wants the list still
                        // there when they return so they can work through the
                        // affected cells one by one. (As each cell is fixed and
                        // saved, the live stats refresh drops it from the list.)
                        // Handled before the outside-click fallback below.
                        const cellRow = target.closest('button.cell-list-popover-item.is-clickable');
                        if (cellRow) {
                            const cellId = cellRow.getAttribute('data-cell-id');
                            const filePath = cellRow.getAttribute('data-file-path');
                            if (cellId && filePath) {
                                vscode.postMessage({
                                    command: 'openCellInEditor',
                                    cellId: cellId,
                                    filePath: filePath,
                                });
                                event.stopPropagation();
                                return;
                            }
                        }

                        const trigger = target.closest('[data-popover-trigger="cellList"]');
                        if (trigger) {
                            const gIdx = Number(trigger.getAttribute('data-group-idx'));
                            const fIdx = Number(trigger.getAttribute('data-file-idx'));
                            const bucket = trigger.getAttribute('data-bucket');
                            const severity = trigger.getAttribute('data-severity') || 'info';
                            const title = trigger.getAttribute('data-title') || 'Affected cells';
                            const group = fileGroups[gIdx];
                            const file = group && group.files && group.files[fIdx];
                            const stats = file && file.audioStats;
                            const key = cellListPopoverState.bucketKeys[bucket];
                            const cells = (stats && key && Array.isArray(stats[key])) ? stats[key] : [];
                            // Memory key uses the file path (stable across
                            // re-renders) plus bucket, so filter toggles
                            // and other in-place re-renders don't blow
                            // away the user's scroll position.
                            const memoryKey = (file && file.path ? file.path : ('g' + gIdx + '-f' + fIdx)) + '|' + bucket;
                            const filePath = (file && file.path) ? file.path : '';
                            openCellListPopover(trigger, title, severity, cells, memoryKey, filePath);
                            event.stopPropagation();
                            return;
                        }

                        // Outside click — close. The backdrop catches most of
                        // these but clicks on un-bubbled UI (e.g. file group
                        // checkbox labels) need this fallback.
                        if (cellListPopoverState.open) {
                            const insidePopover = target.closest && target.closest('#cellListPopover');
                            if (!insidePopover) closeCellListPopover();
                        }
                    });

                    const backdrop = document.getElementById('cellListPopoverBackdrop');
                    if (backdrop) {
                        backdrop.addEventListener('click', () => closeCellListPopover());
                    }
                    const closeBtn = document.getElementById('cellListPopoverClose');
                    if (closeBtn) {
                        closeBtn.addEventListener('click', () => closeCellListPopover());
                    }

                    // Persist scroll position live as the user scrolls. This
                    // also covers cases where the close path can't read the
                    // final scrollTop (e.g. dispose, navigation away).
                    const bodyEl = document.getElementById('cellListPopoverBody');
                    if (bodyEl) {
                        bodyEl.addEventListener('scroll', () => {
                            if (!cellListPopoverState.open || !cellListPopoverState.currentKey) return;
                            cellListPopoverState.scrollMemory.set(
                                cellListPopoverState.currentKey,
                                bodyEl.scrollTop
                            );
                        });
                    }
                    document.addEventListener('keydown', (e) => {
                        if (e.key === 'Escape' && cellListPopoverState.open) {
                            closeCellListPopover();
                            e.stopPropagation();
                        }
                    });
                    window.addEventListener('resize', () => {
                        if (cellListPopoverState.open) closeCellListPopover();
                    });
                    // Close the popover when the page behind it scrolls, but
                    // NOT when the user is scrolling inside the popover's own
                    // list. The popover itself is position: fixed, so we
                    // don't need to reposition on outer scroll — just
                    // dismiss it so it doesn't hover over unrelated content.
                    document.addEventListener('scroll', (event) => {
                        if (!cellListPopoverState.open) return;
                        const target = event.target;
                        if (target && target.closest && target.closest('#cellListPopover')) {
                            return;
                        }
                        closeCellListPopover();
                    }, true);
                }

                /*
                 * Builds the audio-stat pill row for one file. Shared between
                 * the initial render and the live per-file patch
                 * (applyFileAudioStatsUpdate) so both always agree on layout,
                 * severity ordering, and which buckets get a drill-down pill.
                 * Returns '' when there's nothing to show.
                 */
                function buildAudioStatsHtml(f, gIdx, fIdx) {
                    if (!f.audioStats || !(f.audioStats.eligibleCellCount > 0)) return '';
                    const parts = [];
                    if (f.audioStats.audioReadyCount > 0) {
                        // No drill-down for the "ready" bucket — these
                        // cells will export fine, nothing actionable.
                        parts.push('<span>' + f.audioStats.audioReadyCount + ' with audio</span>');
                    }
                    // Severity ordering matches the post-export
                    // summary: errors first, then warns, then info.
                    if (f.audioStats.selectionMissingCount > 0) {
                        parts.push(renderStatPill(
                            gIdx, fIdx,
                            'selectionMissing',
                            'error',
                            f.audioStats.selectionMissingCount,
                            'with selected audio missing',
                            f.displayName + ' — selected audio is missing'
                        ));
                    }
                    if (f.audioStats.selectedPossiblyMissingCount > 0) {
                        parts.push(renderStatPill(
                            gIdx, fIdx,
                            'selectedPossiblyMissing',
                            'warn',
                            f.audioStats.selectedPossiblyMissingCount,
                            'with selected take possibly missing',
                            f.displayName + ' — selected take flagged as possibly missing'
                        ));
                    }
                    if (f.audioStats.noneSelectedCount > 0) {
                        parts.push(renderStatPill(
                            gIdx, fIdx,
                            'noneSelected',
                            'warn',
                            f.audioStats.noneSelectedCount,
                            'with audio, none selected',
                            f.displayName + ' — audio available, none selected'
                        ));
                    }
                    if (f.audioStats.noAudioRecordedCount > 0) {
                        parts.push(renderStatPill(
                            gIdx, fIdx,
                            'noAudioRecorded',
                            'info',
                            f.audioStats.noAudioRecordedCount,
                            'without audio',
                            f.displayName + ' — cells without audio'
                        ));
                    }
                    if (parts.length === 0) return '';
                    return '<div class="file-audio-stats">' + parts.join(' \u00b7 ') + '</div>';
                }

                /*
                 * Builds the markup for a single file row. Extracted so the
                 * live patch can re-render just one row when a .codex is saved.
                 */
                function renderFileItem(group, f, gIdx, fIdx) {
                    const id = 'file-' + gIdx + '-' + fIdx;
                    const isEmpty = !f.hasTranslations && !f.hasAudio;
                    const isAudioOnly = !f.hasTranslations && f.hasAudio;
                    const isTextOnly = f.hasTranslations && !f.hasAudio;
                    const isTextAudio = f.hasTranslations && f.hasAudio;
                    const contentType = isEmpty ? 'none' : (isAudioOnly ? 'audio-only' : (isTextOnly ? 'text-only' : 'text-audio'));
                    const disabledAttr = isEmpty ? 'disabled' : '';
                    const itemClass = 'file-item' + (isEmpty ? ' file-item-disabled' : '');
                    let tooltip = f.displayName;
                    if (isEmpty) tooltip = 'No translations or audio to export';
                    else if (isAudioOnly) tooltip = f.displayName + ' (audio only)';
                    else if (isTextOnly) tooltip = f.displayName + ' (text only)';
                    else if (isTextAudio) tooltip = f.displayName + ' (text + audio)';
                    let statusTag = '';
                    if (isEmpty) {
                        statusTag = '<span class="file-status-tag no-content-tag">No content</span>';
                    } else if (isAudioOnly) {
                        statusTag = '<span class="file-status-tag audio-only-tag">Audio only</span>';
                    } else if (isTextOnly) {
                        statusTag = '<span class="file-status-tag text-only-tag">Text only</span>';
                    } else if (isTextAudio) {
                        statusTag = '<span class="file-status-tag text-audio-tag">Text + Audio</span>';
                    }
                    const audioStatsHtml = buildAudioStatsHtml(f, gIdx, fIdx);
                    return \`
                                <div class="\${itemClass}" data-content-type="\${contentType}">
                                    <input type="checkbox" id="\${id}" value="\${f.path}" data-group-key="\${group.groupKey}" data-content-type="\${contentType}" \${disabledAttr} onchange="onFileCheckboxChange()">
                                    <div class="file-item-main">
                                        <label for="\${id}" title="\${tooltip}">\${f.displayName}</label>
                                        \${audioStatsHtml}
                                    </div>
                                    \${statusTag}
                                </div>
                            \`;
                }

                /*
                 * Live patch: a .codex was saved while the wizard is open, so
                 * re-render just that file's row (keeping its checkbox selection
                 * and refreshing filter/footer state). Falls back silently when
                 * the file isn't on screen (e.g. a brand-new .codex — picked up
                 * on the next time the wizard opens).
                 */
                function applyFileAudioStatsUpdate(path, hasAudio, hasTranslations, audioStats) {
                    let gIdx = -1, fIdx = -1, group = null, f = null;
                    for (let gi = 0; gi < fileGroups.length; gi++) {
                        const files = fileGroups[gi].files;
                        for (let fi = 0; fi < files.length; fi++) {
                            if (files[fi].path === path) {
                                gIdx = gi; fIdx = fi; group = fileGroups[gi]; f = files[fi];
                                break;
                            }
                        }
                        if (f) break;
                    }
                    if (!f) return;

                    f.hasAudio = hasAudio;
                    f.hasTranslations = hasTranslations;
                    f.audioStats = audioStats;

                    const cb = document.getElementById('file-' + gIdx + '-' + fIdx);
                    const item = cb ? cb.closest('.file-item') : null;
                    if (!item) return;

                    const wasChecked = !!(cb && cb.checked);
                    const tmp = document.createElement('div');
                    tmp.innerHTML = renderFileItem(group, f, gIdx, fIdx).trim();
                    const fresh = tmp.firstElementChild;
                    if (!fresh) return;
                    item.replaceWith(fresh);

                    // Restore selection: the template renders unchecked, but the
                    // file may still be selected. If it just became empty
                    // (no content), drop it from the selection instead.
                    const newCb = document.getElementById('file-' + gIdx + '-' + fIdx);
                    const isEmptyNow = !f.hasTranslations && !f.hasAudio;
                    if (newCb) {
                        if (isEmptyNow) {
                            newCb.checked = false;
                            selectedFiles.delete(path);
                        } else {
                            newCb.checked = wasChecked;
                            if (wasChecked) selectedFiles.add(path); else selectedFiles.delete(path);
                        }
                    }

                    // Refresh dependent UI (group lock, compatibility, footer).
                    updateSelectedGroup();
                    syncHeaderCheckboxes();
                    updateStep1Button();

                    // If the drill-down popover is open for THIS file, refresh
                    // its list in place (the popover is a separate top-level
                    // element, so re-rendering the row above didn't disturb it).
                    // This keeps the list open while the user fixes cells, with
                    // fixed cells dropping out as their saves arrive.
                    refreshOpenCellListPopover(path, audioStats);
                }

                function renderFileGroups() {
                    const container = document.getElementById('fileGroupsContainer');
                    if (!container) return;
                    if (fileGroups.length === 0) {
                        container.innerHTML = '<p style="color: var(--vscode-descriptionForeground);">No Codex files found in this project.</p>';
                        return;
                    }
                    container.innerHTML = fileGroups.map((group, gIdx) => {
                        const groupId = 'group-' + gIdx;
                        const enabledCount = group.files.filter(f => f.hasTranslations || f.hasAudio).length;
                        const groupDisabled = enabledCount === 0;
                        const hasTextFiles = group.files.some(f => f.hasTranslations);
                        const hasAudioFiles = group.files.some(f => f.hasAudio);
                        const filesHtml = group.files.map((f, fIdx) => renderFileItem(group, f, gIdx, fIdx)).join('');
                        return \`
                            <div class="file-group" id="\${groupId}" data-group-key="\${group.groupKey}">
                                <div class="file-group-header">
                                    <h4><i class="codicon codicon-folder"></i> \${group.displayName}</h4>
                                    <label class="group-filter-cb \${hasTextFiles ? '' : 'filter-disabled'}" onclick="event.stopPropagation()">
                                        <input type="checkbox" data-group-key="\${group.groupKey}" data-filter="text" \${hasTextFiles ? '' : 'disabled'} onchange="onFilterCheckboxChange('\${group.groupKey}', 'text')"> All text
                                    </label>
                                    <label class="group-filter-cb \${hasAudioFiles ? '' : 'filter-disabled'}" onclick="event.stopPropagation()">
                                        <input type="checkbox" data-group-key="\${group.groupKey}" data-filter="audio" \${hasAudioFiles ? '' : 'disabled'} onchange="onFilterCheckboxChange('\${group.groupKey}', 'audio')"> All audio
                                    </label>
                                </div>
                                <div class="file-group-content">\${filesHtml}</div>
                            </div>
                        \`;
                    }).join('');
                }

                function onFilterCheckboxChange(groupKey, filterType) {
                    if (selectedGroupKey && selectedGroupKey !== groupKey) return;
                    const group = document.querySelector('.file-group[data-group-key="' + groupKey + '"]');
                    if (!group) return;
                    const textCb = group.querySelector('input[data-filter="text"]');
                    const audioCb = group.querySelector('input[data-filter="audio"]');
                    if (filterType === 'text') {
                        if (textCb && textCb.checked) {
                            if (audioCb) {
                                audioCb.checked = false;
                                group.querySelectorAll('.file-group-content input[data-content-type="audio-only"]').forEach(cb => {
                                    cb.checked = false;
                                    selectedFiles.delete(cb.value);
                                });
                            }
                            group.querySelectorAll('.file-group-content input[data-content-type="text-only"], .file-group-content input[data-content-type="text-audio"]').forEach(cb => {
                                if (!cb.disabled) { cb.checked = true; selectedFiles.add(cb.value); }
                            });
                        } else {
                            group.querySelectorAll('.file-group-content input[data-content-type="text-only"], .file-group-content input[data-content-type="text-audio"]').forEach(cb => {
                                cb.checked = false;
                                selectedFiles.delete(cb.value);
                            });
                        }
                    } else if (filterType === 'audio') {
                        if (audioCb && audioCb.checked) {
                            if (textCb) {
                                textCb.checked = false;
                                group.querySelectorAll('.file-group-content input[data-content-type="text-only"]').forEach(cb => {
                                    cb.checked = false;
                                    selectedFiles.delete(cb.value);
                                });
                            }
                            group.querySelectorAll('.file-group-content input[data-content-type="audio-only"], .file-group-content input[data-content-type="text-audio"]').forEach(cb => {
                                if (!cb.disabled) { cb.checked = true; selectedFiles.add(cb.value); }
                            });
                        } else {
                            group.querySelectorAll('.file-group-content input[data-content-type="audio-only"], .file-group-content input[data-content-type="text-audio"]').forEach(cb => {
                                cb.checked = false;
                                selectedFiles.delete(cb.value);
                            });
                        }
                    }
                    updateSelectedGroup();
                    updateStep1Button();
                }

                function syncHeaderCheckboxes() {
                    document.querySelectorAll('.file-group').forEach(group => {
                        const textCb = group.querySelector('input[data-filter="text"]');
                        const audioCb = group.querySelector('input[data-filter="audio"]');
                        const textEligible = Array.from(group.querySelectorAll('.file-group-content input[data-content-type="text-only"], .file-group-content input[data-content-type="text-audio"]')).filter(cb => !cb.closest('.file-item').classList.contains('file-item-disabled'));
                        const audioEligible = Array.from(group.querySelectorAll('.file-group-content input[data-content-type="audio-only"], .file-group-content input[data-content-type="text-audio"]')).filter(cb => !cb.closest('.file-item').classList.contains('file-item-disabled'));
                        const allTextChecked = textEligible.length > 0 && textEligible.every(cb => cb.checked);
                        const allAudioChecked = audioEligible.length > 0 && audioEligible.every(cb => cb.checked);
                        if (allTextChecked && allAudioChecked) {
                            if (textCb && !textCb.checked && audioCb && !audioCb.checked) {
                                // Neither was previously checked — don't auto-check either
                            } else if (textCb && textCb.checked) {
                                if (audioCb) audioCb.checked = false;
                            } else if (audioCb && audioCb.checked) {
                                if (textCb) textCb.checked = false;
                            }
                        } else {
                            if (textCb) textCb.checked = allTextChecked;
                            if (audioCb) audioCb.checked = allAudioChecked;
                        }
                    });
                }

                function onFileCheckboxChange() {
                    selectedFiles.clear();
                    document.querySelectorAll('.file-group-content input[type="checkbox"]:checked').forEach(cb => {
                        selectedFiles.add(cb.value);
                    });
                    updateSelectedGroup();
                    syncHeaderCheckboxes();
                    updateStep1Button();
                }

                function getSelectedContentTypes() {
                    const types = new Set();
                    for (const path of selectedFiles) {
                        const f = fileLookup[path];
                        if (f) {
                            if (f.hasTranslations && f.hasAudio) types.add('text-audio');
                            else if (f.hasTranslations) types.add('text-only');
                            else if (f.hasAudio) types.add('audio-only');
                        }
                    }
                    return types;
                }

                function isContentTypeCompatible(contentType, selectedTypes) {
                    if (selectedTypes.size === 0 || contentType === 'none') return true;
                    if (contentType === 'text-audio') return true;
                    if (contentType === 'audio-only') return !selectedTypes.has('text-only');
                    if (contentType === 'text-only') return !selectedTypes.has('audio-only');
                    return true;
                }

                function updateContentTypeCompatibility() {
                    const selectedTypes = getSelectedContentTypes();
                    document.querySelectorAll('.file-group-content .file-item').forEach(item => {
                        const ct = item.dataset.contentType;
                        if (ct === 'none') return;
                        const cb = item.querySelector('input[type="checkbox"]');
                        if (!cb) return;
                        if (cb.checked) {
                            item.classList.remove('file-item-incompatible');
                            return;
                        }
                        const compatible = isContentTypeCompatible(ct, selectedTypes);
                        item.classList.toggle('file-item-incompatible', !compatible);
                        cb.disabled = !compatible;
                    });
                    document.querySelectorAll('.file-group:not(.disabled)').forEach(group => {
                        const textFilterCb = group.querySelector('input[data-filter="text"]');
                        const audioFilterCb = group.querySelector('input[data-filter="audio"]');
                        if (textFilterCb && !textFilterCb.checked) {
                            const hasTextEligible = !!group.querySelector('.file-group-content input[data-content-type="text-only"], .file-group-content input[data-content-type="text-audio"]');
                            const blocked = selectedTypes.has('audio-only');
                            const shouldDisable = blocked || !hasTextEligible;
                            textFilterCb.disabled = shouldDisable;
                            const label = textFilterCb.closest('.group-filter-cb');
                            if (label) label.classList.toggle('filter-disabled', shouldDisable);
                        }
                        if (audioFilterCb && !audioFilterCb.checked) {
                            const hasAudioEligible = !!group.querySelector('.file-group-content input[data-content-type="audio-only"], .file-group-content input[data-content-type="text-audio"]');
                            const blocked = selectedTypes.has('text-only');
                            const shouldDisable = blocked || !hasAudioEligible;
                            audioFilterCb.disabled = shouldDisable;
                            const label = audioFilterCb.closest('.group-filter-cb');
                            if (label) label.classList.toggle('filter-disabled', shouldDisable);
                        }
                    });
                }

                function updateSelectedGroup() {
                    const keys = new Set();
                    document.querySelectorAll('.file-group-content input[type="checkbox"]:checked').forEach(cb => {
                        keys.add(cb.dataset.groupKey);
                    });
                    if (keys.size === 1) selectedGroupKey = keys.values().next().value;
                    else if (keys.size === 0) selectedGroupKey = null;
                    document.querySelectorAll('.file-group').forEach(group => {
                        const key = group.dataset.groupKey;
                        group.classList.toggle('disabled', selectedGroupKey !== null && selectedGroupKey !== key);
                    });
                    updateContentTypeCompatibility();
                }

                function updateStep1Button() {
                    const btn = document.getElementById('nextStep1');
                    if (btn) btn.disabled = selectedFiles.size === 0;
                }

                function initStep2Options(resetFormatSelection) {
                    const key = selectedGroupKey || 'unknown';
                    const audioOnly = isSelectionAudioOnly();
                    const hasAudio = selectionHasAudio();
                    const noAudio = !hasAudio;
                    const show = (option) => {
                        const allowed = exportOptionsConfig[option];
                        if (!allowed) return true;
                        return allowed.includes(key);
                    };
                    document.querySelectorAll('[data-option]').forEach(el => {
                        const opt = el.dataset.option;
                        const visible = show(opt);
                        el.classList.toggle('hidden', !visible);
                    });

                    // When all selected files are audio-only, hide every non-audio section
                    const formatContainer = document.getElementById('formatOptionsContainer');
                    if (formatContainer) formatContainer.classList.toggle('hidden', audioOnly);
                    const formatHeading = document.getElementById('formatHeading');
                    if (formatHeading) formatHeading.classList.toggle('hidden', audioOnly);

                    // When no selected files have audio, hide the audio section entirely
                    const audioSection = document.getElementById('audio-export-section');
                    const audioHeading = document.getElementById('audioHeading');
                    if (audioSection) audioSection.classList.toggle('hidden', noAudio);
                    if (audioHeading) audioHeading.classList.toggle('hidden', noAudio);

                    // Show/hide the info banner (audio-only or no-audio)
                    let banner = document.getElementById('exportEligibilityBanner');
                    const bannerNeeded = audioOnly || noAudio;
                    if (bannerNeeded) {
                        const bannerText = audioOnly
                            ? 'Selected files contain only audio — only audio export is available.'
                            : 'Selected files contain text only — audio export options are hidden.';
                        const bannerColor = 'color:var(--vscode-charts-yellow,#ca8a04);background-color:rgba(202,138,4,0.12);border:1px solid rgba(202,138,4,0.35);';
                        if (!banner) {
                            banner = document.createElement('div');
                            banner.id = 'exportEligibilityBanner';
                            const stepContent = document.querySelector('#step2 .step-content');
                            if (stepContent) stepContent.prepend(banner);
                        }
                        banner.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 14px;margin-bottom:12px;border-radius:4px;font-size:0.9em;' + bannerColor;
                        banner.innerHTML = '<i class="codicon codicon-warning"></i><span>' + bannerText + '</span>';
                    } else if (banner) {
                        banner.style.display = 'none';
                    }

                    // Only clear text format when entering step 2 from step 1 (file group may have changed).
                    // When returning from step 3, keep the user's format choice; audio already behaved this way.
                    if (resetFormatSelection) {
                        selectedFormat = null;
                        document.querySelectorAll('#step2 .format-option:not(.audio-option)').forEach(opt => {
                            opt.classList.remove('selected');
                            opt.style.backgroundColor = '';
                            opt.style.borderColor = '';
                        });
                        if (audioOnly || noAudio) {
                            selectedAudioMode = null;
                            document.querySelectorAll('#step2 .audio-option').forEach(opt => {
                                opt.classList.remove('selected');
                                opt.style.backgroundColor = '';
                                opt.style.borderColor = '';
                            });
                        }
                    } else if (noAudio && selectedAudioMode) {
                        selectedAudioMode = null;
                        document.querySelectorAll('#step2 .audio-option').forEach(opt => {
                            opt.classList.remove('selected');
                            opt.style.backgroundColor = '';
                            opt.style.borderColor = '';
                        });
                    }
                    try { updateCharacterAudioControls(); } catch (e) {}
                    updateStep2Button();
                }

                function updateButtonVisibility() {
                    document.querySelectorAll('.step-btn').forEach(btn => btn.classList.remove('visible'));
                    const cancel = document.getElementById('btnCancel');
                    const back = document.getElementById('btnBack');
                    const next1 = document.getElementById('nextStep1');
                    const next2 = document.getElementById('nextStep2');
                    const next3 = document.getElementById('nextStep3');
                    const exportBtn = document.getElementById('exportButton');
                    if (currentStep === 1) {
                        if (cancel) cancel.classList.add('visible');
                        if (next1) next1.classList.add('visible');
                    } else if (currentStep === 2) {
                        if (back) back.classList.add('visible');
                        if (next2) next2.classList.add('visible');
                    } else if (currentStep === 3) {
                        if (back) back.classList.add('visible');
                        if (next3) next3.classList.add('visible');
                    } else if (currentStep === 4) {
                        if (back) back.classList.add('visible');
                        if (exportBtn) exportBtn.classList.add('visible');
                    }
                }

                function updateProgressBarVisuals(activeStep) {
                    const showMilestones = shouldShowMilestoneStep();
                    const circle3 = document.getElementById('progressCircle3');
                    const circle4 = document.getElementById('progressCircle4');
                    const line3 = document.getElementById('progressLine3');
                    if (circle4) circle4.style.display = showMilestones ? '' : 'none';
                    if (line3) line3.style.display = showMilestones ? '' : 'none';

                    const resetCircle = (circle, label) => {
                        if (!circle) return;
                        circle.classList.remove('active', 'completed');
                        circle.textContent = String(label);
                    };

                    resetCircle(document.getElementById('progressCircle1'), 1);
                    resetCircle(document.getElementById('progressCircle2'), 2);
                    resetCircle(circle3, showMilestones ? 3 : 3);
                    resetCircle(circle4, 4);

                    const setCircleState = (circleId, state) => {
                        const circle = document.getElementById(circleId);
                        if (!circle) return;
                        circle.classList.remove('active', 'completed');
                        if (state === 'completed') {
                            circle.classList.add('completed');
                            circle.innerHTML = '<i class="codicon codicon-check"></i>';
                        } else if (state === 'active') {
                            circle.classList.add('active');
                        }
                    };

                    if (showMilestones) {
                        for (let step = 1; step <= 4; step++) {
                            const state = step < activeStep ? 'completed' : (step === activeStep ? 'active' : 'idle');
                            if (state !== 'idle') setCircleState('progressCircle' + step, state);
                        }
                        document.querySelectorAll('[id^="progressLine"]').forEach((line, i) => {
                            line.classList.remove('completed');
                            if (i + 1 < activeStep) line.classList.add('completed');
                        });
                    } else {
                        const circleSteps = [
                            { circle: 1, step: 1 },
                            { circle: 2, step: 2 },
                            { circle: 3, step: 4 },
                        ];
                        for (const { circle, step } of circleSteps) {
                            const state = step < activeStep ? 'completed' : (step === activeStep ? 'active' : 'idle');
                            if (state !== 'idle') setCircleState('progressCircle' + circle, state);
                        }
                        const line1 = document.getElementById('progressLine1');
                        const line2 = document.getElementById('progressLine2');
                        if (line1) line1.classList.toggle('completed', activeStep > 1);
                        if (line2) line2.classList.toggle('completed', activeStep >= 4);
                    }

                    const compact = document.getElementById('progressCompact');
                    if (compact) {
                        compact.textContent = 'Step ' + getProgressDisplayStep(activeStep) + ' of ' + getTotalStepCount();
                    }
                }

                function goBack() {
                    if (currentStep === 4) {
                        goToStep(shouldShowMilestoneStep() ? 3 : 2);
                    } else {
                        goToStep(currentStep - 1);
                    }
                }

                function goToStep(n) {
                    const prevStep = currentStep;
                    document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
                    document.getElementById('step' + n).classList.add('active');
                    updateProgressBarVisuals(n);
                    currentStep = n;
                    updateButtonVisibility();
                    if (n === 2) {
                        initStep2Options(prevStep === 1);
                    } else if (n === 3 && shouldShowMilestoneStep()) {
                        initMilestoneSelection();
                    } else if (n === 4) {
                        updateExportButton();
                    }
                }

                function goToStep1() { goToStep(1); }
                function goToStep2() { goToStep(2); }
                function goToStep3() { goToStep(3); }
                function goToStep4() { goToStep(4); }

                function advanceToNextStepAfterFormat() {
                    goToStep(shouldShowMilestoneStep() ? 3 : 4);
                }

                function updateStep2Button() {
                    const btn = document.getElementById('nextStep2');
                    // Allow moving forward if a format is selected OR audio-only is selected
                    if (btn) btn.disabled = !(selectedFormat || selectedAudioMode);
                }

                function updateExportButton() {
                    const btn = document.getElementById('exportButton');
                    // Export allowed if a format or audio is selected
                    const hasAnyFormat = !!(selectedFormat || selectedAudioMode);
                    if (btn) btn.disabled = !hasAnyFormat || !exportPath || selectedFiles.size === 0;
                }

                function openProjectSettings() {
                    vscode.postMessage({ command: 'openProjectSettings' });
                }

                function selectExportPath() {
                    vscode.postMessage({ command: 'selectExportPath' });
                }

                function cancel() {
                    vscode.postMessage({ command: 'cancel' });
                }

                function cancelExportRun() {
                    // Avoid a double-send if the user mashes the button; also a
                    // no-op once the run has already settled.
                    if (exportState.finished || exportState.cancelRequested) return;
                    exportState.cancelRequested = true;
                    const btn = document.getElementById('exportCancelBtn');
                    if (btn) btn.disabled = true;
                    setExportTitle('Cancelling export...', 'Stopping downloads and cleaning up partial output.');
                    vscode.postMessage({ command: 'cancelExport' });
                }

                // Step 4 (Exporting) state
                const STAGE_ORDER = ['preparing', 'processing', 'downloading', 'writing', 'finalizing'];
                const exportState = {
                    started: false,
                    finished: false,
                    succeeded: false,
                    cancelRequested: false,
                    cancelled: false,
                    stageIndex: -1,
                    extraMessages: [],
                    // Per-cell/per-file problems collected from exportFileMissing
                    // events during the run, rendered as a grouped, expandable
                    // list once the export completes.
                    missingFiles: [],
                    outputPath: null,
                    // Folder the audio files landed in (may be an audio/ subfolder
                    // for multi-format). A targeted retry writes recovered files
                    // back here.
                    audioOutputPath: null,
                    // Options from the last export request, reused for retry.
                    lastOptions: null,
                    // True while a targeted "retry failed downloads" is running.
                    retrying: false,
                    // How many cells the in-flight retry attempted (for the
                    // "X recovered, Y still failing" summary).
                    retryAttempted: 0,
                    lastTitle: 'Exporting...',
                    lastSubtitle: 'This may take a moment. Please keep this view open.',
                };

                // Failure reasons that are worth retrying — transient / recoverable
                // (network, disk, transcode hiccups). User-action reasons (no take
                // chosen, selected-missing, nothing recorded) are excluded.
                const RETRYABLE_EXPORT_REASONS = new Set([
                    'download-failed',
                    'transcode-failed',
                    'write-failed',
                ]);

                function resetExportProgressView() {
                    exportState.started = false;
                    exportState.finished = false;
                    exportState.succeeded = false;
                    exportState.cancelRequested = false;
                    exportState.cancelled = false;
                    exportState.stageIndex = -1;
                    exportState.extraMessages = [];
                    exportState.missingFiles = [];
                    exportState.outputPath = null;
                    exportState.audioOutputPath = null;
                    exportState.retrying = false;
                    exportState.retryAttempted = 0;
                    exportState.lastTitle = 'Exporting...';
                    exportState.lastSubtitle = 'This may take a moment. Please keep this view open.';

                    const icon = document.getElementById('exportProgressIcon');
                    if (icon) {
                        icon.classList.remove('success', 'error', 'warn');
                        icon.classList.add('export-spinner');
                        icon.innerHTML = '<i class="codicon codicon-sync"></i>';
                    }
                    setExportTitle('Preparing export...', 'This may take a moment. Please keep this view open.');

                    document.querySelectorAll('#exportStageList .stage-row').forEach(row => {
                        row.classList.remove('active', 'done');
                        row.classList.add('pending');
                        const stageIcon = row.querySelector('.stage-icon');
                        if (stageIcon) stageIcon.innerHTML = '<i class="codicon codicon-circle-large"></i>';
                    });

                    const currentFile = document.getElementById('exportCurrentFile');
                    if (currentFile) { currentFile.style.display = 'none'; currentFile.textContent = ''; }

                    const extras = document.getElementById('exportExtraMessages');
                    if (extras) { extras.style.display = 'none'; extras.innerHTML = ''; }

                    const issues = document.getElementById('exportIssues');
                    if (issues) { issues.style.display = 'none'; issues.innerHTML = ''; }

                    const outPath = document.getElementById('exportOutputPath');
                    if (outPath) { outPath.style.display = 'none'; outPath.textContent = ''; }

                    const actionRow = document.getElementById('exportActionRow');
                    if (actionRow) actionRow.style.display = 'none';

                    // Cancel control is visible only while the export is running.
                    const cancelRow = document.getElementById('exportCancelRow');
                    if (cancelRow) cancelRow.style.display = 'flex';
                    const cancelBtn = document.getElementById('exportCancelBtn');
                    if (cancelBtn) cancelBtn.disabled = false;
                }

                function escapeHtml(s) {
                    return String(s).replace(/[&<>"']/g, c => ({
                        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
                    })[c]);
                }

                function setExportTitle(title, subtitle) {
                    exportState.lastTitle = title;
                    if (typeof subtitle === 'string') exportState.lastSubtitle = subtitle;
                    const titleEl = document.getElementById('exportProgressTitle');
                    const subEl = document.getElementById('exportProgressSubtitle');
                    if (titleEl) titleEl.textContent = title;
                    if (subEl) subEl.textContent = exportState.lastSubtitle;
                }

                function setStageState(stageKey, state) {
                    const row = document.querySelector('#exportStageList .stage-row[data-stage="' + stageKey + '"]');
                    if (!row) return;
                    row.classList.remove('active', 'done', 'pending');
                    row.classList.add(state);
                    const icon = row.querySelector('.stage-icon');
                    if (!icon) return;
                    if (state === 'done') {
                        icon.innerHTML = '<i class="codicon codicon-check"></i>';
                    } else if (state === 'active') {
                        icon.innerHTML = '<i class="codicon codicon-sync export-spinner-inline"></i>';
                        // Reuse spin animation
                        const spinning = icon.querySelector('.codicon-sync');
                        if (spinning) spinning.style.animation = 'codicon-spin 1.5s steps(30, end) infinite';
                    } else {
                        icon.innerHTML = '<i class="codicon codicon-circle-large"></i>';
                    }
                }

                function handleExportStage(stageKey, message, file, current, total) {
                    const idx = STAGE_ORDER.indexOf(stageKey);
                    if (idx === -1) return;
                    // Reflect the most-recently-reported stage as the active one.
                    // Exports interleave stages: the text exporter's "writing"
                    // runs concurrently with audio "downloading", and audio
                    // alternates download/write per file. A monotonic (furthest-
                    // wins) indicator would get stuck on "Writing output" while
                    // audio is still downloading, so we follow the latest event
                    // instead. Only re-render when the stage actually changes to
                    // avoid redundant DOM churn.
                    if (idx !== exportState.stageIndex) {
                        for (let i = 0; i < STAGE_ORDER.length; i++) {
                            if (i < idx) setStageState(STAGE_ORDER[i], 'done');
                            else if (i === idx) setStageState(STAGE_ORDER[i], 'active');
                            else setStageState(STAGE_ORDER[i], 'pending');
                        }
                        exportState.stageIndex = idx;
                    }

                    if (message) {
                        setExportTitle(message, exportState.lastSubtitle);
                    }

                    // The progress count now lives in the title (message); this
                    // line shows only the specific item in flight — a cell label
                    // while writing, or a file name for text exports. Audio
                    // downloads run concurrently (no single item) so the exporter
                    // omits the file and this line stays hidden, which removes the
                    // duplicate count and the misleading ".codex" name that isn't
                    // actually what's being downloaded.
                    const currentFile = document.getElementById('exportCurrentFile');
                    if (currentFile) {
                        if (file) {
                            currentFile.textContent = file;
                            currentFile.style.display = 'block';
                        } else {
                            currentFile.style.display = 'none';
                            currentFile.textContent = '';
                        }
                    }
                }

                function showExtraMessages(messages) {
                    if (!messages || messages.length === 0) return;
                    exportState.extraMessages.push(...messages);
                    const extras = document.getElementById('exportExtraMessages');
                    if (!extras) return;
                    extras.innerHTML = exportState.extraMessages
                        .map(m => '<div>' + String(m).replace(/</g, '&lt;') + '</div>')
                        .join('');
                    extras.style.display = 'block';
                }

                // Human-readable metadata for each ExportMissingReason emitted by
                // the exporters. Severity drives colour + ordering (error >
                // warn > info); the description spells out what the category
                // means so the count in the summary line is actionable. Keep in
                // sync with ExportMissingReason / severityForReason in
                // src/exportHandler/exportProgress.ts.
                const EXPORT_REASON_META = {
                    'download-failed': {
                        severity: 'error',
                        icon: 'cloud-download',
                        label: "Audio couldn't be downloaded",
                        description: "This audio is stored online but couldn't be downloaded — usually a network or sign-in problem. Trying the export again often fixes it.",
                    },
                    'audio-file-missing': {
                        severity: 'error',
                        icon: 'circle-slash',
                        label: 'Audio file(s) missing',
                        description: "An audio recording is selected for the cell, but it couldn't be found locally or on the server. The recording may need to be re-recorded.",
                    },
                    'transcode-failed': {
                        severity: 'error',
                        icon: 'error',
                        label: "Audio couldn't be converted",
                        description: "We found the audio but couldn't prepare it for export. The recording may be damaged or in a format we don't support.",
                    },
                    'write-failed': {
                        severity: 'error',
                        icon: 'error',
                        label: "Couldn't save the file",
                        description: "We found the audio but couldn't save the exported file. You may be out of disk space or not have permission to save there.",
                    },
                    'error': {
                        severity: 'error',
                        icon: 'error',
                        label: 'Something went wrong',
                        description: "These cells couldn't be exported because of an unexpected problem. See the note next to each one for details.",
                    },
                    'selected-audio-missing-alternatives': {
                        severity: 'warn',
                        icon: 'warning',
                        label: 'Selected recording missing (other recordings available)',
                        description: "The recording chosen for these cells couldn't be found, but each cell has other recordings. Open the cell and pick a different recording — no need to record again.",
                    },
                    'no-audio-selected': {
                        severity: 'warn',
                        icon: 'warning',
                        label: 'No recording chosen',
                        description: 'These cells have one or more recordings, but none was chosen to export. Open the cell and pick which recording to use.',
                    },
                    'pointer-corrupt': {
                        severity: 'warn',
                        icon: 'warning',
                        label: 'Audio reference is broken',
                        description: "The link to this audio is broken, so we couldn't find the actual file. Re-syncing the project will likely fix it.",
                    },
                    'source-not-found': {
                        severity: 'warn',
                        icon: 'warning',
                        label: 'Source file missing',
                        description: "The original file this export is based on couldn't be found, so it was skipped.",
                    },
                    'no-audio-recorded': {
                        severity: 'info',
                        icon: 'info',
                        label: 'No audio recorded',
                        description: "These cells don't have any audio recorded yet, so there was nothing to export.",
                    },
                    'no-text-recorded': {
                        severity: 'info',
                        icon: 'info',
                        label: 'No text written',
                        description: "These files don't have any translated text yet, so there was nothing to export.",
                    },
                };
                const EXPORT_SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };

                function toggleExportIssue(headerEl) {
                    const group = headerEl.closest('.export-issue-group');
                    if (group) group.classList.toggle('open');
                    syncExpandAllLabel();
                }

                // Expand / collapse every issue group at once. If any group is
                // still collapsed, the action expands all; otherwise it collapses
                // all.
                function toggleAllExportIssues() {
                    const groups = Array.from(document.querySelectorAll('#exportIssues .export-issue-group'));
                    if (groups.length === 0) return;
                    const anyClosed = groups.some(g => !g.classList.contains('open'));
                    groups.forEach(g => g.classList.toggle('open', anyClosed));
                    syncExpandAllLabel();
                }

                // Keep the toggle's label/icon in sync with the current state.
                function syncExpandAllLabel() {
                    const btn = document.getElementById('exportIssuesToggleAll');
                    if (!btn) return;
                    const groups = Array.from(document.querySelectorAll('#exportIssues .export-issue-group'));
                    const allOpen = groups.length > 0 && groups.every(g => g.classList.contains('open'));
                    btn.innerHTML = allOpen
                        ? '<i class="codicon codicon-collapse-all"></i>Collapse all'
                        : '<i class="codicon codicon-expand-all"></i>Expand all';
                }

                function renderExportIssues() {
                    const container = document.getElementById('exportIssues');
                    if (!container) return;
                    const items = exportState.missingFiles || [];
                    if (items.length === 0) {
                        container.style.display = 'none';
                        container.innerHTML = '';
                        return;
                    }

                    // Group by reason, preserving first-seen order within a group.
                    const groups = new Map();
                    for (const it of items) {
                        const reason = it.reason || 'error';
                        if (!groups.has(reason)) groups.set(reason, []);
                        groups.get(reason).push(it);
                    }

                    // Order groups by severity (error first), then alphabetically
                    // by label for stable output.
                    const ordered = Array.from(groups.entries()).sort((a, b) => {
                        const ma = EXPORT_REASON_META[a[0]] || { severity: 'error', label: a[0] };
                        const mb = EXPORT_REASON_META[b[0]] || { severity: 'error', label: b[0] };
                        const sa = EXPORT_SEVERITY_ORDER[ma.severity] ?? 0;
                        const sb = EXPORT_SEVERITY_ORDER[mb.severity] ?? 0;
                        if (sa !== sb) return sa - sb;
                        return String(ma.label).localeCompare(String(mb.label));
                    });

                    // Header bar: total count + an expand/collapse-all toggle.
                    const totalIssues = items.length;
                    const headerHtml =
                        '<div class="export-issues-toolbar">' +
                            '<span class="export-issues-summary">' + totalIssues + ' item' + (totalIssues === 1 ? '' : 's') + ' to review</span>' +
                            '<button type="button" class="export-issues-toggle-all" id="exportIssuesToggleAll" onclick="toggleAllExportIssues()">' +
                                '<i class="codicon codicon-expand-all"></i>Expand all' +
                            '</button>' +
                        '</div>';

                    const groupsHtml = ordered.map(([reason, list]) => {
                        const meta = EXPORT_REASON_META[reason] || {
                            severity: 'error',
                            icon: 'error',
                            label: reason,
                            description: '',
                        };
                        // The group header already explains the reason, so we
                        // don't repeat the per-cell detail on every row (it was
                        // redundant). Any per-cell specifics (e.g. a raw write
                        // error) are kept on the title tooltip for hover. When
                        // we know which cell an entry came from, render it as a
                        // clickable row that deep-links into the editor — same
                        // UX as the Step 1 "problematic cells" popover.
                        const itemsHtml = list.map(it => {
                            const name = escapeHtml(String(it.file || ''));
                            const titleAttr = it.detail
                                ? ' title="' + escapeHtml(String(it.detail)) + '"'
                                : '';
                            const cellId = it.cellId ? escapeHtml(String(it.cellId)) : '';
                            const filePath = it.codexPath ? escapeHtml(String(it.codexPath)) : '';
                            if (cellId && filePath) {
                                return (
                                    '<button type="button" class="export-issue-item is-clickable"' +
                                    ' data-cell-id="' + cellId + '"' +
                                    ' data-file-path="' + filePath + '"' +
                                    (it.detail ? titleAttr : ' title="Open this cell in the editor"') + '>' +
                                        '<span class="export-issue-item-label">' + name + '</span>' +
                                        '<i class="codicon codicon-arrow-right export-issue-item-icon" aria-hidden="true"></i>' +
                                    '</button>'
                                );
                            }
                            return '<div class="export-issue-item"' + titleAttr + '>' + name + '</div>';
                        }).join('');
                        return (
                            '<div class="export-issue-group sev-' + meta.severity + '">' +
                                '<div class="export-issue-header" onclick="toggleExportIssue(this)">' +
                                    '<i class="codicon codicon-chevron-right export-issue-chevron"></i>' +
                                    '<i class="codicon codicon-' + meta.icon + ' export-issue-icon"></i>' +
                                    '<span class="export-issue-title">' + escapeHtml(meta.label) + '</span>' +
                                    '<span class="export-issue-count">' + list.length + '</span>' +
                                '</div>' +
                                (meta.description
                                    ? '<div class="export-issue-desc">' + escapeHtml(meta.description) + '</div>'
                                    : '') +
                                '<div class="export-issue-list">' + itemsHtml + '</div>' +
                            '</div>'
                        );
                    }).join('');
                    container.innerHTML = headerHtml + groupsHtml;
                    container.style.display = 'flex';
                    syncExpandAllLabel();
                    updateRetryButton();
                }

                function showOutputPath(path) {
                    if (!path) return;
                    exportState.outputPath = path;
                    const el = document.getElementById('exportOutputPath');
                    if (!el) return;
                    el.textContent = path;
                    el.style.display = 'block';
                }

                function hideCancelRow() {
                    const cancelRow = document.getElementById('exportCancelRow');
                    if (cancelRow) cancelRow.style.display = 'none';
                }

                function showExportCancelled() {
                    // Terminal state distinct from success/failure. The host has
                    // already deleted the partial output before sending this.
                    exportState.finished = true;
                    exportState.cancelled = true;
                    exportState.succeeded = false;

                    hideCancelRow();

                    // Reset any spinning stage row back to a static pending icon
                    // (toggling the class alone leaves the codicon-sync spinning).
                    document.querySelectorAll('#exportStageList .stage-row.active').forEach(row => {
                        setStageState(row.dataset.stage, 'pending');
                    });

                    const icon = document.getElementById('exportProgressIcon');
                    if (icon) {
                        icon.classList.remove('export-spinner', 'success', 'error', 'warn');
                        icon.classList.add('warn');
                        icon.innerHTML = '<i class="codicon codicon-circle-slash"></i>';
                    }

                    setExportTitle('Export cancelled', 'The partial export was removed.');

                    const currentFile = document.getElementById('exportCurrentFile');
                    if (currentFile) { currentFile.style.display = 'none'; currentFile.textContent = ''; }

                    // Output is gone, so only offer Close (no Open Folder).
                    const actionRow = document.getElementById('exportActionRow');
                    const openBtn = document.getElementById('exportOpenFolderBtn');
                    if (openBtn) openBtn.style.display = 'none';
                    if (actionRow) actionRow.style.display = 'flex';
                }

                function showExportFinished(success, summaryText) {
                    exportState.finished = true;
                    exportState.succeeded = success;

                    hideCancelRow();

                    document.querySelectorAll('#exportStageList .stage-row').forEach(row => {
                        if (success) {
                            setStageState(row.dataset.stage, 'done');
                        } else if (row.classList.contains('active')) {
                            // Reset via setStageState so the spinning icon stops
                            // (toggling the class alone leaves codicon-sync spinning).
                            setStageState(row.dataset.stage, 'pending');
                        }
                    });

                    // Icon and title now key off the success flag only. Any
                    // nuance (warnings, partial success, etc.) is surfaced via
                    // the single comma-summary message the exporters push
                    // through extraMessages.
                    const icon = document.getElementById('exportProgressIcon');
                    if (icon) {
                        icon.classList.remove('export-spinner', 'success', 'error', 'warn');
                        if (success) {
                            icon.classList.add('success');
                            icon.innerHTML = '<i class="codicon codicon-check"></i>';
                        } else {
                            icon.classList.add('error');
                            icon.innerHTML = '<i class="codicon codicon-error"></i>';
                        }
                    }

                    const title = success ? 'Export complete' : 'Export failed';
                    setExportTitle(title, summaryText || (success
                        ? 'Your project has been exported successfully.'
                        : 'Something went wrong during the export.'));

                    const currentFile = document.getElementById('exportCurrentFile');
                    if (currentFile) { currentFile.style.display = 'none'; currentFile.textContent = ''; }

                    const actionRow = document.getElementById('exportActionRow');
                    const openBtn = document.getElementById('exportOpenFolderBtn');
                    if (actionRow) actionRow.style.display = 'flex';
                    if (openBtn) openBtn.style.display = (success && exportState.outputPath) ? 'flex' : 'none';
                }

                // Failed cells worth retrying: transient/recoverable reason AND
                // we know which cell to re-run (cellId + codexPath).
                function getRetryTargets() {
                    return (exportState.missingFiles || []).filter(it =>
                        it && it.cellId && it.codexPath && RETRYABLE_EXPORT_REASONS.has(it.reason)
                    );
                }

                function updateRetryButton() {
                    const btn = document.getElementById('exportRetryBtn');
                    if (!btn) return;
                    if (exportState.retrying) {
                        btn.style.display = 'flex';
                        btn.disabled = true;
                        return;
                    }
                    const targets = getRetryTargets();
                    const canRetry = targets.length > 0 && !!exportState.audioOutputPath;
                    btn.style.display = canRetry ? 'flex' : 'none';
                    btn.disabled = false;
                    const txt = document.getElementById('exportRetryBtnText');
                    if (txt) txt.textContent = 'Retry failed (' + targets.length + ')';
                }

                function retryFailedExport() {
                    if (exportState.retrying) return;
                    const targets = getRetryTargets();
                    if (targets.length === 0 || !exportState.audioOutputPath) return;

                    const retrySet = new Set(targets.map(t => t.cellId));
                    // Remove the cells we're about to re-run; the ones that fail
                    // again stream back in via exportFileMissing.
                    exportState.missingFiles = (exportState.missingFiles || []).filter(it =>
                        !(it && it.cellId && RETRYABLE_EXPORT_REASONS.has(it.reason) && retrySet.has(it.cellId))
                    );
                    exportState.retrying = true;
                    exportState.retryAttempted = targets.length;
                    renderExportIssues();

                    const btnText = document.getElementById('exportRetryBtnText');
                    if (btnText) btnText.textContent = 'Retrying ' + targets.length + '…';
                    const closeBtn = document.getElementById('exportCloseBtn');
                    if (closeBtn) closeBtn.disabled = true;
                    setExportTitle(
                        'Retrying ' + targets.length + ' cell' + (targets.length === 1 ? '' : 's') + '…',
                        'Re-attempting the recordings that could not be exported.'
                    );

                    vscode.postMessage({
                        command: 'retryExport',
                        audioOutputPath: exportState.audioOutputPath,
                        options: exportState.lastOptions || {},
                        targets: targets.map(t => ({ cellId: t.cellId, codexPath: t.codexPath })),
                    });
                }

                function finishRetry(message) {
                    exportState.retrying = false;
                    const closeBtn = document.getElementById('exportCloseBtn');
                    if (closeBtn) closeBtn.disabled = false;

                    if (message && message.error) {
                        setExportTitle('Retry failed', String(message.error));
                    } else if (!(message && message.cancelled)) {
                        const stillFailing = getRetryTargets().length;
                        const attempted = exportState.retryAttempted || 0;
                        const recovered = Math.max(0, attempted - stillFailing);
                        let subtitle;
                        if (stillFailing === 0) {
                            subtitle = recovered > 0
                                ? 'Recovered ' + recovered + ' recording' + (recovered === 1 ? '' : 's') + '.'
                                : 'Nothing left to retry.';
                        } else {
                            subtitle = recovered + ' recovered, ' + stillFailing + ' still need attention.';
                        }
                        setExportTitle(exportState.succeeded ? 'Export complete' : exportState.lastTitle, subtitle);
                    }

                    renderExportIssues();
                    updateRetryButton();
                }

                function enterExportingView() {
                    resetExportProgressView();
                    exportState.started = true;
                    document.body.classList.add('exporting');
                    document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
                    const stepExporting = document.getElementById('stepExporting');
                    if (stepExporting) stepExporting.classList.add('active');
                    setStageState('preparing', 'active');
                    exportState.stageIndex = 0;
                }

                function openExportFolder() {
                    if (!exportState.outputPath) return;
                    vscode.postMessage({ command: 'openExportFolder', path: exportState.outputPath });
                }

                function closeExportView() {
                    vscode.postMessage({ command: 'closeExportView' });
                }

                const SUBTITLE_FORMATS_THAT_WARN_ON_OVERLAP = new Set([
                    'subtitles-srt',
                    'subtitles-vtt-with-styles',
                    'subtitles-vtt-without-styles',
                ]);
                let pendingSubtitleOverlapCheck = false;

                function advanceFromStep2() {
                    if (pendingSubtitleOverlapCheck) return;
                    if (
                        selectedFormat &&
                        SUBTITLE_FORMATS_THAT_WARN_ON_OVERLAP.has(selectedFormat) &&
                        selectedFiles.size > 0
                    ) {
                        pendingSubtitleOverlapCheck = true;
                        const btn = document.getElementById('nextStep2');
                        if (btn) btn.disabled = true;
                        vscode.postMessage({
                            command: 'checkSubtitleOverlaps',
                            filesToExport: Array.from(selectedFiles),
                        });
                        return;
                    }
                    advanceToNextStepAfterFormat();
                }

                window.onMilestoneCheckboxChange = onMilestoneCheckboxChange;
                window.onMilestoneSelectAllChange = onMilestoneSelectAllChange;

                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.command === 'updateExportPath') {
                        exportPath = message.path;
                        const el = document.getElementById('exportPath');
                        if (el) el.textContent = message.path;
                        updateExportButton();
                        return;
                    }
                    if (message.command === 'fileAudioStatsUpdated') {
                        // A .codex was saved while the wizard is open — patch
                        // just that file's row so the Step 1 counts stay live.
                        applyFileAudioStatsUpdate(
                            message.path,
                            message.hasAudio,
                            message.hasTranslations,
                            message.audioStats
                        );
                        return;
                    }
                    if (message.command === 'htmlStructureCheckResult') {
                        if (message.mismatches && message.mismatches.totalMismatches > 0) {
                            showHtmlMismatchPopup(message.mismatches);
                        }
                        return;
                    }
                    if (message.command === 'exportStarted') {
                        enterExportingView();
                        return;
                    }
                    if (message.command === 'exportProgress') {
                        // Ignore late progress once we have reached a terminal
                        // state (e.g. trailing events from in-flight downloads
                        // draining after a cancel).
                        if (exportState.finished || exportState.cancelled) return;
                        const event = message.event || {};
                        if (event.stage) {
                            handleExportStage(event.stage, event.message, event.file, event.current, event.total);
                        } else if (event.message) {
                            setExportTitle(event.message, exportState.lastSubtitle);
                        }
                        return;
                    }
                    if (message.command === 'exportFileMissing') {
                        // Collect per-cell/per-file problems as they arrive.
                        // They're rolled up into the single extraMessages
                        // summary line by the exporters; here we keep the
                        // individual entries so the completion screen can show
                        // an expandable, grouped breakdown. Stop collecting once
                        // we've reached a terminal state (late events from
                        // in-flight work draining after a cancel).
                        // During a targeted retry the run is already "finished",
                        // but we still want to collect the cells that failed
                        // again so the issues list reflects the new state.
                        if ((exportState.finished && !exportState.retrying) || exportState.cancelled) return;
                        exportState.missingFiles.push({
                            file: message.file,
                            reason: message.reason,
                            detail: message.detail,
                            cellId: message.cellId,
                            codexPath: message.codexPath,
                        });
                        if (exportState.retrying) {
                            // Live-refresh while retrying so recovered cells drop
                            // off and any that still fail re-appear.
                            renderExportIssues();
                        }
                        return;
                    }
                    if (message.command === 'exportCompleted') {
                        // A cancel that already won the race takes precedence;
                        // don't flip a cancelled run to "complete".
                        if (exportState.cancelled) return;
                        const summary = message.summary || {};
                        if (summary.exportPath) showOutputPath(summary.exportPath);
                        if (summary.audioExportPath) exportState.audioOutputPath = summary.audioExportPath;
                        if (summary.extraMessages && summary.extraMessages.length > 0) {
                            showExtraMessages(summary.extraMessages);
                        }
                        showExportFinished(true);
                        // Render after marking finished so the grouped issue
                        // list reflects everything collected during the run.
                        renderExportIssues();
                        return;
                    }
                    if (message.command === 'exportError') {
                        if (exportState.cancelled) return;
                        showExportFinished(false, message.message || 'Export failed.');
                        return;
                    }
                    if (message.command === 'exportCancelled') {
                        // Terminal: the host deleted the partial output and will
                        // not send complete/error for this run.
                        showExportCancelled();
                        return;
                    }
                    if (message.command === 'retryCompleted') {
                        finishRetry(message);
                        return;
                    }
                    if (message.command === 'subtitleOverlapResult') {
                        pendingSubtitleOverlapCheck = false;
                        updateStep2Button();
                        if (message.proceed) {
                            advanceToNextStepAfterFormat();
                        }
                    }
                    if (message.command === 'characterAudioPreviewResult') {
                        renderCharacterPreview(message.preview, message.error);
                    }
                });

                function updateCharacterAudioControls() {
                    const controls = document.getElementById('characterAudioControls');
                    if (!controls) return;
                    controls.style.display = selectedAudioMode === 'audio-by-character' ? 'flex' : 'none';
                }

                function openCharacterPreview() {
                    if (selectedFiles.size === 0) return;
                    const body = document.getElementById('characterPreviewBody');
                    if (body) {
                        body.replaceChildren();
                        const loading = document.createElement('p');
                        loading.style.color = 'var(--vscode-descriptionForeground)';
                        loading.textContent = 'Loading preview...';
                        body.appendChild(loading);
                    }
                    const popup = document.getElementById('characterPreviewPopup');
                    if (popup) popup.classList.add('visible');
                    vscode.postMessage({
                        command: 'previewCharacterAudio',
                        filesToExport: Array.from(selectedFiles)
                    });
                }

                function closeCharacterPreviewPopup() {
                    const popup = document.getElementById('characterPreviewPopup');
                    if (popup) popup.classList.remove('visible');
                }

                function formatMmSs(totalSeconds) {
                    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0:00';
                    const total = Math.floor(totalSeconds);
                    const m = Math.floor(total / 60);
                    const s = total % 60;
                    return m + ':' + String(s).padStart(2, '0');
                }

                function makeFileBlock(f) {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'char-preview-file';
                    const title = document.createElement('h5');
                    title.textContent = f.fileBase;
                    wrapper.appendChild(title);
                    const meta = document.createElement('div');
                    meta.className = 'char-preview-meta';
                    if (f.missingTiming) {
                        meta.textContent = 'No timing data — this file will be skipped.';
                        wrapper.appendChild(meta);
                        return wrapper;
                    }
                    if (!f.characters || f.characters.length === 0) {
                        meta.textContent = 'Episode length: ' + formatMmSs(f.episodeDurationSec) + ' — no character audio found.';
                        wrapper.appendChild(meta);
                        return wrapper;
                    }
                    const exportingCount = (f.characters || []).filter(function(c) { return c.willExport; }).length;
                    const totalCount = f.characters.length;
                    const skippedNote = f.skippedCells > 0
                        ? ' • ' + f.skippedCells + ' cell' + (f.skippedCells === 1 ? '' : 's') + ' missing timing'
                        : '';
                    meta.textContent = 'Episode length: ' + formatMmSs(f.episodeDurationSec) +
                        ' • ' + totalCount + ' character' + (totalCount === 1 ? '' : 's') +
                        ' (' + exportingCount + ' will export)' + skippedNote;
                    wrapper.appendChild(meta);

                    const dur = f.episodeDurationSec;
                    for (const c of f.characters) {
                        const row = document.createElement('div');
                        row.className = 'char-row' + (c.willExport ? '' : ' no-audio');

                        const label = document.createElement('div');
                        label.className = 'char-label';
                        const audioCount = c.audioCellCount || 0;
                        const noAudioCount = c.noAudioCellCount || 0;
                        const untimed = c.untimedCellCount || 0;
                        const tooltipParts = [c.label];
                        if (audioCount) tooltipParts.push(audioCount + ' with audio');
                        if (noAudioCount) tooltipParts.push(noAudioCount + ' timed, no audio');
                        if (untimed) tooltipParts.push(untimed + ' untimed');
                        label.title = tooltipParts.join(' • ');
                        label.textContent = c.label;
                        row.appendChild(label);

                        const timeline = document.createElement('div');
                        timeline.className = 'char-timeline';
                        for (const iv of (c.intervals || [])) {
                            const seg = document.createElement('div');
                            seg.className = 'speech-segment ' + (iv.hasAudio ? 'has-audio' : 'no-audio');
                            const left = dur > 0 ? Math.max(0, Math.min(100, (iv.startSec / dur) * 100)) : 0;
                            const widthRaw = dur > 0 ? ((iv.endSec - iv.startSec) / dur) * 100 : 0;
                            const width = Math.max(0.2, Math.min(100 - left, widthRaw));
                            seg.style.left = left.toFixed(3) + '%';
                            seg.style.width = width.toFixed(3) + '%';
                            timeline.appendChild(seg);
                        }
                        row.appendChild(timeline);

                        const stats = document.createElement('div');
                        stats.className = 'char-stats';
                        if (c.willExport) {
                            const trim = formatMmSs(c.lastEndSec);
                            const audioSpeaking = formatMmSs(c.speakingSecAudio || 0);
                            const noAudioSpeaking = (c.speakingSecNoAudio || 0) > 0 ? ' • ' + formatMmSs(c.speakingSecNoAudio) + ' no audio' : '';
                            stats.title = 'Trim: ' + trim + ' • Speaking (audio): ' + audioSpeaking + noAudioSpeaking;
                            stats.textContent = trim;
                        } else {
                            stats.title = 'No audio recorded yet — not exported';
                            stats.textContent = 'no audio';
                        }
                        row.appendChild(stats);

                        wrapper.appendChild(row);
                    }
                    return wrapper;
                }

                function renderCharacterPreview(preview, error) {
                    const body = document.getElementById('characterPreviewBody');
                    if (!body) return;
                    body.replaceChildren();
                    if (error) {
                        const p = document.createElement('p');
                        p.style.color = 'var(--vscode-errorForeground)';
                        p.textContent = error;
                        body.appendChild(p);
                        return;
                    }
                    if (!preview || !preview.files || preview.files.length === 0) {
                        const p = document.createElement('p');
                        p.style.color = 'var(--vscode-descriptionForeground)';
                        p.textContent = 'No files to preview.';
                        body.appendChild(p);
                        return;
                    }
                    for (const f of preview.files) {
                        body.appendChild(makeFileBlock(f));
                    }
                }

                document.addEventListener('DOMContentLoaded', () => {
                    renderFileGroups();
                    setupCellListPopover();
                    updateStep1Button();
                    updateProgressBarVisuals(1);
                    if (exportPath) {
                        const pathEl = document.getElementById('exportPath');
                        if (pathEl) pathEl.textContent = exportPath;
                    }

                    // Audio option click handler (mutually exclusive toggle)
                    document.querySelectorAll('#step2 .audio-option').forEach(option => {
                        option.addEventListener('click', (e) => {
                            if (e.target.closest('.format-section-header')) return;
                            const mode = option.dataset.audioMode;
                            const wasSelected = selectedAudioMode === mode;
                            // Clear all audio options
                            document.querySelectorAll('#step2 .audio-option').forEach(opt => {
                                opt.classList.remove('selected');
                                opt.style.backgroundColor = '';
                                opt.style.borderColor = '';
                            });
                            if (wasSelected) {
                                selectedAudioMode = null;
                            } else {
                                selectedAudioMode = mode;
                                option.classList.add('selected');
                                checkAudioSelectionMismatch();
                            }
                            try { updateStep2Button(); updateExportButton(); updateCharacterAudioControls(); } catch (e) {}
                        });
                    });

                    // Format option click handler (non-audio)
                    document.querySelectorAll('#step2 .format-option:not(.audio-option)').forEach(option => {
                        option.addEventListener('click', (e) => {
                            if (e.target.closest('.format-section-header')) return;
                            if (option.classList.contains('disabled-stream-only')) return;

                            // If clicking the already-selected format, deselect it
                            if (option.classList.contains('selected')) {
                                option.classList.remove('selected');
                                selectedFormat = null;
                                updateStep2Button();
                                return;
                            }

                            // Select this format and clear other non-audio format selections
                            document.querySelectorAll('#step2 .format-option:not(.audio-option)').forEach(opt => {
                                opt.classList.remove('selected');
                                opt.style.backgroundColor = '';
                                opt.style.borderColor = '';
                            });
                            option.classList.add('selected');
                            selectedFormat = option.dataset.format;
                            const usfmOptions = document.getElementById('usfmOptions');
                            if (usfmOptions) usfmOptions.style.display = selectedFormat === 'usfm' ? 'block' : 'none';

                            checkTextSelectionMismatch();

                            // Check HTML structure mismatches for round-trip export
                            if (selectedFormat === 'rebuild-export' && selectedFiles.size > 0) {
                                vscode.postMessage({
                                    command: 'checkHtmlStructure',
                                    filesToExport: Array.from(selectedFiles)
                                });
                            }

                            updateStep2Button();
                        });
                    });

                });

                function getFilesWithoutAudio() {
                    const names = [];
                    for (const path of selectedFiles) {
                        const f = fileLookup[path];
                        if (f && !f.hasAudio) names.push(f.displayName);
                    }
                    return names;
                }

                function getFilesWithoutText() {
                    const names = [];
                    for (const path of selectedFiles) {
                        const f = fileLookup[path];
                        if (f && !f.hasTranslations) names.push(f.displayName);
                    }
                    return names;
                }

                function showContentMismatchPopup(title, summary, fileNames) {
                    const titleEl = document.getElementById('contentMismatchTitle');
                    const summaryEl = document.getElementById('contentMismatchSummary');
                    const listEl = document.getElementById('contentMismatchFileList');
                    const popup = document.getElementById('contentMismatchPopup');
                    if (!titleEl || !summaryEl || !listEl || !popup) return;
                    titleEl.textContent = title;
                    summaryEl.textContent = summary;
                    listEl.innerHTML = fileNames
                        .map(n => '<div><i class="codicon codicon-file" style="margin-right:4px;"></i>' + n + '</div>')
                        .join('');
                    popup.classList.add('visible');
                }

                function closeContentMismatchPopup() {
                    const popup = document.getElementById('contentMismatchPopup');
                    if (popup) popup.classList.remove('visible');
                }

                function checkAudioSelectionMismatch() {
                    const noAudioFiles = getFilesWithoutAudio();
                    if (noAudioFiles.length > 0) {
                        showContentMismatchPopup(
                            'Files Without Audio',
                            'The following files have no audio translations.',
                            noAudioFiles
                        );
                    }
                }

                function checkTextSelectionMismatch() {
                    const noTextFiles = getFilesWithoutText();
                    if (noTextFiles.length > 0) {
                        showContentMismatchPopup(
                            'Files Without Text',
                            'The following files have no text translations.',
                            noTextFiles
                        );
                    }
                }

                function showHtmlMismatchPopup(mismatches) {
                    const summary = document.getElementById('htmlMismatchSummary');
                    const fileList = document.getElementById('htmlMismatchFileList');
                    const popup = document.getElementById('htmlMismatchPopup');
                    if (!summary || !fileList || !popup) return;

                    summary.textContent = mismatches.totalMismatches +
                        ' cell(s) have mismatched HTML structure that may break the round-trip export.';

                    fileList.innerHTML = mismatches.fileDetails
                        .map(f => '<div><i class="codicon codicon-file" style="margin-right:4px;"></i>' +
                            f.file + ' — <strong>' + f.count + '</strong> cell(s)</div>')
                        .join('');

                    popup.classList.add('visible');
                }

                function closeHtmlMismatchPopup() {
                    const popup = document.getElementById('htmlMismatchPopup');
                    if (popup) popup.classList.remove('visible');
                }

                function exportProject() {
                    let formatToSend = selectedFormat || (selectedAudioMode ? 'audio' : null);
                    if (!formatToSend || !exportPath || selectedFiles.size === 0) return;
                    const options = {};
                    if (formatToSend === 'usfm-no-validate') {
                        formatToSend = 'usfm';
                        options.skipValidation = true;
                    }
                    if (selectedAudioMode) {
                        options.includeAudio = true;
                        options.includeTimestamps = selectedAudioMode === 'audio-timestamps';
                        options.consolidateByCharacter = selectedAudioMode === 'audio-by-character';
                        if (options.consolidateByCharacter) {
                            const fmtEl = document.getElementById('characterAudioFormat');
                            options.consolidatedAudioFormat = (fmtEl && fmtEl.value) ? fmtEl.value : 'flac';
                        }
                    }
                    if (selectedFormat && selectedFormat.startsWith('subtitles-vtt-')) {
                        const cb = document.getElementById('vttExcludeLabelsCb');
                        if (cb && cb.checked) options.excludeLabels = true;
                    }
                    const selectedMilestones = buildSelectedMilestonesPayload();
                    if (selectedMilestones) {
                        options.selectedMilestonesByFile = selectedMilestones;
                    }
                    // Optimistically switch UI to the in-panel exporting screen so
                    // the user does not see Cancel / Back / Export anymore. The host
                    // also broadcasts exportStarted, which is idempotent.
                    enterExportingView();
                    // Remember the options so a "retry failed downloads" can
                    // reproduce the same export behaviour (e.g. timestamps).
                    exportState.lastOptions = options;
                    vscode.postMessage({
                        command: 'export',
                        format: formatToSend,
                        userSelectedPath: exportPath,
                        filesToExport: Array.from(selectedFiles),
                        options: options
                    });
                }
            </script>
        </body>
    </html>`;
}
