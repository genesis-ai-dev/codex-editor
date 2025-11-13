import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { updateMetadataFile } from "../../projectManager/utils/projectUtils";
import { ProjectEditHistory } from "../../../types";
import { EditMapUtils } from "../../utils/editMapUtils";
import { EditType } from "../../../types/enums";
import sinon from "sinon";

// Type for mock configuration
type MockWorkspaceConfiguration = {
    update: sinon.SinonStub;
    get: sinon.SinonStub;
} & Partial<vscode.WorkspaceConfiguration>;

suite("ProjectUtils - updateMetadataFile Tests", () => {
    let testWorkspaceUri: vscode.Uri;
    let metadataPath: vscode.Uri;
    let testTempDir: vscode.Uri;
    let sandbox: sinon.SinonSandbox;

    setup(async () => {
        // Create temporary test workspace
        const tempDir = path.join(__dirname, "..", "..", "..", "test-temp", `projectutils-test-${Date.now()}`);
        await fs.promises.mkdir(tempDir, { recursive: true });
        testWorkspaceUri = vscode.Uri.file(tempDir);
        metadataPath = vscode.Uri.joinPath(testWorkspaceUri, "metadata.json");
        testTempDir = vscode.Uri.file(path.join(__dirname, "..", "..", "..", "test-temp"));

        // Create initial metadata.json
        const initialMetadata = {
            projectName: "Original Project Name",
            languages: ["en", "fr"],
            spellcheckIsEnabled: false,
            meta: {
                version: "0.0.0",
                generator: {
                    softwareName: "Codex Editor",
                    userName: "Original User",
                    userEmail: "original@example.com",
                },
                validationCount: 1,
                validationCountAudio: 1,
                abbreviation: "ORIG",
            },
        };
        await vscode.workspace.fs.writeFile(
            metadataPath,
            new TextEncoder().encode(JSON.stringify(initialMetadata, null, 4))
        );

        sandbox = sinon.createSandbox();

        // Mock workspace folders
        const mockWorkspaceFolder: vscode.WorkspaceFolder = {
            uri: testWorkspaceUri,
            name: "test-workspace",
            index: 0,
        };
        sandbox.stub(vscode.workspace, "workspaceFolders").value([mockWorkspaceFolder]);

        // Mock window methods to prevent UI popups
        sandbox.stub(vscode.window, "showErrorMessage");
    });

    teardown(async () => {
        if (sandbox) {
            sandbox.restore();
        }
        // Cleanup test files
        try {
            if (metadataPath) {
                try {
                    await vscode.workspace.fs.delete(metadataPath);
                } catch (error) {
                    // Ignore if file doesn't exist
                }
            }
            if (testWorkspaceUri) {
                await vscode.workspace.fs.delete(testWorkspaceUri, { recursive: true });
            }
            if (testTempDir) {
                try {
                    await vscode.workspace.fs.delete(testTempDir, { recursive: true });
                } catch (error) {
                    // Ignore if folder doesn't exist or is not empty
                }
            }
        } catch (error) {
            // Ignore cleanup errors
        }
    });

    suite("Project metadata edits array", () => {
        test("updateMetadataFile creates edit entry for projectName changes", async () => {
            // Mock configuration
            const mockConfig: MockWorkspaceConfiguration = {
                update: sandbox.stub().resolves(),
                get: sandbox.stub().callsFake((key: string) => {
                    if (key === "projectName") return "New Project Name";
                    if (key === "userName") return "Original User";
                    if (key === "userEmail") return "original@example.com";
                    if (key === "sourceLanguage") return "en";
                    if (key === "targetLanguage") return "fr";
                    if (key === "abbreviation") return "ORIG";
                    if (key === "spellcheckIsEnabled") return false;
                    if (key === "validationCount") return 1;
                    if (key === "validationCountAudio") return 1;
                    return undefined;
                }),
            };

            // Mock git configuration for getCurrentUserName
            const gitConfig: MockWorkspaceConfiguration = {
                update: sandbox.stub().resolves(),
                get: sandbox.stub().returns("test-author"),
            };

            // Stub getConfiguration to return different configs based on section
            sandbox.stub(vscode.workspace, "getConfiguration").callsFake((section?: string) => {
                if (section === "git") {
                    return gitConfig as vscode.WorkspaceConfiguration;
                }
                if (section === "codex-project-manager") {
                    return mockConfig as vscode.WorkspaceConfiguration;
                }
                return mockConfig as vscode.WorkspaceConfiguration;
            });

            // Read initial metadata
            const beforeContent = await vscode.workspace.fs.readFile(metadataPath);
            const beforeMetadata = JSON.parse(new TextDecoder().decode(beforeContent));
            assert.ok(!beforeMetadata.edits || beforeMetadata.edits.length === 0, "Metadata should have no prior edits");

            // Call updateMetadataFile
            await updateMetadataFile();

            // Read updated metadata
            const afterContent = await vscode.workspace.fs.readFile(metadataPath);
            const afterMetadata = JSON.parse(new TextDecoder().decode(afterContent));
            const edits: ProjectEditHistory[] = afterMetadata.edits || [];

            assert.ok(edits.length >= 1, "Should create edit entry for projectName");

            const projectNameEdit = edits.find((e) => EditMapUtils.equals(e.editMap, EditMapUtils.projectName()));

            assert.ok(projectNameEdit, "Should have projectName edit entry");
            assert.strictEqual(projectNameEdit!.value, "New Project Name", "ProjectName edit should have correct value");
            assert.strictEqual(projectNameEdit!.type, EditType.USER_EDIT, "Edit should be USER_EDIT type");
            assert.ok(typeof projectNameEdit!.timestamp === "number", "Edit should have timestamp");
            assert.strictEqual(projectNameEdit!.author, "test-author", "Edit should have correct author");
        });

        test("updateMetadataFile creates edit entry for meta.generator changes", async () => {
            // Mock configuration
            const mockConfig: MockWorkspaceConfiguration = {
                update: sandbox.stub().resolves(),
                get: sandbox.stub().callsFake((key: string) => {
                    if (key === "projectName") return "Original Project Name";
                    if (key === "userName") return "New User";
                    if (key === "userEmail") return "newuser@example.com";
                    if (key === "sourceLanguage") return "en";
                    if (key === "targetLanguage") return "fr";
                    if (key === "abbreviation") return "ORIG";
                    if (key === "spellcheckIsEnabled") return false;
                    if (key === "validationCount") return 1;
                    if (key === "validationCountAudio") return 1;
                    return undefined;
                }),
            };
            // Mock git configuration for getCurrentUserName
            const gitConfig: MockWorkspaceConfiguration = {
                update: sandbox.stub().resolves(),
                get: sandbox.stub().returns("test-author"),
            };

            // Stub getConfiguration to return different configs based on section
            sandbox.stub(vscode.workspace, "getConfiguration").callsFake((section?: string) => {
                if (section === "git") {
                    return gitConfig as vscode.WorkspaceConfiguration;
                }
                if (section === "codex-project-manager") {
                    return mockConfig as vscode.WorkspaceConfiguration;
                }
                return mockConfig as vscode.WorkspaceConfiguration;
            });

            // Call updateMetadataFile
            await updateMetadataFile();

            // Read updated metadata
            const afterContent = await vscode.workspace.fs.readFile(metadataPath);
            const afterMetadata = JSON.parse(new TextDecoder().decode(afterContent));
            const edits: ProjectEditHistory[] = afterMetadata.edits || [];

            const generatorEdit = edits.find((e) => EditMapUtils.equals(e.editMap, EditMapUtils.metaGenerator()));

            assert.ok(generatorEdit, "Should have meta.generator edit entry");
            assert.deepStrictEqual(
                generatorEdit!.value,
                { softwareName: "Codex Editor", userName: "New User", userEmail: "newuser@example.com" },
                "Generator edit should have correct value"
            );
            assert.strictEqual(generatorEdit!.type, EditType.USER_EDIT, "Edit should be USER_EDIT type");
            assert.ok(typeof generatorEdit!.timestamp === "number", "Edit should have timestamp");
            assert.strictEqual(generatorEdit!.author, "test-author", "Edit should have correct author");
        });

        test("updateMetadataFile creates edit entry for meta field changes (validationCount, validationCountAudio, abbreviation)", async () => {
            // Mock configuration
            const mockConfig: MockWorkspaceConfiguration = {
                update: sandbox.stub().resolves(),
                get: sandbox.stub().callsFake((key: string) => {
                    if (key === "projectName") return "Original Project Name";
                    if (key === "userName") return "Original User";
                    if (key === "userEmail") return "original@example.com";
                    if (key === "sourceLanguage") return "en";
                    if (key === "targetLanguage") return "fr";
                    if (key === "abbreviation") return "NEW";
                    if (key === "spellcheckIsEnabled") return false;
                    if (key === "validationCount") return 5;
                    if (key === "validationCountAudio") return 3;
                    return undefined;
                }),
            };
            // Mock git configuration for getCurrentUserName
            const gitConfig: MockWorkspaceConfiguration = {
                update: sandbox.stub().resolves(),
                get: sandbox.stub().returns("test-author"),
            };

            // Stub getConfiguration to return different configs based on section
            sandbox.stub(vscode.workspace, "getConfiguration").callsFake((section?: string) => {
                if (section === "git") {
                    return gitConfig as vscode.WorkspaceConfiguration;
                }
                if (section === "codex-project-manager") {
                    return mockConfig as vscode.WorkspaceConfiguration;
                }
                return mockConfig as vscode.WorkspaceConfiguration;
            });

            // Call updateMetadataFile
            await updateMetadataFile();

            // Read updated metadata
            const afterContent = await vscode.workspace.fs.readFile(metadataPath);
            const afterMetadata = JSON.parse(new TextDecoder().decode(afterContent));
            const edits: ProjectEditHistory[] = afterMetadata.edits || [];

            const metaEdit = edits.find((e) => EditMapUtils.equals(e.editMap, EditMapUtils.meta()));

            assert.ok(metaEdit, "Should have meta edit entry");
            assert.deepStrictEqual(
                metaEdit!.value,
                { validationCount: 5, validationCountAudio: 3, abbreviation: "NEW" },
                "Meta edit should have correct partial value"
            );
            assert.strictEqual(metaEdit!.type, EditType.USER_EDIT, "Edit should be USER_EDIT type");
            assert.ok(typeof metaEdit!.timestamp === "number", "Edit should have timestamp");
            assert.strictEqual(metaEdit!.author, "test-author", "Edit should have correct author");
        });

        test("updateMetadataFile creates edit entry for languages changes", async () => {
            // Mock configuration
            const mockConfig: MockWorkspaceConfiguration = {
                update: sandbox.stub().resolves(),
                get: sandbox.stub().callsFake((key: string) => {
                    if (key === "projectName") return "Original Project Name";
                    if (key === "userName") return "Original User";
                    if (key === "userEmail") return "original@example.com";
                    if (key === "sourceLanguage") return "es";
                    if (key === "targetLanguage") return "pt";
                    if (key === "abbreviation") return "ORIG";
                    if (key === "spellcheckIsEnabled") return false;
                    if (key === "validationCount") return 1;
                    if (key === "validationCountAudio") return 1;
                    return undefined;
                }),
            };
            // Mock git configuration for getCurrentUserName
            const gitConfig: MockWorkspaceConfiguration = {
                update: sandbox.stub().resolves(),
                get: sandbox.stub().returns("test-author"),
            };

            // Stub getConfiguration to return different configs based on section
            sandbox.stub(vscode.workspace, "getConfiguration").callsFake((section?: string) => {
                if (section === "git") {
                    return gitConfig as vscode.WorkspaceConfiguration;
                }
                if (section === "codex-project-manager") {
                    return mockConfig as vscode.WorkspaceConfiguration;
                }
                return mockConfig as vscode.WorkspaceConfiguration;
            });

            // Call updateMetadataFile
            await updateMetadataFile();

            // Read updated metadata
            const afterContent = await vscode.workspace.fs.readFile(metadataPath);
            const afterMetadata = JSON.parse(new TextDecoder().decode(afterContent));
            const edits: ProjectEditHistory[] = afterMetadata.edits || [];

            const languagesEdit = edits.find((e) => EditMapUtils.equals(e.editMap, EditMapUtils.languages()));

            assert.ok(languagesEdit, "Should have languages edit entry");
            assert.deepStrictEqual(languagesEdit!.value, ["es", "pt"], "Languages edit should have correct value");
            assert.strictEqual(languagesEdit!.type, EditType.USER_EDIT, "Edit should be USER_EDIT type");
            assert.ok(typeof languagesEdit!.timestamp === "number", "Edit should have timestamp");
            assert.strictEqual(languagesEdit!.author, "test-author", "Edit should have correct author");
        });

        test("updateMetadataFile creates edit entry for spellcheckIsEnabled changes", async () => {
            // Mock configuration
            const mockConfig: MockWorkspaceConfiguration = {
                update: sandbox.stub().resolves(),
                get: sandbox.stub().callsFake((key: string) => {
                    if (key === "projectName") return "Original Project Name";
                    if (key === "userName") return "Original User";
                    if (key === "userEmail") return "original@example.com";
                    if (key === "sourceLanguage") return "en";
                    if (key === "targetLanguage") return "fr";
                    if (key === "abbreviation") return "ORIG";
                    if (key === "spellcheckIsEnabled") return true;
                    if (key === "validationCount") return 1;
                    if (key === "validationCountAudio") return 1;
                    return undefined;
                }),
            };
            // Mock git configuration for getCurrentUserName
            const gitConfig: MockWorkspaceConfiguration = {
                update: sandbox.stub().resolves(),
                get: sandbox.stub().returns("test-author"),
            };

            // Stub getConfiguration to return different configs based on section
            sandbox.stub(vscode.workspace, "getConfiguration").callsFake((section?: string) => {
                if (section === "git") {
                    return gitConfig as vscode.WorkspaceConfiguration;
                }
                if (section === "codex-project-manager") {
                    return mockConfig as vscode.WorkspaceConfiguration;
                }
                return mockConfig as vscode.WorkspaceConfiguration;
            });

            // Call updateMetadataFile
            await updateMetadataFile();

            // Read updated metadata
            const afterContent = await vscode.workspace.fs.readFile(metadataPath);
            const afterMetadata = JSON.parse(new TextDecoder().decode(afterContent));
            const edits: ProjectEditHistory[] = afterMetadata.edits || [];

            const spellcheckEdit = edits.find((e) =>
                EditMapUtils.equals(e.editMap, EditMapUtils.spellcheckIsEnabled())
            );

            assert.ok(spellcheckEdit, "Should have spellcheckIsEnabled edit entry");
            assert.strictEqual(spellcheckEdit!.value, true, "SpellcheckIsEnabled edit should have correct value");
            assert.strictEqual(spellcheckEdit!.type, EditType.USER_EDIT, "Edit should be USER_EDIT type");
            assert.ok(typeof spellcheckEdit!.timestamp === "number", "Edit should have timestamp");
            assert.strictEqual(spellcheckEdit!.author, "test-author", "Edit should have correct author");
        });

        test("updateMetadataFile creates edit entries for all changed fields", async () => {
            // Mock configuration with multiple changes
            const mockConfig: MockWorkspaceConfiguration = {
                update: sandbox.stub().resolves(),
                get: sandbox.stub().callsFake((key: string) => {
                    if (key === "projectName") return "Updated Project Name";
                    if (key === "userName") return "Updated User";
                    if (key === "userEmail") return "updated@example.com";
                    if (key === "sourceLanguage") return "de";
                    if (key === "targetLanguage") return "it";
                    if (key === "abbreviation") return "UPD";
                    if (key === "spellcheckIsEnabled") return true;
                    if (key === "validationCount") return 10;
                    if (key === "validationCountAudio") return 7;
                    return undefined;
                }),
            };
            // Mock git configuration for getCurrentUserName
            const gitConfig: MockWorkspaceConfiguration = {
                update: sandbox.stub().resolves(),
                get: sandbox.stub().returns("test-author"),
            };

            // Stub getConfiguration to return different configs based on section
            sandbox.stub(vscode.workspace, "getConfiguration").callsFake((section?: string) => {
                if (section === "git") {
                    return gitConfig as vscode.WorkspaceConfiguration;
                }
                if (section === "codex-project-manager") {
                    return mockConfig as vscode.WorkspaceConfiguration;
                }
                return mockConfig as vscode.WorkspaceConfiguration;
            });

            // Call updateMetadataFile
            await updateMetadataFile();

            // Read updated metadata
            const afterContent = await vscode.workspace.fs.readFile(metadataPath);
            const afterMetadata = JSON.parse(new TextDecoder().decode(afterContent));
            const edits: ProjectEditHistory[] = afterMetadata.edits || [];

            // Verify all edit types exist
            const isEditPath = (e: ProjectEditHistory, path: readonly string[]) => EditMapUtils.equals(e.editMap, path);

            assert.ok(edits.some((e) => isEditPath(e, EditMapUtils.projectName())), "Should have projectName edit");
            assert.ok(edits.some((e) => isEditPath(e, EditMapUtils.metaGenerator())), "Should have meta.generator edit");
            assert.ok(edits.some((e) => isEditPath(e, EditMapUtils.meta())), "Should have meta edit");
            assert.ok(edits.some((e) => isEditPath(e, EditMapUtils.languages())), "Should have languages edit");
            assert.ok(
                edits.some((e) => isEditPath(e, EditMapUtils.spellcheckIsEnabled())),
                "Should have spellcheckIsEnabled edit"
            );

            // Verify values match
            const projectNameEdit = edits.find((e) => isEditPath(e, EditMapUtils.projectName()));
            assert.strictEqual(projectNameEdit!.value, "Updated Project Name", "ProjectName edit should have correct value");

            const generatorEdit = edits.find((e) => isEditPath(e, EditMapUtils.metaGenerator()));
            assert.deepStrictEqual(
                generatorEdit!.value,
                { softwareName: "Codex Editor", userName: "Updated User", userEmail: "updated@example.com" },
                "Generator edit should have correct value"
            );

            const metaEdit = edits.find((e) => isEditPath(e, EditMapUtils.meta()));
            assert.deepStrictEqual(
                metaEdit!.value,
                { validationCount: 10, validationCountAudio: 7, abbreviation: "UPD" },
                "Meta edit should have correct value"
            );

            const languagesEdit = edits.find((e) => isEditPath(e, EditMapUtils.languages()));
            assert.deepStrictEqual(languagesEdit!.value, ["de", "it"], "Languages edit should have correct value");

            const spellcheckEdit = edits.find((e) => isEditPath(e, EditMapUtils.spellcheckIsEnabled()));
            assert.strictEqual(spellcheckEdit!.value, true, "SpellcheckIsEnabled edit should have correct value");
        });

        test("updateMetadataFile does not create edit if field unchanged", async () => {
            // Mock configuration with no changes
            const mockConfig: MockWorkspaceConfiguration = {
                update: sandbox.stub().resolves(),
                get: sandbox.stub().callsFake((key: string) => {
                    if (key === "projectName") return "Original Project Name";
                    if (key === "userName") return "Original User";
                    if (key === "userEmail") return "original@example.com";
                    if (key === "sourceLanguage") return "en";
                    if (key === "targetLanguage") return "fr";
                    if (key === "abbreviation") return "ORIG";
                    if (key === "spellcheckIsEnabled") return false;
                    if (key === "validationCount") return 1;
                    if (key === "validationCountAudio") return 1;
                    return undefined;
                }),
            };
            // Mock git configuration for getCurrentUserName
            const gitConfig: MockWorkspaceConfiguration = {
                update: sandbox.stub().resolves(),
                get: sandbox.stub().returns("test-author"),
            };

            // Stub getConfiguration to return different configs based on section
            sandbox.stub(vscode.workspace, "getConfiguration").callsFake((section?: string) => {
                if (section === "git") {
                    return gitConfig as vscode.WorkspaceConfiguration;
                }
                if (section === "codex-project-manager") {
                    return mockConfig as vscode.WorkspaceConfiguration;
                }
                return mockConfig as vscode.WorkspaceConfiguration;
            });

            // Read initial metadata
            const beforeContent = await vscode.workspace.fs.readFile(metadataPath);
            const beforeMetadata = JSON.parse(new TextDecoder().decode(beforeContent));
            const beforeEditsCount = beforeMetadata.edits ? beforeMetadata.edits.length : 0;

            // Call updateMetadataFile
            await updateMetadataFile();

            // Read updated metadata
            const afterContent = await vscode.workspace.fs.readFile(metadataPath);
            const afterMetadata = JSON.parse(new TextDecoder().decode(afterContent));
            const afterEditsCount = afterMetadata.edits ? afterMetadata.edits.length : 0;

            // Should not create edits if nothing changed
            assert.strictEqual(
                afterEditsCount,
                beforeEditsCount,
                "Should not create edits if no fields changed"
            );
        });

        test("updateMetadataFile edits persist after save", async () => {
            // Mock configuration
            const mockConfig: MockWorkspaceConfiguration = {
                update: sandbox.stub().resolves(),
                get: sandbox.stub().callsFake((key: string) => {
                    if (key === "projectName") return "Persisted Project Name";
                    if (key === "userName") return "Original User";
                    if (key === "userEmail") return "original@example.com";
                    if (key === "sourceLanguage") return "en";
                    if (key === "targetLanguage") return "fr";
                    if (key === "abbreviation") return "ORIG";
                    if (key === "spellcheckIsEnabled") return false;
                    if (key === "validationCount") return 1;
                    if (key === "validationCountAudio") return 1;
                    return undefined;
                }),
            };
            // Mock git configuration for getCurrentUserName
            const gitConfig: MockWorkspaceConfiguration = {
                update: sandbox.stub().resolves(),
                get: sandbox.stub().returns("test-author"),
            };

            // Stub getConfiguration to return different configs based on section
            sandbox.stub(vscode.workspace, "getConfiguration").callsFake((section?: string) => {
                if (section === "git") {
                    return gitConfig as vscode.WorkspaceConfiguration;
                }
                if (section === "codex-project-manager") {
                    return mockConfig as vscode.WorkspaceConfiguration;
                }
                return mockConfig as vscode.WorkspaceConfiguration;
            });

            // Call updateMetadataFile
            await updateMetadataFile();

            // Read file content from disk to verify persisted state
            const persistedContent = await vscode.workspace.fs.readFile(metadataPath);
            const persisted = JSON.parse(new TextDecoder().decode(persistedContent));

            assert.ok(persisted.edits, "Metadata should have edits array");
            const edits: ProjectEditHistory<["projectName"]>[] = persisted.edits;

            const projectNameEdit = edits.find((e) => EditMapUtils.equals(e.editMap, EditMapUtils.projectName()));

            assert.ok(projectNameEdit, "ProjectName edit should persist after save");
            assert.strictEqual(
                projectNameEdit!.value,
                "Persisted Project Name",
                "Persisted projectName edit should have correct value"
            );
            assert.strictEqual(projectNameEdit!.type, EditType.USER_EDIT, "Persisted edit should be USER_EDIT type");
            assert.ok(typeof projectNameEdit!.timestamp === "number", "Persisted edit should have timestamp");
            assert.ok(typeof projectNameEdit!.author === "string", "Persisted edit should have author");

            // Verify metadata value was persisted
            assert.strictEqual(persisted.projectName, "Persisted Project Name", "ProjectName should be persisted");
        });
    });
});

