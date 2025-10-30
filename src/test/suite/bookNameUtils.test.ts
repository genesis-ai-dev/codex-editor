import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import { getBookDisplayName, getUsfmCodeFromBookName } from "../../utils/bookNameUtils";
import { CodexContentSerializer } from "../../serializer";
import { createTempCodexFile, deleteIfExists } from "../testUtils";

suite("bookNameUtils Test Suite", () => {
    let workspaceFolder: vscode.WorkspaceFolder | undefined;
    let tempCodexFiles: vscode.Uri[] = [];

    suiteSetup(async () => {
        workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            // Skip suite setup if no workspace folder - tests that need it will skip individually
            return;
        }

        // Create files/target directory structure if it doesn't exist
        const targetDir = vscode.Uri.joinPath(workspaceFolder.uri, "files", "target");
        try {
            await vscode.workspace.fs.createDirectory(targetDir);
        } catch {
            // Directory might already exist
        }
    });

    teardown(async () => {
        // Clean up all temp files
        for (const uri of tempCodexFiles) {
            await deleteIfExists(uri);
        }
        tempCodexFiles = [];
    });

    async function createCodexFileWithMetadata(
        usfmCode: string,
        metadata: { fileDisplayName?: string;[key: string]: any; }
    ): Promise<vscode.Uri> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error("No workspace folder found");
        }

        const targetDir = vscode.Uri.joinPath(workspaceFolder.uri, "files", "target");
        const codexUri = vscode.Uri.joinPath(targetDir, `${usfmCode}.codex`);

        const notebookData = {
            cells: [
                {
                    kind: vscode.NotebookCellKind.Code,
                    value: "test content",
                    languageId: "html",
                    metadata: { id: "test-1" },
                },
            ],
            metadata: metadata,
        };

        const serializer = new CodexContentSerializer();
        const serialized = await serializer.serializeNotebook(
            notebookData as any,
            new vscode.CancellationTokenSource().token
        );
        await vscode.workspace.fs.writeFile(codexUri, serialized);

        tempCodexFiles.push(codexUri);
        return codexUri;
    }

    test("getBookDisplayName reads from metadata.fileDisplayName", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        // Create a codex file with custom fileDisplayName
        await createCodexFileWithMetadata("GEN", {
            fileDisplayName: "Custom Genesis Name",
        });

        const displayName = await getBookDisplayName("GEN");
        assert.strictEqual(
            displayName,
            "Custom Genesis Name",
            "Should return the custom display name from metadata"
        );
    });

    test("getBookDisplayName falls back to default when metadata is missing", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        // Create a codex file without fileDisplayName
        await createCodexFileWithMetadata("EXO", {});

        const displayName = await getBookDisplayName("EXO");
        assert.strictEqual(
            displayName,
            "Exodus",
            "Should fall back to default English name when fileDisplayName is missing"
        );
    });

    test("getBookDisplayName falls back to default when file doesn't exist", async () => {
        // Don't create a file for this test
        const displayName = await getBookDisplayName("LEV");
        assert.strictEqual(
            displayName,
            "Leviticus",
            "Should fall back to default English name when file doesn't exist"
        );
    });

    test("getBookDisplayName returns USFM code when book not found in defaults", async () => {
        const displayName = await getBookDisplayName("INVALID");
        assert.strictEqual(
            displayName,
            "INVALID",
            "Should return the USFM code when book is not found in defaults"
        );
    });

    test("getBookDisplayName handles empty fileDisplayName string", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        // Create a codex file with empty fileDisplayName
        await createCodexFileWithMetadata("NUM", {
            fileDisplayName: "",
        });

        const displayName = await getBookDisplayName("NUM");
        assert.strictEqual(
            displayName,
            "Numbers",
            "Should fall back to default when fileDisplayName is empty string"
        );
    });

    test("getBookDisplayName handles whitespace-only fileDisplayName", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        // Create a codex file with whitespace-only fileDisplayName
        await createCodexFileWithMetadata("DEU", {
            fileDisplayName: "   ",
        });

        const displayName = await getBookDisplayName("DEU");
        assert.strictEqual(
            displayName,
            "Deuteronomy",
            "Should fall back to default when fileDisplayName is whitespace-only"
        );
    });

    test("getUsfmCodeFromBookName does NOT check localized-books.json", async () => {
        // Verify that getUsfmCodeFromBookName uses only default book names
        // This test ensures the function doesn't depend on localized-books.json
        const code = await getUsfmCodeFromBookName("Genesis");
        assert.strictEqual(code, "GEN", "Should match default English name");

        const code2 = await getUsfmCodeFromBookName("GEN");
        assert.strictEqual(code2, "GEN", "Should match USFM code directly");
    });

    test("getUsfmCodeFromBookName matches against default book names", async () => {
        const testCases = [
            { name: "Genesis", expected: "GEN" },
            { name: "Exodus", expected: "EXO" },
            { name: "Matthew", expected: "MAT" },
            { name: "Revelation", expected: "REV" },
        ];

        for (const testCase of testCases) {
            const code = await getUsfmCodeFromBookName(testCase.name);
            assert.strictEqual(
                code,
                testCase.expected,
                `Should match "${testCase.name}" to "${testCase.expected}"`
            );
        }
    });

    test("getUsfmCodeFromBookName handles partial matches", async () => {
        // Test that partial matching still works
        const code = await getUsfmCodeFromBookName("Gen");
        assert.ok(code === "GEN", "Should handle partial matches");
    });
});

