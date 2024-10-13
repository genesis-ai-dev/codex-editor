import { EventEmitter } from "events";
import * as vscode from "vscode";
class WorkspaceStateEmitter extends EventEmitter {}
const workspaceStateEmitter = new WorkspaceStateEmitter();

type WorkspaceStateUpdate = { key: string; value: any };
function updateWorkspaceState(
    context: vscode.ExtensionContext,
    update: WorkspaceStateUpdate
): void {
    context.workspaceState.update(update.key, update.value).then(() => {
        workspaceStateEmitter.emit("changed", update);
    });
}

async function getWorkspaceState(
    context: vscode.ExtensionContext,
    key: "cellToJumpTo"
): Promise<any> {
    const value = await context.workspaceState.get(key);
    return value;
}

const workspaceStoreListener = (keyForListener: string, callBack: (value: any) => void) => {
    // Define the listener function with a reference so it can be removed later
    const listener = ({ key, value }: { key: string; value: any }) => {
        if (key === keyForListener) {
            callBack(value);
        }
    };

    // Add the listener to the globalStateEmitter
    workspaceStateEmitter.on("changed", listener);

    // Return a disposal function that removes the listener
    const dispose = () => {
        workspaceStateEmitter.removeListener("changed", listener);
    };

    // Optionally, if you want the listener to be automatically removed upon extension deactivation,
    // you can add the dispose function to context.subscriptions.
    // context.subscriptions.push({ dispose });

    // Return the dispose function so it can be called to remove the listener manually if needed
    return dispose;
};

export { updateWorkspaceState, workspaceStoreListener, getWorkspaceState };
