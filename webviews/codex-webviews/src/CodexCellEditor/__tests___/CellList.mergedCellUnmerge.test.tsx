import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { QuillCellContent } from "../../../../../types";
import { CodexCellTypes } from "../../../../../types/enums";
import CellList from "../CellList";

// Regression test for issue #691: "merged content no longer shows the option to unmerge".
//
// In source + correction-editor mode the provider intentionally keeps merged cells in the
// translation units so they render greyed-out with an "unmerge" (Cancel merge) button.
// A filter in CellList used to strip merged cells in exactly that mode, which removed the
// only place the unmerge button could appear. This test locks in that merged cells survive
// to render and expose the unmerge control.

// Mock the VSCode API
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

const createCell = (
    uuid: string,
    content: string,
    overrides: Partial<QuillCellContent> = {}
): QuillCellContent => ({
    cellMarkers: [uuid],
    cellContent: content,
    cellType: CodexCellTypes.TEXT,
    data: {},
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
    cellLabel: uuid,
    timestamps: { startTime: 0, endTime: 5 },
    ...overrides,
});

const baseProps = (translationUnits: QuillCellContent[], isCorrectionEditorMode: boolean) => ({
    translationUnits,
    fullDocumentTranslationUnits: translationUnits,
    contentBeingUpdated: {
        cellMarkers: [],
        cellContent: "",
        cellChanged: false,
    },
    setContentBeingUpdated: vi.fn(),
    handleCloseEditor: vi.fn(),
    handleSaveHtml: vi.fn(),
    vscode: mockVscode,
    textDirection: "ltr" as const,
    isSourceText: true,
    isCorrectionEditorMode,
    windowHeight: 800,
    headerHeight: 100,
    highlightedCellId: null,
    scrollSyncEnabled: true,
    currentUsername: "test-user",
    requiredValidations: 1,
    milestoneIndex: null,
    currentMilestoneIndex: 0,
    currentSubsectionIndex: 0,
    cellsPerPage: 50,
});

describe("CellList - merged cell unmerge button (issue #691)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Element.prototype.scrollIntoView = vi.fn();
    });

    it("renders a merged cell with the unmerge button in source + correction editor mode", () => {
        const translationUnits: QuillCellContent[] = [
            createCell("uuid-1", "<p>First cell</p>"),
            createCell("uuid-2", "<p>Merged cell</p>", {
                merged: true,
                data: { merged: true },
            }),
        ];

        const { container } = render(
            <CellList {...baseProps(translationUnits, /* isCorrectionEditorMode */ true)} />
        );

        // The merged cell content must still render (not filtered out)...
        expect(container.textContent).toContain("Merged cell");
        // ...and it must expose the unmerge ("Cancel merge") control.
        expect(container.querySelector('[title="Cancel merge"]')).not.toBeNull();
    });

    it("does not show the unmerge button when not in correction editor mode", () => {
        // Outside correction mode the provider never sends merged cells, but even if one slipped
        // through, the unmerge button should only appear in correction mode.
        const translationUnits: QuillCellContent[] = [
            createCell("uuid-1", "<p>First cell</p>"),
            createCell("uuid-2", "<p>Merged cell</p>", {
                merged: true,
                data: { merged: true },
            }),
        ];

        const { container } = render(
            <CellList {...baseProps(translationUnits, /* isCorrectionEditorMode */ false)} />
        );

        expect(container.querySelector('[title="Cancel merge"]')).toBeNull();
    });
});
