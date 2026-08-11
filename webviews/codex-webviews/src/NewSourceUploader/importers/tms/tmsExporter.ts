/**
 * TMS (Translation Memory System) Exporter for Round-Trip Functionality
 * Supports both TMX and XLIFF formats
 * Replaces target segments with translated content from Codex cells.
 *
 * Hidden/deleted/merged cells are left unchanged in the original file
 * (treated as untranslated — their TUs stay with the original target text).
 */

export interface TmsExportConfig {
    preserveFormatting: boolean;
    validateOutput: boolean;
    encoding: string;
}

export class TmsExportError extends Error {
    constructor(message: string, public config?: TmsExportConfig) {
        super(message);
        this.name = 'TmsExportError';
    }
}

type CodexCellLike = {
    kind: number;
    value: string;
    metadata?: {
        type?: string;
        unitId?: string | number;
        bookCode?: string;
        chapter?: string | number;
        verse?: string | number;
        sourceLanguage?: string;
        targetLanguage?: string;
        data?: {
            merged?: boolean;
            deleted?: boolean;
            hidden?: boolean;
            segmentIndex?: number;
        };
    };
};

type TranslationEntry = {
    text: string;
    targetLanguage?: string;
};

/**
 * Export TMS file (TMX or XLIFF) with translations
 *
 * @param originalContent - Original TMX/XLIFF content string
 * @param codexCells - Array of Codex cells with translations
 * @param fileType - Type of file ('tmx' or 'xliff')
 * @param config - Export configuration
 * @returns Updated TMX/XLIFF content string
 */
export async function exportTmsWithTranslations(
    originalContent: string,
    codexCells: CodexCellLike[],
    fileType: 'tmx' | 'xliff',
    config: Partial<TmsExportConfig> = {}
): Promise<string> {
    const exportConfig: TmsExportConfig = {
        preserveFormatting: true,
        validateOutput: true,
        encoding: 'UTF-8',
        ...config,
    };

    try {
        console.log(`[TMS Exporter] Starting ${fileType.toUpperCase()} export...`);

        const translations = collectTranslations(codexCells);
        console.log(`[TMS Exporter] Collected ${translations.size} translations`);

        let updatedContent: string;
        if (fileType === 'tmx') {
            updatedContent = replaceTmxTargets(originalContent, translations);
        } else {
            updatedContent = replaceXliffTargets(originalContent, translations);
        }

        console.log('[TMS Exporter] Updated content with translations');

        if (exportConfig.validateOutput) {
            const validation = validateXml(updatedContent, fileType);
            if (!validation.isValid) {
                console.warn('[TMS Exporter] Validation warnings:', validation.warnings);
            }
        }

        console.log('[TMS Exporter] Export complete');
        return updatedContent;
    } catch (error) {
        console.error('[TMS Exporter] Error:', error);
        throw new TmsExportError(
            `Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            exportConfig
        );
    }
}

function isInactiveCell(cell: CodexCellLike): boolean {
    const data = cell.metadata?.data;
    return !!(data?.merged || data?.deleted || data?.hidden);
}

function isMilestoneCell(cell: CodexCellLike): boolean {
    return cell.metadata?.type === 'milestone';
}

/**
 * Collect translations from Codex cells organized by segment index or unit ID.
 * Inactive (hidden/deleted/merged) cells are skipped so their original targets are preserved.
 */
function collectTranslations(codexCells: CodexCellLike[]): Map<string, TranslationEntry> {
    const translations = new Map<string, TranslationEntry>();

    console.log(`[TMS Exporter] Processing ${codexCells.length} cells for translations`);

    // Sequential index for cells that lack unitId (must stay aligned with TU order fallbacks)
    let translationIndex = 0;

    for (let i = 0; i < codexCells.length; i++) {
        const cell = codexCells[i];
        const meta = cell.metadata;

        if (cell.kind !== 2 || isMilestoneCell(cell)) {
            continue;
        }

        // Leave original TU content unchanged for inactive cells
        if (isInactiveCell(cell)) {
            console.log(
                `[TMS Exporter] Skipping inactive cell unitId=${meta?.unitId} (keep original target)`
            );
            continue;
        }

        const translated = removeHtmlTags(cell.value).trim();
        if (!translated) {
            continue;
        }

        const unitId =
            meta?.unitId !== undefined && meta?.unitId !== null && String(meta.unitId).length > 0
                ? String(meta.unitId)
                : null;

        let identifier: string | null = null;
        if (unitId) {
            identifier = unitId;
        } else if (meta?.bookCode && meta?.chapter && meta?.verse) {
            identifier = `${meta.bookCode} ${meta.chapter}:${meta.verse}`;
        } else {
            identifier = `segment-${translationIndex}`;
        }

        translations.set(identifier, {
            text: translated,
            targetLanguage: meta?.targetLanguage ? String(meta.targetLanguage) : undefined,
        });
        translationIndex++;
    }

    console.log(`[TMS Exporter] Collected ${translations.size} translations total`);
    console.log(`[TMS Exporter] Translation IDs:`, Array.from(translations.keys()).slice(0, 10));

    return translations;
}

function removeHtmlTags(html: string): string {
    return html
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .trim();
}

function lookupTranslation(
    translations: Map<string, TranslationEntry>,
    unitId: string,
    unitIndex: number
): TranslationEntry | undefined {
    return (
        translations.get(unitId) ||
        translations.get(`segment-${unitIndex}`) ||
        translations.get(`cell-${unitIndex}`)
    );
}

function langsMatch(a: string | undefined, b: string | undefined): boolean {
    if (!a || !b) return false;
    return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Replace target segments in TMX format.
 * Prefers the <tuv> whose xml:lang matches the cell's targetLanguage; falls back to the 2nd tuv.
 * Units without a collected translation (including hidden cells) keep their original content.
 */
function replaceTmxTargets(
    tmxContent: string,
    translations: Map<string, TranslationEntry>
): string {
    console.log('[TMS Exporter] Starting TMX target replacement');

    let replacementCount = 0;
    let unitIndex = 0;

    const tuPattern = /<tu([^>]*)>([\s\S]*?)<\/tu>/g;

    const result = tmxContent.replace(tuPattern, (match, tuAttributes, tuContent) => {
        const idMatch = tuAttributes.match(/tuid\s*=\s*"([^"]*)"/i);
        // Match importer fallback: unit-${n} is 1-based when tuid is absent
        const unitId = idMatch ? idMatch[1] : `unit-${unitIndex + 1}`;
        const currentIndex = unitIndex;
        unitIndex++;

        const entry = lookupTranslation(translations, unitId, currentIndex);
        if (!entry) {
            console.log(`[TMS Exporter] No translation for unit ${unitId}, keeping original`);
            return match;
        }

        const tuvPattern = /<tuv([^>]*)>([\s\S]*?)<\/tuv>/g;
        const tuvs: Array<{ full: string; attrs: string; content: string; lang: string; }> = [];
        let tuvMatch: RegExpExecArray | null;
        while ((tuvMatch = tuvPattern.exec(tuContent)) !== null) {
            const attrs = tuvMatch[1];
            const langMatch = attrs.match(/(?:xml:)?lang\s*=\s*"([^"]*)"/i);
            tuvs.push({
                full: tuvMatch[0],
                attrs,
                content: tuvMatch[2],
                lang: langMatch?.[1] ?? '',
            });
        }

        if (tuvs.length === 0) {
            return match;
        }

        let targetTuvIndex = -1;
        if (entry.targetLanguage) {
            targetTuvIndex = tuvs.findIndex((tuv) => langsMatch(tuv.lang, entry.targetLanguage));
        }
        // Fall back to second tuv (legacy behaviour) when lang match fails or is absent
        if (targetTuvIndex < 0) {
            targetTuvIndex = tuvs.length >= 2 ? 1 : 0;
        }

        const targetTuv = tuvs[targetTuvIndex];
        const segPattern = /<seg>([\s\S]*?)<\/seg>/;
        if (!segPattern.test(targetTuv.content)) {
            console.warn(`[TMS Exporter] No <seg> in target tuv for unit ${unitId}`);
            return match;
        }

        const updatedTuvContent = targetTuv.content.replace(
            segPattern,
            `<seg>${escapeXml(entry.text)}</seg>`
        );
        const updatedTuv = `<tuv${targetTuv.attrs}>${updatedTuvContent}</tuv>`;
        const updatedTuContent = tuContent.replace(targetTuv.full, updatedTuv);

        replacementCount++;
        console.log(`[TMS Exporter] ✓ Replaced target in unit ${unitId}`);
        return `<tu${tuAttributes}>${updatedTuContent}</tu>`;
    });

    console.log(`[TMS Exporter] TMX replacement complete: ${replacementCount} targets updated`);
    return result;
}

/**
 * Replace target segments in XLIFF format.
 * Units without a collected translation (including hidden cells) keep their original content.
 */
function replaceXliffTargets(
    xliffContent: string,
    translations: Map<string, TranslationEntry>
): string {
    console.log('[TMS Exporter] Starting XLIFF target replacement');

    let replacementCount = 0;
    let unitIndex = 0;

    const unitPattern = /<(trans-unit|translation-unit)([^>]*)>([\s\S]*?)<\/\1>/g;

    const result = xliffContent.replace(unitPattern, (match, tagName, unitAttributes, unitContent) => {
        const idMatch = unitAttributes.match(/id\s*=\s*"([^"]*)"/i);
        const unitId = idMatch ? idMatch[1] : `unit-${unitIndex + 1}`;
        const currentIndex = unitIndex;
        unitIndex++;

        const entry = lookupTranslation(translations, unitId, currentIndex);
        if (!entry) {
            console.log(`[TMS Exporter] No translation for unit ${unitId}, keeping original`);
            return match;
        }

        const targetPattern = /<target([^>]*)>([\s\S]*?)<\/target>/;
        const targetMatch = unitContent.match(targetPattern);

        if (targetMatch) {
            const targetAttributes = targetMatch[1];
            const updatedContent = unitContent.replace(
                targetPattern,
                `<target${targetAttributes}>${escapeXml(entry.text)}</target>`
            );

            replacementCount++;
            console.log(`[TMS Exporter] ✓ Replaced target in unit ${unitId}`);
            return `<${tagName}${unitAttributes}>${updatedContent}</${tagName}>`;
        }

        const sourcePattern = /(<source[^>]*>[\s\S]*?<\/source>)/;
        const updatedContent = unitContent.replace(
            sourcePattern,
            `$1\n        <target>${escapeXml(entry.text)}</target>`
        );

        replacementCount++;
        console.log(`[TMS Exporter] ✓ Added target to unit ${unitId}`);
        return `<${tagName}${unitAttributes}>${updatedContent}</${tagName}>`;
    });

    console.log(`[TMS Exporter] XLIFF replacement complete: ${replacementCount} targets updated`);
    return result;
}

function escapeXml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Validate XML structure
 */
export function validateXml(
    content: string,
    fileType: 'tmx' | 'xliff'
): {
    isValid: boolean;
    warnings: string[];
} {
    const warnings: string[] = [];

    if (!content.trim().startsWith('<?xml')) {
        warnings.push('XML should start with <?xml declaration');
    }

    if (fileType === 'tmx') {
        if (!content.includes('<tmx') && !content.includes('<TMX')) {
            warnings.push('TMX file should have <tmx> root element');
        }
    } else if (!content.includes('<xliff') && !content.includes('<XLIFF')) {
        warnings.push('XLIFF file should have <xliff> root element');
    }

    const openTags = content.match(/<[^/!][^>]*>/g) || [];
    const closeTags = content.match(/<\/[^>]+>/g) || [];

    if (Math.abs(openTags.length - closeTags.length) > 5) {
        warnings.push('Possible unbalanced XML tags detected');
    }

    return {
        isValid: warnings.length === 0,
        warnings,
    };
}

/**
 * Detect file type from content
 */
export function detectTmsFileType(content: string): 'tmx' | 'xliff' {
    const lowerContent = content.toLowerCase();

    if (lowerContent.includes('<tmx')) {
        return 'tmx';
    }
    if (lowerContent.includes('<xliff')) {
        return 'xliff';
    }

    console.warn('[TMS Exporter] Could not detect file type, defaulting to TMX');
    return 'tmx';
}
