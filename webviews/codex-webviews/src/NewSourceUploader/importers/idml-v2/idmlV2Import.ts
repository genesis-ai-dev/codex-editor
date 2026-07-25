import { IDML_SCHEMA_VERSION, renderIdmlUnitHtml, validateIdmlTranslation } from "@aquilla/idml-roundtrip";
import type {
    IdmlParseResult,
    IdmlSemanticProfile,
    IdmlTranslationUnit,
} from "@aquilla/idml-roundtrip";
import { v4 as uuidv4 } from "uuid";
import { CodexCellTypes } from "types/enums";
import type { CustomNotebookCellData } from "types";
import type { ImportProgress, NotebookPair, ProcessedCell } from "../../types/common";
import { sanitizeFileName } from "../../utils/workflowHelpers";
import { parseIdmlInWorker } from "./idmlV2WorkerClient";

export type CodexIdmlProfile = Extract<IdmlSemanticProfile, string>;

function emptyProtectedHtml(unit: IdmlTranslationUnit): string {
    const targetHtml = renderIdmlUnitHtml({
        ...unit,
        sourceText: "",
        slots: unit.slots.map((slot) => ({
            ...slot,
            text: slot.editable ? "" : slot.text,
        })),
    });
    const validation = validateIdmlTranslation(unit.sourceHtml, targetHtml, unit.metadata);
    if (!validation.valid) {
        throw new Error(
            `IDML engine produced invalid target anchors for ${unit.id}: ${validation.diagnostics
                .map((diagnostic) => diagnostic.message)
                .join("; ")}`
        );
    }
    return targetHtml;
}

function canonicalCellMetadata(unit: IdmlTranslationUnit): CustomNotebookCellData["metadata"] {
    return {
        id: unit.id,
        type: CodexCellTypes.TEXT,
        edits: [],
        idml: unit.metadata,
        idmlLocator: unit.locator,
        idmlSourceHtml: unit.sourceHtml,
        data: {
            originalContent: unit.sourceText,
            originalText: unit.sourceText,
            globalReferences: [],
        },
    };
}

export function createIdmlV2Cells(result: IdmlParseResult): {
    sourceCells: ProcessedCell[];
    targetCells: ProcessedCell[];
} {
    const sourceCells: ProcessedCell[] = [];
    const targetCells: ProcessedCell[] = [];

    for (const unit of result.units) {
        const metadata = canonicalCellMetadata(unit);
        sourceCells.push({
            id: unit.id,
            content: unit.sourceHtml,
            images: [],
            metadata,
        });
        targetCells.push({
            id: unit.id,
            content: emptyProtectedHtml(unit),
            images: [],
            metadata: {
                ...metadata,
                data: metadata.data ? { ...metadata.data } : undefined,
            },
        });
    }

    return { sourceCells, targetCells };
}

function progressPercent(completed: number, total: number): number {
    if (total <= 0) return 20;
    return 15 + Math.round((completed / total) * 70);
}

export async function createIdmlV2NotebookPair(
    file: File,
    profile: CodexIdmlProfile,
    onProgress: (progress: ImportProgress) => void,
    parse: typeof parseIdmlInWorker = parseIdmlInWorker
): Promise<NotebookPair> {
    if (!file.name.toLowerCase().endsWith(".idml")) {
        throw new Error("Please select a valid IDML file (.idml extension)");
    }

    onProgress({ stage: "Read", message: "Reading IDML package…", progress: 5 });
    const originalFileData = await file.arrayBuffer();
    const result = await parse(originalFileData, profile, {
        onProgress: (update) => {
            onProgress({
                stage: update.phase,
                message: update.memberPath
                    ? `${update.phase}: ${update.memberPath}`
                    : `IDML ${update.phase}…`,
                progress: progressPercent(update.completed, update.total),
            });
        },
    });
    if (result.units.length === 0) {
        throw new Error("The IDML package contains no supported literal text locations.");
    }

    const { sourceCells, targetCells } = createIdmlV2Cells(result);
    const originalHash = result.manifest.sourceSha256;
    const baseName = sanitizeFileName(file.name);
    const createdAt = new Date().toISOString();
    const importerType: "biblica" | "indesign" =
        profile === "biblica" ? "biblica" : "indesign";
    const commonMetadata = {
        originalFileName: file.name,
        sourceFile: file.name,
        importerType,
        createdAt,
        importContext: {
            importerType,
            fileName: file.name,
            originalFileName: file.name,
            originalHash,
            importTimestamp: createdAt,
            ...(profile === "biblica" ? { contentType: "notes" } : {}),
        },
        originalHash,
        totalCells: sourceCells.length,
        fileType: importerType,
        enforceHtmlStructure: true,
        idmlSchemaVersion: IDML_SCHEMA_VERSION,
        idmlManifest: result.manifest,
        idmlFidelity: "content-only" as const,
        ...(profile === "biblica" ? { contentType: "notes" as const } : {}),
    };

    onProgress({ stage: "Complete", message: "IDML v2 import ready", progress: 100 });
    return {
        source: {
            name: baseName,
            cells: sourceCells,
            metadata: {
                id: uuidv4(),
                ...commonMetadata,
                originalFileData,
            },
        },
        codex: {
            name: baseName,
            cells: targetCells,
            metadata: {
                id: uuidv4(),
                ...commonMetadata,
                isCodex: true,
            },
        },
    };
}
