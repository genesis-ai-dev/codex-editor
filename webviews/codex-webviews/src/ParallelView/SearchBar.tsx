import React from 'react';
import { VSCodeTextField, VSCodeButton } from "@vscode/webview-ui-toolkit/react";

interface SearchBarProps {
    query: string;
    onQueryChange: (query: string) => void;
    onSearch: () => void;
}

const SearchBar: React.FC<SearchBarProps> = ({ query, onQueryChange, onSearch }) => {
    return (
        <div className="search-bar">
            <VSCodeTextField
                placeholder="Search anything or highlight text."
                style={{ flexGrow: 1 }}
                value={query}
                onChange={(e) => onQueryChange((e.target as HTMLInputElement).value)}
            />
            <VSCodeButton onClick={onSearch}>
                Search
            </VSCodeButton>
        </div>
    );
};

export default SearchBar;