import "../shared/posthog";
import React from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "../shared/ErrorBoundary";
import { SplashScreen } from "./SplashScreen";
import "../tailwind.css";
import "./SplashScreen.css";

document.addEventListener("DOMContentLoaded", () => {
    const rootElement = document.getElementById("root");

    if (!rootElement) {
        console.error("Root element not found");
        return;
    }

    const root = createRoot(rootElement);
    root.render(
        <ErrorBoundary>
            <SplashScreen />
        </ErrorBoundary>
    );
});

export default SplashScreen;
