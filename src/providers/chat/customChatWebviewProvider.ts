import * as vscode from "vscode";
import {
    ChatMessage,
    ChatMessageThread,
    ChatMessageWithContext,
    ChatPostMessages,
    SelectedTextDataWithContext,
} from "../../../types";
import { extractVerseRefFromLine } from "../../utils/verseRefUtils";
import { getChatMessagesFromFile, writeSerializedData } from "../../utils/fileUtils";
import { VerseDataReader } from "../../utils/chatContext";
import {
    getBibleDataRecordById,
    TheographicBibleDataRecord,
} from "../../activationHelpers/contextAware/sourceData";
import { initializeStateStore } from "../../stateStore";
import { fetchCompletionConfig } from "@/utils/llmUtils";
import { performReflection } from "../../utils/llmUtils";
import { BaseWebviewProvider } from "../../globalProvider";

const config = vscode.workspace.getConfiguration("translators-copilot");
const endpoint = config.get("llmEndpoint"); // NOTE: config.endpoint is reserved so we must have unique name
const apiKey = config.get("api_key");
const model = config.get("model");
const maxTokens = config.get("max_tokens");
const temperature = config.get("temperature");
const maxLength = 2048;
const VerseReader: VerseDataReader | null = null;
let abortController: AbortController | null = null;

const sendChatThreadToWebview = async (webviewView: vscode.WebviewView) => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const filePath = workspaceFolders
        ? vscode.Uri.joinPath(workspaceFolders[0].uri, "chat-threads.json").fsPath // fix this so it is a diffent note book
        : "";
    try {
        const uri = vscode.Uri.file(filePath);
        const fileContentUint8Array = await vscode.workspace.fs.readFile(uri);
        const fileContent = new TextDecoder().decode(fileContentUint8Array);
        webviewView.webview.postMessage({
            command: "threadsFromWorkspace",
            content: JSON.parse(fileContent),
        } as ChatPostMessages);
    } catch (error) {
        console.error("Error reading file in sendChatThreadToWebview:", error);
        // vscode.window.showErrorMessage(`Error reading file: ${filePath}`);
    }
};

const sendFinishMessage = (webviewView: vscode.WebviewView) => {
    webviewView.webview.postMessage({
        command: "response",
        finished: true,
        text: "",
    } as ChatPostMessages);
};

const processFetchResponse = async (webviewView: vscode.WebviewView, response: Response) => {
    if (!response.body) {
        throw new Error("Response body is null");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    let lastPostMessageTime = 0; // Variable to save the last time postMessage was called

    const done = false;
    while (!done) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        buffer += decoder.decode(value, { stream: true });

        while (buffer.includes("\n")) {
            const newlineIndex = buffer.indexOf("\n");
            const rawLine = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);

            if (rawLine.startsWith("data: ") && !rawLine.includes("[DONE]")) {
                const jsonLine = rawLine.replace(/^data: /, "");
                try {
                    const parsedLine = JSON.parse(jsonLine);
                    const payloadTemp = parsedLine["choices"]?.[0];
                    const sendChunk = payloadTemp["message"]
                        ? payloadTemp["message"]["content"]
                        : payloadTemp["delta"]["content"];
                    if (sendChunk) {
                        const currentTime = Date.now();
                        const timeSinceLastMessageInMs = currentTime - lastPostMessageTime;
                        const bufferTimeInMs = 100;
                        if (timeSinceLastMessageInMs < bufferTimeInMs) {
                            await new Promise((resolve) =>
                                setTimeout(resolve, bufferTimeInMs - timeSinceLastMessageInMs)
                            );
                        }
                        await webviewView.webview.postMessage({
                            command: "response",
                            finished: false,
                            text: sendChunk,
                        } as ChatPostMessages);
                        lastPostMessageTime = Date.now(); // Update the last postMessage time
                    }
                } catch (error) {
                    console.error("Error parsing JSON:", error);
                }
            }
        }
    }

    if (buffer.trim()) {
        try {
            const parsedLine = JSON.parse(buffer.trim().replace(/^data: /, ""));
            await webviewView.webview.postMessage({
                command: "response",
                finished: true,
                text: parsedLine,
            } as ChatPostMessages);
        } catch (error) {
            console.error("Error parsing JSON:", error);
        }
    }

    sendFinishMessage(webviewView);
};

const processGradeResponse = async (
    webviewView: vscode.WebviewView,
    response: Response,
    lastMessageCreatedAt: string
) => {
    if (!response.body) {
        throw new Error("Response body is null");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    // eslint-disable-next-line no-constant-condition
    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        buffer += decoder.decode(value, { stream: true });
    }

    if (buffer.trim()) {
        try {
            const content = JSON.parse(buffer.trim());

            //now send the content to the webview
            webviewView.webview.postMessage({
                command: "respondWithGrade",
                content: content.choices[0].message.content,
                lastMessageCreatedAt,
            } as ChatPostMessages);
        } catch (error) {
            console.error("Error parsing JSON:", error);
        }
    }
};

const checkThatChatThreadsFileExists = async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        console.error("No workspace folder found.");
        return [];
    }

    const filePath = vscode.Uri.joinPath(workspaceFolders[0].uri, "chat-threads.json");

    try {
        await vscode.workspace.fs.stat(filePath);
        const fileContentUint8Array = await vscode.workspace.fs.readFile(filePath);
        const fileContent = new TextDecoder().decode(fileContentUint8Array);
        return JSON.parse(fileContent);
    } catch (error) {
        if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
            // File doesn't exist, create an empty file
            await vscode.workspace.fs.writeFile(filePath, new Uint8Array(Buffer.from("[]")));
            return [];
        } else {
            console.error("Error accessing chat-threads.json:", error);
            vscode.window.showErrorMessage(`Error accessing chat-threads.json: ${error}`);
            return [];
        }
    }
};

export class CustomWebviewProvider extends BaseWebviewProvider {
    selectionChangeListener: any;

    constructor(context: vscode.ExtensionContext) {
        super(context);
        if (vscode.workspace.workspaceFolders) {
            checkThatChatThreadsFileExists();
        }
    }

    protected getWebviewId(): string {
        return "chat-sidebar";
    }

    protected getScriptPath(): string[] {
        return ["ChatView", "index.js"];
    }

    protected onWebviewResolved(webviewView: vscode.WebviewView): void {
        // Add this block to listen to the shared state store
        initializeStateStore().then(({ storeListener }) => {
            const disposeFunction = storeListener("cellId", async (value) => {
                if (value) {
                    // get source verse content
                    const sourceCellContent = await vscode.commands.executeCommand(
                        "translators-copilot.getSourceCellByCellIdFromAllSourceCells",
                        value.cellId
                    );

                    webviewView.webview.postMessage({
                        command: "cellIdUpdate",
                        data: {
                            cellId: value.cellId,
                            uri: value.uri,
                            sourceCellContent,
                        },
                    } as ChatPostMessages);
                }
            });
            webviewView.onDidDispose(() => {
                disposeFunction();
            });
        });

        // Add this block to listen to the shared state store
        initializeStateStore().then(({ storeListener }) => {
            const disposeFunction = storeListener("sourceCellMap", (value) => {
                if (value) {
                    webviewView.webview.postMessage({
                        command: "updateSourceCellMap",
                        sourceCellMap: value,
                    } as ChatPostMessages);
                }
            });
            webviewView.onDidDispose(() => {
                disposeFunction();
            });
        });

        webviewView.webview.postMessage({
            command: "reload",
        } as ChatPostMessages);

        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                webviewView.webview.postMessage({
                    command: "reload",
                } as ChatPostMessages);
            }
        });

        this.saveSelectionChanges(webviewView);
        vscode.window.onDidChangeActiveTextEditor(() => {
            // When the active editor changes, remove the old listener and add a new one
            if (this.selectionChangeListener) {
                this.selectionChangeListener.dispose();
            }
            this.saveSelectionChanges(webviewView);
        });
    }

    async sendSelectMessage(
        webviewView: vscode.WebviewView,
        selectedText: SelectedTextDataWithContext
    ) {
        /*
        Send the text currently selected in the active editor to the webview.
        Also sends the full line, and the vref if any is found at the start 
        of the line.

        :param webviewView: The webview to send the message to.
        :param selectedText: The text currently selected in the active editor.

        :return: None
        */
        const { selection, completeLineContent, vrefAtStartOfLine } = selectedText;
        let selectedTextToSend = selection;
        let verseGraphData: TheographicBibleDataRecord | null = null;

        // Shorten the length of selectedText
        if (selection.length > maxLength - 100) {
            selectedTextToSend = selection.substring(0, maxLength - 100);
        }
        let verseNotes = null;
        if (vrefAtStartOfLine) {
            const [book, verse] = vrefAtStartOfLine.split(" ");
            if (VerseReader) {
                verseNotes = VerseReader.getVerseData(book, verse);
            } else {
                console.error("VerseReader is not available");
            }
            try {
                verseGraphData = await vscode.commands.executeCommand(
                    "codex-editor-extension.getContextDataFromVref",
                    vrefAtStartOfLine
                );
            } catch (error) {
                console.error("Error getting verse graph data:", error);
            }
        }

        const message = {
            command: "select",
            textDataWithContext: {
                selectedText: selectedTextToSend, // FIXME, this should be passed below
                completeLineContent,
                vrefAtStartOfLine,
                verseNotes, // This should work, but doesn't, to pass the data to the webview.
                verseGraphData,
            },
        };
        webviewView.webview.postMessage(message);
    }

    async saveSelectionChanges(webviewView: vscode.WebviewView) {
        // FIXME: let's get rid of this function and use global state via textSelectionHandler.ts
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            this.selectionChangeListener = vscode.window.onDidChangeTextEditorSelection(
                async (e) => {
                    if (e.textEditor === activeEditor) {
                        const selectedTextDataToAddToChat: SelectedTextDataWithContext = {
                            selection: activeEditor.document.getText(e.selections[0]),
                            completeLineContent: null,
                            vrefAtStartOfLine: null,
                            selectedText: "placeHolder test",
                            verseNotes: null,
                            verseGraphData: null,
                        };

                        // const selectedText = activeEditor.document.getText(e.selections[0]);

                        const currentLine = activeEditor.document.lineAt(e.selections[0].active);
                        selectedTextDataToAddToChat.completeLineContent = currentLine.text;

                        const vrefAtStartOfLine = extractVerseRefFromLine(currentLine.text);
                        if (vrefAtStartOfLine) {
                            selectedTextDataToAddToChat.vrefAtStartOfLine = vrefAtStartOfLine;
                        }

                        await this.sendSelectMessage(webviewView, selectedTextDataToAddToChat);
                    }
                }
            );
        }
    }

    protected async handleMessage(message: ChatPostMessages): Promise<void> {
        try {
            switch (message.command) {
                case "fetch": {
                    const mainChatLanguage = vscode.workspace
                        .getConfiguration("translators-copilot")
                        .get("main_chat_language", "English");

                    abortController = new AbortController();
                    const url = endpoint + "/chat/completions";
                    const messages = JSON.parse(message.messages) as ChatMessageWithContext[];

                    const systemMessage = messages.find((message) => message.role === "system");

                    if (!systemMessage) {
                        messages.unshift({
                            content: vscode.workspace
                                .getConfiguration("translators-copilot")
                                .get("chatSystemMessage", ""),
                            role: "system",
                            createdAt: new Date().toISOString(),
                        });
                    }

                    if (messages[0].role === "system") {
                        const accessibilityNote = `\n\nNote carefully, 'assistant' must always respond to 'user' in ${mainChatLanguage}, even if the user has used some English or another language to communicate. It is *critical for accessibility* to respond only in ${mainChatLanguage} (though you can translate some piece of text into any language 'user' requests)`;
                        if (!messages[0].content.includes(accessibilityNote)) {
                            messages[0].content += `${accessibilityNote}`;
                        }
                    }

                    const data = {
                        max_tokens: maxTokens,
                        temperature: temperature,
                        stream: true,
                        messages: messages.map((message) => {
                            const messageForAi: ChatMessage = {
                                content: message.content,
                                role: message.role,
                            };
                            return messageForAi;
                        }),
                        model: undefined as any,
                        stop: ["\n\n\n", "###", "<|endoftext|>"], // ? Not sure if it matters if we pass this here.
                    };
                    if (model) {
                        data.model = model;
                    }
                    const headers = {
                        "Content-Type": "application/json",
                    };
                    if (apiKey) {
                        // @ts-expect-error needed
                        headers["Authorization"] = "Bearer " + apiKey;
                    }
                    const response = await fetch(url, {
                        method: "POST",
                        headers,
                        body: JSON.stringify(data),
                        signal: abortController.signal,
                    });
                    await processFetchResponse(this._view!, response);
                    break;
                }
                case "abort-fetch":
                    if (abortController) {
                        abortController.abort();
                    }
                    break;

                case "performReflection": {
                    const reflectionConfig = await fetchCompletionConfig();
                    const num_improverrs = 3;
                    const number_of_loops = 2;
                    const chatReflectionConcern =
                        vscode.workspace
                            .getConfiguration("translators-copilot")
                            .get<string>("chatReflectionConcern") ?? "";
                    const reflectedMessage = await performReflection(
                        message.messageToReflect,
                        message.context,
                        num_improverrs,
                        number_of_loops,
                        chatReflectionConcern,
                        reflectionConfig
                    );

                    this._view!.webview.postMessage({
                        command: "reflectionResponse",
                        reflectedMessage,
                        lastMessageCreatedAt: message.lastMessageCreatedAt,
                    });

                    break;
                }

                case "requestGradeResponse": {
                    const mainChatLanguage = vscode.workspace
                        .getConfiguration("translators-copilot")
                        .get("main_chat_language", "English");

                    abortController = new AbortController();
                    const url = endpoint + "/chat/completions";
                    const messages = JSON.parse(message.messages) as ChatMessageWithContext[];

                    const systemMessage = messages.find((message) => message.role === "system");

                    if (!systemMessage) {
                        messages.unshift({
                            content: vscode.workspace
                                .getConfiguration("translators-copilot")
                                .get("chatGradingSystemMessage", ""),
                            role: "system",
                            createdAt: new Date().toISOString(),
                        });
                    }

                    if (messages[0].role === "system") {
                        const accessibilityNote = `\n\nNote carefully, 'assistant' must always respond to 'user' in ${mainChatLanguage}, even if the user has used some English or another language to communicate. It is *critical for accessibility* to respond only in ${mainChatLanguage} (though you can translate some piece of text into any language 'user' requests)`;
                        if (!messages[0].content.includes(accessibilityNote)) {
                            messages[0].content += `${accessibilityNote}`;
                        }
                    }

                    const data = {
                        max_tokens: maxTokens,
                        temperature: temperature,
                        stream: false,
                        messages: messages.map((message) => {
                            const messageForAi: ChatMessage = {
                                content: message.content,
                                role: message.role,
                            };
                            return messageForAi;
                        }),
                        model: undefined as any,
                        stop: ["\n\n\n", "###", "<|endoftext|>"], // ? Not sure if it matters if we pass this here.
                    };
                    if (model) {
                        data.model = model;
                    }
                    const headers = {
                        "Content-Type": "application/json",
                    };
                    if (apiKey) {
                        // @ts-expect-error needed
                        headers["Authorization"] = "Bearer " + apiKey;
                    }
                    const response = await fetch(url, {
                        method: "POST",
                        headers,
                        body: JSON.stringify(data),
                        signal: abortController.signal,
                    });
                    await processGradeResponse(
                        this._view!,
                        response,
                        message.lastMessageCreatedAt
                    );
                    break;
                }
                case "deleteThread": {
                    const fileName = "chat-threads.json";
                    const exitingMessages = await getChatMessagesFromFile(fileName);
                    const messageThreadId = message.threadId;
                    const threadToMarkAsDeleted: ChatMessageThread | undefined =
                        exitingMessages.find((thread) => thread.id === messageThreadId);
                    if (threadToMarkAsDeleted) {
                        threadToMarkAsDeleted.deleted = true;
                        await writeSerializedData(
                            JSON.stringify(exitingMessages, null, 4),
                            fileName
                        );
                    }
                    sendChatThreadToWebview(this._view!);
                    break;
                }
                case "fetchThread": {
                    sendChatThreadToWebview(this._view!);
                    break;
                }
                case "updateMessageThread": {
                    const fileName = "chat-threads.json";
                    if (!message.messages || message.messages.length < 1) {
                        break;
                    }
                    const exitingMessages = await getChatMessagesFromFile(fileName);
                    const messageThreadId = message.threadId;
                    let threadToSaveMessage: ChatMessageThread | undefined =
                        exitingMessages.find((thread) => thread.id === messageThreadId);

                    if (threadToSaveMessage) {
                        threadToSaveMessage.messages = message.messages;
                        await writeSerializedData(
                            JSON.stringify(exitingMessages, null, 4),
                            fileName
                        );
                    } else {
                        threadToSaveMessage = {
                            id: messageThreadId,
                            canReply: true,
                            collapsibleState: 0,
                            messages: message.messages,
                            deleted: false,
                            threadTitle: message.threadTitle,
                            createdAt: new Date().toISOString(),
                        };
                        await writeSerializedData(
                            JSON.stringify([...exitingMessages, threadToSaveMessage], null, 4),
                            fileName
                        );
                    }
                    break;
                }
                case "openSettings": {
                    vscode.commands.executeCommand(
                        "workbench.action.openSettings",
                        "translators-copilot"
                    );
                    break;
                }
                case "subscribeSettings": {
                    const settingsToSubscribe = message.settingsToSubscribe;
                    const config = vscode.workspace.getConfiguration("translators-copilot");
                    if (settingsToSubscribe) {
                        for (const setting of settingsToSubscribe) {
                            const value = config.get(setting);
                            this._view!.webview.postMessage({
                                command: "updateSetting",
                                setting,
                                value:
                                    typeof value === "string" ? value : JSON.stringify(value),
                            });
                            //now subscribe for changes
                            // config.onDidChange(
                            //     (event: { affectsConfiguration: (arg0: any) => any; }) => {
                            //         if (event.affectsConfiguration(setting)) {
                            //             webviewView.webview.postMessage({
                            //                 command: "updateSetting",
                            //                 setting,
                            //                 value: config.get(setting),
                            //             });
                            //         }
                            //     },
                            //     null
                            // );
                            vscode.workspace.onDidChangeConfiguration(
                                (event: vscode.ConfigurationChangeEvent) => {
                                    if (
                                        event.affectsConfiguration(
                                            `translators-copilot.${setting}`
                                        )
                                    ) {
                                        const newConfig =
                                            vscode.workspace.getConfiguration(
                                                "translators-copilot"
                                            );
                                        this._view!.webview.postMessage({
                                            command: "updateSetting",
                                            setting,
                                            value:
                                                typeof newConfig.get(setting) === "string"
                                                    ? newConfig.get(setting)
                                                    : JSON.stringify(newConfig.get(setting)),
                                        });
                                    }
                                }
                            );
                        }
                    }
                    break;
                }
                case "openContextItem": {
                    const vrefRegex = /[a-zA-Z]+\s+\d+:\d+/;
                    const vref = message.text.match(vrefRegex)?.[0];
                    if (vref) {
                        try {
                            if (message.text.startsWith("Notes for")) {
                                await vscode.commands.executeCommand(
                                    "codex-editor-extension.showReferences",
                                    vref
                                );
                            } else if (message.text.startsWith("Questions for")) {
                                await vscode.commands.executeCommand(
                                    "codex-editor-extension.showReferences",
                                    vref
                                ); // FIXME: This should be a different command. Currently the both open the TranslationNotes.
                                // There is no command in the codex-editor-extension to open the Questions.
                            }
                        } catch (error) {
                            console.error("Failed to execute command:", error);
                        }
                    } else {
                        console.error("Vref not found in message text");
                    }
                    break;
                }
                case "getCurrentCellId": {
                    initializeStateStore().then(({ getStoreState }) => {
                        getStoreState("cellId").then((value) => {
                            if (value) {
                                this._view!.webview.postMessage({
                                    command: "cellIdUpdate",
                                    data: {
                                        cellId: value.cellId,
                                        uri: value.uri,
                                    },
                                } as ChatPostMessages);
                            }
                        });
                    });
                    break;
                }
                default:
                    break;
            }
        } catch (error) {
            sendFinishMessage(this._view!);
            console.error("Error:", error);
            vscode.window.showErrorMessage("Service access failed.");
        }
    }
}


