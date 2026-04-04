import * as vscode from "vscode";
import * as dns from "dns";
import { getAuthApi } from "../extension";
import { MetadataManager } from "./metadataManager";
import * as dugiteGit from "./dugiteGit";
import { sanitizeGitUrl } from "./projectSwapManager";
import { ProjectSwapInfo, ProjectSwapEntry, ProjectSwapUserEntry, RemoteUpdatingEntry } from "../../types";

// Re-export RemoteUpdatingEntry so existing imports from this file continue to work
export type { RemoteUpdatingEntry };

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

// RemoteUpdatingEntry is now imported from types/index.d.ts (single source of truth)

/**
 * Validates and ensures defaults for update entry fields.
 * All entries should already have current field names (userToUpdate, cancelled, cancelledBy, clearEntry).
 * 
 * @param entry Raw entry from metadata.json
 * @returns Validated entry with required fields having defaults
 */
export function normalizeUpdateEntry(entry: any): RemoteUpdatingEntry {
    // All entries should already have new field names
    return {
        userToUpdate: entry.userToUpdate || "",
        addedBy: entry.addedBy || "",
        createdAt: entry.createdAt || 0,
        updatedAt: entry.updatedAt || Date.now(),
        cancelled: entry.cancelled || false,
        cancelledBy: entry.cancelledBy || "",
        executed: entry.executed || false,
        clearEntry: entry.clearEntry,
    };
}

export function normalizeSwapUserEntry(entry: any): ProjectSwapUserEntry {
    const normalized: any = { ...entry };
    const cancelled = Boolean(normalized.cancelled ?? false);
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
    const userToSwap = normalized.userToSwap || "";

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
 * Timestamp-validated cancellation check for requirement detection.
 * Returns true only if cancelled AND updatedAt is strictly later than createdAt.
 * A missing or zero createdAt means the entry's timestamps can't be trusted,
 * so we treat it as NOT cancelled (fail-safe: require the update).
 *
 * Use this for detecting whether an update is required.
 * Use plain `isCancelled` for admin UI display/filtering.
 */
export function isEffectivelyCancelled(entry: RemoteUpdatingEntry): boolean {
    if (entry.cancelled !== true) return false;
    const created = entry.createdAt || 0;
    const updated = entry.updatedAt || 0;
    return created > 0 && updated > created;
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
    remoteReachable?: boolean;
    /** Why the entry is inactive — only meaningful when required is false and remoteReachable is true */
    entryStatus?: "cancelled" | "executed" | "not_found";
}

interface RemoteProjectRequirementsResult {
    updateRequired: boolean;
    updateReason?: string;
    swapRequired: boolean;
    swapReason?: string;
    swapInfo?: ProjectSwapInfo;
    currentUsername?: string;
    /** The remote metadata that was fetched (for version checks, etc.) */
    remoteMetadata?: ProjectMetadata;
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
        debug("Extracting project ID from URL:", sanitizeGitUrl(gitUrl));

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
 * Fast DNS-based reachability check (~instant when offline, <50ms when online).
 * Returns false immediately on ENOTFOUND instead of waiting for HTTP timeouts.
 */
function canResolveHost(hostname: string, timeoutMs: number = 2000): Promise<boolean> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), timeoutMs);
        dns.lookup(hostname, (err) => {
            clearTimeout(timer);
            resolve(!err);
        });
    });
}

/**
 * Extract hostname from a GitLab base URL or git origin URL.
 * Falls back to a configured default if no URL is available.
 */
function extractGitLabHostname(gitOriginUrl?: string): string | null {
    if (!gitOriginUrl) {
        return null;
    }
    try {
        if (/^https?:\/\//.test(gitOriginUrl)) {
            const parsed = new URL(gitOriginUrl);
            return parsed.hostname || null;
        }
        const sshMatch = gitOriginUrl.match(/git@([^:]+):/);
        if (sshMatch) {
            return sshMatch[1];
        }
    } catch { /* fall through */ }
    return null;
}

/**
 * Fetch metadata.json from the remote repository
 * @param projectId - The GitLab project ID (e.g., "group/project")
 * @param useCache - Whether to use cached data if available
 * @param gitOriginUrl - Optional git origin URL for fast offline detection
 */
export async function fetchRemoteMetadata(
    projectId: string,
    useCache: boolean = true,
    gitOriginUrl?: string
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

        // Fast offline guard: DNS lookup is near-instant when offline,
        // avoiding multiple slow HTTP retry cycles in GitLabService
        const hostname = extractGitLabHostname(gitOriginUrl);
        if (hostname) {
            const reachable = await canResolveHost(hostname);
            if (!reachable) {
                debug("fetchRemoteMetadata: host unreachable (DNS):", hostname);
                return null;
            }
        }

        debug("Fetching remote metadata for project:", projectId);

        const authApi = getAuthApi();
        if (!authApi) {
            debug("Auth API not available");
            return null;
        }

        // Get GitLab service from the auth API
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
        debug("Fetched remote metadata successfully");

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
        const remotes = await dugiteGit.listRemotes(projectPath);
        const origin = remotes.find((r) => r.remote === "origin");

        if (origin) {
            debug("Found git origin URL:", sanitizeGitUrl(origin.url));
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
        const remoteMetadata = await fetchRemoteMetadata(projectId, !bypassCache, gitOriginUrl);
        if (!remoteMetadata) {
            debug("Could not fetch remote metadata, skipping remote updating check");
            return { required: false, reason: "Could not fetch remote metadata" };
        }

        // Check if current user is in the updating list
        // Normalize entries on read to ensure defaults/validation
        const rawList = remoteMetadata.meta?.initiateRemoteUpdatingFor || [];
        const updatingList = rawList.map(entry => normalizeUpdateEntry(entry));

        let isInUpdatingList = false;
        let entryStatus: "cancelled" | "executed" | "not_found" = "not_found";

        for (const entry of updatingList) {
            if (typeof entry === 'object' && entry !== null && entry.userToUpdate === currentUsername) {
                if (!entry.executed && !isEffectivelyCancelled(entry)) {
                    isInUpdatingList = true;
                    break;
                }
                entryStatus = entry.executed ? "executed" : "cancelled";
            }
        }

        if (!isInUpdatingList) {
            debug(`Current user not in active updating list (entryStatus: ${entryStatus})`);
            return { required: false, reason: "User not in updating list", currentUsername, remoteReachable: true, entryStatus };
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
            remoteReachable: true,
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
        debug("Checking remote project requirements for:", projectPath);

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
            debug("Could not extract project ID from URL:", sanitizeGitUrl(gitOriginUrl));
            return {
                updateRequired: false,
                updateReason: "Could not extract project ID",
                swapRequired: false,
                swapReason: "Could not extract project ID",
                currentUsername,
            };
        }

        // Fetch remote metadata once
        const remoteMetadata = await fetchRemoteMetadata(projectId, !bypassCache, gitOriginUrl);
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

        debug("Fetched remote metadata successfully");

        // Update check
        let updateRequired = false;
        let updateReason = "User not in updating list";

        if (currentUsername) {
            const rawList = remoteMetadata.meta?.initiateRemoteUpdatingFor || [];
            const updatingList = rawList.map(entry => normalizeUpdateEntry(entry));
            updateRequired = updatingList.some((entry) =>
                entry.userToUpdate === currentUsername && !entry.executed && !isEffectivelyCancelled(entry)
            );
            if (updateRequired) {
                updateReason = "User in remote updating list";
            }
            debug("Update check: entries =", updatingList.length, "updateRequired =", updateRequired);
        } else {
            updateReason = "No current username";
            debug("No current username, cannot check remote updating list");
        }

        // Swap check
        const swapInfo = remoteMetadata.meta?.projectSwap as RemoteProjectRequirementsResult["swapInfo"] | undefined;
        const swapResult = await evaluateSwapRequirement(swapInfo, currentUsername);
        let swapRequired = swapResult.required;
        let swapReason = swapResult.reason;
        const activeEntry = swapResult.activeEntry;

        // Check if user has already swapped to the new project
        if (swapRequired && activeEntry?.newProjectUrl && currentUsername && swapInfo) {
            const alreadySwapped = await hasUserSwappedInNewProject(swapInfo, currentUsername, activeEntry);
            if (alreadySwapped) {
                swapRequired = false;
                swapReason = "User already swapped to new project";
            }
        }

        // Opportunistically merge remote updating entries into local metadata
        // so that local metadata stays fresh even when sync is blocked.
        try {
            await reconcileUpdatingEntriesWithRemote(projectPath, remoteMetadata);
        } catch {
            debug("Non-fatal: reconciliation during checkRemoteProjectRequirements failed");
        }

        return {
            updateRequired,
            updateReason,
            swapRequired,
            swapReason,
            swapInfo,
            currentUsername,
            remoteMetadata,
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

async function evaluateSwapRequirement(
    swapInfo: RemoteProjectRequirementsResult["swapInfo"],
    currentUsername?: string | null
): Promise<{ required: boolean; reason: string; activeEntry?: ProjectSwapEntry; }> {
    if (!swapInfo) {
        return { required: false, reason: "No swap configured" };
    }

    // Import normalize helpers dynamically to avoid circular deps
    const { normalizeProjectSwapInfo, getActiveSwapEntry } = await import("./projectSwapManager");
    const normalizedSwap = normalizeProjectSwapInfo(swapInfo);
    const activeEntry = getActiveSwapEntry(normalizedSwap);

    // Check for active (pending) swap entry
    if (activeEntry) {
        // isOldProject is now in each entry - only OLD projects trigger swaps
        if (!activeEntry.isOldProject) {
            return { required: false, reason: "Not an old project" };
        }
        return {
            required: true,
            reason: "Project has been swapped to a new repository",
            activeEntry,
        };
    }

    // No active swap entry found
    return { required: false, reason: "No pending swap or swap already completed" };
}

async function hasUserSwappedInNewProject(
    swapInfo: ProjectSwapInfo,
    currentUsername: string,
    activeEntry: ProjectSwapEntry
): Promise<boolean> {
    const newProjectUrl = activeEntry.newProjectUrl;
    if (!newProjectUrl) {
        return false;
    }

    const projectId = extractProjectIdFromUrl(newProjectUrl);
    if (!projectId) {
        return false;
    }

    const remoteMetadata = await fetchRemoteMetadata(projectId, false, newProjectUrl);
    const newSwapInfo = remoteMetadata?.meta?.projectSwap;
    if (!newSwapInfo) {
        return false;
    }

    // Import normalize helpers dynamically
    const { normalizeProjectSwapInfo, findSwapEntryByUUID } = await import("./projectSwapManager");
    const normalizedNewSwap = normalizeProjectSwapInfo(newSwapInfo);

    // Find the matching entry in the new project by swapUUID
    const matchingEntry = findSwapEntryByUUID(normalizedNewSwap, activeEntry.swapUUID);
    if (matchingEntry?.swappedUsers) {
        const normalizedEntries = matchingEntry.swappedUsers.map((entry: ProjectSwapUserEntry) =>
            normalizeSwapUserEntry(entry)
        ) as ProjectSwapUserEntry[];
        return normalizedEntries.some(
            (entry: ProjectSwapUserEntry) => entry.userToSwap === currentUsername && entry.executed
        );
    }

    return false;
}

/**
 * Post-sync reconciliation: fetch remote `initiateRemoteUpdatingFor` and
 * merge into local metadata.json so that entries silently dropped by Git's
 * auto-merge are restored.  Only entries with `clearEntry === true` are
 * removed.  When both local and remote have the same entry (matched by
 * signature), the one with the latest `updatedAt` is used as the base and
 * boolean flags are OR-merged.
 *
 * @returns true if local metadata was updated, false otherwise
 */
export async function reconcileUpdatingEntriesWithRemote(
    projectPath: string,
    preloadedRemoteMetadata?: ProjectMetadata
): Promise<boolean> {
    try {
        debug("Reconciling updating entries with remote for:", projectPath);

        const projectUri = vscode.Uri.file(projectPath);

        // 1. Read local metadata
        const localResult = await MetadataManager.safeReadMetadata<ProjectMetadata>(projectUri);
        if (!localResult.success || !localResult.metadata) {
            debug("Could not read local metadata, skipping reconciliation");
            return false;
        }

        // 2. Use preloaded remote metadata if available; otherwise fetch
        let remoteMetadata = preloadedRemoteMetadata;
        if (!remoteMetadata) {
            const gitOriginUrl = await getGitOriginUrl(projectPath);
            if (!gitOriginUrl) {
                debug("No git origin URL, skipping reconciliation");
                return false;
            }

            const projectId = extractProjectIdFromUrl(gitOriginUrl);
            if (!projectId) {
                debug("Could not extract project ID, skipping reconciliation");
                return false;
            }

            remoteMetadata = (await fetchRemoteMetadata(projectId, false, gitOriginUrl)) ?? undefined;
        }

        if (!remoteMetadata) {
            debug("Remote unreachable, skipping reconciliation");
            return false;
        }

        // 3. Normalize both lists
        const rawLocal = localResult.metadata.meta?.initiateRemoteUpdatingFor ?? [];
        const rawRemote = remoteMetadata.meta?.initiateRemoteUpdatingFor ?? [];
        const localEntries = (Array.isArray(rawLocal) ? rawLocal : []).map(normalizeUpdateEntry);
        const remoteEntries = (Array.isArray(rawRemote) ? rawRemote : []).map(normalizeUpdateEntry);

        // 4. Build maps by signature (userToUpdate + addedBy + createdAt)
        const sig = (e: RemoteUpdatingEntry): string =>
            `${e.userToUpdate}:${e.addedBy}:${e.createdAt}`;

        const localMap = new Map<string, RemoteUpdatingEntry>();
        for (const e of localEntries) {
            localMap.set(sig(e), e);
        }
        const remoteMap = new Map<string, RemoteUpdatingEntry>();
        for (const e of remoteEntries) {
            remoteMap.set(sig(e), e);
        }

        // Collect every known signature
        const allKeys = new Set<string>([...localMap.keys(), ...remoteMap.keys()]);

        // 5. Merge
        const merged: RemoteUpdatingEntry[] = [];
        for (const key of allKeys) {
            const local = localMap.get(key);
            const remote = remoteMap.get(key);

            let entry: RemoteUpdatingEntry;

            if (local && !remote) {
                // Local-only: keep unless clearEntry
                if (local.clearEntry === true) {
                    continue;
                }
                entry = local;
            } else if (!local && remote) {
                // Remote-only: add unless clearEntry
                if (remote.clearEntry === true) {
                    continue;
                }
                entry = remote;
            } else if (local && remote) {
                // Both: take latest updatedAt as base, then OR-merge booleans
                const base = (remote.updatedAt || 0) >= (local.updatedAt || 0)
                    ? { ...remote }
                    : { ...local };

                if (local.executed || remote.executed) {
                    base.executed = true;
                }
                if (local.cancelled || remote.cancelled) {
                    base.cancelled = true;
                    base.cancelledBy =
                        (local.cancelled ? local.cancelledBy : "") ||
                        (remote.cancelled ? remote.cancelledBy : "") ||
                        base.cancelledBy || "";
                }
                if (local.clearEntry === true || remote.clearEntry === true) {
                    base.clearEntry = true;
                }

                base.updatedAt = Math.max(local.updatedAt || 0, remote.updatedAt || 0);
                base.createdAt = Math.min(
                    local.createdAt || Infinity,
                    remote.createdAt || Infinity
                );
                if (base.createdAt === Infinity) {
                    base.createdAt = Date.now();
                }

                if (base.clearEntry === true) {
                    continue;
                }

                entry = base;
            } else {
                continue;
            }

            merged.push(entry);
        }

        // 6. Check if the list actually changed
        const localSorted = [...localEntries].sort((a, b) => sig(a).localeCompare(sig(b)));
        const mergedSorted = [...merged].sort((a, b) => sig(a).localeCompare(sig(b)));

        if (
            localSorted.length === mergedSorted.length &&
            JSON.stringify(localSorted) === JSON.stringify(mergedSorted)
        ) {
            debug("Reconciliation: no changes needed");
            return false;
        }

        // 7. Write back
        debug(`Reconciliation: updating local metadata (${localEntries.length} → ${merged.length} entries)`);
        const writeResult = await MetadataManager.safeUpdateMetadata<ProjectMetadata>(
            projectUri,
            (meta) => {
                if (!meta.meta) {
                    meta.meta = {};
                }
                meta.meta.initiateRemoteUpdatingFor = merged;
                return meta;
            }
        );

        if (!writeResult.success) {
            debug("Failed to write reconciled metadata:", writeResult.error);
            return false;
        }

        debug("Reconciliation complete");
        return true;
    } catch (error) {
        debug("Error during reconciliation (non-fatal):", error);
        return false;
    }
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
        // Normalize entries on read to ensure defaults/validation
        const rawLocalList = localMetadata.meta?.initiateRemoteUpdatingFor || [];
        const localList = rawLocalList.map(entry => normalizeUpdateEntry(entry));

        // Fetch remote metadata to merge the latest updating list (prevents dropping entries)
        let remoteList: RemoteUpdatingEntry[] = [];
        try {
            const remotes = await dugiteGit.listRemotes(projectPath);
            const origin = remotes.find((r) => r.remote === "origin");
            if (origin?.url) {
                const projectId = extractProjectIdFromUrl(origin.url);
                if (projectId) {
                    const remoteMetadata = await fetchRemoteMetadata(projectId, false, origin.url);
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
        const remotes = await dugiteGit.listRemotes(projectPath);
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

