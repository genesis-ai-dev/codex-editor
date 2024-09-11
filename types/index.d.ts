import { Dictionary } from "codex-types";
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
    | { command: "openContextItem"; text: string };

type DictionaryPostMessages =
    | { command: "sendData"; data: Dictionary }
    | { command: "updateData"; data: Dictionary }
    | { command: "confirmRemove"; count: number }
    | { command: "updateEntryCount"; count: number }
    | { command: "removeConfirmed" }
    | { command: "updateFrequentWords"; words: string[] }
    | {
          command: "updateWordFrequencies";
          wordFrequencies: { [key: string]: number };
      };

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
    verseIndex: number;
};

type EditorPostMessages =
    | { command: "spellCheck"; content: EditorVerseContent }
    | { command: "addWord"; text: string }
    | { command: "saveMarkdown"; content: EditorVerseContent }
    | {
          command: "updateMetadataWithUnsavedChanges";
          content: EditorVerseContent;
      }
    | { command: "getContent" }
    | {
          command: "setCurrentIdToGlobalState";
          content: { currentLineId: string };
      };

type CustomNotebook = vscode.NotebookCellData & {
    language: string;
};

type CustomNotebookData = {
    metadata: vscode.NotebookData["metadata"];
    cells: CustomNotebook[];
};

export enum MainChatLanguage {
    English = "English",
    Tamil = "தமிழ் (Tamil)",
    Telugu = "తెలుగు (Telugu)",
    Kannada = "ಕನ್ನಡ (Kannada)",
    Hindi = "हिन्दी (Hindi)",
    Gujarati = "ગુજરાતી (Gujarati)",
    Spanish = "Español (Spanish)",
    French = "Français (French)",
    German = "Deutsch (German)",
    Italian = "Italiano (Italian)",
    Dutch = "Nederlands (Dutch)",
    Portuguese = "Português (Portuguese)",
    Russian = "Русский (Russian)",
    Chinese = "中文 (Chinese)",
    Japanese = "日本語 (Japanese)",
    Korean = "한국어 (Korean)",
    Arabic = "العربية (Arabic)",
    Turkish = "Türkçe (Turkish)",
    Vietnamese = "Tiếng Việt (Vietnamese)",
    Thai = "ไทย (Thai)",
    Indonesian = "Bahasa Indonesia (Indonesian)",
    Malay = "Bahasa Melayu (Malay)",
    Filipino = "Filipino (Filipino)",
    Bengali = "বাংলা (Bengali)",
    Punjabi = "ਪੰਜਾਬੀ (Punjabi)",
    Marathi = "मराठी (Marathi)",
    Odia = "ଓଡ଼ିଆ (Odia)",
    Kiswahili = "Swahili (Kiswahili)",
    Urdu = "اردو (Urdu)",
    Persian = "فارسی (Persian)",
    Hausa = "Hausa",
    Amharic = "አማርኛ (Amharic)",
    Javanese = "ꦧꦱꦗꦮ (Javanese)",
    Burmese = "မြန်မာဘာသာ (Burmese)",
    Swedish = "Svenska (Swedish)",
    Norwegian = "Norsk (Norwegian)",
    Finnish = "Suomi (Finnish)",
    Danish = "Dansk (Danish)",
    Hebrew = "עברית (Hebrew)",
    Ukrainian = "Українська (Ukrainian)",
    Polish = "Polski (Polish)",
    Romanian = "Română (Romanian)",
    Czech = "Čeština (Czech)",
    Hungarian = "Magyar (Hungarian)",
    Greek = "Ελληνικά (Greek)",
    Serbian = "Српски (Serbian)",
    Croatian = "Hrvatski (Croatian)",
    Bulgarian = "Български (Bulgarian)",
    Slovak = "Slovenčina (Slovak)",
    Malayalam = "മലയാളം (Malayalam)",
    Sinhala = "සිංහල (Sinhala)",
    Khmer = "ភាសាខ្មែរ (Khmer)",
    Lao = "ພາສາລາວ (Lao)",
}
