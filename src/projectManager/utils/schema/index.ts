import type { ValidationEntry } from "../../../../types";
import { migrate_v0_to_v1 } from "./migrations/v0_to_v1";

/**
 * Notebook schema versioning.
 *
 * Every `.codex` and `.source` notebook on disk carries `metadata.schemaVersion: number`
 * (files written before this system existed are treated as v0). The `migrations` map
 * is a ladder: `migrations[N]` takes a notebook **at v(N-1)** and produces v(N) in place.
 *
 * Going v0 → vK runs `migrations[1]`, `migrations[2]`, ..., `migrations[K]` in order.
 *
 * Single entry point: `bringNotebookToCurrent(notebook, ctx)`. Idempotent — when the
 * notebook is already at `CURRENT_SCHEMA_VERSION` it short-circuits and returns
 * `migrated: false` so callers can skip the disk write.
 */

export const CURRENT_SCHEMA_VERSION = 1;

/* ── Structural notebook types used by the ladder ───────────────────────────── */

/**
 * Edit-history entry as it might appear on disk.
 *
 * The schema ladder operates on un-normalized notebooks — files may be at v0,
 * v1, or future shapes. This interface is intentionally a structural superset
 * that covers every variant the ladder needs to read or rewrite, with an index
 * signature so unrelated fields a future step might add (e.g. `generationId`)
 * round-trip untouched.
 */
export interface SchemaEdit {
    /** Modern: deterministic SHA-256 / UUID id. */
    id?: string;
    /** Modern: path into the cell/metadata tree the edit applies to. */
    editMap?: readonly string[];
    value?: unknown;
    /**
     * Legacy (pre-editMap): the value lived here without an editMap. v0 → v1
     * rewrites this into `value` + `editMap = ["value"]`.
     */
    cellValue?: unknown;
    timestamp?: number;
    type?: string;
    author?: string;
    /** Preview-only edits (e.g. LLM previews) aren't applied to cell.value. */
    preview?: boolean;
    validatedBy?: ValidationEntry[];
    /** Pass-through for fields a future ladder step might add. */
    [key: string]: unknown;
}

export interface SchemaCellMetadata {
    id?: string;
    type?: string;
    /** Optional pointer at the edit whose value matches `cell.value`. */
    activeEditId?: string;
    edits?: SchemaEdit[];
    [key: string]: unknown;
}

export interface SchemaCell {
    kind?: number;
    languageId?: string;
    /**
     * Modern: a string. Future ladder steps may flatten/transform other shapes
     * back to a string here.
     */
    value?: unknown;
    metadata?: SchemaCellMetadata;
    [key: string]: unknown;
}

export interface SchemaNotebookMetadata {
    /** On-disk schema version. Missing → 0. */
    schemaVersion?: number;
    /** File-level edits (e.g. metadata.fontSize edits). */
    edits?: SchemaEdit[];
    [key: string]: unknown;
}

export interface SchemaNotebook {
    cells?: SchemaCell[];
    metadata?: SchemaNotebookMetadata;
    [key: string]: unknown;
}

/* ── Ladder ────────────────────────────────────────────────────────────────── */

/** Context passed to every ladder step (e.g. for deterministic id generation). */
export interface SchemaMigrationContext {
    /** Username to attribute synthesized edits to when the source edit lacks an author. */
    author: string;
}

export type SchemaMigration = (
    notebook: SchemaNotebook,
    ctx: SchemaMigrationContext
) => Promise<void> | void;

/**
 * Ladder registry. Add new entries here when the on-disk shape changes:
 *   migrations[2] = migrate_v1_to_v2;   // bumps CURRENT_SCHEMA_VERSION too.
 */
const migrations: Record<number, SchemaMigration> = {
    1: migrate_v0_to_v1,
};

/** Reads `metadata.schemaVersion` defensively; missing/non-numeric → 0. */
export function getSchemaVersion(notebook: SchemaNotebook): number {
    const raw = notebook.metadata?.schemaVersion;
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 0;
}

export interface BringToCurrentResult {
    migrated: boolean;
    from: number;
    to: number;
    /**
     * True when the file is at a version newer than this build understands. Callers
     * should treat the file as opaque and avoid rewriting it. Merge resolution can
     * still proceed best-effort — unknown fields pass through untouched.
     */
    aheadOfClient: boolean;
}

/**
 * Brings a parsed notebook to `CURRENT_SCHEMA_VERSION` in place.
 *
 * - No-op when already current → `migrated: false`, no field writes.
 * - When the file is ahead of this client (`schemaVersion > CURRENT_SCHEMA_VERSION`),
 *   logs a warning and returns `aheadOfClient: true` without modifying the notebook.
 *   We never downgrade — there's no inverse ladder.
 */
export async function bringNotebookToCurrent(
    notebook: SchemaNotebook,
    ctx: SchemaMigrationContext
): Promise<BringToCurrentResult> {
    const from = getSchemaVersion(notebook);

    if (from > CURRENT_SCHEMA_VERSION) {
        console.warn(
            `[schema] Notebook reports schemaVersion=${from} but client only understands up to ${CURRENT_SCHEMA_VERSION}. Leaving file untouched.`
        );
        return { migrated: false, from, to: from, aheadOfClient: true };
    }

    if (from >= CURRENT_SCHEMA_VERSION) {
        return { migrated: false, from, to: from, aheadOfClient: false };
    }

    for (let v = from + 1; v <= CURRENT_SCHEMA_VERSION; v++) {
        const step = migrations[v];
        if (!step) {
            throw new Error(
                `[schema] Missing ladder step for version ${v}. Cannot bring notebook from v${from} to v${CURRENT_SCHEMA_VERSION}.`
            );
        }
        await step(notebook, ctx);
    }

    if (!notebook.metadata) {
        notebook.metadata = {};
    }
    notebook.metadata.schemaVersion = CURRENT_SCHEMA_VERSION;

    return { migrated: true, from, to: CURRENT_SCHEMA_VERSION, aheadOfClient: false };
}
