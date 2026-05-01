# Notebook schema versioning

This module owns the on-disk schema for `.codex` and `.source` notebooks.
Every file carries `metadata.schemaVersion: number`; files that predate the
versioning system are treated as **v0**. A migration ladder brings any
older notebook up to `CURRENT_SCHEMA_VERSION` before it's merged or
rendered.

```
disk file (any version) ──► bringNotebookToCurrent() ──► canonical shape
       (SchemaNotebook)                                  (CodexNotebookAsJSONData)
```

## When to import these types — the layer boundary

> **The schema types describe what's on disk. The canonical types describe
> what code expects. The ladder is the only function that turns one into
> the other.**

There are three layers, each with its own type vocabulary:

| Layer | What it represents | Use these types |
|-------|--------------------|-----------------|
| **Pre-ladder** (raw JSON, unknown version) | A notebook just parsed off disk that might be v0, v1, or some legacy shape | `SchemaNotebook` / `SchemaCell` / `SchemaCellMetadata` / `SchemaEdit` (this folder) |
| **Ladder internals** | The migration steps themselves | `SchemaMigration` (this folder) |
| **Post-ladder** (canonical, normalized) | A notebook the rest of the codebase reads/writes — guaranteed at `CURRENT_SCHEMA_VERSION` | `CodexNotebookAsJSONData` / `CustomNotebookCellData` / `CustomNotebookMetadata` / `EditHistory` (from `types/index.d.ts`) |

The hand-off happens whenever `bringNotebookToCurrent` returns. After
that point the notebook conforms to the canonical types.

### Where the schema types are the right call

Only inside the migration boundary:

- This folder (`src/projectManager/utils/schema/`).
- Call sites that **parse raw JSON and then run the ladder** before
  handing the data to the rest of the system. The merge resolver
  (`src/projectManager/utils/merge/resolvers.ts`) is the canonical
  example — it parses both branches as `SchemaNotebook`, runs
  `bringNotebookToCurrent` on each, then casts to the canonical types
  for the actual merge.
- Tests that synthesize "old-shaped" notebook fixtures.

### Where the schema types are *not* the right call

- Anywhere a notebook has already been normalized — the editor at
  runtime, webview message handlers, the serializer, `CodexCellDocument`,
  etc. There the contract is "this is the current schema"; using
  `SchemaNotebook` would relax that contract and force redundant
  null-checks for fields the canonical types guarantee.
- Webviews. They never see un-normalized data; the extension host is
  the boundary.
- Re-exports from `types/index.d.ts`. Keeping the schema types
  co-located here keeps the boundary obvious. If you find yourself
  reaching for `SchemaNotebook` outside the ladder, you almost
  certainly want a canonical type instead.

## Adding a new schema version

When the on-disk shape changes:

1. Create `migrations/v<N>_to_v<N+1>.ts` exporting a `SchemaMigration`
   that mutates the parsed notebook in place. The function should
   never invent state that didn't exist on disk (e.g. don't synthesize
   edit history for cells that arrived with `edits: []`).
2. Register it in `index.ts`:

   ```ts
   const migrations: Record<number, SchemaMigration> = {
       1: migrate_v0_to_v1,
       // ...
       N + 1: migrate_v<N>_to_v<N+1>,
   };
   ```

3. Bump `CURRENT_SCHEMA_VERSION` in `index.ts`.
4. Add a test in `src/test/suite/schemaLadder.test.ts` covering the new
   step in isolation and the full v0 → current walk.

The ladder runs in four places automatically:

- **Activation** (`migration_normalizeAllNotebooksToCurrentSchema`):
  scans every notebook on extension start.
- **Save** (`src/serializer.ts`): stamps `schemaVersion` on every write.
- **Merge** (`resolveCodexCustomMerge`): brings both ours and theirs to
  current before merging.
- **Post-sync** (`SyncManager.executeSyncInBackground`): walks the
  files touched by the latest sync.

You don't need to wire your new step into any of those — registering
it in the migrations map is enough.

## Forward-compat

If a notebook arrives with `schemaVersion > CURRENT_SCHEMA_VERSION`
(e.g. a teammate on a newer build pushed it), `bringNotebookToCurrent`
logs a warning and returns `aheadOfClient: true` without touching the
file. The merge resolver still runs best-effort — unknown fields pass
through opaquely, but the activation pass and the post-sync hook leave
the file alone. There is no inverse ladder; we never downgrade.
