import { useState, useCallback } from "react";

export default function useScribexReducer({ ...props }) {
    const initialState = {
        // title: "STEP Editor",
        sequenceIds: [],
        sectionable: false,
        blockable: true,
        editable: false,
        preview: false,
        verbose: false,
        graftSequenceId: null,
        ...props,
    };

    const [state, setState] = useState(initialState);

    const setSectionable = useCallback((sectionable) => {
        setState((prev) => ({ ...prev, sectionable }));
    }, []);

    const setBlockable = useCallback((blockable) => {
        setState((prev) => ({ ...prev, blockable }));
    }, []);

    const setEditable = useCallback((editable) => {
        setState((prev) => ({ ...prev, editable }));
    }, []);

    const setPreview = useCallback((preview) => {
        setState((prev) => ({ ...prev, preview }));
    }, []);

    const setToggles = useCallback((toggles) => {
        setState((prev) => ({ ...prev, ...toggles }));
    }, []);

    const setSequenceIds = useCallback((sequenceIds) => {
        setState((prev) => ({ ...prev, sequenceIds }));
    }, []);

    const setGraftSequenceId = useCallback((graftSequenceId) => {
        setState((prev) => ({ ...prev, graftSequenceId }));
    }, []);

    const addSequenceId = useCallback(
        (_sequenceId) => {
            setSequenceIds([...state.sequenceIds, _sequenceId]);
        },
        [state.sequenceIds, setSequenceIds]
    );

    const actions = {
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
