import * as vscode from "vscode";
import { LanguageProjectStatus } from "codex-types";

import {
    promptForTargetLanguage,
    promptForSourceLanguage,
    updateMetadataFile,
    initializeProjectMetadata,
    accessMetadataFile,
    reopenWalkthrough,
} from "./utils/projectUtils";
import {
    downloadBible,
    setTargetFont,
} from "./projectInitializers";
import { migration_changeDraftFolderToFilesFolder } from "./utils/migrationUtils";
import { importLocalUsfmSourceBible } from '../utils/codexNotebookUtils';
import { checkIfMetadataIsInitialized, createProjectFiles, getProjectOverview, updateProjectSettings } from './utils/projectUtils';

export async function registerProjectManager(context: vscode.ExtensionContext) {
    let isWalkthroughCompleted = context.workspaceState.get<boolean>(
        "isWalkthroughCompleted",
        false
    );
    let redirecting = false;

    console.log("Codex Project Manager is now active!");

    //wrapper for registered commands
    const executeWithRedirecting = (
        command: (...args: any[]) => Promise<void>
    ) => {
        return async (...args: any[]) => {
            if (redirecting) {
                return;
            }
            redirecting = true;
            try {
                await command(...args);
            } finally {
                redirecting = false;
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
            // If we have essential project data, mark the walkthrough as completed
            isWalkthroughCompleted = true;
            await context.workspaceState.update("isWalkthroughCompleted", true);
        }

        // Only redirect if not in walkthrough and the editor is not undefined
        if (!isWalkthroughCompleted && !redirecting && editor) {
            const isWalkthroughEditor = editor.document.uri.scheme === "walkthrough";
            if (!isWalkthroughEditor) {
                redirecting = true;
                await reopenWalkthrough();
                redirecting = false;
            }
        }
    };

    // Delay registration of event listeners to avoid triggering on startup
    //setTimeout(async () => {

    console.log("Registering event listeners...");
    // Check if workspace folders are open
    if (
        !vscode.workspace.workspaceFolders ||
        vscode.workspace.workspaceFolders.length === 0 ||
        vscode.workspace.workspaceFolders[0].uri.fsPath === ""
    ) {
        // Start the walkthrough if no workspace folders are open
        vscode.commands.executeCommand("codex-project-manager.startWalkthrough");
    }

    // handle when any file or any other extension webview is opened
    vscode.window.onDidChangeVisibleTextEditors(async (editors) => {
        for (const editor of editors) {
            await handleEditorChange(editor);
        }
    });
    //}, 3000);

    // Register commands
    vscode.commands.registerCommand(
        "codex-project-manager.openAutoSaveSettings",
        executeWithRedirecting(async () => {
            await vscode.commands.executeCommand(
                "workbench.action.openSettings",
                "@files.autoSave"
            );
        })
    );
    vscode.commands.registerCommand(
        "codex-project-manager.downloadSourceTextBibles",
        () => downloadBible("source")
    );
    // vscode.commands.registerCommand(
    //     "codex-project-manager.downloadTargetTextBibles",
    //     async () => {
    //         const bibleFile = await downloadBible("target");
    //         const response = await vscode.window.showInformationMessage(
    //             "Would you like to load target text into the project?",
    //             { modal: true },
    //             "Yes"
    //         );
    //         if (response === "Yes") {
    //             parseAndReplaceBibleFile(bibleFile, true);
    //             vscode.window.showInformationMessage("Target text bible loaded.");
    //         } else {
    //             parseAndReplaceBibleFile(bibleFile, false);
    //             vscode.window.showInformationMessage("Target text bible not loaded.");
    //         }
    //     }
    // );
    // Register command to edit abbreviation
    vscode.commands.registerCommand(
        "codex-project-manager.editAbbreviation",
        executeWithRedirecting(async () => {
            redirecting = true;
            const isMetadataInitialized = await checkIfMetadataIsInitialized();

            if (!isMetadataInitialized) {
                // await checkForMissingFiles();
                await initializeProjectMetadata({});
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
                    // User cancelled the input
                    redirecting = false;
                    return;
                }
            }

            await config.update(
                "abbreviation",
                newProjectAbbreviation.toUpperCase(),
                vscode.ConfigurationTarget.Workspace
            );
            vscode.commands.executeCommand(
                "codex-project-manager.updateMetadataFile"
            );

            redirecting = false;
        })
    ),
        // Register command to select category
        vscode.commands.registerCommand(
            "codex-project-manager.selectCategory",
            executeWithRedirecting(async () => {
                const config = vscode.workspace.getConfiguration(
                    "codex-project-manager"
                );
                const currentCategory = config.get("projectCategory", "");

                const categories = [
                    "Scripture",
                    "Gloss",
                    "Parascriptural",
                    "Peripheral",
                ];

                const categoryItems = categories.map((category) => ({
                    label: category,
                }));
                const selectedCategory = await vscode.window.showQuickPick(
                    categoryItems,
                    {
                        placeHolder: "Select project category",
                    }
                );

                if (selectedCategory !== undefined) {
                    await config.update(
                        "projectCategory",
                        selectedCategory.label,
                        vscode.ConfigurationTarget.Workspace
                    );
                    vscode.commands.executeCommand(
                        "codex-project-manager.updateMetadataFile"
                    );
                    vscode.window.showInformationMessage(
                        `Project category set to ${selectedCategory.label}.`
                    );
                }
            })
        ),
        vscode.commands.registerCommand(
            "codex-project-manager.setEditorFontToTargetLanguage",
            await setTargetFont
        );
    // Register command to prompt user for target language
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-project-manager.changeTargetLanguage",
            executeWithRedirecting(async () => {
                const metadata = await accessMetadataFile();
                if (
                    !metadata
                ) {
                    vscode.commands.executeCommand(
                        "codex-project-manager.showProjectOverview"
                    );
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
                        vscode.window.showInformationMessage(
                            "Target language update cancelled."
                        );
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
        ),
        // Register command to prompt user for source language
        vscode.commands.registerCommand(
            "codex-project-manager.changeSourceLanguage",
            executeWithRedirecting(async () => {
                const metadata = await accessMetadataFile();
                if (
                    !metadata) {
                    vscode.commands.executeCommand(
                        "codex-project-manager.showProjectOverview"
                    );
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
                    vscode.window.showErrorMessage(
                        `Failed to set source language: ${error}`
                    );
                }
            })
        ),
        // Register command to initialize a new project
        vscode.commands.registerCommand(
            "codex-project-manager.initializeNewProject",
            executeWithRedirecting(async () => {
                const metadata = await accessMetadataFile();
                if (
                    !metadata?.languages?.find(
                        (lang: any) => lang.projectStatus === LanguageProjectStatus.TARGET
                    )
                ) {
                    vscode.commands.executeCommand(
                        "codex-project-manager.showProjectOverview"
                    );
                    return;
                }
                await createProjectFiles({ shouldImportUSFM: false });
            })
        ),
        // Register command to initialize an import project
        vscode.commands.registerCommand(
            "codex-project-manager.initializeImportProject",
            executeWithRedirecting(async () => {
                const metadata = await accessMetadataFile();
                if (
                    !metadata?.languages?.find(
                        (lang: any) => lang.projectStatus === LanguageProjectStatus.TARGET
                    )
                ) {
                    vscode.commands.executeCommand(
                        "codex-project-manager.showProjectOverview"
                    );
                    return;
                }
                await createProjectFiles({ shouldImportUSFM: true });
            })
        ),
        // Register command to name the project
        vscode.commands.registerCommand(
            "codex-project-manager.renameProject",
            executeWithRedirecting(async () => {
                redirecting = true;
                const isMetadataInitialized = await checkIfMetadataIsInitialized();

                if (!isMetadataInitialized) {
                    // await checkForMissingFiles();
                    await initializeProjectMetadata({});
                }

                const config = vscode.workspace.getConfiguration(
                    "codex-project-manager"
                );
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
                    vscode.commands.executeCommand(
                        "codex-project-manager.updateMetadataFile"
                    );
                }

                redirecting = false;
            })
        ),
        // Register command to set user name
        vscode.commands.registerCommand(
            "codex-project-manager.changeUserName",
            executeWithRedirecting(async () => {
                const metadata = await accessMetadataFile();
                if (!metadata) {
                    vscode.commands.executeCommand(
                        "codex-project-manager.showProjectOverview"
                    );
                    return;
                }
                const isMetadataInitialized = await checkIfMetadataIsInitialized();
                if (!isMetadataInitialized) {
                    await initializeProjectMetadata({});
                }

                const config = vscode.workspace.getConfiguration(
                    "codex-project-manager"
                );
                const currentUserName = config.get("userName", "");

                const newUserName = await vscode.window.showInputBox({
                    prompt: "Enter user name",
                    value: currentUserName,
                });

                if (newUserName !== undefined) {
                    await config.update(
                        "userName",
                        newUserName,
                        vscode.ConfigurationTarget.Workspace
                    );
                    vscode.commands.executeCommand(
                        "codex-project-manager.updateMetadataFile"
                    );
                }
            })
        ),
        // Register command to open project settings
        vscode.commands.registerCommand(
            "codex-project-manager.openProjectSettings",
            executeWithRedirecting(async () => {
                vscode.commands.executeCommand(
                    "workbench.action.openWorkspaceSettings",
                    "codex-project-manager"
                );
            })
        ),
        // Register command to start the walkthrough
        vscode.commands.registerCommand(
            "codex-project-manager.startWalkthrough",
            executeWithRedirecting(async () => {
                vscode.commands.executeCommand(
                    "workbench.action.openWalkthrough",
                    {
                        category:
                            "project-accelerate.codex-project-manager#codexWalkthrough",
                        step: "project-accelerate.codex-project-manager#openFolder",
                    },
                    true
                );
            })
        ),
        // Register command to start translating
        vscode.commands.registerCommand(
            "codex-project-manager.startTranslating",
            executeWithRedirecting(async () => {
                // check
                // if (!isProjectInitialized) {
                //   await vscode.commands.executeCommand("codex-project-manager.showProjectOverview");
                //   return;
                // }

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
                        vscode.commands.executeCommand("codex-project-manager.showProjectOverview");
                    } catch (error) {
                        console.error("Failed to open MAT.codex:", error);
                        vscode.window.showErrorMessage(
                            "Failed to open MAT.codex. Please ensure the file exists and the Codex Notebook extension is installed."
                        );
                    }
                } else {
                    // Open and focus the project manager panel
                    await vscode.commands.executeCommand(
                        "codex-project-manager.showProjectOverview"
                    );
                }

                isWalkthroughCompleted = true;
                context.workspaceState.update("isWalkthroughCompleted", true);
            })
        ),
        // Register command to reinstall VSCode extensions
        vscode.commands.registerCommand(
            "codex-project-manager.reinstallExtensions",
            async (extensionIds: string[]) => {
                if (!extensionIds || extensionIds.length === 0) {
                    vscode.window.showErrorMessage("No extension IDs provided.");
                    return;
                }

                // Uninstall extensions
                for (const id of extensionIds) {
                    try {
                        vscode.window.showInformationMessage(
                            `Uninstalling extension: ${id}`
                        );
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
                    vscode.window.showErrorMessage(
                        `Failed to reload window. Error: ${error}`
                    );
                    return;
                }

                vscode.window.showInformationMessage(
                    `Reinstalled extensions: ${extensionIds.join(", ")}`
                );
            }
        ),

        // Register command to show project overview
        vscode.commands.registerCommand(
            "codex-project-manager.showProjectOverview",
            async () => {
                await vscode.commands.executeCommand(
                    "workbench.view.extension.project-manager"
                );
                await vscode.commands.executeCommand(
                    "workbench.action.focusAuxiliaryBar"
                );

                // Get the provider instance
                const provider = (vscode.window as any).activeCustomEditorWebviewPanel;
                if (provider && provider.ensureWebviewReady) {
                    await provider.ensureWebviewReady();
                    await provider.updateProjectOverview();
                }
            }
        ),

        // Register event listener for configuration changes
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration("codex-project-manager")) {
                updateMetadataFile();
            }
        }),

        //register command to open AI settings
        vscode.commands.registerCommand(
            "codex-project-manager.openAISettings",
            async () => {
                vscode.commands.executeCommand(
                    "workbench.action.openSettings",
                    "translators-copilot"
                );
            }
        ),

        vscode.commands.registerCommand('codex-project-manager.importLocalUsfmSourceBible', importLocalUsfmSourceBible)
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
                const recommendedExtensions =
                    workspaceRecommendedExtensions as string[];
                recommendedExtensions.forEach((extension) => {
                    vscode.commands.executeCommand(
                        "workbench.extensions.installExtension",
                        extension
                    );
                });
            });
    }
}

