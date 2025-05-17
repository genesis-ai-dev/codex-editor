import * as vscode from 'vscode';
import {
    ProjectManagerMessageFromWebview,
    ProjectManagerMessageToWebview,
    ProjectManagerState,
    ProjectOverview,
} from '../../types';

class ProjectManagerStore {
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
    private listeners: ((state: ProjectManagerState) => void)[] = [];

    getState() {
        return this.preflightState;
    }

    setState(newState: Partial<ProjectManagerState>) {
        this.preflightState = {
            ...this.preflightState,
            ...newState,
        };
        this.notifyListeners();
    }

    setView(view: vscode.WebviewView) {
        this._view = view;
    }

    subscribe(listener: (state: ProjectManagerState) => void) {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter((l) => l !== listener);
        };
    }

    private notifyListeners() {
        this.listeners.forEach((listener) => listener(this.preflightState));
        this._onDidChangeState.fire();
    }

    async initialize() {
        if (this.initialized) return;

        try {
            console.log('Initializing web project manager store...');
            
            // Register web-specific commands
            this.disposables.push(
                vscode.commands.registerCommand(
                    'codex-project-manager.refreshProjects',
                    async () => {
                        await this.refreshState();
                    }
                )
            );

            // Set initial state
            this.setState({
                webviewReady: true,
                isScanning: false,
                watchedFolders: [],
                workspaceIsOpen: Boolean(vscode.workspace.workspaceFolders?.length),
            });

            this.initialized = true;
            console.log('Web project manager store initialized successfully');
        } catch (error) {
            console.error('Failed to initialize web store:', error);
            this.setState({ isScanning: false });
            throw error;
        }
    }

    async refreshState() {
        if (this.isRefreshing) return;
        this.isRefreshing = true;

        try {
            console.log('Refreshing web project manager state...');
            
            // Update workspace state
            this.setState({
                workspaceIsOpen: Boolean(vscode.workspace.workspaceFolders?.length),
            });

            // In web environment, we'll use a simplified project overview
            this.setState({
                projectOverview: null,
                isScanning: false,
            });

            console.log('Web project manager state refreshed successfully');
        } catch (error) {
            console.error('Error refreshing web state:', error);
            this.setState({ isScanning: false });
        } finally {
            this.isRefreshing = false;
        }
    }

    dispose() {
        this.disposables.forEach(d => d.dispose());
    }
}

export class CustomWebviewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _context: vscode.ExtensionContext;
    private store: ProjectManagerStore;
    private disposables: vscode.Disposable[] = [];

    constructor(context: vscode.ExtensionContext) {
        this._context = context;
        this.store = new ProjectManagerStore();
        this.store.initialize().catch(error => {
            console.error('Failed to initialize web project manager:', error);
        });
    }

    async resolveWebviewView(webviewView: vscode.WebviewView) {
        console.log('Resolving web project manager webview...');
        
        this._view = webviewView;
        this.store.setView(webviewView);

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._context.extensionUri],
        };

        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (message: ProjectManagerMessageFromWebview) => {
            console.log('Received message from webview:', message);
            
            try {
                switch (message.command) {
                    case 'refreshState':
                        await this.store.refreshState();
                        break;
                    default:
                        console.warn('Unknown message command:', message.command);
                }
            } catch (error) {
                console.error('Error handling webview message:', error);
                webviewView.webview.postMessage({
                    type: 'error',
                    error: error instanceof Error ? error.message : 'Unknown error occurred',
                });
            }
        });

        // Send initial state
        this.store.subscribe(state => {
            if (webviewView.visible) {
                webviewView.webview.postMessage({
                    type: 'state',
                    state,
                });
            }
        });

        console.log('Web project manager webview resolved successfully');
    }

    private getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Codex Project Manager</title>
            <style>
                body {
                    padding: 20px;
                    color: var(--vscode-foreground);
                    font-family: var(--vscode-font-family);
                }
                .container {
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                }
                .status {
                    padding: 10px;
                    border-radius: 4px;
                    background: var(--vscode-badge-background);
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="status" id="status">Loading...</div>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                let currentState = null;

                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.type) {
                        case 'state':
                            currentState = message.state;
                            updateUI();
                            break;
                        case 'error':
                            document.getElementById('status').textContent = 'Error: ' + message.error;
                            break;
                    }
                });

                function updateUI() {
                    if (!currentState) return;
                    
                    const status = document.getElementById('status');
                    if (currentState.isScanning) {
                        status.textContent = 'Scanning for projects...';
                    } else if (currentState.projectOverview) {
                        status.textContent = \`Found \${currentState.projectOverview.totalProjects} projects\`;
                    } else {
                        status.textContent = 'No projects found';
                    }
                }

                // Request initial state
                vscode.postMessage({ command: 'refresh' });
            </script>
        </body>
        </html>`;
    }
}

export function registerProjectManagerViewWebviewProvider(context: vscode.ExtensionContext) {
    console.log('Registering web project manager view provider...');
    const provider = new CustomWebviewProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('codex-project-manager', provider)
    );
    console.log('Web project manager view provider registered successfully');
} 