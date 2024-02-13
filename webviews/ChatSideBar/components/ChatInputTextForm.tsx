import React from "react";
import {
    VSCodeButton,
    VSCodeTextArea,
    VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react";
import "../src/App.css";

type CommentTextFormProps = {
    handleSubmit: (comment: string) => void;
    contextItems: string[];
    selectedText: string;
};

export const ChatInputTextForm: React.FC<CommentTextFormProps> = ({
    handleSubmit,
    contextItems,
    selectedText,
}) => {
    return (
        <form
            className="chat-input"
            style={{
                position: "sticky",
                bottom: 0,
                width: "100%",
                display: "flex",
                flexDirection: "column",
                gap: "0.25em",
                alignItems: "center",
                paddingInline: "0.5em",
                background: "var(--vscode-sideBar-background)",
            }}
            onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.target as HTMLFormElement);
                const formValue = formData.get("chatInput") as string;
                console.log("Form submitted with value:", formValue);
                handleSubmit(formValue);
                (e.target as HTMLFormElement).reset();
            }}
        >
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.5em",
                }}
            >
                {contextItems.length > 0 && (
                    <VSCodeTextArea
                        readOnly
                        title="Context Items"
                        value={contextItems?.join("\n")}
                        placeholder="Context Items..."
                        style={{ flexGrow: 1, marginBottom: "0.5em" }}
                    />
                )}
                {selectedText && (
                    <VSCodeTextArea
                        readOnly
                        title="Selected Text"
                        value={selectedText}
                        placeholder="Selected Text..."
                        style={{ flexGrow: 1 }}
                    />
                )}
            </div>
            <div
                style={{
                    display: "flex",
                    flexDirection: "row",
                    gap: "0.5em",
                }}
            >
                <VSCodeButton
                    aria-label="Attach"
                    onClick={() => console.log("Attach clicked")}
                >
                    <i className="codicon codicon-add"></i>
                </VSCodeButton>
                <VSCodeTextField
                    name="chatInput"
                    placeholder="Type a message..."
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
            </div>
        </form>
    );
};
