import {
    ImporterPlugin,
    FileValidationResult,
    ImportResult,
    ProgressCallback,
} from '../../types/common';
import {
    createProgress,
    createStandardCellId,
    createProcessedCell,
    createNotebookPair,
    validateFileExtension,
} from '../../utils/workflowHelpers';

const SUPPORTED_EXTENSIONS = ['vtt', 'srt', 'ass', 'sub'];

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

/**
 * Converts time string to milliseconds
 */
const timeToMs = (timeStr: string, format: 'vtt' | 'srt'): number => {
    if (format === 'vtt') {
        // VTT format: 00:00:00.000 or 00:00.000
        const match = timeStr.match(/(?:(\d{2}):)?(\d{2}):(\d{2})\.(\d{3})/);
        if (match) {
            const [, hours = '0', minutes, seconds, ms] = match;
            return parseInt(hours) * 3600000 + parseInt(minutes) * 60000 + parseInt(seconds) * 1000 + parseInt(ms);
        }
    } else if (format === 'srt') {
        // SRT format: 00:00:00,000
        const match = timeStr.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
        if (match) {
            const [, hours, minutes, seconds, ms] = match;
            return parseInt(hours) * 3600000 + parseInt(minutes) * 60000 + parseInt(seconds) * 1000 + parseInt(ms);
        }
    }
    return 0;
};

/**
 * Formats milliseconds to readable time string
 */
const msToTimeString = (ms: number): string => {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const milliseconds = ms % 1000;

    if (hours > 0) {
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
    } else {
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
    }
};

/**
 * Parses VTT format
 */
const parseVTT = (content: string): SubtitleCue[] => {
    const cues: SubtitleCue[] = [];
    const lines = content.split('\n');

    let i = 0;
    // Skip header and initial comments
    while (i < lines.length && (lines[i].startsWith('WEBVTT') || lines[i].startsWith('NOTE') || lines[i].trim() === '')) {
        i++;
    }

    while (i < lines.length) {
        const line = lines[i].trim();

        // Skip empty lines
        if (!line) {
            i++;
            continue;
        }

        // Check if this line contains timing
        const timingMatch = line.match(/(\d{2}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})/);

        if (timingMatch) {
            const startTime = timingMatch[1];
            const endTime = timingMatch[2];
            const startTimeMs = timeToMs(startTime, 'vtt');
            const endTimeMs = timeToMs(endTime, 'vtt');

            // Collect text lines until we hit an empty line or timing
            i++;
            const textLines: string[] = [];
            while (i < lines.length && lines[i].trim() !== '' && !lines[i].includes('-->')) {
                textLines.push(lines[i].trim());
                i++;
            }

            if (textLines.length > 0) {
                cues.push({
                    startTime,
                    endTime,
                    text: textLines.join('\n'),
                    startTimeMs,
                    endTimeMs,
                });
            }
        } else {
            i++;
        }
    }

    return cues;
};

/**
 * Parses SRT format
 */
const parseSRT = (content: string): SubtitleCue[] => {
    const cues: SubtitleCue[] = [];
    const blocks = content.split(/\n\s*\n/);

    for (const block of blocks) {
        const lines = block.split('\n').map(line => line.trim()).filter(line => line);

        if (lines.length >= 3) {
            const id = lines[0];
            const timingLine = lines[1];
            const textLines = lines.slice(2);

            const timingMatch = timingLine.match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);

            if (timingMatch) {
                const startTime = timingMatch[1];
                const endTime = timingMatch[2];
                const startTimeMs = timeToMs(startTime, 'srt');
                const endTimeMs = timeToMs(endTime, 'srt');

                cues.push({
                    id,
                    startTime,
                    endTime,
                    text: textLines.join('\n'),
                    startTimeMs,
                    endTimeMs,
                });
            }
        }
    }

    return cues;
};

/**
 * Parses a subtitle file into notebook cells
 */
const parseFile = async (file: File, onProgress?: ProgressCallback): Promise<ImportResult> => {
    try {
        onProgress?.(createProgress('Reading File', 'Reading subtitle file...', 'processing', 10));

        const content = await file.text();
        const fileName = file.name.toLowerCase();

        onProgress?.(createProgress('Parsing Subtitles', 'Parsing subtitle format...', 'processing', 30));

        let cues: SubtitleCue[] = [];

        // Parse based on file extension
        if (fileName.endsWith('.vtt')) {
            cues = parseVTT(content);
        } else if (fileName.endsWith('.srt')) {
            cues = parseSRT(content);
        } else {
            // Try to auto-detect format
            if (content.startsWith('WEBVTT') || content.includes('-->') && content.includes('.')) {
                cues = parseVTT(content);
            } else if (/\d+\n\d{2}:\d{2}:\d{2},\d{3}/.test(content)) {
                cues = parseSRT(content);
            } else {
                throw new Error('Unsupported subtitle format or could not auto-detect format');
            }
        }

        if (cues.length === 0) {
            throw new Error('No subtitle cues found in the file');
        }

        onProgress?.(createProgress('Creating Cells', 'Creating notebook cells...', 'processing', 70));

        // Convert cues to cells
        const cells = cues.map((cue, index) => {
            const cellId = cue.id || createStandardCellId(file.name, 1, index + 1);

            // Create descriptive content with timing
            const cellContent = `[${cue.startTime} --> ${cue.endTime}]\n${cue.text}`;

            return createProcessedCell(cellId, cellContent, {
                type: 'subtitle',
                startTime: cue.startTime,
                endTime: cue.endTime,
                startTimeMs: cue.startTimeMs,
                endTimeMs: cue.endTimeMs,
                duration: cue.endTimeMs - cue.startTimeMs,
                originalText: cue.text,
                cueIndex: index,
                cellLabel: msToTimeString(cue.startTimeMs),
            });
        });

        // Create notebook pair
        const totalDuration = Math.max(...cues.map(c => c.endTimeMs));
        const notebookPair = createNotebookPair(file.name, cells, 'subtitles', {
            format: fileName.endsWith('.vtt') ? 'VTT' : fileName.endsWith('.srt') ? 'SRT' : 'Unknown',
            totalCues: cues.length,
            totalDuration: totalDuration,
            totalDurationFormatted: msToTimeString(totalDuration),
            averageCueDuration: Math.round(cues.reduce((sum, cue) => sum + (cue.endTimeMs - cue.startTimeMs), 0) / cues.length),
        });

        onProgress?.(createProgress('Complete', 'Subtitle processing complete', 'complete', 100));

        return {
            success: true,
            notebookPair,
            metadata: {
                segmentCount: cells.length,
                format: fileName.endsWith('.vtt') ? 'VTT' : fileName.endsWith('.srt') ? 'SRT' : 'Unknown',
                totalDuration: totalDuration,
                totalDurationFormatted: msToTimeString(totalDuration),
                cueCount: cues.length,
            },
        };

    } catch (error) {
        onProgress?.(createProgress('Error', 'Subtitle processing failed', 'error', 0));

        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
        };
    }
};

export const subtitlesImporter: ImporterPlugin = {
    name: 'Subtitles Importer',
    supportedExtensions: SUPPORTED_EXTENSIONS,
    description: 'Import subtitle/caption files (VTT, SRT) with timestamp-based cells',
    validateFile,
    parseFile,
}; 