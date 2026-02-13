/**
 * Biblica Importer Form Component
 * Provides UI for importing Biblica Study Bible (IDML) and Translated Bible files
 *
 * Features:
 * - Study Bible (IDML): Populates source file with all notes and bible verses
 * - Translated Bible: Populates target/codex file with translated verse content
 */

import React, { useState, useCallback } from "react";
import { ImporterComponentProps } from "../../types/plugin";
import { Button } from "../../../components/ui/button";
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
    BookOpen
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { IDMLParser } from './biblicaParser';
import { HTMLMapper } from './htmlMapper';
import { createProcessedCell, sanitizeFileName, createStandardCellId, addMilestoneCellsToNotebookPair } from '../../utils/workflowHelpers';
import { extractImagesFromHtml } from '../../utils/imageProcessor';
import { CodexCellTypes } from 'types/enums';
import {
    createNoteCellMetadata,
    type NoteCellMetadataParams
} from './cellMetadata';

/**
 * Escape HTML characters and convert newlines to <br> tags
 */
function escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    // Convert newlines to <br> tags for proper HTML rendering
    return div.innerHTML.replace(/\n/g, "<br>");
}

function buildInlineHTMLFromRanges(ranges: any[]): string {
    if (!Array.isArray(ranges) || ranges.length === 0) return "";

    // Build HTML from ranges (special-styled ranges already filtered out by parser)
    return ranges
        .map((r) => {
            const style = (r?.appliedCharacterStyle || "").toString();
            const content = (r?.content || "").toString();

            // Convert newline markers (from <Br />) to <br /> in HTML
            const text = content.replace(/\n/g, "<br />");
            const safeStyle = escapeHtml(style);

            // Do not escape the injected <br /> tags; escape other text portions only
            const safeText = text
                .split("<br />")
                .map((part: string) => escapeHtml(part))
                .join("<br />");

            return `<span class="idml-char" data-character-style="${safeStyle}">${safeText}</span>`;
        })
        .join("");
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
    wizardContext,
}) => {
    // Study Bible (IDML) - populates source file with notes
    const [studyBibleFile, setStudyBibleFile] = useState<File | null>(null);
    // NOTE: Translated Bible import removed - will use Bible Swapper later
    
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState<string>("");
    const [debugLogs, setDebugLogs] = useState<string[]>([]);
    const [importResult, setImportResult] = useState<any[] | null>(null);
    const [showCompleteButton, setShowCompleteButton] = useState(false);

    const addDebugLog = useCallback((message: string) => {
        const timestamp = new Date().toLocaleTimeString();
        const logMessage = `[${timestamp}] ${message}`;
        setDebugLogs((prev) => [...prev, logMessage]);
        // No console logging - only send to debug panel
    }, []);

    const handleStudyBibleSelect = useCallback(
        (event: React.ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            if (!file) return;

            if (!file.name.toLowerCase().endsWith(".idml")) {
                alert("Please select a valid IDML file (.idml extension)");
                return;
            }

            setStudyBibleFile(file);
            addDebugLog(`Study Bible file selected: ${file.name}`);
        },
        [addDebugLog]
    );

    // NOTE: handleTranslatedBibleSelect removed - will use Bible Swapper later

    /**
     * Create cells from Study Bible stories (populates source file with notes only)
     * Verses are detected and tracked for globalReferences assignment to notes, but cells are only created for notes
     */
    const createCellsFromStories = useCallback(async (
        stories: any[], 
        htmlRepresentation: any, 
        document: any,
        verseMap?: Map<string, string>, // Not used - kept for compatibility
        footnotesMap?: Map<string, string[]> // Not used - kept for compatibility
    ) => {
        const cells: any[] = [];
        let globalCellIndex = 0; // Global counter for sequential numbering across all content
        
        // Track current book and chapter for globalReferences
        let currentBook = '';
        let currentChapter = '1';
        
        // Track verse array for assigning to notes that come after bible text
        let currentVerseArray: string[] = [];
        let lastChapterSeen = '';
        let hasEncounteredVerses = false; // Track if we've seen any verses yet
        let hasEncounteredNotesSinceLastVerse = false; // Track if we've encountered notes since the last verse
        
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
                
                // FIRST: Check if this paragraph has verse segments - check chapter BEFORE updating currentChapter
                // This ensures we can detect chapter changes from verses themselves
                const verseSegments = (paragraph.metadata as any)?.biblicaVerseSegments;
                const isPartOfSpanningVerse = (paragraph.metadata as any)?.isPartOfSpanningVerse;
                const spanningVerseInfo = (paragraph.metadata as any)?.spanningVerseInfo;
                
                // Track if we detected a chapter from verse segments (to prioritize it over other sources)
                let chapterDetectedFromVerse = false;
                
                // Check chapter from verse segments BEFORE updating currentChapter from other sources
                if (verseSegments && Array.isArray(verseSegments) && verseSegments.length > 0) {
                    const firstVerse = verseSegments[0];
                    const verseChapter = firstVerse.chapterNumber;
                    
                    // If verse chapter exists
                    if (verseChapter) {
                        // Check if this is the first time we're encountering verses
                        const isFirstVerseEncounter = !hasEncounteredVerses;
                        
                        // Only reset array if we've encountered notes since the last verse
                        // This allows consecutive chapters (like 1 and 2) to be in the same array
                        if (verseChapter !== currentChapter && hasEncounteredNotesSinceLastVerse) {
                            currentVerseArray = [];
                            addDebugLog(`[RESET] Verse segments belong to new chapter ${verseChapter} (was ${currentChapter}) AFTER notes, resetting verse array`);
                        } else if (verseChapter !== currentChapter && !hasEncounteredNotesSinceLastVerse) {
                            addDebugLog(`[NO RESET] Verse segments belong to new chapter ${verseChapter} (was ${currentChapter}) but no notes in between, keeping array (current array length: ${currentVerseArray.length})`);
                        } else if (verseChapter === currentChapter) {
                            if (isFirstVerseEncounter) {
                                addDebugLog(`[FIRST VERSES] First verse segments encountered for chapter ${verseChapter}, will add to array`);
                            } else {
                                addDebugLog(`[SAME CHAPTER] Verse segments belong to same chapter ${verseChapter}, continuing to add verses (current array length: ${currentVerseArray.length})`);
                            }
                        }
                        currentChapter = verseChapter;
                        lastChapterSeen = verseChapter;
                        chapterDetectedFromVerse = true;
                        // Reset the flag since we're now processing verses
                        hasEncounteredNotesSinceLastVerse = false;
                    } else {
                        addDebugLog(`[WARNING] Verse segments found but no chapter number in first verse: ${JSON.stringify(firstVerse)}`);
                    }
                } else if (isPartOfSpanningVerse && spanningVerseInfo) {
                    // Check chapter from spanning verse BEFORE updating currentChapter
                    const spanningVerseChapter = spanningVerseInfo.chapterNumber;
                    
                    if (spanningVerseChapter) {
                        // Only reset array if we've encountered notes since the last verse
                        if (spanningVerseChapter !== currentChapter && hasEncounteredNotesSinceLastVerse) {
                            currentVerseArray = [];
                            addDebugLog(`[RESET] Spanning verse belongs to new chapter ${spanningVerseChapter} (was ${currentChapter}) AFTER notes, resetting verse array`);
                        } else if (spanningVerseChapter !== currentChapter && !hasEncounteredNotesSinceLastVerse) {
                            addDebugLog(`[NO RESET] Spanning verse belongs to new chapter ${spanningVerseChapter} (was ${currentChapter}) but no notes in between, keeping array`);
                        }
                        currentChapter = spanningVerseChapter;
                        lastChapterSeen = spanningVerseChapter;
                        chapterDetectedFromVerse = true;
                        // Reset the flag since we're now processing verses
                        hasEncounteredNotesSinceLastVerse = false;
                    }
                }
                
                // Update current book and chapter from paragraph metadata (AFTER checking verse segments)
                if ((paragraph.metadata as any)?.bookAbbreviation) {
                    currentBook = (paragraph.metadata as any).bookAbbreviation;
                }
                if ((paragraph.metadata as any)?.lastChapterNumber) {
                    const newChapter = (paragraph.metadata as any).lastChapterNumber;
                    // Only update if we didn't detect chapter from verses, or if metadata indicates a different chapter
                    if (!chapterDetectedFromVerse && newChapter !== currentChapter) {
                        // Only reset if we've encountered notes since last verse
                        if (hasEncounteredNotesSinceLastVerse) {
                            currentVerseArray = [];
                            addDebugLog(`[RESET] Chapter changed from ${currentChapter} to ${newChapter} (from metadata) AFTER notes, resetting verse array`);
                        } else {
                            addDebugLog(`[NO RESET] Chapter changed from ${currentChapter} to ${newChapter} (from metadata) but no notes in between, keeping array`);
                        }
                        currentChapter = newChapter;
                        lastChapterSeen = newChapter;
                    } else if (chapterDetectedFromVerse && newChapter !== currentChapter) {
                        // If verse said one chapter but metadata says another, only reset if notes were encountered
                        if (hasEncounteredNotesSinceLastVerse) {
                            currentVerseArray = [];
                            addDebugLog(`[RESET] Chapter mismatch: verse said ${currentChapter}, metadata says ${newChapter} AFTER notes, resetting array`);
                        } else {
                            addDebugLog(`[NO RESET] Chapter mismatch: verse said ${currentChapter}, metadata says ${newChapter} but no notes in between, keeping array`);
                        }
                        currentChapter = newChapter;
                        lastChapterSeen = newChapter;
                    }
                }
                
                // If currentBook is still empty, try to extract it from paragraph content
                // This handles cases like "GEN - New International Readers Version..." at the start of a book
                if (!currentBook) {
                    // Valid 3-letter Bible book codes
                    const validBookCodes = [
                        'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA',
                        '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO',
                        'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO',
                        'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL',
                        'MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH',
                        'PHP', 'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS',
                        '1PE', '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV'
                    ];
                    
                    // Try to extract book code from paragraph content
                    const paragraphContent = paragraph.characterStyleRanges
                        ?.map((r: any) => r.content || '')
                        .join('')
                        .trim() || '';
                    
                    // Check if content starts with a valid book code (e.g., "GEN - ..." or "GEN\n...")
                    const bookCodeMatch = paragraphContent.match(/^([A-Z0-9]{3})\s*[-–—\n]/);
                    if (bookCodeMatch && validBookCodes.includes(bookCodeMatch[1])) {
                        currentBook = bookCodeMatch[1];
                        addDebugLog(`Extracted book code from content: ${currentBook}`);
                    }
                }
                
                // Check for chapter markers in character style ranges
                const characterRanges = paragraph.characterStyleRanges || [];
                for (const range of characterRanges) {
                    const style = range.appliedCharacterStyle || '';
                    if (style.includes('cv%3adc') || style.includes('cv:dc')) {
                        const chapterNum = range.content.trim();
                        if (chapterNum && /^\d+$/.test(chapterNum)) {
                            // If chapter changed (different from what we're currently tracking), reset verse array
                            // But only if we didn't already detect chapter from verses, or if marker indicates different chapter
                            // AND only if we've encountered notes since the last verse
                            if (!chapterDetectedFromVerse && currentChapter !== chapterNum) {
                                if (hasEncounteredNotesSinceLastVerse) {
                                    currentVerseArray = [];
                                    addDebugLog(`[RESET] Chapter changed from ${currentChapter} to ${chapterNum} (from chapter marker) AFTER notes, resetting verse array`);
                                } else {
                                    addDebugLog(`[NO RESET] Chapter changed from ${currentChapter} to ${chapterNum} (from chapter marker) but no notes in between, keeping array`);
                                }
                                currentChapter = chapterNum;
                                lastChapterSeen = chapterNum;
                            } else if (chapterDetectedFromVerse && chapterNum !== currentChapter) {
                                // If verse said one chapter but marker says another, only reset if notes were encountered
                                if (hasEncounteredNotesSinceLastVerse) {
                                    currentVerseArray = [];
                                    addDebugLog(`[RESET] Chapter mismatch: verse said ${currentChapter}, marker says ${chapterNum} AFTER notes, resetting array`);
                                } else {
                                    addDebugLog(`[NO RESET] Chapter mismatch: verse said ${currentChapter}, marker says ${chapterNum} but no notes in between, keeping array`);
                                }
                                currentChapter = chapterNum;
                                lastChapterSeen = chapterNum;
                            }
                            addDebugLog(`Updated current chapter to ${currentChapter}`);
                            break;
                        }
                    }
                }
                
                if (verseSegments && Array.isArray(verseSegments) && verseSegments.length > 0) {
                    // Track verses for globalReferences assignment to notes (but don't create cells for them)
                    // Note: Chapter check and array reset already happened above
                    addDebugLog(`Found ${verseSegments.length} verse(s) in paragraph - tracking for globalReferences (not creating cells)`);
                    
                    for (const verse of verseSegments) {
                        const { bookAbbreviation, chapterNumber, verseNumber } = verse;
                        
                        // Add this verse to the current verse array for globalReferences assignment
                        // Always use the verse's own chapter number (don't fall back to currentChapter)
                        const finalVerseBook = bookAbbreviation || currentBook;
                        const finalVerseChapter = chapterNumber; // Use verse's own chapter, don't fall back
                        
                        // Debug: Log verse details before adding
                        addDebugLog(`Processing verse: bookAbbreviation=${bookAbbreviation}, chapterNumber=${chapterNumber}, verseNumber=${verseNumber}, currentBook=${currentBook}, currentChapter=${currentChapter}`);
                        
                        if (finalVerseBook && finalVerseChapter && verseNumber) {
                            const verseRef = `${finalVerseBook} ${finalVerseChapter}:${verseNumber}`;
                            // Check if verse is already in array (shouldn't happen, but be safe)
                            if (!currentVerseArray.includes(verseRef)) {
                                currentVerseArray.push(verseRef);
                                hasEncounteredVerses = true;
                                addDebugLog(`✓ Added verse to array: ${verseRef} (array now has ${currentVerseArray.length} verses)`);
                            } else {
                                addDebugLog(`⚠ Verse already in array: ${verseRef} (skipping duplicate)`);
                            }
                        } else {
                            addDebugLog(`✗ Skipping verse - missing data: book=${finalVerseBook}, chapter=${finalVerseChapter}, verse=${verseNumber}`);
                        }
                    }
                    // Skip creating cells for verses - we only track them for globalReferences
                    continue;
                } else if (isPartOfSpanningVerse && spanningVerseInfo) {
                    // This paragraph is part of a verse that spans multiple paragraphs
                    // Track verse for globalReferences assignment (but don't create cells for it)
                    const { bookAbbreviation, chapterNumber, verseNumber, verseKey } = spanningVerseInfo;
                    addDebugLog(`Found paragraph part of spanning verse: ${verseKey} - tracking for globalReferences (not creating cell)`);
                    
                    // Note: Chapter check and array reset already happened above
                    // Always use the verse's own chapter number (don't fall back to currentChapter)
                    const spanningVerseBook = bookAbbreviation || currentBook;
                    const spanningVerseChapter = chapterNumber; // Use verse's own chapter, don't fall back
                    
                    // Add this verse to the current verse array (only if not already added)
                    if (spanningVerseBook && spanningVerseChapter && verseNumber) {
                        const verseRef = `${spanningVerseBook} ${spanningVerseChapter}:${verseNumber}`;
                        // Only add if not already in array (spanning verses might be processed multiple times)
                        if (!currentVerseArray.includes(verseRef)) {
                            currentVerseArray.push(verseRef);
                            hasEncounteredVerses = true;
                            addDebugLog(`Added spanning verse to array: ${verseRef} (array now has ${currentVerseArray.length} verses)`);
                        }
                    } else {
                        addDebugLog(`Skipping spanning verse - missing book/bookAbbreviation: ${spanningVerseBook}, chapter: ${spanningVerseChapter}, verse: ${verseNumber}`);
                    }
                    // Skip creating cells for spanning verses - we only track them for globalReferences
                    continue;
                } else {
                    // This is a note paragraph (non-verse content)
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
                    // IMPORTANT: Don't mark as "notes encountered" if it's just an empty break paragraph
                    if (!contentWithoutBreaks || contentWithoutBreaks.length === 0) {
                        addDebugLog(`Skipping empty paragraph ${i} (only contains <Br/> tags) - NOT marking as notes encountered`);
                        continue;
                    }
                    
                    // Only mark that we've encountered notes if the paragraph has actual content
                    hasEncounteredNotesSinceLastVerse = true;
                    addDebugLog(`Note paragraph detected with content, marking hasEncounteredNotesSinceLastVerse = true`);
                    
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
                        
                        // Use simple sequential numbering for cell labels (not IDs - IDs are UUIDs)
                        globalCellIndex++;
                        
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
                        
                        // Build globalReferences for note cell
                        // If we've encountered verses, use the verse array (e.g., ["GEN 1:1", "GEN 1:2", ... "GEN 2:25"])
                        // If we haven't encountered verses yet, use just the book abbreviation (e.g., "GEN")
                        let noteGlobalReferences: string[] = [];
                        if (hasEncounteredVerses && currentVerseArray.length > 0) {
                            // Use the accumulated verse array
                            noteGlobalReferences = [...currentVerseArray];
                            addDebugLog(`Note cell using verse array with ${currentVerseArray.length} verses`);
                        } else if (currentBook) {
                            // Before any verses, use just the book abbreviation without chapter number
                            noteGlobalReferences = [currentBook];
                            addDebugLog(`Note cell before verses, using book abbreviation: ${currentBook}`);
                        }
                        
                        // Extract chapter number for milestone detection
                        // Priority: Extract from first globalReference, fallback to currentChapter
                        let chapterNumber: string | undefined;
                        if (noteGlobalReferences.length > 0) {
                            const firstRef = noteGlobalReferences[0]; // e.g., "GEN 1:1" or "GEN"
                            const match = firstRef.match(/\s+(\d+):/); // Extract chapter number from "BOOK CH:V"
                            if (match) {
                                chapterNumber = match[1];
                            } else if (currentChapter) {
                                // If no chapter in reference but we have currentChapter, use it
                                chapterNumber = currentChapter;
                            }
                        } else if (currentChapter) {
                            // No globalReferences but we have currentChapter
                            chapterNumber = currentChapter;
                        }
                        
                        // Create cell metadata (generates UUID internally)
                        const { cellId, metadata: cellMetadata } = createNoteCellMetadata({
                            cellLabel: globalCellIndex.toString(), // Use sequential number as label
                            storyId: story.id,
                            paragraphId: paragraph.id,
                            appliedParagraphStyle: paragraphStyle,
                            originalText: cleanText || segment.content,
                            globalReferences: noteGlobalReferences,
                            sourceFileName: studyBibleFile?.name || 'unknown',
                            originalHash: htmlRepresentation.originalHash,
                            paragraphDataAfter: paragraph.paragraphStyleRange.dataAfter,
                            storyOrder: stories.indexOf(story),
                            paragraphOrder: i,
                            segmentIndex: segmentIndex,
                            totalSegments: finalSegments.length,
                            isLastSegment,
                            chapterNumber // Add chapter number for milestone detection
                        });
                        
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

    // NOTE: parseTranslatedBible function removed - will use Bible Swapper for verse content later

    const handleImport = useCallback(async () => {
        if (!studyBibleFile) {
            alert("Please select a Study Bible file (IDML format)");
            return;
        }

        setIsProcessing(true);
        setProgress("Starting import...");

        try {
            addDebugLog("Starting Biblica import process...");
            addDebugLog(`Study Bible: ${studyBibleFile.name}`);
            // NOTE: Translated Bible import removed - will use Bible Swapper later
            
            // Step 1: Read Study Bible file content
            setProgress('Reading Study Bible IDML file...');
            addDebugLog(`Reading file: ${studyBibleFile.name}, Size: ${studyBibleFile.size}`);

            // Read as ArrayBuffer to preserve binary data
            const arrayBuffer = await studyBibleFile.arrayBuffer();
            addDebugLog(`ArrayBuffer size: ${arrayBuffer.byteLength}`);

            // Convert to Uint8Array to check ZIP signature
            const uint8Array = new Uint8Array(arrayBuffer);
            const firstBytes = Array.from(uint8Array.slice(0, 4))
                .map((b) => String.fromCharCode(b))
                .join("");
            addDebugLog(`First 4 bytes: ${firstBytes}`);

            // Validate ZIP signature (PK)
            if (firstBytes !== "PK\u0003\u0004") {
                throw new Error(
                    "The selected file does not appear to be a valid IDML file. IDML files should be ZIP-compressed starting with PK"
                );
            }

            // Step 3: Parse IDML
            setProgress("Parsing Study Bible IDML content...");
            addDebugLog("Creating Biblica IDML parser...");
            const parser = new IDMLParser({
                preserveAllFormatting: true,
                preserveObjectIds: true,
                validateRoundTrip: false,
                strictMode: false,
            });

            // Set debug callback to capture parser logs
            parser.setDebugCallback(addDebugLog);

            addDebugLog("Parsing Study Bible IDML content from ArrayBuffer...");
            let document;
            try {
                document = await parser.parseIDML(arrayBuffer);
            } catch (parseError) {
                addDebugLog(
                    `Parser error: ${
                        parseError instanceof Error ? parseError.message : "Unknown error"
                    }`
                );
                addDebugLog(
                    `Parser error stack: ${
                        parseError instanceof Error ? parseError.stack : "No stack"
                    }`
                );
                throw parseError;
            }

            // Check if we actually got any content
            if (document.stories.length === 0) {
                addDebugLog("WARNING: No stories found in document!");
                throw new Error(
                    "No stories found in the Study Bible IDML file. The file may be corrupted or empty."
                );
            }

            // Check if stories have content
            let totalParagraphs = 0;
            for (const story of document.stories) {
                totalParagraphs += story.paragraphs.length;
            }

            if (totalParagraphs === 0) {
                addDebugLog("WARNING: No paragraphs found in any story!");
                throw new Error(
                    "No paragraphs found in the Study Bible IDML file. The file may be corrupted or empty."
                );
            }

            // Step 4: Convert to HTML
            setProgress("Converting to HTML representation...");
            const htmlMapper = new HTMLMapper();
            const htmlRepresentation = htmlMapper.convertToHTML(document);

            // Step 5: Create source cells from Study Bible stories
            setProgress('Creating source notebook cells from Study Bible...');
            let allCells;
            try {
                // NOTE: verseMap and footnotesMap removed - will use Bible Swapper later
                allCells = await createCellsFromStories(document.stories, htmlRepresentation, document);
            } catch (cellError) {
                addDebugLog(
                    `Cell creation error: ${
                        cellError instanceof Error ? cellError.message : "Unknown error"
                    }`
                );
                addDebugLog(
                    `Cell creation error stack: ${
                        cellError instanceof Error ? cellError.stack : "No stack"
                    }`
                );
                throw cellError;
            }
            
            if (allCells.length === 0) {
                addDebugLog('WARNING: No cells were created!');
                throw new Error('No cells were created from the parsed content. Check the cell creation logic.');
            }
            
            // Step 6: All cells are note cells (verses are tracked but not created as cells)
            // NOTE: Verses are detected and tracked for globalReferences assignment, but cells are only created for notes
            const noteCells = allCells; // All created cells are notes (verses are skipped)
            
            addDebugLog(`Created ${noteCells.length} note cells (verses tracked but not created as cells)`);
            
            if (noteCells.length === 0) {
                addDebugLog('WARNING: No note cells were found!');
                throw new Error('No note cells were found in the document.');
            }
            
            setProgress('Import completed successfully!');

            // Complete the import
            if (onComplete) {
                addDebugLog('Calling onComplete...');
                addDebugLog(`Note cells count: ${noteCells.length}`);
                addDebugLog(`Document ID: ${document.id}`);
                addDebugLog(`Stories count: ${document.stories.length}`);

                try {
                    // Preserve full metadata structure (don't simplify)
                    const simplifiedNoteCells = noteCells.map(cell => ({
                        id: cell.id,
                        content: cell.content,
                        images: cell.images,
                        metadata: cell.metadata // Keep the full metadata structure
                    }));
                    
                    addDebugLog(`Simplified note cells count: ${simplifiedNoteCells.length}`);
                    
                    // Remove .idml extension and any "-notes" or "_notes" suffix from filename
                    const rawBaseName = studyBibleFile.name.replace(/\.idml$/i, '');
                    const cleanBaseName = rawBaseName.replace(/[-_]?notes$/i, '');
                    const baseName = sanitizeFileName(cleanBaseName);
                    // Use the original file name as-is - importer type is stored in metadata
                    const originalFileName = studyBibleFile.name;
                    addDebugLog(`Raw base name: "${rawBaseName}"`);
                    addDebugLog(`Clean base name (notes removed): "${baseName}"`);
                    addDebugLog(`Original file name: "${originalFileName}"`);
                    
                    // Create notebook pair for notes only
                    // NOTE: Verses file removed - will use Bible Swapper for verse content later
                    const notebookPairs = [];
                    
                    // Pair 1: Notes (source only, empty codex)
                    if (simplifiedNoteCells.length > 0) {
                        notebookPairs.push({
                            source: { 
                                name: baseName, 
                                cells: simplifiedNoteCells,
                                metadata: {
                                    id: uuidv4(),
                                    originalFileName: originalFileName,
                                    sourceFile: originalFileName,
                                    originalFileData: arrayBuffer,
                                    importerType: 'biblica',
                                    createdAt: new Date().toISOString(),
                                    importContext: {
                                        importerType: 'biblica',
                                        fileName: originalFileName,
                                        originalFileName: originalFileName,
                                        originalHash: document.originalHash,
                                        documentId: document.id,
                                        importTimestamp: new Date().toISOString(),
                                        contentType: 'notes',
                                    },
                                    documentId: document.id,
                                    storyCount: document.stories.length,
                                    originalHash: document.originalHash,
                                    totalCells: simplifiedNoteCells.length,
                                    fileType: 'biblica',
                                    contentType: 'notes' // Mark as notes content
                                }
                            },
                            codex: { 
                                name: baseName,
                                cells: simplifiedNoteCells.map(cell => ({
                                    id: cell.id,
                                    content: '', // Empty codex for notes
                                    images: cell.images,
                                    metadata: {
                                        ...cell.metadata,
                                        originalContent: cell.content
                                    }
                                })),
                                metadata: {
                                    id: uuidv4(),
                                    originalFileName: originalFileName,
                                    sourceFile: originalFileName,
                                    importerType: 'biblica',
                                    createdAt: new Date().toISOString(),
                                    importContext: {
                                        importerType: 'biblica',
                                        fileName: originalFileName,
                                        originalFileName: originalFileName,
                                        originalHash: document.originalHash,
                                        documentId: document.id,
                                        importTimestamp: new Date().toISOString(),
                                        contentType: 'notes',
                                    },
                                    documentId: document.id,
                                    storyCount: document.stories.length,
                                    originalHash: document.originalHash,
                                    totalCells: simplifiedNoteCells.length,
                                    fileType: 'biblica',
                                    isCodex: true,
                                    contentType: 'notes' // Mark as notes content
                                }
                            }
                        });
                    }
                    
                    // NOTE: Pair 2 (Verses) commented out - will use Bible Swapper for verse content later
                    // Only creating the Notes file now
                    
                    addDebugLog(`Created ${notebookPairs.length} notebook pair(s) (notes only)`);
                    notebookPairs.forEach((pair, index) => {
                        addDebugLog(`Pair ${index + 1}: "${pair.source.name}" - ${pair.source.cells.length} source cells, ${pair.codex.cells.length} codex cells`);
                    });
                    
                    // Add milestone cells to notebook pairs
                    addDebugLog('Adding milestone cells to notebook pairs...');
                    const notebookPairsWithMilestones = notebookPairs.map(pair => {
                        const pairWithMilestones = addMilestoneCellsToNotebookPair(pair);
                        addDebugLog(`Added milestones to "${pair.source.name}": ${pairWithMilestones.source.cells.length} source cells (was ${pair.source.cells.length}), ${pairWithMilestones.codex.cells.length} codex cells (was ${pair.codex.cells.length})`);
                        return pairWithMilestones;
                    });
                    
                    addDebugLog('Import completed successfully!');
                    
                    // Store the result and show complete button
                    setImportResult(notebookPairsWithMilestones);
                    setShowCompleteButton(true);
                    addDebugLog('Import result stored. Click "Complete Import" to finish.');
                } catch (onCompleteError) {
                    addDebugLog(
                        `onComplete error: ${
                            onCompleteError instanceof Error
                                ? onCompleteError.message
                                : "Unknown error"
                        }`
                    );
                    addDebugLog(
                        `onComplete error stack: ${
                            onCompleteError instanceof Error ? onCompleteError.stack : "No stack"
                        }`
                    );
                    addDebugLog(`onComplete error type: ${typeof onCompleteError}`);
                    addDebugLog(`onComplete error string: ${String(onCompleteError)}`);
                    throw onCompleteError;
                }
            }
        } catch (error) {
            addDebugLog(
                `Import error: ${error instanceof Error ? error.message : "Unknown error"}`
            );
            addDebugLog(`Import error stack: ${error instanceof Error ? error.stack : "No stack"}`);
            alert(`Import failed: ${error instanceof Error ? error.message : "Unknown error"}`);
            setIsProcessing(false);
        } finally {
            setIsProcessing(false);
        }
    }, [studyBibleFile, onComplete, addDebugLog, createCellsFromStories]);

    const handleCompleteImport = useCallback(() => {
        if (importResult && onComplete) {
            try {
                // importResult is now an array of notebook pairs
                // Pass them as an array to onComplete
                if (Array.isArray(importResult)) {
                    onComplete(importResult);
                } else {
                    // Fallback for old format (single pair)
                    onComplete(importResult);
                }
                addDebugLog('Import completed and window will close.');
            } catch (error) {
                addDebugLog(
                    `Error completing import: ${
                        error instanceof Error ? error.message : "Unknown error"
                    }`
                );
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
                        Import Biblica Study Bible Notes (IDML format)
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
                    <strong>Notes Import:</strong> This importer creates a source file containing notes and study content:
                    <ul className="list-disc list-inside mt-2 space-y-1">
                        <li><strong>Study Bible (IDML):</strong> Required. Creates a notes source file containing all non-verse content (notes, titles, commentary, etc.)</li>
                        <li><strong>Bible Verses:</strong> Use the Bible Swapper feature later to add translated Bible verses</li>
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
                        Select the Biblica Study Bible file in IDML format. This will populate the
                        source file with all notes and bible verses, mapped by verse labels (e.g.,
                        MAT 1:1).
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

            {/* NOTE: Translated Bible File Input removed - will use Bible Swapper later */}

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
                <Button onClick={onCancelImport} disabled={isProcessing}>
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
