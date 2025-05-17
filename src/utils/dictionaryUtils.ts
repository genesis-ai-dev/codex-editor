// Need to usevscode.workspace.fs because the server uses this too
import * as vscode from "vscode";
import { Dictionary, DictionaryEntry } from "../../types";
import { cleanWord } from "./cleaningUtils";

// Server version (using vscode.workspace.fs)
export async function readDictionaryServer(path: string): Promise<Dictionary> {
    try {
        const fileUri = vscode.Uri.file(path);
        const content = await vscode.workspace.fs.readFile(fileUri);
        const entries = deserializeDictionaryEntries(new TextDecoder().decode(content));
        return {
            id: "project",
            label: "Project",
            entries,
            metadata: {},
        };
    } catch (error) {
        console.error("Error reading dictionary:", error);
        return { id: "project", label: "Project", entries: [], metadata: {} };
    }
}

export async function saveDictionaryServer(path: string, dictionary: Dictionary): Promise<void> {
    const content = serializeDictionaryEntries(dictionary.entries);
    const fileUri = vscode.Uri.file(path);
    await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(content));
}

// Client version (using vscode.workspace.fs)
export async function readDictionaryClient(uri: vscode.Uri): Promise<Dictionary> {
    try {
        const content = await vscode.workspace.fs.readFile(uri);
        const entries = deserializeDictionaryEntries(new TextDecoder().decode(content));
        return {
            id: "project",
            label: "Project",
            entries,
            metadata: {},
        };
    } catch (error) {
        console.error("Error reading dictionary:", error);
        return { id: "project", label: "Project", entries: [], metadata: {} };
    }
}

export async function saveDictionaryClient(uri: vscode.Uri, dictionary: Dictionary): Promise<void> {
    const content = serializeDictionaryEntries(dictionary.entries);
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
}

export async function addWordsToDictionary(path: string, words: string[]): Promise<void> {
    const dictionary = await readDictionaryServer(path);
    const newEntries = words
        .map(cleanWord)
        .filter(
            (word) =>
                word &&
                !dictionary.entries.some(
                    (entry) => entry.headWord?.toLowerCase() === word.toLowerCase()
                )
        )
        .map((word) => createDictionaryEntry(word));

    dictionary.entries.push(...newEntries);
    await saveDictionaryServer(path, dictionary);
}

export function serializeDictionaryEntries(entries: DictionaryEntry[]): string {
    return entries.map((entry) => JSON.stringify(ensureCompleteEntry(entry))).join("\n") + "\n";
}

export function deserializeDictionaryEntries(content: string): DictionaryEntry[] {
    return content
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line))
        .map(ensureCompleteEntry);
}

export function repairDictionaryContent(content: string): string {
    return content.replace(/}\s*{/g, "}\n{");
}

export function ensureCompleteEntry(entry: Partial<DictionaryEntry>): DictionaryEntry {
    return {
        id: entry.id || generateUniqueId(),
        headWord: entry.headWord || "N/A",
        definition: entry.definition || "",
        isUserEntry: entry.isUserEntry || false,
        authorId: entry.authorId || "",
    };
}

function createDictionaryEntry(word: string): DictionaryEntry {
    return {
        id: generateUniqueId(),
        headWord: word,
        definition: "",
        isUserEntry: false,
        authorId: "",
    };
}

function generateUniqueId(): string {
    return Math.random().toString(36).substr(2, 9);
}
