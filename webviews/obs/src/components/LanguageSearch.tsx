import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import { LanguageMetadata } from "codex-types";
import { List } from "react-virtualized";

const LanguageSearch = ({
    label,
    value,
    languages,
    onFocus,
    isActive,
    setLanguage,
    setQuery,
    setActive,
}: {
    label: string;
    value: string;
    languages: LanguageMetadata[];
    onFocus: () => void;
    setQuery: (query: string) => void;
    isActive: boolean;
    setLanguage: (language: LanguageMetadata) => void;
    setActive: (active: boolean) => void;
}) => {
    return (
        <div className="flex flex-col gap-2">
            <label htmlFor="target_language">{label}</label>
            <VSCodeTextField
                placeholder={`Search ${label.toLowerCase()}...`}
                value={value}
                onFocus={onFocus}
                onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
                className="w-48 rounded text-sm"
            />
            {isActive && (
                <List
                    className="border rounded-md"
                    width={200}
                    height={120}
                    rowCount={languages.length}
                    rowHeight={30}
                    rowRenderer={({ index, key, style }) => {
                        const language = languages[index];
                        return (
                            <div
                                className="cursor-pointer pl-2"
                                key={key}
                                style={style}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setLanguage(language);
                                    setActive(false);
                                }}
                            >
                                {language?.refName} ({language?.tag})
                            </div>
                        );
                    }}
                />
            )}
        </div>
    );
};

export default LanguageSearch;
