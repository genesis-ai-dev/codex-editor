import { useCallback, useState } from "react";

interface HistoryState<T> {
    past: T[];
    present: T;
    future: T[];
}

const MAX_HISTORY_ENTRIES = 50;

/**
 * Small immutable history store for non-destructive audio edits. `replace`
 * updates decoded metadata without creating a user-visible undo step.
 */
export function useAudioEditHistory<T>(initialValue: T) {
    const [history, setHistory] = useState<HistoryState<T>>({
        past: [],
        present: initialValue,
        future: [],
    });

    const commit = useCallback((updater: T | ((current: T) => T)) => {
        setHistory((current) => {
            const next = typeof updater === "function"
                ? (updater as (value: T) => T)(current.present)
                : updater;
            if (Object.is(next, current.present)) return current;
            return {
                past: [...current.past, current.present].slice(-MAX_HISTORY_ENTRIES),
                present: next,
                future: [],
            };
        });
    }, []);

    const replace = useCallback((updater: T | ((current: T) => T)) => {
        setHistory((current) => ({
            ...current,
            present: typeof updater === "function"
                ? (updater as (value: T) => T)(current.present)
                : updater,
        }));
    }, []);

    const reset = useCallback((value: T) => {
        setHistory({ past: [], present: value, future: [] });
    }, []);

    const undo = useCallback(() => {
        setHistory((current) => {
            const previous = current.past[current.past.length - 1];
            if (!previous) return current;
            return {
                past: current.past.slice(0, -1),
                present: previous,
                future: [current.present, ...current.future],
            };
        });
    }, []);

    const redo = useCallback(() => {
        setHistory((current) => {
            const next = current.future[0];
            if (!next) return current;
            return {
                past: [...current.past, current.present].slice(-MAX_HISTORY_ENTRIES),
                present: next,
                future: current.future.slice(1),
            };
        });
    }, []);

    return {
        value: history.present,
        commit,
        replace,
        reset,
        undo,
        redo,
        canUndo: history.past.length > 0,
        canRedo: history.future.length > 0,
    };
}
