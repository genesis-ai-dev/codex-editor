import { useState, useCallback } from "react";

interface ScribexState {
    sequenceIds: string[];
    sectionable: boolean;
    blockable: boolean;
    editable: boolean;
    preview: boolean;
    verbose: boolean;
    graftSequenceId: string | null;
}

interface ScribexActions {
    setSectionable: (sectionable: boolean) => void;
    setBlockable: (blockable: boolean) => void;
    setEditable: (editable: boolean) => void;
    setPreview: (preview: boolean) => void;
    setToggles: (toggles: Partial<ScribexState>) => void;
    setSequenceIds: (sequenceIds: string[]) => void;
    addSequenceId: (sequenceId: string) => void;
    setGraftSequenceId: (graftSequenceId: string) => void;
}

export default function useScribexReducer() {
    const initialState: ScribexState = {
        sequenceIds: [],
        sectionable: false,
        blockable: true,
        editable: false,
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

    const setSequenceIds = useCallback((sequenceIds: string[]) => {
        setState((prev) => ({ ...prev, sequenceIds }));
    }, []);

    const setGraftSequenceId = useCallback((graftSequenceId: string) => {
        setState((prev) => ({ ...prev, graftSequenceId }));
    }, []);

    const addSequenceId = useCallback(
        (sequenceId: string) => {
            setSequenceIds([...state.sequenceIds, sequenceId]);
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

    return { state, actions };
}
