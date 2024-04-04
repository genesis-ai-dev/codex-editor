import { useEffect, useState } from "react";
import { renderToPage } from "../utilities/main-vscode";
import { vscode } from "../utilities/vscode";
import {
    VSCodePanelTab,
    VSCodePanelView,
    VSCodePanels,
} from "@vscode/webview-ui-toolkit/react";
import TranslationNoteScroller from "../components/TranslationNoteScroller";

const ObsTranslationNotes = () => {
    const { translationNotes } = useTranslationNotes();

    const [noteIndex, setNoteIndex] = useState(0);
    const incrementNoteIndex = () => {
        setNoteIndex((prevIndex) => {
            if (prevIndex + 1 === translationNotes?.length) {
                return 0;
            }
            return prevIndex + 1;
        });
    };
    const decrementNoteIndex = () => {
        setNoteIndex((prevIndex) => {
            if (prevIndex === 0) {
                return translationNotes?.length
                    ? translationNotes.length - 1
                    : 0;
            }
            return prevIndex - 1;
        });
    };

    const content = translationNotes?.length ? (
        <TranslationNoteScroller
            notes={translationNotes || {}}
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
                    <VSCodePanelTab id="tab-verse">VERSE NOTES</VSCodePanelTab>
                    <VSCodePanelView id="view-verse">{content}</VSCodePanelView>
                </VSCodePanels>
            </section>
        </main>
    );
};

renderToPage(<ObsTranslationNotes />);

const useTranslationNotes = () => {
    const [translationNotes, setTranslationQuestions] = useState<
        Record<string, string>[]
    >([]);

    useEffect(() => {
        vscode.setMessageListeners((event) => {
            switch (event.data.type) {
                case "update-tn":
                    setTranslationQuestions(
                        event.data.payload.translationNotes ?? [],
                    );
                    console.log(
                        "event.data.payload.translationNotes: ",
                        event.data.payload,
                    );
                    break;
            }
        });
    }, []);

    return { translationNotes };
};
