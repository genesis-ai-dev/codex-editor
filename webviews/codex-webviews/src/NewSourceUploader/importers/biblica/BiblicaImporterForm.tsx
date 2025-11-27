/**
 * Biblica Importer Form Component
 * Provides UI for importing Biblica Study Bible (IDML) and Translated Bible files
 * 
 * Features:
 * - Study Bible (IDML): Populates source file with all notes and bible verses
 * - Translated Bible: Populates target/codex file with translated verse content
 */

import React, { useState, useCallback } from 'react';
import { ImporterComponentProps } from '../../types/plugin';
import { Button } from '../../../components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '../../../components/ui/card';
import { Progress } from '../../../components/ui/progress';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { 
    FileText, 
    Upload, 
    ArrowLeft,
    BookOpen,
    Languages
} from 'lucide-react';
import { IDMLParser } from './biblicaParser';
import { HTMLMapper } from './htmlMapper';
import { createProcessedCell, sanitizeFileName, createStandardCellId } from '../../utils/workflowHelpers';
import { extractImagesFromHtml } from '../../utils/imageProcessor';
import { CodexCellTypes } from 'types/enums';

/**
 * Escape HTML characters and convert newlines to <br> tags
 */
function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    // Convert newlines to <br> tags for proper HTML rendering
    return div.innerHTML.replace(/\n/g, '<br>');
}

function buildInlineHTMLFromRanges(ranges: any[]): string {
    if (!Array.isArray(ranges) || ranges.length === 0) return '';
    
    // Build HTML from ranges (special-styled ranges already filtered out by parser)
    return ranges.map((r) => {
        const style = (r?.appliedCharacterStyle || '').toString();
        const content = (r?.content || '').toString();
        
        // Convert newline markers (from <Br />) to <br /> in HTML
        const text = content.replace(/\n/g, '<br />');
        const safeStyle = escapeHtml(style);
        
        // Do not escape the injected <br /> tags; escape other text portions only
        const safeText = text
            .split('<br />')
            .map((part: string) => escapeHtml(part))
            .join('<br />');
            
        return `<span class="idml-char" data-character-style="${safeStyle}">${safeText}</span>`;
    }).join('');
}

function isNumericToken(token: string): boolean {
    return /^\d{1,3}$/.test(token.trim());
}

interface BiblicaImporterFormProps extends ImporterComponentProps {
    // Additional props specific to Biblica importer
}

export const BiblicaImporterForm: React.FC<BiblicaImporterFormProps> = ({
    onComplete,
    onCancel,
    onCancelImport,
    existingFiles,
    wizardContext
}) => {
    // Study Bible (IDML) - populates source file
    const [studyBibleFile, setStudyBibleFile] = useState<File | null>(null);
    // Translated Bible - populates target/codex file with verse content
    const [translatedBibleFile, setTranslatedBibleFile] = useState<File | null>(null);
    
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState<string>('');
    const [debugLogs, setDebugLogs] = useState<string[]>([]);
    const [importResult, setImportResult] = useState<any>(null);
    const [showCompleteButton, setShowCompleteButton] = useState(false);

    const addDebugLog = useCallback((message: string) => {
        const timestamp = new Date().toLocaleTimeString();
        const logMessage = `[${timestamp}] ${message}`;
        setDebugLogs(prev => [...prev, logMessage]);
        // No console logging - only send to debug panel
    }, []);

    const handleStudyBibleSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        
        if (!file.name.toLowerCase().endsWith('.idml')) {
            alert('Please select a valid IDML file (.idml extension)');
            return;
        }
        
        setStudyBibleFile(file);
        addDebugLog(`Study Bible file selected: ${file.name}`);
    }, [addDebugLog]);

    const handleTranslatedBibleSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        
        if (!file.name.toLowerCase().endsWith('.idml')) {
            alert('Please select a valid IDML file (.idml extension)');
            return;
        }
        
        setTranslatedBibleFile(file);
        addDebugLog(`Translated Bible file selected: ${file.name}`);
    }, [addDebugLog]);

    /**
     * Create cells from Study Bible stories (populates source file)
     * Maps verses by their labels (e.g., MAT 1:1) for later matching with translated bible
     */
    const createCellsFromStories = useCallback(async (
        stories: any[], 
        htmlRepresentation: any, 
        document: any,
        verseMap?: Map<string, string>, // Map of verse labels to translated content
        footnotesMap?: Map<string, string[]> // Map of verse labels to footnote XML arrays
    ) => {
        const cells: any[] = [];
        let globalCellIndex = 0; // Global counter for sequential numbering across all content
        
        for (const story of stories) {
            // Try to find HTML story, but don't require it
            const htmlStory = htmlRepresentation.stories?.find((s: any) => s.id === story.id);
            if (!htmlStory) {
                addDebugLog(`No HTML story found for: ${story.id}, creating cells directly from story`);
            }
            
            // Create cells from paragraphs - check for verse segments first
            for (let i = 0; i < story.paragraphs.length; i++) {
                const paragraph = story.paragraphs[i];
                const paragraphStyle = paragraph.paragraphStyleRange.appliedParagraphStyle;
                
                // Check if this paragraph has verse segments
                const verseSegments = (paragraph.metadata as any)?.biblicaVerseSegments;
                
                if (verseSegments && Array.isArray(verseSegments) && verseSegments.length > 0) {
                    // Create one cell per verse
                    addDebugLog(`Found ${verseSegments.length} verse(s) in paragraph`);
                    
                    for (const verse of verseSegments) {
                        const { bookAbbreviation, chapterNumber, verseNumber, beforeVerse, verseContent, afterVerse } = verse;
                        // Use simple sequential numbering for all cells
                        globalCellIndex++;
                        const cellId = `biblica 1:${globalCellIndex}`;
                        // Store original verse reference for metadata (e.g., "MAT 1:1")
                        const originalVerseRef = bookAbbreviation ? `${bookAbbreviation} ${chapterNumber}:${verseNumber}` : `${chapterNumber}:${verseNumber}`;
                        
                        // Check if we have translated content for this verse
                        const translatedContent = verseMap?.get(originalVerseRef);
                        // Get footnotes for this verse from translated Bible
                        const footnotes = footnotesMap?.get(originalVerseRef);
                        
                        // Replace &nbsp; entities (non-breaking spaces) with regular spaces
                        // They are converted to regular spaces during import so they appear correctly in Codex cells
                        const cleanedVerseContent = verseContent.replace(/&nbsp;/gi, ' ').replace(/\u00A0/g, ' ');
                        
                        // Create HTML content for the verse (source file - study bible content)
                        const htmlContent = `<p class="biblica-verse" data-book="${bookAbbreviation}" data-chapter="${chapterNumber}" data-verse="${verseNumber}" data-paragraph-style="${paragraphStyle}" data-story-id="${story.id}">${escapeHtml(cleanedVerseContent)}</p>`;
                        
                        const cellMetadata = {
                            id: cellId,
                            type: CodexCellTypes.TEXT,
                            edits: [],
                            cellLabel: originalVerseRef, // Keep original verse reference in label
                            isBibleVerse: true,
                            bookAbbreviation,
                            chapterNumber,
                            verseNumber,
                            verseId: originalVerseRef, // Keep original verse reference for matching
                            storyId: story.id,
                            paragraphId: paragraph.id,
                            appliedParagraphStyle: paragraphStyle,
                            beforeVerse,  // Serialized XML for round-trip
                            afterVerse,   // Serialized XML for round-trip
                            footnotes: footnotes || undefined, // Footnotes from translated Bible (for round-trip preservation)
                            data: {
                                originalContent: cleanedVerseContent, // Store cleaned content (with &nbsp; replaced by spaces)
                                sourceFile: studyBibleFile?.name || 'unknown',
                                // Minimal structure needed for export fallback
                                idmlStructure: {
                                    storyId: story.id,
                                    paragraphId: paragraph.id,
                                    paragraphStyleRange: {
                                        appliedParagraphStyle: paragraphStyle,
                                        // Only keep dataAfter if present (used for paragraph-based export fallback)
                                        dataAfter: paragraph.paragraphStyleRange.dataAfter
                                    }
                                },
                                // Minimal context - only what's needed for identification
                                documentContext: {
                                    originalHash: htmlRepresentation.originalHash,
                                    importerType: 'biblica',
                                    fileName: studyBibleFile?.name || 'unknown',
                                }
                            }
                        };
                        
                        const cell = createProcessedCell(cellId, htmlContent, cellMetadata as any);
                        const images = await extractImagesFromHtml(htmlContent);
                        cell.images = images;
                        cells.push(cell);
                        addDebugLog(`Created verse cell: ${cellId} (original: ${originalVerseRef})${translatedContent ? ' - with translated content' : ''}`);
                    }
                } else {
                    // Split paragraph at <Br/> tags (represented as \n in content) into multiple cells
                    const content = paragraph.paragraphStyleRange.content;
                    const ranges = paragraph.characterStyleRanges || [];
                    
                    // Build combined content from ranges to detect all \n characters
                    // The parser converts <Br/> tags to \n in the content
                    let combinedContent = content;
                    if (ranges.length > 0) {
                        // Rebuild content from ranges to ensure we capture all \n characters
                        combinedContent = ranges.map((r: any) => r.content || '').join('');
                    }
                    
                    // Check if paragraph is empty or only contains <Br/> tags (represented as \n)
                    // Remove all whitespace and newlines to check if there's any actual content
                    const contentWithoutBreaks = combinedContent
                        .replace(/[\r\n]+/g, '')  // Remove all line breaks
                        .replace(/\s+/g, ' ')     // Collapse whitespace
                        .trim();                   // Trim
                    
                    // Skip paragraphs that are empty or only contain <Br/> tags
                    if (!contentWithoutBreaks || contentWithoutBreaks.length === 0) {
                        addDebugLog(`Skipping empty paragraph ${i} (only contains <Br/> tags)`);
                        continue;
                    }
                    
                    // Preserve newlines for structure
                    const contentWithBreaks = combinedContent
                        .replace(/\r\n/g, '\n')  // Normalize line endings
                        .replace(/\r/g, '\n');   // Normalize line endings
                    
                    // Check if we have any line breaks to split on
                    const hasLineBreaks = contentWithBreaks.includes('\n');
                    
                    // Split content at line breaks (\n represents <Br/> tags)
                    // Keep empty segments to preserve structure
                    const segments = contentWithBreaks.split('\n');
                    
                    // Split character style ranges at line breaks too
                    let rangeSegments: Array<{ ranges: any[], content: string }> = [];
                    
                    if (ranges.length > 0) {
                        // Group ranges by line breaks - split at each \n
                        let currentSegment: { ranges: any[], content: string } = { ranges: [], content: '' };
                        
                        for (const range of ranges) {
                            const rangeContent = range.content || '';
                            
                            // Check if this range contains line breaks
                            if (rangeContent.includes('\n')) {
                                const rangeParts = rangeContent.split('\n');
                                
                                for (let j = 0; j < rangeParts.length; j++) {
                                    const part = rangeParts[j];
                                    
                                    // Add this part to current segment
                                    if (part) {
                                        currentSegment.ranges.push({
                                            ...range,
                                            content: part
                                        });
                                        currentSegment.content += part;
                                    }
                                    
                                    // If this is not the last part, finalize current segment and start new one
                                    if (j < rangeParts.length - 1) {
                                        // Finalize current segment (even if empty, to preserve structure)
                                        rangeSegments.push({ ...currentSegment });
                                        currentSegment = { ranges: [], content: '' };
                                    }
                                }
                            } else {
                                // No line breaks in this range, add to current segment
                                currentSegment.ranges.push(range);
                                currentSegment.content += rangeContent;
                            }
                        }
                        
                        // Add the final segment
                        if (currentSegment.content || currentSegment.ranges.length > 0) {
                            rangeSegments.push(currentSegment);
                        }
                        
                        // If no segments were created (no line breaks), use original ranges
                        if (rangeSegments.length === 0) {
                            rangeSegments = [{ ranges, content: contentWithBreaks }];
                        }
                    } else {
                        // No ranges, split plain content - create one segment per split
                        rangeSegments = segments.map((seg: string) => ({ ranges: [], content: seg }));
                    }
                    
                    // Use rangeSegments as finalSegments (they're already properly split)
                    // If we have more content segments than range segments, align them
                    const finalSegments: Array<{ ranges: any[], content: string }> = 
                        rangeSegments.length > 0 ? rangeSegments : 
                        segments.map((seg: string) => ({ ranges: [], content: seg }));
                    
                    // Debug: Log if we're splitting
                    if (finalSegments.length > 1) {
                        addDebugLog(`Splitting paragraph ${i} (${paragraphStyle}) into ${finalSegments.length} segments at <Br/> tags (had ${segments.length} content segments, ${rangeSegments.length} range segments)`);
                    } else if (hasLineBreaks && finalSegments.length === 1) {
                        addDebugLog(`Warning: Paragraph ${i} has line breaks but wasn't split (content: "${contentWithBreaks.substring(0, 100)}...")`);
                    }
                    
                    // Create one cell per segment
                    for (let segmentIndex = 0; segmentIndex < finalSegments.length; segmentIndex++) {
                        const segment = finalSegments[segmentIndex];
                        
                        // Create cleanText for empty check (without excessive whitespace)
                        const cleanText = segment.content
                            .replace(/[\r\n]+/g, ' ')
                            .replace(/\s+/g, ' ')
                            .trim();
                        
                        // Skip completely empty segments (but keep segments with only whitespace if they're meaningful)
                        // Only skip if it's not the first segment and has no content
                        if (!cleanText && segmentIndex > 0 && segment.ranges.length === 0) {
                            addDebugLog(`Skipping empty segment ${segmentIndex} of paragraph ${i}`);
                            continue;
                        }
                        
                        // Use simple sequential numbering for all cells
                        globalCellIndex++;
                        const cellId = `biblica 1:${globalCellIndex}`;
                        
                        // Build HTML for this segment
                        let inlineHTML: string;
                        if (segment.ranges.length > 0) {
                            inlineHTML = buildInlineHTMLFromRanges(segment.ranges);
                        } else {
                            // Fallback: escape HTML (no <br /> needed since we split at breaks)
                            inlineHTML = escapeHtml(segment.content);
                        }
                        
                        // Only add <br /> if this is not the last segment (to preserve structure)
                        const isLastSegment = segmentIndex === finalSegments.length - 1;
                        const htmlContent = `<p class="biblica-paragraph" data-paragraph-style="${paragraphStyle}" data-story-id="${story.id}" data-segment-index="${segmentIndex}" data-is-last-segment="${isLastSegment}">${inlineHTML}</p>`;
                        
                        const cellMetadata = {
                            id: cellId,
                            type: CodexCellTypes.TEXT,
                            edits: [],
                            cellLabel: globalCellIndex.toString(), // Use sequential number as label
                            storyId: story.id,
                            paragraphId: paragraph.id,
                            appliedParagraphStyle: paragraphStyle,
                            data: {
                                originalContent: cleanText || segment.content,
                                sourceFile: studyBibleFile?.name || 'unknown',
                                // Minimal structure needed for export
                                idmlStructure: {
                                    storyId: story.id,
                                    paragraphId: paragraph.id,
                                    paragraphStyleRange: {
                                        appliedParagraphStyle: paragraphStyle,
                                        // Only keep dataAfter if present and this is the last segment
                                        dataAfter: (isLastSegment ? paragraph.paragraphStyleRange.dataAfter : undefined)
                                    }
                                },
                                // Minimal relationships needed for export
                                relationships: {
                                    parentStory: story.id,
                                    storyOrder: stories.indexOf(story),
                                    paragraphOrder: i,
                                    segmentIndex: segmentIndex, // Track which segment this is within the paragraph
                                    totalSegments: finalSegments.length, // Track total segments for this paragraph
                                },
                                // Minimal context - only what's needed for identification
                                documentContext: {
                                    originalHash: htmlRepresentation.originalHash,
                                    importerType: 'biblica-experimental',
                                    fileName: studyBibleFile?.name || 'unknown',
                                }
                            }
                        };
                        
                        const cell = createProcessedCell(cellId, htmlContent, cellMetadata as any);
                        const images = await extractImagesFromHtml(htmlContent);
                        cell.images = images;
                        cells.push(cell);
                        addDebugLog(`Created paragraph segment cell: ${cellId} (segment ${segmentIndex + 1}/${finalSegments.length})`);
                    }
                }
            }
        }
        return cells;
    }, [addDebugLog, studyBibleFile]);

    /**
     * Parse translated bible file and extract verse content
     * Parses IDML file and extracts ONLY bible verses (ignores notes, titles, etc.)
     * Returns verse map and footnotes map for verse labels (e.g., "MAT 1:1")
     */
    const parseTranslatedBible = useCallback(async (file: File): Promise<{ verseMap: Map<string, string>; footnotesMap: Map<string, string[]> }> => {
        addDebugLog(`Parsing translated bible file: ${file.name}`);
        
        try {
            // Step 1: Read file content
            const arrayBuffer = await file.arrayBuffer();
            addDebugLog(`Translated Bible ArrayBuffer size: ${arrayBuffer.byteLength}`);
            
            // Validate ZIP signature
            const uint8Array = new Uint8Array(arrayBuffer);
            const firstBytes = Array.from(uint8Array.slice(0, 4)).map(b => String.fromCharCode(b)).join('');
            if (firstBytes !== 'PK\u0003\u0004') {
                throw new Error('The translated Bible file does not appear to be a valid IDML file');
            }
            
            // Step 2: Parse IDML
            const parser = new IDMLParser({
                preserveAllFormatting: true,
                preserveObjectIds: true,
                validateRoundTrip: false,
                strictMode: false
            });
            
            parser.setDebugCallback((msg) => addDebugLog(`[Translated Bible Parser] ${msg}`));
            
            const document = await parser.parseIDML(arrayBuffer);
            addDebugLog(`Parsed translated Bible: ${document.stories.length} stories`);
            
            // Step 3: Extract verses from all stories
            const verseMap = new Map<string, string>();
            const footnotesMap = new Map<string, string[]>(); // Map verse labels to footnote XML arrays
            let currentBook = '';
            
            for (const story of document.stories) {
                let currentChapter = '1';
                
                for (const paragraph of story.paragraphs) {
                    const paragraphStyle = paragraph.paragraphStyleRange.appliedParagraphStyle;
                    
                    // Check for book abbreviation (meta:bk)
                    if (paragraphStyle.includes('meta%3abk') || paragraphStyle.includes('meta:bk')) {
                        const bookAbbrev = paragraph.paragraphStyleRange.content.trim();
                        if (bookAbbrev && bookAbbrev.length >= 2 && bookAbbrev.length <= 4) {
                            currentBook = bookAbbrev;
                            addDebugLog(`Found book abbreviation in translated Bible: ${currentBook}`);
                        }
                        continue;
                    }
                    
                    // Extract chapter number from paragraph if it contains chapter markers
                    // Look for cv%3adc style in character style ranges
                    const characterRanges = paragraph.characterStyleRanges || [];
                    for (const range of characterRanges) {
                        const style = range.appliedCharacterStyle || '';
                        if (style.includes('cv%3adc') || style.includes('cv:dc')) {
                            const chapterNum = range.content.trim();
                            if (chapterNum && /^\d+$/.test(chapterNum)) {
                                currentChapter = chapterNum;
                                addDebugLog(`Found chapter ${currentChapter} in translated Bible`);
                                break;
                            }
                        }
                    }
                    
                    // Skip non-verse paragraphs (titles, notes, etc.)
                    // Only process paragraphs that contain verse segments
                    const verseSegments = (paragraph.metadata as any)?.biblicaVerseSegments;
                    if (!verseSegments || !Array.isArray(verseSegments) || verseSegments.length === 0) {
                        continue;
                    }
                    
                    // Extract verses from this paragraph
                    for (const verse of verseSegments) {
                        const { bookAbbreviation, chapterNumber, verseNumber, verseContent, verseStructureXml, footnotes, beforeVerse, afterVerse } = verse;
                        
                        // Use book from verse segment if available, otherwise use current book
                        const book = bookAbbreviation || currentBook;
                        // Use chapter from verse segment if available, otherwise use current chapter
                        const chapter = chapterNumber || currentChapter;
                        
                        if (!book || !chapter || !verseNumber) {
                            addDebugLog(`Skipping verse with missing metadata: book=${book}, chapter=${chapter}, verse=${verseNumber}`);
                            continue;
                        }
                        
                        // Create verse label (e.g., "MAT 1:1") - must match Study Bible format
                        const verseLabel = `${book} ${chapter}:${verseNumber}`;
                        
                        // Replace &nbsp; entities (non-breaking spaces) with regular spaces for display
                        // NOTE: &nbsp; entities are preserved in verseStructureXml for round-trip export
                        // They are only replaced here in the displayed value (verseContentWithBreaks) for Codex editor
                        const cleanedVerseContent = verseContent.replace(/&nbsp;/gi, ' ').replace(/\u00A0/g, ' ');
                        
                        // Preserve verse content structure - convert newlines to <br/> tags
                        // The verseContent already has newlines from <Br/> tags preserved by the parser
                        // We need to preserve these as HTML <br/> tags for the codex cells
                        let verseContentWithBreaks = cleanedVerseContent;
                        
                        // Convert newlines to <br/> tags while preserving the structure
                        // Don't trim lines - preserve leading/trailing spaces within lines
                        verseContentWithBreaks = cleanedVerseContent
                            .split('\n')
                            .map((line: string) => {
                                // Preserve the line as-is (don't trim) but escape HTML
                                return escapeHtml(line);
                            })
                            .join('<br/>');
                        
                        // If content is empty or just whitespace, skip
                        const trimmedContent = cleanedVerseContent.trim();
                        if (!trimmedContent || trimmedContent.length === 0) {
                            continue;
                        }
                        
                        // Build full verse structure XML (beforeVerse + verseStructureXml + afterVerse)
                        // This preserves footnotes in their original positions
                        let fullVerseStructureXml: string | undefined;
                        if (verseStructureXml) {
                            fullVerseStructureXml = (beforeVerse || '') + verseStructureXml + (afterVerse || '');
                            if (fullVerseStructureXml) {
                                addDebugLog(`Preserved full verse structure for ${verseLabel} (${fullVerseStructureXml.length} chars)`);
                            }
                        }
                        
                        // If verse already exists (may span paragraphs), append content
                        if (verseMap.has(verseLabel)) {
                            const existingContent = verseMap.get(verseLabel)!;
                            // Append with space separator if needed
                            verseContentWithBreaks = existingContent + ' ' + verseContentWithBreaks;
                            addDebugLog(`Appending to verse ${verseLabel} (verse spans multiple paragraphs)`);
                            
                            // For structure XML, also append if exists
                            if (fullVerseStructureXml) {
                                const existingStructure = footnotesMap.get(verseLabel + '_structure');
                                if (existingStructure && existingStructure.length > 0) {
                                    fullVerseStructureXml = existingStructure[0] + fullVerseStructureXml;
                                }
                            }
                        }
                        
                        // Store verse content (preserving structure)
                        verseMap.set(verseLabel, verseContentWithBreaks);
                        
                        // Store full verse structure XML (with footnotes in original positions)
                        // The structure includes beforeVerse + verseStructureXml + afterVerse
                        // This will be used to replace the entire verse section in export
                        if (fullVerseStructureXml && fullVerseStructureXml.length > 0) {
                            // Use a special key format to store structure separately
                            footnotesMap.set(verseLabel + '_structure', [fullVerseStructureXml]);
                        }
                        
                        // Store footnotes if present (for backward compatibility)
                        if (footnotes && Array.isArray(footnotes) && footnotes.length > 0) {
                            // If verse already exists, merge footnotes
                            if (footnotesMap.has(verseLabel)) {
                                const existingFootnotes = footnotesMap.get(verseLabel)!;
                                footnotesMap.set(verseLabel, [...existingFootnotes, ...footnotes]);
                            } else {
                                footnotesMap.set(verseLabel, [...footnotes]);
                            }
                            addDebugLog(`Extracted ${footnotes.length} footnote(s) for verse ${verseLabel}`);
                        }
                        
                        addDebugLog(`Extracted verse ${verseLabel}: "${verseContentWithBreaks.substring(0, 50)}..."${fullVerseStructureXml ? ' (with full structure)' : ''}`);
                        
                        // Update current chapter if this verse has a different chapter
                        if (chapterNumber && chapterNumber !== currentChapter) {
                            currentChapter = chapterNumber;
                        }
                    }
                }
            }
            
            addDebugLog(`Successfully extracted ${verseMap.size} verses from translated Bible`);
            addDebugLog(`Extracted footnotes for ${footnotesMap.size} verses`);
            
            // Return both verse map and footnotes map
            return { verseMap, footnotesMap };
            
        } catch (error) {
            addDebugLog(`Error parsing translated Bible: ${error instanceof Error ? error.message : 'Unknown error'}`);
            throw error;
        }
    }, [addDebugLog]);

    const handleImport = useCallback(async () => {
        if (!studyBibleFile) {
            alert('Please select a Study Bible file (IDML format)');
            return;
        }

        setIsProcessing(true);
        setProgress('Starting import...');
        
        try {
            addDebugLog('Starting Biblica import process...');
            addDebugLog(`Study Bible: ${studyBibleFile.name}`);
            if (translatedBibleFile) {
                addDebugLog(`Translated Bible: ${translatedBibleFile.name}`);
            } else {
                addDebugLog('Translated Bible: Not provided (will create empty codex cells)');
            }
            
            // Step 1: Parse translated bible if provided (for populating codex file)
            let verseMap = new Map<string, string>();
            let footnotesMap = new Map<string, string[]>();
            if (translatedBibleFile) {
                setProgress('Parsing translated bible file...');
                try {
                    const result = await parseTranslatedBible(translatedBibleFile);
                    verseMap = result.verseMap;
                    footnotesMap = result.footnotesMap;
                    addDebugLog(`Parsed ${verseMap.size} verses from translated bible`);
                    addDebugLog(`Extracted footnotes for ${footnotesMap.size} verses`);
                } catch (parseError) {
                    addDebugLog(`Warning: Failed to parse translated bible: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
                    addDebugLog('Continuing with empty verse map...');
                }
            }
            
            // Step 2: Read Study Bible file content
            setProgress('Reading Study Bible IDML file...');
            addDebugLog(`Reading file: ${studyBibleFile.name}, Size: ${studyBibleFile.size}`);
            
            // Read as ArrayBuffer to preserve binary data
            const arrayBuffer = await studyBibleFile.arrayBuffer();
            addDebugLog(`ArrayBuffer size: ${arrayBuffer.byteLength}`);
            
            // Convert to Uint8Array to check ZIP signature
            const uint8Array = new Uint8Array(arrayBuffer);
            const firstBytes = Array.from(uint8Array.slice(0, 4)).map(b => String.fromCharCode(b)).join('');
            addDebugLog(`First 4 bytes: ${firstBytes}`);
            
            // Validate ZIP signature (PK)
            if (firstBytes !== 'PK\u0003\u0004') {
                throw new Error('The selected file does not appear to be a valid IDML file. IDML files should be ZIP-compressed starting with PK');
            }
            
            // Step 3: Parse IDML
            setProgress('Parsing Study Bible IDML content...');
            addDebugLog('Creating Biblica IDML parser...');
            const parser = new IDMLParser({
                preserveAllFormatting: true,
                preserveObjectIds: true,
                validateRoundTrip: false,
                strictMode: false
            });
            
            // Set debug callback to capture parser logs
            parser.setDebugCallback(addDebugLog);
            
            addDebugLog('Parsing Study Bible IDML content from ArrayBuffer...');
            let document;
            try {
                document = await parser.parseIDML(arrayBuffer);
            } catch (parseError) {
                addDebugLog(`Parser error: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
                addDebugLog(`Parser error stack: ${parseError instanceof Error ? parseError.stack : 'No stack'}`);
                throw parseError;
            }
            
            // Check if we actually got any content
            if (document.stories.length === 0) {
                addDebugLog('WARNING: No stories found in document!');
                throw new Error('No stories found in the Study Bible IDML file. The file may be corrupted or empty.');
            }
            
            // Check if stories have content
            let totalParagraphs = 0;
            for (const story of document.stories) {
                totalParagraphs += story.paragraphs.length;
            }
            
            if (totalParagraphs === 0) {
                addDebugLog('WARNING: No paragraphs found in any story!');
                throw new Error('No paragraphs found in the Study Bible IDML file. The file may be corrupted or empty.');
            }
            
            // Step 4: Convert to HTML
            setProgress('Converting to HTML representation...');
            const htmlMapper = new HTMLMapper();
            const htmlRepresentation = htmlMapper.convertToHTML(document);
            
            // Step 5: Create source cells from Study Bible stories
            setProgress('Creating source notebook cells from Study Bible...');
            let sourceCells;
            try {
                sourceCells = await createCellsFromStories(document.stories, htmlRepresentation, document, verseMap, footnotesMap);
            } catch (cellError) {
                addDebugLog(`Cell creation error: ${cellError instanceof Error ? cellError.message : 'Unknown error'}`);
                addDebugLog(`Cell creation error stack: ${cellError instanceof Error ? cellError.stack : 'No stack'}`);
                throw cellError;
            }
            
            if (sourceCells.length === 0) {
                addDebugLog('WARNING: No cells were created!');
                throw new Error('No cells were created from the parsed content. Check the cell creation logic.');
            }
            
            // Step 6: Create codex cells (target file) with translated content
            setProgress('Creating codex notebook cells...');
            const codexCells = sourceCells.map((cell, index) => {
                const metadata = cell.metadata;
                const isBibleVerse = metadata?.isBibleVerse;
                const verseId = metadata?.verseId;
                
                // For bible verses, populate with translated content if available
                let codexContent = '';
                if (isBibleVerse && verseId && verseMap.has(verseId)) {
                    const translatedVerse = verseMap.get(verseId)!;
                    // Preserve structure (br tags, etc.) from translated bible
                    codexContent = translatedVerse;
                    addDebugLog(`Matched verse ${verseId} with translated content`);
                }
                
                // Get footnotes for this verse if available
                const cellFootnotes = isBibleVerse && verseId ? footnotesMap.get(verseId) : undefined;
                // Get full verse structure XML (with footnotes in original positions)
                const verseStructureXml = isBibleVerse && verseId ? footnotesMap.get(verseId + '_structure')?.[0] : undefined;
                
                return {
                    id: cell.id,
                    content: codexContent,
                    metadata: {
                        ...metadata,
                        // Mark Bible verses as locked
                        isLocked: isBibleVerse ? true : undefined,
                        originalContent: cell.content,
                        // Mark that this came from translated bible
                        translatedBibleFile: translatedBibleFile?.name || null,
                        // Preserve footnotes from translated Bible (for backward compatibility)
                        footnotes: cellFootnotes || metadata.footnotes || undefined,
                        // Preserve full verse structure XML (with footnotes in original positions)
                        verseStructureXml: verseStructureXml || metadata.verseStructureXml || undefined
                    }
                };
            });
            
            setProgress('Import completed successfully!');

            // Complete the import
            if (onComplete) {
                addDebugLog('Calling onComplete...');
                addDebugLog(`Source cells count: ${sourceCells.length}`);
                addDebugLog(`Codex cells count: ${codexCells.length}`);
                addDebugLog(`Document ID: ${document.id}`);
                addDebugLog(`Stories count: ${document.stories.length}`);
                
                try {
                    // Preserve full metadata structure (don't simplify)
                    const simplifiedSourceCells = sourceCells.map(cell => ({
                        id: cell.id,
                        content: cell.content,
                        metadata: cell.metadata // Keep the full metadata structure
                    }));
                    
                    addDebugLog(`Simplified source cells count: ${simplifiedSourceCells.length}`);
                    
                    const baseName = sanitizeFileName(studyBibleFile.name.replace(/\.idml$/i, ''));
                    const notebookName = sanitizeFileName(`${baseName}-biblica`);
                    // Add -biblica suffix to originalFileName to match naming convention (e.g., "mat-john.idml" -> "mat-john-biblica.idml")
                    // This ensures the saved file in attachments matches what the exporter will look for
                    const originalFileName = studyBibleFile.name.replace(/\.idml$/i, '-biblica.idml');
                    addDebugLog(`Base name: "${baseName}"`);
                    addDebugLog(`Notebook name: "${notebookName}"`);
                    addDebugLog(`Original file name: "${originalFileName}"`);
                    
                    const result = {
                        source: { 
                            name: notebookName, 
                            cells: simplifiedSourceCells,
                            metadata: {
                                id: `biblica-source-${Date.now()}`,
                                originalFileName: originalFileName,
                                originalFileData: arrayBuffer,
                                importerType: 'biblica',
                                createdAt: new Date().toISOString(),
                                documentId: document.id,
                                storyCount: document.stories.length,
                                originalHash: document.originalHash,
                                totalCells: simplifiedSourceCells.length,
                                fileType: 'biblica'
                            }
                        },
                        codex: { 
                            name: notebookName,
                            cells: codexCells,
                            metadata: {
                                id: `biblica-codex-${Date.now()}`,
                                originalFileName: originalFileName,
                                translatedBibleFileName: translatedBibleFile?.name || null,
                                importerType: 'biblica',
                                createdAt: new Date().toISOString(),
                                documentId: document.id,
                                storyCount: document.stories.length,
                                originalHash: document.originalHash,
                                totalCells: codexCells.length,
                                fileType: 'biblica',
                                isCodex: true
                            }
                        }
                    };
                    
                    addDebugLog(`Source notebook name: "${result.source.name}"`);
                    addDebugLog(`Codex notebook name: "${result.codex.name}"`);
                    
                    addDebugLog('Import completed successfully!');
                    addDebugLog(`Result size: ${JSON.stringify(result).length} characters`);
                    addDebugLog(`Source cells count: ${result.source.cells.length}`);
                    addDebugLog(`Codex cells count: ${result.codex.cells.length}`);
                    
                    // Store the result and show complete button
                    setImportResult(result);
                    setShowCompleteButton(true);
                    addDebugLog('Import result stored. Click "Complete Import" to finish.');
                } catch (onCompleteError) {
                    addDebugLog(`onComplete error: ${onCompleteError instanceof Error ? onCompleteError.message : 'Unknown error'}`);
                    addDebugLog(`onComplete error stack: ${onCompleteError instanceof Error ? onCompleteError.stack : 'No stack'}`);
                    addDebugLog(`onComplete error type: ${typeof onCompleteError}`);
                    addDebugLog(`onComplete error string: ${String(onCompleteError)}`);
                    throw onCompleteError;
                }
            }
        } catch (error) {
            addDebugLog(`Import error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            addDebugLog(`Import error stack: ${error instanceof Error ? error.stack : 'No stack'}`);
            alert(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            setIsProcessing(false);
        } finally {
            setIsProcessing(false);
        }
    }, [studyBibleFile, translatedBibleFile, onComplete, addDebugLog, createCellsFromStories, parseTranslatedBible]);

    const handleCompleteImport = useCallback(() => {
        if (importResult && onComplete) {
            try {
                // If multiple pairs are present, pass them through
                onComplete(importResult);
                addDebugLog('Import completed and window will close.');
            } catch (error) {
                addDebugLog(`Error completing import: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
    }, [importResult, onComplete, addDebugLog]);

    return (
        <div className="container mx-auto p-6 max-w-4xl space-y-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <FileText className="h-6 w-6" />
                        Biblica Importer
                    </h1>
                    <p className="text-muted-foreground">
                        Import Study Bible (IDML) and Translated Bible files
                    </p>
                </div>
                <Button onClick={onCancel} className="flex items-center gap-2">
                    <ArrowLeft className="h-4 w-4" />
                    Back to Home
                </Button>
            </div>

            <Alert>
                <BookOpen className="h-4 w-4" />
                <AlertDescription>
                    <strong>Two-File Import:</strong> This importer supports two-file import:
                    <ul className="list-disc list-inside mt-2 space-y-1">
                        <li><strong>Study Bible (IDML):</strong> Populates source file with all notes and bible verses</li>
                        <li><strong>Translated Bible:</strong> Populates target/codex file with translated verse content (format TBD)</li>
                    </ul>
                </AlertDescription>
            </Alert>

            {/* Study Bible File Input */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <BookOpen className="h-5 w-5" />
                        Study Bible File (IDML) - Required
                    </CardTitle>
                    <CardDescription>
                        Select the Biblica Study Bible file in IDML format. This will populate the source file with all notes and bible verses, mapped by verse labels (e.g., MAT 1:1).
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center">
                        <input
                            type="file"
                            accept=".idml"
                            onChange={handleStudyBibleSelect}
                            className="hidden"
                            id="study-bible-file-input"
                            disabled={isProcessing}
                        />
                        <label
                            htmlFor="study-bible-file-input"
                            className="cursor-pointer inline-flex flex-col items-center gap-2"
                        >
                            <Upload className="h-12 w-12 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">
                                Click to select Study Bible IDML file or drag and drop
                            </span>
                        </label>
                    </div>

                    {studyBibleFile && (
                        <div className="space-y-2">
                            <div className="text-sm font-medium">Selected Study Bible File</div>
                            <div className="flex items-center gap-2 p-2 bg-muted/50 rounded text-sm">
                                <FileText className="h-4 w-4 text-muted-foreground" />
                                <span className="flex-1">{studyBibleFile.name}</span>
                                <span className="text-muted-foreground">
                                    {(studyBibleFile.size / 1024 / 1024).toFixed(2)} MB
                                </span>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Translated Bible File Input */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Languages className="h-5 w-5" />
                        Translated Bible File - Optional
                    </CardTitle>
                    <CardDescription>
                        Select the translated Bible file (IDML format). This will populate the target/codex file with translated verse content, matching verses by their labels (e.g., MAT 1:1). The structure (br tags, etc.) will be preserved from the translated file.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center">
                        <input
                            type="file"
                            accept=".idml"
                            onChange={handleTranslatedBibleSelect}
                            className="hidden"
                            id="translated-bible-file-input"
                            disabled={isProcessing}
                        />
                        <label
                            htmlFor="translated-bible-file-input"
                            className="cursor-pointer inline-flex flex-col items-center gap-2"
                        >
                            <Upload className="h-12 w-12 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">
                                Click to select Translated Bible file or drag and drop
                            </span>
                            <span className="text-xs text-muted-foreground/75 italic">
                                (IDML format)
                            </span>
                        </label>
                    </div>

                    {translatedBibleFile && (
                        <div className="space-y-2">
                            <div className="text-sm font-medium">Selected Translated Bible File</div>
                            <div className="flex items-center gap-2 p-2 bg-muted/50 rounded text-sm">
                                <FileText className="h-4 w-4 text-muted-foreground" />
                                <span className="flex-1">{translatedBibleFile.name}</span>
                                <span className="text-muted-foreground">
                                    {(translatedBibleFile.size / 1024 / 1024).toFixed(2)} MB
                                </span>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {isProcessing && (
                <Card>
                    <CardHeader>
                        <CardTitle>Import Progress</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Progress value={50} className="w-full" />
                        <p className="text-sm text-muted-foreground">{progress}</p>
                    </CardContent>
                </Card>
            )}

            {debugLogs.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle>Debug Information</CardTitle>
                        <CardDescription>
                            Real-time debug logs from the import process
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="bg-black text-green-400 p-4 rounded-lg font-mono text-xs max-h-64 overflow-y-auto">
                            {debugLogs.map((log, index) => (
                                <div key={index} className="mb-1">
                                    {log}
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            <div className="flex justify-end gap-3">
                <Button
                    onClick={onCancelImport}
                    disabled={isProcessing}
                >
                    Cancel Import
                </Button>
                <Button
                    onClick={handleImport}
                    disabled={!studyBibleFile || isProcessing}
                    className="flex items-center gap-2"
                >
                    {isProcessing ? (
                        <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                            Importing...
                        </>
                    ) : (
                        <>
                            <FileText className="h-4 w-4" />
                            Import Biblica Files
                        </>
                    )}
                </Button>
                {showCompleteButton && (
                    <Button
                        onClick={handleCompleteImport}
                        className="flex items-center gap-2 bg-green-600 hover:bg-green-700"
                    >
                        <FileText className="h-4 w-4" />
                        Complete Import
                    </Button>
                )}
            </div>
        </div>
    );
};
