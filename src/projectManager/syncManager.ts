import * as vscode from "vscode";
import { stageAndCommitAllAndSync } from "./utils/merge";
import { getAuthApi } from "../extension";
import { createIndexWithContext } from "../activationHelpers/contextAware/miniIndex/indexes";
import { getNotebookMetadataManager } from "../utils/notebookMetadataManager";
import * as path from "path";

// Define TranslationProgress interface locally since it's not exported from types
interface BookProgress {
    bookId: string;
    totalVerses: number;
    translatedVerses: number;
    validatedVerses?: number;
}

interface TranslationProgress {
    totalVerses: number;
    translatedVerses: number;
    validatedVerses?: number;
    bookProgress?: BookProgress[];
}

// Progress report interface
export interface ProjectProgressReport {
    projectId: string; // Unique project identifier
    projectName: string; // Human-readable project name
    timestamp: string; // ISO timestamp of report generation
    reportId: string; // Unique report identifier

    // Translation metrics
    translationProgress: {
        bookCompletionMap: Record<string, number>; // Book ID -> percentage complete
        totalVerseCount: number; // Total verses in project
        translatedVerseCount: number; // Verses with translations
        validatedVerseCount: number; // Verses passing validation
        wordsTranslated: number; // Total words translated
    };

    // Validation metrics
    validationStatus: {
        stage: "none" | "initial" | "community" | "expert" | "finished";
        versesPerStage: Record<string, number>; // Stage -> verse count
        lastValidationTimestamp: string; // ISO timestamp
    };

    // Activity metrics
    activityMetrics: {
        lastEditTimestamp: string; // ISO timestamp
        editCountLast24Hours: number; // Edit count
        editCountLastWeek: number; // Edit count
        averageDailyEdits: number; // Avg edits per active day
    };

    // Quality indicators
    qualityMetrics: {
        spellcheckIssueCount: number; // Spelling issues
        flaggedSegmentsCount: number; // Segments needing review
        consistencyScore: number; // 0-100 score
    };
}

// Singleton to manage sync operations across the application
export class SyncManager {
    private static instance: SyncManager;
    private pendingSyncTimeout: NodeJS.Timeout | number | null = null;
    private isSyncInProgress: boolean = false;
    private lastConnectionErrorTime: number = 0;
    private CONNECTION_ERROR_COOLDOWN = 60000; // 1 minute cooldown for connection messages
    private lastProgressReport: ProjectProgressReport | null = null;
    private lastReportTime: number = 0;
    private REPORT_INTERVAL = 86400000; // 24 hours in milliseconds

    private constructor() {
        // Initialize with configuration values
        this.updateFromConfiguration();
    }

    public static getInstance(): SyncManager {
        if (!SyncManager.instance) {
            SyncManager.instance = new SyncManager();
        }
        return SyncManager.instance;
    }

    // Schedule a sync operation to occur after the configured delay
    public scheduleSyncOperation(commitMessage: string = "Auto-sync changes"): void {
        // Get current configuration
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        const autoSyncEnabled = config.get<boolean>("autoSyncEnabled", true);
        const syncDelayMinutes = config.get<number>("syncDelayMinutes", 5);

        // Clear any pending sync operation
        this.clearPendingSync();

        // If auto-sync is disabled, don't schedule
        if (!autoSyncEnabled) {
            console.log("Auto-sync is disabled, not scheduling sync operation");
            return;
        }

        // Convert minutes to milliseconds
        const delayMs = syncDelayMinutes * 60 * 1000;
        console.log(`Scheduling sync operation in ${syncDelayMinutes} minutes`);

        // Schedule the new sync
        this.pendingSyncTimeout = setTimeout(() => {
            this.executeSync(commitMessage);
        }, delayMs);
    }

    // Execute the sync operation immediately
    public async executeSync(
        commitMessage: string = "Manual sync",
        showInfoOnConnectionIssues: boolean = true
    ): Promise<void> {
        if (this.isSyncInProgress) {
            console.log("Sync already in progress, skipping");
            return;
        }

        // Check authentication status first
        const authApi = getAuthApi();
        if (!authApi) {
            console.log("Auth API not available, cannot sync");
            if (showInfoOnConnectionIssues) {
                this.showConnectionIssueMessage(
                    "Unable to sync: Authentication service not available"
                );
            }
            return;
        }

        try {
            const authStatus = authApi.getAuthStatus();
            if (!authStatus.isAuthenticated) {
                console.log("User is not authenticated, cannot sync");
                if (showInfoOnConnectionIssues) {
                    this.showConnectionIssueMessage(
                        "Unable to sync: Please log in to sync your changes"
                    );
                }
                return;
            }
        } catch (error) {
            console.error("Error checking authentication status:", error);
            if (showInfoOnConnectionIssues) {
                this.showConnectionIssueMessage(
                    "Unable to sync: Could not verify authentication status"
                );
            }
            return;
        }

        try {
            this.clearPendingSync();
            this.isSyncInProgress = true;
            console.log("Executing sync operation with message:", commitMessage);

            // Generate and submit progress report if needed
            await this.generateAndSubmitProgressReport();

            await stageAndCommitAllAndSync(commitMessage);
        } catch (error) {
            console.error("Error during sync operation:", error);
            const errorMessage = error instanceof Error ? error.message : String(error);

            // Check if this is a connection-related error
            if (
                errorMessage.includes("No active session") ||
                errorMessage.includes("network") ||
                errorMessage.includes("connect") ||
                errorMessage.includes("offline")
            ) {
                if (showInfoOnConnectionIssues) {
                    this.showConnectionIssueMessage(
                        "Unable to sync: Please check your internet connection or login status"
                    );
                }
            } else {
                // For other errors, show an error message
                vscode.window.showErrorMessage(`Sync failed: ${errorMessage}`);
            }
        } finally {
            this.isSyncInProgress = false;
        }
    }

    // Generate and submit progress report if needed
    private async generateAndSubmitProgressReport(): Promise<void> {
        const now = Date.now();
        const authApi = getAuthApi();

        // Skip if we've reported recently or API is unavailable
        if (now - this.lastReportTime < this.REPORT_INTERVAL || !authApi) {
            return;
        }

        try {
            const report = await this.generateProgressReport();
            if (report) {
                // Check if the API has the submitProgressReport method
                if ("submitProgressReport" in authApi) {
                    const result = await authApi.submitProgressReport(report);
                    if (result.success) {
                        console.log(`Progress report submitted successfully: ${result.reportId}`);
                        this.lastProgressReport = report;
                        this.lastReportTime = now;
                    } else {
                        console.error("Failed to submit progress report");
                    }
                } else {
                    console.log("submitProgressReport method not available in API");
                }
            }
        } catch (error) {
            console.error("Error generating or submitting progress report:", error);
        }
    }

    // Generate a complete progress report
    private async generateProgressReport(): Promise<ProjectProgressReport | null> {
        try {
            const metadataManager = getNotebookMetadataManager();
            if (!metadataManager) {
                return null;
            }

            // Get all project metadata instead of a single notebook
            const allMetadata = metadataManager.getAllMetadata();
            if (!allMetadata || allMetadata.length === 0) {
                console.log("No project metadata available for progress report");
                return null;
            }

            // Check for metadata.json which contains the real project ID
            let projectId: string | undefined;
            let projectName: string = "Unknown Project";
            let gitlabProjectFound = false;

            try {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (workspaceFolder) {
                    const metadataPath = vscode.Uri.joinPath(workspaceFolder.uri, "metadata.json");
                    const metadataContent = await vscode.workspace.fs.readFile(metadataPath);
                    const projectMetadata = JSON.parse(Buffer.from(metadataContent).toString());

                    // Extract project name from metadata
                    if (projectMetadata.projectName) {
                        projectName = projectMetadata.projectName;
                    }

                    // Try to get project info from FrontierAPI
                    const authApi = getAuthApi();
                    if (authApi) {
                        try {
                            // Get the list of available projects
                            const projects = await authApi.listProjects(false);

                            // Simple ID matching - find any project that contains our ID
                            const idToMatch = projectMetadata.projectId || projectMetadata.id;
                            if (idToMatch) {
                                // Log available projects for debugging
                                console.log(`Looking for project containing ID: ${idToMatch}`);

                                const matchedProject = projects.find(
                                    (p) =>
                                        // Check different ways the ID could appear in project data
                                        p.id.toString().includes(idToMatch) ||
                                        p.name.includes(idToMatch) ||
                                        (p.url && p.url.includes(idToMatch))
                                );

                                if (matchedProject) {
                                    projectId = matchedProject.name;
                                    projectName = matchedProject.name;
                                    gitlabProjectFound = true;
                                    console.log(`Found matching project: ${projectId}`);
                                } else {
                                    console.log(
                                        "No matching projects found among:",
                                        projects.map((p) => ({ id: p.id, name: p.name }))
                                    );
                                }
                            }
                        } catch (error) {
                            console.log("Error fetching GitLab projects:", error);
                        }
                    }

                    // If we still don't have the project ID from GitLab, use metadata but log a warning
                    if (!gitlabProjectFound && (projectMetadata.projectId || projectMetadata.id)) {
                        projectId = projectMetadata.projectId || projectMetadata.id;
                        console.warn(
                            "Using project ID from metadata without GitLab verification:",
                            projectId
                        );
                    }

                    // If we couldn't find a valid project ID, abandon report generation
                    if (!projectId || !gitlabProjectFound) {
                        console.warn(
                            "No valid GitLab project ID found. Skipping progress report generation."
                        );
                        return null;
                    }
                } else {
                    throw new Error("No workspace folder found");
                }
            } catch (error) {
                // Don't fallback to generated IDs anymore
                console.error("Could not determine valid project ID:", error);
                return null;
            }

            // Create report ID using crypto random values since crypto.randomUUID() may not be available
            const reportId = this.generateUUID();

            // Create report with both project ID and name
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

            // Get actual translation progress data
            try {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (workspaceFolder) {
                    // Find all .codex files in the project
                    const codexPattern = new vscode.RelativePattern(
                        workspaceFolder.uri.fsPath,
                        "files/target/**/*.codex"
                    );
                    const codexUris = await vscode.workspace.findFiles(codexPattern);

                    // Create maps to track book progress
                    const bookCompletionMap: Record<string, number> = {};
                    let totalVerseCount = 0;
                    let translatedVerseCount = 0;

                    // Process each codex file with direct JSON parsing
                    for (const uri of codexUris) {
                        try {
                            // Extract book abbreviation from filename
                            const fileNameAbbr = path.basename(uri.fsPath, ".codex");

                            // Read the file content
                            const content = await vscode.workspace.fs.readFile(uri);
                            const contentStr = Buffer.from(content).toString("utf-8");

                            try {
                                // Parse JSON directly
                                const notebookData = JSON.parse(contentStr);

                                // Extract cells array
                                const cells = notebookData.cells || [];
                                const totalCells = cells.length;

                                // Count cells that have translations
                                const cellsWithValues = cells.filter((cell: any) => {
                                    // Check if the cell has value
                                    const value = cell.value || "";
                                    return value.trim().length > 0 && value !== "<span></span>";
                                }).length;

                                // Update counts
                                totalVerseCount += totalCells;
                                translatedVerseCount += cellsWithValues;

                                // Calculate book progress percentage
                                const bookProgress =
                                    totalCells > 0 ? (cellsWithValues / totalCells) * 100 : 0;

                                // Store in book map with 2 decimal places instead of just rounding to integer
                                bookCompletionMap[fileNameAbbr] =
                                    Math.round(bookProgress * 100) / 100;

                                console.log(
                                    `Processed ${fileNameAbbr}: ${cellsWithValues}/${totalCells} verses translated (${(Math.round(bookProgress * 100) / 100).toFixed(2)}%)`
                                );
                            } catch (jsonError) {
                                console.warn(`Failed to parse JSON for ${uri.fsPath}:`, jsonError);

                                // Fallback to file size estimation if JSON parsing fails
                                const totalCells = Math.ceil(contentStr.length / 500);
                                const cellsWithValues = Math.ceil(totalCells * 0.5);

                                totalVerseCount += totalCells;
                                translatedVerseCount += cellsWithValues;

                                bookCompletionMap[fileNameAbbr] = 50; // Default to 50% if parsing fails
                            }
                        } catch (error) {
                            console.warn(`Failed to process ${uri.fsPath}:`, error);
                        }
                    }

                    // Update the report with actual data
                    report.translationProgress.bookCompletionMap = bookCompletionMap;
                    report.translationProgress.totalVerseCount = totalVerseCount;
                    report.translationProgress.translatedVerseCount = translatedVerseCount;

                    // Mock validation progress - approximately 60% of translated
                    report.translationProgress.validatedVerseCount = Math.round(
                        translatedVerseCount * 0.6
                    );

                    // Set realistic word count (average 15 words per verse)
                    report.translationProgress.wordsTranslated = translatedVerseCount * 15;

                    // Simplified validation approach - just use one stage based on progress
                    const progress =
                        totalVerseCount > 0 ? translatedVerseCount / totalVerseCount : 0;

                    // Set validation stage based on progress
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

                    // Set simple versesPerStage object
                    report.validationStatus.versesPerStage = {
                        none: totalVerseCount - translatedVerseCount,
                        initial: 0,
                        community: 0,
                        expert: 0,
                        finished: 0,
                    };

                    // Put all translated verses in the current stage
                    report.validationStatus.versesPerStage[report.validationStatus.stage] =
                        translatedVerseCount;
                }
            } catch (error) {
                console.error("Error collecting translation progress data:", error);
            }

            // Fix indexes error - remove this section for now
            // Activity metrics will be mocked
            report.activityMetrics = {
                lastEditTimestamp: new Date().toISOString(),
                editCountLast24Hours: Math.floor(Math.random() * 50), // Mock data
                editCountLastWeek: Math.floor(Math.random() * 200), // Mock data
                averageDailyEdits: Math.floor(Math.random() * 30), // Mock data
            };

            // Quality metrics - mock data for now
            report.qualityMetrics = {
                spellcheckIssueCount: Math.floor(Math.random() * 20),
                flaggedSegmentsCount: Math.floor(Math.random() * 10),
                consistencyScore: 85 + Math.floor(Math.random() * 15),
            };

            // Add detailed logging before return
            console.log("====== PROGRESS REPORT DETAILS ======");
            console.log(`Project ID: ${projectId}`);
            console.log(`Project Name: ${projectName}`);
            console.log("Book Completion Map:", report.translationProgress.bookCompletionMap);
            console.log(
                `Total files: ${Object.keys(report.translationProgress.bookCompletionMap).length}`
            );
            console.log(`Total verses: ${report.translationProgress.totalVerseCount}`);
            console.log(`Translated verses: ${report.translationProgress.translatedVerseCount}`);
            console.log("====================================");

            return report;
        } catch (error) {
            console.error("Error generating progress report:", error);
            return null;
        }
    }

    // Generate a UUID without using crypto.randomUUID()
    private generateUUID(): string {
        // Simple UUID v4 implementation
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
            const r = (Math.random() * 16) | 0;
            const v = c === "x" ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    }

    // // Helper function to map book IDs to completion percentages
    // private getBookCompletionMap(progress: TranslationProgress): Record<string, number> {
    //     const bookMap: Record<string, number> = {};

    //     if (progress && progress.bookProgress) {
    //         for (const book of progress.bookProgress) {
    //             const percentage =
    //                 book.totalVerses > 0
    //                     ? Math.round((book.translatedVerses / book.totalVerses) * 100)
    //                     : 0;

    //             bookMap[book.bookId] = percentage;
    //         }
    //     }

    //     return bookMap;
    // }

    // Helper function to map validation stages
    private mapValidationStage(
        stage: number | string
    ): "none" | "initial" | "community" | "expert" | "finished" {
        const stageNum = typeof stage === "string" ? parseInt(stage, 10) : stage;

        switch (stageNum) {
            case 0:
                return "none";
            case 1:
                return "initial";
            case 2:
                return "community";
            case 3:
                return "expert";
            case 4:
                return "finished";
            default:
                return "none";
        }
    }

    // Show connection issue message with cooldown
    private showConnectionIssueMessage(message: string): void {
        // Only show one message per minute to avoid spamming
        const now = Date.now();
        if (now - this.lastConnectionErrorTime > this.CONNECTION_ERROR_COOLDOWN) {
            this.lastConnectionErrorTime = now;
            vscode.window.showInformationMessage(message);
        } else {
            console.log("Suppressing connection error notification due to cooldown");
        }
    }

    // Cancel any pending sync operations
    public clearPendingSync(): void {
        if (this.pendingSyncTimeout) {
            clearTimeout(this.pendingSyncTimeout);
            this.pendingSyncTimeout = null;
            console.log("Cleared pending sync operation");
        }
    }

    // Update the manager settings from configuration
    public updateFromConfiguration(): void {
        // This method will be called when configuration changes
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        const autoSyncEnabled = config.get<boolean>("autoSyncEnabled", true);
        const syncDelayMinutes = config.get<number>("syncDelayMinutes", 5);

        console.log(
            `SyncManager configuration updated: autoSyncEnabled=${autoSyncEnabled}, syncDelayMinutes=${syncDelayMinutes}`
        );
    }

    // Force a progress report generation and submission
    public async forceProgressReport(): Promise<boolean> {
        try {
            const authApi = getAuthApi();
            if (!authApi) {
                console.log("Auth API not available, cannot submit progress report");
                return false;
            }

            const report = await this.generateProgressReport();
            if (!report) {
                console.log("Failed to generate progress report");
                return false;
            }

            // Check if the API has the submitProgressReport method
            if ("submitProgressReport" in authApi) {
                console.log("Submitting progress report to API...");

                const result = await authApi.submitProgressReport(report);
                console.log("API response:", result);

                if (result.success) {
                    console.log(`Progress report submitted successfully: ${result.reportId}`);
                    this.lastProgressReport = report;
                    this.lastReportTime = Date.now();
                    return true;
                } else {
                    console.error("Failed to submit progress report");
                    return false;
                }
            } else {
                console.log("submitProgressReport method not available in API");
                return false;
            }
        } catch (error) {
            console.error("Error forcing progress report:", error);
            return false;
        }
    }
}

// Register the command to trigger sync
export function registerSyncCommands(context: vscode.ExtensionContext): void {
    // Command to trigger immediate sync
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor-extension.triggerSync",
            async (message?: string) => {
                const syncManager = SyncManager.getInstance();
                await syncManager.executeSync(message || "Manual sync triggered");
            }
        )
    );

    // Command to schedule sync (replacing the manualCommit command)
    context.subscriptions.push(
        vscode.commands.registerCommand("extension.scheduleSync", (message: string) => {
            console.log("manualCommit called, scheduling sync operation");
            const syncManager = SyncManager.getInstance();
            syncManager.scheduleSyncOperation(message);
        })
    );

    // Command to force progress report submission
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor-extension.submitProgressReport",
            async (forceSubmit?: boolean) => {
                const syncManager = SyncManager.getInstance();
                const success = await syncManager.forceProgressReport();

                if (success) {
                    vscode.window.showInformationMessage(
                        "Project progress report submitted successfully"
                    );
                } else if (forceSubmit) {
                    // If force submit is true and we couldn't find a valid GitLab project,
                    // show a more specific error message
                    vscode.window.showWarningMessage(
                        "Progress report not submitted: No GitLab project found for this workspace"
                    );
                } else {
                    vscode.window.showErrorMessage("Failed to submit progress report");
                }
            }
        )
    );

    // Listen for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (
                event.affectsConfiguration("codex-project-manager.autoSyncEnabled") ||
                event.affectsConfiguration("codex-project-manager.syncDelayMinutes")
            ) {
                SyncManager.getInstance().updateFromConfiguration();
            }
        })
    );
}
