"use strict";

import * as vscode from "vscode";
import {
    checkServerHeartbeat,
} from "../../handlers/textSelectionHandler";
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    State,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;
let pyglsLogger: vscode.LogOutputChannel;
let clientStarting = false;
let python: any;

export async function initializeServer(context: vscode.ExtensionContext){
    python = await vscode.extensions.getExtension("project-accelerate.pythoninstaller");
    pyglsLogger = vscode.window.createOutputChannel("pygls", { log: true });
    pyglsLogger.info(`extension path ${context.extensionPath}`);
    if (!python){
        vscode.window.showInformationMessage("Python disabled. Please install the PythonInstaller extension.");
    }
    else {

        // gives the python extension the ability to tell the server to run after it has verified python is installed and venv is set up.
        const start_command: string = 'pygls.server.restart';

        await vscode.commands.executeCommand('pythoninstaller.addCallback', start_command);
        await vscode.commands.executeCommand('pythoninstaller.installPython');          
    }
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

    if (!python){
        startLangServer(context);
    }
}
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
    vscode.window.showInformationMessage("Python command: "+ pythonCommand);
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
        checkServerHeartbeat();
    }, 10000);
}

export async function stopLangServer(): Promise<void> {
    if (!client) {
        return;
    }

    if (client.state === State.Running) {
        await client.stop();
    }

    client.dispose();
    client = undefined;
}


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
async function getPythonCommand(
    resource?: vscode.Uri,
): Promise<string[] | undefined> {
    let pythonPath: string = "";
    const pythonExtension = vscode.extensions.getExtension("project-accelerate.pythoninstaller");
    if (pythonExtension) {
        pythonPath = pythonExtension.extensionPath + '/.env/bin/python';
    }
    else {
        pythonPath = "python311"; 
        vscode.window.showWarningMessage("PythonInstaller extension not found. Falling back to 'python3.11'.");
    }
    const config = vscode.workspace.getConfiguration("pygls.server", resource);

    if (!pythonPath) {
        pyglsLogger.error("No valid Python interpreter found.");
        return;
    }
    const command = [pythonPath];
    
    vscode.window.showInformationMessage(`Using Python interpreter: ${pythonPath}`);
    const enableDebugger = config.get<boolean>("debug");

    if (!enableDebugger) {
        return command;
    }

    const debugHost = config.get<string>("debugHost");
    const debugPort = config.get<number>("debugPort");

    if (!debugHost || !debugPort) {
        pyglsLogger.error(
            "Debugging is enabled but no debug host or port is set.",
        );
        pyglsLogger.error("Debugger will not be available.");
        return command;
    }

    return command;
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
