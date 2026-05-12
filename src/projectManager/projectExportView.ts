import { CodexExportFormat } from "../exportHandler/exportHandler";
import * as fs from "fs";
import * as vscode from "vscode";
import { safePostMessageToPanel } from "../utils/webviewUtils";
import { EXPORT_OPTIONS_BY_FILE_TYPE } from "../../sharedUtils/exportOptionsEligibility";
import { groupCodexFilesByImporterType, type FileGroup } from "./utils/exportViewUtils";
import { readCodexNotebookFromUri } from "../exportHandler/exportHandlerUtils";
import { compareHtmlStructure } from "../../sharedUtils/htmlStructureUtils";
import { getMediaFilesStrategy } from "../utils/localProjectSettings";

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

export async function openProjectExportView(context: vscode.ExtensionContext) {
    const panel = vscode.window.createWebviewPanel(
        "projectExportView",
        "Export Project",
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
        }
    );

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

                    await vscode.commands.executeCommand(
                        `codex-editor-extension.exportCodexContent`,
                        {
                            format: message.format as CodexExportFormat,
                            userSelectedPath: message.userSelectedPath,
                            filesToExport: message.filesToExport,
                            options: message.options,
                        }
                    );
                    panel.dispose();
                } catch (error) {
                    vscode.window.showErrorMessage(
                        "Failed to export project. Please check your configuration."
                    );
                }
                break;
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
            case "cancel":
                panel.dispose();
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
                .file-item {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 4px 8px;
                    border-radius: 3px;
                    word-break: break-word;
                }
                .file-item:hover { background-color: var(--vscode-list-hoverBackground); }
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
                }
                .popup-file-list {
                    margin: 8px 0;
                    padding: 8px 12px;
                    background: rgba(202, 138, 4, 0.08);
                    border: 1px solid rgba(202, 138, 4, 0.25);
                    border-radius: 4px;
                    font-size: 0.9em;
                }
                .popup-file-list div { padding: 2px 0; }
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
                                                <!--<span class="format-tag format-tag-roundtrip">Reach4Life</span>-->
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

                <!-- STEP 3: Export Location -->
                <div id="step3" class="step-panel">
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
                    </div>
                    <div class="bottom-bar-right">
                        <button class="step-btn visible" id="nextStep1" disabled onclick="goToStep2()"><span class="btn-text">Next Step</span><i class="codicon codicon-arrow-right"></i></button>
                        <button class="step-btn" id="nextStep2" disabled onclick="goToStep3()"><span class="btn-text">Next Step</span><i class="codicon codicon-arrow-right"></i></button>
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

            <div class="popup-overlay" id="contentMismatchPopup" onclick="if(event.target===this)closeContentMismatchPopup()">
                <div class="popup-card">
                    <div class="popup-header">
                        <i class="codicon codicon-warning"></i>
                        <h4 id="contentMismatchTitle">Missing Content</h4>
                        <button class="popup-close" onclick="closeContentMismatchPopup()" title="Close">
                            <i class="codicon codicon-close"></i>
                        </button>
                    </div>
                    <div class="popup-body">
                        <p id="contentMismatchSummary"></p>
                        <div class="popup-file-list" id="contentMismatchFileList"></div>
                        <p style="margin-top: 8px; color: var(--vscode-descriptionForeground); font-size: 0.85em;">
                            The export will still proceed, but the listed files will produce empty output for the selected format.
                        </p>
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
                        const filesHtml = group.files.map((f, fIdx) => {
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
                            return \`
                                <div class="\${itemClass}" data-content-type="\${contentType}">
                                    <input type="checkbox" id="\${id}" value="\${f.path}" data-group-key="\${group.groupKey}" data-content-type="\${contentType}" \${disabledAttr} onchange="onFileCheckboxChange()">
                                    <label for="\${id}" title="\${tooltip}">\${f.displayName}</label>
                                    \${statusTag}
                                </div>
                            \`;
                        }).join('');
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
                    const exportBtn = document.getElementById('exportButton');
                    if (currentStep === 1) {
                        if (cancel) cancel.classList.add('visible');
                        if (next1) next1.classList.add('visible');
                    } else if (currentStep === 2) {
                        if (back) back.classList.add('visible');
                        if (next2) next2.classList.add('visible');
                    } else if (currentStep === 3) {
                        if (back) back.classList.add('visible');
                        if (exportBtn) exportBtn.classList.add('visible');
                    }
                }

                function goBack() {
                    goToStep(currentStep - 1);
                }

                function goToStep(n) {
                    const prevStep = currentStep;
                    document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
                    document.getElementById('step' + n).classList.add('active');
                    document.querySelectorAll('[id^="progressCircle"]').forEach((circle, i) => {
                        circle.classList.remove('active', 'completed');
                        if (i + 1 < n) {
                            circle.classList.add('completed');
                            circle.innerHTML = '<i class="codicon codicon-check"></i>';
                        } else {
                            circle.textContent = String(i + 1);
                            if (i + 1 === n) circle.classList.add('active');
                        }
                    });
                    document.querySelectorAll('[id^="progressLine"]').forEach((line, i) => {
                        line.classList.remove('completed');
                        if (i + 1 < n) line.classList.add('completed');
                    });
                    const compact = document.getElementById('progressCompact');
                    if (compact) compact.textContent = 'Step ' + n + ' of 3';
                    currentStep = n;
                    updateButtonVisibility();
                    if (n === 2) {
                        initStep2Options(prevStep === 1);
                    } else if (n === 3) {
                        updateExportButton();
                    }
                }

                function goToStep1() { goToStep(1); }
                function goToStep2() { goToStep(2); }
                function goToStep3() { goToStep(3); }

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

                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.command === 'updateExportPath') {
                        exportPath = message.path;
                        const el = document.getElementById('exportPath');
                        if (el) el.textContent = message.path;
                        updateExportButton();
                    }
                    if (message.command === 'htmlStructureCheckResult') {
                        if (message.mismatches && message.mismatches.totalMismatches > 0) {
                            showHtmlMismatchPopup(message.mismatches);
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
                    updateStep1Button();
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
                            'The following files have no audio translations. Their exported audio folders will be empty.',
                            noAudioFiles
                        );
                    }
                }

                function checkTextSelectionMismatch() {
                    const noTextFiles = getFilesWithoutText();
                    if (noTextFiles.length > 0) {
                        showContentMismatchPopup(
                            'Files Without Text',
                            'The following files have no text translations. Their text export will be empty.',
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
