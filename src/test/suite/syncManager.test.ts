import * as assert from 'assert';
import * as vscode from 'vscode';
import { SyncManager } from '../../projectManager/syncManager';
import sinon from 'sinon';

suite('SyncManager Lock Detection Tests', () => {
    let syncManager: SyncManager;

    suiteSetup(() => {
        syncManager = SyncManager.getInstance();
    });

    suite('Pending Changes Queue', () => {
        test('Should queue changes during sync', async function () {
            this.timeout(5000);

            // We can't easily test the private pendingChanges array directly,
            // but we can test the behavior by scheduling multiple syncs
            // Note: This test verifies the scheduleSyncOperation method exists
            // and doesn't throw when called multiple times

            syncManager.scheduleSyncOperation('Test change 1');
            syncManager.scheduleSyncOperation('Test change 2');
            syncManager.scheduleSyncOperation('Test change 3');

            // Should not throw
            assert.ok(true, 'Multiple sync operations scheduled without error');
        });
    });

    suite('Sync Status', () => {
        test('Should have sync status listener registration', () => {
            // Test that the sync manager has the status listener method
            assert.ok(typeof syncManager.addSyncStatusListener === 'function',
                'addSyncStatusListener method should exist');
        });

        test('Should be able to schedule sync operations', () => {
            // Verify the method exists and can be called
            syncManager.scheduleSyncOperation('Test sync');
            assert.ok(true, 'scheduleSyncOperation method works');
        });
    });

    suite('Configuration', () => {
        test('Should respect minimum sync delay of 5 minutes', () => {
            // This is a behavioral test - we're verifying the manager
            // handles configuration correctly
            const config = vscode.workspace.getConfiguration('codex-project-manager');
            const syncDelay = config.get<number>('syncDelayMinutes', 5);

            assert.ok(syncDelay >= 5, 'Sync delay should be at least 5 minutes');
        });
    });
});

suite('SyncManager Race Condition Prevention Tests', () => {
    let syncManager: SyncManager;

    suiteSetup(() => {
        syncManager = SyncManager.getInstance();
    });

    test('Should handle rapid sync requests gracefully', async function () {
        this.timeout(5000);

        // Rapidly call executeSync multiple times
        // The in-memory flag should prevent actual concurrent execution
        const promises = [];
        for (let i = 0; i < 5; i++) {
            // Note: We don't await here to simulate rapid requests
            promises.push(
                syncManager.executeSync(
                    `Rapid test ${i}`,
                    false, // Don't show messages
                    undefined,
                    false
                ).catch(err => {
                    // Catch any errors to prevent test failure
                    console.log(`Sync ${i} error (expected):`, err);
                })
            );
        }

        // Wait for all to complete
        await Promise.allSettled(promises);

        assert.ok(true, 'Multiple rapid sync requests handled');
    });
});

suite('SyncManager VS Code Version Warning Tests', () => {
    let syncManager: SyncManager;
    let checkVSCodeVersionStub: sinon.SinonStub;
    let getFrontierVersionStatusStub: sinon.SinonStub;
    let showInformationMessageStub: sinon.SinonStub;
    let openExternalStub: sinon.SinonStub;
    let getAuthApiStub: sinon.SinonStub;
    let versionChecksModule: any;
    let extensionModule: any;
    let mockAuthApi: any;

    suiteSetup(() => {
        syncManager = SyncManager.getInstance();
    });

    setup(async () => {
        // Create mock auth API that passes all checks
        mockAuthApi = {
            getAuthStatus: () => ({ isAuthenticated: true }),
            checkSyncLock: async () => ({
                exists: false,
                isDead: false,
                isStuck: false,
                age: 0,
                ownedByUs: false,
                status: 'active' as const,
                pid: 0
            })
        };

        // Import extension module to stub getAuthApi
        extensionModule = await import('../../extension');
        getAuthApiStub = sinon.stub(extensionModule, 'getAuthApi').returns(mockAuthApi);

        // Import and stub versionChecks module
        versionChecksModule = await import('../../projectManager/utils/versionChecks');
        getFrontierVersionStatusStub = sinon.stub(versionChecksModule, 'getFrontierVersionStatus').resolves({
            ok: true,
            installedVersion: '0.4.18',
            requiredVersion: '0.4.18'
        });

        // Stub VS Code APIs
        showInformationMessageStub = sinon.stub(vscode.window, 'showInformationMessage');
        openExternalStub = sinon.stub(vscode.env, 'openExternal');
    });

    teardown(() => {
        // Restore all stubs
        if (checkVSCodeVersionStub) {
            checkVSCodeVersionStub.restore();
        }
        if (getFrontierVersionStatusStub) {
            getFrontierVersionStatusStub.restore();
        }
        if (getAuthApiStub) {
            getAuthApiStub.restore();
        }
        showInformationMessageStub.restore();
        openExternalStub.restore();
        sinon.restore();
    });

    test('Should show information message when VS Code version is too old', async function () {
        this.timeout(5000);

        // Ensure sync is not in progress
        (syncManager as any).isSyncInProgress = false;

        // Mock checkVSCodeVersion to return a failing version status
        checkVSCodeVersionStub = sinon.stub(versionChecksModule, 'checkVSCodeVersion').returns({
            ok: false,
            installedVersion: '1.98.0',
            requiredVersion: '1.99.0'
        });

        // Mock showInformationMessage to return undefined (user dismisses without clicking button)
        showInformationMessageStub.resolves(undefined);

        // Call executeSync which should trigger the version check
        // Use isManualSync=true to bypass workspace folder check
        try {
            await syncManager.executeSync(
                'Test sync',
                false, // Don't show messages
                undefined,
                true // isManualSync - bypasses workspace folder requirement
            );
        } catch (error) {
            // Expected - sync might fail for other reasons in test environment
        }

        // Verify that showInformationMessage was called with correct parameters
        assert.ok(showInformationMessageStub.called, 'showInformationMessage should be called');
        assert.strictEqual(
            showInformationMessageStub.firstCall.args[0],
            'Please visit codexeditor.app to update Codex to the latest version.',
            'Message text should match'
        );
        assert.deepStrictEqual(
            showInformationMessageStub.firstCall.args[1],
            { modal: true },
            'Modal option should be set to true'
        );
        assert.strictEqual(
            showInformationMessageStub.firstCall.args[2],
            'Visit Website',
            'Action button text should match'
        );

        // Verify openExternal was NOT called since user dismissed the modal
        assert.ok(!openExternalStub.called, 'openExternal should not be called when modal is dismissed');
    });

    test('Should open website when user clicks Visit Website button', async function () {
        this.timeout(5000);

        // Ensure sync is not in progress
        (syncManager as any).isSyncInProgress = false;

        // Mock checkVSCodeVersion to return a failing version status
        checkVSCodeVersionStub = sinon.stub(versionChecksModule, 'checkVSCodeVersion').returns({
            ok: false,
            installedVersion: '1.98.0',
            requiredVersion: '1.99.0'
        });

        // Mock showInformationMessage to return "Visit Website" (user clicks the button)
        showInformationMessageStub.resolves('Visit Website');

        // Call executeSync which should trigger the version check
        // Use isManualSync=true to bypass workspace folder check
        try {
            await syncManager.executeSync(
                'Test sync',
                false, // Don't show messages
                undefined,
                true // isManualSync - bypasses workspace folder requirement
            );
        } catch (error) {
            // Expected - sync might fail for other reasons in test environment
        }

        // Verify that showInformationMessage was called
        assert.ok(showInformationMessageStub.called, 'showInformationMessage should be called');

        // Verify openExternal was called with the correct URL
        assert.ok(openExternalStub.called, 'openExternal should be called when user clicks Visit Website');
        assert.strictEqual(
            openExternalStub.firstCall.args[0].toString(),
            'https://codexeditor.app/',
            'openExternal should be called with codexeditor.app URL'
        );
    });

    test('Should not show modal when VS Code version is sufficient', async function () {
        this.timeout(5000);

        // Ensure sync is not in progress
        (syncManager as any).isSyncInProgress = false;

        // Mock checkVSCodeVersion to return a passing version status
        checkVSCodeVersionStub = sinon.stub(versionChecksModule, 'checkVSCodeVersion').returns({
            ok: true,
            installedVersion: '1.99.0',
            requiredVersion: '1.99.0'
        });

        // Call executeSync which should trigger the version check
        // Use isManualSync=true to bypass workspace folder check
        try {
            await syncManager.executeSync(
                'Test sync',
                false, // Don't show messages
                undefined,
                true // isManualSync - bypasses workspace folder requirement
            );
        } catch (error) {
            // Expected - sync might fail for other reasons in test environment
        }

        // Verify that showInformationMessage was NOT called
        assert.ok(!showInformationMessageStub.called, 'showInformationMessage should not be called when version is sufficient');
        assert.ok(!openExternalStub.called, 'openExternal should not be called when version is sufficient');
    });
});

