import React, { useState, useMemo, useRef, useEffect } from "react";
import {
    VSCodeButton,
    VSCodeDropdown,
    VSCodeOption,
    VSCodeCheckbox,
    VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react";
import {
    getAvailableLanguages,
    getBiblesForLanguage,
    ExtendedMetadata,
} from "../../../../../src/utils/ebible/ebibleCorpusUtils";
import "../../shared/components/LanguagePicker.css";

interface BibleDownloadFormProps {
    onDownload: (metadata: ExtendedMetadata, asTranslationOnly: boolean) => void;
    onCancel: () => void;
    error?: string;
    onRetry?: () => void;
    initialLanguage?: string;
}

interface BibleInfo {
    id: string;
    displayTitle: string;
    coverage: string;
    year: string;
}

export const BibleDownloadForm: React.FC<BibleDownloadFormProps> = ({
    onDownload,
    onCancel,
    error,
    onRetry,
    initialLanguage
}) => {
    const [selectedLanguage, setSelectedLanguage] = useState<string>(initialLanguage || "");
    const [languageFilter, setLanguageFilter] = useState<string>(() => {
        if (initialLanguage) {
            const language = getAvailableLanguages().find(l => l.code === initialLanguage);
            return language ? language.name : "";
        }
        return "";
    });
    const [selectedBible, setSelectedBible] = useState<string>("");
    const [bibleFilter, setBibleFilter] = useState<string>("");
    const [asTranslationOnly, setAsTranslationOnly] = useState(false);
    const [isLanguageDropdownOpen, setIsLanguageDropdownOpen] = useState(false);
    const [isBibleDropdownOpen, setIsBibleDropdownOpen] = useState(false);
    const [previousLanguage, setPreviousLanguage] = useState<{code: string, name: string} | null>(null);
    const [previousBible, setPreviousBible] = useState<BibleInfo | null>(null);
    const [isLanguageEditing, setIsLanguageEditing] = useState(false);
    const [isBibleEditing, setIsBibleEditing] = useState(false);
    const [highlightedLanguageIndex, setHighlightedLanguageIndex] = useState(-1);
    const [highlightedBibleIndex, setHighlightedBibleIndex] = useState(-1);
    
    const languageDropdownRef = useRef<HTMLDivElement>(null);
    const bibleDropdownRef = useRef<HTMLDivElement>(null);
    const languageListRef = useRef<HTMLDivElement>(null);
    const bibleListRef = useRef<HTMLDivElement>(null);

    const availableLanguages = useMemo(() => getAvailableLanguages(), []);

    const filteredLanguages = useMemo(() => {
        if (!languageFilter) return availableLanguages;
        const searchTerm = languageFilter.toLowerCase();
        
        // Filter languages and calculate scores
        const scoredLanguages = availableLanguages
            .map(language => {
                const name = language.name.toLowerCase();
                const code = language.code.toLowerCase();
                let score = 0;
                
                // Exact matches get highest score
                if (name === searchTerm) score += 100;
                if (code === searchTerm) score += 90;
                
                // Starts with gets high score
                if (name.startsWith(searchTerm)) score += 80;
                if (code.startsWith(searchTerm)) score += 70;
                
                // Contains gets medium score
                if (name.includes(searchTerm)) score += 60;
                if (code.includes(searchTerm)) score += 50;
                
                // Word boundary matches get bonus points
                const words = name.split(/[\s-_]+/);
                if (words.some(word => word.startsWith(searchTerm))) score += 20;
                
                // Consecutive character matches get points
                let consecutiveMatches = 0;
                let searchIndex = 0;
                for (const char of name) {
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
                return (a.language.name?.length || 0) - (b.language.name?.length || 0);
            })
            .map(item => item.language);

        return scoredLanguages;
    }, [availableLanguages, languageFilter]);

    const availableBibles = useMemo(() => {
        if (!selectedLanguage) return [];

        const bibles = getBiblesForLanguage(selectedLanguage);
        return bibles.map((bible) => {
            let coverage = "";
            if (bible.OTbooks === 39 && bible.NTbooks === 27) {
                coverage = "Full Bible";
            } else if (bible.OTbooks === 39 && bible.NTbooks === 0) {
                coverage = "OT Only";
            } else if (bible.OTbooks === 0 && bible.NTbooks === 27) {
                coverage = "NT Only";
            } else {
                coverage =
                    `Partial` +
                    (bible.OTbooks && bible.NTbooks
                        ? ` (${bible.OTbooks + bible.NTbooks} books)`
                        : bible.OTbooks
                        ? ` (${bible.OTbooks} books)`
                        : bible.NTbooks
                        ? ` (${bible.NTbooks} books)`
                        : "");
            }

            const dateStr = bible.UpdateDate || bible.sourceDate || "";
            const year = dateStr.split("-")[0] || dateStr;

            return {
                id: bible.translationId,
                displayTitle: bible.shortTitle || bible.title || bible.translationId,
                coverage,
                year: year ? `(${year})` : "",
            } as BibleInfo;
        });
    }, [selectedLanguage]);

    const filteredBibles = useMemo(() => {
        if (!selectedLanguage) return [];
        if (!bibleFilter) return availableBibles;
        
        const searchTerm = bibleFilter.toLowerCase();
        
        // Filter bibles and calculate scores
        const scoredBibles = availableBibles
            .map(bible => {
                const displayTitle = bible.displayTitle.toLowerCase();
                const coverage = bible.coverage.toLowerCase();
                const year = bible.year.toLowerCase();
                let score = 0;
                
                // Exact matches get highest score
                if (displayTitle === searchTerm) score += 100;
                
                // Starts with gets high score
                if (displayTitle.startsWith(searchTerm)) score += 80;
                
                // Contains gets medium score
                if (displayTitle.includes(searchTerm)) score += 60;
                if (coverage.includes(searchTerm)) score += 50;
                if (year.includes(searchTerm)) score += 40;
                
                // Word boundary matches get bonus points
                const words = displayTitle.split(/[\s-_]+/);
                if (words.some(word => word.startsWith(searchTerm))) score += 20;
                
                // Consecutive character matches get points
                let consecutiveMatches = 0;
                let searchIndex = 0;
                for (const char of displayTitle) {
                    if (char === searchTerm[searchIndex]) {
                        consecutiveMatches++;
                        searchIndex++;
                    } else {
                        searchIndex = 0;
                    }
                }
                score += consecutiveMatches * 2;
                
                return { bible, score };
            })
            .filter(item => item.score > 0) // Only keep matches
            .sort((a, b) => {
                // Sort by score first
                if (b.score !== a.score) return b.score - a.score;
                // Then by title length (shorter names first)
                return (a.bible.displayTitle.length) - (b.bible.displayTitle.length);
            })
            .map(item => item.bible);

        return scoredBibles;
    }, [selectedLanguage, availableBibles, bibleFilter]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                languageDropdownRef.current &&
                !languageDropdownRef.current.contains(event.target as Node)
            ) {
                setIsLanguageDropdownOpen(false);
                if (isLanguageEditing && !selectedLanguage && previousLanguage) {
                    setSelectedLanguage(previousLanguage.code);
                    setLanguageFilter(previousLanguage.name);
                }
                setIsLanguageEditing(false);
            }
            if (
                bibleDropdownRef.current &&
                !bibleDropdownRef.current.contains(event.target as Node)
            ) {
                setIsBibleDropdownOpen(false);
                if (isBibleEditing && !selectedBible && previousBible) {
                    setSelectedBible(previousBible.id);
                    setBibleFilter(`${previousBible.displayTitle} ${previousBible.year} - ${previousBible.coverage}`);
                }
                setIsBibleEditing(false);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [isLanguageEditing, isBibleEditing, previousLanguage, previousBible, selectedLanguage, selectedBible]);

    const handleLanguageSelect = (code: string, name: string) => {
        // If selecting the same language as before, preserve Bible selection
        const isSameLanguage = code === previousLanguage?.code;
        setPreviousLanguage({ code, name });
        setSelectedLanguage(code);
        setLanguageFilter(name);
        setIsLanguageDropdownOpen(false);
        setIsLanguageEditing(false);
        
        // Only reset Bible selection if selecting a different language
        if (!isSameLanguage) {
            setSelectedBible("");
            setBibleFilter("");
            setPreviousBible(null);
        }
    };

    const handleBibleSelect = (bible: BibleInfo) => {
        setPreviousBible(bible);
        setSelectedBible(bible.id);
        setBibleFilter(`${bible.displayTitle} ${bible.year} - ${bible.coverage}`);
        setIsBibleDropdownOpen(false);
        setIsBibleEditing(false);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (selectedLanguage && selectedBible) {
            const bibles = getBiblesForLanguage(selectedLanguage);
            const selectedMetadata = bibles.find((b) => b.translationId === selectedBible);
            if (selectedMetadata) {
                onDownload(selectedMetadata, asTranslationOnly);
            }
        }
    };

    const handleKeyDown = (
        e: React.KeyboardEvent,
        items: any[],
        highlightedIndex: number,
        setHighlightedIndex: (index: number) => void,
        handleSelect: Function,
        listRef: React.RefObject<HTMLDivElement>
    ) => {
        switch (e.key) {
            case "ArrowDown":
                e.preventDefault();
                setHighlightedIndex(Math.min(highlightedIndex + 1, items.length - 1));
                scrollIntoView(highlightedIndex + 1, listRef);
                break;
            case "ArrowUp":
                e.preventDefault();
                setHighlightedIndex(Math.max(highlightedIndex - 1, 0));
                scrollIntoView(highlightedIndex - 1, listRef);
                break;
            case "Enter":
                e.preventDefault();
                if (highlightedIndex >= 0 && highlightedIndex < items.length) {
                    const item = items[highlightedIndex];
                    if ('code' in item) {
                        handleSelect(item.code, item.name);
                    } else {
                        handleSelect(item);
                    }
                }
                break;
            case "Escape":
                e.preventDefault();
                if ('code' in items[0]) {
                    setIsLanguageDropdownOpen(false);
                } else {
                    setIsBibleDropdownOpen(false);
                }
                break;
        }
    };

    const scrollIntoView = (index: number, listRef: React.RefObject<HTMLDivElement>) => {
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

    // Reset highlighted indices when filter changes
    useEffect(() => {
        setHighlightedLanguageIndex(-1);
    }, [languageFilter]);

    useEffect(() => {
        setHighlightedBibleIndex(-1);
    }, [bibleFilter]);

    return (
        <form
            onSubmit={handleSubmit}
            style={{
                display: "flex",
                flexDirection: "column",
                gap: "1rem",
                maxWidth: "400px",
                margin: "0 auto",
                padding: "1.5rem",
            }}
        >
            <h2>Download Bible Translation</h2>

            <div style={{ marginBottom: "1rem" }} ref={languageDropdownRef}>
                <label
                    htmlFor="language-select"
                    className="language-picker__label"
                >
                    Select Language
                </label>
                <div className="language-picker__container">
                    <input
                        type="text"
                        id="language-select"
                        className="vscode-input"
                        value={languageFilter}
                        placeholder="Search and select language..."
                        onChange={(e) => {
                            setLanguageFilter(e.target.value);
                            setIsLanguageDropdownOpen(true);
                        }}
                        onFocus={(e) => {
                            setIsLanguageEditing(true);
                            if (selectedLanguage) {
                                setLanguageFilter("");
                                setSelectedLanguage("");
                            }
                            setIsLanguageDropdownOpen(true);
                        }}
                        onKeyDown={(e) => {
                            if (isLanguageDropdownOpen && filteredLanguages.length > 0) {
                                handleKeyDown(
                                    e,
                                    filteredLanguages,
                                    highlightedLanguageIndex,
                                    setHighlightedLanguageIndex,
                                    handleLanguageSelect,
                                    languageListRef
                                );
                            }
                        }}
                    />
                    {isLanguageDropdownOpen && filteredLanguages.length > 0 && (
                        <div
                            ref={languageListRef}
                            className="language-picker__dropdown"
                        >
                            {filteredLanguages.map((language, index) => (
                                <div
                                    key={language.code}
                                    onClick={() => handleLanguageSelect(language.code, language.name)}
                                    className={`language-picker__option ${
                                        index === highlightedLanguageIndex
                                            ? "language-picker__option--highlighted"
                                            : selectedLanguage === language.code
                                            ? "language-picker__option--selected"
                                            : ""
                                    }`}
                                    onMouseEnter={() => setHighlightedLanguageIndex(index)}
                                    onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
                                        if ((e.relatedTarget as HTMLElement)?.parentElement !== languageListRef.current) {
                                            setHighlightedLanguageIndex(-1);
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

            {selectedLanguage && (
                <div style={{ marginBottom: "1rem" }} ref={bibleDropdownRef}>
                    <label
                        htmlFor="bible-select"
                        className="language-picker__label"
                    >
                        Select Bible Translation
                    </label>
                    <div className="language-picker__container">
                        <input
                            type="text"
                            id="bible-select"
                            className="vscode-input"
                            value={bibleFilter}
                            placeholder="Search and select Bible translation..."
                            onChange={(e) => {
                                setBibleFilter(e.target.value);
                                setIsBibleDropdownOpen(true);
                            }}
                            onFocus={(e) => {
                                setIsBibleEditing(true);
                                if (selectedBible) {
                                    setBibleFilter("");
                                    setSelectedBible("");
                                }
                                setIsBibleDropdownOpen(true);
                            }}
                            onKeyDown={(e) => {
                                if (isBibleDropdownOpen && filteredBibles.length > 0) {
                                    handleKeyDown(
                                        e,
                                        filteredBibles,
                                        highlightedBibleIndex,
                                        setHighlightedBibleIndex,
                                        handleBibleSelect,
                                        bibleListRef
                                    );
                                }
                            }}
                        />
                        {isBibleDropdownOpen && filteredBibles.length > 0 && (
                            <div
                                ref={bibleListRef}
                                className="language-picker__dropdown"
                            >
                                {filteredBibles.map((bible, index) => (
                                    <div
                                        key={bible.id}
                                        onClick={() => handleBibleSelect(bible)}
                                        className={`language-picker__option ${
                                            index === highlightedBibleIndex
                                                ? "language-picker__option--highlighted"
                                                : selectedBible === bible.id
                                                ? "language-picker__option--selected"
                                                : ""
                                        }`}
                                        onMouseEnter={() => setHighlightedBibleIndex(index)}
                                        onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
                                            if ((e.relatedTarget as HTMLElement)?.parentElement !== bibleListRef.current) {
                                                setHighlightedBibleIndex(-1);
                                            }
                                        }}
                                    >
                                        {bible.displayTitle} {bible.year} - {bible.coverage}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            <div style={{ marginBottom: "1rem" }}>
                <VSCodeCheckbox
                    checked={asTranslationOnly}
                    onChange={(e) => setAsTranslationOnly((e.target as HTMLInputElement).checked)}
                >
                    Import as translation only (not as a source text)
                </VSCodeCheckbox>
            </div>

            <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end" }}>
                <VSCodeButton appearance="secondary" onClick={onCancel}>
                    Cancel
                </VSCodeButton>
                <VSCodeButton type="submit" disabled={!selectedLanguage || !selectedBible}>
                    Download
                </VSCodeButton>
            </div>
        </form>
    );
};
