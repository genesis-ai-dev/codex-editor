import * as vscode from "vscode";
import { VerseRefGlobalState, SelectedTextDataWithContext } from "../types";
type GlobalStateUpdate =
    | { key: "verseRef"; value: VerseRefGlobalState }
    | { key: "uri"; value: string | null }
    | { key: "currentLineSelection"; value: SelectedTextDataWithContext };

type GlobalStateKey = GlobalStateUpdate["key"];
type GlobalStateValue<K extends GlobalStateKey> = Extract<
    GlobalStateUpdate,
    { key: K }
>["value"];

const extensionId = "project-accelerate.shared-state-store";

type DisposeFunction = () => void;
export async function initializeGlobalState() {
    let storeListener: <K extends GlobalStateKey>(
        keyForListener: K,
        callBack: (value: GlobalStateValue<K> | undefined) => void,
    ) => DisposeFunction = () => () => undefined;

    let updateGlobalState: (update: GlobalStateUpdate) => void = () =>
        undefined;
    let getStoreState: <K extends GlobalStateKey>(
        key: K,
    ) => Promise<GlobalStateValue<K> | undefined> = () =>
        Promise.resolve(undefined);

    const extension = vscode.extensions.getExtension(extensionId);
    if (extension) {
        const api = await extension.activate();
        if (!api) {
            console.log(`Extension ${extensionId} does not expose an API.`);
        } else {
            storeListener = api.storeListener;

            updateGlobalState = api.updateStoreState;
            getStoreState = api.getStoreState;
            return { storeListener, updateGlobalState, getStoreState };
        }
    }
    console.error(`Extension ${extensionId} not found.`);
    return {
        storeListener,
        updateGlobalState,
        getStoreState,
    };
}
