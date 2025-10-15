import * as vscode from "vscode";
import * as path from "path";

const DEBUG = false;
const debug = DEBUG ? (...args: any[]) => console.log("[LocalProjectSettings]", ...args) : () => { };

export type MediaFilesStrategy =
    | "auto-download"     // Download and save media files automatically
    | "stream-and-save"   // Stream media files and save in background
    | "stream-only";      // Stream media files without saving (read from network each time)

export interface LocalProjectSettings {
    mediaFilesStrategy?: MediaFilesStrategy;
    lastModeRun?: MediaFilesStrategy;
    changesApplied?: boolean;
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
        debug("Read local project settings:", settings);
        return settings;
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

        // Write settings file
        const content = JSON.stringify(settings, null, 2);
        await vscode.workspace.fs.writeFile(settingsPath, Buffer.from(content, "utf-8"));
        debug("Wrote local project settings:", settings);
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
    return settings.mediaFilesStrategy;
}

/**
 * Sets the media files strategy for the current project
 */
export async function setMediaFilesStrategy(
    strategy: MediaFilesStrategy,
    workspaceFolderUri?: vscode.Uri
): Promise<void> {
    const settings = await readLocalProjectSettings(workspaceFolderUri);
    settings.mediaFilesStrategy = strategy;
    await writeLocalProjectSettings(settings, workspaceFolderUri);
}

export async function setLastModeRun(
    mode: MediaFilesStrategy,
    workspaceFolderUri?: vscode.Uri
): Promise<void> {
    const settings = await readLocalProjectSettings(workspaceFolderUri);
    settings.lastModeRun = mode;
    await writeLocalProjectSettings(settings, workspaceFolderUri);
}

export async function setChangesApplied(
    applied: boolean,
    workspaceFolderUri?: vscode.Uri
): Promise<void> {
    const settings = await readLocalProjectSettings(workspaceFolderUri);
    settings.changesApplied = applied;
    await writeLocalProjectSettings(settings, workspaceFolderUri);
}

export async function getFlags(workspaceFolderUri?: vscode.Uri): Promise<Pick<LocalProjectSettings, "lastModeRun" | "changesApplied">> {
    const settings = await readLocalProjectSettings(workspaceFolderUri);
    return { lastModeRun: settings.lastModeRun, changesApplied: settings.changesApplied };
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
        mediaFilesStrategy: "auto-download",
        lastModeRun: "auto-download",
        changesApplied: true,
        ...(defaults || {}),
    };
    await writeLocalProjectSettings(def, workspaceFolderUri);
}

