import * as vscode from "vscode";
import { Dictionary, DictionaryEntry } from "codex-types";
import { getNonce } from "./utilities/getNonce";
import { DictionaryPostMessages, DictionaryReceiveMessages } from "../../../types";
import { getWorkSpaceUri } from "../../utils";

interface DictionaryDocument extends vscode.CustomDocument {
    content: Dictionary;
}

type PartialDictionaryEntry = Partial<DictionaryEntry>;

function ensureCompleteEntry(entry: PartialDictionaryEntry): DictionaryEntry {
    return {
        id: entry.id || "",
        headForm: entry.headForm || "",
        variantForms: entry.variantForms || [],
        definition: entry.definition || "",
        partOfSpeech: entry.partOfSpeech || "",
        etymology: entry.etymology || "",
        usage: entry.usage || "",
        notes: entry.notes || [],
        examples: entry.examples || [],
        translationEquivalents: entry.translationEquivalents || [],
        links: entry.links || [],
        linkedEntries: entry.linkedEntries || [],
        metadata: entry.metadata || {},
    };
}

export class DictionaryEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = "codex.dictionaryEditor";
    private document: DictionaryDocument | undefined;
    private readonly onDidChangeCustomDocument = new vscode.EventEmitter<
        vscode.CustomDocumentEditEvent<DictionaryDocument>
    >();
    private fileWatcher: vscode.FileSystemWatcher | undefined;

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
        this.document = {
            uri: document.uri,
            content: this.getDocumentAsJson(document),
            dispose: () => {},
        };
        webviewPanel.webview.options = {
            enableScripts: true,
        };
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

        const updateWebview = () => {
            const dictionaryContent = this.getDocumentAsJson(document);
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
                case "webviewTellsProviderToUpdateData":
                    console.log("updateData received in DictionaryEditorProvider", e.data);
                    await this.updateTextDocument(document, e.data, webviewPanel).then(async () => {
                        await this.refreshEditor(webviewPanel);
                    });
                    return;
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

    private getDocumentAsJson(document: vscode.TextDocument): Dictionary {
        const text = document.getText();
        if (text.trim().length === 0) {
            return { id: "", label: "", entries: [], metadata: {} };
        }

        try {
            // Try parsing as JSONL (each line is a JSON entry)
            const entries = text
                .split("\n")
                .filter((line) => line.trim().length > 0)
                .map((line) => ensureCompleteEntry(JSON.parse(line) as PartialDictionaryEntry));

            return { id: "", label: "", entries, metadata: {} };
        } catch (jsonlError) {
            try {
                // If parsing as JSONL fails, try parsing as a single JSON object
                const parsed = JSON.parse(text);
                if (parsed.entries) {
                    parsed.entries = parsed.entries.map((entry: PartialDictionaryEntry) =>
                        ensureCompleteEntry(entry)
                    );
                    return parsed;
                } else {
                    throw new Error("Invalid JSON format: missing entries.");
                }
            } catch (jsonError) {
                throw new Error("Could not parse document as JSONL or JSON. Content is not valid.");
            }
        }
    }

    private async updateTextDocument(
        document: vscode.TextDocument,
        dictionary: Dictionary,
        webviewPanel: vscode.WebviewPanel
    ) {
        const workspaceFolderUri = getWorkSpaceUri();
        if (!workspaceFolderUri) {
            throw new Error("Workspace folder not found.");
        }
        const dictionaryUri = vscode.Uri.joinPath(
            workspaceFolderUri,
            "files",
            "project.dictionary"
        );

        const content = dictionary.entries
            .map((entry) => JSON.stringify(ensureCompleteEntry(entry)))
            .join("\n");

        await vscode.workspace.fs.writeFile(dictionaryUri, Buffer.from(content, "utf-8"));

        // After updating the file, refresh the editor
        await this.refreshEditor(webviewPanel);
    }

    private async refreshEditor(webviewPanel: vscode.WebviewPanel) {
        if (this.document) {
            try {
                const workspaceFolderUri = getWorkSpaceUri();
                if (!workspaceFolderUri) {
                    throw new Error("Workspace folder not found.");
                }
                const dictionaryUri = vscode.Uri.joinPath(
                    workspaceFolderUri,
                    "files",
                    "project.dictionary"
                );
                const fileContent = await vscode.workspace.fs.readFile(dictionaryUri);
                const content = new TextDecoder().decode(fileContent);
                
                // Parse the file content
                const newEntries = this.parseEntriesFromJsonl(content);
                
                // Compare with current entries
                if (!this.areEntriesEqual(this.document.content.entries, newEntries)) {
                    // Update only if there are changes
                    this.document.content.entries = newEntries;

                    // Notify the webview of the updated content
                    webviewPanel.webview.postMessage({
                        command: "providerTellsWebviewToUpdateData",
                        data: this.document.content,
                    } as DictionaryReceiveMessages);

                    this.onDidChangeCustomDocument.fire({
                        document: this.document,
                        undo: () => {
                            // Implement undo logic if needed
                        },
                        redo: () => {
                            // Implement redo logic if needed
                        },
                    });
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
        return entries1.every((entry, index) => 
            JSON.stringify(entry) === JSON.stringify(entries2[index])
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
}
