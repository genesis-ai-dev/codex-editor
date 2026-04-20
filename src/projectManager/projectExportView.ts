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
                    cursor: pointer;
                    user-select: none;
                }
                .file-group-header:hover { background-color: var(--vscode-list-hoverBackground); }
                .file-group-header h4 { margin: 0; flex: 1; font-size: 0.95em; }
                .file-group-header input[type="checkbox"] { margin: 0; }
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
                .format-option-row { display: flex; gap: 1rem; }
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
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
                }
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
                    <h3>Select Export Format</h3>
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
                        <h3 style="margin-top: 1.5rem;">Select Audio Export Format</h3>
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
                let selectedAudioMode = null; // null | 'audio' | 'audio-timestamps'
                let exportPath = ${initialExportFolderJson};
                let selectedFiles = new Set();
                let selectedGroupKey = null;

                function renderFileGroups() {
                    const container = document.getElementById('fileGroupsContainer');
                    if (!container) return;
                    if (fileGroups.length === 0) {
                        container.innerHTML = '<p style="color: var(--vscode-descriptionForeground);">No Codex files found in this project.</p>';
                        return;
                    }
                    container.innerHTML = fileGroups.map((group, gIdx) => {
                        const groupId = 'group-' + gIdx;
                        const filesHtml = group.files.map((f, fIdx) => {
                            const id = 'file-' + gIdx + '-' + fIdx;
                            return \`
                                <div class="file-item">
                                    <input type="checkbox" id="\${id}" value="\${f.path}" data-group-key="\${group.groupKey}" onchange="onFileCheckboxChange()">
                                    <label for="\${id}" title="\${f.displayName}">\${f.displayName}</label>
                                </div>
                            \`;
                        }).join('');
                        return \`
                            <div class="file-group" id="\${groupId}" data-group-key="\${group.groupKey}">
                                <div class="file-group-header" onclick="toggleGroup('\${group.groupKey}')">
                                    <input type="checkbox" id="group-cb-\${gIdx}" data-group-key="\${group.groupKey}" onchange="onGroupCheckboxChange('\${group.groupKey}')" onclick="event.stopPropagation()">
                                    <h4><i class="codicon codicon-folder"></i> \${group.displayName}</h4>
                                </div>
                                <div class="file-group-content">\${filesHtml}</div>
                            </div>
                        \`;
                    }).join('');
                }

                function toggleGroup(groupKey) {
                    if (selectedGroupKey && selectedGroupKey !== groupKey) return;
                    const group = document.querySelector('.file-group[data-group-key="' + groupKey + '"]');
                    if (!group) return;
                    const fileCbs = group.querySelectorAll('.file-group-content input[type="checkbox"]');
                    const allChecked = Array.from(fileCbs).every(cb => cb.checked);
                    fileCbs.forEach(cb => {
                        cb.checked = !allChecked;
                        if (!allChecked) selectedFiles.add(cb.value);
                        else selectedFiles.delete(cb.value);
                    });
                    const headerCb = group.querySelector('.file-group-header input[type="checkbox"]');
                    if (headerCb) headerCb.checked = !allChecked;
                    updateSelectedGroup();
                    updateStep1Button();
                }

                function onGroupCheckboxChange(groupKey) {
                    if (selectedGroupKey && selectedGroupKey !== groupKey) return;
                    const group = document.querySelector('.file-group[data-group-key="' + groupKey + '"]');
                    if (!group) return;
                    const headerCb = group.querySelector('.file-group-header input[type="checkbox"]');
                    const fileCbs = group.querySelectorAll('.file-group-content input[type="checkbox"]');
                    const newChecked = headerCb.checked;
                    fileCbs.forEach(cb => {
                        cb.checked = newChecked;
                        if (newChecked) selectedFiles.add(cb.value);
                        else selectedFiles.delete(cb.value);
                    });
                    updateSelectedGroup();
                    updateStep1Button();
                }

                function onFileCheckboxChange() {
                    selectedFiles.clear();
                    document.querySelectorAll('.file-group-content input[type="checkbox"]:checked').forEach(cb => {
                        selectedFiles.add(cb.value);
                    });
                    document.querySelectorAll('.file-group').forEach(group => {
                        const key = group.dataset.groupKey;
                        const fileCbs = group.querySelectorAll('.file-group-content input[type="checkbox"]');
                        const allChecked = fileCbs.length > 0 && Array.from(fileCbs).every(cb => cb.checked);
                        const headerCb = group.querySelector('.file-group-header input[type="checkbox"]');
                        if (headerCb) headerCb.checked = allChecked;
                    });
                    updateSelectedGroup();
                    updateStep1Button();
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
                }

                function updateStep1Button() {
                    const btn = document.getElementById('nextStep1');
                    if (btn) btn.disabled = selectedFiles.size === 0;
                }

                function initStep2Options(resetFormatSelection) {
                    const key = selectedGroupKey || 'unknown';
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
                    // Only clear text format when entering step 2 from step 1 (file group may have changed).
                    // When returning from step 3, keep the user's format choice; audio already behaved this way.
                    if (resetFormatSelection) {
                        selectedFormat = null;
                        document.querySelectorAll('#step2 .format-option:not(.audio-option)').forEach(opt => {
                            opt.classList.remove('selected');
                            opt.style.backgroundColor = '';
                            opt.style.borderColor = '';
                        });
                        
                    }
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
                });

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
                            }
                            try { updateStep2Button(); updateExportButton(); } catch (e) {}
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
