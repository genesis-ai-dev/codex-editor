import * as assert from "assert";
import * as vscode from "vscode";
import { splitSourceFile } from "../../utils/codexNotebookUtils";

suite("File System Operations Test Suite", () => {
    let tempSourceUri: vscode.Uri;
    let workspaceUri: vscode.Uri;
    let testDirUri: vscode.Uri;

    suiteSetup(async () => {
        // Ensure a temporary workspace folder is available
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            await vscode.workspace.updateWorkspaceFolders(0, 0, {
                uri: vscode.Uri.file("/tmp/test-workspace"),
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


    test("should maintain file consistency during splits", async () => {
        const multiBookSource = vscode.Uri.joinPath(testDirUri, "multiBook.usfm");
        const content =
            "\\id GEN\n\\c 1\n\\v 1 In the beginning...\n\\id EXO\n\\c 1\n\\v 1 Now these are the names...";
        await vscode.workspace.fs.writeFile(multiBookSource, Buffer.from(content));

        await splitSourceFile(multiBookSource);

        const genFile = vscode.Uri.joinPath(testDirUri, "gen.source");
        const exoFile = vscode.Uri.joinPath(testDirUri, "exo.source");

        const genStat = await vscode.workspace.fs.stat(genFile);
        const exoStat = await vscode.workspace.fs.stat(exoFile);

        assert.ok(genStat.type === vscode.FileType.File, "The Genesis file should exist");
        assert.ok(exoStat.type === vscode.FileType.File, "The Exodus file should exist");

        await vscode.workspace.fs.delete(genFile);
        await vscode.workspace.fs.delete(exoFile);
    });
});
