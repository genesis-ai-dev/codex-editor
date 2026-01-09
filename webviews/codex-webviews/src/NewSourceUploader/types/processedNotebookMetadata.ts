import type { FileImporterType, NotebookImportContext, NotebookImportMetadataCore } from "types";

export type ImporterType = FileImporterType;
export type ImportContext = NotebookImportContext;

// Fixme: we need to audit all the fields to ensure we really need them all

export type ProcessedNotebookMetadataBase = NotebookImportMetadataCore & {
    /** Required in import-time DTOs */
    id: string;
    originalFileName: string;
    sourceFile: string;
    importerType: ImporterType;
    createdAt: string;

    /**
     * Import-time-only fields that the extension provider may need to persist or transform.
     * These are optional across importers but should be part of the shared DTO contract
     * so providers can access them without unsafe casts.
     */
    documentStructure?: string;
    wordCount?: number;
    mammothMessages?: unknown;
    docxDocument?: string;
    originalHash?: string;

    /** Used by round-trip importers/exporters (stored in attachments/originals by the provider). */
    originalFileData?: ArrayBuffer; // Fixme: this needs to be removed it's making files real big
};

export type MarkdownFeatures = {
    hasImages: boolean;
    hasHeadings: boolean;
    hasListItems: boolean;
    hasTables: boolean;
    hasCodeBlocks: boolean;
    hasLinks: boolean;
    hasFootnotes: boolean;
};

export interface MarkdownNotebookMetadata extends ProcessedNotebookMetadataBase {
    importerType: "markdown";
    elementCount?: number;
    headingCount?: number;
    listItemCount?: number;
    imageCount?: number;
    wordCount?: number;
    footnoteCount?: number;
    features?: MarkdownFeatures;
}

export interface SubtitlesNotebookMetadata extends ProcessedNotebookMetadataBase {
    importerType: "subtitles";
    format?: string;
    totalCues?: number;
}

export type PlaintextSplitStrategy = "paragraphs" | "lines" | "sentences" | "sections";
export interface PlaintextNotebookMetadata extends ProcessedNotebookMetadataBase {
    importerType: "plaintext";
    splitStrategy?: PlaintextSplitStrategy;
    totalSegments?: number;
    originalLength?: number;
    statistics?: {
        characters: number;
        words: number;
        lines: number;
        paragraphs: number;
    };
}

export interface SpreadsheetNotebookMetadata extends ProcessedNotebookMetadataBase {
    importerType: "spreadsheet";
    delimiter?: string;
    columnCount?: number;
    rowCount?: number;
}

export interface SmartSegmenterNotebookMetadata extends ProcessedNotebookMetadataBase {
    importerType: "smart-segmenter";
}

export interface AudioNotebookMetadata extends ProcessedNotebookMetadataBase {
    importerType: "audio";
    audioOnly?: boolean;
}

export interface TmsNotebookMetadata extends ProcessedNotebookMetadataBase {
    importerType: "tms";
    translationUnitCount?: number;
    sourceLanguage?: string;
    targetLanguage?: string;
    fileType?: string;
    fileFormat?: string;
}

export interface PdfNotebookMetadata extends ProcessedNotebookMetadataBase {
    importerType: "pdf";
    fileType?: "pdf" | string;
    importDate?: string;
    totalCells?: number;
    segmentationType?: "sentences" | string;
    pdfDocumentMetadata?: {
        originalFileName: string;
        fileSize: number;
        totalSentences: number;
        importerVersion: string;
        totalPages?: number;
        pdfVersion?: string;
        author?: string;
        title?: string;
        creationDate?: string;
    };
    /** Used by the PDF importer to link codex metadata back to source metadata. */
    sourceMetadata?: ProcessedNotebookMetadata;
}

export interface ObsNotebookMetadata extends ProcessedNotebookMetadataBase {
    importerType: "obs";
    storyNumber?: number;
    storyTitle?: string;
    totalSegments?: number;
    segmentCount?: number;
    imageCount?: number;
    sourceReference?: string;
    fileName?: string;
    parentCollection?: string;
    obsStory?: string;
}

export interface ParatextNotebookMetadata extends ProcessedNotebookMetadataBase {
    importerType: "paratext";
    projectMetadata?: unknown;
    bookCode?: string;
    bookName?: string;
    fileName?: string;
    verseCount?: number;
    paratextCount?: number;
    totalVerses?: number;
    totalParatext?: number;
    chapters?: unknown;
    hasBookNames?: boolean;
    hasSettings?: boolean;
    detectedYear?: number;
    languageCode?: string;
    projectAbbreviation?: string;
}

export interface EbibleCorpusNotebookMetadata extends ProcessedNotebookMetadataBase {
    importerType: "ebibleCorpus";
    format?: string;
    verseCount?: number;
    books?: string[];
    languageCode?: string;
    translationId?: string;
    chapters?: number[];
}

export interface UsfmNotebookMetadata extends ProcessedNotebookMetadataBase {
    importerType: "usfm";
    bookCode?: string;
    bookName?: string;
    totalVerses?: number;
    totalParatext?: number;
    chapters?: Array<{ chapterNumber: number; verseCount: number; }>;
    footnoteCount?: number;
}

export interface UsfmExperimentalNotebookMetadata extends ProcessedNotebookMetadataBase {
    importerType: "usfm-experimental";
    fileType?: "usfm" | string;
    bookCode?: string;
    bookName?: string;
    totalVerses?: number;
    totalParatext?: number;
    chapters?: Array<{ chapterNumber: number; verseCount: number; }>;
    footnoteCount?: number;
    structureMetadata?: {
        originalUsfmContent: string;
        lineMappings: unknown;
    };
}

export interface DocxNotebookMetadata extends ProcessedNotebookMetadataBase {
    importerType: "docx";
}

export interface DocxRoundtripNotebookMetadata extends ProcessedNotebookMetadataBase {
    importerType: "docx-roundtrip";
    corpusMarker?: string;
    paragraphCount?: number;
}

export interface IndesignNotebookMetadata extends ProcessedNotebookMetadataBase {
    importerType: "indesign";
    originalFileData?: ArrayBuffer;
    documentId?: string;
    storyCount?: number;
    originalHash?: string;
    totalCells?: number;
    fileType?: "indesign" | string;
}

export interface BiblicaNotebookMetadata extends ProcessedNotebookMetadataBase {
    importerType: "biblica";
    originalFileData?: ArrayBuffer;
    documentId?: string;
    storyCount?: number;
    originalHash?: string;
    totalCells?: number;
    fileType?: "biblica" | string;
    contentType?: "notes";
}

export interface MaculaNotebookMetadata extends ProcessedNotebookMetadataBase {
    importerType: "macula";
    corpusMarker?: string;
    fileDisplayName?: string;
}

export type ProcessedNotebookMetadata =
    | MarkdownNotebookMetadata
    | SubtitlesNotebookMetadata
    | PlaintextNotebookMetadata
    | SpreadsheetNotebookMetadata
    | SmartSegmenterNotebookMetadata
    | AudioNotebookMetadata
    | TmsNotebookMetadata
    | PdfNotebookMetadata
    | ObsNotebookMetadata
    | ParatextNotebookMetadata
    | EbibleCorpusNotebookMetadata
    | UsfmNotebookMetadata
    | UsfmExperimentalNotebookMetadata
    | DocxNotebookMetadata
    | DocxRoundtripNotebookMetadata
    | IndesignNotebookMetadata
    | BiblicaNotebookMetadata
    | MaculaNotebookMetadata;

export type ProcessedNotebookMetadataByImporter = {
    markdown: MarkdownNotebookMetadata;
    subtitles: SubtitlesNotebookMetadata;
    plaintext: PlaintextNotebookMetadata;
    spreadsheet: SpreadsheetNotebookMetadata;
    "smart-segmenter": SmartSegmenterNotebookMetadata;
    audio: AudioNotebookMetadata;
    tms: TmsNotebookMetadata;
    pdf: PdfNotebookMetadata;
    obs: ObsNotebookMetadata;
    paratext: ParatextNotebookMetadata;
    ebibleCorpus: EbibleCorpusNotebookMetadata;
    usfm: UsfmNotebookMetadata;
    "usfm-experimental": UsfmExperimentalNotebookMetadata;
    docx: DocxNotebookMetadata;
    "docx-roundtrip": DocxRoundtripNotebookMetadata;
    indesign: IndesignNotebookMetadata;
    biblica: BiblicaNotebookMetadata;
    macula: MaculaNotebookMetadata;
};

