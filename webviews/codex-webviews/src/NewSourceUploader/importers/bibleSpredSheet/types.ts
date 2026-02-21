export interface SpreadsheetColumn {
    index: number;
    name: string;
    sampleValues: string[];
}

export interface ColumnMapping {
    globalReferencesColumn?: number;
    sourceColumn?: number;
    targetColumn?: number;
}

export interface SpreadsheetRow {
    [columnIndex: number]: string;
}

export interface ParsedSpreadsheet {
    columns: SpreadsheetColumn[];
    rows: SpreadsheetRow[];
    delimiter: string;
    filename: string;
}

export interface SpreadsheetCell {
    id: string;
    content: string;
    sourceData?: any;
    rowIndex: number;
}

export type ColumnType = 'globalReferences' | 'source' | 'target' | 'attachments' | 'unused';

export interface ColumnTypeSelection {
    [columnIndex: number]: ColumnType;
} 