"use strict";
import * as vscode from "vscode";
import {
    registerTextSelectionHandler,
} from "./handlers/textSelectionHandler";
import { registerReferencesCodeLens } from "./referencesCodeLensProvider";
import { registerSourceCodeLens } from "./sourceCodeLensProvider";
import {
    indexVerseRefsInSourceText,
} from "./commands/indexVrefsCommand";
import {
    triggerInlineCompletion,
    provideInlineCompletionItems,
} from "./providers/translationSuggestions/inlineCompletionsProvider";
import { CreateProjectProvider } from "./providers/obs/CreateProject/CreateProjectProvider";
import { ResourcesProvider } from "./providers/obs/resources/resourcesProvider";
import { StoryOutlineProvider } from "./providers/obs/storyOutline/storyOutlineProvider";
import { ObsEditorProvider } from "./providers/obs/editor/ObsEditorProvider";
import { registerCommands } from "./commandRegistration";
import {
    addRemote,
    checkConfigRemoteAndUpdateIt,
    promptForLocalSync,
    stageAndCommit,
    sync,
} from "./providers/scm/git";
import { TranslationNotesProvider } from "./providers/translationNotes/TranslationNotesProvider";
import { registerScmStatusBar } from "./providers/scm/statusBar";
import { DownloadedResourcesProvider } from "./providers/downloadedResource/provider";
import { checkForMissingFiles, handleConfig, onBoard} from "./projectInitializers";
import {initializeServer, stopLangServer} from "./pythonController";
import {initializeWebviews} from "./webviewInitializers";
// The following block ensures a smooth user experience by guiding the user through the initial setup process before the extension is fully activated. This is crucial for setting up the necessary project environment and avoiding any functionality issues that might arise from missing project configurations.

// NOTE: the following two blocks are deactivated for now while we work on the project management extension. We might not need them.
// First, check if a project root path is set, indicating whether the user has an existing project open.
// I moved all that to this onboard function
onBoard();

let scmInterval: any; // Webpack & typescript for vscode are having issues

export async function activate(context: vscode.ExtensionContext) {
    indexVerseRefsInSourceText();
    const [, syncStatus] = registerScmStatusBar(context);
    handleConfig();
    DownloadedResourcesProvider.register(context);
    checkForMissingFiles();
    initializeServer(context);
    
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
            "codex-editor.scm.synced c cNotification",
            async () => {
                vscode.window.showInformationMessage("Project is synced");
            },
        ),
    );
    initializeWebviews(context);
    registerReferencesCodeLens(context);
    registerSourceCodeLens(context);

    
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


    vscode.window.showInformationMessage("Setting font to target language...");
    vscode.commands.executeCommand(
        "codex-editor.setEditorFontToTargetLanguage",
    );
    vscode.window.showInformationMessage(
        "Ensuring Source Bible is downloaded...",
    );
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const bibleFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceRoot, "**/*.bible"),
            "**/node_modules/**", // exclude node_modules
            1, // limit search results to 1
        );
        if (bibleFiles.length === 0) {
            vscode.commands.executeCommand(
                "codex-editor-extension.downloadSourceTextBibles",
            );
        } else {
            vscode.window.showInformationMessage(
                "Bible files already exist in the workspace.",
            );
        }
    }

    scmInterval = setInterval(promptForLocalSync, 1000 * 60 * 15);

    // check if the config's remote url has changed
    const configChangeSubscription = vscode.workspace.onDidChangeConfiguration(
        (e) => {
            if (e.affectsConfiguration("codex-editor.scm.remoteUrl")) {
                checkConfigRemoteAndUpdateIt();
            }
        },
    );

    context.subscriptions.push(configChangeSubscription);

    registerCommands(context);
    // Haven't found a way to wait for successful activation of all the things before doing this
    setTimeout(() => {
        checkConfigRemoteAndUpdateIt();
    }, 3000);
}

export function deactivate(): Thenable<void> {
    scmInterval && clearInterval(scmInterval);
    return stopLangServer();
}
