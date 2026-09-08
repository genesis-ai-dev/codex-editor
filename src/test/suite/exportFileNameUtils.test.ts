import * as assert from "assert";
import {
    languageCodeAliases,
    languageFileCode,
    rewriteExportBaseName,
    toExportFileBaseName,
    toExportFileName,
} from "../../exportHandler/exportFileNameUtils";

suite("Export filename language rewrite", () => {
    test("replaces source _en with the project language and drops any timestamp", () => {
        const base = rewriteExportBaseName(
            "Some_project_120_en",
            "luo",
            ["eng", "en"]
        );
        assert.strictEqual(base, "Some_project_120_luo");
        assert.ok(!base.includes("2026"), "must not include a timestamp");
        assert.strictEqual(
            toExportFileName("Some_project_120_en.srt", ".srt", "luo", ["en"]),
            "Some_project_120_luo.srt"
        );
    });

    test("replaces _en even when source-language aliases are not provided", () => {
        assert.strictEqual(
            rewriteExportBaseName("Some_project_120_en", "luo", []),
            "Some_project_120_luo"
        );
    });

    test("keeps a trailing suffix after the language token", () => {
        assert.strictEqual(
            rewriteExportBaseName("TheChosen_306_en_SingleSpeaker", "luo", ["en"]),
            "TheChosen_306_luo_SingleSpeaker"
        );
    });

    test("appends the target language when the source name has no language token", () => {
        assert.strictEqual(rewriteExportBaseName("GEN", "luo", ["en"]), "GEN_luo");
        assert.strictEqual(
            rewriteExportBaseName("Some_project_120", "luo", ["en"]),
            "Some_project_120_luo"
        );
    });

    test("does not double-append when the name already ends with the target language", () => {
        assert.strictEqual(
            rewriteExportBaseName("Some_project_120_luo", "luo", ["en"]),
            "Some_project_120_luo"
        );
    });

    test("maps English tag eng to the _en token used in source filenames", () => {
        const aliases = languageCodeAliases({ tag: "eng" });
        assert.ok(aliases.includes("eng"));
        assert.ok(aliases.includes("en"));
        assert.strictEqual(languageFileCode({ tag: "luo" }), "luo");
    });

    test("toExportFileBaseName strips the original extension before rewriting", () => {
        assert.strictEqual(
            toExportFileBaseName("Some_project_120_en.idml", "luo", ["en"]),
            "Some_project_120_luo"
        );
        assert.strictEqual(
            toExportFileName("Some_project_120_en.codex", ".vtt", "luo", ["eng"]),
            "Some_project_120_luo.vtt"
        );
    });
});
