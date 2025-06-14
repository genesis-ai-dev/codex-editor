/**
 * Repository Migration System
 * 
 * Handles the migration of projects that need to clean up SQLite files from git history.
 * This system ensures data safety through multiple verification layers and provides
 * comprehensive error handling and recovery mechanisms.
 */

import * as vscode from "vscode";
import git from "isomorphic-git";
import fs from "fs";
import * as path from "path";
import { getAuthApi } from "../../extension";
import { ProjectWithSyncStatus } from "../../../types";

const MIGRATION_FLAG_FILE = ".codex/migration_complete";
const MIGRATION_SUPPRESSION_FLAG = ".codex/migration_suppressed";
const USER_MIGRATION_FLAG_PREFIX = ".codex/user_migration_";
const SQLITE_FILES_PATTERN = /\.project\/(complete_drafts|dictionary|indexes)\.sqlite$/;

export interface MigrationState {
    hasMigrationFlag: boolean;
    hasUserMigrationFlag: boolean;
    hasSuppression: boolean;
    hasUncommittedChanges: boolean;
    hasUncommittedNonSQLiteChanges: boolean;
    canSafelyDelete: boolean;
    remoteVerified: boolean;
    openFiles: string[];
    isFreshClone: boolean;
    currentUser?: string;
    error?: string;
}

export interface MigrationProgress {
    stage: 'checking' | 'staging' | 'committing' | 'verifying' | 'deleting' | 'cloning' | 'complete';
    message: string;
    increment: number;
}

export class RepositoryMigrationManager {
    private static instance: RepositoryMigrationManager;

    public static getInstance(): RepositoryMigrationManager {
        if (!RepositoryMigrationManager.instance) {
            RepositoryMigrationManager.instance = new RepositoryMigrationManager();
        }
        return RepositoryMigrationManager.instance;
    }

    /**
     * Get current user identifier for user-specific migration flags
     */
    private async getCurrentUser(): Promise<string> {
        try {
            const authApi = getAuthApi();
            const userInfo = await authApi?.getUserInfo();

            if (userInfo?.username) {
                return userInfo.username;
            }

            // Fallback to VSCode configuration
            const userName = vscode.workspace.getConfiguration("codex-project-manager").get<string>("userName");
            if (userName) {
                return userName;
            }

            // Last resort fallback
            return "default_user";
        } catch (error) {
            console.warn("Failed to get current user, using default:", error);
            return "default_user";
        }
    }

    /**
     * Check if project was recently cloned (within last 24 hours)
     */
    private async isFreshlyCloned(projectPath: string): Promise<boolean> {
        try {
            const gitDir = path.join(projectPath, ".git");
            const gitStats = await fs.promises.stat(gitDir);

            // If .git directory was created within the last 24 hours, consider it a fresh clone
            const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
            return gitStats.birthtime.getTime() > twentyFourHoursAgo;
        } catch (error) {
            // If we can't determine, assume it's not fresh
            return false;
        }
    }

    /**
     * Check if a project requires migration and assess its current state
     */
    async checkMigrationRequired(projectPath: string): Promise<MigrationState> {
        const state: MigrationState = {
            hasMigrationFlag: false,
            hasUserMigrationFlag: false,
            hasSuppression: false,
            hasUncommittedChanges: false,
            hasUncommittedNonSQLiteChanges: false,
            canSafelyDelete: false,
            remoteVerified: false,
            openFiles: [],
            isFreshClone: false
        };

        try {
            // Get current user
            const currentUser = await this.getCurrentUser();
            state.currentUser = currentUser;

            // Check if project was freshly cloned
            state.isFreshClone = await this.isFreshlyCloned(projectPath);
            if (state.isFreshClone) {
                // Fresh clones don't need migration
                return state;
            }

            // Check for global migration flag (legacy)
            const flagPath = path.join(projectPath, MIGRATION_FLAG_FILE);
            try {
                await fs.promises.access(flagPath);
                state.hasMigrationFlag = true;
            } catch {
                // Flag doesn't exist
            }

            // Check for user-specific migration flag
            const userFlagPath = path.join(projectPath, `${USER_MIGRATION_FLAG_PREFIX}${currentUser}`);
            try {
                await fs.promises.access(userFlagPath);
                state.hasUserMigrationFlag = true;
                return state; // User already migrated
            } catch {
                // User flag doesn't exist, continue checking
            }

            // Check for suppression flag
            const suppressionPath = path.join(projectPath, MIGRATION_SUPPRESSION_FLAG);
            try {
                await fs.promises.access(suppressionPath);
                state.hasSuppression = true;
                return state; // User chose not to migrate
            } catch {
                // Suppression flag doesn't exist, continue checking
            }

            // Check git status
            const status = await git.statusMatrix({ fs, dir: projectPath });
            const uncommittedFiles: string[] = [];
            const uncommittedNonSQLiteFiles: string[] = [];

            for (const [filepath, head, workdir, stage] of status) {
                if (workdir !== head || stage !== head) {
                    uncommittedFiles.push(filepath);

                    // Check if it's not a SQLite file we want to exclude
                    if (!SQLITE_FILES_PATTERN.test(filepath)) {
                        uncommittedNonSQLiteFiles.push(filepath);
                    }
                }
            }

            state.hasUncommittedChanges = uncommittedFiles.length > 0;
            state.hasUncommittedNonSQLiteChanges = uncommittedNonSQLiteFiles.length > 0;

            // Check for open files in VSCode
            const openDocuments = vscode.workspace.textDocuments;
            state.openFiles = openDocuments
                .filter(doc => doc.uri.fsPath.startsWith(projectPath))
                .map(doc => doc.uri.fsPath);

            // Verify remote connectivity
            try {
                const remotes = await git.listRemotes({ fs, dir: projectPath });
                state.remoteVerified = remotes.length > 0;
            } catch (error) {
                state.error = `Failed to verify remote: ${error}`;
                return state;
            }

            // Determine if we can safely delete
            state.canSafelyDelete = !state.hasUncommittedNonSQLiteChanges &&
                state.openFiles.length === 0 &&
                state.remoteVerified;

        } catch (error) {
            state.error = `Migration check failed: ${error instanceof Error ? error.message : String(error)}`;
        }

        return state;
    }

    /**
     * Stage and commit only non-SQLite changes
     */
    async stageAndCommitNonSQLiteChanges(
        projectPath: string,
        progress?: vscode.Progress<{ message?: string; increment?: number; }>
    ): Promise<void> {
        progress?.report({ message: "Checking for changes to commit...", increment: 10 });

        const status = await git.statusMatrix({ fs, dir: projectPath });
        const filesToStage: string[] = [];

        // Identify files to stage (excluding SQLite files)
        for (const [filepath, head, workdir, stage] of status) {
            if ((workdir !== head || stage !== head) && !SQLITE_FILES_PATTERN.test(filepath)) {
                filesToStage.push(filepath);
            }
        }

        if (filesToStage.length === 0) {
            progress?.report({ message: "No changes to commit", increment: 50 });
            return;
        }

        progress?.report({ message: `Staging ${filesToStage.length} files...`, increment: 20 });

        // Stage files
        for (const filepath of filesToStage) {
            await git.add({ fs, dir: projectPath, filepath });
        }

        progress?.report({ message: "Committing changes...", increment: 30 });

        // Get author info
        const authApi = getAuthApi();
        const userInfo = await authApi?.getUserInfo();
        const author = {
            name: userInfo?.username ||
                vscode.workspace.getConfiguration("codex-project-manager").get<string>("userName") ||
                "Unknown",
            email: userInfo?.email ||
                vscode.workspace.getConfiguration("codex-project-manager").get<string>("userEmail") ||
                "unknown@example.com"
        };

        // Commit changes
        await git.commit({
            fs,
            dir: projectPath,
            message: "Pre-migration commit: Save uncommitted changes",
            author
        });

        progress?.report({ message: "Changes committed successfully", increment: 40 });
    }

    /**
     * Verify that changes have been successfully synced to remote
     */
    async verifyRemoteSync(projectPath: string): Promise<{
        isVerified: boolean;
        hasUnpushedCommits: boolean;
        hasRemote: boolean;
        warning?: string;
    }> {
        try {
            // Get list of remotes
            const remotes = await git.listRemotes({ fs, dir: projectPath });
            if (remotes.length === 0) {
                return {
                    isVerified: true,
                    hasUnpushedCommits: false,
                    hasRemote: false,
                    warning: "No remotes found - local-only project"
                };
            }

            // Get current branch
            const currentBranch = await git.currentBranch({ fs, dir: projectPath });
            if (!currentBranch) {
                return {
                    isVerified: false,
                    hasUnpushedCommits: false,
                    hasRemote: true,
                    warning: "Could not determine current branch"
                };
            }

            // Check if we have any commits that aren't pushed
            try {
                // Get local commits
                const localCommits = await git.log({
                    fs,
                    dir: projectPath,
                    ref: currentBranch,
                    depth: 10 // Check last 10 commits
                });

                // Get remote commits (if remote branch exists)
                const remoteBranch = `origin/${currentBranch}`;
                let remoteCommits: any[] = [];

                try {
                    remoteCommits = await git.log({
                        fs,
                        dir: projectPath,
                        ref: remoteBranch,
                        depth: 10
                    });
                } catch (error) {
                    // Remote branch might not exist, which is okay for new branches
                    return {
                        isVerified: true,
                        hasUnpushedCommits: false,
                        hasRemote: true,
                        warning: `Remote branch ${remoteBranch} not found - might be a new branch`
                    };
                }

                // Check if local HEAD is ahead of remote HEAD
                if (localCommits.length > 0 && remoteCommits.length > 0) {
                    const localHead = localCommits[0].oid;
                    const remoteHead = remoteCommits[0].oid;

                    if (localHead !== remoteHead) {
                        // Check if local head is in remote commits (we might be behind)
                        const localHeadInRemote = remoteCommits.some(commit => commit.oid === localHead);
                        if (!localHeadInRemote) {
                            // Check if remote head is in local commits (we might be ahead)
                            const remoteHeadInLocal = localCommits.some(commit => commit.oid === remoteHead);
                            if (remoteHeadInLocal) {
                                // We're ahead of remote
                                return {
                                    isVerified: false,
                                    hasUnpushedCommits: true,
                                    hasRemote: true,
                                    warning: "Local commits detected that haven't been pushed to remote"
                                };
                            } else {
                                // Branches have diverged
                                return {
                                    isVerified: false,
                                    hasUnpushedCommits: true,
                                    hasRemote: true,
                                    warning: "Local and remote branches have diverged"
                                };
                            }
                        }
                    }
                }

                return {
                    isVerified: true,
                    hasUnpushedCommits: false,
                    hasRemote: true
                };

            } catch (error) {
                return {
                    isVerified: false,
                    hasUnpushedCommits: false,
                    hasRemote: true,
                    warning: `Could not verify commit sync status: ${error}`
                };
            }

        } catch (error) {
            return {
                isVerified: false,
                hasUnpushedCommits: false,
                hasRemote: false,
                warning: `Remote sync verification failed: ${error}`
            };
        }
    }

    /**
     * Close all open files for the project
     */
    async closeProjectFiles(projectPath: string): Promise<void> {
        const openDocuments = vscode.workspace.textDocuments;
        const projectDocuments = openDocuments.filter(doc =>
            doc.uri.fsPath.startsWith(projectPath)
        );

        for (const doc of projectDocuments) {
            await vscode.window.showTextDocument(doc);
            await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
        }
    }

    /**
     * Create user-specific migration flag to prevent repeated migrations for this user
     */
    async createUserMigrationFlag(projectPath: string): Promise<void> {
        const currentUser = await this.getCurrentUser();
        const flagPath = path.join(projectPath, `${USER_MIGRATION_FLAG_PREFIX}${currentUser}`);
        const flagDir = path.dirname(flagPath);

        // Ensure .codex directory exists
        try {
            await fs.promises.mkdir(flagDir, { recursive: true });
        } catch (error) {
            // Directory might already exist
        }

        const flagContent = {
            migrationDate: new Date().toISOString(),
            version: "1.0.0",
            reason: "SQLite files cleanup migration",
            user: currentUser
        };

        await fs.promises.writeFile(flagPath, JSON.stringify(flagContent, null, 2));
    }

    /**
     * Create global migration flag (legacy method for backward compatibility)
     */
    async createMigrationFlag(projectPath: string): Promise<void> {
        const flagPath = path.join(projectPath, MIGRATION_FLAG_FILE);
        const flagDir = path.dirname(flagPath);

        // Ensure .codex directory exists
        try {
            await fs.promises.mkdir(flagDir, { recursive: true });
        } catch (error) {
            // Directory might already exist
        }

        const flagContent = {
            migrationDate: new Date().toISOString(),
            version: "1.0.0",
            reason: "SQLite files cleanup migration"
        };

        await fs.promises.writeFile(flagPath, JSON.stringify(flagContent, null, 2));
    }

    /**
     * Perform the complete migration process
     */
    async performMigration(
        project: ProjectWithSyncStatus,
        progress: vscode.Progress<{ message?: string; increment?: number; }>,
        token: vscode.CancellationToken
    ): Promise<void> {
        if (!project.path) {
            throw new Error("Project path is required for migration");
        }

        const projectPath = project.path;
        let currentProgress = 0;

        try {
            // Stage 1: Pre-migration checks
            progress.report({ message: "Performing pre-migration checks...", increment: 5 });
            if (token.isCancellationRequested) {
                throw new Error("Operation was cancelled");
            }

            const migrationState = await this.checkMigrationRequired(projectPath);
            if (migrationState.hasMigrationFlag) {
                throw new Error("Project has already been migrated");
            }

            if (migrationState.error) {
                throw new Error(migrationState.error);
            }

            // Stage 2: Close open files
            if (migrationState.openFiles.length > 0) {
                progress.report({ message: "Closing open project files...", increment: 5 });
                await this.closeProjectFiles(projectPath);
                if (token.isCancellationRequested) {
                    throw new Error("Operation was cancelled");
                }
            }

            // Stage 3: Stage and commit non-SQLite changes
            if (migrationState.hasUncommittedNonSQLiteChanges) {
                progress.report({ message: "Committing uncommitted changes...", increment: 10 });
                await this.stageAndCommitNonSQLiteChanges(projectPath, progress);
                if (token.isCancellationRequested) {
                    throw new Error("Operation was cancelled");
                }
            }

            // Stage 4: Verify remote sync (optional based on configuration)
            const skipSyncVerification = vscode.workspace.getConfiguration("codex-project-manager").get<boolean>("migration.skipSyncVerification", false);

            if (!skipSyncVerification) {
                progress.report({ message: "Verifying remote synchronization...", increment: 15 });
                const syncVerified = await this.verifyRemoteSync(projectPath);
                if (!syncVerified.isVerified) {
                    // Instead of failing completely, warn the user and ask for confirmation
                    let warningMessage = "Could not verify that all changes are synced to remote. This might mean some local changes could be lost during migration.";

                    if (syncVerified.warning) {
                        warningMessage += `\n\nDetails: ${syncVerified.warning}`;
                    }

                    if (syncVerified.hasUnpushedCommits) {
                        warningMessage += "\n\nYou have unpushed commits that will be lost if you continue.";
                    }

                    warningMessage += "\n\nDo you want to continue with migration anyway?";

                    const choice = await vscode.window.showWarningMessage(
                        warningMessage,
                        { modal: true },
                        "Continue Migration",
                        "Cancel Migration",
                        "Skip Sync Check"
                    );

                    if (choice === "Cancel Migration") {
                        throw new Error("Migration cancelled by user due to sync verification failure");
                    } else if (choice === "Skip Sync Check") {
                        // Update configuration to skip sync verification in the future
                        await vscode.workspace.getConfiguration("codex-project-manager").update("migration.skipSyncVerification", true, vscode.ConfigurationTarget.Global);
                        vscode.window.showInformationMessage("Sync verification will be skipped for future migrations. You can re-enable it in settings.");
                    }
                }
            } else {
                progress.report({ message: "Skipping sync verification (disabled in settings)...", increment: 15 });
            }

            if (token.isCancellationRequested) {
                throw new Error("Operation was cancelled");
            }

            // Stage 5: Delete local project
            progress.report({ message: "Deleting local project...", increment: 20 });
            const projectUri = vscode.Uri.file(projectPath);
            await vscode.workspace.fs.delete(projectUri, { recursive: true });
            if (token.isCancellationRequested) {
                throw new Error("Operation was cancelled");
            }

            // Stage 6: Reclone project
            progress.report({ message: "Recloning project from remote...", increment: 30 });

            if (!project.gitOriginUrl) {
                throw new Error("Git origin URL is required for recloning");
            }

            // Use the existing cloning mechanism
            const authApi = getAuthApi();
            if (!authApi) {
                throw new Error("Authentication API not available for cloning");
            }

            // Clone the repository back
            await this.cloneRepository(project.gitOriginUrl, projectPath, progress, token);

            // Stage 7: Create migration flag
            progress.report({ message: "Finalizing migration...", increment: 10 });
            await this.createUserMigrationFlag(projectPath);
            if (token.isCancellationRequested) {
                throw new Error("Operation was cancelled");
            }

            progress.report({ message: "Migration completed successfully!", increment: 5 });

        } catch (error) {
            // If we get here, we need to handle the error gracefully
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error("Migration failed:", errorMessage);
            throw new Error(`Migration failed: ${errorMessage}`);
        }
    }

    /**
     * Clone repository with progress reporting
     */
    private async cloneRepository(
        repoUrl: string,
        targetPath: string,
        progress: vscode.Progress<{ message?: string; increment?: number; }>,
        token: vscode.CancellationToken
    ): Promise<void> {
        // Ensure parent directory exists
        const parentDir = path.dirname(targetPath);
        await fs.promises.mkdir(parentDir, { recursive: true });

        const authApi = getAuthApi();
        if (!authApi) {
            throw new Error("Authentication API not available");
        }

        // Check if cloneRepository method exists on authApi
        if (typeof authApi.cloneRepository !== 'function') {
            // Fallback to direct git clone using isomorphic-git
            await this.fallbackCloneRepository(repoUrl, targetPath, progress, token);
            return;
        }

        // Use the existing FrontierAPI cloning mechanism
        // This handles authentication and progress properly
        try {
            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error("Clone operation timed out"));
                }, 300000); // 5 minute timeout

                // Monitor cancellation
                const checkCancellation = setInterval(() => {
                    if (token.isCancellationRequested) {
                        clearTimeout(timeout);
                        clearInterval(checkCancellation);
                        reject(new Error("Clone operation was cancelled"));
                    }
                }, 1000);

                // Start the clone operation
                authApi.cloneRepository!(repoUrl, targetPath)
                    .then(() => {
                        clearTimeout(timeout);
                        clearInterval(checkCancellation);
                        resolve();
                    })
                    .catch((error) => {
                        clearTimeout(timeout);
                        clearInterval(checkCancellation);
                        reject(error);
                    });
            });
        } catch (error) {
            throw new Error(`Failed to clone repository: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Fallback clone method using isomorphic-git directly
     */
    private async fallbackCloneRepository(
        repoUrl: string,
        targetPath: string,
        progress: vscode.Progress<{ message?: string; increment?: number; }>,
        token: vscode.CancellationToken
    ): Promise<void> {
        try {
            const authApi = getAuthApi();
            const userInfo = await authApi?.getUserInfo();

            // Get authentication token if available
            let auth: any = undefined;
            if (userInfo && 'token' in userInfo) {
                auth = {
                    username: userInfo.token,
                    password: 'x-oauth-basic'
                };
            }

            await git.clone({
                fs,
                http: require('isomorphic-git/http/web'),
                dir: targetPath,
                url: repoUrl,
                onProgress: (progressEvent) => {
                    if (token.isCancellationRequested) {
                        throw new Error("Clone operation was cancelled");
                    }

                    if (progressEvent.phase === 'Receiving objects') {
                        const percent = Math.round((progressEvent.loaded / progressEvent.total) * 100);
                        progress.report({
                            message: `Cloning: ${progressEvent.phase} (${percent}%)`,
                            increment: 0
                        });
                    }
                }
            });
        } catch (error) {
            throw new Error(`Fallback clone failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Static method to check if a project needs migration WITHOUT opening it
     * This is used before project opening to determine if migration is needed
     */
    static async checkProjectNeedsMigrationStatic(projectPath: string): Promise<{
        needsMigration: boolean;
        hasMigrationFlag: boolean;
        hasUserMigrationFlag: boolean;
        hasSuppression: boolean;
        hasRemote: boolean;
        isFreshClone: boolean;
        currentUser?: string;
        error?: string;
    }> {
        const result = {
            needsMigration: false,
            hasMigrationFlag: false,
            hasUserMigrationFlag: false,
            hasSuppression: false,
            hasRemote: false,
            isFreshClone: false,
            currentUser: undefined as string | undefined,
            error: undefined as string | undefined
        };

        try {
            // Get current user
            const authApi = getAuthApi();
            const userInfo = await authApi?.getUserInfo();
            const currentUser = userInfo?.username ||
                vscode.workspace.getConfiguration("codex-project-manager").get<string>("userName") ||
                "default_user";
            result.currentUser = currentUser;

            // Check if project was freshly cloned
            try {
                const gitDir = path.join(projectPath, ".git");
                const gitStats = await fs.promises.stat(gitDir);
                const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
                result.isFreshClone = gitStats.birthtime.getTime() > twentyFourHoursAgo;

                if (result.isFreshClone) {
                    // Fresh clones don't need migration
                    return result;
                }
            } catch {
                // If we can't check, assume not fresh
            }

            // Check for global migration flag (legacy)
            const flagPath = path.join(projectPath, MIGRATION_FLAG_FILE);
            try {
                await fs.promises.access(flagPath);
                result.hasMigrationFlag = true;
            } catch {
                // Flag doesn't exist
            }

            // Check for user-specific migration flag
            const userFlagPath = path.join(projectPath, `${USER_MIGRATION_FLAG_PREFIX}${currentUser}`);
            try {
                await fs.promises.access(userFlagPath);
                result.hasUserMigrationFlag = true;
                return result; // User already migrated
            } catch {
                // User flag doesn't exist, continue checking
            }

            // Check for suppression flag
            const suppressionPath = path.join(projectPath, MIGRATION_SUPPRESSION_FLAG);
            try {
                await fs.promises.access(suppressionPath);
                result.hasSuppression = true;
                return result; // User chose not to migrate
            } catch {
                // Suppression flag doesn't exist, continue checking
            }

            // Check if it's a git repository with remote
            try {
                const remotes = await git.listRemotes({ fs, dir: projectPath });
                result.hasRemote = remotes.length > 0;

                if (result.hasRemote) {
                    // Only mark as needing migration if it has a remote and no user flag
                    result.needsMigration = true;
                }
            } catch (error) {
                result.error = `Failed to check git status: ${error}`;
            }

        } catch (error) {
            result.error = `Migration check failed: ${error instanceof Error ? error.message : String(error)}`;
        }

        return result;
    }

    /**
     * Check if any projects in a list need migration (used by project lists)
     */
    static async checkProjectsForMigrationNeeds(projects: Array<{ path: string; gitOriginUrl?: string; }>): Promise<Map<string, boolean>> {
        const migrationNeeds = new Map<string, boolean>();

        // Process projects in parallel for better performance
        const checks = projects.map(async (project) => {
            if (!project.gitOriginUrl) {
                // Local-only projects don't need migration
                migrationNeeds.set(project.path, false);
                return;
            }

            try {
                const migrationCheck = await RepositoryMigrationManager.checkProjectNeedsMigrationStatic(project.path);
                migrationNeeds.set(project.path, migrationCheck.needsMigration);
            } catch (error) {
                console.warn(`Failed to check migration status for ${project.path}:`, error);
                migrationNeeds.set(project.path, false);
            }
        });

        await Promise.all(checks);
        return migrationNeeds;
    }

    /**
     * Check if any projects in the workspace need migration
     */
    async checkWorkspaceForMigrationNeeds(): Promise<string[]> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return [];
        }

        const projectsNeedingMigration: string[] = [];

        try {
            const migrationCheck = await RepositoryMigrationManager.checkProjectNeedsMigrationStatic(workspaceFolder.uri.fsPath);
            if (migrationCheck.needsMigration) {
                projectsNeedingMigration.push(workspaceFolder.uri.fsPath);
            }
        } catch (error) {
            console.error("Error checking workspace for migration needs:", error);
        }

        return projectsNeedingMigration;
    }
} 