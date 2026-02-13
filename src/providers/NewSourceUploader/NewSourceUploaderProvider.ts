import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { promisify } from "util";
import { exec } from "child_process";
import { getWebviewHtml } from "../../utils/webviewTemplate";
import { createNoteBookPair } from "./codexFIleCreateUtils";
import { WriteNotebooksMessage, WriteTranslationMessage, OverwriteResponseMessage, WriteNotebooksWithAttachmentsMessage, SelectAudioFileMessage, ReprocessAudioFileMessage, RequestAudioSegmentMessage, FinalizeAudioImportMessage, UpdateAudioSegmentsMessage, SaveFileMessage } from "../../../webviews/codex-webviews/src/NewSourceUploader/types/plugin";
import {
    handleSelectAudioFile,
    handleReprocessAudioFile,
    handleRequestAudioSegment,
    handleUpdateAudioSegments,
    handleFinalizeAudioImport,
} from "./importers/audioSplitter";
import { ProcessedNotebook } from "../../../webviews/codex-webviews/src/NewSourceUploader/types/common";
import type { SpreadsheetNotebookMetadata } from "../../../webviews/codex-webviews/src/NewSourceUploader/types/processedNotebookMetadata";
import { NotebookPreview, CustomNotebookMetadata } from "../../../types";
import { CodexCell } from "../../utils/codexNotebookUtils";
import { CodexCellTypes } from "../../../types/enums";
import { importBookNamesFromXmlContent } from "../../bookNameSettings/bookNameSettings";
import { createStandardizedFilename, extractUsfmCodeFromFilename, getBookDisplayName } from "../../utils/bookNameUtils";
import { formatJsonForNotebookFile } from "../../utils/notebookFileFormattingUtils";
import { CodexContentSerializer } from "../../serializer";
import { getCorpusMarkerForBook } from "../../../sharedUtils/corpusUtils";
import { getNotebookMetadataManager } from "../../utils/notebookMetadataManager";
import { migrateLocalizedBooksToMetadata as migrateLocalizedBooks } from "./localizedBooksMigration/localizedBooksMigration";
import { removeLocalizedBooksJsonIfPresent as removeLocalizedBooksJson } from "./localizedBooksMigration/removeLocalizedBooksJson";
import { getAttachmentDocumentSegmentFromUri } from "../../utils/attachmentFolderUtils";
// import { parseRtfWithPandoc as parseRtfNode } from "../../../webviews/codex-webviews/src/NewSourceUploader/importers/rtf/pandocNodeBridge";

const execAsync = promisify(exec);

const DEBUG_NEW_SOURCE_UPLOADER_PROVIDER = false;
function debug(message: string, ...args: any[]): void {
    if (DEBUG_NEW_SOURCE_UPLOADER_PROVIDER) {
        console.log(`[NewSourceUploaderProvider] ${message}`, ...args);
    }
}

// Pre-initialize pdf-parse module to work around test file bug
// The library has a known issue where it tries to access a test file on first require()
let pdfParseModule: any = null;
let pdfParseInitialized = false;

async function initializePdfParse(): Promise<void> {
    if (pdfParseInitialized) {
        return;
    }

    try {
        console.log('[PDF] Initializing pdf-parse module...');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        pdfParseModule = require('pdf-parse');
        console.log('[PDF] Module loaded successfully');
        pdfParseInitialized = true;
    } catch (err: any) {
        // Known bug: first require() may throw ENOENT for test file
        const msg = String(err?.message || '');
        const isKnownBug = /ENOENT/.test(msg) && /05-versions-space\.pdf/.test(msg);

        if (isKnownBug) {
            console.log('[PDF] Known test file error during initialization, retrying...');
            // Wait a bit and try again
            await new Promise(resolve => setTimeout(resolve, 100));
            try {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                pdfParseModule = require('pdf-parse');
                console.log('[PDF] Module loaded successfully on retry');
                pdfParseInitialized = true;
            } catch (retryErr) {
                console.error('[PDF] Failed to initialize pdf-parse after retry:', retryErr);
                // Mark as initialized anyway to prevent repeated attempts
                pdfParseInitialized = true;
            }
        } else {
            console.error('[PDF] Unexpected error initializing pdf-parse:', err);
            pdfParseInitialized = true;
        }
    }
}

export class NewSourceUploaderProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = "newSourceUploaderProvider";

    constructor(private readonly context: vscode.ExtensionContext) {
        // Initialize pdf-parse module early to trigger and handle the test file bug
        initializePdfParse().catch(err => {
            console.error('[PDF] Module initialization failed:', err);
        });
    }

    async openCustomDocument(
        uri: vscode.Uri,
        openContext: vscode.CustomDocumentOpenContext,
        token: vscode.CancellationToken
    ): Promise<vscode.CustomDocument> {
        return { uri, dispose: () => { } };
    }

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        token: vscode.CancellationToken
    ): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: workspaceFolder
                ? [this.context.extensionUri, workspaceFolder.uri]
                : [this.context.extensionUri],
        };

        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

        webviewPanel.webview.onDidReceiveMessage(async (message: any) => {
            try {
                if (message.command === "webviewReady") {
                    // Webview is ready, send current project inventory
                    const inventory = await this.fetchProjectInventory();

                    webviewPanel.webview.postMessage({
                        command: "projectInventory",
                        inventory: inventory,
                    });
                } else if (message.command === "metadata.check") {
                    // Handle metadata check request
                    try {
                        const workspaceFolders = vscode.workspace.workspaceFolders;
                        if (!workspaceFolders || workspaceFolders.length === 0) {
                            webviewPanel.webview.postMessage({
                                command: "metadata.checkResponse",
                                data: {
                                    sourceLanguage: null,
                                    targetLanguage: null,
                                    sourceTexts: [],
                                    chatSystemMessage: null,
                                },
                            });
                            return;
                        }

                        const metadataUri = vscode.Uri.joinPath(
                            workspaceFolders[0].uri,
                            "metadata.json"
                        );
                        const metadataContent = await vscode.workspace.fs.readFile(metadataUri);
                        const metadata = JSON.parse(metadataContent.toString());

                        const sourceLanguage = metadata.languages?.find(
                            (l: any) => l.projectStatus === "source"
                        );
                        const targetLanguage = metadata.languages?.find(
                            (l: any) => l.projectStatus === "target"
                        );
                        const sourceTexts = metadata.ingredients
                            ? Object.keys(metadata.ingredients)
                            : [];
                        const chatSystemMessage = metadata.chatSystemMessage || null;

                        webviewPanel.webview.postMessage({
                            command: "metadata.checkResponse",
                            data: {
                                sourceLanguage,
                                targetLanguage,
                                sourceTexts,
                                chatSystemMessage,
                            },
                        });
                    } catch (error) {
                        console.error("Error checking metadata:", error);
                        webviewPanel.webview.postMessage({
                            command: "metadata.checkResponse",
                            data: {
                                sourceLanguage: null,
                                targetLanguage: null,
                                sourceTexts: [],
                                chatSystemMessage: null,
                            },
                        });
                    }
                } else if (message.command === "writeNotebooks") {
                    await this.handleWriteNotebooks(message as WriteNotebooksMessage, token, webviewPanel);
                } else if (message.command === "writeNotebooksWithAttachments") {
                    await this.handleWriteNotebooksWithAttachments(message as WriteNotebooksWithAttachmentsMessage, document, token, webviewPanel);
                    // Success notification and inventory update are now handled in handleWriteNotebooks
                } else if (message.command === "overwriteResponse") {
                    const response = message as OverwriteResponseMessage;
                    if (response.confirmed) {
                        // User confirmed overwrite, proceed with the original write operation
                        await this.handleWriteNotebooksForced(response.originalMessage, token, webviewPanel);
                    } else {
                        // User cancelled, send cancellation message
                        webviewPanel.webview.postMessage({
                            command: "notification",
                            type: "info",
                            message: "Import cancelled by user"
                        });
                    }
                } else if (message.command === "writeTranslation") {
                    await this.handleWriteTranslation(message as WriteTranslationMessage, token);

                    // Send success notification
                    webviewPanel.webview.postMessage({
                        command: "notification",
                        type: "success",
                        message: "Translation imported successfully!"
                    });

                    // Send updated inventory after successful translation import
                    const inventory = await this.fetchProjectInventory();
                    webviewPanel.webview.postMessage({
                        command: "projectInventory",
                        inventory: inventory,
                    });
                } else if (message.command === "importBookNames") {
                    // Handle book names import
                    const { xmlContent, nameType } = message;
                    if (xmlContent) {
                        const success = await importBookNamesFromXmlContent(xmlContent, nameType || 'long');
                        if (success) {
                            webviewPanel.webview.postMessage({
                                command: "notification",
                                type: "success",
                                message: "Book names imported successfully!"
                            });
                        } else {
                            webviewPanel.webview.postMessage({
                                command: "notification",
                                type: "warning",
                                message: "Failed to import some book names"
                            });
                        }
                    }
                } else if (message.command === "fetchProjectInventory") {
                    // Legacy support - fetch complete project inventory
                    const inventory = await this.fetchProjectInventory();

                    webviewPanel.webview.postMessage({
                        command: "projectInventory",
                        inventory: inventory,
                    });
                } else if (message.command === "fetchFileDetails") {
                    // Fetch detailed information about a specific file
                    const { filePath } = message;

                    try {
                        const fileDetails = await this.fetchFileDetails(filePath);
                        webviewPanel.webview.postMessage({
                            command: "fileDetails",
                            filePath: filePath,
                            details: fileDetails,
                        });
                    } catch (error) {
                        console.error(`[NEW SOURCE UPLOADER] Error fetching file details for ${filePath}:`, error);
                        webviewPanel.webview.postMessage({
                            command: "fileDetailsError",
                            filePath: filePath,
                            error: error instanceof Error ? error.message : "Unknown error",
                        });
                    }
                } else if (message.command === "downloadResource") {
                    // Handle generic plugin download requests
                    await this.handleDownloadResource(message, webviewPanel);
                } else if (message.command === "extractPdfText") {
                    const { requestId, dataBase64 } = message as { requestId: string; dataBase64: string; fileName?: string; };
                    try {
                        // Ensure pdf-parse is initialized
                        await initializePdfParse();

                        if (!pdfParseModule) {
                            throw new Error('PDF parser module failed to initialize');
                        }

                        const base64 = (dataBase64 || '').includes(',') ? (dataBase64 || '').split(',').pop() || '' : (dataBase64 || '');
                        const buffer = Buffer.from(base64, 'base64');
                        if (!buffer.length) {
                            throw new Error('Empty PDF payload from webview');
                        }

                        // Use the pre-initialized module
                        const pdfParse = pdfParseModule as (data: Buffer | { data: Buffer; }) => Promise<{ text: string; }>;

                        console.log(`[PDF] Parsing PDF with buffer size: ${buffer.length} bytes`);

                        // Try both data formats
                        let text = '';
                        try {
                            // Try wrapper format first
                            const result = await pdfParse({ data: buffer });
                            text = result?.text || '';
                            console.log(`[PDF] ✓ Successfully extracted ${text.length} characters (wrapper format)`);
                        } catch (e1: any) {
                            console.log(`[PDF] Wrapper format failed, trying raw buffer format`);
                            try {
                                // Try raw buffer format
                                const result = await pdfParse(buffer);
                                text = result?.text || '';
                                console.log(`[PDF] ✓ Successfully extracted ${text.length} characters (raw format)`);
                            } catch (e2: any) {
                                const msg = String(e2?.message || e1?.message || '');
                                console.error('[PDF] All parsing attempts failed:', { e1: e1?.message, e2: e2?.message });
                                throw new Error(`PDF parsing failed: ${msg}`);
                            }
                        }

                        webviewPanel.webview.postMessage({
                            command: 'extractPdfTextResult',
                            requestId,
                            success: true,
                            text
                        });
                    } catch (err) {
                        console.error('[NEW SOURCE UPLOADER] PDF extraction failed:', err);
                        webviewPanel.webview.postMessage({
                            command: 'extractPdfTextResult',
                            requestId,
                            success: false,
                            error: err instanceof Error ? err.message : 'Unknown error'
                        });
                    }
                } else if (message.command === "convertPdfToDocx") {
                    const { requestId, pdfBase64, outputPath } = message as { requestId: string; pdfBase64: string; outputPath?: string; };
                    try {
                        const scriptPath = path.join(this.context.extensionPath, 'webviews', 'codex-webviews', 'src', 'NewSourceUploader', 'importers', 'pdf', 'scripts', 'pdf_to_docx.py');

                        // Verify script exists
                        if (!fs.existsSync(scriptPath)) {
                            throw new Error(`Python script not found at: ${scriptPath}`);
                        }

                        // Create temp directory
                        const tempDir = path.join(this.context.extensionPath, '.temp');
                        if (!fs.existsSync(tempDir)) {
                            fs.mkdirSync(tempDir, { recursive: true });
                        }

                        // Write base64 PDF to temporary file to avoid command line length limits
                        const tempPdfPath = path.join(tempDir, `input_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
                        const pdfBuffer = Buffer.from(pdfBase64, 'base64');
                        fs.writeFileSync(tempPdfPath, pdfBuffer);

                        // Use temp file if outputPath not provided
                        const docxPath = outputPath || path.join(tempDir, `converted_${Date.now()}.docx`);

                        // Verify PDF file was written
                        if (!fs.existsSync(tempPdfPath)) {
                            throw new Error(`Failed to write PDF file to: ${tempPdfPath}`);
                        }

                        // Run Python script with file paths
                        // On Windows, use proper quoting; on Unix, paths should work as-is
                        const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

                        // Quote paths properly for Windows (use double quotes and escape inner quotes)
                        const quotePath = (p: string) => {
                            if (process.platform === 'win32') {
                                // Windows: use double quotes and escape any existing quotes
                                return `"${p.replace(/"/g, '\\"')}"`;
                            } else {
                                // Unix: use single quotes and escape any existing quotes
                                return `'${p.replace(/'/g, "\\'")}'`;
                            }
                        };

                        const command = `${pythonCmd} ${quotePath(scriptPath)} ${quotePath(tempPdfPath)} ${quotePath(docxPath)}`;

                        console.log(`[PDF→DOCX] Converting PDF to DOCX...`);
                        console.log(`[PDF→DOCX] Command: ${command}`);

                        let stdout = '';
                        let stderr = '';
                        try {
                            const result = await execAsync(command, { maxBuffer: 50 * 1024 * 1024 });
                            stdout = result.stdout || '';
                            stderr = result.stderr || '';
                        } catch (execErr: any) {
                            // execAsync throws an error when command fails, but stdout/stderr are in the error object
                            stdout = execErr.stdout || '';
                            stderr = execErr.stderr || '';
                            const errorMessage = execErr.message || 'Unknown error';

                            // If we have stdout that might be JSON, try to parse it
                            if (stdout.trim()) {
                                try {
                                    const result = JSON.parse(stdout);
                                    if (result.error) {
                                        throw new Error(`Python script error: ${result.error}`);
                                    }
                                } catch (parseErr) {
                                    // Not JSON, use the exec error
                                }
                            }

                            // Include both stdout and stderr in error message
                            const fullError = [
                                errorMessage,
                                stdout ? `\nStdout: ${stdout}` : '',
                                stderr ? `\nStderr: ${stderr}` : ''
                            ].filter(Boolean).join('');

                            throw new Error(fullError);
                        }

                        // Clean up temp PDF file
                        try {
                            if (fs.existsSync(tempPdfPath)) {
                                fs.unlinkSync(tempPdfPath);
                            }
                        } catch (cleanupErr) {
                            console.warn(`[PDF→DOCX] Could not delete temp PDF: ${cleanupErr}`);
                        }

                        // Log progress messages from stderr (Python script sends progress updates there)
                        if (stderr) {
                            try {
                                // Try to parse JSON progress messages
                                const stderrLines = stderr.split('\n').filter(line => line.trim());
                                for (const line of stderrLines) {
                                    try {
                                        const progressMsg = JSON.parse(line);
                                        if (progressMsg.info) {
                                            console.log(`[PDF→DOCX] ${progressMsg.info}`);
                                        }
                                    } catch {
                                        // Not JSON, log as-is if it's not a success message
                                        if (line.trim() && !line.includes('"success":true')) {
                                            console.log(`[PDF→DOCX] ${line}`);
                                        }
                                    }
                                }
                            } catch {
                                // If parsing fails, just log the stderr
                                if (!stdout.includes('"success":true')) {
                                    console.warn(`[PDF→DOCX] Python stderr: ${stderr}`);
                                }
                            }
                        }

                        // Parse JSON result
                        let result;
                        try {
                            result = JSON.parse(stdout);
                        } catch (parseErr) {
                            throw new Error(`Failed to parse Python script output as JSON. Stdout: ${stdout.substring(0, 500)}${stdout.length > 500 ? '...' : ''}. Stderr: ${stderr}`);
                        }

                        if (result.success) {
                            console.log(`[PDF→DOCX] ✓ Successfully converted PDF to DOCX`);

                            // Verify the DOCX file exists and has content
                            if (!fs.existsSync(docxPath)) {
                                throw new Error(`DOCX file not found at: ${docxPath}`);
                            }

                            const fileStats = fs.statSync(docxPath);
                            if (fileStats.size === 0) {
                                throw new Error(`DOCX file is empty at: ${docxPath}`);
                            }

                            console.log(`[PDF→DOCX] Reading DOCX file (${fileStats.size} bytes)...`);

                            // For large files (>50MB), save directly to workspace and send file path instead of base64
                            // This avoids memory issues and webview message size limits
                            const LARGE_FILE_THRESHOLD = 50 * 1024 * 1024; // 50MB
                            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

                            if (fileStats.size > LARGE_FILE_THRESHOLD && workspaceFolder) {
                                console.log(`[PDF→DOCX] Large file detected (${fileStats.size} bytes), saving to workspace instead of sending via message...`);

                                // Save DOCX to temporary location in workspace
                                const tempDir = vscode.Uri.joinPath(workspaceFolder.uri, '.project', 'temp');
                                await vscode.workspace.fs.createDirectory(tempDir);

                                const tempDocxUri = vscode.Uri.joinPath(tempDir, `pdf_conversion_${requestId}.docx`);
                                const docxBuffer = fs.readFileSync(docxPath);
                                await vscode.workspace.fs.writeFile(tempDocxUri, new Uint8Array(docxBuffer));

                                console.log(`[PDF→DOCX] Saved large DOCX to workspace: ${tempDocxUri.fsPath}`);

                                webviewPanel.webview.postMessage({
                                    command: 'convertPdfToDocxResult',
                                    requestId,
                                    success: true,
                                    docxFilePath: tempDocxUri.fsPath, // Send file path instead of base64
                                    outputPath: docxPath,
                                    isLargeFile: true
                                });
                            } else {
                                // For smaller files, send base64 as before
                                const docxBuffer = fs.readFileSync(docxPath);
                                const docxBase64 = docxBuffer.toString('base64');

                                // Verify base64 encoding is valid
                                if (!docxBase64 || docxBase64.length === 0) {
                                    throw new Error('Failed to encode DOCX file to base64');
                                }

                                console.log(`[PDF→DOCX] Sending DOCX data to webview (${docxBase64.length} base64 chars)...`);

                                webviewPanel.webview.postMessage({
                                    command: 'convertPdfToDocxResult',
                                    requestId,
                                    success: true,
                                    docxBase64: docxBase64,
                                    outputPath: docxPath,
                                    isLargeFile: false
                                });
                            }
                        } else {
                            throw new Error(result.error || 'Conversion failed');
                        }
                    } catch (err) {
                        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                        console.error('[NEW SOURCE UPLOADER] PDF→DOCX conversion failed:', err);
                        webviewPanel.webview.postMessage({
                            command: 'convertPdfToDocxResult',
                            requestId,
                            success: false,
                            error: errorMessage
                        });
                    }
                } else if (message.command === "convertDocxToPdf") {
                    const { requestId, docxBase64, outputPath } = message as { requestId: string; docxBase64: string; outputPath?: string; };
                    try {
                        const scriptPath = path.join(this.context.extensionPath, 'webviews', 'codex-webviews', 'src', 'NewSourceUploader', 'importers', 'pdf', 'scripts', 'docx_to_pdf.py');

                        // Verify script exists
                        if (!fs.existsSync(scriptPath)) {
                            throw new Error(`Python script not found at: ${scriptPath}`);
                        }

                        // Create temp directory
                        const tempDir = path.join(this.context.extensionPath, '.temp');
                        if (!fs.existsSync(tempDir)) {
                            fs.mkdirSync(tempDir, { recursive: true });
                        }

                        // Write base64 DOCX to temporary file to avoid command line length limits
                        const tempDocxPath = path.join(tempDir, `input_${Date.now()}_${Math.random().toString(36).slice(2)}.docx`);
                        const docxBuffer = Buffer.from(docxBase64, 'base64');
                        fs.writeFileSync(tempDocxPath, docxBuffer);

                        // Use temp file if outputPath not provided
                        const pdfPath = outputPath || path.join(tempDir, `converted_${Date.now()}.pdf`);

                        // Verify DOCX file was written
                        if (!fs.existsSync(tempDocxPath)) {
                            throw new Error(`Failed to write DOCX file to: ${tempDocxPath}`);
                        }

                        // Run Python script with file paths
                        // On Windows, use proper quoting; on Unix, paths should work as-is
                        const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

                        // Quote paths properly for Windows (use double quotes and escape inner quotes)
                        const quotePath = (p: string) => {
                            if (process.platform === 'win32') {
                                // Windows: use double quotes and escape any existing quotes
                                return `"${p.replace(/"/g, '\\"')}"`;
                            } else {
                                // Unix: use single quotes and escape any existing quotes
                                return `'${p.replace(/'/g, "\\'")}'`;
                            }
                        };

                        const command = `${pythonCmd} ${quotePath(scriptPath)} ${quotePath(tempDocxPath)} ${quotePath(pdfPath)}`;

                        console.log(`[DOCX→PDF] Converting DOCX to PDF...`);
                        console.log(`[DOCX→PDF] Command: ${command}`);

                        let stdout = '';
                        let stderr = '';
                        try {
                            const result = await execAsync(command, { maxBuffer: 50 * 1024 * 1024 });
                            stdout = result.stdout || '';
                            stderr = result.stderr || '';
                        } catch (execErr: any) {
                            // execAsync throws an error when command fails, but stdout/stderr are in the error object
                            stdout = execErr.stdout || '';
                            stderr = execErr.stderr || '';
                            const errorMessage = execErr.message || 'Unknown error';

                            // If we have stdout that might be JSON, try to parse it
                            if (stdout.trim()) {
                                try {
                                    const result = JSON.parse(stdout);
                                    if (result.error) {
                                        throw new Error(`Python script error: ${result.error}`);
                                    }
                                } catch (parseErr) {
                                    // Not JSON, use the exec error
                                }
                            }

                            // Include both stdout and stderr in error message
                            const fullError = [
                                errorMessage,
                                stdout ? `\nStdout: ${stdout}` : '',
                                stderr ? `\nStderr: ${stderr}` : ''
                            ].filter(Boolean).join('');

                            throw new Error(fullError);
                        }

                        // Clean up temp DOCX file
                        try {
                            if (fs.existsSync(tempDocxPath)) {
                                fs.unlinkSync(tempDocxPath);
                            }
                        } catch (cleanupErr) {
                            console.warn(`[DOCX→PDF] Could not delete temp DOCX: ${cleanupErr}`);
                        }

                        if (stderr && !stdout.includes('"success":true')) {
                            console.warn(`[DOCX→PDF] Python stderr: ${stderr}`);
                        }

                        // Parse JSON result
                        let result;
                        try {
                            result = JSON.parse(stdout);
                        } catch (parseErr) {
                            throw new Error(`Failed to parse Python script output as JSON. Stdout: ${stdout.substring(0, 500)}${stdout.length > 500 ? '...' : ''}. Stderr: ${stderr}`);
                        }

                        if (result.success) {
                            console.log(`[DOCX→PDF] ✓ Successfully converted DOCX to PDF`);
                            webviewPanel.webview.postMessage({
                                command: 'convertDocxToPdfResult',
                                requestId,
                                success: true,
                                pdfBase64: result.pdfBase64,
                                outputPath: pdfPath
                            });
                        } else {
                            throw new Error(result.error || 'Conversion failed');
                        }
                    } catch (err) {
                        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                        console.error('[NEW SOURCE UPLOADER] DOCX→PDF conversion failed:', err);
                        webviewPanel.webview.postMessage({
                            command: 'convertDocxToPdfResult',
                            requestId,
                            success: false,
                            error: errorMessage
                        });
                    }
                } else if (message.command === "fetchTargetFile") {
                    // Fetch target file content for translation imports
                    const { sourceFilePath } = message;

                    try {
                        const targetFilePath = sourceFilePath
                            .replace(/\.source$/, ".codex")
                            .replace(/\/\.project\/sourceTexts\//, "/files/target/");

                        const targetUri = vscode.Uri.file(targetFilePath);
                        const targetContent = await vscode.workspace.fs.readFile(targetUri);
                        const targetNotebook = JSON.parse(new TextDecoder().decode(targetContent));

                        webviewPanel.webview.postMessage({
                            command: "targetFileContent",
                            sourceFilePath: sourceFilePath,
                            targetFilePath: targetFilePath,
                            targetCells: targetNotebook.cells || [],
                        });
                    } catch (error) {
                        console.error(`[NEW SOURCE UPLOADER] Error fetching target file for ${sourceFilePath}:`, error);
                        webviewPanel.webview.postMessage({
                            command: "targetFileError",
                            sourceFilePath: sourceFilePath,
                            error: error instanceof Error ? error.message : "Unknown error",
                        });
                    }
                } else if (message.command === "startTranslating") {
                    // Handle start translating - same as Welcome View's "Open Translation File"

                    try {
                        // Focus the navigation view (same as Welcome View's handleOpenTranslationFile)
                        await vscode.commands.executeCommand("codex-editor.navigation.focus");

                        // Close the current webview panel
                        webviewPanel.dispose();
                    } catch (error) {
                        console.error("Error opening navigation:", error);
                        webviewPanel.webview.postMessage({
                            command: "notification",
                            type: "error",
                            message: error instanceof Error ? error.message : "Failed to open navigation"
                        });
                    }
                } else if (message.command === "selectAudioFile") {
                    await handleSelectAudioFile(message as SelectAudioFileMessage, webviewPanel);
                } else if (message.command === "reprocessAudioFile") {
                    await handleReprocessAudioFile(message as ReprocessAudioFileMessage, webviewPanel);
                } else if (message.command === "requestAudioSegment") {
                    await handleRequestAudioSegment(message as RequestAudioSegmentMessage, webviewPanel);
                } else if (message.command === "updateAudioSegments") {
                    await handleUpdateAudioSegments(message as UpdateAudioSegmentsMessage, webviewPanel);
                } else if (message.command === "finalizeAudioImport") {
                    await handleFinalizeAudioImport(
                        message as FinalizeAudioImportMessage,
                        token,
                        webviewPanel,
                        async (msg, tok, pan) => {
                            await this.handleWriteNotebooks(msg as WriteNotebooksMessage, tok, pan);
                        }
                    );
                } else if (message.command === "saveFile") {
                    await this.handleSaveFile(message as SaveFileMessage, webviewPanel);
                } else if (message.command === "systemMessage.generate") {
                    // Generate AI system message for translation
                    try {
                        // Get workspace folder
                        const workspaceFolders = vscode.workspace.workspaceFolders;
                        if (!workspaceFolders || workspaceFolders.length === 0) {
                            webviewPanel.webview.postMessage({
                                command: "systemMessage.generateError",
                                error: "No workspace folder found",
                            });
                            return;
                        }

                        // Get source and target languages from metadata
                        const metadataUri = vscode.Uri.joinPath(
                            workspaceFolders[0].uri,
                            "metadata.json"
                        );
                        const metadataContent = await vscode.workspace.fs.readFile(metadataUri);
                        const metadata = JSON.parse(metadataContent.toString());

                        const sourceLanguage = metadata.languages?.find(
                            (l: any) => l.projectStatus === "source"
                        );
                        const targetLanguage = metadata.languages?.find(
                            (l: any) => l.projectStatus === "target"
                        );

                        if (!sourceLanguage || !targetLanguage) {
                            webviewPanel.webview.postMessage({
                                command: "systemMessage.generateError",
                                error: "Source and target languages must be set before generating system message",
                            });
                            return;
                        }

                        // Import and call the generation function
                        const { generateChatSystemMessage } = await import("../../copilotSettings/copilotSettings");
                        const generatedMessage = await generateChatSystemMessage(
                            sourceLanguage,
                            targetLanguage,
                            workspaceFolders[0].uri
                        );

                        if (generatedMessage) {
                            // Save the generated message to metadata.json immediately
                            const { MetadataManager } = await import("../../utils/metadataManager");
                            const saveResult = await MetadataManager.setChatSystemMessage(
                                generatedMessage,
                                workspaceFolders[0].uri
                            );

                            if (saveResult.success) {
                                webviewPanel.webview.postMessage({
                                    command: "systemMessage.generated",
                                    message: generatedMessage,
                                });
                            } else {
                                // Still send the generated message even if save fails
                                // User can manually save it later
                                webviewPanel.webview.postMessage({
                                    command: "systemMessage.generated",
                                    message: generatedMessage,
                                });
                                console.warn("Generated system message but failed to save:", saveResult.error);
                            }
                        } else {
                            webviewPanel.webview.postMessage({
                                command: "systemMessage.generateError",
                                error: "Failed to generate system message. Please check your API configuration.",
                            });
                        }
                    } catch (error) {
                        console.error("Error generating system message:", error);
                        webviewPanel.webview.postMessage({
                            command: "systemMessage.generateError",
                            error: error instanceof Error ? error.message : "Failed to generate system message",
                        });
                    }
                } else if (message.command === "systemMessage.save") {
                    // Save system message to metadata
                    try {
                        const { MetadataManager } = await import("../../utils/metadataManager");
                        await MetadataManager.setChatSystemMessage(message.message);
                        webviewPanel.webview.postMessage({
                            command: "systemMessage.saved",
                        });
                    } catch (error) {
                        console.error("Error saving system message:", error);
                        webviewPanel.webview.postMessage({
                            command: "systemMessage.saveError",
                            error: error instanceof Error ? error.message : "Failed to save system message",
                        });
                    }
                }
            } catch (error) {
                console.error("Error handling message:", error);

                // Send error notification
                webviewPanel.webview.postMessage({
                    command: "notification",
                    type: "error",
                    message: error instanceof Error ? error.message : "Unknown error occurred"
                });
            }
        });
    }

    /**
 * Converts a ProcessedNotebook to NotebookPreview format
 */
    private async convertToNotebookPreview(processedNotebook: ProcessedNotebook): Promise<NotebookPreview> {
        const cells: CodexCell[] = processedNotebook.cells.map(processedCell => ({
            kind: vscode.NotebookCellKind.Code,
            value: processedCell.content ?? "",
            languageId: "html",
            metadata: {
                id: processedCell.id,
                type: CodexCellTypes.TEXT,
                edits: [],
                // Spread all metadata from the processed cell first, preserving our enhanced structure
                ...(processedCell.metadata && typeof processedCell.metadata === 'object'
                    ? processedCell.metadata
                    : {}),
                // Then override with standard data field if it exists
                data: processedCell.metadata?.data || {},
                // Only persist isLocked when true (or if an upstream processor explicitly set it).
                // Most cells should omit isLocked entirely when unlocked to avoid noisy metadata.
                ...(processedCell.metadata?.isLocked !== undefined
                    ? { isLocked: processedCell.metadata.isLocked }
                    : {}),
            }
        }));

        // Determine corpus marker - fix "ebibleCorpus" to NT/OT if needed
        let corpusMarker = processedNotebook.metadata.corpusMarker || processedNotebook.metadata.importerType;
        if (corpusMarker === "ebibleCorpus" && processedNotebook.metadata.originalFileName) {
            const correctMarker = getCorpusMarkerForBook(processedNotebook.metadata.originalFileName);
            if (correctMarker) {
                corpusMarker = correctMarker;
            }
        }

        // Basic normalization (trim whitespace) - full normalization with existing files 
        // happens in createNoteBookPair to preserve casing from existing files
        const trimmedCorpusMarker = corpusMarker?.trim();

        // Use fileDisplayName from metadata if it exists, otherwise derive from originalName
        // IMPORTANT: Always preserve fileDisplayName from metadata if it exists (e.g., "Hebrew Genesis", "Greek Matthew")
        let fileDisplayName = processedNotebook.metadata?.fileDisplayName;

        // Check if this is a Macula importer - if so, always preserve fileDisplayName from metadata
        const isMaculaImporter = processedNotebook.metadata?.importerType === "macula";

        // For Macula importer, if fileDisplayName is already set and starts with "Hebrew" or "Greek", preserve it
        if (isMaculaImporter && fileDisplayName && (fileDisplayName.startsWith("Hebrew ") || fileDisplayName.startsWith("Greek "))) {
            // Keep the existing fileDisplayName - don't override it
        } else if (!fileDisplayName) {
            // Derive fileDisplayName from originalName without the file extension
            const originalName = processedNotebook.metadata.originalFileName;
            fileDisplayName = originalName && typeof originalName === "string" && originalName.trim() !== ""
                ? path.basename(originalName.trim(), path.extname(originalName.trim()))
                : undefined;

            // For biblical books (NT/OT), convert USFM codes to full names during import
            // Also handle Macula corpus markers: "Hebrew Bible" and "Greek Bible"
            const isNTMarker = trimmedCorpusMarker === "NT" || trimmedCorpusMarker === "greek bible";
            const isOTMarker = trimmedCorpusMarker === "OT" || trimmedCorpusMarker === "hebrew bible";

            if (fileDisplayName && (isNTMarker || isOTMarker)) {
                const usfmCode = extractUsfmCodeFromFilename(fileDisplayName);
                if (usfmCode) {
                    // Convert USFM code to full book name
                    fileDisplayName = await getBookDisplayName(usfmCode);
                    // Add language prefix for Macula importer: "Hebrew" for OT, "Greek" for NT
                    if (isMaculaImporter) {
                        const languagePrefix = isNTMarker ? "Greek" : "Hebrew";
                        fileDisplayName = `${languagePrefix} ${fileDisplayName}`;
                    }
                }
            }
        } else if (isMaculaImporter && fileDisplayName && !fileDisplayName.startsWith("Hebrew ") && !fileDisplayName.startsWith("Greek ")) {
            // For Macula importer, if fileDisplayName exists but doesn't have language prefix, add it
            // First try to convert USFM code to full name if it's a code
            const usfmCode = extractUsfmCodeFromFilename(fileDisplayName);
            if (usfmCode) {
                fileDisplayName = await getBookDisplayName(usfmCode);
            }
            // Add appropriate language prefix based on corpus marker
            const isNTMarker = trimmedCorpusMarker === "NT" || trimmedCorpusMarker === "greek bible";
            const languagePrefix = isNTMarker ? "Greek" : "Hebrew";
            fileDisplayName = `${languagePrefix} ${fileDisplayName}`;
        }

        const metadata: CustomNotebookMetadata = {
            id: processedNotebook.metadata.id,
            originalName: processedNotebook.metadata.originalFileName,
            sourceFsPath: "",
            codexFsPath: "",
            navigation: [],
            sourceCreatedAt: processedNotebook.metadata.createdAt,
            corpusMarker: trimmedCorpusMarker,
            textDirection: (processedNotebook.metadata.textDirection as "ltr" | "rtl" | undefined) || "ltr",
            ...(fileDisplayName ? { fileDisplayName } : {}),
            ...(processedNotebook.metadata.videoUrl ? { videoUrl: processedNotebook.metadata.videoUrl } : {}),
            ...(processedNotebook.metadata)?.audioOnly !== undefined
                ? { audioOnly: processedNotebook.metadata.audioOnly as boolean }
                : {},
            // Preserve document structure metadata and other custom fields
            ...(processedNotebook.metadata.documentStructure
                ? { documentStructure: processedNotebook.metadata.documentStructure }
                : {}),
            ...(processedNotebook.metadata.wordCount !== undefined
                ? { wordCount: processedNotebook.metadata.wordCount }
                : {}),
            ...(processedNotebook.metadata.mammothMessages
                ? { mammothMessages: processedNotebook.metadata.mammothMessages }
                : {}),
            ...(processedNotebook.metadata?.originalHash
                ? { originalHash: processedNotebook.metadata.originalHash }
                : {}),
            ...(processedNotebook.metadata?.importerType && {
                importerType: processedNotebook.metadata.importerType
            }),
            // Spreadsheet-specific metadata for round-trip export
            ...(processedNotebook.metadata.importerType === "spreadsheet" ||
                processedNotebook.metadata.importerType === "spreadsheet-csv" ||
                processedNotebook.metadata.importerType === "spreadsheet-tsv"
                ? (() => {
                    const spreadsheetMetadata = processedNotebook.metadata as SpreadsheetNotebookMetadata;
                    return {
                        ...(spreadsheetMetadata.originalFileContent && {
                            originalFileContent: spreadsheetMetadata.originalFileContent
                        }),
                        ...(spreadsheetMetadata.columnHeaders && {
                            columnHeaders: spreadsheetMetadata.columnHeaders
                        }),
                        ...(spreadsheetMetadata.sourceColumnIndex !== undefined && {
                            sourceColumnIndex: spreadsheetMetadata.sourceColumnIndex
                        }),
                        ...(spreadsheetMetadata.delimiter && {
                            delimiter: spreadsheetMetadata.delimiter
                        }),
                    };
                })()
                : {}),
            // Preserve USFM round-trip structure metadata (original content + line mappings)
            ...('structureMetadata' in processedNotebook.metadata && processedNotebook.metadata.structureMetadata
                ? { structureMetadata: processedNotebook.metadata.structureMetadata as CustomNotebookMetadata['structureMetadata'] }
                : {}),
        };

        return {
            name: processedNotebook.name,
            cells,
            metadata,
        };
    }

    private async handleWriteNotebooks(
        message: WriteNotebooksMessage,
        token: vscode.CancellationToken,
        webviewPanel: vscode.WebviewPanel
    ): Promise<void> {
        // Skip conflict check for audio imports (they handle their own flow)
        const isAudioImport = message.metadata?.importerType === "audio";

        if (!isAudioImport) {
            // Check for file conflicts before proceeding
            const conflicts = await this.checkForFileConflicts(message.notebookPairs.map(pair => pair.source));

            if (conflicts.length > 0) {
                const confirmed = await this.confirmOverwriteWithTruncation(conflicts);
                if (!confirmed) {
                    webviewPanel.webview.postMessage({
                        command: "notification",
                        type: "info",
                        message: "Import cancelled by user"
                    });
                    return;
                }
            }
        }

        // No conflicts or user confirmed, proceed with import
        await this.handleWriteNotebooksForced(message, token, webviewPanel);
    }

    private async handleWriteNotebooksForced(
        message: WriteNotebooksMessage,
        token: vscode.CancellationToken,
        webviewPanel: vscode.WebviewPanel
    ): Promise<void> {
        // Import the original file utilities
        const { saveOriginalFileWithDeduplication } = await import('./originalFileUtils');

        // Save original files if provided in metadata (with hash-based deduplication)
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            for (const pair of message.notebookPairs) {
                if ("originalFileData" in pair.source.metadata && pair.source.metadata.originalFileData) {
                    // Save the original file with deduplication
                    const requestedFileName = pair.source.metadata.originalFileName || 'document.docx';
                    const fileData = pair.source.metadata.originalFileData;

                    // Convert to Uint8Array if needed
                    const buffer = fileData instanceof ArrayBuffer
                        ? new Uint8Array(fileData)
                        : Buffer.from(fileData);

                    // Use hash-based deduplication to save the file
                    // This handles:
                    // 1. Same name, same hash: Keep existing file
                    // 2. Different name, same hash: Return existing filename
                    // 3. Same name, different hash: Rename to sample(1).idml etc.
                    const result = await saveOriginalFileWithDeduplication(
                        workspaceFolder,
                        requestedFileName,
                        buffer
                    );

                    console.log(`[NewSourceUploader] Original file: ${result.message}`);

                    // Store the file hash in metadata for integrity verification and deduplication tracking
                    (pair.source.metadata as any).originalFileHash = result.hash;
                    if (pair.codex?.metadata) {
                        (pair.codex.metadata as any).originalFileHash = result.hash;
                    }

                    // IMPORTANT: Preserve user's original filename as fileDisplayName before updating originalFileName
                    // This ensures the display name reflects what the user imported, while originalFileName
                    // points to the actual deduplicated file in attachments/originals
                    if (result.fileName !== requestedFileName) {
                        // Set fileDisplayName to user's original name (without extension) if not already set
                        if (!pair.source.metadata.fileDisplayName) {
                            const displayName = requestedFileName.replace(/\.[^/.]+$/, ''); // Remove extension
                            (pair.source.metadata as any).fileDisplayName = displayName;
                            console.log(`[NewSourceUploader] Set fileDisplayName: "${displayName}" (from original "${requestedFileName}")`);
                        }
                        if (pair.codex?.metadata && !pair.codex.metadata.fileDisplayName) {
                            const displayName = requestedFileName.replace(/\.[^/.]+$/, '');
                            (pair.codex.metadata as any).fileDisplayName = displayName;
                        }

                        // Update originalFileName to point to the actual stored file (deduplicated)
                        pair.source.metadata.originalFileName = result.fileName;
                        if (pair.codex?.metadata) {
                            pair.codex.metadata.originalFileName = result.fileName;
                        }
                        console.log(`[NewSourceUploader] Updated originalFileName to deduplicated file: "${result.fileName}"`);
                    }

                    // CRITICAL: Do not persist original binary content into JSON notebooks.
                    // The original template is stored in `.project/attachments/originals/<actualFileName>`.
                    delete pair.source.metadata.originalFileData;
                }

                // For PDF imports: Also save the converted DOCX file for round-trip export (with deduplication)
                const pdfMetadata = (pair.source.metadata as any)?.pdfDocumentMetadata;
                if (pdfMetadata?.convertedDocxFileName) {
                    let docxBuffer: Uint8Array | null = null;

                    // If convertedDocxData is present (small files), use it directly
                    if (pdfMetadata.convertedDocxData) {
                        const docxData = pdfMetadata.convertedDocxData;
                        docxBuffer = docxData instanceof ArrayBuffer
                            ? new Uint8Array(docxData)
                            : Buffer.from(docxData);
                        // Remove from metadata to avoid persisting in JSON
                        delete pdfMetadata.convertedDocxData;
                    } else if (pdfMetadata.isLargeFile) {
                        // For large files, check if temp file exists and read it
                        const tempDir = vscode.Uri.joinPath(workspaceFolder.uri, '.project', 'temp');
                        try {
                            const tempFiles = await vscode.workspace.fs.readDirectory(tempDir);
                            const matchingFile = tempFiles.find(([name]) => name.startsWith('pdf_conversion_') && name.endsWith('.docx'));
                            if (matchingFile) {
                                const tempFileUri = vscode.Uri.joinPath(tempDir, matchingFile[0]);
                                docxBuffer = await vscode.workspace.fs.readFile(tempFileUri);
                                await vscode.workspace.fs.delete(tempFileUri); // Clean up temp file
                            }
                        } catch (err) {
                            console.warn(`[PDF Importer] Could not find/copy temp DOCX file: ${err}`);
                        }
                    }

                    // Save with deduplication if we have data
                    if (docxBuffer) {
                        const docxResult = await saveOriginalFileWithDeduplication(
                            workspaceFolder,
                            pdfMetadata.convertedDocxFileName,
                            docxBuffer
                        );
                        console.log(`[PDF Importer] Converted DOCX: ${docxResult.message}`);

                        // Update convertedDocxFileName to point to the actual stored file (deduplicated)
                        if (docxResult.fileName !== pdfMetadata.convertedDocxFileName) {
                            console.log(`[PDF Importer] Updated convertedDocxFileName: "${pdfMetadata.convertedDocxFileName}" -> "${docxResult.fileName}"`);
                            pdfMetadata.convertedDocxFileName = docxResult.fileName;
                        }
                    }
                }
            }
        }

        // Convert ProcessedNotebooks to NotebookPreview format
        const sourceNotebooks = await Promise.all(
            message.notebookPairs.map(pair => this.convertToNotebookPreview(pair.source))
        );
        const codexNotebooks = await Promise.all(
            message.notebookPairs.map(async pair => {
                // For codex notebooks, remove the original file data to avoid duplication
                const codexPair = { ...pair.codex };
                if ("originalFileData" in codexPair.metadata && codexPair.metadata.originalFileData) {
                    codexPair.metadata = { ...codexPair.metadata };
                    delete codexPair.metadata.originalFileData;
                }
                return await this.convertToNotebookPreview(codexPair);
            })
        );

        // Create the notebook pairs
        const createdFiles = await createNoteBookPair({
            token,
            sourceNotebooks,
            codexNotebooks,
        });

        // Register notebook references in the original files registry
        // This tracks which notebooks use each original file, so we know when it's safe to delete
        if (workspaceFolder) {
            const { addNotebookReference } = await import('./originalFileUtils');
            for (const createdFile of createdFiles) {
                try {
                    // Read the source notebook to get originalFileName from metadata
                    const sourceContent = await vscode.workspace.fs.readFile(createdFile.sourceUri);
                    const sourceNotebook = JSON.parse(new TextDecoder().decode(sourceContent));
                    const originalFileName = sourceNotebook?.metadata?.originalName || sourceNotebook?.metadata?.originalFileName;

                    if (originalFileName) {
                        // Use the source filename (without extension) as the notebook base name
                        const notebookBaseName = path.basename(createdFile.sourceUri.fsPath).replace(/\.[^/.]+$/, '');
                        await addNotebookReference(workspaceFolder, originalFileName, notebookBaseName);
                    }
                } catch (err) {
                    console.warn(`[NewSourceUploader] Could not register notebook reference: ${err}`);
                }
            }
        }

        // Migrate localized-books.json to codex metadata before deleting the file
        // Pass the newly created codex URIs directly to avoid search issues
        const createdCodexUris = createdFiles.map(f => f.codexUri);
        await this.migrateLocalizedBooksToMetadata(createdCodexUris);

        // Remove any localized book overrides to ensure fresh defaults after new source import
        await this.removeLocalizedBooksJsonIfPresent();

        // Show success message
        const count = message.notebookPairs.length;
        const notebooksText = count === 1 ? "notebook" : "notebooks";
        const firstNotebookName = message.notebookPairs[0]?.source.name || "unknown";

        vscode.window.showInformationMessage(
            count === 1
                ? `Successfully imported "${firstNotebookName}"!`
                : `Successfully imported ${count} ${notebooksText}!`
        );

        // Send success notification to webview
        webviewPanel.webview.postMessage({
            command: "notification",
            type: "success",
            message: "Notebooks created successfully!"
        });

        // Send updated inventory after successful import
        const inventory = await this.fetchProjectInventory();
        webviewPanel.webview.postMessage({
            command: "projectInventory",
            inventory: inventory,
        });

        // Reload metadata to discover newly created notebooks
        const metadataManager = getNotebookMetadataManager();
        await metadataManager.loadMetadata();

        // Use incremental indexing for just the newly created files
        if (createdFiles && createdFiles.length > 0) {
            // Extract file paths from the created URIs
            const filePaths: string[] = [];
            for (const result of createdFiles) {
                filePaths.push(result.sourceUri.fsPath);
                filePaths.push(result.codexUri.fsPath);
            }

            // Index only these specific files
            await vscode.commands.executeCommand("codex-editor-extension.indexSpecificFiles", filePaths);
        }
    }

    /**
     * Writes notebooks and persists provided attachments to .project/attachments/{files,pointers}/{DOC}/
     * Assumes the incoming notebookPairs already have per-cell attachments populated in metadata
     */
    private async handleWriteNotebooksWithAttachments(
        message: WriteNotebooksWithAttachmentsMessage,
        document: vscode.TextDocument,
        token: vscode.CancellationToken,
        webviewPanel: vscode.WebviewPanel
    ): Promise<void> {
        // No conflict check - force write

        // 1) Convert to NotebookPreview and write notebooks
        const sourceNotebooks = await Promise.all(
            message.notebookPairs.map(pair => this.convertToNotebookPreview(pair.source))
        );
        const codexNotebooks = await Promise.all(
            message.notebookPairs.map(pair => this.convertToNotebookPreview(pair.codex))
        );

        const createdFiles = await createNoteBookPair({ token, sourceNotebooks, codexNotebooks });

        // Migrate localized-books.json to codex metadata before deleting the file
        // Pass the newly created codex URIs directly to avoid search issues
        const createdCodexUris = createdFiles.map(f => f.codexUri);
        await this.migrateLocalizedBooksToMetadata(createdCodexUris);

        // Remove any localized book overrides to ensure fresh defaults after new source import
        await this.removeLocalizedBooksJsonIfPresent();

        // 2) Write video files separately (only once per video)
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error("No workspace folder found");
        }

        if (message.metadata?.videoFiles && Array.isArray(message.metadata.videoFiles)) {
            for (const videoFile of message.metadata.videoFiles) {
                const videoPath = vscode.Uri.joinPath(workspaceFolder.uri, videoFile.path);
                const videoDir = vscode.Uri.joinPath(videoPath, '..');
                await vscode.workspace.fs.createDirectory(videoDir);

                const base64 = videoFile.dataBase64.includes(",") ?
                    videoFile.dataBase64.split(",")[1] : videoFile.dataBase64;
                const buffer = Buffer.from(base64, "base64");
                await vscode.workspace.fs.writeFile(videoPath, buffer);
            }
        }

        // 3) Persist audio attachments (extract from video if needed)

        // Import audio extraction utility
        const { processMediaAttachment } = await import("../../utils/audioExtractor");

        // Show progress with VS Code information message
        const totalAttachments = message.attachments.length;
        let processedAttachments = 0;

        // Track the full media data for reuse across segments
        const mediaDataCache = new Map<string, Buffer>();

        if (totalAttachments > 0) {
            // Send initial progress to webview
            webviewPanel.webview.postMessage({
                command: "attachmentProgress",
                current: 0,
                total: totalAttachments,
                message: "Processing media attachments..."
            });

            // Use VS Code progress API for native progress indication
            const progressOptions = {
                location: vscode.ProgressLocation.Notification,
                title: "Importing Media Attachments",
                cancellable: false
            };

            await vscode.window.withProgress(progressOptions, async (progress) => {
                progress.report({ increment: 0, message: "Preparing media attachments..." });

                // Helper to download a remote file into a Buffer (uses fetch when available, falls back to https)
                const downloadRemoteToBuffer = async (url: string): Promise<{ buffer: Buffer; mime: string; fileNameHint?: string; }> => {
                    try {
                        const anyGlobal: any = globalThis as any;
                        if (anyGlobal.fetch) {
                            const res = await anyGlobal.fetch(url);
                            if (!res.ok) {
                                throw new Error(`HTTP ${res.status} ${res.statusText}`);
                            }
                            const arrayBuffer = await res.arrayBuffer();
                            const mime = (res.headers?.get && res.headers.get('content-type')) || '';
                            const cd = (res.headers?.get && res.headers.get('content-disposition')) || '';
                            const cdMatch = cd.match(/filename\*?=(?:UTF-8''|")?([^";\r\n]+)/i);
                            const fileNameHint = cdMatch ? decodeURIComponent(cdMatch[1].replace(/"/g, '')) : undefined;
                            return { buffer: Buffer.from(arrayBuffer), mime, fileNameHint };
                        }
                    } catch (e) {
                        // fall through to https fallback
                    }

                    const { request } = await import('node:https');
                    const { parse } = await import('node:url');
                    const urlObj = parse(url);
                    const isHttps = true;
                    const maxRedirects = 5;
                    const fetchWithRedirects = (currentUrl: string, redirectsLeft: number): Promise<{ buffer: Buffer; mime: string; fileNameHint?: string; }> => {
                        return new Promise((resolve, reject) => {
                            const req = request(currentUrl, (res) => {
                                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                                    if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
                                    const nextUrl = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, currentUrl).toString();
                                    res.resume();
                                    return resolve(fetchWithRedirects(nextUrl, redirectsLeft - 1));
                                }
                                if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                                    return reject(new Error(`HTTP ${res.statusCode}`));
                                }
                                const chunks: Buffer[] = [];
                                res.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
                                res.on('end', () => {
                                    const buffer = Buffer.concat(chunks);
                                    const mime = (res.headers['content-type'] as string) || '';
                                    const cd = (res.headers['content-disposition'] as string) || '';
                                    const cdMatch = cd.match(/filename\*?=(?:UTF-8''|")?([^";\r\n]+)/i);
                                    const fileNameHint = cdMatch ? decodeURIComponent(cdMatch[1].replace(/"/g, '')) : undefined;
                                    resolve({ buffer, mime, fileNameHint });
                                });
                                res.on('error', reject);
                            });
                            req.on('error', reject);
                            req.end();
                        });
                    };

                    return await fetchWithRedirects(url, maxRedirects);
                };

                // Helper to normalize audio file extensions (remove x- prefix, handle aliases)
                const normalizeExtension = (ext: string): string => {
                    if (!ext) return 'webm';
                    ext = ext.toLowerCase().trim();

                    // Remove codec parameters (e.g., "webm;codecs=opus" -> "webm")
                    ext = ext.split(';')[0];

                    // Normalize non-standard MIME types (e.g., "x-m4a" -> "m4a")
                    if (ext.startsWith('x-')) {
                        ext = ext.substring(2);
                    }

                    // Handle MIME type aliases
                    if (ext === 'mp4' || ext === 'mpeg') {
                        return 'm4a';
                    }

                    // Validate against allowed extensions
                    const allowedExtensions = new Set(['webm', 'wav', 'mp3', 'm4a', 'ogg', 'aac', 'flac']);
                    return allowedExtensions.has(ext) ? ext : 'webm';
                };

                // Helper to normalize filename extension
                const normalizeFileName = (fileName: string): string => {
                    const match = fileName.match(/^(.+)\.([^.]+)$/);
                    if (!match) return fileName;
                    const [, baseName, ext] = match;
                    return `${baseName}.${normalizeExtension(ext)}`;
                };

                // Process attachments in smaller batches to avoid blocking
                const batchSize = 3;
                for (let i = 0; i < message.attachments.length; i += batchSize) {
                    const batch = message.attachments.slice(i, i + batchSize);

                    // Process batch in parallel
                    await Promise.all(batch.map(async (attachment) => {
                        const { cellId, attachmentId, fileName, dataBase64, sourceFileId, isFromVideo, remoteUrl } = attachment as any;


                        const docSegment =
                            getAttachmentDocumentSegmentFromUri(document.uri) ||
                            "UNKNOWN";
                        const filesDir = vscode.Uri.joinPath(workspaceFolder.uri, ".project", "attachments", "files", docSegment);
                        const pointersDir = vscode.Uri.joinPath(workspaceFolder.uri, ".project", "attachments", "pointers", docSegment);
                        await vscode.workspace.fs.createDirectory(filesDir);
                        await vscode.workspace.fs.createDirectory(pointersDir);

                        let audioBuffer: Buffer;
                        let effectiveFileName = normalizeFileName(fileName as string);

                        // Handle segments with actual data
                        if (dataBase64) {
                            console.log(`Processing ${isFromVideo ? 'video' : 'audio'} file: ${fileName}`);

                            // For video files, cache the original video data before processing
                            if (isFromVideo && !sourceFileId && attachment.dataBase64) {
                                const baseId = attachmentId.replace(/-seg\d+$/, '');
                                const base64 = attachment.dataBase64.includes(",")
                                    ? attachment.dataBase64.split(",")[1]
                                    : attachment.dataBase64;
                                const videoBuffer = Buffer.from(base64, "base64");
                                mediaDataCache.set(baseId, videoBuffer);
                            }

                            // Process the media (extract audio if from video, or use pre-segmented audio)
                            audioBuffer = await processMediaAttachment(attachment, isFromVideo || false);

                            // Write the audio file
                            const filesPath = vscode.Uri.joinPath(filesDir, effectiveFileName);
                            const pointersPath = vscode.Uri.joinPath(pointersDir, effectiveFileName);
                            await vscode.workspace.fs.writeFile(filesPath, audioBuffer);
                            await vscode.workspace.fs.writeFile(pointersPath, audioBuffer);
                        } else if (remoteUrl) {
                            // Download remotely (bypasses webview CORS)
                            const { buffer, mime, fileNameHint } = await downloadRemoteToBuffer(remoteUrl);
                            audioBuffer = buffer;
                            // If no extension on provided fileName, infer from mime or hint
                            if (!/\.[a-z0-9]+$/i.test(effectiveFileName)) {
                                const extFromMime = mime && mime.includes('/')
                                    ? normalizeExtension(mime.split('/').pop() || 'mp3')
                                    : 'mp3';
                                effectiveFileName = fileNameHint
                                    ? normalizeFileName(fileNameHint)
                                    : `${attachmentId}.${extFromMime}`;
                            }
                            const filesPath = vscode.Uri.joinPath(filesDir, effectiveFileName);
                            const pointersPath = vscode.Uri.joinPath(pointersDir, effectiveFileName);
                            await vscode.workspace.fs.writeFile(filesPath, audioBuffer);
                            await vscode.workspace.fs.writeFile(pointersPath, audioBuffer);
                        } else if (sourceFileId) {
                            // Subsequent video segments - reuse the cached video data and extract audio segment
                            const baseId = sourceFileId.replace(/-seg\d+$/, '');
                            const cachedVideo = mediaDataCache.get(baseId);

                            if (cachedVideo) {
                                console.log(`Writing video segment ${fileName} using cached video data`);
                                // Create a temporary attachment with the cached video data and timing info
                                const tempAttachment = {
                                    ...attachment,
                                    dataBase64: `data:video/mp4;base64,${cachedVideo.toString('base64')}`
                                };
                                // Extract the specific time range from the video
                                const processedAudio = await processMediaAttachment(tempAttachment, true);
                                const filesPath = vscode.Uri.joinPath(filesDir, effectiveFileName);
                                const pointersPath = vscode.Uri.joinPath(pointersDir, effectiveFileName);
                                await vscode.workspace.fs.writeFile(filesPath, processedAudio);
                                await vscode.workspace.fs.writeFile(pointersPath, processedAudio);
                            } else {
                                console.warn(`No cached video data found for ${sourceFileId}`);
                            }
                        }

                        // Update progress
                        processedAttachments++;

                        progress.report({
                            increment: 100 / totalAttachments,
                            message: `Processing ${fileName}... (${processedAttachments}/${totalAttachments})`
                        });

                        // Send progress to webview
                        webviewPanel.webview.postMessage({
                            command: "attachmentProgress",
                            current: processedAttachments,
                            total: totalAttachments,
                            message: `Processing ${fileName}...`
                        });
                    }));

                    // Small delay between batches to prevent blocking
                    if (i + batchSize < message.attachments.length) {
                        await new Promise(resolve => setTimeout(resolve, 10));
                    }
                }

                progress.report({ message: "Finalizing import..." });
            });
        }

        // 4) Write success + inventory
        const count = message.notebookPairs.length;
        const notebooksText = count === 1 ? "notebook" : "notebooks";
        const firstNotebookName = message.notebookPairs[0]?.source.name || "unknown";
        vscode.window.showInformationMessage(
            count === 1
                ? `Successfully imported "${firstNotebookName}"!`
                : `Successfully imported ${count} ${notebooksText}!`
        );
        // Send final progress completion message
        webviewPanel.webview.postMessage({
            command: "attachmentProgress",
            current: totalAttachments,
            total: totalAttachments,
            message: "Import complete!"
        });

        webviewPanel.webview.postMessage({ command: "notification", type: "success", message: "Notebooks and attachments created successfully!" });
        const inventory = await this.fetchProjectInventory();
        webviewPanel.webview.postMessage({ command: "projectInventory", inventory });
    }

    /**
     * Migrates book display names from localized-books.json into individual codex file metadata.
     * Reads localized-books.json, finds matching codex files, and updates their fileDisplayName metadata.
     * @param codexUris Optional array of codex URIs to migrate. If provided, uses these directly instead of searching.
     */
    private async migrateLocalizedBooksToMetadata(codexUris?: vscode.Uri[]): Promise<void> {
        await migrateLocalizedBooks(codexUris);
    }

    /**
     * Removes the workspace-level localized-books.json file if present.
     * This ensures that newly uploaded sources don't inherit stale overrides.
     */
    private async removeLocalizedBooksJsonIfPresent(): Promise<void> {
        await removeLocalizedBooksJson();
    }

    private async handleWriteTranslation(
        message: WriteTranslationMessage,
        token: vscode.CancellationToken
    ): Promise<void> {
        try {
            // The aligned content is already provided by the plugin's custom alignment algorithm
            // We just need to merge it into the existing target notebook

            // Load the existing target notebook
            const targetFileUri = vscode.Uri.file(message.targetFilePath);
            const existingContent = await vscode.workspace.fs.readFile(targetFileUri);
            const existingNotebook = JSON.parse(new TextDecoder().decode(existingContent));

            // Create a map of existing cells for quick lookup
            const existingCellsMap = new Map<string, any>();
            existingNotebook.cells.forEach((cell: any) => {
                if (cell.metadata?.id) {
                    existingCellsMap.set(cell.metadata.id, cell);
                }
            });

            // Track statistics
            let insertedCount = 0;
            let skippedCount = 0;
            let paratextCount = 0;
            let childCellCount = 0;

            // Process aligned cells and update the notebook
            const processedCells = new Map<string, any>();
            const processedSourceCells = new Set<string>();

            for (const alignedCell of message.alignedContent) {
                if (alignedCell.isParatext) {
                    // Add paratext cells
                    const paratextId = alignedCell.importedContent.id;
                    const importedData = alignedCell.importedContent.data;
                    const paratextData =
                        typeof importedData === "object" && importedData !== null ? importedData : {};
                    const paratextCell = {
                        kind: 1, // vscode.NotebookCellKind.Code
                        languageId: "html",
                        value: alignedCell.importedContent.content,
                        metadata: {
                            type: CodexCellTypes.PARATEXT,
                            id: paratextId,
                            data: {
                                ...paratextData,
                                startTime: alignedCell.importedContent.startTime,
                                endTime: alignedCell.importedContent.endTime,
                            },
                            parentId: alignedCell.importedContent.parentId,
                        },
                    };
                    processedCells.set(paratextId, paratextCell);
                    paratextCount++;
                } else if (alignedCell.notebookCell) {
                    const targetId = alignedCell.importedContent.id;
                    const existingCell = existingCellsMap.get(targetId);
                    const existingValue = existingCell?.value ?? alignedCell.notebookCell.value ?? "";

                    if (existingValue && existingValue.trim() !== "") {
                        // Keep existing content if cell already has content
                        processedCells.set(targetId, existingCell || alignedCell.notebookCell);
                        skippedCount++;
                    } else {
                        // Update empty cell with new content
                        const updatedCell = {
                            kind: 1, // vscode.NotebookCellKind.Code
                            languageId: "html",
                            value: alignedCell.importedContent.content,
                            metadata: {
                                ...alignedCell.notebookCell.metadata,
                                type: CodexCellTypes.TEXT,
                                id: targetId,
                                data: {
                                    ...alignedCell.notebookCell.metadata.data,
                                    startTime: alignedCell.importedContent.startTime,
                                    endTime: alignedCell.importedContent.endTime,
                                },
                            },
                        };
                        processedCells.set(targetId, updatedCell);

                        if (alignedCell.isAdditionalOverlap) {
                            childCellCount++;
                        } else {
                            insertedCount++;
                        }
                    }
                }
            }

            // Build the final cell array, preserving the temporal order from alignedContent
            const newCells: any[] = [];
            const usedExistingCellIds = new Set<string>();

            // Process cells in the order they appear in alignedContent (temporal order)
            for (const alignedCell of message.alignedContent) {
                if (alignedCell.isParatext) {
                    // Add paratext cell
                    const paratextId = alignedCell.importedContent.id;
                    const paratextCell = processedCells.get(paratextId);
                    if (paratextCell) {
                        newCells.push(paratextCell);
                    }
                } else if (alignedCell.notebookCell) {
                    const targetId = alignedCell.importedContent.id;
                    const processedCell = processedCells.get(targetId);

                    if (processedCell) {
                        newCells.push(processedCell);
                        usedExistingCellIds.add(targetId);
                    }
                }
            }

            // Add any existing cells that weren't in the aligned content (shouldn't happen normally)
            for (const cell of existingNotebook.cells) {
                const cellId = cell.metadata?.id;
                if (!cellId || usedExistingCellIds.has(cellId)) {
                    continue;
                }
                console.warn(`Cell ${cellId} was not in aligned content, appending at end`);
                newCells.push(cell);
            }

            // Update the notebook
            const updatedNotebook = {
                ...existingNotebook,
                cells: newCells,
            };

            // Write the updated notebook back to disk
            await vscode.workspace.fs.writeFile(
                targetFileUri,
                Buffer.from(formatJsonForNotebookFile(updatedNotebook))
            );

            // Show success message with statistics
            vscode.window.showInformationMessage(
                `Translation imported: ${insertedCount} translations, ${paratextCount} paratext cells, ${childCellCount} child cells, ${skippedCount} skipped.`
            );
        } catch (error) {
            console.error("Error in translation import:", error);
            throw error;
        }
    }

    /**
     * Check if importing these notebooks would overwrite existing files
     */
    private async checkForFileConflicts(sourceNotebooks: ProcessedNotebook[]): Promise<Array<{
        name: string;
        displayName: string;
        sourceExists: boolean;
        targetExists: boolean;
        hasTranslations: boolean;
    }>> {
        const conflicts = [];
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

        if (!workspaceFolder) {
            return [];
        }

        for (const notebook of sourceNotebooks) {
            const sourceFilename = await createStandardizedFilename(notebook.name, ".source");
            const codexFilename = await createStandardizedFilename(notebook.name, ".codex");

            const sourceUri = vscode.Uri.joinPath(
                workspaceFolder.uri,
                ".project",
                "sourceTexts",
                sourceFilename
            );
            const codexUri = vscode.Uri.joinPath(
                workspaceFolder.uri,
                "files",
                "target",
                codexFilename
            );

            // Check if files exist
            let sourceDisplayName = "";
            let sourceExists = false;
            let targetExists = false;
            let hasTranslations = false;

            try {
                const sourceStat = await vscode.workspace.fs.stat(sourceUri);
                sourceExists = true;

                if (sourceStat.size > 0) {
                    try {
                        const sourceContent = await vscode.workspace.fs.readFile(sourceUri);
                        const sourceNotebook = JSON.parse(new TextDecoder().decode(sourceContent));

                        sourceDisplayName = sourceNotebook.metadata.fileDisplayName || "";
                    } catch {
                        // Error reading source file, assume no content
                    }
                }
            } catch {
                // File doesn't exist
            }

            try {
                const targetStat = await vscode.workspace.fs.stat(codexUri);
                targetExists = true;

                // Check if target file has any content (translations)
                if (targetStat.size > 0) {
                    try {
                        const targetContent = await vscode.workspace.fs.readFile(codexUri);
                        const targetNotebook = JSON.parse(new TextDecoder().decode(targetContent));

                        // Check if any cells have non-empty content
                        hasTranslations = targetNotebook.cells?.some((cell: any) =>
                            cell.value && cell.value.trim() !== ""
                        ) || false;
                    } catch {
                        // Error reading target file, assume no translations
                    }
                }
            } catch {
                // File doesn't exist
            }

            // Only add to conflicts if at least one file exists
            if (sourceExists || targetExists) {
                conflicts.push({
                    name: notebook.name,
                    displayName: sourceDisplayName,
                    sourceExists,
                    targetExists,
                    hasTranslations
                });
            }
        }

        return conflicts;
    }

    private async checkForExistingFiles(): Promise<Array<{
        name: string;
        path: string;
        type: string;
        cellCount: number;
        metadata?: any;
    }>> {
        const files: Array<{
            name: string;
            path: string;
            type: string;
            cellCount: number;
            metadata?: any;
        }> = [];

        try {
            // Find all .source files in the workspace
            const sourceFiles = await vscode.workspace.findFiles("**/*.source", "**/node_modules/**");

            for (const file of sourceFiles) {
                try {
                    const document = await vscode.workspace.openNotebookDocument(file);
                    const metadata = document.metadata as CustomNotebookMetadata | undefined;

                    const fileName = file.path.split('/').pop()?.replace('.source', '') || 'Unknown';
                    const cellCount = document.cellCount;

                    // Determine file type based on metadata or content
                    let fileType = 'unknown';
                    if (metadata?.corpusMarker) {
                        fileType = metadata.corpusMarker;
                    } else if (this.checkIfBibleContent(document)) {
                        fileType = 'bible';
                    }

                    files.push({
                        name: fileName,
                        path: file.path,
                        type: fileType,
                        cellCount: cellCount,
                        metadata: {
                            id: metadata?.id,
                            originalName: metadata?.originalName,
                            corpusMarker: metadata?.corpusMarker,
                            sourceCreatedAt: metadata?.sourceCreatedAt,
                        }
                    });
                } catch (err) {
                    console.error(`Error checking file ${file.path}:`, err);
                }
            }

            return files;

        } catch (error) {
            console.error("Error checking for existing Bibles:", error);
            return [];
        }
    }

    // Presents a concise overwrite confirmation with truncation and optional details view
    private async confirmOverwriteWithTruncation(items: Array<{ name: string; displayName: string; sourceExists: boolean; targetExists: boolean; hasTranslations: boolean; }>): Promise<boolean> {
        return confirmOverwriteWithDetails(items);
    }

    private async fetchProjectInventory(): Promise<{
        sourceFiles: Array<{
            name: string;
            path: string;
        }>;
        targetFiles: Array<{
            name: string;
            path: string;
        }>;
        translationPairs: Array<{
            sourceFile: any;
            targetFile: any;
        }>;
    }> {
        const sourceFiles: any[] = [];
        const targetFiles: any[] = [];
        const translationPairs: any[] = [];

        try {
            // Find all .source and .codex files in the workspace
            const [sourceFileUris, codexFileUris] = await Promise.all([
                vscode.workspace.findFiles(".project/sourceTexts/*.source"),
                vscode.workspace.findFiles("files/target/*.codex")
            ]);

            debug("[NEW SOURCE UPLOADER] Found source files:", sourceFileUris.length);
            debug("[NEW SOURCE UPLOADER] Found codex files:", codexFileUris.length);

            // Process source files (basic metadata only)
            for (const file of sourceFileUris) {
                const fileName = file.path.split('/').pop()?.replace('.source', '') || 'Unknown';
                sourceFiles.push({
                    name: fileName,
                    path: file.path,
                });
            }

            // Process codex (target) files (basic metadata only)
            for (const file of codexFileUris) {
                const fileName = file.path.split('/').pop()?.replace('.codex', '') || 'Unknown';
                const targetFile = {
                    name: fileName,
                    path: file.path,
                };
                targetFiles.push(targetFile);

                // Create translation pairs based on matching base names
                const matchingSource = sourceFiles.find(source => source.name === fileName);
                if (matchingSource) {
                    translationPairs.push({
                        sourceFile: matchingSource,
                        targetFile: targetFile,
                    });
                }
            }

            const result = {
                sourceFiles,
                targetFiles,
                translationPairs,
            };
            debug("[NEW SOURCE UPLOADER] Final inventory result:", result);
            return result;

        } catch (error) {
            console.error("Error fetching project inventory:", error);
            return {
                sourceFiles: [],
                targetFiles: [],
                translationPairs: [],
            };
        }
    }

    private async fetchFileDetails(filePath: string): Promise<{
        name: string;
        path: string;
        type: string;
        cellCount: number;
        metadata?: any;
    }> {
        try {
            const uri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openNotebookDocument(uri);
            const metadata = document.metadata as CustomNotebookMetadata | undefined;

            const fileName = filePath.split('/').pop()?.replace(/\.(source|codex)$/, '') || 'Unknown';
            const cellCount = document.cellCount;

            // Determine file type based on metadata or content
            let fileType = 'unknown';
            if (metadata?.corpusMarker) {
                fileType = metadata.corpusMarker;
            } else if (this.checkIfBibleContent(document)) {
                fileType = 'bible';
            }

            return {
                name: fileName,
                path: filePath,
                type: fileType,
                cellCount: cellCount,
                metadata: {
                    id: metadata?.id,
                    originalName: metadata?.originalName,
                    corpusMarker: metadata?.corpusMarker,
                    sourceCreatedAt: metadata?.sourceCreatedAt,
                }
            };
        } catch (error) {
            console.error(`Error fetching details for file ${filePath}:`, error);
            throw error;
        }
    }

    private async handleDownloadResource(message: any, webviewPanel: vscode.WebviewPanel): Promise<void> {
        const { pluginId, requestId } = message;

        try {
            // Import the download handler registry
            const { executeDownloadHandler } = await import("./downloadHandlerRegistry");

            // Execute the download with progress reporting
            const result = await executeDownloadHandler(
                pluginId,
                (progress) => {
                    webviewPanel.webview.postMessage({
                        command: "downloadResourceProgress",
                        requestId: requestId,
                        progress: progress
                    });
                }
            );

            // Send the result back to the webview
            webviewPanel.webview.postMessage({
                command: "downloadResourceComplete",
                requestId: requestId,
                success: result.success,
                data: result.data,
                error: result.error
            });

        } catch (error) {
            console.error(`Download resource failed for plugin ${pluginId}:`, error);
            webviewPanel.webview.postMessage({
                command: "downloadResourceComplete",
                requestId: requestId,
                success: false,
                error: error instanceof Error ? error.message : "Unknown error occurred"
            });
        }
    }

    /**
     * Handle saveFile command from webview - saves a file using VS Code's save dialog
     */
    private async handleSaveFile(message: SaveFileMessage, webviewPanel: vscode.WebviewPanel): Promise<void> {
        try {
            const { fileName, dataBase64, mime } = message;

            // Extract base64 data (handle data: URL format)
            let base64Data = dataBase64;
            if (base64Data.includes(',')) {
                // Remove data: URL prefix if present
                base64Data = base64Data.split(',')[1];
            }

            // Convert base64 to Buffer
            const buffer = Buffer.from(base64Data, 'base64');

            if (buffer.length === 0) {
                throw new Error('File data is empty');
            }

            // Show save dialog
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            const defaultUri = workspaceFolder
                ? vscode.Uri.joinPath(workspaceFolder.uri, fileName)
                : undefined;

            const saveUri = await vscode.window.showSaveDialog({
                defaultUri,
                saveLabel: 'Save',
                filters: mime
                    ? {
                        'All Files': ['*'],
                        [mime]: [fileName.split('.').pop() || '*']
                    }
                    : undefined
            });

            if (!saveUri) {
                // User cancelled
                webviewPanel.webview.postMessage({
                    command: "notification",
                    type: "info",
                    message: "File save cancelled"
                });
                return;
            }

            // Write file
            await vscode.workspace.fs.writeFile(saveUri, buffer);

            // Send success notification
            webviewPanel.webview.postMessage({
                command: "notification",
                type: "success",
                message: `File saved successfully: ${path.basename(saveUri.fsPath)}`
            });

            console.log(`[NEW SOURCE UPLOADER] File saved: ${saveUri.fsPath} (${buffer.length} bytes)`);

        } catch (error) {
            console.error("[NEW SOURCE UPLOADER] Error saving file:", error);
            webviewPanel.webview.postMessage({
                command: "notification",
                type: "error",
                message: error instanceof Error ? error.message : "Failed to save file"
            });
        }
    }

    private checkIfBibleContent(document: vscode.NotebookDocument): boolean {
        // Check first few cells to see if they contain Bible verse references
        const cellsToCheck = Math.min(5, document.cellCount);
        let bibleRefCount = 0;

        for (let i = 0; i < cellsToCheck; i++) {
            const cell = document.cellAt(i);
            const cellId = cell.metadata?.id || '';

            // Check if cell ID matches Bible verse pattern (e.g., "GEN 1:1", "MAT 1:1")
            if (/^[A-Z1-9]{3}\s+\d+:\d+/.test(cellId)) {
                bibleRefCount++;
            }
        }

        // If most cells have Bible verse references, it's likely a Bible
        return bibleRefCount >= cellsToCheck * 0.6;
    }


    private getHtmlForWebview(webview: vscode.Webview): string {
        return getWebviewHtml(webview, this.context, {
            title: "Source File Importer",
            scriptPath: ["NewSourceUploader", "index.js"],
            // Using default CSP which already includes webview.cspSource for media-src
            csp: `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-\${nonce}'; img-src data: https:; font-src ${webview.cspSource}; connect-src https: http:; media-src blob: data:;`,
            inlineStyles: "#root { height: 100vh; width: 100vw; overflow-y: auto; }",
            customScript: "window.vscodeApi = acquireVsCodeApi();"
        });
    }

    /**
     * Execute Python script with Pandoc for RTF processing
     */
    private async executePythonScript(scriptName: string, args: string[]): Promise<string> {
        const scriptPath = path.join(
            this.context.extensionPath,
            'webviews',
            'codex-webviews',
            'src',
            'NewSourceUploader',
            'importers',
            'rtf',
            scriptName
        );

        // Build command
        const command = `python "${scriptPath}" ${args.map(arg => `"${arg}"`).join(' ')}`;

        debug(`Executing Python command: ${command}`);

        try {
            const { stdout, stderr } = await execAsync(command);

            if (stderr) {
                console.warn(`Python stderr: ${stderr}`);
            }

            return stdout;
        } catch (error) {
            console.error('Python execution failed:', error);
            throw new Error(`Failed to execute Python script: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Handle RTF parsing with Pandoc
     * COMMENTED OUT - RTF importer disabled
     */
    /* private async handleParsertfWithPandoc(message: any, webviewPanel: vscode.WebviewPanel): Promise<void> {
        try {
            const { fileName, fileData } = message;

            // Save file to temporary location
            const tmpDir = path.join(this.context.extensionPath, '.tmp');
            if (!fs.existsSync(tmpDir)) {
                fs.mkdirSync(tmpDir, { recursive: true });
            }

            const tmpFilePath = path.join(tmpDir, `rtf_${Date.now()}_${fileName}`);
            const buffer = Buffer.from(fileData);
            fs.writeFileSync(tmpFilePath, buffer);

            debug(`Saved RTF to temporary file: ${tmpFilePath}`);

            try {
                // Use Node.js bridge (no Python required!)
                const result = await parseRtfNode(tmpFilePath);

                debug(`RTF parsed successfully:`, result);

                // Send result back to webview
                webviewPanel.webview.postMessage({
                    command: 'rtfParsed',
                    success: result.success,
                    data: result.data,
                    error: result.error
                });

            } finally {
                // Clean up temporary file
                if (fs.existsSync(tmpFilePath)) {
                    fs.unlinkSync(tmpFilePath);
                    debug(`Cleaned up temporary file: ${tmpFilePath}`);
                }
            }

        } catch (error) {
            console.error('RTF parsing error:', error);
            webviewPanel.webview.postMessage({
                command: 'rtfParsed',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    } */

    /**
     * Handle RTF export with Pandoc
     * COMMENTED OUT - RTF importer disabled
     */
    /* private async handleExportRtfWithPandoc(message: any, webviewPanel: vscode.WebviewPanel): Promise<void> {
        try {
            const { pandocJson, translations, fileName } = message;

            // Save Pandoc JSON and translations to temporary files
            const tmpDir = path.join(this.context.extensionPath, '.tmp');
            if (!fs.existsSync(tmpDir)) {
                fs.mkdirSync(tmpDir, { recursive: true });
            }

            const pandocJsonPath = path.join(tmpDir, `pandoc_${Date.now()}.json`);
            const translationsPath = path.join(tmpDir, `translations_${Date.now()}.json`);
            const outputPath = path.join(tmpDir, `output_${Date.now()}_${fileName}`);

            fs.writeFileSync(pandocJsonPath, JSON.stringify(pandocJson));
            fs.writeFileSync(translationsPath, JSON.stringify(translations));

            debug(`Saved Pandoc data for export:`, { pandocJsonPath, translationsPath, outputPath });

            try {
                // Execute Python script to export RTF
                const result = await this.executePythonScript('rtfPandocBridge.py', [
                    'export',
                    pandocJsonPath,
                    translationsPath,
                    outputPath
                ]);

                // Parse JSON result
                const exportResult = JSON.parse(result);

                debug(`RTF exported successfully:`, exportResult);

                // Send result back to webview
                webviewPanel.webview.postMessage({
                    command: 'rtfExported',
                    success: exportResult.success,
                    outputFile: exportResult.output_file,
                    error: exportResult.error
                });

            } finally {
                // Clean up temporary files
                [pandocJsonPath, translationsPath].forEach(file => {
                    if (fs.existsSync(file)) {
                        fs.unlinkSync(file);
                        debug(`Cleaned up: ${file}`);
                    }
                });
            }

        } catch (error) {
            console.error('RTF export error:', error);
            webviewPanel.webview.postMessage({
                command: 'rtfExported',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    } */

    /**
     * Handle RTF to HTML conversion
     * COMMENTED OUT - RTF importer disabled
     */
    /* private async handleRtfToHtml(message: any, webviewPanel: vscode.WebviewPanel): Promise<void> {
        try {
            const { fileName, fileData } = message;

            // Save file to temporary location
            const tmpDir = path.join(this.context.extensionPath, '.tmp');
            if (!fs.existsSync(tmpDir)) {
                fs.mkdirSync(tmpDir, { recursive: true });
            }

            const tmpFilePath = path.join(tmpDir, `rtf_html_${Date.now()}_${fileName}`);
            const buffer = Buffer.from(fileData);
            fs.writeFileSync(tmpFilePath, buffer);

            debug(`Saved RTF for HTML conversion: ${tmpFilePath}`);

            try {
                // Execute Python script to convert RTF to HTML
                const result = await this.executePythonScript('rtfPandocBridge.py', ['to_html', tmpFilePath]);

                // Parse JSON result
                const conversionResult = JSON.parse(result);

                debug(`RTF to HTML conversion successful`);

                // Send result back to webview
                webviewPanel.webview.postMessage({
                    command: 'rtfHtmlConverted',
                    success: conversionResult.success,
                    html: conversionResult.html,
                    error: conversionResult.error
                });

            } finally {
                // Clean up temporary file
                if (fs.existsSync(tmpFilePath)) {
                    fs.unlinkSync(tmpFilePath);
                    debug(`Cleaned up: ${tmpFilePath}`);
                }
            }

        } catch (error) {
            console.error('RTF to HTML conversion error:', error);
            webviewPanel.webview.postMessage({
                command: 'rtfHtmlConverted',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    } */
}

// Helper to present a concise overwrite confirmation with truncation and an Output Channel for details
async function confirmOverwriteWithDetails(
    items: Array<{ name: string; displayName: string; sourceExists: boolean; targetExists: boolean; hasTranslations: boolean; }>,
    options?: { maxItems?: number; }
): Promise<boolean> {
    const maxItems = options?.maxItems ?? 15;

    const makeLine = (c: { name: string; displayName: string; sourceExists: boolean; targetExists: boolean; hasTranslations: boolean; }) => {
        const parts: string[] = [];
        if (c.sourceExists) parts.push("source file");
        if (c.targetExists) parts.push("target file");
        if (c.hasTranslations) parts.push("with translations");
        return `• ${c.displayName ? `${c.displayName} [${c.name}]` : c.name} (${parts.join(", ")})`;
    };

    const fullList = items.map(makeLine).join("\n");
    const truncatedList = items.slice(0, maxItems).map(makeLine).join("\n");
    const hasMore = items.length > maxItems;

    const baseMessage = hasMore
        ? `The following files already exist and will be overwritten (showing first ${maxItems} of ${items.length}):\n\n${truncatedList}\n\nThis will permanently delete any existing translations for these files. Continue?`
        : `The following files already exist and will be overwritten:\n\n${truncatedList}\n\nThis will permanently delete any existing translations for these files. Continue?`;

    const choices = hasMore ? ["Overwrite Files", "View Details", "Abort Import"] : ["Overwrite Files", "Abort Import"];
    const action = await vscode.window.showWarningMessage<string>(
        baseMessage,
        { modal: true },
        ...choices
    );

    if (action === "View Details") {
        const channel = vscode.window.createOutputChannel("Codex Import Conflicts");
        channel.clear();
        channel.appendLine("The following files already exist and will be overwritten:\n");
        channel.appendLine(fullList);
        channel.show(true);

        const confirmAfterView = await vscode.window.showWarningMessage<string>(
            "Proceed with overwriting the files listed in the 'Codex Import Conflicts' output?",
            { modal: true },
            "Overwrite Files",
            "Abort Import"
        );
        return confirmAfterView === "Overwrite Files";
    }

    return action === "Overwrite Files";
}

