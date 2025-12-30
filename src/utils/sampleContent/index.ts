import * as vscode from "vscode";
import { createBibleSampleContent } from "./bibleSamples";
import { createSubtitleSampleContent } from "./subtitleSamples";
import { createOBSSampleContent } from "./obsSamples";
import { createDocumentSampleContent } from "./documentSamples";

export type ProjectType = "bible" | "subtitles" | "obs" | "documents" | "other";

export { createBibleSampleContent } from "./bibleSamples";
export { createSubtitleSampleContent } from "./subtitleSamples";
export { createOBSSampleContent } from "./obsSamples";
export { createDocumentSampleContent } from "./documentSamples";

/**
 * Creates sample content based on selected project types
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

    // Create sample content for each selected type
    const promises: Promise<any>[] = [];

    if (projectTypes.includes("bible")) {
        console.log("[createSampleContent] Adding bible sample");
        promises.push(createBibleSampleContent(workspaceFolder));
    }

    if (projectTypes.includes("subtitles")) {
        console.log("[createSampleContent] Adding subtitles sample");
        promises.push(createSubtitleSampleContent(workspaceFolder));
    }

    if (projectTypes.includes("obs")) {
        console.log("[createSampleContent] Adding OBS sample");
        promises.push(createOBSSampleContent(workspaceFolder));
    }

    if (projectTypes.includes("documents")) {
        console.log("[createSampleContent] Adding documents sample");
        promises.push(createDocumentSampleContent(workspaceFolder));
    }

    console.log("[createSampleContent] Total promises to execute:", promises.length);
    
    // Wait for all sample content to be created
    try {
        await Promise.all(promises);
        console.log("[createSampleContent] All sample content created successfully");
    } catch (error) {
        console.error("[createSampleContent] Error creating sample content:", error);
        throw error;
    }
}

