import { QuillCellContent } from "../../../../../types";
import { removeHtmlTags } from "./shareUtils";
import { generateVttData } from "./vttUtils";
// import { getCleanedHtml } from "../react-quill-spellcheck/SuggestionBoxes";

export function generateSubtitleData(
    translationUnits: QuillCellContent[],
    format: string,
    includeStyles: boolean
): string {
    if (format === "srt") {
        return generateSrtData(translationUnits, includeStyles);
    }
    return generateVttData(translationUnits, includeStyles);
}

function generateSrtData(translationUnits: QuillCellContent[], includeStyles: boolean): string {
    let output = "";
    let index = 1;

    translationUnits.forEach((unit) => {
        const cellId = unit.cellMarkers[0];
        if (!cellId) return;

        const text = includeStyles ? unit.cellContent : removeHtmlTags(unit.cellContent);
        const startTime = unit.timestamps?.startTime;
        const endTime = unit.timestamps?.endTime;

        output += `${index++}\n`;
        output += `${startTime} --> ${endTime}\n`;
        output += `${includeStyles ? text : text}\n\n`;
    });

    return output;
}
