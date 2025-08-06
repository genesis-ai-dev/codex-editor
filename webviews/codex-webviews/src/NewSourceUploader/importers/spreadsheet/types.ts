export interface SpreadsheetColumn {
    index: number;
    name: string;
    sampleValues: string[];
}

export interface ColumnMapping {
    idColumn?: number;
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

export type ColumnType = 'id' | 'source' | 'target' | 'unused';

export interface ColumnTypeSelection {
    [columnIndex: number]: ColumnType;
} 