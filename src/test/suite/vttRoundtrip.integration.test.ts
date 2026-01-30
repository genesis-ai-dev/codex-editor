import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

import { parseFile as parseVtt } from "../../../webviews/codex-webviews/src/NewSourceUploader/importers/subtitles/index";
import { subtitlesCellAligner } from "../../../webviews/codex-webviews/src/NewSourceUploader/importers/subtitles/aligner";
import { notebookToImportedContent } from "../../../webviews/codex-webviews/src/NewSourceUploader/importers/common/translationHelper";
import { CodexCellTypes } from "../../../types/enums";
import type { AlignedCell } from "../../../webviews/codex-webviews/src/NewSourceUploader/types/plugin";
import type { CustomNotebookCellData } from "../../../types";

type FileLike = {
    name: string;
    size: number;
    lastModified: number;
    text: () => Promise<string>;
};

function resolveMockVttPath(fileName: string): string {
    // In extension tests, `__dirname` is usually `<repo>/out/test/suite`.
    const repoRootFromOut = path.resolve(__dirname, "../../..");
    const candidates: string[] = [
        path.resolve(repoRootFromOut, "src/test/suite/mocks", fileName),
        path.resolve(process.cwd(), "src/test/suite/mocks", fileName),
    ];

    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }

    throw new Error(`Could not find VTT mock fixture. Tried:\n${candidates.join("\n")}`);
}

function buildFileLike(filePath: string): FileLike {
    const content = fs.readFileSync(filePath, "utf8");
    return {
        name: path.basename(filePath),
        size: Buffer.byteLength(content, "utf8"),
        lastModified: Date.now(),
        text: async () => content,
    };
}

suite("VTT round-trip integration (mock VTT fixtures)", function () {
    this.timeout(30_000);

    test("import -> align target VTT -> preserves milestones", async () => {
        const sourcePath = resolveMockVttPath("vtt-roundtrip-source.vtt");
        const targetPath = resolveMockVttPath("vtt-roundtrip-target.vtt");

        const sourceFile = buildFileLike(sourcePath);
        const targetFile = buildFileLike(targetPath);

        const sourceImport = await parseVtt(sourceFile as unknown as File);
        assert.strictEqual(sourceImport.success, true, "Expected source VTT import success");
        assert.ok(sourceImport.notebookPair, "Expected source notebookPair from VTT importer");

        const targetImport = await parseVtt(targetFile as unknown as File);
        assert.strictEqual(targetImport.success, true, "Expected target VTT import success");
        assert.ok(targetImport.notebookPair, "Expected target notebookPair from VTT importer");

        const targetCells = sourceImport.notebookPair!.codex.cells.map((cell) => ({
            kind: 1,
            languageId: "html",
            value: cell.content ?? "",
            metadata: cell.metadata,
        })) as CustomNotebookCellData[];
        const milestoneTarget = targetCells.find(
            (cell: CustomNotebookCellData) => cell.metadata?.type === CodexCellTypes.MILESTONE
        );
        assert.ok(milestoneTarget, "Expected milestone cell in target notebook");

        const importedContent = notebookToImportedContent(targetImport.notebookPair!);
        const aligned = await subtitlesCellAligner(targetCells, [], importedContent);

        const preservedMilestone = aligned.find(
            (cell: AlignedCell) => cell.notebookCell?.metadata?.type === CodexCellTypes.MILESTONE
        );
        assert.ok(preservedMilestone, "Expected milestone cell to be preserved during alignment");

        const milestoneId = milestoneTarget.metadata?.id;
        const paratextFromMilestone = aligned.find(
            (cell: AlignedCell) =>
                cell.isParatext === true &&
                cell.importedContent?.parentId === milestoneId &&
                cell.importedContent?.content?.trim() === "1"
        );
        assert.ok(
            !paratextFromMilestone,
            "Expected milestone cells to be ignored during subtitle alignment"
        );

        const importedByStart = new Map<number, string>();
        importedContent.forEach((item) => {
            if (typeof item.startTime === "number") {
                importedByStart.set(item.startTime, item.content);
            }
        });

        const alignedTextCell = aligned.find((cell: AlignedCell) => {
            const start = cell.notebookCell?.metadata?.data?.startTime;
            return typeof start === "number" && cell.notebookCell?.metadata?.type === CodexCellTypes.TEXT;
        });
        assert.ok(alignedTextCell, "Expected at least one aligned text cell");

        const alignedStart = alignedTextCell!.notebookCell.metadata.data.startTime as number;
        const expectedContent = importedByStart.get(alignedStart);
        assert.ok(expectedContent, "Expected imported content for aligned text cell");
        assert.strictEqual(
            alignedTextCell!.importedContent.content,
            expectedContent,
            "Expected aligned text cell to use target VTT content"
        );
    });
});
