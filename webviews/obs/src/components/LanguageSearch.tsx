import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import { LanguageMetadata } from "codex-types";
import { useEffect, useRef, useState } from "react";
import { List } from "react-virtualized";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown } from "lucide-react";

const LanguageSearch = ({
    label,
    value,
    languages,
    setLanguage,
    setQuery,
    selectedLanguage,
}: {
    label: string;
    value: string;
    languages: LanguageMetadata[];
    setQuery: (query: string) => void;
    selectedLanguage: LanguageMetadata | null;
    setLanguage: (language: LanguageMetadata) => void;
}) => {
    const textFieldRef = useRef<HTMLTextAreaElement>(null);

    const [textFieldWidth, setTextFieldWidth] = useState<number>(
        textFieldRef.current?.offsetWidth ?? 300,
    );
    const handleResize = () => {
        setTextFieldWidth(textFieldRef?.current?.offsetWidth ?? 300);
    };
    useEffect(() => {
        if (textFieldRef.current) {
            window.addEventListener("resize", handleResize);
            handleResize(); // Initial calculation of the width of the text field
        }
        return () => {
            window.removeEventListener("resize", handleResize);
        };
    }, [textFieldRef]);
    const [searchOpen, setSearchOpen] = useState(false);

    const onFocus: React.FocusEventHandler<HTMLElement> = () => {
        handleResize(); // Initial calculation of the width of the text field
    };

    const handleCloseSearch = (open: boolean) => {
        setSearchOpen(open);
    };

    return (
        <Popover.Root open={searchOpen} onOpenChange={handleCloseSearch}>
            <Popover.Trigger asChild>
                <div className="w-full">
                    <label htmlFor="target_language">{label}</label>
                    <div
                        role="combobox"
                        aria-expanded={searchOpen}
                        className="flex items-center justify-between rounded-sm transition-colors focus-visible:outline-none =focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background color-[--vscode-input-foreground] bg-[--vscode-input-background] border border-[--vscode-input-border] focus-visible:border-ring px-2 py-1"
                        // getting the right types requires installation of a library which is useless if that library is not being used
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        ref={textFieldRef as any}
                        onFocus={onFocus}
                    >
                        <span>
                            {selectedLanguage
                                ? `${selectedLanguage?.refName} (${selectedLanguage?.tag})`
                                : "Select Language"}
                        </span>
                        <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </div>
                </div>
            </Popover.Trigger>

            <Popover.Portal>
                <Popover.Content asChild>
                    <div className="bg-[--dropdown-background]">
                        <div className="w-full">
                            <VSCodeTextField
                                placeholder={`Search ${label.toLowerCase()}...`}
                                value={value}
                                onInput={(e) =>
                                    setQuery(
                                        (e.target as HTMLInputElement).value,
                                    )
                                }
                                className="rounded text-sm w-full"
                                // ref={textFieldRef as any}
                            />
                        </div>

                        <List
                            className="rounded-md bg-[--panel-view-background] outline-0"
                            width={textFieldWidth}
                            height={300}
                            rowCount={languages.length}
                            rowHeight={30}
                            rowRenderer={({ index, key, style }) => {
                                const language = languages[index];
                                return (
                                    <Popover.Close asChild>
                                        <div
                                            className="cursor-pointer pl-2"
                                            key={key}
                                            style={style}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setLanguage(language);
                                            }}
                                        >
                                            {language?.refName} ({language?.tag}
                                            )
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

export default LanguageSearch;
