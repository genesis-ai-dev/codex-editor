import * as vscode from "vscode";
import { getNonce } from "./getNonce";

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
    // Note: vscode.css was removed in favor of Tailwind CSS in individual webviews
    const codiconsUri = webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, "node_modules", "@vscode/codicons", "dist", "codicon.css")
    );
    const scriptUri = webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, "webviews", "codex-webviews", "dist", ...options.scriptPath)
    );

    const nonce = getNonce();
    const defaultCsp = `default-src 'none'; ` +
        `style-src ${webview.cspSource} 'unsafe-inline'; ` +
        `script-src 'nonce-\${nonce}' 'strict-dynamic' https://static.cloudflareinsights.com; ` +
        `img-src ${webview.cspSource} https: data:; ` +
        `font-src ${webview.cspSource}; ` +
        `worker-src ${webview.cspSource} blob:; ` +
        `connect-src https://*.vscode-cdn.net https://*.frontierrnd.com; ` +
        `media-src ${webview.cspSource} https: blob:;`;
    const csp = (options.csp || defaultCsp).replace(/\$\{nonce\}/g, nonce);

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <link href="${styleResetUri}" rel="stylesheet" nonce="${nonce}">
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