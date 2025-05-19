import * as vscode from "vscode";

import * as path from "path";

export async function openLicenseEditor() {
    const panel = vscode.window.createWebviewPanel(
        "licenseEditor",
        "Project License",
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
        }
    );

    // Get workspace folder
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage("No workspace folder is open.");
        panel.dispose();
        return;
    }

    const workspaceRoot = workspaceFolders[0].uri;
    const licensePath = vscode.Uri.joinPath(workspaceRoot, "LICENSE");

    // Get project configuration
    const projectConfig = vscode.workspace.getConfiguration("codex-project-manager");

    // Check if LICENSE file exists and read current license info
    const currentLicense = {
        type: "cc0",
        owner: "",
        year: new Date().getFullYear().toString(),
    };

    try {
        const licenseFileExists = await vscode.workspace.fs.stat(licensePath).then(
            () => true,
            () => false
        );

        if (licenseFileExists) {
            const licenseContent = await vscode.workspace.fs.readFile(licensePath);
            const licenseText = new TextDecoder().decode(licenseContent);

            // Try to extract license type and owner from existing file
            const typeMatch = licenseText.match(/License:\s*([\w-]+)/i);
            const ownerMatch = licenseText.match(/Copyright\s*\(c\)\s*\d+\s*(.*?)[\n\r]/i);

            if (typeMatch && typeMatch[1]) {
                currentLicense.type = typeMatch[1].toLowerCase();
            }

            if (ownerMatch && ownerMatch[1]) {
                currentLicense.owner = ownerMatch[1].trim();
            }
        }
    } catch (error) {
        console.error("Error reading LICENSE file:", error);
    }

    // Set webview HTML content
    panel.webview.html = getWebviewContent(currentLicense);

    // Handle messages from the webview
    panel.webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
            case "save": {
                try {
                    const licenseContent = generateLicenseContent(message.licenseData);
                    const fileData = new TextEncoder().encode(licenseContent);
                    await vscode.workspace.fs.writeFile(licensePath, fileData);
                    vscode.window.showInformationMessage("License updated successfully");
                    panel.dispose();
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to save license: ${error}`);
                }
                break;
            }
            case "cancel":
                panel.dispose();
                break;
            case "openLink":
                vscode.env.openExternal(vscode.Uri.parse(message.url));
                break;
        }
    });
}

function generateLicenseContent(licenseData: {
    type: string;
    owner: string;
    year: string;
}): string {
    const { type, owner, year } = licenseData;

    switch (type) {
        case "cc0":
            return `CC0 1.0 Universal (CC0 1.0) Public Domain Dedication
This work is dedicated to the public domain under the CC0 1.0 Universal Public Domain Dedication.

To the extent possible under law, ${owner ? owner : "the copyright holder"} has waived all copyright and related or neighboring rights to this work.

You can copy, modify, distribute and perform the work, even for commercial purposes, all without asking permission.

For more information:
https://creativecommons.org/publicdomain/zero/1.0/

License: cc0`;

        case "cc-by":
            return `Creative Commons Attribution 4.0 International (CC BY 4.0)
Copyright (c) ${year} ${owner}

This work is licensed under the Creative Commons Attribution 4.0 International License.

You are free to:
- Share — copy and redistribute the material in any medium or format
- Adapt — remix, transform, and build upon the material for any purpose, even commercially.

Under the following terms:
- Attribution — You must give appropriate credit, provide a link to the license, and indicate if changes were made.

For more information:
https://creativecommons.org/licenses/by/4.0/

License: cc-by`;

        case "cc-by-sa":
            return `Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)
Copyright (c) ${year} ${owner}

This work is licensed under the Creative Commons Attribution-ShareAlike 4.0 International License.

You are free to:
- Share — copy and redistribute the material in any medium or format
- Adapt — remix, transform, and build upon the material for any purpose, even commercially.

Under the following terms:
- Attribution — You must give appropriate credit, provide a link to the license, and indicate if changes were made.
- ShareAlike — If you remix, transform, or build upon the material, you must distribute your contributions under the same license as the original.

For more information:
https://creativecommons.org/licenses/by-sa/4.0/

License: cc-by-sa`;

        default:
            return `CC0 1.0 Universal (CC0 1.0) Public Domain Dedication
This work is dedicated to the public domain under the CC0 1.0 Universal Public Domain Dedication.

To the extent possible under law, ${owner ? owner : "the copyright holder"} has waived all copyright and related or neighboring rights to this work.

You can copy, modify, distribute and perform the work, even for commercial purposes, all without asking permission.

For more information:
https://creativecommons.org/publicdomain/zero/1.0/

License: cc0`;
    }
}

function getWebviewContent(currentLicense: { type: string; owner: string; year: string }) {
    return `<!DOCTYPE html>
    <html>
        <head>
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
                label {
                    display: block;
                    margin-bottom: 8px;
                    font-weight: bold;
                }
                input, select {
                    padding: 8px;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    width: 100%;
                    font-family: var(--vscode-font-family);
                    margin-bottom: 4px;
                }
                input:focus, select:focus {
                    outline: none;
                    border-color: var(--vscode-focusBorder);
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
                    border-radius: var(--vscode-button-border-radius, 2px);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
                    line-height: 1.4;
                }
                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                button:focus {
                    outline: 1px solid var(--vscode-focusBorder);
                    outline-offset: 2px;
                }
                button.secondary {
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                }
                button.secondary:hover {
                    background-color: var(--vscode-button-secondaryHoverBackground);
                }
                .info-section {
                    margin-top: 16px;
                    padding: 16px;
                    background-color: var(--vscode-editor-inactiveSelectionBackground);
                    border-radius: 4px;
                }
                .info-section h3 {
                    margin-top: 0;
                    margin-bottom: 8px;
                }
                .info-section a {
                    color: var(--vscode-textLink-foreground);
                    text-decoration: none;
                }
                .info-section a:hover {
                    text-decoration: underline;
                    color: var(--vscode-textLink-activeForeground);
                }
                .additional-options {
                    padding: 16px;
                    margin-top: 16px;
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    display: none;
                }
                .faq-item {
                    margin-bottom: 16px;
                }
                .faq-item h4 {
                    margin-bottom: 8px;
                    color: var(--vscode-editor-foreground);
                }
                .faq-item p {
                    margin-top: 0;
                    color: var(--vscode-descriptionForeground);
                }
                .warning {
                    color: var(--vscode-errorForeground);
                    padding: 8px;
                    border-left: 4px solid var(--vscode-errorForeground);
                    margin: 8px 0;
                }
                .license-warning {
                    margin-top: 16px;
                }
                .warning-box {
                    background-color: var(--vscode-inputValidation-warningBackground, #fffbe6);
                    border: 1px solid var(--vscode-inputValidation-warningBorder, #ff8c00);
                    color: var(--vscode-inputValidation-warningForeground, #5c3c00);
                    padding: 16px;
                    border-radius: 4px;
                    margin-top: 12px;
                }
                .warning-box h4 {
                    margin-top: 0;
                    margin-bottom: 12px;
                    color: var(--vscode-errorForeground);
                }
                .warning-actions {
                    display: flex;
                    gap: 8px;
                    margin-top: 16px;
                    flex-wrap: wrap;
                }
                .warning-actions button {
                    flex: 1;
                    min-width: 180px;
                }
                .warning-box ul {
                    margin-top: 8px;
                    margin-bottom: 12px;
                    padding-left: 24px;
                }
                .warning-box li {
                    margin-bottom: 4px;
                }
                .secondary-button {
                    background-color: var(--vscode-button-secondaryBackground) !important;
                    color: var(--vscode-button-secondaryForeground) !important;
                }
                .secondary-button:hover {
                    background-color: var(--vscode-button-secondaryHoverBackground) !important;
                }
                .warning-cancel {
                    background-color: var(--vscode-button-secondaryBackground) !important;
                    color: var(--vscode-button-secondaryForeground) !important;
                }
                .warning-cancel:hover {
                    background-color: var(--vscode-button-secondaryHoverBackground) !important;
                }
                .disclaimer {
                    padding: 8px 12px;
                    margin: 12px 0;
                    font-size: 0.9em;
                    color: var(--vscode-descriptionForeground);
                    background-color: var(--vscode-editorWidget-background);
                    border-left: 3px solid var(--vscode-descriptionForeground);
                    border-radius: 3px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>Project License Settings</h2>
                
                <div>
                    <label for="owner">Project Owner/Attribution:</label>
                    <input type="text" id="owner" placeholder="Enter organization or individual name" value="${escapeHtml(currentLicense.owner)}">
                    <small style="color: var(--vscode-descriptionForeground);">Who owns the copyright to this project</small>
                </div>
                
                <div>
                    <label for="license-type">License Type:</label>
                    <select id="license-type">
                        <option value="cc0" ${currentLicense.type === "cc0" ? "selected" : ""}>CC0 (Public Domain Dedication) - Recommended</option>
                        <option value="other">I need another license type</option>
                    </select>
                </div>
                
                <div id="additional-options" class="additional-options">
                    <div class="warning">
                        Note: Any license other than CC0 may significantly limit how others can use your data. 
                        Consider using CC0 if you want maximum adoption and reuse of your content.
                    </div>
                    
                    <div class="disclaimer">
                        <p><strong>Disclaimer:</strong> The information provided here is for general informational purposes only and is not legal advice. If you're considering a restrictive license, please consult with a legal professional for guidance specific to your situation.</p>
                    </div>

                    <select id="other-license">
                        <option value="cc-by" ${currentLicense.type === "cc-by" ? "selected" : ""}>CC BY (Attribution)</option>
                        <option value="cc-by-sa" ${currentLicense.type === "cc-by-sa" ? "selected" : ""}>CC BY-SA (Attribution-ShareAlike)</option>
                    </select>
                    
                    <div id="cc-by-warning" class="license-warning" style="display: none;">
                        <div class="warning-box">
                            <h4>Practical considerations for CC BY license:</h4>
                            <p>
                                Using CC BY means your work can only be used if you are credited. If you want this restriction to be meaningful, you may wish to consider:
                            </p>
                            <ul>
                                <li>How you'll become aware if someone uses your work without attribution</li>
                                <li>What steps, if any, you might take in response to non-compliance</li>
                                <li>Whether you have the resources to address potential violations</li>
                            </ul>
                            <p>
                                Note: While there's no legal requirement to enforce your license terms, choosing a license with restrictions implies you value those restrictions.
                            </p>
                            <div class="warning-actions">
                                <button onclick="switchToCC0()">Switch to CC0 (recommended)</button>
                                <button class="secondary-button" onclick="confirmLicense('cc-by')">I understand and want CC BY anyway</button>
                            </div>
                        </div>
                    </div>
                    
                    <div id="cc-by-sa-warning" class="license-warning" style="display: none;">
                        <div class="warning-box">
                            <h4>Practical considerations for CC BY-SA license:</h4>
                            <p>
                                Using CC BY-SA means derivative works must use the same license. This has important implications:
                            </p>
                            <ul>
                                <li>Others cannot release derivatives of your work under less restrictive terms</li>
                                <li>This includes preventing others from releasing translations into the public domain</li>
                                <li>The ShareAlike provision creates a perpetual restriction on all downstream works</li>
                            </ul>
                            <p>
                                <strong>Important:</strong> By choosing ShareAlike, you're specifically preventing others from making their translations fully open, even if they want to. They would be required to maintain the same restrictions.
                            </p>
                            <div class="warning-actions">
                                <button onclick="switchToCC0()">Switch to CC0 (recommended)</button>
                                <button class="secondary-button" onclick="confirmLicense('cc-by-sa')">I understand and want CC BY-SA anyway</button>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="info-section">
                    <h3>Why CC0 is Recommended</h3>
                    <p>CC0 allows others to freely build upon, enhance and reuse your work for any purposes without restriction. 
                    It eliminates legal and technical barriers to sharing and reuse, enabling maximum distribution and impact.</p>
                    
                    <div class="faq-item">
                        <h4>Why is CC0 best for open data?</h4>
                        <p>CC0 removes all copyright restrictions, allowing data to be freely shared, combined with other datasets, and used for any purpose without attribution requirements.</p>
                        <p><a href="#" onclick="openLink('https://ryder.dev/blog/why-cc0/')">Learn more about CC0 for open data</a></p>
                        <p><a href="#" onclick="openLink('https://sellingjesus.org/articles/letting-go')">Philosophical aspects of releasing control</a></p>
                    </div>
                    
                    <div class="faq-item">
                        <h4>Can someone else claim copyright if my data is public domain?</h4>
                        <p>No. Releasing your work under CC0 doesn't allow others to claim copyright on your original work, only on their own additions or transformations.</p>
                        <p><a href="#" onclick="openLink('https://sellingjesus.org/articles/copyright-hijacking')">More about copyright concerns</a></p>
                    </div>
                </div>
                
                <div class="button-container">
                    <button class="secondary" onclick="cancel()">Cancel</button>
                    <button onclick="save()">Save</button>
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                const licenseTypeSelect = document.getElementById('license-type');
                const additionalOptions = document.getElementById('additional-options');
                const otherLicenseSelect = document.getElementById('other-license');
                
                // Show/hide additional options based on license selection
                licenseTypeSelect.addEventListener('change', function() {
                    if (this.value === 'other') {
                        additionalOptions.style.display = 'block';
                        updateWarningVisibility();
                    } else {
                        additionalOptions.style.display = 'none';
                    }
                });
                
                // Initialize UI based on current license
                if (licenseTypeSelect.value === 'other') {
                    additionalOptions.style.display = 'block';
                    updateWarningVisibility();
                }
                
                // Show the appropriate warning based on the selected license
                function updateWarningVisibility() {
                    const selectedLicense = otherLicenseSelect.value;
                    document.getElementById('cc-by-warning').style.display = 
                        selectedLicense === 'cc-by' ? 'block' : 'none';
                    document.getElementById('cc-by-sa-warning').style.display = 
                        selectedLicense === 'cc-by-sa' ? 'block' : 'none';
                }
                
                // Add listener to show/hide appropriate warning when license changes
                otherLicenseSelect.addEventListener('change', updateWarningVisibility);
                
                function switchToCC0() {
                    licenseTypeSelect.value = 'cc0';
                    additionalOptions.style.display = 'none';
                }
                
                function confirmLicense(licenseType) {
                    // Just hide the warning, keeping the selected license
                    const warningId = licenseType === 'cc-by' ? 'cc-by-warning' : 'cc-by-sa-warning';
                    document.getElementById(warningId).style.display = 'none';
                }
                
                function save() {
                    const owner = document.getElementById('owner').value;
                    let licenseType = licenseTypeSelect.value;
                    
                    if (licenseType === 'other') {
                        licenseType = otherLicenseSelect.value;
                        
                        // Check if any warning is currently visible
                        const ccByWarningVisible = document.getElementById('cc-by-warning').style.display === 'block';
                        const ccBySaWarningVisible = document.getElementById('cc-by-sa-warning').style.display === 'block';
                        
                        if (ccByWarningVisible || ccBySaWarningVisible) {
                            // If a warning is visible, don't save yet - user needs to confirm or cancel
                            return;
                        }
                    }
                    
                    vscode.postMessage({
                        command: 'save',
                        licenseData: {
                            type: licenseType,
                            owner: owner,
                            year: '${currentLicense.year}'
                        }
                    });
                }
                
                function cancel() {
                    vscode.postMessage({ command: 'cancel' });
                }
                
                function openLink(url) {
                    vscode.postMessage({
                        command: 'openLink',
                        url: url
                    });
                    return false;
                }
            </script>
        </body>
    </html>`;
}

function escapeHtml(unsafe: string) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
