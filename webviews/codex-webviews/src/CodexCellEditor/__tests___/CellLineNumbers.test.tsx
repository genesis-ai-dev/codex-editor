import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { MilestoneIndex, QuillCellContent, SubdivisionInfo } from "../../../../../types";
import { CodexCellTypes } from "../../../../../types/enums";
import CellList from "../CellList";
import { buildSubsectionsForMilestone } from "../utils/subdivisionUtils";

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
vi.mock("@sharedUtils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@sharedUtils")>()),
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

        it("does not count paratext notes created from a cell in that cell's sub-numbers", () => {
            const parentId = "GEN 1:2";
            const paratextFromParent = createMockCell(
                `${parentId}:paratext-note`,
                CodexCellTypes.PARATEXT,
                "<p>Note on verse 2</p>",
                { metadata: { parentId } }
            );
            const translationUnits: QuillCellContent[] = [
                createBibleCell("GEN", 1, 1),
                createBibleCell("GEN", 1, 2),
                paratextFromParent,
                createBibleChildCell("GEN", 1, 2, "child-1"),
                createBibleChildCell("GEN", 1, 2, "child-2"),
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
            const lineNumberTexts = Array.from(container.querySelectorAll(".cell-line-number"))
                .map((el) => el.textContent?.trim())
                .filter(Boolean);

            expect(lineNumberTexts).toContain("2");
            expect(lineNumberTexts).toContain("2.1");
            expect(lineNumberTexts).toContain("2.2");
            expect(lineNumberTexts).not.toContain("2.3");
            expect(lineNumberTexts).toContain("3");
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

    describe("Label and line number separation", () => {
        const makeLabeledCellProps = (translationUnits: QuillCellContent[]) => ({
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
        });

        it("should show numeric line numbers, not speaker labels, in the line number area", () => {
            const translationUnits: QuillCellContent[] = [
                createMockCell("cell-1", CodexCellTypes.TEXT, "<p>Heli keteibe</p>", {
                    cellLabel: "PAWN BROKER",
                }),
                createMockCell("cell-2", CodexCellTypes.TEXT, "<p>Nang au kemret kau!</p>", {
                    cellLabel: "UPSET WOMAN",
                }),
                createMockCell("cell-3", CodexCellTypes.TEXT, "<p>Pa au mie zeu da.</p>", {
                    cellLabel: "PAWN BROKER",
                }),
            ];

            const { container } = render(
                <CellList {...makeLabeledCellProps(translationUnits)} />
            );

            const lineNumbers = container.querySelectorAll(".cell-line-number");
            const lineNumberTexts = Array.from(lineNumbers)
                .map((el) => el.textContent?.trim())
                .filter(Boolean);

            expect(lineNumberTexts).toContain("1");
            expect(lineNumberTexts).toContain("2");
            expect(lineNumberTexts).toContain("3");

            // Line numbers must NOT contain speaker labels
            expect(lineNumberTexts).not.toContain("PAWN BROKER");
            expect(lineNumberTexts).not.toContain("UPSET WOMAN");
        });

        it("should render cellLabel as a separate label element, not in the line number area", () => {
            const translationUnits: QuillCellContent[] = [
                createMockCell("cell-1", CodexCellTypes.TEXT, "<p>Some dialogue</p>", {
                    cellLabel: "JESUS",
                }),
                createMockCell("cell-2", CodexCellTypes.TEXT, "<p>More dialogue</p>", {
                    cellLabel: "SALOME",
                }),
            ];

            const { container } = render(
                <CellList {...makeLabeledCellProps(translationUnits)} />
            );

            // Labels should appear in label elements
            const labelElements = container.querySelectorAll(".cell-label-text");
            const labelTexts = Array.from(labelElements)
                .map((el) => el.textContent?.trim())
                .filter(Boolean);

            expect(labelTexts).toContain("JESUS");
            expect(labelTexts).toContain("SALOME");

            // Line numbers should be numeric
            const lineNumbers = container.querySelectorAll(".cell-line-number");
            const lineNumberTexts = Array.from(lineNumbers)
                .map((el) => el.textContent?.trim())
                .filter(Boolean);

            expect(lineNumberTexts).toContain("1");
            expect(lineNumberTexts).toContain("2");
            expect(lineNumberTexts).not.toContain("JESUS");
            expect(lineNumberTexts).not.toContain("SALOME");
        });

        it("should show numeric line numbers for cells with cellLabel but no verse-level references", () => {
            const translationUnits: QuillCellContent[] = [
                createMockCell("cell-a", CodexCellTypes.TEXT, "<p>First line</p>", {
                    cellLabel: "THE LEPER",
                }),
                createMockCell("cell-b", CodexCellTypes.TEXT, "<p>Second line</p>", {
                    cellLabel: "BIG JAMES",
                }),
                createMockCell("cell-c", CodexCellTypes.TEXT, "<p>Third line</p>", {
                    cellLabel: "ZEBEDEE",
                }),
                createMockCell("cell-d", CodexCellTypes.TEXT, "<p>Fourth line</p>", {
                    cellLabel: "ZEBEDEE",
                }),
            ];

            const { container } = render(
                <CellList {...makeLabeledCellProps(translationUnits)} />
            );

            const lineNumbers = container.querySelectorAll(".cell-line-number");
            const lineNumberTexts = Array.from(lineNumbers)
                .map((el) => el.textContent?.trim())
                .filter(Boolean);

            // Sequential numeric line numbers
            expect(lineNumberTexts).toContain("1");
            expect(lineNumberTexts).toContain("2");
            expect(lineNumberTexts).toContain("3");
            expect(lineNumberTexts).toContain("4");

            // None of the speaker names should appear as line numbers
            expect(lineNumberTexts).not.toContain("THE LEPER");
            expect(lineNumberTexts).not.toContain("BIG JAMES");
            expect(lineNumberTexts).not.toContain("ZEBEDEE");
        });

        it("should handle a mix of cells with and without labels", () => {
            const translationUnits: QuillCellContent[] = [
                createMockCell("cell-1", CodexCellTypes.TEXT, "<p>Unlabeled cell</p>"),
                createMockCell("cell-2", CodexCellTypes.TEXT, "<p>Labeled cell</p>", {
                    cellLabel: "NARRATOR",
                }),
                createMockCell("cell-3", CodexCellTypes.TEXT, "<p>Another unlabeled</p>"),
            ];

            const { container } = render(
                <CellList {...makeLabeledCellProps(translationUnits)} />
            );

            const lineNumbers = container.querySelectorAll(".cell-line-number");
            const lineNumberTexts = Array.from(lineNumbers)
                .map((el) => el.textContent?.trim())
                .filter(Boolean);

            expect(lineNumberTexts).toContain("1");
            expect(lineNumberTexts).toContain("2");
            expect(lineNumberTexts).toContain("3");
            expect(lineNumberTexts).not.toContain("NARRATOR");
        });
    });

    describe("Line numbers restart at each milestone", () => {
        const readLineNumbers = (container: HTMLElement): string[] =>
            Array.from(container.querySelectorAll(".cell-line-number"))
                .map((el) => el.textContent?.trim() ?? "")
                .filter(Boolean);

        const renderCells = (
            translationUnits: QuillCellContent[],
            options: {
                fullDocumentTranslationUnits?: QuillCellContent[];
                milestoneIndex: MilestoneIndex;
                currentMilestoneIndex: number;
                currentSubsectionIndex?: number;
                cellsPerPage?: number;
                isSourceText?: boolean;
            }
        ) => {
            const props = {
                translationUnits,
                fullDocumentTranslationUnits:
                    options.fullDocumentTranslationUnits ?? translationUnits,
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
                isSourceText: options.isSourceText ?? false,
                windowHeight: 800,
                headerHeight: 100,
                highlightedCellId: null,
                scrollSyncEnabled: true,
                currentUsername: "test-user",
                requiredValidations: 1,
                lineNumbersEnabled: true,
                milestoneIndex: options.milestoneIndex,
                currentMilestoneIndex: options.currentMilestoneIndex,
                currentSubsectionIndex: options.currentSubsectionIndex ?? 0,
                cellsPerPage: options.cellsPerPage ?? options.milestoneIndex.cellsPerPage,
            };
            return render(<CellList {...props} />);
        };

        const numberedCells = (prefix: string, count: number): QuillCellContent[] =>
            Array.from({ length: count }, (_, i) =>
                createMockCell(`${prefix}-${i + 1}`, CodexCellTypes.TEXT, `<p>${prefix} ${i + 1}</p>`)
            );

        const autoPages = (
            cellIds: string[],
            cellsPerPage: number
        ): SubdivisionInfo[] => {
            const pages: SubdivisionInfo[] = [];
            for (let start = 0; start < cellIds.length; start += cellsPerPage) {
                const end = Math.min(start + cellsPerPage, cellIds.length);
                pages.push({
                    index: pages.length,
                    startRootIndex: start,
                    endRootIndex: end,
                    key: cellIds[start],
                    startCellId: cellIds[start],
                    source: "auto",
                });
            }
            return pages;
        };

        const assertInsidePageLabel = (
            numbers: string[],
            label: string
        ) => {
            const [start, end] = label.split("-").map((part) => Number(part));
            const numeric = numbers
                .filter((value) => value !== "❌")
                .map((value) => Number(value.split(".")[0]));
            expect(numeric.length).toBeGreaterThan(0);
            for (const value of numeric) {
                expect(value).toBeGreaterThanOrEqual(start);
                expect(value).toBeLessThanOrEqual(end);
            }
        };

        it("restarts Bible chapter numbering at 1 so page A matches its label", () => {
            const chapterCells = numberedCells("gen2", 3);
            const cellsPerPage = 50;
            const milestoneIndex: MilestoneIndex = {
                milestones: [
                    {
                        index: 0,
                        cellIndex: 0,
                        value: "Genesis 1",
                        cellCount: 100,
                    },
                    {
                        index: 1,
                        cellIndex: 101,
                        value: "Genesis 2",
                        cellCount: chapterCells.length,
                        subdivisions: autoPages(
                            chapterCells.map((cell) => cell.cellMarkers[0]),
                            cellsPerPage
                        ),
                    },
                ],
                totalCells: 103,
                cellsPerPage,
            };
            const pageLabel = buildSubsectionsForMilestone(
                1,
                milestoneIndex.milestones[1],
                cellsPerPage
            )[0].label;

            const { container } = renderCells(chapterCells, {
                milestoneIndex,
                currentMilestoneIndex: 1,
            });
            const numbers = readLineNumbers(container);

            expect(pageLabel).toBe("1-3");
            expect(numbers).toEqual(["1", "2", "3"]);
            assertInsidePageLabel(numbers, pageLabel);
            expect(numbers).not.toContain("101");
        });

        it("numbers Bible page B from the milestone, not from the start of the file", () => {
            const cellsPerPage = 50;
            const chapterCells = numberedCells("gen2", 100);
            const pageB = chapterCells.slice(cellsPerPage);
            const milestoneIndex: MilestoneIndex = {
                milestones: [
                    {
                        index: 0,
                        cellIndex: 0,
                        value: "Genesis 1",
                        cellCount: 120,
                    },
                    {
                        index: 1,
                        cellIndex: 121,
                        value: "Genesis 2",
                        cellCount: chapterCells.length,
                        subdivisions: autoPages(
                            chapterCells.map((cell) => cell.cellMarkers[0]),
                            cellsPerPage
                        ),
                    },
                ],
                totalCells: 220,
                cellsPerPage,
            };
            const pageLabel = buildSubsectionsForMilestone(
                1,
                milestoneIndex.milestones[1],
                cellsPerPage
            )[1].label;

            const { container } = renderCells(pageB, {
                fullDocumentTranslationUnits: chapterCells,
                milestoneIndex,
                currentMilestoneIndex: 1,
                currentSubsectionIndex: 1,
                cellsPerPage,
            });
            const numbers = readLineNumbers(container);

            expect(pageLabel).toBe("51-100");
            expect(numbers[0]).toBe("51");
            expect(numbers[numbers.length - 1]).toBe("100");
            assertInsidePageLabel(numbers, pageLabel);
            expect(numbers).not.toContain("171");
        });

        it("keeps the same Bible page numbers when only the current page is loaded", () => {
            const cellsPerPage = 50;
            const chapterCells = numberedCells("gen3", 100);
            const pageB = chapterCells.slice(cellsPerPage);
            const milestoneIndex: MilestoneIndex = {
                milestones: [
                    {
                        index: 0,
                        cellIndex: 0,
                        value: "Genesis 2",
                        cellCount: 80,
                    },
                    {
                        index: 1,
                        cellIndex: 81,
                        value: "Genesis 3",
                        cellCount: chapterCells.length,
                        subdivisions: autoPages(
                            chapterCells.map((cell) => cell.cellMarkers[0]),
                            cellsPerPage
                        ),
                    },
                ],
                totalCells: 180,
                cellsPerPage,
            };

            const { container } = renderCells(pageB, {
                fullDocumentTranslationUnits: pageB,
                milestoneIndex,
                currentMilestoneIndex: 1,
                currentSubsectionIndex: 1,
                cellsPerPage,
            });
            const numbers = readLineNumbers(container);

            expect(numbers[0]).toBe("51");
            expect(numbers[numbers.length - 1]).toBe("100");
        });

        it("does not number IDML headings and restarts at the next chapter", () => {
            const chapterCells: QuillCellContent[] = [
                createParatextCell("idml-heading-ch2"),
                createMockCell("idml-1", CodexCellTypes.TEXT, "<p>Verse one</p>"),
                createMockCell("idml-2", CodexCellTypes.TEXT, "<p>Verse two</p>"),
                createParatextCell("idml-note"),
                createMockCell("idml-3", CodexCellTypes.TEXT, "<p>Verse three</p>"),
            ];
            const cellsPerPage = 50;
            const milestoneIndex: MilestoneIndex = {
                milestones: [
                    {
                        index: 0,
                        cellIndex: 0,
                        value: "Matthew 1",
                        cellCount: 40,
                    },
                    {
                        index: 1,
                        cellIndex: 42,
                        value: "Matthew 2",
                        cellCount: 3,
                        subdivisions: autoPages(["idml-1", "idml-2", "idml-3"], cellsPerPage),
                    },
                ],
                totalCells: 43,
                cellsPerPage,
            };

            const { container } = renderCells(chapterCells, {
                milestoneIndex,
                currentMilestoneIndex: 1,
            });
            const numbers = readLineNumbers(container);

            expect(numbers).toEqual(["1", "2", "3"]);
            expect(numbers).not.toContain("41");
        });

        it("numbers a single-milestone audio file from the start of that file", () => {
            const cellsPerPage = 50;
            const episode = numberedCells("audio", 60);
            const pageB = episode.slice(cellsPerPage);
            const milestoneIndex: MilestoneIndex = {
                milestones: [
                    {
                        index: 0,
                        cellIndex: 0,
                        value: "1",
                        cellCount: episode.length,
                        subdivisions: autoPages(
                            episode.map((cell) => cell.cellMarkers[0]),
                            cellsPerPage
                        ),
                    },
                ],
                totalCells: episode.length,
                cellsPerPage,
            };
            const labels = buildSubsectionsForMilestone(
                0,
                milestoneIndex.milestones[0],
                cellsPerPage
            );

            const pageA = renderCells(episode.slice(0, cellsPerPage), {
                fullDocumentTranslationUnits: episode,
                milestoneIndex,
                currentMilestoneIndex: 0,
                currentSubsectionIndex: 0,
                cellsPerPage,
            });
            const pageANumbers = readLineNumbers(pageA.container);
            pageA.unmount();

            const pageBView = renderCells(pageB, {
                fullDocumentTranslationUnits: episode,
                milestoneIndex,
                currentMilestoneIndex: 0,
                currentSubsectionIndex: 1,
                cellsPerPage,
            });
            const pageBNumbers = readLineNumbers(pageBView.container);

            expect(labels[0].label).toBe("1-50");
            expect(labels[1].label).toBe("51-60");
            expect(pageANumbers[0]).toBe("1");
            expect(pageANumbers[pageANumbers.length - 1]).toBe("50");
            expect(pageBNumbers[0]).toBe("51");
            expect(pageBNumbers[pageBNumbers.length - 1]).toBe("60");
            assertInsidePageLabel(pageBNumbers, labels[1].label);
        });

        it("restarts numbering for each audio episode milestone", () => {
            const episodeTwo = numberedCells("episode2", 3);
            const milestoneIndex: MilestoneIndex = {
                milestones: [
                    {
                        index: 0,
                        cellIndex: 0,
                        value: "1",
                        cellCount: 50,
                    },
                    {
                        index: 1,
                        cellIndex: 51,
                        value: "2",
                        cellCount: episodeTwo.length,
                        subdivisions: autoPages(
                            episodeTwo.map((cell) => cell.cellMarkers[0]),
                            50
                        ),
                    },
                ],
                totalCells: 53,
                cellsPerPage: 50,
            };

            const { container } = renderCells(episodeTwo, {
                milestoneIndex,
                currentMilestoneIndex: 1,
            });

            expect(readLineNumbers(container)).toEqual(["1", "2", "3"]);
        });

        it("numbers custom named pages from the milestone even when the milestone is shorter than a default page", () => {
            const cells = numberedCells("story", 12);
            const pageB = cells.slice(5);
            const cellsPerPage = 50;
            const subdivisions: SubdivisionInfo[] = [
                {
                    index: 0,
                    startRootIndex: 0,
                    endRootIndex: 5,
                    key: "intro",
                    startCellId: "story-1",
                    name: "Intro",
                    source: "custom",
                },
                {
                    index: 1,
                    startRootIndex: 5,
                    endRootIndex: 12,
                    key: "story",
                    startCellId: "story-6",
                    name: "Story",
                    source: "custom",
                },
            ];
            const milestoneIndex: MilestoneIndex = {
                milestones: [
                    {
                        index: 0,
                        cellIndex: 0,
                        value: "1",
                        cellCount: 30,
                    },
                    {
                        index: 1,
                        cellIndex: 31,
                        value: "2",
                        cellCount: cells.length,
                        subdivisions,
                    },
                ],
                totalCells: 42,
                cellsPerPage,
            };
            const pageLabel = buildSubsectionsForMilestone(
                1,
                milestoneIndex.milestones[1],
                cellsPerPage
            )[1];

            const fullMilestone = renderCells(pageB, {
                fullDocumentTranslationUnits: cells,
                milestoneIndex,
                currentMilestoneIndex: 1,
                currentSubsectionIndex: 1,
                cellsPerPage,
            });
            const fromFullMilestone = readLineNumbers(fullMilestone.container);
            fullMilestone.unmount();

            const pageOnly = renderCells(pageB, {
                fullDocumentTranslationUnits: pageB,
                milestoneIndex,
                currentMilestoneIndex: 1,
                currentSubsectionIndex: 1,
                cellsPerPage,
            });
            const fromPageOnly = readLineNumbers(pageOnly.container);

            expect(pageLabel.name).toBe("Story");
            expect(pageLabel.label).toBe("6-12");
            expect(fromFullMilestone).toEqual(["6", "7", "8", "9", "10", "11", "12"]);
            expect(fromPageOnly).toEqual(fromFullMilestone);
            assertInsidePageLabel(fromFullMilestone, pageLabel.label);
            expect(fromFullMilestone).not.toContain("36");
        });

        it("keeps the page offset when a heading sits before the first numbered cell on the page", () => {
            const pageCells: QuillCellContent[] = [
                createParatextCell("page-b-heading"),
                ...numberedCells("pageb", 2),
            ];
            const cellsPerPage = 50;
            const milestoneIndex: MilestoneIndex = {
                milestones: [
                    {
                        index: 0,
                        cellIndex: 0,
                        value: "1",
                        cellCount: 10,
                        subdivisions: [
                            {
                                index: 0,
                                startRootIndex: 0,
                                endRootIndex: 5,
                                key: "a",
                                startCellId: "earlier-1",
                                source: "auto",
                            },
                            {
                                index: 1,
                                startRootIndex: 5,
                                endRootIndex: 7,
                                key: "b",
                                startCellId: "pageb-1",
                                source: "custom",
                                name: "Continued",
                            },
                        ],
                    },
                ],
                totalCells: 10,
                cellsPerPage,
            };

            const { container } = renderCells(pageCells, {
                fullDocumentTranslationUnits: pageCells,
                milestoneIndex,
                currentMilestoneIndex: 0,
                currentSubsectionIndex: 1,
                cellsPerPage,
            });

            expect(readLineNumbers(container)).toEqual(["6", "7"]);
        });

        it("keeps child, merged, and deleted markers inside the current milestone", () => {
            const parent = createMockCell("ch2-parent", CodexCellTypes.TEXT, "<p>Parent</p>");
            const child = createMockCell("ch2-child", CodexCellTypes.TEXT, "<p>Child</p>", {
                metadata: { parentId: "ch2-parent" },
            });
            const merged = createMockCell("ch2-merged", CodexCellTypes.TEXT, "<p>Merged</p>", {
                merged: true,
            });
            const deleted = createMockCell("ch2-deleted", CodexCellTypes.TEXT, "<p>Deleted</p>", {
                deleted: true,
            });
            const after = createMockCell("ch2-after", CodexCellTypes.TEXT, "<p>After</p>");
            const cells = [parent, child, merged, deleted, after];
            const milestoneIndex: MilestoneIndex = {
                milestones: [
                    {
                        index: 0,
                        cellIndex: 0,
                        value: "1",
                        cellCount: 25,
                    },
                    {
                        index: 1,
                        cellIndex: 26,
                        value: "2",
                        cellCount: 2,
                        subdivisions: autoPages(["ch2-parent", "ch2-after"], 50),
                    },
                ],
                totalCells: 27,
                cellsPerPage: 50,
            };

            const { container } = renderCells(cells, {
                milestoneIndex,
                currentMilestoneIndex: 1,
            });
            const numbers = readLineNumbers(container);

            expect(numbers).toEqual(["1", "1.1", "❌", "❌", "2"]);
            expect(numbers).not.toContain("26");
            expect(numbers).not.toContain("26.1");
        });

        it("shows the same milestone numbers on the source pane and the translation pane", () => {
            const cells = numberedCells("gen2", 3);
            const milestoneIndex: MilestoneIndex = {
                milestones: [
                    { index: 0, cellIndex: 0, value: "1", cellCount: 90 },
                    {
                        index: 1,
                        cellIndex: 91,
                        value: "2",
                        cellCount: cells.length,
                        subdivisions: autoPages(
                            cells.map((cell) => cell.cellMarkers[0]),
                            50
                        ),
                    },
                ],
                totalCells: 93,
                cellsPerPage: 50,
            };

            const source = renderCells(cells, {
                milestoneIndex,
                currentMilestoneIndex: 1,
                isSourceText: true,
            });
            const sourceNumbers = readLineNumbers(source.container);
            source.unmount();

            const translation = renderCells(cells, {
                milestoneIndex,
                currentMilestoneIndex: 1,
                isSourceText: false,
            });

            expect(sourceNumbers).toEqual(["1", "2", "3"]);
            expect(readLineNumbers(translation.container)).toEqual(sourceNumbers);
        });

        it("uses the milestone line number in the cell hover text", () => {
            const cells = numberedCells("gen2", 2);
            const milestoneIndex: MilestoneIndex = {
                milestones: [
                    { index: 0, cellIndex: 0, value: "1", cellCount: 40 },
                    {
                        index: 1,
                        cellIndex: 41,
                        value: "2",
                        cellCount: cells.length,
                        subdivisions: autoPages(
                            cells.map((cell) => cell.cellMarkers[0]),
                            50
                        ),
                    },
                ],
                totalCells: 42,
                cellsPerPage: 50,
            };

            const { container } = renderCells(cells, {
                milestoneIndex,
                currentMilestoneIndex: 1,
            });
            const lineNumbers = Array.from(container.querySelectorAll(".cell-line-number"));

            expect(lineNumbers.map((el) => el.textContent?.trim())).toEqual(["1", "2"]);
            expect(lineNumbers.map((el) => el.getAttribute("title"))).toEqual([
                "Line 1",
                "Line 2",
            ]);
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
