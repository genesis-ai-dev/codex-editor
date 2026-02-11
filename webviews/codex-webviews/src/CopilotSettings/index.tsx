import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { WebviewHeader } from "../components/WebviewHeader";
import { Switch } from "../components/ui/switch";
import { Button } from "../components/ui/button";
import "../tailwind.css";

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

    // ASR (Speech to Text) settings
    const [asrSettings, setAsrSettings] = useState<{
        endpoint: string;
    }>({ endpoint: "" });

    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const message = event.data;
            if (message.command === "init") {
                setUseOnlyValidatedExamples(Boolean(message.data?.useOnlyValidatedExamples));
                setAllowHtmlPredictions(Boolean(message.data?.allowHtmlPredictions));
                setSystemMessage(message.data?.systemMessage || "");
                setSourceLanguage(message.data?.sourceLanguage || null);
                setTargetLanguage(message.data?.targetLanguage || null);
            } else if (message.command === "asrSettings") {
                setAsrSettings((prev) => ({ ...prev, ...message.data }));
            } else if (message.command === "asrSettingsSaved") {
                // Optional toast could be shown
            } else if (message.command === "updateInput") {
                setSystemMessage(message.text || "");
            }
        };
        window.addEventListener("message", handler);
        vscode.postMessage({ command: "webviewReady" });
        // Request ASR settings on load
        vscode.postMessage({ command: "getAsrSettings" });
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

    const handleSaveAsr = () => {
        vscode.postMessage({ command: "saveAsrSettings", data: asrSettings });
    };

    return (
        <div style={{ padding: 12 }}>
            <WebviewHeader title="Copilot Settings" />
            <div className="space-y-6">
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

                {/* Speech to Text Settings */}
                <div className="border rounded p-3">
                    <div className="font-medium mb-2 flex items-center gap-2">
                        <i className="codicon codicon-mic" /> Speech to Text
                    </div>
                    <div className="grid grid-cols-1 gap-3">
                        <div>
                            <label className="text-xs opacity-70">Endpoint</label>
                            <input
                                className="w-full rounded border px-2 py-1 text-sm"
                                value={asrSettings.endpoint}
                                onChange={(e) => setAsrSettings((s) => ({ ...s, endpoint: e.target.value }))}
                                placeholder="http://localhost:8000/api/v1/asr/transcribe"
                            />
                        </div>
                    </div>
                    <div className="flex justify-end mt-3">
                        <Button onClick={handleSaveAsr} className="h-8 px-3 text-sm">Save</Button>
                    </div>
                </div>
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <div className="font-medium">System Message</div>
                        {systemMessage && (
                            <Button
                                onClick={() => vscode.postMessage({ command: "generate" })}
                                className="min-w-[180px] h-8 relative flex items-center justify-center"
                            >
                                <i 
                                    className="codicon codicon-sparkle absolute left-2 top-1/2 -translate-y-1/2"
                                    style={{
                                        width: "16px",
                                        height: "16px",
                                    }}
                                />
                                <span className="pl-6">Regenerate</span>
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
