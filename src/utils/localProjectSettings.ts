import * as vscode from "vscode";
import * as path from "path";
import { MetadataManager } from "./metadataManager";

const DEBUG = false;
const debug = DEBUG ? (...args: any[]) => console.log("[LocalProjectSettings]", ...args) : () => { };

export type MediaFilesStrategy =
    | "auto-download"     // Download and save media files automatically
    | "stream-and-save"   // Stream media files and save in background
    | "stream-only";      // Stream media files without saving (read from network each time)

export type UpdateStep =
    | "backup_done"
    | "moved_original"
    | "clone_done"
    | "merge_done"
    | "swap_done"
    | "cleanup_done";

export interface PendingUpdateState {
    required: boolean;
    reason?: string;
    detectedAt: number;
}

export interface UpdateState {
    projectPath: string;
    projectName: string;
    backupZipPath?: string;
    tempFolderPath?: string;
    backupProjectPath?: string;
    clonePath?: string;
    step?: UpdateStep;
    completedSteps?: UpdateStep[];
    backupMode?: "full" | "data-only";
    createdAt?: number;
}

export interface LocalProjectSettings {
    currentMediaFilesStrategy?: MediaFilesStrategy;
    lastMediaFileStrategyRun?: MediaFilesStrategy;
    changesApplied?: boolean; // legacy boolean (mirrored from applyState)
    /** Optional source repo URL for LFS downloads during publish */
    lfsSourceRemoteUrl?: string;
    /** Granular state machine for media apply lifecycle */
    mediaFileStrategyApplyState?: "idle" | "pending" | "applying" | "applied" | "failed";
    /** 
     * When true, indicates a media strategy switch was started but not completed.
     * Used to detect interrupted switches (e.g., due to crashes) and trigger recovery on next open/switch.
     * Set to true when beginning a strategy switch, false when switch completes successfully.
     */
    mediaFileStrategySwitchStarted?: boolean;
    /**
     * When switching from auto-download to stream-and-save, tracks user's choice.
     * true = keep downloaded files, false = free space (replace with pointers).
     * Cleared after the switch is applied on project open.
     */
    keepFilesOnStreamAndSave?: boolean;
    /**
     * When switching from auto-download to stream-and-save AND local videos exist,
     * the user decides about video and audio separately. These track each choice:
     * true = keep that media type local, false = pointerize it to free space.
     * Cleared after the switch is applied on project open. Used in place of
     * keepFilesOnStreamAndSave when the granular (video-present) prompt is shown.
     */
    keepVideoOnStreamAndSave?: boolean;
    keepAudioOnStreamAndSave?: boolean;
    /**
     * When switching to stream-only AND local videos exist, tracks the user's
     * choice: "keep-video" keeps videos local (added to the allowlist) while
     * freeing the rest; "free-all" frees everything including saved videos
     * (ignores the allowlist). Cleared after the switch is applied on open.
     */
    streamOnlyVideoChoice?: "keep-video" | "free-all";
    /**
     * When switching stream-only -> stream-and-save AND local videos exist,
     * tracks whether to preserve those local videos (true) or pointerize them
     * (false). Cleared after the switch is applied on open.
     */
    streamAndSavePreserveVideos?: boolean;
    /** When true, AI Metrics view shows detailed technical metrics instead of simple mode */
    detailedAIMetrics?: boolean;
    /** Track in-progress update for restart-safe cleanup */
    updateState?: UpdateState;
    /** Track when an admin-triggered update is pending so the projects list can surface it */
    pendingUpdate?: PendingUpdateState;
    /** 
     * Track that update was completed locally but not yet synced to remote.
     * Prevents showing "update required" modal again before sync completes.
     * Cleared after successful sync pushes the executed flag to remote.
     */
    updateCompletedLocally?: {
        username: string;
        completedAt: number;
    };
    /** Track project swap migration state */
    projectSwap?: import("../../types").LocalProjectSwap;
    /** 
     * @deprecated No longer used. Was previously used to trigger a "close project" modal after swap.
     * Kept for backward compatibility with existing localProjectSettings.json files.
     */
    forceCloseAfterSuccessfulSwap?: boolean;
    /** Whether automatic sync is enabled for this project (migrated from .vscode/settings.json) */
    autoSyncEnabled?: boolean;
    /** Delay in minutes before triggering automatic sync after changes (migrated from .vscode/settings.json) */
    syncDelayMinutes?: number;
    /** Cached display name from GitLab API, persisted locally so it survives offline/orphaned states */
    displayedProjectName?: string;
    /**
     * Per-machine version of the audio metadata schema this project's local
     * .codex files have been migrated to. Bumped whenever a new one-shot audio
     * migration ships; the migrator runs every step from `currentVersion + 1`
     * through `CURRENT_AUDIO_SCHEMA_VERSION` and persists the new value here
     * on success. Stored locally (this file is gitignored) so each machine
     * processes its own .codex files regardless of CRDT sync ordering.
     *
     * Versions:
     *   1 — backfill `selectedAudioId` + `selectionTimestamp` on legacy cells
     *       (pre-Aug-18-2025) that have at least one valid audio attachment
     *       (not deleted, not missing) and no explicit selection.
     */
    audioSchemaVersion?: number;
    /**
     * Rel-paths (within `.project/attachments/files`, e.g. "JUD/JUD_001_025.mp4")
     * that the user explicitly chose to keep on this machine via "Save to project".
     * These are protected from the stream-only pointer-replacement cleanup
     * (`postSyncCleanup` / strategy switches) so they survive reloads. Stored
     * locally (this file is gitignored) because the saved copy is a per-machine
     * download — `attachments/files/**` is gitignored too. Video-only by design.
     */
    persistedMediaFiles?: string[];
    // Legacy keys (read and mirrored for backward compatibility)
    mediaFilesStrategy?: MediaFilesStrategy;
    lastModeRun?: MediaFilesStrategy;
}

/**
 * Current target audio metadata schema version. Increment when adding a new
 * one-shot audio migration step in `AudioAttachmentsMigrator.runAudioSchemaMigrations`.
 */
export const CURRENT_AUDIO_SCHEMA_VERSION = 1;

const SETTINGS_FILE_NAME = "localProjectSettings.json";

/**
 * Serializes every write to localProjectSettings.json. Because writers do a
 * read-modify-write (read existing JSON, merge, write), concurrent writers
 * could otherwise clobber each other's changes — this is what intermittently
 * dropped freshly-added `persistedMediaFiles` entries when a save raced an
 * unrelated settings write. Each enqueued task reads the latest on-disk state
 * inside the lock, so there's no stale-snapshot overwrite.
 */
// One serialization chain PER workspace (keyed by settings-file fsPath), not a
// single global chain. Clobbering can only happen between writes to the SAME
// settings file, so serializing per workspace is both sufficient and correct.
// A global chain is also dangerous: a single task that never settles (e.g. an
// fs operation stubbed to hang in a test, or a stalled disk) would deadlock
// every future settings write across unrelated projects. Per-workspace chains
// keep one project's stall from poisoning another's.
const settingsWriteChains = new Map<string, Promise<unknown>>();
function enqueueSettingsWrite<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = settingsWriteChains.get(key) ?? Promise.resolve();
    const run = previous.then(task, task);
    // Keep the chain alive even if a task rejects.
    const tail = run.then(
        () => undefined,
        () => undefined
    );
    settingsWriteChains.set(key, tail);
    // Drop the entry once it has drained so the map can't grow unbounded.
    tail.finally(() => {
        if (settingsWriteChains.get(key) === tail) {
            settingsWriteChains.delete(key);
        }
    });
    return run;
}

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
        // Normalize to new canonical keys
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
 * Registers as a pending write operation to ensure completion before folder switches
 */
export async function writeLocalProjectSettings(
    settings: LocalProjectSettings,
    workspaceFolderUri?: vscode.Uri
): Promise<void> {
    const workspaceUri = workspaceFolderUri || vscode.workspace.workspaceFolders?.[0]?.uri;
    const settingsPath = getSettingsFilePath(workspaceFolderUri);
    if (!settingsPath || !workspaceUri) {
        console.error("Cannot write local project settings: No workspace folder found");
        return;
    }

    // Create a promise for the write operation and register it. Serialize through
    // the settings write chain so concurrent read-modify-write cycles can't clobber
    // each other (notably the persistedMediaFiles allowlist).
    const writePromise = enqueueSettingsWrite(workspaceUri.fsPath, () =>
        writeLocalProjectSettingsInternal(settings, workspaceFolderUri, settingsPath)
    );

    // Register this write operation with MetadataManager's tracking system
    // This ensures waitForPendingWrites will wait for this operation
    MetadataManager.registerPendingWrite(workspaceUri.fsPath, writePromise);

    return writePromise;
}

/**
 * Atomically read-modify-write the settings file. The mutator runs inside the
 * shared write lock against the LATEST on-disk state, so concurrent updates
 * (e.g. setApplyState racing setMediaFilesStrategy) can't clobber each other's
 * fields. Prefer this over readLocalProjectSettings + writeLocalProjectSettings
 * for single-field setters.
 */
export function updateLocalProjectSettings(
    mutator: (settings: LocalProjectSettings) => void,
    workspaceFolderUri?: vscode.Uri
): Promise<void> {
    const workspaceUri = workspaceFolderUri || vscode.workspace.workspaceFolders?.[0]?.uri;
    const settingsPath = getSettingsFilePath(workspaceFolderUri);
    if (!settingsPath || !workspaceUri) {
        console.error("Cannot update local project settings: No workspace folder found");
        return Promise.resolve();
    }

    const writePromise = enqueueSettingsWrite(workspaceUri.fsPath, async () => {
        const latest = await readLocalProjectSettings(workspaceFolderUri);
        mutator(latest);
        await writeLocalProjectSettingsInternal(latest, workspaceFolderUri, settingsPath);
    });

    MetadataManager.registerPendingWrite(workspaceUri.fsPath, writePromise);
    return writePromise;
}

/**
 * Internal implementation of writeLocalProjectSettings
 */
async function writeLocalProjectSettingsInternal(
    settings: LocalProjectSettings,
    workspaceFolderUri: vscode.Uri | undefined,
    settingsPath: vscode.Uri
): Promise<void> {
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

        // Build settings with canonical keys, but preserve any existing custom fields
        // Always apply defaults for core media strategy keys to ensure they're always written
        const toWrite: LocalProjectSettings = {
            currentMediaFilesStrategy: settings.currentMediaFilesStrategy ?? settings.mediaFilesStrategy ?? "auto-download",
            lastMediaFileStrategyRun: settings.lastMediaFileStrategyRun ?? settings.lastModeRun ?? "auto-download",
            mediaFileStrategyApplyState: settings.mediaFileStrategyApplyState ?? (settings as any).applyState ?? "applied",
            mediaFileStrategySwitchStarted: settings.mediaFileStrategySwitchStarted ?? false,
            keepFilesOnStreamAndSave: settings.keepFilesOnStreamAndSave,
            keepVideoOnStreamAndSave: settings.keepVideoOnStreamAndSave,
            keepAudioOnStreamAndSave: settings.keepAudioOnStreamAndSave,
            streamOnlyVideoChoice: settings.streamOnlyVideoChoice,
            streamAndSavePreserveVideos: settings.streamAndSavePreserveVideos,
            forceCloseAfterSuccessfulSwap: settings.forceCloseAfterSuccessfulSwap,
            detailedAIMetrics: settings.detailedAIMetrics,
            lfsSourceRemoteUrl: settings.lfsSourceRemoteUrl,
            updateState: settings.updateState,
            pendingUpdate: settings.pendingUpdate,
            updateCompletedLocally: settings.updateCompletedLocally,
            projectSwap: settings.projectSwap,
            autoSyncEnabled: settings.autoSyncEnabled ?? true,
            syncDelayMinutes: settings.syncDelayMinutes ?? 5,
            displayedProjectName: settings.displayedProjectName,
            // NOTE: persistedMediaFiles is intentionally NOT written here. It is
            // owned exclusively by addPersistedMediaFile/removePersistedMediaFile
            // (which mutate it atomically under the same write lock). General
            // writers preserve the on-disk value via the existingRaw spread below,
            // so an unrelated settings write can never clobber the allowlist.
        };
        let existingRaw: Record<string, any> = {};
        try {
            const existingContent = await vscode.workspace.fs.readFile(settingsPath);
            existingRaw = JSON.parse(Buffer.from(existingContent).toString("utf-8")) ?? {};
        } catch {
            existingRaw = {};
        }
        const merged = { ...existingRaw, ...toWrite };
        // Drop dead keys from superseded approaches so the file cleans itself up.
        delete (merged as Record<string, unknown>).ephemeralStreamMedia;
        const content = JSON.stringify(merged, null, 2);
        await vscode.workspace.fs.writeFile(settingsPath, Buffer.from(content, "utf-8"));
        debug("Wrote local project settings:", merged);
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
    await updateLocalProjectSettings((settings) => {
        settings.mediaFilesStrategy = strategy; // legacy mirror
        settings.currentMediaFilesStrategy = strategy;
    }, workspaceFolderUri);
}

export async function setLastModeRun(
    mode: MediaFilesStrategy,
    workspaceFolderUri?: vscode.Uri
): Promise<void> {
    await updateLocalProjectSettings((settings) => {
        settings.lastModeRun = mode; // legacy mirror
        settings.lastMediaFileStrategyRun = mode;
    }, workspaceFolderUri);
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

export async function markPendingUpdateRequired(
    workspaceFolderUri?: vscode.Uri,
    reason?: string
): Promise<void> {
    await updateLocalProjectSettings((settings) => {
        settings.pendingUpdate = {
            required: true,
            reason,
            detectedAt: Date.now(),
        };
    }, workspaceFolderUri);
}

export async function clearPendingUpdate(
    workspaceFolderUri?: vscode.Uri
): Promise<void> {
    await updateLocalProjectSettings((settings) => {
        if (settings.pendingUpdate) {
            settings.pendingUpdate = undefined;
        }
    }, workspaceFolderUri);
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
    await updateLocalProjectSettings((s) => {
        s.mediaFileStrategyApplyState = state;
        // Keep the state minimal; no timestamps or error strings persisted
        s.changesApplied = state === "applied"; // keep mirror until full removal
    }, workspaceFolderUri);
}

/**
 * Gets the media files strategy for a project by path
 */
export async function getMediaFilesStrategyForPath(projectPath: string): Promise<MediaFilesStrategy | undefined> {
    const projectUri = vscode.Uri.file(projectPath);
    return getMediaFilesStrategy(projectUri);
}

/**
 * Canonical key for the persisted-media allowlist: the path *within*
 * `attachments/files` (equivalently `attachments/pointers`), e.g.
 * "JUD/JUD_001_025.mp4". Normalized to forward slashes with no leading slash so
 * comparisons are stable across OSes and against the OS-native `relPath`s used
 * by the cleanup functions.
 */
export function normalizePersistedMediaRelPath(relPath: string): string {
    return relPath.replace(/\\/g, "/").replace(/^\/+/, "");
}

/**
 * Returns the list of media rel-paths the user explicitly saved (allowlist).
 * Always returns an array (empty when none/invalid).
 */
export async function getPersistedMediaFiles(workspaceFolderUri?: vscode.Uri): Promise<string[]> {
    const settings = await readLocalProjectSettings(workspaceFolderUri);
    return Array.isArray(settings.persistedMediaFiles) ? settings.persistedMediaFiles : [];
}

/**
 * Atomically mutate the persisted-media allowlist. Reads the LATEST on-disk
 * value inside the shared settings write lock, applies `mutator`, and writes it
 * back — so concurrent saves and unrelated settings writes can never drop an
 * entry. This is the sole writer of `persistedMediaFiles` (general writes leave
 * the key untouched). Other settings fields in the file are preserved.
 */
function updatePersistedMediaFiles(
    workspaceFolderUri: vscode.Uri | undefined,
    mutator: (current: string[]) => string[]
): Promise<void> {
    const settingsPath = getSettingsFilePath(workspaceFolderUri);
    const workspaceUri = workspaceFolderUri || vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!settingsPath || !workspaceUri) {
        return Promise.resolve();
    }

    const writePromise = enqueueSettingsWrite(workspaceUri.fsPath, async () => {
        try {
            await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(workspaceUri, ".project"));
        } catch {
            // Directory likely exists already.
        }

        let raw: Record<string, any> = {};
        try {
            const content = await vscode.workspace.fs.readFile(settingsPath);
            raw = JSON.parse(Buffer.from(content).toString("utf-8")) ?? {};
        } catch {
            raw = {};
        }

        const current = Array.isArray(raw.persistedMediaFiles)
            ? raw.persistedMediaFiles.map(normalizePersistedMediaRelPath)
            : [];
        const next = Array.from(
            new Set(mutator(current).map(normalizePersistedMediaRelPath).filter(Boolean))
        );

        if (next.length > 0) {
            raw.persistedMediaFiles = next;
        } else {
            delete raw.persistedMediaFiles;
        }

        await vscode.workspace.fs.writeFile(
            settingsPath,
            Buffer.from(JSON.stringify(raw, null, 2), "utf-8")
        );
    });

    MetadataManager.registerPendingWrite(workspaceUri.fsPath, writePromise);
    return writePromise;
}

/**
 * Adds a rel-path to the persisted-media allowlist (no-op if already present).
 */
export async function addPersistedMediaFile(
    relPath: string,
    workspaceFolderUri?: vscode.Uri
): Promise<void> {
    const normalized = normalizePersistedMediaRelPath(relPath);
    if (!normalized) return;
    await updatePersistedMediaFiles(workspaceFolderUri, (current) =>
        current.includes(normalized) ? current : [...current, normalized]
    );
}

/**
 * Adds many rel-paths to the persisted-media allowlist in a single atomic write.
 * Used when the user chooses to keep videos while switching to a stream mode.
 */
export async function addPersistedMediaFiles(
    relPaths: string[],
    workspaceFolderUri?: vscode.Uri
): Promise<void> {
    if (!relPaths || relPaths.length === 0) return;
    await updatePersistedMediaFiles(workspaceFolderUri, (current) => [...current, ...relPaths]);
}

/**
 * Removes a rel-path from the persisted-media allowlist (no-op if absent).
 * Call this when a saved video is replaced or deleted so the list doesn't
 * protect a stale/empty slot.
 */
export async function removePersistedMediaFile(
    relPath: string,
    workspaceFolderUri?: vscode.Uri
): Promise<void> {
    const normalized = normalizePersistedMediaRelPath(relPath);
    if (!normalized) return;
    await updatePersistedMediaFiles(workspaceFolderUri, (current) =>
        current.filter((p) => p !== normalized)
    );
}

/**
 * Removes every allowlist entry whose file extension is in `extensions`
 * (lower-case, dot-prefixed, e.g. ".mp4"). Used when an explicit "Free Space"
 * choice deliberately frees previously-saved videos.
 */
export async function removePersistedMediaFilesByExtension(
    extensions: Set<string>,
    workspaceFolderUri?: vscode.Uri
): Promise<void> {
    await updatePersistedMediaFiles(workspaceFolderUri, (current) =>
        current.filter((p) => !extensions.has(path.extname(p).toLowerCase()))
    );
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
        mediaFileStrategySwitchStarted: false,
        autoSyncEnabled: true,
        syncDelayMinutes: 5,
        ...(defaults || {}),
    };
    await writeLocalProjectSettings(def, workspaceFolderUri);
}

/**
 * Returns the audio metadata schema version this machine has already migrated
 * this project to. Defaults to 0 when the key is absent (e.g., never migrated,
 * or fresh clone on a new machine).
 */
export async function getAudioSchemaVersion(
    workspaceFolderUri?: vscode.Uri
): Promise<number> {
    const settings = await readLocalProjectSettings(workspaceFolderUri);
    return typeof settings.audioSchemaVersion === "number" ? settings.audioSchemaVersion : 0;
}

/**
 * Persists the completed audio metadata schema version for this machine.
 * Called by `AudioAttachmentsMigrator.runAudioSchemaMigrations` only after
 * every chained migration step succeeds, so an interrupted run can resume
 * on the next activation.
 */
export async function setAudioSchemaVersion(
    version: number,
    workspaceFolderUri?: vscode.Uri
): Promise<void> {
    await updateLocalProjectSettings((settings) => {
        settings.audioSchemaVersion = version;
    }, workspaceFolderUri);
}

/**
 * Gets whether a media strategy switch was started but not completed
 */
export async function getSwitchStarted(workspaceFolderUri?: vscode.Uri): Promise<boolean> {
    const settings = await readLocalProjectSettings(workspaceFolderUri);
    return !!settings.mediaFileStrategySwitchStarted;
}

/**
 * Sets whether a media strategy switch was started but not completed
 */
export async function setSwitchStarted(
    value: boolean,
    workspaceFolderUri?: vscode.Uri
): Promise<void> {
    await updateLocalProjectSettings((settings) => {
        settings.mediaFileStrategySwitchStarted = !!value;
    }, workspaceFolderUri);
}

/**
 * Mark that an update was completed locally but not yet synced to remote
 * This prevents showing "update required" modal before sync completes
 */
export async function markUpdateCompletedLocally(
    username: string,
    workspaceFolderUri?: vscode.Uri
): Promise<void> {
    await updateLocalProjectSettings((settings) => {
        settings.updateCompletedLocally = {
            username,
            completedAt: Date.now(),
        };
    }, workspaceFolderUri);
    debug("Marked update as completed locally for user:", username);
}

/**
 * Clear the local update completion flag after successful sync
 */
export async function clearUpdateCompletedLocally(
    workspaceFolderUri?: vscode.Uri
): Promise<void> {
    await updateLocalProjectSettings((settings) => {
        if (settings.updateCompletedLocally) {
            settings.updateCompletedLocally = undefined;
            debug("Cleared local update completion flag");
        }
    }, workspaceFolderUri);
}

// =============================================================================
// SYNC SETTINGS (migrated from .vscode/settings.json)
// =============================================================================

const SYNC_DELAY_MINIMUM = 5;

/**
 * One-time migration: copies autoSyncEnabled and syncDelayMinutes from the
 * VS Code workspace configuration into localProjectSettings.json.
 * No-op if the local file already contains these keys.
 */
async function migrateSyncSettingsFromVSCodeConfig(
    workspaceFolderUri?: vscode.Uri
): Promise<{ autoSyncEnabled: boolean; syncDelayMinutes: number; }> {
    const settingsPath = getSettingsFilePath(workspaceFolderUri);
    if (!settingsPath) {
        return { autoSyncEnabled: true, syncDelayMinutes: 5 };
    }

    // Only run migration inside an actual project (one that has a .project directory)
    const projectDir = vscode.Uri.joinPath(
        workspaceFolderUri || vscode.workspace.workspaceFolders![0].uri,
        ".project"
    );
    try {
        await vscode.workspace.fs.stat(projectDir);
    } catch {
        return { autoSyncEnabled: true, syncDelayMinutes: 5 };
    }

    const settings = await readLocalProjectSettings(workspaceFolderUri);

    if (settings.autoSyncEnabled !== undefined && settings.syncDelayMinutes !== undefined) {
        return {
            autoSyncEnabled: settings.autoSyncEnabled,
            syncDelayMinutes: Math.max(settings.syncDelayMinutes, SYNC_DELAY_MINIMUM),
        };
    }

    const config = vscode.workspace.getConfiguration("codex-project-manager");
    const autoSyncEnabled = settings.autoSyncEnabled ?? config.get<boolean>("autoSyncEnabled", true);
    let syncDelayMinutes = settings.syncDelayMinutes ?? config.get<number>("syncDelayMinutes", 5);
    if (syncDelayMinutes < SYNC_DELAY_MINIMUM) {
        syncDelayMinutes = SYNC_DELAY_MINIMUM;
    }

    await updateLocalProjectSettings((s) => {
        s.autoSyncEnabled = autoSyncEnabled;
        s.syncDelayMinutes = syncDelayMinutes;
    }, workspaceFolderUri);
    debug("Migrated sync settings from VS Code config:", { autoSyncEnabled, syncDelayMinutes });

    if (!autoSyncEnabled) {
        vscode.window
            .showInformationMessage(
                "You previously disabled auto-sync. If you'd like to re-enable it, click here to go to the settings page.",
                "Open Sync Settings"
            )
            .then((selection) => {
                if (selection === "Open Sync Settings") {
                    vscode.commands.executeCommand("codex-editor.mainMenu.focus");
                }
            });
    }

    return { autoSyncEnabled, syncDelayMinutes };
}

/**
 * Returns the current sync settings, migrating from VS Code config on first call
 * if the local file doesn't yet contain them.
 */
export async function getSyncSettings(
    workspaceFolderUri?: vscode.Uri
): Promise<{ autoSyncEnabled: boolean; syncDelayMinutes: number; }> {
    return migrateSyncSettingsFromVSCodeConfig(workspaceFolderUri);
}

/**
 * Persists sync settings to localProjectSettings.json.
 * Enforces a minimum sync delay of 5 minutes.
 */
export async function setSyncSettings(
    autoSyncEnabled: boolean,
    syncDelayMinutes: number,
    workspaceFolderUri?: vscode.Uri
): Promise<void> {
    await updateLocalProjectSettings((settings) => {
        settings.autoSyncEnabled = autoSyncEnabled;
        settings.syncDelayMinutes = Math.max(syncDelayMinutes, SYNC_DELAY_MINIMUM);
    }, workspaceFolderUri);
}

// =============================================================================
// LOCAL PROJECT SWAP FILE (.project/localProjectSwap.json)
// =============================================================================
// This file caches the projectSwap info fetched from the remote metadata.json.
// It's separate from localProjectSettings.json and is NEVER synced to git.
// Purpose: Store remote swap info locally so users can perform swap operations
// even when offline, and to avoid accidentally merging swap info into new projects.
// =============================================================================

const LOCAL_SWAP_FILE_NAME = "localProjectSwap.json";

/**
 * Gets the path to the local project swap file
 */
function getLocalSwapFilePath(workspaceFolderUri?: vscode.Uri): vscode.Uri | null {
    const workspaceFolder = workspaceFolderUri || vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspaceFolder) {
        debug("No workspace folder found for local swap file");
        return null;
    }
    return vscode.Uri.joinPath(workspaceFolder, ".project", LOCAL_SWAP_FILE_NAME);
}

/**
 * Local cache of project swap info from remote metadata.json
 * This is stored separately from localProjectSettings.json to:
 * 1. Keep remote swap info isolated from local settings
 * 2. Ensure it never gets merged into new projects
 * 3. Allow offline swap operations
 */
export interface LocalProjectSwapFile {
    /** The projectSwap info fetched from remote metadata.json */
    remoteSwapInfo: import("../../types").ProjectSwapInfo;
    /** Timestamp when this was last fetched from remote */
    fetchedAt: number;
    /** The git origin URL this was fetched from (for validation) */
    sourceOriginUrl: string;
    /** 
     * If true, this project folder should be deleted on next cleanup scan.
     * This is set when the swap completes successfully but cleanup failed.
     */
    markedForDeletion?: boolean;
    /** 
     * Timestamp when the swap was completed and folder was marked for deletion.
     * Used for logging/debugging purposes.
     */
    swapCompletedAt?: number;
}

/**
 * Reads the local project swap file from disk
 * This file caches the remote projectSwap info for offline use
 */
export async function readLocalProjectSwapFile(workspaceFolderUri?: vscode.Uri): Promise<LocalProjectSwapFile | null> {
    const filePath = getLocalSwapFilePath(workspaceFolderUri);
    if (!filePath) {
        return null;
    }

    try {
        const fileContent = await vscode.workspace.fs.readFile(filePath);
        const parsed = JSON.parse(Buffer.from(fileContent).toString("utf8"));
        debug("Read local project swap file");
        return parsed as LocalProjectSwapFile;
    } catch (error) {
        // File doesn't exist or is invalid - that's normal
        debug("No local project swap file found (or invalid)");
        return null;
    }
}

/**
 * Writes the local project swap file to disk
 * Used to cache remote projectSwap info for offline use
 * Registers as a pending write operation to ensure completion before folder switches
 */
export async function writeLocalProjectSwapFile(
    data: LocalProjectSwapFile,
    workspaceFolderUri?: vscode.Uri
): Promise<void> {
    const workspaceUri = workspaceFolderUri || vscode.workspace.workspaceFolders?.[0]?.uri;
    const filePath = getLocalSwapFilePath(workspaceFolderUri);
    if (!filePath || !workspaceUri) {
        debug("Cannot write local swap file: no workspace folder");
        return;
    }

    // Create a promise for the write operation and register it
    const writePromise = writeLocalProjectSwapFileInternal(data, workspaceFolderUri, filePath);

    // Register this write operation with MetadataManager's tracking system
    MetadataManager.registerPendingWrite(workspaceUri.fsPath, writePromise);

    return writePromise;
}

/**
 * Internal implementation of writeLocalProjectSwapFile
 */
async function writeLocalProjectSwapFileInternal(
    data: LocalProjectSwapFile,
    workspaceFolderUri: vscode.Uri | undefined,
    filePath: vscode.Uri
): Promise<void> {
    try {
        // Ensure .project directory exists
        const projectDir = vscode.Uri.joinPath(
            workspaceFolderUri || vscode.workspace.workspaceFolders![0].uri,
            ".project"
        );
        try {
            await vscode.workspace.fs.stat(projectDir);
        } catch {
            await vscode.workspace.fs.createDirectory(projectDir);
        }

        // Read existing file to preserve custom data like swapPendingDownloads
        let existingData: any = {};
        try {
            const existingContent = await vscode.workspace.fs.readFile(filePath);
            existingData = JSON.parse(Buffer.from(existingContent).toString("utf-8"));
        } catch {
            // File doesn't exist or invalid - start fresh
        }

        // Merge: preserve swapPendingDownloads and pendingLfsDownloads if they exist
        const mergedData = {
            ...data,
            // Preserve these fields from existing file if not in new data
            swapPendingDownloads: existingData.swapPendingDownloads,
            pendingLfsDownloads: existingData.pendingLfsDownloads,
        };

        const content = JSON.stringify(mergedData, null, 2);
        await vscode.workspace.fs.writeFile(filePath, Buffer.from(content, "utf8"));
        debug("Wrote local project swap file (preserved custom data)");
    } catch (error) {
        console.error("Failed to write local project swap file:", error);
    }
}

/**
 * Deletes the local project swap file
 * Called after a successful swap to clean up
 */
export async function deleteLocalProjectSwapFile(workspaceFolderUri?: vscode.Uri): Promise<void> {
    const filePath = getLocalSwapFilePath(workspaceFolderUri);
    if (!filePath) {
        return;
    }

    try {
        await vscode.workspace.fs.delete(filePath);
        debug("Deleted local project swap file");
    } catch {
        // File doesn't exist - that's fine
    }
}


