import React from "react";
import { createRoot } from "react-dom/client";
import { MissingToolsWarning } from "./MissingToolsWarning";
import "../tailwind.css";

document.addEventListener("DOMContentLoaded", () => {
    const rootElement = document.getElementById("root");

    if (!rootElement) {
        console.error("Root element not found");
        return;
    }

    const root = createRoot(rootElement);
    root.render(React.createElement(MissingToolsWarning));
});

export default MissingToolsWarning;
