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
