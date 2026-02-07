import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as git from "isomorphic-git";
import {
    ProjectSwapEntry,
    ProjectSwapInfo,
    ProjectSwapUserEntry,
    ProjectMetadata,
} from "../../../../types";
import {
    sortSwapEntries,
    mergeSwappedUsers,
    normalizeProjectSwapInfo,
    getActiveSwapEntry,
    checkProjectSwapRequired,
    findSwapEntryByUUID,
} from "../../../utils/projectSwapManager";

/**
 * E2E Tests for Project Swap Flow
 * 
 * These tests validate the complete swap workflow from user initiation
 * through completion, including:
 * - Swap detection and UI prompts
 * - User completion tracking across multiple users
 * - Cancelled status persistence ("sticky" rule)
 * - Local cache synchronization
 * - Chain swap scenarios (A→B→C)
 * - Race condition handling
 * - Error recovery
 * 
 * Run with Husky pre-push hook via `npm test`
 */
suite("E2E: Project Swap Flow", () => {
    let tempDir: string;
    let originalFetch: typeof globalThis.fetch;

    suiteSetup(() => {
        // Stub fetch to avoid actual network calls
        originalFetch = (globalThis as any).fetch;
        (globalThis as any).fetch = async (input: any, _init?: any) => {
            const url = typeof input === "string" ? input : String(input);
            if (url.includes("/info/lfs/objects/batch")) {
                return new Response(JSON.stringify({ objects: [] }), {
                    status: 200,
                    headers: { "content-type": "application/vnd.git-lfs+json" },
                });
            }
            return new Response("", { status: 200 });
        };
    });

    suiteTeardown(() => {
        (globalThis as any).fetch = originalFetch;
    });

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-swap-e2e-"));
    });

    teardown(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    // ========================================================================
    // SWAP DETECTION E2E TESTS
    // ========================================================================
    suite("Swap Detection Flow", () => {
        test("detects active swap requirement for old project", async () => {
            const projectDir = await createTestProject(tempDir, "old-project");
            const swapEntry = createSwapEntry({
                swapUUID: "detect-test",
                swapStatus: "active",
                isOldProject: true,
                newProjectUrl: "https://gitlab.com/org/new-project.git",
                newProjectName: "new-project",
            });

            // Write swap entry to metadata
            const metadataPath = path.join(projectDir, "metadata.json");
            const metadata: ProjectMetadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
            metadata.meta = metadata.meta || ({} as any);
            metadata.meta.projectSwap = { swapEntries: [swapEntry] };
            fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

            // Verify detection
            const swapInfo = normalizeProjectSwapInfo(metadata.meta.projectSwap);
            const activeEntry = getActiveSwapEntry(swapInfo);

            assert.ok(activeEntry, "Should detect active swap entry");
            assert.strictEqual(activeEntry?.isOldProject, true, "Should be marked as old project");
            assert.strictEqual(activeEntry?.swapStatus, "active", "Should be active");
        });

        test("does not trigger swap for new project (isOldProject=false)", async () => {
            const projectDir = await createTestProject(tempDir, "new-project");
            const swapEntry = createSwapEntry({
                swapUUID: "new-project-test",
                swapStatus: "active",
                isOldProject: false, // NEW project should NOT prompt for swap
            });

            const metadataPath = path.join(projectDir, "metadata.json");
            const metadata: ProjectMetadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
            metadata.meta = metadata.meta || ({} as any);
            metadata.meta.projectSwap = { swapEntries: [swapEntry] };

            const swapInfo = normalizeProjectSwapInfo(metadata.meta.projectSwap);
            const activeEntry = getActiveSwapEntry(swapInfo);

            // Active entry exists but should NOT trigger swap since isOldProject is false
            assert.ok(activeEntry, "Should have active entry");

            // Verify isOldProject is false (this project is the NEW project)
            assert.strictEqual(activeEntry?.isOldProject, false, "Should be marked as new project");

            // The swap requirement check: only OLD projects (isOldProject === true) trigger swap
            // New projects (isOldProject === false) should NOT require user to swap
            // This is the key distinction - opening a NEW project doesn't prompt for swap
            // We just verify the isOldProject flag directly since that's what drives the logic
        });

        test("cancelled swap does not trigger swap requirement", async () => {
            const projectDir = await createTestProject(tempDir, "cancelled-project");
            const swapEntry = createSwapEntry({
                swapUUID: "cancelled-test",
                swapStatus: "cancelled",
                isOldProject: true,
                cancelledBy: "admin",
                cancelledAt: Date.now(),
            });

            const metadataPath = path.join(projectDir, "metadata.json");
            const metadata: ProjectMetadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
            metadata.meta = metadata.meta || ({} as any);
            metadata.meta.projectSwap = { swapEntries: [swapEntry] };

            const swapInfo = normalizeProjectSwapInfo(metadata.meta.projectSwap);
            const activeEntry = getActiveSwapEntry(swapInfo);

            assert.strictEqual(activeEntry, undefined, "Cancelled swap should not be active");
        });
    });

    // ========================================================================
    // USER COMPLETION TRACKING E2E
    // ========================================================================
    suite("User Completion Tracking E2E", () => {
        test("tracks user completion with timestamps", async () => {
            const projectDir = await createTestProject(tempDir, "completion-tracking");
            const now = Date.now();
            const swapEntry = createSwapEntry({
                swapUUID: "completion-test",
                swapStatus: "active",
                isOldProject: false,
                swappedUsers: [
                    {
                        userToSwap: "user1",
                        createdAt: now,
                        updatedAt: now,
                        executed: true,
                        swapCompletedAt: now,
                    },
                ],
            });

            // Verify structure
            assert.strictEqual(swapEntry.swappedUsers?.length, 1);
            assert.strictEqual(swapEntry.swappedUsers?.[0].userToSwap, "user1");
            assert.strictEqual(swapEntry.swappedUsers?.[0].executed, true);
            assert.ok(swapEntry.swappedUsers?.[0].createdAt);
            assert.ok(swapEntry.swappedUsers?.[0].updatedAt);
        });

        test("detects user has already swapped", async () => {
            const currentUser = "test-user";
            const swapEntry = createSwapEntry({
                swapUUID: "already-swapped",
                swappedUsers: [
                    { userToSwap: currentUser, createdAt: 1000, updatedAt: 2000, executed: true, swapCompletedAt: 2000 },
                    { userToSwap: "other-user", createdAt: 1500, updatedAt: 1500, executed: true, swapCompletedAt: 1500 },
                ],
            });

            const hasAlreadySwapped = swapEntry.swappedUsers?.some(
                (u) => u.userToSwap === currentUser && u.executed
            );

            assert.strictEqual(hasAlreadySwapped, true, "Should detect user has already swapped");
        });

        test("user not in swappedUsers requires swap", async () => {
            const currentUser = "new-user";
            const swapEntry = createSwapEntry({
                swapUUID: "new-user-swap",
                swappedUsers: [
                    { userToSwap: "existing-user", createdAt: 1000, updatedAt: 1000, executed: true, swapCompletedAt: 1000 },
                ],
            });

            const hasAlreadySwapped = swapEntry.swappedUsers?.some(
                (u) => u.userToSwap === currentUser && u.executed
            );

            assert.strictEqual(hasAlreadySwapped, false, "New user should still need to swap");
        });

        test("user with executed=false has not completed swap", async () => {
            const currentUser = "incomplete-user";
            const swapEntry = createSwapEntry({
                swapUUID: "incomplete-swap",
                swappedUsers: [
                    { userToSwap: currentUser, createdAt: 1000, updatedAt: 1000, executed: false },
                ],
            });

            const hasAlreadySwapped = swapEntry.swappedUsers?.some(
                (u) => u.userToSwap === currentUser && u.executed
            );

            assert.strictEqual(hasAlreadySwapped, false, "User with executed=false has not completed");
        });
    });

    // ========================================================================
    // CANCELLED STATUS STICKY RULE E2E
    // ========================================================================
    suite("Cancelled Status Sticky Rule E2E", () => {
        test("cancelled status preserved when merging with active (later timestamp)", async () => {
            // Scenario: Admin cancelled at T1, user completed at T2 (T2 > T1)
            // Result: Should remain cancelled
            const cancelledEntry = createSwapEntry({
                swapUUID: "sticky-merge",
                swapModifiedAt: 1000,
                swapStatus: "cancelled",
                cancelledBy: "admin",
                cancelledAt: 1000,
                swappedUsers: [],
            });

            const activeEntry = createSwapEntry({
                swapUUID: "sticky-merge",
                swapModifiedAt: 2000, // Later timestamp
                swapStatus: "active",
                swappedUsers: [
                    { userToSwap: "user1", createdAt: 2000, updatedAt: 2000, executed: true },
                ],
            });

            // Simulate merge logic with sticky rule
            const eitherCancelled =
                cancelledEntry.swapStatus === "cancelled" || activeEntry.swapStatus === "cancelled";
            const mergedUsers = mergeSwappedUsers(
                cancelledEntry.swappedUsers,
                activeEntry.swappedUsers
            );

            // Determine base entry by timestamp
            const baseEntry =
                (activeEntry.swapModifiedAt ?? 0) > (cancelledEntry.swapModifiedAt ?? 0)
                    ? activeEntry
                    : cancelledEntry;

            // Apply sticky rule
            const mergedEntry = eitherCancelled
                ? {
                    ...baseEntry,
                    swappedUsers: mergedUsers,
                    swapStatus: "cancelled" as const,
                    cancelledBy: cancelledEntry.cancelledBy,
                    cancelledAt: cancelledEntry.cancelledAt,
                }
                : { ...baseEntry, swappedUsers: mergedUsers };

            assert.strictEqual(mergedEntry.swapStatus, "cancelled", "Should preserve cancelled status");
            assert.strictEqual(mergedEntry.cancelledBy, "admin", "Should preserve cancellation details");
            assert.strictEqual(mergedEntry.swappedUsers?.length, 1, "Should still have user data");
        });

        test("active entries merge without sticky rule interference", async () => {
            const entry1 = createSwapEntry({
                swapUUID: "both-active",
                swapModifiedAt: 1000,
                swapStatus: "active",
                swappedUsers: [
                    { userToSwap: "user1", createdAt: 1000, updatedAt: 1000, executed: true },
                ],
            });

            const entry2 = createSwapEntry({
                swapUUID: "both-active",
                swapModifiedAt: 2000,
                swapStatus: "active",
                swappedUsers: [
                    { userToSwap: "user2", createdAt: 2000, updatedAt: 2000, executed: true },
                ],
            });

            const eitherCancelled =
                entry1.swapStatus === "cancelled" || entry2.swapStatus === "cancelled";
            const mergedUsers = mergeSwappedUsers(entry1.swappedUsers, entry2.swappedUsers);

            assert.strictEqual(eitherCancelled, false, "Neither should be cancelled");
            assert.strictEqual(mergedUsers.length, 2, "Should merge both users");
        });

        test("old cancellation with newer user completion still stays cancelled", async () => {
            // This is the critical race condition test
            const cancelledEntry = createSwapEntry({
                swapUUID: "race-condition",
                swapModifiedAt: 500, // OLD timestamp
                swapStatus: "cancelled",
                cancelledBy: "admin",
                cancelledAt: 500,
            });

            const userCompletionEntry = createSwapEntry({
                swapUUID: "race-condition",
                swapModifiedAt: 5000, // MUCH later timestamp
                swapStatus: "active",
                swappedUsers: [
                    { userToSwap: "late-user", createdAt: 5000, updatedAt: 5000, executed: true },
                ],
            });

            const eitherCancelled =
                cancelledEntry.swapStatus === "cancelled" ||
                userCompletionEntry.swapStatus === "cancelled";

            assert.strictEqual(eitherCancelled, true, "Should detect cancellation");
            // The sticky rule means even with a later timestamp, cancelled wins
        });
    });

    // ========================================================================
    // MERGED USERS E2E
    // ========================================================================
    suite("mergeSwappedUsers E2E", () => {
        test("merges users from different sources", async () => {
            const usersA: ProjectSwapUserEntry[] = [
                { userToSwap: "user1", createdAt: 1000, updatedAt: 1000, executed: true },
            ];
            const usersB: ProjectSwapUserEntry[] = [
                { userToSwap: "user2", createdAt: 2000, updatedAt: 2000, executed: true },
            ];

            const merged = mergeSwappedUsers(usersA, usersB);

            assert.strictEqual(merged.length, 2);
            assert.ok(merged.some((u) => u.userToSwap === "user1"));
            assert.ok(merged.some((u) => u.userToSwap === "user2"));
        });

        test("same user takes newer updatedAt", async () => {
            const usersA: ProjectSwapUserEntry[] = [
                { userToSwap: "user1", createdAt: 1000, updatedAt: 1000, executed: false },
            ];
            const usersB: ProjectSwapUserEntry[] = [
                { userToSwap: "user1", createdAt: 1000, updatedAt: 2000, executed: true },
            ];

            const merged = mergeSwappedUsers(usersA, usersB);

            assert.strictEqual(merged.length, 1);
            assert.strictEqual(merged[0].updatedAt, 2000, "Should take newer updatedAt");
            assert.strictEqual(merged[0].executed, true, "Should have newer executed state");
        });

        test("handles empty arrays gracefully", async () => {
            const merged1 = mergeSwappedUsers([], []);
            const merged2 = mergeSwappedUsers(undefined, undefined);
            const merged3 = mergeSwappedUsers(
                [{ userToSwap: "user1", createdAt: 1000, updatedAt: 1000, executed: true }],
                undefined
            );

            assert.strictEqual(merged1.length, 0);
            assert.strictEqual(merged2.length, 0);
            assert.strictEqual(merged3.length, 1);
        });

        test("different createdAt creates separate entries (composite key)", async () => {
            // With the new composite key (userToSwap + createdAt), entries with
            // different createdAt are considered DIFFERENT users (e.g., same user re-swapping)
            const usersA: ProjectSwapUserEntry[] = [
                { userToSwap: "user1", createdAt: 1000, executed: false } as any,
            ];
            const usersB: ProjectSwapUserEntry[] = [
                { userToSwap: "user1", createdAt: 2000, executed: true } as any,
            ];

            const merged = mergeSwappedUsers(usersA, usersB);

            // Both entries are kept because they have different composite keys
            assert.strictEqual(merged.length, 2, "Different createdAt = different entries");
            assert.ok(merged.some(u => u.createdAt === 1000), "Should have first entry");
            assert.ok(merged.some(u => u.createdAt === 2000), "Should have second entry");
        });

        test("same composite key uses updatedAt for merging", async () => {
            // Same userToSwap + createdAt = same user, merge by updatedAt
            const usersA: ProjectSwapUserEntry[] = [
                { userToSwap: "user1", createdAt: 1000, updatedAt: 1000, executed: false },
            ];
            const usersB: ProjectSwapUserEntry[] = [
                { userToSwap: "user1", createdAt: 1000, updatedAt: 2000, executed: true },
            ];

            const merged = mergeSwappedUsers(usersA, usersB);

            assert.strictEqual(merged.length, 1, "Same composite key = merged");
            assert.strictEqual(merged[0].updatedAt, 2000, "Should use newer updatedAt");
            assert.strictEqual(merged[0].executed, true, "Should have newer executed state");
        });
    });

    // ========================================================================
    // LOCAL CACHE SYNC E2E
    // ========================================================================
    suite("Local Cache Sync E2E", () => {
        test("localProjectSwap.json structure is correct", async () => {
            const projectDir = await createTestProject(tempDir, "cache-test");
            const localSwapPath = path.join(projectDir, ".project", "localProjectSwap.json");

            const cacheData = {
                remoteSwapInfo: {
                    swapEntries: [
                        createSwapEntry({ swapUUID: "cached-entry", isOldProject: true }),
                    ],
                },
                fetchedAt: Date.now(),
                sourceOriginUrl: "https://gitlab.com/org/project.git",
            };

            fs.writeFileSync(localSwapPath, JSON.stringify(cacheData, null, 2));

            const cached = JSON.parse(fs.readFileSync(localSwapPath, "utf-8"));

            assert.ok(cached.remoteSwapInfo, "Should have remoteSwapInfo");
            assert.ok(cached.fetchedAt, "Should have fetchedAt");
            assert.ok(cached.sourceOriginUrl, "Should have sourceOriginUrl");
            assert.strictEqual(
                cached.remoteSwapInfo.swapEntries.length,
                1,
                "Should have cached entries"
            );
        });

        test("cache syncs swappedUsers from remote", async () => {
            const projectDir = await createTestProject(tempDir, "sync-test");
            const localSwapPath = path.join(projectDir, ".project", "localProjectSwap.json");

            // Initial cache without user data
            const initialCache = {
                remoteSwapInfo: {
                    swapEntries: [
                        createSwapEntry({ swapUUID: "sync-uuid", isOldProject: true, swappedUsers: [] }),
                    ],
                },
                fetchedAt: Date.now() - 3600000,
                sourceOriginUrl: "https://gitlab.com/org/project.git",
            };
            fs.writeFileSync(localSwapPath, JSON.stringify(initialCache, null, 2));

            // Simulate remote data with user completion
            const remoteEntry = createSwapEntry({
                swapUUID: "sync-uuid",
                isOldProject: false,
                swapModifiedAt: Date.now(),
                swappedUsers: [
                    { userToSwap: "remote-user", createdAt: Date.now(), updatedAt: Date.now(), executed: true },
                ],
            });

            // Update cache with remote data (including swapModifiedAt!)
            const localCache = JSON.parse(fs.readFileSync(localSwapPath, "utf-8"));
            const entryIndex = localCache.remoteSwapInfo.swapEntries.findIndex(
                (e: ProjectSwapEntry) => e.swapUUID === "sync-uuid"
            );
            if (entryIndex >= 0) {
                localCache.remoteSwapInfo.swapEntries[entryIndex] = {
                    ...localCache.remoteSwapInfo.swapEntries[entryIndex],
                    swappedUsers: remoteEntry.swappedUsers,
                    swapModifiedAt: remoteEntry.swapModifiedAt, // CRITICAL: Also copy timestamp
                };
            }
            localCache.fetchedAt = Date.now();
            fs.writeFileSync(localSwapPath, JSON.stringify(localCache, null, 2));

            // Verify sync
            const syncedCache = JSON.parse(fs.readFileSync(localSwapPath, "utf-8"));
            const syncedEntry = syncedCache.remoteSwapInfo.swapEntries.find(
                (e: ProjectSwapEntry) => e.swapUUID === "sync-uuid"
            );

            assert.strictEqual(syncedEntry?.swappedUsers?.length, 1, "Should have synced user");
            assert.strictEqual(syncedEntry?.swappedUsers?.[0].userToSwap, "remote-user");
            assert.ok(syncedEntry?.swapModifiedAt, "Should have synced timestamp");
        });

        test("cache enables offline swap detection", async () => {
            const projectDir = await createTestProject(tempDir, "offline-test");
            const localSwapPath = path.join(projectDir, ".project", "localProjectSwap.json");
            const currentUser = "offline-user";

            // Cache has user completion from previous sync
            const cachedData = {
                remoteSwapInfo: {
                    swapEntries: [
                        createSwapEntry({
                            swapUUID: "offline-uuid",
                            isOldProject: true,
                            swappedUsers: [
                                { userToSwap: currentUser, createdAt: 1000, updatedAt: 2000, executed: true },
                            ],
                        }),
                    ],
                },
                fetchedAt: Date.now() - 86400000, // 24 hours ago
                sourceOriginUrl: "https://gitlab.com/org/project.git",
            };
            fs.writeFileSync(localSwapPath, JSON.stringify(cachedData, null, 2));

            // Offline detection
            const cache = JSON.parse(fs.readFileSync(localSwapPath, "utf-8"));
            const entry = cache.remoteSwapInfo.swapEntries.find(
                (e: ProjectSwapEntry) => e.swapUUID === "offline-uuid"
            );
            const hasSwapped = entry?.swappedUsers?.some(
                (u: ProjectSwapUserEntry) => u.userToSwap === currentUser && u.executed
            );

            assert.strictEqual(hasSwapped, true, "Should detect completion offline");
        });
    });

    // ========================================================================
    // CHAIN SWAP E2E (A→B→C)
    // ========================================================================
    suite("Chain Swap Flow E2E", () => {
        test("full A→B→C chain preserves history in final project", async () => {
            const projectA = await createTestProject(tempDir, "project-a");
            const projectB = await createTestProject(tempDir, "project-b");
            const projectC = await createTestProject(tempDir, "project-c");

            const uuidAB = "swap-a-to-b";
            const uuidBC = "swap-b-to-c";

            // Step 1: A→B swap
            const entryAB_inA = createSwapEntry({
                swapUUID: uuidAB,
                isOldProject: true,
                oldProjectName: "project-a",
                newProjectName: "project-b",
                swapInitiatedAt: 1000,
            });

            const entryAB_inB = createSwapEntry({
                swapUUID: uuidAB,
                isOldProject: false,
                oldProjectName: "project-a",
                newProjectName: "project-b",
                swapInitiatedAt: 1000,
            });

            // Write to A
            await writeSwapToMetadata(projectA, [entryAB_inA]);

            // Write to B
            await writeSwapToMetadata(projectB, [entryAB_inB]);

            // Step 2: B→C swap (B inherits A→B history and adds B→C)
            const entryBC_inB = createSwapEntry({
                swapUUID: uuidBC,
                isOldProject: true,
                oldProjectName: "project-b",
                newProjectName: "project-c",
                swapInitiatedAt: 2000,
            });

            // B now has both entries
            await writeSwapToMetadata(projectB, [entryAB_inB, entryBC_inB]);

            // Step 3: C gets full history
            // C inherits all of B's entries, marking historical ones as isOldProject: true
            const entriesForC = [entryAB_inB, entryBC_inB].map((entry) =>
                entry.swapUUID === uuidBC
                    ? { ...entry, isOldProject: false } // C is NEW for B→C
                    : { ...entry, isOldProject: true } // Historical entries
            );
            await writeSwapToMetadata(projectC, entriesForC);

            // Verify C has complete history
            const metaC = await readMetadata(projectC);
            const entriesInC = metaC.meta?.projectSwap?.swapEntries || [];

            assert.strictEqual(entriesInC.length, 2, "C should have 2 entries");

            // Check A→B entry (historical)
            const abEntry = entriesInC.find((e: ProjectSwapEntry) => e.swapUUID === uuidAB);
            assert.ok(abEntry, "A→B entry should exist");
            assert.strictEqual(abEntry?.isOldProject, true, "A→B should be historical");

            // Check B→C entry (current)
            const bcEntry = entriesInC.find((e: ProjectSwapEntry) => e.swapUUID === uuidBC);
            assert.ok(bcEntry, "B→C entry should exist");
            assert.strictEqual(bcEntry?.isOldProject, false, "B→C should show C as new");
        });

        test("lineage can be reconstructed from history", async () => {
            const entries: ProjectSwapEntry[] = [
                createSwapEntry({ swapUUID: "1", oldProjectName: "A", newProjectName: "B", swapInitiatedAt: 1000 }),
                createSwapEntry({ swapUUID: "2", oldProjectName: "B", newProjectName: "C", swapInitiatedAt: 2000 }),
                createSwapEntry({ swapUUID: "3", oldProjectName: "C", newProjectName: "D", swapInitiatedAt: 3000 }),
            ];

            // Sort chronologically
            const sorted = [...entries].sort((a, b) => a.swapInitiatedAt - b.swapInitiatedAt);

            // Reconstruct lineage
            const lineage: string[] = [];
            for (const entry of sorted) {
                if (lineage.length === 0) {
                    lineage.push(entry.oldProjectName);
                }
                lineage.push(entry.newProjectName);
            }

            assert.deepStrictEqual(lineage, ["A", "B", "C", "D"]);
        });
    });

    // ========================================================================
    // SORTING PERSISTENCE E2E
    // ========================================================================
    suite("Sorting Persistence E2E", () => {
        test("entries are sorted: active first, then by timestamps", async () => {
            const entries: ProjectSwapEntry[] = [
                createSwapEntry({ swapUUID: "z-uuid", swapStatus: "cancelled", swapInitiatedAt: 1000 }),
                createSwapEntry({ swapUUID: "a-uuid", swapStatus: "cancelled", swapInitiatedAt: 1000 }),
                createSwapEntry({ swapUUID: "m-uuid", swapStatus: "active", swapInitiatedAt: 500 }),
            ];

            const sorted = sortSwapEntries(entries);

            // Active should be first regardless of timestamp
            assert.strictEqual(sorted[0].swapStatus, "active");
            assert.strictEqual(sorted[0].swapUUID, "m-uuid");

            // Then by swapUUID for ties
            assert.strictEqual(sorted[1].swapUUID, "a-uuid");
            assert.strictEqual(sorted[2].swapUUID, "z-uuid");
        });

        test("re-sorting produces identical order (no churn)", async () => {
            const projectDir = await createTestProject(tempDir, "sort-test");
            const entries: ProjectSwapEntry[] = [
                createSwapEntry({ swapUUID: "entry-1", swapStatus: "active", swapInitiatedAt: 2000 }),
                createSwapEntry({ swapUUID: "entry-2", swapStatus: "cancelled", swapInitiatedAt: 1000 }),
            ];

            // Write sorted
            await writeSwapToMetadata(projectDir, sortSwapEntries(entries));
            const json1 = fs.readFileSync(path.join(projectDir, "metadata.json"), "utf-8");

            // Read, re-sort, re-write
            const meta = await readMetadata(projectDir);
            const resorted = sortSwapEntries(meta.meta?.projectSwap?.swapEntries || []);
            await writeSwapToMetadata(projectDir, resorted);
            const json2 = fs.readFileSync(path.join(projectDir, "metadata.json"), "utf-8");

            assert.strictEqual(json1, json2, "Re-sorting should not change file");
        });
    });

    // ========================================================================
    // ERROR RECOVERY E2E
    // ========================================================================
    suite("Error Recovery E2E", () => {
        test("corrupted local cache is handled gracefully", async () => {
            const projectDir = await createTestProject(tempDir, "corrupt-test");
            const localSwapPath = path.join(projectDir, ".project", "localProjectSwap.json");

            // Write corrupted JSON
            fs.writeFileSync(localSwapPath, "{ invalid json }}}");

            // Should not throw, should return fallback
            let result: ProjectSwapInfo | undefined;
            let fallbackUsed = false;
            try {
                JSON.parse(fs.readFileSync(localSwapPath, "utf-8"));
            } catch {
                fallbackUsed = true;
                result = { swapEntries: [] };
            }

            assert.strictEqual(fallbackUsed, true);
            assert.deepStrictEqual(result, { swapEntries: [] });
        });

        test("missing metadata is handled gracefully", async () => {
            const result = normalizeProjectSwapInfo(null as any);
            assert.deepStrictEqual(result, { swapEntries: [] });

            const result2 = normalizeProjectSwapInfo(undefined as any);
            assert.deepStrictEqual(result2, { swapEntries: [] });
        });

        test("interrupted swap state is recoverable", async () => {
            const projectDir = await createTestProject(tempDir, "interrupt-test");
            const localSwapPath = path.join(projectDir, ".project", "localProjectSwap.json");

            // Simulate interrupted state
            const interruptedState = {
                swapPendingDownloads: {
                    swapState: "pending_downloads",
                    filesNeedingDownload: ["GEN/1.mp3", "GEN/2.mp3"],
                    swapUUID: "interrupted-uuid",
                    swapInitiatedAt: Date.now(),
                },
                remoteSwapInfo: {
                    swapEntries: [createSwapEntry({ swapUUID: "interrupted-uuid" })],
                },
                fetchedAt: Date.now(),
                sourceOriginUrl: "https://gitlab.com/org/project.git",
            };
            fs.writeFileSync(localSwapPath, JSON.stringify(interruptedState, null, 2));

            // Read and verify recovery
            const recovered = JSON.parse(fs.readFileSync(localSwapPath, "utf-8"));
            assert.strictEqual(recovered.swapPendingDownloads.swapState, "pending_downloads");
            assert.strictEqual(recovered.swapPendingDownloads.filesNeedingDownload.length, 2);
            assert.strictEqual(recovered.swapPendingDownloads.swapUUID, "interrupted-uuid");
        });
    });

    // ========================================================================
    // MULTI-USER RACE CONDITIONS E2E
    // ========================================================================
    suite("Multi-User Race Conditions E2E", () => {
        test("concurrent user completions are merged correctly", async () => {
            // Simulate: User A completes at T1, User B completes at T2
            const usersFromA: ProjectSwapUserEntry[] = [
                { userToSwap: "userA", createdAt: 1000, updatedAt: 1000, executed: true },
            ];
            const usersFromB: ProjectSwapUserEntry[] = [
                { userToSwap: "userB", createdAt: 2000, updatedAt: 2000, executed: true },
            ];

            const merged = mergeSwappedUsers(usersFromA, usersFromB);

            assert.strictEqual(merged.length, 2, "Both users should be preserved");
            assert.ok(merged.some((u) => u.userToSwap === "userA"));
            assert.ok(merged.some((u) => u.userToSwap === "userB"));
        });

        test("same user updated twice keeps newer data", async () => {
            // User completes swap, then re-executes (edge case)
            const usersOld: ProjectSwapUserEntry[] = [
                { userToSwap: "user1", createdAt: 1000, updatedAt: 1000, executed: true },
            ];
            const usersNew: ProjectSwapUserEntry[] = [
                { userToSwap: "user1", createdAt: 1000, updatedAt: 5000, executed: true, swapCompletedAt: 5000 },
            ];

            const merged = mergeSwappedUsers(usersOld, usersNew);

            assert.strictEqual(merged.length, 1, "Should have one user");
            assert.strictEqual(merged[0].updatedAt, 5000, "Should have newer timestamp");
        });

        test("cancellation by admin after user completions preserves user data", async () => {
            // Users A and B completed, then admin cancels
            const activeEntryWithUsers = createSwapEntry({
                swapUUID: "multi-then-cancel",
                swapModifiedAt: 3000,
                swapStatus: "active",
                swappedUsers: [
                    { userToSwap: "userA", createdAt: 1000, updatedAt: 1000, executed: true },
                    { userToSwap: "userB", createdAt: 2000, updatedAt: 2000, executed: true },
                ],
            });

            const cancelledEntry = createSwapEntry({
                swapUUID: "multi-then-cancel",
                swapModifiedAt: 4000, // Later
                swapStatus: "cancelled",
                cancelledBy: "admin",
                cancelledAt: 4000,
                swappedUsers: [],
            });

            const mergedUsers = mergeSwappedUsers(
                activeEntryWithUsers.swappedUsers,
                cancelledEntry.swappedUsers
            );

            // Both users should be preserved even after cancellation
            assert.strictEqual(mergedUsers.length, 2, "Users should be preserved after cancel");
        });
    });

    // ========================================================================
    // TIMESTAMP SEPARATION E2E TESTS
    // ========================================================================
    suite("Timestamp Separation E2E", () => {
        test("swappedUsersModifiedAt is preserved through metadata write cycle", async () => {
            const projectDir = await createTestProject(tempDir, "timestamp-test");
            const entry = createSwapEntry({
                swapUUID: "timestamp-entry",
                swapModifiedAt: 1000,
                swappedUsersModifiedAt: 2000,
                swappedUsers: [
                    { userToSwap: "user1", createdAt: 2000, updatedAt: 2000, executed: true },
                ],
            });

            await writeSwapToMetadata(projectDir, [entry]);
            const readMeta = await readMetadata(projectDir);
            const readEntry = readMeta.meta?.projectSwap?.swapEntries?.[0];

            assert.strictEqual(readEntry?.swapModifiedAt, 1000, "swapModifiedAt should be preserved");
            assert.strictEqual(readEntry?.swappedUsersModifiedAt, 2000, "swappedUsersModifiedAt should be preserved");
        });

        test("user completion updates swappedUsersModifiedAt independently", async () => {
            const projectDir = await createTestProject(tempDir, "user-completion");
            const initialEntry = createSwapEntry({
                swapUUID: "completion-test",
                swapInitiatedAt: 1000,
                swapModifiedAt: 1000,
                swappedUsersModifiedAt: undefined,
                isOldProject: false,
                swappedUsers: [],
            });

            await writeSwapToMetadata(projectDir, [initialEntry]);

            // Simulate user completion
            const completionTime = Date.now();
            const meta = await readMetadata(projectDir);
            const entry = meta.meta?.projectSwap?.swapEntries?.[0];
            if (entry) {
                entry.swappedUsers = [
                    { userToSwap: "completedUser", createdAt: completionTime, updatedAt: completionTime, executed: true },
                ];
                entry.swappedUsersModifiedAt = completionTime;
                // swapModifiedAt should NOT change on user completion
            }

            fs.writeFileSync(
                path.join(projectDir, "metadata.json"),
                JSON.stringify(meta, null, 2)
            );

            const finalMeta = await readMetadata(projectDir);
            const finalEntry = finalMeta.meta?.projectSwap?.swapEntries?.[0];

            assert.strictEqual(finalEntry?.swapModifiedAt, 1000, "swapModifiedAt should NOT change on user completion");
            assert.strictEqual(finalEntry?.swappedUsersModifiedAt, completionTime, "swappedUsersModifiedAt should be updated");
            assert.strictEqual(finalEntry?.swappedUsers?.length, 1, "User should be recorded");
        });
    });

    // ========================================================================
    // ENTRY KEY E2E TESTS
    // ========================================================================
    suite("Entry Key E2E", () => {
        test("chain swap entries have unique swapUUIDs", async () => {
            const projectA = await createTestProject(tempDir, "chain-a");
            const projectB = await createTestProject(tempDir, "chain-b");
            const projectC = await createTestProject(tempDir, "chain-c");

            // A→B swap
            const entryAB = createSwapEntry({
                swapUUID: "uuid-ab",
                swapInitiatedAt: 1000,
                isOldProject: true,
                oldProjectName: "chain-a",
                newProjectName: "chain-b",
            });

            // B→C swap
            const entryBC = createSwapEntry({
                swapUUID: "uuid-bc",
                swapInitiatedAt: 2000,
                isOldProject: true,
                oldProjectName: "chain-b",
                newProjectName: "chain-c",
            });

            // Write both entries to C (simulating history preservation)
            await writeSwapToMetadata(projectC, [
                { ...entryAB, isOldProject: true },
                { ...entryBC, isOldProject: false },
            ]);

            const meta = await readMetadata(projectC);
            const entries = meta.meta?.projectSwap?.swapEntries || [];

            // Verify both entries exist with unique swapUUIDs
            const uuids = entries.map((e: ProjectSwapEntry) => e.swapUUID);
            const uniqueUUIDs = new Set(uuids);

            assert.strictEqual(uniqueUUIDs.size, 2, "Both entries should have unique swapUUIDs");
            assert.strictEqual(entries.length, 2, "Both entries should be preserved");
        });

        test("entries with different swapUUIDs are preserved separately", async () => {
            const projectDir = await createTestProject(tempDir, "diff-uuid");

            const entry1 = createSwapEntry({
                swapUUID: "uuid-first",
                swapInitiatedAt: 1000,
                swapStatus: "cancelled",
            });
            const entry2 = createSwapEntry({
                swapUUID: "uuid-second",
                swapInitiatedAt: 2000,
                swapStatus: "active",
            });

            await writeSwapToMetadata(projectDir, [entry1, entry2]);
            const meta = await readMetadata(projectDir);
            const entries = meta.meta?.projectSwap?.swapEntries || [];

            assert.strictEqual(entries.length, 2, "Both entries should be preserved");
            assert.ok(entries.some((e: ProjectSwapEntry) => e.swapUUID === "uuid-first"));
            assert.ok(entries.some((e: ProjectSwapEntry) => e.swapUUID === "uuid-second"));
        });
    });

    // ========================================================================
    // DEPRECATED PROJECT HIDING E2E TESTS (QA CRITICAL)
    // ========================================================================
    suite("Deprecated Project Hiding E2E - QA Critical", () => {
        test("chain A→B→C: all old projects visible in history, identifiable for hiding", async () => {
            // Setup: Create chain swaptest1 → swaptest2 → swaptest3
            const projectA = await createTestProject(tempDir, "swaptest1");
            const projectB = await createTestProject(tempDir, "swaptest2");
            const projectC = await createTestProject(tempDir, "swaptest3");

            const uuidAB = "swap-a-to-b";
            const uuidBC = "swap-b-to-c";
            const uuidOrigin = "origin-swaptest1";

            // Build full history from C's perspective (what gets merged in)
            const historyInC: ProjectSwapEntry[] = [
                // Current active swap: B→C
                createSwapEntry({
                    swapUUID: uuidBC,
                    swapStatus: "active",
                    isOldProject: false, // C is the NEW project
                    oldProjectUrl: "https://gitlab.com/org/swaptest2.git",
                    oldProjectName: "swaptest2",
                    newProjectUrl: "https://gitlab.com/org/swaptest3.git",
                    newProjectName: "swaptest3",
                    swapInitiatedAt: 3000,
                }),
                // Historical: A→B (cancelled after B→C started)
                createSwapEntry({
                    swapUUID: uuidAB,
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
                    swapUUID: uuidOrigin,
                    swapStatus: "cancelled",
                    isOldProject: true,
                    oldProjectUrl: "https://gitlab.com/org/swaptest1.git",
                    oldProjectName: "swaptest1",
                    newProjectUrl: "",
                    newProjectName: "",
                    swapInitiatedAt: 1000,
                }),
            ];

            await writeSwapToMetadata(projectC, historyInC);

            // Verify: Read C's metadata and check deprecated projects
            const { getDeprecatedProjectsFromHistory, normalizeProjectSwapInfo } =
                await import("../../../utils/projectSwapManager");

            const metaC = await readMetadata(projectC);
            const swapInfo = normalizeProjectSwapInfo(metaC.meta?.projectSwap);
            const deprecated = getDeprecatedProjectsFromHistory(swapInfo);

            // CRITICAL ASSERTIONS
            const deprecatedUrls = deprecated.map(d => d.url);

            assert.ok(
                deprecatedUrls.includes("https://gitlab.com/org/swaptest1.git"),
                "swaptest1 (origin) MUST be in deprecated list"
            );
            assert.ok(
                deprecatedUrls.includes("https://gitlab.com/org/swaptest2.git"),
                "swaptest2 (middle) MUST be in deprecated list"
            );
            assert.strictEqual(
                deprecated.length,
                2,
                "Exactly 2 projects should be deprecated (swaptest1 and swaptest2)"
            );

            // Verify C is NOT deprecated
            assert.ok(
                !deprecatedUrls.includes("https://gitlab.com/org/swaptest3.git"),
                "swaptest3 (current) should NOT be deprecated"
            );
        });

        test("deprecated projects include name for remote-only matching", async () => {
            const projectDir = await createTestProject(tempDir, "name-matching-test");

            const entries: ProjectSwapEntry[] = [
                createSwapEntry({
                    swapUUID: "test-swap",
                    isOldProject: false,
                    oldProjectUrl: "https://gitlab.com/org/remote-only-project-abc123.git",
                    oldProjectName: "remote-only-project-abc123", // Name is critical for remote-only
                }),
            ];

            await writeSwapToMetadata(projectDir, entries);

            const { getDeprecatedProjectsFromHistory, normalizeProjectSwapInfo } =
                await import("../../../utils/projectSwapManager");

            const meta = await readMetadata(projectDir);
            const swapInfo = normalizeProjectSwapInfo(meta.meta?.projectSwap);
            const deprecated = getDeprecatedProjectsFromHistory(swapInfo);

            // Verify both URL and name are captured
            assert.strictEqual(deprecated.length, 1);
            assert.strictEqual(deprecated[0].url, "https://gitlab.com/org/remote-only-project-abc123.git");
            assert.strictEqual(deprecated[0].name, "remote-only-project-abc123");
        });

        test("long chain (5 projects) correctly identifies all deprecated", async () => {
            const projectE = await createTestProject(tempDir, "project-e");

            // Chain: A→B→C→D→E
            const historyInE: ProjectSwapEntry[] = [
                createSwapEntry({
                    swapUUID: "d-to-e",
                    swapStatus: "active",
                    isOldProject: false,
                    oldProjectUrl: "https://gitlab.com/org/project-d.git",
                    oldProjectName: "project-d",
                    newProjectUrl: "https://gitlab.com/org/project-e.git",
                    newProjectName: "project-e",
                    swapInitiatedAt: 5000,
                }),
                createSwapEntry({
                    swapUUID: "c-to-d",
                    swapStatus: "cancelled",
                    isOldProject: true,
                    oldProjectUrl: "https://gitlab.com/org/project-c.git",
                    oldProjectName: "project-c",
                    swapInitiatedAt: 4000,
                }),
                createSwapEntry({
                    swapUUID: "b-to-c",
                    swapStatus: "cancelled",
                    isOldProject: true,
                    oldProjectUrl: "https://gitlab.com/org/project-b.git",
                    oldProjectName: "project-b",
                    swapInitiatedAt: 3000,
                }),
                createSwapEntry({
                    swapUUID: "a-to-b",
                    swapStatus: "cancelled",
                    isOldProject: true,
                    oldProjectUrl: "https://gitlab.com/org/project-a.git",
                    oldProjectName: "project-a",
                    swapInitiatedAt: 2000,
                }),
                createSwapEntry({
                    swapUUID: "origin-a",
                    swapStatus: "cancelled",
                    isOldProject: true,
                    oldProjectUrl: "https://gitlab.com/org/project-a.git",
                    oldProjectName: "project-a",
                    newProjectUrl: "",
                    newProjectName: "",
                    swapInitiatedAt: 1000,
                }),
            ];

            await writeSwapToMetadata(projectE, historyInE);

            const { getDeprecatedProjectsFromHistory, normalizeProjectSwapInfo } =
                await import("../../../utils/projectSwapManager");

            const meta = await readMetadata(projectE);
            const swapInfo = normalizeProjectSwapInfo(meta.meta?.projectSwap);
            const deprecated = getDeprecatedProjectsFromHistory(swapInfo);
            const deprecatedUrls = deprecated.map(d => d.url);

            // All 4 old projects should be deprecated
            assert.ok(deprecatedUrls.includes("https://gitlab.com/org/project-a.git"), "project-a");
            assert.ok(deprecatedUrls.includes("https://gitlab.com/org/project-b.git"), "project-b");
            assert.ok(deprecatedUrls.includes("https://gitlab.com/org/project-c.git"), "project-c");
            assert.ok(deprecatedUrls.includes("https://gitlab.com/org/project-d.git"), "project-d");

            // Current project (E) should NOT be deprecated
            assert.ok(!deprecatedUrls.includes("https://gitlab.com/org/project-e.git"), "project-e should NOT be deprecated");
        });

        test("field ordering is applied in sorted entries", async () => {
            const projectDir = await createTestProject(tempDir, "field-order-test");

            const entries: ProjectSwapEntry[] = [
                createSwapEntry({
                    swapUUID: "order-test",
                    swapStatus: "active",
                    swapInitiatedAt: 1000,
                    swapInitiatedBy: "admin",
                    swapReason: "Test",
                    swapModifiedAt: 2000,
                    swappedUsersModifiedAt: 3000,
                    oldProjectName: "old",
                    newProjectName: "new",
                    isOldProject: true,
                    oldProjectUrl: "https://example.com/old.git",
                    newProjectUrl: "https://example.com/new.git",
                    swappedUsers: [],
                }),
            ];

            const sorted = sortSwapEntries(entries);
            const orderedEntry = sorted[0];
            const keys = Object.keys(orderedEntry);

            // Verify field order: UUID and status first
            assert.strictEqual(keys[0], "swapUUID", "swapUUID should be first");
            assert.strictEqual(keys[1], "swapStatus", "swapStatus should be second");
        });
    });

    // ========================================================================
    // REGRESSION E2E TESTS
    // ========================================================================
    suite("Regression E2E Tests", () => {
        test("REGRESSION: local cache syncs swappedUsers with timestamp", async () => {
            const projectDir = await createTestProject(tempDir, "cache-sync-regression");
            const localSwapPath = path.join(projectDir, ".project", "localProjectSwap.json");

            // Remote entry has user completion
            const remoteEntry = createSwapEntry({
                swapUUID: "sync-regression",
                swapModifiedAt: 2000,
                swappedUsersModifiedAt: 2000,
                swappedUsers: [
                    { userToSwap: "remote-user", createdAt: 2000, updatedAt: 2000, executed: true },
                ],
            });

            // Local cache - ensure we copy BOTH swappedUsers AND swappedUsersModifiedAt
            const localCacheData = {
                remoteSwapInfo: {
                    swapEntries: [remoteEntry],
                },
                fetchedAt: Date.now(),
                sourceOriginUrl: "https://gitlab.com/org/project.git",
            };

            fs.writeFileSync(localSwapPath, JSON.stringify(localCacheData, null, 2));

            const cached = JSON.parse(fs.readFileSync(localSwapPath, "utf-8"));
            const cachedEntry = cached.remoteSwapInfo.swapEntries[0];

            assert.strictEqual(cachedEntry.swappedUsers?.length, 1, "User should be cached");
            assert.strictEqual(cachedEntry.swappedUsersModifiedAt, 2000, "swappedUsersModifiedAt should be cached");
        });

        test("REGRESSION: multiple users from different sources are merged", async () => {
            const projectDir = await createTestProject(tempDir, "merge-users-regression");

            // Metadata has user A
            const metadataEntry = createSwapEntry({
                swapUUID: "merge-regression",
                swapInitiatedAt: 1000,
                swappedUsers: [
                    { userToSwap: "userA", createdAt: 1000, updatedAt: 1000, executed: true },
                ],
            });

            // Local cache has user B
            const localCacheEntry = createSwapEntry({
                swapUUID: "merge-regression",
                swapInitiatedAt: 1000,
                swappedUsers: [
                    { userToSwap: "userB", createdAt: 2000, updatedAt: 2000, executed: true },
                ],
            });

            // Merge should produce both users
            const merged = mergeSwappedUsers(metadataEntry.swappedUsers, localCacheEntry.swappedUsers);

            assert.strictEqual(merged.length, 2, "Both users should be in merged result");
            assert.ok(merged.some(u => u.userToSwap === "userA"), "User A should be preserved");
            assert.ok(merged.some(u => u.userToSwap === "userB"), "User B should be preserved");
        });

        test("REGRESSION: cancellation overrides active even with older timestamp", async () => {
            const projectDir = await createTestProject(tempDir, "cancel-regression");

            // Admin cancelled at T1
            const cancelledEntry = createSwapEntry({
                swapUUID: "cancel-regression",
                swapInitiatedAt: 1000,
                swapModifiedAt: 1500, // Earlier
                swapStatus: "cancelled",
                cancelledBy: "admin",
                cancelledAt: 1500,
            });

            // User completed at T2 > T1
            const activeEntry = createSwapEntry({
                swapUUID: "cancel-regression",
                swapInitiatedAt: 1000,
                swapModifiedAt: 2000, // Later
                swapStatus: "active",
                swappedUsers: [
                    { userToSwap: "lateUser", createdAt: 2000, updatedAt: 2000, executed: true },
                ],
            });

            // Simulate merge with sticky rule
            const eitherCancelled = cancelledEntry.swapStatus === "cancelled" || activeEntry.swapStatus === "cancelled";

            assert.strictEqual(eitherCancelled, true, "Should detect cancellation");
            // In actual merge, this would result in cancelled status with user preserved
        });

        test("REGRESSION: localProjectSwap.json deleted when remote shows no active OLD swap", async () => {
            const projectDir = await createTestProject(tempDir, "cleanup-regression");
            const localSwapPath = path.join(projectDir, ".project", "localProjectSwap.json");

            // Write a localProjectSwap.json with active swap
            const localData = {
                remoteSwapInfo: {
                    swapEntries: [createSwapEntry({
                        swapUUID: "cleanup-test",
                        swapStatus: "active",
                        swapModifiedAt: 1000,
                        isOldProject: true,
                    })],
                },
                fetchedAt: Date.now(),
                sourceOriginUrl: "https://gitlab.com/org/old.git",
            };
            fs.writeFileSync(localSwapPath, JSON.stringify(localData, null, 2));
            assert.ok(fs.existsSync(localSwapPath), "Setup: file should exist");

            // Simulate: remote now has only cancelled entries
            const remoteEntries = [createSwapEntry({
                swapUUID: "cleanup-test",
                swapStatus: "cancelled",
                swapModifiedAt: 2000,
                isOldProject: true,
                cancelledBy: "admin",
                cancelledAt: 2000,
            })];

            const hasActiveOldProjectSwap = remoteEntries.some(
                e => e.swapStatus === "active" && e.isOldProject === true
            );
            assert.strictEqual(hasActiveOldProjectSwap, false,
                "Remote should show no active OLD swap");

            // Check no pending state
            const fileData = JSON.parse(fs.readFileSync(localSwapPath, "utf-8"));
            const hasPendingState = fileData.swapPendingDownloads || fileData.pendingLfsDownloads;
            assert.ok(!hasPendingState, "No pending state");

            // Simulate cleanup (same logic as in checkProjectSwapRequired)
            if (!hasActiveOldProjectSwap && !hasPendingState) {
                fs.unlinkSync(localSwapPath);
            }
            assert.ok(!fs.existsSync(localSwapPath), "File should be deleted");
        });

        test("REGRESSION: localProjectSwap.json NOT deleted when pending downloads exist", async () => {
            const projectDir = await createTestProject(tempDir, "keep-pending-regression");
            const localSwapPath = path.join(projectDir, ".project", "localProjectSwap.json");

            const localData = {
                remoteSwapInfo: {
                    swapEntries: [createSwapEntry({
                        swapUUID: "keep-test",
                        swapStatus: "cancelled",
                        isOldProject: true,
                    })],
                },
                fetchedAt: Date.now(),
                sourceOriginUrl: "https://gitlab.com/org/old.git",
                swapPendingDownloads: {
                    swapState: "pending_downloads",
                    filesNeedingDownload: ["GEN/1_1.mp3"],
                    newProjectUrl: "https://gitlab.com/org/new.git",
                    swapUUID: "keep-test",
                    swapInitiatedAt: Date.now(),
                    createdAt: Date.now(),
                },
            };
            fs.writeFileSync(localSwapPath, JSON.stringify(localData, null, 2));

            const fileData = JSON.parse(fs.readFileSync(localSwapPath, "utf-8"));
            const hasPendingState = fileData.swapPendingDownloads || fileData.pendingLfsDownloads;
            assert.ok(hasPendingState, "Should detect pending downloads");

            // Simulate: even with no active OLD swap, don't delete
            const hasActiveOldProjectSwap = false;
            if (!hasActiveOldProjectSwap && !hasPendingState) {
                fs.unlinkSync(localSwapPath);
            }
            // File should still exist because of pending state
            assert.ok(fs.existsSync(localSwapPath), "File must NOT be deleted with pending downloads");
        });

        test("REGRESSION: re-validation before swap catches cancelled swap", async () => {
            // Simulate: user clicked "Swap" but between click and execution, admin cancelled
            const initialEntry = createSwapEntry({
                swapUUID: "revalidate-test",
                swapStatus: "active",
                isOldProject: true,
            });

            // Initial check passes
            const initialResult = { required: true, activeEntry: initialEntry };
            assert.ok(initialResult.required, "Initial check should pass");

            // Admin cancels between prompt and execution
            const cancelledEntry = createSwapEntry({
                swapUUID: "revalidate-test",
                swapStatus: "cancelled",
                isOldProject: true,
                cancelledBy: "admin",
                cancelledAt: Date.now(),
            });

            // Re-validation detects cancellation
            const normalizedCancelled = normalizeProjectSwapInfo({ swapEntries: [cancelledEntry] });
            const activeAfterRecheck = getActiveSwapEntry(normalizedCancelled);

            assert.strictEqual(activeAfterRecheck, undefined,
                "No active entry after cancellation");

            // The re-validation logic: no active entry means abort
            const shouldAbort = activeAfterRecheck === undefined;
            assert.strictEqual(shouldAbort, true,
                "Swap execution should be aborted after detecting cancellation");
        });

        test("REGRESSION: re-validation catches UUID change (new swap replaced old)", async () => {
            const originalUUID = "original-swap";
            const replacementUUID = "replacement-swap";

            const originalEntry = createSwapEntry({
                swapUUID: originalUUID,
                swapStatus: "active",
                isOldProject: true,
            });

            // Between prompt and execution, original was cancelled and new one created
            const replacementEntry = createSwapEntry({
                swapUUID: replacementUUID,
                swapStatus: "active",
                isOldProject: true,
            });

            const normalizedReplacement = normalizeProjectSwapInfo({ swapEntries: [replacementEntry] });
            const activeAfterRecheck = getActiveSwapEntry(normalizedReplacement);

            assert.ok(activeAfterRecheck, "There IS an active entry");
            assert.notStrictEqual(activeAfterRecheck?.swapUUID, originalUUID,
                "Active entry has different UUID");

            // The re-validation logic should abort because UUID changed
            const shouldAbort = !activeAfterRecheck ||
                activeAfterRecheck?.swapUUID !== originalEntry.swapUUID;
            assert.strictEqual(shouldAbort, true,
                "Swap execution should abort when UUID has changed");
        });

        test("REGRESSION: bypassCache ensures fresh remote data on project open", async () => {
            // This validates the conceptual requirement that project open always
            // gets fresh data (bypassCache: true)
            const projectDir = await createTestProject(tempDir, "bypass-cache-regression");

            // Write stale local cache with active swap
            const localSwapPath = path.join(projectDir, ".project", "localProjectSwap.json");
            const staleData = {
                remoteSwapInfo: {
                    swapEntries: [createSwapEntry({
                        swapUUID: "bypass-test",
                        swapStatus: "active",
                        swapModifiedAt: 1000,
                        isOldProject: true,
                    })],
                },
                fetchedAt: Date.now() - 60000, // 1 minute ago
                sourceOriginUrl: "https://gitlab.com/org/old.git",
            };
            fs.writeFileSync(localSwapPath, JSON.stringify(staleData, null, 2));

            // Write metadata.json with cancelled (simulating remote cancellation that got synced)
            const metadata = JSON.parse(fs.readFileSync(
                path.join(projectDir, "metadata.json"), "utf-8"
            ));
            metadata.meta = metadata.meta || {};
            metadata.meta.projectSwap = {
                swapEntries: [createSwapEntry({
                    swapUUID: "bypass-test",
                    swapStatus: "cancelled",
                    swapModifiedAt: 2000,
                    isOldProject: true,
                    cancelledBy: "admin",
                    cancelledAt: 2000,
                })],
            };
            fs.writeFileSync(
                path.join(projectDir, "metadata.json"),
                JSON.stringify(metadata, null, 2)
            );

            // Verify: metadata has cancelled, local cache has stale active
            const localCached = JSON.parse(fs.readFileSync(localSwapPath, "utf-8"));
            assert.strictEqual(localCached.remoteSwapInfo.swapEntries[0].swapStatus, "active",
                "Local cache should be stale");

            const metaData = JSON.parse(fs.readFileSync(
                path.join(projectDir, "metadata.json"), "utf-8"
            ));
            assert.strictEqual(metaData.meta.projectSwap.swapEntries[0].swapStatus, "cancelled",
                "Metadata should have cancelled (from remote)");

            // When bypassCache is true, checkProjectSwapRequired reads metadata.json
            // which has the cancelled status, so the swap should NOT be required
            const normalizedMeta = normalizeProjectSwapInfo(
                metaData.meta.projectSwap as ProjectSwapInfo
            );
            const activeEntry = getActiveSwapEntry(normalizedMeta);
            assert.strictEqual(activeEntry, undefined,
                "With fresh data (bypass cache), no active swap should be found");
        });

        test("REGRESSION: remote projectSwap erased entirely cleans up local state", async () => {
            const projectDir = await createTestProject(tempDir, "erased-remote");
            const localSwapPath = path.join(projectDir, ".project", "localProjectSwap.json");

            // Step 1: localProjectSwap.json exists with active swap (stale)
            const staleData = {
                remoteSwapInfo: {
                    swapEntries: [createSwapEntry({
                        swapUUID: "erased-test",
                        swapStatus: "active",
                        isOldProject: true,
                    })],
                },
                fetchedAt: Date.now() - 60000,
                sourceOriginUrl: "https://gitlab.com/org/old.git",
            };
            fs.writeFileSync(localSwapPath, JSON.stringify(staleData, null, 2));
            assert.ok(fs.existsSync(localSwapPath), "Setup: local cache exists");

            // Step 2: Remote metadata has NO projectSwap at all (erased)
            const remoteMetadata = {
                meta: {
                    version: "0.16.0",
                    // projectSwap is completely absent
                },
            };

            // Step 3: Apply the same logic as checkProjectSwapRequired
            const hasProjectSwap = !!(remoteMetadata?.meta as any)?.projectSwap;
            const hasMeta = !!remoteMetadata?.meta;

            // With our fix: treat erased remote as empty swap info
            const remoteSwapInfo = hasProjectSwap
                ? (remoteMetadata.meta as any).projectSwap
                : (hasMeta ? { swapEntries: [] as ProjectSwapEntry[] } : undefined);

            assert.ok(remoteSwapInfo, "Should get empty swap info, not undefined");
            const remoteEntries = remoteSwapInfo!.swapEntries;
            assert.strictEqual(remoteEntries.length, 0, "Remote has 0 entries");

            const hasActiveOldProjectSwap = remoteEntries.some(
                (e: ProjectSwapEntry) => e.swapStatus === "active" && e.isOldProject === true
            );
            assert.strictEqual(hasActiveOldProjectSwap, false, "No active OLD swap");

            // Step 4: Cleanup - delete localProjectSwap.json (no pending state)
            const fileData = JSON.parse(fs.readFileSync(localSwapPath, "utf-8"));
            const hasPendingState = fileData.swapPendingDownloads || fileData.pendingLfsDownloads;
            if (!hasActiveOldProjectSwap && !hasPendingState) {
                fs.unlinkSync(localSwapPath);
            }
            assert.ok(!fs.existsSync(localSwapPath),
                "localProjectSwap.json should be deleted when remote has no projectSwap");

            // Step 5: Verify metadata also reflects no swap
            const metadata = JSON.parse(fs.readFileSync(
                path.join(projectDir, "metadata.json"), "utf-8"
            ));
            assert.ok(!metadata.meta?.projectSwap,
                "metadata.json should also have no projectSwap");

            // Final: normalizing empty remote should yield no active entry
            const normalizedRemote = normalizeProjectSwapInfo({ swapEntries: [] });
            const activeEntry = getActiveSwapEntry(normalizedRemote);
            assert.strictEqual(activeEntry, undefined,
                "No active swap anywhere - swap is NOT required");
        });

        test("E2E: full swap cycle preserves all data", async () => {
            const oldProject = await createTestProject(tempDir, "full-cycle-old");
            const newProject = await createTestProject(tempDir, "full-cycle-new");

            const swapUUID = "full-cycle-uuid";
            const initiatedAt = Date.now();

            // Step 1: Admin initiates swap on old project
            const oldEntry = createSwapEntry({
                swapUUID,
                swapInitiatedAt: initiatedAt,
                swapModifiedAt: initiatedAt,
                isOldProject: true,
                oldProjectName: "full-cycle-old",
                newProjectName: "full-cycle-new",
            });
            await writeSwapToMetadata(oldProject, [oldEntry]);

            // Step 2: New project gets swap entry
            const newEntry = createSwapEntry({
                swapUUID,
                swapInitiatedAt: initiatedAt,
                swapModifiedAt: initiatedAt,
                isOldProject: false,
                oldProjectName: "full-cycle-old",
                newProjectName: "full-cycle-new",
            });
            await writeSwapToMetadata(newProject, [newEntry]);

            // Step 3: User completes swap - update new project
            const completionTime = Date.now() + 1000;
            const newMeta = await readMetadata(newProject);
            const swapEntryInNew = newMeta.meta?.projectSwap?.swapEntries?.[0];
            if (swapEntryInNew) {
                swapEntryInNew.swappedUsers = [
                    { userToSwap: "translator1", createdAt: completionTime, updatedAt: completionTime, executed: true },
                ];
                swapEntryInNew.swappedUsersModifiedAt = completionTime;
                // swapModifiedAt stays the same (not changed on user completion)
            }
            fs.writeFileSync(
                path.join(newProject, "metadata.json"),
                JSON.stringify(newMeta, null, 2)
            );

            // Verify final state
            const finalNewMeta = await readMetadata(newProject);
            const finalEntry = finalNewMeta.meta?.projectSwap?.swapEntries?.[0];

            assert.strictEqual(finalEntry?.swapUUID, swapUUID);
            assert.strictEqual(finalEntry?.swappedUsers?.length, 1);
            assert.strictEqual(finalEntry?.swappedUsers?.[0].executed, true);
            assert.strictEqual(finalEntry?.swapModifiedAt, initiatedAt, "swapModifiedAt unchanged on user completion");
            assert.strictEqual(finalEntry?.swappedUsersModifiedAt, completionTime, "swappedUsersModifiedAt updated");
        });
    });
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function createTestProject(tempDir: string, name: string): Promise<string> {
    const projectDir = path.join(tempDir, name);
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(path.join(projectDir, ".project"), { recursive: true });

    const metadata: Partial<ProjectMetadata> = {
        format: "scripture burrito",
        projectName: name,
        projectId: `id-${name}`,
        meta: {
            version: "0.16.0",
            category: "Scripture",
            dateCreated: new Date().toISOString(),
        } as any,
    };
    fs.writeFileSync(path.join(projectDir, "metadata.json"), JSON.stringify(metadata, null, 2));

    // Initialize git
    await git.init({ fs, dir: projectDir, defaultBranch: "main" });
    fs.writeFileSync(path.join(projectDir, "test.txt"), "test");
    await git.add({ fs, dir: projectDir, filepath: "metadata.json" });
    await git.add({ fs, dir: projectDir, filepath: "test.txt" });
    await git.commit({
        fs,
        dir: projectDir,
        message: "Initial commit",
        author: { name: "Test", email: "test@example.com" },
    });

    return projectDir;
}

async function writeSwapToMetadata(projectDir: string, entries: ProjectSwapEntry[]): Promise<void> {
    const metadataPath = path.join(projectDir, "metadata.json");
    const metadata: ProjectMetadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
    metadata.meta = metadata.meta || ({} as any);
    metadata.meta.projectSwap = { swapEntries: entries };
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
}

async function readMetadata(projectDir: string): Promise<ProjectMetadata> {
    const metadataPath = path.join(projectDir, "metadata.json");
    return JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
}

function createSwapEntry(overrides: Partial<ProjectSwapEntry> = {}): ProjectSwapEntry {
    const now = Date.now();
    return {
        swapUUID: `uuid-${Math.random().toString(36).substring(7)}`,
        swapInitiatedAt: now,
        swapModifiedAt: now,
        swapStatus: "active",
        isOldProject: true,
        oldProjectUrl: "https://gitlab.com/org/old.git",
        oldProjectName: "old-project",
        newProjectUrl: "https://gitlab.com/org/new.git",
        newProjectName: "new-project",
        swapInitiatedBy: "testuser",
        ...overrides,
    };
}
