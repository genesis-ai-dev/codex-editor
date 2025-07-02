import { NotebookPair } from "../../types/common";
import { ImportedContent, ImporterComponentProps } from "../../types/plugin";

/**
 * Helper function to convert notebook cells to ImportedContent format for translation imports
 */
export function notebookToImportedContent(notebook: NotebookPair): ImportedContent[] {
    return notebook.source.cells.map((cell, index) => ({
        id: cell.id || cell.metadata?.id || `cell-${index}`,
        content: cell.content,
        edits: cell.metadata?.edits,
        // Include any additional metadata that might be useful
        ...(cell.metadata || {}),
    }));
}

/**
 * Helper function to handle completion for both source and translation imports
 * This prevents the "e is not a function" error by checking which callback exists
 */
export async function handleImportCompletion(
    notebookPair: NotebookPair,
    props: ImporterComponentProps
): Promise<void> {
    const { onComplete, onTranslationComplete, alignContent, wizardContext } = props;

    // Check if this is a translation import
    const isTranslationImport = wizardContext?.intent === "target";
    const selectedSource = wizardContext?.selectedSource;

    if (isTranslationImport && onTranslationComplete && alignContent && selectedSource) {
        // Translation import mode - convert notebook to imported content and align
        console.log("Handling translation import...");

        try {
            // Convert notebook cells to ImportedContent format
            const importedContent = notebookToImportedContent(notebookPair);

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
        // Source import mode - create new notebook pair
        console.log("Handling source import...");
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