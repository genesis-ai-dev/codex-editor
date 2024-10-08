import { Dictionary, LanguageMetadata } from "codex-types";
import * as vscode from "vscode";
import { ScriptureTSV } from "./TsvTypes";

interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

interface ChatMessageWithContext extends ChatMessage {
    context?: any; // FixMe: discuss what context could be. Cound it be a link to a note?
    createdAt: string;
}

interface FrontEndMessage {
    command: {
        name: string; // use enum
        data?: any; // define based on enum
    };
}
type CommentThread = vscode.CommentThread;

interface ChatMessageThread {
    id: string;
    messages: ChatMessageWithContext[];
    collapsibleState: number;
    canReply: boolean;
    threadTitle?: string;
    deleted: boolean;
    createdAt: string;
}

interface NotebookCommentThread {
    id: string;
    uri?: string;
    verseRef: string;
    comments: {
        id: number;
        body: string;
        mode: number;
        contextValue: "canDelete";
        deleted: boolean;
        author: {
            name: string;
        };
    }[];
    collapsibleState: number;
    canReply: boolean;
    threadTitle?: string;
    deleted: boolean;
}

interface TranslationPair {
    cellId: string;
    sourceCell: MinimalCellResult;
    targetCell: MinimalCellResult;
    edits?: EditHistory[]; // Make this optional as it might not always be present
}

interface EditHistoryItem {
    cellValue: string;
    timestamp: number;
    type: import("./enums").EditType;
}

// Relating to Smart Edits
interface SmartEditContext {
    cellId: string;
    currentCellValue: string;
    edits: EditHistoryItem[];
}

interface SmartSuggestion {
    oldString: string;
    newString: string;
}

interface SavedSuggestions {
    cellId: string;
    lastCellValue: string;
    suggestions: SmartSuggestion[];
}

interface SmartEdit {
    context: SmartEditContext;
    suggestions: SmartSuggestion[];
}

interface CellIdGlobalState {
    cellId: string;
    uri: string;
}
interface ScriptureContent extends vscode.NotebookData {
    metadata: {
        data?: {
            chapter: string;
        };
        type?: "chapter-heading";
    };
}
type NotebookCellKind = vscode.NotebookCellKind;

type CommentPostMessages =
    | { command: "commentsFromWorkspace"; content: string }
    | { command: "reload"; data: VerseRefGlobalState }
    | { command: "updateCommentThread"; commentThread: NotebookCommentThread }
    | { command: "deleteCommentThread"; commentThreadId: string }
    | {
          command: "deleteComment";
          args: { commentId: number; commentThreadId: string };
      }
    | { command: "getCurrentVerseRef" }
    | { command: "fetchComments" };

interface SelectedTextDataWithContext {
    selection: string;
    completeLineContent: string | null;
    vrefAtStartOfLine: string | null;
    selectedText: string | null;
    verseNotes: string | null;
    verseGraphData: any;
}

type ChatPostMessages =
    | { command: "threadsFromWorkspace"; content: ChatMessageThread[] }
    | { command: "response"; finished: boolean; text: string }
    | { command: "reload" }
    | { command: "select"; textDataWithContext: SelectedTextDataWithContext }
    | { command: "fetch"; messages: string }
    | { command: "notifyUserError"; message: string }
    | {
          command: "updateMessageThread";
          messages: ChatMessageWithContext[];
          threadId: string;
          threadTitle?: string;
      }
    | { command: "deleteThread"; threadId: string }
    | { command: "fetchThread" }
    | { command: "abort-fetch" }
    | { command: "openSettings" }
    | { command: "openContextItem"; text: string }
    | { command: "cellGraphData"; data: string[] }
    | { command: "cellIdUpdate"; data: CellIdGlobalState & { sourceCellContent: string } }
    | { command: "getCurrentCellId" };

type DictionaryPostMessages =
    | { command: "sendData"; data: Dictionary }
    | { command: "webviewTellsProviderToUpdateData"; data: Dictionary }
    | { command: "webviewAsksProviderToConfirmRemove"; count: number; data: Dictionary }
    | { command: "updateEntryCount"; count: number }
    | { command: "updateFrequentWords"; words: string[] }
    | {
          command: "updateWordFrequencies";
          wordFrequencies: { [key: string]: number };
      }
    | { command: "updateDictionary"; content: Dictionary };

type DictionaryReceiveMessages =
    | { command: "providerTellsWebviewRemoveConfirmed" }
    | { command: "providerTellsWebviewToUpdateData"; data: Dictionary };

type DictionarySummaryPostMessages =
    | { command: "providerSendsDataToWebview"; data: Dictionary }
    | {
          command: "providerSendsUpdatedWordFrequenciesToWebview";
          wordFrequencies: { [key: string]: number };
      }
    | { command: "providerSendsFrequentWordsToWebview"; words: string[] }
    | { command: "updateData" }
    | { command: "showDictionaryTable" }
    | { command: "refreshWordFrequency" }
    | { command: "addFrequentWordsToDictionary"; words: string[] }
    | { command: "updateEntryCount"; count: number };

type TranslationNotePostMessages =
    | { command: "update"; data: ScriptureTSV }
    | { command: "changeRef"; data: VerseRefGlobalState };

type ScripturePostMessages =
    | { command: "sendScriptureData"; data: ScriptureContent }
    | { command: "fetchScriptureData" };

type OBSRef = {
    storyId: string;
    paragraph: string;
};

type DictionaryEntry = {
    id: string;
    headWord: string;
    hash: string;
};

type SpellCheckResult = {
    word: string;
    corrections: string[];
};

type SpellCheckFunction = (word: string) => SpellCheckResult;

type SpellCheckDiagnostic = {
    range: vscode.Range;
    message: string;
    severity: vscode.DiagnosticSeverity;
    source: string;
};

type MiniSearchVerseResult = {
    book: string;
    chapter: string;
    content: string;
    id: string;
    isSourceBible: boolean;
    line: number;
    match: { [key: string]: string[] };
    queryTerms: string[];
    score: number;
    terms: string[];
    uri: string;
    vref: string;
};

type MinimalCellResult = {
    cellId?: string;
    content?: string;
    uri?: string;
    line?: number;
};

type TranslationPair = {
    cellId: string;
    sourceCell: MinimalCellResult;
    targetCell: MinimalCellResult;
    edits?: EditHistory[]; // Make this optional as it might not always be present
};

type SourceCellVersions = {
    cellId: string;
    content: string;
    versions: string[];
};

type EditorCellContent = {
    cellMarkers: string[];
    cellContent: string;
    cellChanged: boolean; // Needed to add this
};

type EditorPostMessages =
    | { command: "from-quill-spellcheck-getSpellCheckResponse"; content: EditorCellContent }
    | { command: "addWord"; text: string }
    | { command: "saveHtml"; content: EditorCellContent }
    | { command: "getContent" }
    | {
          command: "setCurrentIdToGlobalState";
          content: { currentLineId: string };
      }
    | { command: "llmCompletion"; content: { currentLineId: string } }
    | { command: "requestAutocompleteChapter"; content: QuillCellContent[] }
    | { command: "updateTextDirection"; direction: "ltr" | "rtl" }
    | { command: "openSourceText"; content: { chapterNumber: number } };

type EditorReceiveMessages =
    | {
          type: "providerSendsInitialContent";
          content: QuillCellContent[];
          isSourceText: boolean;
      }
    | {
          type: "providerUpdatesCell";
          content: { cellId: string; progress: number };
      }
    | { type: "providerCompletesChapterAutocompletion" }
    | { type: "providerSendsSpellCheckResponse"; content: SpellCheckResponse }
    | { type: "providerUpdatesTextDirection"; textDirection: "ltr" | "rtl" }
    | { type: "providerSendsLLMCompletionResponse"; content: { completion: string } }
    | { type: "jumpToSection"; content: string };

type EditHistory = {
    cellValue: string;
    timestamp: number;
    type: import("./enums").EditType;
};

type CodexData = Timestamps; // add other data types with "&"

type CustomCellMetaData = {
    id: string;
    type: import("./enums").CodexCellTypes;
    data?: CodexData;
    edits?: EditHistory[];
    attachments?: {
        [key: string]: {
            url: string;
            type: string;
        };
    };
};

type CustomNotebookCellData = vscode.NotebookCellData & {
    metadata: CustomCellMetaData;
};

type CustomNotebookMetadata = {
    id: string;
    data?: { corpusMarker?: string };
    textDirection?: "ltr" | "rtl";
    perf?: any;
};

type CustomNotebookDocument = vscode.NotebookDocument & {
    metadata: CustomNotebookMetadata;
};

type CodexNotebookAsJSONData = {
    cells: CustomNotebookCellData[];
    metadata: CustomNotebookMetadata;
};

interface QuillCellContent {
    cellMarkers: string[];
    cellContent: string;
    cellType: import("./enums").CodexCellTypes;
    editHistory: Array<EditHistory>;
    timestamps?: Timestamps;
}

interface Timestamps {
    startTime?: number;
    endTime?: number;
}

// interface EditHistory {
//     timestamp: number;
//     type: string;
//     content: string;
//     // ... other fields
// }

interface EditorCellContent {
    cellMarkers: string[];
    content: string;
}

interface SpellCheckResponse {
    id: string;
    text: string;
    replacements: Array<{ value: string }>;
    offset: number;
    length: number;
}

type SpellCheckResult = SpellCheckResponse[];

/* This is the project overview that populates the project manager webview */
interface ProjectOverview {
    projectName: string;
    abbreviation: string;
    sourceLanguage: LanguageMetadata;
    targetLanguage: LanguageMetadata;
    category: string;
    userName: string;
    sourceTexts?: vscode.Uri[] | never[];
    targetTexts?: vscode.Uri[] | never[];
    targetFont: string;
    primarySourceText?: vscode.Uri;
}

/* This is the project metadata that is saved in the metadata.json file */
type ProjectMetadata = {
    format: string;
    meta: {
        version: string;
        category: string;
        generator: {
            softwareName: string;
            softwareVersion: string;
            userName: string;
        };
        defaultLocale: string;
        dateCreated: string;
        normalization: string;
        comments?: string[];
        primarySourceText?: vscode.Uri;
    };
    idAuthorities: {
        [key: string]: {
            id: string;
            name: {
                [lang: string]: string;
            };
        };
    };
    identification: {
        primary: {
            [authority: string]: {
                [id: string]: {
                    revision: string;
                    timestamp: string;
                };
            };
        };
        name: {
            [lang: string]: string;
        };
        description: {
            [lang: string]: string;
        };
        abbreviation: {
            [lang: string]: string;
        };
    };
    languages: Array<{
        tag: string;
        name: {
            [lang: string]: string;
        };
    }>;
    type: {
        flavorType: {
            name: string;
            flavor: {
                name: string;
                usfmVersion?: string;
                translationType?: string;
                audience?: string;
                projectType?: string;
            };
            currentScope: {
                [book: string]: any[];
            };
        };
    };
    confidential: boolean;
    agencies: Array<{
        id: string;
        roles: string[];
        url?: string;
        name: {
            [lang: string]: string;
        };
        abbr?: {
            [lang: string]: string;
        };
    }>;
    targetAreas?: Array<{
        code: string;
        name: {
            [lang: string]: string;
        };
    }>;
    ingredients?: {
        [path: string]: {
            checksum: {
                md5: string;
            };
            mimeType: string;
            size: number;
            scope?: {
                [book: string]: any[];
            };
        };
    };
    copyright?: {
        shortStatements: Array<{
            statement: string;
            mimetype: string;
            lang: string;
        }>;
    };
};

// Update or add these function signatures
declare function searchTargetCellsByQuery(
    translationPairsIndex: MiniSearch,
    query: string,
    k?: number
): MinimalCellResult[];

declare function getTranslationPairsFromSourceCellQuery(
    translationPairsIndex: MiniSearch,
    query: string,
    k?: number
): TranslationPair[];

declare function getSourceCellByCellIdFromAllSourceCells(
    sourceTextIndex: MiniSearch,
    cellId: string
): SourceCellVersions | null;

declare function getTargetCellByCellId(
    translationPairsIndex: MiniSearch,
    cellId: string
): MinimalCellResult | null;

declare function getTranslationPairFromProject(
    translationPairsIndex: MiniSearch,
    cellId: string
): TranslationPair | null;

declare function searchParallelCells(
    translationPairsIndex: MiniSearch,
    sourceTextIndex: MiniSearch,
    query: string,
    k?: number
): TranslationPair[];

export type SupportedFileExtension = "vtt" | "txt" | "usfm" | "sfm" | "SFM" | "USFM";

export type FileType = "subtitles" | "plaintext" | "usfm";

export interface FileTypeMap {
    vtt: "subtitles";
    txt: "plaintext";
    usfm: "usfm";
    sfm: "usfm";
    SFM: "usfm";
    USFM: "usfm";
}
