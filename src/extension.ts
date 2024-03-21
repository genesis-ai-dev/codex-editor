"use strict";

import * as vscode from "vscode";
import { CodexKernel } from "./controller";
import { CodexContentSerializer } from "./serializer";
import {
    checkServerHeartbeat,
    registerTextSelectionHandler,
} from "./handlers/textSelectionHandler";

import {
    NOTEBOOK_TYPE,
    createCodexNotebook,
    createProjectCommentFiles,
    createProjectNotebooks,
} from "./utils/codexNotebookUtils";
import { CodexNotebookProvider } from "./providers/treeViews/scriptureTreeViewProvider";
import {
    getAllBookRefs,
    getProjectMetadata,
    getWorkSpaceFolder,
    jumpToCellInNotebook,
} from "./utils";
import { registerReferencesCodeLens } from "./referencesCodeLensProvider";
import { registerSourceCodeLens } from "./sourceCodeLensProvider";
import { LanguageMetadata, LanguageProjectStatus, Project } from "codex-types";
import { nonCanonicalBookRefs } from "./utils/verseRefUtils/verseData";
import { LanguageCodes } from "./utils/languageUtils";
import { ResourceProvider } from "./providers/treeViews/resourceTreeViewProvider";
import {
    initializeProjectMetadata,
    promptForProjectDetails,
} from "./utils/projectUtils";
import {
    searchVerseRefPositionIndex,
    indexVerseRefsInSourceText,
} from "./commands/indexVrefsCommand";
import {
    triggerInlineCompletion,
    provideInlineCompletionItems,
} from "./providers/translationSuggestions/inlineCompletionsProvider";

/* -------------------------------------------------------------------------
 * NOTE: This file's invocation of a python server is a derivative work of
 * "extension.ts" from the vscode-python, whose original notice is below.
 *
 * Original work Copyright (c) Microsoft Corporation. All rights reserved.
 * Original work licensed under the MIT License.
 * See ThirdPartyNotices.txt in the project root for license information.
 * All modifications Copyright (c) Open Law Library. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License")
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http: // www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * ----------------------------------------------------------------------- */

import * as net from "net";
import * as path from "path";
import * as semver from "semver";

import { PythonExtension } from "@vscode/python-extension";
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    State,
    integer,
} from "vscode-languageclient/node";
import { registerParallelViewWebviewProvider } from "./providers/parallelPassagesWebview/customParallelPassagesWebviewProvider";
import { registerSemanticViewProvider } from "./providers/semanticView/customSemanticViewProvider";
import { registerDictionaryTableProvider } from "./providers/dictionaryTable/dictionaryTableProvider";
import { CreateProjectProvider } from "./providers/obs/CreateProject/CreateProjectProvider";
import { registerDictionarySummaryProvider } from "./providers/dictionaryTable/dictionarySummaryProvider";
import { ResourcesProvider } from "./providers/obs/resources/resourcesProvider";
import { StoryOutlineProvider } from "./providers/obs/storyOutline/storyOutlineProvider";
import { ObsEditorProvider } from "./providers/obs/editor/ObsEditorProvider";
import {
    addRemote,
    initProject,
    stageAndCommit,
    sync,
} from "./providers/scm/git";
import { TranslationNotesProvider } from "./providers/translationNotes/TranslationNotesProvider";
import { registerScmStatusBar } from "./providers/scm/statusBar";
import { DownloadedResource } from "./providers/obs/resources/types";
import { translationAcademy } from "./providers/translationAcademy/provider";
import {
    EbibleCorpusMetadata,
    downloadEBibleText,
    ensureVrefList,
    getEBCorpusMetadataByLanguageCode,
} from "./utils/ebibleCorpusUtils";

const MIN_PYTHON = semver.parse("3.7.9");
const ROOT_PATH = getWorkSpaceFolder();

const PATHS_TO_POPULATE = [
    // "metadata.json", // This is where we store the project metadata in scripture burrito format, but we create this using the project initialization command
    { filePath: "drafts/" }, // This is where we store the project drafts, including project.dictionary and embedding dbs
    { filePath: "drafts/target/" }, // This is where we store the drafted scripture in particular as .codex files
    { filePath: "drafts/project.dictionary", defaultContent: "" }, // This is where we store the project dictionary
    { filePath: "comments.json", defaultContent: "" }, // This is where we store the VS Code comments api comments, such as on .bible files
    { filePath: "notebook-comments.json", defaultContent: "[]" }, // We can't use the VS Code comments api for notebooks (.codex files), so a second files avoids overwriting conflicts
    { filePath: "chat-threads.json", defaultContent: "[]" }, // This is where chat thread conversations are saved
];

// The following block ensures a smooth user experience by guiding the user through the initial setup process before the extension is fully activated. This is crucial for setting up the necessary project environment and avoiding any functionality issues that might arise from missing project configurations.

// NOTE: the following two blocks are deactivated for now while we work on the project management extension. We might not need them.
// // First, check if a project root path is set, indicating whether the user has an existing project open.
// if (!ROOT_PATH) {
//     // If no project is found, prompt the user to select a project folder. This step is essential to ensure that the extension operates within the context of a project, which is necessary for most of its functionalities.
//     vscode.window
//         .showInformationMessage(
//             "No project found. You need to select a project folder for your new project, or open an existing project folder.",
//             { modal: true }, // The modal option is used here to make sure the user addresses this prompt before proceeding, ensuring that the extension does not proceed without a project context.
//             "Select a Folder",
//         )
//         .then((result) => {
//             // Depending on the user's choice, either guide them to select a folder and initialize a new project or quit the application. This decision point is crucial for aligning the extension's state with the user's intent.
//             if (result === "Select a Folder") {
//                 openWorkspace();
//                 // This command initializes a new project, setting up the necessary project structure and files, ensuring that the user starts with a properly configured environment.
//                 vscode.commands.executeCommand(
//                     "codex-editor-extension.initializeNewProject",
//                 );
//             } else {
//                 // If the user decides not to select a folder, quitting the application prevents them from encountering unanticipated behavior due to the lack of a project context.
//                 vscode.commands.executeCommand("workbench.action.quit");
//             }
//         });
// } else {
//     // If a project root path exists, check for the presence of a metadata file to determine if the project needs initialization. This step ensures that existing projects are correctly recognized and that the extension does not reinitialize them unnecessarily.
//     const metadataPath = path.join(ROOT_PATH, "metadata.json");
//     if (!vscode.workspace.fs.stat(vscode.Uri.file(metadataPath))) {
//         // Initialize a new project if the metadata file is missing, ensuring that the project has all the necessary configurations for the extension to function correctly.
//         vscode.commands.executeCommand(
//             "codex-editor-extension.initializeNewProject",
//         );
//     }
// }

// // This function handles the workspace folder selection and opening process. It is a critical part of the initial setup, ensuring that the user doesn't work with a virtual workspace or an empty folder, which could lead to unexpected behavior.
// async function openWorkspace() {
//     let workspaceFolder;
//     const openFolder = await vscode.window.showOpenDialog({
//         canSelectFolders: true,
//         canSelectFiles: false,
//         canSelectMany: false,
//         openLabel: "Choose project folder",
//     });
//     if (openFolder && openFolder.length > 0) {
//         await vscode.commands.executeCommand(
//             "vscode.openFolder",
//             openFolder[0],
//             false,
//         );
//         workspaceFolder = vscode.workspace.workspaceFolders
//             ? vscode.workspace.workspaceFolders[0]
//             : undefined;
//     }
//     if (!workspaceFolder) {
//         return;
//     }
// }

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
        console.error("No workspace opened.");
        return;
    }
}

let isExtensionInitialized = false;
let client: LanguageClient | undefined;
let clientStarting = false;
let python: PythonExtension;
let pyglsLogger: vscode.LogOutputChannel;

let scmInterval: any; // Webpack & typescript for vscode are having issues

export async function activate(context: vscode.ExtensionContext) {
    indexVerseRefsInSourceText();
    /** BEGIN CODEX EDITOR EXTENSION FUNCTIONALITY */

    // Add .bible files to the files.readonlyInclude glob pattern to make them readonly without overriding existing patterns
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

    const fallbackFont = "serif";
    // config.update(
    //     "editor.fontFamily",
    //     fallbackFont,
    //     vscode.ConfigurationTarget.Workspace,
    // );

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
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor-extension.indexVrefs",
            indexVerseRefsInSourceText,
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor-extension.openTnAcademy",
            async (resource: DownloadedResource) => {
                await translationAcademy(context, resource);
            },
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor-extension.searchIndex",
            async () => {
                const searchString = await vscode.window.showInputBox({
                    prompt: "Enter the task number to check its status",
                    placeHolder: "Task number",
                });
                if (searchString !== undefined) {
                    searchVerseRefPositionIndex(searchString);
                }
            },
        ),
    );

    // Register the Codex Notebook serializer for saving and loading .codex files
    context.subscriptions.push(
        vscode.workspace.registerNotebookSerializer(
            NOTEBOOK_TYPE,
            new CodexContentSerializer(),
            { transientOutputs: true },
        ),
        new CodexKernel(),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor-extension.openChapter",
            async (notebookPath: string, chapterIndex: number) => {
                try {
                    jumpToCellInNotebook(notebookPath, chapterIndex);
                } catch (error) {
                    console.error(`Failed to open chapter: ${error}`);
                }
            },
        ),
    );

    // Register a command called openChapter that opens a specific .codex notebook to a specific chapter
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-notebook-extension.openFile",
            async (resourceUri: vscode.Uri) => {
                try {
                    const document =
                        await vscode.workspace.openTextDocument(resourceUri);
                    await vscode.window.showTextDocument(
                        document,
                        vscode.ViewColumn.Beside,
                    );
                } catch (error) {
                    console.error(`Failed to open document: ${error}`);
                }
            },
        ),
    );
    // Register extension commands
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor-extension.createCodexNotebook",
            async () => {
                vscode.window.showInformationMessage("Creating Codex Notebook");
                const doc = await createCodexNotebook();
                await vscode.window.showNotebookDocument(doc);
            },
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor-extension.initializeNewProject",
            async () => {
                const workspaceFolder = vscode.workspace.workspaceFolders
                    ? vscode.workspace.workspaceFolders[0]
                    : undefined;
                if (!workspaceFolder) {
                    console.error(
                        "No workspace folder found. Please open a folder to store your project in.",
                    );
                    return;
                }

                vscode.window.showInformationMessage(
                    "Initializing new project...",
                );
                try {
                    const projectDetails = await promptForProjectDetails();
                    if (projectDetails) {
                        const projectFilePath = await vscode.Uri.joinPath(
                            workspaceFolder.uri,
                            "metadata.json",
                        );

                        const fileExists = await vscode.workspace.fs
                            .stat(projectFilePath)
                            .then(
                                () => true,
                                () => false,
                            );

                        if (fileExists) {
                            const fileData =
                                await vscode.workspace.fs.readFile(
                                    projectFilePath,
                                );
                            const metadata = JSON.parse(fileData.toString());
                            const projectName = metadata.projectName;
                            const confirmDelete =
                                await vscode.window.showInputBox({
                                    prompt: `A project named ${projectName} already already exists. Type the project name to confirm deletion.`,
                                    placeHolder: "Project name",
                                });
                            if (confirmDelete !== projectName) {
                                vscode.window.showErrorMessage(
                                    "Project name does not match. Initialization cancelled.",
                                );
                                return;
                            }
                        }

                        const newProject =
                            await initializeProjectMetadata(projectDetails);
                        vscode.window.showInformationMessage(
                            `New project initialized: ${newProject?.meta.generator.userName}'s ${newProject?.meta.category}`,
                        );

                        // Spawn notebooks based on project scope
                        const projectScope =
                            newProject?.type.flavorType.currentScope;
                        if (!projectScope) {
                            vscode.window.showErrorMessage(
                                "Failed to initialize new project: project scope not found.",
                            );
                            return;
                        }
                        const books = Object.keys(projectScope);

                        const overwriteConfirmation =
                            await vscode.window.showWarningMessage(
                                "Do you want to overwrite any existing project files?",
                                { modal: true }, // This option ensures the dialog stays open until an explicit choice is made.
                                "Yes",
                                "No",
                            );
                        if (overwriteConfirmation === "Yes") {
                            vscode.window.showInformationMessage(
                                "Creating Codex Project with overwrite.",
                            );
                            await createProjectNotebooks({
                                shouldOverWrite: true,
                                books,
                            });
                            await createProjectCommentFiles({
                                shouldOverWrite: true,
                            });
                        } else if (overwriteConfirmation === "No") {
                            vscode.window.showInformationMessage(
                                "Creating Codex Project without overwrite.",
                            );
                            await createProjectNotebooks({ books });
                            await createProjectCommentFiles({
                                shouldOverWrite: false,
                            });
                        }
                    } else {
                        vscode.window.showInformationMessage(
                            "Project initialization cancelled.",
                        );
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to initialize new project: ${error}`,
                    );
                }
                await vscode.commands.executeCommand(
                    "scripture-explorer-activity-bar.refreshEntry",
                );
                await vscode.commands.executeCommand(
                    "codex-editor.setEditorFontToTargetLanguage",
                );
                await vscode.commands.executeCommand(
                    "codex-editor.downloadSourceTextBibles",
                );
            },
        ),
    );

    vscode.commands.registerCommand(
        "codex-editor.setEditorFontToTargetLanguage",
        async () => {
            const projectMetadata = await getProjectMetadata();
            const targetLanguageCode = projectMetadata?.languages?.find(
                (language) =>
                    language.projectStatus === LanguageProjectStatus.TARGET,
            )?.tag;
            if (targetLanguageCode) {
                const fontApiUrl = `https://lff.api.languagetechnology.org/lang/${targetLanguageCode}`;
                const fontApiResponse = await fetch(fontApiUrl);
                const fontApiData = await fontApiResponse.json();
                const defaultFontFamily = fontApiData.defaultfamily[0];
                const fontFile =
                    fontApiData.families[defaultFontFamily].defaults.ttf;
                const fontFileRemoteUrl =
                    fontApiData.families[defaultFontFamily].files[fontFile].url;
                const workspaceRoot =
                    vscode.workspace.workspaceFolders?.[0].uri.fsPath;
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
                        const fontFileBuffer =
                            await fontFileResponse.arrayBuffer();
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
                config.update(
                    "editor.fontFamily",
                    `${defaultFontFamily} ${fallbackFont}`,
                    vscode.ConfigurationTarget.Workspace,
                );
                vscode.window.showInformationMessage(
                    `Font set to ${defaultFontFamily} with fallback to ${fallbackFont}`,
                );
            }
        },
    );

    vscode.commands.registerCommand(
        "codex-editor-extension.downloadSourceTextBibles",
        async () => {
            const projectMetadata = await getProjectMetadata();
            const sourceLanguageCode = projectMetadata?.languages?.find(
                (language) =>
                    language.projectStatus === LanguageProjectStatus.SOURCE,
            )?.tag;
            if (sourceLanguageCode) {
                const ebibleCorpusMetadata: EbibleCorpusMetadata[] =
                    getEBCorpusMetadataByLanguageCode(sourceLanguageCode);
                if (ebibleCorpusMetadata.length === 0) {
                    vscode.window.showErrorMessage(
                        `No source text bibles found for ${sourceLanguageCode} in the eBible corpus.`,
                    );
                    return;
                }
                const selectedCorpus = await vscode.window.showQuickPick(
                    ebibleCorpusMetadata.map((corpus) => corpus.file),
                    {
                        placeHolder: "Select a source text bible to download",
                    },
                );

                if (selectedCorpus) {
                    const selectedCorpusMetadata = ebibleCorpusMetadata.find(
                        (corpus) => corpus.file === selectedCorpus,
                    );
                    if (selectedCorpusMetadata) {
                        const workspaceRoot =
                            vscode.workspace.workspaceFolders?.[0].uri.fsPath;
                        if (workspaceRoot) {
                            const vrefPath =
                                await ensureVrefList(workspaceRoot);

                            const sourceTextBiblePath = path.join(
                                workspaceRoot,
                                ".project",
                                "sourceTextBibles",
                                selectedCorpusMetadata.file,
                            );
                            const sourceTextBiblePathUri =
                                vscode.Uri.file(sourceTextBiblePath);
                            try {
                                console.log(
                                    "Checking if source text bible exists",
                                );
                                await vscode.workspace.fs.stat(
                                    sourceTextBiblePathUri,
                                );
                                vscode.window.showInformationMessage(
                                    `Source text bible ${selectedCorpusMetadata.file} already exists.`,
                                );
                            } catch {
                                await downloadEBibleText(
                                    selectedCorpusMetadata,
                                    workspaceRoot,
                                );
                                vscode.window.showInformationMessage(
                                    `Source text bible for ${selectedCorpusMetadata.lang} downloaded successfully.`,
                                );
                            }

                            // Read the vref.txt file and the newly downloaded source text bible file
                            const vrefFilePath = vscode.Uri.file(vrefPath);
                            const vrefFileData =
                                await vscode.workspace.fs.readFile(
                                    vrefFilePath,
                                );
                            const vrefLines = new TextDecoder("utf-8")
                                .decode(vrefFileData)
                                .split(/\r?\n/)
                                .filter((line) => line.trim() !== "");

                            const sourceTextBibleData =
                                await vscode.workspace.fs.readFile(
                                    sourceTextBiblePathUri,
                                );
                            const bibleLines = new TextDecoder("utf-8")
                                .decode(sourceTextBibleData)
                                .split(/\r?\n/)
                                .filter((line) => line.trim() !== "");

                            // Zip the lines together
                            const zippedLines = vrefLines
                                .map(
                                    (vrefLine, index) =>
                                        `${vrefLine} ${
                                            bibleLines[index] || ""
                                        }`,
                                )
                                .filter((line) => line.trim() !== "");

                            // Write the zipped lines to a new .bible file
                            const bibleFilePath = path.join(
                                workspaceRoot,
                                ".project",
                                "sourceTextBibles",
                                `${selectedCorpusMetadata.file}.bible`,
                            );
                            const bibleFileUri = vscode.Uri.file(bibleFilePath);
                            await vscode.workspace.fs.writeFile(
                                bibleFileUri,
                                new TextEncoder().encode(
                                    zippedLines.join("\n"),
                                ),
                            );

                            vscode.window.showInformationMessage(
                                `.bible file created successfully at ${bibleFilePath}`,
                            );
                        }
                    }
                }
            }
            indexVerseRefsInSourceText();
        },
    );

    // Register and create the Scripture Tree View
    const scriptureTreeViewProvider = new CodexNotebookProvider(ROOT_PATH);
    const resourceTreeViewProvider = new ResourceProvider(ROOT_PATH);

    vscode.window.registerTreeDataProvider(
        "resource-explorer",
        resourceTreeViewProvider,
    );

    vscode.commands.registerCommand("resource-explorer.refreshEntry", () =>
        resourceTreeViewProvider.refresh(),
    );
    vscode.window.registerTreeDataProvider(
        "scripture-explorer-activity-bar",
        scriptureTreeViewProvider,
    );

    vscode.commands.registerCommand(
        "scripture-explorer-activity-bar.refreshEntry",
        () => scriptureTreeViewProvider.refresh(),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "scripture-explorer-activity-bar.openChapter",
            async (notebookPath: string, chapterIndex: number) => {
                try {
                    jumpToCellInNotebook(notebookPath, chapterIndex);
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to open chapter: ${error}`,
                    );
                }
            },
        ),
    );

    // Check and create missing project files or directories as specified in PATHS_TO_POPULATE
    if (ROOT_PATH) {
        vscode.window.showInformationMessage(
            "Checking for missing project files...",
        );
        for (const fileToPopulate of PATHS_TO_POPULATE) {
            const fullPath = vscode.Uri.joinPath(
                vscode.Uri.file(ROOT_PATH),
                fileToPopulate.filePath,
            );
            try {
                await vscode.workspace.fs.stat(fullPath);
            } catch (error) {
                // Determine if the missing path is a file or a directory based on its name
                if (fileToPopulate.filePath.includes(".")) {
                    // Assuming it's a file if there's an extension
                    vscode.window.showInformationMessage(
                        `Creating file: ${fileToPopulate}`,
                    );
                    await vscode.workspace.fs.writeFile(
                        fullPath,
                        new TextEncoder().encode(
                            fileToPopulate.defaultContent || "",
                        ),
                    ); // Create an empty file
                } else {
                    // Assuming it's a directory if there's no file extension
                    vscode.window.showInformationMessage(
                        `Creating directory: ${fileToPopulate}`,
                    );
                    await vscode.workspace.fs.createDirectory(fullPath);
                }
            }
        }
    }
    /** END CODEX EDITOR EXTENSION FUNCTIONALITY */

    /** BEGIN PYTHON SERVER FUNCTIONALITY */

    pyglsLogger = vscode.window.createOutputChannel("pygls", { log: true });
    pyglsLogger.info("Extension activated.");
    pyglsLogger.info(`extension path ${context.extensionPath}`);

    await getPythonExtension();
    if (!python) {
        vscode.window.showErrorMessage("Python extension not found");
    }

    const [, syncStatus] = registerScmStatusBar(context);

    // Restart language server command
    context.subscriptions.push(
        vscode.commands.registerCommand("pygls.server.restart", async () => {
            pyglsLogger.info("restarting server...");
            await startLangServer(context);
        }),
    );

    // Execute command... command
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "pygls.server.executeCommand",
            async () => {
                await executeServerCommand();
            },
        ),
    );

    // Restart the language server if the user switches Python envs...
    context.subscriptions.push(
        python.environments.onDidChangeActiveEnvironmentPath(async () => {
            pyglsLogger.info("python env modified, restarting server...");
            await startLangServer(context);
        }),
    );

    // ... or if they change a relevant config option
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (event) => {
            if (
                event.affectsConfiguration("pygls.server") ||
                event.affectsConfiguration("pygls.client")
            ) {
                pyglsLogger.info("config modified, restarting server...");
                await startLangServer(context);
            }
        }),
    );

    // Start the language server once the user opens the first text document...
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(async () => {
            if (!client) {
                await startLangServer(context);
            }
        }),
    );

    // ...or notebook.
    context.subscriptions.push(
        vscode.workspace.onDidOpenNotebookDocument(async () => {
            if (!client) {
                await startLangServer(context);
            }
        }),
    );

    // Ensure inline completions are registered for all supported languages
    const languages = ["scripture"]; // NOTE: could add others, e.g., 'usfm', here
    const disposables = languages.map((language) => {
        return vscode.languages.registerInlineCompletionItemProvider(language, {
            provideInlineCompletionItems,
        });
    });
    disposables.forEach((disposable) => context.subscriptions.push(disposable));

    const commandDisposable = vscode.commands.registerCommand(
        "extension.triggerInlineCompletion",
        triggerInlineCompletion,
        triggerInlineCompletion,
    );

    // on document changes, trigger inline completions
    vscode.workspace.onDidChangeTextDocument((e) => {
        // FIXME: use more specific conditions to trigger inline completions?
        const shouldTriggerInlineCompletion = e.contentChanges.length > 0;
        if (shouldTriggerInlineCompletion) {
            triggerInlineCompletion();
        }
    });

    context.subscriptions.push(commandDisposable);

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor.scm.stageAndCommitAll",
            async () => {
                await stageAndCommit();
                await syncStatus();
            },
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor.scm.addRemote",
            async () => {
                const remoteUrl = await vscode.window.showInputBox({
                    prompt: "Enter the remote URL to add",
                    placeHolder: "Remote URL",
                });

                if (remoteUrl) {
                    await addRemote(remoteUrl);
                }

                await syncStatus();
            },
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("codex-editor.scm.sync", async () => {
            await sync();
            await syncStatus();
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor.scm.syncedNotification",
            async () => {
                vscode.window.showInformationMessage("Project is synced");
            },
        ),
    );

    // Updating the status bar
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(syncStatus),
    );
    context.subscriptions.push(
        vscode.workspace.onDidSaveNotebookDocument(syncStatus),
    );

    // Let's set the extension as initialized so that we can defer the
    // starting of certain functionality until the extension is ready
    isExtensionInitialized = true;
    registerReferencesCodeLens(context);
    registerSourceCodeLens(context);
    registerParallelViewWebviewProvider(context);
    registerSemanticViewProvider(context);
    registerDictionaryTableProvider(context);
    registerDictionarySummaryProvider(context);
    registerTextSelectionHandler(context, () => undefined);
    context.subscriptions.push(CreateProjectProvider.register(context));
    context.subscriptions.push(ResourcesProvider.register(context));
    context.subscriptions.push(StoryOutlineProvider.register(context));
    context.subscriptions.push(ObsEditorProvider.register(context));
    const { providerRegistration, commandRegistration } =
        TranslationNotesProvider.register(context);
    context.subscriptions.push(providerRegistration);
    context.subscriptions.push(commandRegistration);

    // Make scripture-explorer-activity-bar the active primary sidebar view by default
    // vscode.commands.executeCommand("workbench.action.activityBarLocation.hide");
    vscode.commands.executeCommand(
        "workbench.view.extension.scripture-explorer-activity-bar",
    );
    vscode.commands.executeCommand("workbench.action.focusAuxiliaryBar");

    // Try to set workspace font to target language font
    // FIXME: we should be language-scoping to scripture language or file type if possible, and then pulling down both source and target fonts
    // Cf. https://stackoverflow.com/a/64722109
    vscode.window.showInformationMessage("Setting font to target language...");
    vscode.commands.executeCommand(
        "codex-editor.setEditorFontToTargetLanguage",
    );
    vscode.window.showInformationMessage(
        "Ensuring Source Bible is downloaded...",
    );
    vscode.commands.executeCommand("codex-editor.downloadSourceTextBibles");

    scmInterval = setInterval(stageAndCommit, 1000 * 60 * 15);
}

export function deactivate(): Thenable<void> {
    scmInterval && clearInterval(scmInterval);
    return stopLangServer();
}

/**
 * Start (or restart) the language server.
 *
 * @param command The executable to run
 * @param args Arguments to pass to the executable
 * @param cwd The working directory in which to run the executable
 * @returns
 */
async function startLangServer(context: vscode.ExtensionContext) {
    // Don't interfere if we are already in the process of launching the server.
    if (clientStarting) {
        return;
    }

    clientStarting = true;
    if (client) {
        await stopLangServer();
    }

    const config = vscode.workspace.getConfiguration("pygls.server");
    const server_path = "/servers/server.py";
    const extension_path = context.extensionPath;

    const full_path = vscode.Uri.parse(extension_path + server_path);
    pyglsLogger.info(`full_server_path: '${full_path}'`);

    const pythonCommand = await getPythonCommand(full_path);

    if (!pythonCommand) {
        clientStarting = false;
        return;
    }
    pyglsLogger.info(`python: ${pythonCommand.join(" ")}`);
    const cwd = extension_path.toString();

    const serverOptions: ServerOptions = {
        command: pythonCommand[0],
        args: [...pythonCommand.slice(1), full_path.fsPath],
        options: { cwd },
    };

    client = new LanguageClient("pygls", serverOptions, getClientOptions());
    const promises = [client.start()];

    if (config.get<boolean>("debug")) {
        promises.push(startDebugging());
    }

    const results = await Promise.allSettled(promises);
    clientStarting = false;

    for (const result of results) {
        if (result.status === "rejected") {
            pyglsLogger.error(
                `There was a error starting the server: ${result.reason}`,
            );
        }
    }
    setInterval(() => {
        checkServerHeartbeat(context);
    }, 10000);
}

async function stopLangServer(): Promise<void> {
    if (!client) {
        return;
    }

    if (client.state === State.Running) {
        await client.stop();
    }

    client.dispose();
    client = undefined;
}

function startDebugging(): Promise<void> {
    if (!vscode.workspace.workspaceFolders) {
        pyglsLogger.error("Unable to start debugging, there is no workspace.");
        return Promise.reject(
            "Unable to start debugging, there is no workspace.",
        );
    }
    // TODO: Is there a more reliable way to ensure the debug adapter is ready?
    return new Promise((resolve, reject) => {
        setTimeout(async () => {
            const workspaceFolder =
                vscode?.workspace?.workspaceFolders &&
                vscode?.workspace?.workspaceFolders[0];
            if (!workspaceFolder) {
                pyglsLogger.error(
                    "Unable to start debugging, there is no workspace.",
                );
                reject("Unable to start debugging, there is no workspace.");
            } else {
                try {
                    await vscode.debug.startDebugging(
                        workspaceFolder,
                        "pygls: Debug Server",
                    );
                    resolve();
                } catch (error) {
                    pyglsLogger.error(`Failed to start debugging: ${error}`);
                    reject("Failed to start debugging.");
                }
            }
        }, 2000);
    });
}

function getClientOptions(): LanguageClientOptions {
    const options = {
        documentSelector: [
            {
                language: "scripture",
                scheme: "*",
                pattern: "**/*.codex",
            },
            {
                language: "scripture",
                scheme: "file",
                pattern: "**/*.bible",
            },
            {
                language: "scripture",
                scheme: "file",
                pattern: "**/*.scripture",
            },
            {
                schema: "file",
                language: "plaintext",
            },
        ],
        outputChannel: pyglsLogger,
        connectionOptions: {
            maxRestartCount: 1, // don't restart on server failure.
        },
    };
    pyglsLogger.info(
        `client options: ${JSON.stringify(options, undefined, 2)}`,
    );
    return options;
}

function startLangServerTCP(addr: number): LanguageClient {
    const serverOptions: ServerOptions = () => {
        return new Promise((resolve /*, reject */) => {
            const clientSocket = new net.Socket();
            clientSocket.connect(addr, "127.0.0.1", () => {
                resolve({
                    reader: clientSocket,
                    writer: clientSocket,
                });
            });
        });
    };

    return new LanguageClient(
        `tcp lang server (port ${addr})`,
        serverOptions,
        getClientOptions(),
    );
}

/**
 * Execute a command provided by the language server.
 */
async function executeServerCommand() {
    if (!client || client.state !== State.Running) {
        await vscode.window.showErrorMessage(
            "There is no language server running.",
        );
        return;
    }

    const knownCommands =
        client?.initializeResult?.capabilities.executeCommandProvider?.commands;
    if (!knownCommands || knownCommands.length === 0) {
        const info = client?.initializeResult?.serverInfo;
        const name = info?.name || "Server";
        const version = info?.version || "";

        await vscode.window.showInformationMessage(
            `${name} ${version} does not implement any commands.`,
        );
        return;
    }

    const commandName = await vscode.window.showQuickPick(knownCommands, {
        canPickMany: false,
    });
    if (!commandName) {
        return;
    }
    pyglsLogger.info(`executing command: '${commandName}'`);

    const result = await vscode.commands.executeCommand(
        commandName,
        vscode.window.activeTextEditor?.document.uri,
    );
    pyglsLogger.info(
        `${commandName} result: ${JSON.stringify(result, undefined, 2)}`,
    );
}

/**
 * Return the python command to use when starting the server.
 *
 * If debugging is enabled, this will also included the arguments to required
 * to wrap the server in a debug adapter.
 *
 * @returns The full python command needed in order to start the server.
 */
async function getPythonCommand(
    resource?: vscode.Uri,
): Promise<string[] | undefined> {
    const config = vscode.workspace.getConfiguration("pygls.server", resource);
    const pythonPath = await getPythonInterpreter(resource);
    if (!pythonPath) {
        return;
    }
    const command = [pythonPath];
    const enableDebugger = config.get<boolean>("debug");

    if (!enableDebugger) {
        return command;
    }

    const debugHost = config.get<string>("debugHost");
    const debugPort = config.get<integer>("debugPort");

    if (!debugHost || !debugPort) {
        pyglsLogger.error(
            "Debugging is enabled but no debug host or port is set.",
        );
        pyglsLogger.error("Debugger will not be available.");
        return command;
    }
    try {
        const debugArgs = await python.debug.getRemoteLauncherCommand(
            debugHost,
            debugPort,
            true,
        );
        // Debugpy recommends we disable frozen modules
        command.push("-Xfrozen_modules=off", ...debugArgs);
    } catch (err) {
        pyglsLogger.error(`Unable to get debugger command: ${err}`);
        pyglsLogger.error("Debugger will not be available.");
    }

    return command;
}

/**
 * Return the python interpreter to use when starting the server.
 *
 * This uses the official python extension to grab the user's currently
 * configured environment.
 *
 * @returns The python interpreter to use to launch the server
 */
async function getPythonInterpreter(
    resource?: vscode.Uri,
): Promise<string | undefined> {
    const config = vscode.workspace.getConfiguration("pygls.server", resource);
    const pythonPath = config.get<string>("pythonPath");
    if (pythonPath) {
        pyglsLogger.info(
            `Using user configured python environment: '${pythonPath}'`,
        );
        return pythonPath;
    }

    if (!python) {
        return;
    }

    if (resource) {
        pyglsLogger.info(
            `Looking for environment in which to execute: '${resource.toString()}'`,
        );
    }
    // Use whichever python interpreter the user has configured.
    const activeEnvPath =
        python.environments.getActiveEnvironmentPath(resource);
    pyglsLogger.info(
        `Found environment: ${activeEnvPath.id}: ${activeEnvPath.path}`,
    );

    const activeEnv =
        await python.environments.resolveEnvironment(activeEnvPath);
    if (!activeEnv) {
        pyglsLogger.error(`Unable to resolve envrionment: ${activeEnvPath}`);
        return;
    }

    const v = activeEnv.version;
    const pythonVersion = semver.parse(`${v?.major}.${v?.minor}.${v?.micro}`);

    if (!pythonVersion) {
        pyglsLogger.error(`Unable to parse python version: ${v}`);
        return;
    }

    if (MIN_PYTHON === null) {
        pyglsLogger.error(
            `Unable to parse minimum python version: ${MIN_PYTHON}`,
        );
        return;
    }

    // Check to see if the environment satisfies the min Python version.
    if (semver.lt(pythonVersion, MIN_PYTHON)) {
        const message = [
            `Your currently configured environment provides Python v${pythonVersion} `,
            `but pygls requires v${MIN_PYTHON}.\n\nPlease choose another environment.`,
        ].join("");

        const response = await vscode.window.showErrorMessage(
            message,
            "Change Environment",
        );
        if (!response) {
            return;
        } else {
            await vscode.commands.executeCommand("python.setInterpreter");
            return;
        }
    }

    const pythonUri = activeEnv.executable.uri;
    if (!pythonUri) {
        pyglsLogger.error(`URI of Python executable is undefined!`);
        return;
    }

    return pythonUri.fsPath;
}

async function getPythonExtension() {
    try {
        python = await PythonExtension.api();
    } catch (err) {
        pyglsLogger.error(`Unable to load python extension: ${err}`);
    }
}
