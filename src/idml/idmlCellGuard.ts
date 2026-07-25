import {
    IDML_SCHEMA_VERSION,
    validateIdmlTranslation,
} from "@aquilla/idml-roundtrip";
import type { IdmlFormatMetadataV2 } from "@aquilla/idml-roundtrip";

export interface IdmlCellContract {
    readonly id?: string;
    readonly idml?: unknown;
    readonly idmlSourceHtml?: string;
    readonly idmlTranslatedSlotIndexes?: readonly number[];
}

export function updatedIdmlTranslatedSlotIndexes(
    metadata: IdmlCellContract,
    previousHtml: string,
    targetHtml: string,
    markAllEditableSlots = false,
    restoredSlotIndexes?: readonly number[]
): number[] | undefined {
    if (metadata.idml === undefined || !metadata.idmlSourceHtml) {
        return undefined;
    }
    const idml = metadata.idml as IdmlFormatMetadataV2;
    if (restoredSlotIndexes !== undefined) {
        const editable = new Set(idml.editableSlotIndexes);
        const restored = new Set<number>();
        for (const slotIndex of restoredSlotIndexes) {
            if (!Number.isInteger(slotIndex) || !editable.has(slotIndex)) {
                throw new Error(
                    `IDML history contains invalid translated slot ${String(slotIndex)}.`
                );
            }
            restored.add(slotIndex);
        }
        return [...restored].sort((left, right) => left - right);
    }
    const existing = new Set(metadata.idmlTranslatedSlotIndexes ?? []);
    if (markAllEditableSlots) {
        for (const slotIndex of idml.editableSlotIndexes) {
            existing.add(slotIndex);
        }
        return [...existing].sort((left, right) => left - right);
    }

    const previous = validateIdmlTranslation(
        metadata.idmlSourceHtml,
        previousHtml,
        idml
    );
    const target = validateIdmlTranslation(
        metadata.idmlSourceHtml,
        targetHtml,
        idml
    );
    if (!previous.valid || !target.valid) {
        return [...existing].sort((left, right) => left - right);
    }
    const sourceSlotIndexes = [
        ...metadata.idmlSourceHtml.matchAll(
            /<span\b(?=[^>]*\bdata-idml-protected="slot")(?=[^>]*\bdata-idml-slot="(\d+)")[^>]*>/g
        ),
    ].map((match) => Number(match[1]));
    const editable = new Set(idml.editableSlotIndexes);
    for (let position = 0; position < target.slots.length; position += 1) {
        if (previous.slots[position] !== target.slots[position]) {
            const slotIndex = sourceSlotIndexes[position];
            if (slotIndex !== undefined && editable.has(slotIndex)) {
                existing.add(slotIndex);
            }
        }
    }
    return [...existing].sort((left, right) => left - right);
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

/**
 * A/B and other multi-suggestion producers may surface variants only when
 * every candidate preserves the exact protected IDML contract. One invalid
 * candidate rejects the whole set so the UI can never commit it by mistake.
 */
export function areValidIdmlCellVariants(
    metadata: IdmlCellContract,
    variants: readonly string[]
): boolean {
    return variants.every((variant) => {
        try {
            assertValidIdmlCellContent(metadata, variant);
            return true;
        } catch {
            return false;
        }
    });
}
