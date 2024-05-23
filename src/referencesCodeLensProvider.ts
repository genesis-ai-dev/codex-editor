import * as vscode from "vscode";
import { NOTEBOOK_TYPE } from "./utils/codexNotebookUtils";
import { extractVerseRefFromLine } from "./utils/verseRefUtils";
import { initializeStateStore } from "./stateStore";

const SHOW_DISCUSS_COMMAND = true;

class ScriptureReferenceCodeLensProvider {
    private _onDidChangeCodeLenses: vscode.EventEmitter<void>;
    public onDidChangeCodeLenses: vscode.Event<void>;
    constructor() {
        this._onDidChangeCodeLenses = new vscode.EventEmitter();
        this.onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
    }

    refresh() {
        this._onDidChangeCodeLenses.fire();
    }
    provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken,
    ): vscode.CodeLens[] {
        const lenses: vscode.CodeLens[] = [];
        const activeEditor = vscode.window.activeTextEditor;
        if (
            activeEditor &&
            activeEditor.document.uri.toString() === document.uri.toString()
        ) {
            const cursorPosition = activeEditor.selection.active;
            const line = document.lineAt(cursorPosition.line);
            const verseRef = extractVerseRefFromLine(line.text);
            let uri = vscode.window.activeTextEditor?.document.uri;
            const activeFileIsACodexFile = uri?.toString().includes(".codex");
            // Check if the URI scheme is not 'file', then adjust it to create a file URI
            if (uri && uri.scheme !== "file") {
                // Use the fsPath to create a new URI with the 'file' scheme
                uri = vscode.Uri.file(uri.fsPath);
            }
            if (verseRef) {
                const range = new vscode.Range(
                    cursorPosition.line,
                    0,
                    cursorPosition.line,
                    line.text.length,
                );
                lenses.push(
                    new vscode.CodeLens(range, {
                        title: "📚 Resources",
                        command: `codex-editor-extension.${showReferencesCommandName}`,
                        arguments: [verseRef, document.uri.toString()],
                    }),
                );
                // lenses.push(
                //     new vscode.CodeLens(range, {
                //         title: "🪄 Smart Edit",
                //         command: `workbench.view.extension.smart-edit-view`,
                //     }),
                // );
                if (
                    activeFileIsACodexFile &&
                    vscode.extensions.getExtension(
                        "project-accelerate.codex-scripture-viewer",
                    )?.isActive
                ) {
                    // Fixme: Scripture display is only for codex notebook files. The file content of the .bible would need to be converted to a codex notebook manually or a virtual file would need to be created
                    lenses.push(
                        new vscode.CodeLens(range, {
                            title: "📄 Preview",
                            command: `codex-editor-extension.viewScriptureDisplay`,
                            arguments: [verseRef, document.uri.toString()],
                        }),
                    );
                }
                if (SHOW_DISCUSS_COMMAND) {
                    lenses.push(
                        new vscode.CodeLens(range, {
                            title: "💬 Discuss",
                            command: `codex-editor-extension.discuss`,
                            arguments: [verseRef, document.uri.toString()],
                        }),
                    );
                }
            }
        }
        return lenses;
    }
}

export const showReferencesCommandName = "showReferences";
const registerReferences = (context: vscode.ExtensionContext) => {
    const provider = new ScriptureReferenceCodeLensProvider();

    
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider({ language: "*" }, provider),
    );

    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(() => provider.refresh()),
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(
            `codex-editor-extension.${showReferencesCommandName}`,
            async (verseRef: string, uri: string) => {
                initializeStateStore().then(({ updateStoreState }) => {
                    updateStoreState({
                        key: "verseRef",
                        value: { verseRef, uri },
                    });
                });
                await vscode.commands.executeCommand(
                    "translationNotes.openTnEditor",
                    verseRef,
                );
            },
        ),
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(
            `codex-editor-extension.discuss`,
            async (verseRef: string, uri: string) => {
                initializeStateStore().then(({ updateStoreState }) => {
                    updateStoreState({
                        key: "verseRef",
                        value: { verseRef, uri },
                    });
                });

                vscode.commands.executeCommand(
                    "workbench.view.extension.genesis-translator-sidebar-view",
                );
                // vscode.window.showInformationMessage(
                //     `Discussing ${verseRef}...`,
                // );
            },
        ),
    );
};

export { registerReferences as registerReferencesCodeLens };
