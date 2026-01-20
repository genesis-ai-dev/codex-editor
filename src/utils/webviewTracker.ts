import * as vscode from "vscode";

type WebviewKind = "panel" | "view";

type WebviewEntry = {
    id: string;
    kind: WebviewKind;
    viewType: string;
    title?: string;
    createdAt: number;
    source?: string;
};

const entries = new Map<string, WebviewEntry>();
let counter = 0;
let outputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel("Codex Webviews");
    }
    return outputChannel;
}

function log(line: string): void {
    getOutputChannel().appendLine(line);
}

export function trackWebviewPanel(
    panel: vscode.WebviewPanel,
    viewType: string,
    source?: string
): string {
    const id = `${viewType}:${++counter}`;
    const entry: WebviewEntry = {
        id,
        kind: "panel",
        viewType,
        title: panel.title,
        createdAt: Date.now(),
        source,
    };
    entries.set(id, entry);
    log(`[create][panel] ${entry.viewType} id=${id} title="${entry.title}" source=${source ?? "unknown"}`);
    panel.onDidDispose(() => {
        entries.delete(id);
        log(`[dispose][panel] ${entry.viewType} id=${id}`);
    });
    return id;
}

export function trackWebviewView(
    view: vscode.WebviewView,
    viewType: string,
    source?: string
): string {
    const id = `${viewType}:${++counter}`;
    const entry: WebviewEntry = {
        id,
        kind: "view",
        viewType,
        createdAt: Date.now(),
        source,
    };
    entries.set(id, entry);
    log(`[create][view] ${entry.viewType} id=${id} source=${source ?? "unknown"}`);
    view.onDidDispose(() => {
        entries.delete(id);
        log(`[dispose][view] ${entry.viewType} id=${id}`);
    });
    return id;
}

export function dumpActiveWebviews(): void {
    const channel = getOutputChannel();
    channel.appendLine("---- Active webviews ----");
    if (entries.size === 0) {
        channel.appendLine("(none)");
        channel.show(true);
        return;
    }
    const sorted = Array.from(entries.values()).sort((a, b) => a.createdAt - b.createdAt);
    for (const entry of sorted) {
        const ageMs = Date.now() - entry.createdAt;
        const ageSec = Math.round(ageMs / 1000);
        channel.appendLine(
            `[active][${entry.kind}] ${entry.viewType} id=${entry.id} age=${ageSec}s` +
            (entry.title ? ` title="${entry.title}"` : "") +
            (entry.source ? ` source=${entry.source}` : "")
        );
    }
    channel.show(true);
}
