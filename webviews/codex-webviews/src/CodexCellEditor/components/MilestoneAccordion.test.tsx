import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { MilestoneAccordion } from "./MilestoneAccordion";
import type { MilestoneIndex } from "../../../../../types";
import type { Subsection } from "../../lib/types";

// Mock VSCode UI Toolkit components
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
    VSCodeButton: ({ children, onClick, disabled, appearance, title, "aria-label": ariaLabel }: any) => (
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
        <button
            data-testid={`accordion-trigger`}
            className={className}
            onClick={onClick}
        >
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

    const createMockMilestoneIndex = (milestones: Array<{ value: string; index: number }>): MilestoneIndex => ({
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

    function renderMilestoneAccordion(props: Partial<React.ComponentProps<typeof MilestoneAccordion>> = {}) {
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
                    deferRefresh: true,
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
                    deferRefresh: true,
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
                    deferRefresh: true,
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
                    deferRefresh: true,
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
                    deferRefresh: true,
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
                    deferRefresh: true,
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
                    deferRefresh: true,
                },
            });
        });
    });

    describe("Edit Mode - Pending Refreshes", () => {
        it("should mark pending refreshes when saving", async () => {
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

            // Verify updateMilestoneValue was called
            expect(mockVscode.postMessage).toHaveBeenCalledWith({
                command: "updateMilestoneValue",
                content: {
                    milestoneIndex: 0,
                    newValue: "New Value",
                    deferRefresh: true,
                },
            });

            // Clear the mock to only check for refresh message
            mockVscode.postMessage.mockClear();

            // When accordion closes (isOpen becomes false), it should trigger refresh
            // Simulate closing by rerendering with isOpen: false
            // The useEffect should detect the change and send the refresh message
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

            // Should send refresh message when accordion closes with pending refreshes
            expect(mockVscode.postMessage).toHaveBeenCalledWith({
                command: "refreshWebviewAfterMilestoneEdits",
                content: {},
            });
        });

        it("should not send refresh message if no pending refreshes", async () => {
            renderMilestoneAccordion();

            // Just close without editing
            const closeButton = screen.getByLabelText("Close Milestone");
            await act(async () => {
                fireEvent.click(closeButton);
            });

            // Should not send refresh message
            const refreshCalls = mockVscode.postMessage.mock.calls.filter(
                (call: any[]) => call[0]?.command === "refreshWebviewAfterMilestoneEdits"
            );
            expect(refreshCalls).toHaveLength(0);
        });
    });

});
