export type DelimitedRecord = {
    content: string;
    /** Exact record terminator from the source ("\n", "\r\n", "\r", or empty). */
    ending: string;
};

/** Split CSV/TSV into logical records without splitting newlines inside quoted fields. */
export function splitDelimitedRecords(source: string): DelimitedRecord[] {
    const records: DelimitedRecord[] = [];
    let start = 0;
    let inQuotes = false;

    for (let index = 0; index < source.length; index++) {
        const char = source[index];
        if (char === '"') {
            if (inQuotes && source[index + 1] === '"') {
                index++;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }
        if (!inQuotes && (char === '\n' || char === '\r')) {
            const ending = char === '\r' && source[index + 1] === '\n' ? '\r\n' : char;
            records.push({ content: source.slice(start, index), ending });
            if (ending === '\r\n') index++;
            start = index + 1;
        }
    }

    if (start < source.length || records.length === 0) {
        records.push({ content: source.slice(start), ending: '' });
    }
    return records;
}
