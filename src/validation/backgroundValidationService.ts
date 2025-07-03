import * as vscode from "vscode";
import { createHash } from "crypto";
import { SQLiteIndexManager } from "../activationHelpers/contextAware/contentIndexes/indexes/sqliteIndex";
import { FileSyncManager } from "../activationHelpers/contextAware/contentIndexes/fileSyncManager";

const DEBUG_MODE = false;
const debug = (message: string, ...args: any[]) => {
    DEBUG_MODE && console.log(`[BackgroundValidationService] ${message}`, ...args);
};

export interface ValidationResult {
    isValid: boolean;
    validationType: "quick" | "integrity";
    timestamp: string;
    duration: number;
    issues: ValidationIssue[];
    stats: {
        filesChecked: number;
        cellsValidated: number;
        hashMismatches: number;
        corruptionDetected: number;
        autoRepaired: number;
    };
}

export interface ValidationIssue {
    severity: "info" | "warning" | "error" | "critical";
    type: "hash_mismatch" | "missing_sync_metadata" | "database_corruption" | "file_missing" | "cell_corruption";
    description: string;
    filePath?: string;
    cellId?: string;
    details?: any;
    autoRepaired: boolean;
}

export interface ValidationRequest {
    type: "quick" | "integrity";
    requestId: string;
    scheduledTime: number;
}

/**
 * Background service for automatic database and file integrity validation
 * Detects issues that file-level sync checking might miss, such as:
 * - Database corruption affecting cell data but not sync metadata
 * - Hash mismatches between stored content and sync metadata
 * - Orphaned records and basic referential integrity issues
 */
export class BackgroundValidationService {
    private static instance: BackgroundValidationService;
    private sqliteIndex: SQLiteIndexManager | null = null;
    private fileSyncManager: FileSyncManager | null = null;

    private pendingValidations: Map<string, ValidationRequest> = new Map();
    private isRunning: boolean = false;
    private lastValidationTimes: Map<string, number> = new Map();

    // Validation intervals (in milliseconds)
    private readonly VALIDATION_INTERVALS = {
        QUICK_CHECK: 5 * 60 * 1000,        // 5 minutes - lightweight checks
        INTEGRITY_CHECK: 60 * 60 * 1000,    // 1 hour - hash validation & cross-checks
    };

    private readonly PROCESSING_INTERVAL = 30 * 1000; // Process queue every 30 seconds
    private processingTimer: ReturnType<typeof setInterval> | null = null;

    private constructor() { }

    public static getInstance(): BackgroundValidationService {
        if (!BackgroundValidationService.instance) {
            BackgroundValidationService.instance = new BackgroundValidationService();
        }
        return BackgroundValidationService.instance;
    }

    /**
     * Initialize the service with required dependencies
     */
    public initialize(sqliteIndex: SQLiteIndexManager, fileSyncManager: FileSyncManager): void {
        this.sqliteIndex = sqliteIndex;
        this.fileSyncManager = fileSyncManager;
        debug("🔍 Background Validation Service initialized");
    }

    /**
     * Start the background validation service
     */
    public start(): void {
        if (this.isRunning) {
            debug("🔍 Background Validation Service already running");
            return;
        }

        this.isRunning = true;
        debug("🔍 Background Validation Service started");

        // Schedule initial validation checks
        this.scheduleValidation("quick");
        this.scheduleValidation("integrity");

        // Process immediately on startup (no waiting for overdue validations!)
        this.processValidationQueue();

        // Start processing loop for ongoing checks
        this.processingTimer = setInterval(() => {
            this.processValidationQueue();
        }, this.PROCESSING_INTERVAL);
    }

    /**
     * Stop the background validation service
     */
    public stop(): void {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;

        if (this.processingTimer) {
            clearInterval(this.processingTimer);
            this.processingTimer = null;
        }

        this.pendingValidations.clear();
        debug("🔍 Background Validation Service stopped");
    }

    /**
     * Schedule a validation check of the specified type
     */
    public scheduleValidation(type: "quick" | "integrity"): void {
        if (!this.shouldRunValidation(type)) {
            return;
        }

        // Smart scheduling: avoid redundant validations
        if (this.shouldSkipValidation(type)) {
            debug(`🔍 Skipping ${type} validation (${this.getSkipReason(type)})`);
            return;
        }

        const requestId = this.generateUUID();
        const request: ValidationRequest = {
            type,
            requestId,
            scheduledTime: Date.now(),
        };

        this.pendingValidations.set(requestId, request);
        debug(`🔍 Scheduled ${type} validation: ${requestId}`);
    }

    /**
 * Force immediate validation (for manual triggers)
 */
    public async forceValidation(type: "quick" | "integrity"): Promise<ValidationResult> {
        debug(`🔍 Force-running ${type} validation...`);

        switch (type) {
            case "quick":
                return await this.performQuickValidation();
            case "integrity":
                return await this.performIntegrityValidation();
            default:
                throw new Error(`Unknown validation type: ${type}`);
        }
    }

    /**
     * Process pending validation requests
     */
    private async processValidationQueue(): Promise<void> {
        if (this.pendingValidations.size === 0) {
            return;
        }

        // Process one validation at a time to avoid overwhelming the system
        const firstEntry = this.pendingValidations.entries().next().value;
        if (!firstEntry) {
            return;
        }

        const [requestId, request] = firstEntry;
        this.pendingValidations.delete(requestId);

        try {
            debug(`🔍 Processing ${request.type} validation: ${requestId}`);
            let result: ValidationResult;

            switch (request.type) {
                case "quick":
                    result = await this.performQuickValidation();
                    break;
                case "integrity":
                    result = await this.performIntegrityValidation();
                    break;
                default:
                    throw new Error(`Unknown validation type: ${request.type}`);
            }

            await this.handleValidationResult(result);
            this.lastValidationTimes.set(request.type, Date.now());

            // Schedule next validation of this type with slight random delay to spread out timing
            const baseInterval = this.getValidationInterval(request.type);
            const randomDelay = Math.random() * 30000; // 0-30 seconds random delay
            setTimeout(() => {
                this.scheduleValidation(request.type);
            }, baseInterval + randomDelay);

        } catch (error) {
            console.error(`🔍 Error processing validation ${requestId}:`, error);
        }
    }

    /**
     * Quick validation - lightweight checks (5 minutes)
     */
    private async performQuickValidation(): Promise<ValidationResult> {
        const startTime = Date.now();
        const issues: ValidationIssue[] = [];
        const stats = {
            filesChecked: 0,
            cellsValidated: 0,
            hashMismatches: 0,
            corruptionDetected: 0,
            autoRepaired: 0,
        };

        try {
            // 1. Check database connectivity
            if (!this.sqliteIndex?.database) {
                issues.push({
                    severity: "critical",
                    type: "database_corruption",
                    description: "Database connection lost",
                    autoRepaired: false,
                });
            } else {
                // 2. Quick database health check
                try {
                    const dbStats = await this.sqliteIndex.getContentStats();
                    if (dbStats.totalCells === 0) {
                        issues.push({
                            severity: "warning",
                            type: "database_corruption",
                            description: "Database appears empty - no cells found",
                            autoRepaired: false,
                        });
                    }
                    stats.cellsValidated = dbStats.totalCells;
                } catch (error) {
                    issues.push({
                        severity: "error",
                        type: "database_corruption",
                        description: `Database query failed: ${error}`,
                        autoRepaired: false,
                    });
                }
            }

            // 3. Check for recent sync errors
            if (this.fileSyncManager) {
                try {
                    const syncStatus = await this.fileSyncManager.checkSyncStatus();
                    stats.filesChecked = syncStatus.summary.totalFiles;

                    if (syncStatus.summary.changedFiles > syncStatus.summary.totalFiles * 0.5) {
                        issues.push({
                            severity: "warning",
                            type: "hash_mismatch",
                            description: `Many files out of sync: ${syncStatus.summary.changedFiles}/${syncStatus.summary.totalFiles}`,
                            autoRepaired: false,
                        });
                    }
                } catch (error) {
                    issues.push({
                        severity: "error",
                        type: "file_missing",
                        description: `Sync status check failed: ${error}`,
                        autoRepaired: false,
                    });
                }
            }

        } catch (error) {
            issues.push({
                severity: "critical",
                type: "database_corruption",
                description: `Quick validation failed: ${error}`,
                autoRepaired: false,
            });
        }

        return {
            isValid: issues.filter(i => i.severity === "error" || i.severity === "critical").length === 0,
            validationType: "quick",
            timestamp: new Date().toISOString(),
            duration: Date.now() - startTime,
            issues,
            stats,
        };
    }

    /**
     * Integrity validation - hash validation and cross-checking (1 hour)
     * This is the KEY validation that catches the issue you identified!
     */
    private async performIntegrityValidation(): Promise<ValidationResult> {
        const startTime = Date.now();
        const issues: ValidationIssue[] = [];
        const stats = {
            filesChecked: 0,
            cellsValidated: 0,
            hashMismatches: 0,
            corruptionDetected: 0,
            autoRepaired: 0,
        };

        if (!this.sqliteIndex?.database) {
            return {
                isValid: false,
                validationType: "integrity",
                timestamp: new Date().toISOString(),
                duration: Date.now() - startTime,
                issues: [{
                    severity: "critical",
                    type: "database_corruption",
                    description: "Database not available for integrity validation",
                    autoRepaired: false,
                }],
                stats,
            };
        }

        try {
            // 1. OPTIMIZED BATCH VALIDATION - Process files in parallel batches
            debug("🔍 Cross-validating sync metadata against database content...");

            // Get all sync metadata in one query (much faster than stepping through)
            const allSyncMetadata = this.sqliteIndex.database.exec(`
                SELECT file_path, content_hash, file_type 
                FROM sync_metadata 
                ORDER BY file_path
            `)[0]?.values || [];

            if (allSyncMetadata.length === 0) {
                debug("🔍 No sync metadata found - database may be empty");
                return {
                    isValid: true,
                    validationType: "integrity",
                    timestamp: new Date().toISOString(),
                    duration: Date.now() - startTime,
                    issues: [],
                    stats,
                };
            }

            debug(`🔍 Validating ${allSyncMetadata.length} files...`);

            // Process files in batches for better performance
            const BATCH_SIZE = 25; // Optimized batch size
            const batches = [];
            for (let i = 0; i < allSyncMetadata.length; i += BATCH_SIZE) {
                batches.push(allSyncMetadata.slice(i, i + BATCH_SIZE));
            }

            // Process batches with parallel validation
            for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
                const batch = batches[batchIndex];
                debug(`🔍 Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} files)`);

                // Process validation for this batch - use DIRECT FILE READING for accurate hash comparison
                for (const syncRow of batch) {
                    const filePath = syncRow[0].toString();
                    const expectedHash = syncRow[1].toString();
                    stats.filesChecked++;

                    try {
                        // Read actual file content (same method as FileSyncManager uses for sync_metadata)
                        const fileUri = vscode.Uri.file(filePath);
                        const fileContent = await vscode.workspace.fs.readFile(fileUri);
                        const actualHash = createHash("sha256").update(fileContent).digest("hex");

                        // Get cell count from database for stats
                        const cellCountStmt = this.sqliteIndex.database.prepare(`
                            SELECT COUNT(c.cell_id) as cell_count
                            FROM files f
                            LEFT JOIN cells c ON (c.s_file_id = f.id OR c.t_file_id = f.id)
                            WHERE f.file_path = ?
                        `);

                        let cellCount = 0;
                        try {
                            cellCountStmt.bind([filePath]);
                            if (cellCountStmt.step()) {
                                const result = cellCountStmt.getAsObject() as any;
                                cellCount = result.cell_count || 0;
                            }
                        } finally {
                            cellCountStmt.free();
                        }

                        stats.cellsValidated += cellCount;

                        if (actualHash !== expectedHash) {
                            stats.hashMismatches++;
                            const issue: ValidationIssue = {
                                severity: "error",
                                type: "hash_mismatch",
                                description: `Database content doesn't match sync metadata for file: ${filePath}`,
                                filePath: filePath,
                                details: {
                                    syncMetadataHash: expectedHash,
                                    databaseContentHash: actualHash,
                                    cellCount: cellCount,
                                },
                                autoRepaired: false,
                            };

                            // Attempt auto-repair by triggering re-sync
                            try {
                                if (this.fileSyncManager) {
                                    debug(`🔍 Auto-repairing hash mismatch for ${filePath}`);
                                    await this.fileSyncManager.syncFiles({
                                        forceSync: false, // Only sync this specific file
                                    });
                                    issue.autoRepaired = true;
                                    stats.autoRepaired++;
                                    debug(`🔍 ✅ Auto-repaired hash mismatch for ${filePath}`);
                                }
                            } catch (repairError) {
                                console.error(`🔍 Failed to auto-repair ${filePath}:`, repairError);
                                issue.details.repairError = repairError;
                            }

                            issues.push(issue);

                            // Early termination if too many corruption issues (performance optimization)
                            if (stats.hashMismatches > 50) {
                                debug(`🔍 ⚠️ Early termination: detected ${stats.hashMismatches} hash mismatches - stopping validation to prevent performance issues`);
                                issues.push({
                                    severity: "critical",
                                    type: "database_corruption",
                                    description: `Massive corruption detected: ${stats.hashMismatches}+ hash mismatches found. Early termination triggered.`,
                                    autoRepaired: false,
                                });
                                break; // Break out of file processing loop
                            }
                        }
                    } catch (fileError) {
                        // Handle file read errors
                        issues.push({
                            severity: "error",
                            type: "file_missing",
                            description: `Failed to read file for validation: ${filePath} - ${fileError}`,
                            filePath: filePath,
                            autoRepaired: false,
                        });
                    }
                }

                // Break out of batch processing loop if early termination triggered
                if (stats.hashMismatches > 50) {
                    break;
                }
            }

            // Performance summary for batch processing
            const validationDuration = Date.now() - startTime;
            debug(`🔍 Batch validation completed: ${stats.filesChecked} files in ${validationDuration}ms (${Math.round(stats.filesChecked / (validationDuration / 1000))} files/sec)`);

            // Skip expensive checks if early termination was triggered
            if (stats.hashMismatches <= 50) {
                // 2. Check for orphaned sync metadata (files that no longer exist) - FAST CHECK
                debug("🔍 Checking for orphaned sync metadata...");
                const orphanedMetadata = await this.findOrphanedSyncMetadata();
                for (const orphan of orphanedMetadata) {
                    issues.push({
                        severity: "warning",
                        type: "missing_sync_metadata",
                        description: `Sync metadata exists for non-existent file: ${orphan}`,
                        filePath: orphan,
                        autoRepaired: false,
                    });
                }

                // 3. Basic referential integrity checks - FAST CHECK
                debug("🔍 Checking referential integrity...");
                const integrityIssues = await this.checkReferentialIntegrity();
                issues.push(...integrityIssues);
                stats.corruptionDetected += integrityIssues.filter(i =>
                    i.type === "database_corruption" || i.type === "cell_corruption"
                ).length;
            } else {
                debug("🔍 Skipping orphaned metadata and integrity checks due to massive corruption detected");
            }

        } catch (error) {
            issues.push({
                severity: "critical",
                type: "database_corruption",
                description: `Integrity validation failed: ${error}`,
                autoRepaired: false,
            });
        }

        return {
            isValid: issues.filter(i => i.severity === "error" || i.severity === "critical").length === 0,
            validationType: "integrity",
            timestamp: new Date().toISOString(),
            duration: Date.now() - startTime,
            issues,
            stats,
        };
    }



    /**
     * Handle validation results - show notifications for critical issues
     */
    private async handleValidationResult(result: ValidationResult): Promise<void> {
        const criticalIssues = result.issues.filter(i => i.severity === "critical");
        const errorIssues = result.issues.filter(i => i.severity === "error");
        const warningIssues = result.issues.filter(i => i.severity === "warning");

        debug(`🔍 ${result.validationType} validation completed:`, {
            duration: `${result.duration}ms`,
            isValid: result.isValid,
            issues: result.issues.length,
            autoRepaired: result.stats.autoRepaired,
        });

        // Show notifications for significant issues
        if (criticalIssues.length > 0) {
            const message = `Critical database issues detected: ${criticalIssues.length} problems found`;
            vscode.window.showErrorMessage(message, "View Issues", "Force Rebuild").then(choice => {
                if (choice === "View Issues") {
                    this.showValidationReport(result);
                } else if (choice === "Force Rebuild") {
                    vscode.commands.executeCommand("codex-editor-extension.deleteDatabaseAndTriggerReindex");
                }
            });
        } else if (errorIssues.length > 0 && result.stats.autoRepaired < errorIssues.length) {
            const unrepairedErrors = errorIssues.length - result.stats.autoRepaired;
            if (unrepairedErrors > 0) {
                const message = `Database errors detected: ${unrepairedErrors} issues need attention`;
                vscode.window.showWarningMessage(message, "View Issues", "Run Sync").then(choice => {
                    if (choice === "View Issues") {
                        this.showValidationReport(result);
                    } else if (choice === "Run Sync") {
                        vscode.commands.executeCommand("codex-editor-extension.refreshIndex");
                    }
                });
            }
        } else if (result.stats.autoRepaired > 0) {
            // Log auto-repair results to console instead of showing to user
            console.log(`[BackgroundValidation] ✅ Auto-repaired ${result.stats.autoRepaired} database issues during validation`);
        }
    }

    /**
     * Show detailed validation report
     */
    private showValidationReport(result: ValidationResult): void {
        const issues = result.issues.slice(0, 20); // Limit to first 20 issues
        const issueList = issues.map(issue =>
            `• [${issue.severity.toUpperCase()}] ${issue.description}${issue.autoRepaired ? ' (auto-repaired)' : ''}`
        ).join('\n');

        const report = `
Validation Report (${result.validationType})
Duration: ${result.duration}ms
Files Checked: ${result.stats.filesChecked}
Cells Validated: ${result.stats.cellsValidated}
Issues Found: ${result.issues.length}
Auto-Repaired: ${result.stats.autoRepaired}

Issues:
${issueList}

${result.issues.length > 20 ? `... and ${result.issues.length - 20} more issues` : ''}
        `.trim();

        debug("🔍 Detailed validation report:", report);

        // Could show in output channel or webview for better UX
        const outputChannel = vscode.window.createOutputChannel("Codex Validation");
        outputChannel.clear();
        outputChannel.appendLine(report);
        outputChannel.show();
    }

    /**
     * Helper methods for specific validation checks
     */
    private async findOrphanedSyncMetadata(): Promise<string[]> {
        if (!this.sqliteIndex?.database) return [];

        const stmt = this.sqliteIndex.database.prepare("SELECT file_path FROM sync_metadata");
        const orphans: string[] = [];

        try {
            while (stmt.step()) {
                const row = stmt.getAsObject();
                const filePath = row.file_path as string;

                try {
                    await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
                } catch {
                    orphans.push(filePath);
                }
            }
        } finally {
            stmt.free();
        }

        return orphans;
    }

    private async checkReferentialIntegrity(): Promise<ValidationIssue[]> {
        if (!this.sqliteIndex?.database) return [];

        const issues: ValidationIssue[] = [];

        // Check for cells without files
        const orphanCellsStmt = this.sqliteIndex.database.prepare(`
            SELECT COUNT(*) as count FROM cells c 
            LEFT JOIN files s_file ON c.s_file_id = s_file.id 
            LEFT JOIN files t_file ON c.t_file_id = t_file.id
            WHERE c.s_file_id IS NOT NULL AND s_file.id IS NULL
            OR c.t_file_id IS NOT NULL AND t_file.id IS NULL
        `);

        try {
            orphanCellsStmt.step();
            const result = orphanCellsStmt.getAsObject();
            const orphanCount = result.count as number;

            if (orphanCount > 0) {
                issues.push({
                    severity: "error",
                    type: "database_corruption",
                    description: `Found ${orphanCount} orphaned cells (cells without corresponding files)`,
                    autoRepaired: false,
                });
            }
        } finally {
            orphanCellsStmt.free();
        }

        return issues;
    }



    /**
     * Utility methods
     */
    private shouldRunValidation(type: "quick" | "integrity"): boolean {
        const lastRun = this.lastValidationTimes.get(type) || 0;
        const interval = this.getValidationInterval(type);
        return Date.now() - lastRun >= interval;
    }

    /**
     * Smart scheduling logic to prevent redundant or conflicting validations
     */
    private shouldSkipValidation(type: "quick" | "integrity"): boolean {
        const now = Date.now();

        // Check if there's already a validation of the same type pending
        for (const request of this.pendingValidations.values()) {
            if (request.type === type) {
                return true; // Skip duplicate
            }
        }

        // Smart hierarchy: Skip quick validation if integrity validation ran recently or is pending
        if (type === "quick") {
            const integrityLastRun = this.lastValidationTimes.get("integrity") || 0;
            const timeSinceIntegrity = now - integrityLastRun;

            // Skip quick if integrity ran within the last 10 minutes (integrity is more comprehensive)
            if (timeSinceIntegrity < 10 * 60 * 1000) {
                return true;
            }

            // Skip quick if integrity validation is already pending
            for (const request of this.pendingValidations.values()) {
                if (request.type === "integrity") {
                    return true;
                }
            }
        }

        // Prevent scheduling if any validation is currently running
        // (We could add a "currently running" flag here if needed)

        return false;
    }

    private getSkipReason(type: "quick" | "integrity"): string {
        const now = Date.now();

        // Check for duplicates
        for (const request of this.pendingValidations.values()) {
            if (request.type === type) {
                return `${type} validation already pending`;
            }
        }

        // Quick validation specific reasons
        if (type === "quick") {
            const integrityLastRun = this.lastValidationTimes.get("integrity") || 0;
            const timeSinceIntegrity = now - integrityLastRun;

            if (timeSinceIntegrity < 10 * 60 * 1000) {
                const minutesAgo = Math.round(timeSinceIntegrity / (60 * 1000));
                return `integrity validation ran ${minutesAgo} minutes ago`;
            }

            for (const request of this.pendingValidations.values()) {
                if (request.type === "integrity") {
                    return "integrity validation pending";
                }
            }
        }

        return "unknown";
    }

    private getValidationInterval(type: "quick" | "integrity"): number {
        switch (type) {
            case "quick":
                return this.VALIDATION_INTERVALS.QUICK_CHECK;
            case "integrity":
                return this.VALIDATION_INTERVALS.INTEGRITY_CHECK;
            default:
                return this.VALIDATION_INTERVALS.QUICK_CHECK;
        }
    }

    private generateUUID(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Get validation status for monitoring
     */
    public getValidationStatus(): {
        isRunning: boolean;
        pendingValidations: number;
        lastValidationTimes: Record<string, string>;
    } {
        const lastTimes: Record<string, string> = {};
        for (const [type, timestamp] of this.lastValidationTimes.entries()) {
            lastTimes[type] = new Date(timestamp).toISOString();
        }

        return {
            isRunning: this.isRunning,
            pendingValidations: this.pendingValidations.size,
            lastValidationTimes: lastTimes,
        };
    }
}

/**
 * Register background validation commands and start the service
 */
export function registerBackgroundValidation(
    context: vscode.ExtensionContext,
    sqliteIndex: SQLiteIndexManager,
    fileSyncManager: FileSyncManager
): void {
    const service = BackgroundValidationService.getInstance();
    service.initialize(sqliteIndex, fileSyncManager);
    service.start();

    // Stop service on extension deactivation
    context.subscriptions.push({
        dispose: () => service.stop()
    });

    // Command to force immediate validation
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor-extension.forceIntegrityValidation",
            async () => {
                try {
                    vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: "Running integrity validation...",
                        cancellable: false
                    }, async (progress) => {
                        progress.report({ message: "Validating database integrity..." });
                        const result = await service.forceValidation("integrity");

                        if (result.isValid) {
                            vscode.window.showInformationMessage(
                                `Validation passed: ${result.stats.filesChecked} files, ${result.stats.cellsValidated} cells checked`
                            );
                        } else {
                            vscode.window.showWarningMessage(
                                `Validation found ${result.issues.length} issues (${result.stats.autoRepaired} auto-repaired)`
                            );
                        }
                    });
                } catch (error) {
                    vscode.window.showErrorMessage(`Validation failed: ${error}`);
                }
            }
        )
    );



    // Command to check validation status
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor-extension.checkValidationStatus",
            () => {
                const status = service.getValidationStatus();
                const message = `Validation Service Status:
Running: ${status.isRunning}
Pending: ${status.pendingValidations}
Last Quick: ${status.lastValidationTimes.quick || 'never'}
Last Integrity: ${status.lastValidationTimes.integrity || 'never'}`;

                vscode.window.showInformationMessage("Validation Status", "View Details").then(choice => {
                    if (choice === "View Details") {
                        debug("Validation service status:", status);
                    }
                });
            }
        )
    );

    // Command to manually refresh the search index for immediate searchability
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor-extension.refreshSearchIndex",
            async () => {
                try {
                    vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: "Refreshing search index...",
                        cancellable: false
                    }, async (progress) => {
                        // Log technical operation to console instead of showing to user
                        console.log("[BackgroundValidation] 🔍 Rebuilding full-text search index...");
                        progress.report({ message: "Refreshing search..." });
                        await sqliteIndex.refreshFTSIndex();

                        const debugInfo = await sqliteIndex.getFTSDebugInfo();
                        vscode.window.showInformationMessage(
                            `Search index refreshed! Cells: ${debugInfo.cellsCount}, FTS: ${debugInfo.ftsCount}`
                        );
                    });
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to refresh search index: ${error}`);
                }
            }
        )
    );

    // Command to debug search index synchronization status
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor-extension.debugSearchIndex",
            async () => {
                try {
                    const debugInfo = await sqliteIndex.getFTSDebugInfo();
                    const statusMessage = `Search Index Status:
Cells in database: ${debugInfo.cellsCount}
Cells in search index: ${debugInfo.ftsCount}
Sync status: ${debugInfo.cellsCount === debugInfo.ftsCount ? '✅ Synchronized' : '⚠️ Out of sync'}`;

                    const choice = await vscode.window.showInformationMessage(
                        statusMessage,
                        "Refresh Index",
                        "View Details"
                    );

                    if (choice === "Refresh Index") {
                        vscode.commands.executeCommand("codex-editor-extension.refreshSearchIndex");
                    } else if (choice === "View Details") {
                        debug("Search index debug info:", debugInfo);
                        debug("Search index status details:", statusMessage);
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to get search index status: ${error}`);
                }
            }
        )
    );
} 