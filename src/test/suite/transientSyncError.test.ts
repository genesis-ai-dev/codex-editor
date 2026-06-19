import * as assert from "assert";
import {
    BLOB_READ_FAILED_PREFIX,
    TransientSyncError,
    isRetriableSyncError,
    isUserSurfacedError,
    markUserSurfaced,
} from "../../projectManager/utils/merge/transientSyncError";

/**
 * Contract tests for the retry classifier.
 *
 * These tests intentionally hard-code the BLOB_READ_FAILED_PREFIX literal value
 * (rather than referring to the imported constant) when checking string-prefix
 * matching, because the WHOLE POINT of the prefix is to be a stable wire format
 * across the codex-editor <-> frontier-authentication extension boundary.
 *
 * If you change the literal string here, you MUST change the matching test in
 * frontier-authentication AND the constant in BOTH repos. The exact-string
 * assert below is the canary that catches that drift.
 */
suite("transientSyncError - retry classifier contract", () => {
    test("BLOB_READ_FAILED_PREFIX is exactly the cross-repo wire string", () => {
        // DO NOT CHANGE THIS LITERAL without also updating:
        //  - codex-editor:           src/projectManager/utils/merge/transientSyncError.ts
        //  - frontier-authentication: src/git/GitService.ts (BLOB_READ_FAILED_PREFIX)
        //  - frontier-authentication tests asserting the same literal
        assert.strictEqual(BLOB_READ_FAILED_PREFIX, "BLOB_READ_FAILED:");
    });

    test("classifies TransientSyncError as retriable", () => {
        assert.strictEqual(
            isRetriableSyncError(new TransientSyncError("missing files: a.codex")),
            true
        );
    });

    test("classifies plain Error with literal BLOB_READ_FAILED: prefix as retriable", () => {
        const err = new Error("BLOB_READ_FAILED: remote HEAD blob unreadable for files/target/JUD.codex");
        assert.strictEqual(isRetriableSyncError(err), true);
    });

    test("classifies network/push-rejection errors as retriable", () => {
        assert.strictEqual(isRetriableSyncError(new Error("non-fast-forward")), true);
        assert.strictEqual(isRetriableSyncError(new Error("Failed to push some refs")), true);
        assert.strictEqual(isRetriableSyncError(new Error("ETIMEDOUT")), true);
        assert.strictEqual(isRetriableSyncError(new Error("ECONNRESET")), true);
        assert.strictEqual(isRetriableSyncError(new Error("network unreachable")), true);
    });

    test("does NOT classify generic merge failures or auth errors as retriable", () => {
        assert.strictEqual(
            isRetriableSyncError(new Error("Authentication failed")),
            false
        );
        assert.strictEqual(
            isRetriableSyncError(new Error("Merge aborted: 2 conflict(s) could not be resolved.")),
            false
        );
        assert.strictEqual(isRetriableSyncError("not even an error"), false);
        assert.strictEqual(isRetriableSyncError(undefined), false);
        assert.strictEqual(isRetriableSyncError(null), false);
    });

    test("BLOB_READ_FAILED: must match by *prefix*, not substring", () => {
        // Defensive: the classifier uses startsWith, not includes. An error that
        // mentions the string in the middle (e.g. wrapped error) should NOT be
        // classified as retriable unless wrapped explicitly. This pins that.
        const wrappedInMiddle = new Error("Some other error: BLOB_READ_FAILED: nested");
        assert.strictEqual(
            isRetriableSyncError(wrappedInMiddle),
            false,
            "Substring match would be a footgun; classifier must require prefix"
        );
    });

    test("TransientSyncError carries optional details", () => {
        const e = new TransientSyncError("missing", ["a.codex", "b.codex"]);
        assert.deepStrictEqual(e.details, ["a.codex", "b.codex"]);
        assert.strictEqual(e.name, "TransientSyncError");
        assert.ok(e instanceof Error);
    });
});

/**
 * Dialog-gating contract: the outer catch in stageAndCommitAllAndSync uses
 * isUserSurfacedError to avoid showing a generic "Sync failed" dialog on top of
 * an inner, more specific dialog. These tests pin that contract so refactors
 * can't accidentally lose the no-double-popup guarantee.
 */
suite("transientSyncError - userSurfaced dialog gating", () => {
    test("isUserSurfacedError returns false on a fresh Error", () => {
        assert.strictEqual(isUserSurfacedError(new Error("anything")), false);
    });

    test("markUserSurfaced + isUserSurfacedError round-trip", () => {
        const e = markUserSurfaced(new Error("Merge aborted: ..."));
        assert.strictEqual(isUserSurfacedError(e), true);
    });

    test("isUserSurfacedError ignores non-Error values", () => {
        assert.strictEqual(isUserSurfacedError("string"), false);
        assert.strictEqual(isUserSurfacedError(undefined), false);
        assert.strictEqual(isUserSurfacedError(null), false);
        assert.strictEqual(isUserSurfacedError({ userSurfaced: true }), false);
    });

    test("markUserSurfaced returns the same error instance for chaining", () => {
        const e = new Error("x");
        const result = markUserSurfaced(e);
        assert.strictEqual(result, e, "Should return same instance for `throw markUserSurfaced(new Error(...))` ergonomics");
    });
});
