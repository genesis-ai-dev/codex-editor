import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
        // Mock navigator.onLine to be true for all tests
        Object.defineProperty(navigator, "onLine", {
            writable: true,
            configurable: true,
            value: true,
        });
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
                userAccessLevel={40}
            />
        );

        // Verify lock icon is visible
        const lockIcon = container.querySelector(".codicon-lock");
        expect(lockIcon).toBeTruthy();

        // Verify unlock icon is not present
        const unlockIcon = container.querySelector(".codicon-unlock");
        expect(unlockIcon).toBeNull();
    });

    it("should not render lock icon when cell is editable (lock button hidden)", () => {
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
                userAccessLevel={40}
            />
        );

        // TEMPORARILY DISABLED: Lock/unlock button is hidden from all users
        // Verify lock/unlock icons are not present when cell is unlocked
        const unlockIcon = container.querySelector(".codicon-unlock");
        expect(unlockIcon).toBeNull();

        // Verify lock icon is not present
        const lockIcon = container.querySelector(".codicon-lock");
        expect(lockIcon).toBeNull();
    });

    // TEMPORARILY DISABLED: Lock/unlock button functionality is hidden from all users
    it.skip("should send updateCellIsLocked message when lock button is clicked on editable cell", () => {
        // Test skipped - lock button is hidden from all users
    });

    // TEMPORARILY DISABLED: Lock/unlock button functionality is hidden from all users
    it.skip("should send updateCellIsLocked message when unlock button is clicked on locked cell", () => {
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
                userAccessLevel={40}
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
                userAccessLevel={40}
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
                userAccessLevel={40}
            />
        );

        const lockedContentDiv = lockedContainer.querySelector('div[title="Cell is locked"]');
        expect(lockedContentDiv).toBeTruthy();
    });

    it("should show lock button visibility correctly", () => {
        // TEMPORARILY DISABLED: Lock/unlock button is hidden from all users
        // Test editable cell - no lock/unlock icons should be shown
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
                userAccessLevel={40}
            />
        );

        const unlockIcon = editableContainer.querySelector(".codicon-unlock");
        expect(unlockIcon).toBeNull();

        // Test locked cell - lock icon should be visible (non-interactive)
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
                userAccessLevel={40}
            />
        );

        const lockIcon = lockedContainer.querySelector(".codicon-lock");
        expect(lockIcon).toBeTruthy();
        // Lock icon should be in a div, not a button
        const lockIconParent = lockIcon?.parentElement;
        expect(lockIconParent?.tagName.toLowerCase()).toBe("div");
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
                userAccessLevel={40}
            />
        );

        // TEMPORARILY DISABLED: Lock/unlock button is hidden from all users
        // Verify no lock/unlock icons are shown when cell is unlocked
        const unlockIcon = container.querySelector(".codicon-unlock");
        expect(unlockIcon).toBeNull();
        const lockIcon = container.querySelector(".codicon-lock");
        expect(lockIcon).toBeNull();

        // // Verify cell click works (defaults to editable)
        // const cellContentWrapper = Array.from(container.querySelectorAll("div")).find(
        //     (el) => el.className.includes("flex-wrap") && el.className.includes("items-baseline")
        // );
        // expect(cellContentWrapper).toBeTruthy();

        // fireEvent.click(cellContentWrapper!);
        // expect(handleCellClick).toHaveBeenCalledWith("cell-1");
    });

    describe("userAccessLevel restrictions", () => {
        it("should not render lock button when userAccessLevel is undefined", () => {
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
                    userAccessLevel={undefined}
                />
            );

            // Verify lock button is not present
            const lockButton = container.querySelector('button[title="Toggle cell lock"]');
            expect(lockButton).toBeNull();

            // Verify lock/unlock icons are not present
            const lockIcon = container.querySelector(".codicon-lock");
            const unlockIcon = container.querySelector(".codicon-unlock");
            expect(lockIcon).toBeNull();
            expect(unlockIcon).toBeNull();
        });

        it("should not render lock button when userAccessLevel is less than 40", () => {
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
                    userAccessLevel={39}
                />
            );

            // Verify lock button is not present
            const lockButton = container.querySelector('button[title="Toggle cell lock"]');
            expect(lockButton).toBeNull();

            // Verify lock/unlock icons are not present
            const lockIcon = container.querySelector(".codicon-lock");
            const unlockIcon = container.querySelector(".codicon-unlock");
            expect(lockIcon).toBeNull();
            expect(unlockIcon).toBeNull();
        });

        // TEMPORARILY DISABLED: Lock/unlock button is hidden from all users regardless of access level
        it("should not render lock button when userAccessLevel is exactly 40 (button hidden)", () => {
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
                    userAccessLevel={40}
                />
            );

            // Verify lock button is not present (hidden from all users)
            const lockButton = container.querySelector('button[title="Toggle cell lock"]');
            expect(lockButton).toBeNull();

            // Verify unlock icon is not present (cell is not locked)
            const unlockIcon = container.querySelector(".codicon-unlock");
            expect(unlockIcon).toBeNull();
        });

        // TEMPORARILY DISABLED: Lock/unlock button is hidden from all users regardless of access level
        it("should show lock icon (non-interactive) when cell is locked, even with high access level", () => {
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
                    userAccessLevel={50}
                />
            );

            // Verify lock button is not present (hidden from all users)
            const lockButton = container.querySelector('button[title="Toggle cell lock"]');
            expect(lockButton).toBeNull();

            // Verify lock icon is present in a div (non-interactive display)
            const lockIcon = container.querySelector(".codicon-lock");
            expect(lockIcon).toBeTruthy();
            const lockIconParent = lockIcon?.parentElement;
            expect(lockIconParent?.tagName.toLowerCase()).toBe("div");
            expect(lockIconParent?.getAttribute("title")).toBe("Cell is locked");
        });
    });

    describe("Sparkle button disabled state", () => {
        it("should disable sparkle button when cell is locked", async () => {
            const mockCell = createMockCell("cell-1", "<p>Test content</p>", true);
            const handleCellClick = vi.fn();
            const handleCellTranslation = vi.fn();

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
                    handleCellTranslation={handleCellTranslation}
                    cellDisplayMode={CELL_DISPLAY_MODES.ONE_LINE_PER_CELL}
                    audioAttachments={{}}
                    currentUsername="test-user"
                    requiredValidations={1}
                    requiredAudioValidations={1}
                    isAuthenticated={true}
                />
            );

            // Hover over the cell actions area to show the sparkle button
            const cellActions = container.querySelector(".cell-actions");
            expect(cellActions).toBeTruthy();
            fireEvent.mouseOver(cellActions!);

            // Find the sparkle button
            const sparkleButton = Array.from(container.querySelectorAll("button")).find((btn) =>
                btn.querySelector(".codicon-sparkle")
            );
            expect(sparkleButton).toBeTruthy();

            // Verify the button has reduced opacity (0.5) via inline style (visual disabled state)
            const buttonStyle = sparkleButton!.getAttribute("style");
            expect(buttonStyle).toMatch(/opacity:\s*0\.5/);

            // Verify cursor is not-allowed via inline style
            expect(buttonStyle).toMatch(/cursor:\s*not-allowed/);

            // Find the lock icon div to verify it flashes
            const lockIcon = container.querySelector(".codicon-lock");
            expect(lockIcon).toBeTruthy();
            const lockIconParent = lockIcon?.parentElement;
            expect(lockIconParent).toBeTruthy();

            // Initially, lock icon parent should not have flashing class
            expect(lockIconParent?.className).not.toContain("lock-button-flashing");

            // Try clicking the button - it should flash the lock icon and not trigger the handler
            fireEvent.click(sparkleButton!);
            expect(handleCellTranslation).not.toHaveBeenCalled();

            // Verify lock icon parent now has flashing class
            await waitFor(() => {
                expect(lockIconParent?.className).toContain("lock-button-flashing");
            });
        });

        it("should enable sparkle button when cell is unlocked", () => {
            const mockCell = createMockCell("cell-1", "<p>Test content</p>", false);
            const handleCellClick = vi.fn();
            const handleCellTranslation = vi.fn();

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
                    handleCellTranslation={handleCellTranslation}
                    cellDisplayMode={CELL_DISPLAY_MODES.ONE_LINE_PER_CELL}
                    audioAttachments={{}}
                    currentUsername="test-user"
                    requiredValidations={1}
                    requiredAudioValidations={1}
                    isAuthenticated={true}
                />
            );

            // Hover over the cell actions area to show the sparkle button
            const cellActions = container.querySelector(".cell-actions");
            expect(cellActions).toBeTruthy();
            fireEvent.mouseOver(cellActions!);

            // Find the sparkle button
            const sparkleButton = Array.from(container.querySelectorAll("button")).find((btn) =>
                btn.querySelector(".codicon-sparkle")
            );
            expect(sparkleButton).toBeTruthy();

            // Verify the button is NOT disabled
            expect(sparkleButton!.hasAttribute("disabled")).toBe(false);

            // Verify the button has full opacity (1) via inline style
            const buttonStyle = sparkleButton!.getAttribute("style");
            expect(buttonStyle).toMatch(/opacity:\s*1/);

            // Verify cursor is pointer via inline style
            expect(buttonStyle).toMatch(/cursor:\s*pointer/);
        });

        it("should prevent sparkle button click handler when cell is locked", () => {
            const mockCell = createMockCell("cell-1", "<p>Test content</p>", true);
            const handleCellClick = vi.fn();
            const handleCellTranslation = vi.fn();

            // Mock window.handleSparkleButtonClick as a fallback
            (window as any).handleSparkleButtonClick = vi.fn();

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
                    handleCellTranslation={handleCellTranslation}
                    cellDisplayMode={CELL_DISPLAY_MODES.ONE_LINE_PER_CELL}
                    audioAttachments={{}}
                    currentUsername="test-user"
                    requiredValidations={1}
                    requiredAudioValidations={1}
                    isAuthenticated={true}
                />
            );

            // Hover over the cell actions area to show the sparkle button
            const cellActions = container.querySelector(".cell-actions");
            fireEvent.mouseOver(cellActions!);

            // Find and click the sparkle button
            const sparkleButton = Array.from(container.querySelectorAll("button")).find((btn) =>
                btn.querySelector(".codicon-sparkle")
            );
            expect(sparkleButton).toBeTruthy();

            fireEvent.click(sparkleButton!);

            // Verify handlers were not called
            expect(handleCellTranslation).not.toHaveBeenCalled();
            expect((window as any).handleSparkleButtonClick).not.toHaveBeenCalled();
        });

        it("should call LLM suggestion when clicking sparkle button on unlocked cell", () => {
            const mockCell = createMockCell("cell-1", "<p>Test content</p>", false);
            const handleCellClick = vi.fn();
            const handleCellTranslation = vi.fn();

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
                    handleCellTranslation={handleCellTranslation}
                    cellDisplayMode={CELL_DISPLAY_MODES.ONE_LINE_PER_CELL}
                    audioAttachments={{}}
                    currentUsername="test-user"
                    requiredValidations={1}
                    requiredAudioValidations={1}
                    isAuthenticated={true}
                />
            );

            // Hover over the cell actions area to show the sparkle button
            const cellActions = container.querySelector(".cell-actions");
            fireEvent.mouseOver(cellActions!);

            // Find and click the sparkle button
            const sparkleButton = Array.from(container.querySelectorAll("button")).find((btn) =>
                btn.querySelector(".codicon-sparkle")
            );
            expect(sparkleButton).toBeTruthy();

            fireEvent.click(sparkleButton!);

            // Verify handleCellTranslation was called
            expect(handleCellTranslation).toHaveBeenCalledWith("cell-1");
        });

        it("should flash lock icon when clicking sparkle button on locked cell", async () => {
            const mockCell = createMockCell("cell-1", "<p>Test content</p>", true);
            const handleCellClick = vi.fn();
            const handleCellTranslation = vi.fn();

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
                    handleCellTranslation={handleCellTranslation}
                    cellDisplayMode={CELL_DISPLAY_MODES.ONE_LINE_PER_CELL}
                    audioAttachments={{}}
                    currentUsername="test-user"
                    requiredValidations={1}
                    requiredAudioValidations={1}
                    isAuthenticated={true}
                />
            );

            // Hover over the cell actions area to show the sparkle button
            const cellActions = container.querySelector(".cell-actions");
            fireEvent.mouseOver(cellActions!);

            // Find the sparkle button
            const sparkleButton = Array.from(container.querySelectorAll("button")).find((btn) =>
                btn.querySelector(".codicon-sparkle")
            );
            expect(sparkleButton).toBeTruthy();

            // Find the lock icon div
            const lockIcon = container.querySelector(".codicon-lock");
            expect(lockIcon).toBeTruthy();
            const lockIconParent = lockIcon?.parentElement;
            expect(lockIconParent).toBeTruthy();

            // Initially, lock icon parent should not have flashing class
            expect(lockIconParent?.className).not.toContain("lock-button-flashing");

            // Click the sparkle button
            fireEvent.click(sparkleButton!);

            // Verify handleCellTranslation was NOT called
            expect(handleCellTranslation).not.toHaveBeenCalled();

            // Verify lock icon parent now has flashing class (wait for state update)
            await waitFor(() => {
                expect(lockIconParent?.className).toContain("lock-button-flashing");
            });
        });

        it("should call vscode.postMessage with llmCompletion when handleCellTranslation is not provided and cell is unlocked", () => {
            const mockCell = createMockCell("cell-1", "<p>Test content</p>", false);

            // Ensure window.handleSparkleButtonClick is not set (so it falls through to vscode.postMessage)
            (window as any).handleSparkleButtonClick = undefined;

            // Clear any previous calls
            vi.clearAllMocks();

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
                    handleCellClick={vi.fn()}
                    cellDisplayMode={CELL_DISPLAY_MODES.ONE_LINE_PER_CELL}
                    audioAttachments={{}}
                    currentUsername="test-user"
                    requiredValidations={1}
                    requiredAudioValidations={1}
                    isAuthenticated={true}
                />
            );

            // Hover over the cell actions area to show the sparkle button
            const cellActions = container.querySelector(".cell-actions");
            fireEvent.mouseOver(cellActions!);

            // Find and click the sparkle button
            const sparkleButton = Array.from(container.querySelectorAll("button")).find((btn) =>
                btn.querySelector(".codicon-sparkle")
            );
            expect(sparkleButton).toBeTruthy();

            fireEvent.click(sparkleButton!);

            // Verify vscode.postMessage was called with llmCompletion command
            expect(mockVscode.postMessage).toHaveBeenCalledWith({
                command: "llmCompletion",
                content: {
                    currentLineId: "cell-1",
                    addContentToValue: true,
                },
            });
        });

        it("should call LLM suggestion when unlocked and flash lock icon when locked", async () => {
            const handleCellTranslation = vi.fn();

            // Test unlocked cell - should call LLM suggestion
            const unlockedCell = createMockCell("cell-unlocked", "<p>Test content</p>", false);
            const { container: unlockedContainer, unmount: unmountUnlocked } = render(
                <CellContentDisplay
                    cell={unlockedCell}
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
                    handleCellTranslation={handleCellTranslation}
                    cellDisplayMode={CELL_DISPLAY_MODES.ONE_LINE_PER_CELL}
                    audioAttachments={{}}
                    currentUsername="test-user"
                    requiredValidations={1}
                    requiredAudioValidations={1}
                    isAuthenticated={true}
                />
            );

            // Hover to show sparkle button
            const unlockedCellActions = unlockedContainer.querySelector(".cell-actions");
            fireEvent.mouseOver(unlockedCellActions!);

            // Find and click sparkle button on unlocked cell
            const unlockedSparkleButton = Array.from(
                unlockedContainer.querySelectorAll("button")
            ).find((btn) => btn.querySelector(".codicon-sparkle"));
            expect(unlockedSparkleButton).toBeTruthy();

            vi.clearAllMocks();
            fireEvent.click(unlockedSparkleButton!);

            // Verify LLM suggestion was called
            expect(handleCellTranslation).toHaveBeenCalledWith("cell-unlocked");

            unmountUnlocked();

            // Test locked cell - should flash lock icon
            const lockedCell = createMockCell("cell-locked", "<p>Test content</p>", true);
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
                    handleCellTranslation={handleCellTranslation}
                    cellDisplayMode={CELL_DISPLAY_MODES.ONE_LINE_PER_CELL}
                    audioAttachments={{}}
                    currentUsername="test-user"
                    requiredValidations={1}
                    requiredAudioValidations={1}
                    isAuthenticated={true}
                />
            );

            // Hover to show sparkle button
            const lockedCellActions = lockedContainer.querySelector(".cell-actions");
            fireEvent.mouseOver(lockedCellActions!);

            // Find sparkle button and lock button
            const lockedSparkleButton = Array.from(lockedContainer.querySelectorAll("button")).find(
                (btn) => btn.querySelector(".codicon-sparkle")
            );
            expect(lockedSparkleButton).toBeTruthy();

            const lockIcon = lockedContainer.querySelector(".codicon-lock");
            expect(lockIcon).toBeTruthy();
            const lockIconParent = lockIcon?.parentElement;
            expect(lockIconParent).toBeTruthy();

            // Initially, lock icon parent should not have flashing class
            expect(lockIconParent?.className).not.toContain("lock-button-flashing");

            // Clear previous calls
            vi.clearAllMocks();

            // Click sparkle button on locked cell
            fireEvent.click(lockedSparkleButton!);

            // Verify LLM suggestion was NOT called
            expect(handleCellTranslation).not.toHaveBeenCalled();

            // Verify lock icon parent now has flashing class
            await waitFor(() => {
                expect(lockIconParent?.className).toContain("lock-button-flashing");
            });
        });
    });

    it("should not auto-start recording from audio button when locked via legacy metadata.data.isLocked", () => {
        const mockCell: QuillCellContent = {
            ...createMockCell("cell-1", "<p>Test content</p>", false),
            // Simulate older/legacy documents where lock state is nested
            metadata: { data: { isLocked: true } } as any,
        };

        // Ensure clean slate
        sessionStorage.removeItem("start-audio-recording-cell-1");
        (window as any).openCellByIdForce = vi.fn();
        (window as any).openCellById = vi.fn();

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
                handleCellClick={vi.fn()}
                cellDisplayMode={CELL_DISPLAY_MODES.ONE_LINE_PER_CELL}
                audioAttachments={{ "cell-1": "none" as const }}
                currentUsername="test-user"
                requiredValidations={1}
                requiredAudioValidations={1}
                userAccessLevel={50}
            />
        );

        // "none" state renders mic icon; when locked, title is "Cell is locked"
        const audioButton = container.querySelector(
            'button.audio-play-button[title="Cell is locked"]'
        );
        expect(audioButton).toBeTruthy();

        fireEvent.click(audioButton!);

        // Locked cells should not set the auto-record flag
        expect(sessionStorage.getItem("start-audio-recording-cell-1")).toBeNull();
        // Locked cells should not open the editor for recording
        expect((window as any).openCellByIdForce).not.toHaveBeenCalled();
        expect((window as any).openCellById).not.toHaveBeenCalled();
    });
});
