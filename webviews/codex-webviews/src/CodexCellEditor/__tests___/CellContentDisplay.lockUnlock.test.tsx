import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QuillCellContent } from "../../../../../types";
import { CodexCellTypes } from "../../../../../types/enums";
import CellContentDisplay from "../CellContentDisplay";
import { CELL_DISPLAY_MODES } from "../CodexCellEditor";

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

// Mock the acquireVsCodeApi function
global.acquireVsCodeApi = vi.fn().mockReturnValue(mockVscode);

// Mock @sharedUtils
vi.mock("@sharedUtils", () => ({
    shouldDisableValidation: vi.fn().mockReturnValue(false),
}));

// Mock context providers
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

// Mock useMessageHandler
vi.mock("../hooks/useCentralizedMessageDispatcher", () => ({
    useMessageHandler: vi.fn(() => {}),
}));

// Mock audio controller
vi.mock("../lib/audioController", () => ({
    globalAudioController: {
        playExclusive: vi.fn().mockResolvedValue(undefined),
        addListener: vi.fn(),
        removeListener: vi.fn(),
    },
}));

// Mock audio cache
vi.mock("../lib/audioCache", () => ({
    getCachedAudioDataUrl: vi.fn().mockReturnValue(null),
    setCachedAudioDataUrl: vi.fn(),
}));

// Mock ValidationButton and AudioValidationButton
vi.mock("../ValidationButton", () => ({
    default: () => <div className="validation-button-container" data-testid="validation-button" />,
}));

vi.mock("../AudioValidationButton", () => ({
    default: () => (
        <div className="audio-validation-button-container" data-testid="audio-validation-button" />
    ),
}));

// Mock CommentsBadge
vi.mock("../CommentsBadge", () => ({
    default: () => <div data-testid="comments-badge" />,
}));

// Mock ReactMarkdown
vi.mock("react-markdown", () => ({
    default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Helper function to create a mock cell
const createMockCell = (
    cellId: string,
    content: string = "<p>Test content</p>",
    isLocked?: boolean
): QuillCellContent => ({
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
    cellLabel: "Test Label",
    timestamps: {
        startTime: 0,
        endTime: 5,
    },
    metadata: isLocked !== undefined ? { isLocked } : {},
});

describe("CellContentDisplay - Lock/Unlock UI Behavior", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should render lock icon when cell is locked", () => {
        const mockCell = createMockCell("cell-1", "<p>Test content</p>", true);
        const handleCellClick = vi.fn();

        const { container } = render(
            <CellContentDisplay
                cell={mockCell}
                vscode={mockVscode as any}
                textDirection="ltr"
                isSourceText={false}
                hasDuplicateId={false}
                alertColorCode={undefined}
                highlightedCellId={null}
                scrollSyncEnabled={true}
                lineNumber="1"
                label="Test Label"
                lineNumbersEnabled={true}
                isInTranslationProcess={false}
                translationState={null as any}
                allTranslationsComplete={false}
                handleCellClick={handleCellClick}
                cellDisplayMode={CELL_DISPLAY_MODES.ONE_LINE_PER_CELL}
                audioAttachments={{}}
                currentUsername="test-user"
                requiredValidations={1}
                requiredAudioValidations={1}
            />
        );

        // Verify lock icon is visible
        const lockIcon = container.querySelector(".codicon-lock");
        expect(lockIcon).toBeTruthy();

        // Verify unlock icon is not present
        const unlockIcon = container.querySelector(".codicon-unlock");
        expect(unlockIcon).toBeNull();
    });

    it("should render unlock icon when cell is editable", () => {
        const mockCell = createMockCell("cell-1", "<p>Test content</p>", false);
        const handleCellClick = vi.fn();

        const { container } = render(
            <CellContentDisplay
                cell={mockCell}
                vscode={mockVscode as any}
                textDirection="ltr"
                isSourceText={false}
                hasDuplicateId={false}
                alertColorCode={undefined}
                highlightedCellId={null}
                scrollSyncEnabled={true}
                lineNumber="1"
                label="Test Label"
                lineNumbersEnabled={true}
                isInTranslationProcess={false}
                translationState={null as any}
                allTranslationsComplete={false}
                handleCellClick={handleCellClick}
                cellDisplayMode={CELL_DISPLAY_MODES.ONE_LINE_PER_CELL}
                audioAttachments={{}}
                currentUsername="test-user"
                requiredValidations={1}
                requiredAudioValidations={1}
            />
        );

        // Verify unlock icon exists with invisible class
        const unlockIcon = container.querySelector(".codicon-unlock");
        expect(unlockIcon).toBeTruthy();
        expect(unlockIcon?.classList.contains("invisible")).toBe(true);
        expect(unlockIcon?.classList.contains("group-hover:visible")).toBe(true);

        // Verify lock icon is not present
        const lockIcon = container.querySelector(".codicon-lock");
        expect(lockIcon).toBeNull();
    });

    it("should send updateCellIsLocked message when lock button is clicked on editable cell", () => {
        const mockCell = createMockCell("cell-1", "<p>Test content</p>", false);
        const handleCellClick = vi.fn();

        const { container } = render(
            <CellContentDisplay
                cell={mockCell}
                vscode={mockVscode as any}
                textDirection="ltr"
                isSourceText={false}
                hasDuplicateId={false}
                alertColorCode={undefined}
                highlightedCellId={null}
                scrollSyncEnabled={true}
                lineNumber="1"
                label="Test Label"
                lineNumbersEnabled={true}
                isInTranslationProcess={false}
                translationState={null as any}
                allTranslationsComplete={false}
                handleCellClick={handleCellClick}
                cellDisplayMode={CELL_DISPLAY_MODES.ONE_LINE_PER_CELL}
                audioAttachments={{}}
                currentUsername="test-user"
                requiredValidations={1}
                requiredAudioValidations={1}
            />
        );

        // Find and click the lock button
        const lockButton = container.querySelector('button[title="Toggle cell lock"]');
        expect(lockButton).toBeTruthy();

        fireEvent.click(lockButton!);

        // Verify postMessage was called with correct parameters
        expect(mockVscode.postMessage).toHaveBeenCalledWith({
            command: "updateCellIsLocked",
            content: {
                cellId: "cell-1",
                isLocked: true,
            },
        });
    });

    it("should send updateCellIsLocked message when unlock button is clicked on locked cell", () => {
        const mockCell = createMockCell("cell-1", "<p>Test content</p>", true);
        const handleCellClick = vi.fn();

        const { container } = render(
            <CellContentDisplay
                cell={mockCell}
                vscode={mockVscode as any}
                textDirection="ltr"
                isSourceText={false}
                hasDuplicateId={false}
                alertColorCode={undefined}
                highlightedCellId={null}
                scrollSyncEnabled={true}
                lineNumber="1"
                label="Test Label"
                lineNumbersEnabled={true}
                isInTranslationProcess={false}
                translationState={null as any}
                allTranslationsComplete={false}
                handleCellClick={handleCellClick}
                cellDisplayMode={CELL_DISPLAY_MODES.ONE_LINE_PER_CELL}
                audioAttachments={{}}
                currentUsername="test-user"
                requiredValidations={1}
                requiredAudioValidations={1}
            />
        );

        // Find and click the lock button
        const lockButton = container.querySelector('button[title="Toggle cell lock"]');
        expect(lockButton).toBeTruthy();

        fireEvent.click(lockButton!);

        // Verify postMessage was called with correct parameters
        expect(mockVscode.postMessage).toHaveBeenCalledWith({
            command: "updateCellIsLocked",
            content: {
                cellId: "cell-1",
                isLocked: false,
            },
        });
    });

    it("should prevent cell content click when cell is locked", () => {
        const mockCell = createMockCell("cell-1", "<p>Test content</p>", true);
        const handleCellClick = vi.fn();

        const { container } = render(
            <CellContentDisplay
                cell={mockCell}
                vscode={mockVscode as any}
                textDirection="ltr"
                isSourceText={false}
                hasDuplicateId={false}
                alertColorCode={undefined}
                highlightedCellId={null}
                scrollSyncEnabled={true}
                lineNumber="1"
                label="Test Label"
                lineNumbersEnabled={true}
                isInTranslationProcess={false}
                translationState={null as any}
                allTranslationsComplete={false}
                handleCellClick={handleCellClick}
                cellDisplayMode={CELL_DISPLAY_MODES.ONE_LINE_PER_CELL}
                audioAttachments={{}}
                currentUsername="test-user"
                requiredValidations={1}
                requiredAudioValidations={1}
            />
        );

        // Find the cell content wrapper (the div with onClick handler)
        // The onClick is on the parent div that wraps label and content
        const cellContentWrapper = Array.from(container.querySelectorAll("div")).find(
            (el) => el.className.includes("flex-wrap") && el.className.includes("items-baseline")
        );
        expect(cellContentWrapper).toBeTruthy();

        // Click the cell content area
        fireEvent.click(cellContentWrapper!);

        // Verify handleCellClick was NOT called
        expect(handleCellClick).not.toHaveBeenCalled();
    });

    it("should allow cell content click when cell is editable", () => {
        const mockCell = createMockCell("cell-1", "<p>Test content</p>", false);
        const handleCellClick = vi.fn();

        const { container } = render(
            <CellContentDisplay
                cell={mockCell}
                vscode={mockVscode as any}
                textDirection="ltr"
                isSourceText={false}
                hasDuplicateId={false}
                alertColorCode={undefined}
                highlightedCellId={null}
                scrollSyncEnabled={true}
                lineNumber="1"
                label="Test Label"
                lineNumbersEnabled={true}
                isInTranslationProcess={false}
                translationState={null as any}
                allTranslationsComplete={false}
                handleCellClick={handleCellClick}
                cellDisplayMode={CELL_DISPLAY_MODES.ONE_LINE_PER_CELL}
                audioAttachments={{}}
                currentUsername="test-user"
                requiredValidations={1}
                requiredAudioValidations={1}
            />
        );

        // Find the cell content wrapper (the div with onClick handler)
        // The onClick is on the parent div that wraps label and content
        // Look for div with flex-wrap and items-baseline classes
        const cellContentWrapper = Array.from(container.querySelectorAll("div")).find(
            (el) => el.className.includes("flex-wrap") && el.className.includes("items-baseline")
        );
        expect(cellContentWrapper).toBeTruthy();

        // Click the cell content area
        fireEvent.click(cellContentWrapper!);

        // Verify handleCellClick WAS called with correct cellId
        expect(handleCellClick).toHaveBeenCalledWith("cell-1");
    });

    it("should show correct tooltip message based on lock state", () => {
        // Test editable cell
        const editableCell = createMockCell("cell-1", "<p>Test content</p>", false);
        const { container: editableContainer } = render(
            <CellContentDisplay
                cell={editableCell}
                vscode={mockVscode as any}
                textDirection="ltr"
                isSourceText={false}
                hasDuplicateId={false}
                alertColorCode={undefined}
                highlightedCellId={null}
                scrollSyncEnabled={true}
                lineNumber="1"
                label="Test Label"
                lineNumbersEnabled={true}
                isInTranslationProcess={false}
                translationState={null as any}
                allTranslationsComplete={false}
                handleCellClick={vi.fn()}
                cellDisplayMode={CELL_DISPLAY_MODES.ONE_LINE_PER_CELL}
                audioAttachments={{}}
                currentUsername="test-user"
                requiredValidations={1}
                requiredAudioValidations={1}
            />
        );

        // Find the content div with title attribute
        const editableContentDiv = editableContainer.querySelector('div[title="Click to edit"]');
        expect(editableContentDiv).toBeTruthy();

        // Test locked cell
        const lockedCell = createMockCell("cell-2", "<p>Test content</p>", true);
        const { container: lockedContainer } = render(
            <CellContentDisplay
                cell={lockedCell}
                vscode={mockVscode as any}
                textDirection="ltr"
                isSourceText={false}
                hasDuplicateId={false}
                alertColorCode={undefined}
                highlightedCellId={null}
                scrollSyncEnabled={true}
                lineNumber="2"
                label="Test Label"
                lineNumbersEnabled={true}
                isInTranslationProcess={false}
                translationState={null as any}
                allTranslationsComplete={false}
                handleCellClick={vi.fn()}
                cellDisplayMode={CELL_DISPLAY_MODES.ONE_LINE_PER_CELL}
                audioAttachments={{}}
                currentUsername="test-user"
                requiredValidations={1}
                requiredAudioValidations={1}
            />
        );

        const lockedContentDiv = lockedContainer.querySelector('div[title="Cell is locked"]');
        expect(lockedContentDiv).toBeTruthy();
    });

    it("should show lock button visibility correctly", () => {
        // Test editable cell - unlock icon should have invisible class
        const editableCell = createMockCell("cell-1", "<p>Test content</p>", false);
        const { container: editableContainer } = render(
            <CellContentDisplay
                cell={editableCell}
                vscode={mockVscode as any}
                textDirection="ltr"
                isSourceText={false}
                hasDuplicateId={false}
                alertColorCode={undefined}
                highlightedCellId={null}
                scrollSyncEnabled={true}
                lineNumber="1"
                label="Test Label"
                lineNumbersEnabled={true}
                isInTranslationProcess={false}
                translationState={null as any}
                allTranslationsComplete={false}
                handleCellClick={vi.fn()}
                cellDisplayMode={CELL_DISPLAY_MODES.ONE_LINE_PER_CELL}
                audioAttachments={{}}
                currentUsername="test-user"
                requiredValidations={1}
                requiredAudioValidations={1}
            />
        );

        const unlockIcon = editableContainer.querySelector(".codicon-unlock");
        expect(unlockIcon).toBeTruthy();
        expect(unlockIcon?.classList.contains("invisible")).toBe(true);
        expect(unlockIcon?.classList.contains("group-hover:visible")).toBe(true);

        // Test locked cell - lock icon should always be visible
        const lockedCell = createMockCell("cell-2", "<p>Test content</p>", true);
        const { container: lockedContainer } = render(
            <CellContentDisplay
                cell={lockedCell}
                vscode={mockVscode as any}
                textDirection="ltr"
                isSourceText={false}
                hasDuplicateId={false}
                alertColorCode={undefined}
                highlightedCellId={null}
                scrollSyncEnabled={true}
                lineNumber="2"
                label="Test Label"
                lineNumbersEnabled={true}
                isInTranslationProcess={false}
                translationState={null as any}
                allTranslationsComplete={false}
                handleCellClick={vi.fn()}
                cellDisplayMode={CELL_DISPLAY_MODES.ONE_LINE_PER_CELL}
                audioAttachments={{}}
                currentUsername="test-user"
                requiredValidations={1}
                requiredAudioValidations={1}
            />
        );

        const lockIcon = lockedContainer.querySelector(".codicon-lock");
        expect(lockIcon).toBeTruthy();
        expect(lockIcon?.classList.contains("invisible")).toBe(false);
    });

    it("should default to unlocked when isLocked is undefined", () => {
        const mockCell = createMockCell("cell-1", "<p>Test content</p>", undefined);
        const handleCellClick = vi.fn();

        const { container } = render(
            <CellContentDisplay
                cell={mockCell}
                vscode={mockVscode as any}
                textDirection="ltr"
                isSourceText={false}
                hasDuplicateId={false}
                alertColorCode={undefined}
                highlightedCellId={null}
                scrollSyncEnabled={true}
                lineNumber="1"
                label="Test Label"
                lineNumbersEnabled={true}
                isInTranslationProcess={false}
                translationState={null as any}
                allTranslationsComplete={false}
                handleCellClick={handleCellClick}
                cellDisplayMode={CELL_DISPLAY_MODES.ONE_LINE_PER_CELL}
                audioAttachments={{}}
                currentUsername="test-user"
                requiredValidations={1}
                requiredAudioValidations={1}
            />
        );

        // Verify unlock icon is shown (defaults to editable)
        const unlockIcon = container.querySelector(".codicon-unlock");
        expect(unlockIcon).toBeTruthy();

        // // Verify cell click works (defaults to editable)
        // const cellContentWrapper = Array.from(container.querySelectorAll("div")).find(
        //     (el) => el.className.includes("flex-wrap") && el.className.includes("items-baseline")
        // );
        // expect(cellContentWrapper).toBeTruthy();

        // fireEvent.click(cellContentWrapper!);
        // expect(handleCellClick).toHaveBeenCalledWith("cell-1");
    });
});
