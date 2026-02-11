import React from "react";
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { render, screen, waitFor, cleanup, act } from "@testing-library/react";
import type { QuillCellContent, MilestoneIndex } from "../../../../../types";

/**
 * Integration regression test: the real CodexCellEditor component must accept
 * providerSendsInitialContentPaginated even when the provider sends a non-zero
 * milestone index (cached chapter position).
 *
 * Before the fix, the webview's stale-content guard compared refs (0,0) with
 * the incoming milestone position and silently discarded the first message,
 * leaving the editor empty with "1" in the header.
 */

// ─── VSCode API mock ────────────────────────────────────────────────────────
const mockVscode = {
    postMessage: vi.fn(),
    getState: vi.fn(),
    setState: vi.fn(),
};

Object.defineProperty(window, "vscodeApi", {
    value: mockVscode,
    writable: true,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).acquireVsCodeApi = vi.fn().mockReturnValue(mockVscode);

// ─── Heavy dependency mocks ─────────────────────────────────────────────────
vi.mock("react-player", () => ({
    default: vi.fn(() => <div data-testid="react-player" />),
}));

vi.mock("quill", () => {
    class MockBlot {
        static blotName = "mock";
        static tagName = "span";
    }
    class MockInline extends MockBlot {
        static blotName = "inline";
        static tagName = "span";
    }
    class MockBlock extends MockBlot {
        static blotName = "block";
        static tagName = "div";
    }
    class MockEmbed extends MockBlot {
        static blotName = "embed";
        static tagName = "object";
    }

    const MockQuill = vi.fn().mockImplementation(() => ({
        root: {
            innerHTML: "<p>Test content</p>",
            focus: vi.fn(),
            blur: vi.fn(),
            click: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            querySelectorAll: vi.fn().mockReturnValue([]),
        },
        getText: vi.fn().mockReturnValue("Test content"),
        getLength: vi.fn().mockReturnValue(12),
        getContents: vi.fn().mockReturnValue({ ops: [{ insert: "Test content" }] }),
        setContents: vi.fn(),
        updateContents: vi.fn(),
        insertText: vi.fn(),
        format: vi.fn(),
        getFormat: vi.fn(),
        removeFormat: vi.fn(),
        setSelection: vi.fn(),
        getModule: vi.fn().mockReturnValue({ destroy: vi.fn(), dispose: vi.fn() }),
        focus: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        import: vi.fn(),
    }));

    (MockQuill as any).import = vi.fn().mockImplementation((path: string) => {
        if (path === "blots/inline") return MockInline;
        if (path === "blots/block") return MockBlock;
        if (path === "blots/embed") return MockEmbed;
        if (path === "ui/icons") return {};
        return MockBlot;
    });
    (MockQuill as any).register = vi.fn();

    return { default: MockQuill };
});

// ─── CellList mock – exposes received translationUnits as test markers ──────
vi.mock("../CellList", () => ({
    default: (props: any) => {
        const units: QuillCellContent[] = props.translationUnits ?? [];
        return (
            <div data-testid="cell-list">
                <div data-testid="cell-count">{units.length}</div>
                {units.map((u: QuillCellContent, i: number) => (
                    <div key={i} data-testid={`cell-${u.cellMarkers?.[0] ?? i}`}>
                        {u.cellContent}
                    </div>
                ))}
            </div>
        );
    },
}));

// ─── ChapterNavigationHeader mock – exposes the milestone title ─────────────
vi.mock("../ChapterNavigationHeader", () => ({
    ChapterNavigationHeader: (props: any) => {
        const milestoneIdx: MilestoneIndex | null = props.milestoneIndex ?? null;
        const currentIdx: number = props.currentMilestoneIndex ?? 0;
        const displayValue = milestoneIdx?.milestones[currentIdx]?.value ?? "";
        return (
            <div data-testid="chapter-header">
                <span data-testid="milestone-title">{displayValue}</span>
            </div>
        );
    },
}));

// ─── Mock @sharedUtils ──────────────────────────────────────────────────────
vi.mock("@sharedUtils", () => ({
    shouldDisableValidation: vi.fn().mockReturnValue(false),
    getCellValueData: vi.fn().mockReturnValue({
        editType: "user-edit",
        value: "",
        validatedBy: [],
        author: "test-user",
    }),
    cellHasAudioUsingAttachments: vi.fn().mockReturnValue(false),
    computeValidationStats: vi.fn().mockReturnValue({
        currentUserValidated: false,
        otherUsersValidated: 0,
        totalValidations: 0,
    }),
    computeProgressPercents: vi.fn().mockReturnValue({
        translationProgress: 0,
        validationProgress: 0,
    }),
}));

// ─── Import after mocks ─────────────────────────────────────────────────────
import CodexCellEditor from "../CodexCellEditor";

// ─── Helpers ────────────────────────────────────────────────────────────────

const mkCell = (id: string, html: string): QuillCellContent =>
    ({
        cellMarkers: [id],
        cellContent: html,
        cellType: "text",
        editHistory: [],
        timestamps: undefined,
        cellLabel: undefined,
        merged: false,
        data: {},
        attachments: {},
        metadata: {},
    } as unknown as QuillCellContent);

const mkMilestoneIndex = (milestones: { value: string; cellIndex: number }[]): MilestoneIndex => ({
    milestones: milestones.map((m, i) => ({
        index: i,
        value: m.value,
        cellIndex: m.cellIndex,
        cellCount: 50,
    })),
    totalCells: milestones.length * 50,
    cellsPerPage: 50,
    milestoneProgress: {},
});

/** Dispatch providerSendsInitialContentPaginated just like the real provider. */
const dispatchInitialContent = (
    milestoneIndex: MilestoneIndex,
    cells: QuillCellContent[],
    currentMilestoneIndex: number,
    currentSubsectionIndex: number,
    rev: number = 1
) => {
    window.dispatchEvent(
        new MessageEvent("message", {
            data: {
                type: "providerSendsInitialContentPaginated",
                rev,
                milestoneIndex,
                cells,
                currentMilestoneIndex,
                currentSubsectionIndex,
                isSourceText: false,
                sourceCellMap: {},
                username: "test-user",
                validationCount: 1,
                validationCountAudio: 1,
                isAuthenticated: true,
                userAccessLevel: 10,
            },
        })
    );
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("CodexCellEditor initial content loading (integration)", () => {
    beforeAll(() => {
        (window as any).initialData = {
            cachedChapter: 1,
            metadata: {},
            isSourceText: false,
            sourceCellMap: {},
            username: "test-user",
            validationCount: 1,
            validationCountAudio: 1,
            isAuthenticated: true,
            userAccessLevel: 10,
        };

        URL.createObjectURL = URL.createObjectURL || vi.fn(() => "blob:mock-url");
        URL.revokeObjectURL = URL.revokeObjectURL || vi.fn();
        if (!HTMLCanvasElement.prototype.getContext) {
            // @ts-expect-error allow override for test
            HTMLCanvasElement.prototype.getContext = vi.fn(() => ({}));
        }
        Element.prototype.scrollIntoView = vi.fn();
    });

    beforeEach(() => {
        cleanup();
        mockVscode.postMessage.mockClear();
    });

    it("renders cells when initial content arrives with milestone index 0", async () => {
        render(<CodexCellEditor />);

        const milestoneIdx = mkMilestoneIndex([
            { value: "Mark 1", cellIndex: 0 },
            { value: "Mark 2", cellIndex: 50 },
        ]);
        const cells = [
            mkCell("MRK 1:1", "<p>Verse one</p>"),
            mkCell("MRK 1:2", "<p>Verse two</p>"),
        ];

        act(() => {
            dispatchInitialContent(milestoneIdx, cells, 0, 0);
        });

        await waitFor(() => {
            expect(screen.getByTestId("cell-count").textContent).toBe("2");
        });

        // Verify both cells made it through
        expect(screen.getByTestId("cell-MRK 1:1")).toBeTruthy();
        expect(screen.getByTestId("cell-MRK 1:2")).toBeTruthy();
    });

    it("renders cells when initial content arrives with a NON-ZERO milestone index (cached chapter)", async () => {
        render(<CodexCellEditor />);

        // Simulate: user was previously on chapter 3 (milestone index 2).
        // The provider sends initial content for milestone 2.
        const milestoneIdx = mkMilestoneIndex([
            { value: "Mark 1", cellIndex: 0 },
            { value: "Mark 2", cellIndex: 50 },
            { value: "Mark 3", cellIndex: 100 },
        ]);
        const cells = [
            mkCell("MRK 3:1", "<p>Chapter 3 verse 1</p>"),
            mkCell("MRK 3:2", "<p>Chapter 3 verse 2</p>"),
            mkCell("MRK 3:3", "<p>Chapter 3 verse 3</p>"),
        ];

        act(() => {
            dispatchInitialContent(milestoneIdx, cells, 2, 0);
        });

        // CRITICAL: cells must appear even though refs started at (0,0) and incoming was (2,0)
        await waitFor(() => {
            expect(screen.getByTestId("cell-count").textContent).toBe("3");
        });

        expect(screen.getByTestId("cell-MRK 3:1")).toBeTruthy();
        expect(screen.getByTestId("cell-MRK 3:2")).toBeTruthy();
        expect(screen.getByTestId("cell-MRK 3:3")).toBeTruthy();

        // Milestone header should show "Mark 3", not "1" or "Mark 1"
        await waitFor(() => {
            expect(screen.getByTestId("milestone-title").textContent).toBe("Mark 3");
        });
    });

    it("shows empty state before any content arrives (no misleading '1')", () => {
        render(<CodexCellEditor />);

        // Before any messages, no cells should be rendered and milestone title should be empty
        expect(screen.getByTestId("cell-count").textContent).toBe("0");
        expect(screen.getByTestId("milestone-title").textContent).toBe("");
    });

    it("rejects stale content after initial load but accepts matching content", async () => {
        render(<CodexCellEditor />);

        const milestoneIdx = mkMilestoneIndex([
            { value: "Mark 1", cellIndex: 0 },
            { value: "Mark 2", cellIndex: 50 },
            { value: "Mark 3", cellIndex: 100 },
        ]);

        // First message: initial content for milestone 2 (accepted)
        act(() => {
            dispatchInitialContent(milestoneIdx, [mkCell("MRK 3:1", "<p>ch3 v1</p>")], 2, 0, 1);
        });

        await waitFor(() => {
            expect(screen.getByTestId("cell-count").textContent).toBe("1");
        });
        expect(screen.getByTestId("milestone-title").textContent).toBe("Mark 3");

        // Second message: stale content for milestone 0 (should be rejected)
        act(() => {
            dispatchInitialContent(
                milestoneIdx,
                [mkCell("MRK 1:1", "<p>ch1 v1</p>"), mkCell("MRK 1:2", "<p>ch1 v2</p>")],
                0,
                0,
                2
            );
        });

        // Should still show milestone 2 content (not reverted to milestone 0)
        await new Promise((r) => setTimeout(r, 50));
        expect(screen.getByTestId("cell-count").textContent).toBe("1");
        expect(screen.getByTestId("milestone-title").textContent).toBe("Mark 3");

        // Third message: matching content for milestone 2 (should be accepted - same position)
        act(() => {
            dispatchInitialContent(
                milestoneIdx,
                [mkCell("MRK 3:1", "<p>ch3 v1 updated</p>"), mkCell("MRK 3:2", "<p>ch3 v2</p>")],
                2,
                0,
                3
            );
        });

        await waitFor(() => {
            expect(screen.getByTestId("cell-count").textContent).toBe("2");
        });
        expect(screen.getByTestId("milestone-title").textContent).toBe("Mark 3");
    });

    it("renders cells when initial content arrives with a non-zero subsection index", async () => {
        render(<CodexCellEditor />);

        // Milestone with cellCount large enough to have multiple subsections
        const milestoneIdx = mkMilestoneIndex([{ value: "Mark 1", cellIndex: 0 }]);
        milestoneIdx.milestones[0].cellCount = 100;

        const cells = [mkCell("MRK 1:51", "<p>Second page verse</p>")];

        act(() => {
            dispatchInitialContent(milestoneIdx, cells, 0, 1);
        });

        // Content should be accepted even though refs were (0,0) and incoming was (0,1)
        await waitFor(() => {
            expect(screen.getByTestId("cell-count").textContent).toBe("1");
        });
        expect(screen.getByTestId("cell-MRK 1:51")).toBeTruthy();
    });
});
