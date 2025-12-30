import * as vscode from "vscode";
import * as path from "path";
import * as semver from "semver";
import { initializeProjectMetadataAndGit, syncMetadataToConfiguration, isValidCodexProject, generateProjectId, ProjectDetails } from "../../projectManager/utils/projectUtils";
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

    // Generate projectId for this legacy flow
    const projectId = generateProjectId();
    await createProjectInNewFolder(projectName, projectId);
}

/**
 * Creates a new project in a new folder
 * TODO: let's ONLY use the .codex-projects directory as the parent folder
 */
const SHOULD_PROMPT_USER_FOR_PARENT_FOLDER = false;
async function createProjectInNewFolder(projectName: string, projectId: string) {
    if (!projectId || projectId.trim() === "") {
        throw new Error("projectId is required and cannot be empty for createProjectInNewFolder");
    }
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
        
        // Store the projectId in a temporary file so it can be retrieved after workspace opens
        // This allows the onboarding flow to use the correct projectId
        const projectIdFile = vscode.Uri.joinPath(newFolderUri, '.pending-project-id');
        await vscode.workspace.fs.writeFile(projectIdFile, Buffer.from(projectId, 'utf-8'));
        
        await vscode.commands.executeCommand("vscode.openFolder", newFolderUri);

        // DO NOT call createNewProject here - let the StartupFlow handle initialization
        // This allows the onboarding modal to appear before project is initialized
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
        // Generate projectId for this flow (creating in existing folder)
        const projectId = generateProjectId();
        await createNewProject({ projectId });
    } catch (error) {
        console.error("Error creating new project:", error);
        await vscode.window.showErrorMessage("Failed to create new project. Please try again.", {
            modal: true,
        });
    }
}

/**
 * Creates a new project in the current workspace
 * @param details - Required projectId for new projects. Must be provided to ensure consistency with folder name.
 *                    For backward compatibility with existing initialization flows, will generate if not provided.
 */
export async function createNewProject(details: ProjectDetails = {}) {
    try {
        // For new projects created via ConfirmModal, projectId MUST be provided.
        // For backward compatibility with other initialization flows, generate if not provided.
        let finalProjectId: string;
        if (!details.projectId || details.projectId.trim() === "") {
            console.warn("createNewProject called without projectId - generating for backward compatibility");
            finalProjectId = generateProjectId();
        } else {
            finalProjectId = details.projectId;
        }
        // Always pass projectId to ensure it's used (never regenerated)
        await initializeProjectMetadataAndGit({ ...details, projectId: finalProjectId });
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
 * Checks if a project name already exists
 * @param projectName - The sanitized project name to check
 * @returns Object with exists flag, isCodexProject flag, and optional error message
 */
export async function checkProjectNameExists(projectName: string): Promise<{
    exists: boolean;
    isCodexProject: boolean;
    errorMessage?: string;
}> {
    try {
        const codexProjectsDir = await getCodexProjectsDirectory();
        const newFolderUri = vscode.Uri.joinPath(codexProjectsDir, projectName);

        // Check if directory exists
        try {
            await vscode.workspace.fs.stat(newFolderUri);
            // Directory exists - check if it's a valid Codex project
            const projectValidation = await isValidCodexProject(newFolderUri.fsPath);
            if (projectValidation.isValid) {
                return {
                    exists: true,
                    isCodexProject: true,
                    errorMessage: `A project with the name "${projectName}" already exists. Please choose a different name.`,
                };
            }
            // Directory exists but is not a Codex project
            return {
                exists: true,
                isCodexProject: false,
                errorMessage: `A folder named "${projectName}" already exists. Please choose a different name.`,
            };
        } catch {
            // Directory doesn't exist
            return {
                exists: false,
                isCodexProject: false,
            };
        }
    } catch (error) {
        console.error("Error checking project name:", error);
        return {
            exists: false,
            isCodexProject: false,
        };
    }
}

/**
 * Creates a new workspace and project using the provided name.
 * @param projectName - Already sanitized project name
 * @param projectId - REQUIRED Project ID to append to folder name and pass to initialization
 */
export async function createWorkspaceWithProjectName(projectName: string, projectId: string) {
    if (!projectId || projectId.trim() === "") {
        throw new Error("projectId is required and cannot be empty for createWorkspaceWithProjectName");
    }
    // Append projectId to sanitized project name for unique folder name
    const folderName = `${projectName}-${projectId}`;
    await createProjectInNewFolder(folderName, projectId);
}

/**
 * Extracts projectId from folder name if it follows the format "projectName-projectId"
 * @param folderName - The folder name to extract projectId from
 * @returns The projectId if found, undefined otherwise
 */
export function extractProjectIdFromFolderName(folderName: string): string | undefined {
    const lastHyphenIndex = folderName.lastIndexOf('-');
    if (lastHyphenIndex !== -1) {
        const potentialProjectId = folderName.substring(lastHyphenIndex + 1);
        // Validate it looks like a projectId (alphanumeric, reasonable length)
        // ProjectId from generateProjectId is 26 chars (13 + 13)
        if (potentialProjectId.length >= 20 && /^[a-z0-9]+$/i.test(potentialProjectId)) {
            return potentialProjectId;
        }
    }
    return undefined;
}
