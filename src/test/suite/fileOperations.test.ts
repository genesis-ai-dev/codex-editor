import * as assert from "assert";
import * as vscode from "vscode";

suite("File System Operations Test Suite", () => {
    let tempSourceUri: vscode.Uri;
    let workspaceUri: vscode.Uri;
    let testDirUri: vscode.Uri;

    suiteSetup(async () => {
        // Ensure a temporary workspace folder is available
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            // Create the directory first before adding it as a workspace folder
            const tempWorkspaceUri = vscode.Uri.file("/tmp/test-workspace");
            try {
                await vscode.workspace.fs.createDirectory(tempWorkspaceUri);
            } catch (error) {
                // Directory might already exist, which is fine
                console.log("Directory creation result:", error);
            }

            await vscode.workspace.updateWorkspaceFolders(0, 0, {
                uri: tempWorkspaceUri,
            });
        }
        workspaceUri = vscode.workspace.workspaceFolders![0].uri;

        // Best-effort cleanup of any stale fs-ops-* directories from previous runs
        try {
            const entries = await vscode.workspace.fs.readDirectory(workspaceUri);
            for (const [name, fileType] of entries) {
                if (fileType === vscode.FileType.Directory && name.startsWith("fs-ops-")) {
                    const dir = vscode.Uri.joinPath(workspaceUri, name);
                    try {
                        await vscode.workspace.fs.delete(dir, { recursive: true });
                    } catch {
                        // ignore cleanup errors
                    }
                }
            }
        } catch {
            // ignore if workspace root not readable
        }
        testDirUri = vscode.Uri.joinPath(
            workspaceUri,
            `fs-ops-${Date.now()}-${Math.random().toString(36).slice(2)}`
        );
        await vscode.workspace.fs.createDirectory(testDirUri);
    });

    setup(async () => {
        // Create a test source file before each test
        tempSourceUri = vscode.Uri.joinPath(testDirUri, "test.usfm");
        const content = "\\id GEN\n\\h Genesis\n\\c 1\n\\v 1 Test content";
        await vscode.workspace.fs.writeFile(tempSourceUri, Buffer.from(content));
    });

    suiteTeardown(async () => {
        // Remove the test directory created for this suite
        if (testDirUri) {
            try {
                await vscode.workspace.fs.delete(testDirUri, { recursive: true });
            } catch (error) {
                console.error("Suite cleanup failed:", error);
            }
        }
    });

    teardown(async () => {
        // Cleanup after each test
        try {
            await vscode.workspace.fs.delete(tempSourceUri, { recursive: true });
        } catch (error) {
            console.error("Cleanup failed:", error);
        }
    });


});
