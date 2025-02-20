import { LanguageMetadata, Project } from "codex-types";
import * as vscode from "vscode";
import { ScriptureTSV } from "./TsvTypes";
import { CodexCell } from "src/utils/codexNotebookUtils";
import { SavedBacktranslation } from "../smartEdits/smartBacktranslation";

interface ChatMessage {
    role: "system" | "user" | "assistant" | "context";
    content: string;
}

type Dictionary = {
    id: string;
    label: string;
    entries: DictionaryEntry[];
    metadata: DictionaryMetadata;
};

interface ChatMessageWithContext extends ChatMessage {
    context?: any; // FixMe: discuss what context could be. Cound it be a link to a note?
    createdAt: string;
    preReflection?: string; //If reflection has happened for a chat message, preReflection will be set to the original message.
    grade?: number;
    gradeComment?: string;
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
    cellId: CellIdGlobalState;
    comments: NotebookComment[];
    collapsibleState: number;
    canReply: boolean;
    threadTitle?: string;
    deleted: boolean;
}

interface NotebookComment {
    id: number;
    body: string;
    mode: number;
    contextValue: "canDelete";
    deleted: boolean;
    author: {
        name: string;
    };
}

type GlobalContentType =
    | {
          type: "targetText";
          targetText: string;
      }
    | {
          type: "sourceText";
          sourceText: string;
      }
    | {
          type: "cellId";
          cellId: string;
      }
    | {
          type: "cellAndText";
          cellId: string;
          text: string;
      }
    | {
          type: "translationPair";
          targetText: string;
          sourceText: string;
          cellId: string;
      };

interface GlobalMessage {
    command: string;
    destination: "webview" | "provider" | "all";
    content: GlobalContentType;
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
    author?: string;
}

// Relating to Smart Edits
interface SmartEditContext {
    cellId: string;
    currentCellValue: string;
    edits: EditHistoryItem[];
    memory?: string; // Add this line
}

interface SmartSuggestion {
    oldString: string;
    newString: string;
    confidence?: "high" | "low";
    source?: "llm" | "ice";
    frequency?: number;
}

export interface SavedSuggestions {
    cellId: string;
    lastCellValue: string;
    suggestions: SmartSuggestion[];
    lastUpdatedDate: string;
    rejectedSuggestions?: { oldString: string; newString: string }[];
}

interface SmartEdit {
    context: SmartEditContext;
    suggestions: SmartSuggestion[];
}

interface CellIdGlobalState {
    cellId: string;
    uri: string;
    timestamp?: string;
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
type VerseRefGlobalState = {
    verseRef: string;
    cellId: string;
    uri: string;
};
type CommentPostMessages =
    | { command: "commentsFromWorkspace"; content: string }
    | { command: "reload"; data: { cellId: string; uri: string } }
    | { command: "updateCommentThread"; commentThread: NotebookCommentThread }
    | { command: "deleteCommentThread"; commentThreadId: string }
    | {
          command: "deleteComment";
          args: { commentId: number; commentThreadId: string };
      }
    | { command: "getCurrentCellId"; data: CellIdGlobalState }
    | { command: "fetchComments" };

interface SelectedTextDataWithContext {
    selection: string;
    completeLineContent: string | null;
    vrefAtStartOfLine: string | null;
    selectedText: string | null;
    verseNotes: string | null;
    verseGraphData: any;
}

interface TimeBlock {
    begin: number;
    end: number;
    text: string;
    id: string;
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
    | { command: "requestGradeResponse"; messages: string; lastMessageCreatedAt: string }
    | { command: "respondWithGrade"; content: string; lastMessageCreatedAt: string }
    | {
          command: "performReflection";
          messageToReflect: string;
          context: string;
          lastMessageCreatedAt: string;
      }
    | { command: "reflectionResponse"; reflectedMessage: string; lastMessageCreatedAt: string }
    | { command: "deleteThread"; threadId: string }
    | { command: "fetchThread" }
    | { command: "abort-fetch" }
    | { command: "openSettings" }
    | { command: "subscribeSettings"; settingsToSubscribe: string[] }
    | { command: "updateSetting"; setting: string; value: string }
    | { command: "openContextItem"; text: string }
    | { command: "cellGraphData"; data: string[] }
    | {
          command: "cellIdUpdate";
          data: CellIdGlobalState & { sourceCellContent: { cellId: string; content: string } };
      }
    | { command: "getCurrentCellId" }
    | {
          command: "updateSourceCellMap";
          sourceCellMap: { [k: string]: { content: string; versions: string[] } };
      };

export type SourceUploadPostMessages =
    | {
          command: "uploadSourceText";
          files: Array<{ content: string; name: string }>;
      }
    | {
          command: "uploadTranslation";
          files: Array<{
              content: string;
              name: string;
              sourceId: string;
          }>;
      }
    | { command: "error"; errorMessage: string }
    | { command: "getAvailableCodexFiles" }
    | { command: "selectSourceFile" }
    | { command: "confirmSourceImport" }
    | { command: "confirmTranslationImport" }
    | { command: "confirmTranslationPairsImport"; headers: string[]; data: TranslationPairsPreview }
    | { command: "cancelSourceImport" }
    | { command: "cancelTranslationImport" }
    | { command: "downloadBible"; ebibleMetadata: ExtendedMetadata; asTranslationOnly: boolean }
    | { command: "confirmBibleDownload"; transaction: DownloadBibleTransaction }
    | { command: "cancelBibleDownload"; transaction: DownloadBibleTransaction }
    | { command: "getMetadata" }
    | { command: "importRemoteTranslation" }
    | { command: "importLocalTranslation" }
    | { command: "closePanel" }
    | { command: "previewSourceText"; fileContent: string; fileName: string }
    | { command: "extension.check"; extensionId: string };

export type SourceUploadResponseMessages =
    | {
          command: "translationPreview";
          previews: Array<{
              id: string;
              fileName: string;
              fileSize: number;
              preview: TranslationPreview;
              sourceId: string;
          }>;
      }
    | {
          command: "sourcePreview";
          previews: Array<{
              id: string;
              fileName: string;
              fileSize: number;
              preview: SourcePreview;
          }>;
      }
    | { command: "getMetadata"; metadata: any[] }
    | { command: "error"; message: string }
    | { command: "importComplete" }
    | { command: "setupComplete"; data: { path: string } }
    | { command: "sourceFileSelected"; data: { path: string } }
    | {
          command: "updateProcessingStatus";
          status: Record<string, ProcessingStatus>;
          progress?: { message: string; increment: number };
      }
    | { command: "importCancelled" }
    | { command: "availableCodexFiles"; files: Array<{ id: string; name: string; path: string }> }
    | {
          command: "bibleDownloadProgress";
          progress: {
              message?: string;
              increment?: number;
              status: Record<string, ProcessingStatus>;
          };
      }
    | { command: "bibleDownloadComplete" }
    | { command: "bibleDownloadError"; error: string }
    | {
          command: "biblePreview";
          preview: BiblePreview;
          transaction: DownloadBibleTransaction;
      }
    | { command: "fileHeaders"; headers: string[] }
    | { command: "preview"; preview: PreviewContent }
    | { command: "bibleDownloadCancelled" }
    | { command: "auth.statusResponse"; isAuthenticated: boolean; error?: string }
    | { command: "project.response"; success: boolean; projectPath?: string; error?: string }
    | {
          command: "updateAuthState";
          success: boolean;
          authState: {
              isAuthExtensionInstalled: boolean;
              isAuthenticated: boolean;
              isLoading: boolean;
              error?: string;
              gitlabInfo?: {
                  username: string;
                  email?: string;
                  id?: string;
              };
          };
      };

export type MessagesToStartupFlowProvider =
    | { command: "error"; errorMessage: string }
    | { command: "extension.check"; extensionId: string }
    | { command: "auth.login"; username: string; password: string }
    | { command: "auth.signup"; username: string; email: string; password: string }
    | { command: "auth.logout" }
    | { command: "auth.status" }
    | { command: "auth.checkAuthStatus" }
    | { command: "project.clone"; repoUrl: string }
    | { command: "project.new" }
    | { command: "workspace.status" }
    | { command: "workspace.open" }
    | { command: "workspace.create" }
    | { command: "workspace.continue" }
    | { command: "getProjectsListFromGitLab" }
    | { command: "getProjectsSyncStatus" }
    | { command: "project.open"; projectPath: string }
    | { command: "project.createEmpty" }
    | { command: "project.initialize"; waitForStateUpdate?: boolean }
    | { command: "metadata.check" };

export type GitLabProject = {
    id: number;
    name: string;
    description: string | null;
    visibility: string;
    url: string;
    webUrl: string;
    lastActivity: string;
    namespace: string;
    owner: string;
};

export type ProjectSyncStatus =
    | "downloadedAndSynced"
    | "cloudOnlyNotSynced"
    | "localOnlyNotSynced"
    | "error";

export type ProjectWithSyncStatus = LocalProject & { syncStatus: ProjectSyncStatus };

export type MessagesFromStartupFlowProvider =
    | { command: "projectsSyncStatus"; status: Record<string, "synced" | "cloud" | "error"> }
    | {
          command: "projectsListFromGitLab";
          projects: Array<ProjectWithSyncStatus>;
      }
    | {
          command: "checkWorkspaceState";
          isWorkspaceOpen: boolean;
      }
    | { command: "error"; message: string }
    | { command: "extension.checkResponse"; isInstalled: boolean }
    | { command: "auth.statusResponse"; isAuthenticated: boolean; error?: string }
    | {
          command: "updateAuthState";
          success: boolean;
          authState: {
              isAuthExtensionInstalled: boolean;
              isAuthenticated: boolean;
              isLoading: boolean;
              error?: string;
              gitlabInfo?: {
                  username: string;
                  email?: string;
                  id?: string;
              };
              workspaceState: {
                  isWorkspaceOpen: boolean;
                  isProjectInitialized: boolean;
              };
          };
      }
    | {
          command: "workspace.statusResponse";
          isOpen: boolean;
          path?: string;
      }
    | {
          command: "metadata.checkResponse";
          data: {
              exists: boolean;
              hasCriticalData: boolean;
          };
      }
    | { command: "setupIncompleteCriticalDataMissing" }
    | { command: "setupComplete" };
type DictionaryPostMessages =
    | {
          command: "webviewTellsProviderToUpdateData";
          operation: "update" | "add";
          entry: {
              id: string;
              headWord: string;
              definition: string;
          };
      }
    | {
          command: "webviewTellsProviderToUpdateData";
          operation: "fetchPage";
          pagination: {
              page: number;
              pageSize: number;
              searchQuery?: string;
          };
      }
    | {
          command: "webviewTellsProviderToUpdateData";
          operation: "delete";
          entry: {
              id: string;
          };
      }
    | { command: "webviewAsksProviderToConfirmRemove"; count: number; data: Dictionary }
    | { command: "updateEntryCount"; count: number }
    | { command: "updateFrequentWords"; words: string[] }
    | {
          command: "updateWordFrequencies";
          wordFrequencies: { [key: string]: number };
      }
    | { command: "updateDictionary"; content: Dictionary }
    | { command: "callCommand"; vscodeCommandName: string; args: any[] };

type DictionaryReceiveMessages =
    | { command: "providerTellsWebviewRemoveConfirmed" }
    | {
          command: "providerTellsWebviewToUpdateData";
          data: {
              entries: DictionaryEntry[];
              total: number;
              page: number;
              pageSize: number;
          };
      };

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

type DictionaryEntry = {
    id: string;
    headWord: string;
    definition?: string;
    isUserEntry: boolean;
    authorId?: string;
    createdAt?: string;
    updatedAt?: string;
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
    notebookId?: string;
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
    notebookId: string;
};

type EditorCellContent = {
    cellMarkers: string[];
    cellContent: string;
    cellChanged: boolean;
    cellLabel?: string;
    uri?: string;
};

interface EditHistoryEntry {
    before: string;
    after: string;
    timestamp: number;
    author?: string;
}

export type EditorPostMessages =
    | { command: "updateCachedChapter"; content: number }
    | { command: "webviewReady" }
    | { command: "getContent" }
    | { command: "setCurrentIdToGlobalState"; content: { currentLineId: string } }
    | { command: "webviewFocused"; content: { uri: string } }
    | { command: "updateCellLabel"; content: { cellId: string; cellLabel: string } }
    | { command: "updateNotebookMetadata"; content: CustomNotebookMetadata }
    | { command: "pickVideoFile" }
    | { command: "togglePinPrompt"; content: { cellId: string; promptText: string } }
    | { command: "from-quill-spellcheck-getSpellCheckResponse"; content: EditorCellContent }
    | { command: "getSourceText"; content: { cellId: string } }
    | { command: "searchSimilarCellIds"; content: { cellId: string } }
    | { command: "updateCellTimestamps"; content: { cellId: string; timestamps: Timestamps } }
    | { command: "deleteCell"; content: { cellId: string } }
    | { command: "addWord"; words: string[] }
    | { command: "getAlertCodes"; content: GetAlertCodes }
    | { command: "executeCommand"; content: { command: string; args: any[] } }
    | {
          command: "makeChildOfCell";
          content: {
              newCellId: string;
              referenceCellId: string;
              direction: "above" | "below";
              cellType: CodexCellTypes;
              data: CustomNotebookCellData["metadata"]["data"];
          };
      }
    | { command: "saveHtml"; content: EditorCellContent }
    | { command: "saveTimeBlocks"; content: TimeBlock[] }
    | { command: "replaceDuplicateCells"; content: QuillCellContent }
    | { command: "getContent" }
    | {
          command: "setCurrentIdToGlobalState";
          content: { currentLineId: string };
      }
    | { command: "llmCompletion"; content: { currentLineId: string } }
    | { command: "requestAutocompleteChapter"; content: QuillCellContent[] }
    | { command: "updateTextDirection"; direction: "ltr" | "rtl" }
    | { command: "openSourceText"; content: { chapterNumber: number } }
    | { command: "updateCellLabel"; content: { cellId: string; cellLabel: string } }
    | { command: "pickVideoFile" }
    | { command: "applyPromptedEdit"; content: { text: string; prompt: string; cellId: string } }
    | { command: "getTopPrompts"; content: { text: string; cellId: string } }
    | {
          command: "supplyRecentEditHistory";
          content: {
              cellId: string;
              editHistory: EditHistoryEntry[];
          };
      }
    | {
          command: "exportFile";
          content: { subtitleData: string; format: string; includeStyles: boolean };
      }
    | { command: "generateBacktranslation"; content: { text: string; cellId: string } }
    | {
          command: "editBacktranslation";
          content: {
              cellId: string;
              newText: string;
              existingBacktranslation: string;
          };
      }
    | { command: "getBacktranslation"; content: { cellId: string } }
    | {
          command: "setBacktranslation";
          content: {
              cellId: string;
              originalText: string;
              userBacktranslation: string;
          };
      }
    | {
          command: "rejectEditSuggestion";
          content: {
              source: "ice" | "llm";
              cellId?: string;
              oldString: string;
              newString: string;
              leftToken: string;
              rightToken: string;
          };
      };
type EditorReceiveMessages =
    | {
          type: "providerSendsInitialContent";
          content: QuillCellContent[];
          isSourceText: boolean;
          sourceCellMap: { [k: string]: { content: string; versions: string[] } };
      }
    | {
          type: "providerUpdatesCell";
          content: { cellId: string; progress: number };
      }
    | { type: "providerCompletesChapterAutocompletion" }
    | { type: "providerSendsSpellCheckResponse"; content: SpellCheckResponse }
    | {
          type: "providerSendsgetAlertCodeResponse";
          content: { [cellId: string]: number };
      }
    | { type: "providerUpdatesTextDirection"; textDirection: "ltr" | "rtl" }
    | { type: "providerSendsLLMCompletionResponse"; content: { completion: string } }
    | { type: "jumpToSection"; content: string }
    | { type: "providerUpdatesNotebookMetadataForWebview"; content: CustomNotebookMetadata }
    | { type: "updateVideoUrlInWebview"; content: string }
    | { type: "providerSendsPromptedEditResponse"; content: string }
    | { type: "providerSendsSimilarCellIdsResponse"; content: { cellId: string; score: number }[] }
    | { type: "providerSendsTopPrompts"; content: Array<{ prompt: string; isPinned: boolean }> }
    | { type: "providerSendsSourceText"; content: string }
    | {
          type: "providerSendsBacktranslation";
          content: SavedBacktranslation | null;
      }
    | {
          type: "providerSendsUpdatedBacktranslation";
          content: SavedBacktranslation | null;
      }
    | {
          type: "providerSendsExistingBacktranslation";
          content: SavedBacktranslation | null;
      }
    | {
          type: "providerConfirmsBacktranslationSet";
          content: SavedBacktranslation | null;
      };

type AlertCodesServerResponse = {
    code: number;
    cellId: string;
    savedSuggestions: { suggestions: string[] };
}[];

type GetAlertCodes = { text: string; cellId: string }[];

type EditHistory = {
    author: string;
    cellValue: string;
    timestamp: number;
    type: import("./enums").EditType;
};

type CodexData = Timestamps & {
    [key: string]: any;
};

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
    cellLabel?: string;
};

type CustomNotebookCellData = vscode.NotebookCellData & {
    metadata: CustomCellMetaData;
};

type CustomNotebookMetadata = {
    id: string;
    textDirection?: "ltr" | "rtl";
    perf?: any;
    attachments?: {
        [key: string]: {
            url: string;
            type: string;
        };
    };
    originalName: string;
    sourceFsPath: string | undefined;
    codexFsPath: string | undefined;
    navigation: NavigationCell[];
    videoUrl?: string;
    sourceCreatedAt: string;
    codexLastModified?: string;
    gitStatus:
        | "uninitialized"
        | "modified"
        | "added"
        | "deleted"
        | "renamed"
        | "conflict"
        | "untracked"
        | "committed"; // FIXME: we should probably programmatically do things like track .codex .source and .dictionary files
    corpusMarker: string;
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
    cellLabel?: string;
}

interface Timestamps {
    startTime?: number;
    endTime?: number;
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
interface ProjectOverview extends Project {
    projectName: string;
    projectId: string;
    abbreviation: string;
    sourceLanguage: LanguageMetadata;
    targetLanguage: LanguageMetadata;
    category: string;
    userName: string;
    userEmail: string;
    sourceTexts?: vscode.Uri[] | never[];
    targetTexts?: vscode.Uri[] | never[];
    targetFont: string;
    primarySourceText?: vscode.Uri;
    isAuthenticated: boolean;
    meta: Omit<Project["meta"], "generator"> & {
        generator: Project["meta"]["generator"] & { userEmail?: string };
    };
    spellcheckIsEnabled: boolean;
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
            userEmail?: string;
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

export type FileType = "subtitles" | "plaintext" | "usfm" | "usx" | "csv" | "tsv" | "codex";

export interface FileTypeMap {
    vtt: "subtitles";
    txt: "plaintext";
    usfm: "usfm";
    usx: "usx";
    sfm: "usfm";
    SFM: "usfm";
    USFM: "usfm";
    codex: "codex";
}

export interface AggregatedMetadata {
    id: string;
    originalName: string;
    sourceFsPath?: string;
    codexFsPath?: string;
    videoUrl?: string;
    lastModified?: string;
    gitStatus?:
        | "uninitialized"
        | "modified"
        | "added"
        | "deleted"
        | "renamed"
        | "conflict"
        | "untracked"
        | "committed";
}

// Add these to your existing types
export interface ValidationResult {
    isValid: boolean;
    errors: ValidationError[];
}

export interface ValidationError {
    code: ValidationErrorCode;
    message: string;
    details?: unknown;
}

export interface SourceFileValidationOptions {
    maxFileSizeBytes?: number;
    supportedExtensions?: FileTypeMap;
    minDiskSpaceBytes?: number;
}

interface ImportedContent {
    id: string;
    content: string;
    startTime?: number;
    endTime?: number;
    edits?: EditHistory[];
}

// Add or verify these message types
type ProjectManagerMessageFromWebview =
    | { command: "sendProjectsList"; data: Project[] }
    | { command: "requestProjectOverview" }
    | { command: "error"; message: string }
    | { command: "webviewReady" }
    | { command: "refreshState" }
    | { command: "initializeProject" }
    | { command: "renameProject" }
    | { command: "changeSourceLanguage"; language: LanguageMetadata }
    | { command: "changeTargetLanguage"; language: LanguageMetadata }
    | { command: "editAbbreviation" }
    | { command: "selectCategory" }
    | { command: "openSourceUpload" }
    | { command: "openAISettings" }
    | { command: "openExportView" }
    | { command: "closeProject" }
    | { command: "createNewWorkspaceAndProject" }
    | { command: "openProject"; data: { path: string } }
    | { command: "addWatchFolder" }
    | { command: "removeWatchFolder"; data: { path: string } }
    | { command: "refreshProjects" }
    | { command: "openProjectSettings" }
    | { command: "downloadSourceText" }
    | { command: "selectprimarySourceText"; data: string }
    | { command: "openBible"; data: { path: string } }
    | { command: "checkPublishStatus" }
    | { command: "publishProject" }
    | { command: "syncProject" }
    | { command: "openEditAnalysis" }
    | { command: "toggleSpellcheck" };

interface ProjectManagerState {
    projectOverview: ProjectOverview | null;
    webviewReady: boolean;
    watchedFolders: string[];
    projects: Array<LocalProject> | null;
    isScanning: boolean;
    canInitializeProject: boolean;
    workspaceIsOpen: boolean;
    repoHasRemote: boolean;
    isInitializing: boolean;
}
type ProjectManagerMessageToWebview =
    | {
          command: "stateUpdate";
          data: ProjectManagerState;
      }
    | {
          command: "publishStatus";
          data: {
              repoHasRemote: boolean;
          };
      };

// Ensure the Project type is correctly defined
interface LocalProject {
    name: string;
    path: string;
    lastOpened?: Date;
    lastModified: Date;
    version: string;
    hasVersionMismatch?: boolean;
    gitOriginUrl?: string;
    description: string;
    isOutdated?: boolean;
}

interface BasePreview {
    fileName: string;
    fileSize: number;
    fileType: FileType;
    original: {
        preview: string;
        validationResults: ValidationResult[];
    };
}

export interface SourcePreview extends BasePreview {
    type: "source";
    fileSize?: number;
    transformed: {
        books?: Array<{
            name: string;
            versesCount: number;
            chaptersCount: number;
        }>;
        sourceNotebooks: Array<NotebookPreview>;
        codexNotebooks: Array<NotebookPreview>;
        validationResults: ValidationResult[];
    };
}
//     original: {
//         preview: string;
//         validationResults: {
//             isValid: boolean;
//             errors: Array<{ message: string }>;
//         }[];
//     };
//     transformed: {
//         sourceNotebooks: NotebookPreview[];
//         validationResults: {
//             isValid: boolean;
//             errors: Array<{ message: string }>;
//         }[];
//     };
export interface BiblePreview extends BasePreview {
    type: "bible";
    original: {
        preview: string;
        validationResults: {
            isValid: boolean;
            errors: Array<{ message: string }>;
        }[];
    };
    transformed: {
        sourceNotebooks: NotebookPreview[];
        validationResults: {
            isValid: boolean;
            errors: Array<{ message: string }>;
        }[];
    };
}

interface RawSourcePreview {
    fileName: string;
    originalContent: {
        preview: string;
        validationResults: ValidationResult[];
    };
    transformedContent: {
        sourceNotebooks: Array<NotebookPreview>;
        codexNotebooks: Array<NotebookPreview>;
        validationResults: ValidationResult[];
    };
}

export interface TranslationPreview extends BasePreview {
    type: "translation";
    transformed: {
        sourceNotebook: {
            name: string;
            cells: Array<{
                value: string;
                metadata: { id: string; type: string };
            }>;
        };
        targetNotebook: {
            name: string;
            cells: Array<{
                value: string;
                metadata: { id: string; type: string };
            }>;
        };
        matchedCells: number;
        unmatchedContent: number;
        paratextItems: number;
        validationResults: ValidationResult[];
    };
}
export interface TranslationPairsPreview extends BasePreview {
    type: "translation-pairs";
    preview: {
        original: {
            preview: string;
            validationResults: ValidationResult[];
        };
        transformed: {
            sourceNotebook: {
                name: string;
                cells: Array<{
                    value: string;
                    metadata: { id: string; type: string };
                    kind: 2 | 1;
                    languageId: "html" | "markdown" | "usj";
                }>;
            };
            targetNotebook: {
                name: string;
                cells: Array<{
                    value: string;
                    metadata: { id: string; type: string };
                    kind: 2 | 1;
                    languageId: "html" | "markdown" | "usj";
                }>;
            };
            matchedCells: number;
            unmatchedContent: number;
            paratextItems: number;
            validationResults: ValidationResult[];
        };
    };
}

export type PreviewContent =
    | SourcePreview
    | TranslationPreview
    | BiblePreview
    | TranslationPairsPreview;

// Add new interfaces to support the preview structure
export interface NotebookPreview {
    name: string;
    cells: CodexCell[];
    metadata: CustomNotebookMetadata;
}

// Update BookPreview to be more specific
export interface BookPreview {
    name: string;
    versesCount: number;
    chaptersCount: number;
    previewContent?: string;
    sourceNotebook?: NotebookPreview;
    codexNotebook?: NotebookPreview;
}

export interface ValidationResult {
    isValid: boolean;
    errors: ValidationError[];
    warnings?: ValidationWarning[];
}

export interface ValidationError {
    code: ValidationErrorCode;
    message: string;
    details?: Record<string, unknown>;
}

export interface ValidationWarning {
    code: ValidationWarningCode;
    message: string;
    details?: Record<string, unknown>;
}

// Add to existing enums or create new ones
export enum ValidationErrorCode {
    FILE_SIZE_EXCEEDED = "FILE_SIZE_EXCEEDED",
    UNSUPPORTED_FILE_TYPE = "UNSUPPORTED_FILE_TYPE",
    INVALID_CONTENT = "INVALID_CONTENT",
    INSUFFICIENT_SPACE = "INSUFFICIENT_SPACE",
    SYSTEM_ERROR = "SYSTEM_ERROR",
}

export enum ValidationWarningCode {
    LARGE_FILE = "LARGE_FILE",
    UNUSUAL_STRUCTURE = "UNUSUAL_STRUCTURE",
    MISSING_METADATA = "MISSING_METADATA",
}

// Add new types for workflow state tracking
type WorkflowStep = "select" | "preview" | "confirm" | "processing" | "complete";

// Add ProcessingStage type
type ProcessingStatus = "pending" | "active" | "complete" | "error";

export interface CustomNotebookPreviewWithMetadata {
    translationId: string;
    languageCode: string;
    verseCount: number;
    preview: PreviewContent;
}

// export interface BiblePreviewData {
//     type: "bible";
//     original: {
//         preview: string;
//         validationResults: {
//             isValid: boolean;
//             errors: Array<{ message: string }>;
//         }[];
//     };
//     transformed: {
//         sourceNotebooks: NotebookPreview[];
//         validationResults: {
//             isValid: boolean;
//             errors: Array<{ message: string }>;
//         }[];
//     };
// }

export interface WorkflowState {
    step: WorkflowStep;
    importType: ImportType | null;
    selectedFile: string | null;
    processingStages: Record<string, ProcessingStage>;
    preview?: PreviewContent;
    progress?: {
        message: string;
        increment: number;
    };
    error?: string;
    bibleDownload?: {
        language: string;
        status: "downloading" | "complete" | "error";
        translationId: string;
    };
    currentTransaction?: DownloadBibleTransaction;
}

// Add Bible download specific types
export interface BibleDownloadStages {
    validation: ProcessingStage;
    download: ProcessingStage;
    splitting: ProcessingStage;
    notebooks: ProcessingStage;
    metadata: ProcessingStage;
    commit: ProcessingStage;
}

export interface ProcessingStage {
    label: string;
    description: string;
    status: ProcessingStatus;
}

export type ImportType = "source" | "translation" | "bible-download" | "translation-pairs";
