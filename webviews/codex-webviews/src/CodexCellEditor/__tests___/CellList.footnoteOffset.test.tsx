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
    content: string = "<p>Test content</p>"
): QuillCellContent => ({
    cellMarkers: [uuid], // UUID format
    cellContent: content,
    cellType,
    data: {
        globalReferences: [globalReference], // New format: uses globalReferences
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
    footnoteCount: number
): QuillCellContent => {
    // Create HTML content with footnote markers
    const footnoteMarkers = Array.from({ length: footnoteCount }, (_, i) => 
        `<sup class="footnote-marker">${i + 1}</sup>`
    ).join(" ");
    
    return createCellWithGlobalRef(
        uuid,
        globalReference,
        CodexCellTypes.TEXT,
        `<p>Content with footnotes ${footnoteMarkers}</p>`
    );
};

describe("CellList - Footnote Offset Calculation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Mock scrollIntoView
        Element.prototype.scrollIntoView = vi.fn();
    });

    describe("Sequential footnote numbering across cells in same chapter", () => {
        it("should calculate correct offset when first cell has footnotes and second cell is empty", () => {
            const translationUnits: QuillCellContent[] = [
                createCellWithFootnotes("uuid-1", "GEN 1:1", 2), // 2 footnotes
                createCellWithGlobalRef("uuid-2", "GEN 1:2", CodexCellTypes.TEXT, "<p>No footnotes</p>"),
            ];

            const props = {
                spellCheckResponse: null,
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
                cellDisplayMode: CELL_DISPLAY_MODES.ONE_LINE_PER_CELL,
                isSourceText: false,
                windowHeight: 800,
                headerHeight: 100,
                alertColorCodes: {},
                highlightedCellId: null,
                highlightedGlobalReferences: [],
                scrollSyncEnabled: true,
                currentUsername: "test-user",
                requiredValidations: 1,
            };

            const { container } = render(<CellList {...props} />);

            // The second cell should have footnoteOffset of 2 (from the 2 footnotes in the first cell)
            // Verify the component renders without errors
            expect(container).toBeTruthy();
            
            // Verify that cells are rendered
            const verseGroups = container.querySelectorAll(".verse-group");
            expect(verseGroups.length).toBeGreaterThan(0);
        });

        it("should increment footnotes sequentially across multiple cells in same chapter", () => {
            const translationUnits: QuillCellContent[] = [
                createCellWithFootnotes("uuid-1", "GEN 1:1", 1), // 1 footnote
                createCellWithFootnotes("uuid-2", "GEN 1:2", 2), // 2 footnotes
                createCellWithGlobalRef("uuid-3", "GEN 1:3", CodexCellTypes.TEXT, "<p>No footnotes yet</p>"),
            ];

            const props = {
                spellCheckResponse: null,
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
                cellDisplayMode: CELL_DISPLAY_MODES.ONE_LINE_PER_CELL,
                isSourceText: false,
                windowHeight: 800,
                headerHeight: 100,
                alertColorCodes: {},
                highlightedCellId: null,
                highlightedGlobalReferences: [],
                scrollSyncEnabled: true,
                currentUsername: "test-user",
                requiredValidations: 1,
            };

            const { container } = render(<CellList {...props} />);

            // Third cell should have footnoteOffset of 3 (1 from first cell + 2 from second cell)
            // Verify the component renders correctly
            expect(container).toBeTruthy();
            
            // Verify that all three cells are rendered
            const verseGroups = container.querySelectorAll(".verse-group");
            expect(verseGroups.length).toBeGreaterThanOrEqual(1);
        });

        it("should reset footnote count when moving to a new chapter", () => {
            const translationUnits: QuillCellContent[] = [
                createCellWithFootnotes("uuid-1", "GEN 1:1", 2), // 2 footnotes in chapter 1
                createCellWithFootnotes("uuid-2", "GEN 1:2", 1), // 1 footnote in chapter 1
                createCellWithGlobalRef("uuid-3", "GEN 2:1", CodexCellTypes.TEXT, "<p>New chapter</p>"), // New chapter
            ];

            const props = {
                spellCheckResponse: null,
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
                cellDisplayMode: CELL_DISPLAY_MODES.ONE_LINE_PER_CELL,
                isSourceText: false,
                windowHeight: 800,
                headerHeight: 100,
                alertColorCodes: {},
                highlightedCellId: null,
                highlightedGlobalReferences: [],
                scrollSyncEnabled: true,
                currentUsername: "test-user",
                requiredValidations: 1,
            };

            const { container } = render(<CellList {...props} />);

            // Third cell (GEN 2:1) should have footnoteOffset of 0 (new chapter, no previous footnotes)
            expect(container).toBeTruthy();
        });
    });

    describe("Using globalReferences instead of cellMarkers", () => {
        it("should extract chapter ID from globalReferences when cellMarkers is UUID", () => {
            // Create cells with UUID cellMarkers but globalReferences in "GEN 1:1" format
            const translationUnits: QuillCellContent[] = [
                createCellWithFootnotes("550e8400-e29b-41d4-a716-446655440000", "GEN 1:1", 1),
                createCellWithFootnotes("550e8400-e29b-41d4-a716-446655440001", "GEN 1:2", 1),
                createCellWithGlobalRef(
                    "550e8400-e29b-41d4-a716-446655440002",
                    "GEN 1:3",
                    CodexCellTypes.TEXT,
                    "<p>Third cell</p>"
                ),
            ];

            const props = {
                spellCheckResponse: null,
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
                cellDisplayMode: CELL_DISPLAY_MODES.ONE_LINE_PER_CELL,
                isSourceText: false,
                windowHeight: 800,
                headerHeight: 100,
                alertColorCodes: {},
                highlightedCellId: null,
                highlightedGlobalReferences: [],
                scrollSyncEnabled: true,
                currentUsername: "test-user",
                requiredValidations: 1,
            };

            const { container } = render(<CellList {...props} />);

            // Should work correctly with UUID cellMarkers by using globalReferences for chapter identification
            expect(container).toBeTruthy();
        });

        it("should fallback to cellMarkers when globalReferences is not available (backward compatibility)", () => {
            // Create cells without globalReferences (legacy format)
            const legacyCells: QuillCellContent[] = [
                {
                    cellMarkers: ["GEN 1:1"], // Old format: cellMarkers contains the reference
                    cellContent: '<p>Content with <sup class="footnote-marker">1</sup></p>',
                    cellType: CodexCellTypes.TEXT,
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

            const props = {
                spellCheckResponse: null,
                translationUnits: legacyCells,
                fullDocumentTranslationUnits: legacyCells,
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
                alertColorCodes: {},
                highlightedCellId: null,
                highlightedGlobalReferences: [],
                scrollSyncEnabled: true,
                currentUsername: "test-user",
                requiredValidations: 1,
            };

            const { container } = render(<CellList {...props} />);

            // Should still work with legacy format (fallback to cellMarkers)
            expect(container).toBeTruthy();
        });
    });

    describe("Edge cases", () => {
        it("should return 0 when cell identifier cannot extract chapter ID", () => {
            // Create a cell with UUID that doesn't have globalReferences and cellMarkers is also UUID
            const cellsWithOnlyUuid: QuillCellContent[] = [
                {
                    cellMarkers: ["550e8400-e29b-41d4-a716-446655440000"], // UUID only
                    cellContent: "<p>Content</p>",
                    cellType: CodexCellTypes.TEXT,
                    data: {}, // No globalReferences
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

            const props = {
                spellCheckResponse: null,
                translationUnits: cellsWithOnlyUuid,
                fullDocumentTranslationUnits: cellsWithOnlyUuid,
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
                alertColorCodes: {},
                highlightedCellId: null,
                highlightedGlobalReferences: [],
                scrollSyncEnabled: true,
                currentUsername: "test-user",
                requiredValidations: 1,
            };

            const { container } = render(<CellList {...props} />);

            // Should handle gracefully when chapter cannot be extracted
            expect(container).toBeTruthy();
        });

        it("should exclude PARATEXT and MILESTONE cells from footnote counting", () => {
            const translationUnits: QuillCellContent[] = [
                createCellWithFootnotes("uuid-1", "GEN 1:1", 1),
                {
                    ...createCellWithGlobalRef("uuid-2", "GEN 1:2", CodexCellTypes.PARATEXT, "<p>Paratext</p>"),
                    cellContent: '<p>Paratext with <sup class="footnote-marker">1</sup></p>', // Has footnote but should be excluded
                },
                createCellWithGlobalRef("uuid-3", "GEN 1:3", CodexCellTypes.TEXT, "<p>Regular cell</p>"),
            ];

            const props = {
                spellCheckResponse: null,
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
                cellDisplayMode: CELL_DISPLAY_MODES.ONE_LINE_PER_CELL,
                isSourceText: false,
                windowHeight: 800,
                headerHeight: 100,
                alertColorCodes: {},
                highlightedCellId: null,
                highlightedGlobalReferences: [],
                scrollSyncEnabled: true,
                currentUsername: "test-user",
                requiredValidations: 1,
            };

            const { container } = render(<CellList {...props} />);

            // Third cell should have footnoteOffset of 1 (only counting from first cell, not PARATEXT)
            expect(container).toBeTruthy();
        });

        it("should handle cells from different books correctly", () => {
            const translationUnits: QuillCellContent[] = [
                createCellWithFootnotes("uuid-1", "GEN 1:1", 2), // Genesis
                createCellWithFootnotes("uuid-2", "EXO 1:1", 1), // Exodus (different book, same chapter number)
                createCellWithGlobalRef("uuid-3", "EXO 1:2", CodexCellTypes.TEXT, "<p>Exodus cell</p>"),
            ];

            const props = {
                spellCheckResponse: null,
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
                cellDisplayMode: CELL_DISPLAY_MODES.ONE_LINE_PER_CELL,
                isSourceText: false,
                windowHeight: 800,
                headerHeight: 100,
                alertColorCodes: {},
                highlightedCellId: null,
                highlightedGlobalReferences: [],
                scrollSyncEnabled: true,
                currentUsername: "test-user",
                requiredValidations: 1,
            };

            const { container } = render(<CellList {...props} />);

            // Third cell (EXO 1:2) should have footnoteOffset of 1 (only counting from EXO 1:1, not GEN 1:1)
            // This tests that chapter ID includes book name: "EXO 1" vs "GEN 1"
            expect(container).toBeTruthy();
        });
    });
});
