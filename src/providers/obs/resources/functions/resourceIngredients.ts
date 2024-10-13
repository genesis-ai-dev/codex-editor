import * as vscode from "vscode";
import { AnyObject } from "../../CreateProject/types";
import md5 from "md5";
import { fileExists } from "../../CreateProject/utilities/obs";
import OBSData from "../../data/OBSData.json";
import path from "path";

type IngredientFnBaseParams = {
    resourceMetadata: AnyObject;
    folder: vscode.Uri;
    resource: AnyObject;
    resourceBurrito: AnyObject;
};
export const generateObsResourceIngredients = async ({
    resourceMetadata,
    folder,
    resource,
    resourceBurrito,
    files,
}: IngredientFnBaseParams & {
    files: string[];
}) => {
    files.forEach(async (file) => {
        const path = {};
        const endPart = file.split("/").pop() ?? "";
        const regX = /^\d{2}.md$/;
        if (regX.test(endPart ?? "") || ["intro.md", "title.md"].indexOf(endPart ?? "") > -1) {
            const fileUri = vscode.Uri.joinPath(folder, file);
            if (await fileExists(fileUri)) {
                const fileContent = await vscode.workspace.fs.readFile(fileUri);
                // find checksum & size by read the file
                const checksum = md5(fileContent);
                const stats = await vscode.workspace.fs.stat(fileUri);
                resourceBurrito.ingredients[file.replace(`${resource.name}/`, "")] = {
                    checksum: { md5: checksum },
                    mimeType: resourceMetadata.dublin_core.format,
                    size: stats.size,
                };
                if (endPart.toLowerCase() === "front.md") {
                    resourceBurrito.ingredients[file.replace(`${resource.name}/`, "")].role =
                        "pubdata";
                } else if (regX.test(endPart)) {
                    resourceBurrito.ingredients[file.replace(`${resource.name}/`, "")].scope =
                        OBSData.filter((story) => {
                            if (
                                `${story.storyId.toString().padStart(2, "0")}.md` ===
                                endPart.toLowerCase()
                            ) {
                                return story;
                            }
                        })[0].scope;
                } else {
                    resourceBurrito.ingredients[file.replace(`${resource.name}/`, "")].role =
                        "title";
                }
            } else {
                throw new Error(`File not Exist in project Directory:  ${file}`);
            }
        }
    });
    return resourceBurrito;
};

export const generateResourceIngredientsTextTranslation = async ({
    resourceMetadata,
    folder,
    resource,
    resourceBurrito,
}: IngredientFnBaseParams) => {
    // generating ingredients content in metadata
    resourceMetadata?.projects.forEach(async (project: any) => {
        const fileUri = folder.with({
            path: path.join(folder.path, resource.name, project.path),
        });
        if (await fileExists(fileUri)) {
            const fileContents = await vscode.workspace.fs.readFile(fileUri);
            // find checksum & size by read the file
            const checksum = md5(fileContents);
            const stats = await vscode.workspace.fs.stat(fileUri);
            resourceBurrito.ingredients[project.path] = {
                checksum: { md5: checksum },
                mimeType: resourceMetadata.dublin_core.format,
                size: stats.size,
                scope: { [project?.identifier.toUpperCase()]: [] },
            };
        } else {
            throw new Error(`File not Exist in project Directory:  ${project.path}`);
        }
    });
    return resourceBurrito;
};
