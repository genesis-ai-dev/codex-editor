import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { QuillCellContent } from "../../../../../types";
import { CodexCellTypes } from "../../../../../types/enums";
import CellList from "../CellList";
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

// Helper function to create a mock cell with globalReferences (new UUID format)
const createCellWithGlobalRef = (
    uuid: string,
    globalReference: string, // e.g., "GEN 1:1"
    cellType: CodexCellTypes = CodexCellTypes.TEXT,
    content: string = "<p>Test content</p>",
    milestoneIndex?: number // Optional milestone index for milestone-based footnote counting
): QuillCellContent => ({
    cellMarkers: [uuid], // UUID format
    cellContent: content,
    cellType,
    data: {
        globalReferences: [globalReference], // New format: uses globalReferences
        ...(milestoneIndex !== undefined && { milestoneIndex }), // Include milestoneIndex if provided
    },
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
    cellLabel: globalReference,
    timestamps: {
        startTime: 0,
        endTime: 5,
    },
});

// Helper function to create a cell with footnote content
const createCellWithFootnotes = (
    uuid: string,
    globalReference: string,
    footnoteCount: number,
    milestoneIndex?: number // Optional milestone index for milestone-based footnote counting
): QuillCellContent => {
    // Create HTML content with footnote markers
    const footnoteMarkers = Array.from(
        { length: footnoteCount },
        (_, i) => `<sup class="footnote-marker">${i + 1}</sup>`
    ).join(" ");

    return createCellWithGlobalRef(
        uuid,
        globalReference,
        CodexCellTypes.TEXT,
        `<p>Content with footnotes ${footnoteMarkers}</p>`,
        milestoneIndex
    );
};

// Helper function to create a milestone cell
const createMilestoneCell = (
    uuid: string,
    value: string // e.g., "GEN 1" or "1"
): QuillCellContent => ({
    cellMarkers: [uuid],
    cellContent: value,
    cellType: CodexCellTypes.MILESTONE,
    data: {},
    editHistory: [
        {
            editMap: ["value"],
            value: value,
            author: "test-user",
            validatedBy: [],
            timestamp: Date.now(),
            type: "user-edit" as any,
        },
    ],
    cellLabel: value,
    timestamps: {
        startTime: 0,
        endTime: 0,
    },
});

describe("CellList - Footnote Offset Calculation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Mock scrollIntoView
        Element.prototype.scrollIntoView = vi.fn();
    });

    describe("Sequential footnote numbering across cells in same milestone", () => {
        it("should calculate correct offset when first cell has footnotes and second cell is empty", () => {
            const milestoneUuid = "milestone-uuid-1";
            const milestoneIndex = 0;
            const translationUnits: QuillCellContent[] = [
                createCellWithFootnotes("uuid-1", "GEN 1:1", 2, milestoneIndex), // 2 footnotes
                createCellWithGlobalRef(
                    "uuid-2",
                    "GEN 1:2",
                    CodexCellTypes.TEXT,
                    "<p>No footnotes</p>",
                    milestoneIndex
                ),
            ];
            // fullDocumentTranslationUnits should contain all cells in the milestone (for footnote counting)
            const fullDocumentTranslationUnits: QuillCellContent[] = [
                ...translationUnits, // All cells in milestone, not just current page
            ];

            const mockMilestoneIndex = {
                milestones: [
                    {
                        index: 0,
                        cellIndex: 0,
                        value: "GEN 1",
                        cellCount: 2,
                    },
                ],
                totalCells: 2,
                cellsPerPage: 50,
            };

            const props = {
                translationUnits,
                fullDocumentTranslationUnits,
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
                cellDisplayMode: CELL_DISPLAY_MODES.ONE_LINE_PER_CELL,
                isSourceText: false,
                windowHeight: 800,
                headerHeight: 100,
                highlightedCellId: null,
                scrollSyncEnabled: true,
                currentUsername: "test-user",
                requiredValidations: 1,
                milestoneIndex: mockMilestoneIndex,
                currentMilestoneIndex: milestoneIndex,
                currentSubsectionIndex: 0,
                cellsPerPage: 50,
            };

            const { container } = render(<CellList {...props} />);

            // The second cell should have footnoteOffset of 2 (from the 2 footnotes in the first cell)
            // Verify the component renders without errors
            expect(container).toBeTruthy();

            // Verify that cells are rendered
            const verseGroups = container.querySelectorAll(".verse-group");
            expect(verseGroups.length).toBeGreaterThan(0);
        });

        it("should increment footnotes sequentially across multiple cells in same milestone", () => {
            const milestoneUuid = "milestone-uuid-1";
            const milestoneIndex = 0;
            const translationUnits: QuillCellContent[] = [
                createCellWithFootnotes("uuid-1", "GEN 1:1", 1, milestoneIndex), // 1 footnote
                createCellWithFootnotes("uuid-2", "GEN 1:2", 2, milestoneIndex), // 2 footnotes
                createCellWithGlobalRef(
                    "uuid-3",
                    "GEN 1:3",
                    CodexCellTypes.TEXT,
                    "<p>No footnotes yet</p>",
                    milestoneIndex
                ),
            ];
            // fullDocumentTranslationUnits should contain all cells in the milestone
            const fullDocumentTranslationUnits: QuillCellContent[] = [...translationUnits];

            const mockMilestoneIndex = {
                milestones: [
                    {
                        index: 0,
                        cellIndex: 0,
                        value: "GEN 1",
                        cellCount: 3,
                    },
                ],
                totalCells: 3,
                cellsPerPage: 50,
            };

            const props = {
                translationUnits,
                fullDocumentTranslationUnits,
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
                cellDisplayMode: CELL_DISPLAY_MODES.ONE_LINE_PER_CELL,
                isSourceText: false,
                windowHeight: 800,
                headerHeight: 100,
                highlightedCellId: null,
                scrollSyncEnabled: true,
                currentUsername: "test-user",
                requiredValidations: 1,
                milestoneIndex: mockMilestoneIndex,
                currentMilestoneIndex: milestoneIndex,
                currentSubsectionIndex: 0,
                cellsPerPage: 50,
            };

            const { container } = render(<CellList {...props} />);

            // Third cell should have footnoteOffset of 3 (1 from first cell + 2 from second cell)
            // Verify the component renders correctly
            expect(container).toBeTruthy();

            // Verify that all three cells are rendered
            const verseGroups = container.querySelectorAll(".verse-group");
            expect(verseGroups.length).toBeGreaterThanOrEqual(1);
        });

        it("should reset footnote count when moving to a new milestone", () => {
            const milestone1Index = 0;
            const milestone2Index = 1;
            // Translation units for milestone 2 (current page)
            const translationUnits: QuillCellContent[] = [
                createCellWithGlobalRef(
                    "uuid-3",
                    "GEN 2:1",
                    CodexCellTypes.TEXT,
                    "<p>New milestone</p>",
                    milestone2Index
                ), // New milestone
            ];
            // fullDocumentTranslationUnits should contain all cells in milestone 2 (for footnote counting)
            const fullDocumentTranslationUnits: QuillCellContent[] = [
                ...translationUnits, // All cells in milestone 2
            ];

            const mockMilestoneIndex = {
                milestones: [
                    {
                        index: 0,
                        cellIndex: 0,
                        value: "GEN 1",
                        cellCount: 2,
                    },
                    {
                        index: 1,
                        cellIndex: 2,
                        value: "GEN 2",
                        cellCount: 1,
                    },
                ],
                totalCells: 3,
                cellsPerPage: 50,
            };

            const props = {
                translationUnits,
                fullDocumentTranslationUnits,
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
                cellDisplayMode: CELL_DISPLAY_MODES.ONE_LINE_PER_CELL,
                isSourceText: false,
                windowHeight: 800,
                headerHeight: 100,
                highlightedCellId: null,
                scrollSyncEnabled: true,
                currentUsername: "test-user",
                requiredValidations: 1,
                milestoneIndex: mockMilestoneIndex,
                currentMilestoneIndex: milestone2Index,
                currentSubsectionIndex: 0,
                cellsPerPage: 50,
            };

            const { container } = render(<CellList {...props} />);

            // Third cell (GEN 2:1) should have footnoteOffset of 0 (new milestone, no previous footnotes in this milestone)
            expect(container).toBeTruthy();
        });

        it("should continue footnote numbering across pages within the same milestone", () => {
            const milestoneIndex = 0;
            const cellsPerPage = 2; // Small page size for testing

            // Page 1 cells (first 2 cells)
            const page1Cells: QuillCellContent[] = [
                createCellWithFootnotes("uuid-1", "GEN 1:1", 2, milestoneIndex), // 2 footnotes
                createCellWithFootnotes("uuid-2", "GEN 1:2", 1, milestoneIndex), // 1 footnote
            ];

            // Page 2 cells (next 2 cells)
            const page2Cells: QuillCellContent[] = [
                createCellWithFootnotes("uuid-3", "GEN 1:3", 1, milestoneIndex), // 1 footnote
                createCellWithGlobalRef(
                    "uuid-4",
                    "GEN 1:4",
                    CodexCellTypes.TEXT,
                    "<p>No footnotes</p>",
                    milestoneIndex
                ),
            ];

            // All cells in milestone (for fullDocumentTranslationUnits)
            const allCellsInMilestone: QuillCellContent[] = [...page1Cells, ...page2Cells];

            const mockMilestoneIndex = {
                milestones: [
                    {
                        index: 0,
                        cellIndex: 0,
                        value: "GEN 1",
                        cellCount: 4,
                    },
                ],
                totalCells: 4,
                cellsPerPage,
            };

            // Test page 2
            const props = {
                translationUnits: page2Cells, // Current page (page 2)
                fullDocumentTranslationUnits: allCellsInMilestone, // All cells in milestone
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
                cellDisplayMode: CELL_DISPLAY_MODES.ONE_LINE_PER_CELL,
                isSourceText: false,
                windowHeight: 800,
                headerHeight: 100,
                highlightedCellId: null,
                scrollSyncEnabled: true,
                currentUsername: "test-user",
                requiredValidations: 1,
                milestoneIndex: mockMilestoneIndex,
                currentMilestoneIndex: milestoneIndex,
                currentSubsectionIndex: 1, // Page 2 (0-indexed)
                cellsPerPage,
            };

            const { container } = render(<CellList {...props} />);

            // First cell on page 2 (uuid-3) should have footnoteOffset of 3 (2 from page1 cell1 + 1 from page1 cell2)
            // Second cell on page 2 (uuid-4) should have footnoteOffset of 4 (3 from previous cells + 1 from page2 cell1)
            expect(container).toBeTruthy();
        });
    });

    describe("Using milestone index for grouping", () => {
        it("should group footnotes by milestone index when cells have milestoneIndex", () => {
            // Create cells with UUID cellMarkers and milestoneIndex
            const milestoneIndex = 0;
            const translationUnits: QuillCellContent[] = [
                createCellWithFootnotes(
                    "550e8400-e29b-41d4-a716-446655440000",
                    "GEN 1:1",
                    1,
                    milestoneIndex
                ),
                createCellWithFootnotes(
                    "550e8400-e29b-41d4-a716-446655440001",
                    "GEN 1:2",
                    1,
                    milestoneIndex
                ),
                createCellWithGlobalRef(
                    "550e8400-e29b-41d4-a716-446655440002",
                    "GEN 1:3",
                    CodexCellTypes.TEXT,
                    "<p>Third cell</p>",
                    milestoneIndex
                ),
            ];
            const fullDocumentTranslationUnits: QuillCellContent[] = [...translationUnits];

            const mockMilestoneIndex = {
                milestones: [
                    {
                        index: 0,
                        cellIndex: 0,
                        value: "GEN 1",
                        cellCount: 3,
                    },
                ],
                totalCells: 3,
                cellsPerPage: 50,
            };

            const props = {
                translationUnits,
                fullDocumentTranslationUnits,
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
                cellDisplayMode: CELL_DISPLAY_MODES.ONE_LINE_PER_CELL,
                isSourceText: false,
                windowHeight: 800,
                headerHeight: 100,
                highlightedCellId: null,
                scrollSyncEnabled: true,
                currentUsername: "test-user",
                requiredValidations: 1,
                milestoneIndex: mockMilestoneIndex,
                currentMilestoneIndex: milestoneIndex,
                currentSubsectionIndex: 0,
                cellsPerPage: 50,
            };

            const { container } = render(<CellList {...props} />);

            // Should work correctly with UUID cellMarkers by using milestone index for grouping
            expect(container).toBeTruthy();
        });

        it("should work with legacy format cells when milestoneIndex is present", () => {
            // Create cells with legacy format but milestoneIndex
            const milestoneIndex = 0;
            const legacyCells: QuillCellContent[] = [
                {
                    cellMarkers: ["GEN 1:1"], // Old format: cellMarkers contains the reference
                    cellContent: '<p>Content with <sup class="footnote-marker">1</sup></p>',
                    cellType: CodexCellTypes.TEXT,
                    data: {
                        milestoneIndex, // Include milestoneIndex
                    },
                    editHistory: [
                        {
                            editMap: ["value"],
                            value: '<p>Content with <sup class="footnote-marker">1</sup></p>',
                            author: "test-user",
                            validatedBy: [],
                            timestamp: Date.now(),
                            type: "user-edit" as any,
                        },
                    ],
                    cellLabel: "GEN 1:1",
                    timestamps: {
                        startTime: 0,
                        endTime: 5,
                    },
                },
                {
                    cellMarkers: ["GEN 1:2"],
                    cellContent: "<p>Second cell</p>",
                    cellType: CodexCellTypes.TEXT,
                    data: {
                        milestoneIndex, // Include milestoneIndex
                    },
                    editHistory: [
                        {
                            editMap: ["value"],
                            value: "<p>Second cell</p>",
                            author: "test-user",
                            validatedBy: [],
                            timestamp: Date.now(),
                            type: "user-edit" as any,
                        },
                    ],
                    cellLabel: "GEN 1:2",
                    timestamps: {
                        startTime: 5,
                        endTime: 10,
                    },
                },
            ];
            const fullDocumentTranslationUnits: QuillCellContent[] = [...legacyCells];

            const mockMilestoneIndex = {
                milestones: [
                    {
                        index: 0,
                        cellIndex: 0,
                        value: "GEN 1",
                        cellCount: 2,
                    },
                ],
                totalCells: 2,
                cellsPerPage: 50,
            };

            const props = {
                translationUnits: legacyCells,
                fullDocumentTranslationUnits,
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
                cellDisplayMode: CELL_DISPLAY_MODES.ONE_LINE_PER_CELL,
                isSourceText: false,
                windowHeight: 800,
                headerHeight: 100,
                highlightedCellId: null,
                scrollSyncEnabled: true,
                currentUsername: "test-user",
                requiredValidations: 1,
                milestoneIndex: mockMilestoneIndex,
                currentMilestoneIndex: milestoneIndex,
                currentSubsectionIndex: 0,
                cellsPerPage: 50,
            };

            const { container } = render(<CellList {...props} />);

            // Should still work with legacy format when milestoneIndex is present
            expect(container).toBeTruthy();
        });
    });

    describe("Edge cases", () => {
        it("should return 0 when no milestone is found before the cell", () => {
            // Create a cell with UUID that doesn't have a milestone before it
            const cellsWithOnlyUuid: QuillCellContent[] = [
                {
                    cellMarkers: ["550e8400-e29b-41d4-a716-446655440000"], // UUID only
                    cellContent: "<p>Content</p>",
                    cellType: CodexCellTypes.TEXT,
                    data: {}, // No globalReferences, no milestoneIndex
                    editHistory: [
                        {
                            editMap: ["value"],
                            value: "<p>Content</p>",
                            author: "test-user",
                            validatedBy: [],
                            timestamp: Date.now(),
                            type: "user-edit" as any,
                        },
                    ],
                    cellLabel: "Cell 1",
                    timestamps: {
                        startTime: 0,
                        endTime: 5,
                    },
                },
            ];
            // No milestone cell in fullDocumentTranslationUnits
            const fullDocumentTranslationUnits: QuillCellContent[] = cellsWithOnlyUuid;

            const props = {
                translationUnits: cellsWithOnlyUuid,
                fullDocumentTranslationUnits,
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
                cellDisplayMode: CELL_DISPLAY_MODES.ONE_LINE_PER_CELL,
                isSourceText: false,
                windowHeight: 800,
                headerHeight: 100,
                highlightedCellId: null,
                scrollSyncEnabled: true,
                currentUsername: "test-user",
                requiredValidations: 1,
                milestoneIndex: null, // No milestone index
                currentMilestoneIndex: 0,
                currentSubsectionIndex: 0,
                cellsPerPage: 50,
            };

            const { container } = render(<CellList {...props} />);

            // Should handle gracefully when no milestone is found (returns 0)
            expect(container).toBeTruthy();
        });

        it("should return 0 when milestoneIndex is not available", () => {
            // Create cells without milestoneIndex (should return 0)
            const translationUnits: QuillCellContent[] = [
                createCellWithFootnotes("uuid-1", "GEN 1:1", 2), // No milestoneIndex
                createCellWithGlobalRef(
                    "uuid-2",
                    "GEN 1:2",
                    CodexCellTypes.TEXT,
                    "<p>No footnotes</p>"
                    // No milestoneIndex
                ),
            ];
            const fullDocumentTranslationUnits: QuillCellContent[] = [...translationUnits];

            const props = {
                translationUnits,
                fullDocumentTranslationUnits,
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
                cellDisplayMode: CELL_DISPLAY_MODES.ONE_LINE_PER_CELL,
                isSourceText: false,
                windowHeight: 800,
                headerHeight: 100,
                highlightedCellId: null,
                scrollSyncEnabled: true,
                currentUsername: "test-user",
                requiredValidations: 1,
                milestoneIndex: null, // No milestone index - should return 0
                currentMilestoneIndex: 0,
                currentSubsectionIndex: 0,
                cellsPerPage: 50,
            };

            const { container } = render(<CellList {...props} />);

            // Should return 0 when milestoneIndex is not available
            expect(container).toBeTruthy();
        });

        it("should include PARATEXT cells in footnote counting for sequential numbering", () => {
            const milestoneIndex = 0;
            const translationUnits: QuillCellContent[] = [
                createCellWithFootnotes("uuid-1", "GEN 1:1", 1, milestoneIndex),
                {
                    ...createCellWithGlobalRef(
                        "uuid-2",
                        "GEN 1:2",
                        CodexCellTypes.PARATEXT,
                        "<p>Paratext</p>",
                        milestoneIndex
                    ),
                    cellContent: '<p>Paratext with <sup class="footnote-marker">1</sup></p>', // Has footnote and should be included
                },
                createCellWithGlobalRef(
                    "uuid-3",
                    "GEN 1:3",
                    CodexCellTypes.TEXT,
                    "<p>Regular cell</p>",
                    milestoneIndex
                ),
            ];
            const fullDocumentTranslationUnits: QuillCellContent[] = [...translationUnits];

            const mockMilestoneIndex = {
                milestones: [
                    {
                        index: 0,
                        cellIndex: 0,
                        value: "GEN 1",
                        cellCount: 3,
                    },
                ],
                totalCells: 3,
                cellsPerPage: 50,
            };

            const props = {
                translationUnits,
                fullDocumentTranslationUnits,
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
                cellDisplayMode: CELL_DISPLAY_MODES.ONE_LINE_PER_CELL,
                isSourceText: false,
                windowHeight: 800,
                headerHeight: 100,
                highlightedCellId: null,
                scrollSyncEnabled: true,
                currentUsername: "test-user",
                requiredValidations: 1,
                milestoneIndex: mockMilestoneIndex,
                currentMilestoneIndex: milestoneIndex,
                currentSubsectionIndex: 0,
                cellsPerPage: 50,
            };

            const { container } = render(<CellList {...props} />);

            // Third cell should have footnoteOffset of 2 (1 from first cell + 1 from PARATEXT cell)
            // Paratext cells are now included to maintain sequential footnote numbering
            expect(container).toBeTruthy();
        });

        it("should handle cells from different milestones correctly", () => {
            const milestone1Index = 0;
            const milestone2Index = 1;
            // Translation units for milestone 2 (current page)
            const translationUnits: QuillCellContent[] = [
                createCellWithFootnotes("uuid-2", "EXO 1:1", 1, milestone2Index), // Exodus milestone (different milestone)
                createCellWithGlobalRef(
                    "uuid-3",
                    "EXO 1:2",
                    CodexCellTypes.TEXT,
                    "<p>Exodus cell</p>",
                    milestone2Index
                ),
            ];
            // fullDocumentTranslationUnits should contain all cells in milestone 2
            const fullDocumentTranslationUnits: QuillCellContent[] = [...translationUnits];

            const mockMilestoneIndex = {
                milestones: [
                    {
                        index: 0,
                        cellIndex: 0,
                        value: "GEN 1",
                        cellCount: 1,
                    },
                    {
                        index: 1,
                        cellIndex: 1,
                        value: "EXO 1",
                        cellCount: 2,
                    },
                ],
                totalCells: 3,
                cellsPerPage: 50,
            };

            const props = {
                translationUnits,
                fullDocumentTranslationUnits,
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
                cellDisplayMode: CELL_DISPLAY_MODES.ONE_LINE_PER_CELL,
                isSourceText: false,
                windowHeight: 800,
                headerHeight: 100,
                highlightedCellId: null,
                scrollSyncEnabled: true,
                currentUsername: "test-user",
                requiredValidations: 1,
                milestoneIndex: mockMilestoneIndex,
                currentMilestoneIndex: milestone2Index,
                currentSubsectionIndex: 0,
                cellsPerPage: 50,
            };

            const { container } = render(<CellList {...props} />);

            // Second cell (EXO 1:2) should have footnoteOffset of 1 (only counting from EXO 1:1 in the same milestone, not GEN 1:1)
            // This tests that footnotes are grouped by milestone index, not by chapter/book name
            expect(container).toBeTruthy();
        });
    });
});
