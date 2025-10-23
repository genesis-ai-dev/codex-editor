import { NotebookPair } from "../../types/common";
import { ImportedContent, ImporterComponentProps } from "../../types/plugin";

/**
 * Helper function to convert notebook cells to ImportedContent format for translation imports
 */
export function notebookToImportedContent(notebook: NotebookPair): ImportedContent[] {
    return notebook.source.cells.map((cell, index) => {
        const md = cell.metadata || {};
        const data = md.data || {};
        return {
            id: cell.id || md.id || `cell-${index}`,
            content: cell.content,
            edits: md.edits,
            // Surface commonly used fields for aligners
            startTime: data.startTime ?? md.startTime,
            endTime: data.endTime ?? md.endTime,
            format: data.format ?? md.format,
            originalText: data.originalText ?? md.originalText,
            // Spread remaining metadata for flexibility
            ...md,
        };
    });
}

/**
 * Helper function to handle completion for both source and translation imports
 * This prevents the "e is not a function" error by checking which callback exists
 * Supports both single notebooks and arrays of notebooks for batch importing
 */
export async function handleImportCompletion(
    notebookPair: NotebookPair | NotebookPair[],
    props: ImporterComponentProps
): Promise<void> {
    const { onComplete, onTranslationComplete, alignContent, wizardContext } = props;

    // Check if this is a translation import
    const isTranslationImport = wizardContext?.intent === "target";
    const selectedSource = wizardContext?.selectedSource;

    if (isTranslationImport && onTranslationComplete && alignContent && selectedSource) {
        // Translation import mode - convert notebook to imported content and align
        console.log("Handling translation import...");

        // For translation imports, we only handle the first notebook if multiple are provided
        // Multi-file translation imports require special UI handling beyond this helper
        const primaryNotebook = Array.isArray(notebookPair) ? notebookPair[0] : notebookPair;

        try {
            // Convert notebook cells to ImportedContent format
            const importedContent = notebookToImportedContent(primaryNotebook);

            // Use the alignment helper (will use default exact ID matching unless plugin has custom aligner)
            const alignedCells = await alignContent(
                importedContent,
                selectedSource.path
            );

            // Call translation completion handler
            onTranslationComplete(alignedCells, selectedSource.path);
        } catch (error) {
            console.error("Error in translation alignment:", error);
            throw error;
        }
    } else if (onComplete) {
        // Source import mode - create new notebook pair(s)
        console.log("Handling source import...", Array.isArray(notebookPair) ? `${notebookPair.length} notebooks` : "1 notebook");
        onComplete(notebookPair);
    } else {
        console.error("No appropriate completion handler found", {
            isTranslationImport,
            hasOnComplete: !!onComplete,
            hasOnTranslationComplete: !!onTranslationComplete,
            hasAlignContent: !!alignContent,
            hasSelectedSource: !!selectedSource
        });
        throw new Error("No appropriate completion handler found for import");
    }
} 