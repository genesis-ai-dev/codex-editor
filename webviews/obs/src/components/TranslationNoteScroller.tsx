import React from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";

import TranslationNote from "./TranslationNote";

const TranslationNoteScroller = ({
    notes,
    currentIndex,
    incrementIndex,
    decrementIndex,
}: {
    notes: Record<string, string>[];
    currentIndex: number;
    incrementIndex: () => void;
    decrementIndex: () => void;
}) => {
    return (
        <div className="scroller-container">
            {/* Container for the three elements side by side */}
            <div className="flex justify-between">
                {/* Left Button */}
                <VSCodeButton
                    onClick={decrementIndex}
                    appearance="icon"
                    aria-label="left"
                >
                    <span className="arrow-button codicon codicon-chevron-left"></span>
                </VSCodeButton>

                {/* Middle Element */}

                <div id="note-position">
                    {currentIndex + 1} of {notes.length}
                </div>
                {/* Right Button */}
                <VSCodeButton
                    onClick={incrementIndex}
                    appearance="icon"
                    aria-label="right"
                >
                    <span className="arrow-button codicon codicon-chevron-right"></span>
                </VSCodeButton>
            </div>
            <div id="note-container">
                <TranslationNote note={notes[currentIndex]} />
            </div>
        </div>
    );
};

export default TranslationNoteScroller;
