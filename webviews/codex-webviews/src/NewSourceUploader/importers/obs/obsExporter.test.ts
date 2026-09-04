import { describe, expect, it } from "vitest";
import { collectObsTranslationsFromCells, extractObsStoryFromCells } from "./obsExporter";

describe("OBS exporter active-cell filtering", () => {
    it("does not let a re-import tombstone replace the live segment", () => {
        const cells = [
            {
                kind: 2,
                value: "<p>Traducción viva</p>",
                metadata: { type: "text", segmentType: "text", segmentIndex: 0, data: {} },
            },
            {
                kind: 2,
                value: "<p>Traducción obsoleta</p>",
                metadata: {
                    type: "text",
                    segmentType: "text",
                    segmentIndex: 0,
                    data: { deleted: true },
                },
            },
        ];

        expect(collectObsTranslationsFromCells(cells).get(0)).toBe("Traducción viva");
        expect(extractObsStoryFromCells(cells).segments[0].text).toBe("Traducción viva");
    });
});
