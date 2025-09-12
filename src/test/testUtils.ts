import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';

export async function createTestFile(fileName: string, content: string): Promise<vscode.Uri> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error('No workspace folder found');
    }

    const testFileUri = vscode.Uri.joinPath(workspaceFolder.uri, '.test', fileName);

    // Ensure test directory exists
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(workspaceFolder.uri, '.test'));

    // Write test file
    await vscode.workspace.fs.writeFile(testFileUri, Buffer.from(content, 'utf8'));

    return testFileUri;
}

export async function cleanupTestFile(fileUri: vscode.Uri): Promise<void> {
    try {
        await vscode.workspace.fs.delete(fileUri);
    } catch (error) {
        console.error(`Failed to cleanup test file: ${error}`);
    }
}

export function swallowDuplicateCommandRegistrations(): void {
    const originalRegister = vscode.commands.registerCommand;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vscode.commands as any).registerCommand = ((command: string, callback: (...args: any[]) => any) => {
        try {
            return originalRegister(command, callback);
        } catch (e: any) {
            if (e && String(e).includes('already exists')) {
                return { dispose: () => { } } as vscode.Disposable;
            }
            throw e;
        }
    }) as typeof vscode.commands.registerCommand;
}

export async function createTempFileWithContent(fileName: string, content: string): Promise<vscode.Uri> {
    const tmpDir = os.tmpdir();
    const filePath = path.join(tmpDir, fileName);
    const uri = vscode.Uri.file(filePath);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
    return uri;
}

export async function createTempCodexFile(fileName: string, jsonObject: unknown): Promise<vscode.Uri> {
    const content = JSON.stringify(jsonObject, null, 2);
    return createTempFileWithContent(fileName, content);
}

export async function deleteIfExists(uri: vscode.Uri): Promise<void> {
    try {
        await vscode.workspace.fs.delete(uri);
    } catch (_e) {
        // ignore
    }
}

export class MockMemento implements vscode.Memento {
    private storage = new Map<string, any>();
    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    get<T>(key: string, defaultValue?: T): T | undefined {
        return this.storage.get(key) ?? defaultValue;
    }
    update(key: string, value: any): Thenable<void> {
        this.storage.set(key, value);
        return Promise.resolve();
    }
    keys(): readonly string[] { return Array.from(this.storage.keys()); }
    setKeysForSync(_: readonly string[]): void { }
}

export function createMockExtensionContext(): vscode.ExtensionContext {
    // @ts-expect-error - partial context for tests
    const context: vscode.ExtensionContext = {
        extensionUri: vscode.Uri.file(__dirname),
        subscriptions: [],
        workspaceState: new MockMemento(),
        globalState: new MockMemento(),
    } as vscode.ExtensionContext;
    return context;
}

export type WebviewMessageCallback = (message: any) => void;

export function createMockWebviewPanel(options?: { keepFirstOnDidReceiveMessage?: boolean, cspSource?: string; }): {
    panel: vscode.WebviewPanel;
    onDidReceiveMessageRef: { current: WebviewMessageCallback | null; };
    lastPostedMessageRef: { current: any; };
} {
    const storedCallback: WebviewMessageCallback | null = null;
    const onDidReceiveMessageRef: { current: WebviewMessageCallback | null; } = { current: storedCallback };
    const lastPostedMessageRef = { current: null as any };
    const keepFirst = options?.keepFirstOnDidReceiveMessage ?? false;
    const cspSource = options?.cspSource ?? 'https://example.com';

    const webview: Partial<vscode.Webview> = {
        html: '',
        options: { enableScripts: true },
        asWebviewUri: (uri: vscode.Uri) => uri,
        cspSource,
        onDidReceiveMessage: (callback: WebviewMessageCallback) => {
            if (keepFirst && onDidReceiveMessageRef.current) {
                return { dispose: () => { } } as vscode.Disposable;
            }
            onDidReceiveMessageRef.current = callback;
            return { dispose: () => { } } as vscode.Disposable;
        },
        postMessage: async (message: any) => {
            lastPostedMessageRef.current = message;
            return Promise.resolve(true);
        },
    };

    const panel: vscode.WebviewPanel = {
        webview: webview as vscode.Webview,
        onDidDispose: (_cb?: () => void) => ({ dispose: () => { } }),
        onDidChangeViewState: (_cb?: any) => ({ dispose: () => { } }),
        reveal: () => { },
        dispose: () => { },
        active: true,
        visible: true,
        title: 'mock',
        viewColumn: vscode.ViewColumn.One,
    } as unknown as vscode.WebviewPanel;

    return { panel, onDidReceiveMessageRef, lastPostedMessageRef };
}

export async function primeProviderWorkspaceStateForHtml(provider: any, document: vscode.CustomDocument, preferredTab: string = 'source'): Promise<void> {
    await provider?.context?.workspaceState?.update?.(`chapter-cache-${document.uri.toString()}`, 1);
    await provider?.context?.workspaceState?.update?.(`codex-editor-preferred-tab`, preferredTab);
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
