import * as assert from "assert";
import * as vscode from "vscode";
import { SourceImportTransaction } from "../../transactions/SourceImportTransaction";

suite("ImportTransaction Test Suite", () => {
    let tempSourceUri: vscode.Uri;
    let workspaceUri: vscode.Uri;
    let context: vscode.ExtensionContext;

    suiteSetup(async () => {
        // Get the extension context
        const extension = vscode.extensions.getExtension("your.extension.id");
        if (!extension) {
            throw new Error("Extension not found");
        }
        context = extension.exports;

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
        const transaction = new SourceImportTransaction(tempSourceUri, context);
        await transaction.prepare();

        // Check that temp directory exists in workspace
        const tempDir = vscode.Uri.joinPath(workspaceUri, ".codex-temp");
        const stat = await vscode.workspace.fs.stat(tempDir);
        assert.ok(stat.type === vscode.FileType.Directory, "Temp directory should be created");
    });

    test("should rollback all changes if any step fails", async () => {
        const transaction = new SourceImportTransaction(tempSourceUri, context);
        await transaction.prepare();

        // Force a failure during execution
        (transaction as any).processFiles = async () => {
            throw new Error("Simulated failure");
        };

        try {
            await transaction.execute();
            assert.fail("Should have thrown an error");
        } catch (error) {
            // Verify temp directory is cleaned up
            const tempDir = vscode.Uri.joinPath(workspaceUri, ".codex-temp");
            await assert.rejects(
                async () => await vscode.workspace.fs.stat(tempDir),
                "Temp directory should be cleaned up"
            );
        }
    });

    test("should maintain consistent state during concurrent imports", async () => {
        const transaction1 = new SourceImportTransaction(tempSourceUri, context);
        const transaction2 = new SourceImportTransaction(tempSourceUri, context);

        await Promise.all([transaction1.prepare(), transaction2.prepare()]);

        // Execute both transactions concurrently
        await Promise.all([transaction1.execute(), transaction2.execute()]);

        // Verify source and codex files exist in correct locations
        const sourceDir = vscode.Uri.joinPath(workspaceUri, ".project", "sourceTexts");
        const targetDir = vscode.Uri.joinPath(workspaceUri, "files", "target");

        const sourceFiles = await vscode.workspace.fs.readDirectory(sourceDir);
        const codexFiles = await vscode.workspace.fs.readDirectory(targetDir);

        assert.strictEqual(sourceFiles.filter(([name]) => name.endsWith(".source")).length, 1);
        assert.strictEqual(codexFiles.filter(([name]) => name.endsWith(".codex")).length, 1);
    });

    test("should report progress during transaction", async () => {
        const progressSteps: string[] = [];
        const progress = {
            report: (step: { message?: string; increment?: number }) => {
                if (step.message) {
                    progressSteps.push(step.message);
                }
            },
        };

        const transaction = new SourceImportTransaction(tempSourceUri, context);
        await transaction.prepare();
        await transaction.execute(progress);

        assert.ok(progressSteps.length > 0, "Should report progress steps");
        assert.ok(
            progressSteps.some((step) => step.includes("Validating")),
            "Should report validation step"
        );
        assert.ok(
            progressSteps.some((step) => step.includes("Processing")),
            "Should report processing step"
        );
        assert.ok(
            progressSteps.some((step) => step.includes("metadata")),
            "Should report metadata step"
        );
    });

    test("should handle cancellation gracefully", async () => {
        const token = new vscode.CancellationTokenSource();
        const transaction = new SourceImportTransaction(tempSourceUri, context);
        await transaction.prepare();

        // Cancel during execution
        setTimeout(() => token.cancel(), 100);

        try {
            await transaction.execute(undefined, token.token);
            assert.fail("Should have been cancelled");
        } catch (error) {
            assert.ok(error instanceof vscode.CancellationError);

            // Verify cleanup
            const tempDir = vscode.Uri.joinPath(workspaceUri, ".codex-temp");
            await assert.rejects(
                async () => await vscode.workspace.fs.stat(tempDir),
                "Temp directory should be cleaned up after cancellation"
            );
        }
    });
});
