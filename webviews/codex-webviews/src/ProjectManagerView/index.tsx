import React from "react";
import ReactDOM from "react-dom/client";
import App from "./ProjectManagerView";
import "../index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);

// Register service worker after the document is fully loaded
window.addEventListener("load", () => {
    if ("serviceWorker" in navigator) {
        navigator.serviceWorker
            .register("/service-worker.js")
            .then((registration) => {
                console.log(
                    "ServiceWorker registration successful with scope: ",
                    registration.scope
                );
            })
            .catch((error) => {
                console.error("ServiceWorker registration failed: ", error);
            });
    }
});
