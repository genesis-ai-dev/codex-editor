import * as vscode from "vscode";
import { extractProjectIdFromUrl, fetchProjectMembers } from "./remoteUpdatingManager";

/**
 * Check if current user has permission to perform project administration tasks
 * (e.g. remote updates, project swaps)
 * Requires Maintainer (40) or Owner (50) access level
 * @returns Object with hasPermission flag and optional error message
 */
export async function checkProjectAdminPermissions(): Promise<{ hasPermission: boolean; error?: string; currentUser?: string; }> {
    try {
        // Check if we're in a workspace
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return { hasPermission: false, error: "No workspace folder open" };
        }

        const workspacePath = workspaceFolder.uri.fsPath;

        // Get git origin URL
        let gitOriginUrl: string;
        try {
            const git = await import("isomorphic-git");
            const fs = await import("fs");
            const remotes = await git.listRemotes({ fs, dir: workspacePath });
            const origin = remotes.find((r) => r.remote === "origin");

            if (!origin) {
                return { hasPermission: false, error: "No git remote origin found" };
            }

            gitOriginUrl = origin.url;
        } catch (error) {
            return { hasPermission: false, error: "Failed to get git remote" };
        }

        // Extract project ID from URL
        const projectId = extractProjectIdFromUrl(gitOriginUrl);
        if (!projectId) {
            return { hasPermission: false, error: "Could not extract project ID from git URL" };
        }

        // Check user permissions
        const authApi = (await import("../extension")).getAuthApi();
        if (!authApi) {
            return { hasPermission: false, error: "Authentication not available" };
        }

        const currentUserInfo = await authApi.getUserInfo();
        if (!currentUserInfo || !currentUserInfo.username) {
            return { hasPermission: false, error: "Could not determine current user" };
        }

        // Fetch project members to check current user's role
        const memberList = await fetchProjectMembers(projectId);
        if (!memberList) {
            return { hasPermission: false, error: "Could not fetch project members" };
        }

        // Find current user's role
        const currentUserMember = memberList.find(
            m => m.username === currentUserInfo.username || m.email === currentUserInfo.email
        );

        if (!currentUserMember) {
            return { hasPermission: false, error: "User not found in project members", currentUser: currentUserInfo.username };
        }

        // Check if user has sufficient permissions (Maintainer = 40, Owner = 50)
        if (currentUserMember.accessLevel < 40) {
            return { hasPermission: false, error: "Insufficient permissions", currentUser: currentUserInfo.username };
        }

        return { hasPermission: true, currentUser: currentUserInfo.username };
    } catch (error) {
        return { hasPermission: false, error: `Permission check failed: ${error instanceof Error ? error.message : String(error)}` };
    }
}
