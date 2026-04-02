import * as vscode from "vscode";
import * as path from "path";
import { getNotebookMetadataManager } from "./notebookMetadataManager";

export interface TextDisplaySettings {
    fileScope: "source" | "target" | "both";
    updateBehavior: "all" | "skip";
    fontSize?: number;
    enableLineNumbers?: boolean;
    textDirection?: "ltr" | "rtl";
}

export async function applyTextDisplaySettings(settings: TextDisplaySettings): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error("No workspace folder found");
    }

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Applying Text Display Settings",
            cancellable: false,
        },
        async (progress) => {
            const filesToUpdate: vscode.Uri[] = [];

            if (settings.fileScope === "source" || settings.fileScope === "both") {
                const sourceFiles = await vscode.workspace.findFiles(
                    new vscode.RelativePattern(workspaceFolder, ".project/sourceTexts/*.source")
                );
                filesToUpdate.push(...sourceFiles);
            }

            if (settings.fileScope === "target" || settings.fileScope === "both") {
                const targetFiles = await vscode.workspace.findFiles(
                    new vscode.RelativePattern(workspaceFolder, "files/target/*.codex")
                );
                filesToUpdate.push(...targetFiles);
            }

            progress.report({ message: `Found ${filesToUpdate.length} files to process` });

            let updatedCount = 0;
            let skippedCount = 0;
            const appliedSettings: string[] = [];

            if (settings.fontSize !== undefined) {
                appliedSettings.push(`font size to ${settings.fontSize}px`);
            }
            if (settings.enableLineNumbers !== undefined) {
                appliedSettings.push(
                    `line numbers ${settings.enableLineNumbers ? "enabled" : "disabled"}`
                );
            }
            if (settings.textDirection !== undefined) {
                appliedSettings.push(
                    `text direction to ${settings.textDirection.toUpperCase()}`
                );
            }

            for (let i = 0; i < filesToUpdate.length; i++) {
                const file = filesToUpdate[i];
                progress.report({
                    message: `Processing ${path.basename(file.fsPath)} (${i + 1}/${filesToUpdate.length})`,
                    increment: 100 / filesToUpdate.length,
                });

                try {
                    const updated = await updateFileTextDisplaySettings(file, settings);
                    if (updated) {
                        updatedCount++;
                    } else {
                        skippedCount++;
                    }
                } catch (error) {
                    console.error(
                        `Error updating text display settings for ${file.fsPath}:`,
                        error
                    );
                }
            }

            const settingsText = appliedSettings.join(", ");
            const message = `Text display settings applied (${settingsText}): ${updatedCount} files updated, ${skippedCount} files skipped`;
            vscode.window.showInformationMessage(message);

            await refreshAfterTextDisplayUpdate();
        }
    );
}

async function updateFileTextDisplaySettings(
    fileUri: vscode.Uri,
    settings: TextDisplaySettings
): Promise<boolean> {
    try {
        const fileContent = await vscode.workspace.fs.readFile(fileUri);
        const fileData = JSON.parse(fileContent.toString());

        let shouldSkip = false;

        if (settings.updateBehavior === "skip") {
            if (
                settings.fontSize !== undefined &&
                fileData.metadata?.fontSize !== undefined &&
                fileData.metadata?.fontSizeSource === "local"
            ) {
                shouldSkip = true;
            }
            if (
                settings.enableLineNumbers !== undefined &&
                fileData.metadata?.lineNumbersEnabled !== undefined &&
                fileData.metadata?.lineNumbersEnabledSource === "local"
            ) {
                shouldSkip = true;
            }
            if (
                settings.textDirection !== undefined &&
                fileData.metadata?.textDirection !== undefined &&
                fileData.metadata?.textDirectionSource === "local"
            ) {
                shouldSkip = true;
            }
        }

        if (shouldSkip) {
            return false;
        }

        if (!fileData.metadata) {
            fileData.metadata = {};
        }

        if (settings.fontSize !== undefined) {
            fileData.metadata.fontSize = settings.fontSize;
            fileData.metadata.fontSizeSource = "global";
        }
        if (settings.enableLineNumbers !== undefined) {
            fileData.metadata.lineNumbersEnabled = settings.enableLineNumbers;
            fileData.metadata.lineNumbersEnabledSource = "global";
        }
        if (settings.textDirection !== undefined) {
            fileData.metadata.textDirection = settings.textDirection;
            fileData.metadata.textDirectionSource = "global";
        }

        const updatedContent = JSON.stringify(fileData, null, 2);
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(updatedContent, "utf8"));

        return true;
    } catch (error) {
        console.error(`Error updating text display settings for ${fileUri.fsPath}:`, error);
        return false;
    }
}

async function refreshAfterTextDisplayUpdate(): Promise<void> {
    try {
        vscode.commands.executeCommand("codex-editor.refreshAllWebviews");
        const metadataManager = getNotebookMetadataManager();
        await metadataManager.loadMetadata();
    } catch (error) {
        console.error("Error refreshing webviews after text display settings update:", error);
    }
}
