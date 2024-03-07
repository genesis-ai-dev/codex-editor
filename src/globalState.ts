import * as vscode from "vscode";
import { VerseRefGlobalState, SelectedTextDataWithContext } from "../types";
type GlobalStateUpdate =
    | { key: "verseRef"; value: VerseRefGlobalState }
    | { key: "uri"; value: string }
    | { key: "currentLineSelection"; value: SelectedTextDataWithContext };

type GlobalStateKey = GlobalStateUpdate["key"];
type GlobalStateValue<K extends GlobalStateKey> = Extract<
    GlobalStateUpdate,
    { key: K }
>["value"];

const extensionId = "codex.shared-state-store";

let storeListener: <K extends GlobalStateKey>(
    keyForListener: K,
    callBack: (value: GlobalStateValue<K>) => void,
) => void;

let updateGlobalState: (update: GlobalStateUpdate) => void;

async function initializeGlobalState() {
    const extension = vscode.extensions.getExtension(extensionId);
    if (!extension) {
        console.log(`Extension ${extensionId} not found.`);
    } else {
        const api = await extension.activate();
        if (!api) {
            console.log(`Extension ${extensionId} does not expose an API.`);
        } else {
            storeListener = api.storeListener;
            updateGlobalState = api.updateStoreState;
        }
    }
}

initializeGlobalState().catch(console.error);

export { storeListener, updateGlobalState };
