import * as vscode from "vscode";
interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

interface FrontEndMessage {
    command: {
        name: string; // use enum
        data?: any; // define based on enum
    };
}
type CommentThread = vscode.CommentThread;
interface NotebookCommentThread {
    uri: string;
    verseRef: string;
    comments: {
        id: number;
        body: string;
        mode: number;
        contextValue: "canDelete";
        author: {
            name: string;
        };
    }[];
    collapsibleState: number;
    canReply: boolean;
}

interface VerseRefGlobalState {
    verseRef: string;
    uri: string;
}

type CommentPostMessages =
    | { command: "commentsFromWorkspace"; content: string }
    | { command: "reload"; data: VerseRefGlobalState }
    | { command: "updateCommentThread"; comment: NotebookCommentThread }
    | { command: "fetchComments" };

type ChatPostMessages =
    | { command: "response"; finished: boolean; text: string }
    | { command: "reload" }
    | { command: "select"; text: string }
    | { command: "fetch"; messages: string };

// enum CommentCommandNames {
//     updateCommentThread = "updateCommentThread",
// }
// fixme: enums so the types compile when they are used
