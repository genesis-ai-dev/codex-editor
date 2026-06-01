import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { SystemMessageStep } from "../components/SystemMessageStep";

function getVSCodeAPI() {
    const w = window as any;
    if (w.__vscodeApi) return w.__vscodeApi as any;
    const api = (window as any).acquireVsCodeApi();
    w.__vscodeApi = api;
    return api;
}

interface ProjectLanguage {
    tag?: string;
    refName?: string;
    projectStatus?: string;
}

interface InitData {
    systemMessage: string;
    sourceLanguage?: ProjectLanguage | null;
    targetLanguage?: ProjectLanguage | null;
    reason: "sourceLanguageChanged" | "targetLanguageChanged" | "both";
}

const SystemMessageReviewApp: React.FC = () => {
    const vscode = getVSCodeAPI();
    const [initData, setInitData] = useState<InitData | null>(null);

    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const message = event.data;
            if (message.command === "init") {
                setInitData(message.data as InitData);
            }
        };
        window.addEventListener("message", handler);
        vscode.postMessage({ command: "webviewReady" });
        return () => window.removeEventListener("message", handler);
    }, [vscode]);

    const handleContinue = () => {
        // The backend closes the panel once the save succeeds, so this is a no-op.
    };

    const handleDismiss = () => {
        vscode.postMessage({ command: "systemMessage.dismiss" });
    };

    if (!initData) {
        return (
            <div
                style={{
                    display: "flex",
                    width: "100%",
                    height: "100vh",
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: 0.7,
                    fontSize: "14px",
                }}
            >
                Loading...
            </div>
        );
    }

    const sourceName = initData.sourceLanguage?.refName ?? "your source language";
    const targetName = initData.targetLanguage?.refName ?? "your target language";

    let bannerText: string;
    if (initData.reason === "sourceLanguageChanged") {
        bannerText = `You changed your project's source language to ${sourceName}. Please review your AI translation instructions so they match the new ${sourceName} → ${targetName} direction.`;
    } else if (initData.reason === "targetLanguageChanged") {
        bannerText = `You changed your project's target language to ${targetName}. Please review your AI translation instructions so they match the new ${sourceName} → ${targetName} direction.`;
    } else {
        bannerText = `You changed your project's languages. Please review your AI translation instructions so they match the new ${sourceName} → ${targetName} direction.`;
    }

    const banner = (
        <div
            style={{
                padding: "12px 14px",
                backgroundColor: "var(--vscode-inputValidation-warningBackground)",
                border: "1px solid var(--vscode-inputValidation-warningBorder)",
                borderRadius: "4px",
                display: "flex",
                alignItems: "flex-start",
                gap: "10px",
                fontSize: "13px",
                lineHeight: 1.45,
            }}
        >
            <i
                className="codicon codicon-warning"
                style={{ fontSize: "18px", marginTop: "1px", flexShrink: 0 }}
            ></i>
            <span>{bannerText}</span>
        </div>
    );

    return (
        <div
            style={{
                display: "flex",
                width: "100%",
                minHeight: "100vh",
                alignItems: "flex-start",
                justifyContent: "center",
                padding: "24px 12px",
            }}
        >
            <SystemMessageStep
                vscode={vscode}
                initialMessage={initData.systemMessage}
                onContinue={handleContinue}
                headerBanner={banner}
                dismissLabel="I don't need to change this"
                onDismiss={handleDismiss}
                saveLabel="Save Translation Instructions"
            />
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(<SystemMessageReviewApp />);
