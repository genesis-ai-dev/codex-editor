import React, { useState } from "react";
import { useVSCodeMessageHandler } from "./hooks/useVSCodeMessageHandler";

const vscode = acquireVsCodeApi();
(window as any).vscodeApi = vscode;

const SourceUploader: React.FC = () => {
    const [selectedFile, setSelectedFile] = useState<File | null>(null);

    useVSCodeMessageHandler({
        setFile: (file: File) => setSelectedFile(file),
    });

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            setSelectedFile(file);
            vscode.postMessage({ command: "fileSelected", fileName: file.name });
        }
    };

    const handleUpload = () => {
        if (selectedFile) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const content = e.target?.result;
                vscode.postMessage({ command: "uploadFile", content });
            };
            reader.readAsText(selectedFile);
        }
    };

    return (
        <div className="source-uploader">
            <h1>Upload a Source File</h1>
            <input type="file" onChange={handleFileChange} />
            {selectedFile && (
                <div>
                    <p>Selected File: {selectedFile.name}</p>
                    <button onClick={handleUpload}>Upload</button>
                </div>
            )}
        </div>
    );
};

export default SourceUploader;
