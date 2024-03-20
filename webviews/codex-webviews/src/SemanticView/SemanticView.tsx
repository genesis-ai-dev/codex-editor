import React, { useState, useEffect, useRef } from "react";
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import { motion, useAnimation } from "framer-motion";
import fitty from "fitty";

const vscode = acquireVsCodeApi();

interface SimilarWord {
    word: string;
}

interface WordSquareProps {
    word: string;
    onClick: () => void;
}

const WordSquare: React.FC<WordSquareProps> = ({ word, onClick }) => {
    const controls = useAnimation();
    const textRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        controls.start({
            opacity: 1,
            scale: 1,
            transition: { delay: 0.3 },
        });

        if (textRef.current) {
            fitty(textRef.current, {
                minSize: 10,
                maxSize: 32,
            });
        }
    }, [word, controls]);

    const handleClick = () => {
        controls.start({
            scale: 1, // Doubled the scale from 0.8 to 1.6
            transition: { duration: 0.2 },
        }).then(() => {
            onClick();
            controls.start({
                scale: 1, // Doubled the scale from 1 to 2
                transition: { duration: 0.2 },
            });
        });
    };

    return (
        <motion.div
            style={{
                background: "var(--vscode-sideBar-background)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                color: "var(--vscode-editor-foreground)",
                padding: "1em", // Doubled the padding from "0.5em" to "1em"
                boxSizing: "border-box",
                textAlign: "center",
                width: "clamp(100px, 16vw, 160px)", // Doubled the width clamp values
                height: "clamp(100px, 16vw, 160px)", // Doubled the height clamp values
            }}
            initial={{ opacity: 0, scale: 0 }}
            animate={controls}
            onClick={handleClick}
        >
            <div ref={textRef}>{word}</div>
        </motion.div>
    );
};
function App() {
    const [similarWords, setSimilarWords] = useState<SimilarWord[]>([]);
    const [query, setQuery] = useState("");

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case "similarWords":
                    setSimilarWords(message.data);
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
        vscode.postMessage({
            command: "train",
        });
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
                flexDirection: "column",
                alignItems: "center",
                marginBottom: "1em",
                width: "100%",
                maxWidth: "400px",
            }}>
                <div style={{
                    display: "flex",
                    alignItems: "center",
                    marginBottom: "1em",
                    width: "100%",
                }}>
                    <VSCodeTextField
                        placeholder="Enter a word"
                        value={query}
                        onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
                        style={{ flexGrow: 1, marginRight: "1em" }}
                    />
                    <VSCodeButton onClick={() => searchSimilarWords(query)}>Search</VSCodeButton>
                </div>

                <div style={{ marginBottom: "1em" }}>
                    <VSCodeButton onClick={() => trainModel()}>Train Model</VSCodeButton>
                </div>
            </div>

            {similarWords.length > 0 && (
                <div style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    width: "100%",
                    maxWidth: "400px",
                    flexGrow: 1,
                    justifyContent: "center",
                }}>
                    <motion.div
                        key={query}
                        style={{
                            borderRadius: "50%",
                            background: "var(--vscode-sideBar-background)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: "bold",
                            marginBottom: "1em",
                            flexShrink: 0,
                            width: "clamp(60px, 10vw, 100px)",
                            height: "clamp(60px, 10vw, 100px)",
                            fontSize: "clamp(12px, 2vw, 20px)",
                        }}
                        initial={{ opacity: 0, scale: 0 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.2 }}
                    >
                        {query}
                    </motion.div>

                    <div style={{
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent: "center",
                    gap: "clamp(0.5em, 1vw, 1em)",
                    width: "100%",
                    maxWidth: "400px",
                }}>
                    {similarWords.map((item, index) => (
                        <WordSquare
                            key={`${query}-${index}`}
                            word={item}
                            onClick={() => searchSimilarWords(item)}
                        />
                    ))}
                </div>
                </div>
            )}
        </div>
    );
}

export default App;