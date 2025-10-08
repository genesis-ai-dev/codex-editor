import * as assert from "assert";
import sinon from "sinon";
import { processValidationQueue, enqueueValidation, clearValidationQueue } from "../../../../webviews/codex-webviews/src/CodexCellEditor/validationQueue";
import { isValidValidationEntry } from "../../../../webviews/codex-webviews/src/CodexCellEditor/validationUtils";
import { ValidationEntry } from "../../../../types";

suite("Validation Queue Test Suite", () => {
    let mockVscode: any;

    setup(() => {
        // Mock vscode object with postMessage
        mockVscode = {
            postMessage: sinon.stub()
        };
    });

    teardown(() => {
        // Clear the queue after each test
        clearValidationQueue();
        sinon.restore();
    });

    suite("enqueueValidation", () => {
        test("should add validation request to queue", async () => {
            // Arrange
            const cellId = "test-cell-1";
            const validate = true;
            const isAudioValidation = true;

            // Act
            const promise = enqueueValidation(cellId, validate, isAudioValidation);

            // Assert
            assert.ok(promise instanceof Promise, "Should return a Promise");

            // Process the queue to resolve the promise
            await processValidationQueue(mockVscode, isAudioValidation);
            await promise; // Should not throw
        });

        test("should handle text validation requests", async () => {
            // Arrange
            const cellId = "test-cell-2";
            const validate = true;
            const isAudioValidation = false;

            // Act
            const promise = enqueueValidation(cellId, validate, isAudioValidation);
            await processValidationQueue(mockVscode, isAudioValidation);
            await promise;

            // Assert
            assert.ok(mockVscode.postMessage.called, "Should have called postMessage");
            const call = mockVscode.postMessage.getCall(0);
            assert.strictEqual(call.args[0].command, "validateCell", "Should use text validation command");
            assert.strictEqual(call.args[0].content.cellId, cellId, "Should include correct cell ID");
            assert.strictEqual(call.args[0].content.validate, validate, "Should include correct validate flag");
        });

        test("should handle audio validation requests", async () => {
            // Arrange
            const cellId = "test-cell-3";
            const validate = true;
            const isAudioValidation = true;

            // Act
            const promise = enqueueValidation(cellId, validate, isAudioValidation);
            await processValidationQueue(mockVscode, isAudioValidation);
            await promise;

            // Assert
            assert.ok(mockVscode.postMessage.called, "Should have called postMessage");
            const call = mockVscode.postMessage.getCall(0);
            assert.strictEqual(call.args[0].command, "validateAudioCell", "Should use audio validation command");
            assert.strictEqual(call.args[0].content.cellId, cellId, "Should include correct cell ID");
            assert.strictEqual(call.args[0].content.validate, validate, "Should include correct validate flag");
        });

        test("should handle unvalidation requests", async () => {
            // Arrange
            const cellId = "test-cell-4";
            const validate = false;
            const isAudioValidation = true;

            // Act
            const promise = enqueueValidation(cellId, validate, isAudioValidation);
            await processValidationQueue(mockVscode, isAudioValidation);
            await promise;

            // Assert
            assert.ok(mockVscode.postMessage.called, "Should have called postMessage");
            const call = mockVscode.postMessage.getCall(0);
            assert.strictEqual(call.args[0].content.validate, false, "Should include correct validate flag");
        });
    });

    suite("processValidationQueue", () => {
        test("should process multiple validation requests sequentially", async () => {
            // Arrange
            const cellIds = ["cell-1", "cell-2", "cell-3"];
            const promises = cellIds.map(cellId =>
                enqueueValidation(cellId, true, true)
            );

            // Act
            await processValidationQueue(mockVscode, true);
            await Promise.all(promises);

            // Assert
            assert.strictEqual(mockVscode.postMessage.callCount, 3, "Should have processed 3 requests");

            const calls = mockVscode.postMessage.getCalls();
            calls.forEach((call: any, index: number) => {
                assert.strictEqual(call.args[0].content.cellId, cellIds[index], `Should process cell ${index + 1} in order`);
            });
        });

        test("should not process queue when already processing", async () => {
            // Arrange
            const cellId = "test-cell-5";
            enqueueValidation(cellId, true, true);

            // Act: Start processing
            const processPromise1 = processValidationQueue(mockVscode, true);
            const processPromise2 = processValidationQueue(mockVscode, true); // Second call should be ignored

            await processPromise1;
            await processPromise2;

            // Assert: Should only process once
            assert.strictEqual(mockVscode.postMessage.callCount, 1, "Should only process once");
        });

        test("should handle empty queue gracefully", async () => {
            // Act & Assert: Should not throw
            await assert.doesNotReject(
                processValidationQueue(mockVscode, true),
                "Should handle empty queue gracefully"
            );

            assert.strictEqual(mockVscode.postMessage.callCount, 0, "Should not call postMessage for empty queue");
        });

        test("should handle postMessage errors gracefully", async () => {
            // Arrange
            const cellId = "test-cell-6";
            mockVscode.postMessage.throws(new Error("PostMessage failed"));

            const promise = enqueueValidation(cellId, true, true);

            // Act & Assert: Should handle error and reject promise
            await processValidationQueue(mockVscode, true);
            await assert.rejects(promise, "Should reject promise on postMessage error");
        });
    });

    suite("clearValidationQueue", () => {
        test("should clear all pending validation requests", async () => {
            // Arrange
            const cellIds = ["cell-1", "cell-2", "cell-3"];
            const promises = cellIds.map(cellId =>
                enqueueValidation(cellId, true, true)
            );

            // Act
            clearValidationQueue();

            // Assert: All promises should be rejected
            for (const promise of promises) {
                await assert.rejects(promise, "Should reject cleared validation requests");
            }
        });

        test("should reset processing state", async () => {
            // Arrange
            const cellId = "test-cell-7";
            enqueueValidation(cellId, true, true);

            // Act
            clearValidationQueue();

            // Assert: Should be able to process new requests
            const newCellId = "test-cell-8";
            const newPromise = enqueueValidation(newCellId, true, true);

            await processValidationQueue(mockVscode, true);
            await newPromise; // Should not throw

            assert.ok(mockVscode.postMessage.called, "Should be able to process new requests after clear");
        });
    });

    suite("Validation Utils", () => {
        test("should validate ValidationEntry objects correctly", () => {
            // Arrange: Valid entry
            const validEntry: ValidationEntry = {
                username: "testuser",
                creationTimestamp: Date.now(),
                updatedTimestamp: Date.now(),
                isDeleted: false
            };

            // Act & Assert
            assert.strictEqual(isValidValidationEntry(validEntry), true, "Should validate correct ValidationEntry");

            // Test invalid entries
            assert.strictEqual(isValidValidationEntry(null), false, "Should reject null");
            assert.strictEqual(isValidValidationEntry(undefined), false, "Should reject undefined");
            assert.strictEqual(isValidValidationEntry("string"), false, "Should reject string");
            assert.strictEqual(isValidValidationEntry({}), false, "Should reject empty object");

            // Test missing properties
            assert.strictEqual(isValidValidationEntry({
                username: "test",
                creationTimestamp: Date.now(),
                updatedTimestamp: Date.now()
                // missing isDeleted
            }), false, "Should reject entry missing isDeleted");

            assert.strictEqual(isValidValidationEntry({
                username: "test",
                creationTimestamp: Date.now(),
                isDeleted: false
                // missing updatedTimestamp
            }), false, "Should reject entry missing updatedTimestamp");

            assert.strictEqual(isValidValidationEntry({
                creationTimestamp: Date.now(),
                updatedTimestamp: Date.now(),
                isDeleted: false
                // missing username
            }), false, "Should reject entry missing username");

            // Test wrong types
            assert.strictEqual(isValidValidationEntry({
                username: 123, // should be string
                creationTimestamp: Date.now(),
                updatedTimestamp: Date.now(),
                isDeleted: false
            }), false, "Should reject entry with non-string username");

            assert.strictEqual(isValidValidationEntry({
                username: "test",
                creationTimestamp: "not-a-number", // should be number
                updatedTimestamp: Date.now(),
                isDeleted: false
            }), false, "Should reject entry with non-numeric creationTimestamp");

            assert.strictEqual(isValidValidationEntry({
                username: "test",
                creationTimestamp: Date.now(),
                updatedTimestamp: Date.now(),
                isDeleted: "not-a-boolean" // should be boolean
            }), false, "Should reject entry with non-boolean isDeleted");
        });

        test("should handle edge cases in validation", () => {
            // Test with zero timestamps
            const entryWithZeroTimestamps: ValidationEntry = {
                username: "testuser",
                creationTimestamp: 0,
                updatedTimestamp: 0,
                isDeleted: false
            };
            assert.strictEqual(isValidValidationEntry(entryWithZeroTimestamps), true, "Should accept zero timestamps");

            // Test with negative timestamps
            const entryWithNegativeTimestamps: ValidationEntry = {
                username: "testuser",
                creationTimestamp: -1,
                updatedTimestamp: -1,
                isDeleted: false
            };
            assert.strictEqual(isValidValidationEntry(entryWithNegativeTimestamps), true, "Should accept negative timestamps");

            // Test with empty username
            const entryWithEmptyUsername: ValidationEntry = {
                username: "",
                creationTimestamp: Date.now(),
                updatedTimestamp: Date.now(),
                isDeleted: false
            };
            assert.strictEqual(isValidValidationEntry(entryWithEmptyUsername), true, "Should accept empty username");

            // Test with very long username
            const entryWithLongUsername: ValidationEntry = {
                username: "a".repeat(1000),
                creationTimestamp: Date.now(),
                updatedTimestamp: Date.now(),
                isDeleted: false
            };
            assert.strictEqual(isValidValidationEntry(entryWithLongUsername), true, "Should accept long username");
        });
    });

    suite("Integration Tests", () => {
        test("should handle mixed validation types in queue", async () => {
            // Arrange
            const requests = [
                { cellId: "cell-1", validate: true, isAudio: true },
                { cellId: "cell-2", validate: false, isAudio: false },
                { cellId: "cell-3", validate: true, isAudio: true },
                { cellId: "cell-4", validate: true, isAudio: false }
            ];

            // Act
            const promises = requests.map(req =>
                enqueueValidation(req.cellId, req.validate, req.isAudio)
            );

            // Process each type separately
            await processValidationQueue(mockVscode, true); // Process audio validations
            await processValidationQueue(mockVscode, false); // Process text validations

            await Promise.all(promises);

            // Assert
            assert.strictEqual(mockVscode.postMessage.callCount, 4, "Should have processed all requests");

            const calls = mockVscode.postMessage.getCalls();
            const audioCalls = calls.filter((call: any) => call.args[0].command === "validateAudioCell");
            const textCalls = calls.filter((call: any) => call.args[0].command === "validateCell");

            assert.strictEqual(audioCalls.length, 2, "Should have 2 audio validation calls");
            assert.strictEqual(textCalls.length, 2, "Should have 2 text validation calls");
        });

        test("should maintain order of validation requests", async () => {
            // Arrange
            const cellIds = ["cell-1", "cell-2", "cell-3", "cell-4", "cell-5"];
            const promises = cellIds.map(cellId =>
                enqueueValidation(cellId, true, true)
            );

            // Act
            await processValidationQueue(mockVscode, true);
            await Promise.all(promises);

            // Assert: Should maintain FIFO order
            const calls = mockVscode.postMessage.getCalls();
            calls.forEach((call: any, index: number) => {
                assert.strictEqual(call.args[0].content.cellId, cellIds[index], `Should maintain order for call ${index}`);
            });
        });
    });
});
