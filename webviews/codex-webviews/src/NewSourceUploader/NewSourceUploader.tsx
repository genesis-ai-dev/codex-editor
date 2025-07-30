import React, { useState, useCallback, useEffect, useMemo } from "react";
import { importerPlugins, getImporterById } from "./importers/registry.tsx";
import { NotebookPair } from "./types/common";
import {
    ImporterComponentProps,
    ProviderMessage,
    ExistingFile,
    WriteTranslationMessage,
    AlignedCell,
    AlignmentHelper,
    defaultCellAligner,
    CellAligner,
    ImportedContent,
} from "./types/plugin";
import {
    WizardState,
    WizardStep,
    ImportIntent,
    ProjectInventory,
    TranslationPair,
    BasicFileInfo,
    DetailedFileInfo,
    FetchFileDetailsMessage,
    FileDetailsResponseMessage,
    FileDetailsErrorMessage,
    FetchTargetFileMessage,
    TargetFileResponseMessage,
    TargetFileErrorMessage,
} from "./types/wizard";
import { IntentSelection } from "./components/IntentSelection";
import { SourceFileSelection } from "./components/SourceFileSelection";
import { EmptySourceState } from "./components/EmptySourceState";
import { PluginSelection } from "./components/PluginSelection";
import "./App.css";
import "../tailwind.css";

// Get the VSCode API that was set up in the HTML
const vscode: { postMessage: (message: any) => void } = (window as any).vscodeApi;

const NewSourceUploader: React.FC = () => {
    // Wizard state
    const [wizardState, setWizardState] = useState<WizardState>({
        currentStep: "intent-selection",
        selectedIntent: null,
        selectedSourceForTarget: undefined,
        selectedSourceDetails: undefined,
        selectedPlugin: undefined,
        projectInventory: {
            sourceFiles: [],
            targetFiles: [],
            translationPairs: [],
        },
        isLoadingInventory: true,
        isLoadingFileDetails: false,
        fileDetailsError: undefined,
    });

    const [isDirty, setIsDirty] = useState(false);

    // State for managing alignment requests
    const [alignmentRequests, setAlignmentRequests] = useState<
        Map<
            string,
            {
                resolve: (alignedCells: AlignedCell[]) => void;
                reject: (error: Error) => void;
                importedContent: ImportedContent[];
                customAligner?: CellAligner;
            }
        >
    >(new Map());

    // Alignment helper function for plugins
    const alignContent: AlignmentHelper = useCallback(
        async (
            importedContent: ImportedContent[],
            sourceFilePath: string,
            customAligner?: CellAligner
        ): Promise<AlignedCell[]> => {
            return new Promise((resolve, reject) => {
                // Store the request with a unique key
                const requestKey = `${sourceFilePath}-${Date.now()}`;
                setAlignmentRequests(
                    (prev) =>
                        new Map(
                            prev.set(requestKey, {
                                resolve,
                                reject,
                                importedContent,
                                customAligner,
                            })
                        )
                );

                // Request target file content from provider
                const message: FetchTargetFileMessage = {
                    command: "fetchTargetFile",
                    sourceFilePath,
                };
                vscode.postMessage(message);

                // Set up timeout to avoid hanging requests
                setTimeout(() => {
                    setAlignmentRequests((prev) => {
                        const newMap = new Map(prev);
                        if (newMap.has(requestKey)) {
                            newMap.delete(requestKey);
                            reject(new Error("Alignment request timed out"));
                        }
                        return newMap;
                    });
                }, 30000); // 30 second timeout
            });
        },
        []
    );

    // Global message handler for provider messages
    useEffect(() => {
        const handleGlobalMessage = (event: MessageEvent) => {
            const message = event.data;

            if (message.command === "notification") {
                // Handle notifications from the provider
                const { type, message: notificationMessage } = message;

                // You can implement a toast notification system here
                // For now, using console and alert as fallback
                console.log(`${type.toUpperCase()}: ${notificationMessage}`);

                if (type === "error") {
                    alert(`Error: ${notificationMessage}`);
                } else if (type === "success") {
                    // Could show a success toast instead of alert
                    console.log(`Success: ${notificationMessage}`);
                } else if (type === "warning") {
                    console.warn(`Warning: ${notificationMessage}`);
                }
            } else if (message.command === "fileDetails") {
                // Handle file details response
                const response = message as FileDetailsResponseMessage;
                console.log("Received file details:", response);

                setWizardState((prev) => ({
                    ...prev,
                    selectedSourceDetails: response.details,
                    isLoadingFileDetails: false,
                    fileDetailsError: undefined,
                }));
            } else if (message.command === "fileDetailsError") {
                // Handle file details error
                const response = message as FileDetailsErrorMessage;
                console.error("File details error:", response.error);

                setWizardState((prev) => ({
                    ...prev,
                    isLoadingFileDetails: false,
                    fileDetailsError: response.error,
                }));
            } else if (message.command === "targetFileContent") {
                // Handle target file content response for alignment
                const response = message as TargetFileResponseMessage;
                console.log("Received target file content:", response);

                // Find and complete pending alignment requests for this source file
                setAlignmentRequests((prev) => {
                    const newMap = new Map(prev);
                    const completedRequests: string[] = [];

                    for (const [requestKey, request] of newMap.entries()) {
                        if (requestKey.startsWith(response.sourceFilePath)) {
                            // Run the alignment algorithm
                            const aligner = request.customAligner || defaultCellAligner;

                            aligner(
                                response.targetCells,
                                [], // Source cells not currently used
                                request.importedContent
                            )
                                .then((alignedCells) => {
                                    request.resolve(alignedCells);
                                })
                                .catch((error) => {
                                    request.reject(error);
                                });

                            completedRequests.push(requestKey);
                        }
                    }

                    // Remove completed requests
                    completedRequests.forEach((key) => newMap.delete(key));
                    return newMap;
                });
            } else if (message.command === "targetFileError") {
                // Handle target file error
                const response = message as TargetFileErrorMessage;
                console.error("Target file error:", response.error);

                // Reject pending alignment requests for this source file
                setAlignmentRequests((prev) => {
                    const newMap = new Map(prev);
                    const failedRequests: string[] = [];

                    for (const [requestKey, request] of newMap.entries()) {
                        if (requestKey.startsWith(response.sourceFilePath)) {
                            request.reject(new Error(response.error));
                            failedRequests.push(requestKey);
                        }
                    }

                    // Remove failed requests
                    failedRequests.forEach((key) => newMap.delete(key));
                    return newMap;
                });
            }
        };

        window.addEventListener("message", handleGlobalMessage);

        return () => {
            window.removeEventListener("message", handleGlobalMessage);
        };
    }, []);

    // Handle inventory updates from provider
    useEffect(() => {
        const handleInventoryMessage = (event: MessageEvent) => {
            const message = event.data;

            if (message.command === "projectInventory") {
                const inventory: ProjectInventory = message.inventory || {
                    sourceFiles: [],
                    targetFiles: [],
                    translationPairs: [],
                };

                console.log("Received project inventory:", inventory);

                setWizardState((prev) => ({
                    ...prev,
                    projectInventory: inventory,
                    isLoadingInventory: false,
                }));
            }
        };

        window.addEventListener("message", handleInventoryMessage);

        return () => {
            window.removeEventListener("message", handleInventoryMessage);
        };
    }, []);

    // Announce webview ready and request initial state
    useEffect(() => {
        console.log("Webview ready, requesting initial inventory...");

        vscode.postMessage({
            command: "webviewReady",
        });
    }, []);

    // Navigation handlers
    const handleSelectIntent = useCallback(
        (intent: ImportIntent) => {
            if (intent === "source") {
                setWizardState((prev) => ({
                    ...prev,
                    selectedIntent: intent,
                    currentStep: "source-import",
                }));
            } else if (intent === "target") {
                const hasSourceFiles = wizardState.projectInventory.sourceFiles.length > 0;
                setWizardState((prev) => ({
                    ...prev,
                    selectedIntent: intent,
                    currentStep: hasSourceFiles ? "target-selection" : "target-selection", // Empty state handled in render
                }));
            }
        },
        [wizardState.projectInventory]
    );

    const handleSelectSource = useCallback((source: BasicFileInfo) => {
        // Set loading state and request file details
        setWizardState((prev) => ({
            ...prev,
            selectedSourceForTarget: source,
            isLoadingFileDetails: true,
            fileDetailsError: undefined,
            currentStep: "target-import",
        }));

        // Request detailed file information
        const message: FetchFileDetailsMessage = {
            command: "fetchFileDetails",
            filePath: source.path,
        };
        vscode.postMessage(message);
    }, []);

    const handleSelectPlugin = useCallback(
        (pluginId: string) => {
            // Note: VS Code webviews don't support window.confirm() due to sandboxing
            // Skip confirmation dialog - user action is explicit enough
            setWizardState((prev) => ({
                ...prev,
                selectedPlugin: pluginId,
            }));
            setIsDirty(false);
        },
        [isDirty]
    );

    const handleComplete = useCallback(
        (notebooks: NotebookPair | NotebookPair[]) => {
            // Normalize to array format
            const notebookPairs = Array.isArray(notebooks) ? notebooks : [notebooks];

            // Send notebooks to provider for writing
            const message: ProviderMessage = {
                command: "writeNotebooks",
                notebookPairs,
                metadata: {
                    importerType: wizardState.selectedPlugin,
                    timestamp: new Date().toISOString(),
                    wizardContext: {
                        intent: wizardState.selectedIntent!,
                        selectedSource: wizardState.selectedSourceForTarget,
                    },
                },
            };

            vscode.postMessage(message);

            // Reset wizard
            setWizardState((prev) => ({
                ...prev,
                currentStep: "intent-selection",
                selectedIntent: null,
                selectedSourceForTarget: undefined,
                selectedPlugin: undefined,
            }));
            setIsDirty(false);

            // No need to manually refresh inventory - provider will send updated inventory
        },
        [wizardState]
    );

    const handleTranslationComplete = useCallback(
        (alignedContent: AlignedCell[], sourceFilePath: string) => {
            if (!wizardState.selectedSourceForTarget) {
                console.error("No source file selected for translation import");
                return;
            }

            // Derive target file path from source file path
            const targetFilePath = sourceFilePath
                .replace(/\.source$/, ".codex")
                .replace(/\/\.project\/sourceTexts\//, "/files/target/");

            // Send translation to provider for writing
            const message: WriteTranslationMessage = {
                command: "writeTranslation",
                alignedContent,
                sourceFilePath,
                targetFilePath,
                importerType: wizardState.selectedPlugin!,
                metadata: {
                    timestamp: new Date().toISOString(),
                    wizardContext: {
                        intent: wizardState.selectedIntent!,
                        selectedSource: wizardState.selectedSourceForTarget,
                    },
                },
            };

            vscode.postMessage(message);

            // Reset wizard
            setWizardState((prev) => ({
                ...prev,
                currentStep: "intent-selection",
                selectedIntent: null,
                selectedSourceForTarget: undefined,
                selectedSourceDetails: undefined,
                selectedPlugin: undefined,
            }));
            setIsDirty(false);
        },
        [wizardState]
    );

    const handleCancel = useCallback(() => {
        // Note: VS Code webviews don't support window.confirm() due to sandboxing
        // Skip confirmation dialog - user action is explicit enough
        setWizardState((prev) => ({
            ...prev,
            currentStep:
                prev.selectedIntent === "target" && prev.selectedSourceForTarget
                    ? "target-selection"
                    : "intent-selection",
            selectedPlugin: undefined,
        }));
        setIsDirty(false);
    }, [isDirty]);

    const handleCancelImport = useCallback(() => {
        // Reset entire wizard state to beginning
        // Note: VS Code webviews don't support window.confirm() due to sandboxing
        // The "Cancel Import" button text makes the action clear enough
        setWizardState((prev) => ({
            ...prev,
            currentStep: "intent-selection",
            selectedIntent: null,
            selectedSourceForTarget: undefined,
            selectedSourceDetails: undefined,
            selectedPlugin: undefined,
            isLoadingFileDetails: false,
            fileDetailsError: undefined,
        }));
        setIsDirty(false);
    }, []);

    const handleBack = useCallback(() => {
        setWizardState((prev) => {
            switch (prev.currentStep) {
                case "source-import":
                case "target-selection":
                    return { ...prev, currentStep: "intent-selection", selectedIntent: null };
                case "target-import":
                    return {
                        ...prev,
                        currentStep: "target-selection",
                        selectedSourceForTarget: undefined,
                    };
                default:
                    return prev;
            }
        });
    }, []);

    // If loading, show loading state
    if (wizardState.isLoadingInventory) {
        return (
            <div className="container mx-auto p-6 flex items-center justify-center min-h-[400px]">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                    <p className="text-muted-foreground">Loading project inventory...</p>
                </div>
            </div>
        );
    }

    // If a plugin is active, render its component
    if (wizardState.selectedPlugin) {
        const plugin = getImporterById(wizardState.selectedPlugin);
        if (!plugin) {
            return (
                <div className="container mx-auto p-6">
                    <p className="text-center text-red-600">
                        Error: Plugin '{wizardState.selectedPlugin}' not found
                    </p>
                </div>
            );
        }

        const PluginComponent = plugin.component;
        const wizardContext = {
            intent: wizardState.selectedIntent!,
            selectedSource: wizardState.selectedSourceForTarget,
            selectedSourceDetails: wizardState.selectedSourceDetails,
            projectInventory: wizardState.projectInventory,
        };

        // For target imports, we need detailed source info and should use translation completion
        const isTargetImport = wizardState.selectedIntent === "target";
        const componentProps: ImporterComponentProps = {
            onCancel: handleCancel,
            onCancelImport: handleCancelImport,
            wizardContext,
            // Only provide existingFiles for source imports (not implemented yet for target imports)
            ...(isTargetImport
                ? {
                      onTranslationComplete: handleTranslationComplete,
                      alignContent: alignContent, // Provide alignment helper for target imports
                      // For target imports, we'll pass detailed source info when available
                      existingFiles: wizardState.selectedSourceDetails
                          ? [wizardState.selectedSourceDetails]
                          : undefined,
                  }
                : {
                      onComplete: handleComplete,
                      // For source imports, use empty array since we have lazy loading now
                      existingFiles: [],
                  }),
        };

        return <PluginComponent {...componentProps} />;
    }

    // Render wizard steps
    switch (wizardState.currentStep) {
        case "intent-selection":
            return (
                <IntentSelection
                    onSelectIntent={handleSelectIntent}
                    sourceFileCount={wizardState.projectInventory.sourceFiles.length}
                    targetFileCount={wizardState.projectInventory.targetFiles.length}
                    translationPairCount={wizardState.projectInventory.translationPairs.length}
                />
            );

        case "source-import":
            return (
                <PluginSelection
                    plugins={importerPlugins}
                    intent="source"
                    existingSourceCount={wizardState.projectInventory.sourceFiles.length}
                    onSelectPlugin={handleSelectPlugin}
                    onBack={handleBack}
                />
            );

        case "target-selection":
            // Check if there are source files
            if (wizardState.projectInventory.sourceFiles.length === 0) {
                return (
                    <EmptySourceState
                        onImportSources={() => handleSelectIntent("source")}
                        onBack={handleBack}
                    />
                );
            }
            return (
                <SourceFileSelection
                    sourceFiles={wizardState.projectInventory.sourceFiles}
                    onSelectSource={handleSelectSource}
                    onBack={handleBack}
                />
            );

        case "target-import":
            return (
                <PluginSelection
                    plugins={importerPlugins}
                    intent="target"
                    selectedSource={wizardState.selectedSourceDetails}
                    existingSourceCount={wizardState.projectInventory.sourceFiles.length}
                    onSelectPlugin={handleSelectPlugin}
                    onBack={handleBack}
                />
            );

        default:
            return null;
    }
};

export default NewSourceUploader;
