export enum CELL_DISPLAY_MODES {
    INLINE = "inline",
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
    cellDisplayMode?: "inline" | "one-line-per-cell";
    validationMigrationComplete?: boolean;
    fontSize?: number;
}

export interface ProgressPercentages {
    percentTranslationsCompleted: number;
    percentAudioTranslationsCompleted: number;
    percentFullyValidatedTranslations: number;
    percentAudioValidatedTranslations: number;
    percentTextValidatedTranslations: number;
}

export interface Subsection {
    id: string;
    label: string;
    startIndex: number;
    endIndex: number;
}

export type FileStatus = "dirty" | "syncing" | "synced" | "none";

export type EditorPosition = "leftmost" | "rightmost" | "center" | "single" | "unknown"; 