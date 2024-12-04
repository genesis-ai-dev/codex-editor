import { API, GitExtension } from "./../providers/scm/git.d";
import * as vscode from "vscode";
import * as path from "path";
import { CodexContentSerializer } from "../serializer";
import { generateUniqueId, clearIdCache } from "./idGenerator";
import { NavigationCell } from "./codexNotebookUtils";
import { API as GitAPI, Repository, Status } from "../providers/scm/git.d";
import {
    deserializeDictionaryEntries,
    serializeDictionaryEntries,
    repairDictionaryContent,
} from "./dictionaryUtils/common";
import { readDictionaryClient, saveDictionaryClient } from "./dictionaryUtils/client";
import { CustomNotebookMetadata } from "../../types";
import { getWorkSpaceUri } from "./index";

const DEBUG_MODE = false; // Set to true to enable debug logging

function debugLog(...args: any[]): void {
    if (DEBUG_MODE) {
        console.log("[NotebookMetadataManager]", ...args);
    }
}

async function getGitAPI(): Promise<GitAPI | undefined> {
    const gitExtension = vscode.extensions.getExtension<GitExtension>("vscode.git");
    if (gitExtension && gitExtension.isActive) {
        return gitExtension.exports.getAPI(1);
    } else {
        await gitExtension?.activate();
        return gitExtension?.exports.getAPI(1);
    }
}

interface MetadataValidationResult {
    isValid: boolean;
    errors: string[];
}

export class NotebookMetadataManager {
    private static instance: NotebookMetadataManager;
    private metadataMap: Map<string, CustomNotebookMetadata> = new Map();
    private storageUri: vscode.Uri;
    private _onDidChangeMetadata = new vscode.EventEmitter<void>();
    public readonly onDidChangeMetadata = this._onDidChangeMetadata.event;
    private isLoading = false;
    private storage: vscode.Memento;
    private metadataCache: Map<string, CustomNotebookMetadata> = new Map();
    private lastLoadTime = 0;
    private readonly CACHE_TTL = 5000; // 5 seconds

    private constructor(context: vscode.ExtensionContext, storageUri?: vscode.Uri) {
        this.storage = context.workspaceState;
        
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

    public static getInstance(context: vscode.ExtensionContext, storageUri?: vscode.Uri): NotebookMetadataManager {
        if (!NotebookMetadataManager.instance) {
            NotebookMetadataManager.instance = new NotebookMetadataManager(context, storageUri);
        }
        return NotebookMetadataManager.instance;
    }

    async initialize(): Promise<void> {
        const metadataArray = this.storage.get<CustomNotebookMetadata[]>('notebookMetadata', []);
        this.metadataMap = new Map(metadataArray.map(m => [m.id, m]));
    }

    private validateMetadata(metadata: CustomNotebookMetadata): MetadataValidationResult {
        const errors: string[] = [];
        
        if (!metadata.id) {
            errors.push("Metadata must have an ID");
        }
        
        if (metadata.sourceFsPath && !metadata.sourceFsPath.endsWith('.source')) {
            errors.push("Source path must end with .source extension");
        }
        
        if (metadata.codexFsPath && !metadata.codexFsPath.endsWith('.codex')) {
            errors.push("Codex path must end with .codex extension");
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }

    async addOrUpdateMetadata(metadata: CustomNotebookMetadata): Promise<void> {
        const validation = this.validateMetadata(metadata);
        if (!validation.isValid) {
            throw new Error(`Invalid metadata: ${validation.errors.join(', ')}`);
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
        await this.storage.update('notebookMetadata', metadataArray);
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
            gitStatus: "uninitialized",
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

            const gitAvailable = await this.isGitAvailable();

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

                    if (gitAvailable) {
                        const newGitStatus = await this.getGitStatusForFile(file);
                        if (metadata.gitStatus !== newGitStatus) {
                            metadata.gitStatus = newGitStatus;
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
        return (
            path.includes(".codex-temp") ||
            path.includes("Untitled") ||
            path.includes("temp") ||
            path.includes("tmp")
        );
    }

    private async getGitStatusForFile(
        fileUri: vscode.Uri
    ): Promise<CustomNotebookMetadata["gitStatus"]> {
        try {
            const gitApi = await getGitAPI();
            if (!gitApi || gitApi.repositories.length === 0) {
                return "uninitialized";
            }
            const repository = gitApi.repositories[0];

            if (!repository || !repository.state.HEAD) {
                return "uninitialized";
            }

            const workingChanges = repository.state.workingTreeChanges;
            const indexChanges = repository.state.indexChanges;
            const mergeChanges = repository.state.mergeChanges;

            const inMerge = mergeChanges.some((change) => change.uri.fsPath === fileUri.fsPath);
            if (inMerge) {
                return "conflict";
            }

            const inIndex = indexChanges.some((change) => change.uri.fsPath === fileUri.fsPath);
            if (inIndex) {
                return "modified";
            }

            const inWorking = workingChanges.some((change) => change.uri.fsPath === fileUri.fsPath);
            if (inWorking) {
                return "modified";
            }

            const isUntracked = workingChanges.some(
                (change) =>
                    change.status === Status.UNTRACKED && change.uri.fsPath === fileUri.fsPath
            );
            if (isUntracked) {
                return "untracked";
            }

            return "committed";
        } catch (error) {
            console.error("Error getting Git status:", error);
            return "uninitialized";
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

    private async isGitAvailable(): Promise<boolean> {
        try {
            const gitApi = await getGitAPI();
            return !!gitApi;
        } catch {
            return false;
        }
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
}
