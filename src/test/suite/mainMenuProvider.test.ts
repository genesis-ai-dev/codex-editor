import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { MainMenuProvider } from "../../providers/mainMenu/mainMenuProvider";
import { MetadataManager } from "../../utils/metadataManager";
import { NotebookMetadataManager } from "../../utils/notebookMetadataManager";
import { createMockExtensionContext } from "../testUtils";
import { ProjectManagerMessageFromWebview, ProjectEditHistory } from "../../../types";
import { EditMapUtils } from "../../utils/editMapUtils";
import { EditType } from "../../../types/enums";
import sinon from "sinon";

// Type helper for accessing private methods in tests
type MainMenuProviderPrivate = {
    updateProjectOverview: () => Promise<void>;
    handleChangeProjectName: (newProjectName: string) => Promise<void>;
    handleProjectManagerMessage: (message: ProjectManagerMessageFromWebview) => Promise<void>;
    store: MainMenuProvider["store"];
};

// Type for mock configuration
type MockWorkspaceConfiguration = {
    update: sinon.SinonStub;
    get: sinon.SinonStub;
} & Partial<vscode.WorkspaceConfiguration>;

suite("MainMenuProvider - Project Name Change Tests", () => {
    let context: vscode.ExtensionContext;
    let provider: MainMenuProvider;
    let testWorkspaceUri: vscode.Uri;
    let metadataPath: vscode.Uri;
    let testTempDir: vscode.Uri;
    let sandbox: sinon.SinonSandbox;

    setup(async () => {
        // Reset NotebookMetadataManager singleton before each test
        NotebookMetadataManager.resetInstance();

        // Create temporary test workspace
        const tempDir = path.join(__dirname, "..", "..", "..", "test-temp", `mainmenu-test-${Date.now()}`);
        await fs.promises.mkdir(tempDir, { recursive: true });
        testWorkspaceUri = vscode.Uri.file(tempDir);
        metadataPath = vscode.Uri.joinPath(testWorkspaceUri, "metadata.json");
        testTempDir = vscode.Uri.file(path.join(__dirname, "..", "..", "..", "test-temp"));

        // Create initial metadata.json
        const initialMetadata = {
            projectName: "Original Project Name",
            meta: {
                version: "0.0.0",
                generator: {
                    softwareName: "Codex Editor",
                    userName: "Test User",
                    userEmail: "test@example.com",
                },
            },
        };
        await vscode.workspace.fs.writeFile(
            metadataPath,
            new TextEncoder().encode(JSON.stringify(initialMetadata, null, 4))
        );

        context = createMockExtensionContext();

        // Initialize NotebookMetadataManager before creating MainMenuProvider
        // This is required because ProjectManagerStore uses it in its constructor
        const storageUri = vscode.Uri.joinPath(testWorkspaceUri, "notebook_metadata.json");
        NotebookMetadataManager.getInstance(context, storageUri);

        sandbox = sinon.createSandbox();
        provider = new MainMenuProvider(context);
    });

    teardown(async () => {
        if (sandbox) {
            sandbox.restore();
        }
        // Reset NotebookMetadataManager singleton after each test
        NotebookMetadataManager.resetInstance();
        // Cleanup test files - explicitly delete metadata.json first
        try {
            if (metadataPath) {
                try {
                    await vscode.workspace.fs.delete(metadataPath);
                } catch (error) {
                    // Ignore if file doesn't exist
                }
            }
            // Then delete the entire test directory
            if (testWorkspaceUri) {
                await vscode.workspace.fs.delete(testWorkspaceUri, { recursive: true });
            }
            // Finally, try to delete the test-temp folder if it's empty
            if (testTempDir) {
                try {
                    await vscode.workspace.fs.delete(testTempDir, { recursive: true });
                } catch (error) {
                    // Ignore if folder doesn't exist or is not empty (other tests may be using it)
                }
            }
        } catch (error) {
            // Ignore cleanup errors
        }
    });

    test("should handle missing workspace folder", async () => {
        // Mock no workspace folders
        sandbox.stub(vscode.workspace, "workspaceFolders").value(undefined);

        const showErrorStub = sandbox.stub(vscode.window, "showErrorMessage");

        await provider["handleChangeProjectName"]("New Project Name");

        // Verify error message was shown
        assert.strictEqual(showErrorStub.calledOnce, true);
        assert.ok(showErrorStub.firstCall.args[0].includes("No workspace folder found"));
    });

    test("should handle metadata update failure", async () => {
        // Mock workspace folders
        const mockWorkspaceFolder: vscode.WorkspaceFolder = {
            uri: testWorkspaceUri,
            name: "test-workspace",
            index: 0,
        };
        sandbox.stub(vscode.workspace, "workspaceFolders").value([mockWorkspaceFolder]);

        // Mock configuration
        const mockConfig: MockWorkspaceConfiguration = {
            update: sandbox.stub().resolves(),
            get: sandbox.stub().returns("Original Project Name"),
        };
        sandbox.stub(vscode.workspace, "getConfiguration").returns(mockConfig as vscode.WorkspaceConfiguration);

        // Mock MetadataManager to fail
        const safeUpdateMetadataStub = sandbox
            .stub(MetadataManager, "safeUpdateMetadata")
            .resolves({ success: false, error: "Failed to write metadata" });

        const showErrorStub = sandbox.stub(vscode.window, "showErrorMessage");
        const showInfoStub = sandbox.stub(vscode.window, "showInformationMessage");

        await provider["handleChangeProjectName"]("New Project Name");

        // Verify error message was shown
        assert.strictEqual(showErrorStub.calledOnce, true);
        assert.ok(showErrorStub.firstCall.args[0].includes("Failed to update project name"));

        // Verify success message was NOT shown
        assert.strictEqual(showInfoStub.called, false);

        // Verify metadata.json was NOT updated
        const content = await vscode.workspace.fs.readFile(metadataPath);
        const metadata = JSON.parse(new TextDecoder().decode(content));
        assert.strictEqual(metadata.projectName, "Original Project Name");
    });

    test("should handle write error gracefully", async () => {
        // Mock workspace folders
        const mockWorkspaceFolder: vscode.WorkspaceFolder = {
            uri: testWorkspaceUri,
            name: "test-workspace",
            index: 0,
        };
        sandbox.stub(vscode.workspace, "workspaceFolders").value([mockWorkspaceFolder]);

        // Mock configuration
        const mockConfig: MockWorkspaceConfiguration = {
            update: sandbox.stub().resolves(),
            get: sandbox.stub().returns("Original Project Name"),
        };
        sandbox.stub(vscode.workspace, "getConfiguration").returns(mockConfig as vscode.WorkspaceConfiguration);

        // Mock MetadataManager to throw an error
        const safeUpdateMetadataStub = sandbox
            .stub(MetadataManager, "safeUpdateMetadata")
            .rejects(new Error("File system error"));

        const showErrorStub = sandbox.stub(vscode.window, "showErrorMessage").resolves(undefined);

        await provider["handleChangeProjectName"]("New Project Name");

        // Verify error message was shown
        assert.strictEqual(showErrorStub.calledOnce, true);
        assert.ok(showErrorStub.firstCall.args[0].includes("Failed to update project name"));
    });

    test("should preserve other metadata fields when updating project name", async () => {
        // Mock workspace folders
        const mockWorkspaceFolder: vscode.WorkspaceFolder = {
            uri: testWorkspaceUri,
            name: "test-workspace",
            index: 0,
        };
        sandbox.stub(vscode.workspace, "workspaceFolders").value([mockWorkspaceFolder]);

        // Mock configuration
        const mockConfig: MockWorkspaceConfiguration = {
            update: sandbox.stub().resolves(),
            get: sandbox.stub().returns("Original Project Name"),
        };
        sandbox.stub(vscode.workspace, "getConfiguration").returns(mockConfig as vscode.WorkspaceConfiguration);

        // Mock window methods
        sandbox.stub(vscode.window, "showInformationMessage");
        sandbox.stub(vscode.window, "showErrorMessage");

        // Mock store refresh methods
        sandbox.stub(provider["store"], "refreshState").resolves();
        sandbox
            .stub(provider as unknown as MainMenuProviderPrivate, "updateProjectOverview")
            .resolves();

        // Call handleChangeProjectName
        await provider["handleChangeProjectName"]("Updated Project Name");

        // Verify metadata.json was updated correctly
        const updatedContent = await vscode.workspace.fs.readFile(metadataPath);
        const updatedMetadata = JSON.parse(new TextDecoder().decode(updatedContent));

        // Verify project name was updated
        assert.strictEqual(updatedMetadata.projectName, "Updated Project Name");

        // Verify other fields were preserved
        assert.strictEqual(updatedMetadata.meta.version, "0.0.0");
        assert.strictEqual(updatedMetadata.meta.generator.softwareName, "Codex Editor");
        assert.strictEqual(updatedMetadata.meta.generator.userName, "Test User");
        assert.strictEqual(updatedMetadata.meta.generator.userEmail, "test@example.com");
    });

    test("should handle changeProjectName message command", async () => {
        // Mock workspace folders
        const mockWorkspaceFolder: vscode.WorkspaceFolder = {
            uri: testWorkspaceUri,
            name: "test-workspace",
            index: 0,
        };
        sandbox.stub(vscode.workspace, "workspaceFolders").value([mockWorkspaceFolder]);

        // Mock configuration
        const mockConfig: MockWorkspaceConfiguration = {
            update: sandbox.stub().resolves(),
            get: sandbox.stub().returns("Original Project Name"),
        };
        sandbox.stub(vscode.workspace, "getConfiguration").returns(mockConfig as vscode.WorkspaceConfiguration);

        // Mock window methods
        sandbox.stub(vscode.window, "showInformationMessage");
        sandbox.stub(vscode.window, "showErrorMessage");

        // Mock store refresh methods
        sandbox.stub(provider["store"], "refreshState").resolves();
        sandbox
            .stub(provider as unknown as MainMenuProviderPrivate, "updateProjectOverview")
            .resolves();

        // Create message handler spy
        const handleChangeProjectNameSpy = sandbox.spy(
            provider as unknown as MainMenuProviderPrivate,
            "handleChangeProjectName"
        );

        // Simulate message from webview
        const message: ProjectManagerMessageFromWebview = {
            command: "changeProjectName",
            projectName: "New Project Name",
        };

        await (provider as unknown as MainMenuProviderPrivate).handleProjectManagerMessage(message);

        // Verify handleChangeProjectName was called with correct argument
        assert.strictEqual(handleChangeProjectNameSpy.calledOnce, true);
        assert.strictEqual(handleChangeProjectNameSpy.firstCall.args[0], "New Project Name");
    });

    suite("Project metadata edits array", () => {
        test("handleChangeProjectName creates edit entries in metadata.edits array", async () => {
            // Mock workspace folders
            const mockWorkspaceFolder: vscode.WorkspaceFolder = {
                uri: testWorkspaceUri,
                name: "test-workspace",
                index: 0,
            };
            sandbox.stub(vscode.workspace, "workspaceFolders").value([mockWorkspaceFolder]);

            // Mock configuration
            const mockConfig: MockWorkspaceConfiguration = {
                update: sandbox.stub().resolves(),
                get: sandbox.stub().returns("Original Project Name"),
            };
            sandbox.stub(vscode.workspace, "getConfiguration").returns(mockConfig as vscode.WorkspaceConfiguration);

            // Mock window methods
            sandbox.stub(vscode.window, "showInformationMessage");
            sandbox.stub(vscode.window, "showErrorMessage");

            // Mock store refresh methods
            sandbox.stub(provider["store"], "refreshState").resolves();
            sandbox
                .stub(provider as unknown as MainMenuProviderPrivate, "updateProjectOverview")
                .resolves();

            // Read initial metadata to verify no edits exist
            const beforeContent = await vscode.workspace.fs.readFile(metadataPath);
            const beforeMetadata = JSON.parse(new TextDecoder().decode(beforeContent));
            assert.ok(!beforeMetadata.edits || beforeMetadata.edits.length === 0, "Metadata should have no prior edits");

            const newProjectName = "New Project Name";

            // Call handleChangeProjectName
            await provider["handleChangeProjectName"](newProjectName);

            // Read updated metadata
            const afterContent = await vscode.workspace.fs.readFile(metadataPath);
            const afterMetadata = JSON.parse(new TextDecoder().decode(afterContent));
            const edits: ProjectEditHistory<["projectName"]>[] = afterMetadata.edits || [];

            assert.ok(edits.length >= 1, "Should create edit entry for projectName");

            const projectNameEdit = edits.find((e) => EditMapUtils.equals(e.editMap, EditMapUtils.projectName()));

            assert.ok(projectNameEdit, "Should have projectName edit entry");
            assert.strictEqual(projectNameEdit!.value, newProjectName, "ProjectName edit should have correct value");
            assert.strictEqual(projectNameEdit!.type, EditType.USER_EDIT, "Edit should be USER_EDIT type");
            assert.ok(typeof projectNameEdit!.timestamp === "number", "Edit should have timestamp");
            assert.ok(projectNameEdit!.timestamp > 0, "Timestamp should be positive");
            assert.ok(typeof projectNameEdit!.author === "string", "Edit should have author");
            assert.ok(projectNameEdit!.author.length > 0, "Author should not be empty");

            // Verify metadata value was updated
            assert.strictEqual(afterMetadata.projectName, newProjectName, "ProjectName should be updated");
        });

        test("handleChangeProjectName edits persist after save", async () => {
            // Mock workspace folders
            const mockWorkspaceFolder: vscode.WorkspaceFolder = {
                uri: testWorkspaceUri,
                name: "test-workspace",
                index: 0,
            };
            sandbox.stub(vscode.workspace, "workspaceFolders").value([mockWorkspaceFolder]);

            // Mock configuration
            const mockConfig: MockWorkspaceConfiguration = {
                update: sandbox.stub().resolves(),
                get: sandbox.stub().returns("Original Project Name"),
            };
            sandbox.stub(vscode.workspace, "getConfiguration").returns(mockConfig as vscode.WorkspaceConfiguration);

            // Mock window methods
            sandbox.stub(vscode.window, "showInformationMessage");
            sandbox.stub(vscode.window, "showErrorMessage");

            // Mock store refresh methods
            sandbox.stub(provider["store"], "refreshState").resolves();
            sandbox
                .stub(provider as unknown as MainMenuProviderPrivate, "updateProjectOverview")
                .resolves();

            const newProjectName = "Persisted Project Name";

            // Call handleChangeProjectName
            await provider["handleChangeProjectName"](newProjectName);

            // Read file content from disk to verify persisted state
            const persistedContent = await vscode.workspace.fs.readFile(metadataPath);
            const persisted = JSON.parse(new TextDecoder().decode(persistedContent));

            assert.ok(persisted.edits, "Metadata should have edits array");
            const edits: ProjectEditHistory<["projectName"]>[] = persisted.edits;

            const projectNameEdit = edits.find((e) => EditMapUtils.equals(e.editMap, EditMapUtils.projectName()));

            assert.ok(projectNameEdit, "ProjectName edit should persist after save");
            assert.strictEqual(projectNameEdit!.value, newProjectName, "Persisted projectName edit should have correct value");
            assert.strictEqual(projectNameEdit!.type, EditType.USER_EDIT, "Persisted edit should be USER_EDIT type");
            assert.ok(typeof projectNameEdit!.timestamp === "number", "Persisted edit should have timestamp");
            assert.ok(typeof projectNameEdit!.author === "string", "Persisted edit should have author");

            // Verify metadata value was persisted
            assert.strictEqual(persisted.projectName, newProjectName, "ProjectName should be persisted");
        });

        test("handleChangeProjectName creates multiple edit entries for multiple changes", async () => {
            // Mock workspace folders
            const mockWorkspaceFolder: vscode.WorkspaceFolder = {
                uri: testWorkspaceUri,
                name: "test-workspace",
                index: 0,
            };
            sandbox.stub(vscode.workspace, "workspaceFolders").value([mockWorkspaceFolder]);

            // Mock configuration
            const mockConfig: MockWorkspaceConfiguration = {
                update: sandbox.stub().resolves(),
                get: sandbox.stub().returns("Original Project Name"),
            };
            sandbox.stub(vscode.workspace, "getConfiguration").returns(mockConfig as vscode.WorkspaceConfiguration);

            // Mock window methods
            sandbox.stub(vscode.window, "showInformationMessage");
            sandbox.stub(vscode.window, "showErrorMessage");

            // Mock store refresh methods
            sandbox.stub(provider["store"], "refreshState").resolves();
            sandbox
                .stub(provider as unknown as MainMenuProviderPrivate, "updateProjectOverview")
                .resolves();

            const firstProjectName = "First Project Name";
            const secondProjectName = "Second Project Name";

            // Call handleChangeProjectName twice
            await provider["handleChangeProjectName"](firstProjectName);
            await provider["handleChangeProjectName"](secondProjectName);

            // Read updated metadata
            const afterContent = await vscode.workspace.fs.readFile(metadataPath);
            const afterMetadata = JSON.parse(new TextDecoder().decode(afterContent));
            const edits: ProjectEditHistory<["projectName"]>[] = afterMetadata.edits || [];

            // Should have at least 2 edits (may have more if deduplication doesn't remove them due to different timestamps)
            assert.ok(edits.length >= 2, "Should create multiple edit entries for multiple changes");

            const projectNameEdits = edits.filter((e) => EditMapUtils.equals(e.editMap, EditMapUtils.projectName()));

            assert.ok(projectNameEdits.length >= 2, "Should have multiple projectName edits");
            assert.ok(projectNameEdits.some((e) => e.value === firstProjectName), "Should have first projectName edit");
            assert.ok(projectNameEdits.some((e) => e.value === secondProjectName), "Should have second projectName edit");

            // Verify latest value is applied
            assert.strictEqual(afterMetadata.projectName, secondProjectName, "Latest projectName should be applied");
        });

        test("handleChangeProjectName does not create edit if projectName unchanged", async () => {
            // Mock workspace folders
            const mockWorkspaceFolder: vscode.WorkspaceFolder = {
                uri: testWorkspaceUri,
                name: "test-workspace",
                index: 0,
            };
            sandbox.stub(vscode.workspace, "workspaceFolders").value([mockWorkspaceFolder]);

            // Mock configuration to return the same name
            const originalProjectName = "Original Project Name";
            const mockConfig: MockWorkspaceConfiguration = {
                update: sandbox.stub().resolves(),
                get: sandbox.stub().returns(originalProjectName),
            };
            sandbox.stub(vscode.workspace, "getConfiguration").returns(mockConfig as vscode.WorkspaceConfiguration);

            // Mock window methods
            sandbox.stub(vscode.window, "showInformationMessage");
            sandbox.stub(vscode.window, "showErrorMessage");

            // Mock store refresh methods
            sandbox.stub(provider["store"], "refreshState").resolves();
            sandbox
                .stub(provider as unknown as MainMenuProviderPrivate, "updateProjectOverview")
                .resolves();

            // Read initial metadata
            const beforeContent = await vscode.workspace.fs.readFile(metadataPath);
            const beforeMetadata = JSON.parse(new TextDecoder().decode(beforeContent));
            const beforeEditsCount = beforeMetadata.edits ? beforeMetadata.edits.length : 0;

            // Call handleChangeProjectName with the same name
            await provider["handleChangeProjectName"](originalProjectName);

            // Read updated metadata
            const afterContent = await vscode.workspace.fs.readFile(metadataPath);
            const afterMetadata = JSON.parse(new TextDecoder().decode(afterContent));
            const afterEditsCount = afterMetadata.edits ? afterMetadata.edits.length : 0;

            // Should not create a new edit if the value hasn't changed
            // Note: The implementation may still create an edit, but we verify the behavior
            const projectNameEdits = (afterMetadata.edits || []).filter((e: ProjectEditHistory) =>
                EditMapUtils.equals(e.editMap, EditMapUtils.projectName())
            );

            // The implementation checks if originalProjectName !== newProjectName before creating edit
            // So if they're the same, no edit should be created
            assert.strictEqual(
                projectNameEdits.length,
                beforeEditsCount,
                "Should not create new edit if projectName unchanged"
            );
        });
    });
});

