import React from "react";
import {
    VSCodeButton,
    VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react";

export type CommentTextFormProps = {
    handleSubmit: (args: {
        comment: string;
        title: string;
        threadId: string | null;
    }) => void;
    showTitleInput?: boolean;
    threadId: string | null;
};

export const CommentTextForm: React.FC<CommentTextFormProps> = ({
    handleSubmit,
    showTitleInput,
    threadId,
}) => {
    return (
        <form
            className="comments-input"
            style={{
                position: "sticky",
                bottom: 0,
                width: "100%",
                display: "flex",
                flexWrap: "nowrap",
                boxShadow:
                    "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
            }}
            onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.target as HTMLFormElement);
                const comment = formData.get("comment") as string;
                const title = formData.get("title") as string;

                handleSubmit({ comment, title, threadId });
                (e.target as HTMLFormElement).reset();
            }}
        >
            {showTitleInput && (
                <div
                    style={{
                        display: "flex",
                        flexFlow: "column nowrap",
                        padding: "0.5em 0",
                        width: "100%",
                    }}
                >
                    <label
                        htmlFor="title"
                        style={{ display: "block", marginBottom: "0.5em" }}
                    >
                        Title:
                    </label>
                    <VSCodeTextField
                        id="title"
                        name="title"
                        placeholder="Type the title..."
                        style={{ width: "100%", marginBottom: "1em" }}
                    />
                </div>
            )}
            <div style={{ padding: "0.5em 0", width: "100%" }}>
                <label
                    htmlFor="comment"
                    style={{ display: "block", marginBottom: "0.5em" }}
                >
                    Comment:
                </label>
                <VSCodeTextField
                    id="comment"
                    name="comment"
                    placeholder="Type your comment..."
                    style={{ width: "100%", marginBottom: "1em" }}
                />
            </div>
            <VSCodeButton type="submit" style={{ padding: "0.5em" }}>
                Save
            </VSCodeButton>
        </form>
    );
};
