import { Dispatch, SetStateAction, useEffect, useState } from "react";
import { vscode } from "../utilities/vscode";
import { usfm2perf } from "./useProskomma";
// import { MessageType } from "../types/types";
import { Perf } from "../types/perfType";

export const useDocument = ({
    scrollToChapter,
    bookCode,
    setBookCode,
}: {
    scrollToChapter: (chapter: number, verse: number) => void;
    bookCode: string;
    setBookCode: Dispatch<SetStateAction<string>>;
}) => {
    const [document, setDocument] = useState<string | null>(null);
    const [perf, setPerf] = useState<Perf | null>(null);
    // const [bookCode, setBookCode] = useState<string | null>(null);
    const [docSetId, setDocSetId] = useState<string | null>(null);
    const [id, setId] = useState<string | null>(null);
    const [chapter, setChapter] = useState<number>(1);

    useEffect(() => {
        vscode.setMessageListeners((event) => {
            switch (event.data.type) {
                case "update-usfm": {
                    const { usfm, bookID, chapter, verse } = event.data.payload;
                    console.log("useDocument", {
                        bookCode,
                        bookID,
                        chapter,
                        verse,
                    });

                    scrollToChapter(chapter, verse);
                    console.log("scrolling to chapter", chapter);

                    console.log("received", { usfm, bookID, chapter, verse });
                    setDocument(event.data.payload.usfm);
                    setChapter(event.data.payload.chapter);
                    const {
                        perf,
                        id,
                        docSetId,
                    }: { perf: Perf; id: string; docSetId: string } = usfm2perf(
                        event.data.payload.usfm,
                    );
                    console.log({ perf, id, docSetId });
                    perf &&
                        perf.metadata.document.bookCode &&
                        setBookCode(perf.metadata.document.bookCode);
                    setPerf(perf);
                    setId(id);
                    setDocSetId(docSetId);
                    break;
                }
                case "fileOpened":
                    console.log(
                        `received message from extension :${event.data.type}`,
                    );
                    break;
            }
        });
    }, []);

    return { document, perf, bookCode, id, docSetId, chapter };
};
