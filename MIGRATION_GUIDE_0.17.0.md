# Migration Guide: Version 0.17.0

**⚠️ TODO: Complete these cleanup tasks when releasing version 0.17.0**

This document tracks major changes, new features, and legacy code migrations for version 0.17.0.

---

## 🆕 Major New Features in 0.17.0

### Project Swap System
A new feature allowing instance administrators to migrate entire teams from an old Git repository to a new one with clean history while preserving all working files.

**New Interfaces:**
- `ProjectSwapInfo` - Metadata for project swap operations
- `LocalProjectSwap` - Local tracking state for swap migrations

**New Commands:**
- `codex-editor.initiateProjectSwap` - Initiate a project migration
- `codex-editor.viewProjectSwapStatus` - View swap status
- `codex-editor.cancelProjectSwap` - Cancel an ongoing migration

**New Files:**
- `src/commands/projectSwapCommands.ts` - Project swap command handlers
- `src/providers/StartupFlow/performProjectSwap.ts` - Project swap execution logic
- `src/utils/projectSwapManager.ts` - Project swap state management

### Project ID Validation System
Ensures all projects have valid UUIDs in their metadata.

**New Files:**
- `src/utils/projectIdValidator.ts` - Project ID validation and fixing logic

**New Commands:**
- `codex-project-manager.validateProjectId` - Validate and fix project IDs

### Update Permission System
Permission checking for users who can manage remote updates (requires Maintainer or Owner access).

**New Files:**
- `src/utils/updatePermissionChecker.ts` - Permission checking utilities

### Connectivity Checker
Network connectivity validation for remote operations.

**New Files:**
- `src/utils/connectivityChecker.ts` - Network connectivity validation

### Enhanced Project Creation
Project folders now automatically include the projectId as a suffix for uniqueness and identification.

**Example:** Creating project "my-project" with ID "abc123" now creates folder "my-project-abc123"

**Changes:**
- `createNewWorkspaceAndProject()` now accepts optional `ExtensionContext` parameter
- `createProjectInNewFolder()` automatically appends projectId to folder name
- Project name field in publish flow is now read-only (matches workspace folder)

### Improved Local Project Settings
New tracking capabilities for update operations and project swap state.

**New Fields in `LocalProjectSettings`:**
- `updateState: UpdateState` - Track in-progress updates for restart-safe cleanup
- `pendingUpdate: PendingUpdateState` - Track admin-triggered pending updates
- `updateCompletedLocally` - Track locally completed updates not yet synced
- `projectSwap: LocalProjectSwap` - Track project swap migration state

**New Helper Functions:**
- `markPendingUpdateRequired()` - Mark that an update is pending
- `clearPendingUpdate()` - Clear pending update flag
- `markUpdateCompletedLocally()` - Mark update as completed locally
- `clearUpdateCompletedLocally()` - Clear local completion flag

### Enhanced Metadata Structure
`metadata.json` now supports additional project management features.

**New Fields in `ProjectMetadata.meta`:**
- `projectSwap?: ProjectSwapInfo` - Project swap information
- `initiateRemoteUpdatingFor` (replaces `initiateRemoteHealingFor`)

### Message Protocol Updates
Updated webview message types to reflect new terminology.

**Changed Messages:**
- `project.healingInProgress` → `project.updatingInProgress`

---

## 🔄 Terminology Migration: "Healing" → "Updating"

### Renamed Commands
- `codex-editor.initiateRemoteHealing` → `codex-editor.initiateRemoteUpdating`
- `codex-editor.viewRemoteHealingList` → `codex-editor.viewRemoteUpdatingList`

### Renamed Interfaces
- `RemoteHealingEntry` → `RemoteUpdatingEntry` (old interface kept as deprecated for backward compatibility)

### Renamed Files
- `src/utils/remoteHealingManager.ts` → `src/utils/remoteUpdatingManager.ts`

### Field Renames in `RemoteUpdatingEntry`
- `userToHeal` → `userToUpdate`
- `deleted` → `cancelled`
- `deletedBy` → `cancelledBy`
- `obliterate` → `clearEntry`

### Updated Test Files
- `src/test/suite/healMergeSharedLogic.test.ts` → `src/test/suite/updateMergeSharedLogic.test.ts`
- New test files:
  - `src/test/suite/integration/project-updating.test.ts`
  - `src/test/suite/pendingUpdateValidation.test.ts`
  - `src/test/suite/remoteUpdatingDeleted.test.ts`
  - `src/test/suite/startupFlowProvider_updateSync.test.ts`
  - `src/test/suite/remoteUpdateCommands.test.ts`
  - `src/test/migration_healingToUpdating.test.ts`
  - `src/test/suite/connectivityChecker.test.ts`

---

## 🎨 UI/UX Improvements

### Name Project Modal
Added keyboard shortcuts for better user experience:
- **Enter** - Submit the form
- **Escape** - Cancel and close modal

### Publish Project View
Project name field is now read-only and includes the unique project ID:
- Displays full workspace folder name (with UUID)
- Prevents user confusion about project naming
- Helper text explains that name matches workspace folder
- Field visually disabled to indicate it cannot be changed

### Project Setup Step
Updated message handling to use new "updating" terminology instead of "healing"

### GitLab Projects List
Updated to handle pending updates and project swap status indicators

---

## ⚠️ Breaking Changes

### Project Folder Naming
**IMPORTANT:** New projects now include the projectId in the folder name.

**Before 0.17.0:**
```
my-project/
├── metadata.json (contains projectId: "abc-123-def")
└── ...
```

**After 0.17.0:**
```
my-project-abc-123-def/
├── metadata.json (contains projectId: "abc-123-def")
└── ...
```

**Impact:**
- **New projects:** Automatically created with projectId suffix
- **Existing projects:** Continue to work without changes
- **Published projects:** Name field in publish UI is read-only (matches folder name)

### API Changes
- `createNewWorkspaceAndProject()` signature changed to accept optional `context: vscode.ExtensionContext`
- Import paths changed: `remoteHealingManager` → `remoteUpdatingManager`

### Metadata Structure
Projects may need to handle both old and new field names during transition:
- `initiateRemoteHealingFor` → `initiateRemoteUpdatingFor` (backward compatible)
- Old field is automatically migrated via `normalizeUpdateEntry()`

---

## 📝 Migration Notes for Developers

### If You Import `remoteHealingManager`
```typescript
// ❌ Old
import { ... } from "../../utils/remoteHealingManager";

// ✅ New
import { ... } from "../../utils/remoteUpdatingManager";
```

### If You Work with Update Entries
The interface is now `RemoteUpdatingEntry`:
```typescript
// ❌ Old field names (deprecated)
entry.userToHeal
entry.deleted
entry.deletedBy
entry.obliterate

// ✅ New field names
entry.userToUpdate
entry.cancelled
entry.cancelledBy
entry.clearEntry
```

### If You Handle WebView Messages
```typescript
// ❌ Old
case "project.healingInProgress":
    setIsAnyApplying(!!(message as any).healing);

// ✅ New
case "project.updatingInProgress":
    setIsAnyApplying(!!(message as any).updating);
```

### If You Create New Projects
```typescript
// ❌ Old (context optional, not passed)
await createNewWorkspaceAndProject();

// ✅ New (pass context for proper state management)
await createNewWorkspaceAndProject(this._context);
```

---

## 🧪 New Test Coverage

This release significantly expands test coverage:

1. **Connectivity Checker Tests** - Network validation
2. **Migration Tests** - Healing → Updating terminology
3. **Pending Update Validation** - Update state tracking
4. **Remote Update Deletion** - Entry removal logic
5. **Startup Flow Update/Sync** - Integration with startup provider
6. **Update Merge Logic** - Shared merge engine for updates
7. **Project Updating Integration** - End-to-end update flows

---

## ✅ GOOD NEWS: No Legacy Fields in Interface!

**We're using a "normalize-on-read" pattern:**
- The `RemoteUpdatingEntry` interface contains **ONLY** new field names
- Legacy fields are automatically converted to new names when reading `metadata.json`
- Code is clean and doesn't need fallback logic
- No "remove in 0.17.0" cleanup needed in most places!

**How it works:**
1. Read `metadata.json` → contains legacy fields (e.g., `deleted`, `obliterate`)
2. Call `normalizeUpdateEntry(entry)` → converts old → new
3. Use normalized entries everywhere → code only sees new field names

---

## 1. Remove Legacy Field Support from `normalizeUpdateEntry()`

**File:** `src/utils/remoteUpdatingManager.ts`

**Keep the function, but remove migration logic:**

The `normalizeUpdateEntry()` function currently handles migration. After all users are on 0.17.0+, simplify it to just validate fields (no conversion needed):

```typescript
// Before (0.13.0-0.16.x): Migrates old → new
export function normalizeUpdateEntry(entry: any): RemoteUpdatingEntry {
    const normalized: any = { ...entry };
    
    // Migrate deleted → cancelled
    if ('deleted' in normalized && !('cancelled' in normalized)) {
        normalized.cancelled = normalized.deleted;
        delete normalized.deleted;
    }
    // ... more migrations ...
    
    return normalized as RemoteUpdatingEntry;
}

// After (0.17.0+): Just validates/ensures defaults
export function normalizeUpdateEntry(entry: any): RemoteUpdatingEntry {
    // All entries should already have new field names
    return {
        userToUpdate: entry.userToUpdate || "",
        addedBy: entry.addedBy || "",
        createdAt: entry.createdAt || 0,
        updatedAt: entry.updatedAt || Date.now(),
        cancelled: entry.cancelled || false,
        cancelledBy: entry.cancelledBy || "",
        executed: entry.executed || false,
        clearEntry: entry.clearEntry,
    };
}
```

---

## 2. Remove Migration Function

**File:** `src/utils/migration_healingToUpdating.ts`

**Action:** Delete the entire file and remove its import/call from `extension.ts`

**In `extension.ts`, remove:**
```typescript
// Migrate healing→updating terminology in metadata.json (0.14.0-0.16.0 only, remove in 0.17.0)
import { migration_healingToUpdating } from "./utils/migration_healingToUpdating";

// ... and in executeCommandsAfter:
await migration_healingToUpdating(projectPath);
```

---

## 3. ✅ Merge Resolver Already Clean!

**File:** `src/projectManager/utils/merge/resolvers.ts`

**Good news:** The merge resolver is already clean! It:
- Calls `getList()` which normalizes entries on read
- Only works with new field names (`cancelled`, `clearEntry`)
- Has no legacy fallback logic

**The only remaining legacy support:**
- `getList()` still checks for old `initiateRemoteHealingFor` field name (see next section)

---

## 4. Remove `initiateRemoteHealingFor` Fallback

**File:** `src/projectManager/utils/merge/resolvers.ts`

**Current code (0.13.0-0.16.x):**
```typescript
const getList = (obj: any): RemoteUpdatingEntry[] => {
    // Prefer new field name, fallback to old for backward compatibility
    const rawList = (obj?.meta?.initiateRemoteUpdatingFor || obj?.meta?.initiateRemoteHealingFor || []) as any[];
    // Normalize all entries to convert legacy field names
    return rawList.map(entry => normalizeUpdateEntry(entry));
};
```

**After 0.17.0:**
```typescript
const getList = (obj: any): RemoteUpdatingEntry[] => {
    const rawList = (obj?.meta?.initiateRemoteUpdatingFor || []) as any[];
    // Still call normalize to ensure defaults/validation
    return rawList.map(entry => normalizeUpdateEntry(entry));
};
```

**Also remove:**
- Line that deletes `initiateRemoteHealingFor` from resolved metadata
- Skip logic for `initiateRemoteHealingFor` in generic merge

---

## 5. Update Test Files

**File:** `src/test/suite/updateMergeSharedLogic.test.ts`

**Remove or update:**
- Remove TODO comments about 0.17.0
- Ensure tests only use new field names (`cancelled`, `cancelledBy`, `clearEntry`)
- Remove any legacy field testing

---

## 5. Enable Clear Entry Feature (Optional)

**File:** `src/utils/remoteUpdatingManager.ts`

**Consider enabling the feature permanently:**
```typescript
export const FEATURE_FLAGS = {
    ENABLE_ENTRY_CLEARING: false,  // ← Change from false to true (if not already enabled)
} as const;
```

**Or remove the flag entirely if it should be always-on** and replace all `isFeatureEnabled('ENABLE_ENTRY_CLEARING')` checks with `true`.

---

## 7. Verify No Remaining References

**Run these checks before 0.18.0 release (when cleaning up legacy code):**

```bash
# Check for any remaining "healingFor" references (should only be "updatingFor")
grep -r "HealingFor\|healingFor" src/ --exclude-dir=node_modules

# Check for legacy field references in normalizeUpdateEntry
grep -A 5 "deleted.*cancelled" src/utils/remoteUpdatingManager.ts

# Check for TODO comments about 0.17.0 or 0.18.0
grep -r "TODO.*0\.17\.0\|TODO.*0\.18\.0\|Remove in 0\.17\.0\|Remove in 0\.18\.0" src/ --exclude-dir=node_modules

# Verify interface doesn't have legacy fields
grep -A 10 "interface RemoteUpdatingEntry" src/utils/remoteUpdatingManager.ts

# Verify all project swap components exist
ls -la src/commands/projectSwapCommands.ts
ls -la src/utils/projectSwapManager.ts
ls -la src/providers/StartupFlow/performProjectSwap.ts

# Verify project ID validator exists
ls -la src/utils/projectIdValidator.ts

# Verify new test files exist
ls -la src/test/suite/connectivityChecker.test.ts
ls -la src/test/suite/integration/project-updating.test.ts
ls -la src/test/migration_healingToUpdating.test.ts
```

**Expected results for 0.17.0:**
- ✅ No `initiateRemoteHealingFor` except in `getList()` fallback (for backward compatibility)
- ✅ `RemoteHealingEntry` exists only as deprecated backward-compatible interface
- ✅ `normalizeUpdateEntry()` still handles legacy field migration
- ✅ All new features (project swap, validators, permission checks) are present
- ✅ All new test files are in place

**Expected results for 0.18.0 (future cleanup):**
- ✅ No `initiateRemoteHealingFor` references anywhere
- ✅ No legacy fields in `RemoteUpdatingEntry` interface
- ✅ `normalizeUpdateEntry()` simplified to validation-only
- ✅ `migration_healingToUpdating.ts` deleted
- ✅ All TODO comments accounted for in this guide

---

## 8. Update Package Version

**File:** `package.json`

Update version to `0.17.0` and ensure changelog mentions:

**Major Features:**
- ✨ Project Swap system for migrating teams to new repositories
- ✨ Project ID validation and fixing utilities
- ✨ Update permission checking (Maintainer/Owner required)
- ✨ Network connectivity validation
- 📁 Enhanced project creation with UUID-based folder naming

**Improvements:**
- 🔄 Complete "healing" → "updating" terminology migration
- 🎨 UI/UX enhancements (keyboard shortcuts, read-only fields)
- 📊 Expanded test coverage
- 🏗️ Improved local project settings tracking
- 🔧 Enhanced metadata structure with project swap support

**Breaking Changes:**
- ⚠️ New projects include projectId in folder name
- ⚠️ `createNewWorkspaceAndProject()` signature changed
- ⚠️ Import paths changed (`remoteHealingManager` → `remoteUpdatingManager`)

**Deprecations:**
- 🔻 `RemoteHealingEntry` interface (use `RemoteUpdatingEntry`)
- 🔻 `initiateRemoteHealingFor` metadata field (use `initiateRemoteUpdatingFor`)

**Backward Compatibility:**
- ✅ Old field names automatically migrated via normalization
- ✅ Existing projects continue to work without changes
- ✅ `RemoteHealingEntry` kept as deprecated backward-compatible interface

---

## Timeline

- **0.13.0-0.16.x**: Migration and backward compatibility active
  - "Healing" terminology still in use
  - Legacy field names supported via normalization
  - Gradual rollout of new features
- **0.17.0**: Major feature release
  - ✨ New: Project Swap system
  - ✨ New: Project ID validation
  - ✨ New: Update permission checking
  - ✨ New: Connectivity validation
  - 🔄 Complete: Healing → Updating terminology migration
  - 📁 Enhanced: Project folder naming with UUID suffix
  - 🎨 Improved: UI/UX enhancements across webviews
  - Remove all migration code and legacy field support (after deployment stabilizes)
- **0.18.0+**: Clean up legacy migration code
  - Remove `migration_healingToUpdating.ts`
  - Simplify `normalizeUpdateEntry()` to validation-only
  - Remove `initiateRemoteHealingFor` fallback support
- **Users skipping versions**: Not supported (must go through 0.14-0.16 first)

---

## Testing Before Release

**Before 0.17.0 Release:**
1. ✅ Verify all users are on 0.16.x or higher
2. ✅ Test new project creation with UUID suffix in folder name
3. ✅ Test project swap initiation, migration, and cancellation
4. ✅ Test project ID validation on existing projects
5. ✅ Test update permission checking for different access levels
6. ✅ Test connectivity validation in offline scenarios
7. ✅ Verify keyboard shortcuts in Name Project Modal
8. ✅ Verify read-only project name in Publish view
9. ✅ Test backward compatibility with old field names
10. ✅ Ensure merge logic works with both old and new metadata
11. ✅ Run full test suite including new tests
12. ✅ Verify webview message protocol updates

**Before 0.18.0 Release (Legacy Cleanup):**
1. ✅ Confirm no metadata.json files in the wild still use old field names
2. ✅ Test that 0.18.0 correctly handles (or rejects) old field names
3. ✅ Ensure merge logic works without legacy fallbacks
4. ✅ Run full test suite with legacy code removed
5. ✅ Verify migration file deletion doesn't break anything

---

## 📋 Summary: Why "Normalize-on-Read" is Better

**Old Approach (What We Avoided):**
```typescript
// Interface has BOTH old and new fields ❌
export interface RemoteUpdatingEntry {
    cancelled: boolean;
    deleted?: boolean;  // Legacy, remove in 0.17.0
    // ... dozens of fallbacks everywhere
}

// Every function needs fallback logic ❌
function isCancelled(entry: any): boolean {
    return entry.cancelled !== undefined ? entry.cancelled : (entry.deleted || false);
}
```

**New Approach (What We Did):**
```typescript
// Interface has ONLY new fields ✅
export interface RemoteUpdatingEntry {
    cancelled: boolean;
    // Clean! No legacy fields!
}

// Normalize once when reading ✅
const entries = rawList.map(entry => normalizeUpdateEntry(entry));

// Everywhere else is clean ✅
function isCancelled(entry: RemoteUpdatingEntry): boolean {
    return entry.cancelled === true;
}
```

**Benefits:**
1. ✅ **Less code to remove in 0.17.0** - only touch `normalizeUpdateEntry()` and `getList()`
2. ✅ **Cleaner codebase** - no fallback logic scattered everywhere
3. ✅ **Type safety** - interface accurately reflects what code expects
4. ✅ **Easier to reason about** - migration happens in one place, not everywhere
5. ✅ **Forward compatible** - can keep `normalizeUpdateEntry()` for validation even after migration is done

---

## 📊 Summary of Changes

### Files Added (New Features)
- `src/commands/projectSwapCommands.ts`
- `src/providers/StartupFlow/performProjectSwap.ts`
- `src/utils/projectSwapManager.ts`
- `src/utils/projectIdValidator.ts`
- `src/utils/updatePermissionChecker.ts`
- `src/utils/connectivityChecker.ts`

### Files Renamed (Terminology Migration)
- `src/utils/remoteHealingManager.ts` → `src/utils/remoteUpdatingManager.ts`
- `src/test/suite/healMergeSharedLogic.test.ts` → `src/test/suite/updateMergeSharedLogic.test.ts`

### Test Files Added
- `src/test/suite/remoteUpdateCommands.test.ts`
- `src/test/suite/connectivityChecker.test.ts`
- `src/test/suite/integration/project-updating.test.ts`
- `src/test/suite/pendingUpdateValidation.test.ts`
- `src/test/suite/remoteUpdatingDeleted.test.ts`
- `src/test/suite/startupFlowProvider_updateSync.test.ts`
- `src/test/migration_healingToUpdating.test.ts`

### Commands Added
- `codex-editor.initiateRemoteUpdating` (replaces `initiateRemoteHealing`)
- `codex-editor.viewRemoteUpdatingList` (replaces `viewRemoteHealingList`)
- `codex-editor.initiateProjectSwap`
- `codex-editor.viewProjectSwapStatus`
- `codex-editor.cancelProjectSwap`
- `codex-project-manager.validateProjectId`

### Type Definitions Enhanced
- Added `ProjectSwapInfo` interface
- Added `LocalProjectSwap` interface
- Added `RemoteUpdatingEntry` interface
- Deprecated `RemoteHealingEntry` interface (backward compatible)
- Enhanced `LocalProjectSettings` with update tracking
- Enhanced `ProjectMetadata` with project swap support
- Updated `MessagesFromStartupFlowProvider` types

### Breaking Changes Summary
1. Project folder naming now includes UUID suffix
2. `createNewWorkspaceAndProject()` API signature changed
3. Import path changes for remote updating manager
4. WebView message protocol updates

### Backward Compatibility Maintained
1. Old metadata field names auto-migrated
2. `RemoteHealingEntry` kept as deprecated interface
3. Existing projects work without changes
4. Gradual rollout strategy supported

---

**NOTE:** This file should be updated when 0.18.0 planning begins for the final legacy code removal phase.

