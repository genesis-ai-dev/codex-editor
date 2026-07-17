# Type-Safe Edit System

This document describes the advanced type-safe edit system that infers value types based on editMap paths, providing compile-time type safety for the CRDT edit system.

## Overview

The edit system uses TypeScript's advanced type features to ensure that:

- Each `editMap` path has the correct value type
- TypeScript provides compile-time validation
- IDE autocompletion works correctly
- Runtime type errors are prevented

## Core Types

### EditMapValueTypes

Maps editMap paths to their expected value types:

```typescript
type EditMapValueTypes = {
    readonly ["value"]: string; // HTML content
    readonly [("metadata", "cellLabel")]: string; // Cell label text
    readonly [("metadata", "data")]: CodexData; // Complete data object
    readonly [("metadata", "data", "deleted")]: boolean; // Deletion flag
    readonly [("metadata", "data", "startTime")]: number; // Timestamp number
    readonly [("metadata", "data", "endTime")]: number; // Timestamp number
    readonly [("metadata", "data", "book")]: string; // Book name
    readonly [("metadata", "data", "chapter")]: string; // Chapter name
    readonly [("metadata", "data", "verse")]: string; // Verse reference
    readonly [("metadata", "data", "merged")]: boolean; // Merge flag
    readonly [("metadata", "selectedAudioId")]: string; // Audio ID
    readonly [("metadata", "selectionTimestamp")]: number; // Selection timestamp
    readonly [("metadata", string)]: string | number | boolean | object; // Fallback
};
```

### EditHistory<TEditMap>

Generic type that infers value type based on editMap:

```typescript
export type EditHistory<TEditMap extends string[] = string[]> = EditHistoryBase & {
    editMap: TEditMap;
    value: EditMapValueType<TEditMap>; // Type inferred from editMap
};
```

## Usage Examples

### 1. Cell Content Edit

```typescript
import { EditMapUtils } from "./src/utils/editMapUtils";

const edit: EditHistory<["value"]> = {
    editMap: EditMapUtils.value(),
    value: "<span>Hello World</span>", // TypeScript knows this must be string
    author: "user1",
    timestamp: Date.now(),
    type: EditType.USER_EDIT,
};
```

### 2. Cell Label Edit

```typescript
const edit: EditHistory<["metadata", "cellLabel"]> = {
    editMap: EditMapUtils.cellLabel(),
    value: "Genesis 1:1", // TypeScript knows this must be string
    author: "user1",
    timestamp: Date.now(),
    type: EditType.USER_EDIT,
};
```

### 3. Data Object Edit

```typescript
const timestamps: CodexData = {
    startTime: 0,
    endTime: 1000,
    deleted: false,
    book: "Genesis",
    chapter: "1",
};

const edit: EditHistory<["metadata", "data"]> = {
    editMap: EditMapUtils.data(),
    value: timestamps, // TypeScript knows this must be CodexData object
    author: "user1",
    timestamp: Date.now(),
    type: EditType.USER_EDIT,
};
```

### 4. Boolean Field Edit

```typescript
const edit: EditHistory<["metadata", "data", "deleted"]> = {
    editMap: EditMapUtils.dataDeleted(),
    value: true, // TypeScript knows this must be boolean
    author: "user1",
    timestamp: Date.now(),
    type: EditType.USER_EDIT,
};
```

### 5. Number Field Edit

```typescript
const edit: EditHistory<["metadata", "data", "startTime"]> = {
    editMap: EditMapUtils.dataStartTime(),
    value: 500, // TypeScript knows this must be number
    author: "user1",
    timestamp: Date.now(),
    type: EditType.USER_EDIT,
};
```

## Utility Functions

### EditMapUtils

Provides type-safe creation of editMap arrays:

```typescript
export const EditMapUtils = {
    // Specific typed helpers
    value(): readonly ["value"];
    cellLabel(): readonly ["metadata", "cellLabel"];
    data(): readonly ["metadata", "data"];
    dataDeleted(): readonly ["metadata", "data", "deleted"];
    dataStartTime(): readonly ["metadata", "data", "startTime"];
    dataEndTime(): readonly ["metadata", "data", "endTime"];
    selectedAudioId(): readonly ["metadata", "selectedAudioId"];
    selectionTimestamp(): readonly ["metadata", "selectionTimestamp"];

    // Generic helpers
    metadata(field: string): readonly ["metadata", string];
    metadataNested(...fields: string[]): readonly ["metadata", ...string[]];

    // Comparison utilities
    equals(editMap1: string[], editMap2: string[]): boolean;
    isValue(editMap: string[]): boolean;
    isMetadata(editMap: string[]): boolean;
    getMetadataField(editMap: string[]): string | null;
};
```

## Type-Safe Filtering

### Before (Type-Unsafe)

```typescript
function getValueEdits(edits: EditHistory[]): any[] {
    return edits.filter((edit) => edit.editMap.join(".") === "value");
    // Returns any[] - no type safety
}
```

### After (Type-Safe)

```typescript
function getValueEdits(edits: EditHistory[]): EditHistory<["value"]>[] {
    return edits.filter((edit) => EditMapUtils.isValue(edit.editMap)) as EditHistory<["value"]>[];
    // Returns properly typed array
}

// Usage
const valueEdits = getValueEdits(allEdits);
// TypeScript knows valueEdits[0].value is string
const content = valueEdits[0].value; // ✅ TypeScript knows this is string
```

## Advanced Patterns

### Conditional Types for Complex Logic

```typescript
type ProcessEdit<T extends EditHistory> =
    T extends EditHistory<["value"]>
        ? { type: "content"; content: T["value"] }
        : T extends EditHistory<["metadata", "cellLabel"]>
          ? { type: "label"; label: T["value"] }
          : T extends EditHistory<["metadata", "data"]>
            ? { type: "data"; data: T["value"] }
            : { type: "other"; raw: T["value"] };
```

### Type Guards

```typescript
function isValueEdit(edit: EditHistory): edit is EditHistory<["value"]> {
    return EditMapUtils.isValue(edit.editMap);
}

function isDataEdit(edit: EditHistory): edit is EditHistory<["metadata", "data"]> {
    return EditMapUtils.equals(edit.editMap, ["metadata", "data"]);
}
```

## Benefits

### 1. Compile-Time Safety

- Wrong value types are caught at compile time
- IDE provides correct autocompletion
- Refactoring is safer

### 2. Runtime Reliability

- Eliminates type-related runtime errors
- Ensures data consistency across the CRDT system

### 3. Developer Experience

- Better IntelliSense and autocomplete
- Self-documenting code
- Easier debugging

### 4. Future-Proofing

- Easy to add new editMap paths with proper typing
- Extensible type system
- Backward compatible

## Implementation Details

### Conditional Type Resolution

The system uses TypeScript's conditional types and template literal types to resolve value types:

```typescript
type EditMapValueType<T extends readonly string[]> =
    T extends readonly [infer First, ...infer Rest]
        ? First extends keyof EditMapValueTypes
            ? Rest extends readonly []
                ? EditMapValueTypes[First & keyof EditMapValueTypes]
                : /* handle nested paths */
            : string
        : string;
```

### Readonly Arrays

All editMap arrays are readonly to prevent mutation and ensure type safety:

```typescript
value(): readonly ["value"]; // Prevents editMap.push("something")
```

## Migration Guide

### From String-Based to Array-Based

```typescript
// Old
const edit = {
    editMap: "metadata-cellLabel",
    value: "Genesis 1" as any,
};

// New
const edit: EditHistory<["metadata", "cellLabel"]> = {
    editMap: EditMapUtils.cellLabel(),
    value: "Genesis 1", // TypeScript infers string
};
```

## Best Practices

1. **Use EditMapUtils helpers** instead of manually creating arrays
2. **Leverage type inference** - let TypeScript tell you the correct value type
3. **Use generic constraints** for functions that process specific edit types
4. **Create type guards** for runtime type checking
5. **Document new editMap paths** in the EditMapValueTypes mapping

This type system provides a robust foundation for the CRDT edit system, ensuring type safety while maintaining flexibility for future extensions.

## Merge-Time Field Preservation Invariant

The CRDT edit system replays `editMap`-tracked operations during merge to reach the
canonical post-merge state. However, **not every field on a cell's metadata is
necessarily tracked by an edit-history entry**. Examples include (but are not
limited to):

- `metadata.attachments` (audio recordings, LFS pointers, image cards)
- `metadata.selectedAudioId` / `metadata.selectionTimestamp` (current selection)
- `metadata.data.milestoneIndex` (timing milestones)
- `metadata.data.startTime` / `metadata.data.endTime` (subtitle timing — sometimes
  written without an edit-history entry depending on the call site)
- future fields added by features that don't write through `EditHistory`

### The Invariant

> When merging two cells, the resulting cell's metadata MUST be a union of both
> sides' metadata as a baseline, with edit-history replay applied on top.
> Fields that exist on only one side and are not tracked by edit history MUST
> still appear on the merged cell.

Concretely, in `resolveMetadataConflictsUsingEditHistory` (see
[src/projectManager/utils/merge/resolvers.ts](src/projectManager/utils/merge/resolvers.ts)),
the resolved cell is initialized as:

```typescript
const resolvedCell: CustomNotebookCellData = {
    ...theirCell,
    ...ourCell,
    metadata: {
        ...(theirCell.metadata ?? {}),
        ...(ourCell.metadata ?? {}),
        data: {
            ...((theirCell.metadata ?? {}).data ?? {}),
            ...((ourCell.metadata ?? {}).data ?? {}),
        },
    } as CustomNotebookCellData["metadata"],
};
```

Edit-history-driven overrides (`applyEditToCell`, intelligent attachment merging
via `mergeAttachments`, audio-selection resolution via `resolveAudioSelection`)
then run on top.

### Why This Invariant Exists

In late-2025, a regression replaced this union spread with `{ ...ourCell }` plus
edit-history replay. That implicitly assumed all meaningful metadata changes were
tracked by edit-history entries. In practice that wasn't true — `attachments` for
audio recordings were written without edit-history entries, so any cell whose
`ourCell` lacked attachments would silently drop the `theirCell` attachments on
merge. This is exactly the gan-ji-an `.webm` data-loss incident.

### Enforcement

Three regression tests in
[src/test/suite/resolveCodexCustomMerge.test.ts](src/test/suite/resolveCodexCustomMerge.test.ts)
pin this invariant:

- `preserves theirs-only attachments when ours has none (the .webm case)`
- `preserves theirs-only data.milestoneIndex when ours has none`
- `ours wins on overlapping keys; non-overlapping keys union`

Plus two tests on the migration path which uses the same merge logic to dedupe
cells: `mergeDuplicateCellsUsingResolverLogic - union preservation`. If any of
these break, the invariant has been broken — do not "fix" the tests, fix the
merge logic.

### When Adding New Metadata Fields

If you add a new metadata field to a cell:

1. Prefer routing changes through `EditHistory` so they participate in edit
   replay during merge. Use `EditMapUtils.*` helpers.
2. If a field cannot reasonably be edit-tracked (e.g. content-addressed
   attachment dictionaries), the union-spread baseline above will preserve it
   on the unmodified side. **Add a regression test in `resolveCodexCustomMerge.test.ts`**
   asserting your field survives an ours-empty / theirs-full merge.
3. If a field has its own intelligent-merge logic (like `mergeAttachments`),
   ensure that logic is invoked AFTER the union spread in
   `mergeTwoCellsUsingResolverLogic`, not before.</contents>
</xai:function_call"> wrote to file "/Users/benjaminscholtens/Documents/clear_bible/codex-editor/TYPE_SAFE_EDITS.md

