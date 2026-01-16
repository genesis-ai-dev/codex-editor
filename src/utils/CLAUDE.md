# Utilities

50+ utility modules. Key ones below.

## LLM/AI

- `llmUtils.ts` - LLM config, API calls
- `../providers/translationSuggestions/llmCompletion.ts` - Translation suggestions

```typescript
import { fetchCompletionConfig } from "@/utils/llmUtils";
const config = await fetchCompletionConfig();
```

## Notebook Operations

- `codexNotebookUtils.ts` - .codex file operations
- `notebookMetadataManager.ts` - Metadata handling

## Audio

- `audioProcessor.ts` - FFmpeg processing
- `audioMerger.ts` - Audio file merging
- `audioAttachmentsMigrationUtils.ts` - Audio migration

## Data Migration

- `commentsMigrationUtils.ts` - Comment format migration
- See also `projectManager/utils/migrationUtils.ts`

## Webview Helpers

- `webviewUtils.ts` - Safe postMessage, HTML generation
- `vscode.ts` - VS Code API helpers

```typescript
import { safePostMessageToPanel } from "@/utils/webviewUtils";
safePostMessageToPanel(panel, { command: "update", data });
```

## Common Patterns

### Path Alias
```typescript
import { something } from "@/utils/something";  // src/utils/something
```

### Async Configuration
```typescript
const config = vscode.workspace.getConfiguration("codex-editor-extension");
const value = config.get<string>("settingName", "default");
```

### Extension State
```typescript
context.globalState.get("key");     // Global across workspaces
context.workspaceState.get("key");  // Workspace-specific
```
