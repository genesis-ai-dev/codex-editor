import * as vscode from "vscode";
import { ProjectMetadata, ProjectSwapInfo } from "../../types";
import * as crypto from "crypto";
import git from "isomorphic-git";
import fs from "fs";

const DEBUG = false;
const debug = DEBUG ? (...args: any[]) => console.log("[ProjectSwap]", ...args) : () => { };

/**
 * Check if a project swap is required for the current project
 * @param projectPath - Path to the project directory
 * @param currentUsername - Username of the current user (optional)
 * @returns Object indicating if swap is required and details
 */
export async function checkProjectSwapRequired(
    projectPath: string,
    currentUsername?: string
): Promise<{
    required: boolean;
    reason: string;
    swapInfo?: ProjectSwapInfo;
}> {
    try {
        debug("Checking project swap requirement for:", projectPath);

        // Read metadata
        const metadataPath = vscode.Uri.file(`${projectPath}/metadata.json`);
        const metadataBuffer = await vscode.workspace.fs.readFile(metadataPath);
        const metadata = JSON.parse(Buffer.from(metadataBuffer).toString("utf-8")) as ProjectMetadata;

        if (!metadata?.meta?.projectSwap) {
            debug("No project swap information found");
            return { required: false, reason: "No swap configured" };
        }

        const swapInfo = metadata.meta.projectSwap;

        // Check if this is the old project that needs migration
        if (swapInfo.isOldProject && swapInfo.swapStatus === "pending") {
            debug("Project swap required - old project needs migration");
            return {
                required: true,
                reason: "Project has been migrated to a new repository",
                swapInfo,
            };
        }

        // If swap is migrating or failed, still require user to deal with it
        if (swapInfo.isOldProject && (swapInfo.swapStatus === "migrating" || swapInfo.swapStatus === "failed")) {
            debug("Project swap in progress or failed");
            return {
                required: true,
                reason: swapInfo.swapStatus === "migrating" ? "Migration in progress" : "Migration failed - needs retry",
                swapInfo,
            };
        }

        debug("Project swap not required");
        return { required: false, reason: "Swap already completed or not applicable", swapInfo };
    } catch (error) {
        debug("Error checking project swap requirement:", error);
        return { required: false, reason: `Error: ${error}` };
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
