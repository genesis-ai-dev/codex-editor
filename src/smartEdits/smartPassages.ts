import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs/promises";
import Chatbot from "./chat";
import { TranslationPair, MinimalCellResult } from "../../types";
import { SavedBacktranslation } from "./smartBacktranslation";
import { SYSTEM_MESSAGE } from "./prompts";
import * as readline from "readline";
import { createReadStream, createWriteStream } from "fs";
import { findRelevantVideos, VideoEntry } from "./utils/videoUtil";
import { v4 as uuidv4 } from "uuid";
import * as os from "os";

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
        } else {
            throw new Error("No workspace found");
        }
        this.currentSessionId = uuidv4();
        this.currentSessionName = null;
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
                                      .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g, "")
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

            const jsonLine = JSON.stringify(newEntry) + "\n";

            try {
                await fs.appendFile(this.feedbackFile, jsonLine, "utf-8");
            } catch (error) {
                console.error(`Error appending feedback for cellId ${id}:`, error);
            }
        }
    }

    public async saveChatHistory(): Promise<void> {
        const currentEntry: ChatHistoryEntry = {
            sessionId: this.currentSessionId,
            name: this.currentSessionName || "Unnamed Chat",
            messages: this.chatbot.messages,
            timestamp: new Date().toISOString(),
        };

        const tempFile = path.join(os.tmpdir(), `chat_history_temp_${Date.now()}.jsonl`);

        try {
            const writeStream = createWriteStream(tempFile);
            const readStream = createReadStream(this.chatHistoryFile);
            const rl = readline.createInterface({
                input: readStream,
                crlfDelay: Infinity,
            });

            let currentSessionUpdated = false;

            for await (const line of rl) {
                try {
                    const entry: ChatHistoryEntry = JSON.parse(line);
                    if (entry.sessionId === this.currentSessionId) {
                        // Update the current session
                        writeStream.write(JSON.stringify(currentEntry) + "\n");
                        currentSessionUpdated = true;
                    } else {
                        // Write other sessions as they are
                        writeStream.write(line + "\n");
                    }
                } catch (parseError) {
                    console.error("Error parsing chat history line:", parseError);
                    // Write the line as is if there's a parsing error
                    writeStream.write(line + "\n");
                }
            }

            // If the current session wasn't in the file, append it
            if (!currentSessionUpdated) {
                writeStream.write(JSON.stringify(currentEntry) + "\n");
            }

            writeStream.end();

            // Wait for the write stream to finish
            await new Promise<void>((resolve, reject) => {
                writeStream.on("finish", resolve);
                writeStream.on("error", reject);
            });

            // Replace the old file with the new one
            await fs.rename(tempFile, this.chatHistoryFile);

            console.log(`Chat history saved for session ${this.currentSessionId}`);
        } catch (error) {
            console.error("Error saving chat history:", error);
            // Clean up the temp file if there was an error
            await fs.unlink(tempFile).catch(console.error);
        }
    }

    public async loadChatHistory(sessionId?: string): Promise<ChatHistoryEntry | null> {
        try {
            const content = await fs.readFile(this.chatHistoryFile, "utf-8");
            const lines = content.split("\n").filter((line) => line.trim() !== "");

            let latestSession: ChatHistoryEntry | null = null;

            for (const line of lines) {
                try {
                    const entry: ChatHistoryEntry = JSON.parse(line);
                    if (sessionId && entry.sessionId === sessionId) {
                        latestSession = entry;
                        break;
                    } else if (
                        !sessionId &&
                        (!latestSession ||
                            new Date(entry.timestamp) > new Date(latestSession.timestamp))
                    ) {
                        latestSession = entry;
                    }
                } catch (parseError) {
                    console.error("Error parsing chat history line:", parseError);
                }
            }

            if (latestSession) {
                this.currentSessionId = latestSession.sessionId;
                this.currentSessionName = latestSession.name;
                this.chatbot.messages = [
                    this.chatbot.messages[0],
                    ...latestSession.messages.slice(1),
                ];
                console.log(
                    `Loaded chat history for session ${this.currentSessionId}: ${this.currentSessionName}`
                );
                return latestSession;
            } else {
                console.log("No matching chat history found. Starting a new session.");
                return null;
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                console.log("Chat history file not found. Starting with a fresh history.");
            } else {
                console.error("Error loading chat history:", error);
            }
            return null; // Add this line to ensure a return value in all cases
        }
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
        const sessions: Array<{ id: string; name: string; timestamp: string }> = [];

        try {
            const fileStream = createReadStream(this.chatHistoryFile);
            const rl = readline.createInterface({
                input: fileStream,
                crlfDelay: Infinity,
            });

            for await (const line of rl) {
                try {
                    const entry: ChatHistoryEntry = JSON.parse(line);
                    sessions.push({
                        id: entry.sessionId,
                        name: entry.name,
                        timestamp: entry.timestamp,
                    });
                } catch (parseError) {
                    console.error("Error parsing chat history line:", parseError);
                }
            }

            return sessions;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                // File doesn't exist, return an empty array
                return [];
            }
            console.error("Error reading chat history:", error);
            return [];
        }
    }

    private async readEntriesForCell(
        cellId: string
    ): Promise<Array<{ content: string; timestamp: string }>> {
        const entries: Array<{ content: string; timestamp: string }> = [];

        try {
            const fileStream = createReadStream(this.feedbackFile);
            const rl = readline.createInterface({
                input: fileStream,
                crlfDelay: Infinity,
            });

            for await (const line of rl) {
                try {
                    const entry = JSON.parse(line);
                    if (entry.cellId === cellId) {
                        entries.push({ content: entry.content, timestamp: entry.timestamp });
                    }
                } catch (parseError) {
                    console.error("Error parsing line:", parseError);
                }
            }

            return entries;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                // File doesn't exist, return an empty array
                return [];
            }
            console.error("Error reading entries:", error);
            return [];
        }
    }

    private async readAllMemories(): Promise<{ [cellId: string]: Feedback }> {
        const memories: { [cellId: string]: Feedback } = {};

        try {
            const fileStream = createReadStream(this.feedbackFile);
            const rl = readline.createInterface({
                input: fileStream,
                crlfDelay: Infinity,
            });

            for await (const line of rl) {
                try {
                    const entry = JSON.parse(line);
                    if (!memories[entry.cellId]) {
                        memories[entry.cellId] = { content: "" };
                    }
                    memories[entry.cellId].content += `- ${entry.content}\n`;
                } catch (parseError) {
                    console.error("Error parsing line:", parseError);
                }
            }

            return memories;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                // File doesn't exist, return an empty object
                return {};
            }
            console.error("Error reading memories:", error);
            return {};
        }
    }

    private convertCellIdToVerseReference(cellId: string): string {
        // Implement the conversion logic here
        // This is just a placeholder example
        return cellId.replace("_", " ").toUpperCase();
    }
}
