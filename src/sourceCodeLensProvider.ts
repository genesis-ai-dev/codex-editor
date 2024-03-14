import * as vscode from "vscode";
import { NOTEBOOK_TYPE } from "./utils/codexNotebookUtils";
import {
    extractVerseRefFromLine,
    findReferences,
    findVerseRef,
} from "./utils/verseRefUtils";
import { searchVerseRefPositionIndex } from "./commands/indexVrefsCommand";
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
                        title: "📖 Source",
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
                if (verseRef) {
                    const results = await searchVerseRefPositionIndex(verseRef);
                    if (!results || results.length < 1) {
                        return;
                    }
                    const selectedResult = results[0]; // FIXME: if there are multiple bibles, use the bible that matches the source in metadata file

                    vscode.commands.executeCommand(
                        "vscode.open",
                        vscode.Uri.file(selectedResult.uri),
                        {
                            selection: new vscode.Range(
                                new vscode.Position(
                                    selectedResult.position.line,
                                    selectedResult.position.character,
                                ),
                                new vscode.Position(
                                    selectedResult.position.line,
                                    selectedResult.position.character,
                                ),
                            ),
                            preview: true,
                            viewColumn: vscode.ViewColumn.Beside,
                        },
                    );
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
