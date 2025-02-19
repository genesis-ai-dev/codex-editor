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
        return availableLanguages.filter(
            (language) =>
                (language.refName?.toLowerCase() || '').includes(searchTerm) ||
                (language.tag?.toLowerCase() || '').includes(searchTerm)
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
        setHighlightedIndex(filteredLanguages.length > 0 ? 0 : -1);
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