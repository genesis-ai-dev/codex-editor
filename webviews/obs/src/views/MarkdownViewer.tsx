import { renderToPage } from "@/utilities/main-vscode";
import { markdownToHTML } from "../../../codex-webviews/src/TranslationNotesView/utilities/markdownToHTML";
import {
    VSCodeButton,
    VSCodeDropdown,
    VSCodeOption,
} from "@vscode/webview-ui-toolkit/react";
import { vscode } from "@/utilities/vscode";
import { MessageType } from "@/types";
import { useEffect } from "react";

const MarkdownViewer = () => {
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

    // receive message from extension
    useEffect(() => {
        const listener = (event: MessageEvent) => {
            console.log("listener fn called !!!");
            if (event.data.type === MessageType.SYNC_TA_FOLDERS) {
                console.log("message received");
            }
        };
        window.addEventListener("message", listener);
        vscode.setMessageListeners((message) => {
            if (message.type === MessageType.SYNC_TA_FOLDERS) {
                console.log("message received");
            }
        });
        return () => {
            window.removeEventListener("message", listener);
        };
    }, []);

    return (
        <>
            <div className="flex items-center gap-4 mb-6">
                <VSCodeDropdown>
                    <VSCodeOption>Intro</VSCodeOption>
                    <VSCodeOption>Process</VSCodeOption>
                    <VSCodeOption>Translate</VSCodeOption>
                </VSCodeDropdown>
                <VSCodeDropdown>
                    <VSCodeOption>Finding Answers</VSCodeOption>
                    <VSCodeOption>Gl Strategy</VSCodeOption>
                    <VSCodeOption>Open License</VSCodeOption>
                    <VSCodeOption>Statement of Faith</VSCodeOption>
                    <VSCodeOption>Ta intro</VSCodeOption>
                    <VSCodeOption>UW intro</VSCodeOption>
                </VSCodeDropdown>
                <VSCodeButton appearance="primary" onClick={sendMessage}>
                    View
                </VSCodeButton>
            </div>
            <div
                dangerouslySetInnerHTML={{ __html: markdownToHTML(markdown) }}
            />
        </>
    );
};

renderToPage(<MarkdownViewer />);
