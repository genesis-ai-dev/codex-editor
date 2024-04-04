import moment from "moment";
import { AnyObject } from "../../CreateProject/types";
import { createDownloadedResourceSB } from "./createDownloadedResourceSB";
import * as vscode from "vscode";
import { directoryExists, fileExists } from "../../CreateProject/utilities/obs";

import customLicense from "../../data/license/Custom.md";

import JSZip from "jszip";
import md5 from "md5";
import {
    generateObsResourceIngredients,
    generateResourceIngredientsTextTranslation,
} from "./resourceIngredients";

import OBSLicense from "../../data/OBSLicense.md";
import { generateAgSettings } from "./generateAgSettings";
import { environment } from "../../data/environment";
import { downloadSBTranslationResources } from "./downloadSBTranslationResources";
import { getLinkedTwResource, getResourceType } from "../utilities";
import { Meta } from "../types";

type Resource = Meta;

export const downloadResource = async (resource: Resource) => {
    try {
        vscode.window.showInformationMessage(
            "Download started, please wait...",
        );

        const selectResource = getResourceType(resource.subject);
        if (!resource) {
            throw new Error("No resource given not found");
        }

        // create the .project/resources folder if it does not exist
        const currentFolderURI = vscode.workspace.workspaceFolders?.[0].uri;
        if (!currentFolderURI) {
            throw new Error("No workspace opened");
        }
        const resourcesFolder = vscode.Uri.joinPath(
            currentFolderURI,
            ".project",
            "resources",
        );
        const resourcesFolderExists = await directoryExists(resourcesFolder);
        if (!resourcesFolderExists) {
            await vscode.workspace.fs.createDirectory(resourcesFolder);
        }

        if (!["bible", "obs"].includes(selectResource)) {
            const results = await downloadSBTranslationResources({
                projectResource: resource,
                resourcesFolder,
            });

            if (selectResource === "twl" || selectResource === "obs-twl") {
                const linkedResource = await getLinkedTwResource(
                    results?.resourceMeta,
                );

                if (!linkedResource) {
                    await vscode.workspace.fs.delete(results.folder);

                    await vscode.window.showErrorMessage(
                        "No linked Translation Words resource found! unable to download the resource!",
                    );
                    throw new Error(
                        "No linked Translation Words resource found! unable to download the resource!",
                    );
                }

                const linkedResourceResults =
                    await downloadSBTranslationResources({
                        projectResource: linkedResource,
                        resourcesFolder,
                    });

                return [
                    {
                        resource: linkedResourceResults?.resourceMeta?.meta,
                        folder: linkedResourceResults?.folder,
                        resourceType: "tw",
                    },
                    {
                        resource: results?.resourceMeta?.meta,
                        folder: results?.folder,
                        resourceType: selectResource,
                    },
                ];
            }

            return {
                resource,
                folder: results?.folder,
                resourceType: selectResource,
            };
        }

        // create the resource burrito file
        const resourceMetadataRequest = await fetch(resource.metadata_json_url);
        const resourceMetadata =
            (await resourceMetadataRequest.json()) as AnyObject;
        const resourceBurritoFile = createDownloadedResourceSB({
            resourceMetadata,
            resource: resource as AnyObject,
            username: "test",
            resourceType: selectResource as "bible" | "obs",
        });
        resourceBurritoFile.resourceMeta = resource;
        resourceBurritoFile.resourceMeta.lastUpdatedAg = moment().format();
        const currentProjectName = `${resource.name}_${
            Object.keys(resourceBurritoFile.identification.primary.scribe)[0]
        }`;

        // Download the zip of the resource
        const zipResponse = await fetch(resource.zipball_url);
        const zipBuffer = await zipResponse.arrayBuffer();
        await vscode.workspace.fs.writeFile(
            vscode.Uri.joinPath(resourcesFolder, `${currentProjectName}.zip`),
            Buffer.from(zipBuffer),
        );

        // unzip the resource
        const contents = await JSZip.loadAsync(zipBuffer);
        const zipKeys = Object.keys(contents.files);
        let licenseFileFound = false;
        for (const key of zipKeys) {
            const item = contents.files[key];
            if (item.dir) {
                await vscode.workspace.fs.createDirectory(
                    vscode.Uri.joinPath(resourcesFolder, item.name),
                );
            } else {
                const bufferContent = Buffer.from(
                    await item.async("arraybuffer"),
                );
                // save the resource to the local disk in the current project folder named .project/resources
                await vscode.workspace.fs.writeFile(
                    vscode.Uri.joinPath(resourcesFolder, item.name),
                    bufferContent,
                );
            }
            if (key.toLowerCase().includes("license")) {
                licenseFileFound = true;
                if (
                    await fileExists(vscode.Uri.joinPath(resourcesFolder, key))
                ) {
                    const licenseContent = await vscode.workspace.fs.readFile(
                        vscode.Uri.joinPath(resourcesFolder, key),
                    );
                    const checksum = md5(licenseContent);
                    const stats = await vscode.workspace.fs.stat(
                        vscode.Uri.joinPath(resourcesFolder, key),
                    );
                    resourceBurritoFile.ingredients[
                        key.replace(resource.name, ".")
                    ] = {
                        checksum: { md5: checksum },
                        mimeType: "text/md",
                        size: stats.size,
                        role: "x-licence",
                    };
                }
            }
        }

        let finalBurritoFile = { ...resourceBurritoFile };
        let customLicenseContent = "";
        switch (selectResource) {
            case "bible":
                finalBurritoFile =
                    await generateResourceIngredientsTextTranslation({
                        resource,
                        resourceMetadata,
                        folder: resourcesFolder,
                        resourceBurrito: resourceBurritoFile,
                    });
                customLicenseContent = customLicense;
                break;
            case "obs":
                finalBurritoFile = await generateObsResourceIngredients({
                    resource,
                    resourceMetadata,
                    folder: resourcesFolder,
                    resourceBurrito: resourceBurritoFile,
                    files: zipKeys,
                });
                customLicenseContent = OBSLicense;
                break;
            default:
                throw new Error(
                    " can not process :Invalid Type of Resource requested",
                );
        }

        const downloadResourceUri = vscode.Uri.joinPath(
            resourcesFolder,
            `${resource.name}`,
        );

        if (!licenseFileFound) {
            if (await directoryExists(downloadResourceUri)) {
                const mdUri = vscode.Uri.joinPath(
                    downloadResourceUri,
                    "LICENSE.md",
                );
                await vscode.workspace.fs.writeFile(
                    mdUri,
                    Buffer.from(customLicenseContent),
                );
                const stats = await vscode.workspace.fs.stat(mdUri);
                finalBurritoFile.ingredients["./LICENSE.md"] = {
                    checksum: { md5: md5(customLicenseContent) },
                    mimeType: "text/md",
                    size: stats.size,
                    role: "x-licence",
                };
            }
        }

        const settings = generateAgSettings({
            resourceMetadata,
            resourceBurrito: finalBurritoFile,
            selectResource,
        });

        const settingsUri = vscode.Uri.joinPath(
            downloadResourceUri,
            environment.PROJECT_SETTING_FILE,
        );

        await vscode.workspace.fs.writeFile(
            settingsUri,
            Buffer.from(JSON.stringify(settings)),
        );

        const checksum = md5(JSON.stringify(settings));

        const settingsStats = await vscode.workspace.fs.stat(settingsUri);

        finalBurritoFile.ingredients["./scribe-settings.json"] = {
            checksum: { md5: checksum },
            mimeType: "application/json",
            size: settingsStats.size,
            role: "x-scribe",
        };
        // added new section to avoid ingredients issue in meta some times (new user)
        const ymlPath = resourceMetadata?.projects[0]?.path.replace("./", "");
        const renames = Object.keys(finalBurritoFile.ingredients);
        const regex = new RegExp(`(\\.\\/)|(${ymlPath}[\\/\\\\])`, "g");
        renames?.forEach((rename) => {
            if (!rename.match(regex)) {
                delete finalBurritoFile.ingredients[rename];
            }
        });

        const metadataUri = vscode.Uri.joinPath(
            downloadResourceUri,
            "metadata.json",
        );

        await vscode.workspace.fs.writeFile(
            metadataUri,
            Buffer.from(JSON.stringify(finalBurritoFile)),
        );

        // delete the downloaded zip file

        await vscode.workspace.fs.delete(
            vscode.Uri.joinPath(resourcesFolder, `${currentProjectName}.zip`),
        );

        vscode.window.showInformationMessage(
            `Resource ${resource.name} downloaded successfully`,
        );
        // add to the global store of resources

        // return the local path to the resource
        return {
            resourceBurritoFile: finalBurritoFile,
            resourceMetadata,
            resource,
            folder: downloadResourceUri,
            resourceType: selectResource,
        };
    } catch (error: any) {
        vscode.window.showErrorMessage(`Resource download failed ${error}`);
    }
};
