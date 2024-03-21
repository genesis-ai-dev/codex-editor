/* eslint-disable no-unused-vars */
import { useState } from "react";
import {
    // useDeepCompareCallback,
    useDeepCompareEffect,
    useDeepCompareMemo,
} from "use-deep-compare";
// import isEqual from "lodash.isequal";
import { Perf } from "@/types/perfType";
import htmlMap from "@/utilities/htmlmap";
import EpiteleteHtml from "epitelete-html";
export default function usePerf({
    perf,
    bookId,
    // docSetId,
}: {
    perf: Perf | null;
    bookId: string | null;
    docSetId: string | null;
}) {
    const [htmlPerf, setHtmlPerf] = useState<Perf>();
    const [ready, setReady] = useState<boolean>(false);
    const [usfmText, setUsfmText] = useState<string>();
    // const [isSaving, startSaving] = useTransition();

    const epiteleteHtml = useDeepCompareMemo(
        () =>
            new EpiteleteHtml({
                proskomma: undefined,
                docSetId: "xxxXXX",
                htmlMap,
                options: { historySize: 100 },
            }),
        [],
    );

    useDeepCompareEffect(() => {
        async function loadUsfm() {
            await epiteleteHtml.sideloadPerf(bookId, perf);
            setReady(true);
        }
        if (epiteleteHtml && bookId && perf) loadUsfm();
    }, [epiteleteHtml, perf, bookId]);

    useDeepCompareEffect(() => {
        if (epiteleteHtml && bookId && ready && htmlMap) {
            epiteleteHtml
                .readHtml(bookId, { cloning: false }, htmlMap)
                .then((_htmlPerf: undefined) => {
                    // remove htmlMap for default classes
                    setHtmlPerf(_htmlPerf);
                });
        }
    }, [epiteleteHtml, bookId, ready]);

    const exportUsfm = async (bookId: string) => {
        const usfmString = await epiteleteHtml?.readUsfm(bookId);
        setUsfmText(usfmString);
        // saveToFile(usfmString, bookId);
        epiteleteHtml
            ?.readHtml(bookId, { cloning: false }, htmlMap)
            .then((_htmlPerf: undefined) => {
                // remove htmlMap for default classes
                setHtmlPerf(_htmlPerf);
            });
    };
    // useDeepCompareEffect(() => {
    //   if (htmlPerf && htmlPerf.mainSequenceId !== state.sequenceIds[0]) {
    //     actions.setSequenceIds([htmlPerf?.mainSequenceId]);
    //   }
    // }, [htmlPerf, state.sequenceIds]);

    // const saveHtmlPerf = useDeepCompareCallback(
    //   (_htmlPerf, { sequenceId }) => {
    //     if (!isEqual(htmlPerf, _htmlPerf)) {
    //       setHtmlPerf(_htmlPerf);
    //     }

    //     startSaving(async () => {
    //       const newHtmlPerf = await epiteleteHtml?.writeHtml(
    //         bookId,
    //         sequenceId,
    //         _htmlPerf,
    //         { insertSequences: true }
    //       );
    //       if (!isEqual(htmlPerf, newHtmlPerf)) {
    //         setHtmlPerf(newHtmlPerf);
    //       }
    //       bookId && exportUsfm(bookId);
    //     });
    //   },
    //   [htmlPerf, bookId]
    // );
    const undo = async () => {
        const newPerfHtml = await epiteleteHtml?.undoHtml(bookId);
        setHtmlPerf(newPerfHtml);
    };

    const redo = async () => {
        const newPerfHtml = await epiteleteHtml?.redoHtml(bookId);
        setHtmlPerf(newPerfHtml);
    };

    const canUndo =
        (epiteleteHtml?.canUndo && epiteleteHtml?.canUndo(bookId)) || false;
    const canRedo =
        (epiteleteHtml?.canRedo && epiteleteHtml?.canRedo(bookId)) || false;

    const state = {
        bookId,
        htmlPerf,
        canUndo,
        canRedo,
        // isSaving,
        usfmText,
    };

    const actions = {
        exportUsfm,
        undo,
        redo,
    };

    return { htmlPerf, setHtmlPerf, ready, actions, state };
}
