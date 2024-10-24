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

export class NotebookMetadataManager {
    private metadataMap: Map<string, CustomNotebookMetadata> = new Map();
    private storageUri: vscode.Uri;

    constructor(storageUri?: vscode.Uri) {
        if (storageUri) {
            this.storageUri = storageUri;
        } else {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (workspaceFolder) {
                this.storageUri = vscode.Uri.joinPath(workspaceFolder.uri, "metadata.json");
            } else {
                // Use a temporary directory for testing if no workspace is available
                this.storageUri = vscode.Uri.file(path.join(__dirname, "test-metadata.json"));
            }
        }
    }

    async initialize(): Promise<void> {
        try {
            const content = await vscode.workspace.fs.readFile(this.storageUri);
            const metadataArray: CustomNotebookMetadata[] = JSON.parse(content.toString());
            this.metadataMap = new Map(metadataArray.map((metadata) => [metadata.id, metadata]));
        } catch (error) {
            console.warn("Failed to load metadata:", error);
        }
    }

    async addOrUpdateMetadata(metadata: CustomNotebookMetadata): Promise<void> {
        this.metadataMap.set(metadata.id, metadata);
        await this.persistMetadata();
    }

    async getMetadata(id: string): Promise<CustomNotebookMetadata | undefined> {
        return this.metadataMap.get(id);
    }

    private async persistMetadata(): Promise<void> {
        const metadataArray = Array.from(this.metadataMap.values());
        const content = Buffer.from(JSON.stringify(metadataArray, null, 2));
        await vscode.workspace.fs.writeFile(this.storageUri, content);
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

        const gitAvailable = await this.isGitAvailable();

        const sourceFiles = await vscode.workspace.findFiles("**/*.source");
        const codexFiles = await vscode.workspace.findFiles("**/*.codex");
        const serializer = new CodexContentSerializer();

        const workspaceUri = getWorkSpaceUri();
        if (!workspaceUri) {
            throw new Error("No workspace folder found");
        }

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

            if (gitAvailable) {
                metadata.gitStatus = await this.getGitStatusForFile(file);
            } else {
                metadata.gitStatus = "uninitialized";
            }

            // Merge any additional metadata from the file
            if (notebookData.metadata) {
                metadata = { ...metadata, ...notebookData.metadata };
            }

            metadata ? this.metadataMap.set(id, metadata) : null;
        }

        // Handle project.dictionary file
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            const workspaceUri = getWorkSpaceUri();
            if (!workspaceUri) {
                throw new Error("No workspace folder found. Cannot load project.dictionary.");
            }
            const dictionaryUri = vscode.Uri.joinPath(workspaceUri, "files", "project.dictionary");
            const dictionaryMetadata = this.getMetadataByUri(dictionaryUri);
            await this.addOrUpdateMetadata(dictionaryMetadata);
        }

        debugLog("Metadata loading complete. Total entries:", this.metadataMap.size);
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
}
