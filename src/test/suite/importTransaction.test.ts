import * as assert from "assert";
import * as vscode from "vscode";
import { ImportTransaction } from "../../transactions/ImportTransaction";
import { CustomNotebookMetadata } from "../../../types";

suite("ImportTransaction Test Suite", () => {
    let tempSourceUri: vscode.Uri;
    let workspaceUri: vscode.Uri;

    suiteSetup(async () => {
        // Ensure a temporary workspace folder is available
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            await vscode.workspace.updateWorkspaceFolders(0, 0, {
                uri: vscode.Uri.file("/tmp/test-workspace"),
            });
        }
        workspaceUri = vscode.workspace.workspaceFolders![0].uri;
    });

    setup(async () => {
        // Create a test source file before each test
        tempSourceUri = vscode.Uri.joinPath(workspaceUri, "test.usfm");
        const content = "\\id GEN\n\\h Genesis\n\\c 1\n\\v 1 Test content";
        await vscode.workspace.fs.writeFile(tempSourceUri, Buffer.from(content));
    });

    teardown(async () => {
        // Cleanup after each test
        try {
            await vscode.workspace.fs.delete(tempSourceUri, { recursive: true });
            // Also cleanup any transaction temp directories
            const tempDir = vscode.Uri.joinPath(workspaceUri, ".codex-temp");
            await vscode.workspace.fs.delete(tempDir, { recursive: true });
        } catch (error) {
            console.error("Cleanup failed:", error);
        }
    });

    test("should create temporary directory for transaction", async () => {
        const transaction = new ImportTransaction(tempSourceUri);
        await transaction.createTempDirectory();

        const tempDir = transaction.getTempDir();
        const stat = await vscode.workspace.fs.stat(tempDir);

        assert.ok(stat.type === vscode.FileType.Directory, "Temp directory should be created");
    });

    test("should rollback all changes if any step fails", async () => {
        const transaction = new ImportTransaction(tempSourceUri);

        // Force a failure during processing
        (transaction as any).processFiles = async () => {
            throw new Error("Simulated failure");
        };

        try {
            await transaction.execute();
            assert.fail("Should have thrown an error");
        } catch (error) {
            // Verify no temp files remain
            const tempDir = transaction.getTempDir();
            await assert.rejects(
                async () => await vscode.workspace.fs.stat(tempDir),
                "Temp directory should be cleaned up"
            );

            // Verify no partial files in target location
            const targetDir = vscode.Uri.joinPath(workspaceUri, "source");
            const files = await vscode.workspace.fs.readDirectory(targetDir);
            assert.strictEqual(files.length, 0, "No files should be created in target directory");
        }
    });

    test("should maintain consistent state during concurrent imports", async () => {
        const transaction1 = new ImportTransaction(tempSourceUri);
        const transaction2 = new ImportTransaction(tempSourceUri);

        // Execute both transactions concurrently
        await Promise.all([transaction1.execute(), transaction2.execute()]);

        // Verify only one set of files exists
        const targetDir = vscode.Uri.joinPath(workspaceUri, "source");
        const files = await vscode.workspace.fs.readDirectory(targetDir);

        // Should only have one .source file and one .codex file
        const sourceFiles = files.filter(([name]) => name.endsWith(".source"));
        const codexFiles = files.filter(([name]) => name.endsWith(".codex"));

        assert.strictEqual(sourceFiles.length, 1, "Should have exactly one source file");
        assert.strictEqual(codexFiles.length, 1, "Should have exactly one codex file");
    });

    test("should report progress during transaction", async () => {
        const progressSteps: string[] = [];
        const progress = {
            report: (step: { message: string }) => {
                progressSteps.push(step.message);
            },
        };

        const transaction = new ImportTransaction(tempSourceUri, progress);
        await transaction.execute();

        assert.ok(progressSteps.length > 0, "Should report progress steps");
        assert.ok(
            progressSteps.includes("Creating temporary files..."),
            "Should report file creation"
        );
        assert.ok(progressSteps.includes("Processing files..."), "Should report processing");
        assert.ok(progressSteps.includes("Updating metadata..."), "Should report metadata update");
    });

    test("should handle cancellation gracefully", async () => {
        const token = new vscode.CancellationTokenSource();
        const transaction = new ImportTransaction(tempSourceUri, undefined, token.token);

        // Cancel during execution
        setTimeout(() => token.cancel(), 100);

        try {
            await transaction.execute();
            assert.fail("Should have been cancelled");
        } catch (error) {
            assert.ok(error instanceof vscode.CancellationError, "Should throw cancellation error");

            // Verify cleanup occurred
            const tempDir = transaction.getTempDir();
            await assert.rejects(
                async () => await vscode.workspace.fs.stat(tempDir),
                "Temp directory should be cleaned up after cancellation"
            );
        }
    });
});
