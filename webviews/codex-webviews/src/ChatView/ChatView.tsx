import { useState } from "react";
import { VSCodeButton, VSCodeTag } from "@vscode/webview-ui-toolkit/react";
import { ChatInputTextForm } from "../components/ChatInputTextForm";
import { WebviewHeader } from "../components/WebviewHeader";
import "../App.css";
import { ChatMessage, ChatPostMessages } from "../../../../types";

const FLASK_ENDPOINT = "http://localhost:5554";

const vscode = acquireVsCodeApi();

const ChatRoleLabel = {
    system: "System",
    user: "You",
    assistant: "Copilot",
};

function messageWithContext({
    messageHistory,
    userPrompt,
    selectedText,
    contextItems,
}: {
    messageHistory: string;
    userPrompt: string;
    selectedText?: string;
    contextItems?: string[];
}): ChatMessage {
    let content = `### Instructions:\nPlease use the context below to respond to the user's message. If you know the answer, be concise. If the answer is in the context, please quote the wording of the source. If the answer is not in the context, avoid making up anything.`;

    if (selectedText || (contextItems && contextItems?.length > 0)) {
        content += `\n\n### Context:`;
    }

    if (selectedText) {
        content += `\nThe user has selected the following text in their current document:\n${selectedText}`;
    }

    if (contextItems && contextItems?.length > 0) {
        content += `\n\nAnd here are some other relevant context items from their project and reference resources:\n${contextItems.join(
            "\n",
        )}`;
    }

    if (messageHistory) {
        content += `\n\n### Chat History:\n${messageHistory}`;
    }

    content += `\n\n### User's message: ${userPrompt}`;

    return {
        // FIXME: since we're passing in the conversation history, should we be using a completions endpoint rather than a chat one?
        role: "user",
        content: content,
    };
}

interface MessageItemProps {
    messageItem: ChatMessage;
    showSenderRoleLabels?: boolean;
}

const MessageItem: React.FC<MessageItemProps> = ({
    messageItem,
    showSenderRoleLabels = false,
}) => {
    return (
        <>
            {(messageItem.role === "user" ||
                messageItem.role === "assistant") && (
                <div
                    style={{
                        fontSize: "0.8em",
                        color: "lightgrey",
                        marginBottom: "0.2em",
                    }}
                >
                    {new Date().toLocaleTimeString()}{" "}
                    {/* FIXME: add actual timestamps */}
                </div>
            )}
            <div
                style={{
                    display: messageItem.role === "system" ? "none" : "flex",
                    flexDirection:
                        messageItem.role === "user"
                            ? "row"
                            : messageItem.role === "assistant"
                              ? "row-reverse"
                              : "column",
                    gap: "0.5em",
                    justifyContent:
                        messageItem.role === "user"
                            ? "flex-start"
                            : messageItem.role === "assistant"
                              ? "flex-end"
                              : "center",
                    borderRadius: "20px",
                    backgroundColor:
                        messageItem.role === "user"
                            ? "var(--vscode-editor-background)"
                            : messageItem.role === "assistant"
                              ? "var(--vscode-button-background)"
                              : "lightblue", // distinct style for 'context' messages
                    color:
                        messageItem.role === "user"
                            ? "var(--vscode-editor-foreground)"
                            : messageItem.role === "assistant"
                              ? "var(--vscode-button-foreground)"
                              : "black", // distinct style for 'context' messages
                    padding: "0.5em 1em",
                    // maxWidth: messageItem.role === "context" ? "100%" : "80%", // full width for 'context' messages
                    alignSelf:
                        messageItem.role === "user"
                            ? "flex-start"
                            : messageItem.role === "assistant"
                              ? "flex-end"
                              : "center",
                }}
            >
                {showSenderRoleLabels && (
                    <VSCodeTag>
                        {
                            ChatRoleLabel[
                                messageItem.role as keyof typeof ChatRoleLabel
                            ]
                        }
                    </VSCodeTag>
                )}
                <div style={{ display: "flex" }}>{messageItem.content}</div>
            </div>
        </>
    );
};

function App() {
    const systemMessage: ChatMessage = {
        role: "system",
        content: "You are are helpful Bible translation assistant.",
        // TODO: allow user to modify the system message
    };
    const dummyUserMessage: ChatMessage = {
        role: "user",
        content: "How do we normally translate cases like this?",
    };
    const dummyAssistantMessage: ChatMessage = {
        role: "assistant",
        content: "Let me check your current translation drafts...",
    };
    const [pendingMessage, setPendingMessage] = useState<ChatMessage>();
    const [selectedTextContext, setSelectedTextContext] = useState<string>("");
    const [contextItems, setContextItems] = useState<string[]>([]); // TODO: fetch from RAG server
    const [messageLog, setMessageLog] = useState<ChatMessage[]>([
        systemMessage,
        dummyUserMessage,
        dummyAssistantMessage,
    ]);

    const SHOW_SENDER_ROLE_LABELS = false;

    async function fetchContextItems(query: string): Promise<string[]> {
        // FIXME: finish implementing this function.
        // The Flask server is either crashing or not starting sometimes
        // and we need a more graceful way to handle using context items.

        // Also, need to truncate retrieved items to reasonable length based on count
        // and length of the items.
        const response = await fetch(
            `${FLASK_ENDPOINT}/search?db_name=drafts&query=${encodeURIComponent(
                query,
            )}`,
        );
        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }
        const data = await response.json();
        console.log("fhe8w9hew98h Context items response -->", response);
        if (!Array.isArray(data) || data.length === 0) {
            return [];
        }
        return data.map(
            (item) =>
                `${item.book} ${item.chapter}:${item.verse} - ${item.text}`,
        );
    }

    function formatMessageLogToString(messages: ChatMessage[]): string {
        return messages
            .map((message) => {
                return `${ChatRoleLabel[message.role]}: ${message.content}`;
            })
            .join("\n");
    }

    function getResponseToUserNewMessage(newMessageTextContent: string) {
        const pendingMessage: ChatMessage = {
            role: "user",
            content: newMessageTextContent,
        };

        const updatedMessageLog = [...messageLog, pendingMessage];

        const contextItemsFromState = contextItems;

        const formattedPrompt: ChatMessage[] = [
            messageWithContext({
                messageHistory: formatMessageLogToString(messageLog),
                userPrompt: newMessageTextContent,
                selectedText: selectedTextContext,
                contextItems: contextItemsFromState,
            }),
        ];
        console.log("Formatted prompt -->", formattedPrompt);
        setMessageLog(updatedMessageLog);
        vscode.postMessage({
            command: "fetch",
            messages: JSON.stringify(formattedPrompt),
        } as ChatPostMessages);
    }

    async function handleSubmit(submittedMessageValue: string) {
        try {
            const contextItemsFromServer = await fetchContextItems(
                submittedMessageValue,
            );
            setContextItems(contextItemsFromServer);
            getResponseToUserNewMessage(submittedMessageValue);
            setSelectedTextContext("");
        } catch (error) {
            console.error(
                "Failed to fetch context items due to an error:",
                error,
            );
            vscode.postMessage({
                command: "error",
                message: `Failed to fetch context items. ${JSON.stringify(
                    error,
                )}`,
                messages: [],
            } as unknown as ChatPostMessages);
        }
    }

    window.addEventListener(
        "message",
        (
            event: MessageEvent<{
                command: "response" | "select";
                finished: boolean;
                text?: string;
                textDataWithContext?: {
                    completeLineContent: string;
                    selectedText: string;
                    vrefAtStartOfLine: string;
                };
            }>,
        ) => {
            const messageInfo = event.data; // The JSON data our extension sent
            if (
                messageInfo?.command === "select" &&
                messageInfo.textDataWithContext
            ) {
                console.log("Received a select command", messageInfo);
                const { completeLineContent, selectedText, vrefAtStartOfLine } =
                    messageInfo.textDataWithContext;
                setSelectedTextContext(
                    `Reference: ${vrefAtStartOfLine}, Selected: ${selectedText}, Line: ${completeLineContent}`,
                );
                console.log("Selected text context -->", selectedTextContext);
            } else if (!event.data.finished) {
                const messageContent =
                    (pendingMessage?.content || "") + (event.data.text || "");
                setPendingMessage({
                    role: "assistant",
                    content: messageContent,
                });
            } else {
                if (pendingMessage) {
                    setMessageLog([...messageLog, pendingMessage]);
                }
                setPendingMessage(undefined);
            }
        },
    );

    function clearChat() {
        setMessageLog([systemMessage]);
    }

    interface ClearChatButtonProps {
        callback: () => void;
    }

    const ClearChatButton: React.FC<ClearChatButtonProps> = ({ callback }) => (
        <VSCodeButton
            aria-label="Clear"
            appearance="icon"
            title="Clear Current Chat"
            onClick={callback}
            style={{
                backgroundColor: "var(--vscode-button-background)",
                color: "var(--vscode-button-foreground)",
            }}
        >
            <i className="codicon codicon-trash"></i>
        </VSCodeButton>
    );

    return (
        <main
            style={{
                display: "flex",
                flexDirection: "column",
                height: "100vh",
                width: "100%",
                backgroundImage:
                    "linear-gradient(45deg, var(--vscode-sideBar-background), transparent)",
                backgroundSize: "cover",
                overflowX: "hidden",
            }}
        >
            <WebviewHeader title="Translator's Copilot Chat">
                <ClearChatButton callback={clearChat} />
            </WebviewHeader>
            <div
                className="chat-container"
                style={{
                    flex: 1,
                    overflowY: "auto",
                    overflowX: "hidden",
                    gap: "0.5em",
                    flexDirection: "column",
                    padding: "1em",
                    display: "flex",
                    width: "100%",
                }}
            >
                {messageLog.map((messageLogItem, index) => (
                    <MessageItem
                        key={index}
                        messageItem={messageLogItem}
                        showSenderRoleLabels={SHOW_SENDER_ROLE_LABELS}
                    />
                ))}
                {pendingMessage?.role === "assistant" &&
                pendingMessage?.content.length > 0 ? (
                    <MessageItem messageItem={pendingMessage} />
                ) : null}
            </div>
            <ChatInputTextForm
                contextItems={contextItems}
                selectedText={selectedTextContext}
                handleSubmit={handleSubmit}
            />
        </main>
    );
}

export default App;
