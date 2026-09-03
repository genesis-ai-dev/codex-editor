import * as assert from "assert";
import {
    buildIdmlStructuredResponseFormat,
    extractIdmlStructuredSource,
    reconstructIdmlTranslationHtml,
} from "../../../providers/translationSuggestions/idmlStructuredTranslation";
import { compareHtmlStructure } from "../../../../sharedUtils/htmlStructureUtils";

const sourceHtml =
    '<p class="indesign-paragraph" data-story-id="story-1">' +
    '<span class="idml-segment selected" data-segment-index="4" data-character-style="Bold">Reference &amp; title</span>' +
    '<span class="idml-eoc" data-eoc="1" aria-hidden="true"></span>' +
    "<span data-character-style='Body' data-segment-index='7' class='extra idml-segment'>Dictionary text</span>" +
    '<br class="idml-eoc" data-eoc="1" />' +
    '<span class="idml-segment" data-segment-index="9">Final line</span>' +
    "</p>";

suite("IDML structured translation", () => {
    test("extracts indexed text, styles, and separators in document order", () => {
        const source = extractIdmlStructuredSource(sourceHtml);

        assert.ok(source);
        assert.deepStrictEqual(
            source.segments.map(({ index, sourceText, characterStyle, separatorBefore }) => ({
                index,
                sourceText,
                characterStyle,
                separatorBefore,
            })),
            [
                {
                    index: 4,
                    sourceText: "Reference & title",
                    characterStyle: "Bold",
                    separatorBefore: "none",
                },
                {
                    index: 7,
                    sourceText: "Dictionary text",
                    characterStyle: "Body",
                    separatorBefore: "continuation",
                },
                {
                    index: 9,
                    sourceText: "Final line",
                    characterStyle: undefined,
                    separatorBefore: "line-break",
                },
            ],
        );
    });

    test("replaces text by index while preserving all source markup exactly", () => {
        const source = extractIdmlStructuredSource(sourceHtml);
        assert.ok(source);

        const result = reconstructIdmlTranslationHtml(source, JSON.stringify({
            // Deliberately return segments out of source order: indexes, not array
            // positions, are the stable reconstruction contract.
            segments: [
                { index: 9, translation: "Línea final" },
                { index: 4, translation: 'Referencia <principal> & "título"' },
                { index: 7, translation: "Texto del diccionario" },
            ],
        }));

        assert.strictEqual(
            result,
            sourceHtml
                .replace("Reference &amp; title", "Referencia &lt;principal&gt; &amp; &quot;título&quot;")
                .replace("Dictionary text", "Texto del diccionario")
                .replace("Final line", "Línea final"),
        );
        assert.strictEqual(compareHtmlStructure(sourceHtml, result).isMatch, true);
    });

    test("accepts a JSON response wrapped in a markdown fence for compatibility", () => {
        const source = extractIdmlStructuredSource(sourceHtml);
        assert.ok(source);

        const result = reconstructIdmlTranslationHtml(
            source,
            '```json\n{"segments":[{"index":4,"translation":"A"},{"index":7,"translation":"B"},{"index":9,"translation":"C"}]}\n```',
        );

        assert.ok(result.includes('data-segment-index="4" data-character-style="Bold">A</span>'));
        assert.ok(result.includes("data-segment-index='7' class='extra idml-segment'>B</span>"));
        assert.ok(result.includes('data-segment-index="9">C</span>'));
    });

    test("builds a strict schema constrained to the source indexes", () => {
        const source = extractIdmlStructuredSource(sourceHtml);
        assert.ok(source);

        const format = buildIdmlStructuredResponseFormat(source);
        assert.strictEqual(format.type, "json_schema");
        if (format.type !== "json_schema") return;
        assert.strictEqual(format.json_schema.strict, true);

        const schema = format.json_schema.schema as any;
        assert.deepStrictEqual(schema.properties.segments.items.properties.index.enum, [4, 7, 9]);
    });

    test("rejects duplicate, missing, unknown, and empty translations", () => {
        const source = extractIdmlStructuredSource(sourceHtml);
        assert.ok(source);

        const invalidResponses = [
            { segments: [{ index: 4, translation: "A" }, { index: 4, translation: "B" }, { index: 9, translation: "C" }] },
            { segments: [{ index: 4, translation: "A" }, { index: 7, translation: "B" }] },
            { segments: [{ index: 4, translation: "A" }, { index: 7, translation: "B" }, { index: 100, translation: "C" }] },
            { segments: [{ index: 4, translation: "" }, { index: 7, translation: " " }, { index: 9, translation: "" }] },
        ];

        for (const response of invalidResponses) {
            assert.throws(() => reconstructIdmlTranslationHtml(source, JSON.stringify(response)));
        }
    });

    test("opts out safely for malformed or unsupported source fragments", () => {
        assert.strictEqual(extractIdmlStructuredSource("<p>Plain source</p>"), null);
        assert.strictEqual(
            extractIdmlStructuredSource(
                '<p><span class="idml-segment" data-segment-index="1"><em>Nested</em></span></p>',
            ),
            null,
        );
        assert.strictEqual(
            extractIdmlStructuredSource(
                '<p><span class="idml-segment" data-segment-index="1">A</span>' +
                '<span class="idml-segment" data-segment-index="1">B</span></p>',
            ),
            null,
        );
        assert.strictEqual(
            extractIdmlStructuredSource(
                '<p><span class="idml-segment" data-segment-index="1">Unclosed</p>',
            ),
            null,
        );
    });
});
