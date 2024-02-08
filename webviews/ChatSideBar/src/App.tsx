import { useState, useEffect } from "react";
import {
    VSCodeButton,
    VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react";
import "./App.css";
import { ChatMessage } from "../../../types";
const vscode = acquireVsCodeApi();

function App() {
    const systemMessage: ChatMessage = {
        role: "system",
        content: "You are are helpful translation assistant.",
    };
    const [message, setMessage] = useState<ChatMessage>();
    const [messageLog, setMessageLog] = useState<ChatMessage[]>([
        systemMessage,
    ]);

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
                    role: "system",
                    content: messageContent,
                });
            } else {
                if (message) {
                    setMessageLog([...messageLog, message]);
                }
                setMessage(undefined);
            }
            // switch (message.command) {
            //   case "setState": {
            //     // Handle the 'setState' message and update webview state
            //     const state = message.data;
            //     console.log({ state });
            //     // Use the state to update your webview content
            //     break;
            //   }
            // }
        },
    );
    return (
        <main
            style={{
                display: "flex",
                flexDirection: "column",
                height: "100vh",
                width: "100%",
            }}
        >
            <div
                className="chat-container"
                style={{ flex: 1, overflowY: "auto" }}
            >
                <div className="chat-content">
                    {messageLog.map((message, index) => (
                        <>
                            <p>{message.role}</p>
                            <p key={index}>{message.content}</p>
                        </>
                    ))}
                    {message?.role === "system" && (
                        <>
                            <p>{message.role}</p>
                            <p key={message.role}>{message.content}</p>
                        </>
                    )}
                </div>
            </div>
            {/* Input for sending messages */}
            <form
                className="chat-input"
                style={{
                    position: "sticky",
                    bottom: 0,
                    width: "100%",
                    display: "flex",
                    flexWrap: "nowrap",
                }}
                onSubmit={(e) => {
                    e.preventDefault();
                    handleClick();
                }}
            >
                <VSCodeTextField
                    placeholder="Type a message..."
                    value={message?.content || ""}
                    onChange={(e) =>
                        setMessage({
                            content: (e.target as HTMLInputElement).value,
                            role: "user",
                        })
                    }
                    style={{ width: "100%" }}
                />
                <VSCodeButton type="submit">Send</VSCodeButton>
            </form>
        </main>
    );
}

export default App;
