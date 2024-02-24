import React, { useState, useRef, useEffect } from "react";
import { VSCodeButton, VSCodePanelTab, VSCodePanelView, VSCodePanels } from "@vscode/webview-ui-toolkit/react";

const vscode = acquireVsCodeApi();

interface Item {
    book: string;
    chapter: string;
    verse: string;
    text: string;
    createdAt: Date; // Changed from string to Date
    uri: string;
}

interface SearchResult {
    source: Item[];
    target: Item[];
}

interface OpenFileMessage {
    command: "openFileAtLocation";
    uri: string;
    word: string;
}



function App() {
    const [searchResults, setSearchResults] = useState<SearchResult>({source: [], target: []}); // Adjusted to match the corrected interface
    const [loadingProgress, setLoadingProgress] = useState<{
        currentStep: number;
        totalSteps: number;
    } | null>(null);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case "searchResults": {
                    const { source, target } = message.data;
                    // Parse createdAt to Date object and ensure data structure matches interface
                    const parsedSource = source.map((item: any) => ({...item, createdAt: new Date(item.createdAt)}));
                    const parsedTarget = target.map((item: any) => ({...item, createdAt: new Date(item.createdAt)}));
                    setSearchResults({ source: parsedSource, target: parsedTarget });
                    break;
                }
                case "loadingProgress":
                    setLoadingProgress({
                        currentStep: message.currentStep,
                        totalSteps: message.totalSteps,
                    });
                    break;
                // Handle other cases
            }
        };

        window.addEventListener("message", handleMessage);

        return () => {
            window.removeEventListener("message", handleMessage);
        };
    }, []);

    const handleUriClick = (uri: string, word: string) => {
        console.log(`URI clicked: ${uri}`);
        vscode.postMessage({
            command: "openFileAtLocation",
            uri,
            word: word,
        } as OpenFileMessage);
    };

    const handleEmbedAllDocuments = () => {
        console.log("Embedding all target documents...");
        vscode.postMessage({
            command: "embedAllDocuments",
        });
    };

    const handleEmbedSource = () => {
        console.log("Embedding all source documents...");
        vscode.postMessage({
            command: "embedSource",
        });
    };

    const renderProgressBar = () => {
        if (!loadingProgress || loadingProgress.totalSteps === 0) {
            return null;
        }
        const progressPercentage =
            (loadingProgress.currentStep / loadingProgress.totalSteps) * 100;
        return (
            <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: "1em",
                alignItems: "center",
                justifyContent: "center",
                width: "95%",
                margin: "auto",
            }}
            >
                <div
                    style={{
                        height: "20px",
                        width: `${progressPercentage}%`,
                        backgroundColor: "var(--vscode-progressBar-background)",
                    }}
                ></div>
                <p style={{ textAlign: "center" }}>
                    Loading: {progressPercentage.toFixed(2)}%
                </p>
            </div>
        );
    };

    const PassageTab = ({callback, resultType}: {callback: () => void; resultType: "source" | "target";}) => {
        return  (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: "2em",
                alignItems: "center",
                justifyContent: "center",
                width: "95%",
                margin: "auto",
            }}
        >
             <div style={{
                    display: "flex",
                    flexDirection: "row",
                    gap: "10px"
                }}>
                    <VSCodeButton onClick={callback} style={{}}>
                        Regenerate meaning database.
                    </VSCodeButton>
                </div>
            {renderProgressBar()}
            {searchResults.source.length > 0 || searchResults.target.length > 0 ? (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "1em",
                    }}
                >
                    {searchResults[resultType].map((item, index) => (
                        <div
                            key={index}
                            style={{
                                marginBottom: "20px",
                                background: "var(--vscode-sideBar-background)",
                                borderRadius: "10px",
                                alignContent: "center",
                                display: "flex",
                                flexDirection: "column",
                                padding: "20px",
                                width: "100%"
                            }}
                        >
                            <h3>
                                {item.book} {item.chapter}:{item.verse}
                            </h3>
                            <p
                                style={{
                                    background:
                                        "var(--vscode-sideBar-dropBackground)",
                                    borderRadius: "10px",
                                    margin: "10px",
                                    padding: "5px",
                                }}
                            >
                                {item.text}
                            </p>
                            <p>
                                <strong>Last indexed:</strong>{" "}
                                {item.createdAt.toLocaleString()}
                            </p>
                                <button
                                    onClick={() =>
                                        handleUriClick(
                                            item.uri,
                                            `${item.chapter}:${item.verse}`,
                                        )
                                    }
                                    style={{
                                        marginTop: "10px",
                                        padding: "5px 10px",
                                        width: "95%",
                                        alignSelf: "center",
                                    }}> Open</button>
                        </div>
                    ))}
                </div>
            ) : (
                null
            )}
        </div>
        );

    }
    
    const findExistingVersesInCodex = async (references: string[]): Promise<string[]> => {
        try {
            const response = await fetch(`http://localhost:5554/exists?db_name=.codex&references=${encodeURIComponent(references.join("|"))}`);
            if (!response.ok) {
                throw new Error('Failed to check if verses exist in .codex');
            }
            const data = await response.json();
            return data.exists; // Adjusted to match the updated JSON structure
        } catch (error) {
            console.error('Error checking if verses exist in .codex:', error);
            return [];
        }
    }

    const LAD = ({ searchResults }: { searchResults: SearchResult }) => {
        const [codexVerses, setCodexVerses] = useState<string[]>([]);
        const [sourceVerses, setSourceVerses] = useState<string[]>([]);
    
        useEffect(() => {
            const fetchVerses = async () => {
                const sourceVerseRefs = searchResults.source.map(item => `${item.book} ${item.chapter}:${item.verse}`);
                const codexVerseRefs = await findExistingVersesInCodex(sourceVerseRefs);
                setCodexVerses(codexVerseRefs);
                setSourceVerses(sourceVerseRefs);
            };
    
            fetchVerses();
        }, [searchResults]); // This effect runs whenever searchResults change
    
        const inBoth = codexVerses.filter(verse => sourceVerses.includes(verse));
        const inSourceNotCodex = sourceVerses.filter(verse => !codexVerses.includes(verse));
    
        return (
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "1em",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "95%",
                    margin: "auto",
                }}
            >
                <h1>Note: This feature is not complete yet. Results are useless.</h1>
                <table style={{ width: "100%" }}>
                    <thead>
                        <tr>
                            <th>Verses in Both</th>
                            <th>Verses in Source but not in .codex</th>
                        </tr>
                    </thead>
                    <tbody>
                        {inBoth.map((verse, index) => (
                            <tr key={index}>
                                <td style={{ textAlign: "center" }}>{verse}</td>
                                <td style={{ textAlign: "center" }}>
                                    {inSourceNotCodex.includes(verse) ? verse : ''}
                                </td>
                            </tr>
                        ))}
                        {inSourceNotCodex.map((verse, index) => (
                            !inBoth.includes(verse) && (
                                <tr key={index}>
                                    <td style={{ textAlign: "center" }}></td>
                                    <td style={{ textAlign: "center" }}>{verse}</td>
                                </tr>
                            )
                        ))}
                    </tbody>
                </table>
            </div>
        );
    }
    
    return (
        <VSCodePanels>
            <VSCodePanelTab id="tab1">Target</VSCodePanelTab>
                <VSCodePanelView id="view1">
                    <PassageTab callback={handleEmbedAllDocuments} resultType="target" />
                </VSCodePanelView>

            <VSCodePanelTab id="tab2">Source</VSCodePanelTab>
                <VSCodePanelView id="view2">
                    <PassageTab callback={handleEmbedSource} resultType="source" />
                </VSCodePanelView>

            <VSCodePanelTab id="tab3">LAD</VSCodePanelTab>
                <VSCodePanelView id="view3">
                    <LAD searchResults={searchResults}/>
                </VSCodePanelView>
        </VSCodePanels>
    );
}
export default App;
