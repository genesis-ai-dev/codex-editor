import * as vscode from "vscode";

const CONFIG_FILE_NAME = "scribe.config.json";

const getConfigFromDisk = async () => {
    const rootDir = vscode.workspace.workspaceFolders?.[0].uri;
    if (!rootDir) {
        console.error("No workspace found.");
        return;
    }
    const configUri = vscode.Uri.joinPath(rootDir, CONFIG_FILE_NAME);
    const configJson = vscode.workspace.fs.readFile(configUri);
    const config = JSON.parse(configJson.toString());
    return config;
};

const saveToConfigToDisk = async (config: any) => {
    const rootDir = vscode.workspace.workspaceFolders?.[0].uri;
    if (!rootDir) {
        console.error("No workspace found.");
        return;
    }
    const configUri = vscode.Uri.joinPath(rootDir, CONFIG_FILE_NAME);
    const configJson = JSON.stringify(config);
    await vscode.workspace.fs.writeFile(configUri, Buffer.from(configJson));
};

export const addToConfig = async (key: string, value: unknown) => {
    const config = await getConfigFromDisk();
    if (config[key] !== undefined) {
        vscode.window.showErrorMessage("Key already exists.");
        return;
    }
    config[key] = value;
    await saveToConfigToDisk(config);
};
export const getFromConfig = async (key: string) => {
    const config = await getConfigFromDisk();
    return config[key];
};
export const removeFromConfig = async (key: string) => {
    const config = await getConfigFromDisk();
    if (config[key] === undefined) {
        vscode.window.showErrorMessage("Key does not exist.");
        return;
    }
    delete config[key];
    await saveToConfigToDisk(config);
};
export const updateConfig = async (key: string, value: unknown) => {
    const config = await getConfigFromDisk();
    config[key] = value;
    await saveToConfigToDisk(config);
};
export const getConfig = async () => {
    const config = await getConfigFromDisk();
    return config;
};
