import * as vscode from "vscode";
import * as path from "path";
import * as semver from "semver";
import { initializeProjectMetadataAndGit, syncMetadataToConfiguration } from "../../projectManager/utils/projectUtils";
import { getCodexProjectsDirectory } from "../projectLocationUtils";

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
 * Creates a new project in a new folder
 */
export async function createNewWorkspaceAndProject() {
    const projectNameInput = await vscode.window.showInputBox({
        title: "New Project",
        prompt: "Choose a name for your new project",
        placeHolder: "my-translation-project",
        validateInput: (value: string) => {
            if (!value) {
                return "Project name cannot be empty";
            }
            if (value.length > 100) {
                return "Project name is too long (max 100 characters)";
            }
            return null;
        },
        ignoreFocusOut: true,
    });

    if (!projectNameInput) {
        return; // User cancelled
    }

    const projectName = sanitizeProjectName(projectNameInput);
    if (projectName !== projectNameInput) {
        const proceed = await vscode.window.showInformationMessage(
            `Project name will be saved as "${projectName}"`,
            { modal: true },
            "Continue",
            "Cancel"
        );
        if (proceed !== "Continue") {
            return;
        }
    }

    await createProjectInNewFolder(projectName);
}

/**
 * Creates a new project in a new folder
 * TODO: let's ONLY use the .codex-projects directory as the parent folder
 */
const SHOULD_PROMPT_USER_FOR_PARENT_FOLDER = false;
async function createProjectInNewFolder(projectName: string) {
    // Get the .codex-projects directory as the default parent folder
    const codexProjectsDir = await getCodexProjectsDirectory();
    let parentFolderUri: vscode.Uri[] | undefined;

    if (SHOULD_PROMPT_USER_FOR_PARENT_FOLDER) {
        // Allow the user to choose a different location if they want
        parentFolderUri = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: `Choose location for "${projectName}" folder`,
            defaultUri: codexProjectsDir,
        });
    } else {
        parentFolderUri = [codexProjectsDir];
    }

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

    const newFolderUri = vscode.Uri.joinPath(parentFolderUri[0], projectName);
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
        await vscode.window.showErrorMessage("Failed to create new project. Please try again.", {
            modal: true,
        });
    }
}

/**
 * Creates a new project in the current workspace
 */
export async function createNewProject(details: any = {}) {
    try {
        console.log("Creating new project");
        await initializeProjectMetadataAndGit(details);
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
        const currentVersion =
            vscode.extensions.getExtension("project-accelerate.codex-editor-extension")?.packageJSON
                .version || "0.0.0";

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

            // Open folder and wait for it to open
            await vscode.commands.executeCommand("vscode.openFolder", uri);

            // Sync metadata values to configuration after folder is open
            // Note: This doesn't execute immediately as the above command opens a new window
            // The syncMetadataToConfiguration will be called when checkIfMetadataAndGitIsInitialized
            // is invoked in the new window
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

/**
 * Sanitizes a project name to be used as a folder name.
 * Ensure name is safe for:
 * - Windows
 * - Mac
 * - Linux
 * - Git
 */
export function sanitizeProjectName(name: string): string {
    // Replace invalid characters with hyphens
    // This handles Windows, Mac, Linux filesystem restrictions and Git-unsafe characters
    return (
        name
            .replace(/[<>:"/\\|?*]|^\.|\.$|\.lock$|^git$/i, "-") // Invalid/reserved chars and names
            .replace(/\s+/g, "-") // Replace spaces with hyphens
            .replace(/\.+/g, "-") // Replace periods with hyphens
            .replace(/-+/g, "-") // Replace multiple hyphens with single hyphen
            .replace(/^-|-$/g, "") || // Remove leading/trailing hyphens OR
        "new-project" // Fallback if name becomes empty after sanitization
    );
}

/**
 * Creates a new workspace and project using the provided name.
 */
export async function createWorkspaceWithProjectName(projectName: string) {
    await createProjectInNewFolder(projectName);
}
