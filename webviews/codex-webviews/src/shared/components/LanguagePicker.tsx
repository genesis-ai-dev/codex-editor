import React, { useState, useMemo, useRef, useEffect } from "react";
import { getAvailableLanguages } from "../../../../../src/utils/ebible/ebibleCorpusUtils";
import { LanguageMetadata } from "codex-types";

interface LanguagePickerProps {
    onLanguageSelect: (language: LanguageMetadata) => void;
    initialLanguage?: LanguageMetadata;
    projectStatus: "source" | "target";
    label?: string;
}

export const LanguagePicker: React.FC<LanguagePickerProps> = ({
    onLanguageSelect,
    initialLanguage,
    projectStatus,
    label = "Select Language",
}) => {
    const [languageFilter, setLanguageFilter] = useState<string>(() => {
        if (initialLanguage) {
            return initialLanguage.refName;
        }
        return "";
    });
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const [isEditing, setIsEditing] = useState(false);
    const [previousLanguage, setPreviousLanguage] = useState<LanguageMetadata | null>(null);

    const dropdownRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const availableLanguages = useMemo(() => getAvailableLanguages(), []);

    const filteredLanguages = useMemo(() => {
        if (!languageFilter) return availableLanguages;
        const searchTerm = languageFilter.toLowerCase();
        return availableLanguages.filter(
            (language) =>
                language.name.toLowerCase().includes(searchTerm) ||
                language.code.toLowerCase().includes(searchTerm)
        );
    }, [availableLanguages, languageFilter]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(event.target as Node)
            ) {
                setIsDropdownOpen(false);
                if (isEditing && !languageFilter && previousLanguage) {
                    setLanguageFilter(previousLanguage.refName);
                }
                setIsEditing(false);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [isEditing, previousLanguage, languageFilter]);

    const handleLanguageSelect = (code: string, name: string) => {
        const language: LanguageMetadata = {
            name: { en: name },
            tag: code,
            refName: name,
            projectStatus: projectStatus === "source" ? "source" : "target",
        };
        setPreviousLanguage(language);
        setLanguageFilter(name);
        setIsDropdownOpen(false);
        setIsEditing(false);
        onLanguageSelect(language);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (isDropdownOpen && filteredLanguages.length > 0) {
            switch (e.key) {
                case "ArrowDown":
                    e.preventDefault();
                    setHighlightedIndex(Math.min(highlightedIndex + 1, filteredLanguages.length - 1));
                    scrollIntoView(highlightedIndex + 1);
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    setHighlightedIndex(Math.max(highlightedIndex - 1, 0));
                    scrollIntoView(highlightedIndex - 1);
                    break;
                case "Enter":
                    e.preventDefault();
                    if (highlightedIndex >= 0 && highlightedIndex < filteredLanguages.length) {
                        const language = filteredLanguages[highlightedIndex];
                        handleLanguageSelect(language.code, language.name);
                    }
                    break;
                case "Escape":
                    e.preventDefault();
                    setIsDropdownOpen(false);
                    break;
            }
        }
    };

    const scrollIntoView = (index: number) => {
        if (listRef.current) {
            const element = listRef.current.children[index] as HTMLElement;
            if (element) {
                element.scrollIntoView({
                    block: "nearest",
                    behavior: "smooth"
                });
            }
        }
    };

    useEffect(() => {
        setHighlightedIndex(-1);
    }, [languageFilter]);

    return (
        <div style={{ marginBottom: "1rem" }} ref={dropdownRef}>
            <label
                htmlFor="language-select"
                style={{ display: "block", marginBottom: "0.5rem" }}
            >
                {label}
            </label>
            <div style={{ position: "relative" }}>
                <input
                    type="text"
                    id="language-select"
                    className="vscode-input"
                    value={languageFilter}
                    placeholder="Search and select language..."
                    onChange={(e) => {
                        setLanguageFilter(e.target.value);
                        setIsDropdownOpen(true);
                    }}
                    onFocus={(e) => {
                        setIsEditing(true);
                        if (languageFilter) {
                            setLanguageFilter("");
                        }
                        setIsDropdownOpen(true);
                    }}
                    onKeyDown={handleKeyDown}
                    style={{
                        width: "100%",
                        padding: "5px 8px",
                        boxSizing: "border-box",
                        backgroundColor: "var(--vscode-input-background)",
                        color: "var(--vscode-input-foreground)",
                        border: "1px solid var(--vscode-input-border)",
                        borderRadius: "2px",
                    }}
                />
                {isDropdownOpen && filteredLanguages.length > 0 && (
                    <div
                        ref={listRef}
                        style={{
                            position: "absolute",
                            top: "100%",
                            left: 0,
                            right: 0,
                            maxHeight: "200px",
                            overflowY: "auto",
                            backgroundColor: "var(--vscode-dropdown-background)",
                            border: "1px solid var(--vscode-dropdown-border)",
                            borderRadius: "2px",
                            zIndex: 1000,
                        }}
                    >
                        {filteredLanguages.map((language, index) => (
                            <div
                                key={language.code}
                                onClick={() => handleLanguageSelect(language.code, language.name)}
                                style={{
                                    padding: "5px 8px",
                                    cursor: "pointer",
                                    backgroundColor:
                                        index === highlightedIndex
                                            ? "var(--vscode-list-activeSelectionBackground)"
                                            : previousLanguage?.tag === language.code
                                            ? "var(--vscode-list-inactiveSelectionBackground)"
                                            : "transparent",
                                    color:
                                        index === highlightedIndex
                                            ? "var(--vscode-list-activeSelectionForeground)"
                                            : "var(--vscode-dropdown-foreground)",
                                }}
                                onMouseEnter={() => setHighlightedIndex(index)}
                                onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
                                    if ((e.relatedTarget as HTMLElement)?.parentElement !== listRef.current) {
                                        setHighlightedIndex(-1);
                                    }
                                }}
                            >
                                {language.name} ({language.code})
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}; 