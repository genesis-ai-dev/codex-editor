import * as vscode from "vscode";

export function stateManager(context: vscode.ExtensionContext) {
  return {
    get,
    set,
  };

  function get<T>(stateKey: string): { [key: string]: T | undefined } {
    return {
      [stateKey]: context.globalState.get(stateKey),
    };
  }

  async function set<T>(stateKey: string, newStateValue: T): Promise<void> {
    await context.globalState.update(stateKey, newStateValue);
  }
}
