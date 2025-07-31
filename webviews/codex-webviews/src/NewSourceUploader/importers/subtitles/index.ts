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
    createStandardCellId,
    createProcessedCell,
    validateFileExtension,
} from '../../utils/workflowHelpers';
import { WebVTTParser } from 'webvtt-parser';

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

/**
 * Formats duration in seconds to readable string
 */
const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
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

            // Create ProcessedCell using the correct structure
            const cell = createProcessedCell(cueId, cue.text, {
                type: 'text',
                startTime: cue.startTime,
                endTime: cue.endTime,
                format: format,
                originalText: cue.text,
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
                originalContent: sourceCell.content, // Keep reference to original
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

        onProgress?.(createProgress('Complete', 'Subtitle processing complete', 100));

        return {
            success: true,
            notebookPair,
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