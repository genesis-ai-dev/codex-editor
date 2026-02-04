import * as vscode from "vscode";
import * as path from "path";
import { CodexContentSerializer } from "../serializer";
import { generateUniqueId, clearIdCache } from "./idUtils";
import { NavigationCell, getCorrespondingSourceUri, getCorrespondingCodexUri } from "./codexNotebookUtils";
import { CustomNotebookCellData, CustomNotebookMetadata } from "../../types";
import { getWorkSpaceUri } from "./index";
import { getCorpusMarkerForBook } from "../../sharedUtils/corpusUtils";
import { extractUsfmCodeFromFilename, getBookDisplayName } from "./bookNameUtils";

const DEBUG_MODE = false; // Set to true to enable debug logging

function debugLog(...args: any[]): void {
    if (DEBUG_MODE) {
        console.log("[NotebookMetadataManager]", ...args);
    }
}

interface MetadataValidationResult {
    isValid: boolean;
    errors: string[];
}

export function getNotebookMetadataManager(): NotebookMetadataManager {
    return NotebookMetadataManager.getManager();
}

export class NotebookMetadataManager {
    protected static instance: NotebookMetadataManager | undefined;
    private metadataMap: Map<string, CustomNotebookMetadata> = new Map();
    private storageUri: vscode.Uri;
    private _onDidChangeMetadata = new vscode.EventEmitter<void>();
    public readonly onDidChangeMetadata = this._onDidChangeMetadata.event;
    private isLoading = false;
    private storage: vscode.Memento;
    private metadataCache: Map<string, CustomNotebookMetadata> = new Map();
    private lastLoadTime = 0;
    private readonly CACHE_TTL = 5000; // 5 seconds
    private context: vscode.ExtensionContext;

    private constructor(context: vscode.ExtensionContext, storageUri?: vscode.Uri) {
        this.storage = context.workspaceState;
        this.context = context;

        if (storageUri) {
            this.storageUri = storageUri;
        } else {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (workspaceFolder) {
                this.storageUri = vscode.Uri.joinPath(
                    workspaceFolder.uri,
                    "notebook_metadata.json"
                );
            } else {
                // Use a temporary directory for testing if no workspace is available
                this.storageUri = vscode.Uri.file(path.join(__dirname, "test-metadata.json"));
            }
        }
    }

    public static getInstance(
        context: vscode.ExtensionContext,
        storageUri?: vscode.Uri
    ): NotebookMetadataManager {
        if (!NotebookMetadataManager.instance) {
            if (!context) {
                throw new Error(
                    "NotebookMetadataManager must be initialized with a VS Code extension context"
                );
            }
            NotebookMetadataManager.instance = new NotebookMetadataManager(context, storageUri);
        }
        return NotebookMetadataManager.instance;
    }

    async initialize(): Promise<void> {
        const metadataArray = this.storage.get<CustomNotebookMetadata[]>("notebookMetadata", []);
        this.metadataMap = new Map(metadataArray.map((m) => [m.id, m]));
    }

    private validateMetadata(metadata: CustomNotebookMetadata): MetadataValidationResult {
        const errors: string[] = [];

        if (!metadata.id) {
            errors.push("Metadata must have an ID");
        }

        if (metadata.sourceFsPath && !metadata.sourceFsPath.endsWith(".source")) {
            errors.push("Source path must end with .source extension");
        }

        if (metadata.codexFsPath && !metadata.codexFsPath.endsWith(".codex")) {
            errors.push("Codex path must end with .codex extension");
        }

        return {
            isValid: errors.length === 0,
            errors,
        };
    }

    async addOrUpdateMetadata(metadata: CustomNotebookMetadata): Promise<void> {
        const validation = this.validateMetadata(metadata);
        if (!validation.isValid) {
            throw new Error(`Invalid metadata: ${validation.errors.join(", ")}`);
        }

        this.metadataMap.set(metadata.id, metadata);
        await this.persistMetadata();
        this._onDidChangeMetadata.fire();
    }

    private async ensureMetadataLoaded(): Promise<void> {
        const now = Date.now();
        if (now - this.lastLoadTime > this.CACHE_TTL) {
            await this.loadMetadata();
            this.lastLoadTime = now;
        }
    }

    public async getMetadata(id: string): Promise<CustomNotebookMetadata | undefined> {
        await this.ensureMetadataLoaded();
        return this.metadataMap.get(id);
    }

    private async persistMetadata(): Promise<void> {
        const metadataArray = Array.from(this.metadataMap.values());
        await this.storage.update("notebookMetadata", metadataArray);
    }

    public getAllMetadata(): CustomNotebookMetadata[] {
        return Array.from(this.metadataMap.values());
    }

    private getDefaultMetadata(id: string, originalName: string): CustomNotebookMetadata {
        return {
            id,
            originalName,
            sourceFsPath: undefined,
            codexFsPath: undefined,
            navigation: [] as NavigationCell[],
            videoUrl: "",
            sourceCreatedAt: "",
            codexLastModified: "",
            corpusMarker: "",
        };
    }

    public async loadMetadata(): Promise<void> {
        if (this.isLoading) {
            debugLog("Already loading metadata, skipping...");
            return;
        }

        try {
            this.isLoading = true;
            debugLog("Loading metadata...");
            clearIdCache();

            // Store old metadata for comparison
            const oldMetadata = new Map(this.metadataMap);
            this.metadataMap.clear();

            // Only look in the proper directories
            const workspaceUri = getWorkSpaceUri();
            if (!workspaceUri) {
                throw new Error("No workspace folder found");
            }

            // Define proper paths for source and codex files
            const sourceDir = vscode.Uri.joinPath(workspaceUri, ".project", "sourceTexts");
            const codexDir = vscode.Uri.joinPath(workspaceUri, "files", "target");

            // Use specific patterns to find files
            const sourceFiles = await vscode.workspace.findFiles(
                new vscode.RelativePattern(sourceDir, "*.source")
            );
            const codexFiles = await vscode.workspace.findFiles(
                new vscode.RelativePattern(codexDir, "*.codex")
            );

            debugLog(
                `Found ${sourceFiles.length} source files and ${codexFiles.length} codex files`
            );
            const serializer = new CodexContentSerializer();

            let hasChanges = false;

            for (const file of [...sourceFiles, ...codexFiles]) {
                debugLog("Processing file:", file.fsPath);

                // Skip any temporary files
                if (this.isTemporaryPath(file.fsPath)) {
                    debugLog("Skipping temp file:", file.fsPath);
                    continue;
                }

                // Skip files not in the proper directories
                if (
                    !file.fsPath.includes(sourceDir.fsPath) &&
                    !file.fsPath.includes(codexDir.fsPath)
                ) {
                    debugLog("Skipping file outside proper directories:", file.fsPath);
                    continue;
                }

                try {
                    const content = await vscode.workspace.fs.readFile(file);
                    let notebookData;
                    try {
                        notebookData = await serializer.deserializeNotebook(
                            content,
                            new vscode.CancellationTokenSource().token
                        );
                    } catch (error) {
                        debugLog("Error deserializing notebook, trying to parse as JSON:", error);
                        try {
                            notebookData = JSON.parse(new TextDecoder().decode(content));
                        } catch (jsonError) {
                            debugLog("Error parsing file as JSON:", jsonError);
                            continue;
                        }
                    }

                    const originalName = path.basename(file.path, path.extname(file.path));
                    const id = originalName;

                    let metadata = this.metadataMap.get(id);
                    if (!metadata) {
                        metadata = this.getDefaultMetadata(id, originalName);
                        hasChanges = true;
                    }

                    const fileStat = await vscode.workspace.fs.stat(file);

                    if (file.path.endsWith(".source")) {
                        if (metadata.sourceFsPath !== file.fsPath) {
                            metadata.sourceFsPath = file.fsPath;
                            metadata.sourceCreatedAt = new Date(fileStat.ctime).toISOString();
                            hasChanges = true;
                        }
                    } else if (file.path.endsWith(".codex")) {
                        if (metadata.codexFsPath !== file.fsPath) {
                            metadata.codexFsPath = file.fsPath;
                            metadata.codexLastModified = new Date(fileStat.mtime).toISOString();
                            hasChanges = true;
                        }
                    }

                    if (notebookData.metadata) {
                        const newMetadata = { ...metadata, ...notebookData.metadata };
                        if (JSON.stringify(metadata) !== JSON.stringify(newMetadata)) {
                            metadata = newMetadata;
                            hasChanges = true;
                        }
                    }

                    // Fix ebibleCorpus markers by converting them to NT or OT based on book code
                    if (metadata?.corpusMarker === "ebibleCorpus" && metadata?.originalName) {
                        const correctCorpusMarker = getCorpusMarkerForBook(metadata.originalName);
                        if (correctCorpusMarker && correctCorpusMarker !== metadata.corpusMarker) {
                            debugLog(
                                `Fixing corpusMarker for ${metadata.originalName}: ${metadata.corpusMarker} -> ${correctCorpusMarker}`
                            );
                            metadata.corpusMarker = correctCorpusMarker;
                            hasChanges = true;

                            // Update the notebook file with the corrected metadata
                            try {
                                notebookData.metadata = {
                                    ...notebookData.metadata,
                                    corpusMarker: correctCorpusMarker,
                                };

                                // Convert CodexNotebookAsJSONData to vscode.NotebookData format for serialization
                                const notebookDataForSerialization: vscode.NotebookData = {
                                    cells: notebookData.cells.map((cell: CustomNotebookCellData) => {
                                        const cellData = new vscode.NotebookCellData(
                                            cell.kind,
                                            cell.value,
                                            cell.languageId || "plaintext"
                                        );
                                        cellData.metadata = cell.metadata || {};
                                        return cellData;
                                    }),
                                    metadata: notebookData.metadata,
                                };

                                const serialized = await serializer.serializeNotebook(
                                    notebookDataForSerialization,
                                    new vscode.CancellationTokenSource().token
                                );
                                await vscode.workspace.fs.writeFile(file, serialized);
                                debugLog(`Updated notebook file ${file.fsPath} with corrected corpusMarker`);
                            } catch (error) {
                                debugLog(`Error updating notebook file ${file.fsPath}:`, error);
                                // Continue even if file update fails - metadata is still updated in memory
                            }
                        }
                    }

                    // Fix corpusMarker if it's a Bible book code (like "1CO", "GEN") by converting to OT/NT
                    // NOTE: This is a temporary fix to convert corpus markers to OT/NT. We should remove this 
                    // after projects have been migrated.
                    // Skip this conversion for Macula corpus markers ("Hebrew Bible", "Greek Bible") and other non-book-code markers
                    if (metadata?.corpusMarker && metadata.corpusMarker !== "OT" && metadata.corpusMarker !== "NT") {
                        // Don't convert corpus markers that are clearly not book codes (e.g., "Hebrew Bible", "Greek Bible")
                        const isMaculaCorpusMarker = metadata.corpusMarker === "Hebrew Bible" || metadata.corpusMarker === "Greek Bible";
                        const isLikelyCorpusMarker = metadata.corpusMarker.length > 3 || metadata.corpusMarker.includes(" ") || metadata.corpusMarker.includes("Bible");

                        if (!isMaculaCorpusMarker && !isLikelyCorpusMarker) {
                            // Only try to convert if it looks like a book code (3 letters, no spaces)
                            const correctCorpusMarker = getCorpusMarkerForBook(metadata.corpusMarker);
                            if (correctCorpusMarker && correctCorpusMarker !== metadata.corpusMarker) {
                                debugLog(
                                    `Converting Bible book corpusMarker for ${metadata.id}: ${metadata.corpusMarker} -> ${correctCorpusMarker}`
                                );
                                metadata.corpusMarker = correctCorpusMarker;
                                hasChanges = true;

                                // Update the notebook file with the corrected metadata
                                await this.updateCorpusMarkerInFile(file, notebookData, correctCorpusMarker);
                            }
                        }
                    }

                    // Update the current notebook file with the corpusMarker (if needed) and sync to corresponding file
                    if (metadata?.corpusMarker) {
                        // Sync corpusMarker to the corresponding file (source <-> codex)
                        let correspondingUri: vscode.Uri | null = null;
                        if (file.path.endsWith(".source")) {
                            correspondingUri = getCorrespondingCodexUri(file);
                        } else if (file.path.endsWith(".codex")) {
                            correspondingUri = getCorrespondingSourceUri(file);
                        }

                        if (correspondingUri) {
                            try {
                                // Check if corresponding file exists before trying to update it
                                await vscode.workspace.fs.stat(correspondingUri);

                                // Read the corresponding file
                                const correspondingContent = await vscode.workspace.fs.readFile(correspondingUri);
                                let correspondingNotebookData;
                                try {
                                    correspondingNotebookData = await serializer.deserializeNotebook(
                                        correspondingContent,
                                        new vscode.CancellationTokenSource().token
                                    );
                                } catch (error) {
                                    debugLog("Error deserializing corresponding notebook, trying to parse as JSON:", error);
                                    try {
                                        correspondingNotebookData = JSON.parse(new TextDecoder().decode(correspondingContent));
                                    } catch (jsonError) {
                                        debugLog("Error parsing corresponding file as JSON:", jsonError);
                                        throw jsonError;
                                    }
                                }

                                const correspondingMetadata = (correspondingNotebookData.metadata as CustomNotebookMetadata) || {};
                                const existingCorpusMarker = correspondingMetadata.corpusMarker;

                                // Only update if the corpusMarker is different
                                if (existingCorpusMarker !== metadata.corpusMarker) {
                                    await this.updateCorpusMarkerInFile(correspondingUri, correspondingNotebookData, metadata.corpusMarker);
                                    debugLog(`Synced corpusMarker "${metadata.corpusMarker}" to corresponding file ${correspondingUri.fsPath}`);
                                }
                            } catch (error) {
                                // Corresponding file doesn't exist or can't be accessed, skip it
                                debugLog(`Corresponding file ${correspondingUri.fsPath} not found or inaccessible, skipping corpusMarker sync`);
                            }
                        }
                    }

                    // Ensure fileDisplayName exists in metadata
                    // Check if fileDisplayName is missing or empty in the notebook file metadata
                    // If it already exists in notebookData.metadata, preserve it and don't overwrite
                    // NOTE: This is a migration step to ensure fileDisplayName is set for all files.
                    const displayName = await this.ensureFileDisplayName(file, metadata, notebookData);
                    if (displayName) {
                        const existingFileDisplayName = (notebookData.metadata as CustomNotebookMetadata)?.fileDisplayName || metadata?.fileDisplayName;
                        const needsFileDisplayName = !existingFileDisplayName || typeof existingFileDisplayName !== "string" || existingFileDisplayName.trim() === "";

                        // Check if the display name was cleaned (extension stripped)
                        const displayNameWasCleaned = !needsFileDisplayName && displayName !== existingFileDisplayName.trim();

                        if (metadata) {
                            if (needsFileDisplayName) {
                                debugLog(
                                    `Adding fileDisplayName for ${metadata.id}: ${displayName}`
                                );
                                hasChanges = true;
                            } else if (displayNameWasCleaned) {
                                debugLog(
                                    `Cleaned fileDisplayName for ${metadata.id}: "${existingFileDisplayName}" -> "${displayName}"`
                                );
                                hasChanges = true;
                            }
                            metadata.fileDisplayName = displayName;
                        }
                    }

                    // Update the current notebook file with the fileDisplayName (if needed)
                    if (metadata?.fileDisplayName) {
                        await this.updateFileDisplayNameInFile(file, metadata.fileDisplayName);

                        // Also update the corresponding file (source <-> codex) with the fileDisplayName
                        let correspondingUri: vscode.Uri | null = null;
                        if (file.path.endsWith(".source")) {
                            correspondingUri = getCorrespondingCodexUri(file);
                        } else if (file.path.endsWith(".codex")) {
                            correspondingUri = getCorrespondingSourceUri(file);
                        }

                        if (correspondingUri) {
                            try {
                                // Check if corresponding file exists before trying to update it
                                await vscode.workspace.fs.stat(correspondingUri);
                                await this.updateFileDisplayNameInFile(correspondingUri, metadata.fileDisplayName);
                            } catch (error) {
                                // Corresponding file doesn't exist or can't be accessed, skip it
                                debugLog(`Corresponding file ${correspondingUri.fsPath} not found or inaccessible, skipping`);
                            }
                        }
                    }

                    if (metadata) {
                        this.metadataMap.set(id, metadata);
                    }
                } catch (error) {
                    debugLog("Error processing file:", file.fsPath, error);
                }
            }

            // Only fire the change event if there were actual changes
            if (hasChanges) {
                await this.persistMetadata();
                this._onDidChangeMetadata.fire();
            }

            debugLog("Metadata loading complete. Total entries:", this.metadataMap.size);
        } finally {
            this.isLoading = false;
        }
    }

    private isTemporaryPath(path: string): boolean {
        // Check for actual temporary file patterns, not just any path containing "tmp" or "temp"
        // This avoids false positives like /tmp/test-workspace which is a legitimate workspace
        // Patterns to match:
        // 1. .codex-temp files (specific extension temp files)
        // 2. Untitled files (VS Code's untitled files)
        // 3. .tmp-{timestamp} files (atomic write temp files: .tmp-1234567890-abc)
        // 4. Files in extension storage temp directories (but exclude workspace paths)
        const isCodexTemp = path.includes(".codex-temp");
        const isUntitled = path.includes("Untitled");
        const isAtomicTemp = /\.tmp-\d+/.test(path);
        // Check for temp files in extension storage, but exclude if it's in a workspace directory structure
        const isExtensionTemp = path.includes("/temp/") &&
            !path.includes("/.project/") &&
            !path.includes("/files/target/");

        return isCodexTemp || isUntitled || isAtomicTemp || isExtensionTemp;
    }

    /**
     * Updates a notebook file's fileDisplayName metadata.
     * @param fileUri - The URI of the file to update
     * @param displayNameToSet - The display name to set
     */
    private async updateFileDisplayNameInFile(fileUri: vscode.Uri, displayNameToSet: string): Promise<void> {
        try {
            const serializer = new CodexContentSerializer();
            const fileContent = await vscode.workspace.fs.readFile(fileUri);
            let fileNotebookData;
            try {
                fileNotebookData = await serializer.deserializeNotebook(
                    fileContent,
                    new vscode.CancellationTokenSource().token
                );
            } catch (error) {
                debugLog("Error deserializing notebook, trying to parse as JSON:", error);
                try {
                    fileNotebookData = JSON.parse(new TextDecoder().decode(fileContent));
                } catch (jsonError) {
                    debugLog("Error parsing file as JSON:", jsonError);
                    return;
                }
            }

            const existingDisplayName = (fileNotebookData.metadata as CustomNotebookMetadata)?.fileDisplayName;
            const needsUpdate = !existingDisplayName || typeof existingDisplayName !== "string" || existingDisplayName.trim() === "" || existingDisplayName.trim() !== displayNameToSet;

            if (needsUpdate) {
                fileNotebookData.metadata = {
                    ...fileNotebookData.metadata,
                    fileDisplayName: displayNameToSet,
                };

                // Convert CodexNotebookAsJSONData to vscode.NotebookData format for serialization
                const notebookDataForSerialization: vscode.NotebookData = {
                    cells: fileNotebookData.cells.map((cell: CustomNotebookCellData) => {
                        const cellData = new vscode.NotebookCellData(
                            cell.kind,
                            cell.value,
                            cell.languageId || "plaintext"
                        );
                        cellData.metadata = cell.metadata || {};
                        return cellData;
                    }),
                    metadata: fileNotebookData.metadata,
                };

                const serialized = await serializer.serializeNotebook(
                    notebookDataForSerialization,
                    new vscode.CancellationTokenSource().token
                );
                await vscode.workspace.fs.writeFile(fileUri, serialized);
                debugLog(`Updated notebook file ${fileUri.fsPath} with fileDisplayName`);
            }
        } catch (error) {
            debugLog(`Error updating notebook file ${fileUri.fsPath} with fileDisplayName:`, error);
            // Continue even if file update fails - metadata is still updated in memory
        }
    }

    /**
     * Updates a notebook file's corpusMarker metadata.
     * @param fileUri - The URI of the file to update
     * @param notebookData - The notebook data object
     * @param corpusMarker - The corpus marker to set
     */
    private async updateCorpusMarkerInFile(fileUri: vscode.Uri, notebookData: any, corpusMarker: string): Promise<void> {
        try {
            const serializer = new CodexContentSerializer();
            notebookData.metadata = {
                ...notebookData.metadata,
                corpusMarker: corpusMarker,
            };

            // Convert CodexNotebookAsJSONData to vscode.NotebookData format for serialization
            const notebookDataForSerialization: vscode.NotebookData = {
                cells: notebookData.cells.map((cell: CustomNotebookCellData) => {
                    const cellData = new vscode.NotebookCellData(
                        cell.kind,
                        cell.value,
                        cell.languageId || "plaintext"
                    );
                    cellData.metadata = cell.metadata || {};
                    return cellData;
                }),
                metadata: notebookData.metadata,
            };

            const serialized = await serializer.serializeNotebook(
                notebookDataForSerialization,
                new vscode.CancellationTokenSource().token
            );
            await vscode.workspace.fs.writeFile(fileUri, serialized);
            debugLog(`Updated notebook file ${fileUri.fsPath} with corrected corpusMarker`);
        } catch (error) {
            debugLog(`Error updating notebook file ${fileUri.fsPath}:`, error);
            // Continue even if file update fails - metadata is still updated in memory
        }
    }

    /**
     * Strips file extensions from a display name if detected.
     * Common extensions include: .vtt, .mp4, .mp3, .wav, .srt, .codex, .source, etc.
     * @param displayName - The display name to clean
     * @returns The display name without file extension
     */
    private stripFileExtensionFromDisplayName(displayName: string): string {
        const trimmed = displayName.trim();
        if (!trimmed) {
            return trimmed;
        }

        // Check if the display name has a file extension
        const ext = path.extname(trimmed);
        if (ext && ext.length > 0) {
            // Strip the extension using path.basename
            return path.basename(trimmed, ext);
        }

        return trimmed;
    }

    /**
     * Derives and ensures fileDisplayName exists in metadata.
     * @param file - The file URI
     * @param metadata - The metadata object
     * @param notebookData - The notebook data object
     * @returns The display name if it was derived, or the existing display name
     */
    private async ensureFileDisplayName(
        file: vscode.Uri,
        metadata: CustomNotebookMetadata | undefined,
        notebookData: any
    ): Promise<string | undefined> {
        const existingFileDisplayName = (notebookData.metadata as CustomNotebookMetadata)?.fileDisplayName || metadata?.fileDisplayName;
        const needsFileDisplayName = !existingFileDisplayName || typeof existingFileDisplayName !== "string" || existingFileDisplayName.trim() === "";

        if (needsFileDisplayName) {
            // First try to use originalName from metadata if available
            const originalName = metadata?.originalName || (notebookData.metadata as CustomNotebookMetadata)?.originalName;
            let displayName: string;

            if (originalName && typeof originalName === "string" && originalName.trim() !== "") {
                // Remove file extension from originalName
                const cleanedOriginalName = path.basename(originalName.trim(), path.extname(originalName.trim()));

                // Check if this is a Bible book (corpusMarker is NT or OT)
                const corpusMarker = metadata?.corpusMarker || (notebookData.metadata as CustomNotebookMetadata)?.corpusMarker;
                const isBibleBook = corpusMarker === "NT" || corpusMarker === "OT";

                if (isBibleBook) {
                    // Check if originalName looks like a USFM code (3-4 uppercase letters/numbers)
                    const usfmCode = extractUsfmCodeFromFilename(cleanedOriginalName);
                    if (usfmCode) {
                        // Convert USFM code to full Bible book name
                        displayName = await getBookDisplayName(usfmCode);
                    } else {
                        // Not a USFM code, use cleaned originalName as-is
                        displayName = cleanedOriginalName;
                    }
                } else {
                    // Not a Bible book, use cleaned originalName as-is
                    displayName = cleanedOriginalName;
                }
            } else {
                // Derive fileDisplayName from filename
                const fileName = path.basename(file.fsPath);
                const usfmCode = extractUsfmCodeFromFilename(fileName);

                if (usfmCode) {
                    // If USFM code found, use getBookDisplayName to get display name
                    displayName = await getBookDisplayName(usfmCode);
                } else {
                    // If not found, use filename (without extension) as display name
                    displayName = path.basename(file.fsPath, path.extname(file.fsPath));
                }
            }

            return displayName;
        } else {
            // Current file has fileDisplayName, but check if it contains a file extension and strip it
            const cleanedDisplayName = this.stripFileExtensionFromDisplayName(existingFileDisplayName);
            if (cleanedDisplayName !== existingFileDisplayName.trim()) {
                debugLog(`Stripped file extension from fileDisplayName: "${existingFileDisplayName}" -> "${cleanedDisplayName}"`);
            }
            return cleanedDisplayName;
        }
    }

    public getMetadataById(id: string): CustomNotebookMetadata | undefined {
        const metadata = this.metadataMap.get(id);
        debugLog("getMetadataById:", id, metadata ? "found" : "not found");
        return metadata;
    }

    public getMetadataByUri(uri: vscode.Uri): CustomNotebookMetadata {
        for (const metadata of this.metadataMap.values()) {
            if (metadata.sourceFsPath === uri.fsPath || metadata.codexFsPath === uri.fsPath) {
                debugLog("getMetadataByUri:", uri.fsPath, "found");
                return metadata;
            }
        }

        // If metadata is not found, create a new one
        const fileName = path.basename(uri.path);
        const baseName = path.parse(fileName).name;
        const id = this.generateNewId(baseName);
        const newMetadata = this.getDefaultMetadata(id, baseName);

        if (uri.path.endsWith(".source")) {
            newMetadata.sourceFsPath = uri.fsPath;
        } else if (uri.path.endsWith(".codex")) {
            newMetadata.codexFsPath = uri.fsPath;
        }

        this.metadataMap.set(id, newMetadata);
        debugLog("getMetadataByUri:", uri.fsPath, "created new metadata");
        return newMetadata;
    }

    public getMetadataBySourceFileName(sourceFileName: string): CustomNotebookMetadata | undefined {
        const baseName = sourceFileName.endsWith(".source")
            ? path.parse(sourceFileName).name
            : sourceFileName;
        for (const metadata of this.metadataMap.values()) {
            if (metadata.id === baseName) {
                return metadata;
            }
        }
        return undefined;
    }

    public generateNewId(baseName: string): string {
        const newId = generateUniqueId(baseName);
        debugLog("Generated new ID:", newId, "for base name:", baseName);
        return newId;
    }

    public async handleFileSystemEvent(
        uri: vscode.Uri,
        type: "create" | "change" | "delete"
    ): Promise<void> {
        if (type === "delete") {
            // Remove metadata for deleted files
            for (const [id, metadata] of this.metadataMap.entries()) {
                if (metadata.sourceFsPath === uri.fsPath || metadata.codexFsPath === uri.fsPath) {
                    this.metadataMap.delete(id);
                }
            }
        } else {
            // Update or create metadata for new/changed files
            await this.loadMetadata();
        }

        await this.persistMetadata();
        this._onDidChangeMetadata.fire();
    }

    // Add these methods to handle path conversions
    private toWorkspaceRelativePath(absolutePath: string): string {
        const workspaceUri = getWorkSpaceUri();
        if (!workspaceUri) {
            throw new Error("No workspace folder found");
        }
        return vscode.workspace.asRelativePath(absolutePath);
    }

    private toAbsolutePath(relativePath: string): string {
        const workspaceUri = getWorkSpaceUri();
        if (!workspaceUri) {
            throw new Error("No workspace folder found");
        }
        return vscode.Uri.joinPath(workspaceUri, relativePath).fsPath;
    }

    // Add this method for testing purposes
    public static resetInstance(): void {
        NotebookMetadataManager.instance = undefined;
    }

    public static getManager(): NotebookMetadataManager {
        if (!NotebookMetadataManager.instance) {
            throw new Error("NotebookMetadataManager must be initialized before use");
        }
        return NotebookMetadataManager.instance;
    }

    public getContext(): vscode.ExtensionContext {
        return this.context;
    }
}
