/**
 * DOCX Exporter for Round-Trip Functionality
 * Reconstructs DOCX files with translated content while preserving all formatting
 * Similar approach to Biblica IDML exporter
 */

import JSZip from 'jszip';
import {
    DocxDocument,
    DocxExportConfig,
    DocxExportError,
} from './docxTypes';
import {
    extractLegacyParagraphRanges,
    extractOutermostParagraphRanges,
    stripFallbackElements,
} from './utils/ooxmlScanner';
import {
    buildRepeatedSourceAliasVariants,
    deduplicateDocxSegments,
    normalizeDocxWitness,
    resolveDocxTranslations,
    selectParagraphMappingMode,
    type ParagraphTranslation,
} from './utils/docxExportMapping';

/**
 * NOTE:
 * We intentionally avoid full XML parse + re-serialization of `word/document.xml`.
 * Some viewers (notably Apple Pages) can render the resulting file as "blank" even though
 * text is present, because the rebuild normalizes/expands the OOXML significantly.
 *
 * Instead, we do a surgical string-level replacement inside `<w:body>`:
 * - Keep the entire XML byte-for-byte unchanged except the inner text of `<w:t>` nodes
 *   in the specific paragraph indices we are translating.
 */

/**
 * Export DOCX with translations
 * 
 * @param originalFileData - Original DOCX file as ArrayBuffer
 * @param codexCells - Array of Codex cells with translations
 * @param docxDocument - Parsed DocxDocument structure (from metadata)
 * @param config - Export configuration
 * @returns ArrayBuffer of new DOCX file
 */
export async function exportDocxWithTranslations(
    originalFileData: ArrayBuffer,
    codexCells: Array<{
        kind: number;
        value: string;
        metadata: any;
    }>,
    docxDocument?: DocxDocument | string,
    config: Partial<DocxExportConfig> = {}
): Promise<ArrayBuffer> {
    const exportConfig: DocxExportConfig = {
        preserveFormatting: true,
        preserveStyles: true,
        validateOutput: true,
        strictMode: false,
        ...config,
    };

    try {
        console.log('[DOCX Exporter] Starting export...');

        // Load original DOCX
        const zip = await JSZip.loadAsync(originalFileData);
        console.log('[DOCX Exporter] Loaded original DOCX');

        // Get document.xml
        const documentXmlFile = zip.file('word/document.xml');
        if (!documentXmlFile) {
            throw new DocxExportError('document.xml not found', exportConfig);
        }

        const documentXml = await documentXmlFile.async('string');
        console.log('[DOCX Exporter] Extracted document.xml');

        // Collect translations from cells
        const { translations: translationPlans, witnesses } = collectTranslations(codexCells);
        console.log(`[DOCX Exporter] Collected ${translationPlans.size} translations`);

        // Replace content in document.xml
        const updatedXml = await replaceContentInXml(
            documentXml,
            translationPlans,
            witnesses,
            exportConfig
        );
        console.log('[DOCX Exporter] Updated document.xml with translations');

        // Update document.xml in ZIP
        zip.file('word/document.xml', updatedXml);

        // Generate new DOCX
        const newDocx = await zip.generateAsync({
            type: 'arraybuffer',
            compression: 'DEFLATE',
            compressionOptions: { level: 9 },
        });

        console.log('[DOCX Exporter] Export complete');
        return newDocx;

    } catch (error) {
        console.error('[DOCX Exporter] Error:', error);
        throw new DocxExportError(
            `Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            exportConfig
        );
    }
}

/**
 * Collect translations from Codex cells.
 *
 * Handles three cell shapes:
 *  1. Table cells  – one Codex cell maps to multiple DOCX paragraphs (paragraphIndices[]).
 *  2. Split cells  – one DOCX paragraph was split into N Codex cells (segmentIndex present).
 *     The per-segment translations are joined in order before writing to the <w:p>. Segments
 *     with no translation fall back to their original source text so untranslated portions of a
 *     partially translated paragraph are preserved rather than dropped. A paragraph whose
 *     segments are all untranslated produces no entry and is left byte-untouched.
 *  3. Normal cells – one Codex cell ↔ one DOCX paragraph (paragraphIndex only).
 */
type TranslationCollection = {
    translations: Map<number, ParagraphTranslation>;
    witnesses: Map<number, ParagraphTranslation>;
};

function collectTranslations(
    codexCells: Array<{ kind: number; value: string; metadata: any; }>
): TranslationCollection {
    console.log(`[Exporter] Processing ${codexCells.length} cells for translations`);

    // Accumulate per-paragraph segments: paragraphIndex → list of {segmentIndex, text, source}.
    // `text` is the (possibly empty) translation; `source` is the segment's original DOCX text.
    // Keeping untranslated segments (empty `text`) lets us fall back to `source` so that a
    // partially translated split paragraph preserves its untranslated portions instead of
    // dropping them.
    const segmentsByParagraph = new Map<number, Array<{
        segmentIndex: number;
        text: string;
        source: string;
        mappingVersion?: string;
    }>>();
    // Table cells bypass the segment system entirely
    const tableTranslations = new Map<number, ParagraphTranslation>();
    const tableWitnesses = new Map<number, ParagraphTranslation>();

    for (const cell of codexCells) {
        const meta = cell.metadata;

        // Skip cells that should not appear in export (same semantics as getActiveCells).
        // Includes tombstones from re-import merges — their paragraph indices
        // refer to a stale parse and must not be written back.
        if (meta?.data?.merged || meta?.data?.deleted || meta?.data?.hidden) {
            continue;
        }
        if (meta?.type === 'milestone') {
            continue;
        }

        const translated = removeHtmlTags(cell.value).trim();
        // Original source text for this cell (plain text, not HTML) — used as the fallback
        // for untranslated segments so we don't erase the original document content.
        const source = String(meta?.data?.originalText ?? '').trim();

        const paragraphId = meta?.paragraphId;
        const paragraphIndex = meta?.paragraphIndex;
        const paragraphIndices = meta?.paragraphIndices;
        const segmentIndex: number | undefined = meta?.segmentIndex;

        if (Array.isArray(paragraphIndices) && paragraphIndices.length > 0) {
            // Table-cell case: map lines of translation to each paragraph index.
            // Fall back to the matching original line so a partially-translated table cell
            // doesn't blank the untranslated paragraphs.
            const originalLines = String(meta?.data?.originalText ?? '').split(/\r?\n/);
            const parts = translated.split(/\r?\n/);
            for (let j = 0; j < paragraphIndices.length; j++) {
                const idx = paragraphIndices[j];
                if (typeof idx !== 'number') continue;
                const plan = {
                    paragraphIndex: idx,
                    translation: parts[j] ?? originalLines[j] ?? '',
                    sourceText: originalLines[j] ?? '',
                    mappingVersion: meta?.paragraphMappingVersion,
                };
                tableWitnesses.set(idx, { ...plan, translation: '' });
                if (!translated) continue;
                const existing = tableTranslations.get(idx);
                if (existing && (
                    existing.translation !== plan.translation ||
                    normalizeDocxWitness(existing.sourceText) !== normalizeDocxWitness(plan.sourceText)
                )) {
                    throw new Error(`Conflicting table-cell translations map to DOCX paragraph ${idx}.`);
                }
                tableTranslations.set(idx, plan);
            }
            continue;
        }

        // Resolve the paragraph index (numeric or from paragraphId string)
        let paraIdx: number | undefined;
        if (typeof paragraphIndex === 'number') {
            paraIdx = paragraphIndex;
        } else if (typeof paragraphId === 'string') {
            const m = paragraphId.match(/^p-(\d+)$/);
            if (m) {
                paraIdx = Number(m[1]);
            } else {
                console.warn(`[Exporter] ⚠ Unrecognized paragraphId format: ${paragraphId}`);
                continue;
            }
        } else {
            continue;
        }

        if (!segmentsByParagraph.has(paraIdx)) {
            segmentsByParagraph.set(paraIdx, []);
        }
        segmentsByParagraph.get(paraIdx)!.push({
            // Unsplit paragraphs have no segmentIndex; treat them as the sole segment (index 0).
            segmentIndex: segmentIndex ?? 0,
            text: translated,
            source,
            mappingVersion: meta?.paragraphMappingVersion,
        });
    }

    // Build the final map: for split paragraphs, join segments in order, falling back to each
    // segment's original source text when it has no translation.
    const translations = new Map<number, ParagraphTranslation>(tableTranslations);
    const witnesses = new Map<number, ParagraphTranslation>(tableWitnesses);

    for (const [paraIdx, segments] of segmentsByParagraph) {
        const uniqueSegments = deduplicateDocxSegments(segments);
        uniqueSegments.sort((a, b) => a.segmentIndex - b.segmentIndex);
        const combinedSource = uniqueSegments.map(s => s.source).join(' ');
        const aliasVariants = buildRepeatedSourceAliasVariants(uniqueSegments);
        const witness: ParagraphTranslation = {
            paragraphIndex: paraIdx,
            translation: '',
            sourceText: combinedSource,
            mappingVersion: uniqueSegments.find((segment) => segment.mappingVersion)?.mappingVersion,
            aliasVariants: aliasVariants.map((variant) => ({ ...variant, translation: '' })),
        };
        witnesses.set(paraIdx, witness);

        // Untranslated paragraphs remain byte-untouched, but their witnesses
        // still help classify the file's historical coordinate system.
        if (!uniqueSegments.some(s => s.text)) continue;
        const combined = uniqueSegments.map(s => s.text || s.source).join(' ');
        translations.set(paraIdx, { ...witness, translation: combined, aliasVariants });
    }

    console.log(`[Exporter] Collected ${translations.size} translations total`);
    return { translations, witnesses };
}

/**
 * Remove HTML tags from content
 */
function removeHtmlTags(html: string): string {
    // Simple HTML tag removal
    // TODO: Handle nested tags, entities, etc.
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
 * Replace content in document.xml while preserving structure
 * 
 * This is the core round-trip logic - similar to Biblica's verse replacement
 */
async function replaceContentInXml(
    documentXml: string,
    translations: Map<number, ParagraphTranslation>,
    witnesses: Map<number, ParagraphTranslation>,
    _config: DocxExportConfig
): Promise<string> {
    const bodyOpenIdx = documentXml.indexOf('<w:body');
    if (bodyOpenIdx < 0) {
        console.warn('[Exporter] No <w:body> found; skipping replacement');
        return documentXml;
    }
    const bodyStart = documentXml.indexOf('>', bodyOpenIdx);
    const bodyCloseIdx = documentXml.indexOf('</w:body>');
    if (bodyStart < 0 || bodyCloseIdx < 0) {
        console.warn('[Exporter] Malformed <w:body>; skipping replacement');
        return documentXml;
    }

    const before = documentXml.slice(0, bodyStart + 1);
    const bodyXmlRaw = documentXml.slice(bodyStart + 1, bodyCloseIdx);
    const after = documentXml.slice(bodyCloseIdx);

    const currentBodyXml = stripFallbackElements(bodyXmlRaw);
    const currentRanges = extractOutermostParagraphRanges(currentBodyXml);
    const legacyRanges = extractLegacyParagraphRanges(bodyXmlRaw);
    const mode = selectParagraphMappingMode(
        witnesses,
        currentBodyXml,
        currentRanges,
        bodyXmlRaw,
        legacyRanges,
    );
    const bodyXml = mode === 'legacy' ? bodyXmlRaw : currentBodyXml;
    const ranges = mode === 'legacy' ? legacyRanges : currentRanges;
    const resolvedTranslations = resolveDocxTranslations(bodyXml, ranges, translations);
    console.log(`[Exporter] Using ${mode} DOCX paragraph coordinates`);
    let out = '';
    let last = 0;
    let replacedCount = 0;

    for (let paraIndex = 0; paraIndex < ranges.length; paraIndex++) {
        const { start, end } = ranges[paraIndex];
        out += bodyXml.slice(last, start);

        const paragraphXml = bodyXml.slice(start, end);
        const translation = resolvedTranslations.get(paraIndex);
        if (translation) {
            if (paragraphXml.indexOf('<w:t') < 0) {
                throw new Error(
                    `Cannot safely export DOCX paragraph ${paraIndex}: destination has no text node.`
                );
            }
            out += replaceParagraphTextXml(paragraphXml, translation);
            replacedCount++;
            console.log(`[Exporter] ✓ Replaced paragraph ${paraIndex}: "${translation.substring(0, 50)}..."`);
        } else {
            out += paragraphXml;
        }

        last = end;
    }
    out += bodyXml.slice(last);

    // Legacy coordinates are resolved against the original XML because those
    // indices counted both AlternateContent branches.  Strip the fallback only
    // after replacement so the authoritative Choice survives and untranslated
    // duplicate/source branches cannot leak into the exported document.
    if (mode === 'legacy') {
        out = stripFallbackElements(out);
    }

    console.log(`[Exporter] Found ${ranges.length} paragraphs in XML`);
    console.log(`[Exporter] Summary: ${replacedCount} replaced, ${ranges.length - replacedCount} skipped, ${ranges.length} total`);

    return `${before}${out}${after}`;
}

/**
 * Replace text inside a single <w:p> paragraph XML string by updating only <w:t> inner text.
 * Keeps the paragraph markup intact (no full XML re-serialization).
 */
function replaceParagraphTextXml(paragraphXml: string, translation: string): string {
    // If no text nodes, no-op.
    if (paragraphXml.indexOf('<w:t') < 0) return paragraphXml;

    const tRe = /(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g;
    const matches: Array<{ start: number; end: number; open: string; inner: string; close: string; decodedLen: number; }> = [];
    let m: RegExpExecArray | null;
    while ((m = tRe.exec(paragraphXml)) !== null) {
        const open = m[1];
        const inner = m[2];
        const close = m[3];
        const decoded = decodeBasicEntities(inner);
        matches.push({
            start: m.index,
            end: m.index + m[0].length,
            open,
            inner,
            close,
            decodedLen: decoded.length,
        });
    }
    if (matches.length === 0) return paragraphXml;

    let remaining = translation;
    let out = '';
    let last = 0;
    for (let i = 0; i < matches.length; i++) {
        const t = matches[i];
        out += paragraphXml.slice(last, t.start);

        const isLast = i === matches.length - 1;
        const take = isLast ? remaining.length : Math.min(remaining.length, Math.max(t.decodedLen, 0));
        const chunk = remaining.slice(0, take);
        remaining = remaining.slice(take);

        // Keep existing <w:t ...> open tag as-is; only swap inner text.
        out += `${t.open}${escapeXmlText(chunk)}${t.close}`;
        last = t.end;
    }
    out += paragraphXml.slice(last);
    return out;
}

function escapeXmlText(text: string): string {
    return (text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function decodeBasicEntities(text: string): string {
    // Best-effort decode for length calculations; doesn't need to be perfect.
    return (text ?? '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

/**
 * Simple exporter class (for consistency with other importers)
 */
export class DocxExporter {
    private config: DocxExportConfig;

    constructor(config: Partial<DocxExportConfig> = {}) {
        this.config = {
            preserveFormatting: true,
            preserveStyles: true,
            validateOutput: true,
            strictMode: false,
            ...config,
        };
    }

    async export(
        originalFileData: ArrayBuffer,
        codexCells: any[],
        docxDocument?: DocxDocument | string
    ): Promise<ArrayBuffer> {
        return exportDocxWithTranslations(
            originalFileData,
            codexCells,
            docxDocument,
            this.config
        );
    }
}

// Export default instance
export default new DocxExporter();
