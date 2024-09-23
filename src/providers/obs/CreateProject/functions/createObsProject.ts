import { LanguageMetadata } from "codex-types";
import { initProject } from "../../../scm/git";
import { saveObsProjectMeta } from "./saveObsProjectMeta";
import * as vscode from "vscode";

export type ProjectFields = {
    projectName: string;
    description: string;
    abbreviation: string;
    targetLanguage: LanguageMetadata;
    username: string;
    email: string;
    name: string;
    copyright: object;
};

export const createObsProject = async (projectFields: ProjectFields) => {
    const newProjectData = {
        newProjectFields: {
            projectName: projectFields.projectName,
            description: projectFields.description,
            abbreviation: projectFields.abbreviation,
        },
        language: projectFields.targetLanguage,
        copyright: projectFields.copyright,
        importedFiles: [],
        call: "new",
        update: false,
        projectType: "OBS",
        username: projectFields.username,
    };

    const res = await saveObsProjectMeta(newProjectData);

    if (!res) {
        vscode.window.showErrorMessage("Project creation failed");
        return;
    }

    const { createdProjectURI } = res;

    await initProject(projectFields.name, projectFields.email, createdProjectURI);

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
        CANCEL
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
