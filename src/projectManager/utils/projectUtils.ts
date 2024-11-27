import { LanguageCodes } from "../../utils/languageUtils";
import { nonCanonicalBookRefs } from "../../utils/verseRefUtils/verseData";
import { LanguageMetadata, LanguageProjectStatus, Project } from "codex-types";
import { getAllBookRefs } from "../../utils";
import * as vscode from "vscode";
import * as path from "path";
import semver from "semver";
import { ProjectMetadata, ProjectOverview } from "../../../types";
import { initializeProject } from "../projectInitializers";
import { getProjectMetadata } from "../../utils";
import git from "isomorphic-git";
import fs from "fs";

export interface ProjectDetails {
    projectName?: string;
    projectCategory?: string;
    userName?: string;
    abbreviation?: string;
    sourceLanguage?: LanguageMetadata;
    targetLanguage?: LanguageMetadata;
}

export async function promptForTargetLanguage(): Promise<ProjectDetails | undefined> {
    const languages = LanguageCodes;

    function getLanguageDisplayName(lang: LanguageMetadata): string {
        return `${lang.refName} (${lang.tag})`;
    }

    const quickPickItems = [...languages.map(getLanguageDisplayName), "$(add) Custom Language"];

    const targetLanguagePick = await vscode.window.showQuickPick(quickPickItems, {
        placeHolder: "Select the target language or choose custom",
        matchOnDescription: true,
        matchOnDetail: true,
    });

    if (!targetLanguagePick) {
        return;
    }

    let targetLanguage: LanguageMetadata;

    if (targetLanguagePick === "$(add) Custom Language") {
        const customLanguage = await vscode.window.showInputBox({
            prompt: "Enter custom language name",
            placeHolder: "e.g., My Custom Language",
        });

        if (!customLanguage) {
            return;
        }

        targetLanguage = {
            name: {
                en: customLanguage,
            },
            tag: "custom",
            refName: customLanguage,
            projectStatus: LanguageProjectStatus.TARGET,
        };
    } else {
        const selectedLanguage = languages.find(
            (lang: LanguageMetadata) => getLanguageDisplayName(lang) === targetLanguagePick
        );

        if (!selectedLanguage) {
            return;
        }

        targetLanguage = {
            ...selectedLanguage,
            projectStatus: LanguageProjectStatus.TARGET,
        };
    }

    return {
        targetLanguage,
    };
}

export async function promptForSourceLanguage(): Promise<ProjectDetails | undefined> {
    const languages = LanguageCodes;

    function getLanguageDisplayName(lang: LanguageMetadata): string {
        return `${lang.refName} (${lang.tag})`;
    }

    const quickPickItems = [...languages.map(getLanguageDisplayName), "$(add) Custom Language"];

    const sourceLanguagePick = await vscode.window.showQuickPick(quickPickItems, {
        placeHolder: "Select the source language or choose custom",
        matchOnDescription: true,
        matchOnDetail: true,
    });

    if (!sourceLanguagePick) {
        return;
    }

    let sourceLanguage: LanguageMetadata;

    if (sourceLanguagePick === "$(add) Custom Language") {
        const customLanguage = await vscode.window.showInputBox({
            prompt: "Enter custom language name",
            placeHolder: "e.g., My Custom Language",
        });

        if (!customLanguage) {
            return;
        }

        sourceLanguage = {
            name: {
                en: customLanguage,
            },
            tag: "custom",
            refName: customLanguage,
            projectStatus: LanguageProjectStatus.SOURCE,
        };
    } else {
        const selectedLanguage = languages.find(
            (lang: LanguageMetadata) => getLanguageDisplayName(lang) === sourceLanguagePick
        );

        if (!selectedLanguage) {
            return;
        }

        sourceLanguage = {
            ...selectedLanguage,
            projectStatus: LanguageProjectStatus.SOURCE,
        };
    }

    return {
        sourceLanguage,
    };
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

export async function initializeProjectMetadata(details: ProjectDetails) {
    // Initialize a new project with the given details and return the project object
    const newProject: Project = {
        format: "scripture burrito",
        projectName:
            details.projectName ||
            vscode.workspace.getConfiguration("codex-project-manager").get<string>("projectName") ||
            "", // previously "Codex Project"
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

    if (details.sourceLanguage) {
        newProject.languages.push(details.sourceLanguage);
    }
    if (details.targetLanguage) {
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
        const projectFileData = await vscode.workspace.fs.readFile(projectFilePath);
        project = JSON.parse(projectFileData.toString());
    } catch (error) {
        console.warn("Metadata file does not exist, creating a new one.");
        project = {}; // Initialize an empty project object if the file does not exist
    }

    const projectSettings = vscode.workspace.getConfiguration("codex-project-manager");
    const projectName = projectSettings.get("projectName", "");
    console.log("Project name loaded:", projectName);

    project.projectName = projectSettings.get("projectName", "");
    project.meta = project.meta || {}; // Ensure meta object exists
    project.meta.category = projectSettings.get("projectCategory", "");
    project.meta.generator = project.meta.generator || {}; // Ensure generator object exists
    project.meta.generator.userName = projectSettings.get("userName", "");
    project.languages[0] = projectSettings.get("sourceLanguage", "");
    project.languages[1] = projectSettings.get("targetLanguage", "");
    project.meta.abbreviation = projectSettings.get("abbreviation", "");
    // Update other fields as needed
    console.log("Project settings loaded:", { projectSettings, project });
    const updatedProjectFileData = Buffer.from(JSON.stringify(project, null, 4), "utf8");
    await vscode.workspace.fs.writeFile(projectFilePath, updatedProjectFileData);
    vscode.window.showInformationMessage(`Project metadata updated at ${projectFilePath.fsPath}`);
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

        return {
            format: metadata.format || "Unknown Format",
            projectName: metadata.projectName || "Unnamed Project",
            projectStatus: metadata.projectStatus || "Unknown Status",
            category: metadata.meta?.category || "Uncategorized",
            userName: metadata.meta?.generator?.userName || "Anonymous",
            meta: {
                version: metadata.meta?.version || "0.0.1",
                // FIXME: the codex-types library is out of date. Thus we have mismatched and/or duplicate values being defined
                category: metadata.meta?.category || "Uncategorized",
                generator: {
                    softwareName: metadata.meta?.generator?.softwareName || "Unknown Software",
                    softwareVersion: metadata.meta?.generator?.softwareVersion || "0.0.1",
                    userName: metadata.meta?.generator?.userName || "Anonymous",
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
        };
    } catch (error) {
        console.error("Failed to read project metadata:", error);
        return undefined;
    }
}

export const checkIfMetadataIsInitialized = async (): Promise<boolean> => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        console.error("No workspace folder found");
        return false;
    }

    const metadataUri = vscode.Uri.joinPath(workspaceFolder.uri, "metadata.json");
    console.log("Checking metadata at:", metadataUri.fsPath);

    try {
        await vscode.workspace.fs.stat(metadataUri);
        console.log("Metadata file exists");
        return true;
    } catch (error) {
        console.error("Metadata file does not exist or cannot be accessed:", error);
        return false;
    }
};

export const createProjectFiles = async ({ shouldImportUSFM }: { shouldImportUSFM: boolean }) => {
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
        console.log("No workspace folder found. Please open a folder to store your project in.");
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
        console.log("Metadata file not found or cannot be read. This is normal for a new project.");
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

export async function findAllCodexProjects(): Promise<
    Array<{
        name: string;
        path: string;
        lastOpened?: Date;
        lastModified: Date;
        version: string;
        hasVersionMismatch?: boolean;
        gitOriginUrl?: string;
    }>
> {
    const config = vscode.workspace.getConfiguration("codex-project-manager");
    const watchedFolders = config.get<string[]>("watchedFolders") || [];
    const projectHistory = config.get<Record<string, string>>("projectHistory") || {};

    const projects: Array<{
        name: string;
        path: string;
        lastOpened?: Date;
        lastModified: Date;
        version: string;
        hasVersionMismatch?: boolean;
        gitOriginUrl?: string;
    }> = [];

    for (const folder of watchedFolders) {
        try {
            const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(folder));
            for (const [name, type] of entries) {
                if (type === vscode.FileType.Directory) {
                    const projectPath = path.join(folder, name);
                    const projectStatus = await isValidCodexProject(projectPath);

                    if (projectStatus.isValid) {
                        const stats = await vscode.workspace.fs.stat(vscode.Uri.file(projectPath));

                        // Get git origin URL using isomorphic-git
                        let gitOriginUrl: string | undefined;
                        try {
                            console.log({ projectPath });
                            const config = await git.listRemotes({
                                fs,
                                dir: projectPath,
                            });
                            console.log({ config });
                            const origin = config.find((remote: any) => remote.remote === "origin");
                            gitOriginUrl = origin?.url;
                        } catch (error) {
                            // Repository might not exist or have no remotes
                            console.debug(`No git origin found for ${projectPath}:`, error);
                        }

                        projects.push({
                            name,
                            path: projectPath,
                            lastOpened: projectHistory[projectPath]
                                ? new Date(projectHistory[projectPath])
                                : undefined,
                            lastModified: new Date(stats.mtime),
                            version: projectStatus.version || "unknown",
                            hasVersionMismatch: projectStatus.hasVersionMismatch,
                            gitOriginUrl,
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
