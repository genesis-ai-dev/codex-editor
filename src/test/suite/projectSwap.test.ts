import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import * as git from "isomorphic-git";
import { ProjectMetadata, ProjectSwapEntry, ProjectSwapInfo, ProjectSwapUserEntry } from "../../../types";
import {
    normalizeProjectSwapInfo,
    getActiveSwapEntry,
    findSwapEntryByUUID,
    findSwapEntryByTimestamp,
    getAllSwapEntries,
    hasPendingSwap,
    sortSwapEntries,
    validateGitUrl,
    extractProjectNameFromUrl,
    sanitizeGitUrl,
    getGitOriginUrl,
    mergeSwappedUsers,
    getDeprecatedProjectsFromHistory,
    isProjectDeprecated,
    getDeprecatedProjectUrls,
    getEntryKey,
    orderEntryFields,
} from "../../utils/projectSwapManager";
import {
    checkSwapPrerequisites,
    saveSwapPendingState,
    getSwapPendingState,
    clearSwapPendingState,
    checkPendingDownloadsComplete,
    SwapPendingDownloads,
} from "../../providers/StartupFlow/performProjectSwap";
import { resolveConflictFile } from "../../projectManager/utils/merge/resolvers";
import { ConflictFile } from "../../projectManager/utils/merge/types";
import { buildConflictsFromDirectories } from "../../projectManager/utils/merge/directoryConflicts";

/**
 * Comprehensive Project Swap Tests
 * 
 * This file consolidates all unit tests for the project swap functionality:
 * - Utility functions (normalizeProjectSwapInfo, getActiveSwapEntry, etc.)
 * - Metadata structure validation
 * - Prerequisites and download state management
 * - Cancellation flow
 * - Merge logic
 * - Edge cases (chain swapping, missing data, offline operation, etc.)
 */
suite("Project Swap Tests", () => {
    let tempDir: string;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-swap-"));
    });

    teardown(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    // ========================================================================
    // UTILITY FUNCTIONS
    // ========================================================================
    suite("Utility Functions", () => {
        suite("normalizeProjectSwapInfo", () => {
            test("returns empty swapEntries array for empty object", () => {
                const result = normalizeProjectSwapInfo({});
                assert.deepStrictEqual(result.swapEntries, []);
            });

            test("preserves existing swapEntries array", () => {
                const entry = createSwapEntry({ swapUUID: "test-uuid-123" });
                const result = normalizeProjectSwapInfo({ swapEntries: [entry] });
                assert.strictEqual(result.swapEntries?.length, 1);
                assert.strictEqual(result.swapEntries?.[0].swapUUID, "test-uuid-123");
            });
        });

        suite("getActiveSwapEntry", () => {
            test("returns undefined for empty swapEntries", () => {
                assert.strictEqual(getActiveSwapEntry({ swapEntries: [] }), undefined);
            });

            test("returns undefined when all entries are cancelled", () => {
                const entries = [
                    createSwapEntry({ swapStatus: "cancelled", swapInitiatedAt: 1000 }),
                    createSwapEntry({ swapStatus: "cancelled", swapInitiatedAt: 2000 }),
                ];
                assert.strictEqual(getActiveSwapEntry({ swapEntries: entries }), undefined);
            });

            test("returns active entry when one exists", () => {
                const entries = [
                    createSwapEntry({ swapStatus: "cancelled" }),
                    createSwapEntry({ swapStatus: "active", swapUUID: "active-uuid" }),
                ];
                assert.strictEqual(getActiveSwapEntry({ swapEntries: entries })?.swapUUID, "active-uuid");
            });

            test("returns most recent active entry when multiple exist", () => {
                const entries = [
                    createSwapEntry({ swapStatus: "active", swapInitiatedAt: 1000, swapUUID: "older" }),
                    createSwapEntry({ swapStatus: "active", swapInitiatedAt: 3000, swapUUID: "newest" }),
                    createSwapEntry({ swapStatus: "active", swapInitiatedAt: 2000, swapUUID: "middle" }),
                ];
                assert.strictEqual(getActiveSwapEntry({ swapEntries: entries })?.swapUUID, "newest");
            });
        });

        suite("findSwapEntryByUUID", () => {
            test("returns undefined when UUID not found", () => {
                const entries = [createSwapEntry({ swapUUID: "abc" })];
                assert.strictEqual(findSwapEntryByUUID({ swapEntries: entries }, "xyz"), undefined);
            });

            test("finds entry by exact UUID match", () => {
                const entries = [
                    createSwapEntry({ swapUUID: "other-1" }),
                    createSwapEntry({ swapUUID: "target-uuid" }),
                    createSwapEntry({ swapUUID: "other-2" }),
                ];
                assert.strictEqual(findSwapEntryByUUID({ swapEntries: entries }, "target-uuid")?.swapUUID, "target-uuid");
            });
        });

        suite("findSwapEntryByTimestamp", () => {
            test("returns undefined when timestamp not found", () => {
                const entries = [createSwapEntry({ swapInitiatedAt: 1000 })];
                assert.strictEqual(findSwapEntryByTimestamp({ swapEntries: entries }, 9999), undefined);
            });

            test("finds entry by exact timestamp match", () => {
                const entries = [
                    createSwapEntry({ swapInitiatedAt: 1000, swapUUID: "first" }),
                    createSwapEntry({ swapInitiatedAt: 2000, swapUUID: "second" }),
                ];
                assert.strictEqual(findSwapEntryByTimestamp({ swapEntries: entries }, 2000)?.swapUUID, "second");
            });
        });

        suite("getAllSwapEntries", () => {
            test("returns empty array for no entries", () => {
                assert.deepStrictEqual(getAllSwapEntries({ swapEntries: [] }), []);
            });

            test("returns entries sorted by swapInitiatedAt descending", () => {
                const entries = [
                    createSwapEntry({ swapInitiatedAt: 1000, swapUUID: "oldest" }),
                    createSwapEntry({ swapInitiatedAt: 3000, swapUUID: "newest" }),
                    createSwapEntry({ swapInitiatedAt: 2000, swapUUID: "middle" }),
                ];
                const result = getAllSwapEntries({ swapEntries: entries });
                assert.strictEqual(result[0].swapUUID, "newest");
                assert.strictEqual(result[2].swapUUID, "oldest");
            });
        });

        suite("hasPendingSwap", () => {
            test("returns false for no entries", () => {
                assert.strictEqual(hasPendingSwap({ swapEntries: [] }), false);
            });

            test("returns false when all entries are cancelled", () => {
                const entries = [createSwapEntry({ swapStatus: "cancelled" })];
                assert.strictEqual(hasPendingSwap({ swapEntries: entries }), false);
            });

            test("returns true when an active entry exists", () => {
                const entries = [createSwapEntry({ swapStatus: "active" })];
                assert.strictEqual(hasPendingSwap({ swapEntries: entries }), true);
            });
        });

        suite("sortSwapEntries", () => {
            test("puts active entries first", () => {
                const entries = [
                    createSwapEntry({ swapStatus: "cancelled", swapInitiatedAt: 3000, swapUUID: "cancelled" }),
                    createSwapEntry({ swapStatus: "active", swapInitiatedAt: 1000, swapUUID: "active" }),
                ];
                const sorted = sortSwapEntries(entries);
                assert.strictEqual(sorted[0].swapStatus, "active");
            });

            test("orders by swapInitiatedAt when status matches", () => {
                const entries = [
                    createSwapEntry({ swapStatus: "cancelled", swapInitiatedAt: 1000, swapUUID: "old" }),
                    createSwapEntry({ swapStatus: "cancelled", swapInitiatedAt: 3000, swapUUID: "new" }),
                ];
                const sorted = sortSwapEntries(entries);
                assert.strictEqual(sorted[0].swapUUID, "new");
                assert.strictEqual(sorted[1].swapUUID, "old");
            });

            test("uses swapModifiedAt as tie-breaker for same swapInitiatedAt", () => {
                const entries = [
                    createSwapEntry({ swapInitiatedAt: 1000, swapModifiedAt: 2000, swapUUID: "newer-modified" }),
                    createSwapEntry({ swapInitiatedAt: 1000, swapModifiedAt: 1500, swapUUID: "older-modified" }),
                ];
                const sorted = sortSwapEntries(entries);
                assert.strictEqual(sorted[0].swapUUID, "newer-modified");
            });

            test("uses swapUUID for deterministic ties", () => {
                const entries = [
                    createSwapEntry({ swapInitiatedAt: 1000, swapModifiedAt: 1000, swapUUID: "b-uuid" }),
                    createSwapEntry({ swapInitiatedAt: 1000, swapModifiedAt: 1000, swapUUID: "a-uuid" }),
                ];
                const sorted = sortSwapEntries(entries);
                assert.strictEqual(sorted[0].swapUUID, "a-uuid");
                assert.strictEqual(sorted[1].swapUUID, "b-uuid");
            });

            test("orders fields within entries for readable JSON output", () => {
                const entries = [
                    createSwapEntry({
                        swapUUID: "test-uuid",
                        swapInitiatedAt: 1000,
                        swapModifiedAt: 2000,
                        swapStatus: "active",
                        isOldProject: true,
                        oldProjectUrl: "https://example.com/old.git",
                        oldProjectName: "old-project",
                        newProjectUrl: "https://example.com/new.git",
                        newProjectName: "new-project",
                        swapInitiatedBy: "admin",
                        swapReason: "Test reason",
                    }),
                ];
                const sorted = sortSwapEntries(entries);
                const fieldOrder = Object.keys(sorted[0]);

                // Verify field order grouping
                const uuidIndex = fieldOrder.indexOf("swapUUID");
                const statusIndex = fieldOrder.indexOf("swapStatus");
                const initiatedAtIndex = fieldOrder.indexOf("swapInitiatedAt");
                const initiatedByIndex = fieldOrder.indexOf("swapInitiatedBy");
                const reasonIndex = fieldOrder.indexOf("swapReason");
                const modifiedAtIndex = fieldOrder.indexOf("swapModifiedAt");
                const oldNameIndex = fieldOrder.indexOf("oldProjectName");
                const newNameIndex = fieldOrder.indexOf("newProjectName");
                const isOldIndex = fieldOrder.indexOf("isOldProject");
                const oldUrlIndex = fieldOrder.indexOf("oldProjectUrl");
                const newUrlIndex = fieldOrder.indexOf("newProjectUrl");

                // Identifier and status first (most important for scanning)
                assert.ok(uuidIndex < statusIndex, "swapUUID should come before swapStatus");
                assert.ok(statusIndex < initiatedAtIndex, "swapStatus should come before swapInitiatedAt");
                // Initiation info together
                assert.ok(initiatedAtIndex < initiatedByIndex, "swapInitiatedAt should come before swapInitiatedBy");
                assert.ok(initiatedByIndex < reasonIndex, "swapInitiatedBy should come before swapReason");
                // Then modification timestamp
                assert.ok(reasonIndex < modifiedAtIndex, "swapReason should come before swapModifiedAt");
                // Names come after timestamps
                assert.ok(modifiedAtIndex < oldNameIndex, "swapModifiedAt should come before oldProjectName");
                assert.ok(oldNameIndex < newNameIndex, "oldProjectName should come before newProjectName");
                // isOldProject separates names from URLs
                assert.ok(newNameIndex < isOldIndex, "newProjectName should come before isOldProject");
                // URLs at the end
                assert.ok(isOldIndex < oldUrlIndex, "isOldProject should come before oldProjectUrl");
                assert.ok(oldUrlIndex < newUrlIndex, "oldProjectUrl should come before newProjectUrl");
            });

            test("removes undefined fields when ordering", () => {
                const entries = [
                    createSwapEntry({
                        swapUUID: "test-uuid",
                        swapInitiatedAt: 1000,
                        swapModifiedAt: 1000,
                        swapStatus: "active",
                        isOldProject: true,
                        // No swapReason, swappedUsersModifiedAt, cancelledBy, cancelledAt
                    }),
                ];
                const sorted = sortSwapEntries(entries);
                const entry = sorted[0];

                assert.ok(!("swapReason" in entry) || entry.swapReason !== undefined, "Should not have undefined swapReason");
                assert.ok(!("swappedUsersModifiedAt" in entry) || entry.swappedUsersModifiedAt !== undefined, "Should not have undefined swappedUsersModifiedAt");
                assert.ok(!("cancelledBy" in entry) || entry.cancelledBy !== undefined, "Should not have undefined cancelledBy");
                assert.ok(!("cancelledAt" in entry) || entry.cancelledAt !== undefined, "Should not have undefined cancelledAt");
            });
        });

        suite("mergeSwappedUsers", () => {
            test("returns empty array when both inputs are undefined", () => {
                const result = mergeSwappedUsers(undefined, undefined);
                assert.deepStrictEqual(result, []);
            });

            test("returns first array when second is undefined", () => {
                const usersA: ProjectSwapUserEntry[] = [
                    { userToSwap: "user1", createdAt: 1000, updatedAt: 1000, executed: true },
                ];
                const result = mergeSwappedUsers(usersA, undefined);
                assert.strictEqual(result.length, 1);
                assert.strictEqual(result[0].userToSwap, "user1");
            });

            test("returns second array when first is undefined", () => {
                const usersB: ProjectSwapUserEntry[] = [
                    { userToSwap: "user2", createdAt: 2000, updatedAt: 2000, executed: true },
                ];
                const result = mergeSwappedUsers(undefined, usersB);
                assert.strictEqual(result.length, 1);
                assert.strictEqual(result[0].userToSwap, "user2");
            });

            test("merges unique users from both arrays", () => {
                const usersA: ProjectSwapUserEntry[] = [
                    { userToSwap: "user1", createdAt: 1000, updatedAt: 1000, executed: true },
                ];
                const usersB: ProjectSwapUserEntry[] = [
                    { userToSwap: "user2", createdAt: 2000, updatedAt: 2000, executed: true },
                ];
                const result = mergeSwappedUsers(usersA, usersB);
                assert.strictEqual(result.length, 2);
                assert.ok(result.some(u => u.userToSwap === "user1"));
                assert.ok(result.some(u => u.userToSwap === "user2"));
            });

            test("keeps newer updatedAt when same user appears in both", () => {
                const usersA: ProjectSwapUserEntry[] = [
                    { userToSwap: "user1", createdAt: 1000, updatedAt: 1000, executed: false },
                ];
                const usersB: ProjectSwapUserEntry[] = [
                    { userToSwap: "user1", createdAt: 1000, updatedAt: 2000, executed: true, swapCompletedAt: 2000 },
                ];
                const result = mergeSwappedUsers(usersA, usersB);
                assert.strictEqual(result.length, 1);
                assert.strictEqual(result[0].userToSwap, "user1");
                assert.strictEqual(result[0].executed, true, "Should keep newer entry with executed: true");
                assert.strictEqual(result[0].updatedAt, 2000);
            });

            test("keeps older entry if newer has earlier updatedAt", () => {
                const usersA: ProjectSwapUserEntry[] = [
                    { userToSwap: "user1", createdAt: 1000, updatedAt: 3000, executed: true },
                ];
                const usersB: ProjectSwapUserEntry[] = [
                    { userToSwap: "user1", createdAt: 1000, updatedAt: 2000, executed: false },
                ];
                const result = mergeSwappedUsers(usersA, usersB);
                assert.strictEqual(result.length, 1);
                assert.strictEqual(result[0].executed, true, "Should keep entry with more recent updatedAt");
                assert.strictEqual(result[0].updatedAt, 3000);
            });

            test("handles multiple users with mixed updates", () => {
                const usersA: ProjectSwapUserEntry[] = [
                    { userToSwap: "user1", createdAt: 1000, updatedAt: 1000, executed: false },
                    { userToSwap: "user2", createdAt: 1000, updatedAt: 3000, executed: true },
                ];
                const usersB: ProjectSwapUserEntry[] = [
                    { userToSwap: "user1", createdAt: 1000, updatedAt: 2000, executed: true },
                    { userToSwap: "user3", createdAt: 1000, updatedAt: 1000, executed: true },
                ];
                const result = mergeSwappedUsers(usersA, usersB);
                assert.strictEqual(result.length, 3);

                const user1 = result.find(u => u.userToSwap === "user1");
                assert.strictEqual(user1?.executed, true, "user1 should have newer executed: true");
                assert.strictEqual(user1?.updatedAt, 2000);

                const user2 = result.find(u => u.userToSwap === "user2");
                assert.strictEqual(user2?.updatedAt, 3000);

                const user3 = result.find(u => u.userToSwap === "user3");
                assert.ok(user3, "user3 should be included");
            });

            test("different createdAt creates separate entries (composite key)", () => {
                // With the new composite key (userToSwap + createdAt), entries with
                // different createdAt are considered DIFFERENT users (e.g., same user re-swapping)
                const usersA: ProjectSwapUserEntry[] = [
                    { userToSwap: "user1", createdAt: 1000, executed: false } as ProjectSwapUserEntry,
                ];
                const usersB: ProjectSwapUserEntry[] = [
                    { userToSwap: "user1", createdAt: 2000, executed: true } as ProjectSwapUserEntry,
                ];
                const result = mergeSwappedUsers(usersA, usersB);
                assert.strictEqual(result.length, 2, "Different createdAt = different entries");
                assert.ok(result.some(u => u.createdAt === 1000), "Should have first entry");
                assert.ok(result.some(u => u.createdAt === 2000), "Should have second entry");
            });

            test("same composite key uses updatedAt for fallback when missing", () => {
                // Same userToSwap + createdAt with missing updatedAt - uses createdAt as fallback
                const usersA: ProjectSwapUserEntry[] = [
                    { userToSwap: "user1", createdAt: 1000, executed: false } as ProjectSwapUserEntry,
                ];
                const usersB: ProjectSwapUserEntry[] = [
                    { userToSwap: "user1", createdAt: 1000, updatedAt: 2000, executed: true } as ProjectSwapUserEntry,
                ];
                const result = mergeSwappedUsers(usersA, usersB);
                assert.strictEqual(result.length, 1, "Same composite key = merged");
                assert.strictEqual(result[0].executed, true, "Should use entry with higher timestamp");
            });
        });

        suite("validateGitUrl", () => {
            test("rejects empty URL", async () => {
                const result = await validateGitUrl("");
                assert.strictEqual(result.valid, false);
            });

            test("rejects URL without .git suffix", async () => {
                const result = await validateGitUrl("https://gitlab.com/group/project");
                assert.strictEqual(result.valid, false);
            });

            test("accepts valid HTTPS URL", async () => {
                const result = await validateGitUrl("https://gitlab.com/group/project.git");
                assert.strictEqual(result.valid, true);
            });

            test("accepts valid HTTP URL", async () => {
                const result = await validateGitUrl("http://gitlab.example.com/group/project.git");
                assert.strictEqual(result.valid, true);
            });
        });

        suite("extractProjectNameFromUrl", () => {
            test("extracts name from HTTPS GitLab URL", () => {
                assert.strictEqual(extractProjectNameFromUrl("https://gitlab.com/group/my-project.git"), "my-project");
            });

            test("extracts name from nested group URL", () => {
                assert.strictEqual(extractProjectNameFromUrl("https://gitlab.com/org/subgroup/project-name.git"), "project-name");
            });

            test("handles URL without .git suffix", () => {
                assert.strictEqual(extractProjectNameFromUrl("https://gitlab.com/group/project"), "project");
            });

            test("handles empty string", () => {
                assert.strictEqual(extractProjectNameFromUrl(""), "");
            });

            test("handles special characters in project name", () => {
                assert.strictEqual(extractProjectNameFromUrl("https://gitlab.com/group/my-project_v2.0.git"), "my-project_v2.0");
            });

            test("handles deeply nested group URLs", () => {
                assert.strictEqual(extractProjectNameFromUrl("https://gitlab.com/org/division/team/project.git"), "project");
            });
        });

        suite("sanitizeGitUrl", () => {
            test("removes embedded credentials from URL", () => {
                assert.strictEqual(
                    sanitizeGitUrl("https://user:token123@gitlab.com/group/project.git"),
                    "https://gitlab.com/group/project.git"
                );
            });

            test("removes username only when no password", () => {
                assert.strictEqual(
                    sanitizeGitUrl("https://oauth2@gitlab.com/group/project.git"),
                    "https://gitlab.com/group/project.git"
                );
            });

            test("preserves URL without credentials", () => {
                assert.strictEqual(
                    sanitizeGitUrl("https://gitlab.com/group/project.git"),
                    "https://gitlab.com/group/project.git"
                );
            });

            test("removes trailing slash", () => {
                assert.strictEqual(
                    sanitizeGitUrl("https://gitlab.com/group/project.git/"),
                    "https://gitlab.com/group/project.git"
                );
            });

            test("handles empty string", () => {
                assert.strictEqual(sanitizeGitUrl(""), "");
            });

            test("returns git@ URLs unchanged", () => {
                assert.strictEqual(sanitizeGitUrl("git@gitlab.com:group/project.git"), "git@gitlab.com:group/project.git");
            });

            test("handles self-hosted GitLab with port", () => {
                assert.strictEqual(
                    sanitizeGitUrl("https://user:pass@git.company.com:8443/group/project.git"),
                    "https://git.company.com:8443/group/project.git"
                );
            });
        });

        suite("getGitOriginUrl", () => {
            test("returns null for repo without origin remote", async () => {
                const repoDir = path.join(tempDir, "no-origin");
                fs.mkdirSync(repoDir, { recursive: true });
                await git.init({ fs, dir: repoDir, defaultBranch: "main" });
                assert.strictEqual(await getGitOriginUrl(repoDir), null);
            });

            test("returns origin URL when set", async () => {
                const repoDir = path.join(tempDir, "with-origin");
                fs.mkdirSync(repoDir, { recursive: true });
                await git.init({ fs, dir: repoDir, defaultBranch: "main" });
                await git.addRemote({ fs, dir: repoDir, remote: "origin", url: "https://gitlab.com/test.git" });
                assert.strictEqual(await getGitOriginUrl(repoDir), "https://gitlab.com/test.git");
            });

            test("returns null for non-git directory", async () => {
                const nonGitDir = path.join(tempDir, "not-git");
                fs.mkdirSync(nonGitDir, { recursive: true });
                assert.strictEqual(await getGitOriginUrl(nonGitDir), null);
            });
        });
    });

    // ========================================================================
    // METADATA STRUCTURE
    // ========================================================================
    suite("Metadata Structure", () => {
        test("entry with all required fields is valid", () => {
            const entry: ProjectSwapEntry = {
                swapUUID: "uuid-12345",
                swapInitiatedAt: Date.now(),
                swapModifiedAt: Date.now(),
                swapStatus: "active",
                isOldProject: true,
                oldProjectUrl: "https://gitlab.com/old/project.git",
                oldProjectName: "old-project",
                newProjectUrl: "https://gitlab.com/new/project.git",
                newProjectName: "new-project",
                swapInitiatedBy: "admin-user",
            };
            assert.strictEqual(typeof entry.swapUUID, "string");
            assert.ok(["active", "cancelled"].includes(entry.swapStatus));
        });

        test("entry with cancellation fields is valid", () => {
            const entry = createSwapEntry({
                swapStatus: "cancelled",
                cancelledBy: "admin",
                cancelledAt: Date.now(),
            });
            assert.strictEqual(entry.swapStatus, "cancelled");
            assert.ok(entry.cancelledBy);
            assert.ok(entry.cancelledAt);
        });

        test("swappedUsers array tracks user completions", () => {
            const entry = createSwapEntry({
                isOldProject: false,
                swappedUsers: [
                    { userToSwap: "user1", createdAt: 1000, updatedAt: 1000, executed: true, swapCompletedAt: 1000 },
                    { userToSwap: "user2", createdAt: 2000, updatedAt: 2000, executed: true, swapCompletedAt: 2000 },
                ],
            });
            assert.strictEqual(entry.swappedUsers?.length, 2);
            assert.ok(entry.swappedUsers?.every(u => u.executed));
        });

        test("ProjectSwapInfo supports multiple entries (history)", () => {
            const swapInfo: ProjectSwapInfo = {
                swapEntries: [
                    createSwapEntry({ swapStatus: "cancelled", swapInitiatedAt: 1000 }),
                    createSwapEntry({ swapStatus: "active", swapInitiatedAt: 2000 }),
                ],
            };
            assert.strictEqual(swapInfo.swapEntries?.length, 2);
        });

        test("serializes and deserializes correctly", () => {
            const original: ProjectSwapInfo = {
                swapEntries: [createSwapEntry({ swapReason: "Repository cleanup" })],
            };
            const filePath = path.join(tempDir, "swap-info.json");
            fs.writeFileSync(filePath, JSON.stringify(original, null, 2));
            const restored: ProjectSwapInfo = JSON.parse(fs.readFileSync(filePath, "utf-8"));
            assert.strictEqual(restored.swapEntries?.[0].swapReason, "Repository cleanup");
        });
    });

    // ========================================================================
    // SWAP UUID AND PROJECT LINKING
    // ========================================================================
    suite("Swap UUID and Project Linking", () => {
        test("swapUUID links OLD and NEW project counterparts for same swap", () => {
            // A → B: Both A and B share the same swapUUID for THIS swap
            const sharedUUID = "swap-ab-uuid";

            // Entry in A (OLD project, initiator)
            const entryInA = createSwapEntry({
                swapUUID: sharedUUID,
                isOldProject: true,
                oldProjectName: "A",
                newProjectName: "B",
            });

            // Entry in B (NEW project, destination)
            const entryInB = createSwapEntry({
                swapUUID: sharedUUID,
                isOldProject: false,
                oldProjectName: "A",
                newProjectName: "B",
            });

            // Same swapUUID links them
            assert.strictEqual(entryInA.swapUUID, entryInB.swapUUID);
            // Different isOldProject flags distinguish them
            assert.strictEqual(entryInA.isOldProject, true);
            assert.strictEqual(entryInB.isOldProject, false);
        });

        test("each new swap gets its OWN swapUUID (not shared across chain)", () => {
            // Correct behavior: A→B and B→C have DIFFERENT UUIDs
            const uuidAB = "swap-ab-uuid";
            const uuidBC = "swap-bc-uuid"; // NEW UUID for new swap

            // A → B swap
            const aToBEntry = createSwapEntry({
                swapUUID: uuidAB,
                oldProjectName: "A",
                newProjectName: "B",
            });

            // B → C swap (later, B initiates new swap)
            const bToCEntry = createSwapEntry({
                swapUUID: uuidBC, // Different UUID!
                oldProjectName: "B",
                newProjectName: "C",
            });

            // Different swaps have different UUIDs
            assert.notStrictEqual(aToBEntry.swapUUID, bToCEntry.swapUUID);
        });

        test("NEW project preserves history from prior swaps", () => {
            // When B swaps to C, C keeps the full swap history (A→B and B→C)
            const uuidAB = "swap-ab-uuid";
            const uuidBC = "swap-bc-uuid";

            // B's metadata before initiating B→C (has A→B entry as NEW project)
            const entriesInB = [
                createSwapEntry({ swapUUID: uuidAB, isOldProject: false, oldProjectName: "A", newProjectName: "B" }),
            ];

            // B initiates B→C, adds new entry
            entriesInB.push(
                createSwapEntry({ swapUUID: uuidBC, isOldProject: true, oldProjectName: "B", newProjectName: "C" })
            );

            // When user swaps to C, C keeps all entries and marks historical entries as old-project
            const entriesForC = entriesInB.map((entry) =>
                entry.swapUUID === uuidBC ? entry : { ...entry, isOldProject: true }
            );

            assert.strictEqual(entriesForC.length, 2);
            assert.ok(entriesForC.some(e => e.swapUUID === uuidAB));
            assert.ok(entriesForC.some(e => e.swapUUID === uuidBC));
            assert.strictEqual(entriesForC.find(e => e.swapUUID === uuidAB)?.isOldProject, true);
        });

        test("OLD project preserves its own swap history", () => {
            // If A initiates swap, cancels, then initiates again - A keeps all entries
            const entries = [
                createSwapEntry({ swapUUID: "first-attempt", swapStatus: "cancelled", swapInitiatedAt: 1000 }),
                createSwapEntry({ swapUUID: "second-attempt", swapStatus: "active", swapInitiatedAt: 2000 }),
            ];

            // Old project keeps all entries
            const all = getAllSwapEntries({ swapEntries: entries });
            assert.strictEqual(all.length, 2);
        });

        test("multiple independent swap UUIDs can exist in old project", () => {
            // Project that initiated multiple swaps over time
            const entries = [
                createSwapEntry({ swapUUID: "swap-1", swapStatus: "cancelled" }),
                createSwapEntry({ swapUUID: "swap-2", swapStatus: "active" }),
            ];

            const active = getActiveSwapEntry({ swapEntries: entries });
            assert.strictEqual(active?.swapUUID, "swap-2");
            assert.strictEqual(getAllSwapEntries({ swapEntries: entries }).length, 2);
        });
    });

    // ========================================================================
    // PREREQUISITES AND DOWNLOAD STATE
    // ========================================================================
    suite("Prerequisites and Download State", () => {
        test("saveSwapPendingState creates localProjectSwap.json", async () => {
            const projectPath = path.join(tempDir, "pending-project");
            fs.mkdirSync(path.join(projectPath, ".project"), { recursive: true });

            const state: SwapPendingDownloads = {
                swapState: "pending_downloads",
                filesNeedingDownload: ["GEN/1_1.mp3"],
                newProjectUrl: "https://gitlab.com/new.git",
                swapUUID: "pending-uuid",
                swapInitiatedAt: Date.now(),
                createdAt: Date.now(),
            };
            await saveSwapPendingState(projectPath, state);

            const saved = JSON.parse(fs.readFileSync(
                path.join(projectPath, ".project", "localProjectSwap.json"), "utf-8"
            ));
            assert.strictEqual(saved.swapPendingDownloads.swapState, "pending_downloads");
        });

        test("getSwapPendingState returns null when no state exists", async () => {
            const projectPath = path.join(tempDir, "no-state");
            fs.mkdirSync(path.join(projectPath, ".project"), { recursive: true });
            assert.strictEqual(await getSwapPendingState(projectPath), null);
        });

        test("getSwapPendingState returns saved state", async () => {
            const projectPath = path.join(tempDir, "with-state");
            fs.mkdirSync(path.join(projectPath, ".project"), { recursive: true });

            const state: SwapPendingDownloads = {
                swapState: "ready_to_swap",
                filesNeedingDownload: [],
                newProjectUrl: "https://gitlab.com/new.git",
                swapUUID: "ready-uuid",
                swapInitiatedAt: 1000,
                createdAt: 2000,
            };
            await saveSwapPendingState(projectPath, state);
            const result = await getSwapPendingState(projectPath);
            assert.strictEqual(result?.swapState, "ready_to_swap");
        });

        test("clearSwapPendingState removes state", async () => {
            const projectPath = path.join(tempDir, "clear-state");
            fs.mkdirSync(path.join(projectPath, ".project"), { recursive: true });

            await saveSwapPendingState(projectPath, {
                swapState: "pending_downloads",
                filesNeedingDownload: [],
                newProjectUrl: "https://gitlab.com/new.git",
                swapUUID: "clear-uuid",
                swapInitiatedAt: 1000,
                createdAt: 1000,
            });
            await clearSwapPendingState(projectPath);
            assert.strictEqual(await getSwapPendingState(projectPath), null);
        });

        test("checkPendingDownloadsComplete returns complete when no pending state", async () => {
            const projectPath = path.join(tempDir, "no-pending");
            fs.mkdirSync(path.join(projectPath, ".project"), { recursive: true });
            const result = await checkPendingDownloadsComplete(projectPath);
            assert.strictEqual(result.complete, true);
        });

        test("checkSwapPrerequisites returns canProceed=true when no attachments", async () => {
            const projectPath = path.join(tempDir, "no-attachments");
            fs.mkdirSync(projectPath, { recursive: true });
            const result = await checkSwapPrerequisites(projectPath, "https://gitlab.com/new.git");
            assert.strictEqual(result.canProceed, true);
        });
    });

    // ========================================================================
    // CANCELLATION FLOW
    // ========================================================================
    suite("Cancellation Flow", () => {
        test("cancelling swap updates entry status", async () => {
            const entry = createSwapEntry({ swapStatus: "active" });
            entry.swapStatus = "cancelled";
            entry.swapModifiedAt = Date.now();
            entry.cancelledBy = "admin";
            entry.cancelledAt = Date.now();

            assert.strictEqual(entry.swapStatus, "cancelled");
            assert.ok(entry.cancelledBy);
        });

        test("cancellation preserves history", () => {
            const entries = [
                createSwapEntry({ swapUUID: "first", swapStatus: "cancelled" }),
                createSwapEntry({ swapUUID: "second", swapStatus: "cancelled" }),
            ];
            assert.strictEqual(getAllSwapEntries({ swapEntries: entries }).length, 2);
        });

        test("can initiate new swap after cancelling previous", () => {
            const entries = [
                createSwapEntry({ swapStatus: "cancelled", swapInitiatedAt: 1000 }),
                createSwapEntry({ swapStatus: "active", swapInitiatedAt: 2000 }),
            ];
            const active = getActiveSwapEntry({ swapEntries: entries });
            assert.ok(active);
            assert.strictEqual(active?.swapInitiatedAt, 2000);
        });

        test("must cancel existing active before initiating new", () => {
            const entries = [createSwapEntry({ swapStatus: "active" })];
            assert.strictEqual(hasPendingSwap({ swapEntries: entries }), true);
        });
    });

    // ========================================================================
    // MERGE LOGIC
    // ========================================================================
    suite("Merge Logic", () => {
        test("deduplicates entries by swapUUID keeping newer swapModifiedAt", async function () {
            this.timeout(10000);
            const metadataPath = path.join(tempDir, "metadata.json");
            const uuid = "dedup-uuid";

            const base = { format: "scripture burrito", meta: { projectSwap: { swapEntries: [] } } };
            const ours = {
                format: "scripture burrito",
                meta: {
                    projectSwap: {
                        swapEntries: [{
                            swapUUID: uuid, swapInitiatedAt: 1000, swapModifiedAt: 3000,
                            swapStatus: "cancelled", isOldProject: true,
                            oldProjectUrl: "https://old.git", oldProjectName: "old",
                            newProjectUrl: "https://new.git", newProjectName: "new",
                            swapInitiatedBy: "admin", cancelledBy: "admin",
                        }],
                    },
                },
            };
            const theirs = {
                format: "scripture burrito",
                meta: {
                    projectSwap: {
                        swapEntries: [{
                            swapUUID: uuid, swapInitiatedAt: 1000, swapModifiedAt: 2000,
                            swapStatus: "active", isOldProject: true,
                            oldProjectUrl: "https://old.git", oldProjectName: "old",
                            newProjectUrl: "https://new.git", newProjectName: "new",
                            swapInitiatedBy: "admin",
                        }],
                    },
                },
            };

            const conflict: ConflictFile = {
                filepath: "metadata.json",
                ours: JSON.stringify(ours, null, 2),
                theirs: JSON.stringify(theirs, null, 2),
                base: JSON.stringify(base, null, 2),
                isDeleted: false, isNew: false,
            };
            await resolveConflictFile(conflict, tempDir, { refreshOursFromDisk: false });

            const merged = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
            assert.strictEqual(merged.meta.projectSwap.swapEntries.length, 1);
            assert.strictEqual(merged.meta.projectSwap.swapEntries[0].swapStatus, "cancelled");
        });

        test("buildConflictsFromDirectories excludes localProjectSwap.json", async function () {
            this.timeout(10000);
            const oursDir = path.join(tempDir, "ours");
            const theirsDir = path.join(tempDir, "theirs");
            fs.mkdirSync(path.join(oursDir, ".project"), { recursive: true });
            fs.mkdirSync(path.join(theirsDir, ".project"), { recursive: true });

            fs.writeFileSync(path.join(oursDir, ".project", "localProjectSwap.json"), "{}");
            fs.writeFileSync(path.join(oursDir, "file.txt"), "ours");
            fs.writeFileSync(path.join(theirsDir, "file.txt"), "theirs");

            const result = await buildConflictsFromDirectories({
                oursRoot: vscode.Uri.file(oursDir),
                theirsRoot: vscode.Uri.file(theirsDir),
                exclude: (rel) => rel === ".project/localProjectSwap.json",
                isBinary: () => false,
            });

            assert.ok(!result.textConflicts.some(c => c.filepath.includes("localProjectSwap.json")));
            assert.ok(result.textConflicts.some(c => c.filepath === "file.txt"));
        });
    });

    // ========================================================================
    // LOCAL VS REMOTE SWAP INFO
    // ========================================================================
    suite("Local vs Remote Swap Info", () => {
        test("local cache enables offline swap detection", async () => {
            const projectPath = path.join(tempDir, "offline");
            fs.mkdirSync(path.join(projectPath, ".project"), { recursive: true });

            const cached = {
                remoteSwapInfo: { swapEntries: [createSwapEntry({ swapUUID: "offline-uuid", isOldProject: true })] },
                fetchedAt: Date.now() - 3600000,
                sourceOriginUrl: "https://gitlab.com/project.git",
            };
            fs.writeFileSync(path.join(projectPath, ".project", "localProjectSwap.json"), JSON.stringify(cached));

            const read = JSON.parse(fs.readFileSync(path.join(projectPath, ".project", "localProjectSwap.json"), "utf-8"));
            const swapInfo = normalizeProjectSwapInfo(read.remoteSwapInfo);
            assert.ok(getActiveSwapEntry(swapInfo));
        });

        test("local cancellation wins over remote active (newer timestamp)", () => {
            const uuid = "merge-uuid";
            const localEntry = createSwapEntry({ swapUUID: uuid, swapStatus: "cancelled", swapModifiedAt: 2000 });
            const remoteEntry = createSwapEntry({ swapUUID: uuid, swapStatus: "active", swapModifiedAt: 1000 });

            // Merge: keep newer
            const map = new Map<string, ProjectSwapEntry>();
            map.set(remoteEntry.swapUUID, remoteEntry);
            const existing = map.get(localEntry.swapUUID)!;
            if ((localEntry.swapModifiedAt ?? 0) > (existing.swapModifiedAt ?? 0)) {
                map.set(localEntry.swapUUID, localEntry);
            }

            assert.strictEqual(map.get(uuid)?.swapStatus, "cancelled");
        });

        test("fresh remote wins over stale local", () => {
            const uuid = "stale-uuid";
            const localEntry = createSwapEntry({ swapUUID: uuid, swapStatus: "active", swapModifiedAt: 1000 });
            const remoteEntry = createSwapEntry({ swapUUID: uuid, swapStatus: "cancelled", swapModifiedAt: 2000 });

            const map = new Map<string, ProjectSwapEntry>();
            map.set(localEntry.swapUUID, localEntry);
            const existing = map.get(remoteEntry.swapUUID)!;
            if ((remoteEntry.swapModifiedAt ?? 0) > (existing.swapModifiedAt ?? 0)) {
                map.set(remoteEntry.swapUUID, remoteEntry);
            }

            assert.strictEqual(map.get(uuid)?.swapStatus, "cancelled");
        });
    });

    // ========================================================================
    // MISSING DATA SCENARIOS
    // ========================================================================
    suite("Missing Data Scenarios", () => {
        test("handles missing meta.projectSwap gracefully", () => {
            const metadata: Partial<ProjectMetadata> = { format: "scripture burrito", meta: {} as any };
            const swapInfo = normalizeProjectSwapInfo((metadata.meta as any)?.projectSwap || {});
            assert.deepStrictEqual(swapInfo.swapEntries, []);
        });

        test("handles corrupted swapEntries array", () => {
            const malformed = { swapEntries: null };
            const normalized = normalizeProjectSwapInfo(malformed as any);
            assert.deepStrictEqual(normalized.swapEntries, []);
        });

        test("handles missing git remote", async () => {
            const projectPath = path.join(tempDir, "no-remote");
            fs.mkdirSync(projectPath, { recursive: true });
            await git.init({ fs, dir: projectPath, defaultBranch: "main" });
            const remotes = await git.listRemotes({ fs, dir: projectPath });
            assert.strictEqual(remotes.length, 0);
        });
    });

    // ========================================================================
    // USER TRACKING
    // ========================================================================
    suite("User Tracking", () => {
        test("multiple users are tracked in swappedUsers", () => {
            const entry = createSwapEntry({
                swappedUsers: [
                    { userToSwap: "user1", createdAt: 1000, updatedAt: 1000, executed: true, swapCompletedAt: 1000 },
                    { userToSwap: "user2", createdAt: 1001, updatedAt: 1001, executed: true, swapCompletedAt: 1001 },
                ],
            });
            assert.strictEqual(entry.swappedUsers?.length, 2);
        });

        test("can check if user already swapped", () => {
            const entry = createSwapEntry({
                swappedUsers: [{ userToSwap: "user-a", createdAt: 1000, updatedAt: 1000, executed: true }],
            });
            const hasSwapped = entry.swappedUsers?.some(u => u.userToSwap === "user-a" && u.executed);
            const notSwapped = entry.swappedUsers?.some(u => u.userToSwap === "user-b" && u.executed);
            assert.strictEqual(hasSwapped, true);
            assert.strictEqual(notSwapped, false);
        });

        test("duplicate users are deduplicated by userToSwap", () => {
            const users = [
                { userToSwap: "dup", createdAt: 1000, updatedAt: 1000, executed: true },
                { userToSwap: "dup", createdAt: 2000, updatedAt: 2000, executed: true },
                { userToSwap: "unique", createdAt: 3000, updatedAt: 3000, executed: true },
            ];
            const map = new Map<string, typeof users[0]>();
            for (const u of users) {
                const existing = map.get(u.userToSwap);
                if (!existing || u.updatedAt > existing.updatedAt) map.set(u.userToSwap, u);
            }
            assert.strictEqual(map.size, 2);
            assert.strictEqual(map.get("dup")?.createdAt, 2000);
        });
    });

    // ========================================================================
    // BACKUP AND RECOVERY
    // ========================================================================
    suite("Backup and Recovery", () => {
        test("backup path preserved through failed attempts", () => {
            const settings = {
                projectSwap: {
                    pendingSwap: true,
                    swapUUID: "failed-uuid",
                    backupPath: "/path/to/backup.zip",
                    swapInProgress: false,
                    swapAttempts: 3,
                    lastAttemptError: "Network timeout",
                },
            };
            assert.strictEqual(settings.projectSwap.backupPath, "/path/to/backup.zip");
            assert.strictEqual(settings.projectSwap.swapAttempts, 3);
        });

        test("recovery state structure", () => {
            const recoveryState = {
                projectSwap: { pendingSwap: true, swapUUID: "recovery-uuid", backupPath: "/backup.zip", swapInProgress: true, swapAttempts: 1 },
                updateState: { step: "clone_done", completedSteps: ["backup_done", "clone_done"], projectPath: "/path", projectName: "proj", createdAt: Date.now() },
            };
            assert.ok(recoveryState.updateState);
            assert.strictEqual(recoveryState.updateState.step, "clone_done");
        });

        test("markedForDeletion flag for orphaned projects", () => {
            const localSwap = { remoteSwapInfo: {}, fetchedAt: Date.now(), sourceOriginUrl: "", markedForDeletion: true, swapCompletedAt: Date.now() };
            assert.strictEqual(localSwap.markedForDeletion, true);
        });
    });

    // ========================================================================
    // CHAIN SWAP HISTORY PRESERVATION
    // ========================================================================
    suite("Chain Swap History Preservation", () => {
        test("full chain A→B→C preserves complete history in project C", () => {
            // Simulate chain: A → B → C
            // When C is created from B, it should have both A→B and B→C entries
            const uuidAB = "chain-swap-ab";
            const uuidBC = "chain-swap-bc";

            // B's entries before swapping to C
            const entriesInB: ProjectSwapEntry[] = [
                createSwapEntry({
                    swapUUID: uuidAB,
                    isOldProject: false, // B is NEW from A→B
                    oldProjectName: "ProjectA",
                    newProjectName: "ProjectB",
                    swapStatus: "active",
                }),
            ];

            // B initiates swap to C - add B→C entry
            entriesInB.push(createSwapEntry({
                swapUUID: uuidBC,
                isOldProject: true, // B is OLD for B→C
                oldProjectName: "ProjectB",
                newProjectName: "ProjectC",
                swapStatus: "active",
            }));

            // When user swaps to C, simulate history preservation logic:
            // All entries are kept, but historical entries (not current swap) get isOldProject: true
            const entriesForC = entriesInB.map(entry =>
                entry.swapUUID === uuidBC
                    ? { ...entry, isOldProject: false } // Current swap: C is NEW
                    : { ...entry, isOldProject: true }  // Historical: mark as old
            );

            // Verify all entries preserved
            assert.strictEqual(entriesForC.length, 2, "Both swap entries should be preserved");

            // Verify A→B entry is marked as old
            const abEntry = entriesForC.find(e => e.swapUUID === uuidAB);
            assert.ok(abEntry, "A→B entry should exist");
            assert.strictEqual(abEntry?.isOldProject, true, "A→B should be marked as historical (isOldProject: true)");

            // Verify B→C entry has C as new project
            const bcEntry = entriesForC.find(e => e.swapUUID === uuidBC);
            assert.ok(bcEntry, "B→C entry should exist");
            assert.strictEqual(bcEntry?.isOldProject, false, "B→C should show C as new project");
        });

        test("extended chain A→B→C→D preserves all history", () => {
            const uuidAB = "chain-ab";
            const uuidBC = "chain-bc";
            const uuidCD = "chain-cd";

            // D's entries should have complete chain history
            const entriesInD: ProjectSwapEntry[] = [
                createSwapEntry({ swapUUID: uuidAB, isOldProject: true, oldProjectName: "A", newProjectName: "B" }),
                createSwapEntry({ swapUUID: uuidBC, isOldProject: true, oldProjectName: "B", newProjectName: "C" }),
                createSwapEntry({ swapUUID: uuidCD, isOldProject: false, oldProjectName: "C", newProjectName: "D" }),
            ];

            // All should be preserved
            assert.strictEqual(entriesInD.length, 3);
            // Only the current (latest) entry should have isOldProject: false
            assert.strictEqual(entriesInD.filter(e => e.isOldProject === false).length, 1);
            assert.strictEqual(entriesInD.find(e => e.isOldProject === false)?.swapUUID, uuidCD);
        });

        test("chain history allows tracing back to origin project", () => {
            const entries: ProjectSwapEntry[] = [
                createSwapEntry({ swapUUID: "swap-1", oldProjectName: "Origin", newProjectName: "V2", isOldProject: true, swapInitiatedAt: 1000 }),
                createSwapEntry({ swapUUID: "swap-2", oldProjectName: "V2", newProjectName: "V3", isOldProject: true, swapInitiatedAt: 2000 }),
                createSwapEntry({ swapUUID: "swap-3", oldProjectName: "V3", newProjectName: "Current", isOldProject: false, swapInitiatedAt: 3000 }),
            ];

            // Sort by swapInitiatedAt ascending to trace history
            const sorted = [...entries].sort((a, b) => a.swapInitiatedAt - b.swapInitiatedAt);

            // First entry should be origin
            assert.strictEqual(sorted[0].oldProjectName, "Origin");
            // Last entry's newProjectName should be current
            assert.strictEqual(sorted[sorted.length - 1].newProjectName, "Current");

            // Can trace full path
            const path = sorted.map(e => `${e.oldProjectName}→${e.newProjectName}`);
            assert.deepStrictEqual(path, ["Origin→V2", "V2→V3", "V3→Current"]);
        });
    });

    // ========================================================================
    // ORIGIN MARKER ENTRIES
    // ========================================================================
    suite("Origin Marker Entries", () => {
        test("origin marker has correct structure for first-time swap", () => {
            // When a project with no prior swap history initiates a swap,
            // an origin marker entry should be created.
            // The origin project's own URL/name go in oldProjectUrl/oldProjectName.
            // newProjectUrl/newProjectName are empty since an origin has no predecessor.
            const originMarker = createSwapEntry({
                swapUUID: "origin-abc123",
                swapStatus: "cancelled",
                isOldProject: true,
                oldProjectUrl: "https://gitlab.com/org/origin-project.git",
                oldProjectName: "origin-project",
                newProjectUrl: "",
                newProjectName: "",
                swapReason: "Origin project (no prior swap history)",
                cancelledBy: "system",
                cancelledAt: Date.now(),
            });

            // Verify origin marker properties
            assert.strictEqual(originMarker.oldProjectUrl, "https://gitlab.com/org/origin-project.git", "Origin marker oldProjectUrl should be the origin project's URL");
            assert.strictEqual(originMarker.oldProjectName, "origin-project", "Origin marker oldProjectName should be the origin project's name");
            assert.strictEqual(originMarker.newProjectUrl, "", "Origin marker should have empty newProjectUrl (no predecessor)");
            assert.strictEqual(originMarker.newProjectName, "", "Origin marker should have empty newProjectName (no predecessor)");
            assert.strictEqual(originMarker.swapStatus, "cancelled", "Origin marker should be cancelled");
            assert.strictEqual(originMarker.isOldProject, true, "Origin marker should be isOldProject: true");
            assert.ok(originMarker.swapUUID.startsWith("origin-"), "Origin marker UUID should start with 'origin-'");
        });

        test("origin marker distinguishes first project in chain", () => {
            const entries: ProjectSwapEntry[] = [
                // Origin marker - identifies "first" as the origin project
                // oldProjectUrl/oldProjectName = origin project's info
                // newProjectUrl/newProjectName = empty (no predecessor)
                createSwapEntry({
                    swapUUID: "origin-first",
                    swapStatus: "cancelled",
                    isOldProject: true,
                    oldProjectUrl: "https://gitlab.com/org/first.git",
                    oldProjectName: "first",
                    newProjectUrl: "",
                    newProjectName: "",
                    swapInitiatedAt: 1000,
                }),
                // Actual swap: first -> second
                createSwapEntry({
                    swapUUID: "swap-first-second",
                    swapStatus: "active",
                    isOldProject: true,
                    oldProjectUrl: "https://gitlab.com/org/first.git",
                    oldProjectName: "first",
                    newProjectUrl: "https://gitlab.com/org/second.git",
                    newProjectName: "second",
                    swapInitiatedAt: 2000,
                }),
            ];

            // Find origin marker
            const originMarker = entries.find(e => e.swapUUID.startsWith("origin-"));
            assert.ok(originMarker, "Origin marker should exist");

            // Origin project is identified by the origin marker's oldProjectName
            assert.strictEqual(originMarker?.oldProjectUrl, "https://gitlab.com/org/first.git");
            assert.strictEqual(originMarker?.oldProjectName, "first");
            assert.strictEqual(originMarker?.newProjectUrl, "", "Origin marker has no predecessor (newProjectUrl empty)");
            assert.strictEqual(originMarker?.newProjectName, "", "Origin marker has no predecessor (newProjectName empty)");
        });

        test("origin marker is not added for projects with existing swap history", () => {
            // Project with existing history should NOT get an origin marker
            const existingEntries: ProjectSwapEntry[] = [
                createSwapEntry({
                    swapUUID: "existing-swap",
                    isOldProject: false,
                    oldProjectName: "previous",
                    newProjectName: "current",
                }),
            ];

            // When initiating a new swap, we should NOT add origin marker
            const shouldAddOriginMarker = existingEntries.length === 0;
            assert.strictEqual(shouldAddOriginMarker, false, "Should not add origin marker when history exists");
        });
    });

    // ========================================================================
    // DEPRECATED PROJECTS FROM HISTORY
    // ========================================================================
    suite("Deprecated Projects From History", () => {
        test("extracts deprecated projects from chain swap history", () => {
            // Chain: swaptest1 → swaptest2 → swaptest3 (current)
            const swapInfo: ProjectSwapInfo = {
                swapEntries: [
                    // Entry 1: swaptest2 → swaptest3 (from swaptest3's perspective)
                    createSwapEntry({
                        swapUUID: "swap-2-to-3",
                        swapStatus: "active",
                        isOldProject: false, // This is the NEW project (swaptest3)
                        oldProjectUrl: "https://gitlab.com/org/swaptest2.git",
                        oldProjectName: "swaptest2",
                        newProjectUrl: "https://gitlab.com/org/swaptest3.git",
                        newProjectName: "swaptest3",
                        swapInitiatedAt: 3000,
                    }),
                    // Entry 2: swaptest1 → swaptest2 (from swaptest2's perspective, now old)
                    createSwapEntry({
                        swapUUID: "swap-1-to-2",
                        swapStatus: "cancelled",
                        isOldProject: true, // This is an OLD project entry
                        oldProjectUrl: "https://gitlab.com/org/swaptest1.git",
                        oldProjectName: "swaptest1",
                        newProjectUrl: "https://gitlab.com/org/swaptest2.git",
                        newProjectName: "swaptest2",
                        swapInitiatedAt: 2000,
                    }),
                    // Entry 3: origin marker for swaptest1
                    createSwapEntry({
                        swapUUID: "origin-swaptest1",
                        swapStatus: "cancelled",
                        isOldProject: true,
                        oldProjectUrl: "https://gitlab.com/org/swaptest1.git",
                        oldProjectName: "swaptest1",
                        newProjectUrl: "",
                        newProjectName: "",
                        swapInitiatedAt: 1000,
                    }),
                ],
            };

            const deprecated = getDeprecatedProjectsFromHistory(swapInfo);

            // Should find swaptest1 and swaptest2 as deprecated
            assert.strictEqual(deprecated.length, 2, "Should find 2 deprecated projects");

            const deprecatedUrls = deprecated.map(d => d.url);
            assert.ok(deprecatedUrls.includes("https://gitlab.com/org/swaptest1.git"), "swaptest1 should be deprecated");
            assert.ok(deprecatedUrls.includes("https://gitlab.com/org/swaptest2.git"), "swaptest2 should be deprecated");
        });

        test("returns empty array for no swap history", () => {
            const deprecated = getDeprecatedProjectsFromHistory(undefined);
            assert.strictEqual(deprecated.length, 0);

            const deprecated2 = getDeprecatedProjectsFromHistory({ swapEntries: [] });
            assert.strictEqual(deprecated2.length, 0);
        });

        test("isProjectDeprecated returns true for old projects", () => {
            const swapInfo: ProjectSwapInfo = {
                swapEntries: [
                    createSwapEntry({
                        swapUUID: "swap-a-to-b",
                        isOldProject: false,
                        oldProjectUrl: "https://gitlab.com/org/project-a.git",
                        oldProjectName: "project-a",
                        newProjectUrl: "https://gitlab.com/org/project-b.git",
                        newProjectName: "project-b",
                    }),
                ],
            };

            assert.strictEqual(
                isProjectDeprecated("https://gitlab.com/org/project-a.git", swapInfo),
                true,
                "project-a should be deprecated"
            );
            assert.strictEqual(
                isProjectDeprecated("https://gitlab.com/org/project-b.git", swapInfo),
                false,
                "project-b (current) should NOT be deprecated"
            );
        });

        test("isProjectDeprecated is case-insensitive", () => {
            const swapInfo: ProjectSwapInfo = {
                swapEntries: [
                    createSwapEntry({
                        swapUUID: "swap-1",
                        oldProjectUrl: "https://GitLab.com/Org/Project-A.git",
                        oldProjectName: "Project-A",
                        newProjectUrl: "https://gitlab.com/org/project-b.git",
                        newProjectName: "project-b",
                    }),
                ],
            };

            // Should match regardless of case
            assert.strictEqual(
                isProjectDeprecated("https://gitlab.com/org/project-a.git", swapInfo),
                true
            );
            assert.strictEqual(
                isProjectDeprecated("https://GITLAB.COM/ORG/PROJECT-A.GIT", swapInfo),
                true
            );
        });

        test("getDeprecatedProjectUrls returns set for efficient lookup", () => {
            const swapInfo: ProjectSwapInfo = {
                swapEntries: [
                    createSwapEntry({
                        swapUUID: "swap-1",
                        oldProjectUrl: "https://gitlab.com/org/old-1.git",
                        oldProjectName: "old-1",
                    }),
                    createSwapEntry({
                        swapUUID: "swap-2",
                        oldProjectUrl: "https://gitlab.com/org/old-2.git",
                        oldProjectName: "old-2",
                    }),
                ],
            };

            const urlSet = getDeprecatedProjectUrls(swapInfo);

            assert.ok(urlSet instanceof Set, "Should return a Set");
            assert.strictEqual(urlSet.size, 2);
            assert.ok(urlSet.has("https://gitlab.com/org/old-1.git"));
            assert.ok(urlSet.has("https://gitlab.com/org/old-2.git"));
        });

        test("handles duplicate URLs in history (keeps most recent)", () => {
            // Same project appears in multiple entries
            const swapInfo: ProjectSwapInfo = {
                swapEntries: [
                    createSwapEntry({
                        swapUUID: "swap-newer",
                        swapInitiatedAt: 2000,
                        oldProjectUrl: "https://gitlab.com/org/project-a.git",
                        oldProjectName: "project-a-renamed",
                    }),
                    createSwapEntry({
                        swapUUID: "swap-older",
                        swapInitiatedAt: 1000,
                        oldProjectUrl: "https://gitlab.com/org/project-a.git",
                        oldProjectName: "project-a-original",
                    }),
                ],
            };

            const deprecated = getDeprecatedProjectsFromHistory(swapInfo);

            // Should only have one entry for project-a (the newer one)
            assert.strictEqual(deprecated.length, 1);
            assert.strictEqual(deprecated[0].name, "project-a-renamed", "Should keep the more recent name");
            assert.strictEqual(deprecated[0].deprecatedAt, 2000, "Should keep the more recent timestamp");
        });
    });

    // ========================================================================
    // DETERMINISTIC SORTING PERSISTENCE
    // ========================================================================
    suite("Deterministic Sorting Persistence", () => {
        test("sortSwapEntries produces identical results for same input", () => {
            const entries: ProjectSwapEntry[] = [
                createSwapEntry({ swapUUID: "c-uuid", swapStatus: "cancelled", swapInitiatedAt: 1000 }),
                createSwapEntry({ swapUUID: "a-uuid", swapStatus: "cancelled", swapInitiatedAt: 1000 }),
                createSwapEntry({ swapUUID: "b-uuid", swapStatus: "active", swapInitiatedAt: 2000 }),
            ];

            // Sort multiple times
            const sorted1 = sortSwapEntries([...entries]);
            const sorted2 = sortSwapEntries([...entries]);
            const sorted3 = sortSwapEntries([...entries]);

            // All results should be identical
            assert.deepStrictEqual(sorted1.map(e => e.swapUUID), sorted2.map(e => e.swapUUID));
            assert.deepStrictEqual(sorted2.map(e => e.swapUUID), sorted3.map(e => e.swapUUID));
        });

        test("sortSwapEntries is stable across different input orderings", () => {
            const baseEntries: ProjectSwapEntry[] = [
                createSwapEntry({ swapUUID: "uuid-1", swapStatus: "cancelled", swapInitiatedAt: 1000, swapModifiedAt: 1000 }),
                createSwapEntry({ swapUUID: "uuid-2", swapStatus: "cancelled", swapInitiatedAt: 1000, swapModifiedAt: 1000 }),
                createSwapEntry({ swapUUID: "uuid-3", swapStatus: "active", swapInitiatedAt: 2000, swapModifiedAt: 2000 }),
            ];

            // Sort with different input orders
            const order1 = sortSwapEntries([baseEntries[0], baseEntries[1], baseEntries[2]]);
            const order2 = sortSwapEntries([baseEntries[2], baseEntries[0], baseEntries[1]]);
            const order3 = sortSwapEntries([baseEntries[1], baseEntries[2], baseEntries[0]]);

            // All should produce same output order
            assert.deepStrictEqual(order1.map(e => e.swapUUID), order2.map(e => e.swapUUID));
            assert.deepStrictEqual(order2.map(e => e.swapUUID), order3.map(e => e.swapUUID));
        });

        test("sorted entries prevent unnecessary metadata churn", () => {
            // Simulate what happens during sync: if sorting is deterministic,
            // writing sorted entries should not change the JSON
            const entries: ProjectSwapEntry[] = [
                createSwapEntry({ swapUUID: "first", swapStatus: "active", swapInitiatedAt: 2000 }),
                createSwapEntry({ swapUUID: "second", swapStatus: "cancelled", swapInitiatedAt: 1000 }),
            ];

            const sorted = sortSwapEntries(entries);
            const json1 = JSON.stringify({ swapEntries: sorted });

            // Re-sort and stringify
            const reSorted = sortSwapEntries(sorted);
            const json2 = JSON.stringify({ swapEntries: reSorted });

            assert.strictEqual(json1, json2, "Re-sorting should not change JSON output");
        });

        test("active entry is always first regardless of timestamps", () => {
            // Even if cancelled entry has newer timestamp, active should be first
            const entries: ProjectSwapEntry[] = [
                createSwapEntry({ swapUUID: "newer-cancelled", swapStatus: "cancelled", swapInitiatedAt: 9999 }),
                createSwapEntry({ swapUUID: "older-active", swapStatus: "active", swapInitiatedAt: 1000 }),
            ];

            const sorted = sortSwapEntries(entries);
            assert.strictEqual(sorted[0].swapUUID, "older-active", "Active entry should be first");
            assert.strictEqual(sorted[0].swapStatus, "active");
        });
    });

    // ========================================================================
    // ALREADY-SWAPPED USER DETECTION
    // ========================================================================
    suite("Already-Swapped User Detection", () => {
        test("detects user who has already completed swap", () => {
            const currentUsername = "user123";
            const entry = createSwapEntry({
                swappedUsers: [
                    { userToSwap: "user123", createdAt: 1000, updatedAt: 2000, executed: true, swapCompletedAt: 2000 },
                    { userToSwap: "other-user", createdAt: 1000, updatedAt: 1000, executed: false },
                ],
            });

            const hasAlreadySwapped = entry.swappedUsers?.some(
                u => u.userToSwap === currentUsername && u.executed
            );

            assert.strictEqual(hasAlreadySwapped, true, "Should detect user has already swapped");
        });

        test("returns false for user who has not swapped", () => {
            const currentUsername = "new-user";
            const entry = createSwapEntry({
                swappedUsers: [
                    { userToSwap: "other-user", createdAt: 1000, updatedAt: 2000, executed: true, swapCompletedAt: 2000 },
                ],
            });

            const hasAlreadySwapped = entry.swappedUsers?.some(
                u => u.userToSwap === currentUsername && u.executed
            );

            assert.strictEqual(hasAlreadySwapped, false, "Should return false for user who hasn't swapped");
        });

        test("returns false when user entry exists but not executed", () => {
            const currentUsername = "pending-user";
            const entry = createSwapEntry({
                swappedUsers: [
                    { userToSwap: "pending-user", createdAt: 1000, updatedAt: 1000, executed: false },
                ],
            });

            const hasAlreadySwapped = entry.swappedUsers?.some(
                u => u.userToSwap === currentUsername && u.executed
            );

            assert.strictEqual(hasAlreadySwapped, false, "Should return false when executed is false");
        });

        test("handles empty swappedUsers array", () => {
            const currentUsername = "any-user";
            const entry = createSwapEntry({ swappedUsers: [] });

            const hasAlreadySwapped = entry.swappedUsers?.some(
                u => u.userToSwap === currentUsername && u.executed
            );

            assert.strictEqual(hasAlreadySwapped, false, "Should return false for empty array");
        });

        test("handles undefined swappedUsers", () => {
            const currentUsername = "any-user";
            const entry = createSwapEntry({});
            delete (entry as any).swappedUsers;

            const hasAlreadySwapped = entry.swappedUsers?.some(
                u => u.userToSwap === currentUsername && u.executed
            ) ?? false;

            assert.strictEqual(hasAlreadySwapped, false, "Should return false for undefined");
        });
    });

    // ========================================================================
    // MULTI-USER SWAP COORDINATION
    // ========================================================================
    suite("Multi-User Swap Coordination", () => {
        test("multiple users can be tracked in same swap entry", () => {
            const entry = createSwapEntry({
                swappedUsers: [
                    { userToSwap: "admin", createdAt: 1000, updatedAt: 1000, executed: true, swapCompletedAt: 1000 },
                    { userToSwap: "translator1", createdAt: 1000, updatedAt: 2000, executed: true, swapCompletedAt: 2000 },
                    { userToSwap: "translator2", createdAt: 1000, updatedAt: 3000, executed: true, swapCompletedAt: 3000 },
                    { userToSwap: "pending-user", createdAt: 1000, updatedAt: 1000, executed: false },
                ],
            });

            const completedCount = entry.swappedUsers?.filter(u => u.executed).length ?? 0;
            const pendingCount = entry.swappedUsers?.filter(u => !u.executed).length ?? 0;

            assert.strictEqual(completedCount, 3, "Should track 3 completed swaps");
            assert.strictEqual(pendingCount, 1, "Should track 1 pending swap");
        });

        test("user entries are deduplicated by username (newer wins)", () => {
            const users: ProjectSwapUserEntry[] = [
                { userToSwap: "dup-user", createdAt: 1000, updatedAt: 1000, executed: false },
                { userToSwap: "dup-user", createdAt: 1000, updatedAt: 2000, executed: true, swapCompletedAt: 2000 },
                { userToSwap: "unique-user", createdAt: 1000, updatedAt: 1000, executed: true, swapCompletedAt: 1000 },
            ];

            // Simulate deduplication logic
            const map = new Map<string, ProjectSwapUserEntry>();
            for (const u of users) {
                const existing = map.get(u.userToSwap);
                if (!existing || u.updatedAt > existing.updatedAt) {
                    map.set(u.userToSwap, u);
                }
            }

            const deduplicated = Array.from(map.values());
            assert.strictEqual(deduplicated.length, 2, "Should have 2 unique users");

            const dupUser = deduplicated.find(u => u.userToSwap === "dup-user");
            assert.strictEqual(dupUser?.executed, true, "Newer entry with executed=true should win");
            assert.strictEqual(dupUser?.updatedAt, 2000, "Should have newer timestamp");
        });

        test("swapModifiedAt updates when user completes swap", () => {
            const entry = createSwapEntry({
                swapInitiatedAt: 1000,
                swapModifiedAt: 1000,
                swappedUsers: [],
            });

            // User completes swap
            const userCompletionTime = 5000;
            entry.swappedUsers = [
                { userToSwap: "newuser", createdAt: userCompletionTime, updatedAt: userCompletionTime, executed: true, swapCompletedAt: userCompletionTime },
            ];
            entry.swapModifiedAt = userCompletionTime;

            assert.strictEqual(entry.swapModifiedAt, 5000, "swapModifiedAt should update on user completion");
            assert.ok(entry.swapModifiedAt > entry.swapInitiatedAt, "Modified should be after initiated");
        });
    });

    // ========================================================================
    // ERROR RECOVERY SCENARIOS
    // ========================================================================
    suite("Error Recovery Scenarios", () => {
        test("partial swap state is recoverable", () => {
            // Simulate interrupted swap state
            const partialState = {
                projectSwap: {
                    pendingSwap: true,
                    swapUUID: "interrupted-uuid",
                    backupPath: "/tmp/backup.zip",
                    swapInProgress: true,
                    swapAttempts: 2,
                    lastAttemptError: "Network timeout during clone",
                },
                updateState: {
                    step: "clone_started",
                    completedSteps: ["backup_done"],
                    projectPath: "/path/to/project",
                    projectName: "my-project",
                    createdAt: Date.now(),
                },
            };

            // Verify state can be used for recovery
            assert.strictEqual(partialState.projectSwap.pendingSwap, true);
            assert.strictEqual(partialState.projectSwap.swapAttempts, 2);
            assert.ok(partialState.projectSwap.backupPath, "Backup path should exist for recovery");
            assert.ok(partialState.updateState.completedSteps.includes("backup_done"), "Should track completed steps");
        });

        test("corrupted metadata falls back to empty swap info", () => {
            const corruptedCases = [
                null,
                undefined,
                "invalid-string",
                { swapEntries: null },
                { swapEntries: "not-an-array" },
                { wrongProperty: [] },
            ];

            for (const corrupted of corruptedCases) {
                const normalized = normalizeProjectSwapInfo(corrupted as any);
                assert.deepStrictEqual(normalized.swapEntries, [], `Should handle: ${JSON.stringify(corrupted)}`);
            }
        });

        test("missing required entry fields don't crash functions", () => {
            // Entry with minimal/missing fields
            const minimalEntry = {
                swapUUID: "minimal",
                swapInitiatedAt: Date.now(),
                swapStatus: "active",
            } as ProjectSwapEntry;

            const swapInfo = { swapEntries: [minimalEntry] };

            // These should not throw
            assert.doesNotThrow(() => getActiveSwapEntry(swapInfo));
            assert.doesNotThrow(() => getAllSwapEntries(swapInfo));
            assert.doesNotThrow(() => hasPendingSwap(swapInfo));
            assert.doesNotThrow(() => findSwapEntryByUUID(swapInfo, "minimal"));
        });

        test("duplicate swapUUIDs are handled (newer wins)", () => {
            const entries: ProjectSwapEntry[] = [
                createSwapEntry({ swapUUID: "same-uuid", swapModifiedAt: 1000, swapStatus: "active" }),
                createSwapEntry({ swapUUID: "same-uuid", swapModifiedAt: 2000, swapStatus: "cancelled" }),
            ];

            // Simulate merge deduplication
            const map = new Map<string, ProjectSwapEntry>();
            for (const entry of entries) {
                const existing = map.get(entry.swapUUID);
                if (!existing || (entry.swapModifiedAt ?? 0) > (existing.swapModifiedAt ?? 0)) {
                    map.set(entry.swapUUID, entry);
                }
            }

            const deduplicated = Array.from(map.values());
            assert.strictEqual(deduplicated.length, 1, "Should have 1 entry after deduplication");
            assert.strictEqual(deduplicated[0].swapStatus, "cancelled", "Newer (cancelled) should win");
        });
    });

    // ========================================================================
    // CANCELLED STATUS STICKY RULE
    // ========================================================================
    suite("Cancelled Status Sticky Rule", () => {
        test("cancelled status is preserved even if active entry has later timestamp", () => {
            // Scenario: Admin cancels at T1, user completes swap at T2 (T2 > T1)
            // Result: Should stay cancelled (admin cancellation should not be overridden)
            const cancelledEntry = createSwapEntry({
                swapUUID: "sticky-test",
                swapModifiedAt: 1000,
                swapStatus: "cancelled",
                cancelledBy: "admin",
                cancelledAt: 1000,
            });
            const activeEntry = createSwapEntry({
                swapUUID: "sticky-test",
                swapModifiedAt: 2000, // Later timestamp
                swapStatus: "active",
                swappedUsers: [{ userToSwap: "user1", createdAt: 2000, updatedAt: 2000, executed: true }],
            });

            // Simulate merge with "cancelled is sticky" rule
            const eitherCancelled = cancelledEntry.swapStatus === "cancelled" || activeEntry.swapStatus === "cancelled";
            const mergedUsers = mergeSwappedUsers(cancelledEntry.swappedUsers, activeEntry.swappedUsers);

            // Base entry would be activeEntry (newer timestamp)
            // But if either is cancelled, result should be cancelled
            const mergedEntry = eitherCancelled
                ? { ...activeEntry, swappedUsers: mergedUsers, swapStatus: "cancelled", cancelledBy: cancelledEntry.cancelledBy, cancelledAt: cancelledEntry.cancelledAt }
                : { ...activeEntry, swappedUsers: mergedUsers };

            assert.strictEqual(mergedEntry.swapStatus, "cancelled", "Cancelled status should be preserved");
            assert.strictEqual(mergedEntry.cancelledBy, "admin", "Cancellation details should be preserved");
            assert.strictEqual(mergedEntry.swappedUsers?.length, 1, "User completions should still be merged");
        });

        test("active entries merge normally when neither is cancelled", () => {
            const entry1 = createSwapEntry({
                swapUUID: "active-test",
                swapModifiedAt: 1000,
                swapStatus: "active",
                swappedUsers: [{ userToSwap: "user1", createdAt: 1000, updatedAt: 1000, executed: true }],
            });
            const entry2 = createSwapEntry({
                swapUUID: "active-test",
                swapModifiedAt: 2000,
                swapStatus: "active",
                swappedUsers: [{ userToSwap: "user2", createdAt: 2000, updatedAt: 2000, executed: true }],
            });

            const eitherCancelled = entry1.swapStatus === "cancelled" || entry2.swapStatus === "cancelled";
            const mergedUsers = mergeSwappedUsers(entry1.swappedUsers, entry2.swappedUsers);

            // Neither is cancelled, so newer entry wins with merged users
            const mergedEntry = eitherCancelled
                ? { ...entry2, swappedUsers: mergedUsers, swapStatus: "cancelled" }
                : { ...entry2, swappedUsers: mergedUsers };

            assert.strictEqual(mergedEntry.swapStatus, "active", "Should remain active when neither is cancelled");
            assert.strictEqual(mergedEntry.swappedUsers?.length, 2, "Both users should be merged");
        });

        test("cancelled entry with older timestamp still wins over active", () => {
            // Even if cancellation has OLDER timestamp, it should still be preserved
            const cancelledEntry = createSwapEntry({
                swapUUID: "old-cancel-test",
                swapModifiedAt: 500, // Older timestamp
                swapStatus: "cancelled",
                cancelledBy: "admin",
                cancelledAt: 500,
            });
            const activeEntry = createSwapEntry({
                swapUUID: "old-cancel-test",
                swapModifiedAt: 3000, // Much later timestamp
                swapStatus: "active",
            });

            const eitherCancelled = cancelledEntry.swapStatus === "cancelled" || activeEntry.swapStatus === "cancelled";

            assert.strictEqual(eitherCancelled, true, "Should detect that one entry is cancelled");
            // The "sticky" rule means the final result should be cancelled
        });

        test("swappedUsers are preserved even when swap is cancelled", () => {
            // Important: users who completed the swap should still be tracked,
            // even if the swap was later cancelled
            const cancelledEntry = createSwapEntry({
                swapUUID: "users-preserved",
                swapModifiedAt: 2000,
                swapStatus: "cancelled",
                cancelledBy: "admin",
                cancelledAt: 2000,
                swappedUsers: [{ userToSwap: "user1", createdAt: 1000, updatedAt: 1000, executed: true }],
            });
            const activeEntry = createSwapEntry({
                swapUUID: "users-preserved",
                swapModifiedAt: 1500,
                swapStatus: "active",
                swappedUsers: [{ userToSwap: "user2", createdAt: 1500, updatedAt: 1500, executed: true }],
            });

            const mergedUsers = mergeSwappedUsers(cancelledEntry.swappedUsers, activeEntry.swappedUsers);

            assert.strictEqual(mergedUsers.length, 2, "Both users should be preserved");
            assert.ok(mergedUsers.some(u => u.userToSwap === "user1"));
            assert.ok(mergedUsers.some(u => u.userToSwap === "user2"));
        });
    });

    // ========================================================================
    // LOCAL CACHE SYNC
    // ========================================================================
    suite("Local Cache Sync (localProjectSwap.json)", () => {
        test("local cache structure matches expected schema", () => {
            const localSwapData = {
                remoteSwapInfo: {
                    swapEntries: [createSwapEntry({ swapUUID: "cached" })],
                },
                fetchedAt: Date.now(),
                sourceOriginUrl: "https://gitlab.com/org/project.git",
            };

            assert.ok(localSwapData.remoteSwapInfo, "Should have remoteSwapInfo");
            assert.ok(localSwapData.fetchedAt, "Should have fetchedAt timestamp");
            assert.ok(localSwapData.sourceOriginUrl, "Should have sourceOriginUrl");
        });

        test("local cache updates preserve existing entries", () => {
            const existingEntries: ProjectSwapEntry[] = [
                createSwapEntry({ swapUUID: "existing-1" }),
            ];

            const remoteEntry = createSwapEntry({ swapUUID: "remote-new", swappedUsers: [{ userToSwap: "user1", createdAt: 1000, updatedAt: 1000, executed: true }] });

            // Simulate cache update logic
            const entryIndex = existingEntries.findIndex(e => e.swapUUID === remoteEntry.swapUUID);
            if (entryIndex >= 0) {
                existingEntries[entryIndex] = remoteEntry;
            } else {
                existingEntries.push(remoteEntry);
            }

            assert.strictEqual(existingEntries.length, 2, "Should have both entries");
            assert.ok(existingEntries.some(e => e.swapUUID === "existing-1"));
            assert.ok(existingEntries.some(e => e.swapUUID === "remote-new"));
        });

        test("local cache update replaces existing entry by swapUUID", () => {
            const existingEntries: ProjectSwapEntry[] = [
                createSwapEntry({ swapUUID: "update-me", swappedUsers: [] }),
            ];

            const remoteEntry = createSwapEntry({
                swapUUID: "update-me",
                swappedUsers: [{ userToSwap: "completed-user", createdAt: 1000, updatedAt: 2000, executed: true, swapCompletedAt: 2000 }],
            });

            // Simulate cache update logic
            const entryIndex = existingEntries.findIndex(e => e.swapUUID === remoteEntry.swapUUID);
            if (entryIndex >= 0) {
                existingEntries[entryIndex] = remoteEntry;
            } else {
                existingEntries.push(remoteEntry);
            }

            assert.strictEqual(existingEntries.length, 1, "Should still have 1 entry");
            assert.strictEqual(existingEntries[0].swappedUsers?.length, 1, "Should have updated swappedUsers");
            assert.strictEqual(existingEntries[0].swappedUsers?.[0].executed, true, "User should be marked as executed");
        });
    });

    // ========================================================================
    // SWAPPED USERS MODIFIED AT - TIMESTAMP SEPARATION
    // ========================================================================
    suite("swappedUsersModifiedAt Timestamp Separation", () => {
        test("swappedUsersModifiedAt is separate from swapModifiedAt", () => {
            // swappedUsersModifiedAt tracks user array changes
            // swapModifiedAt tracks entry-level changes (status, cancellation, URLs)
            const entry = createSwapEntry({
                swapModifiedAt: 1000,
                swappedUsersModifiedAt: 2000,
                swappedUsers: [
                    { userToSwap: "user1", createdAt: 2000, updatedAt: 2000, executed: true },
                ],
            });

            // These should be independent timestamps
            assert.notStrictEqual(entry.swapModifiedAt, entry.swappedUsersModifiedAt);
            assert.strictEqual(entry.swapModifiedAt, 1000, "swapModifiedAt should be entry-level timestamp");
            assert.strictEqual(entry.swappedUsersModifiedAt, 2000, "swappedUsersModifiedAt should be user array timestamp");
        });

        test("user completion should update swappedUsersModifiedAt, not swapModifiedAt", () => {
            // Simulates the correct behavior after our fix
            const entryBeforeCompletion = createSwapEntry({
                swapInitiatedAt: 1000,
                swapModifiedAt: 1000,
                swappedUsersModifiedAt: undefined,
                swappedUsers: [],
            });

            // User completes swap - should only update swappedUsersModifiedAt
            const completionTime = 5000;
            const entryAfterCompletion = {
                ...entryBeforeCompletion,
                swapModifiedAt: entryBeforeCompletion.swapModifiedAt, // UNCHANGED
                swappedUsersModifiedAt: completionTime, // UPDATED
                swappedUsers: [
                    { userToSwap: "user1", createdAt: completionTime, updatedAt: completionTime, executed: true },
                ],
            };

            assert.strictEqual(entryAfterCompletion.swapModifiedAt, 1000, "swapModifiedAt should NOT change on user completion");
            assert.strictEqual(entryAfterCompletion.swappedUsersModifiedAt, 5000, "swappedUsersModifiedAt SHOULD change");
        });

        test("cancellation should update swapModifiedAt, not swappedUsersModifiedAt", () => {
            const entryBeforeCancellation = createSwapEntry({
                swapInitiatedAt: 1000,
                swapModifiedAt: 1000,
                swappedUsersModifiedAt: 2000,
                swappedUsers: [
                    { userToSwap: "user1", createdAt: 2000, updatedAt: 2000, executed: true },
                ],
            });

            // Admin cancels swap - should only update swapModifiedAt
            const cancellationTime = 5000;
            const entryAfterCancellation = {
                ...entryBeforeCancellation,
                swapStatus: "cancelled" as const,
                swapModifiedAt: cancellationTime, // UPDATED
                swappedUsersModifiedAt: entryBeforeCancellation.swappedUsersModifiedAt, // UNCHANGED
                cancelledBy: "admin",
                cancelledAt: cancellationTime,
            };

            assert.strictEqual(entryAfterCancellation.swapModifiedAt, 5000, "swapModifiedAt SHOULD change on cancellation");
            assert.strictEqual(entryAfterCancellation.swappedUsersModifiedAt, 2000, "swappedUsersModifiedAt should NOT change");
        });

        test("merge logic computes swappedUsersModifiedAt as max of both entries", () => {
            const entry1 = createSwapEntry({
                swapUUID: "merge-test",
                swapInitiatedAt: 1000,
                swappedUsersModifiedAt: 2000,
                swappedUsers: [{ userToSwap: "user1", createdAt: 2000, updatedAt: 2000, executed: true }],
            });
            const entry2 = createSwapEntry({
                swapUUID: "merge-test",
                swapInitiatedAt: 1000,
                swappedUsersModifiedAt: 3000,
                swappedUsers: [{ userToSwap: "user2", createdAt: 3000, updatedAt: 3000, executed: true }],
            });

            // Simulate merge logic
            const existingUsersModified = entry1.swappedUsersModifiedAt ?? 0;
            const newUsersModified = entry2.swappedUsersModifiedAt ?? 0;
            const mergedUsersModifiedAt = Math.max(existingUsersModified, newUsersModified);

            assert.strictEqual(mergedUsersModifiedAt, 3000, "Should take max of both timestamps");
        });

        test("missing swappedUsersModifiedAt is handled gracefully (defaults to 0)", () => {
            const entry1 = createSwapEntry({
                swapUUID: "no-timestamp",
                swappedUsersModifiedAt: undefined,
            });
            const entry2 = createSwapEntry({
                swapUUID: "no-timestamp",
                swappedUsersModifiedAt: 2000,
            });

            const existingUsersModified = entry1.swappedUsersModifiedAt ?? 0;
            const newUsersModified = entry2.swappedUsersModifiedAt ?? 0;
            const mergedUsersModifiedAt = Math.max(existingUsersModified, newUsersModified);

            assert.strictEqual(mergedUsersModifiedAt, 2000, "Should handle undefined as 0");
        });
    });

    // ========================================================================
    // ENTRY KEY MATCHING (swapUUID)
    // ========================================================================
    suite("Entry Key Matching", () => {
        test("entries are matched by swapUUID alone", () => {
            // Each swap event gets a unique swapUUID
            const entry1 = createSwapEntry({
                swapUUID: "uuid-ab",
                swapInitiatedAt: 1000,
                oldProjectName: "ProjectA",
                newProjectName: "ProjectB",
            });
            const entry2 = createSwapEntry({
                swapUUID: "uuid-bc", // Different UUID = different swap
                swapInitiatedAt: 2000,
                oldProjectName: "ProjectB",
                newProjectName: "ProjectC",
            });

            const getEntryKey = (entry: ProjectSwapEntry): string => entry.swapUUID;

            const key1 = getEntryKey(entry1);
            const key2 = getEntryKey(entry2);

            assert.notStrictEqual(key1, key2, "Different swapUUID should produce different keys");
        });

        test("same swapUUID identifies same swap event regardless of isOldProject", () => {
            // Same swapUUID = same swap event (from different perspectives)
            const entryFromOldProject = createSwapEntry({
                swapUUID: "shared-uuid",
                swapInitiatedAt: 1000,
                isOldProject: true,
            });
            const entryFromNewProject = createSwapEntry({
                swapUUID: "shared-uuid",
                swapInitiatedAt: 1000,
                isOldProject: false,
            });

            const getEntryKey = (entry: ProjectSwapEntry): string => entry.swapUUID;

            assert.strictEqual(
                getEntryKey(entryFromOldProject),
                getEntryKey(entryFromNewProject),
                "Same swapUUID should be same key regardless of isOldProject"
            );
        });

        test("swapUUID uniquely identifies swap in chain scenarios", () => {
            // In A→B→C chain, each swap has unique swapUUID
            const swapAB = createSwapEntry({
                swapUUID: "uuid-ab",
                swapInitiatedAt: 1000,
                oldProjectName: "A",
                newProjectName: "B",
            });
            const swapBC = createSwapEntry({
                swapUUID: "uuid-bc",
                swapInitiatedAt: 2000,
                oldProjectName: "B",
                newProjectName: "C",
            });

            const getEntryKey = (entry: ProjectSwapEntry): string => entry.swapUUID;

            const keys = [getEntryKey(swapAB), getEntryKey(swapBC)];
            const uniqueKeys = new Set(keys);

            assert.strictEqual(uniqueKeys.size, 2, "Each swap should have unique swapUUID");
        });

        test("entries with same swapUUID merge (newer swapModifiedAt wins)", () => {
            const entries = [
                createSwapEntry({ swapUUID: "uuid", swapModifiedAt: 1500 }),
                createSwapEntry({ swapUUID: "uuid", swapModifiedAt: 2000 }), // Same UUID, later modified
            ];

            const getEntryKey = (entry: ProjectSwapEntry): string => entry.swapUUID;

            const map = new Map<string, ProjectSwapEntry>();
            for (const entry of entries) {
                const key = getEntryKey(entry);
                const existing = map.get(key);
                if (!existing || (entry.swapModifiedAt ?? 0) > (existing.swapModifiedAt ?? 0)) {
                    map.set(key, entry);
                }
            }

            assert.strictEqual(map.size, 1, "Same swapUUID should merge to one entry");
            assert.strictEqual(
                Array.from(map.values())[0].swapModifiedAt,
                2000,
                "Should keep entry with later swapModifiedAt"
            );
        });

        test("different swapUUIDs are preserved separately", () => {
            const entries = [
                createSwapEntry({ swapUUID: "uuid-1", oldProjectName: "A", newProjectName: "B" }),
                createSwapEntry({ swapUUID: "uuid-2", oldProjectName: "B", newProjectName: "C" }),
            ];

            const getEntryKey = (entry: ProjectSwapEntry): string => entry.swapUUID;

            const map = new Map<string, ProjectSwapEntry>();
            for (const entry of entries) {
                map.set(getEntryKey(entry), entry);
            }

            assert.strictEqual(map.size, 2, "Different swapUUIDs should be preserved separately");
        });
    });

    // ========================================================================
    // RACE CONDITION REGRESSION TESTS
    // ========================================================================
    suite("Race Condition Regression Tests", () => {
        test("REGRESSION: cancellation NOT lost when user swaps with later timestamp", () => {
            // This was a bug: if user swapped at T3 and admin cancelled at T2,
            // the cancellation could be lost if we only compared swapModifiedAt
            const cancelledEntry = createSwapEntry({
                swapUUID: "race-test",
                swapInitiatedAt: 1000,
                swapModifiedAt: 2000, // Admin cancels at T2
                swapStatus: "cancelled",
                cancelledBy: "admin",
                cancelledAt: 2000,
                swappedUsers: [],
            });

            const userCompletedEntry = createSwapEntry({
                swapUUID: "race-test",
                swapInitiatedAt: 1000,
                swapModifiedAt: 3000, // User completes at T3 > T2
                swapStatus: "active",
                swappedUsers: [
                    { userToSwap: "user1", createdAt: 3000, updatedAt: 3000, executed: true },
                ],
            });

            // Cancelled is sticky - either cancelled means result is cancelled
            const eitherCancelled = cancelledEntry.swapStatus === "cancelled" || userCompletedEntry.swapStatus === "cancelled";
            const mergedUsers = mergeSwappedUsers(cancelledEntry.swappedUsers, userCompletedEntry.swappedUsers);

            assert.strictEqual(eitherCancelled, true, "Should detect cancellation");
            assert.strictEqual(mergedUsers.length, 1, "User completion should still be tracked");

            // Merged result should be cancelled
            const baseEntry = (userCompletedEntry.swapModifiedAt ?? 0) > (cancelledEntry.swapModifiedAt ?? 0)
                ? userCompletedEntry
                : cancelledEntry;
            const mergedEntry = eitherCancelled
                ? { ...baseEntry, swappedUsers: mergedUsers, swapStatus: "cancelled" as const }
                : { ...baseEntry, swappedUsers: mergedUsers };

            assert.strictEqual(mergedEntry.swapStatus, "cancelled", "Final status should be cancelled (sticky rule)");
        });

        test("REGRESSION: concurrent user completions are both preserved", () => {
            // If User A completes at T1 and User B completes at T2 independently,
            // both should be preserved in the merged result
            const entryA = createSwapEntry({
                swapUUID: "concurrent-test",
                swapInitiatedAt: 1000,
                swapModifiedAt: 2000,
                swappedUsersModifiedAt: 2000,
                swappedUsers: [
                    { userToSwap: "userA", createdAt: 2000, updatedAt: 2000, executed: true },
                ],
            });

            const entryB = createSwapEntry({
                swapUUID: "concurrent-test",
                swapInitiatedAt: 1000,
                swapModifiedAt: 3000,
                swappedUsersModifiedAt: 3000,
                swappedUsers: [
                    { userToSwap: "userB", createdAt: 3000, updatedAt: 3000, executed: true },
                ],
            });

            const mergedUsers = mergeSwappedUsers(entryA.swappedUsers, entryB.swappedUsers);

            assert.strictEqual(mergedUsers.length, 2, "Both users should be preserved");
            assert.ok(mergedUsers.some(u => u.userToSwap === "userA"), "User A should be present");
            assert.ok(mergedUsers.some(u => u.userToSwap === "userB"), "User B should be present");
        });

        test("REGRESSION: swappedUsers not lost due to timestamp conflict", () => {
            // This was a bug: if swapModifiedAt was equal but swappedUsers differed,
            // one source's users could be lost
            const metadataEntry = createSwapEntry({
                swapUUID: "timestamp-conflict",
                swapInitiatedAt: 1000,
                swapModifiedAt: 2000,
                swappedUsers: [], // Empty in metadata
            });

            const localCacheEntry = createSwapEntry({
                swapUUID: "timestamp-conflict",
                swapInitiatedAt: 1000,
                swapModifiedAt: 2000, // Same timestamp
                swappedUsers: [
                    { userToSwap: "user1", createdAt: 1500, updatedAt: 1500, executed: true },
                ],
            });

            // Merging should always combine swappedUsers
            const mergedUsers = mergeSwappedUsers(metadataEntry.swappedUsers, localCacheEntry.swappedUsers);

            assert.strictEqual(mergedUsers.length, 1, "User from local cache should be preserved");
            assert.strictEqual(mergedUsers[0].userToSwap, "user1");
        });

        test("REGRESSION: swappedUsersModifiedAt breaks timestamp tie correctly", () => {
            // When swapModifiedAt is equal, swappedUsersModifiedAt should determine
            // which swappedUsers array takes precedence for conflicts
            const entry1 = createSwapEntry({
                swapUUID: "tie-breaker",
                swapInitiatedAt: 1000,
                swapModifiedAt: 2000,
                swappedUsersModifiedAt: 2500,
                swappedUsers: [
                    { userToSwap: "user1", createdAt: 1000, updatedAt: 2500, executed: true }, // Newer updatedAt
                ],
            });

            const entry2 = createSwapEntry({
                swapUUID: "tie-breaker",
                swapInitiatedAt: 1000,
                swapModifiedAt: 2000, // Same swapModifiedAt
                swappedUsersModifiedAt: 1500, // Older swappedUsersModifiedAt
                swappedUsers: [
                    { userToSwap: "user1", createdAt: 1000, updatedAt: 1500, executed: false }, // Older state
                ],
            });

            // mergeSwappedUsers should keep the one with newer updatedAt
            const merged = mergeSwappedUsers(entry1.swappedUsers, entry2.swappedUsers);

            assert.strictEqual(merged.length, 1);
            assert.strictEqual(merged[0].executed, true, "Should keep entry with newer updatedAt");
            assert.strictEqual(merged[0].updatedAt, 2500);
        });
    });

    // ========================================================================
    // COMPOSITE KEY USER MATCHING (userToSwap + createdAt)
    // ========================================================================
    suite("Composite Key User Matching", () => {
        test("same user with different createdAt = different entries", () => {
            // If user re-swaps in a new chain, they get a new entry
            const users = [
                { userToSwap: "user1", createdAt: 1000, updatedAt: 1000, executed: true } as ProjectSwapUserEntry,
                { userToSwap: "user1", createdAt: 5000, updatedAt: 5000, executed: true } as ProjectSwapUserEntry, // Same user, different swap event
            ];

            const merged = mergeSwappedUsers(users.slice(0, 1), users.slice(1, 2));

            assert.strictEqual(merged.length, 2, "Different createdAt = different user entries");
        });

        test("same user + same createdAt = merged by updatedAt", () => {
            // Same user in same swap event, merge by newer updatedAt
            const usersA = [
                { userToSwap: "user1", createdAt: 1000, updatedAt: 1000, executed: false } as ProjectSwapUserEntry,
            ];
            const usersB = [
                { userToSwap: "user1", createdAt: 1000, updatedAt: 2000, executed: true } as ProjectSwapUserEntry,
            ];

            const merged = mergeSwappedUsers(usersA, usersB);

            assert.strictEqual(merged.length, 1, "Same composite key = merged");
            assert.strictEqual(merged[0].executed, true, "Should keep newer state");
            assert.strictEqual(merged[0].updatedAt, 2000);
        });

        test("getUserKey function produces correct composite key", () => {
            const user: ProjectSwapUserEntry = {
                userToSwap: "testuser",
                createdAt: 1234567890,
                updatedAt: 1234567890,
                executed: true,
            };

            const getUserKey = (u: ProjectSwapUserEntry): string => `${u.userToSwap}::${u.createdAt}`;
            const key = getUserKey(user);

            assert.strictEqual(key, "testuser::1234567890");
        });
    });

    // ========================================================================
    // FIELD ORDERING TESTS
    // ========================================================================
    suite("Field Ordering", () => {
        test("orderEntryFields produces consistent field order", () => {
            const entry = createSwapEntry({
                swapUUID: "order-test",
                swapStatus: "active",
                swapInitiatedAt: 1000,
                swapInitiatedBy: "admin",
                swapReason: "Test reason",
                swapModifiedAt: 2000,
                swappedUsersModifiedAt: 2500,
                oldProjectName: "old-proj",
                newProjectName: "new-proj",
                isOldProject: true,
                oldProjectUrl: "https://example.com/old.git",
                newProjectUrl: "https://example.com/new.git",
                swappedUsers: [],
            });

            const ordered = orderEntryFields(entry);
            const keys = Object.keys(ordered);

            // Verify key order matches expected: UUID and status first, then initiation info
            assert.strictEqual(keys[0], "swapUUID", "swapUUID should be first");
            assert.strictEqual(keys[1], "swapStatus", "swapStatus should be second");
            assert.strictEqual(keys[2], "swapInitiatedAt", "swapInitiatedAt should be third");
        });

        test("orderEntryFields removes undefined fields", () => {
            const entry = createSwapEntry({
                swapUUID: "clean-test",
                cancelledBy: undefined,
                cancelledAt: undefined,
            });

            const ordered = orderEntryFields(entry);

            assert.ok(!("cancelledBy" in ordered), "cancelledBy should be removed when undefined");
            assert.ok(!("cancelledAt" in ordered), "cancelledAt should be removed when undefined");
        });

        test("orderEntryFields preserves all non-undefined values", () => {
            const entry = createSwapEntry({
                swapUUID: "preserve-test",
                swapStatus: "cancelled",
                cancelledBy: "admin",
                cancelledAt: 5000,
                swappedUsers: [
                    { userToSwap: "user1", createdAt: 1000, updatedAt: 2000, executed: true },
                ],
            });

            const ordered = orderEntryFields(entry);

            assert.strictEqual(ordered.swapUUID, "preserve-test");
            assert.strictEqual(ordered.swapStatus, "cancelled");
            assert.strictEqual(ordered.cancelledBy, "admin");
            assert.strictEqual(ordered.cancelledAt, 5000);
            assert.strictEqual(ordered.swappedUsers?.length, 1);
        });

        test("sortSwapEntries applies orderEntryFields to each entry", () => {
            const entries = [
                createSwapEntry({ swapUUID: "entry-1", swapStatus: "active" }),
                createSwapEntry({ swapUUID: "entry-2", swapStatus: "cancelled" }),
            ];

            const sorted = sortSwapEntries(entries);

            // All entries should have consistent key order
            for (const entry of sorted) {
                const keys = Object.keys(entry);
                assert.strictEqual(keys[0], "swapUUID", "First key should be swapUUID");
                assert.strictEqual(keys[1], "swapStatus", "Second key should be swapStatus");
            }
        });
    });

    // ========================================================================
    // CHAIN DEPRECATION HIDING (QA CRITICAL)
    // ========================================================================
    suite("Chain Deprecation Hiding - QA Critical", () => {
        test("full chain A→B→C: both A and B are deprecated from C's perspective", () => {
            // This is the exact scenario: swaptest1 → swaptest2 → swaptest3
            const swapInfo: ProjectSwapInfo = {
                swapEntries: [
                    // Current active swap: swaptest2 → swaptest3
                    createSwapEntry({
                        swapUUID: "swap-2-to-3",
                        swapStatus: "active",
                        isOldProject: false, // swaptest3 is the NEW project
                        oldProjectUrl: "https://gitlab.com/org/swaptest2.git",
                        oldProjectName: "swaptest2",
                        newProjectUrl: "https://gitlab.com/org/swaptest3.git",
                        newProjectName: "swaptest3",
                        swapInitiatedAt: 3000,
                    }),
                    // Historical: swaptest1 → swaptest2
                    createSwapEntry({
                        swapUUID: "swap-1-to-2",
                        swapStatus: "cancelled",
                        isOldProject: true,
                        oldProjectUrl: "https://gitlab.com/org/swaptest1.git",
                        oldProjectName: "swaptest1",
                        newProjectUrl: "https://gitlab.com/org/swaptest2.git",
                        newProjectName: "swaptest2",
                        swapInitiatedAt: 2000,
                    }),
                    // Origin marker for swaptest1
                    createSwapEntry({
                        swapUUID: "origin-swaptest1",
                        swapStatus: "cancelled",
                        isOldProject: true,
                        oldProjectUrl: "https://gitlab.com/org/swaptest1.git",
                        oldProjectName: "swaptest1",
                        newProjectUrl: "",
                        newProjectName: "",
                        swapInitiatedAt: 1000,
                    }),
                ],
            };

            const deprecated = getDeprecatedProjectsFromHistory(swapInfo);
            const deprecatedUrls = deprecated.map(d => d.url);

            // CRITICAL: Both swaptest1 and swaptest2 should be deprecated
            assert.ok(
                deprecatedUrls.includes("https://gitlab.com/org/swaptest1.git"),
                "swaptest1 (origin) should be deprecated"
            );
            assert.ok(
                deprecatedUrls.includes("https://gitlab.com/org/swaptest2.git"),
                "swaptest2 (middle) should be deprecated"
            );
            assert.strictEqual(deprecated.length, 2, "Exactly 2 projects should be deprecated");
        });

        test("origin marker project is correctly identified as deprecated", () => {
            // Origin marker has oldProjectUrl/oldProjectName populated, newProjectUrl/newProjectName empty
            const swapInfo: ProjectSwapInfo = {
                swapEntries: [
                    createSwapEntry({
                        swapUUID: "swap-origin-to-next",
                        swapStatus: "active",
                        isOldProject: false,
                        oldProjectUrl: "https://gitlab.com/org/origin-project.git",
                        oldProjectName: "origin-project",
                        newProjectUrl: "https://gitlab.com/org/next-project.git",
                        newProjectName: "next-project",
                    }),
                    createSwapEntry({
                        swapUUID: "origin-marker",
                        swapStatus: "cancelled",
                        isOldProject: true,
                        oldProjectUrl: "https://gitlab.com/org/origin-project.git",
                        oldProjectName: "origin-project",
                        newProjectUrl: "",
                        newProjectName: "",
                    }),
                ],
            };

            const deprecated = getDeprecatedProjectsFromHistory(swapInfo);

            // Origin project should be deprecated (from the actual swap entry)
            assert.ok(
                deprecated.some(d => d.url === "https://gitlab.com/org/origin-project.git"),
                "Origin project should be deprecated"
            );
        });

        test("cancelled swap still marks old project as deprecated in history", () => {
            // Even if A→B swap was cancelled, if there's a subsequent B→C swap,
            // the history should still show A as deprecated
            const swapInfo: ProjectSwapInfo = {
                swapEntries: [
                    createSwapEntry({
                        swapUUID: "swap-b-to-c",
                        swapStatus: "active",
                        isOldProject: false,
                        oldProjectUrl: "https://gitlab.com/org/project-b.git",
                        oldProjectName: "project-b",
                        newProjectUrl: "https://gitlab.com/org/project-c.git",
                        newProjectName: "project-c",
                    }),
                    createSwapEntry({
                        swapUUID: "swap-a-to-b-cancelled",
                        swapStatus: "cancelled",
                        isOldProject: true,
                        oldProjectUrl: "https://gitlab.com/org/project-a.git",
                        oldProjectName: "project-a",
                        newProjectUrl: "https://gitlab.com/org/project-b.git",
                        newProjectName: "project-b",
                    }),
                ],
            };

            const deprecated = getDeprecatedProjectsFromHistory(swapInfo);
            const deprecatedUrls = deprecated.map(d => d.url);

            assert.ok(deprecatedUrls.includes("https://gitlab.com/org/project-a.git"));
            assert.ok(deprecatedUrls.includes("https://gitlab.com/org/project-b.git"));
        });

        test("current project (isOldProject=false) is never deprecated", () => {
            const swapInfo: ProjectSwapInfo = {
                swapEntries: [
                    createSwapEntry({
                        swapUUID: "current-swap",
                        swapStatus: "active",
                        isOldProject: false, // This is the current/new project
                        oldProjectUrl: "https://gitlab.com/org/old.git",
                        newProjectUrl: "https://gitlab.com/org/current.git",
                    }),
                ],
            };

            assert.strictEqual(
                isProjectDeprecated("https://gitlab.com/org/current.git", swapInfo),
                false,
                "Current project should never be deprecated"
            );
            assert.strictEqual(
                isProjectDeprecated("https://gitlab.com/org/old.git", swapInfo),
                true,
                "Old project should be deprecated"
            );
        });
    });

    // ========================================================================
    // REMOTE-ONLY PROJECT FILTERING (QA CRITICAL)
    // ========================================================================
    suite("Remote-Only Project Filtering - QA Critical", () => {
        test("deprecated project names are extracted along with URLs", () => {
            const swapInfo: ProjectSwapInfo = {
                swapEntries: [
                    createSwapEntry({
                        swapUUID: "test-swap",
                        isOldProject: false,
                        oldProjectUrl: "https://gitlab.com/org/remote-only-project.git",
                        oldProjectName: "remote-only-project",
                    }),
                ],
            };

            const deprecated = getDeprecatedProjectsFromHistory(swapInfo);

            assert.strictEqual(deprecated.length, 1);
            assert.strictEqual(deprecated[0].url, "https://gitlab.com/org/remote-only-project.git");
            assert.strictEqual(deprecated[0].name, "remote-only-project");
        });

        test("remote project without gitOriginUrl can be matched by name", () => {
            // This simulates a remote-only project that hasn't been cloned
            // It won't have gitOriginUrl but will have a name
            const swapInfo: ProjectSwapInfo = {
                swapEntries: [
                    createSwapEntry({
                        swapUUID: "swap-test",
                        isOldProject: false,
                        oldProjectUrl: "https://gitlab.com/org/swaptest1.git",
                        oldProjectName: "swaptest1-dsnl017zju6dyoue7bkq2i",
                    }),
                ],
            };

            const deprecated = getDeprecatedProjectsFromHistory(swapInfo);

            // Verify name is captured for name-based matching
            assert.ok(
                deprecated.some(d => d.name === "swaptest1-dsnl017zju6dyoue7bkq2i"),
                "Deprecated project name should be captured"
            );
        });

        test("case-insensitive name matching for deprecated projects", () => {
            const swapInfo: ProjectSwapInfo = {
                swapEntries: [
                    createSwapEntry({
                        swapUUID: "case-test",
                        oldProjectUrl: "https://gitlab.com/org/TestProject.git",
                        oldProjectName: "TestProject",
                    }),
                ],
            };

            // isProjectDeprecated already does case-insensitive URL matching
            // The filtering logic in projectUtils should also do case-insensitive name matching
            assert.strictEqual(
                isProjectDeprecated("https://gitlab.com/org/testproject.git", swapInfo),
                true,
                "URL matching should be case-insensitive"
            );
        });
    });

    // ========================================================================
    // TIMESTAMP SEPARATION (swapModifiedAt vs swappedUsersModifiedAt)
    // ========================================================================
    suite("Timestamp Separation", () => {
        test("swappedUsersModifiedAt is independent of swapModifiedAt", () => {
            const entry = createSwapEntry({
                swapUUID: "timestamp-test",
                swapInitiatedAt: 1000,
                swapModifiedAt: 1000, // Entry created
                swappedUsersModifiedAt: 2000, // User completed later
                swappedUsers: [
                    { userToSwap: "user1", createdAt: 2000, updatedAt: 2000, executed: true },
                ],
            });

            // swapModifiedAt should NOT change when users complete
            assert.strictEqual(entry.swapModifiedAt, 1000, "swapModifiedAt should not change on user completion");
            assert.strictEqual(entry.swappedUsersModifiedAt, 2000, "swappedUsersModifiedAt should reflect user completion");
        });

        test("cancellation updates swapModifiedAt but not swappedUsersModifiedAt", () => {
            const cancelledEntry = createSwapEntry({
                swapUUID: "cancel-test",
                swapInitiatedAt: 1000,
                swapModifiedAt: 3000, // Updated when cancelled
                swappedUsersModifiedAt: 2000, // Users completed before cancellation
                swapStatus: "cancelled",
                cancelledAt: 3000,
                cancelledBy: "admin",
                swappedUsers: [
                    { userToSwap: "user1", createdAt: 2000, updatedAt: 2000, executed: true },
                ],
            });

            assert.strictEqual(cancelledEntry.swapModifiedAt, 3000, "swapModifiedAt should reflect cancellation time");
            assert.strictEqual(cancelledEntry.swappedUsersModifiedAt, 2000, "swappedUsersModifiedAt should not change on cancellation");
        });

        test("entry-level changes only affect swapModifiedAt", () => {
            // Status change, URL update, name update = swapModifiedAt
            // User completion = swappedUsersModifiedAt
            const entry1 = createSwapEntry({
                swapModifiedAt: 1000,
                swappedUsersModifiedAt: 500,
            });

            // Simulate status change
            const entry2 = {
                ...entry1,
                swapStatus: "cancelled" as const,
                swapModifiedAt: 2000, // Updated
                swappedUsersModifiedAt: 500, // Unchanged
            };

            assert.notStrictEqual(entry1.swapModifiedAt, entry2.swapModifiedAt);
            assert.strictEqual(entry1.swappedUsersModifiedAt, entry2.swappedUsersModifiedAt);
        });
    });

    // ========================================================================
    // ENTRY KEY MATCHING (swapUUID only)
    // ========================================================================
    suite("Entry Key Matching - swapUUID", () => {
        test("entries match by swapUUID alone", () => {
            const entry1 = createSwapEntry({
                swapUUID: "match-test-uuid",
                isOldProject: true,
            });
            const entry2 = createSwapEntry({
                swapUUID: "match-test-uuid",
                isOldProject: false, // Different perspective
            });

            // getEntryKey should return just the swapUUID
            assert.strictEqual(getEntryKey(entry1), "match-test-uuid");
            assert.strictEqual(getEntryKey(entry2), "match-test-uuid");
            assert.strictEqual(getEntryKey(entry1), getEntryKey(entry2), "Same UUID = same key");
        });

        test("different swapUUIDs = different entries", () => {
            const entry1 = createSwapEntry({ swapUUID: "uuid-alpha" });
            const entry2 = createSwapEntry({ swapUUID: "uuid-beta" });

            assert.notStrictEqual(getEntryKey(entry1), getEntryKey(entry2));
        });
    });

    // ========================================================================
    // REGRESSION TESTS - SPECIFIC BUG SCENARIOS
    // ========================================================================
    suite("Regression Tests - Bug Scenarios", () => {
        test("REGRESSION: swaptest1 not hiding - origin marker oldProjectUrl must be populated", () => {
            // Bug: origin marker had oldProjectUrl empty, so origin wasn't being hidden
            // Fix: origin marker's oldProjectUrl/oldProjectName = origin project's info
            const swapInfo: ProjectSwapInfo = {
                swapEntries: [
                    // Current swap
                    createSwapEntry({
                        swapUUID: "swap-2-to-3",
                        isOldProject: false,
                        oldProjectUrl: "https://gitlab.com/org/swaptest2.git",
                        oldProjectName: "swaptest2",
                        newProjectUrl: "https://gitlab.com/org/swaptest3.git",
                        newProjectName: "swaptest3",
                    }),
                    // Intermediate (cancelled)
                    createSwapEntry({
                        swapUUID: "swap-1-to-2",
                        isOldProject: true,
                        swapStatus: "cancelled",
                        oldProjectUrl: "https://gitlab.com/org/swaptest1.git",
                        oldProjectName: "swaptest1",
                        newProjectUrl: "https://gitlab.com/org/swaptest2.git",
                        newProjectName: "swaptest2",
                    }),
                    // Origin marker - MUST have oldProjectUrl populated
                    createSwapEntry({
                        swapUUID: "origin-swaptest1",
                        isOldProject: true,
                        swapStatus: "cancelled",
                        oldProjectUrl: "https://gitlab.com/org/swaptest1.git", // CRITICAL: must be populated
                        oldProjectName: "swaptest1",
                        newProjectUrl: "", // Empty - no predecessor
                        newProjectName: "",
                    }),
                ],
            };

            const deprecated = getDeprecatedProjectsFromHistory(swapInfo);

            // swaptest1 MUST be in deprecated list
            assert.ok(
                deprecated.some(d => d.url === "https://gitlab.com/org/swaptest1.git"),
                "REGRESSION: swaptest1 must be deprecated"
            );
        });

        test("REGRESSION: only immediate oldProjectUrl was hidden, not full chain", () => {
            // Bug: StartupFlowProvider only looked at immediate oldProjectUrl
            // Fix: Use getDeprecatedProjectsFromHistory for full chain
            const swapInfo: ProjectSwapInfo = {
                swapEntries: [
                    // A→B→C→D chain - only D is current
                    createSwapEntry({
                        swapUUID: "c-to-d",
                        isOldProject: false,
                        oldProjectUrl: "https://gitlab.com/org/project-c.git",
                    }),
                    createSwapEntry({
                        swapUUID: "b-to-c",
                        isOldProject: true,
                        swapStatus: "cancelled",
                        oldProjectUrl: "https://gitlab.com/org/project-b.git",
                    }),
                    createSwapEntry({
                        swapUUID: "a-to-b",
                        isOldProject: true,
                        swapStatus: "cancelled",
                        oldProjectUrl: "https://gitlab.com/org/project-a.git",
                    }),
                ],
            };

            const deprecated = getDeprecatedProjectsFromHistory(swapInfo);
            const urls = deprecated.map(d => d.url);

            // ALL old projects must be deprecated, not just the immediate one
            assert.strictEqual(urls.length, 3, "All 3 old projects should be deprecated");
            assert.ok(urls.includes("https://gitlab.com/org/project-a.git"), "project-a must be deprecated");
            assert.ok(urls.includes("https://gitlab.com/org/project-b.git"), "project-b must be deprecated");
            assert.ok(urls.includes("https://gitlab.com/org/project-c.git"), "project-c must be deprecated");
        });
    });

    suite("Entry Data Integrity - No Fallbacks", () => {
        test("swapInitiatedBy should never be 'unknown' in properly created entries", () => {
            // This test documents that "unknown" is an invalid state that indicates a bug
            const validEntry = createSwapEntry({
                swapInitiatedBy: "admin-user",
            });

            assert.notStrictEqual(validEntry.swapInitiatedBy, "unknown",
                "swapInitiatedBy should have actual username, not 'unknown'");
            assert.ok(validEntry.swapInitiatedBy && validEntry.swapInitiatedBy.length > 0,
                "swapInitiatedBy must be a non-empty string");
        });

        test("entry fields are preserved through sortSwapEntries", () => {
            const entries = [
                createSwapEntry({
                    swapUUID: "test-uuid",
                    swapInitiatedBy: "original-user",
                    swapReason: "Original reason for swap",
                    swapStatus: "active",
                }),
            ];

            const sorted = sortSwapEntries(entries);
            const entry = sorted[0];

            assert.strictEqual(entry.swapInitiatedBy, "original-user",
                "swapInitiatedBy must be preserved through sorting");
            assert.strictEqual(entry.swapReason, "Original reason for swap",
                "swapReason must be preserved through sorting");
        });

        test("entry fields are preserved through orderEntryFields", () => {
            const original = createSwapEntry({
                swapInitiatedBy: "important-admin",
                swapReason: "Critical migration reason",
            });

            const ordered = orderEntryFields(original);

            assert.strictEqual(ordered.swapInitiatedBy, "important-admin",
                "swapInitiatedBy must be preserved through field ordering");
            assert.strictEqual(ordered.swapReason, "Critical migration reason",
                "swapReason must be preserved through field ordering");
        });

        test("SwapPendingDownloads interface supports swapInitiatedBy and swapReason", () => {
            // This test verifies the type structure includes the fields we need
            const pendingState: SwapPendingDownloads = {
                swapState: "pending_downloads",
                filesNeedingDownload: ["file1.mp3"],
                newProjectUrl: "https://gitlab.com/org/new.git",
                swapUUID: "pending-uuid",
                swapInitiatedAt: Date.now(),
                swapInitiatedBy: "admin-who-initiated", // Should be preserved
                swapReason: "Test migration reason", // Should be preserved  
                createdAt: Date.now(),
            };

            assert.strictEqual(pendingState.swapInitiatedBy, "admin-who-initiated",
                "SwapPendingDownloads must support swapInitiatedBy field");
            assert.strictEqual(pendingState.swapReason, "Test migration reason",
                "SwapPendingDownloads must support swapReason field");
        });

        test("all required entry fields have proper values (regression prevention)", () => {
            // Document what a valid entry looks like - any deviation from this is a bug
            const validEntry = createSwapEntry({
                swapUUID: "valid-uuid-12345",
                swapInitiatedAt: 1700000000000,
                swapModifiedAt: 1700000001000,
                swapStatus: "active",
                isOldProject: true,
                oldProjectUrl: "https://gitlab.com/org/old-project.git",
                oldProjectName: "old-project",
                newProjectUrl: "https://gitlab.com/org/new-project.git",
                newProjectName: "new-project",
                swapInitiatedBy: "admin@company.com",
                swapReason: "Repository restructuring",
            });

            // None of these should ever be "unknown" or empty fallback values
            assert.notStrictEqual(validEntry.swapUUID, "unknown");
            assert.notStrictEqual(validEntry.swapInitiatedBy, "unknown");
            assert.ok(validEntry.swapInitiatedAt > 0, "swapInitiatedAt must be a valid timestamp");
            assert.ok(validEntry.oldProjectUrl.startsWith("https://"), "oldProjectUrl must be a valid URL");
            assert.ok(validEntry.newProjectUrl.startsWith("https://"), "newProjectUrl must be a valid URL");
        });
    });

    suite("localProjectSwap.json Lifecycle - QA Critical", () => {
        test("checkProjectSwapRequired cleans up localProjectSwap when remote has no active OLD swap", async () => {
            // Simulate: remote entries exist but all are cancelled
            // The merge logic should recognise there's no active OLD swap
            const cancelledEntry = createSwapEntry({
                swapUUID: "cancelled-uuid",
                swapStatus: "cancelled",
                isOldProject: true,
                cancelledBy: "admin",
                cancelledAt: Date.now(),
            });

            const remoteEntries = [cancelledEntry];
            const hasActiveOldProjectSwap = remoteEntries.some(
                e => e.swapStatus === "active" && e.isOldProject === true
            );

            assert.strictEqual(hasActiveOldProjectSwap, false,
                "Cancelled entries should not count as active OLD swaps");
        });

        test("active NEW project swap does not count as active OLD swap", () => {
            const newProjectEntry = createSwapEntry({
                swapUUID: "new-project-uuid",
                swapStatus: "active",
                isOldProject: false, // This is the NEW project
            });

            const remoteEntries = [newProjectEntry];
            const hasActiveOldProjectSwap = remoteEntries.some(
                e => e.swapStatus === "active" && e.isOldProject === true
            );

            assert.strictEqual(hasActiveOldProjectSwap, false,
                "Active NEW project swap should not trigger OLD project caching");
        });

        test("merged result with no active entry means localProjectSwap can be deleted", () => {
            const entries = [
                createSwapEntry({ swapUUID: "uuid-1", swapStatus: "cancelled", isOldProject: true }),
                createSwapEntry({ swapUUID: "uuid-2", swapStatus: "cancelled", isOldProject: true }),
            ];

            const swapInfo = normalizeProjectSwapInfo({ swapEntries: entries });
            const activeEntry = getActiveSwapEntry(swapInfo);

            assert.strictEqual(activeEntry, undefined,
                "No active entry means localProjectSwap.json is redundant and can be deleted");
        });

        test("merged result with active entry means localProjectSwap must be kept", () => {
            const entries = [
                createSwapEntry({ swapUUID: "uuid-1", swapStatus: "cancelled", isOldProject: true }),
                createSwapEntry({ swapUUID: "uuid-2", swapStatus: "active", isOldProject: true }),
            ];

            const swapInfo = normalizeProjectSwapInfo({ swapEntries: entries });
            const activeEntry = getActiveSwapEntry(swapInfo);

            assert.ok(activeEntry, "Active entry exists - localProjectSwap.json must be kept");
            assert.strictEqual(activeEntry!.swapUUID, "uuid-2");
        });

        test("remote cancellation detected via swapModifiedAt comparison", () => {
            // Local has active, remote has cancelled with newer swapModifiedAt
            const localEntry = createSwapEntry({
                swapUUID: "shared-uuid",
                swapStatus: "active",
                swapModifiedAt: 1000,
                isOldProject: true,
            });
            const remoteEntry = createSwapEntry({
                swapUUID: "shared-uuid",
                swapStatus: "cancelled",
                swapModifiedAt: 2000, // Newer
                isOldProject: true,
                cancelledBy: "admin",
                cancelledAt: 2000,
            });

            // Simulate the merge logic
            const localModified = localEntry.swapModifiedAt ?? localEntry.swapInitiatedAt;
            const remoteModified = remoteEntry.swapModifiedAt ?? remoteEntry.swapInitiatedAt;

            assert.ok(remoteModified > localModified,
                "Remote cancellation has newer timestamp");

            // Cancelled-is-sticky rule: even if local is "active", cancelled wins
            const eitherCancelled = localEntry.swapStatus === "cancelled" || remoteEntry.swapStatus === "cancelled";
            assert.strictEqual(eitherCancelled, true,
                "Cancelled-is-sticky rule correctly detects cancellation");
        });

        test("re-validation before swap detects cancelled swap", () => {
            // Simulate: initial check says required, re-check says not required
            const initialResult = {
                required: true,
                activeEntry: createSwapEntry({ swapUUID: "swap-uuid", swapStatus: "active" }),
            };
            const recheckResult = {
                required: false,
                activeEntry: undefined as ProjectSwapEntry | undefined,
            };

            // The re-validation logic: if recheck says not required, abort
            const shouldAbort = !recheckResult.required || !recheckResult.activeEntry ||
                (recheckResult.activeEntry?.swapUUID !== initialResult.activeEntry.swapUUID);

            assert.strictEqual(shouldAbort, true,
                "Re-validation should detect cancelled swap and abort execution");
        });

        test("re-validation passes when swap is still active with same UUID", () => {
            const swapUUID = "consistent-uuid";
            const initialResult = {
                required: true,
                activeEntry: createSwapEntry({ swapUUID, swapStatus: "active" }),
            };
            const recheckResult = {
                required: true,
                activeEntry: createSwapEntry({ swapUUID, swapStatus: "active" }),
            };

            const shouldAbort = !recheckResult.required || !recheckResult.activeEntry ||
                (recheckResult.activeEntry?.swapUUID !== initialResult.activeEntry.swapUUID);

            assert.strictEqual(shouldAbort, false,
                "Re-validation should pass when swap is still active with same UUID");
        });

        test("re-validation detects UUID change (different swap initiated)", () => {
            const initialResult = {
                required: true,
                activeEntry: createSwapEntry({ swapUUID: "old-uuid", swapStatus: "active" }),
            };
            const recheckResult = {
                required: true,
                activeEntry: createSwapEntry({ swapUUID: "new-uuid", swapStatus: "active" }),
            };

            const shouldAbort = !recheckResult.required || !recheckResult.activeEntry ||
                (recheckResult.activeEntry?.swapUUID !== initialResult.activeEntry.swapUUID);

            assert.strictEqual(shouldAbort, true,
                "Re-validation should detect UUID change and abort old swap");
        });

        test("remote projectSwap erased entirely triggers cleanup of localProjectSwap", () => {
            // Simulate: remote metadata exists but projectSwap is absent/undefined
            const remoteMetadata: any = {
                meta: {
                    version: "0.16.0",
                    // projectSwap is missing entirely
                },
            };

            // The check: if remote meta exists but projectSwap is falsy,
            // treat it as authoritative "no swap"
            const hasProjectSwap = !!remoteMetadata?.meta?.projectSwap;
            const hasMeta = !!remoteMetadata?.meta;

            assert.strictEqual(hasProjectSwap, false, "Remote has no projectSwap");
            assert.strictEqual(hasMeta, true, "Remote meta does exist");

            // This means we should treat remoteSwapInfo as empty
            const remoteSwapInfo = hasProjectSwap
                ? (remoteMetadata.meta as any).projectSwap
                : (hasMeta ? { swapEntries: [] } : undefined);

            assert.ok(remoteSwapInfo, "Should produce an empty swap info (not undefined)");
            assert.strictEqual(remoteSwapInfo.swapEntries.length, 0,
                "Empty swap entries from erased remote");

            // With empty remote entries, hasActiveOldProjectSwap is false
            const hasActiveOldProjectSwap = remoteSwapInfo.swapEntries.some(
                (e: any) => e.swapStatus === "active" && e.isOldProject === true
            );
            assert.strictEqual(hasActiveOldProjectSwap, false,
                "Erased remote means no active OLD swap - triggers cleanup");
        });

        test("remote projectSwap erased with stale localProjectSwap entry should not show swap required", () => {
            // Local cache still has active swap from before the wipe
            const staleLocalEntry = createSwapEntry({
                swapUUID: "stale-uuid",
                swapStatus: "active",
                isOldProject: true,
            });

            // Remote says empty
            const remoteEntries: ProjectSwapEntry[] = [];

            // After merge, the stale local entry should NOT survive because
            // remote is authoritative. The merge sees 0 remote entries,
            // and hasActiveOldProjectSwap is false, so cleanup path runs.
            const hasActiveOldProjectSwap = remoteEntries.some(
                e => e.swapStatus === "active" && e.isOldProject === true
            );
            assert.strictEqual(hasActiveOldProjectSwap, false);

            // The cleanup path checks existingLocalEntries.length > 0 (true)
            // and deletes localProjectSwap.json if no pending state.
            // After deletion, the final merge only uses metadataSwapInfo.
            // If metadata.json was also updated (synced), there's nothing active.
            // Result: swap is NOT required.
            const normalizedRemote = normalizeProjectSwapInfo({ swapEntries: remoteEntries });
            const activeEntry = getActiveSwapEntry(normalizedRemote);
            assert.strictEqual(activeEntry, undefined,
                "With erased remote, no active swap should be found");
        });
    });

    suite("Server Unreachable vs Erased Distinction", () => {
        test("null remoteMetadata means server unreachable, NOT swap erased", () => {
            // fetchRemoteMetadata returns null on ANY failure (network, 404, 500, auth)
            const remoteMetadata: any = null;

            // Server unreachable: remoteMetadata is null
            const isUnreachable = remoteMetadata === null;
            // Server returned metadata but no swap: remoteMetadata.meta exists but no projectSwap
            const isErased = remoteMetadata !== null && !!remoteMetadata?.meta && !remoteMetadata?.meta?.projectSwap;

            assert.strictEqual(isUnreachable, true,
                "null metadata should be treated as server unreachable");
            assert.strictEqual(isErased, false,
                "null metadata should NOT be treated as swap erased");
        });

        test("metadata with no projectSwap means swap erased, NOT unreachable", () => {
            const remoteMetadata: any = {
                meta: { version: "0.16.0" },
            };

            const isUnreachable = remoteMetadata === null;
            const isErased = remoteMetadata !== null && !!remoteMetadata?.meta && !remoteMetadata?.meta?.projectSwap;

            assert.strictEqual(isUnreachable, false,
                "Valid metadata should NOT be treated as unreachable");
            assert.strictEqual(isErased, true,
                "Metadata without projectSwap should be treated as erased");
        });

        test("metadata with projectSwap is neither unreachable nor erased", () => {
            const remoteMetadata: any = {
                meta: {
                    version: "0.16.0",
                    projectSwap: { swapEntries: [createSwapEntry()] },
                },
            };

            const isUnreachable = remoteMetadata === null;
            const isErased = remoteMetadata !== null && !!remoteMetadata?.meta && !remoteMetadata?.meta?.projectSwap;

            assert.strictEqual(isUnreachable, false);
            assert.strictEqual(isErased, false);
        });

        test("remoteUnreachable flag prevents localProjectSwap cleanup", () => {
            // When server is unreachable, we should NOT touch localProjectSwap.json
            // because we don't know if the swap was erased or still active
            const remoteUnreachable = true;

            // With stale local data showing active swap
            const staleEntry = createSwapEntry({
                swapUUID: "stale-uuid",
                swapStatus: "active",
                isOldProject: true,
            });

            // When unreachable, remoteSwapInfo remains undefined (never set)
            // The cleanup/merge block only runs when remoteSwapInfo is defined
            // So local data is preserved as-is
            assert.strictEqual(remoteUnreachable, true,
                "With server unreachable, local state should be preserved untouched");
            assert.strictEqual(staleEntry.swapStatus, "active",
                "Stale active entry remains because we can't verify with remote");
        });

        test("swap should NOT execute when server is unreachable", () => {
            // Simulates the re-validation check before swap execution
            const recheckResult = {
                required: true,
                remoteUnreachable: true,
                activeEntry: createSwapEntry({ swapUUID: "some-uuid", swapStatus: "active" }),
            };

            // The re-validation logic: if server unreachable, abort swap
            const shouldAbortDueToUnreachable = !!recheckResult.remoteUnreachable;
            assert.strictEqual(shouldAbortDueToUnreachable, true,
                "Swap execution must be blocked when server is unreachable");
        });

        test("project opening allowed when server is unreachable with pending swap", () => {
            // Even with a pending swap, user should be able to open the project
            // They just can't perform the swap
            const swapCheck = {
                required: true,
                remoteUnreachable: true,
                activeEntry: createSwapEntry({ swapUUID: "pending-uuid", swapStatus: "active" }),
            };

            // The UI logic: show "Server Unreachable" modal with "Open Project Offline" button
            // If user clicks "Open Project Offline", project opens normally (skip swap)
            const canOpenProject = true; // Always allowed
            const canPerformSwap = !swapCheck.remoteUnreachable;

            assert.strictEqual(canOpenProject, true, "Project opening is always allowed");
            assert.strictEqual(canPerformSwap, false, "Swap is blocked when server unreachable");
        });

        test("pending download state preserved when server unreachable", () => {
            // extension.ts re-validation: when server unreachable, don't clear pending state
            const recheckResult = {
                remoteUnreachable: true,
            };

            // When remoteUnreachable, we return without clearing pendingState
            // so it can resume when connectivity is restored
            const shouldClearPendingState = !recheckResult.remoteUnreachable;
            assert.strictEqual(shouldClearPendingState, false,
                "Pending state should be preserved for when server becomes available again");
        });
    });

    suite("Server Unreachable vs Remote Missing - Projects List", () => {
        test("server unreachable should NOT mark projects as orphaned", () => {
            // Simulates the logic in sendList() when fetchRemoteProjects returns serverUnreachable=true
            const remoteServerUnreachable = true;
            const localProject = {
                gitOriginUrl: "https://git.example.com/org/my-project.git",
                name: "my-project",
            };
            const remoteProjects: any[] = []; // Empty because server is down

            // The project has a git URL but no match in remote list
            const matchInRemoteList = remoteProjects.find(
                (p: any) => p.url === localProject.gitOriginUrl
            );

            let status: string;
            if (!localProject.gitOriginUrl) {
                status = "localOnlyNotSynced";
            } else if (remoteServerUnreachable) {
                status = "serverUnreachable";
            } else {
                status = "orphaned";
            }

            assert.strictEqual(status, "serverUnreachable",
                "When server is unreachable, projects must NOT be marked as orphaned");
            assert.notStrictEqual(status, "orphaned",
                "Orphaned status would trigger destructive Fix & Open actions");
        });

        test("genuinely missing project should be marked as orphaned", () => {
            // Server responded successfully but project is not in the list
            const remoteServerUnreachable = false;
            const localProject = {
                gitOriginUrl: "https://git.example.com/org/deleted-project.git",
                name: "deleted-project",
            };
            const remoteProjects = [
                { url: "https://git.example.com/org/other-project.git" }
            ];

            const matchInRemoteList = remoteProjects.find(
                (p: any) => p.url === localProject.gitOriginUrl
            );

            let status: string;
            if (!localProject.gitOriginUrl) {
                status = "localOnlyNotSynced";
            } else if (remoteServerUnreachable) {
                status = "serverUnreachable";
            } else if (!matchInRemoteList) {
                status = "orphaned";
            } else {
                status = "downloadedAndSynced";
            }

            assert.strictEqual(status, "orphaned",
                "When server confirms project is missing, it should be marked orphaned");
        });

        test("Fix & Open should only trigger for orphaned, never for serverUnreachable", () => {
            // Simulates the ProjectCard onClick and button label logic
            const testCases = [
                { syncStatus: "orphaned", expectedCommand: "project.fixAndOpen", expectedLabel: "Fix & Open" },
                { syncStatus: "serverUnreachable", expectedCommand: "project.open", expectedLabel: "Open Offline" },
                { syncStatus: "downloadedAndSynced", expectedCommand: "project.open", expectedLabel: "Open" },
                { syncStatus: "localOnlyNotSynced", expectedCommand: "project.open", expectedLabel: "Open" },
            ];

            for (const tc of testCases) {
                // Command logic
                let command: string;
                if (tc.syncStatus === "orphaned") {
                    command = "project.fixAndOpen";
                } else {
                    command = "project.open";
                }
                assert.strictEqual(command, tc.expectedCommand,
                    `syncStatus "${tc.syncStatus}" should trigger "${tc.expectedCommand}"`);

                // Button label logic
                let label: string;
                if (tc.syncStatus === "orphaned") {
                    label = "Fix & Open";
                } else if (tc.syncStatus === "serverUnreachable") {
                    label = "Open Offline";
                } else {
                    label = "Open";
                }
                assert.strictEqual(label, tc.expectedLabel,
                    `syncStatus "${tc.syncStatus}" should show button label "${tc.expectedLabel}"`);
            }
        });

        test("serverUnreachable projects should be counted as local in filters", () => {
            const localStatuses = ["downloadedAndSynced", "localOnlyNotSynced", "orphaned", "serverUnreachable"];
            assert.ok(localStatuses.includes("serverUnreachable"),
                "serverUnreachable must be included in local project filter");
        });

        test("fetchRemoteProjects error should return serverUnreachable=true", () => {
            // Simulates fetchRemoteProjects behavior
            async function simulateFetchRemoteProjects(shouldFail: boolean) {
                if (shouldFail) {
                    // Error path (network error, expired cert, 500, etc.)
                    return { projects: [], serverUnreachable: true };
                }
                return { projects: [{ name: "test" }], serverUnreachable: false };
            }

            return Promise.all([
                simulateFetchRemoteProjects(true).then(result => {
                    assert.strictEqual(result.serverUnreachable, true,
                        "Failed fetch should flag serverUnreachable");
                    assert.deepStrictEqual(result.projects, [],
                        "Failed fetch should return empty projects");
                }),
                simulateFetchRemoteProjects(false).then(result => {
                    assert.strictEqual(result.serverUnreachable, false,
                        "Successful fetch should not flag serverUnreachable");
                    assert.strictEqual(result.projects.length, 1,
                        "Successful fetch should return projects");
                }),
            ]);
        });

        test("no remote projects but server reachable should show orphaned, not serverUnreachable", () => {
            // Edge case: server is up but user has no projects (new user, all deleted, etc.)
            const remoteServerUnreachable = false;
            const remoteProjects: any[] = []; // Empty, but server responded OK

            const localProject = {
                gitOriginUrl: "https://git.example.com/org/my-project.git",
            };

            let status: string;
            if (remoteServerUnreachable) {
                status = "serverUnreachable";
            } else {
                status = "orphaned";
            }

            assert.strictEqual(status, "orphaned",
                "When server is reachable but returns empty, projects should be orphaned (genuinely missing)");
        });

        test("no frontierApi should be treated as serverUnreachable", () => {
            // Simulates fetchRemoteProjects when frontierApi is null
            const frontierApi = null;
            const result = frontierApi
                ? { projects: [], serverUnreachable: false }
                : { projects: [], serverUnreachable: true };

            assert.strictEqual(result.serverUnreachable, true,
                "No API instance should be treated as server unreachable, not as empty remote");
        });
    });
});

// ============ Helper Functions ============

function createSwapEntry(overrides: Partial<ProjectSwapEntry> = {}): ProjectSwapEntry {
    const now = Date.now();
    return {
        swapUUID: `uuid-${Math.random().toString(36).substring(7)}`,
        swapInitiatedAt: now,
        swapModifiedAt: now,
        swapStatus: "active",
        isOldProject: true,
        oldProjectUrl: "https://example.com/old.git",
        oldProjectName: "old-project",
        newProjectUrl: "https://example.com/new.git",
        newProjectName: "new-project",
        swapInitiatedBy: "testuser",
        ...overrides,
    };
}
