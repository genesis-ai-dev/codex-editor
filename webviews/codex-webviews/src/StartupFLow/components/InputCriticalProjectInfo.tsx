import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { useState } from "react";
import { MessagesToStartupFlowProvider } from "types";

export const InputCriticalProjectInfo = ({
    vscode,
}: {
    vscode: { postMessage: (message: any) => void };
}) => {
    const [currentStep, setCurrentStep] = useState<"source" | "target" | "complete">(
        "source"
    );

    const handleStepComplete = (
        command: string,
        nextStep: "source" | "target" | "complete"
    ) => {
        vscode.postMessage({
            command: command,
        });
        setCurrentStep(nextStep);
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
                }}
            >
                {currentStep === "source" && (
                    <i className="codicon codicon-source-control" style={{ fontSize: "72px" }}></i>
                )}
                {currentStep === "target" && (
                    <i className="codicon codicon-globe" style={{ fontSize: "72px" }}></i>
                )}
                {currentStep === "complete" && (
                    <i className="codicon codicon-symbol-variable" style={{ fontSize: "72px" }}></i>
                )}

                {currentStep === "source" && (
                    <VSCodeButton
                        onClick={() => handleStepComplete("changeSourceLanguage", "target")}
                    >
                        Source Language
                    </VSCodeButton>
                )}

                {currentStep === "target" && (
                    <VSCodeButton
                        onClick={() => handleStepComplete("changeTargetLanguage", "complete")}
                    >
                        Target Language
                    </VSCodeButton>
                )}

                {currentStep === "complete" && (
                    <VSCodeButton
                        onClick={() =>
                            vscode.postMessage({
                                command: "workspace.continue",
                            } as MessagesToStartupFlowProvider)
                        }
                    >
                        Start Project
                    </VSCodeButton>
                )}
            </div>
        </div>
    );
};
