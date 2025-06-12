import * as vscode from "vscode";
import { getNonce } from "../providers/dictionaryTable/utilities/getNonce";

interface WebviewTemplateOptions {
    title?: string;
    scriptPath: string[];
    csp?: string;
    initialData?: any;
    inlineStyles?: string;
    customScript?: string;
}

export function getWebviewHtml(
    webview: vscode.Webview,
    context: vscode.ExtensionContext,
    options: WebviewTemplateOptions
): string {
    const styleResetUri = webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, "src", "assets", "reset.css")
    );
    const styleVSCodeUri = webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, "src", "assets", "vscode.css")
    );
    const codiconsUri = webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, "node_modules", "@vscode/codicons", "dist", "codicon.css")
    );
    const scriptUri = webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, "webviews", "codex-webviews", "dist", ...options.scriptPath)
    );

    const nonce = getNonce();
    const csp = (options.csp || `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-\${nonce}'; img-src ${webview.cspSource} https:; font-src ${webview.cspSource};`).replace(/\$\{nonce\}/g, nonce);

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <link href="${styleResetUri}" rel="stylesheet" nonce="${nonce}">
    <link href="${styleVSCodeUri}" rel="stylesheet" nonce="${nonce}">
    <link href="${codiconsUri}" rel="stylesheet" nonce="${nonce}">
    <title>${options.title || "Codex"}</title>
    ${options.inlineStyles ? `<style>${options.inlineStyles}</style>` : ""}
</head>
<body>
    <div id="root"></div>
    ${options.initialData ? `<script nonce="${nonce}">window.initialData = ${JSON.stringify(options.initialData)};</script>` : ""}
    ${options.customScript ? `<script nonce="${nonce}">${options.customScript}</script>` : ""}
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
} 