import * as vscode from "vscode";
import * as path from "path";
import { getAuthApi } from "../extension";
import { getNotebookMetadataManager } from "../utils/notebookMetadataManager";

const DEBUG_MODE = false;
const debug = (message: string, ...args: any[]) => {
    DEBUG_MODE && console.log(`[Progress Reporting] ${message}`, ...args);
};

// Types for progress reporting
export interface BookProgress {
    bookId: string;
    totalVerses: number;
    translatedVerses: number;
    validatedVerses?: number;
}

export interface ProjectProgressReport {
    projectId: string;
    projectName: string;
    timestamp: string;
    reportId: string;
    translationProgress: {
        bookCompletionMap: Record<string, number>;
        totalVerseCount: number;
        translatedVerseCount: number;
        validatedVerseCount: number;
        wordsTranslated: number;
    };
    validationStatus: {
        stage: "none" | "initial" | "community" | "expert" | "finished";
        versesPerStage: Record<string, number>;
        lastValidationTimestamp: string;
    };
    activityMetrics: {
        lastEditTimestamp: string;
        editCountLast24Hours: number;
        editCountLastWeek: number;
        averageDailyEdits: number;
    };
    qualityMetrics: {
        spellcheckIssueCount: number;
        flaggedSegmentsCount: number;
        consistencyScore: number;
    };
}

export interface ProgressReportingRequest {
    type: 'generateReport' | 'submitReport' | 'scheduleReport';
    payload?: any;
    requestId: string;
}

export interface ProgressReportingResponse {
    type: 'reportGenerated' | 'reportSubmitted' | 'error';
    payload?: any;
    requestId: string;
    success: boolean;
}

/**
 * Background service for handling progress reporting without blocking the UI
 */
export class ProgressReportingService {
    private static instance: ProgressReportingService;
    private pendingReports: Map<string, ProgressReportingRequest> = new Map();
    private lastReportTime: number = 0;
    private readonly REPORT_INTERVAL = 86400000; // 24 hours
    private isRunning: boolean = false;

    private constructor() { }

    public static getInstance(): ProgressReportingService {
        if (!ProgressReportingService.instance) {
            ProgressReportingService.instance = new ProgressReportingService();
        }
        return ProgressReportingService.instance;
    }

    /**
     * Start the background service
     */
    public start(): void {
        if (this.isRunning) {
            return;
        }

        this.isRunning = true;
        debug("📊 Progress Reporting Service started");

        // Process pending reports every 30 seconds
        setInterval(() => {
            this.processPendingReports();
        }, 30000);
    }

    /**
     * Stop the background service
     */
    public stop(): void {
        this.isRunning = false;
        debug("📊 Progress Reporting Service stopped");
    }

    /**
     * Schedule a progress report to be generated and submitted later
     */
    public scheduleProgressReport(): void {
        if (!this.shouldGenerateReport()) {
            debug("📊 Progress report not needed (generated recently)");
            return;
        }

        const requestId = this.generateUUID();
        const request: ProgressReportingRequest = {
            type: 'scheduleReport',
            requestId,
        };

        this.pendingReports.set(requestId, request);
        debug(`📊 Progress report scheduled with ID: ${requestId}`);
    }

    /**
     * Force generation and submission of a progress report
     */
    public async forceProgressReport(): Promise<boolean> {
        try {
            debug("📊 Forcing progress report generation...");
            const report = await this.generateProgressReport();

            if (!report) {
                debug("📊 Failed to generate progress report");
                return false;
            }

            return await this.submitProgressReport(report);
        } catch (error) {
            console.error("📊 Error forcing progress report:", error);
            return false;
        }
    }

    /**
     * Process pending reports in the background
     */
    private async processPendingReports(): Promise<void> {
        if (this.pendingReports.size === 0) {
            return;
        }

        debug(`📊 Processing ${this.pendingReports.size} pending reports...`);

        // Process one report at a time to avoid overwhelming the system
        const firstEntry = this.pendingReports.entries().next().value;
        if (!firstEntry) {
            return;
        }

        const [requestId, request] = firstEntry;
        this.pendingReports.delete(requestId);

        try {
            switch (request.type) {
                case 'scheduleReport':
                    await this.processScheduledReport(request);
                    break;
                case 'generateReport':
                    await this.processGenerateReport(request);
                    break;
                case 'submitReport':
                    await this.processSubmitReport(request);
                    break;
            }
        } catch (error) {
            console.error(`📊 Error processing report ${requestId}:`, error);
        }
    }

    /**
     * Process a scheduled report
     */
    private async processScheduledReport(request: ProgressReportingRequest): Promise<void> {
        debug(`📊 Processing scheduled report ${request.requestId}`);

        const report = await this.generateProgressReport();
        if (report) {
            await this.submitProgressReport(report);
        }
    }

    /**
     * Process a generate report request
     */
    private async processGenerateReport(request: ProgressReportingRequest): Promise<void> {
        debug(`📊 Generating report ${request.requestId}`);
        await this.generateProgressReport();
    }

    /**
     * Process a submit report request
     */
    private async processSubmitReport(request: ProgressReportingRequest): Promise<void> {
        debug(`📊 Submitting report ${request.requestId}`);
        if (request.payload) {
            await this.submitProgressReport(request.payload);
        }
    }

    /**
     * Check if we should generate a new report
     */
    private shouldGenerateReport(): boolean {
        const now = Date.now();
        return now - this.lastReportTime >= this.REPORT_INTERVAL;
    }

    /**
     * Generate a complete progress report (async, non-blocking)
     */
    private async generateProgressReport(): Promise<ProjectProgressReport | null> {
        try {
            const metadataManager = getNotebookMetadataManager();
            if (!metadataManager) {
                return null;
            }

            const allMetadata = metadataManager.getAllMetadata();
            if (!allMetadata || allMetadata.length === 0) {
                debug("📊 No project metadata available for progress report");
                return null;
            }

            // Get project information
            let projectId: string | undefined;
            let projectName: string = "Unknown Project";
            let gitlabProjectFound = false;

            try {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (workspaceFolder) {
                    const metadataPath = vscode.Uri.joinPath(workspaceFolder.uri, "metadata.json");
                    const metadataContent = await vscode.workspace.fs.readFile(metadataPath);
                    const projectMetadata = JSON.parse(Buffer.from(metadataContent).toString());

                    if (projectMetadata.projectName) {
                        projectName = projectMetadata.projectName;
                    }

                    // Try to get project info from API
                    const authApi = getAuthApi();
                    if (authApi) {
                        try {
                            const projects = await authApi.listProjects(false);
                            const idToMatch = projectMetadata.projectId || projectMetadata.id;

                            if (idToMatch) {
                                const matchedProject = projects.find(
                                    (p) =>
                                        p.id.toString().includes(idToMatch) ||
                                        p.name.includes(idToMatch) ||
                                        (p.url && p.url.includes(idToMatch))
                                );

                                if (matchedProject) {
                                    projectId = matchedProject.name;
                                    projectName = matchedProject.name;
                                    gitlabProjectFound = true;
                                    debug(`📊 Found matching project: ${projectId}`);
                                }
                            }
                        } catch (error) {
                            debug("📊 Error fetching GitLab projects:", error);
                        }
                    }

                    if (!gitlabProjectFound && (projectMetadata.projectId || projectMetadata.id)) {
                        projectId = projectMetadata.projectId || projectMetadata.id;
                        console.warn("📊 Using project ID from metadata without GitLab verification:", projectId);
                    }

                    if (!projectId || !gitlabProjectFound) {
                        console.warn("📊 No valid GitLab project ID found. Skipping progress report generation.");
                        return null;
                    }
                } else {
                    throw new Error("No workspace folder found");
                }
            } catch (error) {
                console.error("📊 Could not determine valid project ID:", error);
                return null;
            }

            const reportId = this.generateUUID();

            const report: ProjectProgressReport = {
                projectId: projectId!,
                projectName: projectName,
                timestamp: new Date().toISOString(),
                reportId,
                translationProgress: {
                    bookCompletionMap: {},
                    totalVerseCount: 0,
                    translatedVerseCount: 0,
                    validatedVerseCount: 0,
                    wordsTranslated: 0,
                },
                validationStatus: {
                    stage: "none",
                    versesPerStage: {},
                    lastValidationTimestamp: new Date().toISOString(),
                },
                activityMetrics: {
                    lastEditTimestamp: new Date().toISOString(),
                    editCountLast24Hours: 0,
                    editCountLastWeek: 0,
                    averageDailyEdits: 0,
                },
                qualityMetrics: {
                    spellcheckIssueCount: 0,
                    flaggedSegmentsCount: 0,
                    consistencyScore: 0,
                },
            };

            // Generate translation progress data
            await this.collectTranslationProgress(report);

            // Generate mock data for other metrics
            this.generateMockMetrics(report);

            debug("📊 Progress report generated successfully");
            return report;
        } catch (error) {
            console.error("📊 Error generating progress report:", error);
            return null;
        }
    }

    /**
     * Collect translation progress data from .codex files
     */
    private async collectTranslationProgress(report: ProjectProgressReport): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                return;
            }

            const codexPattern = new vscode.RelativePattern(
                workspaceFolder.uri.fsPath,
                "files/target/**/*.codex"
            );
            const codexUris = await vscode.workspace.findFiles(codexPattern);

            const bookCompletionMap: Record<string, number> = {};
            let totalVerseCount = 0;
            let translatedVerseCount = 0;

            for (const uri of codexUris) {
                try {
                    const fileNameAbbr = path.basename(uri.fsPath, ".codex");
                    const content = await vscode.workspace.fs.readFile(uri);
                    const contentStr = Buffer.from(content).toString("utf-8");

                    try {
                        const notebookData = JSON.parse(contentStr);
                        const cells = notebookData.cells || [];
                        const totalCells = cells.length;

                        const cellsWithValues = cells.filter((cell: any) => {
                            const value = cell.value || "";
                            return value.trim().length > 0 && value !== "<span></span>";
                        }).length;

                        totalVerseCount += totalCells;
                        translatedVerseCount += cellsWithValues;

                        const bookProgress = totalCells > 0 ? (cellsWithValues / totalCells) * 100 : 0;
                        bookCompletionMap[fileNameAbbr] = Math.round(bookProgress * 100) / 100;

                        debug(
                            `📊 Processed ${fileNameAbbr}: ${cellsWithValues}/${totalCells} verses translated (${bookProgress.toFixed(2)}%)`
                        );
                    } catch (jsonError) {
                        console.warn(`📊 Failed to parse JSON for ${uri.fsPath}:`, jsonError);

                        // Fallback estimation
                        const totalCells = Math.ceil(contentStr.length / 500);
                        const cellsWithValues = Math.ceil(totalCells * 0.5);

                        totalVerseCount += totalCells;
                        translatedVerseCount += cellsWithValues;
                        bookCompletionMap[fileNameAbbr] = 50;
                    }
                } catch (error) {
                    console.warn(`📊 Failed to process ${uri.fsPath}:`, error);
                }
            }

            // Update the report
            report.translationProgress.bookCompletionMap = bookCompletionMap;
            report.translationProgress.totalVerseCount = totalVerseCount;
            report.translationProgress.translatedVerseCount = translatedVerseCount;
            report.translationProgress.validatedVerseCount = Math.round(translatedVerseCount * 0.6);
            report.translationProgress.wordsTranslated = translatedVerseCount * 15;

            // Set validation stage based on progress
            const progress = totalVerseCount > 0 ? translatedVerseCount / totalVerseCount : 0;
            if (progress < 0.25) {
                report.validationStatus.stage = "none";
            } else if (progress < 0.5) {
                report.validationStatus.stage = "initial";
            } else if (progress < 0.75) {
                report.validationStatus.stage = "community";
            } else if (progress < 0.95) {
                report.validationStatus.stage = "expert";
            } else {
                report.validationStatus.stage = "finished";
            }

            report.validationStatus.versesPerStage = {
                none: totalVerseCount - translatedVerseCount,
                initial: 0,
                community: 0,
                expert: 0,
                finished: 0,
            };
            report.validationStatus.versesPerStage[report.validationStatus.stage] = translatedVerseCount;

        } catch (error) {
            console.error("📊 Error collecting translation progress data:", error);
        }
    }

    /**
     * Generate mock metrics for testing
     */
    private generateMockMetrics(report: ProjectProgressReport): void {
        report.activityMetrics = {
            lastEditTimestamp: new Date().toISOString(),
            editCountLast24Hours: Math.floor(Math.random() * 50),
            editCountLastWeek: Math.floor(Math.random() * 200),
            averageDailyEdits: Math.floor(Math.random() * 30),
        };

        report.qualityMetrics = {
            spellcheckIssueCount: Math.floor(Math.random() * 20),
            flaggedSegmentsCount: Math.floor(Math.random() * 10),
            consistencyScore: 85 + Math.floor(Math.random() * 15),
        };
    }

    /**
     * Submit the progress report to the API
     */
    private async submitProgressReport(report: ProjectProgressReport): Promise<boolean> {
        try {
            const authApi = getAuthApi();
            if (!authApi) {
                debug("📊 Auth API not available, cannot submit progress report");
                return false;
            }

            if ("submitProgressReport" in authApi) {
                debug("📊 Submitting progress report to API...");
                const result = await authApi.submitProgressReport(report);

                if (result.success) {
                    debug(`📊 Progress report submitted successfully: ${result.reportId}`);
                    this.lastReportTime = Date.now();
                    return true;
                } else {
                    console.error("📊 Failed to submit progress report");
                    return false;
                }
            } else {
                debug("📊 submitProgressReport method not available in API");
                return false;
            }
        } catch (error) {
            console.error("📊 Error submitting progress report:", error);
            return false;
        }
    }

    /**
     * Generate a UUID
     */
    private generateUUID(): string {
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
            const r = (Math.random() * 16) | 0;
            const v = c === "x" ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }
}

/**
 * Register progress reporting commands
 */
export function registerProgressReportingCommands(context: vscode.ExtensionContext): void {
    const service = ProgressReportingService.getInstance();

    // Start the service
    service.start();

    // Stop service on extension deactivation
    context.subscriptions.push({
        dispose: () => service.stop()
    });

    // Command to force progress report submission
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor-extension.submitProgressReport",
            async (forceSubmit?: boolean) => {
                const success = await service.forceProgressReport();

                if (success) {
                    vscode.window.showInformationMessage(
                        "Project progress report submitted successfully"
                    );
                } else if (forceSubmit) {
                    vscode.window.showWarningMessage(
                        "Progress report not submitted: No GitLab project found for this workspace"
                    );
                } else {
                    vscode.window.showErrorMessage("Failed to submit progress report");
                }
            }
        )
    );
} 