import moment from "moment";
import path from "path";
import * as vscode from "vscode";
import { v5 as uuidV5 } from "uuid";
import { createObsContent } from "./createObsContent";
import createObsSB from "./createObsSB";
import { AnyObject } from "../types";
import { LanguageMetadata } from "codex-types";

const fs = vscode.workspace.fs;

const environment = {
    uuidToken: "1b671a64-40d5-491e-99b0-da01ff1f3341",
};

export const saveObsProjectMeta = async (projectMetaObj: {
    newProjectFields: {
        projectName: any;
        description: any;
        abbreviation: any;
    };
    call: string;
    projectType: any;
    language: LanguageMetadata;
    project?: Record<string, any>;
    importedFiles: { id: string; content: string }[];
    copyright: { title?: any; licence?: string | any[] };
    update: any;
    username: string;
}) => {
    const currentDirUri = vscode.workspace.workspaceFolders?.[0].uri;

    if (!currentDirUri) {
        vscode.window.showErrorMessage("No workspace opened");
        return;
    }

    const status: AnyObject[] = [];
    const currentUser = projectMetaObj.username;
    // handle spaces
    // trim the leading spaces
    projectMetaObj.newProjectFields.projectName = projectMetaObj.newProjectFields.projectName
        .trim()
        .replace(/(^_+)?(_+$)?/gm, "");

    // OBS burrito creation and checks
    const obsBurritoChecksAndCreation = async () => {
        const key = currentUser + projectMetaObj.newProjectFields.projectName + moment().format();
        const id = uuidV5(key, environment.uuidToken);

        // Create New burrito
        // ingredient has the list of created files in the form of SB Ingredients

        const newProjectUri = currentDirUri.with({
            path: path.join(
                currentDirUri.path,
                `${projectMetaObj.newProjectFields.projectName}_${id}`
            ),
        });

        const ingredient = await createObsContent(
            projectMetaObj.newProjectFields,
            projectMetaObj.language.refName,
            projectMetaObj.project as any,
            projectMetaObj.importedFiles,
            projectMetaObj.copyright as any,
            projectMetaObj.call as any,
            newProjectUri
        );

        const burritoFile = createObsSB(
            currentUser,
            projectMetaObj.newProjectFields,
            projectMetaObj.language.refName,
            projectMetaObj.language.tag,
            projectMetaObj.language.scriptDirection ?? "ltr",
            id
        );
        burritoFile.ingredients = ingredient;

        const metadataFileUri = newProjectUri.with({
            path: path.join(newProjectUri.path, "metadata.json"),
        });
        await fs.writeFile(metadataFileUri, Buffer.from(JSON.stringify(burritoFile)));

        return newProjectUri;
    };

    // Translation burrito creation and checks
    // Switch Project Creation
    const createdProjectURI = await obsBurritoChecksAndCreation();

    return {
        status,
        createdProjectURI,
    };
};
