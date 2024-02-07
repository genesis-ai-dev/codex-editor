import * as vscode from "vscode";
import { TextEncoder, TextDecoder } from "util";

let commentId = 1;
let commentThreads: vscode.CommentThread[] = [];
class CommentingRangeProvider implements vscode.CommentingRangeProvider {
    provideCommentingRanges(
        document: vscode.TextDocument,
        token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.Range[]> {
        if (!document.uri.path.endsWith(".codex")) {
            // This example is for .ipynb files, adjust according to your notebook format
            return;
        }

        // Assuming we have a way to access the notebook's cells (this part is pseudo-code)
        const notebookCells = this.getNotebookCells(document);

        const commentableRanges: vscode.Range[] = [];

        notebookCells.forEach((cell) => {
            if (cell.type === "markdown") {
                // Create a range covering the entire markdown cell
                const range = new vscode.Range(
                    cell.startLine,
                    0,
                    cell.endLine,
                    0,
                );
                commentableRanges.push(range);
            }
        });

        return commentableRanges;
    }

    private getNotebookCells(document: vscode.TextDocument): any[] {
        // Placeholder: You need to replace this with actual logic to retrieve notebook cells
        // This could involve parsing the notebook file content if the API does not provide direct access
        return [];
    }
}

class NoteComment implements vscode.Comment {
    id: number;
    label: string | undefined;
    savedBody: string | vscode.MarkdownString; // for the Cancel button
    constructor(
        public body: string | vscode.MarkdownString,
        public mode: vscode.CommentMode,
        public author: vscode.CommentAuthorInformation,
        public parent?: vscode.CommentThread,
        public contextValue?: string,
    ) {
        this.id = ++commentId;
        this.savedBody = this.body;
    }

    toJSON() {
        return {
            id: this.id,
            label: this.label,
            body:
                this.body instanceof vscode.MarkdownString
                    ? this.body.value
                    : this.body,
            mode: this.mode,
            author: this.author,
            contextValue: this.contextValue,
        };
    }
}

export class FileHandler {
    async writeFile(filename: string, data: string): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            throw new Error("No workspace folders found.");
        }
        const uri = vscode.Uri.joinPath(workspaceFolders[0].uri, filename);
        console.log(`Attempting to write file: ${uri.fsPath}`); // Log the file path

        const uint8Array = new TextEncoder().encode(data);

        try {
            await vscode.workspace.fs.writeFile(uri, uint8Array);
            console.log("File written successfully:", uri.fsPath);
        } catch (error) {
            console.error("Error writing file:", error, `Path: ${uri.fsPath}`);
        }
    }

    async readFile(filename: string): Promise<string> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            throw new Error("No workspace folders found.");
        }

        const uri = vscode.Uri.joinPath(workspaceFolders[0].uri, filename);

        try {
            const uint8Array = await vscode.workspace.fs.readFile(uri);
            return new TextDecoder().decode(uint8Array);
        } catch (error) {
            console.error("Error reading file:", error, `Path: ${uri.fsPath}`);
            throw error; // Rethrow the error to handle it in the calling code
        }
    }
}
function serializeCommentThread(thread: vscode.CommentThread) {
    return {
        uri: thread.uri.toString(),
        range: {
            start: {
                line: thread.range.start.line,
                character: thread.range.start.character,
            },
            end: {
                line: thread.range.end.line,
                character: thread.range.end.character,
            },
        },
        comments: thread.comments.map((comment) =>
            (comment as NoteComment).toJSON
                ? (comment as NoteComment).toJSON()
                : comment,
        ),
        // collapsibleState: thread.collapsibleState
        collapsibleState: vscode.CommentThreadCollapsibleState.Collapsed,
    };
}

export function serializeCommentThreadArray(
    threads: vscode.CommentThread[],
): string {
    console.log({ threads });
    const serializedThreads = threads.map(serializeCommentThread);
    return JSON.stringify(serializedThreads, null, 2); // Pretty print JSON
}

export function registerCommentsProvider(context: vscode.ExtensionContext) {
    // A `CommentController` is able to provide comments for documents.
    const notebookCommentController = vscode.comments.createCommentController(
        "notebookCommentController",
        "Notebook Comments",
    );
    context.subscriptions.push(notebookCommentController);

    notebookCommentController.commentingRangeProvider =
        new CommentingRangeProvider();
    const commentController = vscode.comments.createCommentController(
        "comment-project",
        "Comment API Sample",
    );
    context.subscriptions.push(commentController);

    // A `CommentingRangeProvider` controls where gutter decorations that allow adding comments are shown
    commentController.commentingRangeProvider = {
        provideCommentingRanges: (
            document: vscode.TextDocument,
            token: vscode.CancellationToken,
        ) => {
            const lineCount = document.lineCount;
            return [new vscode.Range(0, 0, lineCount - 1, 0)];
        },
    };

    const fileHandler = new FileHandler();
    fileHandler
        .readFile("comments.json")
        .then((jsonData) => {
            // Now jsonData contains the contents of the file
            // console.log("Read operation completed.", jsonData);
            restoreCommentsFromJSON(jsonData, commentController); // Call the function here
        })
        .catch((error) => console.error(error));

    async function writeSerializedData(
        serializedData: string,
        filename: string = "comments.json",
    ) {
        const fileHandler = new FileHandler();

        try {
            await fileHandler.writeFile(filename, serializedData);
            console.log("Write operation completed.");
        } catch (error) {
            console.error("Error writing file:", error);
        }
    }

    vscode.workspace.onDidSaveTextDocument(async (document) => {
        const serializedData = serializeCommentThreadArray(commentThreads); // Assuming serializeCommentThreads is available in this scope
        await writeSerializedData(serializedData, "comments.json");
    });

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "commentsExtension.createNote",
            async (reply: vscode.CommentReply) => {
                const newThread = replyNote(reply);
                if (newThread) {
                    commentThreads = [...commentThreads, newThread];
                    const serializedData =
                        serializeCommentThreadArray(commentThreads); // Assuming serializeCommentThreads is available in this scope
                    await writeSerializedData(serializedData, "comments.json");
                    // console.log({ commentThreads });
                }
            },
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "commentsExtension.replyNote",
            async (reply: vscode.CommentReply) => {
                replyNote(reply);
                commentThreads = [...commentThreads];
                const serializedData =
                    serializeCommentThreadArray(commentThreads); // Assuming serializeCommentThreads is available in this scope
                await writeSerializedData(serializedData, "comments.json");
            },
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "commentsExtension.startDraft",
            async (reply: vscode.CommentReply) => {
                const thread = reply.thread;
                thread.contextValue = "draft";
                const newComment = new NoteComment(
                    reply.text,
                    vscode.CommentMode.Preview,
                    { name: "vscode" },
                    thread,
                );
                newComment.label = "pending";
                thread.comments = [...thread.comments, newComment];
                // const serializedData =
                //     serializeCommentThreadArray(commentThreads); // Assuming serializeCommentThreads is available in this scope
                // await writeSerializedData(serializedData, "comments.json");
            },
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "commentsExtension.finishDraft",
            (reply: vscode.CommentReply) => {
                const thread = reply.thread;

                if (!thread) {
                    return;
                }

                thread.contextValue = undefined;
                thread.collapsibleState =
                    vscode.CommentThreadCollapsibleState.Collapsed;
                if (reply.text) {
                    const newComment = new NoteComment(
                        reply.text,
                        vscode.CommentMode.Preview,
                        { name: "vscode" },
                        thread,
                    );
                    thread.comments = [...thread.comments, newComment].map(
                        (comment) => {
                            comment.label = undefined;
                            return comment;
                        },
                    );
                }
            },
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "commentsExtension.deleteNoteComment",
            async (comment: NoteComment) => {
                const thread = comment.parent;
                if (!thread) {
                    return;
                }

                thread.comments = thread.comments.filter(
                    (cmt) => (cmt as NoteComment).id !== comment.id,
                );

                if (thread.comments.length === 0) {
                    thread.dispose();
                }
                const serializedData =
                    serializeCommentThreadArray(commentThreads); // Assuming serializeCommentThreads is available in this scope
                await writeSerializedData(serializedData, "comments.json");
            },
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "commentsExtension.deleteNote",
            async (thread: vscode.CommentThread) => {
                thread.dispose();
                removeThread(thread);
                const serializedData =
                    serializeCommentThreadArray(commentThreads); // Assuming serializeCommentThreads is available in this scope
                await writeSerializedData(serializedData, "comments.json");
            },
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "commentsExtension.cancelsaveNote",
            (comment: NoteComment) => {
                if (!comment.parent) {
                    return;
                }

                comment.parent.comments = comment.parent.comments.map((cmt) => {
                    if ((cmt as NoteComment).id === comment.id) {
                        cmt.body = (cmt as NoteComment).savedBody;
                        cmt.mode = vscode.CommentMode.Preview;
                    }

                    return cmt;
                });
            },
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "commentsExtension.saveNote",
            async (comment: NoteComment) => {
                if (!comment.parent) {
                    return;
                }

                comment.parent.comments = comment.parent.comments.map((cmt) => {
                    if ((cmt as NoteComment).id === comment.id) {
                        (cmt as NoteComment).savedBody = cmt.body;
                        cmt.mode = vscode.CommentMode.Preview;
                    }

                    return cmt;
                });
                const serializedData =
                    serializeCommentThreadArray(commentThreads); // Assuming serializeCommentThreads is available in this scope
                await writeSerializedData(serializedData, "comments.json");
            },
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "commentsExtension.editNote",
            (comment: NoteComment) => {
                if (!comment.parent) {
                    return;
                }

                comment.parent.comments = comment.parent.comments.map((cmt) => {
                    if ((cmt as NoteComment).id === comment.id) {
                        cmt.mode = vscode.CommentMode.Editing;
                    }

                    return cmt;
                });
            },
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("commentsExtension.dispose", () => {
            commentController.dispose();
        }),
    );

    context.subscriptions.push(
        new vscode.Disposable(() => {
            const serializedData = serializeCommentThreadArray(commentThreads);
            commentThreads.forEach((thread) => thread.dispose());
            commentThreads = [];
        }),
    );

    function replyNote(reply: vscode.CommentReply) {
        const thread = reply.thread;
        const newComment = new NoteComment(
            reply.text,
            vscode.CommentMode.Preview,
            { name: "vscode" },
            thread,
            thread.comments.length ? "canDelete" : undefined,
        );
        if (thread.contextValue === "draft") {
            newComment.label = "pending";
        }

        thread.comments = [...thread.comments, newComment];

        return thread;
    }

    function removeThread(thread: vscode.CommentThread) {
        const index = commentThreads.indexOf(thread);
        if (index > -1) {
            commentThreads.splice(index, 1);
        }
    }

    async function restoreCommentsFromJSON(
        jsonData: string,
        commentController: vscode.CommentController,
    ) {
        const threadsData = JSON.parse(jsonData);

        for (const threadData of threadsData) {
            // Recreate the URI and Range for the CommentThread
            const uri = vscode.Uri.parse(threadData.uri);
            const range = new vscode.Range(
                new vscode.Position(
                    threadData.range.start.line,
                    threadData.range.start.character,
                ),
                new vscode.Position(
                    threadData.range.end.line,
                    threadData.range.end.character,
                ),
            );

            // Create the CommentThread
            const thread = commentController.createCommentThread(
                uri,
                range,
                [],
            );

            // Add the thread to the commentThreads array
            commentThreads.push(thread);

            // Recreate and add NoteComments to the CommentThread
            for (const commentData of threadData.comments) {
                const comment = new NoteComment(
                    commentData.body,
                    commentData.mode,
                    commentData.author,
                    thread,
                    commentData.contextValue,
                );
                thread.comments = [...thread.comments, comment];
            }

            // Set the collapsible state
            // thread.collapsibleState = threadData.collapsibleState;
            thread.collapsibleState =
                vscode.CommentThreadCollapsibleState.Collapsed;
        }
    }
}
