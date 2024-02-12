/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState } from "react";
import { renderToPage } from "../utilities/main-vscode";
import {
    VSCodeButton,
    VSCodeTextArea,
    VSCodeTextField,
    VSCodeDropdown,
    VSCodeOption,
} from "@vscode/webview-ui-toolkit/react";

import { vscode } from "../utilities/vscode";
import staticLangs from "@/data/languages.json";
import { List } from "react-virtualized";

import { Search } from "lucide-react";
import advancedSettings from "@/data/AdvanceSettings.json";
import { Copyright, Language, MessageType } from "../types";

const Sidebar = () => {
    const [projectName, setProjectName] = useState("");
    const [description, setDescription] = useState("");
    const [abbreviation, setAbbreviation] = useState("");
    const licenseList = advancedSettings.copyright;
    const [copyright, setCopyright] = useState<Copyright>();
    const [language, setLanguage] = useState<Language>();
    const [filteredLanguages, setFilteredLanguages] =
        useState<Language[]>(staticLangs);
    const [active, setActive] = useState(false);
    const [query, setQuery] = useState("");

    const sendQueryToHost = (query: string) => {
        vscode.postMessage({
            type: MessageType.SEARCH_QUERY,
            payload: query,
        });
    };

    // Function to handle messages from extension host
    useEffect(() => {
        window.addEventListener("message", (event: MessageEvent) => {
            const data = event.data; // The JSON data our extension sent
            switch (data.type) {
                case MessageType.SEARCH_RESULTS:
                    setFilteredLanguages(data.payload);
                    break;
            }
        });
    }, []);

    // Update the onChange event handler of the Combobox.Input
    const handleInputChange = (query: string) => {
        setQuery(query);
        sendQueryToHost(query);
    };

    const handleSubmit = () => {
        vscode.postMessage({
            type: MessageType.createProject,
            payload: {
                projectName,
                description,
                abbreviation,
                language,
                copyright,
            },
        });
    };

    return (
        <div className="rounded-md border shadow-sm mt-4 ml-5 mr-5 mb-5">
            <div className="space-y-2 m-10">
                <span>Project Type : OBS</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 m-10 gap-5">
                <div className="lg:col-span-1">
                    <VSCodeTextField
                        type="text"
                        name="project_name"
                        id="project_name"
                        value={projectName}
                        onChange={(e) => {
                            setProjectName(
                                (e.target as HTMLInputElement).value,
                            );
                        }}
                        className={
                            "w-48 lg:w-full rounded shadow-sm sm:text-sm mb-6"
                        }
                    >
                        Project Name
                    </VSCodeTextField>
                    {/* <span className="text-error">
            {error.projectName[0]?.message || error.projectName[1]?.message}
          </span> */}

                    <VSCodeTextArea
                        name="Description"
                        id="project_description"
                        value={description}
                        onChange={(e) => {
                            setDescription(
                                (e.target as HTMLTextAreaElement).value,
                            );
                        }}
                        className="w-48 lg:w-full h-28 block rounded shadow-sm sm:text-sm focus:border-primary"
                    >
                        Description
                    </VSCodeTextArea>
                    {/* <span className="text-error">{error.description[0]?.message}</span> */}
                </div>
                <div className="lg:col-span-2">
                    <div className="flex gap-5">
                        <div>
                            <VSCodeTextField
                                type="text"
                                name="version_abbreviated"
                                id="version_abbreviated"
                                value={abbreviation}
                                onInput={(e) => {
                                    setAbbreviation(
                                        (e.target as HTMLInputElement).value,
                                    );
                                }}
                                className="w-24 block rounded  sm:text-sm focus:border-primary border-gray-300"
                            >
                                Abbreviation
                            </VSCodeTextField>
                        </div>
                    </div>
                    <div className="flex gap-5 mt-5 items-center">
                        <div>
                            <div className="flex gap-4 items-center mb-2">
                                <h4 className="flex items-center gap-1">
                                    Target Language{" "}
                                    <span className="text-error">*</span>
                                </h4>
                            </div>
                            <div className="relative mt-2">
                                <div className="relative w-48 cursor-default overflow-hidden rounded-lg text-left shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-white/75 focus-visible:ring-offset-2 focus-visible:ring-offset-teal-300 sm:text-sm">
                                    <VSCodeTextField
                                        className="w-full border-none rounded-md py-2 text-sm leading-5"
                                        onInput={(event) => {
                                            handleInputChange(
                                                (
                                                    event.target as HTMLInputElement
                                                ).value,
                                            );
                                            setActive(true);
                                        }}
                                        onFocus={() => {
                                            setActive(true);
                                            setLanguage(undefined);
                                        }}
                                        value={
                                            language
                                                ? language.ang || language.lc
                                                : query
                                        }
                                        placeholder="Search Language"
                                    />
                                    <button className="absolute inset-y-0 w-min flex items-center justify-center right-0 px-2">
                                        <Search
                                            className="h-5 w-5"
                                            aria-hidden="true"
                                        />
                                    </button>
                                </div>

                                {active && (
                                    <List
                                        className="absolute mt-1 z-20 w-full overflow-auto rounded-md py-1 text-base shadow-lg ring-1 ring-black/5 focus:outline-none sm:text-sm"
                                        height={200} // Height of the list
                                        rowCount={filteredLanguages.length} // Total number of rows
                                        rowHeight={40} // Height of each row
                                        rowRenderer={({
                                            index,
                                            key,
                                            style,
                                        }) => {
                                            const language =
                                                filteredLanguages[index];

                                            return (
                                                <div
                                                    key={key}
                                                    style={style}
                                                    onClick={() => {
                                                        setLanguage(language);
                                                        setActive(false);
                                                        setQuery("");
                                                    }}
                                                    className="relative cursor-pointer p-2"
                                                >
                                                    {language ? (
                                                        <span className="block truncate font-normal">
                                                            {language.ang ||
                                                                language.lc}{" "}
                                                            ({language.lc})
                                                        </span>
                                                    ) : (
                                                        <span className="block truncate font-normal text-black">
                                                            No results found
                                                        </span>
                                                    )}
                                                </div>
                                            );
                                        }}
                                        width={200} // Width of the list
                                    />
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="flex gap-5 mt-5 items-center">
                        <div>
                            <div className="flex gap-4 items-center mb-2">
                                <h4>
                                    Licence{" "}
                                    <span className="text-error">*</span>
                                </h4>
                            </div>

                            <VSCodeDropdown
                                position="below"
                                className="w-48 lg:w-full"
                                value={
                                    copyright
                                        ? copyright.title
                                        : "Select License"
                                }
                                onChange={(e) => {
                                    setCopyright(
                                        licenseList.find(
                                            (license) =>
                                                license.title ===
                                                (e.target as HTMLInputElement)
                                                    .value,
                                        ),
                                    );
                                }}
                            >
                                {licenseList.map((licence) => (
                                    <VSCodeOption
                                        value={licence.title}
                                        key={licence.id}
                                    >
                                        {licence.title}
                                    </VSCodeOption>
                                ))}
                            </VSCodeDropdown>
                        </div>
                    </div>
                </div>

                <div>
                    <div>
                        <VSCodeButton
                            type="button"
                            aria-label="create"
                            className="w-40 h-10 my-5 bg-success leading-loose rounded shadow text-xs font-bas tracking-wide font-light uppercase"
                            onClick={handleSubmit}
                        >
                            {/* {t("btn-create-project")} */}
                            Create Project
                        </VSCodeButton>
                    </div>
                </div>
            </div>
        </div>
    );
};

renderToPage(<Sidebar />);
