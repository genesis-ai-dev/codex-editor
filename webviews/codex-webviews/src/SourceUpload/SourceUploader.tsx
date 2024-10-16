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
import { SourceUploadPostMessages } from "../../../../types";
const vscode = acquireVsCodeApi();

interface AggregatedMetadata {
    id: string;
    originalName: string;
    sourceFsPath?: string;
    codexFsPath?: string;
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
    const [shouldShowImporter, setShouldShowImporter] = useState<boolean>(false);

    useEffect(() => {
        vscode.postMessage({ command: "getMetadata" } as SourceUploadPostMessages);

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
                } as SourceUploadPostMessages);
            };
            reader.readAsText(selectedFile);
        }
        setShouldShowImporter(false);
    };

    const toggleDisplayImporter = () => {
        setShouldShowImporter(!shouldShowImporter);
    };

    const handleDownloadBible = () => {
        vscode.postMessage({ command: "downloadBible" } as SourceUploadPostMessages);
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
        const fileUri = metadata.sourceFsPath || metadata.codexFsPath;
        if (fileUri) {
            vscode.postMessage({
                command: "syncAction",
                status: metadata.gitStatus,
                fileUri,
            } as SourceUploadPostMessages);
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

    const handleOpenFile = (fileUri: string | undefined) => {
        console.log("handleOpenFile", { fileUri });
        if (fileUri) {
            vscode.postMessage({
                command: "openFile",
                fileUri,
            } as SourceUploadPostMessages);
        }
    };

    return (
        <div style={{ padding: "16px", maxWidth: "1200px", margin: "0 auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "24px" }}>
                <h1 style={{ fontSize: "24px", fontWeight: "bold" }}>Source Manager</h1>
                {shouldShowImporter ? (
                    <div>
                        <VSCodeButton onClick={toggleDisplayImporter} aria-label="Close Importer">
                            <i className="codicon codicon-close"></i>
                        </VSCodeButton>
                    </div>
                ) : (
                    <div style={{ display: "flex", gap: "0.2em" }}>
                        <VSCodeButton
                            onClick={() => {
                                setIsSourceUpload(false);
                                toggleDisplayImporter();
                            }}
                            aria-label="Add new translation"
                        >
                            <i className="codicon codicon-insert"></i>
                        </VSCodeButton>
                        <VSCodeButton
                            onClick={() => {
                                setIsSourceUpload(true);
                                toggleDisplayImporter();
                            }}
                            aria-label="Add new source"
                        >
                            <i className="codicon codicon-add"></i>
                        </VSCodeButton>
                        <VSCodeButton onClick={handleDownloadBible} aria-label="Download Bible">
                            <i className="codicon codicon-cloud-download"></i>
                        </VSCodeButton>
                    </div>
                )}
            </div>

            {shouldShowImporter && (
                <div
                    style={{
                        marginBottom: "2rem",
                        boxShadow: "0 0 10px 0 rgba(0, 0, 0, 0.1)",
                        padding: "1rem",
                        borderRadius: "0.5rem",
                    }}
                >
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
                            Drag 'n' drop a {isSourceUpload ? "source" : "translation"} file here,
                            or click to select
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
                                    .filter((metadata) => metadata.sourceFsPath)
                                    .map((metadata) => (
                                        <VSCodeOption
                                            key={metadata.id}
                                            value={metadata.originalName}
                                        >
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
                        <i
                            className="codicon codicon-cloud-upload"
                            style={{ marginRight: "8px" }}
                        ></i>
                        Upload {isSourceUpload ? "Source" : "Translation"}
                    </VSCodeButton>
                </div>
            )}

            <div
                style={{
                    height: "100%",
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
                                {metadata.sourceFsPath ? (
                                    <VSCodeButton
                                        appearance="icon"
                                        onClick={() => handleOpenFile(metadata.sourceFsPath)}
                                    >
                                        <i
                                            className="codicon codicon-open-preview"
                                            title="Open Source"
                                        ></i>
                                    </VSCodeButton>
                                ) : (
                                    "Missing"
                                )}
                            </VSCodeDataGridCell>
                            <VSCodeDataGridCell>
                                {metadata.codexFsPath ? (
                                    <div style={{ display: "flex", gap: "0.2em" }}>
                                        <VSCodeButton
                                            appearance="icon"
                                            onClick={() => handleOpenFile(metadata.codexFsPath)}
                                        >
                                            <i
                                                className="codicon codicon-link-external"
                                                title="Open Codex Draft Notebook"
                                            ></i>
                                        </VSCodeButton>
                                        <VSCodeButton
                                            appearance="icon"
                                            onClick={() => handleImportTranslation(metadata)}
                                        >
                                            <i
                                                className="codicon codicon-insert"
                                                title="Import Translations"
                                            ></i>
                                        </VSCodeButton>
                                    </div>
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
        </div>
    );
};

export default SourceUploader;
