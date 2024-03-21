/* eslint-disable react-refresh/only-export-components */
import { useState } from "react";
import { renderToPage } from "../utilities/main-vscode";
import {
    VSCodeButton,
    VSCodeTextArea,
    VSCodeTextField,
    VSCodeDropdown,
    VSCodeOption,
} from "@vscode/webview-ui-toolkit/react";

import { vscode } from "../utilities/vscode";
import { LanguageMetadata } from "codex-types";
import { LanguageCodes } from "../../../../src/utils/languageUtils";
import advancedSettings from "@/data/AdvanceSettings.json";
import { Copyright, MessageType } from "../types";
import { categoryOptions, projectTypes } from "@/utilities/projectUtils";
import LanguageSearch from "@/components/LanguageSearch";

const Sidebar = () => {
    const licenseList = advancedSettings.copyright;
    const [projectType, setProjectType] = useState(projectTypes[0]);
    const [projectName, setProjectName] = useState("");
    const [userName, setUsername] = useState("");
    const [description, setDescription] = useState("");
    const [projectCategory, setCategory] = useState(categoryOptions[0]);
    const [abbreviation, setAbbreviation] = useState("");
    const [copyright, setCopyright] = useState<Copyright>();
    const [targetLanguage, setTargetLanguage] = useState<LanguageMetadata>();
    const [sourceLanguage, setSourceLanguage] = useState<LanguageMetadata>();
    const [sourceLanguageQuery, setSourceLanguageQuery] = useState("");
    const [sourceActive, setSourceActive] = useState(false);
    const [targetActive, setTargetActive] = useState(false);
    const [targetLanguageQuery, setTargetLanguageQuery] = useState("");

    const filteredSourceLanguages =
        sourceLanguageQuery !== ""
            ? LanguageCodes.filter((lang) =>
                  lang?.refName
                      ?.toLowerCase()
                      .includes(sourceLanguageQuery.toLowerCase()),
              )
            : LanguageCodes;

    const filteredTargetLanguages =
        targetLanguageQuery !== ""
            ? LanguageCodes.filter((lang) =>
                  lang?.refName
                      ?.toLowerCase()
                      .includes(targetLanguageQuery.toLowerCase()),
              )
            : LanguageCodes;

    console.log(projectType.value);
    const handleSubmit = () => {
        switch (projectType.value) {
            case "openBibleStories":
                vscode.postMessage({
                    type: MessageType.createObsProject,
                    payload: {
                        projectName,
                        description,
                        abbreviation,
                        sourceLanguage,
                        copyright,
                    },
                });
                break;

            case "textTranslation":
                vscode.postMessage({
                    type: MessageType.createProject,
                    payload: {
                        projectName,
                        projectCategory,
                        userName,
                        abbreviation,
                        sourceLanguage: {
                            ...sourceLanguage,
                            projectStatus: "source",
                        },
                        targetLanguage: {
                            ...targetLanguage,
                            projectStatus: "target",
                        },
                    },
                });
                break;
            default:
                break;
        }
    };
    return (
        <div className="rounded-md border shadow-sm mt-4 ml-5 mr-5 mb-5">
            <div className="space-y-2 m-10">
                <span>Project Type : {projectType.label}</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 m-10 gap-5">
                <label htmlFor="project_type">Project Type</label>
                <VSCodeDropdown>
                    {projectTypes.map((projectType) => (
                        <VSCodeOption
                            value={projectType.value}
                            key={projectType.value}
                            onClick={() => {
                                setProjectType(projectType);
                            }}
                        >
                            {projectType.label}
                        </VSCodeOption>
                    ))}
                </VSCodeDropdown>

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
                        className={"w-48 lg:w-full rounded text-sm mb-6"}
                    >
                        Project Name
                    </VSCodeTextField>
                    {projectType.value === "textTranslation" && (
                        <div className="flex flex-col gap-2">
                            <VSCodeTextField
                                type="text"
                                name="username"
                                id="username"
                                value={userName}
                                placeholder="Enter your username"
                                onChange={(e) => {
                                    setUsername(
                                        (e.target as HTMLInputElement).value,
                                    );
                                }}
                                className={"w-48 rounded text-sm"}
                            >
                                Username
                            </VSCodeTextField>
                            <label htmlFor="project_category">Category</label>
                            <VSCodeDropdown
                                value={projectCategory}
                                onInput={(e) => {
                                    setCategory(
                                        (e.target as HTMLSelectElement).value,
                                    );
                                }}
                                className="w-48 rounded text-sm"
                            >
                                <VSCodeOption value={undefined} disabled>
                                    Select the project category
                                </VSCodeOption>
                                {categoryOptions.map((category) => (
                                    <VSCodeOption
                                        key={category}
                                        value={category}
                                    >
                                        {category}
                                    </VSCodeOption>
                                ))}
                            </VSCodeDropdown>
                        </div>
                    )}
                    {projectType.value === "openBibleStories" && (
                        <VSCodeTextArea
                            name="Description"
                            id="project_description"
                            value={description}
                            onChange={(e) => {
                                setDescription(
                                    (e.target as HTMLTextAreaElement).value,
                                );
                            }}
                            className="w-48 lg:w-full h-28 block rounded text-sm "
                        >
                            Description
                        </VSCodeTextArea>
                    )}
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
                                className="w-24 block rounded text-sm "
                            >
                                Abbreviation
                            </VSCodeTextField>
                        </div>
                    </div>
                    <div className="space-y-4">
                        <LanguageSearch
                            label="Source Language"
                            value={
                                sourceLanguage
                                    ? (sourceLanguage.refName as string)
                                    : sourceLanguageQuery
                            }
                            languages={filteredSourceLanguages}
                            onFocus={() => setSourceActive(true)}
                            // onBlur={() => setSourceActive(false)}
                            setQuery={setSourceLanguageQuery}
                            setLanguage={setSourceLanguage}
                            isActive={sourceActive}
                            setActive={setSourceActive}
                        />
                        {projectType.value === "textTranslation" && (
                            <LanguageSearch
                                label="Target Language"
                                value={
                                    targetLanguage
                                        ? (targetLanguage.refName as string)
                                        : targetLanguageQuery
                                }
                                languages={filteredTargetLanguages}
                                onFocus={() => setTargetActive(true)}
                                // onBlur={() => setTargetActive(false)}
                                setQuery={setTargetLanguageQuery}
                                setLanguage={setTargetLanguage}
                                isActive={targetActive}
                                setActive={setTargetActive}
                            />
                        )}
                    </div>
                    {projectType.value === "openBibleStories" && (
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
                                                    (
                                                        e.target as HTMLInputElement
                                                    ).value,
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
                    )}
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
