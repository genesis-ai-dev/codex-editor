import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./CodexCellEditor";
import "./App.css";
import UnsavedChangesContext from "./contextProviders/UnsavedChangesContext";
import SourceCellContext from "./contextProviders/SourceCellContext";

const Index: React.FC = () => {
    const [unsavedChanges, setUnsavedChanges] = useState<boolean>(false);
    const [showFlashingBorder, setShowFlashingBorder] = useState<boolean>(false);
    const [sourceCellMap, setSourceCellMap] = useState<{
        [k: string]: { content: string; versions: string[] };
    }>({});

    const toggleFlashingBorder = () => {
        console.log("toggleFlashingBorder");
        setShowFlashingBorder((prevState) => !prevState);
    };

    useEffect(() => {
        if (showFlashingBorder) {
            setTimeout(() => {
                setShowFlashingBorder(false);
            }, 2000);
        }
    }, [showFlashingBorder]);

    return (
        <SourceCellContext.Provider value={{ sourceCellMap, setSourceCellMap }}>
            <UnsavedChangesContext.Provider
                value={{
                    unsavedChanges,
                    setUnsavedChanges,
                    showFlashingBorder,
                    toggleFlashingBorder,
                }}
            >
                <React.StrictMode>
                    <App />
                </React.StrictMode>
            </UnsavedChangesContext.Provider>
        </SourceCellContext.Provider>
    );
};

ReactDOM.createRoot(document.getElementById("root")!).render(<Index />);
