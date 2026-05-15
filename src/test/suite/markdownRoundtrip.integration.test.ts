import * as assert from "assert";

import { splitMarkdownIntoSpannedSegments } from "../../../webviews/codex-webviews/src/NewSourceUploader/importers/markdown/markdownSplit";
import { exportMarkdownWithTranslations } from "../../../webviews/codex-webviews/src/NewSourceUploader/importers/markdown/markdownExporter";

suite("Markdown round-trip integration (spans + export)", () => {
    test("split segments align with splice export", () => {
        const md = "# Title\n\nHello world.\n";
        const segs = splitMarkdownIntoSpannedSegments(md);
        assert.ok(segs.length >= 2);

        const cells = segs.map((s, i) => ({
            kind: 2,
            content: "",
            metadata: {
                sourceSpan: { start: s.start, end: s.end },
                segmentIndex: i,
                originalMarkdown: s.text,
            },
        }));

        const para = cells.find((c) => c.metadata.originalMarkdown === "Hello world.");
        assert.ok(para);
        para.content = "<p>Hola</p>";

        const out = exportMarkdownWithTranslations(md, cells as never);
        assert.ok(out.includes("Hola"), `expected translation in output: ${out}`);
        assert.ok(out.includes("# Title"), "expected heading preserved");
    });
});
