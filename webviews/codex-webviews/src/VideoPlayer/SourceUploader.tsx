import React, { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useVSCodeMessageHandler } from "./hooks/useVSCodeMessageHandler";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";

const vscode = acquireVsCodeApi();
(window as any).vscodeApi = vscode;

const SourceUploader: React.FC = () => {
    const [fileContent, setFileContent] = React.useState<string>("");
    const [selectedFile, setSelectedFile] = useState<File>();

    useVSCodeMessageHandler({
        setFile: (file: File) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const content = e.target?.result?.toString() || "";
                setFileContent(content);
            };
            reader.readAsText(file);
        },
    });

    const onDrop = useCallback((acceptedFiles: File[]) => {
        setSelectedFile(acceptedFiles[0]);
    }, []);

    useEffect(() => {
        if (selectedFile) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const content = e.target?.result?.toString() || "";
                setFileContent(content);
            };
            reader.readAsText(selectedFile);
        }
    }, [selectedFile]);

    const { getRootProps, getInputProps } = useDropzone({
        onDrop,
    });

    const handleUpload = () => {
        if (selectedFile) {
            vscode.postMessage({ command: "createCodexNotebookFromWebVTT", fileContent });
        }
    };

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "10px",
                height: "80vh",
                justifyContent: "center",
            }}
        >
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "10px",
                    backgroundColor: "var(--vscode-sideBar-background)",
                    padding: "50px 50px 55px 50px",
                    borderRadius: "10px",
                }}
            >
                <h1>Upload a Source File</h1>
                <div className="dropzone">
                    <input {...getInputProps()} />
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: "20px",
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "row",
                                alignItems: "center",
                                gap: "10px",
                                marginTop: "10px",
                                marginBottom: "15px",
                            }}
                        >
                            <i className="codicon codicon-file" style={{ fontSize: "40px" }}></i>
                            <i
                                className="codicon codicon-arrow-right"
                                style={{ fontSize: "40px" }}
                            ></i>
                            <i className="codicon codicon-folder" style={{ fontSize: "40px" }}></i>
                        </div>

                        {selectedFile ? (
                            <>
                                <h2>Selected file: {selectedFile.name}</h2>
                                <div
                                    style={{
                                        display: "flex",
                                        flexDirection: "row",
                                        alignItems: "center",
                                        gap: "10px",
                                    }}
                                >
                                    <VSCodeButton type="button" onClick={handleUpload}>
                                        <i
                                            className="codicon codicon-check"
                                            style={{ fontSize: "40px" }}
                                        ></i>
                                    </VSCodeButton>
                                    <VSCodeButton
                                        type="button"
                                        onClick={() => setSelectedFile(undefined)}
                                        style={{ backgroundColor: "red" }}
                                    >
                                        <i
                                            className="codicon codicon-close"
                                            style={{ fontSize: "40px" }}
                                        ></i>
                                    </VSCodeButton>
                                </div>
                            </>
                        ) : (
                            <VSCodeButton {...getRootProps()}>
                                <i
                                    className="codicon codicon-cloud-upload"
                                    style={{ fontSize: "40px" }}
                                ></i>
                            </VSCodeButton>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SourceUploader;
