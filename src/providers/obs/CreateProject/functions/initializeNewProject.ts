import * as vscode from "vscode";
import {
    initializeProjectMetadata,
    ProjectDetails,
} from "../../../../utils/projectUtils";
import { createProjectNotebooks } from "../../../../utils/codexNotebookUtils";
import { indexVerseRefsInSourceText } from "../../../../commands/indexVrefsCommand";

export const initializeNewProject = async (
    projectDetails: ProjectDetails | undefined,
) => {
    try {
        if (projectDetails) {
            const workspaceFolder = vscode.workspace.workspaceFolders
                ? vscode.workspace.workspaceFolders[0]
                : undefined;
            if (!workspaceFolder) {
                console.error("No workspace found");
                return;
            }
            const projectFilePath = vscode.Uri.joinPath(
                workspaceFolder.uri,
                "metadata.json",
            );

            const fileExists = await vscode.workspace.fs
                .stat(projectFilePath)
                .then(
                    () => true,
                    () => false,
                );

            if (fileExists) {
                const fileData =
                    await vscode.workspace.fs.readFile(projectFilePath);
                const metadata = JSON.parse(fileData.toString());
                const projectName = metadata.projectName;

                const confirmDelete = await vscode.window.showInputBox({
                    prompt: `A project named ${projectName} already exists in this workspace. Type the project name to confirm deletion.`,
                    placeHolder: "Project name",
                });
                if (confirmDelete !== projectName) {
                    vscode.window.showErrorMessage(
                        "Project name does not match. Initialization cancelled.",
                    );
                    return;
                }
                await vscode.workspace.fs.delete(projectFilePath);
                // delete all files in the project folder including hidden . files
                const projectFolder = vscode.Uri.joinPath(
                    workspaceFolder.uri,
                    projectName,
                );

                const files =
                    await vscode.workspace.fs.readDirectory(projectFolder);

                for (const [fileName] of files) {
                    await vscode.workspace.fs.delete(
                        vscode.Uri.joinPath(projectFolder, fileName),
                        { recursive: true, useTrash: false },
                    );
                }

                vscode.window.showInformationMessage(
                    `Project ${projectName} deleted.`,
                );
            }

            vscode.window.showInformationMessage("Initializing new project...");

            const newProject = await initializeProjectMetadata(projectDetails);
            vscode.window.showInformationMessage(
                `New project initialized: ${newProject?.meta.generator.userName}'s ${newProject?.meta.category}`,
            );

            // Spawn notebooks based on project scope
            const projectScope = newProject?.type.flavorType.currentScope;
            if (!projectScope) {
                vscode.window.showErrorMessage(
                    "Failed to initialize new project: project scope not found.",
                );
                return;
            }
            const books = Object.keys(projectScope);

            await createProjectNotebooks({ books, shouldOverWrite: true });

            // Refresh the scripture tree view
            await vscode.commands.executeCommand(
                "scripture-explorer-activity-bar.refreshEntry",
            );
            // Trigger indexing of verse references in the source text
            indexVerseRefsInSourceText();
        } else {
            vscode.window.showInformationMessage(
                "Project initialization cancelled.",
            );
        }
    } catch (error) {
        vscode.window.showErrorMessage(
            `Failed to initialize new project: ${error}`,
        );
    }
};
