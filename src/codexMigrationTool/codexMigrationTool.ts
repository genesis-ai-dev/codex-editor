import * as vscode from "vscode";
import * as path from "path";
import { getNonce } from "../providers/dictionaryTable/utilities/getNonce";
import { safePostMessageToPanel } from "../utils/webviewUtils";
import { matchMigrationCells } from "./matcher";
import { applyMigrationToTargetFile } from "./updater";
import { getSQLiteIndexManager } from "../activationHelpers/contextAware/contentIndexes/indexes/sqliteIndexManager";
import type { FileData } from "../activationHelpers/contextAware/contentIndexes/indexes/fileReaders";
import type { MigrationMatchResult, MigrationRunConfig, SourceFileUIData } from "./types";

const DEBUG_MODE = false;
const debug = (message: string, ...args: any[]) => {
    if (DEBUG_MODE) {
        console.log(`[CodexMigrationTool] ${message}`, ...args);
    }
};

async function getHtmlForCodexMigrationToolView(
    webview: vscode.Webview,
    context: vscode.ExtensionContext
): Promise<string> {
    const distPath = vscode.Uri.joinPath(
        context.extensionUri,
        "webviews",
        "codex-webviews",
        "dist",
        "CodexMigrationToolView"
    );
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distPath, "index.js"));
    const styleResetUri = webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, "src", "assets", "reset.css")
    );
    const codiconsUri = webview.asWebviewUri(
        vscode.Uri.joinPath(
            context.extensionUri,
            "node_modules",
            "@vscode/codicons",
            "dist",
            "codicon.css"
        )
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none';
                img-src ${webview.cspSource} https: data:;
                style-src ${webview.cspSource} 'unsafe-inline';
                script-src 'nonce-${nonce}';
                font-src ${webview.cspSource};">
            <link href="${styleResetUri}" rel="stylesheet">
            <link href="${codiconsUri}" rel="stylesheet">
            <script nonce="${nonce}">
                const vscode = acquireVsCodeApi();
            </script>
        </head>
        <body>
            <div id="root"></div>
            <script nonce="${nonce}" src="${scriptUri}"></script>
        </body>
        </html>`;
}

async function loadSourceAndTargetFiles(): Promise<{
    sourceFiles: FileData[];
    targetFiles: FileData[];
}> {
    const { readSourceAndTargetFiles } = await import(
        "../activationHelpers/contextAware/contentIndexes/indexes/fileReaders"
    );
    return readSourceAndTargetFiles();
}

const findSourceFileForTarget = (targetPath: string, sourceFiles: FileData[]): FileData | undefined => {
    const targetName = path.basename(targetPath).replace(/\.codex$/i, "");
    return sourceFiles.find((sourceFile) => {
        const sourceName = path.basename(sourceFile.uri.fsPath).replace(/\.source$/i, "");
        return sourceName === targetName;
    });
};

const mapTargetFilesToUi = (targetFiles: FileData[]): SourceFileUIData[] => {
    return targetFiles.map((file) => ({
        path: file.uri.fsPath,
        id: file.id,
        name: path.basename(file.uri.fsPath),
    }));
};

export async function openCodexMigrationTool(context: vscode.ExtensionContext) {
    const panel = vscode.window.createWebviewPanel(
        "codexMigrationTool",
        "Codex Migration Tool",
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
                context.extensionUri,
                vscode.Uri.joinPath(context.extensionUri, "webviews", "codex-webviews", "dist"),
            ],
        }
    );

    context.subscriptions.push(panel);
    let disposables: vscode.Disposable[] = [];

    panel.webview.html = await getHtmlForCodexMigrationToolView(panel.webview, context);

    const messageListener = panel.webview.onDidReceiveMessage(async (message) => {
        debug("Received message:", message);
        switch (message.command) {
            case "requestInitialData":
                try {
                    safePostMessageToPanel(panel, { command: "setLoading", isLoading: true });
                    const { targetFiles } = await loadSourceAndTargetFiles();
                    safePostMessageToPanel(panel, {
                        command: "initialData",
                        targetFiles: mapTargetFilesToUi(targetFiles),
                    });
                } catch (error: any) {
                    safePostMessageToPanel(panel, {
                        command: "showError",
                        error: `Failed to load project files: ${error.message}`,
                    });
                } finally {
                    safePostMessageToPanel(panel, { command: "setLoading", isLoading: false });
                }
                break;
            case "runMigration":
                try {
                    safePostMessageToPanel(panel, { command: "setLoading", isLoading: true });
                    const { data } = message as { data: MigrationRunConfig; };
                    if (!data?.fromFilePath || !data?.toFilePath) {
                        safePostMessageToPanel(panel, {
                            command: "showError",
                            error: "Please select both source and target codex files.",
                        });
                        break;
                    }
                    if (data.fromFilePath === data.toFilePath) {
                        safePostMessageToPanel(panel, {
                            command: "showError",
                            error: "Please select two different codex files.",
                        });
                        break;
                    }

                    const { sourceFiles, targetFiles } = await loadSourceAndTargetFiles();
                    const fromTargetFile = targetFiles.find(
                        (file) => file.uri.fsPath === data.fromFilePath
                    );
                    const toTargetFile = targetFiles.find(
                        (file) => file.uri.fsPath === data.toFilePath
                    );
                    if (!fromTargetFile || !toTargetFile) {
                        safePostMessageToPanel(panel, {
                            command: "showError",
                            error: "Selected files were not found in the project.",
                        });
                        break;
                    }

                    const fromSourceFile = findSourceFileForTarget(
                        fromTargetFile.uri.fsPath,
                        sourceFiles
                    );
                    const toSourceFile = findSourceFileForTarget(
                        toTargetFile.uri.fsPath,
                        sourceFiles
                    );

                    const sqliteManager = getSQLiteIndexManager();
                    const matches: MigrationMatchResult[] = await matchMigrationCells({
                        fromTargetFile,
                        toTargetFile,
                        fromSourceFile,
                        toSourceFile,
                        matchMode: data.matchMode,
                        sqliteManager,
                        fromStartLine: data.fromStartLine,
                        toStartLine: data.toStartLine,
                        maxCells: data.maxCells,
                    });

                    const { updated, skipped } = await applyMigrationToTargetFile({
                        fromFileUri: fromTargetFile.uri,
                        toFileUri: toTargetFile.uri,
                        matches,
                        forceOverride: data.forceOverride,
                    });

                    safePostMessageToPanel(panel, {
                        command: "migrationResults",
                        summary: { matched: updated, skipped },
                        results: matches,
                    });
                } catch (error: any) {
                    console.error("Migration error:", error);
                    safePostMessageToPanel(panel, {
                        command: "showError",
                        error: `Migration failed: ${error.message}`,
                    });
                } finally {
                    safePostMessageToPanel(panel, { command: "setLoading", isLoading: false });
                }
                break;
            case "cancel":
                panel.dispose();
                break;
            case "logError":
                console.error("[CodexMigrationToolView Error]:", message.message);
                break;
            default:
                console.warn(`Unhandled message: ${message.command}`);
                break;
        }
    });

    disposables.push(messageListener);
    panel.onDidDispose(
        () => {
            disposables.forEach((d) => d.dispose());
            disposables = [];
        },
        null,
        context.subscriptions
    );
}
