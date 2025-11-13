import * as vscode from "vscode";
import * as path from "path";

const DEBUG = false;
const debug = DEBUG ? (...args: any[]) => console.log("[LocalProjectSettings]", ...args) : () => { };

export type MediaFilesStrategy =
    | "auto-download"     // Download and save media files automatically
    | "stream-and-save"   // Stream media files and save in background
    | "stream-only";      // Stream media files without saving (read from network each time)

export interface LocalProjectSettings {
    currentMediaFilesStrategy?: MediaFilesStrategy;
    lastMediaFileStrategyRun?: MediaFilesStrategy;
    changesApplied?: boolean; // legacy boolean (mirrored from applyState)
    /** Granular state machine for media apply lifecycle */
    mediaFileStrategyApplyState?: "idle" | "pending" | "applying" | "applied" | "failed";
    /** When true, the editor will download/stream audio as soon as a cell opens */
    autoDownloadAudioOnOpen?: boolean;
    /** When true, AI Metrics view shows detailed technical metrics instead of simple mode */
    detailedAIMetrics?: boolean;
    // Legacy keys (read and mirrored for backward compatibility)
    mediaFilesStrategy?: MediaFilesStrategy;
    lastModeRun?: MediaFilesStrategy;
}

const SETTINGS_FILE_NAME = "localProjectSettings.json";

/**
 * Gets the path to the local project settings file
 */
function getSettingsFilePath(workspaceFolderUri?: vscode.Uri): vscode.Uri | null {
    const workspaceFolder = workspaceFolderUri || vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspaceFolder) {
        debug("No workspace folder found");
        return null;
    }
    return vscode.Uri.joinPath(workspaceFolder, ".project", SETTINGS_FILE_NAME);
}

/**
 * Reads the local project settings from disk
 */
export async function readLocalProjectSettings(workspaceFolderUri?: vscode.Uri): Promise<LocalProjectSettings> {
    const settingsPath = getSettingsFilePath(workspaceFolderUri);
    if (!settingsPath) {
        return {};
    }

    try {
        const fileContent = await vscode.workspace.fs.readFile(settingsPath);
        const settings = JSON.parse(Buffer.from(fileContent).toString("utf-8"));
        // Normalize to new canonical keys while keeping legacy fields mirrored in-memory
        const normalized: LocalProjectSettings = { ...settings };
        if (normalized.currentMediaFilesStrategy === undefined && normalized.mediaFilesStrategy !== undefined) {
            normalized.currentMediaFilesStrategy = normalized.mediaFilesStrategy;
        }
        if (normalized.mediaFilesStrategy === undefined && normalized.currentMediaFilesStrategy !== undefined) {
            normalized.mediaFilesStrategy = normalized.currentMediaFilesStrategy;
        }
        if (normalized.lastMediaFileStrategyRun === undefined && normalized.lastModeRun !== undefined) {
            normalized.lastMediaFileStrategyRun = normalized.lastModeRun;
        }
        if (normalized.lastModeRun === undefined && normalized.lastMediaFileStrategyRun !== undefined) {
            normalized.lastModeRun = normalized.lastMediaFileStrategyRun;
        }
        // Derive mediaFileStrategyApplyState from legacy fields if missing
        if (normalized.mediaFileStrategyApplyState === undefined) {
            const legacyApplyState = (settings as any)?.applyState as
                | "idle" | "pending" | "applying" | "applied" | "failed" | undefined;
            if (legacyApplyState !== undefined) {
                normalized.mediaFileStrategyApplyState = legacyApplyState;
            } else if (normalized.changesApplied === true) {
                normalized.mediaFileStrategyApplyState = "applied";
            } else if (normalized.changesApplied === false) {
                normalized.mediaFileStrategyApplyState = "pending";
            }
        }
        // Also keep legacy mirrors aligned in-memory
        if (normalized.mediaFileStrategyApplyState !== undefined) {
            normalized.changesApplied = normalized.mediaFileStrategyApplyState === "applied";
        }
        debug("Read local project settings:", normalized);
        return normalized;
    } catch (error) {
        // File doesn't exist or is invalid - return defaults
        debug("No local project settings found or invalid, returning defaults");
        return {};
    }
}

/**
 * Writes the local project settings to disk
 */
export async function writeLocalProjectSettings(
    settings: LocalProjectSettings,
    workspaceFolderUri?: vscode.Uri
): Promise<void> {
    const settingsPath = getSettingsFilePath(workspaceFolderUri);
    if (!settingsPath) {
        console.error("Cannot write local project settings: No workspace folder found");
        return;
    }

    try {
        // Ensure .project directory exists
        const projectDir = vscode.Uri.joinPath(
            workspaceFolderUri || vscode.workspace.workspaceFolders![0].uri,
            ".project"
        );

        try {
            await vscode.workspace.fs.createDirectory(projectDir);
        } catch (error) {
            // Directory might already exist, that's fine
        }

        // Write settings file with new canonical keys only
        const toWrite: LocalProjectSettings = {
            currentMediaFilesStrategy: settings.currentMediaFilesStrategy ?? settings.mediaFilesStrategy,
            lastMediaFileStrategyRun: settings.lastMediaFileStrategyRun ?? settings.lastModeRun,
            mediaFileStrategyApplyState: settings.mediaFileStrategyApplyState ?? (settings as any).applyState,
            autoDownloadAudioOnOpen: settings.autoDownloadAudioOnOpen,
            detailedAIMetrics: settings.detailedAIMetrics,
        };
        const content = JSON.stringify(toWrite, null, 2);
        await vscode.workspace.fs.writeFile(settingsPath, Buffer.from(content, "utf-8"));
        debug("Wrote local project settings:", toWrite);
    } catch (error) {
        console.error("Failed to write local project settings:", error);
        throw error;
    }
}

/**
 * Gets the media files strategy for the current project
 */
export async function getMediaFilesStrategy(workspaceFolderUri?: vscode.Uri): Promise<MediaFilesStrategy | undefined> {
    const settings = await readLocalProjectSettings(workspaceFolderUri);
    return settings.currentMediaFilesStrategy ?? settings.mediaFilesStrategy;
}

/**
 * Sets the media files strategy for the current project
 */
export async function setMediaFilesStrategy(
    strategy: MediaFilesStrategy,
    workspaceFolderUri?: vscode.Uri
): Promise<void> {
    const settings = await readLocalProjectSettings(workspaceFolderUri);
    settings.mediaFilesStrategy = strategy; // legacy mirror
    settings.currentMediaFilesStrategy = strategy;
    await writeLocalProjectSettings(settings, workspaceFolderUri);
}

export async function setLastModeRun(
    mode: MediaFilesStrategy,
    workspaceFolderUri?: vscode.Uri
): Promise<void> {
    const settings = await readLocalProjectSettings(workspaceFolderUri);
    settings.lastModeRun = mode; // legacy mirror
    settings.lastMediaFileStrategyRun = mode;
    await writeLocalProjectSettings(settings, workspaceFolderUri);
}

// Legacy wrapper (kept for compatibility). Prefer setApplyState.
export async function setChangesApplied(
    applied: boolean,
    workspaceFolderUri?: vscode.Uri
): Promise<void> {
    await setApplyState(applied ? "applied" : "pending", workspaceFolderUri);
}

// Legacy wrapper (kept for compatibility). Prefer getApplyState.
export async function getFlags(workspaceFolderUri?: vscode.Uri): Promise<Pick<LocalProjectSettings, "lastModeRun" | "changesApplied">> {
    const settings = await readLocalProjectSettings(workspaceFolderUri);
    return { lastModeRun: settings.lastModeRun, changesApplied: settings.mediaFileStrategyApplyState === "applied" };
}

// New explicit helpers (preferred over legacy boolean)
export async function getApplyState(workspaceFolderUri?: vscode.Uri): Promise<NonNullable<LocalProjectSettings["mediaFileStrategyApplyState"]> | undefined> {
    const s = await readLocalProjectSettings(workspaceFolderUri);
    return s.mediaFileStrategyApplyState;
}

export async function setApplyState(
    state: NonNullable<LocalProjectSettings["mediaFileStrategyApplyState"]>,
    workspaceFolderUri?: vscode.Uri,
    meta?: { error?: string; }
): Promise<void> {
    const s = await readLocalProjectSettings(workspaceFolderUri);
    s.mediaFileStrategyApplyState = state;
    // Keep the state minimal; no timestamps or error strings persisted
    s.changesApplied = state === "applied"; // keep mirror until full removal
    await writeLocalProjectSettings(s, workspaceFolderUri);
}

/**
 * Gets the media files strategy for a project by path
 */
export async function getMediaFilesStrategyForPath(projectPath: string): Promise<MediaFilesStrategy | undefined> {
    const projectUri = vscode.Uri.file(projectPath);
    return getMediaFilesStrategy(projectUri);
}

/**
 * Ensure the localProjectSettings.json file exists. If missing, create it
 * with sensible defaults that avoid unnecessary work.
 */
export async function ensureLocalProjectSettingsExists(
    workspaceFolderUri?: vscode.Uri,
    defaults?: Partial<LocalProjectSettings>
): Promise<void> {
    const settingsPath = getSettingsFilePath(workspaceFolderUri);
    if (!settingsPath) return;

    // Probe existence
    let exists = true;
    try {
        await vscode.workspace.fs.stat(settingsPath);
    } catch {
        exists = false;
    }
    if (exists) return;

    // Create with defaults
    const def: LocalProjectSettings = {
        currentMediaFilesStrategy: "auto-download",
        lastMediaFileStrategyRun: "auto-download",
        changesApplied: true,
        mediaFileStrategyApplyState: "applied",
        autoDownloadAudioOnOpen: false,
        ...(defaults || {}),
    };
    await writeLocalProjectSettings(def, workspaceFolderUri);
}

export async function getAutoDownloadAudioOnOpen(workspaceFolderUri?: vscode.Uri): Promise<boolean> {
    const settings = await readLocalProjectSettings(workspaceFolderUri);
    return !!settings.autoDownloadAudioOnOpen;
}

export async function setAutoDownloadAudioOnOpen(
    value: boolean,
    workspaceFolderUri?: vscode.Uri
): Promise<void> {
    const settings = await readLocalProjectSettings(workspaceFolderUri);
    settings.autoDownloadAudioOnOpen = !!value;
    await writeLocalProjectSettings(settings, workspaceFolderUri);
}

