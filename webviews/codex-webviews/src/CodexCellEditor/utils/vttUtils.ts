import { useEffect, useMemo } from "react";
import { QuillCellContent } from "../../../../../types";
import { removeHtmlTags, formatTimecode } from "@sharedUtils";

export const useSubtitleData = (translationUnits: QuillCellContent[]) => {
    const subtitleData = useMemo(() => {
        return generateVttData(translationUnits, true);
    }, [translationUnits]);
    const subtitleBlob = useMemo(
        () => new Blob([subtitleData], { type: "text/vtt" }),
        [subtitleData]
    );
    const subtitleUrl = useMemo(() => URL.createObjectURL(subtitleBlob), [subtitleBlob]);

    // A new object URL is minted on every edit (each keystroke changes the cue text). Revoke
    // the previous one when it changes and on unmount so editing sessions don't leak blobs.
    useEffect(() => {
        return () => URL.revokeObjectURL(subtitleUrl);
    }, [subtitleUrl]);

    return { subtitleUrl, subtitleData };
};

/**
 * Sanitize a cellLabel for use inside a WebVTT <v ...> voice tag.
 * The annotation portion of a voice span cannot contain `<`, `>`, or newlines.
 */
const escapeVoiceName = (label: string): string =>
    label.replace(/[<>]/g, "").replace(/\r?\n/g, " ").trim();

export const generateVttData = (
    translationUnits: QuillCellContent[],
    includeStyles: boolean
): string => {
    if (!translationUnits.length) return "";

    const cues = translationUnits
        .filter((unit) => !!unit.timestamps)
        .map((unit, index) => {
            const startTime = unit.timestamps?.startTime ?? index;
            const endTime = unit.timestamps?.endTime ?? index + 1;
            const body = includeStyles ? unit.cellContent : removeHtmlTags(unit.cellContent);
            const rawLabel = unit.cellLabel?.trim();
            const payload = rawLabel
                ? `<v ${escapeVoiceName(rawLabel)}>${body}</v>`
                : body;
            return `${unit.cellMarkers[0]}
${formatTimecode(Number(startTime))} --> ${formatTimecode(Number(endTime))}
${payload}

`;
        })
        .join("\n");

    return `WEBVTT

${cues}`;
};
