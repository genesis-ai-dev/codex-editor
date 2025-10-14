import * as assert from "assert";
import sinon from "sinon";
import * as vscode from "vscode";
import { CodexCellEditorProvider } from "../../../providers/codexCellEditorProvider/codexCellEditorProvider";
import { CodexCellDocument } from "../../../providers/codexCellEditorProvider/codexDocument";
import { codexSubtitleContent } from "../mocks/codexSubtitleContent";
import { CodexCellTypes } from "../../../../types/enums";
import { ValidationEntry } from "../../../../types";
import {
    swallowDuplicateCommandRegistrations,
    createTempCodexFile,
    deleteIfExists,
    createMockExtensionContext,
    sleep
} from "../../testUtils";

suite("Audio Validation Database Integration Test Suite", () => {
    vscode.window.showInformationMessage("Start all tests for Audio Validation Database Integration.");
    let context: vscode.ExtensionContext;
    let provider: CodexCellEditorProvider;
    let tempUri: vscode.Uri;

    suiteSetup(async () => {
        swallowDuplicateCommandRegistrations();
    });

    setup(async () => {
        swallowDuplicateCommandRegistrations();
        context = createMockExtensionContext();
        provider = new CodexCellEditorProvider(context);

        // Create a unique temp file per test to avoid cross-test races on slow machines
        tempUri = await createTempCodexFile(
            `test-audio-validation-db-${Date.now()}-${Math.random().toString(36).slice(2)}.codex`,
            codexSubtitleContent
        );

        // Stub background tasks to avoid side-effects and assert calls
        sinon.restore();
        sinon.stub((CodexCellDocument as any).prototype, "addCellToIndexImmediately").callsFake(() => { });
        sinon.stub((CodexCellDocument as any).prototype, "populateSourceCellMapFromIndex").resolves();
    });

    teardown(async () => {
        sinon.restore(); // Restore all stubs after each test
        if (tempUri) await deleteIfExists(tempUri);
    });

    suite("Database Field Updates for Audio Validation", () => {
        test("should preserve validatedBy entries from both users when merging attachments during sync", async () => {
            // Arrange: Open document and get a cell, then add an audio attachment
            const document = await provider.openCustomDocument(
                tempUri,
                { backupId: undefined },
                new vscode.CancellationTokenSource().token
            );

            const cellId = (document as any)._documentData.cells[0].metadata?.id;
            assert.ok(cellId, "Cell should have an ID");

            // Add an audio attachment to the cell
            const audioId = "test-audio-merge-validatedBy";
            document.updateCellAttachment(cellId, audioId, {
                url: "test-audio.webm",
                type: "audio",
                createdAt: Date.now(),
                updatedAt: Date.now(),
                isDeleted: false,
            });

            // Stub database sync to capture what would be saved
            let capturedAfterMerge: any = null;
            const syncStub = sinon.stub((CodexCellDocument as any).prototype, "syncAllCellsToDatabase").callsFake(async function (this: any) {
                capturedAfterMerge = this._documentData.cells.find((c: any) => c.metadata?.id === cellId);
                return Promise.resolve();
            });

            // Simulate two different users validating on separate sides of a merge
            const extensionModule = await import("../../../extension");
            const originalGetAuthApi = extensionModule.getAuthApi;

            const user1Stub = sinon.stub().resolves({ username: "userA" });
            const user2Stub = sinon.stub().resolves({ username: "userB" });

            // First user validates (local)
            (extensionModule as any).getAuthApi = () => ({ getUserInfo: user1Stub });
            await document.validateCellAudio(cellId, true);

            // Capture a deep clone representing "our" side
            const ourSnapshot = JSON.parse(JSON.stringify((document as any)._documentData));

            // Second user validates (simulate "their" side) by applying directly to attachments validatedBy
            (extensionModule as any).getAuthApi = () => ({ getUserInfo: user2Stub });
            await document.validateCellAudio(cellId, true);

            const theirSnapshot = JSON.parse(JSON.stringify((document as any)._documentData));

            // Now simulate a merge of attachments where both sides changed validatedBy for the same attachment
            // Use the mergeAttachments used by the project merge logic
            const resolvers = await import("../../../projectManager/utils/merge/resolvers");

            const ourCell = ourSnapshot.cells.find((c: any) => c.metadata?.id === cellId);
            const theirCell = theirSnapshot.cells.find((c: any) => c.metadata?.id === cellId);
            assert.ok(ourCell && theirCell, "Both cells should exist for merge test");

            // Perform merge similar to resolveCodexCustomMerge core for attachments
            const mergedAttachments = (resolvers as any).mergeAttachments(
                ourCell.metadata?.attachments,
                theirCell.metadata?.attachments
            );

            // Apply merged attachments back and save
            const cellRef = (document as any)._documentData.cells.find((c: any) => c.metadata?.id === cellId);
            cellRef.metadata.attachments = mergedAttachments;

            await document.save(new vscode.CancellationTokenSource().token);

            // Assert: both users' validatedBy entries should be preserved on the latest attachment version
            assert.ok(capturedAfterMerge, "Cell data should be captured for database sync");

            const audioAttachments = capturedAfterMerge?.metadata?.attachments ?
                Object.values(capturedAfterMerge.metadata.attachments).filter((attachment: any) =>
                    attachment && attachment.type === "audio" && !attachment.isDeleted
                ) : [];

            assert.ok(audioAttachments.length > 0, "Should have audio attachments");
            const currentAudioAttachment = audioAttachments.sort((a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] as any;

            const activeValidations = Array.isArray(currentAudioAttachment.validatedBy)
                ? currentAudioAttachment.validatedBy.filter((entry: any) => entry && !entry.isDeleted)
                : [];

            const usernames = activeValidations.map((e: any) => e.username).sort();
            assert.strictEqual(activeValidations.length, 2, "Expected two active validations after merge");
            assert.deepStrictEqual(usernames, ["userA", "userB"].sort(), "Both userA and userB should be present");

            // Cleanup
            (extensionModule as any).getAuthApi = originalGetAuthApi;
            syncStub.restore();
            document.dispose();
        });
        test("should update t_audio_validated_by and t_audio_validation_count when audio validation button is pressed", async () => {
            // Arrange: Open document and get a cell, then add an audio attachment
            const document = await provider.openCustomDocument(
                tempUri,
                { backupId: undefined },
                new vscode.CancellationTokenSource().token
            );

            const cellId = (document as any)._documentData.cells[0].metadata?.id;
            assert.ok(cellId, "Cell should have an ID");

            // Add an audio attachment to the cell
            const audioId = "test-audio-db-123";
            document.updateCellAttachment(cellId, audioId, {
                url: "test-audio.webm",
                type: "audio",
                createdAt: Date.now(),
                updatedAt: Date.now(),
                isDeleted: false,
            });

            // Mock the database sync to capture the data that would be stored
            let capturedCellData: any = null;
            const syncStub = sinon.stub((CodexCellDocument as any).prototype, "syncAllCellsToDatabase").callsFake(async function (this: any) {
                // Capture the cell data that would be synced to database
                capturedCellData = this._documentData.cells.find((c: any) => c.metadata?.id === cellId);
                return Promise.resolve();
            });

            // Act: Validate audio (simulating audio validation button press)
            await document.validateCellAudio(cellId, true);

            // Force a database sync to capture the data
            await document.save(new vscode.CancellationTokenSource().token);

            // Assert: Check that the database fields would be updated correctly
            assert.ok(capturedCellData, "Cell data should be captured for database sync");

            // Get the current audio attachment
            const audioAttachments = capturedCellData?.metadata?.attachments ?
                Object.values(capturedCellData.metadata.attachments).filter((attachment: any) =>
                    attachment && attachment.type === "audio" && !attachment.isDeleted
                ) : [];

            assert.ok(audioAttachments.length > 0, "Should have audio attachments");

            const currentAudioAttachment = audioAttachments.sort((a: any, b: any) =>
                (b.updatedAt || 0) - (a.updatedAt || 0)
            )[0] as any;

            // Check that validatedBy array exists and has the correct structure
            assert.ok(currentAudioAttachment.validatedBy, "Should have validatedBy array");
            assert.ok(Array.isArray(currentAudioAttachment.validatedBy), "validatedBy should be an array");
            assert.strictEqual(currentAudioAttachment.validatedBy.length, 1, "Should have one validation entry");

            const validationEntry = currentAudioAttachment.validatedBy[0];
            assert.ok(validationEntry, "Should have validation entry");
            assert.strictEqual(validationEntry.username, "anonymous", "Should have correct username");
            assert.strictEqual(validationEntry.isDeleted, false, "Should not be deleted");
            assert.ok(typeof validationEntry.creationTimestamp === "number", "Should have numeric creation timestamp");
            assert.ok(typeof validationEntry.updatedTimestamp === "number", "Should have numeric updated timestamp");

            // Verify the data structure matches what would be stored in database fields
            const activeValidations = currentAudioAttachment.validatedBy.filter((entry: ValidationEntry) => !entry.isDeleted);
            const expectedValidationCount = activeValidations.length;
            const expectedValidatedBy = activeValidations.map((entry: ValidationEntry) => entry.username).join(',');

            assert.strictEqual(expectedValidationCount, 1, "t_audio_validation_count should be 1");
            assert.strictEqual(expectedValidatedBy, "anonymous", "t_audio_validated_by should contain 'anonymous'");

            document.dispose();
        });

        test("should update database fields when multiple users validate audio", async () => {
            // Arrange: Open document and get a cell, then add an audio attachment
            const document = await provider.openCustomDocument(
                tempUri,
                { backupId: undefined },
                new vscode.CancellationTokenSource().token
            );

            const cellId = (document as any)._documentData.cells[0].metadata?.id;
            assert.ok(cellId, "Cell should have an ID");

            // Add an audio attachment to the cell
            const audioId = "test-audio-multi-user";
            document.updateCellAttachment(cellId, audioId, {
                url: "test-audio.webm",
                type: "audio",
                createdAt: Date.now(),
                updatedAt: Date.now(),
                isDeleted: false,
            });

            // Mock different users by stubbing the extension's getAuthApi function
            const user1Stub = sinon.stub().resolves({ username: "user1" });
            const user2Stub = sinon.stub().resolves({ username: "user2" });
            const user3Stub = sinon.stub().resolves({ username: "user3" });

            // Import the extension module to stub getAuthApi
            const extensionModule = await import("../../../extension");
            const originalGetAuthApi = extensionModule.getAuthApi;

            // Mock database sync to capture data
            let capturedCellData: any = null;
            const syncStub = sinon.stub((CodexCellDocument as any).prototype, "syncAllCellsToDatabase").callsFake(async function (this: any) {
                capturedCellData = this._documentData.cells.find((c: any) => c.metadata?.id === cellId);
                return Promise.resolve();
            });

            // Act: Validate with multiple users
            (extensionModule as any).getAuthApi = () => ({ getUserInfo: user1Stub });
            await document.validateCellAudio(cellId, true);

            (extensionModule as any).getAuthApi = () => ({ getUserInfo: user2Stub });
            await document.validateCellAudio(cellId, true);

            (extensionModule as any).getAuthApi = () => ({ getUserInfo: user3Stub });
            await document.validateCellAudio(cellId, true);

            // Force database sync
            await document.save(new vscode.CancellationTokenSource().token);

            // Assert: Check that database fields reflect multiple users
            assert.ok(capturedCellData, "Cell data should be captured for database sync");

            const audioAttachments = capturedCellData?.metadata?.attachments ?
                Object.values(capturedCellData.metadata.attachments).filter((attachment: any) =>
                    attachment && attachment.type === "audio" && !attachment.isDeleted
                ) : [];

            const currentAudioAttachment = audioAttachments.sort((a: any, b: any) =>
                (b.updatedAt || 0) - (a.updatedAt || 0)
            )[0] as any;

            const activeValidations = currentAudioAttachment.validatedBy.filter((entry: ValidationEntry) => !entry.isDeleted);
            const expectedValidationCount = activeValidations.length;
            const expectedValidatedBy = activeValidations.map((entry: ValidationEntry) => entry.username).join(',');

            assert.strictEqual(expectedValidationCount, 3, "t_audio_validation_count should be 3");
            assert.ok(expectedValidatedBy.includes("user1"), "t_audio_validated_by should include user1");
            assert.ok(expectedValidatedBy.includes("user2"), "t_audio_validated_by should include user2");
            assert.ok(expectedValidatedBy.includes("user3"), "t_audio_validated_by should include user3");

            // Restore original function
            (extensionModule as any).getAuthApi = originalGetAuthApi;
            document.dispose();
        });

        test("should update database fields when user unvalidates audio", async () => {
            // Arrange: Open document and get a cell, then add an audio attachment
            const document = await provider.openCustomDocument(
                tempUri,
                { backupId: undefined },
                new vscode.CancellationTokenSource().token
            );

            const cellId = (document as any)._documentData.cells[0].metadata?.id;
            assert.ok(cellId, "Cell should have an ID");

            // Clear any existing audio attachments to ensure clean state
            const cell = (document as any)._documentData.cells.find((c: any) => c.metadata?.id === cellId);
            if (cell?.metadata?.attachments) {
                cell.metadata.attachments = {};
            }

            // Add an audio attachment to the cell
            const audioId = "test-audio-unvalidate";
            document.updateCellAttachment(cellId, audioId, {
                url: "test-audio.webm",
                type: "audio",
                createdAt: Date.now(),
                updatedAt: Date.now(),
                isDeleted: false,
            });

            // Clear any pre-existing validatedBy array to start fresh
            const cellAfterAttachment = (document as any)._documentData.cells.find((c: any) => c.metadata?.id === cellId);
            if (cellAfterAttachment?.metadata?.attachments?.[audioId]) {
                cellAfterAttachment.metadata.attachments[audioId].validatedBy = [];
            }

            // Verify clean state before test
            const initialValidatedBy = cellAfterAttachment?.metadata?.attachments?.[audioId]?.validatedBy;
            assert.ok(Array.isArray(initialValidatedBy) && initialValidatedBy.length === 0,
                `Should start with empty validatedBy array, but has ${initialValidatedBy?.length || 'undefined'} entries`);

            // Mock database sync to capture data - capture ALL syncs
            const allSyncedData: any[] = [];

            const syncStub = sinon.stub((CodexCellDocument as any).prototype, "syncAllCellsToDatabase").callsFake(async function (this: any) {
                // Deep clone to avoid reference issues
                const cellData = JSON.parse(JSON.stringify(this._documentData.cells.find((c: any) => c.metadata?.id === cellId)));

                // Get the current audio attachment state
                const audioAttachments = cellData?.metadata?.attachments ?
                    Object.values(cellData.metadata.attachments).filter((attachment: any) =>
                        attachment && attachment.type === "audio" && !attachment.isDeleted
                    ) : [];

                const currentAudio = audioAttachments.sort((a: any, b: any) =>
                    (b.updatedAt || 0) - (a.updatedAt || 0)
                )[0] as any;

                if (currentAudio && Array.isArray(currentAudio.validatedBy)) {
                    const activeValidations = currentAudio.validatedBy.filter((e: any) => !e.isDeleted);
                    allSyncedData.push({
                        cellData,
                        activeValidationCount: activeValidations.length,
                    });
                }

                return Promise.resolve();
            });

            // Act: First validate, then unvalidate
            await document.validateCellAudio(cellId, true);
            await document.save(new vscode.CancellationTokenSource().token);
            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 100));

            await document.validateCellAudio(cellId, false);
            await document.save(new vscode.CancellationTokenSource().token);
            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 100));

            // Assert: Find the validation and unvalidation saves
            const validationSave = allSyncedData.find(s => s.activeValidationCount === 1);
            const unvalidationSave = allSyncedData.find(s => s.activeValidationCount === 0);

            assert.ok(validationSave, `Should have captured validation save. Captured ${allSyncedData.length} saves with counts: ${allSyncedData.map(s => s.activeValidationCount).join(', ')}`);
            assert.ok(unvalidationSave, `Should have captured unvalidation save. Captured ${allSyncedData.length} saves with counts: ${allSyncedData.map(s => s.activeValidationCount).join(', ')}`);

            const capturedCellDataAfterValidate = validationSave.cellData;
            const capturedCellDataAfterUnvalidate = unvalidationSave.cellData;

            // Check validation state after validate
            const audioAttachmentsAfterValidate = capturedCellDataAfterValidate?.metadata?.attachments ?
                Object.values(capturedCellDataAfterValidate.metadata.attachments).filter((attachment: any) =>
                    attachment && attachment.type === "audio" && !attachment.isDeleted
                ) : [];

            const currentAudioAttachmentAfterValidate = audioAttachmentsAfterValidate.sort((a: any, b: any) =>
                (b.updatedAt || 0) - (a.updatedAt || 0)
            )[0] as any;

            const activeValidationsAfterValidate = currentAudioAttachmentAfterValidate.validatedBy.filter((entry: ValidationEntry) => !entry.isDeleted);
            assert.strictEqual(activeValidationsAfterValidate.length, 1, "Should have 1 active validation after validate");

            // Check validation state after unvalidate
            const audioAttachmentsAfterUnvalidate = capturedCellDataAfterUnvalidate?.metadata?.attachments ?
                Object.values(capturedCellDataAfterUnvalidate.metadata.attachments).filter((attachment: any) =>
                    attachment && attachment.type === "audio" && !attachment.isDeleted
                ) : [];

            assert.ok(audioAttachmentsAfterUnvalidate.length > 0, "Should have audio attachments after unvalidation");
            const currentAudioAttachmentAfterUnvalidate = audioAttachmentsAfterUnvalidate.sort((a: any, b: any) =>
                (b.updatedAt || 0) - (a.updatedAt || 0)
            )[0] as any;
            assert.ok(currentAudioAttachmentAfterUnvalidate, "No audio attachment found after unvalidation");

            const validatedByAfterUnvalidate = Array.isArray(currentAudioAttachmentAfterUnvalidate.validatedBy)
                ? currentAudioAttachmentAfterUnvalidate.validatedBy
                : [];

            const activeValidationsAfterUnvalidate = validatedByAfterUnvalidate.filter((entry: ValidationEntry) => !entry.isDeleted);
            const expectedValidationCountAfterUnvalidate = activeValidationsAfterUnvalidate.length;
            const expectedValidatedByAfterUnvalidate = activeValidationsAfterUnvalidate.map((entry: ValidationEntry) => entry.username).join(',');

            assert.strictEqual(expectedValidationCountAfterUnvalidate, 0, "t_audio_validation_count should be 0 after unvalidation");
            assert.strictEqual(expectedValidatedByAfterUnvalidate, "", "t_audio_validated_by should be empty after unvalidation");

            syncStub.restore();
            document.dispose();
        });

        test("should handle database field updates when user re-validates after unvalidation", async () => {
            // Arrange: Open document and get a cell, then add an audio attachment
            const document = await provider.openCustomDocument(
                tempUri,
                { backupId: undefined },
                new vscode.CancellationTokenSource().token
            );

            const cellId = (document as any)._documentData.cells[0].metadata?.id;
            assert.ok(cellId, "Cell should have an ID");

            // Clear any existing audio attachments to ensure clean state
            const cell = (document as any)._documentData.cells.find((c: any) => c.metadata?.id === cellId);
            if (cell?.metadata?.attachments) {
                cell.metadata.attachments = {};
            }

            // Add an audio attachment to the cell
            const audioId = "test-audio-revalidate";
            document.updateCellAttachment(cellId, audioId, {
                url: "test-audio.webm",
                type: "audio",
                createdAt: Date.now(),
                updatedAt: Date.now(),
                isDeleted: false,
            });

            // Clear any pre-existing validatedBy array to start fresh
            const cellAfterAttachment = (document as any)._documentData.cells.find((c: any) => c.metadata?.id === cellId);
            if (cellAfterAttachment?.metadata?.attachments?.[audioId]) {
                cellAfterAttachment.metadata.attachments[audioId].validatedBy = [];
            }

            // Mock database sync to capture data
            let capturedCellDataAfterRevalidate: any = null;
            const syncStub = sinon.stub((CodexCellDocument as any).prototype, "syncAllCellsToDatabase").callsFake(async function (this: any) {
                // Deep clone to avoid reference issues
                capturedCellDataAfterRevalidate = JSON.parse(JSON.stringify(this._documentData.cells.find((c: any) => c.metadata?.id === cellId)));
                return Promise.resolve();
            });

            // Act: Validate, unvalidate, then re-validate
            await document.validateCellAudio(cellId, true);
            await document.validateCellAudio(cellId, false);
            await document.validateCellAudio(cellId, true);
            await document.save(new vscode.CancellationTokenSource().token);

            // Assert: Check that database fields are correct after re-validation
            assert.ok(capturedCellDataAfterRevalidate, "Cell data should be captured for database sync");

            const audioAttachments = capturedCellDataAfterRevalidate?.metadata?.attachments ?
                Object.values(capturedCellDataAfterRevalidate.metadata.attachments).filter((attachment: any) =>
                    attachment && attachment.type === "audio" && !attachment.isDeleted
                ) : [];

            const currentAudioAttachment = audioAttachments.sort((a: any, b: any) =>
                (b.updatedAt || 0) - (a.updatedAt || 0)
            )[0] as any;

            const activeValidations = currentAudioAttachment.validatedBy.filter((entry: ValidationEntry) => !entry.isDeleted);
            const expectedValidationCount = activeValidations.length;
            const expectedValidatedBy = activeValidations.map((entry: ValidationEntry) => entry.username).join(',');

            assert.strictEqual(expectedValidationCount, 1, "t_audio_validation_count should be 1 after re-validation");
            assert.strictEqual(expectedValidatedBy, "anonymous", "t_audio_validated_by should contain 'anonymous' after re-validation");

            // Verify that the validation entry has been updated (not duplicated)
            assert.strictEqual(currentAudioAttachment.validatedBy.length, 1, "Should have only one validation entry (not duplicated)");
            const validationEntry = currentAudioAttachment.validatedBy[0];
            assert.strictEqual(validationEntry.isDeleted, false, "Validation entry should not be deleted");

            document.dispose();
        });

        test("should handle database field updates with mixed validation states (some users validate, some unvalidate)", async () => {
            // Arrange: Open document and get a cell, then add an audio attachment
            const document = await provider.openCustomDocument(
                tempUri,
                { backupId: undefined },
                new vscode.CancellationTokenSource().token
            );

            const cellId = (document as any)._documentData.cells[0].metadata?.id;
            assert.ok(cellId, "Cell should have an ID");

            // Add an audio attachment to the cell
            const audioId = "test-audio-mixed-states";
            document.updateCellAttachment(cellId, audioId, {
                url: "test-audio.webm",
                type: "audio",
                createdAt: Date.now(),
                updatedAt: Date.now(),
                isDeleted: false,
            });

            // Mock different users
            const user1Stub = sinon.stub().resolves({ username: "user1" });
            const user2Stub = sinon.stub().resolves({ username: "user2" });
            const user3Stub = sinon.stub().resolves({ username: "user3" });

            const extensionModule = await import("../../../extension");
            const originalGetAuthApi = extensionModule.getAuthApi;

            // Mock database sync to capture data
            let capturedCellData: any = null;
            const syncStub = sinon.stub((CodexCellDocument as any).prototype, "syncAllCellsToDatabase").callsFake(async function (this: any) {
                capturedCellData = this._documentData.cells.find((c: any) => c.metadata?.id === cellId);
                return Promise.resolve();
            });

            // Act: Multiple users validate, then some unvalidate
            (extensionModule as any).getAuthApi = () => ({ getUserInfo: user1Stub });
            await document.validateCellAudio(cellId, true);

            (extensionModule as any).getAuthApi = () => ({ getUserInfo: user2Stub });
            await document.validateCellAudio(cellId, true);

            (extensionModule as any).getAuthApi = () => ({ getUserInfo: user3Stub });
            await document.validateCellAudio(cellId, true);

            // Now user2 unvalidates
            (extensionModule as any).getAuthApi = () => ({ getUserInfo: user2Stub });
            await document.validateCellAudio(cellId, false);

            await document.save(new vscode.CancellationTokenSource().token);

            // Assert: Check that database fields reflect the mixed state
            assert.ok(capturedCellData, "Cell data should be captured for database sync");

            const audioAttachments = capturedCellData?.metadata?.attachments ?
                Object.values(capturedCellData.metadata.attachments).filter((attachment: any) =>
                    attachment && attachment.type === "audio" && !attachment.isDeleted
                ) : [];

            const currentAudioAttachment = audioAttachments.sort((a: any, b: any) =>
                (b.updatedAt || 0) - (a.updatedAt || 0)
            )[0] as any;

            const activeValidations = currentAudioAttachment.validatedBy.filter((entry: ValidationEntry) => !entry.isDeleted);
            const expectedValidationCount = activeValidations.length;
            const expectedValidatedBy = activeValidations.map((entry: ValidationEntry) => entry.username).join(',');

            assert.strictEqual(expectedValidationCount, 2, "t_audio_validation_count should be 2 (user1 and user3)");
            assert.ok(expectedValidatedBy.includes("user1"), "t_audio_validated_by should include user1");
            assert.ok(!expectedValidatedBy.includes("user2"), "t_audio_validated_by should not include user2 (unvalidated)");
            assert.ok(expectedValidatedBy.includes("user3"), "t_audio_validated_by should include user3");

            // Verify that user2's entry is marked as deleted
            const allValidations = currentAudioAttachment.validatedBy;
            const user2Entry = allValidations.find((entry: ValidationEntry) => entry.username === "user2");
            assert.ok(user2Entry, "User2's entry should still exist");
            assert.strictEqual(user2Entry.isDeleted, true, "User2's entry should be marked as deleted");

            // Restore original function
            (extensionModule as any).getAuthApi = originalGetAuthApi;
            document.dispose();
        });

        test("should maintain correct database field values when document is saved multiple times", async () => {
            // Arrange: Open document and get a cell, then add an audio attachment
            const document = await provider.openCustomDocument(
                tempUri,
                { backupId: undefined },
                new vscode.CancellationTokenSource().token
            );

            const cellId = (document as any)._documentData.cells[0].metadata?.id;
            assert.ok(cellId, "Cell should have an ID");

            // Clear any existing audio attachments to ensure clean state
            const cell = (document as any)._documentData.cells.find((c: any) => c.metadata?.id === cellId);
            if (cell?.metadata?.attachments) {
                cell.metadata.attachments = {};
            }

            // Add an audio attachment to the cell
            const audioId = "test-audio-multiple-saves";
            document.updateCellAttachment(cellId, audioId, {
                url: "test-audio.webm",
                type: "audio",
                createdAt: Date.now(),
                updatedAt: Date.now(),
                isDeleted: false,
            });

            // Mock database sync to capture data - use a fresh array for this test
            const capturedData: any[] = [];
            const syncStub = sinon.stub(document as any, "syncAllCellsToDatabase").callsFake(async function (this: any) {
                const cellData = this._documentData.cells.find((c: any) => c.metadata?.id === cellId);
                if (cellData) {
                    // Only capture data for the specific cell we're testing
                    const clonedData = JSON.parse(JSON.stringify(cellData));
                    capturedData.push(clonedData);
                }
                return Promise.resolve();
            });

            // Act: Validate audio once and save multiple times
            await document.validateCellAudio(cellId, true);
            await document.save(new vscode.CancellationTokenSource().token); // First save

            await sleep(10); // Small delay to ensure timestamp difference
            await document.save(new vscode.CancellationTokenSource().token); // Second save

            await sleep(10);
            await document.save(new vscode.CancellationTokenSource().token); // Third save

            // Assert: Check that database fields remain consistent across saves
            // Note: The sync method may be called more times due to other operations
            assert.ok(capturedData.length >= 3, "Should have captured data for at least 3 saves");

            // Check the first 3 saves to ensure consistency
            const savesToCheck = Math.min(3, capturedData.length);
            for (let i = 0; i < savesToCheck; i++) {
                const cellData = capturedData[i];
                const audioAttachments = cellData?.metadata?.attachments ?
                    Object.values(cellData.metadata.attachments).filter((attachment: any) =>
                        attachment && attachment.type === "audio" && !attachment.isDeleted
                    ) : [];

                const currentAudioAttachment = audioAttachments.sort((a: any, b: any) =>
                    (b.updatedAt || 0) - (a.updatedAt || 0)
                )[0] as any;

                const activeValidations = currentAudioAttachment.validatedBy.filter((entry: ValidationEntry) => !entry.isDeleted);
                const expectedValidationCount = activeValidations.length;
                const expectedValidatedBy = activeValidations.map((entry: ValidationEntry) => entry.username).join(',');

                // Debug: Log the validation count for each save
                console.log(`Save ${i + 1}: validation count = ${expectedValidationCount}, validated by = ${expectedValidatedBy}`);

                // The validation count should be consistent across all saves (should be 1)
                assert.strictEqual(expectedValidationCount, 1, `t_audio_validation_count should be 1 for save ${i + 1}`);
                assert.strictEqual(expectedValidatedBy, "anonymous", `t_audio_validated_by should be 'anonymous' for save ${i + 1}`);
            }

            // Clean up the stub
            syncStub.restore();
            document.dispose();
        });
    });
});
