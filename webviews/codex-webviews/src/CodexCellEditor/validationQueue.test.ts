import { describe, it, expect, beforeEach, vi } from 'vitest';
import { enqueueValidation, processValidationQueue, clearValidationQueue } from './validationQueue';

// Mock vscode API
const mockVscode = {
    postMessage: vi.fn()
};

describe('ValidationQueue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Clear any existing queue items
        clearValidationQueue();
    });

    it('should queue validation requests sequentially', async () => {
        const cell1Promise = enqueueValidation('cell-1', true);
        const cell2Promise = enqueueValidation('cell-2', false);
        const cell3Promise = enqueueValidation('cell-3', true);

        // Process the queue
        await processValidationQueue(mockVscode);

        // Verify all messages were sent in order
        expect(mockVscode.postMessage).toHaveBeenCalledTimes(3);
        expect(mockVscode.postMessage).toHaveBeenNthCalledWith(1, {
            command: "validateCell",
            content: {
                cellId: "cell-1",
                validate: true,
            },
        });
        expect(mockVscode.postMessage).toHaveBeenNthCalledWith(2, {
            command: "validateCell",
            content: {
                cellId: "cell-2",
                validate: false,
            },
        });
        expect(mockVscode.postMessage).toHaveBeenNthCalledWith(3, {
            command: "validateCell",
            content: {
                cellId: "cell-3",
                validate: true,
            },
        });

        // Wait for all promises to resolve
        await Promise.all([cell1Promise, cell2Promise, cell3Promise]);
    });

    it('should handle rapid consecutive clicks without losing requests', async () => {
        // Simulate rapid clicking by enqueueing multiple requests quickly
        const promises = [];
        for (let i = 0; i < 10; i++) {
            promises.push(enqueueValidation(`cell-${i}`, i % 2 === 0));
        }

        // Process the queue
        await processValidationQueue(mockVscode);

        // Verify all 10 messages were sent
        expect(mockVscode.postMessage).toHaveBeenCalledTimes(10);

        // Wait for all promises to resolve
        await Promise.all(promises);
    });
});
