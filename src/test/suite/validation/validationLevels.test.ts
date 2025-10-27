import * as assert from "assert";
import { ValidationEntry } from "../../../../types";

suite("ValidationLevels Test Suite", () => {
    function computeLevels(counts: number[], maxLevel: number, totalCells: number): number[] {
        const levels: number[] = [];
        const total = totalCells > 0 ? totalCells : 1;
        for (let k = 1; k <= Math.max(0, maxLevel); k++) {
            const satisfied = counts.filter((n) => n >= k).length;
            levels.push((satisfied / total) * 100);
        }
        return levels;
    }

    function countNonDeleted(entries?: ValidationEntry[]): number {
        return (entries || []).filter((e) => !e.isDeleted).length;
    }

    test("computes text levels for mixed validation counts", () => {
        // 4 cells with 0,1,2,3 validations respectively
        const counts = [0, 1, 2, 3];
        const required = 3;
        const totalCells = counts.length;

        const levels = computeLevels(counts, required, totalCells);
        assert.deepStrictEqual(levels.map((v) => Math.round(v)), [75, 50, 25]);
    });

    test("computes audio levels and ignores deleted validations", () => {
        // Build audioValidatedBy arrays with some deleted entries
        const a: ValidationEntry[] = []; // 0 active
        const b: ValidationEntry[] = [
            { username: "u1", creationTimestamp: 1, updatedTimestamp: 1, isDeleted: false },
            { username: "u2", creationTimestamp: 2, updatedTimestamp: 2, isDeleted: true },
        ]; // 1 active
        const c: ValidationEntry[] = [
            { username: "u1", creationTimestamp: 1, updatedTimestamp: 1, isDeleted: false },
            { username: "u2", creationTimestamp: 2, updatedTimestamp: 2, isDeleted: false },
        ]; // 2 active
        const d: ValidationEntry[] = [
            { username: "u1", creationTimestamp: 1, updatedTimestamp: 1, isDeleted: false },
            { username: "u2", creationTimestamp: 2, updatedTimestamp: 2, isDeleted: false },
            { username: "u3", creationTimestamp: 3, updatedTimestamp: 3, isDeleted: true },
        ]; // 2 active (one deleted)

        const counts = [countNonDeleted(a), countNonDeleted(b), countNonDeleted(c), countNonDeleted(d)];
        const required = 2;
        const levels = computeLevels(counts, required, counts.length);

        // level 1: >=1 satisfied in 3/4 => 75, level 2: >=2 satisfied in 2/4 => 50
        assert.deepStrictEqual(levels.map((v) => Math.round(v)), [75, 50]);
    });

    test("returns empty array when required validations is 0", () => {
        const counts = [1, 1, 1];
        const required = 0;
        const levels = computeLevels(counts, required, counts.length);
        assert.deepStrictEqual(levels, []);
    });

    test("handles zero total cells without NaN or Infinity", () => {
        const counts: number[] = [];
        const required = 3;
        const levels = computeLevels(counts, required, 0);
        // With 0 total, denominator becomes 1; no cells satisfy any level => all zeros
        assert.deepStrictEqual(levels, [0, 0, 0]);
    });

    test("all cells meet first N-1 levels but not Nth", () => {
        // 5 cells each with exactly 2 validations
        const counts = [2, 2, 2, 2, 2];
        const required = 3;
        const levels = computeLevels(counts, required, counts.length);
        // >=1: 100, >=2: 100, >=3: 0
        assert.deepStrictEqual(levels.map((v) => Math.round(v)), [100, 100, 0]);
    });
});


