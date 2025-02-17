import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { useState } from "react";
import { MessagesToStartupFlowProvider } from "types";
import { LanguagePicker } from "../../shared/components/LanguagePicker";
import { LanguageMetadata } from "codex-types";

export const InputCriticalProjectInfo = ({
    vscode,
}: {
    vscode: { postMessage: (message: any) => void };
}) => {
    const [currentStep, setCurrentStep] = useState<"source" | "target" | "complete">(
        "source"
    );

    const handleLanguageSelect = (language: LanguageMetadata) => {
        vscode.postMessage({
            command: language.projectStatus === "source" ? "changeSourceLanguage" : "changeTargetLanguage",
            language,
        });
        setCurrentStep(language.projectStatus === "source" ? "target" : "complete");
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
                        />
                    </>
                )}

                {currentStep === "complete" && (
                    <>
                        <i className="codicon codicon-symbol-variable" style={{ fontSize: "72px" }}></i>
                        <VSCodeButton
                            onClick={() =>
                                vscode.postMessage({
                                    command: "workspace.continue",
                                } as MessagesToStartupFlowProvider)
                            }
                        >
                            Start Project
                        </VSCodeButton>
                    </>
                )}
            </div>
        </div>
    );
};
