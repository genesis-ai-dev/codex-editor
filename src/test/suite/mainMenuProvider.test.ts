import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { MainMenuProvider } from "../../providers/mainMenu/mainMenuProvider";
import { MetadataManager } from "../../utils/metadataManager";
import { NotebookMetadataManager } from "../../utils/notebookMetadataManager";
import { createMockExtensionContext } from "../testUtils";
import { ProjectManagerMessageFromWebview } from "../../../types";
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

    test("should update project name successfully", async () => {
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
        const showInfoStub = sandbox.stub(vscode.window, "showInformationMessage");
        const showErrorStub = sandbox.stub(vscode.window, "showErrorMessage");

        // Mock store refresh methods
        const refreshStateStub = sandbox.stub(provider["store"], "refreshState").resolves();
        const updateProjectOverviewStub = sandbox
            .stub(provider as unknown as MainMenuProviderPrivate, "updateProjectOverview")
            .resolves();

        // Call handleChangeProjectName
        await provider["handleChangeProjectName"]("New Project Name");

        // Verify configuration was updated
        assert.strictEqual(mockConfig.update.calledOnce, true);
        assert.strictEqual(mockConfig.update.firstCall.args[0], "projectName");
        assert.strictEqual(mockConfig.update.firstCall.args[1], "New Project Name");
        assert.strictEqual(mockConfig.update.firstCall.args[2], vscode.ConfigurationTarget.Workspace);

        // Verify metadata.json was updated
        const updatedContent = await vscode.workspace.fs.readFile(metadataPath);
        const updatedMetadata = JSON.parse(new TextDecoder().decode(updatedContent));
        assert.strictEqual(updatedMetadata.projectName, "New Project Name");

        // Verify state was refreshed
        assert.strictEqual(refreshStateStub.calledOnce, true);
        assert.strictEqual(updateProjectOverviewStub.calledOnce, true);

        // Verify success message was shown
        assert.strictEqual(showInfoStub.calledOnce, true);
        assert.ok(showInfoStub.firstCall.args[0].includes("New Project Name"));
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

        const showErrorStub = sandbox.stub(vscode.window, "showErrorMessage");

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
});

