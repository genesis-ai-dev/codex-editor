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
import { readLocalProjectSettings, clearPendingUpdate } from "../../utils/localProjectSettings";
import { checkRemoteUpdatingRequired } from "../../utils/remoteUpdatingManager";

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
    const workspaceFolderName = vscode.workspace.workspaceFolders?.[0]?.name;
    let fallbackName = workspaceFolderName || "";

    // Attempt to strip UUID if falling back to folder name
    // Generate fallback projectId if none provided to ensure we can try to strip potential ID
    const effectiveProjectId = details.projectId || extractProjectIdFromFolderName(fallbackName) || "";

    if (fallbackName && effectiveProjectId) {
        if (fallbackName.includes(effectiveProjectId)) {
            fallbackName = fallbackName.replace(effectiveProjectId, "").replace(/-+$/, "").replace(/^-+/, "");
        }
    }

    const newProject: Partial<ProjectWithId> = {
        // Fixme: remove Partial when codex-types library is updated
        format: "scripture burrito",
        projectName:
            details.projectName ||
            fallbackName ||
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
                const codexEditorVersion = MetadataManager.getCurrentExtensionVersion("project-accelerate.codex-editor-extension");
                const frontierAuthVersion = MetadataManager.getCurrentExtensionVersion("frontier-rnd.frontier-authentication");

                const requiredExtensions: { codexEditor?: string; frontierAuthentication?: string; } = {};
                if (codexEditorVersion) {
                    requiredExtensions.codexEditor = codexEditorVersion;
                }
                if (frontierAuthVersion) {
                    requiredExtensions.frontierAuthentication = frontierAuthVersion;
                }

                const projectWithVersions = {
                    ...newProject,
                    meta: {
                        ...newProject.meta,
                        requiredExtensions
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
            // Only update projectName if config has a non-empty value (don't overwrite with empty)
            const newProjectName = projectSettings.get("projectName", "");
            if (newProjectName) {
                project.projectName = newProjectName;
            }
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

            // Track projectName changes (only if we actually updated it - empty values don't update)
            if (newProjectName && originalProjectName !== newProjectName) {
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

        let projectName = metadata.projectName;
        if (!projectName) {
            // Fallback to workspace folder name, stripping UUID if present
            projectName = currentWorkspaceFolderName;
            const projectId = metadata.projectId;
            if (projectId && projectName.includes(projectId)) {
                projectName = projectName.replace(projectId, "").replace(/-+$/, "").replace(/^-+/, "");
            }
            if (!projectName.trim()) {
                projectName = "Unnamed Project";
            }
        }

        const userInfo = await authApi?.getUserInfo();
        return {
            format: metadata.format || "Unknown Format",
            projectName: projectName,
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

    // Clean up any folders marked for deletion from previous failed swap cleanups
    // This runs in the background and doesn't block project listing
    cleanupFoldersMarkedForDeletion(validFolders).catch(err => {
        debug("Error during swap folder cleanup:", err);
    });

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

    // Validate pending updates against remote metadata
    await validatePendingUpdates(projects);

    // Filter out old projects that have completed swap migration
    const visibleProjects = await filterSwappedProjects(projects);

    return visibleProjects;
}

/**
 * Validate all pending updates against remote metadata
 * Clear any pending updates that are no longer required remotely
 * Exception: If updateState exists (update in progress), keep everything
 */
async function validatePendingUpdates(projects: LocalProject[]): Promise<void> {
    const projectsWithPendingUpdates = projects.filter(p => p.pendingUpdate?.required);

    if (projectsWithPendingUpdates.length === 0) {
        return;
    }

    debug(`Validating ${projectsWithPendingUpdates.length} pending updates...`);

    // Validate each project's pending update in parallel
    await Promise.allSettled(
        projectsWithPendingUpdates.map(async (project) => {
            try {
                const projectUri = vscode.Uri.file(project.path);
                const localSettings = await readLocalProjectSettings(projectUri);

                // If update is already in progress (updateState exists), don't clear anything
                if (localSettings.updateState) {
                    debug(`Update in progress for ${project.name}, keeping pendingUpdate`);
                    return;
                }

                // Check if remote still requires update
                const remoteCheck = await checkRemoteUpdatingRequired(project.path, project.gitOriginUrl);

                if (!remoteCheck.required && localSettings.pendingUpdate) {
                    // Remote no longer requires update, clear the flag
                    debug(`Clearing invalid pendingUpdate for ${project.name}`);
                    await clearPendingUpdate(projectUri);
                    // Update the project object so UI reflects the change
                    project.pendingUpdate = undefined;
                }
            } catch (error) {
                debug(`Error validating pending update for ${project.name}:`, error);
                // Don't throw - we don't want one failed validation to stop the whole refresh
            }
        })
    );
}

/**
 * Filter out old projects and handle swap status
 * 
 * Rules:
 * - Cancelled swap: Project appears normal (not deprecated) - clear projectSwap field
 * - Active swap: Show project with swap info intact (swap banner will show)
 */
async function filterSwappedProjects(projects: LocalProject[]): Promise<LocalProject[]> {
    const filtered: LocalProject[] = [];
    const { getActiveSwapEntry, normalizeProjectSwapInfo } = await import("../../utils/projectSwapManager");
    const { readLocalProjectSwapFile } = await import("../../utils/localProjectSettings");

    for (const project of projects) {
        try {
            const projectUri = vscode.Uri.file(project.path);
            const metadataPath = vscode.Uri.file(path.join(project.path, "metadata.json"));
            let metadata: ProjectMetadata | null = null;

            try {
                const metadataBuffer = await vscode.workspace.fs.readFile(metadataPath);
                metadata = JSON.parse(Buffer.from(metadataBuffer).toString("utf-8")) as ProjectMetadata;
            } catch {
                // metadata.json might not exist
            }

            // Check BOTH metadata.json AND localProjectSwap.json for swap info
            let effectiveSwapInfo = metadata?.meta?.projectSwap;

            if (!effectiveSwapInfo) {
                try {
                    const localSwapFile = await readLocalProjectSwapFile(projectUri);
                    if (localSwapFile?.remoteSwapInfo) {
                        effectiveSwapInfo = localSwapFile.remoteSwapInfo;
                        debug("Using swap info from localProjectSwap.json for filtering");
                    }
                } catch {
                    // Non-fatal - localProjectSwap.json might not exist
                }
            }

            if (!effectiveSwapInfo) {
                // No swap info - show project
                filtered.push(project);
                continue;
            }

            const swapInfo = normalizeProjectSwapInfo(effectiveSwapInfo);
            const activeEntry = getActiveSwapEntry(swapInfo);

            // Case 1: Active swap - show project (swap banner will show in UI)
            if (activeEntry) {
                filtered.push(project);
                continue;
            }

            // Case 2: No active swap entry (all swaps cancelled)
            // Clear projectSwap so UI doesn't show swap banner - show as normal project
            const allEntries = swapInfo.swapEntries || [];

            if (allEntries.length > 0) {
                // Check what role this project had in cancelled swaps
                const wasOldProject = allEntries.some(e => e.isOldProject === true);
                const wasNewProject = allEntries.some(e => e.isOldProject === false);

                if (wasOldProject) {
                    debug(`Showing OLD project as normal (all swaps cancelled): ${project.name}`);
                }
                if (wasNewProject) {
                    debug(`Showing NEW project as normal (all swaps cancelled): ${project.name}`);
                }

                // Clear projectSwap for both OLD and NEW projects when all swaps are cancelled
                // This ensures neither shows swap-related UI
                project.projectSwap = undefined;
            }

            // Show project
            filtered.push(project);

        } catch (error) {
            debug(`Error checking swap status for ${project.name}:`, error);
            // If we can't check, show it to be safe
            filtered.push(project);
        }
    }

    return filtered;
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
    let currentName = name;
    let projectPath = path.join(folder, currentName);
    let projectMetadata: any = undefined;

    try {
        // Read metadata first
        try {
            const metadataUri = vscode.Uri.file(path.join(projectPath, "metadata.json"));
            const projectUri = vscode.Uri.file(projectPath);

            // First, try to ensure metadata integrity - this will recover from orphaned temp files
            // This is critical for projects that were left in a corrupted state due to interrupted writes
            try {
                const integrityResult = await MetadataManager.ensureMetadataIntegrity(projectUri);
                if (integrityResult.recovered) {
                    debug(`Recovered metadata.json for project: ${name}`);
                }
            } catch (integrityError) {
                // If integrity check fails completely, we'll handle it below
                debug(`Metadata integrity check failed for ${name}:`, integrityError);
            }

            // Quick check if metadata exists
            await vscode.workspace.fs.stat(metadataUri);

            const metadataBuffer = await vscode.workspace.fs.readFile(metadataUri);
            projectMetadata = JSON.parse(Buffer.from(metadataBuffer).toString("utf-8"));

            if (projectMetadata && projectMetadata.projectId) {
                // Check if published (has git remote)
                const gitOrigin = await getGitOriginUrl(projectPath);

                // If it has NO git origin (local-only), check folder name consistency
                if (!gitOrigin) {
                    const metadataProjectId = projectMetadata.projectId;
                    const uuidsInFolder = findAllUuidSegments(currentName);

                    // CRITICAL: Check for multiple UUIDs first (e.g., "project-uuid1-uuid2")
                    // If found, use metadata.projectId as source of truth and fix the folder name
                    // NOTE: This only runs for LOCAL-ONLY projects (no git remote)
                    if (uuidsInFolder.length > 1) {
                        debug(`MULTIPLE UUIDs detected in folder name: ${uuidsInFolder.join(', ')}`);

                        // Use metadata.projectId as the single source of truth
                        // Fallback to FIRST UUID (the original) if metadata has none
                        const correctId = metadataProjectId || uuidsInFolder[0] || generateProjectId();
                        if (!metadataProjectId) {
                            projectMetadata.projectId = correctId;
                        }

                        // Strip ALL UUIDs and append only the correct one
                        const baseName = sanitizeProjectName(stripAllUuids(currentName));
                        const newName = `${baseName}-${correctId}`;

                        if (newName !== currentName) {
                            const newPath = path.join(folder, newName);
                            try {
                                await vscode.workspace.fs.stat(vscode.Uri.file(newPath));
                                debug(`Cannot fix duplicate UUIDs: target ${newName} already exists`);
                            } catch {
                                await vscode.workspace.fs.writeFile(
                                    metadataUri,
                                    Buffer.from(JSON.stringify(projectMetadata, null, 4))
                                );
                                await vscode.workspace.fs.rename(vscode.Uri.file(projectPath), vscode.Uri.file(newPath));
                                debug(`Fixed duplicate UUIDs: renamed ${currentName} to ${newName}`);
                                currentName = newName;
                                projectPath = newPath;
                            }
                        }
                    }
                    // Normal case: single or no UUID
                    else if (metadataProjectId && currentName.endsWith(`-${metadataProjectId}`)) {
                        debug(`Folder name already ends with projectId: ${metadataProjectId}`);
                        // Nothing to do - folder and metadata are in sync
                    } else if (uuidsInFolder.length === 1) {
                        // Folder has exactly one UUID but it doesn't match metadata - sync metadata to folder
                        const folderUuid = uuidsInFolder[0];
                        if (folderUuid !== metadataProjectId) {
                            projectMetadata.projectId = folderUuid;
                            await vscode.workspace.fs.writeFile(
                                metadataUri,
                                Buffer.from(JSON.stringify(projectMetadata, null, 4))
                            );
                            debug(`Updated metadata projectId to match folder UUID: ${folderUuid}`);
                        }
                    } else {
                        // Folder has NO UUID suffix - need to add one
                        // Use metadata's projectId if available, otherwise generate new
                        const idToUse = metadataProjectId || generateProjectId();
                        if (!metadataProjectId) {
                            projectMetadata.projectId = idToUse;
                        }

                        // Get base name from folder (it has no UUID since we checked above)
                        const baseName = sanitizeProjectName(currentName);
                        const newName = `${baseName}-${idToUse}`;

                        if (newName !== currentName) {
                            const newPath = path.join(folder, newName);
                            try {
                                await vscode.workspace.fs.stat(vscode.Uri.file(newPath));
                                debug(`Cannot rename ${currentName} to ${newName} because target exists`);
                            } catch {
                                await vscode.workspace.fs.writeFile(
                                    metadataUri,
                                    Buffer.from(JSON.stringify(projectMetadata, null, 4))
                                );
                                await vscode.workspace.fs.rename(vscode.Uri.file(projectPath), vscode.Uri.file(newPath));
                                debug(`Renamed local project folder from ${currentName} to ${newName}`);
                                currentName = newName;
                                projectPath = newPath;
                            }
                        }
                    }
                }
            }
        } catch (e) {
            debug(`Error checking/renaming project folder ${currentName}:`, e);
        }

        // Run project validation, metadata reading, git operations, stats, and local settings in parallel
        // NOTE: We use the potentially updated projectPath and currentName
        const [projectStatus, projectName, gitOriginUrl, stats, mediaStrategy, localSettings] = await Promise.allSettled([
            isValidCodexProject(projectPath),
            getProjectNameFromMetadata(projectPath, currentName),
            getGitOriginUrl(projectPath),
            vscode.workspace.fs.stat(vscode.Uri.file(projectPath)),
            getMediaFilesStrategyForProject(projectPath),
            readLocalProjectSettings(vscode.Uri.file(projectPath)),
        ]);

        // Check if project is valid
        const statusResult = projectStatus.status === 'fulfilled' ? projectStatus.value : { isValid: false };
        if (!statusResult.isValid) {
            return null;
        }

        // Extract other results with fallbacks
        // Use currentName (the folder name) as the primary name result
        // This ensures the UI displays the actual folder name (with UUID) as requested
        const nameResult = currentName;

        const gitResult = gitOriginUrl.status === 'fulfilled' ? gitOriginUrl.value : undefined;
        const statsResult = stats.status === 'fulfilled' ? stats.value : null;
        const mediaStrategyResult = mediaStrategy.status === 'fulfilled' ? mediaStrategy.value : undefined;
        const settingsResult = localSettings.status === 'fulfilled' ? localSettings.value : undefined;

        if (!statsResult) {
            debug(`Could not get stats for ${projectPath}`);
            return null;
        }

        // Populate convenience fields on projectSwap for webview access
        // Check BOTH metadata.json AND localProjectSwap.json (same as checkProjectSwapRequired)
        const { getActiveSwapEntry, normalizeProjectSwapInfo } = await import("../../utils/projectSwapManager");
        const { readLocalProjectSwapFile } = await import("../../utils/localProjectSettings");

        let effectiveSwapInfo = projectMetadata?.meta?.projectSwap;

        // Also check localProjectSwap.json - it may have swap info from remote that wasn't synced yet
        if (!effectiveSwapInfo) {
            try {
                const localSwapFile = await readLocalProjectSwapFile(vscode.Uri.file(projectPath));
                if (localSwapFile?.remoteSwapInfo) {
                    effectiveSwapInfo = localSwapFile.remoteSwapInfo;
                    debug("Using swap info from localProjectSwap.json for project list");
                }
            } catch {
                // Non-fatal - localProjectSwap.json might not exist
            }
        }

        let projectSwapWithConvenience = effectiveSwapInfo;
        if (projectSwapWithConvenience) {
            const normalized = normalizeProjectSwapInfo(projectSwapWithConvenience);
            const activeEntry = getActiveSwapEntry(normalized);
            projectSwapWithConvenience = {
                ...normalized,
                // Convenience fields from active entry for webview display
                isOldProject: activeEntry?.isOldProject,
                oldProjectUrl: activeEntry?.oldProjectUrl,
                oldProjectName: activeEntry?.oldProjectName,
                newProjectUrl: activeEntry?.newProjectUrl,
                newProjectName: activeEntry?.newProjectName,
                swapStatus: activeEntry?.swapStatus,
            };
        }

        return {
            name: nameResult,
            path: projectPath,
            lastOpened: projectHistory[projectPath] // Note: this uses new path, history lookup might miss if keyed by old path
                ? new Date(projectHistory[projectPath])
                : undefined,
            lastModified: new Date(statsResult.mtime),
            version: statusResult.version || "🚫",
            hasVersionMismatch: statusResult.hasVersionMismatch,
            gitOriginUrl: gitResult,
            description: "...",
            mediaStrategy: mediaStrategyResult,
            pendingUpdate: settingsResult?.pendingUpdate,
            projectSwap: projectSwapWithConvenience,
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
        ".project/localProjectSwap.json",
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

/** Minimum length to recognize as a project ID (matches actual generateProjectId output of ~20-22 chars) */
const MIN_PROJECT_ID_LENGTH = 20;

/**
 * Checks if a string segment looks like a UUID (20+ alphanumeric chars)
 */
function isUuidLikeSegment(segment: string): boolean {
    return segment.length >= MIN_PROJECT_ID_LENGTH && /^[a-z0-9]+$/i.test(segment);
}

/**
 * Extracts projectId from a name (folder name, git URL project name, etc.)
 * Expects format "projectName-projectId" where projectId is 20+ alphanumeric chars.
 * generateProjectId() produces ~20-22 char IDs (two base36 random strings).
 * @param name - The name to extract projectId from (folder name, git URL path, etc.)
 * @returns The projectId if found, undefined otherwise
 */
export function extractProjectIdFromFolderName(name: string): string | undefined {
    const lastHyphenIndex = name.lastIndexOf('-');
    if (lastHyphenIndex !== -1) {
        const potentialProjectId = name.substring(lastHyphenIndex + 1);
        // Validate: alphanumeric, at least MIN_PROJECT_ID_LENGTH chars (20+)
        if (isUuidLikeSegment(potentialProjectId)) {
            return potentialProjectId;
        }
    }
    return undefined;
}

/**
 * Counts how many UUID-like segments (20+ alphanumeric chars) are in a name.
 * Used to detect duplicate UUIDs like "project-uuid1-uuid2".
 * @returns Array of UUID-like segments found
 */
export function findAllUuidSegments(name: string): string[] {
    const segments = name.split('-');
    return segments.filter(isUuidLikeSegment);
}

/**
 * Strips ALL UUID-like segments from a name, returning just the base name.
 * Use this when you need to reconstruct a name with a single correct UUID.
 * @example stripAllUuids("my-project-uuid1-uuid2") => "my-project"
 */
export function stripAllUuids(name: string): string {
    const segments = name.split('-');
    const nonUuidSegments = segments.filter(segment => !isUuidLikeSegment(segment));
    return nonUuidSegments.join('-') || name; // Fallback to original if all segments were UUIDs
}

/**
 * Validates and auto-fixes project metadata issues (missing scope, empty name, etc.)
 */
export async function validateAndFixProjectMetadata(projectUri: vscode.Uri): Promise<void> {
    try {
        const metadataPath = vscode.Uri.joinPath(projectUri, "metadata.json");
        // Quick check if exists
        try {
            await vscode.workspace.fs.stat(metadataPath);
        } catch {
            return; // No metadata to fix
        }

        const metadataContent = await vscode.workspace.fs.readFile(metadataPath);
        const metadata = JSON.parse(Buffer.from(metadataContent).toString("utf-8"));
        let needsSave = false;

        // Auto-fix missing scope
        if (!metadata?.type?.flavorType?.currentScope) {
            if (!metadata.type) metadata.type = {};
            if (!metadata.type.flavorType) metadata.type.flavorType = {};

            metadata.type.flavorType.currentScope = generateProjectScope();

            if (!metadata.type.flavorType.flavor) {
                metadata.type.flavorType.flavor = {
                    name: "default",
                    usfmVersion: "3.0",
                    translationType: "unknown",
                    audience: "general",
                    projectType: "unknown",
                };
            }
            if (!metadata.type.flavorType.name) metadata.type.flavorType.name = "default";

            needsSave = true;
            console.log("Auto-fixed missing project scope in metadata.json");
        }

        // Auto-fix empty projectName
        if (!metadata.projectName) {
            const folderName = path.basename(projectUri.fsPath);
            const projectId =
                metadata.projectId ||
                metadata.id ||
                extractProjectIdFromFolderName(folderName);
            let newName = folderName;

            // Strip ID if present
            if (projectId && newName.includes(projectId)) {
                newName = newName.replace(projectId, "").replace(/-+$/, "").replace(/^-+/, "");
            }

            metadata.projectName = sanitizeProjectName(newName) || "Untitled Project";
            needsSave = true;
            console.log(`Auto-fixed empty projectName to "${metadata.projectName}"`);
        }

        if (needsSave) {
            await vscode.workspace.fs.writeFile(
                metadataPath,
                Buffer.from(JSON.stringify(metadata, null, 4))
            );
        }
    } catch (error) {
        console.error("Error validating/fixing project metadata:", error);
    }
}

/**
 * Scan watched folders for project folders marked for deletion and delete them.
 * This cleans up old _tmp folders from failed swap cleanups.
 * 
 * @param watchedFolders - List of parent directories to scan
 */
export async function cleanupFoldersMarkedForDeletion(watchedFolders: string[]): Promise<void> {
    const { readLocalProjectSwapFile } = await import("../../utils/localProjectSettings");

    for (const watchedFolder of watchedFolders) {
        try {
            const watchedFolderUri = vscode.Uri.file(watchedFolder);
            const entries = await vscode.workspace.fs.readDirectory(watchedFolderUri);

            for (const [name, type] of entries) {
                if (type !== vscode.FileType.Directory) continue;

                // Only check folders that look like swap temp folders (contain _tmp)
                if (!name.includes("_tmp")) continue;

                const folderPath = path.join(watchedFolder, name);
                const folderUri = vscode.Uri.file(folderPath);

                try {
                    const swapFile = await readLocalProjectSwapFile(folderUri);

                    if (swapFile?.markedForDeletion) {
                        debug(`Found folder marked for deletion: ${folderPath}`);
                        debug(`Swap completed at: ${swapFile.swapCompletedAt ? new Date(swapFile.swapCompletedAt).toISOString() : "unknown"}`);

                        // Attempt to delete the folder
                        try {
                            const fs = await import("fs");
                            fs.rmSync(folderPath, { recursive: true, force: true });
                            debug(`Successfully deleted folder: ${folderPath}`);
                        } catch (deleteErr) {
                            debug(`Could not delete folder ${folderPath}:`, deleteErr);
                            // Non-fatal - will try again on next scan
                        }
                    }
                } catch {
                    // localProjectSwap.json doesn't exist or can't be read - skip
                }
            }
        } catch (err) {
            debug(`Error scanning watched folder ${watchedFolder} for cleanup:`, err);
        }
    }
}
