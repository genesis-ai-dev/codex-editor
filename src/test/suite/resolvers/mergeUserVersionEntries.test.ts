import * as assert from "assert";
import { mergeUserVersionEntries } from "../../../projectManager/utils/merge/resolvers";
import type { ProjectUserVersionEntry } from "../../../../types/index.d";

const makeEntry = (
    userName: string,
    codexVersion: string,
    updatedAt: number
): ProjectUserVersionEntry => ({ userName, codexVersion, updatedAt });

suite("Resolver unit: mergeUserVersionEntries", () => {
    test("returns undefined when both inputs are undefined", () => {
        const result = mergeUserVersionEntries(undefined, undefined);
        assert.strictEqual(result, undefined);
    });

    test("returns undefined when both inputs are empty arrays", () => {
        const result = mergeUserVersionEntries([], []);
        assert.strictEqual(result, undefined);
    });

    test("returns ours entries when theirs is undefined", () => {
        const ours = [makeEntry("alice", "0.22.0", 1000)];
        const result = mergeUserVersionEntries(ours, undefined);
        assert.ok(result);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].userName, "alice");
    });

    test("returns theirs entries when ours is undefined", () => {
        const theirs = [makeEntry("bob", "0.23.0", 2000)];
        const result = mergeUserVersionEntries(undefined, theirs);
        assert.ok(result);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].userName, "bob");
    });

    test("unions entries with different userNames", () => {
        const ours = [makeEntry("alice", "0.22.0", 1000)];
        const theirs = [makeEntry("bob", "0.23.0", 2000)];
        const result = mergeUserVersionEntries(ours, theirs);
        assert.ok(result);
        assert.strictEqual(result.length, 2);
        const names = result.map((e) => e.userName).sort();
        assert.deepStrictEqual(names, ["alice", "bob"]);
    });

    test("keeps the entry with higher updatedAt when same userName appears on both sides", () => {
        const ours = [makeEntry("alice", "0.22.0", 1000)];
        const theirs = [makeEntry("alice", "0.23.0", 2000)];
        const result = mergeUserVersionEntries(ours, theirs);
        assert.ok(result);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].codexVersion, "0.23.0");
        assert.strictEqual(result[0].updatedAt, 2000);
    });

    test("keeps ours when updatedAt is equal (ours is seen first, theirs cannot beat it)", () => {
        const ours = [makeEntry("alice", "0.22.0", 1000)];
        const theirs = [makeEntry("alice", "0.23.0", 1000)];
        const result = mergeUserVersionEntries(ours, theirs);
        assert.ok(result);
        assert.strictEqual(result.length, 1);
        // With equal timestamps, theirs overwrites ours because iteration order
        // is [...ours, ...theirs] and the `>` comparison means theirs does NOT replace ours
        assert.strictEqual(result[0].codexVersion, "0.22.0");
    });

    test("skips entries with missing userName", () => {
        const ours = [{ userName: "", codexVersion: "0.22.0", updatedAt: 1000 } as ProjectUserVersionEntry];
        const theirs = [makeEntry("bob", "0.23.0", 2000)];
        const result = mergeUserVersionEntries(ours, theirs);
        assert.ok(result);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].userName, "bob");
    });

    test("complex scenario: multiple users, some shared, some exclusive", () => {
        const ours = [
            makeEntry("alice", "0.22.0", 1000),
            makeEntry("carol", "0.21.0", 500),
        ];
        const theirs = [
            makeEntry("alice", "0.23.0", 2000),
            makeEntry("bob", "0.22.5", 1500),
        ];
        const result = mergeUserVersionEntries(ours, theirs);
        assert.ok(result);
        assert.strictEqual(result.length, 3);

        const byName = new Map(result.map((e) => [e.userName, e]));
        assert.strictEqual(byName.get("alice")?.codexVersion, "0.23.0");
        assert.strictEqual(byName.get("bob")?.codexVersion, "0.22.5");
        assert.strictEqual(byName.get("carol")?.codexVersion, "0.21.0");
    });
});
