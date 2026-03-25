import React, { useState } from "react";
import { NotebookCommentThread } from "../../../../types";
import { Search, ChevronRight, ChevronDown, MessageSquare } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import ChildComments from "./ChildComments";

interface AllCommentsProps {
    comments: NotebookCommentThread[];
}

export const AllCommentsList = ({ comments }: AllCommentsProps) => {
    const [searchQuery, setSearchQuery] = useState("");
    const [currentPage, setCurrentPage] = useState(1);
    const [expandedThreadIndex, setExpandedThreadIndex] = useState<number | null>(null);
    const commentsPerPage = 10;

    // Filter comments based on search
    const filteredComments = comments?.filter(
        (thread) =>
            thread.threadTitle?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            thread.comments?.some((comment) =>
                comment.body.toLowerCase().includes(searchQuery.toLowerCase())
            )
    );

    // Calculate pagination
    const totalPages = Math.ceil((filteredComments?.length || 0) / commentsPerPage);
    const paginatedComments = filteredComments?.slice(
        (currentPage - 1) * commentsPerPage,
        currentPage * commentsPerPage
    );

    const handleCollapseClick = (threadIndex: number) => {
        setExpandedThreadIndex(expandedThreadIndex === threadIndex ? null : threadIndex);
    };

    return (
        <div className="flex flex-col h-full w-full gap-4">
            <div className="p-4 border-b border-border">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search comments..."
                        value={searchQuery}
                        className="pl-10"
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            </div>

            <div className="flex-grow overflow-y-auto">
                {paginatedComments?.map((commentThread, threadIndex) => (
                    <div key={threadIndex} className="border-b border-border">
                        <div
                            onClick={() => handleCollapseClick(threadIndex)}
                            className="w-full cursor-pointer hover:bg-muted/50 transition-colors"
                        >
                            <div className="flex justify-between items-center p-2 px-4">
                                <div className="flex items-center gap-2">
                                    {threadIndex === expandedThreadIndex ? (
                                        <ChevronDown className="h-4 w-4" />
                                    ) : (
                                        <ChevronRight className="h-4 w-4" />
                                    )}
                                    <span className="truncate">
                                        {commentThread.threadTitle?.slice(0, 50)} -{" "}
                                        <Badge variant="outline">
                                            {commentThread.cellId.cellId.slice(0, 25)}
                                        </Badge>
                                    </span>
                                </div>
                                <span className="text-muted-foreground text-sm flex items-center gap-1">
                                    <MessageSquare className="h-3 w-3" />
                                    {commentThread.comments.length} comment
                                    {commentThread.comments.length !== 1 ? "s" : ""}
                                </span>
                            </div>
                            <ChildComments
                                comments={commentThread.comments}
                                threadIndex={threadIndex}
                                expandedThreadIndex={expandedThreadIndex}
                            />
                        </div>
                    </div>
                ))}
            </div>

            <div className="flex justify-between items-center p-4 border-t border-border">
                <Button
                    variant="outline"
                    onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                >
                    Previous
                </Button>
                <span className="text-muted-foreground text-sm">
                    Page {currentPage} of {totalPages}
                </span>
                <Button
                    variant="outline"
                    onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                >
                    Next
                </Button>
            </div>
        </div>
    );
};
