import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import { List } from "react-virtualized";
import { MessageType, TranslationWord } from "../types";
import { useCallback, useEffect, useRef, useState } from "react";
import { vscode } from "../utilities/vscode";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown } from "lucide-react";

const TranslationWordsDropdown = ({
    setTranslationWord,
    selectedTranslationWord,
}: {
    setTranslationWord: (language: TranslationWord) => void;
    selectedTranslationWord: TranslationWord | null;
}) => {
    const [searchOpen, setSearchOpen] = useState(false);

    const [query, setQuery] = useState("");

    const { translationWords, searchTranslationWords } = useTranslationWords();

    const textFieldRef = useRef<HTMLTextAreaElement>(null);

    const [textFieldWidth, setTextFieldWidth] = useState<number>(
        textFieldRef.current?.offsetWidth ?? 300,
    );
    useEffect(() => {
        if (textFieldRef.current) {
            window.addEventListener("resize", handleResize);
            handleResize(); // Initial calculation of the width of the text field
        }
        return () => {
            window.removeEventListener("resize", handleResize);
        };
    }, [textFieldRef]);

    const onFocus: React.FocusEventHandler<HTMLElement> = () => {
        handleResize(); // Initial calculation of the width of the text field
    };
    const handleResize = () => {
        setTextFieldWidth(textFieldRef?.current?.offsetWidth ?? 300);
    };

    useEffect(() => {
        searchTranslationWords(query);
    }, [query, searchTranslationWords]);

    const handleCloseSearch = (open: boolean) => {
        setQuery("");
        searchTranslationWords("");
        setSearchOpen(open);
    };

    return (
        <Popover.Root open={searchOpen} onOpenChange={handleCloseSearch}>
            <div className="w-full">
                <label htmlFor="target_language">Translation Word</label>

                <Popover.Trigger asChild>
                    <div
                        role="combobox"
                        aria-expanded={searchOpen}
                        className="flex items-center justify-between rounded-sm transition-colors focus-visible:outline-none =focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background color-[--vscode-input-foreground] bg-[--vscode-input-background] border border-[--vscode-input-border] focus-visible:border-ring px-2 py-1 max-w-xl"
                        // getting the right types requires installation of a library which is useless if that library is not being used
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        ref={textFieldRef as any}
                        onFocus={onFocus}
                    >
                        <span>
                            {selectedTranslationWord
                                ? `${selectedTranslationWord?.name}`
                                : "Select translation word"}
                        </span>
                        <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </div>
                </Popover.Trigger>
            </div>

            <Popover.Portal>
                <Popover.Content asChild>
                    <div className="bg-[--dropdown-background]">
                        <div className="w-full">
                            <VSCodeTextField
                                placeholder={`Search translation word ...`}
                                value={query}
                                onInput={(e) =>
                                    setQuery(
                                        (e.target as HTMLInputElement).value,
                                    )
                                }
                                className="rounded text-sm w-full"
                            />
                        </div>
                        <List
                            className="rounded-md bg-[--panel-view-background] outline-0"
                            width={textFieldWidth}
                            height={300}
                            rowCount={translationWords.length}
                            rowHeight={30}
                            rowRenderer={({ index, key, style }) => {
                                const translationWord = translationWords[index];
                                return (
                                    <Popover.Close asChild>
                                        <div
                                            className="cursor-pointer pl-2"
                                            key={key}
                                            style={style}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setTranslationWord(
                                                    translationWord,
                                                );
                                            }}
                                        >
                                            {translationWord?.name}
                                        </div>
                                    </Popover.Close>
                                );
                            }}
                        />
                    </div>
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
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
