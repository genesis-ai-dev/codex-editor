import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { formatFileSize } from "../../../../../src/utils/formatters";

interface FileConfirmationProps {
    file: File;
    importType: "source" | "translation";
    onConfirm: () => void;
    onCancel: () => void;
}

export const FileConfirmation: React.FC<FileConfirmationProps> = ({
    file,
    importType,
    onConfirm,
    onCancel,
}) => {
    // Ensure we have a valid number for the file size
    const fileSize = typeof file.size === "number" ? formatFileSize(file.size) : "Unknown size";

    return (
        <div style={{ padding: "2rem", textAlign: "center" }}>
            <h2 style={{ marginBottom: "1rem" }}>Confirm File Selection</h2>
            <p style={{ marginBottom: "2rem" }}>You selected the following {importType} file:</p>
            <div
                style={{
                    padding: "1rem",
                    background: "var(--vscode-editor-background)",
                    borderRadius: "4px",
                    marginBottom: "2rem",
                }}
            >
                <p>
                    <strong>Name:</strong> {file.name}
                </p>
                <p>
                    <strong>Size:</strong> {fileSize}
                </p>
                <p>
                    <strong>Type:</strong> {file.type || "Unknown"}
                </p>
            </div>
            <div style={{ display: "flex", gap: "1rem", justifyContent: "center" }}>
                <VSCodeButton appearance="secondary" onClick={onCancel}>
                    Choose Different File
                </VSCodeButton>
                <VSCodeButton onClick={onConfirm}>Continue with this File</VSCodeButton>
            </div>
        </div>
    );
};
