import React, { useRef, useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import type { QuillCellContent, SpellCheckResponse, MilestoneIndex } from "../../../../../types";
import { useVSCodeMessageHandler } from "../hooks/useVSCodeMessageHandler";

/**
 * Regression test for: initial content with a non-zero milestone index being
 * rejected by the stale-content guard.
 *
 * Root cause: The webview refs start at (0,0). When the provider sends initial
 * content with a cached chapter position (e.g. milestone index 2), the guard
 * compared refs (0,0) !== incoming (2,0) and silently discarded the first
 * message, leaving the editor stuck with no cells and "1" in the header.
 *
 * The fix adds `hasReceivedInitialContentRef` to always accept the very first
 * providerSendsInitialContentPaginated message regardless of ref values.
 */

type HandlerArgs = Parameters<typeof useVSCodeMessageHandler>[0];

const mkMilestoneIndex = (milestones: { value: string; cellIndex: number }[]): MilestoneIndex => ({
    milestones: milestones.map((m) => ({
        value: m.value,
        cellIndex: m.cellIndex,
        subsections: [{ startIndex: m.cellIndex, endIndex: m.cellIndex + 49 }],
    })),
    cellsPerPage: 50,
    milestoneProgress: {},
});

const mkCell = (id: string, html: string): QuillCellContent =>
    ({
        cellMarkers: [id],
        cellContent: html,
        cellType: "text",
        editHistory: [],
        timestamps: undefined,
        cellLabel: undefined,
        merged: false,
        data: {},
        attachments: {},
        metadata: {},
    } as unknown as QuillCellContent);

/**
 * Minimal harness that replicates the stale-content guard from CodexCellEditor.
 * It has the same ref+state structure and passes a setContentPaginated callback
 * that mirrors the real implementation's guard logic.
 */
function StaleGuardHarness(props: {
    /** Called when setContentPaginated accepts (does not reject) the message */
    onAccepted: (milestoneIdx: number, subsectionIdx: number, cells: QuillCellContent[]) => void;
    /** Called when setContentPaginated rejects a stale message */
    onRejected: (milestoneIdx: number, subsectionIdx: number) => void;
}) {
    const [spell, setSpell] = useState<SpellCheckResponse | null>(null);
    void spell;

    // Mirrors CodexCellEditor.tsx refs
    const currentMilestoneIndexRef = useRef<number>(0);
    const currentSubsectionIndexRef = useRef<number>(0);
    const hasReceivedInitialContentRef = useRef(false);

    const setContentPaginated: HandlerArgs["setContentPaginated"] = (
        milestoneIdx: MilestoneIndex,
        cells: QuillCellContent[],
        currentMilestoneIdx: number,
        currentSubsectionIdx: number,
        _isSourceTextValue: boolean,
        _sourceCellMapValue: { [k: string]: { content: string; versions: string[] } }
    ) => {
        // ---- Exact same guard logic as CodexCellEditor.tsx ----
        const isFirstContent = !hasReceivedInitialContentRef.current;

        if (
            !isFirstContent &&
            (currentMilestoneIndexRef.current !== currentMilestoneIdx ||
                currentSubsectionIndexRef.current !== currentSubsectionIdx)
        ) {
            props.onRejected(currentMilestoneIdx, currentSubsectionIdx);
            return;
        }

        hasReceivedInitialContentRef.current = true;
        // ---- End guard logic ----

        // Update refs (mirrors CodexCellEditor)
        currentMilestoneIndexRef.current = currentMilestoneIdx;
        currentSubsectionIndexRef.current = currentSubsectionIdx;

        props.onAccepted(currentMilestoneIdx, currentSubsectionIdx, cells);
    };

    useVSCodeMessageHandler({
        setContent: () => {},
        setSpellCheckResponse: setSpell,
        jumpToCell: () => {},
        updateCell: () => {},
        autocompleteChapterComplete: () => {},
        updateTextDirection: () => {},
        updateNotebookMetadata: () => {},
        updateVideoUrl: () => {},
        setAlertColorCodes: () => {},
        recheckAlertCodes: () => {},
        setAudioAttachments: () => {},
        setContentPaginated,
        handleCellPage: () => {},
    });

    return null;
}

/** Helper to dispatch providerSendsInitialContentPaginated */
const dispatchInitialContent = (
    milestoneIndex: MilestoneIndex,
    cells: QuillCellContent[],
    currentMilestoneIndex: number,
    currentSubsectionIndex: number,
    rev?: number
) => {
    window.dispatchEvent(
        new MessageEvent("message", {
            data: {
                type: "providerSendsInitialContentPaginated",
                ...(rev !== undefined ? { rev } : {}),
                milestoneIndex,
                cells,
                currentMilestoneIndex,
                currentSubsectionIndex,
                isSourceText: false,
                sourceCellMap: {},
            },
        })
    );
};

describe("setContentPaginated stale-content guard (initial load)", () => {
    beforeEach(() => {
        cleanup();
    });

    it("accepts initial content with milestone index 0 (refs match trivially)", () => {
        const onAccepted = vi.fn();
        const onRejected = vi.fn();

        render(<StaleGuardHarness onAccepted={onAccepted} onRejected={onRejected} />);

        const milestoneIdx = mkMilestoneIndex([{ value: "Mark 1", cellIndex: 0 }]);
        const cells = [mkCell("MRK 1:1", "<span>verse 1</span>")];

        act(() => {
            dispatchInitialContent(milestoneIdx, cells, 0, 0, 1);
        });

        expect(onAccepted).toHaveBeenCalledTimes(1);
        expect(onAccepted).toHaveBeenCalledWith(0, 0, cells);
        expect(onRejected).not.toHaveBeenCalled();
    });

    it("accepts initial content with a non-zero milestone index (cached chapter position)", () => {
        const onAccepted = vi.fn();
        const onRejected = vi.fn();

        render(<StaleGuardHarness onAccepted={onAccepted} onRejected={onRejected} />);

        // Provider determined cached chapter = 3, which maps to milestone index 2
        const milestoneIdx = mkMilestoneIndex([
            { value: "Mark 1", cellIndex: 0 },
            { value: "Mark 2", cellIndex: 50 },
            { value: "Mark 3", cellIndex: 100 },
        ]);
        const cells = [mkCell("MRK 3:1", "<span>chapter 3 verse 1</span>")];

        act(() => {
            dispatchInitialContent(milestoneIdx, cells, 2, 0, 1);
        });

        // CRITICAL: This must be accepted even though refs were (0,0) and incoming is (2,0)
        expect(onAccepted).toHaveBeenCalledTimes(1);
        expect(onAccepted).toHaveBeenCalledWith(2, 0, cells);
        expect(onRejected).not.toHaveBeenCalled();
    });

    it("accepts initial content with a non-zero subsection index", () => {
        const onAccepted = vi.fn();
        const onRejected = vi.fn();

        render(<StaleGuardHarness onAccepted={onAccepted} onRejected={onRejected} />);

        const milestoneIdx = mkMilestoneIndex([{ value: "Mark 1", cellIndex: 0 }]);
        const cells = [mkCell("MRK 1:51", "<span>second page</span>")];

        act(() => {
            dispatchInitialContent(milestoneIdx, cells, 0, 1, 1);
        });

        // Must be accepted even though refs were (0,0) and incoming is (0,1)
        expect(onAccepted).toHaveBeenCalledTimes(1);
        expect(onAccepted).toHaveBeenCalledWith(0, 1, cells);
        expect(onRejected).not.toHaveBeenCalled();
    });

    it("rejects stale content AFTER initial content has been received", () => {
        const onAccepted = vi.fn();
        const onRejected = vi.fn();

        render(<StaleGuardHarness onAccepted={onAccepted} onRejected={onRejected} />);

        const milestoneIdx = mkMilestoneIndex([
            { value: "Mark 1", cellIndex: 0 },
            { value: "Mark 2", cellIndex: 50 },
            { value: "Mark 3", cellIndex: 100 },
        ]);

        // First message: accepted (initial content, milestone 2)
        act(() => {
            dispatchInitialContent(milestoneIdx, [mkCell("MRK 3:1", "<span>ch3</span>")], 2, 0, 1);
        });

        expect(onAccepted).toHaveBeenCalledTimes(1);

        // Second message: stale content for milestone 0 while we're on milestone 2
        // This should be rejected by the stale guard
        act(() => {
            dispatchInitialContent(milestoneIdx, [mkCell("MRK 1:1", "<span>ch1</span>")], 0, 0, 2);
        });

        // Should still only have 1 accepted call
        expect(onAccepted).toHaveBeenCalledTimes(1);
        expect(onRejected).toHaveBeenCalledTimes(1);
        expect(onRejected).toHaveBeenCalledWith(0, 0);
    });

    it("accepts duplicate content for the same milestone after initial load", () => {
        const onAccepted = vi.fn();
        const onRejected = vi.fn();

        render(<StaleGuardHarness onAccepted={onAccepted} onRejected={onRejected} />);

        const milestoneIdx = mkMilestoneIndex([
            { value: "Mark 1", cellIndex: 0 },
            { value: "Mark 2", cellIndex: 50 },
        ]);

        // First message: accepted (initial content, milestone 1)
        act(() => {
            dispatchInitialContent(milestoneIdx, [mkCell("MRK 2:1", "<span>ch2</span>")], 1, 0, 1);
        });

        expect(onAccepted).toHaveBeenCalledTimes(1);

        // Second message: same milestone index (e.g. getContent triggers another updateWebview)
        // This should be accepted since refs match
        act(() => {
            dispatchInitialContent(
                milestoneIdx,
                [mkCell("MRK 2:1", "<span>ch2 refreshed</span>")],
                1,
                0,
                2
            );
        });

        expect(onAccepted).toHaveBeenCalledTimes(2);
        expect(onRejected).not.toHaveBeenCalled();
    });
});
