import * as vscode from "vscode";
import { Teach } from "./teach";
import { getWorkSpaceFolder } from "../utils";

export const registerTeachCommands = (context: vscode.ExtensionContext) => {
    const workspaceFolder = getWorkSpaceFolder();
    if (!workspaceFolder) {
        console.error("No workspace folder found");
        return;
    }

    const teach = new Teach(vscode.Uri.file(workspaceFolder));

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "teach.generateTranslation",
            async (userQuery: string, text: string, cellId: string) => {
                try {
                    const { translation, usedCellIds } = await teach.generateTranslation(
                        userQuery,
                        text,
                        cellId
                    );
                    return { translation, usedCellIds };
                } catch (error) {
                    console.error("Error generating translation:", error);
                    vscode.window.showErrorMessage(
                        "Failed to generate translation. Please check the console for more details."
                    );
                    return null;
                }
            }
        )
    );

    console.log("Silver Path commands registered");
};
