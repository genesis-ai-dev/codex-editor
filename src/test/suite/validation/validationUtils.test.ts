import * as assert from "assert";
import {
    isValidValidationEntry,
    getActiveAudioValidations,
    isAudioValidatedByUser,
    computeAudioValidationUpdate,
    formatTimestamp,
    audioPopoverTracker,
} from "../../../../webviews/codex-webviews/src/CodexCellEditor/validationUtils";
import { ValidationEntry } from "../../../../types";

suite("validationUtils Test Suite", () => {
    suite("isValidValidationEntry", () => {
        test("validates correct structure", () => {
            const entry: ValidationEntry = {
                username: "user1",
                creationTimestamp: Date.now(),
                updatedTimestamp: Date.now(),
                isDeleted: false,
            };
            assert.strictEqual(isValidValidationEntry(entry), true);
        });

        test("rejects invalid structures", () => {
            assert.strictEqual(isValidValidationEntry(null as any), false);
            assert.strictEqual(isValidValidationEntry(undefined as any), false);
            assert.strictEqual(isValidValidationEntry({} as any), false);
            assert.strictEqual(
                isValidValidationEntry({ username: 1, creationTimestamp: 1, updatedTimestamp: 1, isDeleted: false } as any),
                false
            );
            assert.strictEqual(
                isValidValidationEntry({ username: "u", creationTimestamp: "x", updatedTimestamp: 1, isDeleted: false } as any),
                false
            );
            assert.strictEqual(
                isValidValidationEntry({ username: "u", creationTimestamp: 1, updatedTimestamp: 1, isDeleted: "no" } as any),
                false
            );
        });
    });

    suite("getActiveAudioValidations", () => {
        test("filters out deleted and malformed entries", () => {
            const entries: any[] = [
                { username: "user1", creationTimestamp: 1, updatedTimestamp: 2, isDeleted: false },
                { username: "user2", creationTimestamp: 1, updatedTimestamp: 2, isDeleted: true },
                { username: "user3" },
                null,
            ];
            const active = getActiveAudioValidations(entries as any);
            assert.strictEqual(active.length, 1);
            assert.strictEqual(active[0].username, "user1");
        });

        test("handles undefined gracefully", () => {
            const active = getActiveAudioValidations(undefined);
            assert.deepStrictEqual(active, []);
        });
    });

    suite("isAudioValidatedByUser", () => {
        test("returns false for missing username", () => {
            const entries: ValidationEntry[] = [
                { username: "u1", creationTimestamp: 1, updatedTimestamp: 1, isDeleted: false },
            ];
            assert.strictEqual(isAudioValidatedByUser(entries, null), false);
            assert.strictEqual(isAudioValidatedByUser(entries, undefined), false);
        });

        test("detects active user validation", () => {
            const entries: ValidationEntry[] = [
                { username: "u1", creationTimestamp: 1, updatedTimestamp: 2, isDeleted: false },
                { username: "u2", creationTimestamp: 1, updatedTimestamp: 2, isDeleted: true },
            ];
            assert.strictEqual(isAudioValidatedByUser(entries, "u1"), true);
            assert.strictEqual(isAudioValidatedByUser(entries, "u2"), false);
            assert.strictEqual(isAudioValidatedByUser(entries, "u3"), false);
        });
    });

    suite("computeAudioValidationUpdate", () => {
        test("returns active validations and user state", () => {
            const entries: ValidationEntry[] = [
                { username: "me", creationTimestamp: 1, updatedTimestamp: 2, isDeleted: false },
                { username: "other", creationTimestamp: 1, updatedTimestamp: 2, isDeleted: true },
            ];
            const { isValidated, activeValidations } = computeAudioValidationUpdate(entries, "me");
            assert.strictEqual(isValidated, true);
            assert.strictEqual(activeValidations.length, 1);
            assert.strictEqual(activeValidations[0].username, "me");
        });
    });

    suite("formatTimestamp", () => {
        test("returns 'just now' for current timestamp", () => {
            const now = Date.now();
            const label = formatTimestamp(now);
            assert.strictEqual(label, "just now");
        });

        test("returns minutes ago for recent timestamps", () => {
            const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
            const label = formatTimestamp(fiveMinutesAgo);
            assert.ok(label.endsWith("m ago"));
        });

        test("returns hours ago for older same-day timestamps", () => {
            const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
            const label = formatTimestamp(twoHoursAgo);
            assert.ok(label.endsWith("h ago"));
        });

        test("returns days ago for within a week", () => {
            const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
            const label = formatTimestamp(twoDaysAgo);
            assert.ok(label.endsWith("d ago"));
        });

        test("returns locale date for >= 7 days", () => {
            const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
            const label = formatTimestamp(eightDaysAgo);
            assert.ok(typeof label === "string" && label.length > 0);
            assert.ok(!label.endsWith("ago"));
        });
    });

    suite("audioPopoverTracker", () => {
        test("tracks active popover id", () => {
            audioPopoverTracker.setActivePopover(null);
            assert.strictEqual(audioPopoverTracker.getActivePopover(), null);
            audioPopoverTracker.setActivePopover("abc");
            assert.strictEqual(audioPopoverTracker.getActivePopover(), "abc");
            audioPopoverTracker.setActivePopover("def");
            assert.strictEqual(audioPopoverTracker.getActivePopover(), "def");
            audioPopoverTracker.setActivePopover(null);
            assert.strictEqual(audioPopoverTracker.getActivePopover(), null);
        });
    });
});


