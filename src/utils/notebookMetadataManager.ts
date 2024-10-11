import { API, GitExtension } from "./../providers/scm/git.d";
import * as vscode from "vscode";
import { CodexContentSerializer } from "../serializer";
import { generateUniqueId, clearIdCache } from "./idGenerator";
import { NavigationCell, NotebookMetadata } from "./codexNotebookUtils";
import { API as GitAPI, Repository, Status } from "../providers/scm/git.d";

const DEBUG_MODE = true; // Set to true to enable debug logging

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

    public async loadMetadata(): Promise<void> {
        debugLog("Loading metadata...");
        clearIdCache();
        this.metadataMap.clear();

        const sourceFiles = await vscode.workspace.findFiles("**/*.source");
        const codexFiles = await vscode.workspace.findFiles("**/*.codex");

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

            const originalName = file.path.split("/").pop()?.split(".")[0] || "";
            const id = notebookData.metadata?.id || this.generateNewId(originalName);

            let existingMetadata = this.metadataMap.get(id);
            if (!existingMetadata) {
                existingMetadata = {
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
                } as NotebookMetadata;
                this.metadataMap.set(id, existingMetadata);
                debugLog("Created new metadata entry:", id);
            }

            const fileStat = await vscode.workspace.fs.stat(file);

            if (file.path.endsWith(".source")) {
                existingMetadata.sourceUri = file;
                existingMetadata.sourceCreatedAt = new Date(fileStat.ctime).toISOString();
                debugLog("Updated sourceUri for:", id);
            } else if (file.path.endsWith(".codex")) {
                existingMetadata.codexUri = file;
                existingMetadata.codexLastModified = new Date(fileStat.mtime).toISOString();
                debugLog("Updated codexUri for:", id);
            }

            existingMetadata.gitStatus = await this.getGitStatusForFile(file);
        }

        // Handle project.dictionary file
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            const workspaceUri = vscode.workspace.workspaceFolders[0].uri;
            const dictionaryUri = vscode.Uri.joinPath(workspaceUri, "project.dictionary");
            const dictionaryMetadata: NotebookMetadata = {
                id: "projectDictionary",
                originalName: "Project Dictionary",
                sourceUri: dictionaryUri,
                codexUri: dictionaryUri,
                data: {},
                sourceFile: "",
                navigation: [],
                videoUrl: "",
                sourceCreatedAt: "",
                codexLastModified: "",
                gitStatus: await this.getGitStatusForFile(dictionaryUri),
            };
            this.metadataMap.set("projectDictionary", dictionaryMetadata);
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

        // Check if the file is untracked
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

    public getMetadataByUri(uri: vscode.Uri): NotebookMetadata | undefined {
        for (const metadata of this.metadataMap.values()) {
            if (
                metadata.sourceUri?.fsPath === uri.fsPath ||
                metadata.codexUri?.fsPath === uri.fsPath
            ) {
                debugLog("getMetadataByUri:", uri.fsPath, "found");
                return metadata;
            }
        }
        debugLog("getMetadataByUri:", uri.fsPath, "not found");
        return undefined;
    }

    public getMetadataBySourceFileName(sourceFileName: string): NotebookMetadata | undefined {
        const baseName = sourceFileName.endsWith(".source")
            ? sourceFileName.slice(0, -7)
            : sourceFileName;
        for (const metadata of this.metadataMap.values()) {
            if (metadata.id === baseName) {
                return metadata;
            }
        }
        return undefined;
    }

    public async addOrUpdateMetadata(metadata: NotebookMetadata): Promise<void> {
        const existingMetadata = this.metadataMap.get(metadata.id);
        if (existingMetadata) {
            this.metadataMap.set(metadata.id, { ...existingMetadata, ...metadata });
            debugLog("Updated metadata for:", metadata.id);
        } else {
            this.metadataMap.set(metadata.id, metadata);
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
        try {
            const fileContent = await vscode.workspace.fs.readFile(fileUri);
            const fileData = JSON.parse(new TextDecoder().decode(fileContent));

            if (!fileData.metadata) {
                fileData.metadata = {};
            }

            fileData.metadata = { ...fileData.metadata, ...metadata };

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
