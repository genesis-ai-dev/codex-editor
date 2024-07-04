import * as vscode from "vscode";
import { getUri } from "./utilities/getUri";
import { getNonce } from "./utilities/getNonce";
import { FileHandler } from './utilities/FileHandler';
import { Dictionary } from "codex-types";
import { DictionaryPostMessages } from "../../../types";
import { PythonMessenger } from "../../utils/pyglsMessenger";

// Dictionary path constant
const dictionaryPath = ".project/project.dictionary";

export class DictionarySidePanel implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    public static readonly viewType = "dictionaryTable";
    private extensionUri: vscode.Uri;

    constructor(extensionUri: vscode.Uri) {
        this.extensionUri = extensionUri;
        this.setupFileChangeListener();

        // Register the command (from DictionaryTablePanel) to update entry count
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
                console.log("Dictionary file changed, updating webview data...");
                this.updateWebviewData();
            }
        });
    }

    private async updateWebviewData() {
        try {
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

            // Get glosser info and counts
            const pythonMessenger = new PythonMessenger();

            console.log("Fetching glosser info...");
            const glosserInfo = await pythonMessenger.getGlosserInfo();
            console.log("Glosser info fetched:", glosserInfo);

            console.log("Fetching glosser counts...");
            const glosserCounts = await pythonMessenger.getGlosserCounts();
            console.log("Glosser counts fetched:", glosserCounts);

            this._view?.webview.postMessage({
                command: "sendGlosserData",
                data: {
                    glosserInfo,
                    glosserCounts
                },
            } as DictionaryPostMessages);
        } catch (error) {
            console.error("Error in updateWebviewData:", error);
            vscode.window.showErrorMessage(`Error updating webview data: ${error}`);
        }
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

            // Update webview data when the view is resolved
            await this.updateWebviewData();
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
