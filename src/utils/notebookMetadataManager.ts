import { API, GitExtension } from "./../providers/scm/git.d";
import * as vscode from "vscode";
import { CodexContentSerializer } from "../serializer";
import { generateUniqueId, clearIdCache } from "./idGenerator";
import { NavigationCell, NotebookMetadata } from "./codexNotebookUtils";
import { API as GitAPI, Repository, Status } from "../providers/scm/git.d";
import {
    deserializeDictionaryEntries,
    serializeDictionaryEntries,
    repairDictionaryContent,
    ensureCompleteEntry,
} from "./dictionaryUtils/common";
import { readDictionaryClient, saveDictionaryClient } from "./dictionaryUtils/client";

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
    private metadataMap: Map<string, NotebookMetadata> = new Map();

    private constructor() {}

    public static getInstance(): NotebookMetadataManager {
        if (!NotebookMetadataManager.instance) {
            NotebookMetadataManager.instance = new NotebookMetadataManager();
        }
        return NotebookMetadataManager.instance;
    }

    public getAllMetadata(): NotebookMetadata[] {
        return Array.from(this.metadataMap.values());
    }

    private getDefaultMetadata(id: string, originalName: string): NotebookMetadata {
        return {
            id,
            originalName,
            sourceUri: undefined as unknown as vscode.Uri,
            codexUri: undefined as unknown as vscode.Uri,
            data: {},
            sourceFile: "",
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
        const dictionaryFiles = await vscode.workspace.findFiles("**/*.dictionary");

        const allFiles = [...sourceFiles, ...codexFiles, ...dictionaryFiles];
        const serializer = new CodexContentSerializer();

        for (const file of allFiles) {
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

            const originalName = file.path.split("/").pop()?.split(".")[0] || "";
            const id =
                notebookData.metadata?.id || notebookData.id || this.generateNewId(originalName);

            let metadata = this.metadataMap.get(id);
            if (!metadata) {
                metadata = this.getDefaultMetadata(id, originalName);
                this.metadataMap.set(id, metadata);
                debugLog("Created new metadata entry:", id);
            }

            const fileStat = await vscode.workspace.fs.stat(file);

            if (file.path.endsWith(".source")) {
                metadata.sourceUri = file;
                metadata.sourceCreatedAt = new Date(fileStat.ctime).toISOString();
                debugLog("Updated sourceUri for:", id);
            } else if (file.path.endsWith(".codex")) {
                metadata.codexUri = file;
                metadata.codexLastModified = new Date(fileStat.mtime).toISOString();
                debugLog("Updated codexUri for:", id);
            } else if (file.path.endsWith(".dictionary")) {
                metadata.sourceUri = file;
                metadata.codexUri = file; // For dictionaries, source and codex are the same file
                metadata.sourceCreatedAt = new Date(fileStat.ctime).toISOString();
                metadata.codexLastModified = new Date(fileStat.mtime).toISOString();
                debugLog("Updated dictionary metadata for:", id);

                if (notebookData.entries && Array.isArray(notebookData.entries)) {
                    const repairedContent = repairDictionaryContent(
                        new TextDecoder().decode(content)
                    );
                    notebookData.entries = deserializeDictionaryEntries(repairedContent);
                    notebookData.entries = notebookData.entries.map(ensureCompleteEntry);

                    // Save the updated entries back to the file
                    await saveDictionaryClient(file, {
                        id: "project",
                        label: "Project",
                        entries: notebookData.entries,
                        metadata: {},
                    });
                }
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

    private async getGitStatusForFile(fileUri: vscode.Uri): Promise<NotebookMetadata["gitStatus"]> {
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

    public getMetadataById(id: string): NotebookMetadata | undefined {
        const metadata = this.metadataMap.get(id);
        debugLog("getMetadataById:", id, metadata ? "found" : "not found");
        return metadata;
    }

    public getMetadataByUri(uri: vscode.Uri): NotebookMetadata {
        for (const metadata of this.metadataMap.values()) {
            if (
                metadata.sourceUri?.fsPath === uri.fsPath ||
                metadata.codexUri?.fsPath === uri.fsPath
            ) {
                debugLog("getMetadataByUri:", uri.fsPath, "found");
                return metadata;
            }
        }

        // If metadata is not found, create a new one
        const fileName = uri.path.split("/").pop() || "";
        const baseName = fileName.split(".")[0];
        const id = this.generateNewId(baseName);
        const newMetadata = this.getDefaultMetadata(id, baseName);

        if (uri.path.endsWith(".source")) {
            newMetadata.sourceUri = uri;
        } else if (uri.path.endsWith(".codex")) {
            newMetadata.codexUri = uri;
        }

        this.metadataMap.set(id, newMetadata);
        debugLog("getMetadataByUri:", uri.fsPath, "created new metadata");
        return newMetadata;
    }

    public getMetadataBySourceFileName(sourceFileName: string): NotebookMetadata | undefined {
        const baseName = sourceFileName.split(".")[0]; // Remove any file extension
        for (const metadata of this.metadataMap.values()) {
            if (metadata.id === baseName || metadata.originalName === baseName) {
                return metadata;
            }
        }
        return undefined;
    }

    public async addOrUpdateMetadata(metadata: NotebookMetadata): Promise<void> {
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
        if (metadata.sourceUri) {
            await this.updateMetadataInFile(metadata.sourceUri, metadata);
        }

        // Update metadata in the .codex file if it exists
        if (metadata.codexUri) {
            const fileStat = await vscode.workspace.fs.stat(metadata.codexUri);
            metadata.codexLastModified = new Date(fileStat.mtime).toISOString();
            await this.updateMetadataInFile(metadata.codexUri, metadata);
        }
    }

    private async updateMetadataInFile(
        fileUri: vscode.Uri,
        metadata: NotebookMetadata
    ): Promise<void> {
        // Skip updating .dictionary files
        if (fileUri.path.endsWith(".dictionary")) {
            debugLog("Skipping metadata update for dictionary file:", fileUri.fsPath);
            return;
        }

        try {
            const fileContent = await vscode.workspace.fs.readFile(fileUri);
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
            if (fileUri.path.endsWith(".source")) {
                fileData.metadata = {
                    ...fileData.metadata,
                    id: metadata.id,
                    originalName: metadata.originalName,
                    sourceCreatedAt: metadata.sourceCreatedAt,
                    gitStatus: metadata.gitStatus,
                    corpusMarker: metadata.corpusMarker,
                };
            } else if (fileUri.path.endsWith(".codex")) {
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
                fileUri,
                new TextEncoder().encode(JSON.stringify(fileData, null, 2))
            );

            debugLog("Updated metadata in file:", fileUri.fsPath);
        } catch (error) {
            console.error("Error updating metadata in file:", fileUri.fsPath, error);
        }
    }

    public generateNewId(baseName: string): string {
        const newId = generateUniqueId(baseName);
        debugLog("Generated new ID:", newId, "for base name:", baseName);
        return newId;
    }
}
