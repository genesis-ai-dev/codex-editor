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
    ensureCompleteEntry,
} from "./dictionaryUtils/common";
import { readDictionaryClient, saveDictionaryClient } from "./dictionaryUtils/client";
import { CustomNotebookMetadata } from "../../types";

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

export class NotebookMetadataManager {
    private static instance: NotebookMetadataManager;
    private metadataMap: Map<string, CustomNotebookMetadata> = new Map();

    private constructor() {}

    public static getInstance(): NotebookMetadataManager {
        if (!NotebookMetadataManager.instance) {
            NotebookMetadataManager.instance = new NotebookMetadataManager();
        }
        return NotebookMetadataManager.instance;
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
        debugLog("Loading metadata...");
        clearIdCache();
        this.metadataMap.clear();

        const sourceFiles = await vscode.workspace.findFiles("**/*.source");
        const codexFiles = await vscode.workspace.findFiles("**/*.codex");

        const allFiles = [...sourceFiles, ...codexFiles];
        const serializer = new CodexContentSerializer();

        for (const file of [...sourceFiles, ...codexFiles]) {
            debugLog("Processing file:", file.fsPath);
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
            // notebookData.metadata?.id || notebookData.id || this.generateNewId(originalName);

            let metadata = this.metadataMap.get(id);
            if (!metadata) {
                metadata = this.getDefaultMetadata(id, originalName);
                this.metadataMap.set(id, metadata);
                debugLog("Created new metadata entry:", id);
            }

            const fileStat = await vscode.workspace.fs.stat(file);

            if (file.path.endsWith(".source")) {
                metadata.sourceFsPath = file.fsPath;
                metadata.sourceCreatedAt = new Date(fileStat.ctime).toISOString();
                debugLog("Updated sourceUri for:", id);
            } else if (file.path.endsWith(".codex")) {
                metadata.codexFsPath = file.fsPath;
                metadata.codexLastModified = new Date(fileStat.mtime).toISOString();
                debugLog("Updated codexUri for:", id);
            }

            metadata.gitStatus = await this.getGitStatusForFile(file);

            // Merge any additional metadata from the file
            if (notebookData.metadata) {
                metadata = { ...metadata, ...notebookData.metadata };
            }

            metadata ? this.metadataMap.set(id, metadata) : null;
        }

        // Handle project.dictionary file
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            const workspaceUri = vscode.workspace.workspaceFolders[0].uri;
            const dictionaryUri = vscode.Uri.joinPath(workspaceUri, "files", "project.dictionary");
            const dictionaryMetadata = this.getMetadataByUri(dictionaryUri);
            await this.addOrUpdateMetadata(dictionaryMetadata);
        }

        debugLog("Metadata loading complete. Total entries:", this.metadataMap.size);
    }

    private async getGitStatusForFile(fileUri: vscode.Uri): Promise<CustomNotebookMetadata["gitStatus"]> {
        const gitApi = await getGitAPI();
        if (!gitApi || gitApi.repositories.length === 0) {
            return "uninitialized";
        }
        const repository = gitApi.repositories[0];

        if (!repository) {
            return "uninitialized";
        }

        if (!repository.state.HEAD) {
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
            (change) => change.status === Status.UNTRACKED && change.uri.fsPath === fileUri.fsPath
        );
        if (isUntracked) {
            return "untracked";
        }

        return "committed";
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

    public async addOrUpdateMetadata(metadata: CustomNotebookMetadata): Promise<void> {
        const existingMetadata = this.metadataMap.get(metadata.id);
        if (existingMetadata) {
            this.metadataMap.set(metadata.id, {
                ...this.getDefaultMetadata(metadata.id, metadata.originalName),
                ...existingMetadata,
                ...metadata,
            });
            debugLog("Updated metadata for:", metadata.id);
        } else {
            this.metadataMap.set(metadata.id, {
                ...this.getDefaultMetadata(metadata.id, metadata.originalName),
                ...metadata,
            });
            debugLog("Added new metadata for:", metadata.id);
        }

        // Update metadata in the .source file if it exists
        if (metadata.sourceFsPath) {
            await this.updateMetadataInFile(metadata.sourceFsPath, metadata);
        }

        // Update metadata in the .codex file if it exists
        if (metadata.codexFsPath) {
            const codexUri = vscode.Uri.file(metadata.codexFsPath);
            const fileStat = await vscode.workspace.fs.stat(codexUri);
            metadata.codexLastModified = new Date(fileStat.mtime).toISOString();
            await this.updateMetadataInFile(metadata.codexFsPath, metadata);
        }
    }

    private async updateMetadataInFile(
        fileFsPath: string,
        metadata: CustomNotebookMetadata
    ): Promise<void> {
        // Skip updating .dictionary files
        if (path.extname(fileFsPath) === ".dictionary") {
            debugLog("Skipping metadata update for dictionary file:", fileFsPath);
            return;
        }

        try {
            const fileContent = await vscode.workspace.fs.readFile(vscode.Uri.file(fileFsPath));
            let fileData;
            try {
                fileData = JSON.parse(new TextDecoder().decode(fileContent));
            } catch (error) {
                debugLog("Error parsing file content, creating new object:", error);
                fileData = {};
            }

            if (!fileData.metadata) {
                fileData.metadata = {};
            }

            // Update only the relevant metadata for each file type
            if (path.extname(fileFsPath) === ".source") {
                fileData.metadata = {
                    ...fileData.metadata,
                    id: metadata.id,
                    originalName: metadata.originalName,
                    sourceCreatedAt: metadata.sourceCreatedAt,
                    gitStatus: metadata.gitStatus,
                    corpusMarker: metadata.corpusMarker,
                };
            } else if (path.extname(fileFsPath) === ".codex") {
                fileData.metadata = {
                    ...fileData.metadata,
                    id: metadata.id,
                    originalName: metadata.originalName,
                    codexLastModified: metadata.codexLastModified,
                    gitStatus: metadata.gitStatus,
                    corpusMarker: metadata.corpusMarker,
                    navigation: metadata.navigation,
                    videoUrl: metadata.videoUrl,
                };
            }

            await vscode.workspace.fs.writeFile(
                vscode.Uri.file(fileFsPath),
                new TextEncoder().encode(JSON.stringify(fileData, null, 2))
            );

            debugLog("Updated metadata in file:", fileFsPath);
        } catch (error) {
            console.error("Error updating metadata in file:", fileFsPath, error);
        }
    }

    public generateNewId(baseName: string): string {
        const newId = generateUniqueId(baseName);
        debugLog("Generated new ID:", newId, "for base name:", baseName);
        return newId;
    }
}
