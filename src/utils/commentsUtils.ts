import { NotebookCommentThread } from "../../types";

/**
 * Get unresolved comments for a specific cell
 * @param comments All comment threads
 * @param cellId The cell ID to filter by
 * @returns Array of unresolved comment threads for the cell
 */
export function getUnresolvedCommentsForCell(
    comments: NotebookCommentThread[],
    cellId: string
): NotebookCommentThread[] {
    return comments.filter(thread => {
        // Check if thread belongs to this cell
        if (thread.cellId.cellId !== cellId) {
            return false;
        }

        // Check if thread is deleted
        const deletionEvents = thread.deletionEvent || [];
        const latestDeletionEvent = deletionEvents.length > 0
            ? deletionEvents.reduce((latest, event) =>
                event.timestamp > latest.timestamp ? event : latest
            )
            : null;
        
        if (latestDeletionEvent?.deleted) {
            return false;
        }

        // Check if thread is resolved
        const resolvedEvents = thread.resolvedEvent || [];
        const latestResolvedEvent = resolvedEvents.length > 0
            ? resolvedEvents.reduce((latest, event) =>
                event.timestamp > latest.timestamp ? event : latest
            )
            : null;
        
        if (latestResolvedEvent?.resolved) {
            return false;
        }

        return true;
    });
}

/**
 * Get the count of unresolved comments for a specific cell
 * @param comments All comment threads
 * @param cellId The cell ID to filter by
 * @returns Number of unresolved comments for the cell
 */
export function getUnresolvedCommentsCountForCell(
    comments: NotebookCommentThread[],
    cellId: string
): number {
    return getUnresolvedCommentsForCell(comments, cellId).length;
}