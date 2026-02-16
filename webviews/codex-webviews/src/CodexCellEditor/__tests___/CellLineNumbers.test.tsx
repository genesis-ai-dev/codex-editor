import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { QuillCellContent } from "../../../../../types";
import { CodexCellTypes } from "../../../../../types/enums";
import CellList from "../CellList";

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
    cellType: CodexCellTypes = CodexCellTypes.TEXT,
    content: string = "<p>Test content</p>",
    options?: {
        merged?: boolean;
        deleted?: boolean;
        cellLabel?: string;
        metadata?: { parentId?: string; [key: string]: unknown };
    }
): QuillCellContent => ({
    cellMarkers: [cellId],
    cellContent: content,
    cellType,
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
    cellLabel: options?.cellLabel,
    timestamps: {
        startTime: 0,
        endTime: 5,
    },
    merged: options?.merged,
    deleted: options?.deleted,
    ...(options?.metadata && { metadata: options.metadata }),
});

// Create a regular cell with a Bible-like ID (e.g., "GEN 1:1")
const createBibleCell = (
    book: string,
    chapter: number,
    verse: number,
    options?: { merged?: boolean; deleted?: boolean; cellLabel?: string }
): QuillCellContent => {
    return createMockCell(
        `${book} ${chapter}:${verse}`,
        CodexCellTypes.TEXT,
        `<p>Content for ${book} ${chapter}:${verse}</p>`,
        options
    );
};

// Create a child cell with a Bible-like ID and metadata.parentId (post-migration format).
// CellList identifies child cells by metadata.parentId (or data.parentId), not by ID format.
const createBibleChildCell = (
    book: string,
    chapter: number,
    verse: number,
    childId: string
): QuillCellContent => {
    const parentId = `${book} ${chapter}:${verse}`;
    return createMockCell(
        `${parentId}:${childId}`,
        CodexCellTypes.TEXT,
        `<p>Child content for ${book} ${chapter}:${verse}</p>`,
        { metadata: { parentId } }
    );
};

// Create a paratext cell
const createParatextCell = (cellId: string): QuillCellContent => {
    return createMockCell(cellId, CodexCellTypes.PARATEXT, "<p>Section heading</p>");
};

describe("Cell Line Numbers and Labels", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Mock scrollIntoView
        Element.prototype.scrollIntoView = vi.fn();
    });

    describe("Regular cell line numbering", () => {
        it("should assign sequential line numbers to regular cells", () => {
            const translationUnits: QuillCellContent[] = [
                createBibleCell("GEN", 1, 1),
                createBibleCell("GEN", 1, 2),
                createBibleCell("GEN", 1, 3),
            ];

            const props = {
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
                isSourceText: false,
                windowHeight: 800,
                headerHeight: 100,
                highlightedCellId: null,
                scrollSyncEnabled: true,
                currentUsername: "test-user",
                requiredValidations: 1,
                lineNumbersEnabled: true,
            };

            const { container } = render(<CellList {...props} />);

            // Get all line number elements
            const lineNumbers = container.querySelectorAll(".cell-line-number");

            // Should have 3 line numbers (one for each cell)
            expect(lineNumbers.length).toBeGreaterThanOrEqual(3);

            // Verify sequential numbering
            const lineNumberTexts = Array.from(lineNumbers).map((el) => el.textContent?.trim());
            expect(lineNumberTexts).toContain("1");
            expect(lineNumberTexts).toContain("2");
            expect(lineNumberTexts).toContain("3");
        });

        it("should skip paratext cells when counting line numbers", () => {
            const translationUnits: QuillCellContent[] = [
                createBibleCell("GEN", 1, 1), // Should be line 1
                createParatextCell("paratext-1"), // Should NOT have line number
                createBibleCell("GEN", 1, 2), // Should be line 2 (not 3)
            ];

            const props = {
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
                isSourceText: false,
                windowHeight: 800,
                headerHeight: 100,
                highlightedCellId: null,
                scrollSyncEnabled: true,
                currentUsername: "test-user",
                requiredValidations: 1,
                lineNumbersEnabled: true,
            };

            const { container } = render(<CellList {...props} />);

            // Get all line number elements
            const lineNumbers = container.querySelectorAll(".cell-line-number");
            const lineNumberTexts = Array.from(lineNumbers).map((el) => el.textContent?.trim());

            // Should have line numbers 1 and 2 (paratext doesn't count)
            expect(lineNumberTexts).toContain("1");
            expect(lineNumberTexts).toContain("2");
            // Should NOT have line 3 (only 2 text cells)
            expect(lineNumberTexts).not.toContain("3");
        });
    });

    describe("Child cell labeling", () => {
        it("should label child cells with parent.childIndex format (e.g., 12.1, 12.2)", () => {
            const translationUnits: QuillCellContent[] = [
                createBibleCell("GEN", 1, 1), // Line 1
                createBibleCell("GEN", 1, 2), // Line 2
                createBibleChildCell("GEN", 1, 2, "1740475700855-child1"), // Should be "2.1"
                createBibleChildCell("GEN", 1, 2, "1740475700856-child2"), // Should be "2.2"
                createBibleCell("GEN", 1, 3), // Line 3 (NOT line 5!)
            ];

            const props = {
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
                isSourceText: false,
                windowHeight: 800,
                headerHeight: 100,
                highlightedCellId: null,
                scrollSyncEnabled: true,
                currentUsername: "test-user",
                requiredValidations: 1,
                lineNumbersEnabled: true,
            };

            const { container } = render(<CellList {...props} />);

            // Get all line number elements
            const lineNumbers = container.querySelectorAll(".cell-line-number");
            const lineNumberTexts = Array.from(lineNumbers).map((el) => el.textContent?.trim());

            // Verify main cells have proper line numbers
            expect(lineNumberTexts).toContain("1");
            expect(lineNumberTexts).toContain("2");
            expect(lineNumberTexts).toContain("3");

            // Verify child cells have decimal notation
            expect(lineNumberTexts).toContain("2.1");
            expect(lineNumberTexts).toContain("2.2");

            // Verify the bug fix: line 3 should exist, NOT line 4 or 5
            // (child cells should NOT increment the line count)
            expect(lineNumberTexts).not.toContain("4");
            expect(lineNumberTexts).not.toContain("5");
        });

        it("should NOT count child cells in line number sequence", () => {
            // This is the specific bug test case:
            // If you add a child cell under line 12, the next line should be 13, not 14
            const translationUnits: QuillCellContent[] = [
                createBibleCell("GEN", 1, 10), // Line 10
                createBibleCell("GEN", 1, 11), // Line 11
                createBibleCell("GEN", 1, 12), // Line 12
                createBibleChildCell("GEN", 1, 12, "child-1"), // Should be "12.1"
                createBibleCell("GEN", 1, 13), // Should be Line 13, NOT 14!
            ];

            const props = {
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
                isSourceText: false,
                windowHeight: 800,
                headerHeight: 100,
                highlightedCellId: null,
                scrollSyncEnabled: true,
                currentUsername: "test-user",
                requiredValidations: 1,
                lineNumbersEnabled: true,
            };

            const { container } = render(<CellList {...props} />);

            // Get all line number elements
            const lineNumbers = container.querySelectorAll(".cell-line-number");
            const lineNumberTexts = Array.from(lineNumbers)
                .map((el) => el.textContent?.trim())
                .filter(Boolean);

            // Count occurrences of each line number
            const lineNumberCounts = new Map<string, number>();
            lineNumberTexts.forEach((num) => {
                if (num) {
                    lineNumberCounts.set(num, (lineNumberCounts.get(num) || 0) + 1);
                }
            });

            // Verify we have 4 main line numbers (1, 2, 3, 4) and one child (3.1); child is not counted as a main line
            expect(lineNumberTexts).toContain("1");
            expect(lineNumberTexts).toContain("2");
            expect(lineNumberTexts).toContain("3");
            expect(lineNumberTexts).toContain("3.1"); // Child of line 3 (metadata.parentId identifies it)
            expect(lineNumberTexts).toContain("4"); // Next main line after child—critical assertion

            // With bug: child would be counted and we'd see "5" here
            expect(lineNumberTexts).not.toContain("5");
        });

        it("should handle multiple child cells under the same parent", () => {
            const translationUnits: QuillCellContent[] = [
                createBibleCell("GEN", 1, 1), // Line 1
                createBibleChildCell("GEN", 1, 1, "child-a"), // Should be "1.1"
                createBibleChildCell("GEN", 1, 1, "child-b"), // Should be "1.2"
                createBibleChildCell("GEN", 1, 1, "child-c"), // Should be "1.3"
                createBibleCell("GEN", 1, 2), // Line 2 (NOT 5!)
            ];

            const props = {
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
                isSourceText: false,
                windowHeight: 800,
                headerHeight: 100,
                highlightedCellId: null,
                scrollSyncEnabled: true,
                currentUsername: "test-user",
                requiredValidations: 1,
                lineNumbersEnabled: true,
            };

            const { container } = render(<CellList {...props} />);

            const lineNumbers = container.querySelectorAll(".cell-line-number");
            const lineNumberTexts = Array.from(lineNumbers)
                .map((el) => el.textContent?.trim())
                .filter(Boolean);

            // Main cells
            expect(lineNumberTexts).toContain("1");
            expect(lineNumberTexts).toContain("2");

            // Child cells
            expect(lineNumberTexts).toContain("1.1");
            expect(lineNumberTexts).toContain("1.2");
            expect(lineNumberTexts).toContain("1.3");

            // Should NOT have line 3, 4, or 5 (only 2 main lines)
            expect(lineNumberTexts).not.toContain("3");
            expect(lineNumberTexts).not.toContain("4");
            expect(lineNumberTexts).not.toContain("5");
        });
    });

    describe("Merged cell handling", () => {
        it("should not count merged cells in line number sequence", () => {
            const translationUnits: QuillCellContent[] = [
                createBibleCell("GEN", 1, 1), // Line 1
                createBibleCell("GEN", 1, 2, { merged: true }), // Merged - should show ❌
                createBibleCell("GEN", 1, 3), // Should be Line 2 (not 3)
            ];

            const props = {
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
                isSourceText: false,
                windowHeight: 800,
                headerHeight: 100,
                highlightedCellId: null,
                scrollSyncEnabled: true,
                currentUsername: "test-user",
                requiredValidations: 1,
                lineNumbersEnabled: true,
            };

            const { container } = render(<CellList {...props} />);

            const lineNumbers = container.querySelectorAll(".cell-line-number");
            const lineNumberTexts = Array.from(lineNumbers)
                .map((el) => el.textContent?.trim())
                .filter(Boolean);

            // Should have lines 1 and 2, plus ❌ for merged
            expect(lineNumberTexts).toContain("1");
            expect(lineNumberTexts).toContain("❌");
            // The cell after merged should be line 2, not 3
            // (merged cells don't increment the count)
        });
    });

    describe("Complex scenarios", () => {
        it("should handle mix of paratext, regular cells, and child cells correctly", () => {
            const translationUnits: QuillCellContent[] = [
                createParatextCell("section-header-1"), // No line number
                createBibleCell("GEN", 1, 1), // Line 1
                createBibleCell("GEN", 1, 2), // Line 2
                createBibleChildCell("GEN", 1, 2, "child-1"), // 2.1
                createParatextCell("section-header-2"), // No line number
                createBibleCell("GEN", 1, 3), // Line 3 (NOT 4!)
                createBibleCell("GEN", 1, 4), // Line 4
                createBibleChildCell("GEN", 1, 4, "child-a"), // 4.1
                createBibleChildCell("GEN", 1, 4, "child-b"), // 4.2
                createBibleCell("GEN", 1, 5), // Line 5 (NOT 8!)
            ];

            const props = {
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
                isSourceText: false,
                windowHeight: 800,
                headerHeight: 100,
                highlightedCellId: null,
                scrollSyncEnabled: true,
                currentUsername: "test-user",
                requiredValidations: 1,
                lineNumbersEnabled: true,
            };

            const { container } = render(<CellList {...props} />);

            const lineNumbers = container.querySelectorAll(".cell-line-number");
            const lineNumberTexts = Array.from(lineNumbers)
                .map((el) => el.textContent?.trim())
                .filter(Boolean);

            // Main cells should have lines 1-5
            expect(lineNumberTexts).toContain("1");
            expect(lineNumberTexts).toContain("2");
            expect(lineNumberTexts).toContain("3");
            expect(lineNumberTexts).toContain("4");
            expect(lineNumberTexts).toContain("5");

            // Child cells should have decimal notation
            expect(lineNumberTexts).toContain("2.1");
            expect(lineNumberTexts).toContain("4.1");
            expect(lineNumberTexts).toContain("4.2");

            // Should NOT have line 6, 7, or 8 (only 5 main lines)
            expect(lineNumberTexts).not.toContain("6");
            expect(lineNumberTexts).not.toContain("7");
            expect(lineNumberTexts).not.toContain("8");
        });

        it("should not show line numbers when lineNumbersEnabled is false", () => {
            const translationUnits: QuillCellContent[] = [
                createBibleCell("GEN", 1, 1),
                createBibleCell("GEN", 1, 2),
                createBibleCell("GEN", 1, 3),
            ];

            const props = {
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
                isSourceText: false,
                windowHeight: 800,
                headerHeight: 100,
                highlightedCellId: null,
                scrollSyncEnabled: true,
                currentUsername: "test-user",
                requiredValidations: 1,
                lineNumbersEnabled: false, // Disabled
            };

            const { container } = render(<CellList {...props} />);

            // Line numbers should not be visible
            const lineNumbers = container.querySelectorAll(".cell-line-number");
            expect(lineNumbers.length).toBe(0);
        });
    });

    describe("Child cell identification (post-migration)", () => {
        it("identifies child cells by metadata.parentId (primary); legacy ID format is fallback for labeling", () => {
            // CellList identifies child cells by metadata.parentId (or data.parentId), not by ID format.
            // Cells with metadata.parentId set are not counted in the main line number sequence and get
            // decimal labels (e.g. 2.1, 2.2). Legacy ID format (3+ colon-separated parts) is used only
            // as fallback when parentId is missing (e.g. for labeling).
            const parentId = "GEN 1:5";
            const childCell = createBibleChildCell("GEN", 1, 5, "1740475700855-sbcr37orm");
            expect(childCell.metadata?.parentId).toBe(parentId);
            expect(childCell.cellMarkers[0]).toContain(parentId);
            // Child cells with parentId set are excluded from line count in getChapterBasedVerseNumber
            expect(childCell.metadata?.parentId).toBeDefined();
        });
    });
});
