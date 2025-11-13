import * as vscode from "vscode";
import * as path from "path";
import { getAuthApi } from "../extension";
import { getNotebookMetadataManager } from "../utils/notebookMetadataManager";
import { getSQLiteIndexManager } from "../activationHelpers/contextAware/contentIndexes/indexes/sqliteIndexManager";

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

export interface BookCompletionData {
    completionPercentage: number;
    sourceWords: number;
    targetWords: number;
}

export interface ProjectProgressReport {
    projectId: string;
    projectName: string;
    timestamp: string;
    reportId: string;
    translationProgress: {
        bookCompletionMap: Record<string, BookCompletionData>;
        totalVerseCount: number;
        translatedVerseCount: number;
        validatedVerseCount: number;
        wordsTranslated: number;
    };
    // New structure
    wordCount: {
        sourceWords: number;
        codexWords: number;
    };
    // Legacy structure for backward compatibility
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
            const currentTimestamp = new Date().toISOString();

            const report: ProjectProgressReport = {
                projectId: projectId!,
                projectName: projectName,
                timestamp: currentTimestamp,
                reportId,
                translationProgress: {
                    bookCompletionMap: {},
                    totalVerseCount: 0,
                    translatedVerseCount: 0,
                    validatedVerseCount: 0,
                    wordsTranslated: 0,
                },
                wordCount: {
                    sourceWords: 0,
                    codexWords: 0,
                },
                validationStatus: {
                    stage: "none",
                    versesPerStage: {},
                    lastValidationTimestamp: currentTimestamp,
                },
                activityMetrics: {
                    lastEditTimestamp: currentTimestamp,
                    editCountLast24Hours: 0,
                    editCountLastWeek: 0,
                    averageDailyEdits: 0,
                },
                qualityMetrics: {
                    spellcheckIssueCount: 0,
                    flaggedSegmentsCount: 0,
                    consistencyScore: 85,
                },
            };

            // Generate translation progress data using SQLite index
            await this.collectTranslationProgress(report);

            debug("📊 Progress report generated successfully");
            return report;
        } catch (error) {
            console.error("📊 Error generating progress report:", error);
            return null;
        }
    }

    /**
 * Collect translation progress data from SQLite database using direct queries
 */
    private async collectTranslationProgress(report: ProjectProgressReport): Promise<void> {
        try {
            const sqliteIndex = getSQLiteIndexManager();
            if (!sqliteIndex || !sqliteIndex.database) {
                debug("📊 SQLite database not available, skipping progress collection");
                return;
            }

            const db = sqliteIndex.database;

            // Get basic cell statistics
            // Exclude paratext cells (cell_id contains "paratext-") and empty cells
            // total_cells should count cells with source content (these are the ones we're translating)
            const cellStatsStmt = db.prepare(`
                SELECT 
                    COUNT(*) as total_cells,
                    COUNT(CASE WHEN s_content IS NOT NULL AND s_content != '' THEN 1 END) as source_cells,
                    COUNT(CASE WHEN t_content IS NOT NULL AND t_content != '' THEN 1 END) as target_cells,
                    COUNT(CASE WHEN s_content IS NOT NULL AND s_content != '' AND t_content IS NOT NULL AND t_content != '' THEN 1 END) as complete_pairs,
                    COUNT(CASE WHEN t_is_fully_validated = 1 THEN 1 END) as validated_cells,
                    SUM(COALESCE(s_word_count, 0)) as total_source_words,
                    SUM(COALESCE(t_word_count, 0)) as total_target_words,
                    MAX(COALESCE(t_current_edit_timestamp, 0)) as last_edit_timestamp
                FROM cells
                WHERE cell_id NOT LIKE '%paratext%'
                    AND s_content IS NOT NULL AND s_content != ''
            `);

            let cellStats = {
                total_cells: 0,
                source_cells: 0,
                target_cells: 0,
                complete_pairs: 0,
                validated_cells: 0,
                total_source_words: 0,
                total_target_words: 0,
                last_edit_timestamp: 0
            };

            try {
                cellStatsStmt.step();
                const result = cellStatsStmt.getAsObject();
                cellStats = {
                    total_cells: (result.total_cells as number) || 0,
                    source_cells: (result.source_cells as number) || 0,
                    target_cells: (result.target_cells as number) || 0,
                    complete_pairs: (result.complete_pairs as number) || 0,
                    validated_cells: (result.validated_cells as number) || 0,
                    total_source_words: (result.total_source_words as number) || 0,
                    total_target_words: (result.total_target_words as number) || 0,
                    last_edit_timestamp: (result.last_edit_timestamp as number) || 0
                };
            } finally {
                cellStatsStmt.free();
            }

            // Calculate basic metrics
            report.translationProgress.totalVerseCount = cellStats.total_cells;
            report.translationProgress.translatedVerseCount = cellStats.complete_pairs;
            report.translationProgress.validatedVerseCount = cellStats.validated_cells;
            report.translationProgress.wordsTranslated = cellStats.total_target_words;

            // Set word counts
            report.wordCount.sourceWords = cellStats.total_source_words;
            report.wordCount.codexWords = cellStats.total_target_words;

            // First, let's debug what's in the files table
            const debugFilesStmt = db.prepare(`
                SELECT id, file_path, file_type, COUNT(*) as count
                FROM files
                GROUP BY id, file_path, file_type
                ORDER BY id
                LIMIT 10
            `);

            try {
                while (debugFilesStmt.step()) {
                    const row = debugFilesStmt.getAsObject();
                }
            } finally {
                debugFilesStmt.free();
            }

            // Debug what t_file_id values we have in cells
            const debugCellFilesStmt = db.prepare(`
                SELECT t_file_id, COUNT(*) as count
                FROM cells
                WHERE t_file_id IS NOT NULL
                GROUP BY t_file_id
                ORDER BY t_file_id
                LIMIT 10
            `);

            try {
                while (debugCellFilesStmt.step()) {
                    const row = debugCellFilesStmt.getAsObject();
                }
            } finally {
                debugCellFilesStmt.free();
            }

            // Try the original query to see what happens
            const originalBookCompletionStmt = db.prepare(`
                SELECT 
                    f.file_path,
                    COUNT(*) as total_cells,
                    COUNT(CASE WHEN c.t_content IS NOT NULL AND c.t_content != '' THEN 1 END) as translated_cells,
                    COUNT(CASE WHEN c.t_is_fully_validated = 1 THEN 1 END) as validated_cells,
                    SUM(COALESCE(c.s_word_count, 0)) as source_words,
                    SUM(COALESCE(c.t_word_count, 0)) as target_words
                FROM files f
                LEFT JOIN cells c ON f.id = c.t_file_id
                WHERE f.file_type = 'codex'
                GROUP BY f.file_path
                HAVING total_cells > 0
            `);

            try {
                while (originalBookCompletionStmt.step()) {
                    const row = originalBookCompletionStmt.getAsObject();
                }
            } finally {
                originalBookCompletionStmt.free();
            }

            // Now try a different approach - get book completion data by extracting file info from cell IDs
            // Since cell IDs seem to contain the file/book information
            // Exclude paratext cells and empty cells from progress calculations
            // total_cells should count cells with source content (these are the ones we're translating)
            const bookCompletionStmt = db.prepare(`
                SELECT 
                    -- Extract book name from cell_id (everything before the first space or colon)
                    CASE 
                        WHEN cell_id LIKE '%:%' THEN SUBSTR(cell_id, 1, INSTR(cell_id, ':') - 1)
                        WHEN cell_id LIKE '% %' THEN SUBSTR(cell_id, 1, INSTR(cell_id, ' ') - 1)
                        ELSE cell_id
                    END as book_name,
                    COUNT(*) as total_cells,
                    COUNT(CASE WHEN t_content IS NOT NULL AND t_content != '' THEN 1 END) as translated_cells,
                    COUNT(CASE WHEN t_is_fully_validated = 1 THEN 1 END) as validated_cells,
                    SUM(COALESCE(s_word_count, 0)) as source_words,
                    SUM(COALESCE(t_word_count, 0)) as target_words
                FROM cells
                WHERE cell_id IS NOT NULL 
                    AND cell_id != ''
                    AND cell_id NOT LIKE '%paratext%'
                    AND s_content IS NOT NULL AND s_content != ''
                GROUP BY book_name
                HAVING total_cells > 0
                ORDER BY book_name
            `);

            const bookCompletionMap: Record<string, BookCompletionData> = {};
            try {
                while (bookCompletionStmt.step()) {
                    const row = bookCompletionStmt.getAsObject();
                    const bookName = row.book_name as string;
                    const totalCells = (row.total_cells as number) || 0;
                    const translatedCells = (row.translated_cells as number) || 0;
                    const sourceWords = (row.source_words as number) || 0;
                    const targetWords = (row.target_words as number) || 0;

                    if (totalCells > 0 && bookName) {
                        const completionPercentage = (translatedCells / totalCells) * 100;
                        bookCompletionMap[bookName] = {
                            completionPercentage: Math.round(completionPercentage * 100) / 100,
                            sourceWords: sourceWords,
                            targetWords: targetWords
                        };
                    }
                }
            } finally {
                bookCompletionStmt.free();
            }

            report.translationProgress.bookCompletionMap = bookCompletionMap;

            // Calculate activity metrics from actual edit timestamps
            const now = Date.now();
            const dayAgo = now - (24 * 60 * 60 * 1000);
            const weekAgo = now - (7 * 24 * 60 * 60 * 1000);

            const activityStmt = db.prepare(`
                SELECT 
                    COUNT(CASE WHEN t_current_edit_timestamp >= ? THEN 1 END) as edits_last_24h,
                    COUNT(CASE WHEN t_current_edit_timestamp >= ? THEN 1 END) as edits_last_week,
                    AVG(CASE WHEN t_current_edit_timestamp > 0 THEN 1 ELSE 0 END) as avg_daily_edits
                FROM cells
                WHERE t_current_edit_timestamp > 0
            `);

            let activityStats = {
                edits_last_24h: 0,
                edits_last_week: 0,
                avg_daily_edits: 0
            };

            try {
                activityStmt.bind([dayAgo, weekAgo]);
                activityStmt.step();
                const result = activityStmt.getAsObject();
                activityStats = {
                    edits_last_24h: (result.edits_last_24h as number) || 0,
                    edits_last_week: (result.edits_last_week as number) || 0,
                    avg_daily_edits: (result.avg_daily_edits as number) || 0
                };
            } finally {
                activityStmt.free();
            }

            report.activityMetrics = {
                lastEditTimestamp: cellStats.last_edit_timestamp > 0 ?
                    new Date(cellStats.last_edit_timestamp).toISOString() :
                    new Date().toISOString(),
                editCountLast24Hours: activityStats.edits_last_24h,
                editCountLastWeek: activityStats.edits_last_week,
                averageDailyEdits: Math.round(activityStats.avg_daily_edits * 10) / 10
            };

            // Calculate quality metrics
            // Exclude paratext cells and empty cells
            // Only count cells with source content
            const qualityStmt = db.prepare(`
                SELECT 
                    COUNT(CASE WHEN t_validation_count = 0 AND t_content IS NOT NULL AND t_content != '' THEN 1 END) as unvalidated_segments,
                    AVG(CASE WHEN t_validation_count > 0 THEN t_validation_count ELSE 0 END) as avg_validation_count,
                    COUNT(CASE WHEN t_is_fully_validated = 1 THEN 1 END) * 100.0 / COUNT(CASE WHEN t_content IS NOT NULL AND t_content != '' THEN 1 END) as consistency_score
                FROM cells
                WHERE cell_id NOT LIKE '%paratext%'
                    AND s_content IS NOT NULL AND s_content != ''
            `);

            let qualityStats = {
                unvalidated_segments: 0,
                avg_validation_count: 0,
                consistency_score: 0
            };

            try {
                qualityStmt.step();
                const result = qualityStmt.getAsObject();
                qualityStats = {
                    unvalidated_segments: (result.unvalidated_segments as number) || 0,
                    avg_validation_count: (result.avg_validation_count as number) || 0,
                    consistency_score: (result.consistency_score as number) || 0
                };
            } finally {
                qualityStmt.free();
            }

            report.qualityMetrics = {
                spellcheckIssueCount: 0, // Not tracked in current schema
                flaggedSegmentsCount: qualityStats.unvalidated_segments,
                consistencyScore: Math.round(qualityStats.consistency_score)
            };

            // Populate legacy validationStatus for backward compatibility
            const totalVerses = report.translationProgress.totalVerseCount;
            const translatedVerses = report.translationProgress.translatedVerseCount;
            const validatedVerses = report.translationProgress.validatedVerseCount;

            const progress = totalVerses > 0 ? translatedVerses / totalVerses : 0;

            // Determine validation stage based on progress
            let stage: "none" | "initial" | "community" | "expert" | "finished" = "none";
            if (progress >= 0.95) {
                stage = "finished";
            } else if (progress >= 0.75) {
                stage = "expert";
            } else if (progress >= 0.5) {
                stage = "community";
            } else if (progress >= 0.25) {
                stage = "initial";
            }

            report.validationStatus = {
                stage,
                versesPerStage: {
                    none: Math.max(0, totalVerses - translatedVerses),
                    initial: stage === "initial" ? translatedVerses : 0,
                    community: stage === "community" ? translatedVerses : 0,
                    expert: stage === "expert" ? translatedVerses : 0,
                    finished: stage === "finished" ? translatedVerses : 0,
                },
                lastValidationTimestamp: cellStats.last_edit_timestamp > 0 ?
                    new Date(cellStats.last_edit_timestamp).toISOString() :
                    new Date().toISOString(),
            };

            debug(`📊 Translation progress collected: ${report.translationProgress.translatedVerseCount}/${report.translationProgress.totalVerseCount} verses`);
            debug(`📊 Word counts: ${report.wordCount.sourceWords} source, ${report.wordCount.codexWords} target`);
            debug(`📊 Book completion map: ${Object.keys(report.translationProgress.bookCompletionMap).length} books`);
            debug(`📊 Activity: ${report.activityMetrics.editCountLast24Hours} edits (24h), ${report.activityMetrics.editCountLastWeek} edits (week)`);
            debug(`📊 Quality: ${report.qualityMetrics.consistencyScore}% consistency, ${report.qualityMetrics.flaggedSegmentsCount} flagged segments`);
            debug(`📊 Validation status: ${report.validationStatus.stage} stage`);

        } catch (error) {
            console.error("📊 Error collecting translation progress data:", error);
        }
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