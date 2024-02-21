import type * as vscode from "vscode";

export type DownloadedResource = {
    name: string;
    id: string;
    localPath: string;
    remoteUrl: string;
    version: string;
    type: string;
};

export type OpenResource = DownloadedResource & {
    viewColumn: vscode.ViewColumn;
};
