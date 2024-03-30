import { Fragment, useState } from "react";
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
    const [targetLanguageQuery, setTargetLanguageQuery] = useState("");
    const [name, setName] = useState("");

    const [email, setEmail] = useState("");

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
                        name,
                        email,
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
                        name,
                        email,
                    },
                });
                break;
            default:
                break;
        }
    };
    return (
        <div>
            <div className="text-xl uppercase mb-5">
                <span>Project Type : {projectType.label}</span>
            </div>
            <div className="flex gap-5 flex-col">
                <div className="flex flex-col">
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
                </div>

                <VSCodeTextField
                    type="text"
                    name="name"
                    id="name"
                    value={name}
                    onChange={(e) => {
                        setName((e.target as HTMLInputElement).value);
                    }}
                    className={"rounded text-sm"}
                >
                    Name of the User
                </VSCodeTextField>
                <VSCodeTextField
                    type="text"
                    name="email"
                    id="email"
                    value={email}
                    onChange={(e) => {
                        setEmail((e.target as HTMLInputElement).value);
                    }}
                    className={"rounded text-sm"}
                >
                    Email of the User
                </VSCodeTextField>
                <VSCodeTextField
                    type="text"
                    name="project_name"
                    id="project_name"
                    value={projectName}
                    onChange={(e) => {
                        setProjectName((e.target as HTMLInputElement).value);
                    }}
                    className={"rounded text-sm"}
                >
                    Project Name
                </VSCodeTextField>
                {projectType.value === "textTranslation" && (
                    <Fragment>
                        <VSCodeTextField
                            type="text"
                            name="username"
                            id="username"
                            value={userName}
                            onChange={(e) => {
                                setUsername(
                                    (e.target as HTMLInputElement).value,
                                );
                            }}
                            className={"rounded text-sm"}
                        >
                            Username
                        </VSCodeTextField>
                        <div className="flex flex-col">
                            <label htmlFor="project_category">Category</label>
                            <VSCodeDropdown
                                value={projectCategory}
                                onInput={(e) => {
                                    setCategory(
                                        (e.target as HTMLSelectElement).value,
                                    );
                                }}
                                className="rounded text-sm"
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
                    </Fragment>
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
                        className="rounded text-sm "
                    >
                        Description
                    </VSCodeTextArea>
                )}
                <VSCodeTextField
                    type="text"
                    name="version_abbreviated"
                    id="version_abbreviated"
                    value={abbreviation}
                    onInput={(e) => {
                        setAbbreviation((e.target as HTMLInputElement).value);
                    }}
                    className="block rounded text-sm "
                >
                    Abbreviation
                </VSCodeTextField>
                <LanguageSearch
                    label="Source Language"
                    value={sourceLanguageQuery}
                    languages={filteredSourceLanguages}
                    setQuery={setSourceLanguageQuery}
                    setLanguage={setSourceLanguage}
                    selectedLanguage={sourceLanguage ?? null}
                />
                {projectType.value === "textTranslation" && (
                    <LanguageSearch
                        label="Target Language"
                        value={targetLanguageQuery}
                        languages={filteredTargetLanguages}
                        setQuery={setTargetLanguageQuery}
                        setLanguage={setTargetLanguage}
                        selectedLanguage={targetLanguage ?? null}
                    />
                )}
                {projectType.value === "openBibleStories" && (
                    <Fragment>
                        <div className="flex flex-col">
                            <label htmlFor="license">License</label>
                            <VSCodeDropdown
                                position="below"
                                className=""
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
                                id="license"
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
                    </Fragment>
                )}

                <VSCodeButton
                    aria-label="create"
                    className="rounded shadow text-xs tracking-wide uppercase"
                    onClick={handleSubmit}
                    appearance="primary"
                >
                    Create Project
                </VSCodeButton>
            </div>
        </div>
    );
};

renderToPage(<Sidebar />);
