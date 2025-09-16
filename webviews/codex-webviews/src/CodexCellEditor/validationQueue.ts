// Validation queue item interface
export interface ValidationQueueItem {
    cellId: string;
    validate: boolean;
    timestamp: number;
    resolve: () => void;
    reject: (error: any) => void;
}

// Global validation queue to ensure sequential processing across all validation buttons
const validationQueue: ValidationQueueItem[] = [];
let isProcessingQueue = false;

// Process validation queue sequentially
export const processValidationQueue = async (vscode: any) => {
    if (isProcessingQueue || validationQueue.length === 0) {
        return;
    }

    isProcessingQueue = true;

    while (validationQueue.length > 0) {
        const item = validationQueue.shift();
        if (!item) continue;

        try {
            // Send validation request to provider
            vscode.postMessage({
                command: "validateCell",
                content: {
                    cellId: item.cellId,
                    validate: item.validate,
                },
            });

            // Wait for a short delay to allow the provider to process
            await new Promise(resolve => setTimeout(resolve, 100));

            item.resolve();
        } catch (error) {
            item.reject(error);
        }
    }

    isProcessingQueue = false;
};

// Add validation request to queue
export const enqueueValidation = (cellId: string, validate: boolean): Promise<void> => {
    return new Promise((resolve, reject) => {
        validationQueue.push({
            cellId,
            validate,
            timestamp: Date.now(),
            resolve,
            reject,
        });
    });
};

// Clear the validation queue (useful for testing)
export const clearValidationQueue = (): void => {
    // Reject all pending promises
    validationQueue.forEach(item => {
        item.reject(new Error('Queue cleared'));
    });
    validationQueue.length = 0;
    isProcessingQueue = false;
};
