import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "../tailwind.css";
import type { FootnoteListFile } from "../../../../types";

function getVSCodeAPI() {
    const w = window as unknown as { __vscodeApi?: ReturnType<typeof acquireVsCodeApi> };
    if (w.__vscodeApi) return w.__vscodeApi;
    const api = acquireVsCodeApi();
    w.__vscodeApi = api;
    return api;
}

function footnotePlainText(html: string): string {
    const doc = new DOMParser().parseFromString(html || "", "text/html");
    return (doc.body.textContent || "").replace(/\u00A0/g, " ").trim();
}

function FootnotesListApp() {
    const vscode = getVSCodeAPI();
    const [files, setFiles] = useState<FootnoteListFile[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const message = event.data;
            if (message?.command === "footnotes") {
                setFiles(message.files ?? []);
                setError(null);
            }
            if (message?.command === "footnotesError") {
                setError(message.message || "Could not load footnotes.");
                setFiles([]);
            }
        };
        window.addEventListener("message", handler);
        vscode.postMessage({ command: "webviewReady" });
        return () => window.removeEventListener("message", handler);
    }, [vscode]);

    const openFootnote = (uri: string, cellId: string) => {
        vscode.postMessage({ command: "openFootnote", uri, cellId });
    };

    return (
        <div className="min-h-screen bg-background text-foreground">
            <header
                className="sticky top-0 z-10 border-b px-4 py-3"
                style={{
                    background: "var(--vscode-editor-background)",
                    borderColor: "var(--vscode-editorWidget-border)",
                }}
            >
                <h1 className="text-base font-semibold">Footnotes List</h1>
            </header>

            {error && <p className="px-4 py-3 text-sm">{error}</p>}
            {files === null && !error && (
                <p className="px-4 py-6 text-sm opacity-70">Loading footnotes…</p>
            )}
            {files && files.length === 0 && !error && (
                <p className="px-4 py-6 text-sm opacity-70">No footnotes in this project.</p>
            )}

            <div className="px-4 py-3">
                {files?.map((file) => (
                    <section key={file.uri} className="mb-6" dir={file.textDirection}>
                        <h2 className="mb-2 text-base font-semibold">{file.fileName}</h2>
                        {file.milestones.map((milestone, milestoneIndex) => (
                            <div key={`${file.uri}-${milestoneIndex}`} className="mb-4">
                                <h3 className="mb-1 text-sm font-medium opacity-80">
                                    {milestone.label}
                                </h3>
                                <ul className="m-0 list-none p-0">
                                    {milestone.notes.map((note, index) => {
                                        const plain = footnotePlainText(note.content);
                                        return (
                                            <li key={`${note.cellId}-${index}`}>
                                                <button
                                                    type="button"
                                                    className="flex w-full items-start gap-3 rounded px-1 py-1 text-left text-sm hover:bg-accent"
                                                    title={`Open ${file.fileName} ${note.verseNumber}`}
                                                    onClick={() => openFootnote(file.uri, note.cellId)}
                                                >
                                                    <span className="w-8 shrink-0 font-semibold opacity-80">
                                                        {note.verseNumber}
                                                    </span>
                                                    {plain ? (
                                                        <span
                                                            className="min-w-0 flex-1"
                                                            dangerouslySetInnerHTML={{
                                                                __html: note.content,
                                                            }}
                                                        />
                                                    ) : (
                                                        <span className="italic opacity-60">
                                                            Empty note
                                                        </span>
                                                    )}
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        ))}
                    </section>
                ))}
            </div>
        </div>
    );
}

const root = document.getElementById("root");
if (root) {
    ReactDOM.createRoot(root).render(
        <React.StrictMode>
            <FootnotesListApp />
        </React.StrictMode>
    );
}
