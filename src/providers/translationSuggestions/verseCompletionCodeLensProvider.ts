import * as vscode from "vscode";

class VerseCompletionCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    constructor() {
        vscode.window.onDidChangeTextEditorSelection(() => {
            this._onDidChangeCodeLenses.fire();
        });
    }

    async provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): Promise<vscode.CodeLens[]> {
        const codeLenses: vscode.CodeLens[] = [];

        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document !== document) {
            return [];
        }

        const currentLine = editor.selection.active.line;
        const line = document.lineAt(currentLine);
        const match = line.text.match(/^(\w{3}\s\d+:\d+)/);

        if (match) {
            const range = new vscode.Range(currentLine, 0, currentLine, match[0].length);
            const codeLens = new vscode.CodeLens(range, {
                title: "📝Autocomplete",
                command: "codex-editor-extension.triggerInlineCompletion",
                arguments: [],
            });
            codeLenses.push(codeLens);
        }

        return codeLenses;
    }
}

export default VerseCompletionCodeLensProvider;
