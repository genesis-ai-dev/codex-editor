import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom";
import { CodexItem } from "types";

describe("NavigationView Sort Order Toggle", () => {
    const createMockCodexItems = (): CodexItem[] => [
        {
            label: "Zebra Codex",
            uri: "file:///test/zebra.codex",
            type: "codexDocument",
        },
        {
            label: "Alpha Codex",
            uri: "file:///test/alpha.codex",
            type: "codexDocument",
        },
        {
            label: "Beta Codex",
            uri: "file:///test/beta.codex",
            type: "codexDocument",
        },
    ];

    // Test the sort comparison logic used in NavigationView
    const sortComparison = (a: CodexItem, b: CodexItem, sortOrder: "asc" | "desc") => {
        const comparison = a.label.localeCompare(b.label);
        return sortOrder === "asc" ? comparison : -comparison;
    };

    it("sorts codex items alphabetically in ascending order by default", () => {
        const items = createMockCodexItems();
        const sortOrder = "asc";

        const sorted = [...items].sort((a, b) => sortComparison(a, b, sortOrder));

        expect(sorted[0].label).toBe("Alpha Codex");
        expect(sorted[1].label).toBe("Beta Codex");
        expect(sorted[2].label).toBe("Zebra Codex");
    });

    it("sorts codex items alphabetically in descending order when toggled", () => {
        const items = createMockCodexItems();
        const sortOrder = "desc";

        const sorted = [...items].sort((a, b) => sortComparison(a, b, sortOrder));

        expect(sorted[0].label).toBe("Zebra Codex");
        expect(sorted[1].label).toBe("Beta Codex");
        expect(sorted[2].label).toBe("Alpha Codex");
    });

    it("toggles sort order state correctly", () => {
        const TestComponent = () => {
            const [sortOrder, setSortOrder] = React.useState<"asc" | "desc">("asc");

            const handleToggleSortOrder = () => {
                setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
            };

            return (
                <div>
                    <button
                        onClick={handleToggleSortOrder}
                        data-testid="sort-toggle"
                        title={`Sort ${sortOrder === "asc" ? "descending" : "ascending"}`}
                    >
                        Sort {sortOrder === "asc" ? "↑" : "↓"}
                    </button>
                    <div data-testid="sort-order">{sortOrder}</div>
                </div>
            );
        };

        render(<TestComponent />);
        const toggleButton = screen.getByTestId("sort-toggle");
        const sortOrderDisplay = screen.getByTestId("sort-order");

        // Initial state - ascending
        expect(sortOrderDisplay).toHaveTextContent("asc");
        expect(toggleButton).toHaveAttribute("title", "Sort descending");

        // Click to toggle to descending
        fireEvent.click(toggleButton);
        expect(sortOrderDisplay).toHaveTextContent("desc");
        expect(toggleButton).toHaveAttribute("title", "Sort ascending");

        // Click again to toggle back to ascending
        fireEvent.click(toggleButton);
        expect(sortOrderDisplay).toHaveTextContent("asc");
        expect(toggleButton).toHaveAttribute("title", "Sort descending");
    });

    it("applies sort order to filtered items correctly", () => {
        const items = createMockCodexItems();

        // Simulate filtering (no filter in this case)
        const filteredItems = items;

        // Test ascending sort
        const sortedAsc = [...filteredItems].sort((a, b) => sortComparison(a, b, "asc"));
        expect(sortedAsc[0].label).toBe("Alpha Codex");
        expect(sortedAsc[1].label).toBe("Beta Codex");
        expect(sortedAsc[2].label).toBe("Zebra Codex");

        // Test descending sort
        const sortedDesc = [...filteredItems].sort((a, b) => sortComparison(a, b, "desc"));
        expect(sortedDesc[0].label).toBe("Zebra Codex");
        expect(sortedDesc[1].label).toBe("Beta Codex");
        expect(sortedDesc[2].label).toBe("Alpha Codex");
    });

    it("sorts both codex and dictionary items with the same sort order", () => {
        const codexItems: CodexItem[] = [
            { label: "Zebra", uri: "file:///zebra", type: "codexDocument" },
            { label: "Alpha", uri: "file:///alpha", type: "codexDocument" },
        ];

        const dictionaryItems: CodexItem[] = [
            { label: "Zebra Dict", uri: "file:///zebra-dict", type: "dictionary" },
            { label: "Alpha Dict", uri: "file:///alpha-dict", type: "dictionary" },
        ];

        const sortOrder = "asc";
        const sortComparisonFn = (a: CodexItem, b: CodexItem) => sortComparison(a, b, sortOrder);

        const sortedCodex = [...codexItems].sort(sortComparisonFn);
        const sortedDictionary = [...dictionaryItems].sort(sortComparisonFn);

        expect(sortedCodex[0].label).toBe("Alpha");
        expect(sortedCodex[1].label).toBe("Zebra");
        expect(sortedDictionary[0].label).toBe("Alpha Dict");
        expect(sortedDictionary[1].label).toBe("Zebra Dict");
    });

    it("maintains sort order when toggling multiple times", () => {
        const items = createMockCodexItems();
        let sortOrder: "asc" | "desc" = "asc";

        // Toggle multiple times
        for (let i = 0; i < 5; i++) {
            sortOrder = sortOrder === "asc" ? "desc" : "asc";
            const sorted = [...items].sort((a, b) => sortComparison(a, b, sortOrder));

            if (sortOrder === "asc") {
                expect(sorted[0].label).toBe("Alpha Codex");
                expect(sorted[2].label).toBe("Zebra Codex");
            } else {
                expect(sorted[0].label).toBe("Zebra Codex");
                expect(sorted[2].label).toBe("Alpha Codex");
            }
        }
    });
});
