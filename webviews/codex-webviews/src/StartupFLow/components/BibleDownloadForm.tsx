import React, { useState, useMemo } from "react";
import {
    VSCodeButton,
    VSCodeDropdown,
    VSCodeOption,
    VSCodeCheckbox,
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
    const [selectedBible, setSelectedBible] = useState<string>("");
    const [asTranslationOnly, setAsTranslationOnly] = useState(false);

    const availableLanguages = useMemo(() => getAvailableLanguages(), []);

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

            <div style={{ marginBottom: "1rem" }}>
                <label
                    htmlFor="language-select"
                    style={{ display: "block", marginBottom: "0.5rem" }}
                >
                    Select Language
                </label>
                <VSCodeDropdown
                    id="language-select"
                    value={selectedLanguage}
                    style={{ width: "100%" }}
                    onChange={(e) => {
                        setSelectedLanguage((e.target as HTMLSelectElement).value);
                        setSelectedBible(""); // Reset bible selection when language changes
                    }}
                >
                    <VSCodeOption value="">Select a language...</VSCodeOption>
                    {availableLanguages.map((language) => (
                        <VSCodeOption key={language.code} value={language.code}>
                            {language.name} ({language.code})
                        </VSCodeOption>
                    ))}
                </VSCodeDropdown>
            </div>

            {selectedLanguage && (
                <div style={{ marginBottom: "1rem" }}>
                    <label
                        htmlFor="bible-select"
                        style={{ display: "block", marginBottom: "0.5rem" }}
                    >
                        Select Bible Translation
                    </label>
                    <VSCodeDropdown
                        id="bible-select"
                        value={selectedBible}
                        style={{ width: "100%" }}
                        onChange={(e) => setSelectedBible((e.target as HTMLSelectElement).value)}
                    >
                        <VSCodeOption value="">Select a translation...</VSCodeOption>
                        {availableBibles.map((bible) => (
                            <VSCodeOption key={bible.id} value={bible.id}>
                                {bible.displayTitle} {bible.year} - {bible.coverage}
                            </VSCodeOption>
                        ))}
                    </VSCodeDropdown>
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
