/**
 * Standalone USFM Exporter for round-trip functionality
 * Rebuilds original USFM file with translated content
 * Only replaces text content after markers, preserving all markers and structure
 * Skips empty paragraphs (they're not in cells, so they stay as-is)
 */

import { htmlInlineToUsfm } from './usfmInlineMapper';

export interface LineMapping {
    lineIndex: number;
    cellId: string;
    originalLine: string;
    marker: string;
    hasContent: boolean;
}

/**
 * Export USFM with updated content from Codex cells
 * 
 * @param originalUsfmContent - The original USFM file content as string
 * @param lineMappingsOrCells - Either line mappings array OR codex cells (for backward compatibility)
 * @param codexCells - Array of Codex cell data with translations (optional if lineMappings provided)
 * @returns Updated USFM content as string
 */
export async function exportUsfmRoundtrip(
    originalUsfmContent: string,
    lineMappingsOrCells: LineMapping[] | Array<{ kind: number; value: string; metadata: any; }>,
    codexCells?: Array<{
        kind: number;
        value: string;
        metadata: any;
    }>
): Promise<string> {
    // Determine if first param is lineMappings or codexCells (backward compatibility)
    let lineMappings: LineMapping[];
    let cells: Array<{ kind: number; value: string; metadata: any; }>;

    if (lineMappingsOrCells.length > 0 && 'lineIndex' in lineMappingsOrCells[0]) {
        // First param is lineMappings
        lineMappings = lineMappingsOrCells as LineMapping[];
        cells = codexCells || [];
        console.log(`[USFM Export] Received lineMappings array with ${lineMappings.length} entries`);
        const sampleWithCellId = lineMappings.find(m => m.cellId && m.cellId !== '');
        console.log(`[USFM Export] Sample lineMapping with cellId:`, sampleWithCellId);
        console.log(`[USFM Export] LineMappings with cellId: ${lineMappings.filter(m => m.cellId && m.cellId !== '').length}`);
    } else {
        // First param is codexCells (backward compatibility - old experimental exporter)
        cells = lineMappingsOrCells as Array<{ kind: number; value: string; metadata: any; }>;
        // Generate lineMappings from original content (less precise but works)
        const lines = originalUsfmContent.split(/\r?\n/);
        lineMappings = lines.map((line, index) => {
            const trimmedLine = line.trim();
            if (!trimmedLine || !trimmedLine.startsWith('\\')) {
                return {
                    lineIndex: index,
                    cellId: '',
                    originalLine: line,
                    marker: '',
                    hasContent: false,
                };
            }
            const markerMatch = trimmedLine.match(/^\\([a-zA-Z]+\d*(?:-[se])?)\s*(.*)$/);
            const textContent = markerMatch?.[2]?.trim() || '';
            return {
                lineIndex: index,
                cellId: '', // Will be matched by originalLine/originalText
                originalLine: line,
                marker: markerMatch ? `\\${markerMatch[1]}` : '',
                hasContent: !!textContent,
            };
        });
    }
    // Build mapping from cellId to translated content (keep as HTML for <br> handling)
    const cellTranslations = new Map<string, string>();

    for (const cell of cells) {
        const metadata = cell.metadata as any;
        const translatedContent = cell.value.trim();

        // Try to get cellId from multiple possible locations
        // VS Code notebooks store id in metadata.id, but our ProcessedCell has id as top-level
        const cellId = (cell as any).id || metadata?.id;

        // Skip empty cells or cells without ID
        if (!translatedContent || !cellId) {
            if (!cellId && translatedContent) {
                console.warn(`[USFM Export] Cell has content but no ID:`, {
                    value: translatedContent.substring(0, 50),
                    metadataKeys: Object.keys(metadata || {}),
                    cellKeys: Object.keys(cell || {})
                });
            }
            continue;
        }

        // Store HTML content as-is (we'll handle <br> splitting and conversion later)
        cellTranslations.set(cellId, translatedContent);
    }

    console.log(`[USFM Export] Found ${cellTranslations.size} cell translations`);
    console.log(`[USFM Export] Sample cell IDs from translations:`, Array.from(cellTranslations.keys()).slice(0, 5));
    console.log(`[USFM Export] Total line mappings: ${lineMappings.length}`);
    const mappingsWithCellId = lineMappings.filter(m => m.cellId && m.cellId !== '');
    console.log(`[USFM Export] Line mappings with cellId: ${mappingsWithCellId.length}`);
    console.log(`[USFM Export] Sample line mapping cell IDs:`, mappingsWithCellId.slice(0, 5).map(m => m.cellId));

    // If lineMappings don't have cellIds, build a fallback mapping by originalLine/originalText
    // This handles notebooks imported before cellIds were stored in lineMappings
    const fallbackMapping = new Map<string, string>();
    if (mappingsWithCellId.length === 0 && cellTranslations.size > 0) {
        console.log(`[USFM Export] No cellIds in lineMappings, building fallback mapping by originalLine/originalText`);
        for (const cell of cells) {
            const metadata = cell.metadata as any;
            const translatedContent = cell.value.trim();
            if (!translatedContent) continue;

            // Store HTML content as-is (we'll handle conversion later)

            // Try to match by originalLine first
            if (metadata?.originalLine) {
                const normalizedLine = String(metadata.originalLine).trim().replace(/\s+/g, ' ');
                fallbackMapping.set(normalizedLine, translatedContent);
            }

            // Also try by originalText
            if (metadata?.originalText) {
                const normalizedText = String(metadata.originalText).trim().replace(/\s+/g, ' ');
                fallbackMapping.set(normalizedText, translatedContent);
            }
        }
        console.log(`[USFM Export] Built fallback mapping with ${fallbackMapping.size} entries`);
    }

    // Split original content into lines
    const lines = originalUsfmContent.split(/\r?\n/);
    const updatedLines: string[] = [];
    let translationCount = 0;
    let skippedCount = 0;
    let fallbackCount = 0;

    // Track which lines to skip (they're part of a multi-line verse we already processed)
    const linesToSkip = new Set<number>();

    // Process each line using the mappings
    for (let i = 0; i < lines.length; i++) {
        // Skip lines that are part of a multi-line verse we already processed
        if (linesToSkip.has(i)) {
            skippedCount++;
            continue;
        }

        const mapping = lineMappings[i];

        // If no mapping for this line, keep original
        if (!mapping) {
            updatedLines.push(lines[i]);
            continue;
        }

        // If line has no content (empty marker or continuation), keep as-is
        if (!mapping.hasContent) {
            updatedLines.push(mapping.originalLine || lines[i]);
            skippedCount++;
            continue;
        }

        let translation: string | undefined;

        // First try to match by cellId (most precise)
        if (mapping.cellId && cellTranslations.has(mapping.cellId)) {
            translation = cellTranslations.get(mapping.cellId);
            translationCount++;
        }
        // Fallback: match by originalLine or originalText if cellIds aren't available
        else if (fallbackMapping.size > 0 && mapping.originalLine) {
            const originalLine = String(mapping.originalLine).trim();
            if (originalLine) {
                const normalizedLine = originalLine.replace(/\s+/g, ' ');
                if (fallbackMapping.has(normalizedLine)) {
                    translation = fallbackMapping.get(normalizedLine);
                    fallbackCount++;
                } else {
                    // Try matching just the text part (after marker)
                    const markerMatch = originalLine.match(/^\\([a-zA-Z]+\d*(?:-[se])?)\s*(.*)$/);
                    if (markerMatch) {
                        const textPart = markerMatch[2]?.trim().replace(/\s+/g, ' ');
                        if (textPart && fallbackMapping.has(textPart)) {
                            translation = fallbackMapping.get(textPart);
                            fallbackCount++;
                        }
                    }
                }
            }
        }

        if (translation) {
            // Extract marker from original line
            const originalLine = mapping.originalLine || lines[i];
            const markerMatch = originalLine.match(/^\\([a-zA-Z]+\d*(?:-[se])?)\s*(.*)$/);

            if (markerMatch) {
                const [, marker, originalText] = markerMatch;

                // Handle verse markers specially (need to preserve verse number and break tags)
                if (marker === 'v' || marker.startsWith('v')) {
                    const verseMatch = originalText.match(/^(\d+[a-z]?)\s*(.*)$/);
                    if (verseMatch) {
                        const [, verseNum] = verseMatch;
                        const trimmedTranslation = String(translation).trim();
                        
                        if (trimmedTranslation) {
                            // Check if this verse has break tags (multi-line verse)
                            // Find the cell that contains this translation
                            let breakTagMetadata: string | undefined;
                            if (mapping.cellId) {
                                const cell = cells.find(c => {
                                    const cellId = (c as any).id || (c.metadata as any)?.id;
                                    return cellId === mapping.cellId;
                                });
                                if (cell) {
                                    breakTagMetadata = (cell.metadata as any)?.breakTag;
                                }
                            }
                            
                            // Check if translation contains <br> tags (multi-line verse)
                            // Split by <br> tags BEFORE converting to USFM (since <br> is structural)
                            const hasBrTags = /<br\s*\/?>/i.test(trimmedTranslation);
                            
                            if (hasBrTags) {
                                // Multi-line verse - split by <br> and map each part to corresponding USFM line
                                // Handle <br><br> (double break) as \b tag
                                // Split by <br> tags - consecutive <br> tags will create empty parts
                                const parts = trimmedTranslation.split(/<br\s*\/?>/i).map(p => p.trim());
                                
                                // Note: When we split by <br>, <br><br> creates one empty part
                                // So if breakTags has \b, the corresponding empty part should map to \b
                                // We'll use breakTags array to determine which break tag to use for each part
                                
                                // Find all subsequent break tag lines (\li1, \li2, \b, etc.) that belong to this verse
                                const breakLines: Array<{ index: number; mapping: LineMapping; originalMarker: string }> = [];
                                for (let j = i + 1; j < lineMappings.length; j++) {
                                    const nextMapping = lineMappings[j];
                                    // Check if this line belongs to the same verse (same cellId)
                                    if (nextMapping.cellId === mapping.cellId) {
                                        const breakMarkers = ['\\li1', '\\li2', '\\li3', '\\li4', '\\q1', '\\q2', '\\q3', '\\q4', '\\b'];
                                        if (breakMarkers.includes(nextMapping.marker)) {
                                            breakLines.push({
                                                index: j,
                                                mapping: nextMapping,
                                                originalMarker: nextMapping.marker
                                            });
                                        } else {
                                            // We've reached a different marker (next verse or section) - stop
                                            break;
                                        }
                                    } else if (nextMapping.cellId && nextMapping.cellId !== '') {
                                        // Different cellId - stop looking
                                        break;
                                    }
                                }
                                
                                // Get break tags from metadata if available
                                const breakTags = breakTagMetadata ? breakTagMetadata.split('|').filter(t => t) : [];
                                
                                // First part goes to the \v line
                                const firstPart = parts[0] || '';
                                const firstPartUsfm = firstPart ? htmlInlineToUsfm(firstPart) : '';
                                if (firstPartUsfm) {
                                    updatedLines.push(`\\${marker} ${verseNum} ${firstPartUsfm}`);
                                } else {
                                    updatedLines.push(`\\${marker} ${verseNum}`);
                                }
                                
                                // Map each subsequent part to the corresponding break tag line
                                // Use breakTagMetadata to determine the correct break tag for each position
                                let breakTagIdx = 0; // Index into breakTags array
                                let breakLineIdx = 0; // Index into breakLines array
                                
                                // Process parts sequentially, matching each to its corresponding break tag
                                for (let partIdx = 1; partIdx < parts.length; partIdx++) {
                                    const part = parts[partIdx] || '';
                                    
                                    // Check if we've run out of break tags
                                    if (breakTagIdx >= breakTags.length) {
                                        // No more break tags in metadata - use original markers from breakLines
                                        const partUsfm = part ? htmlInlineToUsfm(part) : '';
                                        if (breakLineIdx < breakLines.length) {
                                            const breakLine = breakLines[breakLineIdx];
                                            linesToSkip.add(breakLine.index);
                                            const breakTag = breakLine.originalMarker || '\\li1';
                                            if (partUsfm) {
                                                updatedLines.push(`${breakTag} ${partUsfm}`);
                                            } else {
                                                updatedLines.push(breakTag);
                                            }
                                            breakLineIdx++;
                                        } else {
                                            updatedLines.push(`\\li1${partUsfm ? ' ' + partUsfm : ''}`);
                                        }
                                        continue;
                                    }
                                    
                                    const currentBreakTag = breakTags[breakTagIdx];
                                    
                                    if (currentBreakTag === '\\b') {
                                        // \b tag - output blank line marker
                                        // \b produces one <br>, so it consumes one empty part (if empty) or processes text (if any)
                                        if (breakLineIdx < breakLines.length) {
                                            const breakLine = breakLines[breakLineIdx];
                                            linesToSkip.add(breakLine.index);
                                            updatedLines.push('\\b');
                                            breakLineIdx++;
                                        } else {
                                            updatedLines.push('\\b');
                                        }
                                        breakTagIdx++;
                                    } else {
                                        // Regular break tag (\li1, \q1, etc.)
                                        const partUsfm = part ? htmlInlineToUsfm(part) : '';
                                        
                                        if (breakLineIdx < breakLines.length) {
                                            const breakLine = breakLines[breakLineIdx];
                                            linesToSkip.add(breakLine.index);
                                            
                                            // Use break tag from metadata
                                            const breakTag = currentBreakTag || breakLine.originalMarker || '\\li1';
                                            if (partUsfm) {
                                                updatedLines.push(`${breakTag} ${partUsfm}`);
                                            } else {
                                                // Empty part - output just the break tag (empty \li1 line)
                                                updatedLines.push(breakTag);
                                            }
                                            breakLineIdx++;
                                        } else {
                                            // More parts than break lines - add new break line
                                            const breakTag = currentBreakTag || '\\li1';
                                            if (partUsfm) {
                                                updatedLines.push(`${breakTag} ${partUsfm}`);
                                            } else {
                                                updatedLines.push(breakTag);
                                            }
                                        }
                                        breakTagIdx++;
                                    }
                                }
                                
                                // Mark any remaining break lines (if we have fewer parts than break lines) to skip
                                for (let remainingIdx = breakLineIdx; remainingIdx < breakLines.length; remainingIdx++) {
                                    linesToSkip.add(breakLines[remainingIdx].index);
                                }
                            } else {
                                // Single-line verse - convert HTML to USFM and output
                                const usfmText = htmlInlineToUsfm(trimmedTranslation);
                                updatedLines.push(`\\${marker} ${verseNum} ${usfmText}`);
                            }
                        } else {
                            // Empty translation - output just marker and verse number
                            updatedLines.push(`\\${marker} ${verseNum}`);
                        }
                    } else {
                        // Verse without number - shouldn't happen but handle it
                        const usfmText = htmlInlineToUsfm(String(translation));
                        updatedLines.push(`\\${marker} ${usfmText}`);
                    }
                } else {
                    // All other markers - preserve marker, replace text
                    const trimmedTranslation = String(translation).trim();
                    if (trimmedTranslation) {
                        const usfmText = htmlInlineToUsfm(trimmedTranslation);
                        updatedLines.push(`\\${marker} ${usfmText}`);
                    } else {
                        // Empty translation - output just marker (will be skipped on re-import)
                        updatedLines.push(`\\${marker}`);
                    }
                }
            } else {
                // Couldn't parse marker - keep original
                updatedLines.push(originalLine);
            }
        } else {
            // No translation found - keep original
            updatedLines.push(mapping.originalLine || lines[i]);
            if (mapping.cellId && cellTranslations.has(mapping.cellId)) {
                console.warn(`[USFM Export] No translation found for cellId: ${mapping.cellId}`);
            }
        }
    }

    console.log(`[USFM Export] Applied ${translationCount} translations by cellId, ${fallbackCount} by fallback matching, skipped ${skippedCount} empty/continuation lines`);
    return updatedLines.join('\n');
}
