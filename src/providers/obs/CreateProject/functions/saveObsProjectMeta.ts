import moment from "moment";
import path from "path";
import * as vscode from "vscode";
import { v5 as uuidV5 } from "uuid";
import { createObsContent } from "./createObsContent";
import createObsSB from "./createObsSB";
import { AnyObject } from "../types";

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
    language: { ld: string; ang: any; lc: any };
    project?: Record<string, any>;
    importedFiles: { id: string; content: string }[];
    copyright: { title?: any; licence?: string | any[] };
    update: any;
}) => {
    const currentDirUri = vscode.workspace.workspaceFolders?.[0].uri;

    if (!currentDirUri) {
        vscode.window.showErrorMessage("No workspace opened");
        return;
    }

    const status: AnyObject[] = [];
    const currentUser = "brianineza01"; // TODO: IMPLEMENT AUTH FOR THIS
    // handle spaces
    // trim the leading spaces
    projectMetaObj.newProjectFields.projectName =
        projectMetaObj.newProjectFields.projectName
            .trim()
            .replace(/(^_+)?(_+$)?/gm, "");

    // OBS burrito creation and checks
    const obsBurritoChecksAndCreation = async () => {
        const key =
            currentUser +
            projectMetaObj.newProjectFields.projectName +
            moment().format();
        const id = uuidV5(key, environment.uuidToken);

        // Create New burrito
        // ingredient has the list of created files in the form of SB Ingredients

        const newProjectUri = currentDirUri.with({
            path: path.join(
                currentDirUri.path,
                `${projectMetaObj.newProjectFields.projectName}_${id}`,
            ),
        });

        const ingredient = await createObsContent(
            projectMetaObj.newProjectFields,
            projectMetaObj.language.ld,
            projectMetaObj.project as any,
            projectMetaObj.importedFiles,
            projectMetaObj.copyright as any,
            projectMetaObj.call as any,
            newProjectUri,
        );

        const burritoFile = createObsSB(
            currentUser,
            projectMetaObj.newProjectFields,
            projectMetaObj.language.ang,
            projectMetaObj.language.lc,
            projectMetaObj.language.ld,
            projectMetaObj.copyright as any,
            id,
        );
        burritoFile.ingredients = ingredient;

        const metadataFileUri = newProjectUri.with({
            path: path.join(newProjectUri.path, "metadata.json"),
        });
        await fs.writeFile(
            metadataFileUri,
            Buffer.from(JSON.stringify(burritoFile)),
        );
        // init git for the Project
        // const projectGitPath = path.join(
        //   projectDir,
        //   `${projectMetaObj.newProjectFields.projectName}_${id}`
        // );
        // await checkGitandCommitFiles(fs, projectGitPath, null, currentUser);
        // .finally(() => {
        //   logger.debug(
        //     "saveProjectsMeta.js",
        //     projectMetaObj.call === "new"
        //       ? "New project created successfully."
        //       : "Updated the Changes."
        //   );
        //   status.push({
        //     type: "success",
        //     value:
        //       projectMetaObj.call === "new"
        //         ? "New project created"
        //         : "Updated the changes",
        //   });
        // });

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
