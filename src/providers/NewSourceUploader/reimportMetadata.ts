import { EditType } from "../../../types/enums";
import { EditMapUtils } from "../../utils/editMapUtils";
import type { ReimportCell, ReimportEdit } from "./reimportMerge";

/** Importer-owned locator fields that must be explicitly cleared when a new parse omits them. */
const IMPORTER_LOCATOR_METADATA_KEYS = [
    "paragraphId",
    "paragraphIndex",
    "paragraphIndices",
    "paragraphMappingVersion",
    "segmentIndex",
    "segmentCount",
    "sourceSpan",
    "originalMarkdown",
    "segmentType",
    "storyId",
    "appliedParagraphStyle",
    "isBibleVerse",
    "verseId",
    "bookAbbreviation",
    "chapterNumber",
    "verseNumber",
    "beforeVerse",
    "afterVerse",
    "footnotes",
    "verseStructureXml",
    "unitId",
    "sourceLanguage",
    "targetLanguage",
    "targetText",
    "note",
    "cellIndex",
    "lineIndex",
    "originalLine",
    "originalText",
    "verseReference",
    "verseEnd",
    "book",
    "bookCode",
    "bookName",
    "vref",
    "fileName",
    "chapter",
    "marker",
    "verse",
    "breakTag",
    "hasFootnotes",
    "isChild",
    "parentId",
    "elementType",
    "hasHeading",
    "headingText",
    "headingLevel",
    "storyNumber",
    "storyTitle",
    "documentId",
    "sectionId",
    "imageAlt",
    "imageTitle",
    "originalImageSrc",
] as const;

const IMPORTER_LOCATOR_DATA_KEYS = [
    "rowIndex",
    "sourceColumnIndex",
    "originalRowValues",
    "originalContent",
    "lineIndex",
    "originalLine",
    "originalText",
    "verseNumber",
    "startTime",
    "endTime",
    "format",
    "globalReferences",
    "idmlStructure",
    "relationships",
    "unitId",
] as const;

/** Notebook metadata that identifies the existing pair and must not change. */
const PRESERVED_NOTEBOOK_METADATA_KEYS = [
    "id",
    "fileDisplayName",
    "sourceFsPath",
    "codexFsPath",
    "navigation",
    "sourceCreatedAt",
    "corpusMarker",
    "textDirection",
    "videoUrl",
    "lineNumbersEnabled",
    "lineNumbersEnabledSource",
] as const;

const REIMPORT_AUTHOR = "system";

export const makeReimportEdit = (
    editMap: readonly string[],
    value: unknown,
    timestamp: number,
): ReimportEdit => ({
    editMap,
    value,
    timestamp,
    type: EditType.MIGRATION,
    author: REIMPORT_AUTHOR,
    validatedBy: [],
});

const ensureEdits = (cell: ReimportCell): ReimportEdit[] => {
    const metadata = (cell.metadata ??= {});
    return (metadata.edits ??= []);
};

export const mergeNotebookMetadata = (
    existing: Record<string, unknown> | undefined,
    incoming: Record<string, unknown> | undefined,
    timestamp: number,
): Record<string, unknown> => {
    const merged: Record<string, unknown> = { ...(existing ?? {}), ...(incoming ?? {}) };
    for (const key of PRESERVED_NOTEBOOK_METADATA_KEYS) {
        if (existing && existing[key] !== undefined) {
            merged[key] = existing[key];
        }
    }
    const existingEdits = Array.isArray(existing?.edits) ? existing.edits : [];
    const incomingEdits = Array.isArray(incoming?.edits) ? incoming.edits : [];
    const edits = [...existingEdits, ...incomingEdits] as ReimportEdit[];
    for (const [field, value] of Object.entries(incoming ?? {})) {
        if (field === "edits" || value === undefined) continue;
        if ((PRESERVED_NOTEBOOK_METADATA_KEYS as readonly string[]).includes(field)) continue;
        if (JSON.stringify(existing?.[field]) === JSON.stringify(value)) continue;
        edits.push(makeReimportEdit(EditMapUtils.metadata(field), value, timestamp));
    }
    merged.edits = edits;
    return merged;
};

/** Record all refreshed importer locators as edits so they survive sync merges. */
export const appendImporterMetadataEdits = (
    cell: ReimportCell,
    oldMetadata: Record<string, unknown> | undefined,
    timestamp: number,
): void => {
    const newMetadata = (cell.metadata ??= {}) as Record<string, unknown>;
    const edits = ensureEdits(cell);
    for (const [field, value] of Object.entries(newMetadata)) {
        if (field === "id" || field === "edits" || field === "data" || value === undefined) continue;
        if (JSON.stringify(oldMetadata?.[field]) === JSON.stringify(value)) continue;
        edits.push(makeReimportEdit(EditMapUtils.metadata(field), value, timestamp));
    }
    for (const field of IMPORTER_LOCATOR_METADATA_KEYS) {
        if (oldMetadata?.[field] === undefined || newMetadata[field] !== undefined) continue;
        newMetadata[field] = null;
        edits.push(makeReimportEdit(EditMapUtils.metadata(field), null, timestamp));
    }

    const newData = (newMetadata.data ??= {}) as Record<string, unknown>;
    const oldData = oldMetadata?.data as Record<string, unknown> | undefined;
    for (const [field, value] of Object.entries(newData)) {
        if (value === undefined) continue;
        if (JSON.stringify(oldData?.[field]) === JSON.stringify(value)) continue;
        edits.push(makeReimportEdit(EditMapUtils.metadataNested("data", field), value, timestamp));
    }
    for (const field of IMPORTER_LOCATOR_DATA_KEYS) {
        if (oldData?.[field] === undefined || newData[field] !== undefined) continue;
        newData[field] = null;
        edits.push(makeReimportEdit(EditMapUtils.metadataNested("data", field), null, timestamp));
    }
};

export const remapNotebookMetadataCellIds = (
    metadata: Record<string, unknown> | undefined,
    idMap: Map<string, string>,
): Record<string, unknown> | undefined => {
    if (!metadata || idMap.size === 0) return metadata;

    const remap = (value: unknown): unknown => {
        if (typeof value === "string") return idMap.get(value) ?? value;
        if (Array.isArray(value)) return value.map(remap);
        if (value && typeof value === "object") {
            return Object.fromEntries(
                Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, remap(child)])
            );
        }
        return value;
    };

    return remap(metadata) as Record<string, unknown>;
};
