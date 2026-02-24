import * as assert from "assert";
import { SyncManager } from "../../projectManager/syncManager";
import { SyncResult } from "../../projectManager/utils/merge";
import sinon from "sinon";

/**
 * Tests that the sync process does not run while NewSourceUploader is importing files.
 * The NewSourceUploaderProvider calls beginImportInProgress() when it receives importStarted
 * (from notifyImportStarted in importer forms) or when processing writeNotebooks,
 * writeTranslation, etc. It calls endImportInProgress() when receiving importEnded or when
 * those operations complete. SyncManager.executeSync() and scheduleSyncOperation() must
 * skip execution when import is in progress. The sync button is disabled via
 * addImportInProgressListener.
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

    test("scheduleSyncOperation does not schedule when import is in progress", () => {
        const setTimeoutStub = sinon.stub(global, "setTimeout").returns(0 as unknown as NodeJS.Timeout);

        syncManager.beginImportInProgress();
        try {
            syncManager.scheduleSyncOperation("Auto-sync during import");

            assert.ok(
                !setTimeoutStub.called,
                "setTimeout must not be called when import is in progress - sync should not be scheduled"
            );
        } finally {
            syncManager.endImportInProgress();
            setTimeoutStub.restore();
        }
    });

    test("nested begin/end import counter - sync remains blocked until all imports end", () => {
        syncManager.beginImportInProgress();
        syncManager.beginImportInProgress();

        try {
            assert.strictEqual(
                syncManager.getSyncStatus().isImportInProgress,
                true,
                "Should be blocked with 2 begins"
            );

            syncManager.endImportInProgress();
            assert.strictEqual(
                syncManager.getSyncStatus().isImportInProgress,
                true,
                "Should still be blocked after 1 end (nested import)"
            );

            syncManager.endImportInProgress();
            assert.strictEqual(
                syncManager.getSyncStatus().isImportInProgress,
                false,
                "Should not be blocked after all imports end"
            );
        } finally {
            for (let i = 0; i < 5; i++) {
                syncManager.endImportInProgress();
            }
        }
    });

    test("addImportInProgressListener notifies when import state changes", () => {
        const listener = sinon.stub();
        const disposable = syncManager.addImportInProgressListener(listener);

        try {
            syncManager.beginImportInProgress();
            assert.ok(listener.calledWith(true), "Listener should be notified with true when import starts");

            listener.resetHistory();
            syncManager.endImportInProgress();
            assert.ok(listener.calledWith(false), "Listener should be notified with false when import ends");
        } finally {
            disposable.dispose();
            syncManager.endImportInProgress();
        }
    });
});
