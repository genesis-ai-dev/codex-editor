import { useState } from "react";
import { renderToPage } from "../utilities/main-vscode";
import {
    VSCodeButton,
    VSCodeDropdown,
    VSCodeOption,
    VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react";
import { List } from "react-virtualized";
import { LanguageMetadata } from "codex-types";
import { LanguageCodes } from "../../../../src/utils/languageUtils";
import { vscode } from "@/utilities/vscode";
import { MessageType } from "@/types";

const CreateNewProject = () => {
    const categoryOptions = [
        "Scripture",
        "Gloss",
        "Parascriptural",
        "Peripheral",
    ];

    const [projectName, setProjectName] = useState("");
    const [userName, setUsername] = useState("");
    const [abbreviation, setAbbreviation] = useState("");
    const [projectCategory, setCategory] = useState(categoryOptions[0]);
    const [sourceActive, setSourceActive] = useState(false);
    const [targetActive, setTargetActive] = useState(false);
    const [sourceLanguage, setSourceLanguage] = useState<LanguageMetadata>();
    const [targetLanguage, setTargetLanguage] = useState<LanguageMetadata>();
    const [sourceLanguageQuery, setSourceLanguageQuery] = useState("");
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

    const handleCreateProject = () => {
        const projectDetails = {
            projectName,
            projectCategory,
            userName,
            abbreviation,
            sourceLanguage,
            targetLanguage,
        };
        vscode.postMessage({
            type: MessageType.createNewProject,
            payload: projectDetails,
        });
    };
    return (
        <div>
            <div className="grid gap-5">
                <VSCodeTextField
                    type="text"
                    name="project_name"
                    id="project_name"
                    value={projectName}
                    onChange={(e) => {
                        setProjectName((e.target as HTMLInputElement).value);
                    }}
                    className={"w-48 rounded text-sm"}
                >
                    Project Name
                </VSCodeTextField>
                <VSCodeTextField
                    type="text"
                    name="username"
                    id="username"
                    value={userName}
                    placeholder="Enter your username"
                    onChange={(e) => {
                        setUsername((e.target as HTMLInputElement).value);
                    }}
                    className={"w-48 rounded text-sm"}
                >
                    Username
                </VSCodeTextField>
                <VSCodeTextField
                    type="text"
                    name="version_abbreviated"
                    id="version_abbreviated"
                    value={abbreviation}
                    placeholder="e.g. KJV, NASB, RSV"
                    onInput={(e) => {
                        setAbbreviation((e.target as HTMLInputElement).value);
                    }}
                    className="w-48 rounded text-sm"
                >
                    Abbreviation
                </VSCodeTextField>
                <label htmlFor="project_category">Category</label>
                <VSCodeDropdown
                    value={projectCategory}
                    onInput={(e) => {
                        setCategory((e.target as HTMLSelectElement).value);
                    }}
                    className="w-48 rounded text-sm"
                >
                    <VSCodeOption value={undefined} disabled>
                        Select the project category
                    </VSCodeOption>
                    {categoryOptions.map((category) => (
                        <VSCodeOption key={category} value={category}>
                            {category}
                        </VSCodeOption>
                    ))}
                </VSCodeDropdown>
                <div className="flex flex-col gap-2">
                    <label htmlFor="source_language">Source Language</label>
                    <VSCodeTextField
                        placeholder="Search source language..."
                        value={
                            sourceLanguage
                                ? sourceLanguage.refName
                                : sourceLanguageQuery
                        }
                        onFocus={() => {
                            setSourceActive(true);
                            setTargetActive(false);
                        }}
                        onBlur={() => setSourceActive(false)}
                        onInput={(e) =>
                            setSourceLanguageQuery(
                                (e.target as HTMLInputElement).value,
                            )
                        }
                        className="w-48 rounded text-sm"
                    />
                    {sourceActive && (
                        <List
                            className="border rounded-md"
                            width={200}
                            height={120}
                            rowCount={filteredSourceLanguages.length}
                            rowHeight={30}
                            rowRenderer={({ key, index, style }) => {
                                const language = filteredSourceLanguages[index];
                                return (
                                    <div
                                        className="cursor-pointer pl-2"
                                        key={key}
                                        style={style}
                                        onClick={() => {
                                            setSourceLanguage(language);
                                            setSourceActive(false);
                                        }}
                                    >
                                        {language.refName} ({language.tag})
                                    </div>
                                );
                            }}
                        />
                    )}
                </div>
                <div className="flex flex-col gap-2">
                    <label htmlFor="target_language">Target Language</label>
                    <VSCodeTextField
                        placeholder="Search target language..."
                        value={
                            targetLanguage
                                ? targetLanguage.refName
                                : targetLanguageQuery
                        }
                        onFocus={() => {
                            setTargetActive(true);
                            setSourceActive(false);
                        }}
                        onBlur={() => setTargetActive(false)}
                        onInput={(e) =>
                            setTargetLanguageQuery(
                                (e.target as HTMLInputElement).value,
                            )
                        }
                        className="w-48 rounded text-sm"
                    />
                    {targetActive && (
                        <List
                            className="border rounded-md"
                            width={200}
                            height={120}
                            rowCount={filteredTargetLanguages.length}
                            rowHeight={30}
                            rowRenderer={({ key, index, style }) => {
                                const language = filteredTargetLanguages[index];
                                return (
                                    <div
                                        className="cursor-pointer pl-2"
                                        key={key}
                                        style={style}
                                        onClick={() => {
                                            setTargetLanguage(language);
                                            setTargetActive(false);
                                        }}
                                    >
                                        {language.refName} ({language.tag})
                                    </div>
                                );
                            }}
                        />
                    )}
                </div>
                <VSCodeButton
                    type="button"
                    aria-label="create"
                    className="px-4 py-2 my-5 w-fit rounded text-sm bg-success"
                    onClick={handleCreateProject}
                >
                    Create Project
                </VSCodeButton>
            </div>
        </div>
    );
};

renderToPage(<CreateNewProject />);
