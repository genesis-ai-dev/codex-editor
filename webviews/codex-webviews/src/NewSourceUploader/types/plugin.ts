import { NotebookPair, ProcessedNotebook } from './common';
import type { CustomNotebookCellData } from 'types';
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
    targetCells: CustomNotebookCellData[], // Existing target notebook cells
    sourceCells: CustomNotebookCellData[], // Source notebook cells for context
    importedContent: ImportedContent[]
) => Promise<AlignedCell[]>;

/**
 * Sequential cell aligner that inserts content in order into empty target cells
 * Useful for content without meaningful IDs (like DOCX, Markdown, plain text)
 */
export const sequentialCellAligner: CellAligner = async (
    targetCells: CustomNotebookCellData[],
    sourceCells: CustomNotebookCellData[],
    importedContent: ImportedContent[]
): Promise<AlignedCell[]> => {
    const alignedCells: AlignedCell[] = [];

    let importIndex = 0;
    let insertedCount = 0;
    let paratextCount = 0;

    const nextImportedItem = (): ImportedContent | null => {
        while (importIndex < importedContent.length) {
            const candidate = importedContent[importIndex];
            importIndex++;
            if (candidate.content.trim()) {
                return candidate;
            }
        }
        return null;
    };

    targetCells.forEach((targetCell, targetIndex) => {
        const existingContent = targetCell.value || "";
        const hasContent = existingContent.trim() !== "";

        if (!hasContent) {
            const importedItem = nextImportedItem();
            if (importedItem) {
                alignedCells.push({
                    notebookCell: targetCell,
                    importedContent: importedItem,
                    alignmentMethod: 'sequential',
                    confidence: 0.8 // Medium confidence for sequential insertion
                });
                insertedCount++;
                return;
            }
        }

        const targetId = targetCell.metadata?.id || `target-${targetIndex}`;
        alignedCells.push({
            notebookCell: targetCell,
            importedContent: {
                id: targetId,
                content: existingContent,
                edits: targetCell.metadata?.edits,
                cellLabel: targetCell.metadata?.cellLabel,
                metadata: targetCell.metadata || {},
                startTime: targetCell.metadata?.data?.startTime,
                endTime: targetCell.metadata?.data?.endTime,
            },
            alignmentMethod: 'custom',
            confidence: 1.0
        });
    });

    for (let i = importIndex; i < importedContent.length; i++) {
        const importedItem = importedContent[i];
        if (!importedItem.content.trim()) {
            continue; // Skip empty content
        }
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
        paratextCount++;
    }

    console.log(`Sequential aligner: ${insertedCount} items inserted sequentially, ${paratextCount} as paratext`);

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

    const importedById = new Map<string, Array<{ item: ImportedContent; index: number; }>>();
    const usedImportedIndexes = new Set<number>();

    importedContent.forEach((importedItem, index) => {
        if (!importedItem.content.trim()) {
            return;
        }
        const list = importedById.get(importedItem.id) || [];
        list.push({ item: importedItem, index });
        importedById.set(importedItem.id, list);
    });

    targetCells.forEach((targetCell, targetIndex) => {
        const targetId = targetCell.metadata?.id || `target-${targetIndex}`;
        const matches = targetId ? importedById.get(targetId) : undefined;
        const match = matches && matches.length > 0 ? matches.shift() : undefined;
        const importedItem = match?.item;

        if (importedItem) {
            if (match) {
                usedImportedIndexes.add(match.index);
            }
            alignedCells.push({
                notebookCell: targetCell,
                importedContent: importedItem,
                alignmentMethod: 'exact-id',
                confidence: 1.0 // High confidence for exact matches
            });
            totalMatches++;
        } else {
            alignedCells.push({
                notebookCell: targetCell,
                importedContent: {
                    id: targetId,
                    content: targetCell.value || targetCell.content || "",
                    edits: targetCell.metadata?.edits,
                    cellLabel: targetCell.metadata?.cellLabel,
                    metadata: targetCell.metadata || {},
                    startTime: targetCell.metadata?.data?.startTime,
                    endTime: targetCell.metadata?.data?.endTime,
                },
                alignmentMethod: 'custom',
                confidence: 1.0
            });
        }
    });

    importedContent.forEach((importedItem, index) => {
        if (!importedItem.content.trim() || usedImportedIndexes.has(index)) {
            return;
        }

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
    });

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

/**
 * Notifies the provider that an importer has started processing (e.g. user clicked Import).
 * Disables the sync button until importEnded is received. Must be paired with importEnded.
 */
export interface ImportStartedMessage {
    command: 'importStarted';
}

/**
 * Notifies the provider that an importer has finished processing (success, error, or cancel).
 * Re-enables the sync button if no other imports are in progress.
 */
export interface ImportEndedMessage {
    command: 'importEnded';
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

export type ProviderMessage = WriteNotebooksMessage | WriteTranslationMessage | NotificationMessage | ImportBookNamesMessage | ImportStartedMessage | ImportEndedMessage | OverwriteConfirmationMessage | OverwriteResponseMessage | DownloadResourceMessage | DownloadResourceProgressMessage | DownloadResourceCompleteMessage | StartTranslatingMessage | SaveFileMessage | SelectAudioFileMessage | ReprocessAudioFileMessage | AudioFileSelectedMessage | RequestAudioSegmentMessage | AudioSegmentResponseMessage | RequestAudioUriMessage | AudioUriResponseMessage | FinalizeAudioImportMessage | AudioImportProgressMessage | AudioImportCompleteMessage | UpdateAudioSegmentsMessage | AudioSegmentsUpdatedMessage; 