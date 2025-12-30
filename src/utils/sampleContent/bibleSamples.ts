import * as vscode from "vscode";

/**
 * Creates sample Bible translation content (USFM format)
 * Returns sample Genesis 1:1-5 as a codex notebook
 */
export async function createBibleSampleContent(
    workspaceFolder: vscode.Uri
): Promise<{ sourceUri: vscode.Uri; targetUri: vscode.Uri }> {
    console.log("[bibleSamples] Creating Bible sample content");
    // Source files go in .project/sourceTexts/
    const sourceDir = vscode.Uri.joinPath(workspaceFolder, ".project", "sourceTexts");
    // Target files go in files/target/
    const targetDir = vscode.Uri.joinPath(workspaceFolder, "files", "target");
    
    // Ensure directories exist
    try {
        await vscode.workspace.fs.createDirectory(sourceDir);
        await vscode.workspace.fs.createDirectory(targetDir);
    } catch {
        // Directories might already exist
    }
    
    // Create source notebook (Genesis 1:1-5 in USFM)
    const sourceContent = {
        cells: [
            {
                cell_type: "markdown",
                source: ["# Genesis 1:1-5"],
                metadata: {},
            },
            {
                cell_type: "markdown",
                source: ["\\id GEN\n\\h Genesis\n\\c 1\n\\p\n\\v 1 In the beginning God created the heavens and the earth."],
                metadata: { cell_type: "source" },
            },
            {
                cell_type: "markdown",
                source: ["\\v 2 Now the earth was formless and empty, darkness was over the surface of the deep, and the Spirit of God was hovering over the waters."],
                metadata: { cell_type: "source" },
            },
            {
                cell_type: "markdown",
                source: ["\\v 3 And God said, \"Let there be light,\" and there was light."],
                metadata: { cell_type: "source" },
            },
            {
                cell_type: "markdown",
                source: ["\\v 4 God saw that the light was good, and he separated the light from the darkness."],
                metadata: { cell_type: "source" },
            },
            {
                cell_type: "markdown",
                source: ["\\v 5 God called the light \"day,\" and the darkness he called \"night.\" And there was evening, and there was morning—the first day."],
                metadata: { cell_type: "source" },
            },
        ],
        metadata: {
            kernelspec: { display_name: "Codex", language: "codex", name: "codex" },
            language_info: { name: "codex" },
        },
    };

    // Create target notebook (empty for translation)
    const targetContent = {
        cells: [
            {
                cell_type: "markdown",
                source: ["# Genesis 1:1-5"],
                metadata: {},
            },
            {
                cell_type: "markdown",
                source: [""],
                metadata: { cell_type: "target" },
            },
            {
                cell_type: "markdown",
                source: [""],
                metadata: { cell_type: "target" },
            },
            {
                cell_type: "markdown",
                source: [""],
                metadata: { cell_type: "target" },
            },
            {
                cell_type: "markdown",
                source: [""],
                metadata: { cell_type: "target" },
            },
            {
                cell_type: "markdown",
                source: [""],
                metadata: { cell_type: "target" },
            },
        ],
        metadata: {
            kernelspec: { display_name: "Codex", language: "codex", name: "codex" },
            language_info: { name: "codex" },
        },
    };

    const sourceUri = vscode.Uri.joinPath(sourceDir, "01-GEN.source");
    const targetUri = vscode.Uri.joinPath(targetDir, "01-GEN.codex");

    try {
        await vscode.workspace.fs.writeFile(
            sourceUri,
            Buffer.from(JSON.stringify(sourceContent, null, 2), "utf-8")
        );
        console.log("[bibleSamples] Created source file:", sourceUri.fsPath);
        
        await vscode.workspace.fs.writeFile(
            targetUri,
            Buffer.from(JSON.stringify(targetContent, null, 2), "utf-8")
        );
        console.log("[bibleSamples] Created target file:", targetUri.fsPath);
    } catch (error) {
        console.error("[bibleSamples] Error writing files:", error);
        throw error;
    }

    return { sourceUri, targetUri };
}

