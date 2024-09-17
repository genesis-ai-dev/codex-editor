import * as vscode from "vscode";
import { getUri } from "./utilities/getUri";
import { getNonce } from "./utilities/getNonce";
import { FileHandler } from './utilities/FileHandler';
import { Dictionary } from "codex-types";
import { DictionaryPostMessages } from "../../../types";

// Dictionary path constant

const dictionaryPath = "files/project.dictionary";

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
        const frequentWords = await vscode.commands.executeCommand('translators-copilot.getWordsAboveThreshold');
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
        const stylesUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this.extensionUri,
                "webviews",
                "codex-webviews",
                "dist",
                "DictionarySidePanel",
                "index.css"
            )
        );
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
            <link href="${stylesUri}" rel="stylesheet" />
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
                        // Refresh the word index
                        await vscode.commands.executeCommand('translators-copilot.refreshWordIndex');
                        // Update the webview data
                        await this.updateWebviewData();
                        return;
                    }
                    case "addFrequentWordsToDictionary": {
                        const words = message.words;
                        for (const word of words) {
                            await vscode.commands.executeCommand('spellcheck.addToDictionary', word);
                        }
                        vscode.window.showInformationMessage(`Added ${words.length} words to the dictionary.`);

                        // Refresh the word index
                        await vscode.commands.executeCommand('translators-copilot.refreshWordIndex');

                        // Update the webview data
                        await this.updateWebviewData();
                        return;
                    }
                }
            },
            undefined,
            [],
        );
    }
}
