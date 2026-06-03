import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QuillCellContent } from "../../../../../types";
import { CodexCellTypes } from "../../../../../types/enums";
import CellContentDisplay from "../CellContentDisplay";

// Regression test for the #691 follow-up: the merge confirmation is now an in-editor modal
// (rendered inside the source editor) instead of a native VS Code popup in the screen corner.
// Clicking the merge button must open the modal and NOT post `confirmCellMerge` until the user
// confirms in the modal.

const mockVscode = {
    postMessage: vi.fn(),
    getState: vi.fn(),
    setState: vi.fn(),
};

Object.defineProperty(window, "vscodeApi", {
    value: mockVscode,
    writable: true,
});

global.acquireVsCodeApi = vi.fn().mockReturnValue(mockVscode);

vi.mock("@sharedUtils", () => ({
    shouldDisableValidation: vi.fn().mockReturnValue(false),
}));

vi.mock("../contextProviders/UnsavedChangesContext", () => ({
    default: React.createContext({
        setUnsavedChanges: vi.fn(),
        showFlashingBorder: false,
        unsavedChanges: false,
        toggleFlashingBorder: vi.fn(),
    }),
}));

vi.mock("../contextProviders/TooltipContext", () => ({
    useTooltip: () => ({
        showTooltip: vi.fn(),
        hideTooltip: vi.fn(),
    }),
}));

vi.mock("../hooks/useCentralizedMessageDispatcher", () => ({
    useMessageHandler: vi.fn(() => {}),
}));

vi.mock("../lib/audioController", () => ({
    globalAudioController: {
        playExclusive: vi.fn().mockResolvedValue(undefined),
        addListener: vi.fn(),
        removeListener: vi.fn(),
    },
}));

vi.mock("../lib/audioCache", () => ({
    getCachedAudioDataUrl: vi.fn().mockReturnValue(null),
    setCachedAudioDataUrl: vi.fn(),
}));

vi.mock("../ValidationButton", () => ({
    default: () => <div className="validation-button-container" data-testid="validation-button" />,
}));

vi.mock("../AudioValidationButton", () => ({
    default: () => (
        <div className="audio-validation-button-container" data-testid="audio-validation-button" />
    ),
}));

vi.mock("../CommentsBadge", () => ({
    default: () => <div data-testid="comments-badge" />,
}));

vi.mock("react-markdown", () => ({
    default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const createMockCell = (cellId: string, content: string): QuillCellContent => ({
    cellMarkers: [cellId],
    cellContent: content,
    cellType: CodexCellTypes.TEXT,
    editHistory: [
        {
            editMap: ["value"],
            value: content,
            author: "test-user",
            validatedBy: [],
            timestamp: Date.now(),
            type: "user-edit" as any,
        },
    ],
    cellLabel: cellId,
    timestamps: { startTime: 0, endTime: 5 },
});

const renderSecondCell = () => {
    const firstCell = createMockCell("cell-1", "<p>First</p>");
    const secondCell = createMockCell("cell-2", "<p>Second</p>");
    const props = {
        cell: secondCell,
        vscode: mockVscode as any,
        textDirection: "ltr" as const,
        isSourceText: true,
        hasDuplicateId: false,
        highlightedCellId: null,
        scrollSyncEnabled: true,
        lineNumber: "2",
        label: "Test Label",
        lineNumbersEnabled: true,
        isInTranslationProcess: false,
        translationState: null as any,
        allTranslationsComplete: false,
        handleCellClick: vi.fn(),
        audioAttachments: { "cell-2": "available" as const },
        currentUsername: "test-user",
        requiredValidations: 1,
        requiredAudioValidations: 1,
        isCorrectionEditorMode: true,
        translationUnits: [firstCell, secondCell],
    };
    return render(<CellContentDisplay {...props} />);
};

const clickMergeButton = (container: HTMLElement) => {
    const mergeButton = container.querySelector(".codicon-merge")?.closest("button");
    expect(mergeButton).toBeTruthy();
    fireEvent.click(mergeButton!);
};

const confirmCellMergeCalls = () =>
    mockVscode.postMessage.mock.calls.filter(([msg]) => msg?.command === "confirmCellMerge");

describe("CellContentDisplay - merge confirmation modal (#691 follow-up)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Element.prototype.scrollIntoView = vi.fn();
    });

    it("opens the in-editor modal on merge click and does not post confirmCellMerge yet", () => {
        const { container } = renderSecondCell();
        clickMergeButton(container);

        // Modal is shown...
        expect(screen.getByText("Merge with previous cell")).toBeTruthy();
        // ...but nothing is committed until the user confirms.
        expect(confirmCellMergeCalls()).toHaveLength(0);
    });

    it("posts confirmCellMerge (without a message field) when the merge is confirmed", () => {
        const { container } = renderSecondCell();
        clickMergeButton(container);
        fireEvent.click(screen.getByRole("button", { name: "Merge" }));

        const calls = confirmCellMergeCalls();
        expect(calls).toHaveLength(1);
        const msg = calls[0][0];
        expect(msg.content.currentCellId).toBe("cell-2");
        expect(msg.content.previousCellId).toBe("cell-1");
        expect(msg.content).not.toHaveProperty("message");
    });

    it("does not post confirmCellMerge when the modal is cancelled", () => {
        const { container } = renderSecondCell();
        clickMergeButton(container);
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

        expect(confirmCellMergeCalls()).toHaveLength(0);
        expect(screen.queryByText("Merge with previous cell")).toBeNull();
    });
});
