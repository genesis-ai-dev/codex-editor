import "../shared/posthog";
import React from "react";
import ReactDOM from "react-dom/client";
import { ErrorBoundary } from "../shared/ErrorBoundary";
import App from "./CommentsView";
import "../tailwind.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <ErrorBoundary>
        <React.StrictMode>
            <App />
        </React.StrictMode>
    </ErrorBoundary>
);
