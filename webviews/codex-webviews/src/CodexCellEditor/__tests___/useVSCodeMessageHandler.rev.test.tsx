import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { QuillCellContent, SpellCheckResponse, MilestoneIndex } from "../../../../../types";
import { useVSCodeMessageHandler } from "../hooks/useVSCodeMessageHandler";

type HandlerArgs = Parameters<typeof useVSCodeMessageHandler>[0];

const minimalMilestoneIndex: MilestoneIndex = {
    milestones: [],
    cellsPerPage: 50,
    milestoneProgress: {},
};

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
    }) as unknown as QuillCellContent;

function Harness(props: {
    onSetContentPaginated: HandlerArgs["setContentPaginated"];
    onHandleCellPage: HandlerArgs["handleCellPage"];
}) {
    const [spell, setSpell] = useState<SpellCheckResponse | null>(null);
    void spell;

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
        setContentPaginated: props.onSetContentPaginated,
        handleCellPage: props.onHandleCellPage,
    });

    return null;
}

describe("useVSCodeMessageHandler revision ordering", () => {
    beforeEach(() => {
        cleanup();
    });

    it("ignores stale providerSendsCellPage payloads (rev decreases)", async () => {
        const handleCellPage = vi.fn();
        const setContentPaginated = vi.fn();

        render(<Harness onHandleCellPage={handleCellPage} onSetContentPaginated={setContentPaginated} />);

        window.dispatchEvent(
            new MessageEvent("message", {
                data: {
                    type: "providerSendsCellPage",
                    rev: 2,
                    milestoneIndex: 0,
                    subsectionIndex: 0,
                    cells: [mkCell("GEN 1:1", "<span>new</span>")],
                    sourceCellMap: {},
                },
            })
        );

        expect(handleCellPage).toHaveBeenCalledTimes(1);

        // Out-of-order older payload should be ignored
        window.dispatchEvent(
            new MessageEvent("message", {
                data: {
                    type: "providerSendsCellPage",
                    rev: 1,
                    milestoneIndex: 0,
                    subsectionIndex: 0,
                    cells: [mkCell("GEN 1:1", "<span>old</span>")],
                    sourceCellMap: {},
                },
            })
        );

        expect(handleCellPage).toHaveBeenCalledTimes(1);
    });

    it("ignores stale providerSendsInitialContentPaginated payloads (rev decreases)", async () => {
        const handleCellPage = vi.fn();
        const setContentPaginated = vi.fn();

        render(<Harness onHandleCellPage={handleCellPage} onSetContentPaginated={setContentPaginated} />);

        window.dispatchEvent(
            new MessageEvent("message", {
                data: {
                    type: "providerSendsInitialContentPaginated",
                    rev: 5,
                    milestoneIndex: minimalMilestoneIndex,
                    cells: [mkCell("GEN 1:1", "<span>new</span>")],
                    currentMilestoneIndex: 0,
                    currentSubsectionIndex: 0,
                    isSourceText: true,
                    sourceCellMap: {},
                },
            })
        );

        expect(setContentPaginated).toHaveBeenCalledTimes(1);

        window.dispatchEvent(
            new MessageEvent("message", {
                data: {
                    type: "providerSendsInitialContentPaginated",
                    rev: 4,
                    milestoneIndex: minimalMilestoneIndex,
                    cells: [mkCell("GEN 1:1", "<span>old</span>")],
                    currentMilestoneIndex: 0,
                    currentSubsectionIndex: 0,
                    isSourceText: true,
                    sourceCellMap: {},
                },
            })
        );

        expect(setContentPaginated).toHaveBeenCalledTimes(1);
    });

    it("still processes payloads without rev (backward compatibility)", async () => {
        const handleCellPage = vi.fn();
        const setContentPaginated = vi.fn();

        render(<Harness onHandleCellPage={handleCellPage} onSetContentPaginated={setContentPaginated} />);

        window.dispatchEvent(
            new MessageEvent("message", {
                data: {
                    type: "providerSendsCellPage",
                    milestoneIndex: 0,
                    subsectionIndex: 0,
                    cells: [mkCell("GEN 1:1", "<span>a</span>")],
                    sourceCellMap: {},
                },
            })
        );

        expect(handleCellPage).toHaveBeenCalledTimes(1);
    });
});

