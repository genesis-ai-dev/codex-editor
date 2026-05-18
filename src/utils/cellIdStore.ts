import * as vscode from "vscode";
import { EventEmitter } from "events";
import { CellIdGlobalState } from "../../types";

/**
 * File-backed replacement for the `project-accelerate.shared-state-store`
 * extension's `cellId` channel.
 *
 * Why this exists:
 * - shared-state-store persists everything to `globalState`, which lives in
 *   `state.vscdb` and is hydrated synchronously on activation. With many
 *   updates over time the row grew large enough to trigger VS Code's
 *   `mainThreadStorage` >5 MB warning.
 * - The only consumer of the `cellId` key is codex-editor itself, so we own
 *   the state internally and persist it to a small JSON file under
 *   `context.globalStorageUri` instead. This file is lazily loaded, so it
 *   adds zero activation cost and has no size warning.
 *
 * Cross-platform note: all paths come from `vscode.Uri.joinPath` and all I/O
 * goes through `vscode.workspace.fs`. There is no `path.join`, no SQLite
 * reach-in, and no native dependency.
 */

export type CellIdStateStoreUpdate = { key: "cellId"; value: CellIdGlobalState | undefined };
export type CellIdStateStoreKey = CellIdStateStoreUpdate["key"];
export type CellIdStateStoreValue<K extends CellIdStateStoreKey> = K extends "cellId" ? CellIdGlobalState : never;

type DisposeFunction = () => void;

interface StoreShape {
    cellId?: CellIdGlobalState;
}

export class LocalCellIdStore {
    private readonly fileUri: vscode.Uri;
    private readonly tmpUri: vscode.Uri;
    private readonly emitter = new EventEmitter();

    private cache: StoreShape | null = null;
    private loading: Promise<void> | null = null;

    private flushTimer: ReturnType<typeof setTimeout> | null = null;
    private flushPromise: Promise<void> | null = null;
    private dirty = false;

    /**
     * Tail of the chain of in-flight `update()` calls. Each `update()` queues
     * its in-memory mutation onto this chain so we have a single awaitable
     * that resolves once *all* pending mutations have been applied. `flushNow`
     * uses this to guarantee writes are observable in tests where callers
     * cannot await `update()` itself (its public API returns void).
     */
    private applyChain: Promise<void> = Promise.resolve();

    private static readonly FLUSH_DEBOUNCE_MS = 150;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.fileUri = vscode.Uri.joinPath(context.globalStorageUri, "state.json");
        this.tmpUri = vscode.Uri.joinPath(context.globalStorageUri, "state.json.tmp");
    }

    private async ensureLoaded(): Promise<void> {
        if (this.cache !== null) return;
        if (this.loading) {
            await this.loading;
            return;
        }
        this.loading = this.loadFromDisk();
        try {
            await this.loading;
        } finally {
            this.loading = null;
        }
    }

    private async loadFromDisk(): Promise<void> {
        try {
            const bytes = await vscode.workspace.fs.readFile(this.fileUri);
            const text = new TextDecoder("utf-8").decode(bytes);
            const parsed = JSON.parse(text);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                this.cache = parsed as StoreShape;
                return;
            }
        } catch {
            // File missing, unreadable, or malformed — start with empty state.
        }
        this.cache = {};
    }

    public async get<K extends CellIdStateStoreKey>(
        key: K
    ): Promise<CellIdStateStoreValue<K> | undefined> {
        await this.ensureLoaded();
        const value = (this.cache as StoreShape)[key];
        return value as CellIdStateStoreValue<K> | undefined;
    }

    /**
     * Fire-and-forget update. Matches the shape of the previous external
     * shared-state-store API (which also returned void). Persistence happens
     * asynchronously via a debounced flush to coalesce bursts of cell-click
     * updates into a single disk write.
     *
     * Updates are serialized onto `applyChain` so they apply in call order
     * even when the cache is still loading. `flushNow()` awaits that chain
     * to guarantee durability.
     */
    public update(payload: CellIdStateStoreUpdate): void {
        const next = this.applyChain
            .then(() => this.ensureLoaded())
            .then(() => this.applyUpdateToCache(payload));
        // Swallow rejections to keep the chain alive; log so failures aren't
        // silent. We re-assign with the catch'd promise so subsequent updates
        // chain onto a settled promise rather than a rejected one.
        this.applyChain = next.catch((err) => {
            console.error("[cellIdStore] update failed:", err);
        });
    }

    private applyUpdateToCache(payload: CellIdStateStoreUpdate): void {
        const cache = this.cache as StoreShape;
        const previous = cache[payload.key];

        if (payload.value === undefined) {
            delete cache[payload.key];
        } else {
            cache[payload.key] = payload.value;
        }

        const previousJson = previous === undefined ? undefined : JSON.stringify(previous);
        const nextJson = payload.value === undefined ? undefined : JSON.stringify(payload.value);

        // Always notify listeners, even when the value didn't change, to
        // preserve the previous external store's behaviour. Skip the disk
        // flush in that case — it would be a no-op.
        this.emitter.emit(payload.key, payload.value);

        if (previousJson !== nextJson) {
            this.dirty = true;
            this.scheduleFlush();
        }
    }

    public listen<K extends CellIdStateStoreKey>(
        key: K,
        callback: (value: CellIdStateStoreValue<K> | undefined) => void
    ): DisposeFunction {
        const handler = (value: CellIdStateStoreValue<K> | undefined) => {
            try {
                callback(value);
            } catch (e) {
                console.error("[cellIdStore] listener threw:", e);
            }
        };
        this.emitter.on(key, handler);
        return () => {
            this.emitter.off(key, handler);
        };
    }

    private scheduleFlush(): void {
        if (this.flushTimer) return;
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            void this.flush();
        }, LocalCellIdStore.FLUSH_DEBOUNCE_MS);
    }

    private async flush(): Promise<void> {
        if (!this.dirty) return;
        if (this.flushPromise) {
            // Coalesce concurrent flushes — wait for the in-flight one and
            // then re-evaluate (a new update may have arrived during it).
            await this.flushPromise;
            return this.flush();
        }
        this.flushPromise = this.doFlush();
        try {
            await this.flushPromise;
        } finally {
            this.flushPromise = null;
        }
    }

    private async doFlush(): Promise<void> {
        if (this.cache === null) return;
        // Snapshot first so concurrent updates after we serialize don't mark
        // us clean prematurely.
        this.dirty = false;
        const snapshot = JSON.stringify(this.cache, null, 2);
        try {
            await vscode.workspace.fs.createDirectory(this.context.globalStorageUri);
            const bytes = new TextEncoder().encode(`${snapshot}\n`);
            await vscode.workspace.fs.writeFile(this.tmpUri, bytes);
            await vscode.workspace.fs.rename(this.tmpUri, this.fileUri, { overwrite: true });
        } catch (err) {
            console.error("[cellIdStore] flush failed:", err);
            // Re-mark dirty so a future call retries.
            this.dirty = true;
        }
    }

    /**
     * Force any pending writes to disk immediately. Intended for tests and
     * for clean-shutdown paths where we want to guarantee durability.
     *
     * Awaits the in-memory `applyChain` first so any update() calls issued
     * synchronously before flushNow are guaranteed to be reflected on disk.
     */
    public async flushNow(): Promise<void> {
        await this.applyChain;
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        if (this.dirty || this.flushPromise) {
            await this.flush();
        }
    }

    /**
     * Test-only: synchronously drop the in-memory cache so the next read
     * re-loads from disk. Production code does not need this.
     */
    public _resetCacheForTests(): void {
        this.cache = null;
        this.loading = null;
    }
}
