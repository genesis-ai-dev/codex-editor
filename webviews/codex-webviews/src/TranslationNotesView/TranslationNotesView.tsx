// import { vscode } from "./utilities/vscode";
import React, { useState, useEffect } from "react";
import {
    VSCodePanels,
    VSCodePanelTab,
    VSCodePanelView,
} from "@vscode/webview-ui-toolkit/react";
import { vscode } from "./utilities/vscode";
import "./TranslationNotes.css";

import TranslationNoteScroller from "./components/TranslationNoteScroller";
import { extractBookChapterVerse } from "../../../../src/utils/extractBookChapterVerse";
import type { TnTSV } from "../../../../types/TsvTypes";
import type { VerseRefGlobalState } from "../../../../types";

type CommandToFunctionMap = Record<string, (data: any) => void>;

function App() {
    const [chapter, setChapter] = useState<number>(1);
    const [verse, setVerse] = useState<number>(1);
    const [noteIndex, setNoteIndex] = useState<number>(0);
    const [translationNotesObj, setTranslationNotesObj] = useState<TnTSV>({});

    const changeChapterVerse = (ref: VerseRefGlobalState): void => {
        const { verseRef } = ref;
        const { chapter: newChapter, verse: newVerse } =
            extractBookChapterVerse(verseRef);

        setChapter(newChapter);
        setVerse(newVerse);
        setNoteIndex(0);
    };

    const handleMessage = (event: MessageEvent) => {
        const { command, data } = event.data;
        1;

        const commandToFunctionMapping: CommandToFunctionMap = {
            ["update"]: (data: TnTSV) => setTranslationNotesObj(data),
            ["changeRef"]: (data: VerseRefGlobalState) =>
                changeChapterVerse(data),
        };

        commandToFunctionMapping[command](data);
    };

    function sendFirstLoadMessage() {
        vscode.postMessage({
            command: "loaded",
            text: "Webview first load success",
        });
    }

    useEffect(() => {
        window.addEventListener("message", handleMessage);
        sendFirstLoadMessage();

        return () => {
            window.removeEventListener("message", handleMessage);
        };
    }, []);

    const incrementNoteIndex = () =>
        setNoteIndex((prevIndex) =>
            prevIndex < translationNotesObj[chapter][verse].length - 1
                ? prevIndex + 1
                : prevIndex,
        );
    const decrementNoteIndex = () =>
        setNoteIndex((prevIndex) =>
            prevIndex > 0 ? prevIndex - 1 : prevIndex,
        );

    // TODO: Implement note navigation
    // function handleNoteNavigation() {
    //   vscode.postMessage({
    //     command: "next note",
    //     text: "Navigating verse notes",
    //   });
    // }

    const content = translationNotesObj?.[chapter]?.[verse] ? (
        <TranslationNoteScroller
            notes={translationNotesObj[chapter][verse] || {}}
            currentIndex={noteIndex}
            incrementIndex={incrementNoteIndex}
            decrementIndex={decrementNoteIndex}
        />
    ) : (
        "No translation notes available for this verse."
    );

    return (
        <main>
            <section className="translation-note-view">
                <VSCodePanels activeid="tab-verse" aria-label="note-type-tab">
                    {/* <VSCodePanelTab id="tab-book">BOOK NOTES</VSCodePanelTab> */}
                    {/* <VSCodePanelTab id="tab-chapter">CHAPTER NOTES</VSCodePanelTab> */}
                    <VSCodePanelTab id="tab-verse">VERSE NOTES</VSCodePanelTab>
                    {/* <VSCodePanelView id="view-book">Problems content.</VSCodePanelView> */}
                    {/* <VSCodePanelView id="view-chapter">Output content.</VSCodePanelView> */}
                    <VSCodePanelView id="view-verse">{content}</VSCodePanelView>
                </VSCodePanels>
            </section>
        </main>
    );
}

export default App;
