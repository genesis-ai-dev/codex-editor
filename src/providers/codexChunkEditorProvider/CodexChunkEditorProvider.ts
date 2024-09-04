import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import {
    CustomNotebookData,
    EditorPostMessages,
    EditorVerseContent,
} from "../../../types";
import { getUri } from "../translationNotes/utilities/getUri";

function getNonce(): string {
    let text = "";
    const possible =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export class CodexChunkEditorProvider
    implements vscode.CustomTextEditorProvider
{
    public static register(
        context: vscode.ExtensionContext,
    ): vscode.Disposable {
        console.log("CodexChunkEditorProvider register called");
        const provider = new CodexChunkEditorProvider(context);
        const providerRegistration = vscode.window.registerCustomEditorProvider(
            CodexChunkEditorProvider.viewType,
            provider,
        );
        return providerRegistration;
    }

    private static readonly viewType = "codex.chunkEditor";

    constructor(private readonly context: vscode.ExtensionContext) {}

    /**
     * Called when our custom editor is opened.
     *
     *
     */
    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        console.log("resolveCustomTextEditor called");
        webviewPanel.webview.options = {
            enableScripts: true,
        };
        webviewPanel.webview.html = this.getHtmlForWebview(
            webviewPanel.webview,
        );

        const updateWebview = () => {
            const jsonContent = this.getDocumentAsJson(document);

            webviewPanel.webview.postMessage({
                type: "update",
                content: JSON.stringify(jsonContent),
            });
        };

        const changeDocumentSubscription =
            vscode.workspace.onDidChangeTextDocument((e) => {
                if (e.document.uri.toString() === document.uri.toString()) {
                    updateWebview();
                }
            });

        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });

        webviewPanel.webview.onDidReceiveMessage((e: EditorPostMessages) => {
            switch (e.command) {
                case "saveMarkdown":
                    console.log("saveMarkdown message received", { e });
                    // TODO: change this to update the document one vers at a time.
                    this.updateTextDocument(document, e.content);
                    // this.updateTextDocument(document, JSON.parse(e.content));
                    return;
                case "updateMetadataWithUnsavedChanges":
                    console.log("update message received", { e });
                    // TODO: change this to update the document one vers at a time.
                    this.updateTextDocument(document, e.content);
                    return;
                case "getContent":
                    updateWebview();
                    return;
            }
        });

        updateWebview();
    }

    /**
     * Get the static html used for the editor webviews.
     */
    private getHtmlForWebview(webview: vscode.Webview): string {
        const codiconsUri = getUri(webview, this.context.extensionUri, [
            "node_modules",
            "@vscode/codicons",
            "dist",
            "codicon.css",
        ]);
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this.context.extensionUri,
                "webviews",
                "codex-webviews",
                "dist",
                "CodexChunkEditor",
                "index.js",
            ),
        );

        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this.context.extensionUri,
                "webviews",
                "codex-webviews",
                "dist",
                "CodexChunkEditor",
                "index.css",
            ),
        );

        const nonce = getNonce();

        return /*html*/ `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
                <link rel="stylesheet" type="text/css" href="${styleUri}">
                <link href="${codiconsUri}" rel="stylesheet" />
                <title>Codex Chunk Editor</title>
            </head>
            <body>
                <div id="root"></div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    /**
     * Try to get a current document as json text.
     */
    private getDocumentAsJson(document: vscode.TextDocument): any {
        const text = document.getText();
        if (text.trim().length === 0) {
            return {};
        }

        try {
            return JSON.parse(text);
        } catch {
            throw new Error(
                "Could not get document as json. Content is not valid json",
            );
        }
    }

    /**
     * Write out the json to a given document.
     */
    private updateTextDocument(
        document: vscode.TextDocument,
        data: EditorVerseContent,
    ) {
        const edit = new vscode.WorkspaceEdit();

        const currentContent = JSON.parse(
            document.getText(),
        ) as CustomNotebookData;

        const verseDataArray = this.getVerseDataArray(); // FIXME: Calculate the verse data array based on the content instead of using a static file. It will probably be more efficient.

        const verseDataArrayIndex = verseDataArray.indexOf(data.verseMarker);
        const nextVerseMarker = verseDataArray[verseDataArrayIndex + 1];

        const indexOfCellToUpdate = currentContent.cells.findIndex((cell) =>
            cell.value.includes(data.verseMarker),
        );

        if (indexOfCellToUpdate === -1) {
            throw new Error("Could not find cell to update");
        }
        const cellToUpdate = currentContent.cells[indexOfCellToUpdate];

        if (data.verseMarker.split(":")[0] === nextVerseMarker.split(":")[0]) {
            const currentValue = cellToUpdate.value;
            const startIndex = currentValue.indexOf(data.verseMarker);
            const endIndex = currentValue.indexOf(nextVerseMarker, startIndex);

            if (startIndex !== -1 && endIndex !== -1) {
                cellToUpdate.value =
                    currentValue.substring(0, startIndex) +
                    data.verseMarker +
                    " " +
                    data.content +
                    `\n` +
                    currentValue.substring(endIndex);
            } else {
                console.error("Could not find verse markers in cell content");
            }
        } else {
            cellToUpdate.value =
                cellToUpdate.value.substring(
                    0,
                    cellToUpdate.value.indexOf(data.verseMarker) +
                        data.verseMarker.length,
                ) +
                " " +
                data.content;
        }

        // Just replace the entire document every time for this example extension.
        // A more complete extension should compute minimal edits instead.
        edit.replace(
            document.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            JSON.stringify(currentContent, null, 2),
        );

        return vscode.workspace.applyEdit(edit);
    }

    private getVerseDataArray(): string[] {
        try {
            const filePath = path.join(
                this.context.extensionPath,
                "src",
                "tsServer",
                "files",
                "versedata.txt",
            );
            const fileContent = fs.readFileSync(filePath, "utf-8");
            return fileContent
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => line !== "");
        } catch (error) {
            console.error(
                "updateTextDocument Error reading verse data file:",
                error,
            );
            vscode.window.showErrorMessage(
                "Failed to read verse data file. Please check the file path and permissions.",
            );
            return [];
        }
    }
}
