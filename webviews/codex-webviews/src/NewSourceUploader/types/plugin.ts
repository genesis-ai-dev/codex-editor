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
 * Enhanced to handle style/paratext cells with fallback positional matching
 */
export const defaultCellAligner: CellAligner = async (
    targetCells: any[],
    sourceCells: any[],
    importedContent: ImportedContent[]
): Promise<AlignedCell[]> => {
    const alignedCells: AlignedCell[] = [];
    let totalMatches = 0;
    let positionalMatches = 0;

    // Create a map of target cells for quick lookup by ID
    const targetCellsMap = new Map<string, any>();
    targetCells.forEach((cell) => {
        if (cell.metadata?.id) {
            targetCellsMap.set(cell.metadata.id, cell);
        }
    });

    // Track which target cells have been matched to avoid double-matching
    const matchedTargetCellIndices = new Set<number>();
    // Track matched imported items by their index for style/paratext sequential matching
    const matchedImportedIndices = new Set<number>();

    // Helper function to check if a cell is style or paratext
    const isStyleOrParatext = (cell: any): boolean => {
        const cellType = cell?.metadata?.type;
        return cellType === 'style' || cellType === 'paratext';
    };

    // Helper function to check if imported content is style or paratext
    const isImportedStyleOrParatext = (item: ImportedContent): boolean => {
        // Check both direct type property and metadata.type (since notebookToImportedContent spreads metadata)
        const cellType = (item as any).type || (item as any).metadata?.type;
        return cellType === 'style' || cellType === 'paratext';
    };

    // Process each imported content item
    for (let importIndex = 0; importIndex < importedContent.length; importIndex++) {
        const importedItem = importedContent[importIndex];

        if (!importedItem.content.trim()) {
            continue; // Skip empty content
        }

        // First, try exact ID match in target cells
        const targetCell = targetCellsMap.get(importedItem.id);

        if (targetCell) {
            // Found exact matching cell - create aligned cell
            const targetIndex = targetCells.indexOf(targetCell);
            matchedTargetCellIndices.add(targetIndex);
            matchedImportedIndices.add(importIndex);

            alignedCells.push({
                notebookCell: targetCell,
                importedContent: importedItem,
                alignmentMethod: 'exact-id',
                confidence: 1.0 // High confidence for exact matches
            });
            totalMatches++;
        } else {
            // No exact ID match - try fallback for style/paratext cells
            const isStyleParatext = isImportedStyleOrParatext(importedItem);

            if (isStyleParatext) {
                // Try to find matching style/paratext cell by position relative to verse cells
                // Style cells should be matched based on their position between verse cells,
                // not just sequentially within the type group
                const importedType = (importedItem as any).type || (importedItem as any).metadata?.type;
                let foundMatch = false;

                // Find the position of this imported item relative to verse cells
                // Look for the verse cells before and after this item in importedContent
                let prevVerseIndex = -1;
                let nextVerseIndex = importedContent.length;
                for (let i = importIndex - 1; i >= 0; i--) {
                    const prevItem = importedContent[i];
                    const prevType = (prevItem as any).type || (prevItem as any).metadata?.type;
                    if (prevType === 'text' && (prevItem as any).metadata?.verse !== undefined) {
                        prevVerseIndex = i;
                        break;
                    }
                }
                for (let i = importIndex + 1; i < importedContent.length; i++) {
                    const nextItem = importedContent[i];
                    const nextType = (nextItem as any).type || (nextItem as any).metadata?.type;
                    if (nextType === 'text' && (nextItem as any).metadata?.verse !== undefined) {
                        nextVerseIndex = i;
                        break;
                    }
                }

                // Find the corresponding verse cells in target cells
                let targetPrevVerseId: string | null = null;
                let targetNextVerseId: string | null = null;
                if (prevVerseIndex >= 0) {
                    const prevImportedItem = importedContent[prevVerseIndex];
                    targetPrevVerseId = prevImportedItem.id;
                }
                if (nextVerseIndex < importedContent.length) {
                    const nextImportedItem = importedContent[nextVerseIndex];
                    targetNextVerseId = nextImportedItem.id;
                }

                // Find the target cell that's between the same verse cells
                let bestMatch: { cell: any; index: number; } | null = null;
                for (let targetIndex = 0; targetIndex < targetCells.length; targetIndex++) {
                    if (matchedTargetCellIndices.has(targetIndex)) {
                        continue; // Already matched
                    }

                    const candidateCell = targetCells[targetIndex];
                    const candidateType = candidateCell?.metadata?.type;

                    if (isStyleOrParatext(candidateCell) && candidateType === importedType) {
                        // Check if this candidate is between the same verse cells
                        let isBetweenVerses = true;

                        if (targetPrevVerseId) {
                            // Find the previous verse cell in target
                            let foundPrevVerse = false;
                            for (let i = targetIndex - 1; i >= 0; i--) {
                                const prevTargetCell = targetCells[i];
                                if (prevTargetCell.metadata?.id === targetPrevVerseId) {
                                    foundPrevVerse = true;
                                    break;
                                }
                                if (prevTargetCell.metadata?.type === 'text' && prevTargetCell.metadata?.verse !== undefined) {
                                    // Found a different verse cell before the expected one
                                    isBetweenVerses = false;
                                    break;
                                }
                            }
                            if (!foundPrevVerse) {
                                isBetweenVerses = false;
                            }
                        }

                        if (isBetweenVerses && targetNextVerseId) {
                            // Find the next verse cell in target
                            let foundNextVerse = false;
                            for (let i = targetIndex + 1; i < targetCells.length; i++) {
                                const nextTargetCell = targetCells[i];
                                if (nextTargetCell.metadata?.id === targetNextVerseId) {
                                    foundNextVerse = true;
                                    break;
                                }
                                if (nextTargetCell.metadata?.type === 'text' && nextTargetCell.metadata?.verse !== undefined) {
                                    // Found a different verse cell before the expected one
                                    isBetweenVerses = false;
                                    break;
                                }
                            }
                            if (!foundNextVerse) {
                                isBetweenVerses = false;
                            }
                        }

                        if (isBetweenVerses) {
                            bestMatch = { cell: candidateCell, index: targetIndex };
                            break; // Found the best match
                        }
                    }
                }

                // If no position-based match found, fall back to sequential matching within type
                if (!bestMatch) {
                    const unmatchedCellsOfType: Array<{ cell: any; index: number; }> = [];
                    for (let targetIndex = 0; targetIndex < targetCells.length; targetIndex++) {
                        if (matchedTargetCellIndices.has(targetIndex)) {
                            continue;
                        }
                        const candidateCell = targetCells[targetIndex];
                        const candidateType = candidateCell?.metadata?.type;
                        if (isStyleOrParatext(candidateCell) && candidateType === importedType) {
                            unmatchedCellsOfType.push({ cell: candidateCell, index: targetIndex });
                        }
                    }

                    let matchedCountOfType = 0;
                    for (let i = 0; i < importIndex; i++) {
                        if (matchedImportedIndices.has(i)) {
                            const prevItem = importedContent[i];
                            const prevType = (prevItem as any).type || (prevItem as any).metadata?.type;
                            if (prevType === importedType && isImportedStyleOrParatext(prevItem)) {
                                matchedCountOfType++;
                            }
                        }
                    }

                    if (matchedCountOfType < unmatchedCellsOfType.length) {
                        bestMatch = unmatchedCellsOfType[matchedCountOfType];
                    }
                }

                if (bestMatch) {
                    matchedTargetCellIndices.add(bestMatch.index);
                    matchedImportedIndices.add(importIndex);

                    // Use the target cell's ID to ensure correct positioning
                    const targetCellId = bestMatch.cell.metadata?.id || importedItem.id;
                    alignedCells.push({
                        notebookCell: bestMatch.cell,
                        importedContent: {
                            ...importedItem,
                            id: targetCellId, // Use target cell ID for correct positioning
                        },
                        alignmentMethod: 'exact-id',
                        confidence: 0.8 // High confidence for sequential type-based matches
                    });
                    totalMatches++;
                    positionalMatches++;
                    foundMatch = true;
                }

                if (!foundMatch) {
                    // No matching style/paratext cell found
                    // Preserve the original type (style or paratext) instead of always creating paratext
                    const isStyle = importedType === 'style';
                    alignedCells.push({
                        notebookCell: null,
                        importedContent: {
                            ...importedItem,
                            id: isStyle
                                ? `style-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
                                : `paratext-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                            type: importedType, // Preserve the type
                        },
                        isParatext: !isStyle, // Only mark as paratext if it's not a style cell
                        alignmentMethod: 'exact-id',
                        confidence: 0.0 // No confidence for unmatched content
                    });
                }
            } else {
                // Not style/paratext and no exact match - treat as paratext
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
    }

    // Log matching statistics
    console.log(`Default aligner: ${totalMatches} matches (${totalMatches - positionalMatches} exact, ${positionalMatches} positional) out of ${importedContent.length} imported items`);

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
 * Download progress information
 */
export interface DownloadProgress {
    stage: string;
    message: string;
    progress: number;
}

/**
 * Generic download handler function that plugins can define
 */
export type DownloadHandler = () => Promise<{
    success: boolean;
    data?: any;
    error?: string;
}>;

/**
 * Helper function for plugins to request downloads from the provider
 */
export type DownloadHelper = (
    pluginId: string,
    progressCallback?: (progress: DownloadProgress) => void
) => Promise<any>;

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

    /**
     * Optional: Helper function for downloading resources from the provider
     * Allows plugins to define download logic while execution happens on backend
     */
    downloadResource?: DownloadHelper;
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

/**
 * Extended write message that includes binary attachments to persist alongside notebooks.
 * Used by plugins that need to deliver media assets (e.g., audio) at import time.
 */
export interface WriteNotebooksWithAttachmentsMessage {
    command: 'writeNotebooksWithAttachments';
    notebookPairs: NotebookPair[];
    attachments: Array<{
        cellId: string;             // e.g., "JUD 1:1"
        attachmentId: string;       // e.g., "audio-1718042200000-abc123"
        fileName: string;           // e.g., "audio-1718042200000-abc123.webm"
        mime: string;               // e.g., "audio/webm"
        dataBase64?: string;        // may include data: prefix or raw base64 (only for source files)
        sourceFileId?: string;      // reference to source file (for segments)
        startTime?: number;         // segment start time in seconds
        endTime?: number;           // segment end time in seconds
    }>;
    metadata?: Record<string, any>;
}

export interface NotificationMessage {
    command: 'notification';
    type: 'info' | 'warning' | 'error' | 'success';
    message: string;
}

export interface SaveFileMessage {
    command: 'saveFile';
    fileName: string;
    dataBase64: string; // may be data: URL or raw base64
    mime?: string;
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

export interface DownloadResourceMessage {
    command: 'downloadResource';
    pluginId: string;
    requestId: string; // Unique ID to match request with response
}

export interface DownloadResourceProgressMessage {
    command: 'downloadResourceProgress';
    requestId: string;
    progress: DownloadProgress;
}

export interface DownloadResourceCompleteMessage {
    command: 'downloadResourceComplete';
    requestId: string;
    success: boolean;
    data?: any;
    error?: string;
}

export interface StartTranslatingMessage {
    command: 'startTranslating';
}

export interface SelectAudioFileMessage {
    command: 'selectAudioFile';
    thresholdDb?: number;
    minDuration?: number;
}

export interface ReprocessAudioFileMessage {
    command: 'reprocessAudioFile';
    sessionId: string;
    thresholdDb: number;
    minDuration: number;
}

export interface AudioFileSelectedMessage {
    command: 'audioFileSelected';
    sessionId: string;
    fileName: string;
    durationSec: number;
    segments: Array<{ id: string; startSec: number; endSec: number; }>;
    waveformPeaks: number[];
    fullAudioUri?: string;
    thresholdDb?: number;
    minDuration?: number;
    error?: string;
}

export interface AudioFilesSelectedMessage {
    command: 'audioFilesSelected';
    files: Array<{
        sessionId: string;
        fileName: string;
        durationSec: number;
        segments: Array<{ id: string; startSec: number; endSec: number; }>;
        waveformPeaks: number[];
        fullAudioUri?: string;
    }>;
    thresholdDb?: number;
    minDuration?: number;
    error?: string;
}

export interface RequestAudioSegmentMessage {
    command: 'requestAudioSegment';
    sessionId: string;
    segmentId: string;
    startSec: number;
    endSec: number;
}

export interface AudioSegmentResponseMessage {
    command: 'audioSegmentResponse';
    segmentId: string;
    audioUri: string;
    error?: string;
}

export interface FinalizeAudioImportMessage {
    command: 'finalizeAudioImport';
    sessionId: string;
    documentName: string;
    notebookPairs: NotebookPair[];
    segmentMappings: Array<{ segmentId: string; cellId: string; attachmentId: string; fileName: string; }>;
}

export interface AudioImportProgressMessage {
    command: 'audioImportProgress';
    sessionId: string;
    stage: string;
    message: string;
    progress?: number; // 0-100
    currentSegment?: number;
    totalSegments?: number;
    etaSeconds?: number; // Estimated time remaining in seconds
}

export interface AudioImportCompleteMessage {
    command: 'audioImportComplete';
    sessionId: string;
    success: boolean;
    error?: string;
}

export interface UpdateAudioSegmentsMessage {
    command: 'updateAudioSegments';
    sessionId: string;
    segments: Array<{ id: string; startSec: number; endSec: number; }>;
}

export interface AudioSegmentsUpdatedMessage {
    command: 'audioSegmentsUpdated';
    sessionId: string;
    success: boolean;
    error?: string;
}

export interface RequestAudioUriMessage {
    command: 'requestAudioUri';
    sessionId: string;
}

export interface AudioUriResponseMessage {
    command: 'audioUriResponse';
    sessionId: string;
    fullAudioUri?: string;
    error?: string;
}

export type ProviderMessage = WriteNotebooksMessage | WriteTranslationMessage | NotificationMessage | ImportBookNamesMessage | OverwriteConfirmationMessage | OverwriteResponseMessage | DownloadResourceMessage | DownloadResourceProgressMessage | DownloadResourceCompleteMessage | StartTranslatingMessage | SaveFileMessage | SelectAudioFileMessage | ReprocessAudioFileMessage | AudioFileSelectedMessage | RequestAudioSegmentMessage | AudioSegmentResponseMessage | RequestAudioUriMessage | AudioUriResponseMessage | FinalizeAudioImportMessage | AudioImportProgressMessage | AudioImportCompleteMessage | UpdateAudioSegmentsMessage | AudioSegmentsUpdatedMessage; 