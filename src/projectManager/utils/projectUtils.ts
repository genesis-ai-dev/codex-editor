import { LanguageCodes } from "../../utils/languageUtils";
import { nonCanonicalBookRefs } from "../../utils/verseRefUtils/verseData";
import { LanguageMetadata, LanguageProjectStatus, Project } from "codex-types";
import { getAllBookRefs } from "../../utils";
import * as vscode from "vscode";
import { v5 as uuidV5 } from "uuid";
import path from "path";
import ProjectTemplate from "../../providers/obs/data/TextTemplate.json";
import { ProjectMetadata, ProjectOverview } from "../../../types";
import { initializeProject } from "../projectInitializers";

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
                "Scripture", // fixme: does this needed in multi modal?
            generator: {
                softwareName: "Codex Editor",
                softwareVersion: "0.0.1",
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

    // FIXME: need to handle the case where the file does not exist
    vscode.workspace.fs
        .writeFile(projectFilePath, projectFileData)
        .then(() =>
            vscode.window.showInformationMessage(`Project created at ${projectFilePath.fsPath}`)
        );
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

// NOTE: commenting this on Sept 20/2024 - I think it's not used anymore
// export async function parseAndReplaceBibleFile(
//   bibleFile: string | undefined,
//   replace: boolean
// ) {
//   console.log("Starting to parse the Bible file.");

//   // Check if the bibleFile is provided
//   if (!bibleFile) {
//     console.error("No Bible file provided.");
//     return;
//   }
//   console.log(`Bible file provided: ${bibleFile}`);

//   // Replace the file extension from .txt to .bible
//   bibleFile = bibleFile.replace(/\.txt$/, ".bible");

//   // Get the workspace folders
//   const workspaceFolders = vscode.workspace.workspaceFolders;
//   if (!workspaceFolders) {
//     console.error("No workspace folders found.");
//     return;
//   }

//   // Construct the file path for the Bible file
//   const bibleFilePath = vscode.Uri.joinPath(
//     workspaceFolders[0].uri,
//     ".project/targetTextBibles",
//     path.basename(bibleFile)
//   );
//   console.log(`Constructed file path: ${bibleFilePath}`);

//   let bibleData;
//   try {
//     console.log(
//       `Attempting to read the Bible file from path: ${bibleFilePath}`
//     );
//     // Read the Bible file
//     bibleData = await vscode.workspace.fs.readFile(bibleFilePath);
//     console.log("Bible file read successfully.");
//   } catch (error) {
//     console.error("Failed to read the Bible file:", error);
//     return;
//   }

//   // Decode the Bible file content
//   const bibleText = new TextDecoder("utf-8").decode(bibleData);
//   console.log("Bible text decoded successfully.");

//   // Split the Bible text into lines
//   const lines = bibleText.split(/\r?\n/);
//   console.log(`Total lines found in the Bible text: ${lines.length}`);

//   // Initialize an object to store the books
//   const books: { [key: string]: string[] } = {};

//   // Iterate through each line and categorize them by book code
//   lines.forEach((line) => {
//     const bookCode = line.substring(0, 3);
//     if (!books[bookCode]) {
//       books[bookCode] = [];
//       console.log(`New book found and added: ${bookCode}`);
//     }
//     books[bookCode].push(line);
//   });

//   console.log(`Total books parsed: ${Object.keys(books).length}`);

//   // Construct the target folder path for the parsed books
//   const targetFolderPath = vscode.Uri.joinPath(
//     workspaceFolders[0].uri,
//     `.project/targetTextBibles/`,
//     path.basename(bibleFile).replace(/\.bible$/, "")
//   );

//   // Create the target folder if it doesn't exist
//   try {
//     await vscode.workspace.fs.createDirectory(targetFolderPath);
//     console.log(`Created target folder: ${targetFolderPath.fsPath}`);
//   } catch (error) {
//     console.error(`Failed to create target folder: ${error}`);
//     return;
//   }

//   // Iterate through each book and write its content to a file
//   for (const [bookCode, content] of Object.entries(books)) {
//     const workspaceFolders = vscode.workspace.workspaceFolders;
//     if (!workspaceFolders) {
//       console.error("No workspace folders found.");
//       return;
//     }
//     console.log(`Using workspace folder: ${workspaceFolders[0].uri.fsPath}`);

//     // Construct the target path for the book file
//     const targetPath = vscode.Uri.joinPath(
//       targetFolderPath,
//       `/${bookCode}.txt`
//     );
//     console.log(`Target path for writing: ${targetPath}`);

//     const fileContent = content.join("\n");
//     try {
//       console.log(`Writing to file for book ${bookCode}`);
//       // Write the book content to the file
//       await vscode.workspace.fs.writeFile(
//         targetPath,
//         new TextEncoder().encode(fileContent)
//       );
//       console.log(`File written for book ${bookCode} at ${targetPath.fsPath}`);
//     } catch (error) {
//       console.error(`Failed to write file for book ${bookCode}:`, error);
//     }
//   }

//   // Create project notebooks from the parsed text files
//   if (replace) {
//     createProjectNotebooksFromTxt({
//       shouldOverWrite: true,
//       folderWithTxtToConvert: [targetFolderPath],
//     });
//   }

//   // Delete the original Bible file
//   await deleteOriginalFiles(bibleFile);
// }

// async function deleteOriginalFiles(bibleFile: string) {
//     if (!vscode.workspace.workspaceFolders) {
//         console.error("No workspace folders found.");
//         return;
//     }
//     const workspaceFolderUri = vscode.workspace.workspaceFolders[0].uri;
//     const bibleFilePath = vscode.Uri.joinPath(
//         workspaceFolderUri,
//         ".project/targetTextBibles",
//         path.basename(bibleFile)
//     );
//     try {
//         console.log(`Deleting the original Bible file: ${bibleFilePath.fsPath}`);
//         await vscode.workspace.fs.delete(bibleFilePath);
//         const originalTxtPath = bibleFilePath.with({
//             path: bibleFilePath.path.replace(/\.bible$/, ".txt"),
//         });
//         console.log(`Deleting the original TXT file: ${originalTxtPath.fsPath}`);
//         await vscode.workspace.fs.delete(originalTxtPath);
//         console.log("Original files deleted successfully.");
//     } catch (error) {
//         console.error("Failed to delete original files:", error);
//     }
// }

export async function getProjectOverview(): Promise<ProjectOverview | undefined> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        console.error("No workspace folder found");
        return undefined;
    }

    const metadataUri = vscode.Uri.joinPath(workspaceFolder.uri, "metadata.json");

    try {
        const metadataContent = await vscode.workspace.fs.readFile(metadataUri);
        const metadata = JSON.parse(metadataContent.toString());
        console.log("metadata", { metadata });
        // Get a list of URIs for the downloaded source and target Bibles in the project, if any
        const sourceTextBiblesPath = vscode.Uri.joinPath(
            workspaceFolder.uri,
            ".project/sourceTextBibles"
        );
        const targetTextBiblesPath = vscode.Uri.joinPath(
            workspaceFolder.uri,
            ".project/targetTextBibles"
        );

        const sourceTextBibles: vscode.Uri[] = [];
        const targetTextBibles: vscode.Uri[] = [];

        try {
            const sourceEntries = await vscode.workspace.fs.readDirectory(sourceTextBiblesPath);
            for (const [name] of sourceEntries) {
                if (name.endsWith(".bible")) {
                    sourceTextBibles.push(vscode.Uri.joinPath(sourceTextBiblesPath, name));
                }
            }
        } catch (error) {
            console.error("Error reading source text Bibles:", error);
        }

        try {
            const targetEntries = await vscode.workspace.fs.readDirectory(targetTextBiblesPath);
            for (const [name] of targetEntries) {
                if (name.endsWith(".bible")) {
                    targetTextBibles.push(vscode.Uri.joinPath(targetTextBiblesPath, name));
                }
            }
        } catch (error) {
            console.error("Error reading target text Bibles:", error);
        }

        // Handle potential errors
        if (!targetTextBibles) {
            try {
                // Directory might not exist, attempt to create it
                await vscode.workspace.fs.createDirectory(targetTextBiblesPath);
                return undefined;
            } catch (err) {
                console.error("Error creating directory:", err);
                throw err; // Rethrow other errors
            }
        }

        const config = vscode.workspace.getConfiguration("codex-project-manager");

        return {
            projectName: metadata.projectName,
            abbreviation: metadata.meta.abbreviation,
            sourceLanguage: metadata.languages.find(
                (lang: LanguageMetadata) => lang.projectStatus === LanguageProjectStatus.SOURCE
            ),
            targetLanguage: metadata.languages.find(
                (lang: LanguageMetadata) => lang.projectStatus === LanguageProjectStatus.TARGET
            ),
            category: metadata.meta.category,
            userName: metadata.meta.generator.userName,
            sourceTextBibles,
            targetTextBibles,
            targetFont: metadata.targetFont || "",
        };
    } catch (error) {
        console.log("metadata.json not found or couldn't be read", { error });
        return undefined;
    }
}

export const checkIfMetadataIsInitialized = async (): Promise<boolean> => {
    const metadataUri = vscode.Uri.joinPath(
        vscode.workspace.workspaceFolders![0].uri,
        "metadata.json"
    );
    try {
        await vscode.workspace.fs.stat(metadataUri);
        return true;
    } catch (error) {
        // File doesn't exist, which is expected for a new project
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
