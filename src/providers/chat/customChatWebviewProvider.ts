import * as vscode from "vscode";
import {
  ChatMessage,
  ChatMessageThread,
  ChatMessageWithContext,
  ChatPostMessages,
  SelectedTextDataWithContext,
} from "../../../types";
import { extractVerseRefFromLine } from "../../utils/verseRefUtils";
import {
  getChatMessagesFromFile,
  writeSerializedData,
} from "../../utils/fileUtils";
import { VerseDataReader } from "../../utils/chatContext";
import { getBibleDataRecordById, TheographicBibleDataRecord } from "../../activationHelpers/contextAware/sourceData";


const config = vscode.workspace.getConfiguration("translators-copilot");
const endpoint = config.get("llmEndpoint"); // NOTE: config.endpoint is reserved so we must have unique name
const apiKey = config.get("api_key");
const model = config.get("model");
const maxTokens = config.get("max_tokens");
const temperature = config.get("temperature");
const maxLength = 2048;
let VerseReader: VerseDataReader | null = null;
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
    console.error("Error reading file:", error);
    vscode.window.showErrorMessage(`Error reading file: ${filePath}`);
  }
};

const loadWebviewHtml = (
  webviewView: vscode.WebviewView,
  extensionUri: vscode.Uri
) => {
  webviewView.webview.options = {
    enableScripts: true,
    localResourceRoots: [extensionUri],
  };

  const styleResetUri = webviewView.webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "src", "media", "reset.css")
  );
  const styleVSCodeUri = webviewView.webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "src", "media", "vscode.css")
  );
  const codiconsUri = webviewView.webview.asWebviewUri(
    vscode.Uri.joinPath(
      extensionUri,
      "node_modules",
      "@vscode/codicons",
      "dist",
      "codicon.css"
    )
  );

  const scriptUri = webviewView.webview.asWebviewUri(
    vscode.Uri.joinPath(
      extensionUri,
      "webviews",
      "codex-webviews",
      "dist",
      "ChatView",
      "index.js"
    )
  );
  const styleUri = webviewView.webview.asWebviewUri(
    vscode.Uri.joinPath(
      extensionUri,
      "webviews",
      "codex-webviews",
      "dist",
      "ChatView",
      "index.css"
    )
  );
  function getNonce() {
    let text = "";
    const possible =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
  const nonce = getNonce();
  const html = /*html*/ `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <!--
      Use a content security policy to only allow loading images from https or from our extension directory,
      and only allow scripts that have a specific nonce.
    -->
    <meta http-equiv="Content-Security-Policy" content="img-src https: data:; style-src 'unsafe-inline' ${webviewView.webview.cspSource
    }; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleResetUri}" rel="stylesheet">
    <link href="${styleVSCodeUri}" rel="stylesheet">
    <link href="${styleUri}" rel="stylesheet" />
    <link href="${codiconsUri}" rel="stylesheet" />
    <script nonce="${nonce}">
      // const vsCodeApi = acquireVsCodeApi();
      const apiBaseUrl = ${JSON.stringify("http://localhost:3002")}
    </script>
    </head>
    <body style="padding: 0; min-width: none; max-width: 100%; margin: 0;">
    <div id="root" style="padding: 0; min-width: none; max-width: 100%; margin: 0;"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
  </html>`;
  webviewView.webview.html = html;
};

const sendFinishMessage = (webviewView: vscode.WebviewView) => {
  webviewView.webview.postMessage({
    command: "response",
    finished: true,
    text: "",
  } as ChatPostMessages);
};

const processFetchResponse = async (
  webviewView: vscode.WebviewView,
  response: Response
) => {
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

export class CustomWebviewProvider {
  _extensionUri: any;
  selectionChangeListener: any;
  constructor(extensionUri: vscode.Uri) {
    this._extensionUri = extensionUri;
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
        verseGraphData = await vscode.commands.executeCommand('codex-editor-extension.getContextDataFromVref', vrefAtStartOfLine);
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
      this.selectionChangeListener =
        vscode.window.onDidChangeTextEditorSelection(async (e) => {
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

            const currentLine = activeEditor.document.lineAt(
              e.selections[0].active
            );
            selectedTextDataToAddToChat.completeLineContent = currentLine.text;

            const vrefAtStartOfLine = extractVerseRefFromLine(currentLine.text);
            if (vrefAtStartOfLine) {
              selectedTextDataToAddToChat.vrefAtStartOfLine = vrefAtStartOfLine;
            }

            await this.sendSelectMessage(webviewView, selectedTextDataToAddToChat);
          }
        });
    }
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    loadWebviewHtml(webviewView, this._extensionUri);
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

    webviewView.webview.onDidReceiveMessage(
      async (message: ChatPostMessages) => {
        try {
          switch (message.command) {
            case "fetch": {
              const mainChatLanguage = vscode.workspace.getConfiguration('translators-copilot').get('main_chat_language', 'English');

              abortController = new AbortController();
              const url = endpoint + "/chat/completions";
              const messages = JSON.parse(message.messages) as ChatMessageWithContext[];

              const systemMessage = messages.find((message) => message.role === 'system');

              if (!systemMessage) {
                messages.unshift({
                  content: vscode.workspace.getConfiguration('translators-copilot').get('chatSystemMessage', ''),
                  role: 'system',
                  createdAt: new Date().toISOString(),
                });
              }

              if (messages[0].role === 'system') {
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
              await processFetchResponse(webviewView, response);
              break;
            }
            case "abort-fetch":
              if (abortController) {
                abortController.abort();
              }
              break;

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
              sendChatThreadToWebview(webviewView);
              break;
            }
            case "fetchThread": {
              sendChatThreadToWebview(webviewView);
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
                  JSON.stringify(
                    [...exitingMessages, threadToSaveMessage],
                    null,
                    4
                  ),
                  fileName
                );
              }
              break;
            }
            case "openSettings": {
              vscode.commands.executeCommand(
                "workbench.action.openSettings",
                "@ext:project-accelerate.codex-copilot"
              );
              break;
            }
            case 'openContextItem': {
              const vrefRegex = /[a-zA-Z]+\s+\d+:\d+/;
              const vref = message.text.match(vrefRegex)?.[0];
              if (vref) {
                try {
                  if (message.text.startsWith('Notes for')) {
                    await vscode.commands.executeCommand(
                      "codex-editor-extension.showReferences",
                      vref
                    );
                  } else if (message.text.startsWith('Questions for')) {
                    await vscode.commands.executeCommand(
                      "codex-editor-extension.showReferences",
                      vref
                    ); // FIXME: This should be a different command. Currently the both open the TranslationNotes.
                    // There is no command in the codex-editor-extension to open the Questions.
                  }
                } catch (error) {
                  console.error('Failed to execute command:', error);
                }
              } else {
                console.error('Vref not found in message text');
              }
              break;
            }
            default:
              break;
          }
        } catch (error) {
          sendFinishMessage(webviewView);
          console.error("Error:", error);
          vscode.window.showErrorMessage("Service access failed.");
        }
      }
    );
  }
}

export function registerChatProvider(context: vscode.ExtensionContext) {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right
  );
  VerseReader = new VerseDataReader(context);
  // Start of Selection
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "genesis-translator-sidebar",
      new CustomWebviewProvider(context.extensionUri)
    )
  );
  item.show();
}
