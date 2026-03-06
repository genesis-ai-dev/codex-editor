import { useEffect, useRef, useState } from "react";
import { MessagesToStartupFlowProvider } from "types";
import { LanguagePicker } from "../../shared/components/LanguagePicker";
import { LanguageMetadata } from "codex-types";

const proceedToSourceUpload = (
    vscode: { postMessage: (message: unknown) => void },
) => {
    vscode.postMessage({ command: "systemMessage.generate" } as MessagesToStartupFlowProvider);
    vscode.postMessage({ command: "openSourceUpload" });
    vscode.postMessage({ command: "workspace.continue" } as MessagesToStartupFlowProvider);
};

export const InputCriticalProjectInfo = ({
    vscode,
}: {
    vscode: { postMessage: (message: any) => void };
}) => {
    const [currentStep, setCurrentStep] = useState<"source" | "target">("source");
    const [sourceLanguage, setSourceLanguage] = useState<LanguageMetadata | null>(null);
    const [targetLanguage, setTargetLanguage] = useState<LanguageMetadata | null>(null);
    const waitingForTargetSave = useRef(false);

    useEffect(() => {
        // Always show Project Manager immediately
        vscode.postMessage({ command: "project.showManager" });
        // Request metadata check to determine initial state
        vscode.postMessage({ command: "metadata.check" });
    }, []);

    useEffect(() => {
        const handleMessage = (event: MessageEvent<any>) => {
            if (event.data.command === "metadata.checkResponse") {
                const metadata = event.data.data;
                setSourceLanguage(metadata.sourceLanguage);
                setTargetLanguage(metadata.targetLanguage);

                if (metadata.sourceLanguage && !metadata.targetLanguage) {
                    setCurrentStep("target");
                    return;
                } else if (metadata.sourceLanguage && metadata.targetLanguage) {
                    proceedToSourceUpload(vscode);
                    return;
                }

                setCurrentStep("source");
            } else if (
                event.data.command === "state.update" &&
                event.data.state.value === "promptUserToAddCriticalData"
            ) {
                vscode.postMessage({ command: "metadata.check" });
            } else if (event.data.command === "actionCompleted" && waitingForTargetSave.current) {
                waitingForTargetSave.current = false;
                proceedToSourceUpload(vscode);
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, []);

    const handleLanguageSelect = (language: LanguageMetadata) => {
        vscode.postMessage({
            command:
                language.projectStatus === "source"
                    ? "changeSourceLanguage"
                    : "changeTargetLanguage",
            language,
        });

        if (language.projectStatus === "source") {
            setSourceLanguage(language);
            setCurrentStep("target");
        } else {
            setTargetLanguage(language);
            // Wait for the provider to confirm the language was saved before
            // triggering systemMessage.generate (which reads metadata.json)
            waitingForTargetSave.current = true;
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
                        <i
                            className="codicon codicon-source-control"
                            style={{ fontSize: "72px" }}
                        ></i>
                        <LanguagePicker
                            onLanguageSelect={handleLanguageSelect}
                            projectStatus="source"
                            label="Select Source Language"
                            initialLanguage={sourceLanguage || undefined}
                        />
                        <p
                            style={{
                                margin: "-12px 0 0",
                                fontSize: "0.85rem",
                                color: "var(--vscode-descriptionForeground)",
                                textAlign: "center",
                            }}
                        >
                            This is used to instruct the AI translation assistant. You can change it
                            any time in settings.
                        </p>
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
                        <p
                            style={{
                                margin: "-12px 0 0",
                                fontSize: "0.85rem",
                                color: "var(--vscode-descriptionForeground)",
                                textAlign: "center",
                            }}
                        >
                            This is used to instruct the AI translation assistant. You can change it
                            any time in settings.
                        </p>
                    </>
                )}
            </div>
        </div>
    );
};
