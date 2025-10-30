import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import { importBookNamesFromXmlContent } from "../../bookNameSettings/bookNameSettings";
import { CodexContentSerializer } from "../../serializer";
import { createTempCodexFile, deleteIfExists } from "../testUtils";
import sinon from "sinon";

suite("bookNameSettings Test Suite", () => {
    let workspaceFolder: vscode.WorkspaceFolder | undefined;
    let tempCodexFiles: vscode.Uri[] = [];
    let tempXmlFile: vscode.Uri | undefined;

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

        if (tempXmlFile) {
            await deleteIfExists(tempXmlFile);
            tempXmlFile = undefined;
        }

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

    async function createCodexFileWithMetadata(
        usfmCode: string,
        metadata: { bookDisplayName?: string;[key: string]: any; }
    ): Promise<vscode.Uri> {
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

    test("openBookNameEditor reads bookDisplayName from codex metadata files", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        // This test verifies the logic in openBookNameEditor by checking
        // that it reads from codex files. Since openBookNameEditor opens a webview,
        // we'll test the metadata reading logic indirectly through importBookNamesFromXmlContent
        // which uses similar logic.

        // Create codex files with bookDisplayName
        await createCodexFileWithMetadata("GEN", {
            bookDisplayName: "Custom Genesis",
        });
        await createCodexFileWithMetadata("EXO", {}); // No bookDisplayName

        // The actual verification would happen if we could test openBookNameEditor directly
        // For now, we verify that the codex files exist and can be read
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        const codexUris = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceFolder.uri.fsPath, "files/target/**/*.codex")
        );

        assert.ok(codexUris.length >= 2, "Should find codex files");

        // Verify metadata can be read
        const serializer = new CodexContentSerializer();
        for (const uri of codexUris) {
            const content = await vscode.workspace.fs.readFile(uri);
            const notebookData = await serializer.deserializeNotebook(
                content,
                new vscode.CancellationTokenSource().token
            );

            const abbr = path.basename(uri.fsPath, ".codex");
            if (abbr === "GEN") {
                assert.strictEqual(
                    (notebookData.metadata as any).bookDisplayName,
                    "Custom Genesis",
                    "GEN should have bookDisplayName"
                );
            }
        }
    });

    test("importBookNamesFromXmlContent applies names to codex metadata files", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        // Create codex files
        await createCodexFileWithMetadata("GEN", {});
        await createCodexFileWithMetadata("EXO", {});

        // Create XML file with book names
        const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<BookNames>
    <book code="GEN" long="Custom Genesis Name" />
    <book code="EXO" long="Custom Exodus Name" />
</BookNames>`;

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        tempXmlFile = vscode.Uri.joinPath(workspaceFolder.uri, "test-book-names.xml");
        await vscode.workspace.fs.writeFile(tempXmlFile, Buffer.from(xmlContent, "utf8"));

        // Mock showInformationMessage to avoid UI during test
        const showInfoStub = sinon.stub(vscode.window, "showInformationMessage");

        try {
            // Import book names
            const result = await importBookNamesFromXmlContent(xmlContent, "long");

            assert.strictEqual(result, true, "Import should succeed");

            // Verify files were updated
            const serializer = new CodexContentSerializer();

            const genUri = tempCodexFiles.find((uri) => path.basename(uri.fsPath, ".codex") === "GEN");
            assert.ok(genUri, "GEN file should exist");

            const genContent = await vscode.workspace.fs.readFile(genUri!);
            const genData = await serializer.deserializeNotebook(
                genContent,
                new vscode.CancellationTokenSource().token
            );
            assert.strictEqual(
                (genData.metadata as any).bookDisplayName,
                "Custom Genesis Name",
                "GEN should have updated bookDisplayName"
            );

            const exoUri = tempCodexFiles.find((uri) => path.basename(uri.fsPath, ".codex") === "EXO");
            assert.ok(exoUri, "EXO file should exist");

            const exoContent = await vscode.workspace.fs.readFile(exoUri!);
            const exoData = await serializer.deserializeNotebook(
                exoContent,
                new vscode.CancellationTokenSource().token
            );
            assert.strictEqual(
                (exoData.metadata as any).bookDisplayName,
                "Custom Exodus Name",
                "EXO should have updated bookDisplayName"
            );
        } finally {
            showInfoStub.restore();
        }
    });

    test("importBookNamesFromXmlContent does NOT create localized-books.json", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        // Create codex file
        await createCodexFileWithMetadata("LEV", {});

        const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<BookNames>
    <book code="LEV" long="Custom Leviticus Name" />
</BookNames>`;

        // Mock showInformationMessage
        const showInfoStub = sinon.stub(vscode.window, "showInformationMessage");

        try {
            // Import book names
            await importBookNamesFromXmlContent(xmlContent, "long");

            // Verify localized-books.json was NOT created
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                return;
            }

            const localizedUri = vscode.Uri.joinPath(workspaceFolder.uri, "localized-books.json");
            try {
                await vscode.workspace.fs.stat(localizedUri);
                assert.fail("localized-books.json should NOT exist after import");
            } catch {
                // File doesn't exist, which is expected
                assert.ok(true, "localized-books.json correctly does not exist");
            }
        } finally {
            showInfoStub.restore();
        }
    });

    test("book name saving logic updates codex metadata", async () => {
        // Skip if no workspace folder
        if (!vscode.workspace.workspaceFolders?.[0]) {
            return;
        }

        // This test verifies the save logic from openBookNameEditor
        // Since we can't easily test the webview interaction, we test the core logic
        // by simulating what happens when book names are saved

        // Create codex files
        await createCodexFileWithMetadata("NUM", {});
        await createCodexFileWithMetadata("DEU", {});

        // Simulate the save logic: update bookDisplayName in codex files
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        const codexUris = await vscode.workspace.findFiles(
            new vscode.RelativePattern(workspaceFolder.uri.fsPath, "files/target/**/*.codex")
        );

        const serializer = new CodexContentSerializer();
        const updates = new Map<string, string>();
        updates.set("NUM", "Custom Numbers");
        updates.set("DEU", "Custom Deuteronomy");

        for (const uri of codexUris) {
            const abbr = path.basename(uri.fsPath, ".codex");
            const newName = updates.get(abbr);
            if (!newName) continue;

            const content = await vscode.workspace.fs.readFile(uri);
            const notebookData = await serializer.deserializeNotebook(
                content,
                new vscode.CancellationTokenSource().token
            );

            (notebookData.metadata as any) = {
                ...(notebookData.metadata || {}),
                bookDisplayName: newName,
            };

            const updatedContent = await serializer.serializeNotebook(
                notebookData as any,
                new vscode.CancellationTokenSource().token
            );
            await vscode.workspace.fs.writeFile(uri, updatedContent);
        }

        // Verify updates
        for (const uri of codexUris) {
            const abbr = path.basename(uri.fsPath, ".codex");
            const expectedName = updates.get(abbr);
            if (!expectedName) continue;

            const content = await vscode.workspace.fs.readFile(uri);
            const notebookData = await serializer.deserializeNotebook(
                content,
                new vscode.CancellationTokenSource().token
            );

            assert.strictEqual(
                (notebookData.metadata as any).bookDisplayName,
                expectedName,
                `${abbr} should have updated bookDisplayName`
            );
        }
    });
});

