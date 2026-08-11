import { describe, expect, it } from "vitest";
import { exportTmsWithTranslations } from "./tmsExporter";

const makeCell = (
    unitId: string | number,
    value: string,
    opts?: {
        hidden?: boolean;
        deleted?: boolean;
        merged?: boolean;
        targetLanguage?: string;
        kind?: number;
        type?: string;
    }
) => ({
    kind: opts?.kind ?? 2,
    value: `<p>${value}</p>`,
    metadata: {
        type: opts?.type ?? "text",
        unitId,
        targetLanguage: opts?.targetLanguage ?? "es",
        sourceLanguage: "en",
        data: {
            ...(opts?.hidden ? { hidden: true } : {}),
            ...(opts?.deleted ? { deleted: true } : {}),
            ...(opts?.merged ? { merged: true } : {}),
        },
    },
});

const SAMPLE_TMX = `<?xml version="1.0" encoding="UTF-8"?>
<tmx version="1.4">
  <body>
    <tu tuid="tu-1">
      <tuv xml:lang="en"><seg>Hello</seg></tuv>
      <tuv xml:lang="es"><seg>Hola</seg></tuv>
    </tu>
    <tu tuid="tu-2">
      <tuv xml:lang="en"><seg>World</seg></tuv>
      <tuv xml:lang="es"><seg>Mundo</seg></tuv>
    </tu>
    <tu tuid="123">
      <tuv xml:lang="en"><seg>Numeric</seg></tuv>
      <tuv xml:lang="es"><seg>Numerico</seg></tuv>
    </tu>
  </body>
</tmx>`;

describe("exportTmsWithTranslations", () => {
    it("writes translations into the tuv matching targetLanguage (not merely the 2nd tuv)", async () => {
        // Source lang sorts after target alphabetically (zu > es), so document order
        // has target first — legacy "2nd tuv" logic would write into the wrong language.
        const tmx = `<?xml version="1.0" encoding="UTF-8"?>
<tmx version="1.4">
  <body>
    <tu tuid="tu-1">
      <tuv xml:lang="es"><seg>Hola</seg></tuv>
      <tuv xml:lang="zu"><seg>Sawubona</seg></tuv>
    </tu>
  </body>
</tmx>`;

        const result = await exportTmsWithTranslations(
            tmx,
            [makeCell("tu-1", "Buenos dias", { targetLanguage: "es" })],
            "tmx"
        );

        expect(result).toContain('<tuv xml:lang="es"><seg>Buenos dias</seg></tuv>');
        expect(result).toContain('<tuv xml:lang="zu"><seg>Sawubona</seg></tuv>');
        expect(result).not.toContain('<tuv xml:lang="zu"><seg>Buenos dias</seg></tuv>');
    });

    it("matches numeric unitId from import (parseAttributeValue) to string tuid", async () => {
        const result = await exportTmsWithTranslations(
            SAMPLE_TMX,
            [makeCell(123, "Actualizado")],
            "tmx"
        );

        expect(result).toContain('<tu tuid="123">');
        expect(result).toContain("<seg>Actualizado</seg>");
        expect(result).not.toContain("<seg>Numerico</seg>");
    });

    it("keeps original target for hidden cells and updates active ones", async () => {
        const result = await exportTmsWithTranslations(
            SAMPLE_TMX,
            [
                makeCell("tu-1", "Hola mundo"),
                makeCell("tu-2", "should not overwrite original", { hidden: true }),
                makeCell(123, "Actualizado"),
            ],
            "tmx"
        );

        expect(result).toContain('tuid="tu-1"');
        expect(result).toContain("<seg>Hola mundo</seg>");
        // Hidden unit stays in the file with its original target
        expect(result).toContain('tuid="tu-2"');
        expect(result).toContain("<seg>Mundo</seg>");
        expect(result).not.toContain("should not overwrite original");
        expect(result).toContain('tuid="123"');
        expect(result).toContain("<seg>Actualizado</seg>");
    });

    it("keeps original targets for deleted and merged cells", async () => {
        const result = await exportTmsWithTranslations(
            SAMPLE_TMX,
            [
                makeCell("tu-1", "Kept"),
                makeCell("tu-2", "should not overwrite", { deleted: true }),
                makeCell(123, "also should not overwrite", { merged: true }),
            ],
            "tmx"
        );

        expect(result).toContain('tuid="tu-1"');
        expect(result).toContain("<seg>Kept</seg>");
        expect(result).toContain('tuid="tu-2"');
        expect(result).toContain("<seg>Mundo</seg>");
        expect(result).toContain('tuid="123"');
        expect(result).toContain("<seg>Numerico</seg>");
        expect(result).not.toContain("should not overwrite");
    });

    it("keeps original XLIFF target for hidden cells", async () => {
        const xliff = `<?xml version="1.0" encoding="UTF-8"?>
<xliff version="1.2">
  <file>
    <body>
      <trans-unit id="u1">
        <source>Hello</source>
        <target>Hola</target>
      </trans-unit>
      <trans-unit id="u2">
        <source>World</source>
        <target>Mundo</target>
      </trans-unit>
    </body>
  </file>
</xliff>`;

        const result = await exportTmsWithTranslations(
            xliff,
            [
                makeCell("u1", "Hola mundo"),
                makeCell("u2", "should not overwrite", { hidden: true }),
            ],
            "xliff"
        );

        expect(result).toContain('id="u1"');
        expect(result).toContain("<target>Hola mundo</target>");
        expect(result).toContain('id="u2"');
        expect(result).toContain("<target>Mundo</target>");
        expect(result).not.toContain("should not overwrite");
    });

    it("skips milestone cells when collecting translations", async () => {
        const result = await exportTmsWithTranslations(
            SAMPLE_TMX,
            [
                {
                    kind: 2,
                    value: "1",
                    metadata: { type: "milestone", data: {} },
                },
                makeCell("tu-1", "Translated"),
            ],
            "tmx"
        );

        expect(result).toContain("<seg>Translated</seg>");
        // milestone must not steal segment-0 and overwrite an unrelated TU
        expect(result).toContain('tuid="tu-2"');
        expect(result).toContain("<seg>Mundo</seg>");
    });
});
