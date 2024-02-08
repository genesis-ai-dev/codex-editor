import * as vscode from "vscode";
export interface ChatMessage {
    role: "system" | "user";
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
