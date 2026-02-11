import { ParsedSpreadsheet, SpreadsheetColumn, SpreadsheetRow } from './types';

/**
 * Detect the delimiter used in a CSV/TSV file
 */
function detectDelimiter(content: string): string {
    const lines = content.split('\n').slice(0, 5); // Check first 5 lines
    const delimiters = [',', '\t', ';', '|'];
    const counts: { [key: string]: number; } = {};

    for (const delimiter of delimiters) {
        counts[delimiter] = 0;
        for (const line of lines) {
            if (line.trim()) {
                counts[delimiter] += (line.match(new RegExp(`\\${delimiter}`, 'g')) || []).length;
            }
        }
    }

    // Return the delimiter with the highest average count per line
    return delimiters.reduce((best, current) =>
        counts[current] > counts[best] ? current : best
    );
}

/**
 * Parse CSV/TSV content with proper quote handling
 */
function parseCSVLine(line: string, delimiter: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    let i = 0;

    while (i < line.length) {
        const char = line[i];
        const nextChar = line[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                // Escaped quote
                current += '"';
                i += 2;
            } else {
                // Toggle quote state
                inQuotes = !inQuotes;
                i++;
            }
        } else if (char === delimiter && !inQuotes) {
            // Field separator
            result.push(current.trim());
            current = '';
            i++;
        } else {
            current += char;
            i++;
        }
    }

    result.push(current.trim());
    return result;
}

/**
 * Clean and validate cell content
 */
function cleanCellContent(content: string): string {
    return content
        .replace(/^"|"$/g, '') // Remove surrounding quotes
        .replace(/""/g, '"') // Unescape quotes
        .trim();
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
 * Parse a CSV/TSV file into structured data
 */
export async function parseSpreadsheetFile(file: File): Promise<ParsedSpreadsheet> {
    const content = await file.text();

    if (!content.trim()) {
        throw new Error('File is empty');
    }

    const delimiter = detectDelimiter(content);
    const allLines = content.split('\n').map(line => line.trim()).filter(line => line);

    if (allLines.length === 0) {
        throw new Error('No data found in file');
    }

    // Parse all lines
    const parsedLines = allLines.map(line => parseCSVLine(line, delimiter));

    // Determine if first line is header by checking if values look like column names
    const firstLine = parsedLines[0];
    const hasHeader = firstLine.some(value =>
        isNaN(Number(value)) &&
        value.length > 0 &&
        /^[a-zA-Z][a-zA-Z0-9_\s]*$/.test(value)
    );

    // Extract headers and data rows
    const headers = hasHeader ? firstLine : firstLine.map((_, i) => `Column ${i + 1}`);
    const dataRows = hasHeader ? parsedLines.slice(1) : parsedLines;

    if (dataRows.length === 0) {
        throw new Error('No data rows found');
    }

    // Ensure all rows have the same number of columns
    const expectedColumns = headers.length;
    const normalizedRows: SpreadsheetRow[] = dataRows.map(row => {
        const normalizedRow: SpreadsheetRow = {};
        for (let i = 0; i < expectedColumns; i++) {
            normalizedRow[i] = cleanCellContent(row[i] || '');
        }
        return normalizedRow;
    });

    // Create column metadata
    const columns: SpreadsheetColumn[] = headers.map((name, index) => ({
        index,
        name: cleanCellContent(name),
        sampleValues: getSampleValues(normalizedRows, index)
    }));

    return {
        columns,
        rows: normalizedRows,
        delimiter,
        filename: file.name.replace(/\.[^/.]+$/, '') // Remove extension
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