import { FrontierAPI } from "./../../../webviews/codex-webviews/src/StartupFlow/types";
import { LanguageCodes } from "../../utils/languageUtils";
import { nonCanonicalBookRefs } from "../../utils/verseRefUtils/verseData";
import { LanguageMetadata, LanguageProjectStatus, Project } from "codex-types";
import { getAllBookRefs } from "../../utils";
import * as vscode from "vscode";
import * as path from "path";
import semver from "semver";
import { LocalProject, ProjectMetadata, ProjectOverview } from "../../../types";
import { initializeProject } from "../projectInitializers";
import { getProjectMetadata } from "../../utils";
import git from "isomorphic-git";
import fs from "fs";
import http from "isomorphic-git/http/web";
import { getAuthApi } from "../../extension";
import { stageAndCommitAllAndSync } from "./merge";
import { SyncManager } from "../syncManager";

const DEBUG = false;
const debug = DEBUG ? (...args: any[]) => console.log("[ProjectUtils]", ...args) : () => { };

// Flag to temporarily disable metadata to config sync during direct updates
let syncDisabled = false;
const SYNC_DISABLE_TIMEOUT = 2000; // 2 seconds

/**
 * Temporarily disables synchronization from metadata to config
 * to prevent race conditions during direct updates
 */
export function disableSyncTemporarily() {
    debug("Temporarily disabling metadata-to-config sync");
    syncDisabled = true;

    // Re-enable after timeout
    setTimeout(() => {
        syncDisabled = false;
        debug("Re-enabled metadata-to-config sync");
    }, SYNC_DISABLE_TIMEOUT);
}

export interface ProjectDetails {
    projectName?: string;
    projectCategory?: string;
    userName?: string;
    userEmail?: string;
    abbreviation?: string;
    sourceLanguage?: LanguageMetadata;
    targetLanguage?: LanguageMetadata;
}

interface CustomQuickPickItem extends vscode.QuickPickItem {
    customValue?: string;
}

export async function promptForTargetLanguage(): Promise<ProjectDetails | undefined> {
    const languages = LanguageCodes;

    function getLanguageDisplayName(lang: LanguageMetadata): string {
        return `${lang.refName} (${lang.tag})`;
    }

    // Create a QuickPick instance instead of using showQuickPick
    const quickPick = vscode.window.createQuickPick<CustomQuickPickItem>();
    quickPick.placeholder = "Search for a language...";
    quickPick.items = languages.map((lang) => ({ label: getLanguageDisplayName(lang) }));

    // Track the original items for filtering
    const originalItems = quickPick.items;

    quickPick.onDidChangeValue((value) => {
        if (!value) {
            quickPick.items = originalItems;
            return;
        }

        const searchValue = value.toLowerCase();
        const filteredItems = originalItems.filter((item) =>
            item.label.toLowerCase().includes(searchValue)
        );

        // Always add custom language option when user has typed something
        quickPick.items = [
            ...filteredItems,
            {
                label: "$(plus) Custom Language",
                detail: `Create custom language "${value}"`,
                customValue: value,
                alwaysShow: true,
            },
        ];
    });

    return new Promise<ProjectDetails | undefined>((resolve) => {
        quickPick.onDidAccept(() => {
            const selection = quickPick.selectedItems[0];
            if (!selection) {
                resolve(undefined);
                return;
            }

            let targetLanguage: LanguageMetadata;

            // If it's a custom language
            if (selection.customValue) {
                targetLanguage = {
                    name: {
                        en: selection.customValue,
                    },
                    tag: "custom",
                    refName: selection.customValue,
                    projectStatus: LanguageProjectStatus.TARGET,
                };
            } else {
                // Find the selected language from the original list
                const selectedLanguage = languages.find(
                    (lang) => getLanguageDisplayName(lang) === selection.label
                );

                if (!selectedLanguage) {
                    resolve(undefined);
                    return;
                }

                targetLanguage = {
                    ...selectedLanguage,
                    projectStatus: LanguageProjectStatus.TARGET,
                };
            }

            quickPick.hide();
            resolve({ targetLanguage });
        });

        quickPick.onDidHide(() => {
            quickPick.dispose();
            resolve(undefined);
        });

        quickPick.show();
    });
}

export async function promptForSourceLanguage(): Promise<ProjectDetails | undefined> {
    const languages = LanguageCodes;

    function getLanguageDisplayName(lang: LanguageMetadata): string {
        return `${lang.refName} (${lang.tag})`;
    }

    // Create a QuickPick instance instead of using showQuickPick
    const quickPick = vscode.window.createQuickPick<CustomQuickPickItem>();
    quickPick.placeholder = "Search for a language...";
    quickPick.items = languages.map((lang) => ({ label: getLanguageDisplayName(lang) }));

    // Track the original items for filtering
    const originalItems = quickPick.items;

    quickPick.onDidChangeValue((value) => {
        if (!value) {
            quickPick.items = originalItems;
            return;
        }

        const searchValue = value.toLowerCase();
        const filteredItems = originalItems.filter((item) =>
            item.label.toLowerCase().includes(searchValue)
        );

        // Always add custom language option when user has typed something
        quickPick.items = [
            ...filteredItems,
            {
                label: "$(plus) Custom Language",
                detail: `Create custom language "${value}"`,
                customValue: value,
                alwaysShow: true,
            },
        ];
    });

    return new Promise<ProjectDetails | undefined>((resolve) => {
        quickPick.onDidAccept(() => {
            const selection = quickPick.selectedItems[0];
            if (!selection) {
                resolve(undefined);
                return;
            }

            let sourceLanguage: LanguageMetadata;

            // If it's a custom language
            if (selection.customValue) {
                sourceLanguage = {
                    name: {
                        en: selection.customValue,
                    },
                    tag: "custom",
                    refName: selection.customValue,
                    projectStatus: LanguageProjectStatus.SOURCE,
                };
            } else {
                // Find the selected language from the original list
                const selectedLanguage = languages.find(
                    (lang) => getLanguageDisplayName(lang) === selection.label
                );

                if (!selectedLanguage) {
                    resolve(undefined);
                    return;
                }

                sourceLanguage = {
                    ...selectedLanguage,
                    projectStatus: LanguageProjectStatus.SOURCE,
                };
            }

            quickPick.hide();
            resolve({ sourceLanguage });
        });

        quickPick.onDidHide(() => {
            quickPick.dispose();
            resolve(undefined);
        });

        quickPick.show();
    });
}

export function generateProjectScope(
    skipNonCanonical: boolean = true
): Project["type"]["flavorType"]["currentScope"] {
    /** For now, we are just setting the scope as all books, but allowing the vref.ts file to determine the books.
     * We could add a feature to allow users to select which books they want to include in the project.
     * And we could even drill down to specific chapter/verse ranges.
     *
     * FIXME: need to sort out whether the scope can sometimes be something other than books, like stories, etc.
     */
    const books: string[] = getAllBookRefs();

    // The keys will be the book refs, and the values will be empty arrays
    const projectScope: any = {}; // NOTE: explicit any type here because we are dynamically generating the keys

    skipNonCanonical
        ? books
            .filter((book) => !nonCanonicalBookRefs.includes(book))
            .forEach((book) => {
                projectScope[book] = [];
            })
        : books.forEach((book) => {
            projectScope[book] = [];
        });
    return projectScope;
}

export type ProjectWithId = ProjectOverview & { projectId: string; };

export const generateProjectId = () => {
    return (
        Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
    );
};

export async function initializeProjectMetadataAndGit(details: ProjectDetails) {
    // Initialize a new project with the given details and return the project object
    const newProject: Partial<ProjectWithId> = {
        // Fixme: remove Partial when codex-types library is updated
        format: "scripture burrito",
        projectName:
            details.projectName ||
            vscode.workspace.getConfiguration("codex-project-manager").get<string>("projectName") ||
            "", // previously "Codex Project"
        projectId: generateProjectId(),
        meta: {
            version: "0.0.0",
            category:
                details.projectCategory ||
                vscode.workspace
                    .getConfiguration("codex-project-manager")
                    .get<string>("projectCategory") ||
                "Translation", // fixme: does this needed in multi modal?
            generator: {
                softwareName: "Codex Editor",
                softwareVersion:
                    vscode.extensions.getExtension("project-accelerate.codex-editor-extension")
                        ?.packageJSON.version || "?.?.?",
                userName:
                    details.userName ||
                    vscode.workspace
                        .getConfiguration("codex-project-manager")
                        .get<string>("userName") ||
                    "", // previously "Unknown"
                userEmail:
                    details.userEmail ||
                    vscode.workspace
                        .getConfiguration("codex-project-manager")
                        .get<string>("userEmail") ||
                    "", // previously "Unknown"
            },
            defaultLocale: "en",
            dateCreated: new Date().toDateString(),
            normalization: "NFC",
            comments: [],
        },
        idAuthorities: {},
        identification: {},
        languages: [],
        type: {
            flavorType: {
                name: "default",
                flavor: {
                    name: "default",
                    usfmVersion: "3.0",
                    translationType: "unknown",
                    audience: "general",
                    projectType: "unknown",
                },
                currentScope: generateProjectScope(),
            },
        },
        confidential: false,
        agencies: [],
        targetAreas: [],
        localizedNames: {},
        ingredients: {},
        copyright: {
            shortStatements: [],
        },
    };

    if (details.sourceLanguage && newProject.languages) {
        newProject.languages.push(details.sourceLanguage);
    }
    if (details.targetLanguage && newProject.languages) {
        newProject.languages.push(details.targetLanguage);
    }

    const workspaceFolder = vscode.workspace.workspaceFolders
        ? vscode.workspace.workspaceFolders[0].uri.fsPath
        : undefined;

    if (!workspaceFolder) {
        console.error("No workspace folder found.");
        return;
    }

    const WORKSPACE_FOLDER =
        vscode?.workspace?.workspaceFolders && vscode?.workspace?.workspaceFolders[0];

    if (!WORKSPACE_FOLDER) {
        console.error("No workspace folder found.");
        return;
    }

    const projectFilePath = vscode.Uri.joinPath(WORKSPACE_FOLDER.uri, "metadata.json");
    const projectFileData = Buffer.from(JSON.stringify(newProject, null, 4), "utf8");

    try {
        await vscode.workspace.fs.stat(projectFilePath);
        // File exists, ask for confirmation to overwrite
        const overwrite = await vscode.window.showWarningMessage(
            "Project file already exists. Do you want to overwrite it?",
            "Yes",
            "No"
        );
        if (overwrite !== "Yes") {
            vscode.window.showInformationMessage("Project creation cancelled.");
            return;
        }
    } catch (error) {
        // File doesn't exist, we can proceed with creation
    }
    try {
        await vscode.workspace.fs.writeFile(projectFilePath, projectFileData);
        vscode.window.showInformationMessage(`Project created at ${projectFilePath.fsPath}`);

        // Check if git is already initialized
        let isGitInitialized = false;
        try {
            await git.resolveRef({
                fs,
                dir: workspaceFolder,
                ref: "HEAD",
            });
            isGitInitialized = true;
        } catch (error) {
            // Git is not initialized
        }

        if (!isGitInitialized) {
            // Initialize git repository
            try {
                await git.init({
                    fs,
                    dir: workspaceFolder,
                    defaultBranch: "main",
                });

                // Create .gitignore file using the centralized function
                await ensureGitignoreIsUpToDate();

                // Add files to git
                await git.add({
                    fs,
                    dir: workspaceFolder,
                    filepath: "metadata.json",
                });

                await git.add({
                    fs,
                    dir: workspaceFolder,
                    filepath: ".gitignore",
                });
                const authApi = getAuthApi();
                const userInfo = await authApi?.getUserInfo();
                const author = {
                    name:
                        userInfo?.username ||
                        vscode.workspace
                            .getConfiguration("codex-project-manager")
                            .get<string>("userName") ||
                        "Unknown",
                    email:
                        userInfo?.email ||
                        vscode.workspace
                            .getConfiguration("codex-project-manager")
                            .get<string>("userEmail") ||
                        "unknown",
                };

                await git.commit({
                    fs,
                    dir: workspaceFolder,
                    message: "Initial commit: Add project metadata",
                    author,
                });

                vscode.window.showInformationMessage("Git repository initialized successfully");
            } catch (error) {
                console.error("Failed to initialize git repository:", error);
                vscode.window.showErrorMessage(
                    `Failed to initialize git repository: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
    } catch (error: any) {
        vscode.window.showErrorMessage(
            `Failed to create project: ${error.message || JSON.stringify(error)}`
        );
    }

    return newProject;
}

export async function updateMetadataFile() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;

    if (!workspaceFolder) {
        console.error("No workspace folder found.");
        return;
    }

    const projectFilePath = vscode.Uri.joinPath(vscode.Uri.file(workspaceFolder), "metadata.json");

    let project;
    try {
        // Force read from disk to avoid cache issues
        const projectFileData = await vscode.workspace.fs.readFile(projectFilePath);
        project = JSON.parse(projectFileData.toString());
        debug("Read existing metadata.json file");
    } catch (error) {
        console.warn("Metadata file does not exist, creating a new one.");
        project = {}; // Initialize an empty project object if the file does not exist
    }

    const projectSettings = vscode.workspace.getConfiguration("codex-project-manager");

    // Preserving existing validation count if it exists
    const existingValidationCount = project.meta?.validationCount;
    const configValidationCount = projectSettings.get("validationCount", 1);

    debug(
        `Updating metadata file - existing validation count: ${existingValidationCount}, config validation count: ${configValidationCount}`
    );

    // Check if we're in a sync disabled state (meaning a direct update is occurring)
    if (syncDisabled) {
        debug("Direct update in progress - using config value for validation count");
    }

    // Update project properties
    project.projectName = projectSettings.get("projectName", "");
    project.meta = project.meta || {}; // Ensure meta object exists

    // Explicitly update validation count
    project.meta.validationCount = configValidationCount;

    project.meta.generator = project.meta.generator || {}; // Ensure generator object exists
    project.meta.generator.userName = projectSettings.get("userName", "");
    project.meta.generator.userEmail = projectSettings.get("userEmail", "");
    project.languages = project.languages || [null, null];
    project.languages[0] = projectSettings.get("sourceLanguage", project.languages[0] || "");
    project.languages[1] = projectSettings.get("targetLanguage", project.languages[1] || "");
    project.meta.abbreviation = projectSettings.get("abbreviation", "");
    project.spellcheckIsEnabled = projectSettings.get("spellcheckIsEnabled", false);

    // Update other fields as needed
    debug("Project settings loaded, preparing to write to metadata.json");

    try {
        const updatedProjectFileData = Buffer.from(JSON.stringify(project, null, 4), "utf8");
        await vscode.workspace.fs.writeFile(projectFilePath, updatedProjectFileData);
        debug(
            "Successfully wrote metadata.json with validation count:",
            project.meta.validationCount
        );

        // Small delay to ensure file system operations complete before further operations
        await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
        console.error("Error writing metadata.json:", error);
    }
}

export const projectFileExists = async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders
        ? vscode.workspace.workspaceFolders[0]
        : undefined;
    if (!workspaceFolder) {
        return false;
    }
    const projectFilePath = vscode.Uri.joinPath(workspaceFolder.uri, "metadata.json");
    const fileExists = await vscode.workspace.fs.stat(projectFilePath).then(
        () => true,
        () => false
    );
    return fileExists;
};

export async function getProjectOverview(): Promise<ProjectOverview | undefined> {
    try {
        const metadata = await getProjectMetadata();
        if (!metadata) {
            console.warn("No metadata found. Returning undefined.");
            return undefined;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            console.error("No workspace folder found");
            return undefined;
        }

        const sourceTextsPath = vscode.Uri.joinPath(workspaceFolder.uri, ".project", "sourceTexts");
        const targetTextsPath = vscode.Uri.joinPath(workspaceFolder.uri, "files", "target");

        const sourceTexts: vscode.Uri[] = [];
        const targetTexts: vscode.Uri[] = [];
        let isAuthenticated = false;
        const authApi = getAuthApi();

        if (authApi) {
            try {
                isAuthenticated = await authApi?.getAuthStatus().isAuthenticated;
            } catch (error) {
                console.error("Error checking authentication:", error);
            }
        }
        try {
            const sourceEntries = await vscode.workspace.fs.readDirectory(sourceTextsPath);
            for (const [name] of sourceEntries) {
                if (name.endsWith("source")) {
                    sourceTexts.push(vscode.Uri.joinPath(sourceTextsPath, name));
                }
            }
        } catch (error) {
            console.error("Error reading source text Bibles:", error);
        }

        try {
            const targetEntries = await vscode.workspace.fs.readDirectory(targetTextsPath);
            for (const [name] of targetEntries) {
                if (name.endsWith("target")) {
                    targetTexts.push(vscode.Uri.joinPath(targetTextsPath, name));
                }
            }
        } catch (error) {
            console.error("Error reading target text Bibles:", error);
        }

        const currentWorkspaceFolderName = workspaceFolder.name;

        const userInfo = await authApi?.getUserInfo();
        return {
            format: metadata.format || "Unknown Format",
            projectName: metadata.projectName || currentWorkspaceFolderName || "Unnamed Project",
            projectId: metadata.projectId || "Unknown Project ID",
            projectStatus: metadata.projectStatus || "Unknown Status",
            category: metadata.meta?.category || "Uncategorized",
            validationCount: metadata.meta?.validationCount || 1,
            userName: userInfo?.username || "Anonymous",
            userEmail: userInfo?.email || "",
            meta: {
                version: metadata.meta?.version || "0.0.1",
                // FIXME: the codex-types library is out of date. Thus we have mismatched and/or duplicate values being defined
                category: metadata.meta?.category || "Uncategorized",
                validationCount: metadata.meta?.validationCount || 1,
                generator: {
                    softwareName: metadata.meta?.generator?.softwareName || "Unknown Software",
                    softwareVersion: metadata.meta?.generator?.softwareVersion || "0.0.1",
                    userName: userInfo?.username || "Anonymous",
                    userEmail: userInfo?.email || "",
                },
                defaultLocale: metadata.meta?.defaultLocale || "en",
                dateCreated: metadata.meta?.dateCreated || new Date().toISOString(),
                normalization: metadata.meta?.normalization || "NFC",
                comments: metadata.meta?.comments || [],
            },
            idAuthorities: metadata.idAuthorities || {},
            identification: metadata.identification || {},
            languages: metadata.languages || [],
            type: metadata.type || {},
            confidential: metadata.confidential || false,
            agencies: metadata.agencies || [],
            targetAreas: metadata.targetAreas || [],
            localizedNames: metadata.localizedNames || {},
            ingredients: metadata.ingredients || {},
            copyright: metadata.copyright || {
                shortStatements: [],
            },
            abbreviation: metadata.abbreviation || "N/A",
            sourceLanguage: metadata.languages?.find(
                (lang: LanguageMetadata) => lang.projectStatus === LanguageProjectStatus.SOURCE
            ) || {
                name: { en: "Unknown" },
                tag: "unknown",
                refName: "Unknown",
                projectStatus: LanguageProjectStatus.SOURCE,
            },
            targetLanguage: metadata.languages?.find(
                (lang: LanguageMetadata) => lang.projectStatus === LanguageProjectStatus.TARGET
            ) || {
                name: { en: "Unknown" },
                tag: "unknown",
                refName: "Unknown",
                projectStatus: LanguageProjectStatus.TARGET,
            },
            sourceTexts,
            targetTexts,
            targetFont: metadata.targetFont || "Default Font",
            isAuthenticated,
            spellcheckIsEnabled: metadata.spellcheckIsEnabled || false,
        };
    } catch (error) {
        console.error("Failed to read project metadata:", error);
        return undefined;
    }
}

/**
 * Synchronizes metadata values to configuration settings
 * Use this when opening/loading a project to ensure configuration matches metadata values
 */
export async function syncMetadataToConfiguration() {
    // Skip if temporarily disabled
    if (syncDisabled) {
        debug("Metadata-to-config sync is temporarily disabled, skipping");
        return;
    }

    try {
        const metadata = await accessMetadataFile();
        if (!metadata || !metadata.meta) {
            debug("No metadata or meta object found to sync to configuration");
            return;
        }

        const config = vscode.workspace.getConfiguration("codex-project-manager");

        // Sync validationCount from metadata to config
        if (
            metadata.meta &&
            "validationCount" in metadata.meta &&
            typeof metadata.meta.validationCount === "number"
        ) {
            debug(
                `Syncing validationCount from metadata (${metadata.meta.validationCount}) to configuration`
            );

            const currentConfigValue = config.get("validationCount", 1);
            if (currentConfigValue !== metadata.meta.validationCount) {
                debug(
                    `Current config value (${currentConfigValue}) differs from metadata (${metadata.meta.validationCount}), updating...`
                );

                await config.update(
                    "validationCount",
                    metadata.meta.validationCount,
                    vscode.ConfigurationTarget.Workspace
                );

                debug(
                    `Configuration updated to match metadata validationCount: ${metadata.meta.validationCount}`
                );

                // Schedule a sync operation to ensure the changes are committed (only if auto-sync is enabled)
                const autoSyncEnabled = config.get<boolean>("autoSyncEnabled", true);

                if (autoSyncEnabled) {
                    SyncManager.getInstance().scheduleSyncOperation(
                        "Update project configuration from metadata"
                    );
                } else {
                    debug("Auto-sync is disabled, skipping scheduled sync for metadata configuration update");
                }
            } else {
                debug(
                    `Configuration already matches metadata validationCount: ${metadata.meta.validationCount}`
                );
            }
        } else {
            debug("No valid validationCount found in metadata");
        }

        // Add other metadata properties sync here as needed
    } catch (error) {
        console.error("Error syncing metadata to configuration:", error);
    }
}

export async function checkIfMetadataAndGitIsInitialized(): Promise<boolean> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        debug("No workspace folder found"); // Changed to log since this is expected when no folder is open
        return false;
    }

    const metadataUri = vscode.Uri.joinPath(workspaceFolder.uri, "metadata.json");

    let metadataExists = false;
    let gitExists = false;

    try {
        // Check metadata file
        await vscode.workspace.fs.stat(metadataUri);
        metadataExists = true;

        // Sync metadata values to configuration
        await syncMetadataToConfiguration();
    } catch {
        debug("No metadata.json file found yet"); // Changed to log since this is expected for new projects
    }

    try {
        // Check git repository
        await git.resolveRef({
            fs,
            dir: workspaceFolder.uri.fsPath,
            ref: "HEAD",
        });
        gitExists = true;

        // If both metadata and git exist, ensure gitignore is up-to-date
        if (metadataExists) {
            await ensureGitignoreIsUpToDate();
        }
    } catch {
        debug("Git repository not initialized yet"); // Changed to log since this is expected for new projects
    }



    return metadataExists && gitExists;
}

export const createProjectFiles = async ({ shouldImportUSFM }: { shouldImportUSFM: boolean; }) => {
    try {
        await initializeProject(shouldImportUSFM);
    } catch (error) {
        console.error("Error initializing project or checking for missing files:", error);
    }
};

export async function accessMetadataFile(): Promise<ProjectMetadata | undefined> {
    // Accessing the metadata file
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        debug("No workspace folder found. Please open a folder to store your project in.");
        return;
    }
    const workspaceFolder = workspaceFolders[0];
    const metadataFilePath = vscode.Uri.joinPath(workspaceFolder.uri, "metadata.json");
    try {
        const fileData = await vscode.workspace.fs.readFile(metadataFilePath);
        const metadata = JSON.parse(fileData.toString());
        return metadata;
    } catch (error) {
        // File doesn't exist or can't be read, which is expected for a new project
        debug("Metadata file not found or cannot be read. This is normal for a new project.");
        return;
    }
}
export async function reopenWalkthrough() {
    await vscode.commands.executeCommand("workbench.action.closeAllGroups");

    await vscode.window.showInformationMessage(
        "Please complete the walkthrough before proceeding.",
        "OK"
    );

    //reopens the walkthrough in the current editor group
    await vscode.commands.executeCommand(
        "workbench.action.openWalkthrough",
        {
            category: "project-accelerate.codex-project-manager#codexWalkthrough",
            step: "project-accelerate.codex-project-manager#openFolder",
        },
        false
    );
}

export async function updateProjectSettings(projectDetails: ProjectDetails) {
    const projectSettings = vscode.workspace.getConfiguration("codex-project-manager");
    if (projectDetails.projectName) {
        await projectSettings.update(
            "projectName",
            projectDetails.projectName,
            vscode.ConfigurationTarget.Workspace
        );
    }
    if (projectDetails.projectCategory) {
        await projectSettings.update(
            "projectCategory",
            projectDetails.projectCategory,
            vscode.ConfigurationTarget.Workspace
        );
    }
    if (projectDetails.userName) {
        await projectSettings.update(
            "userName",
            projectDetails.userName,
            vscode.ConfigurationTarget.Workspace
        );
    }
    if (projectDetails.abbreviation) {
        await projectSettings.update(
            "abbreviation",
            projectDetails.abbreviation,
            vscode.ConfigurationTarget.Workspace
        );
    }
    if (projectDetails.sourceLanguage) {
        await projectSettings.update(
            "sourceLanguage",
            projectDetails.sourceLanguage,
            vscode.ConfigurationTarget.Workspace
        );
    }
    if (projectDetails.targetLanguage) {
        await projectSettings.update(
            "targetLanguage",
            projectDetails.targetLanguage,
            vscode.ConfigurationTarget.Workspace
        );
    }
}

interface CodexMetadata {
    format: string;
    meta: {
        generator: {
            softwareName: string;
            softwareVersion: string;
        };
        // ... other fields optional for validation
    };
}

export async function isValidCodexProject(folderPath: string): Promise<{
    isValid: boolean;
    version?: string;
    hasVersionMismatch?: boolean;
}> {
    try {
        const metadataPath = vscode.Uri.file(path.join(folderPath, "metadata.json"));
        const metadata = await vscode.workspace.fs.readFile(metadataPath);
        const metadataJson = JSON.parse(Buffer.from(metadata).toString("utf-8")) as CodexMetadata;

        const currentVersion =
            vscode.extensions.getExtension("project-accelerate.codex-editor-extension")?.packageJSON
                .version || "0.0.0";

        if (metadataJson.meta?.generator?.softwareName !== "Codex Editor") {
            return { isValid: false };
        }

        const projectVersion = metadataJson.meta.generator.softwareVersion;
        const hasVersionMismatch = semver.major(projectVersion) !== semver.major(currentVersion);

        return {
            isValid: true,
            version: projectVersion,
            hasVersionMismatch,
        };
    } catch {
        return { isValid: false };
    }
}

export async function findAllCodexProjects(): Promise<Array<LocalProject>> {
    const config = vscode.workspace.getConfiguration("codex-project-manager");
    let watchedFolders = config.get<string[]>("watchedFolders") || [];
    const projectHistory = config.get<Record<string, string>>("projectHistory") || {};

    // Filter out non-existent folders and update the configuration
    const validFolders = [];
    for (const folder of watchedFolders) {
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(folder));
            validFolders.push(folder);
        } catch (error) {
            debug(`Removing non-existent folder from watched folders: ${folder}`);
        }
    }

    // Update watchedFolders if any invalid folders were found
    if (validFolders.length !== watchedFolders.length) {
        await config.update("watchedFolders", validFolders, vscode.ConfigurationTarget.Global);
        watchedFolders = validFolders;
    }

    const projects = [];

    for (const folder of watchedFolders) {
        try {
            const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(folder));
            for (const [name, type] of entries) {
                if (type === vscode.FileType.Directory) {
                    const projectPath = path.join(folder, name);
                    const projectStatus = await isValidCodexProject(projectPath);

                    if (projectStatus.isValid) {
                        const stats = await vscode.workspace.fs.stat(vscode.Uri.file(projectPath));

                        // Try to get project name from metadata.json
                        let projectName = name;
                        try {
                            const metadataPath = vscode.Uri.file(
                                path.join(projectPath, "metadata.json")
                            );
                            const metadata = await vscode.workspace.fs.readFile(metadataPath);
                            const metadataJson = JSON.parse(
                                Buffer.from(metadata).toString("utf-8")
                            );
                            if (metadataJson.projectName) {
                                projectName = metadataJson.projectName;
                            }
                        } catch (error) {
                            console.debug(
                                `Could not read metadata.json for ${projectPath}, using folder name`
                            );
                        }

                        // Get git origin URL using isomorphic-git
                        let gitOriginUrl: string | undefined;
                        try {
                            const config = await git.listRemotes({
                                fs,
                                dir: projectPath,
                            });
                            const origin = config.find((remote: any) => remote.remote === "origin");
                            if (origin?.url) {
                                const urlObj = new URL(origin.url);
                                gitOriginUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
                            }
                        } catch (error) {
                            console.debug(`No git origin found for ${projectPath}:`, error);
                        }

                        projects.push({
                            name: projectName,
                            path: projectPath,
                            lastOpened: projectHistory[projectPath]
                                ? new Date(projectHistory[projectPath])
                                : undefined,
                            lastModified: new Date(stats.mtime),
                            version: projectStatus.version || "🚫",
                            hasVersionMismatch: projectStatus.hasVersionMismatch,
                            gitOriginUrl,
                            description: "...",
                        });
                    }
                }
            }
        } catch (error) {
            console.error(`Error scanning folder ${folder}:`, error);
        }
    }

    return projects;
}

export { stageAndCommitAllAndSync };

/**
 * Ensures that the project has an up-to-date .gitignore file
 * Rewrites the .gitignore file if it doesn't match the standard content exactly
 */
export async function ensureGitignoreIsUpToDate(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        console.error("No workspace folder found.");
        return;
    }

    const gitignorePath = vscode.Uri.joinPath(workspaceFolder.uri, ".gitignore");

    // Define the standard gitignore content for Codex projects
    const standardGitignoreContent = [
        "# Sync .project/sourceTexts/ folder (source text files)",
        "",
        "# Don't sync user-specific SQLite databases",
        ".project/*.sqlite",
        "",
        "# Don't sync SQLite auxiliary files",
        ".project/*.sqlite-wal",
        ".project/*.sqlite-shm",
        "",
        "# Don't sync user-specific files",
        ".project/complete_drafts.txt",

        "copilot-messages.log",
        "",
        "# System files",
        ".DS_Store",
        ".project/attachments/",
    ].join("\n");

    let existingContent = "";
    let gitignoreExists = false;

    try {
        const existingFile = await vscode.workspace.fs.readFile(gitignorePath);
        existingContent = Buffer.from(existingFile).toString("utf8").trim();
        gitignoreExists = true;
        debug("Found existing .gitignore file");
    } catch (error) {
        debug("No existing .gitignore file found, will create one");
    }

    // Check if the existing content matches the standard content exactly
    const needsUpdate = !gitignoreExists || existingContent !== standardGitignoreContent;

    if (needsUpdate) {
        try {
            await vscode.workspace.fs.writeFile(gitignorePath, Buffer.from(standardGitignoreContent, "utf8"));

            if (gitignoreExists) {
                debug("Rewrote .gitignore file to match standard format");
                vscode.window.showInformationMessage("Updated .gitignore to standard format");
            } else {
                debug("Created new .gitignore file");
                vscode.window.showInformationMessage("Created .gitignore file with standard ignore patterns");
            }
        } catch (error) {
            console.error("Failed to write .gitignore file:", error);
        }
    } else {
        debug(".gitignore file is up-to-date and matches standard format");
    }
}
