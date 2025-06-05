import * as vscode from "vscode";
import { SplashScreenProvider } from "./SplashScreenProvider";
import { ActivationTiming } from "../../extension";

let splashScreenProvider: SplashScreenProvider | undefined;
let splashScreenTimer: NodeJS.Timer | undefined;

export function registerSplashScreenProvider(context: vscode.ExtensionContext) {
    splashScreenProvider = new SplashScreenProvider(context.extensionUri);
    context.subscriptions.push(splashScreenProvider);
}

export async function showSplashScreen(activationStart: number) {
    if (!splashScreenProvider) {
        console.error("[SplashScreen] Provider not registered");
        return;
    }

    await splashScreenProvider.show(activationStart);

    // Keep the splash screen focused by periodically checking
    splashScreenTimer = setInterval(() => {
        if (splashScreenProvider?.panel?.visible) {
            // Ensure the splash screen stays visible and in focus
            splashScreenProvider.panel.reveal(vscode.ViewColumn.One, true);
        } else {
            // Stop checking if panel is gone
            if (splashScreenTimer) {
                clearInterval(splashScreenTimer);
                splashScreenTimer = undefined;
            }
        }
    }, 500);
}

export function updateSplashScreenTimings(timings: ActivationTiming[]) {
    if (splashScreenProvider) {
        splashScreenProvider.updateTimings(timings);
    }
}

export function updateSplashScreenSync(progress: number, message: string, currentFile?: string) {
    if (splashScreenProvider) {
        splashScreenProvider.updateSyncDetails({ progress, message, currentFile });
    }
}

export function closeSplashScreen(callback?: () => void | Promise<void>) {
    if (splashScreenTimer) {
        clearInterval(splashScreenTimer);
        splashScreenTimer = undefined;
    }

    if (splashScreenProvider) {
        splashScreenProvider.markComplete();

        // Give the animation time to complete before closing
        setTimeout(async () => {
            splashScreenProvider?.close();
            if (callback) {
                await callback();
            }
        }, 1500);
    } else if (callback) {
        callback();
    }
}
