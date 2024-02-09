import { EventEmitter } from "events";
class GlobalStateEmitter extends EventEmitter {}
import * as vscode from "vscode";
import { VerseRefGlobalState } from "../types";

const globalStateEmitter = new GlobalStateEmitter();

type GlobalStateUpdate =
    | { key: "verseRef"; value: VerseRefGlobalState }
    | { key: "uri"; value: string };

function updateGlobalState(
    context: vscode.ExtensionContext,
    update: GlobalStateUpdate,
): void {
    context.globalState.update(update.key, update.value).then(() => {
        console.log("Value changed", update);
        globalStateEmitter.emit("changed", update);
    });
}

export { globalStateEmitter, updateGlobalState };
