# AGENTS.md

This file provides guidance to AI coding agents working with code in this repository.

## What This Is

Codex Translation Editor is a VS Code extension for scripture translation projects. It supports `.codex` notebooks, `.bible` source files, and `.scripture` raw scripture files, with a built-in language server, AI-powered smart edits, and a SQLite-backed dictionary.

## Build Commands

**Extension (root):**
```bash
npm run compile          # webpack build to out/
npm run watch            # webpack watch mode
npm run lint             # ESLint on src/
npm run test             # compile + lint + run VS Code test runner
npm run package          # production build
```

**Webviews (`webviews/codex-webviews/`):**
```bash
pnpm run build:all                       # build all views
pnpm run build:CodexCellEditor           # build single view
pnpm run watch:CodexCellEditor           # watch single view
pnpm run test                            # vitest run
pnpm run test:watch                      # vitest watch
pnpm run smart-watch                     # watches and rebuilds changed views only
```

**Full build (from root):**
```bash
npm run build:webviews    # builds all webviews (calls pnpm build:all inside webviews/codex-webviews)
```

**E2E tests:**
```bash
npm run wdio              # WebdriverIO tests (requires shared-state-store dependency)
```

## Initial Setup

```bash
pnpm i                                              # root deps
cd webviews/codex-webviews && pnpm i && pnpm run build:all   # webview deps + build
cd ../editable-react-table && pnpm i && pnpm run build       # table widget
```

Then press `F5` in VS Code to launch the extension host.

## Architecture

### Extension Host (`src/`)

- **`extension.ts`** — activation entry point; runs migrations, registers providers, language server, project manager, SQL dictionary, smart edits, and startup flow.
- **`providers/`** — VS Code provider registrations:
  - `codexCellEditorProvider/` — custom editor for `.codex` files (the main editor)
  - `StartupFlow/` — new project/clone wizard
  - `SplashScreen/`, `WelcomeView/` — onboarding UI
  - `mainMenu/`, `navigationWebview/`, `parallelPassagesWebview/`, `commentsWebview/` — sidebar panels
- **`projectManager/`** — project initialization, metadata management (`metadata.json`), git sync (`syncManager.ts`), source text import, migration utilities.
- **`tsServer/`** — embedded language server (`server.ts`) for spell-check and diagnostics, registered via `vscode-languageclient`.
- **`smartEdits/`** — LLM-powered drafting suggestions and back-translation.
- **`sqldb/`** — SQLite Wiktionary dictionary via `fts5-sql-bundle`.
- **`activationHelpers/contextAware/`** — command registration, webview initialization, content indexing/search.
- **`utils/`** — shared utilities: audio processing/merging, CRDT edit map, notebook utils, dictionary, metadata manager.
- **`stateStore.ts`** — thin wrapper around the `project-accelerate.shared-state-store` extension API for cross-webview state.

### Webviews (`webviews/codex-webviews/src/`)

Each subdirectory is a standalone React + Vite app built independently:

| View | Purpose |
|------|---------|
| `CodexCellEditor` | Main translation editor (Quill-based, spellcheck, audio) |
| `StartupFlow` | Project creation/clone wizard |
| `NavigationView` | Book/chapter navigation sidebar |
| `CommentsView` | Translation comments |
| `ParallelView` | Parallel passage comparison |
| `MainMenu` | Project settings panel |
| `SplashScreen` | Loading/startup screen |
| `NewSourceUploader` | Import source text |
| `PublishProject` | Export/publish |
| `CellLabelImporterView`, `CodexMigrationToolView`, `CopilotSettings`, `EditableReactTable` | Misc tools |

Components are shared via `src/components/` (ShadCN). Vite is configured with `APP_NAME` env var to select the entry point.

### Shared Utilities

- **`sharedUtils/`** — utilities shared between extension host and webviews (used in both webpack and vite builds).
- **`types/index.d.ts`** — all project-wide TypeScript types; the single source of truth for webview↔provider message types.
- **`types/enums.ts`** — shared enums (e.g. `CodexCellTypes`).

### Build System

- Extension: **webpack** (`webpack.config.js`) → `out/extension.js` (CommonJS, Node target)
- Webviews: **Vite** with multi-entry config → `webviews/codex-webviews/dist/`
- Webpack aliases: `@` → `src/`, `@sharedUtils` → `sharedUtils/`, `types` → `types/`

## Key Conventions

### Types

- **Always check `types/index.d.ts` first** before using `any`. This file contains all shared types including webview message types.
- When passing messages between webviews and providers, update `types/index.d.ts`.
- Prefer `import type` for type-only imports.

### CRDT Edit System

Cell edits go through `EditHistory` with type-safe `editMap` paths. Use `EditMapUtils` helpers from `src/utils/editMapUtils.ts` instead of raw string arrays:
```typescript
import { EditMapUtils } from "../utils/editMapUtils";
// e.g. EditMapUtils.value(), EditMapUtils.cellLabel(), EditMapUtils.dataDeleted()
```

### ShadCN vs VSCode Toolkit

New webview UI should use ShadCN components (`../components/ui/*`). When migrating old code from `VSCodeButton` → use `Button` from `../components/ui/button` with `variant=` prop instead of `appearance=`. Use direct relative paths, not aliases, in webview code.

### File Size

Target under 500 lines per file. Extract helper functions into co-located `utils/` directories or shared `src/utils/`. Avoid deeply nested ternaries (max 1 level).

### Audio Files

Audio attachments live at `.project/attachments/{BOOK}/{BOOK}_{CCC}_{VVV}.{ext}` (e.g. `JUD_001_025.wav`). Zero-padding is optional on load but conventional when writing.
