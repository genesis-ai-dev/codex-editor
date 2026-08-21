import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAudioEditHistory } from "../audio-editor/useAudioEditHistory";

describe("useAudioEditHistory", () => {
    it("undoes and redoes committed edits", () => {
        const { result } = renderHook(() => useAudioEditHistory({ clips: 1 }));

        act(() => result.current.commit({ clips: 2 }));
        expect(result.current.value.clips).toBe(2);
        expect(result.current.canUndo).toBe(true);

        act(() => result.current.undo());
        expect(result.current.value.clips).toBe(1);
        expect(result.current.canRedo).toBe(true);

        act(() => result.current.redo());
        expect(result.current.value.clips).toBe(2);
    });

    it("replaces initialization data without adding an undo entry", () => {
        const { result } = renderHook(() => useAudioEditHistory({ duration: 0 }));
        act(() => result.current.replace({ duration: 10 }));
        expect(result.current.value.duration).toBe(10);
        expect(result.current.canUndo).toBe(false);
    });

    it("clears history when reset", () => {
        const { result } = renderHook(() => useAudioEditHistory(1));
        act(() => result.current.commit(2));
        act(() => result.current.reset(5));
        expect(result.current.value).toBe(5);
        expect(result.current.canUndo).toBe(false);
        expect(result.current.canRedo).toBe(false);
    });
});
