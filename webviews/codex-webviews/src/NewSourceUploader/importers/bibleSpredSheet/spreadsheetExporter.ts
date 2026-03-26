/**
 * Spreadsheet Exporter - True Round-trip Export
 * 
 * Exports codex notebooks back to CSV/TSV format with translations.
 * Uses the original file content stored during import, only replacing
 * the source column content with translations while keeping everything
 * else exactly the same.
 * 
 * Supports both spreadsheet-csv and spreadsheet-tsv importer types.
 */

export interface SpreadsheetCell {
    id: string;
    value: string;
    metadata: {
        id?: string;
        data?: {
            rowIndex?: number;
            originalRowValues?: string[];
            sourceColumnIndex?: number;
            originalContent?: string;
            globalReferences?: string[];
        };
    };
}

export interface SpreadsheetNotebookMetadata {
    delimiter?: string;
    originalFileName?: string;
    originalFileContent?: string;
    columnHeaders?: string[];
    sourceColumnIndex?: number;
    columnCount?: number;
    importerType?: string;
}

/**
 * Parse a CSV/TSV line with proper quote handling
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
                current += '"';
                i += 2;
            } else {
                inQuotes = !inQuotes;
                i++;
            }
        } else if (char === delimiter && !inQuotes) {
            result.push(current);
            current = '';
            i++;
        } else {
            current += char;
            i++;
        }
    }

    result.push(current);
    return result;
}

/**
 * Escape a field value for CSV/TSV output
 */
function escapeField(value: string, delimiter: string): string {
    if (value === null || value === undefined) return '';
    const strValue = String(value);

    const needsQuotes = strValue.includes(delimiter) ||
        strValue.includes('"') ||
        strValue.includes('\n') ||
        strValue.includes('\r');

    if (needsQuotes) {
        const escaped = strValue.replace(/"/g, '""');
        return `"${escaped}"`;
    }

    return strValue;
}

/**
 * Remove HTML tags from content (translations might have HTML)
 */
function stripHtmlTags(html: string): string {
    if (!html) return '';
    return html
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
}

/**
 * Export codex cells to spreadsheet format (CSV or TSV)
 * 
 * TRUE ROUND-TRIP EXPORT:
 * - Uses the original file content stored during import
 * - Keeps the HEADER ROW exactly as it was (no changes)
 * - Replaces ONLY the source column in DATA ROWS with translations
 * - Preserves everything else exactly as it was
 */
export function exportSpreadsheetWithTranslations(
    cells: SpreadsheetCell[],
    metadata: SpreadsheetNotebookMetadata
): string {
    const originalFileContent = metadata.originalFileContent;
    const sourceColumnIndex = metadata.sourceColumnIndex;

    // Determine delimiter from importerType or metadata
    let delimiter = metadata.delimiter || ',';
    if (metadata.importerType === 'spreadsheet-tsv') {
        delimiter = '\t';
    } else if (metadata.importerType === 'spreadsheet-csv') {
        delimiter = ',';
    }

    console.log(`[Spreadsheet Export] importerType: ${metadata.importerType}, delimiter: "${delimiter === '\t' ? 'TAB' : delimiter}"`);

    // Build a map of rowIndex -> translation
    const translationsByRow = new Map<number, string>();
    for (const cell of cells) {
        const rowIndex = cell.metadata?.data?.rowIndex;
        const translation = stripHtmlTags(cell.value || '');

        if (typeof rowIndex === 'number' && translation) {
            translationsByRow.set(rowIndex, translation);
        }
    }

    console.log(`[Spreadsheet Export] Built translation map with ${translationsByRow.size} translations`);
    console.log(`[Spreadsheet Export] originalFileContent: ${originalFileContent ? 'found' : 'missing'}, sourceColumnIndex: ${sourceColumnIndex}`);

    // If we have the original file content, do true round-trip
    if (originalFileContent) {
        // Default to column index 2 (third column, typically "Transcrição") if not specified
        const effectiveSourceColumnIndex = typeof sourceColumnIndex === 'number' ? sourceColumnIndex : 2;

        console.log(`[Spreadsheet Export] Using original file content for true round-trip export`);
        console.log(`[Spreadsheet Export] Effective source column index: ${effectiveSourceColumnIndex}`);
        console.log(`[Spreadsheet Export] Original content length: ${originalFileContent.length} chars`);

        // Remove BOM if present (UTF-8 BOM: EF BB BF)
        let cleanContent = originalFileContent;
        if (cleanContent.charCodeAt(0) === 0xFEFF) {
            cleanContent = cleanContent.substring(1);
            console.log(`[Spreadsheet Export] Removed BOM from content`);
        }

        // Handle both Unix (\n) and Windows (\r\n) line endings
        const lines = cleanContent.split(/\r?\n/);
        const outputLines: string[] = [];

        console.log(`[Spreadsheet Export] File has ${lines.length} lines`);

        // First line is ALWAYS the header - keep it EXACTLY as is
        if (lines.length > 0) {
            const headerLine = lines[0];
            // Keep header line unchanged - DO NOT parse or modify it
            outputLines.push(headerLine);
            console.log(`[Spreadsheet Export] Preserved header (${headerLine.length} chars): "${headerLine.substring(0, 100)}${headerLine.length > 100 ? '...' : ''}"`);
        }

        // Process data rows (skip first line which is header)
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];

            // Skip empty lines at the end
            if (!line.trim() && i === lines.length - 1) {
                continue;
            }

            // Skip completely empty lines
            if (!line.trim()) {
                outputLines.push(line);
                continue;
            }

            // Data row index (0-based, excluding header)
            const dataRowIndex = i - 1;

            // Check if we have a translation for this row
            const translation = translationsByRow.get(dataRowIndex);

            if (translation) {
                // Parse the line to replace the source column
                const fields = parseCSVLine(line, delimiter);

                if (effectiveSourceColumnIndex < fields.length) {
                    // Replace the source column with the translation
                    fields[effectiveSourceColumnIndex] = translation;
                }

                // Rebuild the line with proper escaping
                const outputLine = fields.map(f => escapeField(f, delimiter)).join(delimiter);
                outputLines.push(outputLine);
            } else {
                // No translation for this row - keep it exactly as is
                outputLines.push(line);
            }
        }

        console.log(`[Spreadsheet Export] Output ${outputLines.length} lines (1 header + ${outputLines.length - 1} data rows)`);
        return outputLines.join('\n');
    }

    // Fallback: reconstruct from cell metadata (for legacy imports without originalFileContent)
    console.log(`[Spreadsheet Export] Fallback: reconstructing from cell metadata`);

    const rows: string[] = [];
    const columnHeaders = metadata.columnHeaders;

    // Add header row if available
    if (columnHeaders && columnHeaders.length > 0) {
        const headerRow = columnHeaders.map(h => escapeField(h, delimiter));
        rows.push(headerRow.join(delimiter));
    }

    // Sort cells by rowIndex
    const sortedCells = [...cells].sort((a, b) => {
        const aIndex = a.metadata?.data?.rowIndex ?? 0;
        const bIndex = b.metadata?.data?.rowIndex ?? 0;
        return aIndex - bIndex;
    });

    // Build data rows
    for (const cell of sortedCells) {
        const cellData = cell.metadata?.data;
        const originalRowValues = cellData?.originalRowValues;
        const cellSourceColumnIndex = cellData?.sourceColumnIndex ?? sourceColumnIndex;
        const translation = stripHtmlTags(cell.value || '');

        if (originalRowValues && originalRowValues.length > 0) {
            const rowValues = [...originalRowValues];

            if (typeof cellSourceColumnIndex === 'number' && cellSourceColumnIndex < rowValues.length) {
                if (translation) {
                    rowValues[cellSourceColumnIndex] = translation;
                }
            }

            const escapedRow = rowValues.map(v => escapeField(v, delimiter));
            rows.push(escapedRow.join(delimiter));
        } else {
            // Minimal fallback
            const originalContent = cellData?.originalContent || '';
            const globalRefs = cellData?.globalReferences || [];

            const simpleRow: string[] = [];
            if (globalRefs.length > 0) {
                simpleRow.push(escapeField(globalRefs.join('; '), delimiter));
            }
            simpleRow.push(escapeField(translation || originalContent, delimiter));

            rows.push(simpleRow.join(delimiter));
        }
    }

    return rows.join('\n');
}

/**
 * Determine the appropriate file extension based on importer type or original file
 */
export function getSpreadsheetExtension(originalFileName: string | undefined, delimiter: string, importerType?: string): string {
    // Check importer type first
    if (importerType === 'spreadsheet-tsv') {
        return 'tsv';
    }
    if (importerType === 'spreadsheet-csv') {
        return 'csv';
    }

    // Check original filename
    if (originalFileName) {
        const ext = originalFileName.toLowerCase().split('.').pop();
        if (ext === 'csv' || ext === 'tsv') {
            return ext;
        }
    }

    // Default based on delimiter
    return delimiter === '\t' ? 'tsv' : 'csv';
}

/**
 * Determine delimiter from importer type, original file extension, or metadata
 */
export function getDelimiterFromMetadata(metadata: any): string {
    // Check importer type first
    if (metadata?.importerType === 'spreadsheet-tsv') {
        return '\t';
    }
    if (metadata?.importerType === 'spreadsheet-csv') {
        return ',';
    }

    // Check explicit delimiter in metadata
    if (metadata?.delimiter) {
        return metadata.delimiter;
    }

    // Check original filename extension
    const originalFileName = metadata?.originalFileName || '';
    if (originalFileName.toLowerCase().endsWith('.tsv')) {
        return '\t';
    }

    // Default to comma (CSV)
    return ',';
}
