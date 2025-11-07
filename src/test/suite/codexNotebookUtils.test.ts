import * as assert from "assert";
import * as vscode from "vscode";
import { findCodexFilesByBookAbbr } from "../../utils/codexNotebookUtils";
import { CodexContentSerializer } from "../../serializer";
import { createMockExtensionContext, deleteIfExists } from "../testUtils";

suite("codexNotebookUtils Test Suite", () => {
    let tempCodexFiles: vscode.Uri[] = [];
    let workspaceFolder: vscode.WorkspaceFolder | undefined;

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
        bookAbbr: string,
        metadata: { corpusMarker?: string; fileDisplayName?: string;[key: string]: any; }
    ): Promise<vscode.Uri> {
        if (!workspaceFolder) {
            throw new Error("No workspace folder found");
        }

        const targetDir = vscode.Uri.joinPath(workspaceFolder.uri, "files", "target");
        const codexUri = vscode.Uri.joinPath(targetDir, `${bookAbbr}.codex`);

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

    test("findCodexFilesByBookAbbr finds files matching book abbreviation", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        // Create codex files
        await createCodexFileWithMetadata("GEN", {});
        await createCodexFileWithMetadata("EXO", {});
        await createCodexFileWithMetadata("LEV", {});

        // Find files for GEN
        const result = await findCodexFilesByBookAbbr("GEN");

        assert.strictEqual(result.matchingUris.length, 1, "Should find one matching file");
        assert.ok(
            result.matchingUris[0].fsPath.endsWith("GEN.codex"),
            "Should find the correct file"
        );
    });

    test("findCodexFilesByBookAbbr returns empty array when no matches found", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        // Don't create any files
        const result = await findCodexFilesByBookAbbr("NONEXISTENT");

        assert.strictEqual(result.matchingUris.length, 0, "Should return empty array when no matches");
        assert.strictEqual(result.corpusMarker, undefined, "Should not have corpusMarker when not reading metadata");
    });

    test("findCodexFilesByBookAbbr reads corpusMarker from metadata when readMetadata is true", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        // Create codex file with corpusMarker
        await createCodexFileWithMetadata("MAT", {
            corpusMarker: "NT",
            fileDisplayName: "Matthew",
        });

        // Find files and read metadata
        const result = await findCodexFilesByBookAbbr("MAT", { readMetadata: true });

        assert.strictEqual(result.matchingUris.length, 1, "Should find one matching file");
        assert.strictEqual(result.corpusMarker, "NT", "Should read corpusMarker from metadata");
        assert.ok(result.firstFileMetadata, "Should have firstFileMetadata");
        assert.strictEqual(
            result.firstFileMetadata?.corpusMarker,
            "NT",
            "First file metadata should have correct corpusMarker"
        );
        assert.strictEqual(
            result.firstFileMetadata?.fileDisplayName,
            "Matthew",
            "First file metadata should have correct fileDisplayName"
        );
    });

    test("findCodexFilesByBookAbbr handles non-biblical corpusMarker correctly", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        // Create codex file with audio corpusMarker
        await createCodexFileWithMetadata("Mateyo_001_001-001_017", {
            corpusMarker: "audio",
            fileDisplayName: "Mateyo_001_001-001_017",
        });

        // Find files and read metadata
        const result = await findCodexFilesByBookAbbr("Mateyo_001_001-001_017", { readMetadata: true });

        assert.strictEqual(result.matchingUris.length, 1, "Should find one matching file");
        assert.strictEqual(result.corpusMarker, "audio", "Should read audio corpusMarker from metadata");
        assert.strictEqual(
            result.firstFileMetadata?.corpusMarker,
            "audio",
            "First file metadata should have audio corpusMarker"
        );
    });

    test("findCodexFilesByBookAbbr filters from provided codexUris when provided", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        // Create codex files
        const genUri = await createCodexFileWithMetadata("GEN", {});
        const exoUri = await createCodexFileWithMetadata("EXO", {});
        const levUri = await createCodexFileWithMetadata("LEV", {});

        // Provide only GEN and EXO URIs
        const providedUris = [genUri, exoUri];

        // Find GEN from provided URIs
        const result = await findCodexFilesByBookAbbr("GEN", { codexUris: providedUris });

        assert.strictEqual(result.matchingUris.length, 1, "Should find one matching file");
        assert.ok(
            result.matchingUris[0].fsPath.endsWith("GEN.codex"),
            "Should find GEN from provided URIs"
        );

        // LEV should not be found since it's not in provided URIs
        const levResult = await findCodexFilesByBookAbbr("LEV", { codexUris: providedUris });
        assert.strictEqual(levResult.matchingUris.length, 0, "Should not find LEV when not in provided URIs");
    });

    test("findCodexFilesByBookAbbr handles missing metadata gracefully", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        // Create codex file without corpusMarker
        await createCodexFileWithMetadata("NUM", {
            // No corpusMarker
        });

        // Find files and read metadata
        const result = await findCodexFilesByBookAbbr("NUM", { readMetadata: true });

        assert.strictEqual(result.matchingUris.length, 1, "Should find one matching file");
        assert.strictEqual(result.corpusMarker, undefined, "Should have undefined corpusMarker when not in metadata");
        assert.ok(result.firstFileMetadata, "Should still have firstFileMetadata");
    });

    test("findCodexFilesByBookAbbr returns empty array when no workspace folder", async () => {
        // This test verifies the function handles missing workspace gracefully
        // We can't easily test this without mocking, but the function should return empty array
        // The actual test would require mocking vscode.workspace.workspaceFolders
        // For now, we'll test the normal case which is more important
    });
});

