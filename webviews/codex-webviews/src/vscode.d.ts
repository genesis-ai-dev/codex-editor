declare module "vscode" {
    export interface WebviewApi<T> {
        postMessage(message: T): void;
        getState(): T | undefined;
        setState(state: T): void;
    }

    export function acquireVsCodeApi<T>(): WebviewApi<T>;
}
