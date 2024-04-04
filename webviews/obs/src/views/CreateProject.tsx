import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/Form";
import { categoryOptions, projectTypes } from "@/utilities/projectUtils";

import { vscode } from "../utilities/vscode";
import {
    VSCodeButton,
    VSCodeTextArea,
    VSCodeTextField,
    VSCodeDropdown,
    VSCodeOption,
} from "@vscode/webview-ui-toolkit/react";
import { Fragment, useState } from "react";
import LanguageSearch from "../components/LanguageSearch";
import { LanguageMetadata } from "codex-types";
import { MessageType } from "../types";

import { LanguageCodes } from "../../../../src/utils/languageUtils";

import advancedSettings from "@/data/AdvanceSettings.json";
import { renderToPage } from "../utilities/main-vscode";

const licenseList = advancedSettings.copyright;

const textTranslationSchema = z.object({
    projectName: z
        .string({
            invalid_type_error: "Project Name is required",
            required_error: "Project Name is required",
        })
        .min(1, "Project Name is required"),
    projectCategory: z
        .string({
            invalid_type_error: "Project Category is required",
            required_error: "Project Category is required",
        })
        .min(1, "Project Category is required"),
    userName: z
        .string({
            invalid_type_error: "Username is required",
            required_error: "Username is required",
        })
        .min(1, "Username is required"),
    abbreviation: z.string(),
    sourceLanguage: z.record(z.string(), z.any(), {
        required_error: "Source Language is required",
        invalid_type_error: "Source Language is required",
    }),
    targetLanguage: z.record(z.string(), z.any(), {
        required_error: "Target Language is required",
        invalid_type_error: "Target Language is required",
    }),
    name: z
        .string({
            invalid_type_error: "Name is required",
            required_error: "Name is required",
        })
        .min(1, "Name is required"),
    email: z
        .string({
            invalid_type_error: "Email is required",
            required_error: "Email is required",
        })
        .min(1, "Email is required")
        .email("Invalid Email"),
    type: z.literal("textTranslation"),
});

const obsSchema = z.object({
    projectName: z
        .string({
            invalid_type_error: "Project Name is required",
            required_error: "Project Name is required",
        })
        .min(1, "Project Name is required"),
    description: z
        .string({
            invalid_type_error: "Description is required",
            required_error: "Description is required",
        })
        .min(1, "Description is required"),
    abbreviation: z.string(),
    userName: z
        .string({
            invalid_type_error: "Username is required",
            required_error: "Username is required",
        })
        .min(1, "Username is required"),
    targetLanguage: z.record(z.string(), z.any(), {
        required_error: "Source Language is required",
        invalid_type_error: "Source Language is required",
    }),
    name: z
        .string({
            invalid_type_error: "Name is required",
            required_error: "Name is required",
        })
        .min(1, "Name is required"),
    email: z
        .string({
            invalid_type_error: "Email is required",
            required_error: "Email is required",
        })
        .min(1, "Email is required")
        .email("Invalid Email"),
    type: z.literal("openBibleStories"),
    copyright: z.object(
        {
            title: z.string(),
            id: z.string(),
            licence: z.string(),
            locked: z.boolean(),
        },
        {
            required_error: "License is required",
            invalid_type_error: "License is required",
        },
    ),
});

const formSchema = z.discriminatedUnion("type", [
    textTranslationSchema,
    obsSchema,
]);

const CreateProject = () => {
    const [targetLanguageQuery, setTargetLanguageQuery] = useState("");
    const [sourceLanguageQuery, setSourceLanguageQuery] = useState("");
    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            projectName: "",
            abbreviation: "",
            name: "",
            email: "",
            type: "textTranslation",
            userName: "",
        },
    });

    const projectTypeFormValue = useWatch<z.infer<typeof formSchema>>({
        name: "type",
        control: form.control,
    });

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

    const handleSubmit = form.handleSubmit((data) => {
        switch (data.type) {
            case "openBibleStories":
                vscode.postMessage({
                    type: MessageType.createObsProject,
                    payload: {
                        projectName: data.projectName,
                        description: data.description,
                        abbreviation: data.abbreviation,
                        targetLanguage: data.targetLanguage,
                        copyright: data.copyright,
                        name: data.name,
                        email: data.email,
                        username: data.userName,
                    },
                });
                break;

            case "textTranslation":
                vscode.postMessage({
                    type: MessageType.createProject,
                    payload: {
                        projectName: data.projectName,
                        projectCategory: data.projectCategory,
                        userName: data.userName,
                        abbreviation: data.abbreviation,
                        sourceLanguage: {
                            ...data.sourceLanguage,
                            projectStatus: "source",
                        },
                        targetLanguage: {
                            ...data.targetLanguage,
                            projectStatus: "target",
                        },
                        name: data.name,
                        email: data.email,
                    },
                });
                break;
            default:
                break;
        }
    });

    return (
        <Form {...form}>
            <form>
                <div className="text-xl uppercase">
                    <span>
                        Project Type :{" "}
                        {
                            projectTypes.find(
                                (projectType) =>
                                    projectType.value === projectTypeFormValue,
                            )?.label
                        }
                    </span>
                </div>

                <div className="flex gap-5 flex-col">
                    <FormField
                        control={form.control}
                        name="type"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Project Type</FormLabel>
                                <FormControl>
                                    <VSCodeDropdown
                                        onBlur={field.onBlur}
                                        className={"rounded text-sm"}
                                    >
                                        {projectTypes.map((projectType) => (
                                            <VSCodeOption
                                                value={projectType.value}
                                                key={projectType.value}
                                                onClick={() =>
                                                    field.onChange(
                                                        projectType.value,
                                                    )
                                                }
                                            >
                                                {projectType.label}
                                            </VSCodeOption>
                                        ))}
                                    </VSCodeDropdown>
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Name of the User</FormLabel>
                                <FormControl>
                                    <VSCodeTextField
                                        {...field}
                                        type="text"
                                        id="name"
                                        className={"rounded text-sm"}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Email of the User</FormLabel>
                                <FormControl>
                                    <VSCodeTextField
                                        {...field}
                                        type="email"
                                        id="email"
                                        className={"rounded text-sm"}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="projectName"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Project Name</FormLabel>
                                <FormControl>
                                    <VSCodeTextField
                                        {...field}
                                        type="text"
                                        id="projectName"
                                        className={"rounded text-sm"}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <Fragment>
                        <FormField
                            control={form.control}
                            name="userName"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Username</FormLabel>
                                    <FormControl>
                                        <VSCodeTextField
                                            {...field}
                                            type="text"
                                            id="username"
                                            className={"rounded text-sm"}
                                        />
                                    </FormControl>
                                    <FormMessage />{" "}
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="projectCategory"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Category</FormLabel>
                                    <FormControl>
                                        <VSCodeDropdown
                                            {...field}
                                            className={"rounded text-sm"}
                                        >
                                            <VSCodeOption
                                                value={undefined}
                                                disabled
                                            >
                                                Select the project category
                                            </VSCodeOption>
                                            {categoryOptions.map((category) => (
                                                <VSCodeOption
                                                    value={category}
                                                    key={category}
                                                >
                                                    {category}
                                                </VSCodeOption>
                                            ))}
                                        </VSCodeDropdown>
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </Fragment>

                    {projectTypeFormValue === "openBibleStories" && (
                        <FormField
                            control={form.control}
                            name="description"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Description</FormLabel>
                                    <FormControl>
                                        <VSCodeTextArea
                                            id="project_description"
                                            className="rounded text-s"
                                            {...field}
                                            value={field.value ?? ""}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    )}
                    {projectTypeFormValue === "textTranslation" && (
                        <FormField
                            control={form.control}
                            name="sourceLanguage"
                            render={({ field }) => (
                                <FormItem>
                                    <FormControl>
                                        <LanguageSearch
                                            label="Source Language"
                                            value={sourceLanguageQuery}
                                            languages={filteredSourceLanguages}
                                            setQuery={setSourceLanguageQuery}
                                            setLanguage={field.onChange}
                                            selectedLanguage={
                                                (field.value as LanguageMetadata) ??
                                                null
                                            }
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    )}

                    <FormField
                        control={form.control}
                        name="targetLanguage"
                        render={({ field }) => (
                            <FormItem>
                                <FormControl>
                                    <LanguageSearch
                                        label="Target Language"
                                        value={targetLanguageQuery}
                                        languages={filteredTargetLanguages}
                                        setQuery={setTargetLanguageQuery}
                                        setLanguage={field.onChange}
                                        selectedLanguage={
                                            (field.value as LanguageMetadata) ??
                                            null
                                        }
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    {projectTypeFormValue === "openBibleStories" && (
                        <FormField
                            control={form.control}
                            name="copyright"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>License</FormLabel>
                                    <FormControl>
                                        <VSCodeDropdown
                                            position="below"
                                            className=""
                                            value={
                                                field.value
                                                    ? field.value.title
                                                    : "Select License"
                                            }
                                            onInput={(e) => {
                                                field.onChange(
                                                    licenseList.find(
                                                        (license) =>
                                                            license.title ===
                                                            (
                                                                e.target as HTMLInputElement
                                                            ).value,
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
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    )}
                    <VSCodeButton
                        aria-label="create"
                        className="rounded shadow text-xs tracking-wide uppercase"
                        // type="submit"
                        appearance="primary"
                        onClick={handleSubmit}
                    >
                        Create Project
                    </VSCodeButton>
                </div>
            </form>
        </Form>
    );
};

renderToPage(<CreateProject />);
