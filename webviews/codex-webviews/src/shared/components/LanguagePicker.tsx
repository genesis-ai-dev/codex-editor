import React, { useState, useMemo, useRef, useEffect } from "react";
import { LanguageCodes } from "../../../../../src/utils/languageUtils";
import { LanguageMetadata, LanguageProjectStatus } from "codex-types";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import "./LanguagePicker.css";

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
        if (initialLanguage?.refName) {
            return initialLanguage.refName;
        }
        return "";
    });
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const [isEditing, setIsEditing] = useState(false);
    const [previousLanguage, setPreviousLanguage] = useState<LanguageMetadata | null>(null);

    const dropdownRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const availableLanguages = useMemo(() => LanguageCodes, []);

    const filteredLanguages = useMemo(() => {
        if (!languageFilter) return availableLanguages;
        const searchTerm = languageFilter.toLowerCase();
        
        // Filter languages and calculate scores
        const scoredLanguages = availableLanguages
            .map(language => {
                const refName = (language.refName || '').toLowerCase();
                const tag = (language.tag || '').toLowerCase();
                let score = 0;
                
                // Exact matches get highest score
                if (refName === searchTerm) score += 100;
                if (tag === searchTerm) score += 90;
                
                // Starts with gets high score
                if (refName.startsWith(searchTerm)) score += 80;
                if (tag.startsWith(searchTerm)) score += 70;
                
                // Contains gets medium score
                if (refName.includes(searchTerm)) score += 60;
                if (tag.includes(searchTerm)) score += 50;
                
                // Word boundary matches get bonus points
                const words = refName.split(/[\s-_]+/);
                if (words.some(word => word.startsWith(searchTerm))) score += 20;
                
                // Consecutive character matches get points
                let consecutiveMatches = 0;
                let searchIndex = 0;
                for (const char of refName) {
                    if (char === searchTerm[searchIndex]) {
                        consecutiveMatches++;
                        searchIndex++;
                    } else {
                        searchIndex = 0;
                    }
                }
                score += consecutiveMatches * 2;
                
                return { language, score };
            })
            .filter(item => item.score > 0) // Only keep matches
            .sort((a, b) => {
                // Sort by score first
                if (b.score !== a.score) return b.score - a.score;
                // Then by name length (shorter names first)
                return (a.language.refName?.length || 0) - (b.language.refName?.length || 0);
            })
            .map(item => item.language);

        return scoredLanguages;
    }, [availableLanguages, languageFilter]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(event.target as Node)
            ) {
                setIsDropdownOpen(false);
                if (isEditing && !languageFilter && previousLanguage) {
                    setLanguageFilter(previousLanguage.refName || "");
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
            projectStatus: projectStatus === "source" ? LanguageProjectStatus.SOURCE : LanguageProjectStatus.TARGET,
        };
        setPreviousLanguage(language);
        setLanguageFilter(name);
        setIsDropdownOpen(false);
        setIsEditing(false);
        onLanguageSelect(language);
    };

    const handleCustomLanguageSelect = (customName: string) => {
        if (!customName.trim()) return;
        
        const language: LanguageMetadata = {
            name: { en: customName },
            tag: "custom",
            refName: customName,
            projectStatus: projectStatus === "source" ? LanguageProjectStatus.SOURCE : LanguageProjectStatus.TARGET,
        };
        setPreviousLanguage(language);
        setLanguageFilter(customName);
        setIsDropdownOpen(false);
        setIsEditing(false);
        onLanguageSelect(language);
    };

    useEffect(() => {
        if (filteredLanguages.length > 0){
            setHighlightedIndex(0)
        }
    }, [languageFilter, filteredLanguages.length]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (isDropdownOpen) {
            const totalOptions = filteredLanguages.length + (languageFilter ? 1 : 0);
            
            switch (e.key) {
                case "ArrowDown":
                    e.preventDefault();
                    setHighlightedIndex(prev => {
                        const next = prev + 1;
                        return next < totalOptions ? next : prev;
                    });
                    scrollIntoView(highlightedIndex + 1);
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    setHighlightedIndex(prev => Math.max(prev - 1, 0));
                    scrollIntoView(highlightedIndex - 1);
                    break;
                case "Enter":
                    e.preventDefault();
                    if (highlightedIndex === filteredLanguages.length && languageFilter) {
                        handleCustomLanguageSelect(languageFilter);
                    } else if (highlightedIndex >= 0 && highlightedIndex < filteredLanguages.length) {
                        const language = filteredLanguages[highlightedIndex];
                        handleLanguageSelect(language.tag || '', language.refName || '');
                    }
                    break;
                case "Escape":
                    e.preventDefault();
                    setIsDropdownOpen(false);
                    break;
            }
        } else if (e.key === "Enter" && languageFilter.trim()) {
            e.preventDefault();
            handleCustomLanguageSelect(languageFilter);
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

    return (
        <div className="language-picker" ref={dropdownRef}>
            <label
                htmlFor="language-select"
                className="language-picker__label"
            >
                {label}
            </label>
            <div className="language-picker__container">
                <input
                    type="text"
                    id="language-select"
                    className="vscode-input"
                    value={languageFilter}
                    placeholder="Search for a language..."
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
                        setHighlightedIndex(0);
                    }}
                    onKeyDown={handleKeyDown}
                />
                {isDropdownOpen && (
                    <div
                        ref={listRef}
                        className="language-picker__dropdown"
                    >
                        {filteredLanguages.map((language, index) => (
                            <div
                                key={language.tag || ''}
                                onClick={() => handleLanguageSelect(language.tag || '', language.refName || '')}
                                className={`language-picker__option ${
                                    index === highlightedIndex 
                                        ? 'language-picker__option--highlighted' 
                                        : previousLanguage?.tag === language.tag 
                                            ? 'language-picker__option--selected' 
                                            : ''
                                }`}
                                onMouseEnter={() => setHighlightedIndex(index)}
                                onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
                                    if ((e.relatedTarget as HTMLElement)?.parentElement !== listRef.current) {
                                        setHighlightedIndex(0);
                                    }
                                }}
                            >
                                {language.refName || ''} ({language.tag || ''})
                            </div>
                        ))}
                        {languageFilter && (
                            <div
                                className={`language-picker__option language-picker__custom-option ${
                                    highlightedIndex === filteredLanguages.length 
                                        ? 'language-picker__option--highlighted' 
                                        : ''
                                }`}
                                onClick={() => handleCustomLanguageSelect(languageFilter)}
                                onMouseEnter={() => setHighlightedIndex(filteredLanguages.length)}
                            >
                                <i className="codicon codicon-plus"></i> Create Custom Language "{languageFilter}"
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}; 