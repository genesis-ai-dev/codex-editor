/**
 * Standalone USFM Parser
 * Reads all USFM content, including header tags (\id, \toc, etc.) as part of chapter 1
 * Splits file into bible chapters
 * Skips empty paragraphs during import
 */

import { ProcessedCell } from '../../../types/common';
import { createProcessedCell } from '../../../utils/workflowHelpers';
import { convertUsfmInlineMarkersToHtml } from './usfmInlineMapper';

export interface ParsedUsfmDocument {
    bookCode: string;
    bookName?: string;
    fileName: string;
    cells: ProcessedCell[];
    verseCount: number;
    paratextCount: number;
    chapters: number[];
    footnoteCount: number;
    footnotes: any[];
    // Preserve original USFM content for round-trip export
    originalUsfmContent: string;
    // Store line mappings for export
    lineMappings: Array<{
        lineIndex: number;
        cellId: string;
        originalLine: string;
        marker: string;
        hasContent: boolean;
    }>;
}

/**
 * Parse USFM file line-by-line
 * - Includes header tags (\id, \toc, etc.) as part of chapter 1
 * - Creates cells only for lines with content (skips empty markers like \p)
 * - Preserves all structure for round-trip export
 * @param file - The USFM file to parse
 * @param versesOnly - If true, only parse verses (skip headers, sections, etc.) - used for target imports
 */
export async function parseUsfmFile(
    file: File,
    versesOnly: boolean = false
): Promise<ParsedUsfmDocument> {
    // Read original file content
    const originalContent = await file.text();

    const lines = originalContent.split(/\r?\n/);
    const cells: ProcessedCell[] = [];
    const lineMappings: ParsedUsfmDocument['lineMappings'] = [];

    let bookCode = 'XXX';
    let bookName: string | undefined;
    let currentChapter = 1; // Start with chapter 1 (headers will be part of chapter 1)
    let verseCount = 0;
    let paratextCount = 0;
    const chapters = new Set<number>();

    // Track if we've seen the first chapter marker
    let seenFirstChapter = false;

    // Track if we've extracted book code
    let bookCodeExtracted = false;

    // Track current verse being built (for multi-line verses)
    let currentVerse: {
        verseNumber: string | number;
        verseText: string[];
        breakTags: string[]; // Store original break tags like \li1, \q1, etc.
        startLineIndex: number;
        chapter: number;
    } | null = null;

    // Helper function to finish current verse and create cell
    function finishCurrentVerse() {
        if (!currentVerse) return;

        const { verseNumber, verseText, breakTags, startLineIndex, chapter } = currentVerse;
        const cellChapter = chapter;

        // Build HTML parts - preserve structure including \b tags
        const htmlParts: string[] = [];
        const breakTagMetadataParts: string[] = [];

        for (let idx = 0; idx < verseText.length; idx++) {
            const text = verseText[idx];
            const breakTag = breakTags[idx] || '';
            
            if (idx === 0) {
                // First part (from \v line) - no break tag before it
                if (text.trim()) {
                    htmlParts.push(text.trim());
                }
            } else {
                // Subsequent parts - handle break tags
                if (breakTag === '\\b') {
                    // \b creates a blank line marker - add single <br>
                    // The blank line effect comes from \b followed by empty \li1, not from \b itself
                    htmlParts.push('<br>');
                    if (text.trim()) {
                        htmlParts.push(text.trim());
                    }
                    breakTagMetadataParts.push('\\b');
                } else if (breakTag && (breakTag.startsWith('\\li') || breakTag.startsWith('\\q'))) {
                    // Regular break marker (\li1, \q1, etc.) - add single <br>
                    htmlParts.push('<br>');
                    if (text.trim()) {
                        htmlParts.push(text.trim());
                    }
                    // Always include break tag in metadata, even if text is empty (for empty \li1 lines)
                    breakTagMetadataParts.push(breakTag);
                } else if (text.trim()) {
                    // Text without specific break tag - add single <br>
                    htmlParts.push('<br>');
                    htmlParts.push(text.trim());
                }
            }
        }

        // Check if we have any content
        const hasContent = htmlParts.some(part => part && part !== '<br>' && part !== '<br><br>');
        if (!hasContent) {
            // Empty verse - skip
            currentVerse = null;
            return;
        }

        const htmlContent = htmlParts.join('').trim();
        const cellId = `${bookCode} ${cellChapter}:${verseNumber}`;

        // Store break tags in metadata (for export) - include \b tags
        const breakTagMetadata = breakTagMetadataParts.length > 0 
            ? breakTagMetadataParts.join('|') 
            : undefined;

        const cellMetadata: any = {
            bookCode,
            bookName,
            fileName: file.name,
            chapter: cellChapter,
            marker: '\\v',
            originalLine: lines[startLineIndex]?.trim() || '',
            originalText: verseText.join(' ').trim(), // Store original text for reference
            lineIndex: startLineIndex,
            verse: verseNumber,
            cellLabel: `${bookCode} ${cellChapter}:${verseNumber}`,
            breakTag: breakTagMetadata, // Store original break tags for export (including \b)
        };

        // Convert USFM inline markers to HTML (but keep <br> tags as-is)
        const finalHtmlContent = convertUsfmInlineMarkersToHtml(htmlContent);

        // Create cell
        const cell = createProcessedCell(cellId, finalHtmlContent, {
            type: 'text',
            id: cellId,
            ...cellMetadata,
        } as any);

        cells.push(cell);
        verseCount++;
        currentVerse = null;
    }

    // Parse each line
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        const trimmedLine = line.trim();

        // Keep empty lines in mappings but don't create cells for them
        if (!trimmedLine) {
            // If we're building a verse, add empty line as break
            if (currentVerse) {
                currentVerse.verseText.push('');
                currentVerse.breakTags.push(''); // Empty line break
            }
            lineMappings.push({
                lineIndex,
                cellId: '',
                originalLine: line,
                marker: '',
                hasContent: false,
            });
            continue;
        }

        // Process lines that start with \
        if (trimmedLine.startsWith('\\')) {
            // Extract marker and text
            // Match: \marker text or \marker (without text)
            const markerMatch = trimmedLine.match(/^\\([a-zA-Z]+\d*(?:-[se])?)\s*(.*)$/);

            if (markerMatch) {
                const [, marker, text] = markerMatch;
                const textContent = text.trim();

                // Extract book code from \id marker - ALWAYS process this even if versesOnly
                if (marker === 'id' && textContent) {
                    // Try multiple patterns to extract book code
                    // Pattern 1: "MAT" or "MAT - Book Name" or "MAT Book Name"
                    const idMatch = textContent.match(/^([A-Z0-9]{2,4})\b/);
                    if (idMatch) {
                        bookCode = idMatch[1].toUpperCase();
                        bookCodeExtracted = true;
                        console.log(`[USFM Parser] Extracted book code: ${bookCode} from line: ${trimmedLine}`);
                    }
                    // Extract book name (everything after book code and optional dash)
                    const nameMatch = textContent.match(/^[A-Z0-9]{2,4}\s*-\s*(.+)$/);
                    if (nameMatch) {
                        bookName = nameMatch[1].trim();
                    } else {
                        // If no dash, try to extract name after book code
                        const nameMatch2 = textContent.match(/^[A-Z0-9]{2,4}\s+(.+)$/);
                        if (nameMatch2) {
                            bookName = nameMatch2[1].trim();
                        }
                    }
                    // If versesOnly, store in mappings but don't create a cell
                    if (versesOnly) {
                        lineMappings.push({
                            lineIndex,
                            cellId: '',
                            originalLine: line,
                            marker: `\\${marker}`,
                            hasContent: false,
                        });
                        continue;
                    }
                }

                // Track chapters - but headers before first chapter stay in chapter 1
                if (marker === 'c' && textContent) {
                    const chapterNum = parseInt(textContent, 10);
                    if (!isNaN(chapterNum)) {
                        currentChapter = chapterNum;
                        chapters.add(chapterNum);
                        seenFirstChapter = true;
                    }
                    // Finish current verse if any (chapter change)
                    if (currentVerse) {
                        finishCurrentVerse();
                    }
                }

                // Determine cell type and metadata
                // Headers before first chapter marker are assigned to chapter 1
                const cellChapter = seenFirstChapter ? currentChapter : 1;

                // Handle verse markers specially - collect multi-line verses
                if (marker === 'v' || marker.startsWith('v')) {
                    // Finish previous verse if any
                    if (currentVerse) {
                        finishCurrentVerse();
                    }

                    // Extract verse number
                    const verseMatch = textContent.match(/^(\d+[a-z]?)\s*(.*)$/);
                    if (verseMatch) {
                        const [, verseNum, verseText] = verseMatch;
                        const verseNumber = /^\d+$/.test(verseNum) ? parseInt(verseNum, 10) : verseNum;

                        // Start new verse
                        currentVerse = {
                            verseNumber,
                            verseText: verseText ? [verseText] : [],
                            breakTags: [''],
                            startLineIndex: lineIndex,
                            chapter: cellChapter,
                        };
                        // Store verse marker line in mappings
                        lineMappings.push({
                            lineIndex,
                            cellId: `${bookCode} ${cellChapter}:${verseNumber}`,
                            originalLine: line,
                            marker: `\\${marker}`,
                            hasContent: true,
                        });
                    } else {
                        // Verse marker without number - shouldn't happen but handle it
                        lineMappings.push({
                            lineIndex,
                            cellId: '',
                            originalLine: line,
                            marker: `\\${marker}`,
                            hasContent: true,
                        });
                    }
                    continue;
                }

                // Handle break markers that continue a verse (li1, q1, q2, etc.)
                const breakMarkers = ['li1', 'li2', 'li3', 'li4', 'q1', 'q2', 'q3', 'q4'];
                if (currentVerse && breakMarkers.includes(marker)) {
                    // Add text to current verse with break tag
                    currentVerse.verseText.push(textContent);
                    currentVerse.breakTags.push(`\\${marker}`);
                    // Store break line in mappings (linked to verse)
                    lineMappings.push({
                        lineIndex,
                        cellId: `${bookCode} ${currentVerse.chapter}:${currentVerse.verseNumber}`,
                        originalLine: line,
                        marker: `\\${marker}`,
                        hasContent: true,
                    });
                    continue;
                }

                // Handle \b (blank line) marker within a verse - treat as double break
                if (currentVerse && marker === 'b') {
                    // \b creates a blank line - add empty text with special break tag
                    currentVerse.verseText.push(''); // Empty text for the blank line
                    currentVerse.breakTags.push('\\b'); // Store \b marker
                    // Store \b line in mappings (linked to verse)
                    lineMappings.push({
                        lineIndex,
                        cellId: `${bookCode} ${currentVerse.chapter}:${currentVerse.verseNumber}`,
                        originalLine: line,
                        marker: '\\b',
                        hasContent: false, // \b itself has no content, it's just a blank line marker
                    });
                    continue;
                }

                // SKIP empty markers (like \p, \q1, etc. without text)
                // Store them in mappings but don't create cells
                if (!textContent) {
                    // Finish current verse if any (empty marker ends verse)
                    if (currentVerse) {
                        finishCurrentVerse();
                    }
                    lineMappings.push({
                        lineIndex,
                        cellId: '',
                        originalLine: line,
                        marker: `\\${marker}`,
                        hasContent: false,
                    });
                    continue;
                }

                // If versesOnly is true, skip non-verse markers (headers, sections, etc.)
                if (versesOnly) {
                    // Finish current verse if any
                    if (currentVerse) {
                        finishCurrentVerse();
                    }
                    // Store in mappings but don't create a cell
                    lineMappings.push({
                        lineIndex,
                        cellId: '',
                        originalLine: line,
                        marker: `\\${marker}`,
                        hasContent: false,
                    });
                    continue;
                }

                // Finish current verse if any (non-verse marker ends verse)
                if (currentVerse) {
                    finishCurrentVerse();
                }

                // All other markers (headers, sections, paragraphs with text, etc.)
                const cellMetadata: any = {
                    bookCode,
                    bookName,
                    fileName: file.name,
                    chapter: cellChapter,
                    marker: `\\${marker}`, // Store the full marker (e.g., \id, \s1, \v)
                    originalLine: trimmedLine, // Store the full original line for matching
                    originalText: textContent, // Store just the text part
                    lineIndex, // Store line index for export
                };

                // Use marker name and index for unique ID
                const cellId = `${bookCode} ${cellChapter}:${marker}:${lineIndex}`;
                cellMetadata.originalText = textContent;
                paratextCount++;

                // Convert text content to HTML for display
                const htmlContent = convertUsfmInlineMarkersToHtml(textContent);

                // Create cell
                // Ensure id is in metadata for VS Code notebook compatibility
                const cell = createProcessedCell(cellId, htmlContent, {
                    type: 'text',
                    id: cellId, // Store id in metadata for VS Code notebook compatibility
                    ...cellMetadata,
                } as any);

                cells.push(cell);

                // Store mapping for export
                lineMappings.push({
                    lineIndex,
                    cellId,
                    originalLine: line,
                    marker: `\\${marker}`,
                    hasContent: true,
                });
            } else {
                // Line starts with \ but doesn't match pattern - store in mappings
                // Finish current verse if any
                if (currentVerse) {
                    finishCurrentVerse();
                }
                lineMappings.push({
                    lineIndex,
                    cellId: '',
                    originalLine: line,
                    marker: '',
                    hasContent: false,
                });
            }
        } else {
            // Line doesn't start with \ - continuation line
            // If we're building a verse, add as continuation
            if (currentVerse) {
                currentVerse.verseText.push(trimmedLine);
                currentVerse.breakTags.push(''); // Continuation line (no break tag)
            }
            // Store in mappings but don't create a cell (continuation lines are part of previous cell)
            lineMappings.push({
                lineIndex,
                cellId: currentVerse ? `${bookCode} ${currentVerse.chapter}:${currentVerse.verseNumber}` : '',
                originalLine: line,
                marker: '',
                hasContent: currentVerse ? true : false,
            });
        }
    }

    // Finish any remaining verse
    if (currentVerse) {
        finishCurrentVerse();
    }

    // Ensure chapter 1 is in the chapters set if we have headers
    if (!seenFirstChapter && cells.length > 0) {
        chapters.add(1);
    }

    if (cells.length === 0) {
        throw new Error(`No content found in USFM file: ${file.name}`);
    }

    // Warn if book code wasn't extracted
    if (!bookCodeExtracted && bookCode === 'XXX') {
        console.warn(`[USFM Parser] Book code not extracted from file ${file.name}, using default 'XXX'`);
    }

    return {
        bookCode,
        bookName,
        fileName: file.name,
        cells,
        verseCount,
        paratextCount,
        chapters: Array.from(chapters).sort((a, b) => a - b),
        footnoteCount: 0, // TODO: Extract footnotes if needed
        footnotes: [],
        originalUsfmContent: originalContent,
        lineMappings,
    };
}
