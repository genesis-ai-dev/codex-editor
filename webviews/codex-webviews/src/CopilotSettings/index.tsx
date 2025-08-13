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

function CopilotSettingsApp() {
    const vscode = getVSCodeAPI();
    const [useOnlyValidatedExamples, setUseOnlyValidatedExamples] = useState(false);
    const [allowHtmlPredictions, setAllowHtmlPredictions] = useState(false);
    const [systemMessage, setSystemMessage] = useState("");

    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const message = event.data;
            if (message.command === "init") {
                setUseOnlyValidatedExamples(Boolean(message.data?.useOnlyValidatedExamples));
                setAllowHtmlPredictions(Boolean(message.data?.allowHtmlPredictions));
                setSystemMessage(message.data?.systemMessage || "");
            }
        };
        window.addEventListener("message", handler);
        vscode.postMessage({ command: "webviewReady" });
        return () => window.removeEventListener("message", handler);
    }, []);

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
                    <div className="font-medium mb-2">System Message</div>
                    <textarea
                        value={systemMessage}
                        onChange={(e) => setSystemMessage(e.target.value)}
                        className="w-full border rounded p-2"
                        rows={12}
                    />
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
