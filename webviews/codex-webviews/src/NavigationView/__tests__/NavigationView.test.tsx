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

describe("NavigationView Book Name Sorting", () => {
    // Replicate the sortItems function from NavigationView
    const sortItems = (a: CodexItem, b: CodexItem) => {
        // If both items have sortOrder (Bible books), sort by that
        if (a.sortOrder && b.sortOrder) {
            return a.sortOrder.localeCompare(b.sortOrder);
        }

        // For corpus items, prioritize OT and NT
        if (a.type === "corpus" && b.type === "corpus") {
            if (a.label === "Old Testament") return -1;
            if (b.label === "Old Testament") return 1;
            if (a.label === "New Testament") return -1;
            if (b.label === "New Testament") return 1;
        }

        // For non-Biblical books, sort by fileDisplayName if available, otherwise by label
        const aDisplayName = a.fileDisplayName || a.label;
        const bDisplayName = b.fileDisplayName || b.label;

        // Extract any numbers from the display names for alphanumeric sorting
        const aMatch = aDisplayName.match(/\d+/);
        const bMatch = bDisplayName.match(/\d+/);

        if (aMatch && bMatch) {
            const aNum = parseInt(aMatch[0]);
            const bNum = parseInt(bMatch[0]);
            if (aNum !== bNum) {
                return aNum - bNum;
            }
        }

        return aDisplayName.localeCompare(bDisplayName);
    };

    it("maintains alphabetical order after editing book names", () => {
        // Create items with fileDisplayName values in alphabetical order
        const items: CodexItem[] = [
            {
                label: "GEN",
                uri: "file:///test/gen.codex",
                type: "codexDocument",
                fileDisplayName: "Genesis",
            },
            {
                label: "EXO",
                uri: "file:///test/exo.codex",
                type: "codexDocument",
                fileDisplayName: "Exodus",
            },
            {
                label: "LEV",
                uri: "file:///test/lev.codex",
                type: "codexDocument",
                fileDisplayName: "Leviticus",
            },
            {
                label: "NUM",
                uri: "file:///test/num.codex",
                type: "codexDocument",
                fileDisplayName: "Numbers",
            },
        ];

        // Initially sorted items should be in alphabetical order
        const initiallySorted = [...items].sort(sortItems);
        expect(initiallySorted[0].fileDisplayName).toBe("Exodus");
        expect(initiallySorted[1].fileDisplayName).toBe("Genesis");
        expect(initiallySorted[2].fileDisplayName).toBe("Leviticus");
        expect(initiallySorted[3].fileDisplayName).toBe("Numbers");

        // Simulate editing a book name - change "Genesis" to "Aardvark" (which should come first)
        const editedItems = items.map((item) => {
            if (item.label === "GEN") {
                return {
                    ...item,
                    fileDisplayName: "Aardvark",
                };
            }
            return item;
        });

        // After editing, items should still be sorted alphabetically
        const sortedAfterEdit = [...editedItems].sort(sortItems);
        expect(sortedAfterEdit[0].fileDisplayName).toBe("Aardvark");
        expect(sortedAfterEdit[1].fileDisplayName).toBe("Exodus");
        expect(sortedAfterEdit[2].fileDisplayName).toBe("Leviticus");
        expect(sortedAfterEdit[3].fileDisplayName).toBe("Numbers");

        // Simulate editing another book name - change "Numbers" to "Zebra" (which should come last)
        const editedItems2 = editedItems.map((item) => {
            if (item.label === "NUM") {
                return {
                    ...item,
                    fileDisplayName: "Zebra",
                };
            }
            return item;
        });

        // After second edit, items should still be sorted alphabetically
        const sortedAfterSecondEdit = [...editedItems2].sort(sortItems);
        expect(sortedAfterSecondEdit[0].fileDisplayName).toBe("Aardvark");
        expect(sortedAfterSecondEdit[1].fileDisplayName).toBe("Exodus");
        expect(sortedAfterSecondEdit[2].fileDisplayName).toBe("Leviticus");
        expect(sortedAfterSecondEdit[3].fileDisplayName).toBe("Zebra");
    });

    it("maintains alphabetical order when editing multiple book names simultaneously", () => {
        const items: CodexItem[] = [
            {
                label: "MAT",
                uri: "file:///test/mat.codex",
                type: "codexDocument",
                fileDisplayName: "Matthew",
            },
            {
                label: "MRK",
                uri: "file:///test/mrk.codex",
                type: "codexDocument",
                fileDisplayName: "Mark",
            },
            {
                label: "LUK",
                uri: "file:///test/luk.codex",
                type: "codexDocument",
                fileDisplayName: "Luke",
            },
            {
                label: "JHN",
                uri: "file:///test/jhn.codex",
                type: "codexDocument",
                fileDisplayName: "John",
            },
        ];

        // Initially sorted
        const initiallySorted = [...items].sort(sortItems);
        expect(initiallySorted.map((item) => item.fileDisplayName)).toEqual([
            "John",
            "Luke",
            "Mark",
            "Matthew",
        ]);

        // Edit multiple book names at once
        const editedItems = items.map((item) => {
            if (item.label === "MAT") {
                return { ...item, fileDisplayName: "Zebra" };
            }
            if (item.label === "JHN") {
                return { ...item, fileDisplayName: "Alpha" };
            }
            return item;
        });

        // After editing, should still be sorted alphabetically
        const sortedAfterEdit = [...editedItems].sort(sortItems);
        expect(sortedAfterEdit.map((item) => item.fileDisplayName)).toEqual([
            "Alpha",
            "Luke",
            "Mark",
            "Zebra",
        ]);
    });

    it("falls back to label when fileDisplayName is not available", () => {
        const items: CodexItem[] = [
            {
                label: "Zebra Codex",
                uri: "file:///test/zebra.codex",
                type: "codexDocument",
            },
            {
                label: "Alpha Codex",
                uri: "file:///test/alpha.codex",
                type: "codexDocument",
                fileDisplayName: "Alpha Codex",
            },
            {
                label: "Beta Codex",
                uri: "file:///test/beta.codex",
                type: "codexDocument",
            },
        ];

        const sorted = [...items].sort(sortItems);
        expect(sorted[0].label).toBe("Alpha Codex");
        expect(sorted[1].label).toBe("Beta Codex");
        expect(sorted[2].label).toBe("Zebra Codex");
    });
});
