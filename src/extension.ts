import * as vscode from "vscode";
import { registerTextSelectionHandler } from "./handlers/textSelectionHandler";
import { registerReferencesCodeLens } from "./referencesCodeLensProvider";
import { registerSourceCodeLens } from "./sourceCodeLensProvider";
import { indexVerseRefsInSourceText } from "./commands/indexVrefsCommand";
import { registerProviders } from "./providers/registerProviders";
import { registerCommands } from "./activationHelpers/contextAware/commands";
import { initializeWebviews } from "./activationHelpers/contextAware/webviewInitializers";
import { registerCompletionsCodeLensProviders } from "./activationHelpers/contextAware/completionsCodeLensProviders";
import { initializeBibleData } from "./activationHelpers/contextAware/sourceData";
import { registerLanguageServer } from "./tsServer/registerLanguageServer";
import { registerClientCommands } from "./tsServer/registerClientCommands";
import registerClientOnRequests from "./tsServer/registerClientOnRequests";
import { registerSmartEditCommands } from "./smartEdits/registerSmartEditCommands";
import { LanguageClient } from "vscode-languageclient/node";
import { registerProjectManager } from "./projectManager";
import {
    temporaryMigrationScript_checkMatthewNotebook,
    migration_changeDraftFolderToFilesFolder,
} from "./projectManager/utils/migrationUtils";
import { createIndexWithContext } from "./activationHelpers/contextAware/miniIndex/indexes";
import { registerSourceUploadCommands } from "./providers/SourceUpload/registerCommands";
import { migrateSourceFiles } from "./utils/codexNotebookUtils";
import { VideoEditorProvider } from "./providers/VideoEditor/VideoEditorProvider";
import { registerVideoPlayerCommands } from "./providers/VideoPlayer/registerCommands";
import { SourceUploadProvider } from "./providers/SourceUpload/SourceUploadProvider";
import { StatusBarItem } from "vscode";
import initSqlJs, { Database, SqlJsStatic } from "sql.js";
import path from "path";

let client: LanguageClient | undefined;
let clientCommandsDisposable: vscode.Disposable;
let autoCompleteStatusBarItem: StatusBarItem;
let db: Database;

function getDefinitions(db: Database, word: string): string[] {
    const stmt = db.prepare("SELECT definition FROM entries WHERE word = ?");
    stmt.bind([word]);

    const results: string[] = [];
    while (stmt.step()) {
        const row = stmt.getAsObject();
        results.push(row["definition"] as string);
    }
    stmt.free();
    return results;
}

async function lookupWord() {
    try {
        const word = await vscode.window.showInputBox({ prompt: "Enter a word to look up" });
        if (word) {
            const definitions = getDefinitions(db, word);
            if (definitions.length > 0) {
                await vscode.window.showQuickPick(definitions, {
                    placeHolder: `Definitions for "${word}"`,
                });
            } else {
                vscode.window.showInformationMessage(`No definitions found for "${word}".`);
            }
        }
    } catch (error) {
        vscode.window.showErrorMessage(`An error occurred: ${(error as Error).message}`);
    }
}
export async function activate(context: vscode.ExtensionContext) {
    // Initialize sql.js

    console.log("Activating extension");
    let SQL: SqlJsStatic | undefined;
    try {
        const sqlWasmPath = vscode.Uri.joinPath(context.extensionUri, "out", "sql-wasm.wasm");
        console.log("SQL WASM Path:", sqlWasmPath.fsPath);

        SQL = await initSqlJs({
            locateFile: (file: string) => {
                console.log("Locating file:", file);
                return sqlWasmPath.fsPath;
            },
            // Add this to ensure proper module loading
            wasmBinary: await vscode.workspace.fs.readFile(sqlWasmPath),
        });

        if (!SQL) {
            throw new Error("Failed to initialize SQL.js");
        }

        console.log("SQL.js initialized successfully");
    } catch (error) {
        console.error("Error initializing sql.js:", error);
        vscode.window.showErrorMessage(`Failed to initialize SQL.js: ${error}`);
        return;
    }

    // Load or create the database file
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage("No workspace folder found");
        return;
    }
    const dbPath = vscode.Uri.joinPath(workspaceFolder.uri, "data", "dictionary.sqlite");

    let fileBuffer: Uint8Array;
    try {
        // Try to read existing database
        fileBuffer = await vscode.workspace.fs.readFile(dbPath);
    } catch {
        // If file doesn't exist, create new database
        const newDb = new SQL.Database();
        // Create your table structure
        newDb.run(`
            CREATE TABLE entries (
                word TEXT PRIMARY KEY,
                definition TEXT NOT NULL
            );
        `);
        // Save the new database to file
        fileBuffer = newDb.export();
        // Ensure data directory exists
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(workspaceFolder.uri, "data"));
        await vscode.workspace.fs.writeFile(dbPath, fileBuffer);
    }

    // Create/load the database
    db = new SQL.Database(fileBuffer);
    // Register commands

    const disposable = vscode.commands.registerCommand("extension.lookupWord", lookupWord);
    context.subscriptions.push(disposable);

    vscode.workspace.getConfiguration().update("workbench.startupEditor", "none", true);

    // Register trust change listener
    context.subscriptions.push(
        vscode.workspace.onDidGrantWorkspaceTrust(async () => {
            console.log("Workspace trust granted, reactivating extension");
            await vscode.commands.executeCommand("workbench.action.reloadWindow");
        })
    );

    const fs = vscode.workspace.fs;
    const workspaceFolders = vscode.workspace.workspaceFolders;

    // Always register the project manager
    registerProjectManager(context);

    if (workspaceFolders && workspaceFolders.length > 0) {
        if (!vscode.workspace.isTrusted) {
            console.log("Workspace not trusted. Waiting for trust...");
            vscode.window
                .showWarningMessage(
                    "This workspace needs to be trusted before Codex Editor can fully activate.",
                    "Trust Workspace"
                )
                .then((selection) => {
                    if (selection === "Trust Workspace") {
                        vscode.commands.executeCommand("workbench.action.trustWorkspace");
                    }
                });
            return;
        }

        const metadataUri = vscode.Uri.joinPath(workspaceFolders[0].uri, "metadata.json");

        let metadataExists = false;
        try {
            await fs.stat(metadataUri);
            metadataExists = true;
        } catch {
            metadataExists = false;
        }

        if (!metadataExists) {
            console.log("metadata.json not found. Waiting for initialization.");
            await watchForInitialization(context, metadataUri);
        } else {
            await initializeExtension(context, metadataExists);
        }
    } else {
        console.log("No workspace folder found");
        vscode.commands.executeCommand("codex-project-manager.showProjectOverview");
    }

    // Register these commands regardless of metadata existence
    registerVideoPlayerCommands(context);
    registerSmartEditCommands(context); // For the language server onRequest stuff
    await registerSourceUploadCommands(context);
    registerProviders(context);
    await registerCommands(context);
    await initializeWebviews(context);

    await executeCommandsAfter();
    await temporaryMigrationScript_checkMatthewNotebook();
    await migration_changeDraftFolderToFilesFolder();
    await migrateSourceFiles();

    // Create the status bar item
    autoCompleteStatusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    autoCompleteStatusBarItem.text = "$(sync~spin) Auto-completing...";
    autoCompleteStatusBarItem.hide();
    context.subscriptions.push(autoCompleteStatusBarItem);
}

async function initializeExtension(context: vscode.ExtensionContext, metadataExists: boolean) {
    console.log("Initializing extension");

    if (metadataExists) {
        console.log("metadata.json exists");
        vscode.commands.executeCommand("codex-project-manager.showProjectOverview");

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const relativePattern = new vscode.RelativePattern(workspaceFolders[0], "**/*.codex");
            const codexNotebooksUris = await vscode.workspace.findFiles(relativePattern);
            if (codexNotebooksUris.length === 0) {
                vscode.commands.executeCommand("codex-project-manager.openSourceUpload");
            }
        } else {
            console.log("No workspace folder found");
        }

        registerCodeLensProviders(context);
        registerTextSelectionHandler(context, () => undefined);
        await initializeBibleData(context);

        client = await registerLanguageServer(context);

        if (client) {
            clientCommandsDisposable = registerClientCommands(context, client);
            await registerClientOnRequests(client); // So that the language server thread can interface with the main extension commands
            context.subscriptions.push(clientCommandsDisposable);
        }

        await indexVerseRefsInSourceText();
        await createIndexWithContext(context);
    } else {
        console.log("metadata.json not found. Showing project overview.");
        vscode.commands.executeCommand("codex-project-manager.showProjectOverview");
    }
}

let watcher: vscode.FileSystemWatcher | undefined;

async function watchForInitialization(context: vscode.ExtensionContext, metadataUri: vscode.Uri) {
    const fs = vscode.workspace.fs;
    watcher = vscode.workspace.createFileSystemWatcher("**/*");

    const checkInitialization = async () => {
        let metadataExists = false;
        try {
            await fs.stat(metadataUri);
            metadataExists = true;
        } catch {
            metadataExists = false;
        }

        if (metadataExists) {
            watcher?.dispose();
            await initializeExtension(context, metadataExists);
        }
    };

    watcher.onDidCreate(checkInitialization);
    watcher.onDidChange(checkInitialization);
    watcher.onDidDelete(checkInitialization);

    context.subscriptions.push(watcher);

    // Show project overview immediately, don't wait for metadata
    vscode.commands.executeCommand("codex-project-manager.showProjectOverview");
}

function registerCodeLensProviders(context: vscode.ExtensionContext) {
    registerReferencesCodeLens(context);
    registerSourceCodeLens(context);
    registerCompletionsCodeLensProviders(context);
}

async function executeCommandsAfter() {
    vscode.commands.executeCommand("workbench.action.focusAuxiliaryBar");
    vscode.commands.executeCommand("codexNotebookTreeView.refresh");
    vscode.commands.executeCommand("codex-editor-extension.setEditorFontToTargetLanguage");
}

export function deactivate() {
    if (clientCommandsDisposable) {
        clientCommandsDisposable.dispose();
    }
    if (client) {
        return client.stop();
    }
    if (db) {
        db.close();
    }
}

export function getAutoCompleteStatusBarItem(): StatusBarItem {
    return autoCompleteStatusBarItem;
}
