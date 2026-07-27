import * as assert from "assert";
import JSZip from "jszip";
import {
    parseIdml,
    renderIdmlUnitHtml,
} from "@aquilla/idml-roundtrip";
import type {
    IdmlSourceManifest,
    IdmlTranslationUnit,
} from "@aquilla/idml-roundtrip";
import { updatedIdmlTranslatedSlotIndexes } from "../../idml/idmlCellGuard";
import { exportCodexIdmlV2 } from "../../idml/idmlV2NodeAdapter";
import { CodexCellTypes } from "../../../types/enums";

const STORY_PATH = "Stories/Story_u1.xml";
const STORY_XML =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<idPkg:Story xmlns:idPkg="urn:adobe:ns:indesign/idml/1.0/packaging">' +
    '<Story Self="u1">' +
    '<ParagraphStyleRange Self="p1">' +
    '<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/Bold">' +
    "<Content><?ACE 3?>One</Content><Content>Two</Content>" +
    "</CharacterStyleRange>" +
    "</ParagraphStyleRange>" +
    '<ParagraphStyleRange Self="p2">' +
    '<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/Body">' +
    "<Content>Three</Content>" +
    "</CharacterStyleRange>" +
    "</ParagraphStyleRange>" +
    "</Story>" +
    "</idPkg:Story>";

async function makeFixture(): Promise<Uint8Array> {
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
            '<idPkg:DesignMap xmlns:idPkg="urn:adobe:ns:indesign/idml/1.0/packaging">' +
            `<idPkg:Story src="${STORY_PATH}"/>` +
            "</idPkg:DesignMap>",
        { compression: "DEFLATE", createFolders: false, date }
    );
    zip.file(STORY_PATH, STORY_XML, {
        compression: "DEFLATE",
        createFolders: false,
        date,
    });
    return zip.generateAsync({
        type: "uint8array",
        compression: "DEFLATE",
        platform: "UNIX",
        streamFiles: false,
    });
}

function emptyTarget(unit: IdmlTranslationUnit): string {
    return renderIdmlUnitHtml({
        ...unit,
        sourceText: "",
        slots: unit.slots.map((slot) => ({
            ...slot,
            text: slot.editable ? "" : slot.text,
        })),
    });
}

function cellFor(
    unit: IdmlTranslationUnit,
    options: {
        targetHtml?: string;
        translatedSlotIndexes?: number[];
    } = {}
) {
    const translatedSlotIndexes = options.translatedSlotIndexes ?? [];
    return {
        value: options.targetHtml ?? emptyTarget(unit),
        metadata: {
            id: unit.id,
            type: CodexCellTypes.TEXT,
            edits: [],
            idml: unit.metadata,
            idmlLocator: unit.locator,
            idmlSourceHtml: unit.sourceHtml,
            idmlTranslationState:
                translatedSlotIndexes.length > 0
                    ? ("translated" as const)
                    : ("untranslated" as const),
            idmlTranslatedSlotIndexes: translatedSlotIndexes,
        },
    };
}

async function storyXml(bytes: Uint8Array): Promise<string> {
    const zip = await JSZip.loadAsync(bytes);
    const member = zip.file(STORY_PATH);
    assert.ok(member, "exported IDML should retain the story member");
    return member.async("string");
}

suite("IDML v2 Codex export adapter", () => {
    let originalBytes: Uint8Array;
    let units: readonly IdmlTranslationUnit[];
    let manifest: IdmlSourceManifest;

    setup(async () => {
        originalBytes = await makeFixture();
        const parsed = await parseIdml(originalBytes, "generic");
        units = parsed.units;
        manifest = parsed.manifest;
        assert.strictEqual(units.length, 2);
        assert.strictEqual(units[0].slots[0].editable, true);
        assert.ok(
            units[0].protectedTokens.some(
                (token) =>
                    token.kind === "unknown" &&
                    token.xmlName === "?ACE" &&
                    token.position === 0
            )
        );
    });

    test("untouched empty targets export the original package byte-for-byte", async () => {
        const result = await exportCodexIdmlV2(
            originalBytes,
            units.map((unit) => cellFor(unit)),
            manifest
        );

        assert.deepStrictEqual(
            Buffer.from(result.bytes),
            Buffer.from(originalBytes)
        );
        assert.strictEqual(result.report.translated, 0);
        assert.deepStrictEqual(result.report.changedMemberPaths, []);
    });

    test("undoing a translation to the pristine empty target restores byte-identical export", async () => {
        const first = units[0];
        const pristineTarget = emptyTarget(first);
        const translatedTarget = renderIdmlUnitHtml({
            ...first,
            sourceText: "Uno",
            slots: first.slots.map((slot, index) => ({
                ...slot,
                text: index === 0 ? "Uno" : "",
            })),
        });
        const metadata = {
            idml: first.metadata,
            idmlSourceHtml: first.sourceHtml,
            idmlTranslatedSlotIndexes: [] as number[],
        };
        const translatedSlotIndexes = updatedIdmlTranslatedSlotIndexes(
            metadata,
            pristineTarget,
            translatedTarget
        );
        assert.deepStrictEqual(translatedSlotIndexes, [
            first.locator.slotIndexes[0],
        ]);

        const restoredSlotIndexes = updatedIdmlTranslatedSlotIndexes(
            {
                ...metadata,
                idmlTranslatedSlotIndexes: translatedSlotIndexes,
            },
            translatedTarget,
            pristineTarget,
            false,
            []
        );
        assert.deepStrictEqual(restoredSlotIndexes, []);

        const result = await exportCodexIdmlV2(
            originalBytes,
            [
                cellFor(first, {
                    targetHtml: pristineTarget,
                    translatedSlotIndexes: restoredSlotIndexes,
                }),
                cellFor(units[1]),
            ],
            manifest
        );

        assert.deepStrictEqual(
            Buffer.from(result.bytes),
            Buffer.from(originalBytes)
        );
        assert.strictEqual(result.report.translated, 0);
        assert.deepStrictEqual(result.report.changedMemberPaths, []);
    });

    test("partial translation changes only explicitly translated slots", async () => {
        const first = units[0];
        const translatedHtml = renderIdmlUnitHtml({
            ...first,
            sourceText: "Uno",
            slots: first.slots.map((slot, index) => ({
                ...slot,
                text: index === 0 ? "Uno" : "",
            })),
        });
        const result = await exportCodexIdmlV2(
            originalBytes,
            [
                cellFor(first, {
                    targetHtml: translatedHtml,
                    translatedSlotIndexes: [first.locator.slotIndexes[0]],
                }),
                cellFor(units[1]),
            ],
            manifest
        );
        const xml = await storyXml(result.bytes);

        assert.ok(xml.includes("<Content><?ACE 3?>Uno</Content>"));
        assert.ok(xml.includes("<Content>Two</Content>"));
        assert.ok(xml.includes("<Content>Three</Content>"));
        assert.strictEqual(result.report.translated, 1);
    });

    test("an explicitly translated empty slot clears only that slot", async () => {
        const first = units[0];
        const clearedHtml = renderIdmlUnitHtml({
            ...first,
            sourceText: "",
            slots: first.slots.map((slot) => ({ ...slot, text: "" })),
        });
        const result = await exportCodexIdmlV2(
            originalBytes,
            [
                cellFor(first, {
                    targetHtml: clearedHtml,
                    translatedSlotIndexes: [first.locator.slotIndexes[0]],
                }),
                cellFor(units[1]),
            ],
            manifest
        );
        const xml = await storyXml(result.bytes);

        assert.ok(
            xml.includes(
                "<Content><?ACE 3?></Content><Content>Two</Content>"
            )
        );
        assert.ok(xml.includes("<Content>Three</Content>"));
    });
});
