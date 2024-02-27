import { parseContentTsv } from "./parseContentTsv";
import { parseResource } from "./parseResource";

/**
 * hook for loading content of translation helps resources
 * @param {number|string} chapter
 * @param {string} contentRef - points to specific branch or tag for tsv contents
 * @param {boolean} fetchMarkdown - flag that resource being fetched is in markdown
 * @param {string} filePath - optional file path, currently just seems to be a pass through value - not being used by useRsrc or useTsvItems
 * @param {object} httpConfig - optional config settings for fetches (timeout, cache, etc.)
 * @param {string} languageId
 * @param {string} listRef - points to specific branch or tag for tsv list
 * @param {function} onResourceError - optional callback if there is an error fetching resource, parameters are:
 *    ({string} errorMessage, {boolean} isAccessError, {object} resourceStatus, {Error} error)
 *      - isAccessError - is true if this was an error trying to access file
 *      - resourceStatus - is object containing details about problems fetching resource
 *      - error - Error object that has the specific error returned
 * @param {string} owner
 * @param {string} projectId
 * @param {boolean} readyToFetch - if true then ready to fetch
 * @param {string} resourceId
 * @param {string} server
 * @param {function} useUserLocalStorage
 * @param {number|string} verse
 * @param {string} viewMode - list or markdown view
 */
export const parseResourceContents = async ({
    chapter = 1,
    verse = 1,
    languageId,
    projectId,
    contentRef = "master",
    resourceId,
    owner,
    server,
    fetchMarkdown = true,
    filePath = "",
    httpConfig = {},
    listRef = "master",
    viewMode = "markdown",
}: {
    chapter: number | string;
    verse: number | string;
    languageId: string;
    projectId: string;
    contentRef: string;
    resourceId: string;
    owner: string;
    server: string;
    fetchMarkdown: boolean;
    filePath: string;
    httpConfig: object;
    listRef: string;
    viewMode: string;
}) => {
    const reference = {
        chapter,
        verse,
        filePath,
        projectId,
        ref: listRef,
    };
    const resourceLink = `${owner}/${languageId}/${resourceId}/${listRef}`;
    console.log("resourceLink", reference, resourceLink);
    const config = {
        server,
        ...httpConfig,
    };

    const { content, resource } = await parseResource({
        resourceLink,
        reference,
        config,
    });

    console.log("resource here: ", resource);

    // items in a specific note within verse and tsvs includes the entire file
    const { items, tsvs } = await parseContentTsv({
        httpConfig: config,
        ref: contentRef,
        fetchMarkdown,
        languageId,
        resourceId,
        projectId,
        content,
        chapter: chapter as string,
        server,
        owner,
        verse: verse as string,
    });

    const contentNotFoundError = !content;
    const manifestNotFoundError = !resource?.manifest;

    // TODO: need to handle the extra content for twls
    // const { processedItems } = useExtraContent({
    //     verse,
    //     owner,
    //     server,
    //     chapter,
    //     filePath,
    //     projectId,
    //     languageId,
    //     resourceId,
    //     httpConfig,
    //     viewMode,
    //     useUserLocalStorage,
    //     initialized,
    //     loading,
    //     items,
    //     onResourceError,
    //     reference,
    // });

    return {
        tsvs,
        resource,
        items: items, // processed items take priority
        markdown: Array.isArray(content) ? null : content,
        props: {
            verse,
            owner,
            server,
            chapter,
            filePath,
            projectId,
            languageId,
            resourceId,
        },
    };
};
