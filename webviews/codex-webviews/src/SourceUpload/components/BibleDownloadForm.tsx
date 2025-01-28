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

interface BibleDownloadFormProps {
    onDownload: (metadata: ExtendedMetadata, asTranslationOnly: boolean) => void;
    onCancel: () => void;
}

interface BibleInfo {
    id: string;
    displayTitle: string;
    coverage: string;
    year: string;
}

export const BibleDownloadForm: React.FC<BibleDownloadFormProps> = ({ onDownload, onCancel }) => {
    const [selectedLanguage, setSelectedLanguage] = useState<string>("");
    const [languageFilter, setLanguageFilter] = useState<string>("");
    const [selectedBible, setSelectedBible] = useState<string>("");
    const [bibleFilter, setBibleFilter] = useState<string>("");
    const [asTranslationOnly, setAsTranslationOnly] = useState(false);
    const [isLanguageDropdownOpen, setIsLanguageDropdownOpen] = useState(false);
    const [isBibleDropdownOpen, setIsBibleDropdownOpen] = useState(false);
    const languageDropdownRef = useRef<HTMLDivElement>(null);
    const bibleDropdownRef = useRef<HTMLDivElement>(null);

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
        if (!bibleFilter) return availableBibles;
        const searchTerm = bibleFilter.toLowerCase();
        return availableBibles.filter(
            (bible) =>
                bible.displayTitle.toLowerCase().includes(searchTerm) ||
                bible.coverage.toLowerCase().includes(searchTerm)
        );
    }, [availableBibles, bibleFilter]);

    // Close dropdowns when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                languageDropdownRef.current &&
                !languageDropdownRef.current.contains(event.target as Node)
            ) {
                setIsLanguageDropdownOpen(false);
            }
            if (
                bibleDropdownRef.current &&
                !bibleDropdownRef.current.contains(event.target as Node)
            ) {
                setIsBibleDropdownOpen(false);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleLanguageSelect = (code: string, name: string) => {
        setSelectedLanguage(code);
        setLanguageFilter(name);
        setIsLanguageDropdownOpen(false);
        setSelectedBible(""); // Reset bible selection when language changes
        setBibleFilter(""); // Reset bible filter when language changes
    };

    const handleBibleSelect = (bible: BibleInfo) => {
        setSelectedBible(bible.id);
        setBibleFilter(`${bible.displayTitle} ${bible.year} - ${bible.coverage}`);
        setIsBibleDropdownOpen(false);
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
                    style={{ display: "block", marginBottom: "0.5rem" }}
                >
                    Select Language
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
                            setIsLanguageDropdownOpen(true);
                        }}
                        onFocus={() => setIsLanguageDropdownOpen(true)}
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
                    {isLanguageDropdownOpen && filteredLanguages.length > 0 && (
                        <div
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
                            {filteredLanguages.map((language) => (
                                <div
                                    key={language.code}
                                    onClick={() =>
                                        handleLanguageSelect(language.code, language.name)
                                    }
                                    style={{
                                        padding: "5px 8px",
                                        cursor: "pointer",
                                        backgroundColor:
                                            selectedLanguage === language.code
                                                ? "var(--vscode-list-activeSelectionBackground)"
                                                : "transparent",
                                        color:
                                            selectedLanguage === language.code
                                                ? "var(--vscode-list-activeSelectionForeground)"
                                                : "var(--vscode-dropdown-foreground)",
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor =
                                            "var(--vscode-list-hoverBackground)";
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor =
                                            selectedLanguage === language.code
                                                ? "var(--vscode-list-activeSelectionBackground)"
                                                : "transparent";
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
                        style={{ display: "block", marginBottom: "0.5rem" }}
                    >
                        Select Bible Translation
                    </label>
                    <div style={{ position: "relative" }}>
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
                            onFocus={() => setIsBibleDropdownOpen(true)}
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
                        {isBibleDropdownOpen && filteredBibles.length > 0 && (
                            <div
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
                                {filteredBibles.map((bible) => (
                                    <div
                                        key={bible.id}
                                        onClick={() => handleBibleSelect(bible)}
                                        style={{
                                            padding: "5px 8px",
                                            cursor: "pointer",
                                            backgroundColor:
                                                selectedBible === bible.id
                                                    ? "var(--vscode-list-activeSelectionBackground)"
                                                    : "transparent",
                                            color:
                                                selectedBible === bible.id
                                                    ? "var(--vscode-list-activeSelectionForeground)"
                                                    : "var(--vscode-dropdown-foreground)",
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.backgroundColor =
                                                "var(--vscode-list-hoverBackground)";
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.backgroundColor =
                                                selectedBible === bible.id
                                                    ? "var(--vscode-list-activeSelectionBackground)"
                                                    : "transparent";
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
