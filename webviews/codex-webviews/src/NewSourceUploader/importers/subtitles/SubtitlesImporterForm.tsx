import React from "react";
import { Play } from "lucide-react";
import {
    UnifiedImporterForm,
    type FileAnalysisStat,
} from "../../components/UnifiedImporterForm";
import type { ImporterComponentProps } from "../../types/plugin";
import type { ImportProgress, NotebookPair } from "../../types/common";
import { subtitlesImporter, validateSubtitleTimestamps } from "./index";
import { subtitlesImporterPlugin } from "./index.tsx";

async function analyzeSubtitleFiles(files: File[]): Promise<FileAnalysisStat[]> {
    const file = files[0];
    if (!file) {
        return [];
    }

    const text = await file.text();

    const isVTT = text.startsWith("WEBVTT");
    const isSRT =
        /^\d+\s*\n\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/m.test(text);

    let cueCount = 0;
    let format = "Unknown";

    if (isVTT) {
        format = "WebVTT";
        const vttCueMatches = text.match(
            /\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}/g
        );
        cueCount = vttCueMatches ? vttCueMatches.length : 0;
    } else if (isSRT) {
        format = "SRT";
        const srtCueMatches = text.match(
            /\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/g
        );
        cueCount = srtCueMatches ? srtCueMatches.length : 0;
    }

    const timeMatches = text.match(/\d{2}:\d{2}:\d{2}[,.]\d{3}/g);
    const duration = timeMatches ? timeMatches[timeMatches.length - 1] : "Unknown";

    return [
        { label: "Format", value: format },
        { label: "Total Cues", value: cueCount },
        { label: "Duration", value: duration },
    ];
}

async function analyzeSubtitleWarnings(files: File[]): Promise<string[]> {
    const file = files[0];
    if (!file) return [];
    try {
        const text = await file.text();
        return validateSubtitleTimestamps(text);
    } catch {
        return [];
    }
}

async function processSubtitleFiles(
    files: File[],
    onProgress: (progress: ImportProgress) => void
): Promise<NotebookPair> {
    const file = files[0];
    if (!file) {
        throw new Error("No file selected");
    }

    onProgress({
        stage: "Validation",
        message: "Validating subtitle file...",
        progress: 10,
    });

    const validation = await subtitlesImporter.validateFile(file);
    if (!validation.isValid) {
        throw new Error(validation.errors.join(", "));
    }

    const importResult = await subtitlesImporter.parseFile(file, onProgress);

    if (!importResult.success || !importResult.notebookPair) {
        throw new Error(importResult.error ?? "Failed to parse file");
    }

    return importResult.notebookPair;
}

export const SubtitlesImporterForm: React.FC<ImporterComponentProps> = (props) => (
    <UnifiedImporterForm
        title="Import Subtitle Files"
        description="Import subtitle files (VTT/SRT) with timestamp-based cells for media synchronization. For translation imports, subtitles are aligned using temporal overlap matching."
        icon={Play}
        accept=".vtt,.srt"
        extensionBadges={[".vtt", ".srt", "WebVTT", "SubRip"]}
        analyzeFiles={analyzeSubtitleFiles}
        analyzeWarnings={analyzeSubtitleWarnings}
        processFiles={processSubtitleFiles}
        importerProps={props}
        cellAligner={subtitlesImporterPlugin.cellAligner}
    />
);
