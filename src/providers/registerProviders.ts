import * as vscode from "vscode";
import { CodexCellEditorProvider } from "./codexCellEditorProvider/codexCellEditorProvider";
import { createEditAnalysisProvider } from "./EditAnalysisView/EditAnalysisViewProvider";
import { NavigationWebviewProvider } from "./navigationWebview/navigationWebviewProvider";
import { MainMenuProvider } from "./mainMenu/mainMenuProvider";
import { CustomWebviewProvider as CommentsProvider } from "./commentsWebview/customCommentsWebviewProvider";
import { CustomWebviewProvider as ParallelProvider } from "./parallelPassagesWebview/customParallelPassagesWebviewProvider";
import { WordsViewProvider } from "./WordsView/WordsViewProvider";
import { GlobalProvider } from "../globalProvider";
import { AutomatedTestingProvider } from "./AutomatedTestingProvider";

export function registerProviders(context: vscode.ExtensionContext) {
    const disposables: vscode.Disposable[] = [];

    // Register CodexCellEditorProvider
    disposables.push(CodexCellEditorProvider.register(context));

    // Register webview providers directly - much simpler!
    const navigationProvider = new NavigationWebviewProvider(context);
    const automatedTestingProvider = new AutomatedTestingProvider(context);
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

        vscode.window.registerWebviewViewProvider("search-passages-sidebar", parallelProvider),
        GlobalProvider.getInstance().registerProvider("search-passages-sidebar", parallelProvider as any),

        vscode.window.registerWebviewViewProvider("codex-editor.automatedTesting", automatedTestingProvider),
        GlobalProvider.getInstance().registerProvider("codex-editor.automatedTesting", automatedTestingProvider as any),

        // Register search passages command
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



    // Add all disposables to the context subscriptions
    context.subscriptions.push(...disposables);
}
