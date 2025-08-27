/**
 * Cross-platform path helpers
 */

/**
 * Convert any Windows-style backslashes to POSIX-style forward slashes.
 * Keeps existing forward slashes intact and does not perform URL decoding.
 */
export function toPosixPath(inputPath: string): string {
    if (!inputPath) return inputPath;
    return inputPath.replace(/\\/g, "/");
}


/**
 * Normalize an attachment URL to POSIX and ensure it points to the files/ structure.
 * Examples:
 *  - .project\\attachments\\files\\BOOK\\file.webm -> .project/attachments/files/BOOK/file.webm
 *  - .project\\attachments\\BOOK\\file.webm -> .project/attachments/files/BOOK/file.webm
 *  - .project/attachments/pointers/BOOK/file.webm -> .project/attachments/files/BOOK/file.webm
 */
export function normalizeAttachmentUrl(rawUrl: string | undefined): string | undefined {
    if (!rawUrl || typeof rawUrl !== "string") return rawUrl;
    let url = toPosixPath(rawUrl);

    // Only operate on .project/attachments paths
    if (url.includes(".project/attachments/")) {
        // If currently pointing to pointers/, switch to files/
        if (url.includes("/attachments/pointers/")) {
            url = url.replace("/attachments/pointers/", "/attachments/files/");
        }

        // If neither files/ nor pointers/ is present after attachments/, insert files/
        const attachmentsIdx = url.indexOf(".project/attachments/");
        if (attachmentsIdx !== -1) {
            const after = url.slice(attachmentsIdx + ".project/attachments/".length);
            if (!after.startsWith("files/") && !after.startsWith("pointers/")) {
                url = url.replace(".project/attachments/", ".project/attachments/files/");
            }
        }
    }

    return url;
}


