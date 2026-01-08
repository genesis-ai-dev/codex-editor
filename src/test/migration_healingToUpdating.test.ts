/**
 * Migration: Healing Terminology → Updating Terminology
 * 
 * This migration updates metadata.json to use "updating" terminology instead of "healing".
 * 
 * IMPORTANT: This migration should be REMOVED in version 0.17.0
 * It only runs for versions 0.14.0, 0.15.0, and 0.16.0.
 * After 0.16.0 is deployed and users have had 2+ versions to migrate, this can be safely deleted.
 * 
 * Changes:
 * - initiateRemoteHealingFor → initiateRemoteUpdatingFor
 * - userToHeal → userToUpdate
 * - healed → updated (if present)
 * 
 * The migration:
 * - Only updates the keys (does not touch updatedAt unless other fields changed)
 * - Validates if keys have reverted to old names
 * - Is idempotent (can run multiple times safely)
 */

import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { migration_healingToUpdating } from "../utils/migration_healingToUpdating";

suite("Migration: Healing → Updating Terminology (metadata.json)", () => {
    let tempDir: string;
    let metadataPath: string;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "migration-heal-"));
        metadataPath = path.join(tempDir, "metadata.json");
    });

    teardown(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    test("migrates initiateRemoteHealingFor to initiateRemoteUpdatingFor", async () => {
        const oldMetadata = {
            format: "scripture burrito",
            meta: {
                generator: { softwareName: "Codex Editor", softwareVersion: "0.13.0" },
                initiateRemoteHealingFor: [
                    {
                        userToHeal: "user1",
                        addedBy: "admin",
                        createdAt: 1000,
                        updatedAt: 1000,
                        executed: false,
                        deleted: false,
                    },
                ],
            },
        };

        fs.writeFileSync(metadataPath, JSON.stringify(oldMetadata, null, 2));

        // Run migration
        await migration_healingToUpdating(tempDir);

        // Verify migration
        const newMetadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));

        assert.strictEqual(newMetadata.meta.initiateRemoteHealingFor, undefined, "Old key should be removed");
        assert.ok(newMetadata.meta.initiateRemoteUpdatingFor, "New key should exist");
        assert.strictEqual(newMetadata.meta.initiateRemoteUpdatingFor.length, 1);

        const entry = newMetadata.meta.initiateRemoteUpdatingFor[0];
        assert.strictEqual(entry.userToUpdate, "user1");
        assert.strictEqual(entry.userToHeal, undefined, "Old userToHeal should be removed");
        assert.strictEqual(entry.updatedAt, 1000, "updatedAt should not change");
    });

    test("does not run migration if already migrated", async () => {
        const alreadyMigrated = {
            format: "scripture burrito",
            meta: {
                generator: { softwareName: "Codex Editor", softwareVersion: "0.14.0" },
                initiateRemoteUpdatingFor: [
                    {
                        userToUpdate: "user1",
                        addedBy: "admin",
                        createdAt: 1000,
                        updatedAt: 1000,
                        executed: false,
                        deleted: false,
                    },
                ],
            },
        };

        fs.writeFileSync(metadataPath, JSON.stringify(alreadyMigrated, null, 2));
        const beforeContent = fs.readFileSync(metadataPath, "utf8");

        // Run migration
        await migration_healingToUpdating(tempDir);

        const afterContent = fs.readFileSync(metadataPath, "utf8");
        assert.strictEqual(beforeContent, afterContent, "Should not modify already-migrated file");
    });

    test("fixes reverted keys (old terminology reappeared)", async () => {
        const revertedMetadata = {
            format: "scripture burrito",
            meta: {
                generator: { softwareName: "Codex Editor", softwareVersion: "0.15.0" },
                initiateRemoteHealingFor: [  // Reverted to old key
                    {
                        userToHeal: "user1",  // Reverted to old key
                        addedBy: "admin",
                        createdAt: 1000,
                        updatedAt: 1000,
                        executed: false,
                        deleted: false,
                    },
                ],
            },
        };

        fs.writeFileSync(metadataPath, JSON.stringify(revertedMetadata, null, 2));

        // Run migration
        await migration_healingToUpdating(tempDir);

        // Verify it was fixed
        const fixed = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
        assert.strictEqual(fixed.meta.initiateRemoteHealingFor, undefined);
        assert.ok(fixed.meta.initiateRemoteUpdatingFor);
        assert.strictEqual(fixed.meta.initiateRemoteUpdatingFor[0].userToUpdate, "user1");
    });

    test("preserves all other fields and does not update timestamps", async () => {
        const oldMetadata = {
            format: "scripture burrito",
            meta: {
                generator: { softwareName: "Codex Editor", softwareVersion: "0.13.0" },
                initiateRemoteHealingFor: [
                    {
                        userToHeal: "user1",
                        addedBy: "admin",
                        createdAt: 5000,
                        updatedAt: 6000,
                        executed: true,
                        deleted: false,
                        deletedBy: "",
                        customField: "preserved",
                    },
                ],
                otherField: "untouched",
            },
        };

        fs.writeFileSync(metadataPath, JSON.stringify(oldMetadata, null, 2));

        // Run migration
        await migration_healingToUpdating(tempDir);

        const migrated = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
        const entry = migrated.meta.initiateRemoteUpdatingFor[0];

        assert.strictEqual(entry.addedBy, "admin");
        assert.strictEqual(entry.createdAt, 5000);
        assert.strictEqual(entry.updatedAt, 6000, "Should NOT update timestamp");
        assert.strictEqual(entry.executed, true);
        assert.strictEqual(entry.deleted, false);
        assert.strictEqual(entry.deletedBy, "");
        assert.strictEqual(entry.customField, "preserved");
        assert.strictEqual(migrated.meta.otherField, "untouched");
    });

    test("handles multiple entries", async () => {
        const oldMetadata = {
            format: "scripture burrito",
            meta: {
                generator: { softwareName: "Codex Editor", softwareVersion: "0.13.0" },
                initiateRemoteHealingFor: [
                    { userToHeal: "user1", addedBy: "admin", createdAt: 1000, updatedAt: 1000, executed: false, deleted: false },
                    { userToHeal: "user2", addedBy: "admin", createdAt: 2000, updatedAt: 2000, executed: true, deleted: false },
                    { userToHeal: "user3", addedBy: "admin", createdAt: 3000, updatedAt: 3000, executed: false, deleted: true },
                ],
            },
        };

        fs.writeFileSync(metadataPath, JSON.stringify(oldMetadata, null, 2));

        await migration_healingToUpdating(tempDir);

        const migrated = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
        assert.strictEqual(migrated.meta.initiateRemoteUpdatingFor.length, 3);
        assert.strictEqual(migrated.meta.initiateRemoteUpdatingFor[0].userToUpdate, "user1");
        assert.strictEqual(migrated.meta.initiateRemoteUpdatingFor[1].userToUpdate, "user2");
        assert.strictEqual(migrated.meta.initiateRemoteUpdatingFor[2].userToUpdate, "user3");
    });

    test("does nothing if metadata.json does not exist", async () => {
        // Don't create the file
        await migration_healingToUpdating(tempDir);
        // Should not throw or create file
        assert.ok(!fs.existsSync(metadataPath));
    });
});

