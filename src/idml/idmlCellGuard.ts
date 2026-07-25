import {
    IDML_SCHEMA_VERSION,
    validateIdmlTranslation,
} from "@aquilla/idml-roundtrip";
import type { IdmlFormatMetadataV2 } from "@aquilla/idml-roundtrip";

export interface IdmlCellContract {
    readonly id?: string;
    readonly idml?: unknown;
    readonly idmlSourceHtml?: string;
}

export function assertValidIdmlCellContent(
    metadata: IdmlCellContract,
    targetHtml: string
): void {
    if (metadata.idml === undefined) {
        return;
    }

    const version = Number(
        (metadata.idml as { readonly version?: unknown } | null)?.version
    );
    if (version !== IDML_SCHEMA_VERSION) {
        throw new Error(
            Number.isFinite(version) && version > IDML_SCHEMA_VERSION
                ? `Unsupported future IDML metadata version ${version}; update Codex Editor before editing this cell.`
                : "Legacy or invalid IDML metadata; repair or re-import this IDML before editing."
        );
    }
    if (!metadata.idmlSourceHtml) {
        throw new Error(
            `IDML cell ${metadata.id ?? "(unknown)"} is missing immutable source HTML; repair or re-import it before editing.`
        );
    }

    const validation = validateIdmlTranslation(
        metadata.idmlSourceHtml,
        targetHtml,
        metadata.idml as IdmlFormatMetadataV2
    );
    if (!validation.valid) {
        throw new Error(
            `IDML protected anchors are invalid: ${validation.diagnostics
                .map((diagnostic) => diagnostic.message)
                .join("; ")}`
        );
    }
}
