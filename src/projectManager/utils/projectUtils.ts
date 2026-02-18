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
import { MetadataManager } from "../../utils/metadataManager";
import { EditMapUtils, addProjectMetadataEdit } from "../../utils/editMapUtils";

const DEBUG = false;
const debug = DEBUG ? (...args: any[]) => console.log("[ProjectUtils]", ...args) : () => { };

// Flag to temporarily disable metadata to config sync during direct updates
let syncDisabled = false;
const SYNC_DISABLE_TIMEOUT = 2000; // 2 seconds

// (Frontier version check moved to utils/versionChecks and enforced at sync time)

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
    projectId?: string;
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
    // Use provided projectId if available, otherwise generate one (for backward compatibility)
    // IMPORTANT: If projectId is provided, it MUST be used (never regenerated) to match folder name
    let projectId: string;
    if (!details.projectId || details.projectId.trim() === "") {
        console.warn("initializeProjectMetadataAndGit called without projectId - generating for backward compatibility");
        projectId = generateProjectId();
    } else {
        projectId = details.projectId;
    }
    const newProject: Partial<ProjectWithId> = {
        // Fixme: remove Partial when codex-types library is updated
        format: "scripture burrito",
        projectName:
            details.projectName ||
            vscode.workspace.getConfiguration("codex-project-manager").get<string>("projectName") ||
            "", // previously "Codex Project"
        projectId: projectId,
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

    try {
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

        // Use MetadataManager to safely create the project metadata
        const createResult = await MetadataManager.safeUpdateMetadata(
            WORKSPACE_FOLDER.uri,
            () => {
                // Add extension version requirements to the new project
                const projectWithVersions = {
                    ...newProject,
                    meta: {
                        ...newProject.meta,
                        requiredExtensions: {
                            codexEditor: MetadataManager.getCurrentExtensionVersion("project-accelerate.codex-editor-extension")
                        }
                    }
                };
                return projectWithVersions;
            }
        );

        if (!createResult.success) {
            console.error("Failed to create project metadata:", createResult.error);
            vscode.window.showErrorMessage("Failed to create project metadata. Check the output panel for details.");
            return;
        }

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

                // Ensure git configuration files are present and up-to-date
                await ensureGitConfigsAreUpToDate();

                // Disable VS Code's built-in Git integration
                await ensureGitDisabledInSettings();

                // Add files to git
                await git.add({
                    fs,
                    dir: workspaceFolder,
                    filepath: "metadata.json",
                });

                try {
                    await git.add({
                        fs,
                        dir: workspaceFolder,
                        filepath: ".gitignore",
                    });
                } catch (error) {
                    debug("Unable to add .gitignore to git index:", error);
                }

                try {
                    await git.add({
                        fs,
                        dir: workspaceFolder,
                        filepath: ".gitattributes",
                    });
                } catch (error) {
                    debug("Unable to add .gitattributes to git index:", error);
                }
                const authApi = getAuthApi();
                let userInfo;
                try {
                    const authStatus = authApi?.getAuthStatus();
                    if (authStatus?.isAuthenticated) {
                        userInfo = await authApi?.getUserInfo();
                    }
                } catch (error) {
                    debug("Could not fetch user info for git commit author:", error);
                }

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

/**
 * Gets the current user name for edit tracking
 */
async function getCurrentUserName(): Promise<string> {
    try {
        // Try auth API first
        const authApi = await getAuthApi();
        const userInfo = await authApi?.getUserInfo();
        if (userInfo?.username) {
            return userInfo.username;
        }
    } catch (error) {
        // Silent fallback
    }

    // Fallback
    return "unknown";
}

export async function updateMetadataFile() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;

    if (!workspaceFolder) {
        console.error("No workspace folder found.");
        return;
    }

    // Check if metadata.json exists before trying to update it
    // This prevents automatic creation when Main Menu opens
    const metadataPath = vscode.Uri.joinPath(workspaceFolder, "metadata.json");
    try {
        await vscode.workspace.fs.stat(metadataPath);
    } catch {
        // metadata.json doesn't exist - don't create it automatically
        debug("updateMetadataFile called but metadata.json doesn't exist. Skipping update to prevent automatic creation.");
        return;
    }

    const projectSettings = vscode.workspace.getConfiguration("codex-project-manager");

    // Get current user name for edit tracking
    const author = await getCurrentUserName();

    const result = await MetadataManager.safeUpdateMetadata(
        workspaceFolder,
        (project: any) => {
            // Store original values for comparison
            const originalProjectName = project.projectName;
            const originalGenerator = project.meta?.generator ? { ...project.meta.generator } : undefined;
            const originalAbbreviation = project.meta?.abbreviation;
            const originalLanguages = project.languages ? [...project.languages] : undefined;
            const originalSpellcheckIsEnabled = project.spellcheckIsEnabled;
            const originalValidationCount = project.meta?.validationCount;
            const originalValidationCountAudio = project.meta?.validationCountAudio;

            // Preserving existing validation count if it exists
            const existingValidationCount = project.meta?.validationCount;
            const configValidationCount = projectSettings.get("validationCount", 1);
            const configValidationCountAudio = projectSettings.get("validationCountAudio", 1);

            debug(
                `Updating metadata file - existing validation count: ${existingValidationCount}, config validation count: ${configValidationCount}`
            );

            // Check if we're in a sync disabled state (meaning a direct update is occurring)
            if (syncDisabled) {
                debug("Direct update in progress - using config value for validation count");
            }

            // Update project properties
            const newProjectName = projectSettings.get("projectName", "");
            project.projectName = newProjectName;
            project.meta = project.meta || {}; // Ensure meta object exists

            // Explicitly update validation count
            project.meta.validationCount = configValidationCount;
            project.meta.validationCountAudio = configValidationCountAudio;

            project.meta.generator = project.meta.generator || {}; // Ensure generator object exists
            const newUserName = projectSettings.get("userName", "");
            const newUserEmail = projectSettings.get("userEmail", "");
            project.meta.generator.userName = newUserName;
            project.meta.generator.userEmail = newUserEmail;

            const newLanguages = project.languages || [null, null];
            newLanguages[0] = projectSettings.get("sourceLanguage", newLanguages[0] || "");
            newLanguages[1] = projectSettings.get("targetLanguage", newLanguages[1] || "");
            project.languages = newLanguages;

            const newAbbreviation = projectSettings.get("abbreviation", "");
            project.meta.abbreviation = newAbbreviation;

            const newSpellcheckIsEnabled = projectSettings.get("spellcheckIsEnabled", false);
            project.spellcheckIsEnabled = newSpellcheckIsEnabled;

            // Track edits for changed user-editable fields
            // Ensure edits array exists
            if (!project.edits) {
                project.edits = [];
            }

            // Track projectName changes
            if (originalProjectName !== newProjectName) {
                addProjectMetadataEdit(project, EditMapUtils.projectName(), newProjectName, author);
            }

            // Track meta.generator changes (compare entire generator object)
            const generatorChanged = !originalGenerator ||
                originalGenerator.userName !== newUserName ||
                originalGenerator.userEmail !== newUserEmail;
            if (generatorChanged) {
                addProjectMetadataEdit(project, EditMapUtils.metaGenerator(), project.meta.generator, author);
            }

            // Track validationCount, validationCountAudio, and abbreviation changes (create separate edits for each field)
            if (originalValidationCount !== configValidationCount) {
                addProjectMetadataEdit(project, EditMapUtils.metaField("validationCount"), configValidationCount, author);
            }
            if (originalValidationCountAudio !== configValidationCountAudio) {
                addProjectMetadataEdit(project, EditMapUtils.metaField("validationCountAudio"), configValidationCountAudio, author);
            }
            if (originalAbbreviation !== newAbbreviation) {
                addProjectMetadataEdit(project, EditMapUtils.metaField("abbreviation"), newAbbreviation, author);
            }

            // Track languages changes
            const languagesChanged = !originalLanguages ||
                JSON.stringify(originalLanguages) !== JSON.stringify(newLanguages);
            if (languagesChanged) {
                addProjectMetadataEdit(project, EditMapUtils.languages(), newLanguages, author);
            }

            // Track spellcheckIsEnabled changes
            if (originalSpellcheckIsEnabled !== newSpellcheckIsEnabled) {
                addProjectMetadataEdit(project, EditMapUtils.spellcheckIsEnabled(), newSpellcheckIsEnabled, author);
            }

            debug("Project settings loaded, preparing to write to metadata.json");
            return project;
        },
        { author }
    );

    if (!result.success) {
        console.error("Failed to update metadata:", result.error);
        vscode.window.showErrorMessage(
            'Failed to update project metadata. Check the output panel for details.'
        );
        return;
    }

    debug(
        "Successfully wrote metadata.json with validation count:",
        result.metadata?.meta?.validationCount
    );

    // Small delay to ensure file system operations complete before further operations
    await new Promise((resolve) => setTimeout(resolve, 100));
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
            // Directory might not exist for new projects, which is fine
            // console.error("Error reading source text Bibles:", error);
        }

        try {
            const targetEntries = await vscode.workspace.fs.readDirectory(targetTextsPath);
            for (const [name] of targetEntries) {
                if (name.endsWith("target")) {
                    targetTexts.push(vscode.Uri.joinPath(targetTextsPath, name));
                }
            }
        } catch (error) {
            // Directory might not exist for new projects, which is fine
            // console.error("Error reading target text Bibles:", error);
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
            validationCountAudio: metadata.meta?.validationCountAudio || 1,
            userName: userInfo?.username || "Anonymous",
            userEmail: userInfo?.email || "",
            meta: {
                version: metadata.meta?.version || "0.0.1",
                // FIXME: the codex-types library is out of date. Thus we have mismatched and/or duplicate values being defined
                category: metadata.meta?.category || "Uncategorized",
                validationCount: metadata.meta?.validationCount || 1,
                validationCountAudio: metadata.meta?.validationCountAudio || 1,
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

        // Sync validationCount from metadata to config
        if (
            metadata.meta &&
            "validationCountAudio" in metadata.meta &&
            typeof metadata.meta.validationCountAudio === "number"
        ) {
            debug(
                `Syncing validationCountAudio from metadata (${metadata.meta.validationCountAudio}) to configuration`
            );

            const currentConfigValue = config.get("validationCountAudio", 1);
            if (currentConfigValue !== metadata.meta.validationCountAudio) {
                debug(
                    `Current config value (${currentConfigValue}) differs from metadata (${metadata.meta.validationCountAudio}), updating...`
                );

                await config.update(
                    "validationCountAudio",
                    metadata.meta.validationCountAudio,
                    vscode.ConfigurationTarget.Workspace
                );

                debug(
                    `Configuration updated to match metadata validationCountAudio: ${metadata.meta.validationCountAudio}`
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
                    `Configuration already matches metadata validationCountAudio: ${metadata.meta.validationCountAudio}`
                );
            }
        } else {
            debug("No valid validationCountAudio found in metadata");
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
        // Wrap in try/catch to prevent sync failures from blocking initialization
        try {
            await syncMetadataToConfiguration();
        } catch (e) {
            debug("Failed to sync metadata to configuration:", e);
        }
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

        // If both metadata and git exist, ensure git configuration files are up-to-date
        if (metadataExists) {
            await ensureGitConfigsAreUpToDate();
            // NOTE: ensureGitDisabledInSettings() is now called AFTER sync in extension.ts
            // to avoid creating a dirty working directory before sync operations
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

    const result = await MetadataManager.safeReadMetadata<ProjectMetadata>(workspaceFolder.uri);

    if (!result.success) {
        debug("Error reading metadata file:", result.error);
        return;
    }

    return result.metadata;
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
    const startTime = Date.now();


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
            debug(`Error checking folder ${folder}:`, error);
        }
    }

    // Update watchedFolders if any invalid folders were found
    if (validFolders.length !== watchedFolders.length) {
        await config.update("watchedFolders", validFolders, vscode.ConfigurationTarget.Global);
        watchedFolders = validFolders;
    }

    const folderScanStart = Date.now();


    // Process all watched folders in parallel
    const folderResults = await Promise.allSettled(
        watchedFolders.map(folder => processWatchedFolder(folder, projectHistory))
    );



    // Flatten results and filter out any failed folder scans
    const projects = folderResults
        .filter((result): result is PromiseFulfilledResult<LocalProject[]> => result.status === 'fulfilled')
        .flatMap(result => result.value);

    // Log any failures for debugging
    folderResults.forEach((result, index) => {
        if (result.status === 'rejected') {
            console.error(`Error scanning folder ${watchedFolders[index]}:`, result.reason);
        }
    });



    return projects;
}

/**
 * Process a single watched folder and return all valid Codex projects within it
 */
async function processWatchedFolder(folder: string, projectHistory: Record<string, string>): Promise<LocalProject[]> {
    try {
        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(folder));

        // Process all potential project directories in parallel
        const projectResults = await Promise.allSettled(
            entries
                .filter(([name, type]) => type === vscode.FileType.Directory)
                .map(([name]) => processProjectDirectory(folder, name, projectHistory))
        );

        // Extract successful results and filter out null values
        const projects = projectResults
            .filter((result): result is PromiseFulfilledResult<LocalProject | null> => result.status === 'fulfilled')
            .map(result => result.value)
            .filter((project): project is LocalProject => project !== null);

        return projects;
    } catch (error) {
        console.error(`Error reading directory ${folder}:`, error);
        return [];
    }
}

/**
 * Process a single project directory and return project data if it's a valid Codex project
 */
async function processProjectDirectory(
    folder: string,
    name: string,
    projectHistory: Record<string, string>
): Promise<LocalProject | null> {
    const projectPath = path.join(folder, name);

    try {
        // Run project validation, metadata reading, git operations, stats, and local settings in parallel
        const [projectStatus, projectName, gitOriginUrl, stats, mediaStrategy] = await Promise.allSettled([
            isValidCodexProject(projectPath),
            getProjectNameFromMetadata(projectPath, name),
            getGitOriginUrl(projectPath),
            vscode.workspace.fs.stat(vscode.Uri.file(projectPath)),
            getMediaFilesStrategyForProject(projectPath)
        ]);

        // Check if project is valid
        const statusResult = projectStatus.status === 'fulfilled' ? projectStatus.value : { isValid: false };
        if (!statusResult.isValid) {
            return null;
        }

        // Extract other results with fallbacks
        const nameResult = projectName.status === 'fulfilled' ? projectName.value : name;
        const gitResult = gitOriginUrl.status === 'fulfilled' ? gitOriginUrl.value : undefined;
        const statsResult = stats.status === 'fulfilled' ? stats.value : null;
        const mediaStrategyResult = mediaStrategy.status === 'fulfilled' ? mediaStrategy.value : undefined;

        if (!statsResult) {
            debug(`Could not get stats for ${projectPath}`);
            return null;
        }

        return {
            name: nameResult,
            path: projectPath,
            lastOpened: projectHistory[projectPath]
                ? new Date(projectHistory[projectPath])
                : undefined,
            lastModified: new Date(statsResult.mtime),
            version: statusResult.version || "🚫",
            hasVersionMismatch: statusResult.hasVersionMismatch,
            gitOriginUrl: gitResult,
            description: "...",
            mediaStrategy: mediaStrategyResult,
        };
    } catch (error) {
        debug(`Error processing project directory ${projectPath}:`, error);
        return null;
    }
}

/**
 * Get project name from metadata.json file
 */
async function getProjectNameFromMetadata(projectPath: string, fallbackName: string): Promise<string> {
    try {
        const metadataPath = vscode.Uri.file(path.join(projectPath, "metadata.json"));
        const metadata = await vscode.workspace.fs.readFile(metadataPath);
        const metadataJson = JSON.parse(Buffer.from(metadata).toString("utf-8"));
        return metadataJson.projectName || fallbackName;
    } catch (error) {
        debug(`Could not read metadata.json for ${projectPath}, using folder name`);
        return fallbackName;
    }
}

/**
 * Get git origin URL for a project
 */
async function getGitOriginUrl(projectPath: string): Promise<string | undefined> {
    try {
        const config = await git.listRemotes({
            fs,
            dir: projectPath,
        });
        const origin = config.find((remote: any) => remote.remote === "origin");
        if (origin?.url) {
            const urlObj = new URL(origin.url);
            return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
        }
        return undefined;
    } catch (error) {
        debug(`No git origin found for ${projectPath}:`, error);
        return undefined;
    }
}

/**
 * Get media files strategy for a project
 */
async function getMediaFilesStrategyForProject(projectPath: string): Promise<"auto-download" | "stream-and-save" | "stream-only" | undefined> {
    try {
        const { getMediaFilesStrategyForPath } = await import("../../utils/localProjectSettings");
        const strategy = await getMediaFilesStrategyForPath(projectPath);
        // Ensure the strategy is one of the valid types
        if (strategy === "auto-download" || strategy === "stream-and-save" || strategy === "stream-only") {
            return strategy;
        }
        return undefined;
    } catch (error) {
        debug(`Could not read media strategy for ${projectPath}:`, error);
        return undefined;
    }
}

export { stageAndCommitAllAndSync };

/**
 * Internal helper to update .gitignore file without version checking
 */
async function updateGitignoreFile(): Promise<void> {
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
        ".project/localProjectSettings.json",
        "copilot-messages.log",
        "",
        "# Archive formats",
        "*.zip",
        "*.rar",
        "*.7z",
        "*.tar",
        "*.tar.gz",
        "*.tar.bz2",
        "*.tar.xz",
        "*.gz",
        "*.bz2",
        "*.xz",
        "",
        "# Windows executables and installers",
        "*.exe",
        "*.msi",
        "*.bat",
        "*.cmd",
        "*.com",
        "*.scr",
        "*.dll",
        "",
        "# macOS executables and disk images",
        "*.dmg",
        "*.pkg",
        "",
        "# Disk images and virtual machine files",
        "*.iso",
        "*.img",
        "*.vhd",
        "*.vmdk",

        "",
        "# System files",
        ".DS_Store",
        ".project/attachments/files/**",
    ].join("\n");
    // NOTE: we are ignoring the files dir in attachments because we also have a  pointers folder in the attachments dir.
    // the pointers folder will be used to store the pointers to the files in the files dir.

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
                debug("Updated .gitignore to standard format");
            } else {
                debug("Created new .gitignore file");
                debug("Created .gitignore file with standard ignore patterns");
            }
        } catch (error) {
            console.error("Failed to write .gitignore file:", error);
        }
    } else {
        debug(".gitignore file is up-to-date and matches standard format");
    }
}

export async function ensureGitignoreIsUpToDate(): Promise<void> {
    // .gitignore is part of codebase - always allow updates
    await updateGitignoreFile();
}

/**
 * Internal helper to update .gitattributes file without version checking
 */
async function updateGitattributesFile(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        console.error("No workspace folder found.");
        return;
    }

    const gitattributesPath = vscode.Uri.joinPath(workspaceFolder.uri, ".gitattributes");

    // Define the standard .gitattributes content for Codex projects
    const standardGitattributesContent = [
        "# Audio files",
        "*.wav filter=lfs diff=lfs merge=lfs -text",
        "*.mp3 filter=lfs diff=lfs merge=lfs -text",
        "*.m4a filter=lfs diff=lfs merge=lfs -text",
        "*.ogg filter=lfs diff=lfs merge=lfs -text",
        "*.webm filter=lfs diff=lfs merge=lfs -text",
        "",
        "# Video files",
        "*.mp4 filter=lfs diff=lfs merge=lfs -text",
        "*.avi filter=lfs diff=lfs merge=lfs -text",
        "*.mov filter=lfs diff=lfs merge=lfs -text",
        "*.mkv filter=lfs diff=lfs merge=lfs -text",
        "",
        "# Image files over 1MB should use LFS",
        "*.jpg filter=lfs diff=lfs merge=lfs -text",
        "*.jpeg filter=lfs diff=lfs merge=lfs -text",
        "*.png filter=lfs diff=lfs merge=lfs -text",
    ].join("\n");

    let existingContent = "";
    let gitattributesExists = false;

    try {
        const existingFile = await vscode.workspace.fs.readFile(gitattributesPath);
        existingContent = Buffer.from(existingFile).toString("utf8").trim();
        gitattributesExists = true;
        debug("Found existing .gitattributes file");
    } catch (error) {
        debug("No existing .gitattributes file found, will create one");
    }

    const needsUpdate = !gitattributesExists || existingContent !== standardGitattributesContent;

    if (needsUpdate) {
        try {
            await vscode.workspace.fs.writeFile(gitattributesPath, Buffer.from(standardGitattributesContent, "utf8"));

            if (gitattributesExists) {
                debug("Rewrote .gitattributes file to match standard format");
                debug("Updated .gitattributes to standard format");
            } else {
                debug("Created new .gitattributes file");
                debug("Created .gitattributes file with standard LFS attributes");
            }
        } catch (error) {
            console.error("Failed to write .gitattributes file:", error);
        }
    } else {
        debug(".gitattributes file is up-to-date and matches standard format");
    }
}

export async function ensureGitattributesIsUpToDate(): Promise<void> {
    // .gitattributes is part of codebase - always allow updates
    await updateGitattributesFile();
}

/**
 * Ensures both .gitignore and .gitattributes are present and up-to-date
 * Git configuration files are always updated regardless of extension version
 */
export async function ensureGitConfigsAreUpToDate(): Promise<void> {
    // Git config files are part of codebase - always allow updates
    await updateGitignoreFile();
    await updateGitattributesFile();
}

export async function afterProjectDetectedEnsureLocalSettings(projectUri: vscode.Uri): Promise<void> {
    try {
        // Guard: only create settings after repo exists (avoid during clone checkout)
        try {
            const gitDir = vscode.Uri.joinPath(projectUri, ".git");
            await vscode.workspace.fs.stat(gitDir);
        } catch {
            return;
        }
        const { ensureLocalProjectSettingsExists } = await import("../../utils/localProjectSettings");
        await ensureLocalProjectSettingsExists(projectUri);
    } catch (e) {
        // best-effort
    }
}

/**
 * Ensures git.enabled is set to false in workspace settings
 * This disables VS Code's built-in Git integration for the project
 */
export async function ensureGitDisabledInSettings(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        console.error("No workspace folder found.");
        return;
    }

    try {
        const gitConfig = vscode.workspace.getConfiguration("git");
        const currentValue = gitConfig.inspect<boolean>("enabled");

        // Check if git.enabled is already set to false at workspace level
        if (currentValue?.workspaceValue === false) {
            debug("git.enabled is already set to false in workspace settings");
            return;
        }

        // Set git.enabled to false at workspace level
        await gitConfig.update("enabled", false, vscode.ConfigurationTarget.Workspace);
        debug("Set git.enabled to false in workspace settings");
        debug("Disabled VS Code's built-in Git integration for this project");
    } catch (error) {
        console.error("Failed to update git.enabled setting:", error);
    }
}
