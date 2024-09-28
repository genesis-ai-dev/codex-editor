import React, { useState } from "react";
import { useVSCodeMessageHandler } from "./hooks/useVSCodeMessageHandler";
import {
    // VSCodeButton,
    VSCodeDropdown,
    VSCodeOption,
    VSCodeTextArea,
} from "@vscode/webview-ui-toolkit/react";

const vscode = acquireVsCodeApi();
(window as any).vscodeApi = vscode;

enum SplitOption {
    Paragraph = "paragraph",
    Newline = "newline",
    Sentence = "sentence",
    Word = "word",
}

enum FormatOption {
    splitOptionForm = "splitOptionForm",
}
const SourceUploader: React.FC = () => {
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [fileContent, setFileContent] = useState<string>("");
    const [splitContent, setSplitContent] = useState<string[]>([]);
    const [splitOption, setSplitOption] = useState<SplitOption>(SplitOption.Paragraph);
    useVSCodeMessageHandler({
        setFile: (file: File) => setSelectedFile(file),
    });

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const content = e.target?.result?.toString() || "";
                setFileContent(content);
                setSplitContent(content.split(deriveSplitOptions(splitOption)));
                vscode.postMessage({ command: "fileSelected", fileName: file.name });
            };
            reader.readAsText(file);
            setSelectedFile(file);
        }
    };

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const splitOptions = formData.getAll("splitOptions") as SplitOption[];
        const file = formData.get("file") as File;
        console.log({ file, fileContent });
        if (file && fileContent) {
            vscode.postMessage({
                command: "uploadFile",
                content: fileContent,
                options: splitOptions,
            });
        }
    };

    const deriveSplitOptions = (splitOption: SplitOption) => {
        switch (splitOption) {
            case SplitOption.Paragraph: {
                return "\n\n";
            }
            case SplitOption.Newline: {
                return "\n";
            }
            case SplitOption.Sentence: {
                return "[.!?]";
            }
            case SplitOption.Word: {
                return " ";
            }
        }
    };
    const handleChange = (newSplitOption: SplitOption) => {
        console.log({ newSplitOption });
        if (fileContent && splitOption) {
            const content = fileContent.split(deriveSplitOptions(newSplitOption));
            console.log({ content });
            setSplitContent(content.filter((c) => c.trim() !== ""));
        }
    };

    // const handleUpload = () => {
    //     if (selectedFile) {
    //         const reader = new FileReader();
    //         reader.onload = (e) => {
    //             const content = e.target?.result;
    //             console.log({ content });
    //             // vscode.postMessage({ command: "uploadFile", content });
    //         };
    //         reader.readAsText(selectedFile);
    //     }
    // };
    return (
        <div>
            <form
                className="source-uploader"
                onSubmit={handleSubmit}
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "1em",
                    padding: "1em",
                }}
            >
                <h1>Upload a Source File</h1>
                <input
                    type="file"
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleFileChange(e)}
                />
                {/* <button onClick={handleUpload}>Upload</button> */}
                {selectedFile && (
                    <>
                        <p>Selected File: {selectedFile.name}</p>
                        <VSCodeTextArea
                            readOnly
                            value={fileContent}
                            placeholder="File content will appear here..."
                            style={{ minHeight: "200px" }}
                        />
                        <div>
                            <label htmlFor={FormatOption.splitOptionForm}>Split Options:</label>
                            <VSCodeDropdown
                                id={FormatOption.splitOptionForm}
                                name={FormatOption.splitOptionForm}
                                onChange={(e: any) => {
                                    setSplitOption(e.target.value as SplitOption);
                                    handleChange(e.target.value as SplitOption);
                                }}
                            >
                                <VSCodeOption value="paragraph">Paragraph</VSCodeOption>
                                <VSCodeOption value="newline">Newline</VSCodeOption>
                                <VSCodeOption value="sentence">Sentence</VSCodeOption>
                                <VSCodeOption value="word">Word</VSCodeOption>
                            </VSCodeDropdown>
                        </div>
                        {/* <VSCodeButton type="submit">Upload</VSCodeButton> */}
                    </>
                )}
            </form>
            {splitContent.map((content, index) => (
                <div key={index}>
                    <h2>Preview {index + 1}</h2>
                    <p>Selected File: {selectedFile?.name}</p>
                    <VSCodeTextArea
                        readOnly
                        value={content}
                        placeholder="File content will appear here..."
                        style={{ minHeight: "200px" }}
                    />
                </div>
            ))}
        </div>
    );
};

export default SourceUploader;
