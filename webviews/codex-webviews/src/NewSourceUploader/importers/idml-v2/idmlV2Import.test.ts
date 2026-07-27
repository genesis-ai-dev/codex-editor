import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
    parseIdml,
    type IdmlParseResult,
} from "@aquilla/idml-roundtrip";
import {
    createIdmlV2Cells,
    createIdmlV2NotebookPair,
} from "./idmlV2Import";

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
        expect(sourceCells[0]!.content).toBe(sourceHtml);
        expect(targetCells[0]!.content).toContain('data-idml-slot="0"');
        expect(targetCells[0]!.content).not.toContain(">Hello<");
        expect(targetCells[0]!.metadata!.idml).toEqual(metadata);
        expect(targetCells[0]!.metadata!.idmlLocator).toEqual(locator);
        expect(targetCells[0]!.metadata!.idmlSourceHtml).toBe(sourceHtml);
        expect(targetCells[0]!.metadata!.idmlTranslationState).toBe(
            "untranslated"
        );
        expect(targetCells[0]!.metadata!.idmlTranslatedSlotIndexes).toEqual([]);
    });

    it("passes importer cancellation through to the worker boundary", async () => {
        const controller = new AbortController();
        const parse = async (
            _bytes: ArrayBuffer,
            _profile: "generic" | "biblica",
            options?: { signal?: AbortSignal }
        ) => {
            expect(options?.signal).toBe(controller.signal);
            return result;
        };

        await createIdmlV2NotebookPair(
            {
                name: "sample.idml",
                arrayBuffer: async () => new Uint8Array([0x50, 0x4b]).buffer,
            } as File,
            "generic",
            () => {},
            parse as never,
            controller.signal
        );
    });

    it("carries real processing-instruction anchors through import and keeps their text editable", async () => {
        const zip = new JSZip();
        const date = new Date("2024-01-01T00:00:00.000Z");
        zip.file(
            "mimetype",
            "application/vnd.adobe.indesign-idml-package",
            { compression: "STORE", createFolders: false, date }
        );
        zip.file(
            "designmap.xml",
            '<?xml version="1.0" encoding="UTF-8"?>' +
                '<idPkg:DesignMap xmlns:idPkg="urn:test">' +
                '<idPkg:Story src="Stories/Story_u1.xml"/>' +
                "</idPkg:DesignMap>",
            { compression: "DEFLATE", createFolders: false, date }
        );
        zip.file(
            "Stories/Story_u1.xml",
            '<?xml version="1.0" encoding="UTF-8"?>' +
                '<idPkg:Story xmlns:idPkg="urn:test"><Story Self="u1">' +
                '<ParagraphStyleRange Self="p1"><CharacterStyleRange>' +
                "<Content><?ACE 3?>Literal text</Content>" +
                "</CharacterStyleRange></ParagraphStyleRange>" +
                "</Story></idPkg:Story>",
            { compression: "DEFLATE", createFolders: false, date }
        );
        const bytes = await zip.generateAsync({
            type: "uint8array",
            compression: "DEFLATE",
            platform: "UNIX",
            streamFiles: false,
        });
        const pair = await createIdmlV2NotebookPair(
            {
                name: "processing-instruction.idml",
                arrayBuffer: async () =>
                    bytes.buffer.slice(
                        bytes.byteOffset,
                        bytes.byteOffset + bytes.byteLength
                    ),
            } as File,
            "generic",
            () => {},
            async (input, profile, options) =>
                parseIdml(input, profile, options)
        );

        expect(pair.source.cells).toHaveLength(1);
        expect(pair.codex.cells).toHaveLength(1);
        expect(pair.source.cells[0]!.content).toContain(">Literal text</span>");
        expect(pair.source.cells[0]!.content).toContain(
            'data-idml-token-kind="unknown"'
        );
        expect(pair.source.cells[0]!.metadata!.idml).toMatchObject({
            editableSlotIndexes: [0],
            protectedTokenCount: 1,
        });
        expect(pair.codex.cells[0]!.content).not.toContain("Literal text");
        expect(pair.source.metadata.originalFileData).toBeInstanceOf(
            ArrayBuffer
        );
    });

});
