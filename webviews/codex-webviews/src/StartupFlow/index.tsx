import "../shared/posthog";
import React from "react";
import ReactDOM from "react-dom/client";
import { ErrorBoundary } from "../shared/ErrorBoundary";
import "../tailwind.css";
import {StartupFlowView} from "./StartupFlowView";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <ErrorBoundary>
        <React.StrictMode>
            <StartupFlowView />
        </React.StrictMode>
    </ErrorBoundary>
);
