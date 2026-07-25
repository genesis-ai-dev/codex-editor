import {
    IDML_SCHEMA_VERSION,
    exportIdml,
    validateExport,
    validateIdmlTranslation,
} from "@aquilla/idml-roundtrip";
import type {
    IdmlExportReport,
    IdmlFormatMetadataV2,
    IdmlLocator,
    IdmlSourceManifest,
    IdmlTranslation,
} from "@aquilla/idml-roundtrip";
import type { CustomNotebookCellData } from "types";

type ExportableCell = Pick<CustomNotebookCellData, "value" | "metadata">;

const IDML_SLOT_PATTERN =
    /(<span\b(?=[^>]*\bdata-idml-protected="slot")(?=[^>]*\bdata-idml-slot="(\d+)")[^>]*>)([\s\S]*?)(<\/span>)/g;

function preserveUntranslatedSlots(
    sourceHtml: string,
    targetHtml: string,
    translatedSlotIndexes: readonly number[],
    metadata: IdmlFormatMetadataV2
): string {
    const editable = new Set(metadata.editableSlotIndexes);
    const translated = new Set<number>();
    for (const slotIndex of translatedSlotIndexes) {
        if (!Number.isInteger(slotIndex) || !editable.has(slotIndex)) {
            throw new Error(
                `IDML translated slot ${String(slotIndex)} is not an editable source slot.`
            );
        }
        translated.add(slotIndex);
    }
    const sourceSlots = new Map<number, string>();
    for (const match of sourceHtml.matchAll(IDML_SLOT_PATTERN)) {
        sourceSlots.set(Number(match[2]), match[3]);
    }
    if (sourceSlots.size !== metadata.slotCount) {
        throw new Error(
            `IDML source HTML contains ${sourceSlots.size} slots; expected ${metadata.slotCount}.`
        );
    }
    let targetSlotCount = 0;
    const composed = targetHtml.replace(
        IDML_SLOT_PATTERN,
        (match, opening: string, slot: string, content: string, closing: string) => {
            targetSlotCount += 1;
            const slotIndex = Number(slot);
            const sourceContent = sourceSlots.get(slotIndex);
            if (sourceContent === undefined) return match;
            return `${opening}${
                translated.has(slotIndex) ? content : sourceContent
            }${closing}`;
        }
    );
    if (targetSlotCount !== metadata.slotCount) {
        throw new Error(
            `IDML target HTML contains ${targetSlotCount} slots; expected ${metadata.slotCount}.`
        );
    }
    return composed;
}

function cellTranslation(cell: ExportableCell): IdmlTranslation {
    const metadata = cell.metadata;
    const idml = metadata.idml;
    const version = Number((idml as { version?: unknown } | undefined)?.version);
    if (version !== IDML_SCHEMA_VERSION) {
        throw new Error(
            Number.isFinite(version) && version > IDML_SCHEMA_VERSION
                ? `Unsupported future IDML metadata version ${version}; update Codex Editor before exporting.`
                : "Legacy or missing IDML v2 metadata; repair/re-import this IDML before exporting."
        );
    }
    if (!idml || !metadata.idmlLocator || !metadata.idmlSourceHtml) {
        throw new Error(`IDML cell ${metadata.id} is missing its source locator or source HTML.`);
    }
    if (
        metadata.idmlTranslationState !== "untranslated" &&
        metadata.idmlTranslationState !== "translated"
    ) {
        throw new Error(
            `IDML cell ${metadata.id} has no translation state; repair/re-import it before exporting so an empty target cannot be mistaken for an intentional deletion.`
        );
    }
    if (!Array.isArray(metadata.idmlTranslatedSlotIndexes)) {
        throw new Error(
            `IDML cell ${metadata.id} has no translated-slot state; repair/re-import it before exporting.`
        );
    }
    if (
        metadata.idmlTranslationState === "untranslated" &&
        metadata.idmlTranslatedSlotIndexes.length > 0
    ) {
        throw new Error(
            `IDML cell ${metadata.id} has contradictory untranslated and translated-slot metadata.`
        );
    }
    if (
        metadata.idmlTranslationState === "translated" &&
        metadata.idmlTranslatedSlotIndexes.length === 0
    ) {
        throw new Error(
            `IDML cell ${metadata.id} is marked translated but identifies no translated slots; export was blocked to prevent a silent skip.`
        );
    }
    const targetHtml = preserveUntranslatedSlots(
        metadata.idmlSourceHtml,
        cell.value,
        metadata.idmlTranslatedSlotIndexes,
        idml as IdmlFormatMetadataV2
    );
    const validation = validateIdmlTranslation(
        metadata.idmlSourceHtml,
        targetHtml,
        idml
    );
    if (!validation.valid) {
        throw new Error(
            `IDML cell ${metadata.id} has invalid protected anchors: ${validation.diagnostics
                .map((diagnostic) => diagnostic.message)
                .join("; ")}`
        );
    }
    return {
        unitId: metadata.id,
        locator: metadata.idmlLocator as IdmlLocator,
        metadata: idml as IdmlFormatMetadataV2,
        sourceHtml: metadata.idmlSourceHtml,
        targetHtml,
    };
}

export async function exportCodexIdmlV2(
    originalBytes: Uint8Array,
    cells: readonly ExportableCell[],
    manifest: IdmlSourceManifest
): Promise<{ bytes: Uint8Array; report: IdmlExportReport }> {
    if (manifest.version !== IDML_SCHEMA_VERSION) {
        throw new Error(
            `Unsupported IDML manifest version ${String(manifest.version)}; update Codex Editor before exporting.`
        );
    }
    const translations = cells
        .filter((cell) => cell.metadata.idml !== undefined)
        .map(cellTranslation);
    if (translations.length !== manifest.unitLocators.length) {
        throw new Error(
            `IDML export requires ${manifest.unitLocators.length} translation units, but found ${translations.length}.`
        );
    }

    const exported = await exportIdml(originalBytes, translations, { strict: true });
    const validation = await validateExport(exported.bytes, manifest);
    const errors = validation.filter((diagnostic) => diagnostic.severity === "error");
    if (errors.length > 0 || exported.report.missing > 0 || exported.report.rejected > 0) {
        throw new Error(
            `IDML export validation failed: ${[
                ...errors.map((diagnostic) => diagnostic.message),
                ...(exported.report.missing > 0
                    ? [`${exported.report.missing} translation units are missing`]
                    : []),
                ...(exported.report.rejected > 0
                    ? [`${exported.report.rejected} translation units were rejected`]
                    : []),
            ].join("; ")}`
        );
    }
    return exported;
}
