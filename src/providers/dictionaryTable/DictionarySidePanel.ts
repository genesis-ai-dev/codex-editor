import * as vscode from "vscode";
import { getUri } from "./utilities/getUri";
import { getNonce } from "./utilities/getNonce";
import { FileHandler } from './utilities/FileHandler';
import { Dictionary } from "codex-types";
import { DictionaryPostMessages } from "../../../types";

// Dictionary path constant
const dictionaryPath = ".project/project.dictionary";

export class DictionarySidePanel implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    public static readonly viewType = "dictionaryTable";
    private extensionUri: vscode.Uri;

    constructor(extensionUri: vscode.Uri) {
        this.extensionUri = extensionUri;
        this.setupFileChangeListener();
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
            // Create an empty dictionary
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
    }

    // private async updateWebviewData() {
    //     const { data } = await FileHandler.readFile(dictionaryPath);
    //     if (!data) return;
    //     const dictionary: Dictionary = JSON.parse(data);
    //     this._view?.webview.postMessage({
    //         command: "sendData",
    //         data: dictionary,
    //     } as DictionaryPostMessages);
    // }

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

        const initAsync = async () => {
            const { data, uri } = await FileHandler.readFile(dictionaryPath);
            let dictionary: Dictionary;
            if (!data) {
                // Create an empty dictionary
                dictionary = {
                    id: '',
                    label: '',
                    entries: [],
                    metadata: {},
                };
            } else {
                dictionary = JSON.parse(data);
            }

            // Set the HTML content for the webview panel
            webviewView.webview.html = this.getWebviewContent(
                webviewView.webview,
            );

            // Set an event listener to listen for messages passed from the webview context
            this.setWebviewMessageListener(
                webviewView.webview,
                this.extensionUri,
            );

            // // Post message to app
            // webviewView.webview.postMessage({ command: "sendData", data: dictionary });
            // console.log('Dictionary data sent to side panel');
        };
        initAsync().catch(console.error);
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

    private setWebviewMessageListener(
        webview: vscode.Webview,
        uri: vscode.Uri,
    ) {
        webview.onDidReceiveMessage(
            async (message) => {
                const data = message.data;
                switch (message.command) {
                    case "dataReceived":
                        // Code that should run in response to the hello message command
                        // vscode.window.showInformationMessage(data);
                        return;
                    case "updateData": {
                        this.updateWebviewData();
                        return;
                    }
                    case "showDictionaryTable": {
                        vscode.commands
                            .executeCommand(
                                "dictionaryTable.showDictionaryTable",
                            )
                            .then(
                                () => {
                                    console.log(
                                        "Dictionary Table webview displayed",
                                    );
                                },
                                (err) => {
                                    console.error(err);
                                },
                            );
                        return;
                    }
                }
            },
            undefined,
            [],
        );
    }
}
