import React from "react";

interface UnsavedChangesContextProps {
    unsavedChanges: boolean;
    setUnsavedChanges: React.Dispatch<React.SetStateAction<boolean>>;
    showFlashingBorder: boolean;
    toggleFlashingBorder: () => void;
}

const UnsavedChangesContext = React.createContext<UnsavedChangesContextProps>({
    unsavedChanges: false,
    setUnsavedChanges: () => {},
    showFlashingBorder: false,
    toggleFlashingBorder: () => {},
});

export default UnsavedChangesContext;
