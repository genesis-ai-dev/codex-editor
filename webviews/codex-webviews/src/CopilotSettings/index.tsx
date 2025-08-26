import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { WebviewHeader } from "../components/WebviewHeader";
import { Switch } from "../components/ui/switch";
import { Button } from "../components/ui/button";

// Acquire VS Code API exactly once per document
function getVSCodeAPI() {
    const w = window as any;
    if (w.__vscodeApi) return w.__vscodeApi as any;
    const api = (window as any).acquireVsCodeApi();
    w.__vscodeApi = api;
    return api;
}

interface ProjectLanguage {
    tag: string;
    refName: string;
    projectStatus: string;
}

function CopilotSettingsApp() {
    const vscode = getVSCodeAPI();
    const [useOnlyValidatedExamples, setUseOnlyValidatedExamples] = useState(false);
    const [allowHtmlPredictions, setAllowHtmlPredictions] = useState(false);
    const [systemMessage, setSystemMessage] = useState("");
    const [sourceLanguage, setSourceLanguage] = useState<ProjectLanguage | null>(null);
    const [targetLanguage, setTargetLanguage] = useState<ProjectLanguage | null>(null);

    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const message = event.data;
            if (message.command === "init") {
                setUseOnlyValidatedExamples(Boolean(message.data?.useOnlyValidatedExamples));
                setAllowHtmlPredictions(Boolean(message.data?.allowHtmlPredictions));
                setSystemMessage(message.data?.systemMessage || "");
                setSourceLanguage(message.data?.sourceLanguage || null);
                setTargetLanguage(message.data?.targetLanguage || null);
            } else if (message.command === "updateInput") {
                setSystemMessage(message.text || "");
            }
        };
        window.addEventListener("message", handler);
        vscode.postMessage({ command: "webviewReady" });
        return () => window.removeEventListener("message", handler);
    }, [vscode]);

    const saveAll = () => {
        vscode.postMessage({
            command: "saveSettings",
            useOnlyValidatedExamples,
            allowHtmlPredictions,
            text: systemMessage,
        });
    };

    return (
        <div style={{ padding: 12 }}>
            <WebviewHeader title="Copilot Settings" />
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="font-medium">Use Only Validated Examples</div>
                        <div className="text-sm opacity-70">
                            Use only validated translation pairs in few-shot examples.
                        </div>
                    </div>
                    <Switch
                        checked={useOnlyValidatedExamples}
                        onCheckedChange={setUseOnlyValidatedExamples}
                    />
                </div>
                <div className="flex items-center justify-between">
                    <div>
                        <div className="font-medium">Allow HTML in AI Predictions</div>
                        <div className="text-sm opacity-70">
                            Let AI output HTML (bold, italics, spans, etc.).
                        </div>
                    </div>
                    <Switch
                        checked={allowHtmlPredictions}
                        onCheckedChange={setAllowHtmlPredictions}
                    />
                </div>
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <div className="font-medium">System Message</div>
                        {systemMessage && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => vscode.postMessage({ command: "generate" })}
                            >
                                ✨ Regenerate
                            </Button>
                        )}
                    </div>
                    {systemMessage ? (
                        <textarea
                            value={systemMessage}
                            onChange={(e) => setSystemMessage(e.target.value)}
                            className="w-full border rounded p-2"
                            rows={12}
                        />
                    ) : (
                        <div className="text-center py-8">
                            <Button
                                onClick={() => vscode.postMessage({ command: "generate" })}
                                className="mb-4"
                                disabled={!sourceLanguage?.refName || !targetLanguage?.refName}
                            >
                                ✨ Generate AI Instructions
                            </Button>
                            <div className="text-sm opacity-70">
                                {sourceLanguage?.refName && targetLanguage?.refName
                                    ? `Generate personalized AI instructions for translating from ${sourceLanguage.refName} to ${targetLanguage.refName}`
                                    : "Please set source and target languages first to generate personalized instructions"}
                            </div>
                        </div>
                    )}
                </div>
                <div className="flex justify-end gap-2">
                    <Button
                        variant="secondary"
                        onClick={() => vscode.postMessage({ command: "cancel" })}
                    >
                        Cancel
                    </Button>
                    <Button onClick={saveAll}>Save All Settings</Button>
                </div>
            </div>
        </div>
    );
}

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(<CopilotSettingsApp />);
