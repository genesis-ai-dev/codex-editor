import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom";
import type { TranslationPair } from "../../../../../types";
import SearchTab from "../SearchTab";

const createMockVscode = () => ({
    postMessage: vi.fn(),
});

const createMockVerse = (
    cellId: string,
    sourceContent: string,
    targetContent: string
): TranslationPair => ({
    cellId,
    sourceCell: { cellId, content: sourceContent, uri: "file:///test/source.source" },
    targetCell: { cellId, content: targetContent, uri: "file:///test/target.codex" },
});

const defaultProps = () => ({
    verses: [] as TranslationPair[],
    pinnedVerses: [] as TranslationPair[],
    lastQuery: "",
    onQueryChange: vi.fn(),
    onSearch: vi.fn(),
    onPinToggle: vi.fn(),
    onUriClick: vi.fn(),
    completeOnly: false,
    onCompleteOnlyChange: vi.fn(),
    searchScope: "both" as "both" | "source" | "target",
    onSearchScopeChange: vi.fn(),
    projectFiles: [],
    selectedFiles: [] as string[],
    onSelectedFilesChange: vi.fn(),
    onPinAll: vi.fn(),
    onUnpinAll: vi.fn(),
    vscode: createMockVscode(),
});

describe("SearchTab scope buttons", () => {
    it("calls onSearchScopeChange with 'both' when Both button is clicked", () => {
        const props = defaultProps();
        render(<SearchTab {...props} />);

        const bothButton = screen.getByRole("button", { name: /^Both$/i });
        fireEvent.click(bothButton);

        expect(props.onSearchScopeChange).toHaveBeenCalledWith("both");
    });

    it("calls onSearchScopeChange with 'source' when Source button is clicked", () => {
        const props = defaultProps();
        render(<SearchTab {...props} />);

        const sourceButton = screen.getByRole("button", { name: /^Source$/i });
        fireEvent.click(sourceButton);

        expect(props.onSearchScopeChange).toHaveBeenCalledWith("source");
    });

    it("calls onSearchScopeChange with 'target' when Target button is clicked", () => {
        const props = defaultProps();
        render(<SearchTab {...props} />);

        const targetButton = screen.getByRole("button", { name: /^Target$/i });
        fireEvent.click(targetButton);

        expect(props.onSearchScopeChange).toHaveBeenCalledWith("target");
    });
});

describe("SearchTab search triggering", () => {
    it("calls onSearch with the current query when the search button is clicked", () => {
        const props = { ...defaultProps(), lastQuery: "Abiga" };
        render(<SearchTab {...props} />);

        const searchButton = screen.getByRole("button", { name: "Search" });
        fireEvent.click(searchButton);

        expect(props.onSearch).toHaveBeenCalledTimes(1);
        expect(props.onSearch.mock.calls[0][0]).toBe("Abiga");
        expect(props.onSearch.mock.calls[0][1]).toBe("");
    });

    it("does not call onSearch when query is empty", () => {
        const props = { ...defaultProps(), lastQuery: "  " };
        render(<SearchTab {...props} />);

        const searchButton = screen.getByRole("button", { name: "Search" });
        fireEvent.click(searchButton);

        expect(props.onSearch).not.toHaveBeenCalled();
    });
});

describe("SearchTab result rendering", () => {
    it("shows 'No search results' when verses is empty", () => {
        const props = defaultProps();
        render(<SearchTab {...props} />);

        expect(screen.getByText("No search results")).toBeInTheDocument();
    });

    it("renders results when verses are provided", () => {
        const verses = [
            createMockVerse("GEN 1:1", "In the beginning", "Au commencement"),
            createMockVerse("GEN 1:2", "And the earth was", "Et la terre était"),
        ];
        const props = { ...defaultProps(), verses, lastQuery: "beginning" };
        render(<SearchTab {...props} />);

        expect(screen.getByText("Search Results")).toBeInTheDocument();
        expect(screen.getByText("2")).toBeInTheDocument();
    });

    it("renders results regardless of scope selection", () => {
        const verses = [
            createMockVerse("JDG 5:1", "Then sang Deborah and Abigail", ""),
        ];

        const props = {
            ...defaultProps(),
            verses,
            lastQuery: "Abiga",
            searchScope: "source" as const,
        };
        render(<SearchTab {...props} />);

        expect(screen.getByText("Search Results")).toBeInTheDocument();
        expect(screen.queryByText("No search results")).not.toBeInTheDocument();
    });
});

describe("SearchTab auto-scope-switch on replace text", () => {
    it("switches scope to 'target' when replace text is entered", async () => {
        const props = {
            ...defaultProps(),
            searchScope: "both" as const,
            replaceText: "replacement",
            onReplaceTextChange: vi.fn(),
            forceReplaceExpanded: true,
        };

        render(<SearchTab {...props} />);

        await waitFor(() => {
            expect(props.onSearchScopeChange).toHaveBeenCalledWith("target");
        });
    });

    it("does not switch scope when replace text is empty", () => {
        const props = {
            ...defaultProps(),
            searchScope: "both" as const,
            replaceText: "",
            onReplaceTextChange: vi.fn(),
        };

        render(<SearchTab {...props} />);

        expect(props.onSearchScopeChange).not.toHaveBeenCalledWith("target");
    });

    it("does not switch scope when already on target", () => {
        const props = {
            ...defaultProps(),
            searchScope: "target" as const,
            replaceText: "replacement",
            onReplaceTextChange: vi.fn(),
            forceReplaceExpanded: true,
        };

        render(<SearchTab {...props} />);

        expect(props.onSearchScopeChange).not.toHaveBeenCalled();
    });
});
