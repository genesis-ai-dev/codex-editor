import { LanguageMetadata, Project } from "codex-types";
import * as vscode from "vscode";
import { ScriptureTSV } from "./TsvTypes";
import { CodexCell } from "src/utils/codexNotebookUtils";
import { SavedBacktranslation } from "../smartEdits/smartBacktranslation";
import { CodexCellTypes } from "./enums";

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
    cellId: CellIdGlobalState;
    comments: NotebookComment[];
    collapsibleState: number;
    canReply: boolean;
    threadTitle?: string;
    deletionEvent?: Array<{
        timestamp: number;
        author: {
            name: string;
        };
        deleted: boolean;
    }>;
    resolvedEvent?: Array<{
        timestamp: number;
        author: {
            name: string;
        };
        resolved: boolean;
    }>;
}

interface NotebookComment {
    id: string; // Changed from number to string for unique IDs
    timestamp: number; // Added timestamp in milliseconds since epoch
    body: string;
    mode: number;
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
    }
    | {
        type: "commentsFileChanged";
        timestamp: string;
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

// Generic EditHistoryItem that infers value type from editMap
interface EditHistoryItem<TEditMap extends readonly string[] = readonly string[]> {
    editMap: TEditMap;
    value: EditMapValueType<TEditMap>;
    timestamp: number;
    type: import("./enums").EditType;
    author?: string;
    validatedBy?: ValidationEntry[];
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
    rejectedSuggestions?: { oldString: string; newString: string; }[];
}

interface SmartEdit {
    context: SmartEditContext;
    suggestions: SmartSuggestion[];
}

interface CellIdGlobalState {
    cellId: string; // UUID for internal cell reference
    globalReferences: string[]; // Array of Bible references (e.g., ["GEN 1:1", "GEN 1:2"]) - primary mechanism for highlighting
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
    | { command: "commentsFromWorkspace"; content: string; isLiveUpdate?: boolean; }
    | { command: "reload"; data?: { cellId: string; globalReferences: string[]; uri?: string; }; }
    | { command: "updateCommentThread"; commentThread: NotebookCommentThread; }
    | { command: "deleteCommentThread"; commentThreadId: string; }
    | { command: "deleteComment"; args: { commentId: string; commentThreadId: string; }; }
    | { command: "undoCommentDeletion"; args: { commentId: string; commentThreadId: string; }; }
    | { command: "getCurrentCellId"; }
    | { command: "fetchComments"; }
    | { command: "updateUserInfo"; userInfo?: { username: string; email: string; }; }
    | { command: "updateUser"; user: { id: any; name: any; avatar: any; }; }
    | { command: "navigateToMainMenu"; };

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
    | { command: "threadsFromWorkspace"; content: ChatMessageThread[]; }
    | { command: "response"; finished: boolean; text: string; }
    | { command: "reload"; }
    | { command: "select"; textDataWithContext: SelectedTextDataWithContext; }
    | { command: "fetch"; messages: string; }
    | { command: "notifyUserError"; message: string; }
    | {
        command: "updateMessageThread";
        messages: ChatMessageWithContext[];
        threadId: string;
        threadTitle?: string;
    }
    | { command: "requestGradeResponse"; messages: string; lastMessageCreatedAt: string; }
    | { command: "respondWithGrade"; content: string; lastMessageCreatedAt: string; }
    | {
        command: "performReflection";
        messageToReflect: string;
        context: string;
        lastMessageCreatedAt: string;
    }
    | { command: "reflectionResponse"; reflectedMessage: string; lastMessageCreatedAt: string; }
    | { command: "deleteThread"; threadId: string; }
    | { command: "fetchThread"; }
    | { command: "abort-fetch"; }
    | { command: "openSettings"; }
    | { command: "subscribeSettings"; settingsToSubscribe: string[]; }
    | { command: "updateSetting"; setting: string; value: string; }
    | { command: "openContextItem"; text: string; }
    | { command: "cellGraphData"; data: string[]; }
    | {
        command: "cellIdUpdate";
        data: CellIdGlobalState & { sourceCellContent: { cellId: string; content: string; }; };
    }
    | { command: "getCurrentCellId"; }
    | { command: "navigateToMainMenu"; };



export type MessagesToStartupFlowProvider =
    | { command: "error"; errorMessage: string; }
    | { command: "extension.check"; extensionId: string; }
    | { command: "auth.login"; username: string; password: string; }
    | { command: "auth.signup"; username: string; email: string; password: string; }
    | { command: "auth.logout"; }
    | { command: "auth.status"; }
    | { command: "auth.checkAuthStatus"; }
    | { command: "auth.backToLogin"; }
    | { command: "auth.requestPasswordReset"; }
    // | { command: "auth.requestPasswordReset"; resetEmail: string; }
    | { command: "project.clone"; repoUrl: string; mediaStrategy?: MediaFilesStrategy; }
    | { command: "project.new"; }
    | { command: "workspace.status"; }
    | { command: "workspace.open"; }
    | { command: "workspace.create"; }
    | { command: "workspace.continue"; }
    | { command: "getProjectsListFromGitLab"; }
    | { command: "forceRefreshProjectsList"; }
    | { command: "getProjectsSyncStatus"; }
    | { command: "project.open"; projectPath: string; mediaStrategy?: MediaFilesStrategy; }
    | { command: "project.delete"; projectPath: string; syncStatus?: ProjectSyncStatus; }
    | { command: "project.createEmpty"; }
    | { command: "project.createEmptyWithName"; projectName: string; }
    | { command: "project.createEmpty.confirm"; proceed: boolean; projectName?: string; projectId?: string; }
    | { command: "project.checkNameExists"; projectName: string; }
    | { command: "project.initialize"; waitForStateUpdate?: boolean; }
    | { command: "metadata.check"; }
    | { command: "project.showManager"; }
    | { command: "project.triggerSync"; message?: string; }
    | { command: "project.submitProgressReport"; forceSubmit?: boolean; }
    | { command: "getProjectProgress"; }
    | { command: "getAggregatedProgress"; }
    | { command: "showProgressDashboard"; }
    | { command: "startup.dismiss"; }
    | { command: "skipAuth"; }
    | { command: "webview.ready"; }
    | { command: "extension.installFrontier"; }
    | { command: "navigateToMainMenu"; }
    | { command: "zipProject"; projectName: string; projectPath: string; includeGit?: boolean; }
    | { command: "project.heal"; projectName: string; projectPath: string; gitOriginUrl?: string; }
    | { command: "project.setMediaStrategy"; projectPath: string; mediaStrategy: MediaFilesStrategy; }
    | { command: "project.cleanupMediaFiles"; projectPath: string; };

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

export type MediaFilesStrategy =
    | "auto-download"     // Download and save media files automatically
    | "stream-and-save"   // Stream media files and save in background
    | "stream-only";      // Stream media files without saving (read from network each time)

export type ProjectWithSyncStatus = LocalProject & {
    syncStatus: ProjectSyncStatus;
    mediaStrategy?: MediaFilesStrategy; // Media files download strategy for this project
    completionPercentage?: number;
};

export type MessagesFromStartupFlowProvider =
    | { command: "projectsSyncStatus"; status: Record<string, "synced" | "cloud" | "error">; }
    | {
        command: "projectsListFromGitLab";
        projects: Array<ProjectWithSyncStatus>;
        error?: string;
    }
    | {
        command: "checkWorkspaceState";
        isWorkspaceOpen: boolean;
    }
    | { command: "error"; message: string; }
    | { command: "extension.checkResponse"; isInstalled: boolean; }
    | { command: "auth.statusResponse"; isAuthenticated: boolean; error?: string; }
    | { command: "passwordReset.success"; }
    | { command: "passwordReset.error"; error: string; }
    | { command: "project.deleteResponse"; success: boolean; projectPath?: string; error?: string; }
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
    | { command: "setupIncompleteCriticalDataMissing"; }
    | { command: "setupComplete"; }
    | { command: "project.progressReportSubmitted"; success: boolean; error?: string; }
    | { command: "progressData"; data: any; }
    | { command: "aggregatedProgressData"; data: any; }
    | { command: "project.nameWillBeSanitized"; original: string; sanitized: string; projectId?: string; }
    | { command: "project.nameExistsCheck"; exists: boolean; isCodexProject: boolean; errorMessage?: string; }
    | { command: "project.healingInProgress"; projectPath: string; healing: boolean; }
    | { command: "project.cloningInProgress"; projectPath: string; gitOriginUrl?: string; cloning: boolean; }
    | { command: "project.openingInProgress"; projectPath: string; opening: boolean; }
    | { command: "project.zippingInProgress"; projectPath: string; zipType: "full" | "mini"; zipping: boolean; }
    | { command: "project.cleaningInProgress"; projectPath: string; cleaning: boolean; };

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
    | { command: "webviewAsksProviderToConfirmRemove"; count: number; data: Dictionary; }
    | { command: "updateEntryCount"; count: number; }
    | { command: "updateFrequentWords"; words: string[]; }
    | {
        command: "updateWordFrequencies";
        wordFrequencies: { [key: string]: number; };
    }
    | { command: "updateDictionary"; content: Dictionary; }
    | { command: "callCommand"; vscodeCommandName: string; args: any[]; };

type DictionaryReceiveMessages =
    | { command: "providerTellsWebviewRemoveConfirmed"; }
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
    | { command: "providerSendsDataToWebview"; data: Dictionary; }
    | {
        command: "providerSendsUpdatedWordFrequenciesToWebview";
        wordFrequencies: { [key: string]: number; };
    }
    | { command: "providerSendsFrequentWordsToWebview"; words: string[]; }
    | { command: "updateData"; }
    | { command: "showDictionaryTable"; }
    | { command: "refreshWordFrequency"; }
    | { command: "addFrequentWordsToDictionary"; words: string[]; }
    | { command: "updateEntryCount"; count: number; };

type TranslationNotePostMessages =
    | { command: "update"; data: ScriptureTSV; }
    | { command: "changeRef"; data: VerseRefGlobalState; };

type ScripturePostMessages =
    | { command: "sendScriptureData"; data: ScriptureContent; }
    | { command: "fetchScriptureData"; };

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
    match: { [key: string]: string[]; };
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
    cellTimestamps?: Timestamps;
};

interface EditHistoryEntry {
    before: string;
    after: string;
    timestamp: number;
    author?: string;
}

export type EditorPostMessages =
    | { command: "updateCachedChapter"; content: number; }
    | { command: "updateCachedSubsection"; content: number; }
    | { command: "webviewReady"; }
    | { command: "getContent"; }
    | { command: "getPreferredEditorTab"; }
    | {
        command: "setPreferredEditorTab";
        content: {
            tab:
            | "source"
            | "backtranslation"
            | "footnotes"
            | "timestamps"
            | "audio";
        };
    }
    | { command: "setCurrentIdToGlobalState"; content: { currentLineId: string; }; }
    | { command: "webviewFocused"; content: { uri: string; }; }
    | { command: "updateCellLabel"; content: { cellId: string; cellLabel: string; }; }
    | { command: "updateCellIsLocked"; content: { cellId: string; isLocked: boolean; }; }
    | { command: "updateNotebookMetadata"; content: CustomNotebookMetadata; }
    | { command: "updateCellDisplayMode"; mode: "inline" | "one-line-per-cell"; }
    | { command: "pickVideoFile"; }
    | { command: "togglePinPrompt"; content: { cellId: string; promptText: string; }; }
    | { command: "from-quill-spellcheck-getSpellCheckResponse"; content: EditorCellContent; }
    | { command: "getSourceText"; content: { cellId: string; }; }
    | { command: "searchSimilarCellIds"; content: { cellId: string; }; }
    | { command: "updateCellTimestamps"; content: { cellId: string; timestamps: Timestamps; }; }
    | { command: "deleteCell"; content: { cellId: string; }; }
    | { command: "addWord"; words: string[]; }
    | { command: "getAlertCodes"; content: GetAlertCodes; }
    | { command: "executeCommand"; content: { command: string; args: any[]; }; }
    | { command: "togglePrimarySidebar"; }
    | { command: "toggleSecondarySidebar"; }
    | { command: "focusMainMenu"; }
    | { command: "toggleSidebar"; content?: { isOpening: boolean; }; }
    | { command: "getEditorPosition"; }
    | { command: "validateCell"; content: { cellId: string; validate: boolean; }; }
    | { command: "validateAudioCell"; content: { cellId: string; validate: boolean; }; }
    | {
        command: "queueValidation";
        content: { cellId: string; validate: boolean; pending: boolean; };
    }
    | { command: "applyPendingValidations"; }
    | { command: "clearPendingValidations"; }
    | { command: "getCurrentUsername"; }
    | { command: "getValidationCount"; }
    | { command: "getValidationCountAudio"; }
    | { command: "stopAutocompleteChapter"; }
    | { command: "stopSingleCellTranslation"; }
    | { command: "triggerReindexing"; }
    | { command: "jumpToChapter"; chapterNumber: number; }
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
    | { command: "saveHtml"; requestId?: string; content: EditorCellContent; }
    | { command: "saveTimeBlocks"; content: TimeBlock[]; }
    | { command: "replaceDuplicateCells"; content: QuillCellContent; }
    | { command: "getContent"; }
    | {
        command: "setCurrentIdToGlobalState";
        content: { currentLineId: string; };
    }
    | { command: "llmCompletion"; content: { currentLineId: string; addContentToValue?: boolean; }; }
    | { command: "requestAutocompleteChapter"; content: QuillCellContent[]; }
    | { command: "updateTextDirection"; direction: "ltr" | "rtl"; }
    | { command: "openSourceText"; content: { chapterNumber: number; }; }
    | { command: "updateCellLabel"; content: { cellId: string; cellLabel: string; }; }
    | { command: "pickVideoFile"; }
    | { command: "applyPromptedEdit"; content: { text: string; prompt: string; cellId: string; }; }
    | { command: "getTopPrompts"; content: { text: string; cellId: string; }; }
    | {
        command: "supplyRecentEditHistory";
        content: {
            cellId: string;
            editHistory: EditHistoryEntry[];
        };
    }
    | {
        command: "exportFile";
        content: { subtitleData: string; format: string; includeStyles: boolean; };
    }
    | { command: "generateBacktranslation"; content: { text: string; cellId: string; }; }
    | {
        command: "editBacktranslation";
        content: {
            cellId: string;
            newText: string;
            existingBacktranslation: string;
        };
    }
    | { command: "getBacktranslation"; content: { cellId: string; }; }
    | { command: "getBatchBacktranslations"; content: { cellIds: string[]; }; }
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
    }
    | {
        command: "storeFootnote";
        content: {
            cellId: string;
            footnoteId?: string;
            content?: string;
            position?: number;
            deleteFootnote?: string;
        };
    }
    | { command: "openBookNameEditor"; }
    | { command: "editBookName"; content: { bookAbbr: string; newBookName: string; }; }
    | { command: "editCorpusMarker"; content: { corpusLabel: string; newCorpusName: string; }; }
    | { command: "closeCurrentDocument"; content?: { isSource: boolean; uri?: string; }; }
    | { command: "triggerSync"; }
    // removed: requestAudioAttachments
    | { command: "requestAudioForCell"; content: { cellId: string; audioId?: string; }; }
    | { command: "getCommentsForCell"; content: { cellId: string; }; }
    | { command: "getCommentsForCells"; content: { cellIds: string[]; }; }
    | { command: "openCommentsForCell"; content: { cellId: string; }; }
    | {
        command: "saveAudioAttachment";
        requestId?: string;
        content: {
            cellId: string;
            audioData: string; // base64 encoded audio data
            audioId: string; // unique ID for the audio file
            fileExtension: string; // e.g., "webm", "wav", "mp3"
            metadata?: {
                mimeType?: string;
                sizeBytes?: number;
                sampleRate?: number; // Hz
                channels?: number; // 1 = mono, 2 = stereo
                durationSec?: number; // seconds (float)
                bitrateKbps?: number; // approximate kbps
            };
        };
    }
    | {
        command: "deleteAudioAttachment";
        content: {
            cellId: string;
            audioId: string;
        };
    }
    | {
        command: "getAudioHistory";
        content: {
            cellId: string;
        };
    }
    | {
        command: "revalidateMissingForCell";
        content: {
            cellId: string;
        };
    }
    | {
        command: "restoreAudioAttachment";
        content: {
            cellId: string;
            audioId: string;
        };
    }
    | {
        command: "selectAudioAttachment";
        content: {
            cellId: string;
            audioId: string;
        };
    }
    | {
        command: "updateCellAfterTranscription";
        content: {
            cellId: string;
            transcribedText: string;
            language: string;
        };
    }
    | { command: "getAsrConfig"; }
    | {
        command: "mergeCellWithPrevious";
        content: {
            currentCellId: string;
            previousCellId: string;
            currentContent: string;
            previousContent: string;
        };
    }
    | { command: "toggleCorrectionEditorMode"; }
    | {
        command: "cancelMerge";
        content: {
            cellId: string;
        };
    }
    | {
        command: "confirmCellMerge";
        content: {
            currentCellId: string;
            previousCellId: string;
            currentContent: string;
            previousContent: string;
            message: string;
        };
    }
    | {
        command: "showErrorMessage";
        text: string;
    }
    | {
        command: "selectABTestVariant";
        content: {
            cellId: string;
            selectedIndex: number;
            testId: string;
            selectionTimeMs: number;
            totalVariants: number;
        };
    }
    | { command: "adjustABTestingProbability"; content: { delta: number; buttonChoice?: "more" | "less"; testId?: string; cellId?: string; }; }
    | { command: "openLoginFlow"; }
    | {
        command: "requestCellsForMilestone";
        content: {
            milestoneIndex: number;
            subsectionIndex?: number; // For sub-pagination within milestone
        };
    }
    | {
        command: "requestSubsectionProgress";
        content: {
            milestoneIndex: number;
        };
    }
    | {
        command: "updateMilestoneValue";
        content: {
            milestoneIndex: number;
            newValue: string;
            deferRefresh?: boolean; // If true, skip webview refresh (for batching multiple edits)
        };
    }
    | {
        command: "refreshWebviewAfterMilestoneEdits";
        content?: Record<string, never>; // Empty content
    };

// (revalidateMissingForCell added above in EditorPostMessages union)

type AlertCodesServerResponse = {
    code: number;
    cellId: string;
    savedSuggestions: { suggestions: string[]; };
}[];

type GetAlertCodes = { text: string; cellId: string; }[];

/**
 * Represents a validation entry by a user
 */
interface ValidationEntry {
    username: string;
    creationTimestamp: number;
    updatedTimestamp: number;
    isDeleted: boolean;
}

// Utility type to extract value type for a given editMap
type EditMapValueType<T extends readonly string[]> =
    // Check for exact tuple matches
    T extends readonly ["value"] ? string
    : T extends readonly ["metadata", "cellLabel"] ? string
    : T extends readonly ["metadata", "data"] ? CodexData
    : T extends readonly ["metadata", "data", "deleted"] ? boolean
    : T extends readonly ["metadata", "data", "startTime"] ? number
    : T extends readonly ["metadata", "data", "endTime"] ? number
    : T extends readonly ["metadata", "data", "book"] ? string
    : T extends readonly ["metadata", "data", "chapter"] ? string
    : T extends readonly ["metadata", "data", "verse"] ? string
    : T extends readonly ["metadata", "data", "merged"] ? boolean
    : T extends readonly ["metadata", "milestone"] ? string
    : T extends readonly ["metadata", "selectedAudioId"] ? string
    : T extends readonly ["metadata", "selectionTimestamp"] ? number
    : T extends readonly ["metadata", "isLocked"] ? boolean
    // File-level metadata fields
    : T extends readonly ["metadata", "videoUrl"] ? string
    : T extends readonly ["metadata", "textDirection"] ? "ltr" | "rtl"
    : T extends readonly ["metadata", "lineNumbersEnabled"] ? boolean
    : T extends readonly ["metadata", "fontSize"] ? number
    : T extends readonly ["metadata", "autoDownloadAudioOnOpen"] ? boolean
    : T extends readonly ["metadata", "showInlineBacktranslations"] ? boolean
    : T extends readonly ["metadata", "fileDisplayName"] ? string
    : T extends readonly ["metadata", "cellDisplayMode"] ? "inline" | "one-line-per-cell"
    : T extends readonly ["metadata", "audioOnly"] ? boolean
    // Fallback for unmatched paths
    : string | number | boolean | object;

// Conditional type for EditHistory that infers value type based on editMap
type EditHistoryBase = {
    author: string;
    timestamp: number;
    type: import("./enums").EditType;
    validatedBy?: ValidationEntry[];
};

export type EditHistory<TEditMap extends readonly string[] = readonly string[]> = EditHistoryBase & {
    editMap: TEditMap;
    value: EditMapValueType<TEditMap>;
    /** Optional flag to indicate a non-persisting preview edit (e.g., LLM preview) */
    preview?: boolean;
};

// Legacy alias for backward compatibility
export type EditHistoryMutable = EditHistory;

// Utility type for creating type-safe edits
export type EditFor<TEditMap extends readonly string[]> = {
    editMap: TEditMap;
    value: EditMapValueType<TEditMap>;
    author: string;
    timestamp: number;
    type: import("./enums").EditType;
    validatedBy?: ValidationEntry[];
};

// File-level edit type for metadata edits (separate from EditHistory)
export type FileEditHistory<TEditMap extends readonly string[] = readonly string[]> = {
    editMap: TEditMap;
    value: EditMapValueType<TEditMap>;
    timestamp: number;
    type: import("./enums").EditType;
    author: string;
};

// Project-level metadata edit type (for metadata.json)
export type ProjectEditHistory<TEditMap extends readonly string[] = readonly string[]> = {
    editMap: TEditMap;
    value: EditMapValueType<TEditMap>;
    timestamp: number;
    type: import("./enums").EditType;
    author: string;
};



type CodexData = Timestamps & {
    // [key: string]: any; this makes it very hard to type the data
    footnotes?: Footnote[];
    book?: string;
    chapter?: string;
    verse?: string;
    merged?: boolean;
    deleted?: boolean;
    originalText?: string;
    globalReferences?: string[]; // Array of cell IDs in original format (e.g., "GEN 1:1") used for header generation
};

type BaseCustomCellMetaData = {
    id: string;
    type: CodexCellTypes;
    edits: EditHistory[];
    parentId?: string; // UUID of parent cell (for child cells like cues, paratext, etc.)
    isLocked?: boolean;
};

export type BaseCustomNotebookCellData = Omit<vscode.NotebookCellData, 'metadata'> & {
    metadata: BaseCustomCellMetaData;
};

type CustomCellMetaData = BaseCustomCellMetaData & {
    data?: CodexData;
    attachments?: {
        [key: string]: {
            url: string;
            type: string;
            createdAt: number;
            updatedAt: number;
            isDeleted: boolean;
            isMissing?: boolean;
            validatedBy?: ValidationEntry[];
            createdBy?: string;
        };
    };
    cellLabel?: string;
    selectedAudioId?: string; // Points to attachment key for explicit audio selection
    selectionTimestamp?: number; // Timestamp when selectedAudioId was last set
};

export type CustomNotebookCellData = Omit<vscode.NotebookCellData, 'metadata'> & {
    metadata: CustomCellMetaData;
};

export interface CustomNotebookMetadata {
    id: string;
    textDirection?: "ltr" | "rtl";
    textDirectionSource?: "global" | "local"; // Track whether text direction was set globally or locally
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
    audioOnly?: boolean; // When true, the document contains only audio segments with no source text
    sourceCreatedAt: string;
    codexLastModified?: string;
    corpusMarker: string;
    cellDisplayMode?: "inline" | "one-line-per-cell";
    validationMigrationComplete?: boolean;
    fontSize?: number;
    fontSizeSource?: "global" | "local"; // Track whether font size was set globally or locally
    lineNumbersEnabled?: boolean;
    lineNumbersEnabledSource?: "global" | "local"; // Track whether line numbers visibility was set globally or locally
    /** When true, the editor will download/stream audio as soon as a cell opens */
    autoDownloadAudioOnOpen?: boolean;
    /** When true, backtranslations will be displayed inline below cells */
    showInlineBacktranslations?: boolean;
    fileDisplayName?: string;
    edits?: FileEditHistory[];
    importerType?: FileImporterType;
    /**
     * The original filename of the imported artifact (if any).
     * Example: "MAT.idml", "mydoc.docx"
     */
    originalFileName?: string;
    /**
     * Canonical source identifier for the imported artifact.
     * Stored at notebook-level (not per-cell). For most importers this matches originalFileName.
     */
    sourceFile?: string;
    /**
     * One-time import context derived from the import process.
     * This is the canonical home for attributes that do not vary per-cell.
     */
    importContext?: NotebookImportContext;
}

type CustomNotebookDocument = vscode.NotebookDocument & {
    metadata: CustomNotebookMetadata;
};

export type NotebookAsJSONData<TCells, TMetadata> = {
    cells: TCells[];
    metadata: TMetadata;
};

type CodexNotebookAsJSONData = NotebookAsJSONData<CustomNotebookCellData, CustomNotebookMetadata>;

type FileImporterType =
    | "smart-segmenter"
    | "plaintext"
    | "audio"
    | "docx"
    | "docx-roundtrip"
    | "markdown"
    | "subtitles"
    | "spreadsheet"
    | "tms"
    | "pdf"
    | "indesign"
    | "usfm"
    | "usfm-experimental"
    | "paratext"
    | "ebible"
    | "ebibleCorpus"
    | "macula"
    | "biblica"
    | "obs";

/**
 * Minimal notebook metadata shared by importer/webview DTOs and persisted notebook metadata.
 * This avoids duplicating the same "import core" fields across webview and extension types.
 */
export type NotebookImportMetadataCore = Pick<
    CustomNotebookMetadata,
    | "id"
    | "originalFileName"
    | "sourceFile"
    | "importerType"
    | "importContext"
    | "textDirection"
    | "audioOnly"
    | "videoUrl"
    | "fileDisplayName"
> & {
    corpusMarker?: string;
    /**
     * Import-time timestamp (webview DTOs). The provider may map this into sourceCreatedAt.
     */
    createdAt?: string;
    isCodex?: boolean;
};

export type NotebookImportContext = {
    importerType?: FileImporterType | string;
    fileName?: string;
    originalFileName?: string;
    originalHash?: string;
    documentId?: string;
    documentVersion?: string;
    importTimestamp?: string;
    fileSize?: number;
    [key: string]: unknown;
};

/**
 * Represents information about a single milestone in a document.
 * Milestones are used as the primary navigation unit for pagination.
 */
export interface MilestoneInfo {
    /** 0-based milestone index */
    index: number;
    /** Position in the full cells array where this milestone cell is located */
    cellIndex: number;
    /** Display value for the milestone (e.g., "1", "2", chapter name) */
    value: string;
    /** Number of content cells in this milestone section (excluding milestone cell itself) */
    cellCount: number;
}

/**
 * Index of all milestones in a document, used for milestone-based pagination.
 */
export interface MilestoneIndex {
    /** Array of milestone information */
    milestones: MilestoneInfo[];
    /** Total content cells in the document (excluding milestone cells) */
    totalCells: number;
    /** Number of cells per page for sub-pagination within milestones */
    cellsPerPage: number;
    /** Progress data for each milestone (1-based milestone number -> progress) */
    milestoneProgress?: Record<number, {
        percentTranslationsCompleted: number;
        percentAudioTranslationsCompleted: number;
        percentFullyValidatedTranslations: number;
        percentAudioValidatedTranslations: number;
        percentTextValidatedTranslations: number;
    }>;
}

interface QuillCellContent {
    cellMarkers: string[];
    cellContent: string;
    cellType: CodexCellTypes;
    editHistory: Array<EditHistory>;
    timestamps?: Timestamps;
    cellLabel?: string;
    merged?: boolean;
    deleted?: boolean;
    data?: { [key: string]: any; footnotes?: Footnote[]; };
    attachments?: { [attachmentId: string]: { type: string; isDeleted?: boolean; isMissing?: boolean; url?: string; validatedBy?: ValidationEntry[]; }; };
    metadata?: {
        selectedAudioId?: string;
        selectionTimestamp?: number;
        isLocked?: boolean;
        [key: string]: any;
    };
}

interface Timestamps {
    startTime?: number;
    endTime?: number;
    format?: string;
}

interface SpellCheckResponse {
    id: string;
    text: string;
    replacements: Array<{ value: string; }>;
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
    category?: string; // Keep for backward compatibility
    validationCount?: number;
    validationCountAudio?: number;
    userName: string;
    userEmail: string;
    sourceTexts?: vscode.Uri[] | never[];
    targetTexts?: vscode.Uri[] | never[];
    targetFont: string;
    primarySourceText?: vscode.Uri;
    isAuthenticated: boolean;
    meta: Omit<Project["meta"], "generator"> & {
        generator: Project["meta"]["generator"] & { userEmail?: string; };
        validationCount?: number;
        validationCountAudio?: number;
    };
    spellcheckIsEnabled: boolean;
}

/* This is the project metadata that is saved in the metadata.json file */
type ProjectMetadata = {
    format: string;
    edits?: ProjectEditHistory[];
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
        /** Extension version requirements for sync compatibility */
        requiredExtensions?: {
            codexEditor?: string;
            frontierAuthentication?: string;
        };
        /** List of users that should be forced to restore/heal their project when opening */
        initiateRemoteHealingFor?: RemoteHealingEntry[];
        abbreviation?: string;
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

export interface RemoteHealingEntry {
    userToHeal: string;
    addedBy: string;
    createdAt: number;
    updatedAt: number;
    deleted: boolean;
    deletedBy: string;
    executed: boolean;
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
    | { command: "sendProjectsList"; data: Project[]; }
    | { command: "requestProjectOverview"; }
    | { command: "error"; message: string; }
    | { command: "webviewReady"; }
    | { command: "refreshState"; }
    | { command: "initializeProject"; }
    | { command: "renameProject"; }
    | { command: "changeProjectName"; projectName: string; }
    | { command: "changeSourceLanguage"; language: LanguageMetadata; }
    | { command: "changeTargetLanguage"; language: LanguageMetadata; }
    | { command: "editAbbreviation"; }
    | { command: "selectCategory"; }
    | { command: "setValidationCount"; }
    | { command: "setValidationCountAudio"; }
    | { command: "openSourceUpload"; }
    | { command: "openExportView"; }
    | { command: "openAISettings"; }
    | { command: "openLicenseSettings"; }
    | { command: "openExportView"; }
    | { command: "closeProject"; }
    | { command: "createNewWorkspaceAndProject"; }
    | { command: "openProject"; data: { path: string; }; }
    | { command: "addWatchFolder"; }
    | { command: "removeWatchFolder"; data: { path: string; }; }
    | { command: "refreshProjects"; }
    | { command: "openProjectSettings"; }
    | { command: "downloadSourceText"; }
    | { command: "selectprimarySourceText"; data: string; }
    | { command: "openBible"; data: { path: string; }; }
    | { command: "checkPublishStatus"; }
    | { command: "publishProject"; }
    | { command: "syncProject"; }
    | { command: "openEditAnalysis"; }
    | { command: "toggleSpellcheck"; }
    | { command: "getSyncSettings"; }
    | {
        command: "updateSyncSettings";
        data: { autoSyncEnabled: boolean; syncDelayMinutes: number; };
    }
    | { command: "triggerSync"; }
    | { command: "openBookNameEditor"; }
    | { command: "editBookName"; content: { bookAbbr: string; newBookName: string; }; }
    | { command: "editCorpusMarker"; content: { corpusLabel: string; newCorpusName: string; }; }
    | { command: "openCellLabelImporter"; }
    | { command: "navigateToMainMenu"; }
    | { command: "openLoginFlow"; }
    | { command: "getProjectProgress"; }
    | { command: "showProgressDashboard"; }
    | { command: "project.delete"; data: { path: string; }; }
    | { command: "checkForUpdates"; }
    | { command: "downloadUpdate"; }
    | { command: "installUpdate"; }
    | { command: "openExternal"; url: string; }
    | { command: "setGlobalFontSize"; }
    | { command: "setGlobalTextDirection"; }
    | { command: "setGlobalLineNumbers"; }
    | { command: "getAsrSettings"; }
    | { command: "saveAsrSettings"; data: { endpoint: string; }; }
    | { command: "fetchAsrModels"; data: { endpoint: string; }; };

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
    isSyncInProgress: boolean;
    syncStage: string;
    isPublishingInProgress: boolean;
    publishingStage: string;
    updateState: 'ready' | 'downloaded' | 'available for download' | 'downloading' | 'updating' | 'checking for updates' | 'idle' | 'disabled' | null;
    updateVersion: string | null;
    isCheckingForUpdates: boolean;
    appVersion: string | null;
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
    }
    | {
        command: "syncSettingsUpdate";
        data: {
            autoSyncEnabled: boolean;
            syncDelayMinutes: number;
            isFrontierExtensionEnabled: boolean;
            isAuthenticated: boolean;
        };
    }
    | {
        command: "syncStatusUpdate";
        data: {
            isSyncInProgress: boolean;
            syncStage: string;
        };
    }
    | {
        command: "publishStatusUpdate";
        data: {
            isPublishingInProgress: boolean;
            publishingStage: string;
        };
    }
    | {
        command: "progressData";
        data: any; // Type for progress data
    }
    | {
        command: "updateStateChanged";
        data: {
            updateState: 'ready' | 'downloaded' | 'available for download' | 'downloading' | 'updating' | 'checking for updates' | 'idle' | 'disabled' | null;
            updateVersion: string | null;
            isCheckingForUpdates: boolean;
        };
    }
    | { command: "asrSettings"; data: { endpoint: string; }; }
    | { command: "asrModels"; data: string[]; }
    | { command: "asrSettingsSaved"; };

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
    mediaStrategy?: MediaFilesStrategy;
}

export interface BiblePreview extends BasePreview {
    type: "bible";
    original: {
        preview: string;
        validationResults: {
            isValid: boolean;
            errors: Array<{ message: string; }>;
        }[];
    };
    transformed: {
        sourceNotebooks: NotebookPreview[];
        validationResults: {
            isValid: boolean;
            errors: Array<{ message: string; }>;
        }[];
    };
}

export interface NotebookPreview {
    name: string;
    cells: any[];
    metadata?: any;
}

export interface BookPreview {
    name: string;
    versesCount: number;
    chaptersCount: number;
    previewContent?: string;
}

export interface PreviewContent {
    type: string;
    original?: {
        preview: string;
        validationResults: ValidationResult[];
    };
    transformed?: {
        sourceNotebooks?: Array<NotebookPreview>;
        codexNotebooks?: Array<NotebookPreview>;
        validationResults?: ValidationResult[];
    };
}

interface RawSourcePreview {
    fileName: string;
    fileSize: number;
    fileType: string;
    type: string;
    original: {
        preview: string;
        validationResults: ValidationResult[];
    };
    transformed: {
        books: Array<BookPreview>;
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
                metadata: { id: string; type: string; };
            }>;
        };
        targetNotebook: {
            name: string;
            cells: Array<{
                value: string;
                metadata: { id: string; type: string; };
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
                    metadata: { id: string; type: string; };
                    kind: 2 | 1;
                    languageId: "html" | "markdown" | "usj";
                }>;
            };
            targetNotebook: {
                name: string;
                cells: Array<{
                    value: string;
                    metadata: { id: string; type: string; };
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


// Add Footnote interface
export interface Footnote {
    id: string;
    content: string;
}

export type ParallelViewPostMessages =
    | { command: "openFileAtLocation"; uri: string; word: string; }
    | { command: "requestPinning"; content: { cellId: string; }; }
    | { command: "chatStream"; context: string[]; query: string; editIndex?: number; }
    | { command: "navigateToMainMenu"; }
    | { command: "addedFeedback"; feedback: string; cellId: string; }
    | { command: "search"; query: string; completeOnly: boolean; }
    | { command: "deleteChatSession"; sessionId: string; }
    | { command: "startNewChatSession"; }
    | { command: "getCurrentChatSessionInfo"; }
    | { command: "getAllChatSessions"; }
    | { command: "loadChatSession"; sessionId: string; };

export type WelcomeViewPostMessages =
    | { command: "menuAction"; action: "show" | "hide" | "toggle"; }
    | { command: "openTranslationFile"; }
    | { command: "createNewProject"; }
    | { command: "openExistingProject"; }
    | { command: "viewProjects"; }
    | { command: "openLoginFlow"; }
    | { command: "navigateToMainMenu"; };

export type WelcomeViewReceiveMessages =
    | { command: "menuStateChanged"; isVisible: boolean; actionPerformed: string; }
    | { command: "showLoginLoading"; loading: boolean; }
    | { command: "startupFlowStateChanged"; isOpen: boolean; };


export interface SplashScreenMessage {
    command: "update" | "complete" | "animationComplete";
    timings?: ActivationTiming[];
}

export interface CellLabelData {
    cellId: string;
    startTime: string;
    endTime: string;
    character?: string;
    dialogue?: string;
    newLabel: string;
    currentLabel?: string;
    matched: boolean;
}

export type CellLabelImporterPostMessages =
    | { command: "importFile"; }
    | { command: "save"; labels: CellLabelData[]; selectedIds: string[]; }
    | { command: "cancel"; };

export type CellLabelImporterReceiveMessages = {
    command: "updateLabels";
    labels: CellLabelData[];
    importSource?: string;
};

export type MainMenuPostMessages =
    | { command: "focusView"; viewId: string; }
    | { command: "executeCommand"; commandName: string; }
    | { command: "webviewReady"; }
    | { command: "openExternal"; url: string; }
    // Project Manager integration
    | ProjectManagerMessageFromWebview;

// Menu interfaces
export interface MenuSection {
    title: string;
    buttons: MenuButton[];
}

export interface MenuButton {
    id: string;
    label: string;
    icon: string;
    viewId?: string;
    command?: string;
    description?: string;
}

export type MainMenuMessages =
    | { command: "updateMenu"; menuConfig: MenuSection[]; }
    | { command: "setActiveView"; viewId: string; }
    // Project Manager integration
    | ProjectManagerMessageToWebview;

export type MainMenuReceiveMessages =
    | { command: "updateMenu"; menuConfig: MenuSection[]; }
    | { command: "setActiveView"; viewId: string; };

interface MenuSection {
    title: string;
    buttons: MenuButton[];
}

interface MenuButton {
    id: string;
    label: string;
    icon: string;
    viewId?: string;
    command?: string;
    description?: string;
}

// Minimal typings for pdf-parse used in the extension host
declare module 'pdf-parse' {
    const pdfParse: (data: Buffer) => Promise<{ text: string; }>;
    export default pdfParse;
}

// NewSourceUploader message types (moved to plugin types)
export type NewSourceUploaderPostMessages = any; // Placeholder - actual types are in plugin.ts

interface CodexItem {
    uri: vscode.Uri | string;
    label: string;
    type: "corpus" | "codexDocument" | "dictionary";
    children?: CodexItem[];
    corpusMarker?: string;
    progress?: {
        percentTranslationsCompleted: number;
        percentAudioTranslationsCompleted: number;
        percentAudioValidatedTranslations: number;
        percentTextValidatedTranslations: number;
        percentFullyValidatedTranslations: number;
        textValidationLevels?: number[];
        audioValidationLevels?: number[];
        requiredTextValidations?: number;
        requiredAudioValidations?: number;
    };
    sortOrder?: string;
    isProjectDictionary?: boolean;
    wordCount?: number;
    isEnabled?: boolean;
    fileDisplayName?: string;
}
type EditorReceiveMessages =
    | {
        type: "saveHtmlSaved";
        content: {
            requestId?: string;
            cellId: string;
            success: boolean;
            error?: string;
        };
    }
    | {
        type: "providerSendsInitialContent";
        content: QuillCellContent[];
        isSourceText: boolean;
        sourceCellMap: { [k: string]: { content: string; versions: string[]; }; };
        username?: string;
        validationCount?: number;
        validationCountAudio?: number;
        isAuthenticated?: boolean;
        userAccessLevel?: number;
    }
    | {
        type: "providerSendsInitialContentPaginated";
        /**
         * Monotonic revision number for the document content as observed by the provider.
         * Used by the webview to ignore out-of-order / stale payloads.
         */
        rev?: number;
        milestoneIndex: MilestoneIndex;
        cells: QuillCellContent[];
        currentMilestoneIndex: number;
        currentSubsectionIndex: number;
        isSourceText: boolean;
        sourceCellMap: { [k: string]: { content: string; versions: string[]; }; };
        username?: string;
        validationCount?: number;
        validationCountAudio?: number;
        isAuthenticated?: boolean;
        userAccessLevel?: number;
    }
    | {
        type: "providerSendsCellPage";
        /**
         * Monotonic revision number for the document content as observed by the provider.
         * Used by the webview to ignore out-of-order / stale payloads.
         */
        rev?: number;
        milestoneIndex: number;
        subsectionIndex: number;
        cells: QuillCellContent[];
        sourceCellMap: { [k: string]: { content: string; versions: string[]; }; };
    }
    | {
        type: "providerSendsSubsectionProgress";
        milestoneIndex: number;
        subsectionProgress: Record<number, {
            percentTranslationsCompleted: number;
            percentAudioTranslationsCompleted: number;
            percentFullyValidatedTranslations: number;
            percentAudioValidatedTranslations: number;
            percentTextValidatedTranslations: number;
            textValidationLevels?: number[];
            audioValidationLevels?: number[];
            requiredTextValidations?: number;
            requiredAudioValidations?: number;
        }>;
    }
    | {
        type: "preferredEditorTab";
        tab:
        | "source"
        | "backtranslation"
        | "footnotes"
        | "timestamps"
        | "audio";
    }
    | {
        type: "providerAutocompletionState";
        state: {
            isProcessing: boolean;
            totalCells: number;
            completedCells: number;
            currentCellId?: string;
            cellsToProcess: string[];
            progress: number;
        };
    }
    | {
        type: "providerSingleCellTranslationState";
        state: {
            isProcessing: boolean;
            cellId?: string;
            progress: number;
        };
    }
    | {
        type: "providerSingleCellQueueState";
        state: {
            isProcessing: boolean;
            totalCells: number;
            completedCells: number;
            currentCellId?: string;
            cellsToProcess: string[];
            progress: number;
        };
    }
    | {
        type: "cellTranslationCompleted";
        cellId: string;
        success: boolean;
        cancelled?: boolean;
        error?: string;
    }
    | {
        type: "providerUpdatesCell";
        content: {
            cellId: string;
            progress: number;
            completedCells?: number;
            totalCells?: number;
            text?: string;
        };
    }
    | {
        type: "providerCompletesChapterAutocompletion";
        content?: {
            progress?: number;
            completedCells?: number;
            totalCells?: number;
        };
    }
    | {
        type: "autocompleteChapterStart";
        cellIds: string[];
        totalCells: number;
    }
    | {
        type: "processingCell";
        cellId: string;
        index: number;
        totalCells: number;
    }
    | {
        type: "cellCompleted";
        cellId: string;
        index: number;
        totalCells: number;
    }
    | {
        type: "cellError";
        cellId: string;
        index: number;
        totalCells: number;
    }
    | {
        type: "autocompleteChapterComplete";
        totalCells?: number;
    }
    | { type: "providerSendsSpellCheckResponse"; content: SpellCheckResponse; }
    | {
        type: "providerSendsgetAlertCodeResponse";
        content: { [cellId: string]: number; };
    }
    | { type: "providerUpdatesTextDirection"; textDirection: "ltr" | "rtl"; }
    | { type: "providerSendsLLMCompletionResponse"; content: { completion: string; cellId: string; }; }
    | { type: "providerSendsABTestVariants"; content: { variants: string[]; cellId: string; testId: string; testName?: string; names?: string[]; abProbability?: number; }; }
    | { type: "abTestingProbabilityUpdated"; content: { value: number; }; }
    | { type: "jumpToSection"; content: string; }
    | { type: "providerUpdatesNotebookMetadataForWebview"; content: CustomNotebookMetadata; }
    | { type: "updateVideoUrlInWebview"; content: string; }
    | {
        type: "milestoneProgressUpdate";
        milestoneProgress: Record<number, {
            percentTranslationsCompleted: number;
            percentAudioTranslationsCompleted: number;
            percentFullyValidatedTranslations: number;
            percentAudioValidatedTranslations: number;
            percentTextValidatedTranslations: number;
        }>;
    }
    | {
        type: "commentsForCell";
        content: {
            cellId: string;
            unresolvedCount: number;
        };
    }
    | {
        type: "commentsForCells";
        content: {
            [cellId: string]: number; // cellId -> unresolvedCount
        };
    }
    | { type: "providerSendsPromptedEditResponse"; content: string; }
    | { type: "providerSendsSimilarCellIdsResponse"; content: { cellId: string; score: number; }[]; }
    | { type: "providerSendsTopPrompts"; content: Array<{ prompt: string; isPinned: boolean; }>; }
    | { type: "providerSendsSourceText"; content: string; }
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
        type: "providerSendsBatchBacktranslations";
        content: { [cellId: string]: SavedBacktranslation | null; };
    }
    | {
        type: "singleCellTranslationStarted";
        cellId: string;
    }
    | {
        type: "singleCellTranslationProgress";
        progress: number;
        cellId: string;
    }
    | {
        type: "singleCellTranslationCompleted";
        cellId: string;
    }
    | {
        type: "singleCellTranslationFailed";
        cellId: string;
        error: string;
    }
    | { type: "refreshFontSizes"; }
    | { type: "refreshMetadata"; }
    | {
        type: "refreshCurrentPage";
        /**
         * Optional rev for correlation; refresh is a pull-trigger, so the response payload rev is authoritative.
         */
        rev?: number;
    }
    | { type: "asrConfig"; content: { endpoint: string; authToken?: string; }; }
    | { type: "startBatchTranscription"; content: { count: number; }; }
    | {
        type: "providerConfirmsBacktranslationSet";
        content: SavedBacktranslation | null;
    }
    | { type: "currentUsername"; content: { username: string; }; }
    | { type: "validationCount"; content: number; }
    | { type: "validationCountAudio"; content: number; }
    | { type: "configurationChanged"; }
    | {
        type: "validationInProgress";
        content: {
            cellId: string;
            inProgress: boolean;
            error?: string;
        };
    }
    | {
        type: "audioValidationInProgress";
        content: {
            cellId: string;
            inProgress: boolean;
            error?: string;
        };
    }
    | {
        type: "pendingValidationCleared";
        content: {
            cellIds: string[];
        };
    }
    | {
        type: "pendingAudioValidationCleared";
        content: {
            cellIds: string[];
        };
    }
    | {
        type: "pendingValidationsUpdate";
        content: {
            count: number;
            hasPending: boolean;
        };
    }
    | { type: "setChapterNumber"; content: number; }
    | {
        type: "providerUpdatesValidationState";
        content: {
            cellId: string;
            validatedBy: ValidationEntry[];
        };
    }
    | {
        type: "providerUpdatesAudioValidationState";
        content: {
            cellId: string;
            validatedBy: ValidationEntry[];
            selectedAudioId?: string;
        };
    }
    | {
        type: "footnoteStored";
        content: {
            cellId: string;
            footnoteId?: string;
            content?: string;
            position?: number;
            deleteFootnote?: string;
        };
    }
    | {
        type: "updateFileStatus";
        status: "dirty" | "syncing" | "synced" | "none";
    }
    | {
        type: "highlightCell";
        globalReferences: string[];
        cellId?: string; // Optional cellId for fallback matching when globalReferences is empty
    }
    | {
        type: "updateCellsPerPage";
        cellsPerPage: number;
    }
    | {
        type: "editorPosition";
        position: "leftmost" | "rightmost" | "center" | "single" | "unknown";
    }
    | {
        type: "setBibleBookMap";
        data: [string, { [key: string]: any; name: string; }][];
    }
    | {
        type: "providerSendsAudioAttachments";
        // Availability now distinguishes between real local files vs LFS pointer placeholders
        attachments: { [cellId: string]: "available" | "available-local" | "available-pointer" | "missing" | "deletedOnly" | "none"; };
    }
    | {
        type: "providerSendsAudioData";
        content: {
            cellId: string;
            audioId: string;
            audioUrl?: string; // URL to access the audio file
            audioData?: string; // base64 data if needed
            transcription?: {
                content: string;
                timestamp: number;
                language?: string;
            };
            fileModified?: number; // File modification timestamp for cache validation
        };
    }
    | {
        type: "correctionEditorModeChanged";
        enabled: boolean;
    }
    | {
        type: "audioAttachmentSaved";
        content: {
            cellId: string;
            audioId: string;
            requestId?: string;
            success: boolean;
            /**
             * True when the attachment metadata has been persisted to the .codex/.source file
             * (in addition to the audio file itself being written).
             */
            savedToCodexFile?: boolean;
            error?: string;
        };
    }
    | {
        type: "audioAttachmentDeleted";
        content: {
            cellId: string;
            audioId: string;
            success: boolean;
            error?: string;
        };
    }
    | {
        type: "audioHistoryReceived";
        content: {
            cellId: string;
            audioHistory: Array<{
                attachmentId: string;
                attachment: {
                    url: string;
                    type: string;
                    createdAt: number;
                    updatedAt: number;
                    isDeleted: boolean;
                    isMissing?: boolean;
                    validatedBy?: ValidationEntry[];
                };
            }>;
            currentAttachmentId: string | null; // The ID of the currently selected/active attachment
            hasExplicitSelection: boolean; // Whether user made explicit selection vs automatic behavior
        };
    }
    | {
        type: "audioAttachmentRestored";
        content: {
            cellId: string;
            audioId: string;
            success: boolean;
            error?: string;
        };
    }
    | {
        type: "audioAttachmentSelected";
        content: {
            cellId: string;
            audioId: string;
            success: boolean;
            error?: string;
        };
    }
    | {
        type: "refreshCommentCounts";
        timestamp: string;
    }
    | {
        type: "audioHistorySelectionChanged";
        content: {
            cellId: string;
            selectedAudioId: string;
            validatedBy: ValidationEntry[];
        };
    };
