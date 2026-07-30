import * as assert from "assert";
import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";
import { CodexContentSerializer } from "../../serializer";
import { recoverMergedChildrenForFile } from "../../projectManager/utils/recoveryUtils";
import { CodexCellTypes } from "../../../types/enums";

async function createTempNotebookFile(
    ext: ".codex" | ".source",
    cells: Array<{ kind?: number; languageId?: string; value: string; metadata: any; }>
): Promise<vscode.Uri> {
    const serializer = new CodexContentSerializer();
    const tmpDir = os.tmpdir();
    const fileName = `recover-merged-children-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}${ext}`;
    const uri = vscode.Uri.file(path.join(tmpDir, fileName));

    const notebook: any = {
        cells: cells.map((cell) => ({
            kind: cell.kind ?? 2,
            languageId: cell.languageId ?? "scripture",
            value: cell.value,
            metadata: cell.metadata,
        })),
        metadata: {},
    };

    const bytes = await serializer.serializeNotebook(
        notebook,
        new vscode.CancellationTokenSource().token
    );
    await vscode.workspace.fs.writeFile(uri, bytes);
    return uri;
}

async function readNotebookFile(uri: vscode.Uri): Promise<any> {
    const fileBytes = await vscode.workspace.fs.readFile(uri);
    const serializer = new CodexContentSerializer();
    return await serializer.deserializeNotebook(
        fileBytes,
        new vscode.CancellationTokenSource().token
    );
}

async function readFileBytes(uri: vscode.Uri): Promise<Uint8Array> {
    return await vscode.workspace.fs.readFile(uri);
}

function ref(refString: string) {
    return { data: { globalReferences: [refString] } };
}

function softDeletedChildMetadata(
    id: string,
    parentId: string,
    refString: string
): any {
    return {
        id,
        type: CodexCellTypes.TEXT,
        parentId,
        ...ref(refString),
        data: {
            globalReferences: [refString],
            deleted: true,
        },
        edits: [
            {
                editMap: ["metadata", "data", "deleted"],
                value: true,
                timestamp: 1,
                type: "migration",
                author: "system",
                validatedBy: [],
            },
        ],
    };
}

suite("recoverMergedChildrenForFile", () => {
    let testFiles: vscode.Uri[] = [];

    teardown(async () => {
        for (const uri of testFiles) {
            try {
                await vscode.workspace.fs.delete(uri);
            } catch {
                // ignore
            }
        }
        testFiles = [];
    });

    test("recovers a soft-deleted verse-24 child whose content was dropped from the parent (Genesis 5:21-24)", async () => {
        const milestoneId = randomUUID();
        const parentId = "f734589b-0c75-2ef3-01d5-e5f9fbb1b812";
        const verse22Id = randomUUID();
        const verse23Id = randomUUID();
        const verse24Id = "5a7cf97b-656d-f8bb-f4b9-4cf23ac328a1";

        const verse22Value = "Después de tener a Matusalén, Enoc vivió 300 años más.";
        const verse23Value = "Enoc vivió 365 años en total.";
        const verse24Value =
            "Vivía como Dios quería. Después, desapareció, porque Dios se lo llevó sin que muriera.";

        // Parent value contains verse-22 and verse-23 text (post-merge), but the
        // verse-24 content was lost by the resolver tie-break bug.
        const parentValue = `${verse22Value}${verse23Value}`;

        const uri = await createTempNotebookFile(".codex", [
            {
                value: "Genesis 5",
                languageId: "html",
                metadata: { id: milestoneId, type: CodexCellTypes.MILESTONE, edits: [] },
            },
            {
                value: parentValue,
                metadata: {
                    id: parentId,
                    type: CodexCellTypes.TEXT,
                    ...ref("GEN 5:21-24"),
                    edits: [],
                },
            },
            {
                value: verse22Value,
                metadata: softDeletedChildMetadata(verse22Id, parentId, "GEN 5:21-24"),
            },
            {
                value: verse23Value,
                metadata: softDeletedChildMetadata(verse23Id, parentId, "GEN 5:21-24"),
            },
            {
                value: verse24Value,
                metadata: softDeletedChildMetadata(verse24Id, parentId, "GEN 5:21-24"),
            },
        ]);
        testFiles.push(uri);

        const report = await recoverMergedChildrenForFile(uri);
        assert.strictEqual(report.changed, true, "Helper should report a change");
        assert.strictEqual(
            report.parentsRecovered,
            1,
            "Should recover exactly one parent"
        );
        assert.strictEqual(
            report.perParent[0].parentId,
            parentId,
            "Reported parent id should match the affected parent"
        );
        assert.deepStrictEqual(
            report.perParent[0].appendedChildIds,
            [verse24Id],
            "Only the verse-24 child should have been appended"
        );

        const data = await readNotebookFile(uri);
        const parent = data.cells.find((c: any) => c.metadata?.id === parentId);
        assert.ok(parent, "Parent cell should still be present");

        assert.ok(
            parent.value.endsWith(verse24Value),
            `Parent value should end with the verse-24 content. Got: ${parent.value}`
        );
        assert.strictEqual(
            parent.value,
            `${parentValue}${verse24Value}`,
            "Parent value should be the original value with verse-24 appended"
        );

        assert.deepStrictEqual(
            parent.metadata?.data?.mergedChildIds,
            [verse22Id, verse23Id, verse24Id],
            "mergedChildIds should list all three soft-deleted children in document order"
        );

        assert.strictEqual(
            parent.metadata?.cellLabel,
            "21-24",
            "cellLabel should be derived from the parsed verse range"
        );

        const parentEdits: any[] = parent.metadata?.edits || [];
        const valueEdits = parentEdits.filter(
            (e) => e.editMap?.join(".") === "value"
        );
        const trackingEdits = parentEdits.filter(
            (e) => e.editMap?.join(".") === "metadata.data.mergedChildIds"
        );
        const labelEdits = parentEdits.filter(
            (e) => e.editMap?.join(".") === "metadata.cellLabel"
        );

        assert.strictEqual(valueEdits.length, 1, "Should append exactly one value edit");
        assert.strictEqual(
            trackingEdits.length,
            1,
            "Should append exactly one mergedChildIds edit"
        );
        assert.strictEqual(
            labelEdits.length,
            1,
            "Should append exactly one cellLabel edit"
        );

        assert.strictEqual(valueEdits[0].type, "migration");
        assert.strictEqual(trackingEdits[0].type, "migration");
        assert.strictEqual(labelEdits[0].type, "migration");

        assert.strictEqual(valueEdits[0].author, "system");
        assert.deepStrictEqual(valueEdits[0].validatedBy, []);

        assert.ok(
            valueEdits[0].timestamp < trackingEdits[0].timestamp,
            "value edit should precede mergedChildIds edit"
        );
        assert.ok(
            trackingEdits[0].timestamp < labelEdits[0].timestamp,
            "mergedChildIds edit should precede cellLabel edit"
        );

        assert.deepStrictEqual(
            trackingEdits[0].value,
            [verse22Id, verse23Id, verse24Id]
        );
        assert.strictEqual(labelEdits[0].value, "21-24");
    });

    test("re-running the recovery is a no-op (idempotent)", async () => {
        const milestoneId = randomUUID();
        const parentId = randomUUID();
        const childId = randomUUID();
        const childValue = "<span>Once-lost child content.</span>";
        const parentBaseValue = "<span>Parent base content.</span>";

        const uri = await createTempNotebookFile(".codex", [
            {
                value: "Genesis 5",
                languageId: "html",
                metadata: { id: milestoneId, type: CodexCellTypes.MILESTONE, edits: [] },
            },
            {
                value: parentBaseValue,
                metadata: {
                    id: parentId,
                    type: CodexCellTypes.TEXT,
                    ...ref("GEN 5:1-2"),
                    edits: [],
                },
            },
            {
                value: childValue,
                metadata: softDeletedChildMetadata(childId, parentId, "GEN 5:1-2"),
            },
        ]);
        testFiles.push(uri);

        const first = await recoverMergedChildrenForFile(uri);
        assert.strictEqual(first.changed, true, "First run should report changes");

        const after1 = await readNotebookFile(uri);
        const parent1 = after1.cells.find((c: any) => c.metadata?.id === parentId);
        const editCountAfterFirst = (parent1.metadata?.edits || []).length;

        const second = await recoverMergedChildrenForFile(uri);
        assert.strictEqual(
            second.changed,
            false,
            "Second run must report no changes"
        );
        assert.strictEqual(second.parentsRecovered, 0);

        const after2 = await readNotebookFile(uri);
        const parent2 = after2.cells.find((c: any) => c.metadata?.id === parentId);
        const editCountAfterSecond = (parent2.metadata?.edits || []).length;

        assert.strictEqual(
            editCountAfterSecond,
            editCountAfterFirst,
            "Second run must not append any edits"
        );
        assert.strictEqual(
            parent2.value,
            `${parentBaseValue}${childValue}`,
            "Parent value must remain stable across the second run"
        );
    });

    test("does nothing when parent.value already contains every soft-deleted child's value", async () => {
        const milestoneId = randomUUID();
        const parentId = randomUUID();
        const childAId = randomUUID();
        const childBId = randomUUID();
        const childAValue = "<span>Child A text.</span>";
        const childBValue = "<span>Child B text.</span>";
        const fullParentValue = `<span>Parent intro.</span>${childAValue}${childBValue}`;

        const uri = await createTempNotebookFile(".codex", [
            {
                value: "Genesis 5",
                languageId: "html",
                metadata: { id: milestoneId, type: CodexCellTypes.MILESTONE, edits: [] },
            },
            {
                value: fullParentValue,
                metadata: {
                    id: parentId,
                    type: CodexCellTypes.TEXT,
                    cellLabel: "1-3",
                    ...ref("GEN 5:1-3"),
                    data: {
                        globalReferences: ["GEN 5:1-3"],
                        mergedChildIds: [childAId, childBId],
                    },
                    edits: [],
                },
            },
            {
                value: childAValue,
                metadata: softDeletedChildMetadata(childAId, parentId, "GEN 5:1-3"),
            },
            {
                value: childBValue,
                metadata: softDeletedChildMetadata(childBId, parentId, "GEN 5:1-3"),
            },
        ]);
        testFiles.push(uri);

        const beforeBytes = await readFileBytes(uri);
        const report = await recoverMergedChildrenForFile(uri);

        assert.strictEqual(
            report.changed,
            false,
            "Helper should not report a change when no content is missing"
        );
        assert.strictEqual(report.parentsRecovered, 0);

        const afterBytes = await readFileBytes(uri);
        assert.deepStrictEqual(
            Buffer.from(afterBytes),
            Buffer.from(beforeBytes),
            "File bytes should be unchanged when no recovery is needed"
        );

        const data = await readNotebookFile(uri);
        const parent = data.cells.find((c: any) => c.metadata?.id === parentId);
        const valueEdits = (parent.metadata?.edits || []).filter(
            (e: any) => e.editMap?.join(".") === "value"
        );
        assert.strictEqual(
            valueEdits.length,
            0,
            "No value edits should have been appended"
        );
    });

    test("does nothing when parent has no soft-deleted children pointing at it", async () => {
        const milestoneId = randomUUID();
        const parentId = randomUUID();
        const liveChildId = randomUUID();

        const uri = await createTempNotebookFile(".codex", [
            {
                value: "Genesis 5",
                languageId: "html",
                metadata: { id: milestoneId, type: CodexCellTypes.MILESTONE, edits: [] },
            },
            {
                value: "<span>Parent value.</span>",
                metadata: {
                    id: parentId,
                    type: CodexCellTypes.TEXT,
                    cellLabel: "5",
                    ...ref("GEN 5:5"),
                    edits: [],
                },
            },
            {
                value: "<span>Live child sentence.</span>",
                metadata: {
                    id: liveChildId,
                    type: CodexCellTypes.TEXT,
                    parentId,
                    ...ref("GEN 5:5"),
                    edits: [],
                },
            },
        ]);
        testFiles.push(uri);

        const beforeBytes = await readFileBytes(uri);
        const report = await recoverMergedChildrenForFile(uri);

        assert.strictEqual(
            report.changed,
            false,
            "Helper should not report a change when no soft-deleted children exist"
        );
        assert.strictEqual(report.parentsRecovered, 0);

        const afterBytes = await readFileBytes(uri);
        assert.deepStrictEqual(
            Buffer.from(afterBytes),
            Buffer.from(beforeBytes),
            "File bytes should be unchanged when no recovery is needed"
        );

        const data = await readNotebookFile(uri);
        const parent = data.cells.find((c: any) => c.metadata?.id === parentId);
        const parentEdits = parent.metadata?.edits || [];
        assert.strictEqual(
            parentEdits.length,
            0,
            "No edits should be appended to parent"
        );
    });

    test("does not re-append a child whose only difference is escaped vs un-escaped HTML inside data-footnote", async () => {
        // Real-world shape from a Genesis 5:28-31 case: the parent stores the
        // <sup data-footnote="..."> attribute with HTML entities (&lt;/&gt;),
        // while the soft-deleted child stores the same footnote with literal
        // <p>/<em> tags. Without stripping attributes before tags, the
        // tag-stripping regex stopped at the first `>` inside data-footnote
        // for the child, leaking the footnote markup into the normalized
        // string. The substring check then failed and the child got re-
        // appended even though its verse text was already in the parent.
        const milestoneId = randomUUID();
        const parentId = randomUUID();
        const childId = randomUUID();

        const escapedFootnote =
            '<sup data-footnote="&lt;p&gt;&lt;em&gt;Noé: &lt;/em&gt;En hebreo, descanso o consuelo.&lt;/p&gt;" class="footnote-marker">1</sup>';
        const rawFootnote =
            '<sup data-footnote="<p><em>Noé: </em>En hebreo, descanso o consuelo.</p>" class="footnote-marker">1</sup>';

        const verseText =
            "Lamec lo llamó Noé porque dijo: «Él nos aliviará del duro trabajo que significa labrar la tierra que Dios maldijo».";
        const parentValue = `<p>${verseText.replace("Noé porque", `Noé${escapedFootnote} porque`)}</p>`;
        const childValue = `<p>${verseText.replace("Noé porque", `Noé${rawFootnote} porque`)}</p>`;

        const uri = await createTempNotebookFile(".codex", [
            {
                value: "Genesis 5",
                languageId: "html",
                metadata: { id: milestoneId, type: CodexCellTypes.MILESTONE, edits: [] },
            },
            {
                value: parentValue,
                metadata: {
                    id: parentId,
                    type: CodexCellTypes.TEXT,
                    cellLabel: "29",
                    ...ref("GEN 5:29"),
                    data: {
                        globalReferences: ["GEN 5:29"],
                        mergedChildIds: [childId],
                    },
                    edits: [],
                },
            },
            {
                value: childValue,
                metadata: softDeletedChildMetadata(childId, parentId, "GEN 5:29"),
            },
        ]);
        testFiles.push(uri);

        const beforeBytes = await readFileBytes(uri);
        const report = await recoverMergedChildrenForFile(uri);

        assert.strictEqual(
            report.changed,
            false,
            "Child whose only difference is attribute escaping should not be treated as missing"
        );
        assert.strictEqual(report.parentsRecovered, 0);

        const afterBytes = await readFileBytes(uri);
        assert.deepStrictEqual(
            Buffer.from(afterBytes),
            Buffer.from(beforeBytes),
            "File bytes must be unchanged when content is already present (modulo attribute escaping)"
        );

        const data = await readNotebookFile(uri);
        const parent = data.cells.find((c: any) => c.metadata?.id === parentId);
        const valueEdits = (parent.metadata?.edits || []).filter(
            (e: any) => e.editMap?.join(".") === "value"
        );
        assert.strictEqual(
            valueEdits.length,
            0,
            "No value edits should have been appended"
        );
    });

    test("does not re-append a child whose only difference is a single inserted word in the parent (v29-style)", async () => {
        // Real-world shape: Gretchen edited the parent so it reads "porque se
        // dijo" while the soft-deleted child still says "porque dijo". Strict
        // substring fails because of the inserted "se", but the child's
        // surrounding text is fully present in the parent. Token-bigram
        // overlap should recognize this and skip the re-append.
        const milestoneId = randomUUID();
        const parentId = randomUUID();
        const childId = randomUUID();

        const parentVerse =
            "Lamec lo llamó Noé porque se dijo: «Él nos aliviará del duro trabajo que significa labrar la tierra que Dios maldijo».";
        const childVerse =
            "Lamec lo llamó Noé porque dijo: «Él nos aliviará del duro trabajo que significa labrar la tierra que Dios maldijo».";

        const uri = await createTempNotebookFile(".codex", [
            {
                value: "Genesis 5",
                languageId: "html",
                metadata: { id: milestoneId, type: CodexCellTypes.MILESTONE, edits: [] },
            },
            {
                value: `<p>${parentVerse}</p>`,
                metadata: {
                    id: parentId,
                    type: CodexCellTypes.TEXT,
                    cellLabel: "29",
                    ...ref("GEN 5:29"),
                    data: {
                        globalReferences: ["GEN 5:29"],
                        mergedChildIds: [childId],
                    },
                    edits: [],
                },
            },
            {
                value: `<p>${childVerse}</p>`,
                metadata: softDeletedChildMetadata(childId, parentId, "GEN 5:29"),
            },
        ]);
        testFiles.push(uri);

        const beforeBytes = await readFileBytes(uri);
        const report = await recoverMergedChildrenForFile(uri);

        assert.strictEqual(
            report.changed,
            false,
            "Lightly-edited child should be recognized as already present"
        );
        assert.strictEqual(report.parentsRecovered, 0);

        const afterBytes = await readFileBytes(uri);
        assert.deepStrictEqual(
            Buffer.from(afterBytes),
            Buffer.from(beforeBytes),
            "File bytes must be unchanged when the child is fuzzily present"
        );

        const data = await readNotebookFile(uri);
        const parent = data.cells.find((c: any) => c.metadata?.id === parentId);
        const valueEdits = (parent.metadata?.edits || []).filter(
            (e: any) => e.editMap?.join(".") === "value"
        );
        assert.strictEqual(
            valueEdits.length,
            0,
            "No value edits should have been appended"
        );
    });

    test("does not re-append a child whose only difference is digit vs spelled-out number (v30-style)", async () => {
        // Real-world shape: parent says "Lamec vivió 595 años" while the soft-
        // deleted child still says "Lamec vivió quinientos noventa y cinco
        // años". Strict substring fails (entirely different word sequence for
        // the number), but enough of the surrounding bigrams overlap to push
        // the child above the fuzzy threshold.
        const milestoneId = randomUUID();
        const parentId = randomUUID();
        const childId = randomUUID();

        const parentVerse =
            "Después del nacimiento de Noé, Lamec vivió 595 años, tuvo hijos e hijas,";
        const childVerse =
            "Después del nacimiento de Noé, Lamec vivió quinientos noventa y cinco años, tuvo hijos e hijas,";

        const uri = await createTempNotebookFile(".codex", [
            {
                value: "Genesis 5",
                languageId: "html",
                metadata: { id: milestoneId, type: CodexCellTypes.MILESTONE, edits: [] },
            },
            {
                value: `<p>${parentVerse}</p>`,
                metadata: {
                    id: parentId,
                    type: CodexCellTypes.TEXT,
                    cellLabel: "30",
                    ...ref("GEN 5:30"),
                    data: {
                        globalReferences: ["GEN 5:30"],
                        mergedChildIds: [childId],
                    },
                    edits: [],
                },
            },
            {
                value: `<p>${childVerse}</p>`,
                metadata: softDeletedChildMetadata(childId, parentId, "GEN 5:30"),
            },
        ]);
        testFiles.push(uri);

        const beforeBytes = await readFileBytes(uri);
        const report = await recoverMergedChildrenForFile(uri);

        assert.strictEqual(
            report.changed,
            false,
            "Number-format-only difference should not trigger recovery"
        );
        assert.strictEqual(report.parentsRecovered, 0);

        const afterBytes = await readFileBytes(uri);
        assert.deepStrictEqual(
            Buffer.from(afterBytes),
            Buffer.from(beforeBytes),
            "File bytes must be unchanged when the only difference is number formatting"
        );
    });

    test("still recovers a genuinely missing child even when sibling children only fuzzy-match the parent", async () => {
        // Guards against the fuzzy check being so loose it skips legitimately
        // missing content. Parent contains paraphrased v22 + v23 (an inserted
        // "por" defeats strict substring but bigram overlap is high), and v24
        // is genuinely absent. Only v24 should be appended.
        const milestoneId = randomUUID();
        const parentId = randomUUID();
        const verse22Id = randomUUID();
        const verse23Id = randomUUID();
        const verse24Id = randomUUID();

        const childV22 =
            "Después de tener a Matusalén, Enoc vivió trescientos años más con su familia.";
        const childV23 =
            "Enoc vivió trescientos sesenta y cinco años en total con sus hijos.";
        const childV24 =
            "Vivía como Dios quería. Después, desapareció, porque Dios se lo llevó sin que muriera.";

        // Parent has paraphrased v22 / v23 (one extra word "por"), no v24.
        const parentV22 =
            "Después de tener a Matusalén, Enoc vivió por trescientos años más con su familia.";
        const parentV23 =
            "Enoc vivió por trescientos sesenta y cinco años en total con sus hijos.";
        const parentValue = `${parentV22}${parentV23}`;

        const uri = await createTempNotebookFile(".codex", [
            {
                value: "Genesis 5",
                languageId: "html",
                metadata: { id: milestoneId, type: CodexCellTypes.MILESTONE, edits: [] },
            },
            {
                value: parentValue,
                metadata: {
                    id: parentId,
                    type: CodexCellTypes.TEXT,
                    ...ref("GEN 5:21-24"),
                    edits: [],
                },
            },
            {
                value: childV22,
                metadata: softDeletedChildMetadata(verse22Id, parentId, "GEN 5:21-24"),
            },
            {
                value: childV23,
                metadata: softDeletedChildMetadata(verse23Id, parentId, "GEN 5:21-24"),
            },
            {
                value: childV24,
                metadata: softDeletedChildMetadata(verse24Id, parentId, "GEN 5:21-24"),
            },
        ]);
        testFiles.push(uri);

        const report = await recoverMergedChildrenForFile(uri);
        assert.strictEqual(report.changed, true, "Verse 24 must still be recovered");
        assert.strictEqual(report.parentsRecovered, 1);
        assert.deepStrictEqual(
            report.perParent[0].appendedChildIds,
            [verse24Id],
            "Only the genuinely-missing v24 should be appended; fuzzy-present v22/v23 must be skipped"
        );

        const data = await readNotebookFile(uri);
        const parent = data.cells.find((c: any) => c.metadata?.id === parentId);
        assert.strictEqual(
            parent.value,
            `${parentValue}${childV24}`,
            "Parent value should be the paraphrased base with only v24 appended"
        );
        assert.deepStrictEqual(
            parent.metadata?.data?.mergedChildIds,
            [verse22Id, verse23Id, verse24Id],
            "mergedChildIds tracks all soft-deleted children regardless of presence"
        );
    });

    test("falls back to re-append for very short children whose words are scattered through the parent", async () => {
        // Below MIN_FUZZY_TOKENS, the helper must NOT trust unigram-style
        // accidental overlap. Without this floor, a 4-word child whose words
        // happen to all appear in a long parent would be silently treated as
        // present and never recovered.
        const milestoneId = randomUUID();
        const parentId = randomUUID();
        const childId = randomUUID();

        const parentValue =
            "Caín fue al pueblo. Abel salió al campo. Estaba abierto el cielo. Luego volvió Caín.";
        const childValue = "fue al campo abierto";

        const uri = await createTempNotebookFile(".codex", [
            {
                value: "Genesis 4",
                languageId: "html",
                metadata: { id: milestoneId, type: CodexCellTypes.MILESTONE, edits: [] },
            },
            {
                value: parentValue,
                metadata: {
                    id: parentId,
                    type: CodexCellTypes.TEXT,
                    ...ref("GEN 4:8"),
                    edits: [],
                },
            },
            {
                value: childValue,
                metadata: softDeletedChildMetadata(childId, parentId, "GEN 4:8"),
            },
        ]);
        testFiles.push(uri);

        const report = await recoverMergedChildrenForFile(uri);
        assert.strictEqual(
            report.changed,
            true,
            "Short child below the fuzzy-token floor must be treated as missing"
        );
        assert.strictEqual(report.parentsRecovered, 1);
        assert.deepStrictEqual(
            report.perParent[0].appendedChildIds,
            [childId],
            "The short child should be appended"
        );

        const data = await readNotebookFile(uri);
        const parent = data.cells.find((c: any) => c.metadata?.id === parentId);
        assert.strictEqual(
            parent.value,
            `${parentValue}${childValue}`,
            "Parent value should end with the short child appended verbatim"
        );
    });

    test("returns changed: false and writes nothing when there are no merged cells in the file", async () => {
        const milestoneId = randomUUID();
        const id1 = randomUUID();
        const id2 = randomUUID();

        const uri = await createTempNotebookFile(".codex", [
            {
                value: "Genesis 5",
                languageId: "html",
                metadata: { id: milestoneId, type: CodexCellTypes.MILESTONE, edits: [] },
            },
            {
                value: "<span>First normal verse.</span>",
                metadata: {
                    id: id1,
                    type: CodexCellTypes.TEXT,
                    cellLabel: "1",
                    ...ref("GEN 5:1"),
                    edits: [],
                },
            },
            {
                value: "<span>Second normal verse.</span>",
                metadata: {
                    id: id2,
                    type: CodexCellTypes.TEXT,
                    cellLabel: "2",
                    ...ref("GEN 5:2"),
                    edits: [],
                },
            },
        ]);
        testFiles.push(uri);

        const beforeBytes = await readFileBytes(uri);
        const report = await recoverMergedChildrenForFile(uri);

        assert.strictEqual(
            report.changed,
            false,
            "Helper should report no changes for files with no merged cells"
        );
        assert.strictEqual(report.parentsRecovered, 0);
        assert.strictEqual(report.perParent.length, 0);

        const afterBytes = await readFileBytes(uri);
        assert.deepStrictEqual(
            Buffer.from(afterBytes),
            Buffer.from(beforeBytes),
            "File bytes should be unchanged when there are no merged cells"
        );
    });
});
