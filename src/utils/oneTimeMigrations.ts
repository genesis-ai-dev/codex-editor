import * as vscode from "vscode";

/**
 * Tiny persistence layer for "I have run this one-shot bookkeeping task" flags.
 *
 * The flags live as JSON inside the extension's `globalStorageUri` so they
 * never contribute to `state.vscdb` and are not subject to the
 * `mainThreadStorage` size warning.
 *
 * The file shape is `{ [migrationId]: { ranAt: ISOString } }`.
 *
 * A flag is set only after the migration body resolves successfully. If the
 * body throws, the flag is left unset so the next activation retries.
 */

interface MigrationFlag {
    ranAt: string;
}

type MigrationFlags = Record<string, MigrationFlag>;

const FLAGS_FILE = "migrations.json";
const FLAGS_TMP_FILE = "migrations.json.tmp";

function flagsUri(context: vscode.ExtensionContext): vscode.Uri {
    return vscode.Uri.joinPath(context.globalStorageUri, FLAGS_FILE);
}

function tmpFlagsUri(context: vscode.ExtensionContext): vscode.Uri {
    return vscode.Uri.joinPath(context.globalStorageUri, FLAGS_TMP_FILE);
}

export async function loadFlags(context: vscode.ExtensionContext): Promise<MigrationFlags> {
    try {
        const bytes = await vscode.workspace.fs.readFile(flagsUri(context));
        const text = new TextDecoder("utf-8").decode(bytes);
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as MigrationFlags;
        }
        return {};
    } catch {
        // File missing or unreadable — treat as empty.
        return {};
    }
}

async function writeFlags(context: vscode.ExtensionContext, flags: MigrationFlags): Promise<void> {
    await vscode.workspace.fs.createDirectory(context.globalStorageUri);
    const finalUri = flagsUri(context);
    const tmpUri = tmpFlagsUri(context);
    const bytes = new TextEncoder().encode(`${JSON.stringify(flags, null, 2)}\n`);
    // Atomic write: write to a temp sibling, then rename onto the final path.
    // VS Code's `rename({ overwrite: true })` normalizes Windows vs POSIX rename
    // semantics, so this works identically across platforms.
    await vscode.workspace.fs.writeFile(tmpUri, bytes);
    await vscode.workspace.fs.rename(tmpUri, finalUri, { overwrite: true });
}

export async function setFlag(context: vscode.ExtensionContext, id: string): Promise<void> {
    const flags = await loadFlags(context);
    flags[id] = { ranAt: new Date().toISOString() };
    await writeFlags(context, flags);
}

export async function isFlagSet(context: vscode.ExtensionContext, id: string): Promise<boolean> {
    const flags = await loadFlags(context);
    return Boolean(flags[id]);
}

/**
 * Runs `fn` exactly once across all activations of the extension. The
 * "ran successfully" mark is persisted under
 * `${globalStorageUri}/migrations.json`.
 *
 * If `fn` throws, the flag is NOT set so the next activation retries. The
 * thrown error is rethrown to the caller so it can decide whether to log,
 * surface a UI error, or silently continue.
 */
export async function runOnce(
    context: vscode.ExtensionContext,
    id: string,
    fn: () => Promise<void>
): Promise<void> {
    const flags = await loadFlags(context);
    if (flags[id]) return;

    await fn();

    flags[id] = { ranAt: new Date().toISOString() };
    await writeFlags(context, flags);
}
