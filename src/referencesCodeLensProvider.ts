import * as vscode from "vscode";
import { NOTEBOOK_TYPE } from "./utils/codexNotebookUtils";
import {
    extractVerseRefFromLine,
    findReferencesUsingMeilisearch,
} from "./utils/verseRefUtils";
import { initializeStateStore } from "./stateStore";

const SHOW_DISCUSS_COMMAND = true;

class ScriptureReferenceProvider {
    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
    ): Promise<vscode.Definition | null> {
        const line = document.lineAt(position);
        const verseRef = extractVerseRefFromLine(line.text);
        if (!verseRef) {
            return null;
        }

        const references = await findReferencesUsingMeilisearch(verseRef);
        if (!references) {
            return null;
        }

        return references.map(
            (filePath) =>
                new vscode.Location(
                    vscode.Uri.file(filePath.uri),
                    new vscode.Position(0, 0),
                ),
        );
    }
}

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
            if (verseRef) {
                const range = new vscode.Range(
                    cursorPosition.line,
                    0,
                    cursorPosition.line,
                    line.text.length,
                );
                lenses.push(
                    new vscode.CodeLens(range, {
                        title: "📚 Show Reference",
                        command: `codex-editor-extension.${showReferencesCommandName}`,
                        arguments: [verseRef, document.uri.toString()],
                    }),
                );
                lenses.push(
                    new vscode.CodeLens(range, {
                        title: "📜 View Bible",
                        command: `codex-editor-extension.viewScriptureDisplay`,
                        arguments: [verseRef, document.uri.toString()],
                    }),
                );
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
                // const filesWithReferences =
                //     await findReferencesUsingMeilisearch(verseRef);
                // if (
                //     Array.isArray(filesWithReferences) &&
                //     filesWithReferences.length > 0
                // ) {
                //     const uri = vscode.Uri.file(filesWithReferences[0].uri);
                //     const document =
                //         await vscode.workspace.openTextDocument(uri);
                //     const text = document.getText();
                //     const lines = text.split(/\r?\n/);
                //     const position = filesWithReferences[0].position;
                //     // for (let i = 0; i < lines.length; i++) {
                //     //     const { verseRefWasFound, verseRefInContentFormat } =
                //     //         findVerseRef({
                //     //             verseRef,
                //     //             content: lines[i],
                //     //         });
                //     //     if (verseRefWasFound) {
                //     //         position = new vscode.Position(
                //     //             i,
                //     //             lines[i].indexOf(verseRefInContentFormat),
                //     //         );
                //     //         break;
                //     //     }
                //     // }
                //     vscode.commands
                //         .executeCommand("vscode.open", uri, {
                //             selection: new vscode.Range(position, position),
                //             preview: true,
                //             viewColumn: vscode.ViewColumn.Active,
                //         })
                //         .then(() => {
                //             vscode.commands.executeCommand(
                //                 "workbench.action.splitEditorDown",
                //             );
                //         });
                // } else {
                //     vscode.window.showInformationMessage(
                //         `No references found for ${verseRef}`,
                //     );
                // }
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
                vscode.window.showInformationMessage(
                    `Discussing ${verseRef}...`,
                );
            },
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            `codex-editor-extension.viewScriptureDisplay`,
            async () => {
                await vscode.commands.executeCommand(
                    "scriptureViewer.showScriptureViewer",
                );
            },
        ),
    );

    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            // { scheme: "file" }, // all files option
            ["scripture"],
            new ScriptureReferenceProvider(),
        ),
    );
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            { notebookType: NOTEBOOK_TYPE }, // This targets notebook cells within "codex-type" notebooks
            new ScriptureReferenceProvider(),
        ),
    );
};

export { registerReferences as registerReferencesCodeLens };
