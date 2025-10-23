### Validation flow (text and audio)

This document explains the end-to-end flow when a user validates text (and audio) in the Codex Cell Editor, from the webview UI through the extension provider and back to the webview.

---

## Overview

- **User action**: Click validate icon on a cell (text or audio).
- **Webview**: Enqueues the request and posts `validateCell` or `validateAudioCell` to the extension.
- **Provider**: Queues and processes the request, updates the document via `validateCellContent` or `validateCellAudio`.
- **Document**: Mutates the appropriate `validatedBy` array and emits a change event.
- **Provider → Webview**: Broadcasts `validationInProgress`, then updated state via `providerUpdatesValidationState` / `providerUpdatesAudioValidationState`, and clears pending states.
- **Webview**: Updates UI state (icons, counts, pending state) based on provider messages.

---

## Webview: triggering validation

- UI components:
    - `webviews/codex-webviews/src/CodexCellEditor/ValidationButton.tsx` (text)
    - `webviews/codex-webviews/src/CodexCellEditor/AudioValidationButton.tsx` (audio)
- On click:
    - Calls `enqueueValidation(cellId, validate, isAudio?)` and then `processValidationQueue(vscode, isAudio?)` from `validationQueue.ts`.
    - Sets local pending state to show the orange ring while awaiting provider processing.
- Queue behavior (`validationQueue.ts`):
    - Ensures sequential processing across all validations.
    - Posts to the extension:
        - Text: `{ command: "validateCell", content: { cellId, validate } }`
        - Audio: `{ command: "validateAudioCell", content: { cellId, validate } }`

Message handling in the webview uses `useCentralizedMessageDispatcher` to avoid multiple global listeners. Validation components subscribe and react to these message types:

- `validationInProgress` (toggle spinner/disable while true)
- `providerUpdatesValidationState` (text) / `providerUpdatesAudioValidationState` (audio)
- `pendingValidationCleared` (clear pending UI after batches)
- `validationCount` / `validationCountAudio` (when requested or on configuration change)
- `currentUsername` (when needed)

---

## Extension provider: routing and processing

- The initial `postMessage` commands are handled in `src/providers/codexCellEditorProvider/codexCellEditorMessagehandling.ts`:
    - `validateCell` → `provider.enqueueValidation(cellId, document, validate)`
    - `validateAudioCell` → `provider.enqueueAudioValidation(cellId, document, validate)`

- Processing happens inside `src/providers/codexCellEditorProvider/codexCellEditorProvider.ts`:
    - For each validation request, the provider:
        1. Broadcasts `{ type: "validationInProgress", content: { cellId, inProgress: true } }` (or `audioValidationInProgress` for audio where applicable).
        2. Calls document methods:
            - Text: `document.validateCellContent(cellId, shouldValidate)`
            - Audio: `document.validateCellAudio(cellId, shouldValidate)`
        3. Broadcasts `{ type: "validationInProgress", content: { cellId, inProgress: false } }`.
        4. Broadcasts the updated validation state:
            - Text: `{ type: "providerUpdatesValidationState", content: { cellId, validatedBy } }`
            - Audio: `{ type: "providerUpdatesAudioValidationState", content: { cellId, validatedBy } }`

- Batch flows and clearing pending state:
    - When multiple validations are processed and applied together, the provider will:
        - Send `validationInProgress` per cell during the apply.
        - After applying, send `providerUpdatesValidationState` / `providerUpdatesAudioValidationState`.
        - Finally broadcast `{ type: "pendingValidationCleared", content: { cellIds: [...] } }` and `{ type: "validationsApplied" }`.

---

## Document updates: writing `validatedBy`

Implemented in `src/providers/codexCellEditorProvider/codexDocument.ts`:

- Text validation: `validateCellContent(cellId, validate)`
    - Locates the cell and identifies the correct "value" edit that matches the current cell value. If absent, creates a `USER_EDIT` matching the current value to anchor validation.
    - Ensures `latestEdit.validatedBy` exists, resolves the current username via `getAuthApi().getUserInfo()`, and adds/updates a `ValidationEntry` for the user, toggling `isDeleted` for unvalidate.
    - Marks document dirty and emits a change event with `{ edits: [{ cellId, type: "validation", validatedBy }] }`.

- Audio validation: `validateCellAudio(cellId, validate)`
    - Finds the current audio attachment (based on selection/metadata), ensures `attachment.validatedBy` exists, and adds/updates the user's `ValidationEntry` similarly.
    - Marks document dirty and emits a change event for provider broadcast.

The provider listens to these change events to broadcast `providerUpdatesValidationState` / `providerUpdatesAudioValidationState` so the webview reflects the latest `validatedBy` arrays.

---

## Webview: reacting to provider updates

Both text and audio buttons maintain internal state:

- `isValidationInProgress` toggled by `validationInProgress` messages.
- `isPendingValidation` cleared by `validationInProgress: false` and `pendingValidationCleared`.
- `isValidated` and validator lists updated from `providerUpdatesValidationState` / `providerUpdatesAudioValidationState`.
- Validation buttons are disabled for source text, while in progress, or when externally restricted.

---

## Message types (wire protocol)

Commands (webview → provider):

- `validateCell`: `{ cellId: string, validate: boolean }`
- `validateAudioCell`: `{ cellId: string, validate: boolean }`
- `getValidationCount`, `getValidationCountAudio` (when parent hasn’t provided counts)

Notifications (provider → webview):

- `validationInProgress`: `{ cellId: string, inProgress: boolean, error? }`
- `providerUpdatesValidationState`: `{ cellId: string, validatedBy: ValidationEntry[] }`
- `providerUpdatesAudioValidationState`: `{ cellId: string, validatedBy: ValidationEntry[] }`
- `pendingValidationCleared`: `{ cellIds: string[] }`
- `validationsApplied`: `{}`
- `validationCount`, `validationCountAudio`, `currentUsername`, `configurationChanged`

Note: When adding or changing message shapes, update `types/index.d.ts` per workspace rules.

---

## Edge cases and guarantees

- **Sequential processing**: Webview queue enforces one-at-a-time posting to avoid rapid toggles or race conditions.
- **Correct edit anchoring (text)**: Validation targets the value edit matching the cell’s current value; metadata-only edits are not validated.
- **User identity**: Fetched at validation time; falls back to `"anonymous"` if auth is unavailable.
- **Batch apply**: Provider may apply multiple validations before saving, then notifies the webview to clear pending states.
- **Audio selection**: Audio validation uses the currently selected audio attachment for the cell.

---

## Key files

- Webview UI and messaging
    - `webviews/codex-webviews/src/CodexCellEditor/ValidationButton.tsx`
    - `webviews/codex-webviews/src/CodexCellEditor/AudioValidationButton.tsx`
    - `webviews/codex-webviews/src/CodexCellEditor/validationQueue.ts`
    - `webviews/codex-webviews/src/CodexCellEditor/hooks/useCentralizedMessageDispatcher.ts`

- Provider routing and processing
    - `src/providers/codexCellEditorProvider/codexCellEditorMessagehandling.ts`
    - `src/providers/codexCellEditorProvider/codexCellEditorProvider.ts`

- Document mutation
    - `src/providers/codexCellEditorProvider/codexDocument.ts`

- Types (message contracts)
    - `types/index.d.ts`

---

## Testing references

- `src/test/suite/codexCellEditorProvider.test.ts` (text validation persistence)
- `src/test/suite/validation/audioValidation.test.ts` and `audioValidationDatabase.test.ts`
- `src/test/suite/validation/validationQueue.test.ts` (queue behavior and command posting)
