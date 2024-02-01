import * as vscode from "vscode";
import { NOTEBOOK_TYPE } from "./codexNotebookUtils";
import {
    extractVerseRefFromLine,
    findReferences,
    findVerseRef,
} from "./utils/verseRefUtils";
const commandName = "showSource";
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

        const references = await findReferences({ verseRef });
        if (!references) {
            return null;
        }

        return references.map(
            (filePath) =>
                new vscode.Location(
                    vscode.Uri.file(filePath),
                    new vscode.Position(0, 0),
                ),
        );
    }
}

class SourceCodeLensProvider {
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
            activeEditor.document.uri.toString() === document.uri.toString() &&
            !activeEditor.document.fileName.endsWith(".bible")
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
                        title: "📖 Show Source",
                        command: `codex-editor-extension.${commandName}`,
                        arguments: [verseRef],
                    }),
                );
            }
        }
        return lenses;
    }
}

const registerReferences = (context: vscode.ExtensionContext) => {
    const scriptureReferenceProvider = new SourceCodeLensProvider();
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            { language: "scripture" },
            scriptureReferenceProvider,
        ),
    );

    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(() =>
            scriptureReferenceProvider.refresh(),
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

    context.subscriptions.push(
        vscode.commands.registerCommand(
            `codex-editor-extension.${commandName}`,
            async (verseRef: string) => {
                const filesWithReferences = await findReferences({
                    verseRef,
                    fileType: ".bible",
                });
                console.log({ filesWithReferences });
                if (
                    Array.isArray(filesWithReferences) &&
                    filesWithReferences.length > 0
                ) {
                    const uri = vscode.Uri.file(filesWithReferences[0]);
                    const document =
                        await vscode.workspace.openTextDocument(uri);
                    const text = document.getText();
                    const lines = text.split(/\r?\n/);
                    let position = new vscode.Position(0, 0); // Default to the start of the file

                    for (let i = 0; i < lines.length; i++) {
                        const { verseRefWasFound, verseRefInContentFormat } =
                            findVerseRef({
                                verseRef,
                                content: lines[i],
                            });
                        if (verseRefWasFound) {
                            position = new vscode.Position(
                                i,
                                lines[i].indexOf(verseRefInContentFormat),
                            );
                            break;
                        }
                    }
                    vscode.commands.executeCommand("vscode.open", uri, {
                        selection: new vscode.Range(position, position),
                        preview: true,
                        viewColumn: vscode.ViewColumn.Beside,
                    });
                } else {
                    vscode.window.showInformationMessage(
                        `No references found for ${verseRef}`,
                    );
                }
            },
        ),
    );
};

export { registerReferences as registerSourceCodeLens };
