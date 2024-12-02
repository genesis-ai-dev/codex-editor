import * as vscode from 'vscode';
import * as path from 'path';
import * as semver from 'semver';
import { initializeProjectMetadata } from '../../projectManager/utils/projectUtils';

/**
 * Checks if a folder or any of its parent folders is a Codex project
 */
export async function checkForParentProjects(folderUri: vscode.Uri): Promise<boolean> {
    let currentPath = folderUri.fsPath;
    const rootPath = path.parse(currentPath).root;

    while (currentPath !== rootPath) {
        try {
            const metadataPath = vscode.Uri.file(path.join(currentPath, "metadata.json"));
            await vscode.workspace.fs.stat(metadataPath);
            
            const metadata = await vscode.workspace.fs.readFile(metadataPath);
            const metadataJson = JSON.parse(Buffer.from(metadata).toString("utf-8"));
            if (metadataJson.meta.generator.softwareName === "Codex Editor") {
                return true;
            }
        } catch {
            currentPath = path.dirname(currentPath);
        }
    }
    return false;
}

/**
 * Creates a new project in a new or existing folder
 */
export async function createNewWorkspaceAndProject() {
    const choice = await vscode.window.showInformationMessage(
        "Would you like to create a new folder for your project?",
        { modal: true },
        "Create New Folder",
        "Select Existing Empty Folder"
    );

    if (!choice) {
        return;
    }

    if (choice === "Create New Folder") {
        await createProjectInNewFolder();
    } else {
        await createProjectInExistingFolder();
    }
}

/**
 * Creates a new project in a new folder
 */
async function createProjectInNewFolder() {
    const parentFolderUri = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: "Choose Location for New Project Folder",
    });

    if (!parentFolderUri || !parentFolderUri[0]) {
        return;
    }

    const isNestedProject = await checkForParentProjects(parentFolderUri[0]);
    if (isNestedProject) {
        await vscode.window.showErrorMessage(
            "Cannot create a project inside another Codex project. Please choose a different location.",
            { modal: true }
        );
        return;
    }

    const folderName = await vscode.window.showInputBox({
        prompt: "Enter name for new project folder",
        validateInput: (value) => {
            if (!value) return "Folder name cannot be empty";
            if (value.match(/[<>:"/\\|?*]/)) return "Folder name contains invalid characters";
            return null;
        },
    });

    if (!folderName) {
        return;
    }

    const newFolderUri = vscode.Uri.joinPath(parentFolderUri[0], folderName);
    try {
        await vscode.workspace.fs.createDirectory(newFolderUri);
        await vscode.commands.executeCommand("vscode.openFolder", newFolderUri);

        // Wait for workspace to open
        await new Promise((resolve) => setTimeout(resolve, 1000));

        await createNewProject();
    } catch (error) {
        console.error("Error creating new project folder:", error);
        await vscode.window.showErrorMessage(
            "Failed to create new project folder. Please try again.",
            { modal: true }
        );
    }
}

/**
 * Creates a new project in an existing empty folder
 */
async function createProjectInExistingFolder() {
    const folderUri = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: "Choose Empty Folder for New Project",
    });

    if (!folderUri || !folderUri[0]) {
        return;
    }

    try {
        const entries = await vscode.workspace.fs.readDirectory(folderUri[0]);
        if (entries.length > 0) {
            await vscode.window.showErrorMessage(
                "The selected folder must be empty. Please create a new empty folder for your project.",
                { modal: true }
            );
            return;
        }

        const isNestedProject = await checkForParentProjects(folderUri[0]);
        if (isNestedProject) {
            await vscode.window.showErrorMessage(
                "Cannot create a project inside another Codex project. Please choose a different location.",
                { modal: true }
            );
            return;
        }

        await vscode.commands.executeCommand("vscode.openFolder", folderUri[0]);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await createNewProject();
    } catch (error) {
        console.error("Error creating new project:", error);
        await vscode.window.showErrorMessage(
            "Failed to create new project. Please try again.",
            { modal: true }
        );
    }
}

/**
 * Creates a new project in the current workspace
 */
export async function createNewProject() {
    try {
        await initializeProjectMetadata({});
        await vscode.commands.executeCommand("codex-project-manager.initializeNewProject");
    } catch (error) {
        console.error("Error creating new project:", error);
        throw error;
    }
}

/**
 * Opens an existing project and handles version compatibility
 */
export async function openProject(projectPath: string) {
    try {
        const uri = vscode.Uri.file(projectPath);
        const currentVersion = vscode.extensions.getExtension("project-accelerate.codex-editor-extension")
            ?.packageJSON.version || "0.0.0";

        const metadataPath = vscode.Uri.joinPath(uri, "metadata.json");
        try {
            const metadata = await vscode.workspace.fs.readFile(metadataPath);
            const metadataJson = JSON.parse(Buffer.from(metadata).toString("utf-8"));
            const projectVersion = metadataJson.meta?.generator?.softwareVersion || "0.0.0";

            if (semver.major(projectVersion) !== semver.major(currentVersion)) {
                const proceed = await vscode.window.showWarningMessage(
                    `This project was created with Codex Editor v${projectVersion}, which may be incompatible with the current version (v${currentVersion}). Opening it may cause issues.`,
                    { modal: true },
                    "Open Anyway",
                    "Cancel"
                );
                if (proceed !== "Open Anyway") {
                    return;
                }
            } else if (semver.lt(projectVersion, currentVersion)) {
                await vscode.window.showInformationMessage(
                    `This project was created with an older version of Codex Editor (v${projectVersion}). It will be automatically upgraded to v${currentVersion}.`
                );
            }

            const config = vscode.workspace.getConfiguration("codex-project-manager");
            const projectHistory = config.get<Record<string, string>>("projectHistory") || {};
            projectHistory[projectPath] = new Date().toISOString();
            await config.update(
                "projectHistory",
                projectHistory,
                vscode.ConfigurationTarget.Global
            );

            await vscode.commands.executeCommand("vscode.openFolder", uri);
        } catch (error) {
            await vscode.window.showErrorMessage(
                "This folder is no longer a valid Codex project. It may have been moved or deleted.",
                { modal: true }
            );
            return;
        }
    } catch (error) {
        console.error("Error opening project:", error);
        await vscode.window.showErrorMessage(
            "Failed to open project. The folder may no longer exist.",
            { modal: true }
        );
    }
}
