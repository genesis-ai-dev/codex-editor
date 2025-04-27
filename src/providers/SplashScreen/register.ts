import * as vscode from "vscode";
import { SplashScreenProvider } from "./SplashScreenProvider";

let splashScreenProvider: SplashScreenProvider | undefined;

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

export function closeSplashScreen(): void {
    if (!splashScreenProvider) {
        return;
    }

    splashScreenProvider.close();
}
