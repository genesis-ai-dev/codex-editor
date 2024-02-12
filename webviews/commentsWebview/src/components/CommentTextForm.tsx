import React from "react";
import {
    VSCodeButton,
    VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react";

type CommentTextFormProps = {
    handleSubmit: (comment: string) => void;
};

export const CommentTextForm: React.FC<CommentTextFormProps> = ({
    handleSubmit,
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
            }}
            onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.target as HTMLFormElement);
                const formValue = formData.get("comment") as string;
                console.log("Form submitted with value:", formValue);
                handleSubmit(formValue);
                (e.target as HTMLFormElement).reset();
            }}
        >
            <VSCodeTextField
                name="comment"
                placeholder="Type a message..."
                style={{ width: "100%" }}
            />
            <VSCodeButton type="submit">Save</VSCodeButton>
        </form>
    );
};
