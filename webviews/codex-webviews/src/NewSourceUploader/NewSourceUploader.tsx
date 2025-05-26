import React, { useState, useCallback, useEffect } from "react";
import { VSCodeButton, VSCodeProgressRing, VSCodeDivider } from "@vscode/webview-ui-toolkit/react";
import {
    FileUploadResult,
    UploadProgress,
    NewSourceUploaderPostMessages,
    NewSourceUploaderResponseMessages,
    FileInfo,
    UploadState,
} from "./types";

interface VSCodeApi {
    postMessage: (message: NewSourceUploaderPostMessages) => void;
    setState: (state: any) => void;
    getState: () => any;
}

// Get the VSCode API that was set up in the HTML
const vscode: VSCodeApi = (window as any).vscodeApi;

const NewSourceUploader: React.FC = () => {
    const [uploadState, setUploadState] = useState<UploadState>({
        selectedFile: null,
        isUploading: false,
        progress: [],
        result: null,
        error: null,
    });

    const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            setUploadState((prev) => ({
                ...prev,
                selectedFile: file,
                result: null,
                error: null,
                progress: [],
            }));
        }
    }, []);

    const handleUpload = useCallback(async () => {
        if (!uploadState.selectedFile) return;

        setUploadState((prev) => ({ ...prev, isUploading: true, error: null }));

        try {
            const fileContent = await readFileAsText(uploadState.selectedFile);

            vscode.postMessage({
                command: "uploadFile",
                fileData: {
                    name: uploadState.selectedFile.name,
                    content: fileContent,
                    type:
                        uploadState.selectedFile.type ||
                        getFileTypeFromName(uploadState.selectedFile.name),
                },
            });
        } catch (error) {
            setUploadState((prev) => ({
                ...prev,
                isUploading: false,
                error: `Failed to read file: ${
                    error instanceof Error ? error.message : "Unknown error"
                }`,
            }));
        }
    }, [uploadState.selectedFile]);

    const handleReset = useCallback(() => {
        setUploadState({
            selectedFile: null,
            isUploading: false,
            progress: [],
            result: null,
            error: null,
        });
        vscode.postMessage({ command: "reset" });
    }, []);

    const readFileAsText = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target?.result?.toString() || "");
            reader.onerror = reject;
            reader.readAsText(file);
        });
    };

    const getFileTypeFromName = (fileName: string): string => {
        const extension = fileName.split(".").pop()?.toLowerCase();
        switch (extension) {
            case "csv":
                return "text/csv";
            case "tsv":
                return "text/tab-separated-values";
            case "txt":
                return "text/plain";
            default:
                return "text/plain";
        }
    };

    const formatFileSize = (bytes: number): string => {
        if (bytes === 0) return "0 Bytes";
        const k = 1024;
        const sizes = ["Bytes", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    };

    const getFileInfo = (file: File): FileInfo => ({
        name: file.name,
        size: file.size,
        type: file.type || getFileTypeFromName(file.name),
        lastModified: file.lastModified,
    });

    const getProgressIcon = (status: UploadProgress["status"]) => {
        switch (status) {
            case "success":
                return "✓";
            case "error":
                return "✗";
            case "processing":
                return "⟳";
            default:
                return "○";
        }
    };

    // Handle messages from the extension
    useEffect(() => {
        const handleMessage = (event: MessageEvent<NewSourceUploaderResponseMessages>) => {
            const message = event.data;

            switch (message.command) {
                case "uploadResult":
                    setUploadState((prev) => ({
                        ...prev,
                        isUploading: false,
                        result: message.result || null,
                    }));
                    break;

                case "progressUpdate":
                    setUploadState((prev) => ({
                        ...prev,
                        progress: message.progress || [],
                    }));
                    break;

                case "error":
                    setUploadState((prev) => ({
                        ...prev,
                        isUploading: false,
                        error: message.error || "Unknown error occurred",
                    }));
                    break;
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, []);

    return (
        <div className="new-source-uploader">
            <div className="upload-section">
                <h2>📁 New Source Uploader</h2>
                <p>Upload CSV, TSV, or text files to create source and translation notebooks.</p>

                <div className="file-input-container">
                    <input
                        type="file"
                        accept=".csv,.tsv,.txt"
                        onChange={handleFileSelect}
                        className="file-input"
                        disabled={uploadState.isUploading}
                    />
                </div>

                {uploadState.selectedFile && (
                    <div className="file-info">
                        <p>
                            <strong>File:</strong> {getFileInfo(uploadState.selectedFile).name}
                        </p>
                        <p>
                            <strong>Size:</strong>{" "}
                            {formatFileSize(getFileInfo(uploadState.selectedFile).size)}
                        </p>
                        <p>
                            <strong>Type:</strong> {getFileInfo(uploadState.selectedFile).type}
                        </p>
                        <p>
                            <strong>Modified:</strong>{" "}
                            {new Date(
                                getFileInfo(uploadState.selectedFile).lastModified
                            ).toLocaleString()}
                        </p>
                    </div>
                )}

                <div className="upload-button">
                    <VSCodeButton
                        onClick={handleUpload}
                        disabled={!uploadState.selectedFile || uploadState.isUploading}
                        appearance="primary"
                    >
                        {uploadState.isUploading ? (
                            <>
                                <VSCodeProgressRing /> Processing...
                            </>
                        ) : (
                            "Upload File"
                        )}
                    </VSCodeButton>

                    {(uploadState.result || uploadState.error) && (
                        <VSCodeButton
                            onClick={handleReset}
                            appearance="secondary"
                            style={{ marginLeft: "10px" }}
                        >
                            Reset
                        </VSCodeButton>
                    )}
                </div>
            </div>

            {uploadState.progress.length > 0 && (
                <div className="upload-section">
                    <h3>📊 Progress</h3>
                    <div className="progress-section">
                        {uploadState.progress.map((item, index) => (
                            <div key={index} className="progress-item">
                                <span className={`progress-icon ${item.status}`}>
                                    {getProgressIcon(item.status)}
                                </span>
                                <div className="progress-text">
                                    <div>
                                        <strong>{item.stage}</strong>
                                    </div>
                                    <div className="progress-status">{item.message}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {uploadState.result && (
                <div className="upload-section">
                    <h3>✅ Upload Complete</h3>
                    <div
                        className={`file-info ${uploadState.result.success ? "success" : "error"}`}
                    >
                        <p>
                            <strong>Status:</strong>{" "}
                            {uploadState.result.success ? "Success" : "Failed"}
                        </p>
                        <p>
                            <strong>Message:</strong> {uploadState.result.message}
                        </p>
                        {uploadState.result.preview && (
                            <div className="preview-section">
                                <h4>Preview:</h4>
                                <div className="preview-content">
                                    <pre>{uploadState.result.preview}</pre>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {uploadState.error && (
                <div className="upload-section">
                    <h3>❌ Error</h3>
                    <div className="file-info error">
                        <p>{uploadState.error}</p>
                    </div>
                </div>
            )}

            <VSCodeDivider />

            <div className="supported-formats">
                <h3>📋 Supported File Types</h3>
                <ul>
                    <li>
                        <strong>CSV files (.csv)</strong> - Comma-separated values with automatic
                        column detection
                    </li>
                    <li>
                        <strong>TSV files (.tsv)</strong> - Tab-separated values with automatic
                        column detection
                    </li>
                    <li>
                        <strong>Text files (.txt)</strong> - Plain text files split by paragraphs or
                        lines
                    </li>
                </ul>
                <p>
                    <em>
                        The uploader automatically detects source, target, and ID columns for
                        translation pairs.
                    </em>
                </p>
            </div>
        </div>
    );
};

export default NewSourceUploader;
