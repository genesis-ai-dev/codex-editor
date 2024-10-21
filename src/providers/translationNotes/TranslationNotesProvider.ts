import {
    CustomTextEditorProvider,
    ExtensionContext,
    Disposable,
    WebviewPanel,
    window,
    workspace,
    TextDocument,
    CancellationToken,
    commands,
    Uri,
    ViewColumn,
} from "vscode";
import { tsvStringToScriptureTSV } from "./utilities/tsvFileConversions";
import { TranslationNotesPanel } from "./TranslationNotesPanel";
import { initializeStateStore } from "../../stateStore";
import { extractBookChapterVerse } from "../../utils/extractBookChapterVerse";
import { CellIdGlobalState, TranslationNotePostMessages } from "../../../types";
import { ScriptureTSV } from "../../../types/TsvTypes";

type CommandToFunctionMap = Record<string, (text: string) => void>;

const getTnUri = (bookID: string): Uri => {
    const workspaceRootUri = workspace.workspaceFolders?.[0].uri as Uri;
    return Uri.joinPath(
        workspaceRootUri,
        ...["", ".project", "resources", "en_tn", `tn_${bookID}.tsv`]
    );
};

/**
 * Provider for tsv editors.
 *
 * TSV Editors are used for .tsv files. This editor is specifically geared
 * towards tsv files that contain translation notes.
 *
 */
export class TranslationNotesProvider implements CustomTextEditorProvider {
    public static register(context: ExtensionContext): {
        providerRegistration: Disposable;
        commandRegistration: Disposable;
    } {
        const provider = new TranslationNotesProvider(context);
        const providerRegistration = window.registerCustomEditorProvider(
            TranslationNotesProvider.viewType,
            provider
        );

        const commandRegistration = commands.registerCommand(
            "translationNotes.openTnEditor",
            async (verseRef: string) => {
                const { bookID } = extractBookChapterVerse(verseRef);
                const tnUri = getTnUri(bookID);

                await commands.executeCommand(
                    "vscode.openWith",
                    tnUri,
                    TranslationNotesProvider.viewType,
                    {
                        viewColumn: ViewColumn.Beside,
                        preserveFocus: true,
                        preview: true,
                    }
                );
            }
        );

        return { providerRegistration, commandRegistration };
    }

    private static readonly viewType = "codex.translationNotesEditor";

    constructor(private readonly context: ExtensionContext) {}

    /**
     * Called when our custom editor is opened.
     */
    public async resolveCustomTextEditor(
        document: TextDocument,
        webviewPanel: WebviewPanel,
        _token: CancellationToken
    ): Promise<void> {
        // Setup initial content for the webview
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri],
        };

        const updateWebview = () => {
            const scriptureTSV = this.getDocumentAsScriptureTSV(document);
            webviewPanel.webview.postMessage({
                command: "update",
                data: scriptureTSV,
            } as TranslationNotePostMessages);

            // Update the state store with the latest translation notes as plain text
            initializeStateStore().then(({ updateStoreState }) => {
                updateStoreState({
                    key: "plainTextNotes",
                    value: JSON.stringify(scriptureTSV),
                });
            });
        };

        const messageEventHandlers = (message: any) => {
            const { command, text } = message;

            const commandToFunctionMapping: CommandToFunctionMap = {
                ["loaded"]: updateWebview,
            };

            if (commandToFunctionMapping[command]) {
                commandToFunctionMapping[command](text);
            }
        };

        new TranslationNotesPanel(
            webviewPanel,
            this.context.extensionUri,
            messageEventHandlers
        ).initializeWebviewContent();

        const changeDocumentSubscription = workspace.onDidChangeTextDocument((e) => {
            if (e.document.uri.toString() === document.uri.toString()) {
                updateWebview();
            }
        });

        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });
        initializeStateStore().then(({ storeListener }) => {
            const disposeFunction = storeListener("cellId", (value) => {
                if (value) {
                    webviewPanel.webview.postMessage({
                        command: "changeRef",
                        data: { cellId: value.cellId },
                    } as TranslationNotePostMessages);
                }
            });
            webviewPanel.onDidDispose(() => {
                disposeFunction();
            });
        });
    }

    /**
     *
     * Try to get a current document as a scripture TSV object
     *
     * @TODO Use this function to turn doc text into ScriptureTSV!
     */
    private getDocumentAsScriptureTSV(document: TextDocument): ScriptureTSV {
        const text = document.getText();
        if (text.trim().length === 0) {
            return {};
        }

        try {
            return tsvStringToScriptureTSV(text);
        } catch {
            throw new Error("Could not get document as json. Content is not valid scripture TSV");
        }
    }

    /**
     * Write out the json to a given document.
     *
     * @TODO Incorporate document updates on user input
     */
    // private updateTextDocument(document: TextDocument, json: any) {
    //   const edit = new WorkspaceEdit();
    //   edit.replace();
    //   return workspace.applyEdit(edit);
    // }
}
