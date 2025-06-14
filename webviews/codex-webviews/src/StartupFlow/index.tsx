import React from "react";
import ReactDOM from "react-dom/client";
import "../tailwind.css";
import {StartupFlowView} from "./StartupFlowView";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <StartupFlowView />
    </React.StrictMode>
);
