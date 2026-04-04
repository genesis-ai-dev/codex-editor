import "../shared/posthog";
import React from "react";
import ReactDOM from "react-dom/client";
import { ErrorBoundary } from "../shared/ErrorBoundary";
import ParallelView from "./ParallelView";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <ErrorBoundary>
        <React.StrictMode>
            <ParallelView />
        </React.StrictMode>
    </ErrorBoundary>
);
