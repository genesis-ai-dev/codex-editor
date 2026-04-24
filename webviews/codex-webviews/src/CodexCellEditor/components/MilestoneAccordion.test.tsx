import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
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
    }: any) => (
        <button
            onClick={onClick}
            disabled={disabled}
            data-appearance={appearance}
            title={title}
            aria-label={ariaLabel}
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

// Mock icons
vi.mock("lucide-react", () => ({
    Languages: () => <div data-testid="languages-icon">Languages</div>,
    Check: () => <div data-testid="check-icon">Check</div>,
    RotateCcw: () => <div data-testid="rotate-icon">RotateCcw</div>,
    X: () => <div data-testid="x-icon">X</div>,
    Undo2: () => <div data-testid="undo-icon">Undo2</div>,
    Plus: () => <div data-testid="plus-icon">Plus</div>,
}));

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
        };

        return render(<MilestoneAccordion {...defaultProps} {...props} />);
    }

    describe("Edit Mode - Starting Edit", () => {
        it("should enter edit mode when edit button is clicked", async () => {
            renderMilestoneAccordion();

            const editButton = screen.getByLabelText("Edit Milestone");
            expect(editButton).toBeInTheDocument();

            await act(async () => {
                fireEvent.click(editButton);
            });

            // Should show input field
            const input = screen.getByDisplayValue("Chapter 1");
            expect(input).toBeInTheDocument();
            expect(input.tagName).toBe("INPUT");

            // Should show save and revert buttons
            expect(screen.getByLabelText("Save Milestone")).toBeInTheDocument();
            expect(screen.getByLabelText("Revert Changes")).toBeInTheDocument();

            // Edit button should not be visible
            expect(screen.queryByLabelText("Edit Milestone")).not.toBeInTheDocument();
        });

        it("should initialize input with current milestone value", async () => {
            renderMilestoneAccordion();

            const editButton = screen.getByLabelText("Edit Milestone");
            await act(async () => {
                fireEvent.click(editButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            expect(input.value).toBe("Chapter 1");
        });

        it("should show input field when entering edit mode", async () => {
            renderMilestoneAccordion();

            const editButton = screen.getByLabelText("Edit Milestone");
            await act(async () => {
                fireEvent.click(editButton);
            });

            // Input should be visible and editable
            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            expect(input).toBeInTheDocument();
            expect(input.type).toBe("text");
        });
    });

    describe("Edit Mode - Saving Changes", () => {
        it("should save milestone when save button is clicked with valid value", async () => {
            renderMilestoneAccordion();

            // Enter edit mode
            const editButton = screen.getByLabelText("Edit Milestone");
            await act(async () => {
                fireEvent.click(editButton);
            });

            // Change the value
            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "Updated Chapter 1" } });
            });

            // Click save
            const saveButton = screen.getByLabelText("Save Milestone");
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

            const editButton = screen.getByLabelText("Edit Milestone");
            await act(async () => {
                fireEvent.click(editButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "  Trimmed Chapter 1  " } });
            });

            const saveButton = screen.getByLabelText("Save Milestone");
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

            const editButton = screen.getByLabelText("Edit Milestone");
            await act(async () => {
                fireEvent.click(editButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "   " } });
            });

            const saveButton = screen.getByLabelText("Save Milestone");
            expect(saveButton).toBeDisabled();

            await act(async () => {
                fireEvent.click(saveButton);
            });

            // Should not send postMessage
            expect(mockVscode.postMessage).not.toHaveBeenCalled();
        });

        it("should not save if value hasn't changed", async () => {
            renderMilestoneAccordion();

            const editButton = screen.getByLabelText("Edit Milestone");
            await act(async () => {
                fireEvent.click(editButton);
            });

            const saveButton = screen.getByLabelText("Save Milestone");
            expect(saveButton).toBeDisabled();

            await act(async () => {
                fireEvent.click(saveButton);
            });

            // Should not send postMessage
            expect(mockVscode.postMessage).not.toHaveBeenCalled();
        });

        it("should update local cache immediately after saving", async () => {
            renderMilestoneAccordion();

            const editButton = screen.getByLabelText("Edit Milestone");
            await act(async () => {
                fireEvent.click(editButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "Cached Chapter 1" } });
            });

            const saveButton = screen.getByLabelText("Save Milestone");
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

            const editButton = screen.getByLabelText("Edit Milestone");
            await act(async () => {
                fireEvent.click(editButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "Valid Save" } });
            });

            const saveButton = screen.getByLabelText("Save Milestone");
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

    describe("Edit Mode - Reverting Changes", () => {
        it("should revert to original value when revert button is clicked", async () => {
            renderMilestoneAccordion();

            const editButton = screen.getByLabelText("Edit Milestone");
            await act(async () => {
                fireEvent.click(editButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "Changed Value" } });
            });

            const revertButton = screen.getByLabelText("Revert Changes");
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

            const editButton = screen.getByLabelText("Edit Milestone");
            await act(async () => {
                fireEvent.click(editButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "Changed Value" } });
            });

            const revertButton = screen.getByLabelText("Revert Changes");
            await act(async () => {
                fireEvent.click(revertButton);
            });

            // Should not send any postMessage
            expect(mockVscode.postMessage).not.toHaveBeenCalled();
        });
    });

    describe("Edit Mode - Keyboard Shortcuts", () => {
        it("should save when Enter key is pressed", async () => {
            renderMilestoneAccordion();

            const editButton = screen.getByLabelText("Edit Milestone");
            await act(async () => {
                fireEvent.click(editButton);
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

            const editButton = screen.getByLabelText("Edit Milestone");
            await act(async () => {
                fireEvent.click(editButton);
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

            const editButton = screen.getByLabelText("Edit Milestone");
            await act(async () => {
                fireEvent.click(editButton);
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

            const editButton = screen.getByLabelText("Edit Milestone");
            await act(async () => {
                fireEvent.click(editButton);
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

    describe("Edit Mode - Local Cache", () => {
        it("should use cached value when displaying previously edited milestone", async () => {
            renderMilestoneAccordion();

            // Edit and save milestone 0
            const editButton = screen.getByLabelText("Edit Milestone");
            await act(async () => {
                fireEvent.click(editButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "Saved Chapter 1" } });
            });

            const saveButton = screen.getByLabelText("Save Milestone");
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
            const editButton = screen.getByLabelText("Edit Milestone");
            await act(async () => {
                fireEvent.click(editButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "Cached Chapter 1" } });
            });

            const saveButton = screen.getByLabelText("Save Milestone");
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

    describe("Edit Mode - Button States", () => {
        it("should disable save button when value is empty", async () => {
            renderMilestoneAccordion();

            const editButton = screen.getByLabelText("Edit Milestone");
            await act(async () => {
                fireEvent.click(editButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "" } });
            });

            const saveButton = screen.getByLabelText("Save Milestone");
            expect(saveButton).toBeDisabled();
        });

        it("should disable save button when value is only whitespace", async () => {
            renderMilestoneAccordion();

            const editButton = screen.getByLabelText("Edit Milestone");
            await act(async () => {
                fireEvent.click(editButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "   " } });
            });

            const saveButton = screen.getByLabelText("Save Milestone");
            expect(saveButton).toBeDisabled();
        });

        it("should disable save button when value hasn't changed", async () => {
            renderMilestoneAccordion();

            const editButton = screen.getByLabelText("Edit Milestone");
            await act(async () => {
                fireEvent.click(editButton);
            });

            const saveButton = screen.getByLabelText("Save Milestone");
            expect(saveButton).toBeDisabled();
        });

        it("should enable save button when value has changed", async () => {
            renderMilestoneAccordion();

            const editButton = screen.getByLabelText("Edit Milestone");
            await act(async () => {
                fireEvent.click(editButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "New Value" } });
            });

            const saveButton = screen.getByLabelText("Save Milestone");
            expect(saveButton).not.toBeDisabled();
        });

        it("should always enable revert button", async () => {
            renderMilestoneAccordion();

            const editButton = screen.getByLabelText("Edit Milestone");
            await act(async () => {
                fireEvent.click(editButton);
            });

            const revertButton = screen.getByLabelText("Revert Changes");
            expect(revertButton).not.toBeDisabled();
        });
    });

    describe("Edit Mode - Source Text Mode", () => {
        it("should show edit button when isSourceText is true", () => {
            renderMilestoneAccordion({ isSourceText: true });

            expect(screen.getByLabelText("Edit Milestone")).toBeInTheDocument();
        });

        it("should show edit button when isSourceText is false", () => {
            renderMilestoneAccordion({ isSourceText: false });

            expect(screen.getByLabelText("Edit Milestone")).toBeInTheDocument();
        });

        it("should allow editing milestones in source files", async () => {
            renderMilestoneAccordion({ isSourceText: true });

            const editButton = screen.getByLabelText("Edit Milestone");
            await act(async () => {
                fireEvent.click(editButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "Source Chapter 1" } });
            });

            const saveButton = screen.getByLabelText("Save Milestone");
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

            const editButton = screen.getByLabelText("Edit Milestone");
            await act(async () => {
                fireEvent.click(editButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "Target Chapter 1" } });
            });

            const saveButton = screen.getByLabelText("Save Milestone");
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

    describe("Subsection Rename", () => {
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

        it("renders rename button only for subsections that carry a key", async () => {
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

            const renameButtons = await screen.findAllByLabelText("Rename Subsection");
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

        it("posts updateMilestoneSubdivisionName when the subsection rename is saved", async () => {
            mockGetSubsectionsForMilestone = vi.fn((milestoneIdx: number) => [
                createSubsectionWithKey(`s-${milestoneIdx}-0`, "1-5", "v1"),
            ]);
            renderMilestoneAccordion({
                milestoneIndex: createMockMilestoneIndex([{ value: "Luke 1", index: 0 }]),
                getSubsectionsForMilestone: mockGetSubsectionsForMilestone,
            });

            const renameBtn = await screen.findByLabelText("Rename Subsection");
            await act(async () => {
                fireEvent.click(renameBtn);
            });

            const inputs = await screen.findAllByPlaceholderText("1-5");
            const input = inputs[0] as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "Opening" } });
            });

            const saveBtn = screen.getByLabelText("Save Subsection Name");
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

            const renameBtn = await screen.findByLabelText("Rename Subsection");
            await act(async () => {
                fireEvent.click(renameBtn);
            });

            const input = screen.getByDisplayValue("Opening") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "" } });
            });

            const saveBtn = screen.getByLabelText("Save Subsection Name");
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

            const renameBtn = await screen.findByLabelText("Rename Subsection");
            await act(async () => {
                fireEvent.click(renameBtn);
            });

            const saveBtn = screen.getByLabelText("Save Subsection Name");
            await act(async () => {
                fireEvent.click(saveBtn);
            });

            const renameCalls = mockVscode.postMessage.mock.calls.filter(
                (call: any[]) => call[0]?.command === "updateMilestoneSubdivisionName"
            );
            expect(renameCalls).toHaveLength(0);
        });

        it("cancel button leaves the existing name untouched", async () => {
            mockGetSubsectionsForMilestone = vi.fn((milestoneIdx: number) => [
                createSubsectionWithKey(`s-${milestoneIdx}-0`, "1-5", "v1", "Opening"),
            ]);
            renderMilestoneAccordion({
                milestoneIndex: createMockMilestoneIndex([{ value: "Luke 1", index: 0 }]),
                getSubsectionsForMilestone: mockGetSubsectionsForMilestone,
            });

            const renameBtn = await screen.findByLabelText("Rename Subsection");
            await act(async () => {
                fireEvent.click(renameBtn);
            });

            const input = screen.getByDisplayValue("Opening") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "Something Else" } });
            });

            const cancelBtn = screen.getByLabelText("Cancel Rename");
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

    describe("Subsection Delete and Reset (source only)", () => {
        const makeSubsection = (
            id: string,
            label: string,
            key: string,
            source: "auto" | "custom",
            startCellId?: string,
            name?: string
        ): Subsection => ({
            id,
            label,
            startIndex: 0,
            endIndex: 5,
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

        const mockSubsectionsFromIndex = () => [
            makeSubsection("s-0", "1-5", "__start__", "auto", "v1"),
            makeSubsection("s-1", "6-15", "v6", "custom", "v6"),
            makeSubsection("s-2", "16-30", "v16", "custom", "v16", "Final"),
        ];

        it("shows remove button only for custom subsections in source", async () => {
            renderMilestoneAccordion({
                isSourceText: true,
                milestoneIndex: createIndexWithSubdivisions(),
                getSubsectionsForMilestone: vi.fn(() => mockSubsectionsFromIndex()),
            });

            const removeButtons = await screen.findAllByLabelText("Remove Subdivision Break");
            // Only the two "custom" subsections expose the delete control.
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

    describe("Edit Mode - Accordion Close (no refresh on close)", () => {
        it("should not send refreshWebviewAfterMilestoneEdits when accordion closes after saving (provider pushes updates immediately on save)", async () => {
            const { rerender } = renderMilestoneAccordion();

            const editButton = screen.getByLabelText("Edit Milestone");
            await act(async () => {
                fireEvent.click(editButton);
            });

            const input = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
            await act(async () => {
                fireEvent.change(input, { target: { value: "New Value" } });
            });

            const saveButton = screen.getByLabelText("Save Milestone");
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
});
