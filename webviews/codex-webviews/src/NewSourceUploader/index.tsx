import "../shared/posthog";
import { Buffer } from "buffer";
import process from "process";

import React from "react";
import ReactDOM from "react-dom/client";
import { ErrorBoundary } from "../shared/ErrorBoundary";
import App from "./NewSourceUploader";
import "../tailwind.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <ErrorBoundary>
        <React.StrictMode>
            <App />
        </React.StrictMode>
    </ErrorBoundary>
);
