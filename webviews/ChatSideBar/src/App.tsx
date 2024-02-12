import { useState, useEffect } from "react";
import { VSCodeButton, VSCodeTag } from "@vscode/webview-ui-toolkit/react";
import { CommentTextForm } from "../components/CommentTextForm";
import "./App.css";
import { ChatMessage, ChatPostMessages } from "../../../types";
const vscode = acquireVsCodeApi();

const ChatRoleLabel = {
    system: "System",
    user: "You",
    assistant: "Copilot",
    context: "Context",
};

interface MessageItemProps {
    messageItem: ChatMessage;
    showSenderRoleLabels?: boolean;
}

const MessageItem: React.FC<MessageItemProps> = ({
    messageItem,
    showSenderRoleLabels = true,
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
                    maxWidth: messageItem.role === "context" ? "100%" : "80%", // full width for 'context' messages
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
                <span style={{ display: "flex" }}>{messageItem.content}</span>
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
    const [messageLog, setMessageLog] = useState<ChatMessage[]>([
        systemMessage,
        dummyUserMessage,
        dummyAssistantMessage,
    ]);

    const SHOW_SENDER_ROLE_LABELS = false;

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            console.log({ message });
            switch (message.command) {
                case "setState": {
                    const state = message.data;
                    console.log({ state });
                    break;
                }
                case "select": {
                    const { textDataWithContext } = message;
                    const {
                        selectedText,
                        completeLineContent,
                        vrefAtStartOfLine,
                    } = textDataWithContext;
                    console.log(`Selected text: ${selectedText}`);
                    console.log(
                        `Complete line content: ${completeLineContent}`,
                    );
                    console.log(
                        `Verse reference at start of line: ${vrefAtStartOfLine}`,
                    );

                    const responseContent = textDataWithContext; // NOTE: this is an object... not a string. However, we want to render it not as a normal message but as a context display, sort of like a rendered code block

                    // Update the pending message to show the assistant's response
                    setPendingMessage({
                        role: "context",
                        content: responseContent,
                    });
                    break;
                }
            }
        };

        window.addEventListener("message", handleMessage);

        // Cleanup function to remove the event listener
        return () => {
            window.removeEventListener("message", handleMessage);
        };
    }, []); // The empty array means this effect runs once on mount and cleanup on unmount

    // function handleClick() {
    //     if (pendingMessage) {
    //         const currentMessageLog = [...messageLog, pendingMessage];
    //         setMessageLog(currentMessageLog);
    //         // console.log({ currentMessageLog });
    //         vscode.postMessage({
    //             command: "fetch",
    //             messages: JSON.stringify(currentMessageLog),
    //         } as ChatPostMessages);
    //         setPendingMessage(undefined);
    //     }
    // }

    function handleSubmit(submittedMessageValue: string) {
        const pendingMessage: ChatMessage = {
            role: "user",
            content: submittedMessageValue,
        };

        const currentMessageLog = [...messageLog, pendingMessage];
        setMessageLog(currentMessageLog);

        vscode.postMessage({
            command: "fetch",
            messages: JSON.stringify(currentMessageLog),
        } as ChatPostMessages);
        // setPendingMessage(undefined);
    }

    // console.log("getState", vscode.getState());
    window.addEventListener(
        "message",
        (
            event: MessageEvent<{
                command: "response" | "select";
                finished: boolean;
                text: string;
            }>,
        ) => {
            const messageInfo = event.data; // The JSON data our extension sent
            console.log("RYDER", {
                event,
                messageInfo,
                message: pendingMessage,
            });
            if (messageInfo?.command === "select") {
                console.log(
                    "RYDER event.data.finished and pendingMessage.role === 'context'",
                );
                const messageContent = event.data.text;
                setPendingMessage({
                    role: "context",
                    content: messageContent,
                });
            } else if (!event.data.finished) {
                console.log("RYDER !event.data.finished");
                const messageContent =
                    (pendingMessage?.content || "") + (event.data.text || "");
                setPendingMessage({
                    role: "assistant",
                    content: messageContent,
                });
            } else if (event.data.finished) {
                if (pendingMessage) {
                    setMessageLog([...messageLog, pendingMessage]);
                }
                setPendingMessage(undefined);
            } else {
                console.log("RYDER else");
                if (pendingMessage) {
                    setMessageLog([...messageLog, pendingMessage]);
                }
                setPendingMessage(undefined);
            }
        },
    );

    return (
        <main
            style={{
                display: "flex",
                flexDirection: "column",
                height: "100vh",
                width: "100%",
                backgroundImage: "linear-gradient(to bottom, #f5f5f5, #e0e0e0)", // FIXME: use vscode theme colors
                backgroundSize: "cover",
                overflowX: "hidden",
            }}
        >
            <div
                className="chat-header"
                style={{
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "space-between",
                    padding: "1em",
                    borderBottom: "1px solid lightgrey",
                }}
            >
                <h2 style={{ margin: 0 }}>Chat</h2>
                <VSCodeButton
                    aria-label="Clear"
                    onClick={() => setMessageLog([systemMessage])}
                >
                    <i className="codicon codicon-trash"></i>
                </VSCodeButton>
            </div>
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
                {pendingMessage?.role === "assistant" && (
                    <MessageItem messageItem={pendingMessage} />
                )}
            </div>
            {/* Input for sending messages */}

            <CommentTextForm handleSubmit={handleSubmit} />
        </main>
    );
}

export default App;
