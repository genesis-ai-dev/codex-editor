import { initProject } from "../../../scm/git";
import { saveObsProjectMeta } from "./saveObsProjectMeta";
import * as vscode from "vscode";

export const createObsProject = async (
    projectFields: Record<string, string>,
) => {
    const newProjectData = {
        newProjectFields: {
            projectName: projectFields.projectName,
            description: projectFields.description,
            abbreviation: projectFields.abbreviation,
        },
        language: projectFields.sourceLanguage,
        copyright: projectFields.copyright,
        importedFiles: [],
        call: "new",
        update: false,
        projectType: "OBS",
    };

    const res = await saveObsProjectMeta(newProjectData as any);

    if (!res) {
        vscode.window.showErrorMessage("Project creation failed");
        return;
    }

    const { createdProjectURI } = res;

    await initProject(
        projectFields.name,
        projectFields.email,
        createdProjectURI,
    );

    const CURRENT_WINDOW = {
        title: "Current Window",
        key: "CURRENT_WINDOW",
    };

    const NEW_WINDOW = {
        title: "New Window",
        key: "NEW_WINDOW",
    };

    const CANCEL = {
        title: "Cancel",
        key: "CANCEL",
        isCloseAffordance: true,
    };

    const choice = await vscode.window.showInformationMessage(
        "Project created successfully! Where would you like to open the project?",
        {
            modal: true,
        },
        CURRENT_WINDOW,
        NEW_WINDOW,
        CANCEL,
    );

    if (choice?.key === CURRENT_WINDOW.key) {
        vscode.commands.executeCommand("vscode.openFolder", createdProjectURI, {
            forceReuseWindow: true,
        });
    } else if (choice?.key === NEW_WINDOW.key) {
        vscode.commands.executeCommand("vscode.openFolder", createdProjectURI, {
            forceNewWindow: true,
        });
    } else {
        return;
    }
};
