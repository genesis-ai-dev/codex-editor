import * as path from "path";
import * as vscode from "vscode";
import bibleData from "../../../webviews/codex-webviews/src/assets/bible-books-lookup.json";
import { readCodexNotebookFromUri } from "../../exportHandler/exportHandlerUtils";
import { collectMilestonesWithFootnotes } from "../../../sharedUtils/footnoteListCollect";
import type { FootnoteListFile, FootnotesListMessageFromWebview } from "../../../types";
import { jumpToCellInNotebook } from "../../utils";
import { normalizeCorpusMarker } from "../../utils/corpusMarkerUtils";
import { openCodexDocumentWithSourcePair } from "../../utils/openCodexDocumentWithSourcePair";
import { safePostMessageToPanel } from "../../utils/webviewUtils";

type BookLookupEntry = { abbr: string; ord?: string; testament?: string };

const bookByAbbr = new Map(
    (bibleData as BookLookupEntry[]).map((book) => [book.abbr, book])
);

/**
 * Same top-to-bottom order as the project file list: Old Testament, New
 * Testament, then any other groups, with each book in its project position.
 */
function compareProjectFileOrder(
    a: { corpus: string; ord: string; label: string },
    b: { corpus: string; ord: string; label: string }
): number {
    const rank = (corpus: string) => {
        if (corpus === "OT") return 0;
        if (corpus === "NT") return 1;
        if (corpus) return 2;
        return 3;
    };
    const rankDiff = rank(a.corpus) - rank(b.corpus);
    if (rankDiff !== 0) return rankDiff;
    if (a.corpus !== b.corpus) return a.corpus.localeCompare(b.corpus);
    if (a.ord && b.ord) return a.ord.localeCompare(b.ord);
    if (a.ord) return -1;
    if (b.ord) return 1;
    return a.label.localeCompare(b.label);
}

let activePanel: vscode.WebviewPanel | undefined;

function tabUri(tab: vscode.Tab): vscode.Uri | undefined {
    const input = tab.input;
    if (input && typeof input === "object" && "uri" in input) {
        const uri = (input as { uri?: vscode.Uri }).uri;
        if (uri instanceof vscode.Uri) {
            return uri;
        }
    }
    return undefined;
}

/** True when both a source notebook and a target notebook are already open. */
function hasOpenSourceAndTarget(): boolean {
    let hasSource = false;
    let hasTarget = false;
    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            const uri = tabUri(tab);
            if (!uri) continue;
            const normalized = uri.fsPath.replace(/\\/g, "/").toLowerCase();
            if (normalized.endsWith(".source")) {
                hasSource = true;
            } else if (normalized.endsWith(".codex")) {
                hasTarget = true;
            }
        }
    }
    return hasSource && hasTarget;
}

/**
 * Footnotes sit in the row below the editors.
 * With source and target open, that top row is two columns.
 * Otherwise the top stays a single window.
 * orientation 1 stacks rows; orientation 0 places groups beside each other.
 */
async function applyFootnotesLayout(splitTop: boolean): Promise<void> {
    if (splitTop) {
        await vscode.commands.executeCommand("vscode.setEditorLayout", {
            orientation: 1,
            groups: [
                {
                    orientation: 0,
                    groups: [{}, {}],
                    size: 0.65,
                },
                { size: 0.35 },
            ],
        });
        return;
    }

    await vscode.commands.executeCommand("vscode.setEditorLayout", {
        orientation: 1,
        groups: [{ size: 0.65 }, { size: 0.35 }],
    });
}

function footnotesViewColumn(splitTop: boolean): vscode.ViewColumn {
    return splitTop ? vscode.ViewColumn.Three : vscode.ViewColumn.Two;
}

async function loadProjectFootnotes(): Promise<FootnoteListFile[]> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        return [];
    }

    const uris = await vscode.workspace.findFiles("files/target/**/*.codex");

    const files: { file: FootnoteListFile; corpus: string; ord: string; label: string }[] = [];
    for (const uri of uris) {
        try {
            const notebook = await readCodexNotebookFromUri(uri);
            const milestones = collectMilestonesWithFootnotes(notebook.cells);
            if (milestones.length === 0) {
                continue;
            }
            const abbr = path.basename(uri.fsPath, ".codex");
            const book = bookByAbbr.get(abbr);
            const fileName = notebook.metadata?.fileDisplayName?.trim() || abbr;
            const corpus =
                normalizeCorpusMarker(notebook.metadata?.corpusMarker) ||
                normalizeCorpusMarker(book?.testament) ||
                "";
            files.push({
                file: {
                    fileName,
                    uri: uri.toString(),
                    textDirection: notebook.metadata?.textDirection === "rtl" ? "rtl" : "ltr",
                    milestones,
                },
                corpus,
                ord: book?.ord || "",
                label: fileName,
            });
        } catch (error) {
            console.warn("[FootnotesList] Skipping", uri.fsPath, error);
        }
    }

    files.sort((a, b) => compareProjectFileOrder(a, b));
    return files.map((entry) => entry.file);
}

function getHtml(panel: vscode.WebviewPanel, extensionUri: vscode.Uri): string {
    const scriptUri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(
            extensionUri,
            "webviews",
            "codex-webviews",
            "dist",
            "FootnotesList",
            "index.js"
        )
    );
    const codiconsUri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, "node_modules", "@vscode", "codicons", "dist", "codicon.css")
    );
    const nonce = Math.random().toString(36).slice(2);

    return `<!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="img-src https: data:; style-src 'unsafe-inline' ${panel.webview.cspSource}; script-src 'nonce-${nonce}';">
        <link href="${codiconsUri}" rel="stylesheet">
      </head>
      <body>
        <div id="root"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
    </html>`;
}

async function sendFootnotes(panel: vscode.WebviewPanel): Promise<void> {
    try {
        const files = await loadProjectFootnotes();
        safePostMessageToPanel(panel, { command: "footnotes", files }, "FootnotesList");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        safePostMessageToPanel(
            panel,
            { command: "footnotesError", message },
            "FootnotesList"
        );
    }
}

async function openFootnote(
    context: vscode.ExtensionContext,
    uriString: string,
    cellId: string
): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const codexUri = vscode.Uri.parse(uriString);
    // With only the list open, column Two is the footnotes pane. Open the
    // target beside the top group so it does not split that pane.
    const topIsSplit = hasOpenSourceAndTarget();
    await openCodexDocumentWithSourcePair(
        codexUri,
        folder?.uri,
        topIsSplit ? undefined : { openTargetBesideTopGroup: true }
    );
    await jumpToCellInNotebook(context, codexUri.fsPath, cellId);
    await applyFootnotesLayout(true);
    if (activePanel) {
        activePanel.reveal(vscode.ViewColumn.Three, true);
    }
}

export async function openFootnotesList(context: vscode.ExtensionContext): Promise<void> {
    const splitTop = hasOpenSourceAndTarget();
    await applyFootnotesLayout(splitTop);
    const viewColumn = footnotesViewColumn(splitTop);

    if (activePanel) {
        activePanel.reveal(viewColumn, false);
        await sendFootnotes(activePanel);
        return;
    }

    const extensionUri = vscode.extensions.getExtension(
        "project-accelerate.codex-editor-extension"
    )!.extensionUri;

    const panel = vscode.window.createWebviewPanel(
        "footnotesList",
        "Footnotes List",
        viewColumn,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [extensionUri],
        }
    );
    activePanel = panel;
    panel.onDidDispose(() => {
        if (activePanel === panel) {
            activePanel = undefined;
        }
    });

    panel.webview.html = getHtml(panel, extensionUri);
    panel.webview.onDidReceiveMessage(async (message: FootnotesListMessageFromWebview) => {
        if (message.command === "webviewReady") {
            await sendFootnotes(panel);
            return;
        }
        if (message.command === "openFootnote") {
            try {
                await openFootnote(context, message.uri, message.cellId);
            } catch (error) {
                const text = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Could not open footnote: ${text}`);
            }
        }
    });

    await sendFootnotes(panel);
}
