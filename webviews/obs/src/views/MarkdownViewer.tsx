import { renderToPage } from "@/utilities/main-vscode";
import { markdownToHTML } from "../../../codex-webviews/src/TranslationNotesView/utilities/markdownToHTML";
import {
    VSCodeButton,
    VSCodeDropdown,
    VSCodeOption,
} from "@vscode/webview-ui-toolkit/react";
import { vscode } from "@/utilities/vscode";
import { MessageType } from "@/types";
import { useEffect, useState } from "react";

const MarkdownViewer = () => {
    const { taDirectories, taSubDirectories, taContent } =
        useTranslationAcademyDirectories();
    const markdown = `### How to Get Answers

There are several resources available for finding answers to questions:
    
* **unfoldingWord® Translation Academy** — This training manual is available at https://ufw.io/ta and has much information including:
      * [Introduction](../ta-intro/01.md) — introduces this resource, the Gateway Languages strategy, and translation
      * [Process Manual](../../process/process-manual/01.md) — answers the question “what next?”
      * [Translation Manual](../../translate/translate-manual/01.md) — explains the basics of translation theory and provides practical translation helps
      * [Checking Manual](../../checking/intro-check/01.md) — explains the basics of checking theory and best practices
    * **Door43 Forum** — A place to ask questions and get answers to technical, strategic, translation, and checking issues, https://forum.door43.org/
    * **Helpdesk** — email <help@door43.org> with your questions`;

    const sendMessage = () => {
        vscode.postMessage({
            type: MessageType.changeTnAcademyResource,
            payload: "test",
        });
    };

    console.log("taDirectories: ", taDirectories);

    const [selectedDirectory, setSelectedDirectory] = useState<string>("");

    return (
        <>
            <div className="flex items-center gap-4 mb-6">
                <VSCodeDropdown
                    onChange={(e) => {
                        console.log(
                            "e.target.value: ",
                            (e.target as any)?.value,
                        );
                        vscode.postMessage({
                            type: MessageType.GET_TA_FOLDER_CONTENT,
                            payload: (e.target as any)?.value,
                        });
                        setSelectedDirectory((e.target as any)?.value);
                    }}
                >
                    {taDirectories.map((directory) => (
                        <VSCodeOption key={directory}>{directory}</VSCodeOption>
                    ))}
                </VSCodeDropdown>
                <VSCodeDropdown
                    onChange={(e) => {
                        vscode.postMessage({
                            type: MessageType.GET_TA_CONTENT,
                            payload: {
                                directory: selectedDirectory,
                                subDirectory: (e.target as any)?.value,
                            },
                        });
                    }}
                >
                    {taSubDirectories.map((subDirectory) => (
                        <VSCodeOption key={subDirectory}>
                            {subDirectory}
                        </VSCodeOption>
                    ))}
                </VSCodeDropdown>
                <VSCodeButton appearance="primary" onClick={sendMessage}>
                    View
                </VSCodeButton>
            </div>
            <div
                className="prose-base"
                dangerouslySetInnerHTML={{
                    __html: markdownToHTML(taContent ?? ""),
                }}
            />
        </>
    );
};

renderToPage(<MarkdownViewer />);

const useTranslationAcademyDirectories = () => {
    const [taDirectories, setTaDirectories] = useState<string[]>([]);

    const [taSubDirectories, setTaSubDirectories] = useState<string[]>([]);

    const [taContent, setTaContent] = useState<string | null>(null);

    useEffect(() => {
        vscode.setMessageListeners((event) => {
            console.log("event.data: ", event.data);
            switch (event.data.type) {
                case MessageType.SYNC_TA_FOLDERS:
                    setTaDirectories(event.data.payload ?? []);
                    console.log(
                        "event.data.payload-sync folders: ",
                        event.data.payload,
                    );
                    break;
                case MessageType.SYNC_TA_FOLDER_CONTENT:
                    setTaSubDirectories(event.data.payload ?? []);
                    console.log(
                        "event.data.payload-get folder content: ",
                        event.data.payload,
                    );
                    break;

                case MessageType.SYNC_TA_CONTENT:
                    setTaContent(event.data.payload);
                    console.log(
                        "event.data.payload-get folder content: ",
                        event.data.payload,
                    );
                    break;
            }
        });
    }, []);

    return { taDirectories, taSubDirectories, taContent };
};
