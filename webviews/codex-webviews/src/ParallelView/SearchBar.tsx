import React from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";

interface SearchBarProps {
    query: string;
    onQueryChange: (query: string) => void;
    onSearch: (event: React.FormEvent) => void;
}

const SearchBar: React.FC<SearchBarProps> = ({ query, onQueryChange, onSearch }) => {
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && e.ctrlKey) {
            e.preventDefault();
            onSearch(e as unknown as React.FormEvent); // Trigger search on Ctrl + Enter
        }
    };

    return (
        <form
            className="search-bar"
            onSubmit={onSearch}
            style={{ position: "relative", padding: "8px" }}
        >
            <input
                type="text"
                placeholder="Search anything or highlight text"
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                onKeyDown={handleKeyDown}
                style={{
                    flexGrow: 1,
                    minWidth: 0,
                    backgroundColor: "transparent",
                    border: "1px solid var(--vscode-widget-border)",
                    color: "var(--vscode-foreground)",
                    padding: "4px 8px",
                    borderRadius: "4px",
                    outline: "none",
                }}
            />
            <VSCodeButton
                type="submit"
                style={{
                    position: "absolute",
                    right: "8px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    padding: "0",
                    minWidth: "auto",
                }}
                appearance="icon"
                title="Search"
            >
            </VSCodeButton>
        </form>
    );
};

export default SearchBar;
