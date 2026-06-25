import React from "react";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { MilestoneAccordion } from "./MilestoneAccordion";
import type { MilestoneIndex } from "../../../../../types";
import type { Subsection } from "../../lib/types";

// Mock VSCode UI Toolkit components
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
    VSCodeButton: ({
        children,
        onClick,
        disabled,
        appearance,
        title,
        "aria-label": ariaLabel,
        "aria-pressed": ariaPressed,
    }: any) => (
        <button
            onClick={onClick}
            disabled={disabled}
            data-appearance={appearance}
            title={title}
            aria-label={ariaLabel}
            aria-pressed={ariaPressed}
        >
            {children}
        </button>
    ),
}));

// Mock Accordion components
vi.mock("../../components/ui/accordion", () => ({
    Accordion: ({ children, value, onValueChange, type, collapsible, className }: any) => (
        <div data-testid="accordion" data-value={value} className={className}>
            {children}
        </div>
    ),
    AccordionItem: ({ children, value, className }: any) => (
        <div data-testid={`accordion-item-${value}`} className={className}>
            {children}
        </div>
    ),
    AccordionTrigger: ({ children, className, onClick }: any) => (
        <button data-testid={`accordion-trigger`} className={className} onClick={onClick}>
            {children}
        </button>
    ),
    AccordionContent: ({ children, className }: any) => (
        <div data-testid="accordion-content" className={className}>
            {children}
        </div>
    ),
}));

// Mock ProgressDots
vi.mock("./ProgressDots", () => ({
    ProgressDots: () => <div data-testid="progress-dots">ProgressDots</div>,
}));

// Mock icons. Use importOriginal so any new icon imported by the component
// (e.g. Trash2) is automatically available in tests without having to be
// re-listed here. The previous explicit-list approach silently broke tests
// every time a new icon was introduced.
vi.mock("lucide-react", async (importOriginal) => {
    const actual = await importOriginal<typeof import("lucide-react")>();
    return { ...actual };
});

vi.mock("../../components/ui/icons/MicrophoneIcon", () => ({
    default: () => <div data-testid="microphone-icon">Microphone</div>,
}));

// Mock utility functions
vi.mock("../utils/progressUtils", () => ({
    deriveSubsectionPercentages: vi.fn((progress) => ({
        textValidatedPercent: progress.percentTextValidatedTranslations || 0,
        textCompletedPercent: progress.percentTranslationsCompleted || 0,
        audioValidatedPercent: progress.percentAudioValidatedTranslations || 0,
        audioCompletedPercent: progress.percentAudioTranslationsCompleted || 0,
    })),
    getProgressDisplay: vi.fn(() => ({
        colorClass: "text-charts-blue-dark",
        title: "Progress",
        completedValidationLevels: 0,
    })),
}));

describe("MilestoneAccordion - Milestone Editing", () => {
    let mockVscode: any;
    let mockOnClose: ReturnType<typeof vi.fn>;
    let mockGetSubsectionsForMilestone: ReturnType<typeof vi.fn>;
    let mockRequestCellsForMilestone: ReturnType<typeof vi.fn>;
    let mockCalculateSubsectionProgress: ReturnType<typeof vi.fn>;
    let mockRequestSubsectionProgress: ReturnType<typeof vi.fn>;
    let mockAnchorRef: React.RefObject<HTMLDivElement>;

    const createMockMilestoneIndex = (
        milestones: Array<{ value: string; index: number }>
    ): MilestoneIndex => ({
        milestones: milestones.map((m, idx) => ({
            index: m.index,
            cellIndex: idx * 10,
            value: m.value,
            cellCount: 5,
        })),
        totalCells: milestones.length * 5,
        cellsPerPage: 10,
    });

    const createMockSubsection = (id: string, label: string): Subsection => ({
        id,
        label,
        startIndex: 0,
        endIndex: 5,
    });

    beforeEach(() => {
        mockVscode = {
            postMessage: vi.fn(),
        };
        mockOnClose = vi.fn();
        mockGetSubsectionsForMilestone = vi.fn((milestoneIdx: number) => [
            createMockSubsection(`subsection-${milestoneIdx}-1`, `Subsection ${milestoneIdx}.1`),
            createMockSubsection(`subsection-${milestoneIdx}-2`, `Subsection ${milestoneIdx}.2`),
        ]);
        mockRequestCellsForMilestone = vi.fn();
        mockCalculateSubsectionProgress = vi.fn(() => ({
            isFullyTranslated: false,
            isFullyValidated: false,
            percentTranslationsCompleted: 50,
            percentTextValidatedTranslations: 30,
            percentAudioTranslationsCompleted: 40,
            percentAudioValidatedTranslations: 20,
        }));
        mockRequestSubsectionProgress = vi.fn();
        mockAnchorRef = React.createRef<HTMLDivElement>();
        // Create a mock anchor element
        const mockAnchor = document.createElement("div");
        mockAnchor.getBoundingClientRect = vi.fn(() => ({
            top: 100,
            left: 200,
            width: 50,
            height: 30,
            bottom: 130,
            right: 250,
            x: 200,
            y: 100,
            toJSON: vi.fn(),
        }));
        (mockAnchorRef as React.MutableRefObject<HTMLDivElement>).current = mockAnchor;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    /**
     * Scope-helpers for per-milestone queries.
     *
     * The accordion renders one row per milestone, each wrapped in
     * `data-testid="accordion-item-${idx}"` (see the AccordionItem mock above).
     * The "Rename Milestone" pencil now lives on every row, so an unscoped
     * `getByLabelText("Rename Milestone")` would match N elements and throw.
     * Tests almost always exercise the *current* milestone (idx 0 by default),
     * so we expose a small helper that scopes the lookup to that row.
     *
     * Use `getRenameMilestoneButton(idx)` for "must exist" assertions and
     * `queryRenameMilestoneButton(idx)` for "must not exist" assertions on a
     * specific row. For "no rename pencils anywhere" (e.g. settings mode off)
     * use `screen.queryAllByLabelText("Rename Milestone")`.
     */
    const getMilestoneRow = (milestoneIdx: number = 0): HTMLElement =>
        screen.getByTestId(`accordion-item-${milestoneIdx}`);
    const getRenameMilestoneButton = (milestoneIdx: number = 0): HTMLElement =>
        within(getMilestoneRow(milestoneIdx)).getByLabelText("Rename Milestone");
    const queryRenameMilestoneButton = (milestoneIdx: number = 0): HTMLElement | null =>
        within(getMilestoneRow(milestoneIdx)).queryByLabelText("Rename Milestone");

    function renderMilestoneAccordion(
        props: Partial<React.ComponentProps<typeof MilestoneAccordion>> = {}
    ) {
        const defaultProps: React.ComponentProps<typeof MilestoneAccordion> = {
            isOpen: true,
            onClose: mockOnClose,
            milestoneIndex: createMockMilestoneIndex([
                { value: "Chapter 1", index: 0 },
                { value: "Chapter 2", index: 1 },
                { value: "Chapter 3", index: 2 },
            ]),
            currentMilestoneIndex: 0,
            currentSubsectionIndex: 0,
            getSubsectionsForMilestone: mockGetSubsectionsForMilestone,
            requestCellsForMilestone: mockRequestCellsForMilestone,
            allSubsectionProgress: undefined,
            unsavedChanges: false,
            isSourceText: false,
            anchorRef: mockAnchorRef,
            calculateSubsectionProgress: mockCalculateSubsectionProgress,
            requestSubsectionProgress: mockRequestSubsectionProgress,
            vscode: mockVscode,
            // Most rename-flow tests assert directly against the milestone
            // pencil, per-milestone-subdivision pencils, and add-break
            // controls. Those affordances are now gated behind the
            // gear/settings toggle, so we open the accordion already in
            // settings mode by default and let the dedicated gear-toggle
            // tests override this with `false`.
            initialSettingsMode: true,
        };

        return render(<MilestoneAccordion {...defaultProps} {...props} />);
    }

    describe("Milestone Rename - Starting", () => {
        it("swaps the milestone row's pencil for a save/cancel cluster + inline input", async () => {
            renderMilestoneAccordion();

            const renameButton = getRenameMilestoneButton();
            expect(renameButton).toBeInTheDocument();

            await act(async () => {
                fireEvent.click(renameButton);
            });

            // The row now hosts the rename input, prefilled with the
            // milestone's current display value (no longer in the dropdown
            // header — the header keeps showing the static <h2> + gear).
            const input = screen.getByDisplayValue("Chapter 1");
            expect(input).toBeInTheDocument();
            expect(input.tagName).toBe("INPUT");

            // Save + Cancel replace the row's pencil/destructive cluster.
            expect(screen.getByLabelText("Save Milestone Rename")).toBeInTheDocument();
            expect(screen.getByLabelText("Cancel Milestone Rename")).toBeInTheDocument();
            // Gear stays in the header during rename — inline editing is
            // anchored to the row, not a header swap.
            expect(
                screen.queryByLabelText("Toggle Milestone Settings")
            ).toBeInTheDocument();
        });

        it("should initialize input with current milestone value", async () => {
            renderMilestoneAccordion();

            const renameButton = getRenameMilestoneButton();
            await act(async () => {
                fireEvent.click(renameButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            expect(input.value).toBe("Chapter 1");
        });

        it("should show input field when entering edit mode", async () => {
            renderMilestoneAccordion();

            const renameButton = getRenameMilestoneButton();
            await act(async () => {
                fireEvent.click(renameButton);
            });

            // Input should be visible and editable
            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            expect(input).toBeInTheDocument();
            expect(input.type).toBe("text");
        });
    });

    describe("Milestone Rename - Saving Changes", () => {
        it("should save milestone when save button is clicked with valid value", async () => {
            renderMilestoneAccordion();

            // Enter edit mode
            const renameButton = getRenameMilestoneButton();
            await act(async () => {
                fireEvent.click(renameButton);
            });

            // Change the value
            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "Updated Chapter 1" } });
            });

            // Click save
            const saveButton = screen.getByLabelText("Save Milestone Rename");
            await act(async () => {
                fireEvent.click(saveButton);
            });

            // Should send postMessage with updateMilestoneValue command
            expect(mockVscode.postMessage).toHaveBeenCalledWith({
                command: "updateMilestoneValue",
                content: {
                    milestoneIndex: 0,
                    newValue: "Updated Chapter 1",
                },
            });

            // Should exit edit mode
            expect(screen.queryByDisplayValue("Updated Chapter 1")).not.toBeInTheDocument();
            // Should show the updated value in the header
            const header = screen.getByRole("heading", { level: 2 });
            expect(header).toHaveTextContent("Updated Chapter 1");
        });

        it("should trim whitespace when saving", async () => {
            renderMilestoneAccordion();

            const renameButton = getRenameMilestoneButton();
            await act(async () => {
                fireEvent.click(renameButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "  Trimmed Chapter 1  " } });
            });

            const saveButton = screen.getByLabelText("Save Milestone Rename");
            await act(async () => {
                fireEvent.click(saveButton);
            });

            expect(mockVscode.postMessage).toHaveBeenCalledWith({
                command: "updateMilestoneValue",
                content: {
                    milestoneIndex: 0,
                    newValue: "Trimmed Chapter 1",
                },
            });
        });

        it("should not save if value is empty after trimming", async () => {
            renderMilestoneAccordion();

            const renameButton = getRenameMilestoneButton();
            await act(async () => {
                fireEvent.click(renameButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "   " } });
            });

            const saveButton = screen.getByLabelText("Save Milestone Rename");
            expect(saveButton).toBeDisabled();

            await act(async () => {
                fireEvent.click(saveButton);
            });

            // Should not send postMessage
            expect(mockVscode.postMessage).not.toHaveBeenCalled();
        });

        it("should not save if value hasn't changed", async () => {
            renderMilestoneAccordion();

            const renameButton = getRenameMilestoneButton();
            await act(async () => {
                fireEvent.click(renameButton);
            });

            const saveButton = screen.getByLabelText("Save Milestone Rename");
            expect(saveButton).toBeDisabled();

            await act(async () => {
                fireEvent.click(saveButton);
            });

            // Should not send postMessage
            expect(mockVscode.postMessage).not.toHaveBeenCalled();
        });

        it("should update local cache immediately after saving", async () => {
            renderMilestoneAccordion();

            const renameButton = getRenameMilestoneButton();
            await act(async () => {
                fireEvent.click(renameButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "Cached Chapter 1" } });
            });

            const saveButton = screen.getByLabelText("Save Milestone Rename");
            await act(async () => {
                fireEvent.click(saveButton);
            });

            // Should show the updated value immediately (from local cache)
            // Check that it appears in the header
            const header = screen.getByRole("heading", { level: 2 });
            expect(header).toHaveTextContent("Cached Chapter 1");
        });

        it("should handle save when milestone index is valid", async () => {
            renderMilestoneAccordion();

            const renameButton = getRenameMilestoneButton();
            await act(async () => {
                fireEvent.click(renameButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "Valid Save" } });
            });

            const saveButton = screen.getByLabelText("Save Milestone Rename");
            await act(async () => {
                fireEvent.click(saveButton);
            });

            // Should successfully save with valid index
            expect(mockVscode.postMessage).toHaveBeenCalledWith({
                command: "updateMilestoneValue",
                content: {
                    milestoneIndex: 0,
                    newValue: "Valid Save",
                },
            });
        });
    });

    describe("Milestone Rename - Reverting Changes", () => {
        it("should revert to original value when revert button is clicked", async () => {
            renderMilestoneAccordion();

            const renameButton = getRenameMilestoneButton();
            await act(async () => {
                fireEvent.click(renameButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "Changed Value" } });
            });

            const revertButton = screen.getByLabelText("Cancel Milestone Rename");
            await act(async () => {
                fireEvent.click(revertButton);
            });

            // Should exit edit mode
            expect(screen.queryByDisplayValue("Changed Value")).not.toBeInTheDocument();
            // Should show original value in the header
            const header = screen.getByRole("heading", { level: 2 });
            expect(header).toHaveTextContent("Chapter 1");
        });

        it("should not send postMessage when reverting", async () => {
            renderMilestoneAccordion();

            const renameButton = getRenameMilestoneButton();
            await act(async () => {
                fireEvent.click(renameButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "Changed Value" } });
            });

            const revertButton = screen.getByLabelText("Cancel Milestone Rename");
            await act(async () => {
                fireEvent.click(revertButton);
            });

            // Should not send any postMessage
            expect(mockVscode.postMessage).not.toHaveBeenCalled();
        });
    });

    describe("Milestone Rename - Keyboard Shortcuts", () => {
        it("should save when Enter key is pressed", async () => {
            renderMilestoneAccordion();

            const renameButton = getRenameMilestoneButton();
            await act(async () => {
                fireEvent.click(renameButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "Enter Saved Value" } });
            });

            await act(async () => {
                fireEvent.keyDown(input, { key: "Enter" });
            });

            expect(mockVscode.postMessage).toHaveBeenCalledWith({
                command: "updateMilestoneValue",
                content: {
                    milestoneIndex: 0,
                    newValue: "Enter Saved Value",
                },
            });
        });

        it("should revert when Escape key is pressed", async () => {
            renderMilestoneAccordion();

            const renameButton = getRenameMilestoneButton();
            await act(async () => {
                fireEvent.click(renameButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "Changed Value" } });
            });

            await act(async () => {
                fireEvent.keyDown(input, { key: "Escape" });
            });

            // Should exit edit mode and show original value
            expect(screen.queryByDisplayValue("Changed Value")).not.toBeInTheDocument();
            // Check that original value appears in the header
            const header = screen.getByRole("heading", { level: 2 });
            expect(header).toHaveTextContent("Chapter 1");

            // Should not send postMessage
            expect(mockVscode.postMessage).not.toHaveBeenCalled();
        });

        it("should prevent default behavior for Enter key", async () => {
            renderMilestoneAccordion();

            const renameButton = getRenameMilestoneButton();
            await act(async () => {
                fireEvent.click(renameButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;

            // Change the value first
            await act(async () => {
                fireEvent.change(input, { target: { value: "Enter Saved Value" } });
            });

            // Fire Enter key - the component should call preventDefault internally
            // We verify this by checking the behavior (save happens, edit mode exits)
            await act(async () => {
                fireEvent.keyDown(input, { key: "Enter" });
            });

            // Verify the save was called (which means preventDefault was called in the handler)
            expect(mockVscode.postMessage).toHaveBeenCalledWith({
                command: "updateMilestoneValue",
                content: {
                    milestoneIndex: 0,
                    newValue: "Enter Saved Value",
                },
            });
        });

        it("should prevent default behavior for Escape key", async () => {
            renderMilestoneAccordion();

            const renameButton = getRenameMilestoneButton();
            await act(async () => {
                fireEvent.click(renameButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;

            // Change the value first so we can verify it reverts
            await act(async () => {
                fireEvent.change(input, { target: { value: "Changed Value" } });
            });

            // Fire Escape key - the component should call preventDefault internally
            // We verify this by checking the behavior (value reverts, edit mode exits)
            await act(async () => {
                fireEvent.keyDown(input, { key: "Escape" });
            });

            // Verify the behavior: edit mode should exit and value should revert
            expect(screen.queryByDisplayValue("Changed Value")).not.toBeInTheDocument();
            // Check that the header shows the original value (use getAllByText since it appears in both header and accordion)
            const chapter1Elements = screen.getAllByText("Chapter 1");
            expect(chapter1Elements.length).toBeGreaterThan(0);
        });
    });

    describe("Milestone Rename - Local Cache", () => {
        it("should use cached value when displaying previously edited milestone", async () => {
            renderMilestoneAccordion();

            // Edit and save milestone 0
            const renameButton = getRenameMilestoneButton();
            await act(async () => {
                fireEvent.click(renameButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "Saved Chapter 1" } });
            });

            const saveButton = screen.getByLabelText("Save Milestone Rename");
            await act(async () => {
                fireEvent.click(saveButton);
            });

            // The cached value should be displayed in the header (use getAllByText since it appears in both header and accordion)
            const savedElements = screen.getAllByText("Saved Chapter 1");
            expect(savedElements.length).toBeGreaterThan(0);
            // Verify it's in the header specifically
            const header = screen.getByRole("heading", { level: 2 });
            expect(header).toHaveTextContent("Saved Chapter 1");
        });

        it("should display cached value in accordion items after saving", async () => {
            renderMilestoneAccordion();

            // Edit and save milestone 0
            const renameButton = getRenameMilestoneButton();
            await act(async () => {
                fireEvent.click(renameButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "Cached Chapter 1" } });
            });

            const saveButton = screen.getByLabelText("Save Milestone Rename");
            await act(async () => {
                fireEvent.click(saveButton);
            });

            // The cached value should be visible in the accordion
            // (the component uses localMilestoneValues to display cached values)
            const cachedElements = screen.getAllByText("Cached Chapter 1");
            expect(cachedElements.length).toBeGreaterThan(0);
            // Verify it's in the header specifically
            const header = screen.getByRole("heading", { level: 2 });
            expect(header).toHaveTextContent("Cached Chapter 1");
        });
    });

    describe("Milestone Rename - Button States", () => {
        it("should disable save button when value is empty", async () => {
            renderMilestoneAccordion();

            const renameButton = getRenameMilestoneButton();
            await act(async () => {
                fireEvent.click(renameButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "" } });
            });

            const saveButton = screen.getByLabelText("Save Milestone Rename");
            expect(saveButton).toBeDisabled();
        });

        it("should disable save button when value is only whitespace", async () => {
            renderMilestoneAccordion();

            const renameButton = getRenameMilestoneButton();
            await act(async () => {
                fireEvent.click(renameButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "   " } });
            });

            const saveButton = screen.getByLabelText("Save Milestone Rename");
            expect(saveButton).toBeDisabled();
        });

        it("should disable save button when value hasn't changed", async () => {
            renderMilestoneAccordion();

            const renameButton = getRenameMilestoneButton();
            await act(async () => {
                fireEvent.click(renameButton);
            });

            const saveButton = screen.getByLabelText("Save Milestone Rename");
            expect(saveButton).toBeDisabled();
        });

        it("should enable save button when value has changed", async () => {
            renderMilestoneAccordion();

            const renameButton = getRenameMilestoneButton();
            await act(async () => {
                fireEvent.click(renameButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "New Value" } });
            });

            const saveButton = screen.getByLabelText("Save Milestone Rename");
            expect(saveButton).not.toBeDisabled();
        });

        it("should always enable revert button", async () => {
            renderMilestoneAccordion();

            const renameButton = getRenameMilestoneButton();
            await act(async () => {
                fireEvent.click(renameButton);
            });

            const revertButton = screen.getByLabelText("Cancel Milestone Rename");
            expect(revertButton).not.toBeDisabled();
        });
    });

    describe("Milestone Rename - Source Text Mode", () => {
        it("renders the Rename Milestone pencil on source documents", () => {
            renderMilestoneAccordion({ isSourceText: true });

            expect(getRenameMilestoneButton()).toBeInTheDocument();
        });

        it("renders the Rename Milestone pencil on target documents", () => {
            renderMilestoneAccordion({ isSourceText: false });

            expect(getRenameMilestoneButton()).toBeInTheDocument();
        });

        it("should allow editing milestones in source files", async () => {
            renderMilestoneAccordion({ isSourceText: true });

            const renameButton = getRenameMilestoneButton();
            await act(async () => {
                fireEvent.click(renameButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "Source Chapter 1" } });
            });

            const saveButton = screen.getByLabelText("Save Milestone Rename");
            await act(async () => {
                fireEvent.click(saveButton);
            });

            // Should send postMessage with updateMilestoneValue command
            expect(mockVscode.postMessage).toHaveBeenCalledWith({
                command: "updateMilestoneValue",
                content: {
                    milestoneIndex: 0,
                    newValue: "Source Chapter 1",
                },
            });
        });

        it("should allow editing milestones in target files", async () => {
            renderMilestoneAccordion({ isSourceText: false });

            const renameButton = getRenameMilestoneButton();
            await act(async () => {
                fireEvent.click(renameButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "Target Chapter 1" } });
            });

            const saveButton = screen.getByLabelText("Save Milestone Rename");
            await act(async () => {
                fireEvent.click(saveButton);
            });

            // Should send postMessage with updateMilestoneValue command
            expect(mockVscode.postMessage).toHaveBeenCalledWith({
                command: "updateMilestoneValue",
                content: {
                    milestoneIndex: 0,
                    newValue: "Target Chapter 1",
                },
            });
        });
    });

    describe("Milestone Subdivision Rename", () => {
        const createSubsectionWithKey = (
            id: string,
            label: string,
            key: string,
            name?: string
        ): Subsection => ({
            id,
            label,
            startIndex: 0,
            endIndex: 5,
            key,
            name,
            startCellId: key,
            source: "custom",
        });

        it("renders rename button only for milestone subdivisions that carry a key", async () => {
            mockGetSubsectionsForMilestone = vi.fn((milestoneIdx: number) => [
                createSubsectionWithKey(
                    `s-${milestoneIdx}-0`,
                    "1-5",
                    "__start__",
                    undefined
                ),
                createSubsectionWithKey(`s-${milestoneIdx}-1`, "6-10", "v6", "Second Half"),
                // Legacy/arithmetic subsection with no key → should not expose rename
                {
                    id: `s-${milestoneIdx}-legacy`,
                    label: "11-15",
                    startIndex: 10,
                    endIndex: 15,
                },
            ]);
            renderMilestoneAccordion({
                milestoneIndex: createMockMilestoneIndex([{ value: "Luke 1", index: 0 }]),
                getSubsectionsForMilestone: mockGetSubsectionsForMilestone,
            });

            const renameButtons = await screen.findAllByLabelText("Rename Milestone Subdivision");
            // Two keyed subsections → two rename affordances; the legacy one is omitted.
            expect(renameButtons).toHaveLength(2);
        });

        it("displays the name and keeps the numeric range visible", async () => {
            mockGetSubsectionsForMilestone = vi.fn((milestoneIdx: number) => [
                createSubsectionWithKey(`s-${milestoneIdx}-0`, "1-5", "__start__", "Intro"),
            ]);
            renderMilestoneAccordion({
                milestoneIndex: createMockMilestoneIndex([{ value: "Luke 1", index: 0 }]),
                getSubsectionsForMilestone: mockGetSubsectionsForMilestone,
            });

            // Name is primary; label is rendered alongside as a muted suffix.
            expect(await screen.findByText("Intro")).toBeInTheDocument();
            expect(screen.getByText("1-5")).toBeInTheDocument();
        });

        it("posts updateMilestoneSubdivisionName when the milestone subdivision rename is saved", async () => {
            mockGetSubsectionsForMilestone = vi.fn((milestoneIdx: number) => [
                createSubsectionWithKey(`s-${milestoneIdx}-0`, "1-5", "v1"),
            ]);
            renderMilestoneAccordion({
                milestoneIndex: createMockMilestoneIndex([{ value: "Luke 1", index: 0 }]),
                getSubsectionsForMilestone: mockGetSubsectionsForMilestone,
            });

            const renameBtn = await screen.findByLabelText("Rename Milestone Subdivision");
            await act(async () => {
                fireEvent.click(renameBtn);
            });

            const inputs = await screen.findAllByPlaceholderText("1-5");
            const input = inputs[0] as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "Opening" } });
            });

            const saveBtn = screen.getByLabelText("Save Milestone Subdivision Rename");
            await act(async () => {
                fireEvent.click(saveBtn);
            });

            expect(mockVscode.postMessage).toHaveBeenCalledWith({
                command: "updateMilestoneSubdivisionName",
                content: {
                    milestoneIndex: 0,
                    subdivisionKey: "v1",
                    newName: "Opening",
                },
            });
        });

        it("sends an empty string to clear the name override", async () => {
            mockGetSubsectionsForMilestone = vi.fn((milestoneIdx: number) => [
                createSubsectionWithKey(`s-${milestoneIdx}-0`, "1-5", "v1", "Opening"),
            ]);
            renderMilestoneAccordion({
                milestoneIndex: createMockMilestoneIndex([{ value: "Luke 1", index: 0 }]),
                getSubsectionsForMilestone: mockGetSubsectionsForMilestone,
            });

            const renameBtn = await screen.findByLabelText("Rename Milestone Subdivision");
            await act(async () => {
                fireEvent.click(renameBtn);
            });

            const input = screen.getByDisplayValue("Opening") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "" } });
            });

            const saveBtn = screen.getByLabelText("Save Milestone Subdivision Rename");
            await act(async () => {
                fireEvent.click(saveBtn);
            });

            expect(mockVscode.postMessage).toHaveBeenCalledWith({
                command: "updateMilestoneSubdivisionName",
                content: {
                    milestoneIndex: 0,
                    subdivisionKey: "v1",
                    newName: "",
                },
            });
        });

        it("does not post anything when the name is unchanged", async () => {
            mockGetSubsectionsForMilestone = vi.fn((milestoneIdx: number) => [
                createSubsectionWithKey(`s-${milestoneIdx}-0`, "1-5", "v1", "Opening"),
            ]);
            renderMilestoneAccordion({
                milestoneIndex: createMockMilestoneIndex([{ value: "Luke 1", index: 0 }]),
                getSubsectionsForMilestone: mockGetSubsectionsForMilestone,
            });

            const renameBtn = await screen.findByLabelText("Rename Milestone Subdivision");
            await act(async () => {
                fireEvent.click(renameBtn);
            });

            const saveBtn = screen.getByLabelText("Save Milestone Subdivision Rename");
            await act(async () => {
                fireEvent.click(saveBtn);
            });

            const renameCalls = mockVscode.postMessage.mock.calls.filter(
                (call: any[]) => call[0]?.command === "updateMilestoneSubdivisionName"
            );
            expect(renameCalls).toHaveLength(0);
        });

        // Regression: the accordion used to call `accordionRef.current.focus()`
        // inside the same effect that registered ESC + click-outside listeners,
        // with the parent-supplied `onClose` in its deps. Every parent re-render
        // produced a new inline `onClose` arrow, which churned the deps and
        // re-stole focus from any open inline rename input — making it impossible
        // to keep typing in the subdivision rename textbox. This test guards
        // against that by changing `onClose` between renders and asserting the
        // subdivision rename input retains focus.
        it("retains subdivision-rename input focus across parent re-renders that change onClose", async () => {
            mockGetSubsectionsForMilestone = vi.fn((milestoneIdx: number) => [
                createSubsectionWithKey(`s-${milestoneIdx}-0`, "1-5", "v1", "Opening"),
            ]);
            const milestoneIndex = createMockMilestoneIndex([{ value: "Luke 1", index: 0 }]);
            const renderArgs = {
                milestoneIndex,
                getSubsectionsForMilestone: mockGetSubsectionsForMilestone,
            } as Partial<React.ComponentProps<typeof MilestoneAccordion>>;
            // Use a stable wrapper so we can rerender with a new `onClose`
            // identity (mirroring the inline-arrow pattern parents originally
            // used) without unmounting the component under test.
            const { rerender } = renderMilestoneAccordion({
                ...renderArgs,
                onClose: vi.fn(),
            });

            const renameBtn = await screen.findByLabelText("Rename Milestone Subdivision");
            await act(async () => {
                fireEvent.click(renameBtn);
            });

            const input = screen.getByDisplayValue("Opening") as HTMLInputElement;
            // Simulate a user click into the input (jsdom auto-focuses on .focus()).
            await act(async () => {
                input.focus();
            });
            expect(document.activeElement).toBe(input);

            // Force a re-render with a fresh `onClose` reference, mimicking a
            // parent re-render that passes a new inline arrow. The focus
            // useEffect must NOT yank focus back to the accordion wrapper.
            await act(async () => {
                rerender(
                    <MilestoneAccordion
                        isOpen={true}
                        onClose={vi.fn()}
                        milestoneIndex={milestoneIndex}
                        currentMilestoneIndex={0}
                        currentSubsectionIndex={0}
                        getSubsectionsForMilestone={mockGetSubsectionsForMilestone}
                        requestCellsForMilestone={mockRequestCellsForMilestone}
                        unsavedChanges={false}
                        isSourceText={false}
                        anchorRef={mockAnchorRef}
                        calculateSubsectionProgress={mockCalculateSubsectionProgress}
                        requestSubsectionProgress={mockRequestSubsectionProgress}
                        vscode={mockVscode}
                        initialSettingsMode={true}
                    />
                );
            });

            expect(document.activeElement).toBe(input);
        });

        it("cancel button leaves the existing name untouched", async () => {
            mockGetSubsectionsForMilestone = vi.fn((milestoneIdx: number) => [
                createSubsectionWithKey(`s-${milestoneIdx}-0`, "1-5", "v1", "Opening"),
            ]);
            renderMilestoneAccordion({
                milestoneIndex: createMockMilestoneIndex([{ value: "Luke 1", index: 0 }]),
                getSubsectionsForMilestone: mockGetSubsectionsForMilestone,
            });

            const renameBtn = await screen.findByLabelText("Rename Milestone Subdivision");
            await act(async () => {
                fireEvent.click(renameBtn);
            });

            const input = screen.getByDisplayValue("Opening") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "Something Else" } });
            });

            const cancelBtn = screen.getByLabelText("Cancel Milestone Subdivision Rename");
            await act(async () => {
                fireEvent.click(cancelBtn);
            });

            const renameCalls = mockVscode.postMessage.mock.calls.filter(
                (call: any[]) => call[0]?.command === "updateMilestoneSubdivisionName"
            );
            expect(renameCalls).toHaveLength(0);
            // Original name still shown (and range-only label preserved)
            expect(screen.getByText("Opening")).toBeInTheDocument();
        });
    });

    describe("Milestone Subdivision Delete and Reset (source only)", () => {
        const makeSubsection = (
            id: string,
            label: string,
            key: string,
            source: "auto" | "custom",
            startCellId?: string,
            name?: string,
            startIndex: number = 0,
            endIndex: number = 5
        ): Subsection => ({
            id,
            label,
            startIndex,
            endIndex,
            key,
            name,
            startCellId,
            source,
        });

        // Mirror the provider-produced MilestoneIndex so placement derivation
        // reads real data (vs. the lightweight createMockMilestoneIndex).
        const createIndexWithSubdivisions = (): MilestoneIndex => ({
            milestones: [
                {
                    index: 0,
                    cellIndex: 0,
                    value: "Luke 1",
                    cellCount: 30,
                    subdivisions: [
                        {
                            index: 0,
                            startRootIndex: 0,
                            endRootIndex: 5,
                            key: "__start__",
                            startCellId: "v1",
                            source: "auto",
                        },
                        {
                            index: 1,
                            startRootIndex: 5,
                            endRootIndex: 15,
                            key: "v6",
                            startCellId: "v6",
                            source: "custom",
                        },
                        {
                            index: 2,
                            startRootIndex: 15,
                            endRootIndex: 30,
                            key: "v16",
                            startCellId: "v16",
                            source: "custom",
                        },
                    ],
                },
            ],
            totalCells: 30,
            cellsPerPage: 50,
        });

        // startIndex is critical: the implicit first subdivision lives at index
        // 0 and must never expose a delete button (even though the resolver
        // marks it `source: "custom"` once any custom break exists).
        const mockSubsectionsFromIndex = () => [
            makeSubsection("s-0", "1-5", "__start__", "auto", "v1", undefined, 0, 5),
            makeSubsection("s-1", "6-15", "v6", "custom", "v6", undefined, 5, 15),
            makeSubsection("s-2", "16-30", "v16", "custom", "v16", "Final", 15, 30),
        ];

        it("shows remove button only for custom milestone subdivisions in source", async () => {
            renderMilestoneAccordion({
                isSourceText: true,
                milestoneIndex: createIndexWithSubdivisions(),
                getSubsectionsForMilestone: vi.fn(() => mockSubsectionsFromIndex()),
            });

            const removeButtons = await screen.findAllByLabelText("Remove Subdivision Break");
            // Only the two "custom" subsections expose the delete control.
            expect(removeButtons).toHaveLength(2);
        });

        it("hides the remove button for the implicit first subdivision even when the resolver marks it 'custom'", async () => {
            // The resolver re-labels the implicit first stretch as
            // `source: "custom"` the moment any user-defined break exists
            // (see `milestoneSubdivisions.test.ts`). The button visibility
            // check must therefore also gate on `startIndex > 0`, not on
            // `source` alone — otherwise reopening the accordion after
            // adding a break shows a stray trash on row 0.
            renderMilestoneAccordion({
                isSourceText: true,
                milestoneIndex: createIndexWithSubdivisions(),
                getSubsectionsForMilestone: vi.fn(() => [
                    makeSubsection("s-0", "1-5", "__start__", "custom", "v1", undefined, 0, 5),
                    makeSubsection("s-1", "6-15", "v6", "custom", "v6", undefined, 5, 15),
                    makeSubsection("s-2", "16-30", "v16", "custom", "v16", "Final", 15, 30),
                ]),
            });

            const removeButtons = await screen.findAllByLabelText("Remove Subdivision Break");
            expect(removeButtons).toHaveLength(2);
        });

        it("does not show remove button on target documents", async () => {
            renderMilestoneAccordion({
                isSourceText: false,
                milestoneIndex: createIndexWithSubdivisions(),
                getSubsectionsForMilestone: vi.fn(() => mockSubsectionsFromIndex()),
            });

            expect(screen.queryByLabelText("Remove Subdivision Break")).not.toBeInTheDocument();
            expect(screen.queryByLabelText("Reset Subdivisions")).not.toBeInTheDocument();
        });

        it("posts updateMilestoneSubdivisions without the removed break", async () => {
            renderMilestoneAccordion({
                isSourceText: true,
                milestoneIndex: createIndexWithSubdivisions(),
                getSubsectionsForMilestone: vi.fn(() => mockSubsectionsFromIndex()),
            });

            const removeButtons = await screen.findAllByLabelText("Remove Subdivision Break");
            // First one corresponds to the `v6` break.
            await act(async () => {
                fireEvent.click(removeButtons[0]);
            });

            expect(mockVscode.postMessage).toHaveBeenCalledWith({
                command: "updateMilestoneSubdivisions",
                content: {
                    milestoneIndex: 0,
                    subdivisions: [{ startCellId: "v16" }],
                },
            });
        });

        it("reset requires two clicks and then posts an empty placement list", async () => {
            renderMilestoneAccordion({
                isSourceText: true,
                milestoneIndex: createIndexWithSubdivisions(),
                getSubsectionsForMilestone: vi.fn(() => mockSubsectionsFromIndex()),
            });

            const resetButton = await screen.findByLabelText("Reset Subdivisions");
            await act(async () => {
                fireEvent.click(resetButton);
            });

            // First click arms the confirmation but does not post.
            const placementCalls = mockVscode.postMessage.mock.calls.filter(
                (call: any[]) => call[0]?.command === "updateMilestoneSubdivisions"
            );
            expect(placementCalls).toHaveLength(0);

            // After the click, the button's accessible label swaps to
            // "Confirm Reset Subdivisions" to signal the armed state.
            const confirmButton = await screen.findByLabelText("Confirm Reset Subdivisions");
            await act(async () => {
                fireEvent.click(confirmButton);
            });

            expect(mockVscode.postMessage).toHaveBeenCalledWith({
                command: "updateMilestoneSubdivisions",
                content: {
                    milestoneIndex: 0,
                    subdivisions: [],
                },
            });
        });

        it("reset button is hidden when no custom breaks exist", () => {
            renderMilestoneAccordion({
                isSourceText: true,
                milestoneIndex: {
                    milestones: [
                        {
                            index: 0,
                            cellIndex: 0,
                            value: "Luke 1",
                            cellCount: 5,
                            subdivisions: [
                                {
                                    index: 0,
                                    startRootIndex: 0,
                                    endRootIndex: 5,
                                    key: "__start__",
                                    startCellId: "v1",
                                    source: "auto",
                                },
                            ],
                        },
                    ],
                    totalCells: 5,
                    cellsPerPage: 50,
                },
                getSubsectionsForMilestone: vi.fn(() => [
                    makeSubsection("s-0", "1-5", "__start__", "auto", "v1"),
                ]),
            });

            expect(screen.queryByLabelText("Reset Subdivisions")).not.toBeInTheDocument();
        });
    });

    describe("Add Subdivision Break (source only)", () => {
        const makeSubsection = (
            id: string,
            label: string,
            key: string,
            source: "auto" | "custom",
            endIndex: number,
            startCellId?: string
        ): Subsection => ({
            id,
            label,
            startIndex: 0,
            endIndex,
            key,
            startCellId,
            source,
        });

        const createSplittableIndex = (totalRootCells: number): MilestoneIndex => ({
            milestones: [
                {
                    index: 0,
                    cellIndex: 0,
                    value: "Luke 1",
                    cellCount: totalRootCells,
                    subdivisions: [
                        {
                            index: 0,
                            startRootIndex: 0,
                            endRootIndex: totalRootCells,
                            key: "__start__",
                            startCellId: "v1",
                            source: "auto",
                        },
                    ],
                },
            ],
            totalCells: totalRootCells,
            cellsPerPage: 50,
        });

        const singleAutoSubsection = (endIndex: number) => [
            makeSubsection("s-0", `1-${endIndex}`, "__start__", "auto", endIndex, "v1"),
        ];

        it("shows the 'Add break…' button on source when the milestone has at least 2 cells", async () => {
            renderMilestoneAccordion({
                isSourceText: true,
                milestoneIndex: createSplittableIndex(10),
                getSubsectionsForMilestone: vi.fn(() => singleAutoSubsection(10)),
            });

            const addBreakButton = await screen.findByLabelText("Add Subdivision Break");
            expect(addBreakButton).toBeInTheDocument();
        });

        it("does not show the 'Add break…' button on target", () => {
            renderMilestoneAccordion({
                isSourceText: false,
                milestoneIndex: createSplittableIndex(10),
                getSubsectionsForMilestone: vi.fn(() => singleAutoSubsection(10)),
            });

            expect(screen.queryByLabelText("Add Subdivision Break")).not.toBeInTheDocument();
        });

        it("hides 'Add break…' when the milestone has only one cell (can't split)", () => {
            renderMilestoneAccordion({
                isSourceText: true,
                milestoneIndex: createSplittableIndex(1),
                getSubsectionsForMilestone: vi.fn(() => singleAutoSubsection(1)),
            });

            expect(screen.queryByLabelText("Add Subdivision Break")).not.toBeInTheDocument();
        });

        it("posts addMilestoneSubdivisionAnchor with the entered cellNumber", async () => {
            renderMilestoneAccordion({
                isSourceText: true,
                milestoneIndex: createSplittableIndex(10),
                getSubsectionsForMilestone: vi.fn(() => singleAutoSubsection(10)),
            });

            await act(async () => {
                fireEvent.click(screen.getByLabelText("Add Subdivision Break"));
            });

            const input = await screen.findByLabelText("Cell number for new break");
            await act(async () => {
                fireEvent.change(input, { target: { value: "5" } });
            });

            // The submit button re-uses the "Add Subdivision Break" aria-label
            // once the form is open (it IS the add action).
            await act(async () => {
                fireEvent.click(screen.getByLabelText("Add Subdivision Break"));
            });

            expect(mockVscode.postMessage).toHaveBeenCalledWith({
                command: "addMilestoneSubdivisionAnchor",
                content: {
                    milestoneIndex: 0,
                    cellNumber: 5,
                },
            });
        });

        it("surfaces an inline error for out-of-range input and does not post", async () => {
            renderMilestoneAccordion({
                isSourceText: true,
                milestoneIndex: createSplittableIndex(10),
                getSubsectionsForMilestone: vi.fn(() => singleAutoSubsection(10)),
            });

            await act(async () => {
                fireEvent.click(screen.getByLabelText("Add Subdivision Break"));
            });

            const input = await screen.findByLabelText("Cell number for new break");
            await act(async () => {
                fireEvent.change(input, { target: { value: "99" } });
            });
            await act(async () => {
                fireEvent.click(screen.getByLabelText("Add Subdivision Break"));
            });

            // Error text is announced via aria-live.
            expect(
                screen.getByText("Enter a number between 2 and 10.")
            ).toBeInTheDocument();
            const placementCalls = mockVscode.postMessage.mock.calls.filter(
                (call: any[]) => call[0]?.command === "addMilestoneSubdivisionAnchor"
            );
            expect(placementCalls).toHaveLength(0);
        });

        it("does not post when submitting an empty cellNumber", async () => {
            renderMilestoneAccordion({
                isSourceText: true,
                milestoneIndex: createSplittableIndex(10),
                getSubsectionsForMilestone: vi.fn(() => singleAutoSubsection(10)),
            });

            await act(async () => {
                fireEvent.click(screen.getByLabelText("Add Subdivision Break"));
            });

            await act(async () => {
                fireEvent.click(screen.getByLabelText("Add Subdivision Break"));
            });

            const placementCalls = mockVscode.postMessage.mock.calls.filter(
                (call: any[]) => call[0]?.command === "addMilestoneSubdivisionAnchor"
            );
            expect(placementCalls).toHaveLength(0);
        });

        it("respects useSubdivisionNumberLabels=true by showing numeric range instead of name", async () => {
            const named: Subsection[] = [
                {
                    id: "s-0",
                    label: "1-5",
                    startIndex: 0,
                    endIndex: 5,
                    key: "__start__",
                    startCellId: "v1",
                    source: "auto",
                    name: "Genealogy",
                },
            ];
            renderMilestoneAccordion({
                isSourceText: false,
                milestoneIndex: createSplittableIndex(5),
                getSubsectionsForMilestone: vi.fn(() => named),
                useSubdivisionNumberLabels: true,
            });

            // Name is suppressed in favor of the numeric range; the name must
            // NOT appear anywhere as the primary label.
            expect(screen.queryByText("Genealogy")).not.toBeInTheDocument();
            expect(screen.getByText("1-5")).toBeInTheDocument();
        });

        it("default behavior (useSubdivisionNumberLabels=false) shows the name", async () => {
            const named: Subsection[] = [
                {
                    id: "s-0",
                    label: "1-5",
                    startIndex: 0,
                    endIndex: 5,
                    key: "__start__",
                    startCellId: "v1",
                    source: "auto",
                    name: "Genealogy",
                },
            ];
            renderMilestoneAccordion({
                isSourceText: false,
                milestoneIndex: createSplittableIndex(5),
                getSubsectionsForMilestone: vi.fn(() => named),
            });

            expect(screen.getByText("Genealogy")).toBeInTheDocument();
        });

        it("cancel button closes the form without posting", async () => {
            renderMilestoneAccordion({
                isSourceText: true,
                milestoneIndex: createSplittableIndex(10),
                getSubsectionsForMilestone: vi.fn(() => singleAutoSubsection(10)),
            });

            await act(async () => {
                fireEvent.click(screen.getByLabelText("Add Subdivision Break"));
            });

            const input = await screen.findByLabelText("Cell number for new break");
            await act(async () => {
                fireEvent.change(input, { target: { value: "5" } });
            });
            await act(async () => {
                fireEvent.click(screen.getByLabelText("Cancel Add Break"));
            });

            // Form closed → input gone, trigger button restored.
            expect(
                screen.queryByLabelText("Cell number for new break")
            ).not.toBeInTheDocument();
            expect(screen.getByLabelText("Add Subdivision Break")).toBeInTheDocument();
            const placementCalls = mockVscode.postMessage.mock.calls.filter(
                (call: any[]) => call[0]?.command === "addMilestoneSubdivisionAnchor"
            );
            expect(placementCalls).toHaveLength(0);
        });
    });

    describe("Settings mode (gear toggle)", () => {
        it("hides edit affordances by default and reveals them after clicking the gear", async () => {
            renderMilestoneAccordion({ initialSettingsMode: false });

            // Default (read-only) state: gear is the only edit-related control
            // in the header, every milestone's rename pencil is gone, and the
            // per-subdivision pencils + add-break / reset footers stay hidden.
            // Use queryAllByLabelText so the assertion is precise about the
            // *count* of pencils (zero) without throwing when there happen
            // to be multiple rows.
            expect(screen.queryAllByLabelText("Rename Milestone")).toHaveLength(0);
            expect(
                screen.queryAllByLabelText("Rename Milestone Subdivision")
            ).toHaveLength(0);
            expect(screen.queryAllByLabelText("Add Subdivision Break")).toHaveLength(0);
            const gearButton = screen.getByLabelText("Toggle Milestone Settings");
            expect(gearButton).toHaveAttribute("aria-pressed", "false");

            await act(async () => {
                fireEvent.click(gearButton);
            });

            // Settings on → every milestone row exposes its rename pencil.
            // We assert the current row's pencil specifically (the others
            // mirror it) so the test reads as "pencil for Chapter 1 is back".
            expect(getRenameMilestoneButton()).toBeInTheDocument();
            expect(screen.getByLabelText("Toggle Milestone Settings")).toHaveAttribute(
                "aria-pressed",
                "true"
            );
        });

        it("reveals per-milestone-subdivision rename pencils when settings mode is open", async () => {
            // Milestone subdivisions need a `key` for the rename pencil to
            // render at all (per the canRename guard); supply one so we can
            // verify the gear toggle uncovers them.
            renderMilestoneAccordion({
                initialSettingsMode: false,
                getSubsectionsForMilestone: vi.fn(() => [
                    {
                        id: "sub-0-1",
                        label: "1–5",
                        startIndex: 0,
                        endIndex: 5,
                        key: "__start__",
                    } as Subsection,
                ]),
            });

            expect(screen.queryByLabelText("Rename Milestone Subdivision")).not.toBeInTheDocument();

            await act(async () => {
                fireEvent.click(screen.getByLabelText("Toggle Milestone Settings"));
            });

            const renamePencils = screen.getAllByLabelText("Rename Milestone Subdivision");
            expect(renamePencils.length).toBeGreaterThan(0);
        });

        it("shows the Add Subdivision Break footer only on source documents in settings mode", async () => {
            renderMilestoneAccordion({
                initialSettingsMode: false,
                isSourceText: true,
            });

            expect(screen.queryByLabelText("Add Subdivision Break")).not.toBeInTheDocument();

            await act(async () => {
                fireEvent.click(screen.getByLabelText("Toggle Milestone Settings"));
            });

            // Once the gear opens settings, source-only "Add break…" buttons
            // become reachable. (Target documents never see these regardless
            // of the gear; that's covered by the existing "Add Break — target"
            // tests.)
            expect(screen.getAllByLabelText("Add Subdivision Break").length).toBeGreaterThan(0);
        });

        it("collapses settings mode again when the accordion is closed and reopened", async () => {
            const { rerender } = renderMilestoneAccordion({ initialSettingsMode: false });

            await act(async () => {
                fireEvent.click(screen.getByLabelText("Toggle Milestone Settings"));
            });
            expect(getRenameMilestoneButton()).toBeInTheDocument();

            // Close and reopen — the user should land back in read-only mode
            // so an accidental click on the gear isn't sticky across sessions.
            await act(async () => {
                rerender(
                    <MilestoneAccordion
                        isOpen={false}
                        onClose={mockOnClose}
                        milestoneIndex={createMockMilestoneIndex([
                            { value: "Chapter 1", index: 0 },
                        ])}
                        currentMilestoneIndex={0}
                        currentSubsectionIndex={0}
                        getSubsectionsForMilestone={mockGetSubsectionsForMilestone}
                        requestCellsForMilestone={mockRequestCellsForMilestone}
                        allSubsectionProgress={undefined}
                        unsavedChanges={false}
                        isSourceText={false}
                        anchorRef={mockAnchorRef}
                        calculateSubsectionProgress={mockCalculateSubsectionProgress}
                        requestSubsectionProgress={mockRequestSubsectionProgress}
                        vscode={mockVscode}
                        initialSettingsMode={false}
                    />
                );
            });
            await act(async () => {
                rerender(
                    <MilestoneAccordion
                        isOpen={true}
                        onClose={mockOnClose}
                        milestoneIndex={createMockMilestoneIndex([
                            { value: "Chapter 1", index: 0 },
                        ])}
                        currentMilestoneIndex={0}
                        currentSubsectionIndex={0}
                        getSubsectionsForMilestone={mockGetSubsectionsForMilestone}
                        requestCellsForMilestone={mockRequestCellsForMilestone}
                        allSubsectionProgress={undefined}
                        unsavedChanges={false}
                        isSourceText={false}
                        anchorRef={mockAnchorRef}
                        calculateSubsectionProgress={mockCalculateSubsectionProgress}
                        requestSubsectionProgress={mockRequestSubsectionProgress}
                        vscode={mockVscode}
                        initialSettingsMode={false}
                    />
                );
            });

            // After remount in read-only mode, NO milestone exposes a rename
            // pencil — the gear must collapse settings rather than persist
            // through an accordion close/reopen cycle.
            expect(screen.queryAllByLabelText("Rename Milestone")).toHaveLength(0);
            expect(screen.getByLabelText("Toggle Milestone Settings")).toHaveAttribute(
                "aria-pressed",
                "false"
            );
        });
    });

    describe("Milestone Rename - Accordion Close (no refresh on close)", () => {
        it("should not send refreshWebviewAfterMilestoneEdits when accordion closes after saving (provider pushes updates immediately on save)", async () => {
            const { rerender } = renderMilestoneAccordion();

            const renameButton = getRenameMilestoneButton();
            await act(async () => {
                fireEvent.click(renameButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "New Value" } });
            });

            const saveButton = screen.getByLabelText("Save Milestone Rename");
            await act(async () => {
                fireEvent.click(saveButton);
            });

            // Verify updateMilestoneValue was called (provider pushes updated data to webview immediately)
            expect(mockVscode.postMessage).toHaveBeenCalledWith({
                command: "updateMilestoneValue",
                content: {
                    milestoneIndex: 0,
                    newValue: "New Value",
                },
            });

            mockVscode.postMessage.mockClear();

            // Close accordion - should NOT send refreshWebviewAfterMilestoneEdits (provider already pushed update on save)
            const milestoneIndex = createMockMilestoneIndex([
                { value: "Chapter 1", index: 0 },
                { value: "Chapter 2", index: 1 },
                { value: "Chapter 3", index: 2 },
            ]);

            await act(async () => {
                rerender(
                    <MilestoneAccordion
                        isOpen={false}
                        onClose={mockOnClose}
                        milestoneIndex={milestoneIndex}
                        currentMilestoneIndex={0}
                        currentSubsectionIndex={0}
                        getSubsectionsForMilestone={mockGetSubsectionsForMilestone}
                        requestCellsForMilestone={mockRequestCellsForMilestone}
                        allSubsectionProgress={undefined}
                        unsavedChanges={false}
                        isSourceText={false}
                        anchorRef={mockAnchorRef}
                        calculateSubsectionProgress={mockCalculateSubsectionProgress}
                        requestSubsectionProgress={mockRequestSubsectionProgress}
                        vscode={mockVscode}
                    />
                );
            });

            const refreshCalls = mockVscode.postMessage.mock.calls.filter(
                (call: any[]) => call[0]?.command === "refreshWebviewAfterMilestoneEdits"
            );
            expect(refreshCalls).toHaveLength(0);
        });
    });

    // ----------------------------------------------------------------
    // Milestone-placement editing controls (gated by the workspace
    // setting + isSourceText + settings mode). Hidden by default — when
    // the controls are reachable they post the new structural commands
    // (`addMilestoneAtCell`, `removeMilestone`,
    // `promoteSubdivisionToMilestone`, `demoteMilestoneToSubdivision`).
    // ----------------------------------------------------------------
    describe("Milestone Placement Editing", () => {
        it("hides Add Milestone, demote, remove, and promote controls when the setting is off", () => {
            renderMilestoneAccordion({
                isSourceText: true,
                initialSettingsMode: true,
                enableMilestonePlacementEditing: false,
                getSubsectionsForMilestone: vi.fn(() => [
                    {
                        id: "sub-0-1",
                        label: "1–5",
                        startIndex: 0,
                        endIndex: 5,
                        key: "__start__",
                        source: "auto",
                    } as Subsection,
                    {
                        id: "sub-0-2",
                        label: "6–10",
                        startIndex: 5,
                        endIndex: 10,
                        key: "v6",
                        startCellId: "v6",
                        source: "custom",
                    } as Subsection,
                ]),
            });

            expect(screen.queryByLabelText("Add Milestone")).not.toBeInTheDocument();
            expect(
                screen.queryByLabelText("Promote Subdivision to Milestone")
            ).not.toBeInTheDocument();
            expect(
                screen.queryByLabelText("Demote Milestone to Subdivision")
            ).not.toBeInTheDocument();
            expect(screen.queryByLabelText("Remove Milestone")).not.toBeInTheDocument();
        });

        it("shows the Add Milestone button when the feature is on, source, in settings mode", () => {
            renderMilestoneAccordion({
                isSourceText: true,
                initialSettingsMode: true,
                enableMilestonePlacementEditing: true,
            });
            expect(screen.getAllByLabelText("Add Milestone").length).toBeGreaterThan(0);
        });

        it("posts addMilestoneAtCell with the entered cell number", async () => {
            renderMilestoneAccordion({
                isSourceText: true,
                initialSettingsMode: true,
                enableMilestonePlacementEditing: true,
            });

            // Open the milestone form on the first milestone.
            const openButtons = screen.getAllByLabelText("Add Milestone");
            await act(async () => {
                fireEvent.click(openButtons[0]);
            });

            const input = screen.getByLabelText("Cell number for new milestone");
            await act(async () => {
                fireEvent.change(input, { target: { value: "3" } });
            });

            const submitButtons = screen.getAllByLabelText("Add Milestone");
            // After opening the form there are two "Add Milestone" buttons:
            // the open trigger on other milestones + the submit button on
            // this one. The submit one is type=submit.
            const submit = submitButtons.find(
                (b) => (b as HTMLButtonElement).type === "submit"
            ) as HTMLButtonElement;
            expect(submit).toBeTruthy();
            await act(async () => {
                fireEvent.click(submit);
            });

            const calls = mockVscode.postMessage.mock.calls.filter(
                (c: any[]) => c[0]?.command === "addMilestoneAtCell"
            );
            expect(calls).toHaveLength(1);
            expect(calls[0][0].content).toEqual({ milestoneIndex: 0, cellNumber: 3 });
        });

        it("posts promoteSubdivisionToMilestone when the promote icon is clicked on a custom subdivision", async () => {
            renderMilestoneAccordion({
                isSourceText: true,
                initialSettingsMode: true,
                enableMilestonePlacementEditing: true,
                getSubsectionsForMilestone: vi.fn(() => [
                    {
                        id: "sub-0-1",
                        label: "1–5",
                        startIndex: 0,
                        endIndex: 5,
                        key: "__start__",
                        source: "auto",
                    } as Subsection,
                    {
                        id: "sub-0-2",
                        label: "6–10",
                        startIndex: 5,
                        endIndex: 10,
                        key: "v6",
                        startCellId: "v6",
                        source: "custom",
                    } as Subsection,
                ]),
            });

            const promoteButton = screen.getAllByLabelText(
                "Promote Subdivision to Milestone"
            )[0];
            await act(async () => {
                fireEvent.click(promoteButton);
            });

            const calls = mockVscode.postMessage.mock.calls.filter(
                (c: any[]) => c[0]?.command === "promoteSubdivisionToMilestone"
            );
            expect(calls).toHaveLength(1);
            expect(calls[0][0].content.subdivisionKey).toBe("v6");
        });

        it("first milestone never exposes remove or demote buttons", () => {
            renderMilestoneAccordion({
                isSourceText: true,
                initialSettingsMode: true,
                enableMilestonePlacementEditing: true,
                milestoneIndex: createMockMilestoneIndex([
                    { value: "Chapter 1", index: 0 },
                ]),
            });
            expect(screen.queryByLabelText("Remove Milestone")).not.toBeInTheDocument();
            expect(
                screen.queryByLabelText("Demote Milestone to Subdivision")
            ).not.toBeInTheDocument();
        });

        it("requires two clicks on Remove before posting removeMilestone", async () => {
            renderMilestoneAccordion({
                isSourceText: true,
                initialSettingsMode: true,
                enableMilestonePlacementEditing: true,
            });

            const removeButtons = screen.getAllByLabelText("Remove Milestone");
            // First click arms the action — no message yet.
            await act(async () => {
                fireEvent.click(removeButtons[0]);
            });
            let calls = mockVscode.postMessage.mock.calls.filter(
                (c: any[]) => c[0]?.command === "removeMilestone"
            );
            expect(calls).toHaveLength(0);

            // Second click commits.
            const armed = screen.getByLabelText("Confirm Remove Milestone");
            await act(async () => {
                fireEvent.click(armed);
            });
            calls = mockVscode.postMessage.mock.calls.filter(
                (c: any[]) => c[0]?.command === "removeMilestone"
            );
            expect(calls).toHaveLength(1);
            expect(calls[0][0].content).toEqual({ milestoneIndex: 1 });
        });

        it("posts demoteMilestoneToSubdivision on a single click", async () => {
            renderMilestoneAccordion({
                isSourceText: true,
                initialSettingsMode: true,
                enableMilestonePlacementEditing: true,
            });

            const demoteButtons = screen.getAllByLabelText(
                "Demote Milestone to Subdivision"
            );
            await act(async () => {
                fireEvent.click(demoteButtons[0]);
            });
            const calls = mockVscode.postMessage.mock.calls.filter(
                (c: any[]) => c[0]?.command === "demoteMilestoneToSubdivision"
            );
            expect(calls).toHaveLength(1);
            expect(calls[0][0].content).toEqual({ milestoneIndex: 1 });
            // Confirm there's no two-click "Confirm Demote Milestone" arming
            // step left over from the previous behavior.
            expect(
                screen.queryByLabelText("Confirm Demote Milestone")
            ).not.toBeInTheDocument();
        });

        it("does not render placement controls on target documents", () => {
            renderMilestoneAccordion({
                isSourceText: false,
                initialSettingsMode: true,
                enableMilestonePlacementEditing: true,
            });
            expect(screen.queryByLabelText("Add Milestone")).not.toBeInTheDocument();
            expect(screen.queryByLabelText("Remove Milestone")).not.toBeInTheDocument();
            expect(
                screen.queryByLabelText("Demote Milestone to Subdivision")
            ).not.toBeInTheDocument();
        });
    });
});
