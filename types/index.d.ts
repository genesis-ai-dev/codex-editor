import { Dictionary, LanguageMetadata } from "codex-types";
import * as vscode from "vscode";
import { ScriptureTSV } from "./TsvTypes";
import { ParsedUSFM } from "./usfm-grammar";

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

interface VerseRefGlobalState {
    verseRef: string;
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
    | { command: "verseGraphData"; data: string[] };

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

type MinimalVerseResult = {
    vref: string;
    content: string;
    uri: string;
    line: number;
};

type TranslationPair = {
    vref: string;
    sourceVerse: MinimalVerseResult;
    targetVerse: MinimalVerseResult;
};

type SourceVerseVersions = {
    vref: string;
    content: string;
    versions: string[];
};
type EditorVerseContent = {
    verseMarkers: string[];
    content: string;
};

type EditorPostMessages =
    | { command: "from-quill-spellcheck-getSpellCheckResponse"; content: EditorVerseContent }
    | { command: "addWord"; text: string }
    | { command: "saveHtml"; content: EditorVerseContent }
    | {
          command: "updateMetadataWithUnsavedChanges";
          content: EditorVerseContent;
      }
    | { command: "getContent" }
    | {
          command: "setCurrentIdToGlobalState";
          content: { currentLineId: string };
      }
    | { command: "llmCompletion"; content: { currentLineId: string } };

type CustomNotebookCellData = vscode.NotebookCellData & {
    metadata: vscode.NotebookCellData["metadata"] & {
        edits?: {
            cellValue: string;
            timestamp: number;
            type: import("./enums").EditType;
        }[];
    };
};

type CustomNotebookData = vscode.NotebookDocument & {
    metadata: vscode.NotebookData["metadata"] & {
        id: string;
    };
    cells: CustomNotebookCellData[];
};

interface CellContent {
    verseMarkers: string[];
    verseContent: string;
    cellType: import("./enums").CodexCellTypes;
}

/* This is the project overview that populates the project manager webview */
interface ProjectOverview {
    projectName: string;
    abbreviation: string;
    sourceLanguage: LanguageMetadata;
    targetLanguage: LanguageMetadata;
    category: string;
    userName: string;
    sourceTextBibles?: vscode.Uri[] | never[];
    targetTextBibles?: vscode.Uri[] | never[];
    targetFont: string;
    primarySourceBible?: vscode.Uri;
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
        primarySourceBible?: vscode.Uri;
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

// interface FrontEndMessage {
//   command: {
//     name: string; // use enum
//     data?: any; // define based on enum
//   };
// }
// type CommentThread = vscode.CommentThread;

// interface ChatMessageThread {
//   id: string;
//   messages: ChatMessageWithContext[];
//   collapsibleState: number;
//   canReply: boolean;
//   threadTitle?: string;
//   deleted: boolean;
//   createdAt: string;
// }

// interface NotebookCommentThread {
//   id: string;
//   uri?: string;
//   verseRef: string;
//   comments: {
//     id: number;
//     body: string;
//     mode: number;
//     contextValue: "canDelete";
//     deleted: boolean;
//     author: {
//       name: string;
//     };
//   }[];
//   collapsibleState: number;
//   canReply: boolean;
//   threadTitle?: string;
//   deleted: boolean;
// }

// interface VerseRefGlobalState {
//   verseRef: string;
//   uri: string;
// }
// interface ScriptureContent extends vscode.NotebookData {
//   metadata: {
//     data?: {
//       chapter: string;
//     };
//     type?: "chapter-heading";
//   };
// }
// type NotebookCellKind = vscode.NotebookCellKind;

// type CommentPostMessages =
//   | { command: "commentsFromWorkspace"; content: string }
//   | { command: "reload"; data: VerseRefGlobalState }
//   | { command: "updateCommentThread"; commentThread: NotebookCommentThread }
//   | { command: "deleteCommentThread"; commentThreadId: string }
//   | {
//     command: "deleteComment";
//     args: { commentId: number; commentThreadId: string };
//   }
//   | { command: "getCurrentVerseRef" }
//   | { command: "fetchComments" };
// interface SelectedTextDataWithContext {
//   selection: string;
//   completeLineContent: string | null;
//   vrefAtStartOfLine: string | null;
//   selectedText: string | null;
// }

// type ChatPostMessages =
//   | { command: "threadsFromWorkspace"; content: ChatMessageThread[] }
//   | { command: "response"; finished: boolean; text: string }
//   | { command: "reload" }
//   | { command: "select"; textDataWithContext: SelectedTextDataWithContext }
//   | { command: "fetch"; messages: string }
//   | { command: "notifyUserError"; message: string }
//   | {
//     command: "updateMessageThread";
//     messages: ChatMessageWithContext[];
//     threadId: string;
//     threadTitle?: string;
//   }
//   | { command: "deleteThread"; threadId: string }
//   | { command: "fetchThread" }
//   | { command: "abort-fetch" }
//   | { command: "openSettings" };

// type DictionaryPostMessages =
//   | { command: "sendData"; data: Dictionary }
//   | { command: "updateData"; data: Dictionary }
//   | { command: "confirmRemove"; count: number }
//   | { command: "removeConfirmed" };

// type ScripturePostMessages =
//   | { command: "sendScriptureData"; data: ScriptureContent }
//   | { command: "fetchScriptureData" };
