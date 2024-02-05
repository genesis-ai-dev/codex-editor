"use strict";

import * as vscode from "vscode";
import { CodexKernel } from "./controller";
import { CodexContentSerializer } from "./serializer";
import {
    NOTEBOOK_TYPE,
    createCodexNotebook,
    createProjectNotebooks,
} from "./utils/codexNotebookUtils";
import { CodexNotebookProvider } from "./tree-view/scriptureTreeViewProvider";
import {
    getAllBookRefs,
    getProjectMetadata,
    getWorkSpaceFolder,
    jumpToCellInNotebook,
} from "./utils/utils";
import { registerReferencesCodeLens } from "./referencesCodeLensProvider";
import { registerSourceCodeLens } from "./sourceCodeLensProvider";
import { LanguageMetadata, LanguageProjectStatus, Project } from "codex-types";
import { nonCanonicalBookRefs } from "./assets/vref";
import { LanguageCodes } from "./assets/languages";
import { ResourceProvider } from "./tree-view/resourceTreeViewProvider";
import {
    initializeProjectMetadata,
    promptForProjectDetails,
} from "./utils/projectUtils";
import { checkTaskStatus, indexVrefs } from "./commands/indexVrefsCommand";

/* -------------------------------------------------------------------------
 * NOTE: This file's invokation of a python server is a derivative work of 
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
import { LanguageClient, LanguageClientOptions, ServerOptions, State, integer } from "vscode-languageclient/node";

const MIN_PYTHON = semver.parse("3.7.9");
const ROOT_PATH = getWorkSpaceFolder();

if (!ROOT_PATH) {
    vscode.window.showErrorMessage("No workspace found");
}

let client: LanguageClient | undefined;
let clientStarting = false;
let python: PythonExtension;
let pyglsLogger: vscode.LogOutputChannel;

export async function activate(context: vscode.ExtensionContext) {

    /** BEGIN CODEX EDITOR EXTENSION FUNCTIONALITY */

    registerReferencesCodeLens(context);
    registerSourceCodeLens(context);

    // Add .bible files to the files.readonlyInclude glob pattern to make them readonly without overriding existing patterns
    const config = vscode.workspace.getConfiguration();
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
            indexVrefs,
        ),
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor-extension.checkTaskStatus",
            async () => {
                const taskNumber = await vscode.window.showInputBox({
                    prompt: "Enter the task number to check its status",
                    placeHolder: "Task number",
                    validateInput: (text) => {
                        return isNaN(parseInt(text, 10))
                            ? "Please enter a valid number"
                            : null;
                    },
                });
                if (taskNumber !== undefined) {
                    checkTaskStatus(parseInt(taskNumber, 10));
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
                    vscode.window.showErrorMessage(
                        `Failed to open chapter: ${error}`,
                    );
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
                    vscode.window.showErrorMessage(
                        `Failed to open document: ${error}`,
                    );
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
                vscode.window.showInformationMessage(
                    "Initializing new project...",
                );
                try {
                    const projectDetails = await promptForProjectDetails();
                    if (projectDetails) {
                        const workspaceFolder = vscode.workspace.workspaceFolders
                            ? vscode.workspace.workspaceFolders[0]
                            : undefined;
                        if (!workspaceFolder) {
                            vscode.window.showErrorMessage("No workspace found");
                            return;
                        }
                        const projectFilePath = await vscode.Uri.joinPath(workspaceFolder.uri, 'metadata.json');

                        if (await vscode.workspace.fs.stat(projectFilePath)) {
                            const fileData = await vscode.workspace.fs.readFile(projectFilePath);
                            const metadata = JSON.parse(fileData.toString());
                            const projectName = metadata.projectName;
                            const confirmDelete = await vscode.window.showInputBox({
                                prompt: `A project named ${projectName} already already exists. Type the project name to confirm deletion.`,
                                placeHolder: "Project name",
                            });
                            if (confirmDelete !== projectName) {
                                vscode.window.showErrorMessage("Project name does not match. Initialization cancelled.");
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
                        } else if (overwriteConfirmation === "No") {
                            vscode.window.showInformationMessage(
                                "Creating Codex Project without overwrite.",
                            );
                            await createProjectNotebooks({ books });
                        }
                    } else {
                        vscode.window.showErrorMessage(
                            "Project initialization cancelled.",
                        );
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to initialize new project: ${error}`,
                    );
                }
            },
        ),
    );

    // Register and create the Scripture Tree View
    const scriptureTreeViewProvider = new CodexNotebookProvider(ROOT_PATH);
    const resourceTreeViewProvider = new ResourceProvider(ROOT_PATH);
    vscode.window.registerTreeDataProvider(
        "resource-explorer",
        resourceTreeViewProvider,
    );
    // vscode.window.createTreeView('scripture-explorer', { treeDataProvider: scriptureTreeViewProvider });
    vscode.commands.registerCommand("resource-explorer.refreshEntry", () =>
        resourceTreeViewProvider.refresh(),
    );
    vscode.window.registerTreeDataProvider(
        "scripture-explorer-activity-bar",
        scriptureTreeViewProvider,
    );
    // vscode.window.createTreeView('scripture-explorer', { treeDataProvider: scriptureTreeViewProvider });
    vscode.commands.registerCommand(
        "scripture-explorer-activity-bar.refreshEntry",
        () => scriptureTreeViewProvider.refresh(),
    );

    /** END CODEX EDITOR EXTENSION FUNCTIONALITY */

    /** BEGIN PYTHON SERVER FUNCTIONALITY */

    pyglsLogger = vscode.window.createOutputChannel('pygls', { log: true });
    pyglsLogger.info("Extension activated.");
    pyglsLogger.info(`extension path ${context.extensionPath}`);


    await getPythonExtension();
    if (!python) {
        vscode.window.showErrorMessage("Python extension not found");
    }

    // Restart language server command
    context.subscriptions.push(
        vscode.commands.registerCommand("pygls.server.restart", async () => {
            pyglsLogger.info('restarting server...');
            await startLangServer(context);
        })
    );


    // Execute command... command
    context.subscriptions.push(
        vscode.commands.registerCommand("pygls.server.executeCommand", async () => {
            await executeServerCommand();
        })
    );


    // Restart the language server if the user switches Python envs...
    context.subscriptions.push(
        python.environments.onDidChangeActiveEnvironmentPath(async () => {
            pyglsLogger.info('python env modified, restarting server...');
            await startLangServer(context);
        })
    );


    // ... or if they change a relevant config option
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (event) => {
            if (event.affectsConfiguration("pygls.server") || event.affectsConfiguration("pygls.client")) {
                pyglsLogger.info('config modified, restarting server...');
                await startLangServer(context);
            }
        })
    );


    // Start the language server once the user opens the first text document...
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(
            async () => {
                if (!client) {
                    await startLangServer(context);
                }
            }
        )
    );


    // ...or notebook.
    context.subscriptions.push(
        vscode.workspace.onDidOpenNotebookDocument(
            async () => {
                if (!client) {
                    await startLangServer(context);
                }
            }
        )
    );


}

export function deactivate(): Thenable<void> {
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
    const server_path = '/servers/server.py';
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

    client = new LanguageClient('pygls', serverOptions, getClientOptions());
    const promises = [client.start()];


    if (config.get<boolean>("debug")) {
        promises.push(startDebugging());
    }


    const results = await Promise.allSettled(promises);
    clientStarting = false;


    for (const result of results) {
        if (result.status === "rejected") {
            pyglsLogger.error(`There was a error starting the server: ${result.reason}`);
        }
    }
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
        return Promise.reject("Unable to start debugging, there is no workspace.");
    }
    // TODO: Is there a more reliable way to ensure the debug adapter is ready?
    return new Promise((resolve, reject) => {
        setTimeout(async () => {
            const workspaceFolder = vscode?.workspace?.workspaceFolders && vscode?.workspace?.workspaceFolders[0];
            if (!workspaceFolder) {
                pyglsLogger.error("Unable to start debugging, there is no workspace.");
                reject("Unable to start debugging, there is no workspace.");
            } else {
                try {
                    await vscode.debug.startDebugging(workspaceFolder, "pygls: Debug Server");
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
                language: 'scripture',
                scheme: 'file',
                pattern: '**/*.codex'
            },
            {
                language: 'scripture',
                scheme: 'file',
                pattern: '**/*.bible'
            },
            {
                language: 'scripture',
                scheme: 'file',
                pattern: '**/*.scripture'
            },
            {
                schema: "file",
                language: "plaintext"
            },
        ],
        outputChannel: pyglsLogger,
        connectionOptions: {
            maxRestartCount: 1 // don't restart on server failure.
        },
    };
    pyglsLogger.info(`client options: ${JSON.stringify(options, undefined, 2)}`);
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
        getClientOptions()
    );
}


/**
 * Execute a command provided by the language server.
 */
async function executeServerCommand() {
    if (!client || client.state !== State.Running) {
        await vscode.window.showErrorMessage("There is no language server running.");
        return;
    }


    const knownCommands = client?.initializeResult?.capabilities.executeCommandProvider?.commands;
    if (!knownCommands || knownCommands.length === 0) {
        const info = client?.initializeResult?.serverInfo;
        const name = info?.name || "Server";
        const version = info?.version || "";


        await vscode.window.showInformationMessage(`${name} ${version} does not implement any commands.`);
        return;
    }


    const commandName = await vscode.window.showQuickPick(knownCommands, { canPickMany: false });
    if (!commandName) {
        return;
    }
    pyglsLogger.info(`executing command: '${commandName}'`);


    const result = await vscode.commands.executeCommand(commandName, vscode.window.activeTextEditor?.document.uri);
    pyglsLogger.info(`${commandName} result: ${JSON.stringify(result, undefined, 2)}`);
}


/**
 * Return the python command to use when starting the server.
 *
 * If debugging is enabled, this will also included the arguments to required
 * to wrap the server in a debug adapter.
 *
 * @returns The full python command needed in order to start the server.
 */
async function getPythonCommand(resource?: vscode.Uri): Promise<string[] | undefined> {
    const config = vscode.workspace.getConfiguration("pygls.server", resource);
    const pythonPath = await getPythonInterpreter(resource);
    if (!pythonPath) {
        return;
    }
    const command = [pythonPath];
    const enableDebugger = config.get<boolean>('debug');


    if (!enableDebugger) {
        return command;
    }


    const debugHost = config.get<string>('debugHost');
    const debugPort = config.get<integer>('debugPort');

    if (!debugHost || !debugPort) {
        pyglsLogger.error("Debugging is enabled but no debug host or port is set.");
        pyglsLogger.error("Debugger will not be available.");
        return command;
    }
    try {
        const debugArgs = await python.debug.getRemoteLauncherCommand(debugHost, debugPort, true);
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
async function getPythonInterpreter(resource?: vscode.Uri): Promise<string | undefined> {
    const config = vscode.workspace.getConfiguration("pygls.server", resource);
    const pythonPath = config.get<string>('pythonPath');
    if (pythonPath) {
        pyglsLogger.info(`Using user configured python environment: '${pythonPath}'`);
        return pythonPath;
    }


    if (!python) {
        return;
    }


    if (resource) {
        pyglsLogger.info(`Looking for environment in which to execute: '${resource.toString()}'`);
    }
    // Use whichever python interpreter the user has configured.
    const activeEnvPath = python.environments.getActiveEnvironmentPath(resource);
    pyglsLogger.info(`Found environment: ${activeEnvPath.id}: ${activeEnvPath.path}`);


    const activeEnv = await python.environments.resolveEnvironment(activeEnvPath);
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
        pyglsLogger.error(`Unable to parse minimum python version: ${MIN_PYTHON}`);
        return;
    }

    // Check to see if the environment satisfies the min Python version.
    if (semver.lt(pythonVersion, MIN_PYTHON)) {
        const message = [
            `Your currently configured environment provides Python v${pythonVersion} `,
            `but pygls requires v${MIN_PYTHON}.\n\nPlease choose another environment.`
        ].join('');


        const response = await vscode.window.showErrorMessage(message, "Change Environment");
        if (!response) {
            return;
        } else {
            await vscode.commands.executeCommand('python.setInterpreter');
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
