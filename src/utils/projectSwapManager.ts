import * as vscode from "vscode";
import { ProjectMetadata, ProjectSwapInfo, ProjectSwapEntry, ProjectSwapUserEntry } from "../../types";
import * as crypto from "crypto";
import git from "isomorphic-git";
import fs from "fs";

const DEBUG = false;
const debug = DEBUG ? (...args: any[]) => console.log("[ProjectSwap]", ...args) : () => { };

// ============ HELPER FUNCTIONS FOR ARRAY-BASED STRUCTURE ============

/**
 * Merge swappedUsers arrays from two entries.
 * Uses userToSwap as unique key, keeps the one with more recent updatedAt.
 * This ensures user completion data is preserved even when entry-level timestamps match.
 */
/**
 * Generate a unique key for a user entry.
 * Users are uniquely identified by BOTH userToSwap AND createdAt together.
 * This allows the same user to have multiple swap entries if they re-swap.
 */
function getUserKey(user: ProjectSwapUserEntry): string {
    return `${user.userToSwap}::${user.createdAt}`;
}

/**
 * Merge two swappedUsers arrays, preserving all unique user entries.
 * 
 * Uniqueness is determined by userToSwap + createdAt (both together).
 * For the same unique key, the entry with newer updatedAt wins.
 * 
 * @param usersA - First array of user entries
 * @param usersB - Second array of user entries
 * @returns Merged array with all unique users, preferring newer updatedAt
 */
export function mergeSwappedUsers(
    usersA: ProjectSwapUserEntry[] | undefined,
    usersB: ProjectSwapUserEntry[] | undefined
): ProjectSwapUserEntry[] {
    const userMap = new Map<string, ProjectSwapUserEntry>();

    // Add all users from first array
    for (const user of usersA || []) {
        const key = getUserKey(user);
        userMap.set(key, user);
    }

    // Add/update from second array - keep newer updatedAt for same unique key
    for (const user of usersB || []) {
        const key = getUserKey(user);
        const existing = userMap.get(key);
        if (!existing) {
            userMap.set(key, user);
        } else {
            // Same user + createdAt: keep the one with more recent updatedAt
            const existingUpdated = existing.updatedAt ?? existing.createdAt ?? 0;
            const newUpdated = user.updatedAt ?? user.createdAt ?? 0;
            if (newUpdated > existingUpdated) {
                userMap.set(key, user);
            }
        }
    }

    return Array.from(userMap.values());
}

/**
 * Normalize ProjectSwapInfo - ensures the swapEntries array exists
 * Handles null, undefined, and malformed inputs gracefully
 * @param swapInfo - Raw ProjectSwapInfo from metadata (may be null/undefined)
 * @returns ProjectSwapInfo with swapEntries array guaranteed
 */
export function normalizeProjectSwapInfo(swapInfo: ProjectSwapInfo | null | undefined): ProjectSwapInfo {
    if (!swapInfo || typeof swapInfo !== "object") {
        return { swapEntries: [] };
    }
    return {
        swapEntries: Array.isArray(swapInfo.swapEntries) ? swapInfo.swapEntries : [],
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
 * Get the unique key for entry matching.
 * swapUUID uniquely identifies each swap event (A→B gets uuid-ab, B→C gets uuid-bc).
 * Both OLD and NEW project perspectives of the same swap share the same UUID,
 * so they merge together correctly.
 */
export function getEntryKey(entry: ProjectSwapEntry): string {
    return entry.swapUUID;
}

/**
 * Order fields within a ProjectSwapEntry for consistent, readable JSON output.
 * Groups related fields together:
 * 1. Identifier and status (swapUUID, swapStatus) - most important for scanning
 * 2. Initiation info (swapInitiatedAt, swapInitiatedBy, swapReason)
 * 3. Modification timestamps (swapModifiedAt, swappedUsersModifiedAt)
 * 4. Project names (oldProjectName, newProjectName) - shorter, easier to scan
 * 5. Perspective flag (isOldProject) - separates names from URLs
 * 6. Project URLs (oldProjectUrl, newProjectUrl) - longer, at the end
 * 7. User tracking (swappedUsers)
 * 8. Cancellation info (cancelledBy, cancelledAt) - optional, at the very end
 */
export function orderEntryFields(entry: ProjectSwapEntry): ProjectSwapEntry {
    const ordered: ProjectSwapEntry = {
        // 1. Identifier and status (most important for scanning)
        swapUUID: entry.swapUUID,
        swapStatus: entry.swapStatus,
        // 2. Initiation info
        swapInitiatedAt: entry.swapInitiatedAt,
        swapInitiatedBy: entry.swapInitiatedBy,
        swapReason: entry.swapReason,
        // 3. Modification timestamps
        swapModifiedAt: entry.swapModifiedAt,
        swappedUsersModifiedAt: entry.swappedUsersModifiedAt,
        // 4. Project names (short, easy to scan)
        oldProjectName: entry.oldProjectName,
        newProjectName: entry.newProjectName,
        // 5. Perspective flag (separates names from URLs)
        isOldProject: entry.isOldProject,
        // 6. Project URLs (long, at the end)
        oldProjectUrl: entry.oldProjectUrl,
        newProjectUrl: entry.newProjectUrl,
        // 7. User tracking
        swappedUsers: entry.swappedUsers,
        // 8. Cancellation info (optional)
        cancelledBy: entry.cancelledBy,
        cancelledAt: entry.cancelledAt,
    };

    // Remove undefined fields to keep JSON clean
    Object.keys(ordered).forEach((key) => {
        if ((ordered as any)[key] === undefined) {
            delete (ordered as any)[key];
        }
    });

    return ordered;
}

/**
 * Deterministically sort swap entries to avoid metadata churn.
 * Order: active swaps first (newest), then by swapInitiatedAt (newest),
 * then swapModifiedAt (newest), then swapUUID for stable ties.
 * Also orders fields within each entry for consistent JSON output.
 */
export function sortSwapEntries(entries: ProjectSwapEntry[]): ProjectSwapEntry[] {
    return entries
        .slice()
        .sort((a, b) => {
            const aActive = a.swapStatus === "active" ? 1 : 0;
            const bActive = b.swapStatus === "active" ? 1 : 0;
            if (aActive !== bActive) return bActive - aActive;

            if (a.swapInitiatedAt !== b.swapInitiatedAt) {
                return b.swapInitiatedAt - a.swapInitiatedAt;
            }

            const aModified = a.swapModifiedAt ?? a.swapInitiatedAt;
            const bModified = b.swapModifiedAt ?? b.swapInitiatedAt;
            if (aModified !== bModified) {
                return bModified - aModified;
            }

            return a.swapUUID.localeCompare(b.swapUUID);
        })
        .map(orderEntryFields);
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
    /** True when remote server was unreachable (network error, 404, 500, auth failure).
     *  NOT set when the server returned valid metadata with no projectSwap (that's "erased"). */
    remoteUnreachable?: boolean;
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
        /** True when the server could not be reached at all (null from fetchRemoteMetadata).
         *  False/undefined when the server responded successfully (even if projectSwap is absent). */
        let remoteUnreachable = false;

        // Try to fetch remote metadata for the latest swap status
        // Always check localProjectSwap.json FIRST - it may have local modifications (like cancellations)
        // that should take precedence over remote if they have a more recent timestamp
        try {
            const cachedSwapFile = await readLocalProjectSwapFile(projectUri);
            if (cachedSwapFile?.remoteSwapInfo) {
                // Verify the cached file is for the same origin (if we have one)
                // Use sanitizeGitUrl on both sides for consistent comparison
                // (sourceOriginUrl was stored via sanitizeGitUrl, raw gitOriginUrl may differ)
                const sanitizedOrigin = gitOriginUrl ? sanitizeGitUrl(gitOriginUrl) : null;
                if (!sanitizedOrigin || cachedSwapFile.sourceOriginUrl === sanitizedOrigin) {
                    localSwapFileInfo = cachedSwapFile.remoteSwapInfo;
                    debug("Found swap info in localProjectSwap.json (fetched at:", new Date(cachedSwapFile.fetchedAt).toISOString(), ")");
                } else {
                    debug("localProjectSwap.json origin mismatch:", cachedSwapFile.sourceOriginUrl, "vs", sanitizedOrigin);
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
                    if (remoteMetadata === null) {
                        // Server unreachable (network error, 404, 500, auth failure).
                        // Do NOT treat this as "projectSwap erased" - we simply couldn't reach the server.
                        // Local state (localProjectSwap.json, metadata.json) remains untouched.
                        remoteUnreachable = true;
                        debug("Remote server unreachable - cannot verify swap status");
                    } else if (remoteMetadata?.meta?.projectSwap) {
                        remoteSwapInfo = remoteMetadata.meta.projectSwap as ProjectSwapInfo;
                        debug("Fetched remote metadata for swap check");
                    } else if (remoteMetadata?.meta) {
                        // Remote metadata exists but projectSwap is absent/erased.
                        // This is an authoritative signal: there is no swap on remote.
                        // Treat as empty swap info so we clean up any stale local state.
                        remoteSwapInfo = { swapEntries: [] };
                        debug("Remote metadata has no projectSwap object - treating as empty (no swap)");
                    }

                    if (remoteSwapInfo) {
                        // Always compare remote with localProjectSwap.json by swapUUID + swapModifiedAt.
                        // If remote has newer data (e.g. cancellation), update the local cache.
                        // If no active OLD swap remains after merge, delete the file (it's redundant
                        // since metadata.json is up to date via sync).
                        const remoteEntries = normalizeProjectSwapInfo(remoteSwapInfo).swapEntries || [];
                        const hasActiveOldProjectSwap = remoteEntries.some(
                            e => e.swapStatus === "active" && e.isOldProject === true
                        );

                        try {
                            const { readLocalProjectSwapFile: readSwapFile, deleteLocalProjectSwapFile } = await import("./localProjectSettings");
                            const existingLocalEntries = localSwapFileInfo
                                ? (normalizeProjectSwapInfo(localSwapFileInfo).swapEntries || [])
                                : [];

                            if (hasActiveOldProjectSwap) {
                                // Active OLD swap: merge remote with local cache and write
                                const mergedMap = new Map<string, ProjectSwapEntry>();
                                for (const entry of existingLocalEntries) {
                                    mergedMap.set(entry.swapUUID, entry);
                                }
                                for (const entry of remoteEntries) {
                                    const existing = mergedMap.get(entry.swapUUID);
                                    if (!existing) {
                                        mergedMap.set(entry.swapUUID, entry);
                                    } else {
                                        const existingModified = existing.swapModifiedAt ?? existing.swapInitiatedAt;
                                        const remoteModified = entry.swapModifiedAt ?? entry.swapInitiatedAt;
                                        const mergedUsers = mergeSwappedUsers(existing.swappedUsers, entry.swappedUsers);

                                        if (remoteModified > existingModified) {
                                            mergedMap.set(entry.swapUUID, { ...entry, swappedUsers: mergedUsers });
                                            debug(`Cache merge: using remote entry (modified ${remoteModified}) over local (modified ${existingModified})`);
                                        } else {
                                            mergedMap.set(entry.swapUUID, { ...existing, swappedUsers: mergedUsers });
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

                                localSwapFileInfo = mergedSwapInfo;
                            } else if (existingLocalEntries.length > 0) {
                                // No active OLD swap on remote (or remote erased), but localProjectSwap.json exists.
                                // Check if we can safely delete: only if no pending downloads are stored.
                                // Note: swapPendingDownloads/pendingLfsDownloads are untyped extra fields
                                const existingFile = await readSwapFile(projectUri) as any;
                                const hasPendingState = existingFile?.swapPendingDownloads || existingFile?.pendingLfsDownloads;
                                if (existingFile && !hasPendingState) {
                                    await deleteLocalProjectSwapFile(projectUri);
                                    debug("Deleted stale localProjectSwap.json (remote has no active OLD swap)");
                                } else if (existingFile) {
                                    // Has pending download state - update swap entries but keep the file
                                    await writeLocalProjectSwapFile({
                                        ...existingFile,
                                        remoteSwapInfo: { swapEntries: remoteEntries },
                                        fetchedAt: Date.now(),
                                        sourceOriginUrl: sanitizeGitUrl(gitOriginUrl),
                                    }, projectUri);
                                    debug("Updated localProjectSwap.json with remote data (kept for pending downloads)");
                                }
                                localSwapFileInfo = { swapEntries: remoteEntries };
                            } else {
                                // No local cache existed and no active swap - nothing to do
                                localSwapFileInfo = { swapEntries: remoteEntries };
                            }
                        } catch (cacheError) {
                            debug("Failed to update localProjectSwap.json cache (non-fatal):", cacheError);
                            localSwapFileInfo = { swapEntries: remoteEntries };
                        }
                    }
                }
            } catch (e) {
                debug("Could not fetch remote metadata (non-fatal):", e);
            }
        }

        // Determine which swap info to use by MERGING entries from all sources
        // 
        // ENTRY MATCHING: swapUUID + isOldProject (since old and new projects share same swapUUID)
        // 
        // TIMESTAMP SEPARATION:
        //   - swapModifiedAt: for entry-level changes (status, cancellation, URLs, etc.)
        //   - swappedUsersModifiedAt: for user completion changes
        //
        // MERGE RULES:
        //   1. If swapModifiedAt differs: use newer entry for status/cancellation/URLs
        //   2. ALWAYS merge swappedUsers arrays using mergeSwappedUsers()
        //   3. "Cancelled" status is sticky - if either entry is cancelled, result is cancelled
        //   4. Compute new swappedUsersModifiedAt as max of both entries

        // Collect all entries from all sources (ensure arrays are never undefined)
        const remoteEntries = remoteSwapInfo ? (normalizeProjectSwapInfo(remoteSwapInfo).swapEntries || []) : [];
        const localSwapEntries = localSwapFileInfo ? (normalizeProjectSwapInfo(localSwapFileInfo).swapEntries || []) : [];
        const localMetadataEntries = localMetadataSwapInfo ? (normalizeProjectSwapInfo(localMetadataSwapInfo).swapEntries || []) : [];

        // Merge entries by swapUUID + swapInitiatedAt (composite key)
        // This uniquely identifies a swap event across all sources
        const mergedEntriesMap = new Map<string, ProjectSwapEntry>();

        /**
         * Get the unique key for entry matching.
         * swapUUID uniquely identifies each swap event (A→B gets uuid-ab, B→C gets uuid-bc).
         * Both OLD and NEW project perspectives of the same swap share the same UUID,
         * so they merge together correctly.
         */
        const getEntryKey = (entry: ProjectSwapEntry): string => {
            return entry.swapUUID;
        };

        const addOrUpdateEntry = (entry: ProjectSwapEntry) => {
            const key = getEntryKey(entry);
            const existing = mergedEntriesMap.get(key);
            if (!existing) {
                mergedEntriesMap.set(key, entry);
            } else {
                // Merge swappedUsers arrays to capture all user completions
                // Users are matched by userToSwap + createdAt (composite key)
                // If swappedUsersModifiedAt differs, the newer entry's users take precedence
                // for any conflicts, but we still merge to capture users that may only
                // exist in one source (e.g., user completed offline, not yet synced)
                const mergedUsers = mergeSwappedUsers(existing.swappedUsers, entry.swappedUsers);

                // Compute new swappedUsersModifiedAt as max of both entries
                const existingUsersModified = existing.swappedUsersModifiedAt ?? 0;
                const newUsersModified = entry.swappedUsersModifiedAt ?? 0;
                const mergedUsersModifiedAt = Math.max(existingUsersModified, newUsersModified) || undefined;

                // Compare swapModifiedAt for ENTRY-LEVEL changes (status, cancellation, URLs)
                // This does NOT include swappedUsers changes
                const existingModified = existing.swapModifiedAt ?? existing.swapInitiatedAt;
                const newModified = entry.swapModifiedAt ?? entry.swapInitiatedAt;

                // Determine which entry to use as base for entry-level fields
                let baseEntry: ProjectSwapEntry;
                if (newModified > existingModified) {
                    baseEntry = entry;
                    debug(`Entry ${key}: using version with swapModifiedAt ${newModified} (status: ${entry.swapStatus}) over ${existingModified} (status: ${existing.swapStatus})`);
                } else {
                    baseEntry = existing;
                }

                // SEMANTIC RULE: "cancelled" status is sticky
                // If EITHER entry is cancelled, preserve the cancellation
                // This prevents entry-level changes from un-cancelling a swap
                // Rationale: explicit admin cancellation should not be accidentally overridden
                const eitherCancelled = existing.swapStatus === "cancelled" || entry.swapStatus === "cancelled";
                if (eitherCancelled) {
                    // Find the cancelled entry to get cancellation details
                    const cancelledEntry = existing.swapStatus === "cancelled" ? existing : entry;
                    mergedEntriesMap.set(key, {
                        ...baseEntry,
                        swappedUsers: mergedUsers,
                        swappedUsersModifiedAt: mergedUsersModifiedAt,
                        swapStatus: "cancelled",
                        cancelledBy: cancelledEntry.cancelledBy,
                        cancelledAt: cancelledEntry.cancelledAt,
                    });
                    debug(`Entry ${key}: preserving cancelled status (cancelled is sticky)`);
                } else {
                    mergedEntriesMap.set(key, {
                        ...baseEntry,
                        swappedUsers: mergedUsers,
                        swappedUsersModifiedAt: mergedUsersModifiedAt,
                    });
                }
            }
        };

        // Add entries from all sources - local metadata first, then localSwapFile, then remote
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
            return { required: false, reason: "No swap configured", remoteUnreachable };
        }

        // Normalize to new array format
        const swapInfo = normalizeProjectSwapInfo(effectiveSwapInfo);

        // Find the active swap entry
        const activeEntry = getActiveSwapEntry(swapInfo);

        if (!activeEntry) {
            debug("No active swap entry found");
            // No active swap - clean up localProjectSwap.json if it exists and has no pending state
            try {
                const { readLocalProjectSwapFile: readSwapFile, deleteLocalProjectSwapFile } = await import("./localProjectSettings");
                const existingFile = await readSwapFile(projectUri) as any;
                const hasPendingState = existingFile?.swapPendingDownloads || existingFile?.pendingLfsDownloads;
                if (existingFile && !hasPendingState) {
                    await deleteLocalProjectSwapFile(projectUri);
                    debug("Deleted localProjectSwap.json (no active swap after merge)");
                }
            } catch {
                // Non-fatal
            }
            return { required: false, reason: "No active swap", swapInfo, remoteUnreachable };
        }

        // Only OLD projects (isOldProject: true in the entry) can trigger swap requirements
        if (!activeEntry.isOldProject) {
            debug("This is the NEW project (destination) - no swap required");
            // NEW project doesn't need localProjectSwap.json
            try {
                const { readLocalProjectSwapFile: readSwapFile, deleteLocalProjectSwapFile } = await import("./localProjectSettings");
                const existingFile = await readSwapFile(projectUri) as any;
                const hasPendingState = existingFile?.swapPendingDownloads || existingFile?.pendingLfsDownloads;
                if (existingFile && !hasPendingState) {
                    await deleteLocalProjectSwapFile(projectUri);
                    debug("Deleted localProjectSwap.json (this is the NEW project)");
                }
            } catch {
                // Non-fatal
            }
            return { required: false, reason: "This is the destination project", swapInfo, remoteUnreachable };
        }

        // Check if user has already completed this swap
        if (effectiveUsername) {
            const hasCompleted = await hasUserCompletedSwap(swapInfo, activeEntry, effectiveUsername);
            if (hasCompleted) {
                debug("User already swapped; no swap required");

                // Write the completion back to the old project's local files
                // so subsequent checks (project list, re-opens) detect it locally
                // without needing to fetch the NEW project's remote.
                try {
                    await writeUserSwapCompletionToOldProject(
                        projectPath, activeEntry, effectiveUsername, swapInfo
                    );
                } catch (writeErr) {
                    debug("Failed to write user swap completion (non-fatal):", writeErr);
                }

                return {
                    required: false,
                    reason: "User already swapped",
                    swapInfo,
                    activeEntry,
                    userAlreadySwapped: true,
                    remoteUnreachable,
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
            remoteUnreachable,
        };
    } catch (error) {
        debug("Error checking project swap requirement:", error);
        return { required: false, reason: `Error: ${error}`, remoteUnreachable: true };
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
 * Write user swap completion back to the OLD project's local files.
 * This records that the current user has already completed the swap, so:
 *   1. The "Project Swap Required" banner no longer appears for this user
 *   2. Subsequent checkProjectSwapRequired calls detect it locally (no remote fetch needed)
 *
 * Writes to BOTH metadata.json and localProjectSwap.json for durability.
 * Even though old project syncing is disabled, metadata.json serves as persistent local truth.
 *
 * @param projectPath - Path to the OLD project
 * @param activeEntry - The active swap entry
 * @param username - The username that completed the swap
 * @param swapInfo - The full swap info (for updating entries)
 */
export async function writeUserSwapCompletionToOldProject(
    projectPath: string,
    activeEntry: ProjectSwapEntry,
    username: string,
    swapInfo: ProjectSwapInfo
): Promise<void> {
    const projectUri = vscode.Uri.file(projectPath);
    const now = Date.now();

    const userEntry: ProjectSwapUserEntry = {
        userToSwap: username,
        createdAt: now,
        updatedAt: now,
        executed: true,
        swapCompletedAt: now,
    };

    debug(`Writing user swap completion for "${username}" to old project at ${projectPath}`);

    // Helper: update swappedUsers in an entry array
    const addUserToEntries = (entries: ProjectSwapEntry[]): ProjectSwapEntry[] =>
        entries.map((entry) => {
            if (entry.swapUUID !== activeEntry.swapUUID) {
                return entry;
            }
            const existingUsers = entry.swappedUsers || [];
            // Don't add duplicate if user already present
            const alreadyPresent = existingUsers.some(
                (u) => u.userToSwap === username && u.executed
            );
            if (alreadyPresent) {
                return entry;
            }
            return {
                ...entry,
                swappedUsers: [...existingUsers, userEntry],
                swappedUsersModifiedAt: now,
            };
        });

    // 1. Write to metadata.json (durable local truth, even though it won't sync)
    try {
        const { MetadataManager } = await import("./metadataManager");
        await MetadataManager.safeUpdateMetadata<import("../../types").ProjectMetadata>(
            projectUri,
            (meta) => {
                if (!meta.meta?.projectSwap) {
                    return meta;
                }
                const normalized = normalizeProjectSwapInfo(meta.meta.projectSwap);
                const updatedEntries = addUserToEntries(normalized.swapEntries || []);
                meta.meta.projectSwap = {
                    swapEntries: sortSwapEntries(updatedEntries).map(orderEntryFields),
                };
                return meta;
            }
        );
        debug("Wrote user swap completion to metadata.json");
    } catch (e) {
        debug("Failed to write user swap completion to metadata.json (non-fatal):", e);
    }

    // 2. Write to localProjectSwap.json (fast local cache)
    try {
        const { readLocalProjectSwapFile, writeLocalProjectSwapFile } = await import("./localProjectSettings");
        const existingFile = await readLocalProjectSwapFile(projectUri);
        if (existingFile?.remoteSwapInfo) {
            const normalized = normalizeProjectSwapInfo(existingFile.remoteSwapInfo);
            const updatedEntries = addUserToEntries(normalized.swapEntries || []);
            await writeLocalProjectSwapFile({
                ...existingFile,
                remoteSwapInfo: { swapEntries: updatedEntries },
                fetchedAt: Date.now(),
            }, projectUri);
            debug("Wrote user swap completion to localProjectSwap.json");
        }
    } catch (e) {
        debug("Failed to write user swap completion to localProjectSwap.json (non-fatal):", e);
    }
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

/**
 * Information about a deprecated (old) project that should be hidden.
 */
export interface DeprecatedProjectInfo {
    url: string;
    name: string;
    /** The swap entry that deprecated this project */
    deprecatedBySwapUUID: string;
    /** When the swap was initiated that deprecated this project */
    deprecatedAt: number;
}

/**
 * Extract all deprecated (old) project URLs from the swap history chain.
 * 
 * This function analyzes the swap history to identify all projects that have been
 * superseded by newer projects in the chain. These projects should be hidden
 * from the project list since users should use the newer project instead.
 * 
 * Example chain: A → B → C
 * - Entry 1 (isOldProject: false): B → C swap (from C's perspective)
 * - Entry 2 (isOldProject: true): A → B swap (from B's perspective, now old)
 * - Entry 3 (origin marker): A is origin
 * 
 * From this, we extract: A (from entries 2 & 3) and B (from entry 1) as deprecated.
 * 
 * @param swapInfo - ProjectSwapInfo containing the swap history
 * @returns Array of deprecated project info (URLs and names to hide)
 */
export function getDeprecatedProjectsFromHistory(swapInfo: ProjectSwapInfo | undefined): DeprecatedProjectInfo[] {
    if (!swapInfo?.swapEntries?.length) {
        return [];
    }

    const deprecatedMap = new Map<string, DeprecatedProjectInfo>();

    for (const entry of swapInfo.swapEntries) {
        // Skip entries without old project URL (shouldn't happen, but be safe)
        if (!entry.oldProjectUrl) {
            continue;
        }

        // Every entry's oldProjectUrl represents a deprecated project
        // (regardless of isOldProject flag - the oldProjectUrl is always the "from" project)
        const normalizedUrl = entry.oldProjectUrl.toLowerCase();

        // Only add if not already present, or if this entry is newer
        const existing = deprecatedMap.get(normalizedUrl);
        if (!existing || entry.swapInitiatedAt > existing.deprecatedAt) {
            deprecatedMap.set(normalizedUrl, {
                url: entry.oldProjectUrl,
                name: entry.oldProjectName,
                deprecatedBySwapUUID: entry.swapUUID,
                deprecatedAt: entry.swapInitiatedAt,
            });
        }
    }

    return Array.from(deprecatedMap.values());
}

/**
 * Check if a project URL is deprecated (should be hidden) based on swap history.
 * 
 * @param projectUrl - The project URL to check
 * @param swapInfo - ProjectSwapInfo containing the swap history
 * @returns True if the project is deprecated and should be hidden
 */
export function isProjectDeprecated(projectUrl: string, swapInfo: ProjectSwapInfo | undefined): boolean {
    const deprecated = getDeprecatedProjectsFromHistory(swapInfo);
    const normalizedUrl = projectUrl.toLowerCase();
    return deprecated.some(d => d.url.toLowerCase() === normalizedUrl);
}

/**
 * Get the set of deprecated project URLs for efficient lookup.
 * 
 * @param swapInfo - ProjectSwapInfo containing the swap history
 * @returns Set of lowercase project URLs that are deprecated
 */
export function getDeprecatedProjectUrls(swapInfo: ProjectSwapInfo | undefined): Set<string> {
    const deprecated = getDeprecatedProjectsFromHistory(swapInfo);
    return new Set(deprecated.map(d => d.url.toLowerCase()));
}
