import React from "react";
import { VSCodeTextField, VSCodeButton } from "@vscode/webview-ui-toolkit/react";

interface SearchBarProps {
    query: string;
    onQueryChange: (query: string) => void;
    onSearch: (event: React.FormEvent) => void;
}
const SearchBar: React.FC<SearchBarProps> = ({ query, onQueryChange, onSearch }) => {
    return (
        <form className="search-bar" onSubmit={onSearch}>
            <VSCodeTextField
                placeholder="Search anything or highlight text."
                style={{ flexGrow: 1 }}
                value={query}
                onChange={(e) => onQueryChange((e.target as HTMLInputElement).value)}
            />
            <VSCodeButton type="submit">Search</VSCodeButton>
        </form>
    );
};
export default SearchBar;
