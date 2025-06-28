export interface EbibleTranslation {
    languageCode: string;
    translationId: string;
    languageName: string;
    languageNameInEnglish: string;
    dialect: string;
    homeDomain: string;
    title: string;
    description: string;
    redistributable: string;
    copyright: string;
    updateDate: string;
    publicationURL: string;
    OTbooks: string;
    OTchapters: string;
    OTverses: string;
    NTbooks: string;
    NTchapters: string;
    NTverses: string;
    DCbooks: string;
    DCchapters: string;
    DCverses: string;
    FCBHID: string;
    certified: string;
    inScript: string;
    swordName: string;
    rodCode: string;
    textDirection: string;
    downloadable: string;
    font: string;
    shortTitle: string;
    PODISBN: string;
    script: string;
    sourceDate: string;
}

/**
 * Parses CSV content into an array of translation objects
 */
export function parseTranslationsCSV(csvContent: string): EbibleTranslation[] {
    const lines = csvContent.trim().split('\n');
    if (lines.length < 2) return []; // No data or only header

    // Parse header
    const headerLine = lines[0];
    const headers = parseCSVLine(headerLine);

    // Parse data lines
    const translations: EbibleTranslation[] = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length !== headers.length) continue; // Skip malformed lines

        const translation: any = {};
        headers.forEach((header, index) => {
            translation[header] = values[index];
        });

        translations.push(translation as EbibleTranslation);
    }

    return translations;
}

/**
 * Parses a single CSV line handling quoted values
 */
function parseCSVLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                // Escaped quote
                current += '"';
                i++; // Skip next quote
            } else {
                // Toggle quote state
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            // End of field
            values.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }

    // Add last field
    values.push(current.trim());

    return values;
}

/**
 * Filters translations based on search criteria
 */
export function filterTranslations(
    translations: EbibleTranslation[],
    searchTerm: string,
    filters: {
        hasOT?: boolean;
        hasNT?: boolean;
        hasDC?: boolean;
        textDirection?: 'ltr' | 'rtl' | 'all';
        downloadable?: boolean;
    } = {}
): EbibleTranslation[] {
    return translations.filter(translation => {
        // Search term filter
        if (searchTerm) {
            const search = searchTerm.toLowerCase();
            const matchesSearch =
                translation.languageCode.toLowerCase().includes(search) ||
                translation.translationId.toLowerCase().includes(search) ||
                translation.languageName.toLowerCase().includes(search) ||
                translation.languageNameInEnglish.toLowerCase().includes(search) ||
                translation.title.toLowerCase().includes(search) ||
                translation.description.toLowerCase().includes(search) ||
                translation.shortTitle.toLowerCase().includes(search);

            if (!matchesSearch) return false;
        }

        // OT/NT/DC filters
        if (filters.hasOT && parseInt(translation.OTbooks) === 0) return false;
        if (filters.hasNT && parseInt(translation.NTbooks) === 0) return false;
        if (filters.hasDC && parseInt(translation.DCbooks) === 0) return false;

        // Text direction filter
        if (filters.textDirection && filters.textDirection !== 'all' &&
            translation.textDirection !== filters.textDirection) return false;

        // Downloadable filter
        if (filters.downloadable !== undefined) {
            const isDownloadable = translation.downloadable.toLowerCase() === 'true';
            if (filters.downloadable !== isDownloadable) return false;
        }

        return true;
    });
}

/**
 * Groups translations by language for easier navigation
 */
export function groupTranslationsByLanguage(
    translations: EbibleTranslation[]
): Map<string, EbibleTranslation[]> {
    const groups = new Map<string, EbibleTranslation[]>();

    translations.forEach(translation => {
        const key = `${translation.languageNameInEnglish} (${translation.languageCode})`;
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key)!.push(translation);
    });

    return groups;
}

/**
 * Gets statistics about a translation
 */
export function getTranslationStats(translation: EbibleTranslation) {
    const otBooks = parseInt(translation.OTbooks) || 0;
    const ntBooks = parseInt(translation.NTbooks) || 0;
    const dcBooks = parseInt(translation.DCbooks) || 0;
    const totalBooks = otBooks + ntBooks + dcBooks;

    const otVerses = parseInt(translation.OTverses) || 0;
    const ntVerses = parseInt(translation.NTverses) || 0;
    const dcVerses = parseInt(translation.DCverses) || 0;
    const totalVerses = otVerses + ntVerses + dcVerses;

    return {
        totalBooks,
        otBooks,
        ntBooks,
        dcBooks,
        totalVerses,
        otVerses,
        ntVerses,
        dcVerses,
        hasOT: otBooks > 0,
        hasNT: ntBooks > 0,
        hasDC: dcBooks > 0,
    };
} 