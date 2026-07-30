import * as assert from "assert";
import {
    DISALLOWED_BOOK_NAME_CHARS,
    findDisallowedBookNameChars,
    bookNameHasDisallowedChars,
    getBookNameValidationMessage,
} from "../../../sharedUtils/bookNameValidation";

suite("bookNameValidation Test Suite", () => {
    test("DISALLOWED_BOOK_NAME_CHARS includes the period that triggered issue #1013", () => {
        assert.ok(
            DISALLOWED_BOOK_NAME_CHARS.includes("."),
            "'.' must be in the disallowed list (root cause of #1013)"
        );
    });

    test("DISALLOWED_BOOK_NAME_CHARS includes filesystem-unsafe characters", () => {
        const expected = ["/", "\\", ":", "*", "?", '"', "<", ">", "|"];
        for (const ch of expected) {
            assert.ok(
                DISALLOWED_BOOK_NAME_CHARS.includes(ch),
                `'${ch}' should be disallowed in book names`
            );
        }
    });

    test("findDisallowedBookNameChars returns offenders without duplicates", () => {
        assert.deepStrictEqual(findDisallowedBookNameChars("1. New Items"), ["."]);
        assert.deepStrictEqual(
            findDisallowedBookNameChars("a/b\\c/d"),
            ["/", "\\"],
            "Repeated offenders should be deduplicated"
        );
        assert.deepStrictEqual(findDisallowedBookNameChars("My Book"), []);
        assert.deepStrictEqual(findDisallowedBookNameChars(""), []);
    });

    test("bookNameHasDisallowedChars distinguishes valid and invalid names", () => {
        assert.strictEqual(bookNameHasDisallowedChars("1. New Items"), true);
        assert.strictEqual(bookNameHasDisallowedChars("1.New"), true);
        assert.strictEqual(bookNameHasDisallowedChars(".leading"), true);
        assert.strictEqual(bookNameHasDisallowedChars("trailing."), true);

        assert.strictEqual(bookNameHasDisallowedChars("1 New Items"), false);
        assert.strictEqual(bookNameHasDisallowedChars("1-New-Items"), false);
        assert.strictEqual(bookNameHasDisallowedChars("1_New_Items"), false);
        assert.strictEqual(bookNameHasDisallowedChars("Genesis"), false);
        assert.strictEqual(bookNameHasDisallowedChars(""), false);
    });

    test("getBookNameValidationMessage returns null for valid names", () => {
        assert.strictEqual(getBookNameValidationMessage("Genesis"), null);
        assert.strictEqual(getBookNameValidationMessage("1-New-Items"), null);
        assert.strictEqual(getBookNameValidationMessage("1_New_Items"), null);
        assert.strictEqual(getBookNameValidationMessage(""), null);
    });

    test("getBookNameValidationMessage describes the offending characters", () => {
        const message = getBookNameValidationMessage("1. New Items");
        assert.ok(message, "Should return a non-null message for invalid names");
        assert.ok(message!.includes('"."'), "Message should reference the period");
        assert.ok(
            message!.toLowerCase().includes("dash") || message!.includes("-"),
            "Message should suggest dashes as an alternative"
        );
        assert.ok(
            message!.toLowerCase().includes("underscore") || message!.includes("_"),
            "Message should suggest underscores as an alternative"
        );
    });

    test("getBookNameValidationMessage handles multiple offenders", () => {
        const message = getBookNameValidationMessage("a/b.c");
        assert.ok(message, "Should return a non-null message for invalid names");
        assert.ok(message!.includes('"/"'), "Message should reference '/'");
        assert.ok(message!.includes('"."'), "Message should reference '.'");
    });
});
