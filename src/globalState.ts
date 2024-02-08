import { EventEmitter } from "events";
class GlobalStateEmitter extends EventEmitter {}
import * as vscode from "vscode";

const globalStateEmitter = new GlobalStateEmitter();

function updateGlobalState(
    context: vscode.ExtensionContext,
    key: string,
    value: any,
): void {
    context.globalState.update(key, value).then(() => {
        console.log("Value changed", { key, value });
        globalStateEmitter.emit("changed", { key, value });
    });
}

export { globalStateEmitter, updateGlobalState };
