import React, { useEffect, useState, useMemo } from "react";
import ReactDOM from "react-dom/client";
import App from "./CodexCellEditor";
import "./App.css";
import UnsavedChangesContext from "./contextProviders/UnsavedChangesContext";
import SourceCellContext from "./contextProviders/SourceCellContext";
import ScrollToContentContext from "./contextProviders/ScrollToContentContext";

const Index: React.FC = () => {
    const [unsavedChanges, setUnsavedChanges] = useState<boolean>(false);
    const [showFlashingBorder, setShowFlashingBorder] = useState<boolean>(false);
    const [contentToScrollTo, setContentToScrollTo] = useState<string | null>(null);

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

    // Memoize the context value
    const scrollContextValue = useMemo(
        () => ({
            contentToScrollTo,
            setContentToScrollTo,
        }),
        [contentToScrollTo]
    );

    const sourceContextValue = useMemo(
        () => ({
            sourceCellMap,
            setSourceCellMap,
        }),
        [sourceCellMap]
    );

    const unsavedChangesContextValue = useMemo(
        () => ({
            unsavedChanges,
            setUnsavedChanges,
            showFlashingBorder,
            toggleFlashingBorder,
        }),
        [unsavedChanges, showFlashingBorder]
    );

    return (
        <SourceCellContext.Provider value={sourceContextValue}>
            <UnsavedChangesContext.Provider value={unsavedChangesContextValue}>
                <ScrollToContentContext.Provider value={scrollContextValue}>
                    <React.StrictMode>
                        <App />
                    </React.StrictMode>
                </ScrollToContentContext.Provider>
            </UnsavedChangesContext.Provider>
        </SourceCellContext.Provider>
    );
};

ReactDOM.createRoot(document.getElementById("root")!).render(<Index />);
