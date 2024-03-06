import { useState, useEffect } from "react";
import "../App.css";
import {
    ScriptureContent,
    ScripturePostMessages,
    NotebookCellKind,
} from "../../../../types";

const markdownNotebookCellKind = 1 as NotebookCellKind;
const verseContentNotebookCellKind = 2 as NotebookCellKind;
const vscode = acquireVsCodeApi();
function App() {
    const [scriptureContent, setScriptureContent] =
        useState<ScriptureContent>();

    useEffect(() => {
        if (scriptureContent && scriptureContent?.cells.length === 0) {
            vscode.postMessage({
                command: "fetchData",
            } as ScripturePostMessages);
        }
        const handleMessage = (event: MessageEvent) => {
            const message: ScripturePostMessages = event.data;
            switch (message.command) {
                case "sendData": {
                    if (message.data) {
                        setScriptureContent(message.data);
                    }
                    break;
                }
            }
        };

        window.addEventListener("message", handleMessage);

        // Cleanup function to remove the event listener
        return () => {
            window.removeEventListener("message", handleMessage);
        };
    }, []); // The empty array means this effect runs once on mount and cleanup on unmount

    const ScriptureCells = ({
        scriptureContent,
    }: {
        scriptureContent: ScriptureContent | undefined;
    }) => {
        return scriptureContent?.cells.map((scriptureCell) => {
            const cellIsMarkdownChapterHeading =
                scriptureCell.kind === markdownNotebookCellKind &&
                scriptureCell.metadata?.type === "chapter-heading";

            const paragraphs: string[][] = [
                ...scriptureCell.value.split(/\n\s*\n/).map((p) => {
                    return p.split("\n");
                }),
            ];

            if (
                cellIsMarkdownChapterHeading ||
                scriptureCell.kind === verseContentNotebookCellKind
            ) {
                return (
                    <div
                        style={
                            {
                                // backgroundColor:
                                //     "var(--vscode-dropdown-background)",
                                // padding: "20px",
                                // borderRadius: "5px",
                                // boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                                // display: "flex",
                                // flexFlow: "column nowrap",
                            }
                        }
                    >
                        {scriptureCell.kind === markdownNotebookCellKind &&
                            scriptureCell.metadata?.type ===
                                "chapter-heading" && (
                                <h1>
                                    {scriptureCell.value
                                        .replace(/^#+\s*/, "")
                                        .trim()}
                                </h1>
                            )}
                        {scriptureCell.kind ===
                            verseContentNotebookCellKind && (
                            <>
                                <ScriptureParagraphs paragraphs={paragraphs} />
                            </>
                        )}
                    </div>
                );
            }
        });
    };

    interface VerseWithAllVrefs {
        originalContent: string;
        contentWithoutVrefs: string;
        allVrefs: VerseAndChapter[];
    }

    interface VerseAndChapter {
        verse: string;
        chapter: string;
    }

    const vrefPartsRegex = /([A-Z0-9]{3})\s(\d+):(\d+)/;
    const completeVrefRegex = /[A-Z0-9][A-Z0-9][A-Z0-9]\s\d+:\d+/g;

    function turnStringVrefToVerseAndChapter(
        completeVref: string,
    ): VerseAndChapter {
        // Note the adjusted destructuring here
        const [, , chapter, verse] = completeVref.match(vrefPartsRegex) || [];
        return { verse, chapter };
    }

    function turnArrayOfVrefsToDisplayVref(vrefs: VerseAndChapter[]): string {
        if (!vrefs || vrefs.length === 0) {
            return "";
        }
        if (vrefs.length === 1) {
            return vrefs[0]?.verse || "";
        }
        return `${vrefs[0]?.verse || ""}-${
            vrefs[vrefs.length - 1]?.verse || ""
        }`;
    }

    function extractVrefsFromLine(line: string): VerseAndChapter[] {
        const vrefMatches = [...line.matchAll(completeVrefRegex)];
        if (!vrefMatches) return [];
        return vrefMatches.map((match) => {
            return turnStringVrefToVerseAndChapter(match[0]);
        });
    }

    /** There are two cases where we might encounter ranges:
     * 1. A range is indicated by a line containing a vref followed by a range marker,
     *    e.g., "GEN 1:1 <range>".
     * 2. A range is indicated by a line beginning with multiple vrefs,
     *    e.g., "GEN 1:1 GEN 1:2 ...".
     * In case 1, we should convert the range marker to an array of vrefs.
     * In case 2, we should convert the multiple vrefs to a vref string range.
     *
     * @returns VerseWithAllVrefs[], where each element has an array of all vrefs in the line.
     * */
    function handleVrefRangeMarkers(paragraph: string[]) {
        if (!paragraph) return [];
        // if no <range> strings are found, we can just return the paragraph as is

        const verses: VerseWithAllVrefs[] = [];

        // let's reverse the paragraph lines, so we can 'skip' a range and still get the correct verse numbers
        const reversedParagraph = paragraph.reverse();
        let currentVerseContent: string = "";
        const accumulatedVrefs: VerseAndChapter[] = [];

        let rangeActive = false; // Flag to indicate if we are currently accumulating vrefs across lines due to a <range> marker

        reversedParagraph.forEach((line) => {
            const currentLineVrefs = extractVrefsFromLine(line);
            currentVerseContent = line.replace(completeVrefRegex, "").trim();

            // Check if the line contains a range marker, if so, activate range mode and start accumulating vrefs
            if (line.includes("<range>")) {
                rangeActive = true;
                accumulatedVrefs.push(...currentLineVrefs);
                // Skip adding this line as a separate verse since it's part of a range
                return;
            }

            // If we are in range mode and encounter a line without a <range>, it's the end of the range
            if (rangeActive) {
                accumulatedVrefs.push(...currentLineVrefs); // Include the current line's vrefs in the range

                // Add the accumulated vrefs as a range to verses, but only if accumulatedVrefs is not empty
                if (accumulatedVrefs.length > 0) {
                    verses.push({
                        originalContent: line,
                        contentWithoutVrefs: currentVerseContent,
                        allVrefs: accumulatedVrefs.slice().reverse(), // Clone and reverse the accumulatedVrefs to maintain order
                    });
                }
                accumulatedVrefs.length = 0; // Clear accumulatedVrefs for the next range
                rangeActive = false; // Deactivate range mode
            } else {
                // If not in range mode and the line does not contain a <range>, process the line as a single verse
                verses.push({
                    originalContent: line,
                    contentWithoutVrefs: currentVerseContent,
                    allVrefs: currentLineVrefs,
                });
            }
        });

        // then at the end we can reverse the verses array again
        return verses.reverse();
    }

    const ScriptureParagraphs = ({
        paragraphs,
    }: {
        paragraphs: string[][];
    }) => {
        if (!paragraphs) return null;

        const cleanedParagraphs: VerseWithAllVrefs[][] = paragraphs.map((p) =>
            handleVrefRangeMarkers(p),
        );

        return cleanedParagraphs.flatMap(
            (arrayOfLines: VerseWithAllVrefs[]) => {
                return arrayOfLines.map((line) => {
                    return (
                        <p
                            style={{
                                fontSize: "1rem",
                                lineHeight: "1.8rem",
                            }}
                        >
                            <span
                                style={{
                                    margin: "0",
                                    padding: "0.5em 0",
                                }}
                            >
                                <sup
                                    style={{
                                        verticalAlign: "text-top",
                                        marginRight: "0.3em",
                                        marginLeft: "0.3em",
                                        lineHeight: "1.5em",
                                    }}
                                >
                                    {turnArrayOfVrefsToDisplayVref(
                                        line.allVrefs,
                                    )}
                                </sup>
                                {line.contentWithoutVrefs}
                            </span>
                        </p>
                    );
                }, []);
            },
        );
    };

    return (
        <main
            style={{
                display: "flex",
                flexDirection: "column",
                height: "100vh",
                width: "100%",
                padding: "10px",
                boxSizing: "border-box",
                backgroundColor: "var(--vscode-editorWidget-background)",
                color: "var(--vscode-editorWidget-foreground)",
            }}
        >
            <div
                className="comments-container"
                style={{
                    flex: 1,
                    overflowY: "auto",
                    width: "100%",
                    marginTop: "10px",
                }}
            >
                <div
                    className="comments-content"
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "10px",
                    }}
                >
                    {scriptureContent ? (
                        <ScriptureCells scriptureContent={scriptureContent} />
                    ) : (
                        <p>Loading...</p>
                    )}
                </div>
            </div>
        </main>
    );
}

export default App;
