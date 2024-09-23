import React from "react";
import ReactDOM from "react-dom/client";
import "../App.css";
import Providers from "../components/Providers";

export const renderToPage = (element: JSX.Element) => {
    ReactDOM.createRoot(document.getElementById("root")!).render(
        <React.StrictMode>
            <Providers>{element}</Providers>
        </React.StrictMode>
    );
};
