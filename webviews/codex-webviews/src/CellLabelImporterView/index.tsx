import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./CellLabelImporterView.css"; // Assuming we'll create this for styles

// Declare vscode globally
declare const vscode: {
    postMessage: (message: any) => void;
    getState: () => any;
    setState: (state: any) => void;
};

const container = document.getElementById("root");
if (container) {
    const root = createRoot(container);
    root.render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    );
} else {
    console.error("Failed to find the root element");
}
