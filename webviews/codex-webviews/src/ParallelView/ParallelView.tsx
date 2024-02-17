import React, { useState, useEffect } from "react";
// Import other necessary modules and components

//const vscode = acquireVsCodeApi();

interface SearchResult {
  book: string;
  chapter: string;
  verse: string;
  text: string;
  createdAt: string; // Assuming createdAt is a string that can be converted to a Date
  uri: string;
}

function App() {
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case "searchResults":
                    setSearchResults(message.data);
                    break;
                // Handle other cases
            }
        };

        window.addEventListener("message", handleMessage);

        // Cleanup function to remove the event listener
        return () => {
            window.removeEventListener("message", handleMessage);
        };
    }, []);

    const handleUriClick = (uri: string) => {
        // Placeholder for callback function
        console.log(`URI clicked: ${uri}`);
    };

    return (
        <div>
            <h2 style={{textAlign: "center", margin: "20px 0"}}>Parallel Passages</h2>
            {searchResults.length > 0 ? (
                <div>
                    {searchResults.map((result, index) => (
                        <div key={index} style={{marginBottom: "20px", background: "var(--vscode-sideBar-background)", borderRadius: "10px", padding: "20px"}}>
                            <h3>{result.book} {result.chapter}:{result.verse}</h3>
                            <p style={{background: "var( --vscode-sideBar-dropBackground)", borderRadius: "10px", margin: "10px", padding: "5px"}}>
                                {result.text}
                              </p>
                            <p><strong>Created At:</strong> {new Date(result.createdAt).toLocaleString()}</p>
                            <button onClick={() => handleUriClick(result.uri)} style={{marginTop: "10px", padding: "5px 10px"}}>Open</button>
                        </div>
                    ))}
                </div>
            ) : (
                <p>No results found.</p>
            )}
        </div>
    );
}
export default App;