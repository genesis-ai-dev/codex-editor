import Papa from 'papaparse';
import { ParsedSpreadsheet, SpreadsheetColumn, SpreadsheetRow } from './types';

/**
 * Split CSV/TSV content into logical rows, respecting quoted newlines.
 * A newline inside double-quoted content is part of the field, not a row break.
 * Exported for use by the spreadsheet exporter when doing round-trip export.
 */
export function splitCSVIntoLogicalRows(content: string): string[] {
    const rows: string[] = [];
    let current = '';
    let inQuotes = false;
    let i = 0;

    while (i < content.length) {
        const char = content[i];
        const nextChar = content[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                current += '"';
                i += 2;
            } else {
                inQuotes = !inQuotes;
                current += char;
                i++;
            }
        } else if ((char === '\n' || (char === '\r' && nextChar === '\n')) && !inQuotes) {
            if (current.trim().length > 0) {
                rows.push(current);
            }
            current = '';
            if (char === '\r' && nextChar === '\n') i += 2;
            else i++;
        } else if (char !== '\r' || inQuotes) {
            current += char;
            i++;
        } else {
            i++;
        }
    }

    if (current.trim().length > 0) {
        rows.push(current);
    }
    return rows;
}

/**
 * Get sample values from a column (first few non-empty values)
 */
function getSampleValues(rows: SpreadsheetRow[], columnIndex: number, maxSamples: number = 3): string[] {
    const samples: string[] = [];

    for (const row of rows) {
        const value = row[columnIndex];
        if (value && value.trim() && samples.length < maxSamples) {
            samples.push(value.trim());
        }
    }

    return samples;
}

/**
 * Parse a CSV/TSV file into structured data using PapaParse
 */
export async function parseSpreadsheetFile(file: File): Promise<ParsedSpreadsheet> {
    const content = await file.text();

    if (!content.trim()) {
        throw new Error('File is empty');
    }

    const result = Papa.parse<string[]>(content, {
        header: false,
        skipEmptyLines: true,
        dynamicTyping: false,
    });

    if (result.errors.length > 0 && result.data.length === 0) {
        throw new Error(`CSV parse error: ${result.errors[0].message}`);
    }

    const allRows = result.data;
    if (allRows.length === 0) {
        throw new Error('No data found in file');
    }

    const delimiter = result.meta.delimiter;

    const firstLine = allRows[0];
    const hasHeader = firstLine.some(value =>
        isNaN(Number(value)) &&
        value.length > 0 &&
        /^[a-zA-Z][a-zA-Z0-9_\s]*$/.test(value)
    );

    const headers = hasHeader ? firstLine : firstLine.map((_, i) => `Column ${i + 1}`);
    const dataRows = hasHeader ? allRows.slice(1) : allRows;

    if (dataRows.length === 0) {
        throw new Error('No data rows found');
    }

    const expectedColumns = headers.length;
    const normalizedRows: SpreadsheetRow[] = dataRows.map(row => {
        const normalizedRow: SpreadsheetRow = {};
        for (let i = 0; i < expectedColumns; i++) {
            normalizedRow[i] = (row[i] || '').trim();
        }
        return normalizedRow;
    });

    const columns: SpreadsheetColumn[] = headers.map((name, index) => ({
        index,
        name: name.trim(),
        sampleValues: getSampleValues(normalizedRows, index)
    }));

    return {
        columns,
        rows: normalizedRows,
        delimiter,
        filename: file.name.replace(/\.[^/.]+$/, '')
    };
}

/**
 * Validate that a file is a supported spreadsheet format
 */
export function validateSpreadsheetFile(file: File): { isValid: boolean; errors: string[]; } {
    const errors: string[] = [];

    // Check file extension
    const extension = file.name.toLowerCase().split('.').pop();
    if (!['csv', 'tsv'].includes(extension || '')) {
        errors.push('File must be a .csv or .tsv file');
    }

    // Check file size (max 50MB)
    if (file.size > 50 * 1024 * 1024) {
        errors.push('File is too large (maximum 50MB)');
    }

    // Check MIME type if available
    if (file.type && !['text/csv', 'text/tab-separated-values', 'application/csv', 'text/plain'].includes(file.type)) {
        errors.push('Invalid file type');
    }

    return {
        isValid: errors.length === 0,
        errors
    };
} 