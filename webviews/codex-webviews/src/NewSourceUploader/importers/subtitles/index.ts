import {
    ImporterPlugin,
    FileValidationResult,
    ImportResult,
    ProgressCallback,
    ProcessedCell,
    ProcessedNotebook,
} from '../../types/common';
import {
    createProgress,
    createProcessedCell,
    validateFileExtension,
    addMilestoneCellsToNotebookPair,
} from '../../utils/workflowHelpers';
import { WebVTTParser } from 'webvtt-parser';
import { englishSubtitlesRaw, tigrinyaSubtitlesRaw, sourceOfTruthMapping } from './testData';
import { CodexCellTypes } from 'types/enums';
// Remove automatic import of compile-time tests to avoid circular dependency
// Import './compiletimeTests' manually when needed for testing

const SUPPORTED_EXTENSIONS = ['vtt', 'srt', 'ass', 'sub'];

/**
 * Parses SRT content and converts it to VTT-like structure
 */
const parseSRTContent = (content: string) => {
    const cues: any[] = [];
    const blocks = content.split(/\n\s*\n/);

    for (const block of blocks) {
        const lines = block.split('\n').map(line => line.trim()).filter(line => line);

        if (lines.length >= 3) {
            const id = lines[0];
            const timingLine = lines[1];
            const textLines = lines.slice(2);

            const timingMatch = timingLine.match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);

            if (timingMatch) {
                const startTime = convertSRTTimeToSeconds(timingMatch[1]);
                const endTime = convertSRTTimeToSeconds(timingMatch[2]);

                cues.push({
                    id,
                    startTime,
                    endTime,
                    text: textLines.join('\n'),
                });
            }
        }
    }

    return { cues };
};

/**
 * Converts SRT time format (HH:MM:SS,mmm) to seconds
 */
const convertSRTTimeToSeconds = (timeStr: string): number => {
    const [time, milliseconds] = timeStr.split(',');
    const [hours, minutes, seconds] = time.split(':').map(Number);
    return hours * 3600 + minutes * 60 + seconds + Number(milliseconds) / 1000;
};

// Legacy interface - keeping for compatibility
interface SubtitleCue {
    id?: string;
    startTime: string;
    endTime: string;
    text: string;
    startTimeMs: number;
    endTimeMs: number;
}

/**
 * Validates a subtitle file
 */
const validateFile = async (file: File): Promise<FileValidationResult> => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check file extension
    if (!validateFileExtension(file.name, SUPPORTED_EXTENSIONS)) {
        errors.push('File must have .vtt, .srt, .ass, or .sub extension');
    }

    // Check file size (warn if > 10MB)
    if (file.size > 10 * 1024 * 1024) {
        warnings.push('Large subtitle files may take longer to process');
    }

    // Basic content validation
    try {
        const content = await file.text();
        const fileName = file.name.toLowerCase();

        if (content.trim().length === 0) {
            errors.push('File appears to be empty');
        }

        // Format-specific validation
        if (fileName.endsWith('.vtt')) {
            if (!content.startsWith('WEBVTT')) {
                errors.push('VTT files must start with "WEBVTT" header');
            }
        } else if (fileName.endsWith('.srt')) {
            // SRT should have timestamp patterns
            if (!/\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/.test(content)) {
                warnings.push('File does not appear to contain standard SRT timing format');
            }
        }

        // Check for timing patterns
        const hasTimings = /\d{2}:\d{2}:\d{2}/.test(content);
        if (!hasTimings) {
            warnings.push('No timestamp patterns found - this may not be a subtitle file');
        }

    } catch (error) {
        errors.push('Could not read file content');
    }

    return {
        isValid: errors.length === 0,
        fileType: 'subtitles',
        errors,
        warnings,
        metadata: {
            fileSize: file.size,
            lastModified: new Date(file.lastModified).toISOString(),
        },
    };
};

// Legacy parsing functions removed - now using WebVTTParser and parseSRTContent

/**
 * Parses a subtitle file into notebook cells using proper libraries
 */
const parseFile = async (file: File, onProgress?: ProgressCallback): Promise<ImportResult> => {
    console.log(
        '[RYDER] calling parseFile');
    try {
        onProgress?.(createProgress('Reading File', 'Reading subtitle file...', 10));

        const content = await file.text();
        const fileName = file.name.toLowerCase();
        const baseName = file.name.replace(/\.[^/.]+$/, '');
        const baseNameAsId = baseName.replace(/[^a-zA-Z0-9]/g, "-");
        onProgress?.(createProgress('Parsing Subtitles', 'Parsing subtitle format...', 30));

        let parsed: any;
        let format: string;

        // Parse based on file extension and content
        if (fileName.endsWith('.vtt') || content.startsWith('WEBVTT')) {
            // Use WebVTTParser for VTT files
            const parser = new WebVTTParser();
            parsed = parser.parse(content);
            format = 'VTT';
            console.log("WebVTT parsed result:", parsed);
            console.log("WebVTT cues count:", parsed.cues?.length || 0);
        } else if (fileName.endsWith('.srt') || /\d+\n\d{2}:\d{2}:\d{2},\d{3}/.test(content)) {
            // Parse SRT format manually (convert to VTT-like structure)
            parsed = parseSRTContent(content);
            format = 'SRT';
            console.log("SRT parsed result:", parsed);
            console.log("SRT cues count:", parsed.cues?.length || 0);
        } else {
            throw new Error('Unsupported subtitle format or could not auto-detect format');
        }

        if (!parsed.cues || parsed.cues.length === 0) {
            throw new Error('No subtitle cues found in the file');
        }

        onProgress?.(createProgress('Creating Cells', 'Creating notebook cells...', 70));

        // Create notebook cells using ProcessedCell format
        const cells: ProcessedCell[] = [];

        // Add cells using the ProcessedCell format
        for (const cue of parsed.cues) {
            // Generate a unique identifier for the cue that matches the expected format
            const cueId = `${baseNameAsId} 1:cue-${cue.startTime}-${cue.endTime}`;

            // Create ProcessedCell using the structure expected by the editor
            // Timestamps and related fields should live under metadata.data
            // Subtitle cells are milestone cells because they represent time-based markers
            const cell = createProcessedCell(cueId, cue.text, {
                type: CodexCellTypes.MILESTONE,
                data: {
                    startTime: cue.startTime,
                    endTime: cue.endTime,
                    format: format,
                    originalText: cue.text,
                },
                edits: [],
                id: cueId,
            });

            cells.push(cell);
        }

        // Create notebook pair using ProcessedNotebook format
        const sourceNotebook: ProcessedNotebook = {
            name: baseName,
            cells,
            metadata: {
                id: baseNameAsId,
                originalFileName: file.name,
                importerType: 'subtitles',
                createdAt: new Date().toISOString(),
                format,
                totalCues: parsed.cues.length,
            },
        };

        // Create codex cells (empty content for translation)
        const codexCells = cells.map(sourceCell =>
            createProcessedCell(sourceCell.id, '', {
                ...sourceCell.metadata,
                data: {
                    ...sourceCell.metadata?.data,
                    originalText: sourceCell.content,
                },
                edits: [...(sourceCell.metadata?.edits || [])],
                id: sourceCell.id,
                type: CodexCellTypes.MILESTONE,
            })
        );

        const codexNotebook: ProcessedNotebook = {
            name: baseName,
            cells: codexCells,
            metadata: {
                ...sourceNotebook.metadata,
            },
        };

        // Debug logging
        console.log("Subtitles importer created cells:", sourceNotebook.cells.length);
        console.log("First few cells:", sourceNotebook.cells.slice(0, 2));

        const notebookPair = {
            source: sourceNotebook,
            codex: codexNotebook,
        };

        // Note: Subtitle cells are already milestone cells, so we don't need to add additional milestone cells
        // The addMilestoneCellsToNotebookPair function will detect existing milestone cells and return early
        const notebookPairWithMilestones = addMilestoneCellsToNotebookPair(notebookPair);

        onProgress?.(createProgress('Complete', 'Subtitle processing complete', 100));

        return {
            success: true,
            notebookPair: notebookPairWithMilestones,
            metadata: {
                segmentCount: sourceNotebook.cells.length,
                format,
                cueCount: parsed.cues.length,
            },
        };

    } catch (error) {
        onProgress?.(createProgress('Error', 'Subtitle processing failed', 0));

        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
        };
    }
};

export const subtitlesImporter: ImporterPlugin = {
    name: 'Subtitles Importer',
    supportedExtensions: SUPPORTED_EXTENSIONS,
    supportedMimeTypes: ['text/vtt', 'text/srt', 'application/x-subrip'],
    description: 'Import subtitle/caption files (VTT, SRT) with timestamp-based cells',
    validateFile,
    parseFile,
};

// Test function to assert mapping
function testMapping() {
    const parser = new WebVTTParser();
    const englishParsed = parser.parse(englishSubtitlesRaw);
    const tigrinyaParsed = parser.parse(tigrinyaSubtitlesRaw);
    const englishCues: any[] = englishParsed.cues;
    const tigrinyaCues: any[] = tigrinyaParsed.cues.filter((cue: any) => cue.startTime >= 50);
    englishCues.forEach((cue, index) => {
        cue.myId = cue.id || `E${index + 1}`;
    });
    tigrinyaCues.forEach((cue, index) => {
        cue.myId = `T${index + 1}`;
    });
    const assignments = new Map<string, string[]>();
    for (const tCue of tigrinyaCues) {
        let bestEnglish = null;
        let maxOverlap = 0;
        for (const eCue of englishCues) {
            const overlap = Math.max(0, Math.min(eCue.endTime, tCue.endTime) - Math.max(eCue.startTime, tCue.startTime));
            if (overlap > maxOverlap) {
                maxOverlap = overlap;
                bestEnglish = eCue;
            }
        }
        if (maxOverlap > 0 && bestEnglish) {
            const eId = bestEnglish.myId;
            if (!assignments.has(eId)) assignments.set(eId, []);
            assignments.get(eId)!.push(tCue.myId);
        }
    }
    for (const arr of assignments.values()) {
        arr.sort((a, b) => parseInt(a.substring(1)) - parseInt(b.substring(1)));
    }
    const computed: Record<string, string[]> = {};
    const sortedKeys = Array.from(assignments.keys()).sort((a, b) => parseInt(a) - parseInt(b));
    for (const key of sortedKeys) {
        computed[key] = assignments.get(key)!;
    }
    const isEqual = JSON.stringify(computed) === JSON.stringify(sourceOfTruthMapping);
    if (!isEqual) {
        console.error('Computed:', computed);
        console.error('Expected:', sourceOfTruthMapping);
        throw new Error('Mapping assertion failed');
    } else {
        console.log('Mapping assertion passed');
    }
}

// Run the test to verify mapping algorithm
testMapping(); 