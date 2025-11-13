// Define specific tuple types for type safety
type ValueEditMap = ["value"];
type CellLabelEditMap = ["metadata", "cellLabel"];
type DataEditMap = ["metadata", "data"];
type DataDeletedEditMap = ["metadata", "data", "deleted"];
type DataStartTimeEditMap = ["metadata", "data", "startTime"];
type DataEndTimeEditMap = ["metadata", "data", "endTime"];
type SelectedAudioIdEditMap = ["metadata", "selectedAudioId"];
type SelectionTimestampEditMap = ["metadata", "selectionTimestamp"];
// File-level metadata editMaps
type MetadataVideoUrlEditMap = ["metadata", "videoUrl"];
type MetadataTextDirectionEditMap = ["metadata", "textDirection"];
type MetadataLineNumbersEnabledEditMap = ["metadata", "lineNumbersEnabled"];
type MetadataFontSizeEditMap = ["metadata", "fontSize"];
type MetadataAutoDownloadAudioOnOpenEditMap = ["metadata", "autoDownloadAudioOnOpen"];
type MetadataShowInlineBacktranslationsEditMap = ["metadata", "showInlineBacktranslations"];
type MetadataFileDisplayNameEditMap = ["metadata", "fileDisplayName"];
type MetadataCellDisplayModeEditMap = ["metadata", "cellDisplayMode"];
type MetadataAudioOnlyEditMap = ["metadata", "audioOnly"];
type MetadataCorpusMarkerEditMap = ["metadata", "corpusMarker"];

// Project-level metadata editMaps (for metadata.json)
type ProjectNameEditMap = ["projectName"];
type MetaGeneratorEditMap = ["meta", "generator"];
type MetaEditMap = ["meta"];
type LanguagesEditMap = ["languages"];
type SpellcheckIsEnabledEditMap = ["spellcheckIsEnabled"];

import { EditType } from "../../types/enums";

// Utility functions for working with editMaps
export const EditMapUtils = {
    // Create editMaps for common use cases with proper typing
    value(): ValueEditMap {
        return ["value"];
    },

    metadata(field: string): readonly ["metadata", string] {
        return ["metadata", field];
    },

    metadataNested(...fields: string[]): readonly ["metadata", ...string[]] {
        return ["metadata", ...fields];
    },

    // Specific metadata field helpers with exact typing
    cellLabel(): CellLabelEditMap {
        return ["metadata", "cellLabel"];
    },

    data(): DataEditMap {
        return ["metadata", "data"];
    },

    dataDeleted(): DataDeletedEditMap {
        return ["metadata", "data", "deleted"];
    },

    dataStartTime(): DataStartTimeEditMap {
        return ["metadata", "data", "startTime"];
    },

    dataEndTime(): DataEndTimeEditMap {
        return ["metadata", "data", "endTime"];
    },

    selectedAudioId(): SelectedAudioIdEditMap {
        return ["metadata", "selectedAudioId"];
    },

    selectionTimestamp(): SelectionTimestampEditMap {
        return ["metadata", "selectionTimestamp"];
    },

    // File-level metadata field helpers
    metadataVideoUrl(): MetadataVideoUrlEditMap {
        return ["metadata", "videoUrl"];
    },

    metadataTextDirection(): MetadataTextDirectionEditMap {
        return ["metadata", "textDirection"];
    },

    metadataLineNumbersEnabled(): MetadataLineNumbersEnabledEditMap {
        return ["metadata", "lineNumbersEnabled"];
    },

    metadataFontSize(): MetadataFontSizeEditMap {
        return ["metadata", "fontSize"];
    },

    metadataAutoDownloadAudioOnOpen(): MetadataAutoDownloadAudioOnOpenEditMap {
        return ["metadata", "autoDownloadAudioOnOpen"];
    },

    metadataShowInlineBacktranslations(): MetadataShowInlineBacktranslationsEditMap {
        return ["metadata", "showInlineBacktranslations"];
    },

    metadataFileDisplayName(): MetadataFileDisplayNameEditMap {
        return ["metadata", "fileDisplayName"];
    },

    metadataCellDisplayMode(): MetadataCellDisplayModeEditMap {
        return ["metadata", "cellDisplayMode"];
    },

    metadataAudioOnly(): MetadataAudioOnlyEditMap {
        return ["metadata", "audioOnly"];
    },

    metadataCorpusMarker(): MetadataCorpusMarkerEditMap {
        return ["metadata", "corpusMarker"];
    },

    // Generic helper for any file-level metadata field
    metadataField(field: string): readonly ["metadata", string] {
        return ["metadata", field];
    },

    // Project-level metadata field helpers
    projectName(): ProjectNameEditMap {
        return ["projectName"];
    },

    metaGenerator(): MetaGeneratorEditMap {
        return ["meta", "generator"];
    },

    meta(): MetaEditMap {
        return ["meta"];
    },

    languages(): LanguagesEditMap {
        return ["languages"];
    },

    spellcheckIsEnabled(): SpellcheckIsEnabledEditMap {
        return ["spellcheckIsEnabled"];
    },

    // Compare editMaps
    equals(editMap1: readonly string[], editMap2: readonly string[]): boolean {
        return JSON.stringify(editMap1) === JSON.stringify(editMap2);
    },

    // Check if editMap represents a value edit
    isValue(editMap: readonly string[]): boolean {
        return this.equals(editMap, ["value"]);
    },

    // Check if editMap represents a metadata edit
    isMetadata(editMap: readonly string[]): boolean {
        return editMap.length >= 2 && editMap[0] === "metadata";
    },

    // Get the metadata field name
    getMetadataField(editMap: readonly string[]): string | null {
        return this.isMetadata(editMap) ? editMap[1] : null;
    }
};

// Type guards for type-safe filtering of edits by editMap path

// Generic type guard for filtering edits by editMap path with proper value typing
export function isEditWithPath<TEditMap extends readonly string[]>(
    editMap: TEditMap
): (edit: any) => edit is { editMap: TEditMap; value: string | number | boolean | object; timestamp: number; type: any; author?: string; validatedBy?: any[]; } {
    return (edit: any): edit is { editMap: TEditMap; value: string | number | boolean | object; timestamp: number; type: any; author?: string; validatedBy?: any[]; } => {
        return EditMapUtils.equals(edit.editMap, editMap);
    };
}

// Type guard to check if an edit is a value edit (has string content)
export function isValueEdit(edit: any): edit is { editMap: readonly string[]; value: string; timestamp: number; type: any; author?: string; validatedBy?: any[]; } {
    return EditMapUtils.isValue(edit.editMap);
}

// Type-safe filter utility for getting edits of a specific type
export function filterEditsByPath<TEditMap extends readonly string[]>(
    edits: any[],
    editMap: TEditMap
): Array<{ editMap: TEditMap; value: string | number | boolean | object; timestamp: number; type: any; author?: string; validatedBy?: any[]; }> {
    return edits.filter(isEditWithPath(editMap));
}

/**
 * Deduplicates file-level metadata edits based on timestamp, editMap, and value
 * Returns sorted array of unique edits
 */
export function deduplicateFileMetadataEdits(
    edits: any[]
): any[] {
    if (!edits || edits.length === 0) {
        return [];
    }

    // Create a Map to track unique edits by key: timestamp:editMap:value
    const editMap = new Map<string, any>();

    edits.forEach((edit) => {
        if (edit.editMap && Array.isArray(edit.editMap)) {
            const editMapKey = edit.editMap.join('.');
            const key = `${edit.timestamp}:${editMapKey}:${edit.value}`;

            // Keep the first occurrence of a duplicate (file-level edits don't have validatedBy)
            if (!editMap.has(key)) {
                editMap.set(key, edit);
            }
        }
    });

    // Convert map back to array and sort by timestamp
    return Array.from(editMap.values()).sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Helper function to add an edit entry to metadata edits when updating metadata fields directly
 * This is used when updating metadata outside of CodexCellDocument.updateNotebookMetadata()
 */
export function addMetadataEdit(
    metadata: { edits?: any[]; },
    field: string,
    value: any,
    author: string
): void {
    // Initialize edits array if it doesn't exist
    if (!metadata.edits) {
        metadata.edits = [];
    }

    const currentTimestamp = Date.now();

    // Determine editMap based on field name
    let editMap: readonly string[];
    switch (field) {
        case "videoUrl":
            editMap = EditMapUtils.metadataVideoUrl();
            break;
        case "textDirection":
            editMap = EditMapUtils.metadataTextDirection();
            break;
        case "lineNumbersEnabled":
            editMap = EditMapUtils.metadataLineNumbersEnabled();
            break;
        case "fontSize":
            editMap = EditMapUtils.metadataFontSize();
            break;
        case "autoDownloadAudioOnOpen":
            editMap = EditMapUtils.metadataAutoDownloadAudioOnOpen();
            break;
        case "showInlineBacktranslations":
            editMap = EditMapUtils.metadataShowInlineBacktranslations();
            break;
        case "fileDisplayName":
            editMap = EditMapUtils.metadataFileDisplayName();
            break;
        case "cellDisplayMode":
            editMap = EditMapUtils.metadataCellDisplayMode();
            break;
        case "audioOnly":
            editMap = EditMapUtils.metadataAudioOnly();
            break;
        case "corpusMarker":
            editMap = EditMapUtils.metadataCorpusMarker();
            break;
        default:
            editMap = EditMapUtils.metadataField(field);
    }

    // Create the new edit entry
    const newEdit = {
        editMap,
        value,
        timestamp: currentTimestamp,
        type: EditType.USER_EDIT,
        author,
    };

    // Add the new edit and deduplicate
    metadata.edits.push(newEdit);
    metadata.edits = deduplicateFileMetadataEdits(metadata.edits);
}

/**
 * Helper function to add an edit entry to project metadata edits when updating metadata.json fields
 * For meta edits (editMap is ["meta"]), value should be a partial object with only changed fields.
 * For other edits, value is the entire object/value being tracked.
 */
export function addProjectMetadataEdit(
    metadata: { edits?: any[]; },
    editMap: readonly string[],
    value: any,
    author: string
): void {
    // Initialize edits array if it doesn't exist
    if (!metadata.edits) {
        metadata.edits = [];
    }

    const currentTimestamp = Date.now();

    // Create the new edit entry
    const newEdit = {
        editMap,
        value,
        timestamp: currentTimestamp,
        type: EditType.USER_EDIT,
        author,
    };

    // Add the new edit and deduplicate (can reuse the same deduplication function)
    metadata.edits.push(newEdit);
    metadata.edits = deduplicateFileMetadataEdits(metadata.edits);
}
