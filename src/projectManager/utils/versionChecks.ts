import * as vscode from "vscode";
import semver from "semver";

interface VSCodeVersionStatus {
    ok: boolean;
    installedVersion?: string;
    requiredVersion: string;
}

// Required version of Frontier Authentication extension for all syncing operations (based on codex minimum requirements)
export const REQUIRED_FRONTIER_VERSION = "0.4.18"; // Prevent concurrent metadata.json changes by Frontier Authentication

// Required VS Code version for Codex Editor
export const REQUIRED_VSCODE_VERSION = "1.99.0";

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

/**
 * Checks if VS Code meets the minimum version requirement
 * @returns Object indicating if version check passes
 */
export function checkVSCodeVersion(): VSCodeVersionStatus {
    const installedVersion = vscode.version;

    if (semver.lt(installedVersion, REQUIRED_VSCODE_VERSION)) {
        return {
            ok: false,
            installedVersion,
            requiredVersion: REQUIRED_VSCODE_VERSION
        };
    }

    return {
        ok: true,
        installedVersion,
        requiredVersion: REQUIRED_VSCODE_VERSION
    };
}


