import * as vscode from "vscode";
import semver from "semver";
import { getFrontierVersionStatus, REQUIRED_FRONTIER_VERSION } from "../projectManager/utils/versionChecks";
import { MetadataManager } from "./metadataManager";

/** Minimal shape of metadata we need for version checking (compatible with ProjectMetadata) */
interface MetadataWithRequiredExtensions {
    meta?: {
        requiredExtensions?: {
            codexEditor?: string;
            frontierAuthentication?: string;
        };
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

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

// ─── Version gates for swap / update / copy operations ────────────────────────

/**
 * Pick the higher of two semver strings. Returns undefined if both are undefined.
 */
const maxVersion = (a?: string, b?: string): string | undefined => {
    if (!a) return b;
    if (!b) return a;
    return semver.gte(a, b) ? a : b;
};

interface VersionCheckResult {
    allowed: boolean;
    /** Human-readable details when blocked */
    details?: string;
}

/**
 * Check installed extension versions against the requirements from metadata.json
 * (both local project and optionally remote/target project) **and** against the
 * hard-coded REQUIRED_FRONTIER_VERSION.
 *
 * Meant to be called before swap, update, or copy-to-new-project operations.
 *
 * @param projectPath   Absolute path to the *local* project whose metadata should be read.
 * @param options.remoteMetadata  Optional remote/target project metadata whose
 *                                requiredExtensions will also be checked.
 * @param options.operationLabel  User-facing label for the blocked-operation modal
 *                                (e.g. "Project Swap", "Project Update").
 * @returns `{ allowed: true }` when the operation may proceed, or
 *          `{ allowed: false, details }` after showing a blocking modal.
 */
export async function ensureExtensionVersionsForSwapOrUpdate(
    projectPath: string,
    options?: {
        remoteMetadata?: MetadataWithRequiredExtensions;
        operationLabel?: string;
    }
): Promise<VersionCheckResult> {
    const label = options?.operationLabel ?? "To proceed";

    // 1. Read local metadata.json requiredExtensions
    let localRequired: { codexEditor?: string; frontierAuthentication?: string } = {};
    try {
        const projectUri = vscode.Uri.file(projectPath);
        const result = await MetadataManager.getExtensionVersions(projectUri);
        if (result.success && result.versions) {
            localRequired = result.versions;
        }
    } catch {
        // If we can't read local metadata, proceed with empty local requirements
    }

    // 2. Read remote metadata requiredExtensions (if provided)
    const remoteRequired = options?.remoteMetadata?.meta?.requiredExtensions ?? {};

    // 3. Compute the effective required versions (max of local, remote)
    const requiredCodex = maxVersion(localRequired.codexEditor, remoteRequired.codexEditor);
    const requiredFrontier = maxVersion(
        // Take the max across local metadata, remote metadata, AND the hard-coded constant
        maxVersion(localRequired.frontierAuthentication, remoteRequired.frontierAuthentication),
        REQUIRED_FRONTIER_VERSION
    );

    // 4. Get installed versions
    const installedCodex = MetadataManager.getCurrentExtensionVersion(
        "project-accelerate.codex-editor-extension"
    );
    const installedFrontier = MetadataManager.getCurrentExtensionVersion(
        "frontier-rnd.frontier-authentication"
    );

    // 5. Compare and collect outdated extension display names
    const outdatedNames: string[] = [];

    if (requiredCodex) {
        if (!installedCodex || semver.lt(installedCodex, requiredCodex)) {
            outdatedNames.push("Codex Editor");
        }
    }

    if (requiredFrontier) {
        if (!installedFrontier || semver.lt(installedFrontier, requiredFrontier)) {
            outdatedNames.push("Frontier Authentication");
        }
    }

    if (outdatedNames.length === 0) {
        return { allowed: true };
    }

    // 6. Build message matching the frontier-authentication style:
    //    "To <operation>, please update your extension(s):\n- Name"
    const extWord = outdatedNames.length === 1 ? "extension" : "extensions";
    const bullets = outdatedNames.map((n) => `- ${n}`).join("\n");
    const details = `${label}, please update your ${extWord}:\n${bullets}`;

    const selection = await vscode.window.showWarningMessage(
        details,
        { modal: true },
        "Update Extensions"
    );

    if (selection === "Update Extensions") {
        await vscode.commands.executeCommand("workbench.view.extensions");
    }

    return { allowed: false, details };
}


