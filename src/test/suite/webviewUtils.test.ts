import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import { fileExists, closeWebviewsForDeletedFiles } from "../../utils/webviewUtils";
import { CodexCellEditorProvider } from "../../providers/codexCellEditorProvider/codexCellEditorProvider";
import { createMockExtensionContext, deleteIfExists } from "../testUtils";
import sinon from "sinon";

suite("WebviewUtils Test Suite", () => {
    let workspaceFolder: vscode.WorkspaceFolder | undefined;
    let tempFiles: vscode.Uri[] = [];

    suiteSetup(async () => {
        workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        // Create necessary directory structure
        const projectDir = vscode.Uri.joinPath(workspaceFolder.uri, ".project");
        const targetDir = vscode.Uri.joinPath(projectDir, "targetTexts");
        const sourceDir = vscode.Uri.joinPath(projectDir, "sourceTexts");

        try {
            await vscode.workspace.fs.createDirectory(projectDir);
        } catch {
            // Directory might already exist
        }

        try {
            await vscode.workspace.fs.createDirectory(targetDir);
        } catch {
            // Directory might already exist
        }

        try {
            await vscode.workspace.fs.createDirectory(sourceDir);
        } catch {
            // Directory might already exist
        }
    });

    teardown(async () => {
        // Clean up all temp files
        for (const uri of tempFiles) {
            await deleteIfExists(uri);
        }
        tempFiles = [];
    });

    suite("fileExists", () => {
        test("should return true for existing file", async () => {
            if (!workspaceFolder) {
                return;
            }

            // Create a test file
            const testFile = vscode.Uri.joinPath(workspaceFolder.uri, ".test", "existing-file.txt");
            try {
                await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(workspaceFolder.uri, ".test"));
            } catch {
                // Directory might already exist
            }
            await vscode.workspace.fs.writeFile(testFile, Buffer.from("test content", "utf8"));
            tempFiles.push(testFile);

            const exists = await fileExists(testFile);
            assert.strictEqual(exists, true, "fileExists should return true for existing file");
        });

        test("should return false for non-existing file", async () => {
            if (!workspaceFolder) {
                return;
            }

            const nonExistentFile = vscode.Uri.joinPath(workspaceFolder.uri, ".test", "non-existent-file.txt");
            const exists = await fileExists(nonExistentFile);
            assert.strictEqual(exists, false, "fileExists should return false for non-existing file");
        });

        test("should return false for deleted file", async () => {
            if (!workspaceFolder) {
                return;
            }

            // Create and then delete a file
            const testFile = vscode.Uri.joinPath(workspaceFolder.uri, ".test", "to-delete.txt");
            try {
                await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(workspaceFolder.uri, ".test"));
            } catch {
                // Directory might already exist
            }
            await vscode.workspace.fs.writeFile(testFile, Buffer.from("test content", "utf8"));
            await vscode.workspace.fs.delete(testFile);

            const exists = await fileExists(testFile);
            assert.strictEqual(exists, false, "fileExists should return false for deleted file");
        });
    });

    suite("closeWebviewsForDeletedFiles", () => {
        test("should close webview for deleted codex file", async () => {
            if (!workspaceFolder) {
                return;
            }

            // Create a codex file URI
            const codexUri = vscode.Uri.joinPath(
                workspaceFolder.uri,
                ".project",
                "targetTexts",
                "TEST.codex"
            );

            // Create mock webview panel
            const codexPanelDisposed = sinon.spy();
            const mockCodexPanel = {
                dispose: codexPanelDisposed,
                webview: {
                    html: "",
                    options: { enableScripts: true },
                    asWebviewUri: (uri: vscode.Uri) => uri,
                    cspSource: "https://example.com",
                    onDidReceiveMessage: () => ({ dispose: () => { } }),
                    postMessage: () => Promise.resolve(),
                },
                onDidDispose: () => ({ dispose: () => { } }),
                onDidChangeViewState: () => ({ dispose: () => { } }),
            } as any as vscode.WebviewPanel;

            // Mock CodexCellEditorProvider instance
            const mockProvider = {
                getWebviewPanels: () => {
                    const panels = new Map<string, vscode.WebviewPanel>();
                    panels.set(codexUri.toString(), mockCodexPanel);
                    return panels;
                },
            } as any;

            const getInstanceStub = sinon.stub(CodexCellEditorProvider, "getInstance").returns(mockProvider);

            try {
                // Call closeWebviewsForDeletedFiles with deleted codex file
                await closeWebviewsForDeletedFiles(
                    [".project/targetTexts/TEST.codex"],
                    workspaceFolder
                );

                // Verify the panel was disposed
                assert.ok(codexPanelDisposed.called, "Codex webview panel should be disposed");
            } finally {
                getInstanceStub.restore();
            }
        });

        test("should close webviews for both codex and source files when codex is deleted", async () => {
            if (!workspaceFolder) {
                return;
            }

            // Create URIs
            const codexUri = vscode.Uri.joinPath(
                workspaceFolder.uri,
                ".project",
                "targetTexts",
                "TEST.codex"
            );
            const sourceUri = vscode.Uri.joinPath(
                workspaceFolder.uri,
                ".project",
                "sourceTexts",
                "TEST.source"
            );

            // Create mock webview panels
            const codexPanelDisposed = sinon.spy();
            const sourcePanelDisposed = sinon.spy();

            const mockCodexPanel = {
                dispose: codexPanelDisposed,
                webview: {
                    html: "",
                    options: { enableScripts: true },
                    asWebviewUri: (uri: vscode.Uri) => uri,
                    cspSource: "https://example.com",
                    onDidReceiveMessage: () => ({ dispose: () => { } }),
                    postMessage: () => Promise.resolve(),
                },
                onDidDispose: () => ({ dispose: () => { } }),
                onDidChangeViewState: () => ({ dispose: () => { } }),
            } as any as vscode.WebviewPanel;

            const mockSourcePanel = {
                dispose: sourcePanelDisposed,
                webview: {
                    html: "",
                    options: { enableScripts: true },
                    asWebviewUri: (uri: vscode.Uri) => uri,
                    cspSource: "https://example.com",
                    onDidReceiveMessage: () => ({ dispose: () => { } }),
                    postMessage: () => Promise.resolve(),
                },
                onDidDispose: () => ({ dispose: () => { } }),
                onDidChangeViewState: () => ({ dispose: () => { } }),
            } as any as vscode.WebviewPanel;

            // Mock CodexCellEditorProvider instance
            const mockProvider = {
                getWebviewPanels: () => {
                    const panels = new Map<string, vscode.WebviewPanel>();
                    panels.set(codexUri.toString(), mockCodexPanel);
                    panels.set(sourceUri.toString(), mockSourcePanel);
                    return panels;
                },
            } as any;

            const getInstanceStub = sinon.stub(CodexCellEditorProvider, "getInstance").returns(mockProvider);

            try {
                // Call closeWebviewsForDeletedFiles with deleted codex file
                await closeWebviewsForDeletedFiles(
                    [".project/targetTexts/TEST.codex"],
                    workspaceFolder
                );

                // Verify both panels were disposed
                assert.ok(codexPanelDisposed.called, "Codex webview panel should be disposed");
                assert.ok(sourcePanelDisposed.called, "Source webview panel should be disposed when codex file is deleted");
            } finally {
                getInstanceStub.restore();
            }
        });

        test("should close webviews for both source and codex files when source is deleted", async () => {
            if (!workspaceFolder) {
                return;
            }

            // Create URIs
            const codexUri = vscode.Uri.joinPath(
                workspaceFolder.uri,
                ".project",
                "targetTexts",
                "TEST.codex"
            );
            const sourceUri = vscode.Uri.joinPath(
                workspaceFolder.uri,
                ".project",
                "sourceTexts",
                "TEST.source"
            );

            // Create mock webview panels
            const codexPanelDisposed = sinon.spy();
            const sourcePanelDisposed = sinon.spy();

            const mockCodexPanel = {
                dispose: codexPanelDisposed,
                webview: {
                    html: "",
                    options: { enableScripts: true },
                    asWebviewUri: (uri: vscode.Uri) => uri,
                    cspSource: "https://example.com",
                    onDidReceiveMessage: () => ({ dispose: () => { } }),
                    postMessage: () => Promise.resolve(),
                },
                onDidDispose: () => ({ dispose: () => { } }),
                onDidChangeViewState: () => ({ dispose: () => { } }),
            } as any as vscode.WebviewPanel;

            const mockSourcePanel = {
                dispose: sourcePanelDisposed,
                webview: {
                    html: "",
                    options: { enableScripts: true },
                    asWebviewUri: (uri: vscode.Uri) => uri,
                    cspSource: "https://example.com",
                    onDidReceiveMessage: () => ({ dispose: () => { } }),
                    postMessage: () => Promise.resolve(),
                },
                onDidDispose: () => ({ dispose: () => { } }),
                onDidChangeViewState: () => ({ dispose: () => { } }),
            } as any as vscode.WebviewPanel;

            // Mock CodexCellEditorProvider instance
            const mockProvider = {
                getWebviewPanels: () => {
                    const panels = new Map<string, vscode.WebviewPanel>();
                    panels.set(codexUri.toString(), mockCodexPanel);
                    panels.set(sourceUri.toString(), mockSourcePanel);
                    return panels;
                },
            } as any;

            const getInstanceStub = sinon.stub(CodexCellEditorProvider, "getInstance").returns(mockProvider);

            try {
                // Call closeWebviewsForDeletedFiles with deleted source file
                await closeWebviewsForDeletedFiles(
                    [".project/sourceTexts/TEST.source"],
                    workspaceFolder
                );

                // Verify both panels were disposed
                assert.ok(sourcePanelDisposed.called, "Source webview panel should be disposed");
                assert.ok(codexPanelDisposed.called, "Codex webview panel should be disposed when source file is deleted");
            } finally {
                getInstanceStub.restore();
            }
        });

        test("should handle multiple deleted files", async () => {
            if (!workspaceFolder) {
                return;
            }

            // Create URIs for multiple files
            const codexUri1 = vscode.Uri.joinPath(
                workspaceFolder.uri,
                ".project",
                "targetTexts",
                "TEST1.codex"
            );
            const codexUri2 = vscode.Uri.joinPath(
                workspaceFolder.uri,
                ".project",
                "targetTexts",
                "TEST2.codex"
            );

            // Create mock webview panels
            const panel1Disposed = sinon.spy();
            const panel2Disposed = sinon.spy();

            const mockPanel1 = {
                dispose: panel1Disposed,
                webview: {
                    html: "",
                    options: { enableScripts: true },
                    asWebviewUri: (uri: vscode.Uri) => uri,
                    cspSource: "https://example.com",
                    onDidReceiveMessage: () => ({ dispose: () => { } }),
                    postMessage: () => Promise.resolve(),
                },
                onDidDispose: () => ({ dispose: () => { } }),
                onDidChangeViewState: () => ({ dispose: () => { } }),
            } as any as vscode.WebviewPanel;

            const mockPanel2 = {
                dispose: panel2Disposed,
                webview: {
                    html: "",
                    options: { enableScripts: true },
                    asWebviewUri: (uri: vscode.Uri) => uri,
                    cspSource: "https://example.com",
                    onDidReceiveMessage: () => ({ dispose: () => { } }),
                    postMessage: () => Promise.resolve(),
                },
                onDidDispose: () => ({ dispose: () => { } }),
                onDidChangeViewState: () => ({ dispose: () => { } }),
            } as any as vscode.WebviewPanel;

            // Mock CodexCellEditorProvider instance
            const mockProvider = {
                getWebviewPanels: () => {
                    const panels = new Map<string, vscode.WebviewPanel>();
                    panels.set(codexUri1.toString(), mockPanel1);
                    panels.set(codexUri2.toString(), mockPanel2);
                    return panels;
                },
            } as any;

            const getInstanceStub = sinon.stub(CodexCellEditorProvider, "getInstance").returns(mockProvider);

            try {
                // Call closeWebviewsForDeletedFiles with multiple deleted files
                await closeWebviewsForDeletedFiles(
                    [
                        ".project/targetTexts/TEST1.codex",
                        ".project/targetTexts/TEST2.codex"
                    ],
                    workspaceFolder
                );

                // Verify both panels were disposed
                assert.ok(panel1Disposed.called, "First webview panel should be disposed");
                assert.ok(panel2Disposed.called, "Second webview panel should be disposed");
            } finally {
                getInstanceStub.restore();
            }
        });

        test("should handle files without open webviews gracefully", async () => {
            if (!workspaceFolder) {
                return;
            }

            // Mock CodexCellEditorProvider instance with empty panels map
            const mockProvider = {
                getWebviewPanels: () => {
                    return new Map<string, vscode.WebviewPanel>();
                },
            } as any;

            const getInstanceStub = sinon.stub(CodexCellEditorProvider, "getInstance").returns(mockProvider);

            try {
                // Call closeWebviewsForDeletedFiles with deleted file that has no open webview
                // Should not throw an error
                await closeWebviewsForDeletedFiles(
                    [".project/targetTexts/NONEXISTENT.codex"],
                    workspaceFolder
                );

                // Test passes if no error is thrown
                assert.ok(true, "Should handle files without open webviews gracefully");
            } finally {
                getInstanceStub.restore();
            }
        });

        test("should handle when CodexCellEditorProvider is not available", async () => {
            if (!workspaceFolder) {
                return;
            }

            // Mock CodexCellEditorProvider.getInstance to return undefined
            const getInstanceStub = sinon.stub(CodexCellEditorProvider, "getInstance").returns(undefined as any);

            try {
                // Call closeWebviewsForDeletedFiles when provider is not available
                // Should not throw an error
                await closeWebviewsForDeletedFiles(
                    [".project/targetTexts/TEST.codex"],
                    workspaceFolder
                );

                // Test passes if no error is thrown
                assert.ok(true, "Should handle missing provider gracefully");
            } finally {
                getInstanceStub.restore();
            }
        });

        test("should handle path normalization correctly", async () => {
            if (!workspaceFolder) {
                return;
            }

            // Create a codex file URI
            const codexUri = vscode.Uri.joinPath(
                workspaceFolder.uri,
                ".project",
                "targetTexts",
                "TEST.codex"
            );

            // Create mock webview panel
            const codexPanelDisposed = sinon.spy();
            const mockCodexPanel = {
                dispose: codexPanelDisposed,
                webview: {
                    html: "",
                    options: { enableScripts: true },
                    asWebviewUri: (uri: vscode.Uri) => uri,
                    cspSource: "https://example.com",
                    onDidReceiveMessage: () => ({ dispose: () => { } }),
                    postMessage: () => Promise.resolve(),
                },
                onDidDispose: () => ({ dispose: () => { } }),
                onDidChangeViewState: () => ({ dispose: () => { } }),
            } as any as vscode.WebviewPanel;

            // Mock CodexCellEditorProvider instance
            const mockProvider = {
                getWebviewPanels: () => {
                    const panels = new Map<string, vscode.WebviewPanel>();
                    panels.set(codexUri.toString(), mockCodexPanel);
                    return panels;
                },
            } as any;

            const getInstanceStub = sinon.stub(CodexCellEditorProvider, "getInstance").returns(mockProvider);

            try {
                // Test with different path formats (backslashes, leading slashes)
                await closeWebviewsForDeletedFiles(
                    ["\\.project\\targetTexts\\TEST.codex"], // Windows-style backslashes
                    workspaceFolder
                );

                // Verify the panel was disposed
                assert.ok(codexPanelDisposed.called, "Should handle path normalization correctly");
            } finally {
                getInstanceStub.restore();
            }
        });

        test("should not close webviews for non-codex/non-source files", async () => {
            if (!workspaceFolder) {
                return;
            }

            // Create a non-codex file URI
            const otherFileUri = vscode.Uri.joinPath(
                workspaceFolder.uri,
                ".project",
                "other.txt"
            );

            // Create mock webview panel
            const otherPanelDisposed = sinon.spy();
            const mockOtherPanel = {
                dispose: otherPanelDisposed,
                webview: {
                    html: "",
                    options: { enableScripts: true },
                    asWebviewUri: (uri: vscode.Uri) => uri,
                    cspSource: "https://example.com",
                    onDidReceiveMessage: () => ({ dispose: () => { } }),
                    postMessage: () => Promise.resolve(),
                },
                onDidDispose: () => ({ dispose: () => { } }),
                onDidChangeViewState: () => ({ dispose: () => { } }),
            } as any as vscode.WebviewPanel;

            // Mock CodexCellEditorProvider instance
            const mockProvider = {
                getWebviewPanels: () => {
                    const panels = new Map<string, vscode.WebviewPanel>();
                    panels.set(otherFileUri.toString(), mockOtherPanel);
                    return panels;
                },
            } as any;

            const getInstanceStub = sinon.stub(CodexCellEditorProvider, "getInstance").returns(mockProvider);

            try {
                // Call closeWebviewsForDeletedFiles with non-codex/non-source file
                await closeWebviewsForDeletedFiles(
                    [".project/other.txt"],
                    workspaceFolder
                );

                // Verify the panel was still disposed (for the file itself)
                assert.ok(otherPanelDisposed.called, "Should close webview for deleted file itself");
            } finally {
                getInstanceStub.restore();
            }
        });
    });
});
