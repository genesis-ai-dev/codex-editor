import { parseReferenceToList } from "../../lib/bibleReferenceRange";
import { get } from "./giteaApi";
import { getResponseData } from "./resourceFromResourceLink";
/**
 * hook for loading translation helps resources listed in content
 * @param {boolean} fetchMarkdown - flag that resource being fetched is in markdown
 * @param {string} languageId
 * @param {string} resourceId
 * @param {string} projectId
 * @param {string} chapter
 * @param {array} content - list of resources to load
 * @param {string} server
 * @param {string} owner
 * @param {string} ref - points to specific ref that could be a branch or tag
 * @param {string} verse
 * @param {function} onResourceError - optional callback if there is an error fetching resource, parameters returned are:
 *    ({string} errorMessage, {boolean} isAccessError, {object} resourceStatus, {Error} error)
 *      - isAccessError - is true if this was an error trying to access file
 *      - resourceStatus - is object containing details about problems fetching resource
 *      - error - Error object that has the specific error returned
 * @param {object} httpConfig - optional config settings for fetches (timeout, cache, etc.)
 */
export async function parseContentTsv({
    fetchMarkdown = true,
    languageId,
    resourceId,
    projectId,
    chapter,
    content,
    server,
    owner,
    ref: ref_ = "master",
    verse,
    httpConfig = {},
}: {
    fetchMarkdown: boolean;
    languageId: string;
    resourceId: string;
    projectId: string;
    chapter: string;
    content: any[];
    server: string;
    owner: string;
    ref: string;
    verse: string;
    httpConfig: any;
}) {
    const tsvItems = Array.isArray(content) ? content : [];
    const tn: any = {};
    const book = projectId?.toLowerCase() || "list";

    for (let index = 0; index < tsvItems.length; index++) {
        const note = tsvItems[index];
        let referenceList = null;
        const _reference = note?.Reference;
        if (!_reference) {
            // if in old TSV format, then add as a single ref to refs
            referenceList = [
                {
                    chapter: note?.Chapter || "",
                    verse: note?.Verse || "",
                },
            ];
        }

        if (_reference) {
            // if new TSV format, parse the reference
            // parse the reference to find all the verses contained since this could be a reference range
            referenceList = parseReferenceToList(_reference);
            const multiVerse =
                referenceList?.length > 1 || referenceList?.[0]?.endVerse;
            if (multiVerse) {
                note._referenceRange = `${note.ID}_${_reference}`; // save a unique tag for the reference range
            }
        }

        // map this note to each chapter:verse in reference list
        for (const refChunk of referenceList || []) {
            const refs = [];
            let { chapter, verse: _verse, endVerse } = refChunk;
            endVerse = endVerse || _verse;

            if (chapter > 0 && _verse > 0) {
                for (let verse = _verse; verse <= endVerse; verse++) {
                    refs.push({ chapter, verse });
                }
            } else {
                refs.push({ chapter, verse: _verse });
            }

            for (const ref of refs) {
                const { chapter, verse } = ref;

                if (tn[book] && tn[book][chapter] && tn[book][chapter][verse]) {
                    tn[book][chapter][verse].push(note);
                } else if (tn[book] && tn[book][chapter]) {
                    tn[book][chapter][verse] = [note];
                } else if (tn[book]) {
                    tn[book][chapter] = {};
                    tn[book][chapter][verse] = [note];
                } else {
                    tn[book] = {};
                    tn[book][chapter] = {};
                    tn[book][chapter][verse] = [note];
                }
            }
        }
    }

    let _items =
        tn[projectId] && tn[projectId][chapter] && tn[projectId][chapter][verse]
            ? tn[projectId][chapter][verse]
            : null;

    if (
        _items &&
        Array.isArray(_items) &&
        (_items[0].SupportReference?.includes("rc://*/") ||
            _items[0].TWLink?.includes("rc://*/"))
    ) {
        const newItems = [];
        let url: string;

        if (fetchMarkdown) {
            for (let i = 0; i < _items.length; i++) {
                const item = _items[i];
                const path =
                    item.SupportReference ||
                    typeof item.SupportReference === "string"
                        ? item.SupportReference.replace("rc://*/", "")
                        : item.TWLink.replace("rc://*/", "");
                const routes = path.split("/");
                const resource = routes[0];
                const newRoutes = routes.slice(2, routes.length);
                const filename = resource === "ta" ? "/01.md" : ".md";
                let filePath = `${newRoutes.join("/")}${filename}`;
                url = `${server}/api/v1/repos/${owner}/${languageId}_${resource}/contents/${filePath}?ref=${ref_}`;
                let markdown = "";
                let fetchResponse = null;

                if (path) {
                    // only fetch data if we were able to get path for item
                    const ref = item?.SupportReference || item?.TWLink;
                    try {
                        const result = await get({
                            url,
                            params: {},
                            config: httpConfig,
                            fullResponse: true,
                        }).then((response) => {
                            const resourceDescr = `${languageId}_${resourceId}, ref '${ref}'`;
                            // const message = processHttpErrors(
                            //     response,
                            //     resourceDescr,
                            //     url,
                            //     onResourceError,
                            // );
                            // if (message) {
                            //     const httpCode = response?.status || 0;
                            //     console.warn(
                            //         `useTsvItems(${url}) - httpCode ${httpCode}, article not found: ${message}`,
                            //     );
                            //     return null;
                            // }
                            return response;
                        });
                        fetchResponse = result;
                        markdown = getResponseData(result);
                    } catch (e: any) {
                        const httpCode = e?.response?.status || 0;
                        console.warn(
                            `useTsvItems(${url}) - httpCode ${httpCode}, article not found`,
                            e,
                        );
                        const resourceDescr = `${languageId}_${resourceId}, ref '${ref}'`;
                        // processUnknownError(
                        //     e,
                        //     resourceDescr,
                        //     url,
                        //     onResourceError,
                        // );
                    }
                }
                // Remove filePath value for ta and twl
                if (
                    resource === "ta" ||
                    resource === "twl" ||
                    filePath === ".md"
                ) {
                    filePath = "";
                    fetchResponse = null;
                }

                newItems.push({
                    ...item,
                    markdown,
                    fetchResponse,
                    filePath,
                });
            }
            _items = newItems;
        }
    }

    return { items: _items, tsvs: tn[book] ?? null };
}
