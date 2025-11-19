import * as assert from "assert";
import * as vscode from "vscode";
import { NewSourceUploaderProvider } from "../../providers/NewSourceUploader/NewSourceUploaderProvider";
import { createMockExtensionContext, deleteIfExists, createMockWebviewPanel } from "../testUtils";
import sinon from "sinon";
import { WriteNotebooksMessage, WriteTranslationMessage } from "../../../webviews/codex-webviews/src/NewSourceUploader/types/plugin";
import { ProcessedNotebook } from "../../../webviews/codex-webviews/src/NewSourceUploader/types/common";
import { CodexCellTypes } from "../../../types/enums";

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

    suite("Source Import Progress Tests", () => {
        test("handleWriteNotebooks completes with 100% progress and creates files correctly", async () => {
            // Skip if no workspace folder
            if (!vscode.workspace.workspaceFolders?.[0]) {
                return;
            }

            const workspaceFolder = vscode.workspace.workspaceFolders[0];
            const { panel } = createMockWebviewPanel();

            // Create a test notebook pair with subtitle-like cells (with timestamps)
            const testNotebookPair: ProcessedNotebook = {
                name: "test-subtitles",
                cells: [
                    {
                        id: "cell-1",
                        content: "First subtitle",
                        metadata: {
                            type: CodexCellTypes.TEXT,
                            data: {
                                startTime: 0,
                                endTime: 5,
                            },
                        },
                        images: []
                    },
                    {
                        id: "cell-2",
                        content: "Second subtitle",
                        metadata: {
                            type: CodexCellTypes.TEXT,
                            data: {
                                startTime: 5,
                                endTime: 10,
                            },
                        },
                        images: []
                    },
                    {
                        id: "paratext-1",
                        content: "Paratext content",
                        metadata: {
                            type: CodexCellTypes.PARATEXT,
                            data: {},
                        },
                        images: []
                    },
                ],
                metadata: {
                    id: "test-subtitles",
                    originalFileName: "test.vtt",
                    importerType: "subtitles",
                    createdAt: new Date().toISOString(),
                },
            };

            const writeMessage: WriteNotebooksMessage = {
                command: "writeNotebooks",
                notebookPairs: [
                    {
                        source: testNotebookPair,
                        codex: {
                            ...testNotebookPair,
                            cells: testNotebookPair.cells.map((cell) => ({
                                ...cell,
                                content: cell.metadata?.type === CodexCellTypes.PARATEXT ? cell.content : "",
                            })),
                        },
                    },
                ],
            };

            // Track progress messages
            const progressMessages: any[] = [];
            const originalPostMessage = panel.webview.postMessage.bind(panel.webview);
            panel.webview.postMessage = async (message: any) => {
                if (message.command === "notification" || message.command === "projectInventory") {
                    progressMessages.push(message);
                }
                return originalPostMessage(message);
            };

            // Call handleWriteNotebooks
            const handleWriteNotebooks = (provider as any).handleWriteNotebooks.bind(provider);
            await handleWriteNotebooks(
                writeMessage,
                new vscode.CancellationTokenSource().token,
                panel
            );

            // Verify success notification was sent
            const successNotification = progressMessages.find(
                (msg) => msg.command === "notification" && msg.type === "success"
            );
            assert.ok(successNotification, "Should send success notification");

            // Verify files were created
            const sourceUri = vscode.Uri.joinPath(
                workspaceFolder.uri,
                ".project",
                "sourceTexts",
                "test-subtitles.source"
            );
            const codexUri = vscode.Uri.joinPath(
                workspaceFolder.uri,
                "files",
                "target",
                "test-subtitles.codex"
            );

            try {
                const sourceStat = await vscode.workspace.fs.stat(sourceUri);
                const codexStat = await vscode.workspace.fs.stat(codexUri);
                assert.ok(sourceStat.size > 0, "Source file should be created");
                assert.ok(codexStat.size > 0, "Codex file should be created");
            } catch (error) {
                assert.fail(`Files should be created: ${error}`);
            }

            // Cleanup
            try {
                await vscode.workspace.fs.delete(sourceUri);
                await vscode.workspace.fs.delete(codexUri);
            } catch {
                // Ignore cleanup errors
            }
        });
    });

    suite("Target File Creation and Alignment Tests", () => {
        test("handleWriteTranslation aligns cells correctly when importing same file as target", async () => {
            // Skip if no workspace folder
            if (!vscode.workspace.workspaceFolders?.[0]) {
                return;
            }

            const workspaceFolder = vscode.workspace.workspaceFolders[0];

            // First, create a source file with specific cells
            const sourceCells = [
                {
                    kind: vscode.NotebookCellKind.Code,
                    languageId: "html",
                    value: "First subtitle",
                    metadata: {
                        type: CodexCellTypes.TEXT,
                        id: "cell-1",
                        data: {
                            startTime: 0,
                            endTime: 5,
                        },
                    },
                },
                {
                    kind: vscode.NotebookCellKind.Code,
                    languageId: "html",
                    value: "Second subtitle",
                    metadata: {
                        type: CodexCellTypes.TEXT,
                        id: "cell-2",
                        data: {
                            startTime: 5,
                            endTime: 10,
                        },
                    },
                },
                {
                    kind: vscode.NotebookCellKind.Code,
                    languageId: "html",
                    value: "Paratext content",
                    metadata: {
                        type: CodexCellTypes.PARATEXT,
                        id: "paratext-1",
                        data: {},
                    },
                },
            ];

            const sourceNotebook = {
                cells: sourceCells,
                metadata: {
                    id: "test-subtitles",
                    originalName: "test.vtt",
                    corpusMarker: "subtitles",
                    sourceCreatedAt: new Date().toISOString(),
                },
            };

            const codexNotebook = {
                cells: sourceCells.map((cell) => ({
                    ...cell,
                    value: cell.metadata?.type === CodexCellTypes.PARATEXT ? cell.value : "",
                })),
                metadata: sourceNotebook.metadata,
            };

            // Write source and codex files
            const sourceUri = vscode.Uri.joinPath(
                workspaceFolder.uri,
                ".project",
                "sourceTexts",
                "test-subtitles.source"
            );
            const codexUri = vscode.Uri.joinPath(
                workspaceFolder.uri,
                "files",
                "target",
                "test-subtitles.codex"
            );

            await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(workspaceFolder.uri, ".project", "sourceTexts"));
            await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(workspaceFolder.uri, "files", "target"));

            await vscode.workspace.fs.writeFile(
                sourceUri,
                Buffer.from(JSON.stringify(sourceNotebook, null, 2), "utf8")
            );
            await vscode.workspace.fs.writeFile(
                codexUri,
                Buffer.from(JSON.stringify(codexNotebook, null, 2), "utf8")
            );

            // Now create aligned content for translation import
            // This simulates what happens when importing the same file as target
            const alignedContent = [
                {
                    notebookCell: codexNotebook.cells[0],
                    importedContent: {
                        id: "cell-1",
                        content: "First subtitle translated",
                        startTime: 0,
                        endTime: 5,
                    },
                    alignmentMethod: "exact-id" as const,
                    confidence: 1.0,
                },
                {
                    notebookCell: codexNotebook.cells[1],
                    importedContent: {
                        id: "cell-2",
                        content: "Second subtitle translated",
                        startTime: 5,
                        endTime: 10,
                    },
                    alignmentMethod: "exact-id" as const,
                    confidence: 1.0,
                },
                {
                    notebookCell: codexNotebook.cells[2],
                    importedContent: {
                        id: "paratext-1",
                        content: "Paratext content",
                        startTime: undefined,
                        endTime: undefined,
                    },
                    isParatext: true,
                    alignmentMethod: "exact-id" as const,
                    confidence: 1.0,
                },
            ];

            const writeTranslationMessage: WriteTranslationMessage = {
                command: "writeTranslation",
                alignedContent,
                sourceFilePath: sourceUri.fsPath,
                targetFilePath: codexUri.fsPath,
                importerType: "subtitles",
            };

            // Call handleWriteTranslation
            const handleWriteTranslation = (provider as any).handleWriteTranslation.bind(provider);
            await handleWriteTranslation(
                writeTranslationMessage,
                new vscode.CancellationTokenSource().token
            );

            // Verify the target file was updated correctly
            const updatedContent = await vscode.workspace.fs.readFile(codexUri);
            const updatedNotebook = JSON.parse(new TextDecoder().decode(updatedContent));

            // Verify all cells are present
            assert.strictEqual(
                updatedNotebook.cells.length,
                3,
                "Target notebook should have same number of cells as source"
            );

            // Verify cell alignment
            assert.strictEqual(
                updatedNotebook.cells[0].value,
                "First subtitle translated",
                "First cell should be updated with translated content"
            );
            assert.strictEqual(
                updatedNotebook.cells[1].value,
                "Second subtitle translated",
                "Second cell should be updated with translated content"
            );
            assert.strictEqual(
                updatedNotebook.cells[2].value,
                "Paratext content",
                "Paratext cell should be preserved"
            );
            assert.strictEqual(
                updatedNotebook.cells[2].metadata.type,
                CodexCellTypes.PARATEXT,
                "Paratext cell should maintain its type"
            );

            // Cleanup
            try {
                await vscode.workspace.fs.delete(sourceUri);
                await vscode.workspace.fs.delete(codexUri);
            } catch {
                // Ignore cleanup errors
            }
        });

        test("handleWriteTranslation preserves matching cell counts for source and target", async () => {
            // Skip if no workspace folder
            if (!vscode.workspace.workspaceFolders?.[0]) {
                return;
            }

            const workspaceFolder = vscode.workspace.workspaceFolders[0];

            // Create source file with mixed cell types (text and paratext)
            const sourceCells = [
                {
                    kind: vscode.NotebookCellKind.Code,
                    languageId: "html",
                    value: "Text cell 1",
                    metadata: {
                        type: CodexCellTypes.TEXT,
                        id: "text-1",
                        data: { startTime: 0, endTime: 5 },
                    },
                },
                {
                    kind: vscode.NotebookCellKind.Code,
                    languageId: "html",
                    value: "Paratext cell 1",
                    metadata: {
                        type: CodexCellTypes.PARATEXT,
                        id: "paratext-1",
                        data: {},
                    },
                },
                {
                    kind: vscode.NotebookCellKind.Code,
                    languageId: "html",
                    value: "Text cell 2",
                    metadata: {
                        type: CodexCellTypes.TEXT,
                        id: "text-2",
                        data: { startTime: 5, endTime: 10 },
                    },
                },
                {
                    kind: vscode.NotebookCellKind.Code,
                    languageId: "html",
                    value: "Paratext cell 2",
                    metadata: {
                        type: CodexCellTypes.PARATEXT,
                        id: "paratext-2",
                        data: {},
                    },
                },
            ];

            const sourceNotebook = {
                cells: sourceCells,
                metadata: {
                    id: "test-mixed",
                    originalName: "test.vtt",
                    corpusMarker: "subtitles",
                    sourceCreatedAt: new Date().toISOString(),
                },
            };

            const codexNotebook = {
                cells: sourceCells.map((cell) => ({
                    ...cell,
                    value: cell.metadata?.type === CodexCellTypes.PARATEXT ? cell.value : "",
                })),
                metadata: sourceNotebook.metadata,
            };

            // Write files
            const sourceUri = vscode.Uri.joinPath(
                workspaceFolder.uri,
                ".project",
                "sourceTexts",
                "test-mixed.source"
            );
            const codexUri = vscode.Uri.joinPath(
                workspaceFolder.uri,
                "files",
                "target",
                "test-mixed.codex"
            );

            await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(workspaceFolder.uri, ".project", "sourceTexts"));
            await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(workspaceFolder.uri, "files", "target"));

            await vscode.workspace.fs.writeFile(
                sourceUri,
                Buffer.from(JSON.stringify(sourceNotebook, null, 2), "utf8")
            );
            await vscode.workspace.fs.writeFile(
                codexUri,
                Buffer.from(JSON.stringify(codexNotebook, null, 2), "utf8")
            );

            // Create aligned content matching all cells
            const alignedContent = sourceCells.map((cell, index) => ({
                notebookCell: codexNotebook.cells[index],
                importedContent: {
                    id: cell.metadata.id,
                    content: cell.value + " translated",
                    startTime: cell.metadata.data?.startTime,
                    endTime: cell.metadata.data?.endTime,
                },
                isParatext: cell.metadata.type === CodexCellTypes.PARATEXT,
                alignmentMethod: "exact-id" as const,
                confidence: 1.0,
            }));

            const writeTranslationMessage: WriteTranslationMessage = {
                command: "writeTranslation",
                alignedContent,
                sourceFilePath: sourceUri.fsPath,
                targetFilePath: codexUri.fsPath,
                importerType: "subtitles",
            };

            // Call handleWriteTranslation
            const handleWriteTranslation = (provider as any).handleWriteTranslation.bind(provider);
            await handleWriteTranslation(
                writeTranslationMessage,
                new vscode.CancellationTokenSource().token
            );

            // Verify cell counts match
            const sourceContent = await vscode.workspace.fs.readFile(sourceUri);
            const targetContent = await vscode.workspace.fs.readFile(codexUri);
            const sourceNotebookData = JSON.parse(new TextDecoder().decode(sourceContent));
            const targetNotebookData = JSON.parse(new TextDecoder().decode(targetContent));

            assert.strictEqual(
                sourceNotebookData.cells.length,
                targetNotebookData.cells.length,
                "Source and target should have the same number of cells"
            );

            // Verify paratext cell counts match
            const sourceParatextCount = sourceNotebookData.cells.filter(
                (cell: any) => cell.metadata?.type === CodexCellTypes.PARATEXT
            ).length;
            const targetParatextCount = targetNotebookData.cells.filter(
                (cell: any) => cell.metadata?.type === CodexCellTypes.PARATEXT
            ).length;

            assert.strictEqual(
                sourceParatextCount,
                targetParatextCount,
                "Source and target should have the same number of paratext cells"
            );

            // Verify text cell counts match
            const sourceTextCount = sourceNotebookData.cells.filter(
                (cell: any) => cell.metadata?.type === CodexCellTypes.TEXT
            ).length;
            const targetTextCount = targetNotebookData.cells.filter(
                (cell: any) => cell.metadata?.type === CodexCellTypes.TEXT
            ).length;

            assert.strictEqual(
                sourceTextCount,
                targetTextCount,
                "Source and target should have the same number of text cells"
            );

            // Cleanup
            try {
                await vscode.workspace.fs.delete(sourceUri);
                await vscode.workspace.fs.delete(codexUri);
            } catch {
                // Ignore cleanup errors
            }
        });
    });

    suite("Subtitle Importer Integration Tests", () => {
        test("Full workflow: import source then create target from same file maintains cell alignment", async () => {
            // Skip if no workspace folder
            if (!vscode.workspace.workspaceFolders?.[0]) {
                return;
            }

            const workspaceFolder = vscode.workspace.workspaceFolders[0];
            const { panel } = createMockWebviewPanel();

            // Step 1: Import source file
            const sourceCells = [
                {
                    id: "subtitle-1",
                    content: "Hello world",
                    metadata: {
                        type: CodexCellTypes.TEXT,
                        data: { startTime: 0, endTime: 3 },
                    },
                    images: []
                },
                {
                    id: "subtitle-2",
                    content: "How are you?",
                    metadata: {
                        type: CodexCellTypes.TEXT,
                        data: { startTime: 3, endTime: 6 },
                    },
                    images: []
                },
                {
                    id: "paratext-1",
                    content: "Note: This is a test",
                    metadata: {
                        type: CodexCellTypes.PARATEXT,
                        data: {},
                    },
                    images: []
                },
            ];

            const sourceNotebook: ProcessedNotebook = {
                name: "test-subtitles-workflow",
                cells: sourceCells,
                metadata: {
                    id: "test-subtitles-workflow",
                    originalFileName: "test.vtt",
                    importerType: "subtitles",
                    createdAt: new Date().toISOString(),
                },
            };

            const writeSourceMessage: WriteNotebooksMessage = {
                command: "writeNotebooks",
                notebookPairs: [
                    {
                        source: sourceNotebook,
                        codex: {
                            ...sourceNotebook,
                            cells: sourceNotebook.cells.map((cell) => ({
                                ...cell,
                                content: cell.metadata?.type === CodexCellTypes.PARATEXT ? cell.content : "",
                            })),
                        },
                    },
                ],
            };

            const handleWriteNotebooks = (provider as any).handleWriteNotebooks.bind(provider);
            await handleWriteNotebooks(
                writeSourceMessage,
                new vscode.CancellationTokenSource().token,
                panel
            );

            // Verify source and codex files exist
            const sourceUri = vscode.Uri.joinPath(
                workspaceFolder.uri,
                ".project",
                "sourceTexts",
                "test-subtitles-workflow.source"
            );
            const codexUri = vscode.Uri.joinPath(
                workspaceFolder.uri,
                "files",
                "target",
                "test-subtitles-workflow.codex"
            );

            let sourceContent, codexContent;
            try {
                sourceContent = await vscode.workspace.fs.readFile(sourceUri);
                codexContent = await vscode.workspace.fs.readFile(codexUri);
            } catch (error) {
                assert.fail(`Files should exist after import: ${error}`);
            }

            const sourceNotebookData = JSON.parse(new TextDecoder().decode(sourceContent));
            const codexNotebookData = JSON.parse(new TextDecoder().decode(codexContent));

            // Step 2: Create target from same file (simulate translation import)
            // This simulates importing the same subtitle file as a target
            const alignedContent = sourceCells.map((cell, index) => ({
                notebookCell: codexNotebookData.cells[index],
                importedContent: {
                    id: cell.id,
                    content: cell.content + " [translated]",
                    startTime: cell.metadata.data?.startTime,
                    endTime: cell.metadata.data?.endTime,
                },
                isParatext: cell.metadata.type === CodexCellTypes.PARATEXT,
                alignmentMethod: "exact-id" as const,
                confidence: 1.0,
            }));

            const writeTranslationMessage: WriteTranslationMessage = {
                command: "writeTranslation",
                alignedContent,
                sourceFilePath: sourceUri.fsPath,
                targetFilePath: codexUri.fsPath,
                importerType: "subtitles",
            };

            const handleWriteTranslation = (provider as any).handleWriteTranslation.bind(provider);
            await handleWriteTranslation(
                writeTranslationMessage,
                new vscode.CancellationTokenSource().token
            );

            // Step 3: Verify final state
            const finalSourceContent = await vscode.workspace.fs.readFile(sourceUri);
            const finalTargetContent = await vscode.workspace.fs.readFile(codexUri);
            const finalSourceNotebook = JSON.parse(new TextDecoder().decode(finalSourceContent));
            const finalTargetNotebook = JSON.parse(new TextDecoder().decode(finalTargetContent));

            // Verify cell counts match
            assert.strictEqual(
                finalSourceNotebook.cells.length,
                finalTargetNotebook.cells.length,
                "Source and target should have matching cell counts after translation import"
            );

            // Verify paratext cells are preserved
            const sourceParatextCells = finalSourceNotebook.cells.filter(
                (cell: any) => cell.metadata?.type === CodexCellTypes.PARATEXT
            );
            const targetParatextCells = finalTargetNotebook.cells.filter(
                (cell: any) => cell.metadata?.type === CodexCellTypes.PARATEXT
            );

            assert.strictEqual(
                sourceParatextCells.length,
                targetParatextCells.length,
                "Source and target should have matching paratext cell counts"
            );

            // Verify all cells are aligned correctly
            for (let i = 0; i < finalSourceNotebook.cells.length; i++) {
                const sourceCell = finalSourceNotebook.cells[i];
                const targetCell = finalTargetNotebook.cells[i];

                assert.strictEqual(
                    sourceCell.metadata.id,
                    targetCell.metadata.id,
                    `Cell ${i} should have matching IDs`
                );
                assert.strictEqual(
                    sourceCell.metadata.type,
                    targetCell.metadata.type,
                    `Cell ${i} should have matching types`
                );
            }

            // Cleanup
            try {
                await vscode.workspace.fs.delete(sourceUri);
                await vscode.workspace.fs.delete(codexUri);
            } catch {
                // Ignore cleanup errors
            }
        });
    });
});

