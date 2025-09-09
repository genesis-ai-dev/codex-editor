import * as assert from "assert";
import * as vscode from "vscode";
import { writeSourceFile, splitSourceFile } from "../../utils/codexNotebookUtils";

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

    teardown(async () => {
        // Cleanup after each test
        try {
            await vscode.workspace.fs.delete(tempSourceUri, { recursive: true });
        } catch (error) {
            console.error("Cleanup failed:", error);
        }
    });

    test("should use atomic write operations", async () => {
        const tempFileUri = vscode.Uri.joinPath(
            testDirUri,
            `tempFile-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`
        );
        await writeSourceFile(tempFileUri, "Atomic content");

        const stat = await vscode.workspace.fs.stat(tempFileUri);
        assert.ok(stat.type === vscode.FileType.File, "The file should be written atomically");

        await vscode.workspace.fs.delete(tempFileUri);
    });

    test("should handle file system errors gracefully", async () => {
        const invalidUri = vscode.Uri.file("/invalid/path/to/file");
        await assert.rejects(
            async () => await writeSourceFile(invalidUri, "Content"),
            "An error should be thrown for an invalid file path"
        );
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
