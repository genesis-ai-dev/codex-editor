import * as assert from "assert";
import * as vscode from "vscode";
import { CellTypes, createProjectNotebooks, getProjectMetadata, LanguageMetadata } from "../../codexNotebookUtils";
import * as sinon from "sinon";
import * as path from "path";
import { LanguageProjectStatus } from "../../types";

suite("createProjectNotebooks Test Suite", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        const workspaceFolder = {
            uri: vscode.Uri.file(path.join(__dirname, "workspaceFolder")),
            name: "TestWorkspace",
            index: 0,
        };
        sandbox
            .stub(vscode.workspace, "workspaceFolders")
            .value([workspaceFolder]);

        // Mock the project metadata
        const projectMetadata = {
            languages: [
                {
                    tag: "eng", // ISO 639-3 language code
                    projectStatus: LanguageProjectStatus.TARGET,
                },
            ],
        };
        sandbox
            .stub(getProjectMetadata, "call")
            .returns(Promise.resolve(projectMetadata));
    });

    teardown(() => {
        sandbox.restore();
    });
    vscode.window.showInformationMessage(
        "Start all tests for createProjectNotebooks.",
    );

    test("createProjectNotebooks creates notebooks with correct metadata", async () => {
        const shouldOverWrite = false;
        await createProjectNotebooks({ shouldOverWrite });

        // Assuming the notebooks are created in the workspace directory
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            assert.fail("No workspace folders found");
        }

        const workspacePath = workspaceFolders[0].uri.fsPath;
        const projectMetadata = await getProjectMetadata();
        const targetLanguage = projectMetadata.languages.filter((language: LanguageMetadata) => language.projectStatus === LanguageProjectStatus.TARGET)[0].tag;

        const generatedCodexFile = await vscode.workspace.fs.readFile(
            vscode.Uri.file(`${workspacePath}/drafts/${targetLanguage}/GEN.codex`),
        );

        // Parse the generatedCodexFile as JSON
        const codexContent = JSON.parse(generatedCodexFile.toString());

        const firstCellIsChapterHeadingType =
            codexContent.cells[0].metadata.type === CellTypes.CHAPTER_HEADING;
        const firstCellIsMetadataIsPresent =
            codexContent.cells[0].metadata.data.chapter === "1";

        assert.ok(
            firstCellIsChapterHeadingType && firstCellIsMetadataIsPresent,
            "createProjectNotebooks should create notebooks without overwrite",
        );
    });
});
