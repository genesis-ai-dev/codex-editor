import React from "react";
import { useDropzone } from "react-dropzone";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";

interface FileDropzoneProps {
    onDrop: (files: File[]) => void;
    selectedFile?: File | null;
    onClearFile?: () => void;
    type: "source" | "translation" | null;
}

export const FileDropzone: React.FC<FileDropzoneProps> = ({
    onDrop,
    selectedFile,
    onClearFile,
    type = "source",
}) => {
    const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

    return (
        <div>
            <div
                {...getRootProps()}
                style={{
                    border: `2px dashed ${
                        isDragActive
                            ? "var(--vscode-button-background)"
                            : "var(--vscode-widget-border)"
                    }`,
                    borderRadius: "8px",
                    padding: "2rem",
                    textAlign: "center",
                    cursor: "pointer",
                    transition: "border-color 0.3s ease",
                    background: isDragActive
                        ? "var(--vscode-button-hoverBackground)"
                        : "transparent",
                }}
            >
                <input {...getInputProps()} />
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "1rem",
                    }}
                >
                    <i className="codicon codicon-cloud-upload" style={{ fontSize: "2rem" }}></i>
                    <p>
                        {isDragActive
                            ? "Drop the file here"
                            : `Drag and drop your ${type} file here`}
                    </p>
                    <p style={{ color: "var(--vscode-descriptionForeground)", fontSize: "0.9em" }}>
                        or click to select a file
                    </p>
                </div>
            </div>
            {selectedFile && (
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        padding: "0.5rem",
                        background: "var(--vscode-editor-background)",
                        borderRadius: "4px",
                        marginTop: "1rem",
                    }}
                >
                    <i className="codicon codicon-file"></i>
                    <span>{selectedFile.name}</span>
                    <VSCodeButton appearance="secondary" onClick={onClearFile}>
                        <i className="codicon codicon-close"></i>
                    </VSCodeButton>
                </div>
            )}
        </div>
    );
};
