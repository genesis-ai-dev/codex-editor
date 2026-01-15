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
        const translationMap = collectTranslations(codexCells);
        console.log(`[DOCX Exporter] Collected ${translationMap.size} translations`);

        // Replace content in document.xml
        const updatedXml = await replaceContentInXml(
            documentXml,
            translationMap,
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
 * Collect translations from Codex cells
 */
function collectTranslations(
    codexCells: Array<{ kind: number; value: string; metadata: any; }>
): Map<number, string> {
    const translations = new Map<number, string>();

    console.log(`[Exporter] Processing ${codexCells.length} cells for translations`);

    for (let i = 0; i < codexCells.length; i++) {
        const cell = codexCells[i];
        const meta = cell.metadata;

        // Only DOCX cells have paragraphIndex/paragraphId; everything else is skipped naturally.
        // (Don't rely on kind/type here; it varies by host and we only need the mapping fields.)

        // Get translated content (strip HTML tags)
        const translated = removeHtmlTags(cell.value).trim();
        if (!translated) {
            continue;
        }

        // Get paragraph identifier
        const paragraphId = meta?.paragraphId;
        const paragraphIndex = meta?.paragraphIndex;

        if (typeof paragraphIndex === 'number') {
            translations.set(paragraphIndex, translated);
            // Keep logs light; large documents can have thousands of cells.
        } else if (typeof paragraphId === 'string') {
            const m = paragraphId.match(/^p-(\d+)$/);
            if (m) {
                const idx = Number(m[1]);
                translations.set(idx, translated);
            } else {
                console.warn(`[Exporter] ⚠ Unrecognized paragraphId format: ${paragraphId}`);
            }
        }
    }

    console.log(`[Exporter] Collected ${translations.size} translations total`);
    // Avoid dumping thousands of IDs in logs.

    return translations;
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
    translations: Map<number, string>,
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
    const bodyXml = documentXml.slice(bodyStart + 1, bodyCloseIdx);
    const after = documentXml.slice(bodyCloseIdx);

    // Match both normal and self-closing paragraphs.
    const paraRe = /<w:p\b[\s\S]*?<\/w:p>|<w:p\b[^>]*\/>/g;
    let out = '';
    let last = 0;
    let paraIndex = 0;
    let replacedCount = 0;

    let m: RegExpExecArray | null;
    while ((m = paraRe.exec(bodyXml)) !== null) {
        const start = m.index;
        const end = start + m[0].length;
        out += bodyXml.slice(last, start);

        const translation = translations.get(paraIndex);
        if (translation) {
            out += replaceParagraphTextXml(m[0], translation);
            replacedCount++;
            console.log(`[Exporter] ✓ Replaced paragraph ${paraIndex}: "${translation.substring(0, 50)}..."`);
        } else {
            out += m[0];
        }

        last = end;
        paraIndex++;
    }
    out += bodyXml.slice(last);

    console.log(`[Exporter] Found ${paraIndex} paragraphs in XML`);
    console.log(`[Exporter] Summary: ${replacedCount} replaced, ${paraIndex - replacedCount} skipped, ${paraIndex} total`);

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
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function decodeBasicEntities(text: string): string {
    // Best-effort decode for length calculations; doesn't need to be perfect.
    return (text ?? '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '\"')
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

