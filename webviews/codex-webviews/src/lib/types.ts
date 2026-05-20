export enum CELL_DISPLAY_MODES {
    ONE_LINE_PER_CELL = "one_line_per_cell",
}

export interface QuillCellContent {
    id: string;
    cellMarkers?: string[];
    [key: string]: any;
}

export interface NavigationCell {
    id: string;
    label: string;
    [key: string]: any;
}

export interface CustomNotebookMetadata {
    id: string;
    textDirection?: "ltr" | "rtl";
    perf?: any;
    attachments?: {
        [key: string]: {
            url: string;
            type: string;
        };
    };
    originalName: string;
    sourceFsPath: string | undefined;
    codexFsPath: string | undefined;
    navigation: NavigationCell[];
    videoUrl?: string;
    audioOnly?: boolean;
    sourceCreatedAt: string;
    codexLastModified?: string;
    corpusMarker: string;
    validationMigrationComplete?: boolean;
    fontSize?: number;
    importerType?: string;
    originalFileName?: string;
    sourceFile?: string;
    /**
     * Timestamp added to non-biblical imports to ensure unique filenames.
     * Format: "YYYYMMDD_HHmmss" (e.g., "20260127_143025")
     */
    importTimestamp?: string;
}

export interface ProgressPercentages {
    percentTranslationsCompleted: number;
    percentAudioTranslationsCompleted: number;
    percentFullyValidatedTranslations: number;
    percentAudioValidatedTranslations: number;
    percentTextValidatedTranslations: number;
    textValidationLevels?: number[];
    audioValidationLevels?: number[];
    requiredTextValidations?: number;
    requiredAudioValidations?: number;
}

export interface Subsection {
    id: string;
    label: string;
    startIndex: number;
    endIndex: number;
    /**
     * User-assigned name for this subdivision, when present. The navigation
     * header and milestone accordion prefer `name` over `label` for display;
     * callers that always want a numeric range should continue to read
     * `label`.
     */
    name?: string;
    /**
     * Stable key for this subdivision (typically `startCellId`, or a reserved
     * key for the implicit first subdivision). Used when persisting
     * name/placement edits back to the provider.
     */
    key?: string;
    /**
     * ID of the root content cell that anchors this subdivision's start.
     * Undefined when the subdivision wraps an empty milestone.
     */
    startCellId?: string;
    /** Whether the subdivision boundary was user-authored or auto-calculated. */
    source?: "auto" | "custom";
}

export type FileStatus = "dirty" | "syncing" | "synced" | "none";

export type EditorPosition = "leftmost" | "rightmost" | "center" | "single" | "unknown"; 