import * as vscode from "vscode";
import { getFrontierVersionStatus } from "../projectManager/utils/versionChecks";

/**
 * Ensures Frontier extension meets minimum installed version (local check).
 * Shows the same blocking warning used by sync when not satisfied.
 * Returns true if allowed to proceed.
 */
export async function ensureFrontierInstalledVersionForMedia(): Promise<boolean> {
    const status = await getFrontierVersionStatus();
    if (!status.ok) {
        const details = status.installedVersion
            ? `Frontier Authentication v${status.requiredVersion} or newer is required to download or stream media.`
            : `Frontier Authentication not found. v${status.requiredVersion} or newer is required to download or stream media.`;
        await vscode.window.showWarningMessage(details, { modal: true });
        return false;
    }
    return true;
}

/**
 * Runs the project metadata version checks (both Codex and Frontier minimum
 * project versions from metadata.json) using the Frontier extension's
 * existing blocking modal. Returns true if allowed to proceed.
 */
export async function ensureProjectMetadataVersionsForMedia(isManual = true): Promise<boolean> {
    try {
        // Ask the Frontier extension to run the same blocking modal used for sync
        const allow = (await vscode.commands.executeCommand(
            "frontier.checkMetadataVersionsForSync",
            { isManualSync: isManual }
        )) as boolean | undefined;
        return !!allow;
    } catch (e) {
        // If the command isn't available, try a fallback command if present; otherwise block
        console.warn("Version check command not available, attempting remote metadata check fallback:", e);
        try {
            const hasMismatch = await vscode.commands.executeCommand<boolean>(
                "frontier.checkRemoteMetadataVersionMismatch"
            );
            if (hasMismatch === false) return true;
        } catch (err) {
            console.warn("Remote metadata version check command missing or failed:", err);
        }
        await vscode.window.showWarningMessage(
            "Remote project requires newer extensions. Please update to sync or download media.",
            { modal: true }
        );
        return false;
    }
}

/**
 * Convenience helper to enforce both local Frontier min version and project
 * metadata version gates for media operations.
 */
export async function ensureAllVersionGatesForMedia(isManual = true): Promise<boolean> {
    const frontierOk = await ensureFrontierInstalledVersionForMedia();
    if (!frontierOk) return false;
    const metaOk = await ensureProjectMetadataVersionsForMedia(isManual);
    return !!metaOk;
}


