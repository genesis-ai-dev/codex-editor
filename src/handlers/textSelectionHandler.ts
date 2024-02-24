import * as vscode from 'vscode';
import { updateGlobalState } from "../globalState";
import { extractVerseRefFromLine } from "../utils/verseRefUtils";

export async function checkServerHeartbeat(context: vscode.ExtensionContext) {
    try {
        const response = await fetch('http://localhost:5554/heartbeat');
        if (!response.ok) {
            throw new Error('Server not responding');
        }
        const data = await response.json();
        console.log('Server heartbeat:', data);
        // Check if the databases field is blank, indicating the server needs to be started
        if (data.databases === "") {
            const dataPath = vscode.workspace.workspaceFolders?.[0]?.uri.toString();
            if (dataPath) {
                vscode.window.showInformationMessage('Server databases are empty. Attempting to start the server with data path: ' + dataPath);
                await fetch(`http://localhost:5554/start?data_path=${encodeURIComponent(dataPath)}`, { method: 'GET' });
            } else {
                console.error('No workspace folder found to start the server with.');
            }
        }
    } catch (error) {
        console.error('Error checking server heartbeat:', error);
    }
}

export function registerTextSelectionHandler(context: vscode.ExtensionContext, callback: CallableFunction): any {
    let selectionTimeout: ReturnType<typeof setTimeout> | undefined;
    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(async (event: vscode.TextEditorSelectionChangeEvent) => {
        const activeEditor = vscode.window.activeTextEditor;

        if (activeEditor) {
            const currentLine = activeEditor.document.lineAt(
                event.selections[0].active,
            );
            const completeLineContent =
                currentLine.text;
            const currentLineVref = extractVerseRefFromLine(completeLineContent);
            const currentLineSelection = event.textEditor.document.getText(event.selections[0]);
            // FIXME: somethings wrong with the type or the values here.. otherwise why duplicate like this?
            const selectedText: string = event.textEditor.document.getText(event.selections[0]);
            // Update global state with the selected line content
            updateGlobalState(context, {
                key: "currentLineSelection",
                value: {
                    selection: currentLineSelection,
                    completeLineContent,
                    vrefAtStartOfLine: currentLineVref,
                    selectedText: selectedText,
                }
            });
        }

        if (selectionTimeout) {
            clearTimeout(selectionTimeout);
        }
        selectionTimeout = setTimeout(async () => {
            const selectedText: string = event.textEditor.document.getText(event.selections[0]);
            if (selectedText) {
                vscode.commands.executeCommand("pygls.server.textSelected", selectedText);
                // Perform the search using the selected text
                fetch(`http://localhost:5554/searchboth?&query=${encodeURIComponent(selectedText)}&limit=10`)
                    .then((response: Response) => response.json())
                    .then((data: any) => {
                        callback(data);
                    })
                    .catch((error: any) => {
                        console.error('Error performing search:', error);
                        vscode.window.showErrorMessage(error.toString());
                    });
            }
        }, 500); // Adjust delay as needed
    }));
}