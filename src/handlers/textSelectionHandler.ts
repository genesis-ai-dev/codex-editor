import * as vscode from "vscode";
import { extractVerseRefFromLine } from "../utils/verseRefUtils";
import { initializeStateStore } from "../stateStore";

export async function checkServerHeartbeat() {
    try {
        const response = await fetch("http://localhost:5554/heartbeat");
        const dataPath = vscode.workspace.workspaceFolders?.[0]?.uri.toString();
        if (dataPath) {
            await fetch(
                `http://localhost:5554/start?data_path=${encodeURIComponent(
                    dataPath,
                )}`,
                { method: "GET" },
            );
        }
    
        if (!response.ok) {
            throw new Error("Server not responding");
        }
        const data = await response.json();
        console.log("Server heartbeat:", data);
        // Check if the databases field is blank, indicating the server needs to be started
    } catch (error) {
        console.error("Error checking server heartbeat:", error);
    }
}

export function registerTextSelectionHandler(
    context: vscode.ExtensionContext,
    callback: CallableFunction,
): any {
    let selectionTimeout: ReturnType<typeof setTimeout> | undefined;
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(
            async (event: vscode.TextEditorSelectionChangeEvent) => {
                const activeEditor = vscode.window.activeTextEditor;
                if (
                    activeEditor &&
                    activeEditor.document.languageId === "scripture"
                ) {
                    const currentLine = activeEditor.document.lineAt(
                        Math.max(
                            0,
                            Math.min(
                                event.selections[0].active.line,
                                activeEditor.document.lineCount - 1,
                            ),
                        ),
                    );
                    const completeLineContent = currentLine.text;
                    const currentLineVref =
                        extractVerseRefFromLine(completeLineContent);
                    const currentLineSelection =
                        event.textEditor.document.getText(event.selections[0]);
                    const selectedText: string =
                        event.textEditor.document.getText(event.selections[0]);
                    // Update global state with the selected line content
                    initializeStateStore().then(({ updateStoreState }) => {
                        updateStoreState({
                            key: "currentLineSelection",
                            value: {
                                selection: currentLineSelection,
                                completeLineContent,
                                vrefAtStartOfLine: currentLineVref,
                                selectedText: selectedText,
                            },
                        });
                        updateStoreState({
                            key: "verseRef",
                            value: {
                                verseRef: currentLineVref ?? "GEN 1:1",
                                uri: activeEditor.document.uri.toString(),
                            },
                        });
                    });
                }

                if (selectionTimeout) {
                    clearTimeout(selectionTimeout);
                }
                if (activeEditor) {
                    selectionTimeout = setTimeout(() => {
                        const selectedText: string =
                            activeEditor.document.getText(event.selections[0]);
                        performSearch(selectedText, callback);
                    }, 500); // Adjust delay as needed
                }
            },
        ),
    );
}

export async function performSearch(
    selectedText: string,
    callback: CallableFunction,
) {
    if (selectedText) {
        vscode.commands.executeCommand(
            "pygls.server.textSelected",
            selectedText,
        );
        try {
            const response = await fetch(
                `http://localhost:5554/detect_anomalies?&query=${encodeURIComponent(
                    selectedText,
                )}`,
            );
            const data = await response.json();
            callback(data);
        } catch (error: unknown) {
            console.error("Error performing search:", error);
            if (error instanceof Error) {
                console.error(error.message);
            } else {
                console.error("An unknown error occurred");
            }
        }
    }
}
