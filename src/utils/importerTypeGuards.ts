import {
    FileImporterType,
    BibleImporterType,
    AudioImporterType,
    SubtitleImporterType,
    DocxImporterType,
    BiblicaImporterType,
} from "../../types";

// Type guard functions for importer types
export function isBibleImporter(importerType?: FileImporterType): importerType is BibleImporterType {
    return importerType === 'ebible' || importerType === 'usfm' || importerType === 'paratext';
}

export function isAudioImporter(importerType?: FileImporterType): importerType is AudioImporterType {
    return importerType === 'audio';
}

export function isSubtitleImporter(importerType?: FileImporterType): importerType is SubtitleImporterType {
    return importerType === 'subtitles';
}

export function isDocxImporter(importerType?: FileImporterType): importerType is DocxImporterType {
    return importerType === 'docx-roundtrip';
}

export function isBiblicaImporter(importerType?: FileImporterType): importerType is BiblicaImporterType {
    return importerType === 'biblica';
}

