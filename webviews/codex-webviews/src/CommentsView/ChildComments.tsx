import React from "react";
import { NotebookComment } from "../../../../types";

type Props = {
    comments: NotebookComment[];
    threadIndex: number;
    expandedThreadIndex: number | null;
};

function ChildComments({ comments, threadIndex, expandedThreadIndex }: Props) {
    return threadIndex === expandedThreadIndex ? (
        <div className="pl-10 pr-4 pb-4">
            <div className="flex flex-col gap-3">
                {comments.map((comment, commentIndex) => (
                    <div key={commentIndex} className="p-2 bg-muted/50 rounded border">
                        <div className="text-sm text-foreground whitespace-pre-wrap break-words">
                            {comment.body}
                        </div>
                        {comment.author && (
                            <div className="mt-1 text-xs text-muted-foreground">
                                {comment.author.name}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    ) : null;
}

export default ChildComments;
