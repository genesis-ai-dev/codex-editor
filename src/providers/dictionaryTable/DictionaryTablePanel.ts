import {
    Disposable,
    Webview,
    WebviewPanel,
    window,
    Uri,
    ViewColumn,
} from "vscode";
import { getUri } from "./utilities/getUri";
import { getNonce } from "./utilities/getNonce";
import { FileHandler } from './utilities/FileHandler';
import * as vscode from "vscode";
import { Dictionary } from "codex-types";
import { DictionaryPostMessages } from "../../../types";

export class DictionaryTablePanel {
    public static currentPanel: DictionaryTablePanel | undefined;
    private readonly _panel: WebviewPanel;
    private _disposables: Disposable[] = [];

    /**
     * The HelloWorldPanel class private constructor (called only from the render method).
     *
     * @param panel A reference to the webview panel
     * @param extensionUri The URI of the directory containing the extension
     */
    private constructor(panel: WebviewPanel, extensionUri: Uri) {
        this._panel = panel;

        const initAsync = async () => {
            const { data, uri } = await FileHandler.readFile(
                ".project/project.dictionary",
            );
            // return if no data
            let dictionary: Dictionary;
            if (!data) {
                // Create a dictionary with default entries
                dictionary = {
                    id: "",
                    label: "",
                    entries: [{
                        id: "",
                        headForm: "",
                        variantForms: [],
                        definition: "",
                        translationEquivalents: [],
                        links: [],
                        linkedEntries: [],
                        metadata: {},
                        notes: [],
                    }],
                    metadata: {},
                };
            } else {
                dictionary = JSON.parse(data);
            }
            console.log("Parsed dictionary:", dictionary);

            // Set the HTML content for the webview panel
            this._panel.webview.html = this._getWebviewContent(
                this._panel.webview,
                extensionUri,
            );

            // Set an event listener to listen for messages passed from the webview context
            this._setWebviewMessageListener(this._panel.webview, uri);

            // Post message to app
            this._panel.webview.postMessage({
                command: "sendData",
                data: dictionary,
            } as DictionaryPostMessages);
        };

        initAsync().catch(console.error);

        // Set an event listener to listen for when the panel is disposed (i.e. when the user closes
        // the panel or when the panel is closed programmatically)
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    /*
     * @param extensionUri The URI of the directory containing the extension.
     */
    public static render(extensionUri: Uri): DictionaryTablePanel {
        if (DictionaryTablePanel.currentPanel) {
            // If the webview panel already exists reveal it
            DictionaryTablePanel.currentPanel._panel.reveal(ViewColumn.One);
        } else {
            // If a webview panel does not already exist create and show a new one
            const panel = window.createWebviewPanel(
                // Panel view type
                // "showDictionaryTable",
                "dictionary-table",
                // Panel title
                "Dictionary Table",
                // The editor column the panel should be displayed in
                ViewColumn.One,
                // Extra panel configurations
                {
                    // Enable JavaScript in the webview
                    enableScripts: true,
                    // Restrict the webview to only load resources from the `out` and `webview-ui/build` directories
                    localResourceRoots: [
                        Uri.joinPath(extensionUri, "out"),
                        Uri.joinPath(
                            extensionUri,
                            "webviews/editable-react-table/dist",
                        ),
                    ],
                },
            );

            DictionaryTablePanel.currentPanel = new DictionaryTablePanel(
                panel,
                extensionUri,
            );
        }
        return DictionaryTablePanel.currentPanel;
    }

    public static createOrShow(
        documentUri: vscode.Uri,
        extensionUri: vscode.Uri,
        webviewPanel?: vscode.WebviewPanel,
    ): DictionaryTablePanel {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;
        if (DictionaryTablePanel.currentPanel) {
            DictionaryTablePanel.currentPanel._panel.reveal(column);
            return DictionaryTablePanel.currentPanel;
        }
        const panel =
            webviewPanel ||
            vscode.window.createWebviewPanel(
                "dictionary-table",
                "Dictionary Table",
                column || vscode.ViewColumn.One,
                { enableScripts: true },
            );
        return new DictionaryTablePanel(panel, extensionUri);
    }

    /**
     * Cleans up and disposes of webview resources when the webview panel is closed.
     */
    public dispose() {
        DictionaryTablePanel.currentPanel = undefined;

        // Dispose of the current webview panel
        this._panel.dispose();

        // Dispose of all disposables (i.e. commands) for the current webview panel
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }

    /**
     * Defines and returns the HTML that should be rendered within the webview panel.
     *
     * @remarks This is also the place where references to the React webview build files
     * are created and inserted into the webview HTML.
     *
     * @param webview A reference to the extension webview
     * @param extensionUri The URI of the directory containing the extension
     * @returns A template string literal containing the HTML that should be
     * rendered within the webview panel
     */
    private _getWebviewContent(webview: Webview, extensionUri: Uri) {
        // The CSS file from the React build output
        const stylesUri = getUri(webview, extensionUri, [
            "webviews",
            "editable-react-table",
            "dist",
            "assets",
            "index.css",
        ]);
        // The JS file from the React build output
        const scriptUri = getUri(webview, extensionUri, [
            "webviews",
            "editable-react-table",
            "dist",
            "assets",
            "index.js",
        ]);

        const nonce = getNonce();

        // Tip: Install the es6-string-html VS Code extension to enable code highlighting below
        // window.initialData = ${JSON.stringify(data)};

        return /*html*/ `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
          <link rel="stylesheet" type="text/css" href="${stylesUri}">
          <title>Dictionary Table</title>
        </head>
        <body>
          <div id="root"></div>
          <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
        </body>
      </html>
    `;
    }

    /**
     * Sets up an event listener to listen for messages passed from the webview context and
     * executes code based on the message that is recieved.
     *
     * @param webview A reference to the extension webview
     * @param context A reference to the extension context
     */
    private _setWebviewMessageListener(webview: Webview, uri: any) {
        webview.onDidReceiveMessage(
            async (message: DictionaryPostMessages) => {
                const command = message.command;

                switch (command) {
                    case "updateData": {
                        console.log(
                            "updateData message posted",
                        );
                        const fileData = new TextEncoder().encode(
                            JSON.stringify(message.data),
                        );
                        await vscode.workspace.fs.writeFile(uri, fileData);

                        // Relay the message to the DictionarySidePanel
                        vscode.commands.executeCommand(
                            'dictionaryTable.updateEntryCount',
                            message.data.entries.length
                        );

                        return;
                    }
                    case "confirmRemove": {
                        const confirmed = await window.showInformationMessage(
                            `Are you sure you want to remove ${message.count} item${message.count > 1 ? 's' : ''}?`,
                            { modal: true },
                            "Yes",
                            "No",
                        );
                        if (confirmed === "Yes") {
                            webview.postMessage({
                                command: "removeConfirmed",
                            } as DictionaryPostMessages);
                        }
                        break;
                    }
                }
            },
            undefined,
            this._disposables,
        );
    }
}

