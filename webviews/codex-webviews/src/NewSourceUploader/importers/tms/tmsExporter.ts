/**
 * TMS (Translation Memory System) Exporter for Round-Trip Functionality
 * Supports both TMX and XLIFF formats
 * Replaces target segments with translated content from Codex cells
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
    codexCells: Array<{
        kind: number;
        value: string;
        metadata: any;
    }>,
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

        // Collect translations from cells
        const translationMap = collectTranslations(codexCells);
        console.log(`[TMS Exporter] Collected ${translationMap.size} translations`);

        // Replace content based on file type
        let updatedContent: string;
        if (fileType === 'tmx') {
            updatedContent = replaceTmxTargets(originalContent, translationMap, exportConfig);
        } else {
            updatedContent = replaceXliffTargets(originalContent, translationMap, exportConfig);
        }

        console.log('[TMS Exporter] Updated content with translations');

        // Validate if requested
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

/**
 * Collect translations from Codex cells organized by segment index or unit ID
 */
function collectTranslations(
    codexCells: Array<{ kind: number; value: string; metadata: any; }>
): Map<string, string> {
    const translations = new Map<string, string>();

    console.log(`[TMS Exporter] Processing ${codexCells.length} cells for translations`);

    // Track sequential translation index (only counting cells with translations)
    let translationIndex = 0;

    for (let i = 0; i < codexCells.length; i++) {
        const cell = codexCells[i];
        const meta = cell.metadata;

        // Log cell info for debugging
        console.log(`[TMS Exporter] Cell ${i}: kind=${cell.kind}, unitId=${meta?.unitId}, segmentIndex=${meta?.data?.segmentIndex}`);

        // Only process text cells (kind === 2)
        if (cell.kind !== 2) {
            console.log(`[TMS Exporter] Skipping cell ${i} - not a text cell`);
            continue;
        }

        // Get translated content (strip HTML tags)
        const translated = removeHtmlTags(cell.value).trim();
        if (!translated) {
            console.log(`[TMS Exporter] Skipping cell ${i} - no translated content`);
            continue;
        }

        // Try to get unit identifier
        // Priority: unitId > verse reference > sequential translation index
        let identifier: string | null = null;

        if (meta?.unitId) {
            identifier = meta.unitId;
        } else if (meta?.bookCode && meta?.chapter && meta?.verse) {
            // Bible verse reference
            identifier = `${meta.bookCode} ${meta.chapter}:${meta.verse}`;
        } else {
            // Use sequential translation index for non-Bible TMS files
            // This ensures translations align with TUs even if cells are skipped
            identifier = `segment-${translationIndex}`;
        }

        if (identifier) {
            translations.set(identifier, translated);
            console.log(`[TMS Exporter] ✓ Collected translation for "${identifier}": "${translated.substring(0, 50)}..."`);
            translationIndex++; // Increment only when we actually collect a translation
        } else {
            console.warn(`[TMS Exporter] ⚠ Cell ${i} has no identifier!`);
        }
    }

    console.log(`[TMS Exporter] Collected ${translations.size} translations total`);
    console.log(`[TMS Exporter] Translation IDs:`, Array.from(translations.keys()).slice(0, 10));

    return translations;
}

/**
 * Remove HTML tags from content
 */
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

/**
 * Replace target segments in TMX format
 * TMX format: <tuv xml:lang="target"><seg>content</seg></tuv>
 */
function replaceTmxTargets(
    tmxContent: string,
    translations: Map<string, string>,
    config: TmsExportConfig
): string {
    console.log('[TMS Exporter] Starting TMX target replacement');

    let result = tmxContent;
    let replacementCount = 0;
    let unitIndex = 0;

    // Pattern to match translation units with their ID
    const tuPattern = /<tu([^>]*)>([\s\S]*?)<\/tu>/g;

    result = result.replace(tuPattern, (match, tuAttributes, tuContent) => {
        // Extract ID from attributes if available
        const idMatch = tuAttributes.match(/tuid="([^"]*)"/);
        const unitId = idMatch ? idMatch[1] : `unit-${unitIndex}`;

        // Try to get translation by different identifiers
        let translation = translations.get(unitId)
            || translations.get(`segment-${unitIndex}`)
            || translations.get(`cell-${unitIndex}`);

        unitIndex++;

        if (!translation) {
            console.log(`[TMS Exporter] No translation for unit ${unitId}, keeping original`);
            return match;
        }

        // Find and replace the target <seg> within target language <tuv>
        // We need to find the second tuv (target language)
        const tuvPattern = /<tuv([^>]*)>([\s\S]*?)<\/tuv>/g;
        let tuvCount = 0;

        const updatedContent = tuContent.replace(tuvPattern, (tuvMatch: string, tuvAttrs: string, tuvContent: string) => {
            tuvCount++;

            // Skip first tuv (source), replace second tuv (target)
            if (tuvCount === 2) {
                // Replace the <seg> content
                const segPattern = /<seg>([\s\S]*?)<\/seg>/;
                const updatedTuv = tuvContent.replace(segPattern, `<seg>${escapeXml(translation!)}</seg>`);

                console.log(`[TMS Exporter] ✓ Replaced target in unit ${unitId}`);
                replacementCount++;

                return `<tuv${tuvAttrs}>${updatedTuv}</tuv>`;
            }

            return tuvMatch;
        });

        return `<tu${tuAttributes}>${updatedContent}</tu>`;
    });

    console.log(`[TMS Exporter] TMX replacement complete: ${replacementCount} targets updated`);
    return result;
}

/**
 * Replace target segments in XLIFF format
 * XLIFF format: <target>content</target>
 */
function replaceXliffTargets(
    xliffContent: string,
    translations: Map<string, string>,
    config: TmsExportConfig
): string {
    console.log('[TMS Exporter] Starting XLIFF target replacement');

    let result = xliffContent;
    let replacementCount = 0;
    let unitIndex = 0;

    // Pattern to match trans-unit or translation-unit elements
    const unitPattern = /<(trans-unit|translation-unit)([^>]*)>([\s\S]*?)<\/\1>/g;

    result = result.replace(unitPattern, (match, tagName, unitAttributes, unitContent) => {
        // Extract ID from attributes
        const idMatch = unitAttributes.match(/id="([^"]*)"/);
        const unitId = idMatch ? idMatch[1] : `unit-${unitIndex}`;

        // Try to get translation by different identifiers
        let translation = translations.get(unitId)
            || translations.get(`segment-${unitIndex}`)
            || translations.get(`cell-${unitIndex}`);

        unitIndex++;

        if (!translation) {
            console.log(`[TMS Exporter] No translation for unit ${unitId}, keeping original`);
            return match;
        }

        // Replace the <target> content
        const targetPattern = /<target([^>]*)>([\s\S]*?)<\/target>/;
        const targetMatch = unitContent.match(targetPattern);

        if (targetMatch) {
            const targetAttributes = targetMatch[1];
            const updatedContent = unitContent.replace(
                targetPattern,
                `<target${targetAttributes}>${escapeXml(translation)}</target>`
            );

            console.log(`[TMS Exporter] ✓ Replaced target in unit ${unitId}`);
            replacementCount++;

            return `<${tagName}${unitAttributes}>${updatedContent}</${tagName}>`;
        } else {
            // No target element exists, add one
            const sourcePattern = /(<source[^>]*>[\s\S]*?<\/source>)/;
            const updatedContent = unitContent.replace(
                sourcePattern,
                `$1\n        <target>${escapeXml(translation)}</target>`
            );

            console.log(`[TMS Exporter] ✓ Added target to unit ${unitId}`);
            replacementCount++;

            return `<${tagName}${unitAttributes}>${updatedContent}</${tagName}>`;
        }
    });

    console.log(`[TMS Exporter] XLIFF replacement complete: ${replacementCount} targets updated`);
    return result;
}

/**
 * Escape XML special characters
 */
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
export function validateXml(content: string, fileType: 'tmx' | 'xliff'): {
    isValid: boolean;
    warnings: string[];
} {
    const warnings: string[] = [];

    // Check if starts with XML declaration
    if (!content.trim().startsWith('<?xml')) {
        warnings.push('XML should start with <?xml declaration');
    }

    // Check for proper root element
    if (fileType === 'tmx') {
        if (!content.includes('<tmx') && !content.includes('<TMX')) {
            warnings.push('TMX file should have <tmx> root element');
        }
    } else {
        if (!content.includes('<xliff') && !content.includes('<XLIFF')) {
            warnings.push('XLIFF file should have <xliff> root element');
        }
    }

    // Basic XML structure check (balanced tags)
    const openTags = content.match(/<[^\/][^>]*>/g) || [];
    const closeTags = content.match(/<\/[^>]+>/g) || [];

    // This is a simplified check - just warn if counts are very different
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
    } else if (lowerContent.includes('<xliff')) {
        return 'xliff';
    }

    // Default to TMX if can't detect
    console.warn('[TMS Exporter] Could not detect file type, defaulting to TMX');
    return 'tmx';
}

