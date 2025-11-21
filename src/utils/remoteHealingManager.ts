import * as vscode from "vscode";
import { getAuthApi } from "../extension";
import { MetadataManager } from "./metadataManager";
import * as git from "isomorphic-git";
import * as fs from "fs";

const DEBUG = false;
const debug = DEBUG ? (...args: any[]) => console.log("[RemoteHealing]", ...args) : () => { };

export interface RemoteHealingEntry {
    userToHeal: string;
    addedBy: string;
    createdAt: number;
    updatedAt: number;
    deleted: boolean;
    deletedBy: string;
    executed: boolean;
}

interface ProjectMetadata {
    meta?: {
        initiateRemoteHealingFor?: RemoteHealingEntry[];
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

interface RemoteHealingCheckResult {
    required: boolean;
    reason?: string;
    currentUsername?: string;
    currentUserEmail?: string;
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
 * Check if remote healing is required for the current user
 * This is the main function called before opening a project
 * 
 * @param projectPath - Local path to the project
 * @param gitOriginUrl - Git origin URL (optional, will be fetched if not provided)
 * @param bypassCache - Whether to bypass the cache and force a network fetch (useful to verify connectivity)
 * @returns Object indicating if healing is required and why
 */
export async function checkRemoteHealingRequired(
    projectPath: string,
    gitOriginUrl?: string,
    bypassCache: boolean = false
): Promise<RemoteHealingCheckResult> {
    try {
        debug("Checking remote healing requirement for:", projectPath);

        // Get current username
        const currentUsername = await getCurrentUsername();
        if (!currentUsername) {
            debug("Cannot determine current username, skipping remote healing check");
            return { required: false, reason: "No current username" };
        }

        // Get git origin URL if not provided
        if (!gitOriginUrl) {
            const fetchedUrl = await getGitOriginUrl(projectPath);
            gitOriginUrl = fetchedUrl || undefined;
        }

        if (!gitOriginUrl) {
            debug("No git origin URL found, skipping remote healing check");
            return { required: false, reason: "No git origin URL" };
        }

        // Extract project ID from URL
        const projectId = extractProjectIdFromUrl(gitOriginUrl);
        if (!projectId) {
            debug("Could not extract project ID from URL, skipping remote healing check");
            return { required: false, reason: "Could not extract project ID" };
        }

        // Fetch remote metadata
        const remoteMetadata = await fetchRemoteMetadata(projectId, !bypassCache);
        if (!remoteMetadata) {
            debug("Could not fetch remote metadata, skipping remote healing check");
            return { required: false, reason: "Could not fetch remote metadata" };
        }

        // Check if current user is in the healing list
        const healingList = remoteMetadata.meta?.initiateRemoteHealingFor || [];

        let isInHealingList = false;

        // Check for new objects
        for (const entry of healingList) {
            if (typeof entry === 'object' && entry !== null) {
                if (entry.userToHeal === currentUsername && !entry.executed && !entry.deleted) {
                    isInHealingList = true;
                    break;
                }
            }
        }

        if (!isInHealingList) {
            debug("Current user not in healing list (or executed/deleted)");
            return { required: false, reason: "User not in healing list", currentUsername };
        }

        // User is in remote healing list - healing required
        // Note: We don't check local metadata because users are automatically removed
        // from the remote list after successful healing, so if they're in the remote
        // list, they need to heal regardless of local state
        debug("Remote healing required for user:", currentUsername);
        return {
            required: true,
            reason: "User in remote healing list",
            currentUsername,
        };
    } catch (error) {
        debug("Error checking remote healing requirement:", error);
        return { required: false, reason: `Error: ${error}` };
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
 * Mark a user as having completed remote healing
 * This updates the local metadata.json setting 'executed' to true and pushes the changes
 * 
 * @param projectPath - Path to the project directory
 * @param username - Username to mark as healed
 */
export async function markUserAsHealedInRemoteList(
    projectPath: string,
    username: string
): Promise<void> {
    try {
        debug("Marking user as healed in remote list:", username);

        const projectUri = vscode.Uri.file(projectPath);

        // Read current metadata
        const readResult = await MetadataManager.safeReadMetadata<ProjectMetadata>(projectUri);
        if (!readResult.success || !readResult.metadata) {
            throw new Error("Failed to read metadata.json");
        }

        const metadata = readResult.metadata;
        const healingList = metadata.meta?.initiateRemoteHealingFor || [];

        let listChanged = false;

        const updatedList = healingList
            .filter((entry): entry is RemoteHealingEntry => typeof entry === 'object' && entry !== null)
            .map(entry => {
                // Update existing object
                if (entry.userToHeal === username && !entry.executed) {
                    listChanged = true;
                    return {
                        ...entry,
                        executed: true,
                        updatedAt: Date.now()
                    };
                }
                return entry;
            });

        if (!listChanged) {
            debug("User not pending in healing list, nothing to update");
            return;
        }

        debug("Updated healing list:", updatedList);

        // Update metadata
        const updateResult = await MetadataManager.safeUpdateMetadata<ProjectMetadata>(
            projectUri,
            (meta) => {
                if (!meta.meta) {
                    meta.meta = {};
                }

                meta.meta.initiateRemoteHealingFor = updatedList;
                return meta;
            }
        );

        if (!updateResult.success) {
            throw new Error(updateResult.error || "Failed to update metadata.json");
        }

        debug("Metadata updated successfully, committing and pushing changes...");

        // Trigger sync using the same command as the manual sync button
        const commitMessage = `Marked ${username} as healed in remote healing list`;
        await vscode.commands.executeCommand(
            "codex-editor-extension.triggerSync",
            commitMessage
        );

        debug("Successfully updated remote healing list and triggered sync");

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
        debug("Error marking user as healed:", error);
        throw error;
    }
}

