"use strict";
import * as vscode from "vscode";
import { registerTextSelectionHandler } from "./handlers/textSelectionHandler";
import { registerReferencesCodeLens } from "./referencesCodeLensProvider";
import { registerSourceCodeLens } from "./sourceCodeLensProvider";
import { indexVerseRefsInSourceText } from "./commands/indexVrefsCommand";

import { ResourcesProvider } from "./providers/obs/resources/resourcesProvider";
import { StoryOutlineProvider } from "./providers/obs/storyOutline/storyOutlineProvider";
import { ObsEditorProvider } from "./providers/obs/editor/ObsEditorProvider";
import { registerCommands } from "./activationHelpers/contextAware/commands";
import { promptForLocalSync } from "./providers/scm/git";
import { TranslationNotesProvider } from "./providers/translationNotes/TranslationNotesProvider";
import { registerScmStatusBar } from "./providers/scm/statusBar";
import { DownloadedResourcesProvider } from "./providers/downloadedResource/provider";
import {
    handleConfig,
    onBoard,
    initializeProject,
} from "./activationHelpers/contextUnaware/projectInitializers";
import { createIndexWithContext } from "./activationHelpers/contextAware/miniIndex/indexes/index";
import { initializeWebviews } from "./activationHelpers/contextAware/webviewInitializers";
import { syncUtils } from "./activationHelpers/contextAware/syncUtils";
import { initializeStateStore } from "./stateStore";
import { projectFileExists } from "./utils/fileUtils";
import { registerCompletionsCodeLensProviders } from "./activationHelpers/contextAware/completionsCodeLensProviders";
import { CodexChunkEditorProvider } from "./providers/codexChunkEditorProvider/codexChunkEditorProvider";
import * as path from "path";
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
} from "vscode-languageclient/node";

import { initializeBibleData } from "./activationHelpers/contextAware/sourceData";

let scmInterval: any; // Webpack & typescript for vscode are having issues

// initial autoCommit config
const configuration = vscode.workspace.getConfiguration(
    "codex-editor-extension.scm",
);
let autoCommitEnabled = configuration.get<boolean>("autoCommit", true);

let client: LanguageClient;

export async function activate(context: vscode.ExtensionContext) {
    await indexVerseRefsInSourceText();
    await handleConfig();
    registerReferencesCodeLens(context);
    registerSourceCodeLens(context);
    registerCompletionsCodeLensProviders(context);
    registerTextSelectionHandler(context, () => undefined);

    const [, syncStatus] = registerScmStatusBar(context);
    syncUtils.registerSyncCommands(context, syncStatus);

    DownloadedResourcesProvider.register(context);
    const { providerRegistration, commandRegistration } =
        TranslationNotesProvider.register(context);

    context.subscriptions.push(ResourcesProvider.register(context));
    context.subscriptions.push(StoryOutlineProvider.register(context));
    context.subscriptions.push(ObsEditorProvider.register(context));
    context.subscriptions.push(providerRegistration);
    context.subscriptions.push(commandRegistration);
    console.log("CodexChunkEditorProvider registered");
    context.subscriptions.push(CodexChunkEditorProvider.register(context));

    // Set up the language client
    const serverModule = context.asAbsolutePath(path.join("out", "server.js"));
    const debugOptions = { execArgv: ["--nolazy", "--inspect=6009"] };

    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: debugOptions,
        },
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [
            { scheme: "file", language: "*" },
            { scheme: "vscode-notebook-cell", language: "*" },
            { notebook: "*", language: "*" },
        ],
        synchronize: {
            fileEvents:
                vscode.workspace.createFileSystemWatcher("**/.clientrc"),
        },
    };

    client = new LanguageClient(
        "scriptureLanguageServer",
        "Scripture Language Server",
        serverOptions,
        clientOptions,
    );
    // Start the client. This will also launch the server
    client
        .start()
        .then(() => {
            context.subscriptions.push(client);
            // Register the server.getSimilarWords command
            context.subscriptions.push(
                vscode.commands.registerCommand(
                    "server.getSimilarWords",
                    async (word: string) => {
                        if (client) {
                            return client.sendRequest(
                                "server.getSimilarWords",
                                [word],
                            );
                        }
                    },
                ),
            );
        })
        .catch((error) => {
            console.error("Failed to start the client:", error);
        });

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "spellcheck.checkText",
            async (text: string) => {
                if (client) {
                    return client.sendRequest("spellcheck/check", { text });
                }
            },
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "spellcheck.addWord",
            async (word: string) => {
                console.log("spellcheck.addWord", { word });
                if (client) {
                    console.log("sending request inside addWord");
                    return client.sendRequest("spellcheck/addWord", { word });
                }
            },
        ),
    );

    await executeCommandsAfter();
    await startSyncLoop(context);
    await registerCommands(context);
    await createIndexWithContext(context);
    await initializeBibleData(context);
    await initializeWebviews(context);
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}

async function executeCommandsAfter() {
    // wasn't sure if these had to be executed seperately but it's here to be on the safeside, otherwise later it should go in commands.ts

    vscode.commands.executeCommand("workbench.action.focusAuxiliaryBar");
    vscode.commands.executeCommand(
        "codex-editor-extension.setEditorFontToTargetLanguage",
    );
}

async function startSyncLoop(context: vscode.ExtensionContext) {
    console.log("sync loop timer refreshed");
    const syncIntervalTime = 1000 * 60 * 15; // 15 minutes

    function startInterval() {
        scmInterval = setInterval(promptForLocalSync, syncIntervalTime);
    }

    function stopInterval() {
        if (scmInterval) {
            clearInterval(scmInterval);
            scmInterval = null;
        }
    }

    if (autoCommitEnabled) {
        startInterval();
    }

    const configChangeSubscription = vscode.workspace.onDidChangeConfiguration(
        (e) => {
            if (
                e.affectsConfiguration("codex-editor-extension.scm.remoteUrl")
            ) {
                syncUtils.checkConfigRemoteAndUpdateIt();
            }
            if (
                e.affectsConfiguration("codex-editor-extension.scm.autoCommit")
            ) {
                const updatedConfiguration = vscode.workspace.getConfiguration(
                    "codex-editor-extension.scm",
                );
                autoCommitEnabled = updatedConfiguration.get<boolean>(
                    "autoCommit",
                    true,
                );
                vscode.window.showInformationMessage(
                    `Auto-commit is now ${
                        autoCommitEnabled ? "enabled" : "disabled"
                    }.`,
                );

                if (autoCommitEnabled) {
                    startInterval();
                } else {
                    stopInterval();
                }
            }
        },
    );

    context.subscriptions.push(configChangeSubscription);
    setTimeout(() => {
        syncUtils.checkConfigRemoteAndUpdateIt();
    }, 3000);
}
