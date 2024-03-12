import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import { List } from "react-virtualized";
import { MessageType, TranslationWord } from "../types";
import { useCallback, useEffect, useState } from "react";
import { vscode } from "../utilities/vscode";
import { useDebounce } from "@uidotdev/usehooks";

const TranslationWordsDropdown = ({
    setTranslationWord,
}: {
    setTranslationWord: (language: TranslationWord) => void;
}) => {
    const [query, setQuery] = useState("");
    const [isActive, setIsActive] = useState(false);

    const { translationWords, searchTranslationWords } = useTranslationWords();

    const handleFocus = () => {
        setIsActive(true);
    };

    useDebounce(() => {
        searchTranslationWords(query);
    }, 500);

    return (
        <div className="flex flex-col gap-2">
            <label htmlFor="target_translation_word">Translation Word</label>
            <VSCodeTextField
                placeholder={`Search translation word ...`}
                value={query}
                onFocus={handleFocus}
                onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
                className="w-48 rounded text-sm"
            />
            {isActive && (
                <List
                    className="border rounded-md"
                    width={200}
                    height={120}
                    rowCount={translationWords.length}
                    rowHeight={30}
                    rowRenderer={({ index, key, style }) => {
                        const translationWord = translationWords[index];
                        return (
                            <div
                                className="cursor-pointer pl-2"
                                key={key}
                                style={style}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setTranslationWord(translationWord);
                                    setIsActive(false);
                                }}
                            >
                                {translationWord?.name}
                            </div>
                        );
                    }}
                />
            )}
        </div>
    );
};

export const useTranslationWords = () => {
    const [translationWords, setTranslationWords] = useState<TranslationWord[]>(
        [],
    );

    useEffect(() => {
        vscode.setMessageListeners((event) => {
            switch (event.data.type) {
                case "update-tw":
                    setTranslationWords(event.data.payload.translationWords);
                    break;
            }
        });
    }, []);

    const searchTranslationWords = useCallback((query: string) => {
        vscode.postMessage({
            type: MessageType.SEARCH_TW,
            payload: { query },
        });
    }, []);

    return { translationWords, searchTranslationWords };
};

export default TranslationWordsDropdown;
