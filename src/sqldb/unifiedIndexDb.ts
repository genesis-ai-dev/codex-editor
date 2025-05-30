import { Database } from "sql.js-fts5";
import * as vscode from "vscode";
import { getWorkSpaceUri } from "../utils";

// Path for the unified index database
const unifiedIndexDbPath = [".project", "indexes.sqlite"];

// Global variable to store the unified index database
let indexDatabase: Database | null = null;

/**
 * Initialize or load the unified index database
 */
export async function initializeUnifiedIndexDb(context?: vscode.ExtensionContext): Promise<Database | null> {
    try {
        const workspaceUri = getWorkSpaceUri();
        if (!workspaceUri) {
            console.error("No workspace found for unified index database");
            return null;
        }

        const dbPath = vscode.Uri.joinPath(workspaceUri, ...unifiedIndexDbPath);
        
        // Import sql.js-fts5 for FTS5 support in indexes
        const { default: initSqlJs } = await import("sql.js-fts5");
        
        // Get extension context
        const extensionContext = context || vscode.extensions.getExtension("project-accelerate.codex-editor-extension");
        if (!extensionContext?.extensionUri) {
            throw new Error("Extension context not available");
        }
        
        const sqlWasmPath = vscode.Uri.joinPath(extensionContext.extensionUri, "out", "sql-wasm.wasm");
        
        const SQL = await initSqlJs({
            locateFile: (file: string) => {
                console.log("Locating file:", file);
                return sqlWasmPath.fsPath;
            },
            wasmBinary: await vscode.workspace.fs.readFile(sqlWasmPath),
        });

        let fileBuffer: Uint8Array;

        try {
            // Try to load existing database
            fileBuffer = await vscode.workspace.fs.readFile(dbPath);
            console.log("📁 Loaded existing unified index database");
        } catch {
            // Create new empty database if file doesn't exist
            console.log("📁 Creating new unified index database");
            const newDb = new SQL.Database();
            fileBuffer = newDb.export();
            newDb.close();
            
            // Ensure .project directory exists
            await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(workspaceUri, ".project"));
        }

        // Create database from buffer
        indexDatabase = new SQL.Database(fileBuffer);
        console.log("✅ Unified index database initialized successfully");
        
        return indexDatabase;
    } catch (error) {
        console.error("❌ Error initializing unified index database:", error);
        return null;
    }
}

/**
 * Get the unified index database instance
 */
export function getUnifiedIndexDb(): Database | null {
    return indexDatabase;
}

/**
 * Save the unified index database to disk
 */
export async function saveUnifiedIndexDb(): Promise<void> {
    if (!indexDatabase) {
        console.warn("No unified index database to save");
        return;
    }

    try {
        const workspaceUri = getWorkSpaceUri();
        if (!workspaceUri) {
            console.error("No workspace found for saving unified index database");
            return;
        }

        const dbPath = vscode.Uri.joinPath(workspaceUri, ...unifiedIndexDbPath);
        
        // Export database to buffer
        const data = indexDatabase.export();
        
        // Ensure .project directory exists
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(workspaceUri, ".project"));
        
        // Write to file
        await vscode.workspace.fs.writeFile(dbPath, data);
        console.log("💾 Unified index database saved successfully");
    } catch (error) {
        console.error("❌ Error saving unified index database:", error);
        throw error;
    }
}

/**
 * Close the unified index database
 */
export function closeUnifiedIndexDb(): void {
    if (indexDatabase) {
        indexDatabase.close();
        indexDatabase = null;
        console.log("🔒 Unified index database closed");
    }
}

/**
 * Test if the unified index database is available and functional
 */
export function testUnifiedIndexDb(): boolean {
    if (!indexDatabase) {
        return false;
    }
    
    try {
        // Test basic functionality
        indexDatabase.exec("SELECT 1");
        return true;
    } catch {
        return false;
    }
} 