import { EXTENSION_PIN_POLICY } from "../../../sharedUtils/extensionPinFeatureFlag";
import * as assert from "assert";
import { clearMetadataPinsInText } from "../../../sharedUtils/metadataPinTextEdit";

suite("Targeted metadata pin text edits", () => {
    test("disabled policy leaves even invalid metadata untouched", () => {
        EXTENSION_PIN_POLICY.ignoreProjectPins = false;
        try {
            for (const text of ['{broken', '{"meta":{"pinnedExtensions":{"ext":{}}}}']) {
                assert.strictEqual(clearMetadataPinsInText(text), text);
            }
        } finally { EXTENSION_PIN_POLICY.ignoreProjectPins = true; }
    });
    test("changes only the pin value, preserving all surrounding bytes", () => {
        const prefix = '\uFEFF{\r\n\t"number": 1.2300e+09, "text":"\\u0061",\r\n\t"meta" : {"name":"Keep", "pinnedExtensions" : ';
        const pins = '{"ext":{"version":"1","url":"https://example.invalid/quoted\\"name.vsix"}}';
        const suffix = ', "other": [1, {"pinnedExtensions":{"nested":"keep"}}]}\r\n}\r\n';
        assert.strictEqual(clearMetadataPinsInText(prefix + pins + suffix), prefix + '{}' + suffix);
    });

    test("recognizes escaped keys without changing their spelling", () => {
        const input = '{"m\\u0065ta":{"pinned\\u0045xtensions":{"ext":{}},"keep":true}}';
        assert.strictEqual(clearMetadataPinsInText(input), input.replace('{"ext":{}}', '{}'));
    });

    test("empty maps are byte-for-byte no-ops", () => {
        const input = '{ "meta" : { "pinnedExtensions" : { \n } }, "keep" : 1e2 }\n';
        assert.strictEqual(clearMetadataPinsInText(input), input);
    });

    test("inserts missing keys without reformatting existing content", () => {
        assert.strictEqual(clearMetadataPinsInText('{ "keep": 1e2 }'), '{ "keep": 1e2,"meta":{"pinnedExtensions":{}} }');
        assert.strictEqual(clearMetadataPinsInText('{"meta": { "keep": "\\u0061" }}'), '{"meta": { "keep": "\\u0061","pinnedExtensions":{} }}');
        assert.strictEqual(clearMetadataPinsInText('{}'), '{"meta":{"pinnedExtensions":{}}}');
        assert.strictEqual(clearMetadataPinsInText('{"meta":{}}'), '{"meta":{"pinnedExtensions":{}}}');
    });

    test("clears every pin value shape without touching sibling fields", () => {
        for (const value of ['null', '[]', '"bad"', '42', '{"ext":{"version":"","url":""}}']) {
            const input = '{"meta":{"pinnedExtensions":' + value + ',"keep":true}}';
            assert.strictEqual(clearMetadataPinsInText(input), '{"meta":{"pinnedExtensions":{},"keep":true}}');
        }
    });

    test("rejects malformed or ambiguous metadata", () => {
        for (const input of ['{broken', '[]', 'null', '{"meta":null}', '{"meta":[]}',
            '{"meta":{},"meta":{}}', '{"meta":{"pinnedExtensions":{},"pinnedExtensions":{}}}']) {
            assert.throws(() => clearMetadataPinsInText(input), input);
        }
    });
});
