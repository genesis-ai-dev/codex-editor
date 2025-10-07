import type * as vscode from "vscode";

// Interface for the cell label data
export interface CellLabelData {
    cellId: string;
    startTime: string;
    endTime: string;
    character?: string;
    dialogue?: string;
    newLabel: string;
    currentLabel?: string;
    matched: boolean;
    sourceFileUri?: string; // Track which file this label belongs to
}

// Interface for the imported Excel/CSV format
export interface ImportedRow {
    index?: string;
    type?: string;
    start?: string;
    end?: string;
    character?: string;
    dialogue?: string;
    CHARACTER?: string;
    DIALOGUE?: string;
    [key: string]: any; // Allow any string keys for dynamic column names
}

// Extended cell metadata interface to include cellLabel
export interface CellMetadata {
    type?: string;
    id?: string;
    edits?: Array<{
        cellValue: string;
        timestamp: number;
        type: string;
        author?: string;
    }>;
    cellLabel?: string;
}

// Interface for the file data returned from fileReaders
export interface FileData {
    uri: vscode.Uri;
    cells: Array<{
        value: string;
        metadata?: CellMetadata;
    }>;
}

// Options for web view content
export interface WebviewContentOptions {
    importSource?: string;
}
