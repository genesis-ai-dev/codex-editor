import "../shared/posthog";
import React from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "../shared/ErrorBoundary";
import App from "./App.tsx";
import "./CellLabelImporterView.css";

declare const vscode: {
    postMessage: (message: any) => void;
    getState: () => any;
    setState: (state: any) => void;
};

const container = document.getElementById("root");
if (container) {
    const root = createRoot(container);
    root.render(
        <ErrorBoundary>
            <React.StrictMode>
                <App />
            </React.StrictMode>
        </ErrorBoundary>
    );
} else {
    console.error("Failed to find the root element");
}
