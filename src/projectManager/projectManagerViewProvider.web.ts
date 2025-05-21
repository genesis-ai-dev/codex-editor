import * as vscode from "vscode";

// Define web-specific versions of the message types to avoid linter errors
interface WebProjectManagerMessageFromWebview {
    type: string;
    [key: string]: any;
}

interface WebProjectManagerMessageToWebview {
    type: string;
    [key: string]: any;
}

interface ProjectManagerState {
    projectOverview: any | null;
    webviewReady: boolean;
    watchedFolders: string[];
    projects: any | null;
    isScanning: boolean;
    canInitializeProject: boolean;
    workspaceIsOpen: boolean;
    repoHasRemote: boolean;
    isInitializing: boolean;
}

// Simplified web-compatible ProjectManagerStore
class ProjectManagerStore {
    // Initial state for the project manager
    private preflightState: ProjectManagerState = {
        projectOverview: null,
        webviewReady: false,
        watchedFolders: [],
        projects: null,
        isScanning: false,
        canInitializeProject: false,
        workspaceIsOpen: false,
        repoHasRemote: false,
        isInitializing: false,
    };

    private initialized = false;
    private isRefreshing = false;
    private _onDidChangeState = new vscode.EventEmitter<void>();
    public readonly onDidChangeState = this._onDidChangeState.event;
    private disposables: vscode.Disposable[] = [];
    private _view?: vscode.WebviewView;

    // Array to store state change listeners
    private listeners: ((state: ProjectManagerState) => void)[] = [];

    // Get current state
    getState() {
        return this.preflightState;
    }

    // Update state and notify listeners
    setState(newState: Partial<ProjectManagerState>) {
        this.preflightState = {
            ...this.preflightState,
            ...newState,
        };
        this.notifyListeners();
    }

    // Set the webview reference
    setView(view: vscode.WebviewView) {
        this._view = view;
    }

    // Subscribe to state changes
    subscribe(listener: (state: ProjectManagerState) => void) {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter((l) => l !== listener);
        };
    }

    // Notify all listeners of state changes
    private notifyListeners() {
        this.listeners.forEach((listener) => listener(this.preflightState));
        this._onDidChangeState.fire();
    }

    // Initialize the store - web compatible version
    async initialize() {
        if (this.initialized) return;

        try {
            // Web-compatible initialization logic
            console.log("[Web] Initializing ProjectManagerStore");
            
            // Register limited command set for web
            this.disposables.push(
                vscode.commands.registerCommand(
                    "codex-project-manager.refreshProjects",
                    async () => {
                        await this.refreshState();
                    }
                )
            );

            // Set initial state for web
            this.setState({
                workspaceIsOpen: vscode.workspace.workspaceFolders && 
                                vscode.workspace.workspaceFolders.length > 0,
                canInitializeProject: false, // Web doesn't support project initialization
                repoHasRemote: false, // Web doesn't support Git
            });

            this.initialized = true;
        } catch (error) {
            console.error("[Web] Error initializing ProjectManagerStore:", error);
        }
    }

    // Simplified refresh state for web
    async refreshState() {
        if (this.isRefreshing) return;
        this.isRefreshing = true;

        try {
            console.log("[Web] Refreshing project manager state");
            this.setState({
                workspaceIsOpen: vscode.workspace.workspaceFolders && 
                                vscode.workspace.workspaceFolders.length > 0,
            });
        } catch (error) {
            console.error("[Web] Error refreshing state:", error);
        } finally {
            this.isRefreshing = false;
        }
    }

    // Dispose resources
    dispose() {
        this.disposables.forEach((d) => d.dispose());
    }
}

// Helper to load the webview HTML
const loadWebviewHtml = (webviewView: vscode.WebviewView, extensionUri: vscode.Uri) => {
    const webview = webviewView.webview;
    
    // Set options for the webview
    webview.options = {
        enableScripts: true,
        localResourceRoots: [extensionUri]
    };
    
    // Generate a nonce for scripts
    function getNonce() {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    const nonce = getNonce();
    
    // Generate simplified HTML for web
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}';">
        <title>Project Manager</title>
        <style>
            body {
                font-family: var(--vscode-font-family);
                color: var(--vscode-foreground);
                background-color: var(--vscode-editor-background);
                padding: 16px;
            }
            .container {
                display: flex;
                flex-direction: column;
                gap: 16px;
            }
            h2 {
                margin: 0;
                font-size: 1.2em;
                color: var(--vscode-editor-foreground);
            }
            .message {
                margin-top: 20px;
            }
            button {
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                padding: 8px 12px;
                border-radius: 2px;
                cursor: pointer;
                font-size: 12px;
                margin-top: 10px;
            }
            button:hover {
                background-color: var(--vscode-button-hoverBackground);
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h2>Project Manager</h2>
            <div class="message">
                <p>Limited functionality in web environment.</p>
                <p>Some features are only available in the desktop version.</p>
            </div>
            <button id="refresh-btn">Refresh</button>
        </div>
        <script nonce="${nonce}">
            (function() {
                const vscode = acquireVsCodeApi();
                
                document.getElementById('refresh-btn').addEventListener('click', () => {
                    vscode.postMessage({ type: 'refresh' });
                });
                
                // Send ready message when the webview is loaded
                vscode.postMessage({ type: 'webviewReady' });
            }())
        </script>
    </body>
    </html>`;
};

// Simplified WebviewProvider for web
export class CustomWebviewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _context: vscode.ExtensionContext;
    private store: ProjectManagerStore;
    private disposables: vscode.Disposable[] = [];

    constructor(context: vscode.ExtensionContext) {
        this._context = context;
        this.store = new ProjectManagerStore();
        
        // Initialize the store
        this.store.initialize().catch(err => {
            console.error('[Web] Error initializing store:', err);
        });
    }

    private async handleMessage(message: WebProjectManagerMessageFromWebview) {
        console.log('[Web] Received message:', message);
        
        switch (message.type) {
            case 'webviewReady':
                this.store.setState({ webviewReady: true });
                await this.updateWebviewState();
                break;
            case 'refresh':
                await this.store.refreshState();
                await this.updateWebviewState();
                break;
            default:
                console.warn('[Web] Unhandled message type:', message.type);
        }
    }

    async resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;
        this.store.setView(webviewView);
        
        // Set up the webview
        webviewView.webview.html = loadWebviewHtml(webviewView, this._context.extensionUri);
        
        // Handle messages from the webview
        this.disposables.push(
            webviewView.webview.onDidReceiveMessage(this.handleMessage.bind(this))
        );
        
        // Listen for state changes and update the webview
        this.disposables.push(
            this.store.onDidChangeState(() => {
                this.updateWebviewState();
            })
        );
    }

    private async updateWebviewState() {
        if (this._view) {
            const state = this.store.getState();
            const message: WebProjectManagerMessageToWebview = {
                type: 'setState',
                state
            };
            this._view.webview.postMessage(message);
        }
    }

    dispose() {
        this.store.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}

export function registerProjectManagerViewWebviewProvider(context: vscode.ExtensionContext) {
    console.log('[Web] Registering ProjectManagerViewWebviewProvider');
    const provider = new CustomWebviewProvider(context);
    
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('project-manager-sidebar', provider, {
            webviewOptions: {
                retainContextWhenHidden: true
            }
        })
    );
    
    return provider;
} 