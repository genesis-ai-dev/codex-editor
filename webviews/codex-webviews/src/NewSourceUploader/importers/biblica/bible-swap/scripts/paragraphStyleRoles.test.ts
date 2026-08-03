import { describe, it, expect } from "vitest";
import { canonicalizeParagraphStyle } from "../paragraphStyleRoles";

describe("canonicalizeParagraphStyle", () => {
    it("maps Bible heading-role title styles onto the study's head vocabulary", () => {
        const cases: Array<[string, string]> = [
            ["ParagraphStyle/title%3as1", "ParagraphStyle/head%3as1"],
            ["ParagraphStyle/title%3as2_h", "ParagraphStyle/head%3as2_h"],
            ["ParagraphStyle/title%3ar_h", "ParagraphStyle/head%3ar_h"],
            ["ParagraphStyle/title%3acl", "ParagraphStyle/head%3acl"],
            ["ParagraphStyle/title%3ad_h", "ParagraphStyle/head%3ad_h"],
            ["ParagraphStyle/title%3ad_h_dc1", "ParagraphStyle/head%3ad_h_dc1"],
            ["ParagraphStyle/title%3ad", "ParagraphStyle/head%3ad"],
            ["ParagraphStyle/title%3asp", "ParagraphStyle/head%3asp"],
            ["ParagraphStyle/title%3aqa", "ParagraphStyle/head%3aqa"],
            ["ParagraphStyle/title%3ams1", "ParagraphStyle/head%3ams1"],
            ["title:s1", "head:s1"],
        ];
        for (const [input, expected] of cases) {
            expect(canonicalizeParagraphStyle(input)).toBe(expected);
        }
    });

    it("leaves the book main title and unrelated styles alone", () => {
        const unchanged = [
            "ParagraphStyle/title%3amt1",
            "ParagraphStyle/title%3amt2",
            "ParagraphStyle/title:mt1",
            "ParagraphStyle/text%3ap_dc1",
            "ParagraphStyle/intro%3aipi",
            "ParagraphStyle/notes%3af",
            "ParagraphStyle/head%3as1",
            "ParagraphStyle/b_head",
            "",
        ];
        for (const style of unchanged) {
            expect(canonicalizeParagraphStyle(style)).toBe(style);
        }
    });
});
