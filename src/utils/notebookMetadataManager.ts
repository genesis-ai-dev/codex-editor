import * as vscode from "vscode";
import { CodexContentSerializer } from "../serializer";
import { generateUniqueId, clearIdCache } from "./idGenerator";

const DEBUG_MODE = true; // Set to true to enable debug logging

interface NotebookMetadata {
    id: string;
    sourceUri?: vscode.Uri;
    codexUri?: vscode.Uri;
    originalName: string;
}

function debugLog(...args: any[]): void {
    if (DEBUG_MODE) {
        console.log("[NotebookMetadataManager]", ...args);
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
                    sourceUri: undefined,
                    codexUri: undefined,
                } as NotebookMetadata;
                this.metadataMap.set(id, existingMetadata);
                debugLog("Created new metadata entry:", id);
            }

            if (file.path.endsWith(".source")) {
                existingMetadata.sourceUri = file;
                debugLog("Updated sourceUri for:", id);
            } else if (file.path.endsWith(".codex")) {
                existingMetadata.codexUri = file;
                debugLog("Updated codexUri for:", id);
            }
        }
        debugLog("Metadata loading complete. Total entries:", this.metadataMap.size);
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
        const baseName = sourceFileName.endsWith('.source') ? sourceFileName.slice(0, -7) : sourceFileName;
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
