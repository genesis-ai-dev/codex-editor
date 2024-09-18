import * as vscode from "vscode";
import { getProjectMetadata, getWorkSpaceFolder } from "../../utils";
import { LanguageProjectStatus } from "codex-types";
import * as path from "path";

const ROOT_PATH = getWorkSpaceFolder();

export async function setTargetFont() {
    const projectMetadata = await getProjectMetadata();
    const targetLanguageCode = projectMetadata?.languages?.find(
        (language) => language.projectStatus === LanguageProjectStatus.TARGET,
    )?.tag;
    if (targetLanguageCode) {
        const fontApiUrl = `https://lff.api.languagetechnology.org/lang/${targetLanguageCode}`;
        const fontApiResponse = await fetch(fontApiUrl);
        const fontApiData = await fontApiResponse.json();
        const defaultFontFamily = fontApiData.defaultfamily[0];
        const fontFile = fontApiData.families[defaultFontFamily].defaults.ttf;
        const fontFileRemoteUrl =
            fontApiData.families[defaultFontFamily].files[fontFile].url;
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        if (workspaceRoot) {
            const fontFilePath = path.join(
                workspaceRoot,
                ".project",
                "fonts",
                fontFile,
            );
            const fontFilePathUri = vscode.Uri.file(fontFilePath);
            try {
                await vscode.workspace.fs.stat(fontFilePathUri);
            } catch {
                const fontFileResponse = await fetch(fontFileRemoteUrl);
                const fontFileBuffer = await fontFileResponse.arrayBuffer();
                await vscode.workspace.fs.createDirectory(
                    vscode.Uri.file(path.dirname(fontFilePath)),
                );
                await vscode.workspace.fs.writeFile(
                    fontFilePathUri,
                    new Uint8Array(fontFileBuffer),
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
            vscode.ConfigurationTarget.Workspace,
        );
        // vscode.window.showInformationMessage(
        //     `Font set to ${defaultFontFamily} with fallback to ${fallbackFont}`,
        // );
    }
}

export async function handleConfig() {
    const config = vscode.workspace.getConfiguration();

    config.update(
        "editor.wordWrap",
        "on",
        vscode.ConfigurationTarget.Workspace,
    );
    // Turn off line numbers by default in workspace
    config.update(
        "editor.lineNumbers",
        "off",
        vscode.ConfigurationTarget.Workspace,
    );
    // Set to serif font by default in workspace

    // Set to 16px font size by default in workspace
    // config.update("editor.fontSize", 16, vscode.ConfigurationTarget.Workspace);
    // Set cursor style to line-thin by default in workspace
    config.update(
        "editor.cursorStyle",
        "line-thin",
        vscode.ConfigurationTarget.Workspace,
    );

    // TODO: set up the layout for the workspace
    // FIXME: this way of doing things clobbers the users existing settings.
    // These settings should probably be bundled in the app only, and not applied via the extension.

    const existingPatterns = config.get("files.readonlyInclude") || {};
    const updatedPatterns = { ...existingPatterns, "**/*.bible": true };

    config.update(
        "files.readonlyInclude",
        updatedPatterns,
        vscode.ConfigurationTarget.Global,
    );
}

async function openWorkspace() {
    let workspaceFolder;
    const openFolder = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: "Choose project folder",
    });
    if (openFolder && openFolder.length > 0) {
        await vscode.commands.executeCommand(
            "vscode.openFolder",
            openFolder[0],
            false,
        );
        workspaceFolder = vscode.workspace.workspaceFolders
            ? vscode.workspace.workspaceFolders[0]
            : undefined;
    }
    if (!workspaceFolder) {
        return;
    }
}

export async function onBoard() {
    // The following block ensures a smooth user experience by guiding the user through the initial setup process before the extension is fully activated. This is crucial for setting up the necessary project environment and avoiding any functionality issues that might arise from missing project configurations.

    // NOTE: the following two blocks are deactivated for now while we work on the project management extension. We might not need them.
    // First, check if a project root path is set, indicating whether the user has an existing project open.
    if (!ROOT_PATH) {
        // If no project is found, prompt the user to select a project folder. This step is essential to ensure that the extension operates within the context of a project, which is necessary for most of its functionalities.
        vscode.window
            .showInformationMessage(
                "No project found. You need to select a project folder for your new project, or open an existing project folder.",
                { modal: true }, // The modal option is used here to make sure the user addresses this prompt before proceeding, ensuring that the extension does not proceed without a project context.
                "Select a Folder",
            )
            .then((result) => {
                // Depending on the user's choice, either guide them to select a folder and initialize a new project or quit the application. This decision point is crucial for aligning the extension's state with the user's intent.
                if (result === "Select a Folder") {
                    openWorkspace();
                    // This command initializes a new project, setting up the necessary project structure and files, ensuring that the user starts with a properly configured environment.
                    vscode.commands.executeCommand(
                        "codex-editor-extension.initializeNewProject",
                    );
                } else {
                    // If the user decides not to select a folder, quitting the application prevents them from encountering unanticipated behavior due to the lack of a project context.
                    vscode.commands.executeCommand("workbench.action.quit");
                }
            });
    } else {
        // If a project root path exists, check for the presence of a metadata file to determine if the project needs initialization. This step ensures that existing projects are correctly recognized and that the extension does not reinitialize them unnecessarily.
        const metadataPath = path.join(ROOT_PATH, "metadata.json");
        if (!vscode.workspace.fs.stat(vscode.Uri.file(metadataPath))) {
            // Initialize a new project if the metadata file is missing, ensuring that the project has all the necessary configurations for the extension to function correctly.
            vscode.commands.executeCommand(
                "codex-editor-extension.initializeNewProject",
            );
        }
    }
}
