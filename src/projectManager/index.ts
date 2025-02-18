import * as vscode from "vscode";
import { LanguageProjectStatus } from "codex-types";

import {
    promptForTargetLanguage,
    promptForSourceLanguage,
    updateMetadataFile,
    initializeProjectMetadataAndGit,
    accessMetadataFile,
    reopenWalkthrough,
} from "./utils/projectUtils";
import { setTargetFont } from "./projectInitializers";
import { migration_changeDraftFolderToFilesFolder } from "./utils/migrationUtils";
import { importLocalUsfmSourceBible } from "../utils/codexNotebookUtils";
import {
    checkIfMetadataAndGitIsInitialized,
    createProjectFiles,
    getProjectOverview,
    updateProjectSettings,
} from "./utils/projectUtils";
import { openSystemMessageEditor } from "../copilotSettings/copilotSettings";

export async function registerProjectManager(context: vscode.ExtensionContext) {
    console.log("Codex Project Manager is now active!");

    //wrapper for registered commands
    const executeWithRedirecting = (command: (...args: any[]) => Promise<void>) => {
        return async (...args: any[]) => {
            try {
                await command(...args);
            } catch (error) {
                console.error(error);
            }
        };
    };

    // Redirects the user to the walkthrough if they are not in the walkthrough
    const handleEditorChange = async (editor?: vscode.TextEditor) => {
        // Check if the project overview data is available and complete
        const projectOverview = await getProjectOverview();
        if (!projectOverview) {
            return;
        }
        if (
            projectOverview.projectName &&
            projectOverview.sourceLanguage &&
            projectOverview.targetLanguage
        ) {
            return;
        }
    };

    console.log("Registering event listeners...");

    // handle when any file or any other extension webview is opened
    vscode.window.onDidChangeVisibleTextEditors(async (editors) => {
        for (const editor of editors) {
            await handleEditorChange(editor);
        }
    });

    // Define commands
    const openAutoSaveSettingsCommand = vscode.commands.registerCommand(
        "codex-project-manager.openAutoSaveSettings",
        executeWithRedirecting(async () => {
            await vscode.commands.executeCommand(
                "workbench.action.openSettings",
                "@files.autoSave"
            );
        })
    );

    const editAbbreviationCommand = vscode.commands.registerCommand(
        "codex-project-manager.editAbbreviation",
        executeWithRedirecting(async () => {
            const isMetadataInitialized = await checkIfMetadataAndGitIsInitialized();

            if (!isMetadataInitialized) {
                await initializeProjectMetadataAndGit({});
            }

            const config = vscode.workspace.getConfiguration("codex-project-manager");
            const currentProjectAbbreviation = config.get("abbreviation", "");

            let newProjectAbbreviation: string | undefined;
            while (!newProjectAbbreviation || newProjectAbbreviation.length !== 3) {
                newProjectAbbreviation = await vscode.window.showInputBox({
                    prompt: "Enter project abbreviation (exactly 3 letters)",
                    value: currentProjectAbbreviation,
                    validateInput: (input) => {
                        if (input.length !== 3) {
                            return "The abbreviation must be exactly 3 letters long.";
                        }
                        if (!/^[a-zA-Z]+$/.test(input)) {
                            return "The abbreviation must contain only letters.";
                        }
                        return null;
                    },
                });

                if (newProjectAbbreviation === undefined) {
                    return;
                }
            }

            await config.update(
                "abbreviation",
                newProjectAbbreviation.toUpperCase(),
                vscode.ConfigurationTarget.Workspace
            );
            vscode.commands.executeCommand("codex-project-manager.updateMetadataFile");
        })
    );

    const selectCategoryCommand = vscode.commands.registerCommand(
        "codex-project-manager.selectCategory",
        executeWithRedirecting(async () => {
            const config = vscode.workspace.getConfiguration("codex-project-manager");
            const currentCategory = config.get("projectCategory", "");

            const categories = ["Scripture", "Gloss", "Parascriptural", "Peripheral"];

            const categoryItems = categories.map((category) => ({
                label: category,
            }));
            const selectedCategory = await vscode.window.showQuickPick(categoryItems, {
                placeHolder: "Select project category",
            });

            if (selectedCategory !== undefined) {
                await config.update(
                    "projectCategory",
                    selectedCategory.label,
                    vscode.ConfigurationTarget.Workspace
                );
                vscode.commands.executeCommand("codex-project-manager.updateMetadataFile");
                vscode.window.showInformationMessage(
                    `Project category set to ${selectedCategory.label}.`
                );
            }
        })
    );

    const setEditorFontToTargetLanguageCommand = vscode.commands.registerCommand(
        "codex-project-manager.setEditorFontToTargetLanguage",
        await setTargetFont
    );

    const changeTargetLanguageCommand = vscode.commands.registerCommand(
        "codex-project-manager.changeTargetLanguage",
        executeWithRedirecting(async () => {
            const metadata = await accessMetadataFile();
            if (!metadata) {
                vscode.commands.executeCommand("codex-project-manager.showProjectOverview");
                return;
            }
            const config = vscode.workspace.getConfiguration();
            const existingTargetLanguage = config.get("targetLanguage") as any;
            console.log("existingTargetLanguage", existingTargetLanguage);
            if (existingTargetLanguage) {
                const overwrite = await vscode.window.showWarningMessage(
                    `The target language is already set to ${existingTargetLanguage.refName}. Do you want to overwrite it?`,
                    "Yes",
                    "No"
                );
                if (overwrite === "Yes") {
                    const projectDetails = await promptForTargetLanguage();
                    const targetLanguage = projectDetails?.targetLanguage;
                    if (targetLanguage) {
                        await updateProjectSettings(projectDetails);
                        vscode.window.showInformationMessage(
                            `Target language updated to ${targetLanguage.refName}.`
                        );
                    }
                } else {
                    vscode.window.showInformationMessage("Target language update cancelled.");
                }
            } else {
                const projectDetails = await promptForTargetLanguage();
                const targetLanguage = projectDetails?.targetLanguage;
                if (targetLanguage) {
                    await updateProjectSettings(projectDetails);
                    vscode.window.showInformationMessage(
                        `Target language set to ${targetLanguage.refName}.`
                    );
                }
            }
        })
    );

    const changeSourceLanguageCommand = vscode.commands.registerCommand(
        "codex-project-manager.changeSourceLanguage",
        executeWithRedirecting(async () => {
            const metadata = await accessMetadataFile();
            if (!metadata) {
                vscode.commands.executeCommand("codex-project-manager.showProjectOverview");
                return;
            }
            try {
                const projectDetails = await promptForSourceLanguage();
                const sourceLanguage = projectDetails?.sourceLanguage;
                console.log("sourceLanguage", sourceLanguage);
                if (sourceLanguage) {
                    await updateProjectSettings(projectDetails);
                    vscode.window.showInformationMessage(
                        `Source language set to ${sourceLanguage.refName}.`
                    );
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to set source language: ${error}`);
            }
        })
    );

    const initializeNewProjectCommand = vscode.commands.registerCommand(
        "codex-project-manager.initializeNewProject",
        executeWithRedirecting(async () => {
            const metadata = await accessMetadataFile();
            if (
                !metadata?.languages?.find(
                    (lang: any) => lang.projectStatus === LanguageProjectStatus.TARGET
                )
            ) {
                vscode.commands.executeCommand("codex-project-manager.showProjectOverview");
                return;
            }
            await createProjectFiles({ shouldImportUSFM: false });
        })
    );

    const initializeImportProjectCommand = vscode.commands.registerCommand(
        "codex-project-manager.initializeImportProject",
        executeWithRedirecting(async () => {
            const metadata = await accessMetadataFile();
            if (
                !metadata?.languages?.find(
                    (lang: any) => lang.projectStatus === LanguageProjectStatus.TARGET
                )
            ) {
                vscode.commands.executeCommand("codex-project-manager.showProjectOverview");
                return;
            }
            await createProjectFiles({ shouldImportUSFM: true });
        })
    );

    const renameProjectCommand = vscode.commands.registerCommand(
        "codex-project-manager.renameProject",
        executeWithRedirecting(async () => {
            const isMetadataInitialized = await checkIfMetadataAndGitIsInitialized();

            if (!isMetadataInitialized) {
                await initializeProjectMetadataAndGit({});
            }

            const config = vscode.workspace.getConfiguration("codex-project-manager");
            const currentProjectName = config.get("projectName", "");

            const newProjectName = await vscode.window.showInputBox({
                prompt: "Enter project name",
                value: currentProjectName,
            });

            if (newProjectName !== undefined) {
                await config.update(
                    "projectName",
                    newProjectName,
                    vscode.ConfigurationTarget.Workspace
                );
                vscode.commands.executeCommand("codex-project-manager.updateMetadataFile");
            }
        })
    );

    const changeUserNameCommand = vscode.commands.registerCommand(
        "codex-project-manager.changeUserName",
        executeWithRedirecting(async () => {
            const metadata = await accessMetadataFile();
            if (!metadata) {
                vscode.commands.executeCommand("codex-project-manager.showProjectOverview");
                return;
            }
            const isMetadataInitialized = await checkIfMetadataAndGitIsInitialized();
            if (!isMetadataInitialized) {
                await initializeProjectMetadataAndGit({});
            }

            const config = vscode.workspace.getConfiguration("codex-project-manager");
            const currentUserName = config.get("userName", "");

            const newUserName = await vscode.window.showInputBox({
                prompt: "Enter user name",
                value: currentUserName,
            });

            if (newUserName !== undefined) {
                await config.update("userName", newUserName, vscode.ConfigurationTarget.Workspace);
                vscode.commands.executeCommand("codex-project-manager.updateMetadataFile");
            }
        })
    );

    const changeUserEmailCommand = vscode.commands.registerCommand(
        "codex-project-manager.changeUserEmail",
        executeWithRedirecting(async () => {
            const config = vscode.workspace.getConfiguration("codex-project-manager");
            const currentUserEmail = config.get("userEmail", "");

            const newUserEmail = await vscode.window.showInputBox({
                prompt: "Enter user email",
                value: currentUserEmail,
            });

            if (newUserEmail !== undefined) {
                await config.update(
                    "userEmail",
                    newUserEmail,
                    vscode.ConfigurationTarget.Workspace
                );
                vscode.commands.executeCommand("codex-project-manager.updateMetadataFile");
            }
        })
    );

    const openProjectSettingsCommand = vscode.commands.registerCommand(
        "codex-project-manager.openProjectSettings",
        executeWithRedirecting(async () => {
            vscode.commands.executeCommand(
                "workbench.action.openWorkspaceSettings",
                "codex-project-manager"
            );
        })
    );

    const startWalkthroughCommand = vscode.commands.registerCommand(
        "codex-project-manager.startWalkthrough",
        executeWithRedirecting(async () => {
            vscode.commands.executeCommand(
                "workbench.action.openWalkthrough",
                {
                    category: "project-accelerate.codex-project-manager#codexWalkthrough",
                    step: "project-accelerate.codex-project-manager#openFolder",
                },
                true
            );
        })
    );

    const startTranslatingCommand = vscode.commands.registerCommand(
        "codex-project-manager.startTranslating",
        executeWithRedirecting(async () => {
            const projectOverview = await getProjectOverview();
            if (!projectOverview) {
                return;
            }
            const isProjectHealthy =
                projectOverview.projectName &&
                projectOverview.sourceLanguage &&
                projectOverview.targetLanguage &&
                projectOverview.userName;

            if (isProjectHealthy) {
                const matCodexUri = vscode.Uri.joinPath(
                    vscode.workspace.workspaceFolders![0].uri,
                    "files",
                    "target",
                    "MAT.codex"
                );
                try {
                    // Check if MAT.codex exists
                    await vscode.workspace.fs.stat(matCodexUri);
                    // If it exists, open it
                    await vscode.commands.executeCommand(
                        "vscode.openWith",
                        matCodexUri,
                        "codex.cellEditor"
                    );
                } catch (error) {
                    // If MAT.codex doesn't exist or there's an error, just show the project overview
                    console.log(
                        "MAT.codex not found or error occurred, showing project overview instead:",
                        error
                    );
                    await vscode.commands.executeCommand(
                        "codex-project-manager.showProjectOverview"
                    );
                }
            } else {
                // Open and focus the project manager panel
                await vscode.commands.executeCommand("codex-project-manager.showProjectOverview");
            }
        })
    );

    const reinstallExtensionsCommand = vscode.commands.registerCommand(
        "codex-project-manager.reinstallExtensions",
        async (extensionIds: string[]) => {
            if (!extensionIds || extensionIds.length === 0) {
                vscode.window.showErrorMessage("No extension IDs provided.");
                return;
            }

            // Uninstall extensions
            for (const id of extensionIds) {
                try {
                    vscode.window.showInformationMessage(`Uninstalling extension: ${id}`);
                    await vscode.commands.executeCommand(
                        "workbench.extensions.uninstallExtension",
                        id
                    );
                    await new Promise((resolve) => setTimeout(resolve, 2000));
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to uninstall extension: ${id}. Error: ${error}`
                    );
                    return;
                }
            }

            // Re-install extensions
            for (const id of extensionIds) {
                try {
                    vscode.window.showInformationMessage(`Installing extension: ${id}`);
                    await vscode.commands.executeCommand(
                        "workbench.extensions.installExtension",
                        id
                    );
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Failed to install extension: ${id}. Error: ${error}`
                    );
                    return;
                }
            }
            // Reload window
            try {
                vscode.window.showInformationMessage(`Reloading window...`);
                await new Promise((resolve) => setTimeout(resolve, 2000));
                await vscode.commands.executeCommand("workbench.action.reloadWindow");
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to reload window. Error: ${error}`);
                return;
            }

            vscode.window.showInformationMessage(
                `Reinstalled extensions: ${extensionIds.join(", ")}`
            );
        }
    );

    const showProjectOverviewCommand = vscode.commands.registerCommand(
        "codex-project-manager.showProjectOverview",
        async () => {
            await vscode.commands.executeCommand("workbench.view.extension.project-manager");
            await vscode.commands.executeCommand("workbench.action.focusAuxiliaryBar");

            // Get the provider instance
            const provider = (vscode.window as any).activeCustomEditorWebviewPanel;
            if (provider && provider.ensureWebviewReady) {
                await provider.ensureWebviewReady();
                await provider.updateProjectOverview();
            }
        }
    );

    const openAISettingsCommand = vscode.commands.registerCommand(
        "codex-project-manager.openAISettings",
        openSystemMessageEditor
    );

    const toggleSpellcheckCommand = vscode.commands.registerCommand(
        "codex-project-manager.toggleSpellcheck",
        executeWithRedirecting(async () => {
            const config = vscode.workspace.getConfiguration("codex-project-manager");
            const currentSpellcheckIsEnabledValue = config.get("spellcheckIsEnabled", false);

            const newSpellcheckIsEnabledValue = !currentSpellcheckIsEnabledValue;

            console.log("currentSpellcheckIsEnabledValue", currentSpellcheckIsEnabledValue);
            console.log("newSpellcheckIsEnabledValue", newSpellcheckIsEnabledValue);

            await config.update(
                "spellcheckIsEnabled",
                newSpellcheckIsEnabledValue,
                vscode.ConfigurationTarget.Workspace
            );
            vscode.commands.executeCommand("codex-project-manager.updateMetadataFile");
            vscode.window.showInformationMessage(
                `Spellcheck is now ${newSpellcheckIsEnabledValue ? "enabled" : "disabled"}.`
            );
        })
    );

    const importLocalUsfmSourceBibleCommand = vscode.commands.registerCommand(
        "codex-project-manager.importLocalUsfmSourceBible",
        importLocalUsfmSourceBible
    );

    // Register event listener for configuration changes
    const onDidChangeConfigurationListener = vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("codex-project-manager")) {
            updateMetadataFile();
        }
    });

    // Register commands and event listeners
    context.subscriptions.push(
        openAutoSaveSettingsCommand,
        editAbbreviationCommand,
        selectCategoryCommand,
        setEditorFontToTargetLanguageCommand,
        changeTargetLanguageCommand,
        changeSourceLanguageCommand,
        initializeNewProjectCommand,
        initializeImportProjectCommand,
        renameProjectCommand,
        changeUserNameCommand,
        openProjectSettingsCommand,
        startWalkthroughCommand,
        startTranslatingCommand,
        reinstallExtensionsCommand,
        showProjectOverviewCommand,
        openAISettingsCommand,
        importLocalUsfmSourceBibleCommand,
        changeUserEmailCommand,
        onDidChangeConfigurationListener,
        toggleSpellcheckCommand
    );

    // Prompt user to install recommended extensions
    const workspaceRecommendedExtensions = vscode.workspace
        .getConfiguration("codex-project-manager")
        .get("workspaceRecommendedExtensions");
    if (workspaceRecommendedExtensions) {
        vscode.window
            .showInformationMessage(
                "Codex Project Manager has recommended extensions for you to install. Would you like to install them now?",
                "Yes",
                "No"
            )
            .then((response) => {
                const recommendedExtensions = workspaceRecommendedExtensions as string[];
                recommendedExtensions.forEach((extension) => {
                    vscode.commands.executeCommand(
                        "workbench.extensions.installExtension",
                        extension
                    );
                });
            });
    }
}
