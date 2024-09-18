import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import {
    CodexCellTypes,
    CustomNotebookData,
    EditorPostMessages,
    EditorVerseContent,
} from "../../../types";
import { getUri } from "../translationNotes/utilities/getUri";
import { initializeStateStore } from "../../stateStore";
import { fetchCompletionConfig } from "../translationSuggestions/inlineCompletionsProvider";

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
        const textDirection = this.getTextDirection();
        webviewPanel.webview.html = this.getHtmlForWebview(
            webviewPanel.webview,
            textDirection,
        );

        const updateWebview = () => {
            const notebookData: vscode.NotebookData =
                this.getDocumentAsJson(document);

            const processedData = this.processNotebookData(notebookData);

            webviewPanel.webview.postMessage({
                type: "update",
                content: JSON.stringify(processedData),
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

        webviewPanel.webview.onDidReceiveMessage(
            async (e: EditorPostMessages) => {
                try {
                    switch (e.command) {
                        case "addWord": {
                            console.log("addWord message received", { e });
                            try {
                                await vscode.commands.executeCommand(
                                    "spellcheck.addWord",
                                    e.text,
                                );
                            } catch (error) {
                                console.error("Error adding word:", error);
                                vscode.window.showErrorMessage(
                                    "Failed to add word to dictionary.",
                                );
                            }
                            return;
                        }
                        case "spellCheck": {
                            console.log("spellCheck message received", { e });
                            try {
                                const response =
                                    await vscode.commands.executeCommand(
                                        "spellcheck.checkText",
                                        e.content.content,
                                    );
                                webviewPanel.webview.postMessage({
                                    type: "spellCheckResponse",
                                    content: response,
                                });
                                console.log("spellCheck response", {
                                    response,
                                });
                            } catch (error) {
                                console.error(
                                    "Error during spell check:",
                                    error,
                                );
                                vscode.window.showErrorMessage(
                                    "Spell check failed.",
                                );
                            }
                            return;
                        }
                        case "saveHtml":
                            console.log("saveMarkdown message received", { e });
                            try {
                                this.updateTextDocument(document, e.content);
                            } catch (error) {
                                console.error("Error saving HTML:", error);
                                vscode.window.showErrorMessage(
                                    "Failed to save HTML content.",
                                );
                            }
                            return;
                        case "updateMetadataWithUnsavedChanges":
                            console.log("update message received", { e });
                            try {
                                this.updateTextDocument(document, e.content);
                            } catch (error) {
                                console.error(
                                    "Error updating metadata:",
                                    error,
                                );
                                vscode.window.showErrorMessage(
                                    "Failed to update metadata.",
                                );
                            }
                            return;
                        case "getContent":
                            updateWebview();
                            return;
                        case "setCurrentIdToGlobalState":
                            console.log("setVerseRef message received", { e });
                            try {
                                await initializeStateStore().then(
                                    ({ updateStoreState }) => {
                                        updateStoreState({
                                            key: "verseRef",
                                            value: {
                                                verseRef:
                                                    e.content.currentLineId,
                                                uri: document.uri.toString(),
                                            },
                                        });
                                    },
                                );
                            } catch (error) {
                                console.error(
                                    "Error setting current ID to global state:",
                                    error,
                                );
                                vscode.window.showErrorMessage(
                                    "Failed to set current ID in global state.",
                                );
                            }
                            return;
                        case "llmCompletion": {
                            console.log("llmCompletion message received", {
                                e,
                            });
                            try {
                                const completionResult =
                                    await this.performLLMCompletion(
                                        document,
                                        e.content.currentLineId,
                                    );
                                console.log("completionResult", {
                                    completionResult,
                                });
                                webviewPanel.webview.postMessage({
                                    type: "llmCompletionResponse",
                                    content: completionResult,
                                });
                            } catch (error) {
                                console.error(
                                    "Error during LLM completion:",
                                    error,
                                );
                                vscode.window.showErrorMessage(
                                    "LLM completion failed.",
                                );
                            }
                            return;
                        }
                        // case "getCompletionConfig": {
                        //     const config = await fetchCompletionConfig();
                        //     webviewPanel.webview.postMessage({
                        //         type: "completionConfig",
                        //         content: config,
                        //     });
                        //     return;
                        // }
                    }
                } catch (error) {
                    console.error(
                        "Unexpected error in message handler:",
                        error,
                    );
                    vscode.window.showErrorMessage(
                        "An unexpected error occurred.",
                    );
                }
            },
        );

        updateWebview();

        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration("translators-copilot.textDirection")) {
                this.updateTextDirection(webviewPanel);
            }
        });
    }

    /**
     * Get the static html used for the editor webviews.
     */
    private getHtmlForWebview(
        webview: vscode.Webview,
        textDirection: string,
    ): string {
        const styleResetUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this.context.extensionUri,
                "src",
                "media",
                "reset.css",
            ),
        );
        const styleVSCodeUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this.context.extensionUri,
                "src",
                "media",
                "vscode.css",
            ),
        );
        const codiconsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this.context.extensionUri,
                "node_modules",
                "@vscode/codicons",
                "dist",
                "codicon.css",
            ),
        );
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

        const nonce = getNonce();
        console.log("textDirection", { textDirection });
        return /*html*/ `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${
                    webview.cspSource
                } 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src https://languagetool.org/api/; img-src ${
                    webview.cspSource
                } https:; font-src ${webview.cspSource};">
                <link href="${styleResetUri}" rel="stylesheet" nonce="${nonce}">
                <link href="${styleVSCodeUri}" rel="stylesheet" nonce="${nonce}">
                <link href="${codiconsUri}" rel="stylesheet" nonce="${nonce}" />
                <title>Codex Chunk Editor</title>
                <style>
                    .ql-editor {
                        direction: ${textDirection} !important;
                        text-align: ${
                            textDirection === "rtl" ? "right" : "left"
                        } !important;
                    }
                </style>
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
        console.log("data.verseMarkers[0]", {
            "data.verseMarkers[0]": data.verseMarkers[0],
            currentContent,
        });
        const verseDataArrayIndex = verseDataArray.indexOf(
            data.verseMarkers[0],
        );
        const nextVerseMarker = verseDataArray[verseDataArrayIndex + 1];

        const indexOfCellToUpdate = currentContent.cells.findIndex(
            (cell) => cell.metadata?.id === data.verseMarkers[0],
        );

        if (indexOfCellToUpdate === -1) {
            throw new Error("Could not find cell to update");
        }
        const cellToUpdate = currentContent.cells[indexOfCellToUpdate];

        cellToUpdate.value = data.content;

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

    private getTextDirection(): string {
        return vscode.workspace
            .getConfiguration("translators-copilot")
            .get("textDirection", "ltr");
    }

    private updateTextDirection(webviewPanel: vscode.WebviewPanel): void {
        const textDirection = this.getTextDirection();
        webviewPanel.webview.postMessage({
            command: "updateTextDirection",
            textDirection,
        });
    }

    private async performLLMCompletion(
        document: vscode.TextDocument,
        currentLineId: string,
    ) {
        try {
            console.log("Starting performLLMCompletion", { currentLineId });

            const book = currentLineId.split(" ")[0];
            const notebookFiles = await vscode.workspace.findFiles(
                `**/${book}.codex`,
            );
            console.log("Found notebook files", { notebookFiles });

            if (notebookFiles.length === 0) {
                throw new Error(`No .codex file found for book ${book}`);
            }

            const notebook = await vscode.workspace.openNotebookDocument(
                notebookFiles[0],
            );
            console.log("Opened notebook", { notebook });

            let cellIndex = -1;
            // let lineIndex = -1;
            // let position = 0;

            for (let i = 0; i < notebook.cellCount; i++) {
                const cell = notebook.cellAt(i);
                if (cell.kind === vscode.NotebookCellKind.Code) {
                    const lines = cell.document.getText().split("\n");
                    const foundIndex = lines.findIndex((line) =>
                        line.trim().startsWith(currentLineId),
                    );

                    if (foundIndex !== -1) {
                        cellIndex = i;
                        // lineIndex = foundIndex;
                        // position += lines
                        //     .slice(0, foundIndex)
                        //     .reduce((sum, line) => sum + line.length + 1, 0);
                        break;
                    }

                    // position += cell.document.getText().length + 1;
                }
            }

            if (cellIndex === -1) {
                throw new Error(
                    `Could not find line with ID ${currentLineId} in the notebook.`,
                );
            }

            // console.log("Found target line", {
            //     cellIndex,
            //     lineIndex,
            //     position,
            // });

            const cellText = notebook.cellAt(cellIndex).document.getText();
            const cellDocument = await vscode.workspace.openTextDocument({
                content: cellText,
                language: "plaintext",
            });
            const lines = cellDocument.getText().split("\n");
            // find the position of the line in the text document
            const lineIndex = lines.findIndex((line) =>
                line.trim().startsWith(currentLineId),
            );

            const positionOfLineInTextDoc = new vscode.Position(lineIndex, 0);

            console.log("Created cell document", { cellDocument, lines });

            const { llmCompletion } = await import(
                "../../providers/translationSuggestions/llmCompletion"
            );
            const completionConfig = await fetchCompletionConfig();
            console.log("Fetched completion config", { completionConfig });

            const result = await llmCompletion(
                cellDocument,
                positionOfLineInTextDoc,
                completionConfig,
                new vscode.CancellationTokenSource().token,
            );

            console.log("LLM completion result", { result });
            return result;
        } catch (error: any) {
            console.error("Error in performLLMCompletion:", error);
            vscode.window.showErrorMessage(
                `LLM completion failed: ${error.message}`,
            );
            throw error;
        }
    }

    private processNotebookData(notebook: vscode.NotebookData) {
        const translationUnits = notebook.cells.map((cell) => ({
            verseMarkers: [cell.metadata?.id],
            verseContent: cell.value,
            cellType: cell.metadata?.type,
        }));
        console.log("translationUnits in processNotebookData", {
            translationUnits,
        });
        const processedData = this.mergeRangesAndProcess(translationUnits);

        return processedData;
    }

    private mergeRangesAndProcess(
        translationUnits: {
            verseMarkers: string[];
            verseContent: string;
            cellType: CodexCellTypes;
        }[],
    ) {
        const translationUnitsWithMergedRanges: {
            verseMarkers: string[];
            verseContent: string;
            cellType: CodexCellTypes;
        }[] = [];

        translationUnits.forEach((verse, index) => {
            const rangeMarker = "<range>";
            if (verse.verseContent?.trim() === rangeMarker) {
                return;
            }

            let forwardIndex = 1;
            const verseMarkers = [...verse.verseMarkers];
            let nextVerse = translationUnits[index + forwardIndex];

            while (nextVerse?.verseContent?.trim() === rangeMarker) {
                verseMarkers.push(...nextVerse.verseMarkers);
                forwardIndex++;
                nextVerse = translationUnits[index + forwardIndex];
            }

            translationUnitsWithMergedRanges.push({
                verseMarkers,
                verseContent: verse.verseContent,
                cellType: verse.cellType,
            });
        });

        return translationUnitsWithMergedRanges;
    }
}
