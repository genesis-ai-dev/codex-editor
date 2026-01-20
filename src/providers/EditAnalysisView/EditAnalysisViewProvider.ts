import * as vscode from "vscode";
import { analyzeEditHistory } from "../../activationHelpers/contextAware/contentIndexes/indexes/editHistory";
import { readLocalProjectSettings, writeLocalProjectSettings } from "../../utils/localProjectSettings";
import { trackWebviewPanel } from "../../utils/webviewTracker";

export class EditAnalysisProvider implements vscode.Disposable {
    public static readonly viewType = "codex-editor.editAnalysis";
    private _panel?: vscode.WebviewPanel;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    dispose() {
        this._panel?.dispose();
        this._panel = undefined;
    }

    public async show() {
        if (this._panel) {
            this._panel.reveal();
            return;
        }

        this._panel = vscode.window.createWebviewPanel(
            EditAnalysisProvider.viewType,
            "AI Metrics",
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );
        trackWebviewPanel(this._panel, EditAnalysisProvider.viewType, "EditAnalysisProvider.show");

        this._panel.onDidDispose(() => {
            this._panel = undefined;
        });

        // Set up message handler for saving settings
        this._panel.webview.onDidReceiveMessage(async (message) => {
            if (message.command === 'saveDetailedMode') {
                try {
                    const settings = await readLocalProjectSettings();
                    settings.detailedAIMetrics = message.isDetailed;
                    await writeLocalProjectSettings(settings);
                } catch (error) {
                    console.error('Failed to save detailedAIMetrics setting:', error);
                }
            }
        });

        await this.updateContent();
    }

    private async updateContent() {
        if (!this._panel) {
            return;
        }

        // Read the saved setting
        const settings = await readLocalProjectSettings();
        const isDetailedMode = settings.detailedAIMetrics ?? true; // Default to true (detailed mode)

        const analysis = await analyzeEditHistory();

        // Create data points for the graph
        const dataPoints = analysis.rawDistances.map((d) => ({
            x: d.sequenceNumber,
            y: d.distance,
            llmText: d.llmText,
            userText: d.userText,
        }));

        // Calculate dimensions and scales
        const width = 1200;
        const height = 600;
        const padding = 60;
        const maxY = Math.max(...dataPoints.map((d) => d.y));
        const maxX = Math.max(...dataPoints.map((d) => d.x));

        // Create points for the line graph
        const points = dataPoints
            .map((d) => {
                const x =
                    dataPoints.length === 1
                        ? padding // Place the point on the y-axis if it's the only one
                        : (d.x / maxX) * (width - 2 * padding) + padding;
                const y = height - ((d.y / maxY) * (height - 2 * padding) + padding);
                return `${x},${y}`;
            })
            .join(" ");

        // Calculate trend
        let detailedTrend = "No clear trend detected - more data needed for pattern analysis";
        let simpleTrend = "Keep working! We need more data to see if the AI is improving";
        if (analysis.timeSnapshots.length >= 3) {
            const [first, second, third] = analysis.timeSnapshots;
            if (
                first.averageDistance > second.averageDistance &&
                second.averageDistance > third.averageDistance
            ) {
                detailedTrend =
                    "📉 Edit distances are decreasing - AI is successfully learning from user corrections";
                simpleTrend =
                    "📉 Excellent! The AI is learning and getting better - fewer corrections needed over time";
            } else if (
                first.averageDistance < second.averageDistance &&
                second.averageDistance < third.averageDistance
            ) {
                detailedTrend =
                    "📈 Edit distances are increasing - AI may need additional training or adjustment";
                simpleTrend =
                    "📈 The AI needs more training - keep correcting and it will improve";
            }
        }

        this._panel.webview.html = `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Edit Distance Analysis</title>
            <style>
                body {
                    padding: 20px;
                    margin: 0;
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                    font-family: system-ui;
                }
                .container {
                    max-width: 1200px;
                    margin: 0 auto;
                }
                .header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 1em;
                }
                .title {
                    font-size: 24px;
                    margin: 0;
                    color: var(--vscode-editor-foreground);
                }
                .toggle-container {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                .toggle-label {
                    font-size: 0.9em;
                    color: var(--vscode-descriptionForeground);
                }
                .toggle-switch {
                    position: relative;
                    display: inline-block;
                    width: 51px;
                    height: 31px;
                }
                .toggle-switch input {
                    opacity: 0;
                    width: 0;
                    height: 0;
                }
                .slider {
                    position: absolute;
                    cursor: pointer;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background-color: var(--vscode-input-background);
                    transition: background-color 0.3s ease;
                    border-radius: 31px;
                    border: 2px solid var(--vscode-descriptionForeground);
                }
                .slider:before {
                    position: absolute;
                    content: "";
                    height: 23px;
                    width: 23px;
                    left: 2px;
                    top: 2px;
                    background-color: var(--vscode-button-foreground);
                    transition: transform 0.3s ease;
                    border-radius: 50%;
                    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
                }
                input:checked + .slider {
                    background-color: var(--vscode-button-background);
                }
                input:checked + .slider:before {
                    transform: translateX(20px);
                }
                .stats {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 20px;
                    margin-bottom: 30px;
                    background: var(--vscode-editor-inactiveSelectionBackground);
                    padding: 20px;
                    border-radius: 8px;
                }
                .stat-card {
                    padding: 15px;
                    border-radius: 6px;
                    background: var(--vscode-editor-background);
                    position: relative;
                }
                .stat-card:hover .stat-tooltip {
                    display: block;
                }
                .stat-tooltip {
                    display: none;
                    position: absolute;
                    bottom: 100%;
                    left: 50%;
                    transform: translateX(-50%);
                    background: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-editor-foreground);
                    padding: 8px;
                    border-radius: 4px;
                    width: 250px;
                    z-index: 1000;
                    font-size: 0.9em;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
                    margin-bottom: 8px;
                }
                .stat-tooltip::after {
                    content: '';
                    position: absolute;
                    top: 100%;
                    left: 50%;
                    transform: translateX(-50%);
                    border: 8px solid transparent;
                    border-top-color: var(--vscode-editor-foreground);
                }
                .stat-label {
                    font-size: 0.9em;
                    color: var(--vscode-descriptionForeground);
                    margin-bottom: 5px;
                }
                .stat-value {
                    font-size: 1.5em;
                    font-weight: bold;
                }
                .graph-container {
                    margin-top: 30px;
                    background: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-editor-foreground);
                    border-radius: 8px;
                    padding: 20px;
                }
                .graph {
                    width: 100%;
                    height: auto;
                }
                .axis-label {
                    fill: var(--vscode-editor-foreground);
                    font-family: system-ui;
                    font-size: 12px;
                }
                .graph-line {
                    stroke: var(--vscode-charts-blue);
                    stroke-width: 2;
                    fill: none;
                }
                .graph-point {
                    fill: var(--vscode-charts-blue);
                    r: 4;
                    transition: r 0.2s, fill 0.2s;
                    cursor: pointer;
                }
                .graph-point:hover {
                    r: 6;
                    fill: var(--vscode-charts-orange);
                }
                .axis {
                    stroke: var(--vscode-editor-foreground);
                    stroke-width: 1;
                }
                .trend {
                    font-size: 1.1em;
                    margin: 20px 0;
                    padding: 15px;
                    background: var(--vscode-editor-inactiveSelectionBackground);
                    border-radius: 6px;
                }
                .tooltip {
                    position: absolute;
                    background: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-editor-foreground);
                    padding: 10px;
                    border-radius: 4px;
                    display: none;
                    pointer-events: none;
                    z-index: 1000;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1 class="title">AI Translation Quality</h1>
                    <div class="toggle-container">
                        <span class="toggle-label">Simple</span>
                        <label class="toggle-switch">
                            <input type="checkbox" id="modeToggle" ${isDetailedMode ? 'checked' : ''}>
                            <span class="slider"></span>
                        </label>
                        <span class="toggle-label">Detailed</span>
                    </div>
                </div>
                
                <div class="stats" id="statsContainer">
                </div>

                <div class="trend" id="trendContainer"></div>

                <div class="graph-container">
                    <div id="tooltip" class="tooltip"></div>
                    <svg class="graph" viewBox="0 0 ${width} ${height}">
                        <!-- Y-axis -->
                        <line class="axis" x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}"/>
                        <!-- X-axis -->
                        <line class="axis" x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}"/>
                        
                        <!-- Axis labels -->
                        <text class="axis-label" id="xAxisLabel" x="${width / 2}" y="${height - 10}" text-anchor="middle">Translation Progress</text>
                        <text class="axis-label" id="yAxisLabel" x="15" y="${height / 2}" text-anchor="middle" transform="rotate(-90, 15, ${height / 2})">Corrections Needed</text>
                        
                        <!-- Data points and line -->
                        <polyline class="graph-line" points="${points}"/>
                        ${dataPoints
                            .map((d) => {
                                const x =
                                    dataPoints.length === 1
                                        ? padding // Place the point on the y-axis if it's the only one
                                        : (d.x / maxX) * (width - 2 * padding) + padding;
                                const y =
                                    height - ((d.y / maxY) * (height - 2 * padding) + padding);
                                return `<circle class="graph-point" 
                                    cx="${x}" cy="${y}" 
                                    data-sequence="${d.x}" 
                                    data-distance="${d.y}"
                                    data-llm="${d.llmText.replace(/"/g, "&quot;")}"
                                    data-user="${d.userText.replace(/"/g, "&quot;")}"
                                />`;
                            })
                            .join("\n")}
                    </svg>
                </div>

                <details style="margin-top: 30px;" id="rawDataDetails">
                    <summary style="cursor: pointer; padding: 10px; background: var(--vscode-editor-inactiveSelectionBackground); border-radius: 6px;">
                        <h2 style="display: inline-block; margin: 0;" id="rawDataTitle">Raw Data</h2>
                    </summary>
                    <pre style="background: var(--vscode-editor-inactiveSelectionBackground); padding: 15px; border-radius: 6px; overflow: auto; margin-top: 10px; font-size: 0.9em; line-height: 1.6;" id="rawDataContent">
                    </pre>
                </details>
            </div>
            <script>
                // Data from analysis
                const analysisData = {
                    totalEdits: ${analysis.editDistances.length},
                    averageEditDistance: ${analysis.averageEditDistance.toFixed(2)},
                    meteorScore: ${analysis.meteorScore?.toFixed(2) ?? 0},
                    phases: ${JSON.stringify(analysis.timeSnapshots.map((snapshot, i) => ({
                        phase: i + 1,
                        average: snapshot.averageDistance.toFixed(2)
                    })))},
                    detailedTrend: ${JSON.stringify(detailedTrend)},
                    simpleTrend: ${JSON.stringify(simpleTrend)},
                    rawData: ${JSON.stringify(dataPoints.map(d => ({
                        sequence: d.x + 1,
                        distance: d.y,
                        llmText: d.llmText,
                        userText: d.userText
                    })))},
                    initialMode: ${isDetailedMode} // Start with saved mode
                };

                // Function to calculate quality percentage (inverse of edit distance, normalized)
                function calculateQualityPercentage(avgDistance, maxDistance = 500) {
                    // Lower distance = higher quality
                    // Normalize to 0-100 scale
                    const normalized = Math.max(0, Math.min(100, 100 - (avgDistance / maxDistance * 100)));
                    return Math.round(normalized);
                }

                // Function to get quality rating
                function getQualityRating(percentage) {
                    if (percentage >= 90) return { text: 'Excellent', emoji: '🌟' };
                    if (percentage >= 75) return { text: 'Very Good', emoji: '✨' };
                    if (percentage >= 60) return { text: 'Good', emoji: '👍' };
                    if (percentage >= 40) return { text: 'Fair', emoji: '👌' };
                    return { text: 'Needs Improvement', emoji: '📝' };
                }

                // Function to update raw data display
                function updateRawData(isDetailed) {
                    const rawDataTitle = document.getElementById('rawDataTitle');
                    const rawDataContent = document.getElementById('rawDataContent');
                    
                    if (analysisData.rawData.length === 0) {
                        rawDataTitle.textContent = 'No Data to Display';
                        rawDataContent.textContent = 'No Data to Display';
                        return;
                    }
                    
                    rawDataTitle.textContent = isDetailed ? 'Raw Edit Data' : 'Detailed Corrections';
                    
                    if (isDetailed) {
                        rawDataContent.textContent = analysisData.rawData.map(d => 
                            \`Edit #\${d.sequence}:
• Edit Distance: \${d.distance}
• LLM Output: "\${d.llmText}"
• User Edit: "\${d.userText}"
\`
                        ).join('\\n');
                    } else {
                        rawDataContent.textContent = analysisData.rawData.map(d => 
                            \`Correction #\${d.sequence}:
• Characters Changed: \${d.distance}
• AI Suggestion: "\${d.llmText}"
• Final Version: "\${d.userText}"
\`
                        ).join('\\n');
                    }
                }

                // Function to render stats based on mode
                function renderStats(isDetailed) {
                    const container = document.getElementById('statsContainer');
                    const trendContainer = document.getElementById('trendContainer');
                    const xAxisLabel = document.getElementById('xAxisLabel');
                    const yAxisLabel = document.getElementById('yAxisLabel');
                    
                    // Update trend message
                    trendContainer.textContent = isDetailed ? analysisData.detailedTrend : analysisData.simpleTrend;
                    
                    // Update axis labels
                    if (isDetailed) {
                        xAxisLabel.textContent = 'LLM Generation Sequence';
                        yAxisLabel.textContent = 'Edit Distance';
                    } else {
                        xAxisLabel.textContent = 'Translation Progress';
                        yAxisLabel.textContent = 'Corrections Needed';
                    }
                    
                    // Update raw data
                    updateRawData(isDetailed);
                    
                    if (isDetailed) {
                        // Detailed mode
                        container.innerHTML = \`
                            <div class="stat-card">
                                <div class="stat-label">Total Edits</div>
                                <div class="stat-value">\${analysisData.totalEdits}</div>
                                <div class="stat-tooltip">Total number of edits made to AI-generated text, indicating the volume of corrections needed.</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-label">Average Edit Distance</div>
                                <div class="stat-value">\${analysisData.averageEditDistance}</div>
                                <div class="stat-tooltip">Average number of character-level changes needed to transform AI output into user-desired text. Lower values indicate better performance.</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-label">METEOR Score</div>
                                <div class="stat-value">\${analysisData.meteorScore}</div>
                                <div class="stat-tooltip">METEOR (Metric for Evaluation of Translation with Explicit Ordering) score ranges from 0 to 1. Higher scores indicate better alignment between AI output and user edits.</div>
                            </div>
                            \${analysisData.phases.map(phase => {
                                let phaseDescription = '';
                                if (phase.phase === 1) {
                                    phaseDescription = 'Beginning of the translation - First 33% of edits. Shows initial AI performance.';
                                } else if (phase.phase === 2) {
                                    phaseDescription = 'Middle of the translation - Middle 33% of edits. Shows AI adaptation.';
                                } else {
                                    phaseDescription = 'End of the translation - Final 33% of edits. Shows latest AI performance.';
                                }
                                return \`
                                    <div class="stat-card">
                                        <div class="stat-label">Phase \${phase.phase} Average</div>
                                        <div class="stat-value">\${phase.average}</div>
                                        <div class="stat-tooltip">\${phaseDescription}</div>
                                    </div>
                                \`;
                            }).join('')}
                        \`;
                    } else {
                        // Simple mode
                        const qualityPercent = calculateQualityPercentage(analysisData.averageEditDistance);
                        const rating = getQualityRating(qualityPercent);
                        const accuracyPercent = Math.round(analysisData.meteorScore * 100);
                        
                        container.innerHTML = \`
                            <div class="stat-card">
                                <div class="stat-label">Corrections Made</div>
                                <div class="stat-value">\${analysisData.totalEdits}</div>
                                <div class="stat-tooltip">How many times the AI\\'s suggestions needed to be corrected by reviewers.</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-label">AI Quality Score</div>
                                <div class="stat-value">\${rating.emoji} \${rating.text}</div>
                                <div class="stat-tooltip">Overall quality of AI translations. Higher ratings mean less editing needed.</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-label">Accuracy Rate</div>
                                <div class="stat-value">\${accuracyPercent}%</div>
                                <div class="stat-tooltip">How closely the AI\\'s suggestions match the final approved text. Higher is better.</div>
                            </div>
                            \${analysisData.phases.map(phase => {
                                const phaseQuality = calculateQualityPercentage(parseFloat(phase.average));
                                let stageDescription = '';
                                if (phase.phase === 1) {
                                    stageDescription = 'Beginning of the translation - How well the AI performed at the start of your project.';
                                } else if (phase.phase === 2) {
                                    stageDescription = 'Middle of the translation - How the AI improved as the work progressed.';
                                } else {
                                    stageDescription = 'End of the translation - The AI\\'s most recent performance in your project.';
                                }
                                return \`
                                    <div class="stat-card">
                                        <div class="stat-label">Stage \${phase.phase} Quality</div>
                                        <div class="stat-value">\${phaseQuality}%</div>
                                        <div class="stat-tooltip">\${stageDescription}</div>
                                    </div>
                                \`;
                            }).join('')}
                        \`;
                    }
                }

                // Initialize with saved mode
                renderStats(analysisData.initialMode);

                // Track current mode
                let currentMode = analysisData.initialMode; // false = simple, true = detailed

                // VS Code API for posting messages
                const vscode = acquireVsCodeApi();

                // Toggle handler
                const toggle = document.getElementById('modeToggle');
                toggle.addEventListener('change', (e) => {
                    currentMode = e.target.checked;
                    renderStats(currentMode);
                    // Save the setting
                    vscode.postMessage({
                        command: 'saveDetailedMode',
                        isDetailed: currentMode
                    });
                });

                // Tooltip functionality for graph points
                const tooltip = document.getElementById('tooltip');
                const points = document.querySelectorAll('.graph-point');
                
                points.forEach(point => {
                    point.addEventListener('mouseover', (e) => {
                        const seq = e.target.dataset.sequence;
                        const dist = e.target.dataset.distance;
                        const llm = e.target.dataset.llm;
                        const user = e.target.dataset.user;
                        
                        if (currentMode) {
                            // Detailed mode
                            tooltip.innerHTML = \`
                                <strong>Edit #\${Number(seq) + 1}</strong><br>
                                Edit Distance: \${dist}<br>
                                LLM Output: \${llm}<br>
                                User Edit: \${user}
                            \`;
                        } else {
                            // Simple mode
                            tooltip.innerHTML = \`
                                <strong>Correction #\${Number(seq) + 1}</strong><br>
                                Characters Changed: \${dist}<br>
                                AI Suggestion: \${llm}<br>
                                Final Version: \${user}
                            \`;
                        }
                        tooltip.style.display = 'block';
                        tooltip.style.left = (e.pageX + 10) + 'px';
                        tooltip.style.top = (e.pageY + 10) + 'px';
                    });
                    
                    point.addEventListener('mouseout', () => {
                        tooltip.style.display = 'none';
                    });
                    
                    point.addEventListener('mousemove', (e) => {
                        tooltip.style.left = (e.pageX + 10) + 'px';
                        tooltip.style.top = (e.pageY + 10) + 'px';
                    });
                });
            </script>
        </body>
        </html>`;
    }
}

export function createEditAnalysisProvider(extensionUri: vscode.Uri): EditAnalysisProvider {
    return new EditAnalysisProvider(extensionUri);
}
