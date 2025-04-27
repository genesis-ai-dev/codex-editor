import * as vscode from "vscode";
import { SplashScreenProvider } from "./SplashScreenProvider";

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
        console.error("Splash screen provider not registered");
        return;
    }

    splashScreenProvider.show(activationStart);
}

export function updateSplashScreenTimings(timings: any[]): void {
    if (!splashScreenProvider) {
        return;
    }

    splashScreenProvider.updateTimings(timings);
}

export function closeSplashScreen(onClosed?: () => Promise<void>): void {
    if (isClosing) {
        return;
    }

    isClosing = true;

    if (onClosed) {
        onSplashScreenClosedCallback = onClosed;
    }

    if (!splashScreenProvider) {
        // If there's no splash screen but we have a callback, run it immediately
        if (onSplashScreenClosedCallback) {
            onSplashScreenClosedCallback().finally(() => {
                onSplashScreenClosedCallback = undefined;
                isClosing = false;
            });
        } else {
            isClosing = false;
        }
        return;
    }

    // Safety timeout to ensure the callback is called even if something goes wrong with disposal
    const timeoutId = setTimeout(() => {
        console.log("[SplashScreen] Safety timeout triggered - ensuring callback is called");
        if (onSplashScreenClosedCallback) {
            onSplashScreenClosedCallback().finally(() => {
                onSplashScreenClosedCallback = undefined;
                isClosing = false;
            });
        } else {
            isClosing = false;
        }
    }, 3000); // 3 second safety timeout

    // Listen for the panel being disposed
    const disposable = splashScreenProvider.panel?.onDidDispose(() => {
        console.log("[SplashScreen] Splash screen closed, running callback if available");
        clearTimeout(timeoutId); // Clear the safety timeout

        if (onSplashScreenClosedCallback) {
            onSplashScreenClosedCallback().finally(() => {
                onSplashScreenClosedCallback = undefined;
                isClosing = false;
            });
        } else {
            isClosing = false;
        }
        disposable?.dispose();
    });

    splashScreenProvider.close();
}
