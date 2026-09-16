import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import sinon from "sinon";
import { getCharacterAudioPreview } from "../../../exportHandler/characterAudioExporter";

import * as assert from "assert";
import { normalizeCharacterLabel } from "../../../exportHandler/characterGrouping";

suite("Character audio export grouping", () => {
    test("combines all default camera markers case-insensitively", () => {
        for (const suffix of ["(ON)", "(Off)", "(Mixed)", "(Group)", "(oFf)"]) {
            assert.strictEqual(normalizeCharacterLabel(`Alex ${suffix}`), "Alex");
        }
    });
    test("matches marker case only when requested", () => {
        const options = { matchCharacterMarkerCase: true, ignoredCharacterSuffixes: ["(ON)"] };
        assert.strictEqual(normalizeCharacterLabel("Alex (ON)", options), "Alex");
        assert.strictEqual(normalizeCharacterLabel("Alex (on)", options), "Alex (on)");
        assert.strictEqual(normalizeCharacterLabel("Alex (On)", options), "Alex (On)");
        assert.strictEqual(normalizeCharacterLabel("Alex (on)", { ...options, matchCharacterMarkerCase: false }), "Alex");
        assert.strictEqual(normalizeCharacterLabel("Alex (ON)", { ...options, separateByCameraAngles: true }), "Alex (ON)");
    });
    test("preserves full labels when separating camera angles", () => {
        assert.strictEqual(normalizeCharacterLabel("Alex (ON)", { separateByCameraAngles: true }), "Alex (ON)");
    });
    test("supports custom literal suffixes and removal of defaults", () => {
        const options = { ignoredCharacterSuffixes: ["[VO]", "(.*)", ""] };
        assert.strictEqual(normalizeCharacterLabel("Alex [vo]", options), "Alex");
        assert.strictEqual(normalizeCharacterLabel("Alex (.*)", options), "Alex");
        assert.strictEqual(normalizeCharacterLabel("Alex (ON)", options), "Alex (ON)");
        assert.strictEqual(normalizeCharacterLabel("Alex (Off)", { ignoredCharacterSuffixes: [] }), "Alex (Off)");
    });
    test("strips repeated suffixes and surrounding whitespace", () => {
        assert.strictEqual(normalizeCharacterLabel("  Alex (ON) (Group)  "), "Alex");
    });
    test("preserves unconfigured parentheses and non-trailing text", () => {
        for (const label of ["Alex (young)", "Alex (ON) Jr", "Gordon", "Alex (ONE)"]) {
            assert.strictEqual(normalizeCharacterLabel(label), label);
        }
    });
    test("handles empty names and longest overlapping suffixes", () => {
        assert.strictEqual(normalizeCharacterLabel(undefined), "unlabeled");
        assert.strictEqual(normalizeCharacterLabel(" (ON) "), "unlabeled");
        assert.strictEqual(normalizeCharacterLabel("Alex (ON)", { ignoredCharacterSuffixes: ["ON)", "(ON)"] }), "Alex");
    });
});


suite("Character audio preview grouping", () => {
    test("uses export options without changing stored labels", async () => {
        const sandbox = sinon.createSandbox();
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), "character-preview-"));
        const file = path.join(directory, "episode.codex");
        const notebook = JSON.stringify({ cells: ["(ON)", "(Off)", "(Mixed)", "(Group)"].map((marker, index) => ({
            kind: 2, value: "Line", metadata: {
                id: `cell-${index}`, cellLabel: `Alex ${marker}`, edits: [],
                data: { startTime: index, endTime: index + 1 },
                selectedAudioId: "take",
                attachments: { take: { type: "audio", url: "recording.wav", isDeleted: false } },
            },
        })) });
        try {
            await fs.writeFile(file, notebook);
            sandbox.stub(vscode.workspace, "workspaceFolders").value([
                { uri: vscode.Uri.file(directory), name: "test", index: 0 },
            ]);
            const combined = await getCharacterAudioPreview([file]);
            assert.strictEqual(combined.files[0].characters.length, 1);
            assert.strictEqual(combined.files[0].characters[0].label, "Alex");
            assert.strictEqual(combined.files[0].characters[0].audioCellCount, 4);
            for (const options of [{ separateByCameraAngles: true }, { ignoredCharacterSuffixes: [] }]) {
                const separate = await getCharacterAudioPreview([file], options);
                assert.strictEqual(separate.files[0].characters.length, 4);
            }
            const custom = await getCharacterAudioPreview([file], { ignoredCharacterSuffixes: ["(ON)", "(Off)"] });
            assert.strictEqual(custom.files[0].characters.length, 3);
            const lowerMarkers = ["(on)", "(off)", "(mixed)", "(group)"];
            const insensitive = await getCharacterAudioPreview([file], { ignoredCharacterSuffixes: lowerMarkers });
            assert.strictEqual(insensitive.files[0].characters.length, 1);
            const sensitive = await getCharacterAudioPreview([file], {
                ignoredCharacterSuffixes: lowerMarkers, matchCharacterMarkerCase: true,
            });
            assert.strictEqual(sensitive.files[0].characters.length, 4);
            assert.strictEqual(await fs.readFile(file, "utf8"), notebook);
        } finally {
            sandbox.restore();
            await fs.rm(directory, { recursive: true, force: true });
        }
    });
});
