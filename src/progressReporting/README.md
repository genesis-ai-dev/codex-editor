# Background Service for Non-blocking Operations

## Overview

This directory contains background services for handling both **progress reporting** and **sync operations** in a non-blocking way. The services were created to solve performance issues where:

- Progress report generation was taking ~4 seconds and blocking the UI
- Sync operations were taking ~3+ seconds and blocking workspace startup

## Architecture

### Before (Blocking)

```
Workspace Startup -> Sync Operation -> [3+ seconds blocking] -> Progress Report -> [4 seconds blocking] -> UI Ready
                                                                Total: ~7+ seconds of UI blocking
```

### After (Non-blocking)

```
Workspace Startup -> "Checking files are up to date..." -> [UI immediately ready]
                   |
                   Background: Sync Operation -> Progress Report -> Completion notifications
```

## Key Components

### `ProgressReportingService`

- **Singleton service** that runs in the background
- **Non-blocking scheduling** of progress reports
- **Batched processing** every 30 seconds to avoid overwhelming the system
- **Smart deduplication** to avoid generating reports too frequently (24-hour interval)

### `SyncManager` (Updated)

- **Non-blocking sync operations** that run in the background
- **Immediate user feedback** with "Checking files are up to date..." message
- **Completion notifications** when background operations finish
- **Error handling** that doesn't block the UI

## Benefits

1. **Performance**: UI startup is no longer blocked by sync or progress reporting (saves ~7+ seconds)
2. **Responsiveness**: Users can start working immediately while operations run in background
3. **User Experience**: Clear feedback about what's happening without waiting
4. **Resource efficiency**: Operations are processed asynchronously without blocking the main thread
5. **Reliability**: Background operation failures don't prevent users from working

## User Experience

### During Startup

1. Extension activates immediately
2. User sees "Checking files are up to date..." message
3. UI is fully responsive - user can start working
4. Background sync and progress reporting happen silently
5. Success/failure notifications appear when complete

### During Manual Sync

1. User triggers sync command
2. Immediate "Checking files are up to date..." feedback
3. User can continue working while sync happens
4. "Files synchronized successfully (XXXms)" notification when done

## Usage

### Automatic Usage

The service starts automatically when the extension activates and schedules reports during sync operations:

```typescript
// In SyncManager.executeSync()
const progressReportingService = ProgressReportingService.getInstance();
progressReportingService.scheduleProgressReport(); // Non-blocking!
```

### Manual Usage

Force immediate report generation (useful for testing):

```typescript
const service = ProgressReportingService.getInstance();
const success = await service.forceProgressReport();
```

### VS Code Commands

- `codex-editor-extension.submitProgressReport` - Force submit a progress report

## Implementation Details

### Background Processing

- Reports are queued and processed one at a time every 30 seconds
- Only generates reports if none have been created in the last 24 hours
- Gracefully handles errors without affecting other operations

### Data Collection

The service collects the same data as before but asynchronously:

- Translation progress from `.codex` files
- Project metadata from `metadata.json`
- GitLab project verification
- Book completion percentages
- Validation stages and metrics

### Error Handling

- Network failures don't block sync operations
- Invalid project configurations are logged but don't crash the service
- Malformed `.codex` files fall back to estimation

## Testing

A basic test suite is included in `progressReportingService.test.ts`:

```typescript
import { testProgressReportingService } from "./progressReportingService.test";
testProgressReportingService();
```

## Migration Notes

This change removes the following from `SyncManager`:

- `generateAndSubmitProgressReport()` method
- `generateProgressReport()` method
- `lastProgressReport` and `lastReportTime` private fields
- Blocking `await progressReportPromise` in `executeSync()`

The `forceProgressReport()` method now delegates to the background service.

## Performance Impact

- **UI startup time**: Reduced by ~4 seconds
- **Sync operation time**: No longer includes progress reporting overhead
- **Memory usage**: Minimal - one additional singleton service
- **CPU usage**: Distributed over time rather than blocking during startup
