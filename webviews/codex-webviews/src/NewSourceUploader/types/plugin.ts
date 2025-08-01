import { NotebookPair, ProcessedNotebook } from './common';
import { WizardContext } from './wizard';

/**
 * Information about existing source files in the project
 */
export interface ExistingFile {
    name: string;
    path: string;
    type: string;
    cellCount: number;
    metadata?: {
        id?: string;
        originalName?: string;
        corpusMarker?: string;
        sourceCreatedAt?: string;
    };
}

/**
 * Imported content item with alignment data
 */
export interface ImportedContent {
    id: string;
    content: string;
    startTime?: number;
    endTime?: number;
    edits?: any[];
    [key: string]: any; // Allow additional metadata
}

/**
 * Aligned cell for translation import
 */
export interface AlignedCell {
    notebookCell: any | null; // Target cell from existing notebook
    importedContent: ImportedContent;
    isParatext?: boolean;
    isAdditionalOverlap?: boolean;
    alignmentMethod?: 'exact-id' | 'sequential' | 'custom' | 'timestamp' | 'manual';
    confidence?: number; // 0-1 score for alignment confidence
}

/**
 * Custom alignment function for translation imports
 */
export type CellAligner = (
    targetCells: any[], // Existing target notebook cells
    sourceCells: any[], // Source notebook cells for context
    importedContent: ImportedContent[]
) => Promise<AlignedCell[]>;

/**
 * Sequential cell aligner that inserts content in order into empty target cells
 * Useful for content without meaningful IDs (like DOCX, Markdown, plain text)
 */
export const sequentialCellAligner: CellAligner = async (
    targetCells: any[],
    sourceCells: any[],
    importedContent: ImportedContent[]
): Promise<AlignedCell[]> => {
    const alignedCells: AlignedCell[] = [];

    // Filter to only empty target cells (those without content)
    const emptyCells = targetCells.filter(cell =>
        !cell.value || cell.value.trim() === ''
    );

    let cellIndex = 0;
    let insertedCount = 0;

    for (const importedItem of importedContent) {
        if (!importedItem.content.trim()) {
            continue; // Skip empty content
        }

        if (cellIndex < emptyCells.length) {
            // Insert into next available empty cell
            alignedCells.push({
                notebookCell: emptyCells[cellIndex],
                importedContent: importedItem,
                alignmentMethod: 'sequential',
                confidence: 0.8 // Medium confidence for sequential insertion
            });
            cellIndex++;
            insertedCount++;
        } else {
            // No more empty cells - add as paratext
            alignedCells.push({
                notebookCell: null,
                importedContent: {
                    ...importedItem,
                    id: `paratext-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                },
                isParatext: true,
                alignmentMethod: 'sequential',
                confidence: 0.3 // Low confidence for paratext
            });
        }
    }

    console.log(`Sequential aligner: ${insertedCount} items inserted sequentially, ${importedContent.length - insertedCount} as paratext`);

    return alignedCells;
};

/**
 * Default cell aligner that matches imported content IDs exactly with target cell IDs
 * This is used when plugins don't define their own custom alignment algorithm
 */
export const defaultCellAligner: CellAligner = async (
    targetCells: any[],
    sourceCells: any[],
    importedContent: ImportedContent[]
): Promise<AlignedCell[]> => {
    const alignedCells: AlignedCell[] = [];
    let totalMatches = 0;

    // Create a map of target cells for quick lookup
    const targetCellsMap = new Map<string, any>();
    targetCells.forEach((cell) => {
        if (cell.metadata?.id) {
            targetCellsMap.set(cell.metadata.id, cell);
        }
    });

    // Process each imported content item
    for (const importedItem of importedContent) {
        if (!importedItem.content.trim()) {
            continue; // Skip empty content
        }

        // Look for exact ID match in target cells
        const targetCell = targetCellsMap.get(importedItem.id);

        if (targetCell) {
            // Found matching cell - create aligned cell
            alignedCells.push({
                notebookCell: targetCell,
                importedContent: importedItem,
                alignmentMethod: 'exact-id',
                confidence: 1.0 // High confidence for exact matches
            });
            totalMatches++;
        } else {
            // No matching cell found - treat as paratext
            alignedCells.push({
                notebookCell: null,
                importedContent: {
                    ...importedItem,
                    id: `paratext-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                },
                isParatext: true,
                alignmentMethod: 'exact-id',
                confidence: 0.0 // No confidence for unmatched content
            });
        }
    }

    // Log matching statistics
    console.log(`Default aligner: ${totalMatches} exact matches found out of ${importedContent.length} imported items`);

    return alignedCells;
};

/**
 * Utility function type for performing alignment with default or custom algorithms
 */
export type AlignmentHelper = (
    importedContent: ImportedContent[],
    sourceFilePath: string,
    customAligner?: CellAligner
) => Promise<AlignedCell[]>;

/**
 * Props passed to each importer component
 */
export interface ImporterComponentProps {
    /**
     * Called when the import is complete with notebook pairs (for source imports)
     * Can be a single pair or multiple pairs for batch imports
     */
    onComplete?: (notebooks: NotebookPair | NotebookPair[]) => void;

    /**
     * Called when translation import is complete (for target imports)
     * Provides aligned content for merging into existing target notebook
     */
    onTranslationComplete?: (alignedContent: AlignedCell[], sourceFilePath: string) => void;

    /**
     * Called when the user wants to cancel and return to homepage
     */
    onCancel: () => void;

    /**
     * Called when the user wants to cancel the entire import process and return to the beginning
     * Shows confirmation dialog and resets wizard state completely
     */
    onCancelImport: () => void;

    /**
     * Optional: List of existing source files in the project
     * Useful for importers that want to add translations/targets to existing sources
     */
    existingFiles?: ExistingFile[];

    /**
     * Optional: Wizard context when importer is used in wizard flow
     * Provides information about intent (source/target) and selected source file
     */
    wizardContext?: WizardContext;

    /**
     * Optional: Helper function for performing alignment in translation imports
     * Handles fetching target cells and running alignment algorithms
     */
    alignContent?: AlignmentHelper;
}

/**
 * Plugin definition for each importer
 */
export interface ImporterPlugin {
    /**
     * Unique identifier for this plugin
     */
    id: string;

    /**
     * Human-readable name
     */
    name: string;

    /**
     * Brief description of what this importer does
     */
    description: string;

    /**
     * Icon component from lucide-react or similar
     */
    icon: React.ComponentType<{ className?: string; }>;

    /**
     * The main React component for this importer
     */
    component: React.ComponentType<ImporterComponentProps>;

    /**
     * Optional: Custom alignment function for translation imports
     * If provided, this will be used when importing translations for this plugin
     */
    cellAligner?: CellAligner;

    /**
     * Optional: File extensions this plugin supports (for file-based importers)
     */
    supportedExtensions?: string[];

    /**
     * Optional: MIME types this plugin supports
     */
    supportedMimeTypes?: string[];

    /**
     * Optional: Whether this plugin is enabled
     */
    enabled?: boolean;

    /**
     * Optional: Tags for categorizing plugins
     */
    tags?: string[];
}

/**
 * Message types for communication with the provider
 */
export interface WriteNotebooksMessage {
    command: 'writeNotebooks';
    notebookPairs: NotebookPair[];
    metadata?: Record<string, any>;
}

export interface WriteTranslationMessage {
    command: 'writeTranslation';
    alignedContent: AlignedCell[];
    sourceFilePath: string;
    targetFilePath: string;
    importerType: string;
    metadata?: Record<string, any>;
}

export interface NotificationMessage {
    command: 'notification';
    type: 'info' | 'warning' | 'error' | 'success';
    message: string;
}

export interface ImportBookNamesMessage {
    command: 'importBookNames';
    xmlContent: string;
    nameType?: 'long' | 'short' | 'abbr';
}

export interface OverwriteConfirmationMessage {
    command: 'overwriteConfirmation';
    conflictingFiles: Array<{
        name: string;
        sourceExists: boolean;
        targetExists: boolean;
        hasTranslations: boolean;
    }>;
    originalMessage: WriteNotebooksMessage;
}

export interface OverwriteResponseMessage {
    command: 'overwriteResponse';
    confirmed: boolean;
    originalMessage: WriteNotebooksMessage;
}

export type ProviderMessage = WriteNotebooksMessage | WriteTranslationMessage | NotificationMessage | ImportBookNamesMessage | OverwriteConfirmationMessage | OverwriteResponseMessage; 