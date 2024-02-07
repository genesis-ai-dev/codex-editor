// eslint-disable-next-line @typescript-eslint/naming-convention
import * as vscode from "vscode";
import { getWorkSpaceFolder } from ".";
import * as path from "path";

export const generateFiles = async ({
    filepath,
    fileContent,
    shouldOverWrite,
}: {
    filepath: string;
    fileContent: Uint8Array;
    shouldOverWrite: boolean;
}) => {
    const workspaceFolder = getWorkSpaceFolder();

    if (!workspaceFolder) {
        return;
    }

    const newFilePath = vscode.Uri.file(
        path.join(
            workspaceFolder,
            filepath.startsWith("/") ? filepath : `/${filepath}`,
        ),
    );
    let fileSuccessfullyCreated: boolean = false;

    vscode.workspace.fs.stat(newFilePath).then(
        () => {
            if (shouldOverWrite) {
                vscode.workspace.fs.writeFile(newFilePath, fileContent).then(
                    () => {
                        fileSuccessfullyCreated = true;
                        vscode.window.showInformationMessage(
                            `${filepath} overwritten successfully!`,
                        );
                    },
                    (err) => {
                        console.error(`Error: ${err}`);
                        vscode.window.showErrorMessage(
                            `Error overwriting ${filepath} file: ${err.message}`,
                        );
                    },
                );
            } else {
                vscode.window.showInformationMessage(
                    `${filepath} file already exists!`,
                );
            }
        },
        (err) => {
            vscode.workspace.fs.writeFile(newFilePath, fileContent).then(
                () => {
                    fileSuccessfullyCreated = true;
                    vscode.window.showInformationMessage(
                        `${filepath} file created successfully!`,
                    );
                },
                (err) => {
                    console.error(`Error: ${err}`);
                    vscode.window.showErrorMessage(
                        `Error creating new ${filepath} file: ${err.message}`,
                    );
                },
            );
        },
    );
    return fileSuccessfullyCreated;
};
