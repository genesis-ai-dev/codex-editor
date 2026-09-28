import { defaultProfileCompatibility } from "./defaultProfileCompatibility";
import * as vscode from "vscode";
import { EXTENSION_PIN_POLICY } from "../../sharedUtils/extensionPinFeatureFlag";

const DEFAULT_PROFILE_COMMAND = "workbench.profiles.actions.profileEntry.__default__profile__";
const RECOVERY_KEY = "codex.pinPolicy.profileRecoveryV2";
interface RecoveryState { signature: string; phase: "switching" | "complete"; }
type RecoveryContext = Pick<vscode.ExtensionContext, "workspaceState">;

/** Versions alone cannot distinguish older marketplace builds from local VSIXs. */
export function requireCompatibleFrontier(): void {
    if (!EXTENSION_PIN_POLICY.ignoreProjectPins) { return; }
    const frontier = vscode.extensions.getExtension("frontier-rnd.frontier-authentication");
    if (frontier?.packageJSON.codexProjectPinPolicyVersion !== 1) {
        throw new Error("Update Frontier Authentication to the pin-policy-compatible build in the current profile, then restart. This Frontier build can restore remote pins.");
    }
}

/** Existing openFolder option: overrides a saved pinned-profile association. */
export async function prepareProjectPinPolicy(_folder: vscode.Uri): Promise<{ forceProfile?: string }> {
    if (!EXTENSION_PIN_POLICY.ignoreProjectPins) { return {}; }
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes("codex.conductor.getEffectivePinnedExtensions")) { return {}; }
    requireCompatibleFrontier();
    await defaultProfileCompatibility.verify();
    return { forceProfile: "Default" };
}

/** Storage paths do NOT identify the active profile: VS Code gives every local
 * extension host Default's globalStorageHome. Instead, perform a bounded migration
 * after extension updates or newly removed pins, using the built-in Default action.
 */
export async function restoreDefaultProjectProfile(context: RecoveryContext, pinsRemoved = false): Promise<boolean> {
    if (!EXTENSION_PIN_POLICY.ignoreProjectPins) { return false; }
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes("codex.conductor.getEffectivePinnedExtensions")) { return false; }
    const signature = ["project-accelerate.codex-editor-extension", "frontier-rnd.frontier-authentication"]
        .map(id => vscode.extensions.getExtension(id)?.packageJSON.version ?? "missing").join(":");
    const state = context.workspaceState.get<RecoveryState>(RECOVERY_KEY);
    if (state?.signature === signature && state.phase === "complete" && !pinsRemoved) { return false; }
    // The running pair is already compatible. Default is an optional migration
    // target, not a prerequisite for loading this project after an update.
    try {
        await defaultProfileCompatibility.verify();
    } catch (error) {
        if (state?.phase === "switching") { await context.workspaceState.update(RECOVERY_KEY, undefined); }
        console.warn(`[Extension pin policy] Keeping the current profile; Default recovery deferred: ${String(error)}`);
        return false;
    }
    if (state?.signature === signature && state.phase === "switching") {
        await completeRecovery(context, signature);
        return true;
    }
    if (!commands.includes(DEFAULT_PROFILE_COMMAND)) { return false; }
    await context.workspaceState.update(RECOVERY_KEY, { signature, phase: "switching" });
    // Return from activate() before stopping its host. A no-op Default action does
    // not restart the host, so finish in this host when the command returns.
    setTimeout(() => {
        void (async () => {
            try {
                await vscode.commands.executeCommand(DEFAULT_PROFILE_COMMAND);
                // Profile changes can stop the host asynchronously after the action
                // returns. Give that transition time to take ownership of completion.
                setTimeout(() => {
                    const pending = context.workspaceState.get<RecoveryState>(RECOVERY_KEY);
                    if (pending?.signature === signature && pending.phase === "switching") {
                        void completeRecovery(context, signature).catch(reportRecoveryError);
                    }
                }, 1000);
            } catch (error) {
                // A failed command does not reload; a user-initiated restart may retry.
                await context.workspaceState.update(RECOVERY_KEY, undefined);
                reportRecoveryError(error);
            }
        })().catch(reportRecoveryError);
    }, 0);
    return true;
}

async function completeRecovery(context: RecoveryContext, signature: string): Promise<void> {
    await context.workspaceState.update(RECOVERY_KEY, { signature, phase: "complete" });
    setTimeout(() => {
        void vscode.commands.executeCommand("workbench.action.reloadWindow").then(undefined, reportRecoveryError);
    }, 0);
}

function reportRecoveryError(error: unknown): void {
    void vscode.window.showErrorMessage(`Project profile recovery failed: ${String(error)}. Select Profiles → Default and reload the window.`);
}
