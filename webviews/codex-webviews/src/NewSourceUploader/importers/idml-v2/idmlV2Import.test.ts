import { describe, expect, it } from "vitest";
import type { IdmlParseResult } from "@aquilla/idml-roundtrip";
import { createIdmlV2Cells } from "./idmlV2Import";

const sourceHtml =
    '<p data-idml-version="2"><span data-idml-slot="0" data-idml-character-style="style" data-idml-protected="slot">Hello</span></p>';
const metadata = {
    version: 2 as const,
    slotCount: 1,
    editableSlotIndexes: [0],
    protectedTokenCount: 0,
    anchorSequenceHash:
        "766aa2a87159f27180547d4dafd88d46cfb4a351e497cc942fb2688a37af76e9",
};
const locator = {
    kind: "idml" as const,
    memberPath: "Stories/Story_u1.xml",
    storyId: "u1",
    elementPath: "/Story[1]/ParagraphStyleRange[1]",
    scope: "story-paragraph" as const,
    part: 0,
    slotIndexes: [0],
    sourceBlockHash: "a".repeat(64),
};
const result: IdmlParseResult = {
    units: [
        {
            id: "idml-u1-p0",
            order: 0,
            sourceText: "Hello",
            sourceHtml,
            locator,
            metadata,
            slots: [
                {
                    index: 0,
                    text: "Hello",
                    characterStyleId: "style",
                    editable: true,
                },
            ],
            protectedTokens: [],
            diagnostics: [],
        },
    ],
    manifest: {
        version: 2,
        sourceSha256: "b".repeat(64),
        profile: "generic",
        members: [],
        unitLocators: [locator],
        diagnostics: [],
    },
    diagnostics: [],
};

describe("Codex IDML v2 producer contract", () => {
    it("emits one anchored cell per engine unit with the exact locator", () => {
        const { sourceCells, targetCells } = createIdmlV2Cells(result);

        expect(sourceCells).toHaveLength(1);
        expect(targetCells).toHaveLength(1);
        expect(sourceCells[0]?.content).toBe(sourceHtml);
        expect(targetCells[0]?.content).toContain('data-idml-slot="0"');
        expect(targetCells[0]?.content).not.toContain(">Hello<");
        expect(targetCells[0]?.metadata.idml).toEqual(metadata);
        expect(targetCells[0]?.metadata.idmlLocator).toEqual(locator);
        expect(targetCells[0]?.metadata.idmlSourceHtml).toBe(sourceHtml);
    });
});
