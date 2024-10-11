import * as vscode from "vscode";
import { API as GitAPI, GitExtension } from "./git.d";
import { initProject, stageAndCommit, sync, addRemote } from "./git";

async function getGitAPI(): Promise<GitAPI | undefined> {
    const gitExtension = vscode.extensions.getExtension<GitExtension>("vscode.git");
    if (gitExtension && gitExtension.isActive) {
        return gitExtension.exports.getAPI(1);
    } else {
        await gitExtension?.activate();
        return gitExtension?.exports.getAPI(1);
    }
}

export function registerScmCommands(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand("codex.scm.handleSyncAction", handleSyncAction)
    );
}

async function handleSyncAction(fileUri: vscode.Uri, status: string) {
    const gitApi = await getGitAPI();
    if (!gitApi) {
        vscode.window.showErrorMessage("Git extension not found. Please install it and try again.");
        return;
    }

    const repository = gitApi.repositories.find((repo) =>
        fileUri.fsPath.startsWith(repo.rootUri.fsPath)
    );

    if (!repository && status !== "uninitialized") {
        vscode.window.showErrorMessage("No Git repository found for this file.");
        return;
    }

    switch (status) {
        case "uninitialized":
            await initializeRepository(fileUri);
            break;
        case "modified":
        case "added":
        case "deleted":
        case "renamed":
        case "untracked":
            await stageAndCommitChanges(repository, fileUri);
            break;
        case "conflict":
            await handleMergeConflict(repository, fileUri);
            break;
        case "committed":
            await syncChanges(repository);
            break;
        default:
            vscode.window.showWarningMessage(`Unknown status: ${status}`);
    }
}

async function initializeRepository(fileUri: vscode.Uri) {
    try {
        const folderUri = vscode.Uri.file(fileUri.fsPath.split("/").slice(0, -1).join("/"));
        await initProject("Codex User", "codex@example.com", folderUri);
        vscode.window.showInformationMessage("Git repository initialized successfully.");
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to initialize repository: ${error}`);
    }
}

async function stageAndCommitChanges(repository: any, fileUri: vscode.Uri) {
    try {
        await repository.add([fileUri.fsPath]);
        const commitMessage = await vscode.window.showInputBox({
            prompt: "Enter a commit message",
            placeHolder: "Commit message",
        });
        if (commitMessage) {
            await repository.commit(commitMessage);
            vscode.window.showInformationMessage("Changes committed successfully.");
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to commit changes: ${error}`);
    }
}

async function handleMergeConflict(repository: any, fileUri: vscode.Uri) {
    const action = await vscode.window.showQuickPick(
        ["Open File", "Resolve Using Ours", "Resolve Using Theirs"],
        {
            placeHolder: "Choose how to resolve the merge conflict",
        }
    );

    switch (action) {
        case "Open File":
            vscode.window.showTextDocument(fileUri);
            break;
        case "Resolve Using Ours":
            await repository.resolveConflict(fileUri.fsPath, "ours");
            vscode.window.showInformationMessage("Conflict resolved using our changes.");
            break;
        case "Resolve Using Theirs":
            await repository.resolveConflict(fileUri.fsPath, "theirs");
            vscode.window.showInformationMessage("Conflict resolved using their changes.");
            break;
    }
}

async function syncChanges(repository: any) {
    try {
        await sync();
        vscode.window.showInformationMessage("Changes synced successfully.");
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to sync changes: ${error}`);
    }
}
