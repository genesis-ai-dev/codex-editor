import * as vscode from "vscode";

/**
 * Creates sample Open Bible Stories content
 * Returns sample Story 1 (Creation) as a codex notebook
 */
export async function createOBSSampleContent(
    workspaceFolder: vscode.Uri
): Promise<{ sourceUri: vscode.Uri; targetUri: vscode.Uri }> {
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

    // Create source notebook (OBS Story 1)
    const sourceContent = {
        cells: [
            {
                cell_type: "markdown",
                source: ["# Story 1: Creation"],
                metadata: {},
            },
            {
                cell_type: "markdown",
                source: ["## Introduction\n\nThis is the story of how God created everything."],
                metadata: { cell_type: "source" },
            },
            {
                cell_type: "markdown",
                source: ["In the beginning, there was nothing except God. Then God created everything in the universe simply by speaking."],
                metadata: { cell_type: "source" },
            },
            {
                cell_type: "markdown",
                source: ["God created light and darkness, the sky and the sea, and the land. He also made the sun, moon, and stars."],
                metadata: { cell_type: "source" },
            },
            {
                cell_type: "markdown",
                source: ["Then God made all the birds, fish, and land animals. Finally, God created people. He made them in his own image so they could be like him."],
                metadata: { cell_type: "source" },
            },
            {
                cell_type: "markdown",
                source: ["God was very pleased with everything he made. After six days, God had finished making everything. On the seventh day, God rested."],
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
                source: ["# Story 1: Creation"],
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

    const sourceUri = vscode.Uri.joinPath(sourceDir, "01-creation.source");
    const targetUri = vscode.Uri.joinPath(targetDir, "01-creation.codex");

    await vscode.workspace.fs.writeFile(
        sourceUri,
        Buffer.from(JSON.stringify(sourceContent, null, 2), "utf-8")
    );
    await vscode.workspace.fs.writeFile(
        targetUri,
        Buffer.from(JSON.stringify(targetContent, null, 2), "utf-8")
    );

    return { sourceUri, targetUri };
}

