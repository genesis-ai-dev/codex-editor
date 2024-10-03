import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

import { getUri } from "../translationNotes/utilities/getUri";
import { initializeStateStore } from "../../stateStore";
import { fetchCompletionConfig } from "../translationSuggestions/inlineCompletionsProvider";
import { CodexContentSerializer, CodexNotebookReader } from "../../serializer";
import { workspaceStoreListener } from "../../utils/workspaceEventListener";
import { llmCompletion } from "../translationSuggestions/llmCompletion";
import { CodexCellTypes, EditType } from "../../../types/enums";
import {
    QuillCellContent,
    CodexNotebookAsJSONData,
    EditorPostMessages,
    EditorReceiveMessages,
    SpellCheckResponse,
} from "../../../types";

function getNonce(): string {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export class CodexCellEditorProvider implements vscode.CustomTextEditorProvider {
    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new CodexCellEditorProvider(context);
        const providerRegistration = vscode.window.registerCustomEditorProvider(
            CodexCellEditorProvider.viewType,
            provider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true,
                },
            }
        );
        return providerRegistration;
    }

    private static readonly viewType = "codex.cellEditor";

    constructor(private readonly context: vscode.ExtensionContext) {}

    /**
     * Called when our custom editor is opened.
     *
     *
     */
    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        console.log("resolveCustomTextEditor called");
        webviewPanel.webview.options = {
            enableScripts: true,
        };
        const textDirection = this.getTextDirection();
        const isSourceText = document.uri.fsPath.endsWith(".source");

        webviewPanel.webview.html = this.getHtmlForWebview(
            webviewPanel.webview,
            document,
            textDirection,
            isSourceText
        );

        const updateWebview = () => {
            const notebookData: vscode.NotebookData = this.getDocumentAsJson(document);

            const processedData = this.processNotebookData(notebookData);

            console.log("hfiuhfiuhfiufh processedData about to go to webview", { processedData });
            this.postMessageToWebview(webviewPanel, {
                type: "providerSendsInitialContent",
                content: processedData,
                isSourceText: isSourceText,
            });
        };

        const navigateToSection = (cellId: string) => {
            webviewPanel.webview.postMessage({
                type: "jumpToSection",
                content: cellId,
            });
        };

        const jumpToCellListenerDispose = workspaceStoreListener("cellToJumpTo", (value) => {
            navigateToSection(value);
        });

        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
            if (e.document.uri.toString() === document.uri.toString()) {
                updateWebview();
            }
        });

        webviewPanel.onDidDispose(() => {
            jumpToCellListenerDispose();
            changeDocumentSubscription.dispose();
        });

        webviewPanel.webview.onDidReceiveMessage(async (e: EditorPostMessages) => {
            try {
                switch (e.command) {
                    case "addWord": {
                        console.log("addWord message received", { e });
                        try {
                            await vscode.commands.executeCommand("spellcheck.addWord", e.text);
                        } catch (error) {
                            console.error("Error adding word:", error);
                            vscode.window.showErrorMessage("Failed to add word to dictionary.");
                        }
                        return;
                    }
                    case "from-quill-spellcheck-getSpellCheckResponse": {
                        console.log(
                            "from-quill-spellcheck-getSpellCheckResponse message received",
                            { e }
                        );
                        try {
                            const response = await vscode.commands.executeCommand(
                                "translators-copilot.spellCheckText",
                                e.content.content
                            );
                            this.postMessageToWebview(webviewPanel, {
                                type: "providerSendsSpellCheckResponse",
                                content: response as SpellCheckResponse,
                            });
                        } catch (error) {
                            console.error("Error during spell check:", error);
                            vscode.window.showErrorMessage("Spell check failed.");
                        }
                        return;
                    }
                    case "saveHtml":
                        console.log("saveHtml message received", { e });
                        try {
                            this.updateCellContentAndMetadata(
                                document,
                                e.content.cellMarkers[0],
                                e.content.content,
                                EditType.USER_EDIT
                            );
                        } catch (error) {
                            console.error("Error saving HTML:", error);
                            vscode.window.showErrorMessage("Failed to save HTML content.");
                        }
                        return;
                    // case "updateMetadataWithUnsavedChanges":
                    //     console.log("update message received", { e });
                    //     try {
                    //         this.updateTextDocument(document, e.content);
                    //     } catch (error) {
                    //         console.error("Error updating metadata:", error);
                    //         vscode.window.showErrorMessage("Failed to update metadata.");
                    //     }
                    //     return;
                    case "getContent":
                        updateWebview();
                        return;
                    case "setCurrentIdToGlobalState":
                        console.log("setVerseRef message received", { e });
                        try {
                            await initializeStateStore().then(({ updateStoreState }) => {
                                updateStoreState({
                                    key: "cellId",
                                    value: {
                                        cellId: e.content.currentLineId,
                                        uri: document.uri.toString(),
                                    },
                                });
                            });
                        } catch (error) {
                            console.error("Error setting current ID to global state:", error);
                            vscode.window.showErrorMessage(
                                "Failed to set current ID in global state."
                            );
                        }
                        return;
                    case "llmCompletion": {
                        try {
                            const completionResult = await this.performLLMCompletion(
                                document.uri,
                                e.content.currentLineId
                            );
                            console.log("completionResult", {
                                completionResult,
                            });
                            this.postMessageToWebview(webviewPanel, {
                                type: "providerSendsLLMCompletionResponse",
                                content: {
                                    completion: completionResult,
                                },
                            });
                        } catch (error) {
                            console.error("Error during LLM completion:", error);
                            vscode.window.showErrorMessage("LLM completion failed.");
                        }
                        return;
                    }
                    case "requestAutocompleteChapter": {
                        console.log("requestAutocompleteChapter message received", { e });
                        try {
                            const autocompleteChapterResult = await this.performAutocompleteChapter(
                                document.uri,
                                webviewPanel,
                                e.content as QuillCellContent[]
                            );
                        } catch (error) {
                            console.error("Error during autocomplete chapter:", error);
                            vscode.window.showErrorMessage("Autocomplete chapter failed.");
                        }
                        return;
                    }
                    case "updateTextDirection": {
                        console.log("updateTextDirection message received", {
                            direction: e.direction,
                        });
                        try {
                            await this.updateNotebookMetadata(document, e.direction);
                        } catch (error) {
                            console.error("Error updating notebook metadata:", error);
                            vscode.window.showErrorMessage("Failed to update notebook metadata.");
                        }
                        return;
                    }
                    case "openSourceText": {
                        console.log("openSourceText message received", { e });
                        try {
                            const currentFileName = vscode.workspace.asRelativePath(
                                document.fileName
                            );
                            const baseFileName = currentFileName.split("/").pop() || "";
                            const sourceFileName = baseFileName.replace(".codex", ".source");
                            console.log("sourceFileName", { sourceFileName });
                            await vscode.commands.executeCommand(
                                "translation-navigation.openSourceFile",
                                { sourceFile: sourceFileName }
                            );
                            this.postMessageToWebview(webviewPanel, {
                                type: "jumpToSection",
                                content: e.content.chapterNumber.toString(),
                            });
                        } catch (error) {
                            console.error("Error opening source text:", error);
                            vscode.window.showErrorMessage("Failed to open source text.");
                        }
                        return;
                    }
                }
            } catch (error) {
                console.error("Unexpected error in message handler:", error);
                vscode.window.showErrorMessage("An unexpected error occurred.");
            }
        });

        updateWebview();

        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration("translators-copilot.textDirection")) {
                this.updateTextDirection(webviewPanel);
            }
        });
    }

    private async updateCellContentAndMetadata(
        document: vscode.TextDocument,
        cellId: string,
        newContent: string,
        editType: EditType
    ) {
        const currentFileContent = JSON.parse(document.getText()) as CodexNotebookAsJSONData;
        // FIXME: Using the deserializing using the custom codex deserializer may cause errors if used here

        const indexOfCellToUpdate = currentFileContent.cells.findIndex(
            (cell) => cell.metadata?.id === cellId
        );

        if (indexOfCellToUpdate === -1) {
            throw new Error("Could not find cell to update");
        }

        const cellToUpdate = currentFileContent.cells[indexOfCellToUpdate];

        // Update cell content
        cellToUpdate.value = newContent;

        // Update metadata
        if (!cellToUpdate.metadata.edits) {
            cellToUpdate.metadata.edits = [];
        }

        cellToUpdate.metadata.edits.push({
            cellValue: newContent,
            timestamp: Date.now(),
            type: editType,
        });

        // Replace the entire document
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
            document.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            JSON.stringify(currentFileContent, null, 2)
        );

        await vscode.workspace.applyEdit(edit);
    }

    /**
     * Get the static html used for the editor webviews.
     */
    private getHtmlForWebview(
        webview: vscode.Webview,
        document: vscode.TextDocument,
        textDirection: string,
        isSourceText: boolean
    ): string {
        const styleResetUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, "src", "assets", "reset.css")
        );
        const styleVSCodeUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, "src", "assets", "vscode.css")
        );
        const codiconsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this.context.extensionUri,
                "node_modules",
                "@vscode/codicons",
                "dist",
                "codicon.css"
            )
        );
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this.context.extensionUri,
                "webviews",
                "codex-webviews",
                "dist",
                "CodexCellEditor",
                "index.js"
            )
        );

        // Get the video URI from the notebook metadata or use a default
        const notebookData = this.getDocumentAsJson(document);
        const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
        const videoPath = notebookData.metadata?.videoPath || "files/videoplaybacktrimmed.mp4";
        const videoUri = workspaceUri
            ? webview.asWebviewUri(vscode.Uri.joinPath(workspaceUri, videoPath))
            : null;

        const nonce = getNonce();

        return /*html*/ `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; worker-src ${webview.cspSource}; connect-src https://languagetool.org/api/; img-src ${webview.cspSource} https:; font-src ${webview.cspSource}; media-src ${webview.cspSource} blob:;">
                <link href="${styleResetUri}" rel="stylesheet" nonce="${nonce}">
                <link href="${styleVSCodeUri}" rel="stylesheet" nonce="${nonce}">
                <link href="${codiconsUri}" rel="stylesheet" nonce="${nonce}" />
                <title>Codex Cell Editor</title>
                
                <script nonce="${nonce}">
                    window.initialData = {
                        isSourceText: ${isSourceText},
                        videoUrl: "${videoUri}"
                    };
                </script>
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
            throw new Error("Could not get document as json. Content is not valid json");
        }
    }

    /**
     * Write out the json to a given document.
     */
    // private updateTextDocument(
    //     document: vscode.TextDocument,
    //     data: EditorVerseContent,
    //     editType: EditType
    // ) {
    //     this.updateCellContentAndMetadata(document, data.verseMarkers[0], data.content, editType);

    // const currentContent = JSON.parse(document.getText()) as CodexNotebookAsJSONData;
    // // FIXME: Using the deserializing using the custom codex deserializer causes errors if used here

    // const edit = new vscode.WorkspaceEdit();

    // const indexOfCellToUpdate = currentContent.cells.findIndex(
    //     (cell) => cell.metadata?.id === data.verseMarkers[0]
    // );

    // if (indexOfCellToUpdate === -1) {
    //     throw new Error("Could not find cell to update");
    // }
    // const cellToUpdate = currentContent.cells[indexOfCellToUpdate];

    // cellToUpdate.value = data.content;

    // if (!cellToUpdate.metadata.edits) {
    //     cellToUpdate.metadata.edits = [];
    // }

    // cellToUpdate.metadata.edits.push({
    //     cellValue: data.content,
    //     timestamp: Date.now(),
    //     type: EditType.USER_EDIT,
    // });

    // // Just replace the entire document every time for this example extension.
    // // A more complete extension should compute minimal edits instead.
    // edit.replace(
    //     document.uri,
    //     new vscode.Range(0, 0, document.lineCount, 0),
    //     JSON.stringify(currentContent, null, 2)
    // );

    // return vscode.workspace.applyEdit(edit);
    // }

    // private updateMetadataEditsWithLLMResponse(
    //     document: vscode.TextDocument,
    //     data: EditorVerseContent
    // ) {
    //     const currentContent = JSON.parse(document.getText()) as CodexNotebookAsJSONData;
    //     // FIXME: Using the deserializing using the custom codex deserializer causes errors if used here

    //     const edit = new vscode.WorkspaceEdit();

    //     const indexOfCellToUpdate = currentContent.cells.findIndex(
    //         (cell) => cell.metadata?.id === data.verseMarkers[0]
    //     );

    //     if (indexOfCellToUpdate === -1) {
    //         throw new Error("Could not find cell to update");
    //     }
    //     const cellToUpdate = currentContent.cells[indexOfCellToUpdate];

    //     if (!cellToUpdate.metadata.edits) {
    //         cellToUpdate.metadata.edits = [];
    //     }

    //     cellToUpdate.metadata.edits.push({
    //         cellValue: data.content,
    //         timestamp: Date.now(),
    //         type: EditType.LLM_GENERATION,
    //     });

    //     // Just replace the entire document every time for this example extension.
    //     // A more complete extension should compute minimal edits instead.
    //     edit.replace(
    //         document.uri,
    //         new vscode.Range(0, 0, document.lineCount, 0),
    //         JSON.stringify(currentContent, null, 2)
    //     );

    //     return vscode.workspace.applyEdit(edit);
    // }

    // private getVerseDataArray(): string[] {
    //     try {
    //         const filePath = path.join(
    //             this.context.extensionPath,
    //             "src",
    //             "tsServer",
    //             "files",
    //             "versedata.txt"
    //         );
    //         const fileContent = fs.readFileSync(filePath, "utf-8");
    //         return fileContent
    //             .split("\n")
    //             .map((line) => line.trim())
    //             .filter((line) => line !== "");
    //     } catch (error) {
    //         console.error("updateTextDocument Error reading verse data file:", error);
    //         vscode.window.showErrorMessage(
    //             "Failed to read verse data file. Please check the file path and permissions."
    //         );
    //         return [];
    //     }
    // }

    private getTextDirection(): string {
        return vscode.workspace.getConfiguration("translators-copilot").get("textDirection", "ltr");
    }

    private updateTextDirection(webviewPanel: vscode.WebviewPanel): void {
        const textDirection = this.getTextDirection();
        this.postMessageToWebview(webviewPanel, {
            // FIXME: we are currently overriding styles at a global level, but it's not affecting source texts...?
            type: "providerUpdatesTextDirection",
            textDirection: textDirection as "ltr" | "rtl",
        });
    }

    private async performLLMCompletion(documentUri: vscode.Uri, currentCellId: string) {
        try {
            // Fetch completion configuration
            const completionConfig = await fetchCompletionConfig();
            const notebookReader = new CodexNotebookReader(documentUri);
            // Perform LLM completion
            const result = await llmCompletion(
                notebookReader,
                currentCellId,
                completionConfig,
                new vscode.CancellationTokenSource().token
            );

            // Open the document and update content and metadata atomically
            const document = await vscode.workspace.openTextDocument(documentUri);
            await this.updateCellContentAndMetadata(
                document,
                currentCellId,
                result,
                EditType.LLM_GENERATION
            );

            console.log("LLM completion result", { result });
            return result;
        } catch (error: any) {
            console.error("Error in performLLMCompletion:", error);
            vscode.window.showErrorMessage(`LLM completion failed: ${error.message}`);
            throw error;
        }
    }

    private async performAutocompleteChapter(
        documentUri: vscode.Uri,
        webviewPanel: vscode.WebviewPanel,
        currentChapterTranslationUnits: QuillCellContent[]
    ) {
        for (let i = 0; i < currentChapterTranslationUnits.length; i++) {
            const cell = currentChapterTranslationUnits[i];

            if (cell.cellType === CodexCellTypes.PARATEXT) continue;
            if (cell.cellContent?.trim() === "<range>") continue;
            if (cell.cellContent?.trim()) continue;

            const cellId = cell.cellMarkers[0];
            if (!cellId) {
                throw new Error("Cell ID is undefined");
            }

            try {
                // Perform LLM completion for the current cell
                await this.performLLMCompletion(documentUri, cellId);

                // Send an update to the webview
                this.postMessageToWebview(webviewPanel, {
                    type: "providerUpdatesCell",
                    content: {
                        cellId: cellId,
                        progress: (i + 1) / currentChapterTranslationUnits.length,
                    },
                });

                // Optionally, add a small delay if needed
                // await new Promise((resolve) => setTimeout(resolve, 1000));
            } catch (error) {
                console.error(`Error autocompleting cell ${cellId}:`, error);
                vscode.window.showErrorMessage(`Failed to autocomplete cell ${cellId}`);
            }

            const debounceTimeToAllowIndexesToSettle = 1000;
            await new Promise((resolve) => setTimeout(resolve, debounceTimeToAllowIndexesToSettle));
        }

        // Send a final update to indicate completion
        this.postMessageToWebview(webviewPanel, {
            type: "providerCompletesChapterAutocompletion",
        });
    }

    private processNotebookData(notebook: vscode.NotebookData) {
        const translationUnits: QuillCellContent[] = notebook.cells.map((cell) => ({
            cellMarkers: [cell.metadata?.id],
            cellContent: cell.value,
            cellType: cell.metadata?.type,
            editHistory: cell.metadata?.edits,
            timestamps: cell.metadata?.data, // FIXME: add strong types because this is where the timestamps are and it's not clear
        }));

        const processedData = this.mergeRangesAndProcess(translationUnits);

        return processedData;
    }

    private mergeRangesAndProcess(translationUnits: QuillCellContent[]) {
        const translationUnitsWithMergedRanges: QuillCellContent[] = [];

        translationUnits.forEach((verse, index) => {
            const rangeMarker = "<range>";
            if (verse.cellContent?.trim() === rangeMarker) {
                return;
            }

            let forwardIndex = 1;
            const cellMarkers = [...verse.cellMarkers];
            let nextCell = translationUnits[index + forwardIndex];

            while (nextCell?.cellContent?.trim() === rangeMarker) {
                cellMarkers.push(...nextCell.cellMarkers);
                forwardIndex++;
                nextCell = translationUnits[index + forwardIndex];
            }

            translationUnitsWithMergedRanges.push({
                cellMarkers,
                cellContent: verse.cellContent,
                cellType: verse.cellType,
                editHistory: verse.editHistory,
                timestamps: verse.timestamps,
            });
        });

        return translationUnitsWithMergedRanges;
    }

    private postMessageToWebview(
        webviewPanel: vscode.WebviewPanel,
        message: EditorReceiveMessages
    ) {
        webviewPanel.webview.postMessage(message);
    }

    private async updateNotebookMetadata(document: vscode.TextDocument, textDirection: string) {
        const currentContent = JSON.parse(document.getText()) as CodexNotebookAsJSONData;

        // Update the notebook metadata
        if (!currentContent.metadata) {
            currentContent.metadata = {};
        }
        currentContent.metadata.textDirection = textDirection as "ltr" | "rtl";

        const edit = new vscode.WorkspaceEdit();
        edit.replace(
            document.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            JSON.stringify(currentContent, null, 2)
        );

        await vscode.workspace.applyEdit(edit);
    }
}
