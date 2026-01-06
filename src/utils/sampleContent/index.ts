import * as vscode from "vscode";
import { createGenesisSampleContent } from "./genesisSample";

export type ProjectType = "bible" | "subtitles" | "obs" | "documents" | "other";

export { createGenesisSampleContent } from "./genesisSample";

/**
 * Creates sample content based on selected project types
 * Currently only supports Bible (Genesis) sample generation
 */
export async function createSampleContent(
    workspaceFolder: vscode.Uri,
    projectTypes: ProjectType[]
): Promise<void> {
    console.log("[createSampleContent] Starting with types:", projectTypes);
    console.log("[createSampleContent] Workspace folder:", workspaceFolder.fsPath);
    
    // Ensure files directory exists
    const filesDir = vscode.Uri.joinPath(workspaceFolder, "files");
    try {
        await vscode.workspace.fs.createDirectory(filesDir);
        console.log("[createSampleContent] Created/verified files directory:", filesDir.fsPath);
    } catch (error) {
        console.log("[createSampleContent] Files directory already exists or error:", error);
    }

    // Currently only Bible (Genesis) sample is supported
    // Other types are reserved for future implementation
    if (projectTypes.includes("bible")) {
        console.log("[createSampleContent] Creating Genesis sample");
        await createGenesisSampleContent(workspaceFolder);
        console.log("[createSampleContent] Genesis sample created successfully");
    } else {
        console.log("[createSampleContent] No supported project types found. Only 'bible' is currently supported.");
    }
}

