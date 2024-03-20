import { fileExists } from "../obs/CreateProject/utilities/obs";
import { API, Git, GitExtension } from "./git.d";
import * as vscode from "vscode";

const GIT_IGNORE_CONTENT = `
# Codex Editor
.scribe/*
.project/*
`;

export const initProject = async (projectUri?: vscode.Uri) => {
    const gitApi = vscode.extensions
        .getExtension<GitExtension>("vscode.git")
        ?.exports.getAPI(1);

    if (!gitApi) {
        vscode.window.showErrorMessage(
            "Git extension not found. Please install it and try again.",
        );
        return;
    }

    const repository = await gitApi.init(
        projectUri ?? vscode.workspace.workspaceFolders![0].uri,
    );

    if (!repository) {
        vscode.window.showErrorMessage(
            "Failed to initialize project. Please try again.",
        );
        return;
    }

    // Create .gitignore file
    const gitIgnoreUri = vscode.Uri.joinPath(
        projectUri ?? vscode.workspace.workspaceFolders![0].uri,
        ".gitignore",
    );

    if (!(await fileExists(gitIgnoreUri))) {
        await vscode.workspace.fs.writeFile(
            gitIgnoreUri,
            Buffer.from(GIT_IGNORE_CONTENT),
        );
    }

    // staging all the project files
    const resources = [...repository.state.workingTreeChanges];
    const uris = resources.map((r) => r.uri).map((u) => u.path);
    await repository.add(uris);

    await repository.commit("Initial commit");
};

const sleep = async (ms: number) => {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
};

export const stageAndCommit = async () => {
    const gitApi: API = vscode.extensions
        .getExtension("vscode.git")
        ?.exports.getAPI(1);
    const repository = gitApi.repositories[0];
    const resources = [...repository.state.workingTreeChanges];
    const uris = resources.map((r) => r.uri).map((u) => u.path);
    await repository.add(uris);
    await repository.commit(`${Date.now()}`);
};

export const sync = async () => {
    const gitApi: API = vscode.extensions
        .getExtension("vscode.git")
        ?.exports.getAPI(1);
    const repository = gitApi.repositories[0];
    await stageAndCommit().catch(console.error);
    await repository.pull().catch(console.error);
    await repository.push().catch(console.error);
};

export const addRemote = async (url: string) => {
    const gitApi: API = vscode.extensions
        .getExtension("vscode.git")
        ?.exports.getAPI(1);
    const repository = gitApi.repositories[0];
    await repository.addRemote("origin", url);

    if (repository.state.workingTreeChanges.length > 0) {
        await stageAndCommit();
    }
    await repository.push("origin");
};

export const isRemoteDiff = async () => {
    const gitApi: API = vscode.extensions
        .getExtension("vscode.git")
        ?.exports.getAPI(1);
    const repository = gitApi.repositories[0];

    await repository.fetch("origin").catch(console.error);
    const currentBranch = repository.state.HEAD?.name;

    if (!currentBranch) {
        return;
    }
    const localBranch = await repository.getBranch(currentBranch!);

    if (!localBranch) {
        return;
    }

    if (!localBranch.upstream) {
        return true;
    }

    const remoteBranch = await repository.getBranch(localBranch.upstream?.name);

    if (!remoteBranch) {
        return;
    }

    if ((remoteBranch.behind ?? 0) > 0 || (remoteBranch.ahead ?? 0) > 0) {
        return true;
    }

    return false;
};

export const hasRemote = async () => {
    const gitApi: API = vscode.extensions
        .getExtension("vscode.git")
        ?.exports.getAPI(1);
    const repository = gitApi.repositories[0];
    return Boolean(repository.state.remotes.length);
};

export const hasPendingChanges = async () => {
    const gitApi: API = vscode.extensions
        .getExtension("vscode.git")
        ?.exports.getAPI(1);
    const repository = gitApi.repositories[0];
    return Boolean(repository.state.workingTreeChanges.length);
};
