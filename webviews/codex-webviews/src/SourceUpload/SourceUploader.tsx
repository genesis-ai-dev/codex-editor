import React, { useEffect, useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import {
    VSCodeButton,
    VSCodeDataGrid,
    VSCodeDataGridRow,
    VSCodeDataGridCell,
    VSCodeDropdown,
    VSCodeOption,
} from "@vscode/webview-ui-toolkit/react";

const vscode = acquireVsCodeApi();

interface AggregatedMetadata {
    id: string;
    originalName: string;
    sourceUri?: string;
    codexUri?: string;
    videoUrl?: string;
    lastModified?: string;
    gitStatus?:
        | "uninitialized"
        | "modified"
        | "added"
        | "deleted"
        | "renamed"
        | "conflict"
        | "untracked"
        | "committed";
}

const SourceUploader: React.FC = () => {
    const [aggregatedMetadata, setAggregatedMetadata] = useState<AggregatedMetadata[]>([]);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isSourceUpload, setIsSourceUpload] = useState<boolean>(true);
    const [selectedSourceFile, setSelectedSourceFile] = useState<string | null>(null);

    useEffect(() => {
        vscode.postMessage({ command: "getMetadata" });

        const messageHandler = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case "updateMetadata":
                    setAggregatedMetadata(message.metadata);
                    break;
            }
        };

        window.addEventListener("message", messageHandler);

        return () => {
            window.removeEventListener("message", messageHandler);
        };
    }, []);

    const onDrop = useCallback((acceptedFiles: File[]) => {
        if (acceptedFiles.length > 0) {
            setSelectedFile(acceptedFiles[0]);
        }
    }, []);

    const { getRootProps, getInputProps } = useDropzone({ onDrop });

    const handleUpload = async () => {
        if (selectedFile) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const content = e.target?.result?.toString() || "";
                vscode.postMessage({
                    command: isSourceUpload ? "uploadSourceText" : "uploadTranslation",
                    fileContent: content,
                    fileName: selectedFile.name,
                    sourceFileName: selectedSourceFile,
                });
            };
            reader.readAsText(selectedFile);
        }
    };

    const handleDownloadBible = () => {
        vscode.postMessage({ command: "downloadBible" });
    };

    const handleImportTranslation = (metadata: AggregatedMetadata) => {
        setIsSourceUpload(false);
        setSelectedSourceFile(metadata.originalName);
    };

    const GetSyncStatus: React.FC<{
        metadata: AggregatedMetadata;
        onClick: (status: string) => void;
    }> = ({ metadata, onClick }) => {
        const status = metadata.gitStatus || "Unknown";
        const iconClass = `codicon codicon-${
            status === "uninitialized"
                ? "repo"
                : status === "modified"
                  ? "git-commit"
                  : status === "added"
                    ? "diff-added"
                    : status === "deleted"
                      ? "diff-removed"
                      : status === "renamed"
                        ? "diff-renamed"
                        : status === "conflict"
                          ? "git-merge"
                          : status === "untracked"
                            ? "file-add"
                            : status === "committed"
                              ? "check"
                              : "question"
        }`;
        return (
            <i
                className={iconClass}
                onClick={() => onClick(status)}
                aria-label={`Sync status: ${status}`}
            ></i>
        );
    };

    const handleSyncStatusClick = (metadata: AggregatedMetadata) => {
        const fileUri = metadata.sourceUri || metadata.codexUri;
        if (fileUri) {
            vscode.postMessage({ command: "syncAction", status: metadata.gitStatus, fileUri });
        } else {
            console.error("No file URI available for sync action");
        }
    };

    const getAttachments = (
        metadata: AggregatedMetadata & { audioUrl?: string; imageUrls?: string[] }
    ): JSX.Element => {
        const attachments = [];
        if (metadata.videoUrl)
            attachments.push(
                <i className="codicon codicon-file-media" title="Video" key="video"></i>
            );
        if (metadata.audioUrl)
            attachments.push(
                <i className="codicon codicon-file-media" title="Audio" key="audio"></i>
            );
        if (metadata.imageUrls && metadata.imageUrls.length > 0)
            attachments.push(
                <i className="codicon codicon-file-media" title="Images" key="images"></i>
            );

        return <span>{attachments.length > 0 ? attachments : "None"}</span>;
    };

    const handleOpenCodexNotebook = (fileUri: string | undefined) => {
        if (fileUri) {
            vscode.postMessage({
                command: "openCodexNotebook",
                fileUri,
            });
        }
    };

    return (
        <div style={{ padding: "16px", maxWidth: "1200px", margin: "0 auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "24px" }}>
                <h1 style={{ fontSize: "24px", fontWeight: "bold" }}>Source Manager</h1>
                <div>
                    <VSCodeButton
                        onClick={() => setIsSourceUpload(true)}
                        aria-label="Add new source"
                    >
                        <i className="codicon codicon-add"></i>
                    </VSCodeButton>
                    <VSCodeButton
                        onClick={handleDownloadBible}
                        style={{ marginLeft: "8px" }}
                        aria-label="Download Bible"
                    >
                        <i className="codicon codicon-cloud-download"></i>
                    </VSCodeButton>
                </div>
            </div>

            <div
                style={{
                    height: "400px",
                    overflow: "auto",
                    marginBottom: "32px",
                    border: "1px solid var(--vscode-widget-border)",
                }}
            >
                <VSCodeDataGrid
                    aria-label="Source and Target Files"
                    style={{ display: "flex", flexDirection: "column" }}
                >
                    <VSCodeDataGridRow
                        row-type="header"
                        style={{ display: "flex", justifyContent: "space-between" }}
                    >
                        <VSCodeDataGridCell cell-type="columnheader">Name</VSCodeDataGridCell>
                        <VSCodeDataGridCell cell-type="columnheader">
                            Source File
                        </VSCodeDataGridCell>
                        <VSCodeDataGridCell cell-type="columnheader">
                            Target File
                        </VSCodeDataGridCell>
                        <VSCodeDataGridCell cell-type="columnheader">
                            Attachments
                        </VSCodeDataGridCell>
                        <VSCodeDataGridCell cell-type="columnheader">
                            Last Modified
                        </VSCodeDataGridCell>
                        <VSCodeDataGridCell cell-type="columnheader">
                            Sync Status
                        </VSCodeDataGridCell>
                        <VSCodeDataGridCell cell-type="columnheader">Actions</VSCodeDataGridCell>
                    </VSCodeDataGridRow>
                    {aggregatedMetadata.map((metadata) => (
                        <VSCodeDataGridRow
                            key={metadata.id}
                            style={{ display: "flex", justifyContent: "space-between" }}
                        >
                            <VSCodeDataGridCell>{metadata.originalName}</VSCodeDataGridCell>
                            <VSCodeDataGridCell>
                                {metadata.sourceUri
                                    ? metadata.sourceUri.split("/").pop()
                                    : "Missing"}
                            </VSCodeDataGridCell>
                            <VSCodeDataGridCell>
                                {metadata.codexUri ? (
                                    <a
                                        href="#"
                                        onClick={() => handleOpenCodexNotebook(metadata.codexUri)}
                                        style={{
                                            color: "var(--vscode-textLink-foreground)",
                                            textDecoration: "underline",
                                        }}
                                    >
                                        {metadata.codexUri.split("/").pop()}
                                    </a>
                                ) : (
                                    "Missing"
                                )}
                            </VSCodeDataGridCell>
                            <VSCodeDataGridCell>{getAttachments(metadata)}</VSCodeDataGridCell>
                            <VSCodeDataGridCell>
                                {metadata.lastModified
                                    ? new Date(metadata.lastModified).toLocaleString("en-US", {
                                          year: "numeric",
                                          month: "numeric",
                                          day: "numeric",
                                          hour: "2-digit",
                                          minute: "2-digit",
                                          second: "2-digit",
                                          hour12: false,
                                      })
                                    : "N/A"}
                            </VSCodeDataGridCell>
                            <VSCodeDataGridCell>
                                <GetSyncStatus
                                    metadata={metadata}
                                    onClick={() => handleSyncStatusClick(metadata)}
                                />
                            </VSCodeDataGridCell>
                            <VSCodeDataGridCell>
                                <VSCodeButton
                                    appearance="icon"
                                    onClick={() => console.log("Edit", metadata.id)}
                                    aria-label="Edit"
                                >
                                    <i className="codicon codicon-edit"></i>
                                </VSCodeButton>
                                <VSCodeButton
                                    appearance="icon"
                                    onClick={() => console.log("Open", metadata.id)}
                                    aria-label="Open"
                                >
                                    <i className="codicon codicon-go-to-file"></i>
                                </VSCodeButton>
                                <VSCodeButton
                                    appearance="icon"
                                    onClick={() => handleImportTranslation(metadata)}
                                    aria-label="Import translation"
                                >
                                    <i className="codicon codicon-import"></i>
                                </VSCodeButton>
                            </VSCodeDataGridCell>
                        </VSCodeDataGridRow>
                    ))}
                </VSCodeDataGrid>
            </div>

            <div>
                <h2 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "8px" }}>
                    {isSourceUpload ? "Upload New Source" : "Import Translation"}
                </h2>
                <div
                    {...getRootProps()}
                    style={{
                        border: "2px dashed var(--vscode-widget-border)",
                        borderRadius: "4px",
                        padding: "32px",
                        textAlign: "center",
                        cursor: "pointer",
                    }}
                >
                    <input {...getInputProps()} />
                    <p style={{ color: "var(--vscode-foreground)" }}>
                        <i
                            className="codicon codicon-cloud-upload"
                            style={{ marginRight: "8px" }}
                        ></i>
                        Drag 'n' drop a {isSourceUpload ? "source" : "translation"} file here, or
                        click to select
                    </p>
                </div>

                {selectedFile && (
                    <p style={{ marginTop: "8px", fontSize: "14px" }}>
                        Selected file: {selectedFile.name}
                    </p>
                )}

                {!isSourceUpload && (
                    <div style={{ marginTop: "16px" }}>
                        <label
                            htmlFor="sourceFile"
                            style={{ display: "block", marginBottom: "4px", fontSize: "14px" }}
                        >
                            Select corresponding source file:
                        </label>
                        <VSCodeDropdown
                            id="sourceFile"
                            value={selectedSourceFile || ""}
                            onChange={(e) =>
                                setSelectedSourceFile((e.target as HTMLSelectElement).value)
                            }
                        >
                            <VSCodeOption value="">Select a source file</VSCodeOption>
                            {aggregatedMetadata
                                .filter((metadata) => metadata.sourceUri)
                                .map((metadata) => (
                                    <VSCodeOption key={metadata.id} value={metadata.originalName}>
                                        {metadata.originalName}
                                    </VSCodeOption>
                                ))}
                        </VSCodeDropdown>
                    </div>
                )}

                <VSCodeButton
                    style={{ marginTop: "16px" }}
                    onClick={handleUpload}
                    disabled={!selectedFile || (!isSourceUpload && !selectedSourceFile)}
                >
                    <i className="codicon codicon-cloud-upload" style={{ marginRight: "8px" }}></i>
                    Upload {isSourceUpload ? "Source" : "Translation"}
                </VSCodeButton>
            </div>
        </div>
    );
};

export default SourceUploader;
