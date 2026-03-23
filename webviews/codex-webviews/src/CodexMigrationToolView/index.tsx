import "../shared/posthog";
import React from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "../shared/ErrorBoundary";
import App from "./App";
import "../tailwind.css";

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
    console.error("Failed to find root element for migration tool.");
}
