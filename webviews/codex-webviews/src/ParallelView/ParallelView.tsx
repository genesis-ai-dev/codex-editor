import React, { useState, useEffect } from "react";
import { VSCodePanelTab, VSCodePanelView, VSCodePanels, VSCodeButton } from "@vscode/webview-ui-toolkit/react";

const vscode = acquireVsCodeApi();

interface Item {
    book: string;
    chapter: string;
    verse: string;
    text: string;
    createdAt: Date;
    uri: string;
}
interface DetailedAnomaly {
    reference: string;
    reason: string;
}
interface SearchResult {
    bibleResults: Item[];
    codexResults: Item[];
    detailedAnomalies: DetailedAnomaly[];
}

interface OpenFileMessage {
    command: "openFileAtLocation";
    uri: string;
    word: string;
}

function App() {
    const [searchResults, setSearchResults] = useState<SearchResult>({bibleResults: [], codexResults: [], detailedAnomalies: []});
    const [loading, setLoading] = useState<boolean>(false);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case "searchResults": {
                    const { bible_results, codex_results, detailed_anomalies }: { bible_results: Item[], codex_results: Item[], detailed_anomalies: DetailedAnomaly[] } = message.data;
                    const parsedBibleResults = bible_results.map((item: Item) => ({...item, createdAt: new Date(item.createdAt)}));
                    const parsedCodexResults = codex_results.map((item: Item) => ({...item, createdAt: new Date(item.createdAt)}));
                    setSearchResults({ bibleResults: parsedBibleResults, codexResults: parsedCodexResults, detailedAnomalies: detailed_anomalies});
                    break;
                }
                case "completed":
                    setLoading(false);
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
        console.log("Embedding all codex documents...");
        setLoading(true);

        vscode.postMessage({
            command: "embedAllDocuments",
        });
    };

    const handleEmbedBible = () => {
        console.log("Embedding all bible documents...");
        setLoading(true);
        vscode.postMessage({
            command: "embedSource",
        });
    };
    const PassageTab = ({callback, resultType}: {callback: () => void; resultType: "bibleResults" | "codexResults";}) => {     
        return (    
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
            {!loading && (
                <div style={{
                        display: "flex",
                        flexDirection: "row",
                        gap: "10px"
                    }}>
                    <VSCodeButton onClick={callback}>
                        Regenerate meaning database.
                    </VSCodeButton>
                </div>
            )}
            {loading ? <p>Loading, this may take up to 30 minutes, please do not close this tab.</p> : null}
            {searchResults.bibleResults.length > 0 || searchResults.codexResults.length > 0 ? (
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
        );}

    const AnomalyTab: React.FC = () => {
        // Group anomalies by reason
        interface Anomaly {
            reason: string;
            reference: string;
        }

        const anomaliesByReason: Record<string, string[]> = searchResults.detailedAnomalies.reduce((acc: Record<string, string[]>, anomaly: Anomaly) => {
            if (!acc[anomaly.reason]) {
                acc[anomaly.reason] = [];
            }
            acc[anomaly.reason].push(anomaly.reference);
            return acc;
        }, {});

        return (
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "20px",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "large",
                    width: "95%",
                    margin: "20px auto",
                    padding: "20px",
                    background: "var(--vscode-editor-background)",
                    color: "var(--vscode-editor-foreground)",
                    borderRadius: "8px",
                    boxShadow: "0 4px 8px rgba(0,0,0,0.1)",
                }}
            >
                {loading ? <p style={{ fontWeight: "bold", color: "var(--vscode-editorWarning-foreground)" }}>Loading, this may take up to 30 minutes, please do not close this tab.</p> : null}
                {Object.keys(anomaliesByReason).length > 0 ? (
                    <div style={{ overflowX: "auto", width: "95%" }}>
                        <table
                            style={{
                                width: "100%",
                                textAlign: "left",
                                borderCollapse: "collapse",
                            }}
                        >
                            <thead>
                                <tr>
                                    {Object.keys(anomaliesByReason).map((reason, index) => (
                                        <th key={index} style={{ padding: "10px", borderBottom: "2px solid var(--vscode-editor-selectionBackground)" }}>{reason}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {Object.values(anomaliesByReason).map((references, index) => (
                                    <td key={index} style={{ padding: "10px", borderBottom: "1px solid var(--vscode-editor-inactiveSelectionBackground)" }}>
                                        {references.map((reference, refIndex) => (
                                            <p key={refIndex} style={{ margin: "5px 0" }}>{reference}</p>
                                        ))}
                                    </td>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <p style={{ fontStyle: "italic" }}>No anomalies found.</p>
                )}
            </div>
        );
    };

    return (
        <VSCodePanels>
            <VSCodePanelTab id="tab1">Target</VSCodePanelTab>
                <VSCodePanelView id="view1">
                    <PassageTab callback={handleEmbedAllDocuments} resultType="codexResults" />
                </VSCodePanelView>

            <VSCodePanelTab id="tab2">Source</VSCodePanelTab>
                <VSCodePanelView id="view2">
                    <PassageTab callback={handleEmbedBible} resultType="bibleResults" />
                </VSCodePanelView>

            <VSCodePanelTab id="tab3">Anomalies</VSCodePanelTab>
                <VSCodePanelView id="view3">
                    <AnomalyTab />
                </VSCodePanelView>
        </VSCodePanels>
    );
}
export default App;

