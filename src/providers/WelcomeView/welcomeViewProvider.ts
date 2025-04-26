import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { getAuthApi } from "../../extension";

export class WelcomeViewProvider {
    public static readonly viewType = "codex-welcome-view";

    private _panel?: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _debugMode = false; // Set to true to enable debug UI/logging
    private _isMenuVisible = false; // Track menu visibility state
    private _hasWorkspaceOpen = false; // Track if a workspace is open
    private _isAuthenticated = false; // Track authentication status

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
        // Check authentication status
        this._checkAuthStatus();
    }

    // Check if user is authenticated
    private _checkAuthStatus(): void {
        const authApi = getAuthApi();
        if (authApi) {
            try {
                const authStatus = authApi.getAuthStatus();
                this._isAuthenticated = authStatus.isAuthenticated;
            } catch (error) {
                console.error("Error checking auth status:", error);
                this._isAuthenticated = false;
            }
        } else {
            this._isAuthenticated = false;
        }
    }

    public dispose() {
        this._panel?.dispose();
        this._disposables.forEach((d) => d.dispose());
    }

    /**
     * Checks if a workspace is currently open
     */
    private hasWorkspaceOpen(): boolean {
        return !!(
            vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
        );
    }

    /**
     * Handle main menu actions with ping-pong messaging to track state
     */
    private async handleMainMenu(action: "show" | "hide" | "toggle") {
        console.log(
            `[WelcomeView] Main menu action: ${action}, current state: ${this._isMenuVisible ? "visible" : "hidden"}`
        );

        try {
            let newAction = action;

            // If toggle is requested, determine whether to show or hide
            if (action === "toggle") {
                newAction = this._isMenuVisible ? "hide" : "show";
                console.log(`[WelcomeView] Toggle resolved to: ${newAction}`);
            }

            // Execute the appropriate action
            switch (newAction) {
                case "show":
                    // First make sure sidebar is visible, then focus the main menu
                    console.log("[WelcomeView] Showing and focusing main menu");
                    await vscode.commands.executeCommand(
                        "workbench.action.toggleSidebarVisibility"
                    );
                    await vscode.commands.executeCommand("codex-editor.mainMenu.focus");
                    this._isMenuVisible = true;
                    break;

                case "hide":
                    // Just hide the sidebar
                    console.log("[WelcomeView] Hiding sidebar");
                    await vscode.commands.executeCommand(
                        "workbench.action.toggleSidebarVisibility"
                    );
                    this._isMenuVisible = false;
                    break;
            }

            // Notify the webview of the new state
            if (this._panel) {
                this._panel.webview.postMessage({
                    command: "menuStateChanged",
                    isVisible: this._isMenuVisible,
                    actionPerformed: newAction,
                });
            }
        } catch (error) {
            console.error(`[WelcomeView] Error in handleMainMenu(${action}):`, error);
        }
    }

    /**
     * Handle opening translation file with navigation view focus
     */
    private async handleOpenTranslationFile() {
        console.log("[WelcomeView] Opening and focusing navigation view");

        try {
            // Make sure sidebar is visible
            if (!this._isMenuVisible) {
                await vscode.commands.executeCommand("workbench.action.toggleSidebarVisibility");
                this._isMenuVisible = true;
            }

            // Focus the navigation view (explorer) instead of the main menu
            await vscode.commands.executeCommand("codex-editor.navigation.focus");

            // Notify the webview of the state change
            if (this._panel) {
                this._panel.webview.postMessage({
                    command: "menuStateChanged",
                    isVisible: true,
                    actionPerformed: "show-navigator",
                });
            }
        } catch (error) {
            console.error(`[WelcomeView] Error in handleOpenTranslationFile():`, error);
        }
    }

    public show() {
        // Check if a workspace is open
        this._hasWorkspaceOpen = this.hasWorkspaceOpen();
        // Update authentication status
        this._checkAuthStatus();
        console.log(
            `[WelcomeView] Showing with workspace open: ${this._hasWorkspaceOpen}, authenticated: ${this._isAuthenticated}`
        );

        // If the panel is already showing, just reveal it
        if (this._panel) {
            // Update the HTML in case workspace or auth status changed
            this._panel.webview.html = this._getHtmlForWebview();
            this._panel.reveal(vscode.ViewColumn.One);
            return;
        }

        // Create a new panel
        this._panel = vscode.window.createWebviewPanel(
            WelcomeViewProvider.viewType,
            "Welcome to Codex Editor",
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [this._extensionUri],
                retainContextWhenHidden: true,
            }
        );

        // Set the webview's html content
        this._panel.webview.html = this._getHtmlForWebview();

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(async (message) => {
            // Extract action before the switch statement to avoid lexical declaration in case block
            let requestedAction: "show" | "hide" | "toggle" = "toggle";
            if (message.command === "menuAction" && message.action) {
                if (
                    message.action === "show" ||
                    message.action === "hide" ||
                    message.action === "toggle"
                ) {
                    requestedAction = message.action;
                }
            }

            switch (message.command) {
                case "menuAction":
                    // Process the appropriate action based on current state
                    await this.handleMainMenu(requestedAction);
                    break;

                case "openTranslationFile":
                    // Show the sidebar with explorer view
                    await this.handleOpenTranslationFile();
                    break;

                case "createNewProject":
                    vscode.commands.executeCommand("codex-project-manager.createNewProject");
                    break;

                case "openExistingProject":
                case "viewProjects":
                    vscode.commands.executeCommand("workbench.action.closeActiveEditor");
                    break;

                case "openLoginFlow":
                    this.openLoginFlowWithEditorCheck();
                    break;
            }
        });

        // Reset when the panel is disposed
        this._panel.onDidDispose(() => {
            this._panel = undefined;
        });
    }

    private _getHtmlForWebview(): string {
        const webview = this._panel!.webview;

        // Get styles from the vscode-webview-ui-toolkit
        const codiconsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this._extensionUri,
                "node_modules",
                "@vscode/codicons",
                "dist",
                "codicon.css"
            )
        );

        // Add debug UI elements if in debug mode
        const debugPanel = this._debugMode
            ? `
        <div style="position: fixed; top: 10px; right: 10px; padding: 10px; background-color: var(--vscode-editor-inactiveSelectionBackground); border-radius: 4px; z-index: 1000;">
            <div>Menu State: <span id="menu-state">Hidden</span></div>
            <div>Last Action: <span id="last-action">None</span></div>
            <div style="margin-top: 8px;">
                <button id="debug-show-menu" style="padding: 4px 8px; margin-right: 4px;">Show Menu</button>
                <button id="debug-hide-menu" style="padding: 4px 8px; margin-right: 4px;">Hide Menu</button>
                <button id="debug-toggle-menu" style="padding: 4px 8px;">Toggle Menu</button>
            </div>
        </div>
        `
            : "";

        // Generate different HTML based on whether a workspace is open
        const contentHtml = this._hasWorkspaceOpen
            ? this._getWorkspaceOpenHtml()
            : this._getNoWorkspaceHtml();

        // Add login notification if user is not authenticated
        const loginNotification = !this._isAuthenticated
            ? `
            <div class="login-notification">
                <i class="codicon codicon-warning"></i>
                <span id="login-text">You are not logged in. <a id="login-link" href="#">Log in</a> to sync your changes.</span>
                <div id="login-loading" class="login-loading" style="display: none;">
                    <i class="codicon codicon-loading codicon-modifier-spin"></i>
                    <span>Opening login...</span>
                </div>
            </div>
            `
            : "";

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="${codiconsUri}" rel="stylesheet" />
            <title>Welcome to Codex Editor</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    padding: 20px;
                    margin: 0;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    min-height: 100vh;
                }
                .container {
                    max-width: 800px;
                    text-align: center;
                }
                h1 {
                    font-size: 28px;
                    font-weight: 300;
                    margin-bottom: 20px;
                    color: var(--vscode-foreground);
                }
                .description {
                    font-size: 16px;
                    margin-bottom: 40px;
                    color: var(--vscode-descriptionForeground);
                    line-height: 1.5;
                }
                .actions {
                    display: flex;
                    flex-wrap: wrap;
                    justify-content: center;
                    gap: 20px;
                    margin-bottom: 40px;
                }
                .action-card {
                    background-color: var(--vscode-editor-inactiveSelectionBackground);
                    border-radius: 8px;
                    padding: 20px;
                    width: 200px;
                    transition: all 0.2s ease;
                    cursor: pointer;
                    border: 1px solid transparent;
                }
                .action-card:hover {
                    background-color: var(--vscode-list-hoverBackground);
                    border-color: var(--vscode-focusBorder);
                }
                .icon-container {
                    font-size: 24px;
                    margin-bottom: 12px;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .card-title {
                    font-size: 16px;
                    font-weight: 500;
                    margin-bottom: 8px;
                }
                .card-description {
                    font-size: 13px;
                    color: var(--vscode-descriptionForeground);
                }
                .secondary-actions {
                    display: flex;
                    gap: 16px;
                    justify-content: center;
                }
                .secondary-button {
                    background: none;
                    border: none;
                    color: var(--vscode-textLink-foreground);
                    font-family: var(--vscode-font-family);
                    font-size: 14px;
                    cursor: pointer;
                    padding: 6px 10px;
                    border-radius: 4px;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }
                .secondary-button:hover {
                    background-color: var(--vscode-list-hoverBackground);
                }
                .status {
                    margin-top: 40px;
                    font-size: 12px;
                    color: var(--vscode-descriptionForeground);
                }
                .codicon {
                    font-family: codicon;
                    font-size: 20px;
                    line-height: 20px;
                }
                .login-notification {
                    background-color: var(--vscode-inputValidation-infoBackground);
                    border: 1px solid var(--vscode-inputValidation-infoBorder);
                    color: var(--vscode-inputValidation-infoForeground);
                    padding: 8px 16px;
                    margin-bottom: 20px;
                    border-radius: 4px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    width: 100%;
                    max-width: 600px;
                    text-align: left;
                }
                .login-notification a {
                    color: var(--vscode-textLink-foreground);
                    text-decoration: none;
                    cursor: pointer;
                }
                .login-notification a:hover {
                    text-decoration: underline;
                }
                .login-notification .codicon {
                    font-size: 16px;
                    color: var(--vscode-notificationsInfoIcon-foreground);
                }
                .login-loading {
                    margin-left: auto;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    color: var(--vscode-descriptionForeground);
                    font-size: 12px;
                }
                @keyframes spin {
                    from {
                        transform: rotate(0deg);
                    }
                    to {
                        transform: rotate(360deg);
                    }
                }
                .codicon-modifier-spin {
                    animation: spin 1.5s linear infinite;
                }
            </style>
        </head>
        <body>
            ${debugPanel}
            
            <div class="container">
                ${loginNotification}
                <h1>Welcome to Codex Editor</h1>
                ${contentHtml}
                
                <div class="status" style="display:none;">
                    Waiting for your next action...
                </div>
            </div>
            
            <script>
                const vscode = acquireVsCodeApi();
                
                // Initialize menu state
                let isMenuVisible = false;
                let hasWorkspaceOpen = ${this._hasWorkspaceOpen};
                
                // Update UI based on menu state
                function updateMenuButtonUI() {
                    const buttonText = document.getElementById('menu-button-text');
                    const buttonDesc = document.getElementById('menu-button-desc');
                    
                    if (buttonText && buttonDesc) {
                        if (isMenuVisible) {
                            buttonText.textContent = 'Close Main Menu';
                            buttonDesc.textContent = 'Hide tools and project options';
                        } else {
                            buttonText.textContent = 'Open Main Menu';
                            buttonDesc.textContent = 'View tools and project options';
                        }
                    }
                    
                    // Update debug panel if it exists
                    const menuStateEl = document.getElementById('menu-state');
                    if (menuStateEl) {
                        menuStateEl.textContent = isMenuVisible ? 'Visible' : 'Hidden';
                        menuStateEl.style.color = isMenuVisible ? 'var(--vscode-terminal-ansiGreen)' : 'var(--vscode-terminal-ansiRed)';
                    }
                }
                
                // Add event listeners to buttons
                const menuToggleButton = document.getElementById('menuToggleButton');
                if (menuToggleButton) {
                    menuToggleButton.addEventListener('click', () => {
                        // Send the appropriate action based on current state
                        const action = isMenuVisible ? 'hide' : 'show';
                        vscode.postMessage({ 
                            command: 'menuAction',
                            action: action
                        });
                    });
                }
                
                const createNewProject = document.getElementById('createNewProject');
                if (createNewProject) {
                    createNewProject.addEventListener('click', () => {
                        vscode.postMessage({ command: 'createNewProject' });
                    });
                }
                
                const openTranslationFile = document.getElementById('openTranslationFile');
                if (openTranslationFile) {
                    openTranslationFile.addEventListener('click', () => {
                        vscode.postMessage({ command: 'openTranslationFile' });
                    });
                }
                
                const openExistingProject = document.getElementById('openExistingProject');
                if (openExistingProject) {
                    openExistingProject.addEventListener('click', () => {
                        vscode.postMessage({ command: 'openExistingProject' });
                    });
                }
                
                const viewProjects = document.getElementById('viewProjects');
                if (viewProjects) {
                    viewProjects.addEventListener('click', () => {
                        vscode.postMessage({ command: 'viewProjects' });
                    });
                }
                
                // Login link handler
                const loginLink = document.getElementById('login-link');
                if (loginLink) {
                    loginLink.addEventListener('click', (e) => {
                        e.preventDefault();
                        
                        // Show loading indicator
                        const loadingIndicator = document.getElementById('login-loading');
                        if (loadingIndicator) {
                            loadingIndicator.style.display = 'flex';
                        }
                        
                        // Hide the login text
                        const loginText = document.getElementById('login-text');
                        if (loginText) {
                            loginText.style.display = 'none';
                        }
                        
                        vscode.postMessage({ command: 'openLoginFlow' });
                    });
                }
                
                // Debug buttons if available
                if (${this._debugMode}) {
                    document.getElementById('debug-show-menu').addEventListener('click', () => {
                        vscode.postMessage({ command: 'menuAction', action: 'show' });
                    });
                    
                    document.getElementById('debug-hide-menu').addEventListener('click', () => {
                        vscode.postMessage({ command: 'menuAction', action: 'hide' });
                    });
                    
                    document.getElementById('debug-toggle-menu').addEventListener('click', () => {
                        vscode.postMessage({ command: 'menuAction', action: 'toggle' });
                    });
                }
                
                // Handle messages from extension
                window.addEventListener('message', event => {
                    const message = event.data;
                    
                    if (message.command === 'menuStateChanged') {
                        // Update our tracked state
                        isMenuVisible = message.isVisible;
                        
                        // Update the UI
                        updateMenuButtonUI();
                        
                        // Update debug info
                        const lastActionElement = document.getElementById('last-action');
                        if (lastActionElement) {
                            lastActionElement.textContent = message.actionPerformed;
                            lastActionElement.style.color = 'var(--vscode-terminal-ansiYellow)';
                            
                            // Flash the element
                            lastActionElement.style.transition = 'color 0.3s';
                            setTimeout(() => {
                                lastActionElement.style.color = 'var(--vscode-terminal-ansiGreen)';
                            }, 300);
                        }
                    } else if (message.command === 'showLoginLoading') {
                        // If loading is complete and we got an error, reset the UI
                        if (!message.loading) {
                            const loadingIndicator = document.getElementById('login-loading');
                            if (loadingIndicator) {
                                loadingIndicator.style.display = 'none';
                            }
                            
                            // Show the login text again
                            const loginText = document.getElementById('login-text');
                            if (loginText) {
                                loginText.style.display = 'inline';
                            }
                        }
                    }
                });
                
                // Initialize UI on load
                updateMenuButtonUI();
            </script>
        </body>
        </html>`;
    }

    /**
     * Returns HTML content for when a workspace is open
     */
    private _getWorkspaceOpenHtml(): string {
        return `
            <p class="description">
                Codex Editor helps you create beautiful and accurate translations. 
                Get started by opening the main menu or continuing your recent work.
            </p>
            
            <div class="actions">
                <div class="action-card" id="menuToggleButton">
                    <div class="icon-container">
                        <i class="codicon codicon-menu"></i>
                    </div>
                    <div class="card-title" id="menu-button-text">Open Main Menu</div>
                    <div class="card-description" id="menu-button-desc">View tools and project options</div>
                </div>
                
                <div class="action-card" id="createNewProject" style="display:none;">
                    <div class="icon-container">
                        <i class="codicon codicon-add"></i>
                    </div>
                    <div class="card-title">Create New Project</div>
                    <div class="card-description">Start a new translation project</div>
                </div>
                
                <div class="action-card" id="openTranslationFile">
                    <div class="icon-container">
                        <i class="codicon codicon-file-code"></i>
                    </div>
                    <div class="card-title">Open Translation File</div>
                    <div class="card-description">Browse and select a file to edit</div>
                </div>
            </div>
            
            <div class="secondary-actions" style="display:none;">
                <button class="secondary-button" id="openExistingProject">
                    <i class="codicon codicon-folder-opened"></i>
                    Open Existing Project
                </button>
            </div>`;
    }

    /**
     * Returns HTML content for when no workspace is open
     */
    private _getNoWorkspaceHtml(): string {
        return `
            <p class="description">
                Welcome to Codex Editor. You don't have any project open.
            </p>
            
            <div class="actions">
                <div class="action-card" id="viewProjects">
                    <div class="icon-container">
                        <i class="codicon codicon-folder-opened"></i>
                    </div>
                    <div class="card-title">View Projects</div>
                    <div class="card-description">Open or create a translation project</div>
                </div>
            </div>`;
    }

    private async openLoginFlowWithEditorCheck() {
        console.log("[WelcomeView] Opening login flow with editor check");

        try {
            // Show loading indicator in the welcome view
            if (this._panel) {
                this._panel.webview.postMessage({
                    command: "showLoginLoading",
                    loading: true,
                });
            }

            // Get current editor count before opening login flow
            const initialEditorCount = vscode.window.visibleTextEditors.length;
            console.log(
                `[WelcomeView] Current editor count before opening login: ${initialEditorCount}`
            );

            // Open the startup flow without closing the welcome view
            await vscode.commands.executeCommand(
                "vscode.openWith",
                vscode.Uri.parse("untitled:startupflow.codex"),
                "startupFlowProvider"
            );

            // Hide loading indicator after startup flow is opened
            if (this._panel) {
                // Short delay to ensure the flow has time to initialize
                setTimeout(() => {
                    this._panel?.webview.postMessage({
                        command: "showLoginLoading",
                        loading: false,
                    });
                }, 1000);
            }
        } catch (error) {
            // If opening fails, hide the loading indicator and show error
            if (this._panel) {
                this._panel.webview.postMessage({
                    command: "showLoginLoading",
                    loading: false,
                });
            }
            console.error("Error opening login flow:", error);
            vscode.window.showErrorMessage("Failed to open login screen");
        }
    }
}
