/**
 * Manual test to verify document structure preservation
 * Run this after importing a DOCX file to check if structure is preserved
 */

const vscode = require("vscode");
const path = require("path");

async function testStructurePreservation() {
    console.log("=== Document Structure Preservation Test ===");

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        console.error("No workspace folder found");
        return;
    }

    try {
        // Find the most recently created .source file
        const sourceFiles = await vscode.workspace.findFiles(".project/sourceTexts/*.source");
        if (sourceFiles.length === 0) {
            console.log("No source files found. Import a DOCX file first.");
            return;
        }

        // Get the most recent file
        const mostRecentFile = sourceFiles[sourceFiles.length - 1];
        console.log(`Testing file: ${mostRecentFile.fsPath}`);

        // Read the source notebook
        const fileData = await vscode.workspace.fs.readFile(mostRecentFile);
        const notebook = JSON.parse(Buffer.from(fileData).toString());

        console.log("\n--- Notebook Metadata ---");
        console.log(`ID: ${notebook.metadata?.id || "missing"}`);
        console.log(`Original filename: ${notebook.metadata?.originalFileName || "missing"}`);
        console.log(`Importer type: ${notebook.metadata?.importerType || "missing"}`);
        console.log(
            `Document structure: ${notebook.metadata?.documentStructure ? "preserved" : "missing"}`
        );

        if (notebook.metadata?.documentStructure) {
            const structureData = JSON.parse(notebook.metadata.documentStructure);
            console.log(`- Original file ref: ${structureData.originalFileRef}`);
            console.log(`- Segments tracked: ${structureData.segments.length}`);
            console.log(
                `- Preservation format version: ${structureData.preservationFormatVersion}`
            );

            // Check if original file exists
            const originalFilePath = path.join(
                workspaceFolder.uri.fsPath,
                ".project",
                structureData.originalFileRef
            );
            try {
                const originalFileUri = vscode.Uri.file(originalFilePath);
                const stats = await vscode.workspace.fs.stat(originalFileUri);
                console.log(`- Original file exists: ${stats.size} bytes`);
            } catch (error) {
                console.log(`- Original file missing: ${originalFilePath}`);
            }
        }

        console.log("\n--- Cell Analysis ---");
        console.log(`Total cells: ${notebook.cells?.length || 0}`);

        let cellsWithStructureData = 0;
        let cellsWithOriginalContent = 0;

        if (notebook.cells) {
            for (const cell of notebook.cells) {
                if (cell.metadata?.data) {
                    cellsWithStructureData++;
                    if (cell.metadata.data.originalContent) {
                        cellsWithOriginalContent++;
                    }
                }
            }
        }

        console.log(`Cells with structure data: ${cellsWithStructureData}`);
        console.log(`Cells with original content: ${cellsWithOriginalContent}`);

        // Sample a few cells
        if (notebook.cells && notebook.cells.length > 0) {
            console.log("\n--- Sample Cell ---");
            const sampleCell = notebook.cells[0];
            console.log(`ID: ${sampleCell.metadata?.id || "missing"}`);
            console.log(`Content: ${sampleCell.value?.substring(0, 100) || "empty"}...`);
            console.log(`Has structure data: ${sampleCell.metadata?.data ? "yes" : "no"}`);
            if (sampleCell.metadata?.data?.originalOffset) {
                console.log(
                    `Original offset: ${sampleCell.metadata.data.originalOffset.start}-${sampleCell.metadata.data.originalOffset.end}`
                );
            }
        }

        console.log("\n=== Test Complete ===");
    } catch (error) {
        console.error("Test failed:", error);
    }
}

// Export for manual testing
module.exports = { testStructurePreservation };
