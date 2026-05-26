import * as vscode from "vscode";

/**
 * Per-user, per-machine settings stored in the extension's `globalState`.
 *
 * These keys used to live in `.project/localProjectSettings.json` (which is
 * git-synced and shared across teammates) but they're user preferences, not
 * project preferences. See issue #984.
 */

const DEBUG = false;
const debug = DEBUG
    ? (...args: unknown[]) => console.log("[globalUserSettings]", ...args)
    : () => { };

const AUTO_RECORD_ON_MIC_CLICK_KEY = "codex.audio.autoRecordOnMicClick";
const RECORDING_COUNTDOWN_SECONDS_KEY = "codex.audio.recordingCountdownSeconds";

const DEFAULT_AUTO_RECORD_ON_MIC_CLICK = false;
const DEFAULT_RECORDING_COUNTDOWN_SECONDS = 3;
const MAX_RECORDING_COUNTDOWN_SECONDS = 3;

let extensionContext: vscode.ExtensionContext | undefined;

/**
 * Wires the extension context. Must be called once during activation before
 * any getter/setter is invoked.
 */
export function initializeGlobalUserSettings(context: vscode.ExtensionContext): void {
    extensionContext = context;
}

function requireContext(callerName: string): vscode.ExtensionContext {
    if (!extensionContext) {
        throw new Error(
            `[globalUserSettings] ${callerName} called before initializeGlobalUserSettings(context).`
        );
    }
    return extensionContext;
}

function sanitizeCountdownSeconds(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        return DEFAULT_RECORDING_COUNTDOWN_SECONDS;
    }
    return Math.min(Math.round(value), MAX_RECORDING_COUNTDOWN_SECONDS);
}

export function getAutoRecordOnMicClick(): boolean {
    if (!extensionContext) {
        return DEFAULT_AUTO_RECORD_ON_MIC_CLICK;
    }
    return !!extensionContext.globalState.get<boolean>(
        AUTO_RECORD_ON_MIC_CLICK_KEY,
        DEFAULT_AUTO_RECORD_ON_MIC_CLICK
    );
}

export async function setAutoRecordOnMicClick(value: boolean): Promise<void> {
    const ctx = requireContext("setAutoRecordOnMicClick");
    await ctx.globalState.update(AUTO_RECORD_ON_MIC_CLICK_KEY, !!value);
}

export function getRecordingCountdownSeconds(): number {
    if (!extensionContext) {
        return DEFAULT_RECORDING_COUNTDOWN_SECONDS;
    }
    const raw = extensionContext.globalState.get<number>(
        RECORDING_COUNTDOWN_SECONDS_KEY,
        DEFAULT_RECORDING_COUNTDOWN_SECONDS
    );
    return sanitizeCountdownSeconds(raw);
}

export async function setRecordingCountdownSeconds(value: number): Promise<void> {
    const ctx = requireContext("setRecordingCountdownSeconds");
    const sanitized = sanitizeCountdownSeconds(value);
    await ctx.globalState.update(RECORDING_COUNTDOWN_SECONDS_KEY, sanitized);
}

/**
 * One-time-per-project migration: if `.project/localProjectSettings.json`
 * still holds the legacy `autoRecordOnMicClick` or `recordingCountdownSeconds`
 * keys, copy them into the per-user `globalState` (only when globalState
 * has no value yet, so the first project opened "wins"), then strip the
 * keys from the JSON so they stop syncing via git.
 *
 * Idempotent: a no-op once the keys have been removed.
 */
export async function migrateAudioSettingsFromLocalProject(
    workspaceFolderUri?: vscode.Uri
): Promise<void> {
    if (!extensionContext) {
        debug("Skipping migration: globalUserSettings not initialized yet.");
        return;
    }

    const workspaceFolder =
        workspaceFolderUri || vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspaceFolder) {
        return;
    }

    const settingsPath = vscode.Uri.joinPath(
        workspaceFolder,
        ".project",
        "localProjectSettings.json"
    );

    let raw: Record<string, unknown>;
    try {
        const fileContent = await vscode.workspace.fs.readFile(settingsPath);
        raw = JSON.parse(Buffer.from(fileContent).toString("utf-8")) ?? {};
    } catch {
        return;
    }

    const hasAutoRecord = Object.prototype.hasOwnProperty.call(
        raw,
        "autoRecordOnMicClick"
    );
    const hasCountdown = Object.prototype.hasOwnProperty.call(
        raw,
        "recordingCountdownSeconds"
    );
    if (!hasAutoRecord && !hasCountdown) {
        return;
    }

    if (hasAutoRecord) {
        const existingAutoRecord =
            extensionContext.globalState.get<boolean | undefined>(
                AUTO_RECORD_ON_MIC_CLICK_KEY,
                undefined
            );
        if (existingAutoRecord === undefined) {
            await extensionContext.globalState.update(
                AUTO_RECORD_ON_MIC_CLICK_KEY,
                !!raw["autoRecordOnMicClick"]
            );
            debug(
                "Migrated autoRecordOnMicClick from local project settings:",
                raw["autoRecordOnMicClick"]
            );
        }
        delete raw["autoRecordOnMicClick"];
    }

    if (hasCountdown) {
        const existingCountdown =
            extensionContext.globalState.get<number | undefined>(
                RECORDING_COUNTDOWN_SECONDS_KEY,
                undefined
            );
        if (existingCountdown === undefined) {
            const sanitized = sanitizeCountdownSeconds(
                raw["recordingCountdownSeconds"]
            );
            await extensionContext.globalState.update(
                RECORDING_COUNTDOWN_SECONDS_KEY,
                sanitized
            );
            debug(
                "Migrated recordingCountdownSeconds from local project settings:",
                sanitized
            );
        }
        delete raw["recordingCountdownSeconds"];
    }

    try {
        const content = JSON.stringify(raw, null, 2);
        await vscode.workspace.fs.writeFile(
            settingsPath,
            Buffer.from(content, "utf-8")
        );
        debug("Stripped per-user audio keys from local project settings.");
    } catch (err) {
        console.warn(
            "[globalUserSettings] Failed to strip per-user audio keys from localProjectSettings.json:",
            err
        );
    }
}

/**
 * Test-only: clear the cached context so each test can construct its own
 * fake ExtensionContext. Production code does not call this.
 */
export function _resetGlobalUserSettingsForTests(): void {
    extensionContext = undefined;
}
