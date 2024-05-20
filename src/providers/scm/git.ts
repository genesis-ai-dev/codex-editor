//scm/git.ts
import { getFromConfig, updateConfig } from "../../utils/appConfig";
import { projectFileExists } from "../../utils/fileUtils";
import { fileExists } from "../obs/CreateProject/utilities/obs";
import { API, Git, GitExtension } from "./git.d";
import * as vscode from "vscode";

const GIT_IGNORE_CONTENT = `
# Codex Editor
.scribe/*
.project/*
`;

export const initProject = async (
    name: string,
    email: string,
    projectUri?: vscode.Uri,
) => {

    const gitExtension = vscode.extensions.getExtension('vscode.git');

    if (!gitExtension) {
        const installGitExtension = await vscode.window.showInformationMessage(
            'Git extension not found. Would you like to install it now?',
            'Yes',
            'No'
        );

        if (installGitExtension === 'Yes') {
            await vscode.commands.executeCommand('workbench.extensions.installExtension', 'vscode.git');
            vscode.window.showInformationMessage('Git extension installed successfully. Please reload the window.');
        } else {
            vscode.window.showErrorMessage('Git extension is required for this feature. Please install it and try again.');
            return;
        }
    }

    const gitApi = vscode.extensions
        .getExtension<GitExtension>("vscode.git")
        ?.exports.getAPI(1);

    if (!gitApi) {
        vscode.window.showErrorMessage(
            "Git extension not found. Please install it and try again.",
        );
        return;
    }

    // FIXME: this code will fail the project creation process if no workspace is open
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage(
            "No workspace folder found. Please open a folder and try again.",
        );
        return;
    }

    const repository = await gitApi.init(projectUri ?? workspaceFolders[0].uri);

    if (!repository) {
        vscode.window.showErrorMessage(
            "Failed to initialize project. Please try again.",
        );
        return;
    }

    // Create .gitignore file
    const gitIgnoreUri = vscode.Uri.joinPath(
        projectUri ?? workspaceFolders[0].uri,
        ".gitignore",
    );

    if (!(await fileExists(gitIgnoreUri))) {
        await vscode.workspace.fs.writeFile(
            gitIgnoreUri,
            Buffer.from(GIT_IGNORE_CONTENT),
        );
    }

    if (name && email) {
        await addUser(name, email);
    }

    // staging all the project files
    const resources = [...repository.state.workingTreeChanges];
    const uris = resources.map((r) => r.uri).map((u) => u.path);
    if (uris.length > 0) {
        await repository.add(uris);
        await repository.commit("Initial commit");
    }
};

const sleep = async (ms: number) => {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
};

export const stageAndCommit = async () => {
    try {
        const gitApi: API = vscode.extensions
            .getExtension("vscode.git")
            ?.exports.getAPI(1);
        if (!gitApi || gitApi.repositories.length === 0) {
            console.error("Git API not found or no repositories available.");
            return;
        }
        const repository = gitApi.repositories[0];
        const resources = [...repository.state.workingTreeChanges];
        const uris = resources.map((r) => r.uri).map((u) => u.path);

        if (uris.length === 0) {
            return;
        }

        await repository.add(uris);
        await repository.commit(`${Date.now()}`);
    } catch (error) {
        vscode.window.showInformationMessage("No changes to sync locally");
    }
};

export const sync = async () => {
    const gitApi: API = vscode.extensions
        .getExtension("vscode.git")
        ?.exports.getAPI(1);
    if (!gitApi || gitApi.repositories.length === 0) {
        console.error("Git API not found or no repositories available.");
        return;
    }
    const repository = gitApi.repositories[0];
    await stageAndCommit().catch(console.error);
    await repository.pull().catch(console.error);
    await repository.push().catch(console.error);
};

export const addRemote = async (url: string) => {
    const configuration = vscode.workspace.getConfiguration("codex-editor.scm");
    const remoteFromConfig = await configuration.get("remoteUrl");

    const gitApi: API = vscode.extensions
        .getExtension("vscode.git")
        ?.exports.getAPI(1);
    if (!gitApi || gitApi.repositories.length === 0) {
        console.error("Git API not found or no repositories available.");
        return;
    }
    const repository = gitApi.repositories[0];

    if (remoteFromConfig && repository.state.remotes.length) {
        vscode.window.showErrorMessage("Remote already exists.");
        return;
    }

    await repository.addRemote("origin", url);
    await configuration.update("remoteUrl", url, false);

    if (repository.state.workingTreeChanges.length > 0) {
        await stageAndCommit().catch(console.error);
    }

    await repository.push("origin", repository.state.HEAD?.name, true);
};

export const isRemoteDiff = async () => {
    const gitApi: API = vscode.extensions
        .getExtension("vscode.git")
        ?.exports.getAPI(1);
    if (!gitApi || gitApi.repositories.length === 0) {
        console.error("Git API not found or no repositories available.");
        return;
    }
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
    if (!gitApi || gitApi.repositories.length === 0) {
        console.error(
            "Git API not found or no repositories available at `hasRemote`.",
        );
        return false;
    }
    const repository = gitApi?.repositories[0];
    if (!repository) {
        return false;
    }
    return Boolean(repository?.state?.remotes?.length);
};

export const hasPendingChanges = async () => {
    const gitApi: API = vscode.extensions
        .getExtension("vscode.git")
        ?.exports.getAPI(1);
    if (!gitApi || gitApi.repositories.length === 0) {
        console.error(
            "Git API not found or no repositories available at `hasPendingChanges`.",
        );
        return false;
    }
    const repository = gitApi?.repositories[0];
    if (!repository) {
        return false;
    }
    return Boolean(repository?.state?.workingTreeChanges?.length);
};

export const addUser = async (name: string, email: string) => {
    const gitApi: API = vscode.extensions
        .getExtension("vscode.git")
        ?.exports.getAPI(1);
    const repository = gitApi.repositories[0];
    await repository.setConfig("user.name", name);
    await repository.setConfig("user.email", email);
};

export const promptForLocalSync = async () => {
    if (!(await projectFileExists())) {
        return;
    }
    const gitApi: API = vscode.extensions
        .getExtension("vscode.git")
        ?.exports.getAPI(1);
    const repository = gitApi.repositories[0];

    if (repository.state.workingTreeChanges.length === 0) {
        return;
    }

    const commitChoice = await vscode.window.showInformationMessage(
        "You have unsynced local changes. Do you to sync them locally?",
        "Yes",
        "No",
    );

    if (commitChoice === "No") {
        return;
    }

    await stageAndCommit();
};

export const checkConfigRemoteAndUpdateIt = async () => {
    if (!(await projectFileExists())) {
        return;
    }
    const configuration = vscode.workspace.getConfiguration("codex-editor.scm"); // FIXME: why is this empty
    const remoteFromConfig = (await configuration.get("remoteUrl")) as string;
    const gitApi: API = vscode.extensions
        .getExtension("vscode.git")
        ?.exports.getAPI(1);
    const repository = gitApi.repositories[0];

    if (!repository) {
        return;
    }

    const backupRemote = repository.state.remotes.find(
        (r) => r.name === "origin",
    )?.fetchUrl;
    if (backupRemote === remoteFromConfig) { // FIXME: both seem to be empty
       
        return;
    }

    const remoteChangeChoice = await vscode.window.showInformationMessage(
        "Remote URL has changed. Do you want to update it?",
        "Yes",
        "No",
    );

    if (remoteChangeChoice === "No") {
        return;
    }

    await repository.removeRemote("origin").catch(console.error);

    await repository.addRemote("origin", remoteFromConfig).catch(async () => {
        await vscode.window.showErrorMessage(
            "Failed to update remote URL. Reverting to previous URL.",
        );
        await repository.addRemote("origin", backupRemote!);
    });

    if (repository.state.workingTreeChanges.length > 0) {
        await stageAndCommit();
    }

    await repository
        .push("origin", repository.state.HEAD?.name, true)
        .catch((err) => {
            console.error(err);
            vscode.window.showErrorMessage(
                "Failed to sync changes remote URL.",
            );
        });

    await vscode.window.showInformationMessage("Remote URL updated & synced.");
};
