import * as vscode from "vscode";
import { CodexCellEditorProvider } from "./codexCellEditorProvider/codexCellEditorProvider";
import { createEditAnalysisProvider } from "./EditAnalysisView/EditAnalysisViewProvider";
import { NavigationWebviewProvider } from "./navigationWebview/navigationWebviewProvider";
import { MainMenuProvider } from "./mainMenu/mainMenuProvider";
import { CustomWebviewProvider as CommentsProvider } from "./commentsWebview/customCommentsWebviewProvider";
import { CustomWebviewProvider as ParallelProvider } from "./parallelPassagesWebview/customParallelPassagesWebviewProvider";
import { WordsViewProvider } from "./WordsView/WordsViewProvider";
import { GlobalProvider } from "../globalProvider";
import { NewSourceUploaderProvider } from "./NewSourceUploader/NewSourceUploaderProvider";
import { getWorkSpaceFolder } from "../utils";

export function registerProviders(context: vscode.ExtensionContext) {
    const disposables: vscode.Disposable[] = [];

    // Register Source Uploader Provider
    disposables.push(
        vscode.workspace.registerTextDocumentContentProvider("newSourceUploaderProvider-scheme", {
            provideTextDocumentContent: () => {
                return "New Source Uploader";
            },
        })
    );

    const newSourceUploadProvider = new NewSourceUploaderProvider(context);
    disposables.push(
        vscode.window.registerCustomEditorProvider(
            NewSourceUploaderProvider.viewType,
            newSourceUploadProvider,
            {
                supportsMultipleEditorsPerDocument: false,
                webviewOptions: {
                    retainContextWhenHidden: true,
                },
            }
        )
    );

    disposables.push(
        vscode.commands.registerCommand("codex-project-manager.openSourceUpload", () => {
            const workspaceFolder = getWorkSpaceFolder();
            if (workspaceFolder) {
                const uri = vscode.Uri.parse(`newSourceUploaderProvider-scheme:New Source Upload`);
                vscode.commands.executeCommand(
                    "vscode.openWith",
                    uri,
                    NewSourceUploaderProvider.viewType
                );
            }
        })
    );

    // Register CodexCellEditorProvider
    disposables.push(CodexCellEditorProvider.register(context));

    // Register webview providers directly - much simpler!
    const navigationProvider = new NavigationWebviewProvider(context);
    const mainMenuProvider = new MainMenuProvider(context);
    const commentsProvider = new CommentsProvider(context);
    const parallelProvider = new ParallelProvider(context);

    disposables.push(
        vscode.window.registerWebviewViewProvider("codex-editor.navigation", navigationProvider, { webviewOptions: { retainContextWhenHidden: true } }),
        GlobalProvider.getInstance().registerProvider("codex-editor.navigation", navigationProvider as any),

        vscode.window.registerWebviewViewProvider("codex-editor.mainMenu", mainMenuProvider, { webviewOptions: { retainContextWhenHidden: true } }),
        GlobalProvider.getInstance().registerProvider("codex-editor.mainMenu", mainMenuProvider as any),

        vscode.window.registerWebviewViewProvider("comments-sidebar", commentsProvider, { webviewOptions: { retainContextWhenHidden: true } }),
        GlobalProvider.getInstance().registerProvider("comments-sidebar", commentsProvider as any),

        vscode.window.registerWebviewViewProvider("search-passages-sidebar", parallelProvider, { webviewOptions: { retainContextWhenHidden: true } }),
        GlobalProvider.getInstance().registerProvider("search-passages-sidebar", parallelProvider as any),

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
