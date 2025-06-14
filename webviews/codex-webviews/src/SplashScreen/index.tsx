import React from "react";
import { createRoot } from "react-dom/client";
import { SplashScreen } from "./SplashScreen";
import "../tailwind.css";
import "./SplashScreen.css";

// Initialize the app when the DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
    const rootElement = document.getElementById("root");

    if (!rootElement) {
        console.error("Root element not found");
        return;
    }

    const root = createRoot(rootElement);
    root.render(React.createElement(SplashScreen));
});

// Default export for Vite
export default SplashScreen;
