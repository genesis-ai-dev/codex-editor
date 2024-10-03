import { useMemo } from "react";
import { QuillCellContent } from "../../../../../types";

export const useSubtitleData = (translationUnits: QuillCellContent[]) => {
    const subtitleData = useMemo(() => {
        return generateVttData(translationUnits);
    }, [translationUnits]);

    const subtitleBlob = useMemo(
        () => new Blob([subtitleData], { type: "text/vtt" }),
        [subtitleData]
    );
    const subtitleUrl = useMemo(() => URL.createObjectURL(subtitleBlob), [subtitleBlob]);

    return { subtitleUrl };
};

const generateVttData = (translationUnits: QuillCellContent[]): string => {
    if (!translationUnits.length) return "";

    const formatTime = (seconds: number): string => {
        const date = new Date(seconds * 1000);
        return date.toISOString().substr(11, 12);
    };

    const cues = translationUnits
        .map((unit, index) => {
            const startTime = unit.timestamps?.startTime ?? index;
            const endTime = unit.timestamps?.endTime ?? index + 1;
            return `${unit.cellMarkers[0]}
${formatTime(Number(startTime))} --> ${formatTime(Number(endTime))}
${unit.cellContent}

`;
        })
        .join("\n");

    return `WEBVTT

${cues}`;
};
