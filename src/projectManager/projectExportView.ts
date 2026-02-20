import { CodexExportFormat } from "../exportHandler/exportHandler";
import * as vscode from "vscode";
import { safePostMessageToPanel } from "../utils/webviewUtils";
import {
    groupCodexFilesByImporterType,
    EXPORT_OPTIONS_BY_FILE_TYPE,
    type FileGroup,
} from "./utils/exportViewUtils";

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
            "node_modules",
            "@vscode/codicons",
            "dist",
            "codicon.css"
        )
    );

    const codexFiles = await vscode.workspace.findFiles("**/*.codex");
    const fileGroups = await groupCodexFilesByImporterType(codexFiles);

    panel.webview.html = getWebviewContent(
        sourceLanguage,
        targetLanguage,
        codiconsUri,
        fileGroups
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
            case "openProjectSettings":
                await vscode.commands.executeCommand(
                    "codex-project-manager.openProjectSettings"
                );
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
    fileGroups: FileGroup[]
) {
    const hasLanguages = sourceLanguage && targetLanguage;

    const groupsJson = JSON.stringify(fileGroups);
    const exportOptionsConfigJson = JSON.stringify(EXPORT_OPTIONS_BY_FILE_TYPE);

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
                .step-panel { display: none; }
                .step-panel.active { display: flex; flex-direction: column; flex: 1; gap: 16px; }
                .step-indicator {
                    display: flex;
                    gap: 8px;
                    align-items: center;
                    font-size: 0.85em;
                    color: var(--vscode-descriptionForeground);
                }
                .step-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--vscode-input-border); }
                .step-dot.active { background: var(--vscode-focusBorder); }
                .step-dot.completed { background: var(--vscode-charts-green, #16a34a); }
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
                    align-items: center;
                    gap: 12px;
                }
                .format-option:hover { background-color: var(--vscode-list-hoverBackground); }
                .format-option.selected {
                    border-color: var(--vscode-focusBorder);
                    background-color: var(--vscode-list-activeSelectionBackground);
                }
                .top-bar {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 16px;
                    flex-shrink: 0;
                }
                .button-container {
                    display: flex;
                    justify-content: flex-end;
                    gap: 8px;
                }
                .button-container .step-btn { display: none; }
                .button-container .step-btn.visible { display: flex; }
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
                .format-section-content .format-option { margin-bottom: 8px; padding: 12px; }
                .format-section-content .format-option:last-child { margin-bottom: 0; }
                .format-option-row { display: flex; gap: 1rem; }
                .format-option[data-option].hidden { display: none !important; }
                .format-section[data-option].hidden { display: none !important; }
                .format-option-row[data-option].hidden { display: none !important; }
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
                .step-content { flex: 1; overflow-y: auto; }
            </style>
        </head>
        <body>
            <div class="container">
                ${hasLanguages
            ? `
                <div class="top-bar">
                    <div class="step-indicator">
                        <span class="step-dot" id="stepDot1"></span>
                        <span class="step-dot" id="stepDot2"></span>
                        <span class="step-dot" id="stepDot3"></span>
                    </div>
                    <div class="button-container">
                        <button class="secondary step-btn visible" id="btnCancel" onclick="cancel()">Cancel</button>
                        <button class="secondary step-btn" id="btnBack" onclick="goBack()">Back</button>
                        <button class="step-btn visible" id="nextStep1" disabled onclick="goToStep2()">Next Step</button>
                        <button class="step-btn" id="nextStep2" disabled onclick="goToStep3()">Next Step</button>
                        <button class="step-btn" id="exportButton" disabled onclick="exportProject()">
                            <i class="codicon codicon-arrow-down"></i>
                            Export
                        </button>
                    </div>
                </div>

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
                        <h3>Audio Export</h3>
                        <div style="margin-bottom: 12px;">
                            <div class="format-option" id="audio-format" data-format="audio" data-option="audio" style="display:flex; gap:12px; padding:12px;">
                                <i class="codicon codicon-mic" style="align-self:flex-start; margin-top:6px;"></i>
                                <div style="flex:1;">
                                    <strong>Audio</strong>
                                    <p style="margin:4px 0 0 0; color: var(--vscode-descriptionForeground);">Export per-cell audio attachments alongside the selected export format</p>
                                    <div style="margin-top: 6px; display: flex; align-items: center; gap: 6px;">
                                        <input type="checkbox" id="audioIncludeTimestamps" />
                                        <label for="audioIncludeTimestamps">Embed timestamps in audio metadata (WAV, WebM, M4A)</label>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <h3>Select Export Format</h3>
                        <div id="formatOptionsContainer" style="display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1rem;">
                            <!-- Subtitle options: first, only for subtitles, always open -->
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
                            <div class="format-option-row" data-option="roundTrip">
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
                            <!-- First row: Generate Plaintext + Generate XLIFF -->
                            <div style="display: flex; gap: 1rem;">
                                <div class="format-option" data-format="plaintext" data-option="plaintext" style="flex: 1;">
                                    <i class="codicon codicon-file-text"></i>
                                    <div>
                                        <strong>Generate Plaintext</strong>
                                        <p>Export as plain text files with minimal formatting</p>
                                    </div>
                                </div>
                                <div class="format-option" data-format="xliff" data-option="xliff" style="flex: 1;">
                                    <i class="codicon codicon-symbol-interface"></i>
                                    <div>
                                        <strong>Generate XLIFF</strong>
                                        <p>Export in XML Localization Interchange File Format (XLIFF) for translation workflows</p>
                                        <span class="format-tag">Translation Ready</span>
                                    </div>
                                </div>
                            </div>
                            <!-- Second row (only shown for eBible and USFM groups): Generate USFM + Generate HTML -->
                            <div class="format-option-row" style="display: flex; gap: 1rem;" data-option="usfm">
                                <div class="format-option" data-format="usfm" data-option="usfm" style="flex: 1;">
                                    <i class="codicon codicon-file-code"></i>
                                    <div>
                                        <strong>Generate USFM</strong>
                                        <p>Export in Universal Standard Format Markers</p>
                                    </div>
                                </div>
                                <div class="format-option" data-format="html" data-option="html" style="flex: 1;">
                                    <i class="codicon codicon-browser"></i>
                                    <div>
                                        <strong>Generate HTML</strong>
                                        <p>Export as web pages with chapter navigation</p>
                                    </div>
                                </div>
                            </div>
                            <!-- Audio moved to its own section above -->
                            <!-- Backtranslations removed from here and moved into Data Export section -->
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
                    </div>
                    <div id="usfmOptions" style="display: none; margin-top: 16px; padding: 8px; border: 1px solid var(--vscode-input-border); border-radius: 4px;">
                        <h4>USFM Export Options</h4>
                        <div style="display: flex; align-items: center; margin-top: 8px;">
                            <input type="checkbox" id="skipValidation">
                            <label for="skipValidation" style="margin-left: 8px;">Skip USFM validation (faster export, but may produce invalid USFM)</label>
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

            <script>
                const vscode = acquireVsCodeApi();
                const fileGroups = ${groupsJson};
                const exportOptionsConfig = ${exportOptionsConfigJson};
                let currentStep = 1;
                let selectedFormat = null;
                let selectedAudio = false;
                let exportPath = null;
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

                function initStep2Options() {
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
                    // Visibility for HTML/USFM is controlled by data-option and exportOptionsConfig
                    selectedFormat = null;
                    // Clear previous selected state for format options but keep audio selection intact
                    document.querySelectorAll('#step2 .format-option').forEach(opt => {
                        if (opt.id === 'audio-format' || opt.dataset.format === 'audio') return;
                        opt.classList.remove('selected');
                        // remove any inline visual overrides that may have been applied
                        opt.style.backgroundColor = '';
                        opt.style.borderColor = '';
                    });
                    updateStep2Button();
                }

                function updateButtonVisibility() {
                    document.querySelectorAll('.button-container .step-btn').forEach(btn => btn.classList.remove('visible'));
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
                    document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
                    document.getElementById('step' + n).classList.add('active');
                    document.querySelectorAll('.step-dot').forEach((dot, i) => {
                        dot.classList.remove('active', 'completed');
                        if (i + 1 < n) dot.classList.add('completed');
                        else if (i + 1 === n) dot.classList.add('active');
                    });
                    currentStep = n;
                    updateButtonVisibility();
                    if (n === 2) {
                        initStep2Options();
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
                    if (btn) btn.disabled = !(selectedFormat || selectedAudio);
                }

                function updateExportButton() {
                    const btn = document.getElementById('exportButton');
                    // Export allowed if a format or audio is selected
                    const hasAnyFormat = !!(selectedFormat || selectedAudio);
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
                });

                document.addEventListener('DOMContentLoaded', () => {
                    renderFileGroups();
                    updateStep1Button();

                    document.querySelectorAll('#step2 .format-option').forEach(option => {
                        option.addEventListener('click', (e) => {
                            if (e.target.closest('.format-section-header')) return;
                            // If this is the audio block, toggle audio selection instead of treating as format
                            if (option.id === 'audio-format' || option.dataset.format === 'audio') {
                                const willSelect = !selectedAudio;
                                if (willSelect) {
                                    option.classList.add('selected');
                                    try {
                                        const root = document.documentElement;
                                        const bg = getComputedStyle(root).getPropertyValue('--vscode-list-activeSelectionBackground') || '';
                                        const border = getComputedStyle(root).getPropertyValue('--vscode-focusBorder') || '';
                                        if (bg) option.style.backgroundColor = bg.trim();
                                        if (border) option.style.borderColor = border.trim();
                                    } catch (e) { }
                                } else {
                                    option.classList.remove('selected');
                                    option.style.backgroundColor = '';
                                    option.style.borderColor = '';
                                }
                                selectedAudio = willSelect;
                                // Refresh button states immediately when audio toggled
                                try { updateStep2Button(); updateExportButton(); } catch (e) {}
                                return;
                            }

                            // If clicking the already-selected format, deselect it
                            if (option.classList.contains('selected')) {
                                option.classList.remove('selected');
                                selectedFormat = null;
                                // hide any USFM-specific options
                                const usfmOptions = document.getElementById('usfmOptions');
                                if (usfmOptions) usfmOptions.style.display = 'none';
                                updateStep2Button();
                                return;
                            }

                            // Select this format and clear other non-audio format selections
                            document.querySelectorAll('#step2 .format-option').forEach(opt => {
                                if (opt.id === 'audio-format' || opt.dataset.format === 'audio') return;
                                opt.classList.remove('selected');
                                opt.style.backgroundColor = '';
                                opt.style.borderColor = '';
                            });
                            option.classList.add('selected');
                            selectedFormat = option.dataset.format;
                            const usfmOptions = document.getElementById('usfmOptions');
                            if (usfmOptions) usfmOptions.style.display = selectedFormat === 'usfm' ? 'block' : 'none';
                            updateStep2Button();
                        });
                    });

                    // audio toggling handled in the format-option click handler above; no separate toggleAudio needed

                    // audio-format is handled by the general format-option click handler above

                });

                function exportProject() {
                    const formatToSend = selectedFormat || (selectedAudio ? 'audio' : null);
                    if (!formatToSend || !exportPath || selectedFiles.size === 0) return;
                    const options = {};
                    if (formatToSend === 'usfm') options.skipValidation = document.getElementById('skipValidation')?.checked;
                    // Audio is now a separate toggle that may be combined with other export formats
                    if (selectedAudio) options.includeAudio = true;
                    if (selectedAudio) options.includeTimestamps = document.getElementById('audioIncludeTimestamps')?.checked;
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
