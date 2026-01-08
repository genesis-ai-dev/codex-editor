/**
 * InDesign Importer Form Component - Minimal Test Version
 * Provides UI for importing IDML files with round-trip validation
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
import { IDMLParser } from './idmlParser';
import { HTMLMapper } from './htmlMapper';
import { createProcessedCell, sanitizeFileName, createStandardCellId, addMilestoneCellsToNotebookPair } from '../../utils/workflowHelpers';
import { extractImagesFromHtml } from '../../utils/imageProcessor';

/**
 * Escape HTML characters
 */
function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function buildInlineHTMLFromRanges(ranges: any[]): string {
    if (!Array.isArray(ranges) || ranges.length === 0) return '';
    return ranges.map((r) => {
        const style = (r?.appliedCharacterStyle || '').toString();
        // Convert newline markers (from <Br />) to <br /> in HTML
        const text = (r?.content || '').toString().replace(/\n/g, '<br />');
        const safeStyle = escapeHtml(style);
        // Do not escape the injected <br /> tags; escape other text portions only
        const safeText = text
            .split('<br />')
            .map((part: string) => escapeHtml(part))
            .join('<br />');
        return `<span class="idml-char" data-character-style="${safeStyle}">${safeText}</span>`;
    }).join('');
}

/**
 * Derive a 3-letter book code from file name or fall back to 'BOOK'.
 * Examples: '40MAT-43JHN_140x210.idml' -> 'MAT'
 */
function deriveBookCode(sourceName: string): string {
    const match = sourceName.match(/[0-9]{2}([A-Z]{3})/);
    if (match && match[1]) return match[1];
    const alt = sourceName.match(/\b([A-Z]{3})\b/);
    if (alt && alt[1]) return alt[1];
    return 'BOOK';
}

function isNumericToken(token: string): boolean {
    return /^\d{1,3}$/.test(token.trim());
}

interface InDesignImporterFormProps extends ImporterComponentProps {
    // Additional props specific to InDesign importer
}

export const InDesignImporterForm: React.FC<InDesignImporterFormProps> = ({
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

    const handleImport = useCallback(async () => {
        if (!selectedFile) return;

        setIsProcessing(true);
        setProgress('Starting import...');
        
        try {
            addDebugLog('Starting import process...');
            
            // Step 1: Read file content
            setProgress('Reading IDML file...');
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
            setProgress('Parsing IDML content...');
            addDebugLog('Creating IDML parser...');
            const parser = new IDMLParser({
                preserveAllFormatting: true,
                preserveObjectIds: true,
                validateRoundTrip: false,
                strictMode: false
            });
            
            // Set debug callback to capture parser logs
            parser.setDebugCallback(addDebugLog);
            
            addDebugLog('Parsing IDML content from ArrayBuffer...');
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
                throw new Error('No stories found in the IDML file. The file may be corrupted or empty.');
            }
            
            // Check if stories have content
            let totalParagraphs = 0;
            for (const story of document.stories) {
                totalParagraphs += story.paragraphs.length;
            }
            
            if (totalParagraphs === 0) {
                addDebugLog('WARNING: No paragraphs found in any story!');
                throw new Error('No paragraphs found in the IDML file. The file may be corrupted or empty.');
            }
            
            // Step 3: Convert to HTML
            setProgress('Converting to HTML representation...');
            const htmlMapper = new HTMLMapper();
            const htmlRepresentation = htmlMapper.convertToHTML(document);
            
            // Step 4: Create cells from stories
            setProgress('Creating notebook cells...');
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
                    addDebugLog(`Base name: "${baseName}"`);
                    addDebugLog(`Original file name: "${selectedFile.name}"`);
                    
                    const result = {
                        source: { 
                            name: baseName, 
                            cells: simplifiedCells,
                            metadata: {
                                id: `indesign-source-${Date.now()}`,
                                originalFileName: selectedFile.name,
                                // Pass the original file bytes so the provider can persist it under .project/attachments/originals
                                originalFileData: arrayBuffer,
                                importerType: 'indesign',
                                createdAt: new Date().toISOString(),
                                documentId: document.id,
                                storyCount: document.stories.length,
                                originalHash: document.originalHash,
                                totalCells: simplifiedCells.length,
                                fileType: 'indesign'
                            }
                        },
                        codex: { 
                            name: baseName, // Mirror cells but leave content empty for translation
                            cells: simplifiedCells.map(cell => ({
                                id: cell.id,
                                content: '',
                                metadata: {
                                    ...cell.metadata,
                                    originalContent: cell.content
                                }
                            })),
                            metadata: {
                                id: `indesign-codex-${Date.now()}`,
                                originalFileName: selectedFile.name,
                                importerType: 'indesign',
                                createdAt: new Date().toISOString(),
                                documentId: document.id,
                                storyCount: document.stories.length,
                                originalHash: document.originalHash,
                                totalCells: simplifiedCells.length,
                                fileType: 'indesign',
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
                    
                    // Add milestone cells to the notebook pair
                    const resultWithMilestones = addMilestoneCellsToNotebookPair(result);
                    
                    // Store the result and show complete button instead of immediately calling onComplete
                    setImportResult(resultWithMilestones);
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
    }, [selectedFile, onComplete]);

    const handleCompleteImport = useCallback(() => {
        if (importResult && onComplete) {
            try {
                onComplete(importResult);
                addDebugLog('Import completed and window will close.');
            } catch (error) {
                addDebugLog(`Error completing import: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
    }, [importResult, onComplete]);

    const createCellsFromStories = async (stories: any[], htmlRepresentation: any, document: any) => {
        const cells: any[] = [];
        let globalCellIndex = 0; // Global counter for sequential numbering
        const bookCode = deriveBookCode(selectedFile?.name || 'BOOK');
        
        for (const story of stories) {
            // Try to find HTML story, but don't require it
            const htmlStory = htmlRepresentation.stories?.find((s: any) => s.id === story.id);
            if (!htmlStory) {
                addDebugLog(`No HTML story found for: ${story.id}, creating cells directly from story`);
            }
            
            // Create a cell for each paragraph in the story
            for (let i = 0; i < story.paragraphs.length; i++) {
                const paragraph = story.paragraphs[i];
                
                // Extract text content and clean it
                const content = paragraph.paragraphStyleRange.content;
                const paragraphStyle = paragraph.paragraphStyleRange.appliedParagraphStyle;
                
                // Clean the text like other importers do
                const cleanText = content
                    .replace(/[\r\n]+/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                
                // Skip empty paragraphs
                if (!cleanText) {
                    continue;
                }
                
                // Try to detect simple Bible verse structure in character ranges:
                // pattern: <Content>{verseNum}</Content><Content>...</Content><Content>{verseNum}</Content>
                const ranges = paragraph.characterStyleRanges || [];
                if (ranges.length >= 3) {
                    const first = (ranges[0]?.content || '').trim();
                    const last = (ranges[ranges.length - 1]?.content || '').trim();
                    if (isNumericToken(first) && isNumericToken(last) && first === last) {
                        const verseNum = first;
                        // Middle content is the verse text, preserve character ranges as spans
                        const middleRanges = ranges.slice(1, ranges.length - 1);
                        const middleText = middleRanges.map((r: any) => r.content || '').join(' ').replace(/[\s\u00A0]+/g, ' ').trim();
                        if (middleText) {
                            const verseId = `${bookCode} ${/* chapter unknown => best-effort */ '1'}:${verseNum}`;
                            const cellId = verseId;
                            const inlineHTML = buildInlineHTMLFromRanges(middleRanges);
                            const htmlContent = `<p class="indesign-paragraph" data-paragraph-style="${paragraphStyle}" data-story-id="${story.id}">${inlineHTML}</p>`;
                            const cellMetadata = {
                                cellLabel: verseNum,
                                isBibleVerse: true,
                                verseId,
                                storyId: story.id,
                                storyName: story.name,
                                paragraphId: paragraph.id,
                                appliedParagraphStyle: paragraphStyle,
                                data: {
                                    originalContent: middleText,
                                    verseNumber: verseNum,
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
                                        importerType: 'indesign',
                                        fileName: selectedFile?.name || 'unknown',
                                        importTimestamp: new Date().toISOString(),
                                    }
                                }
                            } as any;
                            const cell = createProcessedCell(cellId, htmlContent, cellMetadata);
                            const images = await extractImagesFromHtml(htmlContent);
                            cell.images = images;
                            cells.push(cell);
                            globalCellIndex++;
                            continue;
                        }
                    }
                }

                // Default: one cell per paragraph (non-verse or unmatched structure)
                const cellId = `indesign 1:${globalCellIndex + 1}`;
                // Prefer spans from character style ranges; fallback to plain text if none
                const inlineHTML = ranges.length > 0 ? buildInlineHTMLFromRanges(ranges) : escapeHtml(cleanText);
                const htmlContent = `<p class="indesign-paragraph" data-paragraph-style="${paragraphStyle}" data-story-id="${story.id}">${inlineHTML}</p>`;
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
                            importerType: 'indesign',
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
        return cells;
    };

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
