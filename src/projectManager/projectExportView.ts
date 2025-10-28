import { CodexExportFormat } from "../exportHandler/exportHandler";
import * as vscode from "vscode";
import { safePostMessageToPanel } from "../utils/webviewUtils";

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

    // Get project configuration
    const projectConfig = vscode.workspace.getConfiguration("codex-project-manager");
    const sourceLanguage = projectConfig.get("sourceLanguage");
    const targetLanguage = projectConfig.get("targetLanguage");

    // Get codicon CSS URI
    const codiconsUri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(
            context.extensionUri,
            "node_modules",
            "@vscode/codicons",
            "dist",
            "codicon.css"
        )
    );

    // Get list of codex files
    const codexFiles = await vscode.workspace.findFiles("**/*.codex");
    const codexFilesList = codexFiles
        .sort((a, b) => {
            const aName = a.fsPath.split(/[/\\]/).pop()!;
            const bName = b.fsPath.split(/[/\\]/).pop()!;
            return aName.localeCompare(bName);
        })
        .map((file) => ({
            path: file.fsPath,
            name: file.fsPath.split(/[/\\]/).pop() || "",
            selected: true, // Default to selected
        }));

    panel.webview.html = getWebviewContent(
        sourceLanguage,
        targetLanguage,
        codiconsUri,
        codexFilesList
    );

    panel.webview.onDidReceiveMessage(async (message) => {
        let result: vscode.Uri[] | undefined;

        switch (message.command) {
            case "selectExportPath":
                result = await vscode.window.showOpenDialog({
                    canSelectFiles: false,
                    canSelectFolders: true,
                    canSelectMany: false,
                    title: "Select Export Location",
                    openLabel: "Select Folder",
                });

                if (result && result[0]) {
                    safePostMessageToPanel(panel, {
                        command: "updateExportPath",
                        path: result[0].fsPath,
                    }, "ProjectExport");
                }
                break;
            case "export":
                try {
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
            case "cancel":
                panel.dispose();
                break;
        }
    });
}

function getWebviewContent(
    sourceLanguage?: any,
    targetLanguage?: any,
    codiconsUri?: vscode.Uri,
    codexFiles: Array<{ path: string; name: string; selected: boolean; }> = []
) {
    const hasLanguages = sourceLanguage?.refName && targetLanguage?.refName;

    // Middle-truncate longer file names
    const middleTruncateLongerFileNames = (fileName: string) => {
        if (fileName.length > 20) {
            fileName = fileName.slice(0, 10) + "..." + fileName.slice(-10);
        }
        return fileName;
    };

    return `<!DOCTYPE html>
    <html>
        <head>
            <link href="${codiconsUri}" rel="stylesheet" />
            <style>
                body {
                    padding: 16px;
                    display: flex;
                    flex-direction: column;
                    height: 100vh;
                    box-sizing: border-box;
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                }
                .container {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                }
                .format-option {
                    padding: 16px;
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                .format-option:hover {
                    background-color: var(--vscode-list-hoverBackground);
                }
                .format-option.selected {
                    border-color: var(--vscode-focusBorder);
                    background-color: var(--vscode-list-activeSelectionBackground);
                }
                .button-container {
                    display: flex;
                    justify-content: flex-end;
                    gap: 8px;
                    margin-top: 16px;
                }
                button {
                    padding: 8px 16px;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: 1px solid transparent;
                    border-radius: 2px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                button:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
                button.secondary {
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                }
                .message {
                    text-align: center;
                    margin: 20px;
                    padding: 20px;
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    color: var(--vscode-descriptionForeground);
                }
                .files-section {
                    margin-top: 16px;
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    padding: 16px;
                }
                .files-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 8px;
                }
                .files-list {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
                    gap: 8px;
                    max-height: 200px;
                    overflow-y: auto;
                    padding: 4px;
                }
                .file-item {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 4px 8px;
                    border-radius: 3px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .file-item:hover {
                    background-color: var(--vscode-list-hoverBackground);
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
                    cursor: pointer;
                    user-select: none;
                }
                .format-section-header:hover {
                    background-color: var(--vscode-list-hoverBackground);
                }
                .format-section-header h4 {
                    margin: 0;
                    flex: 1;
                }
                .format-section-content {
                    padding: 12px;
                    background-color: var(--vscode-editor-background);
                    border-top: 1px solid var(--vscode-input-border);
                }
                .format-section-content .format-option {
                    margin-bottom: 8px;
                    padding: 12px;
                }
                .format-section-content .format-option:last-child {
                    margin-bottom: 0;
                }
                .format-option-content {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }
                .format-tag {
                    display: inline-block;
                    padding: 1px 4px;
                    font-size: 0.85em;
                    color: var(--vscode-badge-foreground);
                    opacity: 0.8;
                    align-self: flex-start;
                }
            </style>
        </head>
        <body>
            <div class="container">
                ${hasLanguages
            ? `
                    <h3>Select Export Format</h3>
                    <div style="display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1rem;">
                        <!-- Standard Export Formats - Row 1: Plaintext | USFM -->
                        <div style="display: flex; gap: 1rem;">
                            <div class="format-option" data-format="plaintext" style="flex: 1;">
                                <i class="codicon codicon-file-text"></i>
                                <div>
                                    <strong>Plaintext</strong>
                                    <p>Export as plain text files with minimal formatting</p>
                                    <div style="margin-top: 6px; display: flex; align-items: center; gap: 6px;">
                                        <input type="checkbox" id="togglePlainTextIds" />
                                        <label for="togglePlainTextIds">Remove IDs from plaintext exports</label>
                                    </div>
                                </div>
                            </div>
                            <div class="format-option" data-format="usfm" style="flex: 1;">
                                <i class="codicon codicon-file-code"></i>
                                <div>
                                    <strong>USFM</strong>
                                    <p>Export in Universal Standard Format Markers</p>
                                </div>
                            </div>
                        </div>

                        <!-- Standard Export Formats - Row 2: HTML | XLIFF -->
                        <div style="display: flex; gap: 1rem;">
                            <div class="format-option" data-format="html" style="flex: 1;">
                                <i class="codicon codicon-browser"></i>
                                <div>
                                    <strong>HTML</strong>
                                    <p>Export as web pages with chapter navigation</p>
                                </div>
                            </div>
                            <div class="format-option" data-format="xliff" style="flex: 1;">
                                <i class="codicon codicon-symbol-interface"></i>
                                <div>
                                    <strong>XLIFF</strong>
                                    <p>Export in XML Localization Interchange File Format (XLIFF) for translation workflows</p>
                                    <span class="format-tag">Translation Ready</span>
                                </div>
                            </div>
                        </div>

                        <!-- Rebuild Export - Full Width -->
                        <div style="display: flex; gap: 1rem;">
                            <div class="format-option" data-format="rebuild-export" style="flex: 1;">
                                <i class="codicon codicon-refresh"></i>
                                <div>
                                    <strong>Rebuild Export</strong>
                                    <p>Intelligently detects file type and exports back to original format (DOCX, IDML, Biblica, PDF)</p>
                                    <div style="display: flex; gap: 0.5rem; margin-top: 0.25rem; flex-wrap: wrap;">
                                        <span class="format-tag" style="background-color: var(--vscode-charts-green);">DOCX</span>
                                        <span class="format-tag" style="background-color: var(--vscode-charts-green);">IDML</span>
                                        <span class="format-tag" style="background-color: var(--vscode-charts-green);">Biblica</span>
                                        <span class="format-tag" style="background-color: var(--vscode-charts-green);">PDF</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Audio Export - Full Width -->
                        <div style="display: flex; gap: 1rem;">
                            <div class="format-option" data-format="audio" style="flex: 1;">
                                <i class="codicon codicon-mic"></i>
                                <div>
                                    <strong>Audio</strong>
                                    <p>Export per-cell audio attachments to a folder</p>
                                    <div style="margin-top: 6px; display: flex; align-items: center; gap: 6px;">
                                        <input type="checkbox" id="audioIncludeTimestamps" />
                                        <label for="audioIncludeTimestamps">Embed timestamps in audio metadata (WAV, WebM, M4A)</label>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Backtranslations Export - Full Width -->
                        <div style="display: flex; gap: 1rem;">
                            <div class="format-option" data-format="backtranslations" style="flex: 1;">
                                <i class="codicon codicon-checklist"></i>
                                <div>
                                    <strong>Backtranslations (CSV)</strong>
                                    <p>Export backtranslations as CSV with ID, source text, translation, and backtranslation columns</p>
                                    <span class="format-tag">Quality Assurance</span>
                                </div>
                            </div>
                        </div>

                        <!-- Data Export Section -->
                        <div class="format-section">
                            <div class="format-section-header">
                                <i class="codicon codicon-graph"></i>
                                <h4>Data Export Options</h4>
                                <i class="codicon codicon-chevron-down" id="data-section-chevron"></i>
                            </div>
                            <div id="data-formats" class="format-section-content" style="display: none;">
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
                            </div>
                        </div>

                        <!-- Subtitle Export Section -->
                        <div class="format-section">
                            <div class="format-section-header">
                                <i class="codicon codicon-symbol-event"></i>
                                <h4>Subtitle Export Options</h4>
                                <i class="codicon codicon-chevron-down" id="subtitle-section-chevron"></i>
                            </div>
                            <div id="subtitle-formats" class="format-section-content" style="display: none;">
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
                    </div>

                    <div class="files-section">
                        <div class="files-header">
                            <h4>Select Files to Export</h4>
                            <button class="secondary" onclick="toggleAllFiles()">
                                <i class="codicon codicon-check-all"></i>
                                Toggle All
                            </button>
                        </div>
                        <div class="files-list">
                            ${codexFiles
                .map(
                    (file, index) => `
                                <div class="file-item">
                                    <input 
                                        type="checkbox" 
                                        id="file-${index}" 
                                        value="${file.path}"
                                        ${file.selected ? "checked" : ""}
                                        onchange="updateFileSelection()"
                                    >
                                    <label 
                                        for="file-${index}"
                                        title="${file.name}"
                                    >
                                        <i class="codicon codicon-file"></i>
                                        ${middleTruncateLongerFileNames(file.name)}
                                    </label>
                                </div>
                            `
                )
                .join("")}
                        </div>
                    </div>

                    <div class="export-path">
                        <div class="path-display" id="exportPath">No export location selected</div>
                        <button class="secondary" onclick="selectExportPath()">
                            <i class="codicon codicon-folder"></i>
                            Select Location
                        </button>
                    </div>

                    <div id="usfmOptions" style="display: none; margin-top: 16px; padding: 8px; border: 1px solid var(--vscode-input-border); border-radius: 4px;">
                        <h4>USFM Export Options</h4>
                        <div style="display: flex; align-items: center; margin-top: 8px;">
                            <input type="checkbox" id="skipValidation">
                            <label for="skipValidation" style="margin-left: 8px;">
                                Skip USFM validation (faster export, but may produce invalid USFM)
                            </label>
                        </div>
                    </div>

                    <div class="button-container">
                        <button class="secondary" onclick="cancel()">Cancel</button>
                        <button id="exportButton" disabled onclick="exportProject()">Export</button>
                    </div>
                    `
            : `
                    <div class="message">
                        Please set source and target languages first
                        <div class="button-container" style="justify-content: center">
                            <button onclick="openSettings()">Open Project Settings</button>
                        </div>
                    </div>
                    `
        }
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                let selectedFormat = null;
                let exportPath = null;
                let selectedFiles = new Set(${JSON.stringify(codexFiles.filter((f) => f.selected).map((f) => f.path))});

                // Initialize event handlers after DOM is loaded
                document.addEventListener('DOMContentLoaded', () => {
                    // Format options click handler
                    document.querySelectorAll('.format-option').forEach(option => {
                        option.addEventListener('click', (e) => {
                            // Skip if clicking within the section header
                            if (e.target.closest('.format-section-header')) {
                                return;
                            }

                            // Clear all selected states
                            document.querySelectorAll('.format-option').forEach(opt => {
                                opt.classList.remove('selected');
                            });

                            // Select this option
                            option.classList.add('selected');
                            selectedFormat = option.dataset.format;

                            // Show/hide USFM options
                            const usfmOptions = document.getElementById('usfmOptions');
                            usfmOptions.style.display = selectedFormat === 'usfm' ? 'block' : 'none';

                            updateExportButton();
                        });
                    });

                    // Section toggle handlers
                    const sectionHeaders = document.querySelectorAll('.format-section-header');
                    sectionHeaders.forEach(header => {
                        header.addEventListener('click', () => {
                            const isSubtitleSection = header.querySelector('#subtitle-section-chevron');
                            const isDataSection = header.querySelector('#data-section-chevron');
                            
                            if (isSubtitleSection) {
                                const content = document.getElementById('subtitle-formats');
                                const chevron = document.getElementById('subtitle-section-chevron');
                                const isHidden = content.style.display === 'none';
                                
                                content.style.display = isHidden ? 'block' : 'none';
                                chevron.style.transform = isHidden ? 'rotate(180deg)' : '';
                            } else if (isDataSection) {
                                const content = document.getElementById('data-formats');
                                const chevron = document.getElementById('data-section-chevron');
                                const isHidden = content.style.display === 'none';
                                
                                content.style.display = isHidden ? 'block' : 'none';
                                chevron.style.transform = isHidden ? 'rotate(180deg)' : '';
                            }
                        });
                    });
                });

                function updateExportButton() {
                    const exportButton = document.getElementById('exportButton');
                    exportButton.disabled = !selectedFormat || !exportPath || selectedFiles.size === 0;
                }

                function toggleAllFiles() {
                    const checkboxes = document.querySelectorAll('.files-list input[type="checkbox"]');
                    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
                    
                    checkboxes.forEach(checkbox => {
                        checkbox.checked = !allChecked;
                        if (!allChecked) {
                            selectedFiles.add(checkbox.value);
                        } else {
                            selectedFiles.delete(checkbox.value);
                        }
                    });
                    
                    updateExportButton();
                }

                function updateFileSelection() {
                    selectedFiles.clear();
                    document.querySelectorAll('.files-list input[type="checkbox"]:checked').forEach(checkbox => {
                        selectedFiles.add(checkbox.value);
                    });
                    updateExportButton();
                }

                function selectExportPath() {
                    vscode.postMessage({ command: 'selectExportPath' });
                }

                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.command) {
                        case 'updateExportPath':
                            exportPath = message.path;
                            document.getElementById('exportPath').textContent = message.path;
                            updateExportButton();
                            break;
                    }
                });

                function exportProject() {
                    if (!selectedFormat || !exportPath || selectedFiles.size === 0) return;
                    
                    const options = {};
                    
                    // Add USFM-specific options
                    if (selectedFormat === 'usfm') {
                        options.skipValidation = document.getElementById('skipValidation').checked;
                    }
                    // Add Audio-specific options
                    if (selectedFormat === 'audio') {
                        options.includeTimestamps = document.getElementById('audioIncludeTimestamps').checked;
                    }
                    // Add Plaintext-specific option to remove IDs
                    if (selectedFormat === 'plaintext') {
                        options.removeIds = document.getElementById('togglePlainTextIds').checked;
                    }
                    
                    vscode.postMessage({
                        command: 'export',
                        format: selectedFormat,
                        userSelectedPath: exportPath,
                        filesToExport: Array.from(selectedFiles),
                        options: options
                    });
                }

                function cancel() {
                    vscode.postMessage({ command: 'cancel' });
                }
            </script>
        </body>
    </html>`;
}
