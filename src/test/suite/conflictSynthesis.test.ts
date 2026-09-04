import * as assert from "assert";

import {
    enforceConflictListInvariant,
    normalizeSyncPath,
} from "../../projectManager/utils/merge/conflictSynthesis";
import { TransientSyncError } from "../../projectManager/utils/merge/transientSyncError";

suite("conflict-list invariant", () => {
    test("canonicalizes path separators, prefixes, and Unicode", () => {
        assert.strictEqual(normalizeSyncPath("files\\target\\EP.codex"), "files/target/EP.codex");
        assert.strictEqual(normalizeSyncPath("././files/target/EP.codex"), "files/target/EP.codex");
        assert.strictEqual(normalizeSyncPath("/files/target/EP.codex"), "files/target/EP.codex");
        assert.strictEqual(
            normalizeSyncPath("files/target/Genèse.codex".normalize("NFD")),
            "files/target/Genèse.codex".normalize("NFC")
        );
    });

    test("accepts remote-changed paths present in the conflict list", async () => {
        await enforceConflictListInvariant({
            conflicts: [
                { filepath: "files/target/EP.codex" },
                { filepath: "files/target/Genèse.codex".normalize("NFC") },
            ],
            changedPaths: [
                ".\\files\\target\\EP.codex",
                "files/target/Genèse.codex".normalize("NFD"),
            ],
        });
    });

    test("fails safely instead of synthesizing missing remote paths", async () => {
        await assert.rejects(
            enforceConflictListInvariant({
                conflicts: [],
                changedPaths: ["files/target/MISSING.codex"],
            }),
            (error: unknown) =>
                error instanceof TransientSyncError &&
                error.message.includes("stopped instead of guessing") &&
                error.details?.includes("files/target/MISSING.codex") === true
        );
    });

    test("never materializes a large omitted remote set", async () => {
        const paths = Array.from(
            { length: 1500 },
            (_, index) => `.project/attachments/pointers/BOOK/audio-${index}.wav`
        );
        await assert.rejects(
            enforceConflictListInvariant({ conflicts: [], changedPaths: paths }),
            (error: unknown) =>
                error instanceof TransientSyncError &&
                error.details?.length === paths.length &&
                error.message.includes("1500 remote-changed file(s)")
        );
    });
});
