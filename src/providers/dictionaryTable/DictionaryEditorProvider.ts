import * as vscode from "vscode";
import { getNonce } from "./utilities/getNonce";
import {
    DictionaryPostMessages,
    DictionaryReceiveMessages,
    Dictionary,
    DictionaryEntry,
} from "../../../types";
import { getWorkSpaceUri } from "../../utils";
import { isEqual } from "lodash";
import { ensureCompleteEntry } from "../../utils/dictionaryUtils/common";
import { Database } from "sql.js";
import { getWords, getDefinitions, getPagedWords } from "../../sqldb";

type FetchPageResult = {
    entries: DictionaryEntry[];
    total: number;
    page: number;
    pageSize: number;
};
interface DictionaryDocument extends vscode.CustomDocument {
    content: Dictionary;
}

type PartialDictionaryEntry = Partial<DictionaryEntry>;

export class DictionaryEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = "codex.dictionaryEditor";
    private document: FetchPageResult | undefined;
    private readonly onDidChangeCustomDocument = new vscode.EventEmitter<
        vscode.CustomDocumentEditEvent<DictionaryDocument>
    >();
    private fileWatcher: vscode.FileSystemWatcher | undefined;
    private lastSentData: Dictionary | null = null;

    constructor(private readonly context: vscode.ExtensionContext) {}

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new DictionaryEditorProvider(context);
        const providerRegistration = vscode.window.registerCustomEditorProvider(
            DictionaryEditorProvider.viewType,
            provider
        );
        return providerRegistration;
    }

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        this.document = await this.handleFetchPage(1, 100);
        webviewPanel.webview.options = {
            enableScripts: true,
        };
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

        const updateWebview = () => {
            const dictionaryContent = this.document;
            console.log("sending dictionaryContent to webview", dictionaryContent);
            webviewPanel.webview.postMessage({
                command: "providerTellsWebviewToUpdateData",
                data: dictionaryContent,
            } as DictionaryReceiveMessages);
        };

        // Watch for changes in the project.dictionary file
        const workspaceFolderUri = getWorkSpaceUri();
        if (workspaceFolderUri) {
            const dictionaryUri = vscode.Uri.joinPath(
                workspaceFolderUri,
                "files",
                "project.dictionary"
            );
            this.fileWatcher = vscode.workspace.createFileSystemWatcher(dictionaryUri.fsPath);

            this.fileWatcher.onDidChange(() => {
                this.refreshEditor(webviewPanel);
                updateWebview();
            });
        }

        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
            if (e.document.uri.toString() === document.uri.toString()) {
                updateWebview();
            }
        });

        webviewPanel.onDidDispose(() => {
            if (this.fileWatcher) {
                this.fileWatcher.dispose();
            }
            changeDocumentSubscription.dispose();
        });

        webviewPanel.webview.onDidReceiveMessage(async (e: DictionaryPostMessages) => {
            switch (e.command) {
                case "webviewTellsProviderToUpdateData": {
                    if (e.operation === "fetchPage" && e.pagination) {
                        const pageData = await this.handleFetchPage(
                            e.pagination.page,
                            e.pagination.pageSize,
                            e.pagination.searchQuery
                        );

                        webviewPanel.webview.postMessage({
                            command: "providerTellsWebviewToUpdateData",
                            data: {
                                dictionaryData: {
                                    id: "",
                                    label: "",
                                    metadata: {},
                                },
                                entries: pageData.entries,
                                total: pageData.total,
                                page: pageData.page,
                                pageSize: pageData.pageSize,
                            },
                        } as DictionaryReceiveMessages);
                        break;
                    }
                    const db = (global as any).db as Database;
                    if (!db) {
                        throw new Error("SQLite database not initialized");
                    }

                    switch (e.operation) {
                        case "update":
                            db.run(
                                `
                                INSERT OR REPLACE INTO entries (word, definition)
                                VALUES (?, ?)
                            `,
                                [e.entry.headWord, e.entry.definition]
                            );
                            break;

                        case "delete":
                            db.run(
                                `
                                DELETE FROM entries
                                WHERE word = ?
                            `,
                                [e.entry.headWord]
                            );
                            break;

                        case "add":
                            if (e.entry.headWord) {
                                // Only add if headWord is not empty
                                db.run(
                                    `
                                    INSERT INTO entries (word, definition)
                                    VALUES (?, ?)
                                `,
                                    [e.entry.headWord, e.entry.definition]
                                );
                            }
                            break;
                    }

                    // Notify webview of successful update if needed
                    webviewPanel.webview.postMessage({
                        command: "providerTellsWebviewToUpdateData",
                        data: this.document,
                    } as DictionaryReceiveMessages);
                    break;
                }
                case "webviewAsksProviderToConfirmRemove": {
                    console.log("confirmRemove received in DictionaryEditorProvider", e.count);
                    const confirmed = await vscode.window.showInformationMessage(
                        `Are you sure you want to remove ${e.count} item${e.count > 1 ? "s" : ""}?`,
                        { modal: true },
                        "Yes",
                        "No"
                    );
                    if (confirmed === "Yes") {
                        await this.updateTextDocument(document, e.data, webviewPanel);
                        webviewPanel.webview.postMessage({
                            command: "providerTellsWebviewRemoveConfirmed",
                        } as DictionaryReceiveMessages);
                    }
                    break;
                }
            }
        });

        updateWebview();
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
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
                "EditableReactTable",
                "index.js"
            )
        );

        const nonce = getNonce();

        return /* html */ `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src ${webview.cspSource}; img-src ${webview.cspSource} https:; font-src ${webview.cspSource};">
                <link href="${styleResetUri}" rel="stylesheet" nonce="${nonce}">
                <link href="${styleVSCodeUri}" rel="stylesheet" nonce="${nonce}">
                <link href="${codiconsUri}" rel="stylesheet" nonce="${nonce}" />
                <title>Dictionary Editor</title>
            </head>
            <body>
                <div id="root"></div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    // private getDictionaryEntries(): Dictionary {
    //     const db = (global as any).db as Database;
    //     if (!db) {
    //         throw new Error("SQLite database not initialized");
    //     }

    //     const words = getWords(db);
    //     const entries: DictionaryEntry[] = words.map((word) => {
    //         const definitions = getDefinitions(db, word);
    //         return {
    //             id: word,
    //             headWord: word,
    //             definition: definitions.join("\n"),
    //             // Set default values for other required fields
    //             headForm: "",
    //             variantForms: [],
    //             partOfSpeech: "",
    //             etymology: "",
    //             usage: "",
    //             notes: [],
    //             examples: [],
    //             translationEquivalents: [],
    //             links: [],
    //             linkedEntries: [],
    //             metadata: {},
    //             hash: this.generateHash(word),
    //         };
    //     });

    //     return { id: "", label: "", entries, metadata: {} };
    // }

    private async updateTextDocument(
        document: vscode.TextDocument,
        dictionary: Dictionary,
        webviewPanel: vscode.WebviewPanel
    ) {
        const db = (global as any).db as Database;
        if (!db) {
            throw new Error("SQLite database not initialized");
        }

        // Update SQLite database instead of file
        dictionary.entries.forEach((entry) => {
            db.run(
                `
                INSERT OR REPLACE INTO entries (word, definition)
                VALUES (?, ?)
            `,
                [entry.headWord, entry.definition]
            );
        });

        // Notify webview of updates
        webviewPanel.webview.postMessage({
            command: "providerTellsWebviewToUpdateData",
            data: this.document,
        } as DictionaryReceiveMessages);
    }

    // private async repairDictionaryIfNeeded(dictionaryUri: vscode.Uri) {
    //     try {
    //         const dictionary = await readDictionaryClient(dictionaryUri);
    //         const newContent = serializeDictionaryEntries(
    //             dictionary.entries.map(ensureCompleteEntry)
    //         );
    //         await saveDictionaryClient(dictionaryUri, {
    //             ...dictionary,
    //             entries: deserializeDictionaryEntries(newContent),
    //         });
    //         console.log("Dictionary repaired and saved.");
    //     } catch (error) {
    //         console.error("Error repairing dictionary:", error);
    //     }
    // }

    private isValidDictionaryEntry(entry: any): entry is DictionaryEntry {
        return typeof entry === "object" && entry !== null && "headWord" in entry;
    }

    private ensureCompleteEntry(entry: Partial<DictionaryEntry>): DictionaryEntry {
        return {
            id: entry.id || "",
            headWord: entry.headWord || "",
            definition: entry.definition || "",
            hash: entry.hash || this.generateHash(entry.headWord || ""),
        };
    }

    private generateHash(word: string): string {
        // Simple hash function for demonstration
        return word
            .split("")
            .reduce((acc, char) => acc + char.charCodeAt(0), 0)
            .toString();
    }

    private async refreshEditor(webviewPanel: vscode.WebviewPanel) {
        if (this.document) {
            try {
                const updatedContent = this.document;
                console.log("updatedContent", updatedContent);

                // Compare with current entries
                if (!this.areEntriesEqual(this.document.entries, updatedContent.entries)) {
                    // Update only if there are changes
                    this.document = updatedContent;

                    // Notify the webview of the updated content
                    webviewPanel.webview.postMessage({
                        command: "providerTellsWebviewToUpdateData",
                        data: updatedContent,
                    } as DictionaryReceiveMessages);

                    // this.onDidChangeCustomDocument.fire({
                    //     document: this.document,
                    //     undo: () => {
                    //         // Implement undo logic if needed
                    //     },
                    //     redo: () => {
                    //         // Implement redo logic if needed
                    //     },
                    // });
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to refresh dictionary: ${error}`);
            }
        }
    }

    private parseEntriesFromJsonl(content: string): DictionaryEntry[] {
        return content
            .split("\n")
            .filter((line) => line.trim() !== "")
            .map((line) => ensureCompleteEntry(JSON.parse(line) as PartialDictionaryEntry));
    }

    private areEntriesEqual(entries1: DictionaryEntry[], entries2: DictionaryEntry[]): boolean {
        if (entries1.length !== entries2.length) return false;
        return entries1.every(
            (entry, index) => JSON.stringify(entry) === JSON.stringify(entries2[index])
        );
    }

    public saveCustomDocument(
        document: Dictionary,
        cancellation: vscode.CancellationToken
    ): Thenable<void> {
        // Serialize the document content
        const content = this.serializeDictionary(document);

        // Use vscode.workspace.fs to write the file
        const encoder = new TextEncoder();
        const array = encoder.encode(content);
        const workspaceFolderUri = getWorkSpaceUri();
        if (!workspaceFolderUri) {
            console.error("Workspace folder not found. Aborting save of dictionary.");
            return Promise.reject(new Error("Workspace folder not found"));
        }
        const metadataUri = vscode.Uri.joinPath(workspaceFolderUri, "metadata.json");
        const dictionaryUri = vscode.Uri.joinPath(
            workspaceFolderUri,
            "files",
            "project.dictionary"
        );

        return vscode.workspace.fs.stat(metadataUri).then(
            () => {
                // metadata.json exists, proceed with writing the dictionary
                return vscode.workspace.fs.writeFile(dictionaryUri, array);
            },
            () => {
                // metadata.json doesn't exist, abort the save
                console.error("metadata.json not found. Aborting save of dictionary.");
                return Promise.reject(new Error("metadata.json not found"));
            }
        );
    }

    private serializeDictionary(document: Dictionary): string {
        // Convert the dictionary entries to JSON Lines
        return document.entries.map((entry) => JSON.stringify(entry)).join("\n");
    }

    private hasDataChanged(newData: Dictionary): boolean {
        if (!this.lastSentData) {
            return true;
        }
        return !isEqual(this.lastSentData, newData);
    }

    private async handleFetchPage(
        page: number,
        pageSize: number,
        searchQuery?: string
    ): Promise<FetchPageResult> {
        const db = (global as any).db as Database;
        if (!db) {
            throw new Error("SQLite database not initialized");
        }

        const { words, total } = getPagedWords(db, page, pageSize, searchQuery);
        const entries: DictionaryEntry[] = words.map((word) => {
            const definitions = getDefinitions(db, word);
            return {
                id: word,
                headWord: word,
                definition: definitions.join("\n"),
                hash: this.generateHash(word),
            };
        });

        return {
            entries,
            total,
            page,
            pageSize,
        };
    }
}
