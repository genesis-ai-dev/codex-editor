import * as vscode from "vscode";
import * as path from "path";
import Chatbot from "./chat";
import { TranslationPair, MinimalCellResult } from "../../types";
import { SavedBacktranslation } from "./smartBacktranslation";
import { SYSTEM_MESSAGE } from "./prompts";
import { findRelevantVideos, VideoEntry } from "./utils/videoUtil";
import { v4 as uuidv4 } from "uuid";

interface TranslationPairWithBacktranslation extends TranslationPair {
    backtranslation?: string;
    feedback?: string;
}

interface Feedback {
    content: string;
}

interface ChatMessage {
    role: "user" | "assistant" | "system" | "context";
    content: string;
}

interface SingleChatHistoryEntry {
    messages: ChatMessage[];
    name: string;
    timestamp: string;
}

interface ChatHistory {
    entries: SingleChatHistoryEntry[];
}

interface ChatHistoryEntry {
    sessionId: string;
    name: string;
    messages: ChatMessage[];
    timestamp: string;
}

export class SmartPassages {
    private chatbot: Chatbot;
    private feedbackFile: string;
    private chatHistoryFile: string;
    private currentSessionId: string;
    private currentSessionName: string | null;
    constructor() {
        this.chatbot = new Chatbot(SYSTEM_MESSAGE);
        // Assuming the workspace URI is available. You might need to pass it to the constructor.
        const workspaceUri = vscode.workspace.workspaceFolders?.[0].uri;
        if (workspaceUri) {
            this.feedbackFile = path.join(
                workspaceUri.fsPath,
                "files",
                "smart_passages_memories.json"
            );
            this.chatHistoryFile = path.join(workspaceUri.fsPath, "files", "chat_history.jsonl");

            // Ensure the files exist or create them
            this.ensureFileExists(this.feedbackFile);
            this.ensureFileExists(this.chatHistoryFile);
        } else {
            throw new Error("No workspace found");
        }
        this.currentSessionId = uuidv4();
        this.currentSessionName = null;
    }

    private async ensureFileExists(filePath: string) {
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
        } catch (error) {
            // File doesn't exist, create it
            try {
                await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), new TextEncoder().encode(""));
            } catch (createError) {
                console.error(`Error creating file ${filePath}:`, createError);
                // If creation fails, delete the file (if it exists) and try again
                try {
                    await vscode.workspace.fs.delete(vscode.Uri.file(filePath));
                    await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), new TextEncoder().encode(""));
                } catch (retryError) {
                    console.error(`Error recreating file ${filePath}:`, retryError);
                }
            }
        }
    }

    private generateSessionName(query: string): string {
        // Truncate the query if it's too long
        const maxLength = 50;
        let name = query.trim().substring(0, maxLength);
        if (query.length > maxLength) {
            name += "...";
        }
        return name;
    }

    async chat(cellIds: string[], query: string) {
        if (!this.currentSessionName) {
            this.currentSessionName = this.generateSessionName(query);
        }
        await this.updateContext(cellIds);
        const response = await this.chatbot.sendMessage(query);
        await this.saveChatHistory();
        return response;
    }

    async chatStream(
        cellIds: string[],
        query: string,
        onChunk: (chunk: string) => void,
        editIndex?: number
    ) {
        if (!this.currentSessionName) {
            this.currentSessionName = this.generateSessionName(query);
        }
        await this.updateContext(cellIds);
        if (editIndex !== undefined) {
            await this.chatbot.editMessage(editIndex, query);
        }
        const response = await this.chatbot.sendMessageStream(query, (chunk, isLast) => {
            onChunk(
                JSON.stringify({
                    index: chunk.index,
                    content: chunk.content,
                    isLast: isLast,
                })
            );
        });
        await this.saveChatHistory();
        return response;
    }

    private async updateContext(cellIds: string[]) {
        const formattedContext = await this.formatContext(cellIds);
        await this.chatbot.setContext(formattedContext);
    }

    private async formatContext(cellIds: string[]): Promise<string> {
        const cells: TranslationPairWithBacktranslation[] = [];
        const generalEntries: { cellId: string; content: string }[] = [];
        const allMemories = await this.readAllMemories();
        const videos: VideoEntry[] = [];

        for (const cellId of cellIds) {
            try {
                const relevantVideos = await findRelevantVideos(cellId);
                videos.push(...relevantVideos);
            } catch (error) {
                console.error(`Error finding relevant videos for cellId ${cellId}:`, error);
            }
        }

        // Separate general entries
        Object.entries(allMemories).forEach(([id, feedback]) => {
            if (id.startsWith("General")) {
                generalEntries.push({ cellId: id, content: feedback.content });
            }
        });

        // Add specific cell IDs
        for (const cellId of cellIds) {
            const pair = await vscode.commands.executeCommand<TranslationPair | null>(
                "translators-copilot.getTranslationPairFromProject",
                cellId
            );
            console.log(`Pair: ${JSON.stringify(pair)}`);

            const pairWithBacktranslation: TranslationPairWithBacktranslation = pair
                ? {
                      ...pair,
                      backtranslation: undefined,
                      edits: [],
                      feedback: undefined,
                  }
                : { cellId, sourceCell: { content: "" }, targetCell: { content: "" } };

            if (pair) {
                if (pair.targetCell.uri) {
                    try {
                        // Get the file content similar to SmartEdits
                        let filePath = pair.targetCell.uri
                            .toString()
                            .replace(".source", ".codex")
                            .replace(".project/sourceTexts/", "files/target/");
                        filePath = filePath.replace(".source", ".codex");
                        const fileUri = vscode.Uri.parse(filePath);
                        const fileContent = await vscode.workspace.fs.readFile(fileUri);
                        const jsonContent = JSON.parse(fileContent.toString());

                        // Find the cell and get its edits
                        const cell = jsonContent.cells.find(
                            (cell: any) => cell.metadata.id === pair.cellId
                        );
                        if (cell) {
                            pairWithBacktranslation.edits = cell.metadata.edits || [];
                        }
                    } catch (error) {
                        console.error(`Error reading file for cellId ${pair.cellId}:`, error);
                    }
                }

                try {
                    // Get backtranslation for the cell
                    const backtranslation =
                        await vscode.commands.executeCommand<SavedBacktranslation | null>(
                            "codex-smart-edits.getBacktranslation",
                            pair.cellId
                        );
                    if (backtranslation) {
                        pairWithBacktranslation.backtranslation = backtranslation.backtranslation;
                    }
                } catch (error) {
                    console.error(
                        `Error getting backtranslation for cellId ${pair.cellId}:`,
                        error
                    );
                }
            }

            // Add feedback to the pair
            if (allMemories[cellId]) {
                pairWithBacktranslation.feedback = allMemories[cellId].content;
            }

            cells.push(pairWithBacktranslation);
        }

        // Format the cells and general entries
        const formattedGeneralEntries = generalEntries.map(
            (entry) => `"${entry.cellId}": {
    general feedback: ${entry.content}
}`
        );

        const formattedCells = cells
            .map((pair) => {
                const sourceText = pair.sourceCell?.content || "N/A";
                const targetText = pair.targetCell?.content || "N/A";
                const edits = pair.edits || [];
                const backtranslation = pair.backtranslation || "N/A";
                const feedbackText = pair.feedback ? `\n    feedback: ${pair.feedback}` : "";

                // Only include edit history if there are edits
                const editHistory =
                    edits.length > 0
                        ? edits
                              .map((edit, index) => {
                                  const plainText = edit.cellValue
                                      .replace(/<[^>]*>/g, "")
                                      .replace(/&amp;|&lt;|&gt;|&quot;|&#39;/g, "")
                                      .replace(/&nbsp; ?/g, " ")
                                      .replace(/&#\d+;/g, "")
                                      .replace(/&[a-zA-Z]+;/g, "");

                                  return `    revision ${index + 1} (${new Date(edit.timestamp).toISOString()}):
        ${plainText}`;
                              })
                              .join("\n")
                        : "";

                return `"${pair.cellId}": {
    source text: ${sourceText}
    target text: ${targetText}
    backtranslation: ${backtranslation}${feedbackText}${editHistory ? "\n    edit history:\n" + editHistory : ""}
}`;
            })
            .filter((text) => text !== "");

        const allFormattedEntries = [...formattedGeneralEntries, ...formattedCells];

        // Add video information to the formatted context
        const formattedVideos = videos
            .map(
                (video) => `
    "${video.videoId}": {
        title: ${video.title}
        range: ${video.range}
    }`
            )
            .join("\n");

        return `Context:\n${allFormattedEntries.join("\n\n")}\n\nRelevant Videos:\n${formattedVideos}`;
    }

    async updateFeedback(cellId: string, content: string): Promise<void> {
        const trimmedContent = content.trim();
        const cellIds = cellId.includes(",") ? cellId.split(",").map((id) => id.trim()) : [cellId];

        for (const id of cellIds) {
            // Check if this content already exists for this cellId
            const existingEntries = await this.readEntriesForCell(id);
            if (existingEntries.some((entry) => entry.content === trimmedContent)) {
                console.log(`Skipping duplicate content for cellId: ${id}`);
                continue;
            }

            const newEntry = {
                cellId: id,
                content: trimmedContent,
                timestamp: new Date().toISOString(),
            };

            // Read the current feedback file, append the new entry, and write back
            try {
                const fileUri = vscode.Uri.file(this.feedbackFile);
                let feedbackArr: any[] = [];
                try {
                    const content = await vscode.workspace.fs.readFile(fileUri);
                    const text = new TextDecoder().decode(content);
                    feedbackArr = text.trim() ? JSON.parse(text) : [];
                } catch (readErr) {
                    // File may not exist or be empty
                    feedbackArr = [];
                }
                feedbackArr.push(newEntry);
                await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(JSON.stringify(feedbackArr, null, 2)));
            } catch (error) {
                console.error(`Error appending feedback for cellId ${id}:`, error);
            }
        }
    }

    public async saveChatHistory(): Promise<void> {
        if (!this.currentSessionName) {
            return;
        }

        const entry: SingleChatHistoryEntry = {
            messages: this.chatbot.messages,
            name: this.currentSessionName,
            timestamp: new Date().toISOString(),
        };

        const fileUri = vscode.Uri.file(this.chatHistoryFile);
        let existingContent = "";
        try {
            const content = await vscode.workspace.fs.readFile(fileUri);
            existingContent = new TextDecoder().decode(content);
        } catch (error) {
            console.error("Error reading chat history file:", error);
        }

        const newEntry = JSON.stringify(entry) + "\n";
        await vscode.workspace.fs.writeFile(
            fileUri,
            new TextEncoder().encode(existingContent + newEntry)
        );
    }

    public async loadChatHistory(sessionId?: string): Promise<ChatHistoryEntry | null> {
        const fileUri = vscode.Uri.file(this.chatHistoryFile);
        try {
            const content = await vscode.workspace.fs.readFile(fileUri);
            const lines = new TextDecoder().decode(content).split("\n").filter(Boolean);
            
            for (const line of lines) {
                const entry = JSON.parse(line) as SingleChatHistoryEntry;
                if (!sessionId || entry.name === sessionId) {
                    return {
                        sessionId: entry.name,
                        name: entry.name,
                        messages: entry.messages,
                        timestamp: entry.timestamp,
                    };
                }
            }
        } catch (error) {
            console.error("Error loading chat history:", error);
        }
        return null;
    }

    public startNewSession(): void {
        this.currentSessionId = uuidv4();
        this.currentSessionName = null;
        this.chatbot.messages = [this.chatbot.messages[0]]; // Keep only the system message
        console.log(`Started new chat session with ID: ${this.currentSessionId}`);
    }

    public getCurrentSessionInfo(): { id: string; name: string | null } {
        return {
            id: this.currentSessionId,
            name: this.currentSessionName,
        };
    }

    public async getAllSessions(): Promise<Array<{ id: string; name: string; timestamp: string }>> {
        const fileUri = vscode.Uri.file(this.chatHistoryFile);
        try {
            const content = await vscode.workspace.fs.readFile(fileUri);
            const lines = new TextDecoder().decode(content).split("\n").filter(Boolean);
            
            return lines.map((line) => {
                const entry = JSON.parse(line) as SingleChatHistoryEntry;
                return {
                    id: entry.name,
                    name: entry.name,
                    timestamp: entry.timestamp,
                };
            });
        } catch (error) {
            console.error("Error getting all sessions:", error);
            return [];
        }
    }

    private async readEntriesForCell(
        cellId: string
    ): Promise<Array<{ content: string; timestamp: string }>> {
        const fileUri = vscode.Uri.file(this.feedbackFile);
        try {
            const content = await vscode.workspace.fs.readFile(fileUri);
            const data = JSON.parse(new TextDecoder().decode(content));
            return data[cellId] || [];
        } catch (error) {
            console.error("Error reading entries for cell:", error);
            return [];
        }
    }

    private async readAllMemories(): Promise<{ [cellId: string]: Feedback }> {
        const fileUri = vscode.Uri.file(this.feedbackFile);
        try {
            const content = await vscode.workspace.fs.readFile(fileUri);
            return JSON.parse(new TextDecoder().decode(content)) || {};
        } catch (error) {
            console.error("Error reading all memories:", error);
            return {};
        }
    }

    private convertCellIdToVerseReference(cellId: string): string {
        // Implement the conversion logic here
        // This is just a placeholder example
        return cellId.replace("_", " ").toUpperCase();
    }

    public async deleteChatSession(sessionId: string): Promise<boolean> {
        const fileUri = vscode.Uri.file(this.chatHistoryFile);
        try {
            const content = await vscode.workspace.fs.readFile(fileUri);
            const lines = new TextDecoder().decode(content).split("\n").filter(Boolean);
            
            const filteredLines = lines.filter((line) => {
                const entry = JSON.parse(line) as SingleChatHistoryEntry;
                return entry.name !== sessionId;
            });

            await vscode.workspace.fs.writeFile(
                fileUri,
                new TextEncoder().encode(filteredLines.join("\n") + "\n")
            );
            return true;
        } catch (error) {
            console.error("Error deleting chat session:", error);
            return false;
        }
    }
}
