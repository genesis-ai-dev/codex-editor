# Project Manager

Project initialization, sync, and migrations.

## Key Files

- `index.ts` - Project init, metadata setup
- `syncManager.ts` - Git-based cloud sync (GitLab)
- `utils/migrationUtils.ts` - Data migrations
- `utils/projectUtils.ts` - Project helpers
- `utils/merge/` - CRDT merge resolvers

## Adding a Migration

```typescript
// migrationUtils.ts
export async function migration_yourMigration(): Promise<void> {
    const config = vscode.workspace.getConfiguration();
    const migrated = config.get("codex-editor.migrations.yourMigration");
    if (migrated) return;

    // Migration logic...

    await config.update("codex-editor.migrations.yourMigration", true, vscode.ConfigurationTarget.Workspace);
}
```

Register in `extension.ts` activation flow.

## Sync Flow

1. `SyncManager.initialize()` - Setup Git remote
2. `SyncManager.pull()` - Fetch remote changes
3. CRDT merge via `utils/merge/resolvers.ts`
4. `SyncManager.push()` - Push local changes

## CRDT Merge System

See `docs/merge-strategy.md` and `TYPE_SAFE_EDITS.md`.

Resolvers in `utils/merge/resolvers.ts`:
- Cell content conflicts → timestamp-based resolution
- Metadata conflicts → deep merge
- Comments → union merge

## Project Initialization

`projectInitializers.ts` handles:
- Directory structure creation
- metadata.json setup
- Git initialization
- Source file imports

## Gotchas

- Migrations must be idempotent
- Check `checkIfMetadataAndGitIsInitialized()` before project operations
- SyncManager requires authentication via FrontierAPI
- Migration cleanup TODOs indicate temporary backward-compat code
