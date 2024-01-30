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
    provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken,
    ): vscode.CodeLens[] {
        // console.log({ document }, "hi");
        const lenses: vscode.CodeLens[] = [];
        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i);
            const verseRef = extractVerseRefFromLine(line.text);
            if (verseRef) {
                const range = new vscode.Range(i, 0, i, line.text.length);
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

export async function findReferences(verseRef: string) {
    const filesWithReferences: string[] = [];
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (!workspaceFolders) {
        return filesWithReferences;
    }

    for (const folder of workspaceFolders) {
        const files = await vscode.workspace.findFiles(
            new vscode.RelativePattern(folder, "**/*.scripture"),
        );

        for (const file of files) {
            const fileUri = vscode.Uri.file(file.fsPath);
            const document = await vscode.workspace.openTextDocument(fileUri);
            const content = document.getText();
            if (content.includes(verseRef)) {
                filesWithReferences.push(file.fsPath);
            }
        }
    }

    return filesWithReferences;
}

const registerReferences = (context: vscode.ExtensionContext) => {
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            { language: "scripture" },
            new ScriptureReferenceCodeLensProvider(),
        ),
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
                    const position = new vscode.Position(0, 0); // Assuming the reference is at the start of the file
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
