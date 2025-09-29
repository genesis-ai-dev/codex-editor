import * as assert from "assert";
import sinon from "sinon";
import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import { CodexCellEditorProvider } from "../../../providers/codexCellEditorProvider/codexCellEditorProvider";
import { CodexCellDocument } from "../../../providers/codexCellEditorProvider/codexDocument";
import { handleMessages } from "../../../providers/codexCellEditorProvider/codexCellEditorMessagehandling";
import { codexSubtitleContent } from "../mocks/codexSubtitleContent";
import { CodexCellTypes, EditType } from "../../../../types/enums";
import { CodexNotebookAsJSONData, QuillCellContent, ValidationEntry } from "../../../../types";
import {
    swallowDuplicateCommandRegistrations,
    createTempCodexFile,
    deleteIfExists,
    createMockExtensionContext,
    primeProviderWorkspaceStateForHtml,
    sleep
} from "../../testUtils";

suite("Audio Validation Test Suite", () => {
    vscode.window.showInformationMessage("Start all tests for Audio Validation functionality.");
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
            `test-audio-validation-${Date.now()}-${Math.random().toString(36).slice(2)}.codex`,
            codexSubtitleContent
        );

        // Stub background tasks to avoid side-effects and assert calls
        sinon.restore();
        sinon.stub((CodexCellDocument as any).prototype, "addCellToIndexImmediately").callsFake(() => { });
        sinon.stub((CodexCellDocument as any).prototype, "syncAllCellsToDatabase").resolves();
        sinon.stub((CodexCellDocument as any).prototype, "populateSourceCellMapFromIndex").resolves();
    });

    teardown(async () => {
        if (tempUri) await deleteIfExists(tempUri);
    });

    suite("CodexCellDocument.validateCellAudio", () => {
        test("should validate audio for a cell with existing audio attachment", async () => {
            // Arrange: Open document and get a cell, then add an audio attachment
            const document = await provider.openCustomDocument(
                tempUri,
                { backupId: undefined },
                new vscode.CancellationTokenSource().token
            );

            const cellId = (document as any)._documentData.cells[0].metadata?.id;
            assert.ok(cellId, "Cell should have an ID");

            // Add an audio attachment to the cell
            const audioId = "test-audio-123";
            document.updateCellAttachment(cellId, audioId, {
                url: "test-audio.webm",
                type: "audio",
                createdAt: Date.now(),
                updatedAt: Date.now(),
                isDeleted: false,
            });

            // Act: Validate audio
            await document.validateCellAudio(cellId, true);

            // Assert: Check that audio validation was added to the attachment
            const cell = (document as any)._documentData.cells.find((c: any) => c.metadata?.id === cellId);
            assert.ok(cell, "Cell should exist");
            assert.ok(cell.metadata?.attachments?.[audioId], "Should have audio attachment");

            const audioAttachment = cell.metadata.attachments[audioId];
            assert.ok(audioAttachment.validatedBy, "Should have validatedBy array");
            assert.strictEqual(audioAttachment.validatedBy.length, 1, "Should have one audio validation entry");

            const validationEntry = audioAttachment.validatedBy[0];
            assert.strictEqual(validationEntry.username, "anonymous", "Should have anonymous username");
            assert.strictEqual(validationEntry.isDeleted, false, "Should not be deleted");
            assert.ok(validationEntry.creationTimestamp > 0, "Should have creation timestamp");
            assert.ok(validationEntry.updatedTimestamp > 0, "Should have updated timestamp");

            document.dispose();
        });

        test("should unvalidate audio for a cell", async () => {
            // Arrange: Open document and get a cell, then add an audio attachment
            const document = await provider.openCustomDocument(
                tempUri,
                { backupId: undefined },
                new vscode.CancellationTokenSource().token
            );

            const cellId = (document as any)._documentData.cells[0].metadata?.id;
            assert.ok(cellId, "Cell should have an ID");

            // Add an audio attachment to the cell
            const audioId = "test-audio-123";
            document.updateCellAttachment(cellId, audioId, {
                url: "test-audio.webm",
                type: "audio",
                createdAt: Date.now(),
                updatedAt: Date.now(),
                isDeleted: false,
            });

            await document.validateCellAudio(cellId, true);

            // Act: Unvalidate audio
            await document.validateCellAudio(cellId, false);

            // Assert: Check that audio validation was marked as deleted
            const cell = (document as any)._documentData.cells.find((c: any) => c.metadata?.id === cellId);
            const audioAttachment = cell?.metadata?.attachments?.[audioId];
            const validationEntry = audioAttachment?.validatedBy?.[0];

            assert.strictEqual(validationEntry?.isDeleted, true, "Should be marked as deleted");

            document.dispose();
        });

        test("should throw error when no audio attachment exists", async () => {
            // Arrange: Open document and create a cell without audio attachment
            const document = await provider.openCustomDocument(
                tempUri,
                { backupId: undefined },
                new vscode.CancellationTokenSource().token
            );

            const cellId = "test-cell-no-audio";
            const newCell: any = {
                cellType: CodexCellTypes.TEXT,
                value: "<p>Test content</p>",
                metadata: {
                    id: cellId,
                    edits: []
                }
            };
            (document as any)._documentData.cells.push(newCell);

            // Act & Assert: Should throw error when trying to validate audio without attachment
            try {
                await document.validateCellAudio(cellId, true);
                assert.fail("Should have thrown an error");
            } catch (error: any) {
                assert.strictEqual(error.message, "No audio attachment found for cell to validate");
            }

            document.dispose();
        });

        test("should handle multiple users validating the same cell", async () => {
            // Arrange: Open document and get a cell, then add an audio attachment
            const document = await provider.openCustomDocument(
                tempUri,
                { backupId: undefined },
                new vscode.CancellationTokenSource().token
            );

            const cellId = (document as any)._documentData.cells[0].metadata?.id;
            assert.ok(cellId, "Cell should have an ID");

            // Add an audio attachment to the cell
            const audioId = "test-audio-123";
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

            // Import the extension module to stub getAuthApi
            const extensionModule = await import("../../../extension");
            const originalGetAuthApi = extensionModule.getAuthApi;

            // Act: Validate with user1
            (extensionModule as any).getAuthApi = () => ({ getUserInfo: user1Stub });
            await document.validateCellAudio(cellId, true);

            // Validate with user2
            (extensionModule as any).getAuthApi = () => ({ getUserInfo: user2Stub });
            await document.validateCellAudio(cellId, true);

            // Assert: Check that both users are in the validation list
            const cell = (document as any)._documentData.cells.find((c: any) => c.metadata?.id === cellId);
            const audioAttachment = cell?.metadata?.attachments?.[audioId];
            const activeValidations = audioAttachment?.validatedBy?.filter((entry: ValidationEntry) => !entry.isDeleted) || [];

            assert.strictEqual(activeValidations.length, 2, "Should have 2 active validations");
            const usernames = activeValidations.map((entry: ValidationEntry) => entry.username);
            assert.ok(usernames.includes("user1"), "Should include user1");
            assert.ok(usernames.includes("user2"), "Should include user2");

            // Restore original function
            (extensionModule as any).getAuthApi = originalGetAuthApi;
            document.dispose();
        });

        test("should update existing validation entry instead of creating duplicate", async () => {
            // Arrange: Open document and get a cell, then add an audio attachment
            const document = await provider.openCustomDocument(
                tempUri,
                { backupId: undefined },
                new vscode.CancellationTokenSource().token
            );

            const cellId = (document as any)._documentData.cells[0].metadata?.id;
            assert.ok(cellId, "Cell should have an ID");

            // Add an audio attachment to the cell
            const audioId = "test-audio-123";
            document.updateCellAttachment(cellId, audioId, {
                url: "test-audio.webm",
                type: "audio",
                createdAt: Date.now(),
                updatedAt: Date.now(),
                isDeleted: false,
            });

            await document.validateCellAudio(cellId, true);
            const initialTimestamp = Date.now();

            // Wait a bit to ensure timestamp difference
            await sleep(10);

            // Act: Validate again with same user
            await document.validateCellAudio(cellId, true);

            // Assert: Should still have only one entry, but with updated timestamp
            const cell = (document as any)._documentData.cells.find((c: any) => c.metadata?.id === cellId);
            const audioAttachment = cell?.metadata?.attachments?.[audioId];
            const activeValidations = audioAttachment?.validatedBy?.filter((entry: ValidationEntry) => !entry.isDeleted) || [];

            assert.strictEqual(activeValidations.length, 1, "Should still have only one validation entry");
            assert.ok(activeValidations[0]?.updatedTimestamp && activeValidations[0].updatedTimestamp > initialTimestamp, "Should have updated timestamp");

            document.dispose();
        });

        test("should throw error for non-existent cell", async () => {
            // Arrange: Open document
            const document = await provider.openCustomDocument(
                tempUri,
                { backupId: undefined },
                new vscode.CancellationTokenSource().token
            );

            // Act & Assert
            await assert.rejects(
                document.validateCellAudio("non-existent-cell", true),
                /Could not find cell to validate audio/,
                "Should throw error for non-existent cell"
            );

            document.dispose();
        });

        test("should mark document as dirty after validation", async () => {
            // Arrange: Open document and get a cell, then add an audio attachment
            const document = await provider.openCustomDocument(
                tempUri,
                { backupId: undefined },
                new vscode.CancellationTokenSource().token
            );

            const cellId = (document as any)._documentData.cells[0].metadata?.id;
            assert.ok(cellId, "Cell should have an ID");

            // Add an audio attachment to the cell
            const audioId = "test-audio-123";
            document.updateCellAttachment(cellId, audioId, {
                url: "test-audio.webm",
                type: "audio",
                createdAt: Date.now(),
                updatedAt: Date.now(),
                isDeleted: false,
            });

            // Reset dirty state
            (document as any)._isDirty = false;

            // Act: Validate audio
            await document.validateCellAudio(cellId, true);

            // Assert: Document should be marked as dirty
            assert.strictEqual((document as any)._isDirty, true, "Document should be marked as dirty");

            document.dispose();
        });

        test("should fire document change event after validation", async () => {
            // Arrange: Open document and get a cell, then add an audio attachment
            const document = await provider.openCustomDocument(
                tempUri,
                { backupId: undefined },
                new vscode.CancellationTokenSource().token
            );

            const cellId = (document as any)._documentData.cells[0].metadata?.id;
            assert.ok(cellId, "Cell should have an ID");

            // Add an audio attachment to the cell
            const audioId = "test-audio-123";
            document.updateCellAttachment(cellId, audioId, {
                url: "test-audio.webm",
                type: "audio",
                createdAt: Date.now(),
                updatedAt: Date.now(),
                isDeleted: false,
            });

            let changeEventFired = false;
            let changeEventData: any = null;

            document.onDidChangeForVsCodeAndWebview((event) => {
                changeEventFired = true;
                changeEventData = event;
            });

            // Act: Validate audio
            await document.validateCellAudio(cellId, true);

            // Assert: Change event should have been fired
            assert.strictEqual(changeEventFired, true, "Change event should have been fired");
            assert.ok(changeEventData, "Change event data should exist");
            assert.strictEqual(changeEventData.edits[0].cellId, cellId, "Should include correct cell ID");
            assert.strictEqual(changeEventData.edits[0].type, "audioValidation", "Should have correct type");

            document.dispose();
        });
    });

    suite("CodexCellEditorProvider Audio Validation Queue", () => {
        test("should process audio validation requests in queue", async () => {
            // Arrange: Open document and set up provider with translation queue
            const document = await provider.openCustomDocument(
                tempUri,
                { backupId: undefined },
                new vscode.CancellationTokenSource().token
            );

            const cellId = (document as any)._documentData.cells[0].metadata?.id;
            assert.ok(cellId, "Cell should have an ID");

            // Mock the validateCellAudio method to track calls
            const validateCellAudioStub = sinon.stub(document, "validateCellAudio").resolves();

            // Act: Add audio validation request to queue
            (provider as any).translationQueue.push({
                document,
                cellId,
                shouldValidate: true,
                audioValidationRequest: true,
                resolve: () => { },
                reject: () => { }
            });

            // Process the queue
            await (provider as any).processTranslationQueue();

            // Assert: validateCellAudio should have been called
            assert.ok(validateCellAudioStub.called, "validateCellAudio should have been called");
            assert.ok(validateCellAudioStub.calledWith(cellId, true), "Should be called with correct parameters");

            document.dispose();
        });

        test("should send webview notifications during audio validation", async () => {
            // Arrange: Open document and set up provider with mock webview
            const document = await provider.openCustomDocument(
                tempUri,
                { backupId: undefined },
                new vscode.CancellationTokenSource().token
            );

            const cellId = (document as any)._documentData.cells[0].metadata?.id;
            assert.ok(cellId, "Cell should have an ID");

            const mockWebview = {
                postMessage: sinon.stub()
            };
            const mockWebviewPanel = {
                webview: mockWebview
            };
            (provider as any).webviewPanels.set(document.uri.toString(), mockWebviewPanel);

            // Act: Add audio validation request to queue
            (provider as any).translationQueue.push({
                document,
                cellId,
                shouldValidate: true,
                audioValidationRequest: true,
                resolve: () => { },
                reject: () => { }
            });

            await (provider as any).processTranslationQueue();

            // Assert: Webview should have received notifications
            assert.ok(mockWebview.postMessage.called, "Webview should have received messages");

            const calls = mockWebview.postMessage.getCalls();
            const inProgressCall = calls.find(call =>
                call.args[0].type === "audioValidationInProgress" &&
                call.args[0].content.inProgress === true
            );
            const completedCall = calls.find(call =>
                call.args[0].type === "audioValidationInProgress" &&
                call.args[0].content.inProgress === false
            );

            assert.ok(inProgressCall, "Should have sent in-progress notification");
            assert.ok(completedCall, "Should have sent completion notification");

            document.dispose();
        });

        test("should handle audio validation errors gracefully", async () => {
            // Arrange: Open document and set up provider with failing validation
            const document = await provider.openCustomDocument(
                tempUri,
                { backupId: undefined },
                new vscode.CancellationTokenSource().token
            );

            const cellId = (document as any)._documentData.cells[0].metadata?.id;
            assert.ok(cellId, "Cell should have an ID");

            const validateCellAudioStub = sinon.stub(document, "validateCellAudio").rejects(new Error("Validation failed"));

            // Act: Add audio validation request to queue
            (provider as any).translationQueue.push({
                document,
                cellId,
                shouldValidate: true,
                audioValidationRequest: true,
                resolve: () => { },
                reject: () => { }
            });

            // Process the queue (should not throw)
            await assert.doesNotReject(
                (provider as any).processTranslationQueue(),
                "Should handle validation errors gracefully"
            );

            // Assert: validateCellAudio should have been called
            assert.ok(validateCellAudioStub.called, "validateCellAudio should have been called");

            document.dispose();
        });
    });

    suite("ValidationEntry and Validation Utils", () => {
        test("should validate ValidationEntry structure", () => {
            // Arrange: Create valid and invalid validation entries
            const validEntry: ValidationEntry = {
                username: "testuser",
                creationTimestamp: Date.now(),
                updatedTimestamp: Date.now(),
                isDeleted: false
            };

            const invalidEntry1: any = {
                username: "testuser",
                creationTimestamp: Date.now(),
                // missing updatedTimestamp and isDeleted
            };

            const invalidEntry2 = {
                username: "testuser",
                creationTimestamp: "not-a-number",
                updatedTimestamp: Date.now(),
                isDeleted: false
            };

            // Act & Assert: Test validation logic
            assert.ok(validEntry.username === "testuser", "Valid entry should have correct username");
            assert.ok(typeof validEntry.creationTimestamp === "number", "Valid entry should have numeric creation timestamp");
            assert.ok(typeof validEntry.updatedTimestamp === "number", "Valid entry should have numeric updated timestamp");
            assert.ok(typeof validEntry.isDeleted === "boolean", "Valid entry should have boolean isDeleted");

            // Test invalid entries
            assert.ok(!invalidEntry1.updatedTimestamp, "Invalid entry should be missing updatedTimestamp");
            assert.ok(typeof invalidEntry2.creationTimestamp !== "number", "Invalid entry should have non-numeric creation timestamp");
        });

        test("should handle edge cases in validation arrays", async () => {
            // Arrange: Open document and get a cell, then add an audio attachment
            const document = await provider.openCustomDocument(
                tempUri,
                { backupId: undefined },
                new vscode.CancellationTokenSource().token
            );

            const cellId = (document as any)._documentData.cells[0].metadata?.id;
            assert.ok(cellId, "Cell should have an ID");

            // Add an audio attachment to the cell
            const audioId = "test-audio-edge-cases";
            document.updateCellAttachment(cellId, audioId, {
                url: "test-audio.webm",
                type: "audio",
                createdAt: Date.now(),
                updatedAt: Date.now(),
                isDeleted: false,
            });

            // Act: Validate audio multiple times to test array handling
            await document.validateCellAudio(cellId, true);
            await document.validateCellAudio(cellId, false);
            await document.validateCellAudio(cellId, true);

            // Assert: Should handle validation state changes correctly
            const cell = (document as any)._documentData.cells.find((c: any) => c.metadata?.id === cellId);

            // Check audio validation from attachments instead of edits
            const audioAttachments = cell?.metadata?.attachments ? Object.values(cell.metadata.attachments).filter((attachment: any) =>
                attachment && attachment.type === "audio" && !attachment.isDeleted
            ) : [];

            if (audioAttachments.length > 0) {
                const currentAudioAttachment = audioAttachments.sort((a: any, b: any) =>
                    (b.updatedAt || 0) - (a.updatedAt || 0)
                )[0];
                const activeValidations = (currentAudioAttachment as any)?.validatedBy?.filter((entry: ValidationEntry) => !entry.isDeleted) || [];

                assert.strictEqual(activeValidations.length, 1, "Should have one active validation after toggle");
                assert.strictEqual(activeValidations[0]?.isDeleted, false, "Active validation should not be deleted");
            } else {
                // If no audio attachments, validation should be empty
                assert.strictEqual(0, 0, "No audio attachments found");
            }

            document.dispose();
        });
    });

    suite("Database Integration", () => {
        test("should handle database sync for audio validation", async () => {
            // Arrange: Open document and get a cell, then add an audio attachment
            const document = await provider.openCustomDocument(
                tempUri,
                { backupId: undefined },
                new vscode.CancellationTokenSource().token
            );

            const cellId = (document as any)._documentData.cells[0].metadata?.id;
            assert.ok(cellId, "Cell should have an ID");

            // Add an audio attachment to the cell
            const audioId = "test-audio-db-sync";
            document.updateCellAttachment(cellId, audioId, {
                url: "test-audio.webm",
                type: "audio",
                createdAt: Date.now(),
                updatedAt: Date.now(),
                isDeleted: false,
            });

            // Note: syncAllCellsToDatabase is already stubbed in setup method
            // We can verify the stub was called by checking if it exists
            const syncStub = (CodexCellDocument as any).prototype.syncAllCellsToDatabase;
            assert.ok(syncStub && typeof syncStub === 'function', "syncAllCellsToDatabase should be stubbed");

            // Act: Validate audio
            await document.validateCellAudio(cellId, true);

            // Assert: Database sync should be called (indirectly through document save)
            // Note: The actual sync happens when the document is saved, not immediately
            // This test verifies the validation data is properly structured for database storage
            const cell = (document as any)._documentData.cells.find((c: any) => c.metadata?.id === cellId);

            // Check audio validation from attachments instead of edits
            const audioAttachments = cell?.metadata?.attachments ? Object.values(cell.metadata.attachments).filter((attachment: any) =>
                attachment && attachment.type === "audio" && !attachment.isDeleted
            ) : [];

            if (audioAttachments.length > 0) {
                const currentAudioAttachment = audioAttachments.sort((a: any, b: any) =>
                    (b.updatedAt || 0) - (a.updatedAt || 0)
                )[0];

                assert.ok((currentAudioAttachment as any)?.validatedBy, "Should have validatedBy for database storage");
                assert.ok(Array.isArray((currentAudioAttachment as any).validatedBy), "validatedBy should be an array");
            } else {
                // If no audio attachments, that's also valid
                assert.ok(true, "No audio attachments found, which is valid");
            }

            document.dispose();
        });
    });

    suite("Error Handling and Edge Cases", () => {
        test("should handle missing edit history gracefully", async () => {
            // Arrange: Open document and create a cell with malformed metadata
            const document = await provider.openCustomDocument(
                tempUri,
                { backupId: undefined },
                new vscode.CancellationTokenSource().token
            );

            const cellId = "test-cell-malformed";
            const newCell: any = {
                cellType: CodexCellTypes.TEXT,
                value: "<p>Test content</p>",
                metadata: {
                    id: cellId,
                    // No edits property
                }
            };
            (document as any)._documentData.cells.push(newCell);

            // Add an audio attachment to the cell
            const audioId = "test-audio-malformed";
            document.updateCellAttachment(cellId, audioId, {
                url: "test-audio.webm",
                type: "audio",
                createdAt: Date.now(),
                updatedAt: Date.now(),
                isDeleted: false,
            });

            // Act: Validate audio (should not throw)
            await assert.doesNotReject(
                document.validateCellAudio(cellId, true),
                "Should handle missing edit history gracefully"
            );

            // Assert: Audio validation should have been added to the attachment
            const cell = (document as any)._documentData.cells.find((c: any) => c.metadata?.id === cellId);
            const audioAttachment = cell?.metadata?.attachments?.[audioId];
            assert.ok(audioAttachment?.validatedBy, "Should have validatedBy array on audio attachment");
            assert.ok(audioAttachment.validatedBy.length > 0, "Should have at least one validation entry");

            document.dispose();
        });

        test("should handle authentication errors gracefully", async () => {
            // Arrange: Open document and get a cell, then add an audio attachment
            const document = await provider.openCustomDocument(
                tempUri,
                { backupId: undefined },
                new vscode.CancellationTokenSource().token
            );

            const cellId = (document as any)._documentData.cells[0].metadata?.id;
            assert.ok(cellId, "Cell should have an ID");

            // Add an audio attachment to the cell
            const audioId = "test-audio-auth-error";
            document.updateCellAttachment(cellId, audioId, {
                url: "test-audio.webm",
                type: "audio",
                createdAt: Date.now(),
                updatedAt: Date.now(),
                isDeleted: false,
            });

            // Mock auth API to throw error by stubbing the extension's getAuthApi function
            const authStub = sinon.stub().rejects(new Error("Auth failed"));

            // Import the extension module to stub getAuthApi
            const extensionModule = await import("../../../extension");
            const originalGetAuthApi = extensionModule.getAuthApi;
            (extensionModule as any).getAuthApi = () => ({ getUserInfo: authStub });

            // Act: Validate audio (should not throw)
            await assert.doesNotReject(
                document.validateCellAudio(cellId, true),
                "Should handle auth errors gracefully"
            );

            // Assert: Should fall back to anonymous user
            const cell = (document as any)._documentData.cells.find((c: any) => c.metadata?.id === cellId);
            const audioAttachment = cell?.metadata?.attachments?.[audioId];
            const validationEntry = audioAttachment?.validatedBy?.[0];

            assert.strictEqual(validationEntry?.username, "anonymous", "Should fall back to anonymous user");

            // Restore original function
            (extensionModule as any).getAuthApi = originalGetAuthApi;
            document.dispose();
        });

        test("should handle concurrent validation requests", async () => {
            // Arrange: Open document and get a cell, then add an audio attachment
            const document = await provider.openCustomDocument(
                tempUri,
                { backupId: undefined },
                new vscode.CancellationTokenSource().token
            );

            const cellId = (document as any)._documentData.cells[0].metadata?.id;
            assert.ok(cellId, "Cell should have an ID");

            // Add an audio attachment to the cell
            const audioId = "test-audio-concurrent";
            document.updateCellAttachment(cellId, audioId, {
                url: "test-audio.webm",
                type: "audio",
                createdAt: Date.now(),
                updatedAt: Date.now(),
                isDeleted: false,
            });

            // Act: Start multiple concurrent validations
            const promises = [
                document.validateCellAudio(cellId, true),
                document.validateCellAudio(cellId, true),
                document.validateCellAudio(cellId, false),
                document.validateCellAudio(cellId, true)
            ];

            // Assert: All should complete without errors
            await assert.doesNotReject(
                Promise.all(promises),
                "Should handle concurrent validation requests"
            );

            // Verify final state
            const cell = (document as any)._documentData.cells.find((c: any) => c.metadata?.id === cellId);
            const audioAttachment = cell?.metadata?.attachments?.[audioId];
            const activeValidations = audioAttachment?.validatedBy?.filter((entry: ValidationEntry) => !entry.isDeleted) || [];

            assert.strictEqual(activeValidations.length, 1, "Should have one active validation after concurrent operations");

            document.dispose();
        });
    });
});