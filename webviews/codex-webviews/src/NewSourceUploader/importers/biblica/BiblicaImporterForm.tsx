/**
 * Biblica Importer Form Component - Minimal Test Version
 * Provides UI for importing Biblica IDML files with round-trip validation
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
    ArrowLeft
} from 'lucide-react';
import { IDMLParser } from './biblicaParser';
import { HTMLMapper } from './htmlMapper';
import { createProcessedCell, sanitizeFileName, createStandardCellId } from '../../utils/workflowHelpers';
import { extractImagesFromHtml } from '../../utils/imageProcessor';

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
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
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

    const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        
        if (!file.name.toLowerCase().endsWith('.idml')) {
            alert('Please select a valid IDML file (.idml extension)');
            return;
        }
        
        setSelectedFile(file);
    }, []);

    const createCellsFromStories = useCallback(async (stories: any[], htmlRepresentation: any, document: any) => {
        const cells: any[] = [];
        let globalCellIndex = 0; // Global counter for sequential numbering
        
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
                        const bookPrefix = bookAbbreviation ? `${bookAbbreviation} ` : '';
                        const cellId = `${bookPrefix}${chapterNumber}:${verseNumber}`;
                        
                        // Create HTML content for the verse
                        const htmlContent = `<p class="biblica-verse" data-book="${bookAbbreviation}" data-chapter="${chapterNumber}" data-verse="${verseNumber}" data-paragraph-style="${paragraphStyle}" data-story-id="${story.id}">${escapeHtml(verseContent)}</p>`;
                        
                        const cellMetadata = {
                            cellLabel: `${bookPrefix}${chapterNumber}:${verseNumber}`,
                            isBibleVerse: true,
                            bookAbbreviation,
                            chapterNumber,
                            verseNumber,
                            verseId: cellId,
                            storyId: story.id,
                            storyName: story.name,
                            paragraphId: paragraph.id,
                            appliedParagraphStyle: paragraphStyle,
                            beforeVerse,  // Serialized XML for round-trip
                            afterVerse,   // Serialized XML for round-trip
                            data: {
                                originalContent: verseContent,
                                sourceFile: selectedFile?.name || 'unknown',
                                idmlStructure: {
                                    storyId: story.id,
                                    storyName: story.name,
                                    paragraphId: paragraph.id,
                                    paragraphStyleRange: paragraph.paragraphStyleRange,
                                    characterStyleRanges: paragraph.characterStyleRanges,
                                },
                                documentContext: {
                                    documentId: document.id,
                                    documentVersion: document.version,
                                    originalHash: htmlRepresentation.originalHash,
                                    importerType: 'biblica',
                                    fileName: selectedFile?.name || 'unknown',
                                    importTimestamp: new Date().toISOString(),
                                }
                            }
                        };
                        
                        const cell = createProcessedCell(cellId, htmlContent, cellMetadata);
                        const images = await extractImagesFromHtml(htmlContent);
                        cell.images = images;
                        cells.push(cell);
                        addDebugLog(`Created verse cell: ${cellId}`);
                    }
                } else {
                    // Fallback: Create one cell per paragraph (for non-verse content)
                    const content = paragraph.paragraphStyleRange.content;
                    
                    // Preserve newlines for structure, convert to <br /> for HTML
                    const contentWithBreaks = content
                        .replace(/\r\n/g, '\n')  // Normalize line endings
                        .replace(/\r/g, '\n');   // Normalize line endings
                    
                    // Create cleanText for empty check (without excessive whitespace)
                    const cleanText = contentWithBreaks
                        .replace(/[\r\n]+/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();
                    
                    if (!cleanText) {
                        continue;
                    }

                    const cellId = `biblica 1:${globalCellIndex + 1}`;
                    const ranges = paragraph.characterStyleRanges || [];
                    
                    // Use characterStyleRanges if available, otherwise use content with preserved breaks
                    let inlineHTML: string;
                    if (ranges.length > 0) {
                        inlineHTML = buildInlineHTMLFromRanges(ranges);
                    } else {
                        // Fallback: escape HTML and convert newlines to <br /> tags
                        inlineHTML = contentWithBreaks
                            .split('\n')
                            .map((line: string) => escapeHtml(line))
                            .join('<br />');
                    }
                    
                    const htmlContent = `<p class="biblica-paragraph" data-paragraph-style="${paragraphStyle}" data-story-id="${story.id}">${inlineHTML}</p>`;
                    const cellMetadata = {
                        cellLabel: (globalCellIndex + 1).toString(),
                        storyId: story.id,
                        storyName: story.name,
                        paragraphId: paragraph.id,
                        appliedParagraphStyle: paragraphStyle,
                        data: {
                            originalContent: cleanText,
                            sourceFile: selectedFile?.name || 'unknown',
                            idmlStructure: {
                                storyId: story.id,
                                storyName: story.name,
                                paragraphId: paragraph.id,
                                paragraphStyleRange: paragraph.paragraphStyleRange,
                                characterStyleRanges: paragraph.characterStyleRanges,
                            },
                            layoutData: {
                                storyMetadata: story.metadata,
                                paragraphMetadata: paragraph.metadata,
                            },
                            relationships: {
                                parentStory: story.id,
                                parentStoryName: story.name,
                                storyOrder: stories.indexOf(story),
                                paragraphOrder: i,
                                totalParagraphsInStory: story.paragraphs.length,
                            },
                            documentContext: {
                                documentId: document.id,
                                documentVersion: document.version,
                                originalHash: htmlRepresentation.originalHash,
                                importerType: 'biblica',
                                fileName: selectedFile?.name || 'unknown',
                                importTimestamp: new Date().toISOString(),
                            }
                        }
                    };
                    const cell = createProcessedCell(cellId, htmlContent, cellMetadata);
                    const images = await extractImagesFromHtml(htmlContent);
                    cell.images = images;
                    cells.push(cell);
                    globalCellIndex++;
                }
            }
        }
        return cells;
    }, [addDebugLog, selectedFile]);

    const handleImport = useCallback(async () => {
        if (!selectedFile) return;

        setIsProcessing(true);
        setProgress('Starting import...');
        
        try {
            addDebugLog('Starting import process...');
            
            // Step 1: Read file content
            setProgress('Reading Biblica IDML file...');
            addDebugLog(`Reading file: ${selectedFile.name}, Size: ${selectedFile.size}`);
            
            // Read as ArrayBuffer to preserve binary data
            const arrayBuffer = await selectedFile.arrayBuffer();
            addDebugLog(`ArrayBuffer size: ${arrayBuffer.byteLength}`);
            
            // Convert to Uint8Array to check ZIP signature
            const uint8Array = new Uint8Array(arrayBuffer);
            const firstBytes = Array.from(uint8Array.slice(0, 4)).map(b => String.fromCharCode(b)).join('');
            addDebugLog(`First 4 bytes: ${firstBytes}`);
            
            // Validate ZIP signature (PK)
            if (firstBytes !== 'PK\u0003\u0004') {
                throw new Error('The selected file does not appear to be a valid IDML file. IDML files should be ZIP-compressed starting with PK');
            }
            
            // Step 2: Parse IDML
            setProgress('Parsing Biblica IDML content...');
            addDebugLog('Creating Biblica IDML parser...');
            const parser = new IDMLParser({
                preserveAllFormatting: true,
                preserveObjectIds: true,
                validateRoundTrip: false,
                strictMode: false
            });
            
            // Set debug callback to capture parser logs
            parser.setDebugCallback(addDebugLog);
            
            addDebugLog('Parsing Biblica IDML content from ArrayBuffer...');
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
                throw new Error('No stories found in the Biblica IDML file. The file may be corrupted or empty.');
            }
            
            // Check if stories have content
            let totalParagraphs = 0;
            for (const story of document.stories) {
                totalParagraphs += story.paragraphs.length;
            }
            
            if (totalParagraphs === 0) {
                addDebugLog('WARNING: No paragraphs found in any story!');
                throw new Error('No paragraphs found in the Biblica IDML file. The file may be corrupted or empty.');
            }
            
            // Step 3: Convert to HTML
            setProgress('Converting to HTML representation (Biblica)...');
            const htmlMapper = new HTMLMapper();
            const htmlRepresentation = htmlMapper.convertToHTML(document);
            
            // Step 4: Create cells from stories
            setProgress('Creating notebook cells (Biblica)...');
            let cells;
            try {
                cells = await createCellsFromStories(document.stories, htmlRepresentation, document);
            } catch (cellError) {
                addDebugLog(`Cell creation error: ${cellError instanceof Error ? cellError.message : 'Unknown error'}`);
                addDebugLog(`Cell creation error stack: ${cellError instanceof Error ? cellError.stack : 'No stack'}`);
                throw cellError;
            }
            
            if (cells.length === 0) {
                addDebugLog('WARNING: No cells were created!');
                throw new Error('No cells were created from the parsed content. Check the cell creation logic.');
            }
            
            setProgress('Import completed successfully!');

            // Complete the import
            if (onComplete) {
                addDebugLog('Calling onComplete...');
                addDebugLog(`Cells count: ${cells.length}`);
                addDebugLog(`Document ID: ${document.id}`);
                addDebugLog(`Stories count: ${document.stories.length}`);
                
                try {
                    // Preserve full metadata structure (don't simplify)
                    const simplifiedCells = cells.map(cell => ({
                        id: cell.id,
                        content: cell.content,
                        metadata: cell.metadata // Keep the full metadata structure
                    }));
                    
                    addDebugLog(`Simplified cells count: ${simplifiedCells.length}`);
                    
                    const baseName = sanitizeFileName(selectedFile.name);
                    const notebookName = sanitizeFileName(`${baseName}-biblica`);
                    addDebugLog(`Base name: "${baseName}"`);
                    addDebugLog(`Notebook name: "${notebookName}"`);
                    addDebugLog(`Original file name: "${selectedFile.name}"`);
                    
                    const result = {
                        source: { 
                            name: notebookName, 
                            cells: simplifiedCells,
                            metadata: {
                                id: `biblica-source-${Date.now()}`,
                                originalFileName: selectedFile.name,
                                originalFileData: arrayBuffer,
                                importerType: 'biblica',
                                createdAt: new Date().toISOString(),
                                documentId: document.id,
                                storyCount: document.stories.length,
                                originalHash: document.originalHash,
                                totalCells: simplifiedCells.length,
                                fileType: 'biblica'
                            }
                        },
                        codex: { 
                            name: notebookName,
                            cells: simplifiedCells.map(cell => ({
                                id: cell.id,
                                content: '',
                                metadata: {
                                    ...cell.metadata,
                                    originalContent: cell.content
                                }
                            })),
                            metadata: {
                                id: `biblica-codex-${Date.now()}`,
                                originalFileName: selectedFile.name,
                                importerType: 'biblica',
                                createdAt: new Date().toISOString(),
                                documentId: document.id,
                                storyCount: document.stories.length,
                                originalHash: document.originalHash,
                                totalCells: simplifiedCells.length,
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
    }, [selectedFile, onComplete, addDebugLog, createCellsFromStories]);

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
                        Import InDesign File
                    </h1>
                    <p className="text-muted-foreground">
                        Import Adobe InDesign IDML files
                    </p>
                </div>
                <Button onClick={onCancel} className="flex items-center gap-2">
                    <ArrowLeft className="h-4 w-4" />
                    Back to Home
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Select IDML File</CardTitle>
                    <CardDescription>
                        Import Adobe InDesign Markup Language files
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center">
                        <input
                            type="file"
                            accept=".idml"
                            onChange={handleFileSelect}
                            className="hidden"
                            id="idml-file-input"
                            disabled={isProcessing}
                        />
                        <label
                            htmlFor="idml-file-input"
                            className="cursor-pointer inline-flex flex-col items-center gap-2"
                        >
                            <Upload className="h-12 w-12 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">
                                Click to select an IDML file or drag and drop
                            </span>
                        </label>
                    </div>

                    {selectedFile && (
                        <div className="space-y-2">
                            <div className="text-sm font-medium">Selected File</div>
                            <div className="flex items-center gap-2 p-2 bg-muted/50 rounded text-sm">
                                <FileText className="h-4 w-4 text-muted-foreground" />
                                <span className="flex-1">{selectedFile.name}</span>
                                <span className="text-muted-foreground">
                                    {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
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
                    disabled={!selectedFile || isProcessing}
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
                            Import InDesign File
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
