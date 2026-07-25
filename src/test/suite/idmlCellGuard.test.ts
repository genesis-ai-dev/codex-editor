import * as assert from "assert";
import { areValidIdmlCellVariants } from "../../idml/idmlCellGuard";

const sourceHtml =
    '<p data-idml-version="2"><span data-idml-slot="0" data-idml-character-style="style" data-idml-protected="slot">Hello</span></p>';
const metadata = {
    id: "idml-unit",
    idml: {
        version: 2,
        slotCount: 1,
        editableSlotIndexes: [0],
        protectedTokenCount: 0,
        anchorSequenceHash:
            "766aa2a87159f27180547d4dafd88d46cfb4a351e497cc942fb2688a37af76e9",
    },
    idmlSourceHtml: sourceHtml,
};

suite("IDML cell guard", () => {
    test("accepts A/B variants only when every candidate preserves exact anchors", () => {
        const first =
            '<p data-idml-version="2"><span data-idml-slot="0" data-idml-character-style="style" data-idml-protected="slot">Bonjour</span></p>';
        const second =
            '<p data-idml-version="2"><span data-idml-slot="0" data-idml-character-style="style" data-idml-protected="slot">Salut</span></p>';

        assert.strictEqual(
            areValidIdmlCellVariants(metadata, [first, second]),
            true
        );
    });

    test("rejects the entire A/B set when one candidate changes anchor identity", () => {
        const valid =
            '<p data-idml-version="2"><span data-idml-slot="0" data-idml-character-style="style" data-idml-protected="slot">Bonjour</span></p>';
        const invalid =
            '<p data-idml-version="2"><span data-idml-slot="1" data-idml-character-style="style" data-idml-protected="slot">Salut</span></p>';

        assert.strictEqual(
            areValidIdmlCellVariants(metadata, [valid, invalid]),
            false
        );
    });
});
