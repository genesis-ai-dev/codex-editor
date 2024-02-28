import { Disposable, Webview, WebviewPanel, Uri } from "vscode";
import { getUri } from "./utilities/getUri";
import { getNonce } from "./utilities/getNonce";

/**
 * This class manages the state and behavior of TranslationNotes webview panels.
 *
 * It contains all the data and methods for:
 *
 * - Creating and rendering TranslationNotes webview panels
 * - Properly cleaning up and disposing of webview resources when the panel is closed
 * - Setting the HTML (and by proxy CSS/JavaScript) content of the webview panel
 * - Setting message listeners so data can be passed between the webview and extension
 */
export class TranslationNotesPanel {
    public static currentPanel: TranslationNotesPanel | undefined;
    private readonly _panel: WebviewPanel;
    private readonly _extensionUri: Uri;
    private _disposables: Disposable[] = [];

    /**
     * The TranslationNotesPanel class private constructor (called only from the render method).
     *
     * @param panel A reference to the webview panel
     * @param extensionUri The URI of the directory containing the extension
     */
    public constructor(
        panel: WebviewPanel,
        extensionUri: Uri,
        messageEventHandlers: (message: any) => void,
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        // Set an event listener to listen for when the panel is disposed (i.e. when the user closes
        // the panel or when the panel is closed programmatically)
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Set an event listener to listen for messages passed from the webview context
        this._setWebviewMessageListener(
            this._panel.webview,
            messageEventHandlers,
        );
    }

    /**
     * Initializes or updates the HTML content of the webview.
     * This is called from within a custom text editor.
     */
    public initializeWebviewContent() {
        const webview = this._panel.webview;
        webview.html = this._getWebviewContent(webview, this._extensionUri);
    }

    /**
     * Cleans up and disposes of webview resources when the webview panel is closed.
     */
    public dispose() {
        TranslationNotesPanel.currentPanel = undefined;

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
        const scriptUri = getUri(webview, extensionUri, [
            "webviews",
            "codex-webviews",
            "dist",
            "TranslationNotesView",
            "index.js",
        ]);
        const stylesUri = getUri(webview, extensionUri, [
            "webviews",
            "codex-webviews",
            "dist",
            "TranslationNotesView",
            "index.css",
        ]);
        const codiconFontUri = getUri(webview, extensionUri, [
            "node_modules",
            "@vscode/codicons",
            "dist",
            "codicon.css",
        ]);

        const nonce = getNonce();

        // Tip: Install the es6-string-html VS Code extension to enable code highlighting below
        return /*html*/ `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource}; style-src 'unsafe-inline' ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <link rel="stylesheet" type="text/css" href="${stylesUri}">
          <title>Translation Notes</title>
          <link href="${codiconFontUri}" rel="stylesheet" />

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
    private _setWebviewMessageListener(
        webview: Webview,
        messageEventHandlers: (message: any) => void,
    ) {
        webview.onDidReceiveMessage(
            messageEventHandlers,
            undefined,
            this._disposables,
        );
    }
}
