import {
    ExtensionContext,
    Uri,
    ViewColumn,
    commands,
    window,
    workspace,
} from "vscode";
import { Disposable } from "vscode-languageclient";
import { extractBookChapterVerse } from "../../utils/extractBookChapterVerse";
import { DownloadedResource } from "../obs/resources/types";
import { initializeStateStore } from "../../stateStore";

import { TranslationNotesPanel } from "./TranslationNotesPanel";
import { ScriptureTSV } from "../../../types/TsvTypes";
import { tsvStringToScriptureTSV } from "./utilities/tsvFileConversions";

import { TranslationNotePostMessages } from "../../../types";

type CommandToFunctionMap = Record<string, (text: string) => void>;

export class TnProvider {
    private static readonly viewType = "codex.translationNotesEditor";

    resource: DownloadedResource;
    context: ExtensionContext;
    stateStore?: Awaited<ReturnType<typeof initializeStateStore>>;

    constructor(context: ExtensionContext, resource: DownloadedResource) {
        this.context = context;
        this.resource = resource;
        initializeStateStore().then((stateStore) => {
            this.stateStore = stateStore;
        });
    }

    public async startWebviewPanel(viewColumn: ViewColumn = ViewColumn.Beside) {
        if (!this.stateStore) {
            this.stateStore = await initializeStateStore();
        }

        const panel = window.createWebviewPanel(
            "codex.translationNotes",
            "Translation Notes - " + this.resource.name,
            viewColumn,
            {
                enableScripts: true,
                localResourceRoots: [this.context.extensionUri],
            },
        );

        const verseRefStore = await this.stateStore?.getStoreState("verseRef");

        const updateWebview = async (verseRef: string) => {
            panel.webview.postMessage({
                command: "update",
                data: await this.getDocumentAsScriptureTSV(verseRef),
            } as TranslationNotePostMessages);
        };

        const messageEventHandlers = (message: any) => {
            const { command, text } = message;

            const commandToFunctionMapping: CommandToFunctionMap = {
                ["loaded"]: () =>
                    updateWebview(verseRefStore?.verseRef ?? "GEN 1:1"),
            };

            commandToFunctionMapping[command](text);
        };

        new TranslationNotesPanel(
            panel,
            this.context.extensionUri,
            messageEventHandlers,
        ).initializeWebviewContent();

        const disposeFunction = this.stateStore.storeListener(
            "verseRef",
            async (value) => {
                if (value) {
                    await updateWebview(value.verseRef);
                    panel.webview.postMessage({
                        command: "changeRef",
                        data: {
                            verseRef: value.verseRef,
                            uri: value.uri,
                        },
                    } as TranslationNotePostMessages);
                }
            },
        );
        panel.onDidDispose(() => {
            disposeFunction();
        });

        return {
            viewColumn: panel.viewColumn,
        };
    }

    /**
     * Try to get a current document as a scripture TSV object
     *
     * @TODO Use this function to turn doc text into ScriptureTSV!
     */
    private async getDocumentAsScriptureTSV(
        verseRef: string,
    ): Promise<ScriptureTSV> {
        const { bookID } = extractBookChapterVerse(verseRef);

        if (!workspace.workspaceFolders) {
            throw new Error(
                "Could not get document. No workspace folders found",
            );
        }

        const resourceUri = Uri.joinPath(
            workspace.workspaceFolders[0].uri,
            this.resource.localPath,
        );

        const docUri = Uri.joinPath(resourceUri, `tn_${bookID}.tsv`);

        const doc = await workspace.fs.readFile(docUri);

        const text = doc.toString();

        if (text.trim().length === 0) {
            return {};
        }

        try {
            return tsvStringToScriptureTSV(text);
        } catch {
            throw new Error(
                "Could not get document as json. Content is not valid scripture TSV",
            );
        }
    }
}
