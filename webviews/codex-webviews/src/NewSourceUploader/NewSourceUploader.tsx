import React, { useState, useCallback, useEffect } from "react";
import { Upload, FileText, CheckCircle, XCircle, Clock, RotateCcw, Download } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Progress } from "../components/ui/progress";
import { Badge } from "../components/ui/badge";
import mammoth from "mammoth";
import { XMLParser } from "fast-xml-parser";
import {
    FileUploadResult,
    UploadProgress,
    NewSourceUploaderPostMessages,
    NewSourceUploaderResponseMessages,
    FileInfo,
    UploadState,
} from "./types";
import "./App.css";
import "../tailwind.css";

interface VSCodeApi {
    postMessage: (message: NewSourceUploaderPostMessages) => void;
    setState: (state: any) => void;
    getState: () => any;
}

// Get the VSCode API that was set up in the HTML
const vscode: VSCodeApi = (window as any).vscodeApi;

// Function to format HTML with proper indentation like Prettier
const formatHtmlLikePrettier = (html: string): string => {
    let formatted = "";
    let indent = 0;
    const indentSize = 2;

    // Self-closing tags that don't need closing tags
    const selfClosingTags = new Set([
        "br",
        "hr",
        "img",
        "input",
        "meta",
        "link",
        "area",
        "base",
        "col",
        "embed",
        "source",
        "track",
        "wbr",
    ]);

    // Block-level elements that should have line breaks
    const blockElements = new Set([
        "div",
        "p",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "ul",
        "ol",
        "li",
        "table",
        "tr",
        "td",
        "th",
        "thead",
        "tbody",
        "section",
        "article",
        "header",
        "footer",
        "nav",
        "main",
        "aside",
    ]);

    // Split HTML into tokens (tags and text)
    const tokens = html.match(/<\/?[^>]+>|[^<]+/g) || [];

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i].trim();
        if (!token) continue;

        if (token.startsWith("<")) {
            // It's a tag
            const isClosingTag = token.startsWith("</");
            const isOpeningTag = !isClosingTag && !token.endsWith("/>");
            const tagName = token.match(/<\/?([a-zA-Z0-9]+)/)?.[1]?.toLowerCase() || "";
            const isSelfClosing = selfClosingTags.has(tagName) || token.endsWith("/>");
            const isBlockElement = blockElements.has(tagName);

            if (isClosingTag) {
                indent = Math.max(0, indent - indentSize);
            }

            // Add indentation for block elements
            if (isBlockElement || isClosingTag) {
                formatted += "\n" + " ".repeat(indent);
            }

            formatted += token;

            if (isOpeningTag && !isSelfClosing) {
                indent += indentSize;
            }

            // Add line break after block elements
            if (isBlockElement && !isClosingTag) {
                // Don't add extra line break if next token is text content
                const nextToken = tokens[i + 1];
                if (nextToken && !nextToken.startsWith("<") && nextToken.trim()) {
                    // Keep text on same line for inline content
                } else {
                    formatted += "\n";
                }
            }
        } else {
            // It's text content
            const trimmedText = token.trim();
            if (trimmedText) {
                // Check if we need indentation (if previous was a block opening tag)
                const prevToken = tokens[i - 1];
                if (prevToken && prevToken.startsWith("<") && !prevToken.startsWith("</")) {
                    const prevTagName =
                        prevToken.match(/<([a-zA-Z0-9]+)/)?.[1]?.toLowerCase() || "";
                    if (blockElements.has(prevTagName)) {
                        formatted += " ".repeat(indent);
                    }
                }
                formatted += trimmedText;
            }
        }
    }

    return formatted.trim();
};

// Function to reconstruct HTML from parsed structure
const reconstructHtmlFromParsed = (parsedData: any): string => {
    if (!parsedData || !parsedData.root || !Array.isArray(parsedData.root)) {
        return "";
    }

    const processElement = (element: any): string => {
        if (typeof element === "string") {
            return element;
        }

        if (element["#text"]) {
            return element["#text"];
        }

        // Handle each tag type in the element
        let html = "";
        for (const [tagName, content] of Object.entries(element)) {
            if (tagName === "#text") {
                html += content;
            } else if (Array.isArray(content)) {
                // Process array of elements
                for (const item of content) {
                    if (typeof item === "object" && item !== null) {
                        // Check if this item has attributes
                        const attributes: string[] = [];
                        const children: any[] = [];

                        for (const [key, value] of Object.entries(item)) {
                            if (key.startsWith("@_")) {
                                // It's an attribute
                                const attrName = key.substring(2);
                                attributes.push(`${attrName}="${value}"`);
                            } else if (key === "#text") {
                                children.push(value);
                            } else {
                                // It's a child element
                                children.push({ [key]: value });
                            }
                        }

                        const attrString = attributes.length > 0 ? " " + attributes.join(" ") : "";

                        if (children.length === 0) {
                            // Self-closing or empty tag
                            html += `<${tagName}${attrString} />`;
                        } else {
                            html += `<${tagName}${attrString}>`;
                            for (const child of children) {
                                html += processElement(child);
                            }
                            html += `</${tagName}>`;
                        }
                    } else {
                        // Simple text content
                        html += `<${tagName}>${item}</${tagName}>`;
                    }
                }
            } else if (typeof content === "object" && content !== null) {
                // Single object
                html += processElement({ [tagName]: [content] });
            } else {
                // Simple content
                html += `<${tagName}>${content}</${tagName}>`;
            }
        }

        return html;
    };

    return parsedData.root.map(processElement).join("");
};

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

        if (!file) {
            setUploadState((prev) => ({
                ...prev,
                selectedFile: null,
                result: null,
                error: null,
                progress: [],
            }));
            return;
        }

        // Check if file is DOCX
        if (!file.name.toLowerCase().endsWith(".docx")) {
            setUploadState((prev) => ({
                ...prev,
                selectedFile: null,
                result: null,
                error: "Only DOCX files are supported",
                progress: [],
            }));
            return;
        }

        setUploadState((prev) => ({
            ...prev,
            selectedFile: file,
            result: null,
            error: null,
            progress: [],
        }));
    }, []);

    const handleUpload = useCallback(async () => {
        if (!uploadState.selectedFile) return;

        setUploadState((prev) => ({ ...prev, isUploading: true, error: null }));

        try {
            // Update progress: Reading file
            setUploadState((prev) => ({
                ...prev,
                progress: [
                    {
                        stage: "Reading File",
                        message: "Reading DOCX file...",
                        status: "processing",
                    },
                ],
            }));

            const arrayBuffer = await readFileAsArrayBuffer(uploadState.selectedFile);

            // Update progress: Converting to HTML
            setUploadState((prev) => ({
                ...prev,
                progress: [
                    {
                        stage: "Reading File",
                        message: "DOCX file read successfully",
                        status: "success",
                    },
                    {
                        stage: "Converting to HTML",
                        message: "Converting DOCX to HTML using mammoth.js...",
                        status: "processing",
                    },
                ],
            }));

            // Convert DOCX to HTML using mammoth.js
            const result = await mammoth.convertToHtml({ arrayBuffer });
            console.log({ result });
            const htmlContent = result.value;
            const messages = result.messages;

            // Parse HTML with fast-xml-parser
            const parser = new XMLParser({
                ignoreAttributes: false,
                attributeNamePrefix: "@_",
                textNodeName: "#text",
                parseAttributeValue: true,
                trimValues: true,
                preserveOrder: true,
                allowBooleanAttributes: true,
                parseTagValue: false,
                processEntities: true,
            });

            let parsedHtml = null;
            let parseError = null;
            let formattedHtml = null;
            let htmlArray: string[] = [];

            try {
                // Wrap HTML in a root element for proper XML parsing
                const wrappedHtml = `<root>${htmlContent}</root>`;
                parsedHtml = parser.parse(wrappedHtml);
                console.log("Parsed HTML structure:", parsedHtml);

                // Format HTML with proper indentation and line breaks
                formattedHtml = formatHtmlLikePrettier(htmlContent);
                console.log("Formatted HTML:", formattedHtml);
            } catch (error) {
                parseError = error instanceof Error ? error.message : "Failed to parse HTML";
                console.warn("Failed to parse HTML with fast-xml-parser:", error);
            }
            console.log({ parsedHtml, parseError });

            // Count words in the HTML content
            const textContent = htmlContent
                .replace(/<[^>]*>/g, " ")
                .replace(/\s+/g, " ")
                .trim();
            const wordCount = textContent
                .split(" ")
                .filter((word: string) => word.length > 0).length;

            // Update progress: Conversion complete
            setUploadState((prev) => ({
                ...prev,
                progress: [
                    {
                        stage: "Reading File",
                        message: "DOCX file read successfully",
                        status: "success",
                    },
                    {
                        stage: "Converting to HTML",
                        message: `Conversion complete. ${wordCount} words processed.`,
                        status: "success",
                    },
                ],
            }));

            // Loop through parsedHtml[0].root array and convert each item back to HTML
            if (
                parsedHtml &&
                parsedHtml[0] &&
                parsedHtml[0].root &&
                Array.isArray(parsedHtml[0].root)
            ) {
                console.log("=== Converting each parsed item back to HTML ===");
                console.log("Total items in root array:", parsedHtml[0].root.length);

                // Helper function to convert a single parsed item back to HTML
                const convertItemToHtml = (item: any): string => {
                    if (typeof item === "string") {
                        return item;
                    }

                    if (!item || typeof item !== "object") {
                        return String(item || "");
                    }

                    if (item["#text"]) {
                        return item["#text"];
                    }

                    let html = "";
                    for (const [tagName, content] of Object.entries(item)) {
                        if (tagName === "#text") {
                            html += content;
                        } else if (Array.isArray(content)) {
                            // Handle empty arrays - create empty tags
                            if (content.length === 0) {
                                html += `<${tagName}></${tagName}>`;
                            } else {
                                // Process array of elements
                                for (const subItem of content) {
                                    if (typeof subItem === "object" && subItem !== null) {
                                        // Check if this item has attributes
                                        const attributes: string[] = [];
                                        const children: any[] = [];

                                        for (const [key, value] of Object.entries(subItem)) {
                                            if (key.startsWith("@_")) {
                                                // It's an attribute
                                                const attrName = key.substring(2);
                                                attributes.push(`${attrName}="${value}"`);
                                            } else if (key === "#text") {
                                                children.push(value);
                                            } else {
                                                // It's a child element
                                                children.push({ [key]: value });
                                            }
                                        }

                                        const attrString =
                                            attributes.length > 0 ? " " + attributes.join(" ") : "";

                                        if (children.length === 0) {
                                            // Self-closing or empty tag
                                            html += `<${tagName}${attrString}></${tagName}>`;
                                        } else {
                                            html += `<${tagName}${attrString}>`;
                                            for (const child of children) {
                                                html += convertItemToHtml(child);
                                            }
                                            html += `</${tagName}>`;
                                        }
                                    } else {
                                        // Simple text content
                                        html += `<${tagName}>${subItem}</${tagName}>`;
                                    }
                                }
                            }
                        } else if (typeof content === "object" && content !== null) {
                            // Single object
                            html += convertItemToHtml({ [tagName]: [content] });
                        } else {
                            // Simple content
                            html += `<${tagName}>${content}</${tagName}>`;
                        }
                    }

                    return html;
                };

                htmlArray = parsedHtml[0].root.map((item: any, index: number) => {
                    // console.log(`--- Item ${index} HTML ---`);

                    // Convert this single item back to HTML
                    const itemHtml = convertItemToHtml(item);
                    return itemHtml;
                    console.log("HTML output:", itemHtml);

                    // Also log the original structure for reference
                    console.log("Original structure:", JSON.stringify(item, null, 2));
                    console.log("---");
                });
                console.log({ htmlArray });
            } else {
                console.log("parsedHtml structure is not as expected:", parsedHtml);
            }
            console.log({
                dataSentToExtension: {
                    name: uploadState.selectedFile.name,
                    content: arrayBuffer,
                    htmlContent: htmlArray,
                    type:
                        uploadState.selectedFile.type ||
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                },
            });
            // Send the result to the extension
            vscode.postMessage({
                command: "uploadFile",
                fileData: {
                    name: uploadState.selectedFile.name,
                    content: arrayBuffer,
                    htmlContent: htmlArray,
                    type:
                        uploadState.selectedFile.type ||
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                },
            });

            // Set the result in state for preview
            setUploadState((prev) => ({
                ...prev,
                isUploading: false,
                result: {
                    success: true,
                    message: `Successfully converted ${uploadState.selectedFile?.name} to HTML`,
                    htmlContent,
                    formattedHtml,
                    fileName: uploadState.selectedFile?.name,
                    wordCount,
                    parsedHtml,
                    parseError,
                },
            }));

            // Log any conversion messages/warnings
            if (messages.length > 0) {
                console.log("Mammoth conversion messages:", messages);
            }
        } catch (error) {
            setUploadState((prev) => ({
                ...prev,
                isUploading: false,
                error: `Failed to convert file: ${
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

    const handleDownloadHtml = useCallback(() => {
        if (!uploadState.result?.htmlContent || !uploadState.result?.fileName) return;

        const blob = new Blob([uploadState.result.htmlContent], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = uploadState.result.fileName.replace(".docx", ".html");
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, [uploadState.result]);

    const handleDownloadJson = useCallback(() => {
        if (!uploadState.result?.parsedHtml || !uploadState.result?.fileName) return;

        const jsonContent = JSON.stringify(uploadState.result.parsedHtml, null, 2);
        const blob = new Blob([jsonContent], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = uploadState.result.fileName.replace(".docx", "_parsed.json");
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, [uploadState.result]);

    const handleDownloadFormattedHtml = useCallback(() => {
        if (!uploadState.result?.formattedHtml || !uploadState.result?.fileName) return;

        const blob = new Blob([uploadState.result.formattedHtml], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = uploadState.result.fileName.replace(".docx", "_formatted.html");
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, [uploadState.result]);

    const readFileAsArrayBuffer = (file: File): Promise<ArrayBuffer> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const result = e.target?.result;
                if (result instanceof ArrayBuffer) {
                    resolve(result);
                } else {
                    reject(new Error("Failed to read file as ArrayBuffer"));
                }
            };
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
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
        type:
            file.type || "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        lastModified: file.lastModified,
    });

    const getStatusIcon = (status: UploadProgress["status"]) => {
        switch (status) {
            case "success":
                return <CheckCircle className="h-4 w-4 text-green-500" />;
            case "error":
                return <XCircle className="h-4 w-4 text-red-500" />;
            case "processing":
                return <RotateCcw className="h-4 w-4 text-blue-500 animate-spin" />;
            default:
                return <Clock className="h-4 w-4 text-gray-400" />;
        }
    };

    const getStatusBadgeVariant = (status: UploadProgress["status"]) => {
        switch (status) {
            case "success":
                return "success" as const;
            case "error":
                return "destructive" as const;
            case "processing":
                return "processing" as const;
            default:
                return "secondary" as const;
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

    const completedSteps = uploadState.progress.filter((p) => p.status === "success").length;
    const totalSteps = uploadState.progress.length;
    const progressPercentage = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

    return (
        <div className="container mx-auto p-6 max-w-4xl space-y-6">
            {/* Header */}
            <div className="text-center space-y-2">
                <h1 className="text-3xl font-bold flex items-center justify-center gap-2">
                    <Upload className="h-8 w-8" />
                    DOCX to HTML Converter
                </h1>
                <p className="text-muted-foreground">
                    Upload a DOCX file to convert it to clean HTML using mammoth.js
                </p>
            </div>

            {/* File Upload Section */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <FileText className="h-5 w-5" />
                        Select DOCX File
                    </CardTitle>
                    <CardDescription>Choose a DOCX file to convert to HTML format</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid w-full max-w-sm items-center gap-1.5">
                        <input
                            type="file"
                            accept=".docx"
                            onChange={handleFileSelect}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={uploadState.isUploading}
                        />
                    </div>

                    {uploadState.selectedFile && (
                        <Card className="bg-muted/50">
                            <CardContent className="pt-6">
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <span className="font-medium">Selected File:</span>
                                        <Badge variant="outline">DOCX</Badge>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4 text-sm p-2 rounded border">
                                        <div>
                                            <span className="font-medium">File:</span>{" "}
                                            {uploadState.selectedFile.name}
                                        </div>
                                        <div>
                                            <span className="font-medium">Size:</span>{" "}
                                            {formatFileSize(uploadState.selectedFile.size)}
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    <div className="flex gap-2">
                        <Button
                            onClick={handleUpload}
                            disabled={!uploadState.selectedFile || uploadState.isUploading}
                            className="flex items-center gap-2"
                        >
                            {uploadState.isUploading ? (
                                <>
                                    <RotateCcw className="h-4 w-4 animate-spin" />
                                    Converting...
                                </>
                            ) : (
                                <>
                                    <Upload className="h-4 w-4" />
                                    Convert to HTML
                                </>
                            )}
                        </Button>

                        {(uploadState.result || uploadState.error) && (
                            <Button onClick={handleReset} variant="outline">
                                Reset
                            </Button>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Progress Section */}
            {uploadState.progress.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center justify-between">
                            <span>Conversion Progress</span>
                            <Badge variant="outline">
                                {completedSteps}/{totalSteps} completed
                            </Badge>
                        </CardTitle>
                        <CardDescription>
                            Track the progress of your DOCX to HTML conversion
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Progress value={progressPercentage} className="w-full" />

                        <div className="space-y-3">
                            {uploadState.progress.map((item, index) => (
                                <div
                                    key={index}
                                    className="flex items-center gap-3 p-3 rounded-lg border bg-card"
                                >
                                    {getStatusIcon(item.status)}
                                    <div className="flex-1 space-y-1">
                                        <div className="flex items-center justify-between">
                                            <span className="font-medium">{item.stage}</span>
                                            <Badge variant={getStatusBadgeVariant(item.status)}>
                                                {item.status}
                                            </Badge>
                                        </div>
                                        <p className="text-sm text-muted-foreground">
                                            {item.message}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Results Section */}
            {uploadState.result && (
                <Card
                    className={uploadState.result.success ? "border-green-200" : "border-red-200"}
                >
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            {uploadState.result.success ? (
                                <CheckCircle className="h-5 w-5 text-green-500" />
                            ) : (
                                <XCircle className="h-5 w-5 text-red-500" />
                            )}
                            Conversion {uploadState.result.success ? "Complete" : "Failed"}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="p-4 rounded-lg bg-muted">
                            <p className="font-medium">Status:</p>
                            <p className="text-sm text-muted-foreground">
                                {uploadState.result.message}
                            </p>
                            {uploadState.result.wordCount && (
                                <p className="text-sm text-muted-foreground mt-2">
                                    Word count: {uploadState.result.wordCount}
                                </p>
                            )}
                        </div>

                        {uploadState.result.success && uploadState.result.htmlContent && (
                            <>
                                <div className="flex gap-2">
                                    <Button
                                        onClick={handleDownloadHtml}
                                        variant="outline"
                                        className="flex items-center gap-2"
                                    >
                                        <Download className="h-4 w-4" />
                                        Download HTML
                                    </Button>
                                    {uploadState.result.formattedHtml && (
                                        <Button
                                            onClick={handleDownloadFormattedHtml}
                                            variant="outline"
                                            className="flex items-center gap-2"
                                        >
                                            <Download className="h-4 w-4" />
                                            Download Formatted
                                        </Button>
                                    )}
                                    {uploadState.result.parsedHtml && (
                                        <Button
                                            onClick={handleDownloadJson}
                                            variant="outline"
                                            className="flex items-center gap-2"
                                        >
                                            <Download className="h-4 w-4" />
                                            Download JSON
                                        </Button>
                                    )}
                                </div>

                                <div className="space-y-2">
                                    <h4 className="font-medium">HTML Preview:</h4>
                                    <div className="p-4 rounded-lg bg-muted max-h-60 overflow-y-auto">
                                        <div
                                            className="prose prose-sm max-w-none"
                                            dangerouslySetInnerHTML={{
                                                __html: uploadState.result.htmlContent,
                                            }}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <h4 className="font-medium">Raw HTML:</h4>
                                    <div className="p-4 rounded-lg bg-muted font-mono text-sm max-h-60 overflow-y-auto">
                                        <pre className="whitespace-pre-wrap">
                                            {uploadState.result.htmlContent}
                                        </pre>
                                    </div>
                                </div>

                                {/* {uploadState.result.formattedHtml && (
                                    <div className="space-y-2">
                                        <h4 className="font-medium">
                                            Formatted HTML (Prettier-style):
                                        </h4>
                                        <div className="p-4 rounded-lg bg-muted font-mono text-sm max-h-60 overflow-y-auto">
                                            <pre className="whitespace-pre-wrap">
                                                {uploadState.result.formattedHtml}
                                            </pre>
                                        </div>
                                    </div>
                                )}

                                {uploadState.result.parsedHtml && (
                                    <div className="space-y-2">
                                        <h4 className="font-medium">
                                            Parsed HTML Structure (fast-xml-parser):
                                        </h4>
                                        <div className="p-4 rounded-lg bg-muted font-mono text-sm max-h-60 overflow-y-auto">
                                            <pre className="whitespace-pre-wrap">
                                                {JSON.stringify(
                                                    uploadState.result.parsedHtml,
                                                    null,
                                                    2
                                                )}
                                            </pre>
                                        </div>
                                    </div>
                                )}

                                {uploadState.result.parseError && (
                                    <div className="space-y-2">
                                        <h4 className="font-medium text-red-600">Parse Error:</h4>
                                        <div className="p-4 rounded-lg bg-red-50 border border-red-200">
                                            <p className="text-red-800 text-sm">
                                                {uploadState.result.parseError}
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {uploadState.result.reconstructedHtml && (
                                    <div className="space-y-2">
                                        <h4 className="font-medium">
                                            Reconstructed HTML (from parsed structure):
                                        </h4>
                                        <div className="p-4 rounded-lg bg-muted font-mono text-sm max-h-60 overflow-y-auto">
                                            <pre className="whitespace-pre-wrap">
                                                {uploadState.result.reconstructedHtml}
                                            </pre>
                                        </div>
                                    </div>
                                )} */}
                            </>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Error Section */}
            {uploadState.error && (
                <Card className="border-red-200">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-red-600">
                            <XCircle className="h-5 w-5" />
                            Error
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="p-4 rounded-lg bg-red-50 border border-red-200">
                            <p className="text-red-800">{uploadState.error}</p>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Information Section */}
            <Card>
                <CardHeader>
                    <CardTitle>About DOCX to HTML Conversion</CardTitle>
                    <CardDescription>
                        Information about the conversion process using mammoth.js and
                        fast-xml-parser
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <Badge variant="outline">DOCX</Badge>
                                <span className="text-sm font-medium">Microsoft Word Document</span>
                            </div>
                            <p className="text-sm text-muted-foreground">
                                Converts DOCX files to clean, semantic HTML while preserving
                                formatting
                            </p>
                        </div>
                        <div className="p-4 rounded-lg bg-muted">
                            <p className="text-sm text-muted-foreground">
                                <strong>Features:</strong> Preserves text formatting, paragraphs,
                                lists, tables, and basic styling. The HTML output is also parsed
                                with fast-xml-parser to provide a structured JSON representation for
                                programmatic analysis and manipulation.
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default NewSourceUploader;
