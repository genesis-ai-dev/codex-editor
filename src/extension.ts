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
    // onBoard,
} from "./activationHelpers/contextUnaware/projectInitializers";
import {
    stopLangServer,
} from "./activationHelpers/contextAware/pythonController";
import { initializeWebviews } from "./activationHelpers/contextAware/webviewInitializers";
import { syncUtils } from "./activationHelpers/contextAware/syncUtils";
import { createTypescriptLanguageServer } from "./activationHelpers/contextAware/tsLanguageServer";

// The following block ensures a smooth user experience by guiding the user through the initial setup process before the extension is fully activated. This is crucial for setting up the necessary project environment and avoiding any functionality issues that might arise from missing project configurations.

// NOTE: the following two blocks are deactivated for now while we work on the project management extension. We might not need them.
// First, check if a project root path is set, indicating whether the user has an existing project open.
// I moved all that to this onboard function
// onBoard(); // NOTE: deactivated while we add the project management extension

let scmInterval: any; // Webpack & typescript for vscode are having issues

// initial autoCommit config
const configuration = vscode.workspace.getConfiguration("codex-editor.scm");
let autoCommitEnabled = configuration.get<boolean>("autoCommit", true);

export async function activate(context: vscode.ExtensionContext) {
    await indexVerseRefsInSourceText();
    await handleConfig();
    const languageServer = await createTypescriptLanguageServer(context);
    await initializeWebviews(context);
    registerReferencesCodeLens(context);
    registerSourceCodeLens(context);
    registerTextSelectionHandler(context, languageServer?.handleTextSelection || (() => []));

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

    await executeCommandsAfter();
    await startSyncLoop(context);
    await registerCommands(context);
}

export function deactivate(): Thenable<void> {
    scmInterval && clearInterval(scmInterval);
    return stopLangServer();
}

async function executeCommandsAfter() {
    // wasn't sure if these had to be executed seperately but it's here to be on the safeside, otherwise later it should go in commands.ts

    vscode.commands.executeCommand("workbench.action.focusAuxiliaryBar");
    vscode.commands.executeCommand(
        "codex-editor.setEditorFontToTargetLanguage",
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
            if (e.affectsConfiguration("codex-editor.scm.remoteUrl")) {
                syncUtils.checkConfigRemoteAndUpdateIt();
            }
            if (e.affectsConfiguration("codex-editor.scm.autoCommit")) {
                const updatedConfiguration = vscode.workspace.getConfiguration("codex-editor.scm");
                autoCommitEnabled = updatedConfiguration.get<boolean>("autoCommit", true);
                vscode.window.showInformationMessage(`Auto-commit is now ${autoCommitEnabled ? 'enabled' : 'disabled'}.`);

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