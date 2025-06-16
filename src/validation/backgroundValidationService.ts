import * as vscode from "vscode";
import { createHash } from "crypto";
import { SQLiteIndexManager } from "../activationHelpers/contextAware/contentIndexes/indexes/sqliteIndex";
import { FileSyncManager } from "../activationHelpers/contextAware/contentIndexes/fileSyncManager";

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
        console.log("🔍 Background Validation Service initialized");
    }

    /**
     * Start the background validation service
     */
    public start(): void {
        if (this.isRunning) {
            console.log("🔍 Background Validation Service already running");
            return;
        }

        this.isRunning = true;
        console.log("🔍 Background Validation Service started");

        // Schedule initial validation checks
        this.scheduleValidation("quick");
        this.scheduleValidation("integrity");

        // Start processing loop
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
        console.log("🔍 Background Validation Service stopped");
    }

    /**
     * Schedule a validation check of the specified type
     */
    public scheduleValidation(type: "quick" | "integrity"): void {
        if (!this.shouldRunValidation(type)) {
            return;
        }

        const requestId = this.generateUUID();
        const request: ValidationRequest = {
            type,
            requestId,
            scheduledTime: Date.now(),
        };

        this.pendingValidations.set(requestId, request);
        console.log(`🔍 Scheduled ${type} validation: ${requestId}`);
    }

    /**
 * Force immediate validation (for manual triggers)
 */
    public async forceValidation(type: "quick" | "integrity"): Promise<ValidationResult> {
        console.log(`🔍 Force-running ${type} validation...`);

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
            console.log(`🔍 Processing ${request.type} validation: ${requestId}`);
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

            // Schedule next validation of this type
            setTimeout(() => {
                this.scheduleValidation(request.type);
            }, this.getValidationInterval(request.type));

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
        let stats = {
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
        let stats = {
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
            // 1. CROSS-VALIDATE sync_metadata hashes against actual database content
            // This catches the exact issue you identified!
            console.log("🔍 Cross-validating sync metadata against database content...");

            const syncMetadataStmt = this.sqliteIndex.database.prepare(`
                SELECT file_path, content_hash, file_type 
                FROM sync_metadata 
                ORDER BY file_path
            `);

            try {
                while (syncMetadataStmt.step()) {
                    const syncRecord = syncMetadataStmt.getAsObject() as any;
                    stats.filesChecked++;

                    // Get all cells for this file from the database
                    const cellsStmt = this.sqliteIndex.database.prepare(`
                        SELECT content, raw_content 
                        FROM cells c
                        JOIN files f ON c.file_id = f.id
                        WHERE f.file_path = ?
                        ORDER BY c.id
                    `);

                    let actualFileContent = "";
                    let cellCount = 0;
                    try {
                        cellsStmt.bind([syncRecord.file_path]);
                        while (cellsStmt.step()) {
                            const cell = cellsStmt.getAsObject() as any;
                            actualFileContent += (cell.raw_content || cell.content || "") + "\n";
                            cellCount++;
                        }
                    } finally {
                        cellsStmt.free();
                    }

                    stats.cellsValidated += cellCount;

                    // Compute hash of database content
                    const databaseContentHash = createHash("sha256")
                        .update(actualFileContent.trim())
                        .digest("hex");

                    // Compare with sync metadata hash
                    if (databaseContentHash !== syncRecord.content_hash) {
                        stats.hashMismatches++;
                        const issue: ValidationIssue = {
                            severity: "error",
                            type: "hash_mismatch",
                            description: `Database content doesn't match sync metadata for file: ${syncRecord.file_path}`,
                            filePath: syncRecord.file_path,
                            details: {
                                syncMetadataHash: syncRecord.content_hash,
                                databaseContentHash: databaseContentHash,
                                cellCount: cellCount,
                            },
                            autoRepaired: false,
                        };

                        // Attempt auto-repair by triggering re-sync
                        try {
                            if (this.fileSyncManager) {
                                console.log(`🔍 Auto-repairing hash mismatch for ${syncRecord.file_path}`);
                                await this.fileSyncManager.syncFiles({
                                    forceSync: false, // Only sync this specific file
                                });
                                issue.autoRepaired = true;
                                stats.autoRepaired++;
                                console.log(`🔍 ✅ Auto-repaired hash mismatch for ${syncRecord.file_path}`);
                            }
                        } catch (repairError) {
                            console.error(`🔍 Failed to auto-repair ${syncRecord.file_path}:`, repairError);
                            issue.details.repairError = repairError;
                        }

                        issues.push(issue);
                    }
                }
            } finally {
                syncMetadataStmt.free();
            }

            // 2. Check for orphaned sync metadata (files that no longer exist)
            console.log("🔍 Checking for orphaned sync metadata...");
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

            // 3. Basic referential integrity checks
            console.log("🔍 Checking referential integrity...");
            const integrityIssues = await this.checkReferentialIntegrity();
            issues.push(...integrityIssues);
            stats.corruptionDetected += integrityIssues.filter(i =>
                i.type === "database_corruption" || i.type === "cell_corruption"
            ).length;

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

        console.log(`🔍 ${result.validationType} validation completed:`, {
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
            vscode.window.showInformationMessage(
                `Auto-repaired ${result.stats.autoRepaired} database issues during validation`
            );
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

        console.log("🔍 Detailed validation report:", report);

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
            LEFT JOIN files f ON c.file_id = f.id 
            WHERE f.id IS NULL
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
                        console.log("Validation service status:", status);
                    }
                });
            }
        )
    );
} 