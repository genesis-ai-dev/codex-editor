// Define specific tuple types for type safety
type ValueEditMap = ["value"];
type CellLabelEditMap = ["metadata", "cellLabel"];
type DataEditMap = ["metadata", "data"];
type DataDeletedEditMap = ["metadata", "data", "deleted"];
type DataStartTimeEditMap = ["metadata", "data", "startTime"];
type DataEndTimeEditMap = ["metadata", "data", "endTime"];
type SelectedAudioIdEditMap = ["metadata", "selectedAudioId"];
type SelectionTimestampEditMap = ["metadata", "selectionTimestamp"];

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
