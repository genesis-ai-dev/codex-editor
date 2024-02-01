import * as vscode from "vscode";
import { NOTEBOOK_TYPE } from "./codexNotebookUtils";

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

        const references = await findReferences(verseRef);
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
                        title: "Show References",
                        command: "codex-editor-extension.showReferences",
                        arguments: [verseRef],
                    }),
                );
            }
        }
        return lenses;
    }
}

function extractVerseRefFromLine(line: string): string | null {
    // Implement logic to extract the verse reference (e.g., 'MAT 1:1') from a line
    // Return the verse reference as a string, or null if not found
    const verseRefRegex = /(\b[A-Z]{3}\s\d+:\d+\b)/;
    const match = line.match(verseRefRegex);
    return match ? match[0] : null;
}

const findVerseRef = ({
    verseRef,
    content,
}: {
    verseRef: string;
    content: string;
}) => {
    // TODO: expand to use know abbreviations
    // TODO: add a versification bridge so that ORG refs can be used to look up other versifications to get the correct content
    const tsvVerseRef = verseRef.replace(/(\w+)\s(\d+):(\d+)/, "$1\t$2\t$3");
    const verseRefWasOrgFormat = content.includes(verseRef);
    const verseRefWasFound =
        verseRefWasOrgFormat || content.includes(tsvVerseRef);
    return {
        verseRefWasFound,
        verseRefInContentFormat: verseRefWasOrgFormat ? verseRef : tsvVerseRef,
    };
};

export async function findReferences(verseRef: string) {
    const filesWithReferences: string[] = [];
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (!workspaceFolders) {
        return filesWithReferences;
    }

    for (const folder of workspaceFolders) {
        const files = await vscode.workspace.findFiles(
            new vscode.RelativePattern(folder, "resources/**"),
        );

        console.log({ files });

        for (const file of files) {
            const fileUri = vscode.Uri.file(file.fsPath);
            const document = await vscode.workspace.openTextDocument(fileUri);
            const content = document.getText();
            const { verseRefWasFound } = findVerseRef({ verseRef, content });
            if (verseRefWasFound) {
                filesWithReferences.push(file.fsPath);
            }
        }
    }

    return filesWithReferences;
}

const registerReferences = (context: vscode.ExtensionContext) => {
    const provider = new ScriptureReferenceCodeLensProvider();
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            { language: "scripture" },
            provider,
        ),
    );

    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(() => provider.refresh()),
    );

    // context.subscriptions.push(
    //     vscode.languages.registerCodeLensProvider(
    //         { notebookType: NOTEBOOK_TYPE },
    //         // { scheme: "file" },
    //         new ScriptureReferenceCodeLensProvider(),
    //     ),
    // );
    // Register the command 'extension.showReferences'
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor-extension.showReferences",
            async (verseRef: string) => {
                const filesWithReferences = await findReferences(verseRef);
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

export { registerReferences };
