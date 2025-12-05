# Codex Editor - Agent Guidelines

Bible translation editor VS Code extension with CRDT-based collaborative editing, AI-powered suggestions, and cloud sync.

## Quick Reference

```bash
# Build & Run
npm run compile          # Build extension
npm run watch           # Dev mode with rebuild
npm run build:webviews  # Build React webviews
npm run smart-watch     # Webview hot reload

# Test
npm run test            # Unit tests (Mocha)
npm run test:webviews   # Webview tests (Vitest)
npm run wdio            # E2E tests (WebdriverIO)

# Quality
npm run lint            # ESLint
npm run format          # Prettier
```

## Architecture

```
src/                    # Extension TypeScript (Webpack → out/)
├── extension.ts        # Entry point, activation flow
├── providers/          # All webview/editor providers
│   ├── registerProviders.ts      # Central registration hub
│   └── codexCellEditorProvider/  # Main .codex editor (largest)
├── projectManager/     # Project init, sync, migrations
├── tsServer/          # Language server (LSP)
├── utils/             # 50+ utility modules
└── test/              # Mocha tests

webviews/codex-webviews/   # React UI (Vite → dist/)
├── src/
│   ├── CodexCellEditor/   # Cell editing UI
│   ├── components/        # Shared React components
│   └── [FeatureName]/     # Feature-specific views
└── vite.config.ts

types/                 # Shared TypeScript types
package.json          # Commands, views, contributes
```

## Key Files by Task

| Task | Files |
|------|-------|
| Add command | `package.json` (contributes.commands), `src/activationHelpers/contextAware/commands.ts` |
| Add webview | `package.json` (views), `src/providers/registerProviders.ts`, new provider in `src/providers/` |
| Add sidebar view | `package.json` (viewsContainers, views), provider with `registerWebviewViewProvider` |
| Edit cell behavior | `src/providers/codexCellEditorProvider/`, `webviews/.../CodexCellEditor/` |
| LLM/Copilot | `src/providers/translationSuggestions/`, `src/utils/llmUtils.ts` |
| Project sync | `src/projectManager/syncManager.ts` |
| Language features | `src/tsServer/` |

## VS Code Extension Patterns

### Provider Registration
```typescript
// Custom editor (package.json: customEditors)
vscode.window.registerCustomEditorProvider("codex.cellEditor", provider, {
    supportsMultipleEditorsPerDocument: false,
    webviewOptions: { retainContextWhenHidden: true }
});

// Sidebar view (package.json: views, viewsContainers)
vscode.window.registerWebviewViewProvider("codex-editor.navigation", provider);
```

### Extension ↔ Webview Communication
```typescript
// Extension → Webview
webview.postMessage({ command: "updateData", data: payload });

// Webview → Extension (in React)
const vscode = acquireVsCodeApi();
vscode.postMessage({ command: "save", data: content });
window.addEventListener("message", (e) => handleMessage(e.data));
```

### package.json Registration Required
- **Commands**: `contributes.commands` + register in code
- **Views**: `contributes.views` + `contributes.viewsContainers`
- **Custom editors**: `contributes.customEditors`
- **Settings**: `contributes.configuration`
- **Menus**: `contributes.menus`

## Coding Standards

### Style (Enforced)
- 4-space indent, semicolons, double quotes
- 100 char line width
- ES5 trailing commas
- LF line endings

### Practices
- TypeScript strict where possible
- Singleton pattern for providers (`getInstance()`)
- DEBUG_MODE flags for conditional logging
- Async/await over raw promises
- Path aliases: `@/` → `src/`, `@types/` → `types/`

### Naming
- Files: camelCase for modules, PascalCase for components
- Classes: PascalCase
- Functions/variables: camelCase
- Constants: UPPER_SNAKE_CASE
- Enums: PascalCase members

## Common Mistakes to Avoid

### 1. Missing package.json Registration
Every command, view, and custom editor MUST be in `package.json` `contributes` section. Code-only registration fails silently.

### 2. Webview Message Race Conditions
Webviews may not be ready when messages are sent. Use ready state tracking:
```typescript
private webviewReadyState: Map<string, boolean> = new Map();
private pendingWebviewUpdates: Map<string, (() => void)[]> = new Map();
```

### 3. CSP Violations in Webviews
Remote resources need explicit CSP. Check `webviewTemplate.ts` for pattern:
```typescript
connect-src https://*.vscode-cdn.net https://*.frontierrnd.com;
script-src https://static.cloudflareinsights.com;
```

### 4. Stale Editor Content
Reading notebook files directly gets stale data. Use the document model:
```typescript
// Wrong: fs.readFile(notebookPath)
// Right: use CodexCellDocument or currentNotebookReader
```

### 5. Blocking Activation
Heavy operations block extension startup. Use:
- `setTimeout(..., 0)` for deferral
- Non-blocking migrations
- Splash screen for feedback

### 6. Forgetting Disposables
Register disposables for cleanup:
```typescript
context.subscriptions.push(disposable);
```

### 7. Hardcoded Language Strings
Use dynamic values for i18n:
```typescript
// Bad: srcLang: "en", label: "English"
// Good: srcLang: config.language, label: getLanguageLabel()
```

## Review Standards (from PR History)

Reviewers prioritize:
1. **Functional testing** - "Tested and working" is key approval phrase
2. **State management** - Dirty state, save triggers, LLM preview flags
3. **CSP compliance** - Security for remote environments
4. **Migration safety** - Backward compatibility for user data
5. **RTL/i18n support** - Multi-language considerations

## Testing

### Unit Tests (src/test/suite/)
```bash
npm run test
```
- Framework: Mocha (TDD ui)
- Mock VS Code API via `@vscode/test-electron`
- Note: Depends on `project-accelerate.shared-state-store` (see TESTING_SETUP.md)

### Webview Tests (webviews/codex-webviews/)
```bash
npm run test:webviews
npm run test:webviews:watch  # Watch mode
npm run test:webviews:ui     # Interactive UI
```
- Framework: Vitest + Testing Library

### E2E Tests (test/specs/)
```bash
npm run wdio
```
- Framework: WebdriverIO v8 + wdio-vscode-service

## Subdirectory Documentation

When editing files in subdirectories, check for and read any `CLAUDE.md` in the ancestry tree that hasn't been loaded. Key locations:
- `src/providers/CLAUDE.md`
- `src/projectManager/CLAUDE.md`
- `webviews/codex-webviews/CLAUDE.md`

## Before Finishing a Session

1. Update relevant `CLAUDE.md` files with new patterns/gotchas discovered
2. Add new commands/views to this guide if created
3. Document any new migrations or breaking changes
4. Ensure tests pass: `npm run test && npm run test:webviews`

## Resources

- [VS Code Extension API](https://code.visualstudio.com/api)
- [Extension Guides](https://code.visualstudio.com/api/extension-guides/overview)
- [Webview API](https://code.visualstudio.com/api/extension-guides/webview)
- [Custom Editors](https://code.visualstudio.com/api/extension-guides/custom-editors)
- Project docs: `docs/` directory, `TYPE_SAFE_EDITS.md`, `TESTING_SETUP.md`
