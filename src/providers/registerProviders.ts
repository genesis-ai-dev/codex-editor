import * as vscode from "vscode";
import { CodexCellEditorProvider } from "./codexCellEditorProvider/codexCellEditorProvider";
import { NextGenCodexTreeViewProvider } from "./treeViews/nextGenCodexTreeViewProvider";
import { openCodexFile } from "./treeViews/nextGenCodexTreeViewProvider";
import { createEditAnalysisProvider } from "./EditAnalysisView/EditAnalysisViewProvider";
import { registerMainMenuProvider } from "./mainMenu/mainMenuProvider";
import { registerCommentsWebviewProvider } from "./commentsWebview/customCommentsWebviewProvider";
import { registerParallelViewWebviewProvider } from "./parallelPassagesWebview/customParallelPassagesWebviewProvider";
import { registerChatProvider } from "./chat/customChatWebviewProvider";
import { registerNavigationWebviewProvider } from "./navigationWebview/navigationWebviewProvider";
import { WordsViewProvider } from "./WordsView/WordsViewProvider";

export function registerProviders(context: vscode.ExtensionContext) {
    const disposables: vscode.Disposable[] = [];

    // Register CodexCellEditorProvider
    disposables.push(CodexCellEditorProvider.register(context));

    // Register all webview providers using simplified registration
    // Navigation provider is registered first so it appears first in the activity bar
    disposables.push(
        registerNavigationWebviewProvider(context),
        registerMainMenuProvider(context),
        registerCommentsWebviewProvider(context),
        registerParallelViewWebviewProvider(context),
        registerChatProvider(context)
    );

    // Register Words View Provider
    const wordsViewProvider = new WordsViewProvider(context.extensionUri);

    const showWordsViewCommand = vscode.commands.registerCommand("frontier.showWordsView", () => {
        wordsViewProvider?.show();
    });

    context.subscriptions.push(showWordsViewCommand);

    // Register SourceControlProvider
    // const sourceControlProvider = registerSourceControl(context);
    // disposables.push(sourceControlProvider);

    // Register NextGenCodexTreeViewProvider
    // const nextGenCodexTreeViewProvider = new NextGenCodexTreeViewProvider(context);
    // const treeView = vscode.window.createTreeView("codexNotebookTreeView", {
    //     treeDataProvider: nextGenCodexTreeViewProvider,
    //     showCollapseAll: true,
    // });

    // disposables.push(
    //     treeView,
    //     nextGenCodexTreeViewProvider,
    //     vscode.commands.registerCommand(
    //         "nextGenCodexTreeView.openFile",
    //         async (uri: vscode.Uri) => {
    //             try {
    //                 await openCodexFile(uri);
    //             } catch (error) {
    //                 console.error("Failed to open codex file:", error);
    //                 vscode.window.showErrorMessage(`Failed to open codex file: ${error}`);
    //             }
    //         }
    //     ),
    //     vscode.commands.registerCommand("codexNotebookTreeView.refresh", () =>
    //         nextGenCodexTreeViewProvider.refresh()
    //     ),
    //     createEditAnalysisProvider(context.extensionUri)
    // );

    // Add all disposables to the context subscriptions
    context.subscriptions.push(...disposables);
}
