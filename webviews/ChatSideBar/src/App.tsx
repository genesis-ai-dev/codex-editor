import { useState, useEffect } from "react";
import {
    VSCodeButton,
    VSCodeTextField,
    VSCodeTag,
} from "@vscode/webview-ui-toolkit/react";
import "./App.css";
import { ChatMessage } from "../../../types";
const vscode = acquireVsCodeApi();

const ChatRoleLabel = {
    system: "System",
    user: "You",
    assistant: "Copilot",
};

function App() {
    const systemMessage: ChatMessage = {
        role: "system",
        content: "You are are helpful Bible translation assistant.",
    };
    const dummyUserMessage: ChatMessage = {
        role: "user",
        content: "How do we normally translate cases like this?",
    };
    const dummyAssistantMessage: ChatMessage = {
        role: "assistant",
        content: "Let me check your current translation drafts...",
    };
    const [message, setMessage] = useState<ChatMessage>();
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
                // Handle other cases
            }
        };

        window.addEventListener("message", handleMessage);

        // Cleanup function to remove the event listener
        return () => {
            window.removeEventListener("message", handleMessage);
        };
    }, []); // The empty array means this effect runs once on mount and cleanup on unmount

    function handleClick() {
        if (message) {
            const currentMessageLog = [...messageLog, message];
            setMessageLog(currentMessageLog);
            // console.log({ currentMessageLog });
            vscode.postMessage({
                command: "fetch",
                messages: JSON.stringify(currentMessageLog),
            });
            setMessage(undefined);
        }
    }
    // console.log("getState", vscode.getState());
    window.addEventListener(
        "message",
        (
            event: MessageEvent<{
                command: "response";
                finished: boolean;
                text: string;
            }>,
        ) => {
            // const message = event.data; // The JSON data our extension sent
            // console.log({ event, message });
            if (!event.data.finished) {
                const messageContent =
                    (message?.content || "") + (event.data.text || "");
                setMessage({
                    role: "assistant",
                    content: messageContent,
                });
            } else {
                if (message) {
                    setMessageLog([...messageLog, message]);
                }
                setMessage(undefined);
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
                padding: "0",
                backgroundImage: "linear-gradient(to bottom, #f5f5f5, #e0e0e0)",
                backgroundSize: "cover",
                overflowX: "hidden",
            }}
        >
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
                }}
            >
                {messageLog.map((message, index) => (
                    <div
                        key={index}
                        style={{
                            display:
                                message.role === "system" ? "none" : "flex",
                            flexDirection:
                                message.role === "user" ? "row" : "row-reverse",
                            gap: "0.5em",
                            justifyContent:
                                message.role === "user"
                                    ? "flex-start"
                                    : "flex-end",
                            borderRadius: "20px",
                            backgroundColor:
                                message.role === "user"
                                    ? "var(--vscode-editor-background)"
                                    : "var(--vscode-button-background)",
                            color:
                                message.role === "user"
                                    ? "var(--vscode-editor-foreground)"
                                    : "var(--vscode-button-foreground)",
                            padding: "0.5em 1em",
                            maxWidth: "80%",
                            alignSelf:
                                message.role === "user"
                                    ? "flex-start"
                                    : "flex-end",
                        }}
                    >
                        {SHOW_SENDER_ROLE_LABELS && (
                            <VSCodeTag>
                                {
                                    ChatRoleLabel[
                                        message.role as keyof typeof ChatRoleLabel
                                    ]
                                }
                            </VSCodeTag>
                        )}
                        <p>{message.content}</p>
                    </div>
                ))}
            </div>
            {/* Input for sending messages */}
            <form
                className="chat-input"
                style={{
                    position: "sticky",
                    bottom: 0,
                    width: "100%",
                    display: "flex",
                    gap: "0.25em",
                    alignItems: "center",
                    paddingInline: "0.5em",
                    background: "var(--vscode-sideBar-background)",
                }}
                onSubmit={(e) => {
                    e.preventDefault();
                    handleClick();
                }}
            >
                <VSCodeButton
                    aria-label="Attach"
                    onClick={() => console.log("Attach clicked")}
                >
                    <i className="codicon codicon-add"></i>
                </VSCodeButton>
                <VSCodeTextField
                    placeholder="Type a message..."
                    value={message?.content || ""}
                    onChange={(e) =>
                        setMessage({
                            role: "user",
                            content: (e.target as HTMLInputElement).value,
                        })
                    }
                    style={{
                        flexGrow: 1,
                        borderRadius: "5em",
                    }}
                />
                <VSCodeButton type="submit">
                    <i className="codicon codicon-send"></i>
                </VSCodeButton>
                <VSCodeButton
                    aria-label="Record"
                    onClick={() => console.log("Record clicked")}
                >
                    <i className="codicon codicon-mic"></i>
                </VSCodeButton>
            </form>
        </main>
    );
}

export default App;
