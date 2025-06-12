import * as vscode from "vscode";
import { CodexCellEditorProvider } from "./codexCellEditorProvider/codexCellEditorProvider";
import { NextGenCodexTreeViewProvider } from "./treeViews/nextGenCodexTreeViewProvider";
import { openCodexFile } from "./treeViews/nextGenCodexTreeViewProvider";
import { createEditAnalysisProvider } from "./EditAnalysisView/EditAnalysisViewProvider";
import { NavigationWebviewProvider } from "./navigationWebview/navigationWebviewProvider";
import { MainMenuProvider } from "./mainMenu/mainMenuProvider";
import { CustomWebviewProvider as CommentsProvider } from "./commentsWebview/customCommentsWebviewProvider";
import { CustomWebviewProvider as ParallelProvider } from "./parallelPassagesWebview/customParallelPassagesWebviewProvider";
import { WordsViewProvider } from "./WordsView/WordsViewProvider";
import { GlobalProvider } from "../globalProvider";

export function registerProviders(context: vscode.ExtensionContext) {
    const disposables: vscode.Disposable[] = [];

    // Register CodexCellEditorProvider
    disposables.push(CodexCellEditorProvider.register(context));

    // Register webview providers directly - much simpler!
    const navigationProvider = new NavigationWebviewProvider(context);
    const mainMenuProvider = new MainMenuProvider(context);
    const commentsProvider = new CommentsProvider(context);
    const parallelProvider = new ParallelProvider(context);

    disposables.push(
        vscode.window.registerWebviewViewProvider("codex-editor.navigation", navigationProvider),
        GlobalProvider.getInstance().registerProvider("codex-editor.navigation", navigationProvider as any),
        
        vscode.window.registerWebviewViewProvider("codex-editor.mainMenu", mainMenuProvider),
        GlobalProvider.getInstance().registerProvider("codex-editor.mainMenu", mainMenuProvider as any),
        
        vscode.window.registerWebviewViewProvider("comments-sidebar", commentsProvider),
        GlobalProvider.getInstance().registerProvider("comments-sidebar", commentsProvider as any),
        
        vscode.window.registerWebviewViewProvider("parallel-passages-sidebar", parallelProvider),
        GlobalProvider.getInstance().registerProvider("parallel-passages-sidebar", parallelProvider as any),
        
        // Register parallel passages command
        vscode.commands.registerCommand("parallelPassages.pinCellById", async (cellId: string) => {
            await parallelProvider.pinCellById(cellId);
        })
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
