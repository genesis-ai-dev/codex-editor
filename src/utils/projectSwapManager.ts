import * as vscode from "vscode";
import { ProjectMetadata, ProjectSwapInfo, ProjectSwapEntry, ProjectSwapUserEntry } from "../../types";
import * as crypto from "crypto";
import git from "isomorphic-git";
import fs from "fs";

const DEBUG = false;
const debug = DEBUG ? (...args: any[]) => console.log("[ProjectSwap]", ...args) : () => { };

// ============ HELPER FUNCTIONS FOR ARRAY-BASED STRUCTURE ============

/**
 * Normalize ProjectSwapInfo - ensures the swapEntries array exists
 * @param swapInfo - Raw ProjectSwapInfo from metadata
 * @returns ProjectSwapInfo with swapEntries array guaranteed
 */
export function normalizeProjectSwapInfo(swapInfo: ProjectSwapInfo): ProjectSwapInfo {
    return {
        swapEntries: swapInfo.swapEntries || [],
    };
}

/**
 * Get the active swap entry from ProjectSwapInfo
 * Returns the entry with the latest swapInitiatedAt where swapStatus === "active"
 * @param swapInfo - Normalized ProjectSwapInfo
 * @returns Active swap entry or undefined if no active swap
 */
export function getActiveSwapEntry(swapInfo: ProjectSwapInfo): ProjectSwapEntry | undefined {
    const normalized = normalizeProjectSwapInfo(swapInfo);
    const entries = normalized.swapEntries || [];

    // Filter to active entries and sort by swapInitiatedAt descending
    const activeEntries = entries
        .filter(entry => entry.swapStatus === "active")
        .sort((a, b) => b.swapInitiatedAt - a.swapInitiatedAt);

    return activeEntries[0];
}

/**
 * Find a swap entry by its swapUUID (preferred method)
 * @param swapInfo - Normalized ProjectSwapInfo
 * @param swapUUID - The swapUUID to find
 * @returns Matching swap entry or undefined
 */
export function findSwapEntryByUUID(swapInfo: ProjectSwapInfo, swapUUID: string): ProjectSwapEntry | undefined {
    const normalized = normalizeProjectSwapInfo(swapInfo);
    const entries = normalized.swapEntries || [];

    return entries.find(entry => entry.swapUUID === swapUUID);
}

/**
 * Find a swap entry by its swapInitiatedAt timestamp
 * @deprecated Use findSwapEntryByUUID instead for more reliable matching
 * @param swapInfo - Normalized ProjectSwapInfo
 * @param timestamp - The swapInitiatedAt timestamp to find
 * @returns Matching swap entry or undefined
 */
export function findSwapEntryByTimestamp(swapInfo: ProjectSwapInfo, timestamp: number): ProjectSwapEntry | undefined {
    const normalized = normalizeProjectSwapInfo(swapInfo);
    const entries = normalized.swapEntries || [];

    return entries.find(entry => entry.swapInitiatedAt === timestamp);
}

/**
 * Get all swap entries, sorted by swapInitiatedAt descending (newest first)
 * @param swapInfo - ProjectSwapInfo (will be normalized)
 * @returns Array of swap entries
 */
export function getAllSwapEntries(swapInfo: ProjectSwapInfo): ProjectSwapEntry[] {
    const normalized = normalizeProjectSwapInfo(swapInfo);
    return (normalized.swapEntries || []).sort((a, b) => b.swapInitiatedAt - a.swapInitiatedAt);
}

/**
 * Check if there's an active (pending) swap that needs to be cancelled before initiating a new one
 * @param swapInfo - ProjectSwapInfo
 * @returns True if there's a pending swap that blocks new initiation
 */
export function hasPendingSwap(swapInfo: ProjectSwapInfo): boolean {
    return getActiveSwapEntry(swapInfo) !== undefined;
}

/**
 * Check if a project swap is required for the current project
 * Fetches remote metadata to get the latest swap status (similar to checkRemoteUpdatingRequired)
 * @param projectPath - Path to the project directory
 * @param currentUsername - Username of the current user (optional)
 * @param bypassCache - If true, bypass the remote metadata cache
 * @returns Object indicating if swap is required and details
 */
export async function checkProjectSwapRequired(
    projectPath: string,
    currentUsername?: string,
    bypassCache: boolean = false
): Promise<{
    required: boolean;
    reason: string;
    swapInfo?: ProjectSwapInfo;
    activeEntry?: ProjectSwapEntry;
    userAlreadySwapped?: boolean;
}> {
    try {
        debug("Checking project swap requirement for:", projectPath);

        let effectiveUsername = currentUsername;
        if (!effectiveUsername) {
            try {
                const { getCurrentUsername } = await import("./remoteUpdatingManager");
                effectiveUsername = (await getCurrentUsername()) ?? undefined;
            } catch {
                // non-fatal: continue without username
            }
        }

        // First, try to read local metadata to get git origin URL
        let metadata: ProjectMetadata | null = null;
        let gitOriginUrl: string | null = null;

        try {
            const metadataPath = vscode.Uri.file(`${projectPath}/metadata.json`);
            const metadataBuffer = await vscode.workspace.fs.readFile(metadataPath);
            metadata = JSON.parse(Buffer.from(metadataBuffer).toString("utf-8")) as ProjectMetadata;
        } catch {
            debug("Could not read local metadata.json");
        }

        // Get git origin URL to fetch remote metadata
        gitOriginUrl = await getGitOriginUrl(projectPath);

        // Import local swap file helpers
        const { readLocalProjectSwapFile, writeLocalProjectSwapFile } = await import("./localProjectSettings");
        const projectUri = vscode.Uri.file(projectPath);

        // Collect swap info from all sources - we check BOTH and use whichever has valid info
        let remoteSwapInfo: ProjectSwapInfo | undefined;
        let localSwapFileInfo: ProjectSwapInfo | undefined;
        const localMetadataSwapInfo: ProjectSwapInfo | undefined = metadata?.meta?.projectSwap as ProjectSwapInfo | undefined;

        // Try to fetch remote metadata for the latest swap status
        // Always check localProjectSwap.json FIRST - it may have local modifications (like cancellations)
        // that should take precedence over remote if they have a more recent timestamp
        try {
            const cachedSwapFile = await readLocalProjectSwapFile(projectUri);
            if (cachedSwapFile?.remoteSwapInfo) {
                // Verify the cached file is for the same origin (if we have one)
                if (!gitOriginUrl || cachedSwapFile.sourceOriginUrl === gitOriginUrl) {
                    localSwapFileInfo = cachedSwapFile.remoteSwapInfo;
                    debug("Found swap info in localProjectSwap.json (fetched at:", new Date(cachedSwapFile.fetchedAt).toISOString(), ")");
                }
            }
        } catch (e) {
            debug("Could not read cached swap file (non-fatal):", e);
        }

        if (gitOriginUrl) {
            try {
                const { fetchRemoteMetadata, extractProjectIdFromUrl } = await import("./remoteUpdatingManager");
                const projectId = extractProjectIdFromUrl(gitOriginUrl);
                if (projectId) {
                    const remoteMetadata = await fetchRemoteMetadata(projectId, !bypassCache);
                    if (remoteMetadata?.meta?.projectSwap) {
                        remoteSwapInfo = remoteMetadata.meta.projectSwap as ProjectSwapInfo;
                        debug("Fetched remote metadata for swap check");

                        // Only cache to localProjectSwap.json if this is an OLD project with active swaps
                        // On NEW projects (where user has already swapped), we don't need this cache
                        // because metadata.json has all the history and there's no pending swap
                        const remoteEntries = normalizeProjectSwapInfo(remoteSwapInfo).swapEntries || [];
                        const hasActiveOldProjectSwap = remoteEntries.some(
                            e => e.swapStatus === "active" && e.isOldProject === true
                        );

                        if (hasActiveOldProjectSwap) {
                            // Cache the remote swap info locally for offline use, but MERGE with existing local data
                            // to preserve local modifications (like cancellations with more recent timestamps)
                            // This creates .project/localProjectSwap.json which is gitignored
                            try {
                                const existingLocalEntries = localSwapFileInfo
                                    ? (normalizeProjectSwapInfo(localSwapFileInfo).swapEntries || [])
                                    : [];

                                // Build merged entries map - local entries first, then remote
                                // For matching swapUUID, keep the one with more recent swapModifiedAt
                                const mergedMap = new Map<string, ProjectSwapEntry>();
                                for (const entry of existingLocalEntries) {
                                    mergedMap.set(entry.swapUUID, entry);
                                }
                                for (const entry of remoteEntries) {
                                    const existing = mergedMap.get(entry.swapUUID);
                                    if (!existing) {
                                        mergedMap.set(entry.swapUUID, entry);
                                    } else {
                                        // Compare timestamps - keep the more recent one
                                        const existingModified = existing.swapModifiedAt ?? existing.swapInitiatedAt;
                                        const remoteModified = entry.swapModifiedAt ?? entry.swapInitiatedAt;
                                        if (remoteModified > existingModified) {
                                            mergedMap.set(entry.swapUUID, entry);
                                            debug(`Cache merge: using remote entry (modified ${remoteModified}) over local (modified ${existingModified})`);
                                        } else {
                                            debug(`Cache merge: keeping local entry (modified ${existingModified}) over remote (modified ${remoteModified})`);
                                        }
                                    }
                                }

                                const mergedSwapInfo: ProjectSwapInfo = {
                                    swapEntries: Array.from(mergedMap.values()),
                                };

                                await writeLocalProjectSwapFile({
                                    remoteSwapInfo: mergedSwapInfo,
                                    fetchedAt: Date.now(),
                                    sourceOriginUrl: sanitizeGitUrl(gitOriginUrl),
                                }, projectUri);
                                debug("Cached merged swap info to localProjectSwap.json (OLD project with active swap)");

                                // Update localSwapFileInfo with the merged data for later comparison
                                localSwapFileInfo = mergedSwapInfo;
                            } catch (cacheError) {
                                debug("Failed to cache remote swap info (non-fatal):", cacheError);
                            }
                        } else {
                            debug("Skipping localProjectSwap.json cache - no active swap for OLD project");
                            // Update localSwapFileInfo for later comparison even without caching
                            localSwapFileInfo = { swapEntries: remoteEntries };
                        }
                    }
                }
            } catch (e) {
                debug("Could not fetch remote metadata (non-fatal):", e);
            }
        }

        // Determine which swap info to use by MERGING entries and comparing swapModifiedAt timestamps
        // This ensures that if local has a more recent cancellation, it takes precedence over remote's active status
        // Key insight: For the SAME swap entry (matched by swapUUID), use the version with
        // the most recent swapModifiedAt timestamp

        // Collect all entries from all sources (ensure arrays are never undefined)
        const remoteEntries = remoteSwapInfo ? (normalizeProjectSwapInfo(remoteSwapInfo).swapEntries || []) : [];
        const localSwapEntries = localSwapFileInfo ? (normalizeProjectSwapInfo(localSwapFileInfo).swapEntries || []) : [];
        const localMetadataEntries = localMetadataSwapInfo ? (normalizeProjectSwapInfo(localMetadataSwapInfo).swapEntries || []) : [];

        // Merge entries by swapUUID, keeping the one with the most recent swapModifiedAt
        const mergedEntriesMap = new Map<string, ProjectSwapEntry>();

        const addOrUpdateEntry = (entry: ProjectSwapEntry) => {
            const key = entry.swapUUID;
            const existing = mergedEntriesMap.get(key);
            if (!existing) {
                mergedEntriesMap.set(key, entry);
            } else {
                // Compare swapModifiedAt timestamps - use the more recent one
                const existingModified = existing.swapModifiedAt ?? existing.swapInitiatedAt;
                const newModified = entry.swapModifiedAt ?? entry.swapInitiatedAt;
                if (newModified > existingModified) {
                    mergedEntriesMap.set(key, entry);
                    debug(`Entry ${key}: using version with swapModifiedAt ${newModified} (status: ${entry.swapStatus}) over ${existingModified} (status: ${existing.swapStatus})`);
                }
            }
        };

        // Add entries from all sources - local metadata first, then localSwapFile, then remote
        // This order means that if timestamps are equal, remote would be last processed,
        // but since we're comparing timestamps, the order doesn't matter for different timestamps
        for (const entry of localMetadataEntries) {
            addOrUpdateEntry(entry);
        }
        for (const entry of localSwapEntries) {
            addOrUpdateEntry(entry);
        }
        for (const entry of remoteEntries) {
            addOrUpdateEntry(entry);
        }

        // Build the effective swap info from merged entries
        const mergedEntries = Array.from(mergedEntriesMap.values());
        const effectiveSwapInfo: ProjectSwapInfo | undefined = mergedEntries.length > 0
            ? { swapEntries: mergedEntries }
            : (remoteSwapInfo || localSwapFileInfo || localMetadataSwapInfo);

        if (mergedEntries.length > 0) {
            debug(`Merged ${mergedEntries.length} swap entries from all sources`);
        }

        if (!effectiveSwapInfo) {
            debug("No project swap information found");
            return { required: false, reason: "No swap configured" };
        }

        // Normalize to new array format
        const swapInfo = normalizeProjectSwapInfo(effectiveSwapInfo);

        // Find the active swap entry
        const activeEntry = getActiveSwapEntry(swapInfo);

        if (!activeEntry) {
            debug("No active swap entry found");
            return { required: false, reason: "No active swap", swapInfo };
        }

        // Only OLD projects (isOldProject: true in the entry) can trigger swap requirements
        if (!activeEntry.isOldProject) {
            debug("This is the NEW project (destination) - no swap required");
            return { required: false, reason: "This is the destination project", swapInfo };
        }

        // Check if user has already completed this swap
        if (effectiveUsername) {
            const hasCompleted = await hasUserCompletedSwap(swapInfo, activeEntry, effectiveUsername);
            if (hasCompleted) {
                debug("User already swapped; no swap required");
                return {
                    required: false,
                    reason: "User already swapped",
                    swapInfo,
                    activeEntry,
                    userAlreadySwapped: true,
                };
            }
        }

        // This is an OLD project with an active swap - user needs to swap
        debug("Project swap required - old project with active swap entry");
        return {
            required: true,
            reason: "Project has been swapped to a new repository",
            swapInfo,
            activeEntry,
        };
    } catch (error) {
        debug("Error checking project swap requirement:", error);
        return { required: false, reason: `Error: ${error}` };
    }
}

async function hasUserCompletedSwap(
    swapInfo: ProjectSwapInfo,
    activeEntry: ProjectSwapEntry,
    currentUsername: string
): Promise<boolean> {
    const entries = await getSwapUserEntries(swapInfo, activeEntry);
    return entries.some(
        (entry) => entry.userToSwap === currentUsername && entry.executed
    );
}

/**
 * Get the swappedUsers entries for a specific swap entry
 * Checks both local metadata and remote (NEW project) for up-to-date user completion status
 */
async function getSwapUserEntries(swapInfo: ProjectSwapInfo, activeEntry: ProjectSwapEntry): Promise<ProjectSwapUserEntry[]> {
    const { fetchRemoteMetadata, extractProjectIdFromUrl, normalizeSwapUserEntry } = await import("./remoteUpdatingManager");

    // Try to get from remote (NEW project) first - it has the most up-to-date swappedUsers list
    const newProjectUrl = activeEntry.newProjectUrl;
    if (newProjectUrl) {
        const projectId = extractProjectIdFromUrl(newProjectUrl);
        if (projectId) {
            try {
                const remoteMetadata = await fetchRemoteMetadata(projectId, false);
                const remoteSwap = remoteMetadata?.meta?.projectSwap;
                if (remoteSwap) {
                    // Normalize and find matching entry by swapUUID
                    const normalizedRemote = normalizeProjectSwapInfo(remoteSwap);
                    const matchingEntry = findSwapEntryByUUID(normalizedRemote, activeEntry.swapUUID);
                    if (matchingEntry?.swappedUsers && matchingEntry.swappedUsers.length > 0) {
                        return matchingEntry.swappedUsers.map((entry: ProjectSwapUserEntry) =>
                            normalizeSwapUserEntry(entry)
                        );
                    }
                }
            } catch (e) {
                debug("Could not fetch remote metadata for swap user check:", e);
            }
        }
    }

    // Fallback to local entry's swappedUsers
    return (activeEntry.swappedUsers || []).map((entry: ProjectSwapUserEntry) =>
        normalizeSwapUserEntry(entry)
    );
}

/**
 * Validate a Git repository URL
 * @param gitUrl - Git repository URL to validate
 * @returns Object with validation result and error message if invalid
 */
export async function validateGitUrl(gitUrl: string): Promise<{
    valid: boolean;
    error?: string;
}> {
    try {
        // Basic URL format check
        if (!gitUrl || typeof gitUrl !== "string") {
            return { valid: false, error: "Git URL is required" };
        }

        // Check if it looks like a valid git URL
        const gitUrlPattern = /^(https?:\/\/|git@)[\w.-]+(:\d+)?(\/|:)[\w./-]+\.git$/i;
        if (!gitUrlPattern.test(gitUrl)) {
            return { valid: false, error: "Invalid Git URL format. Must end with .git" };
        }

        // Format is valid - skip remote validation
        // The actual clone operation will fail with a proper error if the URL is inaccessible
        // This avoids authentication complexity during the validation step
        debug("Git URL format validated:", gitUrl);
        return { valid: true };
    } catch (error) {
        debug("Error in validateGitUrl:", error);
        return {
            valid: false,
            error: `Validation error: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

/**
 * Generate a unique UUID for tracking project swaps
 * Uses crypto.randomUUID() for a standard UUID v4
 * @returns UUID string
 */
export function generateProjectUUID(): string {
    return crypto.randomUUID();
}

/**
 * Get the current Git origin URL for a project
 * @param projectPath - Path to the project directory
 * @returns Git origin URL or null if not found
 */
export async function getGitOriginUrl(projectPath: string): Promise<string | null> {
    try {
        const remotes = await git.listRemotes({ fs, dir: projectPath });
        const origin = remotes.find((r) => r.remote === "origin");
        return origin?.url || null;
    } catch (error) {
        debug("Error getting git origin URL:", error);
        return null;
    }
}

/**
 * Sanitize a Git URL by removing embedded credentials (username/password/token)
 * This is important for storing URLs in metadata files that may be synced or shared.
 * @param url - Git URL that may contain embedded credentials
 * @returns Sanitized URL without credentials, or original URL if parsing fails
 */
export function sanitizeGitUrl(url: string): string {
    if (!url) return url;
    try {
        const urlObj = new URL(url);
        urlObj.username = "";
        urlObj.password = "";
        // Remove trailing slash for consistency
        return urlObj.toString().replace(/\/$/, "");
    } catch {
        // If URL parsing fails, return original (might be a git@ style URL)
        return url;
    }
}

/**
 * Update the Git origin URL for a project
 * @param projectPath - Path to the project directory
 * @param newUrl - New Git origin URL
 */
export async function updateGitOriginUrl(projectPath: string, newUrl: string): Promise<void> {
    try {
        // Remove old origin
        await git.deleteRemote({ fs, dir: projectPath, remote: "origin" });

        // Add new origin
        await git.addRemote({
            fs,
            dir: projectPath,
            remote: "origin",
            url: newUrl,
        });

        debug("Updated git origin URL to:", newUrl);
    } catch (error) {
        debug("Error updating git origin URL:", error);
        throw new Error(`Failed to update git remote: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Extract project name from Git URL
 * @param gitUrl - Git repository URL
 * @returns Project name
 */
export function extractProjectNameFromUrl(gitUrl: string): string {
    try {
        // Extract from URL like: https://gitlab.com/group/project.git → project
        const match = gitUrl.match(/([^/]+)\.git$/);
        if (match) {
            return match[1];
        }

        // Fallback: just take the last part
        const parts = gitUrl.split("/");
        const lastPart = parts[parts.length - 1];
        return lastPart.replace(".git", "");
    } catch {
        return "unknown-project";
    }
}
