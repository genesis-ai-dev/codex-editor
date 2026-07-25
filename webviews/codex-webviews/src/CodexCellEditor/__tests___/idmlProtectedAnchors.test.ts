import { describe, expect, it } from "vitest";
import {
    IDML_EMPTY_ANCHOR_SENTINEL,
    prepareIdmlHtmlForQuill,
    validateAndCanonicalizeIdmlHtml,
    validateCanonicalIdmlTranslation,
} from "../utils/idmlProtectedAnchors";

const metadata = {
    version: 2 as const,
    slotCount: 1,
    editableSlotIndexes: [0],
    protectedTokenCount: 0,
    anchorSequenceHash:
        "766aa2a87159f27180547d4dafd88d46cfb4a351e497cc942fb2688a37af76e9",
};
const sourceHtml =
    '<p data-idml-version="2"><span data-idml-slot="0" data-idml-character-style="style" data-idml-protected="slot">Hello</span></p>';
const contract = { metadata, sourceHtml };

describe("IDML protected Quill serialization", () => {
    it("preserves an empty slot using an editor-only sentinel", () => {
        const emptyTarget =
            '<p data-idml-version="2"><span data-idml-slot="0" data-idml-character-style="style" data-idml-protected="slot"></span></p>';
        const editorHtml = prepareIdmlHtmlForQuill(emptyTarget);

        expect(editorHtml).toContain("idml-anchor");
        expect(editorHtml).toContain(IDML_EMPTY_ANCHOR_SENTINEL);
        expect(validateAndCanonicalizeIdmlHtml(editorHtml, contract)).toBe(emptyTarget);
    });

    it("allows a bare line break inside the original style slot", () => {
        const target =
            '<p data-idml-version="2"><span data-idml-slot="0" data-idml-character-style="style" data-idml-protected="slot">Bonjour<br>monde</span></p>';

        expect(() => validateCanonicalIdmlTranslation(target, contract)).not.toThrow();
        expect(
            validateAndCanonicalizeIdmlHtml(
                prepareIdmlHtmlForQuill(target),
                contract
            )
        ).toBe(target);
    });

    it("rejects deleted or renumbered anchors", () => {
        const target =
            '<p data-idml-version="2"><span data-idml-slot="1" data-idml-character-style="style" data-idml-protected="slot">Bonjour</span></p>';

        expect(() => validateCanonicalIdmlTranslation(target, contract)).toThrow();
    });

    it("rejects unsupported future metadata versions", () => {
        expect(() =>
            validateCanonicalIdmlTranslation(sourceHtml, {
                sourceHtml,
                metadata: { ...metadata, version: 3 },
            })
        ).toThrow(/future IDML metadata version 3/);
    });
});
