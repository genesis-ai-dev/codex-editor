import * as assert from "assert";
import * as vscode from "vscode";
import { CellTypes, createProjectNotebooks } from "../../codexNotebookUtils";
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
            .stub(vscode.workspace.fs, "readFile")
            .returns(Promise.resolve(Buffer.from(JSON.stringify(projectMetadata))));
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
        const generatedCodexFile = await vscode.workspace.fs.readFile(
            vscode.Uri.file(`${workspacePath}/drafts/Bible/GEN.codex`), // FIXME: Here we are attempting to use the /Bible path, but elsewhere in the code we are retrieving the project metadata.languages filtered to where projectStatus === LanguageProjectStatus.TARGET [0th item].tag.
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
