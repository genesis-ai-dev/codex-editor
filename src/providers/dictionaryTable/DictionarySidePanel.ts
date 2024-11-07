import * as vscode from "vscode";
import { getUri } from "./utilities/getUri";
import { getNonce } from "./utilities/getNonce";
import { FileHandler } from "./utilities/FileHandler";
import { DictionarySummaryPostMessages, Dictionary, DictionaryEntry } from "../../../types";

// Dictionary path constant
const dictionaryPath = vscode.Uri.joinPath(
    vscode.Uri.file(""),
    "files",
    "project.dictionary"
).fsPath;

export class DictionarySummaryProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    public static readonly viewType = "dictionaryTable";
    private extensionUri: vscode.Uri;
    private lastSentDictionary: Dictionary;
    private debounceTimer: NodeJS.Timeout | null = null;
    private lastSentDictionaryHash: string = "";
    private updateInProgress: boolean = false;

    constructor(extensionUri: vscode.Uri) {
        this.extensionUri = extensionUri;
        this.setupFileChangeListener();
        this.lastSentDictionary = {
            id: "",
            label: "",
            entries: [],
            metadata: {},
        };

        // Register the command to update entry count
        vscode.commands.registerCommand("dictionaryTable.updateEntryCount", (count: number) => {
            this._view?.webview.postMessage({
                command: "updateEntryCount",
                count: count,
            } as DictionarySummaryPostMessages);
        });

        // Listen for dictionary updates
        vscode.commands.registerCommand("dictionaryTable.dictionaryUpdated", () => {
            this.refreshDictionary();
        });
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void | Thenable<void> {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };

        webviewView.webview.html = this.getWebviewContent(webviewView.webview);

        this.setWebviewMessageListener(webviewView.webview);

        // Initial update of webview data
        this.updateWebviewData();
    }

    private setupFileChangeListener() {
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document.uri.path.endsWith(dictionaryPath)) {
                this.updateWebviewData();
            }
        });
    }

    private async updateWebviewData() {
        if (this.updateInProgress) {
            return;
        }

        this.updateInProgress = true;

        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(async () => {
            try {
                const { data } = await FileHandler.readFile(dictionaryPath);
                let dictionary: Dictionary;
                if (!data) {
                    dictionary = {
                        id: "",
                        label: "",
                        entries: [],
                        metadata: {},
                    };
                } else {
                    dictionary = this.parseDictionaryData(data);
                }

                const newDictionaryHash = this.hashDictionary(dictionary);

                // Only update if the dictionary has changed
                if (newDictionaryHash !== this.lastSentDictionaryHash) {
                    this.lastSentDictionaryHash = newDictionaryHash;
                    // this._view?.webview.postMessage({
                    //     command: "providerSendsDataToWebview",
                    //     data: dictionary,
                    // } as DictionarySummaryPostMessages);

                    let wordFrequencies;
                    try {
                        wordFrequencies = await vscode.commands.executeCommand(
                            "translators-copilot.getWordFrequencies"
                        );
                    } catch (error) {
                        console.error("Error fetching word frequencies:", error);
                        wordFrequencies = [];
                    }
                    this._view?.webview.postMessage({
                        command: "providerSendsUpdatedWordFrequenciesToWebview",
                        wordFrequencies: wordFrequencies,
                    } as DictionarySummaryPostMessages);

                    // Get frequent words
                    const allFrequentWords = (await vscode.commands.executeCommand(
                        "translators-copilot.getWordsAboveThreshold"
                    )) as string[];

                    // Filter out words that are already in the dictionary
                    const existingWords = new Set(
                        dictionary.entries
                            .filter((entry) => entry && entry.headWord) // Add this filter
                            .map((entry) => entry.headWord.toLowerCase())
                    );
                    const newFrequentWords = allFrequentWords.filter(
                        (word) => word && !existingWords.has(word.toLowerCase())
                    );

                    this._view?.webview.postMessage({
                        command: "providerSendsFrequentWordsToWebview",
                        words: newFrequentWords,
                    } as DictionarySummaryPostMessages);
                }
            } catch (error) {
                console.error("Error updating webview data:", error);
            } finally {
                this.updateInProgress = false;
            }
        }, 300) as unknown as NodeJS.Timeout; // 300ms debounce
    }

    private refreshDictionary() {
        this.updateWebviewData();
    }

    private getWebviewContent(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this.extensionUri,
                "webviews",
                "codex-webviews",
                "dist",
                "DictionarySidePanel",
                "index.js"
            )
        );
        // const stylesUri = webview.asWebviewUri(
        //     vscode.Uri.joinPath(
        //         this.extensionUri,
        //         "webviews",
        //         "codex-webviews",
        //         "dist",
        //         "DictionarySidePanel",
        //         "index.css"
        //     )
        // );
        const codiconsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this.extensionUri,
                "node_modules",
                "@vscode/codicons",
                "dist",
                "codicon.css"
            )
        );

        const nonce = getNonce();

        return `
          <!DOCTYPE html>
          <html lang="en">
          <head>
              <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:; font-src ${webview.cspSource};">
            <link href="${codiconsUri}" rel="stylesheet" />
              <title>Dictionary Table</title>
          </head>
          <body>
              <div id="root"></div>
              <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
          </body>
          </html>
        `;
    }

    private setWebviewMessageListener(webview: vscode.Webview) {
        webview.onDidReceiveMessage(
            async (message: DictionarySummaryPostMessages) => {
                switch (message.command) {
                    case "updateData": {
                        this.updateWebviewData();
                        return;
                    }
                    case "showDictionaryTable": {
                        vscode.commands.executeCommand("dictionaryTable.showDictionaryTable");
                        return;
                    }
                    case "refreshWordFrequency": {
                        vscode.window.showInformationMessage("Refreshing word frequency");
                        // Refresh the word index
                        await vscode.commands.executeCommand(
                            "translators-copilot.refreshWordIndex"
                        );
                        // Update the webview data
                        await this.updateWebviewData();
                        return;
                    }
                    case "addFrequentWordsToDictionary": {
                        await vscode.commands.executeCommand("spellcheck.addWord", message.words);
                        vscode.window.showInformationMessage(
                            `Added ${message.words.length} words to the dictionary.`
                        );

                        // Refresh the word index
                        await vscode.commands.executeCommand(
                            "translators-copilot.refreshWordIndex"
                        );

                        // Update the webview data
                        await this.updateWebviewData();
                        return;
                    }
                }
            },
            undefined,
            []
        );
    }

    private parseDictionaryData(data: string): Dictionary {
        try {
            // Try parsing as JSONL first
            const entries = data
                .split("\n")
                .filter((line) => line.trim().length > 0)
                .map((line, index) => {
                    try {
                        const entry = JSON.parse(line.trim()) as DictionaryEntry;
                        if (!entry.headWord) {
                            console.warn(`Entry at line ${index + 1} is missing headWord:`, entry);
                        }
                        return entry;
                    } catch (e) {
                        console.error(`Failed to parse entry at line ${index + 1}:`, line, e);
                        return null;
                    }
                })
                .filter((entry): entry is DictionaryEntry => entry !== null);
            return {
                id: "",
                label: "",
                entries,
                metadata: {},
            };
        } catch (e: any) {
            console.log("parseDictionaryData ERROR:", e);
            try {
                // If JSONL parsing fails, try parsing as a single JSON object
                const parsed = JSON.parse(data);
                if (Array.isArray(parsed.entries)) {
                    return parsed as Dictionary;
                } else {
                    throw new Error("Invalid JSON format: missing or invalid entries array.");
                }
            } catch (jsonError) {
                console.error("Could not parse dictionary as JSONL or JSON:", jsonError);
                return {
                    id: "",
                    label: "",
                    entries: [],
                    metadata: {},
                };
            }
        }
    }

    private hashDictionary(dictionary: Dictionary): string {
        return JSON.stringify(dictionary.entries.map((entry) => entry.headWord));
    }
}
