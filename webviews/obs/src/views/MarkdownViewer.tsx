import { renderToPage } from "@/utilities/main-vscode";
import { markdownToHTML } from "../../../codex-webviews/src/TranslationNotesView/utilities/markdownToHTML";
import { VSCodeButton, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react";
import { vscode } from "@/utilities/vscode";
import { MessageType } from "@/types";
import { useEffect, useState } from "react";

const MarkdownViewer = () => {
    const { taDirectories, taSubDirectories, taContent } = useTranslationAcademyDirectories();

    const [selectedDirectory, setSelectedDirectory] = useState<string>(taDirectories[0] ?? "");
    const [selectedSubDirectory, setSelectedSubDirectory] = useState<string>(
        taSubDirectories[0] ?? ""
    );

    return (
        <>
            <div className="flex items-center gap-4 mb-6 justify-center">
                <VSCodeDropdown
                    value={selectedDirectory}
                    onChange={(e) => {
                        vscode.postMessage({
                            type: MessageType.GET_TA_FOLDER_CONTENT,
                            payload: (e.target as HTMLSelectElement)?.value,
                        });
                        setSelectedDirectory((e.target as HTMLSelectElement)?.value);
                    }}
                    className="w-fit"
                >
                    {taDirectories.map((directory) => (
                        <VSCodeOption className="w-full" key={directory}>
                            {directory}
                        </VSCodeOption>
                    ))}
                </VSCodeDropdown>
                <VSCodeDropdown
                    onChange={(e) => {
                        setSelectedSubDirectory((e.target as HTMLSelectElement)?.value);
                    }}
                    value={selectedSubDirectory}
                    className="w-fit"
                >
                    {taSubDirectories.map((subDirectory) => (
                        <VSCodeOption key={subDirectory} className="w-full">
                            {subDirectory}
                        </VSCodeOption>
                    ))}
                </VSCodeDropdown>
                <VSCodeButton
                    appearance="primary"
                    onClick={() =>
                        vscode.postMessage({
                            type: MessageType.GET_TA_CONTENT,
                            payload: {
                                directory: selectedDirectory,
                                subDirectory: selectedSubDirectory,
                            },
                        })
                    }
                >
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
            switch (event.data.type) {
                case MessageType.SYNC_TA_FOLDERS:
                    setTaDirectories(event.data.payload ?? []);
                    break;
                case MessageType.SYNC_TA_FOLDER_CONTENT:
                    setTaSubDirectories(event.data.payload ?? []);
                    break;
                case MessageType.SYNC_TA_CONTENT:
                    setTaContent(event.data.payload);
                    break;
            }
        });
    }, []);

    return { taDirectories, taSubDirectories, taContent };
};
