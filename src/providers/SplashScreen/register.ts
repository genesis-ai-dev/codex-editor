import * as vscode from "vscode";
import { SplashScreenProvider, SyncDetails } from "./SplashScreenProvider";

let splashScreenProvider: SplashScreenProvider | undefined;
let isClosing = false;
let onSplashScreenClosedCallback: (() => Promise<void>) | undefined;

export function registerSplashScreenProvider(
    context: vscode.ExtensionContext
): SplashScreenProvider {
    splashScreenProvider = new SplashScreenProvider(context.extensionUri);
    return splashScreenProvider;
}

export function showSplashScreen(activationStart: number): void {
    if (!splashScreenProvider) {
        console.error("Splash screen provider not initialized");
        return;
    }

    splashScreenProvider.show(activationStart);
}

export function updateSplashScreenTimings(timings: any[]): void {
    if (!splashScreenProvider) return;

    splashScreenProvider.updateTimings(timings);
}

export function updateSyncProgress(details: SyncDetails): void {
    if (!splashScreenProvider) return;

    splashScreenProvider.updateSyncDetails(details);
}

export function closeSplashScreen(callback?: () => Promise<void>): void {
    if (isClosing) return;
    isClosing = true;

    if (callback) {
        onSplashScreenClosedCallback = callback;
    }

    if (!splashScreenProvider) {
        // Provider not available, but we should still call callback
        if (onSplashScreenClosedCallback) {
            onSplashScreenClosedCallback().catch((error) => {
                console.error("Error in splash screen closed callback:", error);
            });
            onSplashScreenClosedCallback = undefined;
        }
        return;
    }

    splashScreenProvider.markComplete();

    // Check if panel exists before setting up the listener
    if (!splashScreenProvider.panel) {
        if (onSplashScreenClosedCallback) {
            onSplashScreenClosedCallback().catch((error) => {
                console.error("Error in splash screen closed callback:", error);
            });
            onSplashScreenClosedCallback = undefined;
        }
        isClosing = false;
        return;
    }

    // Listen for the panel being disposed
    const disposable = splashScreenProvider.panel.onDidDispose(() => {
        disposable.dispose();
        isClosing = false;

        if (onSplashScreenClosedCallback) {
            onSplashScreenClosedCallback().catch((error) => {
                console.error("Error in splash screen closed callback:", error);
            });
            onSplashScreenClosedCallback = undefined;
        }
    });
}
