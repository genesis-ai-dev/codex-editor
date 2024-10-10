import React from "react";
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import { TextFieldType } from "@vscode/webview-ui-toolkit";
import { CustomNotebookMetadata } from "../../../../types";

interface NotebookMetadataModalProps {
    isOpen: boolean;
    onClose: () => void;
    metadata: CustomNotebookMetadata;
    onMetadataChange: (key: string, value: string) => void;
    onSave: () => void;
    onPickFile: () => void;
    tempVideoUrl: string;
}

const NotebookMetadataModal: React.FC<NotebookMetadataModalProps> = ({
    isOpen,
    onClose,
    metadata,
    onMetadataChange,
    onSave,
    onPickFile,
    tempVideoUrl,
}) => {
    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <h2>Edit Notebook Metadata</h2>
                <form>
                    {Object.entries(metadata).map(([key, value]) => {
                        if (key === "videoUrl") {
                            return (
                                <div key={key} className="form-field">
                                    <label>{key}:</label>
                                    <div className="input-with-button">
                                        <VSCodeTextField
                                            type="text"
                                            value={tempVideoUrl || (value as string)}
                                            onChange={(e: any) =>
                                                onMetadataChange(key, e.target.value)
                                            }
                                            placeholder="Enter video URL"
                                        />
                                        <VSCodeButton
                                            onClick={onPickFile}
                                            appearance="icon"
                                            title="Pick Video File"
                                        >
                                            <i className="codicon codicon-folder"></i>
                                        </VSCodeButton>
                                    </div>
                                </div>
                            );
                        }

                        let inputType: TextFieldType | "number" = "text";
                        let isReadOnly = false;
                        let displayValue: string = "";

                        if (typeof value === "number") {
                            inputType = "number";
                            displayValue = value.toString();
                        } else if (typeof value === "string") {
                            displayValue = value;
                        } else if (typeof value === "object" && value !== null) {
                            isReadOnly = true;
                            displayValue = JSON.stringify(value);
                        } else {
                            displayValue = String(value);
                        }

                        const readOnlyKeywords = ["path", "uri", "originalName", "sourceFile"];
                        const hideFieldKeywords = ["data", "navigation"];

                        if (
                            readOnlyKeywords.some((keyword) => key.includes(keyword)) ||
                            key === "id"
                        ) {
                            isReadOnly = true;
                        }

                        if (hideFieldKeywords.some((keyword) => key.includes(keyword))) {
                            return null;
                        }

                        return (
                            <div key={key} className="form-field">
                                <label>{key}:</label>
                                <VSCodeTextField
                                    type={inputType as TextFieldType}
                                    value={displayValue}
                                    onChange={(e: any) =>
                                        !isReadOnly && onMetadataChange(key, e.target.value)
                                    }
                                    placeholder={isReadOnly ? "Read-only" : `Enter ${key}`}
                                    readOnly={isReadOnly}
                                />
                            </div>
                        );
                    })}
                </form>
                <div className="modal-actions">
                    <VSCodeButton onClick={onSave}>Save</VSCodeButton>
                    <VSCodeButton onClick={onClose} appearance="secondary">
                        Cancel
                    </VSCodeButton>
                </div>
            </div>
        </div>
    );
};

export default NotebookMetadataModal;
