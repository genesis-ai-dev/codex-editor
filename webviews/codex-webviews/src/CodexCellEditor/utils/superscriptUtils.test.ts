import { describe, it, expect } from "vitest";
import {
    SUPERSCRIPT_DIGIT_MAP,
    fromSuperscriptDigit,
    fromSuperscriptDigits,
    isSuperscriptibleDigit,
    isSuperscriptDigit,
    superscriptFontGroup,
    toSuperscriptDigit,
    toSuperscriptDigits,
    toggleSuperscriptDigits,
} from "./superscriptUtils";

describe("superscriptUtils", () => {
    describe("SUPERSCRIPT_DIGIT_MAP", () => {
        it("covers every digit 0-9", () => {
            for (let i = 0; i <= 9; i++) {
                expect(SUPERSCRIPT_DIGIT_MAP[String(i)]).toBeDefined();
                expect(SUPERSCRIPT_DIGIT_MAP[String(i)]).toHaveLength(1);
            }
        });

        it("maps digits to the expected Unicode code points", () => {
            expect(SUPERSCRIPT_DIGIT_MAP["0"]).toBe("\u2070");
            expect(SUPERSCRIPT_DIGIT_MAP["1"]).toBe("\u00B9");
            expect(SUPERSCRIPT_DIGIT_MAP["2"]).toBe("\u00B2");
            expect(SUPERSCRIPT_DIGIT_MAP["3"]).toBe("\u00B3");
            expect(SUPERSCRIPT_DIGIT_MAP["4"]).toBe("\u2074");
            expect(SUPERSCRIPT_DIGIT_MAP["9"]).toBe("\u2079");
        });
    });

    describe("isSuperscriptibleDigit", () => {
        it("returns true for every ASCII digit", () => {
            for (let i = 0; i <= 9; i++) {
                expect(isSuperscriptibleDigit(String(i))).toBe(true);
            }
        });

        it("returns false for non-digit characters", () => {
            expect(isSuperscriptibleDigit("a")).toBe(false);
            expect(isSuperscriptibleDigit(" ")).toBe(false);
            expect(isSuperscriptibleDigit("²")).toBe(false);
            expect(isSuperscriptibleDigit("")).toBe(false);
            expect(isSuperscriptibleDigit("12")).toBe(false);
        });
    });

    describe("isSuperscriptDigit", () => {
        it("returns true for every superscript digit", () => {
            for (const ch of Object.values(SUPERSCRIPT_DIGIT_MAP)) {
                expect(isSuperscriptDigit(ch)).toBe(true);
            }
        });

        it("returns false for regular digits and other chars", () => {
            expect(isSuperscriptDigit("0")).toBe(false);
            expect(isSuperscriptDigit("9")).toBe(false);
            expect(isSuperscriptDigit("a")).toBe(false);
            expect(isSuperscriptDigit("")).toBe(false);
        });
    });

    describe("toSuperscriptDigit", () => {
        it("converts single ASCII digits", () => {
            expect(toSuperscriptDigit("2")).toBe("²");
            expect(toSuperscriptDigit("4")).toBe("⁴");
        });

        it("returns the input unchanged for non-digits", () => {
            expect(toSuperscriptDigit("a")).toBe("a");
            expect(toSuperscriptDigit("²")).toBe("²");
        });
    });

    describe("superscriptFontGroup", () => {
        it("classifies Latin-1 supplement superscripts", () => {
            expect(superscriptFontGroup("\u00B9")).toBe("lat");
            expect(superscriptFontGroup("\u00B2")).toBe("lat");
            expect(superscriptFontGroup("\u00B3")).toBe("lat");
        });

        it("classifies superscript block digits", () => {
            expect(superscriptFontGroup("\u2070")).toBe("phon");
            expect(superscriptFontGroup("\u2074")).toBe("phon");
            expect(superscriptFontGroup("\u2079")).toBe("phon");
        });

        it("returns null for unrelated characters", () => {
            expect(superscriptFontGroup("1")).toBe(null);
            expect(superscriptFontGroup("")).toBe(null);
        });
    });

    describe("toSuperscriptDigits", () => {
        it("returns an empty string unchanged", () => {
            expect(toSuperscriptDigits("")).toBe("");
        });

        it("returns text without digits unchanged", () => {
            expect(toSuperscriptDigits("hello world")).toBe("hello world");
        });

        it("converts all digits in mixed text", () => {
            expect(toSuperscriptDigits("abc123xyz")).toBe("abc¹²³xyz");
        });

        it("converts every digit 0-9", () => {
            expect(toSuperscriptDigits("0123456789")).toBe("⁰¹²³⁴⁵⁶⁷⁸⁹");
        });

        it("converts the Saurashtra sample (தா2டும் -> தா²டும்)", () => {
            expect(toSuperscriptDigits("தா2டும்")).toBe("தா²டும்");
        });

        it("converts multiple digits in a Saurashtra phrase", () => {
            expect(toSuperscriptDigits("தெ2வட் தா2டும் சலே கெ4டி")).toBe(
                "தெ²வட் தா²டும் சலே கெ⁴டி"
            );
        });

        it("leaves already-superscript digits alone", () => {
            expect(toSuperscriptDigits("தா²டும்")).toBe("தா²டும்");
        });
    });

    describe("fromSuperscriptDigit", () => {
        it("converts a single superscript digit back to ASCII", () => {
            expect(fromSuperscriptDigit("²")).toBe("2");
            expect(fromSuperscriptDigit("⁴")).toBe("4");
            expect(fromSuperscriptDigit("⁰")).toBe("0");
        });

        it("returns the input unchanged for non-superscript chars", () => {
            expect(fromSuperscriptDigit("a")).toBe("a");
            expect(fromSuperscriptDigit("2")).toBe("2");
        });
    });

    describe("fromSuperscriptDigits", () => {
        it("converts every superscript digit back to ASCII", () => {
            expect(fromSuperscriptDigits("⁰¹²³⁴⁵⁶⁷⁸⁹")).toBe("0123456789");
        });

        it("leaves regular digits and other chars untouched", () => {
            expect(fromSuperscriptDigits("abc123xyz")).toBe("abc123xyz");
            expect(fromSuperscriptDigits("தா²டும்")).toBe("தா2டும்");
        });
    });

    describe("toggleSuperscriptDigits", () => {
        it("converts ASCII digits to superscript", () => {
            expect(toggleSuperscriptDigits("abc123xyz")).toBe("abc¹²³xyz");
        });

        it("converts superscript digits back to ASCII (round-trip)", () => {
            expect(toggleSuperscriptDigits("abc¹²³xyz")).toBe("abc123xyz");
        });

        it("toggles each digit individually in mixed input", () => {
            expect(toggleSuperscriptDigits("a1²b³4")).toBe("a¹2b3⁴");
        });

        it("is its own inverse for digit-only input", () => {
            const input = "தெ2வட் தா²டும்";
            expect(toggleSuperscriptDigits(toggleSuperscriptDigits(input))).toBe(input);
        });

        it("leaves text without digits unchanged", () => {
            expect(toggleSuperscriptDigits("hello world")).toBe("hello world");
        });
    });
});
