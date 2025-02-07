import { Buffer } from "buffer";
import process from "process";

window.global = window;
window.process = process;
window.Buffer = Buffer;

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./SourceUploader";
import "./App.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
