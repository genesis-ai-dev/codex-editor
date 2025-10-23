# Validation Queue System

## Overview

The validation queue system ensures that validation requests are processed sequentially, preventing race conditions when users click validation buttons rapidly.

## Problem Solved

Previously, rapid clicking on validation buttons could cause:

-   Lost validation requests
-   Inconsistent UI state
-   Race conditions between validation requests

## Solution

### Client-Side Queue (`validationQueue.ts`)

-   **Global Queue**: All validation requests are added to a single global queue
-   **Sequential Processing**: Requests are processed one at a time in order
-   **Promise-Based**: Each validation request returns a Promise for proper async handling

### Key Components

1. **`enqueueValidation(cellId, validate)`**: Adds a validation request to the queue
2. **`processValidationQueue(vscode)`**: Processes all queued requests sequentially
3. **Queue State**: Tracks processing state to prevent concurrent processing

### Usage in ValidationButton

```typescript
// When user clicks validate button
const handleValidate = (e: React.MouseEvent) => {
    // Set pending state immediately
    setIsPendingValidation(true);

    // Add to queue
    enqueueValidation(cellId, !isValidated);

    // Process queue
    processValidationQueue(vscode);
};
```

## Benefits

1. **No Lost Requests**: All validation clicks are preserved and processed
2. **Sequential Processing**: Requests are handled in the order they were made
3. **Consistent UI State**: UI updates reflect the actual validation state
4. **Race Condition Prevention**: Only one validation processes at a time

## Testing

The system includes tests to verify:

-   Sequential processing of multiple requests
-   Handling of rapid consecutive clicks
-   Proper message ordering to the provider
