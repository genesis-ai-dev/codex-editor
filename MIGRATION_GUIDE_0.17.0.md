# Migration Guide: Removing Legacy Code in 0.17.0

**⚠️ TODO: Complete these cleanup tasks when releasing version 0.17.0**

This document tracks legacy code and migrations that should be removed after version 0.16.0 is deployed to all users.

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

**Run these checks before 0.17.0 release:**

```bash
# Check for any remaining "healingFor" references (should only be "updatingFor")
grep -r "HealingFor\|healingFor" src/ --exclude-dir=node_modules

# Check for legacy field references in normalizeUpdateEntry
grep -A 5 "deleted.*cancelled" src/utils/remoteUpdatingManager.ts

# Check for TODO comments about 0.17.0
grep -r "TODO.*0\.17\.0\|Remove in 0\.17\.0" src/ --exclude-dir=node_modules

# Verify interface doesn't have legacy fields
grep -A 10 "interface RemoteUpdatingEntry" src/utils/remoteUpdatingManager.ts
```

**Expected results:**
- ✅ No `initiateRemoteHealingFor` except in `getList()` fallback
- ✅ No legacy fields in `RemoteUpdatingEntry` interface
- ✅ Only `normalizeUpdateEntry()` should handle `deleted` → `cancelled`
- ✅ All TODO comments accounted for in this guide

---

## 7. Update Package Version

**File:** `package.json`

Update version to `0.17.0` and ensure changelog mentions:
- Removed legacy "healing" terminology support
- Removed migration code for 0.13.0-0.16.0
- Removed backward compatibility for `deleted`/`deletedBy`/`obliterate`

---

## Timeline

- **0.13.0-0.16.x**: Migration and backward compatibility active
- **0.17.0**: Remove all migration code and legacy field support
- **Users skipping versions**: Not supported (must go through 0.14-0.16 first)

---

## Testing Before Release

1. ✅ Verify all users are on 0.16.x or higher
2. ✅ Confirm no metadata.json files in the wild still use old field names
3. ✅ Test that 0.17.0 correctly rejects/ignores old field names
4. ✅ Ensure merge logic works without fallbacks
5. ✅ Run full test suite with legacy code removed

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

**NOTE:** This file can be deleted after 0.17.0 is successfully deployed.

