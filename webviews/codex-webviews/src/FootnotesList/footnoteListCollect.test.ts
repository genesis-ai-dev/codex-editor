import { describe, expect, it } from "vitest";
import { collectMilestonesWithFootnotes } from "../../../../sharedUtils/footnoteListCollect";

const note = (text: string) =>
    `<p>Text<sup class="footnote-marker" data-footnote="${text}">1</sup></p>`;

describe("collectMilestonesWithFootnotes", () => {
    it("groups notes by milestone and skips milestones with none", () => {
        const milestones = collectMilestonesWithFootnotes([
            { value: "Genesis 1", metadata: { id: "m1", type: "milestone" } },
            { value: "<p>No note</p>", metadata: { id: "GEN 1:1", type: "text" } },
            { value: "Genesis 2", metadata: { id: "m2", type: "milestone" } },
            {
                value: note("A note"),
                metadata: { id: "GEN 2:12", type: "text" },
            },
            {
                value: `<p>Two<sup class="footnote-marker" data-footnote="First">1</sup><sup class="footnote-marker" data-footnote="&lt;b&gt;Second&lt;/b&gt;">2</sup></p>`,
                metadata: { id: "GEN 2:13", type: "text" },
            },
            { value: "Genesis 3", metadata: { id: "m3", type: "milestone" } },
            { value: "Genesis 4", metadata: { id: "m4", type: "milestone" } },
            {
                value: note("Later"),
                metadata: { id: "GEN 4:11", type: "text" },
            },
        ]);

        expect(milestones.map((group) => group.label)).toEqual(["Genesis 2", "Genesis 4"]);
        expect(milestones[0].notes.map((entry) => entry.verseNumber)).toEqual(["12", "13", "13"]);
        expect(milestones[0].notes.map((entry) => entry.content)).toEqual([
            "A note",
            "First",
            "<b>Second</b>",
        ]);
        expect(milestones[1].notes[0]).toMatchObject({
            cellId: "GEN 4:11",
            verseNumber: "11",
            content: "Later",
        });
    });

    it("returns nothing when the file has no footnotes", () => {
        expect(
            collectMilestonesWithFootnotes([
                { value: "Genesis 1", metadata: { id: "m1", type: "milestone" } },
                { value: "<p>Plain</p>", metadata: { id: "GEN 1:1", type: "text" } },
            ])
        ).toEqual([]);
    });
});
