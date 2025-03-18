import { useMemo } from "react";
import { QuillCellContent } from "../../../../../types";
<<<<<<< HEAD

export const useSubtitleData = (translationUnits: QuillCellContent[]) => {
    const subtitleData = useMemo(() => {
        return generateVttData(translationUnits);
=======
import { removeHtmlTags } from "./shareUtils";

export const useSubtitleData = (translationUnits: QuillCellContent[]) => {
    const subtitleData = useMemo(() => {
        return generateVttData(translationUnits, true);
>>>>>>> main
    }, [translationUnits]);
    const subtitleBlob = useMemo(
        () => new Blob([subtitleData], { type: "text/vtt" }),
        [subtitleData]
    );
    const subtitleUrl = useMemo(() => URL.createObjectURL(subtitleBlob), [subtitleBlob]);

    return { subtitleUrl, subtitleData };
};

<<<<<<< HEAD
export const generateVttData = (translationUnits: QuillCellContent[]): string => {
=======
export const generateVttData = (
    translationUnits: QuillCellContent[],
    includeStyles: boolean
): string => {
>>>>>>> main
    if (!translationUnits.length) return "";

    const formatTime = (seconds: number): string => {
        const date = new Date(seconds * 1000);
        return date.toISOString().substr(11, 12);
    };

    const cues = translationUnits
        .filter((unit) => !!unit.timestamps)
        .map((unit, index) => {
            const startTime = unit.timestamps?.startTime ?? index;
            const endTime = unit.timestamps?.endTime ?? index + 1;
            return `${unit.cellMarkers[0]}
${formatTime(Number(startTime))} --> ${formatTime(Number(endTime))}
<<<<<<< HEAD
${unit.cellContent}
=======
${includeStyles ? unit.cellContent : removeHtmlTags(unit.cellContent)}
>>>>>>> main

`;
        })
        .join("\n");

    return `WEBVTT

${cues}`;
};
