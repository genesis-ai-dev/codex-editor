import * as vscode from 'vscode';
import { CodexContentSerializer } from '../serializer';
import { generateUniqueId } from './idGenerator';

interface NotebookMetadata {
    id: string;
    sourceUri?: vscode.Uri;
    codexUri?: vscode.Uri;
    originalName: string;
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
        const sourceFiles = await vscode.workspace.findFiles('**/*.source');
        const codexFiles = await vscode.workspace.findFiles('**/*.codex');

        const serializer = new CodexContentSerializer();

        for (const file of [...sourceFiles, ...codexFiles]) {
            const content = await vscode.workspace.fs.readFile(file);
            const notebookData = await serializer.deserializeNotebook(content, new vscode.CancellationTokenSource().token);
            
            const originalName = notebookData.metadata?.originalName || file.path.split('/').pop()?.split('.')[0] || '';
            const id = notebookData.metadata?.id || generateUniqueId(originalName);

            const existingMetadata = this.metadataMap.get(id) || { id, originalName };
            if (file.path.endsWith('.source')) {
                existingMetadata.sourceUri = file;
            } else {
                existingMetadata.codexUri = file;
            }
            this.metadataMap.set(id, existingMetadata);
        }
    }

    public getMetadataById(id: string): NotebookMetadata | undefined {
        return this.metadataMap.get(id);
    }

    public getMetadataByUri(uri: vscode.Uri): NotebookMetadata | undefined {
        for (const metadata of this.metadataMap.values()) {
            if (metadata.sourceUri?.fsPath === uri.fsPath || metadata.codexUri?.fsPath === uri.fsPath) {
                return metadata;
            }
        }
        return undefined;
    }

    public addOrUpdateMetadata(metadata: NotebookMetadata): void {
        this.metadataMap.set(metadata.id, metadata);
    }

    public generateNewId(baseName: string): string {
        const newId = generateUniqueId(baseName);
        return newId;
    }
}