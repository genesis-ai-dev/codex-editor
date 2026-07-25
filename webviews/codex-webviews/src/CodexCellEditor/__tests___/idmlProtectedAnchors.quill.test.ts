import { beforeEach, describe, expect, it } from "vitest";
import Quill, { Delta } from "quill";
import {
    insertIdmlClipboardText,
    prepareIdmlHtmlForQuill,
    validateAndCanonicalizeIdmlHtml,
} from "../utils/idmlProtectedAnchors";
import {
    IdmlAnchorFormat,
    registerIdmlQuillFormats,
} from "../utils/idmlQuillFormats";
import { installPreserveWhitespaceMatcher } from "../utils/preserveWhitespace";

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

type ClipboardModule = {
    convert: (args: { html?: string; text?: string }) => Delta;
    matchers: Array<[number | string, unknown]>;
};

function loadIdmlHtml(html: string): Quill {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const quill = new Quill(container, { theme: "snow" });
    const clipboard = quill.getModule("clipboard") as unknown as ClipboardModule;
    expect(installPreserveWhitespaceMatcher(clipboard as never)).toBe(true);
    quill.setContents(
        clipboard.convert({
            html: prepareIdmlHtmlForQuill(html),
            text: "",
        }),
        "silent"
    );
    return quill;
}

describe("IDML protected anchors through real Quill", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        Object.defineProperty(Range.prototype, "getBoundingClientRect", {
            configurable: true,
            value: () => ({
                bottom: 0,
                height: 0,
                left: 0,
                right: 0,
                top: 0,
                width: 0,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            }),
        });
        registerIdmlQuillFormats();
    });

    it("does not turn an untouched empty slot into an exportable space", () => {
        const target =
            '<p data-idml-version="2"><span data-idml-slot="0" data-idml-character-style="style" data-idml-protected="slot"></span></p>';
        const quill = loadIdmlHtml(target);

        expect(validateAndCanonicalizeIdmlHtml(quill.root.innerHTML, contract)).toBe(
            target
        );
    });

    it("saves and reloads a line break without creating another paragraph or anchor", () => {
        const target =
            '<p data-idml-version="2"><span data-idml-slot="0" data-idml-character-style="style" data-idml-protected="slot">Bonjour<br>monde</span></p>';
        const first = loadIdmlHtml(target);
        const saved = validateAndCanonicalizeIdmlHtml(
            first.root.innerHTML,
            contract
        );
        const reloaded = loadIdmlHtml(saved);

        expect(saved).toBe(target);
        expect(reloaded.root.querySelectorAll("p")).toHaveLength(1);
        expect(
            reloaded.root.querySelectorAll('[data-idml-protected="slot"]')
        ).toHaveLength(1);
        expect(
            validateAndCanonicalizeIdmlHtml(reloaded.root.innerHTML, contract)
        ).toBe(target);
    });

    it("inserts pasted multiline text inside the current protected style slot", () => {
        const target =
            '<p data-idml-version="2"><span data-idml-slot="0" data-idml-character-style="style" data-idml-protected="slot">AB</span></p>';
        const quill = loadIdmlHtml(target);
        const idmlAnchor = quill.getFormat(1, 0).idmlAnchor;
        expect(idmlAnchor).toBeTypeOf("object");

        insertIdmlClipboardText(
            quill,
            "X\r\nY",
            { index: 1, length: 0 },
            idmlAnchor as Record<string, string>
        );

        expect(
            validateAndCanonicalizeIdmlHtml(quill.root.innerHTML, contract)
        ).toBe(
            '<p data-idml-version="2"><span data-idml-slot="0" data-idml-character-style="style" data-idml-protected="slot">AX<br>YB</span></p>'
        );
    });

    it("undo restores the pristine empty slot without losing its anchor", () => {
        const target =
            '<p data-idml-version="2"><span data-idml-slot="0" data-idml-character-style="style" data-idml-protected="slot"></span></p>';
        const quill = loadIdmlHtml(target);
        const idmlAnchor = quill.getFormat(0, 0).idmlAnchor;
        quill.history.cutoff();
        quill.insertText(0, "A", { idmlAnchor }, "user");
        quill.history.cutoff();

        quill.history.undo();

        expect(
            validateAndCanonicalizeIdmlHtml(quill.root.innerHTML, contract)
        ).toBe(target);
        expect(
            quill.root.querySelectorAll('[data-idml-protected="slot"]')
        ).toHaveLength(1);
    });

    it("never round-trips arbitrary data-idml attributes", () => {
        const node = IdmlAnchorFormat.create({
            "data-idml-protected": "slot",
            "data-idml-slot": "0",
            "data-idml-character-style": "style",
            "data-idml-script": "alert(1)",
        });

        expect(node.getAttribute("data-idml-slot")).toBe("0");
        expect(node.hasAttribute("data-idml-script")).toBe(false);
    });
});
