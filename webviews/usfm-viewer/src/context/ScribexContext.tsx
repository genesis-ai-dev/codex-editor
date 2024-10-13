import React, { useState, useCallback, createContext } from "react";

export interface ScribexState {
    sequenceIds: string[];
    sectionable: boolean;
    blockable: boolean;
    editable: boolean;
    preview: boolean;
    verbose: boolean;
    graftSequenceId: string | null;
}

export interface ScribexActions {
    setSectionable: (sectionable: boolean) => void;
    setBlockable: (blockable: boolean) => void;
    setEditable: (editable: boolean) => void;
    setPreview: (preview: boolean) => void;
    setToggles: (toggles: Partial<ScribexState>) => void;
    setSequenceIds: (sequenceIds: string[]) => void;
    addSequenceId: (sequenceId: string) => void;
    setGraftSequenceId: (graftSequenceId: string) => void;
}

export interface ScribexContextType {
    state: ScribexState;
    actions: ScribexActions;
}

export const ScribexContext = createContext<{
    state: ScribexState;
    actions: ScribexActions;
}>({
    state: {} as ScribexState,
    actions: {} as ScribexActions,
});

export const ScribexContextProvider: React.FC<{
    children?: React.ReactNode;
    editable?: boolean;
    reference?: boolean;
    font?: string;
}> = ({ children, editable = true }) => {
    const initialState: ScribexState = {
        sequenceIds: [],
        sectionable: false,
        blockable: true,
        editable,
        preview: false,
        verbose: false,
        graftSequenceId: null,
    };

    const [state, setState] = useState<ScribexState>(initialState);

    const setSectionable = useCallback((sectionable: boolean) => {
        setState((prev) => ({ ...prev, sectionable }));
    }, []);

    const setBlockable = useCallback((blockable: boolean) => {
        setState((prev) => ({ ...prev, blockable }));
    }, []);

    const setEditable = useCallback((editable: boolean) => {
        setState((prev) => ({ ...prev, editable }));
    }, []);

    const setPreview = useCallback((preview: boolean) => {
        setState((prev) => ({ ...prev, preview }));
    }, []);

    const setToggles = useCallback((toggles: Partial<ScribexState>) => {
        setState((prev) => ({ ...prev, ...toggles }));
    }, []);

    const setSequenceIds = useCallback((sequenceIds: Array<string>) => {
        setState((prev) => ({ ...prev, sequenceIds }));
    }, []);

    const setGraftSequenceId = useCallback((graftSequenceId: string) => {
        setState((prev) => ({ ...prev, graftSequenceId }));
    }, []);

    const addSequenceId = useCallback(
        (_sequenceId: string) => {
            setSequenceIds([...state.sequenceIds, _sequenceId]);
        },
        [state.sequenceIds, setSequenceIds]
    );

    const actions: ScribexActions = {
        setSectionable,
        setBlockable,
        setEditable,
        setPreview,
        setToggles,
        setSequenceIds,
        addSequenceId,
        setGraftSequenceId,
    };

    const context = {
        state,
        actions,
    };
    return <ScribexContext.Provider value={context}>{children}</ScribexContext.Provider>;
};
