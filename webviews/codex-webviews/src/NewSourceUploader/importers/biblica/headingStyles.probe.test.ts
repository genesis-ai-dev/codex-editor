/**
 * Local diagnostic: which paragraph styles the study-notes pass turns into cells.
 *
 * Reads the unpublished English study volumes, so it skips itself when those
 * files are not present on disk.
 */
import { describe, it } from "vitest";
import fs from "fs";
import { IDMLParser } from "./biblicaParser";
import { HTMLMapper } from "./htmlMapper";
import { createCellsFromStories } from "./biblicaCellBuilder";
import { isBiblicaFrontBackMatterDocument } from "./biblicaImportUtils";

const BASE =
    "C:/Users/marti/Desktop/FrontierRnD/Test Files/Biblica Global Publishing/English IDML";

const countCellsByStyle = async (fileName: string) => {
    const buffer = fs.readFileSync(`${BASE}/${fileName}`);
    // Built in this realm so the parser's `instanceof ArrayBuffer` branch is taken.
    const arrayBuffer = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(arrayBuffer).set(buffer);

    const parser = new IDMLParser({
        preserveAllFormatting: true,
        preserveObjectIds: true,
        validateRoundTrip: false,
        strictMode: false,
    });
    const document = await parser.parseIDML(arrayBuffer);
    const htmlRepresentation = new HTMLMapper().convertToHTML(document);
    const includeAllTextStyles = isBiblicaFrontBackMatterDocument(document.stories);
    const cells = await createCellsFromStories(
        document.stories,
        htmlRepresentation,
        fileName,
        { includeAllTextStyles }
    );

    const byStyle = new Map<string, number>();
    for (const cell of cells) {
        const style = String(
            (cell.metadata as { appliedParagraphStyle?: string; })?.appliedParagraphStyle ?? "?"
        ).replace("ParagraphStyle/", "");
        byStyle.set(style, (byStyle.get(style) ?? 0) + 1);
    }

    const lines = [...byStyle.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([style, n]) => `   ${String(n).padStart(5)}  ${style}`);
    console.log(
        `===== ${fileName}: ${cells.length} cells (frontBackMatter=${includeAllTextStyles}) =====\n${lines.join("\n")}`
    );
};

describe.skipIf(!fs.existsSync(BASE))("biblica study-notes cell styles", () => {
    for (const fileName of ["ACT-REV.idml", "ISA-MAL.idml", "JOB-SNG.idml"]) {
        it(`reports the styles that became cells in ${fileName}`, async () => {
            await countCellsByStyle(fileName);
        }, 600_000);
    }
});
