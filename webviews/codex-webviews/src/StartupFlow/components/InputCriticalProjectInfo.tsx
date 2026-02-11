import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { useEffect, useState } from "react";
import { MessagesToStartupFlowProvider } from "types";
import { LanguagePicker } from "../../shared/components/LanguagePicker";
import { LanguageMetadata } from "codex-types";

export const InputCriticalProjectInfo = ({
    vscode,
}: {
    vscode: { postMessage: (message: any) => void };
}) => {
    const [currentStep, setCurrentStep] = useState<"source" | "target" | "complete">("source");
    const [sourceLanguage, setSourceLanguage] = useState<LanguageMetadata | null>(null);
    const [targetLanguage, setTargetLanguage] = useState<LanguageMetadata | null>(null);

    useEffect(() => {
        // Always show Project Manager immediately
        vscode.postMessage({ command: "project.showManager" });
        // Request metadata check to determine initial state
        vscode.postMessage({ command: "metadata.check" });
    }, []);

    // Listen for metadata check response
    useEffect(() => {
        const handleMessage = (event: MessageEvent<any>) => {
            if (event.data.command === "metadata.checkResponse") {
                const metadata = event.data.data;
                setSourceLanguage(metadata.sourceLanguage);
                setTargetLanguage(metadata.targetLanguage);
                
                // If source language exists but target doesn't, start with target step
                if (metadata.sourceLanguage && !metadata.targetLanguage) {
                    setCurrentStep("target");
                    return;
                } else if (metadata.sourceLanguage && metadata.targetLanguage) {
                    // Both languages exist - continue to workspace
                    vscode.postMessage({
                        command: "workspace.continue",
                    } as MessagesToStartupFlowProvider);
                    return;
                }
                
                // Otherwise start with source step
                setCurrentStep("source");
            } else if (event.data.command === "state.update" && event.data.state.value === "promptUserToAddCriticalData") {
                // When we receive the state update that we're in the critical data state, start checking metadata
                vscode.postMessage({ command: "metadata.check" });
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, []);

    const handleLanguageSelect = (language: LanguageMetadata) => {
        vscode.postMessage({
            command: language.projectStatus === "source" ? "changeSourceLanguage" : "changeTargetLanguage",
            language,
        });
        
        if (language.projectStatus === "source") {
            setSourceLanguage(language);
            setCurrentStep("target");
        } else {
            setTargetLanguage(language);
            // After target language is selected, move to complete step
            setCurrentStep("complete");
        }
    };
    

    return (
        <div
            style={{
                display: "flex",
                gap: "10px",
                width: "100%",
                height: "100vh",
                alignItems: "center",
                justifyContent: "center",
            }}
        >
            <div
                style={{
                    display: "flex",
                    gap: "10px",
                    marginBottom: "37vh",
                    alignItems: "center",
                    justifyContent: "center",
                    flexDirection: "column",
                    width: "300px",
                }}
            >
                {currentStep === "source" && (
                    <>
                        <i className="codicon codicon-source-control" style={{ fontSize: "72px" }}></i>
                        <LanguagePicker
                            onLanguageSelect={handleLanguageSelect}
                            projectStatus="source"
                            label="Select Source Language"
                            initialLanguage={sourceLanguage || undefined}
                        />
                    </>
                )}

                {currentStep === "target" && (
                    <>
                        <i className="codicon codicon-globe" style={{ fontSize: "72px" }}></i>
                        <LanguagePicker
                            onLanguageSelect={handleLanguageSelect}
                            projectStatus="target"
                            label="Select Target Language"
                            initialLanguage={targetLanguage || undefined}
                        />
                    </>
                )}

                {currentStep === "complete" && (
                    <>
                        <i className="codicon codicon-symbol-variable" style={{ fontSize: "72px" }}></i>
                        <VSCodeButton
                            onClick={() => {
                                // Start generating system message in the background
                                // This will be saved to metadata.json automatically by the provider
                                vscode.postMessage({
                                    command: "systemMessage.generate",
                                } as MessagesToStartupFlowProvider);
                                vscode.postMessage({ command: "openSourceUpload" });
                                vscode.postMessage({
                                    command: "workspace.continue",
                                } as MessagesToStartupFlowProvider);
                            }}
                        >
                            Continue to Source Upload
                        </VSCodeButton>
                    </>
                )}
            </div>
        </div>
    );
};
