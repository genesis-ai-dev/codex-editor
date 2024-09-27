import path from "path";
import * as vscode from "vscode";
import OBSData from "../../data/OBSData.json";
import OBSFront from "../../data/OBSfront.md";

import md5 from "md5";
import JsonToMd from "../utilities/jsonToMd";
import OBSBack from "../../data/OBSback.md";
import OBSLicense from "../../data/OBSLicense.md";
import moment from "moment";
import { directoryExists } from "../utilities/obs";

interface G<s> {
    id: s;
}

const bookAvailable = <S, T extends G<S>>(list: T[], id: S) => list.some((obj) => obj.id === id);

type F = {
    name: string;
    content: string;
    files: { id: string; content: string }[];
};

const environment = {
    PROJECT_SETTING_FILE: "settings.json",
    AG_SETTING_VERSION: "1.0",
};

async function checkAndCreateDirectory(
    fs: { createDirectory: (arg0: any) => any },
    folderUri: vscode.Uri
) {
    if (!(await directoryExists(folderUri))) {
        await fs.createDirectory(folderUri);
    }
}

async function processStoryFiles(
    fs: {
        writeFile: (arg0: any, arg1: Buffer) => any;
        stat: (arg0: any) => any;
    },
    folderUri: { with: (arg0: { path: string }) => any; path: string },
    importedFiles: F["files"]
) {
    const storyIngredients: {
        [key: string]: {
            checksum: { md5: any };
            mimeType: string;
            size: any;
            scope: any;
        };
    } = {};
    const ingredientsDirName = "ingredients";
    for (const storyJson of OBSData) {
        const currentFileName = `${storyJson.storyId.toString().padStart(2, "0")}.md`;
        const fileUri = folderUri.with({
            path: path.join(folderUri.path, ingredientsDirName, currentFileName),
        });

        let fileContents: any;
        if (bookAvailable(importedFiles, currentFileName)) {
            const file = importedFiles.find((obj: { id: string }) => obj.id === currentFileName);
            fileContents = file?.content;
        } else {
            fileContents = JsonToMd(storyJson, "");
        }

        await fs.writeFile(fileUri, Buffer.from(fileContents, "utf-8"));
        const stats = await fs.stat(fileUri);
        storyIngredients[path.join(ingredientsDirName, currentFileName)] = {
            checksum: {
                md5: md5(fileContents),
            },
            mimeType: "text/markdown",
            size: stats.size,
            scope: storyJson.scope,
        };
    }
    return storyIngredients;
}

async function processFrontAndBackFiles(
    fs: {
        writeFile: (arg0: any, arg1: Buffer) => any;
        stat: (arg0: any) => any;
    },
    folderUri: { with: (arg0: { path: string }) => any; path: string },
    importedFiles: any[]
) {
    const ingredients: {
        [x: string]: {
            checksum: { md5: any };
            mimeType: string;
            size: any;
            role: string;
        };
    } = {};
    const ingredientsDirName = "ingredients";
    const files = ["front.md", "back.md"];
    const resources = [OBSFront, OBSBack];

    const roles = ["pubdata", "title"];

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        let fileData = importedFiles.find((obj: { id: string }) => obj.id === file);

        if (!fileData) {
            fileData = { id: file, content: resources[i] };
        }

        const fileUri = folderUri.with({
            path: path.join(folderUri.path, ingredientsDirName, fileData.id),
        });

        await fs.writeFile(fileUri, Buffer.from(fileData.content));
        const stats = await fs.stat(fileUri);
        ingredients[path.join(ingredientsDirName, fileData.id)] = {
            checksum: {
                md5: md5(fileData.content),
            },
            mimeType: "text/markdown",
            size: stats.size,
            role: roles[i],
        };
    }
    return ingredients;
}

async function processLicenseFile(
    fs: {
        writeFile: (arg0: any, arg1: Buffer) => any;
        stat: (arg0: any) => any;
    },
    folderUri: { with: (arg0: { path: string }) => any; path: string }
) {
    const ingredients: {
        [x: string]: {
            checksum: { md5: any };
            mimeType: string;
            size: any;
        };
    } = {};
    const ingredientsDirName = "ingredients";
    const licenseFileUri = folderUri.with({
        path: path.join(folderUri.path, ingredientsDirName, "LICENSE.md"),
    });

    await fs.writeFile(licenseFileUri, Buffer.from(OBSLicense));
    const stats = await fs.stat(licenseFileUri);
    ingredients[path.join(ingredientsDirName, "LICENSE.md")] = {
        checksum: {
            md5: md5(OBSLicense),
        },
        mimeType: "text/markdown",
        size: stats.size,
    };
    return ingredients;
}

async function createSettings(
    fs: {
        writeFile: (arg0: any, arg1: Buffer) => any;
        stat: (arg0: any) => any;
    },
    folderUri: vscode.Uri,
    project: { description: string },
    direction: any,
    currentBurrito: {
        project: {
            textStories: {
                starred: boolean;
                isArchived: boolean;
                refResources: any;
                bookMarks: any;
            };
        };
    },
    copyright: { title: any },
    call: "new" | "edit"
) {
    const ingredients: {
        [x: string]: {
            checksum: { md5: any };
            mimeType: string;
            size: any;
            role: string;
        };
    } = {};
    const ingredientsDirName = "ingredients";
    const settings = {
        version: environment.AG_SETTING_VERSION,
        project: {
            textStories: {
                scriptDirection: direction,
                starred: call === "edit" ? currentBurrito.project.textStories.starred : false,
                isArchived: call === "edit" ? currentBurrito.project.textStories.isArchived : false,
                description: project.description,
                copyright: copyright.title,
                lastSeen: moment().format(),
                refResources:
                    call === "edit" ? currentBurrito.project.textStories.refResources : [],
                bookMarks: call === "edit" ? currentBurrito.project.textStories.bookMarks : [],
                font: "",
            },
        },
        sync: { services: { door43: [] } },
    };

    const projectSettingFileUri = folderUri.with({
        path: path.join(folderUri.path, ingredientsDirName, environment.PROJECT_SETTING_FILE),
    });

    await fs.writeFile(projectSettingFileUri, Buffer.from(JSON.stringify(settings)));
    const stats = await fs.stat(projectSettingFileUri);
    ingredients[path.join(ingredientsDirName, environment.PROJECT_SETTING_FILE)] = {
        checksum: {
            md5: md5(JSON.stringify(settings)),
        },
        mimeType: "application/json",
        size: stats.size,
        role: "x-scribe",
    };
    return ingredients;
}

export const createObsContent = async (
    project: { description: string },
    direction: any,
    currentBurrito: {
        project: {
            textStories: {
                starred: boolean;
                isArchived: boolean;
                refResources: any;
                bookMarks: any;
            };
        };
    },
    importedFiles: F["files"],
    copyright: { title: any },
    call: "new" | "edit",
    folderUri: any
) => {
    const fs = vscode.workspace.fs;
    let ingredients = {};

    await checkAndCreateDirectory(fs, folderUri);
    if (call === "new") {
        const storyIngredients = await processStoryFiles(fs, folderUri, importedFiles);
        ingredients = { ...ingredients, ...storyIngredients };
        const frontBackIngredients = await processFrontAndBackFiles(fs, folderUri, importedFiles);
        ingredients = { ...ingredients, ...frontBackIngredients };
        const licenseIngredients = await processLicenseFile(fs, folderUri);
        ingredients = { ...ingredients, ...licenseIngredients };
    }

    const settingsIngredients = await createSettings(
        fs,
        folderUri,
        project,
        direction,
        currentBurrito,
        copyright,
        call
    );
    ingredients = { ...ingredients, ...settingsIngredients };

    return ingredients;
};
