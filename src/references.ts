import * as vscode from "vscode";

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

function extractVerseRefFromLine(line: string): string | null {
    // Implement logic to extract the verse reference (e.g., 'MAT 1:1') from a line
    // Return the verse reference as a string, or null if not found
    const verseRefRegex = /(\b[A-Z]{3}\s\d+:\d+\b)/;
    const match = line.match(verseRefRegex);
    return match ? match[0] : null;
}

async function findReferences(verseRef: string) {
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

// function activate(context) {
//     context.subscriptions.push(vscode.languages.registerDefinitionProvider(['scripture'], new ScriptureReferenceProvider()));
// }

export { ScriptureReferenceProvider };
