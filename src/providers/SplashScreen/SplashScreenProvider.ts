import * as vscode from "vscode";
import { ActivationTiming } from "../../extension";

export class SplashScreenProvider {
    public static readonly viewType = "codex-splash-screen";

    private _panel?: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _timings: ActivationTiming[] = [];
    private _activationStart: number = 0;

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
    }

    public dispose() {
        this._panel?.dispose();
        this._disposables.forEach((d) => d.dispose());
    }

    public show(activationStart: number) {
        this._activationStart = activationStart;

        // If the panel is already showing, just reveal it
        if (this._panel) {
            this._panel.reveal(vscode.ViewColumn.One);
            return;
        }

        // Create a new panel
        this._panel = vscode.window.createWebviewPanel(
            SplashScreenProvider.viewType,
            "Codex Editor",
            {
                viewColumn: vscode.ViewColumn.One,
                preserveFocus: true,
            },
            {
                enableScripts: true,
                localResourceRoots: [this._extensionUri],
                retainContextWhenHidden: true,
            }
        );

        // Set webview options
        this._panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        // Make the panel stay on top
        this._panel.reveal(vscode.ViewColumn.One, true);

        // Set the initial HTML content
        this._updateWebview();

        // Reset when the panel is disposed
        this._panel.onDidDispose(() => {
            this._panel = undefined;
        });

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage((message) => {
            switch (message.command) {
                case "close":
                    this._panel?.dispose();
                    break;
            }
        });
    }

    public updateTimings(timings: ActivationTiming[]) {
        this._timings = timings;
        this._updateWebview();
    }

    public close() {
        this._panel?.dispose();
    }

    public get panel(): vscode.WebviewPanel | undefined {
        return this._panel;
    }

    private _updateWebview() {
        if (!this._panel) return;
        this._panel.webview.html = this._getHtmlForWebview();
    }

    private _getHtmlForWebview(): string {
        const webview = this._panel!.webview;

        // Create URIs for scripts and styles
        const animeJsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, "media", "anime.min.js")
        );

        // Calculate overall progress
        const totalDuration =
            this._timings.length > 0 ? globalThis.performance.now() - this._activationStart : 0;

        // Format timings for display
        const timingsJson = JSON.stringify(this._timings);

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Codex Editor Loading</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    padding: 0;
                    margin: 0;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    overflow: hidden;
                }
                .container {
                    width: 80%;
                    max-width: 600px;
                    text-align: center;
                }
                h1 {
                    font-size: 28px;
                    font-weight: 300;
                    margin-bottom: 20px;
                }
                .logo {
                    margin-bottom: 30px;
                    position: relative;
                    width: 100px;
                    height: 100px;
                    margin: 0 auto 30px;
                }
                .loading-stages {
                    text-align: left;
                    margin-top: 30px;
                }
                .loading-stage {
                    margin-bottom: 10px;
                    display: flex;
                    align-items: center;
                    opacity: 0.5;
                }
                .loading-stage.active {
                    opacity: 1;
                    font-weight: bold;
                }
                .loading-stage.completed {
                    opacity: 0.8;
                    color: var(--vscode-terminal-ansiGreen);
                }
                .loading-indicator {
                    display: inline-block;
                    margin-right: 10px;
                    width: 16px;
                    height: 16px;
                }
                .loading-circle {
                    fill: none;
                    stroke: var(--vscode-progressBar-background);
                    stroke-width: 3;
                    stroke-linecap: round;
                }
                .loading-check {
                    fill: none;
                    stroke: var(--vscode-terminal-ansiGreen);
                    stroke-width: 3;
                    stroke-linecap: round;
                    stroke-linejoin: round;
                    display: none;
                }
                .loading-stage.completed .loading-check {
                    display: inline;
                }
                .loading-stage.completed .loading-circle {
                    display: none;
                }
                .progress-container {
                    height: 4px;
                    width: 100%;
                    background-color: var(--vscode-progressBar-background);
                    opacity: 0.3;
                    margin-top: 30px;
                    overflow: hidden;
                    border-radius: 2px;
                }
                .progress-bar {
                    height: 100%;
                    width: 0%;
                    background-color: var(--vscode-progressBar-background);
                    border-radius: 2px;
                }
                .squares {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                }
                .square {
                    position: absolute;
                    width: 20px;
                    height: 20px;
                    background-color: var(--vscode-progressBar-background);
                    opacity: 0.8;
                }
                .current-step {
                    margin-top: 20px;
                    font-size: 14px;
                    color: var(--vscode-descriptionForeground);
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="logo">
                    <div class="squares"></div>
                </div>
                
                <h1>Codex Editor is loading</h1>
                
                <div class="current-step" id="current-step">
                    Initializing...
                </div>
                
                <div class="progress-container">
                    <div class="progress-bar" id="progress-bar"></div>
                </div>
                
                <div class="loading-stages" id="loading-stages">
                    <!-- Loading stages will be injected here -->
                </div>
            </div>
            
            <script src="${animeJsUri}"></script>
            <script>
                const vscode = acquireVsCodeApi();
                
                // Initialization animation
                function initializeAnimations() {
                    // Create squares for the logo animation
                    const squaresContainer = document.querySelector('.squares');
                    const numSquares = 9;
                    const squareSize = 20;
                    
                    for (let i = 0; i < numSquares; i++) {
                        const square = document.createElement('div');
                        square.classList.add('square');
                        squaresContainer.appendChild(square);
                    }
                    
                    // Create the logo animation
                    const squares = document.querySelectorAll('.square');
                    
                    anime.timeline({
                        loop: true
                    })
                    .add({
                        targets: squares,
                        scale: [
                            {value: .1, easing: 'easeOutSine', duration: 500},
                            {value: 1, easing: 'easeInOutQuad', duration: 1200}
                        ],
                        delay: anime.stagger(200, {grid: [3, 3], from: 'center'}),
                        opacity: [
                            {value: 0, duration: 0},
                            {value: 1, easing: 'easeOutSine', duration: 500},
                            {value: 0, easing: 'easeInOutQuad', duration: 1200}
                        ],
                        translateX: anime.stagger(10, {grid: [3, 3], from: 'center', axis: 'x'}),
                        translateY: anime.stagger(10, {grid: [3, 3], from: 'center', axis: 'y'}),
                        rotate: anime.stagger([0, 90], {grid: [3, 3], from: 'center'})
                    });
                }

                // Update the UI with the latest timings
                function updateLoadingStages(timings) {
                    if (!timings || timings.length === 0) return;
                    
                    const stagesContainer = document.getElementById('loading-stages');
                    const currentStepEl = document.getElementById('current-step');
                    const progressBar = document.getElementById('progress-bar');
                    
                    // Clear existing content
                    stagesContainer.innerHTML = '';
                    
                    // Calculate total duration
                    const lastTiming = timings[timings.length - 1];
                    const totalTime = lastTiming.startTime + lastTiming.duration - timings[0].startTime;
                    const progress = Math.min(95, Math.round((totalTime / 5000) * 100));
                    
                    // Update progress bar (cap at 95% until complete)
                    anime({
                        targets: progressBar,
                        width: progress + '%',
                        easing: 'easeInOutQuad',
                        duration: 800
                    });
                    
                    // Update current step
                    const latestStepIndex = timings.length - 1;
                    const latestStep = timings[latestStepIndex];
                    currentStepEl.textContent = 'Loading: ' + latestStep.step;
                    
                    // Create stage elements for major steps only
                    const majorSteps = timings.filter(t => !t.step.startsWith('•'));
                    
                    majorSteps.forEach((timing, index) => {
                        const stageEl = document.createElement('div');
                        stageEl.className = 'loading-stage';
                        
                        if (index === majorSteps.length - 1) {
                            stageEl.classList.add('active');
                        } else {
                            stageEl.classList.add('completed');
                        }
                        
                        stageEl.innerHTML = \`
                            <div class="loading-indicator">
                                <svg viewBox="0 0 16 16">
                                    <circle class="loading-circle" cx="8" cy="8" r="6"></circle>
                                    <polyline class="loading-check" points="4,8 7,11 12,5"></polyline>
                                </svg>
                            </div>
                            \${timing.step}
                        \`;
                        
                        stagesContainer.appendChild(stageEl);
                    });
                }

                // Initialize on load
                document.addEventListener('DOMContentLoaded', () => {
                    initializeAnimations();
                    
                    // Get initial timings
                    const initialTimings = ${timingsJson};
                    updateLoadingStages(initialTimings);
                });

                // Handle messages from the extension
                window.addEventListener('message', event => {
                    const message = event.data;
                    
                    if (message.command === 'update') {
                        updateLoadingStages(message.timings);
                    } else if (message.command === 'complete') {
                        // Show 100% complete and close after delay
                        const progressBar = document.getElementById('progress-bar');
                        const currentStepEl = document.getElementById('current-step');
                        
                        currentStepEl.textContent = 'Loading complete!';
                        currentStepEl.style.color = 'var(--vscode-terminal-ansiGreen)';
                        
                        anime({
                            targets: progressBar,
                            width: '100%',
                            easing: 'easeInOutQuad',
                            duration: 500,
                            complete: function() {
                                // Ask the extension to close the splash screen after a short delay
                                setTimeout(() => {
                                    vscode.postMessage({ command: 'close' });
                                }, 800);
                            }
                        });
                    }
                });
            </script>
        </body>
        </html>`;
    }
}
