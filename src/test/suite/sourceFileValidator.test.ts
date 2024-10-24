import * as assert from "assert";
import * as vscode from "vscode";

import { SourceFileValidator } from "../../validation/sourceFileValidator";
import { ValidationErrorCode } from "../../../types/";

suite("SourceFileValidator Test Suite", () => {
    let validator: SourceFileValidator;
    let tempUri: vscode.Uri;

    suiteSetup(async () => {
        // Create temp workspace folder if needed
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            await vscode.workspace.updateWorkspaceFolders(0, 0, {
                uri: vscode.Uri.file("/tmp/test-workspace"),
            });
        }
    });

    setup(async () => {
        validator = new SourceFileValidator({
            maxFileSizeBytes: 1024, // 1KB for testing
            supportedExtensions: [".usfm", ".txt"],
            minDiskSpaceBytes: 1024 * 1024, // 1MB for testing
        });
    });

    teardown(async () => {
        if (tempUri) {
            try {
                await vscode.workspace.fs.delete(tempUri);
            } catch (error) {
                console.error("Failed to delete test file:", error);
            }
        }
    });

    test("should reject files over max size limit", async () => {
        // Create a file larger than maxFileSizeBytes
        const largeContent = Buffer.from("x".repeat(2048)); // 2KB
        tempUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, "large.txt");
        await vscode.workspace.fs.writeFile(tempUri, largeContent);

        const result = await validator.validateSourceFile(tempUri);

        assert.strictEqual(result.isValid, false);
        assert.strictEqual(result.errors[0].code, ValidationErrorCode.FILE_SIZE_EXCEEDED);
    });

    test("should reject unsupported file types", async () => {
        // Create a file with unsupported extension
        tempUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, "test.pdf");
        await vscode.workspace.fs.writeFile(tempUri, Buffer.from("test content"));

        const result = await validator.validateSourceFile(tempUri);

        assert.strictEqual(result.isValid, false);
        assert.strictEqual(result.errors[0].code, ValidationErrorCode.UNSUPPORTED_FILE_TYPE);
    });

    test("should validate USFM content structure", async () => {
        // Test invalid USFM
        tempUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, "invalid.usfm");
        await vscode.workspace.fs.writeFile(tempUri, Buffer.from("invalid content"));

        let result = await validator.validateSourceFile(tempUri);
        assert.strictEqual(result.isValid, false);
        assert.strictEqual(result.errors[0].code, ValidationErrorCode.INVALID_CONTENT);

        // Test valid USFM
        tempUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, "valid.usfm");
        const validUsfm = "\\id GEN\n\\h Genesis\n\\c 1\n\\v 1 In the beginning...";
        await vscode.workspace.fs.writeFile(tempUri, Buffer.from(validUsfm));

        result = await validator.validateSourceFile(tempUri);
        assert.strictEqual(result.isValid, true);
        assert.strictEqual(result.errors.length, 0);
    });

    test("should validate USX content structure", async () => {
        tempUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, "test.usx");

        // Test invalid USX
        await vscode.workspace.fs.writeFile(tempUri, Buffer.from("invalid content"));
        let result = await validator.validateSourceFile(tempUri);

        assert.strictEqual(result.isValid, false);
        assert.strictEqual(result.errors[0].code, ValidationErrorCode.INVALID_CONTENT);

        // Test valid USX
        const validUsx = '<usx version="3.0"><book>...</book></usx>';
        await vscode.workspace.fs.writeFile(tempUri, Buffer.from(validUsx));

        result = await validator.validateSourceFile(tempUri);
        assert.strictEqual(result.isValid, true);
    });

    test("should handle concurrent validation requests", async () => {
        // Create multiple files
        const files = await Promise.all([
            createTestFile("test1.usfm", "\\id TEST"),
            createTestFile("test2.usfm", "\\id TEST"),
            createTestFile("test3.usfm", "\\id TEST"),
        ]);

        // Validate concurrently
        const results = await Promise.all(files.map((file) => validator.validateSourceFile(file)));

        // All should be valid
        results.forEach((result) => {
            assert.strictEqual(result.isValid, true);
            assert.strictEqual(result.errors.length, 0);
        });

        // Cleanup
        await Promise.all(files.map((file) => vscode.workspace.fs.delete(file)));
    });

    test("should handle file system errors gracefully", async () => {
        // Test with non-existent file
        const nonExistentUri = vscode.Uri.joinPath(
            vscode.workspace.workspaceFolders![0].uri,
            "nonexistent.usfm"
        );

        const result = await validator.validateSourceFile(nonExistentUri);

        assert.strictEqual(result.isValid, false);
        assert.strictEqual(result.errors[0].code, ValidationErrorCode.SYSTEM_ERROR);
    });

    // Helper function to create test files
    async function createTestFile(name: string, content: string): Promise<vscode.Uri> {
        const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, name);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
        return uri;
    }
});
