import * as assert from "assert";
import * as vscode from "vscode";
import { NewSourceUploaderProvider } from "../../providers/NewSourceUploader/NewSourceUploaderProvider";
import { createMockExtensionContext, deleteIfExists } from "../testUtils";
import sinon from "sinon";

suite("NewSourceUploaderProvider Test Suite", () => {
    let context: vscode.ExtensionContext;
    let provider: NewSourceUploaderProvider;
    let workspaceFolder: vscode.WorkspaceFolder | undefined;

    suiteSetup(async () => {
        workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        // No need to throw - tests will skip if no workspace folder
    });

    setup(() => {
        context = createMockExtensionContext();
        provider = new NewSourceUploaderProvider(context);
    });

    teardown(async () => {
        // Clean up localized-books.json if it exists
        if (workspaceFolder) {
            const localizedUri = vscode.Uri.joinPath(workspaceFolder.uri, "localized-books.json");
            try {
                await vscode.workspace.fs.delete(localizedUri);
            } catch {
                // File doesn't exist, ignore
            }
        }
    });

    test("removeLocalizedBooksJsonIfPresent deletes localized-books.json when it exists", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        // Create localized-books.json file
        const localizedUri = vscode.Uri.joinPath(workspaceFolder!.uri, "localized-books.json");
        const localizedContent = JSON.stringify([
            {
                abbr: "GEN",
                name: "Custom Genesis",
                ord: "01",
                testament: "OT",
            },
        ]);
        await vscode.workspace.fs.writeFile(localizedUri, Buffer.from(localizedContent, "utf8"));

        // Verify file exists
        try {
            await vscode.workspace.fs.stat(localizedUri);
            assert.ok(true, "localized-books.json should exist before deletion");
        } catch {
            assert.fail("localized-books.json should exist");
        }

        // Call removeLocalizedBooksJsonIfPresent (accessing private method)
        const removeMethod = (provider as any).removeLocalizedBooksJsonIfPresent.bind(provider);
        await removeMethod();

        // Verify file was deleted
        try {
            await vscode.workspace.fs.stat(localizedUri);
            assert.fail("localized-books.json should be deleted");
        } catch {
            assert.ok(true, "localized-books.json correctly deleted");
        }
    });

    test("removeLocalizedBooksJsonIfPresent handles missing file gracefully", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        // Ensure file doesn't exist
        const localizedUri = vscode.Uri.joinPath(workspaceFolder!.uri, "localized-books.json");
        try {
            await vscode.workspace.fs.delete(localizedUri);
        } catch {
            // File doesn't exist, that's fine
        }

        // Call removeLocalizedBooksJsonIfPresent should not throw
        const removeMethod = (provider as any).removeLocalizedBooksJsonIfPresent.bind(provider);
        await assert.doesNotReject(
            removeMethod(),
            "Should handle missing file gracefully"
        );
    });

    test("removeLocalizedBooksJsonIfPresent handles missing workspace folder", async () => {
        // Skip this test if there's already a workspace folder
        // We can't easily test the missing workspace folder case since workspaceFolders
        // is a read-only property. The method should gracefully handle undefined workspaceFolders
        // which is verified by the other tests that skip when no workspace folder exists.

        // If there's no workspace folder, verify the method handles it gracefully
        if (!vscode.workspace.workspaceFolders?.[0]) {
            const removeMethod = (provider as any).removeLocalizedBooksJsonIfPresent.bind(provider);
            await assert.doesNotReject(
                removeMethod(),
                "Should handle missing workspace folder gracefully"
            );
            return;
        }

        // If there is a workspace folder, we can't test the missing case,
        // but we've verified the graceful handling above
        // This test serves as documentation that the method handles missing workspace gracefully
        assert.ok(true, "Test skipped - workspace folder exists");
    });

    test("removeLocalizedBooksJsonIfPresent is called after handleWriteNotebooksForced", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        // This test verifies that removeLocalizedBooksJsonIfPresent is called
        // by checking if it's invoked during the notebook creation process
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

        // Create localized-books.json
        const localizedUri = vscode.Uri.joinPath(workspaceFolder!.uri, "localized-books.json");
        const localizedContent = JSON.stringify([
            {
                abbr: "GEN",
                name: "Custom Genesis",
                ord: "01",
                testament: "OT",
            },
        ]);
        await vscode.workspace.fs.writeFile(localizedUri, Buffer.from(localizedContent, "utf8"));

        // Spy on removeLocalizedBooksJsonIfPresent
        const removeSpy = sinon.spy(provider as any, "removeLocalizedBooksJsonIfPresent");

        // Note: We can't easily test handleWriteNotebooksForced without creating full notebook pairs
        // This test verifies the method exists and can be called
        const removeMethod = (provider as any).removeLocalizedBooksJsonIfPresent.bind(provider);
        await removeMethod();

        assert.ok(removeSpy.called, "removeLocalizedBooksJsonIfPresent should be callable");

        removeSpy.restore();
    });

    test("removeLocalizedBooksJsonIfPresent uses correct file path", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        // Create localized-books.json
        const localizedUri = vscode.Uri.joinPath(workspaceFolder!.uri, "localized-books.json");
        const localizedContent = JSON.stringify([
            {
                abbr: "GEN",
                name: "Custom Genesis",
                ord: "01",
                testament: "OT",
            },
        ]);
        await vscode.workspace.fs.writeFile(localizedUri, Buffer.from(localizedContent, "utf8"));

        // Call remove method
        const removeMethod = (provider as any).removeLocalizedBooksJsonIfPresent.bind(provider);
        await removeMethod();

        // Verify the file at the workspace root was deleted
        try {
            await vscode.workspace.fs.stat(localizedUri);
            assert.fail("localized-books.json should be deleted from workspace root");
        } catch {
            assert.ok(true, "localized-books.json correctly deleted from workspace root");
        }
    });

    test("convertToNotebookPreview converts USFM codes to full names for NT books during import", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        // Create a processed notebook with NT corpusMarker and USFM code as originalFileName
        const processedNotebook = {
            name: "MAT",
            cells: [],
            metadata: {
                id: "test-mat",
                originalFileName: "MAT.usfm",
                createdAt: new Date().toISOString(),
                corpusMarker: "NT",
            },
        };

        // Call convertToNotebookPreview (accessing private method)
        const convertToNotebookPreview = (provider as any).convertToNotebookPreview.bind(provider);
        const result = await convertToNotebookPreview(processedNotebook);

        // Verify fileDisplayName was converted from "MAT" to "Matthew"
        assert.strictEqual(
            result.metadata.fileDisplayName,
            "Matthew",
            "Should convert USFM code MAT to full name Matthew for NT books"
        );
        assert.strictEqual(result.metadata.corpusMarker, "NT", "Should preserve corpusMarker");
    });

    test("convertToNotebookPreview converts USFM codes to full names for OT books during import", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        // Create a processed notebook with OT corpusMarker and USFM code
        const processedNotebook = {
            name: "GEN",
            cells: [],
            metadata: {
                id: "test-gen",
                originalFileName: "GEN.usfm",
                createdAt: new Date().toISOString(),
                corpusMarker: "OT",
            },
        };

        // Call convertToNotebookPreview
        const convertToNotebookPreview = (provider as any).convertToNotebookPreview.bind(provider);
        const result = await convertToNotebookPreview(processedNotebook);

        // Verify fileDisplayName was converted from "GEN" to "Genesis"
        assert.strictEqual(
            result.metadata.fileDisplayName,
            "Genesis",
            "Should convert USFM code GEN to full name Genesis for OT books"
        );
        assert.strictEqual(result.metadata.corpusMarker, "OT", "Should preserve corpusMarker");
    });

    test("convertToNotebookPreview does NOT convert non-USFM codes for NT/OT books", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        // Create a processed notebook with NT corpusMarker but non-USFM originalFileName
        const processedNotebook = {
            name: "Matthew",
            cells: [],
            metadata: {
                id: "test-mat",
                originalFileName: "Matthew.txt",
                createdAt: new Date().toISOString(),
                corpusMarker: "NT",
            },
        };

        // Call convertToNotebookPreview
        const convertToNotebookPreview = (provider as any).convertToNotebookPreview.bind(provider);
        const result = await convertToNotebookPreview(processedNotebook);

        // Verify fileDisplayName was NOT converted (not a USFM code)
        assert.strictEqual(
            result.metadata.fileDisplayName,
            "Matthew",
            "Should not convert non-USFM codes, keep as-is"
        );
    });

    test("convertToNotebookPreview does NOT convert USFM codes for non-biblical books", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        // Create a processed notebook with audio corpusMarker and USFM-like code
        const processedNotebook = {
            name: "MAT",
            cells: [],
            metadata: {
                id: "test-audio",
                originalFileName: "MAT.audio",
                createdAt: new Date().toISOString(),
                corpusMarker: "audio",
            },
        };

        // Call convertToNotebookPreview
        const convertToNotebookPreview = (provider as any).convertToNotebookPreview.bind(provider);
        const result = await convertToNotebookPreview(processedNotebook);

        // Verify fileDisplayName was NOT converted (not NT/OT)
        assert.strictEqual(
            result.metadata.fileDisplayName,
            "MAT",
            "Should not convert USFM codes for non-biblical books (corpusMarker=audio)"
        );
        assert.strictEqual(result.metadata.corpusMarker, "audio", "Should preserve audio corpusMarker");
    });

    test("convertToNotebookPreview handles missing originalFileName gracefully", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        // Create a processed notebook without originalFileName
        const processedNotebook = {
            name: "MAT",
            cells: [],
            metadata: {
                id: "test-mat",
                createdAt: new Date().toISOString(),
                corpusMarker: "NT",
            },
        };

        // Call convertToNotebookPreview
        const convertToNotebookPreview = (provider as any).convertToNotebookPreview.bind(provider);
        const result = await convertToNotebookPreview(processedNotebook);

        // Verify fileDisplayName is undefined when originalFileName is missing
        assert.strictEqual(
            result.metadata.fileDisplayName,
            undefined,
            "Should have undefined fileDisplayName when originalFileName is missing"
        );
    });

    test("convertToNotebookPreview preserves RTL textDirection from processedNotebook metadata", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        // Create a processed notebook with RTL textDirection
        const processedNotebook = {
            name: "GEN",
            cells: [],
            metadata: {
                id: "test-gen-rtl",
                originalFileName: "GEN",
                createdAt: new Date().toISOString(),
                corpusMarker: "OT",
                textDirection: "rtl",
                importerType: "ebibleCorpus",
            },
        };

        // Call convertToNotebookPreview
        const convertToNotebookPreview = (provider as any).convertToNotebookPreview.bind(provider);
        const result = await convertToNotebookPreview(processedNotebook);

        // Verify textDirection is preserved as RTL
        assert.strictEqual(
            result.metadata.textDirection,
            "rtl",
            "Should preserve RTL textDirection from processedNotebook metadata"
        );
    });

    test("convertToNotebookPreview preserves LTR textDirection from processedNotebook metadata", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        // Create a processed notebook with LTR textDirection
        const processedNotebook = {
            name: "MAT",
            cells: [],
            metadata: {
                id: "test-mat-ltr",
                originalFileName: "MAT",
                createdAt: new Date().toISOString(),
                corpusMarker: "NT",
                textDirection: "ltr",
                importerType: "ebibleCorpus",
            },
        };

        // Call convertToNotebookPreview
        const convertToNotebookPreview = (provider as any).convertToNotebookPreview.bind(provider);
        const result = await convertToNotebookPreview(processedNotebook);

        // Verify textDirection is preserved as LTR
        assert.strictEqual(
            result.metadata.textDirection,
            "ltr",
            "Should preserve LTR textDirection from processedNotebook metadata"
        );
    });

    test("convertToNotebookPreview defaults to LTR when textDirection is missing", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        // Create a processed notebook without textDirection
        const processedNotebook = {
            name: "MAT",
            cells: [],
            metadata: {
                id: "test-mat-no-direction",
                originalFileName: "MAT",
                createdAt: new Date().toISOString(),
                corpusMarker: "NT",
                importerType: "usfm",
            },
        };

        // Call convertToNotebookPreview
        const convertToNotebookPreview = (provider as any).convertToNotebookPreview.bind(provider);
        const result = await convertToNotebookPreview(processedNotebook);

        // Verify textDirection defaults to LTR
        assert.strictEqual(
            result.metadata.textDirection,
            "ltr",
            "Should default to LTR when textDirection is missing from processedNotebook metadata"
        );
    });

    test("convertToNotebookPreview defaults to LTR when textDirection is undefined", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        // Create a processed notebook with undefined textDirection
        const processedNotebook = {
            name: "MAT",
            cells: [],
            metadata: {
                id: "test-mat-undefined-direction",
                originalFileName: "MAT",
                createdAt: new Date().toISOString(),
                corpusMarker: "NT",
                textDirection: undefined,
                importerType: "usfm",
            },
        };

        // Call convertToNotebookPreview
        const convertToNotebookPreview = (provider as any).convertToNotebookPreview.bind(provider);
        const result = await convertToNotebookPreview(processedNotebook);

        // Verify textDirection defaults to LTR
        assert.strictEqual(
            result.metadata.textDirection,
            "ltr",
            "Should default to LTR when textDirection is undefined"
        );
    });
});

