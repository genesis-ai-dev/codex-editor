import React from "react";
import {
    VSCodeButton,
    VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react";
import "../src/App.css";

type CommentTextFormProps = {
    handleSubmit: (comment: string) => void;
};

export const CommentTextForm: React.FC<CommentTextFormProps> = ({
    handleSubmit,
}) => {
    return (
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
                const formData = new FormData(e.target as HTMLFormElement);
                const formValue = formData.get("chatInput") as string;
                console.log("Form submitted with value:", formValue);
                handleSubmit(formValue);
                (e.target as HTMLFormElement).reset();
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
        </form>
    );
};
