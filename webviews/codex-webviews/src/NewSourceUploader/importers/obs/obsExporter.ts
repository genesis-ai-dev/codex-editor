/**
 * OBS (Open Bible Stories) Markdown Exporter for Round-Trip Functionality
 * Reconstructs markdown files with translated content while preserving structure
 * Similar approach to DOCX/RTF exporters
 */

/**
 * Type definitions for OBS content
 */
interface ObsImage {
    src: string;
    alt: string;
    title?: string;
}

interface ObsSegment {
    type: 'story' | 'title' | 'intro';
    text: string;
    html: string;
    images: ObsImage[];
}

interface ObsStory {
    storyNumber: number;
    title: string;
    segments: ObsSegment[];
    sourceReference: string;
}

export interface ObsExportConfig {
    preserveImageReferences: boolean;
    includeBlankLines: boolean;
    validateOutput: boolean;
}

export class ObsExportError extends Error {
    constructor(message: string, public config?: ObsExportConfig) {
        super(message);
        this.name = 'ObsExportError';
    }
}

/**
 * Export OBS markdown with translations
 * 
 * @param codexCells - Array of Codex cells with translations
 * @param obsStory - Parsed ObsStory structure (from metadata)
 * @param config - Export configuration
 * @returns Markdown content string
 */
export async function exportObsWithTranslations(
    codexCells: Array<{
        kind: number;
        value: string;
        metadata: any;
    }>,
    obsStory: ObsStory | string,
    config: Partial<ObsExportConfig> = {}
): Promise<string> {
    const exportConfig: ObsExportConfig = {
        preserveImageReferences: true,
        includeBlankLines: true,
        validateOutput: true,
        ...config,
    };

    try {
        console.log('[OBS Exporter] Starting export...');

        // Parse obsStory if it's a string
        const story: ObsStory = typeof obsStory === 'string'
            ? JSON.parse(obsStory)
            : obsStory;

        console.log(`[OBS Exporter] Exporting story: ${story.title} (Story ${story.storyNumber})`);
        console.log(`[OBS Exporter] Original segments: ${story.segments.length}`);

        // Collect translations from cells, organized by segment
        const translationMap = collectTranslations(codexCells);
        console.log(`[OBS Exporter] Collected ${translationMap.size} translations`);

        // Reconstruct markdown
        const markdown = reconstructMarkdown(
            story,
            translationMap,
            exportConfig
        );
        console.log('[OBS Exporter] Reconstructed markdown');

        // Validate if requested
        if (exportConfig.validateOutput) {
            const validation = validateMarkdown(markdown);
            if (!validation.isValid) {
                console.warn('[OBS Exporter] Validation warnings:', validation.warnings);
            }
        }

        console.log('[OBS Exporter] Export complete');
        return markdown;

    } catch (error) {
        console.error('[OBS Exporter] Error:', error);
        throw new ObsExportError(
            `Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            exportConfig
        );
    }
}

/**
 * Collect translations from Codex cells organized by segment index
 */
function collectTranslations(
    codexCells: Array<{ kind: number; value: string; metadata: any; }>
): Map<number, string> {
    const translations = new Map<number, string>();

    console.log(`[OBS Exporter] Processing ${codexCells.length} cells for translations`);

    for (let i = 0; i < codexCells.length; i++) {
        const cell = codexCells[i];
        const meta = cell.metadata;

        // Log cell info for debugging
        console.log(`[OBS Exporter] Cell ${i}: kind=${cell.kind}, segmentType=${meta?.segmentType}, segmentIndex=${meta?.segmentIndex}`);

        // Only process text cells (kind === 2) with segmentType === 'text'
        if (cell.kind !== 2) {
            console.log(`[OBS Exporter] Skipping cell ${i} - not a text cell`);
            continue;
        }

        if (meta?.segmentType === 'image') {
            console.log(`[OBS Exporter] Skipping cell ${i} - image cell (images are preserved)`);
            continue;
        }

        // Get translated content (strip HTML tags)
        const translated = removeHtmlTags(cell.value).trim();
        if (!translated) {
            console.log(`[OBS Exporter] Skipping cell ${i} - no translated content`);
            continue;
        }

        // Get segment index
        const segmentIndex = meta?.segmentIndex;

        if (segmentIndex !== undefined) {
            translations.set(segmentIndex, translated);
            console.log(`[OBS Exporter] ✓ Collected translation for segment ${segmentIndex}: "${translated.substring(0, 50)}..."`);
        } else {
            console.warn(`[OBS Exporter] ⚠ Cell ${i} has no segmentIndex!`);
        }
    }

    console.log(`[OBS Exporter] Collected ${translations.size} translations total`);
    console.log(`[OBS Exporter] Segment indices:`, Array.from(translations.keys()));

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
        .trim();
}

/**
 * Reconstruct markdown from story structure with translations
 */
function reconstructMarkdown(
    story: ObsStory,
    translations: Map<number, string>,
    config: ObsExportConfig
): string {
    let markdown = '';

    // Add title
    markdown += `# ${story.title}\n`;
    if (config.includeBlankLines) {
        markdown += '\n';
    }

    // Process each segment
    for (let i = 0; i < story.segments.length; i++) {
        const segment = story.segments[i];

        console.log(`[OBS Exporter] Processing segment ${i}/${story.segments.length}`);

        // Add images first (if configured to preserve them)
        if (config.preserveImageReferences && segment.images.length > 0) {
            for (const image of segment.images) {
                const alt = image.alt || 'OBS Image';
                markdown += `![${alt}](${image.src})\n`;
            }
            if (config.includeBlankLines) {
                markdown += '\n';
            }
        }

        // Add translated text (or original if no translation)
        const text = translations.get(i) || segment.text;
        if (text && text.trim()) {
            markdown += `${text}\n`;
            if (config.includeBlankLines) {
                markdown += '\n';
            }
        }
    }

    // Add source reference at the end
    if (story.sourceReference) {
        markdown += `_${story.sourceReference}_\n`;
    }

    return markdown;
}

/**
 * Validate exported markdown
 */
export function validateMarkdown(markdown: string): {
    isValid: boolean;
    warnings: string[];
} {
    const warnings: string[] = [];

    // Check if has title
    if (!markdown.startsWith('#')) {
        warnings.push('Markdown should start with a title (# heading)');
    }

    // Check for basic markdown structure
    const lines = markdown.split('\n');
    let hasImages = false;
    let hasText = false;

    for (const line of lines) {
        if (line.startsWith('![')) {
            hasImages = true;
        }
        if (line.trim() && !line.startsWith('#') && !line.startsWith('![') && !line.startsWith('_')) {
            hasText = true;
        }
    }

    if (!hasText) {
        warnings.push('Markdown has no text content');
    }

    return {
        isValid: warnings.length === 0,
        warnings,
    };
}

/**
 * Extract OBS story structure from cells for export
 * This is useful if the obsStory metadata is not available
 */
export function extractObsStoryFromCells(
    cells: Array<{ kind: number; value: string; metadata: any; }>
): ObsStory {
    const segments: ObsSegment[] = [];
    let title = 'Untitled Story';
    let storyNumber = 0;
    let sourceReference = '';

    // Group cells by segment
    const segmentMap = new Map<number, { text?: string; images: ObsImage[]; }>();

    for (const cell of cells) {
        if (cell.kind !== 2) continue;

        const meta = cell.metadata;
        const segmentIndex = meta?.segmentIndex ?? 0;

        if (!segmentMap.has(segmentIndex)) {
            segmentMap.set(segmentIndex, { images: [] });
        }

        const segment = segmentMap.get(segmentIndex)!;

        if (meta?.segmentType === 'text') {
            segment.text = removeHtmlTags(cell.value);
        } else if (meta?.segmentType === 'image') {
            // Extract image info from metadata or HTML
            const imgSrc = meta?.originalImageSrc || meta?.imageUrl || '';
            const imgAlt = meta?.imageAlt || 'OBS Image';
            const imgTitle = meta?.imageTitle;

            if (imgSrc) {
                segment.images.push({
                    src: imgSrc,
                    alt: imgAlt,
                    title: imgTitle,
                });
            }
        }

        // Extract story metadata from first cell
        if (storyNumber === 0 && meta?.storyNumber) {
            storyNumber = meta.storyNumber;
        }
        if (title === 'Untitled Story' && meta?.storyTitle) {
            title = meta.storyTitle;
        }
        if (!sourceReference && meta?.sourceReference) {
            sourceReference = meta.sourceReference;
        }
    }

    // Convert map to segments array
    const sortedIndices = Array.from(segmentMap.keys()).sort((a, b) => a - b);
    for (const index of sortedIndices) {
        const seg = segmentMap.get(index)!;
        const segText = seg.text || '';

        segments.push({
            type: 'story',
            text: segText,
            html: '', // Not needed for export
            images: seg.images,
        });
    }

    return {
        storyNumber,
        title,
        segments,
        sourceReference,
    };
}

