import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "../tailwind.css";
import "./CodexMigrationToolView.css";

const container = document.getElementById("root");
if (container) {
    const root = createRoot(container);
    root.render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    );
} else {
    console.error("Failed to find root element for migration tool.");
}
