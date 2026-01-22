import * as vscode from "vscode";
import { getAuthApi } from "../extension";
import { MetadataManager } from "./metadataManager";
import * as git from "isomorphic-git";
import * as fs from "fs";
import { ProjectSwapInfo, ProjectSwapUserEntry } from "../../types";

const DEBUG = false;
const debug = DEBUG ? (...args: any[]) => console.log("[RemoteUpdating]", ...args) : () => { };

/**
 * Feature Flags for Remote Updating
 * 
 * ENABLE_ENTRY_CLEARING: Feature flag for clearing executed or cancelled entries 
 * from the required updating list. Allows Maintainers/Owners to permanently 
 * remove update entries from history.
 * 
 * When enabled:
 * - Shows trash icon button on completed/cancelled entries
 * - Allows clearing entries from the remote update history
 * - Completely removes entries during merge (no recovery)
 * 
 * TODO: Enable this feature in a future release after thorough testing
 * Current status: ENABLED for testing (set to `false` to disable)
 */
export const FEATURE_FLAGS = {
    ENABLE_ENTRY_CLEARING: true,
} as const;

/**
 * Type-safe feature flag checker
 */
export function isFeatureEnabled(feature: keyof typeof FEATURE_FLAGS): boolean {
    return FEATURE_FLAGS[feature];
}

export interface RemoteUpdatingEntry {
    userToUpdate: string;
    addedBy: string;
    createdAt: number;
    updatedAt: number;
    cancelled: boolean;      // Indicates update requirement was cancelled
    cancelledBy: string;
    executed: boolean;
    clearEntry?: boolean;    // When true, completely removes entry from history (feature flagged)
}

/**
 * Normalizes legacy field names to current terminology.
 * Converts old → new as soon as we read entries from metadata.json.
 * This allows us to only use new field names in our code.
 * 
 * Legacy mappings:
 * - deleted → cancelled
 * - deletedBy → cancelledBy
 * - obliterate → clearEntry
 * 
 * @param entry Raw entry from metadata.json (may contain legacy fields)
 * @returns Normalized entry with only current field names
 */
export function normalizeUpdateEntry(entry: any): RemoteUpdatingEntry {
    const normalized: any = { ...entry };

    // Normalize legacy field: deleted → cancelled
    if ('deleted' in normalized && !('cancelled' in normalized)) {
        normalized.cancelled = normalized.deleted;
        delete normalized.deleted;
    }

    // Normalize legacy field: deletedBy → cancelledBy
    if ('deletedBy' in normalized && !('cancelledBy' in normalized)) {
        normalized.cancelledBy = normalized.deletedBy;
        delete normalized.deletedBy;
    }

    // Normalize legacy field: obliterate → clearEntry
    if ('obliterate' in normalized && !('clearEntry' in normalized)) {
        normalized.clearEntry = normalized.obliterate;
        delete normalized.obliterate;
    }

    // Ensure required fields have defaults
    normalized.cancelled = normalized.cancelled || false;
    normalized.cancelledBy = normalized.cancelledBy || '';
    normalized.executed = normalized.executed || false;

    return normalized as RemoteUpdatingEntry;
}

export function normalizeSwapUserEntry(entry: any): ProjectSwapUserEntry {
    const normalized: any = { ...entry };
    const cancelled = Boolean(normalized.cancelled ?? normalized.deleted ?? false);
    const createdAt =
        typeof normalized.createdAt === "number"
            ? normalized.createdAt
            : typeof normalized.updatedAt === "number"
                ? normalized.updatedAt
                : Date.now();
    const updatedAt =
        typeof normalized.updatedAt === "number"
            ? normalized.updatedAt
            : typeof normalized.createdAt === "number"
                ? normalized.createdAt
                : Date.now();
    const executed = Boolean(normalized.executed) && !cancelled;
    // Support legacy field name userToUpdate for backward compatibility
    const userToSwap = normalized.userToSwap || normalized.userToUpdate || "";

    return {
        userToSwap,
        createdAt,
        updatedAt,
        executed,
    };
}
/**
 * Helper to check if entry is cancelled
 */
export function isCancelled(entry: RemoteUpdatingEntry): boolean {
    return entry.cancelled === true;
}

/**
 * Helper to get cancelledBy value
 */
export function getCancelledBy(entry: RemoteUpdatingEntry): string {
    return entry.cancelledBy || '';
}

interface ProjectMetadata {
    meta?: {
        initiateRemoteUpdatingFor?: RemoteUpdatingEntry[];
        projectSwap?: ProjectSwapInfo;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

interface RemoteUpdatingCheckResult {
    required: boolean;
    reason?: string;
    currentUsername?: string;
    currentUserEmail?: string;
}

interface RemoteProjectRequirementsResult {
    updateRequired: boolean;
    updateReason?: string;
    swapRequired: boolean;
    swapReason?: string;
    swapInfo?: ProjectSwapInfo;
    currentUsername?: string;
}

// Cache for remote metadata checks to avoid repeated API calls
const remoteMetadataCache = new Map<string, { metadata: ProjectMetadata; timestamp: number; }>();
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Extract GitLab project ID from a git remote URL
 * Supports formats like:
 * - https://gitlab.com/group/project.git
 * - https://gitlab.com/group/subgroup/project.git
 * - git@gitlab.com:group/project.git
 * @returns Project ID in format "group/project" or "group/subgroup/project"
 */
export function extractProjectIdFromUrl(gitUrl: string): string | null {
    try {
        debug("Extracting project ID from URL:", gitUrl);

        // Handle SSH format: git@gitlab.com:group/project.git
        const sshMatch = gitUrl.match(/git@[^:]+:(.+?)(?:\.git)?$/);
        if (sshMatch) {
            const projectId = sshMatch[1];
            debug("Extracted project ID (SSH):", projectId);
            return projectId;
        }

        // Handle HTTPS format: https://gitlab.com/group/project.git
        const httpsMatch = gitUrl.match(/https?:\/\/[^/]+\/(.+?)(?:\.git)?$/);
        if (httpsMatch) {
            const projectId = httpsMatch[1];
            debug("Extracted project ID (HTTPS):", projectId);
            return projectId;
        }

        debug("Could not extract project ID from URL");
        return null;
    } catch (error) {
        debug("Error extracting project ID:", error);
        return null;
    }
}

/**
 * Get the current logged-in username from Frontier authentication
 */
export async function getCurrentUsername(): Promise<string | null> {
    try {
        const authApi = getAuthApi();
        if (!authApi) {
            debug("Auth API not available");
            return null;
        }

        const userInfo = await authApi.getUserInfo();
        debug("Current username:", userInfo.username);
        return userInfo.username;
    } catch (error) {
        debug("Error getting current username:", error);
        return null;
    }
}

/**
 * Fetch metadata.json from the remote repository
 * @param projectId - The GitLab project ID (e.g., "group/project")
 * @param useCache - Whether to use cached data if available
 */
export async function fetchRemoteMetadata(
    projectId: string,
    useCache: boolean = true
): Promise<ProjectMetadata | null> {
    try {
        // Check cache first
        if (useCache) {
            const cached = remoteMetadataCache.get(projectId);
            if (cached && Date.now() - cached.timestamp < CACHE_DURATION_MS) {
                debug("Using cached remote metadata for project:", projectId);
                return cached.metadata;
            }
        }

        debug("Fetching remote metadata for project:", projectId);

        const authApi = getAuthApi();
        if (!authApi) {
            debug("Auth API not available");
            return null;
        }

        // Get GitLab service from the auth API
        // We need to access the GitLab service through the frontier-authentication extension
        const frontierExtension = vscode.extensions.getExtension("frontier-rnd.frontier-authentication");
        if (!frontierExtension) {
            debug("Frontier authentication extension not found");
            return null;
        }

        if (!frontierExtension.isActive) {
            await frontierExtension.activate();
        }

        const frontierApi = frontierExtension.exports;
        if (!frontierApi?.gitLabService) {
            debug("GitLab service not available in Frontier API");
            return null;
        }

        // Fetch metadata.json from the repository
        const metadataContent = await frontierApi.gitLabService.getRepositoryFile(
            projectId,
            "metadata.json",
            "main"
        );

        const metadata: ProjectMetadata = JSON.parse(metadataContent);
        debug("Fetched remote metadata:", metadata);

        // Update cache
        remoteMetadataCache.set(projectId, {
            metadata,
            timestamp: Date.now(),
        });

        return metadata;
    } catch (error) {
        debug("Error fetching remote metadata:", error);
        return null;
    }
}

/**
 * Get the git origin URL for a project
 */
async function getGitOriginUrl(projectPath: string): Promise<string | null> {
    try {
        const git = await import("isomorphic-git");
        const fs = await import("fs");

        const remotes = await git.listRemotes({ fs, dir: projectPath });
        const origin = remotes.find((r) => r.remote === "origin");

        if (origin) {
            debug("Found git origin URL:", origin.url);
            return origin.url;
        }

        debug("No origin remote found");
        return null;
    } catch (error) {
        debug("Error getting git origin URL:", error);
        return null;
    }
}

/**
 * Check if remote updating is required for the current user
 * This is the main function called before opening a project
 * 
 * @param projectPath - Local path to the project
 * @param gitOriginUrl - Git origin URL (optional, will be fetched if not provided)
 * @param bypassCache - Whether to bypass the cache and force a network fetch (useful to verify connectivity)
 * @returns Object indicating if updating is required and why
 */
export async function checkRemoteUpdatingRequired(
    projectPath: string,
    gitOriginUrl?: string,
    bypassCache: boolean = false
): Promise<RemoteUpdatingCheckResult> {
    try {
        debug("Checking remote updating requirement for:", projectPath);

        // Get current username
        const currentUsername = (await getCurrentUsername()) ?? undefined;
        if (!currentUsername) {
            debug("Cannot determine current username, skipping remote updating check");
            return { required: false, reason: "No current username" };
        }

        // Check if update was completed locally but not yet synced to remote
        // This prevents showing "update required" modal again before sync completes
        try {
            const { readLocalProjectSettings } = await import("./localProjectSettings");
            const localSettings = await readLocalProjectSettings(vscode.Uri.file(projectPath));
            if (localSettings.updateCompletedLocally?.username === currentUsername) {
                debug("Update already completed locally, waiting for sync. Skipping remote check.");
                return {
                    required: false,
                    reason: "Update completed locally, waiting for sync",
                    currentUsername,
                };
            }
        } catch (localCheckErr) {
            debug("Error checking local update completion (non-fatal):", localCheckErr);
        }

        // Get git origin URL if not provided
        if (!gitOriginUrl) {
            const fetchedUrl = await getGitOriginUrl(projectPath);
            gitOriginUrl = fetchedUrl || undefined;
        }

        if (!gitOriginUrl) {
            debug("No git origin URL found, skipping remote updating check");
            return { required: false, reason: "No git origin URL" };
        }

        // Extract project ID from URL
        const projectId = extractProjectIdFromUrl(gitOriginUrl);
        if (!projectId) {
            debug("Could not extract project ID from URL, skipping remote updating check");
            return { required: false, reason: "Could not extract project ID" };
        }

        // Fetch remote metadata
        const remoteMetadata = await fetchRemoteMetadata(projectId, !bypassCache);
        if (!remoteMetadata) {
            debug("Could not fetch remote metadata, skipping remote updating check");
            return { required: false, reason: "Could not fetch remote metadata" };
        }

        // Check if current user is in the updating list
        // Normalize entries on read to convert legacy field names
        const rawList = remoteMetadata.meta?.initiateRemoteUpdatingFor || [];
        const updatingList = rawList.map(entry => normalizeUpdateEntry(entry));

        let isInUpdatingList = false;

        // Check for new objects
        for (const entry of updatingList) {
            if (typeof entry === 'object' && entry !== null) {
                if (entry.userToUpdate === currentUsername && !entry.executed && !isCancelled(entry)) {
                    isInUpdatingList = true;
                    break;
                }
            }
        }

        if (!isInUpdatingList) {
            debug("Current user not in updating list (or executed/cancelled)");
            return { required: false, reason: "User not in updating list", currentUsername };
        }

        // User is in remote updating list - updating required
        // Note: We don't check local metadata because users are automatically removed
        // from the remote list after successful updating, so if they're in the remote
        // list, they need to update regardless of local state
        debug("Remote updating required for user:", currentUsername);
        return {
            required: true,
            reason: "User in remote updating list",
            currentUsername,
        };
    } catch (error) {
        debug("Error checking remote updating requirement:", error);
        return { required: false, reason: `Error: ${error}` };
    }
}

/**
 * Check remote requirements (update + swap) with a single metadata fetch.
 */
export async function checkRemoteProjectRequirements(
    projectPath: string,
    gitOriginUrl?: string,
    bypassCache: boolean = false
): Promise<RemoteProjectRequirementsResult> {
    try {
        debug("Checking remote project requirements for:", projectPath);

        const currentUsername = (await getCurrentUsername()) ?? undefined;

        // Check if update was completed locally but not yet synced to remote
        try {
            const { readLocalProjectSettings } = await import("./localProjectSettings");
            const localSettings = await readLocalProjectSettings(vscode.Uri.file(projectPath));
            if (currentUsername && localSettings.updateCompletedLocally?.username === currentUsername) {
                debug("Update already completed locally, waiting for sync. Skipping update check.");
                return {
                    updateRequired: false,
                    updateReason: "Update completed locally, waiting for sync",
                    swapRequired: false,
                    currentUsername,
                };
            }
        } catch (localCheckErr) {
            debug("Error checking local update completion (non-fatal):", localCheckErr);
        }

        // Get git origin URL if not provided
        if (!gitOriginUrl) {
            const fetchedUrl = await getGitOriginUrl(projectPath);
            gitOriginUrl = fetchedUrl || undefined;
        }

        if (!gitOriginUrl) {
            debug("No git origin URL found, skipping remote checks");
            return {
                updateRequired: false,
                updateReason: "No git origin URL",
                swapRequired: false,
                swapReason: "No git origin URL",
                currentUsername,
            };
        }

        // Extract project ID from URL
        const projectId = extractProjectIdFromUrl(gitOriginUrl);
        if (!projectId) {
            debug("Could not extract project ID from URL, skipping remote checks");
            return {
                updateRequired: false,
                updateReason: "Could not extract project ID",
                swapRequired: false,
                swapReason: "Could not extract project ID",
                currentUsername,
            };
        }

        // Fetch remote metadata once
        const remoteMetadata = await fetchRemoteMetadata(projectId, !bypassCache);
        if (!remoteMetadata) {
            debug("Could not fetch remote metadata, skipping remote checks");
            return {
                updateRequired: false,
                updateReason: "Could not fetch remote metadata",
                swapRequired: false,
                swapReason: "Could not fetch remote metadata",
                currentUsername,
            };
        }

        // Update check
        let updateRequired = false;
        let updateReason = "User not in updating list";

        if (currentUsername) {
            const rawList = remoteMetadata.meta?.initiateRemoteUpdatingFor || [];
            const updatingList = rawList.map(entry => normalizeUpdateEntry(entry));
            updateRequired = updatingList.some((entry) =>
                entry.userToUpdate === currentUsername && !entry.executed && !isCancelled(entry)
            );
            if (updateRequired) {
                updateReason = "User in remote updating list";
            }
        } else {
            updateReason = "No current username";
        }

        // Swap check
        const swapInfo = remoteMetadata.meta?.projectSwap as RemoteProjectRequirementsResult["swapInfo"] | undefined;
        let { required: swapRequired, reason: swapReason } = evaluateSwapRequirement(swapInfo, currentUsername);

        if (swapRequired && swapInfo?.newProjectUrl && currentUsername) {
            const alreadySwapped = await hasUserSwappedInNewProject(swapInfo, currentUsername);
            if (alreadySwapped) {
                swapRequired = false;
                swapReason = "User already swapped to new project";
            }
        }

        return {
            updateRequired,
            updateReason,
            swapRequired,
            swapReason,
            swapInfo,
            currentUsername,
        };
    } catch (error) {
        debug("Error checking remote project requirements:", error);
        return {
            updateRequired: false,
            updateReason: `Error: ${error}`,
            swapRequired: false,
            swapReason: `Error: ${error}`,
        };
    }
}

function evaluateSwapRequirement(
    swapInfo: RemoteProjectRequirementsResult["swapInfo"],
    currentUsername?: string | null
): { required: boolean; reason: string; } {
    if (!swapInfo) {
        return { required: false, reason: "No swap configured" };
    }

    if (!swapInfo.isOldProject) {
        return { required: false, reason: "Not an old project" };
    }

    if (swapInfo.swapStatus === "pending") {
        return { required: true, reason: "Project has been swapped to a new repository" };
    }

    if (swapInfo.swapStatus === "swapping" || swapInfo.swapStatus === "failed") {
        return {
            required: true,
            reason: swapInfo.swapStatus === "swapping" ? "Swap in progress" : "Swap failed - needs retry",
        };
    }

    if (swapInfo.swapStatus === "completed" && currentUsername) {
        const entries = (swapInfo.swappedUsers || []).map(entry => normalizeSwapUserEntry(entry));
        const hasCompleted = entries.some(
            (entry) => entry.userToSwap === currentUsername && entry.executed
        );
        if (!hasCompleted) {
            return { required: true, reason: "Project swapped; user not swapped yet" };
        }
    }

    return { required: false, reason: "Swap already completed or not applicable" };
}

async function hasUserSwappedInNewProject(
    swapInfo: ProjectSwapInfo,
    currentUsername: string
): Promise<boolean> {
    const projectId = extractProjectIdFromUrl(swapInfo.newProjectUrl);
    if (!projectId) {
        return false;
    }

    const remoteMetadata = await fetchRemoteMetadata(projectId, false);
    const newSwapInfo = remoteMetadata?.meta?.projectSwap;
    const entries = (newSwapInfo?.swappedUsers || []).map((entry: ProjectSwapUserEntry) =>
        normalizeSwapUserEntry(entry)
    );
    return entries.some(
        (entry) => entry.userToSwap === currentUsername && entry.executed
    );
}

/**
 * Clear the remote metadata cache for a specific project or all projects
 */
export function clearRemoteMetadataCache(projectId?: string): void {
    if (projectId) {
        remoteMetadataCache.delete(projectId);
        debug("Cleared cache for project:", projectId);
    } else {
        remoteMetadataCache.clear();
        debug("Cleared all remote metadata cache");
    }
}

/**
 * Fetch list of contributors for a project (used by admin UI)
 * @param projectId - The GitLab project ID
 */
/**
 * Fetch project contributors (users who have made commits)
 * @deprecated Use fetchProjectMembers instead for a complete list including non-contributors
 */
export async function fetchProjectContributors(
    projectId: string
): Promise<Array<{ username: string; name: string; email: string; commits: number; }> | null> {
    try {
        debug("Fetching contributors for project:", projectId);

        const frontierExtension = vscode.extensions.getExtension("frontier-rnd.frontier-authentication");
        if (!frontierExtension) {
            debug("Frontier authentication extension not found");
            return null;
        }

        if (!frontierExtension.isActive) {
            await frontierExtension.activate();
        }

        const frontierApi = frontierExtension.exports;
        if (!frontierApi?.gitLabService) {
            debug("GitLab service not available in Frontier API");
            return null;
        }

        const contributors = await frontierApi.gitLabService.getProjectContributors(projectId);
        debug("Fetched contributors:", contributors);
        return contributors;
    } catch (error) {
        debug("Error fetching project contributors:", error);
        return null;
    }
}

/**
 * Fetch ALL project members (including those who never committed)
 * Includes access level/role information
 */
export async function fetchProjectMembers(
    projectId: string
): Promise<Array<{
    username: string;
    name: string;
    email: string;
    accessLevel: number;
    roleName: string;
    isAdmin?: boolean;  // Instance administrator (not just project admin)
}> | null> {
    try {
        debug("Fetching members for project:", projectId);

        const frontierExtension = vscode.extensions.getExtension("frontier-rnd.frontier-authentication");
        if (!frontierExtension) {
            debug("Frontier authentication extension not found");
            return null;
        }

        if (!frontierExtension.isActive) {
            await frontierExtension.activate();
        }

        const frontierApi = frontierExtension.exports;
        if (!frontierApi?.gitLabService) {
            debug("GitLab service not available in Frontier API");
            return null;
        }

        const members = await frontierApi.gitLabService.getProjectMembers(projectId);
        debug("Fetched members:", members);
        return members;
    } catch (error) {
        debug("Error fetching project members:", error);
        return null;
    }
}

/**
 * Mark a user as having completed remote updating
 * This updates the local metadata.json setting 'executed' to true and pushes the changes
 * 
 * @param projectPath - Path to the project directory
 * @param username - Username to mark as updated
 */
export async function markUserAsUpdatedInRemoteList(
    projectPath: string,
    username: string
): Promise<void> {
    try {
        debug("Marking user as updated in remote list:", username);

        const projectUri = vscode.Uri.file(projectPath);

        // Read current metadata (local)
        const readResult = await MetadataManager.safeReadMetadata<ProjectMetadata>(projectUri);
        if (!readResult.success || !readResult.metadata) {
            throw new Error("Failed to read metadata.json");
        }

        const localMetadata = readResult.metadata;
        // Normalize entries on read to convert legacy field names
        const rawLocalList = localMetadata.meta?.initiateRemoteUpdatingFor || [];
        const localList = rawLocalList.map(entry => normalizeUpdateEntry(entry));

        // Fetch remote metadata to merge the latest updating list (prevents dropping entries)
        let remoteList: RemoteUpdatingEntry[] = [];
        try {
            const remotes = await git.listRemotes({ fs, dir: projectPath });
            const origin = remotes.find((r) => r.remote === "origin");
            if (origin?.url) {
                const projectId = extractProjectIdFromUrl(origin.url);
                if (projectId) {
                    const remoteMetadata = await fetchRemoteMetadata(projectId, false);
                    const rawRemoteList = remoteMetadata?.meta?.initiateRemoteUpdatingFor || [];
                    // Normalize remote entries too
                    remoteList = rawRemoteList.map(entry => normalizeUpdateEntry(entry));
                }
            }
        } catch (e) {
            debug("Could not fetch remote metadata for merge (will use local only)", e);
        }

        // Merge remote + local lists without deleting history; de-dup by JSON signature
        // Merge remote + local lists preserving history; if an object for userToUpdate already exists,
        // update that single entry instead of adding a new one.
        const mergedList: any[] = [];
        const seenKeys = new Set<string>();

        const signature = (entry: any) => {
            if (typeof entry === "object" && entry !== null) {
                const obj = entry as any;
                const user = typeof obj.userToUpdate === "string" ? obj.userToUpdate : "";
                const addedBy = typeof obj.addedBy === "string" ? obj.addedBy : "";
                const createdAt = typeof obj.createdAt === "number" ? obj.createdAt : 0;
                return `obj:${user}:${addedBy}:${createdAt}`;
            }
            return `prim:${String(entry)}`;
        };

        // Add remote entries first (source of truth), then local entries if unseen
        [...remoteList, ...localList].forEach((entry) => {
            const key = signature(entry);
            if (!seenKeys.has(key)) {
                seenKeys.add(key);
                mergedList.push(entry);
            }
        });

        let listChanged = false;
        const updatedList = mergedList.map((entry) => {
            if (typeof entry === "object" && entry !== null) {
                const obj = entry as RemoteUpdatingEntry;
                // Mark as executed even if cancelled (preserves cancelled flag)
                if (obj.userToUpdate === username && !obj.executed) {
                    listChanged = true;
                    return {
                        ...obj,
                        executed: true,
                        updatedAt: Date.now(),
                        // Explicitly preserve cancelled flag
                        cancelled: obj.cancelled,
                    };
                }
                return obj;
            }
            // Preserve primitive entries (shouldn't happen but just in case)
            return entry;
        });

        if (!listChanged) {
            debug("User not pending in updating list, nothing to update");
            return;
        }

        debug("Updated updating list:", updatedList);

        // Update metadata
        const updateResult = await MetadataManager.safeUpdateMetadata<ProjectMetadata>(
            projectUri,
            (meta) => {
                if (!meta.meta) {
                    meta.meta = {};
                }

                meta.meta.initiateRemoteUpdatingFor = updatedList;
                return meta;
            }
        );

        if (!updateResult.success) {
            throw new Error(updateResult.error || "Failed to update metadata.json");
        }

        debug("Metadata updated successfully, committing and pushing changes...");

        // Trigger sync using the same command as the manual sync button
        const commitMessage = `Marked ${username} as updated in remote updating list`;
        await vscode.commands.executeCommand(
            "codex-editor-extension.triggerSync",
            commitMessage,
            { bypassUpdatingCheck: true }
        );

        debug("Successfully updated remote updating list and triggered sync");

        // Clear the cache for this project so future checks get the updated list
        const remotes = await git.listRemotes({ fs, dir: projectPath });
        const origin = remotes.find((r) => r.remote === "origin");

        if (origin?.url) {
            const projectId = extractProjectIdFromUrl(origin.url);
            if (projectId) {
                clearRemoteMetadataCache(projectId);
            }
        }
    } catch (error) {
        debug("Error marking user as updated:", error);
        throw error;
    }
}

