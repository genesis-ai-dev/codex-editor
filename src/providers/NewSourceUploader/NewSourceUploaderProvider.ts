import * as vscode from "vscode";
import * as path from "path";
import { getWebviewHtml } from "../../utils/webviewTemplate";
import { createNoteBookPair } from "./codexFIleCreateUtils";
import { WriteNotebooksMessage, WriteTranslationMessage, OverwriteResponseMessage, WriteNotebooksWithAttachmentsMessage } from "../../../webviews/codex-webviews/src/NewSourceUploader/types/plugin";
import { ProcessedNotebook } from "../../../webviews/codex-webviews/src/NewSourceUploader/types/common";
import { NotebookPreview, CustomNotebookMetadata } from "../../../types";
import { CodexCell } from "../../utils/codexNotebookUtils";
import { CodexCellTypes } from "../../../types/enums";
import { importBookNamesFromXmlContent } from "../../bookNameSettings/bookNameSettings";
import { createStandardizedFilename } from "../../utils/bookNameUtils";
import { CodexContentSerializer } from "../../serializer";

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
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri],
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
                } else if (message.command === "writeNotebooks") {
                    await this.handleWriteNotebooks(message as WriteNotebooksMessage, token, webviewPanel);
                } else if (message.command === "writeNotebooksWithAttachments") {
                    await this.handleWriteNotebooksWithAttachments(message as WriteNotebooksWithAttachmentsMessage, token, webviewPanel);
                    // Success and inventory update handled inside

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
    private convertToNotebookPreview(processedNotebook: ProcessedNotebook): NotebookPreview {
        const cells: CodexCell[] = processedNotebook.cells.map(processedCell => ({
            kind: vscode.NotebookCellKind.Code,
            value: processedCell.content,
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
                data: processedCell.metadata?.data || {}
            }
        }));

        const metadata: CustomNotebookMetadata = {
            id: processedNotebook.metadata.id,
            originalName: processedNotebook.metadata.originalFileName,
            sourceFsPath: "",
            codexFsPath: "",
            navigation: [],
            sourceCreatedAt: processedNotebook.metadata.createdAt,
            corpusMarker: processedNotebook.metadata.corpusMarker || processedNotebook.metadata.importerType,
            textDirection: "ltr",
            ...(processedNotebook.metadata.videoUrl && { videoUrl: processedNotebook.metadata.videoUrl }),
            ...(processedNotebook.metadata)?.audioOnly !== undefined
                ? { audioOnly: processedNotebook.metadata.audioOnly as boolean }
                : {},
            // Preserve document structure metadata and other custom fields
            ...(processedNotebook.metadata.documentStructure && {
                documentStructure: processedNotebook.metadata.documentStructure
            }),
            ...(processedNotebook.metadata.wordCount && {
                wordCount: processedNotebook.metadata.wordCount
            }),
            ...(processedNotebook.metadata.mammothMessages && {
                mammothMessages: processedNotebook.metadata.mammothMessages
            }),
            // Preserve DOCX round-trip structure
            ...(processedNotebook.metadata?.docxDocument && {
                docxDocument: processedNotebook.metadata.docxDocument
            }),
            ...(processedNotebook.metadata?.originalHash && {
                originalHash: processedNotebook.metadata.originalHash
            }),
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

        // No conflicts or user confirmed, proceed with import
        await this.handleWriteNotebooksForced(message, token, webviewPanel);
    }

    private async handleWriteNotebooksForced(
        message: WriteNotebooksMessage,
        token: vscode.CancellationToken,
        webviewPanel: vscode.WebviewPanel
    ): Promise<void> {
        // Save original files if provided in metadata
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            for (const pair of message.notebookPairs) {
                if (pair.source.metadata?.originalFileData) {
                    // Save the original file in attachments
                    const originalFileName = pair.source.metadata.originalFileName || 'document.docx';
                    const originalsDir = vscode.Uri.joinPath(
                        workspaceFolder.uri,
                        '.project',
                        'attachments',
                        'originals'
                    );
                    await vscode.workspace.fs.createDirectory(originalsDir);

                    const originalFileUri = vscode.Uri.joinPath(originalsDir, originalFileName);
                    const fileData = pair.source.metadata.originalFileData;

                    // Convert ArrayBuffer to Uint8Array if needed
                    const buffer = fileData instanceof ArrayBuffer
                        ? new Uint8Array(fileData)
                        : Buffer.from(fileData);

                    await vscode.workspace.fs.writeFile(originalFileUri, buffer);
                }
            }
        }

        // Convert ProcessedNotebooks to NotebookPreview format
        const sourceNotebooks = message.notebookPairs.map(pair =>
            this.convertToNotebookPreview(pair.source)
        );
        const codexNotebooks = message.notebookPairs.map(pair => {
            // For codex notebooks, remove the original file data to avoid duplication
            const codexPair = { ...pair.codex };
            if (codexPair.metadata?.originalFileData) {
                codexPair.metadata = { ...codexPair.metadata };
                delete codexPair.metadata.originalFileData;
            }
            return this.convertToNotebookPreview(codexPair);
        });

        // Create the notebook pairs
        const createdFiles = await createNoteBookPair({
            token,
            sourceNotebooks,
            codexNotebooks,
        });

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
        token: vscode.CancellationToken,
        webviewPanel: vscode.WebviewPanel
    ): Promise<void> {
        // Reuse conflict checks from handleWriteNotebooks
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

        // 1) Convert to NotebookPreview and write notebooks
        const sourceNotebooks = message.notebookPairs.map(pair => this.convertToNotebookPreview(pair.source));
        const codexNotebooks = message.notebookPairs.map(pair => this.convertToNotebookPreview(pair.codex));

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
                        const docSegment = (cellId || "").split(" ")[0] || "UNKNOWN";
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
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                return;
            }

            const localizedUri = vscode.Uri.joinPath(workspaceFolder.uri, "localized-books.json");
            let localizedBooks: Array<{ abbr: string; name: string; ord?: string; testament?: string; }> = [];

            // Check if localized-books.json exists and read it
            try {
                await vscode.workspace.fs.stat(localizedUri);
            } catch (statError: any) {
                // File doesn't exist, nothing to migrate
                return;
            }

            try {
                const fileContent = await vscode.workspace.fs.readFile(localizedUri);
                const content = new TextDecoder().decode(fileContent);
                localizedBooks = JSON.parse(content);

                if (!Array.isArray(localizedBooks)) {
                    console.warn("localized-books.json is not an array, skipping migration");
                    return;
                }
            } catch (err: any) {
                // File doesn't exist or is invalid, nothing to migrate
                if (err.code !== "FileNotFound") {
                    console.warn("Failed to read localized-books.json:", err);
                }
                return;
            }

            if (localizedBooks.length === 0) {
                return;
            }

            const serializer = new CodexContentSerializer();
            let migratedCount = 0;

            // Use provided URIs or search for all codex files
            let allCodexUris: vscode.Uri[] = [];
            if (codexUris && codexUris.length > 0) {
                allCodexUris = codexUris;
            } else {
                const rootUri = workspaceFolder.uri;
                const codexPattern = new vscode.RelativePattern(rootUri.fsPath, "files/target/**/*.codex");
                allCodexUris = await vscode.workspace.findFiles(codexPattern);
            }

            // Process each book in localized-books.json
            for (const book of localizedBooks) {
                if (!book.abbr || !book.name) {
                    console.warn(`Skipping book entry with missing abbr or name:`, book);
                    continue;
                }

                // Find matching codex files by book abbreviation
                const matchingUris = allCodexUris.filter(uri => {
                    const fileNameAbbr = path.basename(uri.fsPath, ".codex");
                    return fileNameAbbr === book.abbr;
                });

                // Update each matching codex file
                for (const uri of matchingUris) {
                    try {
                        const content = await vscode.workspace.fs.readFile(uri);
                        const notebookData = await serializer.deserializeNotebook(
                            content,
                            new vscode.CancellationTokenSource().token
                        );

                        // Ensure metadata exists, then update it with fileDisplayName
                        const existingMetadata = notebookData.metadata || {};
                        notebookData.metadata = {
                            ...existingMetadata,
                            fileDisplayName: book.name.trim(),
                        };

                        // Serialize and save the updated notebook
                        const updatedContent = await serializer.serializeNotebook(
                            notebookData,
                            new vscode.CancellationTokenSource().token
                        );

                        await vscode.workspace.fs.writeFile(uri, updatedContent);
                        migratedCount++;
                    } catch (error) {
                        console.error(`Error migrating fileDisplayName for ${uri.fsPath}:`, error);
                        // Continue with other files even if one fails
                    }
                }
            }

            if (migratedCount > 0) {
                console.log(`Migrated ${migratedCount} book display name(s) from localized-books.json to codex metadata`);
            }
        } catch (err) {
            console.error("Failed to migrate localized-books.json:", err);
        }
    }

    /**
     * Removes the workspace-level localized-books.json file if present.
     * This ensures that newly uploaded sources don't inherit stale overrides.
     */
    private async removeLocalizedBooksJsonIfPresent(): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                return;
            }
            const localizedUri = vscode.Uri.joinPath(workspaceFolder.uri, "localized-books.json");
            try {
                // If the file exists, delete it (no trash, non-recursive)
                await vscode.workspace.fs.stat(localizedUri);
                await vscode.workspace.fs.delete(localizedUri, { recursive: false, useTrash: false });
                console.log("Removed localized-books.json after source upload");
            } catch {
                // File does not exist; nothing to remove
            }
        } catch (err) {
            console.warn("Failed to remove localized-books.json:", err);
        }
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
                    const paratextCell = {
                        kind: 1, // vscode.NotebookCellKind.Code
                        languageId: "html",
                        value: alignedCell.importedContent.content,
                        metadata: {
                            type: CodexCellTypes.PARATEXT,
                            id: paratextId,
                            data: {
                                startTime: alignedCell.importedContent.startTime,
                                endTime: alignedCell.importedContent.endTime,
                            },
                        },
                    };
                    processedCells.set(paratextId, paratextCell);
                    paratextCount++;
                } else if (alignedCell.notebookCell) {
                    const targetId = alignedCell.importedContent.id;
                    const existingCell = existingCellsMap.get(targetId);

                    if (existingCell && existingCell.value && existingCell.value.trim() !== "") {
                        // Keep existing content if cell already has content
                        processedCells.set(targetId, existingCell);
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
                if (cellId && !usedExistingCellIds.has(cellId)) {
                    console.warn(`Cell ${cellId} was not in aligned content, appending at end`);
                    newCells.push(cell);
                }
            }

            // Update the notebook
            const updatedNotebook = {
                ...existingNotebook,
                cells: newCells,
            };

            // Write the updated notebook back to disk
            await vscode.workspace.fs.writeFile(
                targetFileUri,
                Buffer.from(JSON.stringify(updatedNotebook, null, 2))
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
            let sourceExists = false;
            let targetExists = false;
            let hasTranslations = false;

            try {
                await vscode.workspace.fs.stat(sourceUri);
                sourceExists = true;
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
    private async confirmOverwriteWithTruncation(items: Array<{ name: string; sourceExists: boolean; targetExists: boolean; hasTranslations: boolean; }>): Promise<boolean> {
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
            csp: `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-\${nonce}'; img-src data: https:; connect-src https: http:; media-src blob: data:;`,
            inlineStyles: "#root { height: 100vh; width: 100vw; overflow-y: auto; }",
            customScript: "window.vscodeApi = acquireVsCodeApi();"
        });
    }
}

// Helper to present a concise overwrite confirmation with truncation and an Output Channel for details
async function confirmOverwriteWithDetails(
    items: Array<{ name: string; sourceExists: boolean; targetExists: boolean; hasTranslations: boolean; }>,
    options?: { maxItems?: number; }
): Promise<boolean> {
    const maxItems = options?.maxItems ?? 15;

    const makeLine = (c: { name: string; sourceExists: boolean; targetExists: boolean; hasTranslations: boolean; }) => {
        const parts: string[] = [];
        if (c.sourceExists) parts.push("source file");
        if (c.targetExists) parts.push("target file");
        if (c.hasTranslations) parts.push("with translations");
        return `• ${c.name} (${parts.join(", ")})`;
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

