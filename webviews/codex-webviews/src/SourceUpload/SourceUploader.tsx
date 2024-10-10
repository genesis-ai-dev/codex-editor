import React, { useEffect, useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { VSCodeButton, VSCodeCheckbox, VSCodeDivider } from "@vscode/webview-ui-toolkit/react";
import { FileType, SupportedFileExtension } from "../../../../types";

const vscode = acquireVsCodeApi();

interface CodexFile {
    name: string;
    uri: string;
}

const fileTypeMap: Record<SupportedFileExtension, FileType> = {
    vtt: "subtitles",
    txt: "plaintext",
    usfm: "usfm",
    sfm: "usfm",
    SFM: "usfm",
    USFM: "usfm",
};

const SourceUploader: React.FC = () => {
    const [sourceFiles, setSourceFiles] = useState<CodexFile[]>([]);
    const [targetFiles, setTargetFiles] = useState<CodexFile[]>([]);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [fileType, setFileType] = useState<FileType | "">("");
    const [isSourceUpload, setIsSourceUpload] = useState<boolean>(false);
    const [selectedSourceFile, setSelectedSourceFile] = useState<string | null>(null);
    const [isFolder, setIsFolder] = useState<boolean>(false);

    useEffect(() => {
        vscode.postMessage({ command: "getCodexFiles" });
    }, []);

    const onDrop = useCallback((acceptedFiles: File[]) => {
        if (acceptedFiles.length > 0) {
            setSelectedFile(acceptedFiles[0]);
            setIsFolder(acceptedFiles[0].type === ""); // Empty type usually indicates a folder
            const extension = acceptedFiles[0].name.split(".").pop() as SupportedFileExtension;
            setFileType(fileTypeMap[extension] || "plaintext");
        }
    }, []);

    const { getRootProps, getInputProps } = useDropzone({ onDrop });

    const handleUpload = async () => {
        if (selectedFile && (fileType || isFolder)) {
            if (isFolder) {
                vscode.postMessage({
                    command: isSourceUpload ? "uploadSourceFolder" : "uploadTranslationFolder",
                    folderName: selectedFile.name,
                    sourceFileName: selectedSourceFile,
                });
            } else {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const content = e.target?.result?.toString() || "";
                    vscode.postMessage({
                        command: isSourceUpload ? "uploadSourceText" : "uploadTranslation",
                        fileContent: content,
                        fileType: fileType,
                        fileName: selectedFile.name,
                        sourceFileName: selectedSourceFile,
                    });
                };
                reader.readAsText(selectedFile);
            }
        }
    };

    const handleDownloadBible = () => {
        vscode.postMessage({ command: "downloadBible" });
    };

    window.addEventListener("message", (event) => {
        const message = event.data;
        switch (message.command) {
            case "updateCodexFiles":
                setSourceFiles(message.sourceFiles);
                setTargetFiles(message.targetFiles);
                break;
        }
    });

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
            <h1>File Upload</h1>

            <VSCodeCheckbox
                checked={isSourceUpload}
                onChange={() => setIsSourceUpload(!isSourceUpload)}
            >
                Upload Source Text
            </VSCodeCheckbox>

            <h2>Existing Source Files (.source)</h2>
            <ul>
                {sourceFiles.map((file) => (
                    <li key={file.uri}>{file.name}</li>
                ))}
            </ul>

            <h2>Existing Target Files (.codex)</h2>
            <ul>
                {targetFiles.map((file) => (
                    <li key={file.uri}>{file.name}</li>
                ))}
            </ul>

            <div
                {...getRootProps()}
                style={{ border: "2px dashed #ccc", padding: "20px", marginTop: "20px" }}
            >
                <input {...getInputProps()} />
                <p>
                    Drag 'n' drop a {isSourceUpload ? "source" : "translation"} file or folder here,
                    or click to select a file or folder
                </p>
            </div>
            {selectedFile && (
                <p>
                    Selected {isFolder ? "folder" : "file"}: {selectedFile.name}
                </p>
            )}

            {!isSourceUpload && (
                <div>
                    <h3>Select corresponding source file:</h3>
                    <select
                        value={selectedSourceFile || ""}
                        onChange={(e) => setSelectedSourceFile(e.target.value)}
                    >
                        <option value="">Select a source file</option>
                        {sourceFiles.map((file) => (
                            <option key={file.uri} value={file.name}>
                                {file.name}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            <VSCodeButton
                onClick={handleUpload}
                disabled={!selectedFile || (!isSourceUpload && !selectedSourceFile)}
            >
                Upload {isSourceUpload ? "Source Text" : "Translation"}
            </VSCodeButton>

            <VSCodeDivider />

            <h2>Download Bible from eBible Corpus</h2>
            <VSCodeButton onClick={handleDownloadBible}>Download Bible</VSCodeButton>
        </div>
    );
};

export default SourceUploader;
