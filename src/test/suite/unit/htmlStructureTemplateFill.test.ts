import * as assert from "assert";
import {
    compareHtmlStructure,
    extractPlainTextFromHtml,
} from "../../../../sharedUtils/htmlStructureUtils";
import {
    extractRenderedText,
    fillSourceTemplateWithTranslation,
    isSafeForcedRewrite,
    splitTranslationAcrossSlots,
} from "../../../../sharedUtils/htmlStructureTemplateFill";

/** A Biblica paragraph with one span per visible IDML content slot. */
const segmented = (slots: Array<{ index: number; style: string; text: string; }>): string =>
    `<p class="indesign-paragraph" data-paragraph-style="ParagraphStyle/intro%3aio1" data-story-id="u363" data-segment-count="9">` +
    slots
        .map(
            (slot, position) =>
                (position > 0 ? '<span class="idml-eoc" data-eoc="1" aria-hidden="true"></span>' : "") +
                `<span class="idml-segment" data-segment-index="${slot.index}" data-character-style="CharacterStyle/${slot.style}">${slot.text}</span>`
        )
        .join("") +
    `</p>`;

/** Text of each idml-segment span, in document order. */
const slotTexts = (html: string): string[] => {
    const pattern = /<span class="idml-segment"[^>]*>([\s\S]*?)<\/span>/g;
    const out: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) out.push(match[1]);
    return out;
};

suite("htmlStructureTemplateFill", () => {
    suite("splitTranslationAcrossSlots", () => {
        test("returns the whole translation for a single slot", () => {
            assert.deepStrictEqual(splitTranslationAcrossSlots(["Hello"], "Hola"), ["Hola"]);
        });

        test("always returns one piece per slot that rejoins to the original", () => {
            const slots = ["The story of Abraham ", "(12:1 – 25:18)", "."];
            const target = "A história de Abraão (12:1 – 25:18).";

            const pieces = splitTranslationAcrossSlots(slots, target);

            assert.strictEqual(pieces.length, slots.length);
            assert.strictEqual(pieces.join(""), target);
        });

        test("pins a numeric reference to its own slot", () => {
            const pieces = splitTranslationAcrossSlots(
                ["The story of Abraham ", "(12:1 – 25:18)", "."],
                "A história de Abraão (12:1 – 25:18)."
            );

            assert.deepStrictEqual(pieces, ["A história de Abraão ", "(12:1 – 25:18)", "."]);
        });

        test("keeps the separating space with the preceding slot", () => {
            const pieces = splitTranslationAcrossSlots(
                ["Israel", "s covenant history"],
                "A história da aliança"
            );

            assert.strictEqual(pieces.join(""), "A história da aliança");
            assert.ok(!pieces[1].startsWith(" "), "styled run should not start with a space");
        });

        test("splits a term from its definition at the colon", () => {
            const pieces = splitTranslationAcrossSlots(
                ["Speak other languages:", " When people speak out loud in another language."],
                "Falar outras línguas: Quando pessoas falam em voz alta em outra língua."
            );

            assert.strictEqual(pieces[0], "Falar outras línguas: ");
            assert.strictEqual(pieces.join(""), "Falar outras línguas: Quando pessoas falam em voz alta em outra língua.");
        });
    });

    suite("fillSourceTemplateWithTranslation", () => {
        test("rebuilds a flat translation inside a multi-slot source", () => {
            const source = segmented([
                { index: 0, style: "$ID/[No character style]", text: "The beginning of creation " },
                { index: 1, style: "ior", text: "(1 – 3)" },
                { index: 2, style: "$ID/[No character style]", text: "." },
            ]);
            const target = "<span>O início da criação (1 – 3).</span>";

            const result = fillSourceTemplateWithTranslation(source, target);

            assert.ok(result);
            assert.strictEqual(result!.strategy, "anchored");
            assert.ok(compareHtmlStructure(source, result!.html).isMatch);
            assert.deepStrictEqual(slotTexts(result!.html), [
                "O início da criação ",
                "(1 – 3)",
                ".",
            ]);
        });

        test("reuses the translator's own segments when they are still present", () => {
            const source = segmented([
                { index: 0, style: "k", text: "Term:" },
                { index: 1, style: "$ID/[No character style]", text: " first half" },
                { index: 2, style: "$ID/[No character style]", text: " second half" },
            ]);
            const target = segmented([
                { index: 0, style: "k", text: "Termo:" },
                { index: 2, style: "$ID/[No character style]", text: " primeira e segunda metade" },
            ]);

            const result = fillSourceTemplateWithTranslation(source, target);

            assert.ok(result);
            assert.strictEqual(result!.strategy, "segmentIndex");
            assert.ok(compareHtmlStructure(source, result!.html).isMatch);
            // The merged-away slot is emptied rather than guessed at, and the
            // translator's own slot assignment is preserved exactly.
            assert.deepStrictEqual(slotTexts(result!.html), [
                "Termo:",
                "",
                " primeira e segunda metade",
            ]);
        });

        test("keeps the spaces at segment edges and in whitespace-only segments", () => {
            // Acts 21:1–16 (#1184): trimming each segment and dropping the
            // whitespace-only segment 3 glued "في صُور وقَيْصَرِيَّة بُولُس" into one word.
            const source = segmented([
                { index: 0, style: "bd", text: "21:1–16" },
                { index: 1, style: "$ID/[No character style]", text: " Believers in " },
                { index: 4, style: "k_xt", text: "Tyre" },
                { index: 5, style: "$ID/[No character style]", text: " and " },
                { index: 6, style: "k_xt", text: "Caesarea" },
                { index: 7, style: "$ID/[No character style]", text: " warned Paul." },
            ]);
            const target = segmented([
                { index: 0, style: "bd", text: "21: 1 - 16" },
                { index: 1, style: "$ID/[No character style]", text: " وحذَّر المؤمنون في" },
                { index: 3, style: "$ID/[No character style]", text: " " },
                { index: 4, style: "k_xt", text: "صُور" },
                { index: 5, style: "$ID/[No character style]", text: " و" },
                { index: 6, style: "k_xt", text: "قَيْصَرِيَّة" },
                { index: 7, style: "$ID/[No character style]", text: " بُولُس." },
            ]);

            const result = fillSourceTemplateWithTranslation(source, target);

            assert.ok(result);
            assert.strictEqual(result!.strategy, "segmentIndex");
            assert.ok(compareHtmlStructure(source, result!.html).isMatch);
            assert.strictEqual(
                extractRenderedText(result!.html),
                "21: 1 - 16 وحذَّر المؤمنون في صُور وقَيْصَرِيَّة بُولُس."
            );
            assert.ok(isSafeForcedRewrite(source, target, result!.html));
        });

        test("does not split a word the translation carries across two runs", () => {
            // Iconium (#1184): an earlier resolve mirrored "Itʼs" and "Paulʼs" as
            // separate runs, leaving "ويُ|عتقد" and "بُولُ|س". Reading those run
            // boundaries as spaces showed the reader "ويُ عتقد" and "بُولُ س".
            const source = segmented([
                { index: 0, style: "k", text: "Iconium:" },
                { index: 1, style: "$ID/[No character style]", text: " Itʼs thought that Paulʼs let­ter was read there." },
            ]);
            const target = segmented([
                { index: 0, style: "k", text: "أَيْقُونِيَة:" },
                { index: 1, style: "$ID/[No character style]", text: " ويُ" },
                { index: 3, style: "$ID/[No character style]", text: "عتقد أنَّ رسالة بُولُ" },
                { index: 5, style: "$ID/[No character style]", text: "س قُرئت هناك." },
            ]);

            const result = fillSourceTemplateWithTranslation(source, target);

            assert.ok(result);
            assert.strictEqual(result!.strategy, "anchored");
            assert.ok(compareHtmlStructure(source, result!.html).isMatch);
            assert.strictEqual(
                extractRenderedText(result!.html),
                "أَيْقُونِيَة: ويُعتقد أنَّ رسالة بُولُس قُرئت هناك."
            );
            assert.ok(isSafeForcedRewrite(source, target, result!.html));
        });

        test("does not put a space before punctuation that starts a run", () => {
            // Acts 12:18–24 (#1184): "بُطْرُس|. ولم" became "بُطْرُس . ولم".
            const source = segmented([
                { index: 0, style: "bd", text: "12:18–24" },
                { index: 1, style: "$ID/[No character style]", text: " Peterʼs guards died. Herod didnʼt honour God, but let people praise him." },
            ]);
            const target = segmented([
                { index: 0, style: "bd", text: "12: 18 - 24" },
                { index: 1, style: "$ID/[No character style]", text: " ومع حُرَّاس سجن بُطْرُس" },
                { index: 3, style: "$ID/[No character style]", text: ". ولم يُعطِ هِيرُودُس المجد الله" },
                { index: 5, style: "$ID/[No character style]", text: "، بل سمح للناس." },
            ]);

            const result = fillSourceTemplateWithTranslation(source, target);

            assert.ok(result);
            const text = extractRenderedText(result!.html);
            assert.ok(text.includes("بُطْرُس. ولم"), text);
            assert.ok(text.includes("الله، بل"), text);
            assert.ok(isSafeForcedRewrite(source, target, result!.html));
        });

        test("drops inline formatting the source does not have", () => {
            const source = segmented([
                { index: 0, style: "$ID/[No character style]", text: "Israel" },
                { index: 2, style: "$ID/[No character style]", text: "s covenant history" },
            ]);
            const target = "<span><strong>A história da aliança de Israel</strong></span>";

            const result = fillSourceTemplateWithTranslation(source, target);

            assert.ok(result);
            assert.ok(compareHtmlStructure(source, result!.html).isMatch);
            assert.ok(!result!.html.includes("<strong>"));
            assert.strictEqual(
                extractPlainTextFromHtml(result!.html),
                "A história da aliança de Israel"
            );
        });

        test("escapes text so injected content cannot invent tags", () => {
            const source = segmented([
                { index: 0, style: "$ID/[No character style]", text: "Plain" },
            ]);
            const target = "<span>a &lt; b &amp; c</span>";

            const result = fillSourceTemplateWithTranslation(source, target);

            assert.ok(result);
            assert.ok(compareHtmlStructure(source, result!.html).isMatch);
            assert.ok(result!.html.includes("a &lt; b &amp; c"));
        });

        test("returns null when there is no translation to place", () => {
            const source = segmented([
                { index: 0, style: "$ID/[No character style]", text: "Plain" },
            ]);
            assert.strictEqual(fillSourceTemplateWithTranslation(source, "<span> </span>"), null);
            assert.strictEqual(fillSourceTemplateWithTranslation("", "<span>x</span>"), null);
        });
    });

    suite("isSafeForcedRewrite", () => {
        const source = segmented([
            { index: 0, style: "$ID/[No character style]", text: "Hello " },
            { index: 1, style: "ior", text: "(1 – 3)" },
        ]);

        test("accepts a rewrite that matches the source and keeps every word", () => {
            const result = fillSourceTemplateWithTranslation(source, "<span>Olá (1 – 3)</span>");
            assert.ok(result);
            assert.ok(isSafeForcedRewrite(source, "<span>Olá (1 – 3)</span>", result!.html));
        });

        test("rejects a rewrite that lost translated text", () => {
            const truncated = segmented([
                { index: 0, style: "$ID/[No character style]", text: "Olá " },
                { index: 1, style: "ior", text: "" },
            ]);
            assert.strictEqual(
                isSafeForcedRewrite(source, "<span>Olá (1 – 3)</span>", truncated),
                false
            );
        });

        test("rejects a rewrite whose structure still differs", () => {
            assert.strictEqual(
                isSafeForcedRewrite(source, "<span>Olá (1 – 3)</span>", "<span>Olá (1 – 3)</span>"),
                false
            );
        });

        test("accepts a space that moved from one run to the next", () => {
            const original = segmented([
                { index: 0, style: "$ID/[No character style]", text: "Olá " },
                { index: 1, style: "ior", text: "(1 – 3)" },
            ]);
            const moved = segmented([
                { index: 0, style: "$ID/[No character style]", text: "Olá" },
                { index: 1, style: "ior", text: " (1 – 3)" },
            ]);
            assert.ok(isSafeForcedRewrite(source, original, moved));
        });

        test("rejects a rewrite that adds a space inside a word", () => {
            const original = segmented([
                { index: 0, style: "$ID/[No character style]", text: "رسالة بُولُ" },
                { index: 1, style: "ior", text: "س (1 – 3)" },
            ]);
            const split = segmented([
                { index: 0, style: "$ID/[No character style]", text: "رسالة بُولُ " },
                { index: 1, style: "ior", text: "س (1 – 3)" },
            ]);
            assert.strictEqual(isSafeForcedRewrite(source, original, split), false);
        });

        test("rejects a rewrite that drops the space between two words", () => {
            const original = segmented([
                { index: 0, style: "$ID/[No character style]", text: "في " },
                { index: 1, style: "ior", text: "صُور (1 – 3)" },
            ]);
            const glued = segmented([
                { index: 0, style: "$ID/[No character style]", text: "في" },
                { index: 1, style: "ior", text: "صُور (1 – 3)" },
            ]);
            assert.strictEqual(isSafeForcedRewrite(source, original, glued), false);
        });
    });

    suite("extractRenderedText", () => {
        test("joins text across inline tags without adding a space", () => {
            assert.strictEqual(
                extractRenderedText(
                    '<p><span class="idml-segment">بُولُ</span><span class="idml-eoc" aria-hidden="true"></span><span class="idml-segment">س</span></p>'
                ),
                "بُولُس"
            );
        });

        test("separates words at block boundaries and line breaks", () => {
            assert.strictEqual(extractRenderedText("<p>One</p><p>Two</p>"), "One Two");
            assert.strictEqual(extractRenderedText("One<br>Two<br/>Three"), "One Two Three");
        });

        test("decodes entities once and collapses whitespace", () => {
            assert.strictEqual(
                extractRenderedText("<span> a &amp;lt; b&nbsp;&#1576;&#x062A;  c </span>"),
                "a &lt; b بت c"
            );
        });
    });
});
