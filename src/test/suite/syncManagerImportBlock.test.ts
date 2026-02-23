import * as assert from "assert";
import { SyncManager } from "../../projectManager/syncManager";
import { SyncResult } from "../../projectManager/utils/merge";
import sinon from "sinon";

/**
 * Tests that the sync process does not run while NewSourceUploader is importing files.
 * The NewSourceUploaderProvider calls beginImportInProgress() when processing writeNotebooks,
 * writeTranslation, etc., and endImportInProgress() when done. SyncManager.executeSync()
 * must skip execution when import is in progress.
 */
suite("SyncManager - Import Block Tests", () => {
    let syncManager: SyncManager;
    let stageAndCommitStub: sinon.SinonStub;

    suiteSetup(() => {
        syncManager = SyncManager.getInstance();
    });

    setup(() => {
        sinon.restore();
    });

    teardown(() => {
        sinon.restore();
        // Ensure we never leave import-in-progress state (in case test fails)
        for (let i = 0; i < 10; i++) {
            syncManager.endImportInProgress();
        }
    });

    test("sync does not run while NewSourceUploader import is in progress", async () => {
        // Stub the core sync function - if it's called, sync ran (which would be wrong)
        const mergeModule = await import("../../projectManager/utils/merge");
        stageAndCommitStub = sinon.stub(mergeModule, "stageAndCommitAllAndSync").resolves({
            success: true,
            changedFiles: [],
            conflictFiles: [],
            newFiles: [],
            deletedFiles: [],
            totalChanges: 0,
        } as SyncResult);

        // Simulate NewSourceUploader having started an import (e.g. writeNotebooks, writeTranslation)
        syncManager.beginImportInProgress();

        try {
            // Attempt sync - should be blocked
            await syncManager.executeSync("Manual sync", false, undefined, true, true);

            // The core sync logic must not have run
            assert.ok(
                !stageAndCommitStub.called,
                "stageAndCommitAllAndSync must not be called when import is in progress"
            );
        } finally {
            syncManager.endImportInProgress();
        }
    });

    test("getSyncStatus reports isImportInProgress true while import is active", () => {
        syncManager.beginImportInProgress();
        try {
            const status = syncManager.getSyncStatus();
            assert.strictEqual(
                status.isImportInProgress,
                true,
                "getSyncStatus should report isImportInProgress=true when import has started"
            );
        } finally {
            syncManager.endImportInProgress();
        }
    });

    test("getSyncStatus reports isImportInProgress false when no import is active", () => {
        const status = syncManager.getSyncStatus();
        assert.strictEqual(
            status.isImportInProgress,
            false,
            "getSyncStatus should report isImportInProgress=false when no import in progress"
        );
    });
});
