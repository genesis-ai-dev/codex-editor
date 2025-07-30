import * as vscode from "vscode";
import { getProjectMetadata } from "../utils";
import { LanguageProjectStatus } from "codex-types";
import * as path from "path";
import {
    createProjectCommentFiles,
    createProjectNotebooks,
    splitSourceFileByBook,
} from "../utils/codexNotebookUtils";

export async function setTargetFont() {
    const projectMetadata = await getProjectMetadata();
    const targetLanguageCode = projectMetadata?.languages?.find(
        (language) => language.projectStatus === LanguageProjectStatus.TARGET
    )?.tag;
    if (targetLanguageCode) {
        const fontApiUrl = `https://lff.api.languagetechnology.org/lang/${targetLanguageCode}`;
        let fontApiResponse = await fetch(fontApiUrl);
        try {
            fontApiResponse = await fetch(fontApiUrl);
        } catch (error: any) {
            console.warn(
                "Could not fetch font API in setTargetFont. Error message:",
                JSON.stringify(error)
            );
            return;
        }
        const fontApiData = (await fontApiResponse.json()) as {
            defaultfamily: string[];
            families: {
                [key: string]: {
                    defaults: { ttf: string; };
                    files: { [key: string]: { url: string; }; };
                };
            };
        };
        const defaultFontFamily = fontApiData.defaultfamily[0];
        const fontFile = fontApiData.families[defaultFontFamily].defaults.ttf;
        const fontFileRemoteUrl = fontApiData.families[defaultFontFamily].files[fontFile].url;
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        if (workspaceRoot) {
            const fontFilePath = path.join(workspaceRoot, ".project", "fonts", fontFile);
            const fontFilePathUri = vscode.Uri.file(fontFilePath);
            try {
                await vscode.workspace.fs.stat(fontFilePathUri);
            } catch {
                const fontFileResponse = await fetch(fontFileRemoteUrl);
                const fontFileBuffer = await fontFileResponse.arrayBuffer();
                await vscode.workspace.fs.createDirectory(
                    vscode.Uri.file(path.dirname(fontFilePath))
                );
                await vscode.workspace.fs.writeFile(
                    fontFilePathUri,
                    new Uint8Array(fontFileBuffer)
                );
            }
        }
        const config = vscode.workspace.getConfiguration();
        const fallbackFont = "serif";
        // config.update(
        //     "editor.fontFamily",
        //     fallbackFont,
        //     vscode.ConfigurationTarget.Workspace,
        // );
        config.update(
            "editor.fontFamily",
            `${defaultFontFamily} ${fallbackFont}`,
            vscode.ConfigurationTarget.Workspace
        );
        console.log(`Font set to ${defaultFontFamily} with fallback to ${fallbackFont}`);
    }
}
enum ConfirmationOptions {
    Yes = "Yes",
    No = "No",
    NotNeeded = "Not-Needed",
}

export async function initializeProject(shouldImportUSFM: boolean) {
    const workspaceFolder = vscode.workspace.workspaceFolders
        ? vscode.workspace.workspaceFolders[0]
        : undefined;
    if (!workspaceFolder) {
        vscode.window.showErrorMessage(
            "No workspace folder found. Please open a folder to store your project in."
        );
    }

    // try {
    //     // FIXME: do we need to do this here?? we refresh at the end of this function anyway
    //     await vscode.commands.executeCommand("codexNotebookTreeView.refresh");
    // } catch (error) {
    //     console.log("Error calling commands of outside extension", error);
    // }

    vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Initializing new project...",
            cancellable: false,
        },
        async (progress) => {
            progress.report({ increment: 0, message: "Starting initialization..." });

            try {
                const workspaceFolder = vscode.workspace.workspaceFolders
                    ? vscode.workspace.workspaceFolders[0]
                    : undefined;
                if (!workspaceFolder) {
                    vscode.window.showErrorMessage(
                        "No workspace folder found. Please open a folder to store your project in."
                    );
                    return;
                }
                const projectFilePath = vscode.Uri.joinPath(workspaceFolder.uri, "metadata.json");
                const fileData = await vscode.workspace.fs.readFile(projectFilePath);
                const metadata = JSON.parse(fileData.toString());
                const projectScope = metadata?.type?.flavorType?.currentScope;
                if (!projectScope) {
                    vscode.window.showErrorMessage(
                        "Failed to initialize new project: project scope not found."
                    );
                    return;
                }
                const books = Object.keys(projectScope);

                const codexFiles = await vscode.workspace.findFiles("**/*.codex");
                let overwriteSelection = ConfirmationOptions.NotNeeded;

                if (codexFiles.length > 0) {
                    const userChoice = await vscode.window.showWarningMessage(
                        "Do you want to overwrite existing .codex project files?",
                        { modal: true },
                        ConfirmationOptions.Yes,
                        ConfirmationOptions.No
                    );
                    overwriteSelection =
                        userChoice === ConfirmationOptions.Yes
                            ? ConfirmationOptions.Yes
                            : ConfirmationOptions.No;
                }

                switch (overwriteSelection) {
                    case ConfirmationOptions.NotNeeded:
                        vscode.window.showInformationMessage("Creating Codex Project.");
                        break;
                    case ConfirmationOptions.Yes:
                        vscode.window.showInformationMessage(
                            "Creating Codex Project with overwrite."
                        );
                        break;
                    default:
                        vscode.window.showInformationMessage(
                            "Creating Codex Project without overwrite."
                        );
                        break;
                }

                progress.report({ increment: 50, message: "Setting up GitHub repository..." });

                const shouldOverWrite =
                    overwriteSelection === ConfirmationOptions.Yes ||
                    overwriteSelection === ConfirmationOptions.NotNeeded;
                let foldersWithUsfmToConvert: vscode.Uri[] | undefined;
                if (shouldImportUSFM) {
                    const folderUri = await vscode.window.showOpenDialog({
                        canSelectFolders: true,
                        canSelectFiles: false,
                        canSelectMany: false,
                        openLabel: "Choose USFM project folder",
                    });
                    foldersWithUsfmToConvert = folderUri;
                }

                progress.report({
                    increment: 80,
                    message: "Creating project notebooks and comment files...",
                });
                await createProjectNotebooks({
                    shouldOverWrite,
                    books,
                    foldersWithUsfmToConvert,
                });

                // Ensure the files directory exists for dictionary and other project files
                const filesDir = vscode.Uri.joinPath(workspaceFolder.uri, "files");
                try {
                    await vscode.workspace.fs.createDirectory(filesDir);
                    console.log("Created files directory for project");
                } catch (error) {
                    // Directory might already exist, which is fine
                    console.log("Files directory already exists or could not be created:", error);
                }

                await createProjectCommentFiles({
                    shouldOverWrite,
                });

                progress.report({ increment: 100, message: "Project initialization complete." });
                vscode.window.showInformationMessage("Project initialized successfully.");
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to initialize new project: ${error}`);
            }
        }
    );
}