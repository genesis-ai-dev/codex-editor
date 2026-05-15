import * as vscode from "vscode";
import { CellIdGlobalState } from "../types";
import { LocalCellIdStore } from "./utils/cellIdStore";

/**
 * State store for cross-component cell-id coordination.
 *
 * Historically this delegated to the external `project-accelerate.shared-state-store`
 * extension, which persisted everything to `globalState`. That row grew large
 * enough to trigger VS Code's `mainThreadStorage` size warning, so we now own
 * the persistence ourselves via a small JSON file under
 * `context.globalStorageUri` (see `LocalCellIdStore`). The returned API shape
 * is unchanged so existing consumers do not need to be updated.
 */

type StateStoreUpdate =
    | { key: "cellId"; value: CellIdGlobalState | undefined; };

type StateStoreKey = StateStoreUpdate["key"];
type StateStoreValue<K extends StateStoreKey> = K extends "cellId" ? CellIdGlobalState : never;

type DisposeFunction = () => void;

let storeInstance: LocalCellIdStore | null = null;

/**
 * Constructs (or reuses) the singleton state store. Should be called once at
 * activation with the extension context. Subsequent calls without a context
 * return the existing instance.
 *
 * If callers somehow invoke this before activation has set up the context,
 * we return a no-op store that mirrors the public shape so call sites do
 * not need defensive null-checks.
 */
export async function initializeStateStore(context?: vscode.ExtensionContext) {
    if (!storeInstance) {
        if (!context) {
            console.error(
                "[stateStore] initializeStateStore called before extension context was provided; returning a no-op store."
            );
            return makeNoopStore();
        }
        storeInstance = new LocalCellIdStore(context);
    }

    const store = storeInstance;
    return {
        storeListener: <K extends StateStoreKey>(
            keyForListener: K,
            callBack: (value: StateStoreValue<K> | undefined) => void
        ): DisposeFunction => store.listen(keyForListener, callBack),

        updateStoreState: (update: StateStoreUpdate): void => {
            store.update(update);
        },

        getStoreState: <K extends StateStoreKey>(
            key: K
        ): Promise<StateStoreValue<K> | undefined> => store.get(key),
    };
}

function makeNoopStore() {
    const dispose: DisposeFunction = () => undefined;
    return {
        storeListener: <K extends StateStoreKey>(
            _keyForListener: K,
            _callBack: (value: StateStoreValue<K> | undefined) => void
        ): DisposeFunction => dispose,
        updateStoreState: (_update: StateStoreUpdate): void => undefined,
        getStoreState: <K extends StateStoreKey>(
            _key: K
        ): Promise<StateStoreValue<K> | undefined> => Promise.resolve(undefined),
    };
}

/**
 * Test-only: clear the singleton so each test can construct a fresh store
 * with its own ExtensionContext fixture. Production code does not call this.
 */
export function _resetStateStoreForTests(): void {
    storeInstance = null;
}
