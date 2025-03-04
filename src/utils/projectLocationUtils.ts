import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";

/**
 * Gets the path to the .codex-projects directory in the user's home directory.
 * Creates the directory if it doesn't exist.
 */
export async function getCodexProjectsDirectory(): Promise<vscode.Uri> {
    // Get user's home directory
    const homeDir = os.homedir();
    const codexProjectsDir = path.join(homeDir, '.codex-projects');
    const codexProjectsDirUri = vscode.Uri.file(codexProjectsDir);
    
    try {
        // Check if directory exists
        await vscode.workspace.fs.stat(codexProjectsDirUri);
    } catch {
        // Directory doesn't exist, create it
        await vscode.workspace.fs.createDirectory(codexProjectsDirUri);
        console.log(`Created .codex-projects directory at ${codexProjectsDir}`);
    }
    
    return codexProjectsDirUri;
}

/**
 * Ensures the .codex-projects directory is in the watched folders list
 */
export async function ensureCodexProjectsDirInWatchedFolders(): Promise<void> {
    const codexProjectsDir = await getCodexProjectsDirectory();
    const config = vscode.workspace.getConfiguration("codex-project-manager");
    const watchedFolders = config.get<string[]>("watchedFolders") || [];
    
    if (!watchedFolders.includes(codexProjectsDir.fsPath)) {
        const updatedFolders = [...watchedFolders, codexProjectsDir.fsPath];
        await config.update(
            "watchedFolders",
            updatedFolders,
            vscode.ConfigurationTarget.Global
        );
        console.log("Added .codex-projects directory to watched folders");
    }
} 