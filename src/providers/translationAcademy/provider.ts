import * as vscode from "vscode";
import { DownloadedResource } from "../obs/resources/types";
import { MessageType } from "../obs/CreateProject/types";
import { getNonce } from "../obs/utilities";

export async function translationAcademy(
    context: vscode.ExtensionContext,
    resource: DownloadedResource,
) {
    let panel: vscode.WebviewPanel | undefined = undefined;
    vscode.window.showInformationMessage("Opening Translation Academy");

    panel = vscode.window.createWebviewPanel(
        "tnAcademy",
        "Translation Academy",
        {
            preserveFocus: true,
            viewColumn: vscode.ViewColumn.Beside,
        },
        {
            enableScripts: true,
        },
    );
    panel.reveal(vscode.ViewColumn.Beside, true);
    const workspaceRootUri = vscode.workspace.workspaceFolders?.[0].uri;

    if (!workspaceRootUri) {
        console.error(
            "No workspace folder found. Please open a folder to store your project in.",
        );
        return;
    }
    const resourceRootUri = vscode.Uri.joinPath(
        workspaceRootUri,
        resource.localPath,
    );

    const resourceFolders =
        await vscode.workspace.fs.readDirectory(resourceRootUri);
    const folderEntries = resourceFolders.filter(
        ([_name, type]) => type === vscode.FileType.Directory,
    );

    // receive message from webview
    panel.webview.onDidReceiveMessage(
        async (message) => {
            switch (message.type) {
                case MessageType.GET_TA_FOLDER_CONTENT: {
                    const directory = message.payload as string;

                    const folderUri = vscode.Uri.joinPath(
                        resourceRootUri,
                        directory,
                    );

                    const folderContents =
                        await vscode.workspace.fs.readDirectory(folderUri);

                    panel?.webview.postMessage({
                        type: MessageType.SYNC_TA_FOLDER_CONTENT,
                        payload: folderContents
                            .filter(
                                ([, type]) =>
                                    type === vscode.FileType.Directory,
                            )
                            .map(([name]) => name),
                    });
                    break;
                }
                case MessageType.GET_TA_CONTENT: {
                    const subDirectory = message.payload.subDirectory as string;
                    const directory = message.payload.directory as string;
                    if (subDirectory === "" || subDirectory === undefined) {
                        vscode.window.showErrorMessage(
                            "Please select a subdirectory",
                        );
                        return;
                    } else if (directory === "" || directory === undefined) {
                        vscode.window.showErrorMessage(
                            "Please select a directory",
                        );
                        return;
                    }
                    const folderUri = vscode.Uri.joinPath(
                        resourceRootUri,
                        directory,
                        subDirectory,
                    );

                    const mdFile = vscode.Uri.joinPath(folderUri, "01.md");

                    const fileContents =
                        await vscode.workspace.fs.readFile(mdFile);

                    const md = fileContents.toString();

                    panel?.webview.postMessage({
                        type: MessageType.SYNC_TA_CONTENT,
                        payload: md,
                    });
                    break;
                }
            }
        },
        undefined,
        context.subscriptions,
    );

    const styleUri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(
            context.extensionUri,
            "webviews",
            "obs",
            "build",
            "assets",
            "index.css",
        ),
    );

    const scriptUri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(
            context.extensionUri,
            "webviews",
            "obs",
            "build",
            "assets",
            "views",
            "MarkdownViewer.js",
        ),
    );

    const nonce = getNonce();

    panel.webview.html = getWebviewContent();
    function getWebviewContent() {
        return `<!DOCTYPE html>
                <html lang="en">
                  <head>
                    <meta charset="UTF-8" />
                    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                    <link href="${styleUri}" type="text/css" rel="stylesheet" />
                    <title>Translation Academy</title>
                  </head>
                  <body>
                    <div id="root"></div>
                    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
                  </body>
                </html>
                `;
    }

    // send message to webview
    panel.onDidChangeViewState(
        (e) => {
            if (e.webviewPanel.active) {
                panel?.webview.postMessage({
                    type: MessageType.SYNC_TA_FOLDERS,
                    payload: folderEntries.map(([name, _type]) => name),
                });
            }
        },
        undefined,
        context.subscriptions,
    );
    panel.onDidDispose(
        () => {
            panel = undefined;
        },
        undefined,
        context.subscriptions,
    );
}
