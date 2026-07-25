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
    const validation = validateIdmlTranslation(
        metadata.idmlSourceHtml,
        cell.value,
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
        targetHtml: cell.value,
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
