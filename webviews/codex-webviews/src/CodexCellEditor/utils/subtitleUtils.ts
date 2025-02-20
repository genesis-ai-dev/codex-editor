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

        const timeMatch = cellId.match(/cue-(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)/);
        if (!timeMatch) return;

        const startTime = formatTimeSrt(parseFloat(timeMatch[1]));
        const endTime = formatTimeSrt(parseFloat(timeMatch[2]));
        const text = includeStyles ? unit.cellContent : removeHtmlTags(unit.cellContent);

        output += `${index++}\n`;
        output += `${startTime} --> ${endTime}\n`;
        output += `${includeStyles ? text : text}\n\n`;
    });

    return output;
}

function formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.round((seconds % 1) * 1000);

    return `${pad(hours)}:${pad(minutes)}:${pad(secs)}.${padMs(ms)}`;
}

function formatTimeSrt(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.round((seconds % 1) * 1000);

    return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${padMs(ms)}`;
}

function pad(num: number): string {
    return num.toString().padStart(2, "0");
}

function padMs(num: number): string {
    return num.toString().padStart(3, "0");
}
