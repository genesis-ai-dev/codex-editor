import * as vscode from "vscode";
import { showWelcomeViewIfNeeded } from "../../providers/WelcomeView/register";

export async function registerCommandsBefore(context: vscode.ExtensionContext) {
    // Command registrations can be added here in the future
    showWelcomeViewIfNeeded();
}
