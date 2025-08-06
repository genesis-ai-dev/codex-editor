import React from "react";
import { Badge } from "../components/ui/badge";
import { MessageCircle } from "lucide-react";
import { getVSCodeAPI } from "../shared/vscodeApi";

interface CommentsBadgeProps {
    cellId: string;
    unresolvedCount: number;
    className?: string;
}

const CommentsBadge: React.FC<CommentsBadgeProps> = ({
    cellId,
    unresolvedCount,
    className = "",
}) => {
    const vscode = getVSCodeAPI();

    const handleClick = () => {
        // Send message to open comments tab and navigate to this cell
        vscode.postMessage({
            command: "openCommentsForCell",
            content: {
                cellId: cellId,
            },
        });
    };

    // Don't render if there are no unresolved comments
    if (unresolvedCount === 0) {
        return null;
    }

    return (
        <Badge
            variant="secondary"
            className={`cursor-pointer hover:bg-secondary/80 transition-colors ${className}`}
            onClick={handleClick}
            title={`${unresolvedCount} unresolved comment${unresolvedCount > 1 ? "s" : ""}`}
        >
            <MessageCircle className="w-3 h-3 mr-1" />
            {unresolvedCount}
        </Badge>
    );
};

export default CommentsBadge;
