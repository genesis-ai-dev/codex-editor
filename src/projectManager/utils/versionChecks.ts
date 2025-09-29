import * as vscode from "vscode";
import semver from "semver";

// Required version of Frontier Authentication extension for all syncing operations (based on codex minimum requirements)
export const REQUIRED_FRONTIER_VERSION = "0.4.16"; // Updated to 0.4.16 to prevent concurrent metadata.json changes by Frontier Authentication

/**
 * Checks if the Frontier Authentication extension meets the minimum version requirement
 * @returns true if version check passes, false otherwise
 */
export async function getFrontierVersionStatus(): Promise<{ ok: boolean; installedVersion?: string; requiredVersion: string; }> {
    const frontierExt = vscode.extensions.getExtension("frontier-rnd.frontier-authentication");
    const installedVersion: string | undefined = (frontierExt as any)?.packageJSON?.version;

    if (!installedVersion || !semver.gte(installedVersion, REQUIRED_FRONTIER_VERSION)) {
        return { ok: false, installedVersion, requiredVersion: REQUIRED_FRONTIER_VERSION };
    }

    return { ok: true, installedVersion, requiredVersion: REQUIRED_FRONTIER_VERSION };
}


