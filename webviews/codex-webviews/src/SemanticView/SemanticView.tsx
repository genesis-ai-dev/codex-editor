import React, { useState, useEffect } from "react";
import { VSCodeButton, VSCodeTextField, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";
import WordCloud from "react-wordcloud";


const vscode = acquireVsCodeApi();

interface SimilarWord {
    text: string;
    value: number;
}

const normalizeScores = (words: SimilarWord[]) => {
    const maxScore = Math.max(...words.map((word) => word.value));
    return words.map((word) => ({
        ...word,
        value: word.value / maxScore,
    }));
};

function App() {
    const [similarWords, setSimilarWords] = useState<SimilarWord[]>([]);
    const [query, setQuery] = useState("");
    const [isTraining, setIsTraining] = useState(false);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case "similarWords":
                    {
                        const words = message.data.map((word: { text: string; value: number }) => ({
                            text: word.text,
                            value: word.value,
                        }));
                        const normalizedWords = normalizeScores(words);
                        setSimilarWords(normalizedWords);
                    }
                    break;
                case "loadingComplete":
                    setIsTraining(false);
                    break;
            }
        };

        window.addEventListener("message", handleMessage);

        return () => {
            window.removeEventListener("message", handleMessage);
        };
    }, []);

    const searchSimilarWords = (word: string) => {
        setQuery(word);
        vscode.postMessage({
            command: "getSimilar",
            word: word,
        });
    };

    const trainModel = () => {
        setIsTraining(true);
        vscode.postMessage({
            command: "train",
        });
    };

    const handleWordClick = (word: SimilarWord) => {
        searchSimilarWords(word.text);
    };

    const wordCloudOptions = {
        rotations: 0,
        rotationAngles: [0],
        fontSizes: [10, 60] as [number, number],
        enableOptimizations: true,
        padding: 5,
        colors: ["white"],
    };

    return (
        <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "1em",
            boxSizing: "border-box",
            height: "100%",
        }}>
            <div style={{
                display: "flex",
                alignItems: "center",
                marginBottom: "1em",
                width: "100%",
                maxWidth: "400px",
            }}>
                <VSCodeTextField
                    placeholder="Enter a word"
                    value={query}
                    onChange={(e: any) => setQuery(e.target.value)}
                    style={{ flexGrow: 1, marginRight: "1em" }}
                />
                <VSCodeButton appearance="primary" onClick={() => searchSimilarWords(query)}>Search</VSCodeButton>
            </div>

            {similarWords.length > 0 && (
                <div style={{ width: "100%", height: "400px" }}>
                    <WordCloud
                        words={[{ text: query, value: 1 }, ...normalizeScores(similarWords)]}
                        options={{
                            ...wordCloudOptions,
                            rotationAngles: [0, 0] // Adjusted to match the expected type [number, number]
                        }}
                        callbacks={{
                            onWordClick: handleWordClick,
                        }}
                    />
                </div>
            )}
        </div>
    );
}

export default App;