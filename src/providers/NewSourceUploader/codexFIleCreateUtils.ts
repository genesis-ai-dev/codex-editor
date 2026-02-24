import * as vscode from "vscode";
import { CodexNotebookAsJSONData, NotebookPreview } from "@types";
import { CodexCellTypes } from "../../../types/enums";
import { createStandardizedFilename, isBiblicalImporterType } from "../../utils/bookNameUtils";
import { CorpusMarker, findCanonicalCorpusMarker } from "../../utils/corpusMarkerUtils";
import { CodexContentSerializer } from "../../serializer";
import { CustomNotebookMetadata } from "../../../types";
import { formatJsonForNotebookFile } from "../../utils/notebookFileFormattingUtils";

export function checkCancellation(token?: vscode.CancellationToken): void {
    if (token?.isCancellationRequested) {
        throw new vscode.CancellationError();
    }
}

export async function writeNotebook(uri: vscode.Uri, notebook: CodexNotebookAsJSONData): Promise<void> {
    // Don't use createCodexNotebook since it opens the document
    // Instead, directly serialize the notebook data
    const cells = notebook.cells.map((cell) => ({
        // need to ensure we spread in incoming metadata while also ensuring critical metadata is otherwise included
        kind: cell.kind ?? vscode.NotebookCellKind.Code,
        value: cell.value ?? "",
        languageId: cell.languageId ?? "html",
        metadata: {
            ...cell.metadata,
            type: cell.metadata?.type || CodexCellTypes.TEXT,
            id: cell.metadata?.id,
            data: cell.metadata?.data || {},
            edits: cell.metadata?.edits || []
        },
    }));

    const serializedData = formatJsonForNotebookFile(
        {
            cells,
            metadata: {
                textDirection: notebook.metadata.textDirection || "ltr",
                videoUrl: notebook.metadata.videoUrl || "",
                lineNumbersEnabled: notebook.metadata.lineNumbersEnabled ?? true,
                lineNumbersEnabledSource: notebook.metadata.lineNumbersEnabledSource || "global",
                edits: notebook.metadata.edits || [],
                ...notebook.metadata,
            },
        }
    );

    if (!serializedData) {
        throw new Error(`Failed to serialize notebook for ${uri.fsPath}`);
    }

    // Write the file directly without opening it
    await vscode.workspace.fs.writeFile(uri, Buffer.from(serializedData, "utf8"));
}

/**
 * Collects corpusMarker values from existing notebooks in the workspace
 */
async function collectExistingCorpusMarkers(workspaceFolder: vscode.WorkspaceFolder): Promise<CorpusMarker[]> {
    const existingMarkers: CorpusMarker[] = [];

    try {
        // Find all existing source files
        const sourceFiles = await vscode.workspace.findFiles(
            ".project/sourceTexts/*.source",
            "**/node_modules/**"
        );

        const serializer = new CodexContentSerializer();

        for (const file of sourceFiles) {
            try {
                const content = await vscode.workspace.fs.readFile(file);
                const notebookData = await serializer.deserializeNotebook(
                    content,
                    new vscode.CancellationTokenSource().token
                );

                const metadata = notebookData.metadata as CustomNotebookMetadata | undefined;
                if (metadata?.corpusMarker) {
                    existingMarkers.push(metadata.corpusMarker);
                }
            } catch (error) {
                // Skip files that can't be read
                console.warn(`[CORPUS MARKER NORMALIZATION] Could not read file ${file.fsPath}:`, error);
            }
        }
    } catch (error) {
        console.warn(`[CORPUS MARKER NORMALIZATION] Error collecting existing corpusMarkers:`, error);
    }

    return existingMarkers;
}

/**
 * Collects existing fileDisplayName values from source notebooks in the workspace.
 * Returns an array of display names (including any with number suffixes like "Sample (1)").
 */
async function collectExistingDisplayNames(workspaceFolder: vscode.WorkspaceFolder): Promise<string[]> {
    const existingDisplayNames: string[] = [];

    try {
        const sourceFiles = await vscode.workspace.findFiles(
            ".project/sourceTexts/*.source",
            "**/node_modules/**"
        );

        const serializer = new CodexContentSerializer();

        for (const file of sourceFiles) {
            try {
                const content = await vscode.workspace.fs.readFile(file);
                const notebookData = await serializer.deserializeNotebook(
                    content,
                    new vscode.CancellationTokenSource().token
                );

                const metadata = notebookData.metadata as CustomNotebookMetadata | undefined;
                if (metadata?.fileDisplayName) {
                    existingDisplayNames.push(metadata.fileDisplayName);
                }
            } catch (error) {
                // Skip files that can't be read
                console.warn(`[DISPLAY NAME] Could not read file ${file.fsPath}:`, error);
            }
        }
    } catch (error) {
        console.warn(`[DISPLAY NAME] Error collecting existing display names:`, error);
    }

    return existingDisplayNames;
}

/**
 * Generates a unique display name by adding a number suffix if needed.
 * Example: If "ACT-REV" exists, returns "ACT-REV (1)". If "ACT-REV (1)" also exists, returns "ACT-REV (2)".
 */
function getUniqueDisplayName(baseName: string, existingNames: string[]): string {
    // Check if the base name already exists
    if (!existingNames.includes(baseName)) {
        return baseName;
    }

    // Find the highest existing number suffix for this base name
    // Pattern matches: "baseName (N)" where N is a number
    const escapedBaseName = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const suffixPattern = new RegExp(`^${escapedBaseName} \\((\\d+)\\)$`);
    
    let maxNumber = 0;
    for (const name of existingNames) {
        const match = name.match(suffixPattern);
        if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxNumber) {
                maxNumber = num;
            }
        }
    }

    // Return the base name with the next number
    return `${baseName} (${maxNumber + 1})`;
}

export async function createNoteBookPair({
    token,
    sourceNotebooks,
    codexNotebooks,
}: {
    token?: vscode.CancellationToken;
    sourceNotebooks: NotebookPreview[];
    codexNotebooks: NotebookPreview[];
}): Promise<Array<{ sourceUri: vscode.Uri; codexUri: vscode.Uri; notebook: NotebookPreview; }>> {
    const notebookResults: Array<{
        sourceUri: vscode.Uri;
        codexUri: vscode.Uri;
        notebook: NotebookPreview;
    }> = [];
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (!workspaceFolder) {
        throw new Error("No workspace folder found");
    }

    // Collect existing corpusMarkers from the workspace
    const existingMarkers = await collectExistingCorpusMarkers(workspaceFolder);

    // Collect existing display names for non-biblical imports to avoid duplicates
    const existingDisplayNames = await collectExistingDisplayNames(workspaceFolder);

    for (let i = 0; i < sourceNotebooks.length; i++) {
        checkCancellation(token);

        const sourceNotebook = sourceNotebooks[i];
        const codexNotebook = codexNotebooks[i];

        if (!sourceNotebook.name || !codexNotebook.name) {
            throw new Error("Notebook name is required");
        }

        // Determine if this is biblical content based on the importer type
        const importerType = sourceNotebook.metadata?.importerType || '';
        const isBiblical = isBiblicalImporterType(importerType);

        console.log(`[CODEX FILE CREATE] Importer type: "${importerType}", Biblical: ${isBiblical}`);

        // For non-biblical imports, use the metadata id (UUID) to create unique filenames
        // This allows users to import changed source files multiple times and merge translations later
        let notebookName = sourceNotebook.name;
        let uniqueId: string | undefined;
        
        if (!isBiblical) {
            // Use the metadata id (UUID) that was generated during import
            uniqueId = sourceNotebook.metadata?.id;
            
            if (!uniqueId) {
                // Fallback: generate a short unique id if metadata.id is missing
                uniqueId = Math.random().toString(36).substring(2, 10);
                console.warn(`[CODEX FILE CREATE] No metadata.id found, generated fallback id: "${uniqueId}"`);
            }
            
            notebookName = `${sourceNotebook.name}-(${uniqueId})`;
            
            console.log(`[CODEX FILE CREATE] Non-biblical import: adding id "${uniqueId}" to filename`);
            
            // IMPORTANT: Do NOT modify originalFileName here.
            // originalFileName must point to the actual file stored in attachments/originals/
            // (which may be deduplicated). The notebook filename uses UUIDs for uniqueness,
            // but the original file reference should remain unchanged for round-trip export.

            // Generate unique display name for non-biblical imports
            // If a file with the same display name already exists, add a number suffix
            const baseDisplayName = sourceNotebook.metadata?.fileDisplayName || sourceNotebook.name;
            const uniqueDisplayName = getUniqueDisplayName(baseDisplayName, existingDisplayNames);
            
            if (uniqueDisplayName !== baseDisplayName) {
                console.log(`[CODEX FILE CREATE] Display name "${baseDisplayName}" already exists, using "${uniqueDisplayName}"`);
            }
            
            // Update display name in metadata
            sourceNotebook.metadata.fileDisplayName = uniqueDisplayName;
            codexNotebook.metadata.fileDisplayName = uniqueDisplayName;
            
            // Add this display name to existing names for subsequent files in the same batch
            existingDisplayNames.push(uniqueDisplayName);
        }

        // Use corpusMarker as-is from the importer (no normalization)
        // This matches how other importers like Docx and Biblica work
        const incomingCorpusMarker = sourceNotebook.metadata?.corpusMarker;
        if (incomingCorpusMarker) {
            // Check if an exact match exists in existing markers
            const exactMatch = existingMarkers.find(m => m === incomingCorpusMarker);
            if (exactMatch) {
                // Exact match exists, use it to maintain consistency
                sourceNotebook.metadata.corpusMarker = exactMatch;
                codexNotebook.metadata.corpusMarker = exactMatch;
            } else {
                // No exact match, use the incoming marker as-is
                sourceNotebook.metadata.corpusMarker = incomingCorpusMarker;
                codexNotebook.metadata.corpusMarker = incomingCorpusMarker;
                // Add to existing markers for subsequent files
                existingMarkers.push(incomingCorpusMarker);
            }
        }

        // Create standardized filenames - only use USFM codes for biblical content
        // For non-biblical content, notebookName already includes the unique id
        const sourceFilename = await createStandardizedFilename(notebookName, ".source", isBiblical);
        const codexFilename = await createStandardizedFilename(notebookName, ".codex", isBiblical);

        // Create final URIs with standardized filenames
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

        // Update metadata with final paths
        sourceNotebook.metadata.sourceFsPath = sourceUri.fsPath;
        sourceNotebook.metadata.codexFsPath = codexUri.fsPath;
        codexNotebook.metadata.sourceFsPath = sourceUri.fsPath;
        codexNotebook.metadata.codexFsPath = codexUri.fsPath;

        // Ensure directories exist
        await vscode.workspace.fs.createDirectory(
            vscode.Uri.joinPath(workspaceFolder.uri, ".project", "sourceTexts")
        );
        await vscode.workspace.fs.createDirectory(
            vscode.Uri.joinPath(workspaceFolder.uri, "files", "target")
        );

        console.log(`[CODEX FILE CREATE] Writing notebooks for "${sourceNotebook.name}"`);
        console.log(`[CODEX FILE CREATE] - Source: ${sourceUri.fsPath}`);
        console.log(`[CODEX FILE CREATE] - Codex: ${codexUri.fsPath}`);

        await writeNotebook(sourceUri, sourceNotebook as CodexNotebookAsJSONData);
        await writeNotebook(codexUri, codexNotebook as CodexNotebookAsJSONData);

        console.log(`[CODEX FILE CREATE] Successfully wrote notebook pair for "${sourceNotebook.name}"`);

        notebookResults.push({ sourceUri, codexUri, notebook: sourceNotebook });
    }

    return notebookResults;
}
