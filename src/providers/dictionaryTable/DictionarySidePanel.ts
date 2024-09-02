import * as vscode from "vscode";
import { getUri } from "./utilities/getUri";
import { getNonce } from "./utilities/getNonce";
import { FileHandler } from './utilities/FileHandler';
import { Dictionary } from "codex-types";
import { DictionaryPostMessages } from "../../../types";
import path from "path";

// Dictionary path constant
const dictionaryPath = path.join('files', 'project.dictionary');

export class DictionarySidePanel implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    public static readonly viewType = "dictionaryTable";
    private extensionUri: vscode.Uri;

    constructor(extensionUri: vscode.Uri) {
        this.extensionUri = extensionUri;
        this.setupFileChangeListener();

        // Register the command to update entry count
        vscode.commands.registerCommand('dictionaryTable.updateEntryCount', (count: number) => {
            this._view?.webview.postMessage({
                command: "updateEntryCount",
                count: count,
            } as DictionaryPostMessages);
        });
    }

    private setupFileChangeListener() {
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document.uri.path.endsWith(dictionaryPath)) {
                this.updateWebviewData();
            }
        });
    }

    private async updateWebviewData() {
        const { data } = await FileHandler.readFile(dictionaryPath);
        let dictionary: Dictionary;
        if (!data) {
            dictionary = {
                id: '',
                label: '',
                entries: [],
                metadata: {},
            };
        } else {
            dictionary = JSON.parse(data);
        }
        this._view?.webview.postMessage({
            command: "sendData",
            data: dictionary,
        } as DictionaryPostMessages);

        const wordFrequencies = await vscode.commands.executeCommand('translators-copilot.getWordFrequencies');
        this._view?.webview.postMessage({
            command: "updateWordFrequencies",
            wordFrequencies: wordFrequencies,
        } as DictionaryPostMessages);

        // Update frequent words
        const frequentWords = await vscode.commands.executeCommand('translators-copilot.getWordsAboveThreshold'); // Adjust threshold as needed
        this._view?.webview.postMessage({
            command: "updateFrequentWords",
            words: frequentWords,
        } as DictionaryPostMessages);
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        token: vscode.CancellationToken,
    ): void | Thenable<void> {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };

        webviewView.webview.html = this.getWebviewContent(webviewView.webview);
        this.setWebviewMessageListener(webviewView.webview);
        this.updateWebviewData();
    }

    private getWebviewContent(webview: vscode.Webview): string {
        const stylesUri = getUri(webview, this.extensionUri, [
            "webviews",
            "dictionary-side-panel",
            "dist",
            "assets",
            "index.css",
        ]);
        const scriptUri = getUri(webview, this.extensionUri, [
            "webviews",
            "dictionary-side-panel",
            "dist",
            "assets",
            "index.js",
        ]);
        const nonce = getNonce();

        return `
          <!DOCTYPE html>
          <html lang="en">
          <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}'; style-src ${webview.cspSource};">
              <link href="${stylesUri}" rel="stylesheet">
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
            async (message) => {
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
                        this.updateWebviewData();
                        return;
                    }
                    case "addFrequentWordsToDictionary": {
                        const words = message.words;
                        const spellChecker = new SpellChecker(vscode.workspace.workspaceFolders![0].uri.fsPath);
                        for (const word of words) {
                            await spellChecker.addToDictionary(word);
                        }
                        vscode.window.showInformationMessage(`Added ${words.length} words to the dictionary.`);
                        this.updateWebviewData();
                        return;
                    }
                }
            },
            undefined,
            [],
        );
    }
}

// You'll need to import or define the SpellChecker class
class SpellChecker {
    constructor(private workspaceFolder: string) { }

    async addToDictionary(word: string): Promise<void> {
        // Implement logic to add word to dictionary
        // This should be consistent with your existing SpellChecker implementation
    }
}
