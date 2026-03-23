import "../shared/posthog";
import React from "react";
import ReactDOM from "react-dom/client";
import { ErrorBoundary } from "../shared/ErrorBoundary";
import PublishProject from "./PublishProject";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <ErrorBoundary>
        <React.StrictMode>
            <PublishProject />
        </React.StrictMode>
    </ErrorBoundary>
);
