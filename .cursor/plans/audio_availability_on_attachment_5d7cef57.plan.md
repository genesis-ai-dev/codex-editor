---
name: Audio availability on attachment
overview: Replace filesystem stat calls at read time with a persisted `audioAvailability` field on each attachment, set at write time. This eliminates all I/O from availability checks, making them pure metadata reads.
todos:
    - id: types
      content: Add AttachmentAvailability type and audioAvailability field to types/index.d.ts
      status: completed
    - id: availability-read
      content: Simplify checkAttachmentAvailability to pure metadata read, extract filesystem logic to determineAttachmentAvailability
      status: completed
    - id: availability-write
      content: "Update audioMissingUtils.ts: rename setter, update revalidation to set full state"
      status: completed
    - id: migration
      content: Update audioAttachmentsMigrationUtils.ts to convert isMissing to audioAvailability
      status: completed
    - id: recording-handler
      content: "Set audioAvailability: available-local in saveAudioAttachment, merge, and stream-and-save handlers"
      status: completed
    - id: document-model
      content: "Update codexDocument.ts: parameter type, getCurrentAttachment, auto-selection logic"
      status: completed
    - id: shared-utils
      content: Update cellHasMissingAudio and cellHasAudioUsingAttachments in sharedUtils
      status: completed
    - id: webview-code
      content: Update deriveAudioAvailability in useVSCodeMessageHandler.ts and AudioHistoryViewer.tsx
      status: completed
    - id: importers
      content: "Add audioAvailability: available-local to all import form attachment constructors"
      status: completed
    - id: merge-export
      content: Update resolvers.ts isValidSelection and audioExporter.ts filter
      status: completed
    - id: tests
      content: Update all test fixtures and assertions for the new field
      status: completed
isProject: false
---

# Replace Filesystem Checks with Persisted `audioAvailability` Field

## Context

Currently, `checkAttachmentAvailability()` in `[src/utils/audioAvailabilityUtils.ts](src/utils/audioAvailabilityUtils.ts)` does filesystem `stat` calls and LFS pointer detection **every time** availability is queried. This happens at document open, after recording, after sync, and in the navigation sidebar — often looping over every cell in a chapter.

The `isMissing: boolean` field already exists but only captures 2 of 3 states. We will introduce `audioAvailability: "available-local" | "available-pointer" | "missing"` on each attachment and make all read-time checks pure metadata lookups.

## New Type

Define a new type `AttachmentAvailability` and add the field to all attachment shapes:

```typescript
type AttachmentAvailability = "available-local" | "available-pointer" | "missing";
```

This is the **attachment-level** state. The existing cell-level `AudioAvailabilityState` (which adds `"none"` and `"deletedOnly"`) remains as a rollup derived from individual attachments.

## Files to Change

### 1. Types — `[types/index.d.ts](types/index.d.ts)`

- Export `AttachmentAvailability` type
- Add `audioAvailability?: AttachmentAvailability` to all 3 attachment shapes (lines ~950, ~1145, ~2431)
- Keep `isMissing?: boolean` temporarily (marked deprecated) for backward compat during migration window

### 2. Core availability functions — `[src/utils/audioAvailabilityUtils.ts](src/utils/audioAvailabilityUtils.ts)`

- `checkAttachmentAvailability` becomes a **pure metadata read**: reads `audioAvailability` field, falls back to `isMissing` for legacy data, returns the state without any filesystem I/O
- `computeCellAudioState` stays structurally the same but now calls the simplified `checkAttachmentAvailability`
- `isSelectedAudioMissing` simplifies to a direct field read
- `applyFrontierVersionGate` unchanged (operates on the state enum, not filesystem)
- Update `AttachmentLike` interface to include `audioAvailability?`
- **New export**: `determineAttachmentAvailability(workspaceFolder, attachmentUrl)` — the extracted filesystem logic (stat + LFS detection) for use at write time

### 3. Write-time availability setter — `[src/utils/audioMissingUtils.ts](src/utils/audioMissingUtils.ts)`

- Rename `setMissingFlagOnAttachmentObject` to `setAttachmentAvailability` — sets `audioAvailability` (and deprecated `isMissing` for compat), bumps `updatedAt`
- Update `revalidateCellMissingFlags` to call `determineAttachmentAvailability` and set the full state
- Update `attachmentPointerExists` / `ensurePointerFromFiles` as needed

### 4. Migration — `[src/utils/audioAttachmentsMigrationUtils.ts](src/utils/audioAttachmentsMigrationUtils.ts)`

- `updateMissingFlagsForCodexDocuments`: set `audioAvailability` based on filesystem check (same logic as today, but writes the richer field)
- Convert legacy `isMissing` to `audioAvailability` for old documents

### 5. Recording handler — `[src/providers/codexCellEditorProvider/codexCellEditorMessagehandling.ts](src/providers/codexCellEditorProvider/codexCellEditorMessagehandling.ts)`

- `saveAudioAttachment` (~line 2251): add `audioAvailability: "available-local"` to the attachment object (file is written to both `files/` and `pointers/`)
- `updateCellAfterTranscription` (~line 441): preserve existing `audioAvailability` from the current attachment
- Cell merge handler (~line 3014): set `audioAvailability: "available-local"` on merged attachment
- Stream-and-save paths (~lines 1878, 2000): after writing file to disk, also update the attachment's `audioAvailability` to `"available-local"` in the document (not just via webview message)

### 6. Document model — `[src/providers/codexCellEditorProvider/codexDocument.ts](src/providers/codexCellEditorProvider/codexDocument.ts)`

- Update `updateCellAttachment` parameter type to include `audioAvailability?`
- Update `getCurrentAttachment` logic: replace `!att.isMissing` checks with `att.audioAvailability !== "missing"`
- Update auto-selection fallback logic (~line 3224): use `audioAvailability` instead of `isMissing`

### 7. Provider — `[src/providers/codexCellEditorProvider/codexCellEditorProvider.ts](src/providers/codexCellEditorProvider/codexCellEditorProvider.ts)`

- All `computeCellAudioStateWithVersionGate` call sites remain, but they become much faster (no filesystem I/O underneath)
- No structural changes needed

### 8. Navigation sidebar — `[src/providers/navigationWebview/navigationWebviewProvider.ts](src/providers/navigationWebview/navigationWebviewProvider.ts)`

- `isSelectedAudioMissing` call site benefits automatically from the simplified implementation

### 9. Shared utils — `[sharedUtils/index.ts](sharedUtils/index.ts)`

- `cellHasMissingAudio`: replace `att.isMissing === true` with `att.audioAvailability === "missing"`
- `cellHasAudioUsingAttachments`: replace `att.isMissing !== true` with `att.audioAvailability !== "missing"`

### 10. Webview code

- `[useVSCodeMessageHandler.ts](webviews/codex-webviews/src/CodexCellEditor/hooks/useVSCodeMessageHandler.ts)`: update `deriveAudioAvailability` to read `audioAvailability` instead of `isMissing`
- `[AudioHistoryViewer.tsx](webviews/codex-webviews/src/CodexCellEditor/AudioHistoryViewer.tsx)`: update local type and `isMissing` references

### 11. Import forms (set `audioAvailability: "available-local"` on new attachments)

- `[cellMetadata.ts](webviews/codex-webviews/src/NewSourceUploader/importers/audio/cellMetadata.ts)` ~line 64
- `[AudioImporter2Form.tsx](webviews/codex-webviews/src/NewSourceUploader/importers/audio2/AudioImporter2Form.tsx)` ~line 637
- `[SpreadsheetImporterForm.tsx](webviews/codex-webviews/src/NewSourceUploader/importers/bibleSpredSheet/SpreadsheetImporterForm.tsx)` ~lines 716, 764

### 12. Merge resolver — `[src/projectManager/utils/merge/resolvers.ts](src/projectManager/utils/merge/resolvers.ts)`

- `isValidSelection` (~line 1773): replace `!attachment.isMissing` with `attachment.audioAvailability !== "missing"`
- `mergeAttachments`: ensure `audioAvailability` is preserved from the winning side

### 13. Audio exporter — `[src/exportHandler/audioExporter.ts](src/exportHandler/audioExporter.ts)`

- Replace `attVal.isMissing` filter (~line 454) with `attVal.audioAvailability === "missing"`

### 14. Tests

- `[codexCellEditorProvider.test.ts](src/test/suite/codexCellEditorProvider.test.ts)`: update attachment fixtures
- `[audioAttachmentsRestoration.test.ts](src/test/suite/audioAttachmentsRestoration.test.ts)`: update fixtures and assertions
- `[providerMergeResolve.test.ts](src/test/suite/providerMergeResolve.test.ts)`: update merge test

## Backward Compatibility

- Keep `isMissing?: boolean` on the type (deprecated) for one release cycle
- `checkAttachmentAvailability` reads `audioAvailability` first, falls back to `isMissing` if absent
- Migration converts `isMissing` to `audioAvailability` on project open
- Write-time setters write both fields during the transition

## What This Eliminates

- All `vscode.workspace.fs.stat()` calls in `checkAttachmentAvailability`
- All `isPointerFile()` calls at read time
- The `lfsHelpers` dynamic import in the read path
- N filesystem round-trips per chapter on document open, save, sync refresh, and nav sidebar progress computation
