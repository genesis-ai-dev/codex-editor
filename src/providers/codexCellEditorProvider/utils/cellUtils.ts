/**
 * Generates a child cell ID by appending a timestamp and random string to the parent ID
 * @param parentCellId The ID of the parent cell
 * @returns A new cell ID for the child
 */
export function generateChildCellId(parentCellId: string): string {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substr(2, 9);
    return `${parentCellId}:${timestamp}-${randomString}`;
}
